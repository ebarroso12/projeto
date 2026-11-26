import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApi, type Api } from '../api/client';
import { ApiError, type Transport } from '../api/transport';
import { storage } from '../lib/storage';

const TOKEN_KEY = 'fab_token';

interface AuthValue {
  api: Api;
  token: string | null;
  /** true enquanto o login automático pelo link (?k=) está em andamento. */
  booting: boolean;
  notice: string | null;
  wifiBlocked: boolean;
  demo: boolean;
  signIn: (login: string, senha: string) => Promise<void>;
  signOut: () => void;
  retryWifi: () => void;
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
export function AuthProvider({ transport, demo, children }: { transport: Transport; demo: boolean; children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => storage.get(TOKEN_KEY));
  const tokenRef = useRef(token);
  const keyRef = useRef(new URLSearchParams(window.location.search).get('k'));
  const [booting, setBooting] = useState(Boolean(keyRef.current));
  const [notice, setNotice] = useState<string | null>(null);
  const [wifiBlocked, setWifiBlocked] = useState(false);
  const clientRef = useRef<QueryClient | null>(null);

  const setToken = useCallback((t: string | null) => {
    tokenRef.current = t;
    setTokenState(t);
    storage.set(TOKEN_KEY, t);
  }, []);

  const api = useMemo(() => createApi(transport, () => tokenRef.current), [transport]);

  const onError = useCallback((err: unknown) => {
    if (!(err instanceof ApiError)) return;
    if (err.code === 'SESSAO') {
      setToken(null);
      clientRef.current?.clear();
      setNotice('Sua sessão expirou. Entre de novo, por favor.');
    }
    if (err.code === 'WIFI') setWifiBlocked(true);
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

  const signIn = useCallback(async (login: string, senha: string) => {
    const t = await api.login(login.trim(), senha);
    queryClient.clear();
    setNotice(null);
    setWifiBlocked(false);
    setToken(t);
  }, [api, queryClient, setToken]);

  const signOut = useCallback(() => {
    void api.sair().catch(() => {});
    if (keyRef.current) { // sem isso, recarregar a página entraria de novo pelo link
      keyRef.current = null;
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    setToken(null);
    queryClient.clear();
    setNotice(null);
  }, [api, queryClient, setToken]);

  const retryWifi = useCallback(() => {
    setWifiBlocked(false);
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({ api, token, booting, notice, wifiBlocked, demo, signIn, signOut, retryWifi }),
    [api, token, booting, notice, wifiBlocked, demo, signIn, signOut, retryWifi],
  );

  return (
    <AuthCtx.Provider value={value}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AuthCtx.Provider>
  );
}
