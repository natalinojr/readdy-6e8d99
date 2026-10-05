// Casca nova (2026-10-05): menu do computador abre só o grupo da tela atual, a barra de baixo segue o papel e o
// "Ir para…" navega pelo catálogo com teclado.
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { DEFAULT_PERMISSOES, type PermissaoKey } from '@/hooks/usePermissoes';
import { filtrarTelas, PRODUTOS } from '@/constants/telas';

const h = vi.hoisted(() => ({
  auth: {
    user: { id: 'u1', nome: 'Natalino', email: 'x@y.com', perfil: 'admin', loja: 'Loja Teste', tenantId: 't1' },
    canSwitchTenant: false, switchTenant: () => {}, logout: () => {},
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/contexts/AprovacoesContext', () => ({ useAprovacoes: () => ({ pendentesCount: 3 }) }));

import MenuNovo from '@/components/feature/casca/MenuNovo';
import BarraInferior from '@/components/feature/casca/BarraInferior';
import IrPara from '@/components/feature/casca/IrPara';

const ks = new Set<PermissaoKey>(DEFAULT_PERMISSOES.admin);
const telas = filtrarTelas({ perfil: 'admin', email: 'x@y.com', pode: (k) => ks.has(k), modulo: () => true });

function Rota() {
  const l = useLocation();
  return <span data-testid="rota">{l.pathname}</span>;
}
const comRota = (ui: ReactNode, inicio = '/estoque') => render(
  <MemoryRouter initialEntries={[inicio]}>
    {ui}
    <Routes><Route path="*" element={<Rota />} /></Routes>
  </MemoryRouter>,
);

describe('casca nova', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

  it('menu: só o grupo da tela atual aberto; clique abre outro', () => {
    comRota(<MenuNovo telas={telas} produtos={PRODUTOS} numeroHoje={5} />, '/estoque');
    expect(screen.getByRole('link', { name: /Estoque/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Financeiro/ })).toBeNull();
    // Grupo Hoje fechado mostra o número da Hoje
    expect(screen.getByRole('button', { name: /^Hoje/ })).toHaveTextContent('5');
    fireEvent.click(screen.getByRole('button', { name: /Dinheiro/ }));
    expect(screen.getByRole('link', { name: /^Financeiro/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Estoque/ })).toBeNull();
    // Seletor de produto (dono tem os 4)
    expect(screen.getByRole('button', { name: /Notas/ })).toBeInTheDocument();
  });

  it('barra do dono: Hoje · Dashboard · Lançar · Financeiro · Mais', () => {
    comRota(<BarraInferior telas={telas} numeroHoje={2} maisAberto={false} onMais={() => {}} />, '/hoje');
    const nomes = screen.getAllByRole('button').map((b) => b.textContent);
    expect(nomes).toEqual(['Hoje2', 'Dashboard', 'Lançar', 'Financeiro', 'Mais']);
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    expect(screen.getByTestId('rota')).toHaveTextContent('/lancar');
    expect(document.documentElement.dataset.cascaBarra).toBe('1');
  });

  it('Ir para…: "boleto" + Enter abre o Financeiro', () => {
    const fechar = vi.fn();
    comRota(<IrPara telas={telas} produtos={PRODUTOS} onFechar={fechar} />, '/hoje');
    const campo = screen.getByLabelText('Buscar tela');
    fireEvent.change(campo, { target: { value: 'boleto' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(fechar).toHaveBeenCalled();
    expect(screen.getByTestId('rota')).toHaveTextContent('/financeiro');
  });
});
