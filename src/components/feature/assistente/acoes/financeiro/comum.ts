// Peças comuns das ações rápidas do grupo FINANCEIRO (chat do assistente).
// Tudo aqui reaproveita o caminho das telas do Financeiro:
// - escrita/leitura via Edge financial-write ({ action, tenant_id, payload }), como useFinanceiro.invokeFinancial;
// - classificação DRE igual ao DreClassificacaoSelect/pay_bill: categorias de despesa da loja
//   + grupos sem categoria raiz (escolher o grupo reaproveita/cria a categoria raiz com o nome dele).
import { supabase } from '@/lib/supabase';
import { invokeUmaVez } from '../kit';
import { resolverGrupos, isGrupoDespesa, type DreGroup } from '@/hooks/useDreGroups';

/** Mesmas formas de pagamento do modal de baixa de Contas a Pagar. */
export const FORMAS_PAGAMENTO = ['PIX', 'Dinheiro', 'Boleto', 'Transferência', 'Cartão Débito', 'Cartão Crédito'];

/** Chamada à Edge financial-write. Erro de HTTP ou `{ error }` no corpo vira `error`. */
export async function finWrite<T = unknown>(action: string, tenantId: string, payload: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await invokeUmaVez<{ data?: T; error?: string }>('financial-write', {
    body: { action, tenant_id: tenantId, payload },
  });
  if (error) return { data: null, error: error.message || 'Falha na chamada' };
  if (data?.error) return { data: null, error: String(data.error) };
  return { data: (data?.data ?? null) as T | null, error: null };
}

// ── Classificação DRE ────────────────────────────────────────────────────────
export interface DreCat { id: string; name: string; group_type: string; parent_id: string | null }
export type DreEscolha =
  | { tipo: 'categoria'; id: string; label: string; grupo: string }
  | { tipo: 'grupo'; key: string; label: string };
export interface DreGrupoOpcoes { key: string; label: string; opcoes: DreEscolha[] }

/**
 * Monta as opções de classificação por grupo (lógica pura, testada em src/test/lib).
 * Só grupos de DESPESA (expense + customizados): revenue/tax a DRE não subtrai e `cost` foi aposentado.
 * Grupo sem categoria raiz com o mesmo nome também aparece como opção (vira a categoria raiz ao gravar).
 */
export function montarOpcoesDre(cats: DreCat[], grupoRows: DreGroup[]): DreGrupoOpcoes[] {
  const grupos = resolverGrupos(grupoRows).allGroups.filter((g) => isGrupoDespesa(g.key));
  const nomePai = new Map(cats.map((c) => [c.id, c.name]));
  return grupos.map((g) => {
    const doGrupo = cats.filter((c) => c.group_type === g.key);
    const opcoes: DreEscolha[] = doGrupo.map((c) => ({
      tipo: 'categoria' as const, id: c.id, grupo: g.key,
      label: c.parent_id && nomePai.get(c.parent_id) ? `${nomePai.get(c.parent_id)} › ${c.name}` : c.name,
    }));
    const temRaiz = doGrupo.some((c) => c.name.trim().toLowerCase() === g.label.trim().toLowerCase());
    if (!temRaiz) opcoes.unshift({ tipo: 'grupo', key: g.key, label: g.label });
    return { key: g.key, label: g.label, opcoes };
  }).filter((g) => g.opcoes.length > 0);
}

/** Categorias ativas + grupos da loja ativa (mesmas leituras de ContasPagarTab / useDreGroups). */
export async function carregarOpcoesDre(tenantId: string): Promise<{ grupos: DreGrupoOpcoes[]; error: string | null }> {
  const [c, g] = await Promise.all([
    supabase.from('fin_dre_categories').select('id, name, group_type, parent_id')
      .eq('tenant_id', tenantId).eq('is_active', true).is('deleted_at', null).order('group_type').order('sort_order'),
    supabase.from('fin_dre_groups').select('id, key, label, icon').eq('tenant_id', tenantId).order('sort_order').order('label'),
  ]);
  if (c.error || g.error) return { grupos: [], error: (c.error ?? g.error)!.message };
  const rows: DreGroup[] = (g.data ?? []).map((r) => ({
    id: r.id as string, key: r.key as string, label: r.label as string, icon: (r.icon as string) || 'ri-folder-line', standard: false,
  }));
  return { grupos: montarOpcoesDre((c.data ?? []) as DreCat[], rows), error: null };
}

/** Complemento do pay_bill (igual useDreEscolha.toPayload). */
export function dreParaPayBill(e: DreEscolha) {
  return e.tipo === 'categoria' ? { dre_category_id: e.id } : { dre_group: e.key, dre_category_name: e.label };
}

/**
 * Id da categoria para gravar direto na conta (upsert_bill / bulk_update_bill_dre_category).
 * Grupo: reaproveita a categoria do grupo com o mesmo nome ou cria a raiz (mesma regra do pay_bill).
 * Só chamar DEPOIS da confirmação do usuário (pode criar a categoria).
 */
export async function resolverCategoriaDre(tenantId: string, e: DreEscolha): Promise<{ id: string | null; nome: string; error: string | null }> {
  if (e.tipo === 'categoria') return { id: e.id, nome: e.label, error: null };
  const nome = e.label.trim().slice(0, 120);
  const { data: existentes, error } = await supabase.from('fin_dre_categories').select('id, name')
    .eq('tenant_id', tenantId).eq('group_type', e.key);
  if (error) return { id: null, nome, error: error.message };
  const achada = (existentes ?? []).find((c) => String(c.name).trim().toLowerCase() === nome.toLowerCase());
  if (achada) return { id: achada.id as string, nome, error: null };
  const r = await finWrite<{ id: string }>('upsert_dre_category', tenantId, {
    name: nome, group_type: e.key, parent_id: null, sort_order: 0, is_active: true,
  });
  if (r.error || !r.data?.id) return { id: null, nome, error: r.error ?? 'Não foi possível criar a categoria' };
  return { id: r.data.id, nome, error: null };
}
