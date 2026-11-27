import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { Api } from './api/client';
import { createApi } from './api/client';
import { httpTransport } from './api/transport';
import '@fontsource-variable/inter'; // fonte embutida no app (sem depender de servidor externo)
import '@fontsource-variable/plus-jakarta-sans'; // títulos e números de destaque
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/polish.css';

// depois de "Atualizar", o endereço vem com ?v=<hora> para furar o cache: limpa da barra de endereço
try {
  const u = new URL(window.location.href);
  if (u.searchParams.has('v')) { u.searchParams.delete('v'); window.history.replaceState(null, '', u.pathname + u.search + u.hash); }
} catch { /* navegador antigo */ }

declare global {
  interface Window {
    __FABRICA__?: { supabaseUrl?: string; supabaseKey?: string; apiUrl?: string };
  }
}

type MakeApi = (getToken: () => string | null) => Api;

/**
 * Escolhe o servidor pela configuração (public/config.js), nesta ordem:
 *   1) Supabase       -> supabaseUrl + supabaseKey (chave "publishable", feita para ficar no navegador)
 *   2) Apps Script    -> apiUrl
 *   3) demonstração   -> nenhuma das duas (dados fictícios em memória)
 * Cada servidor é carregado só quando usado (divisão de código).
 */
async function pickBackend(): Promise<{ makeApi: MakeApi; demo: boolean }> {
  const cfg = window.__FABRICA__ ?? {};
  const supabaseUrl = cfg.supabaseUrl?.trim();
  const supabaseKey = cfg.supabaseKey?.trim();
  if (supabaseUrl && supabaseKey) {
    const [{ createClient }, { createSupabaseApi }] = await Promise.all([import('@supabase/supabase-js'), import('./api/supabase')]);
    const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fab_sb' } });
    const api = createSupabaseApi(sb);
    return { makeApi: () => api, demo: false };
  }
  const apiUrl = cfg.apiUrl?.trim();
  if (apiUrl) {
    const transport = httpTransport(apiUrl);
    return { makeApi: getToken => createApi(transport, getToken), demo: false };
  }
  const { createMockTransport } = await import('./api/mock');
  const transport = createMockTransport();
  return { makeApi: getToken => createApi(transport, getToken), demo: true };
}

void pickBackend().then(({ makeApi, demo }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode><App makeApi={makeApi} demo={demo} /></StrictMode>,
  );
});
