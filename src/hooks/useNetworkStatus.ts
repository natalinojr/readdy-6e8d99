/**
 * useNetworkStatus.ts — Detector de conectividade com debounce
 *
 * Combina navigator.onLine com ping real ao Supabase para evitar
 * falsos positivos (ex: rede conectada mas sem acesso à internet).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { SUPABASE_URL } from '@/lib/supabase';

export interface NetworkStatus {
  isOnline: boolean;
  /** true quando está verificando conectividade */
  isChecking: boolean;
  /** Timestamp da última verificação bem-sucedida */
  lastOnlineAt: number | null;
  /** Força uma verificação imediata */
  checkNow: () => Promise<boolean>;
}

const PING_TIMEOUT_MS = 5000;
const DEBOUNCE_MS = 2000;
const RECHECK_INTERVAL_MS = 30000; // verifica a cada 30s quando offline

/** Faz um ping leve ao Supabase para confirmar conectividade real */
async function pingSupabase(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    // Usa o health endpoint do Supabase — resposta rápida, sem autenticação
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);
    return response.ok || response.status === 401; // 401 = servidor respondeu (sem auth)
  } catch {
    return false;
  }
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isChecking, setIsChecking] = useState(false);
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(
    navigator.onLine ? Date.now() : null,
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkNow = useCallback(async (): Promise<boolean> => {
    setIsChecking(true);
    try {
      const online = await pingSupabase();
      setIsOnline(online);
      if (online) {
        setLastOnlineAt(Date.now());
      }
      return online;
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Handler com debounce para eventos online/offline do browser
  const handleNetworkChange = useCallback((browserSaysOnline: boolean) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      if (!browserSaysOnline) {
        // Browser diz offline — confia imediatamente (sem ping)
        setIsOnline(false);
        return;
      }
      // Browser diz online — confirma com ping real
      await checkNow();
    }, DEBOUNCE_MS);
  }, [checkNow]);

  useEffect(() => {
    const onOnline = () => handleNetworkChange(true);
    const onOffline = () => handleNetworkChange(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Verificação inicial
    checkNow();

    // Recheck periódico quando offline (para detectar reconexão)
    recheckRef.current = setInterval(() => {
      if (!navigator.onLine) return; // browser diz offline — não pinga
      checkNow();
    }, RECHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (recheckRef.current) clearInterval(recheckRef.current);
    };
  }, [handleNetworkChange, checkNow]);

  return { isOnline, isChecking, lastOnlineAt, checkNow };
}
