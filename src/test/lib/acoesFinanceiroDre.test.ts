import { describe, it, expect } from 'vitest';
import { montarOpcoesDre, dreParaPayBill, type DreCat } from '@/components/feature/assistente/acoes/financeiro/comum';
import type { DreGroup } from '@/hooks/useDreGroups';

const cat = (id: string, name: string, group_type: string, parent_id: string | null = null): DreCat => ({ id, name, group_type, parent_id });
const grupo = (key: string, label: string): DreGroup => ({ id: `g-${key}`, key, label, icon: 'ri-folder-line', standard: false });

describe('montarOpcoesDre (ações rápidas do Financeiro)', () => {
  it('só oferece grupos de despesa: receita, imposto e custo ficam de fora', () => {
    const r = montarOpcoesDre([
      cat('r1', 'Vendas', 'revenue'),
      cat('t1', 'Simples', 'tax'),
      cat('c1', 'Mercadoria', 'cost'),
      cat('e1', 'Aluguel', 'expense'),
    ], []);
    expect(r.map((g) => g.key)).toEqual(['expense']);
    const labels = r[0].opcoes.map((o) => o.label);
    expect(labels).toContain('Aluguel');
    expect(labels).not.toContain('Vendas');
    expect(labels).not.toContain('Mercadoria');
  });

  it('grupo sem categoria raiz com o mesmo nome aparece como opção do próprio grupo', () => {
    const r = montarOpcoesDre([cat('f1', 'Energia', 'fixas')], [grupo('fixas', 'Despesas fixas')]);
    const fixas = r.find((g) => g.key === 'fixas')!;
    expect(fixas.opcoes[0]).toEqual({ tipo: 'grupo', key: 'fixas', label: 'Despesas fixas' });
    expect(fixas.opcoes[1]).toMatchObject({ tipo: 'categoria', id: 'f1' });
  });

  it('grupo que já tem a raiz com o nome dele não duplica a opção', () => {
    const r = montarOpcoesDre([cat('e0', 'despesas operacionais', 'expense')], []);
    expect(r[0].opcoes).toEqual([{ tipo: 'categoria', id: 'e0', grupo: 'expense', label: 'despesas operacionais' }]);
  });

  it('subcategoria mostra o pai no rótulo', () => {
    const r = montarOpcoesDre([cat('p', 'Manutenção', 'expense'), cat('s', 'Geladeira', 'expense', 'p')], []);
    expect(r[0].opcoes.map((o) => o.label)).toContain('Manutenção › Geladeira');
  });

  it('payload do pay_bill: categoria por id, grupo por chave + nome', () => {
    expect(dreParaPayBill({ tipo: 'categoria', id: 'x', label: 'X', grupo: 'expense' })).toEqual({ dre_category_id: 'x' });
    expect(dreParaPayBill({ tipo: 'grupo', key: 'fixas', label: 'Despesas fixas' })).toEqual({ dre_group: 'fixas', dre_category_name: 'Despesas fixas' });
  });
});
