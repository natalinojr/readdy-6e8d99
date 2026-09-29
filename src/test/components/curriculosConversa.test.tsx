// Conversa "Currículos" no chat de quem tem acesso à Contratação (2026-09-29): supabase falso.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, renderHook, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({ rpc: vi.fn(), modulos: ['contratacao'] as string[] }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ modules: h.modulos, loading: false, hasModule: (m: string) => h.modulos.includes(m) }),
}));
vi.mock('@/lib/voltarAndroid', () => ({ useVoltarFecha: () => undefined }));

import CurriculosConversa, { LinhaCurriculos, useCurriculosConversa } from '@/components/feature/curriculos/CurriculosConversa';

const AVISOS = [
  { id: 12, content: '📅 Entrevista agendada — Auxiliar\nAna (41999999999)\n[Botão enviado: "Abrir entrevista de Ana" → /contratacao?aba=entrevistas&entrevista=abc]', created_at: '2026-09-29T12:00:00Z' },
  { id: 10, content: '📥 *Currículo pelo link "Vaga X"*\nBia · 7 km', created_at: '2026-09-29T11:00:00Z' },
];

describe('Conversa Currículos', () => {
  afterEach(cleanup);
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    h.modulos = ['contratacao'];
    h.rpc.mockReset();
    h.rpc.mockImplementation(async () => ({ data: [...AVISOS], error: null }));
  });

  it('sem o módulo não chama o banco nem aparece', async () => {
    h.modulos = ['tarefas'];
    const { result } = renderHook(() => useCurriculosConversa(true));
    expect(result.current.liberado).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('carrega em ordem de chegada; 1ª vez no aparelho não conta tudo como novo; depois conta', async () => {
    const { result, rerender } = renderHook(() => useCurriculosConversa(true));
    await waitFor(() => expect(result.current.avisos).toHaveLength(2));
    expect(h.rpc).toHaveBeenCalledWith('fn_hiring_chat_feed', { p_limit: 80 });
    expect(result.current.avisos.map((a) => a.id)).toEqual([10, 12]);
    expect(result.current.naoLidos).toBe(0);
    expect(localStorage.getItem('erpos.curriculos.visto')).toBe('12');

    h.rpc.mockResolvedValue({ data: [{ id: 15, content: 'novo', created_at: '2026-09-29T13:00:00Z' }, ...AVISOS], error: null });
    await result.current.recarregar();
    rerender();
    await waitFor(() => expect(result.current.naoLidos).toBe(1));
  });

  it('balão com negrito, sem o marcador, e botão que navega', () => {
    const onBotao = vi.fn();
    render(<CurriculosConversa avisos={[...AVISOS].reverse()} carregado visto={10} onVoltar={() => {}} onBotao={onBotao} marcarLidos={() => {}} />);
    expect(screen.getByText('Currículo pelo link "Vaga X"').tagName).toBe('B');
    expect(screen.queryByText(/Botão enviado/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Abrir entrevista de Ana/ }));
    expect(onBotao).toHaveBeenCalledWith('/contratacao?aba=entrevistas&entrevista=abc');
  });

  it('linha mostra a prévia e o número de novos', () => {
    render(<LinhaCurriculos ultimo={AVISOS[0]} naoLidos={3} onAbrir={() => {}} />);
    expect(screen.getByText(/Entrevista agendada — Auxiliar/)).toBeTruthy();
    expect(screen.getByLabelText('3 aviso(s) novo(s)')).toBeTruthy();
  });
});
