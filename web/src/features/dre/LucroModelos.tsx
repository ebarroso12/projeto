import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LucroModelo } from '../../api/types';
import { useApi } from '../../app/auth';
import { formatBRL, formatNumber, nomeDoMes } from '../../lib/format';
import { DataTable, type Column } from '../../ui/DataTable';
import { QueryView } from '../../ui/QueryView';
import { Banner, Card, EmptyState, Stat } from '../../ui/primitives';
import { lucroDoModelo, totaisLucro, type LucroCalc } from '../produtividade/calc';

const fimDoMes = (mes: string) => { const [y, m] = mes.split('-').map(Number); return `${mes}-${String(new Date(y!, m!, 0).getDate()).padStart(2, '0')}`; };

/** Lucro estimado de cada modelo no mês: peças conferidas × (preço − custo − mão de obra por peça). */
export function LucroModelos({ mes }: { mes: string }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['lucro-modelos', mes], queryFn: () => api.dreLucroModelos(`${mes}-01`, fimDoMes(mes)) });
  return <QueryView query={q}>{lista => <Tabela lista={lista} mes={mes} />}</QueryView>;
}

function Tabela({ lista, mes }: { lista: LucroModelo[]; mes: string }) {
  const linhas = useMemo(() => lista.map(m => ({ m, c: lucroDoModelo(m) })), [lista]);
  const t = totaisLucro(lista);
  type L = { m: LucroModelo; c: LucroCalc };
  const cols: Column<L>[] = [
    { id: 'modelo', header: 'Modelo', value: x => x.m.modelo, cell: x => <><b>{x.m.modelo}</b>{!x.m.cadastrado && <small>sem preço no cadastro</small>}</> },
    { id: 'pecas', header: 'Prontas', numeric: true, value: x => x.m.produzidas, cell: x => formatNumber(x.m.produzidas) },
    { id: 'preco', header: 'Preço', numeric: true, value: x => x.m.preco ?? -1, cell: x => (x.m.preco ? formatBRL(x.m.preco) : '—') },
    { id: 'custo', header: 'Custo + mão de obra', numeric: true, value: x => (x.m.custo ?? 0) + x.m.maoDeObraPeca,
      cell: x => <>{formatBRL((x.m.custo ?? 0) + x.m.maoDeObraPeca)}<small>{formatBRL(x.m.custo ?? 0)} + {formatBRL(x.m.maoDeObraPeca)}</small></> },
    { id: 'lucroPeca', header: 'Lucro/peça', numeric: true, value: x => x.c.lucroPeca ?? -1e9,
      cell: x => (x.c.lucroPeca === null ? '—' : <><b className={x.c.lucroPeca < 0 ? 'valor-neg' : 'valor-pos'}>{formatBRL(x.c.lucroPeca)}</b><small>margem {formatNumber(x.c.margem ?? 0)}%</small></>) },
    { id: 'lucro', header: 'Lucro no mês', numeric: true, value: x => x.c.lucro ?? -1e12,
      cell: x => (x.c.lucro === null ? '—' : <b className={x.c.lucro < 0 ? 'valor-neg' : 'tnum'}>{formatBRL(x.c.lucro)}</b>) },
    { id: 'entregue', header: 'Vendido (pedidos)', numeric: true, value: x => x.m.entreguesValor,
      cell: x => (x.m.entreguesPecas ? <>{formatBRL(x.m.entreguesValor)}<small>{formatNumber(x.m.entreguesPecas)} peça(s)</small></> : <span className="muted">—</span>) },
  ];
  if (!lista.length) return <Card><EmptyState icon="trend" title={`Sem produção em ${nomeDoMes(mes)}`}>O lucro por modelo usa a produção conferida no mês.</EmptyState></Card>;
  const melhor = [...linhas].filter(x => x.c.margem !== null).sort((a, b) => b.c.margem! - a.c.margem!);
  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Lucro estimado" value={formatBRL(t.lucro)} tone={t.lucro < 0 ? 'danger' : 'ok'} hint={t.margem !== null ? `margem ${formatNumber(t.margem)}%` : undefined} />
        <Stat label="Receita das peças prontas" value={formatBRL(t.receita)} hint={`${formatNumber(t.pecas)} peça(s)`} />
        <Stat label="Material" value={formatBRL(t.custoMaterial)} />
        <Stat label="Mão de obra" value={formatBRL(t.maoDeObra)} hint="valor por peça × peças prontas" />
      </div>
      {t.semCadastro > 0 && <Banner tone="warn">{t.semCadastro} modelo(s) sem preço no cadastro de produtos ficaram fora do lucro. Cadastre em Cadastros → Produtos (preço e custo).</Banner>}
      {melhor.length >= 2 && (
        <Banner tone="info">Mais lucrativo: <b>{melhor[0]!.m.modelo}</b> ({formatNumber(melhor[0]!.c.margem!)}% de margem). Menos lucrativo: <b>{melhor[melhor.length - 1]!.m.modelo}</b> ({formatNumber(melhor[melhor.length - 1]!.c.margem!)}%).</Banner>
      )}
      <Card title={`Lucro por modelo · ${nomeDoMes(mes)}`} subtitle="Preço e custo vêm do cadastro de produtos; mão de obra, do valor por peça (Produtividade)." flush>
        <DataTable label="Lucro por modelo" columns={cols} rows={linhas} rowKey={x => x.m.modelo} exportName={`lucro-modelos-${mes}`} initialSort={{ id: 'lucro', dir: -1 }} empty="Sem dados." />
      </Card>
    </div>
  );
}
