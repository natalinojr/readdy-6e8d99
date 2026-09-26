import { useCallback, useEffect, useState } from 'react';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import {
  ifoodShipping, fetchShippingByOrder, SHIPPING_ATIVOS, SHIPPING_LABEL, fmtMin,
  type IfoodQuote, type IfoodShippingOrder, type PrepareResult,
} from '@/lib/ifoodShipping';
import { fmtMoeda, waNumero } from '../utils';

interface Props {
  tenantId: string;
  orderId: string;
  telefone: string;
  onClose: () => void;
  onChanged: () => void;
}

type PayKind = 'paid' | 'CASH' | 'CREDIT' | 'DEBIT';

const inp = 'w-full px-2.5 py-2 rounded-lg border border-zinc-200 focus:border-red-400 outline-none text-sm';
const lbl = 'block text-[11px] font-semibold text-zinc-500 mb-0.5';

/**
 * iFood Entrega (Sob Demanda): cotação → chamar entregador → acompanhar (código de entrega,
 * troca de endereço, cancelamento com os motivos que o iFood devolve). Doc: IFOOD-SHIPPING.md.
 */
export default function IfoodEntregaModal({ tenantId, orderId, telefone, onClose, onChanged }: Props) {
  useVoltarFecha(true, onClose, 'ifood-entrega');
  const [prep, setPrep] = useState<PrepareResult | null>(null);
  const [ship, setShip] = useState<IfoodShippingOrder | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState('');
  const [novo, setNovo] = useState(false); // chamar de novo depois de cancelada/sem entregador
  const [conferiu, setConferiu] = useState(false); // resposta incerta: conferiu no iFood antes de chamar de novo

  // Formulário
  const [nome, setNome] = useState('');
  const [ddd, setDdd] = useState('');
  const [fone, setFone] = useState('');
  const [end, setEnd] = useState<PrepareResult['address'] | null>(null);
  const [pay, setPay] = useState<PayKind | ''>('');
  const [troco, setTroco] = useState('');
  const [bandeira, setBandeira] = useState('');
  const [prepMin, setPrepMin] = useState(15);
  const [quote, setQuote] = useState<IfoodQuote | null>(null);

  // Cancelamento
  const [motivos, setMotivos] = useState<{ code: string; description: string }[] | null>(null);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await ifoodShipping<PrepareResult>('prepare', tenantId, { order_id: orderId });
    setCarregando(false);
    if (!r.success) { setErro(r.error || 'Não foi possível abrir o pedido.'); return; }
    setPrep(r);
    setShip(r.shipping);
    setNome(r.customer.name); setDdd(r.customer.area_code); setFone(r.customer.number);
    setEnd(r.address);
    setPay(r.payment.kind === 'unknown' ? '' : r.payment.kind);
    if (r.payment.changeFor) setTroco(String(r.payment.changeFor).replace('.', ','));
    setPrepMin(r.prep_min);
  }, [tenantId, orderId]);
  useEffect(() => { carregar(); }, [carregar]);

  // Acompanhamento: a linha é atualizada pelo polling do servidor (30 s); relê a cada 10 s.
  const ativo = !!ship && SHIPPING_ATIVOS.includes(ship.status);
  useEffect(() => {
    if (!ativo) return;
    const id = setInterval(async () => {
      const m = await fetchShippingByOrder(tenantId, [orderId]);
      if (m[orderId]) setShip(m[orderId]);
    }, 10000);
    return () => clearInterval(id);
  }, [ativo, tenantId, orderId]);

  const setE = (k: keyof PrepareResult['address'], v: string) => { setEnd((e) => (e ? { ...e, [k]: v } : e)); setQuote(null); };

  const cotar = async () => {
    if (!end) return;
    setErro(''); setBusy('quote');
    const r = await ifoodShipping<{ quote: IfoodQuote }>('quote', tenantId, { order_id: orderId, lat: end.lat, lng: end.lng });
    setBusy('');
    if (!r.success) { setErro(r.error || 'Cotação recusada.'); setQuote(null); return; }
    setQuote(r.quote);
    const cartoes = (r.quote.paymentMethods ?? []).filter((m) => m.brand);
    if (!bandeira && cartoes[0]?.brand) setBandeira(cartoes[0].brand);
  };

  const chamar = async () => {
    if (!quote || !end || !pay) return;
    setErro(''); setBusy('create');
    const r = await ifoodShipping<{ shipping: IfoodShippingOrder }>('create', tenantId, {
      order_id: orderId, quote_id: quote.id, quote,
      customer: { name: nome, area_code: ddd, number: fone },
      address: end,
      payment: { kind: pay, change_for: Number(troco.replace(/\./g, '').replace(',', '.')) || null, brand: bandeira },
      prep_min: prepMin,
    });
    setBusy('');
    if (!r.success) {
      setErro(r.error || 'O iFood recusou o pedido.');
      // Resposta incerta: volta para o acompanhamento, que exige conferir no iFood antes de tentar de novo.
      if ((r as { uncertain?: boolean }).uncertain) { const m = await fetchShippingByOrder(tenantId, [orderId]); if (m[orderId]) setShip(m[orderId]); setNovo(false); setConferiu(false); }
      return;
    }
    setShip(r.shipping); setNovo(false); setQuote(null); setConferiu(false);
    onChanged();
  };

  const abrirCancelar = async () => {
    if (!ship) return;
    setErro(''); setBusy('reasons');
    const r = await ifoodShipping<{ reasons: { code: string; description: string }[]; can_cancel: boolean }>('cancel_reasons', tenantId, { shipping_id: ship.id });
    setBusy('');
    if (!r.success) { setErro(r.error || 'Não consegui buscar os motivos.'); return; }
    if (!r.can_cancel || r.reasons.length === 0) { setErro('O iFood não permite mais cancelar esta entrega.'); return; }
    setMotivos(r.reasons); setMotivo('');
  };

  const cancelar = async () => {
    if (!ship || !motivo) return;
    const m = motivos?.find((x) => x.code === motivo);
    setErro(''); setBusy('cancel');
    const r = await ifoodShipping('cancel', tenantId, { shipping_id: ship.id, code: motivo, reason: m?.description ?? 'Cancelado pela loja' });
    setBusy('');
    if (!r.success) { setErro(r.error || 'Não consegui cancelar.'); return; }
    setMotivos(null);
    setShip({ ...ship, status: 'cancel_requested' });
    onChanged();
  };

  const responderEndereco = async (accept: boolean) => {
    if (!ship) return;
    setErro(''); setBusy('addr');
    const r = await ifoodShipping('address_change', tenantId, { shipping_id: ship.id, accept });
    setBusy('');
    if (!r.success) { setErro(r.error || 'Não consegui responder.'); return; }
    setShip({ ...ship, address_change: null, address_change_deadline: null });
  };

  const atualizar = async () => {
    setBusy('poll');
    await ifoodShipping('poll', tenantId);
    const m = await fetchShippingByOrder(tenantId, [orderId]);
    if (m[orderId]) setShip(m[orderId]);
    setBusy('');
    onChanged();
  };

  const mostrarForm = !carregando && prep && (!ship || novo);
  const cartoes = [...new Set((quote?.paymentMethods ?? []).filter((m) => m.brand).map((m) => m.brand as string))];
  const aceitaDinheiro = !quote || (quote.paymentMethods ?? []).some((m) => m.method === 'CASH') || quote.hasPaymentMethods === undefined;
  const semPino = !!end && (end.lat == null || end.lng == null);

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-zinc-100">
          <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg shrink-0">
            <i className="ri-e-bike-2-fill text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-zinc-800">iFood Entrega</h4>
            <p className="text-xs text-zinc-500 truncate">{prep ? `Pedido ${prep.order.number} · ${fmtMoeda(prep.order.total)}` : 'Entregador do iFood para este pedido'}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100" title="Fechar">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {carregando && <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>}

          {!carregando && prep && !prep.ready && (!ship || novo) && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              O iFood Entrega ainda não está ligado nesta loja. Um gerente configura em <b>iFood Entrega</b>, no topo do Gestor de Entregas.
            </div>
          )}

          {/* ── Acompanhamento ── */}
          {!carregando && ship && !novo && (
            <div className="space-y-3">
              <div className={`p-3 rounded-xl border ${ship.status === 'concluded' ? 'bg-emerald-50 border-emerald-200' : ['cancelled', 'failed'].includes(ship.status) ? 'bg-zinc-50 border-zinc-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center gap-2">
                  {ativo && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                  <span className="text-sm font-bold text-zinc-800">{SHIPPING_LABEL[ship.status]}</span>
                </div>
                {ship.driver?.name && (
                  <p className="text-xs text-zinc-600 mt-1">
                    <i className="ri-user-line" /> {ship.driver.name}{ship.driver.vehicle ? ` · ${ship.driver.vehicle}` : ''}
                    {ship.driver.phone && <a href={`tel:${ship.driver.phone}`} className="ml-2 font-bold text-red-600">Ligar</a>}
                  </p>
                )}
                {ship.cancel_reason && ['cancelled', 'failed', 'cancel_requested'].includes(ship.status) && <p className="text-xs text-zinc-500 mt-1">Motivo: {ship.cancel_reason}</p>}
                {ship.error && <p className="text-xs text-amber-700 mt-1">{ship.error}</p>}
                {ship.ifood_fee != null && <p className="text-[11px] text-zinc-400 mt-1">Custo iFood: {fmtMoeda(ship.ifood_fee)} · taxa cobrada do cliente: {fmtMoeda(ship.merchant_fee ?? 0)}</p>}
              </div>

              {ship.pickup_code && ativo && (
                <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                  <p className="text-[11px] font-semibold text-zinc-500">Código de coleta — confira com o entregador antes de entregar a sacola</p>
                  <p className="text-2xl font-black tracking-widest text-zinc-800">{ship.pickup_code}</p>
                </div>
              )}

              {ativo && (
                <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900">
                  <b>Código de entrega:</b> o entregador vai pedir ao cliente{' '}
                  {ship.drop_code ? <span className="font-black text-base tracking-widest">{ship.drop_code}</span> : 'os 4 últimos dígitos do telefone dele'}.
                  Avise o cliente para ter o código em mãos.
                </div>
              )}

              {ship.address_change && ativo && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
                  <p className="text-xs font-bold text-amber-800"><i className="ri-map-pin-line" /> O cliente pediu para trocar o endereço</p>
                  <p className="text-xs text-amber-900">{endTexto(ship.address_change)}</p>
                  {ship.address_change_deadline && <p className="text-[11px] text-amber-700">Responda até {new Date(ship.address_change_deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — depois o iFood recusa sozinho.</p>}
                  <div className="flex gap-2">
                    <button disabled={!!busy} onClick={() => responderEndereco(false)} className="flex-1 py-2 rounded-lg bg-white border border-amber-300 text-amber-800 text-xs font-bold disabled:opacity-50">Recusar</button>
                    <button disabled={!!busy} onClick={() => responderEndereco(true)} className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold disabled:opacity-50">Aceitar novo endereço</button>
                  </div>
                </div>
              )}

              {ship.tracking_url && ativo && (
                <div className="flex gap-2">
                  <a href={ship.tracking_url} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-xs font-bold hover:bg-zinc-200">
                    <i className="ri-map-2-line" /> Rastreio
                  </a>
                  {telefone && (
                    <a href={`https://wa.me/${waNumero(telefone)}?text=${encodeURIComponent('Seu pedido vai com um entregador do iFood. Acompanhe aqui: ' + ship.tracking_url + ' — ele vai pedir os 4 últimos dígitos do seu telefone na entrega.')}`}
                      target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-green-50 text-green-700 text-xs font-bold hover:bg-green-100">
                      <i className="ri-whatsapp-line" /> Enviar ao cliente
                    </a>
                  )}
                </div>
              )}

              {motivos && (
                <div className="p-3 rounded-xl border border-zinc-200 space-y-2">
                  <p className="text-xs font-bold text-zinc-700">Motivo do cancelamento</p>
                  <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inp}>
                    <option value="">Escolha…</option>
                    {motivos.map((m) => <option key={m.code} value={m.code}>{m.description}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => setMotivos(null)} className="flex-1 py-2 rounded-lg bg-zinc-100 text-zinc-600 text-xs font-semibold">Voltar</button>
                    <button disabled={!motivo || !!busy} onClick={cancelar} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50">
                      {busy === 'cancel' ? 'Cancelando…' : 'Cancelar entrega'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button disabled={!!busy} onClick={atualizar} className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-zinc-200 text-zinc-600 text-xs font-semibold disabled:opacity-50">
                  <i className={'ri-refresh-line' + (busy === 'poll' ? ' animate-spin' : '')} /> Atualizar
                </button>
                {ativo && ship.status !== 'cancel_requested' && !motivos && (
                  <button disabled={!!busy} onClick={abrirCancelar} className="flex-1 py-2 rounded-lg bg-white border border-red-200 text-red-600 text-xs font-bold disabled:opacity-50">
                    {busy === 'reasons' ? 'Buscando motivos…' : 'Cancelar entrega iFood'}
                  </button>
                )}
                {['cancelled', 'failed'].includes(ship.status) && prep && !['delivered', 'cancelled'].includes(prep.order.status) && (
                  <button disabled={!!ship.uncertain && !conferiu} onClick={() => { setNovo(true); setQuote(null); }}
                    className="flex-1 py-2 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-40">Chamar de novo</button>
                )}
              </div>
              {ship.uncertain && ['cancelled', 'failed'].includes(ship.status) && (
                <label className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 cursor-pointer">
                  <input type="checkbox" checked={conferiu} onChange={(e) => setConferiu(e.target.checked)} className="mt-0.5" />
                  Conferi no Gestor de Pedidos do iFood que nenhum entregador está vindo para este pedido.
                </label>
              )}
            </div>
          )}

          {/* ── Formulário ── */}
          {mostrarForm && end && (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_56px_1fr] gap-2">
                <div><label className={lbl}>Cliente</label><input className={inp} value={nome} maxLength={50} onChange={(e) => setNome(e.target.value)} /></div>
                <div><label className={lbl}>DDD</label><input className={inp} value={ddd} inputMode="numeric" maxLength={2} onChange={(e) => setDdd(e.target.value.replace(/\D/g, ''))} /></div>
                <div><label className={lbl}>Telefone</label><input className={inp} value={fone} inputMode="numeric" maxLength={9} onChange={(e) => setFone(e.target.value.replace(/\D/g, ''))} /></div>
              </div>
              <p className="text-[11px] text-zinc-400 -mt-2">O entregador pede ao cliente os 4 últimos dígitos deste telefone.</p>

              <div className="grid grid-cols-[1fr_80px] gap-2">
                <div><label className={lbl}>Rua</label><input className={inp} value={end.street_name} maxLength={50} onChange={(e) => setE('street_name', e.target.value)} /></div>
                <div><label className={lbl}>Número</label><input className={inp} value={end.street_number} maxLength={10} onChange={(e) => setE('street_number', e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={lbl}>Complemento</label><input className={inp} value={end.complement} maxLength={50} onChange={(e) => setE('complement', e.target.value)} /></div>
                <div><label className={lbl}>Bairro</label><input className={inp} value={end.neighborhood} maxLength={50} onChange={(e) => setE('neighborhood', e.target.value)} /></div>
              </div>
              <div><label className={lbl}>Referência</label><input className={inp} value={end.reference} maxLength={70} onChange={(e) => setE('reference', e.target.value)} /></div>
              <div className="grid grid-cols-[110px_1fr_56px] gap-2">
                <div><label className={lbl}>CEP</label><input className={inp} value={end.postal_code} inputMode="numeric" maxLength={9} placeholder="00000000" onChange={(e) => setE('postal_code', e.target.value.replace(/\D/g, ''))} /></div>
                <div><label className={lbl}>Cidade</label><input className={inp} value={end.city} maxLength={50} onChange={(e) => setE('city', e.target.value)} /></div>
                <div><label className={lbl}>UF</label><input className={inp} value={end.state} maxLength={2} onChange={(e) => setE('state', e.target.value.toUpperCase())} /></div>
              </div>
              {prep && <p className="text-[11px] text-zinc-400">No pedido: {prep.order.address_text || '—'}</p>}
              {semPino && <p className="text-xs text-red-600">Este pedido não tem a localização (pino) do cliente — o iFood exige as coordenadas.</p>}

              <div>
                <label className={lbl}>Como o cliente paga</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {([['paid', 'Já pago'], ['CASH', 'Dinheiro'], ['CREDIT', 'Crédito'], ['DEBIT', 'Débito']] as [PayKind, string][]).map(([k, t]) => (
                    <button key={k} type="button" onClick={() => setPay(k)} disabled={k === 'CASH' && !aceitaDinheiro}
                      className={`py-2 rounded-lg text-xs font-bold border disabled:opacity-40 ${pay === k ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-600 border-zinc-200'}`}>{t}</button>
                  ))}
                </div>
                {prep?.payment.kind === 'unknown' && <p className="text-[11px] text-amber-700 mt-1">Não reconheci a forma de pagamento do pedido{prep.payment.label ? ` ("${prep.payment.label}")` : ''} — escolha acima.</p>}
                {pay && pay !== 'paid' && <p className="text-[11px] text-zinc-500 mt-1">O entregador do iFood cobra {fmtMoeda(prep?.order.total ?? 0)} na entrega (o valor entra no repasse do iFood).</p>}
                {pay === 'CASH' && (
                  <div className="mt-2 w-40"><label className={lbl}>Troco para (opcional)</label><input className={inp} value={troco} inputMode="decimal" placeholder="0,00" onChange={(e) => setTroco(e.target.value)} /></div>
                )}
                {(pay === 'CREDIT' || pay === 'DEBIT') && (
                  <div className="mt-2"><label className={lbl}>Bandeira</label>
                    {cartoes.length > 0 ? (
                      <select className={inp} value={bandeira} onChange={(e) => setBandeira(e.target.value)}>
                        {cartoes.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    ) : <input className={inp} value={bandeira} placeholder="Faça a cotação para ver as bandeiras" onChange={(e) => setBandeira(e.target.value)} />}
                  </div>
                )}
              </div>

              <div className="w-48">
                <label className={lbl}>Tempo de preparo (min)</label>
                <input className={inp} type="number" min={0} max={120} value={prepMin} onChange={(e) => setPrepMin(Number(e.target.value) || 0)} />
                <p className="text-[11px] text-zinc-400 mt-0.5">O iFood manda o entregador depois disso.</p>
              </div>

              {quote && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-0.5">
                  <p className="text-sm font-black">{fmtMoeda(quote.quote.netValue)} <span className="text-xs font-semibold text-emerald-700">custo do iFood</span></p>
                  <p>{(quote.distance / 1000).toFixed(1).replace('.', ',')} km · entrega em {fmtMin(quote.deliveryTime.min)}–{fmtMin(quote.deliveryTime.max)} min</p>
                  {prep && <p className="text-emerald-700">Taxa cobrada do cliente neste pedido: {fmtMoeda(prep.order.delivery_fee)}</p>}
                </div>
              )}
            </div>
          )}

          {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{erro}</p>}
        </div>

        {mostrarForm && (
          <div className="flex gap-2 px-5 py-3 border-t border-zinc-100">
            {novo && <button onClick={() => setNovo(false)} className="px-4 py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-semibold">Voltar</button>}
            {!quote ? (
              <button disabled={!!busy || semPino || !prep?.ready} onClick={cotar}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-white text-sm font-bold disabled:opacity-50">
                {busy === 'quote' ? 'Consultando…' : 'Ver preço e prazo'}
              </button>
            ) : (
              <button disabled={!!busy || !pay} onClick={chamar}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50">
                {busy === 'create' ? 'Chamando…' : `Chamar entregador · ${fmtMoeda(quote.quote.netValue)}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function endTexto(m: Record<string, unknown>): string {
  const g = (k: string) => String(m[k] ?? m[k.toUpperCase()] ?? '').trim();
  const partes = [[g('streetName'), g('streetNumber')].filter(Boolean).join(', '), g('complement'), g('neighborhood'), g('reference') && `Ref: ${g('reference')}`].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'Novo endereço (detalhes no rastreio do iFood).';
}
