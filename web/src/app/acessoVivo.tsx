import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessaoAcesso } from '../api/types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useApi } from './auth';
import { useAction } from './useAction';

export const PENDENTES_KEY = ['acessos-pendentes'];

/** Sinal de vida: a cada troca de tela e a cada minuto com o app aberto (dá "online agora" e o tempo de uso). */
export function usePresenca(tela: string, ativo: boolean) {
  const api = useApi();
  useEffect(() => {
    if (!ativo) return;
    const enviar = () => { if (document.visibilityState === 'visible') void api.presenca(tela).catch(() => {}); };
    enviar();
    const t = window.setInterval(enviar, 60_000);
    document.addEventListener('visibilitychange', enviar);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', enviar); };
  }, [api, tela, ativo]);
}

/** Pedidos de acesso aguardando o administrador (atualiza a cada 8 s e avisa quando chega um novo). */
export function usePendentes(ativo: boolean): SessaoAcesso[] {
  const api = useApi();
  const toast = useToast();
  const vistos = useRef<Set<string> | null>(null);
  const q = useQuery({ queryKey: PENDENTES_KEY, queryFn: () => api.acessosPendentes(), enabled: ativo, refetchInterval: 8000, refetchIntervalInBackground: true });
  const lista = q.data ?? [];
  useEffect(() => {
    if (!q.data) return;
    const ids = new Set(q.data.map(p => p.id));
    if (vistos.current) for (const p of q.data) if (!vistos.current.has(p.id)) toast.info(`${p.nome} quer entrar no sistema (${p.aparelho || 'aparelho novo'}).`);
    vistos.current = ids;
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = q.data.length ? `(${q.data.length}) ${base}` : base;
  }, [q.data, toast]);
  return lista;
}

/** Faixa no topo para o administrador liberar ou negar sem sair da tela em que está. */
export function PendentesBanner({ pendentes }: { pendentes: SessaoAcesso[] }) {
  const api = useApi();
  const qc = useQueryClient();
  const decidir = useAction((v: { id: string; liberar: boolean; confiar: boolean }) => api.decidirAcesso(v.id, v.liberar, v.confiar), {
    success: (_d, v) => (v.liberar ? 'Acesso liberado.' : 'Acesso negado.'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['acessos'] }); },
    invalidate: [PENDENTES_KEY],
  });
  if (!pendentes.length) return null;
  return (
    <div className="pendentes-banner" role="region" aria-label="Pedidos de acesso">
      <div className="pb-head"><Icon name="key" size={16} /><b>{pendentes.length === 1 ? '1 pessoa quer entrar' : `${pendentes.length} pessoas querem entrar`}</b>
        <NavLink to="/acessos" className="link">Ver todos</NavLink></div>
      {pendentes.slice(0, 3).map(p => (
        <div className="pb-item" key={p.id}>
          <div className="pb-quem"><b>{p.nome}</b><small>{p.setor} · {p.aparelho || 'aparelho'}{p.ip ? ` · IP ${p.ip}` : ''} · {p.inicio.slice(11, 16)}</small></div>
          <div className="pb-acoes">
            <Button size="sm" variant="success" onClick={() => decidir.mutate({ id: p.id, liberar: true, confiar: false })} disabled={decidir.isPending}>Liberar</Button>
            <Button size="sm" onClick={() => decidir.mutate({ id: p.id, liberar: true, confiar: true })} disabled={decidir.isPending} title="Os próximos logins deste aparelho entram sem pedir">Liberar e confiar</Button>
            <Button size="sm" variant="danger" onClick={() => decidir.mutate({ id: p.id, liberar: false, confiar: false })} disabled={decidir.isPending}>Negar</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
