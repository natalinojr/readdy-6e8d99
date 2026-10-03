// Tela Hoje (2026-10-03): regra que separa as pendências em Agora / Pôr em dia / Pode esperar /
// Esperando outros, juntando o que é a mesma conta. Casos tirados das pendências reais de 03/10
// (Paranaguá e Vila Leste) — sem banco.
import { describe, it, expect } from 'vitest';
import { organizarHoje, prazoDe, fornecedorDoBoleto, contarAgoraPorLoja, agoraDaPessoa, visivelNaHoje, tituloCurto, pendHojeDaLinha, type PendHoje } from '@/pages/hoje/organizar';

const HOJE = '2026-10-03';
let seq = 0;
const p = (o: Partial<PendHoje>): PendHoje => ({
  id: `p${++seq}`, tenantId: 'par', loja: 'Paranaguá', kind: 'boleto_faltando', ref: null,
  titulo: 'x', detalhe: null, rota: null, urgencia: 'normal', acaoRequerida: true, status: 'aberta',
  criadaEm: '2026-10-01T10:00:00Z', payload: null, ...o,
});
const boleto = (forn: string, valor: number, venc: string, vencida: boolean, extra: Record<string, unknown> = {}, o: Partial<PendHoje> = {}) =>
  p({ titulo: `Falta o boleto: ${forn} — R$ ${valor.toFixed(2).replace('.', ',')}, ${vencida ? `VENCIDA em ${venc}` : `vence ${venc}`}`,
    urgencia: vencida ? 'alta' : 'normal', payload: { valor, vencimento: venc, vencida, ...extra }, ...o });

describe('prazoDe', () => {
  it('vencida usa o ano em que a data fica no passado', () => {
    expect(prazoDe(boleto('A', 1, '04/07', true), HOJE)).toBe('2026-07-04');
    expect(prazoDe(boleto('A', 1, '30/09', true), HOJE)).toBe('2026-09-30');
  });
  it('a vencer pega a data mais perto de hoje', () => {
    expect(prazoDe(boleto('A', 1, '05/10', false), HOJE)).toBe('2026-10-05');
    expect(prazoDe(boleto('A', 1, '02/01', false), '2026-12-28')).toBe('2027-01-02');
  });
  it('sem vencimento no payload devolve null', () => {
    expect(prazoDe(p({ kind: 'estoque_critico' }), HOJE)).toBeNull();
  });
});

describe('fornecedorDoBoleto', () => {
  it('tira o nome do título do cron', () => {
    expect(fornecedorDoBoleto('Falta o boleto: OESA — R$ 318,39, VENCIDA em 30/09')).toBe('OESA');
    expect(fornecedorDoBoleto('Falta o boleto: 35.429.022 JOSIANE FRANCISCA DA SILVA — R$ 390,00, VENCIDA em 27/09')).toBe('35.429.022 JOSIANE FRANCISCA DA SILVA');
    expect(fornecedorDoBoleto('22 insumos no estoque crítico')).toBeNull();
  });
});

describe('organizarHoje', () => {
  it('Vila Leste: "5 contas atrasadas" engole as 5 OESA vencidas; a que vence 07/10 fica em "pode esperar"', () => {
    const ag = p({ tenantId: 'vila', loja: 'Vila Leste', kind: 'conta_atrasada', titulo: '5 contas atrasadas — R$ 1.492,44', urgencia: 'alta', payload: { total: 5, valor: 1492.44 } });
    const vencidas = ['04/07', '27/08', '10/09', '11/09', '30/09'].map((d, i) => boleto('OESA', 100 + i, d, true, {}, { tenantId: 'vila', loja: 'Vila Leste' }));
    const futura = boleto('OESA', 188.49, '07/10', false, {}, { tenantId: 'vila', loja: 'Vila Leste' });
    const itens = organizarHoje([ag, ...vencidas, futura], HOJE);
    expect(itens).toHaveLength(2);
    const contas = itens.find((i) => i.tipo === 'contas_vencidas')!;
    expect(contas.bloco).toBe('agora');
    expect(contas.juntas.map((j) => j.id)).toEqual(vencidas.map((v) => v.id));
    expect(contas.valor).toBe(1492.44);
    expect(contas.prazo).toBe('2026-07-04');
    const resto = itens.find((i) => i.principal.id === futura.id)!;
    expect(resto.bloco).toBe('espera');
  });

  it('mesmo fornecedor com 2+ contas no mesmo bloco vira um cartão só, com a soma', () => {
    const a = boleto('ENCARTA EMBALAGENS', 129.22, '22/10', false);
    const b = boleto('ENCARTA EMBALAGENS', 129.22, '08/10', false);
    const c = boleto('B&P Temperos LTDA', 644.37, '14/10', false);
    const itens = organizarHoje([a, b, c], HOJE);
    const g = itens.find((i) => i.tipo === 'boletos_fornecedor')!;
    expect(g.titulo).toBe('ENCARTA EMBALAGENS: 2 contas sem boleto');
    expect(g.valor).toBe(258.44);
    expect(g.principal.id).toBe(b.id); // o que vence antes
    expect(g.bloco).toBe('espera');
    expect(itens.filter((i) => i.tipo === 'pendencia')).toHaveLength(1);
  });

  it('boleto que vence em até 3 dias vai para "agora"; mais longe, "pode esperar"', () => {
    const seg = boleto('BEBIDAS NOVA GERACAO LTDA', 738.96, '05/10', false);
    const longe = boleto('B&P Temperos LTDA', 644.37, '14/10', false);
    const itens = organizarHoje([seg, longe], HOJE);
    expect(itens.find((i) => i.principal.id === seg.id)!.bloco).toBe('agora');
    expect(itens.find((i) => i.principal.id === longe.id)!.bloco).toBe('espera');
  });

  it('boleto já pedido espera o fornecedor; sem resposta em 3 dias volta para "agora"', () => {
    const ontem = boleto('CELINA', 700, '30/09', true, { pedido_em: '2026-10-02' });
    const velho = boleto('SEQUOIA', 660.34, '06/08', true, { pedido_em: '2026-09-29' });
    const itens = organizarHoje([ontem, velho], HOJE);
    const i1 = itens.find((i) => i.principal.id === ontem.id)!;
    expect(i1.bloco).toBe('outros');
    expect(i1.pedidoHaDias).toBe(1);
    const i2 = itens.find((i) => i.principal.id === velho.id)!;
    expect(i2.bloco).toBe('agora');
    expect(i2.pedidoHaDias).toBe(4);
  });

  it('boleto pedido há pouco não entra no cartão das vencidas (está esperando o fornecedor)', () => {
    const ag = p({ kind: 'conta_atrasada', titulo: '4 contas atrasadas — R$ 2.450,34', urgencia: 'alta', payload: { total: 4, valor: 2450.34 } });
    const pedido = boleto('CELINA', 700, '30/09', true, { pedido_em: '2026-10-02' });
    const semPedido = boleto('SEQUOIA', 660.34, '06/08', true);
    const itens = organizarHoje([ag, pedido, semPedido], HOJE);
    const contas = itens.find((i) => i.tipo === 'contas_vencidas')!;
    expect(contas.juntas.map((j) => j.id)).toEqual([semPedido.id]);
    expect(itens.find((i) => i.principal.id === pedido.id)!.bloco).toBe('outros');
  });

  it('acumulado vai para "pôr em dia"; nota não lançada (boleto vencendo) é "agora"; estoque crítico espera; com OK, silenciado', () => {
    const notas = p({ kind: 'nota_nao_lancada', urgencia: 'alta', titulo: '22 notas de entrada não lançadas' });
    const itensCl = p({ kind: 'item_sem_classe', titulo: '14 itens sem classificação' });
    const estoque = p({ kind: 'estoque_critico', acaoRequerida: false, titulo: '22 insumos no estoque crítico' });
    const estoqueVisto = p({ kind: 'estoque_critico', acaoRequerida: false, status: 'vista', tenantId: 'vila' });
    const itens = organizarHoje([notas, itensCl, estoque, estoqueVisto], HOJE);
    const bloco = (id: string) => itens.find((i) => i.principal.id === id)!.bloco;
    expect(bloco(notas.id)).toBe('agora');
    expect(bloco(itensCl.id)).toBe('em_dia');
    expect(bloco(estoque.id)).toBe('espera');
    expect(bloco(estoqueVisto.id)).toBe('silenciado');
  });

  it('tarefa vencida da loja não vira cartão (as tarefas da pessoa ficam na rotina)', () => {
    expect(organizarHoje([p({ kind: 'tarefa_vencida' })], HOJE)).toHaveLength(0);
  });

  it('o que pede ação e não é acumulado vai para "agora"; boletos pela data de vencimento', () => {
    const recente = boleto('X', 10, '20/09', true);
    const antigo = boleto('Y', 10, '01/09', true);
    const outro = p({ kind: 'compra_pelo_celular', urgencia: 'normal' });
    const itens = organizarHoje([recente, outro, antigo], HOJE).filter((i) => i.bloco === 'agora');
    expect(itens.map((i) => i.principal.id)).toEqual([antigo.id, recente.id, outro.id]);
  });

  it('boleto a vencer daqui a meses não vira "venceu há 171 dias"', () => {
    const longe = boleto('PARCELADO', 50, '15/04', false);
    expect(prazoDe(longe, HOJE)).toBe('2027-04-15');
    expect(organizarHoje([longe], HOJE)[0].bloco).toBe('espera');
  });

  it('quem tem alguém esperando agora (aprovação do PDV) vem antes de boleto vencido; "vence hoje" antes de boleto da semana', () => {
    const venc = boleto('X', 10, '01/09', true);
    const aprov = p({ kind: 'aprovacao', urgencia: 'alta' });
    const hoje = p({ kind: 'conta_vence_hoje', urgencia: 'alta', titulo: '2 contas vencem hoje' });
    const semana = boleto('Y', 20, '05/10', false);
    const ids = organizarHoje([semana, hoje, venc, aprov], HOJE).filter((i) => i.bloco === 'agora').map((i) => i.principal.id);
    expect(ids).toEqual([aprov.id, venc.id, hoje.id, semana.id]);
  });

  it('"vence hoje" junta o "falta o boleto" da conta que vence hoje', () => {
    const hojeAg = p({ kind: 'conta_vence_hoje', urgencia: 'alta', titulo: '1 conta vence hoje' });
    const bol = boleto('Z', 30, '03/10', false);
    const itens = organizarHoje([hojeAg, bol], HOJE);
    expect(itens).toHaveLength(1);
    expect(itens[0].tipo).toBe('contas_vencidas');
    expect(itens[0].prazo).toBe(HOJE);
    expect(itens[0].juntas.map((j) => j.id)).toEqual([bol.id]);
  });

  it('boleto pedido com o cron mandando cobrar volta para "agora" mesmo antes de 2 dias', () => {
    const b = boleto('W', 40, '30/09', true, { pedido_em: '2026-10-03', cobrar: true });
    expect(organizarHoje([b], HOJE)[0].bloco).toBe('agora');
  });

  it('conta "agora" por loja', () => {
    const itens = organizarHoje([
      p({ kind: 'aprovacao' }), p({ kind: 'aprovacao' }), p({ kind: 'aprovacao', tenantId: 'vila' }), p({ kind: 'estoque_critico', acaoRequerida: false }),
    ], HOJE);
    const m = contarAgoraPorLoja(itens);
    expect(m.get('par')).toBe(2);
    expect(m.get('vila')).toBe(1);
  });
});

describe('servidor: o mesmo "Agora" da tela (bom dia e aviso no celular)', () => {
  it('título curto tira o "Falta o boleto:", o valor e o vencimento', () => {
    expect(tituloCurto('Falta o boleto: OESA — R$ 318,39, VENCIDA em 30/09')).toBe('Boleto: OESA');
    expect(tituloCurto('Falta o boleto: BEBIDAS NOVA GERACAO LTDA — R$ 738,96, vence 05/10')).toBe('Boleto: BEBIDAS NOVA GERACAO LTDA');
    expect(tituloCurto('22 notas de entrada não lançadas — R$ 10.659,21 vencendo')).toBe('22 notas de entrada não lançadas');
    expect(tituloCurto('4 contas atrasadas — R$ 2.450,34')).toBe('4 contas atrasadas');
    expect(tituloCurto('Falta o boleto: OESA — R$ 188,49, vence HOJE')).toBe('Boleto: OESA');
    expect(tituloCurto('Falta o boleto: OESA — R$ 188,49, vence amanhã')).toBe('Boleto: OESA');
  });

  it('Pix do grupo só para o dono; dinheiro só para quem é do financeiro; aprovação para supervisão', () => {
    expect(visivelNaHoje('pagamento_grupo', 'admin', 'x@y.com', false)).toBe(false);
    expect(visivelNaHoje('pagamento_grupo', 'admin', 'x@y.com', true)).toBe(true);
    expect(visivelNaHoje('conta_atrasada', 'supervisao', null, false)).toBe(false);
    expect(visivelNaHoje('conta_atrasada', 'gerente', null, false)).toBe(true);
    expect(visivelNaHoje('aprovacao', 'supervisao', null, false)).toBe(true);
    expect(visivelNaHoje('estoque_critico', 'caixa', null, false)).toBe(true);
  });

  it('agoraDaPessoa só conta as lojas da pessoa e o que ela vê, e bate com a tela', () => {
    const linha = (o: Record<string, unknown>) => pendHojeDaLinha({ id: `l${++seq}`, tenant_id: 'par', kind: 'aprovacao', ref: null, titulo: 'x', detalhe: null,
      rota: null, urgencia: 'alta', acao_requerida: true, status: 'aberta', criada_em: '2026-10-03T10:00:00Z', payload: null, tenants: { name: 'Paranaguá' }, ...o });
    const pends = [
      linha({ kind: 'aprovacao' }),
      linha({ kind: 'conta_atrasada', payload: { valor: 10 } }),
      linha({ kind: 'aprovacao', tenant_id: 'outra' }),
      linha({ kind: 'estoque_critico', acao_requerida: false, urgencia: 'normal' }),
    ];
    const supervisao = agoraDaPessoa(pends, new Map([['par', 'supervisao']]), null, false, HOJE);
    expect(supervisao.map((i) => i.kind)).toEqual(['aprovacao']);
    const gerente = agoraDaPessoa(pends, new Map([['par', 'gerente']]), null, false, HOJE);
    expect(gerente.map((i) => i.kind).sort()).toEqual(['aprovacao', 'conta_atrasada']);
    expect(pends[0].loja).toBe('Paranaguá');
  });
});

