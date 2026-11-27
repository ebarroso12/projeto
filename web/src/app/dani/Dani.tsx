import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DaniMsg } from '../../api/types';
import { useApi } from '../auth';
import { useBoot } from '../boot';
import { features, pode } from '../registry';
import { Icon } from '../../ui/Icon';
import { respostaDoManual } from './busca';
import { pecas, type Peca } from './formatar';
import { linkManual } from '../../lib/manual';

const CHAVE = 'fab_dani_conversa';
const lerConversa = (): DaniMsg[] => { try { return JSON.parse(sessionStorage.getItem(CHAVE) ?? '[]') as DaniMsg[]; } catch { return []; } };
const salvarConversa = (m: DaniMsg[]) => { try { sessionStorage.setItem(CHAVE, JSON.stringify(m.slice(-30))); } catch { /* sem armazenamento */ } };

/** Perguntas sugeridas conforme a tela em que a pessoa está. */
const SUGESTOES: Record<string, string[]> = {
  '/remessas': ['Como a costureira confirma as peças pelo link?', 'Como funciona a contagem às cegas?', 'O que o Balanço mostra?', 'Como é feito o acerto da oficina?'],
  '/lancar': ['Como lanço em nome de outra pessoa?', 'Lancei errado, como corrijo?'],
  '/pedidos': ['Como o andamento do pedido é calculado?', 'Como entrego e lanço no financeiro?'],
  '/materiais': ['Como cadastro a regra de consumo do tecido?', 'Como faço a contagem do estoque?'],
  '/financeiro': ['Como lanço uma venda a prazo?', 'Como pago uma fatura do cartão?'],
  '/produtividade': ['Como pago a produção da equipe?', 'Como defino o valor por peça?'],
  '/cadastros': ['Como cadastro um funcionário?', 'Como libero funções para uma pessoa?'],
  '/resultado': ['Como é calculado o lucro por modelo?'],
  '/ponto': ['Esqueci de marcar a saída, e agora?'],
  '/empresas': ['Como gero um link de teste?', 'Como configuro a IA da Dani?'],
};
const GERAIS = ['Por onde começo a montar a empresa?', 'Como instalo o app e ligo os avisos?', 'Como funciona o controle de oficinas?'];

/** Texto simples da Dani: **negrito**, listas e atalhos [[ir:/rota|Nome]] viram botões. */
function Texto({ texto, onIr }: { texto: string; onIr: (rota: string) => void }) {
  const atalhos: { rota: string; nome: string }[] = [];
  const limpo = texto.replace(/\[\[ir:(\/[a-z-]*)\|([^\]]{1,60})\]\]/g, (_m, rota: string, nome: string) => { atalhos.push({ rota, nome }); return ''; }).trim();
  // **negrito**, *itálico* e `código` (o Gemini usa os três) — ver formatar.ts
  const desenha = (ps: Peca[]): ReactNode[] => ps.map((p, i) => (
    p.tipo === 'b' ? <b key={i}>{desenha(p.filhos ?? [])}</b>
      : p.tipo === 'i' ? <i key={i}>{p.texto}</i>
        : p.tipo === 'code' ? <code key={i}>{p.texto}</code>
          : <Fragment key={i}>{p.texto}</Fragment>));
  const inline = (s: string) => desenha(pecas(s));
  const blocos: ReactNode[] = [];
  let lista: { tipo: 'ol' | 'ul'; itens: string[] } | null = null;
  const fecha = () => { if (lista) { const L = lista; blocos.push(L.tipo === 'ol' ? <ol key={blocos.length}>{L.itens.map((x, i) => <li key={i}>{inline(x)}</li>)}</ol> : <ul key={blocos.length}>{L.itens.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); lista = null; } };
  for (const linha of limpo.split('\n')) {
    const t = linha.trim();
    const num = t.match(/^\d+[.)]\s+(.*)$/), bul = t.match(/^[-*•]\s+(.*)$/);
    if (num) { if (lista?.tipo !== 'ol') { fecha(); lista = { tipo: 'ol', itens: [] }; } lista!.itens.push(num[1]!); continue; }
    if (bul) { if (lista?.tipo !== 'ul') { fecha(); lista = { tipo: 'ul', itens: [] }; } lista!.itens.push(bul[1]!); continue; }
    fecha();
    if (t) blocos.push(<p key={blocos.length}>{inline(t.replace(/^#+\s*/, ''))}</p>);
  }
  fecha();
  return (
    <>
      {blocos}
      {atalhos.length > 0 && <div className="dani-atalhos">{atalhos.map(a => <button key={a.rota + a.nome} type="button" onClick={() => onIr(a.rota)}><Icon name="arrowUp" size={13} className="dani-seta" /> {a.nome}</button>)}</div>}
    </>
  );
}

function Avatar({ tamanho = 36 }: { tamanho?: number }) {
  return (
    <svg className="dani-avatar" width={tamanho} height={tamanho} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#0b2466" />
      <circle cx="24" cy="21" r="10" fill="#ffd9b0" />
      <path d="M13 20a11 11 0 0 1 22 0v2h-3v-3a8 8 0 0 0-16 0v3h-3z" fill="#f7931e" />
      <rect x="11" y="19" width="4" height="8" rx="2" fill="#f7931e" />
      <rect x="33" y="19" width="4" height="8" rx="2" fill="#f7931e" />
      <path d="M35 26c0 5-4 7-8 7" stroke="#f7931e" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="20.5" cy="21" r="1.4" fill="#0b2466" /><circle cx="27.5" cy="21" r="1.4" fill="#0b2466" />
      <path d="M21 25.5c1.8 1.4 4.2 1.4 6 0" stroke="#0b2466" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M10 44c2-8 8-11 14-11s12 3 14 11z" fill="#f7931e" />
    </svg>
  );
}

/** Dani: assistente no canto da tela. Pergunta à IA (Gemini) e, se ela não puder responder, ao manual. */
export function Dani() {
  const api = useApi();
  const { eu } = useBoot();
  const loc = useLocation();
  const nav = useNavigate();
  const [aberta, setAberta] = useState(false);
  const [msgs, setMsgs] = useState<DaniMsg[]>(lerConversa);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const tela = features.find(f => loc.pathname.startsWith(f.path))?.label ?? '';
  useEffect(() => { salvarConversa(msgs); fim.current?.scrollIntoView({ block: 'end' }); }, [msgs, pensando]);
  useEffect(() => { if (aberta) setTimeout(() => campo.current?.focus(), 50); }, [aberta]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberta(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const ir = (rota: string) => {
    const f = features.find(x => x.path === rota);
    if (f && !pode(eu, f.id)) {
      setMsgs(m => [...m, { de: 'dani', texto: `Você não tem acesso a **${f.label}**. Peça ao administrador para liberar em Cadastros > Funcionários.`, local: true }]);
      return;
    }
    nav(rota);
    if (window.innerWidth < 700) setAberta(false);
  };

  const perguntar = async (p: string) => {
    const pergunta = p.trim();
    if (!pergunta || pensando) return;
    const historico = msgs;
    setMsgs(m => [...m, { de: 'eu', texto: pergunta }]);
    setTexto('');
    setPensando(true);
    try {
      const r = await api.daniPerguntar(pergunta, historico, tela);
      if ('resposta' in r) setMsgs(m => [...m, { de: 'dani', texto: r.resposta }]);
      else if (r.erro === 'limite' || r.erro === 'sessao') setMsgs(m => [...m, { de: 'dani', texto: r.mensagem, local: true }]);
      else setMsgs(m => [...m, { de: 'dani', texto: respostaDoManual(pergunta), local: true }]);
    } catch {
      setMsgs(m => [...m, { de: 'dani', texto: respostaDoManual(pergunta), local: true }]);
    } finally {
      setPensando(false);
    }
  };

  const sugestoes = SUGESTOES[loc.pathname] ?? GERAIS;
  const primeiroNome = eu.nome.split(' ')[0];

  return (
    <>
      {!aberta && (
        <button type="button" className="dani-botao" onClick={() => setAberta(true)} aria-label="Perguntar à Dani, assistente do app">
          <Avatar tamanho={30} /><span>Dani</span>
        </button>
      )}
      {aberta && (
        <section className="dani-painel" role="dialog" aria-label="Dani, assistente do app">
          <header>
            <Avatar />
            <div><b>Dani</b><small>Assistente do Fábrica</small></div>
            <a className="dani-acao" href={linkManual()} target="_blank" rel="noreferrer">Manual</a>
            {msgs.length > 0 && <button type="button" className="dani-acao" onClick={() => setMsgs([])}>Limpar</button>}
            <button type="button" className="dani-fechar" aria-label="Fechar a Dani" onClick={() => setAberta(false)}><Icon name="x" size={18} /></button>
          </header>
          <div className="dani-conversa" aria-live="polite">
            <div className="dani-msg dani">
              <p>Oi, {primeiroNome}! Sou a Dani. Posso explicar qualquer tela do app passo a passo. O que você quer fazer?</p>
            </div>
            {msgs.map((m, i) => (
              <div key={i} className={`dani-msg ${m.de}`}>
                {m.de === 'dani' ? <Texto texto={m.texto} onIr={ir} /> : <p>{m.texto}</p>}
                {m.de === 'dani' && m.local && i === msgs.length - 1 && !/limite|Entre no app/i.test(m.texto) && <small className="dani-fonte">Resposta do manual</small>}
              </div>
            ))}
            {pensando && <div className="dani-msg dani"><span className="dani-digitando" aria-label="Dani está escrevendo"><i /><i /><i /></span></div>}
            {!msgs.length && (
              <div className="dani-sugestoes">
                {sugestoes.map(s => <button key={s} type="button" onClick={() => void perguntar(s)}>{s}</button>)}
              </div>
            )}
            <div ref={fim} />
          </div>
          <form className="dani-form" onSubmit={e => { e.preventDefault(); void perguntar(texto); }}>
            <label htmlFor="dani-pergunta" className="sr-only">Sua dúvida</label>
            <textarea id="dani-pergunta" ref={campo} rows={1} value={texto} maxLength={1000} placeholder="Escreva sua dúvida…"
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void perguntar(texto); } }} />
            <button type="submit" aria-label="Enviar pergunta" disabled={!texto.trim() || pensando}><Icon name="send" size={18} /></button>
          </form>
        </section>
      )}
    </>
  );
}
