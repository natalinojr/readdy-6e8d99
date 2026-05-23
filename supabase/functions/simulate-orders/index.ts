import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Schema correto do banco ───────────────────────────────────────────────────
// orders: origin_type (order_origin enum), destination_type (order_destination enum)
// order_origin: cashier | waiter | table | self_service | delivery
// order_destination: immediate | table | delivery | name | password
// order_status: draft | new | preparing | ready | delivered | cancelled
// order_items: sem coluna "updated_at" — só created_at, status, skip_kds, etc.
// cash_movements: type = 'in' (suprimento) | 'out' (sangria)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? 'run';

    // ── Ação: limpar pedidos SIM com problemas ────────────────────────────────
    if (action === 'cleanup') {
      const { data: badOrders } = await supabase
        .from('orders')
        .select('id')
        .like('number', 'SIM%')
        .eq('tenant_id', '9063797b-a50b-4d9a-ac09-d232ddcd48d1');

      return new Response(JSON.stringify({ ok: true, found: badOrders?.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Dados fixos ───────────────────────────────────────────────────────────
    const TENANT_ID  = '9063797b-a50b-4d9a-ac09-d232ddcd48d1';
    const SESSION_ID = 'a99baa77-a342-4d85-8634-6911f843db11';
    const CASH_REG   = '19d63118-7247-4efb-bb33-ac0915525f48';

    // Itens do cardápio (verificados no banco)
    const ITEMS = [
      { id: '3bd27c52-fcf1-4cb2-8c9a-e82ce822d3f9', name: 'Coca-cola',        price: 8.00,  skip_kds: true  },
      { id: 'f1a2b3c4-0001-0001-0001-000000000001', name: 'Picanha Grelhada', price: 89.90, skip_kds: false },
      { id: '93de3ad8-58bc-4ee6-a00a-97cd87732462', name: 'Al pastor',        price: 38.00, skip_kds: false },
      { id: 'd6135c9c-2b51-40be-818d-af6c4c50d12a', name: 'Classic',          price: 38.00, skip_kds: false },
    ];

    // Métodos de pagamento
    const PAYMENTS = [
      'c5cf6e52-97f8-4f74-8023-6e84eccfc938', // PIX
      'ef8f159c-fec2-4522-977b-76be42011013', // Dinheiro
      'ada729eb-f3bc-4b9e-8c3e-78d6265f693e', // Crédito
      '6a9fba05-6085-45be-990d-8832c7a0059b', // Débito
    ];

    // Mesas (números 1-20)
    const TABLE_NUMBERS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];

    // ── Verificar quais prefixos já existem ──────────────────────────────────
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('number')
      .like('number', 'SIM%')
      .eq('tenant_id', TENANT_ID);

    const existingNumbers = new Set((existingOrders ?? []).map((o: { number: string }) => o.number));

    // ── Definir todos os 200 cenários ────────────────────────────────────────
    type Scenario = {
      prefix: string;
      num: number;
      origin_type: string;
      destination_type: string;
      status: string;
      paid: boolean;
      table_number: number | null;
      destination_name: string;
      delivery_address: string | null;
      delivery_fee: number;
      qty: number;
    };

    const scenarios: Scenario[] = [];

    const statuses = ['new', 'preparing', 'ready', 'delivered', 'cancelled'];

    // ── BLOCO 1: 40 pedidos self_service (totem) ─────────────────────────────
    for (let i = 1; i <= 40; i++) {
      const st = statuses[(i - 1) % 5];
      scenarios.push({
        prefix: 'SIM-SS',
        num: i,
        origin_type: 'self_service',
        destination_type: i % 2 === 0 ? 'name' : 'immediate',
        status: st,
        paid: st === 'delivered',
        table_number: null,
        destination_name: `Totem ${i}`,
        delivery_address: null,
        delivery_fee: 0,
        qty: (i % 3) + 1,
      });
    }

    // ── BLOCO 2: 40 pedidos cashier (caixa/balcão) ───────────────────────────
    for (let i = 1; i <= 40; i++) {
      const st = statuses[(i - 1) % 5];
      scenarios.push({
        prefix: 'SIM-CX',
        num: i,
        origin_type: 'cashier',
        destination_type: 'immediate',
        status: st,
        paid: st === 'delivered',
        table_number: null,
        destination_name: `Balcão ${i}`,
        delivery_address: null,
        delivery_fee: 0,
        qty: (i % 2) + 1,
      });
    }

    // ── BLOCO 3: 40 pedidos waiter (garçom com mesa) ─────────────────────────
    for (let i = 1; i <= 40; i++) {
      const st = statuses[(i - 1) % 5];
      const tableNum = TABLE_NUMBERS[(i - 1) % TABLE_NUMBERS.length];
      scenarios.push({
        prefix: 'SIM-GA',
        num: i,
        origin_type: 'waiter',
        destination_type: 'table',
        status: st,
        paid: st === 'delivered',
        table_number: tableNum,
        destination_name: `Mesa ${tableNum}`,
        delivery_address: null,
        delivery_fee: 0,
        qty: (i % 4) + 1,
      });
    }

    // ── BLOCO 4: 40 pedidos delivery ─────────────────────────────────────────
    // CORRIGIDO: total_amount = subtotal + delivery_fee
    for (let i = 1; i <= 40; i++) {
      const st = statuses[(i - 1) % 5];
      scenarios.push({
        prefix: 'SIM-DV',
        num: i,
        origin_type: 'delivery',
        destination_type: 'delivery',
        status: st,
        paid: st === 'delivered',
        table_number: null,
        destination_name: `Delivery Cliente ${i}`,
        delivery_address: `Rua Simulação, ${i * 10} - São Paulo SP`,
        delivery_fee: 8.00,
        qty: (i % 3) + 1,
      });
    }

    // ── BLOCO 5: 20 edge cases ────────────────────────────────────────────────
    for (let i = 1; i <= 5; i++) {
      scenarios.push({
        prefix: 'SIM-EDGE-NOPAY',
        num: i,
        origin_type: 'waiter',
        destination_type: 'table',
        status: 'delivered',
        paid: false,
        table_number: TABLE_NUMBERS[i - 1],
        destination_name: `Mesa ${TABLE_NUMBERS[i - 1]} (sem pgto)`,
        delivery_address: null,
        delivery_fee: 0,
        qty: 1,
      });
    }
    for (let i = 1; i <= 5; i++) {
      scenarios.push({
        prefix: 'SIM-EDGE-READY',
        num: i,
        origin_type: 'waiter',
        destination_type: 'table',
        status: 'ready',
        paid: false,
        table_number: TABLE_NUMBERS[i + 4],
        destination_name: `Mesa ${TABLE_NUMBERS[i + 4]} (pronto)`,
        delivery_address: null,
        delivery_fee: 0,
        qty: 1,
      });
    }
    for (let i = 1; i <= 5; i++) {
      scenarios.push({
        prefix: 'SIM-EDGE-PREP',
        num: i,
        origin_type: 'waiter',
        destination_type: 'table',
        status: 'preparing',
        paid: false,
        table_number: TABLE_NUMBERS[i + 9],
        destination_name: `Mesa ${TABLE_NUMBERS[i + 9]} (preparo)`,
        delivery_address: null,
        delivery_fee: 0,
        qty: 2,
      });
    }
    for (let i = 1; i <= 5; i++) {
      scenarios.push({
        prefix: 'SIM-EDGE-NEW',
        num: i,
        origin_type: 'self_service',
        destination_type: 'immediate',
        status: 'new',
        paid: false,
        table_number: null,
        destination_name: `Totem Novo ${i}`,
        delivery_address: null,
        delivery_fee: 0,
        qty: 1,
      });
    }

    // ── Inserir apenas os que ainda não existem ───────────────────────────────
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    const errorLog: string[] = [];

    for (let idx = 0; idx < scenarios.length; idx++) {
      const sc = scenarios[idx];
      const orderNum = `${sc.prefix}-${String(sc.num).padStart(4, '0')}`;

      if (existingNumbers.has(orderNum)) {
        skipped++;
        continue;
      }

      const item = ITEMS[idx % ITEMS.length];
      const qty = sc.qty;
      // CORRIGIDO: subtotal = item * qty, total = subtotal + delivery_fee
      const subtotalCalc = parseFloat((item.price * qty).toFixed(2));
      const totalCalc = parseFloat((subtotalCalc + sc.delivery_fee).toFixed(2));
      const createdAt = new Date(Date.now() - Math.random() * 8 * 3600 * 1000).toISOString();

      const orderPayload: Record<string, unknown> = {
        tenant_id: TENANT_ID,
        session_id: SESSION_ID,
        number: orderNum,
        origin_type: sc.origin_type,
        destination_type: sc.destination_type,
        destination_name: sc.destination_name,
        table_number: sc.table_number,
        status: sc.status,
        subtotal: subtotalCalc,
        total_amount: totalCalc,
        discount_amount: 0,
        service_fee_amount: 0,
        delivery_fee: sc.delivery_fee,
        delivery_address: sc.delivery_address,
        is_training: false,
        is_draft: false,
        created_at: createdAt,
        updated_at: new Date(Date.now() - Math.random() * 2 * 3600 * 1000).toISOString(),
      };

      if (sc.origin_type === 'delivery' && sc.destination_name) {
        orderPayload.destination_phone = `(11) 9${String(idx).padStart(4, '0')}-0000`;
      }

      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .insert(orderPayload)
        .select('id')
        .maybeSingle();

      if (orderErr || !orderData) {
        errors++;
        errorLog.push(`[ORDER] ${orderNum}: ${orderErr?.message ?? 'sem id retornado'}`);
        continue;
      }

      const orderId = orderData.id;

      const itemStatus = sc.status === 'cancelled' ? 'new'
        : sc.status === 'new' ? 'new'
        : sc.status === 'preparing' ? 'preparing'
        : sc.status === 'ready' ? 'ready'
        : 'delivered';

      const { error: itemErr } = await supabase.from('order_items').insert({
        order_id: orderId,
        tenant_id: TENANT_ID,
        item_id: item.id,
        item_name: item.name,
        item_price: item.price,
        quantity: qty,
        status: itemStatus,
        skip_kds: item.skip_kds,
        created_at: createdAt,
      });

      if (itemErr) {
        errors++;
        errorLog.push(`[ITEM] ${orderNum}: ${itemErr.message}`);
        continue;
      }

      // CORRIGIDO: pagamento usa totalCalc (inclui delivery_fee)
      if (sc.paid) {
        const pm = PAYMENTS[idx % PAYMENTS.length];
        const { error: pmErr } = await supabase.from('payments').insert({
          order_id: orderId,
          tenant_id: TENANT_ID,
          payment_method_id: pm,
          amount: totalCalc,
          change_amount: 0,
          created_at: new Date(Date.now() - Math.random() * 2 * 3600 * 1000).toISOString(),
        });

        if (pmErr) {
          errorLog.push(`[PAYMENT] ${orderNum}: ${pmErr.message}`);
        }
      }

      inserted++;
    }

    // ── Resumo final ──────────────────────────────────────────────────────────
    const { data: summary } = await supabase
      .from('orders')
      .select('origin_type, status')
      .eq('tenant_id', TENANT_ID)
      .like('number', 'SIM%');

    const byStatus: Record<string, number> = {};
    const byOrigin: Record<string, number> = {};
    for (const row of (summary ?? [])) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      byOrigin[row.origin_type] = (byOrigin[row.origin_type] ?? 0) + 1;
    }

    const { data: withItems } = await supabase
      .from('order_items')
      .select('order_id')
      .eq('tenant_id', TENANT_ID);

    const orderIdsWithItems = new Set((withItems ?? []).map((r: { order_id: string }) => r.order_id));

    const { data: allSimOrders } = await supabase
      .from('orders')
      .select('id, status')
      .eq('tenant_id', TENANT_ID)
      .like('number', 'SIM%');

    const semItens = (allSimOrders ?? []).filter((o: { id: string }) => !orderIdsWithItems.has(o.id)).length;

    return new Response(JSON.stringify({
      ok: true,
      inserted,
      skipped,
      errors,
      errorLog: errorLog.slice(0, 30),
      totalNoBank: (summary ?? []).length,
      summary: { byStatus, byOrigin, semItens },
      blocos: {
        'self_service (SIM-SS)': 40,
        'cashier (SIM-CX)': 40,
        'waiter com mesa (SIM-GA)': 40,
        'delivery (SIM-DV)': 40,
        'EDGE: delivered sem pagamento (SIM-EDGE-NOPAY)': 5,
        'EDGE: ready nao entregue (SIM-EDGE-READY)': 5,
        'EDGE: preparing (SIM-EDGE-PREP)': 5,
        'EDGE: new sem pagamento (SIM-EDGE-NEW)': 5,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
