// Telefone do cliente no delivery público: máscara de exibição e chave do auto-login
// no aparelho (por loja — antes era uma chave global `delivery_phone`).

export const LEGACY_DELIVERY_PHONE_KEY = 'delivery_phone';

/** (41) 99999-9999 — aceita valor já mascarado ou só dígitos. */
export function formatPhoneBR(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2);
  if (digits.length === 10) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 6) + '-' + digits.slice(6);
  return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7);
}

export function deliveryPhoneKey(tenantId: string): string {
  return 'delivery_phone_' + tenantId;
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Lê o telefone salvo da loja; cai na chave antiga (global) e migra para a da loja. */
export function readSavedDeliveryPhone(storage: KV, tenantId: string): string | null {
  try {
    const own = storage.getItem(deliveryPhoneKey(tenantId));
    if (own) return own;
    const legacy = storage.getItem(LEGACY_DELIVERY_PHONE_KEY);
    if (legacy) {
      try { storage.setItem(deliveryPhoneKey(tenantId), legacy); } catch { /* ignora */ }
      return legacy;
    }
  } catch { /* storage indisponível */ }
  return null;
}

export function saveDeliveryPhone(storage: KV, tenantId: string, phone: string): void {
  try { storage.setItem(deliveryPhoneKey(tenantId), phone); } catch { /* ignora */ }
}

/** Sair/trocar de número: apaga a da loja e a antiga (senão o fallback reloga). */
export function clearSavedDeliveryPhone(storage: KV, tenantId: string | null | undefined): void {
  try {
    if (tenantId) storage.removeItem(deliveryPhoneKey(tenantId));
    storage.removeItem(LEGACY_DELIVERY_PHONE_KEY);
  } catch { /* ignora */ }
}
