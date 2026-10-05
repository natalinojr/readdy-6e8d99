import { describe, it, expect } from 'vitest';
import { resumir, type PedidoIfood } from '@/lib/ifoodDashboard';
import { dividirPor100, dividirDescontos, situacaoRepasse, resumoRepasses, fraseRepasses, type RepasseRow } from '@/pages/ifood/lib/dinheiro';

const ped = (o: Partial<PedidoIfood>): PedidoIfood => {
  const p: PedidoIfood = {
    id: 'x', loja: 'l', at: new Date(), dia: '2026-10-01', hora: 19, semana: 4, vendas: 100, bruto: 100, comissao: 0, transacao: 0,
    promoLoja: 0, promoIfood: 0, entregaSobDemanda: 0, entregaCliente: 0, outrosServicos: 0, ajustes: 0, liquido: 0, pagamento: 'Pix',
    logistica: 'propria', cancelado: false, parcial: false, motivo: null, ...o,
  };
  p.liquido = p.vendas - p.comissao - p.transacao - p.promoLoja - p.entregaSobDemanda - p.outrosServicos + p.ajustes;
  return p;
};

describe('dividirPor100', () => {
  it('as partes da barra somam 100 junto com o que chega', () => {
    const r = resumir([ped({ vendas: 200, comissao: 36, transacao: 4, promoLoja: 17, entregaSobDemanda: 6, outrosServicos: 2, promoIfood: 30 })]);
    const d = dividirPor100(r)!;
    expect(d.chegaBarra + d.partes.reduce((s, p) => s + p.barra, 0)).toBeCloseTo(100, 6);
    expect(d.chega100).toBeCloseTo(((200 - 36 - 4 - 17 - 6 - 2) / 200) * 100, 6);
    expect(d.devolveu100).toBe(0);
  });

  it('ajuste a favor vira "devolveu" e a barra continua fechando em 100', () => {
    const r = resumir([ped({ vendas: 100, comissao: 20, transacao: 5, ajustes: 10 })]);
    const d = dividirPor100(r)!;
    expect(d.devolveu100).toBeCloseTo(10, 6);
    expect(d.chega100).toBeCloseTo(100 - 25 + 10, 6);
    expect(d.chegaBarra + d.partes.reduce((s, p) => s + p.barra, 0)).toBeCloseTo(100, 6);
    // identidade: chega = 100 − partes + devolveu
    expect(d.chega100).toBeCloseTo(100 - d.partes.reduce((s, p) => s + p.v100, 0) + d.devolveu100, 6);
  });

  it('ajuste contra entra como parte do caminho', () => {
    const r = resumir([ped({ vendas: 100, comissao: 20, ajustes: -5 })]);
    const d = dividirPor100(r)!;
    expect(d.partes.find((p) => p.id === 'ajustes')?.v100).toBeCloseTo(5, 6);
    expect(d.chegaBarra + d.partes.reduce((s, p) => s + p.barra, 0)).toBeCloseTo(100, 6);
  });

  it('sem vendas não divide', () => {
    expect(dividirPor100(resumir([]))).toBeNull();
  });
});

describe('dividirDescontos', () => {
  it('separa loja e iFood com % das vendas', () => {
    const d = dividirDescontos({ vendas: 200, promoLoja: 10, promoIfood: 30 });
    expect(d.total).toBe(40);
    expect(d.pctLoja).toBeCloseTo(5);
    expect(d.pctIfood).toBeCloseTo(15);
  });
});

const rep = (o: Partial<RepasseRow>): RepasseRow => ({ data_repasse: '2026-10-07', esperado: 1000, recebido_inter: 1000, linhas_inter: 1, detalhe: {}, ...o });

describe('repasses × banco', () => {
  const hoje = '2026-10-10';
  it('bateu com menos de R$ 1 de diferença', () => {
    expect(situacaoRepasse(rep({ recebido_inter: 999.5 }), hoje).situacao).toBe('bateu');
  });
  it('faltou e sobrou', () => {
    expect(situacaoRepasse(rep({ recebido_inter: 900 }), hoje)).toEqual({ situacao: 'faltou', diff: -100 });
    expect(situacaoRepasse(rep({ recebido_inter: 1100 }), hoje).situacao).toBe('sobrou');
  });
  it('não achado no banco, previsto e sem conta', () => {
    expect(situacaoRepasse(rep({ recebido_inter: 0, linhas_inter: 0 }), hoje).situacao).toBe('nao_achou');
    expect(situacaoRepasse(rep({ data_repasse: '2026-10-14', recebido_inter: 0, linhas_inter: 0 }), hoje).situacao).toBe('previsto');
    expect(situacaoRepasse(rep({ detalhe: { sem_conta: true }, linhas_inter: 0, recebido_inter: 0 }), hoje).situacao).toBe('sem_conta');
  });
  it('frase do resumo', () => {
    const ok = resumoRepasses([rep({}), rep({ data_repasse: '2026-10-14', linhas_inter: 0, recebido_inter: 0 })], hoje);
    expect(fraseRepasses(ok)).toBe('O repasse caiu no banco certinho.');
    expect(fraseRepasses(resumoRepasses([rep({}), rep({ data_repasse: '2026-10-01' })], hoje))).toBe('Todos os repasses caíram no banco certinho.');
    expect(ok.proximo?.data_repasse).toBe('2026-10-14');
    const ruim = resumoRepasses([rep({}), rep({ data_repasse: '2026-09-30', recebido_inter: 10 })], hoje);
    expect(fraseRepasses(ruim)).toBe('1 repasse não bateu com o banco.');
  });
});
