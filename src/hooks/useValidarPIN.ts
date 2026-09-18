import { useCallback, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type ValidarPINResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Hook para validar o PIN de um usuário via edge function login-pin.
 * Usado em modais de autorização (desconto, cancelamento) sem criar nova sessão:
 * verify_only (não gera magic link) + tenant_id da loja ativa (exige vínculo nela).
 * O papel do autorizador já vem filtrado pela lista da tela.
 */
export function useValidarPIN() {
  const [verificando, setVerificando] = useState(false);
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;

  const validarPIN = useCallback(
    async (matricula: string, pin: string): Promise<ValidarPINResult> => {
      if (!matricula.trim() || !pin.trim()) {
        return { ok: false, message: 'Matrícula e PIN são obrigatórios' };
      }
      setVerificando(true);
      try {
        const { data, error } = await invokeWithAuth<{
          name?: string | null;
          role?: string | null;
          tenant_id?: string | null;
          error?: string;
        }>('login-pin', {
          body: {
            badge_number: matricula.trim(),
            pin: pin.trim(),
            verify_only: true,
            ...(tenantId ? { tenant_id: tenantId } : {}),
          },
        });

        if (error) {
          // FunctionsHttpError traz o message da response
          const msg =
            (error as { message?: string }).message ?? 'Erro ao verificar PIN';
          return { ok: false, message: msg };
        }

        if (data && !data.error) {
          return { ok: true };
        }

        return { ok: false, message: data?.error ?? 'PIN inválido' };
      } catch (e) {
        return { ok: false, message: String(e) };
      } finally {
        setVerificando(false);
      }
    },
    [tenantId],
  );

  return { validarPIN, verificando };
}
