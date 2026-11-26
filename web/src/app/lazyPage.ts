import { lazy, type ComponentType } from 'react';

const KEY = 'fab_chunk_reload';

/**
 * Igual a React.lazy, mas resistente a novas publicações: se o navegador ainda roda a versão
 * anterior, os arquivos dela já não existem e o import falha ("Failed to fetch dynamically
 * imported module"). Aí recarregamos a página UMA vez para pegar a versão nova.
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem(KEY); } catch { /* sem storage */ }
      return mod;
    } catch (err) {
      let jaTentou = false;
      try { jaTentou = sessionStorage.getItem(KEY) === '1'; sessionStorage.setItem(KEY, '1'); } catch { /* sem storage */ }
      if (!jaTentou) {
        window.location.reload();
        return new Promise<never>(() => {}); // a página vai recarregar
      }
      throw err;
    }
  });
}

export const isChunkError = (e: unknown) =>
  e instanceof Error && /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(e.message);
