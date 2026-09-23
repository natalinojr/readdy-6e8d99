import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from '@/contexts/SessaoContext';
import { useKDS } from '@/contexts/KDSContext';
import { useImpressoras } from '@/contexts/ImpressorasContext';
import { queueOrderForPrint, type OrderItemForPrint } from '@/lib/printOrderQueue';
import PagamentoRapidoModal from '@/components/feature/PagamentoRapidoModal';
import CancelamentoModal from '@/components/feature/CancelamentoModal';

// Pedidos do tablet pagos em DINHEIRO: nascem segurados (rascunho) e só vão pra cozinha quando o
// caixa recebe — o order-write › record_payment libera e aqui sai o ticket da cozinha. Rascunho não
// vem no fn_get_kds_orders, por isso a lista própria (order-write › list_held_orders).

interface HeldItem {
  id: string;
  item_id: string | null;
  item_name: string;
  item_price: number;
  quantity: number;
  skip_kds: boolean | null;
  station_id: string | null;
  notes: string | null;
  status: string | null;
  order_item_options?: Array<{ option_name: string; additional_price: number | null }>;
  order_item_observations?: Array<{ text: string }>;
}

interface HeldOrder {
  id: string;
  number: string;
  created_at: string;
  destination_type: string | null;
  destination_name: string | null;
  total_amount: number;
  notes: string | null;
  is_paid: boolean | null;
  payments?: Array<{ amount: number; is_refunded: boolean | null }>;
  order_items: HeldItem[];
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numeroCurto = (n: string) => parseInt(String(n).replace(/\D/g, '').slice(-4), 10) || 0;
const formaDasNotas = (notes: string | null) => notes?.match(/Pagar no balcão:\s*([^·]+)/i)?.[1]?.trim();
// Cancelar só vale para o dinheiro que ainda não foi recebido (nenhum pagamento lançado).
const recebeuAlgo = (o: HeldOrder) => !!o.is_paid || (o.payments ?? []).some((p) => !p.is_refunded && Number(p.amount) > 0);
const itensAtivos = (o: HeldOrder) => (o.order_items ?? []).filter((i) => i.status !== 'cancelled');

function destinoTexto(o: HeldOrder) {
  const nome = (o.destination_name ?? '').trim();
  if (o.destination_type === 'password') return nome ? `Senha ${nome.replace(/^[A-Z]-?/i, '')}` : 'Senha';
  return nome || 'Autoatendimento';
}

export default function PedidosTabletAguardando() {
  const { user } = useAuth();
  const { sessao } = useSessao();
  const { reloadOrders } = useKDS();
  const { mapaEstacoes } = useImpressoras();
  const [pedidos, setPedidos] = useState<HeldOrder[]>([]);
  const [pagando, setPagando] = useState<HeldOrder | null>(null);
  const [cancelando, setCancelando] = useState<HeldOrder | null>(null);
  const [liberando, setLiberando] = useState<string | null>(null);
  const { error: toastError } = useToast();
  // Um ticket por pedido neste PDV (duplo toque / poll no meio). A fila também deduplica.
  const impressosRef = useRef<Set<string>>(new Set());
  const tenantId = user?.tenantId ?? '';
  const sessionId = sessao?.id ?? null;

  const carregar = useCallback(async (): Promise<HeldOrder[] | null> => {
    if (!tenantId || !sessionId) { setPedidos([]); return []; }
    const { data, error } = await invokeWithAuth<{ data: HeldOrder[] }>('order-write', {
      body: { action: 'list_held_orders', tenant_id: tenantId, session_id: sessionId },
    });
    if (error) return null;
    const lista = data?.data ?? [];
    setPedidos(lista);
    return lista;
  }, [tenantId, sessionId]);

  useEffect(() => {
    setPedidos([]);
    carregar();
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 8000);
    return () => clearInterval(t);
  }, [carregar]);

  // Pago → o servidor já tirou do rascunho; o ticket da cozinha sai daqui, com o mapa de
  // impressoras deste PDV (mesmo caminho do pedido lançado no caixa).
  const imprimirCozinha = async (o: HeldOrder) => {
    if (impressosRef.current.has(o.id)) return;
    impressosRef.current.add(o.id);
    const items: OrderItemForPrint[] = itensAtivos(o).map((i) => ({
      item_name: i.item_name,
      quantity: i.quantity,
      skip_kds: i.skip_kds,
      station_id: i.station_id,
      item_id: i.item_id,
      item_price: Number(i.item_price ?? 0),
      options: (i.order_item_options ?? []).map((op) => ({ option_name: op.option_name, additional_price: Number(op.additional_price ?? 0) })),
      observations: i.order_item_observations ?? [],
      notes: i.notes,
    }));
    try {
      await queueOrderForPrint(
        tenantId, o.id, o.number, 'self_service', items,
        { tipo: o.destination_type ?? 'immediate', destination_name: o.destination_name, table_number: null },
        mapaEstacoes, Number(o.total_amount ?? 0), /\[VIAGEM\]/.test(o.notes ?? ''),
      );
    } catch (e) {
      console.warn('[PedidosTabletAguardando] falha ao enfileirar ticket', o.id, e);
    }
  };

  // Depois de receber: só imprime se o pedido saiu da lista (o servidor liberou). Pago e ainda
  // na lista = liberação falhou → fica com o botão "Mandar pra cozinha". Parcial = segue a receber.
  const aposPagamento = async (o: HeldOrder) => {
    const lista = await carregar();
    if (lista && !lista.some((p) => p.id === o.id)) await imprimirCozinha(o);
    reloadOrders?.();
  };

  const mandarPraCozinha = async (o: HeldOrder) => {
    setLiberando(o.id);
    try {
      const { data, error } = await invokeWithAuth<{ data?: { released?: boolean }; error?: string }>('order-write', {
        body: { action: 'release_held_order', tenant_id: tenantId, order_id: o.id },
      });
      if (error || data?.error) { toastError(data?.error ?? 'Não foi possível mandar pra cozinha. Tente de novo.'); return; }
      await aposPagamento(o);
    } finally {
      setLiberando(null);
    }
  };

  if (pedidos.length === 0 && !pagando && !cancelando) return null;

  return (
    <div className="flex-shrink-0 border-b-2 border-teal-300 bg-teal-50 px-2 py-2 space-y-1.5 max-h-[45%] overflow-y-auto">
      <div className="flex items-center gap-1.5 px-1">
        <i className="ri-tablet-line text-teal-700 text-sm" />
        <p className="text-xs font-black text-teal-800 flex-1">
          Tablet — aguardando pagamento no caixa ({pedidos.length})
        </p>
        <span className="text-[10px] text-teal-700">Só vai pra cozinha depois de receber</span>
      </div>
      {pedidos.map((o) => {
        const forma = formaDasNotas(o.notes);
        const itens = itensAtivos(o);
        return (
          <div key={o.id} className="bg-white border border-teal-200 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-zinc-900">#{String(numeroCurto(o.number)).padStart(4, '0')}</span>
              <span className="text-xs font-semibold text-zinc-600 truncate flex-1">{destinoTexto(o)}</span>
              <span className="text-[10px] text-zinc-400">
                {new Date(o.created_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">
              {itens.map((i) => `${i.quantity}x ${i.item_name}`).join(' · ')}
            </p>
            {o.is_paid ? (
              <button
                onClick={() => mandarPraCozinha(o)}
                disabled={liberando === o.id}
                className="w-full mt-1.5 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-xs font-black rounded-lg cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
              >
                <i className={liberando === o.id ? 'ri-loader-4-line animate-spin' : 'ri-restaurant-2-line'} />
                Já pago — mandar pra cozinha
              </button>
            ) : (
            <div className="flex items-center gap-2 mt-1.5">
              {/* Só antes de receber qualquer valor. Qualquer operador vê: o modal pede o motivo e a senha/aprovação do gerente. */}
              {!recebeuAlgo(o) && (
                <button
                  onClick={() => setCancelando(o)}
                  className="px-2.5 py-1.5 text-[11px] font-bold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={() => setPagando(o)}
                className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black rounded-lg cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
              >
                <i className="ri-money-dollar-circle-line" />
                Receber {fmt(Number(o.total_amount ?? 0))}{forma ? ` · ${forma}` : ''}
              </button>
            </div>
            )}
          </div>
        );
      })}

      {pagando && (
        <PagamentoRapidoModal
          orderId={pagando.id}
          numeroDisplay={numeroCurto(pagando.number)}
          total={Number(pagando.total_amount ?? 0)}
          destinoDisplay={destinoTexto(pagando)}
          destino={null}
          paidByPdv="cashier"
          formaInicialNome={formaDasNotas(pagando.notes)}
          tituloContexto="Receber pedido do tablet"
          onClose={() => setPagando(null)}
          onSuccess={() => {
            const o = pagando;
            setPagando(null);
            aposPagamento(o);
          }}
        />
      )}

      {cancelando && (
        <CancelamentoModal
          tipo="pedido"
          orderId={cancelando.id}
          orderNumber={numeroCurto(cancelando.number)}
          onConcluido={() => { setCancelando(null); carregar(); }}
          onFechar={() => setCancelando(null)}
        />
      )}
    </div>
  );
}
