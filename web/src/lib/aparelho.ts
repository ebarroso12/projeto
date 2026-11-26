import { storage } from './storage';

const KEY = 'fab_aparelho';

/** Identificador aleatório deste navegador (para "confiar neste aparelho"). Não identifica a pessoa. */
export function aparelhoId(): string {
  let id = storage.get(KEY);
  if (!id || id.length < 16) {
    const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    id = r;
    storage.set(KEY, id);
  }
  return id;
}

/** "Chrome · Android", "Safari · iPhone"… só para o administrador reconhecer o aparelho. */
export function descreverAparelho(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'outro sistema';
  return `${nav} · ${so}`;
}
