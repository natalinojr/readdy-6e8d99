import { useMemo, useState } from 'react';
import type { EntregaPedido } from '../hooks/useGestorEntregas';
import { useDriverPositions } from '@/hooks/useDriverPositions';
import { linkMaps, montarSaidas, simular, type MotoboyLivre, type PedidoSaida, type SugestaoSaida } from '@/lib/montarSaida';
import { horaCurta } from '../utils';

// GPS mais velho que isso não conta como "livre e perto" (tela fechada ou sem sinal).
const GPS_FRESCO_MS = 10 * 60000;

interface Props {
  tenantId: string | undefined;
  orders: EntregaPedido[];
  loja: { lat: number; lng: number } | null;
  motoboys: { id: string; name: string }[];
  onConfirmar: (p: {
    pedidos: string[]; driver_id: string; km: number; min: number; maps_url: string;
    sugerido: { driver_id: string | null; pedidos: string[]; km: number; min: number };
  }) => Promise<{ ok: boolean; erro?: string; motoboy?: string }>;
  onFechar: () => void;
}

const numCurto = (n: string) => `#${String(n).replace(/\D/g, '').slice(-4) || n}`;

/** "Montar saída" (Fase 3): sugere juntar pedidos prontos perto, a ordem e o motoboy. Nada acontece sem confirmar. */
export default function MontarSaidaModal({ tenantId, orders, loja, motoboys, onConfirmar, onFechar }: Props) {
  const { posicoes } = useDriverPositions(tenantId, true);
  const [versao, setVersao] = useState(0); // "Sugerir de novo"
  // Confirmadas nesta janela (o quadro recarrega e os pedidos saem da sugestão — a confirmação fica visível aqui)
  const [feitas, setFeitas] = useState<string[]>([]);

  const prontos = useMemo(() => orders.filter((o) => o.status === 'ready' && !o.driver_id && !o.motoboy_status), [orders]);
  const semLocal = prontos.filter((o) => o.lat == null || o.lng == null);

  const sugestoes: SugestaoSaida[] = useMemo(() => {
    const agora = Date.now();
    const pedidos: PedidoSaida[] = prontos.filter((o) => o.lat != null && o.lng != null).map((o) => ({
      id: o.id, number: o.number, cliente: o.cliente, lat: o.lat!, lng: o.lng!, created_at: o.created_at, sla_min: o.delivery_sla_min,
    }));
    const ocupados = new Set(orders.filter((o) => o.driver_id && o.status !== 'delivered' && o.motoboy_status !== 'entregou').map((o) => o.driver_id!));
    const ativos = new Set(motoboys.map((m) => m.id));
    const livres: MotoboyLivre[] = posicoes
      .filter((p) => ativos.has(p.driver_id) && !ocupados.has(p.driver_id) && agora - new Date(p.recorded_at).getTime() <= GPS_FRESCO_MS)
      .map((p) => ({ driver_id: p.driver_id, nome: p.nome, lat: p.lat, lng: p.lng }));
    return montarSaidas(pedidos, livres, loja, agora);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prontos, orders, motoboys, posicoes, loja, versao]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3 sm:p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-zinc-100">
          <div className="w-8 h-8 flex items-center justify-center bg-violet-100 rounded-lg shrink-0">
            <i className="ri-route-line text-violet-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold text-zinc-800">Montar saída</h4>
            <p className="text-[11px] text-zinc-500">Sugestão do sistema — nada muda até você confirmar.</p>
          </div>
          <button type="button" onClick={() => setVersao((v) => v + 1)} title="Sugerir de novo (com as posições atuais)"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"><i className="ri-refresh-line" /></button>
          <button type="button" onClick={onFechar} aria-label="Fechar"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"><i className="ri-close-line text-lg" /></button>
        </div>

        <div className="overflow-y-auto p-3 sm:p-4 space-y-3">
          {!loja && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              A loja não tem o pin no mapa (Config. do Delivery): a rota começa na 1ª parada e o motoboy sugerido é o mais perto dela.
            </p>
          )}
          {feitas.map((f, i) => (
            <div key={i} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 font-semibold flex items-center gap-2">
              <i className="ri-checkbox-circle-fill text-lg" /> {f}
            </div>
          ))}
          {sugestoes.length === 0 ? (
            <div className="text-center py-10">
              <i className="ri-inbox-line text-3xl text-zinc-300" />
              <p className="text-sm font-semibold text-zinc-600 mt-1">Nenhum pedido pronto esperando motoboy.</p>
            </div>
          ) : sugestoes.map((s, i) => (
            // (a posição dos motoboys chega depois de abrir: o cartão recomeça quando muda o motoboy sugerido)
            <CartaoSaida key={`${versao}-${i}-${s.paradas.map((p) => p.pedido.id).join()}-${s.motoboy?.driver_id ?? ''}`} indice={i + 1} sugestao={s}
              loja={loja} motoboys={motoboys} onConfirmar={onConfirmar} onFeito={(msg) => setFeitas((f) => [...f, msg])} />
          ))}
          {semLocal.length > 0 && (
            <p className="text-[11px] text-zinc-500 px-1">
              <i className="ri-map-pin-line" /> Sem localização no mapa (fora da sugestão): {semLocal.map((o) => numCurto(o.number)).join(', ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CartaoSaida({ indice, sugestao, loja, motoboys, onConfirmar, onFeito }: {
  indice: number; sugestao: SugestaoSaida; loja: Props['loja']; motoboys: Props['motoboys']; onConfirmar: Props['onConfirmar'];
  onFeito: (msg: string) => void;
}) {
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState(sugestao.motoboy?.driver_id ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const ficam = sugestao.paradas.filter((p) => !fora.has(p.pedido.id)).map((p) => p.pedido);
  // Tirou algum pedido: recalcula tempo/distância na mesma ordem
  const sim = useMemo(() => {
    if (!ficam.length) return null;
    const origem = loja ?? ficam[0];
    return simular(origem, ficam, Date.now(), { raioKm: 2.5, maxParadas: 3, kmh: 25, fatorRuas: 1.3, minPorParada: 3, minSaida: 5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fora, loja]);
  const mapsUrl = linkMaps(loja, ficam);

  const confirmar = async () => {
    if (!driverId || !ficam.length || !sim) return;
    setEnviando(true); setErro('');
    const r = await onConfirmar({
      pedidos: ficam.map((p) => p.id), driver_id: driverId, km: sim.km, min: sim.minutos, maps_url: mapsUrl,
      sugerido: { driver_id: sugestao.motoboy?.driver_id ?? null, pedidos: sugestao.paradas.map((p) => p.pedido.id), km: sugestao.km, min: sugestao.minutos },
    });
    setEnviando(false);
    if (r.ok) onFeito(`Saída com ${ficam.map((p) => numCurto(p.number)).join(', ')} confirmada com ${r.motoboy ?? 'o motoboy'} — ele vê a rota no portal.`);
    else setErro(r.erro ?? 'Não foi possível confirmar.');
  };

  return (
    <div className="rounded-xl border border-zinc-200 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-zinc-700 uppercase tracking-wide">Saída {indice}</p>
        {sim && <p className="text-[11px] text-zinc-500">≈ {sim.km.toLocaleString('pt-BR')} km · {sim.minutos} min até a última entrega</p>}
      </div>

      <ol className="space-y-1.5">
        {sugestao.paradas.map((p, i) => {
          const tirado = fora.has(p.pedido.id);
          const chegada = sim?.paradas.find((x) => x.pedido.id === p.pedido.id);
          return (
            <li key={p.pedido.id} className={'flex items-center gap-2 text-sm ' + (tirado ? 'opacity-40 line-through' : '')}>
              <span className="w-5 h-5 shrink-0 rounded-full bg-violet-600 text-white text-[10px] font-black flex items-center justify-center">{i + 1}</span>
              <span className="font-bold text-zinc-800">{numCurto(p.pedido.number)}</span>
              <span className="text-zinc-600 truncate flex-1">{p.pedido.cliente}</span>
              {chegada && !tirado ? (
                <span className={'text-[11px] font-semibold shrink-0 ' + (chegada.atrasa ? 'text-red-600' : 'text-zinc-500')}
                  title={chegada.atrasa ? 'Chega depois do prazo' : 'Chegada estimada'}>
                  ~{horaCurta(new Date(Date.now() + chegada.chegadaMin * 60000).toISOString())}{chegada.atrasa ? ' · atrasa' : ''}
                </span>
              ) : null}
              {sugestao.paradas.length > 1 && (
                <button type="button" onClick={() => setFora((f) => { const n = new Set(f); if (n.has(p.pedido.id)) n.delete(p.pedido.id); else n.add(p.pedido.id); return n; })}
                  title={tirado ? 'Voltar para esta saída' : 'Tirar desta saída'}
                  className="w-6 h-6 shrink-0 rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 flex items-center justify-center">
                  <i className={tirado ? 'ri-arrow-go-back-line' : 'ri-close-line'} />
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
        <label className="flex items-center gap-1.5 flex-1 min-w-0">
          <i className="ri-e-bike-2-line text-zinc-400" />
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Motoboy da saída"
            className="flex-1 min-w-0 border border-zinc-200 rounded-lg px-2 py-2 text-sm bg-white">
            <option value="">Escolha o motoboy…</option>
            {motoboys.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{sugestao.motoboy?.driver_id === m.id ? ` — sugerido (${sugestao.motoboyKm?.toLocaleString('pt-BR')} km da loja)` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" title="Ver a rota no Google Maps"
              className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50">
              <i className="ri-map-pin-line text-blue-600" /> Maps
            </a>
          )}
          <button type="button" disabled={!driverId || !ficam.length || enviando} onClick={confirmar}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-50">
            <i className={enviando ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} /> Confirmar saída
          </button>
        </div>
      </div>
      {!sugestao.motoboy && <p className="text-[11px] text-zinc-500">Nenhum motoboy livre com GPS ligado agora — escolha na lista.</p>}
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  );
}
