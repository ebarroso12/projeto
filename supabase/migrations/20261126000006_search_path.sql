-- Fábrica · fixa o search_path de todas as funções internas (alerta "function_search_path_mutable").
-- Todas as referências já são qualificadas (fab.*, auth.*), então search_path vazio é seguro
-- e impede que alguém troque objetos por outros de mesmo nome em outro schema.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'fab'
  loop
    execute format('alter function %s set search_path = ''''', f.sig);
  end loop;
end $$;
