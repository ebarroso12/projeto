-- =====================================================================
-- Cadastros gerais (produtos, clientes, fornecedores, bancos), dados dos funcionários
-- e canal de mensagens interno (admin/gerente -> uma pessoa ou todos).
-- =====================================================================

-- ---------------------------------------------------------------- cadastros gerais
create table fab.registros (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references fab.empresas (id) on delete cascade,
  tipo         text not null check (tipo in ('produto', 'cliente', 'fornecedor', 'banco')),
  nome         text not null check (length(btrim(nome)) between 1 and 120),
  documento    text not null default '',
  telefone     text not null default '',
  email        text not null default '',
  cidade       text not null default '',
  obs          text not null default '',
  dados        jsonb not null default '{}'::jsonb,   -- campos próprios de cada tipo (preço, agência, PIX…)
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index registros_empresa_idx on fab.registros (empresa_id, tipo, nome);
alter table fab.registros enable row level security;
revoke all on fab.registros from public;
create trigger auditoria after insert or update or delete on fab.registros for each row execute function fab.auditar();

-- dados do funcionário (CPF, telefone, admissão, cargo…)
alter table fab.perfis add column dados jsonb not null default '{}'::jsonb;

create function fab.registro_json(r fab.registros) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'tipo', r.tipo, 'nome', r.nome, 'documento', r.documento, 'telefone', r.telefone,
    'email', r.email, 'cidade', r.cidade, 'obs', r.obs, 'dados', r.dados, 'ativo', r.ativo,
    'criadoEm', to_char(r.criado_em at time zone fab.fuso(r.empresa_id), 'YYYY-MM-DD'))
$$;

create function public.fab_registros(p_tipo text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  return coalesce((select jsonb_agg(fab.registro_json(r) order by r.ativo desc, r.nome)
                     from fab.registros r where r.empresa_id = u.empresa_id and r.tipo = p_tipo), '[]'::jsonb);
end $$;

create function public.fab_salvar_registro(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); v_id uuid := nullif(p ->> 'id', '')::uuid; v_tipo text := p ->> 'tipo';
  v_nome text := btrim(coalesce(p ->> 'nome', '')); d jsonb := coalesce(p -> 'dados', '{}'::jsonb); t text;
begin
  if v_tipo not in ('produto', 'cliente', 'fornecedor', 'banco') then raise exception 'Tipo de cadastro inválido.'; end if;
  if v_nome = '' then raise exception 'Preencha o nome.'; end if;
  if jsonb_typeof(d) <> 'object' then d := '{}'::jsonb; end if;
  if v_id is null then
    insert into fab.registros (empresa_id, tipo, nome, documento, telefone, email, cidade, obs, dados, ativo)
    values (u.empresa_id, v_tipo, left(v_nome, 120), left(coalesce(p ->> 'documento', ''), 40), left(coalesce(p ->> 'telefone', ''), 40),
            left(coalesce(p ->> 'email', ''), 120), left(coalesce(p ->> 'cidade', ''), 80), left(coalesce(p ->> 'obs', ''), 500), d,
            coalesce((p ->> 'ativo')::boolean, true))
    returning id into v_id;
  else
    update fab.registros set nome = left(v_nome, 120), documento = left(coalesce(p ->> 'documento', ''), 40),
           telefone = left(coalesce(p ->> 'telefone', ''), 40), email = left(coalesce(p ->> 'email', ''), 120),
           cidade = left(coalesce(p ->> 'cidade', ''), 80), obs = left(coalesce(p ->> 'obs', ''), 500), dados = d,
           ativo = coalesce((p ->> 'ativo')::boolean, true), atualizado_em = now()
     where id = v_id and empresa_id = u.empresa_id and tipo = v_tipo;
    if not found then raise exception 'Cadastro não encontrado.'; end if;
  end if;
  -- produto ativo entra nas listas do Lançar (modelo, cores e tamanhos informados)
  if v_tipo = 'produto' and coalesce((p ->> 'ativo')::boolean, true) then
    insert into fab.itens_lista (empresa_id, tipo, nome, ordem)
    values (u.empresa_id, 'modelo', left(v_nome, 60), (select coalesce(max(ordem), 0) + 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'modelo'))
    on conflict do nothing;
    foreach t in array coalesce(string_to_array(d ->> 'cores', ','), '{}') loop
      if btrim(t) <> '' then
        insert into fab.itens_lista (empresa_id, tipo, nome, ordem)
        values (u.empresa_id, 'cor', left(btrim(t), 60), (select coalesce(max(ordem), 0) + 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'cor'))
        on conflict do nothing;
      end if;
    end loop;
    foreach t in array coalesce(string_to_array(d ->> 'tamanhos', ','), '{}') loop
      if btrim(t) <> '' then
        insert into fab.itens_lista (empresa_id, tipo, nome, ordem)
        values (u.empresa_id, 'tamanho', left(btrim(t), 60), (select coalesce(max(ordem), 0) + 1 from fab.itens_lista where empresa_id = u.empresa_id and tipo = 'tamanho'))
        on conflict do nothing;
      end if;
    end loop;
  end if;
  return v_id;
end $$;

create function public.fab_apagar_registro(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  delete from fab.registros where id = p_id and empresa_id = u.empresa_id;
  if not found then raise exception 'Cadastro não encontrado.'; end if;
end $$;

-- dados dos funcionários
create function public.fab_dados_pessoas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin();
begin
  return coalesce((select jsonb_object_agg(p.login, p.dados) from fab.perfis p where p.empresa_id = u.empresa_id), '{}'::jsonb);
end $$;

create function public.fab_salvar_dados_pessoa(p_login text, p_dados jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.exige_admin(); alvo fab.perfis; d jsonb := '{}'::jsonb; k text;
begin
  select * into alvo from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_login)) for update;
  if not found then raise exception 'Pessoa não encontrada.'; end if;
  perform fab.pode_agir_sobre(u, alvo);
  foreach k in array array['cpf', 'telefone', 'email', 'admissao', 'cargo', 'endereco', 'nascimento', 'obs'] loop
    if p_dados ? k then d := d || jsonb_build_object(k, left(coalesce(p_dados ->> k, ''), 300)); end if;
  end loop;
  update fab.perfis set dados = d where id = alvo.id;
end $$;

-- ---------------------------------------------------------------- mensagens
create table fab.mensagens (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references fab.empresas (id) on delete cascade,
  autor_id    uuid references fab.perfis (id) on delete set null,
  autor_nome  text not null default '',
  para_id     uuid references fab.perfis (id) on delete cascade,   -- null = todos
  titulo      text not null default '',
  texto       text not null check (length(btrim(texto)) between 1 and 2000),
  importante  boolean not null default false,
  criado_em   timestamptz not null default now()
);
create index mensagens_empresa_idx on fab.mensagens (empresa_id, criado_em desc);
create index mensagens_para_idx on fab.mensagens (para_id);
create index mensagens_autor_idx on fab.mensagens (autor_id);
create table fab.mensagens_lidas (
  mensagem_id uuid not null references fab.mensagens (id) on delete cascade,
  user_id     uuid not null references fab.perfis (id) on delete cascade,
  lida_em     timestamptz not null default now(),
  primary key (mensagem_id, user_id)
);
create index mensagens_lidas_user_idx on fab.mensagens_lidas (user_id);
alter table fab.mensagens enable row level security;
alter table fab.mensagens_lidas enable row level security;
revoke all on fab.mensagens, fab.mensagens_lidas from public;

-- recebidas: para mim ou para todos (desde que eu entrei na empresa)
create function public.fab_minhas_mensagens() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.eu();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'autor', m.autor_nome, 'para', coalesce((select p.nome from fab.perfis p where p.id = m.para_id), 'Todos'),
      'titulo', m.titulo, 'texto', m.texto, 'importante', m.importante,
      'em', to_char(m.criado_em at time zone fab.fuso(m.empresa_id), 'YYYY-MM-DD"T"HH24:MI'),
      'lida', exists (select 1 from fab.mensagens_lidas l where l.mensagem_id = m.id and l.user_id = u.id)) order by m.criado_em desc)
    from (select * from fab.mensagens m where m.empresa_id = u.empresa_id and (m.para_id is null or m.para_id = u.id)
            and m.criado_em >= u.criado_em - interval '1 day' order by m.criado_em desc limit 100) m), '[]'::jsonb);
end $$;

create function public.fab_marcar_lidas(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.eu();
begin
  insert into fab.mensagens_lidas (mensagem_id, user_id)
  select m.id, u.id from fab.mensagens m
   where m.id = any (p_ids) and m.empresa_id = u.empresa_id and (m.para_id is null or m.para_id = u.id)
  on conflict do nothing;
end $$;

-- quem pode receber (para a tela de enviar)
create function public.fab_destinatarios() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.eu();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('login', p.login, 'nome', p.nome, 'setor', p.setor) order by p.nome)
                     from fab.perfis p where p.empresa_id = u.empresa_id and p.ativo and p.id <> u.id), '[]'::jsonb);
end $$;

create function public.fab_enviar_mensagem(p_para text, p_titulo text, p_texto text, p_importante boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.eu(); v_para uuid; v_id uuid;
begin
  if not fab.pode(u, 'mensagens') then raise exception 'FUNCAO_BLOQUEADA'; end if;
  if coalesce(btrim(p_texto), '') = '' then raise exception 'Escreva a mensagem.'; end if;
  if coalesce(btrim(p_para), '') <> '' then
    select id into v_para from fab.perfis where empresa_id = u.empresa_id and login = lower(btrim(p_para)) and ativo;
    if v_para is null then raise exception 'Pessoa não encontrada.'; end if;
  end if;
  insert into fab.mensagens (empresa_id, autor_id, autor_nome, para_id, titulo, texto, importante)
  values (u.empresa_id, u.id, u.nome, v_para, left(btrim(coalesce(p_titulo, '')), 120), left(btrim(p_texto), 2000), coalesce(p_importante, false))
  returning id into v_id;
  insert into fab.mensagens_lidas (mensagem_id, user_id) values (v_id, u.id) on conflict do nothing;   -- o autor já leu
  perform fab.registrar(u.empresa_id, u.id, u.nome, 'mensagem_enviada', coalesce((select nome from fab.perfis where id = v_para), 'Todos'),
    jsonb_build_object('titulo', left(btrim(coalesce(p_titulo, '')), 120), 'importante', coalesce(p_importante, false)));
  return v_id;
end $$;

-- enviadas (para quem pode enviar): quem leu e quem ainda não leu
create function public.fab_mensagens_enviadas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u fab.perfis := fab.eu();
begin
  if not fab.pode(u, 'mensagens') then raise exception 'FUNCAO_BLOQUEADA'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'autor', m.autor_nome, 'para', coalesce((select p.nome from fab.perfis p where p.id = m.para_id), 'Todos'),
      'titulo', m.titulo, 'texto', m.texto, 'importante', m.importante,
      'em', to_char(m.criado_em at time zone fab.fuso(m.empresa_id), 'YYYY-MM-DD"T"HH24:MI'),
      'leram', coalesce((select jsonb_agg(p.nome order by l.lida_em) from fab.mensagens_lidas l join fab.perfis p on p.id = l.user_id
                          where l.mensagem_id = m.id and l.user_id is distinct from m.autor_id), '[]'::jsonb),
      'faltam', coalesce((select jsonb_agg(p.nome order by p.nome) from fab.perfis p
                          where p.empresa_id = m.empresa_id and p.ativo and p.id is distinct from m.autor_id
                            and (m.para_id is null or p.id = m.para_id)
                            and not exists (select 1 from fab.mensagens_lidas l where l.mensagem_id = m.id and l.user_id = p.id)), '[]'::jsonb))
    order by m.criado_em desc)
    from (select * from fab.mensagens m where m.empresa_id = u.empresa_id order by m.criado_em desc limit 100) m), '[]'::jsonb);
end $$;

create function public.fab_apagar_mensagem(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u fab.perfis := fab.eu();
begin
  if not fab.pode(u, 'mensagens') then raise exception 'FUNCAO_BLOQUEADA'; end if;
  delete from fab.mensagens where id = p_id and empresa_id = u.empresa_id and (autor_id = u.id or u.perfil = 'admin');
  if not found then raise exception 'Só quem enviou (ou um administrador) apaga a mensagem.'; end if;
end $$;

-- ---------------------------------------------------------------- funções: + "mensagens" e rotas novas
create or replace function fab.lista_funcoes() returns text[] language sql immutable set search_path = '' as
$$ select array['painel', 'dashboard', 'relatorio', 'falta', 'lancar', 'ponto', 'financeiro', 'resultado', 'cadastros', 'acessos', 'mensagens', 'empresas'] $$;

create or replace function fab.funcoes_da_rota() returns text[] language sql stable set search_path = '' as $$
  select case
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
    else null end
  from (select substring(coalesce(current_setting('request.path', true), '') from '/rpc/([a-z_]+)') as fn) x
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fab_registros', 'fab_salvar_registro', 'fab_apagar_registro', 'fab_dados_pessoas',
              'fab_salvar_dados_pessoa', 'fab_minhas_mensagens', 'fab_marcar_lidas', 'fab_destinatarios', 'fab_enviar_mensagem',
              'fab_mensagens_enviadas', 'fab_apagar_mensagem')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
