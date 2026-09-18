import { describe, it, expect } from 'vitest';
import { formatPhoneBR, readSavedDeliveryPhone, saveDeliveryPhone, clearSavedDeliveryPhone, deliveryPhoneKey } from '@/lib/deliveryPhone';

function memStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

describe('formatPhoneBR', () => {
  it('mascara celular com 11 dígitos', () => {
    expect(formatPhoneBR('41999998888')).toBe('(41) 99999-8888');
  });
  it('é idempotente com valor já mascarado', () => {
    expect(formatPhoneBR('(41) 99999-8888')).toBe('(41) 99999-8888');
  });
  it('fixo com 10 dígitos', () => {
    expect(formatPhoneBR('4133334444')).toBe('(41) 3333-4444');
  });
  it('vazio/nulo', () => {
    expect(formatPhoneBR(null)).toBe('');
    expect(formatPhoneBR('')).toBe('');
  });
});

describe('telefone salvo por loja', () => {
  it('lê a chave da loja', () => {
    const s = memStorage();
    saveDeliveryPhone(s, 't1', '41999998888');
    expect(readSavedDeliveryPhone(s, 't1')).toBe('41999998888');
    expect(readSavedDeliveryPhone(s, 't2')).toBeNull();
  });
  it('cai na chave antiga e migra para a da loja', () => {
    const s = memStorage();
    s.setItem('delivery_phone', '41911112222');
    expect(readSavedDeliveryPhone(s, 't1')).toBe('41911112222');
    expect(s.getItem(deliveryPhoneKey('t1'))).toBe('41911112222');
  });
  it('sair apaga a da loja e a antiga', () => {
    const s = memStorage();
    s.setItem('delivery_phone', 'x');
    saveDeliveryPhone(s, 't1', 'y');
    clearSavedDeliveryPhone(s, 't1');
    expect(readSavedDeliveryPhone(s, 't1')).toBeNull();
  });
});
