import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TENANT_ID = '9063797b-a50b-4d9a-ac09-d232ddcd48d1';

// Known IDs from DB
const ITEMS = {
  alPastor:    { id: 'bcf123e1-fc41-4348-817b-5557973254e8', name: 'Al Pastor',           price: 38.00 },
  classic:     { id: 'd6135c9c-2b51-40be-818d-af6c4c50d12a', name: 'Classic',              price: 38.00 },
  cocaCola:    { id: '3bd27c52-fcf1-4cb2-8c9a-e82ce822d3f9', name: 'Coca-cola',            price: 8.00  },
  hambFrango:  { id: '1506d4c8-ba12-4b3b-aa30-f545f59d25cf', name: 'Hamburguer de frango', price: 40.00 },
  picanha:     { id: 'f1a2b3c4-0001-0001-0001-000000000001', name: 'Picanha Grelhada',     price: 89.90 },
};

const OPTIONS = {
  tortilhaChips: { id: '6d6194d5-2ed6-4b85-a335-e69cafe8c6fc', name: 'Tortilha chips', groupId: '04edab49-eb17-4e80-8d0e-de79c537f848', groupName: 'Tortilha chips', price: 0 },
  doritos:       { id: 'eaadf843-e184-4c81-a68d-b6ea585a31f7', name: 'Doritos',        groupId: '04edab49-eb17-4e80-8d0e-de79c537f848', groupName: 'Tortilha chips', price: 4 },
  malPassado:    { id: 'f1a2b3c4-0003-0003-0003-000000000003', name: 'Mal passado',     groupId: 'f1a2b3c4-0002-0002-0002-000000000002', groupName: 'Ponto da carne', price: 0 },
  aoPonto:       { id: 'f1a2b3c4-0004-0004-0004-000000000004', name: 'Ao ponto',        groupId: 'f1a2b3c4-0002-0002-0002-000000000002', groupName: 'Ponto da carne', price: 0 },
  bemPassado:    { id: 'f1a2b3c4-0005-0005-0005-000000000005', name: 'Bem passado',     groupId: 'f1a2b3c4-0002-0002-0002-000000000002', groupName: 'Ponto da carne', price: 0 },
};

const PAYMENT_METHODS = {
  dinheiro:  '7cb0333d-eda7-4865-b27d-3bf760dadbe0',
  pix:       'a3fbf092-5946-466a-973f-f679a260f21e',
  credito:   'ada729eb-f3bc-4b9e-8c3e-78d6265f693e',
  debito:    '6bbeca5f-c36d-4787-bcb2-7a95344e8015',
  voucher:   'ee4b1461-8874-411e-9856-9c52f8f457ee',
};

function buildItem(item: typeof ITEMS.alPastor, qty: number, opts: typeof OPTIONS.tortilhaChips[], obs?: string, skipKds = false) {
  const optsTotal = opts.reduce((s, o) => s + o.price, 0);
  return {
    item_id: item.id,
    item_name: item.name,
    item_price: item.price + optsTotal,
    quantity: qty,
    station_id: null,
    skip_kds: skipKds,
    notes: obs ?? null,
    options: opts.map(o => ({
      option_id: o.id,
      option_name: o.name,
      group_name: o.groupName,
      additional_price: o.price,
    })),
    observations: obs ? [{ text: obs }] : [],
  };
}

interface TestScenario {
  name: string;
  destination: string;
  destination_name: string | null;
  table_number: number | null;
  items: ReturnType<typeof buildItem>[];
  payment_method_id: string;
  discount_amount: number;
  service_fee_amount: number;
  subtotal: number;
  total_amount: number;
  expected_status: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? 'run_all';

    // ── Buscar sessão e caixa ativos ──────────────────────────────────────
    const { data: sessions } = await admin.rpc('fn_get_active_session', { p_tenant_id: TENANT_ID });
    const sess = sessions?.[0];
    if (!sess) {
      return new Response(JSON.stringify({ error: 'Nenhuma sessão ativa para o tenant El Patron. Abra uma sessão primeiro.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: registers } = await admin.rpc('fn_get_active_cash_register', { p_session_id: sess.id });
    const reg = registers?.[0];
    if (!reg) {
      return new Response(JSON.stringify({ error: 'Caixa não está aberto. Abra o caixa primeiro.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sessionId = sess.id;
    const cashRegisterId = reg.id;

    // ── Buscar usuário do token ───────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user } } = await admin.auth.getUser(token);
    const userId = user?.id ?? null;

    if (action === 'check_status') {
      return new Response(JSON.stringify({
        ok: true,
        session: { id: sessionId, number: sess.number },
        cash_register: { id: cashRegisterId, opening_value: reg.opening_value },
        tenant: TENANT_ID,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Definir cenários de teste ─────────────────────────────────────────
    const scenarios: TestScenario[] = [
      // 1. Pedido simples — Fechar na Hora — Dinheiro
      {
        name: 'CENARIO_01: Simples / Imediato / Dinheiro',
        destination: 'immediate',
        destination_name: null,
        table_number: null,
        items: [
          buildItem(ITEMS.classic, 1, []),
          buildItem(ITEMS.cocaCola, 2, []),
        ],
        payment_method_id: PAYMENT_METHODS.dinheiro,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 38 + 16,
        total_amount: 54,
        expected_status: 'new',
      },
      // 2. Pedido com opção obrigatória — Al Pastor + Doritos — PIX
      {
        name: 'CENARIO_02: Com opção obrigatória / PIX',
        destination: 'immediate',
        destination_name: null,
        table_number: null,
        items: [
          buildItem(ITEMS.alPastor, 1, [OPTIONS.doritos]),
          buildItem(ITEMS.cocaCola, 1, []),
        ],
        payment_method_id: PAYMENT_METHODS.pix,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 42 + 8,
        total_amount: 50,
        expected_status: 'new',
      },
      // 3. Pedido para Mesa — Cartão de Débito
      {
        name: 'CENARIO_03: Mesa 7 / Débito',
        destination: 'table',
        destination_name: null,
        table_number: 7,
        items: [
          buildItem(ITEMS.picanha, 1, [OPTIONS.aoPonto]),
          buildItem(ITEMS.cocaCola, 1, []),
        ],
        payment_method_id: PAYMENT_METHODS.debito,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 89.90 + 8,
        total_amount: 97.90,
        expected_status: 'new',
      },
      // 4. Pedido com nome do cliente — Crédito
      {
        name: 'CENARIO_04: Nome cliente / Crédito',
        destination: 'name',
        destination_name: 'Carlos Teste',
        table_number: null,
        items: [
          buildItem(ITEMS.hambFrango, 2, [], 'sem cebola'),
        ],
        payment_method_id: PAYMENT_METHODS.credito,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 80,
        total_amount: 80,
        expected_status: 'new',
      },
      // 5. Pedido com senha — Vale Refeição
      {
        name: 'CENARIO_05: Senha / Vale Refeição',
        destination: 'password',
        destination_name: 'P-42',
        table_number: null,
        items: [
          buildItem(ITEMS.classic, 1, []),
          buildItem(ITEMS.hambFrango, 1, [], 'bem temperado'),
        ],
        payment_method_id: PAYMENT_METHODS.voucher,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 78,
        total_amount: 78,
        expected_status: 'new',
      },
      // 6. Pedido com desconto — Dinheiro
      {
        name: 'CENARIO_06: Com desconto R$10 / Dinheiro',
        destination: 'immediate',
        destination_name: null,
        table_number: null,
        items: [
          buildItem(ITEMS.picanha, 1, [OPTIONS.bemPassado]),
          buildItem(ITEMS.cocaCola, 2, []),
        ],
        payment_method_id: PAYMENT_METHODS.dinheiro,
        discount_amount: 10,
        service_fee_amount: 0,
        subtotal: 89.90 + 16,
        total_amount: 95.90,
        expected_status: 'new',
      },
      // 7. Pedido com taxa de serviço 10% — PIX
      {
        name: 'CENARIO_07: Com taxa de serviço 10% / PIX',
        destination: 'immediate',
        destination_name: null,
        table_number: null,
        items: [
          buildItem(ITEMS.alPastor, 2, [OPTIONS.tortilhaChips]),
          buildItem(ITEMS.cocaCola, 2, []),
        ],
        payment_method_id: PAYMENT_METHODS.pix,
        discount_amount: 0,
        service_fee_amount: 9.20,
        subtotal: 76 + 16,
        total_amount: 101.20,
        expected_status: 'new',
      },
      // 8. Pedido múltiplos itens — Mesa 12 — Pagamento misto (2 pagamentos)
      {
        name: 'CENARIO_08: Múltiplos itens / Mesa 12 / Débito',
        destination: 'table',
        destination_name: null,
        table_number: 12,
        items: [
          buildItem(ITEMS.alPastor, 1, [OPTIONS.doritos]),
          buildItem(ITEMS.picanha, 1, [OPTIONS.malPassado]),
          buildItem(ITEMS.hambFrango, 1, []),
          buildItem(ITEMS.cocaCola, 3, []),
        ],
        payment_method_id: PAYMENT_METHODS.debito,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 42 + 89.90 + 40 + 24,
        total_amount: 195.90,
        expected_status: 'new',
      },
      // 9. Pedido com observação livre — Dinheiro
      {
        name: 'CENARIO_09: Com observação livre / Dinheiro',
        destination: 'immediate',
        destination_name: null,
        table_number: null,
        items: [
          buildItem(ITEMS.hambFrango, 1, [], 'sem glúten, sem lactose, bem passado'),
          buildItem(ITEMS.cocaCola, 1, []),
        ],
        payment_method_id: PAYMENT_METHODS.dinheiro,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 48,
        total_amount: 48,
        expected_status: 'new',
      },
      // 10. Pedido grande quantidade — Crédito
      {
        name: 'CENARIO_10: Grande quantidade / Crédito',
        destination: 'immediate',
        destination_name: null,
        table_number: null,
        items: [
          buildItem(ITEMS.classic, 5, []),
          buildItem(ITEMS.cocaCola, 5, []),
        ],
        payment_method_id: PAYMENT_METHODS.credito,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 190 + 40,
        total_amount: 230,
        expected_status: 'new',
      },
      // 11. Pedido skip_kds (item sem preparo) — Dinheiro
      {
        name: 'CENARIO_11: Item skip_kds / Dinheiro',
        destination: 'immediate',
        destination_name: null,
        table_number: null,
        items: [
          buildItem(ITEMS.cocaCola, 3, [], undefined, true), // skip_kds = true
          buildItem(ITEMS.classic, 1, []),
        ],
        payment_method_id: PAYMENT_METHODS.dinheiro,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 24 + 38,
        total_amount: 62,
        expected_status: 'new',
      },
      // 12. Pedido delivery — PIX
      {
        name: 'CENARIO_12: Delivery / PIX',
        destination: 'delivery',
        destination_name: 'Ana Delivery',
        table_number: null,
        items: [
          buildItem(ITEMS.picanha, 1, [OPTIONS.aoPonto]),
          buildItem(ITEMS.cocaCola, 2, []),
        ],
        payment_method_id: PAYMENT_METHODS.pix,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal: 89.90 + 16,
        total_amount: 105.90,
        expected_status: 'new',
      },
    ];

    const results: Array<{
      scenario: string;
      status: 'ok' | 'error' | 'partial';
      order_id?: string;
      order_number?: string;
      payment_id?: string;
      items_inserted?: number;
      payment_registered?: boolean;
      error?: string;
      checks: Record<string, boolean | string>;
    }> = [];

    for (const scenario of scenarios) {
      const result: typeof results[0] = {
        scenario: scenario.name,
        status: 'ok',
        checks: {},
      };

      try {
        // ── 1. Gerar número do pedido ──────────────────────────────────────
        const { data: numData, error: numErr } = await admin.rpc('fn_next_order_number', { p_session_id: sessionId });
        if (numErr) throw new Error(`fn_next_order_number: ${numErr.message}`);
        const orderNumber = numData?.[0]?.number ?? `SIM-${Date.now()}`;

        // ── 2. Criar pedido ────────────────────────────────────────────────
        const { data: orderData, error: orderErr } = await admin.rpc('fn_create_order_bypass', {
          order_data: {
            tenant_id: TENANT_ID,
            session_id: sessionId,
            number: orderNumber,
            status: 'new',
            origin_type: 'cashier',
            destination_type: scenario.destination,
            destination_name: scenario.destination_name,
            destination_phone: null,
            delivery_address: scenario.destination === 'delivery' ? 'Rua Teste, 123' : null,
            delivery_fee: 0,
            discount_amount: scenario.discount_amount,
            service_fee_amount: scenario.service_fee_amount,
            subtotal: scenario.subtotal,
            total_amount: scenario.total_amount,
            is_training: false,
            is_draft: false,
            origin_user_id: userId,
            customer_id: null,
            table_number: scenario.table_number,
          },
        });

        if (orderErr) throw new Error(`fn_create_order_bypass: ${orderErr.message}`);
        const orderId = orderData?.id;
        if (!orderId) throw new Error('Pedido criado sem ID');

        result.order_id = orderId;
        result.order_number = orderNumber;
        result.checks['order_created'] = true;

        // ── 3. Inserir itens ───────────────────────────────────────────────
        const { error: itemsErr } = await admin.rpc('fn_create_order_items_bypass', {
          p_order_id: orderId,
          p_tenant_id: TENANT_ID,
          p_items: scenario.items,
        });

        if (itemsErr) {
          result.checks['items_inserted'] = `ERROR: ${itemsErr.message}`;
          result.status = 'partial';
        } else {
          // Verificar quantos itens foram inseridos
          const { count } = await admin.from('order_items')
            .select('id', { count: 'exact', head: true })
            .eq('order_id', orderId);
          result.items_inserted = count ?? 0;
          result.checks['items_inserted'] = count === scenario.items.length
            ? `OK (${count}/${scenario.items.length})`
            : `PARCIAL (${count}/${scenario.items.length})`;
          if ((count ?? 0) < scenario.items.length) result.status = 'partial';
        }

        // ── 4. Registrar pagamento ─────────────────────────────────────────
        const { data: paymentId, error: payErr } = await admin.rpc('fn_record_payment_bypass', {
          p_order_id: orderId,
          p_tenant_id: TENANT_ID,
          p_cash_register_id: cashRegisterId,
          p_payment_method_id: scenario.payment_method_id,
          p_amount: scenario.total_amount,
          p_change_amount: 0,
        });

        if (payErr) {
          result.checks['payment_registered'] = `ERROR: ${payErr.message}`;
          result.payment_registered = false;
          if (result.status === 'ok') result.status = 'partial';
        } else {
          result.payment_id = paymentId as string;
          result.payment_registered = true;
          result.checks['payment_registered'] = `OK (id: ${String(paymentId).slice(0, 8)}...)`;
        }

        // ── 5. Registrar no fin_cash_flow ──────────────────────────────────
        const { error: flowErr } = await admin.from('fin_cash_flow').insert({
          tenant_id: TENANT_ID,
          type: 'income',
          amount: scenario.total_amount,
          description: `Venda ${orderNumber} (Simulação)`,
          category: 'Vendas',
          origin: 'auto_sale',
          reference_id: orderId,
          date: new Date().toISOString().split('T')[0],
        });
        result.checks['cash_flow'] = flowErr ? `ERROR: ${flowErr.message}` : 'OK';

        // ── 6. Verificar desconto se aplicável ─────────────────────────────
        if (scenario.discount_amount > 0) {
          const { error: discErr } = await admin.from('order_discounts').insert({
            tenant_id: TENANT_ID,
            order_id: orderId,
            discount_type: 'fixed',
            discount_value: scenario.discount_amount,
            requires_approval: false,
            applied_by: userId,
            reason: 'Simulação de teste',
          });
          result.checks['discount_applied'] = discErr ? `ERROR: ${discErr.message}` : `OK (R$${scenario.discount_amount})`;
        }

        // ── 7. Verificar total no banco ────────────────────────────────────
        const { data: orderCheck } = await admin.from('orders')
          .select('total_amount, status, destination_type, table_number')
          .eq('id', orderId)
          .maybeSingle();

        result.checks['total_correct'] = Number(orderCheck?.total_amount) === scenario.total_amount
          ? `OK (R$${scenario.total_amount})`
          : `DIVERGÊNCIA: banco=${orderCheck?.total_amount} esperado=${scenario.total_amount}`;

        result.checks['destination_correct'] = orderCheck?.destination_type === scenario.destination
          ? `OK (${scenario.destination})`
          : `ERRO: banco=${orderCheck?.destination_type} esperado=${scenario.destination}`;

        if (scenario.table_number) {
          result.checks['table_number_correct'] = orderCheck?.table_number === scenario.table_number
            ? `OK (Mesa ${scenario.table_number})`
            : `ERRO: banco=${orderCheck?.table_number} esperado=${scenario.table_number}`;
        }

      } catch (err) {
        result.status = 'error';
        result.error = err instanceof Error ? err.message : String(err);
        result.checks['exception'] = result.error;
      }

      results.push(result);
    }

    // ── Resumo final ──────────────────────────────────────────────────────
    const summary = {
      total: results.length,
      ok: results.filter(r => r.status === 'ok').length,
      partial: results.filter(r => r.status === 'partial').length,
      error: results.filter(r => r.status === 'error').length,
    };

    return new Response(JSON.stringify({ summary, results, session_id: sessionId, cash_register_id: cashRegisterId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
