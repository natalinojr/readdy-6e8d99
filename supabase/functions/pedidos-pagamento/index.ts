// Edge pedidos-pagamento (2026-09-24) — módulo "Recebimentos e pagamentos" (/receber).
// Quem tem a permissão pede reembolso, pagamento de freelancer ou de fornecedor sem nota; o dono
// (Admin, ou quem tiver "Aprovar pedidos de pagamento") aprova ou recusa. Aprovado vira conta a pagar
// em aberto (fn_pedido_pagamento_aprovar); a baixa vem da conciliação quando o Pix sai.
// Nada aqui paga: o Pix continua pelo caminho de sempre (trava de Pix permitidos intacta).
// Compra online (2026-09-28): o pedido traz o link; aprovar só AUTORIZA (sem conta a pagar) e o dono
// compra na conta da loja e registra (ação 'comprado'). O custo entra pela NF-e do vendedor.
// Desde 2026-09-28 (tarde): o pedido traz o Pix copia e cola do checkout; o dono classifica
// (Despesa/CMV) ao aprovar, nasce a compra com a conta a pagar e o Pix sai pelo Inter com o PIN.
// A NF-e do vendedor que chegar depois é ignorada (gatilho trg_nota_da_compra_online).
// verify_jwt = true.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authenticate, tenantRole } from '../_shared/tenant-auth.ts';
import {
  BUCKET_PEDIDOS, PERM_DO_TIPO, fecharPendencia, lerLinkCompra, nomeDoUsuario, pendenciaDoPedido, permissoesPedido, salvarComprovante,
  type TipoPedido,
} from '../_shared/pedidos-pagamento.ts';
import { lerPrintCompra } from './print-compra.ts';
import { acharCopiaECola, lerCopia } from '../_shared/guias.ts';

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

const CAMPOS = 'id, tipo, status, descricao, valor, data_gasto, vencimento, favorecido_nome, favorecido_doc, pix_chave, dre_category_id, supplier_id, freelancer_id, freelancer_funcao, dias, valores_dia, comprovante_path, purchase_id, bill_id, obs, solicitado_por, solicitado_por_nome, decidido_por_nome, decidido_em, motivo_recusa, created_at, link_url, anuncio_id, quantidade, pedido_externo, valor_pago, comprado_em, comprado_por_nome, compra_detalhe, pix_copia_e_cola, ja_pago, ja_pago_em, pago_forma';

interface Ctx { admin: any; tenantId: string; userId: string; email: string | null; role: string; perms: Record<string, boolean>; token?: string }

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
  const [{ data: bs }, { data: cs }, { data: ps }] = await Promise.all([
    bills.length ? ctx.admin.from('fin_accounts_payable').select('id, status, paid_date').in('id', bills) : Promise.resolve({ data: [] }),
    cats.length ? ctx.admin.from('fin_dre_categories').select('id, name').in('id', cats) : Promise.resolve({ data: [] }),
    bills.length ? ctx.admin.from('fin_inter_payments').select('bill_id, status').eq('tenant_id', ctx.tenantId).in('bill_id', bills)
      .in('status', ['sending', 'sent', 'pending_approval', 'approved', 'scheduled', 'paid', 'cancelled', 'rejected']) : Promise.resolve({ data: [] }),
  ]);
  const bm = new Map((bs ?? []).map((b: any) => [b.id, b]));
  const cm = new Map((cs ?? []).map((c: any) => [c.id, c.name]));
  // Pix já saiu pelo Inter mas a conta só vira "paga" na baixa do extrato: sem isto a tela mostrava
  // "a pagar" + "Mandar para pagar" num pedido já pago (dono, 2026-09-25).
  // Pix recusado/cancelado no app do Inter (dono, 2026-09-27): o pedido continua aprovado e a pagar, mas
  // dizia só "Aprovado · a pagar" — agora avisa que o Pix foi recusado. Vale só se não há outro em curso.
  const pix = new Map<string, 'pago' | 'aguardando' | 'recusado'>();
  for (const x of (ps ?? []) as any[]) {
    if (x.status === 'paid') pix.set(x.bill_id, 'pago');
    else if (['cancelled', 'rejected'].includes(x.status)) { if (!pix.has(x.bill_id)) pix.set(x.bill_id, 'recusado'); }
    else if (pix.get(x.bill_id) !== 'pago') pix.set(x.bill_id, 'aguardando');
  }
  // Compra online: a chave de dentro do Pix está em Fornecedores ou nos Pix permitidos? (senão o Inter recusa)
  const chaves = [...new Set(pedidos.filter((p) => p.tipo === 'compra_online' && p.pix_chave).map((p) => String(p.pix_chave)))];
  const liberadas = new Set<string>();
  if (chaves.length) {
    const [{ data: fv }, { data: sp }] = await Promise.all([
      ctx.admin.from('fin_pix_favorecidos').select('pix_key').eq('tenant_id', ctx.tenantId).eq('is_active', true).in('pix_key', chaves),
      ctx.admin.from('fin_suppliers').select('pix_key').eq('tenant_id', ctx.tenantId).in('pix_key', chaves),
    ]);
    for (const x of [...(fv ?? []), ...(sp ?? [])] as any[]) liberadas.add(String(x.pix_key));
  }
  return pedidos.map((p) => {
    const b: any = p.bill_id ? bm.get(p.bill_id) : null;
    return {
      ...p,
      categoria: p.dre_category_id ? cm.get(p.dre_category_id) ?? null : null,
      pago: b?.status === 'paid',
      pix_inter: b && b.status !== 'paid' ? pix.get(p.bill_id) ?? null : null,
      pago_em: b?.status === 'paid' ? b.paid_date : null,
      tem_comprovante: !!p.comprovante_path,
      comprovante_path: undefined,
      ...(p.tipo === 'compra_online' ? { pix_liberado: !!p.pix_chave && liberadas.has(String(p.pix_chave)) } : {}),
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
  } else if (tipo === 'compra_online') {
    // Print do checkout é o principal (2026-09-28); link é opcional (vem do "Compartilhar" do app)
    const textoLink = txt(body.link, 2000);
    const link = textoLink ? lerLinkCompra(await linkCompleto(textoLink)) : null;
    if (textoLink && !link) return erro('O link não foi reconhecido. Apague o campo do link ou cole de novo.');
    if (!link && !body.comprovante?.base64) return erro('Mande o print da compra (tela de finalizar, com o total)');
    const qtd = Math.round(Number(body.quantidade ?? 1) * 1000) / 1000;
    if (!(qtd > 0) || qtd > 10000) return erro('Informe a quantidade');
    const oque = descricao || link?.titulo || '';
    if (!oque) return erro('Diga o que é o produto');
    const det = detalheCompra(body.lido);
    const base = {
      descricao: oque, link_url: link?.url.slice(0, 1000) ?? null, anuncio_id: link?.anuncio_id ?? null, quantidade: qtd,
      compra_detalhe: det, favorecido_doc: null,
    };
    if (body.ja_pago === true) {
      // Compra que JÁ FOI PAGA (2026-09-28): sem Pix; valor = o total conferido na tela
      const pagoEm = dataOk(body.pago_em) ? String(body.pago_em) : '';
      if (!pagoEm || pagoEm > hoje || pagoEm < somaDias(hoje, -90)) return erro('Informe quando foi pago (até 90 dias atrás)');
      const forma = String(body.pago_forma ?? '');
      if (!['pix', 'cartao', 'mercado_pago'].includes(forma)) return erro('Informe como foi pago');
      Object.assign(linha, base, { favorecido_nome: link?.site ?? (txt(det?.site, 60) || 'Compra online'), ja_pago: true, ja_pago_em: pagoEm, pago_forma: forma, pix_chave: null });
    } else {
      // Pix copia e cola do checkout: o valor exato e quem recebe saem dele (não do print)
      const copia = acharCopiaECola(txt(body.pix_copia_e_cola, 1000));
      if (!copia) return erro('Cole o Pix copia e cola da tela de pagamento (o código inteiro) — ou marque que já foi pago');
      const pix = lerCopia(copia);
      if (!(Number(pix.valor) > 0)) return erro('Esse Pix não traz o valor. Gere de novo no site e cole o código.');
      if (pix.location) return erro('Esse Pix é de cobrança dinâmica (sem a chave no código) — não dá para conferir quem recebe. Escolha pagar com Pix no site e copie o código de novo.');
      linha.valor = round2(Number(pix.valor));
      Object.assign(linha, base, { favorecido_nome: link?.site ?? (txt(det?.site, 60) || txt(pix.nome, 60) || 'Compra online'), pix_copia_e_cola: copia, pix_chave: pix.chave ?? null });
    }
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
    // Valor de cada dia (dono, 2026-09-27): o total é a soma, calculada aqui — não o que veio digitado.
    // App antigo (sem valores_dia) manda só o total, que a aprovação divide pelos dias.
    if (body.valores_dia && typeof body.valores_dia === 'object') {
      const vd = body.valores_dia as Record<string, unknown>;
      const valores = dias.map((d) => round2(Number(vd[d])));
      const semValor = dias.filter((_, i) => !(valores[i] > 0) || valores[i] > 50000);
      if (semValor.length) return erro(`Informe o valor do dia ${semValor.map(diaBR).join(', ')}`);
      linha.valores_dia = valores;
      linha.valor = round2(valores.reduce((a, b) => a + b, 0));
      if (linha.valor > 50000) return erro('Total acima de R$ 50.000');
    }
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

  const dup = await duplicado(ctx, tipo, linha);
  if (dup) return erro(dup, 409);

  linha.comprovante_path = await salvarComprovante(ctx.admin, ctx.tenantId, ref, body.comprovante);
  const { data: novo, error } = await ctx.admin.from('fin_payment_requests').insert(linha).select('id').single();
  if (error) {
    if (error.code === '23505') {
      const { data: r } = await ctx.admin.from('fin_payment_requests').select('id').eq('tenant_id', ctx.tenantId).eq('ref', ref).maybeSingle();
      return json({ ok: true, id: r?.id ?? null, repetido: true });
    }
    return erro(`Não consegui gravar o pedido: ${error.message}`, 500);
  }
  await pendenciaDoPedido(ctx.admin, { id: novo.id, tenant_id: ctx.tenantId, tipo, valor: linha.valor, favorecido_nome: linha.favorecido_nome, descricao: linha.descricao, solicitado_por_nome: linha.solicitado_por_nome, dias: linha.dias ?? null, valores_dia: linha.valores_dia ?? null });
  return json({ ok: true, id: novo.id });
}

const normNome = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const normPix = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '').trim();
const diaBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Pedido em dobro (dono, 2026-09-25): mesma pessoa + mesmo valor + mesma data já pedido (pendente ou
 * aprovado) → recusa e diz quem pediu. "Mesma pessoa" = mesmo cadastro, mesma chave Pix ou mesmo nome.
 * Data: reembolso = dia do gasto; fornecedor = vencimento. Freelancer: qualquer dia já pedido para a
 * mesma pessoa, ou diária já registrada (paga por outro caminho), bloqueia — não se paga o mesmo dia 2x.
 */
async function duplicado(ctx: Ctx, tipo: TipoPedido, l: Record<string, any>): Promise<string | null> {
  const nome = normNome(l.favorecido_nome);
  const pix = normPix(l.pix_chave);
  const mesmaPessoa = (r: any) =>
    (tipo === 'freelancer' && l.freelancer_id && r.freelancer_id === l.freelancer_id) ||
    (tipo === 'fornecedor' && l.supplier_id && r.supplier_id === l.supplier_id) ||
    (!!pix && normPix(r.pix_chave) === pix) ||
    (!!nome && normNome(r.favorecido_nome) === nome);

  let q = ctx.admin.from('fin_payment_requests')
    .select('id, status, valor, descricao, favorecido_nome, pix_chave, freelancer_id, supplier_id, data_gasto, vencimento, dias, solicitado_por_nome, created_at, link_url, anuncio_id, pix_copia_e_cola')
    .eq('tenant_id', ctx.tenantId).eq('tipo', tipo).in('status', ['pendente', 'aprovada']);
  if (tipo === 'compra_online') {
    // Mesmo produto já pedido (esperando ou autorizado, ainda não comprado)
    const { data: cs, error: ec } = await q.limit(100);
    if (ec) throw new Error(`Falha ao conferir pedido repetido: ${ec.message}`);
    // Mesmo Pix copia e cola; com link: mesmo anúncio. Só print: mesmo produto e mesmo valor.
    const igual: any = (cs ?? []).find((r: any) => (l.pix_copia_e_cola && r.pix_copia_e_cola === l.pix_copia_e_cola) || (l.anuncio_id && r.anuncio_id ? r.anuncio_id === l.anuncio_id
      : l.link_url && r.link_url ? r.link_url === l.link_url
      : Number(r.valor) === Number(l.valor) && normNome(r.descricao) === normNome(l.descricao)));
    if (!igual) return null;
    const quem = igual.solicitado_por_nome ? ` por ${igual.solicitado_por_nome}` : '';
    return `Esse produto já foi pedido${quem} e ${igual.status === 'aprovada' ? 'já está autorizado (falta comprar)' : 'está esperando aprovação'}. Veja em "Meus pedidos" ou fale com o financeiro.`;
  }
  if (tipo === 'reembolso') q = q.eq('data_gasto', l.data_gasto).eq('valor', l.valor);
  else if (tipo === 'fornecedor') q = q.eq('vencimento', l.vencimento).eq('valor', l.valor);
  else q = q.overlaps('dias', l.dias);
  const { data, error } = await q.limit(50);
  if (error) throw new Error(`Falha ao conferir pedido repetido: ${error.message}`);

  const r: any = (data ?? []).find(mesmaPessoa);
  if (r) {
    const situacao = r.status === 'aprovada' ? 'já foi aprovado' : 'está esperando aprovação';
    const quem = r.solicitado_por_nome ? ` por ${r.solicitado_por_nome}` : '';
    const quando = diaBR(new Date(Date.parse(r.created_at) - 3 * 3600_000).toISOString().slice(0, 10));
    if (tipo === 'freelancer') {
      const repetidos = (l.dias as string[]).filter((d) => (r.dias ?? []).includes(d)).map(diaBR).join(', ');
      return `Já existe pedido de diária para ${r.favorecido_nome} no(s) dia(s) ${repetidos} — pedido${quem} em ${quando}, que ${situacao}. Não dá para pedir de novo.`;
    }
    const qual = tipo === 'reembolso' ? `gasto de ${diaBR(l.data_gasto)}` : `vencimento ${diaBR(l.vencimento)}`;
    return `Esse pedido já foi lançado: ${ROTULO[tipo].toLowerCase()} de ${brl(r.valor)} para ${r.favorecido_nome} (${qual}), pedido${quem} em ${quando}, que ${situacao}. Não dá para pedir de novo.`;
  }

  // Freelancer: diária já registrada por outro caminho (Pix pelo grupo, extrato, dinheiro)
  if (tipo === 'freelancer' && l.freelancer_id) {
    const { data: sh, error: e2 } = await ctx.admin.from('hr_freelancer_shifts').select('work_date')
      .eq('tenant_id', ctx.tenantId).eq('freelancer_id', l.freelancer_id).in('work_date', l.dias);
    if (e2) throw new Error(`Falha ao conferir diárias: ${e2.message}`);
    if (sh?.length) {
      const dias = [...new Set<string>(sh.map((s: any) => s.work_date as string))].sort().map(diaBR).join(', ');
      return `A diária de ${l.favorecido_nome} no(s) dia(s) ${dias} já foi lançada no sistema. Não dá para pedir de novo.`;
    }
  }
  return null;
}

const brl = (n: number) => `R$ ${Number(n).toFixed(2).replace('.', ',')}`;

/** O que a IA leu do print (vem da tela, depois de conferido): só guarda o formato esperado. */
function detalheCompra(x: any) {
  if (!x || typeof x !== 'object') return null;
  const n = (v: any) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6 ? round2(v) : null);
  const itens = (Array.isArray(x.itens) ? x.itens : []).slice(0, 30)
    .map((i: any) => ({ descricao: txt(i?.descricao, 200), quantidade: Number(i?.quantidade) > 0 ? Number(i.quantidade) : 1, valor: n(i?.valor) }))
    .filter((i: any) => i.descricao);
  return { site: txt(x.site, 60) || null, itens, subtotal: n(x.subtotal), desconto: n(x.desconto), frete: n(x.frete), total: n(x.total), entrega: txt(x.entrega, 200) || null, numero_pedido: txt(x.numero_pedido, 60) || null };
}
const ROTULO: Record<string, string> = { reembolso: 'Reembolso', freelancer: 'Freelancer', fornecedor: 'Fornecedor sem nota', compra_online: 'Compra online' };

/** Link curto do app do Mercado Livre (mercadolivre.com/sec/…) não tem o nº nem o nome: segue o
 *  redirecionamento (só desses hosts, 4 s) para guardar o endereço do anúncio. Falhou → fica o curto. */
async function linkCompleto(texto: string): Promise<string> {
  const m = texto.match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return texto;
  let u: URL;
  try { u = new URL(m[0]); } catch { return texto; }
  const doML = (h: string) => /(^|\.)mercadoli(vre|bre)\.com(\.br)?$/i.test(h);
  if (!doML(u.hostname) || !/^\/sec\//i.test(u.pathname)) return texto;
  let atual = u.toString();
  for (let i = 0; i < 4; i++) {
    const r = await fetch(atual, { redirect: 'manual', signal: AbortSignal.timeout(4000) }).catch(() => null);
    const loc = r?.headers.get('location');
    if (!r || r.status < 300 || r.status >= 400 || !loc) break;
    const prox = new URL(loc, atual);
    if (!doML(prox.hostname)) break;
    atual = prox.toString();
    if (/MLB-?\d{6,}/i.test(prox.pathname)) break;
  }
  return atual === u.toString() ? texto : texto.replace(m[0], atual);
}

/**
 * Depois de aprovado: prepara o Pix no Inter (inter-bank prepare_payment, ligado à conta) e põe no 📥
 * do chat como "pagamento_pendente" — o botão Pagar pede o PIN, igual aos pagamentos do grupo.
 * A trava continua valendo: chave fora de Fornecedores / Pix permitidos não é preparada; aí a
 * pendência avisa para pagar pelo app do banco (a conciliação dá baixa).
 */
async function prepararPagamento(ctx: Ctx, pedidoId: string): Promise<{ preparado: boolean; motivo?: string; aviso?: string; pendencia_id?: string | null }> {
  const { data: p } = await ctx.admin.from('fin_payment_requests')
    .select('id, tipo, status, valor, favorecido_nome, pix_chave, pix_copia_e_cola, freelancer_id, bill_id, descricao')
    .eq('id', pedidoId).eq('tenant_id', ctx.tenantId).maybeSingle();
  if (!p || p.status !== 'aprovada' || !p.bill_id) return { preparado: false, motivo: 'pedido sem conta a pagar', aviso: 'Esse pedido não tem conta a pagar.' };
  // O aviso "pague pelo app do banco" (pedido_pagamento_pagar) sai quando o pagamento se resolve
  // por aqui — antes ficava aberto para sempre ao lado do cartão do Pix (auditoria 2026-09-24).
  const fecharAvisoPagar = (motivo: string) => ctx.admin.from('pendencias')
    .update({ status: 'resolvida', resolvida_em: new Date().toISOString(), resolvida_por: ctx.userId, motivo })
    .eq('tenant_id', ctx.tenantId).eq('kind', 'pedido_pagamento_pagar').eq('ref', p.id).in('status', ['aberta', 'vista']);
  const { data: bill } = await ctx.admin.from('fin_accounts_payable').select('id, amount, paid_amount, status').eq('id', p.bill_id).maybeSingle();
  if (!bill || bill.status === 'paid') { await fecharAvisoPagar('conta já paga'); return { preparado: false, motivo: 'conta já paga', aviso: 'Essa conta já está paga.' }; }
  if (bill.status === 'cancelled') { await fecharAvisoPagar('conta cancelada'); return { preparado: false, motivo: 'conta cancelada', aviso: 'A conta desse pedido foi cancelada — não há o que pagar.' }; }
  let chave: string | null = p.pix_chave;
  if (!chave && p.freelancer_id) {
    const { data: f } = await ctx.admin.from('hr_freelancers').select('pix_favorecido_id').eq('id', p.freelancer_id).maybeSingle();
    if (f?.pix_favorecido_id) {
      const { data: fav } = await ctx.admin.from('fin_pix_favorecidos').select('pix_key').eq('id', f.pix_favorecido_id).maybeSingle();
      chave = fav?.pix_key ?? null;
    }
  }
  // O que falta: desconta também Pix já pago pelo Inter e ainda não baixado (a baixa espera o extrato).
  const { data: pagos } = await ctx.admin.from('fin_inter_payments').select('amount').eq('tenant_id', ctx.tenantId).eq('bill_id', bill.id).eq('status', 'paid');
  const pagoInter = (pagos ?? []).reduce((t: number, x: { amount: number }) => t + Number(x.amount ?? 0), 0);
  const valor = round2(Number(bill.amount) - Math.max(Number(bill.paid_amount ?? 0), pagoInter));
  if (valor <= 0.009) {
    await fecharAvisoPagar('já pago pelo Inter');
    return { preparado: false, motivo: 'já pago pelo Inter', aviso: 'Essa conta já foi paga pelo Inter — falta só a baixa, que sai sozinha pelo extrato.' };
  }
  const titulo = `${ROTULO[p.tipo] ?? 'Pagamento'} aprovado: Pix de ${brl(valor)} para ${p.favorecido_nome}`;
  // Devolve o id da pendência: a tela de aprovar paga ali mesmo (PIN) pelo assistente-app › pendencia_pagar.
  const pendenciaPix = async (payId: string): Promise<string | null> => {
    // Pix recusado no Inter deixa a pendência dele aberta até pagar (20260928130000); o Pix novo ganha a
    // sua — a antiga sai para não aparecer duas vezes no 📥. Só se o Pix dela já não está vivo no Inter
    // (aguardando aprovação…): essa pendência é o que lembra de recusá-lo.
    const { data: velhas } = await ctx.admin.from('pendencias').select('id, ref')
      .eq('tenant_id', ctx.tenantId).eq('kind', 'pagamento_pendente').eq('payload->>bill_id', bill.id).neq('ref', payId).in('status', ['aberta', 'vista']);
    if (velhas?.length) {
      const { data: vivos } = await ctx.admin.from('fin_inter_payments').select('id').in('id', velhas.map((v) => v.ref))
        .in('status', ['sending', 'sent', 'pending_approval', 'approved', 'scheduled']);
      const fechar = velhas.filter((v) => !(vivos ?? []).some((x) => String(x.id) === String(v.ref))).map((v) => v.id);
      if (fechar.length) {
        await ctx.admin.from('pendencias').update({ status: 'resolvida', resolvida_em: new Date().toISOString(), resolvida_por: ctx.userId, motivo: 'Pix novo preparado' })
          .in('id', fechar).in('status', ['aberta', 'vista']);
      }
    }
    return (await ctx.admin.rpc('fn_pendencia_upsert', {
      p_tenant: ctx.tenantId, p_kind: 'pagamento_pendente', p_ref: payId,
      p_titulo: titulo, p_detalhe: `${chave ? `Chave ${chave}. ` : ''}Toque em Pagar e confirme com o PIN.`,
      p_payload: { payment_id: payId, bill_id: bill.id, pedido_id: p.id }, p_rota: null,
      p_urgencia: 'alta', p_acao_requerida: true, p_origem: 'app', p_reabrir: true,
    }))?.data?.id ?? null;
  };
  let motivo = '';
  const copia: string | null = p.tipo === 'compra_online' ? p.pix_copia_e_cola : null;
  if (chave || copia) {
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/inter-bank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': Deno.env.get('FISCAL_INTERNAL_KEY') ?? '' },
      body: JSON.stringify({
        action: 'prepare_payment', tenant_id: ctx.tenantId, tipo: 'pix', ...(copia ? { copia_e_cola: copia } : { chave }), valor, bill_id: bill.id,
        descricao: `${ROTULO[p.tipo] ?? 'Pedido'} — ${p.descricao}`.slice(0, 140), requested_by: ctx.userId, channel: 'app',
      }),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }) as unknown as Response);
    const out: any = await r.json().catch(() => ({}));
    const pay = out?.payment;
    if (r.ok && out?.success !== false && pay?.id) {
      const pendencia_id = await pendenciaPix(String(pay.id));
      await fecharAvisoPagar('Pix preparado');
      return { preparado: true, pendencia_id };
    }
    motivo = String(out?.error ?? `Inter respondeu ${r.status}`);
    // Já existe Pix em andamento para essa conta (rascunho recente ou aguardando aprovação no Inter):
    // NÃO é para pagar pelo banco — é o mesmo pagamento. Garante o cartão dele no 📥 e para aqui.
    // Antes isto virava "pague pelo app do banco" e o dono pagava duas vezes (auditoria 2026-09-24).
    if (/^Já existe um pagamento em andamento/i.test(motivo)) {
      // Mesmo critério do inter-bank: vale o que já está no Inter; rascunho só se tiver menos de 30 min.
      const { data: vivos } = await ctx.admin.from('fin_inter_payments').select('id, status, created_at').eq('tenant_id', ctx.tenantId).eq('bill_id', bill.id)
        .in('status', ['draft', 'awaiting_pin', 'sending', 'sent', 'pending_approval', 'approved', 'scheduled'])
        .order('created_at', { ascending: false });
      const noInter = (vivos ?? []).find((x: { status: string }) => !['draft', 'awaiting_pin'].includes(x.status));
      const rascunho = (vivos ?? []).find((x: { status: string; created_at: string }) => ['draft', 'awaiting_pin'].includes(x.status) && Date.now() - new Date(x.created_at).getTime() <= 30 * 60_000);
      const vivo = noInter ?? rascunho ?? null;
      const pendencia_id = vivo ? await pendenciaPix(String(vivo.id)) : null;
      await fecharAvisoPagar('Pix já em andamento');
      const rascunhoVivo = !!vivo && ['draft', 'awaiting_pin'].includes(vivo.status);
      return { preparado: rascunhoVivo, pendencia_id: rascunhoVivo ? pendencia_id : null, motivo, aviso: vivo && !['draft', 'awaiting_pin'].includes(vivo.status)
        ? 'O Pix dessa conta já foi enviado e está aguardando aprovação no app do Inter. Aprove por lá — não pague de novo.'
        : 'O Pix dessa conta já está preparado no 📥.' };
    }
    if (/^Essa conta já foi paga:/i.test(motivo)) {
      await fecharAvisoPagar('já pago pelo Inter');
      return { preparado: false, motivo, aviso: motivo };
    }
    // Envio anterior sem resposta do Inter: não mandar pagar pelo banco (pode já ter saído).
    if (/^Um envio anterior ficou sem resposta/i.test(motivo)) {
      await ctx.admin.rpc('fn_pendencia_upsert', {
        p_tenant: ctx.tenantId, p_kind: 'pedido_pagamento_pagar', p_ref: p.id, p_titulo: titulo,
        p_detalhe: 'Um Pix anterior dessa conta foi enviado e o Inter não respondeu. Confira no app do Inter se saiu ANTES de pagar de novo.',
        p_payload: { pedido_id: p.id, bill_id: bill.id, chave }, p_rota: '/receber?aprovar=1',
        p_urgencia: 'alta', p_acao_requerida: true, p_origem: 'app', p_reabrir: true,
      });
      return { preparado: false, motivo, aviso: 'Um Pix anterior dessa conta ficou sem resposta do Inter. Confira no app do Inter se saiu antes de pagar de novo.' };
    }
  } else {
    motivo = 'pedido sem chave Pix';
  }
  // Não deu para preparar (trava do Pix, Inter sem configuração…): avisa para pagar por fora
  await ctx.admin.rpc('fn_pendencia_upsert', {
    p_tenant: ctx.tenantId, p_kind: 'pedido_pagamento_pagar', p_ref: p.id,
    p_titulo: titulo,
    p_detalhe: `${chave ? `Chave ${chave}. ` : ''}O assistente não preparou o Pix: ${motivo.replace(/\.+$/, '')}. Pague pelo app do banco — a conciliação dá baixa na conta.`,
    p_payload: { pedido_id: p.id, bill_id: bill.id, chave }, p_rota: '/receber?aprovar=1',
    p_urgencia: 'alta', p_acao_requerida: true, p_origem: 'app', p_reabrir: true,
  });
  return { preparado: false, motivo, aviso: `O Pix não foi preparado: ${motivo.replace(/\.+$/, '')}. Pague pelo app do banco — a conciliação dá baixa.` };
}

/**
 * Compra online com Pix (2026-09-28): o dono classifica e a compra nasce (purchase-write, chave interna)
 * com os itens lidos do print, somando exatamente o valor do Pix; a conta a pagar da compra é a que o
 * Pix quita. Despesa → itens com a categoria do DRE (a DRE tira do CMV); CMV → categoria de mercadoria.
 * O pedido é travado em 'aprovada' ANTES de criar a compra (dois toques não criam duas compras).
 */
async function aprovarCompraOnline(ctx: Ctx, p: any, body: Record<string, any>): Promise<{ purchase_id: string; bill_id: string; aviso?: string } | { erro: string; status?: number }> {
  // Itens do print (a mesma lista que a tela mostra para classificar)
  const total = round2(Number(p.valor));
  const lidos = ((p.compra_detalhe?.itens ?? []) as any[]).filter((i) => i?.descricao && Number(i.valor) > 0);
  const base = lidos.length ? lidos : [{ descricao: p.descricao, quantidade: Number(p.quantidade) > 0 ? Number(p.quantidade) : 1, valor: total }];
  // Classificação: uma para tudo (classe/categoria_id) ou uma por item (itens_classe, na ordem da lista)
  const porItem: { classe: string; cat: string | null }[] = Array.isArray(body.itens_classe) && body.itens_classe.length === base.length
    ? body.itens_classe.map((x: any) => ({ classe: String(x?.classe ?? ''), cat: txt(x?.categoria_id, 40) || null }))
    : base.map(() => ({ classe: String(body.classe ?? ''), cat: txt(body.categoria_id, 40) || null }));
  const catsDespesa = new Set((await categorias(ctx)).map((c: any) => c.id));
  const { data: mcs } = await ctx.admin.from('fin_merchandise_categories').select('id').eq('tenant_id', ctx.tenantId).limit(1000);
  const catsMerc = new Set((mcs ?? []).map((c: any) => c.id));
  for (const [k, c] of porItem.entries()) {
    const qual = base.length > 1 ? ` (${String(base[k].descricao).slice(0, 40)})` : '';
    if (!['despesa', 'cmv'].includes(c.classe)) return { erro: `Escolha se é Despesa ou CMV${qual}` };
    if (c.classe === 'despesa' && (!c.cat || !catsDespesa.has(c.cat))) return { erro: `Escolha a categoria da despesa${qual}` };
    if (c.classe === 'cmv' && (!c.cat || !catsMerc.has(c.cat))) return { erro: `Escolha a categoria da mercadoria${qual}` };
  }
  const classe = porItem.every((c) => c.classe === 'cmv') ? 'cmv' : porItem.every((c) => c.classe === 'despesa') ? 'despesa' : 'misto';
  const cat = porItem.find((c) => c.classe === 'despesa')?.cat ?? null;
  if (p.status !== 'pendente') return { erro: `Esse pedido já foi ${p.status}` };
  const nome = await nomeDoUsuario(ctx.admin, ctx.userId, ctx.email);
  const agora = new Date().toISOString();
  const { data: trava } = await ctx.admin.from('fin_payment_requests').update({
    status: 'aprovada', decidido_por: ctx.userId, decidido_por_nome: nome, decidido_em: agora, updated_at: agora,
    ...(cat ? { dre_category_id: cat } : {}),
  }).eq('id', p.id).eq('status', 'pendente').select('id');
  if (!trava?.length) return { erro: 'O pedido mudou enquanto você aprovava. Atualize a tela.' };
  const desfazer = async (msg: string) => {
    await ctx.admin.from('fin_payment_requests').update({ status: 'pendente', decidido_por: null, decidido_por_nome: null, decidido_em: null, updated_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'aprovada').is('purchase_id', null);
    return { erro: msg, status: 500 };
  };

  // Itens ajustados para somar o valor do pedido (desconto/frete rateados na proporção)
  const soma = base.reduce((t, i) => t + Number(i.valor), 0);
  let resto = total;
  const items = base.map((i, k) => {
    const classeItem = porItem[k].classe === 'despesa' ? { dre_category_id: porItem[k].cat } : { merchandise_category_id: porItem[k].cat };
    const q = Number(i.quantidade) > 0 ? Number(i.quantidade) : 1;
    const linhaTotal = k === base.length - 1 ? round2(resto) : round2(total * Number(i.valor) / soma);
    resto = round2(resto - linhaTotal);
    return { description: String(i.descricao).slice(0, 200), quantity: q, unit_price: Math.round((linhaTotal / q) * 10000) / 10000, ...classeItem };
  });
  // Arredondamento do preço unitário não pode mudar o total: sobra vai no último item como 1 unidade
  const somaItens = round2(items.reduce((t, i) => t + round2(i.quantity * i.unit_price), 0));
  if (Math.abs(somaItens - total) > 0.009) {
    const ult = items[items.length - 1];
    const antes = round2(somaItens - round2(ult.quantity * ult.unit_price));
    items[items.length - 1] = { ...ult, description: ult.quantity !== 1 ? `${ult.quantity}× ${ult.description}` : ult.description, quantity: 1, unit_price: round2(total - antes) };
  }

  const hoje = hojeBR();
  const dia = p.ja_pago && p.ja_pago_em ? String(p.ja_pago_em) : hoje;
  const FORMA: Record<string, string> = { pix: 'PIX', cartao: 'Cartão de crédito', mercado_pago: 'Mercado Pago' };
  const forma = p.ja_pago ? FORMA[String(p.pago_forma)] ?? 'PIX' : 'PIX';
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/purchase-write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}`, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', 'x-internal-key': Deno.env.get('FISCAL_INTERNAL_KEY') ?? '' },
    body: JSON.stringify({
      action: 'create_purchase', tenant_id: ctx.tenantId,
      payload: {
        supplier: p.favorecido_nome || 'Compra online', purchase_date: dia, payment_method: forma, payment_status: 'pending', due_date: dia,
        notes: [`Compra online pedida por ${p.solicitado_por_nome ?? 'alguém da loja'} e aprovada por ${nome} — ${p.ja_pago ? `já paga em ${diaBR(dia)} (${forma}); a conciliação dá a baixa` : 'Pix copia e cola pelo Inter'}`,
          p.anuncio_id ? `anúncio ${p.anuncio_id}` : null, p.compra_detalhe?.entrega ? `entrega: ${p.compra_detalhe.entrega}` : null].filter(Boolean).join(' · '),
        items,
      },
    }),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as unknown as Response);
  const txtR = await r.text();
  let out: any = null;
  try { out = JSON.parse(txtR); } catch { /* texto */ }
  const compra = out?.data ?? out?.result?.data ?? null;
  if (!r.ok || !compra?.id) return await desfazer(`Não consegui lançar a compra: ${out?.error ?? txtR.slice(0, 200)}`);
  const { data: conta } = await ctx.admin.from('fin_accounts_payable').select('id, amount')
    .eq('tenant_id', ctx.tenantId).eq('reference_type', 'purchase').eq('reference_id', compra.id).order('due_date').limit(1).maybeSingle();
  if (!conta) return await desfazer('A compra foi lançada sem conta a pagar. Avise o suporte.');
  await ctx.admin.from('fin_payment_requests').update({ purchase_id: compra.id, bill_id: conta.id, updated_at: new Date().toISOString() }).eq('id', p.id);
  await fecharPendencia(ctx.admin, ctx.tenantId, p.id, ctx.userId, 'resolvida', `Aprovado como ${classe === 'cmv' ? 'CMV' : classe === 'despesa' ? 'despesa' : 'CMV + despesa'}`);
  const aviso = p.ja_pago ? await conciliarJaPaga(ctx, p, conta.id, dia, total) : undefined;
  return { purchase_id: compra.id, bill_id: conta.id, aviso };
}

/**
 * Compra online já paga por Pix do banco da loja: procura a saída no extrato (mesmo valor, até 3 dias
 * da data informada, ainda sem vínculo) e liga à conta pela Conciliação (link_manual, com o usuário
 * logado — é ela que dá a baixa). Só liga quando há UMA saída candidata; senão fica para a Conciliação.
 */
async function conciliarJaPaga(ctx: Ctx, p: any, billId: string, dia: string, total: number): Promise<string> {
  const pendente = 'Compra lançada. O pagamento fica em aberto até a Conciliação ligar a saída do extrato.';
  if (p.pago_forma !== 'pix') return `Compra lançada. Pagamento por ${p.pago_forma === 'cartao' ? 'cartão' : 'Mercado Pago'}: a baixa sai pela conciliação dessa conta.`;
  const { data: rows } = await ctx.admin.from('fin_bank_statement_imports').select('id, transaction_date, counterpart_name, match_kind')
    .eq('tenant_id', ctx.tenantId).eq('transaction_type', 'debit').eq('status', 'pending').eq('reconciled', false)
    .gte('amount', round2(total - 0.01)).lte('amount', round2(total + 0.01))
    .gte('transaction_date', somaDias(dia, -3)).lte('transaction_date', somaDias(dia, 3)).limit(5);
  const cand = (rows ?? []).filter((r: any) => !['payable', 'inbound_doc'].includes(String(r.match_kind ?? '')));
  if (cand.length !== 1 || !ctx.token) {
    return cand.length > 1 ? `${pendente} Há ${cand.length} saídas de ${brl(total)} perto de ${diaBR(dia)} — escolha na Conciliação qual é.` : `${pendente} Ainda não achei a saída de ${brl(total)} no extrato perto de ${diaBR(dia)}.`;
  }
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/conciliacao-pagamentos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}`, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' },
    body: JSON.stringify({ action: 'link_manual', tenant_id: ctx.tenantId, id: cand[0].id, alvo: { kind: 'payable', ref_id: billId } }),
  }).catch(() => null);
  const out: any = r ? await r.json().catch(() => null) : null;
  if (!r?.ok || out?.error || out?.success === false) {
    console.error('[pedidos-pagamento] conciliar já paga', p.id, out?.error ?? r?.status);
    return `${pendente} (não consegui ligar a saída de ${diaBR(cand[0].transaction_date)} sozinho: ${out?.error ?? 'erro'}).`;
  }
  return `Compra lançada e já ligada ao pagamento de ${diaBR(cand[0].transaction_date)} no extrato${cand[0].counterpart_name ? ` (${cand[0].counterpart_name})` : ''} — baixa feita.`;
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
    const ctx: Ctx = { admin, tenantId, userId: caller.userId, email: caller.email, role, perms, token: (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '') };
    const podePedir = perms.pag_reembolso || perms.pag_freelancer || perms.pag_fornecedor || perms.pag_compra_online;
    const aprovador = perms.pag_aprovar;

    switch (action) {
      case 'contexto': {
        let aprovar = 0;
        let aprovadosNaoPagos = 0;
        if (aprovador) {
          const [{ count }, { data: aprov }] = await Promise.all([
            admin.from('fin_payment_requests').select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId).eq('status', 'pendente'),
            admin.from('fin_payment_requests').select('id, bill_id, dre_category_id, comprovante_path')
              .eq('tenant_id', tenantId).eq('status', 'aprovada').order('created_at', { ascending: false }).limit(300),
          ]);
          aprovar = count ?? 0;
          // Número no botão Aprovar (dono, 2026-09-27): aprovados que ainda não foram pagos. Pix que já
          // saiu pelo Inter (só falta a baixa do extrato) não conta — o dinheiro já foi.
          const lista = aprov ?? [];
          for (let i = 0; i < lista.length; i += 100) {
            const com = await comPagamento(ctx, lista.slice(i, i + 100));
            aprovadosNaoPagos += com.filter((p: any) => !p.pago && p.pix_inter !== 'pago').length;
          }
        }
        // Última chave Pix usada pela pessoa num reembolso (evita digitar toda vez)
        const { data: ult } = await admin.from('fin_payment_requests').select('pix_chave, favorecido_nome')
          .eq('tenant_id', tenantId).eq('solicitado_por', caller.userId).eq('tipo', 'reembolso')
          .not('pix_chave', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
        return json({
          perms, para_aprovar: aprovar, aprovados_nao_pagos: aprovadosNaoPagos,
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
      case 'categorias_mercadoria': {
        if (!aprovador) return erro('Sem permissão', 403);
        const { data, error } = await admin.from('fin_merchandise_categories').select('id, name')
          .eq('tenant_id', tenantId).eq('is_active', true).order('sort_order').order('name').limit(500);
        if (error) throw new Error(error.message);
        return json({ categorias: (data ?? []).map((c: any) => ({ id: c.id, nome: c.name })) });
      }
      case 'ler_print': {
        if (!perms.pag_compra_online && !aprovador) return erro('Seu perfil não pode pedir compra online.', 403);
        const r = await lerPrintCompra(admin, tenantId, caller.userId, body.imagem ?? {});
        if (r.erro) return erro(r.erro, r.status ?? 400);
        return json({ lido: r.lido });
      }
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
        if (p.tipo === 'compra_online' && (p.pix_copia_e_cola || p.ja_pago)) {
          const r = await aprovarCompraOnline(ctx, p, body);
          if ('erro' in r) return erro(r.erro, r.status ?? 400);
          if (p.ja_pago) return json({ ok: true, compra_online: true, ja_pago: true, purchase_id: r.purchase_id, bill_id: r.bill_id, aviso: r.aviso });
          const pagamento = await prepararPagamento(ctx, p.id).catch((e) => ({ preparado: false, motivo: String((e as Error)?.message ?? e) }));
          return json({ ok: true, compra_online: true, purchase_id: r.purchase_id, bill_id: r.bill_id, pagamento });
        }
        if (p.tipo === 'compra_online') {
          // Pedido antigo (sem Pix): só autoriza; o dono compra no site e registra "Já comprei"
          if (p.status !== 'pendente') return erro(`Esse pedido já foi ${p.status}`);
          const { data: upd } = await admin.from('fin_payment_requests').update({
            status: 'aprovada', decidido_por: caller.userId, decidido_por_nome: await nomeDoUsuario(admin, caller.userId, caller.email),
            decidido_em: new Date().toISOString(), updated_at: new Date().toISOString(),
          }).eq('id', p.id).eq('status', 'pendente').select('id');
          if (!upd?.length) return erro('O pedido mudou enquanto você aprovava. Atualize a tela.');
          await fecharPendencia(admin, tenantId, p.id, caller.userId, 'resolvida', 'Compra autorizada');
          return json({ ok: true, compra_online: true, pagamento: { preparado: false, aviso: 'Compra autorizada. Abra o link, compre na conta da loja e toque em "Já comprei" no pedido.' } });
        }
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
        if (p.tipo === 'compra_online' && p.ja_pago) return erro('Essa compra já foi paga — não há Pix a preparar.');
        if (p.tipo === 'compra_online' && !p.pix_copia_e_cola) return erro('Esse pedido não tem Pix: a compra é paga no site, na conta da loja.');
        return json({ ok: true, pagamento: await prepararPagamento(ctx, p.id) });
      }
      case 'comprado': {
        // Dono comprou na conta da loja: guarda nº do pedido no site e quanto saiu (com frete)
        if (!aprovador) return erro('Só o financeiro registra a compra.', 403);
        const p = await carregarPedido(ctx, String(body.id ?? ''));
        if (!p || p.tipo !== 'compra_online') return erro('Pedido não encontrado', 404);
        if (!['pendente', 'aprovada'].includes(p.status)) return erro(`Esse pedido já foi ${p.status}`);
        const valorPago = round2(Number(body.valor_pago));
        if (!(valorPago > 0) || valorPago > 50000) return erro('Informe quanto saiu a compra (com frete)');
        const pedidoExterno = txt(body.pedido_externo, 60) || null;
        const nome = await nomeDoUsuario(admin, caller.userId, caller.email);
        const agora = new Date().toISOString();
        const { data: upd } = await admin.from('fin_payment_requests').update({
          status: 'comprada', valor_pago: valorPago, pedido_externo: pedidoExterno,
          comprado_em: agora, comprado_por: caller.userId, comprado_por_nome: nome,
          // Comprou direto sem passar por "Autorizar": a decisão fica registrada também
          ...(p.status === 'pendente' ? { decidido_por: caller.userId, decidido_por_nome: nome, decidido_em: agora } : {}),
          updated_at: agora,
        }).eq('id', p.id).in('status', ['pendente', 'aprovada']).select('id');
        if (!upd?.length) return erro('O pedido mudou enquanto você gravava. Atualize a tela.');
        await fecharPendencia(admin, tenantId, p.id, caller.userId, 'resolvida', 'Comprado');
        return json({ ok: true });
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
