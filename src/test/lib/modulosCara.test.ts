// Página de Módulos nova (2026-10-05): qual cara cada pessoa vê, quais terminais o aparelho mostra (nunca
// mais que hoje), o "abrir sempre este neste aparelho" e o produto único / último usado de quem não tem loja.
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_PERMISSOES, type Papel, type PermissaoKey } from '@/hooks/usePermissoes';
import type { ContextoTelas } from '@/constants/telas';
import {
  CHAVE_APARELHO_FIXO, destinoAparelhoFixo, destinoProduto, escolherCara, gravarAparelhoFixo,
  gravarUltimoProduto, lerAparelhoFixo, lerUltimoProduto, resumoFila, soltarAparelhoFixo, terminaisDoAparelho,
} from '@/lib/modulosCara';

const ctx = (perfil: Papel, extra: Partial<ContextoTelas> = {}, tirar: PermissaoKey[] = [], dar: PermissaoKey[] = []): ContextoTelas => {
  const ks = new Set<PermissaoKey>(DEFAULT_PERMISSOES[perfil]);
  tirar.forEach((k) => ks.delete(k));
  dar.forEach((k) => ks.add(k));
  return { perfil, email: 'alguem@loja.com', pode: (k) => ks.has(k), modulo: () => false, ...extra };
};
const ids = (c: ContextoTelas) => terminaisDoAparelho(c).map((t) => (t.desligado ? `${t.id}:off` : t.id));

beforeEach(() => { localStorage.clear(); });

describe('escolherCara', () => {
  it('sem loja = só outro produto', () => {
    expect(escolherCara({ semLoja: true, email: null, perfil: null })).toBe('produto');
  });
  it('papéis de operação e login da loja = aparelho', () => {
    for (const p of ['caixa', 'cozinha', 'garcom']) expect(escolherCara({ semLoja: false, email: 'x@y.com', perfil: p })).toBe('aparelho');
    expect(escolherCara({ semLoja: false, email: 'gerente@elpatron.erpos.local', perfil: 'gerente' })).toBe('aparelho');
  });
  it('dono, supervisor, líder e financeiro = Todas as telas', () => {
    for (const p of ['admin', 'gerente', 'supervisao', 'financeiro']) expect(escolherCara({ semLoja: false, email: 'x@y.com', perfil: p })).toBe('todas');
  });
});

describe('terminaisDoAparelho', () => {
  it('caixa com tudo ligado: Caixa, Delivery, Gestor de Entregas e Autoatendimento; Garçom não', () => {
    const t = ids(ctx('caixa'));
    expect(t).toEqual(expect.arrayContaining(['pdv-caixa', 'pdv-delivery', 'gestor-entregas', 'autoatendimento']));
    expect(t).not.toContain('pdv-garcom');
  });
  it('garçom não vê Caixa, Delivery, Entregas nem Autoatendimento', () => {
    const t = ids(ctx('garcom'));
    expect(t).toContain('pdv-garcom');
    for (const x of ['pdv-caixa', 'pdv-delivery', 'gestor-entregas', 'autoatendimento']) expect(t).not.toContain(x);
  });
  it('terminal desligado em pdv_config some', () => {
    expect(ids(ctx('caixa', { pdvConfig: { delivery: false } }))).not.toContain('pdv-delivery');
    expect(ids(ctx('caixa', { pdvConfig: { autoatendimento: false } }))).not.toContain('autoatendimento');
  });
  it('KDS desligado na Visão da cozinha aparece apagado; sem a permissão, nem aparece', () => {
    const c = ctx('cozinha', { kitchenView: 'gestor' }, [], ['kds_acessar', 'gestor_pedidos_acessar']);
    expect(ids(c)).toEqual(expect.arrayContaining(['gestor-pedidos', 'kds:off']));
    const sem = ctx('cozinha', { kitchenView: 'gestor' }, ['kds_acessar'], ['gestor_pedidos_acessar']);
    expect(ids(sem).some((x) => x.startsWith('kds'))).toBe(false);
  });
  it('empresa sem PDV: nenhum terminal', () => {
    expect(ids(ctx('admin', { temPdv: false }))).toEqual([]);
  });
});

describe('aparelho fixo', () => {
  const terms = [{ rota: '/gestor-pedidos', desligado: false }, { rota: '/kds', desligado: true }];

  it('grava, lê e solta no localStorage', () => {
    expect(lerAparelhoFixo()).toBeNull();
    gravarAparelhoFixo({ tenantId: 't1', rota: '/gestor-pedidos' });
    expect(JSON.parse(localStorage.getItem(CHAVE_APARELHO_FIXO)!)).toEqual({ tenantId: 't1', rota: '/gestor-pedidos' });
    expect(lerAparelhoFixo()).toEqual({ tenantId: 't1', rota: '/gestor-pedidos' });
    soltarAparelhoFixo();
    expect(lerAparelhoFixo()).toBeNull();
  });
  it('valor estragado ou rota externa = sem fixo', () => {
    localStorage.setItem(CHAVE_APARELHO_FIXO, '{oops');
    expect(lerAparelhoFixo()).toBeNull();
    localStorage.setItem(CHAVE_APARELHO_FIXO, JSON.stringify({ tenantId: 't1', rota: 'https://x.com' }));
    expect(lerAparelhoFixo()).toBeNull();
  });
  it('só vai direto na mesma loja e se a pessoa ainda abre o terminal (ligado)', () => {
    expect(destinoAparelhoFixo({ tenantId: 't1', rota: '/gestor-pedidos' }, 't1', terms)).toBe('/gestor-pedidos');
    expect(destinoAparelhoFixo({ tenantId: 't1', rota: '/gestor-pedidos' }, 't2', terms)).toBeNull();
    expect(destinoAparelhoFixo({ tenantId: 't1', rota: '/kds' }, 't1', terms)).toBeNull();
    expect(destinoAparelhoFixo({ tenantId: 't1', rota: '/pdv/caixa' }, 't1', terms)).toBeNull();
    expect(destinoAparelhoFixo(null, 't1', terms)).toBeNull();
  });
});

describe('só outro produto', () => {
  const tarefas = { id: 'tarefas' as const, rota: '/tarefas' };
  const contratacao = { id: 'contratacao' as const, rota: '/contratacao' };

  it('um produto só: sempre direto nele (entrando ou voltando)', () => {
    expect(destinoProduto([tarefas], null, true)).toBe('/tarefas');
    expect(destinoProduto([tarefas], null, false)).toBe('/tarefas');
  });
  it('dois ou mais: ao entrar vai no último usado; voltando, mostra a escolha', () => {
    expect(destinoProduto([tarefas, contratacao], 'contratacao', true)).toBe('/contratacao');
    expect(destinoProduto([tarefas, contratacao], 'contratacao', false)).toBeNull();
    expect(destinoProduto([tarefas, contratacao], null, true)).toBeNull();
  });
  it('último usado que não está mais liberado: mostra a escolha', () => {
    expect(destinoProduto([tarefas, contratacao], 'nfse', true)).toBeNull();
  });
  it('nenhum produto: nada', () => {
    expect(destinoProduto([], 'tarefas', true)).toBeNull();
  });
  it('lembra o último por pessoa', () => {
    gravarUltimoProduto('u1', 'contratacao');
    expect(lerUltimoProduto('u1')).toBe('contratacao');
    expect(lerUltimoProduto('u2')).toBeNull();
    expect(lerUltimoProduto(null)).toBeNull();
  });
});

describe('resumoFila', () => {
  const agora = 1_000_000_000;
  const min = (m: number) => agora - m * 60_000;
  it('conta fila, atrasados (meta de 15 min) e entregas', () => {
    const r = resumoFila([
      { status: 'novo', criadoEm: min(2) },
      { status: 'preparo', criadoEm: min(20) },
      { status: 'pronto', criadoEm: min(5), destino: 'delivery' },
      { status: 'em_rota', criadoEm: min(30), destino: 'delivery' },
      { status: 'entregue', criadoEm: min(40) },
      { status: 'novo', criadoEm: min(50), isCancelled: true },
    ], agora);
    expect(r).toEqual({ fila: 3, atrasados: 1, saindo: 1, prontasParaSair: 1, entregasAndando: 2 });
  });
});
