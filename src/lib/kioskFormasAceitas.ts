/**
 * kioskFormasAceitas.ts — texto "Aceito: ..." da tela inicial do totem.
 *
 * Mesma fonte do PagamentoKiosk: payment_methods ativos da loja, filtrados por
 * `self_service_payment_methods` (quando configurado) e Pix só com provedor automático.
 */
export interface KioskPaymentMethodLite {
  id: string;
  type: string;
}

const ORDEM: Array<{ label: string; tipos: string[] }> = [
  { label: 'Dinheiro', tipos: ['cash'] },
  { label: 'PIX', tipos: ['pix'] },
  { label: 'Cartão', tipos: ['credit_card', 'debit_card'] },
  { label: 'Vale-refeição', tipos: ['meal_voucher'] },
];

export function formasAceitasKiosk(
  methods: KioskPaymentMethodLite[],
  formasPermitidas: string[] | null | undefined,
  pixDisponivel: boolean,
): string[] {
  const visiveis = methods
    .filter((m) => !Array.isArray(formasPermitidas) || formasPermitidas.includes(m.id))
    .filter((m) => m.type !== 'pix' || pixDisponivel);
  const tipos = new Set(visiveis.map((m) => m.type));
  return ORDEM.filter((o) => o.tipos.some((t) => tipos.has(t))).map((o) => o.label);
}
