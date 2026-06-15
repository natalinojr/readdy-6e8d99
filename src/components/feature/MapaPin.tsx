import { useMemo, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Corrige os ícones padrão do Leaflet (quebram com bundlers como o Vite)
const pinIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface Props {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  /** Centro padrão quando ainda não há pin (lat, lng). Default: região Pontal do PR. */
  defaultCenter?: [number, number];
  /** Classe de altura do mapa (ex.: 'h-72'). */
  altura?: string;
  /** Desabilita interação (apenas exibe o pin). */
  readOnly?: boolean;
}

function CliqueParaMarcar({ onChange, readOnly }: { onChange: (lat: number, lng: number) => void; readOnly?: boolean }) {
  useMapEvents({
    click(e) {
      if (!readOnly) onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Recentraliza o mapa quando o pin muda por fora (ex.: "usar minha localização"). */
function Recentralizar({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  const ultimo = useRef<string>('');
  useEffect(() => {
    if (lat == null || lng == null) return;
    const chave = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (chave === ultimo.current) return;
    ultimo.current = chave;
    map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }, [lat, lng, map]);
  return null;
}

export default function MapaPin({
  lat,
  lng,
  onChange,
  defaultCenter = [-25.59, -48.35],
  altura = 'h-72',
  readOnly = false,
}: Props) {
  const center: [number, number] = (lat != null && lng != null) ? [lat, lng] : defaultCenter;
  const markerRef = useRef<L.Marker>(null);

  const eventHandlers = useMemo(() => ({
    dragend() {
      const m = markerRef.current;
      if (m) {
        const p = m.getLatLng();
        onChange(p.lat, p.lng);
      }
    },
  }), [onChange]);

  return (
    <div className={`w-full ${altura} rounded-xl overflow-hidden border border-zinc-200`}>
      <MapContainer
        center={center}
        zoom={lat != null ? 16 : 13}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CliqueParaMarcar onChange={onChange} readOnly={readOnly} />
        <Recentralizar lat={lat} lng={lng} />
        {lat != null && lng != null && (
          <Marker
            position={[lat, lng]}
            icon={pinIcon}
            draggable={!readOnly}
            eventHandlers={readOnly ? undefined : eventHandlers}
            ref={markerRef}
          />
        )}
      </MapContainer>
    </div>
  );
}
