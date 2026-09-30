import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useEstoque, type InventarioSession } from '../../../contexts/EstoqueContext';
import ContagemInventario from './ContagemInventario';
import DetalheInventario from './DetalheInventario';
import DivergenciaPanel from './DivergenciaPanel';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

type View = 'historico' | 'contagem' | 'detalhe';

function temRascunhoSalvo(tenantId: string): boolean {
  if (!tenantId) return false;
  try {
    const raw = localStorage.getItem(`erpos_inventario_draft_${tenantId}`);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    return draft.contagens && Object.keys(draft.contagens).length > 0;
  } catch {
    return false;
  }
}

export default function InventarioTab() {
  const { inventarioSessions } = useEstoque();
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const podeInventariar = hasPermissao('estoque_inventario');
  const [view, setView] = useState<View>('historico');
  const [sessionDetalhe, setSessionDetalhe] = useState<InventarioSession | null>(null);
  const [startFresh, setStartFresh] = useState(false);
  const [showDraftModal, setShowDraftModal] = useState(false);

  const tenantId = user?.tenantId ?? '';
  const hasDraft = temRascunhoSalvo(tenantId);

  const handleNovaContagem = () => {
    if (!podeInventariar) return;
    if (hasDraft) {
      setShowDraftModal(true);
    } else {
      setStartFresh(false);
      setView('contagem');
    }
  };

  const handleRetomarRascunho = () => {
    if (!podeInventariar) return;
    setShowDraftModal(false);
    setStartFresh(false);
    setView('contagem');
  };

  const handleNovaContagemLimpa = () => {
    if (!podeInventariar) return;
    setShowDraftModal(false);
    setStartFresh(true);
    setView('contagem');
  };

  if (view === 'contagem') {
    return (
      <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
        <DivergenciaPanel />
        <ContagemInventario
          operador={user?.nome ?? 'Operador'}
          onConcluido={() => setView('historico')}
          onCancelar={() => setView('historico')}
          startFresh={startFresh}
        />
      </div>
    );
  }

  if (view === 'detalhe' && sessionDetalhe) {
    // Versão mais recente da contagem (depois de uma edição a lista é recarregada)
    const atual = inventarioSessions.find((s) => s.id === sessionDetalhe.id) ?? sessionDetalhe;
    return (
      <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
        <DivergenciaPanel />
        <DetalheInventario
          session={atual}
          sessoesMaisNovas={inventarioSessions.filter((s) => s.numero > atual.numero)}
          podeEditar={podeInventariar}
          onVoltar={() => { setView('historico'); setSessionDetalhe(null); }}
        />
      </div>
    );
  }

  // View padrão: histórico de contagens
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <DivergenciaPanel />

      {/* Banner de rascunho pendente */}
      {hasDraft && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl flex-shrink-0">
            <i className="ri-draft-line text-amber-600 text-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-800">Você tem um rascunho de contagem pendente</p>
            <p className="text-xs text-zinc-500">Retome de onde parou ou inicie uma nova contagem do zero.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNovaContagemLimpa}
              className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm"
            >
              Nova contagem
            </button>
            <button
              onClick={handleRetomarRascunho}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm"
            >
              <i className="ri-play-line" />
              Retomar Rascunho
            </button>
          </div>
        </div>
      )}

      {/* Header da lista + botão */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Histórico de Contagens</h3>
          <p className="text-xs text-zinc-400">
            {inventarioSessions.length === 0
              ? 'Nenhuma contagem realizada ainda'
              : `${inventarioSessions.length} contagen${inventarioSessions.length > 1 ? 's' : ''} registrada${inventarioSessions.length > 1 ? 's' : ''}`}
          </p>
        </div>
        {podeInventariar && (
          <button
            onClick={handleNovaContagem}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm"
          >
            <i className="ri-clipboard-line text-sm" />
            Nova Contagem
          </button>
        )}
      </div>

      {/* Lista de sessões */}
      {inventarioSessions.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl py-14 text-center">
          <i className="ri-clipboard-line text-4xl text-zinc-200" />
          <p className="text-sm font-semibold text-zinc-500 mt-2 mb-1">Nenhuma contagem ainda</p>
          <p className="text-xs text-zinc-400 mb-4">Clique em "Nova Contagem" para fazer a primeira contagem de inventário</p>
          {podeInventariar ? (
            <button
              onClick={handleNovaContagem}
              className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm"
            >
              <i className="ri-clipboard-line" />
              Iniciar primeira contagem
            </button>
          ) : (
            <p className="text-xs text-zinc-400 italic">Seu perfil não tem permissão para realizar inventário.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {inventarioSessions.map((session) => {
            const temDiff = session.itensComDiferenca > 0;
            return (
              <button
                key={session.id}
                onClick={() => { setSessionDetalhe(session); setView('detalhe'); }}
                className="w-full bg-white border border-zinc-200 hover:border-amber-300 hover:bg-amber-50/40 rounded-2xl px-4 md:px-5 py-4 text-left cursor-pointer transition-all group"
              >
                <div className="flex items-center gap-4">
                  {/* Ícone */}
                  <div className={`w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 ${
                    temDiff ? 'bg-amber-50' : 'bg-emerald-50'
                  }`}>
                    <i className={`text-lg ${temDiff ? 'ri-alert-line text-amber-500' : 'ri-checkbox-circle-line text-emerald-500'}`} />
                  </div>

                  {/* Info principal */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-zinc-800">Contagem #{session.numero}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                        temDiff ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {temDiff ? `${session.itensComDiferenca} diferença${session.itensComDiferenca > 1 ? 's' : ''}` : 'Sem diferenças'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {session.data} às {session.hora} · {session.operador} · {session.itensContados} itens contados
                    </p>
                  </div>

                  {/* Valores financeiros */}
                  <div className="text-right flex-shrink-0 space-y-0.5">
                    {(() => {
                      const valorEstoque = session.itens.reduce((s, i) => s + i.qtdContada * i.precoUnitario, 0);
                      return (
                        <>
                          <p className="text-sm font-bold tabular-nums text-zinc-800">{fmt(valorEstoque)}</p>
                          <p className="text-[10px] text-zinc-400">valor em estoque</p>
                          {session.valorAjusteLiquido !== 0 && (
                            <p className={`text-[10px] font-bold ${session.valorAjusteLiquido < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                              {session.valorAjusteLiquido >= 0 ? '+' : ''}{fmt(session.valorAjusteLiquido)} ajuste
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div className="w-5 h-5 flex items-center justify-center text-zinc-300 group-hover:text-amber-400 transition-colors">
                    <i className="ri-arrow-right-s-line text-base" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Modal para escolher entre retomar rascunho ou começar nova */}
      {showDraftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-start gap-4 px-6 py-5 bg-amber-50 border-b border-amber-200">
              <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl flex-shrink-0 mt-0.5">
                <i className="ri-draft-line text-amber-600 text-xl" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-zinc-900 mb-1">Rascunho de contagem encontrado</h2>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Você tem uma contagem de inventário que não foi concluída. Deseja continuar de onde parou ou descartar o rascunho e começar uma nova?
                </p>
              </div>
            </div>
            <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex flex-col gap-3">
              <button
                onClick={handleRetomarRascunho}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                <i className="ri-play-line" />
                Continuar Rascunho
              </button>
              <button
                onClick={handleNovaContagemLimpa}
                className="w-full py-3 border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-700 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                <i className="ri-add-line" />
                Nova Contagem (descartar rascunho)
              </button>
              <button
                onClick={() => setShowDraftModal(false)}
                className="w-full py-2 text-zinc-400 hover:text-zinc-600 text-xs font-medium cursor-pointer transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}