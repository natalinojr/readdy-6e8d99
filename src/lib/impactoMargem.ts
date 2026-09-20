// ─── Rótulo do "Impacto na Margem" (Contas Vencidas) ─────────────────────────
// Sem receita no período, `(vencido / receita) * 100` daria 0,0% — mentindo
// que o impacto é nulo. Quando não há receita para dividir, o rótulo diz isso
// em vez de fingir um percentual.
export function rotuloImpactoMargem(totalVencido: number, receitaBruta: number): string {
  if (receitaBruta <= 0) return 'sem receita no período';
  const pct = (totalVencido / receitaBruta) * 100;
  return `${pct.toFixed(1).replace('.', ',')}%`;
}
