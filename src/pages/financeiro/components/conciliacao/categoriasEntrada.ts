// Etiquetas das ENTRADAS do extrato (a DRE não tem grupo de receita para escolher aqui).
// A etiqueta só marca a linha — a receita vem da fonte da loja (Pix recebido, maquininha, iFood).
// Exceção que muda a conta: "Aporte de sócio" e "Estorno / devolução de fornecedor" saem do Pix recebido
// (fin_pix_recebidos). Usada no detalhe da transação e na tela Regras.
export const CATEGORIAS_ENTRADA = [
  'Repasse Stone', 'Repasse iFood', 'Venda Pix (tablet)', 'Repasse Tuna Pagamentos', 'Repasse voucher (VR, Alelo, Ticket…)',
  'Recebimento Stone Cartão', 'Transferência entre contas', 'Aporte de sócio',
  'Estorno / devolução de fornecedor', 'Outras receitas',
];
