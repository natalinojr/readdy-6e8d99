// Ação rápida: iniciar/parar o cronômetro de uma tarefa (sem IA). Mesmo caminho da janela da tarefa:
// task-write › start_timer / stop_timer. Um cronômetro por pessoa: iniciar noutra tarefa encerra o
// que estava rodando (a Edge faz isso e devolve stopped_task_id). O rodando aparece no topo, contando.
import { useEffect, useState } from 'react';
import { useEuTarefas } from '@/pages/tarefas/hooks/useEuTarefas';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { formatarDuracao, formatarRelogio, segundosRegistrados, useAgora } from '@/pages/tarefas/lib/tempo';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, type AcaoProps } from '../kit';
import { COR_TAREFAS, OpcaoTarefa, carregarTarefas, gravarTarefa, minha, ordenarPorPrazo, ListaPorPasta } from './comum';

type Passo = 'carregando' | 'lista' | 'gravando' | 'fim';

export default function Cronometro({ onFechar, irPara }: AcaoProps) {
  // Sem loja também (2026-09-24): quem só tem o módulo Tarefas usa com tenant nulo.
  const eu = useEuTarefas();
  const tenantId = eu.tenantId;
  const meuId = eu.id;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const rodando = tarefas.find((t) => t.timer_started_at) ?? null;
  const agora = useAgora(!!rodando);

  useEffect(() => {
    if (!eu.pronto || !meuId) return;
    (async () => {
      const { tarefas: todas, erro } = await carregarTarefas(tenantId);
      if (erro) { r.bot(`Não consegui abrir as Tarefas: ${erro}`); setPasso('fim'); return; }
      // Minhas abertas + qualquer uma com o MEU cronômetro rodando (timer_started_at é só o meu).
      const lista = ordenarPorPrazo(todas.filter((t) => minha(t, meuId) || t.timer_started_at));
      setTarefas(lista);
      if (!lista.length) { r.bot('Você não tem tarefa aberta. Crie uma em "Nova tarefa".'); setPasso('fim'); return; }
      const ligado = lista.find((t) => t.timer_started_at);
      r.bot(ligado ? `O cronômetro está rodando em "${ligado.title}". Toque em outra tarefa para trocar.` : 'Em qual tarefa você vai trabalhar?');
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eu.pronto]);

  const iniciar = async (t: TaskRow) => {
    if (!eu.pronto || passo !== 'lista') return;
    r.eu(`▶ ${t.title}`);
    setPasso('gravando');
    const { erro, data } = await gravarTarefa<{ success?: boolean; stopped_task_id?: string | null }>(tenantId, 'start_timer', { task_id: t.id });
    if (erro) { r.bot(`❌ Não iniciei: ${erro}.`); setPasso('lista'); return; }
    const inicio = new Date().toISOString();
    const anterior = data?.stopped_task_id ? tarefas.find((x) => x.id === data.stopped_task_id) : null;
    setTarefas((l) => l.map((x) => {
      if (x.id === t.id) return { ...x, timer_started_at: inicio };
      if (x.timer_started_at) return { ...x, time_tracked_seconds: segundosRegistrados(x, Date.now()), timer_started_at: null };
      return x;
    }));
    r.bot(`⏱ Cronômetro rodando em "${t.title}".${anterior ? ` Parei o de "${anterior.title}".` : ''}`);
    setPasso('lista');
  };

  const parar = async () => {
    if (!eu.pronto || !rodando || passo !== 'lista') return;
    r.eu('⏹ Parar');
    setPasso('gravando');
    const { erro, data } = await gravarTarefa<{ success?: boolean; seconds?: number }>(tenantId, 'stop_timer', {});
    if (erro) { r.bot(`❌ Não parei: ${erro}.`); setPasso('lista'); return; }
    const segundos = Number(data?.seconds ?? 0);
    setTarefas((l) => l.map((x) => (x.id === rodando.id ? { ...x, time_tracked_seconds: (x.time_tracked_seconds ?? 0) + segundos, timer_started_at: null } : x)));
    r.bot(`✅ Parado. ${formatarDuracao(segundos, true)} registrados em "${rodando.title}".`);
    setPasso('lista');
  };


  return (
    <Roteiro titulo="Cronômetro" icone="ri-timer-line" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Gravando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {rodando && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
              <p className="text-[11px] font-bold uppercase text-indigo-500">Rodando agora</p>
              <p className="text-sm font-semibold text-zinc-900 truncate">{rodando.title}</p>
              <p className="text-2xl font-black tabular-nums text-indigo-700">{formatarRelogio((agora - new Date(rodando.timer_started_at!).getTime()) / 1000)}</p>
              <p className="text-[11px] text-zinc-500">Total na tarefa: {formatarDuracao(segundosRegistrados(rodando, agora))}</p>
            </div>
          )}
          {rodando && <Opcao perigo onClick={parar}>⏹ Parar cronômetro</Opcao>}
          <ListaPorPasta tarefas={tarefas.filter((t) => t.id !== rodando?.id)} renderTarefa={(t) => (
            <OpcaoTarefa t={t} icone="ri-play-circle-line" onClick={() => iniciar(t)}
              extra={t.time_tracked_seconds ? `${formatarDuracao(t.time_tracked_seconds)} feitos` : undefined} />
          )} />
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Tarefas', onClick: () => irPara('/tarefas') }]} />}
    </Roteiro>
  );
}
