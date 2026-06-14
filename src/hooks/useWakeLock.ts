import { useEffect, useRef, useCallback } from 'react';

interface WakeLockSentinel {
  release: () => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

/**
 * useWakeLock — Mantém a tela do dispositivo ligada enquanto a página está ativa.
 *
 * Usa a Screen Wake Lock API (navigator.wakeLock).
 * Funciona em navegadores Chromium (Chrome/Edge) no Android e em navegadores
 * que suportam a API (Safari 16.4+ no iOS também tem suporte parcial).
 *
 * Para tablets Android usados como totem de autoatendimento, isso é essencial
 * pra evitar que a tela apague depois de alguns minutos de inatividade.
 */
export function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const enabledRef = useRef(true);

  const requestWakeLock = useCallback(async () => {
    // Verifica se a API está disponível
    if (!('wakeLock' in navigator)) {
      console.log('[WakeLock] API não disponível neste navegador');
      return;
    }

    if (!enabledRef.current) return;

    // Se já temos um sentinel ativo, não precisa pedir de novo
    if (sentinelRef.current) return;

    try {
      const sentinel = await (navigator as Navigator & {
        wakeLock: { request: (type: string) => Promise<WakeLockSentinel> };
      }).wakeLock.request('screen');

      sentinelRef.current = sentinel;
      console.log('[WakeLock] Tela mantida ligada com sucesso');

      // Se o wake lock for liberado pelo sistema (ex: bateria crítica),
      // limpa a referência pra poder re-requisitar depois
      sentinel.addEventListener('release', () => {
        console.log('[WakeLock] Liberado pelo sistema');
        sentinelRef.current = null;
      });
    } catch (err) {
      // Erros comuns: permissão negada, bateria baixa, etc.
      console.warn('[WakeLock] Falha ao ativar:', err);
      sentinelRef.current = null;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (sentinelRef.current) {
      try {
        await sentinelRef.current.release();
        console.log('[WakeLock] Liberado manualmente');
      } catch {
        // Já foi liberado, ignora
      }
      sentinelRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Tenta ativar o wake lock assim que o componente monta
    requestWakeLock();

    // Quando o usuário volta pra aba (ex: trocou de app e voltou),
    // o wake lock pode ter sido perdido — re-requisita
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabledRef.current) {
        // Pequeno delay pra garantir que o navegador processou a mudança de visibilidade
        setTimeout(() => {
          requestWakeLock();
        }, 500);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      enabledRef.current = false;
      releaseWakeLock();
    };
  }, [requestWakeLock, releaseWakeLock]);

  return { releaseWakeLock };
}