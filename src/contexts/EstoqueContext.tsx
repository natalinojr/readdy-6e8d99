import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificacoes } from './NotificacoesContext';
import { useAuditoria } from './AuditoriaContext';
import { convertUnit } from '@/lib/unitConversion';
import type { UnidadeEstoque, Movimentacao, InventarioSession, InventarioItemContado } from '../types/estoque';

export type { InventarioSession, InventarioItemContado };

/* ─── Cross-tab sync via BroadcastChannel ─── */
const ESTOQUE_BROADCAST = 'erpos-estoque-sync';
function getBroadcastChannel(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(ESTOQUE_BROADCAST);
  } catch {
    return null;
  }
}

/* ─── DB Row Types ─── */

interface DBIngredient {
  id: string;
  name: string;
  unit?: string | null;
  unit_price?: number | null;
  min_stock?: number | null;
  current_stock?: number | null;
  is_depleted?: boolean | null;
  category?: string | null;
  supplier?: string | null;
  supplier_id?: string | null;
  updated_at?: string | null;
  price_source?: string | null;
  last_purchase_price?: number | null;
  last_purchase_date?: string | null;
  purchase_unit?: string | null;
  purchase_factor?: number | null;
  deleted_at?: string | null;
  dre_category_id?: string | null;
  usage_type?: string | null;
}

interface DBStockMovement {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  type: string;
  quantity: number;
  ingredient_unit?: string | null;
  reason?: string | null;
  operator_name?: string | null;
  created_at?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  sold_item_name?: string | null;
}

export interface Insumo {
  id: string;
  nome: string;
  unidade: UnidadeEstoque;
  precoUnitario: number;
  estoqueMinimo: number;
  estoqueAtual: number;
  esgotado: boolean;
  categoria: string;
  fornecedor: string;
  ultimaEntrada: string;
  fichaTecnica: Array<{ insumoId: string; insumoNome: string; unidade: UnidadeEstoque; gramagem: number }>;
  priceSource?: 'manual' | 'purchase' | 'average';
  lastPurchasePrice?: number;
  lastPurchaseDate?: string;
  /** Unidade usada na hora de comprar (ex: 'caixa', 'fardo', 'g'). null = mesma do estoque */
  purchaseUnit?: string | null;
  /** Quantas unidades de estoque correspondem a 1 unidade de compra. Ex: caixa de 6 un → 6 */
  purchaseFactor: number;
  /** ID do fornecedor cadastrado em fin_suppliers */
  supplierId?: string | null;
  /** ID da categoria DRE para classificação no DRE */
  dreCategoryId?: string | null;
  /** 'final' = usa direto no cardápio; 'production' = só usado em fichas de produção (semi-acabado) */
  usageType: 'final' | 'production';
}

export interface PerdaItem {
  insumoId: string;
  insumoNome: string;
  quantidade: number;
  unidade: UnidadeEstoque;
}

const DB_UNIT_MAP: Record<string, UnidadeEstoque> = {
  g: 'g', kg: 'kg', ml: 'ml', L: 'l', unit: 'un',
};

const FRONT_UNIT_MAP: Record<string, string> = {
  g: 'g', kg: 'kg', ml: 'ml', l: 'L', un: 'unit',
};

const MOVE_TYPE_MAP: Record<string, string> = {
  entrada: 'in',
  saida_venda: 'theoretical_out',
  saida_manual: 'manual_out',
  perda: 'manual_out',
  ajuste_inventario: 'inventory_adjustment',
};

// Mapeamento inverso: tipo do banco → tipo do frontend
const DB_TYPE_TO_FRONT: Record<string, Movimentacao['tipo']> = {
  in: 'entrada',
  manual_out: 'saida_manual',
  theoretical_out: 'saida_venda',
  inventory_adjustment: 'entrada',
  transfer_in: 'entrada',
  transfer_out: 'saida_manual',
  // Fallback para tipos legados já em português
  entrada: 'entrada',
  saida_venda: 'saida_venda',
  saida_manual: 'saida_manual',
  perda: 'perda',
};

function detectProducaoTipo(mv: DBStockMovement): Movimentacao['tipo'] {
  const reason = mv.reason ?? '';
  const type = mv.type;
  // Detectar entrada/saída de produção pelo reason
  // Suporta tanto o formato antigo "Producao:" quanto o novo "(producao)" da v2
  if (reason.includes('Producao:') || reason.includes('Produção:') || reason.includes('(producao)') || reason.includes('(produção)')) {
    if (type === 'in') return 'entrada_producao';
    if (type === 'manual_out') return 'saida_producao';
  }
  if (reason.includes('Perda em produc') || reason.includes('Perda em produção')) {
    return 'perda';
  }
  return DB_TYPE_TO_FRONT[type] ?? 'entrada';
}

function dbToInsumo(row: DBIngredient): Insumo | null {
  if (row.deleted_at) return null;
  const updatedAt = row.updated_at ? new Date(row.updated_at).toLocaleDateString('pt-BR') : '—';
  return {
    id: row.id,
    nome: row.name,
    unidade: DB_UNIT_MAP[row.unit ?? ''] ?? 'un',
    precoUnitario: Number(row.unit_price ?? 0),
    estoqueMinimo: Number(row.min_stock ?? 0),
    estoqueAtual: Number(row.current_stock ?? 0),
    esgotado: row.is_depleted ?? false,
    categoria: row.category ?? '',
    // supplier (texto livre) e supplier_id (FK) agora vem da RPC
    fornecedor: row.supplier ?? '',
    ultimaEntrada: updatedAt,
    fichaTecnica: [],
    priceSource: (row.price_source as Insumo['priceSource']) ?? 'manual',
    lastPurchasePrice: row.last_purchase_price ? Number(row.last_purchase_price) : undefined,
    lastPurchaseDate: row.last_purchase_date ?? undefined,
    purchaseUnit: row.purchase_unit ?? null,
    purchaseFactor: Number(row.purchase_factor ?? 1) || 1,
    supplierId: row.supplier_id ?? null,
    dreCategoryId: row.dre_category_id ?? null,
    usageType: (row.usage_type as 'final' | 'production') ?? 'final',
  };
}

interface EstoqueContextValue {
  insumos: Insumo[];
  movimentacoes: Movimentacao[];
  inventarioSessions: InventarioSession[];
  insumosEsgotados: string[];
  itensDesabilitadosIds: string[];
  loading: boolean;
  deductSaleItems: (
    orderId: string,
    itens: Array<{ itemId: string; nome: string; quantidade: number }>
  ) => Promise<void>;
  addMovimentacao: (mov: {
    insumoId: string;
    tipo: string;
    quantidade: number;
    unidade: string;
    motivo?: string;
    operadorId?: string;
  }) => Promise<void>;
  registrarPerda: (itensPerda: PerdaItem[], motivo: string, operador: string) => Promise<void>;
  confirmarInventario: (itens: InventarioItemContado[], operador: string) => Promise<void>;
  marcarInsumoEsgotado: (insumoId: string, operador?: string) => Promise<void>;
  upsertInsumo: (insumo: Partial<Insumo> & { nome: string }) => Promise<string | undefined>;
  setInsumos: React.Dispatch<React.SetStateAction<Insumo[]>>;
  reloadInsumos: () => Promise<void>;
  reloadMovimentacoes: () => Promise<void>;
}

const EstoqueContext = createContext<EstoqueContextValue | null>(null);

export function EstoqueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { dispararNotificacao } = useNotificacoes();
  const { registrarEvento } = useAuditoria();

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);
  const [inventarioSessions, setInventarioSessions] = useState<InventarioSession[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Ref para detectar transição de estoque positivo → zero
  const insumosSnapshotRef = useRef<Map<string, number>>(new Map());

  const loadInsumos = useCallback(async () => {
    if (!user?.tenantId) { setLoading(false); return; }
    try {
      const tenantId = user.tenantId;

      const { data, error } = await supabase.rpc('fn_get_ingredients', { p_tenant_id: tenantId });
      if (error) throw error;
      const rows = (data as Array<Record<string, unknown>>) ?? [];
      const loaded = rows.map((r) => dbToInsumo(r as unknown as DBIngredient)).filter((i): i is Insumo => i !== null);

      // ── Detectar insumos que acabaram de zerar (eram > 0, agora <= 0) ─────────────
      const snapshot = insumosSnapshotRef.current;
      if (snapshot.size > 0) {
        for (const novo of loaded) {
          const estoqueAnterior = snapshot.get(novo.id);
          if (estoqueAnterior !== undefined && estoqueAnterior > 0 && novo.estoqueAtual <= 0) {
            dispararNotificacao({
              tipo: 'insumo_esgotado',
              titulo: `Insumo zerou: ${novo.nome}`,
              mensagem: `O estoque de "${novo.nome}" chegou a zero. Itens que usam esse insumo foram bloqueados nos PDVs automaticamente.`,
              urgente: true,
              perfisAlvo: ['garcom', 'caixa', 'gerente', 'admin'],
              icone: 'ri-forbid-2-line',
              cor: 'red',
            });
            // Recarrega o hook useItensSemEstoque em todas as telas
            window.dispatchEvent(new CustomEvent('estoque_updated'));
          }
          // Insumo foi reposto (era zero, agora positivo)
          if (estoqueAnterior !== undefined && estoqueAnterior <= 0 && novo.estoqueAtual > 0) {
            dispararNotificacao({
              tipo: 'insumo_reposto',
              titulo: `Insumo reposto: ${novo.nome}`,
              mensagem: `O estoque de "${novo.nome}" foi reposto (${novo.estoqueAtual} ${novo.unidade}). Itens do cardápio estão disponíveis novamente.`,
              urgente: false,
              perfisAlvo: ['garcom', 'caixa', 'gerente'],
              icone: 'ri-refresh-line',
              cor: 'teal',
            });
            window.dispatchEvent(new CustomEvent('estoque_updated'));
          }
        }
      }
      // Atualiza snapshot com valores atuais
      insumosSnapshotRef.current = new Map(loaded.map((i) => [i.id, i.estoqueAtual]));

      setInsumos(loaded);

      // ── Alertas de estoque mínimo ──────────────────────────────────────────
      const alertadosKey = `stock_alerted_${user.tenantId}`;
      let alertados: string[] = [];
      try {
        alertados = JSON.parse(sessionStorage.getItem(alertadosKey) ?? '[]');
      } catch { alertados = []; }

      const novosAlertados: string[] = [...alertados];

      for (const insumo of loaded) {
        if (insumo.estoqueMinimo <= 0) continue;

        const abaixoMinimo = insumo.estoqueAtual <= insumo.estoqueMinimo && !insumo.esgotado;
        const jaAlertado = alertados.includes(insumo.id);

        if (abaixoMinimo && !jaAlertado) {
          const critico = insumo.estoqueAtual <= 0;
          dispararNotificacao({
            tipo: 'estoque_minimo',
            titulo: critico
              ? `Estoque zerado: ${insumo.nome}`
              : `Estoque mínimo: ${insumo.nome}`,
            mensagem: critico
              ? `${insumo.nome} está com estoque zerado. Reposição urgente necessária.`
              : `${insumo.nome} atingiu o nível mínimo (${insumo.estoqueAtual} ${insumo.unidade} restante — mín: ${insumo.estoqueMinimo} ${insumo.unidade}).`,
            urgente: critico,
            perfisAlvo: ['admin', 'gerente'],
            icone: critico ? 'ri-forbid-2-line' : 'ri-archive-line',
            cor: critico ? 'red' : 'yellow',
          });
          novosAlertados.push(insumo.id);
        }

        if (!abaixoMinimo && jaAlertado) {
          const idx = novosAlertados.indexOf(insumo.id);
          if (idx !== -1) novosAlertados.splice(idx, 1);
        }
      }

      try {
        sessionStorage.setItem(alertadosKey, JSON.stringify(novosAlertados));
      } catch { /* ignore */ }
    } catch (e) {
      console.error('[EstoqueContext] loadInsumos error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, dispararNotificacao]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMovimentacoes = useCallback(async () => {
    if (!user?.tenantId) return;
    try {
      const tenantId = user.tenantId;

      const { data, error } = await supabase.rpc('fn_get_stock_movements', {
        p_tenant_id: tenantId, p_limit: 200,
      });
      if (error) throw error;
      const rows = (data as DBStockMovement[]) ?? [];
      const now = new Date();
      const movs: Movimentacao[] = rows.map((r) => {
        const createdAt = r.created_at ? new Date(r.created_at) : now;
        const tipoDetectado = detectProducaoTipo(r);
        return {
          id: r.id,
          insumoId: r.ingredient_id,
          insumoNome: r.ingredient_name,
          tipo: tipoDetectado,
          quantidade: Number(r.quantity),
          unidade: DB_UNIT_MAP[r.ingredient_unit ?? ''] ?? 'un',
          motivo: r.reason ?? '',
          operador: r.operator_name ?? 'Sistema',
          data: createdAt.toLocaleDateString('pt-BR'),
          hora: createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          pedidoNumero: r.order_number ?? null,
          itemVendidoNome: r.sold_item_name ?? null,
        };
      });
      setMovimentacoes(movs);
    } catch (e) {
      console.error('[EstoqueContext] loadMovimentacoes error:', e);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    if (!user?.tenantId) { setLoading(false); return; }

    // Carga inicial
    loadInsumos();
    loadMovimentacoes();

    // ── Realtime: todas as tabelas que afetam estoque ─────────────────────
    const tenantId = user.tenantId;
    const channel = supabase
      .channel(`estoque-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients', filter: `tenant_id=eq.${tenantId}` }, () => {
        loadInsumos();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_movements', filter: `tenant_id=eq.${tenantId}` }, () => {
        loadMovimentacoes();
        loadInsumos();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'production_batches', filter: `tenant_id=eq.${tenantId}` }, () => {
        loadInsumos();
        loadMovimentacoes();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_batch_items' }, () => {
        loadInsumos();
        loadMovimentacoes();
      })
      .subscribe((status) => {
        console.log('[EstoqueContext] realtime status:', status);
      });

    channelRef.current = channel;

    // ── Cross-tab sync via BroadcastChannel ────────────────────────────────
    const bc = getBroadcastChannel();
    const handleBroadcast = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.tenantId !== tenantId) return;
      if (msg?.type === 'stock_updated' || msg?.type === 'ingredient_updated') {
        loadInsumos();
        loadMovimentacoes();
      }
    };
    bc?.addEventListener('message', handleBroadcast);

    // ── Fallback: storage event para sincronização cross-tab ───────────────
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'erpos_estoque_reload_trigger') {
        loadInsumos();
        loadMovimentacoes();
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
      bc?.removeEventListener('message', handleBroadcast);
      bc?.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, [user?.tenantId, loadInsumos, loadMovimentacoes]);

  // Função para notificar outras abas sobre mudança no estoque
  const broadcastStockUpdate = useCallback(() => {
    const bc = getBroadcastChannel();
    bc?.postMessage({ type: 'stock_updated', tenantId: user?.tenantId, timestamp: Date.now() });
    bc?.close();
    // Fallback storage event
    try {
      localStorage.setItem('erpos_estoque_reload_trigger', String(Date.now()));
    } catch { /* ignore */ }
  }, [user?.tenantId]);

  const insumosEsgotados = insumos
    .filter((i) => i.estoqueAtual <= 0 || i.esgotado)
    .map((i) => i.id);

  // Items disabled by empty ingredients (no ficha técnica in DB yet — use empty array)
  const itensDesabilitadosIds: string[] = [];

  const addMovimentacao = useCallback(async (mov: {
    insumoId: string;
    tipo: string;
    quantidade: number;
    unidade: string;
    motivo?: string;
    operadorId?: string;
  }) => {
    if (!user?.tenantId) return;
    const { error } = await invokeWithAuth('stock-write', {
      body: {
        action: 'add_stock_movement',
        tenant_id: user.tenantId,
        ingredient_id: mov.insumoId,
        type: MOVE_TYPE_MAP[mov.tipo] ?? mov.tipo,
        quantity: mov.quantidade,
        unit: FRONT_UNIT_MAP[mov.unidade ?? 'un'] ?? 'unit',
        reason: mov.motivo ?? null,
        operator_id: mov.operadorId ?? null,
      },
    });
    if (error) { console.error('[EstoqueContext] addMovimentacao error:', error); return; }

    // Notificar outras abas
    broadcastStockUpdate();

    // Forçar recarga imediata nesta aba
    await loadInsumos();
    await loadMovimentacoes();

    const insumo = insumos.find((i) => i.id === mov.insumoId);
    const tipoAuditoria = mov.tipo === 'entrada' ? 'estoque_entrada' : 'estoque_ajustado';
    registrarEvento({
      tipo: tipoAuditoria,
      severidade: 'info',
      usuario: user.nome,
      perfil: user.perfil,
      descricao: `${mov.tipo === 'entrada' ? 'Entrada' : 'Ajuste'} de ${mov.quantidade} ${mov.unidade} em "${insumo?.nome ?? mov.insumoId}"`,
      entidade: 'Insumo',
      entidadeId: insumo?.nome ?? mov.insumoId,
      detalhes: mov.motivo ?? undefined,
      depois: { quantidade: mov.quantidade, motivo: mov.motivo ?? '' },
    });
  }, [user, insumos, registrarEvento, broadcastStockUpdate, loadInsumos, loadMovimentacoes]);

  const registrarPerda = useCallback(async (itensPerda: PerdaItem[], motivo: string, _operador: string) => {
    if (!user?.tenantId) return;
    for (const item of itensPerda) {
      const insumo = insumos.find((i) => i.id === item.insumoId);
      const insumoUnit = insumo?.unidade ?? item.unidade;
      const perdaUnit = item.unidade;
      let finalQty = item.quantidade;
      if (insumoUnit !== perdaUnit) {
        const converted = convertUnit(item.quantidade, perdaUnit, insumoUnit);
        if (converted !== null) {
          finalQty = converted;
        }
      }
      await invokeWithAuth('stock-write', {
        body: {
          action: 'add_stock_movement',
          tenant_id: user.tenantId,
          ingredient_id: item.insumoId,
          type: 'manual_out',
          quantity: finalQty,
          unit: FRONT_UNIT_MAP[insumoUnit] ?? 'unit',
          reason: motivo,
        },
      });
    }
    // Notificar outras abas e recarregar
    broadcastStockUpdate();
    await loadInsumos();
    await loadMovimentacoes();

    const nomes = itensPerda.map((i) => `${i.insumoNome} (${i.quantidade} ${i.unidade})`).join(', ');
    registrarEvento({
      tipo: 'perda_registrada',
      severidade: 'aviso',
      usuario: user.nome,
      perfil: user.perfil,
      descricao: `Perda registrada: ${nomes}`,
      entidade: 'Estoque',
      entidadeId: `${itensPerda.length} insumo(s)`,
      detalhes: motivo,
      depois: { itens: itensPerda.length, motivo },
    });
  }, [user, insumos, registrarEvento, broadcastStockUpdate, loadInsumos, loadMovimentacoes]);

  const marcarInsumoEsgotado = useCallback(async (insumoId: string, _operador = 'Operador') => {
    if (!user?.tenantId) return;
    const { error } = await invokeWithAuth('stock-write', {
      body: {
        action: 'mark_depleted',
        tenant_id: user.tenantId,
        ingredient_id: insumoId,
        depleted: true,
      },
    });
    if (error) console.error('[EstoqueContext] marcarInsumoEsgotado error:', error);

    broadcastStockUpdate();
    await loadInsumos();

    const insumo = insumos.find((i) => i.id === insumoId);
    if (insumo) {
      dispararNotificacao({
        tipo: 'insumo_esgotado',
        titulo: `Insumo esgotado: ${insumo.nome}`,
        mensagem: `${insumo.nome} marcado como esgotado.`,
        urgente: true,
        perfisAlvo: ['garcom', 'caixa'],
        icone: 'ri-forbid-2-line',
        cor: 'red',
      });
      registrarEvento({
        tipo: 'insumo_esgotado',
        severidade: 'critico',
        usuario: user.nome,
        perfil: user.perfil,
        descricao: `Insumo "${insumo.nome}" marcado como esgotado`,
        entidade: 'Insumo',
        entidadeId: insumo.nome,
        depois: { estoque: 0, esgotado: 1 },
      });
    }
  }, [user, insumos, dispararNotificacao, registrarEvento, broadcastStockUpdate, loadInsumos]);

  const confirmarInventario = useCallback(async (itens: InventarioItemContado[], _operador: string) => {
    if (!user?.tenantId) return;
    const payload = itens.map((i) => ({
      ingredient_id: i.insumoId,
      qtd_contada: i.qtdContada,
      diferenca: i.diferenca,
    }));
    const { error } = await invokeWithAuth('stock-write', {
      body: {
        action: 'confirm_inventory',
        tenant_id: user.tenantId,
        items: payload,
      },
    });
    if (error) console.error('[EstoqueContext] confirmarInventario error:', error);

    broadcastStockUpdate();
    await loadInsumos();
    await loadMovimentacoes();

    const valorAjuste = itens.reduce((sum, i) => sum + i.diferenca * (i.precoUnitario ?? 0), 0);
    const comDiferenca = itens.filter((i) => i.diferenca !== 0).length;
    registrarEvento({
      tipo: 'estoque_ajustado',
      severidade: comDiferenca > 0 ? 'aviso' : 'info',
      usuario: user.nome,
      perfil: user.perfil,
      descricao: `Inventário confirmado: ${itens.length} insumo(s), ${comDiferenca} com diferença, ajuste líquido R$ ${valorAjuste.toFixed(2)}`,
      entidade: 'Inventário',
      entidadeId: `${itens.length} insumos`,
      depois: { itens_contados: itens.length, divergencias: comDiferenca, valor_ajuste: valorAjuste },
    });

    const now = new Date();
    const novaSession: InventarioSession = {
      id: `inv-${Date.now()}`,
      numero: inventarioSessions.length + 1,
      data: now.toLocaleDateString('pt-BR'),
      hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      operador: _operador,
      status: 'confirmado',
      itens,
      itensContados: itens.length,
      itensComDiferenca: itens.filter((i) => i.diferenca !== 0).length,
      valorAjusteLiquido: valorAjuste,
    };
    setInventarioSessions((prev) => [novaSession, ...prev]);
  }, [user?.tenantId, inventarioSessions.length, registrarEvento, broadcastStockUpdate, loadInsumos, loadMovimentacoes]);

  const upsertInsumo = useCallback(async (insumo: Partial<Insumo> & { nome: string }): Promise<string | undefined> => {
    if (!user?.tenantId) return;
    const isNew = !insumo.id;
    const existing = insumo.id ? insumos.find((i) => i.id === insumo.id) : null;

    const body = {
      action: 'upsert_ingredient',
      tenant_id: user.tenantId,
      id: insumo.id ?? null,
      name: insumo.nome,
      unit: FRONT_UNIT_MAP[insumo.unidade ?? 'un'] ?? 'unit',
      unit_price: insumo.precoUnitario ?? 0,
      min_stock: insumo.estoqueMinimo ?? 0,
      current_stock: insumo.estoqueAtual ?? 0,
      category: insumo.categoria ?? '',
      supplier: insumo.fornecedor ?? '',
      supplier_id: insumo.supplierId ?? null,
      purchase_unit: insumo.purchaseUnit ?? null,
      purchase_factor: insumo.purchaseFactor ?? 1,
      usage_type: insumo.usageType ?? 'final',
    };

    let resultData: unknown = null;

    let error: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await invokeWithAuth<Record<string, unknown>>('stock-write', { body });
      error = result.error;
      if (!error) {
        resultData = result.data ?? null;
        break;
      }
      if (attempt < 3) {
        console.warn(`[EstoqueContext] upsertInsumo tentativa ${attempt} falhou, retentando...`, error.message);
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    if (error) { console.error('[EstoqueContext] upsertInsumo error após retries:', error); return; }

    let ingredientId: string | undefined;
    if (typeof resultData === 'object' && resultData !== null) {
      const outer = resultData as Record<string, unknown>;
      const innerData = outer.data ?? outer;
      if (typeof innerData === 'object' && innerData !== null) {
        if ('id' in (innerData as Record<string, unknown>)) {
          ingredientId = String((innerData as Record<string, unknown>).id);
        } else if (Array.isArray(innerData) && innerData.length > 0 && typeof innerData[0] === 'object') {
          ingredientId = String((innerData[0] as Record<string, unknown>).id ?? '');
        }
      }
    }

    if (!ingredientId && isNew) {
      const { data } = await supabase.rpc('fn_get_ingredients', { p_tenant_id: user.tenantId });
      const rows = (data as Array<Record<string, unknown>>) ?? [];
      const match = rows.find((r) => r.name === insumo.nome);
      if (match) ingredientId = String(match.id ?? '');
    }

    broadcastStockUpdate();
    await loadInsumos();

    registrarEvento({
      tipo: isNew ? 'estoque_entrada' : 'estoque_ajustado',
      severidade: 'info',
      usuario: user.nome,
      perfil: user.perfil,
      descricao: isNew
        ? `Insumo criado: "${insumo.nome}" (${insumo.unidade ?? 'un'}, mín: ${insumo.estoqueMinimo ?? 0})`
        : `Insumo editado: "${insumo.nome}"`,
      entidade: 'Insumo',
      entidadeId: insumo.nome,
      antes: existing
        ? { nome: existing.nome, estoqueMinimo: existing.estoqueMinimo, fornecedor: existing.fornecedor }
        : undefined,
      depois: { nome: insumo.nome ?? '', estoqueMinimo: insumo.estoqueMinimo ?? 0, fornecedor: insumo.fornecedor ?? '' },
    });

    return ingredientId;
  }, [user, insumos, registrarEvento, broadcastStockUpdate, loadInsumos]);

  // Deduct sale items via stock-write
  const deductSaleItems = useCallback(
    async (
      orderId: string,
      itens: Array<{ itemId: string; nome: string; quantidade: number }>,
    ) => {
      if (!user?.tenantId || itens.length === 0) return;

      try {
        const menuItemIds = [
          ...new Set(
            itens
              .map((i) => i.itemId)
              .filter((id): id is string => !!id && id.length > 0),
          ),
        ];

        if (menuItemIds.length === 0) return;

        const { data: ingredientsData, error: fetchErr } = await supabase.rpc(
          'fn_get_item_ingredients_batch',
          {
            p_tenant_id: user.tenantId,
            p_item_ids: menuItemIds,
          },
        );

        if (fetchErr) {
          console.warn('[EstoqueContext] deductSaleItems fetch error:', fetchErr.message);
          return;
        }

        const rows = (ingredientsData as Array<{
          item_id: string;
          ingredient_id: string;
          quantity: number;
          unit?: string | null;
        }>) ?? [];

        if (rows.length === 0) return;

        const insumoMap = new Map(insumos.map((i) => [i.id, { unidade: i.unidade, nome: i.nome }]));

        const deductionMap = new Map<string, { quantity: number; unit: string }>();
        for (const item of itens) {
          const fichas = rows.filter((r) => r.item_id === item.itemId);
          for (const ficha of fichas) {
            const insumo = insumoMap.get(ficha.ingredient_id);
            const fichaUnit = (ficha.unit ?? 'unit').toLowerCase().trim();
            const insumoUnit = insumo?.unidade ?? 'un';

            const convertedQty = convertUnit(ficha.quantity, fichaUnit, insumoUnit);
            const finalQty = convertedQty !== null ? convertedQty : ficha.quantity;
            const totalQty = finalQty * item.quantidade;

            const prev = deductionMap.get(ficha.ingredient_id);
            if (prev) {
              prev.quantity += totalQty;
            } else {
              deductionMap.set(ficha.ingredient_id, {
                quantity: totalQty,
                unit: insumoUnit,
              });
            }
          }
        }

        if (deductionMap.size === 0) return;

        const deductions = Array.from(deductionMap.entries()).map(([ingredient_id, info]) => ({
          ingredient_id,
          quantity: info.quantity,
          unit: FRONT_UNIT_MAP[info.unit] ?? 'unit',
          reason: 'Baixa automática por venda',
        }));

        const { error: deductErr } = await invokeWithAuth('stock-write', {
          body: {
            action: 'deduct_sale',
            tenant_id: user.tenantId,
            order_id: orderId,
            deductions,
          },
        });

        if (deductErr) {
          console.error('[EstoqueContext] deductSaleItems invoke error:', deductErr);
        }

        // Notificar outras abas e recarregar estoque
        broadcastStockUpdate();
      } catch (e) {
        console.error('[EstoqueContext] deductSaleItems error:', e);
      }
    },
    [user?.tenantId, insumos, broadcastStockUpdate],
  );

  return (
    <EstoqueContext.Provider value={{
      insumos, movimentacoes, inventarioSessions,
      insumosEsgotados, itensDesabilitadosIds, loading,
      deductSaleItems, addMovimentacao, registrarPerda,
      confirmarInventario, marcarInsumoEsgotado, upsertInsumo,
      setInsumos, reloadInsumos: loadInsumos, reloadMovimentacoes: loadMovimentacoes,
    }}>
      {children}
    </EstoqueContext.Provider>
  );
}

export function useEstoque(): EstoqueContextValue {
  const ctx = useContext(EstoqueContext);
  if (!ctx) throw new Error('useEstoque must be used within EstoqueProvider');
  return ctx;
}