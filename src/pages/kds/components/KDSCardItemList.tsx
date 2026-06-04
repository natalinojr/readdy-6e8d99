import { memo, useState, useRef, useCallback, useEffect } from 'react';
import type { KDSPedido, KDSItem, KDSItemStatus, KDSSubParte, KDSUnidade, KDSComboChild } from '@/types/kds';
import {
  useKDSTick, getItemFase, getSLALevel, formatDuration,
  SLA_COLORS,
} from '@/hooks/useKDSTick';
import KDSCardTimeline from './KDSCardTimeline';
import { deriveItemStatus } from './KDSCard';
import FichaTecnicaKDSModal from './FichaTecnicaKDSModal';

// ── Shared constants ───────────────────────────────────────────────────────────

const STATUS_ITEM_COLORS: Record<KDSItemStatus, string> = {
  novo:     'bg-amber-100 text-amber-700 border border-amber-300',
  preparo:  'bg-yellow-100 text-yellow-700 border border-yellow-300',
  pronto:   'bg-green-100 text-green-700 border border-green-300',
  entregue: 'bg-zinc-100 text-zinc-500 border border-zinc-300',
};

const NEXT_STATUS: Record<KDSItemStatus, KDSItemStatus | null> = {
  novo: 'preparo', preparo: 'pronto', pronto: 'entregue', entregue: null,
};

const NEXT_ACTION_LABEL: Record<KDSItemStatus, string> = {
  novo: 'Iniciar', preparo: 'Pronto', pronto: 'Entregar', entregue: '',
};

const NEXT_ACTION_COLOR: Record<KDSItemStatus, string> = {
  novo:     'bg-amber-500 hover:bg-amber-600 text-white',
  preparo:  'bg-green-500 hover:bg-green-600 text-white',
  pronto:   'bg-zinc-700 hover:bg-zinc-800 text-white',
  entregue: '',
};

const ESTACAO_COLORS: Record<string, string> = {
  Grelha:      'bg-red-100 text-red-700 border-red-200',
  Frituras:    'bg-yellow-100 text-yellow-700 border-yellow-200',
  Balcão:      'bg-teal-100 text-teal-700 border-teal-200',
  Confeitaria: 'bg-pink-100 text-pink-700 border-pink-200',
};

function getEstacaoColor(estacao: string): string {
  return ESTACAO_COLORS[estacao] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
}

// ── ObsLivreBox ────────────────────────────────────────────────────────────────

const ObsLivreBox = memo(function ObsLivreBox({ item, pedidoId, onSetObsLivre }: {
  item: KDSItem;
  pedidoId: string;
  onSetObsLivre: (pedidoId: string, itemId: string, obs: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(item.observacaoLivre ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const salvar = () => {
    onSetObsLivre(pedidoId, item.id, texto.trim());
    setEditando(false);
  };

  // Scroll suave para evitar que o teclado do tablet cubra o campo
  const handleFocus = useCallback(() => {
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  }, []);

  const handleAbrir = useCallback(() => {
    setTexto(item.observacaoLivre ?? '');
    setEditando(true);
    // Aguarda render do textarea e então faz scroll
    setTimeout(() => {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }, [item.observacaoLivre]);

  if (!editando && !item.observacaoLivre) {
    return (
      <button
        onClick={handleAbrir}
        className="flex items-center gap-1 text-[9px] text-zinc-400 hover:text-amber-600 transition-colors cursor-pointer mt-1"
      >
        <i className="ri-add-line text-[9px]" />
        <span>Adicionar obs. livre</span>
      </button>
    );
  }

  if (!editando && item.observacaoLivre) {
    return (
      <button
        onClick={handleAbrir}
        className="flex items-start gap-1.5 mt-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-left w-full cursor-pointer hover:bg-amber-100 transition-colors"
      >
        <i className="ri-pencil-line text-[9px] text-amber-500 mt-0.5 flex-shrink-0" />
        <span className="text-[10px] text-amber-700 font-medium break-words flex-1">{item.observacaoLivre}</span>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="mt-1.5 space-y-1">
      <textarea
        ref={textareaRef}
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onFocus={handleFocus}
        placeholder="Observação livre para a cozinha..."
        rows={2}
        className="w-full text-xs bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1.5 text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-amber-500 resize-none"
      />
      <div className="flex gap-1.5">
        <button onClick={salvar} className="flex-1 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap">
          <i className="ri-check-line mr-0.5" />Salvar
        </button>
        <button onClick={() => { setTexto(item.observacaoLivre ?? ''); setEditando(false); }} className="px-2 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-500 text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap">
          Cancelar
        </button>
        {item.observacaoLivre && (
          <button onClick={() => { onSetObsLivre(pedidoId, item.id, ''); setTexto(''); setEditando(false); }} className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-500 text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap">
            <i className="ri-delete-bin-line" />
          </button>
        )}
      </div>
    </div>
  );
});

// ── ComboChildrenList ─────────────────────────────────────────────────────────
// BUG 3.3 FIX: renderiza os itens filhos de um combo indentados abaixo do pai

const ComboChildrenList = memo(function ComboChildrenList({ children }: { children: KDSComboChild[] }) {
  if (!children || children.length === 0) return null;
  const fmtPrice = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="mt-1.5 ml-3 space-y-0.5 border-l-2 border-orange-200 pl-2">
      <div className="flex items-center gap-1 mb-1">
        <i className="ri-git-branch-line text-[10px] text-orange-500" />
        <span className="text-[9px] font-black text-orange-600 uppercase tracking-wide">Itens do Combo</span>
      </div>
      {children.map((child, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-orange-600 w-5 text-right flex-shrink-0">
            {child.quantidade}x
          </span>
          <span className="text-[11px] text-zinc-700 flex-1 truncate">{child.nome}</span>
          {child.unitPrice != null && child.unitPrice > 0 && (
            <span className="text-[9px] text-zinc-400 flex-shrink-0">
              {fmtPrice(child.unitPrice)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
});

// ── SubParteRow ────────────────────────────────────────────────────────────────

const SubParteRow = memo(function SubParteRow({ parte, pedidoId, itemId, onAvancarParte, showTimer, entroKdsEm, index, isCancelledOrder }: {
  parte: KDSSubParte; pedidoId: string; itemId: string;
  onAvancarParte: (pedidoId: string, itemId: string, parteId: string, novoStatus: KDSItemStatus) => void;
  showTimer: boolean; entroKdsEm: number; index: number; isCancelledOrder?: boolean;
}) {
  useKDSTick();
  const nextStatus = isCancelledOrder ? null : NEXT_STATUS[parte.status];
  const fase = getItemFase(parte.status, parte.iniciouPreparoEm, parte.ficouProntoEm);
  const now = Date.now();
  let faseElapsed = 0; let faseLabelStr = ''; let faseColor = 'text-zinc-400';
  if (fase === 'aguardando') { faseElapsed = Math.floor((now - entroKdsEm) / 1000); faseLabelStr = `Ag. início: ${formatDuration(faseElapsed)}`; faseColor = 'text-amber-500'; }
  else if (fase === 'preparo' && parte.iniciouPreparoEm) { faseElapsed = Math.floor((now - parte.iniciouPreparoEm) / 1000); faseLabelStr = `Preparo: ${formatDuration(faseElapsed)}`; faseColor = 'text-yellow-600'; }
  else if (fase === 'pronto_aguardando' && parte.ficouProntoEm) { faseElapsed = Math.floor((now - parte.ficouProntoEm) / 1000); faseLabelStr = `Pronto há: ${formatDuration(faseElapsed)}`; faseColor = 'text-green-600'; }
  const slaLevel = getSLALevel(faseElapsed, parte.slaMinutos);
  const rowBg = index % 2 === 0 ? '' : 'bg-zinc-50/60 rounded-lg';
  return (
    <div className={`flex items-center gap-2 py-1.5 pl-3 border-l-2 border-zinc-100 ml-2 ${rowBg}`}>
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${getEstacaoColor(parte.estacao)}`}>{parte.estacao}</span>
      <span className="text-xs text-zinc-700 flex-1 truncate">{parte.nome}</span>
      {showTimer && parte.status !== 'entregue' && faseLabelStr && <span className={`text-[10px] font-bold tabular-nums flex-shrink-0 ${SLA_COLORS[slaLevel]}`}>{faseLabelStr}</span>}
      {nextStatus && <button onClick={() => onAvancarParte(pedidoId, itemId, parte.id, nextStatus)} className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${NEXT_ACTION_COLOR[parte.status]}`}>{NEXT_ACTION_LABEL[parte.status]}</button>}
    </div>
  );
});

// ── UnidadeObsGate ─────────────────────────────────────────────────────────────
// Mini-modal inline para confirmar observações e opções antes de avançar unidade

interface UnidadeObsGateProps {
  observacoes: string[];
  opcoes: { grupoNome: string; opcaoNome: string }[];
  tipo: 'iniciar' | 'pronto';
  onConfirm: () => void;
  onCancel: () => void;
}

const UnidadeObsGate = memo(function UnidadeObsGate({ observacoes, opcoes, tipo, onConfirm, onCancel }: UnidadeObsGateProps) {
  const [checadas, setChecadas] = useState<Set<string>>(new Set());
  const modalRef = useRef<HTMLDivElement>(null);

  // Ancora o modal no topo para não ficar atrás do teclado virtual no tablet
  useEffect(() => {
    const scrollToModal = () => {
      modalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const timer = setTimeout(scrollToModal, 50);
    window.addEventListener('resize', scrollToModal);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', scrollToModal);
    };
  }, []);

  const toggle = (key: string) => {
    setChecadas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Todas as chaves que precisam ser confirmadas: opções + observações
  const opcaoKeys = opcoes.map((o) => `${o.grupoNome}: ${o.opcaoNome}`);
  const allKeys = [...opcaoKeys, ...observacoes];

  const todasChecadas = allKeys.every((k) => checadas.has(k));
  const titulo = tipo === 'iniciar' ? 'Confirme antes de iniciar' : 'Confirme antes de marcar pronto';
  const confirmLabel = tipo === 'iniciar' ? 'Confirmei — Iniciar' : 'Confirmei — Pronto';

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 overflow-y-auto pt-4 pb-8"
      onClick={onCancel}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-2xl w-full max-w-sm mx-4 overflow-hidden flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-4 py-3 border-b border-zinc-100 ${tipo === 'pronto' ? 'bg-green-50' : 'bg-amber-50'}`}>
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 ${tipo === 'pronto' ? 'bg-green-500' : 'bg-amber-500'}`}>
              <i className={`text-white text-sm ${tipo === 'pronto' ? 'ri-checkbox-circle-line' : 'ri-alert-line'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-zinc-900 text-sm">{titulo}</h3>
              <p className="text-[11px] text-zinc-500">
                {opcoes.length > 0 && observacoes.length > 0
                  ? 'Confirme as opções e observações desta unidade'
                  : opcoes.length > 0
                    ? 'Confirme as opções selecionadas desta unidade'
                    : 'Leia e confirme cada observação desta unidade'}
              </p>
            </div>
            <button onClick={onCancel} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-zinc-200 text-zinc-400 cursor-pointer flex-shrink-0">
              <i className="ri-close-line text-sm" />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1 bg-zinc-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${tipo === 'pronto' ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: allKeys.length > 0 ? `${(checadas.size / allKeys.length) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-[10px] font-bold text-zinc-500">{checadas.size}/{allKeys.length}</span>
          </div>
        </div>

        <div className="px-4 py-3 space-y-2 max-h-[55vh] overflow-y-auto">
          {/* Opções — bloco índigo */}
          {opcoes.length > 0 && (
            <>
              <div className="flex items-center gap-1 mb-1">
                <i className="ri-list-check-3 text-[10px] text-indigo-500" />
                <span className="text-[9px] font-black text-indigo-600 uppercase tracking-wide">Opções selecionadas</span>
              </div>
              {opcoes.map((op, idx) => {
                const key = `${op.grupoNome}: ${op.opcaoNome}`;
                const checked = checadas.has(key);
                return (
                  <button
                    key={`op-${idx}`}
                    onClick={() => toggle(key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left cursor-pointer transition-all ${checked ? 'bg-green-50 border-green-300' : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100'}`}
                  >
                    <div className={`w-4 h-4 flex items-center justify-center rounded border-2 flex-shrink-0 transition-all ${checked ? 'bg-green-500 border-green-500' : 'bg-white border-indigo-400'}`}>
                      {checked && <i className="ri-check-line text-white text-[9px]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[9px] text-zinc-400">{op.grupoNome}</span>
                      <p className={`text-xs font-bold truncate ${checked ? 'text-green-700 line-through decoration-green-400' : 'text-indigo-800'}`}>{op.opcaoNome}</p>
                    </div>
                    {!checked && <span className="text-[9px] font-bold text-indigo-500 whitespace-nowrap"><i className="ri-error-warning-line mr-0.5" />ok</span>}
                  </button>
                );
              })}
            </>
          )}

          {/* Observações — bloco âmbar */}
          {observacoes.length > 0 && (
            <>
              {opcoes.length > 0 && (
                <div className="flex items-center gap-1 mb-1 mt-1">
                  <i className="ri-alert-fill text-[10px] text-amber-500" />
                  <span className="text-[9px] font-black text-amber-600 uppercase tracking-wide">Observações</span>
                </div>
              )}
              {observacoes.map((obs, idx) => {
                const checked = checadas.has(obs);
                return (
                  <button
                    key={`obs-${idx}`}
                    onClick={() => toggle(obs)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left cursor-pointer transition-all ${checked ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-200 hover:bg-amber-100'}`}
                  >
                    <div className={`w-4 h-4 flex items-center justify-center rounded border-2 flex-shrink-0 transition-all ${checked ? 'bg-green-500 border-green-500' : 'bg-white border-amber-400'}`}>
                      {checked && <i className="ri-check-line text-white text-[9px]" />}
                    </div>
                    <span className={`text-xs font-semibold flex-1 ${checked ? 'text-green-700 line-through decoration-green-400' : 'text-amber-800'}`}>{obs}</span>
                    {!checked && <span className="text-[9px] font-bold text-amber-500 whitespace-nowrap"><i className="ri-error-warning-line mr-0.5" />confirmar</span>}
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-100 flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => { if (todasChecadas) onConfirm(); }}
            disabled={!todasChecadas}
            className={`flex-1 py-2 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors ${todasChecadas ? tipo === 'pronto' ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-amber-500 hover:bg-amber-600 text-zinc-900' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'}`}
          >
            {todasChecadas ? <><i className={`mr-1 ${tipo === 'pronto' ? 'ri-checkbox-circle-line' : 'ri-play-line'}`} />{confirmLabel}</> : <><i className="ri-lock-line mr-1" />Confirme tudo</>}
          </button>
        </div>
      </div>
    </div>
  );
});

// ── UnidadeRow ─────────────────────────────────────────────────────────────────

const UnidadeRow = memo(function UnidadeRow({ unidade, pedidoId, itemId, operadoresDisponiveis, onAvancarUnidade, onSelecionarOperadorUnidade, observacoesGlobaisItem, opcoesItem, faseColuna, isCancelledOrder, isKioskNaoPago, isPdvEditing }: {
  unidade: KDSUnidade; pedidoId: string; itemId: string; operadoresDisponiveis: string[];
  onAvancarUnidade: (pedidoId: string, itemId: string, unidadeId: string, novoStatus: KDSItemStatus) => void;
  onSelecionarOperadorUnidade: (pedidoId: string, itemId: string, unidadeId: string, operador: string) => void;
  /**
   * Obs globais do item (sem prefixo Un.X) — exibidas em TODAS as unidades.
   * Obs específicas da unidade ficam em `unidade.observacao` e são exibidas apenas nela.
   */
  observacoesGlobaisItem: string[];
  /** Opções do item pai — também exigem confirmação antes de avançar */
  opcoesItem: { grupoNome: string; opcaoNome: string }[];
  faseColuna?: KDSItemStatus; isCancelledOrder?: boolean; isKioskNaoPago?: boolean; isPdvEditing?: boolean;
}) {
  useKDSTick();
  const [obsGateTarget, setObsGateTarget] = useState<{ tipo: 'iniciar' | 'pronto'; nextStatus: KDSItemStatus } | null>(null);

  const nextStatus = NEXT_STATUS[unidade.status];
  const semOperador = !unidade.operadorPreparo && unidade.status === 'novo';
  const canceladoBloqueio = !!isCancelledOrder;
  const pdvEditingBloqueio = !!isPdvEditing;
  const kioskBloqueioEntrega = !!isKioskNaoPago && nextStatus === 'entregue';

  // Obs específica desta unidade (ex: "Un.1: sem cebola" parseada) + obs globais do item
  const obsEspecifica = unidade.observacao ? [unidade.observacao] : [];
  // Para o gate: mostra obs específica da unidade + obs globais
  const observacoesParaGate = [...obsEspecifica, ...observacoesGlobaisItem];
  const temObs = observacoesParaGate.length > 0;
  const temOpcoes = opcoesItem.length > 0;

  const numBg = unidade.status === 'entregue' ? 'bg-zinc-200 text-zinc-500' : unidade.status === 'pronto' ? 'bg-green-500 text-white' : unidade.status === 'preparo' ? 'bg-yellow-400 text-zinc-800' : 'bg-amber-100 text-amber-700';
  const isDimmed = faseColuna !== undefined && unidade.status !== faseColuna;
  const now = Date.now();
  const fase = getItemFase(unidade.status, unidade.iniciouPreparoEm, unidade.ficouProntoEm, unidade.entregueEm);
  let timerLabel = '';
  let timerColor = 'text-yellow-600';
  if (fase === 'preparo' && unidade.iniciouPreparoEm) {
    timerLabel = formatDuration(Math.floor((now - unidade.iniciouPreparoEm) / 1000));
    timerColor = 'text-yellow-600';
  } else if (fase === 'pronto_aguardando' && unidade.ficouProntoEm) {
    const secs = Math.floor((now - unidade.ficouProntoEm) / 1000);
    timerLabel = `Pronto há ${formatDuration(secs)}`;
    timerColor = secs > 300 ? 'text-red-500' : secs > 120 ? 'text-orange-500' : 'text-green-600';
  }

  const handleAvancar = () => {
    if (canceladoBloqueio || semOperador || pdvEditingBloqueio || !nextStatus) return;
    // Se tem obs ou opções e vai iniciar (novo→preparo) ou marcar pronto (preparo→pronto), abre gate
    if ((temObs || temOpcoes) && (nextStatus === 'preparo' || nextStatus === 'pronto')) {
      const tipo: 'iniciar' | 'pronto' = nextStatus === 'preparo' ? 'iniciar' : 'pronto';
      setObsGateTarget({ tipo, nextStatus });
    } else {
      onAvancarUnidade(pedidoId, itemId, unidade.id, nextStatus);
    }
  };

  const handleGateConfirm = () => {
    if (obsGateTarget) {
      onAvancarUnidade(pedidoId, itemId, unidade.id, obsGateTarget.nextStatus);
      setObsGateTarget(null);
    }
  };

  return (
    <>
      {obsGateTarget && (
        <UnidadeObsGate
          observacoes={observacoesParaGate}
          opcoes={opcoesItem}
          tipo={obsGateTarget.tipo}
          onConfirm={handleGateConfirm}
          onCancel={() => setObsGateTarget(null)}
        />
      )}
      <div className={`flex items-start gap-1.5 py-1 pl-2 border-l-2 border-zinc-100 ml-2 transition-opacity ${isDimmed ? 'opacity-30 pointer-events-none' : ''}`}>
        <div className={`w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-black flex-shrink-0 mt-0.5 ${numBg}`}>{unidade.numero}</div>
        <div className="flex-1 min-w-0">
          {/* Tags visuais: opções (todas as unidades), obs global (todas), obs específica (só esta unidade) */}
          {(temObs || temOpcoes) && unidade.status !== 'entregue' && (
            <div className="flex flex-wrap gap-1 mb-0.5">
              {opcoesItem.map((op, i) => (
                <span key={`op-${i}`} className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 whitespace-nowrap">
                  <i className="ri-list-check-3 text-[8px]" />{op.grupoNome}: {op.opcaoNome}
                </span>
              ))}
              {/* Obs específica desta unidade — tag laranja para diferenciar de obs global */}
              {obsEspecifica.map((obs, i) => (
                <span key={`unit-obs-${i}`} className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 border border-orange-300 text-orange-700 whitespace-nowrap">
                  <i className="ri-user-voice-line text-[8px]" />{obs}
                </span>
              ))}
              {/* Obs globais do item — tag âmbar padrão */}
              {observacoesGlobaisItem.map((obs, i) => (
                <span key={`obs-${i}`} className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap">
                  <i className="ri-alert-fill text-[8px]" />{obs}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            {unidade.operadorPreparo ? (
              <>
                {unidade.status === 'novo' ? (
                  <button onClick={() => onSelecionarOperadorUnidade(pedidoId, itemId, unidade.id, '')} title="Remover operador" className="flex items-center gap-0.5 text-[9px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full whitespace-nowrap hover:bg-red-50 hover:border-red-200 hover:text-red-500 cursor-pointer transition-colors">
                    <i className="ri-user-line text-[8px]" />{unidade.operadorPreparo}<i className="ri-close-line text-[8px] ml-0.5" />
                  </button>
                ) : (
                  <span className="flex items-center gap-0.5 text-[9px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full whitespace-nowrap"><i className="ri-user-line text-[8px]" />{unidade.operadorPreparo}</span>
                )}
                {(unidade.status === 'novo' || unidade.status === 'preparo') && operadoresDisponiveis.length > 1 && operadoresDisponiveis.filter((op) => op !== unidade.operadorPreparo).map((op) => (
                  <button key={op} onClick={() => onSelecionarOperadorUnidade(pedidoId, itemId, unidade.id, op)} className="text-[8px] font-medium px-1.5 py-0.5 rounded-full border border-zinc-200 text-zinc-400 hover:border-teal-200 hover:text-teal-600 cursor-pointer transition-colors whitespace-nowrap">{op}</button>
                ))}
              </>
            ) : unidade.status !== 'entregue' ? (
              operadoresDisponiveis.length === 0
                ? <span className="text-[8px] text-zinc-400 italic">Sem operador</span>
                : operadoresDisponiveis.map((op) => <button key={op} onClick={() => onSelecionarOperadorUnidade(pedidoId, itemId, unidade.id, op)} className="text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-zinc-300 bg-zinc-50 text-zinc-500 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-600 cursor-pointer transition-colors whitespace-nowrap">{op}</button>)
            ) : <span className="text-[9px] text-zinc-400 truncate">{unidade.quemEntregou ?? '—'}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          {timerLabel && unidade.status !== 'entregue' && (
            <span className={`text-[9px] font-bold tabular-nums whitespace-nowrap ${timerColor}`}>
              {timerLabel}
            </span>
          )}
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_ITEM_COLORS[unidade.status]}`}>
            {unidade.status === 'novo' ? 'Aguard.' : unidade.status === 'preparo' ? 'Preparo' : unidade.status === 'pronto' ? (timerLabel || 'Pronto') : 'Entregue'}
          </span>
        </div>
        {nextStatus && (
          kioskBloqueioEntrega ? (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-600 whitespace-nowrap flex items-center gap-0.5 mt-0.5">
              <i className="ri-store-2-line text-[9px]" />Pagar no caixa
            </span>
          ) : (
            <button
              onClick={handleAvancar}
              disabled={canceladoBloqueio || semOperador || pdvEditingBloqueio}
              className={`text-[9px] font-bold px-2 py-0.5 rounded-lg whitespace-nowrap flex-shrink-0 transition-colors mt-0.5 ${canceladoBloqueio || pdvEditingBloqueio ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200' : semOperador ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200' : `${NEXT_ACTION_COLOR[unidade.status]} cursor-pointer`}`}
            >
              {canceladoBloqueio || pdvEditingBloqueio ? <><i className="ri-lock-line mr-0.5" />Bloqueado</> : semOperador ? <><i className="ri-user-add-line mr-0.5" />Op.</> : NEXT_ACTION_LABEL[unidade.status]}
            </button>
          )
        )}
      </div>
    </>
  );
});

// ── ItemRow ────────────────────────────────────────────────────────────────────

const ItemRow = memo(function ItemRow({ item, pedido, estacaoFiltro, onAvancar, onAvancarParte, showTimer, onOpenDetalhe, index, bloqueado, onToggleObsChecada, onAvancarUnidade, onSelecionarOperadorUnidade, operadoresDisponiveis, onSelecionarOperador, onRequestAvancar, onSetObsLivre, faseColuna, isKioskNaoPago }: { // eslint-disable-line @typescript-eslint/no-unused-vars
  item: KDSItem; pedido: KDSPedido; estacaoFiltro: string;
  onAvancar: (pedidoId: string, itemId: string, novoStatus: KDSItemStatus) => void;
  onAvancarParte: (pedidoId: string, itemId: string, parteId: string, novoStatus: KDSItemStatus) => void;
  showTimer: boolean; onOpenDetalhe: (item: KDSItem) => void; index: number; bloqueado?: boolean;
  onToggleObsChecada: (pedidoId: string, itemId: string, obs: string) => void;
  onAvancarUnidade: (pedidoId: string, itemId: string, unidadeId: string, novoStatus: KDSItemStatus) => void;
  onSelecionarOperadorUnidade: (pedidoId: string, itemId: string, unidadeId: string, operador: string) => void;
  operadoresDisponiveis: string[];
  onSelecionarOperador: (pedidoId: string, itemId: string, operador: string) => void;
  onRequestAvancar: (pedidoId: string, itemId: string, novoStatus: KDSItemStatus, item: KDSItem) => void;
  onSetObsLivre: (pedidoId: string, itemId: string, obs: string) => void;
  faseColuna?: KDSItemStatus;
  isKioskNaoPago?: boolean;
}) {
  useKDSTick();
  const [fichaAberta, setFichaAberta] = useState(false);
  const temPartes = item.partes && item.partes.length > 0;
  const statusEfetivo = deriveItemStatus(item);
  const isSkipKds = item.semPreparo || item.skip_kds;
  // Itens sem preparo (Entrega Direta) pulam direto para 'entregue'
  const nextStatus = isSkipKds && statusEfetivo !== 'entregue'
    ? 'entregue'
    : NEXT_STATUS[statusEfetivo];
  // Para label/cor do botão, itens skip tratam como se fossem 'pronto' (próximo = entregar)
  const statusParaBotao: KDSItemStatus = isSkipKds && statusEfetivo !== 'entregue' ? 'pronto' : statusEfetivo;
  const now = Date.now();
  const fase = getItemFase(statusEfetivo, item.iniciouPreparoEm, item.ficouProntoEm, item.entregueEm);
  let faseElapsed = 0; let faseLabelShort = '';
  if (!isSkipKds) {
    if (fase === 'aguardando') { faseElapsed = Math.floor((now - item.entroKdsEm) / 1000); faseLabelShort = `Ag.: ${formatDuration(faseElapsed)}`; }
    else if (fase === 'preparo' && item.iniciouPreparoEm) { faseElapsed = Math.floor((now - item.iniciouPreparoEm) / 1000); faseLabelShort = `Preparo: ${formatDuration(faseElapsed)}`; }
    else if (fase === 'pronto_aguardando' && item.ficouProntoEm) { faseElapsed = Math.floor((now - item.ficouProntoEm) / 1000); faseLabelShort = `Pronto há ${formatDuration(faseElapsed)}`; }
  } else if (statusEfetivo !== 'entregue') {
    // Item sem preparo: mostra tempo aguardando entrega desde que entrou no KDS
    faseElapsed = Math.floor((now - item.entroKdsEm) / 1000);
    faseLabelShort = `Ag. entrega: ${formatDuration(faseElapsed)}`;
  }
  const slaLevel = getSLALevel(faseElapsed, item.slaMinutos);
  const partesVisiveis = temPartes ? (estacaoFiltro === 'Todas' ? item.partes! : item.partes!.filter((p) => p.estacao === estacaoFiltro)) : [];
  // Itens skip_kds (sem produção) sempre aparecem quando visíveis — não filtrar por estação
  const itemNaEstacao = !temPartes && (isSkipKds || estacaoFiltro === 'Todas' || item.estacao === estacaoFiltro);
  const algumParteNaEstacao = temPartes && partesVisiveis.length > 0;
  if (!itemNaEstacao && !algumParteNaEstacao) return null;
  const hasUnidades = !temPartes && (item.unidades?.length ?? 0) > 0;
  const obsChecadas = item.observacoesChecadas ?? [];
  const todasObsChecadas = item.observacoes.length === 0 || item.observacoes.every((obs) => obsChecadas.includes(obs));
  const todasUnidadesProntas = hasUnidades ? (item.unidades?.every((u) => u.status === 'pronto' || u.status === 'entregue') ?? true) : true;
  const gateBloqueado = statusEfetivo === 'preparo' && !hasUnidades && (!todasObsChecadas || !todasUnidadesProntas);
  const gateMotivo = !todasObsChecadas && !todasUnidadesProntas ? 'Confirme obs. e unidades' : !todasObsChecadas ? 'Confirme as observações' : '';
  const semOperador = !hasUnidades && !item.operadorPreparo && statusEfetivo === 'novo';
  const todasPartesEstacaoProntas = temPartes ? partesVisiveis.every((p) => p.status === 'pronto' || p.status === 'entregue') : false;
  const rowBg = index % 2 === 0 ? '' : 'bg-zinc-50/60 rounded-lg';
  const itemDimmed = faseColuna !== undefined && !hasUnidades && !isSkipKds && statusEfetivo !== faseColuna;
  // Bloquear entrega de item individual se kiosk não pago
  const kioskBloqueioEntrega = !!isKioskNaoPago && nextStatus === 'entregue';

  return (
    <div className={`py-2 border-b border-zinc-100 last:border-0 ${rowBg} transition-opacity ${itemDimmed ? 'opacity-30 pointer-events-none' : ''}`}>
      <div className="flex items-start gap-2">
        <div className={`w-1 self-stretch rounded-full flex-shrink-0 mt-1 ${statusEfetivo === 'novo' ? 'bg-amber-300' : statusEfetivo === 'preparo' ? 'bg-yellow-400' : statusEfetivo === 'pronto' ? 'bg-green-400' : 'bg-zinc-200'}`} />
        <div className="flex-1 min-w-0">
          {fichaAberta && (
            <FichaTecnicaKDSModal
              itens={[{ nome: item.nome, menuItemId: item.menuItemId, quantidade: item.quantidade }]}
              onClose={() => setFichaAberta(false)}
            />
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => onOpenDetalhe(item)} className="text-sm font-semibold text-zinc-900 hover:text-amber-600 transition-colors cursor-pointer text-left">
              {item.quantidade > 1 && <span className="text-amber-600 font-bold">{item.quantidade}x </span>}
              {item.nome}<i className="ri-information-line text-[10px] ml-1 opacity-40" />
            </button>
            {item.categoriaNome && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200 whitespace-nowrap">{item.categoriaNome}</span>}
            {!isSkipKds && item.menuItemId && (
              <button
                onClick={(e) => { e.stopPropagation(); setFichaAberta(true); }}
                title="Ficha técnica deste item"
                className="w-4 h-4 flex items-center justify-center rounded text-zinc-300 hover:text-amber-500 hover:bg-amber-50 cursor-pointer transition-colors"
              >
                <i className="ri-clipboard-line text-[10px]" />
              </button>
            )}
            {temPartes && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 flex items-center gap-0.5"><i className="ri-git-branch-line text-[10px]" />Multi</span>}
            {item.semPreparo && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 border border-teal-200 flex items-center gap-0.5"><i className="ri-flashlight-line text-[10px]" />Entrega Direta</span>}
            {/* Badge de obs: conta globais + obs específicas de unidade */}
            {(() => {
              const totalObs = item.observacoes.length + (item.unidades?.filter((u) => !!u.observacao).length ?? 0);
              return totalObs > 0 ? (
                <span
                  title={[
                    ...item.observacoes,
                    ...(item.unidades?.filter((u) => !!u.observacao).map((u) => `Un.${u.numero}: ${u.observacao}`) ?? []),
                  ].join(' · ')}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-600 cursor-default"
                >
                  <i className="ri-alert-fill text-[10px]" />
                  <span className="text-[10px] font-bold">{totalObs}</span>
                </span>
              ) : null;
            })()}
          </div>
          {item.opcoes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.opcoes.map((o, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200 whitespace-nowrap">
                  <span className="text-[9px] text-zinc-400">{o.grupoNome}:</span>
                  <span className="font-semibold text-zinc-700">{o.opcaoNome}</span>
                  {(o.additional_price ?? 0) > 0 && (
                    <span className="text-[9px] text-emerald-600 font-bold ml-0.5">
                      +{o.additional_price!.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
          {/* BUG 3.3: renderiza filhos do combo indentados */}
          {item.comboId && item.comboChildren && item.comboChildren.length > 0 && (
            <ComboChildrenList children={item.comboChildren} />
          )}
          {!temPartes && (statusEfetivo === 'novo' || statusEfetivo === 'preparo') && !item.operadorPreparo && (
            <div className="mt-1.5 flex items-center gap-1 flex-wrap">
              <span className="text-[9px] text-zinc-400 font-semibold uppercase tracking-wide"><i className="ri-user-add-line mr-0.5" />Operador:</span>
              {operadoresDisponiveis.length === 0 ? <span className="text-[9px] text-zinc-400 italic">Nenhum operador logado</span> :
                operadoresDisponiveis.map((op) => <button key={op} onClick={() => onSelecionarOperador(pedido.id, item.id, op)} className="text-[9px] font-bold px-2 py-0.5 rounded-full border border-zinc-300 bg-zinc-50 text-zinc-600 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-700 cursor-pointer transition-colors whitespace-nowrap">{op}</button>)}
            </div>
          )}
          {!temPartes && statusEfetivo === 'novo' && item.operadorPreparo && (
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              <button onClick={() => onSelecionarOperador(pedido.id, item.id, '')} title="Remover operador" className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-teal-200 bg-teal-50 text-teal-700 hover:bg-red-50 hover:border-red-200 hover:text-red-500 cursor-pointer transition-colors whitespace-nowrap">
                <i className="ri-user-unfollow-line text-[9px]" />{item.operadorPreparo}<i className="ri-close-line text-[9px] ml-0.5" />
              </button>
              {operadoresDisponiveis.length > 1 && operadoresDisponiveis.filter((op) => op !== item.operadorPreparo).map((op) => (
                <button key={op} onClick={() => onSelecionarOperador(pedido.id, item.id, op)} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-teal-50 hover:border-teal-200 hover:text-teal-600 cursor-pointer transition-colors whitespace-nowrap">{op}</button>
              ))}
            </div>
          )}
          {item.observacoes.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              {statusEfetivo === 'preparo' ? item.observacoes.map((obs, i) => {
                const checked = obsChecadas.includes(obs);
                return (
                  <button key={i} onClick={() => onToggleObsChecada(pedido.id, item.id, obs)} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-left cursor-pointer transition-all w-full ${checked ? 'bg-green-50 border-green-300 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700 animate-pulse'}`}>
                    <div className={`w-3.5 h-3.5 flex items-center justify-center rounded border flex-shrink-0 ${checked ? 'bg-green-500 border-green-500' : 'bg-white border-amber-400'}`}>{checked && <i className="ri-check-line text-[9px] text-white" />}</div>
                    <span className="text-[10px] font-bold truncate flex-1">{obs}</span>
                    {!checked && <span className="text-[9px] font-bold text-amber-500 flex-shrink-0 whitespace-nowrap">⚠ confirmar</span>}
                  </button>
                );
              }) : (
                <div className="flex flex-wrap gap-1">
                  {item.observacoes.map((obs, i) => <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border flex items-center gap-0.5 ${obsChecadas.includes(obs) ? 'bg-green-50 text-green-700 border-green-300' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{obsChecadas.includes(obs) && <i className="ri-check-line text-[9px]" />}{obs}</span>)}
                </div>
              )}
            </div>
          )}
          <ObsLivreBox item={item} pedidoId={pedido.id} onSetObsLivre={onSetObsLivre} />
          {hasUnidades && item.unidades && (
            <div className="mt-1.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">{item.quantidade} unidades · {item.unidades.filter((u) => u.status === 'pronto' || u.status === 'entregue').length}/{item.quantidade} prontas</span>
                {item.unidades.every((u) => u.status === 'novo') && !bloqueado && (
                  <button onClick={() => item.unidades!.forEach((u) => onAvancarUnidade(pedido.id, item.id, u.id, 'preparo'))} className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white cursor-pointer transition-colors whitespace-nowrap"><i className="ri-play-line mr-0.5" />Iniciar Todas</button>
                )}
              </div>
              <div className="space-y-0.5">
                {item.unidades.map((unidade) => (
                  <UnidadeRow key={unidade.id} unidade={unidade} pedidoId={pedido.id} itemId={item.id} operadoresDisponiveis={operadoresDisponiveis} onAvancarUnidade={onAvancarUnidade} onSelecionarOperadorUnidade={onSelecionarOperadorUnidade} observacoesGlobaisItem={item.observacoes} opcoesItem={item.opcoes} faseColuna={faseColuna} isCancelledOrder={bloqueado} isKioskNaoPago={isKioskNaoPago} isPdvEditing={pedido.isEditing} />
                ))}
              </div>
            </div>
          )}
          {!temPartes && showTimer && statusEfetivo !== 'entregue' && <KDSCardTimeline item={item} />}
          {/* Quem entregou — exibido quando item está entregue e não tem unidades */}
          {!temPartes && !hasUnidades && statusEfetivo === 'entregue' && (item.quemEntregou || item.entregueEm) && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {item.quemEntregou && (
                <span className="flex items-center gap-0.5 text-[9px] font-bold text-zinc-500 bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <i className="ri-user-follow-line text-[9px]" />
                  {item.quemEntregou}
                </span>
              )}
              {item.entregueEm && (
                <span className="flex items-center gap-0.5 text-[9px] text-zinc-400 whitespace-nowrap">
                  <i className="ri-time-line text-[9px]" />
                  {new Date(item.entregueEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}
        </div>
        {!temPartes && !hasUnidades && (
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {showTimer && statusEfetivo !== 'entregue' && <span className={`text-[10px] font-bold tabular-nums ${SLA_COLORS[slaLevel]}`}>{faseLabelShort}</span>}
            {nextStatus && (
              kioskBloqueioEntrega ? (
                <span className="text-[9px] font-bold px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-600 whitespace-nowrap flex items-center gap-0.5">
                  <i className="ri-store-2-line text-[9px]" />Pagar no caixa
                </span>
              ) : (
                <button
                  onClick={() => { if (bloqueado) return; if (semOperador) return; if (gateBloqueado) return; onRequestAvancar(pedido.id, item.id, nextStatus, item); }}
                  disabled={bloqueado || semOperador || gateBloqueado}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-colors whitespace-nowrap ${bloqueado ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200' : semOperador ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200' : gateBloqueado ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200' : `${NEXT_ACTION_COLOR[statusParaBotao]} cursor-pointer`}`}
                >
                  {bloqueado ? <><i className="ri-close-circle-line mr-0.5" />Cancelado</> : semOperador ? <><i className="ri-user-add-line mr-0.5" />Operador</> : gateBloqueado ? <><i className="ri-lock-line mr-0.5" />{gateMotivo}</> : NEXT_ACTION_LABEL[statusParaBotao]}
                </button>
              )
            )}
          </div>
        )}
        {temPartes && showTimer && statusEfetivo !== 'entregue' && (
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {todasPartesEstacaoProntas && estacaoFiltro !== 'Todas' && <span className="text-[10px] text-green-600 font-bold flex items-center gap-0.5"><i className="ri-check-line" /> Sua parte OK</span>}
          </div>
        )}
      </div>
      {temPartes && partesVisiveis.length > 0 && (
        <div className="mt-1.5 space-y-0.5 pl-3">
          {partesVisiveis.map((parte, idx) => <SubParteRow key={parte.id} parte={parte} pedidoId={pedido.id} itemId={item.id} onAvancarParte={onAvancarParte} showTimer={showTimer && pedido.status !== 'entregue'} entroKdsEm={item.entroKdsEm} index={idx} isCancelledOrder={bloqueado} />)}
          {estacaoFiltro === 'Todas' && <div className="mt-1 flex items-center gap-1.5"><div className="w-3 h-3 flex items-center justify-center"><i className="ri-information-line text-xs text-zinc-400" /></div><span className="text-[10px] text-zinc-400 italic">Pronto quando todas as partes estiverem concluídas</span></div>}
        </div>
      )}
    </div>
  );
});

// ── KDSCardItemList ────────────────────────────────────────────────────────────

export interface KDSCardItemListProps {
  pedido: KDSPedido;
  itensVisiveis: KDSItem[];
  estacaoFiltro: string;
  faseColuna?: KDSItemStatus;
  clienteEditando: boolean;
  isCancelled?: boolean;
  isKioskNaoPago?: boolean;
  operadoresDisponiveis: string[];
  onAvancar: (pedidoId: string, itemId: string, novoStatus: KDSItemStatus) => void;
  onAvancarParte: (pedidoId: string, itemId: string, parteId: string, novoStatus: KDSItemStatus) => void;
  onToggleObsChecada: (pedidoId: string, itemId: string, obs: string) => void;
  onAvancarUnidade: (pedidoId: string, itemId: string, unidadeId: string, novoStatus: KDSItemStatus) => void;
  onSelecionarOperadorUnidade: (pedidoId: string, itemId: string, unidadeId: string, operador: string) => void;
  onSelecionarOperador: (pedidoId: string, itemId: string, operador: string) => void;
  onSetObsLivre: (pedidoId: string, itemId: string, obs: string) => void;
  onOpenDetalhe: (item: KDSItem) => void;
  onRequestAvancar: (pedidoId: string, itemId: string, novoStatus: KDSItemStatus, item: KDSItem) => void;
}

const KDSCardItemList = memo(function KDSCardItemList({
  pedido, itensVisiveis, estacaoFiltro, faseColuna, clienteEditando,
  isCancelled, isKioskNaoPago, operadoresDisponiveis, onAvancar, onAvancarParte, onToggleObsChecada,
  onAvancarUnidade, onSelecionarOperadorUnidade, onSelecionarOperador,
  onSetObsLivre, onOpenDetalhe, onRequestAvancar,
}: KDSCardItemListProps) {
  return (
    <div className="px-3 pt-2 pb-1">
      {itensVisiveis.map((item, idx) => (
        <ItemRow
          key={item.id}
          item={item}
          index={idx}
          pedido={pedido}
          estacaoFiltro={estacaoFiltro}
          onAvancar={onAvancar}
          onAvancarParte={onAvancarParte}
          showTimer={pedido.status !== 'entregue'}
          onOpenDetalhe={onOpenDetalhe}
          bloqueado={clienteEditando || !!isCancelled || pedido.isEditing}
          onToggleObsChecada={onToggleObsChecada}
          onAvancarUnidade={onAvancarUnidade}
          onSelecionarOperadorUnidade={onSelecionarOperadorUnidade}
          operadoresDisponiveis={operadoresDisponiveis}
          onSelecionarOperador={onSelecionarOperador}
          onRequestAvancar={onRequestAvancar}
          onSetObsLivre={onSetObsLivre}
          faseColuna={faseColuna}
          isKioskNaoPago={isKioskNaoPago}
        />
      ))}
    </div>
  );
});

export default KDSCardItemList;
