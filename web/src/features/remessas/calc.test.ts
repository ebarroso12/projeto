import { describe, expect, it } from 'vitest';
import type { OrdemCorte, Remessa } from '../../api/types';
import { contaRemessa, painelOficinas, rendimento, textoComprovante } from './calc';

const R = (o: Partial<Remessa>): Remessa => ({ id: 'r', numero: 31, quem: 'Costura da Maria', login: null, oficinaId: 'o', telefone: '16 9', etapa: 'Costura', dataEnvio: '2026-11-20',
  prazo: '2026-11-25', valorPeca: 2.5, descontoFaltante: 10, ordemNumero: 1, status: 'aberta', fechadaEm: null, valorPago: null, noFinanceiro: false, obs: '',
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
  });
});
