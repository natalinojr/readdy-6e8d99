import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useEstoque, type InventarioSession } from '../../../contexts/EstoqueContext';
import ContagemInventario from './ContagemInventario';

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

function DetalheSession({ session, onVoltar }: { session: InventarioSession; onVoltar: () => void }) {

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onVoltar}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500 transition-colors"
        >
          <i className="ri-arrow-left-line text-sm" />
        </button>
        <div>
          <p className="text-sm font-bold text-zinc-800">
            Contagem #{session.numero}
          </p>
          <p className="text-xs text-zinc-500">
            {session.data} às {session.hora} · {session.operador}
          </p>
        </div>
      </div>

      {/* Resumo */}
      {(() => {
        const valorTotalContagem = session.itens.reduce((s, i) => s + i.qtdContada * i.precoUnitario, 0);
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
              <p className="text-xl font-black text-zinc-800">{session.itensContados}</p>
              <p className="text-[10px] text-zinc-500">itens contados</p>
            </div>
            <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
              <p className="text-xl font-black text-zinc-400">{session.itensContados - session.itensComDiferenca}</p>
              <p className="text-[10px] text-zinc-500">sem diferença</p>
            </div>
            <div className={`bg-white border rounded-xl p-4 text-center ${session.itensComDiferenca > 0 ? 'border-amber-200' : 'border-zinc-100'}`}>
              <p className={`text-xl font-black ${session.itensComDiferenca > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
                {session.itensComDiferenca}
              </p>
              <p className="text-[10px] text-zinc-500">com diferença</p>
            </div>
            <div className={`bg-white border rounded-xl p-4 text-center ${session.valorAjusteLiquido !== 0 ? (session.valorAjusteLiquido < 0 ? 'border-red-200' : 'border-emerald-200') : 'border-zinc-100'}`}>
              <p className={`text-xl font-black ${session.valorAjusteLiquido < 0 ? 'text-red-500' : session.valorAjusteLiquido > 0 ? 'text-emerald-600' : 'text-zinc-400'}`}>
                {session.valorAjusteLiquido >= 0 ? '+' : ''}{fmt(session.valorAjusteLiquido)}
              </p>
              <p className="text-[10px] text-zinc-500">impacto do ajuste</p>
            </div>
            <div className="col-span-2 bg-zinc-50 border border-zinc-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-zinc-600">Valor total em estoque na contagem</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">Soma de qtd contada × preço unitário de todos os insumos</p>
              </div>
              <p className="text-lg font-black text-zinc-900">{fmt(valorTotalContagem)}</p>
            </div>
          </div>
        );
      })()}

      {/* Todos os itens da contagem */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
          <p className="text-xs font-bold text-zinc-700">Todos os Insumos Contados</p>
          <span className="text-[10px] text-zinc-400">{session.itens.length} insumos</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: '420px' }}>
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">Insumo</th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-500 hidden sm:table-cell">Teórico</th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">Contado</th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">Diferença</th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">Impacto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {session.itens.map((item) => (
                <tr
                  key={item.insumoId}
                  className={`hover:bg-zinc-50 ${item.diferenca !== 0 ? 'bg-amber-50/40' : ''}`}
                >
                  <td className="px-4 py-2.5 font-medium text-zinc-800">
                    {item.insumoNome}
                    {item.diferenca !== 0 && (
                      <span className="ml-2 text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">
                        divergência
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-500 hidden sm:table-cell">
                    {item.qtdTeorica} {item.unidade}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-zinc-800">
                    {item.qtdContada} {item.unidade}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {item.diferenca !== 0 ? (
                      <span className={`font-bold ${item.diferenca > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {item.diferenca > 0 ? '+' : ''}{item.diferenca} {item.unidade}
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {item.diferenca !== 0 ? (
                      <span className={`font-semibold ${item.diferenca * item.precoUnitario < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {item.diferenca * item.precoUnitario >= 0 ? '+' : ''}{fmt(item.diferenca * item.precoUnitario)}
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
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
      <ContagemInventario
        operador={user?.nome ?? 'Operador'}
        onConcluido={() => setView('historico')}
        onCancelar={() => setView('historico')}
        startFresh={startFresh}
      />
    );
  }

  if (view === 'detalhe' && sessionDetalhe) {
    return (
      <DetalheSession
        session={sessionDetalhe}
        onVoltar={() => { setView('historico'); setSessionDetalhe(null); }}
      />
    );
  }

  // View padrão: histórico de contagens
  return (
    <div className="space-y-5">
      {/* Banner de rascunho pendente */}
      {hasDraft && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center gap-4 flex-wrap">
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
              className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-800 border border-zinc-300 rounded-xl cursor-pointer transition-colors whitespace-nowrap"
            >
              Nova contagem
            </button>
            <button
              onClick={handleRetomarRascunho}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center gap-2"
            >
              <i className="ri-play-line" />
              Retomar Rascunho
            </button>
          </div>
        </div>
      )}

      {/* Header da lista + botão */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-zinc-800">Histórico de Contagens</p>
          <p className="text-xs text-zinc-400">
            {inventarioSessions.length === 0
              ? 'Nenhuma contagem realizada ainda'
              : `${inventarioSessions.length} contagen${inventarioSessions.length > 1 ? 's' : ''} registrada${inventarioSessions.length > 1 ? 's' : ''}`}
          </p>
        </div>
        {podeInventariar && (
          <button
            onClick={handleNovaContagem}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-clipboard-line text-sm" />
            Nova Contagem
          </button>
        )}
      </div>

      {/* Lista de sessões */}
      {inventarioSessions.length === 0 ? (
        <div className="bg-white border border-dashed border-zinc-200 rounded-xl py-16 text-center">
          <div className="w-12 h-12 flex items-center justify-center bg-zinc-50 rounded-full mx-auto mb-3">
            <i className="ri-clipboard-line text-2xl text-zinc-300" />
          </div>
          <p className="text-sm font-semibold text-zinc-500 mb-1">Nenhuma contagem ainda</p>
          <p className="text-xs text-zinc-400 mb-4">Clique em "Nova Contagem" para fazer a primeira contagem de inventário</p>
          {podeInventariar ? (
            <button
              onClick={handleNovaContagem}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors inline-flex items-center gap-2"
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
                className="w-full bg-white border border-zinc-100 hover:border-amber-300 rounded-xl px-5 py-4 text-left cursor-pointer transition-all group"
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
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        temDiff ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
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
                          <p className="text-sm font-black text-zinc-800">{fmt(valorEstoque)}</p>
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