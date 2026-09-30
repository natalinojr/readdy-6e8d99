// "Próximo passo" da ficha (2026-09-30): um quadro no topo com a ação que falta agora para esta
// pessoa, tirada do estado dela — pedido da IA, entrevista marcada, registro atrasado, decisão,
// triagem. Substitui botões espalhados (agendamento pela IA, decisão, agendar) por um lugar só.
import { DecidirPedido, type Sess } from '../AgendamentosPainel';
import {
  type Candidate, type Decision, type Interview, type Stage, DECISIONS, decisionOf, stageOf, withEmpresa,
} from '../../shared';
import type { SessaoIA } from '../../areas/AreaFila';

const TZ = 'America/Sao_Paulo';
const diaHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const SESS_LABEL: Record<string, string> = {
  convidado: 'A IA mandou o convite no WhatsApp e está esperando a resposta.',
  negociando: 'A IA está conversando sobre o horário no WhatsApp.',
  agendado: 'A IA marcou a entrevista.',
  recusou: 'A pessoa recusou o convite da IA.',
  sem_resposta: 'A pessoa não respondeu ao convite da IA.',
};

interface Props {
  c: Candidate; stages: Stage[]; interviews: Interview[]; sessoes: SessaoIA[]; empresa: string;
  onUpdate: (patch: Partial<Candidate>) => void;
  onAbrirEntrevista: (iv: Interview) => void;
  onRemarcar: (iv: Interview) => void;
  onAgendar: () => void;
  onSessaoAtualizada: () => void;
}

export default function ProximoPasso({ c, stages, interviews, sessoes, empresa, onUpdate, onAbrirEntrevista, onRemarcar, onAgendar, onSessaoAtualizada }: Props) {
  const agora = new Date().toISOString();
  const fase = stageOf(stages, c.stage_id);
  const kind = fase?.native_kind ?? null;
  const agendar = stages.find((s) => s.native_kind === 'agendar');
  const descartado = stages.find((s) => s.native_kind === 'descartado');
  const sess = sessoes[0] ?? null; // mais recente primeiro
  const agendadas = interviews.filter((iv) => iv.status === 'agendada').sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const proxima = agendadas.find((iv) => iv.scheduled_at >= agora) ?? null;
  const atrasada = [...agendadas].reverse().find((iv) => iv.scheduled_at < agora) ?? null;
  const ultimaRealizada = interviews.filter((iv) => iv.status === 'realizada').sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))[0] ?? null;
  const dec = decisionOf(c.decision);

  const btn = (pri?: boolean) => `px-3 h-9 rounded-lg text-xs font-bold cursor-pointer ${pri ? 'bg-violet-600 hover:bg-violet-500 text-white' : 'bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700'}`;
  let icone = 'ri-compass-3-line', titulo = '', texto: React.ReactNode = null, acoes: React.ReactNode = null;

  if (sess?.status === 'aguardando_gestor') {
    icone = 'ri-flashlight-line'; titulo = 'A IA precisa de você';
    acoes = <div className="w-full"><DecidirPedido sess={sess as unknown as Pick<Sess, 'id' | 'pending_request'>} onFeito={onSessaoAtualizada} /></div>;
  } else if (sess?.status === 'erro' && !proxima) {
    icone = 'ri-error-warning-line'; titulo = 'O convite da IA falhou';
    texto = sess.error ?? 'Não foi possível enviar.';
    acoes = <button onClick={onAgendar} className={btn(true)}>Agendar eu mesmo</button>;
  } else if (atrasada) {
    icone = 'ri-edit-2-line'; titulo = 'Registrar a entrevista';
    texto = `Era ${diaHora(atrasada.scheduled_at)} e ainda não tem registro.`;
    acoes = <button onClick={() => onAbrirEntrevista(atrasada)} className={btn(true)}>Preencher registro</button>;
  } else if (proxima) {
    icone = 'ri-calendar-event-line'; titulo = `Entrevista ${diaHora(proxima.scheduled_at)}`;
    texto = [proxima.location, proxima.interviewer ? `com ${proxima.interviewer}` : null].filter(Boolean).join(' · ') || null;
    acoes = (<>
      <button onClick={() => onAbrirEntrevista(proxima)} className={btn(true)}><i className="ri-play-fill" /> Começar entrevista</button>
      <button onClick={() => onRemarcar(proxima)} className={btn()}>Remarcar</button>
    </>);
  } else if (ultimaRealizada && !c.decision && kind !== 'descartado') {
    icone = 'ri-scales-3-line'; titulo = 'Decidir';
    texto = <>Entrevista de {diaHora(ultimaRealizada.scheduled_at)} registrada. <button onClick={() => onAbrirEntrevista(ultimaRealizada)} className="font-semibold text-violet-700 hover:underline cursor-pointer">ver registro</button></>;
    acoes = DECISIONS.map((d) => (
      <button key={d.id} title={withEmpresa(d.label, empresa)} onClick={() => onUpdate({ decision: d.id as Decision })} className={`${btn()} font-black`}>{d.sigla}</button>
    ));
  } else if (kind === 'novo') {
    icone = 'ri-inbox-2-line'; titulo = 'Olhar o currículo e decidir';
    texto = 'Chamar para entrevista, guardar no banco (R) ou descartar.';
    acoes = (<>
      {agendar && <button onClick={() => onUpdate({ stage_id: agendar.id })} className={btn(true)}><i className="ri-chat-smile-2-line" /> Chamar p/ entrevista</button>}
      <button onClick={onAgendar} className={btn()}>Agendar eu mesmo</button>
      {!c.decision && <button onClick={() => onUpdate({ decision: 'r' })} className={btn()}>Guardar</button>}
      {descartado && <button onClick={() => onUpdate({ stage_id: descartado.id })} className={btn()}>Descartar</button>}
    </>);
  } else if (kind === 'agendar') {
    icone = 'ri-robot-2-line'; titulo = 'Esperando o agendamento';
    texto = (sess && SESS_LABEL[sess.status]) ?? 'Na fila da IA: o convite sai no próximo ciclo (8h–20h) se a vaga tiver o agendamento pela IA ligado.';
    acoes = <button onClick={onAgendar} className={btn()}>Agendar eu mesmo</button>;
  } else if (kind === 'descartado') {
    icone = 'ri-close-circle-line'; titulo = 'Descartado';
    texto = 'Nada a fazer. Continua no banco para outras vagas.';
  } else if (dec) {
    icone = 'ri-checkbox-circle-line'; titulo = `Decisão: ${dec.sigla}`;
    texto = withEmpresa(dec.label, empresa);
    acoes = <button onClick={onAgendar} className={btn()}>Agendar nova entrevista</button>;
  } else {
    icone = 'ri-calendar-event-line'; titulo = 'Marcar a entrevista';
    acoes = (<>
      <button onClick={onAgendar} className={btn(true)}>Agendar entrevista</button>
      {agendar && c.stage_id !== agendar.id && <button onClick={() => onUpdate({ stage_id: agendar.id })} className={btn()}>Deixar a IA agendar</button>}
    </>);
  }

  return (
    <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/60 p-3.5">
      <p className="text-[10px] font-black uppercase tracking-wider text-violet-700">Próximo passo</p>
      <p className="font-bold text-zinc-900 mt-0.5"><i className={icone} /> {titulo}</p>
      {texto && <p className="text-xs text-zinc-600 mt-0.5">{texto}</p>}
      {acoes && <div className="flex flex-wrap gap-1.5 mt-2.5">{acoes}</div>}
    </div>
  );
}
