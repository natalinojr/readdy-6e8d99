// Folha "O que aconteceu?" (2026-10-03): navega pergunta → tela que já existe, pula pergunta com um
// caminho só e mostra a lista completa onde ela existe. E a sangria do PDV abrindo com o tipo marcado.
// Permissões e servidor falsos; nada vai para produção.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ContextoAcesso } from '@/components/feature/assistente/acoes/acesso';
import { DEFAULT_PERMISSOES, type Papel, type PermissaoKey } from '@/hooks/usePermissoes';

const h = vi.hoisted(() => ({ ctx: null as unknown as ContextoAcesso, invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ invokeWithAuth: h.invoke, supabase: {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 't1', nome: 'Teste', perfil: 'caixa' } }) }));
vi.mock('@/components/feature/assistente/acoes/acesso', async (original) => ({
  ...(await original<typeof import('@/components/feature/assistente/acoes/acesso')>()),
  useAcessoAcoes: () => ({ ...h.ctx, carregando: false }),
}));
vi.mock('@/contexts/SessaoContext', () => ({ useSessao: () => ({ caixa: { id: 'cx1' } }) }));
vi.mock('@/contexts/AuditoriaContext', () => ({ useAuditoria: () => ({ registrarEvento: vi.fn() }) }));
vi.mock('@/hooks/useCaixaPing', () => ({ useCaixaPing: () => {} }));
vi.mock('@/components/base/Dialogos', () => ({ confirmar: vi.fn() }));

import OQueAconteceu from '@/components/feature/lancar/OQueAconteceu';
import SangriaSuprimentoModal from '@/pages/pdv/caixa/components/SangriaSuprimentoModal';

const ctx = (perfil: Papel, mais: PermissaoKey[] = []): ContextoAcesso => {
  const ks = new Set<PermissaoKey>([...DEFAULT_PERMISSOES[perfil], ...mais]);
  return { perfil, pode: (k) => ks.has(k), modulo: () => false };
};
// Matriz da Paranaguá em 03/10
const supervisaoPar = ctx('supervisao', ['estoque_receber', 'estoque_movimentar', 'pag_fornecedor', 'pag_freelancer', 'pag_reembolso']);
const caixaPar = ctx('caixa', ['estoque_receber', 'estoque_movimentar', 'pag_fornecedor']);

const fechar = vi.fn();
const navegar = vi.fn();
const lista = vi.fn();
function abrir(c: ContextoAcesso, comLista = false) {
  h.ctx = c;
  render(<MemoryRouter><OQueAconteceu onFechar={fechar} onNavegar={navegar} onListaCompleta={comLista ? lista : undefined} /></MemoryRouter>);
}

beforeEach(() => { fechar.mockReset(); navegar.mockReset(); lista.mockReset(); });

describe('O que aconteceu?', () => {
  it('supervisão: "Tenho que pagar alguém" pergunta quem, e fornecedor vira pedido para o dono aprovar', () => {
    abrir(supervisaoPar);
    expect(screen.getByText('O que aconteceu?')).toBeTruthy();
    for (const t of ['Paguei algo', 'Chegou mercadoria', 'Recebi uma nota ou boleto', 'Tenho que pagar alguém', 'Gastei do meu bolso']) expect(screen.getByText(t)).toBeTruthy();
    fireEvent.click(screen.getByText('Tenho que pagar alguém'));
    expect(screen.getByText('Quem você tem que pagar?')).toBeTruthy();
    expect(screen.getAllByText('o Administrador aprova').length).toBe(2);
    fireEvent.click(screen.getByText('Fornecedor ou serviço'));
    expect(fechar).toHaveBeenCalled();
    expect(navegar).toHaveBeenCalledWith('/receber?pedido=fornecedor');
  });

  it('caixa da Paranaguá: um caminho só vai direto, sem perguntar', () => {
    abrir(caixaPar);
    expect(screen.queryByText('Gastei do meu bolso')).toBeNull();
    fireEvent.click(screen.getByText('Tenho que pagar alguém'));
    expect(navegar).toHaveBeenCalledWith('/receber?pedido=fornecedor');
  });

  it('voltar sobe uma pergunta; a lista completa só aparece onde foi pedida', () => {
    abrir(ctx('admin'), true);
    fireEvent.click(screen.getByText('Paguei algo'));
    fireEvent.click(screen.getByText('Uma despesa'));
    expect(screen.getByText('Saiu de onde o dinheiro?')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Voltar'));
    expect(screen.getByText('O que você pagou?')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Voltar'));
    fireEvent.click(screen.getByText('Ver todos os jeitos de lançar (lista completa)'));
    expect(lista).toHaveBeenCalled();
  });

  it('cupom de mercado abre o Recebimentos já com o leitor', () => {
    abrir(supervisaoPar);
    fireEvent.click(screen.getByText('Recebi uma nota ou boleto'));
    fireEvent.click(screen.getByText('Cupom de mercado'));
    expect(navegar).toHaveBeenCalledWith('/receber?receber=cupom');
  });
});

describe('Sangria com o tipo vindo do link', () => {
  beforeEach(() => {
    h.invoke.mockReset();
    h.invoke.mockImplementation((_fn: string, { body }: { body: { action: string } }) => {
      if (body.action === 'list_freelancers') return Promise.resolve({ data: { data: [{ id: 'f1', name: 'Marcelle', daily_rate: 100 }] } });
      return Promise.resolve({ data: { data: [] } });
    });
  });
  it('abre já em Freelancer', async () => {
    render(<SangriaSuprimentoModal motivoInicial="Freelancer" historico={[]} onRegistrar={() => {}} onClose={() => {}} />);
    expect(await screen.findByDisplayValue('Escolha o freelancer...')).toBeTruthy();
  });
});
