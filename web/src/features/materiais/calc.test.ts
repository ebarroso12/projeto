import { describe, expect, it } from 'vitest';
import type { Material } from '../../api/types';
import { cobertura, resumoMateriais } from './calc';

const M = (o: Partial<Material>): Material => ({ id: 'x', nome: 'Malha', unidade: 'm', minimo: 0, inicio: '2026-01-01', ativo: true, obs: '', entradas: 0, saidas: 0, ajustes: 0,
  consumo: 0, consumo30: 0, saldo: 0, custoMedio: null, ultimaEntrada: null, regras: [], ...o });

describe('estoque de matéria-prima', () => {
  it('dias de cobertura pelo consumo dos últimos 30 dias', () => {
    expect(cobertura(M({ saldo: 300, consumo30: 600, minimo: 50, custoMedio: 5 }))).toEqual({ porDia: 20, dias: 15, situacao: 'ok', valorEstoque: 1500 });
    expect(cobertura(M({ saldo: 100, consumo30: 600, minimo: 50 })).situacao).toBe('acabando');   // 5 dias
    expect(cobertura(M({ saldo: 40, consumo30: 30, minimo: 50 })).situacao).toBe('abaixo');
    expect(cobertura(M({ saldo: 0, consumo30: 30 })).situacao).toBe('zerado');
    expect(cobertura(M({ saldo: 10 }))).toMatchObject({ dias: null, situacao: 'sem consumo' });
  });
  it('resumo: alertas e valor em estoque só dos ativos', () => {
    const r = resumoMateriais([M({ nome: 'A', saldo: 300, consumo30: 600, custoMedio: 2 }), M({ nome: 'B', saldo: 10, minimo: 50 }), M({ nome: 'C', ativo: false, saldo: 0 })]);
    expect(r).toEqual({ ativos: 2, alerta: 1, valorEstoque: 600, criticos: ['B'] });
  });
});
