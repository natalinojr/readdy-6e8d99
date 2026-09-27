import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { textoGps, useMotoboyGps } from '@/pages/motoboy/useMotoboyGps';

// App Android: o hook usa o plugin nativo (window.Capacitor.Plugins.BackgroundGeolocation) em vez do navegador.
type Cb = (l?: { latitude: number; longitude: number; accuracy: number | null; bearing: number | null; speed: number | null }, e?: { code?: string }) => void;

describe('useMotoboyGps no app (GPS em segundo plano)', () => {
  let cb: Cb | null;
  const addWatcher = vi.fn();
  const removeWatcher = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    cb = null;
    addWatcher.mockReset().mockImplementation((_o: unknown, f: Cb) => { cb = f; return Promise.resolve('w1'); });
    removeWatcher.mockReset().mockResolvedValue(undefined);
    fetchMock.mockReset().mockResolvedValue({ json: () => Promise.resolve({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      Plugins: { BackgroundGeolocation: { addWatcher, removeWatcher, openSettings: vi.fn().mockResolvedValue(undefined) } },
    };
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('só liga com entrega ativa / turno, com aviso fixo e pedindo permissão', () => {
    const { rerender } = renderHook(({ on }) => useMotoboyGps('t1', 'd1', on), { initialProps: { on: false } });
    expect(addWatcher).not.toHaveBeenCalled();
    rerender({ on: true });
    expect(addWatcher).toHaveBeenCalledTimes(1);
    expect(addWatcher.mock.calls[0][0]).toMatchObject({ requestPermissions: true, stale: false, backgroundMessage: expect.any(String) });
  });

  it('mesmas regras: ≥15 s e ≥30 m entre envios', async () => {
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    const { result } = renderHook(() => useMotoboyGps('t1', 'd1', true));
    const ler = async (lat: number) => { await act(async () => { cb!({ latitude: lat, longitude: -48.51, accuracy: 10, bearing: null, speed: null }); }); };
    await ler(-25.52);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.estado).toBe('ativo_fundo');
    vi.setSystemTime(new Date('2026-09-27T12:00:05Z'));
    await ler(-25.53); // 5 s depois: não envia
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-27T12:00:20Z'));
    await ler(-25.52001); // 20 s, mas ~1 m: não envia
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-27T12:00:40Z'));
    await ler(-25.53); // 40 s e ~1 km: envia
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ action: 'ping_position', tenant_id: 't1', driver_id: 'd1', lat: -25.53 });
  });

  it('desligar remove o serviço (some o aviso fixo)', async () => {
    const { rerender } = renderHook(({ on }) => useMotoboyGps('t1', 'd1', on), { initialProps: { on: true } });
    await act(async () => { await Promise.resolve(); });
    rerender({ on: false });
    expect(removeWatcher).toHaveBeenCalledWith({ id: 'w1' });
  });

  it('permissão negada: estado negado e o aviso abre as configurações do app', async () => {
    const { result } = renderHook(() => useMotoboyGps('t1', 'd1', true));
    await act(async () => { cb!(undefined, { code: 'NOT_AUTHORIZED' }); });
    expect(result.current.estado).toBe('negado');
    const aviso = textoGps('negado');
    expect(aviso?.acao).toBeTypeOf('function');
    expect(aviso?.texto).toMatch(/Permitir/);
  });
});

describe('useMotoboyGps no navegador (sem o app)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('usa watchPosition e envia a posição', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    let ok: ((p: GeolocationPosition) => void) | null = null;
    const geo = { watchPosition: vi.fn((f: (p: GeolocationPosition) => void) => { ok = f; return 7; }), clearWatch: vi.fn() };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    const { result, unmount } = renderHook(() => useMotoboyGps('t1', 'd1', true));
    await act(async () => { ok!({ coords: { latitude: -25.52, longitude: -48.51, accuracy: 8, heading: null, speed: null } } as unknown as GeolocationPosition); });
    expect(result.current.estado).toBe('ativo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(textoGps('ativo')?.texto).toMatch(/mantenha esta tela aberta/);
  });
});
