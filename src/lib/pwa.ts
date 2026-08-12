/**
 * Registro do service worker (ver `public/sw.js` para o desenho do cache).
 *
 * Só roda em produção: em dev o Vite serve módulos sem hash e um SW no meio
 * do caminho atrapalha o hot reload.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Deploy novo enquanto a aba está aberta: ativa a versão nova assim que
        // ela terminar de instalar. O SW não serve HTML do cache, então isso
        // não prende ninguém numa versão velha.
        reg.addEventListener('updatefound', () => {
          const novo = reg.installing;
          if (!novo) return;
          novo.addEventListener('statechange', () => {
            if (novo.state === 'installed' && navigator.serviceWorker.controller) {
              novo.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[PWA] Falha ao registrar o service worker:', err);
      });
  });
}

/** true quando o app está rodando instalado (fora do navegador). */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS usa uma propriedade própria, fora do padrão
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * Selo numérico no ícone do app instalado (Badging API).
 *
 * Deixa o funcionário ver que há pendências sem abrir o app. Suportado no
 * Android/Chrome e no Windows; onde não existe, é silenciosamente ignorado.
 */
export function atualizarBadge(contagem: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (contagem > 0) void nav.setAppBadge?.(contagem);
    else void nav.clearAppBadge?.();
  } catch {
    /* navegador sem suporte — sem problema */
  }
}
