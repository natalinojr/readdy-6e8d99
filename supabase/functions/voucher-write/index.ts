import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { temPermissao } from '../_shared/permissao-servidor.ts';

// Quem pode o quê (2026-10-04, revisão de Clientes & Marketing). Antes a Edge só conferia
// "é da loja": um garçom ou o tablet emitia gift card chamando a função direto.
// - Gestão (tela Vouchers & Gift Cards, aniversário, assistente do dono): chave gestao_vouchers.
// - Leitura no perfil do cliente / config de aniversário: clientes_ver OU gestao_vouchers.
// - Usar no caixa (validar/baixar): qualquer papel que opere PDV/garçom — fora os abaixo.
const ACOES_GESTAO = new Set([
  'issue_voucher', 'cancel_voucher', 'refund_voucher_redemption', 'list_vouchers',
  'get_voucher_transactions', 'set_birthday_config', 'generate_birthday_vouchers',
]);
const ACOES_LEITURA_CLIENTE = new Set(['list_customer_vouchers', 'get_birthday_config']);
const ACOES_PDV = new Set(['validate_voucher', 'redeem_voucher']);
// Papéis que não operam caixa (tablet/totem não usa voucher-write; os outros são presos a módulo).
const PAPEIS_SEM_PDV = new Set(['tablet', 'customer', 'tasks_only', 'accountant', 'financeiro']);
const TIPOS_VOUCHER = new Set(['gift_card', 'discount', 'cashback', 'free_item']);

const round2 = (n: number) => Math.round(n * 100) / 100;

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

/** Gera um código alfanumérico legível (ex: GC-A3F9-X2K1). Aleatório de verdade
 *  (crypto): Math.random é previsível e o código vale dinheiro. 32 símbolos → byte % 32 é uniforme. */
function generateVoucherCode(prefix = 'GC'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (n: number) => {
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  };
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

  // >= 40 (não > 100): as novas chaves do Supabase (sb_secret_…) são curtas (~50 chars),
  // diferente do JWT service_role legado (~200+). O limiar antigo de 100 rejeitava a
  // chave nova e caía na anon → INSERT dava "permission denied (42501)". Mesmo critério
  // do delivery-write (que funciona).
  const effectiveServiceKey = serviceRoleKey.length >= 40 ? serviceRoleKey : anonKey;
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
    let callerRole: string | null;
    if (requestedTenantId) {
      const match = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === requestedTenantId);
      if (!match) return json({ error: 'User does not belong to the requested tenant' }, 403);
      tenantId = match.tenant_id;
      callerRole = (match as { role?: string | null }).role ?? null;
    } else if (tenantRows.length === 1) {
      tenantId = tenantRows[0].tenant_id;
      callerRole = (tenantRows[0] as { role?: string | null }).role ?? null;
    } else {
      return json({ error: 'Multiple tenants found — active_tenant_id required' }, 403);
    }

    // ── Permissão por ação (a tela esconde; quem decide é aqui) ──────────────
    if (ACOES_GESTAO.has(action)) {
      if (!(await temPermissao(admin, tenantId, user.id, callerRole, 'gestao_vouchers'))) {
        return json({ error: 'Sem permissão: emitir, cancelar, estornar e listar vouchers é de quem tem acesso a "Vouchers & Gift Cards" (Clientes & Marketing).', code: 'forbidden' }, 403);
      }
    } else if (ACOES_LEITURA_CLIENTE.has(action)) {
      const pode = (await temPermissao(admin, tenantId, user.id, callerRole, 'clientes_ver'))
        || (await temPermissao(admin, tenantId, user.id, callerRole, 'gestao_vouchers'));
      if (!pode) return json({ error: 'Sem permissão para ver os vouchers dos clientes desta loja.', code: 'forbidden' }, 403);
    } else if (ACOES_PDV.has(action)) {
      if (!callerRole || PAPEIS_SEM_PDV.has(callerRole)) {
        return json({ error: 'Este acesso não pode usar voucher no caixa.', code: 'forbidden' }, 403);
      }
    }

    // O auth.uid do usuário logado nem sempre corresponde a uma linha em public.users
    // (ex.: staff de outra loja com ids próprios, conta-dono multi-loja). issued_by/
    // processed_by têm FK -> users(id); usá-los sem esse cuidado gera 42503 (FK) no
    // insert. Como são campos apenas informativos, resolvemos um id seguro (null se
    // não existir em public.users).
    const { data: issuerRow } = await admin
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    const issuerId: string | null = issuerRow ? user.id : null;

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
      if (!TIPOS_VOUCHER.has(String(voucher_type))) {
        return json({ error: 'Tipo de voucher inválido.' }, 400);
      }
      // Valor do voucher sempre positivo (gift card de R$ 0 ou negativo não existe).
      const valorOriginal = Number(original_amount);
      if (!Number.isFinite(valorOriginal) || valorOriginal <= 0) {
        return json({ error: 'O valor do voucher precisa ser maior que zero.' }, 400);
      }

      // Validações por tipo
      if (voucher_type === 'discount') {
        if (!discount_type || discount_value == null) {
          return json({ error: 'discount_type and discount_value are required for discount vouchers' }, 400);
        }
        if (!['percent', 'fixed'].includes(String(discount_type))) {
          return json({ error: 'Tipo de desconto inválido (percentual ou fixo).' }, 400);
        }
        const valorDesconto = Number(discount_value);
        if (!Number.isFinite(valorDesconto) || valorDesconto <= 0) {
          return json({ error: 'O desconto precisa ser maior que zero.' }, 400);
        }
        if (discount_type === 'percent' && valorDesconto > 100) {
          return json({ error: 'Desconto percentual não pode passar de 100%.' }, 400);
        }
      } else if (discount_value != null && Number(discount_value) < 0) {
        return json({ error: 'O desconto não pode ser negativo.' }, 400);
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
          issued_by: issuerId,
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
        processed_by: issuerId,
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
          await admin.from('vouchers').update({ status: 'expired' }).eq('id', voucher.id).eq('tenant_id', tenantId);
          await admin.from('voucher_transactions').insert({
            tenant_id: tenantId,
            voucher_id: voucher.id,
            transaction_type: 'expired',
            amount: voucher.current_balance,
            balance_after: 0,
            processed_by: issuerId,
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
      const { code, order_id, order_amount } = body;
      const amount = Number(body.amount);

      if (!code || body.amount == null) {
        return json({ error: 'code and amount are required' }, 400);
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return json({ error: 'O valor a baixar do voucher precisa ser maior que zero.' }, 400);
      }

      const { data: voucher, error: fetchErr } = await admin
        .from('vouchers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('code', String(code).trim().toUpperCase())
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!voucher) return json({ error: 'Voucher não encontrado nesta loja.' }, 404);

      // Mesmo pedido já baixou este voucher (reenvio depois de falha parcial no caixa):
      // devolve a baixa que já existe em vez de debitar de novo.
      if (order_id) {
        const { data: jaFeitas, error: jaErr } = await admin
          .from('voucher_transactions')
          .select('id, transaction_type, amount, balance_after')
          .eq('tenant_id', tenantId)
          .eq('voucher_id', voucher.id)
          .eq('order_id', order_id)
          .in('transaction_type', ['redeemed', 'refunded']);
        if (jaErr) throw jaErr;
        const linhas = (jaFeitas ?? []) as { id: string; transaction_type: string; amount: number; balance_after: number }[];
        const usado = linhas.filter((t) => t.transaction_type === 'redeemed').reduce((s, t) => s + Number(t.amount), 0);
        const estornado = linhas.filter((t) => t.transaction_type === 'refunded').reduce((s, t) => s + Number(t.amount), 0);
        if (usado - estornado > 0.004) {
          const ultima = linhas.find((t) => t.transaction_type === 'redeemed');
          return json({
            ok: true,
            already_redeemed: true,
            voucher_id: voucher.id,
            amount_redeemed: round2(usado - estornado),
            balance_after: Number(voucher.current_balance),
            transaction_id: ultima?.id ?? null,
          });
        }
      }

      // Verifica expiração
      const agora = new Date();
      if (voucher.expires_at && new Date(voucher.expires_at) < agora) {
        if (voucher.status === 'active') {
          await admin.from('vouchers').update({ status: 'expired' }).eq('id', voucher.id).eq('tenant_id', tenantId).eq('status', 'active');
        }
        return json({ error: 'Voucher expirado.' }, 422);
      }

      // Verifica início de validade
      if (voucher.valid_from && new Date(voucher.valid_from) > agora) {
        return json({ error: 'Voucher ainda não está valendo.' }, 422);
      }

      if (voucher.status !== 'active') {
        const motivo: Record<string, string> = { depleted: 'já foi usado', cancelled: 'foi cancelado', expired: 'expirou' };
        return json({ error: `Este voucher ${motivo[voucher.status] ?? `está ${voucher.status}`}.` }, 422);
      }

      // Pedido mínimo do voucher (safety-net; a validação principal é no validate)
      const redeemMinOrder = Number(voucher.min_order_amount ?? 0);
      if (redeemMinOrder > 0 && order_amount != null && Number(order_amount) < redeemMinOrder) {
        return json({ error: 'Pedido abaixo do mínimo deste voucher.', min_order_amount: redeemMinOrder }, 422);
      }

      const isSaldo = ['gift_card', 'cashback'].includes(voucher.voucher_type);
      const saldoLido = Number(voucher.current_balance ?? 0);

      // Para gift_card e cashback: verifica saldo suficiente
      if (isSaldo && saldoLido + 0.004 < amount) {
        return json({
          error: 'Saldo do voucher insuficiente.',
          current_balance: saldoLido,
          requested: amount,
        }, 422);
      }

      // Para discount: o amount é o desconto calculado (não desconta do saldo de forma recorrente)

      const maxUses = Math.max(1, Number(voucher.max_uses ?? 1));
      const newUseCount = Number(voucher.use_count ?? 0) + 1;

      let newBalance: number;
      let newStatus: string;
      if (isSaldo) {
        newBalance = Math.max(0, round2(saldoLido - amount)); // nunca negativo
        newStatus = newBalance <= 0 ? 'depleted' : 'active';
      } else {
        // discount e free_item: consumo por número de usos (max_uses)
        newStatus = newUseCount >= maxUses ? 'depleted' : 'active';
        newBalance = newStatus === 'depleted' ? 0 : saldoLido;
      }

      // Baixa CONDICIONAL (compare-and-swap): só grava se o voucher ainda está exatamente como
      // foi lido (ativo, mesmo saldo, mesmo nº de usos) e dentro da validade. Dois caixas usando
      // o mesmo voucher ao mesmo tempo: o segundo pega 0 linhas e recebe erro (mesma trava do
      // delivery-write). Antes: os dois liam o mesmo saldo e os dois gravavam (uso duplo).
      const { data: baixados, error: updateErr } = await admin
        .from('vouchers')
        .update({ current_balance: newBalance, status: newStatus, use_count: newUseCount })
        .eq('id', voucher.id)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .eq('use_count', voucher.use_count)
        .eq('current_balance', voucher.current_balance)
        .or(`expires_at.is.null,expires_at.gt."${agora.toISOString()}"`)
        .select('id');

      if (updateErr) throw updateErr;
      if (!baixados || baixados.length === 0) {
        return json({
          error: 'Este voucher acabou de ser usado em outro pedido. Confira o saldo e tente de novo.',
          code: 'voucher_concurrent',
        }, 409);
      }

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
          processed_by: issuerId,
        })
        .select('id')
        .maybeSingle();

      if (txnErr) {
        // Sem o registro da baixa o saldo some sem rastro: devolve o voucher como estava
        // (condicional: só se ninguém mexeu nele depois desta baixa).
        await admin
          .from('vouchers')
          .update({ current_balance: voucher.current_balance, status: voucher.status, use_count: voucher.use_count })
          .eq('id', voucher.id)
          .eq('tenant_id', tenantId)
          .eq('use_count', newUseCount)
          .eq('current_balance', newBalance);
        throw txnErr;
      }

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
        return json({ error: voucher.status === 'cancelled' ? 'Este voucher já está cancelado.' : 'Este voucher já expirou.' }, 422);
      }

      // NÃO mexe em `notes`: é o texto que o cliente vê no link (/voucher) e a chave do
      // "não duplicar" do aniversário (fn_generate_birthday_vouchers). Antes o cancelamento
      // gravava o motivo (ou null) por cima. Condicional: se o voucher foi usado no meio, 409.
      const { data: cancelados, error: updateErr } = await admin
        .from('vouchers')
        .update({ status: 'cancelled' })
        .eq('id', voucher_id)
        .eq('tenant_id', tenantId)
        .eq('status', voucher.status)
        .eq('current_balance', voucher.current_balance)
        .select('id');

      if (updateErr) throw updateErr;
      if (!cancelados || cancelados.length === 0) {
        return json({ error: 'O voucher mudou agora há pouco (foi usado?). Abra de novo e confira.', code: 'voucher_concurrent' }, 409);
      }

      // Registra transação de cancelamento
      await admin.from('voucher_transactions').insert({
        tenant_id: tenantId,
        voucher_id,
        transaction_type: 'cancelled',
        amount: voucher.current_balance,
        balance_after: 0,
        processed_by: issuerId,
      });

      // Motivo (vem do assistente): voucher_transactions não tem campo de texto, então fica
      // na Auditoria (audit_log.details). user_id é NOT NULL com FK em users → só com issuerId.
      const motivo = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
      if (motivo && issuerId) {
        const { error: audErr } = await admin.from('audit_log').insert({
          tenant_id: tenantId,
          user_id: issuerId,
          action_type: 'voucher_cancelado',
          entity_type: 'Voucher',
          entity_id: voucher_id,
          details: { severity: 'aviso', description: `Voucher cancelado — motivo: ${motivo}`, notes: motivo },
        });
        if (audErr) console.warn('[voucher-write] motivo do cancelamento não foi para a auditoria:', audErr.message);
      }

      return json({ ok: true });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: list_vouchers
    // Lista vouchers do tenant com filtros opcionais
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'list_vouchers') {
      const { status: filterStatus, customer_id, voucher_type } = body;

      // Em blocos de 1000 (limite do PostgREST) até acabar: com uma consulta só, a loja com
      // mais de 1000 vouchers via o saldo em gift cards e os contadores do topo errados.
      const PAGINA = 1000;
      const todos: unknown[] = [];
      for (let pagina = 0; pagina < 200; pagina++) {
        let query = admin
          .from('vouchers')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true });

        if (filterStatus) query = query.eq('status', filterStatus);
        if (customer_id) query = query.eq('customer_id', customer_id);
        if (voucher_type) query = query.eq('voucher_type', voucher_type);

        const { data, error } = await query.range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
        if (error) throw error;
        todos.push(...(data ?? []));
        if (!data || data.length < PAGINA) break;
      }
      return json({ data: todos });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: list_customer_vouchers
    // Vouchers de um cliente: emitidos PARA ele OU resgatados via pedido dele.
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'list_customer_vouchers') {
      const { customer_id } = body;
      if (!customer_id) return json({ error: 'customer_id is required' }, 400);
      const { data, error } = await admin.rpc('fn_get_customer_vouchers', {
        p_tenant_id: tenantId,
        p_customer_id: customer_id,
      });
      if (error) throw error;
      return json({ data });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: get_voucher_transactions
    // Retorna o histórico de transações de um voucher — enriquece os resgates
    // (redeemed) com o NOME DO CLIENTE do pedido (quem usou o voucher).
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

      const { data: txns, error } = await admin
        .from('voucher_transactions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('voucher_id', voucher_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Resolve o nome do cliente pelo pedido (order_id -> orders.customer_id -> customers.name)
      const orderIds = [...new Set((txns ?? []).map((t: { order_id: string | null }) => t.order_id).filter(Boolean))] as string[];
      const nameByOrder: Record<string, string | null> = {};
      if (orderIds.length > 0) {
        const { data: orders } = await admin.from('orders').select('id, customer_id').eq('tenant_id', tenantId).in('id', orderIds);
        const custIds = [...new Set((orders ?? []).map((o: { customer_id: string | null }) => o.customer_id).filter(Boolean))] as string[];
        const nameById: Record<string, string> = {};
        if (custIds.length > 0) {
          const { data: custs } = await admin.from('customers').select('id, name').eq('tenant_id', tenantId).in('id', custIds);
          for (const c of custs ?? []) nameById[(c as { id: string }).id] = (c as { name: string }).name;
        }
        for (const o of orders ?? []) {
          const oo = o as { id: string; customer_id: string | null };
          nameByOrder[oo.id] = oo.customer_id ? (nameById[oo.customer_id] ?? null) : null;
        }
      }

      const enriched = (txns ?? []).map((t: { order_id: string | null }) => ({
        ...t,
        customer_name: t.order_id ? (nameByOrder[t.order_id] ?? null) : null,
      }));

      return json({ data: enriched });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: refund_voucher_redemption
    // Estorna um uso de voucher (ex: pedido cancelado)
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'refund_voucher_redemption') {
      // Estorno de UM uso: exige o uso (transaction_id da baixa) ou o pedido (order_id), e só
      // devolve até (usado − já estornado) daquele uso. Antes aceitava qualquer valor (inclusive
      // negativo) sem olhar o uso, e reativava voucher cancelado/expirado.
      // Nenhuma tela chama esta ação hoje (2026-10-04); só o assistente, pelo JWT do dono.
      const { voucher_id, transaction_id } = body;
      const amount = Number(body.amount);
      if (!voucher_id || body.amount == null) {
        return json({ error: 'voucher_id and amount are required' }, 400);
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return json({ error: 'O valor do estorno precisa ser maior que zero.' }, 400);
      }
      if (!transaction_id && !body.order_id) {
        return json({ error: 'Informe qual uso estornar: transaction_id (a baixa) ou order_id (o pedido).' }, 400);
      }

      const { data: voucher, error: fetchErr } = await admin
        .from('vouchers')
        .select('id, current_balance, original_amount, status, voucher_type, tenant_id, expires_at')
        .eq('id', voucher_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!voucher) return json({ error: 'Voucher não encontrado nesta loja.' }, 404);

      // Só faz sentido estornar gift_card e cashback
      if (!['gift_card', 'cashback'].includes(voucher.voucher_type)) {
        return json({ error: 'Só gift card e cashback aceitam estorno.' }, 422);
      }
      // Estorno não ressuscita voucher cancelado ou vencido.
      if (voucher.status === 'cancelled' || voucher.status === 'expired'
        || (voucher.expires_at && new Date(voucher.expires_at) < new Date())) {
        return json({ error: 'Voucher cancelado ou expirado não recebe estorno.' }, 422);
      }

      // Qual uso: pela baixa (transaction_id) ou pelo pedido. O "escopo" do uso é o pedido da baixa.
      let orderDoUso: string | null = body.order_id ? String(body.order_id) : null;
      if (transaction_id) {
        const { data: uso, error: usoErr } = await admin
          .from('voucher_transactions')
          .select('id, order_id, transaction_type')
          .eq('id', transaction_id)
          .eq('tenant_id', tenantId)
          .eq('voucher_id', voucher_id)
          .maybeSingle();
        if (usoErr) throw usoErr;
        if (!uso || uso.transaction_type !== 'redeemed') {
          return json({ error: 'Uso do voucher não encontrado (transaction_id não é uma baixa deste voucher).' }, 404);
        }
        orderDoUso = uso.order_id ?? null;
      }

      let movQuery = admin
        .from('voucher_transactions')
        .select('transaction_type, amount')
        .eq('tenant_id', tenantId)
        .eq('voucher_id', voucher_id)
        .in('transaction_type', ['redeemed', 'refunded']);
      movQuery = orderDoUso ? movQuery.eq('order_id', orderDoUso) : movQuery.is('order_id', null);
      const { data: movs, error: movErr } = await movQuery;
      if (movErr) throw movErr;
      const usado = (movs ?? []).filter((m: { transaction_type: string }) => m.transaction_type === 'redeemed')
        .reduce((s: number, m: { amount: number }) => s + Number(m.amount), 0);
      const jaEstornado = (movs ?? []).filter((m: { transaction_type: string }) => m.transaction_type === 'refunded')
        .reduce((s: number, m: { amount: number }) => s + Number(m.amount), 0);
      const podeEstornar = round2(usado - jaEstornado);
      if (usado <= 0) {
        return json({ error: 'Não há uso deste voucher nesse pedido para estornar.' }, 422);
      }
      if (amount > podeEstornar + 0.004) {
        return json({
          error: `Estorno maior que o usado: dá para devolver no máximo ${podeEstornar.toFixed(2).replace('.', ',')} deste uso.`,
          max_refundable: Math.max(0, podeEstornar),
        }, 422);
      }

      const saldoLido = Number(voucher.current_balance ?? 0);
      const newBalance = round2(Math.min(saldoLido + amount, Number(voucher.original_amount)));
      const creditado = round2(newBalance - saldoLido);
      if (creditado <= 0) {
        return json({ error: 'O voucher já está com o saldo cheio; nada a estornar.' }, 422);
      }
      const newStatus = newBalance > 0 ? 'active' : voucher.status;

      // Condicional: se o saldo mudou entre a leitura e aqui (outro uso/estorno), 409.
      const { data: estornados, error: updateErr } = await admin
        .from('vouchers')
        .update({ current_balance: newBalance, status: newStatus })
        .eq('id', voucher_id)
        .eq('tenant_id', tenantId)
        .eq('status', voucher.status)
        .eq('current_balance', voucher.current_balance)
        .select('id');

      if (updateErr) throw updateErr;
      if (!estornados || estornados.length === 0) {
        return json({ error: 'O voucher mudou agora há pouco. Abra de novo e confira antes de estornar.', code: 'voucher_concurrent' }, 409);
      }

      await admin.from('voucher_transactions').insert({
        tenant_id: tenantId,
        voucher_id,
        order_id: orderDoUso,
        transaction_type: 'refunded',
        amount: creditado,
        balance_after: newBalance,
        processed_by: issuerId,
      });

      return json({ ok: true, amount_refunded: creditado, balance_after: newBalance });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: get_birthday_config
    // Lê a config de voucher de aniversário da loja (system_settings.birthday_voucher_config).
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'get_birthday_config') {
      const { data: row } = await admin
        .from('system_settings')
        .select('birthday_voucher_config')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      const defaults = { enabled: false, discount_type: 'percent', discount_value: 15, min_order_amount: 0, validity_days: 15, only_opt_in: false, message: null };
      return json({ data: { ...defaults, ...((row?.birthday_voucher_config as Record<string, unknown>) ?? {}) } });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: set_birthday_config
    // Salva a config (a loja define desconto, gasto mínimo, validade, automação).
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'set_birthday_config') {
      const cfg = (body.config ?? {}) as Record<string, unknown>;
      const dtype = ['percent', 'fixed', 'gift_card'].includes(String(cfg.discount_type)) ? String(cfg.discount_type) : 'percent';
      const dval = Math.max(0, Number(cfg.discount_value) || 0);
      if (dval <= 0) return json({ error: 'discount_value deve ser maior que zero' }, 400);
      if (dtype === 'percent' && dval > 100) return json({ error: 'desconto percentual não pode passar de 100' }, 400);
      const validity = Math.min(365, Math.max(1, Math.floor(Number(cfg.validity_days) || 15)));
      const minOrder = Math.max(0, Number(cfg.min_order_amount) || 0);
      const clean = {
        enabled: !!cfg.enabled,
        discount_type: dtype,
        discount_value: dval,
        min_order_amount: minOrder,
        validity_days: validity,
        only_opt_in: !!cfg.only_opt_in,
        message: cfg.message ? String(cfg.message).slice(0, 500) : null,
      };
      const { error: upErr } = await admin
        .from('system_settings')
        .update({ birthday_voucher_config: clean })
        .eq('tenant_id', tenantId);
      if (upErr) throw upErr;
      return json({ data: clean });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: generate_birthday_vouchers
    // Gera manualmente os vouchers de aniversário (padrão: mês inteiro).
    // Idempotente — não duplica quem já recebeu no ano.
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'generate_birthday_vouchers') {
      const scope = body.scope === 'today' ? 'today' : 'month';
      const { data, error: genErr } = await admin.rpc('fn_generate_birthday_vouchers', {
        p_tenant_id: tenantId,
        p_scope: scope,
      });
      if (genErr) throw genErr;
      return json({ data });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    // Nunca retornar "[object Object]": PostgrestError e afins são objetos.
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    const msg = e?.message
      ? `${e.message}${e.code ? ` (${e.code})` : ''}${e.details ? ` — ${e.details}` : ''}`
      : (err instanceof Error ? err.message : JSON.stringify(err));
    return json({ error: msg }, 500);
  }
});
