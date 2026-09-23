// Peças comuns das ações rápidas de TAREFAS (2026-09-23). Mesmo caminho da tela Tarefas:
// leitura por RPC fn_get_tasks / fn_get_task_detail / fn_get_users_list / fn_get_task_capacities e
// gravação pela Edge task-write (sempre com invokeUmaVez — gravação nunca repete).
//
// Visibilidade: fn_get_tasks devolve as tarefas das pastas que eu acesso (minhas + compartilhadas
// comigo, task_list_shares) e as que estão comigo. "Da equipe" aqui é sempre esse alcance.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { Opcao, OpcaoNeutra, dataBR, horaBR, invokeUmaVez, somaDias } from '../kit';

export const COR_TAREFAS = 'bg-indigo-50 text-indigo-600';

export const aberta = (t: TaskRow) => t.status_category !== 'done' && t.status_category !== 'cancelled';

/** Tarefas abertas (e não arquivadas) da loja ativa que eu enxergo. `incluirConcluidas` traz também as fechadas (Carga). */
export async function carregarTarefas(tenantId: string, incluirConcluidas = false): Promise<{ tarefas: TaskRow[]; erro: string | null }> {
  const { data, error } = await supabase.rpc('fn_get_tasks', { p_tenant_id: tenantId });
  if (error) return { tarefas: [], erro: error.message };
  const todas = (data as TaskRow[]) ?? [];
  return { tarefas: incluirConcluidas ? todas : todas.filter(aberta), erro: null };
}

export interface Pessoa { id: string; nome: string }

/** Equipe ativa da loja (mesma lista do seletor de responsável da tela Tarefas). */
export async function carregarEquipe(tenantId: string): Promise<{ pessoas: Pessoa[]; erro: string | null }> {
  const { data, error } = await supabase.rpc('fn_get_users_list', { p_tenant_id: tenantId });
  if (error) return { pessoas: [], erro: error.message };
  const pessoas = ((data as Array<{ id: string; nome: string; ativo: boolean }>) ?? [])
    .filter((u) => u.ativo)
    .map((u) => ({ id: u.id, nome: u.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { pessoas, erro: null };
}

/** Dia do prazo em Brasília (YYYY-MM-DD) ou null. */
export const diaPrazo = (t: TaskRow) => (t.due_date ? dateKeyBrasilia(t.due_date) : null);
export const atrasada = (t: TaskRow) => { const d = diaPrazo(t); return !!d && d < todayBrasilia(); };
export const venceHoje = (t: TaskRow) => diaPrazo(t) === todayBrasilia();

/** "atrasada · 20/09", "hoje 14:00", "amanhã", "25/09", "sem prazo". */
export function rotuloPrazo(t: TaskRow): string {
  const d = diaPrazo(t);
  if (!d) return 'sem prazo';
  const hoje = todayBrasilia();
  const hora = t.due_has_time ? ` ${horaBR(t.due_date)}` : '';
  if (d < hoje) return `atrasada · ${dataBR(d)}`;
  if (d === hoje) return `hoje${hora}`;
  if (d === somaDias(hoje, 1)) return `amanhã${hora}`;
  return `${dataBR(d)}${hora}`;
}

/** Ordem padrão: atrasadas e mais antigas primeiro, sem prazo por último; empate = prioridade maior. */
export function ordenarPorPrazo(lista: TaskRow[]): TaskRow[] {
  return [...lista].sort((a, b) => {
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });
}

/** Minhas = sou o responsável, ou criei e ninguém é responsável (igual à visão "Minhas"). */
export const minha = (t: TaskRow, meuId: string) => t.assignee_id === meuId || (!t.assignee_id && t.created_by === meuId);

/** Prazo novo mantendo o horário, se a tarefa tinha: mesmo formato do TaskDrawer (sem hora = 12:00Z). */
export function novoPrazo(t: Pick<TaskRow, 'due_date' | 'due_has_time'>, dia: string): { due_date: string; due_has_time: boolean } {
  if (t.due_has_time && t.due_date) return { due_date: `${dia}T${horaBR(t.due_date)}:00-03:00`, due_has_time: true };
  return { due_date: `${dia}T12:00:00Z`, due_has_time: false };
}

/** Próxima segunda-feira (nunca hoje). */
export function proximaSegunda(): string {
  const hoje = todayBrasilia();
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return somaDias(hoje, ((8 - dow) % 7) || 7);
}

type Resposta = { success?: boolean; error?: string } & Record<string, unknown>;

/** Uma gravação na task-write. Devolve a mensagem de erro (ou null se deu certo) e o retorno. */
export async function gravarTarefa<T extends Resposta = Resposta>(tenantId: string, action: string, corpo: Record<string, unknown>): Promise<{ erro: string | null; data: T | null }> {
  const { data, error } = await invokeUmaVez<T>('task-write', { body: { action, active_tenant_id: tenantId, ...corpo } });
  if (error || !data?.success) return { erro: data?.error ?? error?.message ?? 'erro desconhecido', data };
  return { erro: null, data };
}

/** Botão de uma tarefa na lista: título + (prazo · pasta · responsável). */
export function OpcaoTarefa({ t, onClick, mostrarResponsavel, extra, icone = 'ri-checkbox-blank-circle-line' }: {
  t: TaskRow; onClick: () => void; mostrarResponsavel?: boolean; extra?: string; icone?: string;
}) {
  const partes = [rotuloPrazo(t), t.list_name, mostrarResponsavel ? (t.assignee_name ?? 'sem responsável') : null, extra].filter(Boolean);
  return (
    <Opcao onClick={onClick} detalhe={`(${partes.join(' · ')})`}>
      <i className={`${icone} mr-1.5 ${atrasada(t) ? 'text-red-500' : ''}`} />{t.title}
    </Opcao>
  );
}

/** Campo de busca para listas grandes de tarefas — use só com mais de 8 itens. */
export function BuscaTarefa({ valor, onMudar }: { valor: string; onMudar: (v: string) => void }) {
  return (
    <div className="relative">
      <i className="ri-search-line absolute left-3 top-2.5 text-zinc-400" />
      <input value={valor} onChange={(e) => onMudar(e.target.value)} placeholder="Procurar tarefa…" aria-label="Procurar tarefa" autoComplete="off"
        className="w-full h-9 pl-8 pr-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-400" />
    </div>
  );
}

export const filtrarPorTexto = (lista: TaskRow[], termo: string) => {
  const n = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = n(termo.trim());
  return q ? lista.filter((t) => n(`${t.title} ${t.list_name ?? ''} ${t.assignee_name ?? ''}`).includes(q)) : lista;
};

/**
 * Escolher uma tarefa em dois passos: primeiro a PASTA, depois a tarefa dela
 * (pedido do dono, 2026-09-23 — lista única de tarefas de todas as pastas era
 * difícil de achar). Uma pasta só = vai direto pras tarefas. Com mais de 8
 * tarefas aparece a busca, que procura em todas as pastas de uma vez.
 * `renderTarefa` desenha cada tarefa do jeito da ação (extra, ícone, responsável).
 */
export function ListaPorPasta({ tarefas, renderTarefa }: {
  tarefas: TaskRow[];
  renderTarefa: (t: TaskRow) => ReactNode;
}) {
  const [pastaId, setPastaId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const pastas = new Map<string, { id: string; nome: string; cor: string; total: number; atrasadas: number }>();
  for (const t of tarefas) {
    const p = pastas.get(t.list_id) ?? { id: t.list_id, nome: t.list_name ?? 'Pasta', cor: t.list_color ?? '#94a3b8', total: 0, atrasadas: 0 };
    p.total += 1;
    if (atrasada(t)) p.atrasadas += 1;
    pastas.set(t.list_id, p);
  }
  const listaPastas = [...pastas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const buscando = busca.trim() !== '';
  const umaPasta = listaPastas.length <= 1;
  const pastaAtual = pastaId ? pastas.get(pastaId) ?? null : null;

  // Buscando: tarefas de todas as pastas que batem com o texto.
  if (buscando) {
    const achadas = filtrarPorTexto(tarefas, busca);
    return (
      <>
        <BuscaTarefa valor={busca} onMudar={setBusca} />
        {achadas.map((t) => <div key={t.id}>{renderTarefa(t)}</div>)}
        {!achadas.length && <p className="px-1 text-xs text-zinc-500">Nenhuma tarefa com esse nome.</p>}
      </>
    );
  }

  if (!umaPasta && !pastaAtual) {
    return (
      <>
        {tarefas.length > 8 && <BuscaTarefa valor={busca} onMudar={setBusca} />}
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Escolha a pasta</p>
        {listaPastas.map((p) => (
          <Opcao
            key={p.id}
            onClick={() => setPastaId(p.id)}
            detalhe={`(${p.total} tarefa${p.total > 1 ? 's' : ''}${p.atrasadas ? ` · ${p.atrasadas} atrasada${p.atrasadas > 1 ? 's' : ''}` : ''})`}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ backgroundColor: p.cor }} />
            {p.nome}
          </Opcao>
        ))}
      </>
    );
  }

  const daPasta = pastaAtual ? tarefas.filter((t) => t.list_id === pastaAtual.id) : tarefas;
  return (
    <>
      {pastaAtual && !umaPasta && (
        <>
          <OpcaoNeutra onClick={() => setPastaId(null)}>← Outra pasta</OpcaoNeutra>
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: pastaAtual.cor }} />
            {pastaAtual.nome}
          </p>
        </>
      )}
      {umaPasta && tarefas.length > 8 && <BuscaTarefa valor={busca} onMudar={setBusca} />}
      {daPasta.map((t) => <div key={t.id}>{renderTarefa(t)}</div>)}
    </>
  );
}
