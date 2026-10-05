// Casca nova (2026-10-05): o catálogo único mostra só o que cada papel já via no menu antigo, a barra de
// baixo segue o papel (com troca pela próxima tela visível) e o "Ir para…" acha pelos apelidos.
import { describe, it, expect } from 'vitest';
import { DEFAULT_PERMISSOES, type Papel, type PermissaoKey } from '@/hooks/usePermissoes';
import type { ModuloLivre } from '@/hooks/useModuleAccess';
import { ADMIN_MASTER_EMAIL, TELAS, GRUPOS, filtrarProdutos, filtrarTelas, type ContextoTelas } from '@/constants/telas';
import { buscarTelas, grupoDaRota, montarBarra, telaDaRota } from '@/lib/casca';

const ctx = (perfil: Papel, extra: Partial<ContextoTelas> = {}, modulos: ModuloLivre[] = [], tirar: PermissaoKey[] = []): ContextoTelas => {
  const ks = new Set<PermissaoKey>(DEFAULT_PERMISSOES[perfil]);
  tirar.forEach((k) => ks.delete(k));
  return { perfil, email: 'alguem@loja.com', pode: (k) => ks.has(k), modulo: (m) => modulos.includes(m), ...extra };
};
const ids = (c: ContextoTelas) => filtrarTelas(c).map((t) => t.id);

describe('catálogo de telas', () => {
  it('tem 6 grupos, ids e rotas sem repetir, e nenhum produto à parte', () => {
    expect(GRUPOS.map((g) => g.id)).toEqual(['hoje', 'loja', 'cozinha', 'dinheiro', 'clientes', 'equipe']);
    expect(new Set(TELAS.map((t) => t.id)).size).toBe(TELAS.length);
    expect(new Set(TELAS.map((t) => t.rota)).size).toBe(TELAS.length);
    for (const r of ['/tarefas', '/contratacao', '/notas-servico']) expect(TELAS.some((t) => t.rota.startsWith(r))).toBe(false);
  });

  it('Assistente e Admin Master só para o dono', () => {
    expect(ids(ctx('admin'))).not.toContain('admin-master');
    expect(ids(ctx('admin'))).not.toContain('assistente');
    const dono = ids(ctx('admin', { email: ADMIN_MASTER_EMAIL }));
    expect(dono).toEqual(expect.arrayContaining(['admin-master', 'assistente']));
  });

  it('caixa não vê Financeiro, Usuários nem Configurações', () => {
    const c = ids(ctx('caixa'));
    for (const id of ['financeiro', 'usuarios', 'configuracoes', 'auditoria', 'trafego-pago']) expect(c).not.toContain(id);
    expect(c).toContain('hoje');
  });

  it('papel preso ao Financeiro só vê o Financeiro (nem a Hoje)', () => {
    expect(ids(ctx('financeiro'))).toEqual(['financeiro']);
  });

  it('terminal desligado na loja e Visão da Cozinha somem', () => {
    expect(ids(ctx('admin', { pdvConfig: { garcom: false } }))).not.toContain('pdv-garcom');
    expect(ids(ctx('admin'))).toContain('pdv-garcom');
    const soKds = ids(ctx('admin', { kitchenView: 'kds' }));
    expect(soKds).toContain('kds');
    expect(soKds).not.toContain('gestor-pedidos');
    const nenhum = ids(ctx('admin', { kitchenView: 'nenhum' }));
    expect(nenhum).not.toContain('kds');
    expect(nenhum).not.toContain('gestor-pedidos');
  });

  it('Gestor de Entregas: só os papéis do card de /modulos e só com PDV', () => {
    expect(ids(ctx('caixa'))).toContain('gestor-entregas');
    expect(ids(ctx('garcom'))).not.toContain('gestor-entregas');
    expect(ids(ctx('admin', { temPdv: false }))).not.toContain('gestor-entregas');
  });

  it('Comparar lojas só para quem vê o Dashboard em 2+ lojas', () => {
    expect(ids(ctx('admin'))).not.toContain('lojas');
    expect(ids(ctx('admin', { veCompararLojas: true }))).toContain('lojas');
  });

  it('permissão tirada da pessoa tira a tela', () => {
    expect(ids(ctx('gerente', {}, [], ['gestao_dashboard']))).not.toContain('dashboard');
  });

  it('produtos: Loja + módulos liberados; papel preso não ganha outros', () => {
    expect(filtrarProdutos(ctx('admin', {}, ['tarefas', 'nfse']), true).map((p) => p.id)).toEqual(['loja', 'tarefas', 'nfse']);
    expect(filtrarProdutos(ctx('caixa'), true).map((p) => p.id)).toEqual(['loja']);
    expect(filtrarProdutos(ctx('financeiro', {}, ['tarefas']), true).map((p) => p.id)).toEqual(['loja']);
  });
});

describe('barra de baixo', () => {
  const barra = (p: Papel, c = ctx(p)) => montarBarra(p, filtrarTelas(c)).map((b) => b.tela.id);

  it('dono e Supervisor: Hoje · Dashboard · + · Financeiro', () => {
    expect(barra('admin')).toEqual(['hoje', 'dashboard', 'lancar', 'financeiro']);
    expect(barra('gerente')).toEqual(['hoje', 'dashboard', 'lancar', 'financeiro']);
  });

  it('Líder: Hoje · Caixa · + · Pedidos', () => {
    const c = ctx('supervisao', {}, [], []);
    const visiveis = filtrarTelas({ ...c, pode: (k) => k === 'gestao_pedidos' || c.pode(k) });
    expect(montarBarra('supervisao', visiveis).map((b) => b.tela.id)).toEqual(['hoje', 'pdv-caixa', 'lancar', 'pedidos']);
  });

  it('Caixa: Caixa · Hoje · + · Recebimentos (com rótulos curtos)', () => {
    const c = ctx('caixa', {}, [], []);
    const visiveis = filtrarTelas({ ...c, pode: (k) => k === 'estoque_receber' || c.pode(k) });
    const b = montarBarra('caixa', visiveis);
    expect(b.map((x) => x.tela.id)).toEqual(['pdv-caixa', 'hoje', 'lancar', 'receber']);
    expect(b.map((x) => x.rotulo)).toEqual(['Caixa', 'Hoje', 'Lançar', 'Recebimentos']);
    expect(b[2].meio).toBe(true);
  });

  it('tela sem permissão vira a próxima visível do catálogo, sem repetir', () => {
    const b = barra('gerente', ctx('gerente', {}, [], ['gestao_dashboard']));
    expect(b).toHaveLength(4);
    expect(b).not.toContain('dashboard');
    expect(new Set(b).size).toBe(4);
    expect(b[0]).toBe('hoje');
  });

  it('papel preso ao Financeiro: só o Financeiro (sem o + e sem repetir)', () => {
    expect(barra('financeiro')).toEqual(['financeiro']);
  });
});

describe('Ir para… e tela atual', () => {
  const todas = filtrarTelas(ctx('admin', { email: ADMIN_MASTER_EMAIL }));
  const primeiro = (q: string) => buscarTelas(q, todas)[0]?.id;

  it('acha pelos apelidos do dono', () => {
    expect(primeiro('caixa')).toBe('pdv-caixa');
    expect(primeiro('boleto')).toBe('financeiro');
    expect(primeiro('contar')).toBe('estoque');
    expect(primeiro('vencidas')).toBe('financeiro');
    expect(primeiro('cardapio')).toBe('cardapio');
    expect(primeiro('Configuracoes')).toBe('configuracoes');
  });

  it('não acha tela que a pessoa não vê', () => {
    const caixa = filtrarTelas(ctx('caixa'));
    expect(buscarTelas('boleto', caixa).map((t) => t.id)).not.toContain('financeiro');
  });

  it('vazio devolve tudo; sem nada parecido, nada', () => {
    expect(buscarTelas('', todas)).toHaveLength(todas.length);
    expect(buscarTelas('xyzw', todas)).toHaveLength(0);
  });

  it('tela e grupo pela rota', () => {
    expect(telaDaRota('/financeiro')?.id).toBe('financeiro');
    expect(telaDaRota('/pdv/caixa')?.id).toBe('pdv-caixa');
    expect(telaDaRota('/pedidosx')).toBeNull();
    expect(grupoDaRota('/estoque')).toBe('cozinha');
    expect(grupoDaRota('/perfil')).toBe('hoje');
  });
});
