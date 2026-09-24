// Edge pedidos-pagamento (2026-09-24) — módulo "Recebimentos e pagamentos" (/receber).
// Quem tem a permissão pede reembolso, pagamento de freelancer ou de fornecedor sem nota; o dono
// (Admin, ou quem tiver "Aprovar pedidos de pagamento") aprova ou recusa. Aprovado vira conta a pagar
// em aberto (fn_pedido_pagamento_aprovar); a baixa vem da conciliação quando o Pix sai.
// Nada aqui paga: o Pix continua pelo caminho de sempre (trava de Pix permitidos intacta).
// verify_jwt = true.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authenticate, tenantRole } from '../_shared/tenant-auth.ts';
import {
  BUCKET_PEDIDOS, PERM_DO_TIPO, fecharPendencia, nomeDoUsuario, pendenciaDoPedido, permissoesPedido, salvarComprovante,
  type TipoPedido,
} from '../_shared/pedidos-pagamento.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status = 400) => json({ error: msg }, status);

const round2 = (n: number) => Math.round(n * 100) / 100;
const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somaDias = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86400_000).toISOString().slice(0, 10);
const txt = (s: unknown, max = 300) => String(s ?? '').trim().slice(0, max);
const dataOk = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

const CAMPOS = 'id, tipo, status, descricao, valor, data_gasto, vencimento, favorecido_nome, favorecido_doc, pix_chave, dre_category_id, supplier_id, freelancer_id, freelancer_funcao, dias, comprovante_path, purchase_id, bill_id, obs, solicitado_por, solicitado_por_nome, decidido_por_nome, decidido_em, motivo_recusa, created_at';

interface Ctx { admin: any; tenantId: string; userId: string; email: string | null; role: string; perms: Record<string, boolean> }

/** Categorias de despesa que a loja pode escolher (sem receita, imposto e custo de mercadoria — mercadoria vai pela compra). */
async function categorias(ctx: Ctx) {
  const { data, error } = await ctx.admin.from('fin_dre_categories').select('id, name, group_type, parent_id')
    .eq('tenant_id', ctx.tenantId).is('deleted_at', null).limit(1000);
  if (error) throw new Error(error.message);
  const todas = data ?? [];
  const porId = new Map(todas.map((c: any) => [c.id, c]));
  return todas
    .filter((c: any) => !['revenue', 'tax', 'cost'].includes(c.group_type))
    .map((c: any) => {
      const pai = c.parent_id ? porId.get(c.parent_id) as any : null;
      return { id: c.id, nome: pai ? `${pai.name} › ${c.name}` : c.name };
    })
    .sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Situação para a tela: pendente/recusada/cancelada, ou aprovada → aguardando pagamento / paga. */
async function comPagamento(ctx: Ctx, pedidos: any[]) {
  const bills = [...new Set(pedidos.map((p) => p.bill_id).filter(Boolean))];
  const cats = [...new Set(pedidos.map((p) => p.dre_category_id).filter(Boolean))];
  const [{ data: bs }, { data: cs }] = await Promise.all([
    bills.length ? ctx.admin.from('fin_accounts_payable').select('id, status, paid_date').in('id', bills) : Promise.resolve({ data: [] }),
    cats.length ? ctx.admin.from('fin_dre_categories').select('id, name').in('id', cats) : Promise.resolve({ data: [] }),
  ]);
  const bm = new Map((bs ?? []).map((b: any) => [b.id, b]));
  const cm = new Map((cs ?? []).map((c: any) => [c.id, c.name]));
  return pedidos.map((p) => {
    const b: any = p.bill_id ? bm.get(p.bill_id) : null;
    return {
      ...p,
      categoria: p.dre_category_id ? cm.get(p.dre_category_id) ?? null : null,
      pago: b?.status === 'paid',
      pago_em: b?.status === 'paid' ? b.paid_date : null,
      tem_comprovante: !!p.comprovante_path,
      comprovante_path: undefined,
    };
  });
}

async function criar(ctx: Ctx, body: Record<string, any>) {
  const tipo = String(body.tipo ?? '') as TipoPedido;
  if (!PERM_DO_TIPO[tipo]) return erro('Tipo de pedido inválido');
  if (!ctx.perms[PERM_DO_TIPO[tipo]]) return erro('Seu perfil não pode fazer esse pedido. Peça ao administrador para liberar em Configurações › Permissões.', 403);
  const ref = txt(body.ref, 80);
  if (ref.length < 8) return erro('Pedido sem identificação (ref)');

  // Reenvio (sem internet, timeout): devolve o que já foi gravado
  const { data: ja } = await ctx.admin.from('fin_payment_requests').select('id, status').eq('tenant_id', ctx.tenantId).eq('ref', ref).maybeSingle();
  if (ja) return json({ ok: true, id: ja.id, repetido: true });

  const valor = round2(Number(body.valor));
  if (!(valor > 0) || valor > 50000) return erro('Informe o valor (até R$ 50.000)');
  const descricao = txt(body.descricao, 300);
  const pix = txt(body.pix_chave, 140);
  const doc = onlyDigits(body.favorecido_doc).slice(0, 14) || null;
  let nome = txt(body.favorecido_nome, 120);
  const obs = txt(body.obs, 500) || null;
  const hoje = hojeBR();
  const linha: Record<string, any> = {
    tenant_id: ctx.tenantId, tipo, ref, valor, obs, favorecido_doc: doc, pix_chave: pix || null,
    solicitado_por: ctx.userId, solicitado_por_nome: await nomeDoUsuario(ctx.admin, ctx.userId, ctx.email),
  };

  // Classificação: tem que ser uma categoria de despesa desta loja
  const dre = txt(body.dre_category_id, 40) || null;
  if (dre) {
    const ok = (await categorias(ctx)).some((c: any) => c.id === dre);
    if (!ok) return erro('Classificação inválida. Escolha de novo.');
    linha.dre_category_id = dre;
  }

  if (tipo === 'reembolso') {
    if (!descricao) return erro('Conte o que foi comprado');
    if (!nome) return erro('Informe quem recebe o reembolso');
    if (!pix) return erro('Informe a chave Pix de quem recebe');
    if (!dre) return erro('Escolha a classificação (no que foi o gasto)');
    if (!body.comprovante?.base64) return erro('Tire a foto do comprovante');
    if (!dataOk(body.data_gasto) || body.data_gasto > hoje || body.data_gasto < somaDias(hoje, -90)) return erro('Informe o dia da compra (até 90 dias atrás)');
    Object.assign(linha, { descricao, favorecido_nome: nome, data_gasto: body.data_gasto });
  } else if (tipo === 'fornecedor') {
    if (!descricao) return erro('Conte o que está sendo pago');
    const supplierId = txt(body.supplier_id, 40) || null;
    if (supplierId) {
      const { data: f } = await ctx.admin.from('fin_suppliers').select('id, name, cnpj, pix_key').eq('id', supplierId).eq('tenant_id', ctx.tenantId).maybeSingle();
      if (!f) return erro('Fornecedor não encontrado nesta loja');
      nome = f.name;
      linha.supplier_id = f.id;
      if (!linha.favorecido_doc && f.cnpj) linha.favorecido_doc = onlyDigits(f.cnpj) || null;
      // Fornecedor com Pix cadastrado: vale SEMPRE a chave do cadastro (nunca a digitada no celular)
      if (f.pix_key) linha.pix_chave = f.pix_key;
    }
    if (!nome) return erro('Informe o fornecedor');
    if (!linha.pix_chave) return erro('Informe a chave Pix do fornecedor');
    const venc = dataOk(body.vencimento) ? body.vencimento : hoje;
    if (venc < hoje || venc > somaDias(hoje, 120)) return erro('Vencimento inválido (de hoje até 120 dias)');
    Object.assign(linha, { descricao, favorecido_nome: nome, vencimento: venc });
  } else {
    // freelancer
    const dias = [...new Set((Array.isArray(body.dias) ? body.dias : []).filter(dataOk))].sort() as string[];
    if (!dias.length) return erro('Marque os dias trabalhados');
    if (dias.some((d) => d > somaDias(hoje, 7) || d < somaDias(hoje, -90))) return erro('Dia fora do esperado (até 90 dias atrás ou 7 à frente)');
    const freeId = txt(body.freelancer_id, 40) || null;
    let temPix = false;
    if (freeId) {
      const { data: f } = await ctx.admin.from('hr_freelancers').select('id, name, cpf, role, pix_favorecido_id').eq('id', freeId).eq('tenant_id', ctx.tenantId).maybeSingle();
      if (!f) return erro('Freelancer não encontrado nesta loja');
      nome = f.name;
      linha.freelancer_id = f.id;
      if (!linha.favorecido_doc && f.cpf) linha.favorecido_doc = f.cpf;
      if (!txt(body.funcao) && f.role) linha.freelancer_funcao = f.role;
      if (f.pix_favorecido_id) {
        // Pix cadastrado (lista de Pix permitidos): vale a chave do cadastro, nunca a digitada
        const { data: fav } = await ctx.admin.from('fin_pix_favorecidos').select('pix_key').eq('id', f.pix_favorecido_id).eq('tenant_id', ctx.tenantId).maybeSingle();
        if (fav?.pix_key) { linha.pix_chave = fav.pix_key; temPix = true; }
      }
    }
    if (!nome) return erro('Informe o nome do freelancer');
    if (!pix && !temPix) return erro('Informe a chave Pix do freelancer');
    Object.assign(linha, {
      dias, favorecido_nome: nome, freelancer_funcao: txt(body.funcao, 60) || linha.freelancer_funcao || null,
      descricao: descricao || `Diária${dias.length > 1 ? 's' : ''} de freelancer (${dias.length} dia${dias.length > 1 ? 's' : ''})`,
    });
  }

  linha.comprovante_path = await salvarComprovante(ctx.admin, ctx.tenantId, ref, body.comprovante);
  const { data: novo, error } = await ctx.admin.from('fin_payment_requests').insert(linha).select('id').single();
  if (error) {
    if (error.code === '23505') {
      const { data: r } = await ctx.admin.from('fin_payment_requests').select('id').eq('tenant_id', ctx.tenantId).eq('ref', ref).maybeSingle();
      return json({ ok: true, id: r?.id ?? null, repetido: true });
    }
    return erro(`Não consegui gravar o pedido: ${error.message}`, 500);
  }
  await pendenciaDoPedido(ctx.admin, { id: novo.id, tenant_id: ctx.tenantId, tipo, valor, favorecido_nome: linha.favorecido_nome, descricao: linha.descricao, solicitado_por_nome: linha.solicitado_por_nome });
  return json({ ok: true, id: novo.id });
}

const brl = (n: number) => `R$ ${Number(n).toFixed(2).replace('.', ',')}`;
const ROTULO: Record<string, string> = { reembolso: 'Reembolso', freelancer: 'Freelancer', fornecedor: 'Fornecedor sem nota' };

/**
 * Depois de aprovado: prepara o Pix no Inter (inter-bank prepare_payment, ligado à conta) e põe no 📥
 * do chat como "pagamento_pendente" — o botão Pagar pede o PIN, igual aos pagamentos do grupo.
 * A trava continua valendo: chave fora de Fornecedores / Pix permitidos não é preparada; aí a
 * pendência avisa para pagar pelo app do banco (a conciliação dá baixa).
 */
async function prepararPagamento(ctx: Ctx, pedidoId: string): Promise<{ preparado: boolean; motivo?: string }> {
  const { data: p } = await ctx.admin.from('fin_payment_requests')
    .select('id, tipo, status, valor, favorecido_nome, pix_chave, freelancer_id, bill_id, descricao')
    .eq('id', pedidoId).eq('tenant_id', ctx.tenantId).maybeSingle();
  if (!p || p.status !== 'aprovada' || !p.bill_id) return { preparado: false, motivo: 'pedido sem conta a pagar' };
  const { data: bill } = await ctx.admin.from('fin_accounts_payable').select('id, amount, paid_amount, status').eq('id', p.bill_id).maybeSingle();
  if (!bill || bill.status === 'paid') return { preparado: false, motivo: 'conta já paga' };
  let chave: string | null = p.pix_chave;
  if (!chave && p.freelancer_id) {
    const { data: f } = await ctx.admin.from('hr_freelancers').select('pix_favorecido_id').eq('id', p.freelancer_id).maybeSingle();
    if (f?.pix_favorecido_id) {
      const { data: fav } = await ctx.admin.from('fin_pix_favorecidos').select('pix_key').eq('id', f.pix_favorecido_id).maybeSingle();
      chave = fav?.pix_key ?? null;
    }
  }
  const valor = round2(Number(bill.amount) - Number(bill.paid_amount ?? 0));
  const titulo = `${ROTULO[p.tipo] ?? 'Pagamento'} aprovado: Pix de ${brl(valor)} para ${p.favorecido_nome}`;
  let motivo = '';
  if (chave) {
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/inter-bank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': Deno.env.get('FISCAL_INTERNAL_KEY') ?? '' },
      body: JSON.stringify({
        action: 'prepare_payment', tenant_id: ctx.tenantId, tipo: 'pix', chave, valor, bill_id: bill.id,
        descricao: `${ROTULO[p.tipo] ?? 'Pedido'} — ${p.descricao}`.slice(0, 140), requested_by: ctx.userId, channel: 'app',
      }),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }) as unknown as Response);
    const out: any = await r.json().catch(() => ({}));
    const pay = out?.payment;
    if (r.ok && out?.success !== false && pay?.id) {
      await ctx.admin.rpc('fn_pendencia_upsert', {
        p_tenant: ctx.tenantId, p_kind: 'pagamento_pendente', p_ref: String(pay.id),
        p_titulo: titulo, p_detalhe: `Chave ${chave}. Toque em Pagar e confirme com o PIN.`,
        p_payload: { payment_id: pay.id, bill_id: bill.id, pedido_id: p.id }, p_rota: null,
        p_urgencia: 'alta', p_acao_requerida: true, p_origem: 'app', p_reabrir: true,
      });
      return { preparado: true };
    }
    motivo = String(out?.error ?? `Inter respondeu ${r.status}`);
  } else {
    motivo = 'pedido sem chave Pix';
  }
  // Não deu para preparar (trava do Pix, Inter sem configuração…): avisa para pagar por fora
  await ctx.admin.rpc('fn_pendencia_upsert', {
    p_tenant: ctx.tenantId, p_kind: 'pedido_pagamento_pagar', p_ref: p.id,
    p_titulo: titulo,
    p_detalhe: `${chave ? `Chave ${chave}. ` : ''}O assistente não preparou o Pix: ${motivo}. Pague pelo app do banco — a conciliação dá baixa na conta.`,
    p_payload: { pedido_id: p.id, bill_id: bill.id, chave }, p_rota: '/receber?aprovar=1',
    p_urgencia: 'alta', p_acao_requerida: true, p_origem: 'app', p_reabrir: true,
  });
  return { preparado: false, motivo };
}

async function carregarPedido(ctx: Ctx, id: string) {
  const { data } = await ctx.admin.from('fin_payment_requests').select(CAMPOS).eq('id', id).eq('tenant_id', ctx.tenantId).maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !service) return erro('Server misconfiguration', 500);
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return erro('JSON inválido'); }
  const action = String(body.action ?? '');

  try {
    const caller = await authenticate(req, admin);
    if (!caller || caller.isServiceRole || !caller.userId) return erro('Sessão expirada. Entre de novo no ERPOS.', 401);
    const tenantId = String(body.tenant_id ?? '');
    if (!tenantId) return erro('tenant_id obrigatório');
    const role = await tenantRole(admin, caller.userId, tenantId);
    if (!role) return erro('Sem acesso a esta loja', 403);
    const perms = await permissoesPedido(admin, tenantId, role);
    const ctx: Ctx = { admin, tenantId, userId: caller.userId, email: caller.email, role, perms };
    const podePedir = perms.pag_reembolso || perms.pag_freelancer || perms.pag_fornecedor;
    const aprovador = perms.pag_aprovar;

    switch (action) {
      case 'contexto': {
        let aprovar = 0;
        if (aprovador) {
          const { count } = await admin.from('fin_payment_requests').select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId).eq('status', 'pendente');
          aprovar = count ?? 0;
        }
        // Última chave Pix usada pela pessoa num reembolso (evita digitar toda vez)
        const { data: ult } = await admin.from('fin_payment_requests').select('pix_chave, favorecido_nome')
          .eq('tenant_id', tenantId).eq('solicitado_por', caller.userId).eq('tipo', 'reembolso')
          .not('pix_chave', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
        return json({
          perms, para_aprovar: aprovar,
          nome: await nomeDoUsuario(admin, caller.userId, caller.email),
          ultimo_reembolso: ult ? { pix_chave: ult.pix_chave, nome: ult.favorecido_nome } : null,
        });
      }
      case 'categorias':
        if (!podePedir && !aprovador) return erro('Sem permissão', 403);
        return json({ categorias: await categorias(ctx) });
      case 'freelancers': {
        if (!perms.pag_freelancer && !aprovador) return erro('Sem permissão', 403);
        const { data } = await admin.from('hr_freelancers').select('id, name, role, daily_rate, pix_favorecido_id')
          .eq('tenant_id', tenantId).eq('is_active', true).order('name').limit(500);
        return json({ freelancers: (data ?? []).map((f: any) => ({ id: f.id, nome: f.name, funcao: f.role, diaria: f.daily_rate, tem_pix: !!f.pix_favorecido_id })) });
      }
      case 'fornecedores': {
        if (!perms.pag_fornecedor && !aprovador) return erro('Sem permissão', 403);
        const { data } = await admin.from('fin_suppliers').select('id, name, cnpj, pix_key').eq('tenant_id', tenantId).eq('is_active', true).order('name').limit(1000);
        return json({ fornecedores: (data ?? []).map((f: any) => ({ id: f.id, nome: f.name, cnpj: f.cnpj, tem_pix: !!f.pix_key })) });
      }
      case 'criar': return await criar(ctx, body);
      case 'meus': {
        const { data, error } = await admin.from('fin_payment_requests').select(CAMPOS)
          .eq('tenant_id', tenantId).eq('solicitado_por', caller.userId).gte('created_at', `${somaDias(hojeBR(), -60)}T00:00:00-03:00`)
          .order('created_at', { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        return json({ pedidos: await comPagamento(ctx, data ?? []) });
      }
      case 'cancelar': {
        const p = await carregarPedido(ctx, String(body.id ?? ''));
        if (!p || p.solicitado_por !== caller.userId) return erro('Pedido não encontrado', 404);
        if (p.status !== 'pendente') return erro('Só dá para cancelar pedido que ainda não foi aprovado');
        if (p.purchase_id) return erro('Esse reembolso está ligado a uma compra já lançada. Fale com o financeiro.');
        const { data: upd } = await admin.from('fin_payment_requests').update({ status: 'cancelada', updated_at: new Date().toISOString() })
          .eq('id', p.id).eq('status', 'pendente').select('id');
        if (!upd?.length) return erro('O pedido mudou enquanto você cancelava. Atualize a tela.');
        await fecharPendencia(admin, tenantId, p.id, caller.userId, 'descartada', 'Cancelado por quem pediu');
        return json({ ok: true });
      }
      case 'para_aprovar': {
        if (!aprovador) return erro('Só o financeiro aprova pedidos de pagamento.', 403);
        const [pend, dec] = await Promise.all([
          admin.from('fin_payment_requests').select(CAMPOS).eq('tenant_id', tenantId).eq('status', 'pendente').order('created_at').limit(200),
          admin.from('fin_payment_requests').select(CAMPOS).eq('tenant_id', tenantId).neq('status', 'pendente')
            .gte('updated_at', `${somaDias(hojeBR(), -15)}T00:00:00-03:00`).order('updated_at', { ascending: false }).limit(100),
        ]);
        if (pend.error) throw new Error(pend.error.message);
        return json({ pendentes: await comPagamento(ctx, pend.data ?? []), decididos: await comPagamento(ctx, dec.data ?? []) });
      }
      case 'comprovante': {
        const { data: p } = await admin.from('fin_payment_requests').select('solicitado_por, comprovante_path').eq('id', String(body.id ?? '')).eq('tenant_id', tenantId).maybeSingle();
        if (!p || (!aprovador && p.solicitado_por !== caller.userId)) return erro('Pedido não encontrado', 404);
        if (!p.comprovante_path) return erro('Esse pedido não tem comprovante', 404);
        const { data, error } = await admin.storage.from(BUCKET_PEDIDOS).createSignedUrl(p.comprovante_path, 600);
        if (error) throw new Error(error.message);
        // A tela mostra dentro do app (imagem ajustada à tela); PDF abre pelo visualizador do celular
        return json({ url: data.signedUrl, pdf: /\.pdf$/i.test(p.comprovante_path) });
      }
      case 'aprovar': {
        if (!aprovador) return erro('Só o financeiro aprova pedidos de pagamento.', 403);
        const p = await carregarPedido(ctx, String(body.id ?? ''));
        if (!p) return erro('Pedido não encontrado', 404);
        // Ninguém aprova o próprio pedido — só o Admin (o dono)
        if (p.solicitado_por === caller.userId && role !== 'admin') return erro('Você não pode aprovar o seu próprio pedido. Peça ao financeiro.', 403);
        const valor = body.valor != null && body.valor !== '' ? round2(Number(body.valor)) : null;
        if (valor != null && !(valor > 0 && valor <= 50000)) return erro('Valor inválido');
        const dre = txt(body.dre_category_id, 40) || null;
        if (dre && !(await categorias(ctx)).some((c: any) => c.id === dre)) return erro('Classificação inválida');
        const { data, error } = await admin.rpc('fn_pedido_pagamento_aprovar', {
          p_id: p.id, p_user: caller.userId, p_user_nome: await nomeDoUsuario(admin, caller.userId, caller.email),
          p_dre: dre, p_valor: p.purchase_id ? null : valor,
        });
        if (error) return erro(error.message.replace(/^.*?:\s*/, ''), 400);
        const pagamento = await prepararPagamento(ctx, p.id).catch((e) => ({ preparado: false, motivo: String((e as Error)?.message ?? e) }));
        return json({ ...(data as Record<string, unknown>), pagamento });
      }
      case 'preparar_pagamento': {
        // Aprovado antes (ou o preparo falhou): manda de novo para o 📥 com o botão Pagar
        if (!aprovador) return erro('Só o financeiro paga pedidos de pagamento.', 403);
        const p = await carregarPedido(ctx, String(body.id ?? ''));
        if (!p) return erro('Pedido não encontrado', 404);
        if (p.status !== 'aprovada') return erro('Só pedido aprovado vai para pagamento');
        return json({ ok: true, pagamento: await prepararPagamento(ctx, p.id) });
      }
      case 'recusar': {
        if (!aprovador) return erro('Só o financeiro recusa pedidos de pagamento.', 403);
        const p = await carregarPedido(ctx, String(body.id ?? ''));
        if (!p) return erro('Pedido não encontrado', 404);
        if (p.status !== 'pendente') return erro(`Esse pedido já foi ${p.status}`);
        const motivo = txt(body.motivo, 300);
        if (motivo.length < 3) return erro('Diga o motivo da recusa (a pessoa vai ver)');
        const { data: upd } = await admin.from('fin_payment_requests').update({
          status: 'recusada', motivo_recusa: motivo, decidido_por: caller.userId,
          decidido_por_nome: await nomeDoUsuario(admin, caller.userId, caller.email), decidido_em: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', p.id).eq('status', 'pendente').select('id');
        if (!upd?.length) return erro('O pedido mudou enquanto você recusava. Atualize a tela.');
        await fecharPendencia(admin, tenantId, p.id, caller.userId, 'descartada', `Recusado: ${motivo}`);
        return json({ ok: true });
      }
      default: return erro(`Ação inválida: ${action}`);
    }
  } catch (e) {
    console.error('[pedidos-pagamento]', action, e);
    return erro((e as Error)?.message ?? 'Erro interno', 500);
  }
});
