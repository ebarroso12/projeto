import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Api } from '../api/client';
import { ApiError } from '../api/transport';
import { storage } from '../lib/storage';

const TOKEN_KEY = 'fab_token';

interface AuthValue {
  api: Api;
  token: string | null;
  /** true enquanto o login automático pelo link (?k=) está em andamento. */
  booting: boolean;
  notice: string | null;
  wifiBlocked: boolean;
  /** true quando a sessão aguarda o administrador liberar o acesso. */
  pendente: boolean;
  demo: boolean;
  signIn: (login: string, senha: string, empresa?: string) => Promise<void>;
  /** Sai; com `aviso`, mostra a mensagem na tela de entrada. */
  signOut: (aviso?: string) => void;
  retryWifi: () => void;
  acessoLiberado: () => void;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return v;
}
export const useApi = (): Api => useAuth().api;

/**
 * Dono da sessão. Regras:
 *  - link com ?k=CHAVE entra sozinho como usuário "só ver" (acompanhamento em TV/tablet);
 *  - erro SESSAO em qualquer chamada derruba a sessão e volta ao login;
 *  - erro WIFI em qualquer chamada mostra a tela de "conecte no Wi-Fi da fábrica".
 */
export function AuthProvider({ makeApi, demo, children }: { makeApi: (getToken: () => string | null) => Api; demo: boolean; children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => storage.get(TOKEN_KEY));
  const tokenRef = useRef(token);
  const keyRef = useRef(new URLSearchParams(window.location.search).get('k'));
  const [booting, setBooting] = useState(Boolean(keyRef.current));
  const [notice, setNotice] = useState<string | null>(null);
  const [wifiBlocked, setWifiBlocked] = useState(false);
  const [pendente, setPendente] = useState(false);
  const clientRef = useRef<QueryClient | null>(null);

  const setToken = useCallback((t: string | null) => {
    tokenRef.current = t;
    setTokenState(t);
    // sessão de link "só ver" (?k=) é refeita a cada abertura pelo próprio link; não guarda,
    // senão reabrir o app sem o ?k= cairia numa sessão velha e mostraria "sessão expirada".
    storage.set(TOKEN_KEY, keyRef.current ? null : t);
  }, []);

  const api = useMemo(() => makeApi(() => tokenRef.current), [makeApi]);

  const onError = useCallback((err: unknown) => {
    if (!(err instanceof ApiError)) return;
    if (err.code === 'SESSAO') {
      setToken(null);
      clientRef.current?.clear();
      setNotice(err.message || 'Sua sessão expirou. Entre de novo, por favor.');
      setPendente(false);
    }
    if (err.code === 'WIFI') setWifiBlocked(true);
    if (err.code === 'PENDENTE') setPendente(true);
  }, [setToken]);

  const queryClient = useMemo(() => {
    const c = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnWindowFocus: true,
          retry: (n, e) => e instanceof ApiError && e.code === 'REDE' && n < 1,
        },
      },
    });
    clientRef.current = c;
    return c;
  }, [onError]);

  useEffect(() => {
    const k = keyRef.current;
    if (!k) return;
    let alive = true;
    api.loginChave(k)
      .then(t => { if (alive) { setToken(t); setNotice(null); } })
      .catch(e => { if (alive) { setToken(null); setNotice(e instanceof ApiError ? e.message : 'Link de acesso inválido.'); } })
      .finally(() => { if (alive) setBooting(false); });
    return () => { alive = false; };
  }, [api, setToken]);

  const signIn = useCallback(async (login: string, senha: string, empresa?: string) => {
    const t = await api.login(login.trim(), senha, empresa?.trim().toLowerCase());
    queryClient.clear();
    setNotice(null);
    setWifiBlocked(false);
    setPendente(false);
    setToken(t);
  }, [api, queryClient, setToken]);

  const signOut = useCallback((aviso?: string) => {
    void api.sair().catch(() => {});
    if (keyRef.current) { // sem isso, recarregar a página entraria de novo pelo link
      keyRef.current = null;
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    setToken(null);
    queryClient.clear();
    setNotice(typeof aviso === 'string' ? aviso : null);
    setPendente(false);
  }, [api, queryClient, setToken]);

  const retryWifi = useCallback(() => {
    setWifiBlocked(false);
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const acessoLiberado = useCallback(() => {
    setPendente(false);
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({ api, token, booting, notice, wifiBlocked, pendente, demo, signIn, signOut, retryWifi, acessoLiberado }),
    [api, token, booting, notice, wifiBlocked, pendente, demo, signIn, signOut, retryWifi, acessoLiberado],
  );

  return (
    <AuthCtx.Provider value={value}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AuthCtx.Provider>
  );
}
