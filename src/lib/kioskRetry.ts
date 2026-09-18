/**
 * Espera antes da próxima tentativa de renovar a sessão do totem.
 * 30s, 60s, 120s, 240s e depois 5 min fixos — tenta para sempre (o totem fica
 * ligado o dia todo e a internet da loja cai e volta).
 */
export const KIOSK_RETRY_BASE_MS = 30_000;
export const KIOSK_RETRY_MAX_MS = 5 * 60_000;

export function kioskRetryDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  // 2^n cresce rápido; limita o expoente para não estourar antes do teto
  const delay = KIOSK_RETRY_BASE_MS * 2 ** Math.min(n, 10);
  return Math.min(delay, KIOSK_RETRY_MAX_MS);
}
