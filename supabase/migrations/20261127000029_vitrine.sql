-- =====================================================================
-- Página de apresentação (vitrine) e link público de teste
--
-- O dono do sistema publica UM link de teste na página de apresentação (/?conheca).
-- Diferente do link TESTE enviado a uma pessoa (que vence junto com o prazo, contado do envio),
-- no link público o prazo conta a partir do CADASTRO de cada empresa — ele fica no ar por até 1 ano,
-- com limite de usos. O dono pode trocar ou tirar o link e informar o WhatsApp de contato.
-- =====================================================================

alter table fab.convites
  add column if not exists publico boolean not null default false,
  add column if not exists token_publico text;
create unique index if not exists convites_um_publico on fab.convites (publico) where publico;

-- prazo do link público conta do cadastro
do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_criar_empresa_teste(text, text, text)'::regprocedure) into src;
  src := replace(src, 'case when c.tipo = ''teste'' then c.criado_em + make_interval(days => c.dias_teste) end',
                      'case when c.tipo = ''teste'' then (case when c.publico then now() else c.criado_em end) + make_interval(days => c.dias_teste) end');
  if position('when c.publico then now()' in src) = 0 then raise exception 'fab_criar_empresa_teste: trecho não encontrado'; end if;
  execute src;
  select pg_get_functiondef('public.fab_validar_convite(text)'::regprocedure) into src;
  src := replace(src, 'to_char((c.criado_em + make_interval(days => c.dias_teste))',
                      'to_char(((case when c.publico then now() else c.criado_em end) + make_interval(days => c.dias_teste))');
  if position('when c.publico then now()' in src) = 0 then raise exception 'fab_validar_convite: trecho não encontrado'; end if;
  execute src;
end $$;

create or replace function public.fab_link_publico_criar(p_dias integer, p_usos integer, p_nota text) returns text
language plpgsql security definer set search_path = '' as $$
declare t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  perform fab.exige_dono();
  if coalesce(p_dias, 0) not between 1 and 90 then raise exception 'Dias de teste: 1 a 90.'; end if;
  if coalesce(p_usos, 0) not between 1 and 500 then raise exception 'Limite de cadastros: 1 a 500.'; end if;
  update fab.convites set publico = false, token_publico = null, ativo = false where publico;
  insert into fab.convites (tipo, token_hash, criado_por, nota, dias_teste, usos_max, expira_em, publico, token_publico)
  values ('teste', fab.hash_token(t), auth.uid(), left(coalesce(nullif(btrim(p_nota), ''), 'Página de apresentação'), 120), p_dias, p_usos,
          now() + interval '365 days', true, t);
  return t;
end $$;

create or replace function public.fab_link_publico_desativar() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform fab.exige_dono();
  update fab.convites set publico = false, token_publico = null, ativo = false where publico;
end $$;

create or replace function public.fab_salvar_contato_vitrine(p_whatsapp text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
begin
  perform fab.exige_dono();
  if v = '' then delete from fab.sistema where chave = 'vitrine_whatsapp'; return; end if;
  if length(v) not between 10 and 13 then raise exception 'WhatsApp inválido: informe DDD e número (com 55 opcional).'; end if;
  if length(v) <= 11 then v := '55' || v; end if;
  insert into fab.sistema (chave, valor) values ('vitrine_whatsapp', v) on conflict (chave) do update set valor = excluded.valor;
end $$;

-- painel do dono: situação do link público
create or replace function public.fab_vitrine_admin() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fab.exige_dono();
  return jsonb_build_object(
    'link', (select jsonb_build_object('token', c.token_publico, 'dias', c.dias_teste, 'usos', c.usos, 'usosMax', c.usos_max,
                                       'valido', c.ativo and c.usos < c.usos_max and c.expira_em > now(),
                                       'empresas', (select count(*) from fab.empresas e where e.convite_id = c.id))
               from fab.convites c where c.publico),
    'whatsapp', (select valor from fab.sistema where chave = 'vitrine_whatsapp'));
end $$;

-- público (sem login): o que a página de apresentação precisa
create or replace function public.fab_vitrine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'convite', (select c.token_publico from fab.convites c where c.publico and c.ativo and c.usos < c.usos_max and c.expira_em > now()),
    'dias', (select c.dias_teste from fab.convites c where c.publico and c.ativo and c.usos < c.usos_max and c.expira_em > now()),
    'whatsapp', (select valor from fab.sistema where chave = 'vitrine_whatsapp'))
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_link_publico_criar', 'fab_link_publico_desativar', 'fab_salvar_contato_vitrine', 'fab_vitrine_admin', 'fab_vitrine')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      if f.proname = 'fab_vitrine' then execute format('grant execute on function %s to anon', f.sig);
      else execute format('revoke all on function %s from anon', f.sig); end if;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
