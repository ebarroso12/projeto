-- Fábrica · modelo de dados
--
-- Decisões de projeto:
--  * Todas as tabelas ficam no schema "fab", que NÃO é exposto pela API do Supabase.
--    O app só enxerga as funções "fab_*" do schema public (migração 3), que aplicam as regras.
--  * RLS ligada em tudo (defesa em profundidade): mesmo que um schema seja exposto por engano,
--    sem política nenhuma ninguém lê nada.
--  * Lançamentos nunca são apagados de verdade: ficam com apagado_em e um log de auditoria.

create schema if not exists fab;

create type fab.perfil        as enum ('admin', 'funcionario');
create type fab.etapa         as enum ('Corte', 'Costura', 'Conferência');   -- a ordem do enum é a ordem da produção
create type fab.status_falta  as enum ('Urgente', 'Em produção', 'Feito');

-- ---------- pessoas ----------
create table fab.perfis (
  id         uuid primary key references auth.users (id) on delete cascade,
  login      text not null unique check (login ~ '^[a-z0-9._-]{2,32}$'),
  nome       text not null check (length(btrim(nome)) > 0),
  setor      text not null default 'Outra',
  perfil     fab.perfil not null default 'funcionario',
  ativo      boolean not null default true,
  pode_falta boolean not null default false,
  criado_em  timestamptz not null default now()
);

-- ---------- configuração (linha única) ----------
create table fab.configuracao (
  id          boolean primary key default true check (id),
  exigir_wifi boolean not null default false,
  hora_fim    time    not null default '17:30',
  fuso        text    not null default 'America/Sao_Paulo'
);
insert into fab.configuracao default values;

create table fab.redes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ip        text not null unique,
  criado_em timestamptz not null default now()
);

-- Dias sem expediente (feriados, recesso): não contam como falta.
create table fab.dias_sem_expediente (
  dia    date primary key,
  motivo text not null default ''
);

-- ---------- listas de produção ----------
create table fab.itens_lista (
  tipo  text    not null check (tipo in ('modelo', 'cor', 'tamanho')),
  nome  text    not null check (length(btrim(nome)) between 1 and 60),
  ordem integer not null default 0,
  primary key (tipo, nome)
);

-- ---------- produção ----------
create table fab.lancamentos (
  id         uuid primary key default gen_random_uuid(),
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
create index lancamentos_dia_idx    on fab.lancamentos (dia)                       where apagado_em is null;
create index lancamentos_combo_idx  on fab.lancamentos (modelo, cor, tamanho, etapa) where apagado_em is null;
create index lancamentos_user_idx   on fab.lancamentos (user_id, dia);

create table fab.lancamento_log (
  id            bigint generated always as identity primary key,
  lancamento_id uuid    not null,
  user_id       uuid    not null,
  acao          text    not null check (acao in ('editar', 'apagar')),
  antes         integer,
  depois        integer,
  em            timestamptz not null default now()
);

-- ---------- ponto ----------
create table fab.ponto (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references fab.perfis (id),
  dia        date not null,
  entrada    time not null,
  saida      time,
  extra_min  integer not null default 0 check (extra_min >= 0),
  automatico boolean not null default false,
  unique (user_id, dia)            -- impede duas entradas no mesmo dia, mesmo com toque duplo
);
create index ponto_dia_idx on fab.ponto (dia);

-- ---------- itens em falta ----------
create table fab.em_falta (
  id           uuid primary key default gen_random_uuid(),
  modelo       text not null,
  cor          text not null default '',      -- '' = todas
  tamanho      text not null default '',      -- '' = todos
  qtd          integer not null default 0 check (qtd >= 0),
  obs          text not null default '',
  status       fab.status_falta not null default 'Urgente',
  criado_em    timestamptz not null default now(),
  criado_por   uuid references fab.perfis (id),
  concluido_em timestamptz
);
create index em_falta_aberto_idx on fab.em_falta (criado_em) where status <> 'Feito';

-- ---------- links de acompanhamento ("só ver") ----------
create table fab.chaves_acesso (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  chave_hash text not null unique,            -- sha256 da chave; a chave em si nunca é guardada
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- ---------- segurança ----------
alter table fab.perfis              enable row level security;
alter table fab.configuracao        enable row level security;
alter table fab.redes               enable row level security;
alter table fab.dias_sem_expediente enable row level security;
alter table fab.itens_lista         enable row level security;
alter table fab.lancamentos         enable row level security;
alter table fab.lancamento_log      enable row level security;
alter table fab.ponto               enable row level security;
alter table fab.em_falta            enable row level security;
alter table fab.chaves_acesso       enable row level security;

-- Nenhuma política: só as funções "security definer" (dono do banco) acessam as tabelas.
revoke all on schema fab from public;
revoke all on all tables in schema fab from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon')          then revoke all on schema fab from anon;          revoke all on all tables in schema fab from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on schema fab from authenticated; revoke all on all tables in schema fab from authenticated; end if;
end $$;
