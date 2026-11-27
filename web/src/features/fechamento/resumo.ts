/** Texto curto do mês para mandar pelo WhatsApp (o PDF completo sai pela impressão). */
export interface DadosResumo {
  empresa: string; mes: string;            // "Novembro de 2026"
  pecas?: number; porEtapa?: Record<string, number>;
  entradas?: number; saidas?: number; aReceber?: number; aPagar?: number;
  resultado?: number | null; lucroModelos?: number | null;
  pedidosEntregues?: number; pedidosAtrasados?: number;
  comprar?: string[];
}
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n: number) => n.toLocaleString('pt-BR');

export function resumoTexto(d: DadosResumo): string {
  const l: string[] = [`*${d.empresa} · ${d.mes}*`];
  if (d.pecas !== undefined) {
    const et = d.porEtapa ? Object.entries(d.porEtapa).map(([e, q]) => `${e} ${num(q)}`).join(', ') : '';
    l.push(`🧵 Produção: ${num(d.pecas)} peças${et ? ` (${et})` : ''}`);
  }
  if (d.pedidosEntregues !== undefined) l.push(`📦 Pedidos entregues: ${d.pedidosEntregues}${d.pedidosAtrasados ? ` · ${d.pedidosAtrasados} atrasado(s)` : ''}`);
  if (d.entradas !== undefined && d.saidas !== undefined) l.push(`💰 Entradas ${brl(d.entradas)} · Saídas ${brl(d.saidas)} · Saldo do mês ${brl(d.entradas - d.saidas)}`);
  if (d.aReceber) l.push(`📥 A receber: ${brl(d.aReceber)}`);
  if (d.aPagar) l.push(`📤 A pagar: ${brl(d.aPagar)}`);
  if (d.resultado !== undefined && d.resultado !== null) l.push(`📊 Resultado (DRE): ${brl(d.resultado)}`);
  if (d.lucroModelos !== undefined && d.lucroModelos !== null) l.push(`🏷️ Lucro estimado das peças prontas: ${brl(d.lucroModelos)}`);
  if (d.comprar?.length) l.push(`⚠️ Comprar: ${d.comprar.join(', ')}`);
  return l.join('\n');
}
