-- =====================================================================
-- Pedidos de clientes ligados à produção
--
-- Pedido = cliente + data de entrega + itens (modelo, cor, tamanho, quantidade, preço).
-- O andamento vem dos lançamentos de produção (Lançar), que NÃO têm número de pedido:
-- para cada combinação modelo/cor/tamanho, o que foi produzido em cada etapa desde o pedido
-- mais antigo é distribuído entre os pedidos nesta ordem:
--   1) pedidos já entregues (consomem o que produziram),  2) entrega mais próxima,  3) número.
-- Assim o mesmo lote nunca é contado em dois pedidos.
-- Ao marcar como entregue, o pedido pode gerar a conta a receber (ou a entrada à vista) no Financeiro.
-- Novas funções do sistema: pedidos, materiais, produtividade (padrão: só administradores).
-- =====================================================================

create or replace function fab.lista_funcoes() returns text[] language sql immutable set search_path = '' as
$$ select array['painel', 'dashboard', 'relatorio', 'falta', 'lancar', 'ponto', 'pedidos', 'materiais', 'produtividade',
                'financeiro', 'resultado', 'cadastros', 'acessos', 'mensagens', 'empresas'] $$;

create table fab.pedidos (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references fab.empresas (id) on delete cascade,
  numero            integer not null,
  cliente_id        uuid references fab.registros (id) on delete set null,
  cliente_nome      text not null default '',
  data_pedido       date not null,
  entrega           date,
  status            text not null default 'aberto' check (status in ('aberto', 'entregue', 'cancelado')),
  entregue_em       date,
  obs               text not null default '',
  fin_lancamento_id uuid references fab.fin_lancamentos (id) on delete set null,
  criado_por        uuid references fab.perfis (id) on delete set null,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (empresa_id, numero),
  check (entrega is null or entrega >= data_pedido),
  check ((status = 'entregue') = (entregue_em is not null))
);
create index pedidos_emp_status_idx on fab.pedidos (empresa_id, status, entrega);
alter table fab.pedidos enable row level security;
revoke all on fab.pedidos from public;
create trigger auditoria after insert or update or delete on fab.pedidos for each row execute function fab.auditar();

create table fab.pedido_itens (
  id        uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references fab.pedidos (id) on delete cascade,
  modelo    text not null,
  cor       text not null,
  tamanho   text not null,
  qtd       integer not null check (qtd between 1 and 999999),
  preco     numeric(12, 2) not null default 0 check (preco >= 0),
  ordem     integer not null default 0
);
create index pedido_itens_pedido_idx on fab.pedido_itens (pedido_id);
create index pedido_itens_combo_idx on fab.pedido_itens (modelo, cor, tamanho);
alter table fab.pedido_itens enable row level security;
revoke all on fab.pedido_itens from public;

-- ---------------------------------------------------------------- andamento (distribuição da produção)
create or replace function fab.pedidos_producao(p_emp uuid) returns table (item_id uuid, etapa text, feito integer)
language plpgsql stable set search_path = '' as $$
declare c record; e text; disp integer; it record; f integer;
begin
  for c in select i.modelo, i.cor, i.tamanho, min(p.data_pedido) as inicio
             from fab.pedido_itens i join fab.pedidos p on p.id = i.pedido_id
            where p.empresa_id = p_emp and p.status <> 'cancelado'
            group by i.modelo, i.cor, i.tamanho
  loop
    foreach e in array enum_range(null::fab.etapa)::text[] loop
      select coalesce(sum(l.qtd), 0)::integer into disp from fab.lancamentos l
       where l.empresa_id = p_emp and l.apagado_em is null and l.etapa::text = e
         and l.modelo = c.modelo and l.cor = c.cor and l.tamanho = c.tamanho and l.dia >= c.inicio;
      for it in select i.id, i.qtd, p.status from fab.pedido_itens i join fab.pedidos p on p.id = i.pedido_id
                 where p.empresa_id = p_emp and p.status <> 'cancelado' and i.modelo = c.modelo and i.cor = c.cor and i.tamanho = c.tamanho
                 order by (p.status = 'entregue') desc, p.entregue_em nulls last, p.entrega nulls last, p.numero, i.ordem
      loop
        f := least(it.qtd, disp);
        disp := disp - f;
        item_id := it.id; etapa := e;
        feito := case when it.status = 'entregue' then it.qtd else f end;   -- entregue = concluído
        return next;
      end loop;
    end loop;
  end loop;
end $$;

create or replace function fab.pedido_json(p fab.pedidos, prod jsonb) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'numero', p.numero, 'clienteId', p.cliente_id,
    'cliente', coalesce((select r.nome from fab.registros r where r.id = p.cliente_id), p.cliente_nome),
    'dataPedido', p.data_pedido, 'entrega', p.entrega, 'status', p.status, 'entregueEm', p.entregue_em, 'obs', p.obs,
    'finLancamentoId', (select l.id from fab.fin_lancamentos l where l.id = p.fin_lancamento_id and l.apagado_em is null),
    'criadoPor', (select pf.nome from fab.perfis pf where pf.id = p.criado_por),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'modelo', i.modelo, 'cor', i.cor, 'tamanho', i.tamanho, 'qtd', i.qtd, 'preco', i.preco,
        'feito', coalesce(prod -> i.id::text, '{}'::jsonb)) order by i.ordem)
      from fab.pedido_itens i where i.pedido_id = p.id), '[]'::jsonb))
$$;

-- Pedidos em aberto + entregues/cancelados dos últimos p_dias dias.
create or replace function public.fab_pedidos(p_dias integer default 120) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); prod jsonb; v_desde date;
begin
  v_desde := fab.hoje(u.empresa_id) - greatest(coalesce(p_dias, 120), 1);
  select coalesce(jsonb_object_agg(x.item_id, x.etapas), '{}'::jsonb) into prod
    from (select item_id, jsonb_object_agg(etapa, feito) as etapas from fab.pedidos_producao(u.empresa_id) group by item_id) x;
  return coalesce((select jsonb_agg(fab.pedido_json(p, prod) order by (p.status = 'aberto') desc, p.entrega nulls last, p.numero desc)
                     from fab.pedidos p
                    where p.empresa_id = u.empresa_id
                      and (p.status = 'aberto' or coalesce(p.entregue_em, p.data_pedido) >= v_desde or p.atualizado_em >= v_desde)), '[]'::jsonb);
end $$;

create or replace function public.fab_salvar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis := fab.exige_admin(); v_id uuid := nullif(p ->> 'id', '')::uuid; antigo fab.pedidos;
  v_cli uuid := nullif(p ->> 'clienteId', '')::uuid; v_nome text := btrim(coalesce(p ->> 'clienteNome', ''));
  v_data date; v_entrega date; v_num integer; it jsonb; n integer := 0; v_qtd integer; v_preco numeric;
begin
  if v_cli is not null then
    select r.nome into v_nome from fab.registros r where r.id = v_cli and r.empresa_id = u.empresa_id and r.tipo = 'cliente';
    if not found then raise exception 'Cliente inválido.'; end if;
  end if;
  if v_nome = '' then raise exception 'Informe o cliente.'; end if;
  begin
    v_data := coalesce(nullif(p ->> 'dataPedido', '')::date, fab.hoje(u.empresa_id));
    v_entrega := nullif(p ->> 'entrega', '')::date;
  exception when others then raise exception 'Data inválida.'; end;
  if v_entrega is not null and v_entrega < v_data then raise exception 'A entrega não pode ser antes da data do pedido.'; end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') not between 1 and 200 then
    raise exception 'Inclua pelo menos um item no pedido.';
  end if;

  if v_id is not null then
    select * into antigo from fab.pedidos where id = v_id and empresa_id = u.empresa_id for update;
    if not found then raise exception 'Pedido não encontrado.'; end if;
    if antigo.status <> 'aberto' then raise exception 'Reabra o pedido para editar.'; end if;
    update fab.pedidos set cliente_id = v_cli, cliente_nome = left(v_nome, 120), data_pedido = v_data, entrega = v_entrega,
                           obs = coalesce(left(p ->> 'obs', 500), ''), atualizado_em = now()
     where id = v_id;
    delete from fab.pedido_itens where pedido_id = v_id;
    v_num := antigo.numero;
  else
    perform pg_advisory_xact_lock(hashtextextended('pedido:' || u.empresa_id::text, 0));
    select coalesce(max(numero), 0) + 1 into v_num from fab.pedidos where empresa_id = u.empresa_id;
    insert into fab.pedidos (empresa_id, numero, cliente_id, cliente_nome, data_pedido, entrega, obs, criado_por)
    values (u.empresa_id, v_num, v_cli, left(v_nome, 120), v_data, v_entrega, coalesce(left(p ->> 'obs', 500), ''), u.id)
    returning id into v_id;
  end if;

  for it in select * from jsonb_array_elements(p -> 'itens') loop
    n := n + 1;
    if not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'modelo' and nome = it ->> 'modelo') then
      raise exception 'Modelo inválido: %', coalesce(it ->> 'modelo', '?'); end if;
    if not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'cor' and nome = it ->> 'cor') then
      raise exception 'Cor inválida: %', coalesce(it ->> 'cor', '?'); end if;
    if not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'tamanho' and nome = it ->> 'tamanho') then
      raise exception 'Tamanho inválido: %', coalesce(it ->> 'tamanho', '?'); end if;
    if coalesce(it ->> 'qtd', '') !~ '^[0-9]{1,6}$' or (it ->> 'qtd')::integer < 1 then raise exception 'Quantidade inválida no item %.', n; end if;
    v_qtd := (it ->> 'qtd')::integer;
    begin v_preco := coalesce(nullif(it ->> 'preco', '')::numeric, 0); exception when others then raise exception 'Preço inválido no item %.', n; end;
    if v_preco < 0 or v_preco > 9999999 then raise exception 'Preço inválido no item %.', n; end if;
    insert into fab.pedido_itens (pedido_id, modelo, cor, tamanho, qtd, preco, ordem)
    values (v_id, it ->> 'modelo', it ->> 'cor', it ->> 'tamanho', v_qtd, round(v_preco, 2), n);
  end loop;
  return jsonb_build_object('id', v_id, 'numero', v_num);
end $$;

-- Entregar / cancelar / reabrir. p_receber (opcional, só ao entregar e com a função Financeiro):
--   {"contaId": uuid, "avista": true}                         -> entrada hoje
--   {"contaId": uuid, "parcelas": 3, "diaVencimento": 10}     -> conta a receber em parcelas
create or replace function public.fab_status_pedido(p_id uuid, p_status text, p_receber jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis := fab.exige_admin(); pd fab.pedidos; v_total numeric; v_conta uuid; v_parc integer; v_dia integer;
  v_fin uuid; v_hoje date; v_desc text;
begin
  select * into pd from fab.pedidos where id = p_id and empresa_id = u.empresa_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  v_hoje := fab.hoje(u.empresa_id);
  if p_status = 'entregue' then
    if pd.status <> 'aberto' then raise exception 'Só pedidos em aberto podem ser entregues.'; end if;
    if p_receber is not null then
      if not fab.pode(u, 'financeiro') then raise exception 'Você não tem acesso ao Financeiro para lançar o recebimento.'; end if;
      select coalesce(sum(qtd * preco), 0) into v_total from fab.pedido_itens where pedido_id = p_id;
      if v_total <= 0 then raise exception 'O pedido não tem preço: informe o preço dos itens para lançar no Financeiro.'; end if;
      v_conta := nullif(p_receber ->> 'contaId', '')::uuid;
      if v_conta is null or not exists (select 1 from fab.fin_contas where id = v_conta and empresa_id = u.empresa_id) then raise exception 'Conta inválida.'; end if;
      v_desc := left('Pedido #' || pd.numero || ' · ' || coalesce((select r.nome from fab.registros r where r.id = pd.cliente_id), pd.cliente_nome), 120);
      if coalesce((p_receber ->> 'avista')::boolean, false) then
        insert into fab.fin_lancamentos (empresa_id, tipo, data, descricao, valor, conta_id, categoria, criado_por, contraparte_id, contraparte_nome)
        values (u.empresa_id, 'entrada', v_hoje, v_desc, v_total, v_conta, 'Vendas', u.id, pd.cliente_id, pd.cliente_nome)
        returning id into v_fin;
      else
        v_parc := nullif(p_receber ->> 'parcelas', '')::integer;
        v_dia := nullif(p_receber ->> 'diaVencimento', '')::integer;
        if v_parc is null or v_parc not between 1 and 360 then raise exception 'Quantidade de parcelas inválida.'; end if;
        if v_dia is null or v_dia not between 1 and 31 then raise exception 'Informe o dia do vencimento (1 a 31).'; end if;
        insert into fab.fin_lancamentos (empresa_id, tipo, data, descricao, valor, conta_id, categoria, criado_por, contraparte_id, contraparte_nome,
                                         parcelas, valor_parcela, dia_vencimento)
        values (u.empresa_id, 'receber', v_hoje, v_desc, v_total, v_conta, 'Vendas', u.id, pd.cliente_id, pd.cliente_nome,
                v_parc, round(v_total / v_parc, 2), v_dia)
        returning id into v_fin;
      end if;
    end if;
    update fab.pedidos set status = 'entregue', entregue_em = v_hoje, fin_lancamento_id = coalesce(v_fin, fin_lancamento_id), atualizado_em = now() where id = p_id;
  elsif p_status = 'cancelado' then
    if pd.status <> 'aberto' then raise exception 'Só pedidos em aberto podem ser cancelados.'; end if;
    update fab.pedidos set status = 'cancelado', atualizado_em = now() where id = p_id;
  elsif p_status = 'aberto' then
    if pd.status = 'aberto' then raise exception 'O pedido já está em aberto.'; end if;
    update fab.pedidos set status = 'aberto', entregue_em = null, atualizado_em = now() where id = p_id;
  else
    raise exception 'Situação inválida.';
  end if;
end $$;

create or replace function public.fab_apagar_pedido(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); pd fab.pedidos;
begin
  select * into pd from fab.pedidos where id = p_id and empresa_id = u.empresa_id;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if pd.status = 'entregue' then raise exception 'Pedido entregue não pode ser excluído. Reabra ou cancele antes.'; end if;
  delete from fab.pedidos where id = p_id;
end $$;

-- Opções do formulário (sem exigir Cadastros): clientes ativos e preço de venda de cada modelo cadastrado como produto.
create or replace function public.fab_pedido_opcoes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  return jsonb_build_object(
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.nome, 'prazo', coalesce(r.dados ->> 'prazo', '')) order by r.nome)
                            from fab.registros r where r.empresa_id = u.empresa_id and r.tipo = 'cliente' and r.ativo), '[]'::jsonb),
    'precos', coalesce((select jsonb_object_agg(r.nome, (r.dados ->> 'preco')::numeric)
                          from fab.registros r where r.empresa_id = u.empresa_id and r.tipo = 'produto' and r.ativo
                           and coalesce(r.dados ->> 'preco', '') ~ '^[0-9]+([.,][0-9]+)?$'), '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------- rotas e permissões
insert into fab.rotas (fn, funcoes) values
  ('fab_pedidos', array['pedidos']), ('fab_salvar_pedido', array['pedidos']),
  ('fab_status_pedido', array['pedidos']), ('fab_apagar_pedido', array['pedidos']), ('fab_pedido_opcoes', array['pedidos'])
on conflict (fn) do update set funcoes = excluded.funcoes;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_pedidos', 'fab_salvar_pedido', 'fab_status_pedido', 'fab_apagar_pedido', 'fab_pedido_opcoes')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
revoke all on function fab.pedidos_producao(uuid) from public;
