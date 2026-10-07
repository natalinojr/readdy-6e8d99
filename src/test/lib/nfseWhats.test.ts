import { afterEach, describe, expect, it, vi } from 'vitest';
import { enviarPdfWhatsApp, textoNota } from '@/pages/nfse/components/enviarNota';

// A geração do PDF (html2canvas + jsPDF) precisa de navegador de verdade: testada na tela.
vi.mock('@/pages/nfse/components/danfse', () => ({ pdfDanfse: vi.fn() }));

const pdf = () => new File(['%PDF-1.3'], 'NFSe 40.pdf', { type: 'application/pdf' });
const nav = navigator as unknown as { share?: unknown; canShare?: unknown };

afterEach(() => {
  delete nav.share;
  delete nav.canShare;
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.restoreAllMocks();
});

describe('textoNota', () => {
  it('traz número, empresa, valor e competência', () => {
    const t = textoNota({ numero: '40', valor: 12500, competencia: '2026-10-07', empresa: 'IDEAR' });
    expect(t).toContain('nº 40 de IDEAR');
    expect(t).toMatch(/R\$\s12\.500,00/);
    expect(t).toContain('07/10/2026');
  });
});

describe('enviarPdfWhatsApp', () => {
  it('com Compartilhar de arquivo, entrega o PDF ao sistema (a pessoa escolhe app e contato)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(nav, { canShare: () => true, share });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const f = pdf();
    expect(await enviarPdfWhatsApp(f, 'Nota 40')).toBe('compartilhado');
    expect(share).toHaveBeenCalledWith({ files: [f], text: 'Nota 40' });
    expect(open).not.toHaveBeenCalled();
  });

  it('fechar o Compartilhar não é erro', async () => {
    Object.assign(nav, { canShare: () => true, share: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })) });
    expect(await enviarPdfWhatsApp(pdf(), 'Nota 40')).toBe('cancelado');
  });

  it('sem Compartilhar: baixa o PDF e abre o WhatsApp sem número (escolhe o contato)', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(await enviarPdfWhatsApp(pdf(), 'Nota 40')).toBe('baixado');
    expect(click).toHaveBeenCalled();
    const url = String(open.mock.calls[0][0]);
    expect(url.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    expect(url).not.toMatch(/phone=|wa\.me\/\d/);
  });

  it('app Android com o plugin Share: grava no cache e compartilha o arquivo', async () => {
    const writeFile = vi.fn().mockResolvedValue({ uri: 'file:///cache/NFSe 40.pdf' });
    const share = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { Filesystem: { writeFile }, Share: { share } } };
    expect(await enviarPdfWhatsApp(pdf(), 'Nota 40')).toBe('compartilhado');
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'NFSe 40.pdf', directory: 'CACHE' }));
    expect(share).toHaveBeenCalledWith({ title: 'Nota 40', files: ['file:///cache/NFSe 40.pdf'] });
  });
});
