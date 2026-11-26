import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Boot } from '../api/types';
import { ErrorState } from '../ui/QueryView';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { useApi, useAuth } from './auth';
import { aparelhoId, descreverAparelho } from '../lib/aparelho';

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
          <Button variant="ghost" block onClick={() => signOut()}>Sair</Button>
        </div>
      </div>
    </div>
  );
}

/** Aguarda o administrador liberar esta sessão; abre sozinho quando liberar. */
export function PendenteGate() {
  const api = useApi();
  const { signOut, acessoLiberado } = useAuth();
  const pediu = useRef(false);
  useEffect(() => {
    let vivo = true;
    const checar = async () => {
      try {
        let st = await api.statusAcesso();
        if (st === 'nenhuma' && !pediu.current) { pediu.current = true; st = await api.pedirAcesso(aparelhoId(), descreverAparelho()); }
        if (!vivo) return;
        if (st === 'aprovada') acessoLiberado();
        else if (st === 'negada') signOut('O administrador não liberou este acesso. Fale com ele e tente de novo.');
        else if (st === 'encerrada') signOut('Sua sessão foi encerrada. Entre de novo.');
      } catch { /* sem internet: tenta de novo no próximo ciclo */ }
    };
    void checar();
    const t = window.setInterval(() => void checar(), 4000);
    return () => { vivo = false; window.clearInterval(t); };
  }, [api, acessoLiberado, signOut]);
  return (
    <div className="center-screen">
      <div className="card auth-card">
        <div className="card-body" style={{ textAlign: 'center', alignItems: 'center' }}>
          <img src="marca/acessos.webp" alt="" width={72} height={72} style={{ borderRadius: 18 }} />
          <div className="state" style={{ padding: 0 }}>
            <h2>Aguardando liberação</h2>
            <p>Seu pedido de acesso foi enviado ao administrador. Esta tela abre sozinha assim que ele liberar.</p>
          </div>
          <div className="row" style={{ justifyContent: 'center' }} role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><span className="muted">Esperando resposta…</span></div>
          <Button variant="ghost" block onClick={() => signOut()}>Cancelar e sair</Button>
        </div>
      </div>
    </div>
  );
}

export function BootGate({ children }: { children: ReactNode }) {
  const api = useApi();
  const { wifiBlocked, pendente } = useAuth();
  const q = useQuery({ queryKey: BOOT_KEY, queryFn: () => api.boot() });

  if (pendente) return <PendenteGate />;
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
