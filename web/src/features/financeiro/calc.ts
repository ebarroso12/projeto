/**
 * Cálculos do Financeiro (portados do app "Financeiro" original, mesmas regras):
 *  - saldo das contas é de CAIXA: compras no cartão só saem da conta quando a fatura é paga;
 *  - fluxo e realizado do mês são por COMPETÊNCIA: a compra no cartão conta na data da compra;
 *  - parcelas fora do cartão vencem no "dia do vencimento"; se esse dia já passou no mês da compra,
 *    a 1ª parcela vai para o mês seguinte; dias inexistentes (31 em fevereiro) viram o último dia do mês.
 */
import type { FinDados, FinLancamento } from '../../api/types';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
const iso = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return { y: y!, m0: (m ?? 1) - 1, d: d ?? 1 }; };

export const mesDe = (data: string) => data.slice(0, 7);

/** Soma meses mantendo o dia (limitado ao último dia do mês). */
export function addMeses(data: string, n: number): string {
  const { y, m0, d } = parse(data);
  const alvo = new Date(y, m0 + n, 1);
  return iso(alvo.getFullYear(), alvo.getMonth(), Math.min(d, lastDay(alvo.getFullYear(), alvo.getMonth())));
}

/** Vencimento da parcela `index` (0 = 1ª) de uma conta programada fora do cartão. */
export function vencimentoParcela(dataCompra: string, diaVenc: number, index: number): string {
  const { y, m0, d } = parse(dataCompra);
  const inicio = diaVenc < d ? 1 : 0;
  const alvo = new Date(y, m0 + inicio + index, 1);
  return iso(alvo.getFullYear(), alvo.getMonth(), Math.min(diaVenc, lastDay(alvo.getFullYear(), alvo.getMonth())));
}

export interface Parcela { lanc: FinLancamento; numero: number; total: number; data: string; valor: number }

/** Parcelas ainda não pagas de uma saída programada. No cartão, todas entram nas faturas. */
export function parcelasEmAberto(l: FinLancamento): Parcela[] {
  if (l.tipo !== 'programada') return [];
  const total = Math.max(1, l.parcelas ?? 1);
  const pagas = l.cartaoId ? 0 : Math.min(total, l.parcelasPagas);
  const out: Parcela[] = [];
  for (let n = pagas; n < total; n++) {
    const data = l.cartaoId
      ? addMeses(l.vencimentoFatura ?? l.data, n)
      : vencimentoParcela(l.data, l.diaVencimento ?? 1, n);
    out.push({ lanc: l, numero: n + 1, total, data, valor: l.valorParcela ?? 0 });
  }
  return out;
}

export interface ItemFatura { descricao: string; valor: number; data: string; categoria: string; parcela?: string }
export interface Fatura { chave: string; cartaoId: string; vencimento: string; itens: ItemFatura[]; total: number }

/** Faturas de cartão ainda não pagas, por cartão e vencimento. */
export function faturasAbertas(d: FinDados): Fatura[] {
  const pagas = new Set(d.pagamentosFatura.map(p => `${p.cartaoId}|${p.vencimento}`));
  const mapa = new Map<string, Fatura>();
  const add = (cartaoId: string, venc: string, item: ItemFatura) => {
    const chave = `${cartaoId}|${venc}`;
    if (pagas.has(chave)) return;
    const f = mapa.get(chave) ?? { chave, cartaoId, vencimento: venc, itens: [], total: 0 };
    f.itens.push(item);
    f.total = arred(f.total + item.valor);
    mapa.set(chave, f);
  };
  for (const l of d.lancamentos) {
    if (!l.cartaoId) continue;
    if (l.tipo === 'saida' && l.vencimentoFatura) add(l.cartaoId, l.vencimentoFatura, { descricao: l.descricao, valor: l.valor, data: l.data, categoria: l.categoria });
    if (l.tipo === 'programada') {
      for (const p of parcelasEmAberto(l)) add(l.cartaoId, p.data, { descricao: l.descricao, valor: p.valor, data: l.data, categoria: l.categoria, parcela: `${p.numero}/${p.total}` });
    }
  }
  return [...mapa.values()].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.cartaoId.localeCompare(b.cartaoId));
}

export const arred = (n: number) => Math.round(n * 100) / 100;

/** Saldo de caixa de uma conta (até `ate`, inclusive; padrão: tudo). */
export function saldoConta(d: FinDados, contaId: string, ate = '9999-12-31'): number {
  const conta = d.contas.find(c => c.id === contaId);
  let v = conta?.saldoInicial ?? 0;
  for (const l of d.lancamentos) {
    if (l.contaId !== contaId || l.data < d.dataInicio || l.data > ate) continue;
    if (l.tipo === 'entrada') v += l.valor;
    if (l.tipo === 'saida') v -= l.valor;
  }
  for (const p of d.pagamentosFatura) if (p.contaId === contaId && p.data >= d.dataInicio && p.data <= ate) v -= p.valor;
  for (const m of d.movimentosMeta) if (m.contaId === contaId && m.data >= d.dataInicio && m.data <= ate) v += m.tipo === 'deposito' ? -m.valor : m.valor;
  return arred(v);
}

export function saldoTotal(d: FinDados, ate?: string): number {
  return arred(d.contas.filter(c => c.ativa).reduce((s, c) => s + saldoConta(d, c.id, ate), 0));
}

export function saldoMeta(d: FinDados, metaId: string): number {
  return arred(d.movimentosMeta.filter(m => m.metaId === metaId).reduce((s, m) => s + (m.tipo === 'deposito' ? m.valor : -m.valor), 0));
}
export const totalGuardado = (d: FinDados) => arred(d.metas.reduce((s, m) => s + saldoMeta(d, m.id), 0));

/** Entradas e saídas efetivadas no mês (competência: cartão conta na data da compra). */
export function fluxoMes(d: FinDados, mes: string): { entradas: number; saidas: number } {
  let entradas = 0, saidas = 0;
  for (const l of d.lancamentos) {
    if (!l.data.startsWith(mes)) continue;
    if (l.tipo === 'entrada') entradas += l.valor;
    if (l.tipo === 'saida') saidas += l.valor;
  }
  return { entradas: arred(entradas), saidas: arred(saidas) };
}

/** Realizado do mês por categoria (para comparar com o planejamento). */
export function realizadoMes(d: FinDados, mes: string): { entradas: number; saidas: Record<string, number>; totalSaidas: number } {
  const saidas: Record<string, number> = {};
  let entradas = 0;
  for (const l of d.lancamentos) {
    if (!l.data.startsWith(mes)) continue;
    if (l.tipo === 'entrada') entradas += l.valor;
    if (l.tipo === 'saida') { const c = l.categoria || 'Sem categoria'; saidas[c] = arred((saidas[c] ?? 0) + l.valor); }
  }
  return { entradas: arred(entradas), saidas, totalSaidas: arred(Object.values(saidas).reduce((a, b) => a + b, 0)) };
}

export interface Compromisso { tipo: 'parcela' | 'fatura'; data: string; descricao: string; valor: number; parcela?: Parcela; fatura?: Fatura }

/** Tudo o que vence (parcelas fora do cartão + faturas abertas), em ordem de data. */
export function compromissos(d: FinDados, nomeCartao: (id: string) => string): Compromisso[] {
  const parcelas: Compromisso[] = d.lancamentos
    .filter(l => l.tipo === 'programada' && !l.cartaoId)
    .flatMap(parcelasEmAberto)
    .map(p => ({ tipo: 'parcela' as const, data: p.data, descricao: `${p.lanc.descricao} · ${p.numero}/${p.total}`, valor: p.valor, parcela: p }));
  const faturas: Compromisso[] = faturasAbertas(d).map(f => ({ tipo: 'fatura' as const, data: f.vencimento, descricao: `Fatura ${nomeCartao(f.cartaoId)}`, valor: f.total, fatura: f }));
  return [...parcelas, ...faturas].sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao));
}

/** Gastos efetivados do mês por categoria, do maior para o menor. */
export function gastosPorCategoria(d: FinDados, mes: string): [string, number][] {
  return Object.entries(realizadoMes(d, mes).saidas).sort((a, b) => b[1] - a[1]);
}
