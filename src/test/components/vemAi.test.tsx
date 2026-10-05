import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import VemAi from '@/pages/hoje/VemAi';

const dados = {
  hoje: '2026-10-05', ate: '2026-10-19',
  contas: [{ tenant_id: 'A', loja: 'El Patron Paranaguá', dia: '2026-10-07', total: 6200, qtd: 4, guias_total: 1800, guias: [{ descricao: 'DAS — competência 09/2026', valor: 1800 }], folha_total: 0, folha_qtd: 0 }],
  metas: [{ tenant_id: 'A', dia_semana: 3, faturamento: 2000 }],
  certificados: [{ nome: 'EP Serviços', dia: '2026-10-17' }],
  conexoes: [], especiais: [{ tenant_id: 'A', loja: 'El Patron Paranaguá', dia: '2026-10-12', rotulo: 'Feriado', fechado: true, horarios: null }],
};

beforeEach(() => { rpc.mockReset(); });

describe('VemAi', () => {
  it('não aparece (nem consulta) para quem não é o dono', () => {
    const { container } = render(<VemAi dono={false} filtroLoja="" abrir={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('recolhida mostra a frase-resumo; aberta lista dia a dia com destaque e botões que levam à tela certa', async () => {
    rpc.mockResolvedValue({ data: dados, error: null });
    const abrir = vi.fn();
    render(<VemAi dono filtroLoja="" abrir={abrir} />);
    expect(await screen.findByText(/3 coisas: .*saem quarta/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('fn_hoje_vem_ai', { p_dias: 14 });
    fireEvent.click(screen.getByRole('button', { name: /Vem aí/ }));
    expect(screen.getByText(/Saem R\$.*6\.200,00/)).toBeInTheDocument();
    expect(screen.getByText(/acima da meta de vendas do dia/)).toBeInTheDocument();
    expect(screen.getByText('Certificado da NFS-e vence — EP Serviços')).toBeInTheDocument();
    expect(screen.getByText('Delivery fechado — Feriado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));
    expect(abrir).toHaveBeenCalledWith('', '/notas-servico');
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar' }));
    expect(abrir).toHaveBeenCalledWith('A', '/config-delivery?aba=horario');
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(abrir).toHaveBeenCalledWith('A', '/financeiro?tab=pagar');
  });

  it('erro de leitura vira aviso discreto, sem derrubar a Hoje', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function fn_hoje_vem_ai does not exist' } });
    render(<VemAi dono filtroLoja="" abrir={() => {}} />);
    await waitFor(() => expect(screen.getByText('Não consegui conferir o que vem aí agora.')).toBeInTheDocument());
  });

  it('nada à vista: diz que nada vence', async () => {
    rpc.mockResolvedValue({ data: { ...dados, contas: [], certificados: [], especiais: [] }, error: null });
    render(<VemAi dono filtroLoja="" abrir={() => {}} />);
    expect(await screen.findByText('Nada vence nos próximos 14 dias.')).toBeInTheDocument();
  });
});
