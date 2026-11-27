import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Material, MaterialInput, MovMaterialInput, RegraConsumo } from '../../api/types';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { useAction } from '../../app/useAction';
import { dataBR, formatBRL, formatNumber, isoDay, nomeDoMes } from '../../lib/format';
import { Button } from '../../ui/Button';
import { BarrasComparadas } from '../../ui/charts';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Banner, Card, PageHeader, Stat } from '../../ui/primitives';
import { parseValor, valorTexto } from '../financeiro/LancamentoForm';
import { cobertura, resumoMateriais, type Cobertura, type SituacaoMaterial } from './calc';

const KEY = ['materiais'] as const;
const qtdTexto = (n: number) => formatNumber(Math.round(n * 1000) / 1000);
const SIT: Record<SituacaoMaterial, { rot: string; tom?: 'danger' | 'warn' | 'ok' | 'info' }> = {
  zerado: { rot: 'Sem estoque', tom: 'danger' }, abaixo: { rot: 'Abaixo do mínimo', tom: 'danger' }, acabando: { rot: 'Acabando', tom: 'warn' },
  ok: { rot: 'OK', tom: 'ok' }, 'sem consumo': { rot: 'Sem consumo' },
};

// ---------------------------------------------------------------- cadastro do material
function MaterialForm({ inicial, onClose }: { inicial?: Material; onClose: () => void }) {
  const api = useApi();
  const boot = useBoot();
  const [nome, setNome] = useState(inicial?.nome ?? '');
  const [unidade, setUnidade] = useState(inicial?.unidade ?? 'm');
  const [minimo, setMinimo] = useState(valorTexto(inicial?.minimo ?? 0));
  const [inicio, setInicio] = useState(inicial?.inicio ?? isoDay(new Date()));
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [obs, setObs] = useState(inicial?.obs ?? '');
  const [regras, setRegras] = useState<{ etapa: string; modelo: string; qtd: string }[]>(
    () => inicial?.regras.map(r => ({ etapa: r.etapa, modelo: r.modelo, qtd: valorTexto(r.qtdPorPeca) })) ?? [],
  );
  const [erro, setErro] = useState('');
  const salvar = useAction((o: MaterialInput) => api.salvarMaterial(o), { success: 'Material salvo.', invalidate: [KEY], onSuccess: onClose });
  const submit = () => {
    if (!nome.trim()) return setErro('Informe o nome.');
    if (!unidade.trim()) return setErro('Informe a unidade.');
    const mn = parseValor(minimo || '0');
    if (!(mn >= 0)) return setErro('Estoque mínimo inválido.');
    const rs: RegraConsumo[] = [];
    for (const r of regras) {
      const q = parseValor(r.qtd);
      if (!r.etapa) return setErro('Escolha a etapa em cada regra de consumo.');
      if (!(q > 0)) return setErro('O consumo por peça precisa ser maior que zero.');
      if (rs.some(x => x.etapa === r.etapa && x.modelo === r.modelo)) return setErro('Há regras repetidas (mesma etapa e modelo).');
      rs.push({ etapa: r.etapa, modelo: r.modelo, qtdPorPeca: q });
    }
    setErro('');
    salvar.mutate({ id: inicial?.id, nome: nome.trim(), unidade: unidade.trim(), minimo: mn, inicio, ativo, obs: obs.trim(), regras: rs });
  };
  return (
    <Dialog open onClose={onClose} title={inicial ? `Editar ${inicial.nome}` : 'Novo material'} variant="drawer" wide
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} onClick={submit}>Salvar</Button></>}>
      <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <TextField label="Material" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Malha moletom" autoFocus />
        <TextField label="Unidade" value={unidade} onChange={e => setUnidade(e.target.value)} hint="kg, m, un, cone…" />
      </div>
      <div className="form-grid">
        <TextField label={`Estoque mínimo (${unidade || 'un'})`} inputMode="decimal" value={minimo} onChange={e => setMinimo(e.target.value)} hint="Abaixo disso o app avisa." />
        <TextField label="Controlar consumo a partir de" type="date" value={inicio} onChange={e => setInicio(e.target.value)} hint="A produção conta a partir desta data." />
      </div>
      <div>
        <b style={{ display: 'block', marginBottom: 4 }}>Consumo na produção</b>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Quanto deste material cada peça gasta, e em qual etapa. O estoque baixa sozinho conforme o Lançar. "Todos os modelos" vale quando não há regra do modelo.</p>
        {regras.map((r, i) => (
          <div key={i} className="form-grid" style={{ gridTemplateColumns: '1fr 1.4fr 1fr auto', alignItems: 'end' }}>
            <SelectField label="Etapa" value={r.etapa} options={boot.etapas} placeholder="Escolha" onChange={e => setRegras(l => l.map((x, j) => (j === i ? { ...x, etapa: e.target.value } : x)))} />
            <SelectField label="Modelo" value={r.modelo} options={[{ value: '', label: 'Todos os modelos' }, ...boot.modelos.map(m => ({ value: m, label: m }))]}
              onChange={e => setRegras(l => l.map((x, j) => (j === i ? { ...x, modelo: e.target.value } : x)))} />
            <TextField label={`${unidade || 'un'} por peça`} inputMode="decimal" value={r.qtd} onChange={e => setRegras(l => l.map((x, j) => (j === i ? { ...x, qtd: e.target.value } : x)))} />
            <Button variant="ghost" iconOnly aria-label="Remover regra" onClick={() => setRegras(l => l.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></Button>
          </div>
        ))}
        <Button icon={<Icon name="plus" size={16} />} onClick={() => setRegras(l => [...l, { etapa: boot.etapas[0] ?? '', modelo: '', qtd: '' }])}>Adicionar regra de consumo</Button>
      </div>
      {inicial && <SelectField label="Situação" value={ativo ? 'Sim' : 'Não'} onChange={e => setAtivo(e.target.value === 'Sim')} options={[{ value: 'Sim', label: 'Ativo' }, { value: 'Não', label: 'Inativo' }]} />}
      <TextAreaField label="Observação" rows={2} value={obs} onChange={e => setObs(e.target.value)} />
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- entrada / saída / contagem
type TipoMov = MovMaterialInput['tipo'];
function MovDialog({ m, tipo, onClose }: { m: Material; tipo: TipoMov; onClose: () => void }) {
  const api = useApi();
  const opc = useQuery({ queryKey: [...KEY, 'opcoes'], queryFn: () => api.materialOpcoes() });
  const [qtd, setQtd] = useState('');
  const [data, setData] = useState(isoDay(new Date()));
  const [valor, setValor] = useState('');
  const [forn, setForn] = useState('');
  const [conta, setConta] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const titulo = tipo === 'entrada' ? `Entrada de ${m.nome}` : tipo === 'saida' ? `Saída de ${m.nome}` : `Contagem de ${m.nome}`;
  const mov = useAction((o: MovMaterialInput) => api.movimentarMaterial(o), {
    success: tipo === 'ajuste' ? 'Estoque ajustado pela contagem.' : 'Movimento registrado.', invalidate: [KEY, ['financeiro']], onSuccess: onClose,
  });
  const submit = () => {
    const q = parseValor(qtd);
    if (tipo === 'ajuste' ? !(q >= 0) : !(q > 0)) return setErro(tipo === 'ajuste' ? 'Informe quanto há no estoque.' : 'Informe a quantidade.');
    const v = valor.trim() ? parseValor(valor) : null;
    if (v !== null && !(v >= 0)) return setErro('Valor inválido.');
    if (conta && !(v && v > 0)) return setErro('Informe o valor da compra para lançar no Financeiro.');
    setErro('');
    mov.mutate({ materialId: m.id, tipo, ...(tipo === 'ajuste' ? { contado: q } : { qtd: q }), data, valor: v, fornecedorId: forn || null, contaId: conta || null, obs: obs.trim() });
  };
  return (
    <Dialog open onClose={onClose} title={titulo}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mov.isPending} onClick={submit}>Confirmar</Button></>}>
      <p className="muted" style={{ margin: 0 }}>Saldo no sistema: <b>{qtdTexto(m.saldo)} {m.unidade}</b></p>
      <div className="form-grid">
        <TextField label={tipo === 'ajuste' ? `Quanto há no estoque (${m.unidade})` : `Quantidade (${m.unidade})`} inputMode="decimal" value={qtd} onChange={e => setQtd(e.target.value)} autoFocus />
        <TextField label="Data" type="date" value={data} onChange={e => setData(e.target.value)} />
      </div>
      {tipo === 'ajuste' && <p className="muted" style={{ margin: 0, fontSize: 13 }}>A diferença para o saldo do sistema fica registrada como ajuste.</p>}
      {tipo === 'entrada' && <>
        <div className="form-grid">
          <TextField label="Valor total da compra (R$)" inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} placeholder="opcional"
            hint={parseValor(valor) > 0 && parseValor(qtd) > 0 ? `${formatBRL(parseValor(valor) / parseValor(qtd))} por ${m.unidade}` : 'Usado no custo médio.'} />
          <SelectField label="Fornecedor" value={forn} onChange={e => setForn(e.target.value)} placeholder="—" options={(opc.data?.fornecedores ?? []).map(f => ({ value: f.id, label: f.nome }))} />
        </div>
        {(opc.data?.contas.length ?? 0) > 0 && (
          <SelectField label="Lançar a compra no Financeiro" value={conta} onChange={e => setConta(e.target.value)}
            options={[{ value: '', label: 'Não lançar' }, ...opc.data!.contas.map(c => ({ value: c.id, label: `Saída da conta ${c.nome}` }))]} />
        )}
      </>}
      <TextField label="Observação" value={obs} onChange={e => setObs(e.target.value)} placeholder={tipo === 'saida' ? 'Ex.: perda, amostra, devolução' : ''} />
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- histórico
function Historico({ m, onClose }: { m: Material; onClose: () => void }) {
  const api = useApi();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: [...KEY, 'movs', m.id], queryFn: () => api.movsMaterial(m.id) });
  const apagar = useAction((id: string) => api.apagarMovMaterial(id), { success: 'Movimento excluído.', invalidate: [KEY] });
  return (
    <Dialog open onClose={onClose} title={`${m.nome} · histórico`} variant="drawer" wide footer={<Button onClick={onClose}>Fechar</Button>}>
      <QueryView query={q}>
        {h => (
          <div className="stack" style={{ gap: 16 }}>
            {h.consumoMensal.some(c => c.qtd > 0) && (
              <BarrasComparadas titulo={`Consumo pela produção (${m.unidade})`} altura={170} series={[{ label: `Consumo (${m.unidade})`, color: 'var(--viz-2)' }]}
                grupos={h.consumoMensal.map(c => ({ label: nomeDoMes(c.mes).slice(0, 3), valores: [Math.round(c.qtd * 10) / 10] }))} />
            )}
            <b>Entradas, saídas e contagens</b>
            {h.movimentos.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nenhum movimento ainda.</p> : (
              <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
                {h.movimentos.map(v => (
                  <div className="item" key={v.id}>
                    <div className="item-main">
                      <b>{v.tipo === 'entrada' ? 'Entrada' : v.tipo === 'saida' ? 'Saída' : 'Ajuste de contagem'}{v.fornecedor ? ` · ${v.fornecedor}` : ''}</b>
                      <small>{dataBR(v.data)}{v.valor ? ` · ${formatBRL(v.valor)}` : ''}{v.noFinanceiro ? ' · no Financeiro' : ''}{v.obs ? ` · ${v.obs}` : ''}{v.por ? ` · ${v.por}` : ''}</small>
                    </div>
                    <b className={`tnum ${v.tipo === 'entrada' || (v.tipo === 'ajuste' && v.qtd > 0) ? 'valor-pos' : ''}`}>
                      {v.tipo === 'saida' || v.qtd < 0 ? '−' : '+'}{qtdTexto(Math.abs(v.qtd))} {m.unidade}
                    </b>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Excluir movimento" onClick={async () => {
                      if (await confirm({ title: 'Excluir este movimento?', message: 'O saldo é recalculado.', confirmLabel: 'Excluir', tone: 'danger' })) apagar.mutate(v.id);
                    }}><Icon name="trash" size={15} /></Button>
                  </div>
                ))}
              </div>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              Saldo = entradas ({qtdTexto(m.entradas)}) − saídas ({qtdTexto(m.saidas)}) {m.ajustes >= 0 ? '+' : '−'} ajustes ({qtdTexto(Math.abs(m.ajustes))}) − consumo da produção desde {dataBR(m.inicio)} ({qtdTexto(m.consumo)}) = <b>{qtdTexto(m.saldo)} {m.unidade}</b>
            </p>
          </div>
        )}
      </QueryView>
    </Dialog>
  );
}

// ---------------------------------------------------------------- página
export default function MateriaisPage() {
  const api = useApi();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.materiais() });
  const [form, setForm] = useState<Material | null | undefined>(undefined);
  const [mov, setMov] = useState<{ m: Material; tipo: TipoMov } | null>(null);
  const [hist, setHist] = useState<Material | null>(null);
  return (
    <>
      <PageHeader title="Matéria-prima" subtitle="Estoque de malhas, linhas e aviamentos, com baixa automática pela produção"
        actions={<Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setForm(null)}>Novo material</Button>} />
      <QueryView query={q}>{lista => <Lista lista={lista} onEditar={setForm} onMov={(m, tipo) => setMov({ m, tipo })} onHist={setHist} />}</QueryView>
      {form !== undefined && <MaterialForm inicial={form ?? undefined} onClose={() => setForm(undefined)} />}
      {mov && <MovDialog m={mov.m} tipo={mov.tipo} onClose={() => setMov(null)} />}
      {hist && <Historico m={hist} onClose={() => setHist(null)} />}
    </>
  );
}

function Lista({ lista, onEditar, onMov, onHist }: {
  lista: Material[]; onEditar: (m: Material) => void; onMov: (m: Material, t: TipoMov) => void; onHist: (m: Material) => void;
}) {
  const api = useApi();
  const confirm = useConfirm();
  const apagar = useAction((id: string) => api.apagarMaterial(id), { success: 'Material excluído.', invalidate: [KEY] });
  const r = resumoMateriais(lista);
  const linhas = useMemo(() => lista.map(m => ({ m, c: cobertura(m) })), [lista]);
  type L = { m: Material; c: Cobertura };
  const ordemSit: SituacaoMaterial[] = ['zerado', 'abaixo', 'acabando', 'ok', 'sem consumo'];
  const cols: Column<L>[] = [
    { id: 'nome', header: 'Material', value: x => x.m.nome,
      cell: x => <button type="button" className="link-empresa" onClick={() => onHist(x.m)}><b>{x.m.nome}</b>{!x.m.ativo && <Badge>inativo</Badge>}
        <small>{x.m.regras.length ? `${x.m.regras.length} regra(s) de consumo` : 'sem baixa automática'}</small></button> },
    { id: 'sit', header: 'Situação', value: x => ordemSit.indexOf(x.c.situacao), cell: x => <Badge tone={SIT[x.c.situacao].tom}>{SIT[x.c.situacao].rot}</Badge> },
    { id: 'saldo', header: 'Saldo', numeric: true, value: x => x.m.saldo,
      cell: x => <><b className={`tnum${x.m.saldo < x.m.minimo ? ' valor-neg' : ''}`}>{qtdTexto(x.m.saldo)} {x.m.unidade}</b><small>mínimo {qtdTexto(x.m.minimo)}</small></> },
    { id: 'dura', header: 'Dura', numeric: true, value: x => x.c.dias ?? 1e9,
      cell: x => (x.c.dias === null ? <span className="muted">—</span> : <>{x.c.dias} dia(s)<small>{qtdTexto(x.c.porDia)} {x.m.unidade}/dia</small></>) },
    { id: 'custo', header: 'Custo médio', numeric: true, value: x => x.m.custoMedio ?? -1,
      cell: x => (x.m.custoMedio === null ? '—' : <>{formatBRL(x.m.custoMedio)}<small>por {x.m.unidade}</small></>) },
    {
      id: 'acoes', header: '', cell: x => (
        <span className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end', gap: 4 }}>
          <Button size="sm" onClick={() => onMov(x.m, 'entrada')}>Entrada</Button>
          <Button size="sm" variant="ghost" onClick={() => onMov(x.m, 'saida')}>Saída</Button>
          <Button size="sm" variant="ghost" onClick={() => onMov(x.m, 'ajuste')}>Contagem</Button>
          <Button size="sm" variant="ghost" iconOnly aria-label={`Editar ${x.m.nome}`} onClick={() => onEditar(x.m)}><Icon name="pencil" size={15} /></Button>
          <Button size="sm" variant="ghost" iconOnly aria-label={`Excluir ${x.m.nome}`} onClick={async () => {
            if (await confirm({ title: `Excluir ${x.m.nome}?`, message: 'Apaga também os movimentos. Fica registrado na Atividade.', confirmLabel: 'Excluir', tone: 'danger' })) apagar.mutate(x.m.id);
          }}><Icon name="trash" size={15} /></Button>
        </span>
      ),
    },
  ];
  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Materiais ativos" value={r.ativos} />
        <Stat label="Precisam de compra" value={r.alerta} tone={r.alerta ? 'danger' : 'ok'} hint="abaixo do mínimo ou acabando em 7 dias" />
        <Stat label="Valor em estoque" value={formatBRL(r.valorEstoque)} hint="saldo × custo médio" />
      </div>
      {r.criticos.length > 0 && <Banner tone="danger"><b>Comprar:</b> {r.criticos.join(', ')}.</Banner>}
      <Card title="Estoque" subtitle="Clique no material para ver o histórico e o consumo por mês." flush>
        <DataTable label="Matéria-prima" columns={cols} rows={linhas} rowKey={x => x.m.id} searchable exportName="materia-prima"
          initialSort={{ id: 'sit', dir: 1 }} empty="Nenhum material cadastrado. Clique em “Novo material”." />
      </Card>
    </div>
  );
}
