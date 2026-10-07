// Em que pé está cada conta (2026-10-07, pedido do dono na tela Hoje: "não sei se o produto já foi
// entregue, se a conta entrou pela nota de entrada, pela conciliação ou de outra forma").
// Uma linha curta por conta: de onde veio · mercadoria · boleto · pagamento. Leitura leve (poucas contas
// por vez, só as dos cartões abertos na tela); a Trilha (Financeiro › Trilha) continua sendo o detalhe.
// A montagem é pura (testada em src/test/lib/situacaoConta.test.ts); `lerSituacoes` só busca as peças.
import { supabase } from '@/lib/supabase';

export interface ContaBruta {
  id: string; tenant_id: string; supplier: string | null; description: string | null;
  amount: number | string; paid_amount: number | string | null; status: string | null;
  due_date: string | null; paid_date: string | null; created_at: string | null;
  reference_type: string | null; reference_id: string | null; payment_method: string | null;
  delivery_confirmed: boolean | null; is_recurring: boolean | null;
  boleto_digitavel: string | null; boleto_barcode: string | null; boleto_pix_copia: string | null; boleto_origem: string | null;
}
export interface CompraBruta {
  id: string; invoice_number: string | null; payment_method: string | null; payment_status: string | null;
  delivery_confirmed_at: string | null; delivery_registered_at: string | null; is_bonus: boolean | null;
}
export interface PixBruto { id: string; bill_id: string | null; status: string; created_at: string; replaced_by: string | null }

export type Tom = 'ok' | 'atencao' | 'ruim' | 'neutro';
export interface Etapa { id: 'origem' | 'mercadoria' | 'boleto' | 'pagamento'; texto: string; tom: Tom; icone: string }
export interface SituacaoConta {
  id: string; tenantId: string; fornecedor: string; valor: number; saldo: number;
  vencimento: string | null; paga: boolean; cancelada: boolean; pagaEm: string | null;
  /** Pix/boleto já mandado ao Inter e ainda sem resposta: a pendência de pagamento fica (lembra de recusar). */
  noInter: boolean;
  etapas: Etapa[];
}

const ddmm = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const n = (v: unknown) => Number(v ?? 0) || 0;

/** Status do Pix/boleto preparado no Inter → texto do pagamento. */
const PIX: Record<string, { texto: string; tom: Tom }> = {
  draft: { texto: 'Pagamento preparado — falta tocar em Pagar', tom: 'atencao' },
  awaiting_pin: { texto: 'Pagamento preparado — falta o PIN', tom: 'atencao' },
  sending: { texto: 'Enviando ao Inter', tom: 'neutro' },
  sent: { texto: 'Enviado ao Inter', tom: 'neutro' },
  pending_approval: { texto: 'No Inter — falta aprovar no app', tom: 'atencao' },
  approved: { texto: 'Aprovado no Inter', tom: 'ok' },
  scheduled: { texto: 'Agendado no Inter', tom: 'ok' },
  failed: { texto: 'Pagamento falhou no Inter', tom: 'ruim' },
  rejected: { texto: 'Recusado pelo Inter', tom: 'ruim' },
  expired: { texto: 'Pagamento preparado expirou', tom: 'atencao' },
};
const NO_INTER = new Set(['sending', 'sent', 'pending_approval', 'approved', 'scheduled']);

/** Monta a linha de uma conta. `hoje` = YYYY-MM-DD de Brasília. */
export function montarSituacao(c: ContaBruta, compra: CompraBruta | null, pix: PixBruto | null, hoje: string): SituacaoConta {
  const paga = c.status === 'paid';
  const cancelada = c.status === 'cancelled';
  const saldo = Math.max(0, n(c.amount) - n(c.paid_amount));
  const etapas: Etapa[] = [];
  const rt = c.reference_type ?? '';

  // 1) De onde veio a conta
  if (rt === 'purchase') {
    const nf = compra?.invoice_number?.trim();
    etapas.push(nf
      ? { id: 'origem', texto: `Nota fiscal ${nf}`, tom: 'ok', icone: 'ri-file-text-line' }
      : { id: 'origem', texto: 'Compra lançada sem nota', tom: 'atencao', icone: 'ri-file-warning-line' });
  } else if (rt === 'hr_payroll') etapas.push({ id: 'origem', texto: 'Folha', tom: 'neutro', icone: 'ri-team-line' });
  else if (rt.startsWith('conciliacao')) etapas.push({ id: 'origem', texto: 'Veio do extrato do banco', tom: 'neutro', icone: 'ri-bank-line' });
  else if (c.boleto_origem === 'email') etapas.push({ id: 'origem', texto: 'Boleto chegou por e-mail', tom: 'neutro', icone: 'ri-mail-line' });
  else if (c.is_recurring) etapas.push({ id: 'origem', texto: 'Conta fixa', tom: 'neutro', icone: 'ri-repeat-line' });
  else etapas.push({ id: 'origem', texto: 'Lançada à mão', tom: 'neutro', icone: 'ri-edit-line' });

  // 2) Mercadoria (só compra de mercadoria; bonificação e serviço ficam de fora)
  if (rt === 'purchase' && !compra?.is_bonus) {
    const chegou = compra?.delivery_confirmed_at ?? compra?.delivery_registered_at ?? null;
    if (chegou || c.delivery_confirmed) etapas.push({ id: 'mercadoria', texto: chegou ? `Mercadoria chegou ${ddmm(chegou)}` : 'Mercadoria chegou', tom: 'ok', icone: 'ri-truck-line' });
    else etapas.push({ id: 'mercadoria', texto: 'Entrega não confirmada', tom: 'atencao', icone: 'ri-truck-line' });
  }

  // 3) Boleto (só enquanto falta pagar)
  if (!paga && !cancelada) {
    const metodo = `${c.payment_method ?? ''} ${compra?.payment_method ?? ''}`.toLowerCase();
    if (c.boleto_digitavel || c.boleto_barcode) {
      const de = c.boleto_origem === 'email' ? ' (e-mail)' : c.boleto_origem === 'whatsapp' ? ' (WhatsApp)' : c.boleto_origem === 'foto' ? ' (foto)' : '';
      etapas.push({ id: 'boleto', texto: `Boleto no sistema${de}`, tom: 'ok', icone: 'ri-barcode-line' });
    } else if (c.boleto_pix_copia) etapas.push({ id: 'boleto', texto: 'Pix copia e cola no sistema', tom: 'ok', icone: 'ri-qr-code-line' });
    else if (metodo.includes('boleto')) etapas.push({ id: 'boleto', texto: 'Falta o boleto', tom: 'atencao', icone: 'ri-barcode-line' });
  }

  // 4) Pagamento
  const venc = c.due_date;
  let noInter = false;
  if (paga) etapas.push({ id: 'pagamento', texto: `Pago${c.paid_date ? ` ${ddmm(c.paid_date)}` : ''}`, tom: 'ok', icone: 'ri-check-double-line' });
  else if (cancelada) etapas.push({ id: 'pagamento', texto: 'Conta cancelada', tom: 'neutro', icone: 'ri-close-circle-line' });
  else if (pix && PIX[pix.status]) {
    noInter = NO_INTER.has(pix.status);
    etapas.push({ id: 'pagamento', ...PIX[pix.status], icone: 'ri-bank-card-line' });
  } else if (venc && venc < hoje) etapas.push({ id: 'pagamento', texto: `Não paga — venceu ${ddmm(venc)}`, tom: 'ruim', icone: 'ri-time-line' });
  else if (venc === hoje) etapas.push({ id: 'pagamento', texto: 'Não paga — vence hoje', tom: 'atencao', icone: 'ri-time-line' });
  else etapas.push({ id: 'pagamento', texto: venc ? `A pagar até ${ddmm(venc)}` : 'A pagar', tom: 'neutro', icone: 'ri-time-line' });
  if (!paga && !cancelada && n(c.paid_amount) > 0.005) etapas[etapas.length - 1].texto += ` (falta ${saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`;

  return {
    id: c.id, tenantId: c.tenant_id, fornecedor: c.supplier || c.description || 'Conta', valor: n(c.amount), saldo,
    vencimento: venc, paga, cancelada, pagaEm: c.paid_date, noInter, etapas,
  };
}

/** O último Pix/boleto preparado de cada conta (o que foi substituído não vale). */
export function ultimoPixPorConta(pix: PixBruto[]): Map<string, PixBruto> {
  const m = new Map<string, PixBruto>();
  for (const p of pix) {
    if (!p.bill_id || p.replaced_by) continue;
    const a = m.get(p.bill_id);
    if (!a || p.created_at > a.created_at) m.set(p.bill_id, p);
  }
  return m;
}

const COLS_CONTA = 'id, tenant_id, supplier, description, amount, paid_amount, status, due_date, paid_date, created_at, reference_type, reference_id, payment_method, delivery_confirmed, is_recurring, boleto_digitavel, boleto_barcode, boleto_pix_copia, boleto_origem';

/** Junta compras e Pix das contas lidas e monta a situação de cada uma. */
async function completar(contas: ContaBruta[], hoje: string): Promise<Map<string, SituacaoConta>> {
  const compraIds = [...new Set(contas.filter((c) => c.reference_type === 'purchase' && c.reference_id).map((c) => c.reference_id as string))];
  const ids = contas.map((c) => c.id);
  const [comprasR, pixR] = await Promise.all([
    compraIds.length
      ? supabase.from('fin_purchases').select('id, invoice_number, payment_method, payment_status, delivery_confirmed_at, delivery_registered_at, is_bonus').in('id', compraIds)
      : Promise.resolve({ data: [] as CompraBruta[], error: null }),
    ids.length
      ? supabase.from('fin_inter_payments').select('id, bill_id, status, created_at, replaced_by').in('bill_id', ids)
      : Promise.resolve({ data: [] as PixBruto[], error: null }),
  ]);
  const compras = new Map(((comprasR.data ?? []) as CompraBruta[]).map((c) => [c.id, c]));
  const pix = ultimoPixPorConta((pixR.data ?? []) as PixBruto[]);
  return new Map(contas.map((c) => [c.id, montarSituacao(c, c.reference_id ? compras.get(c.reference_id) ?? null : null, pix.get(c.id) ?? null, hoje)]));
}

/** Situação das contas pedidas (ids). Conta que a pessoa não pode ler simplesmente não volta. */
export async function lerSituacoes(billIds: string[], hoje: string): Promise<Map<string, SituacaoConta>> {
  const ids = [...new Set(billIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from('fin_accounts_payable').select(COLS_CONTA).in('id', ids);
  if (error) throw new Error(error.message);
  return completar((data ?? []) as ContaBruta[], hoje);
}

/** Contas de uma compra (cartão "Chegou a mercadoria?"). */
export async function lerSituacoesDaCompra(tenantId: string, purchaseId: string, hoje: string): Promise<SituacaoConta[]> {
  const { data, error } = await supabase.from('fin_accounts_payable').select(COLS_CONTA)
    .eq('tenant_id', tenantId).eq('reference_type', 'purchase').eq('reference_id', purchaseId).order('due_date');
  if (error) throw new Error(error.message);
  return [...(await completar((data ?? []) as ContaBruta[], hoje)).values()];
}

// ── Achar a conta de um aviso sem bill_id ──────────────────────────────────────────────────────────

/** Primeiro valor em reais de um texto ("Pix de R$ 1.140,00 para…" → 1140). */
export function valorDoTexto(t: string | null | undefined): number | null {
  const m = /R\$\s*([\d.]+,\d{2}|\d+(?:,\d{1,2})?)/.exec(t ?? '');
  if (!m) return null;
  const v = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

const PALAVRAS_VAZIAS = new Set(['ltda', 'eireli', 'com', 'imp', 'exp', 'ind', 'comercio', 'distribuidora', 'para', 'pix', 'pedido', 'grupo', 'loja', 'financeiro', 'de', 'do', 'da', 'e', 'me', 'sa']);
const palavras = (t: string) => new Set(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !PALAVRAS_VAZIAS.has(w)));

/**
 * A conta que provavelmente é a do pedido: mesmo valor (centavo a centavo) e o nome do fornecedor
 * aparece no texto do pedido. Só devolve quando há UMA candidata — com duas, não chuta.
 */
export function contaProvavel<T extends { supplier: string | null; description: string | null; amount: number | string }>(contas: T[], valor: number, texto: string): T | null {
  const doTexto = palavras(texto);
  const ok = contas.filter((c) => Math.abs(n(c.amount) - valor) < 0.01
    && [...palavras(`${c.supplier ?? ''} ${c.description ?? ''}`)].some((w) => doTexto.has(w)));
  return ok.length === 1 ? ok[0] : null;
}

/** Pedido de pagamento do grupo (sem conta ligada): procura a conta do mesmo valor e fornecedor perto da data. */
export async function acharContaDoPedido(tenantId: string, texto: string, criadaEm: string, hoje: string): Promise<SituacaoConta | null> {
  const valor = valorDoTexto(texto);
  if (!valor) return null;
  const d = new Date(criadaEm);
  const de = new Date(d.getTime() - 20 * 86400000).toISOString().slice(0, 10);
  const ate = new Date(d.getTime() + 20 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from('fin_accounts_payable').select(COLS_CONTA)
    .eq('tenant_id', tenantId).gte('amount', valor - 0.01).lte('amount', valor + 0.01).gte('due_date', de).lte('due_date', ate).limit(20);
  if (error || !data?.length) return null;
  const c = contaProvavel(data as ContaBruta[], valor, texto);
  if (!c) return null;
  return (await completar([c], hoje)).get(c.id) ?? null;
}

/** Boleto por e-mail: a conta que ele virou (bill_id) ou a do mesmo valor e vencimento na loja. */
export async function acharContaDoEmail(tenantId: string, mailId: string, hoje: string): Promise<SituacaoConta | null> {
  const { data: m } = await supabase.from('fin_mail_messages').select('bill_id, amount, due_date').eq('id', mailId).maybeSingle();
  const mail = m as { bill_id: string | null; amount: number | null; due_date: string | null } | null;
  if (!mail) return null;
  if (mail.bill_id) return (await lerSituacoes([mail.bill_id], hoje)).get(mail.bill_id) ?? null;
  if (!mail.amount || !mail.due_date) return null;
  const { data } = await supabase.from('fin_accounts_payable').select(COLS_CONTA)
    .eq('tenant_id', tenantId).eq('due_date', mail.due_date).gte('amount', Number(mail.amount) - 0.01).lte('amount', Number(mail.amount) + 0.01).limit(3);
  const lista = (data ?? []) as ContaBruta[];
  if (lista.length !== 1) return null;
  return (await completar(lista, hoje)).get(lista[0].id) ?? null;
}
