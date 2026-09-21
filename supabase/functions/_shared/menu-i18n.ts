// Cardápio em outros idiomas nos canais do cliente (delivery, mesa-qr, totem).
//
// REGRA QUE NÃO PODE SER QUEBRADA: a tradução é SOMENTE enfeite de vitrine.
// Nada aqui substitui o campo `name`/`description` original — o texto traduzido
// entra em campos NOVOS (`name_i18n`, `description_i18n`).
//
// Porque isso importa: `order-write` grava `item_name` a partir do que o
// cliente manda, e ainda procura o item por `ilike(name, item_name)` quando o
// id não vem. Se o cardápio traduzido sobrescrevesse `name`, o pedido chegaria
// no KDS e na impressora da COZINHA em inglês — e a busca por nome quebraria.
// Com campo separado, qualquer tela que ainda não conheça i18n continua
// funcionando em português, que é o comportamento seguro.
//
// deno-lint-ignore-file no-explicit-any

export const DEFAULT_LOCALE = 'pt-BR';

/** Idiomas ativos da loja (fora o português, que é implícito). */
export async function activeLocales(admin: any, tenantId: string): Promise<string[]> {
  const { data, error } = await admin.from('tenant_locales')
    .select('locale').eq('tenant_id', tenantId).eq('is_active', true).order('sort_order');
  if (error || !data) return [];
  return data.map((r: { locale: string }) => r.locale);
}

/** 'en-US' → 'en'. Português (ou vazio) devolve null: não há o que traduzir. */
export function normalizeLocale(raw: unknown, available: string[]): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (available.includes(s)) return s;
  const base = s.split('-')[0].toLowerCase();
  if (base === 'pt') return null;
  return available.includes(base) ? base : null;
}

type Row = Record<string, unknown>;

interface Translated {
  name: string | null;
  description: string | null;
}

/**
 * Busca as traduções da loja no idioma pedido e devolve um índice por
 * `entity_type:entity_id`. Uma query só para o cardápio inteiro.
 */
export async function loadTranslations(admin: any, tenantId: string, locale: string): Promise<Map<string, Translated>> {
  const { data, error } = await admin.from('menu_translations')
    .select('entity_type, entity_id, name, description')
    .eq('tenant_id', tenantId).eq('locale', locale);
  const map = new Map<string, Translated>();
  if (error || !data) return map;
  for (const t of data as Array<Row>) {
    map.set(`${t.entity_type}:${t.entity_id}`, {
      name: (t.name as string) ?? null,
      description: (t.description as string) ?? null,
    });
  }
  return map;
}

/**
 * Acrescenta `name_i18n` / `description_i18n` a cada linha. O campo original
 * fica intacto. Sem tradução para aquela linha, os campos novos nem aparecem —
 * o front cai no português sozinho.
 */
export function decorate(rows: Row[] | null | undefined, entityType: string, map: Map<string, Translated>, nameField = 'name', descField = 'description'): Row[] {
  if (!rows) return [];
  if (map.size === 0) return rows;
  return rows.map((r) => {
    const t = map.get(`${entityType}:${r.id}`);
    if (!t) return r;
    const out: Row = { ...r };
    if (t.name) out[`${nameField}_i18n`] = t.name;
    if (t.description) out[`${descField}_i18n`] = t.description;
    return out;
  });
}

/**
 * Só as traduções, sem o cardápio junto. Serve para o cliente TROCAR de idioma
 * no meio da navegação: o front mescla `*_i18n` no que já tem na tela em vez de
 * recarregar o cardápio, o que zeraria carrinho e etapa do checkout.
 * Idioma português devolve listas vazias — o front limpa os `*_i18n` e volta
 * sozinho ao texto original.
 */
export async function translationsPayload(admin: any, tenantId: string, rawLocale: unknown) {
  const locales = await activeLocales(admin, tenantId);
  const locale = normalizeLocale(rawLocale, locales);
  if (!locale) return { locale: DEFAULT_LOCALE, locales, translations: [] };

  const { data } = await admin.from('menu_translations')
    .select('entity_type, entity_id, name, description')
    .eq('tenant_id', tenantId).eq('locale', locale);

  return {
    locale,
    locales,
    translations: (data ?? []).map((t: Row) => ({
      t: t.entity_type, id: t.entity_id, n: t.name, d: t.description,
    })),
  };
}

/**
 * Destaques carregam cópia do nome/descrição do item (`item_name`,
 * `item_description`), então precisam da tradução do ITEM, não de si mesmos.
 */
export function decorateHighlights(rows: Row[] | null | undefined, map: Map<string, Translated>): Row[] {
  if (!rows) return [];
  if (map.size === 0) return rows;
  return rows.map((h) => {
    const t = map.get(`item:${h.item_id}`);
    if (!t) return h;
    const out: Row = { ...h };
    if (t.name) out.item_name_i18n = t.name;
    // custom_description é texto escrito à mão no destaque e não passa pela
    // tradução; só herda a do item quando o destaque não tem texto próprio.
    if (t.description && !h.custom_description) out.item_description_i18n = t.description;
    return out;
  });
}
