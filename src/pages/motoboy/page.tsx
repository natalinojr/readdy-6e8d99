import { useEffect, useState, useCallback } from 'react';

function edgeUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/motoboy-signal';
}

function getOrderIdFromUrl(): string {
  const m = window.location.pathname.match(/\/motoboy\/([^/]+)/);
  return m ? m[1] : '';
}

// Sessao do motoboy (login simples por loja), compartilhada com a lista /entregas.
export const MOTOBOY_SESSION_KEY = 'erpos_motoboy_session';
export interface MotoboySession { tenant_id: string; driver_id: string; name: string; store_slug?: string; store_name?: string; }
export function getMotoboySession(): MotoboySession | null {
  try {
    const raw = localStorage.getItem(MOTOBOY_SESSION_KEY);
    return raw ? (JSON.parse(raw) as MotoboySession) : null;
  } catch { return null; }
}

// Fluxo sequencial dos sinais do motoboy. A partir do status atual, qual o proximo.
function proximoBotao(status: string | null) {
  switch (status) {
    case null:
    case '':
    case 'problema':
      return { signal: 'a_caminho_loja', label: 'Estou a caminho da loja', icon: 'ri-store-2-line', cor: 'bg-zinc-700 hover:bg-zinc-800' };
    case 'a_caminho_loja':
      return { signal: 'coletou', label: 'Coletei o pedido', icon: 'ri-shopping-bag-3-line', cor: 'bg-amber-500 hover:bg-amber-600' };
    case 'coletou':
      return { signal: 'entregou', label: 'Entreguei ao cliente', icon: 'ri-checkbox-circle-line', cor: 'bg-green-600 hover:bg-green-700' };
    default:
      return null;
  }
}

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface OrderData {
  number: string;
  cliente: string;
  endereco: string;
  lat: number | null;
  lng: number | null;
  total: number;
  taxa: number;
  pagamento: string;
  status: string;
  motoboy_status: string | null;
  itens: { nome: string; qtd: number }[];
}

const SINAL_LABEL: Record<string, string> = {
  a_caminho_loja: 'A caminho da loja',
  coletou: 'Pedido coletado',
  entregou: 'Entregue ao cliente',
  problema: 'Problema reportado',
};

export default function MotoboyPage() {
  const orderId = getOrderIdFromUrl();
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState('');
  const [showProblema, setShowProblema] = useState(false);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async () => {
    if (!orderId) { setErro('Link inválido.'); setLoading(false); return; }
    try {
      const res = await fetch(edgeUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_order', order_id: orderId }),
      });
      const data = await res.json();
      if (data.error || !data.order) {
        setErro(data.error === 'not_found' ? 'Pedido não encontrado.' : 'Não foi possível carregar o pedido.');
      } else {
        setOrder(data.order);
      }
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { carregar(); }, [carregar]);

  const sinalizar = async (signal: string, motivoTxt?: string) => {
    setEnviando(signal);
    try {
      const res = await fetch(edgeUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signal', order_id: orderId, signal, motivo: motivoTxt, driver_id: getMotoboySession()?.driver_id }),
      });
      const data = await res.json();
      if (data.ok) {
        setOrder((o) => (o ? { ...o, motoboy_status: signal } : o));
        setShowProblema(false);
        setMotivo('');
      }
    } catch { /* ignora */ } finally {
      setEnviando('');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (erro || !order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 px-6 text-center">
        <i className="ri-error-warning-line text-4xl text-zinc-300 mb-3" />
        <p className="text-sm font-semibold text-zinc-600">{erro || 'Pedido indisponível'}</p>
      </div>
    );
  }

  // Prioriza o pin (lat/lng) do cliente; o endereço em texto é só fallback (geocoding pode errar).
  const mapsUrl =
    order.lat != null && order.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${order.lat}%2C${order.lng}`
      : order.endereco
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.endereco)}`
      : '';
  const entregue = order.motoboy_status === 'entregou';
  // Só o botão da próxima fase aparece (a_caminho → coletei → entreguei).
  const proximo = proximoBotao(order.motoboy_status);

  const Botao = ({ signal, label, icon, cor }: { signal: string; label: string; icon: string; cor: string }) => (
    <button
      type="button"
      disabled={!!enviando || entregue}
      onClick={() => sinalizar(signal)}
      className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-bold text-sm transition-colors disabled:opacity-50 ${cor}`}
    >
      <i className={icon + ' text-lg'} />
      {enviando === signal ? 'Enviando…' : label}
    </button>
  );

  return (
    <div className="min-h-screen bg-zinc-50 flex justify-center">
      <div className="w-full max-w-md px-4 py-5 space-y-4">
        {/* Voltar à lista (quando o motoboy entrou pela lista da loja) */}
        {getMotoboySession()?.store_slug ? (
          <a href={`/entregas/${getMotoboySession()?.store_slug}`} className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500">
            <i className="ri-arrow-left-line" /> Voltar aos pedidos
          </a>
        ) : null}
        {/* Cabeçalho */}
        <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-2xl p-4 text-white">
          <div className="flex items-center gap-2 mb-1">
            <i className="ri-e-bike-2-line" />
            <span className="text-xs font-semibold opacity-70">Entrega — Pedido</span>
          </div>
          <h1 className="text-2xl font-black">#{String(order.number).replace(/\D/g, '').slice(-4) || order.number}</h1>
          {order.motoboy_status ? (
            <span className="inline-block mt-2 px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-bold">
              {SINAL_LABEL[order.motoboy_status] ?? order.motoboy_status}
            </span>
          ) : null}
        </div>

        {/* Dados */}
        <div className="bg-white rounded-2xl border border-zinc-100 p-4 space-y-3">
          <div>
            <p className="text-[11px] text-zinc-400 font-semibold uppercase">Cliente</p>
            <p className="text-sm font-bold text-zinc-800">{order.cliente}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 font-semibold uppercase">Endereço</p>
            <p className="text-sm text-zinc-700">{order.endereco || '—'}</p>
            {mapsUrl ? (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-xs font-bold text-blue-600">
                <i className="ri-map-pin-line" /> Abrir no mapa
              </a>
            ) : null}
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-[11px] text-zinc-400 font-semibold uppercase">Cobrar do cliente</p>
              <p className="text-lg font-black text-zinc-800">{fmt(order.total)}</p>
            </div>
            {order.taxa > 0 ? (
              <div>
                <p className="text-[11px] text-zinc-400 font-semibold uppercase">Taxa</p>
                <p className="text-lg font-black text-zinc-800">{fmt(order.taxa)}</p>
              </div>
            ) : null}
          </div>
          {order.pagamento ? (
            <div>
              <p className="text-[11px] text-zinc-400 font-semibold uppercase">Pagamento / obs</p>
              <p className="text-xs text-zinc-600 whitespace-pre-wrap">{order.pagamento}</p>
            </div>
          ) : null}
        </div>

        {/* Itens */}
        <div className="bg-white rounded-2xl border border-zinc-100 p-4">
          <p className="text-[11px] text-zinc-400 font-semibold uppercase mb-2">Itens</p>
          <div className="space-y-1">
            {order.itens.map((it, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-zinc-700">
                <span className="font-bold text-zinc-900 w-7">{it.qtd}x</span>
                <span>{it.nome}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Ações */}
        {entregue ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
            <i className="ri-checkbox-circle-fill text-3xl text-green-500" />
            <p className="text-sm font-bold text-green-700 mt-1">Entrega concluída. Obrigado!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {proximo ? (
              <Botao signal={proximo.signal} label={proximo.label} icon={proximo.icon} cor={proximo.cor} />
            ) : null}

            {showProblema ? (
              <div className="bg-white rounded-2xl border border-red-200 p-3 space-y-2">
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  placeholder="Descreva o problema (ex.: cliente ausente, endereço não encontrado…)"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 focus:border-red-400 outline-none text-sm resize-none"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowProblema(false); setMotivo(''); }} className="flex-1 py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-semibold">Cancelar</button>
                  <button
                    type="button"
                    disabled={!motivo.trim() || enviando === 'problema'}
                    onClick={() => sinalizar('problema', motivo.trim())}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-50"
                  >
                    {enviando === 'problema' ? 'Enviando…' : 'Enviar problema'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setShowProblema(true)} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-red-200 text-red-600 font-bold text-sm">
                <i className="ri-alert-line text-lg" /> Tive um problema na entrega
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
