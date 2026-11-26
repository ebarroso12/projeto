import { useState } from 'react';
import type { FinCartao, FinConta, FinListaTipo, FinMeta } from '../../api/types';
import { useApi } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { dataBR, dataCompleta, formatBRL, isoDay, nomeDoMes } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Badge, Banner, Card, EmptyState, Progress, Stat } from '../../ui/primitives';
import { arred, compromissos, faturasAbertas, realizadoMes, saldoConta, saldoMeta, type Compromisso } from './calc';
import { parseValor, valorTexto } from './LancamentoForm';
import { FIN_KEY, nomeCartao, useFin } from './shared';

const Erro = ({ msg }: { msg: string }) => (msg ? <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{msg}</p> : null);

function useContasOpcoes() {
  const d = useFin();
  return d.contas.filter(c => c.ativa).map(c => ({ value: c.id, label: c.nome }));
}

// ---------------------------------------------------------------- A pagar
function PagarDialog({ item, onClose }: { item: Compromisso; onClose: () => void }) {
  const api = useApi();
  const d = useFin();
  const contas = useContasOpcoes();
  const [data, setData] = useState(d.hoje);
  const [valor, setValor] = useState(valorTexto(item.valor));
  const [conta, setConta] = useState(item.parcela?.lanc.contaId ?? contas[0]?.value ?? '');
  const [erro, setErro] = useState('');
  const pagar = useAction(async () => {
    const v = parseValor(valor);
    if (item.tipo === 'parcela' && item.parcela) await api.finPagarParcela(item.parcela.lanc.id, data, v, conta || null);
    if (item.tipo === 'fatura' && item.fatura) await api.finPagarFatura(item.fatura.cartaoId, item.fatura.vencimento, v, conta, data);
  }, { success: 'Pagamento registrado.', invalidate: [FIN_KEY], onSuccess: onClose });

  const submit = () => {
    if (!(parseValor(valor) > 0)) return setErro('Informe o valor pago.');
    if (!conta) return setErro('Escolha a conta de onde saiu o dinheiro.');
    setErro('');
    pagar.mutate();
  };

  return (
    <Dialog open onClose={onClose} title={item.tipo === 'fatura' ? 'Pagar fatura' : 'Pagar parcela'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={pagar.isPending} onClick={submit}>Confirmar pagamento</Button></>}>
      <p style={{ margin: 0 }}><b>{item.descricao}</b><br /><span className="muted">Vence em {dataCompleta(item.data)}</span></p>
      {item.fatura && (
        <div className="list" style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
          {item.fatura.itens.map((it, i) => (
            <div className="item" key={i}>
              <div className="item-main"><b>{it.descricao}{it.parcela ? ` · ${it.parcela}` : ''}</b><small>{dataBR(it.data)} · {it.categoria || 'Sem categoria'}</small></div>
              <span className="tnum">{formatBRL(it.valor)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="form-grid">
        <TextField label="Data do pagamento" type="date" value={data} onChange={e => setData(e.target.value)} />
        <TextField label="Valor pago (R$)" inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} />
      </div>
      <SelectField label="Saiu da conta" value={conta} onChange={e => setConta(e.target.value)} options={contas} placeholder="Escolha" />
      <Erro msg={erro} />
    </Dialog>
  );
}

export function APagarTab() {
  const d = useFin();
  const [pagando, setPagando] = useState<Compromisso | null>(null);
  const lista = compromissos(d, id => nomeCartao(d, id));
  const vencidos = lista.filter(c => c.data < d.hoje);
  const em30 = lista.filter(c => c.data >= d.hoje && c.data <= isoDay(new Date(Date.now() + 30 * 864e5)));
  const soma = (l: Compromisso[]) => arred(l.reduce((s, c) => s + c.valor, 0));

  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Vencido" value={formatBRL(soma(vencidos))} hint={`${vencidos.length} item(ns)`} tone={vencidos.length ? 'danger' : undefined} />
        <Stat label="Próximos 30 dias" value={formatBRL(soma(em30))} hint={`${em30.length} item(ns)`} />
        <Stat label="Total em aberto" value={formatBRL(soma(lista))} hint="parcelas e faturas" />
      </div>
      <Card title="Contas a pagar" subtitle="Parcelas de contas programadas e faturas de cartão ainda não pagas." flush>
        {lista.length === 0 ? <EmptyState title="Tudo em dia">Nenhuma parcela ou fatura em aberto.</EmptyState> : (
          <div className="list">
            {lista.map((c, i) => {
              const atrasado = c.data < d.hoje;
              return (
                <div className="item" key={i}>
                  <div className="item-main">
                    <b>{c.descricao}</b>
                    <small>{dataCompleta(c.data)} · {c.tipo === 'fatura' ? `${c.fatura?.itens.length ?? 0} compra(s) no cartão` : 'Parcela'} {atrasado && <Badge tone="danger">Vencida</Badge>}</small>
                  </div>
                  <b className="tnum">{formatBRL(c.valor)}</b>
                  <Button size="sm" variant={atrasado ? 'primary' : 'secondary'} onClick={() => setPagando(c)}>Pagar</Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {pagando && <PagarDialog item={pagando} onClose={() => setPagando(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Contas e cartões
function ContaDialog({ conta, onClose }: { conta?: FinConta; onClose: () => void }) {
  const api = useApi();
  const [nome, setNome] = useState(conta?.nome ?? '');
  const [saldo, setSaldo] = useState(valorTexto(conta?.saldoInicial ?? 0));
  const [ativa, setAtiva] = useState(conta?.ativa ?? true);
  const [erro, setErro] = useState('');
  const salvar = useAction(() => api.finSalvarConta({ id: conta?.id, nome: nome.trim(), saldoInicial: parseValor(saldo) || 0, ativa }),
    { success: 'Conta salva.', invalidate: [FIN_KEY], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={conta ? 'Editar conta' : 'Nova conta'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending}
        onClick={() => (nome.trim() ? (setErro(''), salvar.mutate()) : setErro('Informe o nome.'))}>Salvar</Button></>}>
      <TextField label="Nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Banco do Brasil" autoFocus />
      <TextField label="Saldo inicial (R$)" inputMode="decimal" value={saldo} onChange={e => setSaldo(e.target.value)} hint="Saldo na data de início do controle (Ajustes)." />
      <SelectField label="Situação" value={ativa ? 'Sim' : 'Não'} onChange={e => setAtiva(e.target.value === 'Sim')} options={[{ value: 'Sim', label: 'Ativa' }, { value: 'Não', label: 'Inativa' }]} />
      <Erro msg={erro} />
    </Dialog>
  );
}

function CartaoDialog({ cartao, onClose }: { cartao?: FinCartao; onClose: () => void }) {
  const api = useApi();
  const [nome, setNome] = useState(cartao?.nome ?? '');
  const [fech, setFech] = useState(String(cartao?.diaFechamento ?? ''));
  const [venc, setVenc] = useState(String(cartao?.diaVencimento ?? ''));
  const [ativo, setAtivo] = useState(cartao?.ativo ?? true);
  const [erro, setErro] = useState('');
  const salvar = useAction(() => api.finSalvarCartao({ id: cartao?.id, nome: nome.trim(), diaFechamento: Number(fech), diaVencimento: Number(venc), ativo }),
    { success: 'Cartão salvo.', invalidate: [FIN_KEY], onSuccess: onClose });
  const submit = () => {
    const f = Number(fech), v = Number(venc);
    if (!nome.trim()) return setErro('Informe o nome.');
    if (!(f >= 1 && f <= 31 && v >= 1 && v <= 31)) return setErro('Os dias de fechamento e vencimento vão de 1 a 31.');
    setErro('');
    salvar.mutate();
  };
  return (
    <Dialog open onClose={onClose} title={cartao ? 'Editar cartão' : 'Novo cartão'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} onClick={submit}>Salvar</Button></>}>
      <TextField label="Nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Cartão empresa" autoFocus />
      <div className="form-grid">
        <TextField label="Dia do fechamento" type="number" min={1} max={31} value={fech} onChange={e => setFech(e.target.value)} />
        <TextField label="Dia do vencimento" type="number" min={1} max={31} value={venc} onChange={e => setVenc(e.target.value)} />
      </div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Compras até o dia do fechamento entram na fatura que vence no próximo vencimento; depois dele, na seguinte.</p>
      <SelectField label="Situação" value={ativo ? 'Sim' : 'Não'} onChange={e => setAtivo(e.target.value === 'Sim')} options={[{ value: 'Sim', label: 'Ativo' }, { value: 'Não', label: 'Inativo' }]} />
      <Erro msg={erro} />
    </Dialog>
  );
}

export function ContasTab() {
  const d = useFin();
  const [conta, setConta] = useState<FinConta | null | undefined>(undefined);
  const [cartao, setCartao] = useState<FinCartao | null | undefined>(undefined);
  const faturas = faturasAbertas(d);

  return (
    <div className="grid-2">
      <Card title="Contas" subtitle="Bancos e caixa. O saldo considera só o que já saiu ou entrou." flush
        actions={<Button size="sm" icon={<Icon name="plus" size={15} />} onClick={() => setConta(null)}>Conta</Button>}>
        <div className="list">
          {d.contas.map(c => {
            const s = saldoConta(d, c.id);
            return (
              <div className="item" key={c.id}>
                <div className="item-main"><b>{c.nome} {!c.ativa && <Badge>Inativa</Badge>}</b><small>Saldo inicial {formatBRL(c.saldoInicial)}</small></div>
                <b className={s < 0 ? 'valor-neg' : 'tnum'}>{formatBRL(s)}</b>
                <Button size="sm" variant="ghost" iconOnly aria-label={`Editar ${c.nome}`} onClick={() => setConta(c)}><Icon name="pencil" size={15} /></Button>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Cartões de crédito" subtitle="As compras saem da conta só quando a fatura é paga." flush
        actions={<Button size="sm" icon={<Icon name="plus" size={15} />} onClick={() => setCartao(null)}>Cartão</Button>}>
        {d.cartoes.length === 0 ? <EmptyState icon="card" title="Nenhum cartão">Cadastre para lançar compras no crédito.</EmptyState> : (
          <div className="list">
            {d.cartoes.map(c => {
              const aberto = arred(faturas.filter(f => f.cartaoId === c.id).reduce((s, f) => s + f.total, 0));
              return (
                <div className="item" key={c.id}>
                  <div className="item-main"><b>{c.nome} {!c.ativo && <Badge>Inativo</Badge>}</b><small>Fecha dia {c.diaFechamento} · vence dia {c.diaVencimento}</small></div>
                  <span className="tnum" title="Em faturas abertas">{formatBRL(aberto)}</span>
                  <Button size="sm" variant="ghost" iconOnly aria-label={`Editar ${c.nome}`} onClick={() => setCartao(c)}><Icon name="pencil" size={15} /></Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {conta !== undefined && <ContaDialog conta={conta ?? undefined} onClose={() => setConta(undefined)} />}
      {cartao !== undefined && <CartaoDialog cartao={cartao ?? undefined} onClose={() => setCartao(undefined)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Metas
function MetaDialog({ meta, onClose }: { meta?: FinMeta; onClose: () => void }) {
  const api = useApi();
  const [nome, setNome] = useState(meta?.nome ?? '');
  const [valor, setValor] = useState(valorTexto(meta?.valorMeta));
  const [alvo, setAlvo] = useState(meta?.dataAlvo ?? '');
  const [ativa, setAtiva] = useState(meta?.ativa ?? true);
  const [erro, setErro] = useState('');
  const salvar = useAction(() => api.finSalvarMeta({ id: meta?.id, nome: nome.trim(), valorMeta: parseValor(valor), dataAlvo: alvo || null, ativa }),
    { success: 'Meta salva.', invalidate: [FIN_KEY], onSuccess: onClose });
  const submit = () => {
    if (!nome.trim()) return setErro('Informe o nome.');
    if (!(parseValor(valor) > 0)) return setErro('Informe o valor da meta.');
    setErro('');
    salvar.mutate();
  };
  return (
    <Dialog open onClose={onClose} title={meta ? 'Editar meta' : 'Nova meta'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} onClick={submit}>Salvar</Button></>}>
      <TextField label="Nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Reserva de emergência, máquina nova" autoFocus />
      <div className="form-grid">
        <TextField label="Valor da meta (R$)" inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} />
        <TextField label="Data alvo (opcional)" type="date" value={alvo} onChange={e => setAlvo(e.target.value)} />
      </div>
      {meta && <SelectField label="Situação" value={ativa ? 'Sim' : 'Não'} onChange={e => setAtiva(e.target.value === 'Sim')} options={[{ value: 'Sim', label: 'Ativa' }, { value: 'Não', label: 'Encerrada' }]} />}
      <Erro msg={erro} />
    </Dialog>
  );
}

function MovimentoDialog({ meta, tipo, onClose }: { meta: FinMeta; tipo: 'deposito' | 'retirada'; onClose: () => void }) {
  const api = useApi();
  const d = useFin();
  const contas = useContasOpcoes();
  const [valor, setValor] = useState('');
  const [data, setData] = useState(d.hoje);
  const [conta, setConta] = useState(contas[0]?.value ?? '');
  const [erro, setErro] = useState('');
  const saldo = saldoMeta(d, meta.id);
  const mover = useAction(() => api.finMovimentarMeta(meta.id, tipo, parseValor(valor), data, conta),
    { success: tipo === 'deposito' ? 'Valor guardado.' : 'Retirada registrada.', invalidate: [FIN_KEY], onSuccess: onClose });
  const submit = () => {
    const v = parseValor(valor);
    if (!(v > 0)) return setErro('Informe o valor.');
    if (tipo === 'retirada' && v > saldo) return setErro(`A meta tem só ${formatBRL(saldo)} guardados.`);
    if (!conta) return setErro('Escolha a conta.');
    setErro('');
    mover.mutate();
  };
  return (
    <Dialog open onClose={onClose} title={`${tipo === 'deposito' ? 'Guardar em' : 'Retirar de'} “${meta.nome}”`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mover.isPending} onClick={submit}>{tipo === 'deposito' ? 'Guardar' : 'Retirar'}</Button></>}>
      <div className="form-grid">
        <TextField label="Valor (R$)" inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} autoFocus />
        <TextField label="Data" type="date" value={data} onChange={e => setData(e.target.value)} />
      </div>
      <SelectField label={tipo === 'deposito' ? 'Sai da conta' : 'Volta para a conta'} value={conta} onChange={e => setConta(e.target.value)} options={contas} placeholder="Escolha" />
      <Erro msg={erro} />
    </Dialog>
  );
}

export function MetasTab() {
  const d = useFin();
  const [editando, setEditando] = useState<FinMeta | null | undefined>(undefined);
  const [mov, setMov] = useState<{ meta: FinMeta; tipo: 'deposito' | 'retirada' } | null>(null);
  const metas = [...d.metas].sort((a, b) => Number(b.ativa) - Number(a.ativa) || a.nome.localeCompare(b.nome));

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted" style={{ margin: 0 }}>Separe dinheiro para objetivos. O valor guardado sai do saldo da conta.</p>
        <Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setEditando(null)}>Nova meta</Button>
      </div>
      {metas.length === 0 ? <Card><EmptyState icon="trend" title="Nenhuma meta">Crie uma reserva, por exemplo para impostos ou uma máquina nova.</EmptyState></Card> : (
        <div className="grid-2">
          {metas.map(m => {
            const s = saldoMeta(d, m.id);
            const pct = m.valorMeta ? Math.min(100, Math.round((s / m.valorMeta) * 100)) : 0;
            return (
              <Card key={m.id} title={m.nome} subtitle={m.dataAlvo ? `Até ${dataCompleta(m.dataAlvo)}` : 'Sem data alvo'}
                actions={<Button size="sm" variant="ghost" iconOnly aria-label={`Editar ${m.nome}`} onClick={() => setEditando(m)}><Icon name="pencil" size={15} /></Button>}>
                <div className="stack" style={{ gap: 10 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b style={{ fontSize: 22 }} className="tnum">{formatBRL(s)}</b>
                    <span className="muted tnum">de {formatBRL(m.valorMeta)} · {pct}%</span>
                  </div>
                  <Progress value={s} max={m.valorMeta || 1} />
                  {m.ativa ? (
                    <div className="row">
                      <Button size="sm" variant="primary" icon={<Icon name="arrowDown" size={15} />} onClick={() => setMov({ meta: m, tipo: 'deposito' })}>Guardar</Button>
                      <Button size="sm" icon={<Icon name="arrowUp" size={15} />} disabled={s <= 0} onClick={() => setMov({ meta: m, tipo: 'retirada' })}>Retirar</Button>
                    </div>
                  ) : <Badge>Encerrada</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editando !== undefined && <MetaDialog meta={editando ?? undefined} onClose={() => setEditando(undefined)} />}
      {mov && <MovimentoDialog meta={mov.meta} tipo={mov.tipo} onClose={() => setMov(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Planejamento
function ExpectativaDialog({ mes, onClose }: { mes: string; onClose: () => void }) {
  const api = useApi();
  const d = useFin();
  const atual = d.expectativas.find(e => e.mes === mes);
  const [entradas, setEntradas] = useState(valorTexto(atual?.entradas ?? 0));
  const [saidas, setSaidas] = useState<Record<string, string>>(() =>
    Object.fromEntries(d.listas.categorias.map(c => [c, valorTexto(atual?.saidas[c] ?? 0)])));
  const salvar = useAction(() => {
    const s: Record<string, number> = {};
    for (const [k, v] of Object.entries(saidas)) { const n = parseValor(v); if (n > 0) s[k] = n; }
    return api.finSalvarExpectativa(mes, parseValor(entradas) || 0, s);
  }, { success: 'Planejamento salvo.', invalidate: [FIN_KEY], onSuccess: onClose });

  return (
    <Dialog open onClose={onClose} title={`Planejar ${nomeDoMes(mes)}`} variant="drawer"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button></>}>
      <TextField label="Entradas esperadas (R$)" inputMode="decimal" value={entradas} onChange={e => setEntradas(e.target.value)} />
      <p className="muted" style={{ fontSize: 13, fontWeight: 600, margin: '6px 0 0' }}>Saídas esperadas por categoria</p>
      <div className="form-grid">
        {d.listas.categorias.map(c => (
          <TextField key={c} label={c} inputMode="decimal" value={saidas[c] ?? ''} onChange={e => setSaidas(s => ({ ...s, [c]: e.target.value }))} />
        ))}
      </div>
    </Dialog>
  );
}

export function PlanejamentoTab({ mes }: { mes: string }) {
  const d = useFin();
  const [editar, setEditar] = useState(false);
  const exp = d.expectativas.find(e => e.mes === mes);
  const real = realizadoMes(d, mes);
  const categorias = [...new Set([...Object.keys(exp?.saidas ?? {}), ...Object.keys(real.saidas)])].sort();
  const totalPlan = arred(Object.values(exp?.saidas ?? {}).reduce((a, b) => a + b, 0));

  const Linha = ({ nome, plan, feito, entrada }: { nome: string; plan: number; feito: number; entrada?: boolean }) => {
    const estourou = entrada ? feito < plan : feito > plan;
    return (
      <div className="item">
        <div className="item-main" style={{ minWidth: 0 }}>
          <b>{nome}</b>
          <div style={{ marginTop: 6 }}><Progress value={feito} max={plan || feito || 1} /></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <b className={plan && estourou && !entrada ? 'valor-neg' : 'tnum'}>{formatBRL(feito)}</b>
          <small className="muted" style={{ display: 'block' }}>de {formatBRL(plan)}</small>
        </div>
      </div>
    );
  };

  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Entradas" value={formatBRL(real.entradas)} hint={`planejado ${formatBRL(exp?.entradas ?? 0)}`} tone="ok" />
        <Stat label="Saídas" value={formatBRL(real.totalSaidas)} hint={`planejado ${formatBRL(totalPlan)}`} tone={totalPlan && real.totalSaidas > totalPlan ? 'danger' : undefined} />
        <Stat label="Sobra do mês" value={formatBRL(real.entradas - real.totalSaidas)} hint={`planejado ${formatBRL((exp?.entradas ?? 0) - totalPlan)}`} />
      </div>
      <Card title={`Planejado × realizado · ${nomeDoMes(mes)}`} subtitle="Saídas consideram a data da compra (inclusive no cartão)." flush
        actions={<Button variant="primary" size="sm" icon={<Icon name="pencil" size={15} />} onClick={() => setEditar(true)}>{exp ? 'Editar plano' : 'Planejar mês'}</Button>}>
        {!exp && categorias.length === 0 ? <EmptyState icon="calendar" title="Sem planejamento">Defina quanto espera receber e gastar em cada categoria.</EmptyState> : (
          <div className="list">
            <Linha nome="Entradas" plan={exp?.entradas ?? 0} feito={real.entradas} entrada />
            {categorias.map(c => <Linha key={c} nome={c} plan={exp?.saidas[c] ?? 0} feito={real.saidas[c] ?? 0} />)}
          </div>
        )}
      </Card>
      {editar && <ExpectativaDialog mes={mes} onClose={() => setEditar(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Ajustes
const LISTAS: { tipo: FinListaTipo; chave: 'categorias' | 'responsaveis' | 'centros' | 'formas'; titulo: string }[] = [
  { tipo: 'categoria', chave: 'categorias', titulo: 'Categorias' },
  { tipo: 'centro', chave: 'centros', titulo: 'Centros de custo' },
  { tipo: 'forma', chave: 'formas', titulo: 'Formas de pagamento' },
  { tipo: 'responsavel', chave: 'responsaveis', titulo: 'Responsáveis' },
];

function ListaEditor({ tipo, titulo, valores }: { tipo: FinListaTipo; titulo: string; valores: string[] }) {
  const api = useApi();
  const [texto, setTexto] = useState(valores.join('\n'));
  const itens = [...new Set(texto.split('\n').map(s => s.trim()).filter(Boolean))];
  const mudou = itens.join('\n') !== valores.join('\n');
  const salvar = useAction(() => api.finSalvarLista(tipo, itens), { success: `${titulo} salvos.`, invalidate: [FIN_KEY] });
  return (
    <Card title={titulo} subtitle="Um item por linha.">
      <div className="stack" style={{ gap: 10 }}>
        <TextAreaField label={titulo} value={texto} onChange={e => setTexto(e.target.value)} rows={7} />
        <div><Button size="sm" variant="primary" disabled={!mudou} loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button></div>
      </div>
    </Card>
  );
}

export function AjustesTab() {
  const api = useApi();
  const d = useFin();
  const [inicio, setInicio] = useState(d.dataInicio);
  const salvar = useAction(() => api.finSalvarConfig(inicio), { success: 'Data de início salva.', invalidate: [FIN_KEY] });
  return (
    <div className="stack">
      <Card title="Início do controle" subtitle="Os saldos das contas contam a partir desta data, somados ao saldo inicial de cada conta.">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <TextField label="Data de início" type="date" value={inicio} onChange={e => setInicio(e.target.value)} />
          <Button variant="primary" disabled={!inicio || inicio === d.dataInicio} loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>
        </div>
      </Card>
      <Banner tone="info">Remover um item da lista não apaga lançamentos antigos; ele só deixa de aparecer como opção.</Banner>
      <div className="grid-2">
        {LISTAS.map(l => <ListaEditor key={l.tipo} tipo={l.tipo} titulo={l.titulo} valores={d.listas[l.chave]} />)}
      </div>
    </div>
  );
}
