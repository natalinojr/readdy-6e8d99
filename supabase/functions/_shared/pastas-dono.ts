// Pastas de Tarefas do dono, como o assistente as enxerga (2026-10-02/03).
// Usado pelo assistente-brain (criar_tarefa, ajustar_tarefa, listar_pastas, configurar_grupo) e pelo
// assistente-webhook (pergunta "pasta do grupo?" quando o número do assistente entra num grupo).
// "caminho" = Pai › Filho, porque o mesmo nome aparece em pastas diferentes (ex.: "Compras" em duas lojas).
// Mudar aqui exige redeploy das duas Edges.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

export type PastaDono = { id: string; name: string; tenant_id: string | null; caminho: string };

export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function pastasDoDono(admin: SupabaseClient, ownerId: string): Promise<PastaDono[]> {
  const { data, error } = await admin.from('task_lists').select('id, name, parent_list_id, tenant_id')
    .eq('created_by', ownerId).eq('is_archived', false).limit(500);
  if (error) throw new Error(error.message);
  // deno-lint-ignore no-explicit-any
  const rows = (data ?? []) as any[];
  const porId = new Map(rows.map((r) => [r.id as string, r]));
  const caminho = (r: { name: string; parent_list_id: string | null }) => {
    const partes = [String(r.name)];
    let pai = r.parent_list_id ? porId.get(r.parent_list_id) : null;
    for (let i = 0; pai && i < 10; i++) { partes.unshift(String(pai.name)); pai = pai.parent_list_id ? porId.get(pai.parent_list_id) : null; }
    return partes.join(' › ');
  };
  return rows.map((r) => ({ id: r.id, name: String(r.name), tenant_id: r.tenant_id ?? null, caminho: caminho(r) }));
}

// Mais usadas primeiro: tarefas que ele criou nos últimos 60 dias em cada pasta; empate = ordem alfabética.
export async function pastasMaisUsadas(admin: SupabaseClient, ownerId: string): Promise<Array<PastaDono & { tarefas_60d: number }>> {
  const pastas = await pastasDoDono(admin, ownerId);
  const desde = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data: usos } = await admin.from('tasks').select('list_id')
    .eq('created_by', ownerId).gte('created_at', desde).limit(2000);
  const conta = new Map<string, number>();
  for (const u of usos ?? []) conta.set(u.list_id, (conta.get(u.list_id) ?? 0) + 1);
  return pastas.map((p) => ({ ...p, tarefas_60d: conta.get(p.id) ?? 0 }))
    .sort((a, b) => b.tarefas_60d - a.tarefas_60d || a.caminho.localeCompare(b.caminho, 'pt-BR'));
}

// Caminho exato > nome exato > pedaço do nome > pedaço do caminho. Mais de uma = ambígua (pergunta ao dono).
export function resolverPasta(pastas: PastaDono[], pedido: string): { pasta?: PastaDono; opcoes: string[] } {
  const q = semAcento(pedido.replace(/\s*[/>]\s*/g, ' › '));
  const cam = (p: PastaDono) => semAcento(p.caminho);
  const nome = (p: PastaDono) => semAcento(p.name);
  for (const teste of [(p: PastaDono) => cam(p) === q, (p: PastaDono) => nome(p) === q, (p: PastaDono) => nome(p).includes(q), (p: PastaDono) => cam(p).includes(q)]) {
    const achou = pastas.filter(teste);
    if (achou.length === 1) return { pasta: achou[0], opcoes: [] };
    if (achou.length > 1) return { opcoes: achou.map((p) => p.caminho).slice(0, 12) };
  }
  return { opcoes: [] };
}
