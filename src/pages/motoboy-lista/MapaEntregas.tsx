import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface PontoEntrega {
  id: string;
  number: string;
  cliente: string;
  endereco: string;
  lat: number | null;
  lng: number | null;
  meu: boolean;
  atrasado: boolean;
}

// Pin colorido com o nº do pedido. Vermelho = atrasado, âmbar = seu pedido, azul = demais.
function pinIcon(label: string, cor: string) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${cor};color:#fff;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid #fff">
             <span style="transform:rotate(45deg);font-size:10px;font-weight:800">${label}</span>
           </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

// Ajusta o zoom pra caber todos os pontos quando a lista muda.
function AjustarBounds({ pontos }: { pontos: PontoEntrega[] }) {
  const map = useMap();
  const chave = pontos.map((p) => `${p.lat},${p.lng}`).join('|');
  useEffect(() => {
    const coords = pontos.filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat as number, p.lng as number] as [number, number]);
    if (coords.length === 0) return;
    if (coords.length === 1) { map.setView(coords[0], 16); return; }
    map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return null;
}

export default function MapaEntregas({ pontos, onClose }: { pontos: PontoEntrega[]; onClose: () => void }) {
  const comPin = pontos.filter((p) => p.lat != null && p.lng != null);
  const semPin = pontos.length - comPin.length;
  const center: [number, number] = comPin.length > 0 ? [comPin[0].lat as number, comPin[0].lng as number] : [-25.59, -48.35];

  return (
    <div className="fixed inset-0 z-[95] bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
        <div>
          <h2 className="text-sm font-black text-zinc-800">Mapa das entregas</h2>
          <p className="text-[11px] text-zinc-400">
            {comPin.length} no mapa{semPin > 0 ? ` · ${semPin} sem localização` : ''}
          </p>
        </div>
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 text-xs font-bold">
          <i className="ri-close-line" /> Fechar
        </button>
      </div>
      <div className="flex-1">
        {comPin.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <i className="ri-map-pin-line text-4xl text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-500 mt-2">Nenhuma entrega com localização no mapa.</p>
          </div>
        ) : (
          <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <AjustarBounds pontos={comPin} />
            {comPin.map((p) => {
              const cor = p.atrasado ? '#ef4444' : p.meu ? '#f59e0b' : '#3b82f6';
              const num = String(p.number).replace(/\D/g, '').slice(-4) || p.number;
              return (
                <Marker key={p.id} position={[p.lat as number, p.lng as number]} icon={pinIcon(num, cor)}>
                  <Popup>
                    <div style={{ minWidth: 160 }}>
                      <div style={{ fontWeight: 800 }}>#{num} — {p.cliente}</div>
                      <div style={{ fontSize: 12, color: '#555', margin: '2px 0 6px' }}>{p.endereco || '—'}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <a href={`/motoboy/${p.id}`} style={{ fontWeight: 700, color: '#d97706' }}>Abrir pedido</a>
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, color: '#2563eb' }}>Rota</a>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        )}
      </div>
    </div>
  );
}
