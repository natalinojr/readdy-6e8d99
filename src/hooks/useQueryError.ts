import { useState, useCallback } from 'react';

export interface QueryError {
  message: string;
  code?: string;
  hint?: string;
}

/**
 * Traduz erros do Supabase/PostgREST para mensagens amigáveis em português.
 */
export function translateSupabaseError(error: unknown): QueryError {
  if (!error) return { message: 'Erro desconhecido.' };

  const err = error as Record<string, unknown>;
  const code = String(err.code ?? '');
  const message = String(err.message ?? '');
  const hint = String(err.hint ?? '');

  // HTTP 400 — Bad Request (filtro inválido, coluna inexistente, etc.)
  if (code === 'PGRST100' || message.includes('invalid input syntax')) {
    return {
      code,
      message: 'Filtro de data inválido. Verifique o período selecionado.',
      hint,
    };
  }
  if (code === '42703' || message.includes('column') && message.includes('does not exist')) {
    return {
      code,
      message: 'Erro interno: campo não encontrado na consulta.',
      hint,
    };
  }
  if (code === 'PGRST204' || code === 'PGRST205') {
    return {
      code,
      message: 'Tabela ou coluna não encontrada. Contate o suporte.',
      hint,
    };
  }

  // HTTP 403 — Forbidden (RLS bloqueando)
  if (code === '42501' || message.includes('permission denied') || message.includes('row-level security')) {
    return {
      code,
      message: 'Sem permissão para acessar esses dados. Verifique seu perfil de acesso.',
      hint,
    };
  }

  // HTTP 401 — Unauthorized (sessão expirada)
  if (code === 'PGRST301' || message.includes('JWT') || message.includes('token')) {
    return {
      code,
      message: 'Sessão expirada. Faça login novamente.',
      hint,
    };
  }

  // RPC não encontrada
  if (message.includes('function') && message.includes('does not exist')) {
    return {
      code,
      message: 'Função de relatório não disponível. Contate o suporte.',
      hint,
    };
  }

  // Genérico
  return {
    code,
    message: message || 'Erro ao carregar dados. Tente novamente.',
    hint,
  };
}

/**
 * Hook para gerenciar estado de erro de queries com mensagens amigáveis.
 */
export function useQueryError() {
  const [error, setError] = useState<QueryError | null>(null);

  const handleError = useCallback((raw: unknown, context?: string) => {
    const translated = translateSupabaseError(raw);
    if (context) {
      console.error(`[${context}]`, raw);
    }
    setError(translated);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { error, handleError, clearError };
}
