// Quem vê cada pendência (2026-09-29): "tarefas vencidas" conta as tarefas do dono → só ele vê.
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({}) }));
import { pendenciaVisivelPara } from '@/contexts/PendenciasContext';

describe('pendenciaVisivelPara', () => {
  it('tarefa vencida: só o dono, qualquer que seja o perfil', () => {
    expect(pendenciaVisivelPara('tarefa_vencida', 'gerente', 'thatiele@x.com')).toBe(false);
    expect(pendenciaVisivelPara('tarefa_vencida', 'admin', 'Natalinojr.Engel@gmail.com')).toBe(true);
  });
  it('estoque crítico continua para todos da loja; financeiro para a turma do financeiro', () => {
    expect(pendenciaVisivelPara('estoque_critico', 'cozinha', 'a@b.c')).toBe(true);
    expect(pendenciaVisivelPara('conta_atrasada', 'cozinha', 'a@b.c')).toBe(false);
    expect(pendenciaVisivelPara('conta_atrasada', 'gerente', 'a@b.c')).toBe(true);
  });
});
