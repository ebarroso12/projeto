-- Fábrica · permissões e endurecimento (vale para todas as funções criadas até aqui)
--  * search_path vazio em TODA função dos schemas fab e public criadas pelo sistema;
--  * EXECUTE fechado por padrão e aberto só para quem precisa:
--      anon          -> links "só ver" (4 funções)
--      service_role  -> apoio à função de borda (criar empresa/perfil, achar login, contar perfis)
--      authenticated -> o resto (cada função confere sessão, empresa e perfil por dentro).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'fab'
  loop execute format('alter function %s set search_path = ''''', f.sig); end loop;

  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fab\_%' or p.proname like 'fin\_%' or p.proname like 'dre\_%')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon')          then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;

    if f.proname in ('fab_criar_empresa', 'fab_apagar_empresa_vazia', 'fab_criar_perfil', 'fab_id_por_login', 'fab_total_perfis', 'fab_tornar_dono') then
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
    elsif f.proname in ('fab_validar_chave', 'fab_boot_chave', 'fab_painel_chave', 'fab_relatorio_chave') then
      if exists (select 1 from pg_roles where rolname = 'anon')          then execute format('grant execute on function %s to anon', f.sig); end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    else
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    end if;
  end loop;

  revoke all on all tables in schema fab from public;
  if exists (select 1 from pg_roles where rolname = 'anon')          then revoke all on all tables in schema fab from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all tables in schema fab from authenticated; end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'fab_fechar_pendentes';
    perform cron.schedule('fab_fechar_pendentes', '7 * * * *', 'select fab.fechar_pendentes()');
  end if;
end $$;
