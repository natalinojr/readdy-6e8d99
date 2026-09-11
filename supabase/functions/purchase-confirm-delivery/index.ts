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

    const { purchase_id, delivery_notes, received_items, received_at } = payload;
    if (!purchase_id) return new Response(JSON.stringify({ error: 'purchase_id required' }), { status: 400, headers: corsHeaders });

    const { data: purchase, error: purchaseErr } = await supabase
      .from('fin_purchases')
      .select('*, items:fin_purchase_items(*)')
      .eq('id', purchase_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (purchaseErr || !purchase) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });
    // CNPJ do fornecedor: sugere e memoriza o vínculo item → insumo por (CNPJ, código do produto)
    let supplierCnpj = '';
    {
      const base = supabase.from('fin_suppliers').select('cnpj').eq('tenant_id', tenant_id);
      const { data: sp } = await (purchase.supplier_id ? base.eq('id', purchase.supplier_id) : base.ilike('name', String(purchase.supplier ?? '').trim())).limit(1).maybeSingle();
      supplierCnpj = String(sp?.cnpj ?? '').replace(/\D/g, '');
      if (!supplierCnpj) {
        const { data: fd } = await supabase.from('fiscal_inbound_documents').select('emitente_cnpj').eq('tenant_id', tenant_id).eq('purchase_id', purchase_id).limit(1).maybeSingle();
        supplierCnpj = String(fd?.emitente_cnpj ?? '').replace(/\D/g, '');
      }
    }

    // Tela de recebimento: lista de insumos + sugestão de vínculo para cada item.
    // Ordem: o que já está na compra → memorizado do fornecedor (código/EAN) → histórico pela descrição.
    if (body.action === 'receipt_context') {
      const its = (purchase.items ?? []) as Array<Record<string, any>>;
      const codes = [...new Set(its.map((i) => String(i.supplier_code ?? '').trim()).filter(Boolean))];
      const eans = [...new Set(its.map((i) => String(i.ean ?? '').trim()).filter(Boolean))];
      const descs = [...new Set(its.filter((i) => !i.ingredient_id).map((i) => String(i.description ?? '')).filter(Boolean))].slice(0, 80);
      const [ingsRes, memoRes, eanRes, histRes] = await Promise.all([
        supabase.from('ingredients').select('id, name, unit, purchase_unit, purchase_factor').eq('tenant_id', tenant_id).is('deleted_at', null).order('name').limit(3000),
        supplierCnpj && codes.length
          ? supabase.from('fiscal_inbound_item_links').select('supplier_code, ingredient_id, units_per_package').eq('tenant_id', tenant_id).eq('supplier_cnpj', supplierCnpj).in('supplier_code', codes)
          : Promise.resolve({ data: [] as any[] }),
        eans.length
          ? supabase.from('fiscal_inbound_item_links').select('ean, ingredient_id, units_per_package').eq('tenant_id', tenant_id).in('ean', eans)
          : Promise.resolve({ data: [] as any[] }),
        descs.length
          ? supabase.from('fin_purchase_items').select('description, ingredient_id, units_per_package').eq('tenant_id', tenant_id).not('ingredient_id', 'is', null).in('description', descs).limit(500)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const ings = (ingsRes.data ?? []) as any[];
      const valid = new Set(ings.map((i) => String(i.id)));
      const byCode = new Map(((memoRes.data ?? []) as any[]).map((l) => [String(l.supplier_code), l]));
      const byEan = new Map(((eanRes.data ?? []) as any[]).map((l) => [String(l.ean), l]));
      const byDesc = new Map<string, any>();
      for (const h of (histRes.data ?? []) as any[]) if (!byDesc.has(String(h.description))) byDesc.set(String(h.description), h);
      const suggestions: Record<string, { ingredient_id: string; units_per_package: number; source: string }> = {};
      for (const it of its) {
        if (it.ingredient_id) {
          suggestions[it.id] = { ingredient_id: String(it.ingredient_id), units_per_package: Number(it.units_per_package ?? 1) || 1, source: 'compra' };
          continue;
        }
        const code = String(it.supplier_code ?? '').trim();
        const ean = String(it.ean ?? '').trim();
        const m = (code && byCode.get(code)) || (ean && byEan.get(ean)) || null;
        const h = byDesc.get(String(it.description ?? ''));
        const pick = m ? { l: m, s: 'memorizado' } : h ? { l: h, s: 'historico' } : null;
        if (pick && valid.has(String(pick.l.ingredient_id))) {
          suggestions[it.id] = { ingredient_id: String(pick.l.ingredient_id), units_per_package: Number(pick.l.units_per_package ?? 1) || 1, source: pick.s };
        }
      }
      return new Response(JSON.stringify({ ingredients: ings, suggestions, stock_already_applied: Boolean(purchase.stock_applied_at) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (purchase.delivery_confirmed_at) return new Response(JSON.stringify({ error: 'Recebimento já confirmado anteriormente' }), { status: 409, headers: corsHeaders });

    // Data em que a mercadoria chegou, escolhida pelo usuário (AAAA-MM-DD). Sem data = agora.
    // Gravada ao meio-dia de Brasília para não trocar de dia por causa do fuso.
    const hojeBR = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    let confirmedAt = new Date().toISOString();
    if (received_at != null && received_at !== '') {
      const d = String(received_at).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Response(JSON.stringify({ error: 'Data do recebimento inválida' }), { status: 400, headers: corsHeaders });
      if (d > hojeBR) return new Response(JSON.stringify({ error: 'A data do recebimento não pode ser no futuro' }), { status: 400, headers: corsHeaders });
      confirmedAt = new Date(d + 'T12:00:00-03:00').toISOString();
    }

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

    // Vínculo item → insumo escolhido no recebimento (2026-09-11). O item recém-vinculado
    // entra INTEIRO no estoque, mesmo em compra antiga (a entrada da criação não o incluiu).
    // Em compra antiga, item que JÁ tinha insumo não troca (o estoque dele já entrou).
    const newlyLinked = new Set<string>();
    const linkChanges: Array<{ item: Record<string, unknown>; ingredient_id: string | null; upp: number }> = [];
    if (Array.isArray(received_items)) {
      const withLink = (received_items as any[]).filter((ri) => ri && Object.prototype.hasOwnProperty.call(ri, 'ingredient_id'));
      const wanted = [...new Set(withLink.map((ri) => ri.ingredient_id).filter(Boolean).map(String))];
      const { data: validIngs } = wanted.length
        ? await supabase.from('ingredients').select('id').eq('tenant_id', tenant_id).is('deleted_at', null).in('id', wanted)
        : { data: [] as any[] };
      const valid = new Set((validIngs ?? []).map((v: any) => String(v.id)));
      if (wanted.some((w) => !valid.has(w))) return new Response(JSON.stringify({ error: 'Insumo inválido para esta loja' }), { status: 400, headers: corsHeaders });
      const itemsList = (purchase.items ?? []) as Array<Record<string, unknown>>;
      for (const ri of withLink) {
        const item = itemsList.find((it) => it.id === ri.item_id);
        if (!item) continue;
        const ing = ri.ingredient_id ? String(ri.ingredient_id) : null;
        const upp = Number(ri.units_per_package) > 0 ? Number(ri.units_per_package) : (Number(item.units_per_package ?? 1) || 1);
        const before = item.ingredient_id ? String(item.ingredient_id) : null;
        if (purchase.stock_applied_at && before) continue;
        if (ing !== before || upp !== (Number(item.units_per_package ?? 1) || 1)) {
          const qty = Number(item.quantity ?? 0);
          const costBase = qty * upp > 0 ? (Number(item.total_price ?? 0) + Number(item.freight_allocated ?? 0)) / (qty * upp) : null;
          await supabase.from('fin_purchase_items').update({ ingredient_id: ing, units_per_package: upp, cost_per_base_unit: costBase }).eq('id', item.id as string).eq('tenant_id', tenant_id);
          if (!before && ing) newlyLinked.add(String(item.id));
          item.ingredient_id = ing;
          item.units_per_package = upp;
        }
        linkChanges.push({ item, ingredient_id: ing, upp });
      }
    }

    let newTotalAmount = 0;
    const items = (purchase.items ?? []) as Array<Record<string, unknown>>;
    // Desde 2026-09-11 o estoque só entra no recebimento: compra sem stock_applied_at
    // recebe aqui a entrada INTEIRA (quantidade recebida). Compra antiga, cuja entrada
    // já foi feita na criação, recebe só o delta recebido − pedido.
    const stockAlreadyApplied = Boolean(purchase.stock_applied_at);

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
        // quantity/received_quantity estao em unidades de COMPRA; units_per_package
        // converte para unidades de estoque.
        const unitsPerPkg = Number(item.units_per_package ?? 1);
        const factor = unitsPerPkg > 0 ? unitsPerPkg : 1;

        // Entrada inteira: compra nova (estoque só no recebimento) ou item vinculado agora
        if (!stockAlreadyApplied || newlyLinked.has(itemId)) {
          const entrada = receivedQty * factor;
          if (entrada > 0) {
            const { error: mvErr } = await supabase.rpc('fn_add_stock_movement', {
              p_tenant_id: tenant_id,
              p_ingredient_id: item.ingredient_id,
              p_type: 'in',
              p_quantity: entrada,
              p_unit: null,
              p_reason: `Compra: ${purchase.supplier} - NF ${purchase.invoice_number || 'S/N'}`,
              p_notes: receivedQty !== originalQty ? `recebido=${receivedQty} pedido=${originalQty} upp=${factor}` : null,
              p_order_id: null,
              p_operator_id: user.id,
              p_batch_id: null,
            });
            if (mvErr) console.error('[purchase-confirm-delivery] entrada fn_add_stock_movement error:', mvErr.message ?? mvErr);
          }
        }

        // Compra antiga: o estoque já entrou por completo na criação; aplica só o DELTA
        const deltaStock = stockAlreadyApplied && !newlyLinked.has(itemId) ? (receivedQty - originalQty) * factor : 0;
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

    // Memoriza o vínculo (fornecedor + código do produto) para as próximas notas e recebimentos
    if (supplierCnpj) {
      const nowIso = new Date().toISOString();
      for (const ch of linkChanges) {
        const code = String(ch.item.supplier_code ?? '').trim();
        if (!code) continue;
        if (!ch.ingredient_id) {
          await supabase.from('fiscal_inbound_item_links').delete().eq('tenant_id', tenant_id).eq('supplier_cnpj', supplierCnpj).eq('supplier_code', code);
          continue;
        }
        const { error: lkErr } = await supabase.from('fiscal_inbound_item_links').upsert({
          tenant_id, supplier_cnpj: supplierCnpj, supplier_code: code, ean: ch.item.ean ?? null,
          description: String(ch.item.description ?? '').slice(0, 250) || null, unit_label: ch.item.unit_label ?? null,
          ingredient_id: ch.ingredient_id, units_per_package: ch.upp, updated_by: user.id, updated_at: nowIso,
        }, { onConflict: 'tenant_id,supplier_cnpj,supplier_code' });
        if (lkErr) console.error('[purchase-confirm-delivery] memorizar vínculo:', lkErr.message);
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
      ...(stockAlreadyApplied ? {} : { stock_applied_at: confirmedAt }),
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
