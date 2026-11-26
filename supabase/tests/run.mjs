/**
 * Testa as migrações e as regras de negócio num Postgres local (PGlite), sem Supabase de verdade.
 *   cd supabase && npm install && npm test
 * Simula o que o Supabase fornece: schema auth (auth.users, auth.uid()), papéis anon/authenticated/service_role,
 * e o JWT/cabeçalhos da requisição (request.jwt.claim.sub, request.headers).
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const db = new PGlite();

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : `  (obteve ${JSON.stringify(a)}, esperava ${JSON.stringify(b)})`}`);

// ---------- ambiente Supabase simulado ----------
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

for (const f of readdirSync(join(here, '../migrations')).sort()) {
  await db.exec(readFileSync(join(here, '../migrations', f), 'utf8'));
}
console.log('migrações aplicadas\n');

// ---------- ajudantes ----------
const j = obj => `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
const q = async (sql, params) => (await db.query(sql, params)).rows;

/** Chama public.<expr> como um papel/usuário/IP. Devolve {ok,data} ou {ok:false,error}. */
async function rpc(user, expr, { role = 'authenticated', ip } = {}) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(ip ? { 'x-forwarded-for': ip } : {})]);
  await db.exec(`set role ${role}`);
  try {
    const r = await db.query(`select public.${expr} as r`);
    return { ok: true, data: r.rows[0].r };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await db.exec('reset role');
  }
}
const fails_with = (r, text) => !r.ok && r.error.includes(text);

// ---------- dados de teste ----------
const mkUser = async (login, nome, setor, perfil = 'funcionario', podeFalta = false, ativo = true) => {
  const [{ id }] = await q(`insert into auth.users (email) values ($1) returning id`, [`${login}@fabrica.local`]);
  await q(`insert into fab.perfis (id, login, nome, setor, perfil, pode_falta, ativo, criado_em)
           values ($1,$2,$3,$4,$5::fab.perfil,$6,$7, now() - interval '60 days')`, [id, login, nome, setor, perfil, podeFalta, ativo]);
  return id;
};
const admin = await mkUser('admin', 'Edson', 'Administração', 'admin', true);
const ana = await mkUser('ana', 'Ana Souza', 'Costureira');
const bruno = await mkUser('bruno', 'Bruno Lima', 'Cortador');
const carla = await mkUser('carla', 'Carla Dias', 'Conferente', 'funcionario', true);
const ghost = await mkUser('ghost', 'Inativo', 'Costureira', 'funcionario', false, false);

await q(`insert into fab.itens_lista (tipo, nome, ordem) values
  ('modelo','Camisa Polo',1),('modelo','Calça Jeans',2),('cor','Preto',1),('cor','Branco',2),
  ('tamanho','P',1),('tamanho','M',2),('tamanho','G',3)`);

const lanc = (etapa, qtd = 10, tam = 'M', modelo = 'Camisa Polo', cor = 'Preto') =>
  `fab_lancar('${etapa}','${modelo}','${cor}','', ${j([{ tamanho: tam, qtd }])})`;

// ============ 1. segurança ============
console.log('--- segurança ---');
ok(fails_with(await rpc(null, 'fab_painel()', { role: 'anon' }), 'permission denied'), 'anônimo não chama fab_painel');
ok(fails_with(await rpc(null, 'fab_boot()'), 'SESSAO'), 'sem login: erro SESSAO');
ok(fails_with(await rpc(ghost, 'fab_boot()'), 'SESSAO'), 'usuário inativo: erro SESSAO');
ok(fails_with(await rpc(ana, `fab_criar_perfil(gen_random_uuid(),'x','X','Outra','admin',true)`), 'permission denied'), 'usuário comum não cria perfil');
ok(fails_with(await rpc(ana, 'fab_listar_usuarios()'), 'Apenas o administrador'), 'funcionário não lista usuários');
{
  await db.exec('set role authenticated');
  let denied = false;
  try { await db.query('select * from fab.lancamentos'); } catch (e) { denied = e.message.includes('permission denied'); }
  await db.exec('reset role');
  ok(denied, 'tabelas não são acessíveis direto (só pelas funções)');
}
ok(fails_with(await rpc(null, `fab_boot_chave('chave-que-nao-existe-123')`, { role: 'anon' }), 'inválido'), 'chave inexistente é recusada');

// ============ 2. produção ============
console.log('\n--- produção ---');
let r = await rpc(bruno, lanc('Corte', 100));
ok(r.ok && r.data.total === 100 && r.data.avisos.length === 0, 'cortador lança 100 de Corte');
r = await rpc(ana, lanc('Costura', 40));
ok(r.ok && r.data.total === 40 && r.data.avisos.length === 0, 'costureira lança 40 de Costura');
ok(fails_with(await rpc(ana, lanc('Corte', 5)), 'Seu setor não lança'), 'regra de setor vale no servidor');
ok(fails_with(await rpc(ana, lanc('Costura', 5, 'M', 'Modelo Fantasma')), 'Modelo inválido'), 'modelo fora da lista é recusado');
ok(fails_with(await rpc(ana, lanc('Costura', 5, 'XXG')), 'Tamanho inválido'), 'tamanho fora da lista é recusado');
ok(fails_with(await rpc(ana, `fab_lancar('Costura','Camisa Polo','Preto','', '[{"tamanho":"M","qtd":"12a"}]'::jsonb)`), 'Quantidade inválida'), 'quantidade não numérica é recusada');
ok(fails_with(await rpc(ana, `fab_lancar('Costura','Camisa Polo','Preto','', '[]'::jsonb)`), 'pelo menos um tamanho'), 'lançamento vazio é recusado');
ok(fails_with(await rpc(ana, `fab_lancar('Inexistente','Camisa Polo','Preto','', '[{"tamanho":"M","qtd":1}]'::jsonb)`), 'Etapa inválida'), 'etapa inexistente é recusada');
r = await rpc(ana, lanc('Costura', 70));
ok(r.ok && r.data.avisos.length === 1 && r.data.avisos[0].includes('110 contra 100'), 'aviso quando costura passa do que foi cortado');
r = await rpc(admin, lanc('Conferência', 5, 'P', 'Calça Jeans', 'Branco'));
ok(r.ok, 'administrador lança qualquer etapa');

// ============ 3. painel ============
console.log('\n--- painel ---');
r = await rpc(admin, 'fab_painel()');
const painel = r.data;
ok(r.ok, 'administrador abre o painel');
const lin = painel.saldo.find(s => s.modelo === 'Camisa Polo' && s.cor === 'Preto' && s.tamanho === 'M');
eq([lin.corte, lin.costura, lin.conf, lin.naCostura, lin.naConf, lin.erro], [100, 110, 0, 0, 110, true], 'saldo por etapa e linha com erro');
eq(painel.prodHoje, { Corte: 100, Costura: 110, 'Conferência': 5 }, 'produção de hoje por etapa');
eq(painel.presenca.map(p => p.nome), ['Ana Souza', 'Bruno Lima', 'Carla Dias'], 'presença lista só funcionários ativos');

// ============ 4. editar e apagar ============
console.log('\n--- editar e apagar ---');
const [{ id: idAna }] = await q(`select id from fab.lancamentos where user_id = $1 and qtd = 40`, [ana]);
ok(fails_with(await rpc(bruno, `fab_editar_lancamento('${idAna}', 41)`), 'só pode editar os seus'), 'não edita lançamento de outra pessoa');
ok(fails_with(await rpc(ana, `fab_editar_lancamento('${idAna}', -3)`), 'Quantidade inválida'), 'quantidade negativa é recusada');
r = await rpc(ana, `fab_editar_lancamento('${idAna}', 35)`);
ok(r.ok, 'edita o próprio lançamento de hoje');
let [row] = await q(`select qtd, edicoes, historico from fab.lancamentos where id = $1`, [idAna]);
ok(row.qtd === 35 && row.edicoes === 1 && row.historico.includes('40→35'), 'edição registra histórico (40→35)');
await rpc(admin, `fab_editar_lancamento('${idAna}', 36)`);
[row] = await q(`select edicoes from fab.lancamentos where id = $1`, [idAna]);
ok(row.edicoes === 2, 'administrador também edita e o contador sobe');
r = await rpc(admin, 'fab_painel()');
ok(r.data.editados.length === 1 && r.data.editados[0].edicoes === 2, 'painel mostra o lançamento editado');
await q(`update fab.lancamentos set dia = dia - 1 where id = $1`, [idAna]);
ok(fails_with(await rpc(ana, `fab_apagar_lancamento('${idAna}')`), 'só pode apagar os seus'), 'não apaga lançamento de dia anterior');
await q(`update fab.lancamentos set dia = dia + 1 where id = $1`, [idAna]);
r = await rpc(ana, `fab_apagar_lancamento('${idAna}')`);
[row] = await q(`select apagado_em from fab.lancamentos where id = $1`, [idAna]);
const logs = await q(`select acao, antes, depois from fab.lancamento_log where lancamento_id = $1 order by id`, [idAna]);
ok(r.ok && row.apagado_em !== null, 'apagar é lógico (a linha continua no banco)');
eq(logs.map(l => l.acao), ['editar', 'editar', 'apagar'], 'auditoria registra editar, editar, apagar');
r = await rpc(admin, 'fab_painel()');
eq(r.data.saldo.find(s => s.tamanho === 'M' && s.modelo === 'Camisa Polo').costura, 70, 'saldo ignora o lançamento apagado');

// ============ 5. itens em falta ============
console.log('\n--- itens em falta ---');
ok(fails_with(await rpc(ana, `fab_add_em_falta('Camisa Polo','Preto','M',20,'')`), 'Sem permissão'), 'sem permissão não cadastra falta');
r = await rpc(carla, `fab_add_em_falta('Camisa Polo','Preto','M',20,'Pedido urgente')`);
ok(r.ok && r.data.length === 1 && r.data[0].qtd === 20 && r.data[0].falta === 20, 'quem pode, cadastra item em falta');
const faltaId = r.data[0].id;
await rpc(carla, lanc('Conferência', 12));
r = await rpc(carla, 'fab_boot()');
eq([r.data.emFalta[0].feito, r.data.emFalta[0].falta], [12, 8], 'conferência abate o que falta (12 feitas, 8 faltam)');
r = await rpc(ana, `fab_status_em_falta('${faltaId}','Em produção')`);
ok(r.ok && r.data[0].status === 'Em produção', 'funcionário marca "Em produção"');
ok(fails_with(await rpc(ana, `fab_status_em_falta('${faltaId}','Feito')`), 'Apenas o administrador'), 'só administrador dá baixa manual');
await rpc(carla, lanc('Conferência', 8));
r = await rpc(carla, 'fab_boot()');
ok(r.data.emFalta.length === 0, 'baixa automática ao completar a quantidade');
r = await rpc(carla, `fab_add_em_falta('Calça Jeans','','Todos',0,'sem quantidade')`);
ok(r.ok && r.data[0].tamanho === 'Todos' && r.data[0].qtd === 0, 'item sem quantidade e para todos os tamanhos');
r = await rpc(admin, `fab_status_em_falta('${r.data[0].id}','Feito')`);
ok(r.ok && r.data.length === 0, 'administrador dá baixa manual');

// ============ 6. ponto ============
console.log('\n--- ponto ---');
await q(`update fab.configuracao set hora_fim = '00:00'`);
r = await rpc(bruno, `fab_bater_ponto('entrada')`);
ok(r.ok && /^\d\d:\d\d$/.test(r.data), `entrada marcada (${r.data})`);
ok(fails_with(await rpc(bruno, `fab_bater_ponto('entrada')`), 'já marcada'), 'segunda entrada no mesmo dia é recusada');
r = await rpc(bruno, `fab_bater_ponto('saida')`);
[row] = await q(`select extra_min, saida from fab.ponto where user_id = $1`, [bruno]);
ok(r.ok && row.extra_min > 0, `saída depois do fechamento conta hora extra (${row.extra_min} min)`);
ok(fails_with(await rpc(bruno, `fab_bater_ponto('saida')`), 'Marque a entrada'), 'segunda saída é recusada');
ok(fails_with(await rpc(ana, `fab_bater_ponto('almoco')`), 'inválido'), 'tipo de ponto inválido');
await q(`update fab.configuracao set hora_fim = '23:59'`);
await rpc(carla, `fab_bater_ponto('entrada')`);
await rpc(carla, `fab_bater_ponto('saida')`);
[row] = await q(`select extra_min from fab.ponto where user_id = $1`, [carla]);
ok(row.extra_min === 0, 'saída antes do fechamento não gera hora extra');
await q(`update fab.configuracao set hora_fim = '17:30'`);
await q(`insert into fab.ponto (user_id, dia, entrada) values ($1, fab.hoje() - 3, '07:50')`, [ana]);
const [{ n }] = await q(`select fab.fechar_pendentes() as n`);
[row] = await q(`select saida::text, automatico, extra_min from fab.ponto where user_id = $1 and dia = fab.hoje() - 3`, [ana]);
ok(n >= 1 && row.saida === '17:30:00' && row.automatico && row.extra_min === 0, 'ponto esquecido é fechado às 17:30 sem hora extra');
r = await rpc(admin, 'fab_painel()');
const pb = r.data.presenca.find(p => p.nome === 'Bruno Lima');
ok(pb.entrada !== '' && pb.saida !== '', 'painel mostra entrada e saída de hoje');

// ============ 7. Wi-Fi ============
console.log('\n--- Wi-Fi da fábrica ---');
await q(`update fab.configuracao set exigir_wifi = true`);
ok(fails_with(await rpc(ana, 'fab_boot()'), 'WIFI'), 'com Wi-Fi exigido e sem rede cadastrada, funcionário recebe WIFI');
ok((await rpc(admin, 'fab_boot()')).ok, 'administrador abre de qualquer lugar');
ok((await rpc(admin, `fab_cadastrar_rede_atual('Fábrica')`, { ip: '203.0.113.9, 10.0.0.1' })).data.ips[0].ip === '203.0.113.9', 'cadastra o IP que o servidor viu (1º do X-Forwarded-For)');
ok(fails_with(await rpc(admin, `fab_cadastrar_rede_atual('x')`), 'identificar a rede'), 'sem IP visível, não cadastra');
ok((await rpc(ana, 'fab_boot()', { ip: '203.0.113.9' })).ok, 'funcionário na rede cadastrada entra');
ok(fails_with(await rpc(ana, 'fab_boot()', { ip: '198.51.100.7' }), 'WIFI'), 'funcionário em outra rede recebe WIFI');
ok(fails_with(await rpc(ana, lanc('Costura', 1), { ip: '198.51.100.7' }), 'WIFI'), 'lançar fora da rede também é bloqueado');
eq([(await rpc(ana, 'fab_status_rede()', { ip: '203.0.113.9' })).data, (await rpc(ana, 'fab_status_rede()', { ip: '1.1.1.1' })).data], [true, false], 'status da rede');
await rpc(admin, `fab_salvar_wifi(true, '{}'::text[])`);
ok(fails_with(await rpc(ana, 'fab_boot()', { ip: '203.0.113.9' }), 'WIFI'), 'remover a rede volta a bloquear');
await rpc(admin, `fab_salvar_wifi(false, '{}'::text[])`);
ok((await rpc(ana, 'fab_boot()')).ok, 'desligar a exigência libera todos');

// ============ 8. links de acompanhamento ============
console.log('\n--- links "só ver" ---');
ok(fails_with(await rpc(ana, `fab_criar_chave('TV')`), 'Apenas o administrador'), 'só administrador cria link');
const chave = (await rpc(admin, `fab_criar_chave('TV da fábrica')`)).data;
ok(/^[0-9a-f]{32}$/.test(chave), 'chave aleatória de 128 bits');
const [{ chave_hash }] = await q(`select chave_hash from fab.chaves_acesso`);
ok(chave_hash !== chave && chave_hash.length === 64, 'no banco fica só o hash da chave');
ok((await rpc(null, `fab_validar_chave('${chave}')`, { role: 'anon' })).data === true, 'chave válida');
ok((await rpc(null, `fab_validar_chave('${chave.replace(/.$/, 'x')}')`, { role: 'anon' })).data === false, 'chave alterada é inválida');
r = await rpc(null, `fab_boot_chave('${chave}')`, { role: 'anon' });
ok(r.ok && r.data.eu.leitura === true && r.data.eu.admin === false && r.data.eu.nome.includes('só ver'), 'link abre como "só ver", sem poder de administrador');
ok((await rpc(null, `fab_painel_chave('${chave}')`, { role: 'anon' })).ok, 'link abre o painel');
ok(fails_with(await rpc(null, `fab_painel()`, { role: 'anon' }), 'permission denied'), 'link não dá acesso às funções de usuário');
await rpc(admin, 'fab_revogar_chaves()');
ok(fails_with(await rpc(null, `fab_painel_chave('${chave}')`, { role: 'anon' }), 'inválido'), 'chave revogada para de funcionar');

// ============ 9. cadastros ============
console.log('\n--- cadastros ---');
ok(fails_with(await rpc(ana, `fab_salvar_lista('Cores','{Azul}')`), 'Apenas o administrador'), 'funcionário não edita listas');
r = await rpc(admin, `fab_salvar_lista('Cores', array[' Preto','Branco','Preto','','Azul'])`);
eq(r.data, ['Preto', 'Branco', 'Azul'], 'lista é limpa, sem repetidos, na ordem digitada');
ok(fails_with(await rpc(admin, `fab_salvar_lista('Setores','{x}')`), 'Lista inválida'), 'lista desconhecida é recusada');
r = await rpc(admin, 'fab_listar_usuarios()');
ok(r.ok && r.data.length === 5 && r.data.every(u => u.senha === ''), 'lista usuários sem expor senhas');
ok(fails_with(await rpc(admin, `fab_atualizar_perfil('admin','Edson','Administração','funcionario',true,true)`), 'pelo menos um administrador'), 'não rebaixa o último administrador');
ok(fails_with(await rpc(admin, `fab_atualizar_perfil('admin','Edson','Administração','admin',false,true)`), 'pelo menos um administrador'), 'não desativa o último administrador');
r = await rpc(admin, `fab_atualizar_perfil('ana','Ana Souza','Costureira','funcionario',false,false)`);
ok(r.ok, 'desativa uma funcionária');
ok(fails_with(await rpc(ana, 'fab_boot()'), 'SESSAO'), 'funcionária desativada perde o acesso na hora');
await rpc(admin, `fab_atualizar_perfil('ana','Ana Souza','Costureira','funcionario',true,false)`);

// ============ 10. relatório ============
console.log('\n--- relatório ---');
const seg = new Date(); seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7) - 14);   // segunda-feira de 2 semanas atrás
const dia = n => { const d = new Date(seg); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
await q(`insert into fab.ponto (user_id, dia, entrada, saida, extra_min) values
  ($1,$2,'08:00','17:00',0), ($1,$3,'08:00','18:30',60)`, [ana, dia(0), dia(1)]);
await q(`insert into fab.dias_sem_expediente (dia, motivo) values ($1,'Feriado')`, [dia(3)]);   // quinta
r = await rpc(admin, `fab_relatorio('${dia(0)}','${dia(4)}')`);
const rel = r.data;
const pa = rel.pessoas.find(p => p.nome === 'Ana Souza');
ok(r.ok && rel.diasUteis === 4, 'dias úteis: seg a sex menos o feriado = 4');
eq([pa.diasTrab, pa.horas, pa.extras], [2, '19:30', '1:00'], 'Ana: 2 dias, 19:30 de horas (9:00 + 10:30), 1:00 de extra');
eq(pa.faltas, [dia(2), dia(4)], 'faltas = quarta e sexta (feriado não conta)');
eq(rel.registros.map(x => x.data), [dia(1), dia(0)], 'registros do período, do mais novo ao mais antigo');
ok(fails_with(await rpc(admin, `fab_relatorio('${dia(4)}','${dia(0)}')`), 'Período inválido'), 'período invertido é recusado');
ok(fails_with(await rpc(admin, `fab_relatorio('2020-01-01','2026-01-01')`), 'no máximo 1 ano'), 'período maior que 1 ano é recusado');
const hoje = (await q(`select fab.hoje()::text as d`))[0].d;
r = await rpc(admin, `fab_relatorio('${hoje}','${hoje}')`);
eq(r.data.porEtapa, { Corte: 100, Costura: 70, 'Conferência': 25 }, 'produção do período por etapa');
eq(r.data.porPessoa.map(p => `${p.nome}/${p.etapa}/${p.qtd}`).sort(),
   ['Ana Souza/Costura/70', 'Bruno Lima/Corte/100', 'Carla Dias/Conferência/20', 'Edson/Conferência/5'].sort(), 'produção por pessoa');

// ---------- amostras reais para o teste do front-end ----------
const out = join(here, '../../web/src/api/__fixtures__');
mkdirSync(out, { recursive: true });
const boot = (await rpc(carla, 'fab_boot()')).data;
writeFileSync(join(out, 'supabase-boot.json'), JSON.stringify(boot, null, 2));
writeFileSync(join(out, 'supabase-painel.json'), JSON.stringify((await rpc(admin, 'fab_painel()')).data, null, 2));
writeFileSync(join(out, 'supabase-relatorio.json'), JSON.stringify(rel, null, 2));

console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
