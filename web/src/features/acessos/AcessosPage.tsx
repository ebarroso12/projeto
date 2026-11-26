import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcessosDados, EventoAcesso, MetricaPessoa, SessaoAcesso } from '../../api/types';
import { useApi } from '../../app/auth';
import { PENDENTES_KEY } from '../../app/acessoVivo';
import { useAction } from '../../app/useAction';
import { dataBR, isoDay } from '../../lib/format';
import { Button } from '../../ui/Button';
import { BarrasHorizontais } from '../../ui/charts';
import { DataTable, type Column } from '../../ui/DataTable';
import { useConfirm } from '../../ui/Dialog';
import { SelectField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Card, EmptyState, PageHeader, Segmented, Stat } from '../../ui/primitives';

const KEY = 'acessos';
type Aba = 'pedidos' | 'online' | 'entradas' | 'atividade' | 'metricas' | 'aparelhos';
type Periodo = 'hoje' | '7' | '30';

/** 5400 -> "1h30"; 300 -> "5 min". */
export const tempo = (seg: number) => {
  const m = Math.round(seg / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};
const quando = (iso: string) => (iso ? `${dataBR(iso.slice(0, 10))} ${iso.slice(11, 16)}` : '—');

const TABELAS: Record<string, string> = {
  lancamentos: 'lançamento de produção', ponto: 'ponto', em_falta: 'item em falta', perfis: 'pessoa', itens_lista: 'lista de produção',
  redes: 'rede Wi-Fi', chaves_acesso: 'link de acompanhamento', configuracao: 'configuração', dias_sem_expediente: 'feriado',
  fin_lancamentos: 'lançamento financeiro', fin_contas: 'conta', fin_cartoes: 'cartão', fin_pagamentos_fatura: 'pagamento de fatura',
  fin_metas: 'meta', fin_movimentos_meta: 'movimento de meta', fin_expectativas: 'planejamento', fin_listas: 'lista do financeiro',
  fin_config: 'configuração do financeiro', dre_categorias: 'categoria do resultado', dre_meses: 'mês do resultado',
};
const TIPOS: Record<string, { rotulo: string; tom: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  entrada: { rotulo: 'Entrou', tom: 'ok' }, saida: { rotulo: 'Saiu', tom: 'neutral' },
  acesso_pedido: { rotulo: 'Pediu acesso', tom: 'warn' }, acesso_liberado: { rotulo: 'Liberou acesso de', tom: 'ok' },
  acesso_negado: { rotulo: 'Negou acesso de', tom: 'danger' }, sessao_encerrada: { rotulo: 'Derrubou a sessão de', tom: 'danger' },
  aparelho_revogado: { rotulo: 'Revogou aparelho de', tom: 'warn' },
  criou: { rotulo: 'Criou', tom: 'info' }, alterou: { rotulo: 'Alterou', tom: 'warn' }, apagou: { rotulo: 'Apagou', tom: 'danger' },
};
const ROTULOS: Record<string, string> = {
  qtd: 'qtd', valor: 'valor', descricao: 'descrição', modelo: 'modelo', cor: 'cor', tamanho: 'tamanho', etapa: 'etapa', nome: 'nome',
  login: 'login', perfil: 'perfil', ativo: 'ativo', entrada: 'entrada', saida: 'saída', dia: 'dia', status: 'situação', tipo: 'tipo',
  falta: 'falta', exigir_liberacao: 'exigir liberação', exigir_wifi: 'exigir Wi-Fi', apagado: 'apagado', aparelho: 'aparelho', ip: 'IP', automatico: 'entrou sem pedir (aparelho confiável)', confiar: 'confiar no aparelho',
};
const fmt = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Resumo legível do que aconteceu: "qtd: 30 → 35 · Camisa Polo Preto M". */
export function resumoEvento(e: EventoAcesso): string {
  const d = e.detalhe;
  const campos = (o: Record<string, unknown>, max = 4) => Object.entries(o)
    .filter(([k, v]) => v !== null && v !== '' && typeof v !== 'object' && !/(_id|^id$|hist|hash)/.test(k)).slice(0, max)
    .map(([k, v]) => `${ROTULOS[k] ?? k.replace(/_/g, ' ')}: ${fmt(v)}`).join(' · ');
  if (d.mudou && typeof d.mudou === 'object') {
    const mud = Object.entries(d.mudou as Record<string, unknown[]>).filter(([k]) => !(e.tipo === 'apagou' && k === 'apagado')).map(([k, [a, b]]) => `${ROTULOS[k] ?? k.replace(/_/g, ' ')}: ${fmt(a)} → ${fmt(b)}`).join(' · ');
    const item = d.item && typeof d.item === 'object' ? campos(d.item as Record<string, unknown>, 3) : '';
    return [mud, item].filter(Boolean).join(' — ');
  }
  return campos(d);
}

function faixa(p: Periodo) {
  const hoje = new Date();
  const ini = new Date(hoje); ini.setDate(hoje.getDate() - (p === 'hoje' ? 0 : Number(p) - 1));
  return { ini: isoDay(ini), fim: isoDay(hoje) };
}

// ---------------------------------------------------------------- pedidos
function Pedidos({ d }: { d: AcessosDados }) {
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const decidir = useAction((v: { id: string; liberar: boolean; confiar: boolean }) => api.decidirAcesso(v.id, v.liberar, v.confiar), {
    success: (_r, v) => (v.liberar ? 'Acesso liberado.' : 'Acesso negado.'), invalidate: [[KEY], PENDENTES_KEY],
  });
  const config = useAction((exigir: boolean) => api.configAcesso(exigir), {
    success: (_r, v) => (v ? 'Liberação obrigatória ligada.' : 'Liberação obrigatória desligada.'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [KEY] }); },
  });
  return (
    <div className="stack">
      <Card title="Liberação de acesso" subtitle={d.exigir
        ? 'Ligada: cada vez que um funcionário entra, ele espera um administrador liberar. Administradores entram direto.'
        : 'Desligada: funcionários entram só com login e senha (tudo continua registrado).'}
        actions={<Button variant={d.exigir ? 'secondary' : 'primary'} loading={config.isPending} onClick={async () => {
          if (d.exigir && !(await confirm({ title: 'Desligar a liberação?', message: 'Funcionários passam a entrar sem esperar sua liberação.', confirmLabel: 'Desligar', tone: 'danger' }))) return;
          config.mutate(!d.exigir);
        }}>{d.exigir ? 'Desligar' : 'Ligar liberação'}</Button>}>
        <div className="row" style={{ gap: 8 }}>{d.exigir ? <Badge tone="ok">Ligada</Badge> : <Badge tone="warn">Desligada</Badge>}
          <span className="muted" style={{ fontSize: 13 }}>Dica: “Liberar e confiar” faz aquele celular entrar direto nas próximas vezes. Dá para revogar em “Aparelhos”.</span></div>
      </Card>
      <Card title="Aguardando liberação" subtitle="Atualiza sozinho. Pedidos com mais de 12 horas expiram." flush>
        {d.pendentes.length === 0 ? <EmptyState icon="check" title="Ninguém esperando">Quando alguém tentar entrar, aparece aqui e no topo de qualquer tela.</EmptyState> : (
          <div className="list">
            {d.pendentes.map(p => (
              <div className="item" key={p.id} style={{ flexWrap: 'wrap' }}>
                <div className="item-main"><b>{p.nome} <small style={{ display: 'inline' }}>({p.login})</small></b>
                  <small>{p.setor} · {p.aparelho || 'aparelho desconhecido'}{p.ip ? ` · IP ${p.ip}` : ''} · pediu às {p.inicio.slice(11, 16)}</small></div>
                <div className="row" style={{ gap: 6 }}>
                  <Button size="sm" variant="success" disabled={decidir.isPending} onClick={() => decidir.mutate({ id: p.id, liberar: true, confiar: false })}>Liberar</Button>
                  <Button size="sm" disabled={decidir.isPending} onClick={() => decidir.mutate({ id: p.id, liberar: true, confiar: true })}>Liberar e confiar</Button>
                  <Button size="sm" variant="danger" disabled={decidir.isPending} onClick={() => decidir.mutate({ id: p.id, liberar: false, confiar: false })}>Negar</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- online
function Online({ d }: { d: AcessosDados }) {
  const api = useApi();
  const confirm = useConfirm();
  const derrubar = useAction((id: string) => api.encerrarSessao(id), { success: 'Sessão encerrada. A pessoa sai na próxima ação.', invalidate: [[KEY]] });
  return (
    <Card title="Conectados agora" subtitle="Com o app aberto nos últimos 3 minutos" flush>
      {d.online.length === 0 ? <EmptyState icon="users" title="Ninguém conectado agora" /> : (
        <div className="list">
          {d.online.map(s => (
            <div className="item" key={s.id}>
              <span className="online-dot" aria-hidden="true" />
              <div className="item-main"><b>{s.nome}</b><small>{s.tela ? `Em ${s.tela}` : 'No app'} · desde {s.inicio.slice(11, 16)} · {tempo(s.ativoSeg)} ativo · {s.aparelho || 'aparelho'}</small></div>
              {s.perfil !== 'admin' && (
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (await confirm({ title: `Derrubar ${s.nome}?`, message: 'A pessoa sai do sistema e precisa entrar de novo (e ser liberada, se exigido).', confirmLabel: 'Derrubar', tone: 'danger' })) derrubar.mutate(s.id);
                }}>Derrubar</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- entradas
const STATUS: Record<string, { rotulo: string; tom: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  aprovada: { rotulo: 'Liberada', tom: 'ok' }, pendente: { rotulo: 'Aguardando', tom: 'warn' }, negada: { rotulo: 'Negada', tom: 'danger' }, encerrada: { rotulo: 'Encerrada', tom: 'neutral' }, nenhuma: { rotulo: '—', tom: 'neutral' },
};
function Entradas({ d }: { d: AcessosDados }) {
  const cols: Column<SessaoAcesso>[] = [
    { id: 'inicio', header: 'Entrou', value: s => s.inicio, cell: s => quando(s.inicio), nowrap: true },
    { id: 'nome', header: 'Pessoa', value: s => s.nome, cell: s => <>{s.nome}<small>{s.setor}</small></> },
    { id: 'aparelho', header: 'Aparelho', value: s => s.aparelho, cell: s => <>{s.aparelho || '—'}{s.confiavel && <small>confiável</small>}</> },
    { id: 'ip', header: 'IP', value: s => s.ip, cell: s => <code>{s.ip || '—'}</code> },
    { id: 'status', header: 'Situação', value: s => s.status, cell: s => <Badge tone={STATUS[s.status]!.tom}>{STATUS[s.status]!.rotulo}</Badge> },
    { id: 'tempo', header: 'Tempo ativo', numeric: true, value: s => s.ativoSeg, cell: s => tempo(s.ativoSeg) },
    { id: 'ultimo', header: 'Último sinal', value: s => s.ultimo, cell: s => quando(s.ultimo), nowrap: true },
    { id: 'por', header: 'Liberado por', value: s => s.decididoPor, cell: s => s.decididoPor || (s.perfil === 'admin' ? 'admin (direto)' : '—') },
  ];
  return (
    <Card title="Histórico de entradas" subtitle="Cada login, de onde veio e quanto tempo ficou" flush>
      <DataTable label="Entradas" columns={cols} rows={d.sessoes} rowKey={s => s.id} searchable exportName="entradas" empty="Nenhuma entrada no período." initialSort={{ id: 'inicio', dir: -1 }} />
    </Card>
  );
}

// ---------------------------------------------------------------- atividade
function Atividade({ d }: { d: AcessosDados }) {
  const [pessoa, setPessoa] = useState('');
  const [tipo, setTipo] = useState<'todos' | 'acesso' | 'mudancas'>('todos');
  const pessoas = useMemo(() => [...new Set(d.eventos.map(e => e.quem))].sort(), [d.eventos]);
  const linhas = d.eventos.filter(e => (!pessoa || e.quem === pessoa)
    && (tipo === 'todos' || (tipo === 'mudancas' ? ['criou', 'alterou', 'apagou'].includes(e.tipo) : !['criou', 'alterou', 'apagou'].includes(e.tipo))));
  const cols: Column<EventoAcesso>[] = [
    { id: 'em', header: 'Quando', value: e => e.em, cell: e => quando(e.em), nowrap: true },
    { id: 'quem', header: 'Quem', value: e => e.quem, cell: e => e.quem },
    {
      id: 'tipo', header: 'O quê', value: e => `${TIPOS[e.tipo]?.rotulo ?? e.tipo} ${TABELAS[e.alvo] ?? e.alvo}`,
      cell: e => <><Badge tone={TIPOS[e.tipo]?.tom ?? 'neutral'}>{TIPOS[e.tipo]?.rotulo ?? e.tipo}</Badge> {TABELAS[e.alvo] ?? e.alvo}</>,
    },
    { id: 'det', header: 'Detalhe', value: e => resumoEvento(e), cell: e => <span className="evento-det">{resumoEvento(e) || '—'}</span> },
  ];
  return (
    <Card title="Tudo o que foi feito" subtitle="Entradas, liberações e cada criação, alteração ou exclusão, com quem fez e quando" flush>
      <DataTable label="Atividade" columns={cols} rows={linhas} rowKey={e => String(e.id)} searchable exportName="atividade" empty="Nada registrado no período." initialSort={{ id: 'em', dir: -1 }}
        toolbar={<span className="row no-print" style={{ gap: 8 }}>
          <Segmented label="Tipo de registro" value={tipo} onChange={setTipo} options={[{ value: 'todos', label: 'Tudo' }, { value: 'mudancas', label: 'Mudanças' }, { value: 'acesso', label: 'Acessos' }]} />
          <span style={{ minWidth: 180 }}><SelectField label="Pessoa" value={pessoa} onChange={e => setPessoa(e.target.value)} options={pessoas} placeholder="Todas" /></span>
        </span>} />
    </Card>
  );
}

// ---------------------------------------------------------------- métricas
function Metricas({ d }: { d: AcessosDados }) {
  const m = d.metricas;
  const soma = (f: (x: MetricaPessoa) => number) => m.reduce((s, x) => s + f(x), 0);
  const cols: Column<MetricaPessoa>[] = [
    { id: 'nome', header: 'Pessoa', value: x => x.nome, cell: x => <>{x.nome}<small>{x.perfil === 'admin' ? 'administrador' : 'funcionário'}{x.ativo ? '' : ' · inativo'}</small></> },
    { id: 'entradas', header: 'Entradas', numeric: true, value: x => x.entradas, cell: x => x.entradas },
    { id: 'tempo', header: 'Tempo ativo', numeric: true, value: x => x.tempoSeg, cell: x => tempo(x.tempoSeg) },
    { id: 'criou', header: 'Criou', numeric: true, value: x => x.criou, cell: x => x.criou },
    { id: 'alterou', header: 'Alterou', numeric: true, value: x => x.alterou, cell: x => x.alterou },
    { id: 'apagou', header: 'Apagou', numeric: true, value: x => x.apagou, cell: x => (x.apagou ? <b className="valor-neg">{x.apagou}</b> : 0) },
    { id: 'negados', header: 'Negados', numeric: true, value: x => x.negados, cell: x => (x.negados ? <Badge tone="danger">{x.negados}</Badge> : 0) },
    { id: 'ultimo', header: 'Último acesso', value: x => x.ultimo, cell: x => quando(x.ultimo), nowrap: true },
  ];
  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Entradas" value={soma(x => x.entradas)} hint="no período" />
        <Stat label="Tempo ativo" value={tempo(soma(x => x.tempoSeg))} hint="todos somados" />
        <Stat label="Ações" value={soma(x => x.criou + x.alterou + x.apagou)} hint={`${soma(x => x.apagou)} exclusão(ões)`} />
        <Stat label="Acessos negados" value={soma(x => x.negados)} tone={soma(x => x.negados) ? 'danger' : undefined} />
      </div>
      <div className="grid-2">
        <Card title="Tempo ativo por pessoa"><BarrasHorizontais titulo="Tempo ativo por pessoa" formato={tempo}
          itens={[...m].filter(x => x.tempoSeg > 0).sort((a, b) => b.tempoSeg - a.tempoSeg).slice(0, 8).map(x => ({ label: x.nome, value: x.tempoSeg }))} /></Card>
        <Card title="Ações por pessoa" subtitle="Criações, alterações e exclusões"><BarrasHorizontais titulo="Ações por pessoa" cor="var(--viz-2)"
          itens={[...m].map(x => ({ label: x.nome, value: x.criou + x.alterou + x.apagou, detalhe: `${x.criou} criou · ${x.alterou} alterou · ${x.apagou} apagou` })).filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 8)} /></Card>
      </div>
      <Card title="Por pessoa" flush>
        <DataTable label="Métricas por pessoa" columns={cols} rows={m} rowKey={x => x.login} exportName="metricas-acesso" initialSort={{ id: 'tempo', dir: -1 }} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- aparelhos
function Aparelhos({ d }: { d: AcessosDados }) {
  const api = useApi();
  const revogar = useAction((v: { login: string; aparelho: string }) => api.revogarAparelho(v.login, v.aparelho), { success: 'Aparelho revogado: o próximo login dele vai pedir liberação.', invalidate: [[KEY]] });
  return (
    <Card title="Aparelhos confiáveis" subtitle="Entram sem pedir liberação. Revogue se o celular for perdido ou trocado." flush>
      {d.aparelhos.length === 0 ? <EmptyState icon="key" title="Nenhum aparelho confiável">Use “Liberar e confiar” num pedido de acesso.</EmptyState> : (
        <div className="list">
          {d.aparelhos.map(a => (
            <div className="item" key={a.login + a.aparelho}>
              <div className="item-main"><b>{a.nome}</b><small>{a.descricao || 'aparelho'} · confiável desde {quando(a.desde)}{a.por ? ` · por ${a.por}` : ''}</small></div>
              <Button size="sm" variant="ghost" onClick={() => revogar.mutate({ login: a.login, aparelho: a.aparelho })}>Revogar</Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function AcessosPage() {
  const api = useApi();
  const [aba, setAba] = useState<Aba>('pedidos');
  const [periodo, setPeriodo] = useState<Periodo>('7');
  const f = faixa(periodo);
  const q = useQuery({ queryKey: [KEY, f.ini, f.fim], queryFn: () => api.acessos(f.ini, f.fim), refetchInterval: 15_000 });
  const n = q.data?.pendentes.length ?? 0;
  return (
    <>
      <PageHeader title="Acessos e atividade" subtitle="Quem entra, quando, de onde, por quanto tempo e o que fez"
        actions={<Segmented<Periodo> label="Período" value={periodo} onChange={setPeriodo} options={[{ value: 'hoje', label: 'Hoje' }, { value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }]} />} />
      <QueryView query={q}>
        {d => (
          <div className="stack">
            <div style={{ overflowX: 'auto' }}>
              <Segmented<Aba> label="Seções" value={aba} onChange={setAba} options={[
                { value: 'pedidos', label: n ? `Pedidos (${n})` : 'Pedidos' }, { value: 'online', label: `Online (${d.online.length})` },
                { value: 'entradas', label: 'Entradas' }, { value: 'atividade', label: 'Atividade' }, { value: 'metricas', label: 'Métricas' },
                { value: 'aparelhos', label: 'Aparelhos' },
              ]} />
            </div>
            {aba === 'pedidos' && <Pedidos d={d} />}
            {aba === 'online' && <Online d={d} />}
            {aba === 'entradas' && <Entradas d={d} />}
            {aba === 'atividade' && <Atividade d={d} />}
            {aba === 'metricas' && <Metricas d={d} />}
            {aba === 'aparelhos' && <Aparelhos d={d} />}
          </div>
        )}
      </QueryView>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }}><Icon name="key" size={13} /> Registros ficam guardados no banco e entram na cópia de segurança.</p>
    </>
  );
}
