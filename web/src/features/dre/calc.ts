/**
 * Fórmulas do "DRE Fácil" (demonstrativo gerencial simplificado; não substitui a DRE contábil):
 *   receita líquida        = vendas(+) − deduções de vendas(−)
 *   lucro bruto            = receita líquida − custos diretos (CMV, mão de obra direta)
 *   resultado operacional  = lucro bruto − gastos para vender − despesas administrativas
 *   margem de contribuição = receita líquida − gastos VARIÁVEIS (exceto vendas e financeiro)
 *   resultado final        = resultado operacional + ganhos financeiros (juros, dividendos)
 * Margens são % da receita líquida.
 */
import type { DreCategoria, DreGrupo, DreValor } from '../../api/types';

export const GRUPOS: { id: DreGrupo; titulo: string; pergunta: string; ajuda: string }[] = [
  { id: 'sales', titulo: 'Vendas', pergunta: 'Quanto a empresa vendeu?', ajuda: 'Informe o faturamento e o imposto do mês analisado. Não é o dinheiro recebido no banco; é o valor das vendas daquele mês.' },
  { id: 'direct', titulo: 'Custos diretos', pergunta: 'Quanto custaram os produtos vendidos?', ajuda: 'Use o CMV já apurado. Se mão de obra ou produção já estão incluídas nesse CMV, não lance novamente.' },
  { id: 'selling', titulo: 'Gastos para vender', pergunta: 'Quanto gastou para vender?', ajuda: 'Taxas de marketplace, anúncios, comissões, fretes e embalagens de envio. Inclua apenas gastos referentes ao mês.' },
  { id: 'admin', titulo: 'Despesas administrativas', pergunta: 'Quanto custou manter a empresa?', ajuda: 'Estrutura e administração, como aluguel, contador, limpeza e pró-labore. Gastos da produção já incluídos no CMV não entram aqui.' },
  { id: 'finance', titulo: 'Ganhos financeiros', pergunta: 'Ganhou juros ou dividendos?', ajuda: 'Juros recebidos e dividendos. Aparecem depois do resultado operacional, sem alterar a margem.' },
];

export interface DreResultado {
  bruto: number; deducoes: number; liquida: number; diretos: number; vendas: number; admin: number; financeiro: number;
  lucroBruto: number; operacional: number; final: number; variaveis: number; contribuicao: number;
  margemBruta: number; margemContribuicao: number; margemOperacional: number; // NaN quando não há receita
}

export function calcularDre(categorias: DreCategoria[], valores: Record<string, DreValor>): DreResultado {
  const val = (c: DreCategoria) => (valores[c.id]?.marca === 'valor' ? Number(valores[c.id]?.valor ?? 0) : 0);
  const soma = (grupo: DreGrupo, tipo?: 'plus' | 'minus') =>
    categorias.filter(c => c.grupo === grupo && (!tipo || c.tipo === tipo)).reduce((s, c) => s + val(c), 0);

  const bruto = soma('sales', 'plus');
  const deducoes = soma('sales', 'minus');
  const liquida = bruto - deducoes;
  const diretos = soma('direct');
  const vendas = soma('selling');
  const admin = soma('admin');
  const financeiro = soma('finance', 'plus');
  const lucroBruto = liquida - diretos;
  const operacional = lucroBruto - vendas - admin;
  const variaveis = categorias
    .filter(c => c.grupo !== 'finance' && c.grupo !== 'sales' && c.variabilidade === 'variable' && c.tipo === 'minus')
    .reduce((s, c) => s + val(c), 0);
  const contribuicao = liquida - variaveis;
  const pct = (x: number) => (liquida ? (x / liquida) * 100 : NaN);
  return {
    bruto, deducoes, liquida, diretos, vendas, admin, financeiro, lucroBruto, operacional, final: operacional + financeiro,
    variaveis, contribuicao, margemBruta: pct(lucroBruto), margemContribuicao: pct(contribuicao), margemOperacional: pct(operacional),
  };
}

/** Categorias ativas ainda sem valor nem "não se aplica" (o que deixa o mês pendente). */
export function pendencias(categorias: DreCategoria[], valores: Record<string, DreValor>): DreCategoria[] {
  return categorias.filter(c => c.ativa && !(valores[c.id]?.marca === 'na' || (valores[c.id]?.marca === 'valor' && valores[c.id]?.valor !== null)));
}

export const nomeMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number);
  const s = new Date(y!, (m ?? 1) - 1, 15).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
