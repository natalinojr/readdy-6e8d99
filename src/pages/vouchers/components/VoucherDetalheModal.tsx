import { useState, useEffect } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import type { Voucher, VoucherTransaction } from '@/types/vouchers';

interface Props {
  voucher: Voucher;
  onClose: () => void;
  onCancelled: () => void;
}

const TX_TYPE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  issued: { label: 'Emissão', color: 'text-green-600', icon: 'ri-add-circle-line' },
  redeemed: { label: 'Uso', color: 'text-red-600', icon: 'ri-subtract-line' },
  refunded: { label: 'Estorno', color: 'text-amber-600', icon: 'ri-arrow-go-back-line' },
  expired: { label: 'Expirado', color: 'text-zinc-400', icon: 'ri-time-line' },
  cancelled: { label: 'Cancelado', color: 'text-zinc-400', icon: 'ri-close-circle-line' },
};

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function VoucherDetalheModal({ voucher, onClose, onCancelled }: Props) {
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();
  const [transactions, setTransactions] = useState<VoucherTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    loadTransactions();
  }, [voucher.id]);

  async function loadTransactions() {
    setLoading(true);
    try {
      const { data } = await invokeWithAuth('voucher-write', {
        body: { action: 'get_voucher_transactions', voucher_id: voucher.id, active_tenant_id: user?.tenantId },
      });
      setTransactions(((data as { data?: VoucherTransaction[] })?.data ?? []) as VoucherTransaction[]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm(`Cancelar o voucher ${voucher.code}?`)) return;
    setCancelling(true);
    try {
      await invokeWithAuth('voucher-write', {
        body: { action: 'cancel_voucher', voucher_id: voucher.id, active_tenant_id: user?.tenantId },
      });
      registrarEvento({
        tipo: 'pedido_cancelado',
        severidade: 'aviso',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? '—',
        descricao: `Voucher ${voucher.code} cancelado manualmente`,
        entidade: 'Voucher',
        entidadeId: voucher.code,
      });
      onCancelled();
    } finally {
      setCancelling(false);
    }
  }

  const isGiftOrCashback = ['gift_card', 'cashback'].includes(voucher.voucher_type);
  const balancePercent = isGiftOrCashback && voucher.original_amount > 0
    ? (voucher.current_balance / voucher.original_amount) * 100
    : 0;

  const claimLink = voucher.claim_token ? `${window.location.origin}/voucher/${voucher.claim_token}` : null;
  const [linkCopiado, setLinkCopiado] = useState(false);
  function copiarLink() {
    if (!claimLink) return;
    navigator.clipboard.writeText(claimLink).then(() => {
      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <p className="text-xs text-zinc-400 font-medium mb-0.5">Voucher</p>
            <h2 className="text-lg font-black text-zinc-900 font-mono tracking-wider">{voucher.code}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Info principal */}
          <div className="bg-zinc-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-400">Tipo</p>
                <p className="text-sm font-semibold text-zinc-700 capitalize">{voucher.voucher_type.replace('_', ' ')}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-400">Status</p>
                <span className={`text-sm font-bold ${voucher.status === 'active' ? 'text-green-600' : voucher.status === 'expired' ? 'text-red-500' : 'text-zinc-400'}`}>
                  {voucher.status === 'active' ? 'Ativo' : voucher.status === 'depleted' ? 'Esgotado' : voucher.status === 'expired' ? 'Expirado' : 'Cancelado'}
                </span>
              </div>
            </div>

            {isGiftOrCashback && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-zinc-400">Saldo disponível</p>
                  <p className="text-xs text-zinc-400">de {formatCurrency(voucher.original_amount)}</p>
                </div>
                <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${balancePercent}%` }}
                  />
                </div>
                <p className="text-xl font-black text-green-600 mt-1">{formatCurrency(voucher.current_balance)}</p>
              </div>
            )}

            {voucher.voucher_type === 'discount' && (
              <div>
                <p className="text-xs text-zinc-400">Desconto</p>
                <p className="text-xl font-black text-amber-600">
                  {voucher.discount_type === 'percent' ? `${voucher.discount_value}%` : formatCurrency(voucher.discount_value ?? 0)}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-200">
              <div>
                <p className="text-xs text-zinc-400">Emitido em</p>
                <p className="text-xs font-semibold text-zinc-600">{formatDate(voucher.issued_at)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Validade</p>
                <p className="text-xs font-semibold text-zinc-600">
                  {voucher.valid_from ? `${formatDate(voucher.valid_from)} → ` : ''}
                  {voucher.expires_at ? formatDate(voucher.expires_at) : 'Sem validade'}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Usos</p>
                <p className="text-xs font-semibold text-zinc-600">
                  {voucher.use_count ?? 0}{(voucher.max_uses ?? 1) > 1 ? ` de ${voucher.max_uses}` : (voucher.use_count ?? 0) > 0 ? '' : ' (uso único)'}
                </p>
              </div>
              {(voucher.min_order_amount ?? 0) > 0 && (
                <div>
                  <p className="text-xs text-zinc-400">Pedido mínimo</p>
                  <p className="text-xs font-semibold text-zinc-600">{formatCurrency(voucher.min_order_amount ?? 0)}</p>
                </div>
              )}
              {voucher.claim_token && (
                <div>
                  <p className="text-xs text-zinc-400">Link de ativação</p>
                  {voucher.claimed_at ? (
                    <p className="text-xs font-semibold text-emerald-600">
                      Aberto em {formatDate(voucher.claimed_at)}
                      {(voucher.claim_count ?? 0) > 1 ? ` (${voucher.claim_count} visualizações)` : ''}
                    </p>
                  ) : (
                    <p className="text-xs font-semibold text-zinc-400">Ainda não aberto pelo cliente</p>
                  )}
                </div>
              )}
              {voucher.customer_name && (
                <div className="col-span-2">
                  <p className="text-xs text-zinc-400">Cliente</p>
                  <p className="text-xs font-semibold text-zinc-600">{voucher.customer_name}</p>
                  {voucher.customer_email && <p className="text-[10px] text-zinc-400">{voucher.customer_email}</p>}
                </div>
              )}
              {voucher.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-zinc-400">Observações</p>
                  <p className="text-xs text-zinc-500 italic">{voucher.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Link de ativação */}
          {claimLink && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-0.5">Link de ativação</p>
                  <p className="text-[11px] text-amber-800/80 font-mono break-all">{claimLink}</p>
                </div>
                <button
                  onClick={copiarLink}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white border border-amber-300 rounded-lg text-xs font-bold text-amber-700 hover:bg-amber-100 cursor-pointer transition-colors"
                >
                  <i className={`${linkCopiado ? 'ri-check-line text-emerald-600' : 'ri-file-copy-line'}`} />
                  {linkCopiado ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>
          )}

          {/* Histórico de transações */}
          <div>
            <p className="text-xs font-semibold text-zinc-600 mb-3">Histórico de transações</p>
            {loading ? (
              <div className="flex items-center justify-center h-20">
                <div className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-4">Nenhuma transação registrada</p>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => {
                  const cfg = TX_TYPE_LABELS[tx.transaction_type] ?? { label: tx.transaction_type, color: 'text-zinc-500', icon: 'ri-exchange-line' };
                  return (
                    <div key={tx.id} className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 flex items-center justify-center rounded-full bg-white ${cfg.color}`}>
                          <i className={`${cfg.icon} text-sm`} />
                        </div>
                        <div>
                          <p className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</p>
                          <p className="text-[10px] text-zinc-400">{formatDate(tx.created_at)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${tx.transaction_type === 'redeemed' ? 'text-red-600' : 'text-green-600'}`}>
                          {tx.transaction_type === 'redeemed' ? '-' : '+'}{formatCurrency(Math.abs(tx.amount))}
                        </p>
                        <p className="text-[10px] text-zinc-400">Saldo: {formatCurrency(tx.balance_after)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {voucher.status === 'active' && (
          <div className="px-6 py-4 border-t border-zinc-100 flex-shrink-0">
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 cursor-pointer transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {cancelling ? (
                <><div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /> Cancelando...</>
              ) : (
                <><i className="ri-close-circle-line" /> Cancelar este voucher</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
