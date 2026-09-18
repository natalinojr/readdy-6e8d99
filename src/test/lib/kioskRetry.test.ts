import { describe, it, expect } from 'vitest';
import { kioskRetryDelayMs, KIOSK_RETRY_MAX_MS } from '@/lib/kioskRetry';

describe('kioskRetryDelayMs', () => {
  it('dobra a cada tentativa a partir de 30s', () => {
    expect(kioskRetryDelayMs(0)).toBe(30_000);
    expect(kioskRetryDelayMs(1)).toBe(60_000);
    expect(kioskRetryDelayMs(2)).toBe(120_000);
    expect(kioskRetryDelayMs(3)).toBe(240_000);
  });

  it('para em 5 minutos e continua tentando', () => {
    expect(kioskRetryDelayMs(4)).toBe(KIOSK_RETRY_MAX_MS);
    expect(kioskRetryDelayMs(50)).toBe(KIOSK_RETRY_MAX_MS);
    expect(kioskRetryDelayMs(1e9)).toBe(KIOSK_RETRY_MAX_MS);
  });

  it('entrada inválida volta ao início', () => {
    expect(kioskRetryDelayMs(-3)).toBe(30_000);
    expect(kioskRetryDelayMs(Number.NaN)).toBe(30_000);
  });
});
