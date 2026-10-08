import { describe, it, expect } from 'vitest';
import {
  linhaConta, linhaSaida, linhaNota, linhaPaga, linhasAbertas, numeros, mesmoDiaNoMes, nomeDoDia, preverDia, baseProjecao,
  saldosPorLinha, fimDaSemana, type ContaAberta, type DadosPainel,
} from '@/lib/contasPainel';

const HOJE = '2026-10-07'; // quarta
const conta = (o: Partial<ContaAberta>): ContaAberta => ({
  id: 'c', nome: 'Fornecedor', descricao: null, valor: 100, total: 100, vencimento: '2026-10-10', status: 'pending', origem: 'purchase',
  reference_id: 'p', forma: 'Boleto', tem_boleto: false, boleto_origem: null, ja_paga: false, parcela: 1, parcelas: 1, fixa: false,
  compra_id: 'p', nf: '123', nf_sefaz: true, nf_emitida: '2026-10-03', compra_em: '2026-10-03', chegou_em: '2026-10-05', espera_chegar: true, ...o,
});

describe('andamento e situação de uma conta', () => {
  it('com nota e mercadoria confirmada: pode pagar, nos grupos por semana', () => {
    const l = linhaConta(conta({}), HOJE);
    expect(l.passos).toEqual(['ok', 'ok', 'esp']);
    expect(l.situacao).toBe('pode');
    expect(l.grupo).toBe('sem');
    expect(linhaConta(conta({ vencimento: '2026-10-14' }), HOJE).grupo).toBe('prox');
    expect(linhaConta(conta({ vencimento: '2026-10-21' }), HOJE).grupo).toBe('dep');
  });
  it('vencida: Pago vira atraso; se a mercadoria não chegou, o passo é cobrar a loja', () => {
    expect(linhaConta(conta({ vencimento: '2026-10-06' }), HOJE)).toMatchObject({ situacao: 'venc_pagar', grupo: 'venc', atrasada: true });
    const l = linhaConta(conta({ vencimento: '2026-10-06', chegou_em: null, nf_emitida: '2026-10-06' }), HOJE);
    expect(l.passos[1]).toBe('esp');
    expect(l.situacao).toBe('venc_cobrar');
  });
  it('mercadoria sem confirmação há mais de 3 dias da nota vira problema mesmo antes de vencer', () => {
    const l = linhaConta(conta({ vencimento: '2026-10-20', chegou_em: null, nf_emitida: '2026-10-01' }), HOJE);
    expect(l.passos[1]).toBe('no');
    expect(l.situacao).toBe('cobrar');
  });
  it('compra que não espera entrega (à vista) não mostra o passo Chegou', () => {
    expect(linhaConta(conta({ chegou_em: null, espera_chegar: false }), HOJE).passos[1]).toBe('na');
  });
  it('conta fixa com boleto: o boleto vale como documento; cartão aparece como "no cartão"', () => {
    const f = linhaConta(conta({ compra_id: null, nf: null, fixa: true, tem_boleto: true, boleto_origem: 'email', origem: null, espera_chegar: false }), HOJE);
    expect(f.passos).toEqual(['ok', 'na', 'esp']);
    expect(f.sub).toContain('boleto por e-mail');
    expect(linhaConta(conta({ forma: 'Cartão de crédito' }), HOJE).situacao).toBe('cartao');
  });
  it('saída sem explicação, nota sem conta e paga', () => {
    expect(linhaSaida({ id: 's', data: '2026-08-13', valor: 43.66, descricao: 'Pix enviado', source: 'inter', tipo: 'debit' }, HOJE))
      .toMatchObject({ passos: ['amb', 'na', 'ok'], grupo: 'semexp', situacao: 'semexp' });
    expect(linhaNota({ id: 'n:1', doc_id: 'n', nome: 'OESA', numero: '42', emitida: '2026-09-01', valor: 10, vencimento: '2026-09-10', parcela: 1, parcelas: 1 }, HOJE))
      .toMatchObject({ grupo: 'sem_conta', atrasada: true });
    const p = { id: 'g', nome: 'X', descricao: null, valor: 5, pago_em: '2026-10-05', forma: 'Pix', origem: 'purchase', fixa: false, nf: '1', chegou_em: '2026-10-02', banco: true };
    expect(linhaPaga(p, HOJE).passos).toEqual(['ok', 'ok', 'ok']);
    expect(linhaPaga({ ...p, banco: false }, HOJE)).toMatchObject({ situacao: 'pago_sem_banco', passos: ['ok', 'ok', 'meio'] });
  });
});

const dados = (o: Partial<DadosPainel> = {}): DadosPainel => ({
  hoje: HOJE, inicio: null, pagas: [], notas_sem_conta: [], extrato_pendente: [], vendas: [], ifood: [],
  saldos: [{ id: 'b', nome: 'Banco', saldo: 1000, atualizado_em: '2026-10-08T02:17:00Z', integrado: true }],
  abertas: [conta({ id: 'v', vencimento: '2026-10-06', valor: 300 }), conta({ id: 'a', vencimento: '2026-10-08', valor: 100 }),
    conta({ id: 'j', ja_paga: true, valor: 999 })],
  ...o,
});

describe('números do topo', () => {
  it('soma o que é a pagar de verdade (sem compra já paga), as vencidas e a semana', () => {
    const d = dados({ notas_sem_conta: [{ id: 'n:1', doc_id: 'n', nome: 'N', numero: '1', emitida: '2026-10-01', valor: 50, vencimento: '2026-10-30', parcela: 1, parcelas: 1 }],
      extrato_pendente: [{ id: 's', data: '2026-10-01', valor: 20, descricao: null, source: 'inter', tipo: 'debit' }, { id: 'e', data: '2026-10-01', valor: 7, descricao: null, source: 'inter', tipo: 'credit' }] });
    const n = numeros(d, linhasAbertas(d));
    expect(n.aPagar).toEqual({ v: 450, n: 3 });
    expect(n.vencidas).toEqual({ v: 300, n: 1 });
    expect(n.semana).toEqual({ v: 100, n: 1 });
    expect(n.saidas).toEqual({ v: 20, n: 1 });
    expect(n.entradasPendentes).toEqual({ v: 7, n: 1 });
    expect(n.saldo.v).toBe(1000);
  });
});

describe('projeção: mesmo dia da semana na mesma semana do mês', () => {
  it('acha a 2ª quinta e a 5ª quinta (que nem todo mês tem)', () => {
    expect(mesmoDiaNoMes('2026-09', 4, 2)).toBe('2026-09-10');
    expect(mesmoDiaNoMes('2026-09', 4, 5)).toBeNull();
    expect(mesmoDiaNoMes('2026-07', 4, 5)).toBe('2026-07-30');
    expect(nomeDoDia('2026-10-10')).toBe('2º sábado');
    expect(fimDaSemana(HOJE)).toBe('2026-10-11');
  });
  it('dia com caixa registrado usa o total real; sem registro estima pela proporção do cartão', () => {
    const vendas = [
      { d: '2026-07-09', pdv_total: null, pdv_cartao: null, adq_cartao: 500, adq_taxa: 5 },   // estimado
      { d: '2026-08-13', pdv_total: 900, pdv_cartao: 450, adq_cartao: 450, adq_taxa: 4.5 },  // real
      { d: '2026-09-10', pdv_total: 1000, pdv_cartao: 500, adq_cartao: 500, adq_taxa: 5 },   // real
    ];
    const b = baseProjecao(vendas, HOJE);
    expect(b.parteCartao).toBeCloseTo(0.5, 5);            // nos dias com caixa, cartão = 50%
    const p = preverDia('2026-10-08', HOJE, 3, b);       // 2ª quinta
    expect(p.exemplos.map((e) => e.d)).toEqual(['2026-09-10', '2026-08-13', '2026-07-09']);
    expect(p.exemplos[2]).toMatchObject({ vendas: 1000, estimado: true });
    expect(p.vendas).toBeCloseTo((1000 + 900 + 1000) / 3, 2);
    expect(p.estimado).toBe(true);
    expect(preverDia('2026-10-08', HOJE, 1, b).exemplos.map((e) => e.d)).toEqual(['2026-09-10']);
  });
  it('dia anterior ao primeiro registro não entra na média como zero', () => {
    const b = baseProjecao([{ d: '2026-09-10', pdv_total: 800, pdv_cartao: 400, adq_cartao: null, adq_taxa: null }], HOJE);
    expect(preverDia('2026-10-08', HOJE, 6, b).exemplos).toHaveLength(1);
  });
  it('5ª semana que não existe na janela usa a 4ª', () => {
    const b = baseProjecao([{ d: '2026-09-24', pdv_total: 700, pdv_cartao: 350, adq_cartao: null, adq_taxa: null }], HOJE);
    const p = preverDia('2026-10-29', HOJE, 1, b);
    expect(p.trocouSemana).toBe(true);
    expect(p.exemplos[0].d).toBe('2026-09-24');
  });
});

describe('saldo depois e projetado', () => {
  it('desconta as contas em ordem (vencida = hoje) e soma vendas previstas e repasses até a data', () => {
    const d = dados({
      vendas: [{ d: '2026-09-10', pdv_total: 200, pdv_cartao: 0, adq_cartao: null, adq_taxa: null }],
      ifood: [{ data: '2026-10-08', valor: 50 }],
    });
    const s = saldosPorLinha(linhasAbertas(d), 1000, d, 1);
    expect(s.get('v')).toMatchObject({ real: 700, proj: 700 });          // paga hoje, nada entrou ainda
    expect(s.get('a')).toMatchObject({ real: 600, vendas: 200, apps: 50, proj: 850 });
    expect(s.has('j')).toBe(false);
  });
});
