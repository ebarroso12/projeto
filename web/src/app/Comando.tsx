import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../ui/Icon';
import type { Feature } from './registry';

export interface Acao { id: string; label: string; dica?: string; icon: IconName; run: () => void }

const sem = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Busca rápida (Ctrl+K / ⌘K): vai para qualquer tela ou executa uma ação sem tirar a mão do teclado. */
export function Comando({ features, acoes, aberto, setAberto }: { features: Feature[]; acoes: Acao[]; aberto: boolean; setAberto: (v: boolean) => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
      // com uma janela (dialog) aberta, o resto da tela fica inerte: a busca abriria por trás, sem uso
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      setAberto(!aberto);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [aberto, setAberto]);
  useEffect(() => { if (aberto) { setQ(''); setI(0); } }, [aberto]);
  const lista = useRef<HTMLUListElement>(null);
  useEffect(() => { lista.current?.querySelector('li.on')?.scrollIntoView({ block: 'nearest' }); }, [i, aberto]);

  const itens: Acao[] = useMemo(() => {
    const telas: Acao[] = features.map(f => ({ id: f.id, label: f.title, dica: f.group, icon: f.icon, run: () => nav(f.path) }));
    const todos = [...telas, ...acoes];
    const t = sem(q.trim());
    return t ? todos.filter(a => sem(`${a.label} ${a.dica ?? ''}`).includes(t)) : todos;
  }, [features, acoes, q, nav]);

  if (!aberto) return null;
  const escolher = (a?: Acao) => { if (!a) return; setAberto(false); a.run(); };
  return createPortal(
    <div className="cmd-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setAberto(false); }}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Busca rápida">
        <div className="cmd-input">
          <Icon name="search" size={18} />
          <input ref={input} autoFocus value={q} placeholder="Ir para uma tela ou fazer algo…" aria-label="Buscar"
            onChange={e => { setQ(e.target.value); setI(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.max(0, Math.min(itens.length - 1, x + 1))); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); escolher(itens[i]); }
              if (e.key === 'Escape') setAberto(false);
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul className="cmd-list" role="listbox" ref={lista}>
          {itens.length === 0 && <li className="cmd-vazio">Nada encontrado.</li>}
          {itens.map((a, n) => (
            <li key={a.id} role="option" aria-selected={n === i} className={n === i ? 'on' : ''}
              onMouseEnter={() => setI(n)} onClick={() => escolher(a)}>
              <span className="cmd-ic"><Icon name={a.icon} size={16} /></span>
              <span className="cmd-label">{a.label}</span>
              {a.dica && <span className="cmd-dica">{a.dica}</span>}
            </li>
          ))}
        </ul>
        <div className="cmd-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Ctrl</kbd><kbd>K</kbd> abre de qualquer lugar</span></div>
      </div>
    </div>,
    document.body,
  );
}
