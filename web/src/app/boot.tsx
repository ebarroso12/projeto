import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Boot } from '../api/types';
import { ErrorState } from '../ui/QueryView';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { useApi, useAuth } from './auth';

const BootCtx = createContext<Boot | null>(null);

/** Dados de partida (usuário, listas, ponto de hoje, itens em falta). Só existe dentro do <BootGate>. */
export function useBoot(): Boot {
  const b = useContext(BootCtx);
  if (!b) throw new Error('useBoot fora do <BootGate>');
  return b;
}
export const BOOT_KEY = ['boot'] as const;

export function FullLoading({ text = 'Carregando…' }: { text?: string }) {
  return (
    <div className="center-screen" role="status" aria-live="polite">
      <div className="row"><span className="spinner" aria-hidden="true" /><span className="muted">{text}</span></div>
    </div>
  );
}

export function WifiGate() {
  const { retryWifi, signOut } = useAuth();
  return (
    <div className="center-screen">
      <div className="card auth-card">
        <div className="card-body" style={{ textAlign: 'center', alignItems: 'center' }}>
          <div className="state" style={{ padding: 0 }}>
            <div className="icon-wrap"><Icon name="wifi" size={26} /></div>
            <h2>Conecte no Wi-Fi da fábrica</h2>
            <p>O app só funciona dentro da fábrica, conectado ao Wi-Fi dela.</p>
          </div>
          <Button variant="primary" block onClick={retryWifi}>Já conectei, tentar de novo</Button>
          <Button variant="ghost" block onClick={signOut}>Sair</Button>
        </div>
      </div>
    </div>
  );
}

export function BootGate({ children }: { children: ReactNode }) {
  const api = useApi();
  const { wifiBlocked } = useAuth();
  const q = useQuery({ queryKey: BOOT_KEY, queryFn: () => api.boot() });

  if (wifiBlocked) return <WifiGate />;
  if (q.isPending) return <FullLoading text="Abrindo o sistema…" />;
  if (q.isError) {
    return (
      <div className="center-screen">
        <div className="card auth-card"><ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} /></div>
      </div>
    );
  }
  return <BootCtx.Provider value={q.data}>{children}</BootCtx.Provider>;
}
