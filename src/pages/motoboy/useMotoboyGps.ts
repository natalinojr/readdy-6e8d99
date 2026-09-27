import { useEffect, useRef, useState } from 'react';

function edgeUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/motoboy-signal';
}

export type GpsEstado = 'desligado' | 'pedindo' | 'ativo' | 'negado' | 'indisponivel';

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
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { setEstado('indisponivel'); return; }
    setEstado('pedindo');

    const enviar = async (pos: GeolocationPosition) => {
      const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
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

    const watchId = navigator.geolocation.watchPosition(
      (pos) => { setEstado('ativo'); void enviar(pos); },
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

/** Faixa de aviso do GPS para o motoboy ("mantenha esta tela aberta"). */
export function textoGps(estado: GpsEstado): { cls: string; icon: string; texto: string } | null {
  switch (estado) {
    case 'ativo': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'ri-map-pin-user-fill', texto: 'Localização ligada — mantenha esta tela aberta durante a entrega.' };
    case 'pedindo': return { cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: 'ri-loader-4-line', texto: 'Ligando a localização… permita o acesso quando o celular pedir.' };
    case 'negado': return { cls: 'bg-red-50 text-red-700 border-red-200', icon: 'ri-map-pin-off-line', texto: 'Localização bloqueada. Libere nas configurações do navegador para a loja e o cliente verem a entrega.' };
    case 'indisponivel': return { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'ri-error-warning-line', texto: 'Não foi possível ler o GPS. Ligue a localização do celular.' };
    default: return null;
  }
}
