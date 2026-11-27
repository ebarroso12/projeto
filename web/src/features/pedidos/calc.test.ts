import { describe, expect, it } from 'vitest';
import type { Pedido, PedidoItem } from '../../api/types';
import { andamento, filaProducao, resumo } from './calc';

const it_ = (o: Partial<PedidoItem>): PedidoItem => ({ modelo: 'Polo', cor: 'Preto', tamanho: 'M', qtd: 10, preco: 50, feito: {}, ...o });
const P = (o: Partial<Pedido>): Pedido => ({
  id: 'x', numero: 1, clienteId: null, cliente: 'Loja', dataPedido: '2026-11-01', entrega: '2026-12-10', status: 'aberto',
  entregueEm: null, obs: '', finLancamentoId: null, criadoPor: '', itens: [], ...o,
});

describe('andamento do pedido', () => {
  it('soma por etapa, calcula % e o que falta', () => {
    const a = andamento(P({ itens: [it_({ qtd: 10, feito: { Corte: 10, Costura: 6, 'Conferência': 2 } }), it_({ tamanho: 'G', qtd: 10, preco: 55, feito: { Corte: 4 } })] }), '2026-11-27');
    expect(a.total).toBe(20);
    expect(a.feito).toEqual({ Corte: 14, Costura: 6, 'Conferência': 2 });
    expect(a.pct).toEqual({ Corte: 70, Costura: 30, 'Conferência': 10 });
    expect([a.concluidas, a.faltam, a.valor, a.diasParaEntrega, a.situacao]).toEqual([2, 18, 1050, 13, 'no prazo']);
  });
  it('situação: atrasado, urgente, pronto, sem prazo e status final', () => {
    const feito = { Corte: 10, Costura: 10, 'Conferência': 10 };
    expect(andamento(P({ entrega: '2026-11-20', itens: [it_({})] }), '2026-11-27').situacao).toBe('atrasado');
    expect(andamento(P({ entrega: '2026-11-29', itens: [it_({})] }), '2026-11-27').situacao).toBe('urgente');
    expect(andamento(P({ entrega: '2026-11-29', itens: [it_({ feito })] }), '2026-11-27').situacao).toBe('pronto');
    expect(andamento(P({ entrega: null, itens: [it_({})] }), '2026-11-27').situacao).toBe('sem prazo');
    expect(andamento(P({ status: 'entregue', entrega: '2026-11-01', itens: [it_({})] }), '2026-11-27').situacao).toBe('entregue');
  });
  it('produção acima do pedido não passa de 100%', () => {
    expect(andamento(P({ itens: [it_({ qtd: 5, feito: { Corte: 9 } })] }), '2026-11-27').pct.Corte).toBe(100);
  });
});

describe('resumo e fila de produção', () => {
  const pedidos = [
    P({ numero: 1, entrega: '2026-11-20', itens: [it_({ qtd: 10, feito: { Corte: 10, Costura: 4 } })] }),
    P({ numero: 2, entrega: '2026-12-05', itens: [it_({ qtd: 6 }), it_({ tamanho: 'G', qtd: 4, feito: { Corte: 4, Costura: 4, 'Conferência': 4 } })] }),
    P({ numero: 3, status: 'entregue', itens: [it_({ qtd: 99 })] }),
  ];
  it('resume só os pedidos em aberto', () => {
    expect(resumo(pedidos, '2026-11-27')).toEqual({ abertos: 2, atrasados: 1, urgentes: 0, prontos: 0, pecasAFazer: 16, valorAberto: 1000 });
  });
  it('fila soma o que falta por combinação e ordena pela entrega mais próxima', () => {
    const f = filaProducao(pedidos);
    expect(f).toHaveLength(1);   // G já está pronto
    expect(f[0]).toMatchObject({ modelo: 'Polo', tamanho: 'M', entrega: '2026-11-20', pedidos: [1, 2], falta: { Corte: 6, Costura: 12, 'Conferência': 16 } });
  });
});
