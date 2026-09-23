// Ação rápida: passar a responsabilidade de uma tarefa para outra pessoa (sem IA). Mesmo caminho
// da janela da tarefa: task-write › update_task { assignee_id } (a Edge já notifica quem recebeu) e,
// opcionalmente, add_comment { body } com um recado — notify() do add_comment avisa o novo responsável.
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, type AcaoProps } from '../kit';
import { BuscaTarefa, COR_TAREFAS, OpcaoTarefa, Pessoa, carregarEquipe, carregarTarefas, filtrarPorTexto, gravarTarefa, ordenarPorPrazo } from './comum';

type Passo = 'carregando' | 'lista' | 'pessoa' | 'confirmar' | 'gravando' | 'recado' | 'gravando_recado' | 'fim';

const primeiroNome = (nome: string) => nome.trim().split(' ')[0] || 'responsável';

export default function PassarTarefa({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const meuId = user?.id ?? null;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [busca, setBusca] = useState('');
  const [alvo, setAlvo] = useState<TaskRow | null>(null);
  const [destino, setDestino] = useState<Pessoa | null>(null);

  useEffect(() => {
    if (!tenantId || !meuId) { r.bot('Sem loja ativa.'); setPasso('fim'); return; }
    (async () => {
      const [{ tarefas: todas, erro }, { pessoas: equipe, erro: erroEquipe }] = await Promise.all([
        carregarTarefas(tenantId), carregarEquipe(tenantId),
      ]);
      if (erro) { r.bot(`Não consegui abrir as Tarefas: ${erro}`); setPasso('fim'); return; }
      if (erroEquipe) { r.bot(`Não consegui abrir a equipe: ${erroEquipe}`); setPasso('fim'); return; }
      const minhas = ordenarPorPrazo(todas.filter((t) => t.created_by === meuId || t.assignee_id === meuId));
      setTarefas(minhas);
      setPessoas(equipe);
      if (!minhas.length) { r.bot('Você não tem nenhuma tarefa para passar.'); setPasso('fim'); return; }
      r.bot('Qual tarefa você quer passar para outra pessoa?');
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolherTarefa = (t: TaskRow) => {
    setAlvo(t);
    setBusca('');
    r.eu(t.title);
    r.bot('Para quem?');
    setPasso('pessoa');
  };

  const escolherPessoa = (p: Pessoa) => {
    setDestino(p);
    r.eu(p.nome);
    r.bot(`Passar "${alvo?.title}" de ${alvo?.assignee_name ?? 'sem responsável'} para ${p.nome}? ${primeiroNome(p.nome)} recebe o aviso.`);
    setPasso('confirmar');
  };

  const passar = async () => {
    if (!alvo || !destino || !tenantId || passo !== 'confirmar') return;
    r.eu('Confirmar');
    setPasso('gravando');
    const { erro } = await gravarTarefa(tenantId, 'update_task', { task_id: alvo.id, assignee_id: destino.id });
    if (erro) { r.bot(`❌ Não passei: ${erro}.`); setPasso('confirmar'); return; }
    setTarefas((l) => l.map((t) => (t.id === alvo.id ? { ...t, assignee_id: destino.id, assignee_name: destino.nome } : t)));
    r.bot(`✅ "${alvo.title}" agora é de ${destino.nome}.`);
    r.bot(`Deixar um recado para ${primeiroNome(destino.nome)}? (opcional)`);
    setPasso('recado');
  };

  const enviarRecado = async (texto: string) => {
    if (!alvo || !tenantId || passo !== 'recado') return;
    r.eu(texto);
    setPasso('gravando_recado');
    const { erro } = await gravarTarefa(tenantId, 'add_comment', { task_id: alvo.id, body: texto });
    if (erro) { r.bot(`❌ Não enviei o recado: ${erro}.`); setPasso('fim'); return; }
    r.bot('✅ Recado enviado.');
    setPasso('fim');
  };

  const semRecado = () => { r.eu('Sem recado'); setPasso('fim'); };

  const pessoasFiltradas = filtrarPorTexto2(pessoas.filter((p) => p.id !== alvo?.assignee_id), busca);

  return (
    <Roteiro titulo="Passar tarefa" icone="ri-user-shared-2-line" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando' || passo === 'gravando_recado'}
      textoCarregando={passo === 'gravando' ? 'Passando…' : passo === 'gravando_recado' ? 'Enviando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando' || passo === 'gravando_recado'}>
      {passo === 'lista' && (
        <>
          {tarefas.length > 8 && <BuscaTarefa valor={busca} onMudar={setBusca} />}
          {filtrarPorTexto(tarefas, busca).map((t) => <OpcaoTarefa key={t.id} t={t} mostrarResponsavel onClick={() => escolherTarefa(t)} />)}
          <Opcao onClick={() => irPara('/tarefas')}>Abrir Tarefas</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}

      {passo === 'pessoa' && (
        <>
          {pessoas.length > 8 && <BuscaTarefa valor={busca} onMudar={setBusca} />}
          {pessoasFiltradas.map((p) => <Opcao key={p.id} onClick={() => escolherPessoa(p)}>{p.nome}</Opcao>)}
          {!pessoasFiltradas.length && <p className="px-1 text-xs text-zinc-500">Ninguém encontrado.</p>}
          <OpcaoNeutra onClick={() => { r.eu('Voltar'); setAlvo(null); setBusca(''); setPasso('lista'); }}>Voltar</OpcaoNeutra>
        </>
      )}

      {passo === 'confirmar' && (
        <>
          <Opcao onClick={passar}>Confirmar</Opcao>
          <OpcaoNeutra onClick={() => { r.eu('Cancelar'); setDestino(null); setPasso('pessoa'); }}>Cancelar</OpcaoNeutra>
        </>
      )}

      {passo === 'recado' && (
        <>
          <Campo placeholder={`Recado para ${destino ? primeiroNome(destino.nome) : ''} (opcional)`} onEnviar={enviarRecado} />
          <OpcaoNeutra onClick={semRecado}>Sem recado</OpcaoNeutra>
        </>
      )}

      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          ...(alvo ? [{ label: 'Abrir a tarefa', onClick: () => irPara(`/tarefas?task=${alvo.id}`) }] : []),
          {
            label: 'Passar outra', onClick: () => {
              r.eu('Passar outra');
              setAlvo(null); setDestino(null); setBusca('');
              r.bot('Qual tarefa você quer passar para outra pessoa?');
              setPasso('lista');
            },
          },
        ]} />
      )}
    </Roteiro>
  );
}

function filtrarPorTexto2(pessoas: Pessoa[], termo: string) {
  const n = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = n(termo.trim());
  return q ? pessoas.filter((p) => n(p.nome).includes(q)) : pessoas;
}
