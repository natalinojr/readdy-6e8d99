import { useMemo, useState } from 'react';
import type { EntregaPedido, TempoPreparo } from '../hooks/useGestorEntregas';
import { useDriverPositions } from '@/hooks/useDriverPositions';
import {
  OPCOES_SAIDA, linkMaps, minutosAteSair, montarSaidas, ordenarParadas, simular,
  type MotoboyLivre, type PedidoSaida, type SaidaAberta, type SugestaoSaida,
} from '@/lib/montarSaida';
import { horaCurta } from '../utils';

// GPS mais velho que isso não conta como "livre e perto" (tela fechada ou sem sinal).
const GPS_FRESCO_MS = 10 * 60000;
const NA_COZINHA = ['new', 'preparing'];
// Motoboy com o pedido mas ainda na loja (ou indo buscar): dá para encaixar outro pedido na saída dele.
const naoSaiu = (o: EntregaPedido) => !o.motoboy_status || o.motoboy_status === 'a_caminho_loja';

interface Props {
  tenantId: string | undefined;
  orders: EntregaPedido[];
  loja: { lat: number; lng: number } | null;
  motoboys: { id: string; name: string }[];
  preparo: TempoPreparo | null;
  onConfirmar: (p: {
    pedidos: string[]; driver_id: string; km: number; min: number; maps_url: string;
    sugerido: { driver_id: string | null; pedidos: string[]; km: number; min: number };
  }) => Promise<{ ok: boolean; erro?: string; motoboy?: string }>;
  onFechar: () => void;
}

const numCurto = (n: string) => `#${String(n).replace(/\D/g, '').slice(-4) || n}`;
const horaEm = (min: number) => horaCurta(new Date(Date.now() + min * 60000).toISOString());
const fmtKm = (km: number) => (km < 1 ? `${Math.max(100, Math.round(km * 10) * 100)} m` : `${km.toLocaleString('pt-BR')} km`);

const paraSaida = (o: EntregaPedido): PedidoSaida => ({
  id: o.id, number: o.number, cliente: o.cliente, lat: o.lat!, lng: o.lng!, created_at: o.created_at, sla_min: o.delivery_sla_min,
  prontoEm: NA_COZINHA.includes(o.status) && o.pronto_previsto_at ? new Date(o.pronto_previsto_at).getTime() : null,
});

/**
 * "Montar saída" (Fase 3): sugere juntar pedidos prontos perto, a ordem e o motoboy; encaixa pronto na saída de
 * motoboy que ainda não saiu; e oferece esperar um pedido da cozinha que fica pronto logo. Nada acontece sem confirmar.
 */
export default function MontarSaidaModal({ tenantId, orders, loja, motoboys, preparo, onConfirmar, onFechar }: Props) {
  const { posicoes } = useDriverPositions(tenantId, true);
  const [versao, setVersao] = useState(0); // "Sugerir de novo"
  // Confirmadas nesta janela (o quadro recarrega e os pedidos saem da sugestão — a confirmação fica visível aqui)
  const [feitas, setFeitas] = useState<string[]>([]);

  const prontos = useMemo(() => orders.filter((o) => o.status === 'ready' && !o.driver_id && !o.motoboy_status), [orders]);
  const semLocal = prontos.filter((o) => o.lat == null || o.lng == null);
  const naCozinha = useMemo(() => orders.filter((o) => NA_COZINHA.includes(o.status) && !o.driver_id && !o.motoboy_status), [orders]);

  // Motoboys com pedido que ainda não saíram da loja (nenhum pedido dele já na rua)
  const naLoja = useMemo(() => {
    const porMoto = new Map<string, EntregaPedido[]>();
    const naRua = new Set<string>();
    for (const o of orders) {
      if (!o.driver_id || o.status === 'delivered' || o.status === 'cancelled' || o.motoboy_status === 'entregou') continue;
      if (!naoSaiu(o)) { naRua.add(o.driver_id); continue; }
      porMoto.set(o.driver_id, [...(porMoto.get(o.driver_id) ?? []), o]);
    }
    return [...porMoto.entries()].filter(([id]) => !naRua.has(id)).map(([driver_id, peds]) => ({
      driver_id, peds, nome: peds[0].driver_nome ?? motoboys.find((m) => m.id === driver_id)?.name ?? 'motoboy',
    }));
  }, [orders, motoboys]);

  const sugestoes: SugestaoSaida[] = useMemo(() => {
    const agora = Date.now();
    const comLocal = (o: EntregaPedido) => o.lat != null && o.lng != null;
    const pedidos = prontos.filter(comLocal).map(paraSaida);
    // Só encaixa se dá para simular a saída inteira dele: todos com local e, os da cozinha, com previsão
    const abertas: SaidaAberta[] = naLoja
      .filter((m) => m.peds.every((o) => comLocal(o) && (o.status === 'ready' || !!o.pronto_previsto_at)))
      .map((m) => ({ driver_id: m.driver_id, nome: m.nome, pedidos: m.peds.map(paraSaida) }));
    const emPreparo = naCozinha.filter((o) => comLocal(o) && o.pronto_previsto_at).map(paraSaida);
    const ocupados = new Set(orders.filter((o) => o.driver_id && o.status !== 'delivered' && o.motoboy_status !== 'entregou').map((o) => o.driver_id!));
    const ativos = new Set(motoboys.map((m) => m.id));
    const livres: MotoboyLivre[] = posicoes
      .filter((p) => ativos.has(p.driver_id) && !ocupados.has(p.driver_id) && agora - new Date(p.recorded_at).getTime() <= GPS_FRESCO_MS)
      .map((p) => ({ driver_id: p.driver_id, nome: p.nome, lat: p.lat, lng: p.lng }));
    return montarSaidas(pedidos, livres, loja, agora, {}, { abertas, emPreparo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prontos, naCozinha, naLoja, orders, motoboys, posicoes, loja, versao]);

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
            <SemSugestao prontos={prontos} semLocal={semLocal} naCozinha={naCozinha} naLoja={naLoja} />
          ) : sugestoes.map((s, i) => (
            // (a posição dos motoboys chega depois de abrir: o cartão recomeça quando muda o motoboy sugerido)
            <CartaoSaida key={`${versao}-${i}-${s.paradas.map((p) => p.pedido.id).join()}-${s.motoboy?.driver_id ?? s.encaixe?.driver_id ?? ''}-${s.espera?.pedido.id ?? ''}`}
              indice={i + 1} sugestao={s} loja={loja} motoboys={motoboys} onConfirmar={onConfirmar} onFeito={(msg) => setFeitas((f) => [...f, msg])} />
          ))}
          {sugestoes.length > 0 && semLocal.length > 0 && (
            <p className="text-[11px] text-zinc-500 px-1">
              <i className="ri-map-pin-line" /> Sem localização no mapa (fora da sugestão): {semLocal.map((o) => numCurto(o.number)).join(', ')}
            </p>
          )}
          {preparo?.base === 'padrao' && sugestoes.some((s) => s.espera) && (
            <p className="text-[11px] text-zinc-400 px-1">
              Previsão da cozinha com tempo padrão ({preparo.prepMin} min de preparo): a loja ainda tem pouco histórico de delivery.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Quando não há o que montar, conta o que está acontecendo (em vez de só "nenhum pedido"). */
function SemSugestao({ prontos, semLocal, naCozinha, naLoja }: {
  prontos: EntregaPedido[]; semLocal: EntregaPedido[]; naCozinha: EntregaPedido[];
  naLoja: { driver_id: string; nome: string; peds: EntregaPedido[] }[];
}) {
  const previstos = naCozinha.filter((o) => o.pronto_previsto_at).sort((a, b) => a.pronto_previsto_at!.localeCompare(b.pronto_previsto_at!));
  const primeiro = previstos[0]?.pronto_previsto_at;
  const linhas: { icon: string; texto: string }[] = [];
  if (prontos.length && semLocal.length === prontos.length) {
    linhas.push({ icon: 'ri-map-pin-line', texto: `${prontos.length === 1 ? 'Pronto sem localização no mapa' : 'Prontos sem localização no mapa'}: ${semLocal.map((o) => numCurto(o.number)).join(', ')}.` });
  }
  if (naCozinha.length) {
    const quando = primeiro
      ? (new Date(primeiro).getTime() <= Date.now() + 60000 ? 'o primeiro deve ficar pronto a qualquer momento' : `o primeiro deve ficar pronto ~${horaCurta(primeiro)}`)
      : 'a cozinha ainda não começou';
    linhas.push({ icon: 'ri-restaurant-line', texto: `${naCozinha.length} na cozinha sem entregador (${naCozinha.map((o) => numCurto(o.number)).join(', ')}) — ${quando}.` });
  }
  for (const m of naLoja) {
    linhas.push({
      icon: 'ri-e-bike-2-line',
      texto: `${m.peds.map((o) => numCurto(o.number)).join(', ')} com ${m.nome}, que ainda não saiu — se ficar pronto outro pedido perto, a sugestão encaixa na saída dele.`,
    });
  }
  return (
    <div className="text-center py-8">
      <i className="ri-inbox-line text-3xl text-zinc-300" />
      <p className="text-sm font-semibold text-zinc-600 mt-1">
        {prontos.length ? 'Nada para juntar agora.' : 'Nenhum pedido pronto esperando motoboy.'}
      </p>
      {linhas.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-left max-w-md mx-auto">
          {linhas.map((l, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-zinc-600">
              <i className={`${l.icon} text-zinc-400 mt-px`} /> <span>{l.texto}</span>
            </li>
          ))}
        </ul>
      ) : !prontos.length && (
        <p className="text-xs text-zinc-500 mt-1">Nenhuma entrega em aberto sem motoboy.</p>
      )}
    </div>
  );
}

function CartaoSaida({ indice, sugestao, loja, motoboys, onConfirmar, onFeito }: {
  indice: number; sugestao: SugestaoSaida; loja: Props['loja']; motoboys: Props['motoboys']; onConfirmar: Props['onConfirmar'];
  onFeito: (msg: string) => void;
}) {
  const enc = sugestao.encaixe;
  const esp = sugestao.espera ?? null;
  const fixos = useMemo(() => new Set(enc?.fixos ?? []), [enc]);
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [esperar, setEsperar] = useState(false);
  const [driverId, setDriverId] = useState(enc?.driver_id ?? sugestao.motoboy?.driver_id ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  // Com o pedido da cozinha a ordem muda: refaz pelo vizinho mais próximo
  const lista = useMemo(() => {
    const base = sugestao.paradas.map((p) => p.pedido);
    if (!esperar || !esp) return base;
    return ordenarParadas(loja ?? base[0], [...base, esp.pedido]);
  }, [sugestao, esperar, esp, loja]);
  const ficam = lista.filter((p) => !fora.has(p.id));
  // Tirou/incluiu algum pedido: recalcula tempo/distância na mesma ordem
  const sim = useMemo(() => {
    if (!ficam.length) return null;
    return simular(loja ?? ficam[0], ficam, Date.now(), OPCOES_SAIDA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fora, lista, loja]);
  const saiEm = ficam.length ? minutosAteSair(ficam, Date.now()) : 0;
  const mapsUrl = linkMaps(loja, ficam);
  const novos = ficam.filter((p) => !fixos.has(p.id));

  const confirmar = async () => {
    if (!driverId || !ficam.length || !sim) return;
    setEnviando(true); setErro('');
    const r = await onConfirmar({
      pedidos: ficam.map((p) => p.id), driver_id: driverId, km: sim.km, min: sim.minutos, maps_url: mapsUrl,
      sugerido: {
        // Aceitar a espera sugerida também é seguir a sugestão
        driver_id: enc?.driver_id ?? sugestao.motoboy?.driver_id ?? null, pedidos: lista.map((p) => p.id), km: sugestao.km, min: sugestao.minutos,
      },
    });
    setEnviando(false);
    if (!r.ok) { setErro(r.erro ?? 'Não foi possível confirmar.'); return; }
    if (enc) onFeito(`${novos.map((p) => numCurto(p.number)).join(', ')} ${novos.length === 1 ? 'encaixado' : 'encaixados'} na saída de ${r.motoboy ?? enc.nome} — ele vê a rota nova no portal.`);
    else onFeito(`Saída com ${ficam.map((p) => numCurto(p.number)).join(', ')} confirmada com ${r.motoboy ?? 'o motoboy'} — ele vê a rota no portal.`);
  };

  const alternar = (id: string) => setFora((f) => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className={'rounded-xl border p-3 space-y-2.5 ' + (enc ? 'border-violet-200 bg-violet-50/40' : 'border-zinc-200')}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-black text-zinc-700 uppercase tracking-wide">
          {enc ? <>Encaixar na saída de {enc.nome}</> : <>Saída {indice}</>}
        </p>
        {sim && (
          <p className="text-[11px] text-zinc-500">
            {saiEm > OPCOES_SAIDA.minSaida && <span className="font-semibold text-amber-700">sai ~{horaEm(saiEm)} · </span>}
            ≈ {sim.km.toLocaleString('pt-BR')} km · {sim.minutos} min até a última entrega
          </p>
        )}
      </div>
      {enc && (
        <p className="text-[11px] text-violet-700">
          {enc.nome} ainda não saiu da loja com {enc.fixos.length === 1 ? 'o pedido dele' : 'os pedidos dele'}; {sugestao.paradas.length - enc.fixos.length === 1 ? 'este pronto fica' : 'estes prontos ficam'} no caminho.
        </p>
      )}

      <ol className="space-y-1.5">
        {lista.map((p, i) => {
          const tirado = fora.has(p.id);
          const fixo = fixos.has(p.id);
          const daCozinha = esp?.pedido.id === p.id;
          const chegada = sim?.paradas.find((x) => x.pedido.id === p.id);
          const podeTirar = !fixo && (daCozinha || lista.length - fixos.size > 1);
          return (
            <li key={p.id} className={'flex items-center gap-2 text-sm ' + (tirado ? 'opacity-40 line-through' : '')}>
              <span className="w-5 h-5 shrink-0 rounded-full bg-violet-600 text-white text-[10px] font-black flex items-center justify-center">{i + 1}</span>
              <span className="font-bold text-zinc-800">{numCurto(p.number)}</span>
              <span className="text-zinc-600 truncate flex-1">
                {p.cliente}
                {fixo && <span className="ml-1.5 text-[10px] font-semibold text-violet-700 bg-violet-100 rounded px-1.5 py-0.5 whitespace-nowrap" title={`Já está com ${enc?.nome}`}><i className="ri-lock-line" /> já é dele</span>}
                {!!p.prontoEm && p.prontoEm > Date.now() && <span className="ml-1.5 text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5 whitespace-nowrap">na cozinha · pronto ~{horaCurta(new Date(p.prontoEm).toISOString())}</span>}
              </span>
              {chegada && !tirado ? (
                <span className={'text-[11px] font-semibold shrink-0 ' + (chegada.atrasa ? 'text-red-600' : 'text-zinc-500')}
                  title={chegada.atrasa ? 'Chega depois do prazo' : 'Chegada estimada'}>
                  ~{horaEm(chegada.chegadaMin)}{chegada.atrasa ? ' · atrasa' : ''}
                </span>
              ) : null}
              {podeTirar && (
                <button type="button" onClick={() => (daCozinha ? setEsperar(false) : alternar(p.id))}
                  title={daCozinha ? 'Não esperar este pedido' : tirado ? 'Voltar para esta saída' : 'Tirar desta saída'}
                  className="w-6 h-6 shrink-0 rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 flex items-center justify-center">
                  <i className={tirado ? 'ri-arrow-go-back-line' : 'ri-close-line'} />
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {esp && !esperar && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2">
          <p className="text-xs text-amber-900 flex-1">
            <i className="ri-time-line" /> Dá para esperar o <b>{numCurto(esp.pedido.number)}</b> ({esp.pedido.cliente}): fica pronto em ~{esp.esperaMin} min,
            a {fmtKm(esp.distKm)} do {numCurto(esp.perto.number)}. A saída sai um pouco depois e ninguém atrasa.
          </p>
          <button type="button" onClick={() => setEsperar(true)}
            className="shrink-0 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600">
            <i className="ri-add-line" /> Esperar e incluir
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
        <label className="flex items-center gap-1.5 flex-1 min-w-0">
          <i className="ri-e-bike-2-line text-zinc-400" />
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Motoboy da saída" disabled={!!enc}
            title={enc ? `Os pedidos já são de ${enc.nome}` : undefined}
            className="flex-1 min-w-0 border border-zinc-200 rounded-lg px-2 py-2 text-sm bg-white disabled:bg-zinc-50 disabled:text-zinc-700">
            {!enc && <option value="">Escolha o motoboy…</option>}
            {enc && !motoboys.some((m) => m.id === enc.driver_id) && <option value={enc.driver_id}>{enc.nome}</option>}
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
          <button type="button" disabled={!driverId || !ficam.length || (!!enc && !novos.length) || enviando} onClick={confirmar}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-50">
            <i className={enviando ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} /> {enc ? 'Confirmar encaixe' : 'Confirmar saída'}
          </button>
        </div>
      </div>
      {!enc && !sugestao.motoboy && <p className="text-[11px] text-zinc-500">Nenhum motoboy livre com GPS ligado agora — escolha na lista.</p>}
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  );
}
