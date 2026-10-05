import { describe, it, expect } from 'vitest';
import { montarVemAi, resumoVemAi, type VemAiDados } from '@/pages/hoje/vemAiRegras';

const base = (p: Partial<VemAiDados> = {}): VemAiDados => ({ hoje: '2026-10-05', ate: '2026-10-19', contas: [], metas: [], certificados: [], conexoes: [], especiais: [], ...p });
const conta = (p: Partial<VemAiDados['contas'][number]> = {}) => ({
  tenant_id: 'A', loja: 'El Patron Paranaguá', dia: '2026-10-07', total: 1000, qtd: 2, guias_total: 0, guias: [], folha_total: 0, folha_qtd: 0, ...p,
});

describe('montarVemAi · contas', () => {
  it('soma as lojas do mesmo dia numa linha só e mostra a divisão por loja', () => {
    const l = montarVemAi(base({ contas: [conta({ total: 600, qtd: 1 }), conta({ tenant_id: 'B', loja: 'Vila Leste & El Patron', total: 400, qtd: 1 })] }));
    expect(l).toHaveLength(1);
    expect(l[0].titulo).toContain('1.000,00');
    expect(l[0].sub).toContain('Paranaguá');
    expect(l[0].sub).toContain('Vila Leste');
  });
  it('separa guia e folha do resto: "DAS R$ 1.800 + 3 contas"', () => {
    const l = montarVemAi(base({ contas: [conta({ total: 6200, qtd: 4, guias_total: 1800, guias: [{ descricao: 'DAS — competência 09/2026', valor: 1800 }] })] }));
    expect(l[0].detalhe).toContain('DAS');
    expect(l[0].detalhe).not.toContain('competência');
    expect(l[0].detalhe).toContain('3 contas');
    expect(l[0].detalhe).toContain('4.400,00');
  });
  it('folha aparece como folha', () => {
    const l = montarVemAi(base({ contas: [conta({ total: 9480, qtd: 1, folha_total: 9480, folha_qtd: 1 })] }));
    expect(l[0].detalhe.replace(/\s/g, ' ')).toBe('folha R$ 9.480,00');
  });
  it('âmbar só quando passa da soma das metas do dia da semana (quarta = 3)', () => {
    const metas = [{ tenant_id: 'A', dia_semana: 3, faturamento: 2000 }, { tenant_id: 'B', dia_semana: 3, faturamento: 2333 }];
    expect(montarVemAi(base({ contas: [conta({ total: 6200 })], metas }))[0].acima).toBe(true);
    expect(montarVemAi(base({ contas: [conta({ total: 4000 })], metas }))[0].acima).toBe(false);
  });
  it('sem meta nenhuma só mostra o total (não destaca)', () => {
    const l = montarVemAi(base({ contas: [conta({ total: 99999 })] }));
    expect(l[0].acima).toBe(false);
    expect(l[0].detalhe).not.toContain('meta');
  });
  it('filtro de loja olha só aquela loja (contas e metas)', () => {
    const d = base({
      contas: [conta({ total: 3000 }), conta({ tenant_id: 'B', total: 500 })],
      metas: [{ tenant_id: 'A', dia_semana: 3, faturamento: 2000 }, { tenant_id: 'B', dia_semana: 3, faturamento: 9000 }],
    });
    const so = montarVemAi(d, 'A');
    expect(so).toHaveLength(1);
    expect(so[0].titulo).toContain('3.000,00');
    expect(so[0].acima).toBe(true);
    expect(montarVemAi(d, '')[0].acima).toBe(false);
  });
});

describe('montarVemAi · outras linhas e ordem', () => {
  it('ordena por dia e, no mesmo dia, conexão antes de certificado antes de contas antes de data especial', () => {
    const l = montarVemAi(base({
      contas: [conta({ dia: '2026-10-12' })],
      especiais: [{ tenant_id: 'A', loja: 'Vila Leste & El Patron', dia: '2026-10-12', rotulo: 'Feriado', fechado: true, horarios: null }],
      certificados: [{ nome: 'EP Serviços', dia: '2026-10-12' }],
      conexoes: [{ tipo: 'meta', tenant_id: 'A', loja: 'El Patron Paranaguá', nome: 'conta', dia: '2026-10-09' }],
    }));
    expect(l.map((x) => x.tipo)).toEqual(['conexao', 'certificado', 'contas', 'especial']);
    expect(l[0].dia).toBe('2026-10-09');
  });
  it('data especial diz se fecha ou tem horário, e leva ao horário do delivery', () => {
    const [f, h] = montarVemAi(base({ especiais: [
      { tenant_id: 'A', loja: 'El Patron Paranaguá', dia: '2026-10-12', rotulo: 'Feriado', fechado: true, horarios: null },
      { tenant_id: 'A', loja: 'El Patron Paranaguá', dia: '2026-10-13', rotulo: null, fechado: false, horarios: '11:00–15:00' },
    ] }));
    expect(f.titulo).toBe('Delivery fechado — Feriado');
    expect(h.titulo).toContain('horário especial');
    expect(h.detalhe).toContain('11:00–15:00');
    expect(f.acao?.rota).toBe('/config-delivery?aba=horario');
  });
  it('certificado e conexão levam à tela certa', () => {
    const l = montarVemAi(base({
      certificados: [{ nome: 'EP', dia: '2026-10-17' }],
      conexoes: [{ tipo: 'inter_pix', tenant_id: 'A', loja: 'El Patron Paranaguá', nome: 'x', dia: '2026-10-10' }, { tipo: 'meta', tenant_id: 'A', loja: 'El Patron Paranaguá', nome: 'x', dia: '2026-10-11' }],
    }));
    expect(l.find((x) => x.tipo === 'certificado')?.acao?.rota).toBe('/notas-servico');
    expect(l.filter((x) => x.tipo === 'conexao').map((x) => x.acao?.rota)).toEqual(['/configuracoes?tab=estacoes', '/trafego-pago']);
  });
});

describe('resumoVemAi', () => {
  it('vazio', () => expect(resumoVemAi([])).toBe('Nada vence nos próximos 14 dias.'));
  it('lista até 3 e diz quantas faltam', () => {
    const l = montarVemAi(base({
      contas: [conta({ dia: '2026-10-07', total: 6200 }), conta({ dia: '2026-10-08' }), conta({ dia: '2026-10-09' }), conta({ dia: '2026-10-10' })],
    }));
    const r = resumoVemAi(l);
    expect(r.startsWith('4 coisas: R$')).toBe(true);
    expect(r).toContain('saem quarta');
    expect(r.endsWith('e mais 1.')).toBe(true);
  });
});
