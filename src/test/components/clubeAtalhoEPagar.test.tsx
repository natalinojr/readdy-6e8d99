// Atalho do clube no topo do QR/delivery e o "Pagar" da faixa da senha, que some quando a
// conta já foi paga (pelo app ou no caixa).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({ clubeChamar: vi.fn(), token: null as string | null }));
vi.mock('@/lib/clubePublico', () => ({
  clubeChamar: h.clubeChamar,
  clubeTokenSalvo: () => h.token,
}));

import BotaoClubeLoja from '@/components/cliente/BotaoClubeLoja';
import { useContaAbertaQR } from '@/pages/mesa-qr/useContaAbertaQR';

const programa = { nome: 'Clube Vila', pontos: { bonus_cadastro: 20 }, niveis: [], recompensas: [], janela_dias: 90, roleta: null };

describe('Atalho do clube nas telas do cliente', () => {
  beforeEach(() => { h.clubeChamar.mockReset(); h.token = null; });

  it('loja com clube: convite com bônus e link para /clube/<loja> em outra aba', async () => {
    h.clubeChamar.mockResolvedValue({ ativo: true, loja: { slug: 'vila' }, programa });
    render(<BotaoClubeLoja tenantId="t-1" />);
    const link = await screen.findByRole('link');
    expect(link.getAttribute('href')).toBe('/clube/vila');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toContain('Clube Vila');
    expect(link.textContent).toContain('Entre e ganhe 20 pontos');
    expect(h.clubeChamar).toHaveBeenCalledWith({ action: 'programa', tenant_id: 't-1' });
  });

  it('quem já tem o cartão do clube no aparelho vê "Meus pontos"', async () => {
    h.token = 'tok';
    h.clubeChamar.mockResolvedValue({ ativo: true, loja: { slug: 'vila' }, programa });
    render(<BotaoClubeLoja tenantId="t-2" />);
    expect((await screen.findByRole('link')).textContent).toContain('Meus pontos no clube');
  });

  it('loja sem clube ativo: não mostra nada', async () => {
    h.clubeChamar.mockResolvedValue({ ativo: false, programa: null });
    const { container } = render(<BotaoClubeLoja tenantId="t-3" />);
    await waitFor(() => expect(h.clubeChamar).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});

describe('Faixa da senha: botão Pagar', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const resposta = (body: unknown) => ({ json: () => Promise.resolve(body) });
  const part = { id: 'p1', access_token: '300' };

  it('tudo pago (app ou caixa): conta fechada → esconde o Pagar', async () => {
    fetchMock.mockResolvedValue(resposta({ orders: [{ remaining: 0, is_paid: true }], pending_pix: null, pending_card: null }));
    const { result } = renderHook(() => useContaAbertaQR(part, true, 'entregue:300'));
    await waitFor(() => expect(result.current.aberta).toBe(false));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'get_bill', participant_id: 'p1', access_token: '300' });
  });

  it('falta pagar um pedido → mostra o Pagar', async () => {
    fetchMock.mockResolvedValue(resposta({ orders: [{ remaining: 0, is_paid: true }, { remaining: 25.9, is_paid: false }] }));
    const { result } = renderHook(() => useContaAbertaQR(part, true, 'recebido:301'));
    await waitFor(() => expect(result.current.aberta).toBe(true));
    expect(result.current.falta).toBe(25.9);
  });

  it('Pix em andamento conta como aberto (o cliente volta para ele)', async () => {
    fetchMock.mockResolvedValue(resposta({ orders: [{ remaining: 0, is_paid: true }], pending_pix: { id: 'x' } }));
    const { result } = renderHook(() => useContaAbertaQR(part, true, 'k'));
    await waitFor(() => expect(result.current.aberta).toBe(true));
  });

  it('erro ou sem resposta: não sabe (null) e o botão continua', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useContaAbertaQR(part, true, 'k'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.aberta).toBeNull();
  });
});

describe('Tela da senha logo depois de pedir: pagar já', () => {
  const base = {
    accessToken: '300', numeroPedido: 'P1010260001', onNovoPedido: () => {}, confirmedCartItems: [], cardapioItems: [],
    tenantId: 't-1', participantId: 'p1', queueMode: true, nomeCliente: 'Junior',
  };

  it('pedido já na cozinha + conta em aberto: oferece "Pagar agora" com o que falta', async () => {
    const { default: ConfirmacaoMesaQR } = await import('@/pages/mesa-qr/components/ConfirmacaoMesaQR');
    const pagar = vi.fn();
    render(<ConfirmacaoMesaQR {...base} onPagarAgora={pagar} contaAberta faltaPagar={25.9} />);
    const botao = screen.getByRole('button', { name: /Pagar agora/ });
    expect(botao.textContent).toContain('25,90');
    botao.click();
    expect(pagar).toHaveBeenCalled();
  });

  it('já pago (ou loja sem pagamento online): não oferece', async () => {
    const { default: ConfirmacaoMesaQR } = await import('@/pages/mesa-qr/components/ConfirmacaoMesaQR');
    const { rerender } = render(<ConfirmacaoMesaQR {...base} onPagarAgora={() => {}} contaAberta={false} />);
    expect(screen.queryByRole('button', { name: /Pagar agora/ })).toBeNull();
    rerender(<ConfirmacaoMesaQR {...base} contaAberta />);
    expect(screen.queryByRole('button', { name: /Pagar agora/ })).toBeNull();
  });
});
