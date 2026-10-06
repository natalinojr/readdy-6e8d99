import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  acumulado, distM, iconeManobra, orientar, projetar, textoDistancia,
  type LatLng, type PernaRota,
} from '@/lib/navegacaoRota';

function edgeUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/motoboy-signal';
}

interface Parada {
  id: string; number: string; cliente: string; endereco: string;
  lat: number; lng: number; motoboy_status: string | null; em_rota: boolean;
}
interface Rota { paradas: Parada[]; linha: LatLng[]; pernas: PernaRota[]; cum: number[] }
interface Pos { lat: number; lng: number; acc: number | null; heading: number | null }

// Recalcular só quando ele realmente saiu do caminho (o ORS grátis tem limite diário).
const FORA_M = 50;
const LEITURAS_FORA = 2;
const RECALC_MIN_MS = 20000;
const CHEGOU_M = 60;

const ERROS: Record<string, string> = {
  sem_pin: 'Este pedido não tem a casa marcada no mapa. Use o endereço ou o Google Maps.',
  encerrado: 'Este pedido já foi encerrado.',
  driver_invalido: 'Seu acesso a esta loja não está liberado.',
  sem_rota: 'Não deu para calcular a rota agora. Tentando de novo…',
};

const numCurto = (n: string) => String(n).replace(/\D/g, '').slice(-4) || n;
const horaDaqui = (s: number) => new Date(Date.now() + s * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function iconeParada(n: number, atual: boolean) {
  const cor = atual ? '#f59e0b' : '#71717a';
  return L.divIcon({
    className: '',
    html: `<div style="background:${cor};color:#fff;width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid #fff"><span style="transform:rotate(45deg);font-size:13px;font-weight:800">${n}</span></div>`,
    iconSize: [32, 32], iconAnchor: [16, 32],
  });
}

function iconeEu(heading: number | null) {
  const seta = heading != null && Number.isFinite(heading)
    ? `<div style="position:absolute;left:50%;top:-9px;margin-left:-7px;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:11px solid #2563eb;transform-origin:7px 20px;transform:rotate(${heading}deg)"></div>`
    : '';
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:22px;height:22px">${seta}<div style="width:22px;height:22px;border-radius:50%;background:#2563eb;border:4px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.35),0 2px 6px rgba(0,0,0,.4)"></div></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

/** Câmera acompanha o motoboy enquanto `seguir`; arrastar o mapa desliga (botão "Centralizar" volta). */
function Camera({ pos, seguir, onSoltar }: { pos: Pos | null; seguir: boolean; onSoltar: () => void }) {
  const map = useMap();
  useMapEvents({ dragstart: onSoltar });
  useEffect(() => {
    if (!seguir || !pos) return;
    map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 17), { animate: true });
  }, [pos, seguir, map]);
  return null;
}

/**
 * Navegação dentro do app do motoboy: linha da rota, próxima manobra, quanto falta, recálculo
 * ao sair do caminho e os botões da entrega — sem precisar ir para o Google Maps.
 * Com saída montada no Gestor, segue para a próxima parada depois de "Entreguei".
 */
export default function NavegacaoMotoboy({
  orderId, driverId, onFechar, onMudou,
}: {
  orderId: string;
  driverId: string;
  onFechar: () => void;
  /** Algum pedido mudou de fase aqui dentro (a página recarrega o dela). */
  onMudou: () => void;
}) {
  const [alvoId, setAlvoId] = useState(orderId);
  const [pos, setPos] = useState<Pos | null>(null);
  const [gpsErro, setGpsErro] = useState('');
  const [rota, setRota] = useState<Rota | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [erro, setErro] = useState('');
  const [erroFinal, setErroFinal] = useState(false);
  const [seguir, setSeguir] = useState(true);
  const [enviando, setEnviando] = useState('');
  const [aviso, setAviso] = useState('');
  const [showProblema, setShowProblema] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [concluido, setConcluido] = useState(false);

  const idxRef = useRef(0);
  const foraRef = useRef(0);
  const ultimoCalcRef = useRef(0);
  const calcRef = useRef(false);

  // GPS próprio da navegação (leitura frequente; quem manda a posição para a loja é o useMotoboyGps da página).
  useEffect(() => {
    if (!('geolocation' in navigator)) { setGpsErro('Este celular não tem GPS disponível.'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGpsErro('');
        const c = p.coords;
        setPos({ lat: c.latitude, lng: c.longitude, acc: c.accuracy ?? null, heading: c.heading ?? null });
      },
      (e) => setGpsErro(e.code === e.PERMISSION_DENIED
        ? 'Localização bloqueada. Libere a localização para o ERPOS nas configurações do celular.'
        : 'Procurando o sinal do GPS…'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    // Tela acesa enquanto navega
    type Sentinela = { release: () => Promise<void> };
    let lock: Sentinela | null = null;
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Sentinela> } }).wakeLock;
    const pedir = () => { if (wl && document.visibilityState === 'visible') wl.request('screen').then((l) => { lock = l; }).catch(() => {}); };
    pedir();
    document.addEventListener('visibilitychange', pedir);
    return () => {
      navigator.geolocation.clearWatch(id);
      document.removeEventListener('visibilitychange', pedir);
      lock?.release().catch(() => {});
    };
  }, []);

  const calcular = useCallback(async (p: Pos, alvo: string) => {
    if (calcRef.current) return;
    calcRef.current = true;
    ultimoCalcRef.current = Date.now();
    setCalculando(true);
    try {
      const res = await fetch(edgeUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'navegar', order_id: alvo, driver_id: driverId, lat: p.lat, lng: p.lng }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.linha) && data.linha.length >= 2) {
        idxRef.current = 0;
        foraRef.current = 0;
        setRota({ paradas: data.paradas, linha: data.linha, pernas: data.pernas, cum: acumulado(data.linha) });
        setErro(''); setErroFinal(false);
      } else {
        const code = String(data.error ?? 'sem_rota');
        setErro(ERROS[code] ?? ERROS.sem_rota);
        setErroFinal(code !== 'sem_rota');
      }
    } catch {
      setErro('Sem internet. Tentando de novo…');
    } finally {
      calcRef.current = false;
      setCalculando(false);
    }
  }, [driverId]);

  // Primeira rota, nova parada e erros passageiros (sem internet / ORS) → calcula de novo.
  useEffect(() => {
    if (!pos || rota || erroFinal || concluido) return;
    if (Date.now() - ultimoCalcRef.current < (erro ? RECALC_MIN_MS : 0)) return;
    void calcular(pos, alvoId);
  }, [pos, rota, erro, erroFinal, concluido, alvoId, calcular]);

  // Onde ele está na linha + saiu do caminho?
  const proj = useMemo(() => {
    if (!rota || !pos) return null;
    return projetar(rota.linha, rota.cum, [pos.lat, pos.lng], idxRef.current);
  }, [rota, pos]);

  useEffect(() => {
    if (!proj || !pos) return;
    idxRef.current = proj.idx;
    const limite = Math.max(FORA_M, Math.min(pos.acc ?? 0, 100));
    if (proj.fora > limite) foraRef.current += 1; else foraRef.current = 0;
    if (foraRef.current >= LEITURAS_FORA && Date.now() - ultimoCalcRef.current >= RECALC_MIN_MS) {
      foraRef.current = 0;
      void calcular(pos, alvoId);
    }
  }, [proj, pos, alvoId, calcular]);

  const parada = rota?.paradas[0] ?? null;
  const orient = rota && proj && rota.pernas[0] ? orientar(rota.pernas[0], rota.cum, proj) : null;
  const chegou = !!parada && !!pos && distM([pos.lat, pos.lng], [parada.lat, parada.lng]) <= CHEGOU_M;
  const podeEntregar = !!parada && (parada.em_rota || parada.motoboy_status === 'coletou');
  const depois = rota ? rota.paradas.length - 1 : 0;

  const sinalizar = async (signal: 'entregou' | 'problema', motivoTxt?: string) => {
    if (!parada) return;
    setEnviando(signal); setAviso('');
    try {
      const res = await fetch(edgeUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signal', order_id: parada.id, signal, motivo: motivoTxt, driver_id: driverId }),
      });
      const data = await res.json();
      if (!data.ok) {
        setAviso(data.error === 'assumido_por_outro' ? 'Este pedido está com outro entregador.'
          : data.error === 'com_ifood' ? 'Este pedido vai com um entregador do iFood.'
          : 'Não foi possível enviar. Tente de novo.');
        return;
      }
      onMudou();
      if (signal === 'problema') { setShowProblema(false); setMotivo(''); setAviso('Problema enviado para a loja.'); return; }
      // Entregue: segue para a próxima parada da saída (se houver)
      const prox = rota!.paradas[1];
      setRota(null); setErro(''); setErroFinal(false);
      if (prox) { setAlvoId(prox.id); ultimoCalcRef.current = 0; } else setConcluido(true);
    } catch {
      setAviso('Sem internet. Tente de novo.');
    } finally {
      setEnviando('');
    }
  };

  const googleUrl = parada
    ? `https://www.google.com/maps/dir/?api=1&destination=${parada.lat},${parada.lng}&travelmode=driving`
    : '';
  const centro: LatLng = pos ? [pos.lat, pos.lng] : parada ? [parada.lat, parada.lng] : [-25.52, -48.51];
  const iconeEuMemo = useMemo(() => iconeEu(pos?.heading ?? null), [pos?.heading]);

  return (
    <div data-no-pull className="fixed inset-0 z-[95] bg-zinc-100 flex flex-col">
      {/* Próxima manobra */}
      <div className="bg-zinc-900 text-white px-4 pt-3 pb-3 flex items-start gap-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        {concluido ? (
          <div className="flex-1 min-w-0">
            <p className="text-lg font-black">Entregas da rota concluídas</p>
            <p className="text-xs opacity-70">Volte para a lista para ver os próximos pedidos.</p>
          </div>
        ) : orient ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
              <i className={iconeManobra(orient.tipo) + ' text-4xl'} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-2xl font-black leading-tight">{textoDistancia(orient.emM)}</p>
              <p className="text-sm font-semibold leading-snug">{orient.tipo === 10 ? `Chegada — ${parada?.cliente ?? ''}` : orient.texto}</p>
            </div>
          </>
        ) : (
          <div className="flex-1 min-w-0 py-1">
            <p className="text-sm font-bold">
              {gpsErro || erro || (calculando || !pos ? (pos ? 'Calculando a rota…' : 'Procurando o sinal do GPS…') : 'Calculando a rota…')}
            </p>
          </div>
        )}
        <button type="button" onClick={onFechar} aria-label="Fechar o mapa"
          className="w-10 h-10 shrink-0 rounded-xl bg-white/10 flex items-center justify-center">
          <i className="ri-close-line text-xl" />
        </button>
      </div>

      {/* Mapa */}
      <div className="flex-1 relative">
        <MapContainer center={centro} zoom={16} zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Camera pos={pos} seguir={seguir} onSoltar={() => setSeguir(false)} />
          {rota ? <Polyline positions={rota.linha} pathOptions={{ color: '#2563eb', weight: 7, opacity: 0.85 }} /> : null}
          {(rota?.paradas ?? []).map((p, i) => (
            <Marker key={p.id} position={[p.lat, p.lng]} icon={iconeParada(i + 1, i === 0)} />
          ))}
          {pos ? <Marker position={[pos.lat, pos.lng]} icon={iconeEuMemo} zIndexOffset={1000} /> : null}
        </MapContainer>
        {!seguir && pos ? (
          <button type="button" onClick={() => setSeguir(true)}
            className="absolute z-[500] right-3 bottom-3 px-3 py-2 rounded-full bg-white shadow-lg text-sm font-bold text-blue-600 flex items-center gap-1">
            <i className="ri-focus-3-line" /> Centralizar
          </button>
        ) : null}
        {calculando && rota ? (
          <div className="absolute z-[500] left-1/2 -translate-x-1/2 top-3 px-3 py-1.5 rounded-full bg-white shadow text-xs font-bold text-zinc-600">
            Recalculando a rota…
          </div>
        ) : null}
      </div>

      {/* Parada atual + botões */}
      <div className="bg-white border-t border-zinc-200 px-4 pt-3 space-y-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {parada && !concluido ? (
          <>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-zinc-800 truncate">#{numCurto(parada.number)} · {parada.cliente}</p>
                <p className="text-xs text-zinc-500 truncate">{parada.endereco || '—'}</p>
              </div>
              {orient ? (
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-zinc-800">{textoDistancia(orient.faltaM)}</p>
                  <p className="text-[11px] text-zinc-500">~{Math.max(1, Math.round(orient.faltaS / 60))} min · {horaDaqui(orient.faltaS)}</p>
                </div>
              ) : null}
            </div>
            {depois > 0 ? (
              <p className="text-[11px] font-semibold text-zinc-500">
                Depois: {depois} {depois === 1 ? 'entrega' : 'entregas'} — {rota!.paradas.slice(1).map((p) => '#' + numCurto(p.number)).join(', ')}
              </p>
            ) : null}
            {chegou ? (
              <p className="text-xs font-bold text-emerald-700 bg-emerald-50 rounded-xl px-3 py-1.5">Você chegou ao endereço.</p>
            ) : null}
          </>
        ) : null}
        {aviso ? <p className="text-xs font-bold text-red-600">{aviso}</p> : null}

        <div className="flex gap-2">
          {concluido ? (
            <button type="button" onClick={onFechar} className="flex-1 py-3 rounded-2xl bg-zinc-800 text-white font-bold text-sm">Fechar o mapa</button>
          ) : (
            <>
              {podeEntregar ? (
                <button type="button" disabled={!!enviando} onClick={() => sinalizar('entregou')}
                  className={'flex-1 py-3 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-50 ' + (chegou ? 'bg-green-600 ring-4 ring-green-200' : 'bg-green-600')}>
                  <i className="ri-checkbox-circle-line text-lg" /> {enviando === 'entregou' ? 'Enviando…' : 'Entreguei'}
                </button>
              ) : null}
              {parada ? (
                <button type="button" onClick={() => setShowProblema(true)}
                  className={(podeEntregar ? 'px-4' : 'flex-1') + ' py-3 rounded-2xl border-2 border-red-200 text-red-600 font-bold text-sm flex items-center justify-center gap-1.5'}>
                  <i className="ri-alert-line text-lg" /> Problema
                </button>
              ) : null}
            </>
          )}
        </div>
        {googleUrl && !concluido ? (
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="block text-center text-[11px] font-bold text-blue-600 py-1">
            Prefere o Google Maps? Abrir lá
          </a>
        ) : null}
      </div>

      {showProblema ? (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-start justify-center p-4" onClick={() => { setShowProblema(false); setMotivo(''); }}>
          <div className="bg-white rounded-2xl w-full max-w-md p-4 space-y-3 mt-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-zinc-800">Problema na entrega #{parada ? numCurto(parada.number) : ''}</p>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} autoFocus
              placeholder="Ex.: cliente ausente, endereço não encontrado…"
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 focus:border-red-400 outline-none text-sm resize-none" />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowProblema(false); setMotivo(''); }}
                className="flex-1 py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-semibold">Cancelar</button>
              <button type="button" disabled={!motivo.trim() || enviando === 'problema'} onClick={() => sinalizar('problema', motivo.trim())}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-50">
                {enviando === 'problema' ? 'Enviando…' : 'Enviar problema'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
