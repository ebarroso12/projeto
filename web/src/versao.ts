export interface InfoVersao { versao: string; data: string; build: string }
export interface Versao { versao: string; data: string; novidades: string[] }

declare const __VERSAO__: InfoVersao;
declare const __VERSOES__: Versao[];

/** Versão deste app (definida no build a partir de versoes.json). Nos testes, valores neutros. */
export const VERSAO: InfoVersao = typeof __VERSAO__ !== 'undefined' ? __VERSAO__ : { versao: '0.0.0', data: '', build: 'dev' };
export const VERSOES: Versao[] = typeof __VERSOES__ !== 'undefined' ? __VERSOES__ : [];

/** Busca a versão publicada agora (sem cache). null = não deu para saber (offline, dev). */
export async function versaoPublicada(): Promise<(InfoVersao & { novidades?: string[] }) | null> {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as InfoVersao & { novidades?: string[] };
    return j && typeof j.build === 'string' ? j : null;
  } catch { return null; }
}

/** Atualiza para a versão mais nova: limpa caches do navegador e recarrega a página. */
export async function atualizarApp(): Promise<void> {
  try {
    if ('caches' in window) { for (const k of await caches.keys()) await caches.delete(k); }
    if ('serviceWorker' in navigator) { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); }
  } catch { /* segue mesmo assim */ }
  const u = new URL(window.location.href);
  u.searchParams.set('v', String(Date.now()));
  window.location.replace(u.toString());
}
