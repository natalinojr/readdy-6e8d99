import { describe, it, expect } from 'vitest';
import {
  descricaoVoucher, diaDaSemana, mensagemAniversario, rotuloDia, voucherVale,
  type Aniversariante, type AnivVoucher,
} from '../../pages/clientes/aniversarioMensagem';

const AGORA = new Date('2026-10-05T15:00:00Z').getTime();

const voucher = (p: Partial<AnivVoucher> = {}): AnivVoucher => ({
  code: 'BD-ABCD-EFGH', claim_token: 'tok123', voucher_type: 'discount', discount_type: 'percent',
  discount_value: 15, original_amount: 15, min_order_amount: null,
  expires_at: '2026-10-20T14:00:00Z', ...p,
});

const cliente = (p: Partial<Aniversariante> = {}): Aniversariante => ({
  customer_id: 'c1', nome: 'Maria da Silva', phone: '41999998888', phone_fmt: '(41) 99999-8888', opt_out: false,
  dias_ate: 0, data_aniversario: '05/10', proximo_aniversario: '2026-10-05', voucher: null, ...p,
});

describe('rotuloDia', () => {
  it('hoje', () => {
    expect(rotuloDia(cliente())).toBe('faz aniversário hoje');
  });
  it('dia da semana + dd/mm', () => {
    // 09/10/2026 é sexta-feira
    expect(diaDaSemana('2026-10-09')).toBe('sexta');
    expect(rotuloDia(cliente({ dias_ate: 4, data_aniversario: '09/10', proximo_aniversario: '2026-10-09' }))).toBe('sexta, 09/10');
  });
  it('virada do ano', () => {
    expect(rotuloDia(cliente({ dias_ate: 3, data_aniversario: '02/01', proximo_aniversario: '2027-01-02' }))).toBe('sábado, 02/01');
  });
});

describe('voucherVale', () => {
  it('sem voucher ou vencido não vale', () => {
    expect(voucherVale(null, AGORA)).toBe(false);
    expect(voucherVale(voucher({ expires_at: '2026-10-01T00:00:00Z' }), AGORA)).toBe(false);
  });
  it('dentro da validade ou sem validade vale', () => {
    expect(voucherVale(voucher(), AGORA)).toBe(true);
    expect(voucherVale(voucher({ expires_at: null }), AGORA)).toBe(true);
  });
});

describe('descricaoVoucher', () => {
  it('percentual, valor fixo e vale-presente', () => {
    expect(descricaoVoucher(voucher())).toBe('15% de desconto');
    expect(descricaoVoucher(voucher({ discount_type: 'fixed', discount_value: 10 }))).toMatch(/^R\$\s10,00 de desconto$/);
    expect(descricaoVoucher(voucher({ voucher_type: 'gift_card', discount_type: null, discount_value: null, original_amount: 50 })))
      .toMatch(/^um vale-presente de R\$\s50,00$/);
  });
});

describe('mensagemAniversario', () => {
  const op = { loja: 'El Patrón', origin: 'https://erpos.vercel.app', agora: AGORA };

  it('com voucher: código, link de ativação e validade em Brasília', () => {
    const t = mensagemAniversario(cliente({ voucher: voucher() }), op);
    expect(t).toContain('Olá, Maria!');
    expect(t).toContain('Feliz aniversário!');
    expect(t).toContain('use o código *BD-ABCD-EFGH*');
    expect(t).toContain('15% de desconto');
    expect(t).toContain('Válido até 20/10.');
    expect(t).toContain('https://erpos.vercel.app/voucher/tok123');
  });

  it('com voucher sem claim_token: não inventa link', () => {
    const t = mensagemAniversario(cliente({ voucher: voucher({ claim_token: null }) }), op);
    expect(t).toContain('*BD-ABCD-EFGH*');
    expect(t).not.toContain('/voucher/');
  });

  it('gasto mínimo aparece na mensagem', () => {
    const t = mensagemAniversario(cliente({ voucher: voucher({ min_order_amount: 40 }) }), op);
    expect(t).toMatch(/em pedidos acima de R\$\s40,00/);
  });

  it('sem voucher: só parabéns e convite, sem código nem link', () => {
    const t = mensagemAniversario(cliente(), op);
    expect(t).toContain('Feliz aniversário!');
    expect(t).toContain('venha nos visitar');
    expect(t).not.toContain('*');
    expect(t).not.toContain('/voucher/');
  });

  it('voucher vencido vira mensagem sem voucher (não manda código morto)', () => {
    const t = mensagemAniversario(cliente({ voucher: voucher({ expires_at: '2026-10-01T00:00:00Z' }) }), op);
    expect(t).not.toContain('BD-ABCD-EFGH');
  });

  it('antes da data: aniversário antecipado', () => {
    expect(mensagemAniversario(cliente({ dias_ate: 3 }), op)).toContain('Feliz aniversário antecipado!');
  });

  it('origin com barra no fim não duplica a barra', () => {
    const t = mensagemAniversario(cliente({ voucher: voucher() }), { ...op, origin: 'https://erpos.vercel.app/' });
    expect(t).toContain('https://erpos.vercel.app/voucher/tok123');
  });
});
