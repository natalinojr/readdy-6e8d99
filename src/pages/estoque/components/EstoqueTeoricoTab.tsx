import { useState, useEffect, useCallback, useMemo } from 'react';
import { Calendar, Plus, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import CalendarioSeletorData from './CalendarioSeletorData';

interface TheoreticalCell {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  category: string | null;
  date: string;
  theoretical_stock: number | null;
  unreliable: boolean;
}

interface InventorySessionLite {
  id: string;
  numero: number;
  created_at: string;
  items: Array<Record<string, unknown>>;
}

interface RealCount {
  qtdContada: number;
  diferenca: number;
}

/** YYYY-MM-DD no fuso America/Sao_Paulo */
function toLocalISODate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function formatQty(v: number): string {
  // Ate 3 casas, sem zeros a mais — 5 fica "5", 5.2 fica "5,2", 0.05 fica "0,05"
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export default function EstoqueTeoricoTab() {
  const { user } = useAuth();
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [theoreticalRows, setTheoreticalRows] = useState<TheoreticalCell[]>([]);
  const [loadingTheoretical, setLoadingTheoretical] = useState(false);
  const [sessions, setSessions] = useState<InventorySessionLite[]>([]);
  const [showRealCount, setShowRealCount] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState('');
  const [error, setError] = useState<string | null>(null);

  const datesOrdenadas = useMemo(() => [...selectedDates].sort(), [selectedDates]);

  const carregarTeorico = useCallback(async () => {
    if (!user?.tenantId || selectedDates.length === 0) {
      setTheoreticalRows([]);
      return;
    }
    setLoadingTheoretical(true);
    setError(null);
    try {
      const result = await invokeWithAuth<{ data: TheoreticalCell[] }>('stock-write', {
        body: { action: 'get_theoretical_stock', tenant_id: user.tenantId, dates: selectedDates },
      });
      if (result.error) throw result.error;
      setTheoreticalRows(result.data?.data ?? []);
    } catch (e) {
      console.error('[EstoqueTeoricoTab] erro ao carregar estoque teorico:', e);
      setError('Nao foi possivel carregar o estoque teorico. Tente novamente.');
      setTheoreticalRows([]);
    } finally {
      setLoadingTheoretical(false);
    }
  }, [user?.tenantId, selectedDates]);

  const carregarSessoes = useCallback(async () => {
    if (!user?.tenantId || selectedDates.length === 0) {
      setSessions([]);
      return;
    }
    try {
      const from = datesOrdenadas[0];
      const to = datesOrdenadas[datesOrdenadas.length - 1];
      const result = await invokeWithAuth<{ data: InventorySessionLite[] }>('stock-write', {
        body: { action: 'get_inventory_sessions_range', tenant_id: user.tenantId, from, to },
      });
      if (result.error) throw result.error;
      setSessions(result.data?.data ?? []);
    } catch (e) {
      console.error('[EstoqueTeoricoTab] erro ao carregar sessoes de inventario:', e);
      setSessions([]);
    }
  }, [user?.tenantId, selectedDates, datesOrdenadas]);

  useEffect(() => { carregarTeorico(); }, [carregarTeorico]);
  useEffect(() => { carregarSessoes(); }, [carregarSessoes]);

  // Mapa: data (YYYY-MM-DD) -> sessao cujo created_at cai EXATAMENTE naquele
  // dia (fuso America/Sao_Paulo). So mostra contagem real em dia exato — se
  // duas sessoes caissem no mesmo dia (incomum), fica a ultima.
  const sessaoPorData = useMemo(() => {
    const map = new Map<string, InventorySessionLite>();
    for (const s of sessions) {
      map.set(toLocalISODate(new Date(s.created_at)), s);
    }
    return map;
  }, [sessions]);

  // Mapa: data -> insumo_id -> contagem real. Sessoes antigas gravaram os
  // itens com chaves camelCase (insumoId/qtdContada), a RPC atual grava
  // mixed-case (ingredient_id/qtd_contada) — aceita as duas, mesmo padrao
  // ja usado em EstoqueContext.dbToInventarioSession.
  const contagemPorDataEInsumo = useMemo(() => {
    const map = new Map<string, Map<string, RealCount>>();
    for (const [date, sessao] of sessaoPorData) {
      const porInsumo = new Map<string, RealCount>();
      for (const item of sessao.items ?? []) {
        const ingId = String(item.ingredient_id ?? item.insumoId ?? '');
        if (!ingId) continue;
        porInsumo.set(ingId, {
          qtdContada: Number(item.qtd_contada ?? item.qtdContada ?? 0),
          diferenca: Number(item.diferenca ?? 0),
        });
      }
      map.set(date, porInsumo);
    }
    return map;
  }, [sessaoPorData]);

  // Ordenacao ao clicar no cabecalho de uma coluna de data
  const [sortDate, setSortDate] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (iso: string) => {
    if (sortDate === iso) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortDate(iso);
      setSortDir('asc');
    }
  };

  // Agrupa as celulas teoricas por insumo — uma linha por insumo, uma coluna por data
  const linhas = useMemo(() => {
    const porInsumo = new Map<string, {
      id: string; nome: string; unidade: string; categoria: string | null;
      celulas: Map<string, { valor: number | null; unreliable: boolean }>;
    }>();
    for (const cell of theoreticalRows) {
      let row = porInsumo.get(cell.ingredient_id);
      if (!row) {
        row = { id: cell.ingredient_id, nome: cell.ingredient_name, unidade: cell.unit, categoria: cell.category, celulas: new Map() };
        porInsumo.set(cell.ingredient_id, row);
      }
      row.celulas.set(cell.date, { valor: cell.theoretical_stock, unreliable: cell.unreliable });
    }
    let arr = Array.from(porInsumo.values());
    if (busca.trim()) {
      const q = busca.toLowerCase();
      arr = arr.filter((r) => r.nome.toLowerCase().includes(q));
    }
    return arr;
  }, [theoreticalRows, busca]);

  // Setoriza por categoria (ordem alfabetica, "Sem categoria" por ultimo). Dentro
  // de cada categoria: ordena pela coluna de data clicada, ou por nome por padrao.
  const grupos = useMemo(() => {
    const porCategoria = new Map<string, typeof linhas>();
    for (const row of linhas) {
      const cat = row.categoria?.trim() || 'Sem categoria';
      const arr = porCategoria.get(cat) ?? [];
      arr.push(row);
      porCategoria.set(cat, arr);
    }
    const ordenarGrupo = (arr: typeof linhas) => {
      const copia = [...arr];
      if (sortDate) {
        copia.sort((a, b) => {
          const va = a.celulas.get(sortDate)?.valor;
          const vb = b.celulas.get(sortDate)?.valor;
          if (va == null && vb == null) return 0;
          if (va == null) return 1; // sem valor sempre vai pro fim
          if (vb == null) return -1;
          return sortDir === 'asc' ? va - vb : vb - va;
        });
      } else {
        copia.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      }
      return copia;
    };
    return Array.from(porCategoria.entries())
      .sort(([a], [b]) => {
        if (a === 'Sem categoria') return 1;
        if (b === 'Sem categoria') return -1;
        return a.localeCompare(b, 'pt-BR');
      })
      .map(([categoria, itens]) => ({ categoria, itens: ordenarGrupo(itens) }));
  }, [linhas, sortDate, sortDir]);

  const adicionarData = (iso: string) => {
    setSelectedDates((prev) => (prev.includes(iso) ? prev : [...prev, iso]));
  };

  const removerData = (iso: string) => {
    setSelectedDates((prev) => prev.filter((d) => d !== iso));
    setShowRealCount((prev) => {
      const next = { ...prev };
      delete next[iso];
      return next;
    });
  };

  const toggleRealCount = (iso: string) => {
    setShowRealCount((prev) => ({ ...prev, [iso]: !prev[iso] }));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <h3 className="text-sm font-bold text-zinc-900">Estoque teórico por data</h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              O que a teoria previa pro final de cada data — vendas, compras e produção, sem
              contar nenhuma correção de contagem feita naquele mesmo dia. Ative o ícone de
              lista numa coluna pra comparar com o que foi contado de verdade.
            </p>
          </div>
          <div className="relative">
            <button
              onClick={() => setCalendarOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus size={13} />
              Adicionar data
            </button>
            {calendarOpen && (
              <CalendarioSeletorData
                value={null}
                onSelect={adicionarData}
                onClose={() => setCalendarOpen(false)}
              />
            )}
          </div>
        </div>

        {selectedDates.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {datesOrdenadas.map((iso) => (
              <span
                key={iso}
                className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-zinc-100 rounded-full text-[11px] font-medium text-zinc-600"
              >
                <Calendar size={11} />
                {formatDateShort(iso)}
                <button
                  onClick={() => removerData(iso)}
                  className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-zinc-300 text-zinc-500 cursor-pointer"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {selectedDates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-dashed border-zinc-200 rounded-xl">
          <Calendar className="text-zinc-300 mb-3" size={32} />
          <p className="text-sm font-semibold text-zinc-500">Nenhuma data selecionada</p>
          <p className="text-xs text-zinc-400 mt-1">
            Clique em "Adicionar data" pra ver o estoque teórico de todos os insumos naquele dia.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-zinc-100">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar insumo..."
              className="w-full max-w-xs text-xs border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border-b border-red-100 text-xs text-red-600">{error}</div>
          )}

          {loadingTheoretical ? (
            <div className="flex items-center justify-center py-16 text-zinc-400">
              <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-3" />
              <span className="text-sm">Calculando...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50">
                    <th className="text-left font-semibold text-zinc-500 px-3 py-2.5 border-b border-zinc-100 sticky left-0 bg-zinc-50 whitespace-nowrap">
                      Insumo
                    </th>
                    {datesOrdenadas.map((iso) => {
                      const temSessao = sessaoPorData.has(iso);
                      const ordenandoPorEssa = sortDate === iso;
                      return (
                        <th key={iso} className="text-center font-semibold text-zinc-500 px-3 py-2.5 border-b border-zinc-100 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => toggleSort(iso)}
                              title="Ordenar por esta data"
                              className={`flex items-center gap-1 cursor-pointer hover:text-amber-600 ${ordenandoPorEssa ? 'text-amber-600' : ''}`}
                            >
                              {formatDateShort(iso)}
                              <i className={`ri-arrow-${ordenandoPorEssa && sortDir === 'desc' ? 'down' : 'up'}-line text-[10px] ${ordenandoPorEssa ? 'opacity-100' : 'opacity-0'}`} />
                            </button>
                            {temSessao && (
                              <button
                                onClick={() => toggleRealCount(iso)}
                                title={showRealCount[iso] ? 'Ocultar contagem real deste dia' : 'Mostrar contagem real deste dia'}
                                className={`w-5 h-5 flex items-center justify-center rounded-full cursor-pointer transition-colors flex-shrink-0 ${
                                  showRealCount[iso]
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200'
                                }`}
                              >
                                <i className="ri-list-check text-[11px]" />
                              </button>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                {linhas.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={datesOrdenadas.length + 1} className="text-center py-10 text-zinc-400">
                        Nenhum insumo encontrado
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  grupos.map((grupo) => (
                    <tbody key={grupo.categoria} className="divide-y divide-zinc-50">
                      <tr>
                        <td
                          colSpan={datesOrdenadas.length + 1}
                          className="px-3 py-1.5 bg-amber-50/60 text-[10px] font-bold text-amber-700 uppercase tracking-wide sticky left-0"
                        >
                          {grupo.categoria}
                        </td>
                      </tr>
                      {grupo.itens.map((row) => (
                        <tr key={row.id} className="hover:bg-zinc-50/50">
                          <td className="px-3 py-2.5 font-medium text-zinc-700 sticky left-0 bg-white whitespace-nowrap">
                            {row.nome}
                            <span className="text-zinc-400 font-normal ml-1">({row.unidade})</span>
                          </td>
                          {datesOrdenadas.map((iso) => {
                            const cel = row.celulas.get(iso);
                            const real = showRealCount[iso] ? contagemPorDataEInsumo.get(iso)?.get(row.id) : undefined;
                            return (
                              <td key={iso} className="px-3 py-2.5 text-center whitespace-nowrap">
                                {cel?.unreliable ? (
                                  <span className="text-zinc-300" title="Sinal de alguma movimentacao historica desconhecido — nao da pra confiar neste numero">
                                    —
                                  </span>
                                ) : (
                                  <span className="font-semibold text-zinc-700">
                                    {cel?.valor != null ? `${formatQty(cel.valor)} ${row.unidade}` : '—'}
                                  </span>
                                )}
                                {real && (
                                  <div className={`text-[10px] mt-0.5 ${real.diferenca === 0 ? 'text-zinc-400' : real.diferenca < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                    Real: {formatQty(real.qtdContada)} {row.unidade}
                                    {real.diferenca !== 0 && ` (${real.diferenca > 0 ? '+' : ''}${formatQty(real.diferenca)})`}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  ))
                )}
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
