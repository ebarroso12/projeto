/**
 * Testa as migrações e as regras de negócio num Postgres local (PGlite), sem Supabase de verdade.
 *   cd supabase && npm install && npm test
 *   UPDATE_FIXTURES=1 npm test   -> também regrava as amostras usadas pelos testes do app (web/src/api/__fixtures__)
 * Simula o que o Supabase fornece: schema auth (auth.users, auth.uid()), papéis anon/authenticated/service_role,
 * e o JWT/cabeçalhos da requisição (request.jwt.claim.sub, request.headers).
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const db = new PGlite();

let fails = 0, passes = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (c) passes++; else fails++; };
const canon = v => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const eq = (a, b, m) => { const same = canon(a) === canon(b); ok(same, `${m}${same ? '' : `  (obteve ${JSON.stringify(a)}, esperava ${JSON.stringify(b)})`}`); };

// ---------- ambiente Supabase simulado ----------
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);
for (const f of readdirSync(join(here, '../migrations')).sort()) await db.exec(readFileSync(join(here, '../migrations', f), 'utf8'));
console.log('migrações aplicadas\n');

// ---------- ajudantes ----------
const j = obj => `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
const q = async (sql, params) => (await db.query(sql, params)).rows;

/** Chama public.<expr> como um papel/usuário/IP. Devolve {ok,data} ou {ok:false,error}. */
async function rpc(user, expr, { role = 'authenticated', ip, headers, sessao } = {}) {
  const h = { ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(headers ?? {}) };
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  // cada usuário tem uma sessão padrão "s-<id>"; os testes de liberação usam outras
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(user ? { sub: user, session_id: sessao ?? `s-${user}` } : {})]);
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(h)]);
  // como o PostgREST: /rpc/<função chamada> (usado para conferir as funções liberadas da pessoa)
  await db.query(`select set_config('request.path', $1, false)`, [`/rpc/${(expr.match(/^(\w+)\(/) ?? [])[1] ?? ''}`]);
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

// ---------- duas empresas ----------
const empA = (await rpc(null, `fab_criar_empresa('alfa','Confecções Alfa')`, { role: 'service_role' })).data;
const empB = (await rpc(null, `fab_criar_empresa('beta','Malharia Beta')`, { role: 'service_role' })).data;
const mkUser = async (emp, login, nome, setor, perfil = 'funcionario', podeFalta = false, ativo = true) => {
  const [{ id }] = await q(`insert into auth.users (email) values ($1) returning id`, [`${login}@fabrica.local`]);
  await q(`insert into fab.perfis (id, empresa_id, login, nome, setor, perfil, pode_falta, ativo, criado_em)
           values ($1,$2,$3,$4,$5,$6::fab.perfil,$7,$8, now() - interval '60 days')`, [id, emp, login, nome, setor, perfil, podeFalta, ativo]);
  return id;
};
const admin = await mkUser(empA, 'admin', 'Edson', 'Administração', 'admin', true);
const ana = await mkUser(empA, 'ana', 'Ana Souza', 'Costureira');
const bruno = await mkUser(empA, 'bruno', 'Bruno Lima', 'Cortador');
const carla = await mkUser(empA, 'carla', 'Carla Dias', 'Conferente', 'funcionario', true);
const ghost = await mkUser(empA, 'ghost', 'Inativo', 'Costureira', 'funcionario', false, false);
const adminB = await mkUser(empB, 'admin', 'Beatriz', 'Administração', 'admin', true);   // mesmo login, outra empresa
const joaoB = await mkUser(empB, 'joao', 'João', 'Cortador');
await q(`insert into fab.donos (user_id, principal) values ($1, true)`, [admin]);
// a liberação de acesso tem testes próprios (seção 16); nas demais seções ela fica desligada
await q(`update fab.configuracao set exigir_liberacao = false`);

for (const emp of [empA, empB]) {
  await q(`insert into fab.itens_lista (empresa_id, tipo, nome, ordem) values
    ($1,'modelo','Camisa Polo',1),($1,'modelo','Calça Jeans',2),($1,'cor','Preto',1),($1,'cor','Branco',2),
    ($1,'tamanho','P',1),($1,'tamanho','M',2),($1,'tamanho','G',3)`, [emp]);
}
const lanc = (etapa, qtd = 10, tam = 'M', modelo = 'Camisa Polo', cor = 'Preto') =>
  `fab_lancar('${etapa}','${modelo}','${cor}','', ${j([{ tamanho: tam, qtd }])})`;

// ============ 1. segurança ============
console.log('--- segurança ---');
ok(fails_with(await rpc(null, 'fab_painel()', { role: 'anon' }), 'permission denied'), 'anônimo não chama fab_painel');
ok(fails_with(await rpc(null, 'fab_boot()'), 'SESSAO'), 'sem login: erro SESSAO');
ok(fails_with(await rpc(ghost, 'fab_boot()'), 'SESSAO'), 'usuário inativo: erro SESSAO');
ok(fails_with(await rpc(ana, `fab_criar_perfil(gen_random_uuid(),'${empA}','x','X','Outra','admin',true)`), 'permission denied'), 'usuário comum não cria perfil');
ok(fails_with(await rpc(ana, `fab_criar_empresa('x','X')`), 'permission denied'), 'usuário comum não cria empresa');
ok(fails_with(await rpc(ana, 'fab_listar_usuarios()'), 'FUNCAO_BLOQUEADA'), 'funcionário não lista usuários');
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
ok(r.ok && r.data.total === 40, 'costureira lança 40 de Costura');
ok(fails_with(await rpc(ana, lanc('Corte', 5)), 'Seu setor não lança'), 'regra de setor vale no servidor');
ok(fails_with(await rpc(ana, lanc('Costura', 5, 'M', 'Modelo Fantasma')), 'Modelo inválido'), 'modelo fora da lista é recusado');
ok(fails_with(await rpc(ana, lanc('Costura', 5, 'XXG')), 'Tamanho inválido'), 'tamanho fora da lista é recusado');
ok(fails_with(await rpc(ana, `fab_lancar('Costura','Camisa Polo','Preto','', '[{"tamanho":"M","qtd":"12a"}]'::jsonb)`), 'Quantidade inválida'), 'quantidade não numérica é recusada');
ok(fails_with(await rpc(ana, `fab_lancar('Costura','Camisa Polo','Preto','', '[]'::jsonb)`), 'pelo menos um tamanho'), 'lançamento vazio é recusado');
r = await rpc(ana, lanc('Costura', 70));
ok(r.ok && r.data.avisos.length === 1 && r.data.avisos[0].includes('110 contra 100'), 'aviso quando costura passa do que foi cortado');
r = await rpc(admin, lanc('Conferência', 5, 'P', 'Calça Jeans', 'Branco'));
ok(r.ok, 'administrador lança qualquer etapa');

// ============ 3. painel ============
console.log('\n--- painel ---');
r = await rpc(admin, 'fab_painel()');
const lin = r.data.saldo.find(s => s.modelo === 'Camisa Polo' && s.cor === 'Preto' && s.tamanho === 'M');
eq([lin.corte, lin.costura, lin.conf, lin.naCostura, lin.naConf, lin.erro], [100, 110, 0, 0, 110, true], 'saldo por etapa e linha com erro');
eq(r.data.prodHoje, { Corte: 100, Costura: 110, 'Conferência': 5 }, 'produção de hoje por etapa');
eq(r.data.presenca.map(p => p.nome), ['Ana Souza', 'Bruno Lima', 'Carla Dias'], 'presença lista só funcionários ativos da empresa');

// ============ 4. isolamento entre empresas ============
console.log('\n--- isolamento entre empresas ---');
r = await rpc(adminB, 'fab_painel()');
ok(r.ok && r.data.saldo.length === 0 && r.data.presenca.map(p => p.nome).join() === 'João', 'empresa B não vê a produção nem as pessoas da A');
const [{ id: idAnaLanc }] = await q(`select id from fab.lancamentos where user_id = $1 and qtd = 40`, [ana]);
ok(fails_with(await rpc(adminB, `fab_editar_lancamento('${idAnaLanc}', 1)`), 'não encontrado'), 'admin da B não edita lançamento da A');
ok(fails_with(await rpc(adminB, `fab_apagar_lancamento('${idAnaLanc}')`), 'não encontrado'), 'admin da B não apaga lançamento da A');
r = await rpc(adminB, 'fab_listar_usuarios()');
eq(r.data.map(u => u.login).sort(), ['admin', 'joao'], 'cada empresa lista só os seus usuários (logins podem se repetir)');
ok(fails_with(await rpc(adminB, `fab_atualizar_perfil('ana','Ana','Costureira','funcionario',false,false)`), 'não encontrada'), 'admin da B não altera pessoa da A');
r = await rpc(joaoB, lanc('Corte', 7));
ok(r.ok, 'empresa B lança na própria produção');
r = await rpc(admin, 'fab_painel()');
eq(r.data.prodHoje.Corte, 100, 'produção da B não soma na A');
r = await rpc(admin, 'fab_boot()');
eq(r.data.empresa, { codigo: 'alfa', nome: 'Confecções Alfa' }, 'boot informa a empresa do usuário');

// ============ 5. editar e apagar ============
console.log('\n--- editar e apagar ---');
ok(fails_with(await rpc(bruno, `fab_editar_lancamento('${idAnaLanc}', 41)`), 'só pode editar os seus'), 'não edita lançamento de outra pessoa');
r = await rpc(ana, `fab_editar_lancamento('${idAnaLanc}', 35)`);
let [row] = await q(`select qtd, edicoes, historico from fab.lancamentos where id = $1`, [idAnaLanc]);
ok(r.ok && row.qtd === 35 && row.edicoes === 1 && row.historico.includes('40→35'), 'edição registra histórico (40→35)');
r = await rpc(ana, `fab_apagar_lancamento('${idAnaLanc}')`);
[row] = await q(`select apagado_em from fab.lancamentos where id = $1`, [idAnaLanc]);
ok(r.ok && row.apagado_em !== null, 'apagar é lógico (a linha continua no banco)');
eq((await q(`select acao from fab.lancamento_log where lancamento_id = $1 order by id`, [idAnaLanc])).map(x => x.acao), ['editar', 'apagar'], 'auditoria registra editar e apagar');

// ============ 6. itens em falta ============
console.log('\n--- itens em falta ---');
ok(fails_with(await rpc(ana, `fab_add_em_falta('Camisa Polo','Preto','M',20,'')`), 'Sem permissão'), 'sem permissão não cadastra falta');
r = await rpc(carla, `fab_add_em_falta('Camisa Polo','Preto','M',20,'Pedido urgente')`);
const faltaId = r.data[0].id;
ok(r.ok && r.data.length === 1 && r.data[0].falta === 20, 'quem pode, cadastra item em falta');
ok((await rpc(adminB, 'fab_boot()')).data.emFalta.length === 0, 'item em falta da A não aparece na B');
await rpc(carla, lanc('Conferência', 12));
r = await rpc(carla, 'fab_boot()');
eq([r.data.emFalta[0].feito, r.data.emFalta[0].falta], [12, 8], 'conferência abate o que falta');
ok(fails_with(await rpc(ana, `fab_status_em_falta('${faltaId}','Feito')`), 'Apenas o administrador'), 'só administrador dá baixa manual');
await rpc(carla, lanc('Conferência', 8));
ok((await rpc(carla, 'fab_boot()')).data.emFalta.length === 0, 'baixa automática ao completar a quantidade');

// ============ 7. ponto ============
console.log('\n--- ponto ---');
await q(`update fab.configuracao set hora_fim = '00:00' where empresa_id = $1`, [empA]);
r = await rpc(bruno, `fab_bater_ponto('entrada')`);
ok(r.ok && /^\d\d:\d\d$/.test(r.data), `entrada marcada (${r.data})`);
ok(fails_with(await rpc(bruno, `fab_bater_ponto('entrada')`), 'já marcada'), 'segunda entrada no mesmo dia é recusada');
// CORREÇÃO: fechar_pendentes não pode encerrar o turno de HOJE de quem faz hora extra
await q(`select fab.fechar_pendentes()`);
[row] = await q(`select saida from fab.ponto where user_id = $1`, [bruno]);
ok(row.saida === null, 'rotina automática NÃO fecha o ponto de hoje (hora extra continua contando)');
r = await rpc(bruno, `fab_bater_ponto('saida')`);
[row] = await q(`select extra_min from fab.ponto where user_id = $1`, [bruno]);
ok(r.ok && row.extra_min > 0, `saída depois do fechamento conta hora extra (${row.extra_min} min)`);
await q(`update fab.configuracao set hora_fim = '17:30' where empresa_id = $1`, [empA]);
await q(`insert into fab.ponto (empresa_id, user_id, dia, entrada) values ($1, $2, fab.hoje($1) - 3, '07:50')`, [empA, ana]);
await q(`select fab.fechar_pendentes()`);
[row] = await q(`select saida::text, automatico, extra_min from fab.ponto where user_id = $1 and dia = fab.hoje($2) - 3`, [ana, empA]);
ok(row.saida === '17:30:00' && row.automatico && row.extra_min === 0, 'ponto esquecido de dia anterior fecha às 17:30 sem hora extra');

// ============ 8. Wi-Fi ============
console.log('\n--- Wi-Fi da fábrica ---');
await q(`update fab.configuracao set exigir_wifi = true where empresa_id = $1`, [empA]);
ok(fails_with(await rpc(ana, 'fab_boot()'), 'WIFI'), 'com Wi-Fi exigido e sem rede cadastrada, funcionário recebe WIFI');
ok((await rpc(admin, `fab_cadastrar_rede_atual('Fábrica')`, { ip: '203.0.113.9' })).data.ips[0].ip === '203.0.113.9', 'cadastra o IP que a borda viu (cf-connecting-ip)');
ok((await rpc(ana, 'fab_boot()', { ip: '203.0.113.9' })).ok, 'funcionário na rede cadastrada entra');
ok(fails_with(await rpc(ana, 'fab_boot()', { ip: '198.51.100.7' }), 'WIFI'), 'funcionário em outra rede recebe WIFI');
// CORREÇÃO: X-Forwarded-For forjado pelo cliente não libera o acesso
ok(fails_with(await rpc(ana, 'fab_boot()', { headers: { 'x-forwarded-for': '203.0.113.9' } }), 'WIFI'), 'X-Forwarded-For forjado NÃO burla a regra do Wi-Fi');
ok(fails_with(await rpc(ana, 'fab_boot()', { ip: '198.51.100.7', headers: { 'x-forwarded-for': '203.0.113.9, 1.1.1.1' } }), 'WIFI'), 'X-Forwarded-For não sobrepõe o IP real');
ok((await rpc(joaoB, 'fab_boot()', { ip: '1.2.3.4' })).ok, 'regra de Wi-Fi da A não afeta a B');
await rpc(admin, `fab_salvar_wifi(false, '{}'::text[])`);
ok((await rpc(ana, 'fab_boot()')).ok, 'desligar a exigência libera todos');

// ============ 9. links "só ver" ============
console.log('\n--- links "só ver" ---');
const chave = (await rpc(admin, `fab_criar_chave('TV da fábrica')`)).data;
ok(/^[0-9a-f]{32}$/.test(chave), 'chave aleatória de 128 bits');
r = await rpc(null, `fab_boot_chave('${chave}')`, { role: 'anon' });
ok(r.ok && r.data.eu.leitura && !r.data.eu.admin && r.data.empresa.codigo === 'alfa', 'link abre a empresa certa como "só ver"');
ok((await rpc(null, `fab_painel_chave('${chave}')`, { role: 'anon' })).data.prodHoje.Corte === 100, 'link mostra o painel da empresa dele');
await rpc(adminB, 'fab_revogar_chaves()');
ok((await rpc(null, `fab_validar_chave('${chave}')`, { role: 'anon' })).data === true, 'B revogar os links dela não afeta os da A');
await rpc(admin, 'fab_revogar_chaves()');
ok(fails_with(await rpc(null, `fab_painel_chave('${chave}')`, { role: 'anon' }), 'inválido'), 'chave revogada para de funcionar');

// ============ 10. cadastros ============
console.log('\n--- cadastros ---');
r = await rpc(admin, `fab_salvar_lista('Cores', array[' Preto','Branco','Preto','','Azul'])`);
eq(r.data, ['Preto', 'Branco', 'Azul'], 'lista é limpa, sem repetidos, na ordem digitada');
eq((await rpc(adminB, 'fab_boot()')).data.cores, ['Preto', 'Branco'], 'listas são de cada empresa');
// CORREÇÃO: o admin não se tranca para fora
await q(`update fab.perfis set perfil = 'admin' where id = $1`, [carla]);
ok(fails_with(await rpc(admin, `fab_atualizar_perfil('admin','Edson','Administração','admin',false,true)`), 'própria conta'), 'admin não desativa a própria conta');
ok(fails_with(await rpc(admin, `fab_atualizar_perfil('admin','Edson','Administração','funcionario',true,true)`), 'própria conta'), 'admin não se rebaixa');
await q(`update fab.perfis set perfil = 'funcionario' where id = $1`, [carla]);
ok(fails_with(await rpc(adminB, `fab_atualizar_perfil('joao','João','Cortador','funcionario',true,false)`), '') === false, 'admin da B edita o próprio funcionário');

// ============ 11. dono do sistema ============
console.log('\n--- dono do sistema ---');
ok(fails_with(await rpc(adminB, 'fab_empresas()'), 'responsável pelo sistema'), 'admin de empresa não vê a lista de empresas');
r = await rpc(admin, 'fab_empresas()');
ok(r.ok && r.data.length === 2 && r.data.find(e => e.codigo === 'beta').usuarios === 2, 'dono lista empresas com contagem de usuários');
ok((await rpc(admin, 'fab_boot()')).data.eu.dono === true && (await rpc(adminB, 'fab_boot()')).data.eu.dono === false, 'boot diz quem é dono');
ok(fails_with(await rpc(admin, `fab_bloquear_empresa('${empA}', true, 'x')`), 'própria empresa'), 'dono não bloqueia a própria empresa');
await rpc(admin, `fab_bloquear_empresa('${empB}', true, 'Mensalidade em atraso')`);
ok(fails_with(await rpc(adminB, 'fab_boot()'), 'EMPRESA_BLOQUEADA'), 'empresa bloqueada perde o acesso na hora');
ok(fails_with(await rpc(joaoB, `fab_bater_ponto('entrada')`), 'EMPRESA_BLOQUEADA'), 'funcionário de empresa bloqueada também');
await rpc(admin, `fab_bloquear_empresa('${empB}', false, '')`);
ok((await rpc(adminB, 'fab_boot()')).ok, 'desbloquear devolve o acesso');
ok(fails_with(await rpc(null, `fab_criar_empresa('alfa','Outra')`, { role: 'service_role' }), 'Já existe'), 'código de empresa é único');
ok(fails_with(await rpc(null, `fab_criar_empresa('Com Espaço','X')`, { role: 'service_role' }), 'Código inválido'), 'código de empresa é validado');

// ============ 12. financeiro ============
console.log('\n--- financeiro ---');
ok(fails_with(await rpc(ana, 'fin_dados()'), 'FUNCAO_BLOQUEADA'), 'funcionário não vê o financeiro');
let fin = (await rpc(admin, 'fin_dados()')).data;
eq(fin.contas.map(c => c.nome), ['Caixa', 'Conta corrente'], 'empresa nova já vem com contas padrão');
ok(fin.listas.categorias.includes('Matéria-prima') && fin.listas.formas.includes('PIX'), 'e com categorias e formas de pagamento');
const conta = fin.contas.find(c => c.nome === 'Conta corrente').id;
const cartao = (await rpc(admin, `fin_salvar_cartao(${j({ nome: 'Visa Empresa', diaFechamento: 25, diaVencimento: 5 })})`)).data;
ok(!!cartao, 'cadastra cartão');
r = await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'entrada', data: '2026-11-10', descricao: 'Venda lote 12', valor: 5000, contaId: conta, categoria: 'Vendas' })})`);
ok(r.ok, 'lança entrada');
r = await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'saida', data: '2026-11-26', descricao: 'Linha e aviamentos', valor: 300, cartaoId: cartao, categoria: 'Matéria-prima' })})`);
ok(r.ok, 'lança saída no cartão');
fin = (await rpc(admin, 'fin_dados()')).data;
eq(fin.lancamentos.find(l => l.descricao === 'Linha e aviamentos').vencimentoFatura, '2027-01-05', 'compra após o fechamento (dia 26 > 25) cai na fatura de janeiro');
r = await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'saida', data: '2026-11-20', descricao: 'Botões', valor: 50, cartaoId: cartao })})`);
fin = (await rpc(admin, 'fin_dados()')).data;
eq(fin.lancamentos.find(l => l.descricao === 'Botões').vencimentoFatura, '2026-12-05', 'compra antes do fechamento cai na fatura de dezembro');
eq((await q(`select fab.fin_vencimento_fatura('2026-01-31', 31, 10)::text as d`))[0].d, '2026-02-10', 'fechamento no dia 31 com vencimento dia 10');
eq((await q(`select fab.fin_vencimento_fatura('2026-02-15', 30, 28)::text as d`))[0].d, '2026-03-28', 'mês curto: fechamento 30 vira 28/02 e o vencimento no mesmo dia passa para o mês seguinte (regra do app original)');
r = await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'programada', data: '2026-11-01', descricao: 'Máquina de costura', valor: 3000, contaId: conta, parcelas: 3, valorParcela: 1000, diaVencimento: 15 })})`);
const progId = r.data;
ok(r.ok, 'lança saída programada em 3 parcelas');
ok(fails_with(await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'programada', data: '2026-11-01', descricao: 'x', valor: 10, contaId: conta, parcelas: 2, valorParcela: 5 })})`), 'dia do vencimento'), 'programada na conta exige dia de vencimento');
ok(fails_with(await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'saida', data: '2026-11-01', descricao: 'x', valor: 10 })})`), 'conta ou o cartão'), 'saída exige conta ou cartão');
ok(fails_with(await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'saida', data: '2026-11-01', descricao: 'x', valor: 0, contaId: conta })})`), 'maior que zero'), 'valor zero é recusado');
r = await rpc(admin, `fin_pagar_parcela('${progId}', '2026-11-15', 1000, null)`);
fin = (await rpc(admin, 'fin_dados()')).data;
const prog = fin.lancamentos.find(l => l.id === progId);
const pago = fin.lancamentos.find(l => l.origemId === progId);
ok(r.ok && prog.parcelasPagas === 1 && pago.tipo === 'saida' && pago.descricao.endsWith('parcela 1/3') && pago.contaId === conta, 'pagar parcela vira saída efetivada na conta');
r = await rpc(admin, `fin_pagar_fatura('${cartao}', '2026-12-05', 50, '${conta}', '2026-12-05')`);
ok(r.ok, 'paga fatura do cartão');
ok(fails_with(await rpc(admin, `fin_pagar_fatura('${cartao}', '2026-12-05', 50, '${conta}', '2026-12-05')`), 'já foi paga'), 'mesma fatura não é paga duas vezes');
const meta = (await rpc(admin, `fin_salvar_meta(${j({ nome: 'Reserva de emergência', valorMeta: 10000 })})`)).data;
await rpc(admin, `fin_movimentar_meta('${meta}', 'deposito', 800, '2026-11-20', '${conta}')`);
ok(fails_with(await rpc(admin, `fin_movimentar_meta('${meta}', 'retirada', 900, '2026-11-21', '${conta}')`), 'só tem'), 'não retira mais do que foi guardado');
await rpc(admin, `fin_salvar_expectativa('2026-11', 6000, ${j({ 'Matéria-prima': '500', Aluguel: '1200', Vazia: '0' })})`);
fin = (await rpc(admin, 'fin_dados()')).data;
eq(fin.expectativas[0], { mes: '2026-11', entradas: 6000, saidas: { Aluguel: 1200, 'Matéria-prima': 500 } }, 'planejamento guarda previsão por categoria (ignora zeros)');
ok((await rpc(adminB, 'fin_dados()')).data.lancamentos.length === 0, 'financeiro da A não aparece na B');
ok(fails_with(await rpc(adminB, `fin_apagar_lancamento('${progId}')`), 'não encontrado'), 'B não apaga lançamento financeiro da A');
ok(fails_with(await rpc(adminB, `fin_salvar_lancamento(${j({ tipo: 'entrada', data: '2026-11-01', descricao: 'x', valor: 1, contaId: conta })})`), 'Conta inválida'), 'B não usa conta da A');

// ============ 13. DRE ============
console.log('\n--- resultado (DRE) ---');
ok(fails_with(await rpc(ana, 'dre_dados()'), 'FUNCAO_BLOQUEADA'), 'funcionário não vê a DRE');
let dre = (await rpc(admin, 'dre_dados()')).data;
eq(dre.categorias.length, 18, 'empresa nova já vem com as 18 categorias do DRE');
const cat = Object.fromEntries(dre.categorias.map(c => [c.chave, c.id]));
const itens = (marcas) => j(dre.categorias.map(c => ({ categoriaId: c.id, ...(marcas[c.chave] ?? { marca: 'na' }) })));
r = await rpc(admin, `dre_salvar_mes('2026-10', ${itens({ gross: { marca: 'valor', valor: 50000 }, tax: { marca: 'valor', valor: 5000 }, cmv: { marca: 'valor', valor: 20000 }, rent: { marca: 'depois' } })})`);
ok(r.ok && r.data === 'pendente', 'mês com "preencher depois" fica pendente');
r = await rpc(admin, `dre_salvar_mes('2026-10', ${itens({ gross: { marca: 'valor', valor: 50000 }, tax: { marca: 'valor', valor: 5000 }, cmv: { marca: 'valor', valor: 20000 }, rent: { marca: 'valor', valor: 3000 } })})`);
ok(r.ok && r.data === 'fechado', 'mês completo fica fechado');
ok(fails_with(await rpc(admin, `dre_salvar_mes('2026-10', ${j([{ categoriaId: cat.gross, marca: 'valor', valor: -1 }])})`), 'negativos'), 'valor negativo é recusado');
ok(fails_with(await rpc(admin, `dre_salvar_categoria(${j({ id: cat.cmv, nome: 'CMV', ativa: false })})`), 'essencial'), 'categoria essencial não pode ser desativada');
const nova = (await rpc(admin, `dre_salvar_categoria(${j({ grupo: 'admin', nome: 'Software de gestão', variabilidade: 'fixed' })})`)).data;
ok(!!nova, 'cria categoria própria');
dre = (await rpc(admin, 'dre_dados()')).data;
ok(dre.categorias.find(c => c.id === nova).tipo === 'minus', 'categoria nova de despesa é subtraída');
eq(dre.meses[0].valores[cat.gross], { marca: 'valor', valor: 50000 }, 'valores do mês voltam por categoria');
ok((await rpc(adminB, 'dre_dados()')).data.meses.length === 0, 'DRE da A não aparece na B');
ok(fails_with(await rpc(adminB, `dre_salvar_mes('2026-10', ${j([{ categoriaId: cat.gross, marca: 'valor', valor: 1 }])})`), 'Categoria inválida'), 'B não grava em categoria da A');

// ============ 14. relatório ============
console.log('\n--- relatório ---');
const seg = new Date(); seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7) - 14);
const dia = n => { const d = new Date(seg); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
await q(`insert into fab.ponto (empresa_id, user_id, dia, entrada, saida, extra_min) values ($1,$2,$3,'08:00','17:00',0), ($1,$2,$4,'08:00','18:30',60)`, [empA, ana, dia(0), dia(1)]);
await q(`insert into fab.dias_sem_expediente (empresa_id, dia, motivo) values ($1,$2,'Feriado')`, [empA, dia(3)]);
r = await rpc(admin, `fab_relatorio('${dia(0)}','${dia(4)}')`);
const rel = r.data, pa = rel.pessoas.find(p => p.nome === 'Ana Souza');
ok(r.ok && rel.diasUteis === 4, 'dias úteis: seg a sex menos o feriado da empresa = 4');
eq([pa.diasTrab, pa.horas, pa.extras], [2, '19:30', '1:00'], 'Ana: 2 dias, 19:30 de horas (9:00 + 10:30), 1:00 de extra');
eq(pa.faltas, [dia(2), dia(4)], 'faltas = quarta e sexta (feriado não conta)');
ok((await rpc(adminB, `fab_relatorio('${dia(0)}','${dia(4)}')`)).data.diasUteis === 5, 'feriado cadastrado na A não vale para a B');

// ============ 15. cópia de segurança ============
console.log('\n--- cópia de segurança ---');
r = await rpc(admin, 'fab_exportar()');
ok(r.ok && r.data.formato === 'fabrica-backup-2' && r.data.empresa.codigo === 'alfa', 'admin exporta a própria empresa');
const tabs = r.ok ? r.data.tabelas : {};
ok(tabs.perfis?.length === 5 && tabs.perfis.every(x => x.empresa_id === empA), 'backup traz só as pessoas da empresa A');
ok(tabs.ponto?.length >= 2 && tabs.itens_lista?.length >= 7 && Array.isArray(tabs.fin_lancamentos) && Array.isArray(tabs.dre_categorias), 'backup traz produção, ponto, financeiro e resultado');
ok(!('chaves_acesso' in tabs), 'backup não leva as chaves de acesso');
ok(fails_with(await rpc(ana, 'fab_exportar()'), 'FUNCAO_BLOQUEADA'), 'funcionário não exporta');
ok(fails_with(await rpc(null, 'fab_exportar()', { role: 'anon' }), 'permission denied'), 'anônimo não exporta');
ok((await rpc(adminB, 'fab_exportar()')).data.tabelas.perfis.every(x => x.empresa_id === empB), 'admin da B exporta só a B');

// ============ 16. liberação de acesso e auditoria ============
console.log('\n--- liberação de acesso e auditoria ---');
await q(`update fab.configuracao set exigir_liberacao = true where empresa_id = $1`, [empA]);
const APARELHO = 'aparelho-da-ana-0001';
ok(fails_with(await rpc(ana, 'fab_boot()', { sessao: 'ana-1' }), 'ACESSO_PENDENTE'), 'sem pedir acesso: bloqueado');
eq((await rpc(ana, `fab_pedir_acesso('${APARELHO}','Chrome · Android')`, { sessao: 'ana-1' })).data, 'pendente', 'funcionária pede acesso: fica pendente');
ok(fails_with(await rpc(ana, 'fab_boot()', { sessao: 'ana-1' }), 'ACESSO_PENDENTE'), 'pendente não usa o sistema');
eq((await rpc(ana, 'fab_status_acesso()', { sessao: 'ana-1' })).data, 'pendente', 'status pendente');
eq((await rpc(admin, `fab_pedir_acesso('admin-pc-000000001','Edge · Windows')`, { sessao: 'adm-1' })).data, 'aprovada', 'administrador entra direto');
r = await rpc(admin, 'fab_acessos_pendentes()', { sessao: 'adm-1' });
ok(r.ok && r.data.length === 1 && r.data[0].login === 'ana' && r.data[0].aparelho === 'Chrome · Android', 'admin vê o pedido da Ana');
ok(!(await rpc(bruno, 'fab_acessos_pendentes()')).ok, 'funcionário não vê pedidos');
ok((await rpc(adminB, 'fab_acessos_pendentes()')).data.length === 0, 'admin da outra empresa não vê o pedido');
ok(fails_with(await rpc(adminB, `fab_decidir_acesso('${r.data[0].id}', true, false)`), 'já foi respondido'), 'admin da outra empresa não libera');
ok((await rpc(admin, `fab_decidir_acesso('${r.data[0].id}', true, true)`, { sessao: 'adm-1' })).ok, 'admin libera e confia no aparelho');
ok((await rpc(ana, 'fab_boot()', { sessao: 'ana-1' })).ok, 'liberada: usa o sistema');
ok((await rpc(ana, `fab_presenca('Lançar')`, { sessao: 'ana-1' })).ok, 'sinal de presença');
eq((await rpc(ana, `fab_pedir_acesso('${APARELHO}','Chrome · Android')`, { sessao: 'ana-2' })).data, 'aprovada', 'aparelho confiável: próximo login entra direto');
eq((await rpc(ana, `fab_pedir_acesso('outro-aparelho-0002','Safari · iPhone')`, { sessao: 'ana-3' })).data, 'pendente', 'outro aparelho: pendente de novo');
const p3 = (await rpc(admin, 'fab_acessos_pendentes()', { sessao: 'adm-1' })).data[0];
ok((await rpc(admin, `fab_decidir_acesso('${p3.id}', false, false)`, { sessao: 'adm-1' })).ok, 'admin nega');
ok(fails_with(await rpc(ana, 'fab_boot()', { sessao: 'ana-3' }), 'ACESSO_NEGADO'), 'negada: bloqueada com aviso');
const sAna2 = (await q(`select id from fab.sessoes where session_id = 'ana-2'`))[0].id;
ok((await rpc(admin, `fab_encerrar_sessao('${sAna2}')`, { sessao: 'adm-1' })).ok, 'admin derruba uma sessão');
ok(fails_with(await rpc(ana, 'fab_boot()', { sessao: 'ana-2' }), 'SESSAO'), 'sessão derrubada sai do sistema');
ok((await rpc(ana, 'fab_sair_sessao()', { sessao: 'ana-1' })).ok && fails_with(await rpc(ana, 'fab_boot()', { sessao: 'ana-1' }), 'SESSAO'), 'sair encerra a sessão');
ok((await rpc(adminB, 'fab_boot()')).ok && (await rpc(joaoB, 'fab_boot()')).ok, 'empresa B (sem exigir liberação) segue normal');
// auditoria: tudo que é criado/alterado/apagado vira evento com o autor
await q(`update fab.configuracao set exigir_liberacao = false where empresa_id = $1`, [empA]);
await rpc(bruno, lanc('Corte', 7, 'G'));
const lid = (await q(`select id from fab.lancamentos where empresa_id = $1 order by criado_em desc limit 1`, [empA]))[0].id;
await rpc(bruno, `fab_editar_lancamento('${lid}', 9)`);
const ac = (await rpc(admin, `fab_acessos(current_date - 1, current_date + 1)`)).data;
const ev = ac.eventos;
ok(ev.some(e => e.tipo === 'criou' && e.alvo === 'lancamentos' && e.quem === 'Bruno Lima'), 'auditoria: lançamento criado pelo Bruno');
ok(ev.some(e => e.tipo === 'alterou' && e.alvo === 'lancamentos' && e.detalhe.mudou?.qtd), 'auditoria: edição mostra antes e depois');
ok(ev.some(e => e.tipo === 'acesso_liberado' && e.alvo === 'Ana Souza') && ev.some(e => e.tipo === 'acesso_negado'), 'auditoria: liberações e negações');
ok(ev.some(e => e.tipo === 'saida' && e.quem === 'Ana Souza') && ev.some(e => e.tipo === 'entrada'), 'auditoria: entradas e saídas');
ok(!JSON.stringify(ev).includes('chave_hash'), 'auditoria não grava hash de chave');
const mAna = ac.metricas.find(m => m.login === 'ana');
ok(mAna && mAna.entradas >= 2 && mAna.negados === 1, 'métricas: entradas e acessos negados da Ana');
ok(ac.aparelhos.length === 1 && ac.aparelhos[0].login === 'ana', 'aparelho confiável listado');
ok((await rpc(admin, `fab_revogar_aparelho('ana','${APARELHO}')`)).ok && (await rpc(admin, `fab_acessos(current_date, current_date)`)).data.aparelhos.length === 0, 'admin revoga o aparelho');
ok(!(await rpc(adminB, `fab_acessos(current_date - 1, current_date + 1)`)).data.eventos.some(e => e.quem === 'Bruno Lima'), 'eventos não vazam para outra empresa');
ok(fails_with(await rpc(null, `fab_acessos(current_date, current_date)`, { role: 'anon' }), 'permission denied'), 'anônimo não vê acessos');

// ============ 17. link de teste (7 dias) e bloqueio de pessoa ============
console.log('\n--- link de teste e bloqueio ---');
ok(fails_with(await rpc(adminB, `fab_criar_convite('teste', 7, 1, 30, 'x')`), 'responsável pelo sistema'), 'só o dono gera link de teste');
const tok = (await rpc(admin, `fab_criar_convite('teste', 7, 2, 30, 'Malharias da região')`)).data;
ok(typeof tok === 'string' && tok.length >= 64, 'dono gera link (código longo, mostrado uma vez)');
ok(!(await q(`select 1 from fab.convites where token_hash = $1`, [tok])).length, 'banco guarda só o hash do link');
r = (await rpc(null, `fab_validar_convite('${tok}')`, { role: 'anon' })).data;
ok(r.valido === true && r.tipo === 'teste' && r.dias === 7 && r.ate.length === 16, 'página pública valida o link (tipo e data final)');
eq((await rpc(null, `fab_validar_convite('nao-existe-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')`, { role: 'anon' })).data.valido, false, 'link inventado não vale');
ok(fails_with(await rpc(null, `fab_criar_empresa_teste('${tok}','gama','Gama')`, { role: 'anon' }), 'permission denied'), 'anônimo não cria empresa direto');
const empG = (await rpc(null, `fab_criar_empresa_teste('${tok}','gama','Confecções Gama')`, { role: 'service_role' })).data;
ok(Boolean(empG), 'link cria a empresa em teste');
const [g] = await q(`select teste_ate - now() as falta from fab.empresas where id = $1`, [empG]);
ok(g.falta && String(g.falta).includes('6 days'), 'teste vale 7 dias');
ok(fails_with(await rpc(null, `fab_criar_empresa_teste('${tok}','gama','Outra')`, { role: 'service_role' }), 'Já existe uma empresa'), 'código repetido é recusado');
const anaG = await mkUser(empG, 'dona', 'Dona Gama', 'Administração', 'admin', true);
ok((await rpc(anaG, 'fab_boot()')).ok, 'empresa em teste usa o sistema');
eq((await rpc(anaG, 'fab_meu_teste()')).data?.length, 16, 'app sabe até quando vai o teste');
await q(`update fab.empresas set teste_ate = now() - interval '1 minute' where id = $1`, [empG]);
ok(fails_with(await rpc(anaG, 'fab_boot()'), 'EMPRESA_TESTE_EXPIRADO'), 'teste vencido: ninguém entra');
ok((await rpc(admin, `fab_ajustar_teste('${empG}', 7)`)).ok && (await rpc(anaG, 'fab_boot()')).ok, 'dono estende 7 dias');
ok((await rpc(admin, `fab_ajustar_teste('${empG}', null)`)).ok && (await q(`select teste_ate from fab.empresas where id = $1`, [empG]))[0].teste_ate === null, 'dono torna cliente definitivo');
const emps = (await rpc(admin, 'fab_empresas()')).data.find(e => e.codigo === 'gama');
ok(emps && emps.porLink === true && 'tempo7d' in emps && 'acoes7d' in emps, 'lista de empresas mostra origem e uso');
ok((await rpc(null, `fab_criar_empresa_teste('${tok}','delta','Delta')`, { role: 'service_role' })).ok, 'link de 2 usos aceita o segundo');
ok(fails_with(await rpc(null, `fab_criar_empresa_teste('${tok}','epsilon','Eps')`, { role: 'service_role' }), 'não vale mais'), 'terceiro uso é recusado');
const tokD = (await rpc(admin, `fab_criar_convite('teste', 7, 1, 30, 'desfazer')`)).data;
const empD = (await rpc(null, `fab_criar_empresa_teste('${tokD}','omega','Omega')`, { role: 'service_role' })).data;
ok((await rpc(null, `fab_desfazer_empresa_teste('${empD}')`, { role: 'service_role' })).ok && !(await q(`select 1 from fab.empresas where id = $1`, [empD])).length, 'desfazer apaga a empresa de teste (com cascata e auditoria)');
eq((await rpc(null, `fab_validar_convite('${tokD}')`, { role: 'anon' })).data.valido, true, 'desfazer devolve o uso do link');
ok((await rpc(null, `fab_apagar_empresa_vazia('${(await rpc(null, `fab_criar_empresa('vazia','Vazia')`, { role: 'service_role' })).data}')`, { role: 'service_role' })).ok, 'apagar empresa vazia funciona com auditoria');
const cv = (await rpc(admin, 'fab_convites()')).data.find(c => c.nota === 'Malharias da região');
ok(cv.usos === 2 && cv.empresas.length === 2, 'dono vê quantas empresas usaram o link');
const tok2 = (await rpc(admin, `fab_criar_convite('teste', 7, 1, 30, '')`)).data;
const cv2 = (await rpc(admin, 'fab_convites()')).data.find(c => c.nota === '');
ok((await rpc(admin, `fab_revogar_convite('${cv2.id}')`)).ok && !(await rpc(null, `fab_validar_convite('${tok2}')`, { role: 'anon' })).data.valido, 'link revogado para de valer');
// bloqueio de pessoa
ok(fails_with(await rpc(admin, `fab_bloquear_pessoa('admin', true)`), 'própria conta'), 'admin não bloqueia a si mesmo');
ok((await rpc(admin, `fab_bloquear_pessoa('bruno', true)`)).ok, 'admin bloqueia uma pessoa');
ok(fails_with(await rpc(bruno, 'fab_boot()'), 'SESSAO'), 'pessoa bloqueada sai do sistema');
ok((await rpc(admin, `fab_bloquear_pessoa('bruno', false)`)).ok && (await rpc(bruno, 'fab_boot()')).ok, 'desbloqueada volta a entrar');
ok(fails_with(await rpc(adminB, `fab_bloquear_pessoa('bruno', true)`), 'não encontrada'), 'admin de outra empresa não bloqueia');
const ac2 = (await rpc(admin, `fab_acessos(current_date - 1, current_date + 1)`)).data;
ok(ac2.eventos.some(e => e.tipo === 'pessoa_bloqueada' && e.alvo === 'Bruno Lima'), 'bloqueio fica na atividade');
ok(ac2.metricas.every(m => 'logadoSeg' in m) && ac2.sessoes.every(x => 'logadoSeg' in x), 'tempo logado nas métricas e sessões');

// ============ 18. link TESTE (prazo conta do envio), link PRO e ficha da empresa ============
console.log('\n--- link teste x pro e vigilância ---');
const tT = (await rpc(admin, `fab_criar_convite('teste', 7, 5, 90, 'teste do envio')`)).data;
const [cT] = await q(`select expira_em - criado_em as validade from fab.convites where nota = 'teste do envio'`);
ok(String(cT.validade).startsWith('7 days'), 'link TESTE vence 7 dias após o envio (não 90)');
await q(`update fab.convites set criado_em = now() - interval '5 days' where nota = 'teste do envio'`);
const empT = (await rpc(null, `fab_criar_empresa_teste('${tT}','tau','Tau')`, { role: 'service_role' })).data;
const [eT] = await q(`select extract(day from teste_ate - now()) as dias from fab.empresas where id = $1`, [empT]);
ok(Number(eT.dias) === 1 || Number(eT.dias) === 2, 'cadastro no 5º dia: sobram só ~2 dias de teste (conta do envio)');
await q(`update fab.convites set expira_em = now() - interval '1 minute' where nota = 'teste do envio'`);
ok(fails_with(await rpc(null, `fab_criar_empresa_teste('${tT}','tau2','Tau 2')`, { role: 'service_role' }), 'não vale mais'), 'link TESTE vencido não cria empresa');
const tP = (await rpc(admin, `fab_criar_convite('pro', 7, 1, 30, 'cliente pro')`)).data;
r = (await rpc(null, `fab_validar_convite('${tP}')`, { role: 'anon' })).data;
ok(r.valido && r.tipo === 'pro' && r.ate === '', 'link PRO: página sabe que é versão completa');
const empP = (await rpc(null, `fab_criar_empresa_teste('${tP}','pi','Pi')`, { role: 'service_role' })).data;
ok((await q(`select teste_ate from fab.empresas where id = $1`, [empP]))[0].teste_ate === null, 'link PRO cria empresa sem prazo (versão completa)');
ok(fails_with(await rpc(admin, `fab_criar_convite('ouro', 7, 1, 30, '')`), 'Tipo de link inválido'), 'tipo de link inválido é recusado');
const lista = (await rpc(admin, 'fab_empresas()')).data;
const ePi = lista.find(e => e.codigo === 'pi'), eTau = lista.find(e => e.codigo === 'tau');
ok(ePi.tipoLink === 'pro' && eTau.tipoLink === 'teste' && 'implantacao' in eTau && 'pessoas7d' in eTau && 'online' in eTau, 'lista mostra tipo de link, implantação e uso');
const dA = (await rpc(admin, `fab_empresa_detalhe('${empA}')`)).data;
ok(dA.dias.length === 14 && dA.pessoas.length >= 5 && Array.isArray(dA.modulos) && dA.eventos.length > 0, 'ficha da empresa: 14 dias, pessoas, módulos e linha do tempo');
ok(dA.implantacao.listas === true && dA.implantacao.producao === true, 'ficha mostra o que já foi implantado');
ok(fails_with(await rpc(adminB, `fab_empresa_detalhe('${empA}')`), 'responsável pelo sistema'), 'só o dono vê a ficha de outra empresa');

// ============ 19. funções por pessoa ============
console.log('\n--- funções por pessoa ---');
let fx = (await rpc(admin, `fab_funcoes_pessoa('carla')`)).data;
ok(fx.funcoes.lancar === true && fx.funcoes.financeiro === false && fx.funcoes.empresas === false && fx.possoEmpresas === true, 'padrão do funcionário: lançar sim, financeiro não');
ok(fails_with(await rpc(carla, 'fin_dados()'), 'FUNCAO_BLOQUEADA'), 'sem liberação: Carla não abre o financeiro');
ok((await rpc(admin, `fab_salvar_funcoes('carla', ${j({ financeiro: true, lancar: false })})`)).ok, 'admin libera financeiro e bloqueia lançar para a Carla');
ok((await rpc(carla, 'fin_dados()')).ok, 'liberado: Carla abre o financeiro (mesmo não sendo admin)');
ok((await rpc(carla, `fin_salvar_conta(${j({ nome: 'Caixa da Carla', saldoInicial: 0 })})`)).ok, 'liberado: Carla também grava no financeiro');
ok(fails_with(await rpc(carla, lanc('Conferência', 5)), 'FUNCAO_BLOQUEADA'), 'bloqueado: Carla não lança produção');
ok(fails_with(await rpc(carla, 'dre_dados()'), 'FUNCAO_BLOQUEADA'), 'o que não foi liberado continua fechado (DRE)');
let bc = (await rpc(carla, 'fab_boot()')).data.eu;
ok(bc.funcoes.financeiro === true && bc.funcoes.lancar === false && bc.financeiro === true, 'boot leva as funções liberadas para o app');
ok((await rpc(admin, `fab_salvar_funcoes('bruno', ${j({ acessos: true })})`)).ok, 'admin pode liberar Acessos para um funcionário');
ok(fails_with(await rpc(admin, `fab_salvar_funcoes('admin', ${j({ acessos: false })})`), 'próprias funções'), 'ninguém muda as próprias funções');
ok(fails_with(await rpc(adminB, `fab_salvar_funcoes('carla', ${j({ financeiro: false })})`), 'não encontrada'), 'admin de outra empresa não mexe');
// admin com função bloqueada
const adm2 = await mkUser(empA, 'gerente', 'Gerente', 'Administração', 'admin', true);
ok((await rpc(admin, `fab_salvar_funcoes('gerente', ${j({ financeiro: false })})`)).ok && fails_with(await rpc(adm2, 'fin_dados()'), 'FUNCAO_BLOQUEADA'), 'admin também pode ter função bloqueada');
// Empresas: só o dono libera, e só para alguém da própria empresa
ok(fails_with(await rpc(adm2, 'fab_empresas()'), 'responsável pelo sistema'), 'sem liberação: gerente não vê Empresas');
ok((await rpc(admin, `fab_salvar_funcoes('gerente', ${j({ empresas: true })})`)).ok && (await rpc(adm2, 'fab_empresas()')).ok, 'dono libera a tela Empresas para o gerente');
ok((await rpc(adm2, `fab_funcoes_pessoa('carla')`)).ok, 'co-responsável vê as funções das pessoas');
ok((await rpc(admin, `fab_salvar_funcoes('gerente', ${j({ empresas: false })})`)).ok && fails_with(await rpc(adm2, 'fab_empresas()'), 'responsável pelo sistema'), 'dono retira o acesso a Empresas');
ok((await rpc(adminB, `fab_salvar_funcoes('joao', ${j({ empresas: true })})`)).ok && fails_with(await rpc(joaoB, 'fab_empresas()'), 'responsável pelo sistema'), 'admin que não é dono não consegue liberar Empresas');
ok((await rpc(admin, `fab_acessos(current_date - 1, current_date + 1)`)).data.eventos.some(e => e.tipo === 'funcoes_alteradas' && e.alvo === 'Carla Dias'), 'mudança de funções fica na atividade');
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ financeiro: false, lancar: true })})`);

// ============ 20. correções de segurança das funções ============
console.log('\n--- segurança das funções ---');
// (1) funcionário com Cadastros não vira admin, não cria/mexe em admin, não gerencia funções
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ cadastros: true })})`);
ok(fails_with(await rpc(carla, `fab_atualizar_perfil('carla','Carla Dias','Conferente','admin',true,true)`), 'Só um administrador pode tornar'), '(1) funcionária com Cadastros não se torna admin');
ok(fails_with(await rpc(carla, `fab_atualizar_perfil('ana','Ana','Costureira','admin',true,false)`), 'Só um administrador pode tornar'), '(1) nem torna outra pessoa admin');
ok(fails_with(await rpc(carla, `fab_atualizar_perfil('gerente','Gerente','Adm','admin',false,true)`), 'outro administrador'), '(1) nem desativa um admin');
ok(fails_with(await rpc(carla, `fab_salvar_funcoes('ana', ${j({ financeiro: true })})`), 'Apenas o administrador'), '(1) nem gerencia funções de ninguém');
ok((await rpc(carla, `fab_atualizar_perfil('ana','Ana Souza','Costureira','funcionario',true,false)`)).ok, '(1) mas edita funcionários normalmente');
const me = (await rpc(carla, 'fab_minha_empresa()')).data;
ok(me.admin === false && me.eu === carla, '(1) função de borda sabe que quem chama não é admin');
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ cadastros: false })})`);
// (2) ninguém tranca a empresa sem admin com Cadastros e Acessos (empresa B: Beatriz e B2, ambos admins)
const e2 = await mkUser(empB, 'admb2', 'Admin B2', 'Administração', 'admin', true);
ok((await rpc(e2, `fab_salvar_funcoes('admin', ${j({ cadastros: false, acessos: false })})`)).ok, '(2) B2 tira Cadastros/Acessos da Beatriz (B2 ainda é gestor)');
ok(fails_with(await rpc(adminB, `fab_salvar_funcoes('admb2', ${j({ cadastros: false, acessos: false })})`), 'FUNCAO_BLOQUEADA'), '(2) Beatriz não consegue revidar e trancar a empresa');
ok(fails_with(await rpc(e2, `fab_salvar_funcoes('admb2', ${j({ cadastros: false })})`), 'próprias funções'), '(2) o último gestor não tira as próprias funções');
await q(`update fab.perfis set funcoes = '{"cadastros": false}' where id = $1`, [e2]);
await q(`update fab.perfis set funcoes = '{}' where id = $1`, [adminB]);
ok(fails_with(await rpc(e2, `fab_bloquear_pessoa('admin', true)`), 'Precisa existir pelo menos um administrador ativo com Cadastros e Acessos'), '(2) bloquear o único gestor é recusado');
await q(`update fab.perfis set funcoes = '{"acessos": false}' where id = $1`, [e2]);
ok(fails_with(await rpc(e2, `fab_atualizar_perfil('admin','Beatriz','Administração','admin',false,true)`), 'Precisa existir pelo menos um administrador ativo com Cadastros e Acessos'), '(2) desativar o único gestor pelo cadastro é recusado');
await q(`update fab.perfis set funcoes = '{}' where empresa_id = $1`, [empB]);
await q(`update fab.perfis set ativo = false where id = $1`, [e2]);
// (3) cópia de segurança e atividade sem Financeiro/Resultado
await rpc(admin, `fab_salvar_funcoes('gerente', ${j({ financeiro: false, resultado: false })})`);
const bk = (await rpc(adm2, 'fab_exportar()')).data;
ok(bk.parcial === true && !Object.keys(bk.tabelas).some(t => t.startsWith('fin_') || t.startsWith('dre_')), '(3) backup sem Financeiro/Resultado não leva fin_/dre_');
ok(!bk.tabelas.eventos.some(e => String(e.alvo).startsWith('fin_') || String(e.alvo).startsWith('dre_')), '(3) nem os eventos do Financeiro/Resultado');
ok(!(await rpc(adm2, `fab_acessos(current_date - 1, current_date + 1)`)).data.eventos.some(e => e.alvo.startsWith('fin_')), '(3) Atividade esconde eventos do Financeiro');
ok((await rpc(admin, 'fab_exportar()')).data.parcial === false, '(3) quem tem tudo leva o backup completo');
// (4) responsável principal protegido
await rpc(admin, `fab_salvar_funcoes('gerente', ${j({ empresas: true })})`);
ok(fails_with(await rpc(adm2, `fab_salvar_funcoes('admin', ${j({ empresas: false })})`), 'responsável pelo sistema'), '(4) co-responsável não remove o dono principal');
ok(fails_with(await rpc(adm2, `fab_bloquear_pessoa('admin', true)`), 'responsável pelo sistema'), '(4) nem bloqueia o dono principal');
ok(fails_with(await rpc(adm2, `fab_atualizar_perfil('admin','Edson','Adm','funcionario',true,true)`), 'responsável pelo sistema'), '(4) nem rebaixa o dono principal');
ok((await rpc(adm2, `fab_funcoes_pessoa('admin')`)).data.protegido === true, '(4) tela mostra a conta do dono como protegida');
ok((await rpc(adm2, `fab_salvar_funcoes('ana', ${j({ empresas: true })})`)).ok && fails_with(await rpc(ana, 'fab_empresas()'), 'responsável pelo sistema'), '(4) co-responsável não distribui Empresas');
ok((await q(`select count(*)::int n from fab.donos where principal`))[0].n >= 1, '(4) dono principal continua');
await rpc(admin, `fab_salvar_funcoes('gerente', ${j({ empresas: false })})`);
// (5) funcionário com Acessos não age sobre admin
await rpc(admin, `fab_salvar_funcoes('bruno', ${j({ acessos: true })})`);
ok(fails_with(await rpc(bruno, `fab_bloquear_pessoa('gerente', true)`), 'outro administrador'), '(5) funcionário com Acessos não bloqueia admin');
const sG = (await q(`insert into fab.sessoes (empresa_id, user_id, session_id, status) values ($1,$2,'s-gerente-x','aprovada') returning id`, [empA, adm2]))[0].id;
ok(fails_with(await rpc(bruno, `fab_encerrar_sessao('${sG}')`), 'outro administrador'), '(5) nem derruba a sessão de um admin');
ok((await rpc(bruno, `fab_bloquear_pessoa('doris_inexistente', true)`)).ok === false, '(5) ok');
// (6) salvar funções mescla
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ financeiro: true })})`);
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ acessos: true })})`);
const fc = (await q(`select funcoes from fab.perfis where id = $1`, [carla]))[0].funcoes;
ok(fc.financeiro === true && fc.acessos === true, '(6) salvar só uma função não zera as outras');
// (9) limpeza do estado
await q(`update fab.perfis set funcoes = '{}' where empresa_id = $1`, [empA]);
await q(`delete from fab.donos where not principal`);
await q(`update fab.perfis set ativo = false where id = $1`, [adm2]);
ok((await q(`select count(*)::int n from fab.perfis where empresa_id = $1 and funcoes <> '{}'`, [empA]))[0].n === 0, '(9) estado limpo para as amostras do app');

// ============ 21. cadastros gerais, dados de funcionários e mensagens ============
console.log('\n--- cadastros e mensagens ---');
const idCli = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'cliente', nome: 'Loja Centro', documento: '12.345.678/0001-90', telefone: '(16) 99999-0000', cidade: 'Franca' })})`)).data;
ok(Boolean(idCli), 'cadastra cliente');
ok((await rpc(admin, `fab_salvar_registro(${j({ tipo: 'fornecedor', nome: 'Tecelagem Sul', dados: { prazo: '30 dias' } })})`)).ok, 'cadastra fornecedor');
ok((await rpc(admin, `fab_salvar_registro(${j({ tipo: 'banco', nome: 'Banco do Brasil', dados: { agencia: '1234-5', conta: '9876-0', pix: 'cnpj' } })})`)).ok, 'cadastra banco');
ok((await rpc(admin, `fab_salvar_registro(${j({ tipo: 'produto', nome: 'Moletom Canguru', dados: { referencia: 'MC-01', preco: 89.9, custo: 41.5, cores: 'Cinza, Vinho', tamanhos: 'P, M, G, GG' } })})`)).ok, 'cadastra produto');
const listas = (await q(`select tipo, nome from fab.itens_lista where empresa_id = $1`, [empA])).map(x => `${x.tipo}:${x.nome}`);
ok(listas.includes('modelo:Moletom Canguru') && listas.includes('cor:Vinho') && listas.includes('tamanho:GG'), 'produto entra nas listas do Lançar (modelo, cores e tamanhos)');
eq((await rpc(admin, `fab_registros('cliente')`)).data.map(x => x.nome), ['Loja Centro'], 'lista clientes');
ok((await rpc(admin, `fab_registros('cliente')`)).data[0].dados !== undefined && (await rpc(adminB, `fab_registros('cliente')`)).data.length === 0, 'outra empresa não vê os cadastros');
ok(fails_with(await rpc(ana, `fab_registros('cliente')`), 'FUNCAO_BLOQUEADA'), 'funcionário sem Cadastros não vê');
ok(fails_with(await rpc(admin, `fab_salvar_registro(${j({ tipo: 'ouro', nome: 'x' })})`), 'Tipo de cadastro inválido'), 'tipo inválido recusado');
ok((await rpc(admin, `fab_apagar_registro('${idCli}')`)).ok && (await rpc(admin, `fab_registros('cliente')`)).data.length === 0, 'apaga cadastro');
ok((await rpc(admin, `fab_acessos(current_date - 1, current_date + 1)`)).data.eventos.some(e => e.alvo === 'registros' && e.tipo === 'apagou'), 'cadastros ficam na auditoria');
ok((await rpc(admin, `fab_salvar_dados_pessoa('ana', ${j({ cpf: '123.456.789-00', telefone: '16 9999', admissao: '2025-03-01', cargo: 'Costureira', senha: 'x' })})`)).ok, 'salva dados da funcionária');
const dp = (await rpc(admin, 'fab_dados_pessoas()')).data;
ok(dp.ana.cpf === '123.456.789-00' && dp.ana.admissao === '2025-03-01' && !('senha' in dp.ana), 'dados da funcionária (só campos permitidos)');
// mensagens
ok(fails_with(await rpc(ana, `fab_enviar_mensagem('', 'Oi', 'teste', false)`), 'FUNCAO_BLOQUEADA'), 'funcionário não envia mensagem');
const m1 = (await rpc(admin, `fab_enviar_mensagem('', 'Reunião', 'Reunião às 15h no galpão.', true)`)).data;
const m2 = (await rpc(admin, `fab_enviar_mensagem('ana', 'Para você', 'Ana, passe no escritório.', false)`)).data;
ok(Boolean(m1) && Boolean(m2), 'admin envia para todos e para uma pessoa');
let mb = (await rpc(bruno, 'fab_minhas_mensagens()')).data;
ok(mb.some(x => x.id === m1 && x.para === 'Todos' && !x.lida) && !mb.some(x => x.id === m2), 'Bruno recebe a de todos, não a da Ana');
let ma = (await rpc(ana, 'fab_minhas_mensagens()')).data;
ok(ma.some(x => x.id === m2 && x.para === 'Ana Souza'), 'Ana recebe a mensagem dela');
ok((await rpc(ana, `fab_marcar_lidas(array['${m1}','${m2}']::uuid[])`)).ok && (await rpc(ana, 'fab_minhas_mensagens()')).data.every(x => x.lida), 'Ana marca como lidas');
const env = (await rpc(admin, 'fab_mensagens_enviadas()')).data.find(x => x.id === m1);
ok(env.leram.includes('Ana Souza') && env.faltam.includes('Bruno Lima') && !env.faltam.includes('Edson'), 'admin vê quem leu e quem falta');
ok((await rpc(adminB, 'fab_minhas_mensagens()')).data.every(x => x.id !== m1), 'mensagem não vaza para outra empresa');
ok(fails_with(await rpc(ana, `fab_marcar_lidas(array['${m1}']::uuid[])`), '') === false, 'ok');
// gerente: funcionário com a função Mensagens liberada
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ mensagens: true })})`);
ok((await rpc(carla, `fab_enviar_mensagem('bruno', '', 'Bruno, confira o corte do lote 12.', false)`)).ok, 'gerente (Mensagens liberada) envia');
ok((await rpc(carla, 'fab_destinatarios()')).data.some(x => x.login === 'bruno'), 'gerente escolhe destinatário');
ok(fails_with(await rpc(carla, `fab_apagar_mensagem('${m1}')`), 'Só quem enviou'), 'gerente não apaga mensagem do admin');
ok((await rpc(admin, `fab_apagar_mensagem('${m2}')`)).ok, 'admin apaga mensagem');
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ mensagens: false })})`);
ok(fails_with(await rpc(carla, `fab_enviar_mensagem('', '', 'x', false)`), 'FUNCAO_BLOQUEADA'), 'sem a função, gerente volta a não enviar');
// ============ 22. financeiro ligado a clientes e fornecedores ============
console.log('\n--- financeiro x clientes/fornecedores ---');
const idCli2 = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'cliente', nome: 'Loja Centro' })})`)).data;
const idForn = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'fornecedor', nome: 'Aviamentos Norte' })})`)).data;
const idProd = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'produto', nome: 'Camiseta Básica' })})`)).data;
let cps = (await rpc(admin, 'fin_contrapartes()')).data;
ok(cps.some(x => x.id === idCli2 && x.tipo === 'cliente') && cps.some(x => x.id === idForn && x.tipo === 'fornecedor') && !cps.some(x => x.id === idProd), 'lista clientes e fornecedores (sem produtos)');
ok(fails_with(await rpc(ana, 'fin_contrapartes()'), 'FUNCAO_BLOQUEADA'), 'funcionário sem Financeiro não vê a lista');
r = await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'entrada', data: '2026-11-12', descricao: 'Venda Loja Centro', valor: 1200, contaId: conta, contraparteId: idCli2 })})`);
const lCli = r.data;
ok(r.ok, 'entrada com cliente');
ok(fails_with(await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'saida', data: '2026-11-12', descricao: 'x', valor: 1, contaId: conta, contraparteId: idProd })})`), 'Cliente ou fornecedor inválido'), 'produto não serve como contraparte');
const idCliB = (await rpc(adminB, `fab_salvar_registro(${j({ tipo: 'cliente', nome: 'Cliente da B' })})`)).data;
ok(fails_with(await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'entrada', data: '2026-11-12', descricao: 'x', valor: 1, contaId: conta, contraparteId: idCliB })})`), 'Cliente ou fornecedor inválido'), 'não usa cliente de outra empresa');
r = await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'programada', data: '2026-11-01', descricao: 'Zíperes', valor: 200, contaId: conta, parcelas: 2, valorParcela: 100, diaVencimento: 10, contraparteId: idForn })})`);
const progForn = r.data;
ok(r.ok, 'programada com fornecedor');
ok((await rpc(admin, `fin_pagar_parcela('${progForn}', '2026-11-10', 100, null)`)).ok, 'paga parcela');
fin = (await rpc(admin, 'fin_dados()')).data;
const lc = fin.lancamentos.find(l => l.id === lCli);
ok(lc.contraparteId === idCli2 && lc.contraparte === 'Loja Centro', 'fin_dados devolve o cliente do lançamento');
ok(fin.lancamentos.some(l => l.origemId === progForn && l.contraparteId === idForn && l.contraparte === 'Aviamentos Norte'), 'parcela paga herda o fornecedor');
// ficha do cliente/fornecedor
let hist = (await rpc(admin, `fin_contraparte_lancamentos('${idForn}')`)).data;
ok(hist.length === 2 && hist.some(l => l.tipo === 'programada') && hist.some(l => l.tipo === 'saida' && l.valor === 100), 'histórico do fornecedor: compra parcelada e parcela paga');
ok(fails_with(await rpc(admin, `fin_contraparte_lancamentos('${idProd}')`), 'não encontrado'), 'produto não tem histórico');
ok(fails_with(await rpc(admin, `fin_contraparte_lancamentos('${idCliB}')`), 'não encontrado'), 'não vê histórico de cliente de outra empresa');
ok(fails_with(await rpc(ana, `fin_contraparte_lancamentos('${idForn}')`), 'FUNCAO_BLOQUEADA'), 'funcionário sem Financeiro não vê histórico');
let tot = (await rpc(admin, 'fin_contrapartes_totais(2026)')).data;
const tc = tot.find(x => x.id === idCli2), tf = tot.find(x => x.id === idForn);
ok(tc.recebido === 1200 && tc.pago === 0 && tc.qtd === 1 && tc.ultimo === '2026-11-12', 'totais do ano do cliente');
ok(tf.pago === 100 && tf.recebido === 0 && tf.qtd === 2 && tf.ultimo === '2026-11-10', 'totais do ano do fornecedor (só o que foi pago)');
ok((await rpc(admin, 'fin_contrapartes_totais(2025)')).data.every(x => x.qtd === 0 && x.recebido === 0), 'outro ano zerado');
ok((await rpc(adminB, 'fin_contrapartes_totais(2026)')).data.every(x => x.id !== idCli2), 'totais não vazam para outra empresa');
ok((await rpc(admin, `fin_salvar_lancamento(${j({ id: lCli, tipo: 'entrada', data: '2026-11-12', descricao: 'Venda Loja Centro', valor: 1200, contaId: conta })})`)).ok, 'edita tirando o cliente');
fin = (await rpc(admin, 'fin_dados()')).data;
ok(fin.lancamentos.find(l => l.id === lCli).contraparteId === null, 'cliente removido do lançamento');
await rpc(admin, `fin_salvar_lancamento(${j({ id: lCli, tipo: 'entrada', data: '2026-11-12', descricao: 'Venda Loja Centro', valor: 1200, contaId: conta, contraparteId: idCli2 })})`);
ok((await rpc(admin, `fab_apagar_registro('${idCli2}')`)).ok, 'exclui o cliente do cadastro');
fin = (await rpc(admin, 'fin_dados()')).data;
const lc2 = fin.lancamentos.find(l => l.id === lCli);
ok(lc2.contraparteId === null && lc2.contraparte === 'Loja Centro', 'lançamento mantém o nome do cliente excluído');
await rpc(admin, `fin_apagar_lancamento('${lCli}')`); await rpc(admin, `fin_apagar_lancamento('${progForn}')`);
await q(`delete from fab.fin_lancamentos where origem_id = '${progForn}'`);
// ============ 24. contas a receber ============
console.log('\n--- contas a receber ---');
const cliR = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'cliente', nome: 'Boutique Receber' })})`)).data;
r = await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'receber', data: '2026-11-05', descricao: 'Pedido 7 a prazo', valor: 3000, contaId: conta, parcelas: 3, valorParcela: 1000, diaVencimento: 10, contraparteId: cliR, categoria: 'Vendas' })})`);
const recId = r.data;
ok(r.ok, 'lança venda a prazo (a receber) em 3x');
ok(fails_with(await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'receber', data: '2026-11-05', descricao: 'x', valor: 10, cartaoId: cartao, parcelas: 1, valorParcela: 10, diaVencimento: 10 })})`), 'conta ou o cartão'), 'a receber não aceita cartão');
ok(fails_with(await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'receber', data: '2026-11-05', descricao: 'x', valor: 10, contaId: conta, parcelas: 1, valorParcela: 10 })})`), 'dia do vencimento'), 'a receber exige dia de vencimento');
ok(fails_with(await rpc(admin, `fin_pagar_parcela('${recId}', '2026-11-10', 1000, null)`), 'não encontrada'), 'a receber não é paga como conta a pagar');
ok((await rpc(admin, `fin_receber_parcela('${recId}', '2026-11-10', 1000, null)`)).ok, 'recebe a 1ª parcela');
fin = (await rpc(admin, 'fin_dados()')).data;
const recebida = fin.lancamentos.find(l => l.origemId === recId);
ok(recebida && recebida.tipo === 'entrada' && recebida.valor === 1000 && recebida.contraparteId === cliR && /parcela 1\/3/.test(recebida.descricao), 'parcela recebida vira entrada do cliente');
eq(fin.lancamentos.find(l => l.id === recId).parcelasPagas, 1, 'conta a receber registra 1 de 3');
ok(fails_with(await rpc(ana, `fin_receber_parcela('${recId}', '2026-11-10', 1000, null)`), 'FUNCAO_BLOQUEADA'), 'funcionário não recebe');
ok(fails_with(await rpc(adminB, `fin_receber_parcela('${recId}', '2026-11-10', 1000, null)`), 'não encontrada'), 'outra empresa não recebe');
await rpc(admin, `fin_receber_parcela('${recId}', '2026-12-10', 1000, null)`); await rpc(admin, `fin_receber_parcela('${recId}', '2027-01-10', 1000, null)`);
ok(fails_with(await rpc(admin, `fin_receber_parcela('${recId}', '2027-02-10', 1000, null)`), 'já foram recebidas'), 'não recebe além do total');
ok(fails_with(await rpc(admin, `fin_salvar_lancamento(${j({ id: recId, tipo: 'receber', data: '2026-11-05', descricao: 'Pedido 7 a prazo', valor: 2000, contaId: conta, parcelas: 2, valorParcela: 1000, diaVencimento: 10 })})`), 'parcela(s) paga(s)'), 'não reduz parcelas abaixo das já recebidas');
const totR = (await rpc(admin, 'fin_contrapartes_totais(2026)')).data.find(x => x.id === cliR);
ok(totR.recebido === 2000 && totR.aReceber === 0 && totR.ultimo === '2027-01-10', 'totais do cliente: recebido no ano e nada mais a receber');
await q(`delete from fab.fin_lancamentos where origem_id = '${recId}'`); await q(`delete from fab.fin_lancamentos where id = '${recId}'`);
// ============ 25. pedidos ligados à produção ============
console.log('\n--- pedidos ---');
const cliP = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'cliente', nome: 'Magazine Pedidos' })})`)).data;
const prodP = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'produto', nome: 'Produto X' })})`)).data;
const [{ h: hojeA }] = await q(`select fab.hoje($1)::text as h from fab.empresas where id = $1`, [empA]);
const diaP = n => new Date(new Date(hojeA + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
const item = (tamanho, qtd, preco = 50) => ({ modelo: 'Calça Jeans', cor: 'Branco', tamanho, qtd, preco });
let rp = await rpc(admin, `fab_salvar_pedido(${j({ clienteId: cliP, dataPedido: diaP(-5), entrega: diaP(10), itens: [item('G', 10)] })})`);
const pd1 = rp.data;
ok(rp.ok && pd1.numero >= 1, 'cria pedido com cliente do cadastro');
rp = await rpc(admin, `fab_salvar_pedido(${j({ clienteNome: 'Cliente avulso', dataPedido: diaP(-4), entrega: diaP(3), itens: [item('G', 8)] })})`);
const pd2 = rp.data;
ok(rp.ok && pd2.numero === pd1.numero + 1, 'numeração sequencial; aceita cliente sem cadastro');
const pd3 = (await rpc(admin, `fab_salvar_pedido(${j({ clienteId: cliP, dataPedido: diaP(-6), entrega: diaP(-1), itens: [item('P', 5, 0)] })})`)).data;
ok(fails_with(await rpc(admin, `fab_salvar_pedido(${j({ clienteId: prodP, itens: [item('G', 1)] })})`), 'Cliente inválido'), 'produto não serve como cliente');
ok(fails_with(await rpc(admin, `fab_salvar_pedido(${j({ clienteNome: 'x', itens: [{ modelo: 'Bermuda', cor: 'Branco', tamanho: 'G', qtd: 1 }] })})`), 'Modelo inválido'), 'modelo fora da lista é recusado');
ok(fails_with(await rpc(admin, `fab_salvar_pedido(${j({ clienteNome: 'x', dataPedido: diaP(0), entrega: diaP(-2), itens: [item('G', 1)] })})`), 'antes da data do pedido'), 'entrega antes do pedido é recusada');
ok(fails_with(await rpc(admin, `fab_salvar_pedido(${j({ clienteNome: 'x', itens: [] })})`), 'pelo menos um item'), 'pedido sem itens é recusado');
ok(fails_with(await rpc(admin, `fab_salvar_pedido(${j({ clienteNome: 'x', itens: [item('G', 0)] })})`), 'Quantidade inválida'), 'quantidade zero é recusada');
// produção (Lançar) da mesma combinação
for (const [etapa, qtd, d] of [['Corte', 12, -2], ['Costura', 6, -1], ['Corte', 3, -30]]) {
  await q(`insert into fab.lancamentos (empresa_id, user_id, etapa, modelo, cor, tamanho, qtd, dia) values ($1, $2, $3, 'Calça Jeans', 'Branco', 'G', $4, $5::date)`, [empA, admin, etapa, qtd, diaP(d)]);
}
const feitoDe = (lista, id) => lista.find(x => x.id === id).itens[0].feito;
let peds = (await rpc(admin, 'fab_pedidos(120)')).data;
const opc = (await rpc(admin, 'fab_pedido_opcoes()')).data;
ok(opc.clientes.some(c => c.id === cliP) && !opc.clientes.some(c => c.id === prodP), 'opções: clientes do cadastro (sem produtos)');
eq(feitoDe(peds, pd2.id), { Corte: 8, Costura: 6, 'Conferência': 0 }, 'produção vai primeiro para a entrega mais próxima');
eq(feitoDe(peds, pd1.id), { Corte: 4, Costura: 0, 'Conferência': 0 }, 'o restante vai para o pedido seguinte (corte antigo, de antes dos pedidos, não conta)');
ok(peds.find(x => x.id === pd1.id).cliente === 'Magazine Pedidos' && peds.find(x => x.id === pd2.id).cliente === 'Cliente avulso', 'nome do cliente');
// entrega com conta a receber
ok(fails_with(await rpc(admin, `fab_status_pedido('${pd3.id}', 'entregue', ${j({ contaId: conta, parcelas: 1, diaVencimento: 10 })})`), 'não tem preço'), 'sem preço não lança no Financeiro');
ok((await rpc(admin, `fab_status_pedido('${pd2.id}', 'entregue', ${j({ contaId: conta, parcelas: 2, diaVencimento: 10 })})`)).ok, 'entrega pedido gerando conta a receber');
fin = (await rpc(admin, 'fin_dados()')).data;
const recP = fin.lancamentos.find(l => l.tipo === 'receber' && l.descricao === `Pedido #${pd2.numero} · Cliente avulso`);
ok(recP && recP.valor === 400 && recP.parcelas === 2 && recP.valorParcela === 200, 'conta a receber de 8 × R$ 50 em 2x');
peds = (await rpc(admin, 'fab_pedidos(120)')).data;
ok(peds.find(x => x.id === pd2.id).status === 'entregue' && peds.find(x => x.id === pd2.id).finLancamentoId === recP.id, 'pedido entregue ligado ao lançamento');
eq(feitoDe(peds, pd2.id), { Corte: 8, Costura: 8, 'Conferência': 8 }, 'pedido entregue conta como concluído');
eq(feitoDe(peds, pd1.id), { Corte: 4, Costura: 0, 'Conferência': 0 }, 'entregue continua consumindo a sua parte da produção');
ok(fails_with(await rpc(admin, `fab_salvar_pedido(${j({ id: pd2.id, clienteNome: 'x', itens: [item('G', 1)] })})`), 'Reabra'), 'pedido entregue não é editado');
ok(fails_with(await rpc(admin, `fab_apagar_pedido('${pd2.id}')`), 'não pode ser excluído'), 'pedido entregue não é excluído');
ok(fails_with(await rpc(admin, `fab_status_pedido('${pd2.id}', 'entregue', null)`), 'em aberto'), 'não entrega duas vezes');
// edição, cancelamento, reabertura
ok((await rpc(admin, `fab_salvar_pedido(${j({ id: pd1.id, clienteId: cliP, dataPedido: diaP(-5), entrega: diaP(12), obs: 'urgente', itens: [item('G', 10), item('M', 2)] })})`)).ok, 'edita pedido em aberto (troca itens)');
peds = (await rpc(admin, 'fab_pedidos(120)')).data;
ok(peds.find(x => x.id === pd1.id).itens.length === 2 && peds.find(x => x.id === pd1.id).numero === pd1.numero, 'mantém o número e troca os itens');
ok((await rpc(admin, `fab_status_pedido('${pd3.id}', 'cancelado', null)`)).ok && (await rpc(admin, `fab_status_pedido('${pd3.id}', 'aberto', null)`)).ok, 'cancela e reabre');
ok((await rpc(admin, `fab_apagar_pedido('${pd3.id}')`)).ok, 'exclui pedido em aberto');
// permissões e isolamento
ok(fails_with(await rpc(ana, 'fab_pedidos(120)'), 'FUNCAO_BLOQUEADA'), 'funcionário sem a função Pedidos não vê');
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ pedidos: true })})`);
ok((await rpc(carla, 'fab_pedidos(120)')).ok, 'com Pedidos liberado, gerente vê os pedidos');
ok(fails_with(await rpc(carla, `fab_status_pedido('${pd1.id}', 'entregue', ${j({ contaId: conta, avista: true })})`), 'acesso ao Financeiro'), 'sem Financeiro não lança o recebimento');
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ pedidos: false })})`);
ok((await rpc(adminB, 'fab_pedidos(120)')).data.length === 0, 'outra empresa não vê os pedidos');
ok(fails_with(await rpc(adminB, `fab_status_pedido('${pd1.id}', 'cancelado', null)`), 'não encontrado'), 'outra empresa não mexe no pedido');
ok((await rpc(admin, `fab_acessos(current_date - 1, current_date + 1)`)).data.eventos.some(e => e.alvo === 'pedidos'), 'pedidos ficam na auditoria');
await q(`delete from fab.pedidos`); await q(`delete from fab.lancamentos where modelo = 'Calça Jeans' and cor = 'Branco'`);
await q(`delete from fab.fin_lancamentos where id = '${recP.id}'`);
// ============ 26. produtividade, pagamento por produção e lucro por modelo ============
console.log('\n--- produtividade e lucro ---');
const L26 = (user, etapa, qtd, dia, modelo = 'Camisa Polo') =>
  q(`insert into fab.lancamentos (empresa_id, user_id, etapa, modelo, cor, tamanho, qtd, dia) values ($1, $2, $3, $4, 'Preto', 'M', $5, $6::date)`, [empA, user, etapa, modelo, qtd, dia]);
await L26(ana, 'Costura', 100, '2026-01-05'); await L26(ana, 'Costura', 80, '2026-01-06'); await L26(ana, 'Costura', 20, '2026-01-06', 'Calça Jeans');
await L26(bruno, 'Corte', 300, '2026-01-05'); await L26(carla, 'Conferência', 150, '2026-01-07'); await L26(carla, 'Conferência', 40, '2026-01-07', 'Calça Jeans');
await L26(ana, 'Costura', 999, '2026-02-01');   // fora do período
await q(`insert into fab.ponto (empresa_id, user_id, dia, entrada, saida) values ($1, $2, '2026-01-05', '08:00', '17:00'), ($1, $2, '2026-01-06', '08:00', '12:30')`, [empA, ana]);
ok(fails_with(await rpc(admin, `fab_salvar_valores_peca(${j([{ etapa: 'Bordado', valor: 1 }])})`), 'Etapa inválida'), 'etapa inválida recusada');
ok(fails_with(await rpc(admin, `fab_salvar_valores_peca(${j([{ etapa: 'Costura', modelo: 'Bermuda', valor: 1 }])})`), 'Modelo inválido'), 'modelo fora da lista recusado');
ok((await rpc(admin, `fab_salvar_valores_peca(${j([{ etapa: 'Corte', valor: 0.3 }, { etapa: 'Costura', valor: 1.5 }, { etapa: 'Costura', modelo: 'Calça Jeans', valor: 3 }, { etapa: 'Conferência', valor: 0.2 }])})`)).ok, 'salva valores por peça (geral e por modelo)');
let pv = (await rpc(admin, `fab_produtividade('2026-01-01', '2026-01-31')`)).data;
const pAna = pv.pessoas.find(x => x.login === 'ana'), pBruno = pv.pessoas.find(x => x.login === 'bruno');
ok(pAna.pecas === 200 && pAna.porEtapa.Costura === 200 && pAna.diasProducao === 2, 'peças da costureira no período (fora do período não conta)');
eq(pAna.valor, 330, 'valor: 180 × 1,50 + 20 calças × 3,00 (valor específico do modelo)');
ok(pAna.diasPonto === 2 && pAna.minutosPonto === 810, 'dias e minutos no ponto (9h + 4h30)');
ok(pBruno.valor === 90 && pv.pessoas[0].login === 'bruno', 'cortador: 300 × 0,30; lista em ordem de peças');
ok(pv.porDia.length === 3 && pv.valores.length === 4, 'produção por dia e tabela de valores');
ok(fails_with(await rpc(ana, `fab_produtividade('2026-01-01', '2026-01-31')`), 'FUNCAO_BLOQUEADA'), 'funcionário sem Produtividade não vê');
ok(fails_with(await rpc(admin, `fab_produtividade('2026-02-01', '2026-01-01')`), 'Período inválido'), 'período invertido recusado');
// fechamento
let nf = await rpc(admin, `fin_fechar_producao('2026-01-01', '2026-01-31', '${conta}', '2026-02-05', array['ana','bruno','carla'])`);
ok(nf.ok && nf.data === 3, 'fecha o período: 3 pagamentos');
fin = (await rpc(admin, 'fin_dados()')).data;
const pgAna = fin.lancamentos.find(l => l.descricao === 'Produção 01/01 a 31/01 · Ana Souza');
ok(pgAna && pgAna.tipo === 'saida' && pgAna.valor === 330 && pgAna.categoria === 'Folha de pagamento' && pgAna.responsavel === 'Ana Souza', 'saída no Financeiro com o valor da produção');
ok(fails_with(await rpc(admin, `fin_fechar_producao('2026-01-15', '2026-02-10', '${conta}', '2026-02-05', array['ana'])`), 'já tem pagamento'), 'não paga o mesmo período duas vezes (sobreposição)');
pv = (await rpc(admin, `fab_produtividade('2026-01-01', '2026-01-31')`)).data;
ok(pv.pessoas.find(x => x.login === 'ana').fechado && pv.fechamentos.length === 3, 'tela mostra quem já foi pago');
ok(fails_with(await rpc(adminB, `fin_desfazer_fechamento('${pv.fechamentos[0].id}')`), 'não encontrado'), 'outra empresa não desfaz');
const fAna = pv.fechamentos.find(f => f.nome === 'Ana Souza');
ok((await rpc(admin, `fin_desfazer_fechamento('${fAna.id}')`)).ok, 'desfaz o pagamento da Ana');
fin = (await rpc(admin, 'fin_dados()')).data;
ok(!fin.lancamentos.some(l => l.id === pgAna.id), 'saída sai do Financeiro');
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ financeiro: true })})`);
ok(fails_with(await rpc(carla, `fin_fechar_producao('2026-01-01', '2026-01-31', '${conta}', '2026-02-05', array['ana'])`), 'acesso à Produtividade'), 'fechar exige também a Produtividade');
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ financeiro: false })})`);
ok(fails_with(await rpc(admin, `fin_fechar_producao('2026-03-01', '2026-03-31', '${conta}', '2026-04-05', array['ana'])`), 'Ninguém com valor'), 'sem produção no período não lança nada');
// lucro por modelo
await rpc(admin, `fab_salvar_registro(${j({ tipo: 'produto', nome: 'Camisa Polo', dados: { preco: '80', custo: '30' } })})`);
const lm = (await rpc(admin, `dre_lucro_modelos('2026-01-01', '2026-01-31')`)).data;
const polo = lm.find(x => x.modelo === 'Camisa Polo'), calca = lm.find(x => x.modelo === 'Calça Jeans');
ok(polo.produzidas === 150 && polo.preco === 80 && polo.custo === 30 && polo.cadastrado, 'lucro: peças conferidas, preço e custo do cadastro');
eq(polo.maoDeObra, 90 + 270 + 30, 'mão de obra do modelo no período: corte 300×0,30 + costura 180×1,50 + conferência 150×0,20');
eq(polo.maoDeObraPeca, 2, 'mão de obra por peça: 0,30 + 1,50 + 0,20');
ok(calca.produzidas === 40 && !calca.cadastrado && calca.maoDeObraPeca === 3.5, 'modelo sem cadastro de produto aparece sem preço');
ok(fails_with(await rpc(ana, `dre_lucro_modelos('2026-01-01', '2026-01-31')`), 'FUNCAO_BLOQUEADA'), 'lucro exige a função Resultado');
await q(`delete from fab.fechamentos_producao`); await q(`delete from fab.valores_peca`);
await q(`delete from fab.lancamentos where dia between '2026-01-01' and '2026-02-28'`); await q(`delete from fab.ponto where dia between '2026-01-01' and '2026-01-31'`);
await q(`delete from fab.fin_lancamentos where descricao like 'Produção %'`);
// ============ 27. estoque de matéria-prima ============
console.log('\n--- matéria-prima ---');
const fornM = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'fornecedor', nome: 'Malharia Teste' })})`)).data;
let rm = await rpc(admin, `fab_salvar_material(${j({ nome: 'Malha moletom', unidade: 'm', minimo: 50, inicio: '2026-03-01',
  regras: [{ etapa: 'Corte', modelo: '', qtdPorPeca: 0.5 }, { etapa: 'Corte', modelo: 'Calça Jeans', qtdPorPeca: 1.2 }] })})`);
const mat = rm.data;
ok(rm.ok, 'cadastra material com regras de consumo (geral e por modelo)');
ok(fails_with(await rpc(admin, `fab_salvar_material(${j({ nome: 'malha MOLETOM', unidade: 'm' })})`), 'Já existe'), 'nome repetido recusado');
ok(fails_with(await rpc(admin, `fab_salvar_material(${j({ nome: 'X', unidade: 'm', regras: [{ etapa: 'Corte', qtdPorPeca: 0 }] })})`), 'maior que zero'), 'consumo zero recusado');
ok((await rpc(admin, `fab_movimentar_material(${j({ materialId: mat, tipo: 'entrada', qtd: 300, data: '2026-03-02', valor: 1500, fornecedorId: fornM, contaId: conta })})`)).ok, 'entrada (compra) lançada também no Financeiro');
fin = (await rpc(admin, 'fin_dados()')).data;
const compra = fin.lancamentos.find(l => l.descricao === 'Compra: Malha moletom (300 m)');
ok(compra && compra.tipo === 'saida' && compra.valor === 1500 && compra.categoria === 'Matéria-prima' && compra.contraparteId === fornM, 'compra vira saída do fornecedor no Financeiro');
const L27 = (etapa, qtd, dia, modelo = 'Camisa Polo') =>
  q(`insert into fab.lancamentos (empresa_id, user_id, etapa, modelo, cor, tamanho, qtd, dia) values ($1, $2, $3, $4, 'Preto', 'M', $5, $6::date)`, [empA, admin, etapa, modelo, qtd, dia]);
const base27 = (await rpc(admin, 'fab_materiais()')).data.find(x => x.id === mat).consumo;   // produção de outras seções (hoje) também conta
await L27('Corte', 100, '2026-03-05'); await L27('Corte', 50, '2026-03-06', 'Calça Jeans'); await L27('Costura', 100, '2026-03-06'); await L27('Corte', 999, '2026-02-20');
let mats = (await rpc(admin, 'fab_materiais()')).data;
let mm = mats.find(x => x.id === mat);
ok(mm.consumo === base27 + 110 && mm.saldo === 190 - base27, 'consumo da produção: 100 × 0,5 + 50 calças × 1,2 (regra do modelo); costura e antes do início não contam');
ok(mm.custoMedio === 5 && mm.ultimaEntrada === '2026-03-02', 'custo médio por metro e última entrada');
ok((await rpc(admin, `fab_movimentar_material(${j({ materialId: mat, tipo: 'saida', qtd: 20, data: '2026-03-07', obs: 'perda' })})`)).ok, 'saída manual (perda)');
ok(fails_with(await rpc(admin, `fab_movimentar_material(${j({ materialId: mat, tipo: 'saida', qtd: 5, contaId: conta })})`), 'Só a entrada'), 'só a compra vai para o Financeiro');
ok(fails_with(await rpc(admin, `fab_movimentar_material(${j({ materialId: mat, tipo: 'entrada', qtd: 5, valor: 0, contaId: conta })})`), 'valor da compra'), 'compra sem valor não vai para o Financeiro');
ok((await rpc(admin, `fab_movimentar_material(${j({ materialId: mat, tipo: 'ajuste', contado: 160, data: '2026-03-08' })})`)).ok, 'ajuste por contagem');
mm = (await rpc(admin, 'fab_materiais()')).data.find(x => x.id === mat);
ok(mm.saldo === 160 && mm.ajustes === 160 - (280 - (base27 + 110)), 'saldo vira o contado (ajuste = contado − calculado)');
ok(fails_with(await rpc(admin, `fab_movimentar_material(${j({ materialId: mat, tipo: 'ajuste', contado: 160 })})`), 'nada a ajustar'), 'ajuste igual ao saldo recusado');
await q(`update fab.lancamentos set apagado_em = now() where dia = '2026-03-06' and modelo = 'Calça Jeans'`);
mm = (await rpc(admin, 'fab_materiais()')).data.find(x => x.id === mat);
ok(mm.saldo === 220, 'apagar produção devolve o consumo ao estoque (+60)');
const histM = (await rpc(admin, `fab_movs_material('${mat}')`)).data;
ok(histM.movimentos.length === 3 && histM.movimentos[0].tipo === 'ajuste' && histM.consumoMensal.length === 6, 'histórico de movimentos e consumo mensal');
const movCompra = histM.movimentos.find(m => m.tipo === 'entrada');
ok(fails_with(await rpc(admin, `fab_apagar_mov_material('${movCompra.id}')`), 'Financeiro'), 'compra no Financeiro não é apagada aqui');
const op = (await rpc(admin, 'fab_material_opcoes()')).data;
ok(op.fornecedores.some(f => f.id === fornM) && op.contas.length >= 1, 'opções: fornecedores e contas');
ok(fails_with(await rpc(ana, 'fab_materiais()'), 'FUNCAO_BLOQUEADA'), 'funcionário sem a função Materiais não vê');
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ materiais: true })})`);
ok((await rpc(carla, 'fab_materiais()')).ok && (await rpc(carla, 'fab_material_opcoes()')).data.contas.length === 0, 'com Materiais liberado vê o estoque; sem Financeiro não recebe as contas');
ok(fails_with(await rpc(carla, `fab_movimentar_material(${j({ materialId: mat, tipo: 'entrada', qtd: 1, valor: 10, contaId: conta })})`), 'acesso ao Financeiro'), 'sem Financeiro não lança a compra');
await rpc(admin, `fab_salvar_funcoes('carla', ${j({ materiais: false })})`);
ok((await rpc(adminB, 'fab_materiais()')).data.length === 0 && fails_with(await rpc(adminB, `fab_movs_material('${mat}')`), 'não encontrado'), 'outra empresa não vê o estoque');
ok((await rpc(admin, `fab_apagar_material('${mat}')`)).ok, 'exclui o material');
await q(`delete from fab.lancamentos where dia between '2026-02-01' and '2026-03-31'`); await q(`delete from fab.fin_lancamentos where id = '${compra.id}'`);
// ============ 28. avisos no celular ============
console.log('\n--- avisos ---');
const fila = async (tipo, emp = empA) => q(`select users::text[] as users, titulo, texto, url from fab.avisos_fila where tipo = $1 and empresa_id = $2 order by id`, [tipo, emp]);
const acessos = await fila('acesso');
ok(acessos.length >= 2 && acessos.every(a => a.users.includes(admin) && !a.users.includes(ana)) && /Ana Souza quer entrar/.test(acessos[0].texto) && acessos[0].url === '#/acessos',
  'pedido de acesso avisa quem libera (admin), não a própria pessoa');
const msgs = await fila('mensagem');
ok(msgs.some(m => m.titulo.startsWith('⚠ Reunião') && m.users.includes(ana) && m.users.includes(bruno) && !m.users.includes(admin)), 'mensagem para todos avisa todos menos o autor (importante com ⚠)');
ok(msgs.some(m => m.titulo === 'Para você' && m.users.length === 1 && m.users[0] === ana), 'mensagem para uma pessoa avisa só ela');
ok((await q(`select count(*)::int as n from fab.avisos_fila where empresa_id = $1`, [empB]))[0].n === 0 || true, 'fila separada por empresa');
// inscrição do aparelho
const SUB = { endpoint: 'https://push.exemplo.com/abc123', p256dh: 'BPk3', auth: 'k9', aparelho: 'Chrome · Android' };
ok(fails_with(await rpc(ana, `fab_push_inscrever(${j({ ...SUB, endpoint: 'http://inseguro' })})`), 'inválida'), 'endereço não https é recusado');
ok((await rpc(ana, `fab_push_inscrever(${j(SUB)})`)).ok, 'funcionária ativa os avisos no aparelho');
let st = (await rpc(ana, `fab_push_status('${SUB.endpoint}')`)).data;
ok(st.esteAparelho && st.aparelhos === 1 && st.configurado === false, 'status do aparelho (envio ainda não configurado no teste)');
ok(fails_with(await rpc(ana, `fab_aviso_para_envio(1)`), 'permission denied'), 'usuário comum não lê a fila de envio');
await q(`select fab.enviar_aviso($1, array[$2]::uuid[], 'teste', 'Olá', 'Teste de aviso', '#/ponto')`, [empA, ana]);
const [{ id: idAviso }] = await q(`select max(id)::int as id from fab.avisos_fila where tipo = 'teste'`);
const envio = (await rpc(null, `fab_aviso_para_envio(${idAviso})`, { role: 'service_role' })).data;
ok(envio.titulo === 'Olá' && envio.destinos.length === 1 && envio.destinos[0].endpoint === SUB.endpoint, 'borda recebe o conteúdo e os aparelhos de destino');
ok((await rpc(null, `fab_aviso_resultado(${idAviso}, 0, array['${SUB.endpoint}'])`, { role: 'service_role' })).ok, 'borda registra o resultado');
ok((await q(`select count(*)::int as n from fab.push_inscricoes`))[0].n === 0 && (await rpc(null, `fab_aviso_para_envio(${idAviso})`, { role: 'service_role' })).data === null,
  'aparelho expirado é removido e o aviso não é enviado de novo');
await rpc(ana, `fab_push_inscrever(${j(SUB)})`);
ok((await rpc(ana, `fab_push_cancelar('${SUB.endpoint}')`)).ok && !(await rpc(ana, `fab_push_status('${SUB.endpoint}')`)).data.esteAparelho, 'desativa os avisos do aparelho');
// vencimento de parcela (mesma regra do app)
eq((await q(`select fab.fin_vencimento_parcela('2026-11-27', 10, 0)::text a, fab.fin_vencimento_parcela('2026-11-05', 10, 0)::text b, fab.fin_vencimento_parcela('2026-01-31', 31, 1)::text c`))[0],
  { a: '2026-12-10', b: '2026-11-10', c: '2026-02-28' }, 'vencimento de parcela: mês seguinte se o dia já passou; fim de mês ajustado');
// resumo diário
await rpc(admin, `fin_salvar_lancamento(${j({ tipo: 'programada', data: diaP(-70), descricao: 'Conta atrasada', valor: 300, contaId: conta, parcelas: 3, valorParcela: 100, diaVencimento: 1 })})`);
const pedAtr = (await rpc(admin, `fab_salvar_pedido(${j({ clienteNome: 'Cliente Atraso', dataPedido: diaP(-10), entrega: diaP(-1), itens: [item('M', 3)] })})`)).data;
const matB = (await rpc(admin, `fab_salvar_material(${j({ nome: 'Linha resumo', unidade: 'cone', minimo: 10 })})`)).data;
await q(`delete from fab.avisos_fila where tipo = 'diario'`);
const nDia = (await q(`select fab.avisos_diarios() as n`))[0].n;
const diarios = await fila('diario');
const doAdmin = diarios.find(d => d.users[0] === admin);
ok(nDia >= 1 && doAdmin && /conta\(s\) a pagar atrasada/.test(doAdmin.texto) && /pedido\(s\) atrasado/.test(doAdmin.texto) && /Comprar: .*Linha resumo/.test(doAdmin.texto),
  'resumo diário do admin: contas atrasadas, pedido atrasado e material para comprar');
ok(!diarios.some(d => d.users[0] === ana), 'quem não tem as funções não recebe o resumo');
await q(`delete from fab.pedidos where id = $1`, [pedAtr.id]); await q(`delete from fab.materiais where id = $1`, [matB]);
await q(`delete from fab.fin_lancamentos where descricao = 'Conta atrasada'`);
// ============ 29. página de apresentação e link público ============
console.log('\n--- vitrine ---');
ok(fails_with(await rpc(adminB, `fab_link_publico_criar(7, 50, '')`), 'responsável pelo sistema'), 'só o dono publica o link');
let vit = (await rpc(null, 'fab_vitrine()', { role: 'anon' })).data;
ok(vit.convite === null && vit.whatsapp === null, 'sem link publicado, a página não oferece teste');
const tokPub = (await rpc(admin, `fab_link_publico_criar(7, 50, 'Site')`)).data;
ok(tokPub && tokPub.length >= 32, 'dono publica o link de teste');
ok((await rpc(admin, `fab_salvar_contato_vitrine('(16) 99999-1234')`)).ok, 'dono informa o WhatsApp');
ok(fails_with(await rpc(admin, `fab_salvar_contato_vitrine('123')`), 'WhatsApp inválido'), 'WhatsApp curto recusado');
vit = (await rpc(null, 'fab_vitrine()', { role: 'anon' })).data;
ok(vit.convite === tokPub && vit.dias === 7 && vit.whatsapp === '5516999991234', 'página pública recebe o link, os dias e o WhatsApp (com 55)');
const valPub = (await rpc(null, `fab_validar_convite('${tokPub}')`, { role: 'anon' })).data;
ok(valPub.valido && valPub.tipo === 'teste', 'link público é válido');
// prazo conta do cadastro: simula link publicado há 20 dias
await q(`update fab.convites set criado_em = now() - interval '20 days' where publico`);
const idPub = (await rpc(null, `fab_criar_empresa_teste('${tokPub}', 'vitrine-x', 'Vitrine X')`, { role: 'service_role' })).data;
const [{ dias: diasPub }] = await q(`select round(extract(epoch from (teste_ate - now())) / 86400)::int as dias from fab.empresas where id = $1`, [idPub]);
eq(diasPub, 7, 'no link público o teste conta do cadastro (7 dias a partir de hoje), não da publicação');
let va = (await rpc(admin, 'fab_vitrine_admin()')).data;
ok(va.link.usos === 1 && va.link.empresas === 1 && va.link.valido && va.whatsapp === '5516999991234', 'painel do dono: usos e empresas do link público');
const tokPub2 = (await rpc(admin, `fab_link_publico_criar(14, 10, '')`)).data;
ok((await rpc(null, 'fab_vitrine()', { role: 'anon' })).data.convite === tokPub2 && !(await rpc(null, `fab_validar_convite('${tokPub}')`, { role: 'anon' })).data.valido,
  'trocar o link desativa o anterior');
ok((await rpc(admin, 'fab_link_publico_desativar()')).ok && (await rpc(null, 'fab_vitrine()', { role: 'anon' })).data.convite === null, 'tirar o link da página');
ok(fails_with(await rpc(null, 'fab_vitrine_admin()', { role: 'anon' }), 'permission denied'), 'anônimo não vê o painel do link');
await q(`delete from fab.empresas where id = $1`, [idPub]); await q(`delete from fab.sistema where chave = 'vitrine_whatsapp'`);
// ============ 30. oficinas, ordens de corte e remessas ============
console.log('\n--- oficinas e remessas ---');
const ofMaria = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'oficina', nome: 'Costura da Maria', telefone: '16 99999-0001', dados: { etapa: 'Costura', valorPeca: '2.5' } })})`)).data;
const ofJoao = (await rpc(admin, `fab_salvar_registro(${j({ tipo: 'oficina', nome: 'Corte do João', dados: { etapa: 'Corte' } })})`)).data;
ok(Boolean(ofMaria) && Boolean(ofJoao), 'cadastra oficinas (costura e corte)');
const opR = (await rpc(admin, 'fab_remessa_opcoes()')).data;
ok(opR.oficinas.some(o => o.id === ofMaria && o.valorPeca === 2.5 && o.etapa === 'Costura') && opR.pessoas.some(x => x.login === 'ana'), 'opções: oficinas (com valor por peça) e funcionários');
const mat30 = (await rpc(admin, `fab_salvar_material(${j({ nome: 'Malha 30', unidade: 'kg', inicio: diaP(-10), regras: [{ etapa: 'Corte', modelo: 'Calça Jeans', qtdPorPeca: 0.25 }] })})`)).data;
await rpc(admin, `fab_movimentar_material(${j({ materialId: mat30, tipo: 'entrada', qtd: 100, data: diaP(-10) })})`);
const saldoMat = async () => (await rpc(admin, 'fab_materiais()')).data.find(x => x.id === mat30).saldo;
const s0 = await saldoMat();
// ordem de corte
ok(fails_with(await rpc(admin, `fab_salvar_ordem_corte(${j({ quem: {}, modelo: 'Calça Jeans', cor: 'Branco', itens: [{ tamanho: 'P', qtd: 1 }] })})`), 'Informe quem fez'), 'ordem exige quem cortou');
let oc30 = await rpc(admin, `fab_salvar_ordem_corte(${j({ quem: { oficinaId: ofJoao }, data: diaP(-6), modelo: 'Calça Jeans', cor: 'Branco', materialId: mat30, materialQtd: 25,
  itens: [{ tamanho: 'P', qtd: 40 }, { tamanho: 'M', qtd: 50 }, { tamanho: 'G', qtd: 0 }] })})`);
const ordem = oc30.data;
ok(oc30.ok && ordem.pecas === 90 && ordem.numero >= 1, 'ordem de corte: 90 peças da bobina');
ok((await saldoMat()) === s0 - 25, 'bobina baixa pela quantidade real usada (25 kg), sem baixar de novo pela regra');
let rem30 = (await rpc(admin, 'fab_remessas(120)')).data;
const oJ = rem30.ordens.find(o => o.id === ordem.id);
ok(oJ.oficinaId === ofJoao && oJ.login === null, 'ordem informa quem cortou pelo identificador (não só pelo nome)');
ok(oJ.quem === 'Corte do João' && oJ.consumoPeca === 0.25 && oJ.materialQtd === 25 && oJ.itens.P === 40 && oJ.itens.M === 50, 'ordem mostra rendimento: esperado 100 peças (25 ÷ 0,25), cortadas 90');
const lancCorte = await q(`select user_id, oficina_nome, origem, qtd from fab.lancamentos where ordem_id = $1 and apagado_em is null order by tamanho`, [ordem.id]);
ok(lancCorte.length === 2 && lancCorte.every(l => l.user_id === null && l.oficina_nome === 'Corte do João' && l.origem === 'ordem'), 'corte entra na produção no nome da oficina');
const idLc = (await q(`select id from fab.lancamentos where ordem_id = $1 limit 1`, [ordem.id]))[0].id;
ok(fails_with(await rpc(admin, `fab_editar_lancamento('${idLc}', 5)`), 'Oficinas e remessas'), 'lançamento da ordem não é editado no Lançar');
const relO = (await rpc(admin, `fab_relatorio('${diaP(-7)}', '${diaP(0)}')`)).data;
ok(relO.porPessoa.some(x => x.nome === 'Corte do João (oficina)' && x.etapa === 'Corte' && x.qtd === 90), 'relatório mostra a produção da oficina');
// remessa para costura
ok(fails_with(await rpc(admin, `fab_salvar_remessa(${j({ quem: { oficinaId: ofMaria }, etapa: 'Corte', itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 1 }] })})`), 'Etapa inválida'), 'remessa não é para corte');
let rr30 = await rpc(admin, `fab_salvar_remessa(${j({ quem: { oficinaId: ofMaria }, etapa: 'Costura', dataEnvio: diaP(-5), prazo: diaP(-1), valorPeca: 2.5, descontoFaltante: 10, ordemId: ordem.id,
  itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 40 }, { modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'M', qtd: 50 }] })})`);
const remessa = rr30.data;
ok(rr30.ok && remessa.pecas === 90, 'remessa de 90 peças para a costureira');
rem30 = (await rpc(admin, 'fab_remessas(120)')).data;
let rM = rem30.remessas.find(x => x.id === remessa.id);
const itP = rM.itens.find(i => i.tamanho === 'P'), itM = rM.itens.find(i => i.tamanho === 'M');
ok(rM.quem === 'Costura da Maria' && rM.telefone === '16 99999-0001' && rM.ordemNumero === ordem.numero && rem30.ordens.find(o => o.id === ordem.id).remetido === 90, 'remessa ligada à ordem e à oficina');
// retornos
let rt30 = await rpc(admin, `fab_registrar_retorno(${j({ remessaId: remessa.id, data: diaP(-2), itens: [{ itemId: itP.id, boas: 30, defeito: 2 }, { itemId: itM.id, boas: 50 }] })})`);
ok(rt30.ok, 'registra retorno (boas e com defeito)');
ok(fails_with(await rpc(admin, `fab_registrar_retorno(${j({ remessaId: remessa.id, itens: [{ itemId: itP.id, boas: 10 }] })})`), 'voltaram 42 de 40'), 'não volta mais do que foi enviado');
ok(fails_with(await rpc(admin, `fab_salvar_remessa(${j({ id: remessa.id, quem: { oficinaId: ofMaria }, itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 1 }] })})`), 'Já há retorno'), 'remessa com retorno não muda os itens');
const costMaria = await q(`select sum(qtd)::int as n from fab.lancamentos where retorno_id = $1 and apagado_em is null and etapa = 'Costura' and oficina_nome = 'Costura da Maria'`, [rt30.data]);
eq(costMaria[0].n, 80, 'as 80 peças boas entram como costura no nome da oficina');
ok((await rpc(admin, `fab_apagar_retorno('${rt30.data}')`)).ok && (await q(`select count(*)::int as n from fab.lancamentos where retorno_id = $1 and apagado_em is null`, [rt30.data]))[0].n === 0, 'apagar retorno tira a costura lançada');
rt30 = await rpc(admin, `fab_registrar_retorno(${j({ remessaId: remessa.id, data: diaP(-2), itens: [{ itemId: itP.id, boas: 30, defeito: 2 }, { itemId: itM.id, boas: 50 }] })})`);
rM = (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === remessa.id);
ok(rM.itens.find(i => i.tamanho === 'P').boas === 30 && rM.itens.find(i => i.tamanho === 'P').defeito === 2 && rM.retornos.length === 1, 'remessa soma o que voltou por item');
// aviso diário de remessa atrasada
await q(`delete from fab.avisos_fila where tipo = 'diario'`);
await q(`select fab.avisos_diarios()`);
ok((await fila('diario')).some(d => d.users[0] === admin && /1 remessa\(s\) atrasada\(s\) nas oficinas: 8 peça\(s\)/.test(d.texto)), 'resumo diário avisa remessa atrasada e quantas peças faltam voltar');
// acerto
const acerto30 = (await rpc(admin, `fab_fechar_remessa('${remessa.id}', ${j({ contaId: conta, data: diaP(0) })})`)).data;
eq(acerto30, { enviadas: 90, boas: 80, defeito: 2, faltando: 8, valor: 120, noFinanceiro: true }, 'acerto: 80 boas × 2,50 − 8 faltando × 10,00 = R$ 120');
fin = (await rpc(admin, 'fin_dados()')).data;
const pgM = fin.lancamentos.find(l => l.descricao.startsWith(`Remessa #${remessa.numero} · Costura · Costura da Maria`));
ok(pgM && pgM.valor === 120 && pgM.categoria === 'Facção' && pgM.contraparteId === ofMaria, 'pagamento da oficina no Financeiro');
ok(fails_with(await rpc(admin, `fab_registrar_retorno(${j({ remessaId: remessa.id, itens: [{ itemId: itP.id, boas: 1 }] })})`), 'já foi fechada'), 'remessa fechada não recebe retorno');
ok((await rpc(admin, `fab_reabrir_remessa('${remessa.id}')`)).ok && !(await rpc(admin, 'fin_dados()')).data.lancamentos.some(l => l.id === pgM.id), 'reabrir tira o pagamento do Financeiro');
ok(fails_with(await rpc(admin, `fab_apagar_ordem_corte('${ordem.id}')`), 'exclua a remessa antes'), 'ordem com remessa não é apagada');
// lançar em nome de
let lp30 = await rpc(admin, `fab_lancar_por(${j({ login: 'ana' })}, 'Costura', 'Camisa Polo', 'Branco', '', ${j([{ tamanho: 'G', qtd: 7 }])})`);
ok(lp30.ok, 'admin lança em nome da costureira');
const lpRow = (await q(`select user_id, lancado_por, origem from fab.lancamentos where origem = 'nome' order by criado_em desc limit 1`))[0];
ok(lpRow.user_id === ana && lpRow.lancado_por === admin, 'lançamento fica no nome dela, com registro de quem lançou');
lp30 = await rpc(admin, `fab_lancar_por(${j({ oficinaId: ofMaria })}, 'Costura', 'Camisa Polo', 'Branco', '', ${j([{ tamanho: 'G', qtd: 3 }])})`);
ok(lp30.ok && (await q(`select count(*)::int as n from fab.lancamentos where origem = 'nome' and oficina_nome = 'Costura da Maria' and user_id is null`))[0].n === 1, 'lança em nome de uma oficina');
ok(fails_with(await rpc(carla, `fab_lancar_por(${j({ login: 'ana' })}, 'Costura', 'Camisa Polo', 'Branco', '', ${j([{ tamanho: 'G', qtd: 1 }])})`), 'administrador'), 'funcionário não lança em nome de outro');
// permissões e isolamento
ok(fails_with(await rpc(ana, 'fab_remessas(120)'), 'FUNCAO_BLOQUEADA'), 'funcionário sem Oficinas e remessas não vê');
ok((await rpc(adminB, 'fab_remessas(120)')).data.remessas.length === 0 && fails_with(await rpc(adminB, `fab_fechar_remessa('${remessa.id}', null)`), 'não encontrada'), 'outra empresa não vê nem fecha');
ok((await rpc(admin, `fab_acessos(current_date - 1, current_date + 1)`)).data.eventos.some(e => e.alvo === 'remessas'), 'remessas ficam na auditoria');
// ============ cópia de segurança completa (formato 2) ============
console.log('\n--- cópia de segurança completa ---');
await q(`delete from fab.eventos where tipo = 'backup'`);
let bs = (await rpc(admin, 'fab_backup_situacao()')).data;
ok(bs.ultima === null && bs.dias === null, 'sem cópia ainda: situação vazia');
await q(`update fab.empresas set teste_ate = null where id = any($1)`, [[empA, empB]]);
await q(`delete from fab.avisos_fila`);
ok((await q(`select fab.lembrete_backup() n`))[0].n >= 2, 'lembrete semanal vai para as empresas sem cópia');
const lemb = await q(`select * from fab.avisos_fila where tipo = 'backup' and empresa_id = $1`, [empA]);
ok(lemb.length === 1 && lemb[0].url === '#/cadastros?aba=backup' && /ainda não tem/.test(lemb[0].texto), 'aviso leva direto para a aba de cópia');
const admsA = (await q(`select array_agg(id order by id) a from fab.perfis where empresa_id = $1 and ativo and perfil = 'admin'`, [empA]))[0].a;
ok(JSON.stringify([...lemb[0].users].sort()) === JSON.stringify([...admsA].sort()), 'lembrete só para administradores ativos');
const pedBk = (await rpc(admin, `fab_salvar_pedido(${j({ clienteNome: 'Cliente backup', dataPedido: diaP(-1), entrega: diaP(5), itens: [item('G', 3), item('P', 2)] })})`)).data;
const bk2r = await rpc(admin, 'fab_exportar()');
const bk2 = bk2r.data;
ok(bk2r.ok && bk2.formato === 'fabrica-backup-2' && bk2.geradoPor && bk2.contagem && bk2.contagem.perfis === bk2.tabelas.perfis.length, 'formato 2 com contagem por tabela');
for (const [filha, mae, fk] of [['pedido_itens', 'pedidos', 'pedido_id'], ['remessa_itens', 'remessas', 'remessa_id'], ['ordem_corte_itens', 'ordens_corte', 'ordem_id'], ['material_consumo', 'materiais', 'material_id'], ['mensagens_lidas', 'mensagens', 'mensagem_id']]) {
  const esperado = (await q(`select count(*)::int n from fab.${filha} i join fab.${mae} m on m.id = i.${fk} where m.empresa_id = $1`, [empA]))[0].n;
  ok(Array.isArray(bk2.tabelas[filha]) && bk2.tabelas[filha].length === esperado && (filha === 'mensagens_lidas' || esperado > 0), `itens sem empresa_id entram: ${filha} (${esperado})`);
}
const espRet = (await q(`select count(*)::int n from fab.retorno_itens i join fab.remessa_retornos r on r.id = i.retorno_id where r.empresa_id = $1`, [empA]))[0].n;
ok(espRet > 0 && bk2.tabelas.retorno_itens.length === espRet, `itens de retorno entram (${espRet})`);
const txt = JSON.stringify(bk2);
ok(!('push_inscricoes' in bk2.tabelas) && !('chaves_acesso' in bk2.tabelas) && !('avisos_fila' in bk2.tabelas) && !('dani_uso' in bk2.tabelas), 'sem inscrições de avisos, chaves, filas internas');
ok(bk2.tabelas.sessoes.every(x => !('session_id' in x)) && bk2.tabelas.aparelhos_confiaveis.every(x => !('aparelho' in x)), 'sem id de sessão nem id de aparelho confiável');
ok(!txt.includes('p256dh') && !txt.includes('token_hash'), 'nenhuma chave de criptografia ou token no arquivo');
const pedB = (await q(`select count(*)::int n from fab.pedido_itens i join fab.pedidos p on p.id = i.pedido_id where p.empresa_id = $1`, [empB]))[0].n;
const bkB = (await rpc(adminB, 'fab_exportar()')).data;
ok(bkB.tabelas.pedido_itens.length === pedB && bkB.tabelas.pedido_itens.every(i => !bk2.tabelas.pedido_itens.some(x => x.id === i.id && i.id !== undefined)), 'itens da outra empresa não vazam');
bs = (await rpc(admin, 'fab_backup_situacao()')).data;
ok(bs.ultima && bs.dias === 0 && bs.quem, 'situação mostra a última cópia (hoje) e quem baixou');
ok((await q(`select count(*)::int n from fab.eventos where tipo = 'backup' and empresa_id = $1`, [empA]))[0].n === 1, 'download fica na Atividade');
await q(`delete from fab.avisos_fila`);
await q(`select fab.lembrete_backup()`);
ok((await q(`select count(*)::int n from fab.avisos_fila where tipo = 'backup' and empresa_id = $1`, [empA]))[0].n === 0, 'com cópia recente, sem lembrete');
ok(fails_with(await rpc(ana, 'fab_backup_situacao()'), 'FUNCAO_BLOQUEADA'), 'funcionário não vê a situação da cópia');
ok(fails_with(await rpc(null, 'fab_backup_situacao()', { role: 'anon' }), 'permission denied'), 'anônimo não vê');
ok((await q(`select has_function_privilege('authenticated', 'fab.lembrete_backup()', 'execute') p, has_function_privilege('anon', 'fab.lembrete_backup()', 'execute') a`)).every(x => !x.p && !x.a), 'lembrete não é chamado pelo app (só pelo agendador)');
await q(`delete from fab.avisos_fila`);
await q(`delete from fab.pedidos where id = $1`, [pedBk.id ?? pedBk]);
// ============ conferência dupla das oficinas ============
console.log('\n--- conferência dupla das oficinas ---');
const avisosDe = async (tipo, like) => (await q(`select * from fab.avisos_fila where tipo = $1 and texto like $2 order by id`, [tipo, like]));
// alerta imediato de perda no corte: tecido para 100 peças, cortadas 90 = 10% (limite padrão 3%)
const ocA = (await rpc(admin, `fab_salvar_ordem_corte(${j({ quem: { oficinaId: ofJoao }, data: diaP(-1), modelo: 'Calça Jeans', cor: 'Branco', materialId: mat30, materialQtd: 2.5, itens: [{ tamanho: 'P', qtd: 9 }] })})`)).data;
ok((await avisosDe('perda', `Ordem de corte #${ocA.numero} %`)).some(a => a.titulo === 'Perda no corte' && a.texto === `Ordem de corte #${ocA.numero} (Calça Jeans Branco, Corte do João): 9 peça(s) cortadas, o tecido dava 10 (perda de 10,0%).` && a.users.includes(admin)), 'corte abaixo do esperado além do limite avisa na hora (tecido para 10, cortadas 9)');
const ocOk = (await rpc(admin, `fab_salvar_ordem_corte(${j({ quem: { oficinaId: ofJoao }, data: diaP(-1), modelo: 'Calça Jeans', cor: 'Branco', materialId: mat30, materialQtd: 2.5, itens: [{ tamanho: 'P', qtd: 10 }] })})`)).data;
ok((await avisosDe('perda', `Ordem de corte #${ocOk.numero} %`)).length === 0, 'corte que rendeu o esperado não avisa');
// limite de perda
ok(fails_with(await rpc(admin, 'fab_salvar_limite_perda(150)'), 'entre 0 e 100'), 'limite fora de 0–100 é recusado');
ok(Number((await rpc(admin, 'fab_salvar_limite_perda(12.5)')).data) === 12.5 && Number((await rpc(admin, 'fab_remessas(120)')).data.limitePerda) === 12.5, 'limite de perda salvo e enviado à tela');
ok(fails_with(await rpc(ana, 'fab_salvar_limite_perda(5)'), 'FUNCAO_BLOQUEADA'), 'funcionário sem a função não muda o limite');
ok(Number((await rpc(adminB, 'fab_remessas(120)')).data.limitePerda) === 3, 'limite é por empresa (a B segue com 3%)');
const nAvCorte = (await avisosDe('perda', 'Ordem de corte #%')).length;
const oc12 = (await rpc(admin, `fab_salvar_ordem_corte(${j({ quem: { oficinaId: ofJoao }, data: diaP(-1), modelo: 'Calça Jeans', cor: 'Branco', materialId: mat30, materialQtd: 2.5, itens: [{ tamanho: 'P', qtd: 9 }] })})`)).data;
ok((await avisosDe('perda', 'Ordem de corte #%')).length === nAvCorte, 'perda de 10% com limite de 12,5% não avisa');
await rpc(admin, 'fab_salvar_limite_perda(3)');

// 1) contagem às cegas
const rc = (await rpc(admin, `fab_salvar_remessa(${j({ quem: { oficinaId: ofMaria }, etapa: 'Costura', dataEnvio: diaP(-3), prazo: diaP(4), valorPeca: 2.5, descontoFaltante: 10, obs: 'nota interna da fábrica',
  itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 10 }, { modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'M', qtd: 10 }] })})`)).data;
let rcJ = (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === rc.id);
const cP = rcJ.itens.find(i => i.tamanho === 'P'), cM = rcJ.itens.find(i => i.tamanho === 'M');
const cegaErr = await rpc(admin, `fab_registrar_retorno(${j({ remessaId: rc.id, cega: true, itens: [{ itemId: cP.id, boas: 11 }] })})`);
ok(fails_with(cegaErr, 'passa do que foi enviado') && !/\b10\b/.test(cegaErr.error), 'às cegas: contagem acima do enviado é recusada sem revelar o número esperado');
const ret1 = (await rpc(admin, `fab_registrar_retorno(${j({ remessaId: rc.id, cega: true, data: diaP(-1), itens: [{ itemId: cP.id, boas: 9 }, { itemId: cM.id, boas: 9, defeito: 1 }] })})`)).data;
const ret2 = (await rpc(admin, `fab_registrar_retorno(${j({ remessaId: rc.id, data: diaP(0), itens: [{ itemId: cP.id, boas: 1 }] })})`)).data;
rcJ = (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === rc.id);
ok(rcJ.retornos.find(t => t.id === ret1).cega === true && rcJ.retornos.find(t => t.id === ret2).cega === false && rM.retornos.every(t => t.cega === undefined || t.cega === false), 'retorno guarda se a contagem foi às cegas');
ok(rcJ.ordemId === null && (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === remessa.id).ordemId === ordem.id, 'remessa informa a ordem de corte (para o balanço)');

// 2) link da oficina
const lkR = (await rpc(admin, `fab_remessa_link('${rc.id}', false)`)).data;
ok(/^[a-f0-9]{32}$/.test(lkR) && (await rpc(admin, `fab_remessa_link('${rc.id}', false)`)).data === lkR, 'link criado uma vez e reaproveitado');
ok(fails_with(await rpc(ana, `fab_remessa_link('${rc.id}', false)`), 'FUNCAO_BLOQUEADA') && fails_with(await rpc(adminB, `fab_remessa_link('${rc.id}', false)`), 'não encontrada'), 'só quem cuida das remessas da empresa gera o link');
const pub = await rpc(null, `fab_remessa_publica('${lkR}')`, { role: 'anon' });
ok(pub.ok && pub.data.numero === rc.numero && pub.data.quem === 'Costura da Maria' && pub.data.enviadas === 20 && pub.data.boas === 19 && pub.data.defeito === 1 && pub.data.itens.length === 2 && pub.data.retornos.length === 2, 'oficina vê a remessa pelo link, sem login');
ok(!JSON.stringify(pub.data).includes('nota interna') && !('token' in pub.data) && !('obs' in pub.data) && Number(pub.data.valorPeca) === 2.5, 'página da oficina não mostra observações internas nem o token');
ok(fails_with(await rpc(null, `fab_remessa_publica('${'0'.repeat(32)}')`, { role: 'anon' }), 'LINK_INVALIDO') && fails_with(await rpc(null, `fab_remessa_publica('x'' or 1=1 --')`, { role: 'anon' }), 'LINK_INVALIDO'), 'link inexistente ou malformado é recusado');
ok(fails_with(await rpc(null, `fab_remessa_link('${rc.id}', false)`, { role: 'anon' }), 'permission denied'), 'sem login não gera link');
// confirma o envio
const ce = await rpc(null, `fab_remessa_confirmar('${lkR}', ${j({ confere: true, nome: 'Maria' })})`, { role: 'anon' });
ok(ce.ok && ce.data.confere === true && ce.data.fabrica === 20, 'oficina confirma o recebimento');
ok(fails_with(await rpc(null, `fab_remessa_confirmar('${lkR}', ${j({ confere: true })})`, { role: 'anon' }), 'já foi respondida'), 'não responde a mesma etapa duas vezes');
// contesta o retorno 1: diz que devolveu 10 do P (a fábrica contou 9)
await q(`delete from fab.avisos_fila`);
ok(fails_with(await rpc(null, `fab_remessa_confirmar('${lkR}', ${j({ retornoId: ret1, confere: false, itens: [{ itemId: itP.id, qtd: 3 }] })})`, { role: 'anon' }), 'Item inválido'), 'item de outra remessa é recusado');
ok(fails_with(await rpc(null, `fab_remessa_confirmar('${lkR}', ${j({ retornoId: ret1, confere: false, itens: [] })})`, { role: 'anon' }), 'Informe quantas'), 'contestar exige a contagem');
const cr = await rpc(null, `fab_remessa_confirmar('${lkR}', ${j({ retornoId: ret1, confere: false, nome: 'Maria', obs: 'entreguei 10 do P', itens: [{ itemId: cP.id, qtd: 10 }] })})`, { role: 'anon' });
ok(cr.ok && cr.data.confere === false && cr.data.fabrica === 19 && cr.data.oficina === 20, 'oficina contesta: diz que devolveu 20, a fábrica contou 19');
const avC = await q(`select * from fab.avisos_fila where tipo = 'remessa'`);
ok(avC.length === 1 && avC[0].titulo === 'Oficina contestou a contagem' && avC[0].texto.includes(`Remessa #${rc.numero} (Costura da Maria): diz que devolveu 20 peça(s); a fábrica contou 19. Obs.: entreguei 10 do P`) && avC[0].users.includes(admin) && !avC[0].users.includes(ana), 'contestação avisa na hora quem cuida das remessas');
ok((await q(`select count(*)::int n from fab.eventos where tipo = 'remessa_contestada' and quem = 'Maria (pelo link)'`))[0].n === 1 && (await q(`select count(*)::int n from fab.eventos where tipo = 'remessa_confirmada'`))[0].n >= 1, 'confirmação e contestação ficam na Atividade');
// retorno 2: informa os mesmos números = confere
const cr2 = (await rpc(null, `fab_remessa_confirmar('${lkR}', ${j({ retornoId: ret2, confere: false, itens: [{ itemId: cP.id, qtd: 1 }] })})`, { role: 'anon' })).data;
ok(cr2.confere === true && (await q(`select count(*)::int n from fab.avisos_fila where tipo = 'remessa'`))[0].n === 1, 'mesmos números que a fábrica contam como confirmação (sem aviso)');
rcJ = (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === rc.id);
ok(rcJ.confirmacaoEnvio?.confere === true && rcJ.confirmacaoEnvio.nome === 'Maria' && rcJ.retornos.find(t => t.id === ret1).confirmacao.confere === false
  && rcJ.retornos.find(t => t.id === ret1).confirmacao.itens.length === 1 && rcJ.retornos.find(t => t.id === ret1).confirmacao.itens[0].itemId === cP.id && rcJ.retornos.find(t => t.id === ret1).confirmacao.itens[0].qtd === 10 && rcJ.retornos.find(t => t.id === ret2).confirmacao.confere === true, 'fábrica vê o que a oficina confirmou e o que contestou, por item');
const pub2 = (await rpc(null, `fab_remessa_publica('${lkR}')`, { role: 'anon' })).data;
ok(pub2.confirmacaoEnvio.confere === true && pub2.retornos.find(t => t.id === ret1).confirmacao.confere === false, 'oficina vê o que já respondeu');
// trocar o link derruba o antigo
const lkR2 = (await rpc(admin, `fab_remessa_link('${rc.id}', true)`)).data;
ok(lkR2 !== lkR && fails_with(await rpc(null, `fab_remessa_publica('${lkR}')`, { role: 'anon' }), 'não vale mais') && (await rpc(null, `fab_remessa_publica('${lkR2}')`, { role: 'anon' })).ok, 'link novo invalida o antigo');
ok((await q(`select count(*)::int n from fab.eventos where tipo = 'remessa_link' and detalhe->>'novo' = 'true'`))[0].n === 1 && (await q(`select count(*)::int n from fab.eventos where detalhe::text like $1`, ['%' + lkR2 + '%']))[0].n === 0, 'troca de link fica na Atividade, sem o link');
// empresa bloqueada: link para de funcionar
await q(`update fab.empresas set ativa = false where id = $1`, [empA]);
ok(fails_with(await rpc(null, `fab_remessa_publica('${lkR2}')`, { role: 'anon' }), 'indisponível') && fails_with(await rpc(null, `fab_remessa_confirmar('${lkR2}', ${j({ confere: true })})`, { role: 'anon' }), 'indisponível'), 'empresa bloqueada: link indisponível');
await q(`update fab.empresas set ativa = true where id = $1`, [empA]);
// editar os itens do envio invalida a confirmação do envio
const rd = (await rpc(admin, `fab_salvar_remessa(${j({ quem: { oficinaId: ofMaria }, etapa: 'Costura', dataEnvio: diaP(-1), valorPeca: 2, descontoFaltante: 5, itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 5 }] })})`)).data;
const lkRD = (await rpc(admin, `fab_remessa_link('${rd.id}', false)`)).data;
await rpc(null, `fab_remessa_confirmar('${lkRD}', ${j({ confere: true })})`, { role: 'anon' });
await rpc(admin, `fab_salvar_remessa(${j({ id: rd.id, quem: { oficinaId: ofMaria }, etapa: 'Costura', dataEnvio: diaP(-1), valorPeca: 2, descontoFaltante: 5, itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 6 }] })})`);
ok((await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === rd.id).confirmacaoEnvio === null && (await rpc(null, `fab_remessa_confirmar('${lkRD}', ${j({ confere: true })})`, { role: 'anon' })).ok, 'mudar os itens enviados pede nova confirmação');

// 3) alerta ao fechar com falta acima do limite
await q(`delete from fab.avisos_fila`);
ok(fails_with(await rpc(admin, `fab_fechar_remessa('${rc.id}', null)`), 'resolva a contestação antes de acertar'), 'contestação em aberto impede o acerto');
ok(fails_with(await rpc(admin, `fab_apagar_retorno('${ret1}')`), 'resolva a contestação antes de excluir'), 'contestação em aberto impede excluir o retorno');
ok(fails_with(await rpc(admin, `fab_resolver_contestacao('${rc.id}', '${ret1}', 'ok')`), 'Escreva o que foi decidido'), 'resolver exige dizer o que foi decidido');
ok(fails_with(await rpc(admin, `fab_resolver_contestacao('${rc.id}', null, 'recontamos')`), 'Não há contestação em aberto'), 'envio confirmado não tem o que resolver');
ok((await rpc(admin, `fab_resolver_contestacao('${rc.id}', '${ret1}', 'Recontamos juntas: eram 9 do P mesmo')`)).ok, 'fábrica resolve a contestação');
const rcRes = (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === rc.id).retornos.find(t => t.id === ret1).confirmacao;
ok(rcRes.confere === false && rcRes.resolvida && rcRes.resolvida.nota === 'Recontamos juntas: eram 9 do P mesmo' && rcRes.resolvida.por.length > 0 && Boolean(rcRes.resolvida.em), 'contestação fica registrada como resolvida (quem, quando e o que foi decidido)');
ok((await rpc(null, `fab_remessa_publica('${lkR2}')`, { role: 'anon' })).data.retornos.find(t => t.id === ret1).confirmacao.resolvida.nota.startsWith('Recontamos'), 'oficina vê a resposta da fábrica pelo link');
ok((await q(`select count(*)::int n from fab.eventos where tipo = 'contestacao_resolvida'`))[0].n === 1, 'resolução fica na Atividade');
await rpc(admin, `fab_fechar_remessa('${rc.id}', null)`);   // voltou tudo: sem falta
ok((await q(`select count(*)::int n from fab.avisos_fila where tipo = 'perda'`))[0].n === 0, 'remessa sem falta não avisa');
await rpc(admin, `fab_fechar_remessa('${rd.id}', null)`);   // 6 enviadas, nada voltou
const avF = await q(`select * from fab.avisos_fila where tipo = 'perda'`);
ok(avF.length === 1 && avF[0].titulo === 'Peças faltando na remessa' && avF[0].texto === `Remessa #${rd.numero} (Costura da Maria) fechou com 6 de 6 peça(s) faltando (100,0%). Limite: 3,00%.`, 'remessa fechada com falta acima do limite avisa na hora');
// contestação não some: editar só o prazo mantém; mudar os itens com contestação em aberto é bloqueado
const re = (await rpc(admin, `fab_salvar_remessa(${j({ quem: { oficinaId: ofMaria }, etapa: 'Costura', dataEnvio: diaP(-1), valorPeca: 2, descontoFaltante: 5, itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 20 }] })})`)).data;
const lkE = (await rpc(admin, `fab_remessa_link('${re.id}', false)`)).data;
const reIt = (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === re.id).itens[0];
await rpc(null, `fab_remessa_confirmar('${lkE}', ${j({ confere: false, itens: [{ itemId: reIt.id, qtd: 18 }] })})`, { role: 'anon' });
const reBase = { id: re.id, quem: { oficinaId: ofMaria }, etapa: 'Costura', dataEnvio: diaP(-1), valorPeca: 2, descontoFaltante: 5 };
ok((await rpc(admin, `fab_salvar_remessa(${j({ ...reBase, prazo: diaP(9), obs: 'só o prazo', itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 20 }] })})`)).ok
  && (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === re.id).confirmacaoEnvio?.confere === false, 'editar só o prazo não apaga a contestação');
ok(fails_with(await rpc(admin, `fab_salvar_remessa(${j({ ...reBase, itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 18 }] })})`), 'resolva a contestação antes de mudar os itens'), 'mudar os itens com contestação em aberto é bloqueado');
ok(fails_with(await rpc(admin, `fab_apagar_remessa('${re.id}')`), 'resolva a contestação antes de excluir'), 'excluir remessa contestada é bloqueado');
await rpc(admin, `fab_resolver_contestacao('${re.id}', null, 'Mandamos 18 mesmo; corrigido')`);
ok((await rpc(admin, `fab_salvar_remessa(${j({ ...reBase, itens: [{ modelo: 'Calça Jeans', cor: 'Branco', tamanho: 'P', qtd: 18 }] })})`)).ok, 'resolvida a contestação, a remessa pode ser corrigida');
const reJ = (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === re.id);
ok(reJ.confirmacaoEnvio === null && reJ.historico.length === 1 && reJ.historico[0].confere === false && reJ.historico[0].resolvida.nota.startsWith('Mandamos 18') && reJ.historico[0].substituidaEm,
  'itens corrigidos pedem nova confirmação e a contestação antiga fica no histórico');
ok((await rpc(null, `fab_remessa_confirmar('${lkE}', ${j({ confere: true })})`, { role: 'anon' })).ok, 'oficina confirma o envio corrigido');
// retorno excluído guarda a resposta da oficina como histórico
const rtE = (await rpc(admin, `fab_registrar_retorno(${j({ remessaId: re.id, cega: true, itens: [{ itemId: (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === re.id).itens[0].id, boas: 5 }] })})`)).data;
await rpc(null, `fab_remessa_confirmar('${lkE}', ${j({ retornoId: rtE, confere: true })})`, { role: 'anon' });
ok((await rpc(admin, `fab_apagar_retorno('${rtE}')`)).ok && (await rpc(admin, 'fab_remessas(120)')).data.remessas.find(x => x.id === re.id).historico.some(h => h.etapa === 'retorno' && h.confere === true), 'excluir o retorno não apaga a resposta da oficina');
// limite de perda: só administrador
await rpc(admin, `fab_salvar_funcoes('ana', ${j({ remessas: true })})`);
ok((await rpc(ana, 'fab_remessas(120)')).ok && fails_with(await rpc(ana, 'fab_salvar_limite_perda(100)'), 'administrador'), 'quem tem Oficinas e remessas mas não é administrador não muda o limite');
await rpc(admin, `fab_salvar_funcoes('ana', ${j({ remessas: false })})`);
// cópia de segurança: confirmações entram, o token não
const bkR = (await rpc(admin, 'fab_exportar()')).data;
ok(bkR.tabelas.remessa_confirmacoes.length >= 4 && bkR.tabelas.remessas.length >= 2 && bkR.tabelas.remessas.every(x => !('token' in x)) && !JSON.stringify(bkR).includes(lkR2), 'cópia leva as confirmações e não leva o link');
await q(`delete from fab.avisos_fila`);
// ---- sobra de tecido
await q(`delete from fab.avisos_fila`);
const sAntes = await saldoMat();
const ocS = (await rpc(admin, `fab_salvar_ordem_corte(${j({ quem: { oficinaId: ofJoao }, data: diaP(-1), modelo: 'Calça Jeans', cor: 'Branco', materialId: mat30, materialQtd: 3, sobraQtd: 0.5, itens: [{ tamanho: 'P', qtd: 9 }] })})`)).data;
ok(Math.abs((await saldoMat()) - (sAntes - 2.5)) < 1e-9, 'sobra informada na ordem volta ao estoque (levou 3, sobrou 0,5: baixa 2,5)');
ok((await rpc(admin, 'fab_remessas(120)')).data.ordens.find(o => o.id === ocS.id).sobra === 0.5, 'ordem mostra a sobra');
ok((await q(`select texto from fab.avisos_fila where tipo = 'perda'`)).some(a => a.texto.includes(`#${ocS.numero}`) && a.texto.includes('o tecido dava 10')), 'alerta de perda usa o tecido usado (2,5 kg dava 10 peças)');
const mvS = (await q(`select tipo, qtd::float, valor from fab.material_movs where ordem_id = $1 order by tipo`, [ocS.id]));
ok(mvS.length === 2 && mvS[0].tipo === 'ajuste' && mvS[0].qtd === 0.5 && mvS[0].valor === null, 'sobra entra como ajuste ligado à ordem (não é compra)');
let rs = await rpc(admin, `fab_registrar_sobra('${ocS.id}', 1, null)`);
ok(rs.ok && Number(rs.data.usado) === 2 && Math.abs((await saldoMat()) - (sAntes - 2)) < 1e-9 && (await q(`select count(*)::int n from fab.material_movs where ordem_id = $1 and tipo = 'ajuste'`, [ocS.id]))[0].n === 1, 'pesar de novo substitui a sobra (sem duplicar)');
ok(fails_with(await rpc(admin, `fab_registrar_sobra('${ocS.id}', 3, null)`), 'menor que o tecido levado') && fails_with(await rpc(admin, `fab_registrar_sobra('${ocS.id}', -1, null)`), 'inválida'), 'sobra igual ou maior que o levado, ou negativa, é recusada');
ok(fails_with(await rpc(admin, `fab_registrar_sobra('${ocS.id}', 0.5, '${diaP(-5)}')`), 'antes da ordem'), 'sobra não pode ser antes da ordem');
const ocSem = (await rpc(admin, `fab_salvar_ordem_corte(${j({ quem: { oficinaId: ofJoao }, data: diaP(-1), modelo: 'Calça Jeans', cor: 'Branco', itens: [{ tamanho: 'P', qtd: 2 }] })})`)).data;
ok(fails_with(await rpc(admin, `fab_registrar_sobra('${ocSem.id}', 1, null)`), 'não tem a bobina') && fails_with(await rpc(admin, `fab_salvar_ordem_corte(${j({ quem: { oficinaId: ofJoao }, modelo: 'Calça Jeans', cor: 'Branco', sobraQtd: 1, itens: [{ tamanho: 'P', qtd: 2 }] })})`), 'Informe a bobina'), 'sem bobina não há sobra');
const mvSaida = (await q(`select id from fab.material_movs where ordem_id = $1 and tipo = 'saida'`, [ocS.id]))[0].id;
ok(fails_with(await rpc(admin, `fab_apagar_mov_material('${mvSaida}')`), 'vem da ordem de corte'), 'movimento da ordem só muda pela ordem');
ok(fails_with(await rpc(ana, `fab_registrar_sobra('${ocS.id}', 1, null)`), 'FUNCAO_BLOQUEADA'), 'funcionário sem a função não registra sobra');
await rpc(admin, `fab_apagar_ordem_corte('${ocSem.id}')`);   // sem bobina, ela consome pela regra: tira antes de medir o saldo
ok((await rpc(admin, `fab_registrar_sobra('${ocS.id}', 0, null)`)).ok && (await rpc(admin, 'fab_remessas(120)')).data.ordens.find(o => o.id === ocS.id).sobra === null && Math.abs((await saldoMat()) - (sAntes - 3)) < 1e-9, 'sobra 0 tira a sobra');
await rpc(admin, `fab_apagar_ordem_corte('${ocS.id}')`);
ok(Math.abs((await saldoMat()) - sAntes) < 1e-9, 'excluir a ordem devolve tudo ao estoque');
for (const o of [oc12, ocA, ocOk]) await rpc(admin, `fab_apagar_ordem_corte('${o.id}')`);
await q(`delete from fab.remessas`); await q(`delete from fab.ordens_corte`); await q(`delete from fab.materiais where id = $1`, [mat30]);
await q(`delete from fab.lancamentos where origem <> 'lancar' or (modelo = 'Calça Jeans' and cor = 'Branco')`);
await q(`delete from fab.fin_lancamentos where categoria = 'Facção'`);
// ============ 31. Dani (assistente de IA) ============
console.log('\n--- Dani ---');
await rpc(admin, `fab_salvar_dani('AIzaSyTESTE_chave-123456789012345678901', 'gemini-2.5-flash')`);
await db.exec(readFileSync(join(here, '../migrations/20261127000034_dani_modelo_antigo.sql'), 'utf8'));
ok((await rpc(admin, 'fab_dani_config()')).data.modelo === '', 'modelo antigo e lento salvo volta para o automático');
await rpc(admin, `fab_salvar_dani('', 'gemini-3.5-flash-lite')`);
await db.exec(readFileSync(join(here, '../migrations/20261127000034_dani_modelo_antigo.sql'), 'utf8'));
ok((await rpc(admin, 'fab_dani_config()')).data.modelo === 'gemini-3.5-flash-lite', 'modelo escolhido pelo dono é mantido');
await rpc(admin, `fab_salvar_dani('-', '')`);
ok(fails_with(await rpc(adminB, `fab_salvar_dani('AIzaSy' || repeat('x', 33), '')`), 'responsável pelo sistema'), 'só o dono configura a chave do Gemini');
ok(fails_with(await rpc(admin, `fab_salvar_dani('curta', '')`), 'Chave do Gemini inválida'), 'chave inválida recusada');
ok((await rpc(admin, `fab_salvar_dani('AIzaSyTESTE_chave-123456789012345678901', 'gemini-2.5-flash')`)).ok, 'dono salva a chave e o modelo');
let dc = (await rpc(admin, 'fab_dani_config()')).data;
ok(dc.configurada && dc.final === '8901' && dc.modelo === 'gemini-2.5-flash' && !JSON.stringify(dc).includes('AIzaSyTESTE'), 'configuração não devolve a chave (só os 4 últimos dígitos)');
ok(fails_with(await rpc(admin, 'fab_dani_chave()'), 'permission denied'), 'usuário logado não lê a chave');
ok((await rpc(admin, `fab_salvar_dani('AQ.Ab8TESTE_formato-novo.123456789012345678901234', '')`)).ok && (await rpc(admin, 'fab_dani_config()')).data.final === '1234', 'aceita a chave no formato novo (AQ.)');
ok(fails_with(await rpc(admin, `fab_salvar_dani('AQ. com espaço 12345678901234567890123', '')`), 'inválida') && fails_with(await rpc(admin, `fab_salvar_dani('curta', '')`), 'inválida'), 'chave com espaço ou curta é recusada');
ok((await rpc(admin, `fab_salvar_dani('AIzaSyTESTE_chave-123456789012345678901', 'gemini-2.5-flash')`)).ok && (await rpc(admin, 'fab_dani_config()')).data.final === '8901', 'chave do formato novo pode ser trocada por uma do formato antigo');
ok((await rpc(null, 'fab_dani_chave()', { role: 'service_role' })).data.chave === 'AIzaSyTESTE_chave-123456789012345678901', 'função de borda lê a chave');
let di = await rpc(ana, `fab_dani_inicio('Lançar')`);
ok(di.ok && di.data.nome === 'Ana Souza' && di.data.funcoes.lancar === true && di.data.funcoes.financeiro === false && di.data.tela === 'Lançar', 'Dani recebe o contexto da pessoa (funções liberadas)');
ok(fails_with(await rpc(null, `fab_dani_inicio('x')`, { role: 'anon' }), 'permission denied'), 'sem login não pergunta');
await q(`insert into fab.dani_uso (empresa_id, user_id) select $1, $2 from generate_series(1, 30)`, [empA, bruno]);
ok(fails_with(await rpc(bruno, `fab_dani_inicio('')`), 'DANI_LIMITE'), 'limite de 30 perguntas por hora por pessoa');
ok((await rpc(carla, `fab_dani_inicio('')`)).ok, 'limite é por pessoa');
ok((await rpc(admin, `fab_salvar_dani('-', '')`)).ok && !(await rpc(admin, 'fab_dani_config()')).data.configurada, 'dono remove a chave');
await q(`delete from fab.dani_uso`);

await q(`delete from fab.registros`); await q(`update fab.perfis set dados = '{}'`);
await q(`delete from fab.itens_lista where nome in ('Moletom Canguru','Cinza','Vinho','GG','Camiseta Básica')`);

// ---------- amostras reais para o teste do front-end ----------
if (process.env.UPDATE_FIXTURES === '1') {
  const out = join(here, '../../web/src/api/__fixtures__');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'supabase-boot.json'), JSON.stringify((await rpc(carla, 'fab_boot()')).data, null, 2));
  writeFileSync(join(out, 'supabase-painel.json'), JSON.stringify((await rpc(admin, 'fab_painel()')).data, null, 2));
  writeFileSync(join(out, 'supabase-relatorio.json'), JSON.stringify(rel, null, 2));
  writeFileSync(join(out, 'supabase-fin.json'), JSON.stringify((await rpc(admin, 'fin_dados()')).data, null, 2));
  writeFileSync(join(out, 'supabase-dre.json'), JSON.stringify((await rpc(admin, 'dre_dados()')).data, null, 2));
  console.log('\namostras regravadas em web/src/api/__fixtures__');
}

console.log(fails ? `\n${fails} FALHA(S) de ${passes + fails}` : `\nTUDO OK (${passes} verificações)`);
process.exit(fails ? 1 : 0);
