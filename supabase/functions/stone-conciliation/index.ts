import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StoneTransaction {
  id: string;
  type: string;
  amount: number;
  net_amount: number;
  date: string;
  description: string;
  payment_type: string;
  installment_number?: number;
  total_installments?: number;
  authorization_code?: string;
  card_brand?: string;
  status: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get tenant_id
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!userData?.tenant_id) {
      return new Response(JSON.stringify({ error: 'Tenant not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tenantId = userData.tenant_id;
    const body = await req.json();
    const action = body.action;

    // ── Save config ──────────────────────────────────────────────────────────
    if (action === 'save_config') {
      const { stone_code, api_key, bank_account_id } = body;

      if (!stone_code || !api_key) {
        return new Response(JSON.stringify({ error: 'stone_code e api_key são obrigatórios' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Test the credentials first
      const testUrl = `https://conciliation.stone.com.br/v2/merchant/${stone_code}/file?referenceDate=${new Date(Date.now() - 86400000).toISOString().split('T')[0]}`;
      const testResp = await fetch(testUrl, {
        headers: {
          'Authorization': `Basic ${btoa(api_key + ':')}`,
          'x-user-type': 'client',
          'Accept-Encoding': 'gzip',
          'X-Accept-Redirect': 'true',
          'accept': 'application/xml',
        },
      });

      // 200 or 404 (no file for that date) = credentials valid
      // 401 = invalid credentials
      if (testResp.status === 401) {
        return new Response(JSON.stringify({ error: 'Credenciais inválidas. Verifique a chave de API e o StoneCode.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Upsert config (store api_key encrypted as base64 - in production use proper encryption)
      const { error: upsertError } = await supabase
        .from('fin_stone_config')
        .upsert({
          tenant_id: tenantId,
          stone_code,
          api_key_b64: btoa(api_key),
          bank_account_id: bank_account_id || null,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id' });

      if (upsertError) {
        return new Response(JSON.stringify({ error: upsertError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, message: 'Configuração salva com sucesso!' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Get config ───────────────────────────────────────────────────────────
    if (action === 'get_config') {
      const { data: config } = await supabase
        .from('fin_stone_config')
        .select('id, stone_code, is_active, last_sync_at, bank_account_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return new Response(JSON.stringify({ config }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Import transactions ──────────────────────────────────────────────────
    if (action === 'import') {
      const { reference_date, bank_account_id } = body;

      if (!reference_date) {
        return new Response(JSON.stringify({ error: 'reference_date é obrigatório (YYYY-MM-DD)' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get config
      const { data: config } = await supabase
        .from('fin_stone_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!config) {
        return new Response(JSON.stringify({ error: 'Integração Stone não configurada. Configure primeiro.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const stoneCode = config.stone_code;
      const apiKey = atob(config.api_key_b64 || '');
      const targetAccountId = bank_account_id || config.bank_account_id;

      if (!targetAccountId) {
        return new Response(JSON.stringify({ error: 'Conta bancária não configurada.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch from Stone API
      const stoneUrl = `https://conciliation.stone.com.br/v2/merchant/${stoneCode}/file?referenceDate=${reference_date}`;
      const stoneResp = await fetch(stoneUrl, {
        headers: {
          'Authorization': `Basic ${btoa(apiKey + ':')}`,
          'x-user-type': 'client',
          'Accept-Encoding': 'gzip',
          'X-Accept-Redirect': 'true',
          'accept': 'application/xml',
        },
      });

      if (stoneResp.status === 404) {
        return new Response(JSON.stringify({
          success: true,
          transactions_count: 0,
          message: `Nenhum arquivo disponível para ${reference_date}. O arquivo fica disponível após as 5h do dia seguinte.`,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!stoneResp.ok) {
        const errText = await stoneResp.text();
        return new Response(JSON.stringify({ error: `Erro na API Stone: ${stoneResp.status} - ${errText}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Parse XML response
      const xmlText = await stoneResp.text();
      const transactions = parseStoneXML(xmlText, reference_date);

      if (transactions.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          transactions_count: 0,
          message: 'Nenhuma transação encontrada para esta data.',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check existing imports to avoid duplicates
      const { data: existing } = await supabase
        .from('fin_bank_statement_imports')
        .select('stone_transaction_id')
        .eq('tenant_id', tenantId)
        .eq('bank_account_id', targetAccountId)
        .not('stone_transaction_id', 'is', null);

      const existingIds = new Set((existing ?? []).map(e => e.stone_transaction_id));

      // Create import log
      const { data: importLog } = await supabase
        .from('fin_stone_imports')
        .upsert({
          tenant_id: tenantId,
          reference_date,
          status: 'success',
          transactions_count: transactions.length,
          total_credit: transactions.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0),
          total_debit: transactions.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0),
          imported_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,reference_date' })
        .select()
        .single();

      // Insert transactions
      const toInsert = transactions
        .filter(t => !existingIds.has(t.id))
        .map(t => ({
          tenant_id: tenantId,
          bank_account_id: targetAccountId,
          external_id: t.id,
          stone_transaction_id: t.id,
          stone_import_id: importLog?.id || null,
          stone_payment_type: t.payment_type,
          stone_installment_info: t.installment_number ? {
            installment_number: t.installment_number,
            total_installments: t.total_installments,
            authorization_code: t.authorization_code,
            card_brand: t.card_brand,
          } : null,
          transaction_date: t.date,
          amount: t.net_amount || t.amount,
          description: t.description,
          transaction_type: t.type,
          status: 'pending',
          category: mapPaymentTypeToCategory(t.payment_type),
        }));

      let inserted = 0;
      if (toInsert.length > 0) {
        const { data: insertedData, error: insertError } = await supabase
          .from('fin_bank_statement_imports')
          .upsert(toInsert, { onConflict: 'tenant_id,bank_account_id,external_id', ignoreDuplicates: true })
          .select();

        if (insertError) {
          console.error('Insert error:', insertError);
        }
        inserted = insertedData?.length ?? toInsert.length;
      }

      // Update last sync
      await supabase
        .from('fin_stone_config')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('tenant_id', tenantId);

      return new Response(JSON.stringify({
        success: true,
        transactions_count: transactions.length,
        inserted,
        duplicates: transactions.length - toInsert.length,
        total_credit: transactions.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0),
        total_debit: transactions.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0),
        message: `${inserted} transações importadas da Stone para ${reference_date}`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Get import history ───────────────────────────────────────────────────
    if (action === 'get_history') {
      const { data: history } = await supabase
        .from('fin_stone_imports')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('reference_date', { ascending: false })
        .limit(30);

      return new Response(JSON.stringify({ history: history ?? [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Action not found' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[stone-conciliation] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ── XML Parser ───────────────────────────────────────────────────────────────
function parseStoneXML(xml: string, referenceDate: string): StoneTransaction[] {
  const transactions: StoneTransaction[] = [];

  // Stone returns a specific XML format - parse FinancialTransaction elements
  const txRegex = /<FinancialTransaction[^>]*>([\s\S]*?)<\/FinancialTransaction>/gi;
  let match;

  while ((match = txRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i').exec(block);
      return m ? m[1].trim() : '';
    };

    const id = get('Id') || get('TransactionId') || get('AuthorizationCode') || `stone-${Date.now()}-${Math.random()}`;
    const grossAmount = parseFloat(get('GrossAmount') || get('Amount') || '0') / 100;
    const netAmount = parseFloat(get('NetAmount') || '0') / 100;
    const txType = get('TransactionType') || get('Type') || '';
    const paymentType = get('PaymentType') || get('ProductType') || 'card';
    const date = get('TransactionDate') || get('Date') || referenceDate;
    const cardBrand = get('CardBrand') || get('Brand') || '';
    const installmentNum = parseInt(get('InstallmentNumber') || '1');
    const totalInstallments = parseInt(get('TotalInstallments') || '1');
    const authCode = get('AuthorizationCode') || '';

    // Determine credit/debit
    const isDebit = txType.toLowerCase().includes('debit') ||
      txType.toLowerCase().includes('chargeback') ||
      txType.toLowerCase().includes('refund') ||
      txType.toLowerCase().includes('fee');

    const description = buildDescription(paymentType, cardBrand, installmentNum, totalInstallments, authCode);

    transactions.push({
      id,
      type: isDebit ? 'debit' : 'credit',
      amount: grossAmount,
      net_amount: netAmount || grossAmount,
      date: formatDate(date),
      description,
      payment_type: paymentType,
      installment_number: installmentNum > 1 ? installmentNum : undefined,
      total_installments: totalInstallments > 1 ? totalInstallments : undefined,
      authorization_code: authCode || undefined,
      card_brand: cardBrand || undefined,
      status: 'settled',
    });
  }

  // If no FinancialTransaction found, try alternative format
  if (transactions.length === 0) {
    const altRegex = /<Transaction[^>]*>([\s\S]*?)<\/Transaction>/gi;
    while ((match = altRegex.exec(xml)) !== null) {
      const block = match[1];
      const get = (tag: string) => {
        const m = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i').exec(block);
        return m ? m[1].trim() : '';
      };

      const id = get('Id') || `stone-${Date.now()}-${Math.random()}`;
      const amount = parseFloat(get('Amount') || get('Value') || '0') / 100;
      const netAmount = parseFloat(get('NetAmount') || '0') / 100;
      const type = get('Type') || 'credit';
      const paymentType = get('PaymentType') || 'card';
      const date = get('Date') || referenceDate;
      const cardBrand = get('CardBrand') || '';
      const installmentNum = parseInt(get('InstallmentNumber') || '1');
      const totalInstallments = parseInt(get('TotalInstallments') || '1');
      const authCode = get('AuthorizationCode') || '';

      const description = buildDescription(paymentType, cardBrand, installmentNum, totalInstallments, authCode);

      transactions.push({
        id,
        type: type.toLowerCase().includes('debit') ? 'debit' : 'credit',
        amount,
        net_amount: netAmount || amount,
        date: formatDate(date),
        description,
        payment_type: paymentType,
        installment_number: installmentNum > 1 ? installmentNum : undefined,
        total_installments: totalInstallments > 1 ? totalInstallments : undefined,
        authorization_code: authCode || undefined,
        card_brand: cardBrand || undefined,
        status: 'settled',
      });
    }
  }

  return transactions;
}

function buildDescription(paymentType: string, cardBrand: string, installmentNum: number, totalInstallments: number, authCode: string): string {
  const parts: string[] = [];

  const typeMap: Record<string, string> = {
    'credit': 'Crédito',
    'debit': 'Débito',
    'pix': 'PIX',
    'voucher': 'Voucher',
    'prepaid': 'Pré-pago',
  };

  const type = typeMap[paymentType?.toLowerCase()] || paymentType || 'Cartão';
  parts.push(`Stone - ${type}`);

  if (cardBrand) parts.push(cardBrand);
  if (totalInstallments > 1) parts.push(`${installmentNum}/${totalInstallments}x`);
  if (authCode) parts.push(`Auth: ${authCode}`);

  return parts.join(' · ');
}

function formatDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  // Handle various date formats
  if (dateStr.includes('T')) return dateStr.split('T')[0];
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      // DD/MM/YYYY
      if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  return dateStr.substring(0, 10);
}

function mapPaymentTypeToCategory(paymentType: string): string {
  const map: Record<string, string> = {
    'credit': 'Cartão de Crédito Stone',
    'debit': 'Cartão de Débito Stone',
    'pix': 'PIX Stone',
    'voucher': 'Voucher Stone',
    'prepaid': 'Pré-pago Stone',
  };
  return map[paymentType?.toLowerCase()] || 'Stone';
}
