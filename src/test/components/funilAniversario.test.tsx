import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AniversarioOferta from '../../pages/clientes/components/AniversarioOferta';
import AniversariantesLista from '../../pages/clientes/components/AniversariantesLista';
import PainelEnvioAutomatico from '../../pages/clientes/components/EnvioAutomatico';
import type { Aniversariante } from '../../pages/clientes/aniversarioMensagem';

// Funil › Ofertas (linha Aniversário + painel do automático recolhível) e o cartão Aniversariantes.
const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  invokeWithAuth: (...args: unknown[]) => invoke(...args),
}));
vi.mock('@/components/base/Dialogos', () => ({ avisar: vi.fn(), confirmar: vi.fn() }));

const CFG = {
  enabled: true, discount_type: 'percent', discount_value: 15, min_order_amount: 0,
  validity_days: 15, only_opt_in: false, message: null,
};

beforeEach(() => { invoke.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('AniversarioOferta', () => {
  it('sem acesso a Vouchers: mostra o aviso e NÃO chama a ação (daria 403)', () => {
    render(<AniversarioOferta tenantId="t1" podeVoucher={false} aberto={false} onToggle={() => {}} />);
    expect(screen.getByText('Aniversário')).toBeInTheDocument();
    expect(screen.getByText('Só quem tem acesso a Vouchers configura')).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    // sem permissão a linha não abre
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('com acesso: carrega a config e resume a oferta com a automação ligada', async () => {
    invoke.mockResolvedValue({ data: { data: CFG }, error: null });
    render(<AniversarioOferta tenantId="t1" podeVoucher aberto={false} onToggle={() => {}} />);
    expect(await screen.findByText('15% por 15 dias · gera sozinho às 9h')).toBeInTheDocument();
    expect(screen.getByText('Automático')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('voucher-write', { body: { action: 'get_birthday_config', active_tenant_id: 't1' } });
  });

  it('automação desligada: resume e marca Desligado', async () => {
    invoke.mockResolvedValue({ data: { data: { ...CFG, enabled: false, discount_type: 'fixed', discount_value: 15, validity_days: 7 } }, error: null });
    render(<AniversarioOferta tenantId="t1" podeVoucher aberto={false} onToggle={() => {}} />);
    expect(await screen.findByText('R$ 15 por 7 dias · automação desligada')).toBeInTheDocument();
    expect(screen.getByText('Desligado')).toBeInTheDocument();
  });

  it('falha ao carregar a config: não deixa salvar nem gerar (gravaria os padrões por cima)', async () => {
    invoke.mockResolvedValue({ data: { error: 'boom' }, error: null });
    render(<AniversarioOferta tenantId="t1" podeVoucher aberto onToggle={() => {}} />);
    expect(await screen.findByText('Não consegui carregar a configuração')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salvar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gerar vouchers do mês/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('aberta: salvar grava a config e avisa; gerar chama o onGerado', async () => {
    invoke.mockImplementation(async (_fn: string, op: { body: { action: string } }) => {
      if (op.body.action === 'get_birthday_config') return { data: { data: CFG }, error: null };
      if (op.body.action === 'set_birthday_config') return { data: { data: CFG }, error: null };
      return { data: { data: { created: 2, skipped: 1, items: [{ customer_id: 'c1', name: 'Ana Souza', phone: '41999998888', code: 'BD-AAAA-BBBB' }] } }, error: null };
    });
    const onGerado = vi.fn();
    render(<AniversarioOferta tenantId="t1" podeVoucher aberto onToggle={() => {}} onGerado={onGerado} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Configuração salva.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gerar vouchers do mês/ }));
    expect(await screen.findByText('2 vouchers gerados')).toBeInTheDocument();
    expect(screen.getByText(/BD-AAAA-BBBB/)).toBeInTheDocument();
    expect(onGerado).toHaveBeenCalledTimes(1);
  });
});

describe('PainelEnvioAutomatico recolhido', () => {
  const ok = { data: { modelos: [{ name: 'crm_oferta_cupom', status: 'APPROVED', rejected_reason: null }, { name: 'crm_contato', status: 'APPROVED', rejected_reason: null }], pode_enviar: false }, error: null };
  const settings = { hora_inicio: 10, hora_fim: 21, max_auto_por_dia: 30, auto_so_optin: true };

  it('resume: desligado em todos os estágios + modelos + travas, sem abrir o painel', async () => {
    invoke.mockResolvedValue(ok);
    render(<PainelEnvioAutomatico tenantId="t1" settings={settings} algumLigado={false} qtdLigados={0} aberto={false} onToggle={() => {}} onSettings={() => {}} onModelos={() => {}} />);
    expect(screen.getByText(/desligado em todos os estágios/)).toBeInTheDocument();
    expect(await screen.findByText('modelos aprovados')).toBeInTheDocument();
    expect(screen.getByText(/até 30 por dia, das 10h às 21h/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Configurar/ })).toBeInTheDocument();
    // recolhido: os campos não aparecem
    expect(screen.queryByText('Máximo por dia')).toBeNull();
  });

  it('ligado em N estágios; o botão alterna Configurar/Fechar', async () => {
    invoke.mockResolvedValue(ok);
    const onToggle = vi.fn();
    const { rerender } = render(<PainelEnvioAutomatico tenantId="t1" settings={settings} algumLigado qtdLigados={2} aberto={false} onToggle={onToggle} onSettings={() => {}} onModelos={() => {}} />);
    expect(screen.getByText(/ligado em 2 estágios/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Configurar/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<PainelEnvioAutomatico tenantId="t1" settings={settings} algumLigado qtdLigados={2} aberto onToggle={onToggle} onSettings={() => {}} onModelos={() => {}} />);
    expect(screen.getByRole('button', { name: /Fechar/ })).toBeInTheDocument();
    expect(screen.getByText('Máximo por dia')).toBeInTheDocument();
  });

  it('erro do automático aparece na linha mesmo recolhido, e só com algum estágio ligado', async () => {
    invoke.mockResolvedValue(ok);
    const comErro = { ...settings, auto_ultimo_erro: 'token expirou', auto_ultimo_erro_em: null };
    const { rerender } = render(<PainelEnvioAutomatico tenantId="t1" settings={comErro} algumLigado qtdLigados={1} aberto={false} onToggle={() => {}} onSettings={() => {}} onModelos={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('token expirou');
    rerender(<PainelEnvioAutomatico tenantId="t1" settings={comErro} algumLigado={false} qtdLigados={0} aberto={false} onToggle={() => {}} onSettings={() => {}} onModelos={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AniversariantesLista', () => {
  const base: Aniversariante = {
    customer_id: 'c1', nome: 'Maria da Silva', phone: '41999998888', phone_fmt: '(41) 99999-8888', opt_out: false,
    dias_ate: 0, data_aniversario: '05/10', proximo_aniversario: '2026-10-05', voucher: null,
  };
  const comVoucher: Aniversariante = {
    ...base, customer_id: 'c2', nome: 'João Lima', dias_ate: 4, data_aniversario: '09/10', proximo_aniversario: '2026-10-09',
    voucher: {
      code: 'BD-XYZ1-ABC2', claim_token: 'tok9', voucher_type: 'discount', discount_type: 'percent', discount_value: 15,
      original_amount: 15, min_order_amount: null, expires_at: '2099-01-01T00:00:00Z',
    },
  };

  it('mostra o dia, o código do voucher e desabilita opt-out e sem celular', () => {
    const lista = [base, comVoucher, { ...base, customer_id: 'c3', nome: 'Sem Zap', phone: '', phone_fmt: '' }, { ...base, customer_id: 'c4', nome: 'Não Perturbe', opt_out: true }];
    render(<AniversariantesLista tenantId="t1" loja="El Patrón" carregando={false} erro="" lista={lista} onTentarDeNovo={() => {}} />);
    expect(screen.getAllByText('faz aniversário hoje')).toHaveLength(3);
    expect(screen.getByText('sexta, 09/10')).toBeInTheDocument();
    expect(screen.getByText(/BD-XYZ1-ABC2/)).toBeInTheDocument();
    const botoes = screen.getAllByRole('button', { name: /Mandar parabéns/ });
    expect(botoes).toHaveLength(4);
    expect(botoes[0]).toBeEnabled();
    expect(botoes[1]).toBeEnabled();
    expect(botoes[2]).toBeDisabled();
    expect(botoes[3]).toBeDisabled();
    expect(botoes[3]).toHaveAttribute('title', 'Pediu para não receber mensagens');
  });

  it('Mandar parabéns abre o WhatsApp com o código e o link, e marca o último contato (touch_contact)', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<AniversariantesLista tenantId="t1" loja="El Patrón" carregando={false} erro="" lista={[comVoucher]} onTentarDeNovo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Mandar parabéns/ }));
    expect(abrir).toHaveBeenCalledTimes(1);
    const url = String(abrir.mock.calls[0][0]);
    expect(url).toContain('https://wa.me/5541999998888?text=');
    const texto = decodeURIComponent(url.split('text=')[1]);
    expect(texto).toContain('use o código *BD-XYZ1-ABC2*');
    expect(texto).toContain('/voucher/tok9');
    expect(texto).toContain('Feliz aniversário antecipado!');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('customer-write', {
      body: { action: 'touch_contact', active_tenant_id: 't1', customer_ids: ['c2'] },
    }));
    expect(await screen.findByRole('button', { name: /Mandar de novo/ })).toBeInTheDocument();
  });

  it('sem voucher manda só os parabéns', () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<AniversariantesLista tenantId="t1" loja="El Patrón" carregando={false} erro="" lista={[base]} onTentarDeNovo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Mandar parabéns/ }));
    const texto = decodeURIComponent(String(abrir.mock.calls[0][0]).split('text=')[1]);
    expect(texto).toContain('Feliz aniversário!');
    expect(texto).not.toContain('*');
    expect(texto).not.toContain('/voucher/');
  });

  it('falha ao marcar o contato avisa, sem esconder que a mensagem abriu', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('sem rede') });
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<AniversariantesLista tenantId="t1" loja="" carregando={false} erro="" lista={[base]} onTentarDeNovo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Mandar parabéns/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('A mensagem foi aberta, mas não consegui marcar');
  });

  it('erro de carga não parece lista vazia; vazio diz que ninguém faz aniversário', () => {
    const { rerender } = render(<AniversariantesLista tenantId="t1" loja="" carregando={false} erro="timeout" lista={[]} onTentarDeNovo={() => {}} />);
    expect(screen.getByText(/Não consegui carregar os aniversariantes: timeout/)).toBeInTheDocument();
    expect(screen.queryByText(/Ninguém faz aniversário/)).toBeNull();
    rerender(<AniversariantesLista tenantId="t1" loja="" carregando={false} erro="" lista={[]} onTentarDeNovo={() => {}} />);
    expect(screen.getByText('Ninguém faz aniversário nos próximos 7 dias.')).toBeInTheDocument();
  });
});
