import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LinhaModelo, Pessoa, PorPessoa, Registro, Relatorio } from '../../api/types';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { dataBR, formatNumber, periodRange, type Period } from '../../lib/format';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Card, PageHeader, Segmented, Stat } from '../../ui/primitives';
import { EditadoList } from '../shared/parts';

type Tab = 'resumo' | 'modelo' | 'presenca' | 'registros' | 'editados';

const pessoaCols: Column<PorPessoa>[] = [
  { id: 'nome', header: 'Nome', value: r => r.nome, cell: r => r.nome },
  { id: 'etapa', header: 'Etapa', value: r => r.etapa, cell: r => r.etapa },
  { id: 'qtd', header: 'Peças', numeric: true, value: r => r.qtd, cell: r => formatNumber(r.qtd) },
];

const presencaCols: Column<Pessoa>[] = [
  { id: 'nome', header: 'Nome', value: r => r.nome, cell: r => <>{r.nome}{r.semSaida > 0 && <small>{r.semSaida}x sem marcar saída</small>}</> },
  { id: 'dias', header: 'Dias', numeric: true, value: r => r.diasTrab, cell: r => r.diasTrab },
  { id: 'horas', header: 'Horas', numeric: true, value: r => r.horas, cell: r => r.horas },
  { id: 'extras', header: 'Extras', numeric: true, value: r => r.extras, cell: r => <b>{r.extras}</b> },
  {
    id: 'faltas', header: 'Faltas', value: r => r.faltas.length,
    cell: r => (r.faltas.length ? <><Badge tone="danger">{r.faltas.length}</Badge> <small style={{ display: 'inline' }}>{r.faltas.map(dataBR).join(', ')}</small></> : <Badge tone="ok">0</Badge>),
  },
];

const registroCols: Column<Registro>[] = [
  { id: 'data', header: 'Dia', value: r => r.data, cell: r => dataBR(r.data), nowrap: true },
  { id: 'nome', header: 'Nome', value: r => r.nome, cell: r => r.nome },
  { id: 'entrada', header: 'Entrada', value: r => r.entrada, cell: r => r.entrada, nowrap: true },
  {
    id: 'saida', header: 'Saída', value: r => r.saida,
    cell: r => (r.saida ? <>{r.saida} {r.auto && <Badge tone="warn">automático</Badge>}</> : <Badge tone="danger">em aberto</Badge>), nowrap: true,
  },
  { id: 'extra', header: 'Extra', value: r => r.extra, cell: r => (r.extra ? <b>{r.extra}</b> : ''), nowrap: true },
];

function RelatorioView({ r, tab }: { r: Relatorio; tab: Tab }) {
  const { etapas } = useBoot();

  if (tab === 'resumo') {
    return (
      <div className="stack">
        <div className="grid-kpi">
          {etapas.map(e => <Stat key={e} label={e} value={formatNumber(r.porEtapa[e] ?? 0)} hint="peças no período" />)}
          <Stat label="Dias de trabalho" value={r.diasUteis} hint="dias úteis até hoje" />
        </div>
        <Card title="Produção por pessoa" flush>
          <DataTable label="Produção por pessoa" columns={pessoaCols} rows={r.porPessoa} searchable exportName="producao-por-pessoa"
            rowKey={(x, i) => `${x.nome}${x.etapa}${i}`} empty="Sem lançamentos no período." initialSort={{ id: 'qtd', dir: -1 }} />
        </Card>
      </div>
    );
  }

  if (tab === 'modelo') {
    const cols: Column<LinhaModelo>[] = [
      { id: 'modelo', header: 'Modelo', value: x => x.modelo, cell: x => x.modelo },
      { id: 'cor', header: 'Cor', value: x => x.cor, cell: x => x.cor },
      { id: 'tam', header: 'Tam.', value: x => x.tamanho, cell: x => x.tamanho },
      ...etapas.map(e => ({ id: e, header: e, numeric: true, value: (x: LinhaModelo) => x.valores[e] ?? 0, cell: (x: LinhaModelo) => formatNumber(x.valores[e] ?? 0) })),
    ];
    return (
      <Card title="Por modelo, cor e tamanho" flush>
        <DataTable label="Por modelo" columns={cols} rows={r.porModelo} searchable exportName="producao-por-modelo"
          rowKey={(x, i) => `${x.modelo}|${x.cor}|${x.tamanho}|${i}`} empty="Sem lançamentos no período." initialSort={{ id: 'modelo', dir: 1 }} maxHeight={600} />
      </Card>
    );
  }

  if (tab === 'presenca') {
    return (
      <Card title={`Presença (${r.diasUteis} dias de trabalho)`} flush>
        <DataTable label="Presença" columns={presencaCols} rows={r.pessoas} exportName="presenca" rowKey={(x, i) => `${x.nome}${i}`} empty="Sem funcionários cadastrados." />
      </Card>
    );
  }

  if (tab === 'registros') {
    return (
      <Card title="Entradas e saídas" flush>
        <DataTable label="Entradas e saídas" columns={registroCols} rows={r.registros} searchable exportName="entradas-e-saidas"
          rowKey={(x, i) => `${x.data}${x.nome}${i}`} empty="Sem registros no período." pageSize={40} maxHeight={600} />
      </Card>
    );
  }

  return <Card title="Lançamentos editados" flush><EditadoList items={r.editados} withDate /></Card>;
}

export default function RelatorioPage() {
  const api = useApi();
  const [range, setRange] = useState(() => periodRange('semana'));
  const [preset, setPreset] = useState<Period | 'custom'>('semana');
  const [tab, setTab] = useState<Tab>('resumo');
  const valid = Boolean(range.ini && range.fim && range.ini <= range.fim);
  const q = useQuery({ queryKey: ['relatorio', range.ini, range.fim], queryFn: () => api.relatorio(range.ini, range.fim), enabled: valid });

  const choose = (p: Period) => { setPreset(p); setRange(periodRange(p)); };

  return (
    <>
      <PageHeader title="Relatório" subtitle="Produção, presença e horas extras por período"
        actions={<Button icon={<Icon name="refresh" size={16} />} loading={q.isFetching && !q.isPending} onClick={() => void q.refetch()} disabled={!valid}>Atualizar</Button>} />

      <div className="stack">
        <Card>
          <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
            <Segmented<Period | 'custom'> label="Período" value={preset} onChange={v => v !== 'custom' && choose(v)}
              options={[{ value: 'semana', label: 'Esta semana' }, { value: 'mes', label: 'Este mês' }, { value: 'mesPassado', label: 'Mês passado' }, ...(preset === 'custom' ? [{ value: 'custom' as const, label: 'Personalizado' }] : [])]} />
            <div style={{ width: 160 }}><TextField label="De" type="date" value={range.ini} onChange={e => { setPreset('custom'); setRange(r => ({ ...r, ini: e.target.value })); }} /></div>
            <div style={{ width: 160 }}><TextField label="Até" type="date" value={range.fim} onChange={e => { setPreset('custom'); setRange(r => ({ ...r, fim: e.target.value })); }} /></div>
          </div>
          {!valid && <p className="err" style={{ marginTop: 8, color: 'var(--danger)' }}>Escolha as duas datas, com o início antes do fim.</p>}
        </Card>

        <Segmented<Tab> label="Seção do relatório" value={tab} onChange={setTab} options={[
          { value: 'resumo', label: 'Resumo' }, { value: 'modelo', label: 'Por modelo' }, { value: 'presenca', label: 'Presença' },
          { value: 'registros', label: 'Entradas e saídas' }, { value: 'editados', label: 'Editados' },
        ]} />

        {valid && <QueryView query={q}>{r => <RelatorioView r={r} tab={tab} />}</QueryView>}
      </div>
    </>
  );
}
