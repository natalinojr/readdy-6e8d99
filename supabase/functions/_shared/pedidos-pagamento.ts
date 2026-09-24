// Pedidos de pagamento da loja (reembolso, freelancer, fornecedor sem nota) — 2026-09-24.
// Usado pela Edge pedidos-pagamento e pela receber-mercadoria ("Paguei do meu bolso" no recebimento).
// Regra do dono: o pedido só vira conta a pagar depois que ele aprova (fn_pedido_pagamento_aprovar).
// deno-lint-ignore-file no-explicit-any

export type TipoPedido = 'reembolso' | 'freelancer' | 'fornecedor';
export type PermPedido = 'pag_reembolso' | 'pag_freelancer' | 'pag_fornecedor' | 'pag_aprovar';

export const PERM_DO_TIPO: Record<TipoPedido, PermPedido> = {
  reembolso: 'pag_reembolso', freelancer: 'pag_freelancer', fornecedor: 'pag_fornecedor',
};
export const BUCKET_PEDIDOS = 'pedidos-pagamento';

// Mesmos papéis EN↔PT que o front grava na tabela permissions
const ROLE_ALIASES: Record<string, string[]> = {
  admin: ['admin'],
  manager: ['manager', 'gerente'], gerente: ['manager', 'gerente'],
  supervisor: ['supervisor', 'supervisao'], supervisao: ['supervisor', 'supervisao'],
  cashier: ['cashier', 'caixa'], caixa: ['cashier', 'caixa'],
  waiter: ['waiter', 'garcom'], garcom: ['waiter', 'garcom'],
  kitchen: ['kitchen', 'cozinha'], cozinha: ['kitchen', 'cozinha'],
  financeiro: ['financeiro'],
};

/** Sem linha na matriz vale o padrão do front (DEFAULT_PERMISSOES): pedir = admin/gerente; aprovar = só admin. */
function padrao(role: string, key: PermPedido): boolean {
  if (role === 'admin') return true;
  if (key === 'pag_aprovar') return false;
  return role === 'manager' || role === 'gerente';
}

/** Permissões de pedido de pagamento do papel na loja. Admin tem todas (o dono aprova). */
export async function permissoesPedido(admin: any, tenantId: string, role: string): Promise<Record<PermPedido, boolean>> {
  const keys: PermPedido[] = ['pag_reembolso', 'pag_freelancer', 'pag_fornecedor', 'pag_aprovar'];
  const out = Object.fromEntries(keys.map((k) => [k, padrao(role, k)])) as Record<PermPedido, boolean>;
  if (role === 'admin') return out;
  const { data } = await admin.from('permissions').select('permission_key, allowed')
    .eq('tenant_id', tenantId).in('role', ROLE_ALIASES[role] ?? [role]).in('permission_key', keys);
  const vistos = new Set<string>();
  for (const r of data ?? []) {
    const k = r.permission_key as PermPedido;
    // Duas grafias do papel (EN/PT): basta uma liberar
    out[k] = vistos.has(k) ? out[k] || r.allowed === true : r.allowed === true;
    vistos.add(k);
  }
  return out;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
};

/** Grava o comprovante (base64) no bucket privado. Devolve o caminho ou lança erro legível. */
export async function salvarComprovante(admin: any, tenantId: string, ref: string, c: { base64?: string; media_type?: string } | null | undefined): Promise<string | null> {
  if (!c?.base64) return null;
  const tipo = String(c.media_type ?? 'image/jpeg').toLowerCase();
  const ext = EXT[tipo];
  if (!ext) throw new Error('Comprovante precisa ser foto (JPG/PNG) ou PDF.');
  const bin = Uint8Array.from(atob(String(c.base64).replace(/^data:[^,]+,/, '')), (ch) => ch.charCodeAt(0));
  if (bin.byteLength > 10 * 1024 * 1024) throw new Error('Comprovante maior que 10 MB. Tire outra foto.');
  const path = `${tenantId}/${ref.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60)}.${ext}`;
  const { error } = await admin.storage.from(BUCKET_PEDIDOS).upload(path, bin, { contentType: tipo, upsert: true });
  if (error) throw new Error(`Não consegui guardar o comprovante: ${error.message}`);
  return path;
}

const brl = (n: number) => `R$ ${Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const ROTULO: Record<TipoPedido, string> = { reembolso: 'Reembolso', freelancer: 'Freelancer', fornecedor: 'Fornecedor sem nota' };

/** Avisa o dono no 📥 do chat (uma pendência por pedido). */
export async function pendenciaDoPedido(admin: any, p: { id: string; tenant_id: string; tipo: TipoPedido; valor: number; favorecido_nome: string; descricao: string; solicitado_por_nome: string | null }) {
  const { error } = await admin.rpc('fn_pendencia_upsert', {
    p_tenant: p.tenant_id, p_kind: 'pedido_pagamento', p_ref: p.id,
    p_titulo: `${ROTULO[p.tipo]} de ${brl(p.valor)} — ${p.favorecido_nome}`,
    p_detalhe: `${p.descricao}. Pedido por ${p.solicitado_por_nome ?? 'alguém da loja'}. Só vira conta a pagar depois de aprovado.`,
    p_payload: { pedido_id: p.id, tipo: p.tipo, valor: p.valor },
    p_rota: '/receber?aprovar=1', p_urgencia: 'normal', p_acao_requerida: true, p_origem: 'app', p_reabrir: false,
  });
  if (error) console.error('[pedidos-pagamento] pendência', error.message);
}

export async function fecharPendencia(admin: any, tenantId: string, pedidoId: string, userId: string, status: 'resolvida' | 'descartada', motivo?: string) {
  await admin.from('pendencias').update({ status, resolvida_em: new Date().toISOString(), resolvida_por: userId, motivo: motivo ?? null, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('kind', 'pedido_pagamento').eq('ref', pedidoId).in('status', ['aberta', 'vista']);
}

export async function nomeDoUsuario(admin: any, userId: string, email: string | null): Promise<string> {
  const { data } = await admin.from('users').select('name').eq('id', userId).maybeSingle();
  return String(data?.name ?? '').trim() || (email ?? '').split('@')[0] || 'alguém da loja';
}
