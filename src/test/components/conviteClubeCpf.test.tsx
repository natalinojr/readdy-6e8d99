// Convite do clube na etapa "CPF na nota" do totem (2026-10-05): CPF válido + clube ligado + pessoa
// fora do clube → convite antes de pagar. Em qualquer dúvida (membro, erro, lento, CNPJ, já visto)
// o totem segue direto para o pagamento, como sempre.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConviteClube } from '@/pages/autoatendimento/components/ConviteClubeKiosk';
import type { ResultadoConsultaClube } from '@/lib/conviteClubeKiosk';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}|${JSON.stringify(o)}` : k) }),
}));

import CpfKiosk from '@/pages/autoatendimento/components/CpfKiosk';

const CPF = '52998224725';
const CNPJ = '11222333000181';

function montar(over: Partial<ConviteClube> = {}, comConvite = true) {
  const onContinuar = vi.fn();
  const convite: ConviteClube = {
    programa: 'Clube Teste',
    jaTratado: vi.fn(() => false),
    onTratado: vi.fn(),
    consultar: vi.fn(async (): Promise<ResultadoConsultaClube> => 'nao_membro'),
    cadastrar: vi.fn(async () => ({ resumo: undefined })),
    ...over,
  };
  render(<CpfKiosk total={50} onContinuar={onContinuar} onVoltar={vi.fn()} convite={comConvite ? convite : undefined} />);
  return { onContinuar, convite };
}

const digitar = (s: string) => s.split('').forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })));
const confirmar = () => fireEvent.click(screen.getByText('cliente.confirmar'));

afterEach(() => { vi.useRealTimers(); });

describe('CpfKiosk com convite do clube', () => {
  it('sem convite (clube desligado ou pessoa já no clube): segue como sempre', async () => {
    const { onContinuar } = montar({}, false);
    digitar(CPF);
    confirmar();
    await waitFor(() => expect(onContinuar).toHaveBeenCalledWith(CPF));
    expect(screen.queryByText('cliente.clubeConviteTitulo')).toBeNull();
  });

  it('não é membro: mostra o convite com o CPF travado e o nome do programa', async () => {
    const { onContinuar, convite } = montar();
    digitar(CPF);
    confirmar();
    expect(await screen.findByText('cliente.clubeConviteTitulo')).toBeInTheDocument();
    expect(screen.getByText(/cliente\.clubeConviteTexto\|.*Clube Teste/)).toBeInTheDocument();
    expect(screen.getByText('529.982.247-25')).toBeInTheDocument();
    expect(convite.onTratado).toHaveBeenCalledWith(CPF);
    expect(onContinuar).not.toHaveBeenCalled(); // ainda decidindo
  });

  it('"Agora não": segue para o pagamento com o CPF e sem cadastrar nada', async () => {
    const { onContinuar, convite } = montar();
    digitar(CPF);
    confirmar();
    fireEvent.click(await screen.findByText('cliente.clubeConviteAgoraNao'));
    expect(onContinuar).toHaveBeenCalledTimes(1);
    expect(onContinuar).toHaveBeenCalledWith(CPF);
    expect(convite.cadastrar).not.toHaveBeenCalled();
  });

  it('já é membro: segue direto, sem convite', async () => {
    const { onContinuar } = montar({ consultar: vi.fn(async () => 'membro' as const) });
    digitar(CPF);
    confirmar();
    await waitFor(() => expect(onContinuar).toHaveBeenCalledWith(CPF));
    expect(screen.queryByText('cliente.clubeConviteTitulo')).toBeNull();
  });

  it('consulta falhou ou estourou o limite: segue direto, sem convite', async () => {
    const { onContinuar } = montar({ consultar: vi.fn(async () => 'erro' as const) });
    digitar(CPF);
    confirmar();
    await waitFor(() => expect(onContinuar).toHaveBeenCalledWith(CPF));
    expect(screen.queryByText('cliente.clubeConviteTitulo')).toBeNull();
  });

  it('consultar que lança exceção não trava: segue direto', async () => {
    const { onContinuar } = montar({ consultar: vi.fn(async () => { throw new Error('boom'); }) });
    digitar(CPF);
    confirmar();
    await waitFor(() => expect(onContinuar).toHaveBeenCalledWith(CPF));
  });

  it('CNPJ nunca recebe convite (nem consulta)', async () => {
    const { onContinuar, convite } = montar();
    digitar(CNPJ);
    confirmar();
    await waitFor(() => expect(onContinuar).toHaveBeenCalledWith(CNPJ));
    expect(convite.consultar).not.toHaveBeenCalled();
  });

  it('CPF já tratado neste pedido: não consulta nem convida de novo', async () => {
    const { onContinuar, convite } = montar({ jaTratado: vi.fn(() => true) });
    digitar(CPF);
    confirmar();
    await waitFor(() => expect(onContinuar).toHaveBeenCalledWith(CPF));
    expect(convite.consultar).not.toHaveBeenCalled();
  });

  it('CPF inválido: mostra o erro de sempre, sem consultar', async () => {
    const { onContinuar, convite } = montar();
    digitar('52998224724');
    confirmar();
    expect(await screen.findByText('cliente.cpfInvalido')).toBeInTheDocument();
    expect(convite.consultar).not.toHaveBeenCalled();
    expect(onContinuar).not.toHaveBeenCalled();
  });

  it('"Continuar sem CPF" durante a consulta: a resposta tardia é ignorada', async () => {
    let resolver!: (r: ResultadoConsultaClube) => void;
    const { onContinuar, convite } = montar({ consultar: vi.fn(() => new Promise<ResultadoConsultaClube>((r) => { resolver = r; })) });
    digitar(CPF);
    confirmar();
    expect(await screen.findByText('cliente.clubeVerificando')).toBeInTheDocument();
    fireEvent.click(screen.getByText('cliente.semCpf'));
    expect(onContinuar).toHaveBeenCalledTimes(1);
    expect(onContinuar).toHaveBeenCalledWith(null);
    await act(async () => { resolver('nao_membro'); });
    expect(screen.queryByText('cliente.clubeConviteTitulo')).toBeNull();
    expect(convite.onTratado).not.toHaveBeenCalled();
    expect(onContinuar).toHaveBeenCalledTimes(1);
  });

  it('toque duplo em Confirmar consulta uma vez só', async () => {
    let resolver!: (r: ResultadoConsultaClube) => void;
    const { convite } = montar({ consultar: vi.fn(() => new Promise<ResultadoConsultaClube>((r) => { resolver = r; })) });
    digitar(CPF);
    const botao = screen.getByText('cliente.confirmar');
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(convite.consultar).toHaveBeenCalledTimes(1);
    await act(async () => { resolver('membro'); });
  });
});

describe('ConviteClubeKiosk (cadastro)', () => {
  const abrirConvite = async (over: Partial<ConviteClube> = {}) => {
    const m = montar(over);
    digitar(CPF);
    confirmar();
    await screen.findByText('cliente.clubeConviteTitulo');
    return m;
  };
  const preencher = (nome: string, cel: string, aceita = true) => {
    fireEvent.change(screen.getByPlaceholderText('cliente.clubeConviteNomeDica'), { target: { value: nome } });
    fireEvent.change(screen.getByPlaceholderText('(41) 99999-9999'), { target: { value: cel } });
    if (aceita) fireEvent.click(screen.getByRole('checkbox'));
  };

  it('sem nome, celular curto ou sem aceite: pede e não chama o servidor', async () => {
    const { convite } = await abrirConvite();
    fireEvent.click(screen.getByText('cliente.clubeConviteEntrar'));
    expect(await screen.findByText('cliente.clubeConviteErroNome')).toBeInTheDocument();
    preencher('Maria', '4199', false);
    fireEvent.click(screen.getByText('cliente.clubeConviteEntrar'));
    expect(await screen.findByText('cliente.clubeConviteErroCelular')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('(41) 99999-9999'), { target: { value: '(41) 99999-1234' } });
    fireEvent.click(screen.getByText('cliente.clubeConviteEntrar'));
    expect(await screen.findByText('cliente.clubeConviteErroAceite')).toBeInTheDocument();
    expect(convite.cadastrar).not.toHaveBeenCalled();
  });

  it('entrar no clube: cadastra com o CPF da nota, confirma e segue para o pagamento', async () => {
    const cadastrar = vi.fn(async () => ({ resumo: { saldo: 50 } as never }));
    const { onContinuar } = await abrirConvite({ cadastrar });
    preencher(' Maria Silva ', '(41) 99999-1234');
    fireEvent.click(screen.getByText('cliente.clubeConviteEntrar'));
    expect(await screen.findByText('cliente.clubeConviteFeito')).toBeInTheDocument();
    expect(cadastrar).toHaveBeenCalledWith({
      cpf: CPF, nome: 'Maria Silva', celular: '41999991234', nascimento: null, aceita_termos: true, aceita_ofertas: false,
    });
    expect(onContinuar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/cliente\.clubeConviteContinuar/));
    expect(onContinuar).toHaveBeenCalledTimes(1);
    expect(onContinuar).toHaveBeenCalledWith(CPF);
  });

  it('depois do cadastro segue sozinho em 2,5s (uma vez só, mesmo tocando Continuar)', async () => {
    const cadastrar = vi.fn(async () => ({ resumo: undefined }));
    const { onContinuar } = await abrirConvite({ cadastrar });
    preencher('Maria', '41999991234');
    vi.useFakeTimers();
    fireEvent.click(screen.getByText('cliente.clubeConviteEntrar'));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.getByText('cliente.clubeConviteFeito')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(onContinuar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText(/cliente\.clubeConviteContinuar/));
    expect(onContinuar).toHaveBeenCalledTimes(1);
  });

  it('erro do servidor: mostra a mensagem, mantém "Agora não" e não segue sozinho', async () => {
    const cadastrar = vi.fn(async () => ({ erro: 'Este celular já tem cadastro na loja. Peça ao caixa para incluir seu CPF nele.' }));
    const { onContinuar } = await abrirConvite({ cadastrar });
    preencher('Maria', '41999991234');
    fireEvent.click(screen.getByText('cliente.clubeConviteEntrar'));
    expect(await screen.findByText(/Este celular já tem cadastro/)).toBeInTheDocument();
    expect(onContinuar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('cliente.clubeConviteAgoraNao'));
    expect(onContinuar).toHaveBeenCalledWith(CPF);
  });

  it('cadastro que lança exceção não trava: mostra erro geral', async () => {
    const cadastrar = vi.fn(async () => { throw new Error('rede'); });
    await abrirConvite({ cadastrar });
    preencher('Maria', '41999991234');
    fireEvent.click(screen.getByText('cliente.clubeConviteEntrar'));
    expect(await screen.findByText('cliente.clubeConviteErroGeral')).toBeInTheDocument();
  });

  it('"Agora não" funciona com o cadastro ainda em andamento (convite não prende o pedido)', async () => {
    let resolver!: (v: { resumo?: undefined }) => void;
    const cadastrar = vi.fn(() => new Promise<{ resumo?: undefined }>((r) => { resolver = r; }));
    const { onContinuar } = await abrirConvite({ cadastrar });
    preencher('Maria', '41999991234');
    fireEvent.click(screen.getByText('cliente.clubeConviteEntrar'));
    expect(await screen.findByText('cliente.clubeConviteEntrando')).toBeInTheDocument();
    fireEvent.click(screen.getByText('cliente.clubeConviteAgoraNao'));
    expect(onContinuar).toHaveBeenCalledTimes(1);
    await act(async () => { resolver({}); });
    expect(onContinuar).toHaveBeenCalledTimes(1);
  });
});
