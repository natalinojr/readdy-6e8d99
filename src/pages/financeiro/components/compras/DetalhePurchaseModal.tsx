import { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { SUPABASE_URL } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import type { Purchase } from '@/types/financeiro';

interface BillInstallment {
  id: string;
  installment_number: number;
  installments: number;
  amount: number;
  due_date: string;
  status: string;
  paid_date?: string;
  paid_amount?: number;
}

const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  partial: 'bg-sky-100 text-sky-700',
};
const STATUS_LABEL: Record<string, string> = {
  paid: 'Pago', pending: 'A Pagar', partial: 'Parcelado',
};
const BILL_STATUS_BADGE: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  partial: 'bg-sky-100 text-sky-700',
};
const BILL_STATUS_LABEL: Record<string, string> = {
  paid: 'Pago', pending: 'Pendente', overdue: 'Vencido', partial: 'Parcial',
};

interface Props {
  purchase: Purchase;
  installments: BillInstallment[];
  loadingInstallments: boolean;
  onClose: () => void;
  onDeliveryConfirmed?: () => void;
  onDeleted?: () => void;
}

export default function DetalhePurchaseModal({ purchase, installments, loadingInstallments, onClose, onDeliveryConfirmed, onDeleted }: Props) {
  const { user } = useAuth();
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deliveryError, setDeliveryError] = useState('');

  // Estado para quantidades recebidas por item
  const [receivedItems, setReceivedItems] = useState<Record<string, { quantity: number; total: number }>>(() => {
    const init: Record<string, { quantity: number; total: number }> = {};
    purchase.items?.forEach((item) => {
      init[item.id] = {
        quantity: Number(item.quantity ?? 0),
        total: Number(item.total_price ?? 0),
      };
    });
    return init;
  });

  // Calcular novo total da compra baseado nas quantidades recebidas
  const newTotalAmount = useMemo(() => {
    return purchase.items?.reduce((sum, item) => {
      const received = receivedItems[item.id];
      return sum + (received ? received.total : Number(item.total_price ?? 0));
    }, 0) ?? 0;
  }, [receivedItems, purchase.items]);

  const totalDiff = purchase.total_amount - newTotalAmount;
  const hasChanges = Math.abs(totalDiff) >= 0.01;

  const updateReceivedQuantity = (itemId: string, newQty: number) => {
    const item = purchase.items?.find((i) => i.id === itemId);
    if (!item) return;
    const unitPrice = Number(item.unit_price ?? 0);
    const newTotal = Math.round(newQty * unitPrice * 100) / 100;
    setReceivedItems((prev) => ({
      ...prev,
      [itemId]: { quantity: newQty, total: newTotal },
    }));
  };

  // Exclusão
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async () => {
    if (!user?.tenantId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/purchase-write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: 'delete_purchase',
          tenant_id: user.tenantId,
          payload: { id: purchase.id },
        }),
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        setDeleteError(result.error || 'Erro ao excluir compra');
        setDeleting(false);
      } else {
        onDeleted?.();
        onClose();
      }
    } catch {
      setDeleteError('Erro de conexão');
      setDeleting(false);
    }
  };

  const isDelivered = !!purchase.delivery_confirmed_at;

  const handleConfirmDelivery = async () => {
    if (!user?.tenantId) return;
    setConfirming(true);
    setDeliveryError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Montar array de itens recebidos com ajustes
      const receivedItemsPayload = purchase.items?.map((item) => {
        const received = receivedItems[item.id];
        const originalQty = Number(item.quantity ?? 0);
        const originalTotal = Number(item.total_price ?? 0);
        const receivedQty = received ? received.quantity : originalQty;
        const receivedTotal = received ? received.total : originalTotal;

        // Só envia se houve alteração
        if (receivedQty !== originalQty || receivedTotal !== originalTotal) {
          return {
            item_id: item.id,
            received_quantity: receivedQty,
            received_total_price: receivedTotal,
          };
        }
        return null;
      }).filter(Boolean) ?? [];

      const res = await fetch(`${SUPABASE_URL}/functions/v1/purchase-confirm-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          tenant_id: user.tenantId,
          payload: {
            purchase_id: purchase.id,
            delivery_notes: deliveryNotes,
            received_items: receivedItemsPayload,
          },
        }),
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        setDeliveryError(result.error || 'Erro ao confirmar recebimento');
      } else {
        setShowDeliveryForm(false);
        onDeliveryConfirmed?.();
        onClose();
      }
    } catch (e) {
      setDeliveryError('Erro de conexão');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-bold text-zinc-900">{purchase.supplier}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {new Date(purchase.purchase_date + 'T00:00:00').toLocaleDateString('pt-BR')}
              {purchase.invoice_number && ` · NF ${purchase.invoice_number}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
              title="Excluir compra"
            >
              <i className="ri-delete-bin-line text-sm" />
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
              <i className="ri-close-line text-zinc-500" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-50 rounded-xl p-3">
              <p className="text-xs text-zinc-500 mb-0.5">Forma de Pagamento</p>
              <p className="text-sm font-semibold text-zinc-800">{purchase.payment_method}</p>
            </div>
            <div className="bg-zinc-50 rounded-xl p-3">
              <p className="text-xs text-zinc-500 mb-0.5">Status</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[purchase.payment_status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                {STATUS_LABEL[purchase.payment_status] ?? purchase.payment_status}
              </span>
            </div>
            <div className="bg-zinc-50 rounded-xl p-3">
              <p className="text-xs text-zinc-500 mb-0.5">Total</p>
              <p className="text-sm font-bold text-zinc-900">{formatCurrency(purchase.total_amount)}</p>
            </div>
          </div>

          {purchase.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-amber-700 mb-0.5">Observações</p>
              <p className="text-sm text-amber-800">{purchase.notes}</p>
            </div>
          )}

          {/* Parcelas */}
          {purchase.payment_status === 'partial' && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <i className="ri-calendar-schedule-line text-sky-500" />
                Parcelas
              </p>
              {loadingInstallments ? (
                <p className="text-xs text-zinc-400 py-3 text-center">Carregando parcelas...</p>
              ) : installments.length === 0 ? (
                <p className="text-xs text-zinc-400 py-3 text-center">Nenhuma parcela encontrada</p>
              ) : (
                <div className="rounded-xl border border-zinc-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50">
                      <tr>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500">Parcela</th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500">Vencimento</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500">Valor</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {installments.map((inst) => (
                        <tr key={inst.id} className={inst.status === 'paid' ? 'bg-green-50/40' : inst.status === 'overdue' ? 'bg-red-50/40' : ''}>
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-bold text-zinc-700">{inst.installment_number}/{inst.installments}</span>
                          </td>
                          <td className="px-3 py-2.5 text-zinc-600 text-xs">
                            {inst.due_date ? new Date(inst.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                            {inst.paid_date && (
                              <p className="text-green-600 text-xs mt-0.5">
                                Pago em {new Date(inst.paid_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-zinc-900 text-xs">
                            {formatCurrency(inst.amount)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${BILL_STATUS_BADGE[inst.status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                              {BILL_STATUS_LABEL[inst.status] ?? inst.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-zinc-200">
                      <tr>
                        <td colSpan={2} className="px-3 py-2.5 text-right font-bold text-zinc-600 text-xs">Total</td>
                        <td className="px-3 py-2.5 text-right font-bold text-zinc-900 text-sm">
                          {formatCurrency(installments.reduce((s, i) => s + Number(i.amount), 0))}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Itens da compra */}
          {purchase.items && purchase.items.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Itens da Compra</p>
              <div className="rounded-xl border border-zinc-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500">Descrição</th>
                      <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500">Qtd</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500">Preço Unit.</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {purchase.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-zinc-50">
                        <td className="px-3 py-2.5 text-zinc-800 font-medium">{item.description || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-zinc-600">{item.quantity}</td>
                        <td className="px-3 py-2.5 text-right text-zinc-600">{formatCurrency(item.unit_price ?? 0)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-zinc-900">{formatCurrency(item.total_price ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-zinc-200">
                    <tr>
                      <td colSpan={3} className="px-3 py-2.5 text-right font-bold text-zinc-600 text-sm">Total</td>
                      <td className="px-3 py-2.5 text-right font-bold text-zinc-900 text-base">{formatCurrency(purchase.total_amount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Confirmar Recebimento */}
        <div className="px-6 pb-5 border-t border-zinc-100 pt-4">
          {isDelivered ? (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <div className="w-8 h-8 flex items-center justify-center bg-green-100 rounded-lg flex-shrink-0">
                <i className="ri-truck-line text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-green-800">Mercadoria Recebida</p>
                <p className="text-xs text-green-600 mt-0.5">
                  Confirmado em {new Date(purchase.delivery_confirmed_at!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
                {purchase.delivery_notes && (
                  <p className="text-xs text-green-700 mt-1 italic">"{purchase.delivery_notes}"</p>
                )}
              </div>
              <i className="ri-checkbox-circle-fill text-green-500 text-xl flex-shrink-0" />
            </div>
          ) : (
            <div className="space-y-3">
              {!showDeliveryForm ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <i className="ri-truck-line" />
                    <span>Mercadoria ainda não confirmada como recebida</span>
                  </div>
                  <button
                    onClick={() => setShowDeliveryForm(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <i className="ri-truck-line" />
                    Confirmar Recebimento
                  </button>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 flex items-center justify-center bg-green-100 rounded-lg">
                      <i className="ri-truck-line text-green-600 text-sm" />
                    </div>
                    <p className="text-sm font-bold text-green-800">Confirmar Recebimento da Mercadoria</p>
                  </div>
                  <p className="text-xs text-green-700">
                    Ajuste as quantidades recebidas abaixo. O valor total será recalculado automaticamente e as contas a pagar serão ajustadas proporcionalmente.
                  </p>

                  {/* Tabela de itens com quantidade recebida */}
                  {purchase.items && purchase.items.length > 0 && (
                    <div className="rounded-xl border border-green-200 overflow-hidden bg-white">
                      <table className="w-full text-sm">
                        <thead className="bg-green-50">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-green-800">Item</th>
                            <th className="text-center px-3 py-2 text-xs font-semibold text-green-800">Qtd. Pedida</th>
                            <th className="text-center px-3 py-2 text-xs font-semibold text-green-800">Qtd. Recebida</th>
                            <th className="text-right px-3 py-2 text-xs font-semibold text-green-800">Preço Unit.</th>
                            <th className="text-right px-3 py-2 text-xs font-semibold text-green-800">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-green-100">
                          {purchase.items.map((item) => {
                            const received = receivedItems[item.id];
                            const originalQty = Number(item.quantity ?? 0);
                            const originalTotal = Number(item.total_price ?? 0);
                            const receivedQty = received ? received.quantity : originalQty;
                            const receivedTotal = received ? received.total : originalTotal;
                            const isChanged = receivedQty !== originalQty;

                            return (
                              <tr key={item.id} className={isChanged ? 'bg-amber-50/50' : ''}>
                                <td className="px-3 py-2">
                                  <p className="text-xs font-medium text-zinc-800">{item.description || '—'}</p>
                                  {item.unit_label && (
                                    <p className="text-[10px] text-zinc-400">{item.unit_label}</p>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center text-xs text-zinc-500">
                                  {originalQty}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    value={receivedQty}
                                    onChange={(e) => updateReceivedQuantity(item.id, Number(e.target.value) || 0)}
                                    className={`w-20 text-center border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-400 ${
                                      isChanged ? 'border-amber-300 bg-amber-50' : 'border-zinc-200'
                                    }`}
                                  />
                                </td>
                                <td className="px-3 py-2 text-right text-xs text-zinc-500">
                                  {formatCurrency(Number(item.unit_price ?? 0))}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <span className={`text-xs font-semibold ${isChanged ? 'text-amber-700' : 'text-zinc-700'}`}>
                                    {formatCurrency(receivedTotal)}
                                  </span>
                                  {isChanged && (
                                    <p className="text-[10px] text-zinc-400 line-through">
                                      {formatCurrency(originalTotal)}
                                    </p>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-green-200 bg-green-50/50">
                          <tr>
                            <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold text-zinc-600">
                              Total Original
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-bold text-zinc-500 line-through">
                              {formatCurrency(purchase.total_amount)}
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold text-green-800">
                              Total Recebido
                            </td>
                            <td className="px-3 py-2 text-right text-sm font-bold text-green-700">
                              {formatCurrency(newTotalAmount)}
                            </td>
                          </tr>
                          {hasChanges && (
                            <tr>
                              <td colSpan={4} className="px-3 py-1 text-right text-[10px] font-semibold text-amber-600">
                                {totalDiff > 0 ? 'Economia' : 'Acréscimo'} de {formatCurrency(Math.abs(totalDiff))}
                              </td>
                              <td />
                            </tr>
                          )}
                        </tfoot>
                      </table>
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-semibold text-zinc-600 block mb-1">Observações (opcional)</label>
                    <input
                      value={deliveryNotes}
                      onChange={e => setDeliveryNotes(e.target.value)}
                      placeholder="Ex: Chegou com avaria na embalagem, faltou 2 unidades..."
                      className="w-full border border-green-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
                    />
                  </div>
                  {deliveryError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <i className="ri-error-warning-line" /> {deliveryError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowDeliveryForm(false); setDeliveryError(''); }}
                      className="flex-1 py-2 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleConfirmDelivery}
                      disabled={confirming}
                      className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
                    >
                      {confirming ? (
                        <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Confirmando...</>
                      ) : (
                        <><i className="ri-checkbox-circle-line" /> Confirmar Recebimento</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 pb-5">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Modal de confirmação de exclusão */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                  <i className="ri-delete-bin-2-line text-red-600 text-xl" />
                </div>
                <div>
                  <h4 className="font-bold text-zinc-900">Excluir Compra</h4>
                  <p className="text-xs text-zinc-500 mt-0.5">Esta ação não pode ser desfeita</p>
                </div>
              </div>

              <div className="bg-zinc-50 rounded-xl p-3 mb-4">
                <p className="text-sm font-semibold text-zinc-800">{purchase.supplier}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {new Date(purchase.purchase_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                  {purchase.invoice_number && ` · NF ${purchase.invoice_number}`}
                  {' · '}
                  <span className="font-semibold text-zinc-700">
                    {purchase.total_amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 space-y-1.5">
                <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                  <i className="ri-alert-line" /> O que será removido:
                </p>
                <ul className="text-xs text-amber-700 space-y-1 pl-4">
                  <li className="flex items-center gap-1.5"><i className="ri-checkbox-circle-line text-amber-500" /> Registro da compra e seus itens</li>
                  <li className="flex items-center gap-1.5"><i className="ri-checkbox-circle-line text-amber-500" /> Contas a pagar pendentes vinculadas</li>
                  <li className="flex items-center gap-1.5"><i className="ri-checkbox-circle-line text-amber-500" /> Entradas no fluxo de caixa</li>
                  <li className="flex items-center gap-1.5"><i className="ri-checkbox-circle-line text-amber-500" /> Estoque revertido (saída de estorno)</li>
                </ul>
                {purchase.payment_status === 'paid' && (
                  <p className="text-xs text-amber-700 mt-1 pt-1 border-t border-amber-200">
                    <i className="ri-information-line mr-1" />
                    Contas já pagas serão mantidas como histórico financeiro.
                  </p>
                )}
              </div>

              {deleteError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
                  <i className="ri-error-warning-line text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-600">{deleteError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteError(''); }}
                  disabled={deleting}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Excluindo...</>
                  ) : (
                    <><i className="ri-delete-bin-line" /> Sim, excluir compra</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
