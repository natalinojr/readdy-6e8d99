// voucher-write não tem chave de idempotência: se o invokeWithAuth repetir a chamada depois de
// um erro de rede, a baixa/emissão/estorno pode acontecer duas vezes (a 1ª gravou, só a resposta
// se perdeu). Estas ações têm de estar na lista que NÃO é repetida sozinha (2026-10-04).
import { describe, it, expect, vi } from 'vitest';

describe('NON_IDEMPOTENT_ACTIONS — vouchers', () => {
  it('não repete baixa, emissão, estorno, cancelamento nem geração de aniversário', async () => {
    const real = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
    for (const acao of ['redeem_voucher', 'issue_voucher', 'refund_voucher_redemption', 'cancel_voucher', 'generate_birthday_vouchers']) {
      expect(real.NON_IDEMPOTENT_ACTIONS.has(acao)).toBe(true);
    }
  });

  it('leituras continuam podendo repetir', async () => {
    const real = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
    for (const acao of ['validate_voucher', 'list_vouchers', 'get_voucher_transactions']) {
      expect(real.NON_IDEMPOTENT_ACTIONS.has(acao)).toBe(false);
    }
  });
});
