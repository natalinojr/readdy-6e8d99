// Ajuste da PESSOA numa loja (tabela user_permissions — acesso por pessoa, 2026-10-03). Vem por cima
// do cargo: true = o dono/gerente deu a ela, false = tirou dela; sem linha = vale o cargo. Toda Edge
// que confere uma permission_key pelo cargo (tabela permissions) passa a olhar isto antes.
// deno-lint-ignore-file no-explicit-any

/** Ajuste da pessoa para estas chaves nesta loja (só as que têm linha). */
export async function ajusteDaPessoaNaLoja(admin: any, tenantId: string, userId: string | null | undefined, keys: readonly string[]): Promise<Map<string, boolean>> {
  const m = new Map<string, boolean>();
  if (!userId || !tenantId || !keys.length) return m;
  const { data, error } = await admin.from('user_permissions').select('permission_key, allowed')
    .eq('tenant_id', tenantId).eq('user_id', userId).in('permission_key', [...keys]);
  if (error) throw new Error(`Falha ao ler o acesso da pessoa: ${error.message}`);
  for (const r of (data ?? []) as Array<{ permission_key: string; allowed: boolean }>) m.set(r.permission_key, r.allowed === true);
  return m;
}
