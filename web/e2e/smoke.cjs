/**
 * Teste de ponta a ponta no navegador (modo demonstração, sem servidor real).
 *   npm run build && npx vite preview --port 4173 &   depois:   node e2e/smoke.cjs
 * Requer o pacote "playwright" disponível (já vem no ambiente de desenvolvimento).
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS_DIR || '';
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* tenta de novo */ } await new Promise(r => setTimeout(r, 100)); } return false; };
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (viewport, url) => {
    const ctx = await browser.newContext({ viewport, acceptDownloads: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ipify|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    // o serviço de IP é externo: nos testes, responde um IP fixo
    await page.route('https://api.ipify.org/**', r => r.fulfill({ json: { ip: '203.0.113.7' } }));
    // o teste roda sempre em modo demonstração, mesmo com o config.js de produção apontando para o Supabase
    await page.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.__FABRICA__ = {};' }));
    await page.goto(url || BASE);
    return page;
  };

  // 1) Link "só ver": entra sozinho no Painel
  let page = await newPage({ width: 1440, height: 900 }, BASE + '?k=demo-key');
  await page.getByText('Presentes hoje').waitFor();
  ok(await page.getByRole('button', { name: /Acompanhamento/ }).isVisible(), 'link ?k= entra sozinho como "só ver"');
  const nav = await page.locator('.sidebar .nav a').allInnerTexts();
  ok(nav.join('|').replace(/\s+/g, ' ') .includes('Painel') && !nav.join().includes('Lançar') && !nav.join().includes('Cadastros'), 'perfil só ver: sem Lançar/Cadastros');
  ok(await page.locator('table[aria-label="Saldo por etapa"] tbody tr').count() > 3, 'tabela de saldo preenchida');
  ok(await page.locator('tr.row-erro').count() >= 1, 'linha de erro destacada em vermelho');
  ok(await page.getByText(/Alerta: \d+ lançamento/).isVisible(), 'alerta de lançamentos editados');
  await shot(page, '01-painel-desktop');

  // busca e ordenação na tabela
  await page.getByLabel('Buscar em Saldo por etapa').fill('jaqueta');
  const filtradas = await page.locator('table[aria-label="Saldo por etapa"] tbody tr').count();
  ok(filtradas >= 1 && filtradas < 12, 'busca filtra o saldo');
  await page.getByLabel('Buscar em Saldo por etapa').fill('');
  await page.getByRole('button', { name: 'Cortado' }).click();
  ok(await page.locator('th[aria-sort="ascending"]').count() === 1, 'ordenação por coluna');

  // tema escuro
  await page.getByRole('button', { name: /tema escuro/ }).click();
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'tema escuro');
  await page.waitForTimeout(300); // espera a transição de cor terminar
  await page.getByLabel('Buscar em Saldo por etapa').scrollIntoViewIfNeeded();
  await shot(page, '02-painel-escuro');
  await page.getByRole('button', { name: /tema claro/ }).click();

  // Relatório
  await page.locator('.sidebar').getByRole('link', { name: 'Relatório' }).click();
  await page.getByText('Produção por pessoa').waitFor();
  await shot(page, '03-relatorio');
  await page.getByRole('tab', { name: 'Presença' }).click();
  await page.getByText(/Presença \(\d+ dias/).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
  ok(fs.readFileSync(await dl.path(), 'utf8').includes('Nome;Dias;Horas;Extras;Faltas'), 'exporta CSV da presença');

  // Em falta (só ver: sem botão de cadastro)
  await page.locator('.sidebar').getByRole('link', { name: /Em falta/ }).click();
  await page.getByText('Em falta no estoque').first().waitFor();
  ok(await page.getByRole('button', { name: /Colocar item em falta/ }).count() === 0, 'só ver não cadastra item em falta');
  await shot(page, '04-em-falta');
  await page.context().close();

  // 2) Celular
  page = await newPage({ width: 390, height: 844 }, BASE + '?k=demo-key');
  await page.getByText('Presentes hoje').waitFor();
  ok(await page.locator('.bottomnav').isVisible() && !(await page.locator('.sidebar').isVisible()), 'celular: barra inferior no lugar do menu lateral');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'celular: sem rolagem horizontal da página');
  await shot(page, '05-painel-celular');
  await page.context().close();

  // 3) Login errado e admin
  page = await newPage({ width: 1440, height: 900 });
  await page.getByLabel('Login').fill('admin');
  await page.getByLabel('Senha').fill('errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText(/incorretos/).waitFor();
  ok(true, 'login errado mostra mensagem');
  await shot(page, '06-login');
  await page.getByLabel('Senha').fill('admin');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Presentes hoje').waitFor();
  ok(true, 'admin entra no Painel');

  // Lançar produção
  await page.locator('.sidebar').getByRole('link', { name: 'Lançar' }).click();
  await page.getByLabel('Modelo').selectOption('Camisa Polo');
  await page.getByLabel('Cor').selectOption('Preto');
  await page.getByLabel('M', { exact: true }).fill('5');
  await shot(page, '07-lancar');
  await page.getByRole('button', { name: 'Lançar', exact: true }).first().click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Lançar', exact: true }).click();
  await page.getByText('5 peças lançadas!').waitFor();
  ok(true, 'lança produção com confirmação');
  ok(await until(() => page.getByText('Camisa Polo · Preto · M').first().isVisible()), 'lançamento aparece em "Meus lançamentos de hoje"');
  // validação
  await page.getByLabel('Cor').selectOption('');
  await page.getByRole('button', { name: 'Lançar', exact: true }).first().click();
  ok(await page.getByText('Escolha o modelo e a cor.').isVisible(), 'valida modelo e cor');

  // Em falta: cadastrar
  await page.locator('.sidebar').getByRole('link', { name: /Em falta/ }).click();
  await page.getByRole('button', { name: /Colocar item em falta/ }).click();
  await page.locator('dialog[open]').getByLabel('Modelo').selectOption('Bermuda Tactel');
  await page.locator('dialog[open]').getByLabel('Quantidade').fill('30');
  await page.locator('dialog[open]').getByRole('button', { name: /Colocar na frente/ }).click();
  await page.getByText('Colocado na lista!').waitFor();
  ok(await page.getByText('Bermuda Tactel').first().isVisible(), 'cadastra item em falta');
  await shot(page, '08-em-falta-admin');

  // Cadastros: nova pessoa
  await page.locator('.sidebar').getByRole('link', { name: 'Cadastros' }).click();
  await page.getByRole('button', { name: 'Nova pessoa' }).click();
  await page.locator('dialog[open]').getByLabel('Nome').fill('Teste Silva');
  ok(await page.locator('dialog[open]').getByLabel(/Login/).inputValue() === 'teste', 'login sugerido a partir do nome');
  await page.locator('dialog[open]').getByRole('button', { name: 'Salvar' }).click();
  await page.getByText(/Salvo! Login: teste/).waitFor();
  ok(await until(() => page.getByRole('cell', { name: 'teste', exact: true }).isVisible()), 'cria pessoa e lista na tabela');
  ok((await page.locator('code', { hasText: '••••' }).count()) > 0, 'senhas mascaradas por padrão');
  await shot(page, '09-cadastros');
  // cadastros gerais: produto e cliente
  await page.getByRole('tab', { name: 'Produtos' }).click();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.locator('dialog[open]').getByLabel('Nome do produto (modelo)').fill('Moletom Canguru');
  await page.locator('dialog[open]').getByLabel('Preço de venda (R$)').fill('89,90');
  await page.locator('dialog[open]').getByLabel('Custo (R$)').fill('41.50');
  await page.locator('dialog[open]').getByLabel('Cores').fill('Cinza, Vinho');
  await page.locator('dialog[open]').getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Produto salvo.').waitFor();
  ok(await until(() => page.getByText(/R\$\s?89,90 · margem 54%/).isVisible()), 'cadastra produto com preço, custo e margem');
  await page.getByRole('tab', { name: 'Clientes' }).click();
  await page.getByRole('button', { name: 'Novo cliente' }).click();
  await page.locator('dialog[open]').getByLabel('Nome / razão social').fill('Boutique Aurora');
  await page.locator('dialog[open]').getByLabel('Telefone / WhatsApp').fill('(16) 99999-2222');
  await page.locator('dialog[open]').getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Cliente salvo.').waitFor();
  ok(await until(() => page.getByText('Boutique Aurora').isVisible()), 'cadastra cliente');
  await page.getByRole('tab', { name: 'Fornecedores' }).click();
  ok(await until(() => page.getByText('Tecelagem Sul').isVisible()), 'lista fornecedores');
  await page.getByRole('tab', { name: 'Bancos' }).click();
  ok(await until(() => page.getByText('Banco do Brasil').isVisible()), 'lista bancos');
  await shot(page, '09c-produtos');

  // funções por pessoa: clicar no nome abre as funções
  await page.getByRole('tab', { name: 'Funcionários' }).click();
  await page.locator('.link-empresa', { hasText: 'Carla Dias' }).click();
  await page.getByText('Funções de Carla Dias').waitFor();
  ok(await page.getByRole('switch', { name: /Financeiro: bloqueado/ }).isVisible(), 'funções da pessoa: financeiro bloqueado por padrão');
  await page.getByRole('switch', { name: /Financeiro/ }).click();
  ok(await page.getByRole('switch', { name: /Financeiro: liberado/ }).isVisible(), 'liga o financeiro para a pessoa');
  await shot(page, '09b-funcoes');
  await page.locator('dialog[open]').getByRole('button', { name: 'Salvar' }).click();
  await page.getByText(/Funções salvas/).waitFor();
  ok(true, 'salva as funções da pessoa');
  await page.getByRole('tab', { name: 'Cópia de segurança' }).click();
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Baixar cópia de segurança' }).click()]);
  ok(/^backup-.*\.json$/.test(bk.suggestedFilename()), 'baixa a cópia de segurança (' + bk.suggestedFilename() + ')');

  // mensagens: admin envia para todos
  await page.locator('.btn-msg').click();
  await page.locator('dialog[open]').getByRole('tab', { name: 'Nova mensagem' }).click();
  await page.locator('dialog[open]').getByLabel('Mensagem').fill('Amanhã o expediente começa às 7h.');
  await page.locator('dialog[open]').getByRole('button', { name: 'Enviar' }).click();
  await page.getByText('Mensagem enviada para todos.').waitFor();
  ok(await until(() => page.locator('dialog[open]').getByText(/Lida por 0 de \d+/).first().isVisible()), 'admin envia mensagem e vê quem leu');
  await shot(page, '11d-mensagens');
  await page.locator('dialog[open]').getByRole('button', { name: 'Fechar' }).first().click();

  // versão e atualizar
  ok(await page.getByRole('button', { name: /^Atualizar/ }).isVisible(), 'botão Atualizar ao lado do nome do usuário');
  ok(/versão \d+\.\d+\.\d+/.test(await page.locator('.app-rodape').innerText()), 'rodapé mostra a versão');
  await page.locator('.app-rodape').getByRole('button', { name: 'Novidades' }).click();
  ok(await page.locator('dialog[open] .versoes li.atual').isVisible(), 'novidades marcam a versão em uso');
  await page.locator('dialog[open]').getByRole('button', { name: 'Fechar', exact: true }).last().click();

  // Acessos: pedido pendente aparece no topo e é liberado dali
  ok(await page.locator('.pendentes-banner').getByText('Bruno Lima').isVisible(), 'admin vê pedido de acesso no topo');
  await page.locator('.pendentes-banner').getByRole('button', { name: 'Liberar', exact: true }).click();
  await page.getByText('Acesso liberado.').waitFor();
  ok(await until(async () => (await page.locator('.pendentes-banner').count()) === 0), 'liberado: faixa some');
  await page.locator('.sidebar').getByRole('link', { name: 'Acessos' }).click();
  await page.getByText('Liberação de acesso').waitFor();
  for (const t of ['Online', 'Entradas', 'Atividade', 'Métricas', 'Aparelhos']) {
    await page.getByRole('tablist', { name: 'Seções' }).getByRole('tab', { name: new RegExp('^' + t) }).click();
    await page.waitForTimeout(150);
  }
  await page.getByRole('tablist', { name: 'Seções' }).getByRole('tab', { name: 'Atividade' }).click();
  ok(await page.getByText('qtd: 30 → 35').first().isVisible(), 'atividade mostra o antes e depois de uma edição');
  await page.getByRole('tablist', { name: 'Tipo de registro' }).getByRole('tab', { name: 'Exclusões' }).click();
  ok((await page.locator('table[aria-label="Atividade"] tbody tr').count()) === 1, 'filtro de exclusões');
  await page.getByRole('tablist', { name: 'Seções' }).getByRole('tab', { name: 'Métricas' }).click();
  await page.getByRole('row', { name: /Dóris Prado/ }).getByRole('button', { name: 'Bloquear' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Bloquear' }).click();
  await page.getByText(/Pessoa bloqueada/).waitFor();
  ok(await until(() => page.getByRole('row', { name: /Dóris Prado/ }).getByRole('button', { name: 'Desbloquear' }).isVisible()), 'admin bloqueia e pode desbloquear uma pessoa');
  ok(await page.getByText('Tempo logado').first().isVisible(), 'métricas mostram tempo logado');
  await shot(page, '11c-acessos');

  // Dashboard mensal (gráficos)
  await page.locator('.sidebar').getByRole('link', { name: 'Dashboard' }).click();
  await page.getByText('Síntese gerencial').waitFor();
  ok(await page.locator('svg[role="img"]').count() >= 4, 'dashboard desenha os gráficos');
  ok(await page.getByText('Destaques do mês').isVisible(), 'dashboard mostra destaques do mês');
  await shot(page, '11b-dashboard');

  // Financeiro
  await page.locator('.sidebar').getByRole('link', { name: 'Financeiro' }).click();
  await page.getByText('Saldo em contas').waitFor();
  ok(true, 'financeiro abre com saldo');
  await shot(page, '12-financeiro');
  await page.locator('.page-head').getByRole('button', { name: 'Lançar', exact: true }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByLabel('Valor (R$)', { exact: true }).fill('150,00');
  await dlg.getByLabel('Descrição').fill('Linha de costura e2e');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Lançamento salvo.').waitFor();
  await page.getByRole('tab', { name: 'Lançamentos' }).click();
  ok(await until(() => page.getByText('Linha de costura e2e').first().isVisible()), 'lançamento financeiro aparece na lista');
  await shot(page, '13-financeiro-lancamentos');
  await page.getByRole('tablist', { name: 'Seções do financeiro' }).getByRole('tab', { name: 'A pagar' }).click();
  await page.getByRole('heading', { name: 'Contas a pagar' }).waitFor();
  const pagar = page.getByRole('button', { name: 'Pagar', exact: true });
  if (await pagar.count()) {
    await pagar.first().click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar pagamento' }).click();
    await page.getByText('Pagamento registrado.').waitFor();
    ok(true, 'paga parcela/fatura');
  }
  await shot(page, '14-financeiro-apagar');
  for (const t of ['Contas e cartões', 'Metas', 'Planejamento', 'Ajustes']) {
    await page.getByRole('tablist', { name: 'Seções do financeiro' }).getByRole('tab', { name: t }).click();
    await page.waitForTimeout(150);
  }
  ok(errors.length === 0, 'abas do financeiro sem erro');

  // Resultado (DRE)
  await page.locator('.sidebar').getByRole('link', { name: 'Resultado' }).click();
  await page.getByRole('tab', { name: 'Preencher mês' }).click();
  await page.locator('.dre-linha input').first().fill('10000');
  await page.getByRole('button', { name: /^Salvar / }).click();
  await page.getByText(/Mês fechado|Ainda há itens/).waitFor();
  ok(await until(() => page.getByText('Receita líquida').first().isVisible()), 'preenche o mês e volta à visão geral');
  await shot(page, '15-resultado');
  await page.getByRole('tab', { name: 'DRE detalhada' }).click();
  ok(await page.getByText('= Resultado final').isVisible(), 'DRE detalhada mostra resultado final');
  await shot(page, '16-dre-detalhada');

  // Empresas (dono do sistema)
  await page.locator('.sidebar').getByRole('link', { name: 'Empresas' }).click();
  await page.getByRole('button', { name: 'Nova empresa' }).click();
  await page.locator('dialog[open]').getByLabel('Nome da empresa').fill('Malharia Teste');
  ok(await page.locator('dialog[open]').getByLabel('Código de acesso').inputValue() === 'malharia-teste', 'código da empresa sugerido');
  await page.locator('dialog[open]').getByLabel('Nome', { exact: true }).fill('Joana Lima');
  await page.locator('dialog[open]').getByRole('button', { name: 'Criar empresa' }).click();
  await page.getByText('Empresa criada').waitFor();
  await shot(page, '17-empresa-criada');
  await page.locator('dialog[open]').getByRole('button', { name: 'Concluir' }).click();
  ok(await until(() => page.getByText('Malharia Teste').first().isVisible()), 'empresa criada aparece na lista');
  ok(await page.getByText('Teste · 4 dia(s)').isVisible() || await page.getByText(/Teste · \d+ dia/).first().isVisible(), 'empresa em teste mostra os dias restantes');
  await page.getByRole('button', { name: 'Gerar link TESTE' }).click();
  await page.locator('dialog[open]').getByLabel('Para quem (anotação)').fill('Malharia do João');
  await page.locator('dialog[open]').getByRole('button', { name: 'Gerar link' }).click();
  await page.getByText('Link de teste pronto').waitFor();
  const linkTeste = await page.locator('.link-box code').innerText();
  ok(/\?convite=\w{20,}/.test(linkTeste), 'gera link de teste para enviar');
  ok(await page.getByRole('link', { name: 'Enviar no WhatsApp' }).getAttribute('href').then(h => h.startsWith('https://wa.me/?text=')), 'botão de enviar no WhatsApp');
  await page.locator('dialog[open]').getByRole('button', { name: 'Concluir' }).click();
  ok(await until(() => page.getByText('Malharia do João').first().isVisible()), 'link aparece na lista de links');
  await page.getByRole('button', { name: 'Gerar link PRO' }).click();
  await page.locator('dialog[open]').getByLabel('Para quem (anotação)').fill('Cliente PRO');
  await page.locator('dialog[open]').getByRole('button', { name: 'Gerar link' }).click();
  await page.getByText('Link PRO pronto').waitFor();
  ok(await page.locator('dialog[open] .link-tipo.pro').isVisible(), 'gera link PRO (versão completa)');
  await page.locator('dialog[open]').getByRole('button', { name: 'Concluir' }).click();
  await page.locator('.link-empresa', { hasText: 'Estamparia Leste' }).click();
  await page.getByText('Implantação · 3/6').waitFor();
  ok(await page.getByRole('heading', { name: 'Uso por dia' }).isVisible() && await page.getByRole('heading', { name: 'Linha do tempo' }).isVisible(), 'ficha da empresa com uso por dia, implantação e linha do tempo');
  await shot(page, '17b-ficha');
  await page.locator('dialog[open]').getByRole('button', { name: /Fechar/ }).click().catch(() => page.keyboard.press('Escape'));
  await shot(page, '18-empresas');
  await page.context().close();

  // 3b) Visitante abre o link de teste e cria a própria empresa
  page = await newPage({ width: 1440, height: 900 }, BASE + '?convite=demo-teste');
  await page.getByText('Comece seu teste grátis').waitFor();
  await shot(page, '12-link-teste');
  await page.getByLabel('Nome da empresa').fill('Confecção Aurora');
  ok(await page.getByLabel('Código da empresa').inputValue() === 'confeccao-aurora', 'código sugerido a partir do nome');
  await page.getByLabel('Seu nome').fill('Rita Gomes');
  await page.getByLabel('Senha', { exact: true }).fill('aurora1');
  await page.getByLabel('Repita a senha').fill('aurora1');
  await page.getByRole('button', { name: 'Criar minha empresa e entrar' }).click();
  await page.getByText(/Boa (tarde|noite)|Bom dia/).first().waitFor();
  ok(true, 'visitante cria a empresa pelo link e já entra como administradora');
  await page.context().close();

  // 3c) Link PRO: versão completa, sem faixa de teste
  page = await newPage({ width: 1440, height: 900 }, BASE + '?convite=demo-pro');
  await page.getByText('Ative sua versão completa').waitFor();
  await page.getByLabel('Nome da empresa').fill('Malharia Ouro');
  await page.getByLabel('Seu nome').fill('Otávio Lima');
  await page.getByLabel('Senha', { exact: true }).fill('ouro123');
  await page.getByLabel('Repita a senha').fill('ouro123');
  await page.getByRole('button', { name: 'Criar minha empresa e entrar' }).click();
  await page.getByText(/Boa (tarde|noite)|Bom dia/).first().waitFor();
  ok((await page.locator('.teste-faixa').count()) === 0, 'link PRO entra sem faixa de teste');
  await page.context().close();

  // 4) Funcionária: Ponto
  page = await newPage({ width: 390, height: 844 });
  await page.getByLabel('Login').fill('carla');
  await page.getByLabel('Senha').fill('1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Mensagem importante').waitFor();
  ok(true, 'mensagem importante abre na tela da funcionária');
  await page.getByRole('button', { name: 'Li e entendi' }).click();
  ok(await until(async () => (await page.locator('.btn-msg .count').count()) === 1), 'contador mostra a outra mensagem não lida');
  await page.getByRole('button', { name: 'Marcar ENTRADA' }).waitFor();
  ok(page.url().endsWith('#/ponto'), 'funcionária cai na tela de Ponto');
  await shot(page, '11-ponto-celular');
  await page.getByRole('button', { name: 'Marcar ENTRADA' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Marcar ENTRADA' }).click();
  await page.getByText(/Entrada marcada às/).waitFor();
  ok(await until(() => page.getByRole('button', { name: 'Marcar ENTRADA' }).isDisabled()), 'entrada marcada desabilita o botão');
  ok(await until(() => page.getByRole('button', { name: 'Marcar SAÍDA' }).isEnabled()), 'saída fica disponível');
  await page.context().close();

  ok(errors.length === 0, 'sem erros no console: ' + errors.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
