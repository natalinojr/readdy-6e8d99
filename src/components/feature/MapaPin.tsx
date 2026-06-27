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
  /**
   * Posição TRAVADA pelo cliente? Quando `true`, o mapa não arrasta (evita mudar o
   * ponto sem querer) e o botão vira "Editar posição". Quando `false`, o cliente pode
   * arrastar e aparece o botão "Salvar posição". Controlado de fora (lift state).
   */
  locked?: boolean;
  /** Alterna o travamento da posição (true = travar/salvar, false = destravar/editar). */
  onToggleLock?: (next: boolean) => void;
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
 * Liga/desliga a interação do mapa de forma REATIVA. As props do MapContainer
 * (`dragging`, `scrollWheelZoom`) só valem na montagem — então, pra travar de verdade
 * quando o cliente "salva a posição", precisamos chamar enable()/disable() nos handlers.
 */
function TravaInteracao({ interativo }: { interativo: boolean }) {
  const map = useMap();
  useEffect(() => {
    const handlers = [map.dragging, map.scrollWheelZoom, map.touchZoom, map.doubleClickZoom, map.boxZoom, map.keyboard];
    handlers.forEach((h) => { if (h) { if (interativo) h.enable(); else h.disable(); } });
  }, [interativo, map]);
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
  locked = false,
  onToggleLock,
}: Props) {
  const center: [number, number] = (lat != null && lng != null) ? [lat, lng] : defaultCenter;
  const mapRef = useRef<LeafletMap | null>(null);

  // Pin "não confirmado": cinza/fantasma, pra não dar falsa sensação de já-marcado.
  const pinPendente = !readOnly && !confirmed;
  // Mapa interativo (arrasta/segue o centro) só quando NÃO está travado pelo cliente.
  const interativo = !readOnly && !locked;

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
        scrollWheelZoom={interativo}
        dragging={interativo}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {interativo && <CentroComoPin onChange={onChange} />}
        <TravaInteracao interativo={interativo} />
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

      {/* Instrução no topo: sem ponto → arraste até o lugar; travado → selo "posição
          salva"; destravado → dica de que dá pra ajustar arrastando. */}
      {!readOnly && (
        pinPendente ? (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-black/60 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
            Arraste o mapa até o ponto certo
          </div>
        ) : locked ? (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-[1000] inline-flex items-center gap-1 bg-green-600/90 text-white text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
            <i className="ri-lock-line text-xs" />Posição salva
          </div>
        ) : (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-[1000] inline-flex items-center gap-1 bg-black/55 text-white text-[10px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap">
            <i className="ri-drag-move-2-line text-xs" />Arraste o mapa para ajustar
          </div>
        )
      )}

      {/* Embaixo: sem ponto → confirmar o centro. Com ponto: se o pai controla o
          travamento (onToggleLock), mostra "Salvar/Editar posição"; senão (ex.: config
          da loja) não há botão extra — o arraste já basta. */}
      {!readOnly && (
        pinPendente ? (
          <button
            type="button"
            onClick={confirmarCentro}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-check-line text-sm" />Confirmar esta localização
          </button>
        ) : onToggleLock ? (
          locked ? (
            <button
              type="button"
              onClick={function () { onToggleLock(false); }}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] inline-flex items-center gap-1.5 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-bold px-4 py-2 rounded-full shadow-lg border border-zinc-200 cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-pencil-line text-sm" />Editar posição
            </button>
          ) : (
            <button
              type="button"
              onClick={function () { onToggleLock(true); }}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-save-line text-sm" />Salvar posição
            </button>
          )
        ) : null
      )}
    </div>
  );
}
