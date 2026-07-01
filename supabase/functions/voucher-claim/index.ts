// voucher-claim — Edge Function PÚBLICA (verify_jwt: false, sem Authorization)
// Resolve o token do link de ativação de um voucher: na 1ª abertura marca
// claimed_at ("acionado"), sempre incrementa claim_count, e retorna apenas
// dados seguros para exibição na página pública /voucher/:token.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    // Token gerado tem 36 chars hex — rejeita cedo qualquer coisa fora disso
    if (!/^[a-f0-9]{24,64}$/i.test(token)) {
      return json({ error: 'invalid_token' }, 400);
    }

    const { data: voucher, error: fetchErr } = await admin
      .from('vouchers')
      .select('*, tenant:tenants(name, slug, logo_url, phone, address, city)')
      .eq('claim_token', token)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!voucher) return json({ error: 'not_found' }, 404);

    const now = new Date();

    // Expira on-the-fly se a validade acabou
    let status: string = voucher.status;
    if (status === 'active' && voucher.expires_at && new Date(voucher.expires_at) < now) {
      await admin.from('vouchers').update({ status: 'expired' }).eq('id', voucher.id);
      await admin.from('voucher_transactions').insert({
        tenant_id: voucher.tenant_id,
        voucher_id: voucher.id,
        transaction_type: 'expired',
        amount: voucher.current_balance,
        balance_after: 0,
        processed_by: null,
      });
      status = 'expired';
    }

    const notYetValid = !!(voucher.valid_from && new Date(voucher.valid_from) > now);

    // 1ª abertura dentro da vigência = voucher "acionado" (claimed)
    let claimedAt: string | null = voucher.claimed_at;
    const updates: Record<string, unknown> = { claim_count: (voucher.claim_count ?? 0) + 1 };
    if (!claimedAt && status === 'active' && !notYetValid) {
      claimedAt = now.toISOString();
      updates.claimed_at = claimedAt;
    }
    await admin.from('vouchers').update(updates).eq('id', voucher.id);

    // Payload público — nunca expor tenant_id, ids internos, issued_by etc.
    return json({
      data: {
        code: voucher.code,
        voucher_type: voucher.voucher_type,
        discount_type: voucher.discount_type,
        discount_value: voucher.discount_value,
        original_amount: voucher.original_amount,
        current_balance: voucher.current_balance,
        valid_from: voucher.valid_from,
        expires_at: voucher.expires_at,
        min_order_amount: voucher.min_order_amount,
        status,
        not_yet_valid: notYetValid,
        claimed_at: claimedAt,
        use_count: voucher.use_count ?? 0,
        max_uses: voucher.max_uses ?? 1,
        customer_name: voucher.customer_name,
        notes: voucher.notes,
        store: voucher.tenant
          ? {
              name: voucher.tenant.name,
              slug: voucher.tenant.slug,
              logo_url: voucher.tenant.logo_url,
              phone: voucher.tenant.phone,
              address: voucher.tenant.address,
              city: voucher.tenant.city,
            }
          : null,
      },
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
