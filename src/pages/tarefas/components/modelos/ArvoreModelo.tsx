import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ListChecks, Repeat, User, Clock } from 'lucide-react';
import type { ModeloConteudo, OpcoesModelo, PastaModelo, TarefaModelo } from '../../lib/modeloEstrutura';
import { filtrarModelo, rotuloDia } from '../../lib/modeloEstrutura';
import { formatarDuracao } from '../../lib/tempo';

interface ArvoreModeloProps {
  conteudo: ModeloConteudo;
  opcoes: OpcoesModelo;
  /** Sem checkbox: mostra só o que vai ser criado (tela de aplicar). */
  somenteLeitura?: boolean;
  /** Com data base, as datas aparecem de verdade; sem, como "Dia +N". */
  dataBase?: string | null;
  onAlternar?: (ref: string) => void;
  nomeUsuario?: (id: string) => string | null;
}

/**
 * Pré-visualização do modelo em árvore. Na edição, cada pasta/tarefa tem uma
 * caixinha: desmarcar tira do modelo (com o que estiver dentro). O que as
 * opções deixam de fora aparece apagado.
 */
export default function ArvoreModelo({ conteudo, opcoes, somenteLeitura = false, dataBase = null, onAlternar, nomeUsuario }: ArvoreModeloProps) {
  const excluidos = useMemo(() => new Set(opcoes.excluidos), [opcoes.excluidos]);
  const filtrado = useMemo(() => filtrarModelo(conteudo, opcoes), [conteudo, opcoes]);
  // Refs que de fato entram (pra apagar o resto)
  const incluidos = useMemo(() => {
    const s = new Set<string>();
    const t = (x: TarefaModelo) => { s.add(x.ref); x.subtarefas.forEach(t); };
    const p = (x: PastaModelo) => { s.add(x.ref); x.tarefas.forEach(t); x.filhas.forEach(p); };
    p(filtrado.raiz);
    return s;
  }, [filtrado]);
  const raiz = somenteLeitura ? filtrado.raiz : conteudo.raiz;
  // Em pastas grandes, as tarefas começam recolhidas (menos a pasta principal)
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set([conteudo.raiz.ref]));
  const alternarAberta = (ref: string) => setAbertas((prev) => {
    const n = new Set(prev);
    if (n.has(ref)) n.delete(ref);
    else n.add(ref);
    return n;
  });

  const caixa = (ref: string, ativo: boolean) => (somenteLeitura ? null : (
    <input
      type="checkbox"
      checked={!excluidos.has(ref)}
      disabled={!ativo && !excluidos.has(ref)}
      onChange={() => onAlternar?.(ref)}
      className="shrink-0 accent-indigo-600 disabled:opacity-40"
      title={excluidos.has(ref) ? 'Incluir no modelo' : 'Tirar do modelo'}
    />
  ));

  const datas = (t: TarefaModelo): string | null => {
    if (!opcoes.datas) return null;
    const ini = t.start_dia !== null ? rotuloDia(t.start_dia, dataBase) : null;
    const fim = t.due_dia !== null ? `${rotuloDia(t.due_dia, dataBase)}${t.due_hora ? ` ${t.due_hora}` : ''}` : null;
    if (ini && fim) return `${ini} → ${fim}`;
    return fim ?? (ini ? `início ${ini}` : null);
  };

  const renderTarefa = (t: TarefaModelo, nivel: number): React.ReactNode => {
    const ativo = incluidos.has(t.ref);
    const quando = datas(t);
    return (
      <div key={t.ref}>
        <div
          className={`flex items-center gap-2 py-1 pr-2 text-xs ${ativo ? 'text-slate-700' : 'text-slate-300'}`}
          style={{ paddingLeft: `${nivel * 16}px` }}
        >
          {caixa(t.ref, ativo)}
          <span className={`flex-1 truncate ${excluidos.has(t.ref) ? 'line-through' : ''}`}>{t.title}</span>
          {t.concluida && <span className="shrink-0 text-[10px] px-1.5 rounded bg-emerald-50 text-emerald-600">concluída</span>}
          {opcoes.checklist && t.checklist.length > 0 && (
            <span className="shrink-0 flex items-center gap-0.5 text-slate-400"><ListChecks size={11} />{t.checklist.length}</span>
          )}
          {opcoes.estimativa && t.time_estimate_minutes ? (
            <span className="shrink-0 flex items-center gap-0.5 text-slate-400"><Clock size={11} />{formatarDuracao(t.time_estimate_minutes * 60)}</span>
          ) : null}
          {opcoes.recorrencia && t.recurrence?.freq && <Repeat size={11} className="shrink-0 text-slate-400" />}
          {opcoes.responsavel && t.assignee_id && (
            <span className="shrink-0 flex items-center gap-0.5 text-slate-400 max-w-[90px] truncate">
              <User size={11} />{nomeUsuario?.(t.assignee_id) ?? 'pessoa'}
            </span>
          )}
          {quando && <span className="shrink-0 text-[11px] text-indigo-500 tabular-nums">{quando}</span>}
        </div>
        {t.subtarefas.map((s) => renderTarefa(s, nivel + 1))}
      </div>
    );
  };

  const renderPasta = (p: PastaModelo, nivel: number, ehRaiz: boolean): React.ReactNode => {
    const ativo = incluidos.has(p.ref);
    const aberta = abertas.has(p.ref);
    const extras = [
      opcoes.status && p.statuses.length ? `${p.statuses.length} status` : null,
      opcoes.campos && p.campos.length ? `${p.campos.length} campo${p.campos.length > 1 ? 's' : ''}` : null,
      opcoes.visoes && p.visoes.length ? `${p.visoes.length} visão${p.visoes.length > 1 ? 'ões' : ''}` : null,
    ].filter(Boolean).join(' · ');
    return (
      <div key={p.ref}>
        <div
          className={`flex items-center gap-2 py-1.5 pr-2 text-sm ${ativo ? 'text-slate-800' : 'text-slate-300'}`}
          style={{ paddingLeft: `${nivel * 16}px` }}
        >
          {ehRaiz ? null : caixa(p.ref, ativo)}
          <button
            onClick={() => alternarAberta(p.ref)}
            className={`shrink-0 text-slate-300 hover:text-slate-500 ${p.tarefas.length ? '' : 'invisible'}`}
            title={aberta ? 'Esconder tarefas' : 'Mostrar tarefas'}
          >
            {aberta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color, opacity: ativo ? 1 : 0.3 }} />
          <span className={`font-medium truncate ${excluidos.has(p.ref) ? 'line-through' : ''}`}>{p.name}</span>
          <span className="text-[11px] text-slate-400 truncate">
            {p.tarefas.length ? `${p.tarefas.length} tarefa${p.tarefas.length > 1 ? 's' : ''}` : ''}
            {extras ? `${p.tarefas.length ? ' · ' : ''}${extras}` : ''}
          </span>
        </div>
        {aberta && p.tarefas.map((t) => renderTarefa(t, nivel + 2))}
        {p.filhas.map((f) => renderPasta(f, nivel + 1, false))}
      </div>
    );
  };

  return <div className="select-none">{renderPasta(raiz, 0, true)}</div>;
}
