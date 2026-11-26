-- Fábrica · MULTIEMPRESA
-- Substitui o modelo de empresa única (migrações 1 a 6) por um modelo em que cada empresa
-- tem seus próprios usuários, produção, ponto, itens em falta, listas e configurações.
-- O banco ainda não tinha dados de produção; os usuários existentes são religados à 1ª empresa
-- em um passo de dados separado (sem IDs fixos nesta migração).
--
-- Também corrige três pontos da revisão:
--  * o ponto só fecha automaticamente em DIAS ANTERIORES (antes fechava o turno de quem fazia hora extra);
--  * o IP do Wi-Fi vem de cabeçalho que o cliente não consegue forjar (cf-connecting-ip / x-real-ip);
--  * cada empresa tem fuso e horário de fechamento próprios.

-- ---------- remove o modelo antigo ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'fab\_%'
  loop execute format('drop function %s', f.sig); end loop;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fab_fechar_pendentes';
  end if;
end $$;
drop schema if exists fab cascade;
create schema fab;

create type fab.perfil       as enum ('admin', 'funcionario');
create type fab.etapa        as enum ('Corte', 'Costura', 'Conferência');
create type fab.status_falta as enum ('Urgente', 'Em produção', 'Feito');

-- ---------- empresas e donos do sistema ----------
create table fab.empresas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique check (codigo ~ '^[a-z0-9-]{2,30}$'),
  nome            text not null check (length(btrim(nome)) > 0),
  ativa           boolean not null default true,
  motivo_bloqueio text not null default '',
  criado_em       timestamptz not null default now()
);

-- Quem administra o sistema inteiro (cria e bloqueia empresas). Não vê dados internos das empresas.
create table fab.donos (user_id uuid primary key references auth.users (id) on delete cascade);

create table fab.perfis (
  id         uuid primary key references auth.users (id) on delete cascade,
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  login      text not null check (login ~ '^[a-z0-9._-]{2,32}$'),
  nome       text not null check (length(btrim(nome)) > 0),
  setor      text not null default 'Outra',
  perfil     fab.perfil not null default 'funcionario',
  ativo      boolean not null default true,
  pode_falta boolean not null default false,
  criado_em  timestamptz not null default now(),
  unique (empresa_id, login)
);

create table fab.configuracao (
  empresa_id  uuid primary key references fab.empresas (id) on delete cascade,
  exigir_wifi boolean not null default false,
  hora_fim    time    not null default '17:30',
  fuso        text    not null default 'America/Sao_Paulo'
);

create table fab.redes (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  nome       text not null,
  ip         text not null,
  criado_em  timestamptz not null default now(),
  unique (empresa_id, ip)
);

create table fab.dias_sem_expediente (
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  dia        date not null,
  motivo     text not null default '',
  primary key (empresa_id, dia)
);

create table fab.itens_lista (
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  tipo       text not null check (tipo in ('modelo', 'cor', 'tamanho')),
  nome       text not null check (length(btrim(nome)) between 1 and 60),
  ordem      integer not null default 0,
  primary key (empresa_id, tipo, nome)
);

create table fab.lancamentos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  user_id    uuid not null references fab.perfis (id),
  etapa      fab.etapa not null,
  modelo     text not null,
  cor        text not null,
  tamanho    text not null,
  qtd        integer not null check (qtd >= 0),
  obs        text not null default '',
  dia        date not null,
  criado_em  timestamptz not null default now(),
  edicoes    integer not null default 0,
  historico  text not null default '',
  apagado_em timestamptz
);
create index lancamentos_emp_dia_idx   on fab.lancamentos (empresa_id, dia) where apagado_em is null;
create index lancamentos_emp_combo_idx on fab.lancamentos (empresa_id, modelo, cor, tamanho, etapa) where apagado_em is null;
create index lancamentos_user_idx      on fab.lancamentos (user_id, dia);

create table fab.lancamento_log (
  id            bigint generated always as identity primary key,
  empresa_id    uuid not null references fab.empresas (id) on delete cascade,
  lancamento_id uuid not null,
  user_id       uuid not null,
  acao          text not null check (acao in ('editar', 'apagar')),
  antes         integer,
  depois        integer,
  em            timestamptz not null default now()
);

create table fab.ponto (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  user_id    uuid not null references fab.perfis (id),
  dia        date not null,
  entrada    time not null,
  saida      time,
  extra_min  integer not null default 0 check (extra_min >= 0),
  automatico boolean not null default false,
  unique (user_id, dia)
);
create index ponto_emp_dia_idx on fab.ponto (empresa_id, dia);

create table fab.em_falta (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references fab.empresas (id) on delete cascade,
  modelo       text not null,
  cor          text not null default '',
  tamanho      text not null default '',
  qtd          integer not null default 0 check (qtd >= 0),
  obs          text not null default '',
  status       fab.status_falta not null default 'Urgente',
  criado_em    timestamptz not null default now(),
  criado_por   uuid references fab.perfis (id),
  concluido_em timestamptz
);
create index em_falta_emp_aberto_idx on fab.em_falta (empresa_id, criado_em) where status <> 'Feito';

create table fab.chaves_acesso (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  nome       text not null,
  chave_hash text not null unique,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- toda empresa nova ganha sua configuração
create function fab.nova_empresa_config() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into fab.configuracao (empresa_id) values (new.id) on conflict do nothing;
  return null;
end $$;
create trigger empresas_config after insert on fab.empresas for each row execute function fab.nova_empresa_config();

-- ---------- segurança: nada acessível direto ----------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'fab' loop
    execute format('alter table fab.%I enable row level security', t.tablename);
  end loop;
end $$;
revoke all on schema fab from public;
revoke all on all tables in schema fab from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon')          then revoke all on schema fab from anon;          revoke all on all tables in schema fab from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on schema fab from authenticated; revoke all on all tables in schema fab from authenticated; end if;
end $$;

-- =====================================================================
-- regras internas
-- =====================================================================
create function fab.cfg(p_emp uuid) returns fab.configuracao language sql stable as
$$ select * from fab.configuracao where empresa_id = p_emp $$;
create function fab.fuso(p_emp uuid) returns text language sql stable as
$$ select coalesce((select fuso from fab.configuracao where empresa_id = p_emp), 'America/Sao_Paulo') $$;
create function fab.hoje(p_emp uuid) returns date language sql stable as
$$ select (now() at time zone fab.fuso(p_emp))::date $$;
create function fab.agora(p_emp uuid) returns time language sql stable as
$$ select date_trunc('minute', now() at time zone fab.fuso(p_emp))::time $$;

create function fab.hm(t time) returns text language sql immutable as $$ select coalesce(to_char(t, 'HH24:MI'), '') $$;
create function fab.min_de(t time) returns integer language sql immutable as $$ select (extract(hour from t) * 60 + extract(minute from t))::integer $$;
create function fab.fmt_min(m integer) returns text language sql immutable as
$$ select case when coalesce(m, 0) <= 0 then '' else (m / 60)::text || ':' || lpad((m % 60)::text, 2, '0') end $$;
create function fab.fmt_hm(m integer) returns text language sql immutable as
$$ select (coalesce(m, 0) / 60)::text || ':' || lpad((coalesce(m, 0) % 60)::text, 2, '0') $$;

-- Dias de expediente encerrados (seg-sex, sem feriado). Hoje só conta depois da hora de fechamento.
create function fab.dias_uteis(p_emp uuid, p_ini date, p_fim date) returns setof date language sql stable as $$
  select d::date
  from generate_series(
         p_ini::timestamp,
         least(p_fim, case when fab.agora(p_emp) >= (fab.cfg(p_emp)).hora_fim then fab.hoje(p_emp) else fab.hoje(p_emp) - 1 end)::timestamp,
         interval '1 day') d
  where extract(isodow from d) < 6
    and not exists (select 1 from fab.dias_sem_expediente s where s.empresa_id = p_emp and s.dia = d::date)
$$;

create function fab.empresa_ativa(p_emp uuid) returns void language plpgsql stable as $$
begin
  if not exists (select 1 from fab.empresas where id = p_emp and ativa) then
    raise exception 'EMPRESA_BLOQUEADA';
  end if;
end $$;

create function fab.eu() returns fab.perfis language plpgsql stable as $$
declare u fab.perfis;
begin
  if auth.uid() is null then raise exception 'SESSAO'; end if;
  select * into u from fab.perfis where id = auth.uid() and ativo;
  if not found then raise exception 'SESSAO'; end if;
  perform fab.empresa_ativa(u.empresa_id);
  return u;
end $$;

create function fab.exige_admin() returns fab.perfis language plpgsql stable as $$
declare u fab.perfis;
begin
  u := fab.eu();
  if u.perfil <> 'admin' then raise exception 'Apenas o administrador pode fazer isto.'; end if;
  return u;
end $$;

create function fab.sou_dono() returns boolean language sql stable as
$$ select auth.uid() is not null and exists (select 1 from fab.donos where user_id = auth.uid()) $$;

create function fab.exige_dono() returns void language plpgsql stable as $$
begin
  if not fab.sou_dono() then raise exception 'Apenas o responsável pelo sistema pode fazer isto.'; end if;
end $$;

-- IP real do aparelho. Usa cabeçalhos que a borda do Supabase (Cloudflare) define e o cliente NÃO consegue
-- forjar. O X-Forwarded-For não é usado: o primeiro item dele vem do próprio cliente.
create function fab.ip_cliente() returns text language plpgsql stable as $$
declare h json;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  return coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''), nullif(btrim(h ->> 'x-real-ip'), ''));
end $$;

create function fab.rede_liberada(u fab.perfis) returns boolean language plpgsql stable as $$
declare cfg fab.configuracao; v_ip text;
begin
  cfg := fab.cfg(u.empresa_id);
  if not cfg.exigir_wifi or u.perfil = 'admin' then return true; end if;
  v_ip := fab.ip_cliente();
  return v_ip is not null and exists (select 1 from fab.redes r where r.empresa_id = u.empresa_id and r.ip = v_ip);
end $$;

create function fab.checa_wifi(u fab.perfis) returns void language plpgsql stable as $$
begin
  if not fab.rede_liberada(u) then raise exception 'WIFI'; end if;
end $$;

create function fab.etapa_do_setor(p_setor text) returns fab.etapa language sql immutable as $$
  select case
    when lower(p_setor) like '%cort%'                                      then 'Corte'::fab.etapa
    when lower(p_setor) like '%costur%' or lower(p_setor) like '%produ%'    then 'Costura'::fab.etapa
    when lower(p_setor) like '%confer%' or lower(p_setor) like '%estoque%'  then 'Conferência'::fab.etapa
  end
$$;

create function fab.saldo_linhas(p_emp uuid)
returns table (modelo text, cor text, tamanho text, corte integer, costura integer, conf integer)
language sql stable as $$
  select l.modelo, l.cor, l.tamanho,
         coalesce(sum(l.qtd) filter (where l.etapa = 'Corte'), 0)::integer,
         coalesce(sum(l.qtd) filter (where l.etapa = 'Costura'), 0)::integer,
         coalesce(sum(l.qtd) filter (where l.etapa = 'Conferência'), 0)::integer
  from fab.lancamentos l
  where l.empresa_id = p_emp and l.apagado_em is null
  group by l.modelo, l.cor, l.tamanho
$$;

create function fab.falta_feito(f fab.em_falta) returns integer language sql stable as $$
  select coalesce(sum(l.qtd), 0)::integer
  from fab.lancamentos l
  where l.empresa_id = f.empresa_id and l.apagado_em is null and l.etapa = 'Conferência' and l.criado_em >= f.criado_em
    and l.modelo = f.modelo and (f.cor = '' or l.cor = f.cor) and (f.tamanho = '' or l.tamanho = f.tamanho)
$$;

create function fab.em_falta_json(p_emp uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'modelo', f.modelo, 'cor', f.cor,
           'tamanho', case when f.tamanho = '' then 'Todos' else f.tamanho end,
           'qtd', f.qtd, 'feito', x.feito, 'falta', greatest(f.qtd - x.feito, 0),
           'criado', to_char(f.criado_em at time zone fab.fuso(p_emp), 'YYYY-MM-DD"T"HH24:MI'),
           'obs', f.obs, 'status', f.status)
         order by (f.status = 'Urgente') desc, f.criado_em desc), '[]'::jsonb)
  from fab.em_falta f
  cross join lateral (select fab.falta_feito(f) as feito) x
  where f.empresa_id = p_emp and f.status <> 'Feito'
$$;

create function fab.baixa_automatica() returns trigger language plpgsql as $$
begin
  if new.etapa = 'Conferência' then
    update fab.em_falta f
       set status = 'Feito', concluido_em = now()
     where f.empresa_id = new.empresa_id and f.status <> 'Feito' and f.qtd > 0 and f.modelo = new.modelo
       and (f.cor = '' or f.cor = new.cor) and (f.tamanho = '' or f.tamanho = new.tamanho)
       and fab.falta_feito(f) >= f.qtd;
  end if;
  return null;
end $$;
create trigger lancamentos_baixa after insert or update of qtd, apagado_em on fab.lancamentos
  for each row execute function fab.baixa_automatica();

create function fab.editados_json(p_emp uuid, p_ini date, p_fim date) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', pf.nome, 'etapa', l.etapa, 'modelo', l.modelo, 'cor', l.cor, 'tamanho', l.tamanho,
           'qtd', l.qtd, 'edicoes', l.edicoes, 'hist', l.historico, 'data', l.dia)
         order by l.criado_em desc), '[]'::jsonb)
  from fab.lancamentos l join fab.perfis pf on pf.id = l.user_id
  where l.empresa_id = p_emp and l.apagado_em is null and l.edicoes > 0 and l.dia between p_ini and p_fim
$$;

create function fab.lista_json(p_emp uuid, p_tipo text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(nome order by ordem, nome), '[]'::jsonb) from fab.itens_lista where empresa_id = p_emp and tipo = p_tipo
$$;

-- p_user nulo + p_leitura = link de acompanhamento ("só ver") da empresa p_emp.
create function fab.montar_boot(p_emp uuid, p_user fab.perfis, p_leitura boolean) returns jsonb language plpgsql stable as $$
declare cfg fab.configuracao; hoje date := fab.hoje(p_emp); p fab.ponto; e fab.empresas;
begin
  cfg := fab.cfg(p_emp);
  select * into e from fab.empresas where id = p_emp;
  if p_user.id is not null then
    select * into p from fab.ponto po where po.user_id = p_user.id and po.dia = hoje;
  end if;
  return jsonb_build_object(
    'eu', jsonb_build_object(
      'nome', case when p_leitura then 'Acompanhamento (só ver)' else p_user.nome end,
      'setor', case when p_leitura then 'Administração' else p_user.setor end,
      'admin', not p_leitura and p_user.perfil = 'admin',
      'leitura', p_leitura,
      'podeFalta', not p_leitura and p_user.pode_falta,
      'demo', false,
      'financeiro', not p_leitura and p_user.perfil = 'admin',
      'dono', not p_leitura and fab.sou_dono()),
    'empresa', jsonb_build_object('codigo', e.codigo, 'nome', e.nome),
    'hoje', hoje,
    'ponto', jsonb_build_object('entrada', fab.hm(p.entrada), 'saida', fab.hm(p.saida), 'extra', fab.fmt_min(p.extra_min)),
    'horaFim', fab.hm(cfg.hora_fim),
    'exigirWifi', cfg.exigir_wifi,
    'etapas', to_jsonb(enum_range(null::fab.etapa)::text[]),
    'modelos', fab.lista_json(p_emp, 'modelo'),
    'cores', fab.lista_json(p_emp, 'cor'),
    'tamanhos', fab.lista_json(p_emp, 'tamanho'),
    'disponivel', (select coalesce(jsonb_agg(jsonb_build_object(
                      'modelo', s.modelo, 'cor', s.cor, 'tamanho', s.tamanho,
                      'Corte', s.corte, 'Costura', s.costura, 'Conferência', s.conf)), '[]'::jsonb)
                   from fab.saldo_linhas(p_emp) s),
    'meusHoje', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', l.id, 'modelo', l.modelo, 'cor', l.cor, 'tamanho', l.tamanho,
                    'hora', to_char(l.criado_em at time zone cfg.fuso, 'HH24:MI'), 'etapa', l.etapa,
                    'qtd', l.qtd, 'edicoes', l.edicoes, 'hist', l.historico) order by l.criado_em desc), '[]'::jsonb)
                 from fab.lancamentos l
                 where l.user_id = p_user.id and l.dia = hoje and l.apagado_em is null),
    'emFalta', fab.em_falta_json(p_emp));
end $$;

create function fab.montar_painel(p_emp uuid) returns jsonb language plpgsql stable as $$
declare hoje date := fab.hoje(p_emp);
begin
  return jsonb_build_object(
    'presenca', (select coalesce(jsonb_agg(jsonb_build_object(
                    'nome', pf.nome, 'setor', pf.setor, 'entrada', fab.hm(po.entrada), 'saida', fab.hm(po.saida),
                    'extra', fab.fmt_min(po.extra_min)) order by pf.nome), '[]'::jsonb)
                 from fab.perfis pf
                 left join fab.ponto po on po.user_id = pf.id and po.dia = hoje
                 where pf.empresa_id = p_emp and pf.ativo and pf.perfil = 'funcionario'),
    'prodHoje', (select jsonb_object_agg(e::text,
                    coalesce((select sum(l.qtd) from fab.lancamentos l
                              where l.empresa_id = p_emp and l.etapa = e and l.dia = hoje and l.apagado_em is null), 0))
                 from unnest(enum_range(null::fab.etapa)) e),
    'editados', fab.editados_json(p_emp, hoje, hoje),
    'saldo', (select coalesce(jsonb_agg(jsonb_build_object(
                  'modelo', s.modelo, 'cor', s.cor, 'tamanho', s.tamanho,
                  'corte', s.corte, 'costura', s.costura, 'conf', s.conf,
                  'naCostura', greatest(s.corte - s.costura, 0), 'naConf', greatest(s.costura - s.conf, 0),
                  'erro', s.costura > s.corte or s.conf > s.costura) order by s.modelo, s.cor, s.tamanho), '[]'::jsonb)
              from fab.saldo_linhas(p_emp) s));
end $$;

create function fab.montar_relatorio(p_emp uuid, p_ini date, p_fim date) returns jsonb language plpgsql stable as $$
begin
  if p_ini is null or p_fim is null or p_ini > p_fim then raise exception 'Período inválido.'; end if;
  if p_fim - p_ini > 366 then raise exception 'Escolha no máximo 1 ano.'; end if;
  return jsonb_build_object(
    'porEtapa', (select jsonb_object_agg(e::text,
                    coalesce((select sum(l.qtd) from fab.lancamentos l
                              where l.empresa_id = p_emp and l.etapa = e and l.dia between p_ini and p_fim and l.apagado_em is null), 0))
                 from unnest(enum_range(null::fab.etapa)) e),
    'porModelo', (select coalesce(jsonb_agg(jsonb_build_object(
                      'modelo', m.modelo, 'cor', m.cor, 'tamanho', m.tamanho,
                      'Corte', m.corte, 'Costura', m.costura, 'Conferência', m.conf) order by m.modelo, m.cor, m.tamanho), '[]'::jsonb)
                  from (select l.modelo, l.cor, l.tamanho,
                               coalesce(sum(l.qtd) filter (where l.etapa = 'Corte'), 0) as corte,
                               coalesce(sum(l.qtd) filter (where l.etapa = 'Costura'), 0) as costura,
                               coalesce(sum(l.qtd) filter (where l.etapa = 'Conferência'), 0) as conf
                        from fab.lancamentos l
                        where l.empresa_id = p_emp and l.apagado_em is null and l.dia between p_ini and p_fim
                        group by l.modelo, l.cor, l.tamanho) m),
    'porPessoa', (select coalesce(jsonb_agg(jsonb_build_object('nome', x.nome, 'etapa', x.etapa, 'qtd', x.qtd)
                                            order by x.nome, x.etapa), '[]'::jsonb)
                  from (select pf.nome, l.etapa, sum(l.qtd)::integer as qtd
                        from fab.lancamentos l join fab.perfis pf on pf.id = l.user_id
                        where l.empresa_id = p_emp and l.apagado_em is null and l.dia between p_ini and p_fim
                        group by pf.nome, l.etapa) x),
    'diasUteis', (select count(*) from fab.dias_uteis(p_emp, p_ini, p_fim)),
    'pessoas', (select coalesce(jsonb_agg(jsonb_build_object(
                    'nome', pf.nome, 'diasTrab', coalesce(a.dias, 0),
                    'horas', fab.fmt_hm(a.horas), 'extras', fab.fmt_hm(a.extras),
                    'faltas', coalesce(f.faltas, '[]'::jsonb), 'semSaida', coalesce(a.autos, 0)) order by pf.nome), '[]'::jsonb)
                from fab.perfis pf
                left join lateral (
                  select count(*)::integer as dias,
                         sum(case when po.saida is not null then greatest(fab.min_de(po.saida) - fab.min_de(po.entrada), 0) else 0 end)::integer as horas,
                         sum(po.extra_min)::integer as extras,
                         (count(*) filter (where po.automatico))::integer as autos
                  from fab.ponto po where po.user_id = pf.id and po.dia between p_ini and p_fim) a on true
                left join lateral (
                  select jsonb_agg(d order by d) as faltas
                  from fab.dias_uteis(p_emp, p_ini, p_fim) d
                  where d >= (pf.criado_em at time zone fab.fuso(p_emp))::date
                    and not exists (select 1 from fab.ponto po where po.user_id = pf.id and po.dia = d)) f on true
                where pf.empresa_id = p_emp and pf.ativo and pf.perfil = 'funcionario'),
    'registros', (select coalesce(jsonb_agg(jsonb_build_object(
                      'data', po.dia, 'nome', pf.nome, 'entrada', fab.hm(po.entrada), 'saida', fab.hm(po.saida),
                      'extra', fab.fmt_min(po.extra_min), 'auto', po.automatico) order by po.dia desc, pf.nome), '[]'::jsonb)
                  from fab.ponto po join fab.perfis pf on pf.id = po.user_id
                  where po.empresa_id = p_emp and po.dia between p_ini and p_fim),
    'editados', fab.editados_json(p_emp, p_ini, p_fim));
end $$;

-- Fecha pontos esquecidos de DIAS ANTERIORES (saída na hora de fechamento, sem hora extra).
-- O dia de hoje nunca é fechado aqui: quem faz hora extra marca a própria saída.
create function fab.fechar_pendentes() returns integer language plpgsql as $$
declare n integer;
begin
  update fab.ponto po
     set saida = greatest(po.entrada, c.hora_fim), extra_min = 0, automatico = true
    from fab.configuracao c
   where c.empresa_id = po.empresa_id
     and po.saida is null
     and po.dia < fab.hoje(po.empresa_id);
  get diagnostics n = row_count;
  return n;
end $$;

create function fab.chave_empresa(p_chave text) returns uuid language sql stable as $$
  select c.empresa_id from fab.chaves_acesso c join fab.empresas e on e.id = c.empresa_id
   where p_chave is not null and length(p_chave) >= 16 and c.ativo and e.ativa
     and c.chave_hash = encode(sha256(convert_to(p_chave, 'UTF8')), 'hex')
$$;
