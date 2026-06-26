// Helper do Pixel da Meta (Facebook/Instagram).
//
// O código base do Pixel é carregado no <head> (index.html) e expõe `window.fbq`.
// Aqui mandamos os eventos de CONVERSÃO do delivery (carrinho, pedido finalizado)
// pra Meta otimizar os anúncios por PEDIDO REAL, não só por visita.
//
// É à prova de falha: se o Pixel não tiver carregado (bloqueador de anúncio,
// ambiente sem rede, etc.), simplesmente não faz nada — nunca quebra o fluxo.

type PixelParams = Record<string, unknown>;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** Dispara um evento padrão do Pixel da Meta (ex.: 'Purchase', 'InitiateCheckout'). */
export function trackPixel(event: string, params?: PixelParams): void {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      window.fbq('track', event, params);
    }
  } catch {
    // silencioso de propósito — rastreio nunca pode atrapalhar o pedido
  }
}
