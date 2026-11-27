import { describe, expect, it } from 'vitest';
import type { OrdemCorte, Remessa } from '../../api/types';
import { contaRemessa, painelOficinas, rendimento, textoComprovante } from './calc';

const R = (o: Partial<Remessa>): Remessa => ({ id: 'r', numero: 31, quem: 'Costura da Maria', login: null, oficinaId: 'o', telefone: '16 9', etapa: 'Costura', dataEnvio: '2026-11-20',
  prazo: '2026-11-25', valorPeca: 2.5, descontoFaltante: 10, ordemId: 'o1', ordemNumero: 1, token: null, confirmacaoEnvio: null, historico: [], status: 'aberta', fechadaEm: null, valorPago: null, noFinanceiro: false, obs: '',
  itens: [{ id: 'a', modelo: 'Calça', cor: 'Branco', tamanho: 'P', qtd: 40, boas: 30, defeito: 2 }, { id: 'b', modelo: 'Calça', cor: 'Branco', tamanho: 'M', qtd: 50, boas: 50, defeito: 0 }],
  retornos: [], ...o });

describe('conta da remessa (oficina)', () => {
  it('pendentes, acerto e atraso', () => {
    expect(contaRemessa(R({}), '2026-11-27')).toEqual({ enviadas: 90, boas: 80, defeito: 2, pendentes: 8, aPagar: 200, descontoAcerto: 80, valorAcerto: 120, diasFora: 7, atraso: 2 });
  });
  it('acerto nunca negativo; fechada usa o valor pago e não conta atraso', () => {
    expect(contaRemessa(R({ descontoFaltante: 100 }), '2026-11-27').valorAcerto).toBe(0);
    const f = contaRemessa(R({ status: 'fechada', fechadaEm: '2026-11-26', valorPago: 120 }), '2026-11-30');
    expect([f.aPagar, f.atraso, f.diasFora]).toEqual([120, null, 6]);
  });
});

describe('rendimento da bobina', () => {
  const O = (o: Partial<OrdemCorte>): OrdemCorte => ({ id: 'o', numero: 1, data: '2026-11-20', quem: 'João', modelo: 'Calça', cor: 'Branco', obs: '', material: 'Malha', unidade: 'kg',
    materialQtd: 25, consumoPeca: 0.25, itens: { P: 40, M: 50 }, remetido: 0, ...o });
  it('esperado pela regra × cortado = perda', () => {
    expect(rendimento(O({}))).toEqual({ cortadas: 90, esperadas: 100, perdaPct: 10, consumoReal: 0.278 });
    expect(rendimento(O({ materialQtd: null }))).toEqual({ cortadas: 90, esperadas: null, perdaPct: null, consumoReal: null });
  });
});

describe('quem está com o quê', () => {
  it('soma por oficina, atrasadas primeiro', () => {
    const p = painelOficinas([R({}), R({ id: 'x', quem: 'Facção B', prazo: '2026-12-10' }), R({ id: 'y', status: 'fechada', valorPago: 50 })], '2026-11-27');
    expect(p.map(l => [l.quem, l.remessas, l.pendentes, l.atrasadas, l.maiorAtraso, l.aAcertar])).toEqual([['Costura da Maria', 1, 8, 1, 2, 200], ['Facção B', 1, 8, 0, 0, 200]]);
  });
  it('comprovante de envio', () => {
    expect(textoComprovante(R({}), 'Confecção X')).toBe('*Confecção X · Remessa #31*\nPara: Costura da Maria (Costura)\nEnviada em 20/11/2026 · devolver até 25/11/2026\n• Calça Branco P: 40\n• Calça Branco M: 50\nTotal: 90 peça(s) · R$ 2,50 por peça');
    expect(textoComprovante(R({}), 'Confecção X', 'https://app/?r=abc').endsWith('Total: 90 peça(s) · R$ 2,50 por peça\n\nConfira as peças e confirme (ou informe a sua contagem) neste link:\nhttps://app/?r=abc')).toBe(true);
  });
});

// ---------------------------------------------------------------- conferência dupla
import { balancoOrdem, conferenciaCega, contestacoes, divergencias, ordemTamanho, respostaOficina } from './calc';

describe('contagem às cegas', () => {
  it('compara o contado com o que ainda estava com a oficina', () => {
    const r = R({});   // P: 40 enviadas, 32 já voltaram → 8 esperadas; M: tudo voltou
    const c = conferenciaCega(r.itens, { a: { boas: 5, defeito: 1 } });
    expect(c.linhas).toEqual([{ itemId: 'a', descricao: 'Calça · Branco · P', esperado: 8, contado: 6, continua: 2 }]);
    expect([c.esperado, c.contado, c.continua]).toEqual([8, 6, 2]);
  });
  it('tudo conferido: nada continua com a oficina', () => {
    expect(conferenciaCega(R({}).itens, { a: { boas: 8, defeito: 0 } }).continua).toBe(0);
  });
});

describe('resposta da oficina pelo link', () => {
  const conf = (confere: boolean, itens: { itemId: string; qtd: number }[] = [], resolvida: { em: string; por: string; nota: string } | null = null) => ({ confere, em: '2026-11-27T10:00:00', nome: 'Maria', obs: '', itens, resolvida });
  it('situação de cada etapa', () => {
    expect(respostaOficina(null)).toBe('aguardando');
    expect(respostaOficina(conf(true))).toBe('confirmou');
    expect(respostaOficina(conf(false, [{ itemId: 'a', qtd: 39 }]))).toBe('contestou');
  });
  it('divergência do envio e de um retorno, por item', () => {
    const r = R({ confirmacaoEnvio: conf(false, [{ itemId: 'a', qtd: 38 }]),
      retornos: [{ id: 't1', data: '2026-11-26', obs: '', boas: 50, defeito: 0, cega: true, itens: [{ itemId: 'b', boas: 50, defeito: 0 }], confirmacao: conf(false, [{ itemId: 'b', qtd: 52 }]) }] });
    expect(divergencias(r, null)).toEqual([{ itemId: 'a', descricao: 'Calça · Branco · P', fabrica: 40, oficina: 38 }]);
    expect(divergencias(r, 't1')).toEqual([{ itemId: 'b', descricao: 'Calça · Branco · M', fabrica: 50, oficina: 52 }]);
    expect(contestacoes(r)).toBe(2);
    expect(contestacoes(R({}))).toBe(0);
    // resolvida pela fábrica: continua mostrando a diferença, mas não conta como em aberto
    const res = R({ confirmacaoEnvio: conf(false, [{ itemId: 'a', qtd: 38 }], { em: '2026-11-28T10:00:00', por: 'Edson', nota: 'recontamos' }) });
    expect(respostaOficina(res.confirmacaoEnvio)).toBe('resolvida');
    expect(contestacoes(res)).toBe(0);
    expect(divergencias(res, null)).toHaveLength(1);
  });
});

describe('balanço da ordem de corte', () => {
  const O: OrdemCorte = { id: 'o1', numero: 12, data: '2026-11-20', quem: 'Corte do João', modelo: 'Calça', cor: 'Branco', obs: '', material: 'Malha', unidade: 'kg',
    materialQtd: 25, consumoPeca: 0.25, itens: { G: 10, M: 50, P: 40 }, remetido: 90 };
  it('do tecido à peça: na fábrica, com a oficina e sumidas por tamanho', () => {
    const aberta = R({});                                   // P 40 (30+2), M 50 (50): 8 do P com a oficina
    const fechada = R({ id: 'r2', status: 'fechada', itens: [{ id: 'c', modelo: 'Calça', cor: 'Branco', tamanho: 'G', qtd: 6, boas: 4, defeito: 0 }] });   // 2 do G sumiram
    const outra = R({ id: 'r3', ordemId: 'outra' });        // de outra ordem: não entra
    const b = balancoOrdem(O, [aberta, fechada, outra], 3);
    expect(b.linhas.map(l => l.tamanho)).toEqual(['P', 'M', 'G']);
    expect(b.linhas.find(l => l.tamanho === 'P')).toEqual({ tamanho: 'P', cortadas: 40, enviadas: 40, naFabrica: 0, excedente: 0, boas: 30, defeito: 2, comOficina: 8, sumiram: 0 });
    expect(b.linhas.find(l => l.tamanho === 'G')).toEqual({ tamanho: 'G', cortadas: 10, enviadas: 6, naFabrica: 4, excedente: 0, boas: 4, defeito: 0, comOficina: 0, sumiram: 2 });
    expect(b.total).toEqual({ cortadas: 100, enviadas: 96, naFabrica: 4, excedente: 0, boas: 84, defeito: 2, comOficina: 8, sumiram: 2 });
    expect([b.esperadas, b.perdaCortePct, b.sumiramPct, b.defeitoPct, b.remessas]).toEqual([100, 0, 2.1, 2.1, 2]);
    expect(b.acimaDoLimite).toBe(false);
  });
  it('alertas: perda no corte, peças sumidas, envio maior que o corte e contestação', () => {
    const o = { ...O, itens: { P: 40, M: 50 } };            // tecido para 100, cortadas 90 = 10%
    const r = R({ status: 'fechada', itens: [{ id: 'a', modelo: 'Calça', cor: 'Branco', tamanho: 'P', qtd: 45, boas: 35, defeito: 0 }],
      confirmacaoEnvio: { confere: false, em: '', nome: '', obs: '', itens: [{ itemId: 'a', qtd: 40 }], resolvida: null } });
    const b = balancoOrdem(o, [r], 3);
    expect(b.alertas).toEqual([
      'Perda no corte de 10%: o tecido dava 100 peças e saíram 90.',
      '10 peça(s) sumiram nas oficinas (22,2% do que foi enviado).',
      'Foram enviadas 5 peça(s) a mais do que foi cortado: confira a ordem e as remessas.',
      '1 contagem(ns) contestada(s) pela oficina.',
    ]);
    expect(b.acimaDoLimite).toBe(true);
    expect(balancoOrdem(o, [], 15).alertas).toEqual([]);   // 10% de perda com limite de 15%: sem alerta
  });
  it('sem tecido informado: sem perda de corte calculada', () => {
    expect(balancoOrdem({ ...O, materialQtd: null }, [], 3).perdaCortePct).toBeNull();
  });
  it('ordem natural dos tamanhos', () => {
    expect(['GG', 'P', '10', 'M', '2', 'PP', 'G'].sort(ordemTamanho)).toEqual(['PP', 'P', 'M', 'G', 'GG', '2', '10']);
  });
});

// ---------------------------------------------------------------- ranking
import { rankingCortadores, rankingOficinas } from './calc';
describe('ranking de oficinas', () => {
  const H = '2026-11-27';
  const fechada = (o: Partial<Remessa>) => R({ status: 'fechada', fechadaEm: '2026-11-24', ...o });
  it('falta, defeito, atraso, custo por peça boa e contestações; melhor primeiro', () => {
    const maria1 = fechada({ id: 'm1', quem: 'Maria', prazo: '2026-11-25', valorPago: 120,   // 90 enviadas, 80 boas, 2 defeito, 8 faltaram
      retornos: [{ id: 't', data: '2026-11-26', obs: '', boas: 80, defeito: 2, cega: true, itens: [], confirmacao: { confere: false, em: '', nome: '', obs: '', itens: [], resolvida: null } }] });
    const ana = fechada({ id: 'a1', quem: 'Ana', prazo: '2026-11-25', valorPago: 225, itens: [{ id: 'x', modelo: 'Calça', cor: 'Branco', tamanho: 'P', qtd: 90, boas: 90, defeito: 0 }],
      retornos: [{ id: 't2', data: '2026-11-24', obs: '', boas: 90, defeito: 0, cega: true, itens: [], confirmacao: null }] });
    const nova = R({ id: 'n1', quem: 'Nova', prazo: '2026-12-10', itens: [{ id: 'y', modelo: 'Calça', cor: 'Branco', tamanho: 'P', qtd: 10, boas: 0, defeito: 0 }] });
    const rk = rankingOficinas([maria1, nova, ana], H, 3);
    expect(rk.map(l => l.quem)).toEqual(['Ana', 'Maria', 'Nova']);
    const m = rk[1]!;
    expect([m.enviadas, m.boas, m.defeito, m.falta, m.faltaPct, m.defeitoPct, m.atrasoMedio, m.custoPecaBoa, m.contestacoes]).toEqual([90, 80, 2, 8, 8.9, 2.4, 1, 1.5, 1]);
    expect(m.atencao).toEqual(['falta 8,9%', '1 contestação(ões) em aberto']);
    expect([rk[0]!.faltaPct, rk[0]!.custoPecaBoa, rk[0]!.atrasoMedio, rk[0]!.atencao]).toEqual([0, 2.5, 0, []]);
    expect([rk[2]!.acertadas, rk[2]!.comOficina, rk[2]!.faltaPct, rk[2]!.custoPecaBoa]).toEqual([0, 10, null, null]);
  });
  it('remessa aberta e atrasada conta o atraso até hoje', () => {
    const r = R({ quem: 'Lenta', prazo: '2026-11-20' });   // ainda falta peça
    expect(rankingOficinas([r], '2026-11-27', 3)[0]!.atrasoMedio).toBe(7);
  });
});
describe('ranking de cortadores', () => {
  const O = (o: Partial<OrdemCorte>): OrdemCorte => ({ id: 'o', numero: 1, data: '2026-11-20', quem: 'João', modelo: 'Calça', cor: 'Branco', obs: '', material: 'Malha', unidade: 'kg',
    materialQtd: 25, consumoPeca: 0.25, itens: { P: 40, M: 50 }, remetido: 0, ...o });
  it('perda média ponderada pelo tecido, menor perda primeiro', () => {
    const rk = rankingCortadores([O({}), O({ id: 'o2', itens: { P: 50, M: 48 } }), O({ id: 'o3', quem: 'Rita', itens: { P: 50, M: 50 } }), O({ id: 'o4', quem: 'Rita', materialQtd: null, itens: { P: 5 } })], 3);
    expect(rk.map(l => [l.quem, l.ordens, l.cortadas, l.esperadas, l.perdaPct, l.semBobina, l.atencao])).toEqual([
      ['Rita', 2, 105, 100, 0, 1, false],
      ['João', 2, 188, 200, 6, 0, true],
    ]);
  });
});
