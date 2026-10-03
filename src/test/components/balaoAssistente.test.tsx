// Balão do assistente (2026-10-03): "Fazer rápido" com as ações mais usadas neste aparelho e o botão
// saindo do caminho (rolando para baixo, teclado aberto fora do chat, janela aberta).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { maisUsadas, registrarUsoAcao } from '@/components/feature/assistente/acoes/maisUsadas';
import { useBalaoEscondido } from '@/components/feature/assistente/useBalaoEscondido';

const A = (id: string) => ({ id });

describe('maisUsadas', () => {
  beforeEach(() => localStorage.clear());

  it('sem uso: o padrão do perfil, depois a ordem do menu; só as liberadas', () => {
    const liberadas = ['a', 'b', 'c', 'd'].map(A);
    expect(maisUsadas(liberadas, ['c', 'x', 'a'], 3).map((a) => a.id)).toEqual(['c', 'a', 'b']);
  });

  it('as mais usadas vêm primeiro (mais vezes, depois a mais recente)', () => {
    const liberadas = ['a', 'b', 'c', 'd'].map(A);
    registrarUsoAcao('d'); registrarUsoAcao('d'); registrarUsoAcao('b');
    expect(maisUsadas(liberadas, ['a'], 3).map((a) => a.id)).toEqual(['d', 'b', 'a']);
  });

  it('ação usada que deixou de ser liberada não aparece', () => {
    registrarUsoAcao('sumiu');
    expect(maisUsadas(['a'].map(A), [], 6).map((a) => a.id)).toEqual(['a']);
  });
});

function Sonda({ aberto = false }: { aberto?: boolean }) {
  const escondido = useBalaoEscondido(aberto);
  return (
    <div>
      <span data-testid="estado">{escondido ? 'escondido' : 'visivel'}</span>
      <div data-testid="pagina" style={{ overflowY: 'auto' }} />
      <input aria-label="campo da tela" />
      <div data-balao><input aria-label="campo do chat" /><div data-testid="lista-chat" style={{ overflowY: 'auto' }} /></div>
    </div>
  );
}

describe('useBalaoEscondido', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });
  const rolar = (el: HTMLElement, y: number) => act(() => {
    Object.defineProperty(el, 'scrollTop', { configurable: true, value: y });
    fireEvent.scroll(el);
  });
  const estado = () => screen.getByTestId('estado').textContent;

  it('some rolando para baixo e volta ao rolar para cima (ou no topo)', () => {
    render(<MemoryRouter><Sonda /></MemoryRouter>);
    const pagina = screen.getByTestId('pagina');
    expect(estado()).toBe('visivel');
    rolar(pagina, 200);
    expect(estado()).toBe('escondido');
    rolar(pagina, 400);
    expect(estado()).toBe('escondido'); // no fim da página (onde fica o Salvar) continua escondido
    rolar(pagina, 300);
    expect(estado()).toBe('visivel');
    rolar(pagina, 500);
    rolar(pagina, 10);
    expect(estado()).toBe('visivel');
  });

  it('no celular, teclado aberto num campo da tela esconde; no campo do chat não', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    render(<MemoryRouter><Sonda /></MemoryRouter>);
    act(() => screen.getByLabelText('campo da tela').focus());
    expect(estado()).toBe('escondido');
    act(() => screen.getByLabelText('campo do chat').focus());
    expect(estado()).toBe('visivel');
  });

  it('rolar dentro do chat não conta; abrir ou fechar o chat zera (o botão nunca volta escondido)', () => {
    const { rerender } = render(<MemoryRouter><Sonda /></MemoryRouter>);
    rolar(screen.getByTestId('lista-chat'), 900);
    expect(estado()).toBe('visivel');
    rolar(screen.getByTestId('pagina'), 300);
    expect(estado()).toBe('escondido');
    rerender(<MemoryRouter><Sonda aberto /></MemoryRouter>);
    rerender(<MemoryRouter><Sonda aberto={false} /></MemoryRouter>);
    expect(estado()).toBe('visivel');
  });

  it('no computador o teclado não esconde', () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    render(<MemoryRouter><Sonda /></MemoryRouter>);
    act(() => screen.getByLabelText('campo da tela').focus());
    expect(estado()).toBe('visivel');
  });
});
