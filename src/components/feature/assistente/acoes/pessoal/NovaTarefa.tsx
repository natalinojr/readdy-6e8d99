// Ação rápida: criar tarefa (sem IA). Mesmo caminho do módulo Tarefas:
// leitura por RPC fn_get_task_lists / fn_get_tasks (useTarefas) e gravação pela Edge task-write
// › create_task. A tarefa nasce com você como responsável (igual à ferramenta criar_tarefa do
// assistente), para aparecer em "Minhas tarefas". Data sem hora = T12:00:00Z, como o TaskDrawer.
//
// 2026-09-23: no resumo dá para trocar o responsável, pôr tempo estimado e fazer repetir (mesmas
// opções de repetição do TaskDrawer). "Tarefa recorrente" (prop `recorrente`) pergunta a repetição
// logo depois do título e exige data — é dela que a próxima ocorrência é calculada.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useEuTarefas } from '@/pages/tarefas/hooks/useEuTarefas';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { montarArvorePastas, achatarArvore } from '@/pages/tarefas/lib/pastas';
import { rotuloRecorrencia } from '@/pages/tarefas/lib/recorrencia';
import { formatarDuracao, lerDuracao } from '@/pages/tarefas/lib/tempo';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, EscolhaData, Fim, dataBR, invokeUmaVez, type AcaoProps } from '../kit';
import { carregarEquipe, type Pessoa } from '../tarefas/comum';

type Passo = 'carregando' | 'sem_pasta' | 'titulo' | 'duplicada' | 'repetir' | 'quando' | 'hora' | 'hora_campo' | 'pasta'
  | 'confirmar' | 'responsavel' | 'estimativa' | 'gravando' | 'fim';
type Recorrencia = { freq: string; interval: number };

// Mesmas opções do TaskDrawer (RECORRENCIAS).
const REPETICOES: Array<{ label: string; rec: Recorrencia }> = [
  { label: 'Todo dia', rec: { freq: 'daily', interval: 1 } },
  { label: 'Toda semana', rec: { freq: 'weekly', interval: 1 } },
  { label: 'A cada 2 semanas', rec: { freq: 'weekly', interval: 2 } },
  { label: 'Todo mês', rec: { freq: 'monthly', interval: 1 } },
];

const normalizar = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

export default function NovaTarefa({ onFechar, irPara, recorrente = false }: AcaoProps & { recorrente?: boolean }) {
  // Sem loja também (2026-09-24): quem só tem o módulo Tarefas usa com tenant nulo.
  const eu = useEuTarefas();
  const tenantId = eu.tenantId;
  const meuId = eu.id;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [pastas, setPastas] = useState<(TaskList & { profundidade: number })[]>([]);
  const [abertas, setAbertas] = useState<TaskRow[]>([]);
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState<string | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [pasta, setPasta] = useState<TaskList | null>(null);
  const [criadaId, setCriadaId] = useState<string | null>(null);
  // null = eu (o padrão de sempre).
  const [responsavel, setResponsavel] = useState<Pessoa | null>(null);
  const [equipe, setEquipe] = useState<Pessoa[] | null>(null);
  const [estimativa, setEstimativa] = useState<number | null>(null);
  const [repeticao, setRepeticao] = useState<Recorrencia | null>(null);

  useEffect(() => {
    if (!eu.pronto) return;
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
      r.bot(recorrente ? 'Qual a tarefa que se repete?' : 'Qual a tarefa?');
      setPasso('titulo');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eu.pronto]);

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
    seguirDepoisDoTitulo();
  };

  const seguirDepoisDoTitulo = () => {
    if (recorrente) { r.bot('Repete de quanto em quanto tempo?'); setPasso('repetir'); return; }
    perguntarQuando();
  };

  const perguntarQuando = () => { r.bot(recorrente ? 'Começa quando?' : 'Para quando?'); setPasso('quando'); };

  // No roteiro recorrente vem antes da data; no resumo, volta direto para a confirmação.
  const escolherRepeticao = (rec: Recorrencia | null) => {
    setRepeticao(rec);
    r.eu(rec ? rotuloRecorrencia(rec) ?? 'Repete' : 'Não repete');
    if (titulo && pasta) { setPasso('confirmar'); return; }
    perguntarQuando();
  };

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

  const pedirResponsavel = async () => {
    r.eu('Mudar responsável');
    if (!equipe) {
      if (!eu.pronto) return;
      const { pessoas, erro } = await carregarEquipe(tenantId, eu.id ? { id: eu.id, nome: eu.nome } : null);
      if (erro) { r.bot(`Não consegui abrir a equipe: ${erro}`); return; }
      setEquipe(pessoas);
    }
    r.bot('Quem fica com a tarefa?');
    setPasso('responsavel');
  };

  const escolherResponsavel = (p: Pessoa | null) => {
    setResponsavel(p && p.id !== meuId ? p : null);
    r.eu(p && p.id !== meuId ? p.nome : 'Eu');
    setPasso('confirmar');
  };

  const escolherEstimativa = (texto: string) => {
    const min = lerDuracao(texto);
    if (min == null || min <= 0 || min > 999 * 60) { r.bot('Não entendi. Ex.: 30, 1h30, 2h'); return; }
    setEstimativa(min);
    r.eu(formatarDuracao(min * 60));
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
      `Responsável: ${responsavel ? responsavel.nome : 'você'}`,
      ...(estimativa ? [`Tempo estimado: ${formatarDuracao(estimativa * 60)}`] : []),
      ...(repeticao ? [rotuloRecorrencia(repeticao) ?? 'Repete'] : []),
    ].join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passo]);

  const criar = async () => {
    if (!eu.pronto || !pasta || passo !== 'confirmar') return;
    r.eu('Criar');
    setPasso('gravando');
    const due_date = data ? (hora ? `${data}T${hora}:00-03:00` : `${data}T12:00:00Z`) : null;
    const { data: resp, error } = await invokeUmaVez<{ success?: boolean; id?: string; error?: string }>('task-write', {
      body: {
        action: 'create_task',
        active_tenant_id: tenantId,
        list_id: pasta.id,
        title: titulo,
        assignee_id: responsavel?.id ?? meuId,
        due_date,
        due_has_time: !!(data && hora),
        time_estimate_minutes: estimativa,
        recurrence: repeticao,
      },
    });
    if (error || !resp?.success) {
      r.bot(`❌ Não criei a tarefa: ${resp?.error ?? error?.message ?? 'erro desconhecido'}. Confira na tela Tarefas antes de tentar de novo.`);
    } else {
      r.bot(`✅ Tarefa criada em ${pasta.name}.${responsavel ? ` ${responsavel.nome} recebe o aviso.` : ''}`);
      setCriadaId(resp.id ?? null);
    }
    setPasso('fim');
  };

  return (
    <Roteiro titulo={recorrente ? 'Tarefa recorrente' : 'Nova tarefa'} icone={recorrente ? 'ri-repeat-line' : 'ri-checkbox-circle-line'} cor="bg-indigo-50 text-indigo-600" baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Criando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'titulo' && <Campo placeholder={recorrente ? 'Ex.: Conferir validade da câmara fria' : 'Ex.: Ligar para o contador'} onEnviar={enviarTitulo} />}

      {passo === 'duplicada' && (
        <>
          <Opcao onClick={() => { r.eu('Criar mesmo assim'); seguirDepoisDoTitulo(); }}>Criar mesmo assim</Opcao>
          <Opcao onClick={() => { r.eu('Mudar o título'); r.bot('Qual a tarefa?'); setPasso('titulo'); }}>Mudar o título</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}

      {passo === 'repetir' && (
        <>
          {REPETICOES.map((o) => <Opcao key={o.label} onClick={() => escolherRepeticao(o.rec)}>{o.label}</Opcao>)}
          {!recorrente || (titulo && pasta) ? <OpcaoNeutra onClick={() => escolherRepeticao(null)}>Não repete</OpcaoNeutra> : null}
        </>
      )}

      {passo === 'quando' && (
        <>
          <EscolhaData opcoes={['hoje', 'amanha']} permitirFuturo onEscolher={(iso) => escolherData(iso)} />
          {!recorrente && <OpcaoNeutra onClick={() => escolherData(null)}>Sem data</OpcaoNeutra>}
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
          <div className="grid grid-cols-3 gap-1.5">
            <OpcaoNeutra onClick={pedirResponsavel}><i className="ri-user-line mr-1" />Responsável</OpcaoNeutra>
            <OpcaoNeutra onClick={() => { r.eu('Tempo estimado'); r.bot('Quanto tempo leva?'); setPasso('estimativa'); }}><i className="ri-hourglass-line mr-1" />Tempo</OpcaoNeutra>
            <OpcaoNeutra onClick={() => { r.eu('Repetir'); r.bot('Repete de quanto em quanto tempo?'); setPasso('repetir'); }}><i className="ri-repeat-line mr-1" />Repetir</OpcaoNeutra>
          </div>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}

      {passo === 'responsavel' && (
        <>
          <Opcao onClick={() => escolherResponsavel(null)}>Eu</Opcao>
          {(equipe ?? []).filter((p) => p.id !== meuId).map((p) => (
            <Opcao key={p.id} onClick={() => escolherResponsavel(p)}>{p.nome}</Opcao>
          ))}
          <OpcaoNeutra onClick={() => setPasso('confirmar')}>Voltar</OpcaoNeutra>
        </>
      )}

      {passo === 'estimativa' && (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {['15', '30', '1h', '2h'].map((v) => <Opcao key={v} onClick={() => escolherEstimativa(v)}>{v === '15' || v === '30' ? `${v} min` : v}</Opcao>)}
          </div>
          <Campo placeholder="Ex.: 1h30, 45, 3h" onEnviar={escolherEstimativa} />
          {estimativa != null && <OpcaoNeutra onClick={() => { setEstimativa(null); r.eu('Sem estimativa'); setPasso('confirmar'); }}>Sem estimativa</OpcaoNeutra>}
          <OpcaoNeutra onClick={() => setPasso('confirmar')}>Voltar</OpcaoNeutra>
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
