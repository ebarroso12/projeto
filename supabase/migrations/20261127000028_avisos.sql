-- =====================================================================
-- Avisos no celular (Web Push), mesmo com o app fechado
--
--  * Cada aparelho que ativa os avisos guarda a sua inscrição (fab.push_inscricoes).
--  * Todo aviso entra na fila fab.avisos_fila (fica o histórico do que foi enviado e para quem).
--  * Se a extensão pg_net estiver disponível e o envio configurado (fab.sistema), o banco chama a
--    função de borda "avisos", que criptografa e entrega o aviso a cada aparelho (VAPID).
--  * Avisos imediatos: alguém pediu para entrar (quem libera acessos) e mensagem nova (destinatários).
--  * Resumo diário (pg_cron, 8h de Brasília): contas a pagar e a receber vencendo/atrasadas, faturas,
--    pedidos atrasados ou com entrega próxima e matéria-prima abaixo do mínimo — para quem tem a função.
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

-- configuração do sistema (endereço e segredo da função de borda) — só funções internas leem
create table if not exists fab.sistema (chave text primary key, valor text not null);
alter table fab.sistema enable row level security;
revoke all on fab.sistema from public;

create table fab.push_inscricoes (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  user_id    uuid not null references fab.perfis (id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://'),
  p256dh     text not null,
  auth       text not null,
  aparelho   text not null default '',
  criado_em  timestamptz not null default now(),
  ultimo_ok  timestamptz
);
create index push_inscricoes_user_idx on fab.push_inscricoes (user_id);
alter table fab.push_inscricoes enable row level security;
revoke all on fab.push_inscricoes from public;

create table fab.avisos_fila (
  id         bigint generated always as identity primary key,
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  users      uuid[] not null,
  tipo       text not null,
  titulo     text not null,
  texto      text not null,
  url        text not null default '',
  criado_em  timestamptz not null default now(),
  enviado_em timestamptz,
  entregues  integer not null default 0
);
create index avisos_fila_emp_idx on fab.avisos_fila (empresa_id, criado_em desc);
alter table fab.avisos_fila enable row level security;
revoke all on fab.avisos_fila from public;

-- ---------------------------------------------------------------- inscrição do aparelho
create or replace function public.fab_push_inscrever(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.eu();
begin
  if coalesce(p ->> 'endpoint', '') !~ '^https://' or coalesce(p ->> 'p256dh', '') = '' or coalesce(p ->> 'auth', '') = '' then
    raise exception 'Inscrição de avisos inválida.';
  end if;
  insert into fab.push_inscricoes (empresa_id, user_id, endpoint, p256dh, auth, aparelho)
  values (u.empresa_id, u.id, p ->> 'endpoint', p ->> 'p256dh', p ->> 'auth', left(coalesce(p ->> 'aparelho', ''), 120))
  on conflict (endpoint) do update set empresa_id = excluded.empresa_id, user_id = excluded.user_id, p256dh = excluded.p256dh,
                                       auth = excluded.auth, aparelho = excluded.aparelho, criado_em = now();
end $$;

create or replace function public.fab_push_cancelar(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.eu();
begin
  delete from fab.push_inscricoes where endpoint = p_endpoint and user_id = u.id;
end $$;

create or replace function public.fab_push_status(p_endpoint text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.eu();
begin
  return jsonb_build_object(
    'esteAparelho', exists (select 1 from fab.push_inscricoes where endpoint = coalesce(p_endpoint, '') and user_id = u.id),
    'aparelhos', (select count(*) from fab.push_inscricoes where user_id = u.id),
    'configurado', exists (select 1 from fab.sistema where chave = 'avisos_url'));
end $$;

-- ---------------------------------------------------------------- fila e envio
create or replace function fab.enviar_aviso(p_emp uuid, p_users uuid[], p_tipo text, p_titulo text, p_texto text, p_url text default '') returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_url text; v_seg text;
begin
  if p_users is null or cardinality(p_users) = 0 then return null; end if;
  insert into fab.avisos_fila (empresa_id, users, tipo, titulo, texto, url)
  values (p_emp, p_users, p_tipo, left(p_titulo, 80), left(p_texto, 400), coalesce(p_url, ''))
  returning id into v_id;
  select valor into v_url from fab.sistema where chave = 'avisos_url';
  select valor into v_seg from fab.sistema where chave = 'avisos_segredo';
  -- só chama a borda se houver alguém inscrito, a extensão existir e o envio estiver configurado
  if v_url is not null and v_seg is not null and to_regproc('net.http_post') is not null
     and exists (select 1 from fab.push_inscricoes where user_id = any (p_users)) then
    begin
      execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
        using v_url, jsonb_build_object('action', 'enviar', 'id', v_id),
              jsonb_build_object('Content-Type', 'application/json', 'x-avisos-segredo', v_seg);
    exception when others then
      raise warning 'aviso % não enviado: %', v_id, sqlerrm;   -- aviso nunca derruba a ação de quem o gerou
    end;
  end if;
  return v_id;
end $$;

-- usado pela função de borda (service_role): conteúdo do aviso e aparelhos de destino
create or replace function public.fab_aviso_para_envio(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('titulo', a.titulo, 'texto', a.texto, 'url', a.url, 'tipo', a.tipo,
    'destinos', coalesce((select jsonb_agg(jsonb_build_object('endpoint', i.endpoint, 'p256dh', i.p256dh, 'auth', i.auth))
                            from fab.push_inscricoes i where i.user_id = any (a.users) and i.empresa_id = a.empresa_id), '[]'::jsonb))
    from fab.avisos_fila a where a.id = p_id and a.enviado_em is null
$$;

create or replace function public.fab_aviso_resultado(p_id bigint, p_entregues integer, p_expirados text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update fab.avisos_fila set enviado_em = now(), entregues = coalesce(p_entregues, 0) where id = p_id;
  if p_expirados is not null and cardinality(p_expirados) > 0 then
    delete from fab.push_inscricoes where endpoint = any (p_expirados);   -- aparelho desinstalou / revogou
  end if;
  update fab.push_inscricoes set ultimo_ok = now()
   where user_id = any (coalesce((select users from fab.avisos_fila where id = p_id), '{}'::uuid[])) and not (endpoint = any (coalesce(p_expirados, '{}'::text[])));
end $$;

-- ---------------------------------------------------------------- avisos imediatos
create or replace function fab.aviso_acesso_pendente() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_nome text; v_users uuid[];
begin
  if new.status <> 'pendente' then return null; end if;
  select nome into v_nome from fab.perfis where id = new.user_id;
  select array_agg(p.id) into v_users from fab.perfis p
   where p.empresa_id = new.empresa_id and p.ativo and p.id <> new.user_id and fab.pode(p, 'acessos');
  perform fab.enviar_aviso(new.empresa_id, v_users, 'acesso', 'Pedido de acesso',
                           coalesce(v_nome, 'Alguém') || ' quer entrar no app' || case when new.descricao <> '' then ' (' || new.descricao || ')' else '' end || '. Toque para liberar.',
                           '#/acessos');
  return null;
end $$;
create trigger aviso_acesso after insert on fab.sessoes for each row execute function fab.aviso_acesso_pendente();

create or replace function fab.aviso_mensagem() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_users uuid[];
begin
  if new.para_id is not null then
    v_users := array[new.para_id];
  else
    select array_agg(p.id) into v_users from fab.perfis p
     where p.empresa_id = new.empresa_id and p.ativo and p.id is distinct from new.autor_id;
  end if;
  perform fab.enviar_aviso(new.empresa_id, v_users, 'mensagem',
                           case when new.importante then '⚠ ' else '' end || coalesce(nullif(new.titulo, ''), 'Mensagem de ' || coalesce(nullif(new.autor_nome, ''), 'administração')),
                           left(new.texto, 300), '#/?mensagens=1');
  return null;
end $$;
create trigger aviso_mensagem after insert on fab.mensagens for each row execute function fab.aviso_mensagem();

-- ---------------------------------------------------------------- resumo diário
-- vencimento da parcela `idx` (0 = 1ª) de uma conta em parcelas fora do cartão (mesma regra do app)
create or replace function fab.fin_vencimento_parcela(p_data date, p_dia integer, p_idx integer) returns date
language sql immutable set search_path = '' as $$
  select (m + (least(p_dia, extract(day from (m + interval '1 month' - interval '1 day'))::integer) - 1))::date
    from (select (date_trunc('month', p_data) + ((case when p_dia < extract(day from p_data) then 1 else 0 end) + p_idx) * interval '1 month')::date as m) x
$$;

create or replace function fab.avisos_diarios() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  e record; pf fab.perfis; v_hoje date; linhas text[]; n integer := 0;
  pagar_atras integer; pagar_hoje integer; pagar_valor numeric; receber_atras integer; receber_valor numeric; faturas integer;
  ped_atras integer; ped_prox integer; mats text[];
begin
  for e in select * from fab.empresas where ativa and (teste_ate is null or teste_ate >= now()) loop
    v_hoje := fab.hoje(e.id);
    -- próximas parcelas em aberto (uma por conta) de contas a pagar e a receber
    with prox as (
      select l.tipo, l.valor_parcela as v, fab.fin_vencimento_parcela(l.data, l.dia_vencimento, l.parcelas_pagas) as venc
        from fab.fin_lancamentos l
       where l.empresa_id = e.id and l.apagado_em is null and l.tipo in ('programada', 'receber') and l.cartao_id is null
         and l.parcelas_pagas < l.parcelas and l.dia_vencimento is not null)
    select count(*) filter (where tipo = 'programada' and venc < v_hoje), count(*) filter (where tipo = 'programada' and venc between v_hoje and v_hoje + 1),
           coalesce(sum(v) filter (where tipo = 'programada' and venc <= v_hoje + 1), 0),
           count(*) filter (where tipo = 'receber' and venc < v_hoje), coalesce(sum(v) filter (where tipo = 'receber' and venc < v_hoje), 0)
      into pagar_atras, pagar_hoje, pagar_valor, receber_atras, receber_valor from prox;
    select count(distinct (l.cartao_id, l.vencimento_fatura)) into faturas from fab.fin_lancamentos l
     where l.empresa_id = e.id and l.apagado_em is null and l.tipo = 'saida' and l.cartao_id is not null
       and l.vencimento_fatura between v_hoje and v_hoje + 1
       and not exists (select 1 from fab.fin_pagamentos_fatura f where f.cartao_id = l.cartao_id and f.vencimento = l.vencimento_fatura);
    select count(*) filter (where entrega < v_hoje), count(*) filter (where entrega between v_hoje and v_hoje + 2)
      into ped_atras, ped_prox from fab.pedidos where empresa_id = e.id and status = 'aberto';
    select array_agg(m.nome order by m.nome) into mats from fab.materiais m
     where m.empresa_id = e.id and m.ativo and m.minimo > 0 and (fab.material_json(m, v_hoje) ->> 'saldo')::numeric < m.minimo;

    for pf in select * from fab.perfis where empresa_id = e.id and ativo loop
      linhas := '{}';
      if fab.pode(pf, 'financeiro') then
        if pagar_atras > 0 then linhas := linhas || (pagar_atras || ' conta(s) a pagar atrasada(s)'); end if;
        if pagar_hoje > 0 then linhas := linhas || (pagar_hoje || ' conta(s) vencem hoje/amanhã'); end if;
        if faturas > 0 then linhas := linhas || (faturas || ' fatura(s) de cartão vencem hoje/amanhã'); end if;
        if receber_atras > 0 then linhas := linhas || (receber_atras || ' parcela(s) a receber atrasada(s): R$ ' || to_char(receber_valor, 'FM999G999G990D00')); end if;
      end if;
      if fab.pode(pf, 'pedidos') then
        if ped_atras > 0 then linhas := linhas || (ped_atras || ' pedido(s) atrasado(s)'); end if;
        if ped_prox > 0 then linhas := linhas || (ped_prox || ' pedido(s) com entrega em até 2 dias'); end if;
      end if;
      if fab.pode(pf, 'materiais') and coalesce(cardinality(mats), 0) > 0 then
        linhas := linhas || ('Comprar: ' || array_to_string(mats[1:4], ', ') || case when cardinality(mats) > 4 then '…' else '' end);
      end if;
      if cardinality(linhas) > 0 then
        perform fab.enviar_aviso(e.id, array[pf.id], 'diario', 'Fábrica · resumo do dia', array_to_string(linhas, ' · '),
                                 case when fab.pode(pf, 'financeiro') and (pagar_atras + pagar_hoje + faturas + receber_atras) > 0 then '#/financeiro'
                                      when ped_atras + ped_prox > 0 then '#/pedidos' else '#/materiais' end);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fab_avisos_diarios', '0 11 * * *', 'select fab.avisos_diarios()');   -- 11h UTC = 8h em Brasília
  end if;
end $$;

-- ---------------------------------------------------------------- permissões
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_push_inscrever', 'fab_push_cancelar', 'fab_push_status', 'fab_aviso_para_envio', 'fab_aviso_resultado')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if f.proname in ('fab_aviso_para_envio', 'fab_aviso_resultado') then   -- só a função de borda (service_role)
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
    elsif exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
revoke all on function fab.enviar_aviso(uuid, uuid[], text, text, text, text) from public;
revoke all on function fab.avisos_diarios() from public;
