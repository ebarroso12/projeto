-- Cópia de segurança da empresa: o administrador baixa TODOS os dados da própria empresa em um arquivo JSON.
-- Lê qualquer tabela de fab que tenha empresa_id (as tabelas novas entram sozinhas), sem chaves de acesso.
create function public.fab_exportar() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u fab.perfis;
  t record;
  linhas jsonb;
  saida jsonb;
begin
  u := fab.exige_admin();
  saida := jsonb_build_object(
    'formato', 'fabrica-backup-1',
    'geradoEm', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'empresa', (select to_jsonb(e) - 'motivo_bloqueio' from fab.empresas e where e.id = u.empresa_id),
    'tabelas', '{}'::jsonb);
  for t in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'fab' and c.column_name = 'empresa_id'
       and c.table_name not in ('chaves_acesso')
     order by c.table_name
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from fab.%I x where x.empresa_id = $1', t.table_name)
      into linhas using u.empresa_id;
    saida := jsonb_set(saida, array['tabelas', t.table_name], linhas);
  end loop;
  return saida;
end $$;

revoke all on function public.fab_exportar() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.fab_exportar() from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.fab_exportar() to authenticated'; end if;
end $$;
