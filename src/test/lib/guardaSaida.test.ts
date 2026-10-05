/**
 * Guarda de saída global (src/lib/guardaSaida.ts): quem tem mudança não salva registra uma função; os botões que
 * navegam (loja, Perfil, Sair, Voltar) chamam `await podeSair()` antes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const confirmarMock = vi.hoisted(() => vi.fn());
vi.mock('@/components/base/Dialogos', () => ({ confirmar: confirmarMock }));

import { pendenciasDeSaida, podeSair, registrarGuardaSaida } from '../../lib/guardaSaida';

describe('guardaSaida', () => {
  beforeEach(() => { confirmarMock.mockReset(); });

  it('sem guarda registrada pode sair na hora, sem perguntar', async () => {
    await expect(podeSair()).resolves.toBe(true);
    expect(confirmarMock).not.toHaveBeenCalled();
  });

  it('guarda sem pendência (null ou 0) não pergunta', async () => {
    const a = registrarGuardaSaida(() => null);
    const b = registrarGuardaSaida(() => ({ pendente: 0, mensagem: 'nada' }));
    await expect(podeSair()).resolves.toBe(true);
    expect(confirmarMock).not.toHaveBeenCalled();
    a(); b();
  });

  it('com pendência pergunta "Sair sem salvar?" (perigo) e devolve a resposta', async () => {
    const off = registrarGuardaSaida(() => ({ pendente: 2, mensagem: '2 mudanças ainda não foram salvas no Delivery.' }));
    confirmarMock.mockResolvedValueOnce(false);
    await expect(podeSair()).resolves.toBe(false);
    expect(confirmarMock).toHaveBeenCalledTimes(1);
    expect(confirmarMock.mock.calls[0][0]).toMatchObject({
      titulo: 'Sair sem salvar?', confirmarLabel: 'Sair sem salvar', perigo: true,
      mensagem: '2 mudanças ainda não foram salvas no Delivery.',
    });

    confirmarMock.mockResolvedValueOnce(true);
    await expect(podeSair()).resolves.toBe(true);
    off();
  });

  it('juntas as mensagens de todas as guardas com pendência', async () => {
    const a = registrarGuardaSaida(() => ({ pendente: 1, mensagem: 'Uma.' }));
    const b = registrarGuardaSaida(() => ({ pendente: 1, mensagem: 'Outra.' }));
    const c = registrarGuardaSaida(() => null);
    confirmarMock.mockResolvedValueOnce(true);
    await podeSair();
    expect(confirmarMock.mock.calls[0][0].mensagem).toBe('Uma. Outra.');
    expect(pendenciasDeSaida()).toHaveLength(2);
    a(); b(); c();
  });

  it('desregistrar tira a guarda', async () => {
    const off = registrarGuardaSaida(() => ({ pendente: 1, mensagem: 'x' }));
    off();
    await expect(podeSair()).resolves.toBe(true);
    expect(confirmarMock).not.toHaveBeenCalled();
  });

  it('duplo toque dividem a mesma pergunta', async () => {
    const off = registrarGuardaSaida(() => ({ pendente: 1, mensagem: 'x' }));
    let responder!: (v: boolean) => void;
    confirmarMock.mockReturnValueOnce(new Promise<boolean>((r) => { responder = r; }));
    const p1 = podeSair();
    const p2 = podeSair();
    responder(true);
    await expect(Promise.all([p1, p2])).resolves.toEqual([true, true]);
    expect(confirmarMock).toHaveBeenCalledTimes(1);
    off();
  });

  it('guarda que dá erro não impede a saída', async () => {
    const off = registrarGuardaSaida(() => { throw new Error('quebrou'); });
    await expect(podeSair()).resolves.toBe(true);
    off();
  });
});
