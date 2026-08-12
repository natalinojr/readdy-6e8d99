/* eslint-disable no-restricted-globals */
/**
 * Service worker do ERPOS — deliberadamente CONSERVADOR.
 *
 * Contexto que ditou o desenho (ver main.tsx): cada push no `main` dispara um
 * deploy no Vercel e troca os arquivos de cada tela (code-split por rota). O app
 * já se defende de chunk obsoleto via `vite:preloadError` + reload guardado.
 * Um SW que servisse HTML do cache atrapalharia essa defesa — o operador ficaria
 * presa numa versão velha. Por isso:
 *
 *   - Navegação (HTML): SEMPRE rede primeiro. Cache só como salva-vidas offline.
 *   - /assets/* : cache-first, e SÓ ele. São arquivos com hash no nome, logo
 *     imutáveis — servir do cache nunca devolve conteúdo errado.
 *   - Resto (Supabase, APIs, outras origens): passa direto, sem tocar.
 *
 * O cache de assets NÃO é versionado de propósito: nomes com hash já são únicos,
 * e apagá-lo a cada deploy faria a aba aberta re-baixar tudo no meio do uso.
 */

const SHELL_CACHE = 'erpos-shell-v1';
const ASSET_CACHE = 'erpos-assets';
const OFFLINE_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Salva-vidas para abrir offline. Se falhar, a instalação continua.
      try {
        await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      } catch (_) {
        /* sem rede na instalação — segue sem o fallback */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove só shells de versões antigas; o cache de assets é preservado.
      const nomes = await caches.keys();
      await Promise.all(
        nomes
          .filter((n) => n.startsWith('erpos-shell-') && n !== SHELL_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Só mexemos na própria origem: Supabase (REST, Storage, realtime) passa direto.
  if (url.origin !== self.location.origin) return;

  // ── Navegação: rede primeiro, cache só se estiver offline ──
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresca = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(OFFLINE_URL, fresca.clone());
          return fresca;
        } catch (_) {
          const cache = await caches.open(SHELL_CACHE);
          const salva = await cache.match(OFFLINE_URL);
          if (salva) return salva;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Sem conexão</title>' +
              '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
              '<h1 style="font-size:1.1rem">Sem conexão</h1>' +
              '<p style="color:#64748b;font-size:.9rem">Verifique a internet e tente de novo.</p></body>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
          );
        }
      })(),
    );
    return;
  }

  // ── Assets com hash no nome: cache-first (imutáveis) ──
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const salvo = await cache.match(req);
        if (salvo) return salvo;
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      })(),
    );
  }

  // Demais requisições da própria origem seguem o caminho normal do navegador.
});

// Permite que a página peça a troca imediata de versão.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ── Web Push ─────────────────────────────────────────────────────────────
   O payload chega cifrado e é decifrado pelo navegador; aqui só montamos a
   notificação. `data.url` leva direto à tarefa que originou o aviso. */

self.addEventListener('push', (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch (_) {
    dados = { corpo: event.data ? event.data.text() : '' };
  }

  const titulo = dados.titulo || 'ERPOS';
  const opcoes = {
    body: dados.corpo || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Agrupa por tarefa: avisos da mesma tarefa substituem o anterior em vez
    // de empilhar várias notificações iguais.
    tag: dados.task_id ? `tarefa-${dados.task_id}` : 'erpos',
    renotify: true,
    data: { url: dados.url || '/tarefas' },
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(titulo, opcoes);
    // Marca o ícone do app. Sem número: o service worker não sabe o total
    // do usuário — a contagem exata é acertada quando o app abre.
    try { await self.navigator?.setAppBadge?.(); } catch (_) { /* sem suporte */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/tarefas';

  event.waitUntil(
    (async () => {
      const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reaproveita uma aba já aberta do app em vez de abrir outra
      for (const aba of abas) {
        if (new URL(aba.url).origin === self.location.origin) {
          await aba.focus();
          if ('navigate' in aba) {
            try { await aba.navigate(destino); } catch (_) { /* navegação bloqueada — só foca */ }
          }
          return;
        }
      }
      await self.clients.openWindow(destino);
    })(),
  );
});
