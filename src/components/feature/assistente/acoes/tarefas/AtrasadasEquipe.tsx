// Ação rápida: ranking das tarefas atrasadas por responsável (sem IA). fn_get_tasks devolve as das
// pastas que eu acesso (minhas + compartilhadas) e as que estão comigo — "da equipe" é esse alcance. Cobrar e
// adiar usam os mesmos caminhos das outras ações de tarefa (add_comment / update_task).
import { useEffect, useState } from 'react';
import { useEuTarefas } from '@/pages/tarefas/hooks/useEuTarefas';
import { todayBrasilia } from '@/lib/dateUtils';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, dataBR, somaDias, type AcaoProps } from '../kit';
import { COR_TAREFAS, OpcaoTarefa, atrasada, carregarTarefas, gravarTarefa, novoPrazo } from './comum';

type Passo = 'carregando' | 'lista' | 'opcoes' | 'gravando' | 'fim';

const primeiroNome = (nome: string) => nome.trim().split(' ')[0] || 'responsável';

export default function AtrasadasEquipe({ onFechar, irPara }: AcaoProps) {
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
      const atrasadas = todas.filter(atrasada);
      setTarefas(atrasadas);
      if (!atrasadas.length) { r.bot('Nada atrasado. 👌'); setPasso('fim'); return; }
      r.bot('Tarefas das suas pastas, das pastas compartilhadas com você e as que estão com você.');
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eu.pronto]);

  const grupos = agrupar(tarefas);
  const maiorGrupo = Math.max(1, ...grupos.map((g) => g.itens.length));

  const escolher = (t: TaskRow) => {
    setAlvo(t);
    r.eu(t.title);
    r.bot(`O que fazer com "${t.title}"?`);
    setPasso('opcoes');
  };

  const cobrar = async () => {
    if (!alvo || !eu.pronto || passo !== 'opcoes') return;
    r.eu('Cobrar');
    setPasso('gravando');
    const texto = `Oi, ${primeiroNome(alvo.assignee_name ?? '')}! Como está essa tarefa?`;
    const { erro } = await gravarTarefa(tenantId, 'add_comment', { task_id: alvo.id, body: texto });
    if (erro) { r.bot(`❌ Não enviei: ${erro}.`); setPasso('opcoes'); return; }
    r.bot(`✅ Cobrança enviada para ${alvo.assignee_name} (ele recebe o aviso).`);
    setAlvo(null);
    setPasso('lista');
  };

  const adiarAmanha = async () => {
    if (!alvo || !eu.pronto || passo !== 'opcoes') return;
    r.eu('Adiar para amanhã');
    setPasso('gravando');
    const amanha = somaDias(todayBrasilia(), 1);
    const { erro } = await gravarTarefa(tenantId, 'update_task', { task_id: alvo.id, ...novoPrazo(alvo, amanha) });
    if (erro) { r.bot(`❌ Não adiei: ${erro}.`); setPasso('opcoes'); return; }
    r.bot(`✅ "${alvo.title}" adiada para ${dataBR(amanha)}.`);
    setTarefas((l) => l.filter((t) => t.id !== alvo.id));
    setAlvo(null);
    setPasso('lista');
  };

  const podeCobrar = !!alvo?.assignee_id && alvo.assignee_id !== meuId;

  return (
    <Roteiro titulo="Atrasadas da equipe" icone="ri-alarm-warning-line" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Gravando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          <div className="space-y-1.5 rounded-xl border border-zinc-200 bg-white p-3">
            {grupos.map((g) => (
              <div key={g.nome}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-700 truncate">{g.nome}</span>
                  <span className="font-bold text-red-600 tabular-nums">{g.itens.length}</span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                  <div className="h-full bg-red-500" style={{ width: `${(g.itens.length / maiorGrupo) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          {grupos.map((g) => (
            <div key={g.nome} className="space-y-1">
              <p className="px-1 text-[11px] font-bold uppercase text-zinc-400">{g.nome}</p>
              {g.itens.map((t) => <OpcaoTarefa key={t.id} t={t} onClick={() => escolher(t)} />)}
            </div>
          ))}
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}

      {passo === 'opcoes' && alvo && (
        <>
          {podeCobrar && <Opcao onClick={cobrar}>Cobrar</Opcao>}
          <Opcao onClick={adiarAmanha}>Adiar para amanhã</Opcao>
          <Opcao onClick={() => irPara(`/tarefas?task=${alvo.id}`)}>Abrir a tarefa</Opcao>
          <OpcaoNeutra onClick={() => { r.eu('Voltar'); setAlvo(null); setPasso('lista'); }}>Voltar</OpcaoNeutra>
        </>
      )}

      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Tarefas', onClick: () => irPara('/tarefas') }]} />}
    </Roteiro>
  );
}

function agrupar(tarefas: TaskRow[]): { nome: string; itens: TaskRow[] }[] {
  const mapa = new Map<string, TaskRow[]>();
  for (const t of tarefas) {
    const nome = t.assignee_name ?? 'Sem responsável';
    mapa.set(nome, [...(mapa.get(nome) ?? []), t]);
  }
  return [...mapa.entries()]
    .map(([nome, itens]) => ({ nome, itens }))
    .sort((a, b) => b.itens.length - a.itens.length);
}
