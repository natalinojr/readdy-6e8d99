import { describe, it, expect } from 'vitest';
import { montarMensagem, dividirFrases, semFraseCom, COMPLEMENTO_SEM_CUPOM } from '@/pages/clientes/funilMensagem';

// Textos reais das regras padrão do funil (crm_rules.mensagem em produção).
const REGRAS: Record<string, string> = {
  carrinho_abandonado: 'Oi, {nome}! Vi que você montou um pedido e não finalizou 😅 Se ficou faltando um empurrãozinho, usa esse cupom: {cupom} — {link}',
  nunca_comprou: 'Oi, {nome}! Você se cadastrou no nosso delivery mas ainda não experimentou a gente. Separei {cupom} pra sua estreia: {link}',
  primeira_compra: 'Oi, {nome}! Que bom ter você com a gente 🙌 Pra sua próxima: {cupom} — {link}',
  em_risco: 'Oi, {nome}! Faz um tempinho que você não pede com a gente e a gente sentiu falta 😊 Toma {cupom}: {link}',
  perdido: 'Oi, {nome}! Já faz um bom tempo... Mudou muita coisa por aqui e queria muito te ver de volta: {cupom} — {link}',
};
const BASE = { nome: 'Maria Silva', loja: 'Vila Leste' };

describe('montarMensagem — Chamar sem voucher', () => {
  for (const [estagio, modelo] of Object.entries(REGRAS)) {
    it(`${estagio}: não vira só a saudação e não deixa marcador nem "cupom:"`, () => {
      const msg = montarMensagem(modelo, { ...BASE, estagio });
      expect(msg.startsWith('Oi, Maria!')).toBe(true);
      expect(msg).not.toBe('Oi, Maria!');
      expect(msg.length).toBeGreaterThan('Oi, Maria!'.length + 10);
      expect(msg).not.toContain('{');
      expect(msg).not.toContain('}');
      expect(msg.toLowerCase()).not.toContain('cupom:');
      expect(msg).not.toContain('—');
      expect(msg).not.toMatch(/\s{2,}/);
    });
  }

  it('mantém as frases que não citam cupom/link e fecha com a pergunta do estágio', () => {
    expect(montarMensagem(REGRAS.carrinho_abandonado, { ...BASE, estagio: 'carrinho_abandonado' }))
      .toBe('Oi, Maria! Vi que você montou um pedido e não finalizou 😅 ' + COMPLEMENTO_SEM_CUPOM.carrinho_abandonado);
    expect(montarMensagem(REGRAS.em_risco, { ...BASE, estagio: 'em_risco' }))
      .toBe('Oi, Maria! Faz um tempinho que você não pede com a gente e a gente sentiu falta 😊 ' + COMPLEMENTO_SEM_CUPOM.em_risco);
    expect(montarMensagem(REGRAS.nunca_comprou, { ...BASE, estagio: 'nunca_comprou' }))
      .toBe('Oi, Maria! Você se cadastrou no nosso delivery mas ainda não experimentou a gente. ' + COMPLEMENTO_SEM_CUPOM.nunca_comprou);
  });

  it('perdido: texto que termina em reticências ganha o fecho do estágio', () => {
    expect(montarMensagem(REGRAS.perdido, { ...BASE, estagio: 'perdido' }))
      .toBe('Oi, Maria! Já faz um bom tempo... ' + COMPLEMENTO_SEM_CUPOM.perdido);
  });

  it('só a saudação sobrando: acrescenta o complemento do estágio', () => {
    const msg = montarMensagem('Oi, {nome}! Use {cupom} no pedido: {link}', { ...BASE, estagio: 'carrinho_abandonado' });
    expect(msg).toBe('Oi, Maria! ' + COMPLEMENTO_SEM_CUPOM.carrinho_abandonado);
  });

  it('estágio desconhecido usa o complemento genérico (nunca só a saudação)', () => {
    const msg = montarMensagem('Oi, {nome}! Use {cupom} no pedido: {link}', BASE);
    expect(msg).not.toBe('Oi, Maria!');
    expect(msg.startsWith('Oi, Maria! ')).toBe(true);
  });

  it('mensagem sem marcador de cupom não ganha complemento', () => {
    expect(montarMensagem('Oi, {nome}! Tudo bem? Aqui é da {loja} 😊', { ...BASE, estagio: 'fiel' }))
      .toBe('Oi, Maria! Tudo bem? Aqui é da Vila Leste 😊');
  });

  it('cupom sem link: tira a frase do link (o cupom sozinho não serve)', () => {
    const msg = montarMensagem(REGRAS.nunca_comprou, { ...BASE, cupom: 'ABC123', estagio: 'nunca_comprou' });
    expect(msg).not.toContain('{');
    expect(msg).not.toContain('ABC123');
    expect(msg).not.toBe('Oi, Maria!');
  });
});

describe('montarMensagem — com cupom e link', () => {
  for (const [estagio, modelo] of Object.entries(REGRAS)) {
    it(`${estagio}: troca todos os marcadores e não corta nada`, () => {
      const msg = montarMensagem(modelo, { ...BASE, cupom: 'ABC123', link: 'erpos.app/v/x', estagio });
      expect(msg).toContain('ABC123');
      expect(msg).toContain('erpos.app/v/x');
      expect(msg).toContain('Maria');
      expect(msg).not.toContain('Silva');
      expect(msg).not.toContain('{');
      // Sem complemento: a mensagem completa só troca marcadores.
      for (const c of Object.values(COMPLEMENTO_SEM_CUPOM)) expect(msg).not.toContain(c);
    });
  }

  it('troca {loja} também', () => {
    expect(montarMensagem('Oi, {nome}! Aqui é da {loja}: {cupom} — {link}', { ...BASE, cupom: 'X1', link: 'l.co' }))
      .toBe('Oi, Maria! Aqui é da Vila Leste: X1 — l.co');
  });
});

describe('dividirFrases / semFraseCom', () => {
  it('divide depois de ponto, !, ?, … e emoji', () => {
    expect(dividirFrases('Oi! Tudo bem? Vi 😅 Bora… Fim.')).toEqual(['Oi!', 'Tudo bem?', 'Vi 😅', 'Bora…', 'Fim.']);
  });

  it('emoji com seletor de variação ou tom de pele fecha a frase', () => {
    expect(dividirFrases('Obrigado ❤️ Volte sempre')).toEqual(['Obrigado ❤️', 'Volte sempre']);
    expect(dividirFrases('Valeu 👍🏽 Até já')).toEqual(['Valeu 👍🏽', 'Até já']);
  });

  it('não divide dentro de palavras nem em números', () => {
    expect(dividirFrases('Pague R$ 10,50 hoje')).toEqual(['Pague R$ 10,50 hoje']);
  });

  it('semFraseCom tira só a frase do marcador', () => {
    expect(semFraseCom('Oi! Vi 😅 Use {cupom} hoje', '{cupom}')).toBe('Oi! Vi 😅');
  });

  it('se todas as frases citam o marcador, tira só o marcador', () => {
    expect(semFraseCom('Use {cupom}', '{cupom}')).toBe('Use ');
  });
});
