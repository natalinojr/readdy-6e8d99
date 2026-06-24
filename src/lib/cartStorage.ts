/**
 * Persistência do carrinho do cliente (delivery / mesa-qr) em localStorage.
 *
 * Motivo: o pull-to-refresh recarrega a página (re-busca cardápio/preços/status),
 * e sem isto o carrinho em memória se perderia. A chave é por loja/sessão para
 * não misturar carrinhos de contextos diferentes no mesmo aparelho.
 */

const PREFIX = 'erpos_cart_';

export function loadCart<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function saveCart(key: string, cart: unknown[]): void {
  try {
    if (!cart || cart.length === 0) {
      localStorage.removeItem(PREFIX + key);
    } else {
      localStorage.setItem(PREFIX + key, JSON.stringify(cart));
    }
  } catch {
    /* armazenamento indisponível (modo privado etc.) — ignora */
  }
}
