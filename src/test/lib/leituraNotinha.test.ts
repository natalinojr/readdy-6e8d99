import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { linhasParaValor, isNfcePrQr, type ScanResult, type ScanItem } from '@/lib/leituraNotinha';

const item = (o: Partial<ScanItem>): ScanItem => ({
  raw_description: 'ITEM', quantity: 1, unit_label: 'un', unit_price: 0, line_total: 0, line_discount: 0,
  catalog_id: null, ingredient_id: null, merchandise_category_id: null, dre_category_id: null,
  pack_count: null, pack_size: null, confidence: 'alta', match_source: null, ...o,
});
const nota = (items: ScanItem[], total: number | null): ScanResult => ({
  readable: true, supplier_name: 'Mercado', supplier_key: 'k', invoice_number: '10', purchase_date: null,
  payment_method: null, document_total: total, discount_total: null, items_sum: 0, items, warnings: [],
});

describe('linhasParaValor', () => {
  it('usa preço × quantidade − desconto da linha', () => {
    const [l] = linhasParaValor(nota([item({ quantity: 2, unit_price: 10, line_discount: 1, line_total: 19 })], 19), 19);
    expect(l.total).toBe(19);
    expect(l.qtd).toBe(2);
  });

  it('insumo só vem do vínculo memorizado, nunca da sugestão da IA', () => {
    const ls = linhasParaValor(nota([
      item({ raw_description: 'A', line_total: 5, ingredient_id: 'ing-a', match_source: 'memoria' }),
      item({ raw_description: 'B', line_total: 5, ingredient_id: 'ing-b', match_source: 'ia' }),
    ], 10), 10);
    expect(ls.map((l) => l.insumoId)).toEqual(['ing-a', null]);
  });

  it('desconto no total da nota é rateado quando o total da nota bate com o pago', () => {
    const ls = linhasParaValor(nota([
      item({ line_total: 60, unit_price: 60 }), item({ line_total: 40, unit_price: 40 }),
    ], 90), 90);
    expect(ls.map((l) => l.total)).toEqual([54, 36]);
    expect(ls.reduce((s, l) => s + l.total, 0)).toBeCloseTo(90);
  });

  it('última linha absorve o centavo do rateio', () => {
    const ls = linhasParaValor(nota([item({ line_total: 10, unit_price: 10 }), item({ line_total: 10, unit_price: 10 }), item({ line_total: 10, unit_price: 10 })], 20), 20);
    expect(Math.round(ls.reduce((s, l) => s + l.total, 0) * 100) / 100).toBe(20);
  });

  it('nota de valor diferente do pago não é mexida (a pessoa decide)', () => {
    const ls = linhasParaValor(nota([item({ line_total: 60, unit_price: 60 })], 60), 50);
    expect(ls[0].total).toBe(60);
  });
});

describe('isNfcePrQr', () => {
  it('aceita o link da SEFAZ-PR com e sem barra', () => {
    const p = '4'.repeat(44);
    expect(isNfcePrQr(`http://www.fazenda.pr.gov.br/nfce/qrcode?p=${p}|2|1|1|abc`)).toBe(true);
    expect(isNfcePrQr(`https://www.fazenda.pr.gov.br/nfce/qrcode/?p=${p}`)).toBe(true);
    expect(isNfcePrQr('https://www.sefaz.sp.gov.br/nfce/qrcode?p=1')).toBe(false);
  });
});
