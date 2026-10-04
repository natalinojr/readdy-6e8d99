// Confere uma chave da matriz de permissões NO SERVIDOR — a mesma regra da tela (usePermissoes):
// padrão do cargo → ajuste do cargo na loja (tabela permissions) → ajuste da pessoa (user_permissions).
// Criado em 2026-10-04 (revisão de Clientes & Marketing): voucher-write e crm-funnel só conferiam
// "é da loja", então um garçom/tablet emitia gift card ou lia a base de clientes chamando a Edge direto.
// deno-lint-ignore-file no-explicit-any
import { permissoesDaPessoa, PAPEL_TO_DB_ROLE, DB_ROLE_TO_PAPEL } from './permissoes-padrao.ts';
import { ajusteDaPessoaNaLoja } from './ajuste-pessoa.ts';

/** `role` é o de user_tenants (enum EN: admin, manager, supervisor, cashier…); aceita PT por robustez. */
export async function temPermissao(admin: any, tenantId: string, userId: string | null | undefined, role: string | null | undefined, key: string): Promise<boolean> {
  if (!role) return false;
  const papelPt = DB_ROLE_TO_PAPEL[role] ?? role;
  if (papelPt === 'admin') return true;
  const roleEn = PAPEL_TO_DB_ROLE[papelPt] ?? role;
  const { data, error } = await admin.from('permissions').select('permission_key, allowed')
    .eq('tenant_id', tenantId).eq('role', roleEn).eq('permission_key', key);
  if (error) throw new Error(`Falha ao ler permissões: ${error.message}`);
  const pessoa = [...(await ajusteDaPessoaNaLoja(admin, tenantId, userId, [key]))]
    .map(([permission_key, allowed]) => ({ permission_key, allowed }));
  return permissoesDaPessoa(papelPt, data ?? [], pessoa).includes(key as never);
}
