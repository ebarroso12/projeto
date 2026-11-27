import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Mensagem } from '../api/types';
import { dataBR } from '../lib/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { QueryView } from '../ui/QueryView';
import { Badge, Banner, EmptyState, Segmented } from '../ui/primitives';
import { useToast } from '../ui/Toast';
import { useApi } from './auth';
import { useBoot } from './boot';
import { pode } from './registry';
import { useAction } from './useAction';

const KEY = ['mensagens'];
const quando = (iso: string) => `${dataBR(iso.slice(0, 10))} ${iso.slice(11, 16)}`;

function NovaMensagem({ onEnviada }: { onEnviada: () => void }) {
  const api = useApi();
  const dest = useQuery({ queryKey: ['destinatarios'], queryFn: () => api.destinatarios() });
  const [para, setPara] = useState('');
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [importante, setImportante] = useState(false);
  const enviar = useAction(() => api.enviarMensagem(para, titulo, texto, importante), {
    success: () => (para ? 'Mensagem enviada.' : 'Mensagem enviada para todos.'), invalidate: [KEY, ['mensagens-enviadas']],
    onSuccess: () => { setTexto(''); setTitulo(''); setImportante(false); onEnviada(); },
  });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <SelectField label="Para" value={para} onChange={e => setPara(e.target.value)}
        options={[{ value: '', label: 'Todos os funcionários' }, ...(dest.data ?? []).map(d => ({ value: d.login, label: `${d.nome} · ${d.setor}` }))]} />
      <TextField label="Assunto (opcional)" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex.: Inventário sexta-feira" />
      <TextAreaField label="Mensagem" value={texto} rows={5} onChange={e => setTexto(e.target.value)} placeholder="Escreva o recado…" />
      <label className="check"><input type="checkbox" checked={importante} onChange={e => setImportante(e.target.checked)} /> Importante (abre na tela da pessoa assim que ela usar o app)</label>
      <div><Button variant="primary" icon={<Icon name="send" size={16} />} loading={enviar.isPending} disabled={!texto.trim()} onClick={() => enviar.mutate()}>Enviar</Button></div>
    </div>
  );
}

function Enviadas() {
  const api = useApi();
  const q = useQuery({ queryKey: ['mensagens-enviadas'], queryFn: () => api.mensagensEnviadas(), refetchInterval: 30_000 });
  const apagar = useAction((id: string) => api.apagarMensagem(id), { success: 'Mensagem apagada.', invalidate: [['mensagens-enviadas'], KEY] });
  const [aberta, setAberta] = useState<string | null>(null);
  return (
    <QueryView query={q}>
      {lista => lista.length === 0 ? <EmptyState icon="chat" title="Nada enviado ainda" /> : (
        <ul className="msgs">
          {lista.map(m => {
            const total = m.leram.length + m.faltam.length;
            return (
              <li key={m.id} className="msg">
                <div className="msg-cab"><b>{m.titulo || 'Mensagem'}</b>{m.importante && <Badge tone="danger">importante</Badge>}<small>para {m.para} · {quando(m.em)} · por {m.autor}</small></div>
                <p>{m.texto}</p>
                <div className="msg-pe">
                  <button type="button" className="link" onClick={() => setAberta(aberta === m.id ? null : m.id)}>Lida por {m.leram.length} de {total}</button>
                  <Button size="sm" variant="ghost" onClick={() => apagar.mutate(m.id)}>Apagar</Button>
                </div>
                {aberta === m.id && (
                  <div className="msg-leitura">
                    <div><small>Leram</small>{m.leram.length ? m.leram.join(', ') : '—'}</div>
                    <div><small>Ainda não leram</small>{m.faltam.length ? m.faltam.join(', ') : 'todos leram'}</div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </QueryView>
  );
}

/** Ícone de mensagens ao lado do nome do usuário (com contador de não lidas) e a caixa de mensagens. */
export function MensagensBotao() {
  const api = useApi();
  const { eu } = useBoot();
  const toast = useToast();
  const qc = useQueryClient();
  const enviar = pode(eu, 'mensagens');
  const q = useQuery({ queryKey: KEY, queryFn: () => api.minhasMensagens(), enabled: !eu.leitura, refetchInterval: 30_000, refetchIntervalInBackground: true });
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<'recebidas' | 'nova' | 'enviadas'>('recebidas');
  const [destaque, setDestaque] = useState<Mensagem | null>(null);
  const vistas = useRef<Set<string> | null>(null);
  const naoLidas = (q.data ?? []).filter(m => !m.lida);
  // aviso de mensagem no celular abre o app em #/?mensagens=1: já abre a caixa de mensagens
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    if (new URLSearchParams(loc.search).has('mensagens')) { setAberto(true); setAba('recebidas'); nav({ pathname: loc.pathname, search: '' }, { replace: true }); }
  }, [loc.search, loc.pathname, nav]);

  // chegada de mensagem nova: aviso; se for importante, abre na tela
  useEffect(() => {
    if (!q.data) return;
    if (vistas.current) {
      const novas = q.data.filter(m => !m.lida && !vistas.current!.has(m.id));
      const imp = novas.find(m => m.importante);
      if (imp) setDestaque(imp); else if (novas[0]) toast.info(`Nova mensagem de ${novas[0].autor}${novas[0].titulo ? `: ${novas[0].titulo}` : ''}`);
    } else {
      const imp = q.data.find(m => !m.lida && m.importante);
      if (imp) setDestaque(imp);
    }
    vistas.current = new Set(q.data.map(m => m.id));
  }, [q.data, toast]);

  const marcar = async (ids: string[]) => {
    if (!ids.length) return;
    try { await api.marcarLidas(ids); } catch { /* tenta de novo na próxima */ }
    void qc.invalidateQueries({ queryKey: KEY });
  };
  useEffect(() => {
    if (!aberto || aba !== 'recebidas' || !naoLidas.length) return;
    const t = window.setTimeout(() => void marcar(naoLidas.map(m => m.id)), 1500);
    return () => window.clearTimeout(t);
  }, [aberto, aba, naoLidas.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (eu.leitura) return null;
  return (
    <>
      <button type="button" className="btn-msg" onClick={() => { setAba('recebidas'); setAberto(true); }}
        aria-label={naoLidas.length ? `Mensagens: ${naoLidas.length} não lida(s)` : 'Mensagens'} title="Mensagens">
        <Icon name="chat" size={18} />
        {naoLidas.length > 0 && <span className="count">{naoLidas.length}</span>}
      </button>
      <Dialog open={aberto} onClose={() => setAberto(false)} title="Mensagens" variant="drawer">
        <div className="stack" style={{ gap: 14 }}>
          {enviar && <Segmented label="Mensagens" value={aba} onChange={setAba}
            options={[{ value: 'recebidas', label: `Recebidas${naoLidas.length ? ` (${naoLidas.length})` : ''}` }, { value: 'nova', label: 'Nova mensagem' }, { value: 'enviadas', label: 'Enviadas' }]} />}
          {aba === 'recebidas' && (
            <QueryView query={q}>
              {lista => lista.length === 0 ? <EmptyState icon="chat" title="Nenhuma mensagem">Os recados da administração aparecem aqui.</EmptyState> : (
                <ul className="msgs">
                  {lista.map(m => (
                    <li key={m.id} className={`msg${m.lida ? '' : ' nova'}`}>
                      <div className="msg-cab"><b>{m.titulo || `Mensagem de ${m.autor}`}</b>{m.importante && <Badge tone="danger">importante</Badge>}{!m.lida && <Badge tone="brand">nova</Badge>}
                        <small>{m.autor} · {quando(m.em)} · {m.para === 'Todos' ? 'para todos' : 'só para você'}</small></div>
                      <p>{m.texto}</p>
                    </li>
                  ))}
                </ul>
              )}
            </QueryView>
          )}
          {aba === 'nova' && enviar && <NovaMensagem onEnviada={() => setAba('enviadas')} />}
          {aba === 'enviadas' && enviar && <Enviadas />}
        </div>
      </Dialog>
      {destaque && (
        <Dialog open onClose={() => { void marcar([destaque.id]); setDestaque(null); }} title="Mensagem importante"
          footer={<Button variant="primary" onClick={() => { void marcar([destaque.id]); setDestaque(null); }}>Li e entendi</Button>}>
          <Banner tone="warn"><b>{destaque.titulo || `De ${destaque.autor}`}</b></Banner>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 15.5 }}>{destaque.texto}</p>
          <small className="muted">{destaque.autor} · {quando(destaque.em)}</small>
        </Dialog>
      )}
    </>
  );
}
