import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FinLancamento } from '../../api/types';
import { useApi } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { dataBR, formatBRL, nomeDoMes } from '../../lib/format';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { useConfirm } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Card, PageHeader, Segmented, Stat } from '../../ui/primitives';
import { APagarTab, AjustesTab, ContasTab, MetasTab, PlanejamentoTab } from './abas';
import { compromissos, fluxoMes, gastosPorCategoria, saldoConta, saldoTotal, totalGuardado } from './calc';
import { LancamentoForm } from './LancamentoForm';
import { Barras, FIN_KEY, FinProvider, MesPicker, nomeCartao, nomeConta, useFin } from './shared';

type Aba = 'geral' | 'lancamentos' | 'apagar' | 'contas' | 'metas' | 'planejamento' | 'ajustes';

function VisaoGeral({ mes }: { mes: string }) {
  const d = useFin();
  const fluxo = fluxoMes(d, mes);
  const saldo = saldoTotal(d);
  const comp = compromissos(d, id => nomeCartao(d, id));
  const doMes = comp.filter(c => c.data.startsWith(mes));
  const aPagarMes = doMes.reduce((s, c) => s + c.valor, 0);
  const gastos = gastosPorCategoria(d, mes);
  const proximos = comp.filter(c => c.data >= d.hoje).slice(0, 6);

  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Saldo em contas" value={formatBRL(saldo)} hint="hoje, todas as contas" tone={saldo < 0 ? 'danger' : undefined} />
        <Stat label={`Entradas · ${nomeDoMes(mes).split(' ')[0]}`} value={formatBRL(fluxo.entradas)} tone="ok" />
        <Stat label={`Saídas · ${nomeDoMes(mes).split(' ')[0]}`} value={formatBRL(fluxo.saidas)} hint="inclui compras no cartão" />
        <Stat label="A pagar no mês" value={formatBRL(aPagarMes)} hint={`${doMes.length} vencimento(s)`} />
        <Stat label="Guardado em metas" value={formatBRL(totalGuardado(d))} />
      </div>
      <div className="grid-2">
        <Card title="Para onde foi o dinheiro" subtitle={`Saídas de ${nomeDoMes(mes)} por categoria`}>
          <Barras itens={gastos} total={gastos.reduce((s, [, v]) => s + v, 0)} />
        </Card>
        <Card title="Próximos vencimentos" subtitle="Parcelas e faturas em aberto" flush>
          {proximos.length === 0 ? <div className="table-empty">Nada a pagar por enquanto.</div> : (
            <div className="list">
              {proximos.map((c, i) => (
                <div className="item" key={i}>
                  <div className="item-main"><b>{c.descricao}</b><small>{dataBR(c.data)} · {c.tipo === 'fatura' ? 'Fatura de cartão' : 'Parcela'}</small></div>
                  <b className="tnum">{formatBRL(c.valor)}</b>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Card title="Saldo por conta" flush>
        <div className="list">
          {d.contas.filter(c => c.ativa).map(c => {
            const s = saldoConta(d, c.id);
            return (
              <div className="item" key={c.id}>
                <div className="item-main"><b>{c.nome}</b></div>
                <b className={s < 0 ? 'valor-neg' : 'tnum'}>{formatBRL(s)}</b>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Lancamentos({ mes }: { mes: string }) {
  const api = useApi();
  const d = useFin();
  const confirm = useConfirm();
  const [filtro, setFiltro] = useState<'todos' | 'entrada' | 'saida' | 'programada'>('todos');
  const [editando, setEditando] = useState<FinLancamento | null | undefined>(undefined);
  const apagar = useAction((id: string) => api.finApagarLancamento(id), { success: 'Lançamento excluído.', invalidate: [FIN_KEY] });

  const linhas = useMemo(
    () => d.lancamentos.filter(l => (l.tipo === 'programada' ? l.data.slice(0, 7) <= mes : l.data.startsWith(mes)) && (filtro === 'todos' || l.tipo === filtro)),
    [d.lancamentos, mes, filtro],
  );

  const cols: Column<FinLancamento>[] = [
    { id: 'data', header: 'Data', value: l => l.data, cell: l => dataBR(l.data), nowrap: true },
    { id: 'desc', header: 'Descrição', value: l => l.descricao, cell: l => <>{l.descricao}<small>{[l.categoria, l.centro].filter(Boolean).join(' · ') || '—'}</small></> },
    {
      id: 'tipo', header: 'Tipo', value: l => l.tipo,
      cell: l => l.tipo === 'entrada' ? <Badge tone="ok">Entrada</Badge>
        : l.tipo === 'saida' ? <Badge>{l.cartaoId ? 'Cartão' : 'Saída'}</Badge>
        : <Badge tone="info">{l.parcelas}x · {l.cartaoId ? 'cartão' : `${l.parcelasPagas} paga(s)`}</Badge>,
    },
    { id: 'conta', header: 'Conta / cartão', value: l => (l.cartaoId ? nomeCartao(d, l.cartaoId) : nomeConta(d, l.contaId)), cell: l => (l.cartaoId ? nomeCartao(d, l.cartaoId) : nomeConta(d, l.contaId)) },
    {
      id: 'valor', header: 'Valor', numeric: true, value: l => (l.tipo === 'entrada' ? l.valor : -l.valor),
      cell: l => <span className={l.tipo === 'entrada' ? 'valor-pos' : 'tnum'}>{l.tipo === 'entrada' ? '+' : '−'} {formatBRL(l.valor)}</span>,
    },
    {
      id: 'acoes', header: '',
      cell: l => (
        <span className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" iconOnly aria-label="Editar" onClick={() => setEditando(l)}><Icon name="pencil" size={15} /></Button>
          <Button size="sm" variant="ghost" iconOnly aria-label="Excluir" onClick={async () => {
            if (await confirm({ title: 'Excluir lançamento?', message: `${l.descricao} · ${formatBRL(l.valor)}`, confirmLabel: 'Excluir', tone: 'danger' })) apagar.mutate(l.id);
          }}><Icon name="trash" size={15} /></Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <Card flush title={`Lançamentos de ${nomeDoMes(mes)}`} subtitle="Contas programadas aparecem a partir do mês da compra."
        actions={<Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setEditando(null)}>Novo lançamento</Button>}>
        <DataTable label="Lançamentos" columns={cols} rows={linhas} rowKey={l => l.id} searchable exportName={`lancamentos-${mes}`}
          empty="Nenhum lançamento neste mês." initialSort={{ id: 'data', dir: -1 }}
          toolbar={<span className="no-print"><Segmented label="Filtrar" value={filtro} onChange={setFiltro}
            options={[{ value: 'todos', label: 'Todos' }, { value: 'entrada', label: 'Entradas' }, { value: 'saida', label: 'Saídas' }, { value: 'programada', label: 'A pagar' }]} /></span>} />
      </Card>
      {editando !== undefined && <LancamentoForm inicial={editando ?? undefined} onClose={() => setEditando(undefined)} />}
    </>
  );
}

export default function FinanceiroPage() {
  const api = useApi();
  const q = useQuery({ queryKey: FIN_KEY, queryFn: () => api.finDados() });
  const [aba, setAba] = useState<Aba>('geral');
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [novo, setNovo] = useState(false);

  return (
    <>
      <PageHeader title="Financeiro" subtitle="Entradas, saídas, contas a pagar, cartões e metas da empresa"
        actions={<>
          <MesPicker mes={mes} onChange={setMes} />
          <Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setNovo(true)} disabled={!q.data}>Lançar</Button>
        </>} />
      <QueryView query={q}>
        {d => (
          <FinProvider value={d}>
            <div className="stack">
              <div>
                <Segmented<Aba> label="Seções do financeiro" value={aba} onChange={setAba} options={[
                  { value: 'geral', label: 'Visão geral' }, { value: 'lancamentos', label: 'Lançamentos' }, { value: 'apagar', label: 'A pagar' },
                  { value: 'contas', label: 'Contas e cartões' }, { value: 'metas', label: 'Metas' }, { value: 'planejamento', label: 'Planejamento' },
                  { value: 'ajustes', label: 'Ajustes' },
                ]} />
              </div>
              {aba === 'geral' && <VisaoGeral mes={mes} />}
              {aba === 'lancamentos' && <Lancamentos mes={mes} />}
              {aba === 'apagar' && <APagarTab />}
              {aba === 'contas' && <ContasTab />}
              {aba === 'metas' && <MetasTab />}
              {aba === 'planejamento' && <PlanejamentoTab mes={mes} />}
              {aba === 'ajustes' && <AjustesTab />}
            </div>
            {novo && <LancamentoForm onClose={() => setNovo(false)} />}
          </FinProvider>
        )}
      </QueryView>
    </>
  );
}
