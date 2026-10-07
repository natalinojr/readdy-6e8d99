import { describe, expect, it } from 'vitest';
import { cpfValido, descontoDasReservas, avisosConfig, avisosConfigPorSecao, chancesRoleta, configPadrao, distribuirNiveis, nivelPorCompras, normalizarConfig, retornoPercentual, rotuloPremio, usosDaRecompensa } from '@/lib/fidelidade';

describe('fidelidade', () => {
  it('config vazia vira o padrão e valores fora de faixa são cortados', () => {
    const c = normalizarConfig({ pontos: { pontos_por_real: -5, validade_meses: 999 }, trilha: { niveis: [{ nome: 'B', min_compras: 10 }, { nome: 'A', min_compras: 2 }] } });
    expect(c.pontos.pontos_por_real).toBe(0);
    expect(c.pontos.validade_meses).toBe(60);
    expect(c.trilha.niveis.map((n) => n.nome)).toEqual(['A', 'B']);
    expect(normalizarConfig(null).recompensas.length).toBe(configPadrao().recompensas.length);
    expect(normalizarConfig({ recompensas: [] }).recompensas).toEqual([]);
  });

  it('nível pelo número de compras e distribuição da base', () => {
    const { niveis } = configPadrao().trilha; // 1, 5, 12, 24
    expect(nivelPorCompras(0, niveis)).toBeNull();
    expect(nivelPorCompras(4, niveis)?.nome).toBe('Bronze');
    expect(nivelPorCompras(12, niveis)?.nome).toBe('Ouro');
    const { porNivel, fora } = distribuirNiveis([{ compras: 1, clientes: 10, gasto: 500 }, { compras: 6, clientes: 3, gasto: 900 }, { compras: 30, clientes: 1, gasto: 2000 }], niveis);
    expect(fora).toBe(0);
    expect(porNivel.get('lv_bronze')?.clientes).toBe(10);
    expect(porNivel.get('lv_prata')?.clientes).toBe(3);
    expect(porNivel.get('lv_diamante')?.gasto).toBe(2000);
  });

  it('devolução usa a recompensa que mais custa por ponto', () => {
    const c = configPadrao(); // refri 3/120, R$10 = 10/200 (0,05/pt)
    expect(retornoPercentual(c)).toBeCloseTo(5, 5);
    expect(retornoPercentual(c, 2)).toBeCloseTo(10, 5);
    c.pontos.ativo = false;
    expect(retornoPercentual(c)).toBe(0);
  });

  it('roleta: chances somam 1 e custo esperado', () => {
    const { chances, custoGiro } = chancesRoleta(configPadrao().roleta.premios);
    expect(chances.reduce((s, x) => s + x.chance, 0)).toBeCloseTo(1, 9);
    expect(custoGiro).toBeCloseTo(0.18 * 3 + 0.1 * 5, 9);
    expect(chancesRoleta([]).custoGiro).toBe(0);
  });

  it('avisa recompensa de produto sem item e roleta sem regra de giro', () => {
    const c = configPadrao();
    c.roleta.ativo = true;
    c.roleta.a_cada_compras = 0; c.roleta.ao_subir_nivel = false; c.roleta.aniversario = false;
    const av = avisosConfig(c);
    expect(av.some((a) => a.includes('não está ligada a um item'))).toBe(true);
    expect(av.some((a) => a.includes('nenhuma regra dá giro'))).toBe(true);
  });

  it('padrão não traz "Entrega grátis" (nenhuma tela aplica esse desconto)', () => {
    const c = configPadrao();
    expect(c.recompensas.some((r) => r.tipo === 'frete_gratis')).toBe(false);
    // Nenhum prêmio ou presente aponta para recompensa que não está no catálogo.
    const ids = new Set(c.recompensas.map((r) => r.id));
    expect(c.roleta.premios.every((p) => p.tipo !== 'recompensa' || (p.recompensa_id && ids.has(p.recompensa_id)))).toBe(true);
    expect(c.trilha.niveis.every((n) => n.presente_tipo !== 'recompensa' || (n.presente_recompensa_id && ids.has(n.presente_recompensa_id)))).toBe(true);
    expect(chancesRoleta(c.roleta.premios).soma).toBe(100);
  });

  it('config salva com "Entrega grátis" continua valendo, mas gera aviso na seção de recompensas', () => {
    const c = normalizarConfig({ recompensas: [{ id: 'rw_f', nome: 'Entrega grátis', tipo: 'frete_gratis', custo_pontos: 150 }] });
    expect(c.recompensas[0].tipo).toBe('frete_gratis');
    const av = avisosConfigPorSecao(c).filter((a) => a.texto.includes('Entrega grátis'));
    expect(av).toHaveLength(1);
    expect(av[0].secao).toBe('recompensas');
  });

  it('avisos: roleta com pesos zero e desconto acima de 100%', () => {
    const c = configPadrao();
    c.roleta.ativo = true;
    c.roleta.premios.forEach((p) => { p.peso = 0; });
    c.recompensas.push({ id: 'rw_x', nome: 'Desconto X', tipo: 'desconto_percentual', valor: 150, produto_id: null, custo_pontos: 100, custo_loja: 0, nivel_minimo: null, ativo: true });
    c.roleta.premios.push({ id: 'pz_x', nome: 'Muito off', tipo: 'desconto_percentual', valor: 120, recompensa_id: null, peso: 0, custo_loja: 0, limite_dia: 0, cor: '#000000' });
    const av = avisosConfigPorSecao(c);
    expect(av.some((a) => a.secao === 'roleta' && a.texto.includes('pesos zero'))).toBe(true);
    expect(av.some((a) => a.secao === 'recompensas' && a.texto.includes('"Desconto X" dá mais de 100%'))).toBe(true);
    expect(av.some((a) => a.secao === 'roleta' && a.texto.includes('"Muito off" dá mais de 100%'))).toBe(true);
    // Roleta desligada não acusa nada da roleta.
    c.roleta.ativo = false;
    expect(avisosConfigPorSecao(c).some((a) => a.secao === 'roleta')).toBe(false);
  });

  it('padrão tem só o aviso do refri sem item do cardápio (nada liga sozinho)', () => {
    expect(avisosConfig(configPadrao())).toEqual(['"Refrigerante lata" é produto mas não está ligada a um item do cardápio.']);
  });

  it('onde a recompensa é usada (nível e roleta)', () => {
    const c = configPadrao();
    expect(usosDaRecompensa(c, 'rw_refri')).toEqual(['Nível Ouro', 'Roleta (Refri grátis)']);
    expect(usosDaRecompensa(c, 'rw_10reais')).toEqual([]);
    expect(usosDaRecompensa(c, 'nao_existe')).toEqual([]);
  });

  it('CPF: dígitos verificadores', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224724')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('123')).toBe(false);
  });

  it('desconto dos resgates: produto só se estiver no carrinho, nunca passa do subtotal', () => {
    const itens = [{ id: 'refri', preco: 6, qtd: 1 }, { id: 'burger', preco: 30, qtd: 1 }];
    const r = (id: string, reward: any) => ({ hold_id: id, fonte: 'pontos' as const, reward });
    const d = descontoDasReservas([
      r('a', { tipo: 'produto', nome: 'Refri', valor: 0, produto_id: 'refri' }),
      r('b', { tipo: 'produto', nome: 'Refri 2', valor: 0, produto_id: 'refri' }),
      r('c', { tipo: 'produto', nome: 'Batata', valor: 0, produto_id: 'batata' }),
      r('d', { tipo: 'desconto_percentual', nome: '10%', valor: 10 }),
    ], itens, 36);
    expect(d.porReserva).toEqual({ a: 6, b: 0, c: 0, d: 3.6 });
    expect(d.total).toBe(9.6);
    const teto = descontoDasReservas([r('x', { tipo: 'desconto_valor', nome: 'R$ 50', valor: 50 })], itens, 36);
    expect(teto.total).toBe(36);
  });
});

describe('prêmio de produto com desconto parcial', () => {
  const itens = [{ id: 'burrito', preco: 38, qtd: 1 }, { id: 'coca', preco: 8, qtd: 2 }];
  const reserva = (hold_id: string, produto_id: string, valor: number) =>
    ({ hold_id, fonte: 'pontos' as const, reward: { tipo: 'produto' as const, nome: 'X', valor, produto_id } });

  it('valor 0 (config antiga) ou 100 = grátis', () => {
    expect(descontoDasReservas([reserva('a', 'burrito', 0)], itens, 54).total).toBe(38);
    expect(descontoDasReservas([reserva('a', 'burrito', 100)], itens, 54).total).toBe(38);
  });

  it('50% desconta metade do preço de 1 unidade', () => {
    expect(descontoDasReservas([reserva('a', 'burrito', 50)], itens, 54).total).toBe(19);
  });

  it('arredonda em centavos e só vale com o item no carrinho', () => {
    expect(descontoDasReservas([reserva('a', 'coca', 33)], itens, 54).total).toBe(2.64);
    expect(descontoDasReservas([reserva('a', 'nachos', 50)], itens, 54).total).toBe(0);
  });

  it('normalizarConfig limita o % do produto a 0–100 e não mexe no R$ do desconto em valor', () => {
    const c = normalizarConfig({ recompensas: [
      { id: 'p', nome: 'P', tipo: 'produto', valor: 250, custo_pontos: 10 },
      { id: 'v', nome: 'V', tipo: 'desconto_valor', valor: 250, custo_pontos: 10 },
    ] });
    expect(c.recompensas[0].valor).toBe(100);
    expect(c.recompensas[1].valor).toBe(250);
  });

  it('rótulo mostra o % só quando não é grátis', () => {
    expect(rotuloPremio({ nome: 'Burrito', tipo: 'produto', valor: 50 })).toBe('Burrito com 50% de desconto');
    expect(rotuloPremio({ nome: 'Burrito', tipo: 'produto', valor: 0 })).toBe('Burrito');
    expect(rotuloPremio({ nome: 'R$ 10', tipo: 'desconto_valor', valor: 10 })).toBe('R$ 10');
  });
});
