-- =====================================================================
-- Período de teste (link de convite) + controles extras do administrador
--  * O dono do sistema gera um LINK DE TESTE (convite). Quem abre cria a própria empresa e usa por
--    N dias (padrão 7). Vencido o prazo, ninguém da empresa entra até o dono estender ou tornar cliente.
--    O link guarda só o hash do código; pode valer para 1 ou várias empresas e tem validade própria.
--  * Administrador: bloquear/desbloquear pessoa com um clique (derruba as sessões abertas) e
--    "tempo logado" (do login ao último sinal) além do "tempo ativo".
-- =====================================================================

alter table fab.empresas add column teste_ate timestamptz;

create table fab.convites (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  criado_por uuid references auth.users (id) on delete set null,
  nota       text not null default '',
  dias_teste integer not null default 7 check (dias_teste between 1 and 90),
  usos_max   integer not null default 1 check (usos_max between 1 and 500),
  usos       integer not null default 0,
  expira_em  timestamptz not null,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
create index convites_criado_por_idx on fab.convites (criado_por);
alter table fab.convites enable row level security;
revoke all on fab.convites from public;

alter table fab.empresas add column convite_id uuid references fab.convites (id) on delete set null;
create index empresas_convite_idx on fab.empresas (convite_id);

create function fab.hash_token(p text) returns text language sql immutable set search_path = '' as
$$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;

-- empresa bloqueada OU teste vencido: ninguém entra
create or replace function fab.empresa_ativa(p_emp uuid) returns void language plpgsql stable set search_path = '' as $$
declare e fab.empresas;
begin
  select * into e from fab.empresas where id = p_emp;
  if not found or not e.ativa then raise exception 'EMPRESA_BLOQUEADA'; end if;
  if e.teste_ate is not null and e.teste_ate < now() then raise exception 'EMPRESA_TESTE_EXPIRADO'; end if;
end $$;

create or replace function fab.chave_empresa(p_chave text) returns uuid language sql stable set search_path = '' as $$
  select c.empresa_id from fab.chaves_acesso c join fab.empresas e on e.id = c.empresa_id
   where p_chave is not null and length(p_chave) >= 16 and c.ativo and e.ativa
     and (e.teste_ate is null or e.teste_ate >= now())
     and c.chave_hash = fab.hash_token(p_chave)
$$;

-- ---------------------------------------------------------------- convites (dono do sistema)
create function public.fab_criar_convite(p_dias integer, p_usos integer, p_validade_dias integer, p_nota text) returns text
language plpgsql security definer set search_path = '' as $$
declare t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  perform fab.exige_dono();
  insert into fab.convites (token_hash, criado_por, nota, dias_teste, usos_max, expira_em)
  values (fab.hash_token(t), auth.uid(), left(coalesce(btrim(p_nota), ''), 120), coalesce(p_dias, 7), coalesce(p_usos, 1),
          now() + make_interval(days => least(greatest(coalesce(p_validade_dias, 30), 1), 365)));
  return t;  -- aparece só agora; no banco fica o hash
end $$;

create function public.fab_convites() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fab.exige_dono();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nota', c.nota, 'diasTeste', c.dias_teste, 'usosMax', c.usos_max, 'usos', c.usos, 'ativo', c.ativo,
      'expiraEm', to_char(c.expira_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'),
      'criadoEm', to_char(c.criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'),
      'empresas', coalesce((select jsonb_agg(e.nome order by e.criado_em) from fab.empresas e where e.convite_id = c.id), '[]'::jsonb))
    order by c.criado_em desc) from fab.convites c), '[]'::jsonb);
end $$;

create function public.fab_revogar_convite(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform fab.exige_dono();
  update fab.convites set ativo = false where id = p_id;
end $$;

-- Para a tela pública do link: o convite ainda vale? (não revela nada além disso)
create function public.fab_validar_convite(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('valido', true, 'dias', c.dias_teste)
                     from fab.convites c
                    where c.token_hash = fab.hash_token(p_token) and length(coalesce(p_token, '')) >= 32
                      and c.ativo and c.usos < c.usos_max and c.expira_em > now()),
                  jsonb_build_object('valido', false, 'dias', 0))
$$;

-- Usado pela função de borda (service_role): consome um uso do convite e cria a empresa em teste.
create function public.fab_criar_empresa_teste(p_token text, p_codigo text, p_nome text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c fab.convites; v_id uuid;
begin
  update fab.convites set usos = usos + 1
   where token_hash = fab.hash_token(p_token) and length(coalesce(p_token, '')) >= 32
     and ativo and usos < usos_max and expira_em > now()
  returning * into c;
  if not found then raise exception 'Este link de teste não vale mais. Peça um novo.'; end if;
  begin
    insert into fab.empresas (codigo, nome, teste_ate, convite_id)
    values (lower(btrim(p_codigo)), btrim(p_nome), now() + make_interval(days => c.dias_teste), c.id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe uma empresa com esse código. Escolha outro.';
  when check_violation then
    raise exception 'Código inválido: use 2 a 30 letras minúsculas, números ou hífen.';
  end;
  return v_id;
end $$;

-- Desfaz a criação (se o usuário não puder ser criado): devolve o uso do convite.
create function public.fab_desfazer_empresa_teste(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_conv uuid;
begin
  delete from fab.empresas e where e.id = p_id and e.teste_ate is not null
     and not exists (select 1 from fab.perfis p where p.empresa_id = e.id)
  returning convite_id into v_conv;
  if v_conv is not null then update fab.convites set usos = greatest(usos - 1, 0) where id = v_conv; end if;
end $$;

-- Dono: estender o teste (p_dias > 0) ou tornar cliente definitivo (p_dias null)
create function public.fab_ajustar_teste(p_empresa uuid, p_dias integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform fab.exige_dono();
  update fab.empresas
     set teste_ate = case when p_dias is null then null
                          else greatest(coalesce(teste_ate, now()), now()) + make_interval(days => p_dias) end
   where id = p_empresa;
end $$;

-- Qualquer pessoa logada: até quando vai o teste da minha empresa (null = cliente)
create function public.fab_meu_teste() returns text
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.eu();
begin
  return (select to_char(e.teste_ate at time zone fab.fuso(e.id), 'YYYY-MM-DD"T"HH24:MI') from fab.empresas e where e.id = u.empresa_id);
end $$;

-- Lista de empresas do dono: + teste, convite e uso dos últimos 7 dias
create or replace function public.fab_empresas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fab.exige_dono();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id, 'codigo', e.codigo, 'nome', e.nome, 'ativa', e.ativa, 'motivo', e.motivo_bloqueio,
            'criadaEm', to_char(e.criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
            'testeAte', coalesce(to_char(e.teste_ate at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'), ''),
            'porLink', e.convite_id is not null,
            'usuarios', (select count(*) from fab.perfis p where p.empresa_id = e.id and p.ativo),
            'admins', (select count(*) from fab.perfis p where p.empresa_id = e.id and p.ativo and p.perfil = 'admin'),
            'ultimoAcesso', (select to_char(max(au.last_sign_in_at) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI')
                               from fab.perfis p join auth.users au on au.id = p.id where p.empresa_id = e.id),
            'tempo7d', (select coalesce(sum(s.ativo_seg), 0) from fab.sessoes s where s.empresa_id = e.id and s.criado_em > now() - interval '7 days'),
            'entradas7d', (select count(*) from fab.sessoes s where s.empresa_id = e.id and s.criado_em > now() - interval '7 days' and s.status in ('aprovada', 'encerrada')),
            'acoes7d', (select count(*) from fab.eventos v where v.empresa_id = e.id and v.em > now() - interval '7 days' and v.tipo in ('criou', 'alterou', 'apagou')))
          order by e.nome), '[]'::jsonb)
          from fab.empresas e);
end $$;

-- ---------------------------------------------------------------- administrador: bloquear pessoa
create function public.fab_bloquear_pessoa(p_login text, p_bloquear boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); alvo fab.perfis;
begin
  select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_login)) for update;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  if alvo.id = u.id then raise exception 'Você não pode bloquear a sua própria conta.'; end if;
  if p_bloquear and alvo.perfil = 'admin' and alvo.ativo
     and (select count(*) from fab.perfis where empresa_id = u.empresa_id and perfil = 'admin' and ativo) <= 1 then
    raise exception 'Precisa existir pelo menos um administrador ativo.';
  end if;
  update fab.perfis set ativo = not p_bloquear where id = alvo.id;   -- o gatilho de auditoria registra a mudança
  if p_bloquear then
    update fab.sessoes set status = 'encerrada' where user_id = alvo.id and status in ('aprovada', 'pendente');
  end if;
  perform fab.registrar(u.empresa_id, u.id, u.nome, case when p_bloquear then 'pessoa_bloqueada' else 'pessoa_desbloqueada' end, alvo.nome, '{}'::jsonb);
end $$;

-- tempo logado (login -> último sinal) nas sessões e nas métricas
create or replace function fab.sessao_json(s fab.sessoes) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'nome', p.nome, 'login', p.login, 'setor', p.setor, 'perfil', p.perfil::text,
    'aparelho', s.descricao, 'ip', s.ip, 'status', s.status, 'tela', s.tela, 'ativoSeg', s.ativo_seg,
    'logadoSeg', greatest(0, extract(epoch from s.ultimo_em - s.criado_em))::int,
    'inicio', to_char(s.criado_em at time zone fab.fuso(s.empresa_id), 'YYYY-MM-DD"T"HH24:MI:SS'),
    'ultimo', to_char(s.ultimo_em at time zone fab.fuso(s.empresa_id), 'YYYY-MM-DD"T"HH24:MI:SS'),
    'decididoPor', coalesce((select d.nome from fab.perfis d where d.id = s.decidido_por), ''),
    'confiavel', exists (select 1 from fab.aparelhos_confiaveis a where a.user_id = s.user_id and a.aparelho = s.aparelho and s.aparelho <> ''))
  from fab.perfis p where p.id = s.user_id
$$;

create or replace function public.fab_acessos(p_ini date, p_fim date) returns jsonb
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
                    'nome', p.nome, 'login', p.login, 'perfil', p.perfil::text, 'ativo', p.ativo, 'eu', p.id = u.id,
                    'entradas', (select count(*) from fab.sessoes s where s.user_id = p.id and s.criado_em >= ini and s.criado_em < fim and s.status in ('aprovada', 'encerrada')),
                    'negados', (select count(*) from fab.sessoes s where s.user_id = p.id and s.criado_em >= ini and s.criado_em < fim and s.status = 'negada'),
                    'tempoSeg', (select coalesce(sum(s.ativo_seg), 0) from fab.sessoes s where s.user_id = p.id and s.criado_em >= ini and s.criado_em < fim),
                    'logadoSeg', (select coalesce(sum(greatest(0, extract(epoch from s.ultimo_em - s.criado_em))), 0)::bigint from fab.sessoes s
                                   where s.user_id = p.id and s.criado_em >= ini and s.criado_em < fim and s.status in ('aprovada', 'encerrada')),
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
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_criar_convite', 'fab_convites', 'fab_revogar_convite', 'fab_validar_convite',
              'fab_criar_empresa_teste', 'fab_desfazer_empresa_teste', 'fab_ajustar_teste', 'fab_meu_teste', 'fab_bloquear_pessoa', 'fab_empresas', 'fab_acessos')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if f.proname in ('fab_criar_empresa_teste', 'fab_desfazer_empresa_teste') then
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
    else
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    end if;
    if f.proname = 'fab_validar_convite' and exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;
