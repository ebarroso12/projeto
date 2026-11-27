-- =====================================================================
-- Cópia de segurança completa (formato fabrica-backup-2) + lembrete semanal
--
--  * Antes: só entravam tabelas com empresa_id. Os ITENS (de pedidos, remessas, retornos, ordens de corte,
--    regras de consumo e leituras de mensagens) não têm empresa_id e ficavam de fora: a cópia não
--    permitia reconstruir pedidos nem remessas. Agora entram pela tabela "mãe".
--  * Nada que dê acesso vai no arquivo: chaves de acesso, inscrições de avisos (endereço + chaves de
--    criptografia do aparelho), id da sessão de login e id do aparelho confiável ficam de fora.
--    Filas internas (avisos_fila, dani_uso) também (não são dados da empresa).
--  * Quem baixa fica registrado na Atividade ("Baixou a cópia de segurança").
--  * Toda segunda-feira às 8h (Brasília), quem administra recebe aviso se a última cópia tem mais de 7 dias.
-- =====================================================================

create or replace function public.fab_exportar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis; t record; linhas jsonb; saida jsonb; cont jsonb := '{}'::jsonb;
  ver_fin boolean; ver_dre boolean; e uuid;
begin
  u := fab.exige_admin();
  e := u.empresa_id;
  ver_fin := fab.pode(u, 'financeiro'); ver_dre := fab.pode(u, 'resultado');
  saida := jsonb_build_object(
    'formato', 'fabrica-backup-2',
    'geradoEm', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'geradoPor', u.nome,
    'empresa', (select to_jsonb(x) - 'motivo_bloqueio' from fab.empresas x where x.id = e),
    'parcial', not (ver_fin and ver_dre),
    'tabelas', '{}'::jsonb);

  -- tabelas da empresa (empresa_id)
  for t in
    select c.table_name from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'fab' and c.column_name = 'empresa_id'
       and c.table_name not in ('chaves_acesso', 'push_inscricoes', 'avisos_fila', 'dani_uso')
       and (ver_fin or c.table_name not like 'fin\_%')
       and (ver_dre or c.table_name not like 'dre\_%')
     order by c.table_name
  loop
    if t.table_name = 'eventos' then
      select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) into linhas from fab.eventos x
       where x.empresa_id = e and fab.evento_visivel(u, x.alvo);
    elsif t.table_name = 'sessoes' then
      select coalesce(jsonb_agg(to_jsonb(x) - 'session_id'), '[]'::jsonb) into linhas from fab.sessoes x where x.empresa_id = e;
    elsif t.table_name = 'aparelhos_confiaveis' then
      select coalesce(jsonb_agg(to_jsonb(x) - 'aparelho'), '[]'::jsonb) into linhas from fab.aparelhos_confiaveis x where x.empresa_id = e;
    else
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from fab.%I x where x.empresa_id = $1', t.table_name)
        into linhas using e;
    end if;
    saida := jsonb_set(saida, array['tabelas', t.table_name], linhas);
  end loop;

  -- itens (sem empresa_id): entram pela tabela mãe da empresa
  saida := jsonb_set(saida, '{tabelas,pedido_itens}', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from fab.pedido_itens i join fab.pedidos p on p.id = i.pedido_id where p.empresa_id = e));
  saida := jsonb_set(saida, '{tabelas,remessa_itens}', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from fab.remessa_itens i join fab.remessas r on r.id = i.remessa_id where r.empresa_id = e));
  saida := jsonb_set(saida, '{tabelas,retorno_itens}', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from fab.retorno_itens i join fab.remessa_retornos r on r.id = i.retorno_id where r.empresa_id = e));
  saida := jsonb_set(saida, '{tabelas,ordem_corte_itens}', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from fab.ordem_corte_itens i join fab.ordens_corte o on o.id = i.ordem_id where o.empresa_id = e));
  saida := jsonb_set(saida, '{tabelas,material_consumo}', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from fab.material_consumo i join fab.materiais m on m.id = i.material_id where m.empresa_id = e));
  saida := jsonb_set(saida, '{tabelas,mensagens_lidas}', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from fab.mensagens_lidas i join fab.mensagens m on m.id = i.mensagem_id where m.empresa_id = e));

  select coalesce(jsonb_object_agg(k, jsonb_array_length(v)), '{}') into cont from jsonb_each(saida -> 'tabelas') as x(k, v);
  saida := saida || jsonb_build_object('contagem', cont);

  perform fab.registrar(e, u.id, u.nome, 'backup', 'backup', jsonb_build_object('parcial', not (ver_fin and ver_dre)));
  return saida;
end $$;

-- última cópia da empresa (para a tela mostrar "há N dias")
create or replace function public.fab_backup_situacao() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis; ult record;
begin
  u := fab.exige_admin();
  select em, quem into ult from fab.eventos where empresa_id = u.empresa_id and tipo = 'backup' order by em desc limit 1;
  return jsonb_build_object('ultima', ult.em, 'quem', ult.quem,
    'dias', case when ult.em is null then null else (fab.hoje(u.empresa_id) - (ult.em at time zone coalesce((select fuso from fab.configuracao where empresa_id = u.empresa_id), 'America/Sao_Paulo'))::date) end);
end $$;

-- lembrete semanal: administradores ativos de empresas ativas sem cópia nos últimos 7 dias
create or replace function fab.lembrete_backup() returns integer
language plpgsql security definer set search_path = '' as $$
declare e record; ult timestamptz; v_users uuid[]; n integer := 0;
begin
  for e in select * from fab.empresas where ativa and (teste_ate is null or teste_ate >= now()) loop
    select max(em) into ult from fab.eventos where empresa_id = e.id and tipo = 'backup';
    if ult is not null and ult > now() - interval '7 days' then continue; end if;
    select array_agg(id) into v_users from fab.perfis where empresa_id = e.id and ativo and perfil = 'admin';
    if v_users is null then continue; end if;
    perform fab.enviar_aviso(e.id, v_users, 'backup', 'Cópia de segurança',
      case when ult is null then 'A empresa ainda não tem cópia de segurança. Baixe em Cadastros > Cópia de segurança.'
           else 'A última cópia tem ' || extract(day from now() - ult)::int || ' dias. Baixe uma nova em Cadastros > Cópia de segurança.' end,
      '#/cadastros?aba=backup');
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fab_lembrete_backup', '5 11 * * 1', 'select fab.lembrete_backup()');   -- segunda, 8h05 em Brasília
  end if;
end $$;

revoke all on function fab.lembrete_backup() from public;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_exportar', 'fab_backup_situacao')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;

-- a situação da cópia segue a mesma função liberada da cópia (Cadastros)
insert into fab.rotas (fn, funcoes) values ('fab_backup_situacao', array['cadastros'])
on conflict (fn) do update set funcoes = excluded.funcoes;
