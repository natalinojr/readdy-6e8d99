import { useRef, useCallback } from 'react';

/**
 * KDS Sound Alerts using Web Audio API — no dependencies needed.
 * Generates synthesized beeps for different events.
 */
export function useKDSSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback((): AudioContext | null => {
    try {
      if (!ctxRef.current || ctxRef.current.state === 'closed') {
        ctxRef.current = new AudioContext();
      }
      return ctxRef.current;
    } catch {
      return null;
    }
  }, []);

  const beep = useCallback((
    freq: number,
    duration: number,
    volume: number,
    delay = 0,
    type: 'sine' | 'square' | 'sawtooth' | 'triangle' = 'sine',
  ) => {
    const ctx = getCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);

    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.05);
  }, [getCtx]);

  /** Double beep — novo pedido chegou */
  const playNovoPedido = useCallback(() => {
    beep(880, 0.12, 0.4, 0, 'sine');
    beep(1100, 0.15, 0.4, 0.18, 'sine');
  }, [beep]);

  /** Triple high beep — SLA ultrapassado */
  const playSLAAlerta = useCallback(() => {
    beep(660, 0.08, 0.3, 0, 'square');
    beep(660, 0.08, 0.3, 0.12, 'square');
    beep(440, 0.2, 0.35, 0.24, 'square');
  }, [beep]);

  /** Soft ding — pedido pronto */
  const playPedidoPronto = useCallback(() => {
    beep(1047, 0.1, 0.25, 0, 'sine');
    beep(1319, 0.2, 0.2, 0.12, 'sine');
  }, [beep]);

  /** Resume AudioContext (must be called from user gesture) */
  const resume = useCallback(async () => {
    const ctx = getCtx();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
  }, [getCtx]);

  return { playNovoPedido, playSLAAlerta, playPedidoPronto, resume };
}
