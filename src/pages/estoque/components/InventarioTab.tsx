import { useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useEstoque, type InventarioSession } from '../../../contexts/EstoqueContext';
import ContagemInventario from './ContagemInventario';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

type View = 'historico' | 'contagem' | 'detalhe';

function DetalheSession({ session, onVoltar }: { session: InventarioSession; onVoltar: () => void }) {
  const comDiff = session.itens.filter((i) => i.diferenca !== 0);
  const semDiff = session.itens.filter((i) => i.diferenca === 0);

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
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-xl font-black text-zinc-800">{session.itensContados}</p>
          <p className="text-[10px] text-zinc-500">itens contados</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-xl font-black text-zinc-400">{semDiff.length}</p>
          <p className="text-[10px] text-zinc-500">sem diferença</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 text-center ${comDiff.length > 0 ? 'border-amber-200' : 'border-zinc-100'}`}>
          <p className={`text-xl font-black ${comDiff.length > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
            {comDiff.length}
          </p>
          <p className="text-[10px] text-zinc-500">com diferença</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 text-center ${session.valorAjusteLiquido !== 0 ? (session.valorAjusteLiquido < 0 ? 'border-red-200' : 'border-emerald-200') : 'border-zinc-100'}`}>
          <p className={`text-xl font-black ${session.valorAjusteLiquido < 0 ? 'text-red-500' : session.valorAjusteLiquido > 0 ? 'text-emerald-600' : 'text-zinc-400'}`}>
            {session.valorAjusteLiquido >= 0 ? '+' : ''}{fmt(session.valorAjusteLiquido)}
          </p>
          <p className="text-[10px] text-zinc-500">impacto</p>
        </div>
      </div>

      {/* Itens com diferença */}
      {comDiff.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
            <p className="text-xs font-bold text-amber-700">Itens com Diferença</p>
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
                {comDiff.map((item) => (
                  <tr key={item.insumoId} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5 font-medium text-zinc-800">{item.insumoNome}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 hidden sm:table-cell">{item.qtdTeorica} {item.unidade}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-zinc-800">{item.qtdContada} {item.unidade}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-bold ${item.diferenca > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {item.diferenca > 0 ? '+' : ''}{item.diferenca} {item.unidade}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-semibold ${item.diferenca * item.precoUnitario < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {item.diferenca * item.precoUnitario >= 0 ? '+' : ''}{fmt(item.diferenca * item.precoUnitario)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Itens sem diferença */}
      {semDiff.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100">
            <p className="text-xs font-bold text-emerald-700">Itens sem Diferença ({semDiff.length})</p>
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {semDiff.map((item) => (
              <span key={item.insumoId} className="text-[10px] text-zinc-500 bg-zinc-50 border border-zinc-100 px-2 py-1 rounded-full">
                {item.insumoNome}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InventarioTab() {
  const { inventarioSessions, insumos } = useEstoque();
  const { user } = useAuth();
  const [view, setView] = useState<View>('historico');
  const [sessionDetalhe, setSessionDetalhe] = useState<InventarioSession | null>(null);

  const valorTotalEstoque = insumos.reduce((s, i) => s + i.estoqueAtual * i.precoUnitario, 0);
  const criticos = insumos.filter((i) => i.estoqueAtual <= i.estoqueMinimo * 0.5).length;

  if (view === 'contagem') {
    return (
      <ContagemInventario
        operador={user?.nome ?? 'Operador'}
        onConcluido={() => setView('historico')}
        onCancelar={() => setView('historico')}
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
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-xl font-bold text-zinc-900">{insumos.length}</p>
          <p className="text-xs text-zinc-500">Total de insumos</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 text-center ${criticos > 0 ? 'border-red-200' : 'border-zinc-100'}`}>
          <p className={`text-xl font-bold ${criticos > 0 ? 'text-red-500' : 'text-zinc-400'}`}>{criticos}</p>
          <p className="text-xs text-zinc-500">Críticos</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-xl font-bold text-zinc-700">{inventarioSessions.length}</p>
          <p className="text-xs text-zinc-500">Contagens realizadas</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-sm font-bold text-zinc-900">{fmt(valorTotalEstoque)}</p>
          <p className="text-xs text-zinc-500">Valor em estoque</p>
        </div>
      </div>

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
        <button
          onClick={() => setView('contagem')}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
        >
          <i className="ri-clipboard-line text-sm" />
          Nova Contagem
        </button>
      </div>

      {/* Lista de sessões */}
      {inventarioSessions.length === 0 ? (
        <div className="bg-white border border-dashed border-zinc-200 rounded-xl py-16 text-center">
          <div className="w-12 h-12 flex items-center justify-center bg-zinc-50 rounded-full mx-auto mb-3">
            <i className="ri-clipboard-line text-2xl text-zinc-300" />
          </div>
          <p className="text-sm font-semibold text-zinc-500 mb-1">Nenhuma contagem ainda</p>
          <p className="text-xs text-zinc-400 mb-4">Clique em "Nova Contagem" para fazer a primeira contagem de inventário</p>
          <button
            onClick={() => setView('contagem')}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors inline-flex items-center gap-2"
          >
            <i className="ri-clipboard-line" />
            Iniciar primeira contagem
          </button>
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

                  {/* Impacto financeiro */}
                  <div className="text-right flex-shrink-0">
                    {session.valorAjusteLiquido !== 0 ? (
                      <>
                        <p className={`text-sm font-black ${session.valorAjusteLiquido < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                          {session.valorAjusteLiquido >= 0 ? '+' : ''}{fmt(session.valorAjusteLiquido)}
                        </p>
                        <p className="text-[10px] text-zinc-400">impacto</p>
                      </>
                    ) : (
                      <p className="text-xs text-zinc-300 font-medium">R$ 0,00</p>
                    )}
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
    </div>
  );
}
