import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Flag, Minus, Pause, Play, Plus, Search, X } from 'lucide-react';
import type { CampoCustom, TaskRow, TaskTag } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { UsuarioOption } from '../lib/agrupamento';
import type { ColunaId } from '../lib/colunas';
import CampoInput from './campos/CampoInput';
import ComentarioInput from './ComentarioInput';
import { iniciais } from './TaskCard';
import { useIsMobile } from '../lib/mobile';
import { formatarDuracao, formatarRelogio, lerDuracao, segundosRegistrados, useAgora } from '../lib/tempo';

const MARGEM_TELA = 8;

/**
 * Popover das células da Lista. `fixed` a partir do retângulo da célula (mesmo
 * motivo do StatusPicker: o card do grupo tem `overflow-hidden` e cortava o
 * menu nas últimas linhas). Fecha ao rolar/redimensionar e com Esc.
 */
export function Popover({ anchorRect, largura, onClose, children }: {
  anchorRect: DOMRect;
  largura: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchorRect.bottom + 4);
  // Celular: vira folha que sobe de baixo (largura toda, opções grandes pro dedo).
  const celular = useIsMobile();

  useEffect(() => {
    const fechar = () => onClose();
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Rolagem DENTRO do popover (lista longa) não fecha.
    const rolar = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', tecla);
    // Na folha do celular não fecha por rolagem/resize: o teclado abrindo muda o
    // tamanho da tela e fecharia a folha no meio da digitação.
    if (!celular) {
      window.addEventListener('scroll', rolar, true);
      window.addEventListener('resize', fechar);
    }
    return () => {
      window.removeEventListener('scroll', rolar, true);
      window.removeEventListener('resize', fechar);
      window.removeEventListener('keydown', tecla);
    };
  }, [onClose, celular]);

  // Depois de medir: se não couber abaixo da célula, abre pra cima.
  useEffect(() => {
    const altura = ref.current?.offsetHeight ?? 0;
    const cabeAbaixo = anchorRect.bottom + 4 + altura <= window.innerHeight - MARGEM_TELA;
    if (!cabeAbaixo && anchorRect.top - altura - 4 > MARGEM_TELA) setTop(anchorRect.top - altura - 4);
  }, [anchorRect]);

  if (celular) {
    // Direto no <body>: um ancestral com transform/backdrop-blur prenderia o `fixed`.
    return createPortal(
      <div onClick={(e) => e.stopPropagation()}>
        <div className="fixed inset-0 z-[70] bg-slate-900/30" onClick={onClose} />
        <div
          ref={ref}
          className="fixed inset-x-0 bottom-0 z-[71] bg-white rounded-t-2xl shadow-2xl px-3 pt-2 pb-[max(env(safe-area-inset-bottom),16px)] max-h-[75vh] overflow-y-auto text-left"
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
          {children}
        </div>
      </div>,
      document.body,
    );
  }

  // Alinha pela direita da célula (as colunas são alinhadas à direita).
  const left = Math.min(
    Math.max(anchorRect.right - largura, MARGEM_TELA),
    window.innerWidth - largura - MARGEM_TELA,
  );

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={ref}
        className="fixed z-50 bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-900/10 p-1.5 text-left"
        style={{ top, left, width: largura }}
      >
        {children}
      </div>
    </div>
  );
}

export function Opcao({ ativo, onClick, children }: { ativo?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 max-md:px-3 max-md:py-3 rounded-lg text-xs max-md:text-[15px] text-left transition ${
        ativo ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
      {ativo && <Check size={12} className="ml-auto shrink-0 text-indigo-500" />}
    </button>
  );
}

function Busca({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 mb-1 border-b border-slate-100">
      <Search size={12} className="text-slate-400 shrink-0" />
      <input
        autoFocus
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar…"
        className="flex-1 min-w-0 text-xs max-md:text-base outline-none bg-transparent placeholder:text-slate-300"
      />
    </div>
  );
}

function ListaUsuarios({ usuarios, atual, onEscolher }: {
  usuarios: UsuarioOption[];
  atual: string | null;
  onEscolher: (id: string | null) => void;
}) {
  const [busca, setBusca] = useState('');
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return t ? usuarios.filter((u) => u.nome.toLowerCase().includes(t)) : usuarios;
  }, [busca, usuarios]);

  return (
    <>
      {usuarios.length > 6 && <Busca valor={busca} onChange={setBusca} />}
      <div className="max-h-64 overflow-y-auto">
        <Opcao ativo={!atual} onClick={() => onEscolher(null)}>
          <span className="w-5 h-5 rounded-full border border-dashed border-slate-300 flex items-center justify-center shrink-0">
            <X size={10} className="text-slate-400" />
          </span>
          <span className="text-slate-500">Ninguém</span>
        </Opcao>
        {filtrados.map((u) => (
          <Opcao key={u.id} ativo={atual === u.id} onClick={() => onEscolher(u.id)}>
            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[9px] font-semibold shrink-0">
              {iniciais(u.nome)}
            </span>
            <span className="truncate">{u.nome}</span>
          </Opcao>
        ))}
        {filtrados.length === 0 && <p className="px-2 py-2 text-xs text-slate-400">Ninguém encontrado</p>}
      </div>
    </>
  );
}

function hojeMais(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Dia (YYYY-MM-DD) e hora (HH:MM) LOCAIS de um vencimento guardado em ISO. */
export function partesDoPrazo(iso: string | null, comHora: boolean): { dia: string | null; hora: string | null } {
  if (!iso) return { dia: null, hora: null };
  const d = new Date(iso);
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { dia, hora: comHora ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null };
}

/** Grava o vencimento: com hora = instante local exato; sem hora = meio-dia UTC (dia estável em qualquer fuso do Brasil). */
export function prazoParaGravar(dia: string | null, hora: string | null): { due_date: string | null; due_has_time: boolean } {
  if (!dia) return { due_date: null, due_has_time: false };
  if (hora) return { due_date: new Date(`${dia}T${hora}:00`).toISOString(), due_has_time: true };
  return { due_date: `${dia}T12:00:00Z`, due_has_time: false };
}

function EditorData({ atual, onEscolher, comHorario = false, horaAtual = null }: {
  atual: string | null;
  onEscolher: (dia: string | null, hora?: string | null) => void;
  /** Vencimento de tarefa: mostra o campo de horário (opcional). */
  comHorario?: boolean;
  horaAtual?: string | null;
}) {
  const [hora, setHora] = useState<string>(horaAtual ?? '');
  const atalhos = [
    { label: 'Hoje', dia: hojeMais(0) },
    { label: 'Ontem', dia: hojeMais(-1) },
    { label: 'Amanhã', dia: hojeMais(1) },
  ];
  const escolher = (dia: string | null) => onEscolher(dia, comHorario ? (hora || null) : undefined);

  return (
    <div>
      {comHorario && (
        <div className="px-1 pb-2 mb-1 border-b border-slate-100">
          <span className="block text-[10px] max-md:text-xs text-slate-400 px-1 mb-1">Horário (opcional)</span>
          <div className="flex items-center gap-1.5">
            <input
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-xs max-md:text-base max-md:py-2.5 bg-white outline-none focus:border-indigo-300"
              aria-label="Horário do vencimento"
            />
            {atual && hora && hora !== horaAtual && (
              <button type="button" onClick={() => onEscolher(atual, hora)} title="Salvar horário"
                className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shrink-0">
                <Check size={13} />
              </button>
            )}
            {horaAtual && (
              <button type="button" onClick={() => onEscolher(atual, null)}
                className="px-2 py-1.5 rounded-lg text-[11px] max-md:text-sm text-slate-500 hover:bg-slate-100 shrink-0">
                Sem horário
              </button>
            )}
          </div>
        </div>
      )}
      {atalhos.map((a) => (
        <Opcao key={a.label} ativo={atual === a.dia} onClick={() => escolher(a.dia)}>
          <span>{a.label}</span>
          <span className="ml-auto text-[10px] text-slate-400">{a.dia.slice(8, 10)}/{a.dia.slice(5, 7)}{comHorario && hora ? ` ${hora}` : ''}</span>
        </Opcao>
      ))}
      <div className="border-t border-slate-100 mt-1 pt-1.5 px-1">
        <span className="block text-[10px] max-md:text-xs text-slate-400 px-1 mb-1">Escolher data</span>
        <input
          type="date"
          defaultValue={atual ?? ''}
          // Abre o calendário com um clique em qualquer ponto do campo (não só no ícone).
          onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* navegador sem showPicker */ } }}
          onChange={(e) => escolher(e.target.value || null)}
          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs max-md:text-base max-md:py-2.5 bg-white outline-none focus:border-indigo-300"
        />
      </div>
      {atual && (
        <button
          type="button"
          onClick={() => onEscolher(null, null)}
          className="w-full mt-1 px-2 py-1.5 max-md:py-3 rounded-lg text-xs max-md:text-[15px] text-left text-red-500 hover:bg-red-50"
        >
          Remover data
        </button>
      )}
    </div>
  );
}

interface EditorCelulaProps {
  coluna: ColunaId;
  task: TaskRow;
  anchorRect: DOMRect;
  campos: CampoCustom[];
  usuarios: UsuarioOption[];
  tags: TaskTag[];
  gravar: (action: string, payload: Record<string, unknown>) => Promise<{ success: boolean }>;
  onClose: () => void;
}

/** Colunas que abrem um editor ao clicar na célula. */
export function ehEditavel(id: ColunaId): boolean {
  return id === 'responsavel' || id === 'vencimento' || id === 'prioridade' || id === 'etiquetas'
    || id === 'comentarios' || id === 'estimado' || id === 'cronometro' || id.startsWith('campo:');
}

export default function EditorCelula({ coluna, task, anchorRect, campos, usuarios, tags, gravar, onClose }: EditorCelulaProps) {
  const atualizar = (payload: Record<string, unknown>) => {
    gravar('update_task', { task_id: task.id, ...payload });
    onClose();
  };

  if (coluna.startsWith('campo:')) {
    const fieldId = coluna.slice('campo:'.length);
    const campo = campos.find((c) => c.id === fieldId);
    if (!campo) return null;
    const valor = task.field_values?.[fieldId];
    const setar = async (value: unknown) => {
      await gravar('set_field_value', { task_id: task.id, field_id: fieldId, value });
    };

    if (campo.field_type === 'dropdown') {
      return (
        <Popover anchorRect={anchorRect} largura={200} onClose={onClose}>
          <div className="max-h-64 overflow-y-auto">
            <Opcao ativo={!valor} onClick={() => { setar(null); onClose(); }}>
              <span className="text-slate-400">Nenhum</span>
            </Opcao>
            {campo.options.map((o) => (
              <Opcao key={o.id} ativo={valor === o.id} onClick={() => { setar(o.id); onClose(); }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
                <span className="truncate">{o.label}</span>
              </Opcao>
            ))}
          </div>
        </Popover>
      );
    }
    if (campo.field_type === 'user') {
      return (
        <Popover anchorRect={anchorRect} largura={220} onClose={onClose}>
          <ListaUsuarios
            usuarios={usuarios}
            atual={typeof valor === 'string' ? valor : null}
            onEscolher={(id) => { setar(id); onClose(); }}
          />
        </Popover>
      );
    }
    if (campo.field_type === 'date') {
      return (
        <Popover anchorRect={anchorRect} largura={210} onClose={onClose}>
          <EditorData
            atual={typeof valor === 'string' ? valor.slice(0, 10) : null}
            onEscolher={(dia) => { setar(dia); onClose(); }}
          />
        </Popover>
      );
    }

    // Texto, número, checkbox, etiquetas, nota… — o editor genérico, sem fechar
    // a cada mudança (texto grava no blur; etiquetas marcam várias).
    const fechaAoEscolher = campo.field_type === 'checkbox' || campo.field_type === 'rating';
    return (
      <Popover anchorRect={anchorRect} largura={campo.field_type === 'textarea' ? 280 : 230} onClose={onClose}>
        <div className="p-1" onKeyDown={(e) => { if (e.key === 'Enter' && campo.field_type !== 'textarea') (e.target as HTMLElement).blur(); }}>
          <CampoInput
            campo={campo}
            value={valor}
            usuarios={usuarios}
            onChange={async (value) => {
              await setar(value);
              if (fechaAoEscolher) onClose();
            }}
          />
        </div>
      </Popover>
    );
  }

  switch (coluna) {
    case 'responsavel':
      return (
        <Popover anchorRect={anchorRect} largura={220} onClose={onClose}>
          <ListaUsuarios usuarios={usuarios} atual={task.assignee_id} onEscolher={(id) => atualizar({ assignee_id: id })} />
        </Popover>
      );

    case 'prioridade':
      return (
        <Popover anchorRect={anchorRect} largura={170} onClose={onClose}>
          {PRIORIDADES.map((p) => (
            <Opcao key={p.value} ativo={task.priority === p.value} onClick={() => atualizar({ priority: p.value })}>
              <Flag size={12} style={{ color: p.value > 0 ? p.color : '#cbd5e1' }} className="shrink-0" />
              <span>{p.label}</span>
            </Opcao>
          ))}
        </Popover>
      );

    case 'vencimento':
      return (
        <Popover anchorRect={anchorRect} largura={230} onClose={onClose}>
          <EditorData
            comHorario
            atual={partesDoPrazo(task.due_date, task.due_has_time).dia}
            horaAtual={partesDoPrazo(task.due_date, task.due_has_time).hora}
            onEscolher={(dia, hora) => atualizar(prazoParaGravar(dia, hora ?? null))}
          />
        </Popover>
      );

    case 'estimado':
      return (
        <Popover anchorRect={anchorRect} largura={230} onClose={onClose}>
          <EditorEstimativa
            atual={task.time_estimate_minutes}
            onEscolher={(min) => atualizar({ time_estimate_minutes: min })}
          />
        </Popover>
      );

    case 'cronometro':
      return (
        <Popover anchorRect={anchorRect} largura={250} onClose={onClose}>
          <EditorCronometro task={task} gravar={gravar} />
        </Popover>
      );

    case 'etiquetas':
      return <EditorEtiquetas task={task} tags={tags} anchorRect={anchorRect} gravar={gravar} onClose={onClose} />;

    case 'comentarios':
      return (
        <Popover anchorRect={anchorRect} largura={300} onClose={onClose}>
          <div className="px-1.5 pt-1 pb-0.5">
            <p className="text-[11px] text-slate-400">
              {task.comment_count > 0
                ? `${task.comment_count} comentário${task.comment_count > 1 ? 's' : ''} — abra a tarefa para ver todos`
                : 'Nenhum comentário ainda'}
            </p>
            <ComentarioInput
              autoFocus
              usuarios={usuarios}
              onEnviar={async (body, mentions) => {
                const res = await gravar('add_comment', { task_id: task.id, body, mentions });
                if (res.success) onClose();
              }}
            />
          </div>
        </Popover>
      );

    default:
      return null;
  }
}

function EditorEtiquetas({ task, tags, anchorRect, gravar, onClose }: {
  task: TaskRow;
  tags: TaskTag[];
  anchorRect: DOMRect;
  gravar: EditorCelulaProps['gravar'];
  onClose: () => void;
}) {
  const [busca, setBusca] = useState('');
  const t = busca.trim().toLowerCase();
  const filtradas = t ? tags.filter((tag) => tag.name.toLowerCase().includes(t)) : tags;

  const alternar = (tagId: string) => {
    const atuais = task.tags.map((x) => x.id);
    const proximas = atuais.includes(tagId) ? atuais.filter((x) => x !== tagId) : [...atuais, tagId];
    gravar('update_task', { task_id: task.id, tag_ids: proximas });
  };

  return (
    <Popover anchorRect={anchorRect} largura={210} onClose={onClose}>
      {tags.length > 6 && <Busca valor={busca} onChange={setBusca} />}
      <div className="max-h-64 overflow-y-auto">
        {tags.length === 0 && <p className="px-2 py-2 text-xs text-slate-400">Nenhuma etiqueta criada</p>}
        {filtradas.map((tag) => {
          const on = task.tags.some((x) => x.id === tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => alternar(tag.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 max-md:px-3 max-md:py-3 rounded-lg text-xs max-md:text-[15px] text-left hover:bg-slate-50"
            >
              <span
                className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? '' : 'border-slate-300'}`}
                style={on ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
              >
                {on && <Check size={10} className="text-white" />}
              </span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white truncate" style={{ backgroundColor: tag.color }}>
                {tag.name}
              </span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

const PRESETS_ESTIMATIVA = [15, 30, 60, 120, 240, 480];

function EditorEstimativa({ atual, onEscolher }: { atual: number | null; onEscolher: (min: number | null) => void }) {
  const [texto, setTexto] = useState(atual ? formatarDuracao(atual * 60) : '');
  const lido = lerDuracao(texto);
  const invalido = texto.trim() !== '' && lido === null;

  return (
    <div className="p-1">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim() === '') onEscolher(null);
          else if (lido !== null) onEscolher(lido);
        }}
      >
        <input
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: 1h30, 45m, 2d"
          className={`w-full border rounded-lg px-2 py-1.5 text-xs max-md:text-base max-md:py-2.5 bg-white outline-none ${
            invalido ? 'border-red-300 focus:border-red-400' : 'border-slate-200 focus:border-indigo-300'
          }`}
        />
        <p className={`text-[10px] mt-1 px-0.5 ${invalido ? 'text-red-500' : 'text-slate-400'}`}>
          {invalido ? 'Não entendi — use 1h30, 45m ou 2d (dia = 8h)'
            : lido !== null ? `= ${formatarDuracao(lido * 60)} · Enter para salvar` : 'Enter para salvar'}
        </p>
      </form>
      <div className="grid grid-cols-3 gap-1 mt-2">
        {PRESETS_ESTIMATIVA.map((min) => (
          <button
            key={min}
            type="button"
            onClick={() => onEscolher(min)}
            className={`px-2 py-1.5 max-md:py-2.5 rounded-lg text-xs max-md:text-sm border transition ${
              atual === min ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {min === 480 ? '1 dia' : formatarDuracao(min * 60)}
          </button>
        ))}
      </div>
      {atual !== null && (
        <button
          type="button"
          onClick={() => onEscolher(null)}
          className="w-full mt-1.5 px-2 py-1.5 rounded-lg text-xs text-left text-red-500 hover:bg-red-50"
        >
          Remover estimativa
        </button>
      )}
    </div>
  );
}

function EditorCronometro({ task, gravar }: { task: TaskRow; gravar: EditorCelulaProps['gravar'] }) {
  const rodando = !!task.timer_started_at;
  const agora = useAgora(rodando);
  const total = segundosRegistrados(task, agora);
  const estimado = task.time_estimate_minutes ? task.time_estimate_minutes * 60 : null;
  const [texto, setTexto] = useState('');
  const lido = lerDuracao(texto);

  const lancar = (sinal: 1 | -1) => {
    if (!lido) return;
    gravar('add_time_entry', { task_id: task.id, minutes: sinal * lido });
    setTexto('');
  };

  return (
    <div className="p-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => gravar(rodando ? 'stop_timer' : 'start_timer', { task_id: task.id })}
          className={`w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0 transition ${
            rodando ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'
          }`}
          title={rodando ? 'Parar' : 'Iniciar'}
        >
          {rodando ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <div className="min-w-0">
          <p className={`text-lg font-semibold tabular-nums leading-tight ${rodando ? 'text-emerald-600' : 'text-slate-700'}`}>
            {formatarRelogio(total)}
          </p>
          <p className="text-[10px] text-slate-400">
            {estimado ? `de ${formatarDuracao(estimado)} estimado` : 'sem estimativa'}
          </p>
        </div>
      </div>

      {estimado !== null && (
        <div className="h-1.5 rounded-full bg-slate-100 mt-2 overflow-hidden">
          <div
            className={`h-full rounded-full ${total > estimado ? 'bg-red-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.min(100, (total / estimado) * 100)}%` }}
          />
        </div>
      )}

      <div className="border-t border-slate-100 mt-2.5 pt-2">
        <span className="block text-[10px] text-slate-400 mb-1">Esqueceu de ligar? Lance o tempo</span>
        <div className="flex items-center gap-1">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') lancar(1); }}
            placeholder="Ex.: 30m, 1h15"
            className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-xs max-md:text-base max-md:py-2.5 bg-white outline-none focus:border-indigo-300"
          />
          <button type="button" disabled={!lido} onClick={() => lancar(1)} title="Somar" className="p-1.5 rounded-lg border border-slate-200 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40">
            <Plus size={13} />
          </button>
          <button type="button" disabled={!lido} onClick={() => lancar(-1)} title="Descontar" className="p-1.5 rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 disabled:opacity-40">
            <Minus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
