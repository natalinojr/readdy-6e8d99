// Caixa de pendências do chat (PendenciasChat) — ordem de chegada, data/hora de cada uma, botão
// de ordem, agrupar por tipo (grupos começam fechados), atalho de tarefas, filtro de loja e "Recebimento parado" (dono, 2026-09-24).
// Banco falso em memória; nada vai para produção.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  notas: [] as Array<{ id: string; status: string }>,
  rpc: vi.fn(),
  invoke: vi.fn(),
  tarefas: [] as Array<{ id: string; tenant_id: string }>,
}));

vi.mock('@/lib/supabase', () => {
  const pend = {
    select: () => pend, in: () => pend, eq: () => pend, not: () => pend, lt: () => pend, or: () => pend,
    order: (_c: string, o?: { ascending?: boolean }) => { pend._asc = o?.ascending ?? true; return pend; },
    limit: () => Promise.resolve({ data: [...h.rows].sort((a, b) => String(a.criada_em).localeCompare(String(b.criada_em)) * (pend._asc ? 1 : -1)), error: null }),
    _asc: true,
  };
  const notas = { select: () => notas, in: (_c: string, ids: string[]) => Promise.resolve({ data: h.notas.filter((n) => ids.includes(n.id)), error: null }) };
  return {
    supabase: { from: (t: string) => (t === 'fiscal_inbound_documents' ? notas : pend), rpc: h.rpc },
    invokeWithAuth: h.invoke,
  };
});
vi.mock('@/components/feature/assistente/TarefasPendencia', () => ({
  default: () => null,
  minhasTarefasPendentes: () => Promise.resolve(h.tarefas),
}));

import PendenciasChat from '@/components/feature/assistente/PendenciasChat';

// Relógio fixo ao meio-dia: "1 h atrás" rodando depois da meia-noite caía em "Ontem" (falha de 00:15).
// Só o Date é falso — os timers seguem reais para o waitFor.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(new Date().setHours(12, 0, 0, 0)));
const agora = Date.now();
const iso = (horasAtras: number) => new Date(agora - horasAtras * 3600000).toISOString();
const linha = (id: string, titulo: string, horasAtras: number, extra: Record<string, unknown> = {}) => ({
  id, tenant_id: 't1', kind: 'conta_atrasada', titulo, detalhe: null, rota: '/financeiro', urgencia: 'normal',
  acao_requerida: true, status: 'aberta', criada_em: iso(horasAtras), payload: null, tenants: { name: 'Loja A' }, ...extra,
});

const onAbrir = vi.fn();
const props = {
  call: vi.fn().mockResolvedValue({}) as never, meuId: null, onFechar: () => {}, versao: 0,
  onPagar: vi.fn(), onAbrir, onPedir: vi.fn(), onVerMensagem: vi.fn(), onAbrirTarefa: vi.fn(),
};

const titulos = () => [...document.querySelectorAll('[data-pend] [data-titulo]')].map((e) => e.textContent);

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  h.rpc.mockReset().mockResolvedValue({ error: null });
  h.invoke.mockReset().mockResolvedValue({ data: { success: true }, error: null });
  onAbrir.mockReset();
  h.notas = [];
  h.tarefas = [];
  h.rows = [
    linha('b', 'Conta nova urgente', 1, { urgencia: 'alta' }),
    linha('a', 'Conta antiga', 100),
    linha('c', 'Conta de ontem', 30, { kind: 'conta_sem_dre', tenant_id: 't2', tenants: { name: 'Loja B' } }),
  ];
});

describe('PendenciasChat — ordem de chegada', () => {
  it('lista pela ordem de chegada (mais antiga primeiro), sem furar fila pela urgência', async () => {
    render(<PendenciasChat {...props} />);
    await waitFor(() => expect(titulos()).toEqual(['Conta antiga', 'Conta de ontem', 'Conta nova urgente']));
    expect(screen.getByText('Urgente')).toBeTruthy();
    expect(screen.getByText('Hoje')).toBeTruthy();
    expect(screen.getByText('Ontem')).toBeTruthy();
  });

  it('mostra data e hora de chegada e há quanto tempo', async () => {
    render(<PendenciasChat {...props} />);
    await screen.findByText('Conta antiga');
    const d = new Date(iso(100));
    const esperado = `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    expect(screen.getByText(esperado)).toBeTruthy();
    expect(screen.getAllByText('há 4 dias').length).toBeGreaterThan(0);
  });

  it('inverte a ordem; não há mais o botão "Mais antiga" (a ordem já resolve)', async () => {
    render(<PendenciasChat {...props} />);
    await screen.findByText('Conta antiga');
    fireEvent.click(screen.getByText('Mais antigas primeiro'));
    expect(titulos()).toEqual(['Conta nova urgente', 'Conta de ontem', 'Conta antiga']);
    expect(screen.queryByText(/Mais antiga ·/)).toBeNull();
  });

  it('atalho das minhas tarefas no lugar do "Mais antiga"', async () => {
    h.tarefas = [{ id: 'x', tenant_id: 't1' }, { id: 'y', tenant_id: 't1' }];
    render(<PendenciasChat {...props} />);
    fireEvent.click(await screen.findByText(/2 tarefas vencidas ou hoje/));
    expect(screen.getByText('Minhas tarefas')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Voltar às pendências'));
    expect(screen.getByText('Pendências')).toBeTruthy();
  });
});

describe('PendenciasChat — agrupar e filtrar', () => {
  it('agrupa por tipo com os grupos FECHADOS, contagem, e abre ao tocar', async () => {
    render(<PendenciasChat {...props} />);
    await screen.findByText('Conta antiga');
    fireEvent.click(screen.getByRole('button', { name: /Tipo/ }));
    expect(titulos()).toEqual([]);
    const grupo = screen.getByRole('button', { name: /Conta atrasada/ });
    expect(grupo.textContent).toContain('2');
    fireEvent.click(grupo);
    expect(titulos()).toEqual(['Conta antiga', 'Conta nova urgente']);
    fireEvent.click(grupo);
    expect(titulos()).toEqual([]);
  });

  it('filtra pela loja no seletor', async () => {
    render(<PendenciasChat {...props} />);
    await screen.findByText('Conta antiga');
    fireEvent.change(screen.getByLabelText('Loja'), { target: { value: 't2' } });
    expect(titulos()).toEqual(['Conta de ontem']);
  });
});

describe('PendenciasChat — recebimento parado', () => {
  const recebimento = () => linha('r', 'Mercadoria de SEQUOIA chegou — NF 1678 precisa ser lançada', 23, {
    kind: 'recebimento_parado', rota: '/financeiro?tab=notas-entrada', payload: { document_id: 'doc-1' },
  });

  it('"Conferir e lançar a nota" abre a própria nota', async () => {
    h.rows = [recebimento()];
    h.notas = [{ id: 'doc-1', status: 'new' }];
    render(<PendenciasChat {...props} />);
    fireEvent.click(await screen.findByText(/Conferir e lançar a nota/));
    expect(onAbrir).toHaveBeenCalledWith(expect.objectContaining({ rota: '/financeiro?tab=notas-entrada&nota=doc-1' }));
    expect(screen.queryByText(/^Abrir$/)).toBeNull();
  });

  it('"Não é compra" ignora a nota e resolve a pendência', async () => {
    h.rows = [recebimento()];
    h.notas = [{ id: 'doc-1', status: 'new' }];
    render(<PendenciasChat {...props} />);
    fireEvent.click(await screen.findByText(/Não é compra/));
    fireEvent.click(screen.getByText('Ignorar a nota'));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('fiscal-inbound', expect.objectContaining({
      body: expect.objectContaining({ tenant_id: 't1', document_id: 'doc-1', action: 'ignore' }),
    })));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('fn_pendencia_marcar', expect.objectContaining({ p_id: 'r', p_acao: 'resolvida' })));
  });

  it('nota já lançada fecha a pendência sozinha', async () => {
    h.rows = [recebimento(), linha('a', 'Conta antiga', 100)];
    h.notas = [{ id: 'doc-1', status: 'imported' }];
    render(<PendenciasChat {...props} />);
    await screen.findByText('Conta antiga');
    expect(screen.queryByText(/SEQUOIA/)).toBeNull();
    expect(h.rpc).toHaveBeenCalledWith('fn_pendencia_marcar', expect.objectContaining({ p_id: 'r', p_acao: 'resolvida' }));
  });
});
