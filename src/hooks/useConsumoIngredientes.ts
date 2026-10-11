import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { convertUnit } from '@/lib/unitConversion';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { todayBrasilia, somarDias } from '@/lib/dateUtils';
import { dividirPeriodo, tendenciaDe, type Tendencia } from '@/lib/consumoInsumos';
import type { UnidadeEstoque } from '@/types/estoque';

export interface ConsumoPorTipo {
  vendas: number;
  producao: number;
  perda: number;
  ajuste: number;
  transferencia: number;
}

// "Quanto dura" e "abaixo do mínimo" NÃO são calculados aqui: vêm da regra única do Estoque
// (fn_estoque_situacao, lida pela tela). Antes este hook dividia pelos dias com QUALQUER movimento.
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
  custoTotal: number;
  custoVendas: number;
  custoProducao: number;
  custoPerda: number;
  /** 2ª metade do período × 1ª metade; null = sem como comparar */
  tendencia: Tendencia | null;
  semCadastro: boolean;
}

export interface ConsumoResumo {
  /** Insumos cadastrados que tiveram alguma saída no período */
  insumosUsados: number;
  totalConsumidoValor: number;
  /** null = não deu para ler os pedidos (a tela mostra "—", nunca R$ 0 falso) */
  totalVendasValor: number | null;
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

// Acertos de saldo que só corrigem um lançamento anterior (data/quantidade de compra, conversão, ficha, contagem):
// o estoque se mexe, mas nada foi usado — não entram em consumo. Textos gravados por purchase-confirm-delivery,
// purchase-write, vinculo de conversão (SQL) e ficha-retroativa; comparados sem acento e em minúsculas.
const PREFIXOS_ACERTO = [
  'correcao de conversao',
  'correcao de ficha (saldo mantido)',
  'correcao da contagem', // "Correção da contagem: data do recebimento mudou" (inventory_adjustment)
  'ajuste no recebimento',
  'ajuste por edicao da compra',
  'detalhamento dos itens da compra',
];

function classifyMovement(
  type: string,
  reason: string | null,
  signed: number | null = null,
): {
  bucket: keyof ConsumoPorTipo;
  isConsumo: boolean;
} {
  const r = (reason || '').toLowerCase();
  const rSemAcento = r.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // ── Entradas NUNCA são consumo, independente do reason ──────────────────
  // type='in' é sempre entrada (compra, produção própria, ajuste positivo)
  if (type === 'in') return { bucket: 'ajuste', isConsumo: false };

  // Transferência (empréstimo entre lojas) não é consumo da loja, nem na entrada nem na saída
  if (type === 'transfer_in' || type === 'transfer_out') return { bucket: 'transferencia', isConsumo: false };

  // Estorno (ex.: produção excluída) desfaz um movimento: não é consumo (2026-10-04)
  if (r.startsWith('estorno')) return { bucket: 'ajuste', isConsumo: false };

  // Acerto contábil de compra/conversão/ficha/contagem: mantém o saldo certo, não é consumo
  if (PREFIXOS_ACERTO.some((p) => rSemAcento.startsWith(p))) return { bucket: 'ajuste', isConsumo: false };

  // ── A partir daqui só temos saídas / consumo ─────────────────────────────

  /* vendas diretas (PDV) */
  if (type === 'theoretical_out') return { bucket: 'vendas', isConsumo: true };

  /* perda — o tipo 'loss' é perda por definição, independente do reason */
  if (type === 'loss') return { bucket: 'perda', isConsumo: true };
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

  /* ajuste de inventário: só o que a contagem achou A MENOS é saída; a mais é entrada, não consumo */
  if (type === 'inventory_adjustment') return { bucket: 'ajuste', isConsumo: signed != null && signed < 0 };

  /* manual_out genérico = saída manual */
  if (type === 'manual_out') return { bucket: 'ajuste', isConsumo: true };

  return { bucket: 'ajuste', isConsumo: false };
}

// Lê tudo paginado: as funções do banco devolvem TABLE e o PostgREST corta em ~1000 linhas sem avisar
// (um mês de vendas passa disso fácil). Ordenar por created_at/id mantém as páginas estáveis.
const LIMITE_MOVIMENTOS = 100_000;
const LIMITE_PEDIDOS = 50_000;

interface MovimentoRow {
  id: string;
  ingredient_id: string;
  ingredient_name: string | null;
  type: string;
  quantity: number;
  ingredient_unit?: string | null;
  reason?: string | null;
  created_at?: string | null;
  signed_quantity?: number | null;
}
interface PedidoRow { id: string; total: number | null; status: string | null }

const PEDIDO_NAO_VALE = new Set(['cancelled', 'canceled', 'cancelado', 'refunded']);

interface Acumulado {
  nome: string;
  porTipo: ConsumoPorTipo;
  totalSaidas: number;
  /** true se houve venda direta (theoretical_out) no período */
  temVendasDiretas: boolean;
  /** vendas / produção na 1ª e na 2ª metade do período (para a tendência) */
  vendas1: number; vendas2: number;
  producao1: number; producao2: number;
}

export function useConsumoIngredientes(dateFrom?: string, dateTo?: string) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const hojeBR = todayBrasilia();
  const fromIso = dateFrom ?? somarDias(hojeBR, -29);
  const toIso = dateTo ?? hojeBR;

  const [dados, setDados] = useState<ConsumoIngrediente[]>([]);
  const [resumo, setResumo] = useState<ConsumoResumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Leitura incompleta (período grande demais, vendas que não vieram): a tela avisa em vez de mostrar número como certo
  const [aviso, setAviso] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  // Recarrega só os dados — período e filtros ficam como estão (antes era window.location.reload()).
  const reload = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => {
    if (!tenantId) {
      setDados([]);
      setResumo(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setAviso(null);

      try {
        // Dia de Brasília inteiro (fuso fixo -03:00, como no resto dos relatórios)
        const deTs = new Date(`${fromIso}T00:00:00-03:00`).toISOString();
        const ateTs = new Date(`${toIso}T23:59:59.999-03:00`).toISOString();

        const [ingsRes, movsRes, pedidosRes] = await Promise.all([
          /* 1) insumos via RPC (funciona com RLS) */
          supabase.rpc('fn_get_ingredients', { p_tenant_id: tenantId }),
          /* 2) movimentos de estoque do período */
          fetchAllRows<MovimentoRow>(
            (a, b) =>
              supabase
                .rpc('fn_get_stock_movements_filtered', { p_tenant_id: tenantId, p_date_from: deTs, p_date_to: ateTs })
                .order('created_at', { ascending: true })
                .order('id', { ascending: true })
                .range(a, b),
            { maxRows: LIMITE_MOVIMENTOS },
          ),
          /* 3) pedidos do período (para o "Vendas") */
          fetchAllRows<PedidoRow>(
            (a, b) =>
              supabase
                .rpc('fn_get_orders_for_consumo', { p_tenant_id: tenantId, p_date_from: deTs, p_date_to: ateTs })
                .order('created_at', { ascending: true })
                .order('id', { ascending: true })
                .range(a, b),
            { maxRows: LIMITE_PEDIDOS },
          ),
        ]);
        if (ingsRes.error) throw ingsRes.error;
        if (movsRes.error) throw movsRes.error;

        const avisos: string[] = [];
        if (movsRes.truncated) {
          avisos.push('Este período tem movimentos demais para ler de uma vez: os números estão incompletos. Escolha um período menor.');
        }

        const ingredients = ((ingsRes.data as Array<Record<string, unknown>>) ?? []).map((r) => ({
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

        const movements = movsRes.rows.map((r) => ({
          ingredientId: r.ingredient_id,
          ingredientName: r.ingredient_name ?? null,
          type: r.type,
          quantity: Number(r.quantity),
          unit: normalizeUnit(r.ingredient_unit),
          reason: r.reason ?? null,
          createdMs: r.created_at ? Date.parse(r.created_at) : NaN,
          signed: r.signed_quantity == null ? null : Number(r.signed_quantity),
        }));

        /* pedidos: se não vieram, o "Vendas" fica em branco (null) — nunca R$ 0 como se fosse verdade */
        let ordersTotal: number | null = null;
        if (pedidosRes.error) {
          avisos.push('Não consegui somar as vendas do período. O restante está certo.');
        } else {
          ordersTotal = pedidosRes.rows
            .filter((o) => !PEDIDO_NAO_VALE.has(String(o.status)))
            .reduce((s, o) => s + Number(o.total ?? 0), 0);
          if (pedidosRes.truncated) avisos.push('Há pedidos demais no período: o total de vendas pode estar incompleto.');
        }

        /* 4) agregar */
        // Tendência: a 2ª metade do período escolhido contra a 1ª (sem o dia de hoje, que ainda não terminou)
        const divisao = dividirPeriodo(fromIso, toIso, hojeBR);
        const agg = new Map<string, Acumulado>();

        for (const m of movements) {
          const classified = classifyMovement(m.type, m.reason, m.signed);
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
            nome: m.ingredientName ?? '',
            porTipo: { vendas: 0, producao: 0, perda: 0, ajuste: 0, transferencia: 0 },
            totalSaidas: 0,
            temVendasDiretas: false,
            vendas1: 0, vendas2: 0,
            producao1: 0, producao2: 0,
          };

          if (classified.isConsumo) {
            prev.totalSaidas += finalQty;
            prev.porTipo[classified.bucket] += finalQty;
          }

          // Marca se houve vendas diretas (theoretical_out) no período
          if (m.type === 'theoretical_out') prev.temVendasDiretas = true;

          // Tendência: vendas para insumos finais, produção para insumos intermediários
          if (divisao && classified.isConsumo && (classified.bucket === 'vendas' || classified.bucket === 'producao')) {
            const t = m.createdMs;
            const metade = t < divisao.fimPrimeiraMs ? 1 : t >= divisao.inicioSegundaMs && t < divisao.fimSegundaMs ? 2 : 0;
            if (metade === 1) { if (classified.bucket === 'vendas') prev.vendas1 += finalQty; else prev.producao1 += finalQty; }
            if (metade === 2) { if (classified.bucket === 'vendas') prev.vendas2 += finalQty; else prev.producao2 += finalQty; }
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
          const custo = totalConsumido * ing.unitPrice;

          // Referência da tendência: se o insumo teve venda direta, vale a VENDA; produto produzido puro
          // (usage_type='production' sem venda) vale a PRODUÇÃO (saída para outras receitas).
          const usaProducao = ing.usageType === 'production' && !(c?.temVendasDiretas ?? false);
          const metade1 = usaProducao ? (c?.producao1 ?? 0) : (c?.vendas1 ?? 0);
          const metade2 = usaProducao ? (c?.producao2 ?? 0) : (c?.vendas2 ?? 0);

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
            custoTotal: custo,
            custoVendas: porTipo.vendas * ing.unitPrice,
            custoProducao: porTipo.producao * ing.unitPrice,
            custoPerda: porTipo.perda * ing.unitPrice,
            tendencia: divisao ? tendenciaDe(metade1, metade2) : null,
            semCadastro: false,
          });
        }

        /* 6) insumos órfãos (removidos ou sem cadastro) */
        const processedIds = new Set(activeIngredients.map((i) => i.id));
        for (const [ingId, c] of agg.entries()) {
          if (processedIds.has(ingId)) continue;
          const delIng = allIngredientMap.get(ingId);
          // Exclui órfãos que eram de categorias de produção
          if (CATEGORIAS_PRODUCAO.has(delIng?.category ?? '') || delIng?.usageType === 'production') continue;

          result.push({
            id: ingId,
            nome: delIng?.name ?? (c.nome || `Removido (${ingId.slice(0, 8)}...)`),
            unidade: (delIng?.unit ?? 'un') as UnidadeEstoque,
            categoria: delIng?.category ?? '—',
            fornecedor: delIng?.supplier ?? '—',
            estoqueAtual: 0,
            minimo: 0,
            totalConsumido: c.totalSaidas,
            porTipo: c.porTipo,
            custoTotal: 0,
            custoVendas: 0,
            custoProducao: 0,
            custoPerda: 0,
            tendencia: null,
            semCadastro: true,
          });
        }

        result.sort((a, b) => {
          if (a.semCadastro !== b.semCadastro) return a.semCadastro ? 1 : -1;
          return (b.custoTotal ?? 0) - (a.custoTotal ?? 0);
        });

        const cadastrados = result.filter((r) => !r.semCadastro);
        const resumoData: ConsumoResumo = {
          insumosUsados: cadastrados.filter((r) => r.totalConsumido > 0).length,
          totalConsumidoValor: cadastrados.reduce((s, r) => s + r.custoTotal, 0),
          totalVendasValor: ordersTotal,
          custoVendas: result.reduce((s, r) => s + r.custoVendas, 0),
          custoProducao: result.reduce((s, r) => s + r.custoProducao, 0),
          custoPerda: result.reduce((s, r) => s + r.custoPerda, 0),
        };

        if (!cancelled) {
          setDados(result);
          setResumo(resumoData);
          setAviso(avisos.length ? avisos.join(' ') : null);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[Consumo] falha ao carregar', e);
          // Nada de número velho de outro período/loja ao lado do erro
          setDados([]);
          setResumo(null);
          setError('Não deu para carregar o consumo agora.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [tenantId, fromIso, toIso, tentativa]);

  return { dados, resumo, loading, error, aviso, reload };
}
