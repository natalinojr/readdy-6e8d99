import { describe, expect, it } from 'vitest';
import { cpfValido, descontoDasReservas, avisosConfig, chancesRoleta, configPadrao, distribuirNiveis, nivelPorCompras, normalizarConfig, retornoPercentual } from '@/lib/fidelidade';

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
    const c = configPadrao(); // refri 3/120, R$10 = 10/200 (0,05/pt), frete 7/150
    expect(retornoPercentual(c)).toBeCloseTo(5, 5);
    expect(retornoPercentual(c, 2)).toBeCloseTo(10, 5);
    c.pontos.ativo = false;
    expect(retornoPercentual(c)).toBe(0);
  });

  it('roleta: chances somam 1 e custo esperado', () => {
    const { chances, custoGiro } = chancesRoleta(configPadrao().roleta.premios);
    expect(chances.reduce((s, x) => s + x.chance, 0)).toBeCloseTo(1, 9);
    expect(custoGiro).toBeCloseTo(0.18 * 3 + 0.1 * 5 + 0.02 * 7, 9);
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
