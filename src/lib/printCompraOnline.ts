// Print de compra online (Mercado Livre, Shopee, Amazon…) → itens de uma compra sem NF (2026-09-30, pedido
// do dono: ler a compra online também no "Lançar a partir deste pagamento" da Conciliação). A leitura é a
// mesma do /receber (Edge pedidos-pagamento › ler_print, Sonnet). Aqui só se monta a lista que fecha com o
// valor pago: desconto rateado pelos itens, frete como linha própria e, se o total do print bate com o
// pagamento e as linhas não (arredondamento do site), a diferença vai para as linhas pelo valor.

export interface PrintCompraLido {
  site: string | null;
  itens: { descricao: string; quantidade: number; valor: number | null }[];
  subtotal: number | null; desconto: number | null; frete: number | null; total: number | null;
  entrega: string | null; numero_pedido: string | null;
}

export interface LinhaPrint { descricao: string; qtd: number; total: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Rateia `valor` entre as linhas pelo peso de cada uma; a última absorve o centavo. */
function ratear(linhas: LinhaPrint[], alvo: number) {
  const soma = linhas.reduce((s, l) => s + l.total, 0);
  if (!linhas.length || soma <= 0) return;
  let acc = 0;
  linhas.forEach((l, i) => {
    if (i < linhas.length - 1) { l.total = r2(l.total * alvo / soma); acc += l.total; }
    else l.total = r2(alvo - acc);
  });
}

export function linhasDoPrint(p: PrintCompraLido, valorPago: number): { linhas: LinhaPrint[]; avisos: string[] } {
  const avisos: string[] = [];
  const produtos: LinhaPrint[] = (p.itens ?? [])
    .filter((it) => it.descricao?.trim())
    .map((it) => ({ descricao: it.descricao.trim().slice(0, 200), qtd: it.quantidade > 0 ? it.quantidade : 1, total: r2(Number(it.valor) || 0) }));
  // Um item só e sem valor na linha: o subtotal (ou o total sem frete) é dele
  if (produtos.length === 1 && !(produtos[0].total > 0)) {
    const base = p.subtotal ?? (p.total != null ? p.total - (p.frete ?? 0) + (p.desconto ?? 0) : null);
    if (base != null && base > 0) produtos[0].total = r2(base);
  }
  if (produtos.some((l) => !(l.total > 0))) avisos.push('Algum item veio sem valor no print: preencha antes de lançar.');

  const desconto = Math.abs(Number(p.desconto) || 0);
  const somaProdutos = produtos.reduce((s, l) => s + l.total, 0);
  if (desconto > 0 && somaProdutos > desconto) ratear(produtos.filter((l) => l.total > 0), r2(somaProdutos - desconto));

  const linhas = [...produtos];
  const frete = r2(Number(p.frete) || 0);
  if (frete > 0) linhas.push({ descricao: 'Frete', qtd: 1, total: frete });

  const soma = r2(linhas.reduce((s, l) => s + l.total, 0));
  const total = p.total != null ? r2(p.total) : null;
  if (total != null && Math.abs(total - valorPago) < 0.01) {
    if (Math.abs(soma - valorPago) >= 0.01 && soma > 0) ratear(linhas.filter((l) => l.total > 0), valorPago);
  } else if (total != null) {
    avisos.push(`O total do print é R$ ${total.toFixed(2).replace('.', ',')} e o pagamento é R$ ${valorPago.toFixed(2).replace('.', ',')}: confira se é a compra certa e ajuste os itens até fechar.`);
  }
  return { linhas, avisos };
}
