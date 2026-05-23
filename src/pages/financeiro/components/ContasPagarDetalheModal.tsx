import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import type { BillPayable } from '@/types/financeiro';

const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  partial: 'bg-sky-100 text-sky-700',
};
const STATUS_LABEL: Record<string, string> = {
  paid: 'Pago', pending: 'Pendente', overdue: 'Vencido', partial: 'Parcial',
};

interface PurchaseItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit_label?: string;
  received_quantity?: number | null;
  received_total_price?: number | null;
  ingredient?: { name: string; unit: string } | null;
}

interface RelatedPurchase {
  id: string;
  supplier: string;
  invoice_number?: string;
  purchase_date: string;
  total_amount: number;
  payment_status: string;
  delivery_confirmed_at?: string | null;
  delivery_notes?: string | null;
  freight_amount?: number;
  notes?: string;
  items: PurchaseItem[];
}

interface RelatedInstallment {
  id: string;
  installment_number: number;
  installments: number;
  amount: number;
  due_date: string;
  status: string;
  paid_date?: string;
  paid_amount?: number;
}

interface Props {
  bill: BillPayable;
  onClose: () => void;
  onPay?: () => void;
  onNavigateToCompras?: (purchaseId?: string) => void;
}

export default function ContasPagarDetalheModal({ bill, onClose, onPay, onNavigateToCompras }: Props) {
  const { user } = useAuth();
  const [relatedPurchase, setRelatedPurchase] = useState<RelatedPurchase | null>(null);
  const [relatedInstallments, setRelatedInstallments] = useState<RelatedInstallment[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const daysUntil = bill.due_date
    ? Math.ceil((new Date(bill.due_date + 'T00:00:00').getTime() - new Date(today).getTime()) / 86400000)
    : null;

  useEffect(() => {
    if (!user?.tenantId || !bill.reference_id) return;

    const loadDetails = async () => {
      setLoadingDetails(true);

      if (bill.reference_type === 'purchase') {
        const { data } = await supabase
          .from('fin_purchases')
          .select('*, items:fin_purchase_items(*, ingredient:ingredients(name,unit))')
          .eq('id', bill.reference_id!)
          .eq('tenant_id', user.tenantId)
          .maybeSingle();
        setRelatedPurchase(data ?? null);

        // Buscar parcelas irmãs se for parcelado
        if (bill.installments && bill.installments > 1) {
          const parentId = bill.parent_id ?? bill.id;
          const { data: siblings } = await supabase
            .from('fin_accounts_payable')
            .select('id,installment_number,installments,amount,due_date,status,paid_date,paid_amount')
            .eq('tenant_id', user.tenantId)
            .or(`id.eq.${parentId},parent_id.eq.${parentId}`)
            .order('installment_number');
          setRelatedInstallments((siblings ?? []) as RelatedInstallment[]);
        }
      }

      if (bill.reference_type === 'hr_payroll' && bill.reference_id) {
        // Apenas carrega parcelas se parcelado
        if (bill.installments && bill.installments > 1) {
          const parentId = bill.parent_id ?? bill.id;
          const { data: siblings } = await supabase
            .from('fin_accounts_payable')
            .select('id,installment_number,installments,amount,due_date,status,paid_date,paid_amount')
            .eq('tenant_id', user.tenantId)
            .or(`id.eq.${parentId},parent_id.eq.${parentId}`)
            .order('installment_number');
          setRelatedInstallments((siblings ?? []) as RelatedInstallment[]);
        }
      }

      setLoadingDetails(false);
    };

    loadDetails();
  }, [bill, user?.tenantId]);

  const totalRecebido = relatedPurchase?.items?.reduce((sum, item) => {
    return sum + (item.received_total_price ?? item.total_price ?? 0);
  }, 0) ?? 0;

  const hasReceivedAdjustments = relatedPurchase?.items?.some(
    (item) => item.received_quantity !== null && item.received_quantity !== undefined,
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto flex flex-col">

        {/* Header */}
        <div className="sticky top-0 bg-white z-10 px-6 py-4 border-b border-zinc-100 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-zinc-900 text-base leading-tight">{bill.description}</h3>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[bill.status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                {STATUS_LABEL[bill.status] ?? bill.status}
              </span>
              {bill.is_recurring && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1">
                  <i className="ri-repeat-line" /> Despesa Fixa
                </span>
              )}
            </div>
            {bill.supplier && (
              <p className="text-sm text-zinc-500 mt-0.5 flex items-center gap-1">
                <i className="ri-store-2-line text-xs" />
                {bill.supplier}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer flex-shrink-0"
          >
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="p-6 space-y-5 flex-1">

          {/* KPIs principais */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-zinc-50 rounded-xl p-3">
              <p className="text-xs text-zinc-400 mb-0.5">Valor</p>
              <p className="text-sm font-bold text-zinc-900">{formatCurrency(bill.amount)}</p>
            </div>
            <div className={`rounded-xl p-3 ${bill.status === 'overdue' ? 'bg-red-50' : bill.status === 'paid' ? 'bg-green-50' : 'bg-amber-50'}`}>
              <p className="text-xs text-zinc-400 mb-0.5">Vencimento</p>
              <p className="text-sm font-bold text-zinc-900">
                {bill.due_date ? new Date(bill.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
              </p>
              {daysUntil !== null && bill.status !== 'paid' && (
                <p className={`text-xs mt-0.5 font-semibold ${daysUntil < 0 ? 'text-red-600' : daysUntil === 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
                  {daysUntil < 0 ? `${Math.abs(daysUntil)}d em atraso` : daysUntil === 0 ? 'Vence hoje' : `Faltam ${daysUntil}d`}
                </p>
              )}
            </div>
            <div className="bg-zinc-50 rounded-xl p-3">
              <p className="text-xs text-zinc-400 mb-0.5">Categoria</p>
              <p className="text-sm font-semibold text-zinc-800">{bill.category || '—'}</p>
            </div>
            <div className="bg-zinc-50 rounded-xl p-3">
              <p className="text-xs text-zinc-400 mb-0.5">Origem</p>
              <div>
                {bill.reference_type === 'purchase' && (
                  <span className="text-xs font-semibold text-indigo-700 flex items-center gap-1">
                    <i className="ri-shopping-cart-2-line" /> Compra
                  </span>
                )}
                {bill.reference_type === 'hr_payroll' && (
                  <span className="text-xs font-semibold text-rose-700 flex items-center gap-1">
                    <i className="ri-team-line" /> Folha de Pagamento
                  </span>
                )}
                {bill.reference_type === 'manual' && (
                  <span className="text-xs font-semibold text-zinc-600 flex items-center gap-1">
                    <i className="ri-edit-line" /> Manual
                  </span>
                )}
                {!bill.reference_type && (
                  <span className="text-xs text-zinc-400">Manual</span>
                )}
              </div>
            </div>
          </div>

          {/* Pagamento confirmado */}
          {bill.status === 'paid' && bill.paid_date && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 flex items-center justify-center bg-green-100 rounded-lg flex-shrink-0">
                <i className="ri-checkbox-circle-fill text-green-600 text-lg" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-green-800">Pagamento Confirmado</p>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <p className="text-xs text-green-700">
                    Data: <span className="font-semibold">{new Date(bill.paid_date + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                  </p>
                  {bill.paid_amount && (
                    <p className="text-xs text-green-700">
                      Valor pago: <span className="font-semibold">{formatCurrency(bill.paid_amount)}</span>
                    </p>
                  )}
                  {bill.payment_method && (
                    <p className="text-xs text-green-700">
                      Forma: <span className="font-semibold">{bill.payment_method}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Parcelas */}
          {relatedInstallments.length > 1 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <i className="ri-calendar-schedule-line text-amber-500" />
                Parcelas ({relatedInstallments.length}x)
              </p>
              <div className="rounded-xl border border-zinc-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500">#</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500">Vencimento</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500">Valor</th>
                      <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {relatedInstallments.map((inst) => {
                      const isCurrent = inst.id === bill.id;
                      return (
                        <tr
                          key={inst.id}
                          className={`${isCurrent ? 'bg-amber-50' : inst.status === 'paid' ? 'bg-green-50/40' : inst.status === 'overdue' ? 'bg-red-50/40' : ''}`}
                        >
                          <td className="px-3 py-2.5">
                            <span className={`text-xs font-bold ${isCurrent ? 'text-amber-700' : 'text-zinc-700'}`}>
                              {inst.installment_number}/{inst.installments}
                              {isCurrent && <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">atual</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-zinc-600">
                            {inst.due_date ? new Date(inst.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                            {inst.paid_date && (
                              <p className="text-[10px] text-green-600 mt-0.5">
                                Pago em {new Date(inst.paid_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-zinc-900">
                            {formatCurrency(inst.amount)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[inst.status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                              {STATUS_LABEL[inst.status] ?? inst.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-zinc-200">
                    <tr>
                      <td colSpan={2} className="px-3 py-2.5 text-right text-xs font-bold text-zinc-500">Total</td>
                      <td className="px-3 py-2.5 text-right text-sm font-bold text-zinc-900">
                        {formatCurrency(relatedInstallments.reduce((s, i) => s + Number(i.amount), 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Compra vinculada */}
          {bill.reference_type === 'purchase' && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <i className="ri-shopping-cart-2-line text-indigo-500" />
                Compra Vinculada
              </p>

              {loadingDetails ? (
                <div className="flex items-center justify-center py-8 text-zinc-400 gap-2 text-sm">
                  <div className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
                  Carregando detalhes...
                </div>
              ) : !relatedPurchase ? (
                <div className="bg-zinc-50 rounded-xl p-4 text-center">
                  <i className="ri-search-line text-2xl text-zinc-300 block mb-1" />
                  <p className="text-xs text-zinc-400">Compra não encontrada</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Resumo da compra */}
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-bold text-indigo-900">{relatedPurchase.supplier}</p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <p className="text-xs text-indigo-700">
                            <i className="ri-calendar-line mr-1" />
                            {new Date(relatedPurchase.purchase_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </p>
                          {relatedPurchase.invoice_number && (
                            <p className="text-xs text-indigo-700 font-mono">
                              NF {relatedPurchase.invoice_number}
                            </p>
                          )}
                          {relatedPurchase.freight_amount && relatedPurchase.freight_amount > 0 && (
                            <p className="text-xs text-indigo-600">
                              <i className="ri-truck-line mr-1" />
                              Frete: {formatCurrency(relatedPurchase.freight_amount)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-bold text-indigo-900">
                          {formatCurrency(relatedPurchase.total_amount)}
                        </p>
                        {hasReceivedAdjustments && totalRecebido !== relatedPurchase.total_amount && (
                          <p className="text-xs text-amber-600 mt-0.5">
                            Recebido: {formatCurrency(totalRecebido)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Status de recebimento */}
                    {relatedPurchase.delivery_confirmed_at ? (
                      <div className="flex items-center gap-2 mt-3 bg-green-100 rounded-lg px-3 py-2">
                        <i className="ri-truck-line text-green-600 text-sm" />
                        <div>
                          <p className="text-xs font-semibold text-green-800">Mercadoria recebida</p>
                          <p className="text-[10px] text-green-700">
                            {new Date(relatedPurchase.delivery_confirmed_at).toLocaleString('pt-BR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </p>
                          {relatedPurchase.delivery_notes && (
                            <p className="text-[10px] text-green-700 italic mt-0.5">"{relatedPurchase.delivery_notes}"</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-3 bg-amber-100 rounded-lg px-3 py-2">
                        <i className="ri-time-line text-amber-600 text-sm" />
                        <p className="text-xs font-semibold text-amber-800">Aguardando recebimento da mercadoria</p>
                      </div>
                    )}
                  </div>

                  {/* Itens da compra */}
                  {relatedPurchase.items && relatedPurchase.items.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-zinc-500 mb-2 flex items-center gap-1.5">
                        <i className="ri-list-check text-xs" />
                        Itens ({relatedPurchase.items.length})
                      </p>
                      <div className="rounded-xl border border-zinc-200 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-zinc-50">
                            <tr>
                              <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500">Descrição</th>
                              <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500">Qtd. Pedida</th>
                              {hasReceivedAdjustments && (
                                <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500">Qtd. Recebida</th>
                              )}
                              <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500">Preço Unit.</th>
                              <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {relatedPurchase.items.map((item, idx) => {
                              const hasAdjustment = item.received_quantity !== null && item.received_quantity !== undefined;
                              const qtyChanged = hasAdjustment && item.received_quantity !== item.quantity;

                              return (
                                <tr key={item.id ?? idx} className={qtyChanged ? 'bg-amber-50/40' : 'hover:bg-zinc-50'}>
                                  <td className="px-3 py-2.5">
                                    <p className="text-xs font-medium text-zinc-800">
                                      {item.ingredient?.name || item.description || '—'}
                                    </p>
                                    {item.unit_label && (
                                      <p className="text-[10px] text-zinc-400">{item.unit_label}</p>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className={`text-xs ${qtyChanged ? 'text-zinc-400 line-through' : 'text-zinc-700'}`}>
                                      {item.quantity}
                                    </span>
                                  </td>
                                  {hasReceivedAdjustments && (
                                    <td className="px-3 py-2.5 text-center">
                                      {hasAdjustment ? (
                                        <span className={`text-xs font-semibold ${qtyChanged ? 'text-amber-700' : 'text-zinc-600'}`}>
                                          {item.received_quantity}
                                          {qtyChanged && (
                                            <span className="ml-1 text-[10px] bg-amber-100 text-amber-600 px-1 py-0.5 rounded-full">
                                              ajustado
                                            </span>
                                          )}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-zinc-400">—</span>
                                      )}
                                    </td>
                                  )}
                                  <td className="px-3 py-2.5 text-right text-xs text-zinc-500">
                                    {formatCurrency(item.unit_price ?? 0)}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    <span className="text-xs font-semibold text-zinc-900">
                                      {formatCurrency(item.received_total_price ?? item.total_price ?? 0)}
                                    </span>
                                    {qtyChanged && item.total_price && item.received_total_price && item.received_total_price !== item.total_price && (
                                      <p className="text-[10px] text-zinc-400 line-through">
                                        {formatCurrency(item.total_price)}
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="border-t-2 border-zinc-200">
                            <tr>
                              <td colSpan={hasReceivedAdjustments ? 4 : 3} className="px-3 py-2.5 text-right text-xs font-bold text-zinc-500">
                                Total
                              </td>
                              <td className="px-3 py-2.5 text-right text-sm font-bold text-zinc-900">
                                {formatCurrency(relatedPurchase.total_amount)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Notas da compra */}
                  {relatedPurchase.notes && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                      <p className="text-xs font-semibold text-amber-700 mb-0.5">Observações da Compra</p>
                      <p className="text-xs text-amber-800">{relatedPurchase.notes}</p>
                    </div>
                  )}

                  {/* Link para a compra */}
                  {onNavigateToCompras && (
                    <button
                      onClick={() => { onClose(); onNavigateToCompras(relatedPurchase.id); }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                    >
                      <i className="ri-external-link-line" />
                      Abrir compra completa
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Observações da conta */}
          {bill.notes && (
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-zinc-500 mb-1">Observações</p>
              <p className="text-sm text-zinc-700">{bill.notes}</p>
            </div>
          )}

          {/* Info adicional */}
          {bill.created_at && (
            <p className="text-xs text-zinc-400 text-center">
              Criado em {new Date(bill.created_at).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
        </div>

        {/* Footer com ações */}
        <div className="sticky bottom-0 bg-white border-t border-zinc-100 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
          >
            Fechar
          </button>
          {bill.status !== 'paid' && onPay && (
            <button
              onClick={() => { onClose(); onPay(); }}
              className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-bold cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              <i className="ri-check-line" />
              Registrar Pagamento
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
