import { describe, expect, it } from 'vitest';
import type { LucroModelo, ProdPessoa } from '../../api/types';
import { indicadores, lucroDoModelo, totaisLucro } from './calc';

const P = (o: Partial<ProdPessoa>): ProdPessoa => ({ login: 'a', nome: 'A', setor: '', ativo: true, porEtapa: {}, pecas: 0, valor: 0, diasProducao: 0, diasPonto: 0, minutosPonto: 0, fechado: null, ...o });
const M = (o: Partial<LucroModelo>): LucroModelo => ({ modelo: 'Polo', produzidas: 0, maoDeObra: 0, maoDeObraPeca: 0, preco: null, custo: null, cadastrado: false, entreguesPecas: 0, entreguesValor: 0, ...o });

describe('produtividade', () => {
  it('peças por dia usam os dias de ponto; sem ponto, os dias com produção', () => {
    expect(indicadores(P({ pecas: 200, diasPonto: 2, diasProducao: 3, minutosPonto: 810 }))).toEqual({ pecasPorDia: 100, pecasPorHora: 14.8, horas: 13.5 });
    expect(indicadores(P({ pecas: 90, diasProducao: 3 }))).toEqual({ pecasPorDia: 30, pecasPorHora: null, horas: 0 });
    expect(indicadores(P({})).pecasPorDia).toBe(0);
  });
});

describe('lucro por modelo', () => {
  it('lucro por peça = preço − custo − mão de obra; período usa as peças conferidas', () => {
    const c = lucroDoModelo(M({ produzidas: 150, preco: 80, custo: 30, maoDeObraPeca: 2 }));
    expect(c).toEqual({ lucroPeca: 48, margem: 60, receita: 12000, custoMaterial: 4500, maoDeObra: 300, lucro: 7200 });
  });
  it('sem preço no cadastro não inventa lucro; totais avisam', () => {
    expect(lucroDoModelo(M({ produzidas: 40, maoDeObraPeca: 3.5 })).lucro).toBeNull();
    const t = totaisLucro([M({ produzidas: 150, preco: 80, custo: 30, maoDeObraPeca: 2 }), M({ modelo: 'Calça', produzidas: 40, maoDeObraPeca: 3.5 })]);
    expect(t).toEqual({ receita: 12000, custoMaterial: 4500, maoDeObra: 300, lucro: 7200, pecas: 190, semCadastro: 1, margem: 60 });
  });
});
