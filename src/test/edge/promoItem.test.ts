// supabase/functions/_shared/promo-item.ts: preço promocional do Cardápio que vale HOJE (fuso de
// Brasília) — regra única do mesa-write e do delivery-write (2026-10-04: o delivery mostrava a
// promoção e cobrava o preço cheio). Deve dar o mesmo resultado de rawPromoAtivaHoje (tela).
import { describe, it, expect } from 'vitest';
import { hojeBrasilia, promoValeNoDia, promoPrecosDeHoje } from '../../../supabase/functions/_shared/promo-item';
import { rawPromoAtivaHoje, type RawPromotion } from '@/lib/promoUtils';

// Quinta-feira 08/10/2026, 20:00 em Brasília (23:00 UTC).
const QUINTA_20H = new Date('2026-10-08T23:00:00Z');
// Quinta-feira 08/10/2026, 22:30 em Brasília = sexta 01:30 UTC — o dia NÃO pode virar.
const QUINTA_22H30 = new Date('2026-10-09T01:30:00Z');

const promo = (p: Partial<RawPromotion>): RawPromotion => ({
  id: 'p', item_id: 'burrito', promotional_price: 30, days_of_week: [], is_recurring: true, specific_date: null, is_active: true, ...p,
});

describe('hojeBrasilia', () => {
  it('usa a data e o dia da semana de Brasília, não o UTC', () => {
    expect(hojeBrasilia(QUINTA_20H)).toEqual({ hoje: '2026-10-08', diaSemana: 4 });
    expect(hojeBrasilia(QUINTA_22H30)).toEqual({ hoje: '2026-10-08', diaSemana: 4 });
  });
});

describe('promoValeNoDia', () => {
  it('semanal: vale no dia marcado, não nos outros', () => {
    expect(promoValeNoDia(promo({ days_of_week: [4] }), '2026-10-08', 4)).toBe(true);
    expect(promoValeNoDia(promo({ days_of_week: [4] }), '2026-10-09', 5)).toBe(false);
  });
  it('semanal sem dias = todos os dias', () => {
    expect(promoValeNoDia(promo({ days_of_week: [] }), '2026-10-09', 5)).toBe(true);
    expect(promoValeNoDia(promo({ days_of_week: null }), '2026-10-09', 5)).toBe(true);
  });
  it('pontual (data e não recorrente): só na data — data passada não vale', () => {
    expect(promoValeNoDia(promo({ is_recurring: false, specific_date: '2026-10-08' }), '2026-10-08', 4)).toBe(true);
    expect(promoValeNoDia(promo({ is_recurring: false, specific_date: '2026-07-05' }), '2026-10-08', 4)).toBe(false);
  });
  it('pontual com dias marcados ainda segue a data (caso real da Vila Leste)', () => {
    expect(promoValeNoDia(promo({ is_recurring: false, specific_date: '2026-06-30', days_of_week: [2] }), '2026-10-06', 2)).toBe(false);
  });
});

describe('promoPrecosDeHoje', () => {
  it('menor preço vence quando há mais de uma valendo', () => {
    const m = promoPrecosDeHoje([
      promo({ promotional_price: 30, days_of_week: [4] }),
      promo({ promotional_price: 27.5, days_of_week: [] }),
      promo({ item_id: 'outro', promotional_price: 10, days_of_week: [5] }),
    ], QUINTA_20H);
    expect(m.get('burrito')).toBe(27.5);
    expect(m.has('outro')).toBe(false);
  });
  it('aceita o numeric como texto', () => {
    expect(promoPrecosDeHoje([{ item_id: 'x', promotional_price: '21.90', days_of_week: [], is_recurring: true, specific_date: null }], QUINTA_20H).get('x')).toBe(21.9);
  });
  it('dá o mesmo preço que a tela (rawPromoAtivaHoje) — mesmo horário local de Brasília', () => {
    // A tela usa o relógio do aparelho; no teste o fuso do processo pode não ser Brasília, então
    // compara montando "agora" pela data/dia de Brasília (o que o aparelho do cliente vê).
    const casos: RawPromotion[][] = [
      [promo({ days_of_week: [4] })],
      [promo({ days_of_week: [5] })],
      [promo({ is_recurring: false, specific_date: '2026-10-08' })],
      [promo({ is_recurring: false, specific_date: '2026-07-05' })],
      [promo({ promotional_price: 30, days_of_week: [4] }), promo({ id: 'q', promotional_price: 25, days_of_week: [] })],
    ];
    const { hoje } = hojeBrasilia(QUINTA_20H);
    const [y, mo, d] = hoje.split('-').map(Number);
    const agoraLocal = new Date(y, mo - 1, d, 20, 0, 0);
    for (const lista of casos) {
      const tela = rawPromoAtivaHoje(lista, agoraLocal);
      const servidor = promoPrecosDeHoje(lista, QUINTA_20H).get('burrito');
      expect(servidor).toBe(tela ? tela.promotional_price : undefined);
    }
  });
});
