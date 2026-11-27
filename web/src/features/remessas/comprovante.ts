/**
 * Comprovante impresso da remessa (envio) ou de uma devolução (retorno), com QR code do link da oficina.
 * A costureira aponta a câmera, abre a remessa no celular e confirma (ou contesta) a contagem.
 */
import type { Remessa } from '../../api/types';
import { dataBR, formatBRL } from '../../lib/format';
import { qrSvg } from '../../lib/qr';

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

export function htmlComprovante(r: Remessa, empresa: string, link: string | null, retornoId?: string | null): string {
  const ret = retornoId ? r.retornos.find(t => t.id === retornoId) ?? null : null;
  if (retornoId && !ret) throw new Error('Retorno não encontrado.');
  const item = (id: string) => r.itens.find(i => i.id === id);
  let titulo: string, sub: string, tabela: string, assinaturas: [string, string], nota = '';
  if (!ret) {
    const tot = r.itens.reduce((s, i) => s + i.qtd, 0);
    titulo = `Remessa #${r.numero} · envio`;
    sub = `Para: <b>${esc(r.quem)}</b> (${esc(r.etapa)}) · Enviada em ${dataBR(r.dataEnvio)}${r.prazo ? ` · Devolver até ${dataBR(r.prazo)}` : ''}${r.valorPeca ? ` · ${formatBRL(r.valorPeca)} por peça` : ''}`;
    tabela = `<table><thead><tr><th>Modelo</th><th>Cor</th><th>Tam.</th><th class="n">Enviadas</th><th class="n">Conferido pela oficina</th></tr></thead><tbody>${
      r.itens.map(i => `<tr><td>${esc(i.modelo)}</td><td>${esc(i.cor)}</td><td>${esc(i.tamanho)}</td><td class="n">${i.qtd}</td><td class="caixa"></td></tr>`).join('')
    }</tbody><tfoot><tr><th colspan="3">Total</th><th class="n">${tot}</th><th class="caixa"></th></tr></tfoot></table>`;
    assinaturas = [`Entregue por (${esc(empresa)})`, `Recebido por (${esc(r.quem)})`];
    if (r.descontoFaltante) nota = `Peça que não voltar até o acerto: desconto de ${formatBRL(r.descontoFaltante)} cada. Peça com defeito não é paga nem descontada.`;
  } else {
    const b = ret.itens.reduce((s, i) => s + i.boas, 0), d = ret.itens.reduce((s, i) => s + i.defeito, 0);
    titulo = `Remessa #${r.numero} · devolução de ${dataBR(ret.data)}`;
    sub = `De: <b>${esc(r.quem)}</b> (${esc(r.etapa)}) · Enviada em ${dataBR(r.dataEnvio)}${ret.cega ? ' · <b>contada às cegas</b>' : ''}`;
    tabela = `<table><thead><tr><th>Modelo</th><th>Cor</th><th>Tam.</th><th class="n">Boas</th><th class="n">Com defeito</th><th class="n">Total</th></tr></thead><tbody>${
      ret.itens.map(x => { const i = item(x.itemId); return `<tr><td>${esc(i?.modelo ?? '?')}</td><td>${esc(i?.cor ?? '')}</td><td>${esc(i?.tamanho ?? '')}</td><td class="n">${x.boas}</td><td class="n">${x.defeito || ''}</td><td class="n">${x.boas + x.defeito}</td></tr>`; }).join('')
    }</tbody><tfoot><tr><th colspan="3">Total</th><th class="n">${b}</th><th class="n">${d}</th><th class="n">${b + d}</th></tr></tfoot></table>`;
    assinaturas = [`Devolvido por (${esc(r.quem)})`, `Conferido por (${esc(empresa)})`];
    if (ret.obs) nota = `Obs.: ${esc(ret.obs)}`;
  }
  const qr = link ? `<div class="qr">${qrSvg(link)}<p>Aponte a câmera do celular para <b>conferir e confirmar</b> ${ret ? 'esta devolução' : 'as peças'}.</p></div>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
  body{font-family:system-ui,Arial,sans-serif;margin:28px;color:#111} .topo{display:flex;gap:24px;align-items:flex-start;justify-content:space-between}
  h1{font-size:20px;margin:0 0 4px} .m{color:#444;margin:0 0 16px;font-size:14px} .qr{width:150px;text-align:center;flex-shrink:0} .qr svg{width:132px;height:132px}
  .qr p{font-size:11px;margin:4px 0 0;color:#333} table{width:100%;border-collapse:collapse;font-size:14px} th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}
  .n{text-align:right} td.caixa,th.caixa{width:120px} .nota{font-size:13px;color:#333;margin-top:10px}
  .ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:64px} .ass div{border-top:1px solid #333;padding-top:6px;font-size:13px;text-align:center}
  .data{margin-top:18px;font-size:13px} @media print{body{margin:12mm}}
</style></head><body>
  <div class="topo"><div><h1>${esc(empresa)} · ${esc(titulo)}</h1><p class="m">${sub}</p></div>${qr}</div>
  ${tabela}
  ${nota ? `<p class="nota">${nota}</p>` : ''}
  <p class="data">Data: ____/____/______</p>
  <div class="ass"><div>${assinaturas[0]}</div><div>${assinaturas[1]}</div></div>
  <script>window.onload=()=>window.print()</script></body></html>`;
}
