import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface Rastreio {
  motoboy: { lat: number; lng: number; atualizado_em: string } | null;
  destino: { lat: number; lng: number } | null;
  distancia_km: number | null;
  eta_min: number | null;
  /** Pela previsão o motoboy já deve estar chegando (eta_min vem nulo). */
  chegando?: boolean;
}

const motoIcon = L.divIcon({
  className: '',
  html: '<div style="background:#f59e0b;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45);font-size:18px">🛵</div>',
  iconSize: [36, 36], iconAnchor: [18, 18],
});
const casaIcon = L.divIcon({
  className: '',
  html: '<div style="background:#18181b;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45);font-size:15px">🏠</div>',
  iconSize: [32, 32], iconAnchor: [16, 16],
});

// Enquadra moto + casa na 1ª vez (e de novo se aparecer um ponto que faltava);
// depois só acompanha a moto se ela sair da tela.
function Enquadrar({ moto, casa }: { moto: [number, number] | null; casa: [number, number] | null }) {
  const map = useMap();
  const enquadrados = useRef(0);
  useEffect(() => {
    const pts = [moto, casa].filter((p): p is [number, number] => !!p);
    if (pts.length === 0) return;
    if (pts.length > enquadrados.current) {
      enquadrados.current = pts.length;
      // O mapa monta dentro do Suspense: acerta o tamanho antes de enquadrar (senão a casa sai cortada).
      map.invalidateSize();
      if (pts.length === 1) map.setView(pts[0], 16);
      else map.fitBounds(L.latLngBounds(pts), { padding: [44, 44], maxZoom: 17 });
      return;
    }
    if (moto && !map.getBounds().contains(moto)) map.panTo(moto);
  }, [moto?.[0], moto?.[1], casa?.[0], casa?.[1], map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Mapa do cliente: a moto (posição ao vivo) até a casa dele. */
export default function RastreioMapa({ rastreio }: { rastreio: Rastreio }) {
  const moto: [number, number] | null = rastreio.motoboy ? [rastreio.motoboy.lat, rastreio.motoboy.lng] : null;
  const casa: [number, number] | null = rastreio.destino ? [rastreio.destino.lat, rastreio.destino.lng] : null;
  const center = moto ?? casa ?? [-25.59, -48.35];
  return (
    <div data-no-pull className="h-52 w-full rounded-2xl overflow-hidden border border-zinc-200 relative z-0">
      <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} attributionControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Enquadrar moto={moto} casa={casa} />
        {moto && casa ? <Polyline positions={[moto, casa]} pathOptions={{ color: '#f59e0b', weight: 3, dashArray: '6 8' }} /> : null}
        {casa ? <Marker position={casa} icon={casaIcon} /> : null}
        {moto ? <Marker position={moto} icon={motoIcon} zIndexOffset={1000} /> : null}
      </MapContainer>
    </div>
  );
}
