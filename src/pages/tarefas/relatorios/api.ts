/**
 * Relatório compartilhável (Tarefas) — chamadas à Edge Function `task-reports`.
 * Dono: com login (invokeWithAuth). Público: pelo token do link, sem login.
 */
import { invokeWithAuth, resolveAccessToken, compressImage, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { MODO_DEMO } from '../demo/modoDemo';

export type StatusItem = 'open' | 'answered' | 'resolved';

export interface ImagemRel { path: string; name: string; caption?: string | null; url?: string | null }

/** Campo de resposta de um item: o que quem responde preenche. */
export type TipoCampo = 'escolha' | 'multipla' | 'sim_nao' | 'texto' | 'numero' | 'data';
export interface CampoRel {
  id: string;
  type: TipoCampo;
  label: string;
  options?: Array<{ id: string; label: string }>;
  /** Caixas de seleção: quantas marcar no mínimo/no máximo (vazio = sem limite). */
  min?: number | null;
  max?: number | null;
}

/** Link de arquivo na nuvem anexado ao relatório. */
export interface LinkRel { url: string; title: string | null }

/** Modelo de relatório (pessoal). */
export interface ModeloRel { id: string; name: string; items_total: number; links_total: number; created_at: string; updated_at: string }
export type ValorCampo = string | number | string[] | null;

export interface RespostaRel {
  id: string;
  kind: 'reply' | 'status' | 'edit';
  body: string | null;
  images: ImagemRel[];
  new_status: StatusItem | null;
  /** Campos respondidos nesta resposta (só o que mudou). */
  answers?: Record<string, ValorCampo> | null;
  author_name: string;
  author_type: 'owner' | 'guest';
  author_guest_id: string | null;
  created_at: string;
  /** Resposta de quem criou o relatório (as da equipe da pasta aparecem como "equipe"). */
  author_is_creator?: boolean;
  /** Só na tela da equipe: quem da equipe respondeu. */
  author_user_id?: string | null;
}

/** Meu acesso ao relatório: criei; sou dono da pasta; a pasta é compartilhada comigo. */
export type AcessoRelatorio = 'creator' | 'owner' | 'edit' | 'view';
export const podeEditar = (a?: AcessoRelatorio | null) => a === 'creator' || a === 'owner' || a === 'edit';
export const podeExcluir = (a?: AcessoRelatorio | null) => a === 'creator' || a === 'owner';

export interface ItemRel {
  id: string;
  position: number;
  title: string;
  body: string | null;
  images: ImagemRel[];
  status: StatusItem;
  fields?: CampoRel[];
  created_by_guest_name: string | null;
  created_at: string;
  updated_at: string;
  responses: RespostaRel[];
}

export interface Relatorio {
  id: string;
  title: string;
  description: string | null;
  status: 'open' | 'closed';
  guests_can_add_items: boolean;
  owner_name: string | null;
  links?: LinkRel[];
  created_at: string;
  updated_at: string;
  share_token?: string;
  link_enabled?: boolean;
  created_by?: string;
  list_id?: string | null;
  access?: AcessoRelatorio | null;
  /** Tarefas ligadas ao relatório (só na tela da equipe). */
  linked_task_ids?: string[];
}

export interface Convidado { id: string; name: string; contact?: string | null; created_at?: string; last_seen_at?: string }

export interface RelatorioCompleto { report: Relatorio; items: ItemRel[]; guests: Convidado[] }

export interface ResumoRelatorio {
  id: string;
  title: string;
  status: 'open' | 'closed';
  link_enabled: boolean;
  share_token: string;
  created_by: string;
  access: AcessoRelatorio;
  owner_name: string | null;
  list_id: string | null;
  list_name: string | null;
  list_color: string | null;
  created_at: string;
  updated_at: string;
  items_total: number;
  items_open: number;
  items_resolved: number;
  guest_responses: number;
  unseen: number;
}

export const STATUS_INFO: Record<StatusItem, { label: string; cor: string }> = {
  open: { label: 'Aguardando resposta', cor: 'bg-amber-100 text-amber-800' },
  answered: { label: 'Respondido', cor: 'bg-sky-100 text-sky-800' },
  resolved: { label: 'Resolvido', cor: 'bg-emerald-100 text-emerald-800' },
};

// Endereço de onde o dono está (em produção, erpos.vercel.app). Não usa o
// getAppBaseUrl: o VITE_APP_URL ainda pode apontar para o domínio do Readdy, que está pausado.
export const linkPublico = (token: string) => `${window.location.origin}/r/${token}`;

// Função (e não constante) para só ler SUPABASE_URL na hora da chamada — nos testes o módulo vem mockado.
const urlFn = () => `${SUPABASE_URL}/functions/v1/task-reports`;

type Resp<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

// ── Dono ──

export async function chamarDono<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<Resp<T>> {
  if (MODO_DEMO) {
    const { demoDono } = await import('./demo');
    try { return { ok: true, data: (await demoDono(action, payload)) as T }; } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  const { data, error } = await invokeWithAuth<T & { success?: boolean; error?: string }>('task-reports', { body: { action, ...payload } });
  if (error || !data?.success) return { ok: false, error: data?.error ?? error?.message ?? 'Erro desconhecido' };
  return { ok: true, data };
}

/** Imagem de celular vira JPEG de até 1600px antes de sair (foto de 4 MB → ~200 KB). */
async function prepararImagem(file: File): Promise<{ blob: Blob; nome: string }> {
  const blob = await compressImage(file, 1600, 0.75);
  const nome = blob !== file && !/\.jpe?g$/i.test(file.name) ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : file.name;
  return { blob, nome };
}

async function enviarMultipart(campos: Record<string, string>, file: File, bearer: string | null): Promise<Resp<ImagemRel>> {
  try {
    const { blob, nome } = await prepararImagem(file);
    if (blob.size > 10 * 1024 * 1024) return { ok: false, error: 'Imagem maior que 10 MB' };
    const form = new FormData();
    for (const [k, v] of Object.entries(campos)) form.append(k, v);
    form.append('file', blob, nome);
    const res = await fetch(urlFn(), {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) return { ok: false, error: data.error ?? `Falha no envio (HTTP ${res.status})`, status: res.status };
    return { ok: true, data: data.image as ImagemRel };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha no envio da imagem' };
  }
}

export async function enviarImagemDono(reportId: string, file: File): Promise<Resp<ImagemRel>> {
  const { accessToken, error } = await resolveAccessToken();
  if (!accessToken) return { ok: false, error: error?.message ?? 'Sessão expirada. Entre de novo.' };
  return enviarMultipart({ action: 'upload', report_id: reportId }, file, accessToken);
}

// ── Público (link) ──

export async function chamarPublico<T = Record<string, unknown>>(action: string, payload: Record<string, unknown>): Promise<Resp<T>> {
  try {
    const res = await fetch(urlFn(), {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) return { ok: false, error: data.error ?? `Erro (HTTP ${res.status})`, status: res.status };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: 'Sem conexão. Tente de novo.' };
  }
}

export function enviarImagemPublico(token: string, guestToken: string, file: File): Promise<Resp<ImagemRel>> {
  return enviarMultipart({ action: 'public_upload', token, guest_token: guestToken }, file, null);
}

// Identificação do convidado fica no aparelho, por link.
const chaveConvidado = (token: string) => `erpos_relatorio_convidado_${token}`;
export function lerConvidado(token: string): string | null {
  try { return localStorage.getItem(chaveConvidado(token)); } catch { return null; }
}
export function salvarConvidado(token: string, guestToken: string | null) {
  try {
    if (guestToken) localStorage.setItem(chaveConvidado(token), guestToken);
    else localStorage.removeItem(chaveConvidado(token));
  } catch { /* sem localStorage: vale só nesta aba */ }
}

export function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
