// Dados da tela Hoje (2026-10-03): pendências de TODAS as lojas da pessoa (a RLS de `pendencias` já
// entrega só as lojas em que ela está), filtradas pelo papel dela em cada loja (a mesma regra da caixa
// de pendências: pendenciaVisivelPara), + as tarefas dela que venceram ou vencem hoje + o que foi
// resolvido hoje. Sem realtime: confere a cada 60 s com a tela visível e ao voltar para a tela (é a
// tela inicial de todo gestor — leve de propósito; o banco já travou por IO em 2026-09-26).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth, DB_TO_FRONTEND_ROLE } from '@/contexts/AuthContext';
import { pendenciaVisivelPara } from '@/contexts/PendenciasContext';
import { todayBrasilia } from '@/lib/dateUtils';
import { ASSISTENTE_OWNER_EMAIL } from '@/components/feature/AssistenteChat';
import { organizarHoje, type ItemHoje, type PendHoje } from './organizar';

export interface TarefaHoje {
  id: string; tenantId: string; titulo: string; prazo: string | null; temHora: boolean; prioridade: number | null;
  feita?: boolean;
}

export interface FeitaHoje { id: string; tenantId: string; loja: string; kind: string; titulo: string; status: string; motivo: string | null; quando: string }

const lojaDe = (r: unknown): string => {
  const t = (r as { tenants?: { name?: string } | { name?: string }[] | null }).tenants;
  return (Array.isArray(t) ? t[0]?.name : t?.name) ?? '';
};

const fimDeHoje = (hoje: string) => new Date(`${hoje}T23:59:59-03:00`).toISOString();

export function useHoje() {
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  const email = user?.email ?? null;
  const dono = email?.toLowerCase() === ASSISTENTE_OWNER_EMAIL;
  const [pendencias, setPendencias] = useState<PendHoje[] | null>(null);
  const [tarefas, setTarefas] = useState<TarefaHoje[] | null>(null);
  const [feitas, setFeitas] = useState<FeitaHoje[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [hoje, setHoje] = useState(todayBrasilia());
  // Papel da pessoa em cada loja (caixa numa, gerente noutra). Lido uma vez por sessão da tela.
  const papeis = useRef<Map<string, string> | null>(null);

  const carregarPapeis = useCallback(async () => {
    if (papeis.current || !meuId) return papeis.current ?? new Map<string, string>();
    const m = new Map<string, string>();
    const { data, error } = await supabase.rpc('get_user_tenants', { p_user_id: meuId });
    // Sem os papéis, as pendências das outras lojas sumiriam e a tela diria "tudo em dia": melhor
    // mostrar o erro e tentar de novo na próxima volta do que esconder trabalho (revisão 2026-10-03).
    if (error || !(data ?? []).length) throw new Error(error?.message ?? 'não consegui ler as suas lojas');
    for (const t of (data ?? []) as Array<{ tenant_id: string; role: string }>) m.set(t.tenant_id, DB_TO_FRONTEND_ROLE[t.role] ?? t.role);
    if (user?.tenantId && user.perfil) m.set(user.tenantId, user.perfil);
    papeis.current = m;
    return m;
  }, [meuId, user?.tenantId, user?.perfil]);

  const recarregar = useCallback(async () => {
    if (!meuId) return;
    const dia = todayBrasilia();
    setHoje(dia);
    try {
      const papel = await carregarPapeis();
      // Pix pedido no grupo é pago pelo dono no chat (PIN): para os demais seria um cartão sem saída.
      const soDono = (kind: string) => (kind === 'pagamento_grupo' || kind === 'pagamento_pendente') && !dono;
      const visivel = (kind: string, tenantId: string) => !soDono(kind) && pendenciaVisivelPara(kind, papel.get(tenantId), email);
      const [abertas, tarefasR, feitasR] = await Promise.all([
        supabase.from('pendencias')
          .select('id, tenant_id, kind, ref, titulo, detalhe, rota, urgencia, acao_requerida, status, criada_em, payload, tenants(name)')
          .in('status', ['aberta', 'vista']).order('criada_em', { ascending: true }).limit(400),
        supabase.from('tasks').select('id, tenant_id, title, due_date, due_has_time, priority')
          .is('completed_at', null).eq('is_archived', false).not('due_date', 'is', null)
          .lte('due_date', fimDeHoje(dia))
          .or(`created_by.eq.${meuId},assignee_id.eq.${meuId}`)
          .order('due_date', { ascending: true }).limit(60),
        supabase.from('pendencias')
          .select('id, tenant_id, kind, titulo, status, motivo, resolvida_em, tenants(name)')
          .in('status', ['resolvida', 'descartada']).gte('resolvida_em', `${dia}T00:00:00-03:00`)
          .order('resolvida_em', { ascending: false }).limit(40),
      ]);
      if (abertas.error) throw new Error(abertas.error.message);
      if (tarefasR.error) throw new Error(tarefasR.error.message);
      setPendencias((abertas.data ?? [])
        .filter((r) => visivel(r.kind, r.tenant_id))
        .map((r) => ({
          id: r.id, tenantId: r.tenant_id, loja: lojaDe(r), kind: r.kind, ref: r.ref ?? null, titulo: r.titulo,
          detalhe: r.detalhe, rota: r.rota, urgencia: r.urgencia, acaoRequerida: r.acao_requerida, status: r.status,
          criadaEm: r.criada_em, payload: (r.payload as Record<string, unknown> | null) ?? null,
        })));
      // Sem acesso a Tarefas a RLS devolve vazio — a seção some.
      setTarefas((prev) => {
        const novas = ((tarefasR.data ?? []) as Array<{ id: string; tenant_id: string; title: string; due_date: string | null; due_has_time: boolean | null; priority: number | null }>)
          .map((t) => ({ id: t.id, tenantId: t.tenant_id, titulo: t.title, prazo: t.due_date, temHora: !!t.due_has_time, prioridade: t.priority }));
        // As concluídas nesta tela continuam riscadas na lista (dá a sensação de andamento).
        const feitasAqui = (prev ?? []).filter((t) => t.feita && !novas.some((n) => n.id === t.id));
        return [...novas, ...feitasAqui];
      });
      setFeitas(((feitasR.data ?? []) as Array<{ id: string; tenant_id: string; kind: string; titulo: string; status: string; motivo: string | null; resolvida_em: string }>)
        // "N tarefas vencidas" do cron abre e fecha sozinha: não é coisa que alguém resolveu.
        .filter((r) => r.kind !== 'tarefa_vencida' && visivel(r.kind, r.tenant_id))
        .map((r) => ({ id: r.id, tenantId: r.tenant_id, loja: lojaDe(r), kind: r.kind, titulo: r.titulo, status: r.status, motivo: r.motivo, quando: r.resolvida_em })));
      setErro(null);
    } catch (e) {
      // Mantém o que já estava na tela; a próxima volta tenta de novo.
      setErro(e instanceof Error ? e.message : String(e));
      setPendencias((p) => p ?? []);
      setTarefas((t) => t ?? []);
    }
  }, [meuId, email, dono, carregarPapeis]);

  useEffect(() => {
    recarregar();
    const t = setInterval(() => { if (!document.hidden) recarregar(); }, 60000);
    const voltou = () => { if (!document.hidden) recarregar(); };
    document.addEventListener('visibilitychange', voltou);
    window.addEventListener('focus', voltou);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', voltou); window.removeEventListener('focus', voltou); };
  }, [recarregar]);

  const itens: ItemHoje[] | null = useMemo(() => (pendencias ? organizarHoje(pendencias, hoje) : null), [pendencias, hoje]);

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
  const papelDe = useCallback((tenantId: string) => papeis.current?.get(tenantId) ?? (tenantId === user?.tenantId ? user?.perfil : undefined), [user?.tenantId, user?.perfil]);

  /** Quantas lojas a pessoa tem (mostrar o nome da loja nos cartões). */
  const nLojas = papeis.current?.size ?? 1;

  return { itens, tarefas, feitas, erro, hoje, recarregar, concluirTarefa, marcar, papelDe, nLojas, dono, carregando: pendencias === null };
}
