import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Pedido, PedidoInput, PedidoReceber } from '../../api/types';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { pode } from '../../app/registry';
import { useAction } from '../../app/useAction';
import { dataBR, dataCompleta, formatBRL, formatNumber, isoDay } from '../../lib/format';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Banner, Card, EmptyState, PageHeader, Segmented, Stat } from '../../ui/primitives';
import { parseValor, valorTexto } from '../financeiro/LancamentoForm';
import { andamento, filaProducao, resumo, type Andamento, type Situacao } from './calc';

const KEY = ['pedidos'] as const;
type Aba = 'abertos' | 'fila' | 'entregues' | 'cancelados';

const SITUACAO: Record<Situacao, { rotulo: string; tom: 'danger' | 'warn' | 'ok' | 'info' | 'neutral' }> = {
  atrasado: { rotulo: 'Atrasado', tom: 'danger' }, urgente: { rotulo: 'Entrega em breve', tom: 'warn' }, pronto: { rotulo: 'Pronto para entregar', tom: 'ok' },
  'no prazo': { rotulo: 'No prazo', tom: 'info' }, 'sem prazo': { rotulo: 'Sem prazo', tom: 'neutral' }, entregue: { rotulo: 'Entregue', tom: 'ok' }, cancelado: { rotulo: 'Cancelado', tom: 'neutral' },
};

function prazoTexto(a: Andamento, p: Pedido) {
  if (p.status === 'entregue') return `entregue ${dataBR(p.entregueEm)}`;
  if (!p.entrega) return 'sem data de entrega';
  const d = a.diasParaEntrega ?? 0;
  return d < 0 ? `${-d} dia(s) de atraso` : d === 0 ? 'entrega hoje' : `faltam ${d} dia(s)`;
}

/** Três barras finas: quanto do pedido já passou por cada etapa. */
function Barras({ a, etapas }: { a: Andamento; etapas: string[] }) {
  return (
    <div className="ped-barras" aria-label={etapas.map(e => `${e}: ${a.feito[e]} de ${a.total}`).join(', ')}>
      {etapas.map(e => (
        <div key={e} className="ped-barra" title={`${e}: ${a.feito[e]} de ${a.total}`}>
          <span className="ped-barra-rot">{e}</span>
          <span className="ped-barra-trilho"><span style={{ width: `${a.pct[e]}%` }} className={a.pct[e] === 100 ? 'cheia' : ''} /></span>
          <span className="ped-barra-num tnum">{a.pct[e]}%</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- formulário
interface Grupo { modelo: string; cor: string; preco: string; qtds: Record<string, string> }

function agrupar(p?: Pedido): Grupo[] {
  if (!p) return [];
  const m = new Map<string, Grupo>();
  for (const i of p.itens) {
    const k = `${i.modelo}|${i.cor}|${i.preco}`;
    const g = m.get(k) ?? { modelo: i.modelo, cor: i.cor, preco: valorTexto(i.preco), qtds: {} };
    g.qtds[i.tamanho] = String((Number(g.qtds[i.tamanho]) || 0) + i.qtd);
    m.set(k, g);
  }
  return [...m.values()];
}

function PedidoForm({ inicial, onClose }: { inicial?: Pedido; onClose: () => void }) {
  const api = useApi();
  const boot = useBoot();
  const opc = useQuery({ queryKey: [...KEY, 'opcoes'], queryFn: () => api.pedidoOpcoes() });
  const hoje = isoDay(new Date());
  const [cliente, setCliente] = useState(inicial ? (inicial.clienteId ?? '__outro') : '');
  const [clienteNome, setClienteNome] = useState(inicial && !inicial.clienteId ? inicial.cliente : '');
  const [dataPedido, setDataPedido] = useState(inicial?.dataPedido ?? hoje);
  const [entrega, setEntrega] = useState(inicial?.entrega ?? '');
  const [obs, setObs] = useState(inicial?.obs ?? '');
  const [grupos, setGrupos] = useState<Grupo[]>(() => {
    const g = agrupar(inicial);
    return g.length ? g : [{ modelo: '', cor: '', preco: '', qtds: {} }];
  });
  const [erro, setErro] = useState('');
  const salvar = useAction((o: PedidoInput) => api.salvarPedido(o), {
    success: r => (inicial ? `Pedido #${r.numero} atualizado.` : `Pedido #${r.numero} criado.`), invalidate: [KEY], onSuccess: onClose,
  });

  const setG = (i: number, mud: Partial<Grupo>) => setGrupos(gs => gs.map((g, j) => (j === i ? { ...g, ...mud } : g)));
  const total = grupos.reduce((s, g) => s + Object.values(g.qtds).reduce((a, q) => a + (Number(q) || 0), 0), 0);
  const valor = grupos.reduce((s, g) => s + Object.values(g.qtds).reduce((a, q) => a + (Number(q) || 0), 0) * (parseValor(g.preco) || 0), 0);

  const submit = () => {
    const itens = grupos.flatMap(g => boot.tamanhos.filter(t => Number(g.qtds[t]) > 0)
      .map(t => ({ modelo: g.modelo, cor: g.cor, tamanho: t, qtd: Number(g.qtds[t]), preco: parseValor(g.preco) || 0 })));
    if (!cliente) return setErro('Escolha o cliente.');
    if (cliente === '__outro' && !clienteNome.trim()) return setErro('Informe o nome do cliente.');
    if (grupos.some(g => !g.modelo || !g.cor)) return setErro('Escolha modelo e cor em cada item.');
    if (grupos.some(g => g.preco.trim() && !(parseValor(g.preco) >= 0))) return setErro('Preço inválido.');
    if (!itens.length) return setErro('Informe a quantidade em pelo menos um tamanho.');
    if (entrega && entrega < dataPedido) return setErro('A entrega não pode ser antes da data do pedido.');
    setErro('');
    salvar.mutate({
      id: inicial?.id, clienteId: cliente === '__outro' ? null : cliente, clienteNome: cliente === '__outro' ? clienteNome.trim() : undefined,
      dataPedido, entrega: entrega || null, obs: obs.trim(), itens,
    });
  };

  const clientes = opc.data?.clientes ?? [];
  return (
    <Dialog open onClose={onClose} title={inicial ? `Editar pedido #${inicial.numero}` : 'Novo pedido'} variant="drawer" wide
      footer={<>
        <span className="muted tnum" style={{ marginRight: 'auto' }}>{formatNumber(total)} peça(s){valor > 0 ? ` · ${formatBRL(valor)}` : ''}</span>
        <Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} onClick={submit}>Salvar pedido</Button>
      </>}>
      <SelectField label="Cliente" value={cliente} onChange={e => setCliente(e.target.value)} placeholder={opc.isLoading ? 'Carregando…' : 'Escolha'}
        options={[...clientes.map(c => ({ value: c.id, label: c.prazo ? `${c.nome} · prazo ${c.prazo}` : c.nome })), { value: '__outro', label: 'Outro (sem cadastro)…' }]}
        hint={opc.data && !clientes.length ? 'Nenhum cliente cadastrado: use "Outro" ou cadastre em Cadastros → Clientes.' : undefined} />
      {cliente === '__outro' && <TextField label="Nome do cliente" value={clienteNome} onChange={e => setClienteNome(e.target.value)} autoFocus />}
      <div className="form-grid">
        <TextField label="Data do pedido" type="date" value={dataPedido} onChange={e => setDataPedido(e.target.value)} />
        <TextField label="Entregar até" type="date" value={entrega} min={dataPedido} onChange={e => setEntrega(e.target.value)} hint="Deixe em branco se não houver prazo." />
      </div>

      {grupos.map((g, i) => (
        <fieldset key={i} className="ped-grupo">
          <legend>Item {i + 1}</legend>
          <div className="form-grid">
            <SelectField label="Modelo" value={g.modelo} placeholder="Escolha" options={boot.modelos}
              onChange={e => { const m = e.target.value; const pr = opc.data?.precos[m]; setG(i, { modelo: m, ...(pr && !g.preco ? { preco: valorTexto(pr) } : {}) }); }} />
            <SelectField label="Cor" value={g.cor} placeholder="Escolha" options={boot.cores} onChange={e => setG(i, { cor: e.target.value })} />
          </div>
          <div className="ped-grade" role="group" aria-label={`Quantidades por tamanho do item ${i + 1}`}>
            {boot.tamanhos.map(t => (
              <label key={t}><span>{t}</span>
                <input inputMode="numeric" value={g.qtds[t] ?? ''} aria-label={`Item ${i + 1}, tamanho ${t}`}
                  onChange={e => setG(i, { qtds: { ...g.qtds, [t]: e.target.value.replace(/\D/g, '').slice(0, 6) } })} />
              </label>
            ))}
          </div>
          <div className="form-grid">
            <TextField label="Preço por peça (R$)" inputMode="decimal" value={g.preco} placeholder="0,00" onChange={e => setG(i, { preco: e.target.value })}
              hint={opc.data?.precos[g.modelo] ? `Preço do cadastro: ${formatBRL(opc.data.precos[g.modelo]!)}` : 'Opcional. Necessário para lançar o recebimento.'} />
            {grupos.length > 1 && <div style={{ alignSelf: 'end' }}><Button variant="ghost" onClick={() => setGrupos(gs => gs.filter((_, j) => j !== i))}><Icon name="trash" size={15} /> Remover item</Button></div>}
          </div>
        </fieldset>
      ))}
      <Button onClick={() => setGrupos(gs => [...gs, { modelo: '', cor: '', preco: '', qtds: {} }])} icon={<Icon name="plus" size={16} />}>Adicionar modelo / cor</Button>
      <TextAreaField label="Observação (opcional)" value={obs} rows={2} onChange={e => setObs(e.target.value)} />
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- entregar
function EntregarDialog({ pedido, a, onClose }: { pedido: Pedido; a: Andamento; onClose: () => void }) {
  const api = useApi();
  const { eu } = useBoot();
  const comFin = pode(eu, 'financeiro');
  const fin = useQuery({ queryKey: ['financeiro'], queryFn: () => api.finDados(), enabled: comFin });
  const contas = (fin.data?.contas ?? []).filter(c => c.ativa);
  const [modo, setModo] = useState<'nada' | 'avista' | 'prazo'>(comFin && a.valor > 0 ? 'prazo' : 'nada');
  const [conta, setConta] = useState('');
  const [parcelas, setParcelas] = useState('1');
  const [dia, setDia] = useState(String(Math.min(28, new Date().getDate())));
  const [erro, setErro] = useState('');
  const contaSel = conta || contas[0]?.id || '';
  const entregar = useAction((r: PedidoReceber) => api.statusPedido(pedido.id, 'entregue', r), {
    success: `Pedido #${pedido.numero} entregue.`, invalidate: [KEY, ['financeiro']], onSuccess: onClose,
  });
  const submit = () => {
    if (modo === 'nada') return entregar.mutate(null);
    if (!contaSel) return setErro('Escolha a conta.');
    if (modo === 'avista') return entregar.mutate({ contaId: contaSel, avista: true });
    const p = Number(parcelas), d = Number(dia);
    if (!(p >= 1 && p <= 360)) return setErro('Parcelas: 1 a 360.');
    if (!(d >= 1 && d <= 31)) return setErro('Dia do vencimento: 1 a 31.');
    setErro('');
    entregar.mutate({ contaId: contaSel, parcelas: p, diaVencimento: d });
  };
  return (
    <Dialog open onClose={onClose} title={`Entregar pedido #${pedido.numero}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={entregar.isPending} onClick={submit}>Confirmar entrega</Button></>}>
      <p style={{ margin: 0 }}><b>{pedido.cliente}</b><br /><span className="muted">{formatNumber(a.total)} peça(s){a.valor ? ` · ${formatBRL(a.valor)}` : ''}</span></p>
      {a.faltam > 0 && <Banner tone="warn">Ainda faltam {formatNumber(a.faltam)} peça(s) na conferência. Confirme só se o pedido realmente saiu.</Banner>}
      {comFin ? (
        <>
          <Segmented label="Lançar no Financeiro" value={modo} onChange={setModo}
            options={[{ value: 'prazo', label: 'A receber (prazo)' }, { value: 'avista', label: 'Recebido à vista' }, { value: 'nada', label: 'Não lançar' }]} />
          {modo !== 'nada' && a.valor <= 0 && <Banner tone="warn">Os itens estão sem preço. Edite o pedido e informe o preço para lançar o valor.</Banner>}
          {modo !== 'nada' && (
            <SelectField label={modo === 'avista' ? 'Entrou na conta' : 'Vai entrar na conta'} value={contaSel} onChange={e => setConta(e.target.value)}
              options={contas.map(c => ({ value: c.id, label: c.nome }))} placeholder={fin.isLoading ? 'Carregando…' : 'Escolha'} />
          )}
          {modo === 'prazo' && (
            <div className="form-grid">
              <TextField label="Parcelas" type="number" inputMode="numeric" min={1} max={360} value={parcelas} onChange={e => setParcelas(e.target.value)}
                hint={a.valor && Number(parcelas) >= 1 ? `${parcelas}x de ${formatBRL(Math.round((a.valor / Number(parcelas)) * 100) / 100)}` : undefined} />
              <TextField label="Dia do vencimento" type="number" inputMode="numeric" min={1} max={31} value={dia} onChange={e => setDia(e.target.value)} />
            </div>
          )}
        </>
      ) : <p className="muted" style={{ margin: 0 }}>O recebimento é lançado por quem tem acesso ao Financeiro.</p>}
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- detalhe
function Detalhe({ pedido, etapas, onClose, onEditar, onEntregar }: {
  pedido: Pedido; etapas: string[]; onClose: () => void; onEditar: () => void; onEntregar: () => void;
}) {
  const api = useApi();
  const confirm = useConfirm();
  const a = andamento(pedido, isoDay(new Date()), etapas);
  const st = SITUACAO[a.situacao];
  const status = useAction((s: 'cancelado' | 'aberto') => api.statusPedido(pedido.id, s, null), {
    success: (_d, s) => (s === 'cancelado' ? 'Pedido cancelado.' : 'Pedido reaberto.'), invalidate: [KEY], onSuccess: onClose,
  });
  const apagar = useAction(() => api.apagarPedido(pedido.id), { success: 'Pedido excluído.', invalidate: [KEY], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={`Pedido #${pedido.numero} · ${pedido.cliente}`} variant="drawer" wide
      footer={<>
        {pedido.status !== 'entregue' && <Button variant="ghost" onClick={async () => {
          if (await confirm({ title: `Excluir o pedido #${pedido.numero}?`, message: 'Fica registrado na Atividade.', confirmLabel: 'Excluir', tone: 'danger' })) apagar.mutate();
        }}><Icon name="trash" size={15} /> Excluir</Button>}
        <span style={{ marginRight: 'auto' }} />
        {pedido.status === 'aberto' && <>
          <Button onClick={async () => { if (await confirm({ title: `Cancelar o pedido #${pedido.numero}?`, message: 'Ele deixa de contar na produção. Pode ser reaberto depois.', confirmLabel: 'Cancelar pedido', tone: 'danger' })) status.mutate('cancelado'); }}>Cancelar pedido</Button>
          <Button onClick={onEditar} icon={<Icon name="pencil" size={15} />}>Editar</Button>
          <Button variant="primary" onClick={onEntregar} icon={<Icon name="truck" size={16} />}>Entregar</Button>
        </>}
        {pedido.status !== 'aberto' && <Button onClick={() => status.mutate('aberto')}>Reabrir</Button>}
      </>}>
      <div className="row" style={{ gap: 8 }}>
        <Badge tone={st.tom === 'neutral' ? undefined : st.tom}>{st.rotulo}</Badge>
        <span className="muted">Pedido em {dataBR(pedido.dataPedido)} · {pedido.entrega ? `entrega ${dataCompleta(pedido.entrega)}` : 'sem prazo'} · {prazoTexto(a, pedido)}</span>
      </div>
      {pedido.obs && <p style={{ margin: 0 }}><b>Obs.:</b> {pedido.obs}</p>}
      {pedido.finLancamentoId && <p className="muted" style={{ margin: 0 }}><Icon name="wallet" size={14} /> Lançado no Financeiro.</p>}
      <div className="kpi-ficha">
        <Stat label="Peças" value={formatNumber(a.total)} hint={`${formatNumber(a.concluidas)} conferida(s)`} />
        <Stat label="Valor do pedido" value={formatBRL(a.valor)} />
      </div>
      <Barras a={a} etapas={etapas} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Item</th><th className="num">Qtd</th>{etapas.map(e => <th key={e} className="num">{e}</th>)}<th className="num">Preço</th></tr></thead>
          <tbody>
            {pedido.itens.map((i, n) => (
              <tr key={i.id ?? n}>
                <td>{i.modelo} · {i.cor} · <b>{i.tamanho}</b></td>
                <td className="num tnum">{i.qtd}</td>
                {etapas.map(e => { const f = Math.min(i.qtd, i.feito[e] ?? 0); return <td key={e} className={`num tnum${f >= i.qtd ? ' valor-pos' : ''}`}>{f}</td>; })}
                <td className="num tnum">{i.preco ? formatBRL(i.preco) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>O andamento vem do Lançar: a produção de cada modelo/cor/tamanho é distribuída entre os pedidos, primeiro para a entrega mais próxima.</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------- página
export default function PedidosPage() {
  const api = useApi();
  const boot = useBoot();
  const etapas = boot.etapas.length ? boot.etapas : ['Corte', 'Costura', 'Conferência'];
  const q = useQuery({ queryKey: KEY, queryFn: () => api.pedidos(120) });
  const [aba, setAba] = useState<Aba>('abertos');
  const [form, setForm] = useState<Pedido | null | undefined>(undefined);
  const [vendo, setVendo] = useState<string | null>(null);
  const [entregando, setEntregando] = useState<string | null>(null);
  const hoje = isoDay(new Date());

  return (
    <>
      <PageHeader title="Pedidos" subtitle="Pedidos dos clientes e quanto de cada um já passou pelo corte, costura e conferência"
        actions={<Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setForm(null)}>Novo pedido</Button>} />
      <QueryView query={q}>
        {pedidos => <Conteudo pedidos={pedidos} etapas={etapas} hoje={hoje} aba={aba} setAba={setAba} onVer={setVendo} />}
      </QueryView>
      {q.data && vendo && (() => {
        const p = q.data.find(x => x.id === vendo);
        return p ? <Detalhe pedido={p} etapas={etapas} onClose={() => setVendo(null)}
          onEditar={() => { setVendo(null); setForm(p); }} onEntregar={() => { setVendo(null); setEntregando(p.id); }} /> : null;
      })()}
      {q.data && entregando && (() => {
        const p = q.data.find(x => x.id === entregando);
        return p ? <EntregarDialog pedido={p} a={andamento(p, hoje, etapas)} onClose={() => setEntregando(null)} /> : null;
      })()}
      {form !== undefined && <PedidoForm inicial={form ?? undefined} onClose={() => setForm(undefined)} />}
    </>
  );
}

function Conteudo({ pedidos, etapas, hoje, aba, setAba, onVer }: {
  pedidos: Pedido[]; etapas: string[]; hoje: string; aba: Aba; setAba: (a: Aba) => void; onVer: (id: string) => void;
}) {
  const r = resumo(pedidos, hoje, etapas);
  const comAnd = useMemo(() => pedidos.map(p => ({ p, a: andamento(p, hoje, etapas) })), [pedidos, hoje, etapas]);
  const filtro = aba === 'entregues' ? 'entregue' : aba === 'cancelados' ? 'cancelado' : 'aberto';
  const linhas = comAnd.filter(x => x.p.status === filtro);
  const fila = useMemo(() => filaProducao(pedidos, etapas), [pedidos, etapas]);
  type L = (typeof comAnd)[number];

  const cols: Column<L>[] = [
    { id: 'num', header: 'Pedido', value: x => x.p.numero, nowrap: true,
      cell: x => <button type="button" className="link-empresa" onClick={() => onVer(x.p.id)}><b>#{x.p.numero} · {x.p.cliente}</b>
        <small>{x.p.itens.length} item(ns){x.p.obs ? ` · ${x.p.obs}` : ''}</small></button> },
    { id: 'entrega', header: 'Entrega', value: x => x.p.entrega ?? '9999', nowrap: true,
      cell: x => { const st = SITUACAO[x.a.situacao]; return <>{x.p.entrega ? dataBR(x.p.entrega) : '—'}<small><Badge tone={st.tom === 'neutral' ? undefined : st.tom}>{st.rotulo}</Badge> {prazoTexto(x.a, x.p)}</small></>; } },
    { id: 'and', header: 'Andamento', value: x => x.a.pct[etapas[etapas.length - 1]!] ?? 0, cell: x => <Barras a={x.a} etapas={etapas} /> },
    { id: 'pecas', header: 'Peças', numeric: true, value: x => x.a.total, cell: x => <><b className="tnum">{formatNumber(x.a.total)}</b><small>{x.a.faltam ? `faltam ${formatNumber(x.a.faltam)}` : 'completo'}</small></> },
    { id: 'valor', header: 'Valor', numeric: true, value: x => x.a.valor, cell: x => (x.a.valor ? formatBRL(x.a.valor) : <span className="muted">—</span>) },
  ];

  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Em aberto" value={r.abertos} hint={`${formatNumber(r.pecasAFazer)} peça(s) a conferir`} />
        <Stat label="Atrasados" value={r.atrasados} tone={r.atrasados ? 'danger' : undefined} hint={r.urgentes ? `${r.urgentes} vencem em até 3 dias` : 'nenhum vencendo'} />
        <Stat label="Prontos para entregar" value={r.prontos} tone={r.prontos ? 'ok' : undefined} />
        <Stat label="Valor em aberto" value={formatBRL(r.valorAberto)} />
      </div>
      {r.atrasados > 0 && <Banner tone="danger">{r.atrasados} pedido(s) passaram da data de entrega. Veja a <b>Fila de produção</b> para priorizar.</Banner>}
      <div>
        <Segmented<Aba> label="Pedidos" value={aba} onChange={setAba} options={[
          { value: 'abertos', label: `Em aberto (${r.abertos})` }, { value: 'fila', label: 'Fila de produção' },
          { value: 'entregues', label: 'Entregues' }, { value: 'cancelados', label: 'Cancelados' },
        ]} />
      </div>
      {aba === 'fila' ? (
        <Card title="Fila de produção" subtitle="O que falta fazer em cada etapa para atender os pedidos em aberto, pela entrega mais próxima." flush>
          {fila.length === 0 ? <EmptyState title="Nada pendente">Todos os pedidos em aberto já estão conferidos.</EmptyState> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Modelo · cor · tamanho</th>{etapas.map(e => <th key={e} className="num">Falta {e.toLowerCase()}</th>)}<th>Entrega</th><th>Pedidos</th></tr></thead>
                <tbody>
                  {fila.map(l => (
                    <tr key={`${l.modelo}|${l.cor}|${l.tamanho}`}>
                      <td>{l.modelo} · {l.cor} · <b>{l.tamanho}</b></td>
                      {etapas.map(e => <td key={e} className="num tnum">{l.falta[e] ? <b>{formatNumber(l.falta[e]!)}</b> : <span className="muted">0</span>}</td>)}
                      <td className={l.entrega && l.entrega < hoje ? 'valor-neg' : ''}>{l.entrega ? dataBR(l.entrega) : '—'}</td>
                      <td>{l.pedidos.map(n => `#${n}`).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card flush title={aba === 'abertos' ? 'Pedidos em aberto' : aba === 'entregues' ? 'Entregues (últimos 120 dias)' : 'Cancelados'}>
          <DataTable label="Pedidos" columns={cols} rows={linhas} rowKey={x => x.p.id} searchable exportName={`pedidos-${aba}`}
            empty={aba === 'abertos' ? 'Nenhum pedido em aberto. Clique em "Novo pedido".' : 'Nada aqui.'}
            initialSort={aba === 'abertos' ? { id: 'entrega', dir: 1 } : { id: 'num', dir: -1 }} />
        </Card>
      )}
    </div>
  );
}
