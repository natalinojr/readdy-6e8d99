import { describe, it, expect } from 'vitest';
import { gerarOportunidades, type FatosCanais } from '@/lib/mktOportunidades';

const base = (over: Partial<FatosCanais> = {}): FatosCanais => ({
  periodo: { de: '2026-08-29', ate: '2026-09-28', dias: 30 },
  canais: [
    { canal: 'mesa', pedidos: 100, receita: 8000, ticket: 80 },
    { canal: 'delivery_proprio', pedidos: 30, receita: 2000, ticket: 66 },
  ],
  vindos_da_meta: 0,
  hora_dia: [],
  itens: [],
  cardapio: [],
  ifood_portal: null,
  estoque_critico: [],
  ...over,
});
const tipos = (f: FatosCanais) => gerarOportunidades(f).map((o) => o.tipo);

describe('gerarOportunidades', () => {
  it('sem dado nenhum não inventa oportunidade', () => {
    expect(gerarOportunidades(base({ canais: [] }))).toEqual([]);
  });

  it('prato forte no iFood e fraco no próprio vira "migrar iFood"', () => {
    const f = base({ itens: [
      { canal: 'ifood', item_id: 'b', nome: 'Burrito', qtd: 20, receita: 800, custo: null, receita_com_custo: null },
      { canal: 'delivery_proprio', item_id: 'b', nome: 'Burrito', qtd: 3, receita: 120, custo: null, receita_com_custo: null },
      { canal: 'ifood', item_id: 't', nome: 'Taco', qtd: 6, receita: 200, custo: null, receita_com_custo: null },
      { canal: 'delivery_proprio', item_id: 't', nome: 'Taco', qtd: 5, receita: 170, custo: null, receita_com_custo: null },
    ] });
    const o = gerarOportunidades(f).find((x) => x.tipo === 'migrar_ifood')!;
    expect(o.itens).toEqual(['Burrito']); // Taco vende parecido nos dois: fica de fora
    expect(o.porque).toContain('20 no iFood × 3 no próprio');
  });

  it('usa o relatório do portal iFood quando não há pedido do iFood no ERPOS', () => {
    const f = base({ ifood_portal: { periodo_inicio: '2026-09-06', periodo_fim: '2026-09-12', itens: [{ nome: 'Combo 2 Burritos', visitas: 35, pedidos: 6, qtd: 6, receita: 495, conversao: 0.17 }] } });
    const o = gerarOportunidades(f).find((x) => x.tipo === 'migrar_ifood')!;
    expect(o.itens).toEqual(['Combo 2 Burritos']);
    expect(o.fonte).toContain('portal iFood');
  });

  it('campeão do salão fraco no delivery', () => {
    const f = base({ itens: [
      { canal: 'mesa', item_id: 'n', nome: 'Nachos', qtd: 40, receita: 1200, custo: null, receita_com_custo: null },
      { canal: 'delivery_proprio', item_id: 'n', nome: 'Nachos', qtd: 1, receita: 30, custo: null, receita_com_custo: null },
      { canal: 'mesa', item_id: 'q', nome: 'Quesadilla', qtd: 30, receita: 900, custo: null, receita_com_custo: null },
      { canal: 'delivery_proprio', item_id: 'q', nome: 'Quesadilla', qtd: 25, receita: 750, custo: null, receita_com_custo: null },
    ] });
    const o = gerarOportunidades(f).find((x) => x.tipo === 'campeao_salao')!;
    expect(o.itens).toEqual(['Nachos']);
  });

  it('horário fraco só entre horários com venda', () => {
    const hora_dia = [
      ...[18, 19, 20, 21].flatMap((h) => [4, 5, 6].map((dow) => ({ dow, hora: h, pedidos: 10, receita: 500 }))),
      { dow: 2, hora: 19, pedidos: 1, receita: 40 },
      { dow: 3, hora: 3, pedidos: 1, receita: 40 }, // madrugada avulsa: não é horário da loja
    ];
    const o = gerarOportunidades(base({ hora_dia })).find((x) => x.tipo === 'horario_fraco')!;
    expect(o.porque).toContain('terça 19h (1)');
    expect(o.porque).not.toContain('3h');
  });

  it('margem alta com pouca venda; só itens com custo', () => {
    const it = (id: string, nome: string, qtd: number, receita: number, custo: number | null) =>
      ({ canal: 'mesa', item_id: id, nome, qtd, receita, custo, receita_com_custo: custo == null ? null : receita });
    const f = base({ itens: [it('a', 'Churros', 3, 60, 10), it('b', 'Burrito', 50, 2000, 1400), it('c', 'Taco', 20, 600, 300), it('d', 'Bowl', 10, 400, 200), it('e', 'Suco', 2, 24, null)] });
    const o = gerarOportunidades(f).find((x) => x.tipo === 'margem_alta')!;
    expect(o.itens).toEqual(['Churros']);
    expect(o.porque).toContain('Burrito (30%)');
    expect(o.porque).not.toContain('Suco');
  });

  it('bebida não vira "campeão do salão"; margem > 90% vira aviso de ficha', () => {
    const it = (id: string, nome: string, qtd: number, receita: number, custo: number | null, canal = 'mesa') =>
      ({ canal, item_id: id, nome, qtd, receita, custo, receita_com_custo: custo == null ? null : receita });
    const f = base({
      itens: [it('c', 'Coca cola Zero', 27, 200, null), it('n', 'Nachos', 20, 600, null), it('n', 'Nachos', 0, 0, null, 'delivery_proprio'),
        it('a', 'Taco', 2, 50, 2), it('b', 'Bowl', 3, 90, 60), it('d', 'Burrito', 10, 400, 200), it('e', 'Pastel', 5, 100, 60)],
      cardapio: [{ item_id: 'c', nome: 'Coca cola Zero', preco: 8, tem_foto: true, nota_foto: 8, destaque: false, categoria: 'Bebidas' }],
    });
    const ops = gerarOportunidades(f);
    const campeoes = ops.find((o) => o.tipo === 'campeao_salao')!.itens!;
    expect(campeoes).toContain('Nachos');
    expect(campeoes).not.toContain('Coca cola Zero');
    expect(ops.find((o) => o.tipo === 'margem_alta')!.porque).toContain('Taco');
  });

  it('mais vendido com foto de nota baixa', () => {
    const f = base({
      itens: [{ canal: 'mesa', item_id: 'x', nome: 'Burrito', qtd: 50, receita: 2000, custo: null, receita_com_custo: null }],
      cardapio: [{ item_id: 'x', nome: 'Burrito', preco: 40, tem_foto: true, nota_foto: 2, destaque: false }],
    });
    expect(tipos(f)).toContain('foto_fraca');
  });

  it('delivery próprio pequeno perto do salão; ausente = prioridade 1', () => {
    const f = base({ canais: [{ canal: 'autoatendimento', pedidos: 169, receita: 6800, ticket: 40 }, { canal: 'balcao', pedidos: 29, receita: 1000, ticket: 35 }] });
    const o = gerarOportunidades(f).find((x) => x.tipo === 'delivery_pequeno')!;
    expect(o.prioridade).toBe(1);
    expect(o.titulo).toContain('sem venda');
    expect(tipos(base())).not.toContain('delivery_pequeno'); // 20% da receita: não dispara
  });
});
