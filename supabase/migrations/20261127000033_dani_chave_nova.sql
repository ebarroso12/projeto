-- Dani: o Google AI Studio passou a gerar chaves num formato novo ("AQ." + letras, números, "-", "_" e ".").
-- A validação aceitava só o formato antigo ("AIza…", sem ponto). Agora aceita os dois.
do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_salvar_dani(text, text)'::regprocedure) into src;
  src := replace(src, $a$if k !~ '^[A-Za-z0-9_\-]{30,60}$' then raise exception 'Chave do Gemini inválida: copie a chave inteira do Google AI Studio (começa com AIza).'; end if;$a$,
                      $b$if k !~ '^[A-Za-z0-9][A-Za-z0-9_.\-]{29,119}$' then raise exception 'Chave do Gemini inválida: copie a chave inteira do Google AI Studio (começa com AIza ou AQ.).'; end if;$b$);
  if position('AQ.' in src) = 0 then raise exception 'não achei a validação da chave em fab_salvar_dani'; end if;
  execute src;
end $$;
