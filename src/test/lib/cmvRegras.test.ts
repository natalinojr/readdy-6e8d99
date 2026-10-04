/**
 * src/lib/cmvRegras.ts — conta do CMV em cima do relatório (Estoque › Custo › CMV e fichas).
 * Casos inspirados na El Patron Paranaguá (30 dias): Burritos Duo Mex e os chopes sem ficha.
 */
import { describe, it, expect } from 'vitest';
import {
  faixaCmv, linhasDoRelatorio, resumoCmv, tituloSemFicha, semFichaQueMaisVendem, fichasParaConferir,
  ordenarPor, lerLinhaCmv, descreverPeriodo, diasEntre, rotaDaFicha, montarCsvCmv,
  mesesDosUltimos12, limitesDoMes, pontoMensal, evolucaoMensal,
} from '@/lib/cmvRegras';

const bruto = (o: Partial<{ item_name: string; category_name: string; total_qty: number; receita_total: number; custo_total: number; tem_ficha_tecnica: boolean }>) => ({
  item_name: 'Prato', category_name: 'Burritos', total_qty: 10, receita_total: 400, custo_total: 120, cmv_pct: 30, margem_bruta: 280, tem_ficha_tecnica: true, ...o,
});
const linhas = (...os: Array<ReturnType<typeof bruto>>) => linhasDoRelatorio({ por_item: os });

describe('faixaCmv — uma régua só', () => {
  it('até 30% bom, 30–35% atenção, acima de 35% revisar', () => {
    expect(faixaCmv(0)).toBe('bom');
    expect(faixaCmv(30)).toBe('bom');
    expect(faixaCmv(30.04)).toBe('bom'); // aparece "30,0%"
    expect(faixaCmv(30.1)).toBe('atencao');
    expect(faixaCmv(35)).toBe('atencao');
    expect(faixaCmv(35.1)).toBe('revisar');
    expect(faixaCmv(37.7)).toBe('revisar');
  });
});

describe('linhasDoRelatorio', () => {
  it('converte números e calcula CMV só com ficha', () => {
    const [a, b] = linhasDoRelatorio({
      por_item: [
        { item_name: 'Nachos', category_name: 'Entradas', total_qty: '32', receita_total: '1270.08', custo_total: '360', tem_ficha_tecnica: true },
        { item_name: 'Chope', category_name: 'Bebidas', total_qty: 31, receita_total: 465, custo_total: 0, tem_ficha_tecnica: false },
      ],
    });
    expect(a.qtd_vendida).toBe(32);
    expect(a.cmv_pct).toBeCloseTo(28.35, 1);
    expect(a.margem_pct).toBeCloseTo(71.65, 1);
    expect(b.cmv_pct).toBe(0); // sem ficha: não há custo conhecido
    expect(b.tem_ficha).toBe(false);
  });

  it('resposta fora do formato é erro, não "sem vendas"', () => {
    expect(() => linhasDoRelatorio(null)).toThrow();
    expect(() => linhasDoRelatorio({})).toThrow();
    expect(() => linhasDoRelatorio({ por_item: 'x' })).toThrow();
    expect(linhasDoRelatorio({ por_item: [] })).toEqual([]);
  });

  it('o mesmo nome em duas linhas ganha chaves diferentes', () => {
    const l = linhas(bruto({ item_name: 'Coca' }), bruto({ item_name: 'Coca' }));
    expect(l[0].chave).not.toBe(l[1].chave);
  });
});

describe('resumoCmv — o CMV só vale para os pratos com ficha', () => {
  const ls = linhas(
    bruto({ item_name: 'A', receita_total: 1000, custo_total: 300 }),
    bruto({ item_name: 'B', receita_total: 500, custo_total: 200 }),
    bruto({ item_name: 'Sem 1', receita_total: 1500, custo_total: 0, tem_ficha_tecnica: false }),
  );
  const r = resumoCmv(ls);

  it('divide o custo só pela venda dos pratos com ficha', () => {
    expect(r.receitaComFicha).toBe(1500);
    expect(r.custoComFicha).toBe(500);
    expect(r.cmvPct).toBeCloseTo(33.33, 1); // não 16,7% (500 / 3000)
    expect(r.margemComFicha).toBe(1000);
    expect(r.margemPct).toBeCloseTo(66.67, 1);
  });
  it('cobertura é por receita, não por número de itens', () => {
    expect(r.comFicha).toBe(2);
    expect(r.semFicha).toBe(1);
    expect(r.coberturaReceitaPct).toBe(50);
    expect(r.receitaTotal).toBe(3000);
  });
  it('sem venda: tudo nulo, sem dividir por zero', () => {
    const v = resumoCmv([]);
    expect(v.cmvPct).toBeNull();
    expect(v.coberturaReceitaPct).toBeNull();
    expect(v.margemPct).toBeNull();
  });
  it('só pratos sem ficha: CMV nulo (não 0%)', () => {
    const v = resumoCmv(linhas(bruto({ tem_ficha_tecnica: false, custo_total: 0 })));
    expect(v.cmvPct).toBeNull();
    expect(v.coberturaReceitaPct).toBe(0);
  });
});

describe('tituloSemFicha', () => {
  it('perto de metade usa a frase do protótipo', () => {
    expect(tituloSemFicha(51, 'nos últimos 30 dias')).toBe('Metade do que vocês vendem não tem ficha');
    expect(tituloSemFicha(46, 'nos últimos 30 dias')).toBe('Metade do que vocês vendem não tem ficha');
  });
  it('senão mostra a porcentagem e o período', () => {
    expect(tituloSemFicha(70, 'nos últimos 7 dias')).toBe('30% do que vocês venderam nos últimos 7 dias não tem ficha');
    expect(tituloSemFicha(20, 'hoje')).toBe('80% do que vocês venderam hoje não tem ficha');
  });
});

describe('semFichaQueMaisVendem', () => {
  it('ordena por R$ e ignora quem tem ficha', () => {
    const ls = linhas(
      bruto({ item_name: 'Com ficha', receita_total: 9000 }),
      bruto({ item_name: 'Chope', receita_total: 465, tem_ficha_tecnica: false, custo_total: 0 }),
      bruto({ item_name: 'Duo Mex', receita_total: 2157, tem_ficha_tecnica: false, custo_total: 0 }),
      bruto({ item_name: 'Combo', receita_total: 666, tem_ficha_tecnica: false, custo_total: 0 }),
    );
    expect(semFichaQueMaisVendem(ls, 2).map((l) => l.item_name)).toEqual(['Duo Mex', 'Combo']);
  });
});

describe('fichasParaConferir', () => {
  it('pega custo maior que o preço, custo zero e CMV acima de 50%; ignora brinde e sem ficha', () => {
    const ls = linhas(
      bruto({ item_name: 'Normal', receita_total: 1000, custo_total: 300 }),
      bruto({ item_name: 'Quase', receita_total: 1000, custo_total: 500 }), // 50% exato: ainda ok
      bruto({ item_name: 'Alto', receita_total: 1000, custo_total: 620 }),
      bruto({ item_name: 'Zero', receita_total: 800, custo_total: 0 }),
      bruto({ item_name: 'Maior', receita_total: 100, custo_total: 130 }),
      bruto({ item_name: 'Brinde', receita_total: 0, custo_total: 50 }),
      bruto({ item_name: 'Sem ficha', receita_total: 500, custo_total: 0, tem_ficha_tecnica: false }),
    );
    const r = fichasParaConferir(ls);
    expect(r.map((x) => [x.linha.item_name, x.motivo])).toEqual([
      ['Maior', 'custo_maior'], ['Zero', 'custo_zero'], ['Alto', 'cmv_alto'],
    ]);
  });
});

describe('ordenarPor — sem ficha nunca no topo de CMV/margem', () => {
  const ls = linhas(
    bruto({ item_name: 'Barato', receita_total: 1000, custo_total: 200 }),
    bruto({ item_name: 'Caro', receita_total: 1000, custo_total: 500 }),
    bruto({ item_name: 'Sem', receita_total: 3000, custo_total: 0, tem_ficha_tecnica: false }),
  );
  const nomes = (o: Parameters<typeof ordenarPor>[1]) => ordenarPor(ls, o, lerLinhaCmv).map((l) => l.item_name);
  it('menor CMV começa pelo prato com ficha de menor CMV', () => expect(nomes('cmv_asc')).toEqual(['Barato', 'Caro', 'Sem']));
  it('maior CMV', () => expect(nomes('cmv_desc')).toEqual(['Caro', 'Barato', 'Sem']));
  it('maior margem não põe o sem ficha (margem "100%") no topo', () => expect(nomes('margem_desc')).toEqual(['Barato', 'Caro', 'Sem']));
  it('mais vendidos considera a receita de todos', () => expect(nomes('receita_desc')[0]).toBe('Sem'));
  it('nome', () => expect(nomes('nome')).toEqual(['Barato', 'Caro', 'Sem']));
});

describe('descreverPeriodo / diasEntre', () => {
  it('conta dias inclusive', () => {
    expect(diasEntre('2026-09-05', '2026-10-04')).toBe(30);
    expect(diasEntre('2026-10-04', '2026-10-04')).toBe(1);
  });
  it('textos dos períodos', () => {
    expect(descreverPeriodo('30d', '2026-09-05', '2026-10-04')).toMatchObject({ frase: 'nos últimos 30 dias', titulo: 'CMV dos últimos 30 dias', dias: 30 });
    expect(descreverPeriodo('7d', '2026-09-28', '2026-10-04').titulo).toBe('CMV dos últimos 7 dias');
    expect(descreverPeriodo('Hoje', '2026-10-04', '2026-10-04').frase).toBe('hoje');
    expect(descreverPeriodo('Mês', '2026-10-01', '2026-10-04').titulo).toBe('CMV deste mês');
    expect(descreverPeriodo('3m', '2026-07-07', '2026-10-04').frase).toBe('nos últimos 3 meses');
    expect(descreverPeriodo('custom:2026-09-01:2026-09-30', '2026-09-01', '2026-09-30').titulo).toBe('CMV de 01/09 a 30/09');
    expect(descreverPeriodo('custom:2026-09-10:2026-09-10', '2026-09-10', '2026-09-10').frase).toBe('em 10/09');
  });
});

describe('rotaDaFicha', () => {
  const itens = [
    { id: 'i-1', nome: 'Burritos Duo Mex', categoria: 'Burritos', ativo: true },
    { id: 'i-2', nome: 'Coca Cola', categoria: 'Bebidas', ativo: false },
    { id: 'i-3', nome: 'Coca Cola', categoria: 'Bebidas', ativo: true },
    { id: 'i-4', nome: 'Água', categoria: 'Bebidas', ativo: true },
  ];
  it('acha o item pelo nome (sem acento, sem diferenciar maiúscula) e abre na ficha', () => {
    expect(rotaDaFicha('burritos  DUO mex', 'Burritos', itens, [])).toBe('/cardapio?item=i-1&ficha=1');
    expect(rotaDaFicha('agua', 'Bebidas', itens, [])).toBe('/cardapio?item=i-4&ficha=1');
  });
  it('nome repetido: prefere a categoria e o item ativo', () => {
    expect(rotaDaFicha('Coca Cola', 'Bebidas', itens, [])).toBe('/cardapio?item=i-3&ficha=1');
  });
  it('combo vai para a aba de combos', () => {
    expect(rotaDaFicha('Combo Burrito + batata', 'Sem categoria', itens, ['Combo Burrito + batata'])).toBe('/cardapio?aba=combos');
  });
  it('não achou: abre a lista de itens com a busca preenchida', () => {
    expect(rotaDaFicha('2 chopes Pilsen 500 ml', 'Bebidas', itens, [])).toBe('/cardapio?busca=2%20chopes%20Pilsen%20500%20ml');
  });
});

describe('montarCsvCmv', () => {
  const ls = linhas(
    bruto({ item_name: 'Nachos "especial"', category_name: 'Entradas', total_qty: 32, receita_total: 1270.08, custo_total: 360 }),
    bruto({ item_name: '=SOMA(A1)', category_name: 'Bebidas', total_qty: 2, receita_total: 50, custo_total: 0, tem_ficha_tecnica: false }),
  );
  const csv = montarCsvCmv(ls, resumoCmv(ls));
  const l = csv.split('\r\n');

  it('usa ; , aspas e vírgula decimal', () => {
    expect(l[0]).toBe('"Item";"Categoria";"Qtd vendida";"Receita (R$)";"Custo total (R$)";"CMV %";"Margem R$";"Margem %";"Tem ficha"');
    expect(l[1]).toBe('"Nachos ""especial""";"Entradas";"32";"1270,08";"360,00";"28,3";"910,08";"71,7";"Sim"');
  });
  it('sem ficha fica em branco no custo/CMV/margem e não vira fórmula', () => {
    expect(l[2]).toBe('"\'=SOMA(A1)";"Bebidas";"2";"50,00";"";"";"";"";"Não"');
  });
  it('rodapé = mesma base da tela (pratos com ficha) + linha dos sem ficha', () => {
    expect(l[3]).toBe('"TOTAL (pratos com ficha)";"";"32";"1270,08";"360,00";"28,3";"910,08";"71,7";""');
    expect(l[4]).toBe('"SEM FICHA (fora do CMV)";"";"2";"50,00";"";"";"";"";""');
  });
});

describe('gráfico de 12 meses', () => {
  it('lista os 12 meses até o atual, atravessando o ano', () => {
    const m = mesesDosUltimos12('2026-10-04');
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('2025-11');
    expect(m[11]).toBe('2026-10');
    expect(mesesDosUltimos12('2026-01-31')[0]).toBe('2025-02');
  });
  it('limites do mês em Brasília, inclusive fevereiro bissexto', () => {
    expect(limitesDoMes('2026-10')).toEqual({ from: '2026-10-01T00:00:00-03:00', to: '2026-10-31T23:59:59-03:00' });
    expect(limitesDoMes('2028-02').to).toBe('2028-02-29T23:59:59-03:00');
    expect(limitesDoMes('2026-04').to).toBe('2026-04-30T23:59:59-03:00');
  });
  it('ponto do mês é o CMV dos pratos com ficha; mês sem prato com ficha fica nulo', () => {
    const p = pontoMensal('2026-09', linhas(bruto({ receita_total: 1000, custo_total: 300 }), bruto({ item_name: 'S', receita_total: 1000, tem_ficha_tecnica: false, custo_total: 0 })));
    expect(p.cmv_pct).toBe(30);
    expect(p.coberturaPct).toBe(50);
    expect(pontoMensal('2026-08', linhas(bruto({ tem_ficha_tecnica: false, custo_total: 0 }))).cmv_pct).toBeNull();
  });
  it('evolução: mudança entre os meses com CMV e média ponderada', () => {
    const pts = [
      { mes: '2026-07', cmv_pct: null, receitaComFicha: 0, custoComFicha: 0, receitaTotal: 100, coberturaPct: 0 },
      { mes: '2026-08', cmv_pct: 40, receitaComFicha: 1000, custoComFicha: 400, receitaTotal: 1000, coberturaPct: 100 },
      { mes: '2026-09', cmv_pct: 30, receitaComFicha: 3000, custoComFicha: 900, receitaTotal: 3000, coberturaPct: 100 },
    ];
    const e = evolucaoMensal(pts);
    expect(e.deltaPp).toBe(-10);
    expect(e.mediaPct).toBeCloseTo(32.5, 5); // 1300 / 4000, não a média simples (35)
    expect(evolucaoMensal([]).deltaPp).toBeNull();
    expect(evolucaoMensal([]).mediaPct).toBeNull();
  });
});
