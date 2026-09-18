import { describe, it, expect } from 'vitest';
import { formasAceitasKiosk } from '@/lib/kioskFormasAceitas';

const methods = [
  { id: 'a', type: 'cash' },
  { id: 'b', type: 'pix' },
  { id: 'c', type: 'credit_card' },
  { id: 'd', type: 'debit_card' },
];

describe('formasAceitasKiosk', () => {
  it('não anuncia PIX sem provedor automático', () => {
    expect(formasAceitasKiosk(methods, null, false)).toEqual(['Dinheiro', 'Cartão']);
  });
  it('anuncia PIX com provedor e agrupa crédito/débito', () => {
    expect(formasAceitasKiosk(methods, undefined, true)).toEqual(['Dinheiro', 'PIX', 'Cartão']);
  });
  it('respeita as formas permitidas no totem', () => {
    expect(formasAceitasKiosk(methods, ['b', 'd'], true)).toEqual(['PIX', 'Cartão']);
  });
});
