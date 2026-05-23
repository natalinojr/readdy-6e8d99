import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kiosk-token',
};

// ── EMV Payload Builder (PIX BR Code) ──────────────────────────────────────
function pad(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

function buildPixPayload(params: {
  pixKey: string;
  pixKeyType: string;
  amount: number;
  txid: string;
  beneficiaryName: string;
  city: string;
  description?: string;
}): string {
  const { pixKey, amount, txid, beneficiaryName, city, description } = params;

  // Normaliza nome e cidade (máx 25 e 15 chars, sem acentos)
  const normName = beneficiaryName
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '').substring(0, 25).toUpperCase();
  const normCity = city
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '').substring(0, 15).toUpperCase();

  // Merchant Account Info (tag 26)
  const gui = pad('00', 'br.gov.bcb.pix');
  const keyField = pad('01', pixKey);
  const descField = description ? pad('02', description.substring(0, 72)) : '';
  const merchantAccountInfo = pad('26', gui + keyField + descField);

  // Additional Data (tag 62) — txid
  const safeTxid = txid.replace(/[^A-Za-z0-9]/g, '').substring(0, 25) || '***';
  const additionalData = pad('62', pad('05', safeTxid));

  // Amount (tag 54)
  const amountField = pad('54', amount.toFixed(2));

  // Build payload sem CRC
  const payload =
    pad('00', '01') +           // Payload Format Indicator
    pad('01', '12') +           // Point of Initiation Method (12 = dynamic)
    merchantAccountInfo +
    pad('52', '0000') +         // Merchant Category Code
    pad('53', '986') +          // Transaction Currency (BRL)
    amountField +
    pad('58', 'BR') +           // Country Code
    pad('59', normName) +       // Merchant Name
    pad('60', normCity) +       // Merchant City
    additionalData +
    '6304';                     // CRC placeholder

  return payload + crc16(payload);
}

// ── Supabase Admin Client ──────────────────────────────────────────────────
function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

// ── Resolve tenant from JWT or kiosk token ─────────────────────────────────
async function resolveTenant(req: Request, supabase: ReturnType<typeof getAdminClient>): Promise<string | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const kioskToken = req.headers.get('x-kiosk-token') ?? '';

  // Try kiosk token first
  if (kioskToken) {
    const { data } = await supabase
      .from('kiosk_tokens')
      .select('tenant_id')
      .eq('token', kioskToken)
      .eq('is_active', true)
      .maybeSingle();
    if (data?.tenant_id) return data.tenant_id;
  }

  // Try JWT
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const { data } = await supabase.auth.getUser(token);
    if (data?.user) {
      const { data: u } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', data.user.id)
        .maybeSingle();
      if (u?.tenant_id) return u.tenant_id;
    }
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = getAdminClient();

  try {
    const body = await req.json();
    const { action } = body;

    // ── ACTION: generate ──────────────────────────────────────────────────
    if (action === 'generate') {
      const { tenant_id, order_id, amount } = body;

      if (!tenant_id || !amount) {
        return new Response(JSON.stringify({ error: 'tenant_id e amount são obrigatórios' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Busca configuração PIX do tenant
      const { data: settings } = await supabase
        .from('system_settings')
        .select('pix_key, pix_key_type, pix_beneficiary_name, pix_city')
        .eq('tenant_id', tenant_id)
        .maybeSingle();

      if (!settings?.pix_key) {
        return new Response(JSON.stringify({ error: 'Chave PIX não configurada. Configure em Configurações > PIX.' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Gera txid único
      const txid = `ERPOS${Date.now()}${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // Gera payload EMV
      const emvPayload = buildPixPayload({
        pixKey: settings.pix_key,
        pixKeyType: settings.pix_key_type ?? 'email',
        amount: Number(amount),
        txid,
        beneficiaryName: settings.pix_beneficiary_name ?? 'ESTABELECIMENTO',
        city: settings.pix_city ?? 'SAO PAULO',
        description: order_id ? `Pedido ${order_id.substring(0, 8)}` : 'Pedido',
      });

      // Salva no banco
      const { data: pixRecord, error: insertErr } = await supabase
        .from('fin_pix_payments')
        .insert({
          tenant_id,
          order_id: order_id ?? null,
          txid,
          amount: Number(amount),
          pix_key: settings.pix_key,
          pix_key_type: settings.pix_key_type ?? 'email',
          beneficiary_name: settings.pix_beneficiary_name ?? 'ESTABELECIMENTO',
          city: settings.pix_city ?? 'SAO PAULO',
          emv_payload: emvPayload,
          status: 'pending',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })
        .select('id, txid, emv_payload, expires_at')
        .single();

      if (insertErr) throw insertErr;

      return new Response(JSON.stringify({
        pix_payment_id: pixRecord.id,
        txid: pixRecord.txid,
        emv_payload: pixRecord.emv_payload,
        expires_at: pixRecord.expires_at,
        pix_key: settings.pix_key,
        pix_key_type: settings.pix_key_type,
        beneficiary_name: settings.pix_beneficiary_name,
        amount: Number(amount),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── ACTION: check_status ──────────────────────────────────────────────
    if (action === 'check_status') {
      const { pix_payment_id, tenant_id } = body;

      if (!pix_payment_id) {
        return new Response(JSON.stringify({ error: 'pix_payment_id é obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: pix } = await supabase
        .from('fin_pix_payments')
        .select('id, status, confirmed_at, expires_at, amount, txid')
        .eq('id', pix_payment_id)
        .maybeSingle();

      if (!pix) {
        return new Response(JSON.stringify({ error: 'Pagamento não encontrado' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Auto-expire
      if (pix.status === 'pending' && new Date(pix.expires_at) < new Date()) {
        await supabase
          .from('fin_pix_payments')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('id', pix_payment_id);
        return new Response(JSON.stringify({ status: 'expired' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        status: pix.status,
        confirmed_at: pix.confirmed_at,
        amount: pix.amount,
        txid: pix.txid,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── ACTION: confirm (webhook / manual) ───────────────────────────────
    if (action === 'confirm') {
      const { pix_payment_id, txid } = body;

      const query = supabase.from('fin_pix_payments').update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (pix_payment_id) {
        await query.eq('id', pix_payment_id).eq('status', 'pending');
      } else if (txid) {
        await query.eq('txid', txid).eq('status', 'pending');
      } else {
        return new Response(JSON.stringify({ error: 'pix_payment_id ou txid é obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── ACTION: cancel ────────────────────────────────────────────────────
    if (action === 'cancel') {
      const { pix_payment_id } = body;
      if (!pix_payment_id) {
        return new Response(JSON.stringify({ error: 'pix_payment_id é obrigatório' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await supabase
        .from('fin_pix_payments')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', pix_payment_id)
        .eq('status', 'pending');

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Ação inválida' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[pix-payment] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
