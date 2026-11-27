import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DreCategoria, DreDados, DreGrupo, DreItemInput, DreMarca, DreValor } from '../../api/types';
import { useApi } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { dataBR, formatBRL, somarMes } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { SelectField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Banner, Card, EmptyState, PageHeader, Segmented, Stat } from '../../ui/primitives';
import { MesPicker } from '../financeiro/shared';
import { parseValor, valorTexto } from '../financeiro/LancamentoForm';
import { LucroModelos } from './LucroModelos';
import { GRUPOS, calcularDre, nomeMes, pendencias, type DreResultado } from './calc';

const KEY = ['dre'];
type Aba = 'geral' | 'preencher' | 'detalhada' | 'lucro' | 'historico' | 'categorias';

const pct = (n: number) => (Number.isFinite(n) ? `${(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');
const ativas = (d: DreDados) => d.categorias.filter(c => c.ativa).sort((a, b) => a.ordem - b.ordem);
const valoresDe = (d: DreDados, mes: string) => d.meses.find(m => m.mes === mes)?.valores ?? {};

// ---------------------------------------------------------------- Visão geral
function VisaoGeral({ d, mes, irPara }: { d: DreDados; mes: string; irPara: (a: Aba) => void }) {
  const cats = ativas(d);
  const reg = d.meses.find(m => m.mes === mes);
  const r = calcularDre(cats, reg?.valores ?? {});
  const ant = calcularDre(cats, valoresDe(d, somarMes(mes, -1)));
  const falta = pendencias(cats, reg?.valores ?? {});
  const delta = (a: number, b: number) => (b ? `${a >= b ? '▲' : '▼'} ${formatBRL(Math.abs(a - b))} vs mês anterior` : undefined);

  if (!reg) {
    return (
      <Card>
        <EmptyState icon="trend" title={`${nomeMes(mes)} ainda não foi preenchido`}>
          Responda algumas perguntas simples (vendas, custos, despesas) e veja quanto a empresa lucrou.
          <div style={{ marginTop: 14 }}><Button variant="primary" onClick={() => irPara('preencher')}>Preencher o mês</Button></div>
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="stack">
      {falta.length > 0 && (
        <Banner tone="warn">Faltam {falta.length} item(ns) neste mês: {falta.slice(0, 4).map(c => c.nome).join(', ')}{falta.length > 4 ? '…' : ''}.{' '}
          <button type="button" className="link" onClick={() => irPara('preencher')}>Completar</button></Banner>
      )}
      <div className="grid-kpi">
        <Stat label="Receita líquida" value={formatBRL(r.liquida)} hint={delta(r.liquida, ant.liquida)} />
        <Stat label="Lucro bruto" value={formatBRL(r.lucroBruto)} hint={`margem ${pct(r.margemBruta)}`} tone={r.lucroBruto < 0 ? 'danger' : undefined} />
        <Stat label="Resultado operacional" value={formatBRL(r.operacional)} hint={`margem ${pct(r.margemOperacional)}`} tone={r.operacional < 0 ? 'danger' : 'ok'} />
        <Stat label="Resultado final" value={formatBRL(r.final)} hint={delta(r.final, ant.final)} tone={r.final < 0 ? 'danger' : 'ok'} />
      </div>
      <div className="grid-2">
        <Card title="Margens" subtitle="Quanto sobra de cada R$ 100 vendidos (receita líquida).">
          <div className="barras">
            {[['Margem bruta', r.margemBruta], ['Margem de contribuição', r.margemContribuicao], ['Margem operacional', r.margemOperacional]].map(([n, v]) => (
              <div className="barra" key={n as string}>
                <div className="barra-top"><span>{n}</span><b className={Number(v) < 0 ? 'valor-neg' : 'tnum'}>{pct(v as number)}</b></div>
                <div className="progress"><span style={{ width: `${Number.isFinite(v) ? Math.max(0, Math.min(100, v as number)) : 0}%`, background: Number(v) < 0 ? 'var(--danger)' : 'var(--brand)' }} /></div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Para onde vai a receita" subtitle="Cada grupo em % da receita líquida.">
          <div className="barras">
            {([['Custos diretos', r.diretos], ['Gastos para vender', r.vendas], ['Despesas administrativas', r.admin]] as [string, number][]).map(([n, v]) => (
              <div className="barra" key={n}>
                <div className="barra-top"><span>{n}</span><b className="tnum">{formatBRL(v)} · {pct(r.liquida ? (v / r.liquida) * 100 : NaN)}</b></div>
                <div className="progress"><span style={{ width: `${r.liquida ? Math.min(100, (v / r.liquida) * 100) : 0}%`, background: 'var(--brand)' }} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Demonstrativo gerencial simplificado, para decisão. Não substitui a DRE contábil do seu contador.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Preencher
function MarcaBotoes({ v, onChange }: { v: DreMarca | undefined; onChange: (m: DreMarca) => void }) {
  const ops: [DreMarca, string][] = [['valor', 'Tenho o valor'], ['na', 'Não se aplica'], ['depois', 'Depois']];
  return (
    <div className="marca-grupo" role="radiogroup">
      {ops.map(([m, l]) => <button key={m} type="button" role="radio" aria-checked={v === m} className={v === m ? 'on' : ''} onClick={() => onChange(m)}>{l}</button>)}
    </div>
  );
}

function Preencher({ d, mes, onSalvo }: { d: DreDados; mes: string; onSalvo: () => void }) {
  const api = useApi();
  const cats = ativas(d);
  const inicial = valoresDe(d, mes);
  const [vals, setVals] = useState<Record<string, { marca: DreMarca; texto: string }>>(() =>
    Object.fromEntries(cats.map(c => [c.id, { marca: inicial[c.id]?.marca ?? 'depois', texto: valorTexto(inicial[c.id]?.valor ?? null) }])));
  const [grupo, setGrupo] = useState<DreGrupo>('sales');

  const atual: Record<string, DreValor> = Object.fromEntries(Object.entries(vals).map(([id, v]) => {
    const n = parseValor(v.texto);
    return [id, { marca: v.marca, valor: v.marca === 'valor' && Number.isFinite(n) ? n : null }];
  }));
  const r = calcularDre(cats, atual);
  const falta = pendencias(cats, atual);

  const salvar = useAction(() => {
    const itens: DreItemInput[] = cats.map(c => ({ categoriaId: c.id, marca: atual[c.id]!.marca, valor: atual[c.id]!.valor }));
    return api.dreSalvarMes(mes, itens);
  }, { success: s => (s === 'fechado' ? 'Mês fechado: todas as linhas respondidas.' : 'Salvo. Ainda há itens para depois.'), invalidate: [KEY], onSuccess: onSalvo });

  const set = (id: string, patch: Partial<{ marca: DreMarca; texto: string }>) => setVals(s => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  const g = GRUPOS.find(x => x.id === grupo)!;
  const doGrupo = cats.filter(c => c.grupo === grupo);
  const idx = GRUPOS.findIndex(x => x.id === grupo);

  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Receita líquida" value={formatBRL(r.liquida)} />
        <Stat label="Resultado final" value={formatBRL(r.final)} tone={r.final < 0 ? 'danger' : 'ok'} hint={`margem op. ${pct(r.margemOperacional)}`} />
        <Stat label="Respondidas" value={`${cats.length - falta.length}/${cats.length}`} hint={falta.length ? 'o mês fica pendente' : 'mês completo'} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <Segmented<DreGrupo> label="Grupos" value={grupo} onChange={setGrupo} options={GRUPOS.map(x => ({ value: x.id, label: x.titulo }))} />
      </div>
      <Card title={g.pergunta} subtitle={g.ajuda} flush>
        {doGrupo.length === 0 ? <div className="table-empty">Nenhuma categoria ativa neste grupo.</div> : doGrupo.map(c => {
          const v = vals[c.id]!;
          return (
            <div className="dre-linha" key={c.id}>
              <div className="nome"><b>{c.nome}</b> {c.essencial && <Badge tone="info">essencial</Badge>}<small>{c.nota || (c.tipo === 'plus' ? 'Soma ao resultado' : 'Subtrai do resultado')}</small></div>
              <input className="input" inputMode="decimal" aria-label={`Valor de ${c.nome}`} placeholder="0,00" value={v.texto} disabled={v.marca === 'na'}
                onChange={e => set(c.id, { texto: e.target.value, marca: 'valor' })} />
              <MarcaBotoes v={v.marca} onChange={m => set(c.id, { marca: m })} />
            </div>
          );
        })}
      </Card>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button disabled={idx <= 0} onClick={() => setGrupo(GRUPOS[idx - 1]!.id)}>‹ Anterior</Button>
        <div className="row">
          {idx < GRUPOS.length - 1 && <Button onClick={() => setGrupo(GRUPOS[idx + 1]!.id)}>Próximo ›</Button>}
          <Button variant="primary" loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar {nomeMes(mes).split(' ')[0]}</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- DRE detalhada
function Detalhada({ d, mes }: { d: DreDados; mes: string }) {
  const cats = ativas(d);
  const vals = valoresDe(d, mes);
  const r = calcularDre(cats, vals);
  const p = (n: number) => pct(r.liquida ? (n / r.liquida) * 100 : NaN);
  const val = (c: DreCategoria) => (vals[c.id]?.marca === 'valor' ? Number(vals[c.id]?.valor ?? 0) : 0);
  const linhas = (grupo: DreGrupo, tipo?: 'plus' | 'minus') => cats.filter(c => c.grupo === grupo && (!tipo || c.tipo === tipo)).map(c => (
    <tr key={c.id} className="soft">
      <td style={{ paddingLeft: 28 }}>{c.nome}{vals[c.id]?.marca === 'na' ? ' (n/a)' : !vals[c.id] || vals[c.id]?.marca === 'depois' ? ' (pendente)' : ''}</td>
      <td className="num">{c.tipo === 'minus' && val(c) ? '− ' : ''}{formatBRL(val(c))}</td><td className="num">{p(val(c))}</td>
    </tr>
  ));
  const total = (nome: string, bruto: number, cls = 'major') => { const v = bruto || 0; return (
    <tr className={cls}><td>{nome}</td><td className={`num ${v < 0 ? 'valor-neg' : ''}`}>{formatBRL(v)}</td><td className="num">{p(v)}</td></tr>
  ); };

  return (
    <Card title={`DRE gerencial · ${nomeMes(mes)}`} subtitle="Valores do mês e % da receita líquida." flush
      actions={<Button size="sm" icon={<Icon name="printer" size={15} />} onClick={() => window.print()}>Imprimir</Button>}>
      <div className="table-wrap">
        <table className="table dre-tabela">
          <thead><tr><th>Linha</th><th className="num">Valor</th><th className="num">% receita</th></tr></thead>
          <tbody>
            {total('Receita bruta', r.bruto)}{linhas('sales', 'plus')}
            {total('(−) Deduções de vendas', -r.deducoes)}{linhas('sales', 'minus')}
            {total('= Receita líquida', r.liquida, 'result')}
            {total('(−) Custos diretos', -r.diretos)}{linhas('direct')}
            {total('= Lucro bruto', r.lucroBruto, 'result')}
            {total('(−) Gastos para vender', -r.vendas)}{linhas('selling')}
            {total('(−) Despesas administrativas', -r.admin)}{linhas('admin')}
            {total('= Resultado operacional', r.operacional, 'result')}
            {total('(+) Ganhos financeiros', r.financeiro)}{linhas('finance')}
            {total('= Resultado final', r.final, 'result')}
            {total('Margem de contribuição', r.contribuicao, 'soft')}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Histórico
function Historico({ d, abrir }: { d: DreDados; abrir: (mes: string) => void }) {
  const api = useApi();
  const confirm = useConfirm();
  const cats = ativas(d);
  const apagar = useAction((mes: string) => api.dreApagarMes(mes), { success: 'Mês excluído.', invalidate: [KEY] });
  const meses = [...d.meses].sort((a, b) => b.mes.localeCompare(a.mes));
  const linhas: [string, DreResultado][] = meses.map(m => [m.mes, calcularDre(cats, m.valores)]);

  if (!meses.length) return <Card><EmptyState icon="calendar" title="Nenhum mês preenchido">Comece pelo mês atual em “Preencher mês”.</EmptyState></Card>;
  return (
    <Card title="Histórico" subtitle="Clique no mês para abrir." flush>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Mês</th><th>Situação</th><th className="num">Receita líquida</th><th className="num">Lucro bruto</th><th className="num">Operacional</th><th className="num">Final</th><th className="num">Margem op.</th><th /></tr></thead>
          <tbody>
            {linhas.map(([mes, r]) => {
              const m = meses.find(x => x.mes === mes)!;
              return (
                <tr key={mes}>
                  <td><button type="button" className="link" onClick={() => abrir(mes)}>{nomeMes(mes)}</button><small>atualizado {dataBR(m.atualizadoEm)}</small></td>
                  <td>{m.status === 'fechado' ? <Badge tone="ok">Fechado</Badge> : <Badge tone="warn">Pendente</Badge>}</td>
                  <td className="num">{formatBRL(r.liquida)}</td><td className="num">{formatBRL(r.lucroBruto)}</td>
                  <td className={`num ${r.operacional < 0 ? 'valor-neg' : ''}`}>{formatBRL(r.operacional)}</td>
                  <td className={`num ${r.final < 0 ? 'valor-neg' : ''}`}>{formatBRL(r.final)}</td>
                  <td className="num">{pct(r.margemOperacional)}</td>
                  <td className="num">
                    <Button size="sm" variant="ghost" iconOnly aria-label={`Excluir ${nomeMes(mes)}`} onClick={async () => {
                      if (await confirm({ title: `Excluir ${nomeMes(mes)}?`, message: 'Os valores desse mês serão apagados.', confirmLabel: 'Excluir', tone: 'danger' })) apagar.mutate(mes);
                    }}><Icon name="trash" size={15} /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Categorias
function CategoriaDialog({ cat, onClose }: { cat?: DreCategoria; onClose: () => void }) {
  const api = useApi();
  const [nome, setNome] = useState(cat?.nome ?? '');
  const [grupo, setGrupo] = useState<DreGrupo>(cat?.grupo ?? 'admin');
  const [varia, setVaria] = useState<'variable' | 'fixed'>(cat?.variabilidade ?? 'fixed');
  const [nota, setNota] = useState(cat?.nota ?? '');
  const [ativa, setAtiva] = useState(cat?.ativa ?? true);
  const [erro, setErro] = useState('');
  const salvar = useAction(() => api.dreSalvarCategoria({
    id: cat?.id, nome: nome.trim(), grupo, variabilidade: varia, nota, ativa,
    tipo: cat?.tipo ?? (grupo === 'finance' ? 'plus' : 'minus'),
  }), { success: 'Categoria salva.', invalidate: [KEY], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={cat ? 'Editar categoria' : 'Nova categoria'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending}
        onClick={() => (nome.trim() ? (setErro(''), salvar.mutate()) : setErro('Informe o nome.'))}>Salvar</Button></>}>
      <TextField label="Nome" value={nome} onChange={e => setNome(e.target.value)} autoFocus />
      {!cat && <SelectField label="Grupo" value={grupo} onChange={e => setGrupo(e.target.value as DreGrupo)}
        options={GRUPOS.filter(g => g.id !== 'sales').map(g => ({ value: g.id, label: g.titulo }))} />}
      <SelectField label="Comportamento" value={varia} onChange={e => setVaria(e.target.value as 'variable' | 'fixed')}
        options={[{ value: 'variable', label: 'Variável (acompanha as vendas)' }, { value: 'fixed', label: 'Fixo (todo mês, vendendo ou não)' }]} />
      <TextField label="Ajuda (opcional)" value={nota} onChange={e => setNota(e.target.value)} />
      {cat && !cat.essencial && <SelectField label="Situação" value={ativa ? 'Sim' : 'Não'} onChange={e => setAtiva(e.target.value === 'Sim')}
        options={[{ value: 'Sim', label: 'Ativa' }, { value: 'Não', label: 'Inativa (não aparece mais)' }]} />}
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    </Dialog>
  );
}

function Categorias({ d }: { d: DreDados }) {
  const api = useApi();
  const confirm = useConfirm();
  const [editando, setEditando] = useState<DreCategoria | null | undefined>(undefined);
  const restaurar = useAction(() => api.dreRestaurarCategorias(), { success: 'Categorias padrão restauradas.', invalidate: [KEY] });
  const cats = [...d.categorias].sort((a, b) => a.ordem - b.ordem);
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={async () => {
          if (await confirm({ title: 'Restaurar categorias padrão?', message: 'Reativa as categorias originais. Suas categorias e valores continuam.', confirmLabel: 'Restaurar' })) restaurar.mutate();
        }}>Restaurar padrão</Button>
        <Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setEditando(null)}>Nova categoria</Button>
      </div>
      {GRUPOS.map(g => (
        <Card key={g.id} title={g.titulo} flush>
          <div className="list">
            {cats.filter(c => c.grupo === g.id).map(c => (
              <div className="item" key={c.id}>
                <div className="item-main">
                  <b>{c.nome} {c.essencial && <Badge tone="info">essencial</Badge>} {!c.ativa && <Badge>inativa</Badge>}</b>
                  <small>{c.tipo === 'plus' ? 'Soma' : 'Subtrai'} · {c.variabilidade === 'variable' ? 'variável' : 'fixo'}{c.nota ? ` · ${c.nota}` : ''}</small>
                </div>
                <Button size="sm" variant="ghost" iconOnly aria-label={`Editar ${c.nome}`} onClick={() => setEditando(c)}><Icon name="pencil" size={15} /></Button>
              </div>
            ))}
          </div>
        </Card>
      ))}
      {editando !== undefined && <CategoriaDialog cat={editando ?? undefined} onClose={() => setEditando(undefined)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Página
export default function DrePage() {
  const api = useApi();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.dreDados() });
  const [aba, setAba] = useState<Aba>('geral');
  const [mes, setMes] = useState(() => somarMes(new Date().toISOString().slice(0, 7), 0));

  return (
    <>
      <PageHeader title="Resultado da empresa" subtitle="DRE gerencial: quanto a empresa vendeu, gastou e lucrou no mês"
        actions={<MesPicker mes={mes} onChange={setMes} />} />
      <QueryView query={q}>
        {d => (
          <div className="stack">
            <div style={{ overflowX: 'auto' }} className="no-print">
              <Segmented<Aba> label="Seções do resultado" value={aba} onChange={setAba} options={[
                { value: 'geral', label: 'Visão geral' }, { value: 'preencher', label: 'Preencher mês' }, { value: 'detalhada', label: 'DRE detalhada' }, { value: 'lucro', label: 'Lucro por modelo' },
                { value: 'historico', label: 'Histórico' }, { value: 'categorias', label: 'Categorias' },
              ]} />
            </div>
            {aba === 'geral' && <VisaoGeral d={d} mes={mes} irPara={setAba} />}
            {aba === 'preencher' && <Preencher key={mes} d={d} mes={mes} onSalvo={() => setAba('geral')} />}
            {aba === 'detalhada' && <Detalhada d={d} mes={mes} />}
            {aba === 'lucro' && <LucroModelos mes={mes} />}
            {aba === 'historico' && <Historico d={d} abrir={m => { setMes(m); setAba('detalhada'); }} />}
            {aba === 'categorias' && <Categorias d={d} />}
          </div>
        )}
      </QueryView>
    </>
  );
}
