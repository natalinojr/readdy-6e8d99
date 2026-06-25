import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

function getDeliveryWriteUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/delivery-write';
}

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_LABEL: Record<string, string> = { new: 'Novo', preparing: 'Em preparo', ready: 'Pronto' };
const SINAL_LABEL: Record<string, string> = {
  a_caminho_loja: 'A caminho da loja', coletou: 'Coletado', entregou: 'Entregue', problema: 'Problema',
};

interface Problema { at: string; text: string; by?: string }

interface OrderRow {
  id: string; number: string; cliente: string; telefone?: string; endereco: string; total: number; taxa: number;
  status: string; motoboy_status: string | null; motoboy_note: string | null;
  problemas?: Problema[];
  driver_id: string | null; driver_nome: string | null;
}

const horaCurta = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

// Telefone só-dígitos → exibição (DD) 9XXXX-XXXX. '' se vazio.
const fmtTelefone = (d: string) => {
  if (!d) return '';
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
};
// Número internacional p/ WhatsApp (assume Brasil: prefixa 55 se vier sem DDI).
const waNumero = (d: string) => (d.length <= 11 ? '55' + d : d);

const FASES: { signal: string; label: string; icon: string }[] = [
  { signal: 'a_caminho_loja', label: 'A caminho', icon: 'ri-store-2-line' },
  { signal: 'coletou', label: 'Coletou', icon: 'ri-shopping-bag-3-line' },
  { signal: 'entregou', label: 'Entregue', icon: 'ri-checkbox-circle-line' },
  { signal: 'problema', label: 'Problema', icon: 'ri-alert-line' },
];

/**
 * Aba "Gerir entregas": a loja muda o status da entrega de qualquer pedido (fallback
 * quando o motoboy não consegue acessar o site / some). Override total (ignora a trava
 * de dono). Vai pela Edge `delivery-write` (admin valida membership da loja).
 */
export default function GerirEntregasTab({ tenantId }: { tenantId?: string }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>(''); // `${orderId}:${signal}`
  const [erro, setErro] = useState('');
  const [modalProblema, setModalProblema] = useState<string | null>(null); // orderId
  const [motivoProblema, setMotivoProblema] = useState('');
  const [modalLiberar, setModalLiberar] = useState<string | null>(null); // orderId

  const token = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }, []);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const t = await token();
      if (!t) { setErro('Sessão expirada.'); setLoading(false); return; }
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ action: 'list_delivery_orders', tenant_id: tenantId }),
      });
      const data = await res.json();
      if (data.ok) { setOrders(data.orders ?? []); setErro(''); }
      else setErro('Não foi possível carregar as entregas.');
    } catch { setErro('Erro de conexão.'); } finally { setLoading(false); }
  }, [tenantId, token]);

  useEffect(() => { carregar(); }, [carregar]);

  const executarStatus = async (orderId: string, signal: string, motivo?: string) => {
    setBusy(`${orderId}:${signal}`);
    try {
      const t = await token();
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ action: 'set_motoboy_status', tenant_id: tenantId, order_id: orderId, signal, motivo }),
      });
      const data = await res.json();
      if (data.ok) await carregar();
      else setErro('Não foi possível atualizar.');
    } catch { setErro('Erro de conexão.'); } finally { setBusy(''); }
  };

  // "Problema" abre o modal pra digitar o motivo; as outras fases vão direto.
  const setStatus = (orderId: string, signal: string) => {
    if (signal === 'problema') { setMotivoProblema(''); setModalProblema(orderId); return; }
    executarStatus(orderId, signal);
  };

  const executarLiberar = async (orderId: string) => {
    setBusy(`${orderId}:liberar`);
    try {
      const t = await token();
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ action: 'clear_motoboy_driver', tenant_id: tenantId, order_id: orderId }),
      });
      const data = await res.json();
      if (data.ok) await carregar();
    } catch { setErro('Erro de conexão.'); } finally { setBusy(''); }
  };

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Gerir entregas</h3>
          <p className="text-xs text-zinc-500">Atualize o status quando o motoboy não conseguir. Vale para qualquer pedido em aberto.</p>
        </div>
        <button type="button" onClick={carregar} disabled={loading}
          className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 disabled:opacity-50">
          <i className={'ri-refresh-line' + (loading ? ' animate-spin' : '')} /> Atualizar
        </button>
      </div>

      {erro ? <p className="text-xs text-red-600">{erro}</p> : null}

      {loading ? (
        <p className="text-xs text-zinc-400">Carregando…</p>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-zinc-100 p-8 text-center">
          <i className="ri-inbox-line text-3xl text-zinc-300" />
          <p className="text-sm font-semibold text-zinc-500 mt-2">Nenhuma entrega em aberto.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.id} className="bg-white rounded-2xl border border-zinc-100 p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-black text-zinc-800">#{String(o.number).replace(/\D/g, '').slice(-4) || o.number}</span>
                <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 text-[10px] font-bold">
                  {o.motoboy_status ? (SINAL_LABEL[o.motoboy_status] ?? o.motoboy_status) : (STATUS_LABEL[o.status] ?? o.status)}
                </span>
              </div>
              <p className="text-sm font-semibold text-zinc-700">{o.cliente}</p>
              <p className="text-xs text-zinc-500 line-clamp-1">{o.endereco || '—'}</p>
              {o.telefone ? (
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-xs text-zinc-500 tabular-nums">{fmtTelefone(o.telefone)}</span>
                  <a href={`tel:+55${o.telefone}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 text-zinc-700 text-[11px] font-bold hover:bg-zinc-200">
                    <i className="ri-phone-line" /> Ligar
                  </a>
                  <a href={`https://wa.me/${waNumero(o.telefone)}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-green-50 text-green-700 text-[11px] font-bold hover:bg-green-100">
                    <i className="ri-whatsapp-line" /> WhatsApp
                  </a>
                </div>
              ) : null}
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-sm font-black text-zinc-800">{fmt(o.total)}</span>
                {o.driver_id ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                    <i className="ri-e-bike-2-line" /> {o.driver_nome || 'entregador'}
                    <button type="button" onClick={() => setModalLiberar(o.id)} disabled={!!busy}
                      className="ml-1 text-[10px] font-bold text-red-500 hover:underline disabled:opacity-50">liberar</button>
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-400">sem entregador</span>
                )}
              </div>
              {(() => {
                // Histórico de problemas relatados (acumula cada relato com sua hora).
                // Fallback p/ pedidos antigos que só têm motoboy_note (antes do histórico).
                const probs = (o.problemas && o.problemas.length > 0)
                  ? o.problemas
                  : (o.motoboy_note ? [{ at: '', text: o.motoboy_note }] : []);
                if (probs.length === 0) return null;
                return (
                  <div className="mt-1.5 space-y-1">
                    {probs.map((p, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[11px] text-red-600">
                        <i className="ri-alert-line shrink-0 mt-0.5" />
                        <span className="leading-snug">
                          {p.at ? <span className="font-bold tabular-nums">{horaCurta(p.at)} · </span> : null}
                          {p.text || 'Problema relatado'}
                          {p.by === 'loja' ? <span className="text-red-400"> (loja)</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div className="grid grid-cols-4 gap-1.5 mt-2.5">
                {FASES.map((f) => {
                  const ativo = o.motoboy_status === f.signal;
                  const carregandoBtn = busy === `${o.id}:${f.signal}`;
                  return (
                    <button key={f.signal} type="button" onClick={() => setStatus(o.id, f.signal)} disabled={!!busy}
                      className={'flex flex-col items-center gap-0.5 py-2 rounded-xl text-[10px] font-bold transition-colors disabled:opacity-50 ' +
                        (ativo ? 'bg-amber-500 text-white' : f.signal === 'problema' ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200')}>
                      <i className={(carregandoBtn ? 'ri-loader-4-line animate-spin' : f.icon) + ' text-sm'} />
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: motivo do problema */}
      {modalProblema ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => setModalProblema(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg shrink-0">
                <i className="ri-alert-line text-red-600" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-zinc-800">Problema na entrega</h4>
                <p className="text-xs text-zinc-500">Descreva o que aconteceu — fica registrado no pedido.</p>
              </div>
            </div>
            <textarea
              value={motivoProblema}
              onChange={(e) => setMotivoProblema(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Ex.: cliente ausente, endereço não encontrado, motoboy sem acesso…"
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 focus:border-red-400 outline-none text-sm resize-none"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setModalProblema(null)}
                className="flex-1 py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-semibold hover:bg-zinc-200">Cancelar</button>
              <button type="button" disabled={!motivoProblema.trim() || !!busy}
                onClick={() => { const id = modalProblema; setModalProblema(null); executarStatus(id, 'problema', motivoProblema.trim()); }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50">Registrar problema</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal: confirmar liberar entregador */}
      {modalLiberar ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => setModalLiberar(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg shrink-0">
                <i className="ri-e-bike-2-line text-amber-600" />
              </div>
              <h4 className="text-sm font-bold text-zinc-800">Liberar entregador</h4>
            </div>
            <p className="text-sm text-zinc-600">Tira este pedido do entregador atual e <strong>volta uma fase</strong> da entrega. Ele fica disponível para o próximo entregador assumir.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setModalLiberar(null)}
                className="flex-1 py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-semibold hover:bg-zinc-200">Cancelar</button>
              <button type="button" disabled={!!busy}
                onClick={() => { const id = modalLiberar; setModalLiberar(null); executarLiberar(id); }}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50">Liberar</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
