import { describe, it, expect } from 'vitest';
import { createCoalescedRunner, syncBackoffMs } from '@/lib/coalescedRunner';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('createCoalescedRunner (recarga do KDS)', () => {
  it('rajada de chamadas durante uma execução gera só 1 execução extra', async () => {
    const gates: Array<ReturnType<typeof deferred>> = [];
    const args: Array<string | undefined> = [];
    const run = createCoalescedRunner<string>(() => async (a) => {
      args.push(a);
      const d = deferred();
      gates.push(d);
      await d.promise;
    });

    const p1 = run('a');
    const p2 = run();
    const p3 = run('b');
    const p4 = run();
    expect(p3).toBe(p2);
    expect(p4).toBe(p2);
    expect(args).toEqual(['a']);

    gates[0].resolve();
    await p1;
    await Promise.resolve();
    await Promise.resolve();
    expect(args).toEqual(['a', 'b']);

    gates[1].resolve();
    await p2;
    expect(args).toHaveLength(2);
  });

  it('erro na execução não trava as próximas', async () => {
    let calls = 0;
    const run = createCoalescedRunner<void>(() => async () => {
      calls += 1;
      if (calls === 1) throw new Error('falhou');
    });
    await run();
    await run();
    expect(calls).toBe(2);
  });
});

describe('syncBackoffMs', () => {
  it('cresce de 30s até o teto de 5 min', () => {
    expect(syncBackoffMs(0)).toBe(30_000);
    expect(syncBackoffMs(1)).toBe(60_000);
    expect(syncBackoffMs(3)).toBe(240_000);
    expect(syncBackoffMs(4)).toBe(300_000);
    expect(syncBackoffMs(50)).toBe(300_000);
  });
});
