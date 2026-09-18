/**
 * Coalesce chamadas de uma recarga assíncrona: no máximo 1 execução em voo + 1 pendente.
 *
 * - Sem nada em voo: executa na hora.
 * - Com algo em voo: agenda UMA nova execução para depois que a atual terminar
 *   (chamadas extras nesse intervalo compartilham essa mesma execução pendente).
 * - O argumento da execução pendente é o último não-undefined recebido.
 * - Erros da função são engolidos (quem chama não deve depender deles para o fluxo).
 *
 * `getRun` é lido a cada execução — permite passar uma ref com a versão mais nova da função.
 */
export function createCoalescedRunner<A>(
  getRun: () => (arg?: A) => Promise<void>,
): (arg?: A) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let queuedArg: A | undefined;

  const start = (arg?: A): Promise<void> =>
    (async () => {
      try {
        await getRun()(arg);
      } catch {
        /* recarga falhou — o chamador trata erro dentro de run */
      } finally {
        inFlight = null;
      }
    })();

  const call = (arg?: A): Promise<void> => {
    if (!inFlight) {
      inFlight = start(arg);
      return inFlight;
    }
    if (arg !== undefined) queuedArg = arg;
    if (!queued) {
      queued = inFlight.then(() => {
        queued = null;
        const a = queuedArg;
        queuedArg = undefined;
        return call(a);
      });
    }
    return queued;
  };

  return call;
}

/** Atraso de nova tentativa após falhas seguidas: 30s, 60s, 120s, 240s, depois 5 min. */
export function syncBackoffMs(failuresBeyondLimit: number): number {
  const n = Math.max(0, failuresBeyondLimit);
  return Math.min(30_000 * 2 ** n, 5 * 60_000);
}
