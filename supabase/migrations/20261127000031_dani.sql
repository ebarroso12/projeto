-- =====================================================================
-- Dani: assistente de IA do app (Google Gemini, plano gratuito)
--
--  * A chave da API do Gemini é informada pelo dono do sistema na tela Empresas e fica em fab.sistema.
--    Nunca volta para o navegador (só "configurada: sim/não"); só a função de borda "dani" (service_role) lê.
--  * Cada pergunta passa por fab_dani_inicio com o token da pessoa: confere a sessão (fab.eu), aplica o
--    limite de uso (o plano gratuito do Gemini tem cota) e devolve o contexto (nome, funções liberadas)
--    para a Dani responder só sobre o que a pessoa pode usar. As perguntas não são guardadas.
-- =====================================================================

create table fab.dani_uso (
  id         bigint generated always as identity primary key,
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  user_id    uuid not null references fab.perfis (id) on delete cascade,
  em         timestamptz not null default now()
);
create index dani_uso_user_idx on fab.dani_uso (user_id, em);
create index dani_uso_emp_idx on fab.dani_uso (empresa_id, em);
alter table fab.dani_uso enable row level security;
revoke all on fab.dani_uso from public;

-- limites (por pessoa por hora e por empresa por dia) — protegem a cota gratuita
create or replace function fab.dani_limites(out por_hora integer, out por_dia_empresa integer) language sql immutable as
$$ select 30, 300 $$;

create or replace function public.fab_dani_inicio(p_tela text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.eu(); lim record; n_hora integer; n_dia integer;
begin
  lim := fab.dani_limites();
  delete from fab.dani_uso where em < now() - interval '2 days';
  select count(*) into n_hora from fab.dani_uso where user_id = u.id and em > now() - interval '1 hour';
  if n_hora >= lim.por_hora then raise exception 'DANI_LIMITE: Você fez muitas perguntas na última hora. Tente de novo daqui a pouco.'; end if;
  select count(*) into n_dia from fab.dani_uso where empresa_id = u.empresa_id and em > now() - interval '1 day';
  if n_dia >= lim.por_dia_empresa then raise exception 'DANI_LIMITE: A empresa chegou ao limite de perguntas de hoje. Amanhã a Dani volta a responder com IA.'; end if;
  insert into fab.dani_uso (empresa_id, user_id) values (u.empresa_id, u.id);
  return jsonb_build_object(
    'nome', u.nome, 'setor', u.setor, 'admin', u.perfil = 'admin', 'dono', fab.sou_dono(),
    'empresa', (select nome from fab.empresas where id = u.empresa_id),
    'funcoes', fab.funcoes_json(u), 'tela', left(coalesce(p_tela, ''), 60),
    'restantesHora', lim.por_hora - n_hora - 1);
end $$;

-- só a função de borda (service_role) lê a chave
create or replace function public.fab_dani_chave() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('chave', (select valor from fab.sistema where chave = 'gemini_chave'),
                            'modelo', coalesce((select valor from fab.sistema where chave = 'gemini_modelo'), ''))
$$;

-- dono: situação e configuração (a chave nunca é devolvida)
create or replace function public.fab_dani_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fab.exige_dono();
  return jsonb_build_object(
    'configurada', exists (select 1 from fab.sistema where chave = 'gemini_chave'),
    'final', (select right(valor, 4) from fab.sistema where chave = 'gemini_chave'),
    'modelo', coalesce((select valor from fab.sistema where chave = 'gemini_modelo'), ''),
    'perguntasHoje', (select count(*) from fab.dani_uso where em > now() - interval '1 day'));
end $$;

create or replace function public.fab_salvar_dani(p_chave text, p_modelo text) returns void
language plpgsql security definer set search_path = '' as $$
declare k text := btrim(coalesce(p_chave, '')); m text := btrim(coalesce(p_modelo, ''));
begin
  perform fab.exige_dono();
  if k = '-' then
    delete from fab.sistema where chave = 'gemini_chave';
  elsif k <> '' then
    if k !~ '^[A-Za-z0-9_\-]{30,60}$' then raise exception 'Chave do Gemini inválida: copie a chave inteira do Google AI Studio (começa com AIza).'; end if;
    insert into fab.sistema (chave, valor) values ('gemini_chave', k) on conflict (chave) do update set valor = excluded.valor;
  end if;
  if m = '' then
    delete from fab.sistema where chave = 'gemini_modelo';
  else
    if m !~ '^[a-z0-9.\-]{3,60}$' then raise exception 'Nome de modelo inválido.'; end if;
    insert into fab.sistema (chave, valor) values ('gemini_modelo', m) on conflict (chave) do update set valor = excluded.valor;
  end if;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_dani_inicio', 'fab_dani_chave', 'fab_dani_config', 'fab_salvar_dani')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if f.proname = 'fab_dani_chave' then
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
    elsif exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
