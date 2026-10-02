// Configurações › Fiscal › Envio de XML para a contabilidade: carrega pela Edge, mostra o próximo
// envio, salva com a senha só quando digitada e pede confirmação antes do "Enviar agora".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({ invokeWithAuth: (...a: unknown[]) => invoke(...a) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 'T1', perfil: 'admin' } }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

import EnvioXmlContabilidade from '@/pages/configuracoes/components/EnvioXmlContabilidade';

const previa = { competencia: '2026-09', qtd_nfce: 281, qtd_nfce_canceladas: 2, qtd_nfe_entrada: 24, qtd_nfse_tomada: 13 };

function respostaGet(config: Record<string, unknown> | null, envios: unknown[] = []) {
  return { data: { success: true, data: { config, envios, previa, hoje: '2026-10-02', email_loja: 'loja@gmail.com', pode_editar: true } }, error: null };
}

beforeEach(() => { invoke.mockReset(); });

describe('EnvioXmlContabilidade', () => {
  it('loja sem configuração: começa desligada, com o e-mail da loja e Gmail', async () => {
    invoke.mockResolvedValueOnce(respostaGet(null));
    render(<EnvioXmlContabilidade />);
    expect(await screen.findByText(/Envio automático desligado/)).toBeTruthy();
    expect((screen.getByPlaceholderText('loja@gmail.com') as HTMLInputElement).value).toBe('loja@gmail.com');
    expect(screen.getByText(/281 NFC-e \(\+2 canceladas\) · 24 NF-e de entrada · 13 NFS-e tomadas/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('contabilidade-xml', { body: { tenant_id: 'T1', action: 'get' } });
  });

  it('salva mandando a senha e o servidor do Gmail', async () => {
    invoke.mockResolvedValueOnce(respostaGet(null));
    render(<EnvioXmlContabilidade />);
    await screen.findByText(/Envio automático desligado/);
    fireEvent.change(screen.getByPlaceholderText('fiscal@contabilidade.com.br'), { target: { value: 'a@contab.com, b@contab.com' } });
    fireEvent.change(screen.getByPlaceholderText(/16 letras/), { target: { value: 'abcd efgh ijkl mnop' } });
    invoke.mockResolvedValueOnce({ data: { success: true, data: {} }, error: null });
    invoke.mockResolvedValueOnce(respostaGet({ enabled: false, destinatarios: ['a@contab.com', 'b@contab.com'], smtp_host: 'smtp.gmail.com', smtp_user: 'loja@gmail.com', tem_senha: true, dia_envio: 5 }));
    fireEvent.click(screen.getByText('Salvar envio'));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    const body = invoke.mock.calls[1][1].body;
    expect(body.action).toBe('salvar');
    expect(body.senha).toBe('abcd efgh ijkl mnop');
    expect(body.config.smtp_host).toBe('smtp.gmail.com');
    expect(body.config.smtp_port).toBe(465);
    expect(body.config.destinatarios).toBe('a@contab.com, b@contab.com');
    expect(await screen.findByText(/já salva/)).toBeTruthy();
  });

  it('ligada: mostra o próximo envio e só envia depois de confirmar', async () => {
    const cfg = { enabled: true, destinatarios: ['a@contab.com'], smtp_host: 'smtp.gmail.com', smtp_user: 'loja@gmail.com', tem_senha: true, dia_envio: 10 };
    invoke.mockResolvedValueOnce(respostaGet(cfg));
    render(<EnvioXmlContabilidade />);
    expect(await screen.findByText(/10\/10\/2026 às 08h10/)).toBeTruthy();
    fireEvent.click(screen.getByText('Enviar este mês'));
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValueOnce({ data: { success: true, data: { envio: { status: 'enviado' } } }, error: null });
    invoke.mockResolvedValueOnce(respostaGet(cfg));
    fireEvent.click(screen.getByText('Confirmar envio'));
    await waitFor(() => expect(invoke.mock.calls[1][1].body).toEqual({ tenant_id: 'T1', action: 'enviar_xml_mes', competencia: '2026-09' }));
  });

  it('mês já enviado: próximo envio vai para o mês seguinte; erro aparece no histórico', async () => {
    const cfg = { enabled: true, destinatarios: ['a@contab.com'], smtp_host: 'smtp.gmail.com', smtp_user: 'loja@gmail.com', tem_senha: true, dia_envio: 5 };
    const envios = [
      { id: 'e2', competencia: '2026-09-01', origem: 'manual', status: 'enviado', destinatarios: ['a@contab.com'], qtd_nfce: 281, qtd_nfce_canceladas: 0, qtd_nfe_entrada: 24, qtd_nfse_tomada: 13, tamanho_bytes: 300000, tem_arquivo: true, erro: null, created_at: '2026-10-02T12:00:00Z' },
      { id: 'e1', competencia: '2026-09-01', origem: 'automatico', status: 'erro', destinatarios: ['a@contab.com'], qtd_nfce: 0, qtd_nfce_canceladas: 0, qtd_nfe_entrada: 0, qtd_nfse_tomada: 0, tamanho_bytes: null, tem_arquivo: false, erro: 'O servidor recusou o usuário ou a senha do e-mail.', created_at: '2026-10-01T11:10:00Z' },
    ];
    invoke.mockResolvedValueOnce(respostaGet(cfg, envios));
    render(<EnvioXmlContabilidade />);
    expect(await screen.findByText(/05\/11\/2026 às 08h10/)).toBeTruthy();
    expect(screen.getByText('O servidor recusou o usuário ou a senha do e-mail.')).toBeTruthy();
    expect(screen.getAllByTitle('Baixar o .zip enviado')).toHaveLength(1);
  });
});
