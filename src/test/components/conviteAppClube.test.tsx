// Convite "Baixe o app do clube" (delivery, mesa, checkout e tablet): só aparece quando a
// loja ligou o app, e leva a /clube/<loja>?instalar=1 (que abre o passo a passo de instalar).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ clubeApp: vi.fn() }));
vi.mock('@/lib/clubeApp', () => ({ clubeApp: h.clubeApp }));

import { ConviteAppCartao, ConviteAppLinha, ConviteAppQr } from '@/components/fidelidade/ConviteAppClube';

describe('Convite para baixar o app do clube', () => {
  beforeEach(() => h.clubeApp.mockReset());

  it('loja com o app ligado: cartão com o nome da loja e link para instalar', async () => {
    h.clubeApp.mockResolvedValue({ ativo: true, slug: 'loja-a', nome: 'Loja A', nome_curto: 'Loja A', icone: 'https://x/i.png' });
    render(<ConviteAppCartao tenantId="t-a" />);
    const link = await screen.findByRole('link');
    expect(link.textContent).toContain('Baixe o app do Loja A');
    expect(link.getAttribute('href')).toBe(`${window.location.origin}/clube/loja-a?instalar=1`);
    expect(h.clubeApp).toHaveBeenCalledWith({ action: 'app_resumo', tenant_id: 't-a' });
  });

  it('loja sem o app ligado: não mostra nada', async () => {
    h.clubeApp.mockResolvedValue({ ativo: false });
    const { container } = render(<><ConviteAppCartao tenantId="t-b" /><ConviteAppLinha tenantId="t-b" /></>);
    await waitFor(() => expect(h.clubeApp).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('tablet: QR com o link de instalar', async () => {
    h.clubeApp.mockResolvedValue({ ativo: true, slug: 'loja-c', nome: 'Loja C', nome_curto: 'C' });
    const { container } = render(<ConviteAppQr tenantId="t-c" />);
    await screen.findByText('Baixe o app do C');
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
