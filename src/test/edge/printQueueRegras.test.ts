// @vitest-environment node
// print-queue-agent/regras.ts: texto -> CP860 sem bytes de controle, backoff de retentativa
// e fallback de impressora para estação sem mapeamento (go-live Paranaguá, 17/09/2026).
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import por caminho montado em tempo de execução: o tsc do app não passa a checar código Deno.
const REGRAS_PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/print-queue-agent/regras.ts')).href;

type Mod = {
  utf8ToCp860Bytes: (s: string) => Uint8Array;
  retryEligibleFilter: (nowMs: number) => string;
  retryGiveUp: (next: number, createdAt: string | null | undefined, nowMs: number) => boolean;
  fallbackPrinterId: (
    stationKey: string,
    mapa: Record<string, string>,
    lista: Array<Record<string, unknown>>,
    byId: Record<string, { ip?: string }>,
  ) => string;
};
const load = () => import(/* @vite-ignore */ REGRAS_PATH) as Promise<Mod>;
const txt = (b: Uint8Array) => String.fromCharCode(...Array.from(b));

describe('utf8ToCp860Bytes', () => {
  it('troca pontuação tipográfica por ASCII', async () => {
    const m = await load();
    expect(txt(m.utf8ToCp860Bytes('A — B – C ‘x’ “y” fim… • item z'))).toBe('A - B - C \'x\' "y" fim... * item z');
  });

  it('mantém acentos da CP860 e nunca gera byte de controle (exceto LF)', async () => {
    const m = await load();
    const b = m.utf8ToCp860Bytes('Ação ç É\nemoji 🍔 naïve  —“…');
    expect(b[0]).toBe(0x41); // A
    expect(b[1]).toBe(0x87); // ç
    expect(b[2]).toBe(0x84); // ã
    for (const byte of b) {
      expect(byte === 0x0a || (byte >= 0x20 && byte !== 0x7f)).toBe(true);
    }
    expect(txt(m.utf8ToCp860Bytes('🍔 naïve'))).toBe('? naive');
  });
});

describe('backoff de retentativa', () => {
  const now = Date.parse('2026-09-17T15:00:00Z');
  const created = (min: number) => new Date(now - min * 60_000).toISOString();

  it('não desiste antes de 15 min, mesmo com muitas falhas', async () => {
    const m = await load();
    expect(m.retryGiveUp(5, created(1), now)).toBe(false);
    expect(m.retryGiveUp(20, created(14), now)).toBe(false);
  });

  it('desiste com 15 min de vida e pelo menos 5 tentativas', async () => {
    const m = await load();
    expect(m.retryGiveUp(5, created(15), now)).toBe(true);
    // ticket que ficou parado com agente desligado ainda ganha 5 tentativas
    expect(m.retryGiveUp(2, created(120), now)).toBe(false);
  });

  it('filtro do poll aplica atraso crescente por retry_count', async () => {
    const m = await load();
    const f = m.retryEligibleFilter(now);
    expect(f).toContain('retry_count.eq.0');
    expect(f).toContain('and(retry_count.eq.1,updated_at.lte."2026-09-17T14:59:55.000Z")');
    expect(f).toContain('and(retry_count.eq.3,updated_at.lte."2026-09-17T14:59:30.000Z")');
    expect(f).toContain('and(retry_count.gte.4,updated_at.lte."2026-09-17T14:59:00.000Z")');
  });
});

describe('fallbackPrinterId', () => {
  const lista = [{ id: 'cozinha' }, { id: 'caixa' }, { id: 'bar' }];
  const byId = { cozinha: { ip: '10.0.0.1' }, caixa: { ip: '10.0.0.2' }, bar: { ip: '10.0.0.3' } };
  const mapa = { 'caixa-pdv': 'caixa', '342718cc-5298-4b12-b19f-07a27f60682f': 'bar' };

  it('comprovante/danfe sem mapa vai para a impressora do caixa-pdv', async () => {
    const m = await load();
    expect(m.fallbackPrinterId('delivery-receipt', mapa, lista, byId)).toBe('caixa');
    expect(m.fallbackPrinterId('danfe', { pedidos: 'cozinha' }, lista, byId)).toBe('cozinha');
  });

  it('estação de cozinha sem mapa vai para a primeira impressora de estação', async () => {
    const m = await load();
    expect(m.fallbackPrinterId('aaaaaaaa-5298-4b12-b19f-07a27f60682f', mapa, lista, byId)).toBe('bar');
  });

  it('sem nenhuma pista: primeira impressora com IP; com 1 impressora: ela', async () => {
    const m = await load();
    expect(m.fallbackPrinterId('delivery-receipt', {}, lista, { ...byId, cozinha: {} })).toBe('caixa');
    expect(m.fallbackPrinterId('x', {}, [{ id: 'unica' }], { unica: {} })).toBe('unica');
    expect(m.fallbackPrinterId('x', {}, [], {})).toBe('');
  });
});
