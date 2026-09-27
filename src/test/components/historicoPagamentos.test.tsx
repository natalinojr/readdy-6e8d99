// Histórico de solicitações de pagamento no Financeiro (HistoricoPagamentos) — Edge falsa em memória.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistoricoPagamentos, { type PagamentoHistorico } from '@/components/feature/assistente/HistoricoPagamentos';

const base = (x: Partial<PagamentoHistorico>): PagamentoHistorico => ({
  id: 'p1', kind: 'pix', amount: 100, beneficiary_name: 'Marcelle de Melo Martins', pix_key: 'marc…1234',
  due_date: null, description: null, status: 'paid', status_label: 'pago', error: null,
  created_at: '2026-09-26T21:45:00Z', paid_at: '2026-09-26T21:48:00Z', sent_at: '2026-09-26T21:45:30Z', updated_at: null,
  loja: 'El Patron Paranaguá', origem: 'app', substituido: false, linha_do_tempo: [], ...x,
});

describe('HistoricoPagamentos', () => {
  it('uma linha por solicitação, com status, detalhes e linha do tempo; filtro vai para a Edge', async () => {
    const pagos = [
      base({
        linha_do_tempo: [
          { at: '2026-09-26T21:45:30Z', texto: 'aguardando sua aprovação no app do Inter', canal: 'app' },
          { at: '2026-09-26T21:48:00Z', texto: 'pago', canal: 'telegram' },
        ],
      }),
      base({ id: 'p2', status: 'cancelled', status_label: 'cancelado', paid_at: null, created_at: '2026-09-26T21:40:00Z' }),
    ];
    const call = vi.fn(async (action: string, extra?: Record<string, unknown>) => {
      expect(action).toBe('payments_history');
      return { payments: extra?.filtro === 'pagos' ? [pagos[0]] : pagos, has_more: false } as never;
    });
    render(<HistoricoPagamentos call={call as never} onFechar={() => {}} onAcao={() => {}} />);

    expect(await screen.findByText('Pago')).toBeInTheDocument();
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
    expect(screen.getAllByText(/Pix R\$\s?100,00/)).toHaveLength(2);

    await userEvent.click(screen.getByText('Pago'));
    expect(screen.getByText('Linha do tempo')).toBeInTheDocument();
    expect(screen.getByText('Aguardando sua aprovação no app do Inter')).toBeInTheDocument();
    expect(screen.getAllByText('El Patron Paranaguá')).toHaveLength(2);
    expect(screen.getByText('Enviado ao Inter')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pagos' }));
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('payments_history', { filtro: 'pagos' }));
    await waitFor(() => expect(screen.queryByText('Cancelado')).not.toBeInTheDocument());
  });

  it('pedido esperando o PIN tem Pagar, que passa pelo chat', async () => {
    const onAcao = vi.fn();
    const p = base({ status: 'awaiting_pin', status_label: 'esperando o PIN', paid_at: null, sent_at: null });
    const call = vi.fn(async () => ({ payments: [p], has_more: false }) as never);
    render(<HistoricoPagamentos call={call as never} onFechar={() => {}} onAcao={onAcao} />);
    await userEvent.click(await screen.findByText('Esperando você pagar'));
    await userEvent.click(screen.getByRole('button', { name: /Pagar/ }));
    expect(onAcao).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'ok');
  });
});
