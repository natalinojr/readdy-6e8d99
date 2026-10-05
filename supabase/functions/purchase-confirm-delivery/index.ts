import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cnpjDaCompra, ligarItem, vinculosMemorizados } from '../_shared/vinculos-memorizados.ts';

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

    const { purchase_id, delivery_notes, received_items, received_at, received_time } = payload;
    if (!purchase_id) return new Response(JSON.stringify({ error: 'purchase_id required' }), { status: 400, headers: corsHeaders });

    const { data: purchase, error: purchaseErr } = await supabase
      .from('fin_purchases')
      .select('*, items:fin_purchase_items(*)')
      .eq('id', purchase_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (purchaseErr || !purchase) return new Response(JSON.stringify({ error: 'Compra não encontrada' }), { status: 404, headers: corsHeaders });
    // CNPJ do fornecedor: sugere e memoriza o vínculo item → insumo por (CNPJ, código do produto)
    const supplierCnpj = await cnpjDaCompra(supabase, tenant_id, purchase);

    // Tela de recebimento: lista de insumos + vínculo de cada item.
    // Só o que já está na compra ou o vínculo memorizado exato (o mesmo que a confirmação aplica:
    // CNPJ + código/EAN ou Classificação de itens). Sem "histórico pela descrição" (regra do dono,
    // 2026-09-24): item sem vínculo fica fora do estoque até ser ligado na Classificação de itens.
    if (body.action === 'receipt_context') {
      // "Acréscimos da nota" (ICMS-ST, IPI...) é valor, não produto: sem sugestão de insumo
      const its = ((purchase.items ?? []) as Array<Record<string, any>>)
        .filter((i) => !String(i.description ?? '').startsWith('Acréscimos da nota'));
      const [ingsRes, memo] = await Promise.all([
        supabase.from('ingredients').select('id, name, unit, purchase_unit, purchase_factor').eq('tenant_id', tenant_id).is('deleted_at', null).order('name').limit(3000),
        vinculosMemorizados(supabase, tenant_id, supplierCnpj, its, purchase_id),
      ]);
      const ings = (ingsRes.data ?? []) as any[];
      const suggestions: Record<string, { ingredient_id: string; units_per_package: number; source: string }> = {};
      for (const it of its) {
        if (it.ingredient_id) {
          suggestions[it.id] = { ingredient_id: String(it.ingredient_id), units_per_package: Number(it.units_per_package ?? 1) || 1, source: 'compra' };
          continue;
        }
        const m = memo.get(String(it.id));
        if (m) suggestions[it.id] = { ingredient_id: m.ingredient_id, units_per_package: m.units_per_package, source: 'memorizado' };
      }
      return new Response(JSON.stringify({ ingredients: ings, suggestions, stock_already_applied: Boolean(purchase.stock_applied_at) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Data em que a mercadoria chegou, escolhida pelo usuário (AAAA-MM-DD). Sem data = agora.
    // Gravada ao meio-dia de Brasília para não trocar de dia por causa do fuso.
    const hojeBR = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const lerData = (v: unknown, hora?: unknown): string | Response => {
      const d = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Response(JSON.stringify({ error: 'Data do recebimento inválida' }), { status: 400, headers: corsHeaders });
      if (d > hojeBR) return new Response(JSON.stringify({ error: 'A data do recebimento não pode ser no futuro' }), { status: 400, headers: corsHeaders });
      // Hora informada (HH:MM de Brasília): vale a hora real em que a mercadoria chegou, para comparar com a contagem
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora ?? ''))) {
        const t = new Date(`${d}T${String(hora)}:00-03:00`);
        if (t.getTime() > Date.now()) return new Response(JSON.stringify({ error: 'A hora do recebimento não pode ser no futuro' }), { status: 400, headers: corsHeaders });
        return t.toISOString();
      }
      // Hoje = agora (meio-dia de hoje ficava no futuro de manhã e escondia a contagem feita depois)
      if (d === hojeBR) return new Date().toISOString();
      return new Date(d + 'T12:00:00-03:00').toISOString();
    };
    // Primeira contagem do insumo entre duas datas (sessão de inventário, mesmo sem diferença, ou ajuste).
    const primeiraContagemEntre = async (ing: string, de: string, ate: string) => {
      const [a, b] = de < ate ? [de, ate] : [ate, de];
      const { data, error } = await supabase.rpc('fn_insumo_contado_entre', { p_tenant: tenant_id, p_ingredient: ing, p_de: a, p_ate: b });
      if (error) console.error('[purchase-confirm-delivery] contagem:', error.message);
      return (data as string | null) ?? null;
    };

    // Corrigir a data do recebimento já confirmado (2026-09-28): leva junto a data da entrada no
    // estoque desta compra (movimentos com purchase_id), a da conta a pagar e a da lista de Compras.
    // Mesmo lado da contagem: o saldo não muda, só o dia da entrada.
    // Atravessando uma contagem (dono, 2026-09-29): o que chegou antes da contagem já foi contado —
    // entrada que vai para ANTES da contagem sai do estoque; a que vai para DEPOIS entra. A correção é
    // um ajuste de inventário na hora da contagem (o ajuste daquela contagem estava errado por essa
    // quantidade) e só é feita com confirmar_contagem: true — sem isso, devolve o que mudaria.
    if (body.action === 'change_received_at') {
      if (!purchase.delivery_confirmed_at) return new Response(JSON.stringify({ error: 'Esta compra ainda não foi recebida' }), { status: 400, headers: corsHeaders });
      const novo = lerData(received_at);
      if (novo instanceof Response) return novo;
      const antigo = String(purchase.delivery_confirmed_at);
      const { data: movs, error: mvErr } = await supabase.from('stock_movements').select('id, ingredient_id, created_at, quantity, signed_quantity, type, unit')
        .eq('tenant_id', tenant_id).eq('purchase_id', purchase_id).neq('type', 'inventory_adjustment');
      if (mvErr) return new Response(JSON.stringify({ error: mvErr.message }), { status: 500, headers: corsHeaders });
      const lista = (movs ?? []) as Array<{ id: string; ingredient_id: string; created_at: string; quantity: number; signed_quantity: number | null; type: string; unit: string | null }>;
      const ajustes: Array<{ ingredient_id: string; delta: number; contagem: string; unit: string | null }> = [];
      for (const m of lista) {
        if (m.created_at === novo) continue;
        const cont = await primeiraContagemEntre(m.ingredient_id, m.created_at, novo);
        if (!cont) continue;
        const q = m.signed_quantity != null ? Number(m.signed_quantity) : Number(m.quantity) * (m.type === 'out' ? -1 : 1);
        if (!q) continue;
        // Indo para antes da contagem: a contagem já tinha essa mercadoria → sai. Indo para depois → entra.
        ajustes.push({ ingredient_id: m.ingredient_id, delta: novo < m.created_at ? -q : q, contagem: cont, unit: m.unit });
      }
      if (ajustes.length && body.confirmar_contagem !== true) {
        const { data: ings } = await supabase.from('ingredients').select('id, name, unit, current_stock')
          .eq('tenant_id', tenant_id).in('id', [...new Set(ajustes.map((a) => a.ingredient_id))]);
        const porId = new Map(((ings ?? []) as any[]).map((g) => [String(g.id), g]));
        const saldo = new Map<string, number>();
        const itens = ajustes.map((a) => {
          const g = porId.get(a.ingredient_id);
          const atual = saldo.has(a.ingredient_id) ? saldo.get(a.ingredient_id)! : Number(g?.current_stock ?? 0);
          saldo.set(a.ingredient_id, atual + a.delta);
          return { insumo: g?.name ?? 'Insumo', unidade: (({ unit: 'un', unidade: 'un' } as Record<string, string>)[String(g?.unit ?? a.unit ?? '')] ?? String(g?.unit ?? a.unit ?? '')), delta: a.delta, estoque_atual: atual, estoque_novo: atual + a.delta, contagem: diaBR(a.contagem) };
        });
        const contagens = [...new Set(itens.map((i) => i.contagem))].join(', ');
        return new Response(JSON.stringify({
          precisa_confirmar: true,
          mensagem: novo < antigo
            ? `Houve contagem de estoque em ${contagens}. A mercadoria chegou antes e já foi contada, então a entrada sai do estoque.`
            : `Houve contagem de estoque em ${contagens}. A mercadoria chegou depois, então não foi contada e a entrada soma no estoque.`,
          itens,
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { error: upErr } = await supabase.from('fin_purchases').update({
        delivery_confirmed_at: novo,
        // Compra cujo estoque entrou no recebimento: a data da entrada acompanha
        ...(purchase.stock_applied_at === antigo ? { stock_applied_at: novo } : {}),
      }).eq('id', purchase_id).eq('tenant_id', tenant_id).eq('delivery_confirmed_at', antigo);
      if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: corsHeaders });
      if (lista.length) {
        // A correção da contagem (inventory_adjustment ligado à compra) fica na data da contagem
        const { error: e2 } = await supabase.from('stock_movements').update({ created_at: novo })
          .eq('tenant_id', tenant_id).eq('purchase_id', purchase_id).neq('type', 'inventory_adjustment');
        if (e2) return new Response(JSON.stringify({ error: 'Data da compra mudou, mas a do estoque não: ' + e2.message }), { status: 500, headers: corsHeaders });
      }
      await supabase.from('fin_accounts_payable').update({ delivery_confirmed_at: novo })
        .eq('reference_id', purchase_id).eq('tenant_id', tenant_id).not('delivery_confirmed_at', 'is', null);
      const dataNota = String(purchase.invoice_number ? `NF ${purchase.invoice_number}` : 'compra');
      for (const a of ajustes) {
        const { error: eAj } = await supabase.from('stock_movements').insert({
          tenant_id, ingredient_id: a.ingredient_id, type: 'inventory_adjustment', quantity: Math.abs(a.delta), signed_quantity: a.delta,
          unit: a.unit, reason: 'Correção da contagem: data do recebimento mudou',
          notes: `${dataNota} (${purchase.supplier ?? ''}) recebida em ${diaBR(novo)} — antes em ${diaBR(antigo)}; contagem de ${diaBR(a.contagem)}`,
          operator_id: user.id, purchase_id, created_at: a.contagem,
        });
        if (eAj) return new Response(JSON.stringify({ error: 'Data mudou, mas a correção do estoque falhou: ' + eAj.message }), { status: 500, headers: corsHeaders });
        const { error: eSt } = await supabase.rpc('fn_update_ingredient_stock', { p_ingredient_id: a.ingredient_id, p_tenant_id: tenant_id, p_delta: a.delta });
        if (eSt) return new Response(JSON.stringify({ error: 'Data mudou, mas o saldo do estoque não: ' + eSt.message }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ data: { confirmed_at: novo, movimentos: lista.length, ajustes: ajustes.length } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (purchase.delivery_confirmed_at) return new Response(JSON.stringify({ error: 'Recebimento já confirmado anteriormente' }), { status: 409, headers: corsHeaders });

    let confirmedAt = new Date().toISOString();
    if (received_at != null && received_at !== '') {
      const d = lerData(received_at, received_time);
      if (d instanceof Response) return d;
      confirmedAt = d;
    }
    // Movimento de estoque do recebimento: fica ligado à compra e com a data do recebimento
    // (se não houver contagem do insumo depois dessa data; senão fica na hora de agora).
    const nowIso = new Date().toISOString();
    // Regra única (fn_insumo_contado_entre, 2026-09-30): recebimento com data passada cujo insumo foi
    // contado depois NÃO entra — a contagem já pôs a mercadoria no estoque (antes somava em dobro).
    const naoEntram: string[] = [];
    const contadoDepois = async (ingredientId: string): Promise<boolean> => {
      if (!(confirmedAt < nowIso)) return false;
      const { data, error } = await supabase.rpc('fn_insumo_contado_entre', {
        p_tenant: tenant_id, p_ingredient: ingredientId, p_de: confirmedAt, p_ate: nowIso,
      });
      if (error) throw new Error('Não foi possível conferir o inventário: ' + error.message);
      return !!data;
    };
    const datarMovimento = async (res: unknown, _ingredientId: string) => {
      const movId = (res as { movement_id?: string } | null)?.movement_id;
      if (!movId) return;
      const { error } = await supabase.from('stock_movements')
        .update({ purchase_id, created_at: confirmedAt })
        .eq('id', movId).eq('tenant_id', tenant_id);
      if (error) console.error('[purchase-confirm-delivery] datar movimento:', error.message);
    };

    // Valida os insumos escolhidos ANTES da trava: um 400 aqui não pode deixar a compra "confirmada".
    const withLink = Array.isArray(received_items)
      ? (received_items as any[]).filter((ri) => ri && Object.prototype.hasOwnProperty.call(ri, 'ingredient_id'))
      : [];
    {
      const wanted = [...new Set(withLink.map((ri) => ri.ingredient_id).filter(Boolean).map(String))];
      const { data: validIngs, error: ingErr } = wanted.length
        ? await supabase.from('ingredients').select('id').eq('tenant_id', tenant_id).is('deleted_at', null).in('id', wanted)
        : { data: [] as any[], error: null };
      if (ingErr) return new Response(JSON.stringify({ error: ingErr.message }), { status: 500, headers: corsHeaders });
      const valid = new Set((validIngs ?? []).map((v: any) => String(v.id)));
      if (wanted.some((w) => !valid.has(w))) return new Response(JSON.stringify({ error: 'Insumo inválido para esta loja' }), { status: 400, headers: corsHeaders });
    }

    // Trava atômica ANTES de mexer em vínculo/estoque (2026-09-17): duas confirmações
    // simultâneas passavam pelo check acima e o estoque entrava 2×. Só quem gravar
    // delivery_confirmed_at enquanto ainda está nulo segue.
    const { data: locked, error: lockErr } = await supabase
      .from('fin_purchases')
      .update({
        delivery_confirmed_at: confirmedAt,
        // Momento REAL em que alguém registrou o recebimento (delivery_confirmed_at pode ser só a data
        // escolhida, gravada ao meio-dia) — base para decidir o que entra ou não no estoque.
        delivery_registered_at: nowIso,
        delivery_notes: delivery_notes || null,
        ...(purchase.stock_applied_at ? {} : { stock_applied_at: confirmedAt }),
      })
      .eq('id', purchase_id)
      .eq('tenant_id', tenant_id)
      .is('delivery_confirmed_at', null)
      .select('id');
    if (lockErr) return new Response(JSON.stringify({ error: lockErr.message }), { status: 500, headers: corsHeaders });
    if (!locked || locked.length === 0) return new Response(JSON.stringify({ error: 'Recebimento já confirmado' }), { status: 409, headers: corsHeaders });

    // Depois da trava: se algo falhar ANTES de gravar movimento de estoque, desfaz a trava para
    // permitir tentar de novo. Com movimento gravado, não desfaz (repetir lançaria estoque 2×).
    let stockMoved = false;
    try {

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

      // Item que quem confirmou não mencionou (sem ingredient_id no payload, ex. assistente) e
      // tem vínculo memorizado: entra ligado, como a tela faria com a sugestão (2026-09-24).
      // "Sem insumo" escolhido explicitamente (ingredient_id: null) é respeitado.
      {
        const mencionados = new Set(withLink.map((ri) => String(ri.item_id)));
        const itemsList = (purchase.items ?? []) as Array<Record<string, unknown>>;
        const livres = itemsList.filter((it) => !mencionados.has(String(it.id)));
        const memo = await vinculosMemorizados(supabase, tenant_id, supplierCnpj, livres, purchase_id);
        for (const it of livres) {
          const v = memo.get(String(it.id));
          if (v && await ligarItem(supabase, tenant_id, it, v)) newlyLinked.add(String(it.id));
        }
      }

      let receivedItemsTotal = 0;
      let orderedItemsTotal = 0;
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

        receivedItemsTotal += receivedTotal;
        orderedItemsTotal += originalTotal;

        if (item.ingredient_id) {
          // quantity/received_quantity estao em unidades de COMPRA; units_per_package
          // converte para unidades de estoque.
          const unitsPerPkg = Number(item.units_per_package ?? 1);
          const factor = unitsPerPkg > 0 ? unitsPerPkg : 1;

          // Entrada inteira: compra nova (estoque só no recebimento) ou item vinculado agora
          const jaContado = await contadoDepois(String(item.ingredient_id));
          if (jaContado) naoEntram.push(String(item.description ?? itemId));
          if ((!stockAlreadyApplied || newlyLinked.has(itemId)) && !jaContado) {
            const entrada = receivedQty * factor;
            if (entrada > 0) {
              stockMoved = true; // a partir daqui a trava não é mais desfeita
              const { data: mvRes, error: mvErr } = await supabase.rpc('fn_add_stock_movement', {
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
              else await datarMovimento(mvRes, String(item.ingredient_id));
            }
          }

          // Compra antiga: o estoque já entrou por completo na criação; aplica só o DELTA
          const deltaStock = stockAlreadyApplied && !newlyLinked.has(itemId) && !jaContado ? (receivedQty - originalQty) * factor : 0;
          if (deltaStock !== 0) {
            stockMoved = true; // a partir daqui a trava não é mais desfeita
            const { data: mvRes, error: mvErr } = await supabase.rpc('fn_add_stock_movement', {
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
            else await datarMovimento(mvRes, String(item.ingredient_id));
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
      const round2 = (v: number) => Math.round(v * 100) / 100;

      // Novo total = total original + diferença (recebido − pedido) dos itens. purchase-write grava
      // total_amount = soma dos itens (líquidos de desconto) + frete; aplicar só a diferença
      // preserva o frete e qualquer acréscimo do cabeçalho (antes o frete sumia da conta).
      let newTotalAmount = round2(originalTotal + (receivedItemsTotal - orderedItemsTotal));

      // Safety: se o recebido zerou inesperadamente (ou o total ficaria negativo), mantém o original
      if ((receivedItemsTotal === 0 && originalTotal > 0 && items.length > 0) || newTotalAmount < 0) {
        newTotalAmount = originalTotal;
      }

      await supabase.from('fin_purchases').update({
        total_amount: newTotalAmount,
      }).eq('id', purchase_id).eq('tenant_id', tenant_id);

      let aviso: string | null = null;
      const markConfirmed = () => supabase.from('fin_accounts_payable').update({
        delivery_confirmed: true,
        delivery_confirmed_at: confirmedAt,
      }).eq('reference_id', purchase_id).eq('tenant_id', tenant_id).neq('status', 'paid');

      // Ajustar contas a pagar pendentes proporcionalmente
      if (Math.abs(newTotalAmount - originalTotal) > 0.004) {
        const { data: allBills } = await supabase
          .from('fin_accounts_payable')
          .select('id, amount, status, paid_amount')
          .eq('reference_id', purchase_id)
          .eq('tenant_id', tenant_id)
          .order('installment_number');

        const bills = (allBills ?? []) as Array<{ id: string; amount: number; status: string; paid_amount: number | null }>;
        const paidBills = bills.filter((b) => b.status === 'paid');
        const pendingBills = bills.filter((b) => b.status !== 'paid');
        // Parcelas já pagas não mudam: entram como já distribuídas.
        const paidSum = round2(paidBills.reduce((s, b) => s + Number(b.amount ?? 0), 0));
        const remaining = round2(newTotalAmount - paidSum);
        const pendingOriginal = pendingBills.reduce((s, b) => s + Number(b.amount ?? 0), 0);

        if (pendingBills.length > 0) {
          const newAmounts: number[] = [];
          let distributed = paidSum;
          const ratio = pendingOriginal > 0 ? remaining / pendingOriginal : 0;
          for (let i = 0; i < pendingBills.length; i++) {
            const bill = pendingBills[i];
            const amt = i === pendingBills.length - 1
              ? round2(newTotalAmount - distributed)
              : round2(Number(bill.amount ?? 0) * ratio);
            distributed = round2(distributed + amt);
            newAmounts.push(amt);
          }
          // Não ajusta se o novo total não cobre o que já foi pago (inteiro ou parcial)
          const invalid = remaining < 0 || pendingOriginal <= 0 ||
            pendingBills.some((b, i) => newAmounts[i] < 0 || newAmounts[i] < round2(Number(b.paid_amount ?? 0)));
          if (invalid) {
            aviso = `Contas a pagar NÃO foram ajustadas: o novo total (R$ ${newTotalAmount.toFixed(2)}) é menor que o já pago (R$ ${paidSum.toFixed(2)}${pendingBills.some((b) => Number(b.paid_amount ?? 0) > 0) ? ' + pagamentos parciais' : ''}). Ajuste as contas manualmente.`;
            await markConfirmed();
          } else {
            for (let i = 0; i < pendingBills.length; i++) {
              await supabase.from('fin_accounts_payable').update({
                amount: newAmounts[i],
                delivery_confirmed: true,
                delivery_confirmed_at: confirmedAt,
              }).eq('id', pendingBills[i].id).eq('tenant_id', tenant_id);
            }
          }
        } else if (paidBills.length > 0) {
          aviso = `Contas a pagar NÃO foram ajustadas: todas já estão pagas (R$ ${paidSum.toFixed(2)}) e o total recebido é R$ ${newTotalAmount.toFixed(2)}.`;
        }
      } else {
        await markConfirmed();
      }

      return new Response(
        JSON.stringify({
          data: {
            confirmed_at: confirmedAt,
            purchase_id,
            new_total_amount: newTotalAmount,
            original_total: originalTotal,
            ...(aviso || naoEntram.length ? {
              aviso: [aviso, naoEntram.length
                ? `Não entraram no estoque porque foram contados no inventário depois do recebimento (a contagem já os incluiu): ${naoEntram.join(', ')}.`
                : ''].filter(Boolean).join(' '),
            } : {}),
            ...(naoEntram.length ? { nao_entraram_por_contagem: naoEntram } : {}),
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } catch (innerErr) {
      console.error('[purchase-confirm-delivery] falha após a trava:', String(innerErr), { purchase_id, stockMoved });
      if (!stockMoved) {
        const { error: undoErr } = await supabase.from('fin_purchases').update({
          delivery_confirmed_at: null,
          delivery_registered_at: null,
          delivery_notes: purchase.delivery_notes ?? null,
          stock_applied_at: purchase.stock_applied_at ?? null,
        }).eq('id', purchase_id).eq('tenant_id', tenant_id).eq('delivery_confirmed_at', confirmedAt);
        if (undoErr) console.error('[purchase-confirm-delivery] desfazer trava falhou:', undoErr.message);
        return new Response(JSON.stringify({ error: `Não foi possível confirmar o recebimento (nada foi lançado no estoque, pode tentar de novo): ${String(innerErr)}` }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ error: `Recebimento confirmado e estoque lançado, mas houve erro depois (total/contas a pagar podem não ter sido ajustados; NÃO confirme de novo, confira a compra): ${String(innerErr)}` }), { status: 500, headers: corsHeaders });
    }
  } catch (err) {
    console.error('[purchase-confirm-delivery] Error:', String(err));
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
