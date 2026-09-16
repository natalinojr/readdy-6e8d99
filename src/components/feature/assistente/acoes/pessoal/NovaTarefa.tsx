// Ação rápida: criar tarefa (sem IA). Mesmo caminho do módulo Tarefas:
// leitura por RPC fn_get_task_lists / fn_get_tasks (useTarefas) e gravação pela Edge task-write
// › create_task. A tarefa nasce com você como responsável (igual à ferramenta criar_tarefa do
// assistente), para aparecer em "Minhas tarefas". Data sem hora = T12:00:00Z, como o TaskDrawer.
import { useEffect, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { montarArvorePastas, achatarArvore } from '@/pages/tarefas/lib/pastas';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, EscolhaData, Fim, dataBR, type AcaoProps } from '../kit';

type Passo = 'carregando' | 'sem_pasta' | 'titulo' | 'duplicada' | 'quando' | 'hora' | 'hora_campo' | 'pasta' | 'confirmar' | 'gravando' | 'fim';

const normalizar = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

export default function NovaTarefa({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const meuId = user?.id ?? null;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [pastas, setPastas] = useState<(TaskList & { profundidade: number })[]>([]);
  const [abertas, setAbertas] = useState<TaskRow[]>([]);
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState<string | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [pasta, setPasta] = useState<TaskList | null>(null);
  const [criadaId, setCriadaId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) { r.bot('Sem loja ativa.'); setPasso('fim'); return; }
    (async () => {
      const [l, t] = await Promise.all([
        supabase.rpc('fn_get_task_lists', { p_tenant_id: tenantId }),
        supabase.rpc('fn_get_tasks', { p_tenant_id: tenantId }),
      ]);
      if (l.error || t.error) { r.bot(`Não consegui abrir as Tarefas: ${(l.error ?? t.error)?.message ?? 'erro'}`); setPasso('fim'); return; }
      const listas = (l.data as TaskList[]) ?? [];
      const tarefas = (t.data as TaskRow[]) ?? [];
      setPastas(achatarArvore(montarArvorePastas(listas)));
      setAbertas(tarefas.filter((x) => x.status_category !== 'done' && x.status_category !== 'cancelled' && (x.created_by === meuId || x.assignee_id === meuId)));
      if (!listas.length) { r.bot('Você ainda não tem nenhuma pasta. Crie uma na tela Tarefas.'); setPasso('sem_pasta'); return; }
      r.bot('Qual a tarefa?');
      setPasso('titulo');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enviarTitulo = (t: string) => {
    const limpo = t.trim().slice(0, 200);
    if (limpo.length < 2) { r.bot('Título muito curto.'); return; }
    r.eu(limpo);
    setTitulo(limpo);
    const igual = abertas.find((x) => normalizar(x.title) === normalizar(limpo));
    if (igual) {
      r.bot(`Já existe uma tarefa aberta com esse título${igual.list_name ? ` (pasta ${igual.list_name})` : ''}${igual.due_date ? `, prazo ${dataBR(igual.due_date)}` : ''}. Criar outra mesmo assim?`);
      setPasso('duplicada');
      return;
    }
    perguntarQuando();
  };

  const perguntarQuando = () => { r.bot('Para quando?'); setPasso('quando'); };

  const escolherData = (iso: string | null) => {
    setData(iso);
    r.eu(iso ? dataBR(iso) : 'Sem data');
    if (!iso) { setHora(null); perguntarPasta(); return; }
    r.bot('Tem horário?');
    setPasso('hora');
  };

  const escolherHora = (h: string | null) => {
    if (h && !/^\d{2}:\d{2}$/.test(h)) { r.bot('Horário inválido. Ex.: 09:30'); return; }
    setHora(h);
    r.eu(h ?? 'Sem horário');
    perguntarPasta();
  };

  const perguntarPasta = () => {
    if (pastas.length === 1) { escolherPasta(pastas[0], true); return; }
    r.bot('Em qual pasta?');
    setPasso('pasta');
  };

  const escolherPasta = (p: TaskList, automatico = false) => {
    setPasta(p);
    if (!automatico) r.eu(p.name);
    setPasso('confirmar');
  };

  // Resumo aparece quando chega em 'confirmar' (estado já atualizado).
  useEffect(() => {
    if (passo !== 'confirmar' || !pasta) return;
    r.bot([
      '*Confere a tarefa:*',
      `Título: ${titulo}`,
      `Prazo: ${data ? `${dataBR(data)}${hora ? ` às ${hora}` : ''}` : 'sem data'}`,
      `Pasta: ${pasta.name}`,
      'Responsável: você',
    ].join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passo]);

  const criar = async () => {
    if (!tenantId || !pasta || passo !== 'confirmar') return;
    r.eu('Criar');
    setPasso('gravando');
    const due_date = data ? (hora ? `${data}T${hora}:00-03:00` : `${data}T12:00:00Z`) : null;
    const { data: resp, error } = await invokeWithAuth<{ success?: boolean; id?: string; error?: string }>('task-write', {
      body: {
        action: 'create_task',
        active_tenant_id: tenantId,
        list_id: pasta.id,
        title: titulo,
        assignee_id: meuId,
        due_date,
        due_has_time: !!(data && hora),
      },
    });
    if (error || !resp?.success) {
      r.bot(`❌ Não criei a tarefa: ${resp?.error ?? error?.message ?? 'erro desconhecido'}. Confira na tela Tarefas antes de tentar de novo.`);
    } else {
      r.bot(`✅ Tarefa criada em ${pasta.name}.`);
      setCriadaId(resp.id ?? null);
    }
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Nova tarefa" icone="ri-checkbox-circle-line" cor="bg-indigo-50 text-indigo-600" baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Criando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'titulo' && <Campo placeholder="Ex.: Ligar para o contador" onEnviar={enviarTitulo} />}

      {passo === 'duplicada' && (
        <>
          <Opcao onClick={() => { r.eu('Criar mesmo assim'); perguntarQuando(); }}>Criar mesmo assim</Opcao>
          <Opcao onClick={() => { r.eu('Mudar o título'); r.bot('Qual a tarefa?'); setPasso('titulo'); }}>Mudar o título</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}

      {passo === 'quando' && (
        <>
          <EscolhaData opcoes={['hoje', 'amanha']} permitirFuturo onEscolher={(iso) => escolherData(iso)} />
          <OpcaoNeutra onClick={() => escolherData(null)}>Sem data</OpcaoNeutra>
        </>
      )}

      {passo === 'hora' && (
        <>
          <Opcao onClick={() => escolherHora(null)}>Sem horário</Opcao>
          <Opcao onClick={() => setPasso('hora_campo')}>Escolher horário</Opcao>
        </>
      )}
      {passo === 'hora_campo' && <Campo placeholder="Horário" tipo="time" onEnviar={(h) => escolherHora(h)} />}

      {passo === 'pasta' && pastas.map((p) => (
        <Opcao key={p.id} onClick={() => escolherPasta(p)} detalhe={p.open_count ? `(${p.open_count} abertas)` : undefined}>
          {p.profundidade > 0 ? `${'· '.repeat(p.profundidade)}` : ''}{p.name}
        </Opcao>
      ))}

      {passo === 'confirmar' && (
        <>
          <Opcao onClick={criar}>Criar tarefa</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}

      {(passo === 'fim' || passo === 'sem_pasta') && (
        <Fim onFechar={onFechar} acoes={[
          criadaId
            ? { label: 'Abrir a tarefa', onClick: () => irPara(`/tarefas?task=${criadaId}`) }
            : { label: 'Abrir Tarefas', onClick: () => irPara('/tarefas') },
        ]} />
      )}
    </Roteiro>
  );
}
