import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { ifoodShipping, fetchIfoodOrders, IFOOD_ORDER_LABEL, ifoodTipoPedido, ifoodPodeDespachar, type IfoodOrder } from '@/lib/ifoodShipping';
import { fmtMoeda } from '../utils';

interface Props {
  tenantId: string;
  operar: boolean; // modo "operar" (homologação na loja de teste); padrão = só leitura
  onClose: () => void;
}

const TOM: Record<string, string> = {
  placed: 'bg-amber-100 text-amber-800', confirmed: 'bg-sky-100 text-sky-800', preparing: 'bg-sky-100 text-sky-800',
  ready: 'bg-violet-100 text-violet-800', dispatched: 'bg-indigo-100 text-indigo-800',
  concluded: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-zinc-200 text-zinc-600',
};
const PAGTO: Record<string, string> = {
  CREDIT: 'Crédito', DEBIT: 'Débito', CASH: 'Dinheiro', PIX: 'Pix', MEAL_VOUCHER: 'Vale-refeição', FOOD_VOUCHER: 'Vale-alimentação',
  DIGITAL_WALLET: 'Carteira digital', GIFT_CARD: 'Vale-presente', OTHER: 'Outro',
};
const QUEM: Record<string, string> = { IFOOD: 'iFood', MERCHANT: 'loja', EXTERNAL: 'parceiro', CHAIN: 'rede' };
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const hojeInicio = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

/**
 * Pedidos do iFood (módulo Order). Só leitura por padrão: mostra cada pedido com itens, complementos,
 * observações, pagamento (bandeira/troco), cupons e quem paga, código de coleta e CPF da nota.
 * No modo "operar" (homologação na loja de teste) aparecem confirmar / preparo / pronto / despachar / cancelar.
 */
export default function IfoodPedidosModal({ tenantId, operar, onClose }: Props) {
  useVoltarFecha(true, onClose, 'ifood-pedidos');
  const [pedidos, setPedidos] = useState<IfoodOrder[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [motivos, setMotivos] = useState<{ id: string; lista: { code: string; description: string }[] } | null>(null);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async () => {
    setPedidos(await fetchIfoodOrders(tenantId, hojeInicio()));
    setCarregando(false);
  }, [tenantId]);
  useEffect(() => { carregar(); const id = setInterval(carregar, 15000); return () => clearInterval(id); }, [carregar]);

  const resumo = useMemo(() => {
    const validos = pedidos.filter((p) => p.status !== 'cancelled');
    return { n: validos.length, total: validos.reduce((s, p) => s + Number(p.total?.orderAmount ?? 0), 0), cancelados: pedidos.length - validos.length };
  }, [pedidos]);

  const acao = async (p: IfoodOrder, op: string, extra: Record<string, unknown> = {}) => {
    setBusy(p.id + op); setMsg(null);
    const r = await ifoodShipping<{ message?: string }>('order_action', tenantId, { order_row_id: p.id, op, ...extra });
    setBusy('');
    setMsg({ ok: r.success, t: r.success ? (r.message ?? 'Enviado ao iFood.') : (r.error ?? 'Falhou.') });
    if (r.success) { setMotivos(null); setTimeout(carregar, 3000); }
  };
  const abrirMotivos = async (p: IfoodOrder) => {
    setBusy(p.id + 'reasons'); setMsg(null);
    const r = await ifoodShipping<{ reasons: { code: string; description: string }[] }>('order_cancel_reasons', tenantId, { order_row_id: p.id });
    setBusy('');
    if (!r.success) { setMsg({ ok: false, t: r.error ?? 'Falhou.' }); return; }
    if (!r.reasons.length) { setMsg({ ok: false, t: 'O iFood não permite mais cancelar este pedido.' }); return; }
    setMotivos({ id: p.id, lista: r.reasons }); setMotivo('');
  };
  const reler = async (p: IfoodOrder) => {
    setBusy(p.id + 'refresh');
    const r = await ifoodShipping('order_refresh', tenantId, { order_row_id: p.id });
    setBusy('');
    if (!r.success) setMsg({ ok: false, t: r.error ?? 'Falhou.' }); else carregar();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[94vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-zinc-100">
          <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg shrink-0"><i className="ri-restaurant-2-fill text-red-600" /></div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-zinc-800">Pedidos do iFood — hoje</h4>
            <p className="text-xs text-zinc-500 truncate">
              {resumo.n} pedido{resumo.n === 1 ? '' : 's'} · {fmtMoeda(resumo.total)}{resumo.cancelados ? ` · ${resumo.cancelados} cancelado${resumo.cancelados === 1 ? '' : 's'}` : ''}
              {' · '}{operar ? <b className="text-amber-700">modo operar</b> : 'só leitura (a loja opera no Gestor do iFood)'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100"><i className="ri-close-line text-lg" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {msg && <p className={`text-xs rounded-lg p-2 border ${msg.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-red-600 bg-red-50 border-red-100'}`}>{msg.t}</p>}
          {carregando ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : pedidos.length === 0 ? (
            <p className="text-center text-sm text-zinc-400 py-10">Nenhum pedido do iFood hoje ainda.</p>
          ) : pedidos.map((p) => {
            const open = aberto === p.id;
            const itens = [...(p.ifood_order_items ?? [])].sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
            const metodos = p.payments?.methods ?? [];
            const cupons = (p.benefits ?? []).map((b) => ({ ...b, quem: (b.sponsorshipValues ?? []).filter((s) => Number(s.value) > 0) }));
            return (
              <div key={p.id} className="rounded-xl border border-zinc-200">
                <button type="button" onClick={() => setAberto(open ? null : p.id)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
                  <span className="text-sm font-black text-zinc-800 w-14 shrink-0">#{p.display_id ?? '—'}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${TOM[p.status] ?? ''}`}>{IFOOD_ORDER_LABEL[p.status] ?? p.status}</span>
                  {p.is_test && <span className="text-[9px] font-bold px-1 rounded bg-zinc-100 text-zinc-500 shrink-0">TESTE</span>}
                  <span className="flex-1 min-w-0 truncate text-xs text-zinc-600">{p.customer_name ?? 'Cliente'} · {itens.map((i) => `${i.quantity}× ${i.name}`).join(', ') || 'itens chegando…'}</span>
                  <span className="text-xs font-bold text-zinc-800 shrink-0">{fmtMoeda(Number(p.total?.orderAmount ?? 0))}</span>
                  <span className="text-[10px] text-zinc-400 shrink-0 w-10 text-right">{hora(p.ordered_at ?? p.created_at)}</span>
                </button>

                {open && (
                  <div className="px-3 pb-3 space-y-3 border-t border-zinc-100 pt-3 text-xs">
                    <div className="space-y-1.5">
                      {itens.map((i) => (
                        <div key={i.id}>
                          <div className="flex justify-between gap-2"><span className="font-semibold text-zinc-800">{i.quantity}× {i.name}</span><span className="text-zinc-600">{fmtMoeda(Number(i.total_price ?? 0))}</span></div>
                          {(i.options ?? []).map((o, k) => (
                            <p key={k} className="pl-3 text-zinc-500">+ {o.quantity && o.quantity > 1 ? `${o.quantity}× ` : ''}{o.name}{o.groupName ? <span className="text-zinc-400"> ({o.groupName})</span> : null}{(o.customization ?? []).length ? ` — ${(o.customization ?? []).map((c) => c.name).join(', ')}` : ''}</p>
                          ))}
                          {i.observations && <p className="pl-3 text-amber-700 font-semibold">Obs.: {i.observations}</p>}
                        </div>
                      ))}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-2">
                      <div className="rounded-lg bg-zinc-50 p-2 space-y-0.5">
                        <p className="font-bold text-zinc-700">Pagamento</p>
                        {metodos.map((m, k) => (
                          <p key={k} className="text-zinc-600">
                            {PAGTO[m.method] ?? m.method}{m.card?.brand ? ` ${m.card.brand}` : ''}{m.wallet?.name ? ` (${m.wallet.name})` : ''} — {fmtMoeda(Number(m.value))}
                            {' '}<span className={m.type === 'OFFLINE' ? 'text-amber-700 font-semibold' : 'text-emerald-700'}>{m.type === 'OFFLINE' ? 'cobrar na entrega' : 'pago no app'}</span>
                            {m.cash?.changeFor ? <span className="text-amber-700"> · troco para {fmtMoeda(Number(m.cash.changeFor))} ({fmtMoeda(Number(m.cash.changeFor) - Number(m.value))})</span> : null}
                          </p>
                        ))}
                        {cupons.map((c, k) => (
                          <p key={'c' + k} className="text-zinc-600">Cupom {fmtMoeda(Number(c.value))} ({c.target === 'DELIVERY_FEE' ? 'na entrega' : c.target === 'ITEM' ? 'em item' : 'no pedido'}) — pago por {c.quem.map((s) => `${QUEM[s.name] ?? s.name} ${fmtMoeda(Number(s.value))}`).join(' + ') || '—'}</p>
                        ))}
                        {p.total && <p className="text-zinc-500 pt-0.5">Itens {fmtMoeda(Number(p.total.subTotal ?? 0))} · entrega {fmtMoeda(Number(p.total.deliveryFee ?? 0))}{Number(p.total.additionalFees ?? 0) ? ` · taxas ${fmtMoeda(Number(p.total.additionalFees))}` : ''}{Number(p.total.benefits ?? 0) ? ` · descontos −${fmtMoeda(Number(p.total.benefits))}` : ''}</p>}
                      </div>
                      <div className="rounded-lg bg-zinc-50 p-2 space-y-0.5">
                        <p className="font-bold text-zinc-700">{p.order_type === 'DELIVERY' ? 'Entrega' : 'Como sai'}</p>
                        <p className="text-zinc-600">{ifoodTipoPedido(p)}</p>
                        {p.pickup_code && <p className="text-zinc-700">Código de coleta: <b className="tracking-widest">{p.pickup_code}</b></p>}
                        {p.delivery_observations && <p className="text-amber-700 font-semibold">Obs. da entrega: {p.delivery_observations}</p>}
                        {p.extra_info && <p className="text-zinc-500">{p.extra_info}</p>}
                        {p.customer_document && <p className="text-zinc-600">CPF/CNPJ na nota: {p.customer_document}</p>}
                        {p.customer_orders_count != null && <p className="text-zinc-400">{p.customer_orders_count} pedido(s) do cliente na loja</p>}
                        {p.cancel_reason && <p className="text-zinc-500">Cancelado: {p.cancel_reason}</p>}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <button disabled={!!busy} onClick={() => reler(p)} className="px-2.5 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 font-semibold disabled:opacity-50">
                        <i className={'ri-refresh-line' + (busy === p.id + 'refresh' ? ' animate-spin' : '')} /> Reler do iFood
                      </button>
                      {operar && !['concluded', 'cancelled'].includes(p.status) && (
                        <>
                          {p.status === 'placed' && <Botao on={() => acao(p, 'confirm')} b={busy === p.id + 'confirm'} t="Confirmar" cor="bg-emerald-600" />}
                          {p.status === 'confirmed' && <Botao on={() => acao(p, 'start')} b={busy === p.id + 'start'} t="Iniciar preparo" cor="bg-sky-600" />}
                          {['confirmed', 'preparing'].includes(p.status) && <Botao on={() => acao(p, 'ready')} b={busy === p.id + 'ready'} t="Pronto" cor="bg-violet-600" />}
                          {p.status === 'ready' && ifoodPodeDespachar(p) && <Botao on={() => acao(p, 'dispatch')} b={busy === p.id + 'dispatch'} t="Despachar" cor="bg-indigo-600" />}
                          {!p.cancel_requested && <Botao on={() => abrirMotivos(p)} b={busy === p.id + 'reasons'} t="Cancelar pedido" cor="bg-red-600" />}
                        </>
                      )}
                    </div>
                    {p.dispute && <Negociacao d={p.dispute} operar={operar} busy={busy} id={p.id} onResponder={(op, reason) => acao(p, op, { reason })} />}
                    {motivos?.id === p.id && (
                      <div className="flex gap-1.5">
                        <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="flex-1 px-2 py-1.5 rounded-lg border border-zinc-200 text-xs">
                          <option value="">Motivo do cancelamento…</option>
                          {motivos.lista.map((m) => <option key={m.code} value={m.code}>{m.description}</option>)}
                        </select>
                        <Botao on={() => acao(p, 'cancel', { code: motivo, reason: motivos.lista.find((x) => x.code === motivo)?.description ?? '' })} b={busy === p.id + 'cancel'} t="Enviar" cor="bg-red-600" off={!motivo} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Botao({ on, b, t, cor, off }: { on: () => void; b: boolean; t: string; cor: string; off?: boolean }) {
  return (
    <button disabled={b || off} onClick={on} className={`px-2.5 py-1.5 rounded-lg text-white font-bold disabled:opacity-50 ${cor}`}>
      {b ? '…' : t}
    </button>
  );
}

// Plataforma de Negociação: o cliente pediu cancelamento/reembolso (HANDSHAKE_DISPUTE). No modo "operar" a loja
// aceita ou recusa aqui; no modo só leitura responde no Gestor de Pedidos do iFood. Sem resposta, vale o timeoutAction.
const ACAO_DISPUTA: Record<string, string> = { CANCELLATION: 'cancelar o pedido', PARTIAL_CANCELLATION: 'cancelar parte do pedido', PROP_REFUND: 'reembolso proporcional' };
function Negociacao({ d, operar, busy, id, onResponder }: { d: Record<string, unknown>; operar: boolean; busy: string; id: string; onResponder: (op: string, reason?: string) => void }) {
  const [recusa, setRecusa] = useState<string | null>(null);
  const acaoTxt = ACAO_DISPUTA[String(d.action ?? '')] ?? String(d.action ?? 'negociação');
  const expira = typeof d.expiresAt === 'string' ? hora(d.expiresAt) : '';
  const fechada = Boolean(d.settled || d.answered);
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-2 space-y-1.5">
      <p className="text-red-700 font-semibold">
        Cliente pediu: {acaoTxt}{d.message ? ` — “${String(d.message)}”` : ''}{expira && !fechada ? ` · responder até ${expira}` : ''}
      </p>
      {d.settled ? <p className="text-zinc-600">Negociação encerrada pelo iFood.</p>
        : d.answered ? <p className="text-zinc-600">Respondido: {d.answered === 'accept' ? 'aceito' : 'recusado'}. Aguardando o iFood.</p>
        : !operar ? <p className="text-zinc-600">Responda no Gestor de Pedidos do iFood.</p>
        : recusa === null ? (
          <div className="flex gap-1.5">
            <Botao on={() => onResponder('dispute_accept')} b={busy === id + 'dispute_accept'} t="Aceitar" cor="bg-emerald-600" />
            <Botao on={() => setRecusa('')} b={false} t="Recusar" cor="bg-red-600" />
          </div>
        ) : (
          <div className="flex gap-1.5">
            <input value={recusa} onChange={(e) => setRecusa(e.target.value)} maxLength={250} placeholder="Motivo da recusa" className="flex-1 px-2 py-1.5 rounded-lg border border-zinc-200 text-xs" />
            <Botao on={() => onResponder('dispute_reject', recusa.trim())} b={busy === id + 'dispute_reject'} t="Enviar" cor="bg-red-600" off={!recusa.trim()} />
          </div>
        )}
    </div>
  );
}
