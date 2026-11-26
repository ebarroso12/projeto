-- Fábrica · RESULTADO DA EMPRESA (DRE gerencial; por empresa; só administradores)
-- Baseado no app "DRE Fácil": 5 grupos fixos, categorias configuráveis, preenchimento mensal com
-- "Não se aplica" e "Preencher depois", mês pendente até tudo ser informado.
-- As fórmulas (receita líquida, lucro bruto, margem de contribuição, resultado operacional)
-- são calculadas no app a partir destes dados.

create table fab.dre_categorias (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references fab.empresas (id) on delete cascade,
  chave         text not null,                          -- id padrão (ex.: 'cmv') ou 'custom-…'
  grupo         text not null check (grupo in ('sales', 'direct', 'selling', 'admin', 'finance')),
  nome          text not null check (length(btrim(nome)) between 1 and 80),
  tipo          text not null check (tipo in ('plus', 'minus')),
  variabilidade text not null default 'fixed' check (variabilidade in ('variable', 'fixed')),
  essencial     boolean not null default false,         -- não pode ser desativada (faturamento, devoluções, impostos, CMV)
  nota          text not null default '',
  ativa         boolean not null default true,
  ordem         integer not null default 0,
  unique (empresa_id, chave)
);

create table fab.dre_meses (
  empresa_id     uuid not null references fab.empresas (id) on delete cascade,
  mes            text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status         text not null check (status in ('pendente', 'fechado')),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references fab.perfis (id),
  primary key (empresa_id, mes)
);

create table fab.dre_valores (
  empresa_id   uuid not null,
  mes          text not null,
  categoria_id uuid not null references fab.dre_categorias (id) on delete cascade,
  marca        text not null check (marca in ('valor', 'na', 'depois')),
  valor        numeric(14, 2) check (valor is null or valor >= 0),
  primary key (empresa_id, mes, categoria_id),
  foreign key (empresa_id, mes) references fab.dre_meses (empresa_id, mes) on delete cascade
);

alter table fab.dre_categorias enable row level security;
alter table fab.dre_meses      enable row level security;
alter table fab.dre_valores    enable row level security;
revoke all on fab.dre_categorias, fab.dre_meses, fab.dre_valores from public;

-- ---------- categorias padrão ----------
create function fab.dre_padroes(p_emp uuid) returns void language plpgsql as $$
begin
  insert into fab.dre_categorias (empresa_id, chave, grupo, nome, tipo, variabilidade, essencial, nota, ordem)
  select p_emp, c, g, n, t, v, e, nt, o from (values
    ('gross','sales','Faturamento bruto','plus','variable',true,'Total de vendas do mês, mesmo que parte ainda não tenha sido recebida',1),
    ('returns','sales','Devoluções e descontos','minus','variable',true,'Vendas canceladas, devoluções e descontos sobre vendas',2),
    ('tax','sales','Impostos sobre vendas','minus','variable',true,'Valor do imposto do mês informado pela contabilidade',3),
    ('cmv','direct','CMV / custo dos produtos vendidos','minus','variable',true,'Custo já calculado dos produtos vendidos, não compras para estoque',4),
    ('labor','direct','Mão de obra direta (se fora do CMV)','minus','fixed',false,'Não preencha se já está incluída no CMV',5),
    ('marketplace','selling','Taxas de marketplace','minus','variable',false,'',6),
    ('ads','selling','Anúncios e publicidade','minus','fixed',false,'',7),
    ('packing','selling','Embalagens de envio','minus','variable',false,'',8),
    ('shipping','selling','Fretes pagos pela empresa','minus','variable',false,'',9),
    ('commission','selling','Comissões de vendas','minus','variable',false,'',10),
    ('rent','admin','Aluguel','minus','fixed',false,'',11),
    ('accountant','admin','Contador','minus','fixed',false,'',12),
    ('electricity','admin','Energia e água administrativas','minus','fixed',false,'',13),
    ('internet','admin','Internet e telefone','minus','fixed',false,'',14),
    ('prolabore','admin','Pró-labore','minus','fixed',false,'',15),
    ('cleaning','admin','Limpeza e escritório','minus','fixed',false,'',16),
    ('interest','finance','Juros recebidos','plus','fixed',false,'',17),
    ('dividend','finance','Dividendos recebidos','plus','fixed',false,'',18)
  ) as d(c, g, n, t, v, e, nt, o)
  on conflict (empresa_id, chave) do update set ativa = true;
end $$;

create function fab.nova_empresa_dre() returns trigger language plpgsql set search_path = '' as $$
begin
  perform fab.dre_padroes(new.id);
  return null;
end $$;
create trigger empresas_dre after insert on fab.empresas for each row execute function fab.nova_empresa_dre();
select fab.dre_padroes(id) from fab.empresas;

-- =====================================================================
-- API
-- =====================================================================
create function public.dre_dados() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis; e uuid;
begin
  u := fab.exige_admin(); e := u.empresa_id;
  return jsonb_build_object(
    'hoje', fab.hoje(e),
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', c.id, 'chave', c.chave, 'grupo', c.grupo, 'nome', c.nome, 'tipo', c.tipo,
                      'variabilidade', c.variabilidade, 'essencial', c.essencial, 'nota', c.nota, 'ativa', c.ativa, 'ordem', c.ordem)
                    order by c.ordem, c.nome), '[]') from fab.dre_categorias c where c.empresa_id = e),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object(
                 'mes', m.mes, 'status', m.status,
                 'atualizadoEm', to_char(m.atualizado_em at time zone fab.fuso(e), 'YYYY-MM-DD"T"HH24:MI'),
                 'valores', (select coalesce(jsonb_object_agg(v.categoria_id, jsonb_build_object('marca', v.marca, 'valor', v.valor)), '{}')
                               from fab.dre_valores v where v.empresa_id = e and v.mes = m.mes))
               order by m.mes desc), '[]') from fab.dre_meses m where m.empresa_id = e));
end $$;

-- Salva o mês inteiro. Fica "fechado" quando toda categoria ativa tem valor ou "não se aplica".
create function public.dre_salvar_mes(p_mes text, p_itens jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; it jsonb; v_cat uuid; v_marca text; v_valor numeric; v_status text;
begin
  u := fab.exige_admin();
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mês inválido.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Nada para salvar.'; end if;

  insert into fab.dre_meses (empresa_id, mes, status, atualizado_por) values (u.empresa_id, p_mes, 'pendente', u.id)
  on conflict (empresa_id, mes) do update set atualizado_em = now(), atualizado_por = u.id;
  delete from fab.dre_valores where empresa_id = u.empresa_id and mes = p_mes;

  for it in select * from jsonb_array_elements(p_itens) loop
    v_cat := nullif(it ->> 'categoriaId', '')::uuid;
    v_marca := it ->> 'marca';
    if not exists (select 1 from fab.dre_categorias where id = v_cat and empresa_id = u.empresa_id) then raise exception 'Categoria inválida.'; end if;
    if v_marca not in ('valor', 'na', 'depois') then raise exception 'Marcação inválida.'; end if;
    v_valor := null;
    if v_marca = 'valor' then
      begin v_valor := (it ->> 'valor')::numeric; exception when others then raise exception 'Valor inválido.'; end;
      if v_valor is null or v_valor < 0 then raise exception 'Valores não podem ser negativos.'; end if;
    end if;
    insert into fab.dre_valores (empresa_id, mes, categoria_id, marca, valor) values (u.empresa_id, p_mes, v_cat, v_marca, round(v_valor, 2))
    on conflict (empresa_id, mes, categoria_id) do update set marca = excluded.marca, valor = excluded.valor;
  end loop;

  v_status := case when exists (
      select 1 from fab.dre_categorias c
       where c.empresa_id = u.empresa_id and c.ativa
         and not exists (select 1 from fab.dre_valores v where v.empresa_id = u.empresa_id and v.mes = p_mes and v.categoria_id = c.id and v.marca in ('valor', 'na')))
    then 'pendente' else 'fechado' end;
  update fab.dre_meses set status = v_status where empresa_id = u.empresa_id and mes = p_mes;
  return v_status;
end $$;

create function public.dre_apagar_mes(p_mes text) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.exige_admin();
  delete from fab.dre_meses where empresa_id = u.empresa_id and mes = p_mes;
  if not found then raise exception 'Mês não encontrado.'; end if;
end $$;

create function public.dre_salvar_categoria(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; v_id uuid := nullif(p ->> 'id', '')::uuid; v_grupo text := p ->> 'grupo'; v_tipo text; c fab.dre_categorias;
begin
  u := fab.exige_admin();
  if coalesce(btrim(p ->> 'nome'), '') = '' then raise exception 'Informe o nome da categoria.'; end if;
  if coalesce(p ->> 'variabilidade', 'fixed') not in ('variable', 'fixed') then raise exception 'Classificação inválida.'; end if;
  if v_id is null then
    if v_grupo not in ('sales', 'direct', 'selling', 'admin', 'finance') then raise exception 'Grupo inválido.'; end if;
    v_tipo := case v_grupo when 'finance' then 'plus' when 'sales' then case when p ->> 'tipo' = 'plus' then 'plus' else 'minus' end else 'minus' end;
    insert into fab.dre_categorias (empresa_id, chave, grupo, nome, tipo, variabilidade, nota, ordem)
    values (u.empresa_id, 'custom-' || replace(gen_random_uuid()::text, '-', ''), v_grupo, btrim(p ->> 'nome'), v_tipo,
            coalesce(p ->> 'variabilidade', 'fixed'), coalesce(left(p ->> 'nota', 200), ''),
            coalesce((select max(ordem) from fab.dre_categorias where empresa_id = u.empresa_id), 0) + 1)
    returning id into v_id;
  else
    select * into c from fab.dre_categorias where id = v_id and empresa_id = u.empresa_id for update;
    if not found then raise exception 'Categoria não encontrada.'; end if;
    if c.essencial and coalesce((p ->> 'ativa')::boolean, true) = false then raise exception 'Esta categoria é essencial e não pode ser desativada.'; end if;
    update fab.dre_categorias set nome = btrim(p ->> 'nome'), variabilidade = coalesce(p ->> 'variabilidade', c.variabilidade),
           nota = coalesce(left(p ->> 'nota', 200), c.nota), ativa = coalesce((p ->> 'ativa')::boolean, c.ativa)
     where id = v_id;
  end if;
  return v_id;
end $$;

create function public.dre_restaurar_categorias() returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis;
begin
  u := fab.exige_admin();
  perform fab.dre_padroes(u.empresa_id);
end $$;
