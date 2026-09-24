// Linha que o fiscal-inbound cria ao lançar uma NF-e como compra, com a diferença entre o
// total da nota e a soma dos itens (ICMS-ST, IPI, seguro, outras despesas). É valor, não
// produto: não se vincula a insumo, não se confere no recebimento, não é "item comprado".
export const ehAcrescimoNota = (description?: string | null) =>
  String(description ?? '').startsWith('Acréscimos da nota');
