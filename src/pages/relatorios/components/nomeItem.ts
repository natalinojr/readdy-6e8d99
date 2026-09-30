// ── Normalização de nome de item ──────────────────────────────────────────────
// Itens com múltiplas unidades rastreadas no KDS são gravados como order_items
// separados com sufixo " (Un. N)" (ex.: "Hamburguer de Bacon (Un. 1)"). No ranking
// são o MESMO produto do cardápio — remove o sufixo e faz trim para agrupar/somar
// (também unifica variações de espaço em branco no fim do nome).
export function normalizarNomeItem(nome: string): string {
  return nome.replace(/\s*\(Un\.\s*\d+\)\s*$/i, '').trim();
}
