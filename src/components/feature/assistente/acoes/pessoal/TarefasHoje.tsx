// Ação rápida: minhas tarefas de hoje e atrasadas (sem IA). Mesmo critério da tela Tarefas:
// "Minhas" = assignee_id = eu (page.tsx) e vencimento como calcularVencimentos (NotificacoesInbox),
// aqui com o dia em Brasília. Leitura por RPC fn_get_tasks; concluir pela Edge task-write ›
// update_task { status_category: 'done' } — o mesmo payload da visão "Minhas" (sem pasta única).
//
// 2026-09-23: tocar a tarefa abre o que dá para fazer com ela — concluir, cronômetro (start_timer /
// stop_timer) e adiar (update_task due_date, mantendo o horário). Escolher "Concluir" já é a confirmação.
import { useEffect, useState } from 'react';
import { useEuTarefas } from '@/pages/tarefas/hooks/useEuTarefas';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { formatarRelogio, useAgora } from '@/pages/tarefas/lib/tempo';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, dataBR, somaDias, type AcaoProps } from '../kit';
import { carregarTarefas, gravarTarefa, novoPrazo, rotuloPrazo } from '../tarefas/comum';

type Passo = 'carregando' | 'lista' | 'acoes' | 'outra_data' | 'gravando' | 'fim';

export default function TarefasHoje({ onFechar, irPara }: AcaoProps) {
  // Sem loja também (2026-09-24): quem só tem o módulo Tarefas usa com tenant nulo.
  const eu = useEuTarefas();
  const tenantId = eu.tenantId;
  const meuId = eu.id;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const [alvo, setAlvo] = useState<TaskRow | null>(null);
  // Concluídas e adiadas saem da lista.
  const [resolvidas, setResolvidas] = useState<Set<string>>(new Set());
  const rodando = tarefas.find((t) => t.timer_started_at) ?? null;
  const agora = useAgora(!!rodando);

  useEffect(() => {
    if (!eu.pronto || !meuId) return;
    (async () => {
      const { tarefas: abertas, erro } = await carregarTarefas(tenantId);
      if (erro) { r.bot(`Não consegui abrir as Tarefas: ${erro}`); setPasso('fim'); return; }
      const hoje = todayBrasilia();
      const lista = abertas
        .filter((t) => t.assignee_id === meuId && t.due_date)
        .filter((t) => dateKeyBrasilia(t.due_date!) <= hoje)
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : b.priority - a.priority));
      setTarefas(lista);
      const atrasadas = lista.filter((t) => dateKeyBrasilia(t.due_date!) < hoje).length;
      if (!lista.length) { r.bot('Nada para hoje e nada atrasado. 👌'); setPasso('fim'); return; }
      r.bot(`${lista.length - atrasadas} para hoje${atrasadas ? ` · ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}` : ''}. Toque numa tarefa para concluir, cronometrar ou adiar.`);
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eu.pronto]);

  const abrir = (t: TaskRow) => {
    setAlvo(t);
    r.eu(t.title);
    setPasso('acoes');
  };

  const voltar = () => { setAlvo(null); setPasso('lista'); };

  const concluir = async () => {
    if (!alvo || !eu.pronto || passo !== 'acoes') return;
    const t = alvo;
    r.eu('Concluir');
    setPasso('gravando');
    const { erro, data } = await gravarTarefa<{ success?: boolean; next_occurrence_id?: string | null }>(tenantId, 'update_task', { task_id: t.id, status_category: 'done' });
    if (erro) {
      r.bot(`❌ Não concluí: ${erro}.`);
    } else {
      setResolvidas((s) => new Set(s).add(t.id));
      // Concluir com o cronômetro rodando nela não para o cronômetro (igual à tela); só avisa.
      r.bot(`✅ "${t.title}" concluída.${data?.next_occurrence_id ? ' É recorrente: a próxima já foi criada.' : ''}${t.timer_started_at ? ' O cronômetro dela continua rodando.' : ''}`);
    }
    voltar();
  };

  const cronometro = async () => {
    if (!alvo || !eu.pronto || passo !== 'acoes') return;
    const t = alvo;
    const parar = !!t.timer_started_at;
    r.eu(parar ? '⏹ Parar cronômetro' : '▶ Iniciar cronômetro');
    setPasso('gravando');
    const { erro, data } = parar
      ? await gravarTarefa<{ success?: boolean; seconds?: number }>(tenantId, 'stop_timer', {})
      : await gravarTarefa<{ success?: boolean; stopped_task_id?: string | null }>(tenantId, 'start_timer', { task_id: t.id });
    if (erro) {
      r.bot(`❌ ${parar ? 'Não parei' : 'Não iniciei'}: ${erro}.`);
    } else if (parar) {
      setTarefas((l) => l.map((x) => (x.id === t.id ? { ...x, timer_started_at: null } : x)));
      r.bot(`⏹ Parado em "${t.title}".`);
    } else {
      const inicio = new Date().toISOString();
      setTarefas((l) => l.map((x) => (x.id === t.id ? { ...x, timer_started_at: inicio } : x.timer_started_at ? { ...x, timer_started_at: null } : x)));
      const anterior = (data as { stopped_task_id?: string | null } | null)?.stopped_task_id;
      r.bot(`⏱ Cronômetro rodando em "${t.title}".${anterior ? ' O anterior foi parado.' : ''}`);
    }
    voltar();
  };

  const adiar = async (dia: string) => {
    if (!alvo || !eu.pronto || (passo !== 'acoes' && passo !== 'outra_data')) return;
    const t = alvo;
    if (dia < todayBrasilia()) { r.bot('Escolha hoje ou uma data depois.'); return; }
    r.eu(`Adiar para ${dataBR(dia)}`);
    setPasso('gravando');
    const { erro } = await gravarTarefa(tenantId, 'update_task', { task_id: t.id, ...novoPrazo(t, dia) });
    if (erro) {
      r.bot(`❌ Não adiei: ${erro}.`);
    } else {
      if (dia > todayBrasilia()) setResolvidas((s) => new Set(s).add(t.id));
      r.bot(`📅 "${t.title}" agora vence em ${dataBR(dia)}.`);
    }
    voltar();
  };

  const restantes = tarefas.filter((t) => !resolvidas.has(t.id));
  const amanha = somaDias(todayBrasilia(), 1);

  return (
    <Roteiro titulo="Minhas tarefas de hoje" icone="ri-list-check-3" cor="bg-indigo-50 text-indigo-600" baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Gravando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {restantes.map((t) => (
            <Opcao key={t.id} onClick={() => abrir(t)} detalhe={`(${rotuloPrazo(t)}${t.list_name ? ` · ${t.list_name}` : ''})`}>
              <i className={`${t.timer_started_at ? 'ri-timer-flash-line text-indigo-500' : 'ri-checkbox-blank-circle-line'} mr-1.5`} />{t.title}
              {t.timer_started_at && <span className="ml-1.5 text-xs font-bold tabular-nums text-indigo-500">{formatarRelogio((agora - new Date(t.timer_started_at).getTime()) / 1000)}</span>}
            </Opcao>
          ))}
          {!restantes.length && <p className="px-1 text-xs text-zinc-500">Tudo resolvido por hoje.</p>}
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}

      {passo === 'acoes' && alvo && (
        <>
          <Opcao onClick={concluir}><i className="ri-checkbox-circle-line mr-1.5" />Concluir</Opcao>
          <Opcao onClick={cronometro}>
            <i className={`${alvo.timer_started_at ? 'ri-stop-circle-line' : 'ri-play-circle-line'} mr-1.5`} />{alvo.timer_started_at ? 'Parar cronômetro' : 'Iniciar cronômetro'}
          </Opcao>
          <Opcao onClick={() => adiar(amanha)} detalhe={`(${dataBR(amanha)})`}><i className="ri-skip-forward-line mr-1.5" />Adiar para amanhã</Opcao>
          <Opcao onClick={() => { r.bot('Para qual data?'); setPasso('outra_data'); }}><i className="ri-calendar-event-line mr-1.5" />Outra data</Opcao>
          <Opcao onClick={() => irPara(`/tarefas?task=${alvo.id}`)}><i className="ri-external-link-line mr-1.5" />Abrir a tarefa</Opcao>
          <OpcaoNeutra onClick={voltar}>Voltar</OpcaoNeutra>
        </>
      )}

      {passo === 'outra_data' && (
        <>
          <Campo placeholder="Data" tipo="date" onEnviar={adiar} />
          <OpcaoNeutra onClick={() => setPasso('acoes')}>Voltar</OpcaoNeutra>
        </>
      )}

      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Tarefas', onClick: () => irPara('/tarefas') }]} />}
    </Roteiro>
  );
}
