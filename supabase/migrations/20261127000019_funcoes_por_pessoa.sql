-- =====================================================================
-- Funções por pessoa: o administrador libera ou bloqueia cada parte do sistema para cada usuário.
--  * Padrão: funcionário usa Lançar, Ponto e Em falta; administrador usa tudo (menos Empresas).
--  * perfis.funcoes guarda só as EXCEÇÕES (ex.: {"financeiro": true} para um funcionário de confiança,
--    {"acessos": false} para um administrador).
--  * "Empresas" (gestão do sistema) é do dono; o dono pode liberar para pessoas da própria empresa
--    (viram co-responsáveis em fab.donos).
--  * Conferido no servidor: cada chamada da API (request.path = /rpc/<função>) é ligada a uma função do
--    sistema; fab.eu() recusa se a pessoa não tem essa função, e fab.exige_admin() aceita não-admin
--    quando a função foi liberada para ele.
-- =====================================================================

alter table fab.perfis add column funcoes jsonb not null default '{}'::jsonb;

create function fab.lista_funcoes() returns text[] language sql immutable set search_path = '' as
$$ select array['painel', 'dashboard', 'relatorio', 'falta', 'lancar', 'ponto', 'financeiro', 'resultado', 'cadastros', 'acessos', 'empresas'] $$;

create function fab.funcao_padrao(p fab.perfis, f text) returns boolean language sql stable set search_path = '' as $$
  select case when f in ('lancar', 'ponto', 'falta') then true
              when f = 'empresas' then exists (select 1 from fab.donos where user_id = p.id)
              else p.perfil = 'admin' end
$$;

create function fab.pode(p fab.perfis, f text) returns boolean language sql stable set search_path = '' as $$
  select case when f = 'empresas' then exists (select 1 from fab.donos where user_id = p.id)
              else coalesce((p.funcoes ->> f)::boolean, fab.funcao_padrao(p, f)) end
$$;

create function fab.funcoes_json(p fab.perfis) returns jsonb language sql stable set search_path = '' as
$$ select jsonb_object_agg(f, fab.pode(p, f)) from unnest(fab.lista_funcoes()) f $$;

-- Qual função do sistema a chamada atual pertence (null = livre, ex.: boot, trocar senha, presença)
create function fab.funcoes_da_rota() returns text[] language sql stable set search_path = '' as $$
  select case
    when fn = 'fab_painel' then array['painel']
    when fn = 'fab_relatorio' then array['relatorio', 'dashboard']
    when fn in ('fab_lancar', 'fab_editar_lancamento', 'fab_apagar_lancamento') then array['lancar']
    when fn in ('fab_bater_ponto', 'fab_status_rede') then array['ponto']
    when fn in ('fab_add_em_falta', 'fab_status_em_falta') then array['falta']
    when fn like 'fin\_%' then array['financeiro']
    when fn like 'dre\_%' then array['resultado']
    when fn in ('fab_listar_usuarios', 'fab_atualizar_perfil', 'fab_salvar_lista', 'fab_criar_chave', 'fab_revogar_chaves', 'fab_exportar',
                'fab_ver_wifi', 'fab_salvar_wifi', 'fab_cadastrar_rede_atual', 'fab_minha_empresa', 'fab_salvar_funcoes', 'fab_funcoes_pessoa') then array['cadastros']
    when fn in ('fab_acessos', 'fab_acessos_pendentes', 'fab_decidir_acesso', 'fab_encerrar_sessao', 'fab_revogar_aparelho',
                'fab_config_acesso', 'fab_bloquear_pessoa') then array['acessos']
    else null end
  from (select substring(coalesce(current_setting('request.path', true), '') from '/rpc/([a-z_]+)') as fn) x
$$;

create or replace function fab.eu() returns fab.perfis language plpgsql stable set search_path = '' as $$
declare u fab.perfis; st text; r text[];
begin
  if auth.uid() is null then raise exception 'SESSAO'; end if;
  select * into u from fab.perfis where id = auth.uid() and ativo;
  if not found then raise exception 'SESSAO'; end if;
  perform fab.empresa_ativa(u.empresa_id);
  select s.status into st from fab.sessoes s where s.session_id = fab.sessao_atual() and s.user_id = u.id;
  if st = 'negada' then raise exception 'ACESSO_NEGADO'; end if;
  if st = 'encerrada' then raise exception 'SESSAO'; end if;
  if u.perfil <> 'admin' and fab.exige_liberacao(u.empresa_id) and st is distinct from 'aprovada' then
    raise exception 'ACESSO_PENDENTE';
  end if;
  r := fab.funcoes_da_rota();
  if r is not null and not exists (select 1 from unnest(r) f where fab.pode(u, f)) then
    raise exception 'FUNCAO_BLOQUEADA';
  end if;
  return u;
end $$;

create or replace function fab.exige_admin() returns fab.perfis language plpgsql stable set search_path = '' as $$
declare u fab.perfis; r text[];
begin
  u := fab.eu();
  if u.perfil <> 'admin' then
    r := fab.funcoes_da_rota();   -- não-admin só passa quando a função desta chamada foi liberada para ele
    if r is null or not exists (select 1 from unnest(r) f where (u.funcoes ->> f)::boolean is true) then
      raise exception 'Apenas o administrador pode fazer isto.';
    end if;
  end if;
  return u;
end $$;

-- boot: o app recebe as funções liberadas da pessoa
create or replace function public.fab_boot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis; b jsonb;
begin
  u := fab.eu();
  perform fab.checa_wifi(u);
  b := fab.montar_boot(u.empresa_id, u, false);
  return jsonb_set(b, '{eu}', (b -> 'eu') || jsonb_build_object('funcoes', fab.funcoes_json(u), 'financeiro', fab.pode(u, 'financeiro')));
end $$;

-- Funções de uma pessoa (tela do administrador)
create function public.fab_funcoes_pessoa(p_login text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); alvo fab.perfis;
begin
  select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_login));
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  return jsonb_build_object(
    'nome', alvo.nome, 'perfil', alvo.perfil::text, 'eu', alvo.id = u.id, 'possoEmpresas', fab.sou_dono(),
    'funcoes', fab.funcoes_json(alvo),
    'padrao', (select jsonb_object_agg(f, case when f = 'empresas' then false else fab.funcao_padrao(alvo, f) end) from unnest(fab.lista_funcoes()) f));
end $$;

create function public.fab_salvar_funcoes(p_login text, p_funcoes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); alvo fab.perfis; novo jsonb := '{}'::jsonb; f text; v boolean;
begin
  select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_login)) for update;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if alvo.id = u.id then raise exception 'Você não pode mudar as suas próprias funções.'; end if;
  foreach f in array fab.lista_funcoes() loop
    if f = 'empresas' or not (p_funcoes ? f) then continue; end if;
    v := (p_funcoes ->> f)::boolean;
    if v is distinct from fab.funcao_padrao(alvo, f) then novo := novo || jsonb_build_object(f, v); end if;
  end loop;
  update fab.perfis set funcoes = novo where id = alvo.id;
  -- "Empresas" (gestão do sistema): só o dono libera, e só para pessoas da própria empresa
  if p_funcoes ? 'empresas' and fab.sou_dono() then
    if (p_funcoes ->> 'empresas')::boolean then
      insert into fab.donos (user_id) values (alvo.id) on conflict do nothing;
    else
      delete from fab.donos where user_id = alvo.id;
    end if;
  end if;
  perform fab.registrar(u.empresa_id, u.id, u.nome, 'funcoes_alteradas', alvo.nome,
    jsonb_build_object('funcoes', fab.funcoes_json((select p from fab.perfis p where p.id = alvo.id))));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_boot', 'fab_funcoes_pessoa', 'fab_salvar_funcoes')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
