import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { pixEtiqueta, maquininhaDaVenda, linhasDetalhe, somarDetalhe, juntarDetalhe, applyRevenueSources } from '@/lib/revenueSources';

describe('detalhe da receita (Pix por etiqueta, cartão por maquininha)', () => {
  it('rotula o Pix pela etiqueta da Conciliação', () => {
    expect(pixEtiqueta({ category: 'Repasse Tuna Pagamentos', match_kind: null })).toBe('Tuna Pagamentos');
    expect(pixEtiqueta({ category: 'Repasse voucher (VR, Alelo, Ticket…)', match_kind: null })).toBe('Vouchers (VR, Alelo, Ticket…)');
    expect(pixEtiqueta({ category: null, match_kind: 'internal_transfer' })).toBe('Pix da maquininha (transferido)');
    expect(pixEtiqueta({ category: null, match_kind: null })).toBe('Pix sem etiqueta');
    expect(pixEtiqueta({ category: 'Outras receitas', match_kind: null })).toBe('Outras receitas');
  });

  it('acha a maquininha pelo texto que cada conector grava', () => {
    expect(maquininhaDaVenda('Vendas em cartão liquidadas pela Stone em 01/09 (18 parcela(s), valor bruto)')).toBe('Stone');
    expect(maquininhaDaVenda('Stone: créditos diversos de 02/09')).toBe('Stone');
    expect(maquininhaDaVenda('Vendas no cartão liberadas pelo Mercado Pago em 11/09 (1 venda(s), valor bruto)')).toBe('Mercado Pago');
    expect(maquininhaDaVenda(null)).toBe('Outra maquininha');
  });

  it('sublinhas só com 2+ itens, maior primeiro; soma bate com o total', () => {
    const rows = [{ c: 'A', v: 10 }, { c: 'B', v: 30 }, { c: 'A', v: 5 }];
    const d = somarDetalhe(rows, r => r.c, r => r.v);
    expect(d).toEqual({ A: 15, B: 30 });
    expect(linhasDetalhe(d)).toEqual(['B', 'A']);
    expect(linhasDetalhe({ A: 15 })).toEqual([]);
    expect(linhasDetalhe({ A: 15 }, { B: 1 })).toEqual(['A', 'B']);
    expect(juntarDetalhe({ Stone: 1 }, { Stone: 2, 'Mercado Pago': 3 })).toEqual({ Stone: 3, 'Mercado Pago': 3 });
  });

  it('fonte desligada zera também o detalhe', () => {
    const base = { receitaBalcao: 0, receitaDelivery: 0, receitaMesa: 0, receitaAutoatendimento: 0, receitaStone: 50, cartaoPorMaquininha: { Stone: 50 } as Record<string, number>, pixPorEtiqueta: {} as Record<string, number> };
    const off = applyRevenueSources(base, ['pix'], 20, 0, 0, { 'Tuna Pagamentos': 20 });
    expect(off.cartaoPorMaquininha).toEqual({});
    expect(off.pixPorEtiqueta).toEqual({ 'Tuna Pagamentos': 20 });
    const on = applyRevenueSources(base, ['stone'], 20, 0, 0, { 'Tuna Pagamentos': 20 });
    expect(on.cartaoPorMaquininha).toEqual({ Stone: 50 });
    expect(on.pixPorEtiqueta).toEqual({});
  });
});
