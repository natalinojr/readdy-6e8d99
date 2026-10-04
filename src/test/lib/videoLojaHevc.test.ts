import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ invokeWithAuth: vi.fn(), uploadMenuImage: vi.fn(), SUPABASE_ANON_KEY: 'x' }));

import { videoEhHevc } from '@/lib/videoLoja';

function caixa(tipo: string, tamanho: number): number[] {
  return [(tamanho >>> 24) & 255, (tamanho >>> 16) & 255, (tamanho >>> 8) & 255, tamanho & 255, ...Array.from(tipo).map((c) => c.charCodeAt(0))];
}

describe('videoEhHevc', () => {
  it('acha a caixa hvc1/hev1 do iPhone', () => {
    expect(videoEhHevc(new Uint8Array([0, 1, 2, ...caixa('hvc1', 180), 9, 9]))).toBe(true);
    expect(videoEhHevc(new Uint8Array([...caixa('hev1', 120)]))).toBe(true);
  });

  it('H.264 (avc1) passa', () => {
    expect(videoEhHevc(new Uint8Array([...caixa('avc1', 180)]))).toBe(false);
  });

  it('"hvc1" solto no meio dos dados (sem tamanho de caixa) não conta', () => {
    expect(videoEhHevc(new Uint8Array([0xff, 0xee, 0xdd, 0xcc, ...Array.from('hvc1').map((c) => c.charCodeAt(0))]))).toBe(false);
  });
});
