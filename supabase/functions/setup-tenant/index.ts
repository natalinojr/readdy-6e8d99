/**
 * setup-tenant — cria estabelecimento no onboarding
 * Suporta dois modos:
 *   1. Usuário já existe (existingUserId) — fluxo novo, sem criar conta
 *   2. Usuário novo (email + password) — fluxo legado
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAYMENT_TYPE_MAP: Record<string, string> = {
  dinheiro: 'cash', credito: 'credit_card', debito: 'debit_card',
  pix: 'pix', stone_pix: 'pix', vr: 'meal_voucher', va: 'meal_voucher',
};
const PAYMENT_NAMES: Record<string, string> = {
  dinheiro: 'Dinheiro', credito: 'Cartão de Crédito', debito: 'Cartão de Débito',
  pix: 'PIX', stone_pix: 'PIX Stone', vr: 'Vale Refeição', va: 'Vale Alimentação',
};

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '');
}

async function authAdminListUsers(supabaseUrl: string, serviceKey: string): Promise<Array<{ id: string; email?: string }>> {
  const res = await fetch(`${normalizeUrl(supabaseUrl)}/auth/v1/admin/users?per_page=1000`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
  });
  if (!res.ok) { const txt = await res.text(); throw new Error(`authAdminListUsers failed (${res.status}): ${txt}`); }
  const data = await res.json();
  return data?.users ?? [];
}

async function authAdminCreateUser(supabaseUrl: string, serviceKey: string, email: string, password: string, name: string): Promise<{ id: string }> {
  const res = await fetch(`${normalizeUrl(supabaseUrl)}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
  });
  if (!res.ok) { const txt = await res.text(); throw new Error(`authAdminCreateUser failed (${res.status}): ${txt}`); }
  return res.json();
}

async function authAdminDeleteUser(supabaseUrl: string, serviceKey: string, userId: string): Promise<void> {
  try {
    await fetch(`${normalizeUrl(supabaseUrl)}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    });
  } catch (e) { console.warn('[setup-tenant] authAdminDeleteUser failed:', e); }
}

async function restRpc(supabaseUrl: string, apiKey: string, fn: string, params: Record<string, unknown>, authToken?: string) {
  const token = authToken ?? apiKey;
  const res = await fetch(`${normalizeUrl(supabaseUrl)}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': apiKey, 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, data, text, status: res.status };
}

async function restInsert(supabaseUrl: string, apiKey: string, table: string, body: unknown, prefer = 'return=representation', authToken?: string) {
  const token = authToken ?? apiKey;
  const res = await fetch(`${normalizeUrl(supabaseUrl)}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': apiKey, 'Authorization': `Bearer ${token}`, 'Prefer': prefer },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, data, text, status: res.status };
}

async function restPatch(supabaseUrl: string, apiKey: string, table: string, filter: string, body: unknown, authToken?: string) {
  const token = authToken ?? apiKey;
  const res = await fetch(`${normalizeUrl(supabaseUrl)}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': apiKey, 'Authorization': `Bearer ${token}`, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, text, status: res.status };
}

/**
 * Verifica se o usuário já possui um tenant criado (pelo onboarding).
 * Retorna o tenant_id existente ou null.
 */
async function checkExistingTenant(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${normalizeUrl(supabaseUrl)}/rest/v1/user_tenants?user_id=eq.${userId}&select=tenant_id&limit=1`,
      {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Accept': 'application/json',
        },
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as Array<{ tenant_id: string }>;
    return data?.[0]?.tenant_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Valida o invite code usando a RPC SECURITY DEFINER (evita problemas de permissão na tabela).
 */
async function validateInviteCode(
  supabaseUrl: string,
  serviceKey: string,
  inviteCode: string,
): Promise<{ valid: boolean; inviteId: string | null; alreadyUsed: boolean; reason: string }> {
  const result = await restRpc(supabaseUrl, serviceKey, 'fn_validate_invite_code', {
    p_code: inviteCode,
  });

  console.log('[setup-tenant] validateInviteCode RPC status:', result.status, 'data:', JSON.stringify(result.data));

  if (!result.ok) {
    return { valid: false, inviteId: null, alreadyUsed: false, reason: `Erro ao validar convite (${result.status}): ${result.text}` };
  }

  const data = result.data as { status: string; invite_id?: string; label?: string; invite_code?: string } | null;

  if (!data || data.status === 'invalid') {
    return { valid: false, inviteId: null, alreadyUsed: false, reason: 'Código de convite não encontrado.' };
  }

  if (data.status === 'used') {
    return { valid: false, inviteId: data.invite_id ?? null, alreadyUsed: true, reason: 'Este código de convite já foi utilizado. Cada código só pode criar uma loja.' };
  }

  return { valid: true, inviteId: data.invite_id ?? null, alreadyUsed: false, reason: '' };
}

/**
 * Marca o invite como usado via RPC SECURITY DEFINER.
 */
async function markInviteUsed(
  supabaseUrl: string,
  serviceKey: string,
  inviteId: string,
  tenantId: string,
  email: string,
): Promise<void> {
  const result = await restRpc(supabaseUrl, serviceKey, 'fn_mark_invite_used', {
    p_invite_id: inviteId,
    p_tenant_id: tenantId,
    p_email: email,
  });

  if (!result.ok) {
    throw new Error(`markInviteUsed RPC failed (${result.status}): ${result.text}`);
  }

  const data = result.data as { success?: boolean; error?: string } | null;
  if (!data?.success) {
    throw new Error(`markInviteUsed RPC returned error: ${data?.error ?? 'unknown'}`);
  }

  console.log('[setup-tenant] Invite marcado como usado com sucesso:', inviteId);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: any;
  try { payload = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const {
    email, password, nome, nomeLoja,
    estacoes = [], categorias = [], itens = [],
    mesas, pagamentos = [], pdvs = [],
    inviteCode, existingUserId,
    userAccessToken: _userAccessToken,
  } = payload;

  // ── Validação dos campos obrigatórios ────────────────────────────────────
  const isExistingUserFlow = !!existingUserId;

  if (!email || !nome || !nomeLoja) {
    return new Response(
      JSON.stringify({ error: 'Campos obrigatórios faltando: email, nome, nomeLoja' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (!isExistingUserFlow && !password) {
    return new Response(
      JSON.stringify({ error: 'Campo obrigatório faltando: password' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  console.log('[setup-tenant] supabaseUrl present:', !!supabaseUrl, '| serviceKey length:', serviceRoleKey.length);

  if (!supabaseUrl || !serviceRoleKey || serviceRoleKey.length < 20) {
    return new Response(JSON.stringify({ error: 'Variáveis de ambiente não configuradas no servidor' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Validar invite code ANTES de qualquer coisa ──────────────────────────
  let inviteId: string | null = null;
  let inviteValid = false; // true só quando o convite existe e ainda NÃO foi usado
  if (inviteCode) {
    console.log('[setup-tenant] Validando invite code:', inviteCode);
    const validation = await validateInviteCode(supabaseUrl, serviceRoleKey, inviteCode);
    console.log('[setup-tenant] Validation result:', JSON.stringify(validation));

    if (!validation.valid && !validation.alreadyUsed) {
      // Código não existe
      return new Response(JSON.stringify({ error: validation.reason }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    inviteId = validation.inviteId;
    inviteValid = validation.valid;
    console.log('[setup-tenant] Invite id:', inviteId, '| valid:', inviteValid, '| alreadyUsed:', validation.alreadyUsed);
  }

  // ── Verificar se o usuário já tem uma loja criada ────────────────────────
  // REGRA: um usuário que já tem loja PODE criar outra loja, desde que
  // apresente um convite VÁLIDO e ainda NÃO usado. Sem convite válido,
  // mantemos o bloqueio anti-abuso de 1 loja por usuário.
  if (isExistingUserFlow && existingUserId && !(inviteId && inviteValid)) {
    const existingTenantId = await checkExistingTenant(supabaseUrl, serviceRoleKey, existingUserId);
    if (existingTenantId) {
      console.log('[setup-tenant] Usuário já possui tenant:', existingTenantId, '— verificando se invite precisa ser marcado');

      // ── CORREÇÃO: Se o invite existe e não foi marcado, marca agora ──────
      // Isso acontece quando o usuário completou o onboarding mas o invite
      // não foi marcado por alguma falha na tentativa anterior
      if (inviteId && inviteCode) {
        const recheck = await validateInviteCode(supabaseUrl, serviceRoleKey, inviteCode);
        if (recheck.valid && recheck.inviteId) {
          // Invite ainda não foi marcado — marca agora com o tenant existente
          try {
            await markInviteUsed(supabaseUrl, serviceRoleKey, recheck.inviteId, existingTenantId, email);
            console.log('[setup-tenant] ✅ Invite retroativamente marcado como usado:', recheck.inviteId);
          } catch (e) {
            console.warn('[setup-tenant] Falha ao marcar invite retroativamente:', e);
          }
        }
      }

      return new Response(JSON.stringify({
        error: 'Você já possui uma loja cadastrada. Cada usuário só pode criar uma loja via onboarding. Entre em contato com o suporte se precisar de ajuda.',
        existing_tenant_id: existingTenantId,
        already_exists: true,
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Se o invite já foi usado, bloqueia agora (após verificar existing tenant) ──
  if (inviteCode && inviteId) {
    const revalidation = await validateInviteCode(supabaseUrl, serviceRoleKey, inviteCode);
    if (revalidation.alreadyUsed) {
      return new Response(JSON.stringify({ error: 'Este código de convite já foi utilizado. Cada código só pode criar uma loja.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  let userId: string | null = null;
  let isNewUser = false;
  const insertAuthToken: string = serviceRoleKey;

  try {
    if (isExistingUserFlow) {
      userId = existingUserId;
      isNewUser = false;
      console.log('[setup-tenant] Fluxo existingUser — userId:', userId);
    } else {
      let existingUsers: Array<{ id: string; email?: string }> = [];
      try { existingUsers = await authAdminListUsers(supabaseUrl, serviceRoleKey); } catch { /* ignore */ }

      const existingUser = existingUsers.find((u) => u.email === email);

      if (existingUser) {
        userId = existingUser.id;
        isNewUser = false;
        console.log('[setup-tenant] Usuário já existe, reutilizando:', userId);
      } else {
        try {
          const authUser = await authAdminCreateUser(supabaseUrl, serviceRoleKey, email, password, nome);
          userId = authUser.id;
          isNewUser = true;
          console.log('[setup-tenant] Novo usuário criado:', userId);
        } catch (createErr) {
          const errMsg = String(createErr);
          if (errMsg.includes('already') || errMsg.includes('422')) {
            const retryList = await authAdminListUsers(supabaseUrl, serviceRoleKey);
            const found = retryList.find((u) => u.email === email);
            if (found) {
              userId = found.id;
              isNewUser = false;
            } else {
              return new Response(JSON.stringify({ error: `Erro ao criar conta: ${errMsg}` }), {
                status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
          } else {
            return new Response(JSON.stringify({ error: `Erro ao criar conta: ${errMsg}` }), {
              status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }
    }

    // ── Criar tenant via RPC SECURITY DEFINER ───────────────────────────────
    const slug = `${nomeLoja.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').substring(0, 50)}-${Date.now()}`;
    const rpcResult = await restRpc(supabaseUrl, serviceRoleKey, 'fn_setup_tenant_bypass', {
      p_tenant_name: nomeLoja,
      p_tenant_slug: slug,
      p_tenant_cnpj: null,
      p_user_id: userId,
      p_user_name: nome,
      p_user_email: email,
    });

    if (!rpcResult.ok) {
      if (isNewUser && userId) await authAdminDeleteUser(supabaseUrl, serviceRoleKey, userId);
      return new Response(JSON.stringify({ error: `Erro ao criar estabelecimento (${rpcResult.status}): ${rpcResult.text}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rpcData = rpcResult.data as any;
    const tenantId: string = rpcData?.tenant_id;
    if (!tenantId) {
      if (isNewUser && userId) await authAdminDeleteUser(supabaseUrl, serviceRoleKey, userId);
      return new Response(JSON.stringify({ error: 'Falha ao obter ID do estabelecimento' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Marcar invite como usado IMEDIATAMENTE após criar o tenant ─────────
    if (inviteId && tenantId) {
      try {
        await markInviteUsed(supabaseUrl, serviceRoleKey, inviteId, tenantId, email);
        console.log('[setup-tenant] ✅ Invite marcado como usado:', inviteId);
      } catch (e) {
        // Se não conseguiu marcar o invite, DESFAZ o tenant para manter consistência
        console.error('[setup-tenant] ❌ Falha ao marcar invite como usado — revertendo tenant:', e);
        if (isNewUser && userId) await authAdminDeleteUser(supabaseUrl, serviceRoleKey, userId);
        return new Response(JSON.stringify({ error: `Erro ao confirmar uso do convite. Tente novamente. (${String(e)})` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── Estações de cozinha ─────────────────────────────────────────────────
    // O fn_setup_tenant_bypass NÃO cria mais estações default (evita duplicatas).
    // Aqui usamos as estações escolhidas no onboarding; se nenhuma, criamos um
    // par padrão (Cozinha + Bar) para a loja não nascer sem estação nenhuma.
    const stationMap: Record<string, string> = {};
    const estacoesToCreate: Array<{ id: string; nome: string; cor: string }> =
      estacoes.length > 0
        ? estacoes
        : [
            { id: '__default_cozinha__', nome: 'Cozinha', cor: '#f97316' },
            { id: '__default_bar__', nome: 'Bar', cor: '#06b6d4' },
          ];
    {
      const stationsPayload = estacoesToCreate.map((e: any, i: number) => ({
        tenant_id: tenantId, name: e.nome, color: e.cor, sort_order: i, sla_minutes: 15, is_active: true,
      }));
      const stResult = await restInsert(supabaseUrl, serviceRoleKey, 'kitchen_stations', stationsPayload, 'return=representation', insertAuthToken);
      if (stResult.ok && Array.isArray(stResult.data)) {
        (stResult.data as any[]).forEach((cs: any, i: number) => { if (estacoesToCreate[i]) stationMap[estacoesToCreate[i].id] = cs.id; });
      }
    }

    // ── Categorias ─────────────────────────────────────────────────────────
    const catMap: Record<string, string> = {};
    if (categorias.length > 0) {
      const catsPayload = categorias.map((c: any, i: number) => ({
        tenant_id: tenantId, name: c.nome, station_id: stationMap[c.estacaoId] ?? null, sort_order: i, is_active: true,
      }));
      const catResult = await restInsert(supabaseUrl, serviceRoleKey, 'menu_categories', catsPayload, 'return=representation', insertAuthToken);
      if (catResult.ok && Array.isArray(catResult.data)) {
        (catResult.data as any[]).forEach((cc: any, i: number) => { if (categorias[i]) catMap[categorias[i].id] = cc.id; });
      }
    }

    // ── Itens do cardápio ───────────────────────────────────────────────────
    // menu_items.category_id é NOT NULL. Inserir um item com categoria não
    // mapeada faria o LOTE INTEIRO falhar (perdendo todos os itens). Por isso
    // só enviamos itens cuja categoria foi de fato criada.
    if (itens.length > 0) {
      const itensValidos = (itens as any[]).filter((it: any) => catMap[it.categoriaId]);
      const itensDescartados = itens.length - itensValidos.length;
      if (itensDescartados > 0) {
        console.warn(`[setup-tenant] ${itensDescartados} item(ns) ignorado(s): sem categoria correspondente.`);
      }
      if (itensValidos.length > 0) {
        const itensPayload = itensValidos.map((it: any) => ({
          tenant_id: tenantId,
          category_id: catMap[it.categoriaId],
          name: it.nome,
          description: it.descricao ?? null,
          price: it.preco ?? 0,
          sla_minutes: it.slaMinutos ?? 10,
          is_active: true,
          skip_kds: false,
          sort_order: 0,
          channels: { cashier: true, waiter: true, delivery: true, self_service: true, table_qr: true },
        }));
        await restInsert(supabaseUrl, serviceRoleKey, 'menu_items', itensPayload, 'return=minimal', insertAuthToken);
      }
    }

    // ── Mesas ──────────────────────────────────────────────────────────────
    if (mesas?.temSalao && mesas.quantidadeMesas > 0) {
      const mesasArr: object[] = Array.from({ length: mesas.quantidadeMesas }, (_, i) => ({
        tenant_id: tenantId, number: i + 1, area: 'Salão', capacity: 4, status: 'free', is_active: true,
      }));
      let counter = mesas.quantidadeMesas + 1;
      for (const setor of (mesas.setores ?? [])) {
        const s = setor as any;
        if (s.quantidadeMesas > 0) {
          for (let i = 0; i < s.quantidadeMesas; i++) {
            mesasArr.push({ tenant_id: tenantId, number: counter + i, area: s.nome, capacity: 4, status: 'free', is_active: true });
          }
          counter += s.quantidadeMesas;
        }
      }
      await restInsert(supabaseUrl, serviceRoleKey, 'tables', mesasArr, 'return=minimal', insertAuthToken);
    }

    // ── Formas de pagamento ────────────────────────────────────────────────
    if (pagamentos.length > 0) {
      const pagPayload = (pagamentos as string[]).map((f, i) => ({
        tenant_id: tenantId,
        name: PAYMENT_NAMES[f] ?? f,
        type: PAYMENT_TYPE_MAP[f] ?? 'other',
        sort_order: i,
        is_active: true,
        requires_change: f === 'dinheiro',
      }));
      await restInsert(supabaseUrl, serviceRoleKey, 'payment_methods', pagPayload, 'return=minimal', insertAuthToken);
    }

    // ── PDV Config ─────────────────────────────────────────────────────────
    if (pdvs.length > 0) {
      const pdvMap: Record<string, boolean> = {};
      (pdvs as any[]).forEach((p: any) => { pdvMap[p.id] = Boolean(p.ativo); });

      const pdvConfig = {
        caixa: pdvMap['caixa'] ?? true,
        garcom: pdvMap['garcom'] ?? false,
        kds: pdvMap['kds'] ?? false,
        delivery: pdvMap['delivery'] ?? false,
        autoatendimento: pdvMap['autoatendimento'] ?? false,
        mesa_qr: pdvMap['mesa_qr'] ?? false,
      };

      const patchResult = await restPatch(
        supabaseUrl, serviceRoleKey, 'system_settings',
        `tenant_id=eq.${tenantId}`, { pdv_config: pdvConfig }, insertAuthToken,
      );

      if (!patchResult.ok) {
        await restInsert(
          supabaseUrl, serviceRoleKey, 'system_settings',
          { tenant_id: tenantId, pdv_config: pdvConfig },
          'return=minimal,resolution=merge-duplicates', insertAuthToken,
        );
      }
    }

    console.log('[setup-tenant] ✅ Setup complete! tenant_id:', tenantId, 'user_id:', userId);
    return new Response(JSON.stringify({ success: true, tenant_id: tenantId, user_id: userId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[setup-tenant] ❌ Unhandled error:', err);
    if (isNewUser && userId) {
      try { await authAdminDeleteUser(supabaseUrl, serviceRoleKey, userId); } catch { /* ignore */ }
    }
    return new Response(JSON.stringify({ error: `Erro inesperado: ${String(err)}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
