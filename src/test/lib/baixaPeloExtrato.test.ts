// "Já paguei" numa conta em aberto (2026-10-08): achar no extrato a saída que pagou a conta.
import { describe, it, expect } from 'vitest';
import { candidatosDaConta, janelaContaAberta, valorPerto, type LinhaExtratoBusca } from '../../../supabase/functions/_shared/trilha-acoes';

const linha = (o: Partial<LinhaExtratoBusca>): LinhaExtratoBusca => ({
  id: 'x', transaction_date: '2026-10-06', amount: -334, transaction_type: 'debit', status: 'pending',
  reconciled: false, match_kind: null, match_ref_id: null, match_detail: null, ...o,
});

describe('janelaContaAberta', () => {
  it('vencida: 20 dias antes do vencimento até hoje', () => {
    expect(janelaContaAberta('2026-10-06', '2026-10-08')).toEqual({ base: '2026-10-06', de: '2026-09-16', ate: '2026-10-08' });
  });
  it('vence depois: 20 dias antes de hoje (pagamento adiantado)', () => {
    expect(janelaContaAberta('2026-10-25', '2026-10-08')).toEqual({ base: '2026-10-25', de: '2026-09-18', ate: '2026-10-08' });
  });
});

describe('valorPerto', () => {
  it('aceita igual, juros até 10% e desconto até 5%', () => {
    expect(valorPerto(334, 334)).toBe(true);
    expect(valorPerto(340.5, 334)).toBe(true);
    expect(valorPerto(380, 334)).toBe(false);
    expect(valorPerto(320, 334)).toBe(true);
    expect(valorPerto(310, 334)).toBe(false);
  });
});

describe('candidatosDaConta', () => {
  it('a sugerida para esta conta vem primeiro; depois valor mais perto; tira conciliada, repasse e outro valor', () => {
    const r = candidatosDaConta([
      linha({ id: 'juros', amount: -337.2, transaction_date: '2026-10-07' }),
      linha({ id: 'igual', amount: -334, transaction_date: '2026-10-05' }),
      linha({ id: 'sug', amount: -336, match_kind: 'payable', match_ref_id: 'b1' }),
      linha({ id: 'outra', amount: -334, match_kind: 'payable', match_ref_id: 'b2' }),
      linha({ id: 'feita', amount: -334, reconciled: true }),
      linha({ id: 'confirmada', amount: -334, match_detail: { confirmed: { bill_id: 'b3' } } }),
      linha({ id: 'transf', amount: -334, match_kind: 'internal_transfer' }),
      linha({ id: 'credito', amount: 334, transaction_type: 'credit' }),
      linha({ id: 'longe', amount: -900 }),
    ], 'b1', 334, '2026-10-06');
    expect(r.map((c) => c.id)).toEqual(['sug', 'igual', 'juros', 'outra']);
    expect(r[0].sugerida).toBe(true);
    expect(r.find((c) => c.id === 'outra')?.outra).toBe(true);
    expect(r.find((c) => c.id === 'juros')?.diferenca).toBe(3.2);
  });
});
