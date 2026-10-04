// Preço promocional do Cardápio (item_promotions) que vale HOJE — regra única do servidor.
// Extraída do mesa-write em 2026-10-04 para o delivery-write cobrar o mesmo preço que o cardápio
// do cliente mostra (antes o delivery mostrava a promoção e cobrava o preço cheio).
// Espelha `rawPromoAtivaHoje` (src/lib/promoUtils.ts), mas no fuso de Brasília:
//  - pontual = tem `specific_date` e NÃO é recorrente → vale só nessa data;
//  - recorrente/semanal → `days_of_week` vazio = todos os dias; senão o dia de hoje (0=Dom..6=Sáb);
//  - mais de uma valendo para o mesmo item → vence o menor preço.
// A promoção SUBSTITUI o preço do item (inclusive o preço próprio do delivery), igual à tela.
// Quem chama já filtra loja, is_active = true e deleted_at nulo na consulta; aqui só o dia.
// Módulo puro (sem Deno/fetch): testado em src/test/edge/promoItem.test.ts.

export type PromoItemRow = {
  item_id: unknown;
  promotional_price: unknown;
  days_of_week?: unknown;
  is_recurring?: unknown;
  specific_date?: unknown;
};

/** Data (YYYY-MM-DD) e dia da semana (0=Dom..6=Sáb) em America/Sao_Paulo. */
export function hojeBrasilia(agora: Date = new Date()): { hoje: string; diaSemana: number } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(agora);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return { hoje: `${p("year")}-${p("month")}-${p("day")}`, diaSemana: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p("weekday")) };
}

/** A promoção vale no dia informado (data e dia da semana de Brasília)? */
export function promoValeNoDia(p: PromoItemRow, hoje: string, diaSemana: number): boolean {
  if (p.specific_date && !p.is_recurring) return String(p.specific_date).slice(0, 10) === hoje;
  return !Array.isArray(p.days_of_week) || p.days_of_week.length === 0 || (p.days_of_week as number[]).includes(diaSemana);
}

/** item_id → preço promocional que vale hoje (menor preço quando há mais de uma). */
export function promoPrecosDeHoje(rows: PromoItemRow[] | null | undefined, agora: Date = new Date()): Map<string, number> {
  const { hoje, diaSemana } = hojeBrasilia(agora);
  const mapa = new Map<string, number>();
  for (const p of rows ?? []) {
    if (!promoValeNoDia(p, hoje, diaSemana)) continue;
    const k = String(p.item_id); const v = Number(p.promotional_price ?? 0);
    if (!mapa.has(k) || v < (mapa.get(k) as number)) mapa.set(k, v);
  }
  return mapa;
}
