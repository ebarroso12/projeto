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
await q(`insert into fab.donos (user_id) values ($1)`, [admin]);
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
ok(fails_with(await rpc(ana, 'fin_dados()'), 'Apenas o administrador'), 'funcionário não vê o financeiro');
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
ok(fails_with(await rpc(ana, 'dre_dados()'), 'Apenas o administrador'), 'funcionário não vê a DRE');
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
ok(r.ok && r.data.formato === 'fabrica-backup-1' && r.data.empresa.codigo === 'alfa', 'admin exporta a própria empresa');
const tabs = r.ok ? r.data.tabelas : {};
ok(tabs.perfis?.length === 5 && tabs.perfis.every(x => x.empresa_id === empA), 'backup traz só as pessoas da empresa A');
ok(tabs.ponto?.length >= 2 && tabs.itens_lista?.length >= 7 && Array.isArray(tabs.fin_lancamentos) && Array.isArray(tabs.dre_categorias), 'backup traz produção, ponto, financeiro e resultado');
ok(!('chaves_acesso' in tabs), 'backup não leva as chaves de acesso');
ok(fails_with(await rpc(ana, 'fab_exportar()'), 'Apenas o administrador'), 'funcionário não exporta');
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
ok(fails_with(await rpc(adminB, `fab_criar_convite(7, 1, 30, 'x')`), 'responsável pelo sistema'), 'só o dono gera link de teste');
const tok = (await rpc(admin, `fab_criar_convite(7, 2, 30, 'Malharias da região')`)).data;
ok(typeof tok === 'string' && tok.length >= 64, 'dono gera link (código longo, mostrado uma vez)');
ok(!(await q(`select 1 from fab.convites where token_hash = $1`, [tok])).length, 'banco guarda só o hash do link');
eq((await rpc(null, `fab_validar_convite('${tok}')`, { role: 'anon' })).data, { valido: true, dias: 7 }, 'página pública valida o link');
eq((await rpc(null, `fab_validar_convite('nao-existe-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')`, { role: 'anon' })).data, { valido: false, dias: 0 }, 'link inventado não vale');
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
const tokD = (await rpc(admin, `fab_criar_convite(7, 1, 30, 'desfazer')`)).data;
const empD = (await rpc(null, `fab_criar_empresa_teste('${tokD}','omega','Omega')`, { role: 'service_role' })).data;
ok((await rpc(null, `fab_desfazer_empresa_teste('${empD}')`, { role: 'service_role' })).ok && !(await q(`select 1 from fab.empresas where id = $1`, [empD])).length, 'desfazer apaga a empresa de teste (com cascata e auditoria)');
eq((await rpc(null, `fab_validar_convite('${tokD}')`, { role: 'anon' })).data.valido, true, 'desfazer devolve o uso do link');
ok((await rpc(null, `fab_apagar_empresa_vazia('${(await rpc(null, `fab_criar_empresa('vazia','Vazia')`, { role: 'service_role' })).data}')`, { role: 'service_role' })).ok, 'apagar empresa vazia funciona com auditoria');
const cv = (await rpc(admin, 'fab_convites()')).data.find(c => c.nota === 'Malharias da região');
ok(cv.usos === 2 && cv.empresas.length === 2, 'dono vê quantas empresas usaram o link');
const tok2 = (await rpc(admin, `fab_criar_convite(7, 1, 30, '')`)).data;
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
