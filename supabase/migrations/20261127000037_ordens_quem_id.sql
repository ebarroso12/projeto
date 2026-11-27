-- Ranking de cortadores: a ordem de corte passa a informar QUEM cortou pelo identificador
-- (oficina ou pessoa), não só pelo nome. Assim duas pessoas com o mesmo nome não se misturam
-- e uma oficina renomeada continua sendo a mesma.
do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_remessas(integer)'::regprocedure) into src;
  src := replace(src, '''id'', o.id, ''numero'', o.numero, ''data'', o.data, ''quem'', o.quem_nome,',
                      '''id'', o.id, ''numero'', o.numero, ''data'', o.data, ''quem'', o.quem_nome, ''oficinaId'', o.oficina_id, ''login'', (select login from fab.perfis where id = o.user_id),');
  if position('''oficinaId'', o.oficina_id' in src) = 0 then raise exception 'fab_remessas: trecho não encontrado'; end if;
  execute src;
end $$;
