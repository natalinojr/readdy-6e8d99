import { useEstoque } from '../../../contexts/EstoqueContext';
import { KpiCard } from '../../financeiro/components/dreUi';
import { abaixoDoMinimo, estaEsgotado, precisaConferir } from '@/lib/estoqueRegras';
import { regraDoInsumo } from './insumos/InsumosUtils';

const fmt = (v: number, digits = 2) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits }).format(v);

export default function DivergenciaPanel() {
  const { insumos, inventarioSessions } = useEstoque();

  const ultimaContagem = inventarioSessions[0] ?? null;
  const valorTotal = insumos.reduce((s, i) => s + i.estoqueAtual * i.precoUnitario, 0);
  // Regra única do estoque (2026-10-03): os mesmos números do Início e do Dashboard.
  const esgotados = insumos.filter((i) => estaEsgotado(regraDoInsumo(i)));
  const alertas = insumos.filter((i) => abaixoDoMinimo(regraDoInsumo(i)));
  const conferir = insumos.filter((i) => precisaConferir(regraDoInsumo(i)));

  // Divergência da própria contagem (contado − teórico daquele momento), maior impacto em R$ primeiro.
  // Antes era estoque atual − contado, que é só o que vendeu/entrou depois da contagem.
  const todasDivergencias = ultimaContagem
    ? ultimaContagem.itens
      .map((item) => ({ nome: item.insumoNome, unidade: item.unidade, diff: item.diferenca, precoUnitario: item.precoUnitario }))
      .filter((d) => Math.abs(d.diff) > 0.00005)
      .sort((a, b) => Math.abs(b.diff * b.precoUnitario) - Math.abs(a.diff * a.precoUnitario))
    : [];
  const divergencias = todasDivergencias.slice(0, 5);

  const impactoTotal = todasDivergencias.reduce((s, d) => s + d.diff * d.precoUnitario, 0);

  return (
    <div className="space-y-3">
      {/* Métricas principais */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          label="Valor em Estoque"
          icon="ri-money-dollar-circle-line"
          value={fmt(valorTotal)}
          sub={`${insumos.length} insumos cadastrados`}
          atual={valorTotal}
          semVariacao
        />
        <KpiCard
          label="Esgotados"
          icon="ri-forbid-2-line"
          value={String(esgotados.length)}
          valueTone={esgotados.length > 0 ? 'text-red-600' : 'text-zinc-400'}
          sub={esgotados.length > 0 ? esgotados.slice(0, 2).map((i) => i.nome.split(' ')[0]).join(', ') + (esgotados.length > 2 ? '...' : '') : 'Nenhum esgotado'}
          highlight={esgotados.length > 0 ? 'neg' : undefined}
          atual={esgotados.length}
          semVariacao
        />
        <KpiCard
          label="Abaixo do mínimo"
          icon="ri-alert-line"
          value={String(alertas.length)}
          valueTone={alertas.length > 0 ? 'text-amber-700' : 'text-zinc-400'}
          sub={alertas.length > 0 ? 'Lista de compras no Início' : 'Todos ok'}
          atual={alertas.length}
          semVariacao
        />
        <KpiCard
          label="Para conferir"
          icon="ri-error-warning-line"
          value={String(conferir.length)}
          valueTone={conferir.length > 0 ? 'text-red-600' : 'text-zinc-400'}
          sub={conferir.length > 0 ? 'Negativo ou esgotado com saldo' : 'Nada para conferir'}
          atual={conferir.length}
          semVariacao
        />
      </div>

      {/* Divergência teórico vs real */}
      {ultimaContagem && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <i className={`text-base ${divergencias.length > 0 ? 'ri-scales-3-line text-amber-600' : 'ri-check-double-line text-emerald-500'}`} />
              <div>
                <h3 className="text-sm font-bold text-zinc-800">Divergência Teórico vs Última Contagem</h3>
                <p className="text-xs text-zinc-400">
                  Última contagem: {ultimaContagem.data} às {ultimaContagem.hora} · {ultimaContagem.operador}
                </p>
              </div>
            </div>
            {divergencias.length > 0 && (
              <div className="text-right">
                <p className={`text-sm font-bold tabular-nums ${impactoTotal < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {impactoTotal >= 0 ? '+' : ''}{fmt(impactoTotal)}
                </p>
                <p className="text-[11px] text-zinc-400">ajuste da contagem</p>
              </div>
            )}
          </div>

          {divergencias.length === 0 ? (
            <div className="flex items-center gap-2 px-5 py-3">
              <i className="ri-checkbox-circle-fill text-emerald-400 text-sm flex-shrink-0" />
              <p className="text-xs text-zinc-500">
                Na última contagem o contado bateu com o sistema: nenhuma diferença.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100/80">
              {divergencias.map((d) => (
                <div key={d.nome} className="flex items-center justify-between px-5 py-2.5 hover:bg-zinc-50">
                  <p className="text-xs font-medium text-zinc-700 flex-1 min-w-0 truncate" title={d.nome}>{d.nome}</p>
                  <div className="flex items-center gap-4 ml-2 flex-shrink-0">
                    <span className={`text-xs font-bold tabular-nums ${d.diff > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {d.diff > 0 ? '+' : ''}{d.diff.toFixed(2)} {d.unidade}
                    </span>
                    <span className={`text-[11px] font-semibold tabular-nums min-w-[70px] text-right ${d.diff * d.precoUnitario < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      {d.diff * d.precoUnitario >= 0 ? '+' : ''}{fmt(d.diff * d.precoUnitario)}
                    </span>
                  </div>
                </div>
              ))}
              {todasDivergencias.length > 5 && (
                <p className="text-[11px] text-zinc-400 px-5 py-2">
                  + {todasDivergencias.length - 5} outros itens · Veja o histórico completo na aba Inventário.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sem contagem ainda */}
      {!ultimaContagem && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <i className="ri-clipboard-line text-amber-500 text-base" />
          <p className="text-xs text-amber-800">
            Nenhuma contagem de inventário realizada. Faça a primeira contagem na aba <strong>Inventário</strong> para acompanhar divergências.
          </p>
        </div>
      )}
    </div>
  );
}
