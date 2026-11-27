-- =====================================================================
-- Oficinas e remessas (facção): controle do corte e da costura feitos por terceiros ou funcionários
--
--  Oficina      = cadastro de quem corta/costura de fora (registros tipo 'oficina': PIX, telefone, valor por peça).
--  Ordem de corte = bobina (material + quantidade usada) entregue ao cortador → grade cortada por tamanho.
--                   Gera os lançamentos de CORTE (no nome do cortador) e a saída real do material; mostra o
--                   rendimento: peças esperadas pela regra de consumo × peças cortadas = perda de tecido.
--  Remessa      = peças (modelo/cor/tamanho) enviadas para a oficina/costureira, com prazo e valor por peça.
--  Retorno      = o que voltou: boas e com defeito (pode voltar em várias vezes). As boas viram lançamentos
--                 da etapa (normalmente COSTURA) no nome de quem costurou.
--  Acerto       = fecha a remessa: faltando = enviadas − boas − defeito; a pagar = boas × valor − faltando × desconto;
--                 pode lançar o pagamento no Financeiro. Assim a conta fecha por oficina e por remessa.
--  Também: "lançar em nome de" (o dono lança por quem não usa celular) e aviso diário de remessa atrasada.
-- =====================================================================

-- ---------------------------------------------------------------- função do sistema
create or replace function fab.lista_funcoes() returns text[] language sql immutable set search_path = '' as
$$ select array['painel', 'dashboard', 'relatorio', 'falta', 'lancar', 'ponto', 'pedidos', 'remessas', 'materiais', 'produtividade',
                'financeiro', 'resultado', 'cadastros', 'acessos', 'mensagens', 'empresas'] $$;

-- ---------------------------------------------------------------- oficinas (cadastro)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'fab.registros'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%fornecedor%'
  loop execute format('alter table fab.registros drop constraint %I', c.conname); end loop;
end $$;
alter table fab.registros add constraint registros_tipo_check check (tipo in ('produto', 'cliente', 'fornecedor', 'banco', 'oficina'));

do $$
declare src text;
begin
  select pg_get_functiondef('public.fab_salvar_registro(jsonb)'::regprocedure) into src;
  src := replace(src, 'if v_tipo not in (''produto'', ''cliente'', ''fornecedor'', ''banco'') then', 'if v_tipo not in (''produto'', ''cliente'', ''fornecedor'', ''banco'', ''oficina'') then');
  if position('''banco'', ''oficina''' in src) = 0 then raise exception 'fab_salvar_registro: trecho não encontrado'; end if;
  execute src;
end $$;

-- ---------------------------------------------------------------- lançamentos: quem fez pode ser uma oficina
alter table fab.lancamentos
  alter column user_id drop not null,
  add column if not exists oficina_id   uuid references fab.registros (id) on delete set null,
  add column if not exists oficina_nome text not null default '',
  add column if not exists origem       text not null default 'lancar',
  add column if not exists ordem_id     uuid,
  add column if not exists retorno_id   uuid,
  add column if not exists lancado_por  uuid references fab.perfis (id) on delete set null;
alter table fab.lancamentos
  add constraint lancamentos_quem_fez check (user_id is not null or oficina_nome <> ''),
  add constraint lancamentos_origem_check check (origem in ('lancar', 'nome', 'ordem', 'retorno'));
create index if not exists lancamentos_oficina_idx on fab.lancamentos (oficina_id);
create index if not exists lancamentos_ordem_idx on fab.lancamentos (ordem_id) where ordem_id is not null;
create index if not exists lancamentos_retorno_idx on fab.lancamentos (retorno_id) where retorno_id is not null;

-- editar/apagar: quem não é admin só mexe no que é seu (user_id nulo não é "seu"); o que veio de ordem/remessa corrige-se lá
do $$
declare f text; src text;
begin
  foreach f in array array['public.fab_editar_lancamento(uuid, integer)', 'public.fab_apagar_lancamento(uuid)'] loop
    select pg_get_functiondef(f::regprocedure) into src;
    src := replace(src, '(l.user_id <> u.id or', '(l.user_id is distinct from u.id or');
    src := replace(src, '  if not found then raise exception ''Lançamento não encontrado.''; end if;',
                        '  if not found then raise exception ''Lançamento não encontrado.''; end if;' || chr(10)
                        || '  if l.origem in (''ordem'', ''retorno'') then raise exception ''Este lançamento veio de uma ordem de corte ou remessa: corrija em Oficinas e remessas.''; end if;');
    if position('is distinct from u.id' in src) = 0 or position('Oficinas e remessas' in src) = 0 then raise exception '%: trecho não encontrado', f; end if;
    execute src;
  end loop;
end $$;

-- relatório e lista de editados: nome de quem fez = pessoa ou oficina
create or replace function fab.editados_json(p_emp uuid, p_ini date, p_fim date) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', coalesce(pf.nome, l.oficina_nome || ' (oficina)'), 'etapa', l.etapa, 'modelo', l.modelo, 'cor', l.cor, 'tamanho', l.tamanho,
           'qtd', l.qtd, 'edicoes', l.edicoes, 'hist', l.historico, 'data', l.dia)
         order by l.criado_em desc), '[]'::jsonb)
  from fab.lancamentos l left join fab.perfis pf on pf.id = l.user_id
  where l.empresa_id = p_emp and l.apagado_em is null and l.edicoes > 0 and l.dia between p_ini and p_fim
$$;

do $$
declare src text; sig text;
begin
  select p.oid::regprocedure::text into sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'fab' and p.proname = 'montar_relatorio';
  select pg_get_functiondef(sig::regprocedure) into src;
  src := replace(src, 'select pf.nome, l.etapa, sum(l.qtd)::integer as qtd
                        from fab.lancamentos l join fab.perfis pf on pf.id = l.user_id',
                      'select coalesce(pf.nome, l.oficina_nome || '' (oficina)'') as nome, l.etapa, sum(l.qtd)::integer as qtd
                        from fab.lancamentos l left join fab.perfis pf on pf.id = l.user_id');
  src := replace(src, 'group by pf.nome, l.etapa) x', 'group by 1, l.etapa) x');
  if position('left join fab.perfis pf on pf.id = l.user_id' in src) = 0 or position('group by 1, l.etapa) x' in src) = 0 then
    raise exception 'montar_relatorio: trecho de porPessoa não encontrado';
  end if;
  execute src;
end $$;

-- lançar em nome de um funcionário ou de uma oficina (quem não usa celular). Usa o mesmo fab_lancar (mesmas validações e avisos).
create or replace function public.fab_lancar_por(p_por jsonb, p_etapa text, p_modelo text, p_cor text, p_obs text, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); alvo fab.perfis; ofi fab.registros; r jsonb;
begin
  if u.perfil <> 'admin' then raise exception 'Apenas o administrador lança em nome de outra pessoa.'; end if;
  if nullif(p_por ->> 'login', '') is not null then
    select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = p_por ->> 'login' and ativo;
    if not found then raise exception 'Pessoa não encontrada.'; end if;
  elsif nullif(p_por ->> 'oficinaId', '') is not null then
    select * into ofi from fab.registros where id = (p_por ->> 'oficinaId')::uuid and empresa_id = u.empresa_id and tipo = 'oficina';
    if not found then raise exception 'Oficina não encontrada.'; end if;
  else
    raise exception 'Escolha em nome de quem lançar.';
  end if;
  r := public.fab_lancar(p_etapa, p_modelo, p_cor, p_obs, p_itens);
  update fab.lancamentos
     set user_id = case when alvo.id is not null then alvo.id end,
         oficina_id = ofi.id, oficina_nome = coalesce(ofi.nome, ''), origem = 'nome', lancado_por = u.id
   where empresa_id = u.empresa_id and user_id = u.id and criado_em = now() and lancado_por is null and origem = 'lancar';
  return r;
end $$;

-- ---------------------------------------------------------------- ordens de corte
create table fab.ordens_corte (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references fab.empresas (id) on delete cascade,
  numero       integer not null,
  data         date not null,
  user_id      uuid references fab.perfis (id) on delete set null,
  oficina_id   uuid references fab.registros (id) on delete set null,
  quem_nome    text not null check (quem_nome <> ''),
  modelo       text not null,
  cor          text not null,
  material_id  uuid references fab.materiais (id) on delete set null,
  material_qtd numeric(14, 3) check (material_qtd is null or material_qtd > 0),
  obs          text not null default '',
  criado_por   uuid references fab.perfis (id) on delete set null,
  criado_em    timestamptz not null default now(),
  unique (empresa_id, numero)
);
alter table fab.ordens_corte enable row level security;
revoke all on fab.ordens_corte from public;
create trigger auditoria after insert or update or delete on fab.ordens_corte for each row execute function fab.auditar();
create table fab.ordem_corte_itens (
  ordem_id uuid not null references fab.ordens_corte (id) on delete cascade,
  tamanho  text not null,
  qtd      integer not null check (qtd between 1 and 999999),
  primary key (ordem_id, tamanho)
);
alter table fab.ordem_corte_itens enable row level security;
revoke all on fab.ordem_corte_itens from public;

alter table fab.material_movs add column if not exists ordem_id uuid references fab.ordens_corte (id) on delete cascade;

-- consumo do material: o que veio de ordem de corte com a bobina informada já baixou pela quantidade real
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
     and not exists (select 1 from fab.ordens_corte o where o.id = l.ordem_id and o.material_id = m.id and o.material_qtd is not null)
$$;

-- consumo por peça esperado de um material num modelo (regra de Corte; a do modelo vale mais que a geral)
create or replace function fab.consumo_por_peca(p_mat uuid, p_modelo text) returns numeric language sql stable set search_path = '' as $$
  select coalesce((select qtd_por_peca from fab.material_consumo where material_id = p_mat and etapa = 'Corte' and modelo = p_modelo),
                  (select qtd_por_peca from fab.material_consumo where material_id = p_mat and etapa = 'Corte' and modelo = ''))
$$;

-- quem fez: {login} (funcionário) ou {oficinaId} (oficina)
create or replace function fab.quem_fez(p_emp uuid, p jsonb, out o_user uuid, out o_oficina uuid, out o_nome text)
language plpgsql stable set search_path = '' as $$
begin
  if nullif(p ->> 'login', '') is not null then
    select id, nome into o_user, o_nome from fab.perfis where empresa_id = p_emp and login = p ->> 'login';
    if o_user is null then raise exception 'Pessoa não encontrada.'; end if;
  elsif nullif(p ->> 'oficinaId', '') is not null then
    select id, nome into o_oficina, o_nome from fab.registros where id = (p ->> 'oficinaId')::uuid and empresa_id = p_emp and tipo = 'oficina';
    if o_oficina is null then raise exception 'Oficina não encontrada.'; end if;
  else
    raise exception 'Informe quem fez (funcionário ou oficina).';
  end if;
end $$;

create or replace function public.fab_salvar_ordem_corte(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis := fab.exige_admin(); q record; v_id uuid; v_num integer; v_data date; v_mat uuid := nullif(p ->> 'materialId', '')::uuid;
  v_mq numeric; it jsonb; v_tam text; v_qtd integer; n integer := 0; m fab.materiais;
begin
  q := fab.quem_fez(u.empresa_id, p -> 'quem');
  if not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'modelo' and nome = p ->> 'modelo') then raise exception 'Modelo inválido.'; end if;
  if not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'cor' and nome = p ->> 'cor') then raise exception 'Cor inválida.'; end if;
  begin v_data := coalesce(nullif(p ->> 'data', '')::date, fab.hoje(u.empresa_id)); exception when others then raise exception 'Data inválida.'; end;
  if v_mat is not null then
    select * into m from fab.materiais where id = v_mat and empresa_id = u.empresa_id;
    if not found then raise exception 'Material inválido.'; end if;
    begin v_mq := nullif(p ->> 'materialQtd', '')::numeric; exception when others then raise exception 'Quantidade de material inválida.'; end;
    if v_mq is not null and v_mq <= 0 then raise exception 'Quantidade de material inválida.'; end if;
  end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') not between 1 and 30 then raise exception 'Informe a quantidade cortada em pelo menos um tamanho.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('ordem:' || u.empresa_id::text, 0));
  select coalesce(max(numero), 0) + 1 into v_num from fab.ordens_corte where empresa_id = u.empresa_id;
  insert into fab.ordens_corte (empresa_id, numero, data, user_id, oficina_id, quem_nome, modelo, cor, material_id, material_qtd, obs, criado_por)
  values (u.empresa_id, v_num, v_data, q.o_user, q.o_oficina, q.o_nome, p ->> 'modelo', p ->> 'cor', v_mat, v_mq, coalesce(left(p ->> 'obs', 300), ''), u.id)
  returning id into v_id;
  for it in select * from jsonb_array_elements(p -> 'itens') loop
    v_tam := it ->> 'tamanho';
    if coalesce(it ->> 'qtd', '') !~ '^[0-9]{1,6}$' then raise exception 'Quantidade inválida.'; end if;
    v_qtd := (it ->> 'qtd')::integer;
    if v_qtd = 0 then continue; end if;
    if not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'tamanho' and nome = v_tam) then raise exception 'Tamanho inválido: %', coalesce(v_tam, '?'); end if;
    insert into fab.ordem_corte_itens (ordem_id, tamanho, qtd) values (v_id, v_tam, v_qtd);
    insert into fab.lancamentos (empresa_id, user_id, oficina_id, oficina_nome, etapa, modelo, cor, tamanho, qtd, obs, dia, origem, ordem_id, lancado_por)
    values (u.empresa_id, q.o_user, q.o_oficina, case when q.o_user is null then q.o_nome else '' end, 'Corte', p ->> 'modelo', p ->> 'cor', v_tam, v_qtd,
            'Ordem de corte #' || v_num, v_data, 'ordem', v_id, u.id);
    n := n + v_qtd;
  end loop;
  if n = 0 then raise exception 'Informe a quantidade cortada em pelo menos um tamanho.'; end if;
  if v_mat is not null and v_mq is not null then
    insert into fab.material_movs (empresa_id, material_id, tipo, qtd, data, obs, criado_por, ordem_id)
    values (u.empresa_id, v_mat, 'saida', v_mq, v_data, 'Ordem de corte #' || v_num || ' (' || (p ->> 'modelo') || ' ' || (p ->> 'cor') || ')', u.id, v_id);
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'pecas', n);
end $$;

create or replace function public.fab_apagar_ordem_corte(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); o fab.ordens_corte;
begin
  select * into o from fab.ordens_corte where id = p_id and empresa_id = u.empresa_id;
  if not found then raise exception 'Ordem de corte não encontrada.'; end if;
  if exists (select 1 from fab.remessas where ordem_id = p_id) then raise exception 'Há remessa feita a partir desta ordem: exclua a remessa antes.'; end if;
  update fab.lancamentos set apagado_em = now() where ordem_id = p_id and apagado_em is null;
  delete from fab.ordens_corte where id = p_id;     -- apaga também a saída do material (cascade)
end $$;

-- ---------------------------------------------------------------- remessas
create table fab.remessas (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references fab.empresas (id) on delete cascade,
  numero            integer not null,
  user_id           uuid references fab.perfis (id) on delete set null,
  oficina_id        uuid references fab.registros (id) on delete set null,
  quem_nome         text not null check (quem_nome <> ''),
  etapa             text not null default 'Costura',
  data_envio        date not null,
  prazo             date,
  valor_peca        numeric(12, 4) not null default 0 check (valor_peca >= 0),
  desconto_faltante numeric(12, 2) not null default 0 check (desconto_faltante >= 0),
  ordem_id          uuid references fab.ordens_corte (id) on delete set null,
  status            text not null default 'aberta' check (status in ('aberta', 'fechada')),
  fechada_em        date,
  valor_pago        numeric(14, 2),
  fin_lancamento_id uuid references fab.fin_lancamentos (id) on delete set null,
  obs               text not null default '',
  criado_por        uuid references fab.perfis (id) on delete set null,
  criado_em         timestamptz not null default now(),
  unique (empresa_id, numero),
  check (prazo is null or prazo >= data_envio)
);
create index remessas_emp_status_idx on fab.remessas (empresa_id, status);
alter table fab.remessas enable row level security;
revoke all on fab.remessas from public;
create trigger auditoria after insert or update or delete on fab.remessas for each row execute function fab.auditar();

create table fab.remessa_itens (
  id         uuid primary key default gen_random_uuid(),
  remessa_id uuid not null references fab.remessas (id) on delete cascade,
  modelo     text not null, cor text not null, tamanho text not null,
  qtd        integer not null check (qtd between 1 and 999999),
  unique (remessa_id, modelo, cor, tamanho)
);
alter table fab.remessa_itens enable row level security;
revoke all on fab.remessa_itens from public;

create table fab.remessa_retornos (
  id         uuid primary key default gen_random_uuid(),
  remessa_id uuid not null references fab.remessas (id) on delete cascade,
  empresa_id uuid not null references fab.empresas (id) on delete cascade,
  data       date not null,
  obs        text not null default '',
  criado_por uuid references fab.perfis (id) on delete set null,
  criado_em  timestamptz not null default now()
);
alter table fab.remessa_retornos enable row level security;
revoke all on fab.remessa_retornos from public;
create trigger auditoria after insert or update or delete on fab.remessa_retornos for each row execute function fab.auditar();

create table fab.retorno_itens (
  retorno_id uuid not null references fab.remessa_retornos (id) on delete cascade,
  item_id    uuid not null references fab.remessa_itens (id) on delete cascade,
  boas       integer not null default 0 check (boas >= 0),
  defeito    integer not null default 0 check (defeito >= 0),
  primary key (retorno_id, item_id),
  check (boas + defeito > 0)
);
alter table fab.retorno_itens enable row level security;
revoke all on fab.retorno_itens from public;

-- resumo de uma remessa
create or replace function fab.remessa_json(r fab.remessas) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'numero', r.numero, 'quem', r.quem_nome, 'login', (select login from fab.perfis where id = r.user_id),
    'oficinaId', r.oficina_id, 'telefone', (select telefone from fab.registros where id = r.oficina_id),
    'etapa', r.etapa, 'dataEnvio', r.data_envio, 'prazo', r.prazo, 'valorPeca', r.valor_peca, 'descontoFaltante', r.desconto_faltante,
    'ordemNumero', (select numero from fab.ordens_corte where id = r.ordem_id), 'status', r.status, 'fechadaEm', r.fechada_em,
    'valorPago', r.valor_pago, 'noFinanceiro', exists (select 1 from fab.fin_lancamentos l where l.id = r.fin_lancamento_id and l.apagado_em is null),
    'obs', r.obs,
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'modelo', i.modelo, 'cor', i.cor, 'tamanho', i.tamanho, 'qtd', i.qtd,
                         'boas', coalesce((select sum(ri.boas) from fab.retorno_itens ri where ri.item_id = i.id), 0),
                         'defeito', coalesce((select sum(ri.defeito) from fab.retorno_itens ri where ri.item_id = i.id), 0))
                       order by i.modelo, i.cor, i.tamanho) from fab.remessa_itens i where i.remessa_id = r.id), '[]'::jsonb),
    'retornos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'data', t.data, 'obs', t.obs,
                            'boas', (select coalesce(sum(boas), 0) from fab.retorno_itens where retorno_id = t.id),
                            'defeito', (select coalesce(sum(defeito), 0) from fab.retorno_itens where retorno_id = t.id))
                          order by t.data, t.criado_em) from fab.remessa_retornos t where t.remessa_id = r.id), '[]'::jsonb))
$$;

create or replace function public.fab_remessas(p_dias integer default 120) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); v_desde date;
begin
  v_desde := fab.hoje(u.empresa_id) - greatest(coalesce(p_dias, 120), 1);
  return jsonb_build_object(
    'remessas', coalesce((select jsonb_agg(fab.remessa_json(r) order by (r.status = 'aberta') desc, r.prazo nulls last, r.numero desc)
                            from fab.remessas r where r.empresa_id = u.empresa_id and (r.status = 'aberta' or r.data_envio >= v_desde or r.fechada_em >= v_desde)), '[]'::jsonb),
    'ordens', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'numero', o.numero, 'data', o.data, 'quem', o.quem_nome, 'modelo', o.modelo, 'cor', o.cor, 'obs', o.obs,
        'material', (select nome from fab.materiais where id = o.material_id), 'unidade', (select unidade from fab.materiais where id = o.material_id),
        'materialQtd', o.material_qtd, 'consumoPeca', case when o.material_id is not null then fab.consumo_por_peca(o.material_id, o.modelo) end,
        'itens', (select coalesce(jsonb_object_agg(i.tamanho, i.qtd), '{}'::jsonb) from fab.ordem_corte_itens i where i.ordem_id = o.id),
        'remetido', (select coalesce(sum(ri.qtd), 0) from fab.remessas r join fab.remessa_itens ri on ri.remessa_id = r.id where r.ordem_id = o.id))
      order by o.data desc, o.numero desc)
      from fab.ordens_corte o where o.empresa_id = u.empresa_id and o.data >= v_desde), '[]'::jsonb));
end $$;

create or replace function public.fab_remessa_opcoes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  return jsonb_build_object(
    'oficinas', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.nome, 'telefone', r.telefone,
                             'etapa', coalesce(r.dados ->> 'etapa', ''), 'valorPeca', case when coalesce(r.dados ->> 'valorPeca', '') ~ '^[0-9]+([.][0-9]+)?$' then (r.dados ->> 'valorPeca')::numeric end) order by r.nome)
                           from fab.registros r where r.empresa_id = u.empresa_id and r.tipo = 'oficina' and r.ativo), '[]'::jsonb),
    'pessoas', coalesce((select jsonb_agg(jsonb_build_object('login', p.login, 'nome', p.nome, 'setor', p.setor) order by p.nome)
                          from fab.perfis p where p.empresa_id = u.empresa_id and p.ativo), '[]'::jsonb),
    'materiais', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'unidade', m.unidade) order by m.nome)
                            from fab.materiais m where m.empresa_id = u.empresa_id and m.ativo), '[]'::jsonb),
    'contas', case when fab.pode(u, 'financeiro') then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) order by c.nome)
                            from fab.fin_contas c where c.empresa_id = u.empresa_id and c.ativa), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.fab_salvar_remessa(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis := fab.exige_admin(); q record; v_id uuid := nullif(p ->> 'id', '')::uuid; antiga fab.remessas; v_num integer;
  v_data date; v_prazo date; v_etapa text := coalesce(nullif(p ->> 'etapa', ''), 'Costura'); v_ordem uuid := nullif(p ->> 'ordemId', '')::uuid;
  v_valor numeric; v_desc numeric; it jsonb; v_qtd integer; n integer := 0;
begin
  q := fab.quem_fez(u.empresa_id, p -> 'quem');
  if not (v_etapa = any (enum_range(null::fab.etapa)::text[])) or v_etapa = (enum_range(null::fab.etapa))[1]::text then
    raise exception 'Etapa inválida para remessa.'; end if;
  begin
    v_data := coalesce(nullif(p ->> 'dataEnvio', '')::date, fab.hoje(u.empresa_id));
    v_prazo := nullif(p ->> 'prazo', '')::date;
  exception when others then raise exception 'Data inválida.'; end;
  if v_prazo is not null and v_prazo < v_data then raise exception 'O prazo não pode ser antes do envio.'; end if;
  begin v_valor := coalesce(nullif(p ->> 'valorPeca', '')::numeric, 0); v_desc := coalesce(nullif(p ->> 'descontoFaltante', '')::numeric, 0);
  exception when others then raise exception 'Valor inválido.'; end;
  if v_valor < 0 or v_desc < 0 then raise exception 'Valor inválido.'; end if;
  if v_ordem is not null and not exists (select 1 from fab.ordens_corte where id = v_ordem and empresa_id = u.empresa_id) then raise exception 'Ordem de corte inválida.'; end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') not between 1 and 300 then raise exception 'Inclua pelo menos um item na remessa.'; end if;

  if v_id is not null then
    select * into antiga from fab.remessas where id = v_id and empresa_id = u.empresa_id for update;
    if not found then raise exception 'Remessa não encontrada.'; end if;
    if antiga.status <> 'aberta' then raise exception 'Reabra a remessa para editar.'; end if;
    if exists (select 1 from fab.remessa_retornos where remessa_id = v_id) then raise exception 'Já há retorno nesta remessa: não dá para mudar os itens. Registre a diferença no retorno.'; end if;
    update fab.remessas set user_id = q.o_user, oficina_id = q.o_oficina, quem_nome = q.o_nome, etapa = v_etapa, data_envio = v_data, prazo = v_prazo,
           valor_peca = v_valor, desconto_faltante = v_desc, ordem_id = v_ordem, obs = coalesce(left(p ->> 'obs', 300), '') where id = v_id;
    delete from fab.remessa_itens where remessa_id = v_id;
    v_num := antiga.numero;
  else
    perform pg_advisory_xact_lock(hashtextextended('remessa:' || u.empresa_id::text, 0));
    select coalesce(max(numero), 0) + 1 into v_num from fab.remessas where empresa_id = u.empresa_id;
    insert into fab.remessas (empresa_id, numero, user_id, oficina_id, quem_nome, etapa, data_envio, prazo, valor_peca, desconto_faltante, ordem_id, obs, criado_por)
    values (u.empresa_id, v_num, q.o_user, q.o_oficina, q.o_nome, v_etapa, v_data, v_prazo, v_valor, v_desc, v_ordem, coalesce(left(p ->> 'obs', 300), ''), u.id)
    returning id into v_id;
  end if;
  for it in select * from jsonb_array_elements(p -> 'itens') loop
    if not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'modelo' and nome = it ->> 'modelo') then raise exception 'Modelo inválido: %', coalesce(it ->> 'modelo', '?'); end if;
    if not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'cor' and nome = it ->> 'cor') then raise exception 'Cor inválida: %', coalesce(it ->> 'cor', '?'); end if;
    if not exists (select 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'tamanho' and nome = it ->> 'tamanho') then raise exception 'Tamanho inválido: %', coalesce(it ->> 'tamanho', '?'); end if;
    if coalesce(it ->> 'qtd', '') !~ '^[0-9]{1,6}$' or (it ->> 'qtd')::integer < 1 then raise exception 'Quantidade inválida.'; end if;
    v_qtd := (it ->> 'qtd')::integer;
    insert into fab.remessa_itens (remessa_id, modelo, cor, tamanho, qtd) values (v_id, it ->> 'modelo', it ->> 'cor', it ->> 'tamanho', v_qtd)
    on conflict (remessa_id, modelo, cor, tamanho) do update set qtd = fab.remessa_itens.qtd + excluded.qtd;
    n := n + v_qtd;
  end loop;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'pecas', n);
end $$;

create or replace function public.fab_apagar_remessa(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); r fab.remessas;
begin
  select * into r from fab.remessas where id = p_id and empresa_id = u.empresa_id;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  if exists (select 1 from fab.remessa_retornos where remessa_id = p_id) then raise exception 'A remessa já tem retorno: exclua os retornos antes.'; end if;
  delete from fab.remessas where id = p_id;
end $$;

-- retorno: {remessaId, data, obs, itens: [{itemId, boas, defeito}]}
create or replace function public.fab_registrar_retorno(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis := fab.exige_admin(); r fab.remessas; v_ret uuid; v_data date; it jsonb; i fab.remessa_itens; v_b integer; v_d integer; v_ja integer; tot integer := 0;
begin
  select * into r from fab.remessas where id = nullif(p ->> 'remessaId', '')::uuid and empresa_id = u.empresa_id for update;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  if r.status <> 'aberta' then raise exception 'A remessa já foi fechada. Reabra para registrar retorno.'; end if;
  begin v_data := coalesce(nullif(p ->> 'data', '')::date, fab.hoje(u.empresa_id)); exception when others then raise exception 'Data inválida.'; end;
  if v_data < r.data_envio then raise exception 'O retorno não pode ser antes do envio.'; end if;
  if jsonb_typeof(p -> 'itens') is distinct from 'array' then raise exception 'Informe o que voltou.'; end if;
  insert into fab.remessa_retornos (remessa_id, empresa_id, data, obs, criado_por) values (r.id, u.empresa_id, v_data, coalesce(left(p ->> 'obs', 300), ''), u.id)
  returning id into v_ret;
  for it in select * from jsonb_array_elements(p -> 'itens') loop
    select * into i from fab.remessa_itens where id = nullif(it ->> 'itemId', '')::uuid and remessa_id = r.id;
    if not found then raise exception 'Item inválido na remessa.'; end if;
    if coalesce(it ->> 'boas', '0') !~ '^[0-9]{1,6}$' or coalesce(it ->> 'defeito', '0') !~ '^[0-9]{1,6}$' then raise exception 'Quantidade inválida.'; end if;
    v_b := coalesce(nullif(it ->> 'boas', '')::integer, 0); v_d := coalesce(nullif(it ->> 'defeito', '')::integer, 0);
    if v_b + v_d = 0 then continue; end if;
    select coalesce(sum(boas + defeito), 0) into v_ja from fab.retorno_itens where item_id = i.id;
    if v_ja + v_b + v_d > i.qtd then
      raise exception '% % %: voltaram % de % enviadas (já tinham voltado %).', i.modelo, i.cor, i.tamanho, v_ja + v_b + v_d, i.qtd, v_ja;
    end if;
    insert into fab.retorno_itens (retorno_id, item_id, boas, defeito) values (v_ret, i.id, v_b, v_d);
    if v_b > 0 then
      insert into fab.lancamentos (empresa_id, user_id, oficina_id, oficina_nome, etapa, modelo, cor, tamanho, qtd, obs, dia, origem, retorno_id, lancado_por)
      values (u.empresa_id, r.user_id, r.oficina_id, case when r.user_id is null then r.quem_nome else '' end, r.etapa::fab.etapa,
              i.modelo, i.cor, i.tamanho, v_b, 'Remessa #' || r.numero, v_data, 'retorno', v_ret, u.id);
    end if;
    tot := tot + v_b + v_d;
  end loop;
  if tot = 0 then raise exception 'Informe quantas peças voltaram (boas ou com defeito).'; end if;
  return v_ret;
end $$;

create or replace function public.fab_apagar_retorno(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); t fab.remessa_retornos; r fab.remessas;
begin
  select * into t from fab.remessa_retornos where id = p_id and empresa_id = u.empresa_id;
  if not found then raise exception 'Retorno não encontrado.'; end if;
  select * into r from fab.remessas where id = t.remessa_id;
  if r.status <> 'aberta' then raise exception 'A remessa já foi fechada. Reabra para corrigir.'; end if;
  update fab.lancamentos set apagado_em = now() where retorno_id = p_id and apagado_em is null;
  delete from fab.remessa_retornos where id = p_id;
end $$;

-- acerto: fecha a remessa; p_pagar = {contaId, data} lança o pagamento no Financeiro (opcional)
create or replace function public.fab_fechar_remessa(p_id uuid, p_pagar jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u fab.perfis := fab.exige_admin(); r fab.remessas; v_env integer; v_boas integer; v_def integer; v_falt integer; v_valor numeric;
  v_conta uuid; v_data date; v_fin uuid;
begin
  select * into r from fab.remessas where id = p_id and empresa_id = u.empresa_id for update;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  if r.status <> 'aberta' then raise exception 'A remessa já está fechada.'; end if;
  select coalesce(sum(i.qtd), 0),
         coalesce(sum((select coalesce(sum(boas), 0) from fab.retorno_itens where item_id = i.id)), 0),
         coalesce(sum((select coalesce(sum(defeito), 0) from fab.retorno_itens where item_id = i.id)), 0)
    into v_env, v_boas, v_def from fab.remessa_itens i where i.remessa_id = p_id;
  v_falt := v_env - v_boas - v_def;
  v_valor := greatest(0, round(v_boas * r.valor_peca - v_falt * r.desconto_faltante, 2));
  if p_pagar is not null and v_valor > 0 then
    if not fab.pode(u, 'financeiro') then raise exception 'Você não tem acesso ao Financeiro para lançar o pagamento.'; end if;
    v_conta := nullif(p_pagar ->> 'contaId', '')::uuid;
    if v_conta is null or not exists (select 1 from fab.fin_contas where id = v_conta and empresa_id = u.empresa_id) then raise exception 'Conta inválida.'; end if;
    begin v_data := coalesce(nullif(p_pagar ->> 'data', '')::date, fab.hoje(u.empresa_id)); exception when others then raise exception 'Data inválida.'; end;
    insert into fab.fin_lancamentos (empresa_id, tipo, data, descricao, valor, conta_id, categoria, responsavel, criado_por, contraparte_id, contraparte_nome)
    values (u.empresa_id, 'saida', v_data, left('Remessa #' || r.numero || ' · ' || r.etapa || ' · ' || r.quem_nome || ' (' || v_boas || ' peças)', 120),
            v_valor, v_conta, 'Facção', r.quem_nome, u.id, r.oficina_id, case when r.oficina_id is not null then r.quem_nome else '' end)
    returning id into v_fin;
  end if;
  update fab.remessas set status = 'fechada', fechada_em = fab.hoje(u.empresa_id), valor_pago = v_valor, fin_lancamento_id = v_fin where id = p_id;
  return jsonb_build_object('enviadas', v_env, 'boas', v_boas, 'defeito', v_def, 'faltando', v_falt, 'valor', v_valor, 'noFinanceiro', v_fin is not null);
end $$;

create or replace function public.fab_reabrir_remessa(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); r fab.remessas;
begin
  select * into r from fab.remessas where id = p_id and empresa_id = u.empresa_id for update;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  if r.status <> 'fechada' then raise exception 'A remessa já está aberta.'; end if;
  if r.fin_lancamento_id is not null then
    if not fab.pode(u, 'financeiro') then raise exception 'O pagamento desta remessa está no Financeiro: peça a quem tem acesso ao Financeiro para reabrir.'; end if;
    update fab.fin_lancamentos set apagado_em = now() where id = r.fin_lancamento_id and apagado_em is null;
  end if;
  update fab.remessas set status = 'aberta', fechada_em = null, valor_pago = null, fin_lancamento_id = null where id = p_id;
end $$;

-- ---------------------------------------------------------------- resumo diário: remessas atrasadas
do $$
declare src text;
begin
  select pg_get_functiondef('fab.avisos_diarios()'::regprocedure) into src;
  src := replace(src, 'ped_atras integer; ped_prox integer; mats text[];', 'ped_atras integer; ped_prox integer; mats text[]; rem_atras integer; rem_pecas integer;');
  src := replace(src, '    for pf in select * from fab.perfis where empresa_id = e.id and ativo loop',
    '    select count(*), coalesce(sum((select coalesce(sum(i.qtd), 0) from fab.remessa_itens i where i.remessa_id = r.id)
                                   - (select coalesce(sum(ri.boas + ri.defeito), 0) from fab.remessa_itens i join fab.retorno_itens ri on ri.item_id = i.id where i.remessa_id = r.id)), 0)
      into rem_atras, rem_pecas from fab.remessas r where r.empresa_id = e.id and r.status = ''aberta'' and r.prazo < v_hoje;
    for pf in select * from fab.perfis where empresa_id = e.id and ativo loop');
  src := replace(src, '      if fab.pode(pf, ''materiais'') and coalesce(cardinality(mats), 0) > 0 then',
    '      if fab.pode(pf, ''remessas'') and rem_atras > 0 then
        linhas := linhas || (rem_atras || '' remessa(s) atrasada(s) nas oficinas: '' || rem_pecas || '' peça(s) para voltar'');
      end if;
      if fab.pode(pf, ''materiais'') and coalesce(cardinality(mats), 0) > 0 then');
  if position('rem_atras integer' in src) = 0 or position('remessa(s) atrasada(s)' in src) = 0 or position('into rem_atras, rem_pecas' in src) = 0 then
    raise exception 'avisos_diarios: trechos não encontrados';
  end if;
  execute src;
end $$;

-- ---------------------------------------------------------------- rotas e permissões
insert into fab.rotas (fn, funcoes) values
  ('fab_remessas', array['remessas']), ('fab_remessa_opcoes', array['remessas']), ('fab_salvar_remessa', array['remessas']),
  ('fab_apagar_remessa', array['remessas']), ('fab_registrar_retorno', array['remessas']), ('fab_apagar_retorno', array['remessas']),
  ('fab_fechar_remessa', array['remessas']), ('fab_reabrir_remessa', array['remessas']),
  ('fab_salvar_ordem_corte', array['remessas']), ('fab_apagar_ordem_corte', array['remessas']),
  ('fab_lancar_por', array['lancar'])
on conflict (fn) do update set funcoes = excluded.funcoes;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_remessas', 'fab_remessa_opcoes', 'fab_salvar_remessa', 'fab_apagar_remessa', 'fab_registrar_retorno',
              'fab_apagar_retorno', 'fab_fechar_remessa', 'fab_reabrir_remessa', 'fab_salvar_ordem_corte', 'fab_apagar_ordem_corte', 'fab_lancar_por')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
