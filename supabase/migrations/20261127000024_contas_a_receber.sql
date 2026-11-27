-- =====================================================================
-- Contas a receber + tabela de rotas
--
-- 1) Rotas: fab.funcoes_da_rota() passa a consultar a tabela fab.rotas antes das regras antigas.
--    Cada módulo novo só insere as suas linhas (sem reescrever a função inteira a cada migração).
-- 2) Financeiro: novo tipo de lançamento 'receber' = venda a prazo / valor que o cliente vai pagar,
--    em parcelas com dia de vencimento (espelho do 'programada', que é o que a empresa vai pagar).
--    Cada parcela recebida vira uma ENTRADA na conta (fin_receber_parcela), herdando o cliente.
-- =====================================================================

-- ---------------------------------------------------------------- rotas
create table if not exists fab.rotas (
  fn      text primary key,      -- nome da função RPC (ex.: fab_pedidos)
  funcoes text[] not null        -- funções do sistema que liberam a chamada (basta uma)
);
alter table fab.rotas enable row level security;
revoke all on fab.rotas from public;

create or replace function fab.funcoes_da_rota() returns text[] language sql stable set search_path = '' as $$
  select coalesce((select r.funcoes from fab.rotas r where r.fn = x.fn), case
    when fn = 'fab_painel' then array['painel']
    when fn = 'fab_relatorio' then array['relatorio', 'dashboard']
    when fn in ('fab_lancar', 'fab_editar_lancamento', 'fab_apagar_lancamento') then array['lancar']
    when fn in ('fab_bater_ponto', 'fab_status_rede') then array['ponto']
    when fn in ('fab_add_em_falta', 'fab_status_em_falta') then array['falta']
    when fn like 'fin\_%' then array['financeiro']
    when fn like 'dre\_%' then array['resultado']
    when fn in ('fab_listar_usuarios', 'fab_atualizar_perfil', 'fab_salvar_lista', 'fab_criar_chave', 'fab_revogar_chaves', 'fab_exportar',
                'fab_ver_wifi', 'fab_salvar_wifi', 'fab_cadastrar_rede_atual', 'fab_minha_empresa', 'fab_salvar_funcoes', 'fab_funcoes_pessoa',
                'fab_registros', 'fab_salvar_registro', 'fab_apagar_registro', 'fab_dados_pessoas', 'fab_salvar_dados_pessoa') then array['cadastros']
    when fn in ('fab_acessos', 'fab_acessos_pendentes', 'fab_decidir_acesso', 'fab_encerrar_sessao', 'fab_revogar_aparelho',
                'fab_config_acesso', 'fab_bloquear_pessoa') then array['acessos']
    when fn in ('fab_enviar_mensagem', 'fab_mensagens_enviadas', 'fab_apagar_mensagem', 'fab_destinatarios') then array['mensagens']
    else null end)
  from (select substring(coalesce(current_setting('request.path', true), '') from '/rpc/([a-z_]+)') as fn) x
$$;

-- ---------------------------------------------------------------- tipo 'receber'
do $$
declare c record;
begin
  -- troca os checks que citam os tipos (nomes gerados automaticamente)
  for c in select conname from pg_constraint
            where conrelid = 'fab.fin_lancamentos'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%programada%'
  loop
    execute format('alter table fab.fin_lancamentos drop constraint %I', c.conname);
  end loop;
end $$;
alter table fab.fin_lancamentos
  add constraint fin_lanc_tipo_check check (tipo in ('entrada', 'saida', 'programada', 'receber')),
  add constraint fin_lanc_programada_check check (tipo <> 'programada' or (parcelas is not null and valor_parcela is not null and (cartao_id is not null or dia_vencimento is not null))),
  add constraint fin_lanc_receber_check check (tipo <> 'receber' or (parcelas is not null and valor_parcela is not null and dia_vencimento is not null and cartao_id is null));

-- fin_salvar_lancamento: aceita 'receber' (só em conta, com parcelas e dia de vencimento)
do $$
declare src text; antes text;
begin
  select pg_get_functiondef('public.fin_salvar_lancamento(jsonb)'::regprocedure) into src;
  antes := src;
  src := replace(src, 'if v_tipo not in (''entrada'', ''saida'', ''programada'') then', 'if v_tipo not in (''entrada'', ''saida'', ''programada'', ''receber'') then');
  src := replace(src, 'if v_tipo = ''entrada'' then v_cartao := null; end if;', 'if v_tipo in (''entrada'', ''receber'') then v_cartao := null; end if;');
  src := replace(src, '  if v_tipo = ''programada'' then', '  if v_tipo in (''programada'', ''receber'') then');
  src := replace(src, 'if antigo.tipo = ''programada'' and v_parc', 'if antigo.tipo in (''programada'', ''receber'') and v_parc');
  if position('''receber'') then v_cartao' in src) = 0 or position('if v_tipo in (''programada'', ''receber'') then' in src) = 0
     or position('antigo.tipo in (''programada'', ''receber'')' in src) = 0 or position('''programada'', ''receber'') then raise' in src) = 0 then
    raise exception 'fin_salvar_lancamento: não consegui aplicar o tipo receber';
  end if;
  execute src;
end $$;

-- fin_pagar_parcela só serve para 'programada' (já filtra por tipo) — recebimento tem função própria:
create or replace function public.fin_receber_parcela(p_id uuid, p_data date, p_valor numeric, p_conta uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; l fab.fin_lancamentos; v_conta uuid;
begin
  u := fab.exige_admin();
  select * into l from fab.fin_lancamentos where id = p_id and empresa_id = u.empresa_id and apagado_em is null and tipo = 'receber' for update;
  if not found then raise exception 'Conta a receber não encontrada.'; end if;
  if l.parcelas_pagas >= l.parcelas then raise exception 'Todas as parcelas já foram recebidas.'; end if;
  if coalesce(p_valor, 0) <= 0 or p_data is null then raise exception 'Informe a data e o valor recebido.'; end if;
  v_conta := coalesce(p_conta, l.conta_id);
  if not exists (select 1 from fab.fin_contas where id = v_conta and empresa_id = u.empresa_id) then raise exception 'Conta inválida.'; end if;
  update fab.fin_lancamentos set parcelas_pagas = parcelas_pagas + 1 where id = p_id;
  insert into fab.fin_lancamentos (empresa_id, tipo, data, descricao, valor, conta_id, forma, categoria, responsavel, centro, origem_id, criado_por,
                                   contraparte_id, contraparte_nome)
  values (u.empresa_id, 'entrada', p_data, left(l.descricao || ' · parcela ' || (l.parcelas_pagas + 1) || '/' || l.parcelas, 120), p_valor, v_conta,
          l.forma, l.categoria, l.responsavel, l.centro, l.id, u.id, l.contraparte_id, l.contraparte_nome);
end $$;

-- histórico do cliente/fornecedor: "último" ignora também as contas a receber (são promessas, não movimento)
create or replace function public.fin_contrapartes_totais(p_ano integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  if p_ano is null or p_ano not between 2000 and 2100 then raise exception 'Ano inválido.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'recebido', x.recebido, 'pago', x.pago, 'qtd', x.qtd, 'ultimo', x.ultimo, 'aReceber', x.a_receber))
    from (
      select l.contraparte_id as id,
             coalesce(sum(l.valor) filter (where l.tipo = 'entrada' and extract(year from l.data) = p_ano), 0) as recebido,
             coalesce(sum(l.valor) filter (where l.tipo = 'saida' and extract(year from l.data) = p_ano), 0) as pago,
             count(*) filter (where extract(year from l.data) = p_ano) as qtd,
             max(l.data) filter (where l.tipo in ('entrada', 'saida')) as ultimo,
             coalesce(sum((l.parcelas - l.parcelas_pagas) * l.valor_parcela) filter (where l.tipo = 'receber'), 0) as a_receber
        from fab.fin_lancamentos l
       where l.empresa_id = u.empresa_id and l.contraparte_id is not null and l.apagado_em is null
       group by l.contraparte_id
    ) x), '[]'::jsonb);
end $$;

revoke all on function public.fin_receber_parcela(uuid, date, numeric, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.fin_receber_parcela(uuid, date, numeric, uuid) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then grant execute on function public.fin_receber_parcela(uuid, date, numeric, uuid) to authenticated; end if;
end $$;
