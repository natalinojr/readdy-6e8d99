// Teclado virtual (QWERTY desenhado pelo ERPOS) × teclado nativo do celular.
//
// Regra (dono, 2026-09-16): celular usa SEMPRE o teclado nativo. O QWERTY virtual existe para tela
// grande de toque (totem, PDV, tablet) sem teclado físico. Antes valia para qualquer aparelho de
// toque, então no celular ele cobria o sistema inteiro (login, chat, PDV) — só as telas do cliente
// (delivery/mesa-qr) escapavam.
//
// Como o teste sabe que o teclado virtual abriu: o contexto marca o campo como readOnly e põe
// inputmode="none" para impedir o teclado do sistema. No celular, nada disso pode acontecer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { VirtualKeyboardProvider } from '@/contexts/VirtualKeyboardContext';

function comTela(largura: number, altura: number, touch = true) {
  Object.defineProperty(window, 'screen', { configurable: true, value: { width: largura, height: altura } });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touch ? 5 : 0 });
  // O contexto também aceita 'ontouchstart' in window como sinal de toque.
  if (touch) Object.defineProperty(window, 'ontouchstart', { configurable: true, value: null });
  else delete (window as unknown as Record<string, unknown>).ontouchstart;
}

function tocar(el: HTMLElement) {
  // jsdom não tem TouchEvent; o listener só usa e.target/preventDefault.
  el.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
}

function montar() {
  const r = render(
    <VirtualKeyboardProvider>
      <input placeholder="Campo" />
    </VirtualKeyboardProvider>,
  );
  return r.getByPlaceholderText('Campo') as HTMLInputElement;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/financeiro'); // tela de gestão (não é rota de cliente)
});
afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('teclado virtual × nativo', () => {
  it('celular (tela pequena): toque NÃO abre o teclado virtual — fica o nativo', () => {
    comTela(390, 844);
    const input = montar();
    tocar(input);
    expect(input.readOnly).toBe(false);
    expect(input.getAttribute('inputmode')).toBeNull();
  });

  it('tablet/totem (tela grande de toque): o teclado virtual continua abrindo', () => {
    comTela(1280, 800);
    const input = montar();
    tocar(input);
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('inputmode')).toBe('none');
  });

  it('dentro do app Android (Capacitor), mesmo em tela grande, usa o nativo', () => {
    comTela(1280, 800);
    (window as unknown as { Capacitor?: unknown }).Capacitor = { Plugins: {} };
    const input = montar();
    tocar(input);
    expect(input.readOnly).toBe(false);
  });

  it('desktop sem toque: nada acontece', () => {
    comTela(1920, 1080, false);
    const input = montar();
    tocar(input);
    expect(input.readOnly).toBe(false);
  });

  it('tela do cliente (delivery) no tablet: continua com o teclado nativo', () => {
    comTela(1280, 800);
    window.history.replaceState({}, '', '/delivery');
    const input = montar();
    tocar(input);
    expect(input.readOnly).toBe(false);
  });
});
