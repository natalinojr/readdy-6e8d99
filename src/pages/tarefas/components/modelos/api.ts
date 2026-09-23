import { supabase, invokeWithAuth } from '@/lib/supabase';
import type { ModeloConteudo, OpcoesModelo, ResumoModelo } from '../../lib/modeloEstrutura';
import { normalizarOpcoes } from '../../lib/modeloEstrutura';

export interface VersaoModelo {
  id: string;
  version: number;
  name: string;
  created_at: string;
}

export interface ModeloEstrutura {
  id: string;
  name: string;
  description: string | null;
  content: ModeloConteudo;
  options: OpcoesModelo;
  source_list_id: string | null;
  /** Nome da pasta de origem, se ela ainda existir. */
  source_list_name: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  versions: VersaoModelo[];
}

/** Modelos da pessoa (não depende da loja: são pessoais, como as pastas). */
export async function carregarModelos(): Promise<ModeloEstrutura[]> {
  const { data, error } = await supabase.rpc('fn_get_task_structure_templates');
  if (error) throw error;
  return ((data as ModeloEstrutura[]) ?? []).map((m) => ({ ...m, options: normalizarOpcoes(m.options) }));
}

export interface RespostaModelos {
  success?: boolean;
  error?: string;
  id?: string;
  content?: ModeloConteudo;
  resumo?: ResumoModelo;
  lists?: Record<string, string>;
  exibicao?: Record<string, unknown>;
}

export async function chamarModelos(
  tenantId: string | null,
  action: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; data: RespostaModelos } | { ok: false; error: string }> {
  // tenantId nulo = sem loja (Tarefas é por pessoa); o task-write decide o acesso.
  const { data, error } = await invokeWithAuth<RespostaModelos>('task-write', {
    body: { action, active_tenant_id: tenantId, ...payload },
  });
  if (error || !data?.success) return { ok: false, error: data?.error ?? error?.message ?? 'Erro desconhecido' };
  return { ok: true, data };
}

/** "3 pastas · 12 tarefas · 4 subtarefas · cronograma de 30 dias" */
export function textoResumo(r: ResumoModelo): string {
  const p = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const partes = [p(r.pastas, 'pasta', 'pastas')];
  if (r.tarefas) partes.push(p(r.tarefas, 'tarefa', 'tarefas'));
  if (r.subtarefas) partes.push(p(r.subtarefas, 'subtarefa', 'subtarefas'));
  if (r.itens_checklist) partes.push(p(r.itens_checklist, 'item de checklist', 'itens de checklist'));
  if (r.ultimo_dia) partes.push(`cronograma de ${r.ultimo_dia + 1} dias`);
  return partes.join(' · ');
}
