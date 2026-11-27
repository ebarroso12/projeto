-- =====================================================================
-- Correções de segurança das funções por pessoa (revisão de código):
--  1) quem recebe "Cadastros" sem ser admin não vira admin, não cria admin e não mexe em admins;
--  2) nunca fica sem um administrador ativo com Cadastros e Acessos (ninguém tranca a empresa);
--  3) cópia de segurança e atividade respeitam Financeiro/Resultado desligados;
--  4) o responsável principal do sistema (dono original) não pode ser removido nem alterado por outros;
--  5) quem recebe "Acessos" sem ser admin não bloqueia nem derruba administradores;
--  6) salvar funções mescla com o que já existia (o que não veio não é zerado).
-- =====================================================================

-- ---------------------------------------------------------------- dono principal
alter table fab.donos add column principal boolean not null default false;
update fab.donos set principal = true;   -- os donos que já existem são os responsáveis originais

create function fab.dono_principal(p_user uuid) returns boolean language sql stable set search_path = '' as
$$ select exists (select 1 from fab.donos where user_id = p_user and principal) $$;

create or replace function public.fab_tornar_dono(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  insert into fab.donos (user_id, principal) values (p_user, true) on conflict (user_id) do update set principal = true
$$;

-- ---------------------------------------------------------------- guardas
-- Depois de qualquer mudança: precisa sobrar um administrador ativo que use Cadastros e Acessos.
create function fab.garante_admin_gestor(p_emp uuid) returns void language plpgsql stable set search_path = '' as $$
begin
  if not exists (select 1 from fab.perfis p where p.empresa_id = p_emp and p.ativo and p.perfil = 'admin'
                  and fab.pode(p, 'cadastros') and fab.pode(p, 'acessos')) then
    raise exception 'Precisa existir pelo menos um administrador ativo com Cadastros e Acessos.';
  end if;
end $$;

-- Quem pode agir sobre a conta de outra pessoa
create function fab.pode_agir_sobre(u fab.perfis, alvo fab.perfis) returns void language plpgsql stable set search_path = '' as $$
begin
  if alvo.id <> u.id and alvo.perfil = 'admin' and u.perfil <> 'admin' then
    raise exception 'Só um administrador pode fazer isto com outro administrador.';
  end if;
  if alvo.id <> u.id and fab.dono_principal(alvo.id) and not fab.dono_principal(u.id) then
    raise exception 'Só o responsável pelo sistema pode fazer isto com a conta dele.';
  end if;
end $$;

-- Gestão de funções é só de administrador de verdade (não basta ter "Cadastros" liberado)
create function fab.exige_admin_real() returns fab.perfis language plpgsql stable set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  if u.perfil <> 'admin' then raise exception 'Apenas o administrador pode fazer isto.'; end if;
  return u;
end $$;

-- ---------------------------------------------------------------- cadastros
create or replace function public.fab_atualizar_perfil(
  p_login text, p_nome text, p_setor text, p_perfil text, p_ativo boolean, p_pode_falta boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; alvo fab.perfis;
begin
  u := fab.exige_admin();
  select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_login)) for update;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if p_perfil not in ('admin', 'funcionario') then raise exception 'Perfil inválido.'; end if;
  if p_nome is null or btrim(p_nome) = '' then raise exception 'Preencha o nome.'; end if;
  perform fab.pode_agir_sobre(u, alvo);
  if u.perfil <> 'admin' and p_perfil = 'admin' then raise exception 'Só um administrador pode tornar alguém administrador.'; end if;
  if alvo.id = u.id and (p_perfil <> 'admin' or not p_ativo) and u.perfil = 'admin' then
    raise exception 'Você não pode desativar nem rebaixar a sua própria conta.';
  end if;
  if alvo.perfil = 'admin' and alvo.ativo and (p_perfil <> 'admin' or not p_ativo)
     and (select count(*) from fab.perfis where empresa_id = u.empresa_id and perfil = 'admin' and ativo) <= 1 then
    raise exception 'Precisa existir pelo menos um administrador ativo.';
  end if;
  update fab.perfis
     set nome = btrim(p_nome), setor = coalesce(nullif(btrim(p_setor), ''), 'Outra'),
         perfil = p_perfil::fab.perfil, ativo = p_ativo, pode_falta = p_pode_falta
   where id = alvo.id;
  perform fab.garante_admin_gestor(u.empresa_id);
end $$;

-- função de borda: sabe se quem chama é admin (para criar admin / trocar senha de admin)
create or replace function public.fab_minha_empresa() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.exige_admin();
  return (select jsonb_build_object('id', e.id, 'codigo', e.codigo, 'eu', u.id, 'admin', u.perfil = 'admin', 'principal', fab.dono_principal(u.id))
            from fab.empresas e where e.id = u.empresa_id);
end $$;

create function public.fab_perfil_por_login(p_empresa uuid, p_login text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'perfil', p.perfil::text, 'principal', fab.dono_principal(p.id))
    from fab.perfis p where p.empresa_id = p_empresa and p.login = lower(btrim(p_login))
$$;

-- ---------------------------------------------------------------- funções por pessoa
create or replace function public.fab_funcoes_pessoa(p_login text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin_real(); alvo fab.perfis;
begin
  select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_login));
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  return jsonb_build_object(
    'nome', alvo.nome, 'perfil', alvo.perfil::text, 'eu', alvo.id = u.id,
    'protegido', alvo.id <> u.id and fab.dono_principal(alvo.id) and not fab.dono_principal(u.id),
    'possoEmpresas', fab.dono_principal(u.id),
    'funcoes', fab.funcoes_json(alvo),
    'padrao', (select jsonb_object_agg(f, case when f = 'empresas' then false else fab.funcao_padrao(alvo, f) end) from unnest(fab.lista_funcoes()) f));
end $$;

create or replace function public.fab_salvar_funcoes(p_login text, p_funcoes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin_real(); alvo fab.perfis; novo jsonb; f text; v boolean;
begin
  select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_login)) for update;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if alvo.id = u.id then raise exception 'Você não pode mudar as suas próprias funções.'; end if;
  perform fab.pode_agir_sobre(u, alvo);
  novo := coalesce(alvo.funcoes, '{}'::jsonb);               -- mescla: o que não veio continua como estava
  foreach f in array fab.lista_funcoes() loop
    if f = 'empresas' or not (p_funcoes ? f) then continue; end if;
    v := (p_funcoes ->> f)::boolean;
    novo := novo - f;
    if v is distinct from fab.funcao_padrao(alvo, f) then novo := novo || jsonb_build_object(f, v); end if;
  end loop;
  update fab.perfis set funcoes = novo where id = alvo.id;
  -- Empresas (gestão do sistema): só o responsável principal libera/retira; o principal nunca é removido
  if p_funcoes ? 'empresas' and fab.dono_principal(u.id) and not fab.dono_principal(alvo.id) then
    if (p_funcoes ->> 'empresas')::boolean then
      insert into fab.donos (user_id) values (alvo.id) on conflict do nothing;
    else
      delete from fab.donos where user_id = alvo.id and not principal;
    end if;
  end if;
  perform fab.garante_admin_gestor(u.empresa_id);
  perform fab.registrar(u.empresa_id, u.id, u.nome, 'funcoes_alteradas', alvo.nome,
    jsonb_build_object('funcoes', fab.funcoes_json((select p from fab.perfis p where p.id = alvo.id))));
end $$;

-- ---------------------------------------------------------------- acessos: não-admin não age sobre admin
create or replace function public.fab_bloquear_pessoa(p_login text, p_bloquear boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); alvo fab.perfis;
begin
  select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_login)) for update;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if alvo.id = u.id then raise exception 'Você não pode bloquear a sua própria conta.'; end if;
  perform fab.pode_agir_sobre(u, alvo);
  if p_bloquear and alvo.perfil = 'admin' and alvo.ativo
     and (select count(*) from fab.perfis where empresa_id = u.empresa_id and perfil = 'admin' and ativo) <= 1 then
    raise exception 'Precisa existir pelo menos um administrador ativo.';
  end if;
  update fab.perfis set ativo = not p_bloquear where id = alvo.id;
  if p_bloquear then
    update fab.sessoes set status = 'encerrada' where user_id = alvo.id and status in ('aprovada', 'pendente');
  end if;
  perform fab.garante_admin_gestor(u.empresa_id);
  perform fab.registrar(u.empresa_id, u.id, u.nome, case when p_bloquear then 'pessoa_bloqueada' else 'pessoa_desbloqueada' end, alvo.nome, '{}'::jsonb);
end $$;

create or replace function public.fab_encerrar_sessao(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); s fab.sessoes; alvo fab.perfis;
begin
  select * into s from fab.sessoes where id = p_id and empresa_id = u.empresa_id and status in ('aprovada', 'pendente') for update;
  if not found then raise exception 'Essa sessão já foi encerrada.'; end if;
  select * into alvo from fab.perfis where id = s.user_id;
  perform fab.pode_agir_sobre(u, alvo);
  update fab.sessoes set status = 'encerrada' where id = s.id;
  perform fab.registrar(u.empresa_id, u.id, u.nome, 'sessao_encerrada', alvo.nome, jsonb_build_object('aparelho', s.descricao));
end $$;

create or replace function public.fab_revogar_aparelho(p_login text, p_aparelho text) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); alvo fab.perfis;
begin
  select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_login));
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  perform fab.pode_agir_sobre(u, alvo);
  delete from fab.aparelhos_confiaveis a where a.user_id = alvo.id and a.empresa_id = u.empresa_id and a.aparelho = p_aparelho;
  perform fab.registrar(u.empresa_id, u.id, u.nome, 'aparelho_revogado', p_login, '{}'::jsonb);
end $$;

create or replace function public.fab_decidir_acesso(p_id uuid, p_liberar boolean, p_confiar boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); s fab.sessoes; alvo fab.perfis;
begin
  select * into s from fab.sessoes where id = p_id and empresa_id = u.empresa_id and status = 'pendente' for update;
  if not found then raise exception 'Esse pedido já foi respondido ou expirou.'; end if;
  select * into alvo from fab.perfis where id = s.user_id;
  perform fab.pode_agir_sobre(u, alvo);
  update fab.sessoes set status = case when p_liberar then 'aprovada' else 'negada' end, decidido_por = u.id, decidido_em = now()
   where id = s.id returning * into s;
  if p_liberar and coalesce(p_confiar, false) and length(s.aparelho) >= 16 then
    insert into fab.aparelhos_confiaveis (empresa_id, user_id, aparelho, descricao, criado_por)
    values (s.empresa_id, s.user_id, s.aparelho, s.descricao, u.id) on conflict do nothing;
  end if;
  perform fab.registrar(u.empresa_id, u.id, u.nome, case when p_liberar then 'acesso_liberado' else 'acesso_negado' end,
    alvo.nome, jsonb_build_object('aparelho', s.descricao, 'ip', s.ip, 'confiar', coalesce(p_confiar, false)));
end $$;

-- ---------------------------------------------------------------- dados financeiros só para quem pode
-- evento sobre tabela do Financeiro/Resultado: só aparece para quem tem essa função
create function fab.evento_visivel(u fab.perfis, p_alvo text) returns boolean language sql stable set search_path = '' as $$
  select case when p_alvo like 'fin\_%' then fab.pode(u, 'financeiro')
              when p_alvo like 'dre\_%' then fab.pode(u, 'resultado')
              else true end
$$;

create or replace function public.fab_exportar() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis; t record; linhas jsonb; saida jsonb;
  ver_fin boolean; ver_dre boolean;
begin
  u := fab.exige_admin();
  ver_fin := fab.pode(u, 'financeiro'); ver_dre := fab.pode(u, 'resultado');
  saida := jsonb_build_object(
    'formato', 'fabrica-backup-1',
    'geradoEm', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'empresa', (select to_jsonb(e) - 'motivo_bloqueio' from fab.empresas e where e.id = u.empresa_id),
    'parcial', not (ver_fin and ver_dre),
    'tabelas', '{}'::jsonb);
  for t in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'fab' and c.column_name = 'empresa_id'
       and c.table_name not in ('chaves_acesso')
       and (ver_fin or c.table_name not like 'fin\_%')
       and (ver_dre or c.table_name not like 'dre\_%')
     order by c.table_name
  loop
    if t.table_name = 'eventos' then
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into linhas from fab.eventos x
       where x.empresa_id = u.empresa_id and fab.evento_visivel(u, x.alvo);
    else
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from fab.%I x where x.empresa_id = $1', t.table_name)
        into linhas using u.empresa_id;
    end if;
    saida := jsonb_set(saida, array['tabelas', t.table_name], linhas);
  end loop;
  return saida;
end $$;

-- Atividade (Acessos): mesma regra para os eventos do Financeiro/Resultado
do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_acessos(date, date)'::regprocedure) into src;
  src := replace(src, 'select * from fab.eventos v where v.empresa_id = e and v.em >= ini and v.em < fim',
                      'select * from fab.eventos v where v.empresa_id = e and v.em >= ini and v.em < fim and fab.evento_visivel(u, v.alvo)');
  if position('fab.evento_visivel' in src) = 0 then raise exception 'não achei o trecho de eventos em fab_acessos'; end if;
  execute src;
end $$;

-- ---------------------------------------------------------------- permissões
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_tornar_dono', 'fab_perfil_por_login', 'fab_minha_empresa', 'fab_funcoes_pessoa',
              'fab_salvar_funcoes', 'fab_atualizar_perfil', 'fab_bloquear_pessoa', 'fab_encerrar_sessao', 'fab_revogar_aparelho',
              'fab_decidir_acesso', 'fab_exportar', 'fab_acessos')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if f.proname in ('fab_tornar_dono', 'fab_perfil_por_login') then
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
    else
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    end if;
  end loop;
end $$;
