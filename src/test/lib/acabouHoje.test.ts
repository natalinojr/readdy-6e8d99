import { describe, it, expect } from 'vitest';
import { comboIndisponivel, horaBrasilia, idsQueTravamCombo, itensAcabaramNoCarrinho, textoAvisoAcabou } from '@/lib/acabouHoje';
import { combosIndisponiveis } from '../../../supabase/functions/_shared/cardapio-pausa';
import type { Combo } from '@/types/cardapio';

const AGORA = new Date('2026-10-06T23:00:00Z'); // 20:00 Brasília
const AMANHA_5H = '2026-10-07T08:00:00.000Z';
const ONTEM_5H = '2026-10-06T08:00:00.000Z';

const combo = (ids: Array<string | null>): Pick<Combo, 'itens'> => ({ itens: ids.map((itemId) => ({ itemId, nome: itemId ?? 'livre', quantidade: 1 })) });

describe('combo com item pausado ou desligado', () => {
  const itens = [
    { id: 'a', status: 'ativo' as const },
    { id: 'b', status: 'inativo' as const },
    { id: 'c', status: 'ativo' as const },
  ];
  const travam = idsQueTravamCombo(itens, new Set(['c']));
  const existentes = new Set(itens.map((i) => i.id));

  it('trava = pausados + desligados', () => {
    expect([...travam].sort()).toEqual(['b', 'c']);
  });
  it('combo só com itens vendendo fica disponível', () => {
    expect(comboIndisponivel(combo(['a']), travam, existentes)).toBe(false);
  });
  it('item pausado trava o combo', () => {
    expect(comboIndisponivel(combo(['a', 'c']), travam, existentes)).toBe(true);
  });
  it('item desligado trava o combo', () => {
    expect(comboIndisponivel(combo(['b']), travam, existentes)).toBe(true);
  });
  it('item apagado (não veio no cardápio) trava; cardápio vazio (carregando) não', () => {
    expect(comboIndisponivel(combo(['x']), travam, existentes)).toBe(true);
    expect(comboIndisponivel(combo(['x']), new Set(), new Set())).toBe(false);
  });
  it('linha sem item ligado não trava', () => {
    expect(comboIndisponivel(combo([null, 'a']), travam, existentes)).toBe(false);
  });
  it('volta sozinho: sem pausa, o combo volta', () => {
    expect(comboIndisponivel(combo(['a', 'c']), idsQueTravamCombo(itens, new Set()), existentes)).toBe(false);
  });
});

describe('itens que acabaram no carrinho', () => {
  const situacao = new Map([
    ['p1', { pausadoAte: AMANHA_5H, marcadoEm: '2026-10-06T22:40:00Z', nome: 'Chope Pilsen' }],
    ['p2', { pausadoAte: AMANHA_5H, marcadoEm: null, nome: 'Nachos' }],
    ['v1', { pausadoAte: ONTEM_5H, nome: 'Taco' }],
    ['v2', { pausadoAte: null, nome: 'Burrito' }],
  ]);

  it('só os pausados agora, um por item, na ordem do carrinho', () => {
    const r = itensAcabaramNoCarrinho([
      { itemId: 'v1', nome: 'Taco' }, { itemId: 'p2', nome: 'Nachos' }, { itemId: 'p1', nome: 'Chope' },
      { itemId: 'p2', nome: 'Nachos (Un. 2)' }, { itemId: 'v2', nome: 'Burrito' }, { itemId: null, nome: 'Avulso' },
    ], situacao, AGORA);
    expect(r.map((i) => i.itemId)).toEqual(['p2', 'p1']);
    expect(r[1].nome).toBe('Chope Pilsen');
  });
  it('pausa vencida (passou das 05:00) não avisa', () => {
    expect(itensAcabaramNoCarrinho([{ itemId: 'v1', nome: 'Taco' }], situacao, AGORA)).toEqual([]);
  });
  it('item sem situação conhecida não avisa', () => {
    expect(itensAcabaramNoCarrinho([{ itemId: 'zz', nome: '?' }], situacao, AGORA)).toEqual([]);
  });
});

describe('texto do aviso', () => {
  it('hora de Brasília', () => {
    expect(horaBrasilia('2026-10-06T22:40:00Z')).toBe('19:40');
    expect(horaBrasilia(null)).toBe('');
  });
  it('um item: frase inteira no título', () => {
    const t = textoAvisoAcabou([{ itemId: 'p1', nome: 'Chope Pilsen', marcadoEm: '2026-10-06T22:40:00Z' }]);
    expect(t.titulo).toBe('Chope Pilsen acabou hoje (marcado às 19:40). Tirar do pedido?');
  });
  it('vários itens: um aviso só com a lista', () => {
    const t = textoAvisoAcabou([
      { itemId: 'p1', nome: 'Chope Pilsen', marcadoEm: '2026-10-06T22:40:00Z' },
      { itemId: 'p2', nome: 'Nachos', marcadoEm: null },
    ]);
    expect(t.titulo).toBe('2 itens acabaram hoje. Tirar do pedido?');
    expect(t.mensagem).toContain('• Chope Pilsen acabou hoje (marcado às 19:40)');
    expect(t.mensagem).toContain('• Nachos acabou hoje\n');
  });
});

// Fake mínimo do supabase-js (select/eq/in/is/not + await).
function fakeAdmin(tabelas: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(t: string) {
      let rows = [...(tabelas[t] ?? [])];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q; },
        in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q; },
        is: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] ?? null) === v); return q; },
        not: (c: string, _op: string, v: unknown) => { rows = rows.filter((r) => (r[c] ?? null) !== v); return q; },
        then: (res: (x: { data: unknown; error: null }) => unknown) => Promise.resolve(res({ data: rows, error: null })),
      };
      return q;
    },
  };
}

describe('servidor: combosIndisponiveis', () => {
  const T = 't1';
  const futuro = new Date(Date.now() + 3_600_000).toISOString();
  const admin = fakeAdmin({
    combo_items: [
      { tenant_id: T, combo_id: 'ok', item_id: 'a' },
      { tenant_id: T, combo_id: 'ok', item_id: null },
      { tenant_id: T, combo_id: 'pausa', item_id: 'p' },
      { tenant_id: T, combo_id: 'off', item_id: 'b' },
      { tenant_id: T, combo_id: 'apagado', item_id: 'd' },
      { tenant_id: T, combo_id: 'catapagada', item_id: 'e' },
      { tenant_id: T, combo_id: 'linhaapagada', item_id: 'p', deleted_at: '2026-01-01' },
    ],
    menu_items: [
      { tenant_id: T, id: 'a', is_active: true, category_id: 'c1' },
      { tenant_id: T, id: 'p', is_active: true, pausado_ate: futuro, category_id: 'c1' },
      { tenant_id: T, id: 'b', is_active: false, category_id: 'c1' },
      { tenant_id: T, id: 'd', is_active: true, deleted_at: '2026-01-01', category_id: 'c1' },
      { tenant_id: T, id: 'e', is_active: true, category_id: 'c2' },
    ],
    menu_categories: [
      { tenant_id: T, id: 'c1' },
      { tenant_id: T, id: 'c2', deleted_at: '2026-01-01' },
    ],
  });

  it('trava combo com item pausado, desligado, apagado ou de categoria apagada', async () => {
    const r = await combosIndisponiveis(admin, T, ['ok', 'pausa', 'off', 'apagado', 'catapagada', 'linhaapagada']);
    expect([...r].sort()).toEqual(['apagado', 'catapagada', 'off', 'pausa']);
  });
  it('sem combos não consulta nada', async () => {
    expect((await combosIndisponiveis(admin, T, [])).size).toBe(0);
  });
});
