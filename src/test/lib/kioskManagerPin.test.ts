import { describe, it, expect, vi } from 'vitest';
import { validarPinGerente, type KioskInvoke } from '@/lib/kioskManagerPin';

const TENANT = 'loja-1';
const inv = (data: unknown, error: Error | null = null): KioskInvoke =>
  vi.fn(async () => ({ data: data as never, error }));

describe('validarPinGerente', () => {
  it('aceita gerente da mesma loja e chama login-pin com verify_only', async () => {
    const invoke = inv({ role: 'manager', tenant_id: TENANT });
    const r = await validarPinGerente(invoke, { matricula: ' 123 ', pin: '4321', tenantId: TENANT });
    expect(r).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('login-pin', {
      badge_number: '123', pin: '4321', verify_only: true, tenant_id: TENANT, require_manager: true,
    });
  });

  it('recusa com "Apenas gerente" quando a edge nega o papel naquela loja', async () => {
    const r = await validarPinGerente(inv(null, new Error('Apenas gerente ou administrador')), { matricula: '1', pin: '1111', tenantId: TENANT });
    expect(r).toEqual({ ok: false, erro: 'Apenas gerente ou administrador', contaTentativa: true });
  });

  it('recusa sem vínculo na loja do totem (403 da edge)', async () => {
    const r = await validarPinGerente(inv(null, new Error('Usuário sem acesso a esta loja')), { matricula: '1', pin: '1111', tenantId: TENANT });
    expect(r).toEqual({ ok: false, erro: 'Matrícula ou PIN incorretos', contaTentativa: true });
  });

  it('aceita admin da mesma loja', async () => {
    const r = await validarPinGerente(inv({ role: 'admin', tenant_id: TENANT }), { matricula: '1', pin: '1111', tenantId: TENANT });
    expect(r.ok).toBe(true);
  });

  it('recusa operador da mesma loja e conta tentativa', async () => {
    const r = await validarPinGerente(inv({ role: 'cashier', tenant_id: TENANT }), { matricula: '1', pin: '1111', tenantId: TENANT });
    expect(r).toEqual({ ok: false, erro: 'Apenas gerente ou administrador', contaTentativa: true });
  });

  it('recusa gerente de outra loja', async () => {
    const r = await validarPinGerente(inv({ role: 'admin', tenant_id: 'outra' }), { matricula: '1', pin: '1111', tenantId: TENANT });
    expect(r).toEqual({ ok: false, erro: 'Matrícula ou PIN incorretos', contaTentativa: true });
  });

  it('recusa PIN errado (erro da edge)', async () => {
    const r = await validarPinGerente(inv(null, new Error('PIN incorreto')), { matricula: '1', pin: '0000', tenantId: TENANT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.contaTentativa).toBe(true);
  });

  it('não chama a edge sem matrícula, PIN ou loja', async () => {
    const invoke = inv({ role: 'admin', tenant_id: TENANT });
    expect((await validarPinGerente(invoke, { matricula: '', pin: '1', tenantId: TENANT })).ok).toBe(false);
    expect((await validarPinGerente(invoke, { matricula: '1', pin: ' ', tenantId: TENANT })).ok).toBe(false);
    expect((await validarPinGerente(invoke, { matricula: '1', pin: '1', tenantId: null })).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('429 do servidor (limite de tentativas) mostra a mensagem e não conta tentativa local', async () => {
    const r = await validarPinGerente(inv(null, new Error('Muitas tentativas. Aguarde 15 minutos.')), { matricula: '1', pin: '1111', tenantId: TENANT });
    expect(r).toEqual({ ok: false, erro: 'Muitas tentativas. Aguarde 15 minutos.', contaTentativa: false });
  });

  it('exceção de rede não conta tentativa', async () => {
    const invoke: KioskInvoke = vi.fn(async () => { throw new Error('offline'); });
    const r = await validarPinGerente(invoke, { matricula: '1', pin: '1111', tenantId: TENANT });
    expect(r).toEqual({ ok: false, erro: 'Erro ao validar PIN', contaTentativa: false });
  });
});
