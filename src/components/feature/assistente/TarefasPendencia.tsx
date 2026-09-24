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
  priority?: number | null;
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
  // Filtros da tela "Minhas tarefas" (dono, 2026-09-24). Só sem loja: dentro da pendência de uma
  // loja a lista é curta e já vem filtrada.
  const [busca, setBusca] = useState('');
  const [prazo, setPrazo] = useState<'todas' | 'atrasadas' | 'hoje'>('todas');
  const [quem, setQuem] = useState<'todas' | 'comigo' | 'passei'>('todas');
  const [soAlta, setSoAlta] = useState(false);
  const [pasta, setPasta] = useState('');

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
  const agora = Date.now();
  const atrasada = (t: TarefaVencida) => (t.due_date ? new Date(t.due_date).getTime() < agora : false);
  const comigo = (t: TarefaVencida) => !meuId || t.assignee_id === meuId;
  const passei = (t: TarefaVencida) => !!meuId && t.created_by === meuId && !!t.assignee_id && t.assignee_id !== meuId;
  const alta = (t: TarefaVencida) => Number(t.priority ?? 0) >= 3;
  const termo = busca.trim().toLowerCase();
  // Cada filtro conta sobre o resultado dos OUTROS, para o número bater com o que aparece ao tocar.
  const passa = (t: TarefaVencida, sem?: 'prazo' | 'quem' | 'alta' | 'pasta') =>
    (sem === 'prazo' || prazo === 'todas' || (prazo === 'atrasadas' ? atrasada(t) : !atrasada(t)))
    && (sem === 'quem' || quem === 'todas' || (quem === 'comigo' ? comigo(t) : passei(t)))
    && (sem === 'alta' || !soAlta || alta(t))
    && (sem === 'pasta' || !pasta || t.list_name === pasta)
    && (!termo || t.title.toLowerCase().includes(termo) || (t.assignee_name ?? '').toLowerCase().includes(termo));
  const conta = (f: (t: TarefaVencida) => boolean, sem: 'prazo' | 'quem' | 'alta' | 'pasta') => tarefas.filter((t) => passa(t, sem) && f(t)).length;
  const pastas = [...new Set(tarefas.map((t) => t.list_name).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const visiveis = tenantId ? tarefas : tarefas.filter((t) => passa(t));
  const filtrando = prazo !== 'todas' || quem !== 'todas' || soAlta || !!pasta || !!termo;
  const chip = (ativo: boolean) => `h-7 px-2.5 flex-shrink-0 flex items-center gap-1 rounded-full text-xs font-bold whitespace-nowrap cursor-pointer ${ativo ? 'bg-violet-600 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`;

  return (
    <div className="mt-2.5 space-y-1.5">
      {!tenantId && tarefas.length > 1 && (
        <div className="space-y-2 pb-1.5">
          <div className="flex gap-1.5">
            <label className="relative flex-1 min-w-0">
              <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar tarefa ou pessoa"
                className="w-full h-9 pl-8 pr-2 rounded-xl border border-zinc-200 bg-white text-sm focus:outline-none focus:border-violet-400" />
            </label>
            {pastas.length > 1 && (
              <select value={pasta} onChange={(e) => setPasta(e.target.value)} aria-label="Pasta"
                className="w-[38%] h-9 px-2 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-700 truncate focus:outline-none focus:border-violet-400">
                <option value="">Todas as pastas</option>
                {pastas.map((n) => <option key={n} value={n}>{n} · {conta((t) => t.list_name === n, 'pasta')}</option>)}
              </select>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button onClick={() => setPrazo((x) => (x === 'atrasadas' ? 'todas' : 'atrasadas'))} className={chip(prazo === 'atrasadas')}>
              <i className="ri-alarm-warning-line" /> Atrasadas · {conta(atrasada, 'prazo')}
            </button>
            <button onClick={() => setPrazo((x) => (x === 'hoje' ? 'todas' : 'hoje'))} className={chip(prazo === 'hoje')}>
              <i className="ri-calendar-event-line" /> Hoje · {conta((t) => !atrasada(t), 'prazo')}
            </button>
            <button onClick={() => setQuem((x) => (x === 'comigo' ? 'todas' : 'comigo'))} className={chip(quem === 'comigo')}>
              <i className="ri-user-line" /> Comigo · {conta(comigo, 'quem')}
            </button>
            <button onClick={() => setQuem((x) => (x === 'passei' ? 'todas' : 'passei'))} className={chip(quem === 'passei')}>
              <i className="ri-share-forward-line" /> Passei · {conta(passei, 'quem')}
            </button>
            <button onClick={() => setSoAlta((x) => !x)} className={chip(soAlta)}>
              <i className="ri-fire-line" /> Alta/urgente · {conta(alta, 'alta')}
            </button>
          </div>
          {filtrando && (
            <p className="flex items-center justify-between text-[11px] text-zinc-500">
              <span>{visiveis.length} de {tarefas.length}</span>
              <button onClick={() => { setPrazo('todas'); setQuem('todas'); setSoAlta(false); setPasta(''); setBusca(''); }} className="font-bold text-violet-700 cursor-pointer">Limpar filtros</button>
            </p>
          )}
        </div>
      )}
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!tarefas.length && !erro && <p className="text-xs font-semibold text-emerald-700"><i className="ri-check-line" /> {tenantId ? 'Nenhuma tarefa vencida.' : 'Nenhuma tarefa vencida ou para hoje.'}</p>}
      {tarefas.length > 0 && !visiveis.length && <p className="text-xs text-zinc-500 text-center py-4">Nenhuma tarefa com esses filtros.</p>}
      {visiveis.map((t) => {
        const venceu = atrasada(t);
        const prio = Number(t.priority ?? 0) >= 3 ? PRIORIDADES.find((p) => p.value === Number(t.priority)) : null;
        return (
        <div key={t.id} className={`rounded-xl border bg-zinc-50 ${aberta === t.id ? 'border-violet-300 bg-white' : 'border-zinc-200'}`}>
          <button onClick={() => setAberta((x) => (x === t.id ? null : t.id))} className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left cursor-pointer" aria-expanded={aberta === t.id}>
            <i className="ri-checkbox-blank-circle-line text-amber-500 mt-0.5" />
            <span className="flex-1 min-w-0">
              {/* Título INTEIRO (pedido do dono): quebra linha, nunca corta. */}
              <span className="block text-sm font-semibold text-zinc-800 whitespace-normal break-words">
                {prio && <span className="mr-1 px-1.5 rounded text-[10px] font-bold text-white align-middle" style={{ backgroundColor: prio.color }}>{prio.label}</span>}
                {t.title}
              </span>
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
