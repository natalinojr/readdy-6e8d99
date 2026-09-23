// Horas por dia numa tarefa de vários dias (janela da tarefa).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanoPorDia from '@/pages/tarefas/components/PlanoPorDia';

const base = { id: 't1', start_date: '2026-09-25', due_date: '2026-09-28T12:00:00Z', time_plan: null, time_estimate_minutes: 240 };

describe('PlanoPorDia', () => {
  it('some em tarefa de um dia só', () => {
    const { container } = render(<PlanoPorDia task={{ ...base, start_date: '2026-09-28' }} gravar={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('preenche pulando fim de semana e salva o plano (sem dias vazios)', async () => {
    const gravar = vi.fn().mockResolvedValue(undefined);
    render(<PlanoPorDia task={base} gravar={gravar} />);
    expect(screen.getByText(/Automático: a Carga espalha 4h/)).toBeTruthy();
    fireEvent.click(screen.getByText('Definir por dia'));
    fireEvent.change(screen.getByPlaceholderText('2h'), { target: { value: '2h' } });
    fireEvent.click(screen.getByText('Aplicar'));
    // sex 25 e seg 28 = 2h; sáb 26 e dom 27 vazios
    fireEvent.change(screen.getByLabelText('Horas em 2026-09-28'), { target: { value: '1h30' } });
    expect(screen.getByText('3h 30m')).toBeTruthy();
    fireEvent.click(screen.getByText('Salvar'));
    await vi.waitFor(() => expect(gravar).toHaveBeenCalledWith({ time_plan: { dias: { '2026-09-25': 120, '2026-09-28': 90 } } }));
  });

  it('valor inválido bloqueia salvar; "Automático" limpa o plano', async () => {
    const gravar = vi.fn().mockResolvedValue(undefined);
    render(<PlanoPorDia task={{ ...base, time_plan: { dias: { '2026-09-25': 60 } } }} gravar={gravar} />);
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.change(screen.getByLabelText('Horas em 2026-09-26'), { target: { value: 'abc' } });
    expect((screen.getByText('Salvar') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Automático'));
    await vi.waitFor(() => expect(gravar).toHaveBeenCalledWith({ time_plan: null }));
  });
});
