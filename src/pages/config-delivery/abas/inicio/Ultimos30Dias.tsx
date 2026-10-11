import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { inicioDosUltimos30Dias } from '../../config';
import { useDeliveryTela, type AbaDelivery } from '../../DeliveryTela';
import { SecaoTitulo, Vazio, brl, brlInteiro, btn } from '../../ui';
import { resumir30d, type PedidoMes } from './calculos';

// "Últimos 30 dias": o número e o que fazer com ele. Uma consulta nos pedidos de entrega própria do mês;
// as contas estão em calculos.ts (resumir30d). iFood e retirada ficam de fora (têm relatório próprio); o pedido do
// iFood entregue pelo motoboy da loja (`ifood_order_id`) só entra na contagem de entregas, não em vendido/ticket/taxa.

const COLUNAS = 'status, total_amount, delivery_fee, cancel_reason, motoboy_status, motoboy_timeline, out_for_delivery_at, delivery_source, delivery_platform, ifood_order_id, created_at';
const POR_PAGINA = 1000; // limite de linhas do Supabase por consulta

async function buscarPedidos(tenantId: string): Promise<PedidoMes[]> {
  const desde = inicioDosUltimos30Dias();
  const todos: PedidoMes[] = [];
  for (let de = 0; de < 20 * POR_PAGINA; de += POR_PAGINA) {
    const { data, error } = await supabase.from('orders').select(COLUNAS)
      .eq('tenant_id', tenantId).eq('origin_type', 'delivery').eq('is_training', false).gte('created_at', desde)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(de, de + POR_PAGINA - 1);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as PedidoMes[];
    todos.push(...pagina);
    if (pagina.length < POR_PAGINA) break;
  }
  return todos;
}

/** Um número do mês. Sem reticências: o valor inteiro aparece (a grade cuida de caber). */
function Numero({ valor, rotulo, vermelho = false, className = '' }: { valor: string | number; rotulo: string; vermelho?: boolean; className?: string }) {
  return (
    <div className={`bg-white border border-zinc-200 rounded-2xl px-3 py-2 min-w-0 ${className}`}>
      <p className={`text-[17px] font-extrabold leading-tight tabular-nums whitespace-nowrap ${vermelho ? 'text-red-600' : 'text-zinc-900'}`}>{valor}</p>
      <p className="text-[10.5px] md:text-[11px] font-semibold text-zinc-400 mt-0.5 leading-snug">{rotulo}</p>
    </div>
  );
}

interface Achado { id: string; tom: 'r' | 'o' | 'v' | 'z'; icone: string; titulo: string; texto: string; aba?: AbaDelivery; botao?: string }
const AVATAR = { r: 'bg-red-100 text-red-600', o: 'bg-amber-100 text-amber-700', v: 'bg-violet-100 text-violet-700', z: 'bg-zinc-100 text-zinc-500' };

export default function Ultimos30Dias() {
  const { tenantId, irPara } = useDeliveryTela();
  const [pedidos, setPedidos] = useState<PedidoMes[] | null>(null);
  const [erro, setErro] = useState('');
  const tenantAtual = useRef(tenantId);
  tenantAtual.current = tenantId;

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    const t = tenantId;
    setErro('');
    try {
      const p = await buscarPedidos(t);
      if (tenantAtual.current === t) setPedidos(p);
    } catch (e) {
      if (tenantAtual.current === t) setErro(e instanceof Error ? e.message : String(e));
    }
  }, [tenantId]);

  useEffect(() => { setPedidos(null); void carregar(); }, [carregar]);

  const r = useMemo(() => (pedidos ? resumir30d(pedidos) : null), [pedidos]);

  const achados = useMemo<Achado[]>(() => {
    if (!r) return [];
    const a: Achado[] = [];
    if (r.cancelados > 0 && r.motivoTop) {
      const { motivo, n } = r.motivoTop;
      const cancel = n === 1 ? 'cancelado' : 'cancelados';
      if (/^pix/i.test(motivo)) {
        a.push({ id: 'cancel', tom: 'r', icone: 'ri-qr-code-line', titulo: `${n} ${cancel} porque o Pix pelo app não caiu`,
          texto: 'Ficaram esperando o pagamento até o caixa fechar.', aba: 'pagamento', botao: 'Pagamento' });
      } else if (!motivo) {
        a.push({ id: 'cancel', tom: 'r', icone: 'ri-close-circle-line', titulo: `${n} ${cancel} sem motivo anotado`,
          texto: 'Ao cancelar um pedido, anote o motivo: é ele que mostra o que dá para melhorar.' });
      } else {
        a.push({ id: 'cancel', tom: 'r', icone: 'ri-close-circle-line', titulo: `${n} ${cancel}: ${motivo}`,
          texto: `É o motivo mais comum entre os ${r.cancelados} cancelados do mês.` });
      }
    }
    if (r.entreguesSemMarca > 0) {
      a.push({ id: 'marca', tom: 'o', icone: 'ri-hand-coin-line', titulo: `${r.entreguesSemMarca} de ${r.entregues} entregas sem o motoboy marcar`,
        texto: 'Sem isso não dá para saber quanto demorou.', aba: 'equipe', botao: 'Equipe' });
    }
    if (r.doInstagram > 0) {
      a.push({ id: 'ig', tom: 'v', icone: 'ri-instagram-line', titulo: `${r.doInstagram} ${r.doInstagram === 1 ? 'pedido veio' : 'pedidos vieram'} do Instagram`,
        texto: `De ${r.naoCancelados} pedidos no mês. Os links de cada canal estão em Links e QR.`, aba: 'links', botao: 'Links e QR' });
    }
    if (r.tempoMedioMin != null) {
      a.push({ id: 'tempo', tom: 'z', icone: 'ri-timer-line', titulo: `Tempo médio de entrega: ${r.tempoMedioMin} min (saiu → entregou)`,
        texto: `Média de ${r.tempoAmostra} entregas em que o motoboy marcou a saída e a entrega.` });
    }
    return a;
  }, [r]);

  return (
    <div>
      <SecaoTitulo titulo="Últimos 30 dias"
        direita={<Link to="/relatorios?aba=delivery" className={btn('ghost', 'sm')}>Relatório<i className="ri-arrow-right-s-line" /></Link>} />

      {pedidos === null && !erro && (
        <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-6 text-center text-sm text-zinc-500">
          <i className="ri-loader-4-line animate-spin mr-1.5" />Contando os pedidos do mês…
        </div>
      )}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-[13px] text-red-700">
          Não consegui carregar os pedidos do mês: {erro}
          <div className="mt-2"><button type="button" className={btn('out', 'sm')} onClick={() => void carregar()}>Tentar de novo</button></div>
        </div>
      )}

      {r && r.total === 0 && <Vazio icone="ri-shopping-bag-3-line" titulo="Nenhum pedido de delivery nos últimos 30 dias.">Quando entrarem pedidos pelo link do delivery, os números aparecem aqui.</Vazio>}

      {r && r.total > 0 && (
        <>
          {/* Celular: 2 colunas. Tela de 640 a 1023 px (coluna única): 3. No computador a coluna é metade da tela: 2 até 1279 px, 3 acima. Nenhum número é cortado. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
            <Numero valor={r.entregues} rotulo="entregues" />
            <Numero valor={brlInteiro(r.vendido)} rotulo="vendido" />
            <Numero valor={brl(r.ticket)} rotulo="ticket médio" />
            <Numero valor={brl(r.taxaMedia)} rotulo="taxa média" />
            <Numero valor={r.cancelados} rotulo="cancelados" vermelho={r.cancelados > 0} className="col-span-2 sm:col-span-1 lg:col-span-2 xl:col-span-1" />
          </div>
          {achados.length > 0 && (
            <div className="space-y-2 mt-2.5">
              {achados.map((x) => (
                <div key={x.id} className="bg-white border border-zinc-200 rounded-2xl pl-3 pr-2.5 py-2.5 flex items-center gap-3">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${AVATAR[x.tom]}`}><i className={`${x.icone} text-lg`} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-extrabold text-zinc-900 leading-snug">{x.titulo}</p>
                    <p className="text-[12px] text-zinc-500 leading-snug mt-0.5">{x.texto}</p>
                  </div>
                  {x.aba && x.botao && (
                    <button type="button" className={`${btn('out', 'sm')} flex-shrink-0`} onClick={() => irPara(x.aba as AbaDelivery)}>{x.botao}</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
