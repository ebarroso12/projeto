-- =====================================================================
-- Dois tipos de link + vigilância das empresas (principalmente as em teste)
--  * TESTE: o prazo conta do ENVIO. O link e o teste vencem juntos (criado_em + dias), mesmo que a
--    pessoa se cadastre no último dia.
--  * PRO:   cria a empresa já na versão completa (sem prazo). O link tem validade própria.
--  * fab_empresa_detalhe: ficha completa de uma empresa para o dono (uso por dia, pessoas, sessões,
--    ações por módulo, implantação e linha do tempo).
-- =====================================================================

alter table fab.convites add column tipo text not null default 'teste' check (tipo in ('teste', 'pro'));

drop function public.fab_criar_convite(integer, integer, integer, text);
create function public.fab_criar_convite(p_tipo text, p_dias integer, p_usos integer, p_validade_dias integer, p_nota text) returns text
language plpgsql security definer set search_path = '' as $$
declare t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); v_tipo text := coalesce(p_tipo, 'teste');
begin
  perform fab.exige_dono();
  if v_tipo not in ('teste', 'pro') then raise exception 'Tipo de link inválido.'; end if;
  insert into fab.convites (tipo, token_hash, criado_por, nota, dias_teste, usos_max, expira_em)
  values (v_tipo, fab.hash_token(t), auth.uid(), left(coalesce(btrim(p_nota), ''), 120), coalesce(p_dias, 7), coalesce(p_usos, 1),
          case when v_tipo = 'teste' then now() + make_interval(days => coalesce(p_dias, 7))   -- teste: vence junto com o prazo
               else now() + make_interval(days => least(greatest(coalesce(p_validade_dias, 30), 1), 365)) end);
  return t;
end $$;

create or replace function public.fab_validar_convite(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('valido', true, 'tipo', c.tipo, 'dias', c.dias_teste,
                            'ate', case when c.tipo = 'teste' then to_char((c.criado_em + make_interval(days => c.dias_teste)) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') else '' end)
                     from fab.convites c
                    where c.token_hash = fab.hash_token(p_token) and length(coalesce(p_token, '')) >= 32
                      and c.ativo and c.usos < c.usos_max and c.expira_em > now()),
                  jsonb_build_object('valido', false, 'tipo', '', 'dias', 0, 'ate', ''))
$$;

create or replace function public.fab_criar_empresa_teste(p_token text, p_codigo text, p_nome text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c fab.convites; v_id uuid;
begin
  update fab.convites set usos = usos + 1
   where token_hash = fab.hash_token(p_token) and length(coalesce(p_token, '')) >= 32
     and ativo and usos < usos_max and expira_em > now()
  returning * into c;
  if not found then raise exception 'Este link não vale mais. Peça um novo.'; end if;
  begin
    insert into fab.empresas (codigo, nome, teste_ate, convite_id)
    values (lower(btrim(p_codigo)), btrim(p_nome),
            case when c.tipo = 'teste' then c.criado_em + make_interval(days => c.dias_teste) end, c.id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe uma empresa com esse código. Escolha outro.';
  when check_violation then
    raise exception 'Código inválido: use 2 a 30 letras minúsculas, números ou hífen.';
  end;
  return v_id;
end $$;

create or replace function public.fab_convites() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fab.exige_dono();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'tipo', c.tipo, 'nota', c.nota, 'diasTeste', c.dias_teste, 'usosMax', c.usos_max, 'usos', c.usos, 'ativo', c.ativo,
      'expiraEm', to_char(c.expira_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'),
      'criadoEm', to_char(c.criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'),
      'empresas', coalesce((select jsonb_agg(e.nome order by e.criado_em) from fab.empresas e where e.convite_id = c.id), '[]'::jsonb))
    order by c.criado_em desc) from fab.convites c), '[]'::jsonb);
end $$;

-- implantação: o que a empresa já fez (0 a 6)
create function fab.implantacao(p_emp uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'listas', exists (select 1 from fab.itens_lista where empresa_id = p_emp),
    'equipe', (select count(*) from fab.perfis where empresa_id = p_emp and ativo) > 1,
    'producao', exists (select 1 from fab.lancamentos where empresa_id = p_emp),
    'ponto', exists (select 1 from fab.ponto where empresa_id = p_emp),
    'financeiro', exists (select 1 from fab.fin_lancamentos where empresa_id = p_emp),
    'resultado', exists (select 1 from fab.dre_meses where empresa_id = p_emp))
$$;

create or replace function public.fab_empresas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fab.exige_dono();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id, 'codigo', e.codigo, 'nome', e.nome, 'ativa', e.ativa, 'motivo', e.motivo_bloqueio,
            'criadaEm', to_char(e.criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
            'testeAte', coalesce(to_char(e.teste_ate at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'), ''),
            'porLink', e.convite_id is not null,
            'tipoLink', coalesce((select c.tipo from fab.convites c where c.id = e.convite_id), ''),
            'usuarios', (select count(*) from fab.perfis p where p.empresa_id = e.id and p.ativo),
            'admins', (select count(*) from fab.perfis p where p.empresa_id = e.id and p.ativo and p.perfil = 'admin'),
            'ultimoAcesso', (select to_char(max(s.ultimo_em) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') from fab.sessoes s where s.empresa_id = e.id),
            'tempo7d', (select coalesce(sum(s.ativo_seg), 0) from fab.sessoes s where s.empresa_id = e.id and s.criado_em > now() - interval '7 days'),
            'entradas7d', (select count(*) from fab.sessoes s where s.empresa_id = e.id and s.criado_em > now() - interval '7 days' and s.status in ('aprovada', 'encerrada')),
            'acoes7d', (select count(*) from fab.eventos v where v.empresa_id = e.id and v.em > now() - interval '7 days' and v.tipo in ('criou', 'alterou', 'apagou')),
            'pessoas7d', (select count(distinct s.user_id) from fab.sessoes s where s.empresa_id = e.id and s.criado_em > now() - interval '7 days'),
            'online', (select count(*) from fab.sessoes s where s.empresa_id = e.id and s.status = 'aprovada' and s.ultimo_em > now() - interval '3 minutes'),
            'implantacao', fab.implantacao(e.id))
          order by e.nome), '[]'::jsonb)
          from fab.empresas e);
end $$;

-- Ficha completa de uma empresa (só o dono)
create function public.fab_empresa_detalhe(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e fab.empresas; fz text := 'America/Sao_Paulo';
begin
  perform fab.exige_dono();
  select * into e from fab.empresas where id = p_id;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  return jsonb_build_object(
    'nome', e.nome, 'codigo', e.codigo,
    'implantacao', fab.implantacao(e.id),
    'dias', coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'entradas', d.entradas, 'tempoSeg', d.tempo, 'acoes', d.acoes, 'pessoas', d.pessoas) order by d.dia)
              from (select to_char(g.dia, 'YYYY-MM-DD') as dia,
                           (select count(*) from fab.sessoes s where s.empresa_id = e.id and (s.criado_em at time zone fz)::date = g.dia and s.status in ('aprovada', 'encerrada')) as entradas,
                           (select coalesce(sum(s.ativo_seg), 0) from fab.sessoes s where s.empresa_id = e.id and (s.criado_em at time zone fz)::date = g.dia) as tempo,
                           (select count(*) from fab.eventos v where v.empresa_id = e.id and (v.em at time zone fz)::date = g.dia and v.tipo in ('criou', 'alterou', 'apagou')) as acoes,
                           (select count(distinct s.user_id) from fab.sessoes s where s.empresa_id = e.id and (s.criado_em at time zone fz)::date = g.dia) as pessoas
                      from generate_series((now() at time zone fz)::date - 13, (now() at time zone fz)::date, interval '1 day') as g(dia)) d), '[]'::jsonb),
    'pessoas', coalesce((select jsonb_agg(jsonb_build_object(
                 'nome', p.nome, 'login', p.login, 'perfil', p.perfil::text, 'setor', p.setor, 'ativo', p.ativo,
                 'entradas', (select count(*) from fab.sessoes s where s.user_id = p.id and s.status in ('aprovada', 'encerrada')),
                 'tempoSeg', (select coalesce(sum(s.ativo_seg), 0) from fab.sessoes s where s.user_id = p.id),
                 'logadoSeg', (select coalesce(sum(greatest(0, extract(epoch from s.ultimo_em - s.criado_em))), 0)::bigint from fab.sessoes s where s.user_id = p.id),
                 'acoes', (select count(*) from fab.eventos v where v.user_id = p.id and v.tipo in ('criou', 'alterou', 'apagou')),
                 'ultimo', (select to_char(max(s.ultimo_em) at time zone fz, 'YYYY-MM-DD"T"HH24:MI') from fab.sessoes s where s.user_id = p.id),
                 'aparelhos', (select count(distinct s.descricao) from fab.sessoes s where s.user_id = p.id))
               order by p.nome) from fab.perfis p where p.empresa_id = e.id), '[]'::jsonb),
    'modulos', coalesce((select jsonb_agg(jsonb_build_object('alvo', m.alvo, 'criou', m.criou, 'alterou', m.alterou, 'apagou', m.apagou) order by m.total desc)
                 from (select v.alvo, count(*) filter (where v.tipo = 'criou') as criou, count(*) filter (where v.tipo = 'alterou') as alterou,
                              count(*) filter (where v.tipo = 'apagou') as apagou, count(*) as total
                         from fab.eventos v where v.empresa_id = e.id and v.tipo in ('criou', 'alterou', 'apagou') group by v.alvo) m), '[]'::jsonb),
    'sessoes', coalesce((select jsonb_agg(fab.sessao_json(x) order by x.criado_em desc) from (
                 select * from fab.sessoes s where s.empresa_id = e.id order by s.criado_em desc limit 100) x), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'quem', v.quem, 'tipo', v.tipo, 'alvo', v.alvo, 'detalhe', v.detalhe,
                   'em', to_char(v.em at time zone fz, 'YYYY-MM-DD"T"HH24:MI:SS')) order by v.id desc) from (
                 select * from fab.eventos v where v.empresa_id = e.id order by v.id desc limit 300) v), '[]'::jsonb)
  );
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_criar_convite', 'fab_convites', 'fab_validar_convite', 'fab_criar_empresa_teste', 'fab_empresas', 'fab_empresa_detalhe')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if f.proname = 'fab_criar_empresa_teste' then
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
    else
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    end if;
    if f.proname = 'fab_validar_convite' and exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;
