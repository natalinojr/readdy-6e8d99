import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Foto do boleto no cartão "Falta o boleto": a Edge lê (conta_ler_boleto), o cliente confere e grava
// pelo conta_guardar_boleto. Aqui a Edge é simulada; o que se confere é a decisão da tela.
const chamar = vi.fn();
vi.mock('@/lib/assistenteApp', () => ({ chamarAssistente: (...a: unknown[]) => chamar(...a) }));
vi.mock('@/pages/receber/pedidos/api', () => ({ comprovanteParaEnvio: async () => ({ base64: 'AAAA', media_type: 'image/jpeg' }) }));
vi.mock('@/pages/receber/leitura', () => ({ lerPixDaFoto: async () => null }));

import BoletoPorFoto from '@/components/feature/assistente/BoletoPorFoto';

const lido = { beneficiario: 'Ambev', valor: 1200, vencimento: '2026-10-12', linha_digitavel: '34191790010104351004791020150008291070026000', pix_copia_e_cola: null };
const cand = (p: Record<string, unknown> = {}) => ({ bill_id: 'b1', fornecedor: 'Ambev', saldo: 1200, vencimento: '2026-10-12', bate_valor: true, bate_vencimento: true, ...p });

const mandarFoto = (container: HTMLElement) => {
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'boleto.jpg', { type: 'image/jpeg' })] } });
};

beforeEach(() => { chamar.mockReset(); });

describe('BoletoPorFoto', () => {
  it('bate valor e vencimento com uma conta só: grava direto e avisa o cartão', async () => {
    chamar.mockImplementation(async (acao: string) => (acao === 'conta_ler_boleto'
      ? { lido, candidatas: [cand()] }
      : { bill_id: 'b1', tipo: 'boleto', avisos: [] }));
    const onFeito = vi.fn();
    const { container } = render(<BoletoPorFoto billIds={['b1']} className="x" onFeito={onFeito} />);
    mandarFoto(container);
    await waitFor(() => expect(onFeito).toHaveBeenCalled());
    expect(chamar).toHaveBeenCalledWith('conta_ler_boleto', { bill_ids: ['b1'], arquivo: { base64: 'AAAA', media_type: 'image/jpeg' } });
    expect(chamar).toHaveBeenCalledWith('conta_guardar_boleto', { bill_id: 'b1', linha: lido.linha_digitavel });
    expect(screen.getByText(/Boleto guardado em Ambev/)).toBeInTheDocument();
  });

  it('valor diferente: não grava, mostra a diferença e só grava ao confirmar "mesmo assim"', async () => {
    chamar.mockImplementation(async (acao: string) => (acao === 'conta_ler_boleto'
      ? { lido, candidatas: [cand({ saldo: 1250, bate_valor: false })] }
      : { bill_id: 'b1', tipo: 'boleto', avisos: [] }));
    const onFeito = vi.fn();
    const { container } = render(<BoletoPorFoto billIds={['b1']} className="x" onFeito={onFeito} />);
    mandarFoto(container);
    expect(await screen.findByText(/O boleto é de .*1\.200,00.* e a conta é de .*1\.250,00/)).toBeInTheDocument();
    expect(chamar).not.toHaveBeenCalledWith('conta_guardar_boleto', expect.anything());
    expect(onFeito).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar mesmo assim' }));
    await waitFor(() => expect(onFeito).toHaveBeenCalled());
    expect(chamar).toHaveBeenCalledWith('conta_guardar_boleto', { bill_id: 'b1', linha: lido.linha_digitavel, confirmar_valor: true });
  });

  it('vencimento diferente também pergunta', async () => {
    chamar.mockImplementation(async () => ({ lido, candidatas: [cand({ vencimento: '2026-10-10', bate_vencimento: false })] }));
    const { container } = render(<BoletoPorFoto billIds={['b1']} className="x" onFeito={() => {}} />);
    mandarFoto(container);
    expect(await screen.findByText(/O boleto vence em 12\/10 e a conta vence em 10\/10/)).toBeInTheDocument();
  });

  it('várias contas do fornecedor: só uma bate, grava nela; duas batem, pergunta qual', async () => {
    chamar.mockImplementation(async (acao: string) => (acao === 'conta_ler_boleto'
      ? { lido, candidatas: [cand({ bill_id: 'b1' }), cand({ bill_id: 'b2', saldo: 300, bate_valor: false })] }
      : { bill_id: 'b1', tipo: 'boleto', avisos: [] }));
    const a = render(<BoletoPorFoto billIds={['b1', 'b2']} className="x" onFeito={() => {}} />);
    mandarFoto(a.container);
    await waitFor(() => expect(chamar).toHaveBeenCalledWith('conta_guardar_boleto', { bill_id: 'b1', linha: lido.linha_digitavel }));
    a.unmount();

    chamar.mockReset();
    chamar.mockImplementation(async () => ({ lido, candidatas: [cand({ bill_id: 'b1' }), cand({ bill_id: 'b2' })] }));
    const b = render(<BoletoPorFoto billIds={['b1', 'b2']} className="x" onFeito={() => {}} />);
    mandarFoto(b.container);
    expect(await screen.findByText('Em qual conta guardar?')).toBeInTheDocument();
    expect(chamar).not.toHaveBeenCalledWith('conta_guardar_boleto', expect.anything());
  });

  it('Pix/concessionária sem vencimento: não grava sozinho, mostra a conta e só grava ao clicar', async () => {
    chamar.mockImplementation(async (acao: string) => (acao === 'conta_ler_boleto'
      ? { lido: { ...lido, vencimento: null }, candidatas: [cand({ bate_vencimento: null })] }
      : { bill_id: 'b1', tipo: 'boleto', avisos: [] }));
    const onFeito = vi.fn();
    const { container } = render(<BoletoPorFoto billIds={['b1']} className="x" onFeito={onFeito} />);
    mandarFoto(container);
    expect(await screen.findByText(/O boleto não diz o vencimento/)).toBeInTheDocument();
    expect(screen.getByText('Ambev', { selector: 'b' })).toBeInTheDocument();
    expect(chamar).not.toHaveBeenCalledWith('conta_guardar_boleto', expect.anything());
    expect(onFeito).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nesta conta' }));
    await waitFor(() => expect(onFeito).toHaveBeenCalled());
    expect(chamar).toHaveBeenCalledWith('conta_guardar_boleto', { bill_id: 'b1', linha: lido.linha_digitavel });
  });

  it('beneficiário do boleto é de outro fornecedor: pergunta mesmo com valor e vencimento iguais', async () => {
    chamar.mockImplementation(async (acao: string) => (acao === 'conta_ler_boleto'
      ? { lido: { ...lido, beneficiario: 'Fulano de Tal ME' }, candidatas: [cand()] }
      : { bill_id: 'b1', tipo: 'boleto', avisos: [] }));
    const { container } = render(<BoletoPorFoto billIds={['b1']} className="x" onFeito={() => {}} />);
    mandarFoto(container);
    expect(await screen.findByText(/O boleto é de Fulano de Tal ME e a conta é de Ambev/)).toBeInTheDocument();
    expect(chamar).not.toHaveBeenCalledWith('conta_guardar_boleto', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar mesmo assim' }));
    // valor e vencimento batem: confirmar o fornecedor NÃO manda "confirmar_valor"
    await waitFor(() => expect(chamar).toHaveBeenCalledWith('conta_guardar_boleto', { bill_id: 'b1', linha: lido.linha_digitavel }));
  });

  it('contas de fornecedores diferentes no cartão: pergunta em qual, mesmo que só uma bata', async () => {
    chamar.mockImplementation(async () => ({ lido, candidatas: [cand({ bill_id: 'b1' }), cand({ bill_id: 'b2', fornecedor: 'Coca-Cola', saldo: 300, bate_valor: false })] }));
    const { container } = render(<BoletoPorFoto billIds={['b1', 'b2']} className="x" onFeito={() => {}} />);
    mandarFoto(container);
    expect(await screen.findByText('Em qual conta guardar?')).toBeInTheDocument();
    expect(chamar).not.toHaveBeenCalledWith('conta_guardar_boleto', expect.anything());
  });

  it('sem código legível: pede a linha colada e só então deixa guardar', async () => {
    chamar.mockImplementation(async (acao: string) => (acao === 'conta_ler_boleto'
      ? { lido: { ...lido, linha_digitavel: null }, candidatas: [cand()] }
      : { bill_id: 'b1', tipo: 'boleto', avisos: [] }));
    const { container } = render(<BoletoPorFoto billIds={['b1']} className="x" onFeito={() => {}} />);
    mandarFoto(container);
    expect(await screen.findByText(/Não consegui ler o código do boleto/)).toBeInTheDocument();
    const botao = screen.getByRole('button', { name: 'Guardar nesta conta' });
    expect(botao).toBeDisabled();
    const colada = '34191.79001 01043.510047 91020.150008 2 91070026000';
    fireEvent.change(screen.getByPlaceholderText(/Linha digitável/), { target: { value: colada } });
    expect(botao).not.toBeDisabled();
    fireEvent.click(botao);
    await waitFor(() => expect(chamar).toHaveBeenCalledWith('conta_guardar_boleto', { bill_id: 'b1', linha: colada }));
  });

  it('erro da leitura aparece e o botão continua para tentar de novo', async () => {
    chamar.mockRejectedValue(new Error('Isso não parece um boleto.'));
    const { container } = render(<BoletoPorFoto billIds={['b1']} className="x" onFeito={() => {}} />);
    mandarFoto(container);
    expect(await screen.findByText('Isso não parece um boleto.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mandar foto do boleto/ })).not.toBeDisabled();
  });
});
