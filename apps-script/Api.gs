/**
 * API JSON para o front-end novo (pasta web/).
 *
 * COMO USAR
 *  1. No projeto do Apps Script, crie um arquivo "Api" (Api.gs) e cole este conteúdo.
 *     Nenhum outro arquivo precisa mudar: o doGet atual continua servindo o app antigo.
 *  2. Implantar > Gerenciar implantações > editar a implantação existente > Nova versão > Implantar.
 *     (mantém o mesmo endereço /exec)
 *  3. Em web/public/config.js coloque:  window.__FABRICA__ = { apiUrl: 'https://script.google.com/macros/s/…/exec' };
 *
 * SEGURANÇA
 *  - Lista fechada: só as 20 funções que o app usa. Funções de manutenção
 *    (zerarDados, listarLoginsSenhas, configurarPlanilha, …) NÃO ficam acessíveis daqui.
 *  - Cada função continua validando o TOKEN de sessão sozinha, como no app antigo.
 *
 * PROTOCOLO
 *  POST (Content-Type: text/plain) com corpo JSON { "fn": "painel", "args": ["<token>"] }
 *  Resposta: { "ok": true, "data": ... }  ou  { "ok": false, "error": "SESSAO" | "WIFI" | "mensagem" }
 *  (Web Apps do Apps Script não permitem definir código HTTP; o erro vai no corpo.)
 */
var API_PUBLICA_ = [
  'login', 'loginChave', 'sair', 'trocarSenha',
  'dadosIniciais', 'painel', 'relatorio',
  'baterPonto', 'statusRede',
  'lancarVarios', 'editarLancamento', 'apagarLancamento',
  'addEmFalta', 'statusEmFalta',
  'listarUsuarios', 'salvarUsuario', 'salvarLista',
  'verWifi', 'salvarWifi', 'cadastrarRedeAtual'
];

function doPost(e) {
  var inicio = Date.now();
  var fn = '';
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    fn = String(req.fn || '');
    var args = Array.isArray(req.args) ? req.args : [];

    if (API_PUBLICA_.indexOf(fn) < 0) return respostaApi_({ ok: false, error: 'Função não permitida.' });

    var global = (typeof globalThis !== 'undefined') ? globalThis : this;
    var impl = global[fn];
    if (typeof impl !== 'function') return respostaApi_({ ok: false, error: 'Função não encontrada no servidor: ' + fn });

    var data = impl.apply(null, args);
    return respostaApi_({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    var msg = String((err && err.message) || err || 'Erro desconhecido');
    // Não registra argumentos (podem conter senhas); só função, mensagem e duração.
    console.warn('api ' + fn + ' falhou em ' + (Date.now() - inicio) + ' ms: ' + msg);
    return respostaApi_({ ok: false, error: msg });
  }
}

function respostaApi_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
