// Financeiro › Pagamentos (2026-10-06): leitura pelas funções do banco (a regra mora lá — a mesma da Hoje
// e do aviso antes de pagar) e as poucas gravações da aba.
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { chamarAssistente } from '@/lib/assistenteApp';
import type {
  AvisoPagar, Avulso, CaixaLoja, CompraOnline, ContaFixa, Mercadoria, NotaSemCompra, Pessoa,
} from '@/lib/pagamentos';

export interface CompraVista { id: string; tenant_id: string; loja: string; fornecedor: string; data: string; valor: number; forma: string | null; itens: number; itens_ligados: number }
export interface DadosPagamentos {
  mercadoria: Mercadoria[]; notas: NotaSemCompra[]; vista: CompraVista[]; pessoas: Pessoa[]; avulsos: Avulso[];
  online: CompraOnline[]; caixa: CaixaLoja[]; avisos: Record<string, AvisoPagar[]>; hoje: string;
}

export interface LojaFin { tenantId: string; nome: string }

/** Lojas em que a pessoa vê o Financeiro (para "Todas as lojas"). */
export async function lojasDoFinanceiro(userId: string): Promise<LojaFin[]> {
  const { data, error } = await supabase.rpc('get_user_tenants', { p_user_id: userId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ tenant_id: string; tenant_name: string; role: string }>)
    .filter((r) => ['admin', 'manager', 'financeiro', 'accountant'].includes(String(r.role)))
    .map((r) => ({ tenantId: String(r.tenant_id), nome: String(r.tenant_name) }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

export async function carregarFixas(tenants: string[], mes: string): Promise<ContaFixa[]> {
  const { data, error } = await supabase.rpc('fn_contas_fixas', { p_tenants: tenants, p_mes: mes });
  if (error) throw new Error(error.message);
  return (data ?? []) as ContaFixa[];
}

export async function carregarPagamentos(tenants: string[]): Promise<DadosPagamentos> {
  const { data, error } = await supabase.rpc('fn_pagamentos', { p_tenants: tenants });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Partial<DadosPagamentos>;
  return {
    mercadoria: d.mercadoria ?? [], notas: d.notas ?? [], vista: d.vista ?? [], pessoas: d.pessoas ?? [],
    avulsos: d.avulsos ?? [], online: d.online ?? [], caixa: d.caixa ?? [], avisos: d.avisos ?? {}, hoje: d.hoje ?? '',
  };
}

export type AcaoFixa = 'confirmar' | 'nao_e_fixa' | 'encerrar' | 'reativar' | 'nao_vem_mes' | 'vem_mes' | 'configurar';
export async function marcarFixa(f: ContaFixa, acao: AcaoFixa, dados: Record<string, unknown> = {}): Promise<void> {
  const { error } = await supabase.rpc('fn_conta_fixa_marcar', {
    p_tenant: f.tenant_id, p_categoria: f.categoria_id, p_chave: f.chave, p_nome: f.nome, p_acao: acao, p_dados: dados,
  });
  if (error) throw new Error(error.message);
}

/** Categoria do DRE "acontece todo mês" (fin_dre_categories.todo_mes) — pelo financial-write, como a tela de categorias. */
export async function marcarTodoMes(tenantId: string, categoriaId: string, todoMes: boolean): Promise<void> {
  const { data, error } = await invokeWithAuth<{ error?: string }>('financial-write', {
    body: { action: 'upsert_dre_category', tenant_id: tenantId, payload: { id: categoriaId, todo_mes: todoMes } },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(String(data.error));
}

export interface CategoriaDre { id: string; nome: string; parent_id: string | null; todo_mes: boolean; group_type: string }
export async function categoriasDaLoja(tenantId: string): Promise<CategoriaDre[]> {
  const { data, error } = await supabase.from('fin_dre_categories')
    .select('id, name, parent_id, todo_mes, group_type')
    .eq('tenant_id', tenantId).is('deleted_at', null).eq('is_active', true).order('name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; name: string; parent_id: string | null; todo_mes: boolean; group_type: string }>)
    .filter((c) => c.group_type !== 'revenue')
    .map((c) => ({ id: c.id, nome: c.name, parent_id: c.parent_id, todo_mes: !!c.todo_mes, group_type: c.group_type }));
}

/** Dia de pagar da semana (só o dono; null = sem dia). */
export async function lerDiaDePagar(): Promise<number | null> {
  const d = await chamarAssistente<{ dia_de_pagar?: number | null }>('pagamentos_config');
  return Number.isInteger(d?.dia_de_pagar) ? Number(d.dia_de_pagar) : null;
}
export async function salvarDiaDePagar(dia: number | null): Promise<void> {
  await chamarAssistente('pagamentos_config', { dia_de_pagar: dia });
}
