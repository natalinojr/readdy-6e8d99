// Convite da primeira vez para ligar os avisos no celular (ConviteAvisos, 2026-09-24).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ estado: 'inativo', ativar: vi.fn(), celular: true }));
vi.mock('@/lib/push', () => ({
  estadoPush: () => Promise.resolve(h.estado),
  ativarPush: (...a: unknown[]) => h.ativar(...a),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', tenantId: 'loja-1' } }) }));

import ConviteAvisos from '@/components/feature/ConviteAvisos';

beforeEach(() => {
  h.estado = 'inativo';
  h.celular = true;
  h.ativar.mockReset().mockResolvedValue({ ok: true });
  localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: q.includes('coarse') ? h.celular : false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

describe('Convite para ativar os avisos', () => {
  it('no celular sem avisos: aparece e o botão ativa (e o cartão some)', async () => {
    const user = userEvent.setup();
    render(<ConviteAvisos />);
    expect(await screen.findByText('Receba as mensagens da equipe no celular')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Ativar avisos/ }));
    expect(h.ativar).toHaveBeenCalledWith('loja-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('"Agora não" esconde e não volta antes de 3 dias', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ConviteAvisos />);
    await user.click(await screen.findByRole('button', { name: 'Agora não' }));
    expect(screen.queryByText('Receba as mensagens da equipe no celular')).not.toBeInTheDocument();
    unmount();
    render(<ConviteAvisos />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Receba as mensagens da equipe no celular')).not.toBeInTheDocument();
  });

  it('aparelho já inscrito: não aparece', async () => {
    h.estado = 'ativo';
    render(<ConviteAvisos />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('no computador: não aparece', async () => {
    h.celular = false;
    render(<ConviteAvisos />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Receba as mensagens da equipe no celular')).not.toBeInTheDocument();
  });

  it('iPhone sem instalar: explica como adicionar à Tela de Início', async () => {
    h.estado = 'precisa-instalar';
    render(<ConviteAvisos />);
    expect(await screen.findByText(/Adicionar à Tela de Início/)).toBeVisible();
  });
});
