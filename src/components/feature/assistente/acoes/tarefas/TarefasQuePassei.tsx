// Ação rápida: acompanhar as tarefas que eu criei e passei para outra pessoa (sem IA). Leitura por
// fn_get_tasks (comum.carregarTarefas); "cobrar" e "recado" são um comentário pela task-write ›
// add_comment — o comentário já avisa o responsável (notify() na Edge), sem endpoint novo.
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, type AcaoProps } from '../kit';
import { COR_TAREFAS, OpcaoTarefa, atrasada, carregarTarefas, gravarTarefa, venceHoje } from './comum';

type Passo = 'carregando' | 'lista' | 'opcoes' | 'recado' | 'gravando' | 'fim';

const primeiroNome = (nome: string) => nome.trim().split(' ')[0] || 'responsável';

export default function TarefasQuePassei({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const meuId = user?.id ?? null;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const [alvo, setAlvo] = useState<TaskRow | null>(null);

  useEffect(() => {
    if (!tenantId || !meuId) { r.bot('Sem loja ativa.'); setPasso('fim'); return; }
    (async () => {
      const { tarefas: todas, erro } = await carregarTarefas(tenantId);
      if (erro) { r.bot(`Não consegui abrir as Tarefas: ${erro}`); setPasso('fim'); return; }
      const passadas = todas.filter((t) => t.created_by === meuId && !!t.assignee_id && t.assignee_id !== meuId);
      setTarefas(passadas);
      if (!passadas.length) { r.bot('Você não passou nenhuma tarefa para ninguém.'); setPasso('fim'); return; }
      r.bot('Estas são as tarefas que você passou:');
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atrasadas = tarefas.filter(atrasada);
  const hoje = tarefas.filter((t) => !atrasada(t) && venceHoje(t));
  const proximas = tarefas.filter((t) => !atrasada(t) && !venceHoje(t) && !!t.due_date);
  const semPrazo = tarefas.filter((t) => !t.due_date);

  const escolher = (t: TaskRow) => {
    setAlvo(t);
    r.eu(t.title);
    r.bot(`O que fazer com "${t.title}"?`);
    setPasso('opcoes');
  };

  const cobrar = async () => {
    if (!alvo || !tenantId || passo !== 'opcoes') return;
    r.eu('Cobrar');
    setPasso('gravando');
    const texto = `Oi, ${primeiroNome(alvo.assignee_name ?? '')}! Como está essa tarefa?`;
    const { erro } = await gravarTarefa(tenantId, 'add_comment', { task_id: alvo.id, body: texto });
    if (erro) { r.bot(`❌ Não enviei: ${erro}.`); setPasso('opcoes'); return; }
    r.bot(`✅ Cobrança enviada para ${alvo.assignee_name} (ele recebe o aviso).`);
    setAlvo(null);
    setPasso('lista');
  };

  const enviarRecado = async (texto: string) => {
    if (!alvo || !tenantId || passo !== 'recado') return;
    r.eu(texto);
    setPasso('gravando');
    const { erro } = await gravarTarefa(tenantId, 'add_comment', { task_id: alvo.id, body: texto });
    if (erro) { r.bot(`❌ Não enviei: ${erro}.`); setPasso('recado'); return; }
    r.bot('✅ Recado enviado.');
    setAlvo(null);
    setPasso('lista');
  };

  const Painel = () => (
    <div className="grid grid-cols-4 gap-2 rounded-xl border border-zinc-200 bg-white p-3">
      {[
        { n: atrasadas.length, rotulo: 'Atrasadas', cor: 'text-red-600' },
        { n: hoje.length, rotulo: 'Hoje', cor: 'text-zinc-900' },
        { n: proximas.length, rotulo: 'Próximas', cor: 'text-zinc-900' },
        { n: semPrazo.length, rotulo: 'Sem prazo', cor: 'text-zinc-400' },
      ].map((c) => (
        <div key={c.rotulo} className="text-center">
          <p className={`text-xl font-black tabular-nums ${c.cor}`}>{c.n}</p>
          <p className="text-[10px] uppercase font-bold text-zinc-400">{c.rotulo}</p>
        </div>
      ))}
    </div>
  );

  const Secao = ({ titulo, lista }: { titulo: string; lista: TaskRow[] }) => !lista.length ? null : (
    <div className="space-y-1">
      <p className="px-1 text-[11px] font-bold uppercase text-zinc-400">{titulo}</p>
      {lista.map((t) => <OpcaoTarefa key={t.id} t={t} mostrarResponsavel onClick={() => escolher(t)} />)}
    </div>
  );

  return (
    <Roteiro titulo="Tarefas que passei" icone="ri-send-plane-line" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Enviando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          <Painel />
          <Secao titulo="Atrasadas" lista={atrasadas} />
          <Secao titulo="Hoje" lista={hoje} />
          <Secao titulo="Próximas" lista={proximas} />
          <Secao titulo="Sem prazo" lista={semPrazo} />
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}

      {passo === 'opcoes' && alvo && (
        <>
          <Opcao onClick={cobrar}>Cobrar</Opcao>
          <Opcao onClick={() => { r.eu('Escrever recado'); setPasso('recado'); }}>Escrever recado</Opcao>
          <Opcao onClick={() => irPara(`/tarefas?task=${alvo.id}`)}>Abrir a tarefa</Opcao>
          <OpcaoNeutra onClick={() => { r.eu('Voltar'); setAlvo(null); setPasso('lista'); }}>Voltar</OpcaoNeutra>
        </>
      )}

      {passo === 'recado' && alvo && (
        <>
          <Campo placeholder={`Recado para ${primeiroNome(alvo.assignee_name ?? '')}`} onEnviar={enviarRecado} />
          <OpcaoNeutra onClick={() => setPasso('opcoes')}>Voltar</OpcaoNeutra>
        </>
      )}

      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Tarefas', onClick: () => irPara('/tarefas') }]} />}
    </Roteiro>
  );
}
