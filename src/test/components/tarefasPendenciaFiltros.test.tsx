// "Minhas tarefas" na caixa de pendências (TarefasPendencia sem loja) — filtros de busca, prazo,
// de quem é, prioridade e pasta, com contagens (dono, 2026-09-24). Banco falso em memória.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const ME = 'eu';
const h = vi.hoisted(() => ({ tasks: [] as Record<string, unknown>[] }));

vi.mock('@/lib/supabase', () => {
  const q = {
    select: () => q, is: () => q, eq: () => q, not: () => q, lte: () => q, or: () => q,
    // Minhas tarefas em DUAS lojas; fn_get_tasks devolve todas as acessíveis em cada chamada (como no banco)
    limit: () => Promise.resolve({ data: h.tasks.map((t, i) => ({ id: t.id, tenant_id: i % 2 ? 't2' : 't1' })), error: null }),
  };
  return {
    supabase: {
      from: () => q,
      rpc: (fn: string) => Promise.resolve(fn === 'fn_get_tasks' ? { data: h.tasks, error: null } : { data: [], error: null }),
    },
    invokeWithAuth: vi.fn(),
  };
});

import TarefasPendencia from '@/components/feature/assistente/TarefasPendencia';

const ontem = new Date(Date.now() - 86400000).toISOString();
const daquiUmMinuto = new Date(Date.now() + 60000).toISOString();
const tarefa = (id: string, title: string, extra: Record<string, unknown>) => ({
  id, title, list_id: 'l1', list_name: 'Financeiro', completed_at: null, status_category: 'todo',
  assignee_id: ME, assignee_name: 'Eu', created_by: ME, priority: 0, due_date: ontem, ...extra,
});

const titulos = () => [...document.querySelectorAll('button[aria-expanded] span.block.text-sm')].map((e) => e.textContent?.replace(/^(Alta|Urgente)/, ''));

beforeEach(() => {
  h.tasks = [
    tarefa('a', 'Pagar aluguel', { priority: 4 }),
    tarefa('b', 'Conferir estoque', { due_date: daquiUmMinuto, list_name: 'Cozinha' }),
    tarefa('c', 'Ligar para fornecedor', { assignee_id: 'joao', assignee_name: 'João' }),
  ];
});

describe('TarefasPendencia — filtros das minhas tarefas', () => {
  it('com duas lojas, cada tarefa aparece uma vez só', async () => {
    render(<TarefasPendencia meuId={ME} onAbrir={vi.fn()} />);
    await screen.findByText(/Atrasadas/);
    expect(titulos()).toHaveLength(3);
  });

  it('filtra por prazo, de quem é e prioridade, com contagem', async () => {
    render(<TarefasPendencia meuId={ME} onAbrir={vi.fn()} />);
    expect(await screen.findByText(/Atrasadas · 2/)).toBeTruthy();
    expect(screen.getByText(/Hoje · 1/)).toBeTruthy();
    expect(screen.getByText(/Passei · 1/)).toBeTruthy();

    fireEvent.click(screen.getByText(/Hoje · 1/));
    expect(titulos()).toEqual(['Conferir estoque']);
    fireEvent.click(screen.getByText(/Hoje · 1/));

    fireEvent.click(screen.getByText(/Passei · 1/));
    expect(titulos()).toEqual(['Ligar para fornecedor']);
    fireEvent.click(screen.getByText('Limpar filtros'));

    fireEvent.click(screen.getByText(/Alta\/urgente · 1/));
    expect(titulos()).toEqual(['Pagar aluguel']);
  });

  it('busca pelo título e filtra pela pasta', async () => {
    render(<TarefasPendencia meuId={ME} onAbrir={vi.fn()} />);
    await screen.findByText(/Atrasadas/);
    fireEvent.change(screen.getByPlaceholderText('Buscar tarefa ou pessoa'), { target: { value: 'joão' } });
    expect(titulos()).toEqual(['Ligar para fornecedor']);
    fireEvent.change(screen.getByPlaceholderText('Buscar tarefa ou pessoa'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Pasta'), { target: { value: 'Cozinha' } });
    expect(titulos()).toEqual(['Conferir estoque']);
  });
});
