// Conversa com as pessoas da loja (equipe/, 2026-09-23) — contra um servidor falso da Edge chat-equipe.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  chamadas: [] as Array<{ action: string; body: Record<string, unknown> }>,
  conversas: [] as unknown[],
  mensagens: [] as Array<{ id: number; sender_id: string; body: string; created_at: string }>,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: () => undefined,
  },
  invokeWithAuth: vi.fn(async (_fn: string, { body }: { body: Record<string, unknown> }) => {
    const action = String(body.action);
    h.chamadas.push({ action, body });
    const ok = (data: unknown) => ({ data: { success: true, data }, error: null });
    switch (action) {
      case 'conversas': return ok({ conversas: h.conversas });
      case 'colegas': return ok({ colegas: [
        { id: 'u-ana', nome: 'Ana Souza', foto: null, papel: 'cashier' },
        { id: 'u-bia', nome: 'Beatriz', foto: null, papel: 'kitchen' },
      ] });
      case 'abrir': return ok({ thread_id: 't-ana', pessoa: { id: 'u-ana', nome: 'Ana Souza', foto: null } });
      case 'mensagens': return ok({ mensagens: h.mensagens, has_more: false, lido_pelo_outro: 0 });
      case 'enviar': return ok({ mensagem: { id: 99, sender_id: 'u-eu', body: body.text, created_at: new Date().toISOString() } });
      case 'lido': return ok({ last_read_id: body.id });
      default: return { data: { success: false, error: 'ação?' }, error: null };
    }
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-eu', nome: 'Eu', tenantId: 'loja-1' },
    availableTenants: [{ tenantId: 'loja-1', tenantName: 'Vila Leste', role: 'gerente' }],
  }),
}));

import { useEquipeNoChat } from '@/components/feature/equipe/useEquipeNoChat';
import { EVENTO_MSG_EQUIPE } from '@/components/feature/equipe/api';

function Painel() {
  const equipe = useEquipeNoChat({ abrirPainel: () => undefined });
  return (
    <div className="relative">
      <span data-testid="badge">{equipe.naoLidas}</span>
      {equipe.secao}
      {equipe.camada}
    </div>
  );
}
const renderPainel = (rota = '/modulos') => render(<MemoryRouter initialEntries={[rota]}><Painel /></MemoryRouter>);

beforeEach(() => {
  h.chamadas.length = 0;
  h.conversas = [];
  h.mensagens = [];
});

describe('Conversas com a equipe', () => {
  it('lista a conversa com a última mensagem e as não lidas (badge soma)', async () => {
    h.conversas = [{
      thread_id: 't-ana', loja: 'Vila Leste', pessoa: { id: 'u-ana', nome: 'Ana Souza', foto: null },
      lido_pelo_outro: 0, nao_lidas: 2, quando: new Date().toISOString(),
      ultima: { id: 5, minha: false, texto: 'Acabou o troco', created_at: new Date().toISOString() },
    }];
    renderPainel();
    expect(await screen.findByText('Acabou o troco')).toBeInTheDocument();
    expect(screen.getByLabelText('2 não lida(s)')).toBeInTheDocument();
    expect(screen.getByTestId('badge').textContent).toBe('2');
  });

  it('Nova conversa mostra as pessoas da loja; escolher abre a conversa e enviar grava', async () => {
    const user = userEvent.setup();
    renderPainel();
    await user.click((await screen.findAllByRole('button', { name: /Nova conversa/ }))[0]);
    expect(await screen.findByText('Beatriz')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Procurar pessoa'), 'ana');
    expect(screen.queryByText('Beatriz')).not.toBeInTheDocument();
    await user.click(screen.getByText('Ana Souza'));
    expect(h.chamadas.find((c) => c.action === 'abrir')?.body).toMatchObject({ tenant_id: 'loja-1', user_id: 'u-ana' });
    expect(await screen.findByText(/Diga um oi/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Mensagem'), 'Pode trazer o gelo?{Enter}');
    expect(await screen.findByText('Pode trazer o gelo?')).toBeInTheDocument();
    const envio = h.chamadas.find((c) => c.action === 'enviar')!;
    expect(envio.body).toMatchObject({ thread_id: 't-ana', text: 'Pode trazer o gelo?' });
    expect(String(envio.body.client_id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('mensagem que chega pelo Realtime aparece na conversa aberta e é marcada como lida', async () => {
    h.conversas = [{
      thread_id: 't-ana', loja: 'Vila Leste', pessoa: { id: 'u-ana', nome: 'Ana Souza', foto: null },
      lido_pelo_outro: 0, nao_lidas: 0, quando: new Date().toISOString(), ultima: null,
    }];
    const user = userEvent.setup();
    renderPainel();
    await user.click(await screen.findByText('Ana Souza'));
    await screen.findByText(/Diga um oi/);
    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_MSG_EQUIPE, {
        detail: { id: 7, thread_id: 't-ana', sender_id: 'u-ana', body: 'Chegou o fornecedor', created_at: new Date().toISOString() },
      }));
    });
    expect(await screen.findByText('Chegou o fornecedor')).toBeInTheDocument();
    await vi.waitFor(() => expect(h.chamadas.some((c) => c.action === 'lido' && c.body.id === 7)).toBe(true));
    // De outra conversa: não entra nesta.
    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_MSG_EQUIPE, {
        detail: { id: 8, thread_id: 't-outra', sender_id: 'u-bia', body: 'Outra conversa', created_at: new Date().toISOString() },
      }));
    });
    expect(screen.queryByText('Outra conversa')).not.toBeInTheDocument();
  });

  it('o link do aviso no celular (?conversa=) abre direto a conversa', async () => {
    h.conversas = [{
      thread_id: 't-ana', loja: 'Vila Leste', pessoa: { id: 'u-ana', nome: 'Ana Souza', foto: null },
      lido_pelo_outro: 0, nao_lidas: 1, quando: new Date().toISOString(), ultima: null,
    }];
    h.mensagens = [{ id: 3, sender_id: 'u-ana', body: 'Oi, tudo certo?', created_at: new Date().toISOString() }];
    renderPainel('/modulos?conversa=t-ana');
    expect(await screen.findByText('Oi, tudo certo?')).toBeInTheDocument();
    const cabecalho = screen.getByRole('button', { name: 'Voltar para as conversas' }).parentElement!;
    expect(await within(cabecalho).findByText('Ana Souza')).toBeInTheDocument();
  });
});
