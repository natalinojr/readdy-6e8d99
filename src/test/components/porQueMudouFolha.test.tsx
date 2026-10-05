// "Por que mudou?" (2026-10-05): a folha lê os fatos do banco e escreve as frases por regra; sem causa, diz que não achou.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/lib/voltarAndroid', () => ({ useVoltarFecha: () => undefined }));

import PorQueMudouFolha, { type PropsPorQue } from '@/components/feature/PorQueMudouFolha';

const fatos = (o: Record<string, unknown> = {}) => ({
  janela: { de: '2026-10-02T03:00:00Z', ate: '2026-10-03T03:00:00Z' },
  canais: { atual: { cashier: { valor: 38, pedidos: 1 }, self_service: { valor: 900, pedidos: 28 } }, anterior: { cashier: { valor: 299, pedidos: 7 }, self_service: { valor: 1010, pedidos: 31 } } },
  aberturas: { atual: [{ dia: '2026-10-02', ini: '2026-10-02T14:40:00Z' }], anterior: [{ dia: '2026-09-25', ini: '2026-09-25T14:50:00Z' }] },
  pausas: [],
  ...o,
});
const props = (o: Partial<PropsPorQue> = {}): PropsPorQue => ({
  aberta: true, onFechar: vi.fn(), tenantId: 'par',
  periodo: { d1: '2026-10-02', d2: '2026-10-02', c1: '2026-09-25', c2: '2026-09-25', corte: null },
  rotulo: 'sex passada', umDia: true,
  atual: { faturamento: 938, pedidos: 29 }, anterior: { faturamento: 1309, pedidos: 38 },
  serieAtual: null, serieAnterior: null, horaCorte: null, ifood: null,
  ...o,
});
const t = (el: HTMLElement) => (el.textContent ?? '').replace(/ /g, ' ');

describe('PorQueMudouFolha', () => {
  beforeEach(() => h.rpc.mockReset());

  it('chama a RPC com o dia da loja e escreve título e frase de canal', async () => {
    h.rpc.mockResolvedValue({ data: fatos(), error: null });
    const { container } = render(<PorQueMudouFolha {...props()} />);
    expect(await screen.findByText(/contra sex passada: 9 pedidos a menos/)).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith('fn_por_que_mudou', { p_tenant: 'par', p_d1: '2026-10-02', p_d2: '2026-10-02', p_c1: '2026-09-25', p_c2: '2026-09-25', p_corte: null });
    expect(t(container.ownerDocument.body)).toContain('Balcão');
    // abertura igual (menos de 30 min) e nenhum item pausado: não achou causa
    expect(screen.getByText(/Não achei a causa nos registros/)).toBeInTheDocument();
  });

  it('item pausado vira a causa e a frase "não achei" some', async () => {
    h.rpc.mockResolvedValue({ data: fatos({ pausas: [{ item: '1 chope Vinho 500 ml', de: '2026-10-02T23:00:00Z', ate: '2026-10-03T01:40:00Z', pausou_em: '2026-10-02T23:00:00Z', retomou_em: '2026-10-03T01:40:00Z', minutos: 160, sem_retomada: false, vendeu_no_comparado: 3 }] }), error: null });
    render(<PorQueMudouFolha {...props()} />);
    expect(await screen.findByText(/1 chope Vinho 500 ml \(de 20h00 a 22h40; vendeu 3 no mesmo trecho de sex passada\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Não achei a causa nos registros/)).toBeNull();
  });

  it('se a consulta falhar, avisa o que não leu e não afirma que não há causa', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    render(<PorQueMudouFolha {...props()} />);
    expect(await screen.findByText(/Não deu para ler agora: canal, hora de abertura do caixa e itens pausados/)).toBeInTheDocument();
    expect(screen.queryByText(/Não achei a causa nos registros/)).toBeNull();
  });

  it('fechada, não consulta nada', () => {
    render(<PorQueMudouFolha {...props({ aberta: false })} />);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
