import { describe, it, expect } from 'vitest';
import {
  resumoFixas, grupoMercadoria, trilhos, pacoteDaSemana, proximoDiaDePagar, caixaDaLoja, textoEsperando,
  type ContaFixa, type Mercadoria, type CaixaLoja,
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
