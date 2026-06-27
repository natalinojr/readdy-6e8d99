import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMapEvents, useMap } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
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
  /**
   * O ponto já foi REGISTRADO pelo usuário? Quando `false`, o pin fica "fantasma"
   * (cinza) e aparece o botão "Confirmar esta localização" — assim o cliente nunca
   * acha que marcou só porque vê o pin desenhado no centro. Default `true` (retro-
   * compatível com a config da loja, onde o pin sempre já existe).
   */
  confirmed?: boolean;
}

/** Mantém uma referência viva à instância do mapa para ler o centro de fora (botão Confirmar). */
function GuardaMapa({ mapRef }: { mapRef: { current: LeafletMap | null } }) {
  const map = useMap();
  mapRef.current = map;
  return null;
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
  confirmed = true,
}: Props) {
  const center: [number, number] = (lat != null && lng != null) ? [lat, lng] : defaultCenter;
  const mapRef = useRef<LeafletMap | null>(null);

  // Pin "não confirmado": cinza/fantasma, pra não dar falsa sensação de já-marcado.
  const pinPendente = !readOnly && !confirmed;

  // Registra o CENTRO atual como pin (funciona mesmo quando a geolocalização é
  // bloqueada — caso comum na WebView do WhatsApp/Instagram, onde o `dragend` pode
  // nem acontecer se a casa já estiver no centro).
  function confirmarCentro() {
    const m = mapRef.current;
    if (!m) return;
    const c = m.getCenter();
    onChange(c.lat, c.lng);
  }

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
        <GuardaMapa mapRef={mapRef} />
      </MapContainer>

      {/* Pin FIXO no centro (overlay HTML, não bloqueia o mapa). A PONTA marca o centro.
          Enquanto não confirmado, fica cinza/translúcido pra não parecer já-marcado. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-[1000]"
        style={{ transform: 'translate(-50%, -100%)' }}
      >
        <i
          className={'ri-map-pin-fill ' + (pinPendente ? 'text-zinc-400/80' : 'text-orange-500')}
          style={{ fontSize: 38, display: 'block', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.35))' }}
        />
      </div>
      {/* Ponto-base exato no centro (referência de precisão sob a ponta do pin) */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-1/2">
        <div className={'w-1.5 h-1.5 rounded-full ring-2 ring-white/70 ' + (pinPendente ? 'bg-zinc-500/80' : 'bg-orange-600/80')} />
      </div>

      {/* Instrução no topo enquanto o ponto não foi confirmado */}
      {pinPendente && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-black/60 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
          Arraste o mapa até o ponto certo
        </div>
      )}

      {/* Embaixo: quando ainda não há ponto, o botão de confirmar o centro; quando já
          há ponto, uma dica neutra de que dá pra ajustar arrastando (sem um selo de
          "confirmado" permanente, que poluía a tela já que o GPS marca sozinho). */}
      {!readOnly && (
        pinPendente ? (
          <button
            type="button"
            onClick={confirmarCentro}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-check-line text-sm" />Confirmar esta localização
          </button>
        ) : (
          <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] inline-flex items-center gap-1 bg-black/55 text-white text-[10px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap">
            <i className="ri-drag-move-2-line text-xs" />Arraste o mapa para ajustar
          </div>
        )
      )}
    </div>
  );
}
