/* eslint-disable no-restricted-globals */
/**
 * Service worker do APP DO CLUBE (um por loja: registrado com escopo /clube/<loja>).
 *
 * Separado do sw.js do ERPOS de propósito: com escopo próprio, a notificação sai com
 * o nome e o ícone do app da loja (não do ERPOS) e as inscrições de cliente não se
 * misturam com as de funcionário. Não guarda nada em cache: a página sempre vem da
 * rede (cada deploy troca os arquivos), só com um aviso simples se estiver sem internet.
 */

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).catch(() => new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Sem conexão</title><body style="font-family:system-ui;padding:2rem;text-align:center">' +
        '<h1 style="font-size:1.1rem">Sem conexão</h1>' +
        '<p style="color:#64748b;font-size:.9rem">Verifique a internet e abra de novo.</p></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
    )),
  );
});

// Payload (clube-app): { titulo, corpo, url, tag, icone }
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { corpo: event.data ? event.data.text() : '' }; }
  const opcoes = {
    body: d.corpo || '',
    icon: d.icone || undefined,
    badge: d.icone || undefined,
    tag: d.tag || 'clube',
    renotify: true,
    data: { url: d.url || self.registration.scope },
  };
  event.waitUntil(self.registration.showNotification(d.titulo || 'Clube', opcoes));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Só abre páginas deste app (o servidor só manda caminhos /clube/<loja>…).
  let destino = self.registration.scope;
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || '', self.registration.scope);
    const escopo = new URL(self.registration.scope).pathname;
    const dentro = u.pathname === escopo || u.pathname.startsWith(escopo + '/');
    if (u.origin === self.location.origin && dentro) destino = u.href;
  } catch (_) { /* fica no início do app */ }
  event.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const aba of abas) {
      const p = new URL(aba.url).pathname;
      const escopo = new URL(self.registration.scope).pathname;
      if (p === escopo || p.startsWith(escopo + '/')) {
        await aba.focus();
        try { await aba.navigate(destino); } catch (_) { /* só foca */ }
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
