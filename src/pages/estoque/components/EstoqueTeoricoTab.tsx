import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque, type InventarioSession } from '@/contexts/EstoqueContext';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { dateKeyBrasilia, somarDias } from '@/lib/dateUtils';
import { dataBRparaYmd, fmtQtdTela as fq, maisMexeram, montarLinhasTeorico, type LinhaTeorica } from '@/lib/contagemResumo';
import { useEstoqueTelaOpcional } from '../EstoqueTela';
import CalendarioSeletorData from './CalendarioSeletorData';
import { Chips, Etiqueta, Nota, Pagina, Vazio, btn, semAcento } from './ui/EstoqueUi';

// Estoque teórico (layout novo, 2026-10-04). Abre já comparando a última contagem com hoje: por insumo, o que
// foi contado, o que entrou e saiu depois e o estoque de hoje. "Outra data" mantém a consulta por dia
// (get_theoretical_stock), agora com calendário que não aceita dia futuro e contagem real com nome.

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** Computador (≥ 768 px) ou não: define quantas datas cabem na comparação. */
function useTelaGrande(): boolean {
  const [grande, setGrande] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const aoMudar = () => setGrande(mq.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);
  return grande;
}

function CampoBusca({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full md:max-w-xs">
      <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none" />
      <input
        type="search"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar insumo..."
        className="w-full h-10 rounded-xl border border-zinc-200 bg-white pl-9 pr-3 text-base md:text-sm focus:outline-none focus:border-amber-400"
      />
    </div>
  );
}

function Carregando({ texto }: { texto: string }) {
  return (
    <div className="flex items-center justify-center py-14 text-zinc-400 bg-white border border-zinc-200 rounded-2xl">
      <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-3" />
      <span className="text-sm">{texto}</span>
    </div>
  );
}

function ErroCaixa({ texto, onTentar }: { texto: string; onTentar: () => void }) {
  return (
    <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 flex items-center gap-3 flex-wrap">
      <i className="ri-error-warning-line text-base" />
      <span className="flex-1 min-w-0">{texto}</span>
      <button onClick={onTentar} className={btn('perigo', 'sm')}>Tentar de novo</button>
    </div>
  );
}

type Modo = 'contagem' | 'data';

export default function EstoqueTeoricoTab() {
  const { inventarioSessions, loading } = useEstoque();
  const ultima = inventarioSessions[0] ?? null; // a lista vem da mais nova para a mais antiga
  const [modo, setModo] = useState<Modo>('contagem');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [busca, setBusca] = useState('');

  const rotuloContagem = ultima ? `Contagem ${ultima.data.slice(0, 5)} × hoje` : 'Contagem × hoje';

  return (
    <Pagina>
      <div className="space-y-3">
        <p className="text-[13px] text-zinc-600 leading-relaxed">
          {modo === 'contagem'
            ? <>O que o sistema acha que tem hoje: <b className="text-zinc-900">o que foi contado, mais o que entrou, menos o que saiu</b>. Compare com a prateleira para achar o que some.</>
            : <>O que a teoria previa para o fim de cada data: vendas, compras e produção, sem contar correção de contagem feita naquele mesmo dia.</>}
        </p>
        <Chips<Modo>
          opcoes={[
            { id: 'contagem', rotulo: rotuloContagem },
            { id: 'data', rotulo: 'Outra data' },
          ]}
          valor={modo}
          onChange={setModo}
        />
      </div>

      {modo === 'contagem' ? (
        ultima ? (
          <ContagemContraHoje ultima={ultima} busca={busca} setBusca={setBusca} />
        ) : loading ? (
          <Carregando texto="Carregando as contagens..." />
        ) : (
          <Vazio icone="ri-scales-3-line" titulo="Ainda não tem contagem para comparar"
            acao={<button onClick={() => setModo('data')} className={btn('out', 'sm')}>Ver por data</button>}>
            Depois da primeira contagem, esta tela mostra o que foi contado, o que entrou, o que saiu e o estoque de hoje. Enquanto isso, “Outra data” mostra o estoque teórico de qualquer dia.
          </Vazio>
        )
      ) : (
        <OutraData selectedDates={selectedDates} setSelectedDates={setSelectedDates} busca={busca} setBusca={setBusca} />
      )}
    </Pagina>
  );
}

// ─────────────────────────────── Contagem × hoje ───────────────────────────────
type FiltroContagem = 'mexeram' | 'negativos' | 'todos';
const LIMITE_MEXERAM = 25;

function ContagemContraHoje({ ultima, busca, setBusca }: { ultima: InventarioSession; busca: string; setBusca: (v: string) => void }) {
  const { user } = useAuth();
  const { insumos } = useEstoque();
  const tela = useEstoqueTelaOpcional();
  const tenantId = user?.tenantId ?? '';
  const [filtro, setFiltro] = useState<FiltroContagem>('mexeram');
  const [movs, setMovs] = useState<Map<string, { entrou: number; saiu: number }> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const horarios = useRef(new Map<string, string>()); // id da contagem → horário exato dela
  const pedido = useRef(0);

  // Entrou/saiu depois do horário EXATO da contagem (a lista de contagens só traz data e minuto, e o ajuste
  // da própria contagem tem esse horário: com o minuto arredondado ele entraria na conta).
  const carregar = useCallback(async (inicial: boolean) => {
    if (!tenantId) return;
    const meu = ++pedido.current;
    if (inicial) { setCarregando(true); setErro(null); }
    try {
      let quando = horarios.current.get(ultima.id);
      if (!quando) {
        const dia = dataBRparaYmd(ultima.data);
        if (!dia) throw new Error('Data da contagem ilegível');
        const r = await invokeWithAuth<{ data: Array<{ id: string; created_at: string }> }>('stock-write', {
          body: { action: 'get_inventory_sessions_range', tenant_id: tenantId, from: somarDias(dia, -1), to: somarDias(dia, 1) },
        });
        if (r.error) throw r.error;
        quando = r.data?.data?.find((s) => s.id === ultima.id)?.created_at;
        if (!quando) throw new Error('Não achei o horário da contagem');
        horarios.current.set(ultima.id, quando);
      }
      const { data, error } = await supabase.rpc('fn_estoque_entrou_saiu', { p_tenant_id: tenantId, p_desde: quando });
      if (error) throw error;
      if (meu !== pedido.current) return;
      const m = new Map<string, { entrou: number; saiu: number }>();
      for (const r of (data ?? []) as Array<{ ingredient_id: string; entrou: number | string; saiu: number | string }>) {
        m.set(String(r.ingredient_id), { entrou: Number(r.entrou) || 0, saiu: Number(r.saiu) || 0 });
      }
      setMovs(m);
      setErro(null);
    } catch (e) {
      console.error('[EstoqueTeoricoTab] erro ao calcular entrou/saiu:', e);
      // Só a primeira carga mostra erro; uma atualização silenciosa que falha mantém o que já estava na tela.
      if (meu === pedido.current && inicial) { setMovs(null); setErro('Não consegui calcular o que entrou e saiu depois da contagem.'); }
    } finally {
      if (meu === pedido.current && inicial) setCarregando(false);
    }
  }, [tenantId, ultima.id, ultima.data]);

  useEffect(() => { void carregar(true); }, [carregar]);

  // Venda ou entrada nova muda o "hoje": refaz entrou/saiu sem piscar, no máximo a cada 60 s (a conta varre
  // tudo desde a contagem; a cada venda seria carga demais no banco).
  const ultimaLeitura = useRef(0);
  useEffect(() => {
    if (!movs) return;
    const espera = Math.max(2000, 60000 - (Date.now() - ultimaLeitura.current));
    const t = setTimeout(() => { ultimaLeitura.current = Date.now(); void carregar(false); }, espera);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumos]);

  const contadoPorId = useMemo(
    () => new Map(ultima.itens.map((i) => [i.insumoId, i.qtdContada] as const)),
    [ultima],
  );
  const linhas = useMemo(
    () => montarLinhasTeorico(
      insumos.map((i) => ({
        id: i.id, nome: i.nome, unidade: i.unidade, categoria: i.categoria, precoUnitario: i.precoUnitario,
        estoqueAtual: i.estoqueAtual, acompanha: i.rastrearEstoque, contaInventario: i.contaInventario,
        marcadoEsgotado: i.esgotado,
      })),
      contadoPorId,
      movs ?? new Map(),
    ),
    [insumos, contadoPorId, movs],
  );

  const mexeram = useMemo(() => maisMexeram(linhas), [linhas]);
  const negativos = useMemo(() => linhas.filter((l) => l.conferir).sort((a, b) => a.hoje - b.hoje), [linhas]);
  const todos = useMemo(() => [...linhas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [linhas]);

  // Buscando, procura entre todos os insumos (o filtro escolhido não esconde o que a pessoa quer achar).
  const q = semAcento(busca);
  const base = q ? todos : filtro === 'mexeram' ? mexeram : filtro === 'negativos' ? negativos : todos;
  const achados = q ? base.filter((l) => semAcento(l.nome).includes(q)) : base;
  const cortou = !q && filtro === 'mexeram' && achados.length > LIMITE_MEXERAM;
  const visiveis = cortou ? achados.slice(0, LIMITE_MEXERAM) : achados;

  const diaContagem = ultima.data.slice(0, 5);
  const abrir = (id: string) => tela?.abrirFicha(id);

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Contagem #{ultima.numero} · {ultima.data} às {ultima.hora} · {ultima.operador} · {ultima.itensContados} {plural(ultima.itensContados, 'insumo contado', 'insumos contados')}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-full md:w-auto md:mr-auto min-w-0">
          <Chips<FiltroContagem>
            opcoes={[
              { id: 'mexeram', rotulo: 'Os que mais mexeram', n: mexeram.length },
              { id: 'negativos', rotulo: 'Negativos', n: negativos.length, tom: negativos.length > 0 ? 'red' : undefined },
              { id: 'todos', rotulo: 'Todos', n: linhas.length },
            ]}
            valor={filtro}
            onChange={setFiltro}
          />
        </div>
        <CampoBusca valor={busca} onChange={setBusca} />
      </div>

      {carregando ? (
        <Carregando texto="Calculando o que entrou e saiu..." />
      ) : erro ? (
        <ErroCaixa texto={erro} onTentar={() => void carregar(true)} />
      ) : visiveis.length === 0 ? (
        <Vazio icone="ri-search-line" titulo={q ? 'Nenhum insumo com esse nome.' : filtro === 'negativos' ? 'Nenhum insumo negativo.' : 'Nada mexeu depois da contagem.'}>
          {!q && filtro === 'negativos' && 'Todos os números de hoje são possíveis.'}
        </Vazio>
      ) : (
        <>
          {/* Celular: um cartão por insumo */}
          <ul className="md:hidden bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100 overflow-hidden">
            {visiveis.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => abrir(l.id)} disabled={!tela}
                  className="w-full text-left flex items-center gap-3 px-3.5 py-3 enabled:cursor-pointer enabled:active:bg-zinc-50">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-bold text-zinc-900 truncate">{l.nome}</span>
                    <span className="block text-[11.5px] text-zinc-500 mt-0.5 leading-snug">
                      contado {l.contado === null ? '—' : fq(l.contado, l.unidade)}
                      {' · '}entrou {l.entrou > 0 ? `+${fq(l.entrou, l.unidade)}` : '0'}
                      {' · '}saiu {l.saiu > 0 ? `-${fq(l.saiu, l.unidade)}` : '0'}
                    </span>
                  </span>
                  <span className="flex-none text-right">
                    <span className={`block text-sm font-extrabold tabular-nums ${l.hoje < 0 ? 'text-red-600' : 'text-zinc-900'}`}>{fq(l.hoje, l.unidade)}</span>
                    {l.conferir ? <Etiqueta tom="red">conferir</Etiqueta> : <span className="block text-[10.5px] text-zinc-400">hoje</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Computador: tabela */}
          <div className="hidden md:block bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-zinc-50/60 border-b border-zinc-200">
                <tr>
                  <th className="pl-5 pr-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Insumo</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400 whitespace-nowrap">Contado {diaContagem}</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Entrou</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Saiu</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Hoje</th>
                  <th className="pr-5 py-2.5 w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visiveis.map((l: LinhaTeorica) => (
                  <tr key={l.id} onClick={() => abrir(l.id)} className={`hover:bg-amber-50/40 ${tela ? 'cursor-pointer' : ''}`}>
                    <td className="pl-5 pr-4 py-2.5 font-semibold text-zinc-900">{l.nome}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-zinc-600">{l.contado === null ? <span className="text-zinc-300">—</span> : fq(l.contado, l.unidade)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${l.entrou > 0 ? 'text-emerald-700 font-semibold' : 'text-zinc-400'}`}>{l.entrou > 0 ? `+${fq(l.entrou, l.unidade)}` : '0'}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${l.saiu > 0 ? 'text-zinc-700' : 'text-zinc-400'}`}>{l.saiu > 0 ? `-${fq(l.saiu, l.unidade)}` : '0'}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-extrabold ${l.hoje < 0 ? 'text-red-600' : 'text-zinc-900'}`}>{fq(l.hoje, l.unidade)}</td>
                    <td className="pr-5 py-2.5 text-right">{l.conferir && <Etiqueta tom="red">conferir</Etiqueta>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cortou && (
            <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-zinc-500 px-1">
              <span>Mostrando os {LIMITE_MEXERAM} que mais mexeram, de {achados.length}.</span>
              <button onClick={() => setFiltro('todos')} className={btn('ghost', 'sm')}>Ver todos os {linhas.length}</button>
            </div>
          )}
        </>
      )}

      <Nota>
        Entrou: compras, produção e acertos para mais. Saiu: vendas, perdas, saídas e acertos para menos. Só contam os movimentos depois do horário da contagem.
        “Conferir” marca o que está negativo: estoque de prateleira nunca é menor que zero, então vale contar de novo.
      </Nota>
    </div>
  );
}

// ───────────────────────────────── Outra data ─────────────────────────────────
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

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function OutraData({ selectedDates, setSelectedDates, busca, setBusca }: {
  selectedDates: string[];
  setSelectedDates: React.Dispatch<React.SetStateAction<string[]>>;
  busca: string;
  setBusca: (v: string) => void;
}) {
  const { user } = useAuth();
  const telaGrande = useTelaGrande();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [theoreticalRows, setTheoreticalRows] = useState<TheoreticalCell[]>([]);
  const [loadingTheoretical, setLoadingTheoretical] = useState(false);
  const [sessions, setSessions] = useState<InventorySessionLite[]>([]);
  const [showRealCount, setShowRealCount] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const datesOrdenadas = useMemo(() => [...selectedDates].sort(), [selectedDates]);
  // No celular a comparação cabe em 2 datas; no computador, quantas quiser.
  const cheio = !telaGrande && selectedDates.length >= 2;

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
      setError('Não foi possível carregar o estoque teórico. Tente de novo.');
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
      map.set(dateKeyBrasilia(s.created_at), s);
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

  // Ordenacao ao clicar no cabecalho de uma coluna de data (ou no seletor, no celular)
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
      const q = semAcento(busca);
      arr = arr.filter((r) => semAcento(r.nome).includes(q));
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
    setSelectedDates((prev) => (prev.includes(iso) || iso > dateKeyBrasilia(new Date()) ? prev : [...prev, iso]));
  };

  const removerData = (iso: string) => {
    setSelectedDates((prev) => prev.filter((d) => d !== iso));
    setShowRealCount((prev) => {
      const next = { ...prev };
      delete next[iso];
      return next;
    });
    if (sortDate === iso) setSortDate(null);
  };

  const toggleRealCount = (iso: string) => {
    setShowRealCount((prev) => ({ ...prev, [iso]: !prev[iso] }));
  };

  const diasComContagem = datesOrdenadas.filter((iso) => sessaoPorData.has(iso));

  /** Valor da célula (data × insumo) já com unidade legível. */
  const textoCelula = (cel: { valor: number | null; unreliable: boolean } | undefined, unidade: string, curto: boolean) => {
    if (cel?.unreliable) return curto ? '—' : 'sem número confiável';
    return cel?.valor != null ? fq(cel.valor, unidade) : '—';
  };
  const textoReal = (real: RealCount, unidade: string) =>
    `Contado: ${fq(real.qtdContada, unidade)}${real.diferenca !== 0 ? ` (${real.diferenca > 0 ? '+' : ''}${fq(real.diferenca, unidade)})` : ''}`;
  const corReal = (real: RealCount) => (real.diferenca === 0 ? 'text-zinc-400' : real.diferenca < 0 ? 'text-red-500' : 'text-emerald-600');

  return (
    <div className="space-y-3">
      {/* Datas escolhidas */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <button
            onClick={() => setCalendarOpen((v) => !v)}
            disabled={cheio}
            title={cheio ? 'No celular dá para comparar 2 datas. Tire uma para pôr outra.' : undefined}
            className={btn('p', 'sm')}
          >
            <i className="ri-add-line" />
            Adicionar data
          </button>
          {calendarOpen && (
            <CalendarioSeletorData
              value={null}
              marcados={selectedDates}
              alinhar="left"
              onSelect={adicionarData}
              onClose={() => setCalendarOpen(false)}
            />
          )}
        </div>
        {datesOrdenadas.map((iso) => (
          <span key={iso} className="inline-flex items-center gap-1 h-8 pl-3 pr-1 bg-zinc-100 rounded-full text-[12.5px] font-bold text-zinc-700">
            <i className="ri-calendar-line text-zinc-400" />
            {formatDateShort(iso)}
            <button
              onClick={() => removerData(iso)}
              aria-label={`Tirar ${formatDateShort(iso)}`}
              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-zinc-300 text-zinc-500 cursor-pointer"
            >
              <i className="ri-close-line" />
            </button>
          </span>
        ))}
      </div>
      {cheio && <p className="text-[11.5px] text-zinc-400">No celular dá para comparar 2 datas; no computador, quantas quiser.</p>}

      {selectedDates.length === 0 ? (
        <Vazio icone="ri-calendar-line" titulo="Nenhuma data escolhida">
          Toque em “Adicionar data” para ver o estoque teórico de todos os insumos no fim daquele dia. Dias que tiveram contagem têm um pontinho verde no calendário.
        </Vazio>
      ) : (
        <>
          {/* Contagem real: um botão com nome para cada data que teve contagem */}
          {diasComContagem.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              {diasComContagem.map((iso) => (
                <button
                  key={iso}
                  onClick={() => toggleRealCount(iso)}
                  aria-pressed={!!showRealCount[iso]}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12.5px] font-bold cursor-pointer ${
                    showRealCount[iso] ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'
                  }`}
                >
                  <i className={showRealCount[iso] ? 'ri-checkbox-circle-fill' : 'ri-list-check'} />
                  {showRealCount[iso] ? `Mostrando o contado de ${formatDateShort(iso)}` : `Mostrar o contado de ${formatDateShort(iso)}`}
                </button>
              ))}
            </div>
          ) : (
            !loadingTheoretical && <p className="text-[11.5px] text-zinc-400">Nenhuma das datas teve contagem. Os dias com contagem têm um pontinho verde no calendário.</p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <CampoBusca valor={busca} onChange={setBusca} />
            {/* Ordem: no computador clica-se no cabeçalho da data; no celular, aqui */}
            <label className="md:hidden flex items-center gap-2 text-xs text-zinc-500">
              Ordenar por
              <select
                value={sortDate ? `${sortDate}|${sortDir}` : 'nome'}
                onChange={(e) => {
                  if (e.target.value === 'nome') { setSortDate(null); return; }
                  const [iso, dir] = e.target.value.split('|');
                  setSortDate(iso);
                  setSortDir(dir === 'desc' ? 'desc' : 'asc');
                }}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-2 text-base text-zinc-700"
              >
                <option value="nome">Nome (A–Z)</option>
                {datesOrdenadas.flatMap((iso) => [
                  <option key={`${iso}|asc`} value={`${iso}|asc`}>{formatDateShort(iso)}: menor primeiro</option>,
                  <option key={`${iso}|desc`} value={`${iso}|desc`}>{formatDateShort(iso)}: maior primeiro</option>,
                ])}
              </select>
            </label>
          </div>

          {error && <ErroCaixa texto={error} onTentar={carregarTeorico} />}

          {loadingTheoretical ? (
            <Carregando texto="Calculando..." />
          ) : !error && linhas.length === 0 ? (
            <Vazio icone="ri-search-line" titulo="Nenhum insumo encontrado" />
          ) : !error && (
            <>
              {/* Celular: cartões, uma linha por data */}
              <div className="md:hidden space-y-4">
                {grupos.map((grupo) => (
                  <section key={grupo.categoria}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500 px-1 mb-1.5">{grupo.categoria}</p>
                    <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100 overflow-hidden">
                      {grupo.itens.map((row) => (
                        <div key={row.id} className="px-3.5 py-3">
                          <p className="text-[13.5px] font-bold text-zinc-900">{row.nome}</p>
                          <div className="mt-1.5 space-y-1.5">
                            {datesOrdenadas.map((iso) => {
                              const cel = row.celulas.get(iso);
                              const real = showRealCount[iso] ? contagemPorDataEInsumo.get(iso)?.get(row.id) : undefined;
                              return (
                                <div key={iso} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                                  <span className="text-zinc-500 flex-none">{formatDateShort(iso)}</span>
                                  <span className="text-right min-w-0">
                                    <span className={`font-extrabold tabular-nums ${cel?.unreliable ? 'text-zinc-400 font-semibold' : 'text-zinc-900'}`}>{textoCelula(cel, row.unidade, false)}</span>
                                    {real && <span className={`block text-[11px] ${corReal(real)}`}>{textoReal(real, row.unidade)}</span>}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {/* Computador: tabela, uma coluna por data */}
              <div className="hidden md:block bg-white rounded-2xl border border-zinc-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-zinc-50/60">
                      <tr className="border-b border-zinc-200">
                        <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 pl-5 pr-4 py-2.5 sticky left-0 bg-zinc-50 whitespace-nowrap">
                          Insumo
                        </th>
                        {datesOrdenadas.map((iso) => {
                          const ordenandoPorEssa = sortDate === iso;
                          return (
                            <th key={iso} className="text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400 px-4 py-2.5 whitespace-nowrap">
                              <button
                                onClick={() => toggleSort(iso)}
                                title="Ordenar por esta data"
                                className={`inline-flex items-center gap-1 cursor-pointer hover:text-amber-600 ${ordenandoPorEssa ? 'text-amber-600' : ''}`}
                              >
                                {formatDateShort(iso)}
                                <i className={`ri-arrow-${ordenandoPorEssa && sortDir === 'desc' ? 'down' : 'up'}-line text-[10px] ${ordenandoPorEssa ? 'opacity-100' : 'opacity-0'}`} />
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    {grupos.map((grupo) => (
                      <tbody key={grupo.categoria} className="divide-y divide-zinc-100/80">
                        <tr>
                          <td
                            colSpan={datesOrdenadas.length + 1}
                            className="pl-5 pr-4 pt-4 pb-2 text-[11px] font-bold text-zinc-500 uppercase tracking-wider sticky left-0"
                          >
                            {grupo.categoria}
                          </td>
                        </tr>
                        {grupo.itens.map((row) => (
                          <tr key={row.id} className="hover:bg-zinc-50 group">
                            <td className="pl-5 pr-4 py-2.5 font-medium text-zinc-700 sticky left-0 bg-white group-hover:bg-zinc-50 whitespace-nowrap">
                              {row.nome}
                            </td>
                            {datesOrdenadas.map((iso) => {
                              const cel = row.celulas.get(iso);
                              const real = showRealCount[iso] ? contagemPorDataEInsumo.get(iso)?.get(row.id) : undefined;
                              return (
                                <td key={iso} className="px-4 py-2.5 text-center tabular-nums whitespace-nowrap">
                                  {cel?.unreliable ? (
                                    <span className="text-zinc-300" title="Tem movimentação antiga de sinal desconhecido: não dá para confiar neste número">
                                      —
                                    </span>
                                  ) : (
                                    <span className="font-semibold text-zinc-700">{textoCelula(cel, row.unidade, true)}</span>
                                  )}
                                  {real && <div className={`text-[10px] mt-0.5 ${corReal(real)}`}>{textoReal(real, row.unidade)}</div>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              </div>
              <Nota>“—” quer dizer que não dá para calcular aquele dia: o insumo tem movimentação antiga de sinal desconhecido.</Nota>
            </>
          )}
        </>
      )}
    </div>
  );
}
