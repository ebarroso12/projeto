/**
 * Andamento dos pedidos. A produção já vem distribuída pelo servidor (item.feito por etapa);
 * aqui só se resume: % por etapa, quanto falta, valor e a situação em relação à entrega.
 */
import type { Pedido } from '../../api/types';

export const ETAPAS_PADRAO = ['Corte', 'Costura', 'Conferência'];

export type Situacao = 'atrasado' | 'urgente' | 'pronto' | 'no prazo' | 'sem prazo' | 'entregue' | 'cancelado';

export interface Andamento {
  total: number;                    // peças do pedido
  feito: Record<string, number>;    // peças feitas por etapa
  pct: Record<string, number>;      // 0..100 por etapa
  concluidas: number;               // peças na última etapa (conferidas)
  faltam: number;                   // total - concluídas
  valor: number;                    // soma qtd × preço
  diasParaEntrega: number | null;   // negativo = atrasado
  situacao: Situacao;
}

const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 864e5);

export function andamento(p: Pedido, hoje: string, etapas = ETAPAS_PADRAO): Andamento {
  const total = p.itens.reduce((s, i) => s + i.qtd, 0);
  const feito: Record<string, number> = {}, pct: Record<string, number> = {};
  for (const e of etapas) {
    feito[e] = p.itens.reduce((s, i) => s + Math.min(i.qtd, i.feito[e] ?? 0), 0);
    pct[e] = total ? Math.round((feito[e]! / total) * 100) : 0;
  }
  const concluidas = feito[etapas[etapas.length - 1]!] ?? 0;
  const valor = Math.round(p.itens.reduce((s, i) => s + i.qtd * i.preco, 0) * 100) / 100;
  const diasParaEntrega = p.entrega ? dias(hoje, p.entrega) : null;
  let situacao: Situacao;
  if (p.status !== 'aberto') situacao = p.status;
  else if (diasParaEntrega !== null && diasParaEntrega < 0) situacao = 'atrasado';
  else if (total > 0 && concluidas >= total) situacao = 'pronto';
  else if (diasParaEntrega !== null && diasParaEntrega <= 3) situacao = 'urgente';
  else situacao = diasParaEntrega === null ? 'sem prazo' : 'no prazo';
  return { total, feito, pct, concluidas, faltam: Math.max(0, total - concluidas), valor, diasParaEntrega, situacao };
}

export interface ResumoPedidos { abertos: number; atrasados: number; urgentes: number; prontos: number; pecasAFazer: number; valorAberto: number }

export function resumo(pedidos: Pedido[], hoje: string, etapas = ETAPAS_PADRAO): ResumoPedidos {
  const r: ResumoPedidos = { abertos: 0, atrasados: 0, urgentes: 0, prontos: 0, pecasAFazer: 0, valorAberto: 0 };
  for (const p of pedidos) {
    if (p.status !== 'aberto') continue;
    const a = andamento(p, hoje, etapas);
    r.abertos++;
    if (a.situacao === 'atrasado') r.atrasados++;
    if (a.situacao === 'urgente') r.urgentes++;
    if (a.situacao === 'pronto') r.prontos++;
    r.pecasAFazer += a.faltam;
    r.valorAberto += a.valor;
  }
  r.valorAberto = Math.round(r.valorAberto * 100) / 100;
  return r;
}

/** O que falta produzir, somado por modelo/cor/tamanho, em ordem da entrega mais próxima. */
export interface LinhaFila { modelo: string; cor: string; tamanho: string; falta: Record<string, number>; entrega: string | null; pedidos: number[] }

export function filaProducao(pedidos: Pedido[], etapas = ETAPAS_PADRAO): LinhaFila[] {
  const mapa = new Map<string, LinhaFila>();
  for (const p of pedidos) {
    if (p.status !== 'aberto') continue;
    for (const i of p.itens) {
      const k = `${i.modelo}|${i.cor}|${i.tamanho}`;
      const l = mapa.get(k) ?? { modelo: i.modelo, cor: i.cor, tamanho: i.tamanho, falta: Object.fromEntries(etapas.map(e => [e, 0])), entrega: null, pedidos: [] };
      for (const e of etapas) l.falta[e] = (l.falta[e] ?? 0) + Math.max(0, i.qtd - (i.feito[e] ?? 0));
      if (p.entrega && (!l.entrega || p.entrega < l.entrega)) l.entrega = p.entrega;
      if (!l.pedidos.includes(p.numero)) l.pedidos.push(p.numero);
      mapa.set(k, l);
    }
  }
  return [...mapa.values()]
    .filter(l => etapas.some(e => (l.falta[e] ?? 0) > 0))
    .sort((a, b) => (a.entrega ?? '9999').localeCompare(b.entrega ?? '9999') || a.modelo.localeCompare(b.modelo));
}
