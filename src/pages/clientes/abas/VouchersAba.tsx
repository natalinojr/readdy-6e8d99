// Aba Vouchers & Gift Cards de Clientes & Marketing.
//
// Carrega TODOS os vouchers da loja uma vez e filtra na tela: antes o filtro ia
// para o servidor e os números do topo ("Ativos", "Expirados"…) passavam a contar
// só o que estava filtrado — com "Expirados" selecionado, "Ativos" mostrava 0.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Voucher, VoucherStatus, VoucherType } from '@/types/vouchers';
import EmitirVoucherModal from '@/pages/vouchers/components/EmitirVoucherModal';
import VoucherDetalheModal from '@/pages/vouchers/components/VoucherDetalheModal';
import { confirmar } from '@/components/base/Dialogos';

const TYPE_LABELS: Record<VoucherType, { label: string; icon: string; color: string }> = {
  gift_card: { label: 'Gift Card', icon: 'ri-gift-line', color: 'text-rose-600 bg-rose-50' },
  discount: { label: 'Desconto', icon: 'ri-discount-percent-line', color: 'text-amber-600 bg-amber-50' },
  free_item: { label: 'Item Grátis', icon: 'ri-restaurant-line', color: 'text-green-600 bg-green-50' },
  cashback: { label: 'Cashback', icon: 'ri-refund-2-line', color: 'text-zinc-600 bg-zinc-100' },
};

const STATUS_CONFIG: Record<VoucherStatus, { label: string; bg: string; text: string }> = {
  active: { label: 'Ativo', bg: 'bg-green-100', text: 'text-green-700' },
  depleted: { label: 'Usado', bg: 'bg-zinc-100', text: 'text-zinc-500' },
  expired: { label: 'Expirado', bg: 'bg-red-100', text: 'text-red-600' },
  cancelled: { label: 'Cancelado', bg: 'bg-zinc-100', text: 'text-zinc-400' },
};

// Atalhos do topo: cada um é um filtro de "o que fazer agora".
type Atalho = 'todos' | 'ativos' | 'vencendo' | 'nao_abertos' | 'usados' | 'encerrados';

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** O status gravado só vira 'expired' quando alguém mexe no voucher; aqui a data manda. */
function statusEfetivo(v: Voucher): VoucherStatus {
  if (v.status === 'active' && v.expires_at && new Date(v.expires_at).getTime() < Date.now()) return 'expired';
  return v.status;
}

function diasParaVencer(v: Voucher): number | null {
  if (!v.expires_at) return null;
  return Math.ceil((new Date(v.expires_at).getTime() - Date.now()) / 86400000);
}

function valorDoVoucher(v: Voucher): string {
  return v.voucher_type === 'discount' && v.discount_type === 'percent'
    ? `${v.discount_value}%`
    : formatCurrency(v.original_amount);
}

export default function VouchersAba() {
  const { user } = useAuth();
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [atalho, setAtalho] = useState<Atalho>('ativos');
  const [filterType, setFilterType] = useState<VoucherType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [emitirOpen, setEmitirOpen] = useState(false);
  const [detalheVoucher, setDetalheVoucher] = useState<Voucher | null>(null);
  const [linkCopiadoId, setLinkCopiadoId] = useState<string | null>(null);

  function copiarLink(v: Voucher) {
    if (!v.claim_token) return;
    navigator.clipboard.writeText(`${window.location.origin}/voucher/${v.claim_token}`).then(() => {
      setLinkCopiadoId(v.id);
      setTimeout(() => setLinkCopiadoId(null), 2000);
    });
  }

  const loadVouchers = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setErro('');
    try {
      // Via Edge Function (service role) com active_tenant_id explícito — leitura direta
      // em `vouchers` é não-confiável p/ admin multi-loja (RLS usa auth_tenant_id() =
      // última membership). Mesmo padrão do config-delivery.
      const { data, error } = await invokeWithAuth('voucher-write', {
        body: { action: 'list_vouchers', active_tenant_id: user.tenantId },
      });
      if (error) { setErro(error.message); return; }
      setVouchers(((data as { data?: Voucher[] } | null)?.data ?? []) as Voucher[]);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { loadVouchers(); }, [loadVouchers]);

  async function cancelVoucher(v: Voucher) {
    if (!(await confirmar({ titulo: `Cancelar o voucher ${v.code}?`, confirmarLabel: 'Cancelar voucher', perigo: true }))) return;
    const { error } = await invokeWithAuth('voucher-write', {
      body: { action: 'cancel_voucher', voucher_id: v.id, active_tenant_id: user?.tenantId },
    });
    if (error) { setErro(error.message); return; }
    await loadVouchers();
  }

  const stats = useMemo(() => {
    const ativos = vouchers.filter((v) => statusEfetivo(v) === 'active');
    return {
      ativos: ativos.length,
      saldoGC: ativos.filter((v) => v.voucher_type === 'gift_card' || v.voucher_type === 'cashback').reduce((s, v) => s + v.current_balance, 0),
      vencendo: ativos.filter((v) => { const d = diasParaVencer(v); return d != null && d <= 7; }).length,
      naoAbertos: ativos.filter((v) => !!v.claim_token && !v.claimed_at).length,
      usados: vouchers.filter((v) => (v.use_count ?? 0) > 0 || v.status === 'depleted').length,
      encerrados: vouchers.filter((v) => ['expired', 'cancelled'].includes(statusEfetivo(v))).length,
    };
  }, [vouchers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vouchers.filter((v) => {
      const st = statusEfetivo(v);
      if (filterType !== 'all' && v.voucher_type !== filterType) return false;
      switch (atalho) {
        case 'ativos': if (st !== 'active') return false; break;
        case 'vencendo': { const d = diasParaVencer(v); if (st !== 'active' || d == null || d > 7) return false; break; }
        case 'nao_abertos': if (st !== 'active' || !v.claim_token || v.claimed_at) return false; break;
        case 'usados': if (!((v.use_count ?? 0) > 0 || v.status === 'depleted')) return false; break;
        case 'encerrados': if (!['expired', 'cancelled'].includes(st)) return false; break;
      }
      if (!q) return true;
      return (
        v.code.toLowerCase().includes(q) ||
        (v.customer_name ?? '').toLowerCase().includes(q) ||
        (v.customer_email ?? '').toLowerCase().includes(q)
      );
    });
  }, [vouchers, atalho, filterType, search]);

  const cards: { id: Atalho; label: string; value: string; icon: string; color: string; hint: string }[] = [
    { id: 'ativos', label: 'Ativos', value: String(stats.ativos), icon: 'ri-checkbox-circle-line', color: 'text-green-600 bg-green-50', hint: 'Podem ser usados agora' },
    { id: 'vencendo', label: 'Vencem em 7 dias', value: String(stats.vencendo), icon: 'ri-timer-line', color: 'text-amber-600 bg-amber-50', hint: 'Bom momento para lembrar o cliente' },
    { id: 'nao_abertos', label: 'Link não aberto', value: String(stats.naoAbertos), icon: 'ri-eye-off-line', color: 'text-sky-600 bg-sky-50', hint: 'O cliente ainda não abriu o link — vale reenviar' },
    { id: 'usados', label: 'Já usados', value: String(stats.usados), icon: 'ri-shopping-bag-3-line', color: 'text-violet-600 bg-violet-50', hint: 'Resgatados pelo menos uma vez' },
    { id: 'encerrados', label: 'Expirados/cancelados', value: String(stats.encerrados), icon: 'ri-close-circle-line', color: 'text-zinc-500 bg-zinc-100', hint: 'Não valem mais' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Atalhos */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 md:gap-3">
        <div className="col-span-2 md:col-span-3 xl:col-span-1 bg-gradient-to-br from-rose-500 to-rose-600 rounded-xl px-4 py-3 text-white">
          <p className="text-[11px] text-rose-100">Saldo em gift cards</p>
          <p className="text-lg font-black leading-tight">{loading ? '—' : formatCurrency(stats.saldoGC)}</p>
          <p className="text-[10px] text-rose-100 mt-0.5">compromisso da loja com clientes</p>
        </div>
        {cards.map((c) => {
          const ativo = atalho === c.id;
          return (
            <button
              key={c.id}
              title={c.hint}
              onClick={() => setAtalho(ativo ? 'todos' : c.id)}
              className={`text-left bg-white border rounded-xl px-3 py-3 flex items-center gap-2.5 cursor-pointer transition-all ${ativo ? 'border-rose-400 ring-2 ring-rose-100' : 'border-zinc-100 hover:border-zinc-300'}`}
            >
              <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${c.color}`}>
                <i className={`${c.icon} text-base`} />
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-zinc-800 leading-tight">{loading ? '—' : c.value}</p>
                <p className="text-[11px] text-zinc-400 leading-tight">{c.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Barra */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-3 flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            type="text"
            placeholder="Código ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-200 rounded-xl bg-white focus:outline-none focus:border-rose-400"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 overflow-x-auto bg-zinc-100 rounded-xl p-1 max-w-full">
            <button onClick={() => setFilterType('all')} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${filterType === 'all' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>Todos os tipos</button>
            {(Object.keys(TYPE_LABELS) as VoucherType[]).map((t) => (
              <button key={t} onClick={() => setFilterType(t)} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${filterType === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                {TYPE_LABELS[t].label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setEmitirOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-add-line" /> Emitir voucher
          </button>
        </div>
      </div>

      {erro && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{erro}</div>}

      {atalho !== 'todos' && !loading && (
        <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
          <span>
            <strong className="text-zinc-700">{filtered.length}</strong> voucher{filtered.length !== 1 ? 's' : ''} · {cards.find((c) => c.id === atalho)?.label}
          </span>
          <button onClick={() => setAtalho('todos')} className="text-rose-600 font-semibold cursor-pointer">Ver todos ({vouchers.length})</button>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-zinc-400 bg-white border border-dashed border-zinc-200 rounded-2xl">
          <i className="ri-gift-line text-4xl mb-2 text-zinc-300" />
          <p className="text-sm font-semibold text-zinc-500">Nenhum voucher encontrado</p>
          <p className="text-xs text-zinc-400 mt-1">
            {vouchers.length === 0 ? 'Emita vouchers e gift cards para seus clientes' : 'Tente outro filtro'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
          {/* Celular: um cartão por voucher — a tabela não cabe em 375px. */}
          <ul className="md:hidden divide-y divide-zinc-50">
            {filtered.map((v) => {
              const typeCfg = TYPE_LABELS[v.voucher_type];
              const st = statusEfetivo(v);
              const statusCfg = STATUS_CONFIG[st];
              const d = diasParaVencer(v);
              const vencendo = st === 'active' && d != null && d <= 7;
              return (
                <li key={v.id} onClick={() => setDetalheVoucher(v)} className="px-4 py-3 cursor-pointer">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-zinc-800 text-sm tracking-wider break-all">{v.code}</span>
                      {v.customer_name && <p className="text-xs text-zinc-600 break-words">{v.customer_name}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-zinc-800">{valorDoVoucher(v)}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusCfg.bg} ${statusCfg.text}`}>{statusCfg.label}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px] text-zinc-400">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold ${typeCfg.color}`}>
                      <i className={`${typeCfg.icon} text-[10px]`} /> {typeCfg.label}
                    </span>
                    {['gift_card', 'cashback'].includes(v.voucher_type) && (
                      <span className={v.current_balance > 0 ? 'text-green-600 font-semibold' : ''}>saldo {formatCurrency(v.current_balance)}</span>
                    )}
                    <span className={vencendo ? 'text-amber-600 font-semibold' : ''}>
                      {v.expires_at ? `vence ${formatDate(v.expires_at)}` : 'sem validade'}
                    </span>
                    {v.claim_token && (
                      <span className={v.claimed_at ? 'text-emerald-600' : ''}>
                        <i className={v.claimed_at ? 'ri-eye-line' : 'ri-eye-off-line'} /> {v.claimed_at ? 'link aberto' : 'link não aberto'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                    {v.claim_token && (
                      <button onClick={() => copiarLink(v)} className="h-8 px-2.5 flex items-center gap-1 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 cursor-pointer">
                        <i className={linkCopiadoId === v.id ? 'ri-check-line text-emerald-500' : 'ri-link'} /> {linkCopiadoId === v.id ? 'Copiado' : 'Copiar link'}
                      </button>
                    )}
                    {st === 'active' && (
                      <button onClick={() => cancelVoucher(v)} className="h-8 px-2.5 flex items-center gap-1 rounded-lg border border-zinc-200 text-xs font-semibold text-red-500 cursor-pointer">
                        <i className="ri-close-circle-line" /> Cancelar
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Código</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Tipo</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Valor</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Saldo / usos</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Validade</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const typeCfg = TYPE_LABELS[v.voucher_type];
                const st = statusEfetivo(v);
                const statusCfg = STATUS_CONFIG[st];
                const d = diasParaVencer(v);
                const vencendo = st === 'active' && d != null && d <= 7;
                return (
                  <tr key={v.id} className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors cursor-pointer" onClick={() => setDetalheVoucher(v)}>
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-zinc-800 text-xs tracking-wider">{v.code}</span>
                      {v.claim_token && (
                        <span
                          className={`block text-[10px] mt-0.5 ${v.claimed_at ? 'text-emerald-600' : 'text-zinc-400'}`}
                          title={v.claimed_at ? `Cliente abriu o link em ${formatDate(v.claimed_at)}` : 'Cliente ainda não abriu o link'}
                        >
                          <i className={`${v.claimed_at ? 'ri-eye-line' : 'ri-eye-off-line'} mr-0.5`} />
                          {v.claimed_at ? 'link aberto' : 'link não aberto'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {v.customer_name ? (
                        <div>
                          <p className="font-semibold text-zinc-700 text-xs">{v.customer_name}</p>
                          <p className="text-[10px] text-zinc-400">emitido {formatDate(v.issued_at)}</p>
                        </div>
                      ) : (
                        <span className="text-zinc-400 text-xs">— <span className="text-[10px]">· {formatDate(v.issued_at)}</span></span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${typeCfg.color}`}>
                        <i className={`${typeCfg.icon} text-[10px]`} />
                        {typeCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-700">{valorDoVoucher(v)}</td>
                    <td className="px-4 py-3 text-right">
                      {['gift_card', 'cashback'].includes(v.voucher_type) ? (
                        <span className={`font-bold ${v.current_balance > 0 ? 'text-green-600' : 'text-zinc-400'}`}>
                          {formatCurrency(v.current_balance)}
                        </span>
                      ) : (
                        <span className="text-zinc-500 text-xs font-semibold">{v.use_count ?? 0}/{v.max_uses ?? 1} usos</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {v.expires_at ? (
                        <span className={`text-xs font-semibold ${vencendo ? 'text-amber-600' : 'text-zinc-500'}`}>
                          {formatDate(v.expires_at)}
                          {vencendo && <span className="block text-[10px] text-amber-500">{d! <= 0 ? 'vence hoje' : `em ${d} dia${d === 1 ? '' : 's'}`}</span>}
                        </span>
                      ) : (
                        <span className="text-zinc-300 text-xs">Sem validade</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusCfg.bg} ${statusCfg.text}`}>
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        {v.claim_token && (
                          <button
                            onClick={() => copiarLink(v)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors"
                            title="Copiar link de ativação"
                          >
                            <i className={`${linkCopiadoId === v.id ? 'ri-check-line text-emerald-500' : 'ri-link'} text-sm`} />
                          </button>
                        )}
                        {st === 'active' && (
                          <button
                            onClick={() => cancelVoucher(v)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                            title="Cancelar voucher"
                          >
                            <i className="ri-close-circle-line text-sm" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {emitirOpen && (
        <EmitirVoucherModal
          onClose={() => setEmitirOpen(false)}
          onSaved={() => { setEmitirOpen(false); loadVouchers(); }}
        />
      )}

      {detalheVoucher && (
        <VoucherDetalheModal
          voucher={detalheVoucher}
          onClose={() => setDetalheVoucher(null)}
          onCancelled={() => { setDetalheVoucher(null); loadVouchers(); }}
        />
      )}
    </div>
  );
}
