/**
 * Conta das oficinas (mesma regra do banco):
 *   pendente (ainda com a oficina) = enviadas − boas − defeito
 *   no acerto: faltando = pendente;  a pagar = boas × valor da peça − faltando × desconto por faltante (nunca negativo)
 * Rendimento da bobina: peças esperadas = material usado ÷ consumo por peça (regra de corte do material).
 */
import type { ConfirmacaoOficina, OrdemCorte, Remessa } from '../../api/types';

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

export interface Rendimento { cortadas: number; usado: number | null; esperadas: number | null; perdaPct: number | null; consumoReal: number | null }
/** Tecido usado = levado − sobra que voltou ao estoque; o rendimento conta só o que foi usado. */
export function rendimento(o: OrdemCorte): Rendimento {
  const cortadas = Object.values(o.itens).reduce((s, q) => s + q, 0);
  const usado = o.materialQtd ? Math.round((o.materialQtd - (o.sobra ?? 0)) * 1000) / 1000 : null;
  const esperadas = usado && o.consumoPeca ? Math.floor(usado / o.consumoPeca + 1e-9) : null;
  return {
    cortadas, usado, esperadas,
    perdaPct: esperadas ? Math.round(((esperadas - cortadas) / esperadas) * 1000) / 10 : null,
    consumoReal: usado && cortadas ? Math.round((usado / cortadas) * 1000) / 1000 : null,
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
export function textoComprovante(r: Remessa, empresa: string, link?: string): string {
  const c = r.itens.reduce((s, i) => s + i.qtd, 0);
  const linhas = r.itens.map(i => `• ${i.modelo} ${i.cor} ${i.tamanho}: ${i.qtd}`);
  const br = (d: string) => d.split('-').reverse().join('/');
  return [`*${empresa} · Remessa #${r.numero}*`, `Para: ${r.quem} (${r.etapa})`, `Enviada em ${br(r.dataEnvio)}${r.prazo ? ` · devolver até ${br(r.prazo)}` : ''}`, ...linhas,
    `Total: ${c} peça(s)${r.valorPeca ? ` · R$ ${r.valorPeca.toFixed(2).replace('.', ',')} por peça` : ''}`,
    ...(link ? ['', 'Confira as peças e confirme (ou informe a sua contagem) neste link:', link] : [])].join('\n');
}

// =====================================================================
// Conferência dupla
// =====================================================================

/** Resultado da contagem às cegas: só depois de salvar a pessoa vê o que era esperado. */
export interface LinhaConferencia { itemId: string; descricao: string; esperado: number; contado: number; continua: number }
export function conferenciaCega(itens: Remessa['itens'], contagem: Record<string, { boas: number; defeito: number }>): { linhas: LinhaConferencia[]; esperado: number; contado: number; continua: number } {
  const linhas = itens.map(i => {
    const esperado = Math.max(0, i.qtd - i.boas - i.defeito);   // o que ainda estava com a oficina antes deste retorno
    const c = contagem[i.id] ?? { boas: 0, defeito: 0 };
    const contado = c.boas + c.defeito;
    return { itemId: i.id, descricao: `${i.modelo} · ${i.cor} · ${i.tamanho}`, esperado, contado, continua: Math.max(0, esperado - contado) };
  }).filter(l => l.esperado > 0 || l.contado > 0);
  return { linhas, esperado: linhas.reduce((s, l) => s + l.esperado, 0), contado: linhas.reduce((s, l) => s + l.contado, 0), continua: linhas.reduce((s, l) => s + l.continua, 0) };
}

/** Situação da resposta da oficina (pelo link) a uma etapa: envio ou um retorno. */
export type SituacaoResposta = 'aguardando' | 'confirmou' | 'contestou' | 'resolvida';
export interface Divergencia { itemId: string; descricao: string; fabrica: number; oficina: number }
export function respostaOficina(c: ConfirmacaoOficina | null): SituacaoResposta {
  return !c ? 'aguardando' : c.confere ? 'confirmou' : c.resolvida ? 'resolvida' : 'contestou';
}
/** Diferenças por item entre o que a fábrica registrou e o que a oficina disse (envio: enviadas; retorno: boas + defeito daquele retorno). */
export function divergencias(r: Remessa, retornoId: string | null): Divergencia[] {
  const ret = retornoId ? r.retornos.find(t => t.id === retornoId) : null;
  const c = retornoId ? ret?.confirmacao ?? null : r.confirmacaoEnvio;
  if (!c || c.confere) return [];
  return c.itens.map(d => {
    const it = r.itens.find(i => i.id === d.itemId);
    const ri = ret?.itens.find(x => x.itemId === d.itemId);
    const fabrica = retornoId ? (ri ? ri.boas + ri.defeito : 0) : it?.qtd ?? 0;
    return { itemId: d.itemId, descricao: it ? `${it.modelo} · ${it.cor} · ${it.tamanho}` : 'item', fabrica, oficina: d.qtd };
  });
}
/** Contestações em aberto (não resolvidas) na remessa: envio + retornos. */
const aberta = (c: ConfirmacaoOficina | null) => !!c && !c.confere && !c.resolvida;
export function contestacoes(r: Remessa): number {
  return (aberta(r.confirmacaoEnvio) ? 1 : 0) + r.retornos.filter(t => aberta(t.confirmacao)).length;
}

/** Balanço de uma ordem de corte, do tecido à peça devolvida, por tamanho. */
export interface LinhaBalanco { tamanho: string; cortadas: number; enviadas: number; naFabrica: number; excedente: number; boas: number; defeito: number; comOficina: number; sumiram: number }
export interface Balanco {
  linhas: LinhaBalanco[]; total: Omit<LinhaBalanco, 'tamanho'>;
  esperadas: number | null; perdaCortePct: number | null; sumiramPct: number | null; defeitoPct: number | null;
  remessas: number; contestacoes: number; alertas: string[]; acimaDoLimite: boolean;
}
const GRADE = ['RN', 'PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'EG', 'EGG', 'G1', 'G2', 'G3', 'G4', 'G5', 'U', 'ÚNICO'];
/** Ordem natural dos tamanhos: PP, P, M, G, GG…; números em ordem numérica; o resto em ordem alfabética. */
export function ordemTamanho(a: string, b: string): number {
  const ia = GRADE.indexOf(a.toUpperCase()), ib = GRADE.indexOf(b.toUpperCase());
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return a.localeCompare(b, 'pt-BR', { numeric: true });
}
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
export function balancoOrdem(o: OrdemCorte, remessas: Remessa[], limite: number): Balanco {
  const ligadas = remessas.filter(r => r.ordemId === o.id);
  const m = new Map<string, LinhaBalanco>();
  const linha = (t: string) => m.get(t) ?? m.set(t, { tamanho: t, cortadas: 0, enviadas: 0, naFabrica: 0, excedente: 0, boas: 0, defeito: 0, comOficina: 0, sumiram: 0 }).get(t)!;
  for (const [t, q] of Object.entries(o.itens)) linha(t).cortadas += q;
  for (const r of ligadas) for (const i of r.itens) {
    if (i.modelo !== o.modelo || i.cor !== o.cor) continue;   // só o que veio desta ordem
    const l = linha(i.tamanho), pend = Math.max(0, i.qtd - i.boas - i.defeito);
    l.enviadas += i.qtd; l.boas += i.boas; l.defeito += i.defeito;
    if (r.status === 'aberta') l.comOficina += pend; else l.sumiram += pend;
  }
  const linhas = [...m.values()].map(l => ({ ...l, naFabrica: Math.max(0, l.cortadas - l.enviadas), excedente: Math.max(0, l.enviadas - l.cortadas) }));
  const soma = (k: keyof Omit<LinhaBalanco, 'tamanho'>) => linhas.reduce((s, l) => s + l[k], 0);
  const total = { cortadas: soma('cortadas'), enviadas: soma('enviadas'), naFabrica: soma('naFabrica'), excedente: soma('excedente'), boas: soma('boas'), defeito: soma('defeito'), comOficina: soma('comOficina'), sumiram: soma('sumiram') };
  const rd = rendimento(o);
  const perdaCortePct = rd.perdaPct !== null && rd.perdaPct > 0 ? rd.perdaPct : rd.perdaPct === null ? null : 0;
  const sumiramPct = pct(total.sumiram, total.enviadas), defeitoPct = pct(total.defeito, total.enviadas);
  const nCont = ligadas.reduce((s, r) => s + contestacoes(r), 0);
  const alertas: string[] = [];
  if (perdaCortePct !== null && perdaCortePct > limite) alertas.push(`Perda no corte de ${String(perdaCortePct).replace('.', ',')}%: o tecido dava ${rd.esperadas} peças e saíram ${rd.cortadas}.`);
  if (sumiramPct !== null && sumiramPct > limite) alertas.push(`${total.sumiram} peça(s) sumiram nas oficinas (${String(sumiramPct).replace('.', ',')}% do que foi enviado).`);
  if (total.excedente > 0) alertas.push(`Foram enviadas ${total.excedente} peça(s) a mais do que foi cortado: confira a ordem e as remessas.`);
  if (nCont > 0) alertas.push(`${nCont} contagem(ns) contestada(s) pela oficina.`);
  return {
    linhas: linhas.sort((a, b) => ordemTamanho(a.tamanho, b.tamanho)), total, esperadas: rd.esperadas, perdaCortePct, sumiramPct, defeitoPct,
    remessas: ligadas.length, contestacoes: nCont, alertas, acimaDoLimite: alertas.length > 0,
  };
}

// =====================================================================
// Ranking de oficinas e cortadores (para decidir para quem mandar o próximo lote)
// =====================================================================
/** Quem é a oficina/pessoa (pelo identificador; o nome é só para mostrar): homônimos não se misturam e renomear não divide. */
const chaveQuem = (x: { oficinaId: string | null; login: string | null; quem: string }) => (x.oficinaId ? `o:${x.oficinaId}` : x.login ? `p:${x.login}` : `n:${x.quem}`);

export interface LinhaRankingOficina {
  chave: string; quem: string; remessas: number; acertadas: number; enviadas: number; boas: number; defeito: number;
  /** peças que faltaram em remessas já acertadas */ falta: number; comOficina: number;
  /** falta: sobre o enviado nas acertadas; defeito: sobre o enviado (mesma base do Balanço) */
  faltaPct: number | null; defeitoPct: number | null; atrasoMedio: number | null; atrasadas: number;
  /** custo de cada peça boa recebida: valor combinado de tudo o que foi enviado ÷ peças boas (sobe quando a oficina perde ou estraga) */
  custoPecaBoa: number | null;
  /** todas as contestações no período; abertas = ainda sem resolução */ contestacoes: number; abertas: number; atencao: string[];
}
export function rankingOficinas(lista: Remessa[], hoje: string, limite: number): LinhaRankingOficina[] {
  type Acc = LinhaRankingOficina & { envFechadas: number; somaAtraso: number; medidas: number; valorEnviado: number; boasFechadas: number; ultimoEnvio: string };
  const m = new Map<string, Acc>();
  for (const r of lista) {
    const chave = chaveQuem(r);
    const l: Acc = m.get(chave) ?? { chave, quem: r.quem, remessas: 0, acertadas: 0, enviadas: 0, boas: 0, defeito: 0, falta: 0, comOficina: 0, faltaPct: null, defeitoPct: null,
      atrasoMedio: null, atrasadas: 0, custoPecaBoa: null, contestacoes: 0, abertas: 0, atencao: [], envFechadas: 0, somaAtraso: 0, medidas: 0, valorEnviado: 0, boasFechadas: 0, ultimoEnvio: '' };
    if (r.dataEnvio >= l.ultimoEnvio) { l.quem = r.quem; l.ultimoEnvio = r.dataEnvio; }   // nome mais recente
    const c = contaRemessa(r, hoje);
    l.remessas++; l.enviadas += c.enviadas; l.boas += c.boas; l.defeito += c.defeito;
    if (r.status === 'fechada') { l.acertadas++; l.falta += c.pendentes; l.envFechadas += c.enviadas; l.valorEnviado += c.enviadas * r.valorPeca; l.boasFechadas += c.boas; }
    else l.comOficina += c.pendentes;
    if (r.prazo) {
      // atraso só de remessa terminada (acertada ou tudo devolvido) ou já vencida; aberta dentro do prazo ainda não conta
      const terminou = r.status === 'fechada' || c.pendentes === 0;
      const ultima = r.retornos.reduce((d, t) => (t.data > d ? t.data : d), '');
      if (terminou) {
        const a = Math.max(0, dias(r.prazo, ultima || (r.fechadaEm ?? hoje)));
        l.somaAtraso += a; l.medidas++; if (a > 0) l.atrasadas++;
      } else if (hoje > r.prazo) {
        const a = dias(r.prazo, hoje);
        l.somaAtraso += a; l.medidas++; l.atrasadas++;
      }
    }
    const resp = [r.confirmacaoEnvio, ...r.retornos.map(t => t.confirmacao)].filter(x => x && !x.confere);
    l.contestacoes += resp.length; l.abertas += resp.filter(x => !x!.resolvida).length;
    m.set(chave, l);
  }
  const pct1 = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  const virg = (n: number) => String(n).replace('.', ',');
  const linhas = [...m.values()].map(({ envFechadas, somaAtraso, medidas, valorEnviado, boasFechadas, ultimoEnvio: _u, ...l }) => {
    const faltaPct = pct1(l.falta, envFechadas), defeitoPct = pct1(l.defeito, l.enviadas);
    const atrasoMedio = medidas ? Math.round((somaAtraso / medidas) * 10) / 10 : null;
    const atencao: string[] = [];
    if (faltaPct !== null && faltaPct > limite) atencao.push(`falta ${virg(faltaPct)}%`);
    if (defeitoPct !== null && defeitoPct > limite) atencao.push(`defeito ${virg(defeitoPct)}%`);
    if (atrasoMedio !== null && atrasoMedio >= 2) atencao.push(`atraso médio de ${virg(atrasoMedio)} dia(s)`);
    if (l.abertas > 0) atencao.push(`${l.abertas} contestação(ões) em aberto`);
    return { ...l, faltaPct, defeitoPct, atrasoMedio, custoPecaBoa: boasFechadas > 0 ? r2(valorEnviado / boasFechadas) : null, atencao };
  });
  // ordem: sem alerta e com acerto primeiro; depois menos falta, menos defeito, menos atraso
  const v = (x: number | null) => (x === null ? Infinity : x);
  const grupo = (l: LinhaRankingOficina) => (l.atencao.length ? 2 : l.acertadas === 0 ? 1 : 0);
  return linhas.sort((a, b) => grupo(a) - grupo(b) || v(a.faltaPct) - v(b.faltaPct) || v(a.defeitoPct) - v(b.defeitoPct)
    || v(a.atrasoMedio) - v(b.atrasoMedio) || a.quem.localeCompare(b.quem));
}

export interface LinhaRankingCorte { chave: string; quem: string; ordens: number; cortadas: number; esperadas: number; perdaPct: number | null; semBobina: number; atencao: boolean }
export function rankingCortadores(ordens: OrdemCorte[], limite: number): LinhaRankingCorte[] {
  const m = new Map<string, { chave: string; quem: string; data: string; ordens: number; cortadas: number; esperadas: number; cortadasMedidas: number; semBobina: number }>();
  for (const o of ordens) {
    const rd = rendimento(o), chave = chaveQuem(o);
    const l = m.get(chave) ?? { chave, quem: o.quem, data: '', ordens: 0, cortadas: 0, esperadas: 0, cortadasMedidas: 0, semBobina: 0 };
    if (o.data >= l.data) { l.quem = o.quem; l.data = o.data; }
    l.ordens++; l.cortadas += rd.cortadas;
    if (rd.esperadas !== null) { l.esperadas += rd.esperadas; l.cortadasMedidas += rd.cortadas; } else l.semBobina++;   // 0 esperadas = bobina informada (rendeu nada)
    m.set(chave, l);
  }
  return [...m.values()].map(l => {
    const medida = l.cortadasMedidas > 0 || l.esperadas > 0;
    const perdaPct = !medida ? null : l.esperadas > 0 ? Math.max(0, Math.round(((l.esperadas - l.cortadasMedidas) / l.esperadas) * 1000) / 10) : 0;
    return { chave: l.chave, quem: l.quem, ordens: l.ordens, cortadas: l.cortadas, esperadas: l.esperadas, perdaPct, semBobina: l.semBobina, atencao: perdaPct !== null && perdaPct > limite };
  }).sort((a, b) => Number(a.atencao) - Number(b.atencao) || (a.perdaPct ?? Infinity) - (b.perdaPct ?? Infinity) || a.quem.localeCompare(b.quem));
}
