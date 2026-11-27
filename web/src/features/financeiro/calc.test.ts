import { describe, expect, it } from 'vitest';
import type { DreCategoria, FinDados, FinLancamento } from '../../api/types';
import { calcularDre, pendencias } from '../dre/calc';
import {
  addMeses, compromissos, porContraparte, faturasAbertas, fluxoMes, parcelasEmAberto, realizadoMes, saldoConta, saldoTotal, totalGuardado, vencimentoParcela,
} from './calc';

const L = (o: Partial<FinLancamento>): FinLancamento => ({
  id: Math.random().toString(36).slice(2), tipo: 'saida', data: '2026-11-10', descricao: 'x', valor: 0, contaId: null, cartaoId: null, contraparteId: null, contraparte: '',
  forma: '', categoria: '', responsavel: '', centro: '', parcelas: null, valorParcela: null, diaVencimento: null, parcelasPagas: 0,
  vencimentoFatura: null, origemId: null, obs: '', ...o,
});
const base = (lancamentos: FinLancamento[], extra: Partial<FinDados> = {}): FinDados => ({
  hoje: '2026-11-26', dataInicio: '2026-01-01',
  listas: { categorias: [], responsaveis: [], centros: [], formas: [] },
  contas: [{ id: 'cc', nome: 'Conta corrente', saldoInicial: 1000, ativa: true }, { id: 'cx', nome: 'Caixa', saldoInicial: 200, ativa: true }],
  cartoes: [{ id: 'visa', nome: 'Visa', diaFechamento: 25, diaVencimento: 5, ativo: true }],
  lancamentos, pagamentosFatura: [], metas: [], movimentosMeta: [], expectativas: [], ...extra,
});

describe('datas (regras do app original)', () => {
  it('soma meses mantendo o dia e limitando ao fim do mês', () => {
    expect(addMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMeses('2026-11-05', 2)).toBe('2027-01-05');
  });
  it('1ª parcela vai para o mês seguinte quando o dia de vencimento já passou', () => {
    expect(vencimentoParcela('2026-11-20', 15, 0)).toBe('2026-12-15');
    expect(vencimentoParcela('2026-11-10', 15, 0)).toBe('2026-11-15');
    expect(vencimentoParcela('2026-01-10', 31, 1)).toBe('2026-02-28');
  });
});

describe('parcelas, faturas e saldos', () => {
  const prog = L({ id: 'p', tipo: 'programada', data: '2026-11-01', valor: 3000, contaId: 'cc', parcelas: 3, valorParcela: 1000, diaVencimento: 15, parcelasPagas: 1 });
  const cartaoParc = L({ id: 'pc', tipo: 'programada', data: '2026-11-20', valor: 600, cartaoId: 'visa', parcelas: 3, valorParcela: 200, vencimentoFatura: '2026-12-05' });
  const compra = L({ tipo: 'saida', data: '2026-11-26', valor: 300, cartaoId: 'visa', vencimentoFatura: '2027-01-05', categoria: 'Matéria-prima' });
  const dados = base([
    prog, cartaoParc, compra,
    L({ tipo: 'entrada', data: '2026-11-10', valor: 5000, contaId: 'cc', categoria: 'Vendas' }),
    L({ tipo: 'saida', data: '2026-11-15', valor: 1000, contaId: 'cc', categoria: 'Máquinas', origemId: 'p' }),
  ], {
    pagamentosFatura: [{ id: 'f', cartaoId: 'visa', vencimento: '2026-12-05', valor: 200, contaId: 'cc', data: '2026-12-05' }],
    metas: [{ id: 'm', nome: 'Reserva', valorMeta: 5000, dataAlvo: null, ativa: true }],
    movimentosMeta: [{ id: 'mm', metaId: 'm', tipo: 'deposito', valor: 800, data: '2026-11-20', contaId: 'cc' }],
  });

  it('parcelas em aberto descontam as já pagas', () => {
    expect(parcelasEmAberto(prog).map(p => `${p.numero}:${p.data}`)).toEqual(['2:2026-12-15', '3:2027-01-15']);
  });
  it('parcelas no cartão caem em faturas consecutivas', () => {
    expect(parcelasEmAberto(cartaoParc).map(p => p.data)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
  });
  it('fatura paga some da lista; compras se juntam na mesma fatura', () => {
    const f = faturasAbertas(dados);
    expect(f.map(x => `${x.vencimento}:${x.total}`)).toEqual(['2027-01-05:500', '2027-02-05:200']);
  });
  it('saldo é de caixa: cartão só sai na fatura paga; guardar dinheiro sai da conta', () => {
    // 1000 + 5000 − 1000 (parcela paga) − 200 (fatura) − 800 (guardado)
    expect(saldoConta(dados, 'cc')).toBe(4000);
    expect(saldoTotal(dados)).toBe(4200);
    expect(totalGuardado(dados)).toBe(800);
  });
  it('fluxo e realizado do mês são por competência (cartão na data da compra)', () => {
    expect(fluxoMes(dados, '2026-11')).toEqual({ entradas: 5000, saidas: 1300 });
    expect(realizadoMes(dados, '2026-11').saidas).toEqual({ 'Matéria-prima': 300, Máquinas: 1000 });
  });
  it('lançamentos antes da data de início não mexem no saldo', () => {
    const d = base([L({ tipo: 'saida', data: '2025-12-31', valor: 999, contaId: 'cc' })]);
    expect(saldoConta(d, 'cc')).toBe(1000);
  });
  it('compromissos juntam parcelas e faturas em ordem de data', () => {
    const c = compromissos(dados, id => (id === 'visa' ? 'Visa' : id));
    expect(c.map(x => `${x.data} ${x.tipo}`)).toEqual(['2026-12-15 parcela', '2027-01-05 fatura', '2027-01-15 parcela', '2027-02-05 fatura']);
  });
});

describe('DRE', () => {
  const C = (chave: string, grupo: DreCategoria['grupo'], tipo: 'plus' | 'minus', variabilidade: 'variable' | 'fixed', ativa = true): DreCategoria =>
    ({ id: chave, chave, grupo, nome: chave, tipo, variabilidade, essencial: false, nota: '', ativa, ordem: 0 });
  const cats = [
    C('gross', 'sales', 'plus', 'variable'), C('tax', 'sales', 'minus', 'variable'), C('cmv', 'direct', 'minus', 'variable'),
    C('ads', 'selling', 'minus', 'fixed'), C('freight', 'selling', 'minus', 'variable'), C('rent', 'admin', 'minus', 'fixed'),
    C('interest', 'finance', 'plus', 'fixed'),
  ];
  const v = (n: number) => ({ marca: 'valor' as const, valor: n });
  it('calcula receita líquida, lucro bruto, contribuição e resultado operacional', () => {
    const r = calcularDre(cats, { gross: v(50000), tax: v(5000), cmv: v(20000), ads: v(1000), freight: v(2000), rent: v(3000), interest: v(500) });
    expect(r.liquida).toBe(45000);
    expect(r.lucroBruto).toBe(25000);
    expect(r.operacional).toBe(19000);
    expect(r.contribuicao).toBe(23000); // 45000 − (cmv 20000 + frete 2000) − 0; anúncios e aluguel são fixos
    expect(r.final).toBe(19500);
    expect(r.margemOperacional).toBeCloseTo(42.22, 2);
  });
  it('sem receita, as margens ficam indefinidas', () => {
    expect(Number.isNaN(calcularDre(cats, {}).margemOperacional)).toBe(true);
  });
  it('"preencher depois" e campos vazios deixam o mês pendente; "não se aplica" não', () => {
    const p = pendencias(cats, { gross: v(1), tax: { marca: 'na', valor: null }, cmv: { marca: 'depois', valor: null } });
    expect(p.map(c => c.chave)).toEqual(['cmv', 'ads', 'freight', 'rent', 'interest']);
  });
});

describe('clientes e fornecedores no financeiro', () => {
  it('soma entradas por cliente e saídas por fornecedor no mês, com "Não informado" por último', () => {
    const d = base([
      L({ tipo: 'entrada', data: '2026-11-03', valor: 500, contraparte: 'Loja A' }),
      L({ tipo: 'entrada', data: '2026-11-09', valor: 1500, contraparte: 'Loja B' }),
      L({ tipo: 'entrada', data: '2026-11-12', valor: 250, contraparte: 'Loja A' }),
      L({ tipo: 'entrada', data: '2026-11-15', valor: 9000 }),
      L({ tipo: 'entrada', data: '2026-10-30', valor: 99, contraparte: 'Loja A' }),
      L({ tipo: 'saida', data: '2026-11-04', valor: 300, contraparte: 'Tecelagem' }),
      L({ tipo: 'programada', data: '2026-11-04', valor: 900, contraparte: 'Tecelagem', parcelas: 3, valorParcela: 300 }),
    ]);
    expect(porContraparte(d, '2026-11', 'entrada')).toEqual([['Loja B', 1500], ['Loja A', 750], ['Não informado', 9000]]);
    expect(porContraparte(d, '2026-11', 'saida')).toEqual([['Tecelagem', 300]]);
  });
});
