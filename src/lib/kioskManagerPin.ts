// Validação de matrícula + PIN de gerente/administrador DA LOJA no totem.
// Usa login-pin com verify_only (não gera sessão). Compartilhado entre o modal de
// configuração do totem e o "Sair do totem".

export const MAX_TENTATIVAS_PIN_GERENTE = 5;

export interface VerifyPinResponse {
  name?: string | null;
  role?: string | null;
  tenant_id?: string | null;
  error?: string;
}

export type KioskInvoke = (
  functionName: string,
  body: Record<string, unknown>,
) => Promise<{ data: VerifyPinResponse | null; error: Error | null }>;

export type ResultadoPinGerente = { ok: true } | { ok: false; erro: string; contaTentativa: boolean };

export async function validarPinGerente(
  invoke: KioskInvoke,
  params: { matricula: string; pin: string; tenantId: string | null | undefined },
): Promise<ResultadoPinGerente> {
  const matricula = params.matricula.trim();
  const pin = params.pin.trim();
  if (!matricula) return { ok: false, erro: 'Digite a matrícula', contaTentativa: false };
  if (!pin) return { ok: false, erro: 'Digite o PIN', contaTentativa: false };
  if (!params.tenantId) return { ok: false, erro: 'Loja não identificada', contaTentativa: false };

  let data: VerifyPinResponse | null = null;
  let error: Error | null = null;
  try {
    // tenant_id: a edge valida o vínculo NESTA loja (admin de várias lojas não cai no
    // primeiro vínculo de outra) e, com require_manager, também o papel.
    ({ data, error } = await invoke('login-pin', {
      badge_number: matricula,
      pin,
      verify_only: true,
      tenant_id: params.tenantId,
      require_manager: true,
    }));
  } catch {
    return { ok: false, erro: 'Erro ao validar PIN', contaTentativa: false };
  }

  const msgErro = error?.message ?? data?.error ?? '';
  // 429 da edge (limite de tentativas no servidor): mostra a mensagem, sem contar tentativa local.
  if (/muitas tentativas/i.test(msgErro)) {
    return { ok: false, erro: msgErro, contaTentativa: false };
  }
  if (/apenas gerente/i.test(msgErro)) {
    return { ok: false, erro: 'Apenas gerente ou administrador', contaTentativa: true };
  }

  // Confere de novo no cliente (edge antiga ignorava tenant_id e devolvia o 1º vínculo).
  const validado = !error && !!data && !data.error;
  const mesmaLoja = validado && data!.tenant_id === params.tenantId;
  if (mesmaLoja && (data!.role === 'admin' || data!.role === 'manager')) return { ok: true };
  return {
    ok: false,
    erro: mesmaLoja ? 'Apenas gerente ou administrador' : 'Matrícula ou PIN incorretos',
    contaTentativa: true,
  };
}
