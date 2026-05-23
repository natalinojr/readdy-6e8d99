/**
 * Lightweight pub/sub reload signal.
 * Each "channel" is a string key. Calling notify(channel) triggers all
 * subscribers of that channel to re-run their load function.
 *
 * Usage in a hook:
 *   const tick = useReloadSignal('payment_methods');
 *   useEffect(() => { load(); }, [load, tick]);
 *
 *   // To trigger reload from anywhere:
 *   notifyReload('payment_methods');
 */

const signals = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

export function notifyReload(channel: string): void {
  signals.set(channel, (signals.get(channel) ?? 0) + 1);
  listeners.get(channel)?.forEach(fn => fn());
}

export function subscribeReload(channel: string, fn: () => void): () => void {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel)!.add(fn);
  return () => listeners.get(channel)?.delete(fn);
}
