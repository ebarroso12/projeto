-- Fábrica · API (funções chamadas pelo app via supabase.rpc)
--
-- Todas são "security definer" com search_path vazio: rodam com os direitos do dono do banco,
-- mas só depois de checar quem chamou (auth.uid()) e o perfil. As tabelas nunca são acessadas direto.
-- Erros de negócio viram "raise exception 'mensagem'"; "SESSAO" e "WIFI" são códigos que o app trata à parte.

-- ---------- ponto ----------
create function public.fab_bater_ponto(p_tipo text) returns text
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; cfg fab.configuracao; v_agora time; v_hoje date;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);
  select * into cfg from fab.configuracao;
  v_hoje := fab.hoje(); v_agora := fab.agora();

  if p_tipo = 'entrada' then
    begin
      insert into fab.ponto (user_id, dia, entrada) values (u.id, v_hoje, v_agora);
    exception when unique_violation then
      raise exception 'Entrada já marcada hoje.';
    end;
  elsif p_tipo = 'saida' then
    update fab.ponto
       set saida = v_agora, extra_min = greatest(fab.min_de(v_agora) - fab.min_de(cfg.hora_fim), 0)
     where user_id = u.id and dia = v_hoje and saida is null;
    if not found then raise exception 'Marque a entrada primeiro.'; end if;
  else
    raise exception 'Tipo de ponto inválido.';
  end if;
  return fab.hm(v_agora);
end $$;

create function public.fab_status_rede() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return fab.rede_liberada(fab.eu());
end $$;

-- ---------- carga inicial, painel, relatório ----------
create function public.fab_boot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);
  return fab.montar_boot(u, false);
end $$;

create function public.fab_painel() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);
  return fab.montar_painel();
end $$;

create function public.fab_relatorio(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);
  return fab.montar_relatorio(p_ini, p_fim);
end $$;

-- ---------- lançamentos ----------
create function public.fab_lancar(p_etapa text, p_modelo text, p_cor text, p_obs text, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis; v_etapa fab.etapa; v_ant fab.etapa; v_etapas fab.etapa[];
  it jsonb; v_tam text; v_qtd integer; v_total integer := 0;
  v_atual integer; v_prev integer; v_avisos jsonb := '[]'::jsonb;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);

  if p_etapa is null or not (p_etapa = any (enum_range(null::fab.etapa)::text[])) then
    raise exception 'Etapa inválida.';
  end if;
  v_etapa := p_etapa::fab.etapa;
  if u.perfil <> 'admin' and fab.etapa_do_setor(u.setor) is distinct from v_etapa then
    raise exception 'Seu setor não lança esta etapa.';
  end if;
  if not exists (select 1 from fab.itens_lista where tipo = 'modelo' and nome = p_modelo) then
    raise exception 'Modelo inválido.';
  end if;
  if not exists (select 1 from fab.itens_lista where tipo = 'cor' and nome = p_cor) then
    raise exception 'Cor inválida.';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) not between 1 and 30 then
    raise exception 'Informe a quantidade em pelo menos um tamanho.';
  end if;

  v_etapas := enum_range(null, v_etapa);
  if array_length(v_etapas, 1) > 1 then v_ant := v_etapas[array_length(v_etapas, 1) - 1]; end if;

  for it in select * from jsonb_array_elements(p_itens) loop
    v_tam := it ->> 'tamanho';
    if (it ->> 'qtd') is null or (it ->> 'qtd') !~ '^[0-9]{1,6}$' then raise exception 'Quantidade inválida.'; end if;
    v_qtd := (it ->> 'qtd')::integer;
    if v_qtd = 0 then continue; end if;
    if not exists (select 1 from fab.itens_lista where tipo = 'tamanho' and nome = v_tam) then
      raise exception 'Tamanho inválido: %', coalesce(v_tam, '?');
    end if;

    insert into fab.lancamentos (user_id, etapa, modelo, cor, tamanho, qtd, obs, dia)
    values (u.id, v_etapa, p_modelo, p_cor, v_tam, v_qtd, coalesce(left(p_obs, 200), ''), fab.hoje());
    v_total := v_total + v_qtd;

    if v_ant is not null then
      select coalesce(sum(l.qtd) filter (where l.etapa = v_etapa), 0), coalesce(sum(l.qtd) filter (where l.etapa = v_ant), 0)
        into v_atual, v_prev
        from fab.lancamentos l
       where l.apagado_em is null and l.modelo = p_modelo and l.cor = p_cor and l.tamanho = v_tam;
      if v_atual > v_prev then
        v_avisos := v_avisos || to_jsonb(v_tam || ': lançou mais do que a etapa anterior entregou (' || v_atual || ' contra ' || v_prev || ').');
      end if;
    end if;
  end loop;

  if v_total = 0 then raise exception 'Informe a quantidade em pelo menos um tamanho.'; end if;
  return jsonb_build_object('total', v_total, 'avisos', v_avisos);
end $$;

create function public.fab_editar_lancamento(p_id uuid, p_qtd integer) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; l fab.lancamentos;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);
  select * into l from fab.lancamentos where id = p_id and apagado_em is null for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if u.perfil <> 'admin' and (l.user_id <> u.id or l.dia <> fab.hoje()) then
    raise exception 'Você só pode editar os seus lançamentos de hoje.';
  end if;
  if p_qtd is null or p_qtd < 0 or p_qtd > 100000 then raise exception 'Quantidade inválida.'; end if;
  if p_qtd = l.qtd then return; end if;

  update fab.lancamentos
     set qtd = p_qtd, edicoes = edicoes + 1,
         historico = case when historico = '' then '' else historico || '; ' end
                     || to_char(now() at time zone fab.fuso(), 'HH24:MI') || ' ' || l.qtd || '→' || p_qtd
   where id = p_id;
  insert into fab.lancamento_log (lancamento_id, user_id, acao, antes, depois) values (p_id, u.id, 'editar', l.qtd, p_qtd);
end $$;

create function public.fab_apagar_lancamento(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; l fab.lancamentos;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);
  select * into l from fab.lancamentos where id = p_id and apagado_em is null for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if u.perfil <> 'admin' and (l.user_id <> u.id or l.dia <> fab.hoje()) then
    raise exception 'Você só pode apagar os seus lançamentos de hoje.';
  end if;
  update fab.lancamentos set apagado_em = now() where id = p_id;       -- nunca apaga de verdade
  insert into fab.lancamento_log (lancamento_id, user_id, acao, antes, depois) values (p_id, u.id, 'apagar', l.qtd, null);
end $$;

-- ---------- itens em falta ----------
create function public.fab_add_em_falta(p_modelo text, p_cor text, p_tamanho text, p_qtd integer, p_obs text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);
  if u.perfil <> 'admin' and not u.pode_falta then raise exception 'Sem permissão para colocar item em falta.'; end if;
  if p_modelo is null or btrim(p_modelo) = '' then raise exception 'Escolha o modelo.'; end if;
  if coalesce(p_qtd, 0) < 0 or coalesce(p_qtd, 0) > 100000 then raise exception 'Quantidade inválida.'; end if;
  insert into fab.em_falta (modelo, cor, tamanho, qtd, obs, criado_por)
  values (btrim(p_modelo), coalesce(btrim(p_cor), ''), case when p_tamanho = 'Todos' then '' else coalesce(btrim(p_tamanho), '') end,
          coalesce(p_qtd, 0), coalesce(left(p_obs, 200), ''), u.id);
  return fab.em_falta_json();
end $$;

create function public.fab_status_em_falta(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);
  if p_status = 'Feito' then
    if u.perfil <> 'admin' then raise exception 'Apenas o administrador dá baixa no item.'; end if;
    update fab.em_falta set status = 'Feito', concluido_em = now() where id = p_id and status <> 'Feito';
  elsif p_status = 'Em produção' then
    update fab.em_falta set status = 'Em produção' where id = p_id and status = 'Urgente';
  else
    raise exception 'Situação inválida.';
  end if;
  return fab.em_falta_json();
end $$;

-- ---------- cadastros (administrador) ----------
create function public.fab_listar_usuarios() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.exige_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'login', pf.login, 'nome', pf.nome, 'setor', pf.setor, 'perfil', pf.perfil,
            'ativo', case when pf.ativo then 'Sim' else 'Não' end,
            'podeFalta', case when pf.pode_falta then 'Sim' else 'Não' end,
            'senha', '', 'link', '') order by pf.nome), '[]'::jsonb)
          from fab.perfis pf);
end $$;

create function public.fab_atualizar_perfil(
  p_login text, p_nome text, p_setor text, p_perfil text, p_ativo boolean, p_pode_falta boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; alvo fab.perfis;
begin
  u := fab.exige_admin();
  select * into alvo from fab.perfis where login = lower(p_login) for update;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if p_perfil not in ('admin', 'funcionario') then raise exception 'Perfil inválido.'; end if;
  if p_nome is null or btrim(p_nome) = '' then raise exception 'Preencha o nome.'; end if;

  -- sempre sobra pelo menos um administrador ativo
  if alvo.perfil = 'admin' and alvo.ativo and (p_perfil <> 'admin' or not p_ativo)
     and (select count(*) from fab.perfis where perfil = 'admin' and ativo) <= 1 then
    raise exception 'Precisa existir pelo menos um administrador ativo.';
  end if;

  update fab.perfis
     set nome = btrim(p_nome), setor = coalesce(nullif(btrim(p_setor), ''), 'Outra'),
         perfil = p_perfil::fab.perfil, ativo = p_ativo, pode_falta = p_pode_falta
   where id = alvo.id;
end $$;

-- Só a função de borda (service_role) cria perfis: ela é quem cria o usuário no Supabase Auth.
create function public.fab_criar_perfil(
  p_id uuid, p_login text, p_nome text, p_setor text, p_perfil text, p_pode_falta boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into fab.perfis (id, login, nome, setor, perfil, pode_falta)
  values (p_id, lower(btrim(p_login)), btrim(p_nome), coalesce(nullif(btrim(p_setor), ''), 'Outra'),
          p_perfil::fab.perfil, coalesce(p_pode_falta, false));
exception when unique_violation then
  raise exception 'Esse login já existe.';
end $$;

create function public.fab_salvar_lista(p_nome text, p_valores text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_tipo text; v_lista text[];
begin
  u := fab.exige_admin();
  v_tipo := case p_nome when 'Modelos' then 'modelo' when 'Cores' then 'cor' when 'Tamanhos' then 'tamanho' end;
  if v_tipo is null then raise exception 'Lista inválida.'; end if;

  select coalesce(array_agg(t.nome order by t.primeira), '{}') into v_lista
    from (select btrim(x) as nome, min(ord) as primeira
            from unnest(coalesce(p_valores, '{}')) with ordinality as a(x, ord)
           where btrim(x) <> '' group by btrim(x)) t;
  if coalesce(array_length(v_lista, 1), 0) > 200 then raise exception 'Lista grande demais (máximo 200).'; end if;
  if exists (select 1 from unnest(v_lista) n where length(n) > 60) then raise exception 'Cada item pode ter até 60 letras.'; end if;

  delete from fab.itens_lista where tipo = v_tipo and nome <> all (v_lista);
  insert into fab.itens_lista (tipo, nome, ordem)
  select v_tipo, n, ord::integer from unnest(v_lista) with ordinality as a(n, ord)
  on conflict (tipo, nome) do update set ordem = excluded.ordem;
  return fab.lista_json(v_tipo);
end $$;

-- ---------- Wi-Fi ----------
create function public.fab_ver_wifi() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.exige_admin();
  return jsonb_build_object(
    'exigir', (select exigir_wifi from fab.configuracao),
    'ips', (select coalesce(jsonb_agg(jsonb_build_object(
              'nome', r.nome, 'ip', r.ip, 'em', to_char(r.criado_em at time zone fab.fuso(), 'YYYY-MM-DD"T"HH24:MI'))
              order by r.criado_em), '[]'::jsonb) from fab.redes r));
end $$;

-- p_manter: IPs que continuam cadastrados (os demais são removidos).
create function public.fab_salvar_wifi(p_exigir boolean, p_manter text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.exige_admin();
  update fab.configuracao set exigir_wifi = coalesce(p_exigir, false);
  delete from fab.redes where ip <> all (coalesce(p_manter, '{}'));
  return public.fab_ver_wifi();
end $$;

-- Usa o IP que o SERVIDOR enxerga: quem cadastra precisa estar de fato no Wi-Fi da fábrica.
create function public.fab_cadastrar_rede_atual(p_nome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_ip text;
begin
  u := fab.exige_admin();
  v_ip := fab.ip_cliente();
  if v_ip is null then raise exception 'Não consegui identificar a rede.'; end if;
  insert into fab.redes (nome, ip) values (coalesce(nullif(btrim(p_nome), ''), 'Wi-Fi da fábrica'), v_ip)
  on conflict (ip) do update set nome = excluded.nome;
  return public.fab_ver_wifi();
end $$;

-- ---------- links de acompanhamento ("só ver") ----------
create function fab.chave_valida(p_chave text) returns boolean language sql stable as $$
  select p_chave is not null and length(p_chave) >= 16 and exists (
    select 1 from fab.chaves_acesso c
     where c.ativo and c.chave_hash = encode(sha256(convert_to(p_chave, 'UTF8')), 'hex'))
$$;

create function public.fab_validar_chave(p_chave text) returns boolean
language sql stable security definer set search_path = '' as $$
  select fab.chave_valida(p_chave)
$$;

create function public.fab_boot_chave(p_chave text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not fab.chave_valida(p_chave) then raise exception 'Link de acesso inválido.'; end if;
  return fab.montar_boot(null, true);
end $$;

create function public.fab_painel_chave(p_chave text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not fab.chave_valida(p_chave) then raise exception 'Link de acesso inválido.'; end if;
  return fab.montar_painel();
end $$;

create function public.fab_relatorio_chave(p_chave text, p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not fab.chave_valida(p_chave) then raise exception 'Link de acesso inválido.'; end if;
  return fab.montar_relatorio(p_ini, p_fim);
end $$;

-- Devolve a chave UMA vez; no banco fica só o hash.
create function public.fab_criar_chave(p_nome text) returns text
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_chave text;
begin
  u := fab.exige_admin();
  v_chave := replace(gen_random_uuid()::text, '-', '');
  insert into fab.chaves_acesso (nome, chave_hash)
  values (coalesce(nullif(btrim(p_nome), ''), 'Acompanhamento'), encode(sha256(convert_to(v_chave, 'UTF8')), 'hex'));
  return v_chave;
end $$;

create function public.fab_revogar_chaves() returns integer
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; n integer;
begin
  u := fab.exige_admin();
  update fab.chaves_acesso set ativo = false where ativo;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- permissões de execução ----------
-- Por padrão o Supabase libera EXECUTE para anon e authenticated em tudo que nasce no schema public.
-- Aqui fechamos tudo e abrimos só o necessário.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'fab\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon')          then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;

    if f.proname = 'fab_criar_perfil' then
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
    elsif f.proname in ('fab_validar_chave', 'fab_boot_chave', 'fab_painel_chave', 'fab_relatorio_chave') then
      if exists (select 1 from pg_roles where rolname = 'anon')          then execute format('grant execute on function %s to anon', f.sig); end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    else
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    end if;
  end loop;
end $$;
