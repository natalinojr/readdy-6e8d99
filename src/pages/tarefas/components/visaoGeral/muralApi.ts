/**
 * Mural da pasta (Tarefas › Visão geral) — chamadas à Edge Function `task-mural`.
 * No modo demo (/dev/tarefas) tudo fica em memória.
 */
import { invokeWithAuth, resolveAccessToken, compressImage, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { modoDemo } from '../../demo/modoDemo';

export type TipoMural = 'note' | 'link' | 'file';

export interface ItemMural {
  id: string;
  list_id: string;
  kind: TipoMural;
  title: string | null;
  body: string | null;
  url: string | null;
  color: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  /** URL assinada (vale algumas horas) — só arquivo. */
  file_url: string | null;
  pinned: boolean;
  position: number;
  created_by: string;
  created_by_name: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export type Resp<T> = { ok: true; data: T } | { ok: false; error: string };

/** Cores das notas (iguais às aceitas na Edge). */
export const CORES_NOTA = [
  { cor: '#f59e0b', nome: 'Amarelo' },
  { cor: '#10b981', nome: 'Verde' },
  { cor: '#3b82f6', nome: 'Azul' },
  { cor: '#ec4899', nome: 'Rosa' },
  { cor: '#8b5cf6', nome: 'Roxo' },
  { cor: '#64748b', nome: 'Cinza' },
];

export const MAX_BYTES_MURAL = 20 * 1024 * 1024;

/** Mesma ordem da Edge: fixados primeiro, depois a posição, depois os mais novos. */
export function ordenarMural(itens: ItemMural[]): ItemMural[] {
  return [...itens].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position || b.created_at.localeCompare(a.created_at));
}

/** O texto digitado é um link? (com ou sem https://) */
export function pareceLink(texto: string): boolean {
  const s = texto.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return true;
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(s);
}

/** Só deixa virar link clicável o que é web, e-mail ou telefone. */
export function hrefSeguro(url: string | null): string | null {
  if (!url) return null;
  return /^(https?:|mailto:|tel:)/i.test(url) ? url : null;
}

/** "planilha.google.com" / "e-mail: x@y" / "telefone: 4199…" para mostrar embaixo do título. */
export function rotuloLink(url: string): string {
  if (/^mailto:/i.test(url)) return url.replace(/^mailto:/i, '');
  if (/^tel:/i.test(url)) return url.replace(/^tel:/i, '');
  try {
    const u = new URL(url);
    const caminho = u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '';
    return `${u.hostname.replace(/^www\./, '')}${caminho.length > 24 ? `${caminho.slice(0, 24)}…` : caminho}`;
  } catch {
    return url;
  }
}

export function tamanhoArquivo(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

async function chamar<T>(action: string, payload: Record<string, unknown>): Promise<Resp<T>> {
  if (modoDemo()) {
    try { return { ok: true, data: demo(action, payload) as T }; } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  const { data, error } = await invokeWithAuth<T & { success?: boolean; error?: string }>('task-mural', { body: { action, ...payload } });
  if (error || !data?.success) return { ok: false, error: data?.error ?? error?.message ?? 'Erro desconhecido' };
  return { ok: true, data };
}

export async function listarMural(listId: string): Promise<Resp<{ items: ItemMural[]; can_edit: boolean }>> {
  return chamar('list', { list_id: listId });
}

export async function criarItemMural(listId: string, dados: { kind: 'note' | 'link'; title?: string | null; body?: string | null; url?: string | null; color?: string | null; pinned?: boolean }): Promise<Resp<{ item: ItemMural }>> {
  return chamar('create', { list_id: listId, ...dados });
}

export async function atualizarItemMural(id: string, patch: Partial<Pick<ItemMural, 'title' | 'body' | 'url' | 'color' | 'pinned' | 'position'>>): Promise<Resp<{ item: ItemMural }>> {
  return chamar('update', { id, ...patch });
}

export async function excluirItemMural(id: string): Promise<Resp<unknown>> {
  return chamar('delete', { id });
}

/** Foto vira JPEG de até 2000px antes de sair (documento continua legível, upload rápido no 4G). */
export async function enviarArquivoMural(listId: string, file: File): Promise<Resp<{ item: ItemMural }>> {
  try {
    const blob: Blob = file.type.startsWith('image/') && file.size > 1024 * 1024 ? await compressImage(file, 2000, 0.8) : file;
    const nome = blob !== file && !/\.jpe?g$/i.test(file.name) ? `${file.name.replace(/\.[^.]+$/, '')}.jpg` : file.name;
    if (blob.size > MAX_BYTES_MURAL) return { ok: false, error: `"${file.name}" passa de 20 MB` };
    if (modoDemo()) {
      return { ok: true, data: { item: demoArquivo(listId, new File([blob], nome, { type: blob.type || file.type })) } };
    }
    const { accessToken, error } = await resolveAccessToken();
    if (!accessToken) return { ok: false, error: error?.message ?? 'Sessão expirada. Entre de novo.' };
    const form = new FormData();
    form.append('action', 'upload');
    form.append('list_id', listId);
    form.append('file', blob, nome);
    // NÃO definir Content-Type: o navegador monta o boundary do multipart sozinho.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/task-mural`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) return { ok: false, error: data.error ?? `Falha no envio (HTTP ${res.status})` };
    return { ok: true, data: { item: data.item as ItemMural } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha no envio do arquivo' };
  }
}

// ── Modo demo: mural em memória ──

const DEMO_EU = { id: 'demo-eu', nome: 'Você (demo)' };
let demoSeq = 1;
const demoItens: ItemMural[] = [];
const agoraIso = () => new Date().toISOString();

function novoDemo(p: Partial<ItemMural> & { list_id: string; kind: TipoMural }): ItemMural {
  const minimo = Math.min(1, ...demoItens.filter((i) => i.list_id === p.list_id).map((i) => i.position));
  return {
    id: `mural-${demoSeq++}`, title: null, body: null, url: null, color: null, file_name: null, file_mime: null, file_size: null,
    file_url: null, pinned: false, position: minimo - 1, created_by: DEMO_EU.id, created_by_name: DEMO_EU.nome,
    updated_by: null, updated_by_name: null, created_at: agoraIso(), updated_at: agoraIso(), ...p,
  };
}

// Exemplos na pasta "Reforma do salão" do demo.
demoItens.push(
  novoDemo({ list_id: 'reforma', kind: 'note', title: 'Combinado com o pintor', body: 'Começa segunda às 7h.\nTinta acetinada, cor Branco Gelo (Suvinil).\nPagamento: 50% no início, 50% na entrega.', color: '#f59e0b', pinned: true }),
  novoDemo({ list_id: 'reforma', kind: 'link', title: 'Planilha do orçamento', url: 'https://docs.google.com/spreadsheets/d/exemplo' }),
  novoDemo({ list_id: 'reforma', kind: 'link', title: 'Pintor — WhatsApp', url: 'tel:+5541999990000' }),
  novoDemo({ list_id: 'reforma', kind: 'note', title: 'Fornecedores da obra', body: 'Elétrica: (41) 3333-0000\nPiso: pedido 4521 na loja\nCaçamba: www.cacambasexemplo.com.br', color: '#3b82f6' }),
);

function demo(action: string, p: Record<string, unknown>): unknown {
  const achar = (id: unknown) => {
    const i = demoItens.find((x) => x.id === id);
    if (!i) throw new Error('Item não encontrado');
    return i;
  };
  switch (action) {
    case 'list':
      return { items: ordenarMural(demoItens.filter((i) => i.list_id === p.list_id)), can_edit: true };
    case 'create': {
      if (p.kind === 'note' && !String(p.title ?? '').trim() && !String(p.body ?? '').trim()) throw new Error('Escreva alguma coisa na nota');
      let url = p.kind === 'link' ? String(p.url ?? '').trim() : null;
      if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
      const item = novoDemo({
        list_id: String(p.list_id), kind: p.kind as TipoMural, title: (p.title as string) || null, body: (p.body as string) || null,
        url, color: (p.color as string) || null, pinned: p.pinned === true,
      });
      demoItens.push(item);
      return { item };
    }
    case 'update': {
      const i = achar(p.id);
      Object.assign(i, Object.fromEntries(Object.entries(p).filter(([k]) => ['title', 'body', 'url', 'color', 'pinned', 'position'].includes(k))));
      if (['title', 'body', 'url', 'color'].some((k) => k in p)) Object.assign(i, { updated_by: DEMO_EU.id, updated_by_name: DEMO_EU.nome, updated_at: agoraIso() });
      return { item: { ...i } };
    }
    case 'delete': {
      const i = achar(p.id);
      demoItens.splice(demoItens.indexOf(i), 1);
      return {};
    }
    default:
      throw new Error(`Ação desconhecida: ${action}`);
  }
}

function demoArquivo(listId: string, file: File): ItemMural {
  const item = novoDemo({
    list_id: listId, kind: 'file', file_name: file.name, file_mime: file.type || null, file_size: file.size, file_url: URL.createObjectURL(file),
  });
  demoItens.push(item);
  return item;
}
