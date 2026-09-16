// Apoio das ações rápidas de COMPRAS E ESTOQUE (2026-09-16).
// - Leituras: as mesmas das telas (fn_get_ingredients do EstoqueContext; header x-tenant-id da loja ativa).
// - Gravações: UMA chamada só, sem retry. O invokeWithAuth repete o POST em erro de rede/timeout,
//   o que numa perda ou num recebimento poderia gravar duas vezes. As telas de Compras já chamam
//   as Edges por fetch direto; aqui é o mesmo formato de corpo que cada tela envia.
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, ensureFreshSession } from '@/lib/supabase';

export interface InsumoLido {
  id: string;
  nome: string;
  /** Unidade como está no banco: g | kg | ml | L | unit */
  unidadeDb: string;
  estoque: number;
  minimo: number;
  preco: number;
  esgotado: boolean;
  categoria: string;
}

/** Unidade do banco → rótulo curto. */
export const rotuloUnidade = (u: string | null | undefined) => (u === 'unit' || !u ? 'un' : u);

export const qtdBR = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Mesma leitura do EstoqueContext.loadInsumos (fn_get_ingredients), sem os excluídos. */
export async function lerInsumos(tenantId: string): Promise<{ insumos: InsumoLido[]; erro: string | null }> {
  const { data, error } = await supabase.rpc('fn_get_ingredients', { p_tenant_id: tenantId });
  if (error) return { insumos: [], erro: error.message };
  const rows = (data as Array<Record<string, unknown>>) ?? [];
  const insumos = rows
    .filter((r) => !r.deleted_at)
    .map((r) => ({
      id: String(r.id),
      nome: String(r.name ?? ''),
      unidadeDb: String(r.unit ?? 'unit'),
      estoque: Number(r.current_stock ?? 0),
      minimo: Number(r.min_stock ?? 0),
      preco: Number(r.unit_price ?? 0),
      esgotado: Boolean(r.is_depleted ?? false),
      categoria: String(r.category ?? ''),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { insumos, erro: null };
}

/** Busca por nome (sem acento, sem caixa). */
export const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** POST único numa Edge Function (sem repetir). Devolve o JSON ou a mensagem de erro. */
export async function gravarNaEdge<T = Record<string, unknown>>(funcao: string, corpo: Record<string, unknown>): Promise<{ data: T | null; erro: string | null }> {
  const sessao = await ensureFreshSession();
  if (!sessao?.access_token) return { data: null, erro: 'Sessão expirada. Entre de novo no ERPOS.' };
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${funcao}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.access_token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(corpo),
    });
  } catch {
    return { data: null, erro: 'Sem conexão. Confira na tela se gravou antes de tentar de novo.' };
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!res.ok || (json && json.error)) {
    const e = json?.error;
    const msg = typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : `Erro ${res.status}`;
    return { data: null, erro: msg };
  }
  return { data: json, erro: null };
}
