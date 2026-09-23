// Ação rápida: marcar/desmarcar itens do checklist de uma tarefa. Mesmo caminho da janela da
// tarefa: fn_get_task_detail (itens) + task-write › update_checklist_item / add_checklist_item /
// update_task (pra oferecer concluir quando tudo fica marcado).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ChecklistItem, TaskDetail, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { Campo, Fim, Opcao, OpcaoNeutra, Roteiro, useRoteiro, type AcaoProps } from '../kit';
import { BuscaTarefa, COR_TAREFAS, OpcaoTarefa, carregarTarefas, filtrarPorTexto, gravarTarefa, ordenarPorPrazo } from './comum';

type Passo = 'carregando' | 'lista' | 'abrindo' | 'checklist' | 'adicionando' | 'gravando' | 'fim';

export default function ChecklistTarefa({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const meuId = user?.id ?? null;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const [busca, setBusca] = useState('');
  const [alvo, setAlvo] = useState<TaskRow | null>(null);
  const [itens, setItens] = useState<ChecklistItem[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null); // item_id em gravação

  useEffect(() => {
    if (!tenantId || !meuId) { r.bot('Sem loja ativa.'); setPasso('fim'); return; }
    (async () => {
      const { tarefas: todas, erro } = await carregarTarefas(tenantId);
      if (erro) { r.bot(`Não consegui abrir as Tarefas: ${erro}`); setPasso('fim'); return; }
      const lista = ordenarPorPrazo(
        todas.filter((t) => (t.created_by === meuId || t.assignee_id === meuId) && t.checklist_total > 0),
      );
      setTarefas(lista);
      if (!lista.length) { r.bot('Nenhuma das suas tarefas tem checklist. Adicione itens pela tela de Tarefas.'); setPasso('fim'); return; }
      r.bot('Em qual tarefa você quer marcar o checklist?');
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrir = async (t: TaskRow) => {
    if (!tenantId || passo !== 'lista') return;
    setAlvo(t);
    r.eu(t.title);
    setPasso('abrindo');
    const { data, error } = await supabase.rpc('fn_get_task_detail', { p_tenant_id: tenantId, p_task_id: t.id });
    if (error) { r.bot(`❌ Não consegui abrir a tarefa: ${error.message}`); setPasso('lista'); return; }
    const detalhe = data as TaskDetail;
    setItens([...(detalhe.checklist ?? [])].sort((a, b) => a.sort_order - b.sort_order));
    r.bot(`Checklist de "${t.title}":`);
    setPasso('checklist');
  };

  const alternar = async (item: ChecklistItem) => {
    if (!tenantId || ocupado) return;
    setOcupado(item.id);
    const { erro } = await gravarTarefa(tenantId, 'update_checklist_item', { item_id: item.id, is_done: !item.is_done });
    setOcupado(null);
    if (erro) { r.bot(`❌ Não consegui atualizar: ${erro}.`); return; }
    setItens((l) => l.map((i) => (i.id === item.id ? { ...i, is_done: !i.is_done } : i)));
  };

  const adicionar = async (titulo: string) => {
    if (!tenantId || !alvo || passo !== 'adicionando') return;
    setPasso('gravando');
    const { erro, data } = await gravarTarefa<{ success?: boolean; id?: string }>(tenantId, 'add_checklist_item', { task_id: alvo.id, title: titulo });
    if (erro) { r.bot(`❌ Não consegui adicionar: ${erro}.`); setPasso('checklist'); return; }
    if (data?.id) setItens((l) => [...l, { id: data.id!, title: titulo, is_done: false, sort_order: Date.now() }]);
    setPasso('checklist');
  };

  const concluirTarefa = async () => {
    if (!tenantId || !alvo || passo !== 'checklist') return;
    setPasso('gravando');
    const { erro } = await gravarTarefa(tenantId, 'update_task', { task_id: alvo.id, status_category: 'done' });
    if (erro) { r.bot(`❌ Não consegui concluir: ${erro}.`); setPasso('checklist'); return; }
    r.bot(`✅ "${alvo.title}" concluída.`);
    setPasso('fim');
  };

  const outraTarefa = () => {
    r.limpar();
    setAlvo(null);
    setItens([]);
    r.bot('Em qual tarefa você quer marcar o checklist?');
    setPasso('lista');
  };

  const outras = filtrarPorTexto(tarefas, busca);
  const tudoFeito = itens.length > 0 && itens.every((i) => i.is_done);

  return (
    <Roteiro titulo="Marcar checklist" icone="ri-list-check-2" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'abrindo' || passo === 'gravando'}
      textoCarregando={passo === 'gravando' ? 'Gravando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {tarefas.length > 8 && <BuscaTarefa valor={busca} onMudar={setBusca} />}
          {outras.map((t) => (
            <OpcaoTarefa key={t.id} t={t} onClick={() => abrir(t)} extra={`${t.checklist_done}/${t.checklist_total}`} />
          ))}
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'checklist' && (
        <>
          {itens.map((item) => (
            <button key={item.id} onClick={() => alternar(item)} disabled={ocupado === item.id}
              className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm disabled:opacity-50 cursor-pointer hover:bg-zinc-50">
              <i className={item.is_done ? 'ri-checkbox-line text-emerald-600' : 'ri-checkbox-blank-line text-zinc-400'} />
              <span className={item.is_done ? 'line-through text-zinc-400' : 'text-zinc-800'}>{item.title}</span>
            </button>
          ))}
          {tudoFeito && <Opcao onClick={concluirTarefa}>✅ Concluir a tarefa também</Opcao>}
          <OpcaoNeutra onClick={() => setPasso('adicionando')}>+ Adicionar item</OpcaoNeutra>
          <OpcaoNeutra onClick={outraTarefa}>Outra tarefa</OpcaoNeutra>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'adicionando' && (
        <>
          <Campo placeholder="Novo item do checklist" onEnviar={adicionar} />
          <OpcaoNeutra onClick={() => setPasso('checklist')}>Voltar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          { label: 'Outra tarefa', onClick: outraTarefa },
          ...(alvo ? [{ label: 'Abrir a tarefa', onClick: () => irPara(`/tarefas?task=${alvo.id}`) }] : []),
        ]} />
      )}
    </Roteiro>
  );
}
