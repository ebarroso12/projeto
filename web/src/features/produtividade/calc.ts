/**
 * Produtividade e lucro por modelo (o servidor soma; aqui só se derivam os indicadores).
 *  - Peças por dia: divide pelos dias com ponto; sem ponto, pelos dias em que a pessoa lançou produção.
 *  - Peças por hora: só quando há horas fechadas no ponto (entrada e saída).
 *  - Lucro por peça = preço − custo do material − mão de obra por peça (soma do valor de cada etapa).
 *    O lucro do período usa as peças CONFERIDAS (prontas), não o que ainda está em produção.
 */
import type { LucroModelo, ProdPessoa } from '../../api/types';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Indicadores { pecasPorDia: number; pecasPorHora: number | null; horas: number }
export function indicadores(p: ProdPessoa): Indicadores {
  const dias = p.diasPonto || p.diasProducao;
  const horas = p.minutosPonto / 60;
  return {
    pecasPorDia: dias ? Math.round((p.pecas / dias) * 10) / 10 : 0,
    pecasPorHora: horas >= 1 ? Math.round((p.pecas / horas) * 10) / 10 : null,
    horas: Math.round(horas * 10) / 10,
  };
}

export interface LucroCalc {
  lucroPeca: number | null; margem: number | null;           // por peça
  receita: number | null; custoMaterial: number | null; maoDeObra: number; lucro: number | null; // no período (peças conferidas)
}
export function lucroDoModelo(m: LucroModelo): LucroCalc {
  const maoDeObra = r2(m.produzidas * m.maoDeObraPeca);
  if (m.preco === null || !(m.preco > 0)) return { lucroPeca: null, margem: null, receita: null, custoMaterial: null, maoDeObra, lucro: null };
  const custo = m.custo ?? 0;
  const lucroPeca = r2(m.preco - custo - m.maoDeObraPeca);
  return {
    lucroPeca, margem: Math.round((lucroPeca / m.preco) * 1000) / 10,
    receita: r2(m.produzidas * m.preco), custoMaterial: r2(m.produzidas * custo), maoDeObra, lucro: r2(m.produzidas * lucroPeca),
  };
}

export function totaisLucro(lista: LucroModelo[]) {
  let receita = 0, custoMaterial = 0, maoDeObra = 0, lucro = 0, pecas = 0, semCadastro = 0;
  for (const m of lista) {
    const c = lucroDoModelo(m);
    pecas += m.produzidas;
    if (c.lucro === null) { if (m.produzidas) semCadastro++; continue; }
    receita += c.receita!; custoMaterial += c.custoMaterial!; maoDeObra += c.maoDeObra; lucro += c.lucro;
  }
  return { receita: r2(receita), custoMaterial: r2(custoMaterial), maoDeObra: r2(maoDeObra), lucro: r2(lucro), pecas, semCadastro, margem: receita ? Math.round((lucro / receita) * 1000) / 10 : null };
}
