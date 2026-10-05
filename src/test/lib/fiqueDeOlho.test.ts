// "Fique de olho" (2026-10-05): regra pura de quais eventos do PDV viram cartão na Hoje e como ficam escritos.
// Os formatos dos eventos são os reais do audit_log (conferidos em 05/10): sangria grava after.valor (número),
// desconto grava after.desconto ("R$ 50,00"), cancelamento não grava valor.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  LIMITES_OLHO, lerValor, regraDoEvento, valorDoEvento, autorizadorDe, motivoDe, ehNomeGenerico, ritmoDaPessoa, textoRitmo,
  montarItem, quemTexto, rotaDoItem, textoPush, tituloDoCartao, itensDoPayload, podeAvisarAgora, type LinhaHistorico,
} from '../../../supabase/functions/_shared/fique-de-olho';
import { ALERT_THRESHOLDS } from '@/constants/auditoria';
import { pendenciaVisivelPara } from '../../../supabase/functions/_shared/pendencia-visivel';
import { organizarHoje, type PendHoje } from '@/pages/hoje/organizar';

const ev = (o: Record<string, unknown>) => ({ user_name: 'Caixa', ...o });
const AGORA = new Date('2026-10-05T16:42:00Z'); // 13:42 em Brasília

describe('limites: um número só', () => {
  it('o alerta antigo (bipe e Auditoria) usa os mesmos valores do cartão', () => {
    expect(ALERT_THRESHOLDS.cancelamentoAltoValor).toBe(LIMITES_OLHO.cancelamento);
    expect(ALERT_THRESHOLDS.descontoAltoValor).toBe(LIMITES_OLHO.desconto);
    expect(ALERT_THRESHOLDS.sangriaAltoValor).toBe(LIMITES_OLHO.sangria);
    expect(LIMITES_OLHO).toEqual({ cancelamento: 100, desconto: 50, sangria: 500 });
  });
});

describe('lerValor', () => {
  it('lê número, "R$ 1.234,56", "50,00" e "1.234"', () => {
    expect(lerValor(187)).toBe(187);
    expect(lerValor('R$ 50,00')).toBe(50);
    expect(lerValor('R$ 1.234,56')).toBe(1234.56);
    expect(lerValor('1.234')).toBe(1234);
    expect(lerValor('12.5')).toBe(12.5);
    expect(lerValor('')).toBeNull();
    expect(lerValor(null)).toBeNull();
    expect(lerValor('sem valor')).toBeNull();
  });
});

describe('regraDoEvento', () => {
  it('sangria, desconto aplicado e cancelamento de PEDIDO; o resto não', () => {
    expect(regraDoEvento(ev({ action_type: 'sangria', entity_type: 'Caixa' }))).toBe('sangria');
    expect(regraDoEvento(ev({ action_type: 'desconto_aplicado', entity_type: 'Pedido' }))).toBe('desconto');
    expect(regraDoEvento(ev({ action_type: 'pedido_cancelado', entity_type: 'Pedido', description: 'Pedido #1 cancelado. Motivo: Erro no pedido.' }))).toBe('cancelamento');
    expect(regraDoEvento(ev({ action_type: 'suprimento', entity_type: 'Caixa' }))).toBeNull();
    expect(regraDoEvento(ev({ action_type: 'desconto_negado', entity_type: 'Pedido' }))).toBeNull();
  });
  it('voucher cancelado e item cancelado usam o mesmo tipo de evento mas não entram', () => {
    expect(regraDoEvento(ev({ action_type: 'pedido_cancelado', entity_type: 'Voucher', description: 'Voucher DC-4NDV-BDW4 cancelado manualmente' }))).toBeNull();
    expect(regraDoEvento(ev({ action_type: 'pedido_cancelado', entity_type: 'Pedido', description: 'Item "Chope" cancelado do pedido #12.' }))).toBeNull();
  });
});

describe('valorDoEvento', () => {
  it('sangria: after.valor', () => {
    expect(valorDoEvento('sangria', ev({ after: { tipo: 'sangria', valor: 520, motivo: 'diária' } }))).toBe(520);
  });
  it('desconto: after.desconto em texto (o alerta antigo lia after.valor e nunca disparava)', () => {
    expect(valorDoEvento('desconto', ev({ after: { desconto: 'R$ 50,00', autorizador: 'Eduardo' } }))).toBe(50);
  });
  it('desconto sem campo: primeiro R$ da descrição', () => {
    expect(valorDoEvento('desconto', ev({ description: 'Desconto de R$ 75,50 aplicado por Caixa' }))).toBe(75.5);
  });
  it('cancelamento sem valor no evento: null (o servidor busca o total do pedido)', () => {
    expect(valorDoEvento('cancelamento', ev({ description: 'Pedido #1 cancelado. Motivo: Erro no pedido. Autorizado por: Natalino Junior' }))).toBeNull();
    expect(valorDoEvento('cancelamento', ev({ after: { total: 187 } }))).toBe(187);
  });
});

describe('quem, quem autorizou e motivo', () => {
  it('"Caixa" é login compartilhado; nome de pessoa não', () => {
    expect(ehNomeGenerico('Caixa')).toBe(true);
    expect(ehNomeGenerico('caixa 2')).toBe(true);
    expect(ehNomeGenerico('Operador')).toBe(true);
    expect(ehNomeGenerico('')).toBe(true);
    expect(ehNomeGenerico('Thatiele Souza')).toBe(false);
  });
  it('autorizador: frases reais do PDV', () => {
    expect(autorizadorDe(ev({ description: 'Pedido #1 cancelado. Motivo: Erro no pedido. Autorizado por: Natalino Junior' }))).toBe('Natalino Junior');
    expect(autorizadorDe(ev({ description: 'Pedido em preparo #0007 cancelado — Pedido duplicado (autorização: Eduardo)' }))).toBe('Eduardo');
    expect(autorizadorDe(ev({ description: 'Desconto de R$ 50,00 aplicado — autorizado por Eduardo (senha in loco)', after: { autorizador: 'Eduardo' } }))).toBe('Eduardo');
    expect(autorizadorDe(ev({ description: 'Desconto de R$ 60,00 aprovado por Natalino' }))).toBe('Natalino');
    expect(autorizadorDe(ev({ description: 'Sangria de R$ 520,00' }))).toBeNull();
  });
  it('motivo: sangria, cancelamento (descrição ou do pedido)', () => {
    expect(motivoDe('sangria', ev({ after: { motivo: 'Freelancer: Marcelle' } }))).toBe('Freelancer: Marcelle');
    expect(motivoDe('cancelamento', ev({ description: 'Pedido #1 cancelado. Motivo: Erro no pedido. Autorizado por: X' }))).toBe('Erro no pedido');
    expect(motivoDe('cancelamento', ev({ description: 'Pedido #0001 cancelado — Cliente desistiu (modo livre)' }))).toBe('Cliente desistiu');
    expect(motivoDe('cancelamento', ev({ description: 'x' }), 'cliente desistiu')).toBe('cliente desistiu');
  });
});

describe('ritmo da pessoa: "3º desconto hoje, média 1"', () => {
  const l = (dia: string, hora: string, tipo = 'desconto_aplicado', ent: string | null = 'Pedido'): LinhaHistorico => ({ created_at: `${dia}T${hora}:00-03:00`, action_type: tipo, entity_type: ent });
  it('conta hoje e a média por dia trabalhado dos dias anteriores', () => {
    const hist = [
      l('2026-10-05', '10:00'), l('2026-10-05', '12:00'), l('2026-10-05', '13:42'),
      l('2026-10-04', '10:00'), l('2026-10-04', '11:00', 'sangria', 'Caixa'),
      l('2026-10-03', '10:00', 'sangria', 'Caixa'),
      l('2026-10-02', '10:00', 'sangria', 'Caixa'), l('2026-10-02', '15:00'),
    ];
    const r = ritmoDaPessoa(hist, 'desconto', AGORA);
    expect(r.hoje).toBe(3);
    expect(r.media).toBeCloseTo(2 / 3, 5); // 2 descontos em 3 dias trabalhados
    expect(textoRitmo('desconto', { hoje: 3, media: 1 }, false)).toBe('3º desconto hoje · média 1 por dia');
    expect(textoRitmo('desconto', { hoje: 3, media: 0.7 }, true)).toBe('3º desconto hoje no caixa · média 0,7 por dia');
  });
  it('poucos dias de histórico: sem média; o primeiro do dia: sem texto', () => {
    const r = ritmoDaPessoa([l('2026-10-05', '10:00'), l('2026-10-05', '11:00'), l('2026-10-04', '10:00')], 'desconto', AGORA);
    expect(r).toEqual({ hoje: 2, media: null });
    expect(textoRitmo('desconto', r, false)).toBe('2º desconto hoje');
    expect(textoRitmo('desconto', { hoje: 1, media: 2 }, false)).toBeNull();
  });
  it('cancelamento só conta pedido (voucher cancelado tem o mesmo tipo de evento)', () => {
    const r = ritmoDaPessoa([l('2026-10-05', '10:00', 'pedido_cancelado', 'Voucher'), l('2026-10-05', '11:00', 'pedido_cancelado', 'Pedido')], 'cancelamento', AGORA);
    expect(r.hoje).toBe(1);
  });
  it('dia é o de Brasília (23h de ontem não é hoje)', () => {
    const r = ritmoDaPessoa([{ created_at: '2026-10-05T01:30:00Z', action_type: 'sangria', entity_type: 'Caixa' }], 'sangria', AGORA);
    expect(r.hoje).toBe(0); // 22:30 de 04/10 em Brasília
  });
});

describe('item do cartão e textos', () => {
  it('cancelamento no login "Caixa" com autorização: mostra o nome que existe', () => {
    const e = ev({ action_type: 'pedido_cancelado', entity_type: 'Pedido', entity_label: 'ce902b74-6170-4b8d-be61-33080808bd3a',
      description: 'Pedido #1 cancelado. Motivo: Erro no pedido. Autorizado por: Natalino Junior' });
    const i = montarItem({ regra: 'cancelamento', valor: 187, evento: e, userId: 'u1', agora: AGORA, ritmo: { hoje: 1, media: null } });
    expect(i.titulo.replace(/\s/g, ' ')).toBe('Cancelou um pedido de R$ 187,00');
    expect(i.hora).toBe('13:42');
    expect(i.generico).toBe(true);
    expect(i.autorizou).toBe('Natalino Junior');
    expect(quemTexto(i)).toBe('Caixa · autorizou Natalino Junior');
    expect(i.motivo).toBe('Erro no pedido');
    expect(i.grupo).toBe('pedidos');
    expect(i.ritmo).toBeNull();
  });
  it('quem aplicou com a própria permissão não vira "autorizou" de si mesmo; desconto mostra onde', () => {
    const e = ev({ user_name: 'Thatiele', action_type: 'desconto_aplicado', entity_type: 'Pedido', entity_label: 'Mesa 3',
      description: 'Desconto de R$ 50,00 aplicado por Thatiele (permissão "Aplicar desconto")', after: { desconto: 'R$ 50,00', autorizador: 'Thatiele', metodo: 'Permissão do usuário' } });
    const i = montarItem({ regra: 'desconto', valor: 50, evento: e, userId: 'u2', agora: AGORA, ritmo: { hoje: 3, media: 1 } });
    expect(i.autorizou).toBeNull();
    expect(i.generico).toBe(false);
    expect(i.onde).toBe('Mesa 3');
    expect(i.titulo).toContain('(Mesa 3)');
    expect(i.ritmo).toBe('3º desconto hoje · média 1 por dia');
    expect(i.busca).toBe('50,00');
    expect(i.motivo).toBe('autorizado por permissão do usuário');
  });
  it('sangria vai para o grupo Caixa e busca pelo valor', () => {
    const i = montarItem({ regra: 'sangria', valor: 520, evento: ev({ after: { valor: 520, motivo: 'diária freelancer' }, entity_label: 'ce902b74-6170-4b8d-be61-33080808bd3a' }), userId: 'u1', agora: AGORA });
    expect(i.grupo).toBe('caixa');
    expect(i.motivo).toBe('diária freelancer');
    expect(rotaDoItem(i)).toBe('/auditoria?grupo=caixa&busca=520%2C00');
    expect(rotaDoItem({ grupo: 'pedidos', busca: null })).toBe('/auditoria?grupo=pedidos');
  });
  it('mesmo evento reenviado tem o mesmo id; outro valor não', () => {
    const a = montarItem({ regra: 'sangria', valor: 520, evento: ev({ entity_label: 'x' }), userId: 'u1', agora: AGORA });
    const b = montarItem({ regra: 'sangria', valor: 520, evento: ev({ entity_label: 'x' }), userId: 'u1', agora: new Date(AGORA.getTime() + 5000) });
    const c = montarItem({ regra: 'sangria', valor: 600, evento: ev({ entity_label: 'x' }), userId: 'u1', agora: AGORA });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });
  it('título do cartão: um item mostra o item; vários, a contagem', () => {
    expect(tituloDoCartao([{ titulo: 'Sangria de R$ 520,00' }])).toBe('Sangria de R$ 520,00');
    expect(tituloDoCartao([{ titulo: 'a' }, { titulo: 'b' }, { titulo: 'c' }])).toBe('3 coisas da equipe hoje');
  });
  it('texto do aviso no celular', () => {
    const i = montarItem({ regra: 'sangria', valor: 520, evento: ev({ after: { valor: 520, motivo: 'diária' } }), userId: 'u1', agora: AGORA });
    const t = textoPush('Paranaguá', i);
    expect(t.titulo).toBe('Fique de olho · Paranaguá');
    expect(t.corpo).toContain('Sangria de');
    expect(t.corpo).toContain('13:42');
    expect(t.corpo).toContain('“diária”');
  });
  it('itensDoPayload ignora lixo', () => {
    expect(itensDoPayload(null)).toEqual([]);
    expect(itensDoPayload({ itens: [{ titulo: 'a' }, null, { x: 1 }] })).toHaveLength(1);
  });
});

describe('celular: nunca entre 23h e 7h (Brasília)', () => {
  it('janela 07:00–22:59', () => {
    expect(podeAvisarAgora('2026-10-05T10:00:00Z')).toBe(true);  // 07:00
    expect(podeAvisarAgora('2026-10-05T09:59:00Z')).toBe(false); // 06:59
    expect(podeAvisarAgora('2026-10-06T01:59:00Z')).toBe(true);  // 22:59
    expect(podeAvisarAgora('2026-10-06T02:00:00Z')).toBe(false); // 23:00
    expect(podeAvisarAgora('2026-10-05T03:00:00Z')).toBe(false); // 00:00
  });
});

describe('na tela Hoje: é ciência, não entra em "Agora"', () => {
  const pend = (o: Partial<PendHoje>): PendHoje => ({
    id: 'o1', tenantId: 'par', loja: 'Paranaguá', kind: 'fique_de_olho', ref: '2026-10-05', titulo: '3 coisas da equipe hoje', detalhe: null,
    rota: '/auditoria', urgencia: 'normal', acaoRequerida: false, status: 'aberta', criadaEm: '2026-10-05T16:00:00Z', payload: { itens: [] }, ...o,
  });
  it('fica no bloco "espera" (nunca no número vermelho de Agora)', () => {
    const itens = organizarHoje([pend({})], '2026-10-05');
    expect(itens).toHaveLength(1);
    expect(itens[0].bloco).toBe('espera');
  });
  it('ciente pelo chat/Pendências (vista) silencia até chegar ocorrência nova', () => {
    expect(organizarHoje([pend({ status: 'vista' })], '2026-10-05')[0].bloco).toBe('silenciado');
  });
  it('só Administrador e Supervisor (gerente) veem; Líder, caixa e financeiro não', () => {
    expect(pendenciaVisivelPara('fique_de_olho', 'admin', 'a@b.c')).toBe(true);
    expect(pendenciaVisivelPara('fique_de_olho', 'gerente', 'a@b.c')).toBe(true);
    expect(pendenciaVisivelPara('fique_de_olho', 'supervisao', 'a@b.c')).toBe(false);
    expect(pendenciaVisivelPara('fique_de_olho', 'caixa', 'a@b.c')).toBe(false);
    expect(pendenciaVisivelPara('fique_de_olho', 'financeiro', 'a@b.c')).toBe(false);
  });
});

// A regra do cartão que mora no banco (migração ainda não aplicada) não roda no vitest: aqui só se trava, pelo texto da
// migração, o que a revisão de 05/10 apontou, para ninguém desfazer sem querer.
describe('migração do Fique de olho: descartar não cala o alarme; só o Administrador dá ciência', () => {
  const sql = readFileSync('supabase/migrations/20261005171500_fique_de_olho.sql', 'utf8');
  const aposAdd = sql.slice(sql.indexOf('fn_fique_de_olho_add'), sql.indexOf('revoke all on function public.fn_fique_de_olho_add'));
  const aposMarcar = sql.slice(sql.indexOf('create or replace function public.fn_pendencia_marcar'));

  it('cartão descartado se comporta como resolvido (reabre só com o que é novo) e nunca devolve ok=false', () => {
    expect(aposAdd).not.toMatch(/'motivo',\s*'descartada'/);
    expect(aposAdd).toMatch(/r\.status in \('resolvida', 'descartada'\)/);
    expect(aposAdd).toContain("status = 'aberta'");
  });
  it('o aviso de celular (1 por regra por hora, 7h-23h) não depende do estado do cartão', () => {
    // os únicos ok=false são entrada inválida (item e regra): nenhum depende do estado do cartão
    expect(aposAdd.match(/'ok', false/g)).toHaveLength(2);
    expect(aposAdd).toMatch(/v_hora >= 7 and v_hora < 23/);
    expect(aposAdd).toMatch(/interval '1 hour'/);
  });
  it('fn_pendencia_marcar barra quem não é Administrador (nem dono da plataforma) no kind fique_de_olho', () => {
    expect(aposMarcar).toMatch(/r\.kind = 'fique_de_olho'/);
    expect(aposMarcar).toMatch(/is_platform_owner/);
    expect(aposMarcar).toMatch(/role::text = 'admin'/);
    expect(aposMarcar).toMatch(/grant execute on function public\.fn_pendencia_marcar\(uuid, text, text\) to authenticated, service_role/);
  });
});
