import { useEstoque } from '../../../contexts/EstoqueContext';

const fmt = (v: number, digits = 2) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits }).format(v);

export default function DivergenciaPanel() {
  const { insumos, inventarioSessions } = useEstoque();

  const ultimaContagem = inventarioSessions[0] ?? null;
  const valorTotal = insumos.reduce((s, i) => s + i.estoqueAtual * i.precoUnitario, 0);
  const esgotados = insumos.filter((i) => i.estoqueAtual <= 0);
  const criticos = insumos.filter((i) => i.estoqueAtual > 0 && i.estoqueAtual <= i.estoqueMinimo * 0.5);
  const alertas = insumos.filter((i) => i.estoqueAtual > i.estoqueMinimo * 0.5 && i.estoqueAtual <= i.estoqueMinimo);

  // Comparação entre estoque atual e última contagem
  const divergencias = ultimaContagem
    ? ultimaContagem.itens
      .map((item) => {
        const atual = insumos.find((i) => i.id === item.insumoId);
        if (!atual) return null;
        const diff = atual.estoqueAtual - item.qtdContada;
        return { nome: item.insumoNome, unidade: item.unidade, diff, precoUnitario: item.precoUnitario };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null && Math.abs(d.diff) > 0.01)
      .sort((a, b) => Math.abs(b.diff * b.precoUnitario) - Math.abs(a.diff * a.precoUnitario))
      .slice(0, 5)
    : [];

  const impactoTotal = divergencias.reduce((s, d) => s + d.diff * d.precoUnitario, 0);

  return (
    <div className="space-y-3">
      {/* Métricas principais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Valor em Estoque</p>
          <p className="text-lg font-black text-zinc-800">{fmt(valorTotal)}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{insumos.length} insumos cadastrados</p>
        </div>

        <div className={`bg-white border rounded-xl p-4 ${esgotados.length > 0 ? 'border-red-300 bg-red-50/50' : 'border-zinc-100'}`}>
          <p className="text-xs text-zinc-500 mb-1">Esgotados</p>
          <p className={`text-lg font-black ${esgotados.length > 0 ? 'text-red-600' : 'text-zinc-400'}`}>{esgotados.length}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">
            {esgotados.length > 0 ? esgotados.slice(0, 2).map((i) => i.nome.split(' ')[0]).join(', ') + (esgotados.length > 2 ? '...' : '') : 'Nenhum esgotado'}
          </p>
        </div>

        <div className={`bg-white border rounded-xl p-4 ${criticos.length > 0 ? 'border-red-200 bg-red-50/30' : 'border-zinc-100'}`}>
          <p className="text-xs text-zinc-500 mb-1">Críticos (&lt;50% mín)</p>
          <p className={`text-lg font-black ${criticos.length > 0 ? 'text-red-500' : 'text-zinc-400'}`}>{criticos.length}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">
            {criticos.length > 0 ? 'Ação urgente' : 'Sem críticos'}
          </p>
        </div>

        <div className={`bg-white border rounded-xl p-4 ${alertas.length > 0 ? 'border-amber-200 bg-amber-50/30' : 'border-zinc-100'}`}>
          <p className="text-xs text-zinc-500 mb-1">Em Alerta</p>
          <p className={`text-lg font-black ${alertas.length > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>{alertas.length}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">
            {alertas.length > 0 ? 'Abaixo do mínimo' : 'Todos ok'}
          </p>
        </div>
      </div>

      {/* Divergência teórico vs real */}
      {ultimaContagem && (
        <div className={`bg-white border rounded-xl overflow-hidden ${divergencias.length > 0 ? 'border-amber-200' : 'border-zinc-100'}`}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${divergencias.length > 0 ? 'bg-amber-50 border-amber-100' : 'bg-zinc-50 border-zinc-100'}`}>
            <div className="flex items-center gap-2">
              <i className={`text-base ${divergencias.length > 0 ? 'ri-scales-3-line text-amber-600' : 'ri-check-double-line text-emerald-500'}`} />
              <div>
                <p className={`text-xs font-bold ${divergencias.length > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>
                  Divergência Teórico vs Última Contagem
                </p>
                <p className="text-[10px] text-zinc-400">
                  Última contagem: {ultimaContagem.data} às {ultimaContagem.hora} · {ultimaContagem.operador}
                </p>
              </div>
            </div>
            {divergencias.length > 0 && (
              <div className="text-right">
                <p className={`text-sm font-black ${impactoTotal < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {impactoTotal >= 0 ? '+' : ''}{fmt(impactoTotal)}
                </p>
                <p className="text-[10px] text-zinc-400">impacto acumulado</p>
              </div>
            )}
          </div>

          {divergencias.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-3">
              <i className="ri-checkbox-circle-fill text-emerald-400 text-sm" />
              <p className="text-xs text-zinc-500">Estoque teórico alinhado com a última contagem. Faça nova contagem para atualizar.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {divergencias.map((d) => (
                <div key={d.nome} className="flex items-center justify-between px-4 py-2.5">
                  <p className="text-xs font-medium text-zinc-700 flex-1 min-w-0 truncate">{d.nome}</p>
                  <div className="flex items-center gap-4 ml-2 flex-shrink-0">
                    <span className={`text-xs font-bold ${d.diff > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {d.diff > 0 ? '+' : ''}{d.diff.toFixed(2)} {d.unidade}
                    </span>
                    <span className={`text-[11px] font-semibold min-w-[70px] text-right ${d.diff * d.precoUnitario < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      {d.diff * d.precoUnitario >= 0 ? '+' : ''}{fmt(d.diff * d.precoUnitario)}
                    </span>
                  </div>
                </div>
              ))}
              {ultimaContagem.itensComDiferenca > 5 && (
                <p className="text-[10px] text-zinc-400 px-4 py-2">
                  + {ultimaContagem.itensComDiferenca - 5} outros itens · Veja o histórico completo na aba Inventário.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sem contagem ainda */}
      {!ultimaContagem && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-clipboard-line text-amber-500 text-base" />
          <p className="text-xs text-amber-700 font-medium">
            Nenhuma contagem de inventário realizada. Faça a primeira contagem na aba <strong>Inventário</strong> para acompanhar divergências.
          </p>
        </div>
      )}
    </div>
  );
}
