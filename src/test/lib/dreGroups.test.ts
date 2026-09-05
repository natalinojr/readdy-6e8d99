import { describe, it, expect } from 'vitest';
import { resolverGrupos, type DreGroup } from '@/hooks/useDreGroups';

const row = (key: string, label: string): DreGroup => ({
  id: `id-${key}`, key, label, icon: 'ri-folder-line', standard: false,
});

describe('resolverGrupos', () => {
  it('sem nada gravado devolve só os grupos embutidos oferecidos', () => {
    const { allGroups, customGroups } = resolverGrupos([]);
    expect(allGroups.map(g => g.key)).toEqual(['revenue', 'expense']);
    expect(customGroups).toEqual([]);
  });

  it('grupo da loja entra depois dos embutidos', () => {
    const { allGroups, customGroups } = resolverGrupos([row('despesas_fixas', 'Despesas fixas')]);
    expect(allGroups.map(g => g.key)).toEqual(['revenue', 'expense', 'despesas_fixas']);
    expect(customGroups.map(g => g.key)).toEqual(['despesas_fixas']);
  });

  // O grupo padrão renomeado não pode virar um segundo grupo na tela.
  it('renomear grupo padrão troca o rótulo sem duplicar o grupo', () => {
    const { allGroups, customGroups } = resolverGrupos([row('expense', 'Despesas do mês')]);
    expect(allGroups.map(g => g.key)).toEqual(['revenue', 'expense']);
    expect(allGroups.find(g => g.key === 'expense')?.label).toBe('Despesas do mês');
    // Não é grupo customizado: é apelido de um embutido.
    expect(customGroups).toEqual([]);
  });

  it('grupo padrão renomeado ganha id, que é como a tela oferece voltar ao padrão', () => {
    const { allGroups } = resolverGrupos([row('expense', 'Despesas do mês')]);
    expect(allGroups.find(g => g.key === 'expense')?.id).toBe('id-expense');
    expect(allGroups.find(g => g.key === 'revenue')?.id).toBeUndefined();
  });

  it('grupo aposentado só aparece na lista com legado, e aceita apelido', () => {
    const { allGroups, gruposComLegado } = resolverGrupos([row('cost', 'Mercadoria')]);
    expect(allGroups.map(g => g.key)).not.toContain('cost');
    expect(gruposComLegado.find(g => g.key === 'cost')?.label).toBe('Mercadoria');
  });
});
