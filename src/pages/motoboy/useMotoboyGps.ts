import { useEffect, useRef, useState } from 'react';

function edgeUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/motoboy-signal';
}

export type GpsEstado = 'desligado' | 'pedindo' | 'ativo' | 'ativo_fundo' | 'negado' | 'indisponivel';

// App Android (Capacitor): plugin @capacitor-community/background-geolocation — serviço em primeiro plano
// com aviso fixo na barra, continua mandando com a tela apagada. O site chama pelo window.Capacitor (sem import).
interface LocalNativo { latitude: number; longitude: number; accuracy: number | null; bearing: number | null; speed: number | null }
interface GpsNativo {
  addWatcher(o: Record<string, unknown>, cb: (l?: LocalNativo, e?: { code?: string }) => void): Promise<string>;
  removeWatcher(o: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}
function gpsNativo(): GpsNativo | null {
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  if (!c?.isNativePlatform?.()) return null;
  return (c.Plugins?.BackgroundGeolocation as GpsNativo | undefined) ?? null;
}
/** No app: abre as configurações do ERPOS no Android (permissão de localização). */
export function abrirConfigGps(): void { gpsNativo()?.openSettings().catch(() => {}); }

// Limites de envio (o Supabase já travou por IO: nada de ping sem necessidade).
const MIN_INTERVALO_MS = 15000;   // no mínimo 15 s entre envios
const MIN_DISTANCIA_M = 30;       // e só se andou ≥ 30 m...
const HEARTBEAT_MS = 180000;      // ...ou a cada 3 min parado (mantém o "atualizado há X min")
const MAX_PRECISAO_M = 300;       // leitura pior que isso (antena) é descartada

function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * GPS do motoboy: liga `watchPosition` SÓ enquanto `ativo` (pedido dele em rota ou turno
 * ligado) e manda a posição pela Edge `motoboy-signal` (`ping_position`), com ≥15 s e ≥30 m
 * entre envios. Web só envia com a tela aberta: pede Wake Lock pra tela não apagar.
 */
export function useMotoboyGps(tenantId: string | null | undefined, driverId: string | null | undefined, ativo: boolean) {
  const [estado, setEstado] = useState<GpsEstado>('desligado');
  const [ultimoEnvio, setUltimoEnvio] = useState<number | null>(null);
  const ultimoRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const enviandoRef = useRef(false);

  useEffect(() => {
    if (!ativo || !tenantId || !driverId) { setEstado('desligado'); return; }
    const nativo = gpsNativo();
    if (!nativo && (typeof navigator === 'undefined' || !('geolocation' in navigator))) { setEstado('indisponivel'); return; }
    setEstado('pedindo');

    type Leitura = { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null };
    const enviar = async ({ lat, lng, accuracy, heading, speed }: Leitura) => {
      if (accuracy != null && accuracy > MAX_PRECISAO_M) return;
      const agora = Date.now();
      const ult = ultimoRef.current;
      if (ult) {
        const dt = agora - ult.t;
        if (dt < MIN_INTERVALO_MS) return;
        if (distanciaM(ult, { lat, lng }) < MIN_DISTANCIA_M && dt < HEARTBEAT_MS) return;
      }
      if (enviandoRef.current) return;
      enviandoRef.current = true;
      ultimoRef.current = { lat, lng, t: agora };
      try {
        const res = await fetch(edgeUrl(), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'ping_position', tenant_id: tenantId, driver_id: driverId, lat, lng,
            accuracy: accuracy ?? null, heading: heading ?? null, speed: speed ?? null,
          }),
        });
        const data = await res.json().catch(() => null);
        if (data?.ok) setUltimoEnvio(agora);
      } catch {
        // Sem rede: libera o próximo envio na próxima leitura.
        ultimoRef.current = ult;
      } finally {
        enviandoRef.current = false;
      }
    };

    // App Android: mesmas regras de envio (≥15 s e ≥30 m), mas pelo serviço com aviso fixo (tela pode apagar).
    if (nativo) {
      let watcherId: string | null = null;
      let encerrado = false;
      nativo.addWatcher({
        backgroundTitle: 'ERPOS — entrega em andamento',
        backgroundMessage: 'A loja vê onde você está até terminar as entregas.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 10,
      }, (l, e) => {
        if (e) { setEstado(e.code === 'NOT_AUTHORIZED' ? 'negado' : 'indisponivel'); return; }
        if (!l) return;
        setEstado('ativo_fundo');
        void enviar({ lat: l.latitude, lng: l.longitude, accuracy: l.accuracy ?? null, heading: l.bearing ?? null, speed: l.speed ?? null });
      }).then((id) => { if (encerrado) nativo.removeWatcher({ id }).catch(() => {}); else watcherId = id; })
        .catch(() => setEstado('indisponivel'));
      return () => {
        encerrado = true;
        if (watcherId) nativo.removeWatcher({ id: watcherId }).catch(() => {});
      };
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setEstado('ativo');
        const c = pos.coords;
        void enviar({ lat: c.latitude, lng: c.longitude, accuracy: c.accuracy ?? null, heading: c.heading ?? null, speed: c.speed ?? null });
      },
      (err) => { setEstado(err.code === err.PERMISSION_DENIED ? 'negado' : 'indisponivel'); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );

    // Tela acesa enquanto o GPS estiver ligado (onde o navegador suportar).
    type WakeLockSentinel = { release: () => Promise<void> };
    let lock: WakeLockSentinel | null = null;
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } }).wakeLock;
    const pedirLock = () => { if (wl && document.visibilityState === 'visible') wl.request('screen').then((l) => { lock = l; }).catch(() => {}); };
    pedirLock();
    document.addEventListener('visibilitychange', pedirLock);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      document.removeEventListener('visibilitychange', pedirLock);
      lock?.release().catch(() => {});
    };
  }, [ativo, tenantId, driverId]);

  return { estado, ultimoEnvio };
}

/** Faixa de aviso do GPS para o motoboy ("mantenha esta tela aberta"). `acao` = tocar abre as configurações (app). */
export function textoGps(estado: GpsEstado): { cls: string; icon: string; texto: string; acao?: () => void } | null {
  const noApp = !!gpsNativo();
  switch (estado) {
    case 'ativo': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'ri-map-pin-user-fill', texto: 'Localização ligada — mantenha esta tela aberta durante a entrega.' };
    case 'ativo_fundo': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'ri-map-pin-user-fill', texto: 'Localização ligada — pode apagar a tela: o aviso do ERPOS fica na barra até terminar. Se o celular economizar bateria, deixe o ERPOS "sem restrição" em Configurações › Bateria.' };
    case 'pedindo': return { cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: 'ri-loader-4-line', texto: 'Ligando a localização… permita o acesso quando o celular pedir.' };
    case 'negado': return noApp
      ? { cls: 'bg-red-50 text-red-700 border-red-200', icon: 'ri-map-pin-off-line', texto: 'Localização bloqueada para o ERPOS. Toque aqui, vá em Permissões › Localização e escolha "Permitir" (o tempo todo, se aparecer).', acao: abrirConfigGps }
      : { cls: 'bg-red-50 text-red-700 border-red-200', icon: 'ri-map-pin-off-line', texto: 'Localização bloqueada. Libere nas configurações do navegador para a loja e o cliente verem a entrega.' };
    case 'indisponivel': return { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'ri-error-warning-line', texto: 'Não foi possível ler o GPS. Ligue a localização do celular.' };
    default: return null;
  }
}
