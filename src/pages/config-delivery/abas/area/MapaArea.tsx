import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { FaixaEntrega } from '../../config';
import { brl } from '../../ui';
import { kmTxt, pontoNaBorda } from './calculos';

// Mapa da aba "Área e taxa": um círculo por faixa (em linha reta), a loja no centro, um ponto azul por pedido
// dos últimos 30 dias e o marcador do endereço que a pessoa tocou para testar.

// Mesmo mapa do pino da loja (MapaPin) quando ainda não há pino.
const CENTRO_PADRAO: [number, number] = [-25.59, -48.35];

const ICONE_LOJA = L.divIcon({
  className: '',
  html: '<div style="width:30px;height:30px;border-radius:50%;background:#1F1A14;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#F59E0B;font-size:16px"><i class="ri-store-2-fill"></i></div>',
  iconSize: [30, 30], iconAnchor: [15, 15],
});
const ICONE_TESTE = L.divIcon({
  className: '',
  html: '<i class="ri-map-pin-fill" style="display:block;font-size:34px;line-height:1;color:#7C3AED;filter:drop-shadow(0 2px 2px rgba(0,0,0,.4))"></i>',
  iconSize: [34, 34], iconAnchor: [17, 34],
});

function iconeRotulo(texto: string) {
  const seguro = texto.replace(/[&<>"']/g, '');
  return L.divIcon({
    className: '',
    html: `<span style="position:absolute;left:3px;top:-9px;white-space:nowrap;pointer-events:none;background:#fff;border:1px solid #EADBC3;color:#7C4A03;font-size:10px;font-weight:800;line-height:16px;padding:0 6px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.12)">${seguro}</span>`,
    iconSize: [0, 0], iconAnchor: [0, 0],
  });
}

/** Enquadra a loja e o raio pedido: só quando a chave muda (editar o km de uma faixa não dá zoom no meio da digitação). */
function Enquadrar({ centro, raioKm, chave }: { centro: [number, number] | null; raioKm: number; chave: string }) {
  const map = useMap();
  const raio = useRef(raioKm);
  raio.current = raioKm;
  const c = useRef(centro);
  c.current = centro;
  useEffect(() => {
    if (!c.current) return;
    map.fitBounds(L.latLng(c.current[0], c.current[1]).toBounds(raio.current * 2000), { animate: false, padding: [6, 6] });
  }, [chave, map]);
  return null;
}

/** Leaflet lê o tamanho uma vez; avisa quando a caixa muda (celular girou, coluna mudou). */
function AjustaTamanho() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function Toque({ onTestar }: { onTestar: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onTestar(e.latlng.lat, e.latlng.lng); } });
  return null;
}

export interface PontoMapa { lat: number; lng: number }

export default function MapaArea({ loja, faixas, pedidos, teste, raioKm, enquadre, onTestar, onMoverPino, altura = 'h-[300px] lg:h-[420px]', acaoExtra }: {
  loja: PontoMapa | null;
  /** Faixas válidas, da mais perto para a mais longe. */
  faixas: FaixaEntrega[];
  pedidos: PontoMapa[];
  teste: PontoMapa | null;
  /** Quantos km mostrar a partir da loja. */
  raioKm: number;
  /** Muda quando o mapa deve enquadrar de novo (de perto / tudo / pino novo). */
  enquadre: string;
  onTestar: (lat: number, lng: number) => void;
  onMoverPino: () => void;
  altura?: string;
  /** Botão extra sobre o mapa (ex.: "Ver até 10 km"). */
  acaoExtra?: ReactNode;
}) {
  const centro: [number, number] | null = loja ? [loja.lat, loja.lng] : null;
  // Do maior para o menor: o menor fica por cima.
  const circulos = useMemo(() => faixas.map((f, i) => ({ f, i })).reverse(), [faixas]);

  return (
    // isolate: os painéis do Leaflet têm z-index alto e, sem isso, cobririam a barra de salvar e as folhas.
    <div className={`relative isolate w-full ${altura} rounded-2xl overflow-hidden border border-zinc-200 bg-[#EAEDE3]`}>
      <MapContainer
        center={centro ?? CENTRO_PADRAO}
        zoom={centro ? 13 : 12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        // No celular, um dedo no mapa rolaria o mapa e não a página; fica dois dedos (zoom/mover) e toque (testar).
        dragging={!L.Browser.mobile}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <AjustaTamanho />
        <Enquadrar centro={centro} raioKm={raioKm} chave={enquadre} />
        <Toque onTestar={onTestar} />

        {loja && circulos.map(({ f, i }) => (
          <Circle
            key={`c${i}-${f.ate_km}`}
            center={[loja.lat, loja.lng]}
            radius={f.ate_km * 1000}
            interactive={false}
            pathOptions={{
              color: '#D98A0B', weight: 1.4, opacity: 0.95,
              fillColor: '#F59E0B', fillOpacity: i === 0 ? 0.16 : 0.05,
              dashArray: i < 2 ? undefined : '4 4',
            }}
          />
        ))}
        {loja && faixas.map((f, i) => (
          <Marker
            key={`r${i}-${f.ate_km}-${f.taxa}`}
            position={pontoNaBorda(loja.lat, loja.lng, f.ate_km * 1000, i % 2 === 0 ? 45 : 135)}
            icon={iconeRotulo(`${kmTxt(f.ate_km)} km · ${brl(f.taxa)}`)}
            interactive={false}
            keyboard={false}
          />
        ))}

        {pedidos.map((p, i) => (
          <CircleMarker
            key={`p${i}`}
            center={[p.lat, p.lng]}
            radius={4.5}
            interactive={false}
            pathOptions={{ color: '#FFFFFF', weight: 1.3, fillColor: '#2563EB', fillOpacity: 0.78 }}
          />
        ))}

        {loja && <Marker position={[loja.lat, loja.lng]} icon={ICONE_LOJA} interactive={false} keyboard={false} />}
        {teste && <Marker position={[teste.lat, teste.lng]} icon={ICONE_TESTE} interactive={false} keyboard={false} zIndexOffset={1000} />}
      </MapContainer>

      <div className="absolute top-2 right-2 z-[1000] flex flex-col items-end gap-1.5">
        <button type="button" onClick={onMoverPino} title="Mover o pino da loja" aria-label="Mover o pino da loja"
          className="w-9 h-9 rounded-xl bg-white border border-zinc-200 shadow text-zinc-700 hover:bg-zinc-50 flex items-center justify-center cursor-pointer">
          <i className="ri-map-pin-2-line text-lg" />
        </button>
        {acaoExtra}
      </div>
    </div>
  );
}
