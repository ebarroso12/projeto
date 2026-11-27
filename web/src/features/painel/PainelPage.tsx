import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Painel, Presenca, Saldo } from '../../api/types';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { formatNumber, primeiroNome, saudacao } from '../../lib/format';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Card, PageHeader, Stat } from '../../ui/primitives';
import { EditadoList, FaltaItem } from '../shared/parts';

const presencaCols: Column<Presenca>[] = [
  { id: 'nome', header: 'Nome', value: r => r.nome, cell: r => <>{r.nome}<small>{r.setor}</small></> },
  { id: 'entrada', header: 'Entrada', value: r => r.entrada, cell: r => r.entrada || <Badge tone="danger">não veio</Badge>, nowrap: true },
  { id: 'saida', header: 'Saída', value: r => r.saida, cell: r => r.saida, nowrap: true },
  { id: 'extra', header: 'Extra', value: r => r.extra, cell: r => (r.extra ? <b>{r.extra}</b> : ''), nowrap: true },
];

const saldoCols: Column<Saldo>[] = [
  { id: 'modelo', header: 'Modelo', value: r => r.modelo, cell: r => r.modelo },
  { id: 'cor', header: 'Cor', value: r => r.cor, cell: r => r.cor },
  { id: 'tam', header: 'Tam.', value: r => r.tamanho, cell: r => r.tamanho },
  { id: 'corte', header: 'Cortado', numeric: true, value: r => r.corte, cell: r => formatNumber(r.corte) },
  { id: 'costura', header: 'Costurado', numeric: true, value: r => r.costura, cell: r => formatNumber(r.costura) },
  { id: 'conf', header: 'Conferido', numeric: true, value: r => r.conf, cell: r => formatNumber(r.conf) },
  { id: 'naCostura', header: 'Na costura', numeric: true, value: r => r.naCostura, cell: r => formatNumber(r.naCostura) },
  { id: 'naConf', header: 'Na conf.', numeric: true, value: r => r.naConf, cell: r => formatNumber(r.naConf) },
  { id: 'status', header: 'Situação', value: r => (r.erro ? 'Erro' : 'OK'), cell: r => (r.erro ? <Badge tone="danger">conferir</Badge> : <Badge tone="ok">ok</Badge>) },
];

function PainelView({ p }: { p: Painel }) {
  const { etapas, emFalta } = useBoot();
  const presentes = p.presenca.filter(x => x.entrada).length;
  const erros = p.saldo.filter(s => s.erro).length;

  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Presentes hoje" value={`${presentes}/${p.presenca.length}`} hint="funcionários que marcaram entrada" tone={presentes === p.presenca.length && presentes > 0 ? 'ok' : undefined} />
        {etapas.map(e => <Stat key={e} label={`${e} hoje`} value={formatNumber(p.prodHoje[e] ?? 0)} hint="peças lançadas" />)}
        <Stat label="Linhas com erro" value={erros} hint="etapa lançou mais do que recebeu" tone={erros ? 'danger' : 'ok'} />
      </div>

      {p.editados.length > 0 && (
        <Card tone="alert" title={`Alerta: ${p.editados.length} lançamento(s) editado(s) hoje`} flush>
          <EditadoList items={p.editados} />
        </Card>
      )}

      <div className="grid-2">
        <Card title="Ponto de hoje" flush>
          <DataTable label="Ponto de hoje" columns={presencaCols} rows={p.presenca} rowKey={(r, i) => `${r.nome}${i}`} empty="Cadastre os funcionários na aba Cadastros." />
        </Card>
        <Card title="Em falta agora" subtitle="Produzir primeiro" flush
          actions={<Link to="/falta" className="btn btn-sm btn-secondary" style={{ textDecoration: 'none' }}>Ver todos</Link>}>
          {emFalta.length === 0
            ? <div className="table-empty">Nada em falta agora.</div>
            : <div className="list">{emFalta.slice(0, 4).map(f => <FaltaItem key={f.id} f={f} />)}</div>}
        </Card>
      </div>

      <Card title="Onde estão as peças" subtitle="Do corte ao estoque. Linha vermelha: uma etapa lançou mais do que recebeu, confira." flush>
        <DataTable label="Saldo por etapa" columns={saldoCols} rows={p.saldo} searchable exportName="saldo-por-etapa"
          rowKey={(r, i) => `${r.modelo}|${r.cor}|${r.tamanho}|${i}`} rowClass={r => (r.erro ? 'row-erro' : undefined)}
          empty="Nenhum lançamento ainda." initialSort={{ id: 'modelo', dir: 1 }} pageSize={40} maxHeight={560} />
      </Card>
    </div>
  );
}

export default function PainelPage() {
  const api = useApi();
  const { eu } = useBoot();
  const [, setTick] = useState(0); // refaz a saudação (bom dia/boa tarde) com o painel aberto o dia todo
  useEffect(() => { const t = window.setInterval(() => setTick(x => x + 1), 5 * 60_000); return () => window.clearInterval(t); }, []);
  const nome = primeiroNome(eu.nome);
  const q = useQuery({ queryKey: ['painel'], queryFn: () => api.painel(), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader title={eu.leitura || !nome ? 'Painel' : `${saudacao()}, ${nome}`} subtitle="Produção e presença de hoje · atualiza sozinho a cada minuto"
        actions={<Button icon={<Icon name="refresh" size={16} />} loading={q.isFetching && !q.isPending} onClick={() => void q.refetch()}>Atualizar</Button>} />
      <QueryView query={q}>{p => <PainelView p={p} />}</QueryView>
    </>
  );
}
