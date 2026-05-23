import { useCallback, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';

export type ValidarPINResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Hook para validar o PIN de um usuário via edge function login-pin.
 * Usado em modais de autorização (desconto, cancelamento) sem criar nova sessão.
 */
export function useValidarPIN() {
  const [verificando, setVerificando] = useState(false);

  const validarPIN = useCallback(
    async (matricula: string, pin: string): Promise<ValidarPINResult> => {
      if (!matricula.trim() || !pin.trim()) {
        return { ok: false, message: 'Matrícula e PIN são obrigatórios' };
      }
      setVerificando(true);
      try {
        const { data, error } = await invokeWithAuth<{
          hashed_token?: string;
          error?: string;
        }>('login-pin', {
          body: { badge_number: matricula.trim(), pin: pin.trim() },
        });

        if (error) {
          // FunctionsHttpError traz o message da response
          const msg =
            (error as { message?: string }).message ?? 'Erro ao verificar PIN';
          return { ok: false, message: msg };
        }

        if (data?.hashed_token) {
          return { ok: true };
        }

        return { ok: false, message: data?.error ?? 'PIN inválido' };
      } catch (e) {
        return { ok: false, message: String(e) };
      } finally {
        setVerificando(false);
      }
    },
    [],
  );

  return { validarPIN, verificando };
}
