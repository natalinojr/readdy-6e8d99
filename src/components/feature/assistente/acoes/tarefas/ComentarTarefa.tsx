// Ação rápida: comentar numa tarefa, sem abrir a tela. Mesmo caminho da janela da tarefa:
// fn_get_task_detail (para mostrar os últimos comentários, dar contexto) + task-write › add_comment.
// Comentário sai direto (sem confirmação extra) — é o mesmo tom de "mandar uma mensagem".
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { TaskDetail, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { dataBR, horaBR, Campo, Fim, Opcao, OpcaoNeutra, Roteiro, useRoteiro, type AcaoProps } from '../kit';
import { BuscaTarefa, COR_TAREFAS, OpcaoTarefa, carregarTarefas, filtrarPorTexto, gravarTarefa, ordenarPorPrazo } from './comum';

type Passo = 'carregando' | 'lista' | 'abrindo' | 'escrevendo' | 'gravando' | 'fim';

export default function ComentarTarefa({ onFechar, irPara }: AcaoProps) {
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
      const lista = ordenarPorPrazo(todas.filter((t) => t.created_by === meuId || t.assignee_id === meuId));
      setTarefas(lista);
      if (!lista.length) { r.bot('Você não tem tarefa aberta pra comentar.'); setPasso('fim'); return; }
      r.bot('Em qual tarefa você quer comentar?');
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolher = async (t: TaskRow) => {
    if (!tenantId || passo !== 'lista') return;
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
    if (!tenantId || !alvo || passo !== 'escrevendo') return;
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

  const outras = filtrarPorTexto(tarefas, busca);

  return (
    <Roteiro titulo="Comentar em tarefa" icone="ri-chat-3-line" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'abrindo' || passo === 'gravando'}
      textoCarregando={passo === 'gravando' ? 'Enviando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {tarefas.length > 8 && <BuscaTarefa valor={busca} onMudar={setBusca} />}
          {outras.map((t) => <OpcaoTarefa key={t.id} t={t} onClick={() => escolher(t)} mostrarResponsavel />)}
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
