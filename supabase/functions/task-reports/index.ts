// task-reports — relatório compartilhável por link, do módulo Tarefas (2026-09-25).
//
// Equipe (JWT, módulo Tarefas): quem criou monta o relatório (itens com texto e
// imagens), liga/desliga o link, responde e muda status dos itens. Relatório
// dentro de uma pasta vale também para quem divide a pasta (fn_task_report_access:
// creator > owner da pasta > edit > view; view só lê e responde).
// Público (sem login, pelo share_token): quem abre o link se identifica com
// nome (+ contato opcional) e recebe um guest_token que fica no aparelho; com
// ele responde os itens. Toda resposta, mudança de status e edição de item vira
// uma linha em task_report_responses com autor e hora — nada é apagado.
//
// verify_jwt = false: as ações públicas não têm JWT; as do dono validam aqui.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function errMsg(err: unknown): string {
  if (err == null) return 'Erro desconhecido';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const o = err as Record<string, unknown>;
  return o.message ? String(o.message) : JSON.stringify(err);
}

class Recusa extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

const BUCKET = 'task-reports';
const STATUS_ITEM = ['open', 'answered', 'resolved'];
const MAX_TEXTO = 5000;
const MAX_IMAGENS = 8;
const MAX_BYTES = 10 * 1024 * 1024;
const TIPOS_IMAGEM: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
};

function texto(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s.length > max) throw new Recusa(`Texto maior que ${max} caracteres`);
  return s || null;
}

function tokenAleatorio(bytes = 24): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Imagem = { path: string; name: string };

/** Imagens vindas do cliente: só caminhos já enviados para ESTE relatório. */
function validarImagens(v: unknown, reportId: string): Imagem[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Recusa('images deve ser uma lista');
  if (v.length > MAX_IMAGENS) throw new Recusa(`No máximo ${MAX_IMAGENS} imagens`);
  return v.map((i) => {
    const path = String((i as Imagem)?.path ?? '');
    if (!path.startsWith(`${reportId}/`) || path.includes('..')) throw new Recusa('Imagem inválida');
    return { path, name: String((i as Imagem)?.name ?? 'imagem').slice(0, 120) };
  });
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Relatório completo, com URLs assinadas das imagens. `publico` esconde contato e dados internos. */
async function montarRelatorio(admin: SupabaseClient, report: Row, publico: boolean) {
  const [itensR, respR, convR, donoR] = await Promise.all([
    admin.from('task_report_items').select('*').eq('report_id', report.id).is('archived_at', null).order('position').order('created_at'),
    admin.from('task_report_responses').select('*').eq('report_id', report.id).order('created_at'),
    admin.from('task_report_guests').select('id, name, contact, created_at, last_seen_at').eq('report_id', report.id).order('created_at'),
    admin.from('users').select('name').eq('id', report.created_by).maybeSingle(),
  ]);
  if (itensR.error) throw itensR.error;
  if (respR.error) throw respR.error;
  if (convR.error) throw convR.error;
  const itens = (itensR.data ?? []) as Row[];
  const respostas = (respR.data ?? []) as Row[];
  const convidados = (convR.data ?? []) as Row[];
  const nomeConvidado = new Map(convidados.map((c) => [c.id, c.name]));

  const caminhos = new Set<string>();
  for (const x of [...itens, ...respostas]) for (const i of (x.images ?? []) as Imagem[]) caminhos.add(i.path);
  const urls = new Map<string, string>();
  if (caminhos.size) {
    const { data } = await admin.storage.from(BUCKET).createSignedUrls([...caminhos], 60 * 60 * 6);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  const comUrl = (imgs: Imagem[]) => (imgs ?? []).map((i) => ({ ...i, url: urls.get(i.path) ?? null }));

  const porItem = new Map<string, Row[]>();
  for (const r of respostas) {
    const lista = porItem.get(r.item_id) ?? [];
    lista.push({
      id: r.id, kind: r.kind, body: r.body, images: comUrl(r.images), new_status: r.new_status,
      author_name: r.author_name, author_type: r.author_user_id ? 'owner' : 'guest',
      author_guest_id: r.author_guest_id, created_at: r.created_at,
      author_is_creator: !!r.author_user_id && r.author_user_id === report.created_by,
      ...(publico ? {} : { author_user_id: r.author_user_id }),
    });
    porItem.set(r.item_id, lista);
  }

  return {
    report: {
      id: report.id, title: report.title, description: report.description, status: report.status,
      guests_can_add_items: report.guests_can_add_items, owner_name: donoR.data?.name ?? null,
      created_at: report.created_at, updated_at: report.updated_at,
      ...(publico ? {} : {
        share_token: report.share_token, link_enabled: report.link_enabled, created_by: report.created_by,
        list_id: report.list_id ?? null, access: report.access ?? null,
      }),
    },
    items: itens.map((i) => ({
      id: i.id, position: i.position, title: i.title, body: i.body, images: comUrl(i.images), status: i.status,
      created_by_guest_name: i.created_by_guest ? nomeConvidado.get(i.created_by_guest) ?? null : null,
      created_at: i.created_at, updated_at: i.updated_at, responses: porItem.get(i.id) ?? [],
    })),
    guests: convidados.map((c) => publico
      ? { id: c.id, name: c.name }
      : { id: c.id, name: c.name, contact: c.contact, created_at: c.created_at, last_seen_at: c.last_seen_at }),
  };
}

async function gravarImagem(admin: SupabaseClient, reportId: string, file: File): Promise<Imagem> {
  const ext = TIPOS_IMAGEM[file.type];
  if (!ext) throw new Recusa('Só imagens (JPG, PNG, WEBP, GIF, HEIC)');
  if (file.size > MAX_BYTES) throw new Recusa('Imagem maior que 10 MB');
  const path = `${reportId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return { path, name: (file.name || `imagem.${ext}`).slice(0, 120) };
}

/** Grava uma resposta/evento e, se veio status, atualiza o item. */
async function registrar(admin: SupabaseClient, reportId: string, item: Row, autor: { user?: string; guest?: string; nome: string }, body: Row) {
  const resposta = texto(body.body, MAX_TEXTO);
  const imagens = validarImagens(body.images, reportId);
  const novoStatus = body.new_status == null || body.new_status === item.status ? null : String(body.new_status);
  if (novoStatus && !STATUS_ITEM.includes(novoStatus)) throw new Recusa('Status inválido');
  if (!resposta && !imagens.length && !novoStatus) throw new Recusa('Escreva a resposta ou anexe uma imagem');

  const { data, error } = await admin.from('task_report_responses').insert({
    report_id: reportId, item_id: item.id, kind: resposta || imagens.length ? 'reply' : 'status',
    body: resposta, images: imagens, new_status: novoStatus,
    author_user_id: autor.user ?? null, author_guest_id: autor.guest ?? null, author_name: autor.nome,
  }).select('id').single();
  if (error) throw error;

  // Resposta de quem está fora marca o item como "respondido" se ele estava em aberto.
  const statusFinal = novoStatus ?? (autor.guest && item.status === 'open' && (resposta || imagens.length) ? 'answered' : null);
  const agora = new Date().toISOString();
  if (statusFinal) await admin.from('task_report_items').update({ status: statusFinal, updated_at: agora }).eq('id', item.id);
  await admin.from('task_reports').update({ updated_at: agora }).eq('id', reportId);
  return data.id as string;
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** Push para o dono quando alguém de fora responde. Roda depois da resposta sair, e falha não atrapalha. */
function avisarDono(supabaseUrl: string, serviceRoleKey: string, report: Row, nome: string, itemTitulo: string) {
  const p = enviarAvisoDono(supabaseUrl, serviceRoleKey, report, nome, itemTitulo);
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

async function enviarAvisoDono(supabaseUrl: string, serviceRoleKey: string, report: Row, nome: string, itemTitulo: string) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({
        action: 'send', user_ids: [report.created_by], tenant_id: report.tenant_id ?? null,
        payload: {
          titulo: `${nome} respondeu · ${report.title}`.slice(0, 120),
          corpo: itemTitulo.slice(0, 160),
          url: `/tarefas?relatorio=${report.id}`,
          tag: `relatorio-${report.id}`,
        },
      }),
    });
  } catch (e) {
    console.error('[task-reports] push', errMsg(e));
  }
}

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    // ── Corpo: JSON ou multipart (upload de imagem) ──
    let body: Row;
    let arquivo: File | null = null;
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      body = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
      const f = form.get('file');
      arquivo = f instanceof File ? f : null;
    } else {
      body = await req.json().catch(() => ({}));
    }
    const action = String(body.action ?? '');

    // ═══════════════ Ações públicas (pelo link) ═══════════════
    if (action.startsWith('public_')) {
      const shareToken = String(body.token ?? '');
      if (shareToken.length < 16) return json({ error: 'Link inválido' }, 404);
      const { data: report } = await admin.from('task_reports').select('*').eq('share_token', shareToken).maybeSingle();
      if (!report || report.archived_at || !report.link_enabled) return json({ error: 'Este link não está mais disponível' }, 404);

      // Identifica o convidado pelo token guardado no aparelho (se houver).
      let convidado: Row | null = null;
      if (body.guest_token) {
        const { data } = await admin.from('task_report_guests').select('*')
          .eq('token_hash', await sha256(String(body.guest_token))).eq('report_id', report.id).maybeSingle();
        convidado = data;
      }
      const exigirConvidado = () => {
        if (!convidado) throw new Recusa('Identifique-se para continuar', 401);
        return convidado;
      };
      const exigirAberto = () => {
        if (report.status !== 'open') throw new Recusa('Este relatório foi encerrado e não recebe mais respostas', 409);
      };

      switch (action) {
        case 'public_get': {
          if (convidado) await admin.from('task_report_guests').update({ last_seen_at: new Date().toISOString() }).eq('id', convidado.id);
          const dados = await montarRelatorio(admin, report, true);
          return json({ success: true, ...dados, me: convidado ? { id: convidado.id, name: convidado.name } : null });
        }
        case 'public_identify': {
          const nome = texto(body.name, 120);
          if (!nome || nome.length < 2) throw new Recusa('Informe seu nome');
          const contato = texto(body.contact, 160);
          const { count } = await admin.from('task_report_guests').select('id', { count: 'exact', head: true }).eq('report_id', report.id);
          if ((count ?? 0) >= 500) throw new Recusa('Limite de participantes atingido', 429);
          const guestToken = tokenAleatorio(32);
          const { data, error } = await admin.from('task_report_guests').insert({
            report_id: report.id, name: nome, contact: contato, token_hash: await sha256(guestToken),
            user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
          }).select('id, name').single();
          if (error) throw error;
          return json({ success: true, guest_token: guestToken, me: data });
        }
        case 'public_upload': {
          const c = exigirConvidado();
          exigirAberto();
          if (!arquivo) throw new Recusa('Arquivo ausente');
          const img = await gravarImagem(admin, report.id, arquivo);
          console.log('[task-reports] upload convidado', c.id, img.path);
          return json({ success: true, image: img });
        }
        case 'public_reply': {
          const c = exigirConvidado();
          exigirAberto();
          const { data: item } = await admin.from('task_report_items').select('*')
            .eq('id', String(body.item_id ?? '')).eq('report_id', report.id).is('archived_at', null).maybeSingle();
          if (!item) throw new Recusa('Item não encontrado', 404);
          const id = await registrar(admin, report.id, item, { guest: c.id, nome: c.name }, body);
          await admin.from('task_report_guests').update({ last_seen_at: new Date().toISOString() }).eq('id', c.id);
          avisarDono(supabaseUrl, serviceRoleKey, report, c.name, item.title);
          return json({ success: true, id });
        }
        case 'public_add_item': {
          const c = exigirConvidado();
          exigirAberto();
          if (!report.guests_can_add_items) throw new Recusa('Este relatório não aceita itens novos', 403);
          const titulo = texto(body.title, 300);
          if (!titulo) throw new Recusa('Informe o título do item');
          const { data: ultimo } = await admin.from('task_report_items').select('position')
            .eq('report_id', report.id).order('position', { ascending: false }).limit(1).maybeSingle();
          const { data, error } = await admin.from('task_report_items').insert({
            report_id: report.id, title: titulo, body: texto(body.body, MAX_TEXTO),
            images: validarImagens(body.images, report.id), position: (ultimo?.position ?? 0) + 1, created_by_guest: c.id,
          }).select('id').single();
          if (error) throw error;
          await admin.from('task_reports').update({ updated_at: new Date().toISOString() }).eq('id', report.id);
          avisarDono(supabaseUrl, serviceRoleKey, report, c.name, `Novo item: ${titulo}`);
          return json({ success: true, id: data.id });
        }
        default:
          return json({ error: `Ação desconhecida: ${action}` }, 400);
      }
    }

    // ═══════════════ Ações do dono (login) ═══════════════
    const db = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { data: lojas } = await admin.from('user_tenants').select('tenant_id').eq('user_id', user.id);
    if (!lojas?.length) {
      const { data: temTarefas } = await admin.rpc('fn_user_tem_tarefas', { p_user_id: user.id });
      if (!temTarefas) return json({ error: 'Sem acesso ao módulo Tarefas' }, 403);
    }
    const lojaPedida = body.tenant_id ? lojas?.find((l) => l.tenant_id === body.tenant_id)?.tenant_id : null;
    const tenantId = lojaPedida ?? lojas?.[0]?.tenant_id ?? null;

    // Nível mínimo por ação: view (ler/responder) < edit (itens, link) < owner (excluir) < creator (trocar pasta).
    const NIVEL: Record<string, number> = { view: 1, edit: 2, owner: 3, creator: 4 };
    const meuRelatorio = async (id: unknown, minimo: 'view' | 'edit' | 'owner' | 'creator' = 'view'): Promise<Row> => {
      const reportId = String(id ?? '');
      const [{ data }, { data: acesso }] = await Promise.all([
        admin.from('task_reports').select('*').eq('id', reportId).is('archived_at', null).maybeSingle(),
        admin.rpc('fn_task_report_access', { p_report_id: reportId, p_user_id: user.id }),
      ]);
      if (!data || !acesso) throw new Recusa('Relatório não encontrado', 404);
      if ((NIVEL[acesso as string] ?? 0) < NIVEL[minimo]) {
        throw new Recusa(minimo === 'edit'
          ? 'Você só pode ver e responder este relatório'
          : 'Só quem criou o relatório (ou o dono da pasta) pode fazer isso', 403);
      }
      return { ...data, access: acesso };
    };
    /** Pasta onde a pessoa pode pôr relatório: dona ou com permissão de editar. */
    const pastaPermitida = async (listId: unknown): Promise<string | null> => {
      if (listId === null || listId === undefined || listId === '') return null;
      const { data: acesso } = await admin.rpc('fn_task_list_access', { p_list_id: String(listId), p_user_id: user.id });
      if (acesso !== 'owner' && acesso !== 'edit') throw new Recusa('Você não pode pôr relatório nessa pasta', 403);
      return String(listId);
    };
    const marcarVisto = (reportId: string) => admin.from('task_report_seen')
      .upsert({ report_id: reportId, user_id: user.id, seen_at: new Date().toISOString() }, { onConflict: 'report_id,user_id' });
    const meuItem = async (reportId: string, itemId: unknown): Promise<Row> => {
      const { data } = await admin.from('task_report_items').select('*')
        .eq('id', String(itemId ?? '')).eq('report_id', reportId).is('archived_at', null).maybeSingle();
      if (!data) throw new Recusa('Item não encontrado', 404);
      return data;
    };
    const meuNome = async () => {
      const { data } = await admin.from('users').select('name').eq('id', user.id).maybeSingle();
      return (data?.name as string | undefined) ?? user.email ?? 'Equipe';
    };

    switch (action) {
      case 'list': {
        const { data: acessos, error: acErr } = await admin.rpc('fn_task_reports_acessiveis', { p_user_id: user.id });
        if (acErr) throw acErr;
        const acessoDe = new Map(((acessos ?? []) as Row[]).map((a) => [a.report_id, a.access]));
        const ids = [...acessoDe.keys()];
        if (!ids.length) return json({ success: true, reports: [] });
        const { data: reps, error } = await admin.from('task_reports')
          .select('id, title, status, link_enabled, share_token, created_by, list_id, created_at, updated_at')
          .in('id', ids).order('updated_at', { ascending: false });
        if (error) throw error;
        const listaIds = [...new Set((reps ?? []).map((r) => r.list_id).filter(Boolean))];
        const donos = [...new Set((reps ?? []).map((r) => r.created_by))];
        const [itensR, respR, vistoR, pastasR, nomesR] = await Promise.all([
          admin.from('task_report_items').select('report_id, status').in('report_id', ids).is('archived_at', null),
          admin.from('task_report_responses').select('report_id, created_at, author_guest_id').in('report_id', ids).not('author_guest_id', 'is', null),
          admin.from('task_report_seen').select('report_id, seen_at').in('report_id', ids).eq('user_id', user.id),
          listaIds.length ? admin.from('task_lists').select('id, name, color').in('id', listaIds) : Promise.resolve({ data: [] }),
          admin.from('users').select('id, name').in('id', donos),
        ]);
        const visto = new Map(((vistoR.data ?? []) as Row[]).map((v) => [v.report_id, v.seen_at]));
        const pasta = new Map(((pastasR.data ?? []) as Row[]).map((l) => [l.id, l]));
        const nome = new Map(((nomesR.data ?? []) as Row[]).map((u) => [u.id, u.name]));
        const lista = (reps ?? []).map((r) => {
          const itens = ((itensR.data ?? []) as Row[]).filter((i) => i.report_id === r.id);
          const resp = ((respR.data ?? []) as Row[]).filter((x) => x.report_id === r.id);
          const vistoEm = visto.get(r.id) as string | undefined;
          return {
            ...r,
            access: acessoDe.get(r.id),
            owner_name: nome.get(r.created_by) ?? null,
            list_name: r.list_id ? pasta.get(r.list_id)?.name ?? null : null,
            list_color: r.list_id ? pasta.get(r.list_id)?.color ?? null : null,
            items_total: itens.length,
            items_open: itens.filter((i) => i.status === 'open').length,
            items_resolved: itens.filter((i) => i.status === 'resolved').length,
            guest_responses: resp.length,
            unseen: resp.filter((x) => !vistoEm || x.created_at > vistoEm).length,
          };
        });
        return json({ success: true, reports: lista });
      }
      case 'get': {
        const r = await meuRelatorio(body.report_id);
        const dados = await montarRelatorio(admin, r, false);
        if (body.mark_seen) await marcarVisto(r.id);
        return json({ success: true, ...dados });
      }
      case 'create': {
        const titulo = texto(body.title, 200);
        if (!titulo) throw new Recusa('Informe o título');
        const { data, error } = await admin.from('task_reports').insert({
          tenant_id: tenantId, created_by: user.id, title: titulo, description: texto(body.description, MAX_TEXTO),
          share_token: tokenAleatorio(18), list_id: await pastaPermitida(body.list_id),
        }).select('id').single();
        if (error) throw error;
        return json({ success: true, id: data.id });
      }
      case 'update': {
        // Trocar a pasta muda quem enxerga o relatório: só quem criou.
        const r = await meuRelatorio(body.report_id, body.list_id !== undefined ? 'creator' : 'edit');
        const patch: Row = { updated_at: new Date().toISOString() };
        if (body.title !== undefined) {
          const t = texto(body.title, 200);
          if (!t) throw new Recusa('Informe o título');
          patch.title = t;
        }
        if (body.description !== undefined) patch.description = texto(body.description, MAX_TEXTO);
        if (body.link_enabled !== undefined) patch.link_enabled = !!body.link_enabled;
        if (body.guests_can_add_items !== undefined) patch.guests_can_add_items = !!body.guests_can_add_items;
        if (body.list_id !== undefined) patch.list_id = await pastaPermitida(body.list_id);
        if (body.status !== undefined) {
          if (!['open', 'closed'].includes(String(body.status))) throw new Recusa('Status inválido');
          patch.status = body.status;
        }
        const { error } = await admin.from('task_reports').update(patch).eq('id', r.id);
        if (error) throw error;
        return json({ success: true });
      }
      case 'regenerate_link': {
        const r = await meuRelatorio(body.report_id, 'edit');
        const novo = tokenAleatorio(18);
        const { error } = await admin.from('task_reports').update({ share_token: novo, updated_at: new Date().toISOString() }).eq('id', r.id);
        if (error) throw error;
        return json({ success: true, share_token: novo });
      }
      case 'archive': {
        const r = await meuRelatorio(body.report_id, 'owner');
        const { error } = await admin.from('task_reports').update({ archived_at: new Date().toISOString(), link_enabled: false }).eq('id', r.id);
        if (error) throw error;
        return json({ success: true });
      }
      case 'upload': {
        const r = await meuRelatorio(body.report_id);
        if (!arquivo) throw new Recusa('Arquivo ausente');
        return json({ success: true, image: await gravarImagem(admin, r.id, arquivo) });
      }
      case 'add_item': {
        const r = await meuRelatorio(body.report_id, 'edit');
        const titulo = texto(body.title, 300);
        if (!titulo) throw new Recusa('Informe o título do item');
        const { data: ultimo } = await admin.from('task_report_items').select('position')
          .eq('report_id', r.id).order('position', { ascending: false }).limit(1).maybeSingle();
        const { data, error } = await admin.from('task_report_items').insert({
          report_id: r.id, title: titulo, body: texto(body.body, MAX_TEXTO), images: validarImagens(body.images, r.id),
          position: (ultimo?.position ?? 0) + 1, created_by_user: user.id,
        }).select('id').single();
        if (error) throw error;
        await admin.from('task_reports').update({ updated_at: new Date().toISOString() }).eq('id', r.id);
        return json({ success: true, id: data.id });
      }
      case 'update_item': {
        const r = await meuRelatorio(body.report_id, 'edit');
        const item = await meuItem(r.id, body.item_id);
        const patch: Row = {};
        if (body.title !== undefined) {
          const t = texto(body.title, 300);
          if (!t) throw new Recusa('Informe o título do item');
          patch.title = t;
        }
        if (body.body !== undefined) patch.body = texto(body.body, MAX_TEXTO);
        if (body.images !== undefined) patch.images = validarImagens(body.images, r.id);
        if (body.position !== undefined) {
          const p = Number(body.position);
          if (!isFinite(p)) throw new Recusa('Posição inválida');
          patch.position = p;
        }
        if (!Object.keys(patch).length) return json({ success: true });
        const mudouConteudo = ['title', 'body', 'images'].some((k) => k in patch
          && JSON.stringify(patch[k] ?? null) !== JSON.stringify(item[k] ?? null));
        const agora = new Date().toISOString();
        const { error } = await admin.from('task_report_items').update({ ...patch, updated_at: agora }).eq('id', item.id);
        if (error) throw error;
        // Edição depois que o link já foi aberto por alguém fica registrada na sequência do item.
        if (mudouConteudo) {
          const [{ count: convidados }, { count: respostas }] = await Promise.all([
            admin.from('task_report_guests').select('id', { count: 'exact', head: true }).eq('report_id', r.id),
            admin.from('task_report_responses').select('id', { count: 'exact', head: true }).eq('item_id', item.id),
          ]);
          if ((convidados ?? 0) > 0 || (respostas ?? 0) > 0) {
            const antes = [
              patch.title && item.title !== patch.title ? `Título anterior: ${item.title}` : null,
              'body' in patch && (patch.body ?? null) !== (item.body ?? null) ? `Texto anterior: ${String(item.body ?? '(vazio)').slice(0, 1500)}` : null,
              'images' in patch && JSON.stringify(patch.images) !== JSON.stringify(item.images ?? []) ? 'Imagens alteradas' : null,
            ].filter(Boolean).join('\n');
            await admin.from('task_report_responses').insert({
              report_id: r.id, item_id: item.id, kind: 'edit', body: antes || null,
              author_user_id: user.id, author_name: await meuNome(),
            });
          }
        }
        await admin.from('task_reports').update({ updated_at: agora }).eq('id', r.id);
        return json({ success: true });
      }
      case 'delete_item': {
        const r = await meuRelatorio(body.report_id, 'edit');
        const item = await meuItem(r.id, body.item_id);
        const { error } = await admin.from('task_report_items').update({ archived_at: new Date().toISOString() }).eq('id', item.id);
        if (error) throw error;
        return json({ success: true });
      }
      case 'reply': {
        const r = await meuRelatorio(body.report_id);
        const item = await meuItem(r.id, body.item_id);
        const id = await registrar(admin, r.id, item, { user: user.id, nome: await meuNome() }, body);
        await marcarVisto(r.id);
        return json({ success: true, id });
      }
      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e) {
    if (e instanceof Recusa) return json({ error: e.message }, e.status);
    console.error('[task-reports]', errMsg(e));
    return json({ error: errMsg(e) }, 500);
  }
});
