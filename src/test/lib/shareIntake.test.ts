// src/lib/shareIntake.ts — "Compartilhar" do Android chegando ao chat do assistente.
// Roda no início do app (main.tsx): guarda o conteúdo no sessionStorage e manda para /assistente.
// Por que existe: em 15/09/2026 o app abriu em /modulos (tela sem chat) e a imagem compartilhada
// se perdeu — o tratamento estava dentro do próprio chat.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installShareIntake, SHARE_KEY } from '@/lib/shareIntake';

type Plugins = Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const setCapacitor = (plugins: Plugins) => { (window as unknown as { Capacitor?: unknown }).Capacitor = { Plugins: plugins }; };
const guardado = () => { const v = sessionStorage.getItem(SHARE_KEY); return v ? JSON.parse(v) : null; };

const assign = vi.fn();
beforeEach(() => {
  sessionStorage.clear();
  assign.mockClear();
  // window.location não é gravável no jsdom: troca só o necessário.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/modulos', assign },
  });
});
afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('shareIntake', () => {
  it('no navegador (sem Capacitor) não faz nada', async () => {
    installShareIntake();
    await esperar();
    expect(guardado()).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('PDF compartilhado com o app em /modulos: guarda e vai para /assistente', async () => {
    const readFile = vi.fn().mockResolvedValue({ data: btoa('%PDF-1.4 cupom') });
    setCapacitor({
      SendIntent: { checkSendIntentReceived: vi.fn().mockResolvedValue({ title: 'cupom.pdf', type: 'application/pdf', url: 'file%3A%2F%2F%2Fcache%2Fcupom.pdf' }) },
      Filesystem: { readFile },
    });
    installShareIntake();
    await esperar();
    expect(readFile).toHaveBeenCalledWith({ path: 'file:///cache/cupom.pdf' });
    expect(guardado()).toMatchObject({ kind: 'arquivo', nome: 'cupom.pdf', media_type: 'application/pdf' });
    expect(assign).toHaveBeenCalledWith('/assistente');
  });

  it('texto compartilhado vira payload de texto', async () => {
    setCapacitor({ SendIntent: { checkSendIntentReceived: vi.fn().mockResolvedValue({ description: 'Pague o boleto 34191.79001', type: 'text/plain' }) } });
    installShareIntake();
    await esperar();
    expect(guardado()).toEqual({ kind: 'texto', texto: 'Pague o boleto 34191.79001' });
    expect(assign).toHaveBeenCalledWith('/assistente');
  });

  it('já na tela do assistente: avisa por evento em vez de recarregar', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/assistente', assign } });
    const ouvinte = vi.fn();
    window.addEventListener('erpos-share', ouvinte);
    setCapacitor({ SendIntent: { checkSendIntentReceived: vi.fn().mockResolvedValue({ description: 'oi', type: 'text/plain' }) } });
    installShareIntake();
    await esperar();
    expect(assign).not.toHaveBeenCalled();
    expect(ouvinte).toHaveBeenCalled();
    window.removeEventListener('erpos-share', ouvinte);
  });

  it('arquivo que não abre vira texto (não perde o compartilhamento)', async () => {
    setCapacitor({
      SendIntent: { checkSendIntentReceived: vi.fn().mockResolvedValue({ title: 'foto.jpg', type: 'image/jpeg', url: 'file%3A%2F%2F%2Fcache%2Ffoto.jpg' }) },
      Filesystem: { readFile: vi.fn().mockRejectedValue(new Error('sem permissão')) },
    });
    installShareIntake();
    await esperar();
    expect(guardado()).toMatchObject({ kind: 'texto' });
    expect(assign).toHaveBeenCalledWith('/assistente');
  });

  it('abertura normal do app (nada compartilhado) não mexe em nada', async () => {
    setCapacitor({ SendIntent: { checkSendIntentReceived: vi.fn().mockResolvedValue({}) } });
    installShareIntake();
    await esperar();
    expect(guardado()).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
});
