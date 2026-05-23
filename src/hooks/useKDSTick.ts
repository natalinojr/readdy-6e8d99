import { useState, useEffect } from 'react';

export function useKDSTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

export function getElapsedSeconds(fromMs: number): number {
  return Math.floor((Date.now() - fromMs) / 1000);
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type SLALevel = 'ok' | 'warning' | 'critical';

export function getSLALevel(elapsedSeconds: number, slaMinutos: number): SLALevel {
  const slaSeconds = slaMinutos * 60;
  const ratio = elapsedSeconds / slaSeconds;
  if (ratio < 0.75) return 'ok';
  if (ratio < 1.0) return 'warning';
  return 'critical';
}

/** Formata segundos em "Xmin Ys" ou "Xmin" */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}min ${s}s` : `${m}min`;
}

/** Fase atual de um item baseado nos seus timestamps */
export type ItemFase = 'aguardando' | 'preparo' | 'pronto_aguardando' | 'entregue';
export function getItemFase(status: string, iniciouPreparoEm?: number, ficouProntoEm?: number, entregueEm?: number): ItemFase {
  if (entregueEm) return 'entregue';
  if (ficouProntoEm) return 'pronto_aguardando';
  if (iniciouPreparoEm) return 'preparo';
  return 'aguardando';
}

export const SLA_COLORS: Record<SLALevel, string> = {
  ok: 'text-green-600',
  warning: 'text-amber-500',
  critical: 'text-red-500',
};

export const SLA_BG: Record<SLALevel, string> = {
  ok: 'bg-green-500',
  warning: 'bg-amber-400',
  critical: 'bg-red-500',
};
