-- Fábrica · regras de negócio (funções internas, schema fab)
-- Nada aqui é chamável pela API: o acesso é pelas funções fab_* do schema public (migração 3).

-- ---------- tempo ----------
create function fab.fuso() returns text language sql stable as
$$ select fuso from fab.configuracao $$;

create function fab.hoje() returns date language sql stable as
$$ select (now() at time zone fab.fuso())::date $$;

create function fab.agora() returns time language sql stable as
$$ select date_trunc('minute', now() at time zone fab.fuso())::time $$;

create function fab.hm(t time) returns text language sql immutable as
$$ select coalesce(to_char(t, 'HH24:MI'), '') $$;

create function fab.min_de(t time) returns integer language sql immutable as
$$ select (extract(hour from t) * 60 + extract(minute from t))::integer $$;

-- "1:30"; vazio quando zero (coluna "Extra" só aparece quando há hora extra)
create function fab.fmt_min(m integer) returns text language sql immutable as
$$ select case when coalesce(m, 0) <= 0 then '' else (m / 60)::text || ':' || lpad((m % 60)::text, 2, '0') end $$;

-- "0:00" sempre (totais de horas)
create function fab.fmt_hm(m integer) returns text language sql immutable as
$$ select (coalesce(m, 0) / 60)::text || ':' || lpad((coalesce(m, 0) % 60)::text, 2, '0') $$;

-- Dias de expediente encerrados no intervalo (seg-sex, sem feriado). Hoje só conta depois da hora de saída.
create function fab.dias_uteis(p_ini date, p_fim date) returns setof date language sql stable as $$
  select d::date
  from generate_series(
         p_ini::timestamp,
         least(p_fim, case when fab.agora() >= (select hora_fim from fab.configuracao) then fab.hoje() else fab.hoje() - 1 end)::timestamp,
         interval '1 day') d
  where extract(isodow from d) < 6
    and not exists (select 1 from fab.dias_sem_expediente s where s.dia = d::date)
$$;

-- ---------- sessão e permissões ----------
create function fab.eu() returns fab.perfis language plpgsql stable as $$
declare u fab.perfis;
begin
  if auth.uid() is null then raise exception 'SESSAO'; end if;
  select * into u from fab.perfis where id = auth.uid() and ativo;
  if not found then raise exception 'SESSAO'; end if;
  return u;
end $$;

create function fab.exige_admin() returns fab.perfis language plpgsql stable as $$
declare u fab.perfis;
begin
  u := fab.eu();
  if u.perfil <> 'admin' then raise exception 'Apenas o administrador pode fazer isto.'; end if;
  return u;
end $$;

-- IP real do aparelho, visto pelo servidor (não dá para falsificar pelo navegador).
create function fab.ip_cliente() returns text language plpgsql stable as $$
declare h json;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  return nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), '');
end $$;

create function fab.rede_liberada(u fab.perfis) returns boolean language plpgsql stable as $$
declare cfg fab.configuracao; v_ip text;
begin
  select * into cfg from fab.configuracao;
  if not cfg.exigir_wifi or u.perfil = 'admin' then return true; end if;
  v_ip := fab.ip_cliente();
  return v_ip is not null and exists (select 1 from fab.redes r where r.ip = v_ip);
end $$;

create function fab.checa_wifi(u fab.perfis) returns void language plpgsql stable as $$
begin
  if not fab.rede_liberada(u) then raise exception 'WIFI'; end if;
end $$;

-- Etapa que cada setor lança (antes essa regra só existia no navegador).
create function fab.etapa_do_setor(p_setor text) returns fab.etapa language sql immutable as $$
  select case
    when lower(p_setor) like '%cort%'                                   then 'Corte'::fab.etapa
    when lower(p_setor) like '%costur%' or lower(p_setor) like '%produ%' then 'Costura'::fab.etapa
    when lower(p_setor) like '%confer%' or lower(p_setor) like '%estoque%' then 'Conferência'::fab.etapa
  end
$$;

-- ---------- produção: saldo por etapa ----------
create function fab.saldo_linhas()
returns table (modelo text, cor text, tamanho text, corte integer, costura integer, conf integer)
language sql stable as $$
  select l.modelo, l.cor, l.tamanho,
         coalesce(sum(l.qtd) filter (where l.etapa = 'Corte'), 0)::integer,
         coalesce(sum(l.qtd) filter (where l.etapa = 'Costura'), 0)::integer,
         coalesce(sum(l.qtd) filter (where l.etapa = 'Conferência'), 0)::integer
  from fab.lancamentos l
  where l.apagado_em is null
  group by l.modelo, l.cor, l.tamanho
$$;

-- ---------- itens em falta ----------
create function fab.falta_feito(f fab.em_falta) returns integer language sql stable as $$
  select coalesce(sum(l.qtd), 0)::integer
  from fab.lancamentos l
  where l.apagado_em is null and l.etapa = 'Conferência' and l.criado_em >= f.criado_em
    and l.modelo = f.modelo
    and (f.cor = '' or l.cor = f.cor)
    and (f.tamanho = '' or l.tamanho = f.tamanho)
$$;

create function fab.em_falta_json() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'modelo', f.modelo, 'cor', f.cor,
           'tamanho', case when f.tamanho = '' then 'Todos' else f.tamanho end,
           'qtd', f.qtd, 'feito', x.feito, 'falta', greatest(f.qtd - x.feito, 0),
           'criado', to_char(f.criado_em at time zone fab.fuso(), 'YYYY-MM-DD"T"HH24:MI'),
           'obs', f.obs, 'status', f.status)
         order by (f.status = 'Urgente') desc, f.criado_em desc), '[]'::jsonb)
  from fab.em_falta f
  cross join lateral (select fab.falta_feito(f) as feito) x
  where f.status <> 'Feito'
$$;

-- A lista dá baixa sozinha quando a conferência completa a quantidade pedida.
create function fab.baixa_automatica() returns trigger language plpgsql as $$
begin
  if new.etapa = 'Conferência' then
    update fab.em_falta f
       set status = 'Feito', concluido_em = now()
     where f.status <> 'Feito' and f.qtd > 0 and f.modelo = new.modelo
       and (f.cor = '' or f.cor = new.cor) and (f.tamanho = '' or f.tamanho = new.tamanho)
       and fab.falta_feito(f) >= f.qtd;
  end if;
  return null;
end $$;

create trigger lancamentos_baixa
  after insert or update of qtd, apagado_em on fab.lancamentos
  for each row execute function fab.baixa_automatica();

-- ---------- montagem das respostas ----------
create function fab.editados_json(p_ini date, p_fim date) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', pf.nome, 'etapa', l.etapa, 'modelo', l.modelo, 'cor', l.cor, 'tamanho', l.tamanho,
           'qtd', l.qtd, 'edicoes', l.edicoes, 'hist', l.historico, 'data', l.dia)
         order by l.criado_em desc), '[]'::jsonb)
  from fab.lancamentos l
  join fab.perfis pf on pf.id = l.user_id
  where l.apagado_em is null and l.edicoes > 0 and l.dia between p_ini and p_fim
$$;

create function fab.lista_json(p_tipo text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(nome order by ordem, nome), '[]'::jsonb) from fab.itens_lista where tipo = p_tipo
$$;

-- p_user nulo + p_leitura = link de acompanhamento ("só ver").
create function fab.montar_boot(p_user fab.perfis, p_leitura boolean) returns jsonb language plpgsql stable as $$
declare cfg fab.configuracao; hoje date := fab.hoje(); p fab.ponto;
begin
  select * into cfg from fab.configuracao;
  if p_user.id is not null then
    select * into p from fab.ponto po where po.user_id = p_user.id and po.dia = hoje;
  end if;
  return jsonb_build_object(
    'eu', jsonb_build_object(
      'nome', case when p_leitura then 'Acompanhamento (só ver)' else p_user.nome end,
      'setor', case when p_leitura then 'Administração' else p_user.setor end,
      'admin', not p_leitura and p_user.perfil = 'admin',
      'leitura', p_leitura,
      'podeFalta', not p_leitura and p_user.pode_falta,
      'demo', false),
    'hoje', hoje,
    'ponto', jsonb_build_object('entrada', fab.hm(p.entrada), 'saida', fab.hm(p.saida), 'extra', fab.fmt_min(p.extra_min)),
    'horaFim', fab.hm(cfg.hora_fim),
    'exigirWifi', cfg.exigir_wifi,
    'etapas', to_jsonb(enum_range(null::fab.etapa)::text[]),
    'modelos', fab.lista_json('modelo'),
    'cores', fab.lista_json('cor'),
    'tamanhos', fab.lista_json('tamanho'),
    'disponivel', (select coalesce(jsonb_agg(jsonb_build_object(
                      'modelo', s.modelo, 'cor', s.cor, 'tamanho', s.tamanho,
                      'Corte', s.corte, 'Costura', s.costura, 'Conferência', s.conf)), '[]'::jsonb)
                   from fab.saldo_linhas() s),
    'meusHoje', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', l.id, 'modelo', l.modelo, 'cor', l.cor, 'tamanho', l.tamanho,
                    'hora', to_char(l.criado_em at time zone cfg.fuso, 'HH24:MI'), 'etapa', l.etapa,
                    'qtd', l.qtd, 'edicoes', l.edicoes, 'hist', l.historico) order by l.criado_em desc), '[]'::jsonb)
                 from fab.lancamentos l
                 where l.user_id = p_user.id and l.dia = hoje and l.apagado_em is null),
    'emFalta', fab.em_falta_json());
end $$;

create function fab.montar_painel() returns jsonb language plpgsql stable as $$
declare hoje date := fab.hoje();
begin
  return jsonb_build_object(
    'presenca', (select coalesce(jsonb_agg(jsonb_build_object(
                    'nome', pf.nome, 'setor', pf.setor, 'entrada', fab.hm(po.entrada), 'saida', fab.hm(po.saida),
                    'extra', fab.fmt_min(po.extra_min)) order by pf.nome), '[]'::jsonb)
                 from fab.perfis pf
                 left join fab.ponto po on po.user_id = pf.id and po.dia = hoje
                 where pf.ativo and pf.perfil = 'funcionario'),
    'prodHoje', (select jsonb_object_agg(e::text,
                    coalesce((select sum(l.qtd) from fab.lancamentos l
                              where l.etapa = e and l.dia = hoje and l.apagado_em is null), 0))
                 from unnest(enum_range(null::fab.etapa)) e),
    'editados', fab.editados_json(hoje, hoje),
    'saldo', (select coalesce(jsonb_agg(jsonb_build_object(
                  'modelo', s.modelo, 'cor', s.cor, 'tamanho', s.tamanho,
                  'corte', s.corte, 'costura', s.costura, 'conf', s.conf,
                  'naCostura', greatest(s.corte - s.costura, 0), 'naConf', greatest(s.costura - s.conf, 0),
                  'erro', s.costura > s.corte or s.conf > s.costura) order by s.modelo, s.cor, s.tamanho), '[]'::jsonb)
              from fab.saldo_linhas() s));
end $$;

create function fab.montar_relatorio(p_ini date, p_fim date) returns jsonb language plpgsql stable as $$
begin
  if p_ini is null or p_fim is null or p_ini > p_fim then raise exception 'Período inválido.'; end if;
  if p_fim - p_ini > 366 then raise exception 'Escolha no máximo 1 ano.'; end if;
  return jsonb_build_object(
    'porEtapa', (select jsonb_object_agg(e::text,
                    coalesce((select sum(l.qtd) from fab.lancamentos l
                              where l.etapa = e and l.dia between p_ini and p_fim and l.apagado_em is null), 0))
                 from unnest(enum_range(null::fab.etapa)) e),
    'porModelo', (select coalesce(jsonb_agg(jsonb_build_object(
                      'modelo', m.modelo, 'cor', m.cor, 'tamanho', m.tamanho,
                      'Corte', m.corte, 'Costura', m.costura, 'Conferência', m.conf) order by m.modelo, m.cor, m.tamanho), '[]'::jsonb)
                  from (select l.modelo, l.cor, l.tamanho,
                               coalesce(sum(l.qtd) filter (where l.etapa = 'Corte'), 0) as corte,
                               coalesce(sum(l.qtd) filter (where l.etapa = 'Costura'), 0) as costura,
                               coalesce(sum(l.qtd) filter (where l.etapa = 'Conferência'), 0) as conf
                        from fab.lancamentos l
                        where l.apagado_em is null and l.dia between p_ini and p_fim
                        group by l.modelo, l.cor, l.tamanho) m),
    'porPessoa', (select coalesce(jsonb_agg(jsonb_build_object('nome', x.nome, 'etapa', x.etapa, 'qtd', x.qtd)
                                            order by x.nome, x.etapa), '[]'::jsonb)
                  from (select pf.nome, l.etapa, sum(l.qtd)::integer as qtd
                        from fab.lancamentos l join fab.perfis pf on pf.id = l.user_id
                        where l.apagado_em is null and l.dia between p_ini and p_fim
                        group by pf.nome, l.etapa) x),
    'diasUteis', (select count(*) from fab.dias_uteis(p_ini, p_fim)),
    'pessoas', (select coalesce(jsonb_agg(jsonb_build_object(
                    'nome', pf.nome, 'diasTrab', coalesce(a.dias, 0),
                    'horas', fab.fmt_hm(a.horas), 'extras', fab.fmt_hm(a.extras),
                    'faltas', coalesce(f.faltas, '[]'::jsonb), 'semSaida', coalesce(a.autos, 0)) order by pf.nome), '[]'::jsonb)
                from fab.perfis pf
                left join lateral (
                  select count(*)::integer as dias,
                         sum(case when po.saida is not null then greatest(fab.min_de(po.saida) - fab.min_de(po.entrada), 0) else 0 end)::integer as horas,
                         sum(po.extra_min)::integer as extras,
                         (count(*) filter (where po.automatico))::integer as autos
                  from fab.ponto po where po.user_id = pf.id and po.dia between p_ini and p_fim) a on true
                left join lateral (
                  select jsonb_agg(d order by d) as faltas
                  from fab.dias_uteis(p_ini, p_fim) d
                  where d >= (pf.criado_em at time zone fab.fuso())::date
                    and not exists (select 1 from fab.ponto po where po.user_id = pf.id and po.dia = d)) f on true
                where pf.ativo and pf.perfil = 'funcionario'),
    'registros', (select coalesce(jsonb_agg(jsonb_build_object(
                      'data', po.dia, 'nome', pf.nome, 'entrada', fab.hm(po.entrada), 'saida', fab.hm(po.saida),
                      'extra', fab.fmt_min(po.extra_min), 'auto', po.automatico) order by po.dia desc, pf.nome), '[]'::jsonb)
                  from fab.ponto po join fab.perfis pf on pf.id = po.user_id
                  where po.dia between p_ini and p_fim),
    'editados', fab.editados_json(p_ini, p_fim));
end $$;

-- ---------- rotinas ----------
-- Fecha pontos esquecidos: saída automática na hora de fechamento, sem hora extra.
create function fab.fechar_pendentes() returns integer language plpgsql as $$
declare n integer; cfg fab.configuracao;
begin
  select * into cfg from fab.configuracao;
  update fab.ponto
     set saida = greatest(entrada, cfg.hora_fim), extra_min = 0, automatico = true
   where saida is null
     and (dia < fab.hoje() or (dia = fab.hoje() and fab.agora() >= cfg.hora_fim));
  get diagnostics n = row_count;
  return n;
end $$;
