-- Ficha do cliente / fornecedor: histórico no Financeiro.
-- As duas funções começam com "fin_" -> exigem a função Financeiro (fab.eu / exige_admin + funcoes_da_rota),
-- então quem só tem Cadastros vê a ficha sem os valores.

-- Todos os lançamentos (não apagados) ligados a um cliente/fornecedor, no mesmo formato do fin_dados.
create or replace function public.fin_contraparte_lancamentos(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  if not exists (select 1 from fab.registros where id = p_id and empresa_id = u.empresa_id and tipo in ('cliente', 'fornecedor')) then
    raise exception 'Cliente ou fornecedor não encontrado.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'tipo', l.tipo, 'data', l.data, 'descricao', l.descricao, 'valor', l.valor,
      'contaId', l.conta_id, 'cartaoId', l.cartao_id, 'forma', l.forma, 'categoria', l.categoria,
      'responsavel', l.responsavel, 'centro', l.centro, 'parcelas', l.parcelas, 'valorParcela', l.valor_parcela,
      'diaVencimento', l.dia_vencimento, 'parcelasPagas', l.parcelas_pagas, 'vencimentoFatura', l.vencimento_fatura,
      'origemId', l.origem_id, 'obs', l.obs, 'contraparteId', l.contraparte_id, 'contraparte', l.contraparte_nome)
      order by l.data desc, l.criado_em desc)
    from fab.fin_lancamentos l
    where l.empresa_id = u.empresa_id and l.contraparte_id = p_id and l.apagado_em is null), '[]'::jsonb);
end $$;

-- Totais do ano por cliente/fornecedor (para a coluna da lista de Cadastros).
create or replace function public.fin_contrapartes_totais(p_ano integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  if p_ano is null or p_ano not between 2000 and 2100 then raise exception 'Ano inválido.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'recebido', x.recebido, 'pago', x.pago, 'qtd', x.qtd, 'ultimo', x.ultimo))
    from (
      select l.contraparte_id as id,
             coalesce(sum(l.valor) filter (where l.tipo = 'entrada' and extract(year from l.data) = p_ano), 0) as recebido,
             coalesce(sum(l.valor) filter (where l.tipo = 'saida' and extract(year from l.data) = p_ano), 0) as pago,
             count(*) filter (where extract(year from l.data) = p_ano) as qtd,
             max(l.data) filter (where l.tipo <> 'programada') as ultimo
        from fab.fin_lancamentos l
       where l.empresa_id = u.empresa_id and l.contraparte_id is not null and l.apagado_em is null
       group by l.contraparte_id
    ) x), '[]'::jsonb);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fin_contraparte_lancamentos', 'fin_contrapartes_totais')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
