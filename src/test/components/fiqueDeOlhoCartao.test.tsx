// Cartão "Fique de olho" da tela Hoje (2026-10-05): lista as ocorrências com quem/hora/motivo, [Ver] abre a Auditoria
// filtrada e "Estou ciente" fecha a pendência (resolvida), sem passar por "Não vou fazer".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({}) }));

import FiqueDeOlho from '@/pages/hoje/FiqueDeOlho';
import { organizarHoje, type PendHoje } from '@/pages/hoje/organizar';

const item = (o: Record<string, unknown>) => ({
  id: 'x', ts: '2026-10-05T16:42:00Z', regra: 'desconto', titulo: 'Desconto de R$ 50,00', valor: 50, quem: 'Caixa', generico: true,
  autorizou: null, hora: '15:10', motivo: null, onde: null, ritmo: null, grupo: 'pedidos', busca: '50,00', ...o,
});
const pend = (itens: unknown[], extra: Record<string, unknown> = {}): PendHoje => ({
  id: 'p1', tenantId: 'par', loja: 'Paranaguá', kind: 'fique_de_olho', ref: '2026-10-05', titulo: 'x', detalhe: null, rota: '/auditoria',
  urgencia: 'normal', acaoRequerida: false, status: 'aberta', criadaEm: '2026-10-05T13:00:00Z', payload: { itens, dia: '2026-10-05', ja_vistos: 0, ...extra },
});
const cartoes = (p: PendHoje) => organizarHoje([p], '2026-10-05');

describe('Hoje › Fique de olho', () => {
  afterEach(cleanup);

  it('lista cada ocorrência com quem, hora, motivo e média; o mais novo em cima', () => {
    const p = pend([
      item({ id: 'a', titulo: 'Cancelou um pedido de R$ 187,00', regra: 'cancelamento', hora: '13:42', motivo: 'Erro no pedido', autorizou: 'Natalino Junior', grupo: 'pedidos', busca: null }),
      item({ id: 'b', titulo: 'Sangria de R$ 520,00', regra: 'sangria', hora: '16:05', motivo: 'diária freelancer', grupo: 'caixa', ritmo: '2ª sangria hoje no caixa · média 0,5 por dia' }),
    ]);
    render(<FiqueDeOlho itens={cartoes(p)} hoje="2026-10-05" mostrarLoja abrir={vi.fn()} marcar={vi.fn()} onMudou={vi.fn()} podeDarCiencia={() => true} />);
    expect(screen.getByText('2 coisas da equipe hoje')).toBeTruthy();
    expect(screen.getByText(/Caixa · autorizou Natalino Junior · 13:42 · motivo “Erro no pedido”/)).toBeTruthy();
    expect(screen.getByText(/Caixa · 16:05 · motivo “diária freelancer” · 2ª sangria hoje no caixa · média 0,5 por dia/)).toBeTruthy();
    const titulos = screen.getAllByText(/^(Cancelou|Sangria)/).map((e) => e.textContent);
    expect(titulos[0]).toMatch(/^Sangria/); // a de 16:05 (mais nova) vem primeiro
    expect(screen.getByText('Paranaguá')).toBeTruthy();
  });

  it('[Ver] abre a Auditoria filtrada na loja do cartão', () => {
    const abrir = vi.fn();
    render(<FiqueDeOlho itens={cartoes(pend([item({ id: 'b', titulo: 'Sangria de R$ 520,00', regra: 'sangria', grupo: 'caixa', busca: '520,00' })]))} hoje="2026-10-05" mostrarLoja={false} abrir={abrir} marcar={vi.fn()} onMudou={vi.fn()} podeDarCiencia={() => true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(abrir).toHaveBeenCalledWith('par', '/auditoria?grupo=caixa&busca=520%2C00');
  });

  it('"Estou ciente dos 2" fecha a pendência como resolvida e recarrega', async () => {
    const marcar = vi.fn().mockResolvedValue(undefined); const onMudou = vi.fn();
    render(<FiqueDeOlho itens={cartoes(pend([item({ id: 'a' }), item({ id: 'b', titulo: 'Desconto de R$ 60,00' })]))} hoje="2026-10-05" mostrarLoja={false} abrir={vi.fn()} marcar={marcar} onMudou={onMudou} podeDarCiencia={() => true} />);
    fireEvent.click(screen.getByRole('button', { name: /Estou ciente dos 2/ }));
    await waitFor(() => expect(marcar).toHaveBeenCalledWith('p1', 'resolvida', expect.stringContaining('ciente')));
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
  });

  it('login "Caixa" sem autorização diz que não dá para saber quem foi; cartão de ontem diz o dia; volta só com o novo', () => {
    const p = pend([item({ id: 'a' })], { dia: '2026-10-04', ja_vistos: 3 });
    render(<FiqueDeOlho itens={cartoes(p)} hoje="2026-10-05" mostrarLoja={false} abrir={vi.fn()} marcar={vi.fn()} onMudou={vi.fn()} podeDarCiencia={() => true} />);
    expect(screen.getByText(/login da loja, não diz quem/)).toBeTruthy();
    expect(screen.getByText('ontem')).toBeTruthy();
    expect(screen.getByText(/Fora as 3 que você já viu/)).toBeTruthy();
  });

  it('Supervisor vê o cartão mas sem "Estou ciente": quem dá ciência é o Administrador', () => {
    const marcar = vi.fn();
    render(<FiqueDeOlho itens={cartoes(pend([item({ id: 'a' })]))} hoje="2026-10-05" mostrarLoja={false} abrir={vi.fn()} marcar={marcar} onMudou={vi.fn()} podeDarCiencia={() => false} />);
    expect(screen.getByText('Desconto de R$ 50,00')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Estou ciente/ })).toBeNull();
    expect(screen.getByText('Quem dá ciência é o Administrador.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver' })).toBeTruthy(); // continua podendo conferir
    expect(marcar).not.toHaveBeenCalled();
  });

  it('a permissão é decidida por loja: Administrador de uma, Supervisor de outra', () => {
    const outra = { ...pend([item({ id: 'z' })]), id: 'p2', tenantId: 'vila', loja: 'Vila Leste' };
    const lista = organizarHoje([pend([item({ id: 'a' })]), outra], '2026-10-05');
    render(<FiqueDeOlho itens={lista} hoje="2026-10-05" mostrarLoja abrir={vi.fn()} marcar={vi.fn()} onMudou={vi.fn()} podeDarCiencia={(t) => t === 'par'} />);
    expect(screen.getAllByRole('button', { name: /Estou ciente/ })).toHaveLength(1);
    expect(screen.getAllByText('Quem dá ciência é o Administrador.')).toHaveLength(1);
  });

  it('sem cartões não desenha nada', () => {
    const { container } = render(<FiqueDeOlho itens={[]} hoje="2026-10-05" mostrarLoja={false} abrir={vi.fn()} marcar={vi.fn()} onMudou={vi.fn()} podeDarCiencia={() => true} />);
    expect(container.innerHTML).toBe('');
  });
});
