// Tarefas: horário no vencimento e configuração dos avisos de vencimento.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, functions: { invoke: vi.fn() } } }));
vi.mock('@/components/feature/BotaoAvisos', () => ({ default: () => null }));

import { partesDoPrazo, prazoParaGravar } from '@/pages/tarefas/components/EditorCelula';
import { rotuloVencimento } from '@/pages/tarefas/components/TaskCard';
import ConfigAvisos from '@/pages/tarefas/components/ConfigAvisos';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';

const t = (due_date: string | null, due_has_time: boolean, extra: Partial<TaskRow> = {}) =>
  ({ due_date, due_has_time, status_category: 'todo', ...extra }) as TaskRow;

describe('horário do vencimento', () => {
  it('sem horário grava meio-dia UTC; com horário grava o instante local', () => {
    expect(prazoParaGravar('2026-09-25', null)).toEqual({ due_date: '2026-09-25T12:00:00Z', due_has_time: false });
    const com = prazoParaGravar('2026-09-25', '14:30');
    expect(com.due_has_time).toBe(true);
    expect(new Date(com.due_date!).getHours()).toBe(14);
    expect(new Date(com.due_date!).getMinutes()).toBe(30);
    expect(prazoParaGravar(null, '10:00')).toEqual({ due_date: null, due_has_time: false });
  });

  it('lê dia e hora locais de volta (ida e volta)', () => {
    const { due_date } = prazoParaGravar('2026-09-25', '22:45');
    expect(partesDoPrazo(due_date, true)).toEqual({ dia: '2026-09-25', hora: '22:45' });
    expect(partesDoPrazo('2026-09-25T12:00:00Z', false).hora).toBeNull();
  });

  it('rótulo mostra a hora e fica atrasado assim que a hora passa', () => {
    const daqui1h = new Date(Date.now() + 3600_000);
    const ha1h = new Date(Date.now() - 3600_000);
    const futuro = rotuloVencimento(t(daqui1h.toISOString(), true))!;
    const hh = daqui1h.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    expect(futuro.text).toContain(hh);
    expect(futuro.className).not.toContain('red');
    // mesma data, hora já passou → vermelho (antes só ficava vermelho no dia seguinte)
    if (ha1h.getDate() === new Date().getDate()) {
      expect(rotuloVencimento(t(ha1h.toISOString(), true))!.className).toContain('red');
    }
  });
});

describe('ConfigAvisos', () => {
  beforeEach(() => rpc.mockReset());

  it('carrega as preferências, alterna lembretes e salva', async () => {
    rpc.mockResolvedValue({ data: { ativo: true, lembretes: [60, 0], hora_dia_todo: '08:00', vibrar: true, incluir_criadas_sem_resp: true }, error: null });
    const write = vi.fn().mockResolvedValue({ success: true });
    const onClose = vi.fn();
    render(<ConfigAvisos tenantId="t1" write={write} onClose={onClose} />);

    fireEvent.click(await screen.findByText('1 dia antes'));
    fireEvent.click(screen.getByText('Na hora')); // desmarca
    fireEvent.click(screen.getByText('Vibrar e tocar no celular')); // desliga
    fireEvent.click(screen.getByText('Salvar'));
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('set_notification_prefs', {
      ativo: true, lembretes: [60, 1440], hora_dia_todo: '08:00', vibrar: false, incluir_criadas_sem_resp: true,
    }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
