// Aprovar/Recusar pelo aviso do celular (2026-10-05): o token prova quem, qual pedido e qual decisão.
import { describe, it, expect } from 'vitest';
import { assinarAcao, chaveDaAcao, verificarAcao, avaliarDecisaoPdv, VALIDADE_ACAO_SEG } from '../../../supabase/functions/_shared/push-acao';

const SEGREDO = 'segredo-de-teste-com-mais-de-16-caracteres';
const base = { k: 'pdv' as const, id: '11111111-1111-1111-1111-111111111111', u: '22222222-2222-2222-2222-222222222222', a: 'aprovar' as const };

describe('token da ação do push', () => {
  it('assina e confere: devolve pessoa, pedido e decisão', async () => {
    const chave = await chaveDaAcao(SEGREDO);
    const t = await assinarAcao(base, chave);
    const r = await verificarAcao(t, chave);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.carga).toMatchObject({ k: 'pdv', id: base.id, u: base.u, a: 'aprovar' });
  });
  it('expira em 15 minutos', async () => {
    const chave = await chaveDaAcao(SEGREDO);
    const agora = Date.now();
    const t = await assinarAcao(base, chave, agora);
    expect((await verificarAcao(t, chave, agora + (VALIDADE_ACAO_SEG - 5) * 1000)).ok).toBe(true);
    expect(await verificarAcao(t, chave, agora + (VALIDADE_ACAO_SEG + 5) * 1000)).toEqual({ ok: false, motivo: 'expirado' });
  });
  it('adulterar a decisão, a pessoa ou o pedido invalida a assinatura', async () => {
    const chave = await chaveDaAcao(SEGREDO);
    const t = await assinarAcao(base, chave);
    const [v, corpo, sig] = t.split('.');
    const trocar = (campo: string, valor: string) => {
      const c = JSON.parse(atob(corpo.replace(/-/g, '+').replace(/_/g, '/')));
      c[campo] = valor;
      return `${v}.${btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${sig}`;
    };
    for (const adulterado of [trocar('a', 'recusar'), trocar('u', '33333333-3333-3333-3333-333333333333'), trocar('id', '44444444-4444-4444-4444-444444444444')]) {
      expect(await verificarAcao(adulterado, chave)).toEqual({ ok: false, motivo: 'invalido' });
    }
  });
  it('chave de outro segredo, lixo e tipos errados são inválidos', async () => {
    const chave = await chaveDaAcao(SEGREDO);
    const outra = await chaveDaAcao('outro-segredo-bem-comprido-123456');
    const t = await assinarAcao(base, chave);
    expect(await verificarAcao(t, outra)).toEqual({ ok: false, motivo: 'invalido' });
    for (const lixo of ['', 'abc', 'v1.a.b', 'v2.a.b', null, undefined, 42, {}, 'v1.' + 'x'.repeat(2000) + '.y']) {
      expect(await verificarAcao(lixo, chave)).toEqual({ ok: false, motivo: 'invalido' });
    }
  });
  it('sem segredo configurado não assina', async () => {
    await expect(chaveDaAcao('')).rejects.toThrow();
    await expect(chaveDaAcao('curto')).rejects.toThrow();
  });
});

describe('avaliarDecisaoPdv', () => {
  const pedido = { status: 'pendente', tipo: 'desconto', requested_by: 'caixa-1' };
  it('supervisor/gerente/admin decidem desconto e cancelamento pendentes', () => {
    for (const papel of ['admin', 'manager', 'supervisor']) {
      expect(avaliarDecisaoPdv({ pedido, userId: 'u1', papel }).ok).toBe(true);
      expect(avaliarDecisaoPdv({ pedido: { ...pedido, tipo: 'cancelamento' }, userId: 'u1', papel }).ok).toBe(true);
    }
  });
  it('caixa, sem vínculo e quem pediu não decidem', () => {
    expect(avaliarDecisaoPdv({ pedido, userId: 'u1', papel: 'cashier' })).toMatchObject({ ok: false, codigo: 'sem_acesso' });
    expect(avaliarDecisaoPdv({ pedido, userId: 'u1', papel: null })).toMatchObject({ ok: false, codigo: 'sem_acesso' });
    expect(avaliarDecisaoPdv({ pedido, userId: 'caixa-1', papel: 'admin' })).toMatchObject({ ok: false, codigo: 'sem_acesso' });
  });
  it('pedido já decidido ou cancelado não decide de novo, e diz por quem', () => {
    const r = avaliarDecisaoPdv({ pedido: { ...pedido, status: 'aprovado', resolved_by_name: 'Ana' }, userId: 'u1', papel: 'manager' });
    expect(r).toMatchObject({ ok: false, codigo: 'ja_decidido' });
    if (!r.ok) expect(r.mensagem).toContain('Ana');
    expect(avaliarDecisaoPdv({ pedido: { ...pedido, status: 'cancelado' }, userId: 'u1', papel: 'manager' })).toMatchObject({ ok: false, codigo: 'ja_decidido' });
  });
  it('problema no item só no app', () => {
    expect(avaliarDecisaoPdv({ pedido: { ...pedido, tipo: 'problema_item' }, userId: 'u1', papel: 'manager' })).toMatchObject({ ok: false, codigo: 'so_no_app' });
  });
});
