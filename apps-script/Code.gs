/**
 * Backend de REFERÊNCIA para o Painel de Dados.
 * Só use se o seu script atual ainda não devolve JSON neste formato.
 *
 * Configuração: Projeto > Propriedades do script > adicionar KEY = <sua chave>.
 * Implantação: "Executar como: eu" / "Quem pode acessar: Qualquer pessoa".
 */
const SHEET_NAME = 'Dados';

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function authorized_(k) {
  const key = PropertiesService.getScriptProperties().getProperty('KEY');
  return Boolean(key) && k === key;
}

function sheet_() {
  return SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
}

// GET ?k=CHAVE  ->  { ok:true, data:[{coluna:valor,...}] }
function doGet(e) {
  if (!authorized_(e.parameter.k)) return json_({ ok: false, error: 'Não autorizado.' });
  const values = sheet_().getDataRange().getValues();
  const head = values.shift();
  const data = values.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  return json_({ ok: true, data });
}

// POST (text/plain com JSON) { k, action:"create", data:{coluna:valor} }
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (_) { return json_({ ok: false, error: 'JSON inválido.' }); }
  if (!authorized_(body.k)) return json_({ ok: false, error: 'Não autorizado.' });
  if (body.action !== 'create' || typeof body.data !== 'object') return json_({ ok: false, error: 'Ação inválida.' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // evita duas gravações simultâneas na mesma linha
  try {
    const sh = sheet_();
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sh.appendRow(head.map(h => (body.data[h] === undefined ? '' : body.data[h])));
  } finally { lock.releaseLock(); }
  return json_({ ok: true });
}
