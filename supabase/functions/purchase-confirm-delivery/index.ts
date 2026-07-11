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
    const { tenant_id, payload } = body;

    if (!tenant_id) return new Response(JSON.stringify({ error: 'tenant_id required' }), { status: 400, headers: corsHeaders });

    // Valida que o usuario pertence ao tenant informado (antes qualquer
    // usuario autenticado podia confirmar recebimentos de qualquer tenant)
    const { data: membership } = await supabase
      .from('user_tenants')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: 'Usuario nao pertence ao tenant informado' }), { status: 403, headers: corsHeaders });
    }

    const { purchase_id, delivery_notes, received_items } = payload;
    if (!purchase_id) return new Response(JSON.stringify({ error: 'purchase_id required' }), { status: 400, headers: corsHeaders });

    const { data: purchase, error: purchaseErr } = await supabase
      .from('fin_purchases')
      .select('*, items:fin_purchase_items(*)')
      .eq('id', purchase_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (purchaseErr || !purchase) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });
    if (purchase.delivery_confirmed_at) return new Response(JSON.stringify({ error: 'Recebimento já confirmado anteriormente' }), { status: 409, headers: corsHeaders });

    const confirmedAt = new Date().toISOString();

    // Mapa de quantidades recebidas por item
    const receivedItemsMap = new Map<string, { received_quantity: number; received_total_price: number }>();
    if (Array.isArray(received_items)) {
      for (const ri of received_items) {
        receivedItemsMap.set(ri.item_id, {
          received_quantity: Number(ri.received_quantity ?? 0),
          received_total_price: Number(ri.received_total_price ?? 0),
        });
      }
    }

    let newTotalAmount = 0;
    const items = (purchase.items ?? []) as Array<Record<string, unknown>>;

    let supplierRecord: { id: string } | null = null;
    if (purchase.supplier) {
      const { data: sup } = await supabase.from('fin_suppliers').select('id').eq('tenant_id', tenant_id).ilike('name', (purchase.supplier as string).trim()).maybeSingle();
      supplierRecord = sup;
    }

    for (const item of items) {
      const itemId = item.id as string;
      const originalQty = Number(item.quantity ?? 0);
      const originalTotal = Number(item.total_price ?? 0);
      const unitPrice = Number(item.unit_price ?? 0);

      const received = receivedItemsMap.get(itemId);
      const receivedQty = received ? received.received_quantity : originalQty;
      const receivedTotal = received ? received.received_total_price : originalTotal;

      // Atualizar item com quantidade recebida
      if (received) {
        await supabase.from('fin_purchase_items').update({
          received_quantity: receivedQty,
          received_total_price: receivedTotal,
        }).eq('id', itemId).eq('tenant_id', tenant_id);
      }

      newTotalAmount += receivedTotal;

      if (item.ingredient_id) {
        // O estoque ja entrou por completo na CRIACAO da compra (purchase-write
        // create_purchase). Aqui aplicamos apenas o DELTA entre o recebido e o
        // pedido — antes a entrada era repetida por inteiro (dupla contagem).
        // quantity/received_quantity estao em unidades de COMPRA; units_per_package
        // converte para unidades de estoque.
        const unitsPerPkg = Number(item.units_per_package ?? 1) || 1;
        const factor = unitsPerPkg > 1 ? unitsPerPkg : 1;
        const deltaStock = (receivedQty - originalQty) * factor;

        if (deltaStock !== 0) {
          const { error: mvErr } = await supabase.rpc('fn_add_stock_movement', {
            p_tenant_id: tenant_id,
            p_ingredient_id: item.ingredient_id,
            p_type: deltaStock > 0 ? 'in' : 'manual_out',
            p_quantity: Math.abs(deltaStock),
            p_unit: null,
            p_reason: `Ajuste no recebimento: ${purchase.supplier}${purchase.invoice_number ? ` NF ${purchase.invoice_number}` : ''}`,
            p_notes: `recebido=${receivedQty} pedido=${originalQty} upp=${factor}`,
            p_order_id: null,
            p_operator_id: user.id,
            p_batch_id: null,
          });
          if (mvErr) console.error('[purchase-confirm-delivery] ajuste fn_add_stock_movement error:', mvErr.message ?? mvErr);
        }

        const supplierPayload: Record<string, unknown> = {};
        if (purchase.supplier) supplierPayload.supplier = purchase.supplier;
        if (supplierRecord?.id) supplierPayload.supplier_id = supplierRecord.id;
        if (Object.keys(supplierPayload).length > 0) {
          await supabase.from('ingredients').update(supplierPayload).eq('id', item.ingredient_id).eq('tenant_id', tenant_id);
        }

        // Custo por UNIDADE DE ESTOQUE com frete rateado, baseado no RECEBIDO
        const freightAllocated = Number(item.freight_allocated ?? 0);
        const totalWithFreight = receivedTotal + freightAllocated;
        const totalUnits = receivedQty * factor;
        const realUnitPrice = totalUnits > 0 ? totalWithFreight / totalUnits : unitPrice;

        if (realUnitPrice > 0) {
          await supabase.rpc('fn_update_ingredient_price_from_purchase', {
            p_ingredient_id: item.ingredient_id,
            p_tenant_id: tenant_id,
            p_purchase_unit_price: realUnitPrice,
            p_purchase_date: purchase.purchase_date,
          });
        }
      }
    }

    // Atualizar total da compra com base no recebido
    const originalTotal = Number(purchase.total_amount ?? 0);

    // Safety: se newTotalAmount zerou inesperadamente, mantém o original
    if (newTotalAmount === 0 && originalTotal > 0 && items.length > 0) {
      newTotalAmount = originalTotal;
    }

    await supabase.from('fin_purchases').update({
      delivery_confirmed_at: confirmedAt,
      delivery_notes: delivery_notes || null,
      total_amount: newTotalAmount,
    }).eq('id', purchase_id).eq('tenant_id', tenant_id);

    // Ajustar contas a pagar pendentes proporcionalmente
    if (newTotalAmount !== originalTotal) {
      const { data: pendingBills } = await supabase
        .from('fin_accounts_payable')
        .select('id, amount, status')
        .eq('reference_id', purchase_id)
        .eq('tenant_id', tenant_id)
        .neq('status', 'paid')
        .order('installment_number');

      if (pendingBills && pendingBills.length > 0) {
        const ratio = newTotalAmount / originalTotal;
        let distributed = 0;

        for (let i = 0; i < pendingBills.length; i++) {
          const bill = pendingBills[i];
          const originalBillAmount = Number(bill.amount);
          let newBillAmount: number;

          if (i === pendingBills.length - 1) {
            newBillAmount = Math.round((newTotalAmount - distributed) * 100) / 100;
          } else {
            newBillAmount = Math.round(originalBillAmount * ratio * 100) / 100;
          }

          distributed += newBillAmount;

          await supabase.from('fin_accounts_payable').update({
            amount: newBillAmount,
            delivery_confirmed: true,
            delivery_confirmed_at: confirmedAt,
          }).eq('id', bill.id).eq('tenant_id', tenant_id);
        }
      }
    } else {
      await supabase.from('fin_accounts_payable').update({
        delivery_confirmed: true,
        delivery_confirmed_at: confirmedAt,
      }).eq('reference_id', purchase_id).eq('tenant_id', tenant_id).neq('status', 'paid');
    }

    return new Response(
      JSON.stringify({
        data: {
          confirmed_at: confirmedAt,
          purchase_id,
          new_total_amount: newTotalAmount,
          original_total: originalTotal,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[purchase-confirm-delivery] Error:', String(err));
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
