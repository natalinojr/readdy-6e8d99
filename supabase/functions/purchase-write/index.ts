import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const { action, tenant_id, payload } = body;

    if (!tenant_id) return new Response(JSON.stringify({ error: 'tenant_id required' }), { status: 400, headers: corsHeaders });

    // Valida que o usuario pertence ao tenant informado (antes qualquer
    // usuario autenticado podia escrever em qualquer tenant via service role)
    const { data: membership } = await supabase
      .from('user_tenants')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: 'Usuario nao pertence ao tenant informado' }), { status: 403, headers: corsHeaders });
    }

    let result;

    switch (action) {
      case 'list_purchase_items': {
        const { ingredient_id } = payload;
        if (!ingredient_id) {
          return new Response(JSON.stringify({ error: 'ingredient_id required' }), { status: 400, headers: corsHeaders });
        }

        const { data: itemsData, error: itemsError } = await supabase
          .from('fin_purchase_items')
          .select('id, quantity, unit_price, total_price, purchase_id, unit_label, units_per_package, ingredient_id')
          .eq('ingredient_id', ingredient_id)
          .eq('tenant_id', tenant_id)
          .limit(50);

        if (itemsError) throw itemsError;
        if (!itemsData || itemsData.length === 0) {
          result = { data: [] };
          break;
        }

        const purchaseIds = [...new Set(itemsData.map((i) => i.purchase_id))];
        const { data: purchasesData } = await supabase
          .from('fin_purchases')
          .select('id, purchase_date, supplier')
          .in('id', purchaseIds)
          .eq('tenant_id', tenant_id)
          .order('purchase_date', { ascending: false });

        const purchasesMap = new Map(
          (purchasesData ?? []).map((p: { id: string; purchase_date: string; supplier: string }) => [p.id, p])
        );

        const rows = itemsData
          .map((item: Record<string, unknown>) => {
            const purchase = purchasesMap.get(item.purchase_id as string);
            if (!purchase) return null;
            return {
              id: item.id,
              purchase_date: purchase.purchase_date,
              supplier: purchase.supplier,
              quantity: Number(item.quantity),
              unit_price: Number(item.unit_price),
              total_price: Number(item.total_price),
              purchase_unit: item.unit_label,
              purchase_factor: item.units_per_package,
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime());

        result = { data: rows };
        break;
      }

      case 'list_purchase_prices': {
        const { ingredient_id } = payload;
        if (!ingredient_id) {
          return new Response(JSON.stringify({ error: 'ingredient_id required' }), { status: 400, headers: corsHeaders });
        }

        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const dateStr = threeMonthsAgo.toISOString().split('T')[0];

        const { data: itemsData, error: itemsError } = await supabase
          .from('fin_purchase_items')
          .select('id, unit_price, purchase_id')
          .eq('ingredient_id', ingredient_id)
          .eq('tenant_id', tenant_id)
          .limit(50);

        if (itemsError) throw itemsError;
        if (!itemsData || itemsData.length === 0) {
          result = { data: [] };
          break;
        }

        const purchaseIds = [...new Set(itemsData.map((i) => i.purchase_id))];
        const { data: purchasesData } = await supabase
          .from('fin_purchases')
          .select('id, purchase_date, supplier')
          .in('id', purchaseIds)
          .eq('tenant_id', tenant_id)
          .gte('purchase_date', dateStr)
          .order('purchase_date', { ascending: true });

        const purchasesMap = new Map(
          (purchasesData ?? []).map((p: { id: string; purchase_date: string; supplier: string }) => [p.id, p])
        );

        const rows = itemsData
          .map((item: Record<string, unknown>) => {
            const purchase = purchasesMap.get(item.purchase_id as string);
            if (!purchase) return null;
            return {
              date: purchase.purchase_date,
              price: Number(item.unit_price),
              supplier: purchase.supplier,
            };
          })
          .filter(Boolean);

        result = { data: rows };
        break;
      }

      case 'create_purchase': {
        const {
          items,
          installment_count,
          installment_interval_days,
          custom_installments,
          ...rawData
        } = payload;

        const purchaseData: Record<string, unknown> = { ...rawData };
        if (!purchaseData.due_date) purchaseData.due_date = null;
        if (!purchaseData.cost_center_id) purchaseData.cost_center_id = null;
        if (!purchaseData.bank_account_id) purchaseData.bank_account_id = null;
        if (!purchaseData.invoice_number) purchaseData.invoice_number = null;
        if (!purchaseData.notes) purchaseData.notes = null;
        // Frete
        const freightAmount = Number(purchaseData.freight_amount ?? 0);
        if (!freightAmount) purchaseData.freight_amount = 0;

        const hasCustomInstallments = Array.isArray(custom_installments) && custom_installments.length >= 2;
        const isLegacyInstallment = !hasCustomInstallments && installment_count && installment_count > 1;
        const isInstallment = hasCustomInstallments || isLegacyInstallment;
        const finalStatus = isInstallment ? 'partial' : purchaseData.payment_status;

        const { data: purchase, error: purchaseError } = await supabase
          .from('fin_purchases')
          .insert({ ...purchaseData, payment_status: finalStatus, tenant_id, created_by: user.id })
          .select().single();

        if (purchaseError) throw purchaseError;

        if (items && items.length > 0) {
          const itemsToInsert = items.map((item: Record<string, unknown>) => {
            const { purchase_unit: _pu, purchase_qty: _pq, purchase_factor: _pf, ...rest } = item as Record<string, unknown>;
            return {
              ...rest,
              purchase_id: purchase.id,
              tenant_id,
              ingredient_id: item.ingredient_id || null,
              freight_allocated: Number(item.freight_allocated ?? 0),
              unit_label: item.purchase_unit || null,
              units_per_package: Number(item.purchase_factor ?? 1) || 1,
            };
          });
          const { error: itemsError } = await supabase.from('fin_purchase_items').insert(itemsToInsert);
          if (itemsError) throw itemsError;

          let supplierRecord: { id: string } | null = null;
          if (purchase.supplier) {
            const { data: sup } = await supabase.from('fin_suppliers').select('id').eq('tenant_id', tenant_id).ilike('name', purchase.supplier.trim()).maybeSingle();
            supplierRecord = sup;
          }

          for (const item of items as Array<Record<string, unknown>>) {
            if (item.ingredient_id) {
              // quantity vem em UNIDADES DE COMPRA (caixa/fardo); units_per_package
              // converte para unidades de estoque (contrato exibido na UI da compra:
              // "qty x upp = total unid."). Antes entrava a quantidade crua.
              const purchaseQty = Number(item.quantity ?? 0);
              const unitsPerPkg = Number(item.units_per_package ?? item.purchase_factor ?? 1) || 1;
              const stockQty = purchaseQty * (unitsPerPkg > 1 ? unitsPerPkg : 1);

              // Movimentacao via RPC (insere movimento + atualiza current_stock
              // atomicamente — antes era insert direto + read-modify-write racy)
              const { error: mvErr } = await supabase.rpc('fn_add_stock_movement', {
                p_tenant_id: tenant_id, p_ingredient_id: item.ingredient_id,
                p_type: 'in', p_quantity: stockQty, p_unit: null,
                p_reason: `Compra: ${purchase.supplier} - NF ${purchase.invoice_number || 'S/N'}`,
                p_notes: null, p_order_id: null, p_operator_id: user.id, p_batch_id: null,
              });
              if (mvErr) console.error('[purchase-write] create_purchase fn_add_stock_movement error:', mvErr.message ?? mvErr);

              const supplierPayload: Record<string, unknown> = {};
              if (purchase.supplier) supplierPayload.supplier = purchase.supplier;
              if (supplierRecord?.id) supplierPayload.supplier_id = supplierRecord.id;
              if (Object.keys(supplierPayload).length > 0) {
                await supabase.from('ingredients').update(supplierPayload).eq('id', item.ingredient_id).eq('tenant_id', tenant_id);
              }

              // Custo por UNIDADE DE ESTOQUE = (total + frete) / (qty x upp)
              const itemTotalPrice = Number(item.total_price ?? 0);
              const freightAllocated = Number(item.freight_allocated ?? 0);
              const totalWithFreight = itemTotalPrice + freightAllocated;
              const realUnitPrice = stockQty > 0 ? totalWithFreight / stockQty : Number(item.unit_price ?? 0);

              if (realUnitPrice > 0) {
                await supabase.rpc('fn_update_ingredient_price_from_purchase', {
                  p_ingredient_id: item.ingredient_id, p_tenant_id: tenant_id,
                  p_purchase_unit_price: realUnitPrice,
                  p_purchase_date: purchaseData.purchase_date || new Date().toISOString().split('T')[0],
                });
              }
            }
          }
        }

        if (hasCustomInstallments) {
          const numParcelas = custom_installments.length;
          const firstInst = custom_installments[0];
          const { data: parentBill, error: parentErr } = await supabase.from('fin_accounts_payable').insert({
            tenant_id, supplier: purchase.supplier,
            description: `Compra - ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''} (1/${numParcelas})`,
            category: 'Compras', cost_center_id: purchaseData.cost_center_id || null,
            bank_account_id: purchaseData.bank_account_id || null, amount: Number(firstInst.amount),
            due_date: firstInst.due_date, status: 'pending', is_recurring: false,
            installments: numParcelas, installment_number: 1, notes: purchaseData.notes || null,
            reference_id: purchase.id, reference_type: 'purchase',
          }).select().single();
          if (parentErr) throw parentErr;
          for (let i = 1; i < numParcelas; i++) {
            const inst = custom_installments[i];
            await supabase.from('fin_accounts_payable').insert({
              tenant_id, supplier: purchase.supplier,
              description: `Compra - ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''} (${i + 1}/${numParcelas})`,
              category: 'Compras', cost_center_id: purchaseData.cost_center_id || null,
              bank_account_id: purchaseData.bank_account_id || null, amount: Number(inst.amount),
              due_date: inst.due_date, status: 'pending', is_recurring: false,
              installments: numParcelas, installment_number: i + 1, parent_id: parentBill.id,
              notes: purchaseData.notes || null, reference_id: purchase.id, reference_type: 'purchase',
            });
          }
        } else if (isLegacyInstallment) {
          const numParcelas = Number(installment_count);
          const intervalDays = Number(installment_interval_days ?? 30);
          const valorParcela = Math.round((Number(purchaseData.total_amount) / numParcelas) * 100) / 100;
          const baseDate = new Date((purchaseData.due_date || purchaseData.purchase_date) as string);
          const { data: parentBill, error: parentErr } = await supabase.from('fin_accounts_payable').insert({
            tenant_id, supplier: purchase.supplier,
            description: `Compra - ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''} (1/${numParcelas})`,
            category: 'Compras', cost_center_id: purchaseData.cost_center_id || null,
            bank_account_id: purchaseData.bank_account_id || null, amount: valorParcela,
            due_date: baseDate.toISOString().split('T')[0], status: 'pending', is_recurring: false,
            installments: numParcelas, installment_number: 1, notes: purchaseData.notes || null,
            reference_id: purchase.id, reference_type: 'purchase',
          }).select().single();
          if (parentErr) throw parentErr;
          for (let i = 2; i <= numParcelas; i++) {
            const dueDate = new Date(baseDate);
            dueDate.setDate(dueDate.getDate() + intervalDays * (i - 1));
            await supabase.from('fin_accounts_payable').insert({
              tenant_id, supplier: purchase.supplier,
              description: `Compra - ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''} (${i}/${numParcelas})`,
              category: 'Compras', cost_center_id: purchaseData.cost_center_id || null,
              bank_account_id: purchaseData.bank_account_id || null,
              amount: i === numParcelas ? Number(purchaseData.total_amount) - valorParcela * (numParcelas - 1) : valorParcela,
              due_date: dueDate.toISOString().split('T')[0], status: 'pending', is_recurring: false,
              installments: numParcelas, installment_number: i, parent_id: parentBill.id,
              notes: purchaseData.notes || null, reference_id: purchase.id, reference_type: 'purchase',
            });
          }
        } else if (purchaseData.payment_status !== 'paid') {
          const defaultDueDate = purchaseData.due_date ?? (() => {
            const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0];
          })();
          await supabase.from('fin_accounts_payable').insert({
            tenant_id, supplier: purchase.supplier,
            description: `Compra - ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''}`,
            category: 'Compras', cost_center_id: purchaseData.cost_center_id || null,
            bank_account_id: purchaseData.bank_account_id || null, amount: purchaseData.total_amount,
            due_date: defaultDueDate, status: 'pending', is_recurring: false,
            notes: purchaseData.notes || null, reference_id: purchase.id, reference_type: 'purchase',
          });
        } else if (purchaseData.payment_status === 'paid') {
          await supabase.from('fin_cash_flow').insert({
            tenant_id, type: 'expense', amount: purchaseData.total_amount,
            description: `Compra - ${purchase.supplier}`, category: 'Compras',
            cost_center_id: purchaseData.cost_center_id || null, origin: 'auto_purchase',
            reference_id: purchase.id, date: purchaseData.purchase_date,
          });
          if (purchaseData.bank_account_id) {
            await supabase.rpc('fn_bank_debit', {
              p_bank_account_id: purchaseData.bank_account_id, p_amount: purchaseData.total_amount,
              p_description: `Compra - ${purchase.supplier}`, p_reference_type: 'purchase',
              p_reference_id: purchase.id, p_transaction_date: purchaseData.purchase_date,
            });
          }
        }

        result = { data: purchase };
        break;
      }

      case 'confirm_delivery': {
        const { purchase_id, delivery_notes } = payload;
        if (!purchase_id) return new Response(JSON.stringify({ error: 'purchase_id required' }), { status: 400, headers: corsHeaders });

        const { data: purchase, error: purchaseErr } = await supabase
          .from('fin_purchases').select('*, items:fin_purchase_items(*)').eq('id', purchase_id).eq('tenant_id', tenant_id).single();
        if (purchaseErr || !purchase) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });
        if (purchase.delivery_confirmed_at) return new Response(JSON.stringify({ error: 'Recebimento já confirmado anteriormente' }), { status: 409, headers: corsHeaders });

        const confirmedAt = new Date().toISOString();
        await supabase.from('fin_purchases').update({ delivery_confirmed_at: confirmedAt, delivery_notes: delivery_notes || null }).eq('id', purchase_id).eq('tenant_id', tenant_id);

        // O estoque entra na CRIACAO da compra (create_purchase). Confirmar o
        // recebimento aqui nao repete a entrada — o fluxo com ajuste de
        // quantidades recebidas e o edge purchase-confirm-delivery.

        await supabase.from('fin_accounts_payable').update({ delivery_confirmed: true, delivery_confirmed_at: confirmedAt })
          .eq('reference_id', purchase_id).eq('tenant_id', tenant_id).neq('status', 'paid');

        result = { data: { confirmed_at: confirmedAt, purchase_id } };
        break;
      }

      case 'delete_purchase': {
        const { id } = payload;
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });

        const { data: purchase, error: fetchErr } = await supabase
          .from('fin_purchases')
          .select('*, items:fin_purchase_items(*)')
          .eq('id', id)
          .eq('tenant_id', tenant_id)
          .maybeSingle();

        if (fetchErr) return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: corsHeaders });
        if (!purchase) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });

        const purchaseItems = (purchase.items ?? []) as Array<Record<string, unknown>>;
        for (const item of purchaseItems) {
          if (item.ingredient_id) {
            const purchaseQty = Number(item.quantity ?? 0);
            const unitsPerPkg = Number(item.units_per_package ?? 1) || 1;
            const stockQty = purchaseQty * (unitsPerPkg > 1 ? unitsPerPkg : 1);
            if (stockQty > 0) {
              // Estorno via RPC. O tipo antigo 'out' nao existe no enum
              // stock_movement_type — o insert falhava silenciosamente e o
              // estorno ficava sem registro de movimento.
              const { error: mvErr } = await supabase.rpc('fn_add_stock_movement', {
                p_tenant_id: tenant_id,
                p_ingredient_id: item.ingredient_id,
                p_type: 'manual_out',
                p_quantity: stockQty,
                p_unit: null,
                p_reason: `Estorno de compra excluída: ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''}`,
                p_notes: null, p_order_id: null, p_operator_id: user.id, p_batch_id: null,
              });
              if (mvErr) console.error('[purchase-write] delete_purchase estorno error:', mvErr.message ?? mvErr);
            }
          }
        }

        await supabase
          .from('fin_accounts_payable')
          .delete()
          .eq('reference_id', id)
          .eq('tenant_id', tenant_id);

        await supabase
          .from('fin_cash_flow')
          .delete()
          .eq('reference_id', id)
          .eq('tenant_id', tenant_id)
          .eq('origin', 'auto_purchase');

        await supabase
          .from('fin_purchase_items')
          .delete()
          .eq('purchase_id', id)
          .eq('tenant_id', tenant_id);

        const { error: deleteErr } = await supabase
          .from('fin_purchases')
          .delete()
          .eq('id', id)
          .eq('tenant_id', tenant_id);

        if (deleteErr) return new Response(JSON.stringify({ error: deleteErr.message }), { status: 500, headers: corsHeaders });

        result = { data: { deleted: true, id } };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: corsHeaders });
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[purchase-write] Error:', err);
    let errorMessage = String(err);
    let errorCode = '';
    if (err && typeof err === 'object') {
      if ('message' in err) errorMessage = String(err.message);
      if ('code' in err) errorCode = String(err.code);
      if ('details' in err) errorMessage += ` | Detalhes: ${String(err.details)}`;
      if ('hint' in err) errorMessage += ` | Dica: ${String(err.hint)}`;
    }
    return new Response(JSON.stringify({ error: errorMessage, code: errorCode }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});