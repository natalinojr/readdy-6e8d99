import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { camadasAbertas, useVoltarFecha } from '@/lib/voltarAndroid';

const esperar = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const nivel = () => (window.history.state as { erposNivel?: number } | null)?.erposNivel ?? 0;

async function voltar() {
  await act(async () => {
    window.history.back();
    await esperar(60);
  });
}

function Camada({ nome, onFechar }: { nome: string; onFechar: () => void }) {
  useVoltarFecha(true, onFechar, nome);
  return <p>{nome}</p>;
}

/** Painel → (folha OU conversa): trocar a folha pela conversa num clique só. */
function Tela() {
  const [painel, setPainel] = useState(true);
  const [folha, setFolha] = useState(true);
  const [conversa, setConversa] = useState(false);
  return (
    <div>
      {painel && <Camada nome="painel" onFechar={() => setPainel(false)} />}
      {painel && folha && <Camada nome="folha" onFechar={() => setFolha(false)} />}
      {painel && conversa && <Camada nome="conversa" onFechar={() => setConversa(false)} />}
      <button onClick={() => { setFolha(false); setConversa(true); }}>escolher</button>
    </div>
  );
}

describe('voltar do Android com camadas', () => {
  it('fechar uma camada pela tela e abrir outra no mesmo toque não perde entrada do histórico', async () => {
    render(<Tela />);
    await act(async () => { await esperar(); });
    expect(camadasAbertas()).toBe(2);
    expect(nivel()).toBe(2);

    // O bug: a limpeza (history.back assíncrono) apagava a entrada da camada nova.
    await act(async () => { screen.getByText('escolher').click(); await esperar(80); });
    expect(screen.getByText('conversa')).toBeTruthy();
    expect(screen.queryByText('folha')).toBeNull();
    expect(camadasAbertas()).toBe(2);
    expect(nivel()).toBe(2);

    await voltar(); // fecha a conversa, o painel fica
    expect(screen.queryByText('conversa')).toBeNull();
    expect(screen.getByText('painel')).toBeTruthy();
    expect(nivel()).toBe(1);

    await voltar(); // fecha o painel
    expect(screen.queryByText('painel')).toBeNull();
    expect(nivel()).toBe(0);
  });
});
