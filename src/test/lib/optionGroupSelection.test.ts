import { describe, it, expect } from 'vitest';
import {
  minExigidoGrupo,
  maxPermitidoGrupo,
  toggleOpcaoGrupo,
  primeiroGrupoFaltando,
  mensagemGrupoFaltando,
} from '@/lib/optionGroupSelection';

const op = (nome: string) => ({ nome });

describe('optionGroupSelection', () => {
  it('mínimo: obrigatório exige ao menos 1; opcional usa min', () => {
    expect(minExigidoGrupo({ grupo: 'A', obrigatorio: true, minSelecao: 0 })).toBe(1);
    expect(minExigidoGrupo({ grupo: 'A', obrigatorio: true, minSelecao: 2 })).toBe(2);
    expect(minExigidoGrupo({ grupo: 'A', obrigatorio: false, minSelecao: null })).toBe(0);
  });

  it('máximo: null = 1, 0 = sem limite', () => {
    expect(maxPermitidoGrupo({ grupo: 'A', obrigatorio: false })).toBe(1);
    expect(maxPermitidoGrupo({ grupo: 'A', obrigatorio: false, maxSelecao: 0 })).toBe(Infinity);
  });

  it('máx 1 troca a seleção', () => {
    const g = { grupo: 'Ponto', obrigatorio: true, minSelecao: 1, maxSelecao: 1 };
    const r = toggleOpcaoGrupo([op('Mal')], op('Bem'), g);
    expect(r.selecao.map((o) => o.nome)).toEqual(['Bem']);
    expect(r.bloqueado).toBe(false);
    // tocar de novo na obrigatória mantém
    expect(toggleOpcaoGrupo([op('Bem')], op('Bem'), g).selecao).toHaveLength(1);
    // opcional máx 1: tocar de novo desmarca
    expect(toggleOpcaoGrupo([op('Bem')], op('Bem'), { ...g, obrigatorio: false }).selecao).toHaveLength(0);
  });

  it('obrigatório máx 2 permite 2 e bloqueia a 3ª', () => {
    const g = { grupo: 'Molhos', obrigatorio: true, minSelecao: 1, maxSelecao: 2 };
    let sel = toggleOpcaoGrupo([], op('A'), g).selecao;
    sel = toggleOpcaoGrupo(sel, op('B'), g).selecao;
    expect(sel.map((o) => o.nome)).toEqual(['A', 'B']);
    const r = toggleOpcaoGrupo(sel, op('C'), g);
    expect(r.bloqueado).toBe(true);
    expect(r.selecao.map((o) => o.nome)).toEqual(['A', 'B']);
    expect(toggleOpcaoGrupo(sel, op('A'), g).selecao.map((o) => o.nome)).toEqual(['B']);
  });

  it('opcional máx 3 bloqueia a 4ª', () => {
    const g = { grupo: 'Adicionais', obrigatorio: false, minSelecao: 0, maxSelecao: 3 };
    const r = toggleOpcaoGrupo([op('A'), op('B'), op('C')], op('D'), g);
    expect(r.bloqueado).toBe(true);
    expect(r.selecao).toHaveLength(3);
  });

  it('grupo faltando some quando o mínimo é atingido', () => {
    const grupos = [
      { grupo: 'Adicionais', obrigatorio: false, minSelecao: 0, maxSelecao: 5 },
      { grupo: 'Molhos', obrigatorio: true, minSelecao: 2, maxSelecao: 3 },
    ];
    expect(primeiroGrupoFaltando(grupos, {})?.grupo).toBe('Molhos');
    expect(mensagemGrupoFaltando(grupos[1])).toBe('Escolha: Molhos (mínimo 2)');
    expect(primeiroGrupoFaltando(grupos, { Molhos: [op('A')] })?.grupo).toBe('Molhos');
    expect(primeiroGrupoFaltando(grupos, { Molhos: [op('A'), op('B')] })).toBeNull();
  });
});
