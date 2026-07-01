import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Gera um código alfanumérico legível (ex: GC-A3F9-X2K1) */
function generateVoucherCode(prefix = 'GC'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${seg(4)}-${seg(4)}`;
}

/** Token URL-safe do link de ativação (36 chars hex, imprevisível) */
function generateClaimToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';

  const effectiveServiceKey = serviceRoleKey.length > 100 ? serviceRoleKey : anonKey;
  const admin = createClient(supabaseUrl, effectiveServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const { action } = body;
    if (!action) return json({ error: 'action is required' }, 400);

    // ── Authenticated client ─────────────────────────────────────────────────
    const db = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userError } = await db.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    // ── Tenant resolution ────────────────────────────────────────────────────
    const requestedTenantId: string | null = body.active_tenant_id ?? body.tenant_id ?? null;
    const { data: tenantRows, error: tenantErr } = await db.rpc('get_tenant_for_user', { p_user_id: user.id });
    if (tenantErr) return json({ error: `Tenant lookup failed: ${tenantErr.message}` }, 500);
    if (!tenantRows || tenantRows.length === 0) return json({ error: 'User does not belong to any tenant' }, 403);

    let tenantId: string;
    if (requestedTenantId) {
      const match = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
      if (!match) return json({ error: 'User does not belong to the requested tenant' }, 403);
      tenantId = match.tenant_id;
    } else if (tenantRows.length === 1) {
      tenantId = tenantRows[0].tenant_id;
    } else {
      return json({ error: 'Multiple tenants found — active_tenant_id required' }, 403);
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: issue_voucher
    // Cria um novo voucher/gift card
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'issue_voucher') {
      const {
        voucher_type, original_amount, code: customCode,
        discount_type, discount_value, free_item_id,
        expires_at, valid_from, max_uses, generate_claim_link,
        min_order_amount,
        customer_id, customer_name, customer_email,
        notes, order_id,
      } = body;

      if (!voucher_type || original_amount == null) {
        return json({ error: 'voucher_type and original_amount are required' }, 400);
      }

      // Validações por tipo
      if (voucher_type === 'discount') {
        if (!discount_type || discount_value == null) {
          return json({ error: 'discount_type and discount_value are required for discount vouchers' }, 400);
        }
        if (discount_type === 'percent' && (discount_value <= 0 || discount_value > 100)) {
          return json({ error: 'discount_value must be between 1 and 100 for percent discounts' }, 400);
        }
      }

      if (voucher_type === 'free_item' && !free_item_id) {
        return json({ error: 'free_item_id is required for free_item vouchers' }, 400);
      }

      // Gera código único (tenta até 5 vezes para evitar colisão)
      let finalCode = customCode?.trim().toUpperCase() ?? '';
      if (!finalCode) {
        const prefix = voucher_type === 'gift_card' ? 'GC'
          : voucher_type === 'discount' ? 'DC'
          : voucher_type === 'cashback' ? 'CB'
          : 'FI';

        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = generateVoucherCode(prefix);
          const { data: existing } = await admin
            .from('vouchers')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('code', candidate)
            .maybeSingle();
          if (!existing) { finalCode = candidate; break; }
        }
        if (!finalCode) return json({ error: 'Failed to generate unique voucher code' }, 500);
      } else {
        // Verifica se código personalizado já existe
        const { data: existing } = await admin
          .from('vouchers')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('code', finalCode)
          .maybeSingle();
        if (existing) return json({ error: 'Voucher code already exists for this tenant' }, 409);
      }

      // Limite de usos (>= 1) — relevante para discount/free_item multi-uso
      const finalMaxUses = Math.max(1, Math.floor(Number(max_uses ?? 1)) || 1);

      // Pedido mínimo próprio do voucher (independente do mínimo geral do delivery)
      const finalMinOrder = Number(min_order_amount) > 0 ? Number(min_order_amount) : null;

      const { data: voucher, error: insertErr } = await admin
        .from('vouchers')
        .insert({
          tenant_id: tenantId,
          code: finalCode,
          voucher_type,
          original_amount,
          current_balance: original_amount,
          discount_type: discount_type ?? null,
          discount_value: discount_value ?? null,
          free_item_id: free_item_id ?? null,
          expires_at: expires_at ?? null,
          valid_from: valid_from ?? null,
          max_uses: finalMaxUses,
          min_order_amount: finalMinOrder,
          claim_token: generate_claim_link ? generateClaimToken() : null,
          status: 'active',
          customer_id: customer_id ?? null,
          customer_name: customer_name ?? null,
          customer_email: customer_email ?? null,
          issued_by: user.id,
          order_id: order_id ?? null,
          notes: notes ?? null,
        })
        .select()
        .maybeSingle();

      if (insertErr) throw insertErr;

      // Registra transação de emissão
      await admin.from('voucher_transactions').insert({
        tenant_id: tenantId,
        voucher_id: voucher!.id,
        order_id: order_id ?? null,
        transaction_type: 'issued',
        amount: original_amount,
        balance_after: original_amount,
        processed_by: user.id,
      });

      return json({ data: voucher });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: validate_voucher
    // Verifica se o código é válido e retorna saldo/desconto aplicável
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'validate_voucher') {
      const { code, order_amount } = body;
      if (!code) return json({ error: 'code is required' }, 400);

      const { data: voucher, error: fetchErr } = await admin
        .from('vouchers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('code', code.trim().toUpperCase())
        .maybeSingle();

      if (fetchErr) throw fetchErr;

      if (!voucher) {
        return json({ valid: false, voucher: null, applicable_amount: 0, reason: 'not_found' });
      }

      // Verifica expiração
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        // Marca como expirado se ainda não estava
        if (voucher.status === 'active') {
          await admin.from('vouchers').update({ status: 'expired' }).eq('id', voucher.id);
          await admin.from('voucher_transactions').insert({
            tenant_id: tenantId,
            voucher_id: voucher.id,
            transaction_type: 'expired',
            amount: voucher.current_balance,
            balance_after: 0,
            processed_by: user.id,
          });
        }
        return json({ valid: false, voucher: null, applicable_amount: 0, reason: 'expired' });
      }

      // Verifica início de validade (voucher agendado ainda não vigente)
      if (voucher.valid_from && new Date(voucher.valid_from) > new Date()) {
        return json({ valid: false, voucher: null, applicable_amount: 0, reason: 'not_yet_valid' });
      }

      if (voucher.status !== 'active') {
        return json({
          valid: false,
          voucher: null,
          applicable_amount: 0,
          reason: voucher.status, // 'depleted', 'cancelled', 'expired'
        });
      }

      // Pedido mínimo do voucher (só valida quando o valor do pedido foi informado)
      const minOrder = Number(voucher.min_order_amount ?? 0);
      if (minOrder > 0 && order_amount != null && Number(order_amount) < minOrder) {
        return json({
          valid: false,
          voucher: null,
          applicable_amount: 0,
          reason: 'below_min_order',
          min_order_amount: minOrder,
        });
      }

      // Calcula valor aplicável
      let applicableAmount = 0;
      const orderAmt = Number(order_amount ?? 0);

      if (voucher.voucher_type === 'gift_card' || voucher.voucher_type === 'cashback') {
        applicableAmount = orderAmt > 0
          ? Math.min(voucher.current_balance, orderAmt)
          : voucher.current_balance;
      } else if (voucher.voucher_type === 'discount') {
        if (voucher.discount_type === 'fixed') {
          applicableAmount = orderAmt > 0
            ? Math.min(voucher.discount_value ?? 0, orderAmt)
            : (voucher.discount_value ?? 0);
        } else if (voucher.discount_type === 'percent') {
          applicableAmount = orderAmt > 0
            ? orderAmt * ((voucher.discount_value ?? 0) / 100)
            : 0;
        }
      } else if (voucher.voucher_type === 'free_item') {
        applicableAmount = 0; // item grátis — tratado pelo frontend
      }

      return json({
        valid: true,
        voucher,
        applicable_amount: Math.round(applicableAmount * 100) / 100,
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: redeem_voucher
    // Usa o voucher em um pagamento — desconta saldo e registra transação
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'redeem_voucher') {
      const { code, amount, order_id, order_amount } = body;

      if (!code || amount == null) {
        return json({ error: 'code and amount are required' }, 400);
      }
      if (amount <= 0) {
        return json({ error: 'amount must be greater than 0' }, 400);
      }

      const { data: voucher, error: fetchErr } = await admin
        .from('vouchers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('code', code.trim().toUpperCase())
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!voucher) return json({ error: 'Voucher not found' }, 404);

      // Verifica expiração
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        if (voucher.status === 'active') {
          await admin.from('vouchers').update({ status: 'expired' }).eq('id', voucher.id);
        }
        return json({ error: 'Voucher has expired' }, 422);
      }

      // Verifica início de validade
      if (voucher.valid_from && new Date(voucher.valid_from) > new Date()) {
        return json({ error: 'Voucher is not yet valid' }, 422);
      }

      if (voucher.status !== 'active') {
        return json({ error: `Voucher is ${voucher.status}` }, 422);
      }

      // Pedido mínimo do voucher (safety-net; a validação principal é no validate)
      const redeemMinOrder = Number(voucher.min_order_amount ?? 0);
      if (redeemMinOrder > 0 && order_amount != null && Number(order_amount) < redeemMinOrder) {
        return json({ error: 'Order amount below voucher minimum', min_order_amount: redeemMinOrder }, 422);
      }

      // Para gift_card e cashback: verifica saldo suficiente
      if (['gift_card', 'cashback'].includes(voucher.voucher_type)) {
        if (voucher.current_balance < amount) {
          return json({
            error: 'Insufficient voucher balance',
            current_balance: voucher.current_balance,
            requested: amount,
          }, 422);
        }
      }

      // Para discount: o amount é o desconto calculado (não desconta do saldo de forma recorrente)
      // Para free_item: amount = 0, apenas registra o uso

      const maxUses = Math.max(1, Number(voucher.max_uses ?? 1));
      const newUseCount = Number(voucher.use_count ?? 0) + 1;

      let newBalance: number;
      let newStatus: string;
      if (['gift_card', 'cashback'].includes(voucher.voucher_type)) {
        newBalance = voucher.current_balance - amount;
        newStatus = newBalance <= 0 ? 'depleted' : 'active';
      } else {
        // discount e free_item: consumo por número de usos (max_uses)
        newStatus = newUseCount >= maxUses ? 'depleted' : 'active';
        newBalance = newStatus === 'depleted' ? 0 : voucher.current_balance;
      }

      // Atualiza saldo, status e contagem de usos
      const { error: updateErr } = await admin
        .from('vouchers')
        .update({ current_balance: newBalance, status: newStatus, use_count: newUseCount })
        .eq('id', voucher.id);

      if (updateErr) throw updateErr;

      // Registra transação
      const { data: txn, error: txnErr } = await admin
        .from('voucher_transactions')
        .insert({
          tenant_id: tenantId,
          voucher_id: voucher.id,
          order_id: order_id ?? null,
          transaction_type: 'redeemed',
          amount,
          balance_after: newBalance,
          processed_by: user.id,
        })
        .select('id')
        .maybeSingle();

      if (txnErr) throw txnErr;

      return json({
        ok: true,
        voucher_id: voucher.id,
        amount_redeemed: amount,
        balance_after: newBalance,
        transaction_id: txn?.id ?? null,
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: cancel_voucher
    // Cancela um voucher (devolve saldo se gift_card/cashback)
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'cancel_voucher') {
      const { voucher_id, reason } = body;
      if (!voucher_id) return json({ error: 'voucher_id is required' }, 400);

      const { data: voucher, error: fetchErr } = await admin
        .from('vouchers')
        .select('id, status, current_balance, tenant_id')
        .eq('id', voucher_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!voucher) return json({ error: 'Voucher not found' }, 404);

      if (['cancelled', 'expired'].includes(voucher.status)) {
        return json({ error: `Voucher is already ${voucher.status}` }, 422);
      }

      const { error: updateErr } = await admin
        .from('vouchers')
        .update({ status: 'cancelled', notes: reason ?? null })
        .eq('id', voucher_id);

      if (updateErr) throw updateErr;

      // Registra transação de cancelamento
      await admin.from('voucher_transactions').insert({
        tenant_id: tenantId,
        voucher_id,
        transaction_type: 'cancelled',
        amount: voucher.current_balance,
        balance_after: 0,
        processed_by: user.id,
      });

      return json({ ok: true });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: list_vouchers
    // Lista vouchers do tenant com filtros opcionais
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'list_vouchers') {
      const { status: filterStatus, customer_id, voucher_type } = body;

      let query = admin
        .from('vouchers')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (filterStatus) query = query.eq('status', filterStatus);
      if (customer_id) query = query.eq('customer_id', customer_id);
      if (voucher_type) query = query.eq('voucher_type', voucher_type);

      const { data, error } = await query;
      if (error) throw error;
      return json({ data });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: get_voucher_transactions
    // Retorna o histórico de transações de um voucher
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'get_voucher_transactions') {
      const { voucher_id } = body;
      if (!voucher_id) return json({ error: 'voucher_id is required' }, 400);

      // Verifica que o voucher pertence ao tenant
      const { data: voucher } = await admin
        .from('vouchers')
        .select('id')
        .eq('id', voucher_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!voucher) return json({ error: 'Voucher not found' }, 404);

      const { data, error } = await admin
        .from('voucher_transactions')
        .select('*')
        .eq('voucher_id', voucher_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return json({ data });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: refund_voucher_redemption
    // Estorna um uso de voucher (ex: pedido cancelado)
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'refund_voucher_redemption') {
      const { voucher_id, amount, order_id } = body;
      if (!voucher_id || amount == null) {
        return json({ error: 'voucher_id and amount are required' }, 400);
      }

      const { data: voucher, error: fetchErr } = await admin
        .from('vouchers')
        .select('id, current_balance, original_amount, status, voucher_type, tenant_id')
        .eq('id', voucher_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!voucher) return json({ error: 'Voucher not found' }, 404);

      // Só faz sentido estornar gift_card e cashback
      if (!['gift_card', 'cashback'].includes(voucher.voucher_type)) {
        return json({ error: 'Only gift_card and cashback vouchers support refunds' }, 422);
      }

      const newBalance = Math.min(
        voucher.current_balance + amount,
        voucher.original_amount,
      );
      const newStatus = newBalance > 0 ? 'active' : voucher.status;

      const { error: updateErr } = await admin
        .from('vouchers')
        .update({ current_balance: newBalance, status: newStatus })
        .eq('id', voucher_id);

      if (updateErr) throw updateErr;

      await admin.from('voucher_transactions').insert({
        tenant_id: tenantId,
        voucher_id,
        order_id: order_id ?? null,
        transaction_type: 'refunded',
        amount,
        balance_after: newBalance,
        processed_by: user.id,
      });

      return json({ ok: true, balance_after: newBalance });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
