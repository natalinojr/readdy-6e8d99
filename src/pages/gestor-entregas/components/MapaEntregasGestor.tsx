import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface PontoGestor {
  id: string;
  number: string;
  cliente: string;
  endereco: string;
  lat: number | null;
  lng: number | null;
  atrasado: boolean;
  motoboy_status: string | null;
  driver_nome: string | null;
}

const SINAL_LABEL: Record<string, string> = {
  a_caminho_loja: 'A caminho da loja', coletou: 'Coletado', entregou: 'Entregue', problema: 'Problema',
};

// Cor do pin: vermelho=atrasado, violeta=em rota (coletou), verde=entregue, azul=demais.
function corDe(grupo: PontoGestor[]): string {
  if (grupo.some((p) => p.atrasado)) return '#ef4444';
  if (grupo.some((p) => p.motoboy_status === 'coletou')) return '#7c3aed';
  if (grupo.every((p) => p.motoboy_status === 'entregou')) return '#10b981';
  return '#3b82f6';
}

function makeIcon(grupo: PontoGestor[]) {
  const cor = corDe(grupo);
  if (grupo.length > 1) {
    return L.divIcon({
      className: '',
      html: `<div style="background:${cor};color:#fff;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);font-weight:800;font-size:14px">${grupo.length}</div>`,
      iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18],
    });
  }
  const num = String(grupo[0].number).replace(/\D/g, '').slice(-4) || grupo[0].number;
  return L.divIcon({
    className: '',
    html: `<div style="background:${cor};color:#fff;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid #fff">
             <span style="transform:rotate(45deg);font-size:10px;font-weight:800">${num}</span>
           </div>`,
    iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28],
  });
}

// Enquadra todos os pontos só na 1ª vez (refresh de dados não mexe na câmera).
function AjustarBounds({ pontos }: { pontos: PontoGestor[] }) {
  const map = useMap();
  const jaEnquadrou = useRef(false);
  useEffect(() => {
    if (jaEnquadrou.current) return;
    const coords = pontos.filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat as number, p.lng as number] as [number, number]);
    if (coords.length === 0) return;
    jaEnquadrou.current = true;
    if (coords.length === 1) { map.setView(coords[0], 16); return; }
    map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
  }, [pontos, map]);
  return null;
}

export default function MapaEntregasGestor({ pontos, onClose }: { pontos: PontoGestor[]; onClose: () => void }) {
  const comPin = pontos.filter((p) => p.lat != null && p.lng != null);
  const semPin = pontos.length - comPin.length;

  const grupos = useMemo(() => {
    const m = new Map<string, PontoGestor[]>();
    for (const p of comPin) {
      const key = `${(p.lat as number).toFixed(5)},${(p.lng as number).toFixed(5)}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    return [...m.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comPin.map((p) => `${p.lat},${p.lng}:${p.id}:${p.motoboy_status}:${p.atrasado}`).join('|')]);

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
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 text-xs font-bold hover:bg-zinc-200">
          <i className="ri-close-line" /> Fechar
        </button>
      </div>
      <div className="flex-1">
        {comPin.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <i className="ri-map-pin-line text-4xl text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-500 mt-2">Nenhuma entrega com localização no mapa.</p>
            <p className="text-xs text-zinc-400 mt-1">Só aparecem pedidos com o ponto de entrega registrado.</p>
          </div>
        ) : (
          <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <AjustarBounds pontos={comPin} />
            {grupos.map((grupo) => {
              const p0 = grupo[0];
              const lat = p0.lat as number, lng = p0.lng as number;
              return (
                <Marker key={p0.id + ':' + grupo.length} position={[lat, lng]} icon={makeIcon(grupo)}>
                  <Popup minWidth={210}>
                    <div>
                      {grupo.length > 1 ? <div style={{ fontWeight: 800, marginBottom: 6 }}>{grupo.length} pedidos neste endereço</div> : null}
                      {grupo.map((p) => {
                        const num = String(p.number).replace(/\D/g, '').slice(-4) || p.number;
                        return (
                          <div key={p.id} style={{ borderTop: grupo.length > 1 ? '1px solid #eee' : 'none', paddingTop: grupo.length > 1 ? 6 : 0, marginTop: grupo.length > 1 ? 6 : 0 }}>
                            <div style={{ fontWeight: 800 }}>#{num} — {p.cliente}</div>
                            {grupo.length === 1 ? <div style={{ fontSize: 12, color: '#555', margin: '2px 0' }}>{p.endereco || '—'}</div> : null}
                            {p.motoboy_status ? (
                              <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700 }}>
                                {SINAL_LABEL[p.motoboy_status] ?? p.motoboy_status}{p.driver_nome ? ` · ${p.driver_nome.split(' ')[0]}` : ''}
                              </div>
                            ) : null}
                            {p.atrasado ? <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 800 }}>Em atraso</div> : null}
                            <div style={{ marginTop: 4 }}>
                              <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, color: '#2563eb' }}>Rota no Google Maps</a>
                            </div>
                          </div>
                        );
                      })}
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
