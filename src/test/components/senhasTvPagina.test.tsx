// Painel de senhas na TV (/senhas/:token): estados, só números na tela e voz só nas senhas NOVAS.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/hooks/useOrdersPing', () => ({ useOrdersPing: vi.fn() }));

import SenhasTvPage from '@/pages/senhas/page';

const TOKEN = 'a'.repeat(64);
const ok = (prep: string[], prontas: string[]) => ({
  status: 'ok', tenant_id: 't1', agora: '2026-10-05T19:42:00Z',
  loja: { nome: 'El Patron Paranaguá', cor: '#C2410C', logo: null },
  preparando: prep.map((senha) => ({ senha })),
  prontas: prontas.map((senha) => ({ senha, desde: '2026-10-05T19:40:00Z' })),
});

let resposta: unknown;
const falas: string[] = [];

function montar() {
  return render(
    <MemoryRouter initialEntries={[`/senhas/${TOKEN}`]}>
      <Routes><Route path="/senhas/:token" element={<SenhasTvPage />} /></Routes>
    </MemoryRouter>,
  );
}
const carregou = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(50); }); };

describe('Painel de senhas na TV', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    falas.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => resposta })));
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; lang = ''; rate = 1; voice = null; constructor(t: string) { this.text = t; } });
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], speak: (u: { text: string }) => { falas.push(u.text); } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('mostra preparando e pode retirar só com números, sem nome de ninguém', async () => {
    resposta = ok(['310', '312'], ['313', '309']);
    montar();
    await carregou();
    expect(screen.getByText('Preparando')).toBeInTheDocument();
    expect(screen.getByText('Pode retirar')).toBeInTheDocument();
    expect(screen.getByText('310')).toBeInTheDocument();
    expect(screen.getAllByText('313').length).toBeGreaterThan(0);
    expect(screen.getByText('Senha trezentos e treze')).toBeInTheDocument();
    expect(screen.getByText(/Toque na tela uma vez para ligar a voz/)).toBeInTheDocument();
    // a Edge só recebe o token (e pede o logo na 1ª leitura)
    const corpo = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(corpo).toEqual({ token: TOKEN, logo: true });
  });

  it('recurso desligado na loja', async () => {
    resposta = { status: 'desligado', loja: { nome: 'El Patron Paranaguá' } };
    montar();
    await carregou();
    expect(screen.getByText('TV de senhas desligada nesta loja')).toBeInTheDocument();
  });

  it('link inválido ou trocado', async () => {
    resposta = { status: 'invalido' };
    montar();
    await carregou();
    expect(screen.getByText('Link inválido ou trocado')).toBeInTheDocument();
  });

  it('só fala a senha que ficou pronta DEPOIS de ligar a voz, não as que já estavam lá', async () => {
    resposta = ok(['310'], ['309']);
    montar();
    await carregou();
    expect(falas).toEqual([]); // 1ª leitura nunca fala
    fireEvent.click(screen.getByText('Preparando')); // o toque que libera o som
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(falas).toEqual(['Som ligado']);

    resposta = ok([], ['313', '309']); // 313 é nova; 309 já estava
    await act(async () => { await vi.advanceTimersByTimeAsync(15500); }); // recarga de 15 s
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(falas).toEqual(['Som ligado', 'Senha trezentos e treze']);
  });

  it('sem o toque a TV mostra o painel mas não fala', async () => {
    resposta = ok([], ['309']);
    montar();
    await carregou();
    resposta = ok([], ['313', '309']);
    await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
    expect(screen.getByText('Senha trezentos e treze')).toBeInTheDocument();
    expect(falas).toEqual([]);
  });
});
