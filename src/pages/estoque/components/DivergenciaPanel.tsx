import type { InventarioSession } from '../../../types/estoque';
import { fmtQtdSinal, impactoDe, reaisComSinal, resumirContagem } from '@/lib/contagemResumo';

// Resumo das diferenças de UMA contagem (contado − teórico daquele momento), do que mais pesa em R$ para o
// que menos pesa. Antes era um quadro no topo da aba que comparava o estoque de hoje com o contado (e
// chamava de "divergência" as vendas feitas depois); agora mora no cartão da última contagem.
export default function DivergenciaPanel({ session, limite = 5 }: { session: InventarioSession; limite?: number }) {
  const { topo } = resumirContagem(session.itens);

  if (topo.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700 mt-2">
        <i className="ri-checkbox-circle-fill" />
        O contado bateu com o sistema: nenhuma diferença.
      </p>
    );
  }

  return (
    <div className="mt-2.5 rounded-xl bg-zinc-50 px-3 py-2">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-400 mb-1">Maiores diferenças</p>
      <ul className="divide-y divide-zinc-100">
        {topo.slice(0, limite).map((d) => (
          <li key={d.insumoId} className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-[12.5px] font-medium text-zinc-700 truncate min-w-0" title={d.insumoNome}>{d.insumoNome}</span>
            <span className="flex items-center gap-3 flex-shrink-0 tabular-nums">
              <span className={`text-[12.5px] font-bold ${d.diferenca > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {fmtQtdSinal(d.diferenca, d.unidade)}
              </span>
              <span className={`text-[11.5px] font-semibold min-w-[72px] text-right ${impactoDe(d) < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                {reaisComSinal(impactoDe(d))}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {topo.length > limite && (
        <p className="text-[11px] text-zinc-400 pt-1">e mais {topo.length - limite} {topo.length - limite === 1 ? 'item' : 'itens'}: abra a contagem para ver todos.</p>
      )}
    </div>
  );
}
