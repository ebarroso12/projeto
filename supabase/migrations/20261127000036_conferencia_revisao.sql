-- =====================================================================
-- Conferência dupla: correções da revisão
--
--  1) Contestação não some: editar a remessa só refaz a confirmação do envio quando os ITENS mudam,
--     e a antiga fica guardada como histórico (substituida_em). Excluir um retorno também guarda a resposta.
--     Contestação em aberto impede mudar os itens, excluir o retorno/remessa e acertar: primeiro resolve.
--  2) Contestação tem fim: "Resolver" registra o que foi decidido (quem, quando e a nota) e a oficina vê.
--  3) Limite de perda só o administrador muda (quem é vigiado pelos avisos não pode desligá-los).
--  4) O link é um UUID v4: 122 bits aleatórios (não 128, como dizia o comentário anterior).
-- =====================================================================

alter table fab.remessa_confirmacoes
  add column if not exists etapa text not null default 'envio' check (etapa in ('envio', 'retorno')),
  add column if not exists substituida_em timestamptz,
  add column if not exists resolvida_em timestamptz,
  add column if not exists resolvida_por uuid references fab.perfis (id) on delete set null,
  add column if not exists resolvida_por_nome text not null default '',
  add column if not exists resolucao text not null default '';
update fab.remessa_confirmacoes set etapa = 'retorno' where retorno_id is not null and etapa <> 'retorno';

-- excluir o retorno não apaga mais a resposta da oficina: ela vira histórico
alter table fab.remessa_confirmacoes drop constraint if exists remessa_confirmacoes_retorno_id_fkey;
alter table fab.remessa_confirmacoes add constraint remessa_confirmacoes_retorno_id_fkey foreign key (retorno_id) references fab.remessa_retornos (id) on delete set null;
drop index if exists fab.remessa_confirmacoes_uma;
create unique index if not exists remessa_confirmacoes_envio_uma on fab.remessa_confirmacoes (remessa_id) where etapa = 'envio' and substituida_em is null;
create unique index if not exists remessa_confirmacoes_retorno_uma on fab.remessa_confirmacoes (retorno_id) where retorno_id is not null and substituida_em is null;

create or replace function fab.confirmacao_retorno_apagado() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update fab.remessa_confirmacoes set substituida_em = now() where retorno_id = old.id and substituida_em is null;
  return old;
end $$;
drop trigger if exists confirmacao_retorno_apagado on fab.remessa_retornos;
create trigger confirmacao_retorno_apagado before delete on fab.remessa_retornos for each row execute function fab.confirmacao_retorno_apagado();

-- contestação em aberto (não resolvida e ainda valendo)
create or replace function fab.contestacao_aberta(p_remessa uuid, p_retorno uuid default null) returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from fab.remessa_confirmacoes c where c.remessa_id = p_remessa and not c.confere and c.resolvida_em is null and c.substituida_em is null
                 and (p_retorno is null or c.retorno_id = p_retorno))
$$;

create or replace function fab.confirmacao_json(c fab.remessa_confirmacoes) returns jsonb language sql stable set search_path = '' as $$
  select case when c.id is null then null else jsonb_build_object('id', c.id, 'confere', c.confere, 'em', c.em, 'nome', c.nome, 'obs', c.obs, 'itens', c.itens,
    'resolvida', case when c.resolvida_em is null then null else jsonb_build_object('em', c.resolvida_em, 'por', c.resolvida_por_nome, 'nota', c.resolucao) end) end
$$;

create or replace function public.fab_remessa_publica(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r fab.remessas := fab.remessa_por_token(p_token); env integer; boas integer; def integer;
begin
  select coalesce(sum(i.qtd), 0), coalesce(sum((select coalesce(sum(ri.boas), 0) from fab.retorno_itens ri where ri.item_id = i.id)), 0),
         coalesce(sum((select coalesce(sum(ri.defeito), 0) from fab.retorno_itens ri where ri.item_id = i.id)), 0)
    into env, boas, def from fab.remessa_itens i where i.remessa_id = r.id;
  return jsonb_build_object(
    'empresa', (select nome from fab.empresas where id = r.empresa_id),
    'numero', r.numero, 'quem', r.quem_nome, 'etapa', r.etapa, 'dataEnvio', r.data_envio, 'prazo', r.prazo,
    'valorPeca', r.valor_peca, 'descontoFaltante', r.desconto_faltante, 'status', r.status, 'fechadaEm', r.fechada_em, 'valorPago', r.valor_pago,
    'enviadas', env, 'boas', boas, 'defeito', def,
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'modelo', i.modelo, 'cor', i.cor, 'tamanho', i.tamanho, 'qtd', i.qtd,
                         'boas', coalesce((select sum(ri.boas) from fab.retorno_itens ri where ri.item_id = i.id), 0),
                         'defeito', coalesce((select sum(ri.defeito) from fab.retorno_itens ri where ri.item_id = i.id), 0))
                       order by i.modelo, i.cor, i.tamanho) from fab.remessa_itens i where i.remessa_id = r.id), '[]'::jsonb),
    'confirmacaoEnvio', (select fab.confirmacao_json(c) from fab.remessa_confirmacoes c where c.remessa_id = r.id and c.etapa = 'envio' and c.substituida_em is null),
    'retornos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'data', t.data,
                            'itens', (select coalesce(jsonb_agg(jsonb_build_object('itemId', ri.item_id, 'boas', ri.boas, 'defeito', ri.defeito)), '[]'::jsonb) from fab.retorno_itens ri where ri.retorno_id = t.id),
                            'confirmacao', (select fab.confirmacao_json(c) from fab.remessa_confirmacoes c where c.retorno_id = t.id))
                          order by t.data, t.criado_em) from fab.remessa_retornos t where t.remessa_id = r.id), '[]'::jsonb));
end $$;

create or replace function public.fab_remessa_confirmar(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r fab.remessas := fab.remessa_por_token(p_token); v_ret uuid; v_confere boolean; it jsonb; v_item uuid; v_qtd integer;
  esperado jsonb := '{}'::jsonb; contado jsonb := '{}'::jsonb; dif integer := 0; tot_esp integer := 0; tot_cont integer := 0;
  v_nome text := left(btrim(coalesce(p ->> 'nome', '')), 60); v_obs text := left(btrim(coalesce(p ->> 'obs', '')), 300); ja fab.remessa_confirmacoes;
begin
  perform 1 from fab.remessas where id = r.id for update;   -- uma confirmação por vez nesta remessa
  begin v_ret := nullif(p ->> 'retornoId', '')::uuid; exception when others then raise exception 'Retorno inválido.'; end;
  if v_ret is not null and not exists (select 1 from fab.remessa_retornos where id = v_ret and remessa_id = r.id) then raise exception 'Retorno inválido.'; end if;
  select * into ja from fab.remessa_confirmacoes where remessa_id = r.id and substituida_em is null
     and (case when v_ret is null then etapa = 'envio' else retorno_id = v_ret end);
  if found then raise exception 'Esta etapa já foi respondida em %. Se precisar corrigir, fale com a fábrica.', to_char(ja.em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'); end if;

  -- o que a fábrica registrou: envio = quantidade enviada; retorno = boas + defeito daquele retorno
  if v_ret is null then
    select coalesce(jsonb_object_agg(i.id::text, i.qtd), '{}'::jsonb) into esperado from fab.remessa_itens i where i.remessa_id = r.id;
  else
    select coalesce(jsonb_object_agg(ri.item_id::text, ri.boas + ri.defeito), '{}'::jsonb) into esperado from fab.retorno_itens ri where ri.retorno_id = v_ret;
  end if;
  select coalesce(sum(value::integer), 0) into tot_esp from jsonb_each_text(esperado);

  v_confere := coalesce(p ->> 'confere', '') = 'true';
  if not v_confere then
    if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Informe quantas peças você contou em cada item.'; end if;
    contado := esperado;   -- item não informado = igual ao da fábrica
    for it in select * from jsonb_array_elements(p -> 'itens') loop
      begin v_item := nullif(it ->> 'itemId', '')::uuid; exception when others then raise exception 'Item inválido.'; end;
      if v_item is null or not (esperado ? v_item::text) then raise exception 'Item inválido.'; end if;
      if coalesce(it ->> 'qtd', '') !~ '^[0-9]{1,6}$' then raise exception 'Quantidade inválida.'; end if;
      v_qtd := (it ->> 'qtd')::integer;
      contado := jsonb_set(contado, array[v_item::text], to_jsonb(v_qtd));
    end loop;
    select coalesce(sum(abs(value::integer - (esperado ->> key)::integer)), 0), coalesce(sum(value::integer), 0) into dif, tot_cont from jsonb_each_text(contado);
    v_confere := dif = 0;   -- informou os mesmos números: na prática, confere
  end if;

  insert into fab.remessa_confirmacoes (remessa_id, empresa_id, retorno_id, etapa, confere, itens, nome, obs)
  values (r.id, r.empresa_id, v_ret, case when v_ret is null then 'envio' else 'retorno' end, v_confere,
          case when v_confere then '[]'::jsonb else (select jsonb_agg(jsonb_build_object('itemId', key, 'qtd', value::integer)) from jsonb_each_text(contado) where value::integer <> (esperado ->> key)::integer) end,
          v_nome, v_obs);
  perform fab.registrar(r.empresa_id, null, coalesce(nullif(v_nome, ''), r.quem_nome) || ' (pelo link)',
    case when v_confere then 'remessa_confirmada' else 'remessa_contestada' end, 'remessas',
    jsonb_build_object('remessa', r.numero, 'etapa', case when v_ret is null then 'envio' else 'retorno' end, 'fabrica', tot_esp, 'oficina', case when v_confere then tot_esp else tot_cont end));
  if not v_confere then
    perform fab.enviar_aviso(r.empresa_id, fab.cuidam_remessas(r.empresa_id), 'remessa', 'Oficina contestou a contagem',
      'Remessa #' || r.numero || ' (' || r.quem_nome || '): ' ||
      case when v_ret is null then 'diz que recebeu ' || tot_cont || ' peça(s); a fábrica registrou ' || tot_esp || ' enviada(s).'
           else 'diz que devolveu ' || tot_cont || ' peça(s); a fábrica contou ' || tot_esp || '.' end ||
      case when v_obs <> '' then ' Obs.: ' || v_obs else '' end,
      '#/remessas');
  end if;
  return jsonb_build_object('confere', v_confere, 'fabrica', tot_esp, 'oficina', case when v_confere then tot_esp else tot_cont end);
end $$;

create or replace function fab.remessa_json(r fab.remessas) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'numero', r.numero, 'quem', r.quem_nome, 'login', (select login from fab.perfis where id = r.user_id),
    'oficinaId', r.oficina_id, 'telefone', (select telefone from fab.registros where id = r.oficina_id),
    'etapa', r.etapa, 'dataEnvio', r.data_envio, 'prazo', r.prazo, 'valorPeca', r.valor_peca, 'descontoFaltante', r.desconto_faltante,
    'ordemId', r.ordem_id, 'ordemNumero', (select numero from fab.ordens_corte where id = r.ordem_id), 'status', r.status, 'fechadaEm', r.fechada_em,
    'valorPago', r.valor_pago, 'noFinanceiro', exists (select 1 from fab.fin_lancamentos l where l.id = r.fin_lancamento_id and l.apagado_em is null),
    'obs', r.obs, 'token', r.token,
    -- contestações antigas (envio refeito ou retorno excluído): ficam como histórico
    'historico', coalesce((select jsonb_agg(fab.confirmacao_json(c) || jsonb_build_object('etapa', c.etapa, 'substituidaEm', c.substituida_em) order by c.em)
                            from fab.remessa_confirmacoes c where c.remessa_id = r.id and c.substituida_em is not null), '[]'::jsonb),
    'confirmacaoEnvio', (select fab.confirmacao_json(c) from fab.remessa_confirmacoes c where c.remessa_id = r.id and c.etapa = 'envio' and c.substituida_em is null),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'modelo', i.modelo, 'cor', i.cor, 'tamanho', i.tamanho, 'qtd', i.qtd,
                         'boas', coalesce((select sum(ri.boas) from fab.retorno_itens ri where ri.item_id = i.id), 0),
                         'defeito', coalesce((select sum(ri.defeito) from fab.retorno_itens ri where ri.item_id = i.id), 0))
                       order by i.modelo, i.cor, i.tamanho) from fab.remessa_itens i where i.remessa_id = r.id), '[]'::jsonb),
    'retornos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'data', t.data, 'obs', t.obs, 'cega', t.cega,
                            'itens', (select coalesce(jsonb_agg(jsonb_build_object('itemId', ri.item_id, 'boas', ri.boas, 'defeito', ri.defeito)), '[]'::jsonb) from fab.retorno_itens ri where ri.retorno_id = t.id),
                            'boas', (select coalesce(sum(boas), 0) from fab.retorno_itens where retorno_id = t.id),
                            'defeito', (select coalesce(sum(defeito), 0) from fab.retorno_itens where retorno_id = t.id),
                            'confirmacao', (select fab.confirmacao_json(c) from fab.remessa_confirmacoes c where c.retorno_id = t.id))
                          order by t.data, t.criado_em) from fab.remessa_retornos t where t.remessa_id = r.id), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------- editar remessa: só refaz a confirmação se os itens mudaram
do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_salvar_remessa(jsonb)'::regprocedure) into src;
  src := replace(src, '    delete from fab.remessa_itens where remessa_id = v_id;
    delete from fab.remessa_confirmacoes where remessa_id = v_id and retorno_id is null;',
    '    v_antes := (select coalesce(jsonb_agg(jsonb_build_array(modelo, cor, tamanho, qtd) order by modelo, cor, tamanho), ''[]''::jsonb) from fab.remessa_itens where remessa_id = v_id);
    delete from fab.remessa_itens where remessa_id = v_id;');
  src := replace(src, '  return jsonb_build_object(''id'', v_id, ''numero'', v_num, ''pecas'', n);',
    '  if v_antes is not null and v_antes is distinct from (select coalesce(jsonb_agg(jsonb_build_array(modelo, cor, tamanho, qtd) order by modelo, cor, tamanho), ''[]''::jsonb) from fab.remessa_itens where remessa_id = v_id) then
    if fab.contestacao_aberta(v_id) then raise exception ''A oficina contestou esta remessa: resolva a contestação antes de mudar os itens.''; end if;
    update fab.remessa_confirmacoes set substituida_em = now() where remessa_id = v_id and etapa = ''envio'' and substituida_em is null;   -- itens mudaram: pede nova confirmação, a antiga fica no histórico
  end if;
  return jsonb_build_object(''id'', v_id, ''numero'', v_num, ''pecas'', n);');
  src := replace(src, 'it jsonb; v_qtd integer; n integer := 0;', 'it jsonb; v_qtd integer; n integer := 0; v_antes jsonb;');
  if position('v_antes jsonb' in src) = 0 or position('fab.contestacao_aberta(v_id)' in src) = 0 or position('delete from fab.remessa_confirmacoes' in src) > 0 then
    raise exception 'fab_salvar_remessa: trechos não encontrados';
  end if;
  execute src;

  -- excluir retorno / remessa e acertar: não com contestação em aberto
  select pg_get_functiondef('public.fab_apagar_retorno(uuid)'::regprocedure) into src;
  src := replace(src, '  if r.status <> ''aberta'' then raise exception ''A remessa já foi fechada. Reabra para corrigir.''; end if;',
    '  if r.status <> ''aberta'' then raise exception ''A remessa já foi fechada. Reabra para corrigir.''; end if;
  if fab.contestacao_aberta(r.id, p_id) then raise exception ''A oficina contestou esta devolução: resolva a contestação antes de excluir.''; end if;');
  if position('contestacao_aberta' in src) = 0 then raise exception 'fab_apagar_retorno: trecho não encontrado'; end if;
  execute src;

  select pg_get_functiondef('public.fab_apagar_remessa(uuid)'::regprocedure) into src;
  src := replace(src, '  delete from fab.remessas where id = p_id;',
    '  if fab.contestacao_aberta(p_id) then raise exception ''A oficina contestou esta remessa: resolva a contestação antes de excluir.''; end if;
  delete from fab.remessas where id = p_id;');
  if position('contestacao_aberta' in src) = 0 then raise exception 'fab_apagar_remessa: trecho não encontrado'; end if;
  execute src;

  select pg_get_functiondef('public.fab_fechar_remessa(uuid, jsonb)'::regprocedure) into src;
  src := replace(src, '  if r.status <> ''aberta'' then raise exception ''A remessa já está fechada.''; end if;',
    '  if r.status <> ''aberta'' then raise exception ''A remessa já está fechada.''; end if;
  if fab.contestacao_aberta(p_id) then raise exception ''A oficina contestou uma contagem desta remessa: resolva a contestação antes de acertar.''; end if;');
  if position('contestacao_aberta' in src) = 0 then raise exception 'fab_fechar_remessa: trecho não encontrado'; end if;
  execute src;

  -- link: comentário certo sobre a força do token
  select pg_get_functiondef('public.fab_remessa_link(uuid, boolean)'::regprocedure) into src;
  src := replace(src, '  t := replace(gen_random_uuid()::text, ''-'', '''');', '  t := replace(gen_random_uuid()::text, ''-'', '''');   -- UUID v4: 122 bits aleatórios');
  execute src;
end $$;

-- ---------------------------------------------------------------- resolver a contestação
create or replace function public.fab_resolver_contestacao(p_remessa uuid, p_retorno uuid, p_nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); r fab.remessas; c fab.remessa_confirmacoes; v_nota text := btrim(coalesce(p_nota, ''));
begin
  select * into r from fab.remessas where id = p_remessa and empresa_id = u.empresa_id for update;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  select * into c from fab.remessa_confirmacoes where remessa_id = r.id and substituida_em is null and not confere and resolvida_em is null
     and (case when p_retorno is null then etapa = 'envio' else retorno_id = p_retorno end);
  if not found then raise exception 'Não há contestação em aberto nesta etapa.'; end if;
  if length(v_nota) < 3 then raise exception 'Escreva o que foi decidido (ex.: recontamos juntos, eram 88).'; end if;
  update fab.remessa_confirmacoes set resolvida_em = now(), resolvida_por = u.id, resolvida_por_nome = u.nome, resolucao = left(v_nota, 300) where id = c.id;
  perform fab.registrar(u.empresa_id, u.id, u.nome, 'contestacao_resolvida', 'remessas',
    jsonb_build_object('remessa', r.numero, 'etapa', c.etapa, 'nota', left(v_nota, 300)));
end $$;

-- ---------------------------------------------------------------- limite de perda: só administrador
do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_salvar_limite_perda(numeric)'::regprocedure) into src;
  src := replace(src, 'declare u fab.perfis := fab.exige_admin();', 'declare u fab.perfis := fab.exige_admin_real();   -- quem é vigiado pelos avisos não pode desligá-los');
  if position('exige_admin_real' in src) = 0 then raise exception 'fab_salvar_limite_perda: trecho não encontrado'; end if;
  execute src;
end $$;

insert into fab.rotas (fn, funcoes) values ('fab_resolver_contestacao', array['remessas'])
on conflict (fn) do update set funcoes = excluded.funcoes;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'fab_resolver_contestacao'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
