// Ação rápida: comentar numa tarefa, sem abrir a tela. Mesmo caminho da janela da tarefa:
// fn_get_task_detail (para mostrar os últimos comentários, dar contexto) + task-write › add_comment.
// Comentário sai direto (sem confirmação extra) — é o mesmo tom de "mandar uma mensagem".
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useEuTarefas } from '@/pages/tarefas/hooks/useEuTarefas';
import type { TaskDetail, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { dataBR, horaBR, Campo, Fim, Opcao, OpcaoNeutra, Roteiro, useRoteiro, type AcaoProps } from '../kit';
import { COR_TAREFAS, OpcaoTarefa, carregarTarefas, gravarTarefa, ordenarPorPrazo, ListaPorPasta } from './comum';

type Passo = 'carregando' | 'lista' | 'abrindo' | 'escrevendo' | 'gravando' | 'fim';

export default function ComentarTarefa({ onFechar, irPara }: AcaoProps) {
  // Sem loja também (2026-09-24): quem só tem o módulo Tarefas usa com tenant nulo.
  const eu = useEuTarefas();
  const tenantId = eu.tenantId;
  const meuId = eu.id;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const [alvo, setAlvo] = useState<TaskRow | null>(null);

  useEffect(() => {
    if (!eu.pronto || !meuId) return;
    (async () => {
      const { tarefas: todas, erro } = await carregarTarefas(tenantId);
      if (erro) { r.bot(`Não consegui abrir as Tarefas: ${erro}`); setPasso('fim'); return; }
      const lista = ordenarPorPrazo(todas.filter((t) => t.created_by === meuId || t.assignee_id === meuId));
      setTarefas(lista);
      if (!lista.length) { r.bot('Você não tem tarefa aberta pra comentar.'); setPasso('fim'); return; }
      r.bot('Em qual tarefa você quer comentar?');
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eu.pronto]);

  const escolher = async (t: TaskRow) => {
    if (!eu.pronto || passo !== 'lista') return;
    setAlvo(t);
    r.eu(t.title);
    setPasso('abrindo');
    const { data, error } = await supabase.rpc('fn_get_task_detail', { p_tenant_id: tenantId, p_task_id: t.id });
    if (error) { r.bot(`❌ Não consegui abrir a tarefa: ${error.message}`); setPasso('lista'); return; }
    const detalhe = data as TaskDetail;
    const ultimos = (detalhe.comments ?? []).slice(-3);
    if (ultimos.length) {
      const texto = ultimos.map((c) => `${c.user_name ?? 'Alguém'} (${dataBR(c.created_at)} ${horaBR(c.created_at)}): ${c.body}`).join('\n');
      r.bot(`Últimos comentários:\n${texto}`);
    } else {
      r.bot('Ainda não tem comentário nessa tarefa.');
    }
    r.bot('Escreva o comentário:');
    setPasso('escrevendo');
  };

  const enviar = async (texto: string) => {
    if (!eu.pronto || !alvo || passo !== 'escrevendo') return;
    r.eu(texto);
    setPasso('gravando');
    const { erro } = await gravarTarefa(tenantId, 'add_comment', { task_id: alvo.id, body: texto });
    if (erro) { r.bot(`❌ Não enviei: ${erro}.`); setPasso('escrevendo'); return; }
    const souResponsavel = alvo.assignee_id === meuId;
    r.bot(`✅ Comentário enviado.${souResponsavel ? '' : ` ${alvo.assignee_name ?? 'O responsável'} recebe o aviso.`}`);
    setPasso('fim');
  };

  const comentarOutra = () => {
    r.limpar();
    setAlvo(null);
    r.bot('Em qual tarefa você quer comentar?');
    setPasso('lista');
  };


  return (
    <Roteiro titulo="Comentar em tarefa" icone="ri-chat-3-line" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'abrindo' || passo === 'gravando'}
      textoCarregando={passo === 'gravando' ? 'Enviando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          <ListaPorPasta tarefas={tarefas} renderTarefa={(t) => <OpcaoTarefa t={t} onClick={() => escolher(t)} mostrarResponsavel />} />
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'escrevendo' && <Campo placeholder="Escreva o comentário" onEnviar={enviar} />}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          { label: 'Comentar em outra', onClick: comentarOutra },
          ...(alvo ? [{ label: 'Abrir a tarefa', onClick: () => irPara(`/tarefas?task=${alvo.id}`) }] : []),
        ]} />
      )}
    </Roteiro>
  );
}
