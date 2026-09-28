// Pedidos de pagamento da loja (reembolso, freelancer, fornecedor sem nota) — 2026-09-24.
// Compra online (2026-09-28): link do produto → dono autoriza e compra na conta da loja; sem conta a pagar.
// Usado pela Edge pedidos-pagamento e pela receber-mercadoria ("Paguei do meu bolso" no recebimento).
// Regra do dono: o pedido só vira conta a pagar depois que ele aprova (fn_pedido_pagamento_aprovar).
// deno-lint-ignore-file no-explicit-any

export type TipoPedido = 'reembolso' | 'freelancer' | 'fornecedor' | 'compra_online';
export type PermPedido = 'pag_reembolso' | 'pag_freelancer' | 'pag_fornecedor' | 'pag_compra_online' | 'pag_aprovar';

export const PERM_DO_TIPO: Record<TipoPedido, PermPedido> = {
  reembolso: 'pag_reembolso', freelancer: 'pag_freelancer', fornecedor: 'pag_fornecedor', compra_online: 'pag_compra_online',
};
export const BUCKET_PEDIDOS = 'pedidos-pagamento';

// permissions.role é o enum user_role (só EN). Filtrar por grafia PT ('caixa') faz o Postgres
// recusar a consulta inteira ("invalid input value for enum") — e a permissão parecia desligada.
export const PT_PARA_EN: Record<string, string> = {
  gerente: 'manager', supervisao: 'supervisor', caixa: 'cashier', garcom: 'waiter', cozinha: 'kitchen',
};

/** Sem linha na matriz vale o padrão do front (DEFAULT_PERMISSOES): pedir = admin/gerente; aprovar = só admin. */
function padrao(role: string, key: PermPedido): boolean {
  if (role === 'admin') return true;
  if (key === 'pag_aprovar') return false;
  return role === 'manager';
}

/** Permissões de pedido de pagamento do papel na loja. Admin tem todas (o dono aprova). */
export async function permissoesPedido(admin: any, tenantId: string, role: string): Promise<Record<PermPedido, boolean>> {
  const keys: PermPedido[] = ['pag_reembolso', 'pag_freelancer', 'pag_fornecedor', 'pag_compra_online', 'pag_aprovar'];
  const papel = PT_PARA_EN[role] ?? role;
  const out = Object.fromEntries(keys.map((k) => [k, padrao(papel, k)])) as Record<PermPedido, boolean>;
  if (papel === 'admin') return out;
  const { data, error } = await admin.from('permissions').select('permission_key, allowed')
    .eq('tenant_id', tenantId).eq('role', papel).in('permission_key', keys);
  if (error) throw new Error(`Falha ao ler permissões: ${error.message}`);
  for (const r of data ?? []) out[r.permission_key as PermPedido] = r.allowed === true;
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
const ROTULO: Record<TipoPedido, string> = { reembolso: 'Reembolso', freelancer: 'Freelancer', fornecedor: 'Fornecedor sem nota', compra_online: 'Compra online' };

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** '2026-09-26' → '26/09 (sáb)'. */
const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)} (${SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()]})`;
/** Dias trabalhados do freela para o dono saber o que está aprovando: "Dias 24/09 (qui), 26/09 (sáb)".
 *  Com valor por dia (alinhado a `dias`): "Dias 24/09 (qui) R$ 100,00, 26/09 (sáb) R$ 120,00". */
export function textoDias(dias: string[] | null | undefined, valores?: (number | string)[] | null): string {
  const pares = (dias ?? []).map((d, i) => ({ d, v: valores?.length === dias?.length ? Number(valores[i]) : NaN }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.d))
    .filter((x, i, a) => a.findIndex((y) => y.d === x.d) === i)
    .sort((a, b) => a.d.localeCompare(b.d));
  if (!pares.length) return '';
  return `${pares.length > 1 ? 'Dias' : 'Dia'} ${pares.map((x) => `${diaCurto(x.d)}${x.v > 0 ? ` ${brl(x.v)}` : ''}`).join(', ')}`;
}

/** Avisa o dono no 📥 do chat (uma pendência por pedido). */
export async function pendenciaDoPedido(admin: any, p: { id: string; tenant_id: string; tipo: TipoPedido; valor: number; favorecido_nome: string; descricao: string; solicitado_por_nome: string | null; dias?: string[] | null; valores_dia?: number[] | null }) {
  const dias = p.tipo === 'freelancer' ? textoDias(p.dias, p.valores_dia) : '';
  const { error } = await admin.rpc('fn_pendencia_upsert', {
    p_tenant: p.tenant_id, p_kind: 'pedido_pagamento', p_ref: p.id,
    p_titulo: `${ROTULO[p.tipo]} de ${brl(p.valor)} — ${p.favorecido_nome}`,
    p_detalhe: `${p.descricao.replace(/\.$/, '')}.${dias ? ` ${dias}.` : ''} Pedido por ${p.solicitado_por_nome ?? 'alguém da loja'}. ${p.tipo === 'compra_online' ? 'Classifique (despesa ou CMV) e pague o Pix do site — vira compra e o Pix sai pelo Inter.' : 'Só vira conta a pagar depois de aprovado.'}`,
    p_payload: { pedido_id: p.id, tipo: p.tipo, valor: p.valor, ...(p.dias?.length ? { dias: p.dias } : {}) },
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

// ── Compra online: o link colado (2026-09-28) ──
// O app do Mercado Livre compartilha "Olha o que encontrei… <título> https://…" — vale o 1º link do texto.
// A API do ML não lê anúncio com o token da loja (403), então nome e nº saem do próprio endereço.
const SITES: [RegExp, string][] = [
  [/(^|\.)mercadoli(vre|bre)\.com(\.br)?$/, 'Mercado Livre'], [/(^|\.)mercadopago\.com(\.br)?$/, 'Mercado Pago'],
  [/(^|\.)shopee\.com\.br$/, 'Shopee'], [/(^|\.)amazon\.com(\.br)?$/, 'Amazon'], [/(^|\.)amzn\.to$/, 'Amazon'],
  [/(^|\.)(magazineluiza|magalu)\.com(\.br)?$/, 'Magalu'], [/(^|\.)aliexpress\.com$/, 'AliExpress'],
];
export function lerLinkCompra(texto: string): { url: string; site: string; anuncio_id: string | null; titulo: string | null } | null {
  const m = String(texto ?? '').match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  let u: URL;
  try { u = new URL(m[0].replace(/[).,;!?]+$/, '')); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const site = SITES.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, '');
  const id = u.pathname.match(/MLB-?(\d{6,})/i);
  const anuncio_id = id ? `MLB${id[1]}` : null;
  // Título: texto antes do link (compartilhar do app) ou o "slug" do endereço
  const antes = String(texto).slice(0, m.index).replace(/^.*?(encontrei|achei)[^!:\n]*[!:]?\s*/i, '').replace(/[\s:–—-]+$/, '').trim();
  const partes = u.pathname.split('/').filter(Boolean);
  const depoisDoId = id ? u.pathname.split(/MLB-?\d{6,}-?/i)[1]?.split('/')[0] ?? '' : '';
  const slug = depoisDoId || partes.find((p) => /[a-z]-[a-z]/i.test(p)) || '';
  let doSlug = '';
  try { doSlug = decodeURIComponent(slug); } catch { doSlug = slug; }
  doSlug = doSlug.replace(/[-_]+JM$/i, '').replace(/-i\.\d+\.\d+$/, '').replace(/[-_]+/g, ' ').trim();
  const titulo = (antes.length >= 4 ? antes : doSlug).slice(0, 200) || null;
  return { url: u.toString(), site, anuncio_id, titulo: titulo ? titulo.charAt(0).toUpperCase() + titulo.slice(1) : null };
}
