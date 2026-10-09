// task-mural — mural da pasta, no módulo Tarefas (Visão geral da pasta-mãe), 2026-10-09.
//
// Notas, links e arquivos que ficam na pasta para acesso rápido. Vê quem tem
// acesso à pasta (fn_task_list_access: owner/edit/view); cria, edita, fixa,
// reordena e exclui quem é dono ou pode editar. Arquivos no bucket privado
// task-mural (<list_id>/<uuid>.<ext>), entregues por URL assinada.
//
// verify_jwt = true: só quem está logado; o usuário é validado de novo aqui.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

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

const BUCKET = 'task-mural';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ITENS = 300;
const VALIDADE_URL = 60 * 60 * 6;
const CORES = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#64748b'];

function texto(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s.length > max) throw new Recusa(`Texto maior que ${max} caracteres`);
  return s || null;
}

/** Link aceito: http(s), e-mail (mailto:) ou telefone (tel:). Sem esquema vira https://. */
function normalizarUrl(v: unknown): string {
  let s = String(v ?? '').trim();
  if (!s) throw new Recusa('Informe o link');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { throw new Recusa('Link inválido'); }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol)) throw new Recusa('Só links da web, de e-mail ou de telefone');
  if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.hostname.includes('.') && u.hostname !== 'localhost') {
    throw new Recusa('Link inválido');
  }
  const final = u.toString();
  if (final.length > 2000) throw new Recusa('Link muito longo');
  return final;
}

function cor(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const c = String(v).toLowerCase();
  if (!CORES.includes(c)) throw new Recusa('Cor inválida');
  return c;
}

function extensao(nome: string): string {
  const m = /\.([a-z0-9]{1,10})$/i.exec(nome);
  return m ? m[1].toLowerCase() : 'bin';
}

const COLUNAS = 'id, list_id, kind, title, body, url, color, file_path, file_name, file_mime, file_size, pinned, position, created_by, updated_by, created_at, updated_at';

/** Troca file_path por URL assinada e põe o nome de quem criou. */
async function entregar(admin: SupabaseClient, itens: Row[]): Promise<Row[]> {
  const caminhos = itens.map((i) => i.file_path).filter(Boolean) as string[];
  const urls = new Map<string, string>();
  if (caminhos.length) {
    const { data } = await admin.storage.from(BUCKET).createSignedUrls(caminhos, VALIDADE_URL);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  const ids = [...new Set(itens.flatMap((i) => [i.created_by, i.updated_by]).filter(Boolean))] as string[];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data } = await admin.from('users').select('id, name').in('id', ids);
    for (const u of (data ?? []) as Row[]) nomes.set(u.id, u.name);
  }
  return itens.map(({ file_path, ...i }) => ({
    ...i,
    file_url: file_path ? urls.get(file_path) ?? null : null,
    created_by_name: nomes.get(i.created_by) ?? null,
    updated_by_name: i.updated_by ? nomes.get(i.updated_by) ?? null : null,
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    // ── Corpo: JSON ou multipart (upload de arquivo) ──
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

    const db = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    // Mesma porta do task-reports: sem loja, só quem tem o módulo Tarefas liberado.
    const { data: lojas } = await admin.from('user_tenants').select('tenant_id').eq('user_id', user.id).limit(1);
    if (!lojas?.length) {
      const { data: temTarefas } = await admin.rpc('fn_user_tem_tarefas', { p_user_id: user.id });
      if (!temTarefas) return json({ error: 'Sem acesso ao módulo Tarefas' }, 403);
    }

    /** Acesso à pasta; `editar` exige dono ou permissão de editar. */
    const exigirPasta = async (listId: unknown, editar: boolean): Promise<string> => {
      const id = String(listId ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Recusa('Pasta inválida');
      const { data: acesso, error } = await admin.rpc('fn_task_list_access', { p_list_id: id, p_user_id: user.id });
      if (error) throw error;
      if (!acesso) throw new Recusa('Pasta não encontrada', 404);
      if (editar && acesso !== 'owner' && acesso !== 'edit') throw new Recusa('Você só pode ver o mural desta pasta', 403);
      return acesso as string;
    };
    const meuItem = async (id: unknown): Promise<Row> => {
      const { data } = await admin.from('task_list_mural').select(COLUNAS).eq('id', String(id ?? '')).maybeSingle();
      if (!data) throw new Recusa('Item não encontrado', 404);
      await exigirPasta(data.list_id, true);
      return data;
    };
    /** Item novo entra no começo do mural (antes de todos os não fixados). */
    const posicaoInicial = async (listId: string): Promise<number> => {
      const { count } = await admin.from('task_list_mural').select('id', { count: 'exact', head: true }).eq('list_id', listId);
      if ((count ?? 0) >= MAX_ITENS) throw new Recusa(`O mural aceita até ${MAX_ITENS} itens`);
      const { data } = await admin.from('task_list_mural').select('position').eq('list_id', listId)
        .order('position', { ascending: true }).limit(1).maybeSingle();
      return (data?.position ?? 1) - 1;
    };

    switch (action) {
      case 'list': {
        const acesso = await exigirPasta(body.list_id, false);
        const { data, error } = await admin.from('task_list_mural').select(COLUNAS).eq('list_id', String(body.list_id))
          .order('pinned', { ascending: false }).order('position', { ascending: true }).order('created_at', { ascending: false });
        if (error) throw error;
        return json({ success: true, items: await entregar(admin, (data ?? []) as Row[]), can_edit: acesso === 'owner' || acesso === 'edit' });
      }

      case 'create': {
        const listId = String(body.list_id ?? '');
        await exigirPasta(listId, true);
        const kind = String(body.kind ?? '');
        if (kind !== 'note' && kind !== 'link') throw new Recusa('Tipo inválido');
        const title = texto(body.title, 200);
        const corpo = texto(body.body, 20000);
        const url = kind === 'link' ? normalizarUrl(body.url) : null;
        if (kind === 'note' && !title && !corpo) throw new Recusa('Escreva alguma coisa na nota');
        const { data, error } = await admin.from('task_list_mural').insert({
          list_id: listId, kind, title, body: corpo, url, color: kind === 'note' ? cor(body.color) : null,
          pinned: body.pinned === true, position: await posicaoInicial(listId), created_by: user.id,
        }).select(COLUNAS).single();
        if (error) throw error;
        return json({ success: true, item: (await entregar(admin, [data]))[0] });
      }

      case 'upload': {
        const listId = String(body.list_id ?? '');
        await exigirPasta(listId, true);
        if (!arquivo) throw new Recusa('Arquivo ausente');
        if (arquivo.size > MAX_BYTES) throw new Recusa('Arquivo maior que 20 MB');
        if (arquivo.size === 0) throw new Recusa('Arquivo vazio');
        const nome = (arquivo.name || 'arquivo').slice(0, 200);
        const posicao = await posicaoInicial(listId);
        const path = `${listId}/${crypto.randomUUID()}.${extensao(nome)}`;
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, arquivo, {
          contentType: arquivo.type || 'application/octet-stream', upsert: false,
        });
        if (upErr) throw upErr;
        const { data, error } = await admin.from('task_list_mural').insert({
          list_id: listId, kind: 'file', title: texto(body.title, 200), file_path: path, file_name: nome,
          file_mime: arquivo.type || null, file_size: arquivo.size, position: posicao, created_by: user.id,
        }).select(COLUNAS).single();
        if (error) {
          await admin.storage.from(BUCKET).remove([path]);
          throw error;
        }
        return json({ success: true, item: (await entregar(admin, [data]))[0] });
      }

      case 'update': {
        const item = await meuItem(body.id);
        const patch: Row = {};
        if ('title' in body) patch.title = texto(body.title, 200);
        if ('body' in body) patch.body = texto(body.body, 20000);
        if ('url' in body) {
          if (item.kind !== 'link') throw new Recusa('Só link tem endereço');
          patch.url = normalizarUrl(body.url);
        }
        if ('color' in body) {
          if (item.kind !== 'note') throw new Recusa('Só nota tem cor');
          patch.color = cor(body.color);
        }
        if ('pinned' in body) patch.pinned = body.pinned === true;
        if ('position' in body) {
          const p = Number(body.position);
          if (!Number.isFinite(p)) throw new Recusa('Posição inválida');
          patch.position = p;
        }
        if (!Object.keys(patch).length) throw new Recusa('Nada para mudar');
        const final = { ...item, ...patch };
        if (item.kind === 'note' && !final.title && !final.body) throw new Recusa('A nota não pode ficar vazia');
        // Fixar/mover não conta como edição do conteúdo.
        const editouConteudo = ['title', 'body', 'url', 'color'].some((k) => k in patch);
        if (editouConteudo) { patch.updated_by = user.id; patch.updated_at = new Date().toISOString(); }
        const { data, error } = await admin.from('task_list_mural').update(patch).eq('id', item.id).select(COLUNAS).single();
        if (error) throw error;
        return json({ success: true, item: (await entregar(admin, [data]))[0] });
      }

      case 'delete': {
        const item = await meuItem(body.id);
        const { error } = await admin.from('task_list_mural').delete().eq('id', item.id);
        if (error) throw error;
        if (item.file_path) {
          const { error: rmErr } = await admin.storage.from(BUCKET).remove([item.file_path]);
          if (rmErr) console.error('[task-mural] remover arquivo', item.file_path, errMsg(rmErr));
        }
        return json({ success: true });
      }

      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (err) {
    if (err instanceof Recusa) return json({ error: err.message }, err.status);
    console.error('[task-mural]', errMsg(err));
    return json({ error: errMsg(err) }, 500);
  }
});
