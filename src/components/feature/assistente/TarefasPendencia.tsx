// Tarefas vencidas dentro da caixa de pendências do chat (2026-09-18, pedido do dono): resolver
// quase tudo ali, sem abrir o módulo — título inteiro, e ao tocar a tarefa abre com status (menu),
// prazo, prioridade, responsável, descrição, checklist e comentários. "Abrir na tela" continua lá
// para o resto (anexos, campos personalizados, subtarefas).
//
// Mesmo caminho do módulo: leitura por fn_get_task_detail / fn_get_task_lists e escrita pela Edge
// task-write com active_tenant_id = loja da pendência (ela confere se você é membro), então funciona
// com outra loja selecionada no ERPOS.
//
// Sem tenantId (aba Tarefas da caixa, 2026-09-18): TODAS as minhas tarefas — vencidas e de hoje — de
// qualquer loja. O módulo de tarefas é por pessoa (user_module_access), a loja é só onde a tarefa mora;
// a RLS de tasks já entrega só o que eu criei ou sou responsável.
import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { PRIORIDADES, type TaskDetail, type TaskList, type TaskStatus } from '@/pages/tarefas/hooks/useTarefas';

interface TarefaVencida {
  id: string; title: string; due_date: string | null; assignee_name: string | null; list_name: string | null;
  list_id: string; completed_at: string | null; assignee_id: string | null; created_by: string | null;
  status_category: TaskStatus['category'] | null;
  tenant_id: string; // loja onde a tarefa mora (preenchido aqui; escrita/leitura vão por ela)
}

const fimDeHoje = () => {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${hoje}T23:59:59-03:00`).getTime();
};

// Minhas tarefas abertas que venceram ou vencem hoje, de qualquer loja (RLS: criei ou sou o responsável).
export async function minhasTarefasPendentes(meuId: string | null): Promise<Array<{ id: string; tenant_id: string }>> {
  if (!meuId) return [];
  const { data, error } = await supabase.from('tasks').select('id, tenant_id')
    .is('completed_at', null).eq('is_archived', false).not('due_date', 'is', null)
    .lte('due_date', new Date(fimDeHoje()).toISOString())
    .or(`created_by.eq.${meuId},assignee_id.eq.${meuId}`).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; tenant_id: string }>;
}

// Tarefa compartilhada comigo mora numa lista de outra pessoa (não vem em fn_get_task_lists): aí o
// menu é por categoria, que a task-write resolve para o status certo da lista.
const CATEGORIAS: Array<{ key: TaskStatus['category']; label: string }> = [
  { key: 'backlog', label: 'Backlog' }, { key: 'todo', label: 'A fazer' }, { key: 'in_progress', label: 'Em andamento' },
  { key: 'done', label: 'Concluída' }, { key: 'cancelled', label: 'Cancelada' },
];

const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function escrever(tenantId: string, action: string, payload: Record<string, unknown>) {
  const { data: out, error } = await invokeWithAuth<{ success?: boolean; error?: string }>('task-write', {
    body: { action, active_tenant_id: tenantId, ...payload },
  });
  if (error || !out?.success) throw new Error(out?.error || error?.message || 'Não foi possível salvar.');
}

export default function TarefasPendencia({ tenantId, meuId, onAbrir, onMudou: avisar }: {
  tenantId?: string; meuId: string | null; onAbrir: (tenantId: string, id: string) => void; onMudou?: () => void;
}) {
  const [tarefas, setTarefas] = useState<TarefaVencida[] | null>(null);
  const [listas, setListas] = useState<TaskList[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    let lojas: string[] = tenantId ? [tenantId] : [];
    if (!tenantId) {
      try { lojas = [...new Set((await minhasTarefasPendentes(meuId)).map((x) => x.tenant_id))]; }
      catch (e) { setErro(e instanceof Error ? e.message : String(e)); setTarefas([]); return; }
    }
    const res = await Promise.all(lojas.map(async (tid) => {
      const [t, l] = await Promise.all([
        supabase.rpc('fn_get_tasks', { p_tenant_id: tid }),
        supabase.rpc('fn_get_task_lists', { p_tenant_id: tid }),
      ]);
      return { tid, t, l };
    }));
    const falha = res.find((r) => r.t.error);
    if (falha && res.length === 1) { setErro(falha.t.error!.message); setTarefas([]); return; }
    setErro(null);
    setListas(res.flatMap((r) => (r.l.data as TaskList[]) ?? []));
    // Com loja: só as vencidas (pendência "tarefas vencidas" daquela loja). Sem loja: vencidas e de hoje.
    const limite = tenantId ? Date.now() : fimDeHoje();
    setTarefas(res.flatMap((r) => ((r.t.data ?? []) as TarefaVencida[]).map((x) => ({ ...x, tenant_id: r.tid })))
      .filter((x) => !x.completed_at && x.due_date && new Date(x.due_date).getTime() <= limite)
      .filter((x) => !meuId || x.assignee_id === meuId || x.created_by === meuId)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))));
  }, [tenantId, meuId]);

  const mudou = useCallback(async () => { await carregar(); avisar?.(); }, [carregar, avisar]);

  useEffect(() => { carregar(); }, [carregar]);

  if (tarefas === null) return <p className="mt-2.5 text-xs text-zinc-500">Carregando tarefas…</p>;
  return (
    <div className="mt-2.5 space-y-1.5">
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!tarefas.length && !erro && <p className="text-xs font-semibold text-emerald-700"><i className="ri-check-line" /> {tenantId ? 'Nenhuma tarefa vencida.' : 'Nenhuma tarefa vencida ou para hoje.'}</p>}
      {tarefas.map((t) => {
        const venceu = t.due_date ? new Date(t.due_date).getTime() < Date.now() : false;
        return (
        <div key={t.id} className={`rounded-xl border bg-zinc-50 ${aberta === t.id ? 'border-violet-300 bg-white' : 'border-zinc-200'}`}>
          <button onClick={() => setAberta((x) => (x === t.id ? null : t.id))} className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left cursor-pointer" aria-expanded={aberta === t.id}>
            <i className="ri-checkbox-blank-circle-line text-amber-500 mt-0.5" />
            <span className="flex-1 min-w-0">
              {/* Título INTEIRO (pedido do dono): quebra linha, nunca corta. */}
              <span className="block text-sm font-semibold text-zinc-800 whitespace-normal break-words">{t.title}</span>
              <span className={`block text-[11px] mt-0.5 ${venceu ? 'text-red-600' : 'text-amber-700'}`}>
                {venceu ? `venceu ${data(t.due_date)}` : 'vence hoje'}{t.assignee_name ? ` · ${t.assignee_name}` : ''}{t.list_name ? ` · ${t.list_name}` : ''}
              </span>
            </span>
            <i className={`ri-arrow-${aberta === t.id ? 'up' : 'down'}-s-line text-zinc-400 mt-0.5`} />
          </button>
          {aberta === t.id && (
            <DetalheTarefa
              tenantId={t.tenant_id}
              tarefa={t}
              statuses={listas.find((l) => l.id === t.list_id)?.statuses ?? null}
              onAbrir={() => onAbrir(t.tenant_id, t.id)}
              onMudou={mudou}
            />
          )}
        </div>
        );
      })}
    </div>
  );
}

function DetalheTarefa({ tenantId, tarefa, statuses, onAbrir, onMudou }: {
  tenantId: string; tarefa: TarefaVencida; statuses: TaskStatus[] | null; onAbrir: () => void; onMudou: () => Promise<void>;
}) {
  const [det, setDet] = useState<TaskDetail | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [comentario, setComentario] = useState('');

  const ler = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('fn_get_task_detail', { p_tenant_id: tenantId, p_task_id: tarefa.id });
    if (error) setErro(error.message); else setDet(d as TaskDetail);
  }, [tenantId, tarefa.id]);
  useEffect(() => { ler(); }, [ler]);

  const salvar = async (action: string, payload: Record<string, unknown>, recarregarLista = false) => {
    setSalvando(true); setErro(null);
    try {
      await escrever(tenantId, action, payload);
      await ler();
      if (recarregarLista) await onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSalvando(false); }
  };

  if (!det) return <p className="px-3 pb-3 text-xs text-zinc-500">{erro ?? 'Carregando…'}</p>;
  const prio = PRIORIDADES.find((p) => p.value === det.priority);
  const feitos = det.checklist.filter((c) => c.is_done).length;

  return (
    <div className="px-3 pb-3 space-y-3 border-t border-zinc-100 pt-2.5">
      {erro && <p className="text-xs text-red-600">{erro}</p>}

      {/* Status (menu) e prazo: o que resolve uma tarefa vencida sem sair daqui */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] font-semibold text-zinc-500 mb-0.5">Status</span>
          {statuses?.length ? (
            <select value={det.status_id ?? ''} disabled={salvando}
              onChange={(e) => salvar('update_task', { task_id: det.id, status_id: e.target.value }, true)}
              className="w-full h-9 px-2 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-violet-400">
              {[...statuses].sort((a, b) => a.sort_order - b.sort_order).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <select value={tarefa.status_category ?? ''} disabled={salvando}
              onChange={(e) => salvar('update_task', { task_id: det.id, status_category: e.target.value }, true)}
              className="w-full h-9 px-2 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-violet-400">
              {!tarefa.status_category && <option value="">—</option>}
              {CATEGORIAS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          )}
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-zinc-500 mb-0.5">Prazo</span>
          <input type="date" value={(det.due_date ?? '').slice(0, 10)} disabled={salvando}
            onChange={(e) => e.target.value && salvar('update_task', { task_id: det.id, due_date: e.target.value, due_has_time: false }, true)}
            className="w-full h-9 px-2 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-violet-400" />
        </label>
      </div>

      <p className="text-[11px] text-zinc-500">
        {prio && <span className="font-semibold" style={{ color: prio.color }}>{prio.label}</span>}
        {det.assignee_name ? ` · Responsável: ${det.assignee_name}` : ' · Sem responsável'}
        {det.created_by_name ? ` · Criada por ${det.created_by_name}` : ''}
        {det.subtasks?.length ? ` · ${det.subtasks.length} subtarefa${det.subtasks.length > 1 ? 's' : ''}` : ''}
      </p>

      {det.description && (
        <p className="text-sm text-zinc-700 whitespace-pre-wrap break-words rounded-lg bg-zinc-50 px-2.5 py-2">{det.description}</p>
      )}

      {det.checklist.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-zinc-500 mb-1">Checklist · {feitos}/{det.checklist.length}</p>
          <div className="space-y-1">
            {[...det.checklist].sort((a, b) => a.sort_order - b.sort_order).map((c) => (
              <label key={c.id} className="flex items-start gap-2 text-sm text-zinc-700 cursor-pointer">
                <input type="checkbox" checked={c.is_done} disabled={salvando} className="mt-1 accent-violet-600"
                  onChange={(e) => salvar('update_checklist_item', { item_id: c.id, is_done: e.target.checked })} />
                <span className={`break-words ${c.is_done ? 'line-through text-zinc-400' : ''}`}>{c.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold text-zinc-500 mb-1">Comentários{det.comments.length ? ` · ${det.comments.length}` : ''}</p>
        {det.comments.slice(-3).map((c) => (
          <p key={c.id} className="text-xs text-zinc-700 mb-1 break-words">
            <span className="font-semibold">{c.user_name ?? 'Alguém'}</span> <span className="text-zinc-400">{hora(c.created_at)}</span><br />{c.body}
          </p>
        ))}
        <form className="flex gap-1.5 mt-1" onSubmit={(e) => {
          e.preventDefault();
          const txt = comentario.trim();
          if (!txt) return;
          salvar('add_comment', { task_id: det.id, body: txt }).then(() => setComentario(''));
        }}>
          <input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentar…"
            className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-violet-400" />
          <button type="submit" disabled={salvando || !comentario.trim()} className="px-3 h-9 rounded-lg bg-violet-600 text-white text-sm font-bold disabled:opacity-40 cursor-pointer">
            <i className="ri-send-plane-2-fill" />
          </button>
        </form>
      </div>

      <button onClick={onAbrir} className="w-full h-9 rounded-xl border border-violet-200 text-violet-700 text-sm font-bold hover:bg-violet-50 cursor-pointer">
        <i className="ri-arrow-right-up-line" /> Abrir a tarefa na tela
      </button>
    </div>
  );
}
