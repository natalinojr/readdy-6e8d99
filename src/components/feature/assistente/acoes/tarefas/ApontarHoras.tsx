// Ação rápida: apontar tempo trabalhado numa tarefa, sem ligar o cronômetro. Mesmo caminho da
// janela da tarefa: task-write › add_time_entry. O backend só grava terminando AGORA (started_at
// = agora − minutos), então não dá para escolher outro dia — não oferecemos essa opção.
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { formatarDuracao, lerDuracao, segundosRegistrados } from '@/pages/tarefas/lib/tempo';
import { Campo, Fim, Opcao, OpcaoNeutra, Roteiro, useRoteiro, type AcaoProps } from '../kit';
import { BuscaTarefa, COR_TAREFAS, OpcaoTarefa, carregarTarefas, filtrarPorTexto, gravarTarefa, minha, ordenarPorPrazo } from './comum';

type Passo = 'carregando' | 'lista' | 'quanto' | 'gravando' | 'fim';

const ATALHOS = [15, 30, 60, 120];

export default function ApontarHoras({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const meuId = user?.id ?? null;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const [busca, setBusca] = useState('');
  const [alvo, setAlvo] = useState<TaskRow | null>(null);

  useEffect(() => {
    if (!tenantId || !meuId) { r.bot('Sem loja ativa.'); setPasso('fim'); return; }
    (async () => {
      const { tarefas: todas, erro } = await carregarTarefas(tenantId);
      if (erro) { r.bot(`Não consegui abrir as Tarefas: ${erro}`); setPasso('fim'); return; }
      const lista = ordenarPorPrazo(todas.filter((t) => minha(t, meuId)));
      setTarefas(lista);
      if (!lista.length) { r.bot('Você não tem tarefa aberta. Crie uma em "Nova tarefa".'); setPasso('fim'); return; }
      r.bot('Em qual tarefa você trabalhou?');
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolher = (t: TaskRow) => {
    setAlvo(t);
    r.eu(t.title);
    r.bot('Quanto tempo?');
    setPasso('quanto');
  };

  const registrar = async (minutos: number) => {
    if (!tenantId || !alvo || passo !== 'quanto') return;
    r.eu(formatarDuracao(minutos * 60));
    setPasso('gravando');
    const { erro } = await gravarTarefa(tenantId, 'add_time_entry', { task_id: alvo.id, minutes: minutos });
    if (erro) { r.bot(`❌ Não registrei: ${erro}.`); setPasso('quanto'); return; }
    const totalAntes = segundosRegistrados(alvo, Date.now());
    const totalDepois = totalAntes + minutos * 60;
    setTarefas((l) => l.map((x) => (x.id === alvo.id ? { ...x, time_tracked_seconds: totalDepois } : x)));
    r.bot(`✅ ${formatarDuracao(minutos * 60)} registrados em "${alvo.title}". Total na tarefa: ${formatarDuracao(totalDepois)}.`);
    setPasso('fim');
  };

  const receberCampo = (texto: string) => {
    const minutos = lerDuracao(texto);
    if (minutos === null || minutos <= 0) { r.eu(texto); r.bot('Não entendi. Ex.: 1h30'); return; }
    if (minutos > 24 * 60) { r.eu(texto); r.bot('Não entendi. Ex.: 1h30'); return; }
    registrar(minutos);
  };

  const apontarOutra = () => {
    r.limpar();
    setAlvo(null);
    r.bot('Em qual tarefa você trabalhou?');
    setPasso('lista');
  };

  const outras = filtrarPorTexto(tarefas, busca);

  return (
    <Roteiro titulo="Apontar horas" icone="ri-time-line" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Gravando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {tarefas.length > 8 && <BuscaTarefa valor={busca} onMudar={setBusca} />}
          {outras.map((t) => (
            <OpcaoTarefa key={t.id} t={t} onClick={() => escolher(t)}
              extra={t.time_tracked_seconds ? `${formatarDuracao(t.time_tracked_seconds)} feitos` : undefined} />
          ))}
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'quanto' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {ATALHOS.map((min) => (
              <button key={min} onClick={() => registrar(min)}
                className="px-3 py-2 rounded-xl border border-violet-200 bg-white text-sm font-semibold text-violet-700 hover:bg-violet-50 cursor-pointer">
                {formatarDuracao(min * 60)}
              </button>
            ))}
          </div>
          <Campo placeholder="Ex.: 1h30, 45, 2h" onEnviar={receberCampo} />
          <OpcaoNeutra onClick={() => setPasso('lista')}>Voltar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          { label: 'Apontar em outra', onClick: apontarOutra },
          ...(alvo ? [{ label: 'Abrir a tarefa', onClick: () => irPara(`/tarefas?task=${alvo.id}`) }] : []),
        ]} />
      )}
    </Roteiro>
  );
}
