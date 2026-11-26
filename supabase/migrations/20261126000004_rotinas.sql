-- Fábrica · rotinas agendadas
-- Fecha os pontos esquecidos (saída automática na hora de fechamento, sem hora extra).
-- Usa pg_cron, que o Supabase oferece; se a extensão não existir (ex.: banco de teste), apenas ignora.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'fab_fechar_pendentes';
    perform cron.schedule('fab_fechar_pendentes', '*/10 * * * *', 'select fab.fechar_pendentes()');
  else
    raise notice 'pg_cron indisponível: agende fab.fechar_pendentes() por outro meio.';
  end if;
end $$;
