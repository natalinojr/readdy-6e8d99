import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { custoLinhaFicha } from '@/lib/unitConversion';
import { custoUnitDasOpcoes } from '@/lib/custoOpcoes';
import { normIfood, type CustoAlvo, type MapaCustos } from '@/lib/ifoodArea';

// Custo da comida de cada produto do iFood (área iFood, 2026-10-05). Uma ligação só para o usuário:
// 1) ligação ao cardápio (ifood_item_links → item, combo ou opção; a mesma que dá baixa no estoque):
//    custo pela ficha técnica ATUAL (custoLinhaFicha, mesma conversão g↔kg/ml↔L do resto do sistema);
// 2) sem ligação: o custo montado à mão no CMV antigo (fin_ifood_cmv_items/linhas, por nome).
// Item do cardápio sem ficha = custo desconhecido (null), nunca zero. Opção ligada sem insumo e
// "Não usa estoque" = custo zero (a pessoa disse que não tem custo de estoque).

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const num = (v: unknown) => Number(v ?? 0) || 0;

interface LinkRow { level: 'item' | 'complemento'; name: string; name_key: string; group_key: string; target_kind: string; menu_item_id: string | null; combo_id: string | null; option_id: string | null }
interface FichaRow { item_id: string; quantity: number; unit: string; unit_price: number; ingredient_unit: string | null }

/** Custo atual da ficha de cada item do cardápio (null = item sem ficha). */
export async function custoFichaItens(tenantId: string, itemIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const ids = [...new Set(itemIds.filter(Boolean))];
  for (const id of ids) out.set(id, null);
  for (const part of chunk(ids, 150)) {
    const { data, error } = await supabase.rpc('fn_get_item_ingredients_batch', { p_tenant_id: tenantId, p_item_ids: part });
    if (error) throw new Error(error.message);
    for (const r of ((data ?? []) as FichaRow[])) {
      out.set(r.item_id, (out.get(r.item_id) ?? 0) + custoLinhaFicha(num(r.quantity), r.unit, r.ingredient_unit, num(r.unit_price)));
    }
  }
  return out;
}

export async function fetchCustosIfood(tenantId: string): Promise<{ mapa: MapaCustos; erro: string | null }> {
  const mapa: MapaCustos = new Map();
  try {
    const links = await fetchAllRows<LinkRow>((f, t) => supabase.from('ifood_item_links')
      .select('level, name, name_key, group_key, target_kind, menu_item_id, combo_id, option_id')
      .eq('tenant_id', tenantId).order('id').range(f, t));
    if (links.error) throw new Error(links.error.message);

    const comboIds = [...new Set(links.rows.map((l) => l.combo_id).filter((x): x is string => !!x))];
    const optionIds = [...new Set(links.rows.map((l) => l.option_id).filter((x): x is string => !!x))];
    const combosItens: Array<{ combo_id: string; item_id: string; quantity: number }> = [];
    const combos = new Map<string, { name: string; price: number }>();
    for (const part of chunk(comboIds, 150)) {
      const [ci, cb] = await Promise.all([
        supabase.from('combo_items').select('combo_id, item_id, quantity').in('combo_id', part).is('deleted_at', null),
        supabase.from('combos').select('id, name, price').in('id', part),
      ]);
      combosItens.push(...((ci.data ?? []) as typeof combosItens));
      for (const c of (cb.data ?? []) as Array<{ id: string; name: string; price: number | null }>) combos.set(c.id, { name: c.name, price: num(c.price) });
    }
    const itemIds = [...new Set([...links.rows.map((l) => l.menu_item_id), ...combosItens.map((c) => c.item_id)].filter((x): x is string => !!x))];
    const itens = new Map<string, { name: string; price: number }>();
    for (const part of chunk(itemIds, 150)) {
      const { data } = await supabase.from('menu_items').select('id, name, price').in('id', part);
      for (const i of (data ?? []) as Array<{ id: string; name: string; price: number | null }>) itens.set(i.id, { name: i.name, price: num(i.price) });
    }
    const opcoes = new Map<string, { name: string; price: number }>();
    for (const part of chunk(optionIds, 150)) {
      const { data } = await supabase.from('options').select('id, name, additional_price').in('id', part);
      for (const o of (data ?? []) as Array<{ id: string; name: string; additional_price: number | null }>) opcoes.set(o.id, { name: o.name, price: num(o.additional_price) });
    }
    const [fichas, custoOpcao] = await Promise.all([custoFichaItens(tenantId, itemIds), custoUnitDasOpcoes(tenantId, optionIds)]);

    const custoCombo = (comboId: string): number | null => {
      const comp = combosItens.filter((c) => c.combo_id === comboId);
      if (!comp.length) return null;
      let s = 0;
      for (const c of comp) { const v = fichas.get(c.item_id); if (v == null) return null; s += v * (num(c.quantity) || 1); }
      return s;
    };

    for (const l of links.rows) {
      const chave = l.level === 'item' ? `item|${l.name_key}` : `complemento|${l.name_key}|${l.group_key}`;
      let alvo: CustoAlvo;
      if (l.target_kind === 'item' && l.menu_item_id) {
        const it = itens.get(l.menu_item_id);
        alvo = { custo: fichas.get(l.menu_item_id) ?? null, alvo: it?.name ?? 'Item do cardápio', tipo: 'item', precoBalcao: it?.price ?? null };
      } else if (l.target_kind === 'combo' && l.combo_id) {
        const cb = combos.get(l.combo_id);
        alvo = { custo: custoCombo(l.combo_id), alvo: cb?.name ?? 'Combo do cardápio', tipo: 'combo', precoBalcao: cb?.price ?? null };
      } else if (l.target_kind === 'option' && l.option_id) {
        const op = opcoes.get(l.option_id);
        alvo = { custo: custoOpcao.get(l.option_id) ?? 0, alvo: op?.name ?? 'Opção do cardápio', tipo: 'option', precoBalcao: op?.price ?? null };
      } else {
        alvo = { custo: 0, alvo: 'Não usa estoque', tipo: 'sem_estoque', precoBalcao: null };
      }
      mapa.set(chave, alvo);
    }
  } catch (e) {
    return { mapa, erro: e instanceof Error ? e.message : String(e) };
  }

  // Custo montado à mão (CMV antigo). Só para quem lê o financeiro; sem acesso, segue só com as ligações.
  const [ci, cl] = await Promise.all([
    fetchAllRows<{ id: string; kind: 'item' | 'complemento'; name: string }>((f, t) => supabase.from('fin_ifood_cmv_items').select('id, kind, name').eq('tenant_id', tenantId).order('id').range(f, t)),
    fetchAllRows<{ cmv_item_id: string; ingredient_id: string; quantity: number; unit: string }>((f, t) => supabase.from('fin_ifood_cmv_linhas').select('cmv_item_id, ingredient_id, quantity, unit').eq('tenant_id', tenantId).order('id').range(f, t)),
  ]);
  if (!ci.error && !cl.error && ci.rows.length) {
    const ingIds = [...new Set(cl.rows.map((l) => l.ingredient_id))];
    const ings = new Map<string, { unit: string; unit_price: number }>();
    for (const part of chunk(ingIds, 150)) {
      const { data } = await supabase.from('ingredients').select('id, unit, unit_price').in('id', part);
      for (const g of (data ?? []) as Array<{ id: string; unit: string; unit_price: number | null }>) ings.set(g.id, { unit: g.unit, unit_price: num(g.unit_price) });
    }
    for (const it of ci.rows) {
      const ls = cl.rows.filter((l) => l.cmv_item_id === it.id);
      if (!ls.length) continue;
      const custo = ls.reduce((s, l) => { const g = ings.get(l.ingredient_id); return s + (g ? custoLinhaFicha(num(l.quantity), l.unit, g.unit, g.unit_price) : 0); }, 0);
      const chave = it.kind === 'item' ? `item|${normIfood(it.name)}` : `complemento|${normIfood(it.name)}|*`;
      // A ligação ao cardápio manda; o custo à mão só vale sem ligação ou quando a ligação não tem ficha
      // (a ligação continua dando baixa no estoque).
      const lig = mapa.get(chave);
      if (!lig) mapa.set(chave, { custo, alvo: 'Custo montado à mão', tipo: 'composicao', precoBalcao: null });
      else if (lig.custo == null) mapa.set(chave, { ...lig, custo, alvo: `${lig.alvo} · custo montado à mão` });
    }
  }
  return { mapa, erro: null };
}
