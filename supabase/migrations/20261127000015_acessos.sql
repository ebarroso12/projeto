-- =====================================================================
-- Controle de acesso e auditoria
--  * Cada login gera uma SESSÃO (identificada pelo session_id do JWT do Supabase).
--  * Com "exigir liberação" ligado (padrão), quem não é administrador só usa o sistema depois que um
--    administrador da empresa LIBERA aquela sessão. Negar ou encerrar derruba a pessoa na hora.
--    Opcional: "confiar neste aparelho" libera os próximos logins daquele navegador automaticamente.
--  * O app manda um sinal a cada minuto (fab_presenca): dá "quem está online", em que tela e o
--    tempo ativo de cada sessão.
--  * Toda criação/alteração/exclusão nas tabelas da empresa vira um EVENTO (gatilho), com quem fez,
--    quando e o que mudou. Entradas, saídas, pedidos e decisões de acesso também viram eventos.
-- =====================================================================

alter table fab.configuracao add column exigir_liberacao boolean not null default true;

create table fab.sessoes (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references fab.empresas (id) on delete cascade,
  user_id      uuid not null references fab.perfis (id) on delete cascade,
  session_id   text not null unique,
  aparelho     text not null default '',
  descricao    text not null default '',
  ip           text not null default '',
  status       text not null default 'pendente' check (status in ('pendente', 'aprovada', 'negada', 'encerrada')),
  decidido_por uuid references fab.perfis (id) on delete set null,
  decidido_em  timestamptz,
  criado_em    timestamptz not null default now(),
  ultimo_em    timestamptz not null default now(),
  ativo_seg    integer not null default 0,
  tela         text not null default ''
);
create index sessoes_empresa_idx on fab.sessoes (empresa_id, criado_em desc);
create index sessoes_user_idx on fab.sessoes (user_id);
create index sessoes_decidido_idx on fab.sessoes (decidido_por);

create table fab.aparelhos_confiaveis (
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  user_id    uuid not null references fab.perfis (id) on delete cascade,
  aparelho   text not null,
  descricao  text not null default '',
  criado_por uuid references fab.perfis (id) on delete set null,
  criado_em  timestamptz not null default now(),
  primary key (user_id, aparelho)
);
create index aparelhos_empresa_idx on fab.aparelhos_confiaveis (empresa_id);
create index aparelhos_criado_por_idx on fab.aparelhos_confiaveis (criado_por);

create table fab.eventos (
  id         bigint generated always as identity primary key,
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  user_id    uuid references fab.perfis (id) on delete set null,
  quem       text not null default 'Sistema',
  tipo       text not null,
  alvo       text not null default '',
  detalhe    jsonb not null default '{}'::jsonb,
  em         timestamptz not null default now()
);
create index eventos_empresa_idx on fab.eventos (empresa_id, em desc);
create index eventos_user_idx on fab.eventos (user_id);

alter table fab.sessoes enable row level security;
alter table fab.aparelhos_confiaveis enable row level security;
alter table fab.eventos enable row level security;
revoke all on fab.sessoes, fab.aparelhos_confiaveis, fab.eventos from public;

-- ---------------------------------------------------------------- internas
create function fab.sessao_atual() returns text language sql stable set search_path = '' as
$$ select nullif(coalesce(auth.jwt() ->> 'session_id', ''), '') $$;

create function fab.exige_liberacao(p_empresa uuid) returns boolean language sql stable set search_path = '' as
$$ select coalesce((select exigir_liberacao from fab.configuracao where empresa_id = p_empresa), true) $$;

create function fab.registrar(p_empresa uuid, p_user uuid, p_quem text, p_tipo text, p_alvo text, p_detalhe jsonb)
returns void language sql set search_path = '' as $$
  insert into fab.eventos (empresa_id, user_id, quem, tipo, alvo, detalhe)
  values (p_empresa, p_user, coalesce(nullif(p_quem, ''), 'Sistema'), p_tipo, coalesce(p_alvo, ''), coalesce(p_detalhe, '{}'::jsonb))
$$;

-- Quem está chamando: além de ativo e da empresa ativa, a SESSÃO precisa estar liberada.
create or replace function fab.eu() returns fab.perfis language plpgsql stable set search_path = '' as $$
declare u fab.perfis; st text;
begin
  if auth.uid() is null then raise exception 'SESSAO'; end if;
  select * into u from fab.perfis where id = auth.uid() and ativo;
  if not found then raise exception 'SESSAO'; end if;
  perform fab.empresa_ativa(u.empresa_id);
  select s.status into st from fab.sessoes s where s.session_id = fab.sessao_atual() and s.user_id = u.id;
  if st = 'negada' then raise exception 'ACESSO_NEGADO'; end if;
  if st = 'encerrada' then raise exception 'SESSAO'; end if;
  if u.perfil <> 'admin' and fab.exige_liberacao(u.empresa_id) and st is distinct from 'aprovada' then
    raise exception 'ACESSO_PENDENTE';
  end if;
  return u;
end $$;

-- Gatilho de auditoria: o que mudou, por quem (ou "Sistema", ex.: fechamento automático do ponto).
create function fab.auditar() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  novo jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  velho jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  r jsonb := coalesce(novo, velho);
  ignorar text[] := array['empresa_id', 'id', 'criado_em', 'atualizado_em', 'chave_hash', 'criado_por', 'atualizado_por'];
  det jsonb := '{}'::jsonb; k text; tipo text; u fab.perfis;
begin
  if r ->> 'empresa_id' is null then return null; end if;
  tipo := case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'apagou' end;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(novo) loop
      if k <> all (ignorar) and (novo -> k) is distinct from (velho -> k) then
        det := det || jsonb_build_object(k, jsonb_build_array(velho -> k, novo -> k));
      end if;
    end loop;
    if det = '{}'::jsonb then return null; end if;            -- nada que importe mudou
    if (novo ->> 'apagado') = 'true' and coalesce(velho ->> 'apagado', 'false') <> 'true' then tipo := 'apagou'; end if;
    det := jsonb_build_object('mudou', det, 'item', (r - ignorar) - 'apagado');
  else
    det := r - ignorar;
  end if;
  select * into u from fab.perfis where id = auth.uid();
  perform fab.registrar((r ->> 'empresa_id')::uuid, u.id, u.nome, tipo, tg_table_name, det);
  return null;
end $$;

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'fab' and c.column_name = 'empresa_id'
       and c.table_name not in ('eventos', 'sessoes', 'aparelhos_confiaveis', 'lancamento_log', 'dre_valores')
  loop
    execute format('create trigger auditoria after insert or update or delete on fab.%I for each row execute function fab.auditar()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- API: quem entra
-- Chamada logo depois do login. Devolve 'aprovada' | 'pendente' | 'negada' | 'encerrada'.
create function public.fab_pedir_acesso(p_aparelho text, p_descricao text) returns text
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; s text := fab.sessao_atual(); st text; livre boolean; ap text := left(coalesce(p_aparelho, ''), 64);
begin
  if auth.uid() is null or s is null then raise exception 'SESSAO'; end if;
  select * into u from fab.perfis where id = auth.uid() and ativo;
  if not found then raise exception 'SESSAO'; end if;
  perform fab.empresa_ativa(u.empresa_id);
  select status into st from fab.sessoes where session_id = s;
  if st is not null then return st; end if;
  livre := u.perfil = 'admin' or not fab.exige_liberacao(u.empresa_id)
        or (length(ap) >= 16 and exists (select 1 from fab.aparelhos_confiaveis a where a.user_id = u.id and a.aparelho = ap));
  insert into fab.sessoes (empresa_id, user_id, session_id, aparelho, descricao, ip, status, decidido_em)
  values (u.empresa_id, u.id, s, ap, left(coalesce(p_descricao, ''), 120), coalesce(fab.ip_cliente(), ''),
          case when livre then 'aprovada' else 'pendente' end, case when livre then now() end);
  perform fab.registrar(u.empresa_id, u.id, u.nome, case when livre then 'entrada' else 'acesso_pedido' end, '',
    jsonb_build_object('aparelho', left(coalesce(p_descricao, ''), 120), 'ip', coalesce(fab.ip_cliente(), ''), 'automatico', livre and u.perfil <> 'admin'));
  return case when livre then 'aprovada' else 'pendente' end;
end $$;

create function public.fab_status_acesso() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select status from fab.sessoes where session_id = fab.sessao_atual() and user_id = auth.uid()), 'nenhuma')
$$;

-- Sinal de vida (a cada minuto e a cada troca de tela). Soma só o tempo com o app aberto.
create function public.fab_presenca(p_tela text) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.eu(); s text := fab.sessao_atual();
begin
  if s is null then return; end if;
  update fab.sessoes
     set ativo_seg = ativo_seg + least(greatest(extract(epoch from now() - ultimo_em)::int, 0), 90),
         ultimo_em = now(), tela = left(coalesce(p_tela, ''), 40)
   where session_id = s and user_id = u.id;
  if not found then  -- sessão anterior a este controle (ou de administrador): passa a ser registrada
    insert into fab.sessoes (empresa_id, user_id, session_id, ip, status, decidido_em, tela)
    values (u.empresa_id, u.id, s, coalesce(fab.ip_cliente(), ''), 'aprovada', now(), left(coalesce(p_tela, ''), 40))
    on conflict (session_id) do nothing;
  end if;
end $$;

create function public.fab_sair_sessao() returns void
language plpgsql security definer set search_path = '' as $$
declare s text := fab.sessao_atual(); r fab.sessoes;
begin
  update fab.sessoes set status = 'encerrada', ultimo_em = now()
   where session_id = s and user_id = auth.uid() and status in ('aprovada', 'pendente') returning * into r;
  if found then perform fab.registrar(r.empresa_id, r.user_id, (select nome from fab.perfis where id = r.user_id), 'saida', '', '{}'::jsonb); end if;
end $$;

-- ---------------------------------------------------------------- API: administrador
create function fab.sessao_json(s fab.sessoes) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'nome', p.nome, 'login', p.login, 'setor', p.setor, 'perfil', p.perfil::text,
    'aparelho', s.descricao, 'ip', s.ip, 'status', s.status, 'tela', s.tela, 'ativoSeg', s.ativo_seg,
    'inicio', to_char(s.criado_em at time zone fab.fuso(s.empresa_id), 'YYYY-MM-DD"T"HH24:MI:SS'),
    'ultimo', to_char(s.ultimo_em at time zone fab.fuso(s.empresa_id), 'YYYY-MM-DD"T"HH24:MI:SS'),
    'decididoPor', coalesce((select d.nome from fab.perfis d where d.id = s.decidido_por), ''),
    'confiavel', exists (select 1 from fab.aparelhos_confiaveis a where a.user_id = s.user_id and a.aparelho = s.aparelho and s.aparelho <> ''))
  from fab.perfis p where p.id = s.user_id
$$;

create function public.fab_acessos_pendentes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  return coalesce((select jsonb_agg(fab.sessao_json(s) order by s.criado_em)
                     from fab.sessoes s
                    where s.empresa_id = u.empresa_id and s.status = 'pendente' and s.criado_em > now() - interval '12 hours'), '[]'::jsonb);
end $$;

create function public.fab_decidir_acesso(p_id uuid, p_liberar boolean, p_confiar boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); s fab.sessoes;
begin
  update fab.sessoes set status = case when p_liberar then 'aprovada' else 'negada' end, decidido_por = u.id, decidido_em = now()
   where id = p_id and empresa_id = u.empresa_id and status = 'pendente' returning * into s;
  if not found then raise exception 'Esse pedido já foi respondido ou expirou.'; end if;
  if p_liberar and coalesce(p_confiar, false) and length(s.aparelho) >= 16 then
    insert into fab.aparelhos_confiaveis (empresa_id, user_id, aparelho, descricao, criado_por)
    values (s.empresa_id, s.user_id, s.aparelho, s.descricao, u.id) on conflict do nothing;
  end if;
  perform fab.registrar(u.empresa_id, u.id, u.nome, case when p_liberar then 'acesso_liberado' else 'acesso_negado' end,
    (select nome from fab.perfis where id = s.user_id), jsonb_build_object('aparelho', s.descricao, 'ip', s.ip, 'confiar', coalesce(p_confiar, false)));
end $$;

-- Derruba uma sessão aberta (a pessoa precisa entrar de novo e, se exigido, ser liberada outra vez).
create function public.fab_encerrar_sessao(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); s fab.sessoes;
begin
  update fab.sessoes set status = 'encerrada' where id = p_id and empresa_id = u.empresa_id and status in ('aprovada', 'pendente')
  returning * into s;
  if not found then raise exception 'Essa sessão já foi encerrada.'; end if;
  perform fab.registrar(u.empresa_id, u.id, u.nome, 'sessao_encerrada', (select nome from fab.perfis where id = s.user_id), jsonb_build_object('aparelho', s.descricao));
end $$;

create function public.fab_revogar_aparelho(p_login text, p_aparelho text) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  delete from fab.aparelhos_confiaveis a using fab.perfis p
   where p.id = a.user_id and a.empresa_id = u.empresa_id and p.login = p_login and a.aparelho = p_aparelho;
  perform fab.registrar(u.empresa_id, u.id, u.nome, 'aparelho_revogado', p_login, '{}'::jsonb);
end $$;

create function public.fab_config_acesso(p_exigir boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  update fab.configuracao set exigir_liberacao = p_exigir where empresa_id = u.empresa_id;
end $$;

-- Tudo para a tela "Acessos": pendentes, online agora, sessões, eventos, aparelhos e métricas por pessoa.
create function public.fab_acessos(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u fab.perfis := fab.exige_admin(); e uuid := u.empresa_id; fz text := fab.fuso(u.empresa_id);
  ini timestamptz := (p_ini::timestamp at time zone fz); fim timestamptz := ((p_fim + 1)::timestamp at time zone fz);
begin
  return jsonb_build_object(
    'exigir', fab.exige_liberacao(e),
    'pendentes', coalesce((select jsonb_agg(fab.sessao_json(s) order by s.criado_em) from fab.sessoes s
                            where s.empresa_id = e and s.status = 'pendente' and s.criado_em > now() - interval '12 hours'), '[]'::jsonb),
    'online', coalesce((select jsonb_agg(fab.sessao_json(s) order by s.ultimo_em desc) from fab.sessoes s
                         where s.empresa_id = e and s.status = 'aprovada' and s.ultimo_em > now() - interval '3 minutes'), '[]'::jsonb),
    'sessoes', coalesce((select jsonb_agg(fab.sessao_json(x) order by x.criado_em desc) from (
                          select * from fab.sessoes s where s.empresa_id = e and s.criado_em >= ini and s.criado_em < fim
                          order by s.criado_em desc limit 500) x), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', v.id, 'quem', v.quem, 'tipo', v.tipo, 'alvo', v.alvo, 'detalhe', v.detalhe,
                           'em', to_char(v.em at time zone fz, 'YYYY-MM-DD"T"HH24:MI:SS')) order by v.id desc) from (
                          select * from fab.eventos v where v.empresa_id = e and v.em >= ini and v.em < fim
                          order by v.id desc limit 1500) v), '[]'::jsonb),
    'aparelhos', coalesce((select jsonb_agg(jsonb_build_object('login', p.login, 'nome', p.nome, 'aparelho', a.aparelho, 'descricao', a.descricao,
                             'desde', to_char(a.criado_em at time zone fz, 'YYYY-MM-DD"T"HH24:MI'),
                             'por', coalesce((select d.nome from fab.perfis d where d.id = a.criado_por), '')) order by p.nome)
                           from fab.aparelhos_confiaveis a join fab.perfis p on p.id = a.user_id where a.empresa_id = e), '[]'::jsonb),
    'metricas', coalesce((select jsonb_agg(m order by m ->> 'nome') from (
                  select jsonb_build_object(
                    'nome', p.nome, 'login', p.login, 'perfil', p.perfil::text, 'ativo', p.ativo,
                    'entradas', (select count(*) from fab.sessoes s where s.user_id = p.id and s.criado_em >= ini and s.criado_em < fim and s.status in ('aprovada', 'encerrada')),
                    'negados', (select count(*) from fab.sessoes s where s.user_id = p.id and s.criado_em >= ini and s.criado_em < fim and s.status = 'negada'),
                    'tempoSeg', (select coalesce(sum(s.ativo_seg), 0) from fab.sessoes s where s.user_id = p.id and s.criado_em >= ini and s.criado_em < fim),
                    'criou', (select count(*) from fab.eventos v where v.user_id = p.id and v.tipo = 'criou' and v.em >= ini and v.em < fim),
                    'alterou', (select count(*) from fab.eventos v where v.user_id = p.id and v.tipo = 'alterou' and v.em >= ini and v.em < fim),
                    'apagou', (select count(*) from fab.eventos v where v.user_id = p.id and v.tipo = 'apagou' and v.em >= ini and v.em < fim),
                    'ultimo', (select to_char(max(s.ultimo_em) at time zone fz, 'YYYY-MM-DD"T"HH24:MI') from fab.sessoes s where s.user_id = p.id)) m
                  from fab.perfis p where p.empresa_id = e) q), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- permissões
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_pedir_acesso', 'fab_status_acesso', 'fab_presenca', 'fab_sair_sessao',
              'fab_acessos_pendentes', 'fab_decidir_acesso', 'fab_encerrar_sessao', 'fab_revogar_aparelho', 'fab_config_acesso', 'fab_acessos')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
