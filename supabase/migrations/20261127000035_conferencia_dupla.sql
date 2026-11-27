-- =====================================================================
-- Conferência dupla das oficinas (contra perda e desvio de peças)
--
--  1) Contagem às cegas: no retorno, quem confere digita o que contou SEM ver quanto era esperado.
--     O retorno guarda "cega = true"; se a contagem passar do enviado, o erro não revela o número esperado.
--  2) Confirmação pela oficina: cada remessa ganha um link (token aleatório de 128 bits). Pelo link, sem
--     login, a costureira vê o que recebeu, o que devolveu e quanto vai receber, e CONFIRMA ou CONTESTA
--     o envio e cada retorno. Contestação gera aviso na hora para quem cuida das remessas.
--  3) Balanço e alertas: limite de perda por empresa (padrão 3%). Ao fechar uma remessa com peças
--     faltando acima do limite, ou ao registrar um corte que rendeu abaixo do esperado além do limite,
--     sai um aviso imediato (sem esperar o resumo das 8h).
-- =====================================================================

-- ---------------------------------------------------------------- comum
alter table fab.configuracao add column if not exists limite_perda numeric(5, 2) not null default 3 check (limite_perda between 0 and 100);

create or replace function fab.limite_perda(p_emp uuid) returns numeric language sql stable set search_path = '' as
$$ select coalesce((select limite_perda from fab.configuracao where empresa_id = p_emp), 3) $$;

-- quem recebe os avisos das oficinas: pessoas ativas com a função Oficinas e remessas
create or replace function fab.cuidam_remessas(p_emp uuid) returns uuid[] language sql stable set search_path = '' as
$$ select array_agg(p.id) from fab.perfis p where p.empresa_id = p_emp and p.ativo and fab.pode(p, 'remessas') $$;

create or replace function public.fab_salvar_limite_perda(p_limite numeric) returns numeric
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  if p_limite is null or p_limite < 0 or p_limite > 100 then raise exception 'Informe um limite entre 0 e 100%%.'; end if;
  insert into fab.configuracao (empresa_id, limite_perda) values (u.empresa_id, round(p_limite, 2))
  on conflict (empresa_id) do update set limite_perda = excluded.limite_perda;
  return round(p_limite, 2);
end $$;

-- ---------------------------------------------------------------- 1) contagem às cegas
alter table fab.remessa_retornos add column if not exists cega boolean not null default false;

-- retorno: {remessaId, data, obs, cega, itens: [{itemId, boas, defeito}]}
create or replace function public.fab_registrar_retorno(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis := fab.exige_admin(); r fab.remessas; v_ret uuid; v_data date; it jsonb; i fab.remessa_itens; v_b integer; v_d integer; v_ja integer; tot integer := 0;
  v_cega boolean := coalesce(p ->> 'cega', '') = 'true';
begin
  select * into r from fab.remessas where id = nullif(p ->> 'remessaId', '')::uuid and empresa_id = u.empresa_id for update;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  if r.status <> 'aberta' then raise exception 'A remessa já foi fechada. Reabra para registrar retorno.'; end if;
  begin v_data := coalesce(nullif(p ->> 'data', '')::date, fab.hoje(u.empresa_id)); exception when others then raise exception 'Data inválida.'; end;
  if v_data < r.data_envio then raise exception 'O retorno não pode ser antes do envio.'; end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' then raise exception 'Informe o que voltou.'; end if;
  insert into fab.remessa_retornos (remessa_id, empresa_id, data, obs, cega, criado_por) values (r.id, u.empresa_id, v_data, coalesce(left(p ->> 'obs', 300), ''), v_cega, u.id)
  returning id into v_ret;
  for it in select * from jsonb_array_elements(p -> 'itens') loop
    select * into i from fab.remessa_itens where id = nullif(it ->> 'itemId', '')::uuid and remessa_id = r.id;
    if not found then raise exception 'Item inválido na remessa.'; end if;
    if coalesce(it ->> 'boas', '0') !~ '^[0-9]{1,6}$' or coalesce(it ->> 'defeito', '0') !~ '^[0-9]{1,6}$' then raise exception 'Quantidade inválida.'; end if;
    v_b := coalesce(nullif(it ->> 'boas', '')::integer, 0); v_d := coalesce(nullif(it ->> 'defeito', '')::integer, 0);
    if v_b + v_d = 0 then continue; end if;
    select coalesce(sum(boas + defeito), 0) into v_ja from fab.retorno_itens where item_id = i.id;
    if v_ja + v_b + v_d > i.qtd then
      if v_cega then   -- às cegas: não revela quanto era esperado
        raise exception '% % %: a contagem passa do que foi enviado. Reconte essas peças.', i.modelo, i.cor, i.tamanho;
      end if;
      raise exception '% % %: voltaram % de % enviadas (já tinham voltado %).', i.modelo, i.cor, i.tamanho, v_ja + v_b + v_d, i.qtd, v_ja;
    end if;
    insert into fab.retorno_itens (retorno_id, item_id, boas, defeito) values (v_ret, i.id, v_b, v_d);
    if v_b > 0 then
      insert into fab.lancamentos (empresa_id, user_id, oficina_id, oficina_nome, etapa, modelo, cor, tamanho, qtd, obs, dia, origem, retorno_id, lancado_por)
      values (u.empresa_id, r.user_id, r.oficina_id, case when r.user_id is null then r.quem_nome else '' end, r.etapa::fab.etapa,
              i.modelo, i.cor, i.tamanho, v_b, 'Remessa #' || r.numero, v_data, 'retorno', v_ret, u.id);
    end if;
    tot := tot + v_b + v_d;
  end loop;
  if tot = 0 then raise exception 'Informe quantas peças voltaram (boas ou com defeito).'; end if;
  return v_ret;
end $$;

-- ---------------------------------------------------------------- 2) confirmação pela oficina
alter table fab.remessas add column if not exists token text unique check (token is null or token ~ '^[a-f0-9]{32}$');

create table if not exists fab.remessa_confirmacoes (
  id         uuid primary key default gen_random_uuid(),
  remessa_id uuid not null references fab.remessas (id) on delete cascade,
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  retorno_id uuid references fab.remessa_retornos (id) on delete cascade,   -- null = confirmação do ENVIO
  confere    boolean not null,
  itens      jsonb not null default '[]'::jsonb,   -- quando não confere: [{itemId, qtd}] contagem da oficina
  nome       text not null default '',
  obs        text not null default '',
  em         timestamptz not null default now()
);
create unique index if not exists remessa_confirmacoes_uma on fab.remessa_confirmacoes (remessa_id, coalesce(retorno_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table fab.remessa_confirmacoes enable row level security;
revoke all on fab.remessa_confirmacoes from public;

create or replace function fab.confirmacao_json(c fab.remessa_confirmacoes) returns jsonb language sql stable set search_path = '' as $$
  select case when c.id is null then null else jsonb_build_object('confere', c.confere, 'em', c.em, 'nome', c.nome, 'obs', c.obs, 'itens', c.itens) end
$$;

-- editar os itens do envio invalida a confirmação do envio (os itens são outros)
do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_salvar_remessa(jsonb)'::regprocedure) into src;
  src := replace(src, '    delete from fab.remessa_itens where remessa_id = v_id;',
                      '    delete from fab.remessa_itens where remessa_id = v_id;
    delete from fab.remessa_confirmacoes where remessa_id = v_id and retorno_id is null;');
  if position('delete from fab.remessa_confirmacoes' in src) = 0 then raise exception 'fab_salvar_remessa: trecho não encontrado'; end if;
  execute src;
end $$;

-- a auditoria não grava o link (ele dá acesso à página da oficina; a Atividade e a cópia de segurança não devem tê-lo)
do $$
declare src text;
begin
  select pg_get_functiondef('fab.auditar()'::regprocedure) into src;
  src := replace(src, '''chave_hash'', ''criado_por''', '''chave_hash'', ''token'', ''criado_por''');
  if position('''token''' in src) = 0 then raise exception 'fab.auditar: lista de campos ignorados não encontrada'; end if;
  execute src;
end $$;

-- link da remessa (cria na primeira vez; p_novo = troca o link e o antigo para de funcionar)
create or replace function public.fab_remessa_link(p_id uuid, p_novo boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); r fab.remessas; t text;
begin
  select * into r from fab.remessas where id = p_id and empresa_id = u.empresa_id for update;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  if r.token is not null and not coalesce(p_novo, false) then return r.token; end if;
  t := replace(gen_random_uuid()::text, '-', '');
  update fab.remessas set token = t where id = r.id;
  perform fab.registrar(u.empresa_id, u.id, u.nome, 'remessa_link', 'remessas', jsonb_build_object('remessa', r.numero, 'novo', r.token is not null));
  return t;
end $$;

-- remessa pelo token (sem login): só o que a oficina precisa ver — nada de observações internas nem financeiro da fábrica
create or replace function fab.remessa_por_token(p_token text) returns fab.remessas language plpgsql stable set search_path = '' as $$
declare r fab.remessas;
begin
  if coalesce(p_token, '') !~ '^[a-f0-9]{32}$' then raise exception 'LINK_INVALIDO: Link inválido. Peça um novo link para a fábrica.'; end if;
  select * into r from fab.remessas where token = p_token;
  if not found then raise exception 'LINK_INVALIDO: Este link não vale mais. Peça um novo link para a fábrica.'; end if;
  if not exists (select 1 from fab.empresas where id = r.empresa_id and ativa) then raise exception 'LINK_INVALIDO: Link indisponível no momento.'; end if;
  return r;
end $$;

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
    'confirmacaoEnvio', (select fab.confirmacao_json(c) from fab.remessa_confirmacoes c where c.remessa_id = r.id and c.retorno_id is null),
    'retornos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'data', t.data,
                            'itens', (select coalesce(jsonb_agg(jsonb_build_object('itemId', ri.item_id, 'boas', ri.boas, 'defeito', ri.defeito)), '[]'::jsonb) from fab.retorno_itens ri where ri.retorno_id = t.id),
                            'confirmacao', (select fab.confirmacao_json(c) from fab.remessa_confirmacoes c where c.retorno_id = t.id))
                          order by t.data, t.criado_em) from fab.remessa_retornos t where t.remessa_id = r.id), '[]'::jsonb));
end $$;

-- confirmação pela oficina: {retornoId (vazio = envio), confere, itens: [{itemId, qtd}], nome, obs}
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
  select * into ja from fab.remessa_confirmacoes where remessa_id = r.id and retorno_id is not distinct from v_ret;
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

  insert into fab.remessa_confirmacoes (remessa_id, empresa_id, retorno_id, confere, itens, nome, obs)
  values (r.id, r.empresa_id, v_ret, v_confere,
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

-- resumo da remessa para a fábrica: + ordemId, link, às cegas e confirmações
create or replace function fab.remessa_json(r fab.remessas) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'numero', r.numero, 'quem', r.quem_nome, 'login', (select login from fab.perfis where id = r.user_id),
    'oficinaId', r.oficina_id, 'telefone', (select telefone from fab.registros where id = r.oficina_id),
    'etapa', r.etapa, 'dataEnvio', r.data_envio, 'prazo', r.prazo, 'valorPeca', r.valor_peca, 'descontoFaltante', r.desconto_faltante,
    'ordemId', r.ordem_id, 'ordemNumero', (select numero from fab.ordens_corte where id = r.ordem_id), 'status', r.status, 'fechadaEm', r.fechada_em,
    'valorPago', r.valor_pago, 'noFinanceiro', exists (select 1 from fab.fin_lancamentos l where l.id = r.fin_lancamento_id and l.apagado_em is null),
    'obs', r.obs, 'token', r.token,
    'confirmacaoEnvio', (select fab.confirmacao_json(c) from fab.remessa_confirmacoes c where c.remessa_id = r.id and c.retorno_id is null),
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

-- limite de perda vai junto com as remessas (a aba Balanço usa)
do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_remessas(integer)'::regprocedure) into src;
  src := replace(src, '  return jsonb_build_object(
    ''remessas'',', '  return jsonb_build_object(
    ''limitePerda'', fab.limite_perda(u.empresa_id),
    ''remessas'',');
  if position('limitePerda' in src) = 0 then raise exception 'fab_remessas: trecho não encontrado'; end if;
  execute src;
end $$;

-- ---------------------------------------------------------------- 3) alertas imediatos de perda
do $$
declare src text;
begin
  -- remessa fechada com peças faltando acima do limite
  select pg_get_functiondef('public.fab_fechar_remessa(uuid, jsonb)'::regprocedure) into src;
  src := replace(src, '  update fab.remessas set status = ''fechada'', fechada_em = fab.hoje(u.empresa_id), valor_pago = v_valor, fin_lancamento_id = v_fin where id = p_id;',
    '  update fab.remessas set status = ''fechada'', fechada_em = fab.hoje(u.empresa_id), valor_pago = v_valor, fin_lancamento_id = v_fin where id = p_id;
  if v_env > 0 and v_falt > 0 and v_falt * 100.0 / v_env > fab.limite_perda(u.empresa_id) then
    perform fab.enviar_aviso(u.empresa_id, fab.cuidam_remessas(u.empresa_id), ''perda'', ''Peças faltando na remessa'',
      ''Remessa #'' || r.numero || '' ('' || r.quem_nome || '') fechou com '' || v_falt || '' de '' || v_env || '' peça(s) faltando ('' ||
      replace(round(v_falt * 100.0 / v_env, 1)::text, ''.'', '','') || ''%). Limite: '' || replace(fab.limite_perda(u.empresa_id)::text, ''.'', '','') || ''%.'', ''#/remessas'');
  end if;');
  if position('Peças faltando na remessa' in src) = 0 then raise exception 'fab_fechar_remessa: trecho não encontrado'; end if;
  execute src;

  -- corte que rendeu abaixo do esperado pela regra do tecido, além do limite
  select pg_get_functiondef('public.fab_salvar_ordem_corte(jsonb)'::regprocedure) into src;
  src := replace(src, '  return jsonb_build_object(''id'', v_id, ''numero'', v_num, ''pecas'', n);',
    '  if v_mat is not null and v_mq is not null and coalesce(fab.consumo_por_peca(v_mat, p ->> ''modelo''), 0) > 0 then
    declare esp integer := floor(v_mq / fab.consumo_por_peca(v_mat, p ->> ''modelo'') + 1e-9);
    begin
      if esp > 0 and n < esp and (esp - n) * 100.0 / esp > fab.limite_perda(u.empresa_id) then
        perform fab.enviar_aviso(u.empresa_id, fab.cuidam_remessas(u.empresa_id), ''perda'', ''Perda no corte'',
          ''Ordem de corte #'' || v_num || '' ('' || (p ->> ''modelo'') || '' '' || (p ->> ''cor'') || '', '' || q.o_nome || ''): '' || n || '' peça(s) cortadas, o tecido dava '' || esp ||
          '' (perda de '' || replace(round((esp - n) * 100.0 / esp, 1)::text, ''.'', '','') || ''%).'', ''#/remessas'');
      end if;
    end;
  end if;
  return jsonb_build_object(''id'', v_id, ''numero'', v_num, ''pecas'', n);');
  if position('Perda no corte' in src) = 0 then raise exception 'fab_salvar_ordem_corte: trecho não encontrado'; end if;
  execute src;
end $$;

-- cópia de segurança: o link da remessa dá acesso à página da oficina, então não vai no arquivo
do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_exportar()'::regprocedure) into src;
  src := replace(src, '    elsif t.table_name = ''aparelhos_confiaveis'' then',
                      '    elsif t.table_name = ''remessas'' then
      select coalesce(jsonb_agg(to_jsonb(x) - ''token''), ''[]''::jsonb) into linhas from fab.remessas x where x.empresa_id = e;
    elsif t.table_name = ''aparelhos_confiaveis'' then');
  if position('- ''token''' in src) = 0 then raise exception 'fab_exportar: trecho não encontrado'; end if;
  execute src;
end $$;

-- ---------------------------------------------------------------- rotas e permissões
insert into fab.rotas (fn, funcoes) values
  ('fab_remessa_link', array['remessas']), ('fab_salvar_limite_perda', array['remessas'])
on conflict (fn) do update set funcoes = excluded.funcoes;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_registrar_retorno', 'fab_remessa_link', 'fab_salvar_limite_perda', 'fab_remessa_publica', 'fab_remessa_confirmar')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if f.proname in ('fab_remessa_publica', 'fab_remessa_confirmar') then
      -- página da oficina: sem login (o token de 128 bits é a autorização)
      if exists (select 1 from pg_roles where rolname = 'anon') then execute format('grant execute on function %s to anon', f.sig); end if;
    elsif exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
revoke all on function fab.cuidam_remessas(uuid) from public;
