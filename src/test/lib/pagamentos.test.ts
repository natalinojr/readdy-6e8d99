import { describe, it, expect } from 'vitest';
import {
  resumoFixas, grupoMercadoria, trilhos, pacoteDaSemana, proximoDiaDePagar, caixaDaLoja, textoEsperando, precisaAgora,
  type ContaFixa, type Mercadoria, type CaixaLoja, type ContaAberta,
} from '@/lib/pagamentos';

const fixa = (o: Partial<ContaFixa>): ContaFixa => ({
  tenant_id: 't', loja: 'L', conta_fixa_id: null, categoria_id: 'c', categoria: 'Luz', chave: 'copel', nome: 'Copel',
  situacao: 'auto', confirmar: false, sem_documento: false, valor_fixo: null, criar_dias_antes: 5, dia_vence: 13, dia_chega: 10,
  meses_hist: 3, media: 1700, ultimo_valor: 1800, so_extrato: false, estado: 'esperando', valor_mes: null, saldo: null,
  vence_em: null, pago_em: null, chegou_em: null, fora_pct: null, contas: [], historico: [], mes: '2026-10-01', ...o,
});

const compra = (o: Partial<Mercadoria>): Mercadoria => ({
  tipo: 'compra', id: 'p', tenant_id: 't', loja: 'L', fornecedor: 'BeeMax', numero: '905', emitida: '2026-10-01', valor: 596,
  bonus: false, chegou_em: '2026-10-02', diferente: false, itens: 7, itens_ligados: 5,
  contas: [{ id: 'b1', valor: 596, saldo: 596, vence: '2026-10-07', status: 'pending', pago_em: null, tem_boleto: true, boleto: true }], ...o,
});

describe('contas fixas', () => {
  it('conta o mês sem as de confirmar e sem as que não vêm', () => {
    const r = resumoFixas([
      fixa({ estado: 'paga' }), fixa({ estado: 'vence_hoje' }), fixa({ estado: 'a_pagar' }), fixa({ estado: 'atrasada_chegar' }),
      fixa({ estado: 'nao_vem' }), fixa({ estado: 'esperando', confirmar: true }),
    ]);
    expect(r).toMatchObject({ total: 4, pagas: 1, urgentes: 1, aPagar: 1, naoChegaram: 1, confirmar: 1 });
  });
  it('explica quando a conta costuma chegar', () => {
    expect(textoEsperando(fixa({}))).toContain('chegar até o dia 10');
    expect(textoEsperando(fixa({ so_extrato: true }))).toContain('sem conta lançada');
    expect(textoEsperando(fixa({ sem_documento: true, dia_vence: 10 }))).toContain('lança sozinho 5 dias antes do dia 10');
  });
});

describe('mercadoria a prazo', () => {
  it('não chegou = não pague ainda', () => {
    expect(grupoMercadoria(compra({ chegou_em: null }), {})).toBe('nao_pague');
  });
  it('chegou diferente = não pague ainda', () => {
    expect(grupoMercadoria(compra({ diferente: true }), {})).toBe('nao_pague');
  });
  it('aviso do servidor (ex.: pago antes) = não pague ainda', () => {
    expect(grupoMercadoria(compra({}), { b1: [{ tipo: 'pago_antes', texto: 'x' }] })).toBe('nao_pague');
  });
  it('compra que não precisa chegar (compra online, nota de despesa) não fica em "não pague"', () => {
    expect(grupoMercadoria(compra({ chegou_em: null, espera_chegar: false }), {})).toBe('pronta');
    expect(trilhos(compra({ chegou_em: null, espera_chegar: false })).dinheiro[2]).toBe('agora');
  });
  it('conta já paga em parte não entra no pacote (o boleto pagaria o valor cheio)', () => {
    const c = { tenant_id: 't', loja: 'L', no_banco: 0, n_bancos: 1, contas: [{ id: 'p', nome: 'X', descricao: null, valor: 50, vencimento: '2026-10-07', tem_boleto: true, origem: 'purchase', parcial: true }] };
    const p = pacoteDaSemana([c], {}, '2026-10-06', 2);
    expect(p.prontas).toHaveLength(0);
    expect(p.semJeito.map((x) => x.id)).toEqual(['p']);
  });
  it('bonificação não espera chegar', () => {
    expect(grupoMercadoria(compra({ bonus: true, chegou_em: null }), {})).toBe('pronta');
  });
  it('boleto sem o código = sem boleto ainda (só aviso, sem alerta)', () => {
    expect(grupoMercadoria(compra({ contas: [{ ...compra({}).contas[0], tem_boleto: false }] }), {})).toBe('sem_boleto');
  });
  it('chegou certo e tem boleto = pronta; tudo pago = paga', () => {
    expect(grupoMercadoria(compra({}), {})).toBe('pronta');
    expect(grupoMercadoria(compra({ contas: [{ ...compra({}).contas[0], status: 'paid' }] }), {})).toBe('paga');
  });
  it('itens no estoque não travam o pagamento (não entram nos trilhos)', () => {
    const t = trilhos(compra({ itens_ligados: 0 }));
    expect(t.mercadoria).toEqual(['ok', 'ok', 'ok']);
    expect(t.dinheiro).toEqual(['ok', 'ok', 'agora']);
  });
  it('não chegou: pagar fica esperando', () => {
    expect(trilhos(compra({ chegou_em: null })).dinheiro[2]).toBe('espera');
  });
});

describe('pacote da semana', () => {
  const caixa: CaixaLoja = {
    tenant_id: 't', loja: 'L', no_banco: 5000, n_bancos: 1, contas: [
      { id: 'a', nome: 'BeeMax', descricao: null, valor: 596, vencimento: '2026-10-07', tem_boleto: true, origem: 'purchase' },
      { id: 'b', nome: 'Cozinha', descricao: null, valor: 5553, vencimento: '2026-10-09', tem_boleto: true, origem: 'purchase' },
      { id: 'c', nome: 'Encarta', descricao: null, valor: 258, vencimento: '2026-10-08', tem_boleto: false, origem: 'purchase' },
      { id: 'd', nome: 'Marcelle', descricao: null, valor: 100, vencimento: '2026-10-06', tem_boleto: false, origem: 'freelancer' },
      { id: 'e', nome: 'Longe', descricao: null, valor: 50, vencimento: '2026-10-20', tem_boleto: true, origem: 'manual' },
    ],
  };
  it('próximo dia de pagar conta hoje', () => {
    expect(proximoDiaDePagar('2026-10-06', 2)).toBe('2026-10-06'); // terça
    expect(proximoDiaDePagar('2026-10-07', 2)).toBe('2026-10-13');
  });
  it('separa pronta, com aviso e sem jeito de pagar; freela fica fora', () => {
    const p = pacoteDaSemana([caixa], { b: [{ tipo: 'nao_chegou', texto: 'x' }] }, '2026-10-06', 2);
    expect(p.ate).toBe('2026-10-12');
    expect(p.prontas.map((x) => x.id)).toEqual(['a']);
    expect(p.comAviso.map((x) => x.id)).toEqual(['b']);
    expect(p.semJeito.map((x) => x.id)).toEqual(['c']);
    expect(p.total).toBe(596);
  });
  it('saldo × o que vence usa a régua do aviso Caixa da semana', () => {
    const c = caixaDaLoja(caixa, '2026-10-06')!;
    expect(c.precisa).toBeCloseTo(596 + 5553 + 258 + 100);
    expect(c.cobre).toBe(false);
    expect(caixaDaLoja({ ...caixa, n_bancos: 0 }, '2026-10-06')).toBeNull();
  });
});

describe('precisa de você agora (revisão de completude, 2026-10-06)', () => {
  const conta = (o: Partial<ContaAberta>): ContaAberta => ({
    id: 'x', tenant_id: 't', loja: 'L', nome: 'Celina', descricao: null, valor: 700, total: 700, vencimento: '2026-09-30',
    status: 'pending', origem: 'nfe_entrada', tipo: 'outras', purchase_id: null, forma: null, tem_boleto: false, parcial: false,
    fora_pacote: false, cartao: false, boleto_pedido_em: null, no_inter: false, ...o,
  });
  const base = { mercadoria: [], fixas: [], avisos: {}, notas: [], servicos: [], avulsos: [], pessoas: [], inter: [], hoje: '2026-10-06', mostrarLoja: false };
  it('qualquer conta vencida entra, de qualquer tipo, e leva para a seção do tipo', () => {
    const l = precisaAgora({ ...base, contas: [conta({}), conta({ id: 'p', tipo: 'pessoas', origem: 'hr_beneficio' }), conta({ id: 'f', tipo: 'fixa', vencimento: '2026-10-06' })] });
    expect(l.map((i) => [i.pill, i.ver])).toEqual([['Vencida', 'avulsos'], ['Vencida', 'pessoas'], ['Vence hoje', 'fixas']]);
    expect(l[0].detalhe).toContain('sem boleto nem Pix guardado');
  });
  it('compra paga na entrega e conta já enviada ao Inter não aparecem como vencida', () => {
    const l = precisaAgora({ ...base, contas: [conta({ tipo: 'ja_paga' }), conta({ id: 'i', no_inter: true })],
      inter: [{ id: 'ip', tenant_id: 't', loja: 'L', valor: 50, para: 'X', tipo: 'pix', status: 'pending_approval', bill_id: 'i', enviado_em: '2026-10-06' }] });
    expect(l.map((i) => i.chave)).toEqual(['inter']);
  });
  it('boleto pedido aparece no texto', () => {
    const l = precisaAgora({ ...base, contas: [conta({ boleto_pedido_em: '2026-10-02T10:00:00Z' })] });
    expect(l[0].detalhe).toContain('boleto pedido em 02/10');
  });
  it('notas e serviços sem lançar viram uma linha cada, não uma por nota', () => {
    const nota = { tipo: 'nota' as const, id: 'n', tenant_id: 't', loja: 'L', fornecedor: 'F', numero: '1', emitida: '2026-08-01', valor: 10, parcelas: [{ vencimento: '2026-08-20' }] };
    const l = precisaAgora({ ...base, contas: [], notas: [nota, { ...nota, id: 'n2', parcelas: [] }],
      servicos: [{ id: 's', tenant_id: 't', loja: 'L', fornecedor: 'Celina', numero: '9', emitida: '2026-09-30', valor: 435 }] });
    expect(l.map((i) => i.chave)).toEqual(['notas', 'servicos']);
    expect(l[0].titulo).toContain('2 notas de mercadoria');
    expect(l[0].tom).toBe('red');
  });
  it('mercadoria vencida não aparece duas vezes', () => {
    const m = { tipo: 'compra' as const, id: 'pc', tenant_id: 't', loja: 'L', fornecedor: 'OESA', numero: '1', emitida: '2026-09-01', valor: 100,
      bonus: false, chegou_em: null, espera_chegar: true, diferente: false, itens: 1, itens_ligados: 1,
      contas: [{ id: 'b', valor: 100, saldo: 100, vence: '2026-09-30', status: 'pending', pago_em: null, tem_boleto: true, boleto: true }] };
    const l = precisaAgora({ ...base, mercadoria: [m], contas: [conta({ id: 'b', tipo: 'mercadoria', origem: 'purchase', tem_boleto: true })] });
    expect(l).toHaveLength(1);
    expect(l[0].pill).toBe('Vencida');
  });
});
