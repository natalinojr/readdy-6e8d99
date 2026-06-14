import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { convertUnit } from '@/lib/unitConversion';
import type { UnidadeEstoque } from '@/types/estoque';

export interface ConsumoPorTipo {
  vendas: number;
  producao: number;
  perda: number;
  ajuste: number;
  transferencia: number;
}

export interface ConsumoIngrediente {
  id: string;
  nome: string;
  unidade: UnidadeEstoque;
  categoria: string;
  fornecedor: string;
  estoqueAtual: number;
  minimo: number;
  totalConsumido: number;
  porTipo: ConsumoPorTipo;
  totalVendas: number;
  qtdPedidos: number;
  custoTotal: number;
  custoVendas: number;
  custoProducao: number;
  custoPerda: number;
  mediaDiaria: number;
  diasAteZerar: number | null;
  tendencia: 'subindo' | 'estavel' | 'caindo';
  semCadastro: boolean;
}

export interface ConsumoResumo {
  totalIngredientes: number;
  totalConsumidoValor: number;
  totalVendasValor: number;
  ingredientesCriticos: number;
  mediaConsumoDiario: number;
  custoVendas: number;
  custoProducao: number;
  custoPerda: number;
}

/* ── helpers ── */

const DB_UNIT_MAP: Record<string, UnidadeEstoque> = {
  g: 'g', kg: 'kg', ml: 'ml', L: 'l', l: 'l', unit: 'un', un: 'un',
};

function normalizeUnit(u: string | null | undefined): UnidadeEstoque {
  if (!u) return 'un';
  const lower = u.toLowerCase().trim();
  return DB_UNIT_MAP[lower] ?? (lower as UnidadeEstoque) ?? 'un';
}

function classifyMovement(
  type: string,
  reason: string | null,
): {
  bucket: keyof ConsumoPorTipo;
  isConsumo: boolean;
} {
  const r = (reason || '').toLowerCase();

  // ── Entradas NUNCA são consumo, independente do reason ──────────────────
  // type='in' é sempre entrada (compra, produção própria, ajuste positivo)
  if (type === 'in') return { bucket: 'ajuste', isConsumo: false };

  // Transferência de entrada também não é consumo
  if (type === 'transfer_in') return { bucket: 'transferencia', isConsumo: false };

  // ── A partir daqui só temos saídas / consumo ─────────────────────────────

  /* vendas diretas (PDV) */
  if (type === 'theoretical_out') return { bucket: 'vendas', isConsumo: true };

  /* perda */
  if (r.includes('perda') || r.includes('descarte') || r.includes('quebra') || r.includes('dano') || r.includes('estrago')) {
    return { bucket: 'perda', isConsumo: true };
  }

  /* saída para produção de outra receita (manual_out com reason de produção)
     ATENÇÃO: 'Entrada (producao): X' é type='in' e já foi barrado acima.
     Aqui só chegam saídas de insumos usados em outras receitas. */
  if (
    type === 'manual_out' &&
    (r.includes('producao') || r.includes('produção') || r.includes('(producao)') || r.includes('(produção)') || r.includes('saida (producao)'))
  ) {
    return { bucket: 'producao', isConsumo: true };
  }

  /* transferência de saída */
  if (type === 'transfer_out') return { bucket: 'transferencia', isConsumo: true };

  /* ajuste de inventário */
  if (type === 'inventory_adjustment') return { bucket: 'ajuste', isConsumo: true };

  /* manual_out genérico = saída manual */
  if (type === 'manual_out') return { bucket: 'ajuste', isConsumo: true };

  return { bucket: 'ajuste', isConsumo: false };
}

export function useConsumoIngredientes(
  _tenantId: string | undefined | null,
  dateFrom?: string,
  dateTo?: string,
) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const fromIso = dateFrom ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const toIso = dateTo ?? new Date().toISOString().split('T')[0];

  const [dados, setDados] = useState<ConsumoIngrediente[]>([]);
  const [resumo, setResumo] = useState<ConsumoResumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState({
    movsCount: 0,
    insumosCount: 0,
    orfas: 0,
    ordersCount: 0,
    cadastrados: 0,
    tenantName: '',
  });

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        /* 1) ingredients via RPC (funciona com RLS) */
        const { data: ingsData, error: ingsErr } = await supabase.rpc('fn_get_ingredients', {
          p_tenant_id: tenantId,
        });
        if (ingsErr) throw ingsErr;

        const ingredients = ((ingsData as Array<Record<string, unknown>>) ?? []).map((r) => ({
          id: String(r.id ?? ''),
          name: String(r.name ?? 'Sem nome'),
          unit: normalizeUnit(r.unit as string),
          unitPrice: Number(r.unit_price ?? 0),
          minStock: Number(r.min_stock ?? 0),
          currentStock: Number(r.current_stock ?? 0),
          category: String(r.category ?? ''),
          supplier: String(r.supplier ?? ''),
          deletedAt: r.deleted_at ? String(r.deleted_at) : null,
          // 'production' = produto produzido/intermediário; 'final' = vendido direto no PDV
          usageType: String(r.usage_type ?? 'final') as 'final' | 'production',
        })).filter((i) => i.id);

        const CATEGORIAS_PRODUCAO = new Set([
          'Produtos Produzidos',
          'Produtos Semi-acabados',
          'Produtos de Produção',
        ]);
        const activeIngredients = ingredients.filter(
          (i) =>
            !i.deletedAt &&
            !CATEGORIAS_PRODUCAO.has(i.category) &&
            i.usageType !== 'production',
        );
        const ingredientMap = new Map(activeIngredients.map((i) => [i.id, i]));
        const allIngredientMap = new Map(ingredients.map((i) => [i.id, i]));

        const fromDate = new Date(`${fromIso}T00:00:00`);
        const toDate = new Date(`${toIso}T23:59:59`);

        /* 2) stock movements via RPC com filtro de período */
        const { data: movsData, error: movsErr } = await supabase.rpc('fn_get_stock_movements_filtered', {
          p_tenant_id: tenantId,
          p_date_from: fromDate.toISOString(),
          p_date_to: toDate.toISOString(),
        });
        if (movsErr) throw movsErr;

        const rawMovs = (movsData ?? []) as Array<{
          id: string;
          ingredient_id: string;
          ingredient_name: string;
          type: string;
          quantity: number;
          ingredient_unit?: string | null;
          reason?: string | null;
          created_at?: string | null;
          order_id?: string | null;
        }>;

        const movements = rawMovs.map((r) => ({
          id: r.id,
          ingredientId: r.ingredient_id,
          type: r.type,
          quantity: Number(r.quantity),
          unit: normalizeUnit(r.ingredient_unit),
          reason: r.reason ?? null,
          createdAt: r.created_at ?? '',
        }));

        /* 3) orders do período via RPC */
        const { data: ordersData } = await supabase.rpc('fn_get_orders_for_consumo', {
          p_tenant_id: tenantId,
          p_date_from: fromDate.toISOString(),
          p_date_to: toDate.toISOString(),
        });

        const invalidStatuses = new Set(['cancelled', 'canceled', 'cancelado', 'refunded']);
        const validOrders = (ordersData ?? []).filter((o) => !invalidStatuses.has(o.status as string));
        const ordersTotal = validOrders.reduce((s, o) => s + Number(o.total ?? 0), 0);
        const ordersCount = validOrders.length;

        /* 4) agregar */
        const hoje = new Date();
        const inicioUltimaSemana = new Date(hoje.getTime() - 7 * 86400000);
        const inicioSemanaAnterior = new Date(hoje.getTime() - 14 * 86400000);

        const agg = new Map<
          string,
          {
            porTipo: ConsumoPorTipo;
            diasComMovimento: Set<string>;
            ultimaSemanaVendas: number;     // apenas vendas, para tendência
            semanaAnteriorVendas: number;   // apenas vendas, para tendência
            ultimaSemanaProducao: number;   // para insumos de produção
            semanaAnteriorProducao: number; // para insumos de produção
            totalSaidas: number;
            temVendasDiretas: boolean;      // true se houve theoretical_out no período
          }
        >();

        for (const m of movements) {
          const classified = classifyMovement(m.type, m.reason);
          const qtyAbs = Math.abs(m.quantity);

          /* conversão de unidade */
          const ing = ingredientMap.get(m.ingredientId);
          const ingUnit = ing?.unit ?? m.unit;
          let finalQty = qtyAbs;
          if (m.unit !== ingUnit) {
            const converted = convertUnit(qtyAbs, m.unit, ingUnit);
            if (converted !== null) finalQty = converted;
          }

          const prev = agg.get(m.ingredientId) ?? {
            porTipo: { vendas: 0, producao: 0, perda: 0, ajuste: 0, transferencia: 0 },
            diasComMovimento: new Set<string>(),
            ultimaSemanaVendas: 0,
            semanaAnteriorVendas: 0,
            ultimaSemanaProducao: 0,
            semanaAnteriorProducao: 0,
            totalSaidas: 0,
            temVendasDiretas: false,
          };

          if (classified.isConsumo) {
            prev.totalSaidas += finalQty;
            prev.porTipo[classified.bucket] += finalQty;
          }

          // Marca se houve vendas diretas (theoretical_out) no período
          if (m.type === 'theoretical_out') {
            prev.temVendasDiretas = true;
          }

          const d = new Date(m.createdAt);
          const dateKey = d.toLocaleDateString('pt-BR');
          prev.diasComMovimento.add(dateKey);

          // Tendência: vendas para insumos finais, produção para insumos intermediários
          if (classified.bucket === 'vendas' && classified.isConsumo) {
            if (d >= inicioUltimaSemana) {
              prev.ultimaSemanaVendas += finalQty;
            } else if (d >= inicioSemanaAnterior && d < inicioUltimaSemana) {
              prev.semanaAnteriorVendas += finalQty;
            }
          }
          if (classified.bucket === 'producao' && classified.isConsumo) {
            if (d >= inicioUltimaSemana) {
              prev.ultimaSemanaProducao += finalQty;
            } else if (d >= inicioSemanaAnterior && d < inicioUltimaSemana) {
              prev.semanaAnteriorProducao += finalQty;
            }
          }

          agg.set(m.ingredientId, prev);
        }

        /* 5) construir resultado */
        const result: ConsumoIngrediente[] = [];

        for (const ing of activeIngredients) {
          const c = agg.get(ing.id);
          const totalConsumido = c?.totalSaidas ?? 0;
          const porTipo: ConsumoPorTipo = c?.porTipo ?? {
            vendas: 0, producao: 0, perda: 0, ajuste: 0, transferencia: 0,
          };
          const dias = c?.diasComMovimento.size ?? 0;

          // Regra de consumo de referência (para média diária, dias até zerar e tendência):
          //
          // Se o insumo teve vendas diretas (theoretical_out) no período → usa VENDAS como referência,
          // independente do usage_type. Isso cobre hambúrgueres e outros itens de produção
          // que também são vendidos diretamente no PDV.
          //
          // Se o insumo é usage_type='production' E não teve vendas diretas → é um produto produzido
          // puro (ex: Molho de Tomate). Usa o bucket PRODUÇÃO (saídas para outras receitas)
          // como referência.
          //
          // Para insumos finais normais (Coca-Cola, etc.) → sempre usa VENDAS.
          const isProdutoProducao = ing.usageType === 'production';
          const temVendasDiretas = c?.temVendasDiretas ?? false;
          const consumoReferencia = (isProdutoProducao && !temVendasDiretas)
            ? porTipo.producao   // produto produzido puro: consumido em outras receitas
            : porTipo.vendas;    // vendido diretamente no PDV (inclui itens de produção com venda)

          const mediaDiaria = dias > 0 ? consumoReferencia / dias : 0;
          const custo = totalConsumido * ing.unitPrice;

          // Tendência usa o mesmo critério do consumoReferencia
          const ultimaSemanaRef = (isProdutoProducao && !temVendasDiretas)
            ? (c?.ultimaSemanaProducao ?? 0)
            : (c?.ultimaSemanaVendas ?? 0);
          const semanaAnteriorRef = (isProdutoProducao && !temVendasDiretas)
            ? (c?.semanaAnteriorProducao ?? 0)
            : (c?.semanaAnteriorVendas ?? 0);

          let tendencia: 'subindo' | 'estavel' | 'caindo' = 'estavel';
          if (semanaAnteriorRef > 0) {
            const variacao = (ultimaSemanaRef - semanaAnteriorRef) / semanaAnteriorRef;
            if (variacao > 0.2) tendencia = 'subindo';
            else if (variacao < -0.2) tendencia = 'caindo';
          } else if (ultimaSemanaRef > 0 && semanaAnteriorRef === 0) {
            tendencia = 'subindo';
          }

          result.push({
            id: ing.id,
            nome: ing.name,
            unidade: ing.unit,
            categoria: ing.category || 'Sem categoria',
            fornecedor: ing.supplier || '—',
            estoqueAtual: ing.currentStock,
            minimo: ing.minStock,
            totalConsumido,
            porTipo,
            totalVendas: ordersTotal,
            qtdPedidos: ordersCount,
            custoTotal: custo,
            custoVendas: porTipo.vendas * ing.unitPrice,
            custoProducao: porTipo.producao * ing.unitPrice,
            custoPerda: porTipo.perda * ing.unitPrice,
            mediaDiaria,
            diasAteZerar: mediaDiaria > 0 ? Math.floor(ing.currentStock / mediaDiaria) : null,
            tendencia,
            semCadastro: false,
          });
        }

        /* 6) ingredientes orfãos */
        const processedIds = new Set(activeIngredients.map((i) => i.id));
        for (const [ingId, c] of agg.entries()) {
          if (processedIds.has(ingId)) continue;
          const delIng = allIngredientMap.get(ingId);
          // Exclui órfãos que eram de categorias de produção
          if (CATEGORIAS_PRODUCAO.has(delIng?.category ?? '') || delIng?.usageType === 'production') continue;

          result.push({
            id: ingId,
            nome: delIng?.name ?? `Removido (${ingId.slice(0, 8)}...)`,
            unidade: (delIng?.unit ?? 'un') as UnidadeEstoque,
            categoria: delIng?.category ?? '—',
            fornecedor: delIng?.supplier ?? '—',
            estoqueAtual: 0,
            minimo: 0,
            totalConsumido: c.totalSaidas,
            porTipo: c.porTipo,
            totalVendas: ordersTotal,
            qtdPedidos: ordersCount,
            custoTotal: 0,
            custoVendas: 0,
            custoProducao: 0,
            custoPerda: 0,
            mediaDiaria: c.diasComMovimento.size > 0 ? c.totalSaidas / c.diasComMovimento.size : 0,
            diasAteZerar: null,
            tendencia: 'estavel',
            semCadastro: true,
          });
        }

        result.sort((a, b) => {
          if (a.semCadastro !== b.semCadastro) return a.semCadastro ? 1 : -1;
          return (b.custoTotal ?? 0) - (a.custoTotal ?? 0);
        });

        const criticoCount = result.filter(
          (r) => !r.semCadastro && r.diasAteZerar !== null && r.diasAteZerar <= 3,
        ).length;

        const resumoData: ConsumoResumo = {
          totalIngredientes: activeIngredients.length,
          totalConsumidoValor: result.filter((r) => !r.semCadastro).reduce((s, r) => s + r.custoTotal, 0),
          totalVendasValor: ordersTotal,
          ingredientesCriticos: criticoCount,
          mediaConsumoDiario:
            result.filter((r) => !r.semCadastro).reduce((s, r) => s + r.mediaDiaria, 0) /
            Math.max(result.filter((r) => !r.semCadastro).length, 1),
          custoVendas: result.reduce((s, r) => s + r.custoVendas, 0),
          custoProducao: result.reduce((s, r) => s + r.custoProducao, 0),
          custoPerda: result.reduce((s, r) => s + r.custoPerda, 0),
        };

        if (!cancelled) {
          setDados(result);
          setResumo(resumoData);
          setDebugInfo({
            movsCount: movements.length,
            insumosCount: activeIngredients.length,
            orfas: result.filter((r) => r.semCadastro).length,
            ordersCount,
            cadastrados: activeIngredients.length,
            tenantName: '',
          });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Erro desconhecido';
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [tenantId, fromIso, toIso]);

  return {
    dados,
    resumo,
    loading,
    error,
    debugInfo,
    reload: () => window.location.reload(),
  };
}