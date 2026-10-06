import { describe, it, expect } from 'vitest';
import { textoErroNota, PROVEDOR_FORA_DO_AR } from '@/lib/fiscal';

describe('textoErroNota', () => {
  it('troca a página HTML do provedor fora do ar por uma frase', () => {
    expect(textoErroNota('<!DOCTYPE html>\n<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US">')).toBe(PROVEDOR_FORA_DO_AR);
    expect(textoErroNota('  <html><body>502</body></html>')).toBe(PROVEDOR_FORA_DO_AR);
  });
  it('mantém a mensagem normal e vazio vira vazio', () => {
    expect(textoErroNota('Rejeição 539: Duplicidade de NF-e')).toBe('Rejeição 539: Duplicidade de NF-e');
    expect(textoErroNota(null)).toBe('');
  });
});
