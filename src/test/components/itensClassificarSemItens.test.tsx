// Cartão "Classificar item" com a loja sem nada pendente (2026-10-03): o dono via "Você precisa ser
// admin ou gerente dessa loja…" quando já tinha classificado tudo. Agora: gestor da loja → "Tudo
// classificado" e a pendência sai (onTudo); quem não é gestor → aviso de permissão. Servidor falso.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ invokeWithAuth: vi.fn(), supabase: {} }));
vi.mock('@/components/base/Dialogos', () => ({ confirmar: vi.fn() }));

import ItensClassificarCard from '@/components/feature/assistente/ItensClassificarCard';

const resposta = (gestor?: string[]) => vi.fn().mockResolvedValue({ tenants: [], ...(gestor ? { gestor } : {}) });

describe('Classificar item sem nada pendente na loja', () => {
  it('gestor da loja: tudo classificado e a pendência sai', async () => {
    const onTudo = vi.fn();
    render(<ItensClassificarCard call={resposta(['loja1']) as never} tenantId="loja1" abertoInicial onTudo={onTudo} />);
    expect(await screen.findByText(/Tudo classificado/)).toBeTruthy();
    await waitFor(() => expect(onTudo).toHaveBeenCalled());
    expect(screen.queryByText(/admin ou gerente/)).toBeNull();
  });

  it('não é gestor da loja: avisa a permissão', async () => {
    render(<ItensClassificarCard call={resposta(['outra']) as never} tenantId="loja1" abertoInicial />);
    expect(await screen.findByText('Só admin ou gerente dessa loja classifica os itens.')).toBeTruthy();
  });
});
