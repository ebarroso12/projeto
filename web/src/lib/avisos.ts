/**
 * Avisos no celular (Web Push) e instalação do app.
 * O navegador cria uma "inscrição" (endereço + chaves) com a chave pública VAPID do servidor;
 * o app guarda essa inscrição no banco e o servidor manda os avisos para ela.
 * No iPhone, os avisos só funcionam com o app instalado na tela de início (iOS 16.4+).
 */
export type EstadoAvisos = 'sem-suporte' | 'iphone-instalar' | 'bloqueado' | 'desligado' | 'ligado';

export const ehIphone = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function suportaAvisos(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registrarSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return null;
  try { return await navigator.serviceWorker.register('sw.js', { scope: './' }); } catch { return null; }
}

async function registro() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await registrarSW());
}

export async function inscricaoAtual(): Promise<PushSubscription | null> {
  if (!suportaAvisos()) return null;
  const r = await registro();
  return r ? r.pushManager.getSubscription() : null;
}

export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (!suportaAvisos()) return ehIphone() && !instalado() ? 'iphone-instalar' : 'sem-suporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  return (await inscricaoAtual()) ? 'ligado' : 'desligado';
}

const b64 = (s: string) => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
const paraB64url = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '');

/** Chave pública VAPID, entregue pela função de borda "avisos". */
export async function chavePublica(): Promise<string> {
  const base = window.__FABRICA__?.supabaseUrl?.trim();
  if (!base) throw new Error('Os avisos funcionam só na versão conectada ao servidor.');
  const r = await fetch(`${base}/functions/v1/avisos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'chave' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.chave) throw new Error(j.error ?? 'Avisos indisponíveis no momento.');
  return j.chave as string;
}

/** Pede permissão, inscreve o aparelho e devolve os dados para guardar no banco. */
export async function ligarAvisos(): Promise<{ endpoint: string; p256dh: string; auth: string }> {
  if (!suportaAvisos()) throw new Error('Este navegador não recebe avisos.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão negada. Libere as notificações deste site nas configurações do navegador.');
  const r = await registro();
  if (!r) throw new Error('Não foi possível preparar o aparelho.');
  const chave = await chavePublica();
  let sub = await r.pushManager.getSubscription();
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(chave) });
  return { endpoint: sub.endpoint, p256dh: paraB64url(sub.getKey('p256dh')), auth: paraB64url(sub.getKey('auth')) };
}

export async function desligarAvisos(): Promise<string | null> {
  const sub = await inscricaoAtual();
  if (!sub) return null;
  const ep = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  return ep;
}

// ---------------------------------------------------------------- instalação (Android/Chrome/Edge)
interface PromptInstalar extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let adiado: PromptInstalar | null = null;
const ouvintes = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); adiado = e as PromptInstalar; ouvintes.forEach(f => f()); });
  window.addEventListener('appinstalled', () => { adiado = null; ouvintes.forEach(f => f()); });
}
export const podeInstalar = () => adiado !== null;
export const aoMudarInstalacao = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
export async function instalar(): Promise<boolean> {
  if (!adiado) return false;
  await adiado.prompt();
  const { outcome } = await adiado.userChoice;
  adiado = null;
  ouvintes.forEach(f => f());
  return outcome === 'accepted';
}
