-- =====================================================================
-- Produtividade, pagamento por produção e lucro por modelo
--
-- Valor por peça: por etapa, com valor específico por modelo (modelo = '' vale para todos).
--   Para cada lançamento: valor = qtd × (valor do modelo na etapa, senão o valor geral da etapa, senão 0).
-- Produtividade (função "produtividade"): peças por pessoa e etapa, dias e horas no ponto,
--   peças por dia/hora e o valor a pagar no período.
-- Fechamento (fin_fechar_producao, função Financeiro + Produtividade): lança uma SAÍDA por pessoa
--   no Financeiro e registra o período fechado — o mesmo período não é pago duas vezes.
-- Lucro por modelo (dre_lucro_modelos, função Resultado): peças conferidas × (preço − custo − mão de obra).
-- =====================================================================

create table fab.valores_peca (
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  etapa      text not null,
  modelo     text not null default '',
  valor      numeric(12, 4) not null check (valor >= 0 and valor <= 100000),
  primary key (empresa_id, etapa, modelo)
);
alter table fab.valores_peca enable row level security;
revoke all on fab.valores_peca from public;
create trigger auditoria after insert or update or delete on fab.valores_peca for each row execute function fab.auditar();

create table fab.fechamentos_producao (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references fab.empresas (id) on delete cascade,
  user_id           uuid not null references fab.perfis (id) on delete cascade,
  ini               date not null,
  fim               date not null check (fim >= ini),
  pecas             integer not null default 0,
  valor             numeric(14, 2) not null check (valor > 0),
  fin_lancamento_id uuid references fab.fin_lancamentos (id) on delete set null,
  criado_por        uuid references fab.perfis (id) on delete set null,
  criado_em         timestamptz not null default now()
);
create index fechamentos_emp_user_idx on fab.fechamentos_producao (empresa_id, user_id, ini, fim);
alter table fab.fechamentos_producao enable row level security;
revoke all on fab.fechamentos_producao from public;
create trigger auditoria after insert or update or delete on fab.fechamentos_producao for each row execute function fab.auditar();

-- valor de uma peça de um modelo numa etapa
create or replace function fab.valor_peca(p_emp uuid, p_etapa text, p_modelo text) returns numeric
language sql stable set search_path = '' as $$
  select coalesce((select valor from fab.valores_peca where empresa_id = p_emp and etapa = p_etapa and modelo = p_modelo),
                  (select valor from fab.valores_peca where empresa_id = p_emp and etapa = p_etapa and modelo = ''), 0)
$$;

-- produção do período por pessoa (base da tela e do fechamento)
create or replace function fab.producao_pessoas(p_emp uuid, p_ini date, p_fim date)
returns table (user_id uuid, etapa text, pecas bigint, valor numeric, dias bigint)
language sql stable set search_path = '' as $$
  select l.user_id, l.etapa::text, sum(l.qtd), round(sum(l.qtd * fab.valor_peca(p_emp, l.etapa::text, l.modelo)), 2), count(distinct l.dia)
    from fab.lancamentos l
   where l.empresa_id = p_emp and l.apagado_em is null and l.dia between p_ini and p_fim
   group by l.user_id, l.etapa
$$;

create or replace function public.fab_produtividade(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  if p_ini is null or p_fim is null or p_fim < p_ini or p_fim - p_ini > 400 then raise exception 'Período inválido.'; end if;
  return jsonb_build_object(
    'pessoas', coalesce((select jsonb_agg(x order by (x ->> 'pecas')::integer desc) from (
      select jsonb_build_object(
        'login', pf.login, 'nome', pf.nome, 'setor', pf.setor, 'ativo', pf.ativo,
        'porEtapa', (select coalesce(jsonb_object_agg(pp.etapa, pp.pecas), '{}'::jsonb) from fab.producao_pessoas(u.empresa_id, p_ini, p_fim) pp where pp.user_id = pf.id),
        'pecas', coalesce((select sum(pp.pecas) from fab.producao_pessoas(u.empresa_id, p_ini, p_fim) pp where pp.user_id = pf.id), 0),
        'valor', coalesce((select sum(pp.valor) from fab.producao_pessoas(u.empresa_id, p_ini, p_fim) pp where pp.user_id = pf.id), 0),
        'diasProducao', (select count(distinct l.dia) from fab.lancamentos l where l.user_id = pf.id and l.apagado_em is null and l.dia between p_ini and p_fim),
        'diasPonto', (select count(*) from fab.ponto t where t.user_id = pf.id and t.dia between p_ini and p_fim),
        'minutosPonto', (select coalesce(sum(extract(epoch from (t.saida - t.entrada)) / 60)::integer, 0)
                           from fab.ponto t where t.user_id = pf.id and t.dia between p_ini and p_fim and t.saida is not null and t.saida > t.entrada),
        'fechado', (select jsonb_build_object('id', f.id, 'ini', f.ini, 'fim', f.fim, 'valor', f.valor)
                      from fab.fechamentos_producao f where f.user_id = pf.id and not (f.fim < p_ini or f.ini > p_fim) order by f.criado_em desc limit 1)) as x
        from fab.perfis pf
       where pf.empresa_id = u.empresa_id
         and (pf.ativo or exists (select 1 from fab.lancamentos l where l.user_id = pf.id and l.apagado_em is null and l.dia between p_ini and p_fim))
         and exists (select 1 from fab.lancamentos l where l.user_id = pf.id and l.apagado_em is null and l.dia between p_ini and p_fim)
    ) s), '[]'::jsonb),
    'porDia', coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'pecas', d.pecas) order by d.dia)
                          from (select l.dia, sum(l.qtd) as pecas from fab.lancamentos l
                                 where l.empresa_id = u.empresa_id and l.apagado_em is null and l.dia between p_ini and p_fim group by l.dia) d), '[]'::jsonb),
    'valores', coalesce((select jsonb_agg(jsonb_build_object('etapa', v.etapa, 'modelo', v.modelo, 'valor', v.valor) order by v.etapa, v.modelo)
                           from fab.valores_peca v where v.empresa_id = u.empresa_id), '[]'::jsonb),
    'fechamentos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'nome', pf.nome, 'ini', f.ini, 'fim', f.fim, 'pecas', f.pecas, 'valor', f.valor,
                                                                'pago', f.fin_lancamento_id is not null) order by f.criado_em desc)
                               from fab.fechamentos_producao f join fab.perfis pf on pf.id = f.user_id
                              where f.empresa_id = u.empresa_id and not (f.fim < p_ini or f.ini > p_fim)), '[]'::jsonb));
end $$;

-- substitui a tabela de valores (lista completa vinda da tela)
create or replace function public.fab_salvar_valores_peca(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); it jsonb; v numeric; e text; m text;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 500 then raise exception 'Lista de valores inválida.'; end if;
  delete from fab.valores_peca where empresa_id = u.empresa_id;
  for it in select * from jsonb_array_elements(p) loop
    e := it ->> 'etapa'; m := btrim(coalesce(it ->> 'modelo', ''));
    if e is null or not (e = any (enum_range(null::fab.etapa)::text[])) then raise exception 'Etapa inválida.'; end if;
    if m <> '' and not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'modelo' and nome = m) then
      raise exception 'Modelo inválido: %', m; end if;
    begin v := (it ->> 'valor')::numeric; exception when others then raise exception 'Valor inválido.'; end;
    if v is null or v < 0 or v > 100000 then raise exception 'Valor inválido.'; end if;
    insert into fab.valores_peca (empresa_id, etapa, modelo, valor) values (u.empresa_id, e, m, round(v, 4))
    on conflict (empresa_id, etapa, modelo) do update set valor = excluded.valor;
  end loop;
end $$;

-- Fecha o período: uma saída no Financeiro por pessoa (só quem tem valor > 0 e ainda não foi fechado no período).
create or replace function public.fin_fechar_producao(p_ini date, p_fim date, p_conta uuid, p_data date, p_logins text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); pf fab.perfis; v_valor numeric; v_pecas bigint; v_fin uuid; n integer := 0;
begin
  if not fab.pode(u, 'produtividade') then raise exception 'Você não tem acesso à Produtividade.'; end if;
  if p_ini is null or p_fim is null or p_fim < p_ini or p_fim - p_ini > 400 then raise exception 'Período inválido.'; end if;
  if p_data is null then raise exception 'Informe a data do pagamento.'; end if;
  if not exists (select 1 from fab.fin_contas where id = p_conta and empresa_id = u.empresa_id) then raise exception 'Conta inválida.'; end if;
  if p_logins is null or cardinality(p_logins) = 0 then raise exception 'Escolha quem será pago.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fechamento:' || u.empresa_id::text, 0));
  for pf in select * from fab.perfis where empresa_id = u.empresa_id and login = any (p_logins) order by nome loop
    if exists (select 1 from fab.fechamentos_producao f where f.user_id = pf.id and not (f.fim < p_ini or f.ini > p_fim)) then
      raise exception '% já tem pagamento de produção neste período.', pf.nome;
    end if;
    select coalesce(sum(pp.valor), 0), coalesce(sum(pp.pecas), 0) into v_valor, v_pecas from fab.producao_pessoas(u.empresa_id, p_ini, p_fim) pp where pp.user_id = pf.id;
    if v_valor <= 0 then continue; end if;
    insert into fab.fin_lancamentos (empresa_id, tipo, data, descricao, valor, conta_id, categoria, responsavel, forma, criado_por)
    values (u.empresa_id, 'saida', p_data,
            left('Produção ' || to_char(p_ini, 'DD/MM') || ' a ' || to_char(p_fim, 'DD/MM') || ' · ' || pf.nome, 120),
            v_valor, p_conta, 'Folha de pagamento', pf.nome, '', u.id)
    returning id into v_fin;
    insert into fab.fechamentos_producao (empresa_id, user_id, ini, fim, pecas, valor, fin_lancamento_id, criado_por)
    values (u.empresa_id, pf.id, p_ini, p_fim, v_pecas, v_valor, v_fin, u.id);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Ninguém com valor a receber no período (confira os valores por peça).'; end if;
  return n;
end $$;

-- desfaz um fechamento: apaga o registro e tira a saída do Financeiro
create or replace function public.fin_desfazer_fechamento(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); f fab.fechamentos_producao;
begin
  if not fab.pode(u, 'produtividade') then raise exception 'Você não tem acesso à Produtividade.'; end if;
  select * into f from fab.fechamentos_producao where id = p_id and empresa_id = u.empresa_id;
  if not found then raise exception 'Fechamento não encontrado.'; end if;
  update fab.fin_lancamentos set apagado_em = now() where id = f.fin_lancamento_id and apagado_em is null;
  delete from fab.fechamentos_producao where id = p_id;
end $$;

-- Lucro por modelo no período.
--   produzidas  = peças conferidas (última etapa) no período
--   preço/custo = cadastro do produto com o mesmo nome do modelo
--   mão de obra = valor por peça das etapas (o que foi pago pela produção do modelo no período)
--   entregues   = pedidos entregues no período (peças e valor de venda real)
create or replace function public.dre_lucro_modelos(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); v_ult text;
begin
  if p_ini is null or p_fim is null or p_fim < p_ini or p_fim - p_ini > 400 then raise exception 'Período inválido.'; end if;
  v_ult := (enum_range(null::fab.etapa))[array_length(enum_range(null::fab.etapa), 1)]::text;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'modelo', m.modelo, 'produzidas', m.produzidas, 'maoDeObra', m.mao_obra,
      'maoDeObraPeca', (select coalesce(sum(fab.valor_peca(u.empresa_id, e::text, m.modelo)), 0) from unnest(enum_range(null::fab.etapa)) e),
      'preco', pr.preco, 'custo', pr.custo, 'cadastrado', pr.preco is not null,
      'entreguesPecas', coalesce(en.pecas, 0), 'entreguesValor', coalesce(en.valor, 0)) order by m.produzidas desc, m.modelo)
    from (
      select l.modelo,
             coalesce(sum(l.qtd) filter (where l.etapa::text = v_ult), 0) as produzidas,
             round(coalesce(sum(l.qtd * fab.valor_peca(u.empresa_id, l.etapa::text, l.modelo)), 0), 2) as mao_obra
        from fab.lancamentos l
       where l.empresa_id = u.empresa_id and l.apagado_em is null and l.dia between p_ini and p_fim
       group by l.modelo
      union
      select i.modelo, 0, 0 from fab.pedido_itens i join fab.pedidos p on p.id = i.pedido_id
       where p.empresa_id = u.empresa_id and p.status = 'entregue' and p.entregue_em between p_ini and p_fim
         and not exists (select 1 from fab.lancamentos l where l.empresa_id = u.empresa_id and l.apagado_em is null and l.modelo = i.modelo and l.dia between p_ini and p_fim)
    ) m
    left join lateral (
      select case when coalesce(r.dados ->> 'preco', '') ~ '^[0-9]+([.][0-9]+)?$' then (r.dados ->> 'preco')::numeric end as preco,
             case when coalesce(r.dados ->> 'custo', '') ~ '^[0-9]+([.][0-9]+)?$' then (r.dados ->> 'custo')::numeric end as custo
        from fab.registros r where r.empresa_id = u.empresa_id and r.tipo = 'produto' and r.nome = m.modelo order by r.ativo desc limit 1
    ) pr on true
    left join lateral (
      select sum(i.qtd) as pecas, round(sum(i.qtd * i.preco), 2) as valor
        from fab.pedido_itens i join fab.pedidos p on p.id = i.pedido_id
       where p.empresa_id = u.empresa_id and p.status = 'entregue' and p.entregue_em between p_ini and p_fim and i.modelo = m.modelo
    ) en on true), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- rotas e permissões
insert into fab.rotas (fn, funcoes) values
  ('fab_produtividade', array['produtividade']), ('fab_salvar_valores_peca', array['produtividade']),
  ('fin_fechar_producao', array['financeiro']), ('fin_desfazer_fechamento', array['financeiro'])
on conflict (fn) do update set funcoes = excluded.funcoes;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_produtividade', 'fab_salvar_valores_peca', 'fin_fechar_producao', 'fin_desfazer_fechamento', 'dre_lucro_modelos')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
