-- =====================================================================
-- Estoque de matéria-prima (função "materiais")
--
-- saldo = entradas − saídas ± ajustes − consumo da produção
-- Consumo da produção: regras por material, etapa e modelo (modelo '' = todos), em quantidade por peça.
--   Ex.: Malha moletom · Corte · Moletom Canguru · 0,6 m por peça.
--   Regra específica do modelo substitui a regra geral (modelo '') da mesma etapa.
--   Calculado a partir dos lançamentos desde a data de início do material, então editar/apagar
--   um lançamento de produção corrige o estoque sozinho (não há baixa duplicada nem esquecida).
-- Entrada pode virar saída no Financeiro (compra), ligada ao fornecedor.
-- =====================================================================

create table fab.materiais (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  nome       text not null check (length(btrim(nome)) between 1 and 80),
  unidade    text not null default 'un' check (length(btrim(unidade)) between 1 and 12),
  minimo     numeric(14, 3) not null default 0 check (minimo >= 0),
  inicio     date not null,            -- consumo da produção conta a partir desta data
  ativo      boolean not null default true,
  obs        text not null default '',
  criado_em  timestamptz not null default now(),
  unique (empresa_id, nome)
);
alter table fab.materiais enable row level security;
revoke all on fab.materiais from public;
create trigger auditoria after insert or update or delete on fab.materiais for each row execute function fab.auditar();

create table fab.material_consumo (
  material_id  uuid not null references fab.materiais (id) on delete cascade,
  etapa        text not null,
  modelo       text not null default '',
  qtd_por_peca numeric(14, 4) not null check (qtd_por_peca > 0 and qtd_por_peca <= 100000),
  primary key (material_id, etapa, modelo)
);
alter table fab.material_consumo enable row level security;
revoke all on fab.material_consumo from public;

create table fab.material_movs (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references fab.empresas (id) on delete cascade,
  material_id       uuid not null references fab.materiais (id) on delete cascade,
  tipo              text not null check (tipo in ('entrada', 'saida', 'ajuste')),
  qtd               numeric(14, 3) not null check (qtd <> 0),        -- entrada/saída: positivo; ajuste: com sinal
  data              date not null,
  valor             numeric(14, 2) check (valor is null or valor >= 0), -- custo total da entrada
  fornecedor_id     uuid references fab.registros (id) on delete set null,
  fornecedor_nome   text not null default '',
  fin_lancamento_id uuid references fab.fin_lancamentos (id) on delete set null,
  obs               text not null default '',
  criado_por        uuid references fab.perfis (id) on delete set null,
  criado_em         timestamptz not null default now(),
  check (tipo = 'ajuste' or qtd > 0)
);
create index material_movs_mat_idx on fab.material_movs (material_id, data);
alter table fab.material_movs enable row level security;
revoke all on fab.material_movs from public;
create trigger auditoria after insert or update or delete on fab.material_movs for each row execute function fab.auditar();

-- consumo da produção de um material entre duas datas (inclusive)
create or replace function fab.material_consumo_periodo(p_mat uuid, p_ini date, p_fim date) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(l.qtd * c.qtd_por_peca), 0)
    from fab.materiais m
    join fab.material_consumo c on c.material_id = m.id
    join fab.lancamentos l on l.empresa_id = m.empresa_id and l.apagado_em is null and l.etapa::text = c.etapa
                          and l.dia between greatest(p_ini, m.inicio) and p_fim
                          and (c.modelo = l.modelo
                               or (c.modelo = '' and not exists (select 1 from fab.material_consumo c2
                                                                  where c2.material_id = m.id and c2.etapa = c.etapa and c2.modelo = l.modelo)))
   where m.id = p_mat
$$;

create or replace function fab.material_json(m fab.materiais, p_hoje date) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'nome', m.nome, 'unidade', m.unidade, 'minimo', m.minimo, 'inicio', m.inicio, 'ativo', m.ativo, 'obs', m.obs,
    'entradas', coalesce(mv.entradas, 0), 'saidas', coalesce(mv.saidas, 0), 'ajustes', coalesce(mv.ajustes, 0),
    'consumo', cons.total, 'consumo30', cons.d30,
    'saldo', round(coalesce(mv.entradas, 0) - coalesce(mv.saidas, 0) + coalesce(mv.ajustes, 0) - cons.total, 3),
    'custoMedio', case when coalesce(mv.qtd_com_valor, 0) > 0 then round(mv.valor_total / mv.qtd_com_valor, 4) end,
    'ultimaEntrada', mv.ultima_entrada,
    'regras', coalesce((select jsonb_agg(jsonb_build_object('etapa', c.etapa, 'modelo', c.modelo, 'qtdPorPeca', c.qtd_por_peca) order by c.etapa, c.modelo)
                          from fab.material_consumo c where c.material_id = m.id), '[]'::jsonb))
  from (select
          sum(qtd) filter (where tipo = 'entrada') as entradas, sum(qtd) filter (where tipo = 'saida') as saidas,
          sum(qtd) filter (where tipo = 'ajuste') as ajustes,
          sum(valor) filter (where tipo = 'entrada' and valor is not null) as valor_total,
          sum(qtd) filter (where tipo = 'entrada' and valor is not null) as qtd_com_valor,
          max(data) filter (where tipo = 'entrada') as ultima_entrada
          from fab.material_movs where material_id = m.id) mv,
       (select fab.material_consumo_periodo(m.id, m.inicio, p_hoje) as total,
               fab.material_consumo_periodo(m.id, p_hoje - 29, p_hoje) as d30) cons
$$;

create or replace function public.fab_materiais() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); v_hoje date;
begin
  v_hoje := fab.hoje(u.empresa_id);
  return coalesce((select jsonb_agg(fab.material_json(m, v_hoje) order by m.ativo desc, m.nome)
                     from fab.materiais m where m.empresa_id = u.empresa_id), '[]'::jsonb);
end $$;

create or replace function public.fab_salvar_material(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); v_id uuid := nullif(p ->> 'id', '')::uuid; it jsonb; e text; mo text; q numeric;
begin
  if coalesce(btrim(p ->> 'nome'), '') = '' then raise exception 'Informe o nome do material.'; end if;
  if coalesce(btrim(p ->> 'unidade'), '') = '' then raise exception 'Informe a unidade (kg, m, un…).'; end if;
  begin q := coalesce(nullif(p ->> 'minimo', '')::numeric, 0); exception when others then raise exception 'Estoque mínimo inválido.'; end;
  if q < 0 then raise exception 'Estoque mínimo inválido.'; end if;
  if v_id is null then
    if exists (select 1 from fab.materiais where empresa_id = u.empresa_id and lower(nome) = lower(btrim(p ->> 'nome'))) then raise exception 'Já existe um material com esse nome.'; end if;
    insert into fab.materiais (empresa_id, nome, unidade, minimo, inicio, obs)
    values (u.empresa_id, btrim(p ->> 'nome'), btrim(p ->> 'unidade'), q, coalesce(nullif(p ->> 'inicio', '')::date, fab.hoje(u.empresa_id)), coalesce(left(p ->> 'obs', 300), ''))
    returning id into v_id;
  else
    update fab.materiais set nome = btrim(p ->> 'nome'), unidade = btrim(p ->> 'unidade'), minimo = q,
           inicio = coalesce(nullif(p ->> 'inicio', '')::date, inicio), ativo = coalesce((p ->> 'ativo')::boolean, ativo), obs = coalesce(left(p ->> 'obs', 300), '')
     where id = v_id and empresa_id = u.empresa_id;
    if not found then raise exception 'Material não encontrado.'; end if;
  end if;
  if p ? 'regras' then
    if jsonb_typeof(p -> 'regras') <> 'array' or jsonb_array_length(p -> 'regras') > 200 then raise exception 'Regras de consumo inválidas.'; end if;
    delete from fab.material_consumo where material_id = v_id;
    for it in select * from jsonb_array_elements(p -> 'regras') loop
      e := it ->> 'etapa'; mo := btrim(coalesce(it ->> 'modelo', ''));
      if e is null or not (e = any (enum_range(null::fab.etapa)::text[])) then raise exception 'Etapa inválida.'; end if;
      if mo <> '' and not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'modelo' and nome = mo) then raise exception 'Modelo inválido: %', mo; end if;
      begin q := (it ->> 'qtdPorPeca')::numeric; exception when others then raise exception 'Consumo por peça inválido.'; end;
      if q is null or q <= 0 then raise exception 'Consumo por peça precisa ser maior que zero.'; end if;
      insert into fab.material_consumo (material_id, etapa, modelo, qtd_por_peca) values (v_id, e, mo, q)
      on conflict (material_id, etapa, modelo) do update set qtd_por_peca = excluded.qtd_por_peca;
    end loop;
  end if;
  return v_id;
exception when unique_violation then raise exception 'Já existe um material com esse nome.';
end $$;

create or replace function public.fab_apagar_material(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  delete from fab.materiais where id = p_id and empresa_id = u.empresa_id;
  if not found then raise exception 'Material não encontrado.'; end if;
end $$;

-- Entrada (compra), saída (uso fora da regra, perda) ou ajuste (contagem: informa o saldo contado).
--   p: {materialId, tipo, qtd, data, valor?, fornecedorId?, obs?, contado? (ajuste), contaId? (entrada → saída no Financeiro)}
create or replace function public.fab_movimentar_material(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis := fab.exige_admin(); m fab.materiais; v_tipo text := p ->> 'tipo'; v_qtd numeric; v_data date; v_valor numeric;
  v_forn uuid := nullif(p ->> 'fornecedorId', '')::uuid; v_fnome text := ''; v_conta uuid := nullif(p ->> 'contaId', '')::uuid;
  v_fin uuid; v_id uuid; v_saldo numeric;
begin
  select * into m from fab.materiais where id = nullif(p ->> 'materialId', '')::uuid and empresa_id = u.empresa_id;
  if not found then raise exception 'Material não encontrado.'; end if;
  if v_tipo not in ('entrada', 'saida', 'ajuste') then raise exception 'Tipo de movimento inválido.'; end if;
  begin v_data := coalesce(nullif(p ->> 'data', '')::date, fab.hoje(u.empresa_id)); exception when others then raise exception 'Data inválida.'; end;
  if v_tipo = 'ajuste' then
    -- ajuste por contagem: guarda a diferença entre o contado e o saldo calculado
    begin v_qtd := (p ->> 'contado')::numeric; exception when others then raise exception 'Informe a quantidade contada.'; end;
    if v_qtd is null or v_qtd < 0 then raise exception 'Informe a quantidade contada.'; end if;
    v_saldo := (fab.material_json(m, fab.hoje(u.empresa_id)) ->> 'saldo')::numeric;
    v_qtd := round(v_qtd - v_saldo, 3);
    if v_qtd = 0 then raise exception 'O saldo contado é igual ao do sistema: nada a ajustar.'; end if;
  else
    begin v_qtd := (p ->> 'qtd')::numeric; exception when others then raise exception 'Quantidade inválida.'; end;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  end if;
  begin v_valor := nullif(p ->> 'valor', '')::numeric; exception when others then raise exception 'Valor inválido.'; end;
  if v_valor is not null and v_valor < 0 then raise exception 'Valor inválido.'; end if;
  if v_forn is not null then
    select r.nome into v_fnome from fab.registros r where r.id = v_forn and r.empresa_id = u.empresa_id and r.tipo = 'fornecedor';
    if not found then raise exception 'Fornecedor inválido.'; end if;
  end if;
  if v_conta is not null then
    if v_tipo <> 'entrada' then raise exception 'Só a entrada (compra) é lançada no Financeiro.'; end if;
    if not fab.pode(u, 'financeiro') then raise exception 'Você não tem acesso ao Financeiro para lançar a compra.'; end if;
    if coalesce(v_valor, 0) <= 0 then raise exception 'Informe o valor da compra para lançar no Financeiro.'; end if;
    if not exists (select 1 from fab.fin_contas where id = v_conta and empresa_id = u.empresa_id) then raise exception 'Conta inválida.'; end if;
    insert into fab.fin_lancamentos (empresa_id, tipo, data, descricao, valor, conta_id, categoria, criado_por, contraparte_id, contraparte_nome)
    values (u.empresa_id, 'saida', v_data, left('Compra: ' || m.nome || ' (' || trim(to_char(v_qtd, 'FM999999990.###')) || ' ' || m.unidade || ')', 120),
            v_valor, v_conta, 'Matéria-prima', u.id, v_forn, coalesce(v_fnome, ''))
    returning id into v_fin;
  end if;
  insert into fab.material_movs (empresa_id, material_id, tipo, qtd, data, valor, fornecedor_id, fornecedor_nome, fin_lancamento_id, obs, criado_por)
  values (u.empresa_id, m.id, v_tipo, v_qtd, v_data, case when v_tipo = 'entrada' then v_valor end, v_forn, coalesce(v_fnome, ''), v_fin,
          coalesce(left(p ->> 'obs', 300), ''), u.id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fab_movs_material(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); m fab.materiais;
begin
  select * into m from fab.materiais where id = p_id and empresa_id = u.empresa_id;
  if not found then raise exception 'Material não encontrado.'; end if;
  return jsonb_build_object(
    'movimentos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'tipo', v.tipo, 'qtd', v.qtd, 'data', v.data, 'valor', v.valor,
        'fornecedor', coalesce((select r.nome from fab.registros r where r.id = v.fornecedor_id), v.fornecedor_nome),
        'noFinanceiro', v.fin_lancamento_id is not null, 'obs', v.obs, 'por', (select pf.nome from fab.perfis pf where pf.id = v.criado_por))
        order by v.data desc, v.criado_em desc)
      from (select * from fab.material_movs where material_id = m.id order by data desc, criado_em desc limit 300) v), '[]'::jsonb),
    'consumoMensal', coalesce((select jsonb_agg(jsonb_build_object('mes', to_char(mm, 'YYYY-MM'),
        'qtd', fab.material_consumo_periodo(m.id, mm::date, (mm + interval '1 month - 1 day')::date)) order by mm)
      from generate_series(date_trunc('month', fab.hoje(u.empresa_id)) - interval '5 months', date_trunc('month', fab.hoje(u.empresa_id)), interval '1 month') mm), '[]'::jsonb));
end $$;

create or replace function public.fab_apagar_mov_material(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); v fab.material_movs;
begin
  select * into v from fab.material_movs where id = p_id and empresa_id = u.empresa_id;
  if not found then raise exception 'Movimento não encontrado.'; end if;
  if v.fin_lancamento_id is not null and exists (select 1 from fab.fin_lancamentos where id = v.fin_lancamento_id and apagado_em is null) then
    raise exception 'Esta compra está no Financeiro: exclua o lançamento lá antes.';
  end if;
  delete from fab.material_movs where id = p_id;
end $$;

-- fornecedores e contas para o formulário (sem exigir Cadastros/Financeiro só para listar)
create or replace function public.fab_material_opcoes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  return jsonb_build_object(
    'fornecedores', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.nome) order by r.nome)
                                from fab.registros r where r.empresa_id = u.empresa_id and r.tipo = 'fornecedor' and r.ativo), '[]'::jsonb),
    'contas', case when fab.pode(u, 'financeiro') then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) order by c.nome)
                                from fab.fin_contas c where c.empresa_id = u.empresa_id and c.ativa), '[]'::jsonb) else '[]'::jsonb end);
end $$;

insert into fab.rotas (fn, funcoes) values
  ('fab_materiais', array['materiais']), ('fab_salvar_material', array['materiais']), ('fab_apagar_material', array['materiais']),
  ('fab_movimentar_material', array['materiais']), ('fab_movs_material', array['materiais']), ('fab_apagar_mov_material', array['materiais']),
  ('fab_material_opcoes', array['materiais'])
on conflict (fn) do update set funcoes = excluded.funcoes;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_materiais', 'fab_salvar_material', 'fab_apagar_material', 'fab_movimentar_material',
                                                         'fab_movs_material', 'fab_apagar_mov_material', 'fab_material_opcoes')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
