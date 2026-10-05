import { describe, it, expect } from 'vitest';
import {
  avisosDeConfirmacao, bateCerto, beneficiarioContradiz, codigoDoBoleto, contaParaGravarSozinho, diferencas, mesmoNome, palavrasDoNome, umFornecedorSo,
  type Candidata, type Lido,
} from '@/lib/boletoFoto';

const lido = (p: Partial<Lido> = {}): Lido => ({ beneficiario: 'Forn', valor: 1200, vencimento: '2026-10-12', linha_digitavel: null, pix_copia_e_cola: null, ...p });
const cand = (p: Partial<Candidata> = {}): Candidata => ({ bill_id: 'b1', fornecedor: 'Forn', saldo: 1200, vencimento: '2026-10-12', bate_valor: true, bate_vencimento: true, ...p });

describe('codigoDoBoleto', () => {
  it('prefere a linha digitável, depois o Pix lido, depois o QR do aparelho', () => {
    expect(codigoDoBoleto(lido({ linha_digitavel: '123', pix_copia_e_cola: '000201x' }), '000201y')).toEqual({ linha: '123' });
    expect(codigoDoBoleto(lido({ pix_copia_e_cola: '000201x' }), '000201y')).toEqual({ copia_e_cola: '000201x' });
    expect(codigoDoBoleto(lido(), ' 000201y ')).toEqual({ copia_e_cola: '000201y' });
  });
  it('QR que não é Pix não vale; sem nada = null', () => {
    expect(codigoDoBoleto(lido(), 'https://exemplo.com')).toBeNull();
    expect(codigoDoBoleto(lido(), null)).toBeNull();
  });
});

describe('bateCerto', () => {
  it('valor igual E vencimento igual (os dois conferidos)', () => {
    expect(bateCerto(cand())).toBe(true);
  });
  it('vencimento que o boleto não diz (Pix, concessionária) NÃO é "bateu"', () => {
    expect(bateCerto(cand({ bate_vencimento: null }))).toBe(false);
  });
  it('valor diferente, valor ilegível ou vencimento diferente não bate', () => {
    expect(bateCerto(cand({ bate_valor: false }))).toBe(false);
    expect(bateCerto(cand({ bate_valor: null }))).toBe(false);
    expect(bateCerto(cand({ bate_vencimento: false }))).toBe(false);
  });
});

describe('diferencas', () => {
  it('vazio quando bate', () => expect(diferencas(cand(), lido())).toEqual([]));
  it('diz valor e vencimento que diferem', () => {
    const d = diferencas(cand({ bate_valor: false, bate_vencimento: false, saldo: 1250, vencimento: '2026-10-10' }), lido());
    expect(d).toHaveLength(2);
    expect(d[0]).toContain('1.200,00');
    expect(d[0]).toContain('1.250,00');
    expect(d[1]).toContain('12/10');
    expect(d[1]).toContain('10/10');
  });
  it('avisa quando o valor não foi lido', () => {
    expect(diferencas(cand({ bate_valor: null }), lido({ valor: null }))[0]).toContain('valor');
  });
});

describe('nomes: sem acento, sem sufixo, sem ligação', () => {
  it('palavrasDoNome', () => {
    expect(palavrasDoNome('Comércio de Bebidas Silva LTDA - ME')).toEqual(['bebidas', 'silva']);
    expect(palavrasDoNome('AMBEV S.A.')).toEqual(['ambev']);
    expect(palavrasDoNome('Casa & Cia')).toEqual(['casa']); // "casa" não vira "ca" + "sa"
    expect(palavrasDoNome(null)).toEqual([]);
  });
  it('mesmoNome: acento/caixa/sufixo não contam; nome outro contradiz; sem nome = null', () => {
    expect(mesmoNome('AMBEV S.A.', 'Ambev')).toBe(true);
    expect(mesmoNome('Distribuidora São João Ltda', 'Sao Joao Bebidas')).toBe(true);
    expect(mesmoNome('Copel Distribuição S.A.', 'Copel')).toBe(true);
    expect(mesmoNome('Fulano de Tal ME', 'Ambev')).toBe(false);
    expect(mesmoNome(null, 'Ambev')).toBeNull();
    expect(mesmoNome('LTDA', 'Ambev')).toBeNull();
  });
  it('beneficiarioContradiz: só quando o nome foi lido e é de outro', () => {
    expect(beneficiarioContradiz(cand({ fornecedor: 'Ambev' }), lido({ beneficiario: 'AMBEV SA' }))).toBe(false);
    expect(beneficiarioContradiz(cand({ fornecedor: 'Ambev' }), lido({ beneficiario: 'Outra Empresa Ltda' }))).toBe(true);
    expect(beneficiarioContradiz(cand({ fornecedor: 'Ambev' }), lido({ beneficiario: null }))).toBe(false);
  });
  it('umFornecedorSo', () => {
    expect(umFornecedorSo([cand({ bill_id: 'a', fornecedor: 'Ambev' }), cand({ bill_id: 'b', fornecedor: 'AMBEV S.A.' })])).toBe(true);
    expect(umFornecedorSo([cand({ bill_id: 'a', fornecedor: 'Ambev' }), cand({ bill_id: 'b', fornecedor: 'Coca-Cola' })])).toBe(false);
  });
});

describe('contaParaGravarSozinho (dinheiro: na dúvida, pergunta)', () => {
  const ambev = (p: Partial<Candidata> = {}) => cand({ fornecedor: 'Ambev', ...p });
  const l = lido({ beneficiario: 'AMBEV S.A.' });
  it('valor + vencimento + um fornecedor + beneficiário confere: grava sozinho', () => {
    expect(contaParaGravarSozinho([ambev()], l)?.bill_id).toBe('b1');
  });
  it('mesmo fornecedor com várias contas e só uma bate: grava nela', () => {
    expect(contaParaGravarSozinho([ambev(), ambev({ bill_id: 'b2', saldo: 300, bate_valor: false })], l)?.bill_id).toBe('b1');
  });
  it('Pix/concessionária sem vencimento: pergunta', () => {
    expect(contaParaGravarSozinho([ambev({ bate_vencimento: null })], lido({ vencimento: null }))).toBeNull();
  });
  it('duas contas batem: pergunta qual', () => {
    expect(contaParaGravarSozinho([ambev(), ambev({ bill_id: 'b2' })], l)).toBeNull();
  });
  it('contas de fornecedores diferentes: pergunta, mesmo que uma bata', () => {
    expect(contaParaGravarSozinho([ambev(), cand({ bill_id: 'b2', fornecedor: 'Coca-Cola', saldo: 300, bate_valor: false })], l)).toBeNull();
  });
  it('beneficiário lido é de outro: pergunta (mesmo valor e vencimento)', () => {
    expect(contaParaGravarSozinho([ambev()], lido({ beneficiario: 'Fulano de Tal ME' }))).toBeNull();
  });
  it('beneficiário não lido: não contradiz, grava', () => {
    expect(contaParaGravarSozinho([ambev()], lido({ beneficiario: null }))?.bill_id).toBe('b1');
  });
  it('valor ou vencimento diferente: pergunta', () => {
    expect(contaParaGravarSozinho([ambev({ bate_valor: false })], l)).toBeNull();
    expect(contaParaGravarSozinho([ambev({ bate_vencimento: false })], l)).toBeNull();
  });
});

describe('avisosDeConfirmacao', () => {
  it('nada quando tudo confere', () => expect(avisosDeConfirmacao(cand(), lido())).toEqual([]));
  it('beneficiário de outro e vencimento não lido', () => {
    const a = avisosDeConfirmacao(cand({ fornecedor: 'Ambev', bate_vencimento: null }), lido({ beneficiario: 'Fulano ME' }));
    expect(a).toHaveLength(2);
    expect(a[0]).toContain('Fulano ME');
    expect(a[0]).toContain('Ambev');
    expect(a[1]).toContain('vencimento');
  });
});
