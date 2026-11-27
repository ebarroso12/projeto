/**
 * Conta das oficinas (mesma regra do banco):
 *   pendente (ainda com a oficina) = enviadas − boas − defeito
 *   no acerto: faltando = pendente;  a pagar = boas × valor da peça − faltando × desconto por faltante (nunca negativo)
 * Rendimento da bobina: peças esperadas = material usado ÷ consumo por peça (regra de corte do material).
 */
import type { OrdemCorte, Remessa } from '../../api/types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 864e5);

export interface ContaRemessa {
  enviadas: number; boas: number; defeito: number; pendentes: number;
  /** aberta: boas × valor (o desconto só entra no acerto); fechada: o valor acertado */
  aPagar: number;
  /** simulação do acerto se fechar agora: desconto dos que ainda não voltaram e valor final */
  descontoAcerto: number; valorAcerto: number;
  diasFora: number; atraso: number | null;   // atraso em dias (>0 = atrasada)
}
export function contaRemessa(r: Remessa, hoje: string): ContaRemessa {
  const enviadas = r.itens.reduce((s, i) => s + i.qtd, 0);
  const boas = r.itens.reduce((s, i) => s + i.boas, 0);
  const defeito = r.itens.reduce((s, i) => s + i.defeito, 0);
  const pendentes = Math.max(0, enviadas - boas - defeito);
  const descontoAcerto = r2(pendentes * r.descontoFaltante);
  const valorAcerto = Math.max(0, r2(boas * r.valorPeca - descontoAcerto));
  const aPagar = r.status === 'fechada' && r.valorPago !== null ? r.valorPago : r2(boas * r.valorPeca);
  const fim = r.status === 'fechada' ? r.fechadaEm ?? hoje : hoje;
  return {
    enviadas, boas, defeito, pendentes, aPagar, descontoAcerto, valorAcerto, diasFora: Math.max(0, dias(r.dataEnvio, fim)),
    atraso: r.status === 'aberta' && r.prazo && pendentes > 0 ? dias(r.prazo, hoje) : null,
  };
}

export interface Rendimento { cortadas: number; esperadas: number | null; perdaPct: number | null; consumoReal: number | null }
export function rendimento(o: OrdemCorte): Rendimento {
  const cortadas = Object.values(o.itens).reduce((s, q) => s + q, 0);
  const esperadas = o.materialQtd && o.consumoPeca ? Math.floor(o.materialQtd / o.consumoPeca + 1e-9) : null;
  return {
    cortadas, esperadas,
    perdaPct: esperadas ? Math.round(((esperadas - cortadas) / esperadas) * 1000) / 10 : null,
    consumoReal: o.materialQtd && cortadas ? Math.round((o.materialQtd / cortadas) * 1000) / 1000 : null,
  };
}

/** Quem está com o quê: peças pendentes por oficina/pessoa, remessas atrasadas e valor a acertar. */
export interface LinhaOficina { quem: string; telefone: string | null; remessas: number; pendentes: number; atrasadas: number; maiorAtraso: number; aAcertar: number }
export function painelOficinas(lista: Remessa[], hoje: string): LinhaOficina[] {
  const m = new Map<string, LinhaOficina>();
  for (const r of lista) {
    if (r.status !== 'aberta') continue;
    const c = contaRemessa(r, hoje);
    const l = m.get(r.quem) ?? { quem: r.quem, telefone: r.telefone, remessas: 0, pendentes: 0, atrasadas: 0, maiorAtraso: 0, aAcertar: 0 };
    l.remessas++; l.pendentes += c.pendentes; l.aAcertar = r2(l.aAcertar + c.aPagar);
    if (c.atraso !== null && c.atraso > 0) { l.atrasadas++; l.maiorAtraso = Math.max(l.maiorAtraso, c.atraso); }
    m.set(r.quem, l);
  }
  return [...m.values()].sort((a, b) => b.atrasadas - a.atrasadas || b.pendentes - a.pendentes || a.quem.localeCompare(b.quem));
}

/** Texto do comprovante de envio (WhatsApp / impressão). */
export function textoComprovante(r: Remessa, empresa: string): string {
  const c = r.itens.reduce((s, i) => s + i.qtd, 0);
  const linhas = r.itens.map(i => `• ${i.modelo} ${i.cor} ${i.tamanho}: ${i.qtd}`);
  const br = (d: string) => d.split('-').reverse().join('/');
  return [`*${empresa} · Remessa #${r.numero}*`, `Para: ${r.quem} (${r.etapa})`, `Enviada em ${br(r.dataEnvio)}${r.prazo ? ` · devolver até ${br(r.prazo)}` : ''}`, ...linhas,
    `Total: ${c} peça(s)${r.valorPeca ? ` · R$ ${r.valorPeca.toFixed(2).replace('.', ',')} por peça` : ''}`].join('\n');
}
