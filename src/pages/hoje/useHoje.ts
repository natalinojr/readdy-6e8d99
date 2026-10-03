// Dados da tela Hoje (2026-10-03). As pendências vêm do hojeStore (a MESMA leitura do número do topo);
// aqui ficam o que é só da tela: as tarefas da pessoa que venceram ou vencem hoje e o que foi resolvido
// hoje (por ela, por outra pessoa ou SOZINHO pelo sistema). Sem realtime: confere a cada 60 s com a
// tela visível e ao voltar para a tela (é a tela inicial de todo gestor — leve de propósito; o banco
// já travou por IO em 2026-09-26).
import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { todayBrasilia } from '@/lib/dateUtils';
import { DONO_EMAIL } from '../../../supabase/functions/_shared/pendencia-visivel';
import { usePendenciasHoje } from './hojeStore';
import { visivelNaHoje } from './organizar';

export interface TarefaHoje {
  id: string; tenantId: string; titulo: string; prazo: string | null; temHora: boolean; prioridade: number | null;
  feita?: boolean;
}

/** quem: 'eu' | 'outra' (outra pessoa) | 'sistema' (fechou sozinho: boleto chegou, pagamento concluído…) */
export interface FeitaHoje { id: string; tenantId: string; loja: string; kind: string; titulo: string; status: string; motivo: string | null; quando: string; quem: 'eu' | 'outra' | 'sistema' }

const lojaDe = (r: unknown): string => {
  const t = (r as { tenants?: { name?: string } | { name?: string }[] | null }).tenants;
  return (Array.isArray(t) ? t[0]?.name : t?.name) ?? '';
};

const fimDeHoje = (hoje: string) => new Date(`${hoje}T23:59:59-03:00`).toISOString();

export function useHoje() {
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  const email = user?.email ?? null;
  const dono = email?.toLowerCase() === DONO_EMAIL;
  const store = usePendenciasHoje();
  const [tarefas, setTarefas] = useState<TarefaHoje[] | null>(null);
  const [feitas, setFeitas] = useState<FeitaHoje[]>([]);
  const [erroExtra, setErroExtra] = useState<string | null>(null);
  const papeis = store.papeis;

  const carregarExtras = useCallback(async () => {
    if (!meuId || !papeis) return;
    const dia = todayBrasilia();
    const visivel = (kind: string, tenantId: string) => visivelNaHoje(kind, papeis.get(tenantId), email, dono);
    const [tarefasR, feitasR] = await Promise.all([
      supabase.from('tasks').select('id, tenant_id, title, due_date, due_has_time, priority')
        .is('completed_at', null).eq('is_archived', false).not('due_date', 'is', null)
        .lte('due_date', fimDeHoje(dia))
        .or(`created_by.eq.${meuId},assignee_id.eq.${meuId}`)
        .order('due_date', { ascending: true }).limit(60),
      supabase.from('pendencias')
        .select('id, tenant_id, kind, titulo, status, motivo, resolvida_em, resolvida_por, tenants(name)')
        .in('status', ['resolvida', 'descartada']).gte('resolvida_em', `${dia}T00:00:00-03:00`)
        .order('resolvida_em', { ascending: false }).limit(60),
    ]);
    if (tarefasR.error) { setErroExtra(tarefasR.error.message); return; }
    setErroExtra(null);
    // Sem acesso a Tarefas a RLS devolve vazio — a seção some.
    setTarefas((prev) => {
      const novas = ((tarefasR.data ?? []) as Array<{ id: string; tenant_id: string; title: string; due_date: string | null; due_has_time: boolean | null; priority: number | null }>)
        .map((t) => ({ id: t.id, tenantId: t.tenant_id, titulo: t.title, prazo: t.due_date, temHora: !!t.due_has_time, prioridade: t.priority }));
      // As concluídas nesta tela continuam riscadas na lista (dá a sensação de andamento).
      const feitasAqui = (prev ?? []).filter((t) => t.feita && !novas.some((n) => n.id === t.id));
      return [...novas, ...feitasAqui];
    });
    setFeitas(((feitasR.data ?? []) as Array<{ id: string; tenant_id: string; kind: string; titulo: string; status: string; motivo: string | null; resolvida_em: string; resolvida_por: string | null }>)
      // "N tarefas vencidas" do cron abre e fecha sozinha: não é coisa que alguém resolveu.
      .filter((r) => r.kind !== 'tarefa_vencida' && visivel(r.kind, r.tenant_id))
      .map((r) => ({
        id: r.id, tenantId: r.tenant_id, loja: lojaDe(r), kind: r.kind, titulo: r.titulo, status: r.status, motivo: r.motivo, quando: r.resolvida_em,
        quem: r.resolvida_por === meuId ? 'eu' : r.resolvida_por || /^(aprovad|recusad|rejeitad|cancelad)\w* por /i.test(r.motivo ?? '') ? 'outra' : 'sistema',
      })));
  }, [meuId, email, dono, papeis]);

  useEffect(() => {
    carregarExtras();
    const t = setInterval(() => { if (!document.hidden) carregarExtras(); }, 60000);
    const voltou = () => { if (!document.hidden) carregarExtras(); };
    document.addEventListener('visibilitychange', voltou);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', voltou); };
  }, [carregarExtras]);

  const recarregar = useCallback(async () => {
    await store.recarregar();
    await carregarExtras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregarExtras, store.recarregar]);

  /** Conclui a tarefa pela mesma Edge do módulo (task-write, loja da tarefa). */
  const concluirTarefa = useCallback(async (t: TarefaHoje) => {
    setTarefas((l) => (l ?? []).map((x) => (x.id === t.id ? { ...x, feita: true } : x)));
    const { data, error } = await invokeWithAuth<{ success?: boolean; error?: string }>('task-write', {
      body: { action: 'update_task', active_tenant_id: t.tenantId, task_id: t.id, status_category: 'done' },
    });
    if (error || !data?.success) {
      setTarefas((l) => (l ?? []).map((x) => (x.id === t.id ? { ...x, feita: false } : x)));
      throw new Error(data?.error || error?.message || 'Não consegui concluir a tarefa.');
    }
  }, []);

  /** Ciente / Não vou fazer / Resolvida: a mesma RPC da caixa de pendências. */
  const marcar = useCallback(async (id: string, acao: 'vista' | 'descartada' | 'resolvida' | 'reabrir', motivo?: string) => {
    const { error } = await supabase.rpc('fn_pendencia_marcar', { p_id: id, p_acao: acao, p_motivo: motivo ?? null });
    if (error) throw new Error(error.message);
    await recarregar();
  }, [recarregar]);

  /** Papel da pessoa na loja (para os botões de cada cartão). */
  const papelDe = useCallback((tenantId: string) => papeis?.get(tenantId) ?? (tenantId === user?.tenantId ? user?.perfil : undefined), [papeis, user?.tenantId, user?.perfil]);

  /** Quantas lojas a pessoa tem (mostrar o nome da loja nos cartões). */
  const nLojas = papeis?.size ?? 1;

  return {
    itens: store.itens, tarefas, feitas, erro: store.erro ?? erroExtra, hoje: store.hoje, recarregar, concluirTarefa, marcar,
    papelDe, nLojas, dono, carregando: store.pendencias === null,
  };
}
