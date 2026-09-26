import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogosHost, confirmar, avisar, perguntar } from '@/components/base/Dialogos';

describe('Dialogos (confirmar / avisar / perguntar)', () => {
  it('confirmar: mostra título e mensagem; Cancelar devolve false e Confirmar devolve true', async () => {
    const user = userEvent.setup();
    render(<DialogosHost />);

    let r1: Promise<boolean>;
    act(() => { r1 = confirmar({ titulo: 'Excluir este combo?', mensagem: 'Não dá para desfazer.', confirmarLabel: 'Excluir', perigo: true }); });
    expect(await screen.findByText('Excluir este combo?')).toBeTruthy();
    expect(screen.getByText('Não dá para desfazer.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await expect(r1!).resolves.toBe(false);
    expect(screen.queryByText('Excluir este combo?')).toBeNull();

    let r2: Promise<boolean>;
    act(() => { r2 = confirmar({ titulo: 'Remover integração?', confirmarLabel: 'Remover' }); });
    await user.click(await screen.findByRole('button', { name: 'Remover' }));
    await expect(r2!).resolves.toBe(true);
  });

  it('Esc cancela e a fila mostra um diálogo por vez', async () => {
    const user = userEvent.setup();
    render(<DialogosHost />);
    let a: Promise<boolean>; let b: Promise<boolean>;
    act(() => { a = confirmar({ titulo: 'Primeiro?' }); b = confirmar({ titulo: 'Segundo?' }); });
    expect(await screen.findByText('Primeiro?')).toBeTruthy();
    expect(screen.queryByText('Segundo?')).toBeNull();
    await user.keyboard('{Escape}');
    await expect(a!).resolves.toBe(false);
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    await expect(b!).resolves.toBe(true);
  });

  it('avisar: só tem "Entendi"', async () => {
    const user = userEvent.setup();
    render(<DialogosHost />);
    let r: Promise<void>;
    act(() => { r = avisar('Arquivo muito grande. Máx. 2MB.', { erro: true }); });
    expect(await screen.findByText('Não deu certo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Entendi' }));
    await expect(r!).resolves.toBeUndefined();
  });

  it('perguntar: obrigatório bloqueia vazio; devolve o texto; cancelar devolve null; opcional aceita vazio', async () => {
    const user = userEvent.setup();
    render(<DialogosHost />);

    let r1: Promise<string | null>;
    act(() => { r1 = perguntar({ titulo: 'Por que dispensar esta cobrança?', confirmarLabel: 'Dispensar' }); });
    const botao = await screen.findByRole('button', { name: 'Dispensar' });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox'), 'estornado na maquininha');
    await user.click(botao);
    await expect(r1!).resolves.toBe('estornado na maquininha');

    let r2: Promise<string | null>;
    act(() => { r2 = perguntar({ titulo: 'Motivo do cancelamento' }); });
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await expect(r2!).resolves.toBeNull();

    let r3: Promise<string | null>;
    act(() => { r3 = perguntar({ titulo: 'Por que não vai fazer?', opcional: true }); });
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    await expect(r3!).resolves.toBe('');
  });
});
