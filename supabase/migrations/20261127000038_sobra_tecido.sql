-- =====================================================================
-- Sobra de tecido: o que volta da bobina para o estoque depois do corte
--
--  * A ordem de corte guarda o tecido LEVADO (material_qtd) e a SOBRA que voltou (sobra_qtd).
--    Tecido usado = levado − sobra. O rendimento (peças esperadas) e o alerta de perda usam o usado.
--  * A sobra entra no estoque como ajuste (+) ligado à ordem: não conta como compra nem mexe no custo médio.
--  * Pode ser informada ao criar a ordem ou depois (pesou mais tarde); informar de novo substitui.
--  * Movimento de estoque que vem de uma ordem de corte (saída da bobina ou sobra) só muda pela ordem.
-- =====================================================================

alter table fab.ordens_corte add column if not exists sobra_qtd numeric(14, 3) check (sobra_qtd is null or sobra_qtd > 0);

create or replace function fab.gravar_sobra_ordem(o fab.ordens_corte, p_qtd numeric, p_data date, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from fab.material_movs where ordem_id = o.id and tipo = 'ajuste';
  if coalesce(p_qtd, 0) > 0 then
    insert into fab.material_movs (empresa_id, material_id, tipo, qtd, data, obs, criado_por, ordem_id)
    values (o.empresa_id, o.material_id, 'ajuste', p_qtd, p_data, 'Sobra da ordem de corte #' || o.numero || ' (' || o.modelo || ' ' || o.cor || ')', p_user, o.id);
  end if;
  update fab.ordens_corte set sobra_qtd = nullif(p_qtd, 0) where id = o.id;
end $$;
revoke all on function fab.gravar_sobra_ordem(fab.ordens_corte, numeric, date, uuid) from public;

-- sobra depois da ordem criada (0 = tira a sobra)
create or replace function public.fab_registrar_sobra(p_ordem uuid, p_qtd numeric, p_data date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); o fab.ordens_corte; v_data date;
begin
  select * into o from fab.ordens_corte where id = p_ordem and empresa_id = u.empresa_id for update;
  if not found then raise exception 'Ordem de corte não encontrada.'; end if;
  if o.material_id is null or o.material_qtd is null then raise exception 'Esta ordem não tem a bobina informada: não há de onde sobrar tecido.'; end if;
  if p_qtd is null or p_qtd < 0 then raise exception 'Quantidade de sobra inválida.'; end if;
  if p_qtd >= o.material_qtd then
    raise exception 'A sobra precisa ser menor que o tecido levado (%).', trim(to_char(o.material_qtd, 'FM999999990.###'));
  end if;
  v_data := coalesce(p_data, fab.hoje(u.empresa_id));
  if v_data < o.data then raise exception 'A sobra não pode ser antes da ordem de corte.'; end if;
  perform fab.gravar_sobra_ordem(o, round(p_qtd, 3), v_data, u.id);
  return jsonb_build_object('levado', o.material_qtd, 'sobra', round(p_qtd, 3), 'usado', o.material_qtd - round(p_qtd, 3));
end $$;

do $$
declare src text;
begin
  -- criar a ordem já com a sobra (opcional); o alerta de perda usa o tecido usado
  select pg_get_functiondef('public.fab_salvar_ordem_corte(jsonb)'::regprocedure) into src;
  src := replace(src, 'n integer := 0; m fab.materiais;', 'n integer := 0; m fab.materiais; v_sobra numeric; v_usado numeric; o_nova fab.ordens_corte;');
  src := replace(src, '  if v_mat is not null and v_mq is not null and coalesce(fab.consumo_por_peca(v_mat, p ->> ''modelo''), 0) > 0 then',
    '  begin v_sobra := nullif(p ->> ''sobraQtd'', '''')::numeric; exception when others then raise exception ''Quantidade de sobra inválida.''; end;
  if v_sobra is not null and v_sobra > 0 then
    if v_mat is null or v_mq is null then raise exception ''Informe a bobina e o tecido levado para registrar a sobra.''; end if;
    if v_sobra >= v_mq then raise exception ''A sobra precisa ser menor que o tecido levado.''; end if;
    select * into o_nova from fab.ordens_corte where id = v_id;
    perform fab.gravar_sobra_ordem(o_nova, round(v_sobra, 3), v_data, u.id);
  elsif v_sobra is not null and v_sobra < 0 then
    raise exception ''Quantidade de sobra inválida.'';
  end if;
  v_usado := v_mq - coalesce(case when v_sobra > 0 then round(v_sobra, 3) end, 0);
  if v_mat is not null and v_mq is not null and coalesce(fab.consumo_por_peca(v_mat, p ->> ''modelo''), 0) > 0 then');
  src := replace(src, 'declare esp integer := floor(v_mq / fab.consumo_por_peca(v_mat, p ->> ''modelo'') + 1e-9);',
                      'declare esp integer := floor(v_usado / fab.consumo_por_peca(v_mat, p ->> ''modelo'') + 1e-9);');
  if position('v_usado / fab.consumo_por_peca' in src) = 0 or position('gravar_sobra_ordem' in src) = 0 or position('o_nova fab.ordens_corte' in src) = 0 then
    raise exception 'fab_salvar_ordem_corte: trechos não encontrados';
  end if;
  execute src;

  -- a tela recebe a sobra
  select pg_get_functiondef('public.fab_remessas(integer)'::regprocedure) into src;
  src := replace(src, '''materialQtd'', o.material_qtd,', '''materialQtd'', o.material_qtd, ''sobra'', o.sobra_qtd,');
  if position('''sobra'', o.sobra_qtd' in src) = 0 then raise exception 'fab_remessas: trecho não encontrado'; end if;
  execute src;

  -- movimento que vem de uma ordem de corte só muda pela ordem (antes dava para apagar a saída da bobina pelo histórico)
  select pg_get_functiondef('public.fab_apagar_mov_material(uuid)'::regprocedure) into src;
  src := replace(src, '  delete from fab.material_movs where id = p_id;',
    '  if v.ordem_id is not null then
    raise exception ''Este movimento vem da ordem de corte #%: corrija pela ordem (sobra ou excluir a ordem).'', (select numero from fab.ordens_corte where id = v.ordem_id);
  end if;
  delete from fab.material_movs where id = p_id;');
  if position('v.ordem_id is not null' in src) = 0 then raise exception 'fab_apagar_mov_material: trecho não encontrado'; end if;
  execute src;
end $$;

insert into fab.rotas (fn, funcoes) values ('fab_registrar_sobra', array['remessas'])
on conflict (fn) do update set funcoes = excluded.funcoes;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fab_registrar_sobra'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
