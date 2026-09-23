import { useEffect, useState } from 'react';
import type { TaskRow } from '../hooks/useTarefas';

/** "1h 30m", "45m", "2h", "0m". Segundos só aparecem abaixo de 1 min com `comSegundos`. */
export function formatarDuracao(segundos: number, comSegundos = false): string {
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (comSegundos && h === 0 && m === 0) return `${s}s`;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Relógio do cronômetro rodando: "0:04:12". */
export function formatarRelogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Horas com uma casa, pt-BR: 5,5h. */
export function formatarHoras(minutos: number): string {
  const h = Math.round((minutos / 60) * 10) / 10;
  return `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
}

/**
 * Lê o que a pessoa digita e devolve minutos (ou null se não entendeu):
 * "1h30", "1h 30m", "1:30", "90m", "90", "1,5h", "2d" (dia = 8h).
 * Número solto = minutos (é o que cabe em "15", "30", "90").
 */
export function lerDuracao(texto: string): number | null {
  const t = texto.trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
  if (!t) return null;
  const relogio = t.match(/^(\d+):(\d{1,2})$/);
  if (relogio) return Number(relogio[1]) * 60 + Number(relogio[2]);
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  // [Nd][Nh][N(m|min)] — os minutos depois de "h" podem vir sem o "m" ("1h30").
  const m = t.match(/^(?:(\d+(?:\.\d+)?)d)?(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)(?:m|min)?)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const total = Number(m[1] ?? 0) * 8 * 60 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return Math.round(total);
}

/** Tempo registrado agora (trechos encerrados + o que está rodando), em segundos. */
export function segundosRegistrados(task: TaskRow, agoraMs: number): number {
  const rodando = task.timer_started_at ? Math.max(0, (agoraMs - new Date(task.timer_started_at).getTime()) / 1000) : 0;
  return (task.time_tracked_seconds ?? 0) + rodando;
}

/** `Date.now()` que atualiza a cada segundo enquanto `ativo` — pro cronômetro contar na tela. */
export function useAgora(ativo: boolean): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    setAgora(Date.now());
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ativo]);
  return agora;
}
