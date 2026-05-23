import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Voucher, VoucherStatus, VoucherType } from '@/types/vouchers';
import EmitirVoucherModal from './components/EmitirVoucherModal';
import VoucherDetalheModal from './components/VoucherDetalheModal';

const TYPE_LABELS: Record<VoucherType, { label: string; icon: string; color: string }> = {
  gift_card: { label: 'Gift Card', icon: 'ri-gift-line', color: 'text-rose-600 bg-rose-50' },
  discount: { label: 'Desconto', icon: 'ri-discount-percent-line', color: 'text-amber-600 bg-amber-50' },
  free_item: { label: 'Item Grátis', icon: 'ri-restaurant-line', color: 'text-green-600 bg-green-50' },
  cashback: { label: 'Cashback', icon: 'ri-refund-2-line', color: 'text-zinc-600 bg-zinc-100' },
};

const STATUS_CONFIG: Record<VoucherStatus, { label: string; bg: string; text: string }> = {
  active: { label: 'Ativo', bg: 'bg-green-100', text: 'text-green-700' },
  depleted: { label: 'Esgotado', bg: 'bg-zinc-100', text: 'text-zinc-500' },
  expired: { label: 'Expirado', bg: 'bg-red-100', text: 'text-red-600' },
  cancelled: { label: 'Cancelado', bg: 'bg-zinc-100', text: 'text-zinc-400' },
};

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

export default function VouchersPage() {
  const { user } = useAuth();
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<VoucherStatus | 'all'>('all');
  const [filterType, setFilterType] = useState<VoucherType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [emitirOpen, setEmitirOpen] = useState(false);
  const [detalheVoucher, setDetalheVoucher] = useState<Voucher | null>(null);

  const loadVouchers = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      let query = supabase
        .from('vouchers')
        .select('*')
        .order('created_at', { ascending: false });

      if (filterStatus !== 'all') query = query.eq('status', filterStatus);
      if (filterType !== 'all') query = query.eq('voucher_type', filterType);

      const { data } = await query;
      setVouchers((data ?? []) as Voucher[]);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, filterStatus, filterType]);

  useEffect(() => { loadVouchers(); }, [loadVouchers]);

  async function cancelVoucher(v: Voucher) {
    if (!window.confirm(`Cancelar o voucher ${v.code}?`)) return;
    await supabase.functions.invoke('voucher-write', {
      body: { action: 'cancel_voucher', voucher_id: v.id, active_tenant_id: user?.tenantId },
    });
    await loadVouchers();
  }

  const filtered = vouchers.filter((v) => {
    if (!search) return true;
    return (
      v.code.toLowerCase().includes(search.toLowerCase()) ||
      (v.customer_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (v.customer_email ?? '').toLowerCase().includes(search.toLowerCase())
    );
  });

  const stats = {
    active: vouchers.filter((v) => v.status === 'active').length,
    totalBalance: vouchers.filter((v) => v.status === 'active' && v.voucher_type === 'gift_card').reduce((s, v) => s + v.current_balance, 0),
    issued: vouchers.length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-rose-50 rounded-lg">
              <i className="ri-gift-line text-rose-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Vouchers &amp; Gift Cards</h1>
              <p className="text-xs text-zinc-400">{stats.active} ativos · Saldo em GC: {formatCurrency(stats.totalBalance)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtro tipo */}
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              <button onClick={() => setFilterType('all')} className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${filterType === 'all' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}>Todos</button>
              {(Object.keys(TYPE_LABELS) as VoucherType[]).map((t) => (
                <button key={t} onClick={() => setFilterType(t)} className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${filterType === t ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  {TYPE_LABELS[t].label}
                </button>
              ))}
            </div>

            {/* Filtro status */}
            <div className="flex items-center gap-1">
              {(['all', 'active', 'depleted', 'expired', 'cancelled'] as const).map((s) => {
                const labels: Record<string, string> = { all: 'Todos', active: 'Ativos', depleted: 'Esgotados', expired: 'Expirados', cancelled: 'Cancelados' };
                return (
                  <button key={s} onClick={() => setFilterStatus(s)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterStatus === s ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
                    {labels[s]}
                  </button>
                );
              })}
            </div>

            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                type="text"
                placeholder="Código ou cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-rose-400 w-44"
              />
            </div>

            <button
              onClick={() => setEmitirOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-add-line" />
              Emitir Voucher
            </button>
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total emitidos', value: stats.issued, icon: 'ri-file-list-3-line', color: 'text-zinc-600' },
          { label: 'Ativos', value: stats.active, icon: 'ri-checkbox-circle-line', color: 'text-green-600' },
          { label: 'Saldo em Gift Cards', value: formatCurrency(stats.totalBalance), icon: 'ri-gift-line', color: 'text-rose-600' },
          { label: 'Expirados', value: vouchers.filter((v) => v.status === 'expired').length, icon: 'ri-time-line', color: 'text-red-500' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-zinc-200 p-4">
            <div className={`w-8 h-8 flex items-center justify-center mb-2 ${s.color}`}>
              <i className={`${s.icon} text-xl`} />
            </div>
            <p className="text-xl font-black text-zinc-800">{s.value}</p>
            <p className="text-xs text-zinc-400 font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-400">
            <i className="ri-gift-line text-4xl mb-2 text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-500">Nenhum voucher encontrado</p>
            <p className="text-xs text-zinc-400 mt-1">Emita vouchers e gift cards para seus clientes</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Código</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Tipo</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Cliente</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Valor original</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Saldo atual</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Emissão</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Validade</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => {
                  const typeCfg = TYPE_LABELS[v.voucher_type];
                  const statusCfg = STATUS_CONFIG[v.status];
                  const isExpiringSoon = v.expires_at && v.status === 'active' &&
                    Math.ceil((new Date(v.expires_at).getTime() - Date.now()) / 86400000) <= 7;

                  return (
                    <tr
                      key={v.id}
                      className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors cursor-pointer"
                      onClick={() => setDetalheVoucher(v)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-zinc-800 text-xs tracking-wider">{v.code}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${typeCfg.color}`}>
                          <i className={`${typeCfg.icon} text-[10px]`} />
                          {typeCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {v.customer_name ? (
                          <div>
                            <p className="font-semibold text-zinc-700 text-xs">{v.customer_name}</p>
                            {v.customer_email && <p className="text-[10px] text-zinc-400">{v.customer_email}</p>}
                          </div>
                        ) : (
                          <span className="text-zinc-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-zinc-700">
                        {v.voucher_type === 'discount' && v.discount_type === 'percent'
                          ? `${v.discount_value}%`
                          : formatCurrency(v.original_amount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {['gift_card', 'cashback'].includes(v.voucher_type) ? (
                          <span className={`font-bold ${v.current_balance > 0 ? 'text-green-600' : 'text-zinc-400'}`}>
                            {formatCurrency(v.current_balance)}
                          </span>
                        ) : (
                          <span className="text-zinc-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-zinc-500">{formatDate(v.issued_at)}</td>
                      <td className="px-4 py-3 text-center">
                        {v.expires_at ? (
                          <span className={`text-xs font-semibold ${isExpiringSoon ? 'text-amber-600' : 'text-zinc-500'}`}>
                            {formatDate(v.expires_at)}
                            {isExpiringSoon && <span className="block text-[10px] text-amber-500">Expira em breve!</span>}
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
                        {v.status === 'active' && (
                          <button
                            onClick={() => cancelVoucher(v)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                            title="Cancelar voucher"
                          >
                            <i className="ri-close-circle-line text-sm" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
