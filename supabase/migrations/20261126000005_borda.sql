-- Fábrica · apoio à função de borda "usuarios" (só service_role)
-- A criação de usuários precisa da API administrativa do Supabase Auth, que só roda no servidor.

create function public.fab_id_por_login(p_login text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from fab.perfis where login = lower(btrim(p_login))
$$;

create function public.fab_total_perfis() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from fab.perfis
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_id_por_login', 'fab_total_perfis')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon')          then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role')  then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;
