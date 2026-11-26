-- Fábrica · FINANCEIRO (por empresa; só administradores)
-- Baseado no app "Financeiro": entradas, saídas efetivadas, saídas programadas/parceladas,
-- cartões com fechamento e vencimento, faturas, saldo por conta, dinheiro guardado por meta
-- e planejamento (previsto x realizado). Os cálculos de leitura (saldos, faturas, agenda) ficam
-- no app; aqui ficam os dados, a validação e o isolamento por empresa.

create table fab.fin_config (
  empresa_id  uuid primary key references fab.empresas (id) on delete cascade,
  data_inicio date not null default current_date
);

create table fab.fin_listas (
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  tipo       text not null check (tipo in ('categoria', 'responsavel', 'centro', 'forma')),
  nome       text not null check (length(btrim(nome)) between 1 and 60),
  ordem      integer not null default 0,
  primary key (empresa_id, tipo, nome)
);

create table fab.fin_contas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references fab.empresas (id) on delete cascade,
  nome          text not null check (length(btrim(nome)) between 1 and 60),
  saldo_inicial numeric(14, 2) not null default 0,
  ativa         boolean not null default true,
  unique (empresa_id, nome)
);

create table fab.fin_cartoes (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references fab.empresas (id) on delete cascade,
  nome           text not null check (length(btrim(nome)) between 1 and 60),
  dia_fechamento integer not null check (dia_fechamento between 1 and 31),
  dia_vencimento integer not null check (dia_vencimento between 1 and 31),
  ativo          boolean not null default true,
  unique (empresa_id, nome)
);

create table fab.fin_lancamentos (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references fab.empresas (id) on delete cascade,
  tipo              text not null check (tipo in ('entrada', 'saida', 'programada')),
  data              date not null,
  descricao         text not null check (length(btrim(descricao)) between 1 and 120),
  valor             numeric(14, 2) not null check (valor > 0),
  conta_id          uuid references fab.fin_contas (id),
  cartao_id         uuid references fab.fin_cartoes (id),
  forma             text not null default '',
  categoria         text not null default '',
  responsavel       text not null default '',
  centro            text not null default '',
  parcelas          integer check (parcelas between 1 and 360),
  valor_parcela     numeric(14, 2) check (valor_parcela > 0),
  dia_vencimento    integer check (dia_vencimento between 1 and 31),
  parcelas_pagas    integer not null default 0 check (parcelas_pagas >= 0),
  vencimento_fatura date,      -- saída no cartão: fatura em que cai; programada no cartão: 1ª fatura
  origem_id         uuid references fab.fin_lancamentos (id) on delete set null, -- pagamento de uma parcela
  obs               text not null default '',
  criado_por        uuid references fab.perfis (id),
  criado_em         timestamptz not null default now(),
  apagado_em        timestamptz,
  check ((conta_id is null) <> (cartao_id is null)),
  check (tipo <> 'entrada' or cartao_id is null),
  check (tipo <> 'programada' or (parcelas is not null and valor_parcela is not null and (cartao_id is not null or dia_vencimento is not null)))
);
create index fin_lanc_emp_data_idx on fab.fin_lancamentos (empresa_id, data) where apagado_em is null;

create table fab.fin_pagamentos_fatura (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  cartao_id  uuid not null references fab.fin_cartoes (id),
  vencimento date not null,
  valor      numeric(14, 2) not null check (valor > 0),
  conta_id   uuid not null references fab.fin_contas (id),
  data       date not null,
  criado_em  timestamptz not null default now(),
  unique (empresa_id, cartao_id, vencimento)
);

create table fab.fin_metas (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  nome       text not null check (length(btrim(nome)) between 1 and 60),
  valor_meta numeric(14, 2) not null default 0 check (valor_meta >= 0),
  data_alvo  date,
  ativa      boolean not null default true
);

create table fab.fin_movimentos_meta (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  meta_id    uuid not null references fab.fin_metas (id) on delete cascade,
  tipo       text not null check (tipo in ('deposito', 'retirada')),
  valor      numeric(14, 2) not null check (valor > 0),
  data       date not null,
  conta_id   uuid not null references fab.fin_contas (id),
  criado_em  timestamptz not null default now()
);

create table fab.fin_expectativas (
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  mes        text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  entradas   numeric(14, 2) not null default 0 check (entradas >= 0),
  saidas     jsonb not null default '{}'::jsonb,   -- { "categoria": valor }
  primary key (empresa_id, mes)
);

do $$
declare t text;
begin
  foreach t in array array['fin_config','fin_listas','fin_contas','fin_cartoes','fin_lancamentos','fin_pagamentos_fatura','fin_metas','fin_movimentos_meta','fin_expectativas'] loop
    execute format('alter table fab.%I enable row level security', t);
    execute format('revoke all on fab.%I from public', t);
  end loop;
end $$;

-- ---------- padrões de uma empresa nova ----------
create function fab.fin_padroes(p_emp uuid) returns void language plpgsql as $$
begin
  insert into fab.fin_config (empresa_id) values (p_emp) on conflict do nothing;
  insert into fab.fin_contas (empresa_id, nome) values (p_emp, 'Conta corrente'), (p_emp, 'Caixa') on conflict do nothing;
  insert into fab.fin_listas (empresa_id, tipo, nome, ordem)
  select p_emp, t, n, o from (values
    ('categoria','Matéria-prima',1),('categoria','Folha de pagamento',2),('categoria','Aluguel',3),('categoria','Energia e água',4),
    ('categoria','Impostos',5),('categoria','Frete e transporte',6),('categoria','Manutenção',7),('categoria','Marketing',8),
    ('categoria','Vendas',9),('categoria','Outros',10),
    ('centro','Produção',1),('centro','Administrativo',2),('centro','Comercial',3),
    ('forma','PIX',1),('forma','Boleto',2),('forma','Débito automático',3),('forma','Cartão de débito',4),
    ('forma','Transferência',5),('forma','Dinheiro',6)
  ) as v(t, n, o)
  on conflict do nothing;
end $$;

create function fab.nova_empresa_fin() returns trigger language plpgsql set search_path = '' as $$
begin
  perform fab.fin_padroes(new.id);
  return null;
end $$;
create trigger empresas_fin after insert on fab.empresas for each row execute function fab.nova_empresa_fin();
select fab.fin_padroes(id) from fab.empresas;

-- Fatura em que uma compra no cartão cai (mesma regra do app original).
create function fab.fin_vencimento_fatura(p_data date, p_fech integer, p_venc integer) returns date
language plpgsql immutable as $$
declare close_month date; close_last integer; close_date date; same_due date; due_month date; due_last integer;
begin
  close_month := (date_trunc('month', p_data::timestamp) + case when extract(day from p_data) > p_fech then interval '1 month' else interval '0 day' end)::date;
  close_last  := extract(day from (close_month::timestamp + interval '1 month' - interval '1 day'))::integer;
  close_date  := close_month + (least(p_fech, close_last) - 1);
  same_due    := close_month + (least(p_venc, close_last) - 1);
  due_month   := case when same_due > close_date then close_month else (close_month::timestamp + interval '1 month')::date end;
  due_last    := extract(day from (due_month::timestamp + interval '1 month' - interval '1 day'))::integer;
  return due_month + (least(p_venc, due_last) - 1);
end $$;

create function fab.fin_listas_json(p_emp uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'categorias', coalesce((select jsonb_agg(nome order by ordem, nome) from fab.fin_listas where empresa_id = p_emp and tipo = 'categoria'), '[]'),
    'responsaveis', coalesce((select jsonb_agg(nome order by ordem, nome) from fab.fin_listas where empresa_id = p_emp and tipo = 'responsavel'), '[]'),
    'centros', coalesce((select jsonb_agg(nome order by ordem, nome) from fab.fin_listas where empresa_id = p_emp and tipo = 'centro'), '[]'),
    'formas', coalesce((select jsonb_agg(nome order by ordem, nome) from fab.fin_listas where empresa_id = p_emp and tipo = 'forma'), '[]'))
$$;

-- =====================================================================
-- API
-- =====================================================================
create function public.fin_dados() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis; e uuid;
begin
  u := fab.exige_admin(); e := u.empresa_id;
  return jsonb_build_object(
    'hoje', fab.hoje(e),
    'dataInicio', (select data_inicio from fab.fin_config where empresa_id = e),
    'listas', fab.fin_listas_json(e),
    'contas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'saldoInicial', saldo_inicial, 'ativa', ativa) order by nome), '[]')
               from fab.fin_contas where empresa_id = e),
    'cartoes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'diaFechamento', dia_fechamento, 'diaVencimento', dia_vencimento, 'ativo', ativo) order by nome), '[]')
                from fab.fin_cartoes where empresa_id = e),
    'lancamentos', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', l.id, 'tipo', l.tipo, 'data', l.data, 'descricao', l.descricao, 'valor', l.valor,
                       'contaId', l.conta_id, 'cartaoId', l.cartao_id, 'forma', l.forma, 'categoria', l.categoria,
                       'responsavel', l.responsavel, 'centro', l.centro, 'parcelas', l.parcelas, 'valorParcela', l.valor_parcela,
                       'diaVencimento', l.dia_vencimento, 'parcelasPagas', l.parcelas_pagas, 'vencimentoFatura', l.vencimento_fatura,
                       'origemId', l.origem_id, 'obs', l.obs) order by l.data desc, l.criado_em desc), '[]')
                    from fab.fin_lancamentos l where l.empresa_id = e and l.apagado_em is null),
    'pagamentosFatura', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'cartaoId', cartao_id, 'vencimento', vencimento, 'valor', valor, 'contaId', conta_id, 'data', data) order by vencimento), '[]')
                         from fab.fin_pagamentos_fatura where empresa_id = e),
    'metas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'valorMeta', valor_meta, 'dataAlvo', data_alvo, 'ativa', ativa) order by nome), '[]')
              from fab.fin_metas where empresa_id = e),
    'movimentosMeta', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'metaId', meta_id, 'tipo', tipo, 'valor', valor, 'data', data, 'contaId', conta_id) order by data), '[]')
                       from fab.fin_movimentos_meta where empresa_id = e),
    'expectativas', (select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'entradas', entradas, 'saidas', saidas) order by mes), '[]')
                     from fab.fin_expectativas where empresa_id = e));
end $$;

create function public.fin_salvar_lancamento(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis; v_id uuid; v_tipo text; v_data date; v_conta uuid; v_cartao uuid; c fab.fin_cartoes;
  v_parc integer; v_vparc numeric; v_dia integer; v_venc date; antigo fab.fin_lancamentos;
begin
  u := fab.exige_admin();
  v_tipo := p ->> 'tipo';
  if v_tipo not in ('entrada', 'saida', 'programada') then raise exception 'Tipo de lançamento inválido.'; end if;
  begin v_data := (p ->> 'data')::date; exception when others then raise exception 'Data inválida.'; end;
  if v_data is null then raise exception 'Informe a data.'; end if;
  if coalesce(btrim(p ->> 'descricao'), '') = '' then raise exception 'Informe a descrição.'; end if;
  if coalesce((p ->> 'valor')::numeric, 0) <= 0 then raise exception 'Informe um valor maior que zero.'; end if;

  v_conta := nullif(p ->> 'contaId', '')::uuid;
  v_cartao := nullif(p ->> 'cartaoId', '')::uuid;
  if v_tipo = 'entrada' then v_cartao := null; end if;
  if (v_conta is null) = (v_cartao is null) then raise exception 'Escolha a conta ou o cartão.'; end if;
  if v_conta is not null and not exists (select 1 from fab.fin_contas where id = v_conta and empresa_id = u.empresa_id) then raise exception 'Conta inválida.'; end if;
  if v_cartao is not null then
    select * into c from fab.fin_cartoes where id = v_cartao and empresa_id = u.empresa_id;
    if not found then raise exception 'Cartão inválido.'; end if;
    v_venc := fab.fin_vencimento_fatura(v_data, c.dia_fechamento, c.dia_vencimento);
  end if;

  if v_tipo = 'programada' then
    v_parc := (p ->> 'parcelas')::integer;
    v_vparc := (p ->> 'valorParcela')::numeric;
    v_dia := nullif(p ->> 'diaVencimento', '')::integer;
    if v_parc is null or v_parc < 1 or v_parc > 360 then raise exception 'Quantidade de parcelas inválida.'; end if;
    if v_vparc is null or v_vparc <= 0 then raise exception 'Informe o valor da parcela.'; end if;
    if v_cartao is null and (v_dia is null or v_dia not between 1 and 31) then raise exception 'Informe o dia do vencimento (1 a 31).'; end if;
  end if;

  v_id := nullif(p ->> 'id', '')::uuid;
  if v_id is not null then
    select * into antigo from fab.fin_lancamentos where id = v_id and empresa_id = u.empresa_id and apagado_em is null for update;
    if not found then raise exception 'Lançamento não encontrado.'; end if;
    if antigo.tipo = 'programada' and v_parc is not null and v_parc < antigo.parcelas_pagas then
      raise exception 'Já existem % parcela(s) paga(s).', antigo.parcelas_pagas;
    end if;
    update fab.fin_lancamentos set
      tipo = v_tipo, data = v_data, descricao = btrim(p ->> 'descricao'), valor = (p ->> 'valor')::numeric,
      conta_id = v_conta, cartao_id = v_cartao, forma = coalesce(p ->> 'forma', ''), categoria = coalesce(p ->> 'categoria', ''),
      responsavel = coalesce(p ->> 'responsavel', ''), centro = coalesce(p ->> 'centro', ''),
      parcelas = v_parc, valor_parcela = v_vparc, dia_vencimento = case when v_cartao is null then v_dia end,
      vencimento_fatura = v_venc, obs = coalesce(left(p ->> 'obs', 300), '')
    where id = v_id;
  else
    insert into fab.fin_lancamentos (empresa_id, tipo, data, descricao, valor, conta_id, cartao_id, forma, categoria, responsavel, centro,
                                     parcelas, valor_parcela, dia_vencimento, vencimento_fatura, obs, criado_por)
    values (u.empresa_id, v_tipo, v_data, btrim(p ->> 'descricao'), (p ->> 'valor')::numeric, v_conta, v_cartao,
            coalesce(p ->> 'forma', ''), coalesce(p ->> 'categoria', ''), coalesce(p ->> 'responsavel', ''), coalesce(p ->> 'centro', ''),
            v_parc, v_vparc, case when v_cartao is null then v_dia end, v_venc, coalesce(left(p ->> 'obs', 300), ''), u.id)
    returning id into v_id;
  end if;
  return v_id;
end $$;

create function public.fin_apagar_lancamento(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.exige_admin();
  update fab.fin_lancamentos set apagado_em = now() where id = p_id and empresa_id = u.empresa_id and apagado_em is null;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
end $$;

-- Paga a próxima parcela de uma saída programada (fora do cartão): vira uma saída efetivada.
create function public.fin_pagar_parcela(p_id uuid, p_data date, p_valor numeric, p_conta uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; l fab.fin_lancamentos; v_conta uuid;
begin
  u := fab.exige_admin();
  select * into l from fab.fin_lancamentos where id = p_id and empresa_id = u.empresa_id and apagado_em is null and tipo = 'programada' for update;
  if not found then raise exception 'Conta programada não encontrada.'; end if;
  if l.cartao_id is not null then raise exception 'Parcelas no cartão são pagas pela fatura.'; end if;
  if l.parcelas_pagas >= l.parcelas then raise exception 'Todas as parcelas já foram pagas.'; end if;
  if coalesce(p_valor, 0) <= 0 or p_data is null then raise exception 'Informe a data e o valor pago.'; end if;
  v_conta := coalesce(p_conta, l.conta_id);
  if not exists (select 1 from fab.fin_contas where id = v_conta and empresa_id = u.empresa_id) then raise exception 'Conta inválida.'; end if;
  update fab.fin_lancamentos set parcelas_pagas = parcelas_pagas + 1 where id = p_id;
  insert into fab.fin_lancamentos (empresa_id, tipo, data, descricao, valor, conta_id, forma, categoria, responsavel, centro, origem_id, criado_por)
  values (u.empresa_id, 'saida', p_data, left(l.descricao || ' · parcela ' || (l.parcelas_pagas + 1) || '/' || l.parcelas, 120), p_valor, v_conta,
          l.forma, l.categoria, l.responsavel, l.centro, l.id, u.id);
end $$;

create function public.fin_pagar_fatura(p_cartao uuid, p_vencimento date, p_valor numeric, p_conta uuid, p_data date) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.exige_admin();
  if not exists (select 1 from fab.fin_cartoes where id = p_cartao and empresa_id = u.empresa_id) then raise exception 'Cartão inválido.'; end if;
  if not exists (select 1 from fab.fin_contas where id = p_conta and empresa_id = u.empresa_id) then raise exception 'Conta inválida.'; end if;
  if coalesce(p_valor, 0) <= 0 or p_data is null or p_vencimento is null then raise exception 'Informe a data e o valor pago.'; end if;
  insert into fab.fin_pagamentos_fatura (empresa_id, cartao_id, vencimento, valor, conta_id, data)
  values (u.empresa_id, p_cartao, p_vencimento, p_valor, p_conta, p_data);
exception when unique_violation then
  raise exception 'Essa fatura já foi paga.';
end $$;

create function public.fin_salvar_conta(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  u := fab.exige_admin();
  if coalesce(btrim(p ->> 'nome'), '') = '' then raise exception 'Informe o nome da conta.'; end if;
  if v_id is null then
    insert into fab.fin_contas (empresa_id, nome, saldo_inicial) values (u.empresa_id, btrim(p ->> 'nome'), coalesce((p ->> 'saldoInicial')::numeric, 0)) returning id into v_id;
  else
    update fab.fin_contas set nome = btrim(p ->> 'nome'), saldo_inicial = coalesce((p ->> 'saldoInicial')::numeric, 0), ativa = coalesce((p ->> 'ativa')::boolean, true)
     where id = v_id and empresa_id = u.empresa_id;
    if not found then raise exception 'Conta não encontrada.'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'Já existe uma conta com esse nome.';
end $$;

create function public.fin_salvar_cartao(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_id uuid := nullif(p ->> 'id', '')::uuid; v_f integer := (p ->> 'diaFechamento')::integer; v_v integer := (p ->> 'diaVencimento')::integer;
begin
  u := fab.exige_admin();
  if coalesce(btrim(p ->> 'nome'), '') = '' then raise exception 'Informe o nome do cartão.'; end if;
  if v_f is null or v_f not between 1 and 31 or v_v is null or v_v not between 1 and 31 then raise exception 'Dias de fechamento e vencimento: 1 a 31.'; end if;
  if v_id is null then
    insert into fab.fin_cartoes (empresa_id, nome, dia_fechamento, dia_vencimento) values (u.empresa_id, btrim(p ->> 'nome'), v_f, v_v) returning id into v_id;
  else
    update fab.fin_cartoes set nome = btrim(p ->> 'nome'), dia_fechamento = v_f, dia_vencimento = v_v, ativo = coalesce((p ->> 'ativo')::boolean, true)
     where id = v_id and empresa_id = u.empresa_id;
    if not found then raise exception 'Cartão não encontrado.'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'Já existe um cartão com esse nome.';
end $$;

create function public.fin_salvar_meta(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  u := fab.exige_admin();
  if coalesce(btrim(p ->> 'nome'), '') = '' then raise exception 'Informe o nome da meta.'; end if;
  if v_id is null then
    insert into fab.fin_metas (empresa_id, nome, valor_meta, data_alvo)
    values (u.empresa_id, btrim(p ->> 'nome'), coalesce((p ->> 'valorMeta')::numeric, 0), nullif(p ->> 'dataAlvo', '')::date) returning id into v_id;
  else
    update fab.fin_metas set nome = btrim(p ->> 'nome'), valor_meta = coalesce((p ->> 'valorMeta')::numeric, 0),
           data_alvo = nullif(p ->> 'dataAlvo', '')::date, ativa = coalesce((p ->> 'ativa')::boolean, true)
     where id = v_id and empresa_id = u.empresa_id;
    if not found then raise exception 'Meta não encontrada.'; end if;
  end if;
  return v_id;
end $$;

create function public.fin_movimentar_meta(p_meta uuid, p_tipo text, p_valor numeric, p_data date, p_conta uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_saldo numeric;
begin
  u := fab.exige_admin();
  if not exists (select 1 from fab.fin_metas where id = p_meta and empresa_id = u.empresa_id) then raise exception 'Meta não encontrada.'; end if;
  if not exists (select 1 from fab.fin_contas where id = p_conta and empresa_id = u.empresa_id) then raise exception 'Conta inválida.'; end if;
  if p_tipo not in ('deposito', 'retirada') then raise exception 'Movimento inválido.'; end if;
  if coalesce(p_valor, 0) <= 0 or p_data is null then raise exception 'Informe a data e o valor.'; end if;
  if p_tipo = 'retirada' then
    select coalesce(sum(case when tipo = 'deposito' then valor else -valor end), 0) into v_saldo from fab.fin_movimentos_meta where meta_id = p_meta;
    if p_valor > v_saldo then raise exception 'A meta só tem % guardado.', to_char(v_saldo, 'FM999G999G990D00'); end if;
  end if;
  insert into fab.fin_movimentos_meta (empresa_id, meta_id, tipo, valor, data, conta_id) values (u.empresa_id, p_meta, p_tipo, p_valor, p_data, p_conta);
end $$;

create function public.fin_salvar_expectativa(p_mes text, p_entradas numeric, p_saidas jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_limpo jsonb;
begin
  u := fab.exige_admin();
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mês inválido.'; end if;
  if coalesce(p_entradas, 0) < 0 then raise exception 'Entradas previstas não podem ser negativas.'; end if;
  select coalesce(jsonb_object_agg(k, round(v::numeric, 2)), '{}'::jsonb) into v_limpo
    from jsonb_each_text(coalesce(p_saidas, '{}'::jsonb)) as x(k, v)
   where btrim(k) <> '' and v ~ '^\d+(\.\d+)?$' and v::numeric > 0;
  insert into fab.fin_expectativas (empresa_id, mes, entradas, saidas) values (u.empresa_id, p_mes, coalesce(p_entradas, 0), v_limpo)
  on conflict (empresa_id, mes) do update set entradas = excluded.entradas, saidas = excluded.saidas;
end $$;

create function public.fin_salvar_config(p_data_inicio date) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.exige_admin();
  if p_data_inicio is null then raise exception 'Informe a data de início.'; end if;
  insert into fab.fin_config (empresa_id, data_inicio) values (u.empresa_id, p_data_inicio)
  on conflict (empresa_id) do update set data_inicio = excluded.data_inicio;
end $$;

create function public.fin_salvar_lista(p_tipo text, p_valores text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_lista text[];
begin
  u := fab.exige_admin();
  if p_tipo not in ('categoria', 'responsavel', 'centro', 'forma') then raise exception 'Lista inválida.'; end if;
  select coalesce(array_agg(t.nome order by t.primeira), '{}') into v_lista
    from (select btrim(x) as nome, min(ord) as primeira from unnest(coalesce(p_valores, '{}')) with ordinality as a(x, ord)
           where btrim(x) <> '' group by btrim(x)) t;
  if coalesce(array_length(v_lista, 1), 0) > 200 then raise exception 'Lista grande demais (máximo 200).'; end if;
  if exists (select 1 from unnest(v_lista) n where length(n) > 60) then raise exception 'Cada item pode ter até 60 letras.'; end if;
  delete from fab.fin_listas where empresa_id = u.empresa_id and tipo = p_tipo and nome <> all (v_lista);
  insert into fab.fin_listas (empresa_id, tipo, nome, ordem)
  select u.empresa_id, p_tipo, n, ord::integer from unnest(v_lista) with ordinality as a(n, ord)
  on conflict (empresa_id, tipo, nome) do update set ordem = excluded.ordem;
  return fab.fin_listas_json(u.empresa_id);
end $$;
