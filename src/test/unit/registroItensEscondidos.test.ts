import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const reportError = vi.fn();
vi.mock('@/lib/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { useRegistroItensEscondidos } from '@/pages/autoatendimento/registroItensEscondidos';
import type { Item, Categoria } from '@/types/cardapio';
import type { ItemCardapioPublico } from '@/types/mesaCliente';

const cat: Categoria = { id: 'c1', nome: 'Chopes', estacao: '', ordem: 1, ativo: true, totalItens: 2 };
const item = (id: string, nome: string, extra: Partial<Item> = {}): Item => ({
  id, categoriaId: 'c1', nome, descricao: '', preco: 15, fotoUrl: '', slaMinutos: 10, status: 'ativo',
  canais: { self_service: true }, ordem: 0, gruposOpcoes: [], promocoes: [], observacoesPadrao: [], fichaTecnica: [], ...extra,
});
const pub = (i: Item) => ({ id: i.id, nome: i.nome, categoria: 'Chopes' }) as unknown as ItemCardapioPublico;

const pilsen = item('i1', '1 chope Pilsen');
const vinho = item('i2', '1 chope Vinho');

function entrada(itens: Item[], extra: Record<string, unknown> = {}) {
  const publicos = itens.filter((i) => i.status === 'ativo').map(pub);
  return {
    tenantId: `t-${Math.random()}`, quem: 'Tablet1', visiveis: publicos, itensPublicos: publicos, itens,
    categorias: [cat], combos: [], desabilitadosIds: [], semEstoque: new Map(), pronto: true, ...extra,
  };
}

describe('useRegistroItensEscondidos', () => {
  beforeEach(() => reportError.mockClear());

  it('registra o item que some (com motivo) e quando volta', () => {
    const base = entrada([pilsen, vinho]);
    const { rerender } = renderHook((p) => useRegistroItensEscondidos(p), { initialProps: base });
    expect(reportError).not.toHaveBeenCalled();

    // Vinho some do cardápio carregado
    const semVinho = { ...base, itens: [pilsen], itensPublicos: [pub(pilsen)], visiveis: [pub(pilsen)] };
    rerender(semVinho);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toBe('Tablet escondeu "1 chope Vinho": não veio no cardápio carregado');

    // Volta
    rerender({ ...base, itensPublicos: [pub(pilsen), pub(vinho)], visiveis: [pub(pilsen), pub(vinho)] });
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls[1][0]).toBe('Tablet voltou a mostrar "1 chope Vinho"');
  });

  it('aponta estoque quando a tela esconde por insumo zerado', () => {
    const base = entrada([pilsen, vinho]);
    const { rerender } = renderHook((p) => useRegistroItensEscondidos(p), { initialProps: base });
    rerender({ ...base, visiveis: [pub(pilsen)], semEstoque: new Map([['i2', [{ id: 'x', nome: 'Barril', estoque: 0, unidade: 'L' }]]]) });
    expect(reportError.mock.calls[0][0]).toBe('Tablet escondeu "1 chope Vinho": estoque (insumo zerado)');
  });

  it('na primeira carga só avisa item ligado que não aparece', () => {
    const desligado = item('i3', '2 chopes Vinho', { status: 'inativo' });
    const base = entrada([pilsen, vinho, desligado]);
    renderHook((p) => useRegistroItensEscondidos(p), { initialProps: { ...base, visiveis: [pub(pilsen)] } });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toBe('Tablet escondeu "1 chope Vinho": motivo desconhecido (estava no cardápio público)');
  });
});
