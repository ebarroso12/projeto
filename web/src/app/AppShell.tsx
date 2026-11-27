import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { TextField } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { PageArt } from '../ui/primitives';
import { useToast } from '../ui/Toast';
import { iniciais, longDate } from '../lib/format';
import { Comando, type Acao } from './Comando';
import { MIN_SENHA } from '../lib/rules';
import { ErrorBoundary } from './ErrorBoundary';
import { useApi, useAuth } from './auth';
import { useBoot } from './boot';
import { pode, visibleFeatures, features } from './registry';
import { useTheme } from './theme';
import { PendentesBanner, usePendentes, usePresenca } from './acessoVivo';
import { BotaoAtualizar, Rodape } from './Versao';

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const m = useMutation({
    mutationFn: () => api.trocarSenha(atual, nova),
    onSuccess: () => { toast.success('Senha trocada!'); onClose(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (nova.length >= MIN_SENHA) m.mutate(); };
  useEffect(() => { if (!open) { setAtual(''); setNova(''); m.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onClose={onClose} title="Trocar senha"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={nova.length < MIN_SENHA || !atual} onClick={() => m.mutate()}>Salvar</Button></>}>
      <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
        <TextField label="Senha atual" type="password" value={atual} onChange={e => setAtual(e.target.value)} autoComplete="current-password" />
        <TextField label="Nova senha" type="password" value={nova} onChange={e => setNova(e.target.value)} autoComplete="new-password"
          hint={`Mínimo de ${MIN_SENHA} caracteres.`} error={m.error instanceof Error ? m.error.message : undefined} />
      </form>
    </Dialog>
  );
}

function UserMenu({ onPassword }: { onPassword: () => void }) {
  const { eu } = useBoot();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <Button variant="ghost" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{eu.nome}</span>
      </Button>
      {open && (
        <div className="menu-panel" role="menu">
          <div className="menu-head"><b>{eu.nome}</b><small className="muted">{eu.setor}{eu.admin ? ' · administrador' : ''}{eu.leitura ? ' · só ver' : ''}</small></div>
          {!eu.leitura && <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); onPassword(); }}><Icon name="key" size={16} />Trocar senha</button>}
          <button type="button" role="menuitem" className="menu-item" onClick={() => signOut()}><Icon name="logout" size={16} />Sair</button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const boot = useBoot();
  const { demo, signOut, api } = useAuth();
  const [cmd, setCmd] = useState(false);
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const [pwd, setPwd] = useState(false);
  const [mais, setMais] = useState(false);
  const items = visibleFeatures(boot.eu);
  const current = features.find(f => pathname.startsWith(f.path));
  usePresenca(current?.label ?? '', !boot.eu.leitura);
  const pendentes = usePendentes(pode(boot.eu, 'acessos'));
  const teste = useQuery({ queryKey: ['meu-teste'], queryFn: () => api.meuTeste(), enabled: !boot.eu.leitura, staleTime: 10 * 60_000 }).data ?? '';
  const diasTeste = teste ? Math.max(0, Math.ceil((Date.parse(teste) - Date.now()) / 86_400_000)) : 0;
  const pageInfo = useMemo(() => ({ art: current ? `marca/${current.id}.webp` : undefined, grupo: current?.group }), [current]);
  const acoes: Acao[] = useMemo(() => [
    { id: 'tema', label: theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro', dica: 'Aparência', icon: theme === 'dark' ? 'sun' : 'moon', run: toggle },
    ...(boot.eu.leitura ? [] : [{ id: 'senha', label: 'Trocar minha senha', dica: 'Conta', icon: 'key' as const, run: () => setPwd(true) }]),
    { id: 'sair', label: 'Sair do sistema', dica: 'Conta', icon: 'logout', run: () => signOut() },
  ], [theme, toggle, boot.eu.leitura, signOut]);
  const contar = (f: (typeof items)[number]) => (f.id === 'acessos' ? pendentes.length : f.badge?.(boot) ?? 0);

  useEffect(() => { document.title = `${current?.title ?? 'Fábrica'} · Fábrica`; }, [current]);

  let lastGroup = '';
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Menu principal">
        <div className="brand">
          <img className="brand-mark" src="marca/marca-96.webp" alt="" width={36} height={36} />
          <div className="brand-name">{boot.empresa.nome || 'Fábrica'}<small>{demo ? 'Demonstração' : 'Gestão da produção'}</small></div>
        </div>
        <nav className="nav">
          {items.map(f => {
            const showGroup = f.group !== lastGroup;
            lastGroup = f.group;
            const count = contar(f);
            return (
              <div key={f.id} style={{ display: 'contents' }}>
                {showGroup && <div className="nav-label">{f.group}</div>}
                <NavLink to={f.path}>
                  <Icon name={f.icon} />{f.label}
                  {count > 0 && <span className="count" aria-label={`${count} itens`}>{count}</span>}
                </NavLink>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="user-card">
            <span className="avatar" aria-hidden="true">{iniciais(boot.eu.nome)}</span>
            <span className="user-txt"><b>{boot.eu.nome}</b><small>{[boot.eu.setor, boot.eu.admin && 'Administrador', boot.eu.leitura && 'só acompanhamento'].filter(Boolean).join(' · ')}</small></span>
            <button type="button" className="user-out" onClick={() => signOut()} aria-label="Sair" title="Sair"><Icon name="logout" size={16} /></button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-brand"><img className="brand-mark" src="marca/marca-96.webp" alt="" width={28} height={28} style={{ width: 28, height: 28 }} />{current?.label ?? 'Fábrica'}</span>
            <span className="topbar-date">{longDate()}</span>
          </div>
          <div className="topbar-right">
            <button type="button" className="cmd-trigger" onClick={() => setCmd(true)} aria-label="Busca rápida (Ctrl+K)">
              <Icon name="search" size={16} /><span>Buscar ou ir para…</span><kbd>Ctrl K</kbd>
            </button>
            <Button variant="ghost" iconOnly onClick={toggle} aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </Button>
            <BotaoAtualizar />
            <UserMenu onPassword={() => setPwd(true)} />
          </div>
        </header>
        <main className="page" id="conteudo">
          {teste && (
            <div className="teste-faixa" role="status">
              <span className="tf-selo">Teste grátis</span>
              <span>{diasTeste > 1 ? `Faltam ${diasTeste} dias` : diasTeste === 1 ? 'Último dia' : 'Termina hoje'} · até {teste.slice(8, 10)}/{teste.slice(5, 7)} às {teste.slice(11, 16)}.</span>
              <span className="tf-dica">Para continuar depois, fale com quem enviou o link.</span>
            </div>
          )}
          <PendentesBanner pendentes={pendentes} />
          <PageArt.Provider value={pageInfo}><ErrorBoundary key={pathname}><Outlet /></ErrorBoundary></PageArt.Provider>
          <Rodape />
        </main>
      </div>

      <nav className="bottomnav" aria-label="Menu principal">
        {(items.length > 5 ? items.slice(0, 4) : items).map(f => {
          const count = contar(f);
          return (
            <NavLink key={f.id} to={f.path}>
              <Icon name={f.icon} size={21} /><span>{f.label}</span>
              {count > 0 && <span className="count">{count}</span>}
            </NavLink>
          );
        })}
        {items.length > 5 && (
          <a href="#mais" className={items.slice(4).some(f => pathname.startsWith(f.path)) ? 'active' : undefined}
            onClick={e => { e.preventDefault(); setMais(true); }} aria-haspopup="dialog">
            <Icon name="more" size={21} /><span>Mais</span>
            {items.slice(4).reduce((n, f) => n + contar(f), 0) > 0 && <span className="count">{items.slice(4).reduce((n, f) => n + contar(f), 0)}</span>}
          </a>
        )}
      </nav>
      <Dialog open={mais} onClose={() => setMais(false)} title="Mais opções" variant="drawer">
        <nav className="nav" aria-label="Mais opções">
          {items.slice(4).map(f => (
            <NavLink key={f.id} to={f.path} onClick={() => setMais(false)}><Icon name={f.icon} />{f.label}{contar(f) > 0 && <span className="count">{contar(f)}</span>}</NavLink>
          ))}
        </nav>
      </Dialog>

      <ChangePassword open={pwd} onClose={() => setPwd(false)} />
      <Comando features={items} acoes={acoes} aberto={cmd} setAberto={setCmd} />
    </div>
  );
}
