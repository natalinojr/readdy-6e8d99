import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';

interface Props {
  type: string;
  categoryId?: string;
  categoryName?: string;
  month: string;
  mode: 'caixa' | 'competencia';
  onClose: () => void;
}

interface DetailItem {
  id: string;
  date: string;
  description: string;
  amount: number;
  extra?: Record<string, string | number>;
  source: string;
}

function getMonthRange(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  const start = `${mes}-01`;
  const end = new Date(y, m, 0).toISOString().split('T')[0];
  return { start, end: end + 'T23:59:59' };
}

const TYPE_LABELS: Record<string, string> = {
  receita_balcao: 'Vendas Balcão / Hora',
  receita_delivery: 'Vendas Delivery',
  receita_mesa: 'Vendas Mesa',
  receita_autoatendimento: 'Autoatendimento',
  receita_manual: 'Entradas Manuais',
  receita_a_receber: 'Receita a Realizar',
  cmv: 'CMV — Compras de Insumos',
  cancelamentos: 'Cancelamentos',
  descontos: 'Descontos Concedidos',
  custo_pessoal: 'Custo com Pessoal',
};

export default function DREDrillDownModal({ type, categoryId, categoryName, month, mode, onClose }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<DetailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const loadDetails = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { start, end } = getMonthRange(month);
    const monthStr = month; // YYYY-MM

    let result: DetailItem[] = [];

    // ── RECEITAS ──
    if (type.startsWith('receita_')) {
      const destMap: Record<string, string[]> = {
        receita_balcao: ['immediate', 'balcao', 'hora', 'password', 'name'],
        receita_delivery: ['delivery'],
        receita_mesa: ['table', 'mesa'],
        receita_autoatendimento: ['self_service'],
      };

      if (type === 'receita_manual') {
        const { data } = await supabase
          .from('fin_cash_flow')
          .select('id,date,description,amount')
          .eq('tenant_id', user.tenantId)
          .eq('type', 'income')
          .eq('origin', 'manual')
          .gte('date', start)
          .lte('date', end)
          .order('date', { ascending: false });
        result = (data ?? []).map(d => ({
          id: d.id,
          date: d.date,
          description: d.description || 'Entrada manual',
          amount: Number(d.amount),
          source: 'Fluxo de Caixa',
        }));
      } else if (type === 'receita_a_receber') {
        const { data } = await supabase
          .from('fin_receivable_installments')
          .select('id,due_date,amount,order_id,orders(order_number)')
          .eq('tenant_id', user.tenantId)
          .eq('status', 'pending')
          .gte('due_date', start.slice(0, 10))
          .lte('due_date', end.slice(0, 10))
          .order('due_date', { ascending: false });
        result = (data ?? []).map((d: Record<string, unknown>) => ({
          id: d.id as string,
          date: d.due_date as string,
          description: `Recebível — Pedido ${(d.orders as Record<string, unknown>)?.order_number || d.order_id || ''}`,
          amount: Number(d.amount),
          source: 'Contas a Receber',
        }));
      } else {
        const destinations = destMap[type] || [];
        const { data } = await supabase
          .from('payments')
          .select('id,amount,created_at,order_id,orders(destination_type,order_number,status)')
          .eq('orders.tenant_id', user.tenantId)
          .eq('orders.is_training', false)
          .eq('orders.is_draft', false)
          .not('orders.status', 'in', '("cancelled","draft")')
          .in('orders.destination_type', destinations)
          .gte('created_at', start)
          .lte('created_at', end)
          .order('created_at', { ascending: false });
        result = (data ?? []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          date: (p.created_at as string).slice(0, 10),
          description: `Pedido ${(p.orders as Record<string, unknown>)?.order_number || p.order_id || ''}`,
          amount: Number(p.amount),
          source: 'Pagamentos',
          extra: {
            Canal: String((p.orders as Record<string, unknown>)?.destination_type || ''),
          },
        }));
      }
    }

    // ── CANCELAMENTOS ──
    else if (type === 'cancelamentos') {
      const { data } = await supabase
        .from('orders')
        .select('id,total_amount,created_at,order_number,destination_type')
        .eq('tenant_id', user.tenantId)
        .eq('is_training', false)
        .eq('is_draft', false)
        .eq('status', 'cancelled')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });
      result = (data ?? []).map((o: Record<string, unknown>) => ({
        id: o.id as string,
        date: (o.created_at as string).slice(0, 10),
        description: `Pedido ${o.order_number || o.id} cancelado`,
        amount: Number(o.total_amount),
        source: 'Pedidos',
        extra: { Canal: String(o.destination_type || '') },
      }));
    }

    // ── DESCONTOS ──
    else if (type === 'descontos') {
      const { data } = await supabase
        .from('orders')
        .select('id,discount_amount,created_at,order_number,destination_type')
        .eq('tenant_id', user.tenantId)
        .eq('is_training', false)
        .eq('is_draft', false)
        .not('status', 'in', '("cancelled","draft")')
        .gt('discount_amount', 0)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });
      result = (data ?? []).map((o: Record<string, unknown>) => ({
        id: o.id as string,
        date: (o.created_at as string).slice(0, 10),
        description: `Desconto no pedido ${o.order_number || o.id}`,
        amount: Number(o.discount_amount),
        source: 'Pedidos',
        extra: { Canal: String(o.destination_type || '') },
      }));
    }

    // ── CMV ──
    else if (type === 'cmv') {
      // Buscar compras do período
      const { data: purchases } = await supabase
        .from('fin_purchases')
        .select('id,purchase_date,supplier,total_amount,payment_status,invoice_number')
        .eq('tenant_id', user.tenantId)
        .gte('purchase_date', start.slice(0, 10))
        .lte('purchase_date', end.slice(0, 10))
        .order('purchase_date', { ascending: false });

      // Buscar itens das compras com classificação DRE
      const { data: purchaseItems } = await supabase
        .from('fin_purchase_items')
        .select('id,purchase_id,description,quantity,unit_price,total_price,dre_category_id,ingredient_id,ingredients(name,unit)')
        .in('purchase_id', (purchases ?? []).map(p => p.id));

      // Buscar categorias DRE para mostrar nomes
      const { data: dreCats } = await supabase
        .from('fin_dre_categories')
        .select('id,name')
        .eq('tenant_id', user.tenantId)
        .eq('is_active', true);

      const dreCatMap: Record<string, string> = {};
      (dreCats ?? []).forEach((c: Record<string, unknown>) => {
        dreCatMap[c.id as string] = c.name as string;
      });

      // Agrupar por compra, mostrando itens
      result = (purchases ?? []).map((p: Record<string, unknown>) => {
        const items = (purchaseItems ?? []).filter((i: Record<string, unknown>) => i.purchase_id === p.id);
        const itemDesc = items.length > 0
          ? items.map((i: Record<string, unknown>) => {
              const catId = i.dre_category_id as string | null;
              const catName = catId ? (dreCatMap[catId] || 'Classificado') : 'CMV';
              return `${i.description} (${Number(i.quantity)} ${(i.ingredients as Record<string, unknown>)?.unit || 'un'}) [${catName}]`;
            }).join(', ')
          : 'Compra de insumos';
        return {
          id: p.id as string,
          date: p.purchase_date as string,
          description: `${p.supplier || 'Fornecedor'} — ${itemDesc}`,
          amount: Number(p.total_amount),
          source: 'Compras',
          extra: {
            NF: String(p.invoice_number || '—'),
            Status: String(p.payment_status || ''),
            Itens: String(items.length),
          },
        };
      });
    }

    // ── CUSTO PESSOAL ──
    else if (type === 'custo_pessoal') {
      const { data } = await supabase
        .from('hr_payroll')
        .select('id,reference_month,net_salary,gross_salary,fgts,employee_id,hr_employees(name,role)')
        .eq('tenant_id', user.tenantId)
        .eq('reference_month', monthStr)
        .order('gross_salary', { ascending: false });
      result = (data ?? []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        date: `${monthStr}-01`,
        description: `${(p.hr_employees as Record<string, unknown>)?.name || 'Funcionário'}${(p.hr_employees as Record<string, unknown>)?.role ? ` — ${(p.hr_employees as Record<string, unknown>)?.role}` : ''}`,
        amount: Number(p.gross_salary) + Number(p.fgts),
        source: 'Folha de Pagamento',
        extra: {
          'Salário Bruto': formatCurrency(Number(p.gross_salary)),
          FGTS: formatCurrency(Number(p.fgts)),
          Líquido: formatCurrency(Number(p.net_salary)),
        },
      }));
    }

    // ── DESPESAS / CUSTOS POR CATEGORIA DRE ──
    else if (categoryId) {
      // Buscar contas a pagar vinculadas a essa categoria DRE
      const query = supabase
        .from('fin_accounts_payable')
        .select('id,due_date,description,supplier,amount,paid_amount,paid_date,status,payment_method')
        .eq('tenant_id', user.tenantId)
        .eq('dre_category_id', categoryId);

      if (mode === 'caixa') {
        // No caixa: só contas pagas no período
        const { data } = await query
          .eq('status', 'paid')
          .gte('paid_date', start.slice(0, 10))
          .lte('paid_date', end.slice(0, 10))
          .order('paid_date', { ascending: false });
        result = (data ?? []).map((b: Record<string, unknown>) => ({
          id: b.id as string,
          date: (b.paid_date as string) || (b.due_date as string),
          description: `${b.description}${b.supplier ? ` — ${b.supplier}` : ''}`,
          amount: Number(b.paid_amount ?? b.amount),
          source: 'Contas a Pagar',
          extra: {
            'Data Venc.': String(b.due_date || '—'),
            'Forma Pag.': String(b.payment_method || '—'),
            Status: String(b.status || ''),
          },
        }));
      } else {
        // Competência: todas as contas com vencimento no período
        const { data } = await query
          .in('status', ['pending', 'paid', 'overdue'])
          .gte('due_date', start.slice(0, 10))
          .lte('due_date', end.slice(0, 10))
          .order('due_date', { ascending: false });
        result = (data ?? []).map((b: Record<string, unknown>) => ({
          id: b.id as string,
          date: b.due_date as string,
          description: `${b.description}${b.supplier ? ` — ${b.supplier}` : ''}`,
          amount: Number(b.amount),
          source: 'Contas a Pagar',
          extra: {
            'Pago em': b.paid_date ? String(b.paid_date) : '—',
            'Forma Pag.': String(b.payment_method || '—'),
            Status: String(b.status || ''),
          },
        }));
      }
    }

    setItems(result);
    setTotal(result.reduce((s, i) => s + i.amount, 0));
    setLoading(false);
  }, [user?.tenantId, type, categoryId, month, mode]);

  useEffect(() => { loadDetails(); }, [loadDetails]);

  const label = categoryName || TYPE_LABELS[type] || type;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-zinc-900 text-sm">{label}</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              {items.length} registro{items.length !== 1 ? 's' : ''} — Total: {formatCurrency(total)}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-zinc-400 ml-2">Carregando detalhes...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <i className="ri-file-search-line text-3xl text-zinc-300 mb-2" />
              <p className="text-xs text-zinc-400">Nenhum registro encontrado para este período</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 sticky top-0 z-10">
                <tr className="border-b border-zinc-100">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-zinc-500">Data</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500">Descrição</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500">Origem</th>
                  <th className="text-right px-5 py-2.5 text-xs font-semibold text-zinc-500">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-5 py-3 text-xs text-zinc-500 whitespace-nowrap">
                      {new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-zinc-800">{item.description}</p>
                      {item.extra && Object.entries(item.extra).length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {Object.entries(item.extra).map(([k, v]) => (
                            <span key={k} className="text-[10px] text-zinc-400 bg-zinc-50 px-1.5 py-0.5 rounded">
                              {k}: <span className="text-zinc-600 font-medium">{String(v)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-medium text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-full">
                        {item.source}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-xs font-bold text-zinc-800">{formatCurrency(item.amount)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-100 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-zinc-400">
            Modo: {mode === 'competencia' ? 'Competência' : 'Caixa'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Total:</span>
            <span className="text-sm font-bold text-zinc-900">{formatCurrency(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}