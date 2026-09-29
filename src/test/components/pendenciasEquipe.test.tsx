// Cabeçalho das Pendências no chat de quem não é o dono (2026-09-29): o balão abre direto aqui quando
// há pendência nova — tem que dar para ver que existem as Conversas e voltar para elas.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', nome: 'Thatiele' } }) }));
vi.mock('@/contexts/PendenciasContext', () => ({ kindConfig: () => ({ label: 'Estoque', icon: 'ri-archive-line', cor: '' }), pendenciaVisivelPara: () => true }));
vi.mock('@/components/base/Dialogos', () => ({ perguntar: vi.fn() }));
vi.mock('@/components/feature/assistente/TarefasPendencia', () => ({ default: () => null, minhasTarefasPendentes: vi.fn() }));

import PendenciasEquipe from '@/components/feature/assistente/PendenciasEquipe';

const dados = { itens: [], erro: null, novas: 0, recarregar: vi.fn() } as never;

describe('Pendências › cabeçalho', () => {
  afterEach(cleanup);

  it('mostra o botão Conversas com as não lidas e volta por ele e pela seta', () => {
    const onFechar = vi.fn();
    render(<PendenciasEquipe dados={dados} onFechar={onFechar} onAbrirRota={() => {}} naoLidasConversas={2} onFecharTudo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Conversas: 2 não lidas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(onFechar).toHaveBeenCalledTimes(2);
  });

  it('o X fecha o chat inteiro, não só as pendências', () => {
    const onFechar = vi.fn(); const onFecharTudo = vi.fn();
    render(<PendenciasEquipe dados={dados} onFechar={onFechar} onAbrirRota={() => {}} onFecharTudo={onFecharTudo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar o chat' }));
    expect(onFecharTudo).toHaveBeenCalled();
    expect(onFechar).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Conversas' })).toBeTruthy();
  });
});
