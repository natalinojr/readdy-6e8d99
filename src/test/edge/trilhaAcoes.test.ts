// supabase/functions/_shared/trilha-acoes.ts: regras puras das ações da Trilha versão D (fase 2).
// Import por caminho montado em tempo de execução (mesmo padrão de guias.test.ts).
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/_shared/trilha-acoes.ts')).href;
const GUIAS = pathToFileURL(resolve(__dirname, '../../../supabase/functions/_shared/guias.ts')).href;
// deno-lint-ignore no-explicit-any
const load = () => import(/* @vite-ignore */ PATH) as Promise<any>;
// deno-lint-ignore no-explicit-any
const loadGuias = () => import(/* @vite-ignore */ GUIAS) as Promise<any>;

describe('validarParcelas (create_missing_bills)', () => {
  it('aceita parcelas que somam o total (±R$ 0,01) e arredonda os valores', async () => {
    const { validarParcelas } = await load();
    const r = validarParcelas([{ due_date: '2026-10-10', amount: 100.004 }, { due_date: '2026-11-10', amount: 50 }], 150.01);
    expect(r.ok).toBe(true);
    expect(r.parcelas).toEqual([{ due_date: '2026-10-10', amount: 100 }, { due_date: '2026-11-10', amount: 50 }]);
  });
  it('recusa soma diferente do total', async () => {
    const { validarParcelas } = await load();
    const r = validarParcelas([{ due_date: '2026-10-10', amount: 100 }], 100.5);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('R$ 100,00');
    expect(r.erro).toContain('R$ 100,50');
  });
  it('recusa data que não existe, valor zero/negativo e lista vazia', async () => {
    const { validarParcelas } = await load();
    expect(validarParcelas([{ due_date: '2026-02-30', amount: 10 }], 10).ok).toBe(false);
    expect(validarParcelas([{ due_date: '10/10/2026', amount: 10 }], 10).ok).toBe(false);
    expect(validarParcelas([{ due_date: '2026-10-10', amount: 0 }], 0).ok).toBe(false);
    expect(validarParcelas([{ due_date: '2026-10-10', amount: -5 }], -5).ok).toBe(false);
    expect(validarParcelas([], 10).ok).toBe(false);
    expect(validarParcelas(null, 10).ok).toBe(false);
  });
  it('status da conta pelo vencimento × hoje', async () => {
    const { statusPorVencimento } = await load();
    expect(statusPorVencimento('2026-09-28', '2026-09-29')).toBe('overdue');
    expect(statusPorVencimento('2026-09-29', '2026-09-29')).toBe('pending');
    expect(statusPorVencimento('2026-10-01', '2026-09-29')).toBe('pending');
  });
});

describe('janela e candidatos do paid_link_search', () => {
  it('com paid_date: −3 a +5 dias; sem: vencimento ±7; sem nenhum: null', async () => {
    const { janelaPagoExtrato } = await load();
    expect(janelaPagoExtrato('2026-09-10', '2026-09-01')).toEqual({ base: '2026-09-10', de: '2026-09-07', ate: '2026-09-15' });
    expect(janelaPagoExtrato(null, '2026-09-01')).toEqual({ base: '2026-09-01', de: '2026-08-25', ate: '2026-09-08' });
    expect(janelaPagoExtrato(null, null)).toBeNull();
  });
  it('valor pago: paid_amount; conta paga sem paid_amount = valor da conta', async () => {
    const { valorPago } = await load();
    expect(valorPago({ amount: 100, paid_amount: 98.5, status: 'paid' })).toBe(98.5);
    expect(valorPago({ amount: 100, paid_amount: null, status: 'paid' })).toBe(100);
    expect(valorPago({ amount: 100, paid_amount: 0, status: 'pending' })).toBe(0);
  });
  it('valor igual com tolerância de R$ 0,01', async () => {
    const { valorIgual } = await load();
    expect(valorIgual(100, 100.01)).toBe(true);
    expect(valorIgual(100, 100.02)).toBe(false);
  });
  it('ordena pelo |dias| e corta em 10', async () => {
    const { ordenarPorDias } = await load();
    const linhas = [
      { id: 'a', transaction_date: '2026-09-14' },
      { id: 'b', transaction_date: '2026-09-09' },
      { id: 'c', transaction_date: '2026-09-10' },
      { id: 'd', transaction_date: '2026-09-11' },
    ];
    const r = ordenarPorDias(linhas, '2026-09-10');
    expect(r.map((x: { id: string }) => x.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(r[0].dias_diferenca).toBe(0);
    expect(r[1].dias_diferenca).toBe(-1);
    expect(r[3].dias_diferenca).toBe(4);
    const muitas = Array.from({ length: 15 }, (_, i) => ({ transaction_date: `2026-09-${String(i + 1).padStart(2, '0')}` }));
    expect(ordenarPorDias(muitas, '2026-09-01')).toHaveLength(10);
  });
});

describe('boleto guardado pela tela', () => {
  it('pergunta antes quando o documento difere do saldo em mais de R$ 0,05', async () => {
    const { precisaConfirmarValor } = await load();
    expect(precisaConfirmarValor(100.05, 100)).toBe(false);
    expect(precisaConfirmarValor(100.06, 100)).toBe(true);
    expect(precisaConfirmarValor(null, 100)).toBe(false);
  });
  it('Pix copia e cola: CRC16 do BR Code conferido (validador existente em guias.ts)', async () => {
    const { crc16, copiaValida } = await loadGuias();
    const semCrc = '00020126330014BR.GOV.BCB.PIX0111123456789015204000053039865406100.005802BR5913FORNECEDOR XY6009PARANAGUA62070503***6304';
    const copia = semCrc + crc16(semCrc);
    expect(copiaValida(copia)).toBe(true);
    expect(copiaValida(semCrc + '0000')).toBe(false);
    expect(copiaValida(copia.replace('100.00', '900.00'))).toBe(false);
  });
});

describe('pedido de boleto ao fornecedor', () => {
  it('registra o pedido e conta quantas vezes', async () => {
    const { registrarPedido } = await load();
    const p1 = registrarPedido({ bill_id: 'x', vencimento: '10/09' }, '2026-09-29');
    expect(p1).toMatchObject({ bill_id: 'x', vencimento: '10/09', pedido_em: '2026-09-29', pedidos: 1, pedido_anterior: null, cobrar: false });
    const p2 = registrarPedido(p1, '2026-10-02');
    expect(p2).toMatchObject({ pedido_em: '2026-10-02', pedidos: 2, pedido_anterior: '2026-09-29' });
  });
  it('o cron preserva o pedido ao regravar o payload e marca cobrar após 2 dias', async () => {
    const { mesclarPedidoBoleto } = await load();
    const novo = { bill_id: 'x', valor: 50, vencimento: '10/09', vencida: true };
    expect(mesclarPedidoBoleto(novo, null, '2026-09-29')).toEqual(novo);
    const antigo = { ...novo, pedido_em: '2026-09-28', pedidos: 1, pedido_anterior: null, cobrar: false };
    expect(mesclarPedidoBoleto(novo, antigo, '2026-09-29')).toMatchObject({ pedido_em: '2026-09-28', pedidos: 1, cobrar: false });
    expect(mesclarPedidoBoleto(novo, antigo, '2026-09-30')).toMatchObject({ pedido_em: '2026-09-28', cobrar: true });
  });
  it('mensagem pronta: primeiro pedido e reforço', async () => {
    const { mensagemPedidoBoleto } = await load();
    const base = { loja: 'El Patrón Paranaguá', descricao: 'nota fiscal nº 123', valor: 1234.5, vencimento: '2026-09-20', hoje: '2026-09-29' };
    expect(mensagemPedidoBoleto(base)).toBe('Olá! Aqui é do El Patrón Paranaguá. Precisamos do boleto (ou da chave Pix) da nota fiscal nº 123, no valor de R$ 1.234,50, que venceu em 20/09. Pode nos enviar? Obrigado!');
    expect(mensagemPedidoBoleto({ ...base, vencimento: '2026-10-05' })).toContain('que vence em 05/10');
    expect(mensagemPedidoBoleto({ ...base, pedidoAnterior: '2026-09-25' }))
      .toBe('Olá! Reforçando o pedido de 25/09: aqui é do El Patrón Paranaguá. Precisamos do boleto (ou da chave Pix) da nota fiscal nº 123, no valor de R$ 1.234,50, que venceu em 20/09. Pode nos enviar? Obrigado!');
  });
  it('nome sem acento/caixa para casar o fornecedor', async () => {
    const { normNome } = await load();
    expect(normNome('Açougue São João LTDA.')).toBe(normNome('ACOUGUE SAO JOAO ltda'));
  });
});
