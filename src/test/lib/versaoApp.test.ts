/**
 * Recarga automática do totem (src/lib/versaoApp.ts › recarregarAppSozinho): no máximo 1 a cada
 * 10 min. Segurar depois de 5 min (duas publicações seguidas) é o normal e não vai mais para
 * dev_error_events; segurar em menos de 2 min é sinal de loop e continua registrado (2026-10-05).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const reportErrorMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/errorReporter', () => ({ reportError: reportErrorMock }));

import { recarregarAppSozinho } from '../../lib/versaoApp';

const CHAVE = 'erpos-recarga-auto-em';
const reload = vi.fn();
const locationOriginal = window.location;

describe('recarregarAppSozinho', () => {
  beforeEach(() => {
    reportErrorMock.mockReset();
    reload.mockReset();
    localStorage.clear();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...locationOriginal, reload } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: locationOriginal });
  });

  it('sem recarga recente recarrega e guarda a hora', () => {
    expect(recarregarAppSozinho()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Number(localStorage.getItem(CHAVE))).toBeGreaterThan(0);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('segunda publicação 5 min depois: segura em silêncio (não é loop)', () => {
    localStorage.setItem(CHAVE, String(Date.now() - 310 * 1000));
    expect(recarregarAppSozinho()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('pedido de recarga segundos depois da anterior: segura e registra (cara de loop)', () => {
    localStorage.setItem(CHAVE, String(Date.now() - 20 * 1000));
    expect(recarregarAppSozinho()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0][1]).toMatchObject({ fn: 'versaoApp.recarregarAppSozinho', severity: 'warning' });
  });

  it('passados 10 min recarrega de novo', () => {
    localStorage.setItem(CHAVE, String(Date.now() - 11 * 60 * 1000));
    expect(recarregarAppSozinho()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
