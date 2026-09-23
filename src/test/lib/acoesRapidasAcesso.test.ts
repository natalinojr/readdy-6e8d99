// Quem vê cada ação rápida (2026-09-23): o menu segue a permissão da tela de onde a ação vem.
import { describe, it, expect } from 'vitest';
import { acaoLiberada, rotaLiberada, type ContextoAcesso } from '@/components/feature/assistente/acoes/acesso';
import { ACOES } from '@/components/feature/assistente/acoes';
import { DEFAULT_PERMISSOES, type Papel, type PermissaoKey } from '@/hooks/usePermissoes';
import type { ModuloLivre } from '@/hooks/useModuleAccess';

const ctx = (perfil: Papel, modulos: ModuloLivre[] = [], extra: PermissaoKey[] = []): ContextoAcesso => {
  const ks = new Set<PermissaoKey>([...DEFAULT_PERMISSOES[perfil], ...extra]);
  return { perfil, pode: (k) => ks.has(k), modulo: (m) => modulos.includes(m) };
};
const liberadas = (c: ContextoAcesso) => ACOES.filter((a) => acaoLiberada(a.id, c)).map((a) => a.id);

describe('ações rápidas por acesso', () => {
  it('toda ação registrada tem regra (sem regra, ninguém vê)', () => {
    const admin = ctx('admin', ['tarefas', 'contratacao', 'nfse']);
    expect(liberadas(admin)).toEqual(ACOES.map((a) => a.id));
    expect(acaoLiberada('acao-que-nao-existe', admin)).toBe(false);
  });

  it('caixa vê o que o caixa faz, sem financeiro nem estoque', () => {
    const ids = liberadas(ctx('caixa'));
    expect(ids).toEqual(expect.arrayContaining(['caixa-aberto', 'pausar-delivery', 'clima']));
    expect(ids).not.toContain('lancar-despesa');
    expect(ids).not.toContain('registrar-perda');
    expect(ids).not.toContain('nova-tarefa');
    expect(ids).not.toContain('atalhos');
  });

  it('módulos por usuário: tarefas só com o módulo liberado', () => {
    expect(liberadas(ctx('garcom'))).not.toContain('nova-tarefa');
    expect(liberadas(ctx('garcom', ['tarefas']))).toEqual(expect.arrayContaining(['nova-tarefa', 'tarefas-hoje', 'atalhos']));
  });

  it('financeiro fica só com Admin/Gerente/Financeiro, mesmo com a chave', () => {
    expect(acaoLiberada('lancar-despesa', ctx('caixa', [], ['fin_despesas']))).toBe(false);
    expect(acaoLiberada('lancar-despesa', ctx('financeiro'))).toBe(true);
    // Gerente com a aba tirada perde a ação.
    const gerenteSemConc: ContextoAcesso = { ...ctx('gerente'), pode: (k) => k !== 'fin_conciliacao' && DEFAULT_PERMISSOES.gerente.includes(k) };
    expect(acaoLiberada('atualizar-conciliacao', gerenteSemConc)).toBe(false);
  });

  it('atalhos respeitam papel preso e abas do Financeiro', () => {
    const fin = ctx('financeiro');
    expect(rotaLiberada('/financeiro?tab=dre', fin)).toBe(true);
    expect(rotaLiberada('/estoque?tab=insumos', fin)).toBe(false);
    const tarefas = ctx('tarefas', ['tarefas']);
    expect(rotaLiberada('/tarefas', tarefas)).toBe(true);
    expect(rotaLiberada('/pedidos', tarefas)).toBe(false);
  });
});
