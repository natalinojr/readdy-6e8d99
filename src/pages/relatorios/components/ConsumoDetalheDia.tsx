import { useMemo } from 'react';
import { TrendingDown, ShoppingCart, Package, AlertTriangle } from 'lucide-react';
import { useConsumoDetalhe, ConsumoNoDia } from '@/hooks/useConsumoDetalhe';
import type { UnidadeEstoque } from '@/types/estoque';

interface Props {
  ingredientId: string;
  ingredientUnit: UnidadeEstoque;
  dateFrom: string;
  dateTo: string;
}

const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v);

const BUCKET_CONFIG = {
  vendas: {
    label: 'Venda',
    icon: <ShoppingCart size={10} />,
    rowClass: 'bg-white',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-100',
    sumClass: 'text-amber-600',
  },
  producao: {
    label: 'Produção',
    icon: <Package size={10} />,
    rowClass: 'bg-white',
    badgeClass: 'bg-sky-50 text-sky-700 border border-sky-100',
    sumClass: 'text-sky-600',
  },
  perda: {
    label: 'Perda',
    icon: <AlertTriangle size={10} />,
    rowClass: 'bg-white',
    badgeClass: 'bg-red-50 text-red-600 border border-red-100',
    sumClass: 'text-red-500',
  },
} as const;

function DiaCard({ dia }: { dia: ConsumoNoDia }) {
  const { linhas, buckets, unidade } = dia;
  const activeBuckets = (Object.entries(buckets) as [keyof typeof buckets, number][]).filter(
    ([, v]) => v > 0,
  );

  return (
    <div className="border border-zinc-100 rounded-xl bg-white overflow-hidden">
      {/* Header do dia */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-50 border-b border-zinc-100">
        <div className="flex items-center gap-3">
          <div className="text-center min-w-[44px]">
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
              {dia.diaSemana}
            </p>
            <p className="text-sm font-bold text-zinc-800">{dia.dataLabel}</p>
          </div>
          <div className="h-8 w-px bg-zinc-200" />
          <div>
            <p className="text-xs font-bold text-zinc-800">
              {fmtNum(dia.totalQtd)}{' '}
              <span className="font-normal text-zinc-400">{unidade}</span>
            </p>
            <p className="text-[10px] text-zinc-400">{linhas.length} linha{linhas.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Totais por bucket */}
        <div className="flex items-center gap-2">
          {activeBuckets.map(([bucket, qty]) => {
            const cfg = BUCKET_CONFIG[bucket];
            return (
              <div
                key={bucket}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.badgeClass}`}
              >
                {cfg.icon}
                {cfg.label}: {fmtNum(qty)} {unidade}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabela */}
      {linhas.length === 0 ? (
        <div className="px-4 py-3 text-xs text-zinc-400 text-center">Nenhum registro.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/60">
                <th className="px-3 py-2 text-left font-semibold text-zinc-500 w-16">Hora</th>
                <th className="px-3 py-2 text-left font-semibold text-zinc-500 w-28">Nº Pedido</th>
                <th className="px-3 py-2 text-left font-semibold text-zinc-500">Item / Opção</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-500 w-28 whitespace-nowrap">
                  Qtd saiu
                </th>
                <th className="px-3 py-2 text-center font-semibold text-zinc-500 w-24">Origem</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha, idx) => {
                const cfg = BUCKET_CONFIG[linha.bucket];
                return (
                  <tr
                    key={linha.id}
                    className={`border-b border-zinc-50 last:border-0 hover:bg-zinc-50/80 transition-colors ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30'
                    }`}
                  >
                    {/* Hora */}
                    <td className="px-3 py-2 font-mono text-zinc-500 whitespace-nowrap">
                      {linha.hora}
                    </td>

                    {/* Nº Pedido */}
                    <td className="px-3 py-2">
                      {linha.numeroPedido ? (
                        <span className="font-medium text-zinc-700">#{linha.numeroPedido}</span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    {/* Item / Opção */}
                    <td className="px-3 py-2 text-zinc-700 max-w-[240px]">
                      {linha.itemNome ? (
                        <span className="truncate block" title={linha.itemNome}>
                          {linha.itemNome}
                        </span>
                      ) : (
                        <span className="text-zinc-300 italic">—</span>
                      )}
                    </td>

                    {/* Qtd saiu */}
                    <td className="px-3 py-2 text-right font-semibold text-red-500 whitespace-nowrap">
                      -{fmtNum(linha.qty)} {dia.unidade}
                    </td>

                    {/* Origem */}
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${cfg.badgeClass}`}
                      >
                        {cfg.icon}
                        {cfg.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ConsumoDetalheDia({
  ingredientId,
  ingredientUnit,
  dateFrom,
  dateTo,
}: Props) {
  const { dias, loading, error } = useConsumoDetalhe(
    ingredientId,
    ingredientUnit,
    dateFrom,
    dateTo,
  );

  const totalConsumo = useMemo(() => dias.reduce((s, d) => s + d.totalQtd, 0), [dias]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 px-4">
        <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-zinc-400">Carregando consumo por dia...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3">
        <p className="text-xs text-red-500">{error}</p>
      </div>
    );
  }

  if (dias.length === 0) {
    return (
      <div className="px-4 py-4 text-center">
        <p className="text-xs text-zinc-400">Nenhuma movimentação no período selecionado.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3 bg-zinc-50/60 border-t border-zinc-100">
      {/* Cabeçalho geral */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-600 flex items-center gap-1.5">
          <TrendingDown size={12} className="text-amber-500" />
          Consumo por dia — {dias.length} dia{dias.length !== 1 ? 's' : ''} com movimentação
        </p>
        <span className="text-xs text-zinc-500">
          Total:{' '}
          <strong className="text-zinc-800">
            {fmtNum(totalConsumo)} {ingredientUnit}
          </strong>
        </span>
      </div>

      {/* Cards por dia */}
      {dias.map(dia => (
        <DiaCard key={dia.data} dia={dia} />
      ))}
    </div>
  );
}