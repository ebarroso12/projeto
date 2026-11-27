/*
 * Service worker do Fábrica
 *  - Funciona como app instalado (tela cheia, ícone na tela inicial).
 *  - Abre mesmo sem internet: a última versão do app fica guardada (as telas mostram aviso quando o servidor não responde).
 *  - Recebe os avisos (push) com o app fechado e abre a tela certa ao tocar.
 * Estratégia de cache:
 *  - páginas: rede primeiro (sempre a versão mais nova), cópia guardada só sem internet;
 *  - /assets/* (nomes com hash, nunca mudam): guardados na primeira vez;
 *  - config.js: rede primeiro; version.json e servidores externos: nunca guardados.
 *  - /manual/: rede primeiro, com cópia para ler sem internet (separado do app).
 */
const CACHE = 'fabrica-v2';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './marca/icone-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // Supabase, fontes externas: direto na rede
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) return;

  // manual (/manual/): página própria — rede primeiro, cópia guardada para ler sem internet; nunca vira o index do app
  if (url.pathname.includes('/manual/') || url.pathname.endsWith('/manual')) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })
      .catch(() => caches.match(req)));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put('./index.html', c)); return r; })
      .catch(() => caches.match('./index.html').then(r => r || caches.match('./'))));
    return;
  }
  if (url.pathname.includes('/assets/') || url.pathname.includes('/marca/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
      return r;
    })));
    return;
  }
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return r;
  }).catch(() => caches.match(req)));
});

// ---------------------------------------------------------------- avisos
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { texto: e.data ? e.data.text() : '' }; }
  const titulo = d.titulo || 'Fábrica';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.texto || '', icon: 'marca/icone-192.png', badge: 'marca/icone-192.png', tag: d.tag || undefined,
    renotify: !!d.tag, requireInteraction: d.tipo === 'acesso', data: { url: d.url || '#/' }, lang: 'pt-BR',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || '#/', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    for (const c of lista) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate(destino).catch(() => undefined); return c.focus(); }
    }
    return self.clients.openWindow(destino);
  }));
});
