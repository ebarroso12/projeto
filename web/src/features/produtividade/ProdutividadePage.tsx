import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Produtividade, ValorPeca } from '../../api/types';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { pode } from '../../app/registry';
import { useAction } from '../../app/useAction';
import { dataBR, formatBRL, formatNumber, isoDay } from '../../lib/format';
import { Button } from '../../ui/Button';
import { BarrasComparadas } from '../../ui/charts';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { SelectField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { PeriodoPicker, usePeriodo } from '../../ui/Periodo';
import { QueryView } from '../../ui/QueryView';
import { Badge, Banner, Card, EmptyState, PageHeader, Segmented, Stat } from '../../ui/primitives';
import { parseValor, valorTexto } from '../financeiro/LancamentoForm';
import { indicadores } from './calc';

type Aba = 'ranking' | 'valores' | 'pagamentos';
const KEY = 'produtividade';

// ---------------------------------------------------------------- pagar produção
function FecharDialog({ d, ini, fim, onClose }: { d: Produtividade; ini: string; fim: string; onClose: () => void }) {
  const api = useApi();
  const fin = useQuery({ queryKey: ['financeiro'], queryFn: () => api.finDados() });
  const contas = (fin.data?.contas ?? []).filter(c => c.ativa);
  const pagaveis = d.pessoas.filter(p => p.valor > 0 && !p.fechado);
  const [sel, setSel] = useState<Set<string>>(() => new Set(pagaveis.map(p => p.login)));
  const [conta, setConta] = useState('');
  const [data, setData] = useState(isoDay(new Date()));
  const [erro, setErro] = useState('');
  const contaSel = conta || contas[0]?.id || '';
  const total = pagaveis.filter(p => sel.has(p.login)).reduce((s, p) => s + p.valor, 0);
  const fechar = useAction(() => api.finFecharProducao(ini, fim, contaSel, data, [...sel]), {
    success: n => `${n} pagamento(s) lançado(s) no Financeiro.`, invalidate: [[KEY], ['financeiro']], onSuccess: onClose,
  });
  const submit = () => {
    if (!sel.size) return setErro('Escolha pelo menos uma pessoa.');
    if (!contaSel) return setErro('Escolha a conta.');
    setErro('');
    fechar.mutate();
  };
  return (
    <Dialog open onClose={onClose} title="Pagar produção do período"
      footer={<><span className="muted tnum" style={{ marginRight: 'auto' }}>Total: <b>{formatBRL(total)}</b></span>
        <Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={fechar.isPending} onClick={submit}>Lançar pagamentos</Button></>}>
      <p className="muted" style={{ margin: 0 }}>{dataBR(ini)} a {dataBR(fim)}. Cada pessoa vira uma <b>saída</b> em "Folha de pagamento" no Financeiro, e o período fica marcado como pago.</p>
      {pagaveis.length === 0 ? <Banner tone="info">Ninguém com valor a pagar neste período (ou todos já foram pagos).</Banner> : (
        <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
          {pagaveis.map(p => (
            <label className="item" key={p.login} style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.has(p.login)} onChange={e => setSel(s => { const n = new Set(s); if (e.target.checked) n.add(p.login); else n.delete(p.login); return n; })} />
              <div className="item-main"><b>{p.nome}</b><small>{formatNumber(p.pecas)} peça(s)</small></div>
              <b className="tnum">{formatBRL(p.valor)}</b>
            </label>
          ))}
        </div>
      )}
      <div className="form-grid">
        <SelectField label="Sai da conta" value={contaSel} onChange={e => setConta(e.target.value)} options={contas.map(c => ({ value: c.id, label: c.nome }))} placeholder={fin.isLoading ? 'Carregando…' : 'Escolha'} />
        <TextField label="Data do pagamento" type="date" value={data} onChange={e => setData(e.target.value)} />
      </div>
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- valores por peça
function ValoresTab({ valores }: { valores: ValorPeca[] }) {
  const api = useApi();
  const boot = useBoot();
  const etapas = boot.etapas;
  const geral = (e: string) => valores.find(v => v.etapa === e && v.modelo === '')?.valor;
  const [gerais, setGerais] = useState<Record<string, string>>({});
  const [especificos, setEspecificos] = useState<{ etapa: string; modelo: string; valor: string }[]>([]);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setGerais(Object.fromEntries(etapas.map(e => [e, geral(e) !== undefined ? valorTexto(geral(e)) : ''])));
    setEspecificos(valores.filter(v => v.modelo).map(v => ({ etapa: v.etapa, modelo: v.modelo, valor: valorTexto(v.valor) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valores]);
  const salvar = useAction((l: ValorPeca[]) => api.salvarValoresPeca(l), { success: 'Valores por peça salvos.', invalidate: [[KEY]] });
  const submit = () => {
    const lista: ValorPeca[] = [];
    for (const e of etapas) {
      if (!gerais[e]?.trim()) continue;
      const v = parseValor(gerais[e]!);
      if (!(v >= 0)) return setErro(`Valor inválido em ${e}.`);
      lista.push({ etapa: e, modelo: '', valor: v });
    }
    for (const x of especificos) {
      if (!x.modelo || !x.etapa) return setErro('Escolha a etapa e o modelo em cada valor específico.');
      const v = parseValor(x.valor);
      if (!(v >= 0)) return setErro(`Valor inválido em ${x.modelo}.`);
      if (lista.some(l => l.etapa === x.etapa && l.modelo === x.modelo)) return setErro(`${x.modelo} · ${x.etapa} está repetido.`);
      lista.push({ etapa: x.etapa, modelo: x.modelo, valor: v });
    }
    setErro('');
    salvar.mutate(lista);
  };
  return (
    <Card title="Valor pago por peça" subtitle="Usado para calcular o pagamento por produção e a mão de obra no lucro por modelo."
      actions={<Button variant="primary" loading={salvar.isPending} onClick={submit}>Salvar valores</Button>}>
      <div className="stack" style={{ gap: 16 }}>
        <div>
          <b style={{ display: 'block', marginBottom: 8 }}>Valor geral por etapa</b>
          <div className="form-grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}>
            {etapas.map(e => <TextField key={e} label={`${e} (R$/peça)`} inputMode="decimal" placeholder="0,00" value={gerais[e] ?? ''}
              onChange={ev => setGerais(g => ({ ...g, [e]: ev.target.value }))} />)}
          </div>
        </div>
        <div>
          <b style={{ display: 'block', marginBottom: 4 }}>Valores específicos por modelo</b>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Ex.: a jaqueta paga mais na costura. Vale no lugar do valor geral da etapa.</p>
          {especificos.map((x, i) => (
            <div key={i} className="form-grid" style={{ gridTemplateColumns: '1fr 1.4fr 1fr auto', alignItems: 'end' }}>
              <SelectField label="Etapa" value={x.etapa} options={etapas} placeholder="Escolha" onChange={e => setEspecificos(l => l.map((y, j) => (j === i ? { ...y, etapa: e.target.value } : y)))} />
              <SelectField label="Modelo" value={x.modelo} options={boot.modelos} placeholder="Escolha" onChange={e => setEspecificos(l => l.map((y, j) => (j === i ? { ...y, modelo: e.target.value } : y)))} />
              <TextField label="R$/peça" inputMode="decimal" value={x.valor} onChange={e => setEspecificos(l => l.map((y, j) => (j === i ? { ...y, valor: e.target.value } : y)))} />
              <Button variant="ghost" iconOnly aria-label="Remover" onClick={() => setEspecificos(l => l.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></Button>
            </div>
          ))}
          <Button icon={<Icon name="plus" size={16} />} onClick={() => setEspecificos(l => [...l, { etapa: etapas[1] ?? etapas[0] ?? '', modelo: '', valor: '' }])}>Adicionar valor específico</Button>
        </div>
        {erro && <p className="err" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{erro}</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- página
export default function ProdutividadePage() {
  const api = useApi();
  const { eu } = useBoot();
  const per = usePeriodo('mes');
  const { range, valido } = per;
  const q = useQuery({ queryKey: [KEY, range.ini, range.fim], queryFn: () => api.produtividade(range.ini, range.fim), enabled: valido });
  const [aba, setAba] = useState<Aba>('ranking');
  const [pagando, setPagando] = useState(false);
  const comFin = pode(eu, 'financeiro');

  return (
    <>
      <PageHeader title="Produtividade" subtitle="Peças por pessoa, ritmo no ponto e pagamento por produção"
        actions={comFin && q.data ? <Button variant="primary" icon={<Icon name="wallet" size={16} />} onClick={() => setPagando(true)}>Pagar produção</Button> : undefined} />
      <div className="stack">
        <Card><PeriodoPicker p={per} /></Card>
        <Segmented<Aba> label="Seções" value={aba} onChange={setAba} options={[
          { value: 'ranking', label: 'Por pessoa' }, { value: 'valores', label: 'Valor por peça' }, { value: 'pagamentos', label: 'Pagamentos do período' },
        ]} />
        <QueryView query={q}>
          {d => aba === 'valores' ? <ValoresTab valores={d.valores} /> : aba === 'pagamentos' ? <Pagamentos d={d} /> : <Ranking d={d} semValores={!d.valores.length} />}
        </QueryView>
      </div>
      {pagando && q.data && <FecharDialog d={q.data} ini={range.ini} fim={range.fim} onClose={() => setPagando(false)} />}
    </>
  );
}

function Ranking({ d, semValores }: { d: Produtividade; semValores: boolean }) {
  const boot = useBoot();
  const linhas = useMemo(() => d.pessoas.map(p => ({ p, i: indicadores(p) })), [d.pessoas]);
  type L = (typeof linhas)[number];
  const total = d.pessoas.reduce((s, p) => s + p.pecas, 0);
  const totalValor = d.pessoas.reduce((s, p) => s + p.valor, 0);
  const media = d.porDia.length ? Math.round(total / d.porDia.length) : 0;
  const cols: Column<L>[] = [
    { id: 'nome', header: 'Pessoa', value: x => x.p.nome, cell: x => <><b>{x.p.nome}</b><small>{x.p.setor}</small></> },
    { id: 'etapas', header: 'Por etapa', value: x => Object.keys(x.p.porEtapa).join(), cell: x => boot.etapas.filter(e => x.p.porEtapa[e]).map(e => `${e}: ${formatNumber(x.p.porEtapa[e]!)}`).join(' · ') || '—' },
    { id: 'pecas', header: 'Peças', numeric: true, value: x => x.p.pecas, cell: x => <b className="tnum">{formatNumber(x.p.pecas)}</b> },
    { id: 'dia', header: 'Por dia', numeric: true, value: x => x.i.pecasPorDia, cell: x => <>{formatNumber(x.i.pecasPorDia)}<small>{x.p.diasPonto || x.p.diasProducao} dia(s)</small></> },
    { id: 'hora', header: 'Por hora', numeric: true, value: x => x.i.pecasPorHora ?? -1, cell: x => (x.i.pecasPorHora !== null ? <>{formatNumber(x.i.pecasPorHora)}<small>{formatNumber(x.i.horas)} h no ponto</small></> : <span className="muted">—</span>) },
    { id: 'valor', header: 'A pagar', numeric: true, value: x => x.p.valor,
      cell: x => <>{x.p.valor ? <b className="tnum">{formatBRL(x.p.valor)}</b> : <span className="muted">—</span>}{x.p.fechado && <small><Badge tone="ok">pago</Badge></small>}</> },
  ];
  if (!d.pessoas.length) return <Card><EmptyState icon="activity" title="Sem produção no período">Os números aparecem quando a equipe lançar produção no Lançar.</EmptyState></Card>;
  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Peças no período" value={formatNumber(total)} hint={`${d.porDia.length} dia(s) com produção`} />
        <Stat label="Média por dia" value={formatNumber(media)} />
        <Stat label="Pessoas produzindo" value={d.pessoas.length} />
        <Stat label="Pagamento por produção" value={formatBRL(totalValor)} hint={semValores ? 'defina os valores por peça' : 'no período'} />
      </div>
      {semValores && <Banner tone="info">Para calcular o pagamento por produção, defina o valor de cada peça na aba <b>Valor por peça</b>.</Banner>}
      {d.porDia.length > 1 && (
        <Card title="Peças por dia">
          <BarrasComparadas titulo="Peças produzidas por dia" altura={190} series={[{ label: 'Peças', color: 'var(--viz-1)' }]}
            grupos={d.porDia.map(x => ({ label: dataBR(x.dia).slice(0, 5), valores: [x.pecas] }))} />
        </Card>
      )}
      <Card title="Por pessoa" flush>
        <DataTable label="Produtividade por pessoa" columns={cols} rows={linhas} rowKey={x => x.p.login} searchable exportName="produtividade" initialSort={{ id: 'pecas', dir: -1 }} empty="Sem produção." />
      </Card>
    </div>
  );
}

function Pagamentos({ d }: { d: Produtividade }) {
  const api = useApi();
  const confirm = useConfirm();
  const desfazer = useAction((id: string) => api.finDesfazerFechamento(id), { success: 'Pagamento desfeito e retirado do Financeiro.', invalidate: [[KEY], ['financeiro']] });
  if (!d.fechamentos.length) return <Card><EmptyState icon="wallet" title="Nenhum pagamento neste período">Use “Pagar produção” para lançar os pagamentos no Financeiro.</EmptyState></Card>;
  return (
    <Card title="Pagamentos de produção" subtitle="Períodos já pagos (que se sobrepõem ao período escolhido)." flush>
      <div className="list">
        {d.fechamentos.map(f => (
          <div className="item" key={f.id}>
            <div className="item-main"><b>{f.nome}</b><small>{dataBR(f.ini)} a {dataBR(f.fim)} · {formatNumber(f.pecas)} peça(s){f.pago ? ' · lançado no Financeiro' : ''}</small></div>
            <b className="tnum">{formatBRL(f.valor)}</b>
            <Button size="sm" variant="ghost" onClick={async () => {
              if (await confirm({ title: `Desfazer o pagamento de ${f.nome}?`, message: 'A saída também sai do Financeiro.', confirmLabel: 'Desfazer', tone: 'danger' })) desfazer.mutate(f.id);
            }}>Desfazer</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
