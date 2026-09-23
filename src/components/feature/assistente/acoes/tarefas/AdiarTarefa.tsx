// Ação rápida: adiar o prazo de uma tarefa minha (sem IA). Mesmo caminho da janela da tarefa:
// task-write › update_task com due_date/due_has_time (novoPrazo mantém o horário, se tinha).
// É reversível (só muda o prazo), então grava direto ao escolher a data — sem tela de confirmação.
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { todayBrasilia } from '@/lib/dateUtils';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, dataBR, somaDias, type AcaoProps } from '../kit';
import { COR_TAREFAS, OpcaoTarefa, atrasada, carregarTarefas, gravarTarefa, minha, novoPrazo, ordenarPorPrazo, proximaSegunda, venceHoje, ListaPorPasta } from './comum';

type Passo = 'carregando' | 'lista' | 'quando' | 'data_campo' | 'gravando' | 'fim';

export default function AdiarTarefa({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const meuId = user?.id ?? null;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const [todasMinhas, setTodasMinhas] = useState<TaskRow[]>([]);
  const [mostrarTodas, setMostrarTodas] = useState(false);
  const [alvo, setAlvo] = useState<TaskRow | null>(null);

  useEffect(() => {
    if (!tenantId || !meuId) { r.bot('Sem loja ativa.'); setPasso('fim'); return; }
    (async () => {
      const { tarefas: todas, erro } = await carregarTarefas(tenantId);
      if (erro) { r.bot(`Não consegui abrir as Tarefas: ${erro}`); setPasso('fim'); return; }
      const minhas = ordenarPorPrazo(todas.filter((t) => minha(t, meuId)));
      const urgentes = minhas.filter((t) => t.due_date && (atrasada(t) || venceHoje(t)));
      setTodasMinhas(minhas.filter((t) => t.due_date));
      if (!urgentes.length) {
        r.bot('Nada atrasado nem para hoje. 👌');
        setTarefas([]);
        setPasso('fim');
        return;
      }
      setTarefas(urgentes);
      r.bot('Qual tarefa você quer adiar?');
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolher = (t: TaskRow) => {
    setAlvo(t);
    r.eu(`${t.title}`);
    r.bot('Para quando?');
    setPasso('quando');
  };

  const adiar = async (dia: string) => {
    if (!alvo || !tenantId || passo !== 'quando') return;
    const hoje = todayBrasilia();
    if (dia < hoje) { r.bot('Escolha hoje ou depois.'); return; }
    r.eu(dataBR(dia));
    setPasso('gravando');
    const { erro } = await gravarTarefa(tenantId, 'update_task', { task_id: alvo.id, ...novoPrazo(alvo, dia) });
    if (erro) { r.bot(`❌ Não adiei: ${erro}.`); setPasso('quando'); return; }
    r.bot(`✅ "${alvo.title}" adiada para ${dataBR(dia)}.`);
    // Tira a tarefa da lista atual; se estava na lista "urgentes" e a nova data não é mais
    // atrasada/hoje, ela some de vez (mostrarTodas mantém, só atualiza o prazo mostrado).
    const restantes = tarefas.filter((t) => t.id !== alvo.id);
    setTarefas(restantes);
    setAlvo(null);
    if (restantes.length) { r.bot('Mais alguma?'); setPasso('lista'); } else { setPasso('fim'); }
  };

  const verTodas = () => {
    r.eu('Ver todas com prazo');
    if (!todasMinhas.length) { r.bot('Você não tem nenhuma tarefa com prazo.'); setPasso('fim'); return; }
    setMostrarTodas(true);
    setTarefas(todasMinhas);
    r.bot('Qual tarefa você quer adiar?');
    setPasso('lista');
  };

  const hoje = todayBrasilia();

  return (
    <Roteiro titulo="Adiar tarefa" icone="ri-calendar-event-line" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Adiando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          <ListaPorPasta tarefas={tarefas} renderTarefa={(t) => <OpcaoTarefa t={t} onClick={() => escolher(t)} />} />
          {!tarefas.length && <p className="px-1 text-xs text-zinc-500">Nada por aqui.</p>}
          {!mostrarTodas && <OpcaoNeutra onClick={verTodas}>Ver todas com prazo</OpcaoNeutra>}
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}

      {passo === 'quando' && (
        <>
          <Opcao onClick={() => adiar(somaDias(hoje, 1))} detalhe={`(${dataBR(somaDias(hoje, 1))})`}>Amanhã</Opcao>
          <Opcao onClick={() => adiar(proximaSegunda())} detalhe={`(${dataBR(proximaSegunda())})`}>Próxima segunda</Opcao>
          <Opcao onClick={() => adiar(somaDias(hoje, 7))} detalhe={`(${dataBR(somaDias(hoje, 7))})`}>Daqui a 1 semana</Opcao>
          <Opcao onClick={() => setPasso('data_campo')}>Outra data</Opcao>
          <OpcaoNeutra onClick={() => { r.eu('Voltar'); setAlvo(null); setPasso('lista'); }}>Voltar</OpcaoNeutra>
        </>
      )}
      {passo === 'data_campo' && <Campo placeholder="Data" tipo="date" onEnviar={(d) => adiar(d)} />}

      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Tarefas', onClick: () => irPara('/tarefas') }]} />}
    </Roteiro>
  );
}
