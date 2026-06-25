import { useEffect } from 'react';
import { MapContainer, TileLayer, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface Props {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  /** Centro padrão quando ainda não há pin (lat, lng). Default: região Pontal do PR. */
  defaultCenter?: [number, number];
  /** Classe de altura do mapa (ex.: 'h-72'). */
  altura?: string;
  /** Desabilita interação (apenas exibe o pin no centro). */
  readOnly?: boolean;
}

/**
 * Pin FIXO no centro: o usuário move o mapa por baixo e, ao soltar (dragend) ou dar
 * zoom (zoomend), o pin assume a coordenada do CENTRO do mapa. É bem mais preciso do
 * que arrastar um marcador com o dedo. Usamos dragend/zoomend (ações do usuário) — e
 * não moveend — para NÃO disparar no posicionamento inicial/programático.
 */
function CentroComoPin({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  const map = useMapEvents({
    dragend() { const c = map.getCenter(); onChange(c.lat, c.lng); },
    zoomend() { const c = map.getCenter(); onChange(c.lat, c.lng); },
  });
  return null;
}

/**
 * Recentraliza quando a posição muda POR FORA (ex.: "usar minha localização" ou um
 * endereço salvo). Só recentraliza se o ponto novo está LONGE do centro atual — assim
 * não entra em laço com o onChange do próprio arraste (que devolve o centro atual).
 */
function Recentralizar({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat == null || lng == null) return;
    const c = map.getCenter();
    if (map.distance([lat, lng], [c.lat, c.lng]) < 8) return; // já é praticamente esse ponto
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

  return (
    // touchAction:'none' + overscrollBehavior:'contain' impedem que arrastar o mapa
    // dispare o "pull-to-refresh" do navegador no celular (o Leaflet trata o gesto).
    <div
      className={`relative w-full ${altura} rounded-xl overflow-hidden border border-zinc-200`}
      style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
    >
      <MapContainer
        center={center}
        zoom={lat != null ? 16 : 13}
        style={{ height: '100%', width: '100%', touchAction: 'none', overscrollBehavior: 'contain' }}
        scrollWheelZoom
        dragging={!readOnly}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {!readOnly && <CentroComoPin onChange={onChange} />}
        <Recentralizar lat={lat} lng={lng} />
      </MapContainer>

      {/* Pin FIXO no centro (overlay HTML, não bloqueia o mapa). A PONTA marca o centro. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-[1000]"
        style={{ transform: 'translate(-50%, -100%)' }}
      >
        <i
          className="ri-map-pin-fill text-orange-500"
          style={{ fontSize: 38, display: 'block', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.35))' }}
        />
      </div>
      {/* Ponto-base exato no centro (referência de precisão sob a ponta do pin) */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-1/2">
        <div className="w-1.5 h-1.5 rounded-full bg-orange-600/80 ring-2 ring-white/70" />
      </div>

      {!readOnly && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] bg-black/55 text-white text-[10px] font-medium px-2 py-1 rounded-full whitespace-nowrap">
          Arraste o mapa para posicionar o pin
        </div>
      )}
    </div>
  );
}
