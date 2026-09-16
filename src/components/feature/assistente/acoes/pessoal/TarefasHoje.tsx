// Ação rápida: minhas tarefas de hoje e atrasadas (sem IA). Mesmo critério da tela Tarefas:
// "Minhas" = assignee_id = eu (page.tsx) e vencimento como calcularVencimentos (NotificacoesInbox),
// aqui com o dia em Brasília. Leitura por RPC fn_get_tasks; concluir pela Edge task-write ›
// update_task { status_category: 'done' } — o mesmo payload da visão "Minhas" (sem pasta única).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, dataBR, horaBR, invokeUmaVez, type AcaoProps } from '../kit';

type Passo = 'carregando' | 'lista' | 'confirmar' | 'gravando' | 'fim';

export default function TarefasHoje({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const meuId = user?.id ?? null;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const [alvo, setAlvo] = useState<TaskRow | null>(null);
  const [concluidas, setConcluidas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tenantId || !meuId) { r.bot('Sem loja ativa.'); setPasso('fim'); return; }
    (async () => {
      const { data, error } = await supabase.rpc('fn_get_tasks', { p_tenant_id: tenantId });
      if (error) { r.bot(`Não consegui abrir as Tarefas: ${error.message}`); setPasso('fim'); return; }
      const hoje = todayBrasilia();
      const lista = ((data as TaskRow[]) ?? [])
        .filter((t) => t.assignee_id === meuId && t.due_date && t.status_category !== 'done' && t.status_category !== 'cancelled')
        .filter((t) => dateKeyBrasilia(t.due_date!) <= hoje)
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : b.priority - a.priority));
      setTarefas(lista);
      const atrasadas = lista.filter((t) => dateKeyBrasilia(t.due_date!) < hoje).length;
      if (!lista.length) { r.bot('Nada para hoje e nada atrasado. 👌'); setPasso('fim'); return; }
      r.bot(`${lista.length - atrasadas} para hoje${atrasadas ? ` · ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}` : ''}. Toque para concluir.`);
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prazo = (t: TaskRow) => {
    const hoje = todayBrasilia();
    const dia = dateKeyBrasilia(t.due_date!);
    if (dia < hoje) return `atrasada · ${dataBR(dia)}`;
    return t.due_has_time ? `hoje ${horaBR(t.due_date)}` : 'hoje';
  };

  const pedirConfirmacao = (t: TaskRow) => {
    setAlvo(t);
    r.eu(`Concluir "${t.title}"`);
    r.bot(`Marcar "${t.title}" como concluída?`);
    setPasso('confirmar');
  };

  const concluir = async () => {
    if (!alvo || !tenantId || passo !== 'confirmar') return;
    const t = alvo;
    r.eu('Sim');
    setPasso('gravando');
    const { data, error } = await invokeUmaVez<{ success?: boolean; error?: string; next_occurrence_id?: string | null }>('task-write', {
      body: { action: 'update_task', active_tenant_id: tenantId, task_id: t.id, status_category: 'done' },
    });
    if (error || !data?.success) {
      r.bot(`❌ Não concluí: ${data?.error ?? error?.message ?? 'erro desconhecido'}.`);
    } else {
      setConcluidas((s) => new Set(s).add(t.id));
      r.bot(`✅ "${t.title}" concluída.${data.next_occurrence_id ? ' É recorrente: a próxima já foi criada.' : ''}`);
    }
    setAlvo(null);
    setPasso('lista');
  };

  const restantes = tarefas.filter((t) => !concluidas.has(t.id));

  return (
    <Roteiro titulo="Minhas tarefas de hoje" icone="ri-list-check-3" cor="bg-indigo-50 text-indigo-600" baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Concluindo…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {restantes.map((t) => (
            <Opcao key={t.id} onClick={() => pedirConfirmacao(t)} detalhe={`(${prazo(t)}${t.list_name ? ` · ${t.list_name}` : ''})`}>
              <i className="ri-checkbox-blank-circle-line mr-1.5" />{t.title}
            </Opcao>
          ))}
          {!restantes.length && <p className="px-1 text-xs text-zinc-500">Tudo concluído por hoje.</p>}
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}

      {passo === 'confirmar' && (
        <>
          <Opcao onClick={concluir}>Sim, concluir</Opcao>
          <OpcaoNeutra onClick={() => { r.eu('Não'); setAlvo(null); setPasso('lista'); }}>Não</OpcaoNeutra>
        </>
      )}

      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Tarefas', onClick: () => irPara('/tarefas') }]} />}
    </Roteiro>
  );
}
