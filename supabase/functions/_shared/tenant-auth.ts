// Autenticação + vínculo com a loja para Edge Functions que usam service role.
// Criado em 2026-09-17 (go-live Paranaguá): várias edges aceitavam qualquer tenant_id sem login.
// Padrão: exigir JWT válido (getUser) e vínculo em user_tenants com a loja pedida; escrita de
// configuração exige admin/gerente. `user_tenants.role` é o enum user_role (EN); aceitamos também
// a grafia PT por robustez (mapa PT↔EN duplicado no front).
// deno-lint-ignore-file no-explicit-any

export interface AuthCaller {
  userId: string | null; // null quando é a própria service role (chamada interna entre edges)
  email: string | null;
  isServiceRole: boolean;
}

const ROLE_RANK: Record<string, number> = {
  admin: 3,
  manager: 2, gerente: 2,
};

/** 3 = admin, 2 = gerente, 1 = demais papéis, 0 = sem vínculo. */
export function roleRank(role: string | null | undefined): number {
  if (!role) return 0;
  return ROLE_RANK[String(role).toLowerCase()] ?? 1;
}

export function isManagerRole(role: string | null | undefined): boolean {
  return roleRank(role) >= 2;
}

/**
 * Quem pode ESCREVER no módulo Financeiro.
 * Separado de isManagerRole de propósito: o papel 'financeiro' não tem rank e
 * por isso continua barrado nas Edges de PDV (pedido, caixa, cardápio, estoque).
 */
export function isFinanceiroRole(role?: string | null): boolean {
  if (isManagerRole(role)) return true;
  return role === 'financeiro';
}

/**
 * Papel Contabilidade (contador(a) da loja, 2026-09-25). Fica FORA de isFinanceiroRole de
 * propósito: nas Edges do Financeiro ele só lê; a escrita é liberada ação a ação (folha e guias),
 * nunca pagamento, baixa ou cadastro de fornecedor/chave Pix.
 */
export function isContabilidadeRole(role?: string | null): boolean {
  return role === 'accountant';
}

export function bearerToken(req: Request): string {
  const h = req.headers.get('Authorization') ?? '';
  return h.replace(/^Bearer\s+/i, '').trim();
}

/** Valida o Bearer. Retorna null se ausente/inválido. Service role conta como chamada interna. */
export async function authenticate(req: Request, admin: any): Promise<AuthCaller | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceKey && token === serviceKey) return { userId: null, email: null, isServiceRole: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data?.user?.id) {
        return { userId: data.user.id, email: data.user.email ?? null, isServiceRole: false };
      }
      // Token inválido/expirado não melhora com retry; só tenta de novo em falha de rede/5xx.
      const status = Number((error as any)?.status ?? 0);
      if (status >= 400 && status < 500) return null;
    } catch { /* rede: tenta 1× */ }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/** Papel do usuário na loja (null = sem vínculo). */
export async function tenantRole(admin: any, userId: string, tenantId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('user_tenants')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao verificar vínculo com a loja: ${error.message}`);
  return data?.role ? String(data.role) : null;
}

/** Todos os vínculos do usuário: tenant_id → role. */
export async function userMemberships(admin: any, userId: string): Promise<Map<string, string>> {
  const { data, error } = await admin.from('user_tenants').select('tenant_id, role').eq('user_id', userId);
  if (error) throw new Error(`Falha ao verificar vínculos: ${error.message}`);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { tenant_id: string; role: string }[]) m.set(String(r.tenant_id), String(r.role));
  return m;
}

export async function isPlatformOwner(admin: any, userId: string): Promise<boolean> {
  const { data, error } = await admin.from('platform_owners').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Falha ao verificar dono da plataforma: ${error.message}`);
  return !!data;
}
