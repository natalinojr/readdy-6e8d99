import { describe, expect, it } from 'vitest';
import { linkWhatsNota } from '@/pages/nfse/api';

const base = { numero: '37', chave: '41069022123456789000100000000000003725091234567890', valor: 1800.5, competencia: '2026-10-07', empresa: 'IDEAR', tomador: 'Construtora X' };

describe('linkWhatsNota', () => {
  it('com telefone do tomador abre a conversa dele (55 + DDD)', () => {
    const url = linkWhatsNota({ ...base, fone: '(41) 99812-4471' });
    expect(url.startsWith('https://wa.me/5541998124471?text=')).toBe(true);
  });

  it('telefone já com 55 não duplica', () => {
    expect(linkWhatsNota({ ...base, fone: '+55 41 99812-4471' }).startsWith('https://wa.me/5541998124471?')).toBe(true);
  });

  it('sem telefone (ou inválido) deixa o WhatsApp pedir o contato', () => {
    expect(linkWhatsNota({ ...base, fone: null }).startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    expect(linkWhatsNota({ ...base, fone: '1234' }).startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
  });

  it('mensagem traz número, valor, competência e o link da consulta pública', () => {
    const texto = decodeURIComponent(linkWhatsNota({ ...base, fone: null }).split('text=')[1]);
    expect(texto).toContain('Olá, Construtora X!');
    expect(texto).toContain('nº 37 de IDEAR');
    expect(texto).toMatch(/R\$\s1\.800,50/);
    expect(texto).toContain('07/10/2026');
    expect(texto).toContain(`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${base.chave}`);
  });
});
