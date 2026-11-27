-- Financeiro ligado aos Cadastros: cada lançamento pode apontar para um cliente ou um fornecedor.
--   * entrada  -> normalmente um CLIENTE (quem pagou)
--   * saída / programada -> normalmente um FORNECEDOR (a quem se pagou)
-- Guardamos o id (para somar por cliente/fornecedor) e uma cópia do nome (o lançamento continua legível
-- mesmo se o cadastro for excluído depois: o id vira null, o nome fica).

alter table fab.fin_lancamentos
  add column if not exists contraparte_id   uuid references fab.registros (id) on delete set null,
  add column if not exists contraparte_nome text not null default '';
create index if not exists fin_lanc_contraparte_idx on fab.fin_lancamentos (contraparte_id);

-- Valida e devolve (id, nome) da contraparte enviada pelo formulário.
create or replace function fab.fin_contraparte(p jsonb, p_emp uuid, out o_id uuid, out o_nome text)
language plpgsql stable set search_path = '' as $$
declare r fab.registros;
begin
  o_id := nullif(p ->> 'contraparteId', '')::uuid;
  o_nome := '';
  if o_id is null then return; end if;
  select * into r from fab.registros where id = o_id and empresa_id = p_emp and tipo in ('cliente', 'fornecedor');
  if not found then raise exception 'Cliente ou fornecedor inválido.'; end if;
  o_nome := r.nome;
end $$;

-- fin_salvar_lancamento: grava a contraparte no update e no insert (mesmo corpo, só acrescenta os campos)
do $$
declare src text; antes text;
begin
  select pg_get_functiondef('public.fin_salvar_lancamento(jsonb)'::regprocedure) into src;
  antes := src;
  src := replace(src, 'antigo fab.fin_lancamentos;', 'antigo fab.fin_lancamentos; cp record;');
  src := replace(src, 'v_id := nullif(p ->> ''id'', '''')::uuid;',
                      'cp := fab.fin_contraparte(p, u.empresa_id);' || chr(10) || '  v_id := nullif(p ->> ''id'', '''')::uuid;');
  src := replace(src, 'obs = coalesce(left(p ->> ''obs'', 300), '''')' || chr(10) || '    where id = v_id;',
                      'obs = coalesce(left(p ->> ''obs'', 300), ''''), contraparte_id = cp.o_id, contraparte_nome = cp.o_nome' || chr(10) || '    where id = v_id;');
  src := replace(src, 'vencimento_fatura, obs, criado_por)', 'vencimento_fatura, obs, criado_por, contraparte_id, contraparte_nome)');
  src := replace(src, 'coalesce(left(p ->> ''obs'', 300), ''''), u.id)', 'coalesce(left(p ->> ''obs'', 300), ''''), u.id, cp.o_id, cp.o_nome)');
  if (length(src) - length(antes)) < 120 or position('contraparte_id = cp.o_id' in src) = 0 or position('u.id, cp.o_id' in src) = 0
     or position('cp := fab.fin_contraparte' in src) = 0 then
    raise exception 'fin_salvar_lancamento: não consegui aplicar a contraparte';
  end if;
  execute src;
end $$;

-- fin_pagar_parcela: a parcela paga herda o fornecedor da conta programada
do $$
declare src text;
begin
  select pg_get_functiondef('public.fin_pagar_parcela(uuid, date, numeric, uuid)'::regprocedure) into src;
  src := replace(src, 'centro, origem_id, criado_por)', 'centro, origem_id, criado_por, contraparte_id, contraparte_nome)');
  src := replace(src, 'l.centro, l.id, u.id);', 'l.centro, l.id, u.id, l.contraparte_id, l.contraparte_nome);');
  if position('l.contraparte_id, l.contraparte_nome' in src) = 0 then raise exception 'fin_pagar_parcela: trecho não encontrado'; end if;
  execute src;
end $$;

-- fin_dados: devolve contraparteId e contraparte (nome atual do cadastro, ou a cópia guardada)
do $$
declare src text;
begin
  select pg_get_functiondef('public.fin_dados()'::regprocedure) into src;
  src := replace(src, '''origemId'', l.origem_id, ''obs'', l.obs)',
                      '''origemId'', l.origem_id, ''obs'', l.obs, ''contraparteId'', l.contraparte_id, '
                      || '''contraparte'', coalesce((select r.nome from fab.registros r where r.id = l.contraparte_id), l.contraparte_nome))');
  if position('contraparteId' in src) = 0 then raise exception 'fin_dados: trecho de lançamentos não encontrado'; end if;
  execute src;
end $$;

-- Lista de clientes e fornecedores ativos para o formulário do Financeiro (rota "fin_" -> função Financeiro,
-- então quem tem só o Financeiro liberado também enxerga a lista, sem precisar de Cadastros).
create or replace function public.fin_contrapartes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'tipo', r.tipo, 'nome', r.nome, 'documento', r.documento) order by r.tipo, r.nome)
                     from fab.registros r where r.empresa_id = u.empresa_id and r.tipo in ('cliente', 'fornecedor') and r.ativo), '[]'::jsonb);
end $$;

revoke all on function public.fin_contrapartes() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.fin_contrapartes() from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then grant execute on function public.fin_contrapartes() to authenticated; end if;
end $$;
revoke all on function fab.fin_contraparte(jsonb, uuid) from public;
