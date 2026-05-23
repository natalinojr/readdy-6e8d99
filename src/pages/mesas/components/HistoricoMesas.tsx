import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate, formatDateTime } from '@/lib/formatters';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SessaoHistorico {
  id: string;
  tableId: string;
  mesaNumero: number;
  mesaArea: string;
  abertaEm: string;
  fechadaEm: string | null;
  duracaoMin: number | null;
  totalPedidos: number;
  totalReceita: number;
  totalPessoas: number;
  responsavelNome: string | null;
  customerName: string | null;
  pedidos: PedidoSessao[];
}

interface PedidoSessao {
  id: string;
  numero: string;
  total: number;
  status: string;
  origem: string;
  criadoEm: string;
  clienteNome: string | null;
}

type Periodo = 'hoje' | 'ontem' | '7dias' | '30dias' | 'personalizado';

interface FiltroHistorico {
  periodo: Periodo;
  dataInicio: string;
  dataFim: string;
  mesaNumero: string;
  busca: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDuration(min: number | null) {
  if (min === null || min < 0) return '—';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m > 0 ? `${m}m` : ''}`;
}

function getPeriodoDates(periodo: Periodo, dataInicio: string, dataFim: string): { inicio: Date; fim: Date } {
  const hoje = new Date();
  hoje.setHours(23, 59, 59, 999);
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);

  switch (periodo) {
    case 'hoje':
      return { inicio: inicioHoje, fim: hoje };
    case 'ontem': {
      const ontem = new Date(inicioHoje);
      ontem.setDate(ontem.getDate() - 1);
      const fimOntem = new Date(ontem);
      fimOntem.setHours(23, 59, 59, 999);
      return { inicio: ontem, fim: fimOntem };
    }
    case '7dias': {
      const inicio7 = new Date(inicioHoje);
      inicio7.setDate(inicio7.getDate() - 6);
      return { inicio: inicio7, fim: hoje };
    }
    case '30dias': {
      const inicio30 = new Date(inicioHoje);
      inicio30.setDate(inicio30.getDate() - 29);
      return { inicio: inicio30, fim: hoje };
    }
    case 'personalizado':
      return {
        inicio: dataInicio ? new Date(dataInicio + 'T00:00:00') : inicioHoje,
        fim: dataFim ? new Date(dataFim + 'T23:59:59') : hoje,
      };
    default:
      return { inicio: inicioHoje, fim: hoje };
  }
}

const ORIGEM_LABEL: Record<string, string> = {
  cashier: 'Caixa',
  waiter: 'Garçom',
  table: 'Mesa',
  self_service: 'Kiosk',
};

// ── Hook de dados ──────────────────────────────────────────────────────────────

function useHistoricoMesas(filtro: FiltroHistorico) {
  const { user } = useAuth();
  const [sessoes, setSessoes] = useState<SessaoHistorico[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const { inicio, fim } = getPeriodoDates(filtro.periodo, filtro.dataInicio, filtro.dataFim);

      // 1. Buscar sessões fechadas no período
      let query = supabase
        .from('table_sessions')
        .select('id, table_id, opened_at, closed_at, responsible_customer_id, status, customer_name')
        .eq('tenant_id', user.tenantId)
        .gte('opened_at', inicio.toISOString())
        .lte('opened_at', fim.toISOString())
        .order('opened_at', { ascending: false })
        .limit(200);

      const { data: sessionsData, error: sessErr } = await query;
      if (sessErr) throw sessErr;
      if (!sessionsData || sessionsData.length === 0) {
        setSessoes([]);
        return;
      }

      // 2. Buscar dados das mesas
      const tableIds = [...new Set(sessionsData.map((s) => s.table_id))];
      const { data: tablesData } = await supabase
        .from('tables')
        .select('id, number, area, capacity')
        .in('id', tableIds)
        .eq('tenant_id', user.tenantId);

      const tablesMap: Record<string, { number: number; area: string; capacity: number }> = {};
      (tablesData ?? []).forEach((t) => {
        tablesMap[t.id] = { number: t.number, area: t.area ?? 'Salão', capacity: t.capacity ?? 4 };
      });

      // Filtro por mesa número
      const sessionIds = sessionsData
        .filter((s) => {
          if (!filtro.mesaNumero) return true;
          const mesa = tablesMap[s.table_id];
          return mesa && String(mesa.number) === filtro.mesaNumero;
        })
        .map((s) => s.id);

      if (sessionIds.length === 0) {
        setSessoes([]);
        return;
      }

      // 3. Buscar pedidos das sessões
      const { data: ordersData } = await supabase
        .from('orders')
        .select('id, number, table_session_id, total_amount, status, origin_type, created_at, destination_name, customer_id')
        .in('table_session_id', sessionIds)
        .eq('tenant_id', user.tenantId);

      // 4. Buscar clientes responsáveis
      const responsavelIds = sessionsData
        .map((s) => s.responsible_customer_id)
        .filter(Boolean) as string[];

      let responsaveisMap: Record<string, string> = {};
      if (responsavelIds.length > 0) {
        const { data: custData } = await supabase
          .from('customers')
          .select('id, name')
          .in('id', responsavelIds);
        (custData ?? []).forEach((c) => { responsaveisMap[c.id] = c.name; });
      }

      // 5. Buscar pessoas por sessão (table_session_customers)
      const { data: sessionCustomersData } = await supabase
        .from('table_session_customers')
        .select('table_session_id, customer_id')
        .in('table_session_id', sessionIds);

      const pessoasPorSessao: Record<string, number> = {};
      (sessionCustomersData ?? []).forEach((sc) => {
        pessoasPorSessao[sc.table_session_id] = (pessoasPorSessao[sc.table_session_id] ?? 0) + 1;
      });

      // 6. Montar sessões
      const ordersBySessao: Record<string, PedidoSessao[]> = {};
      (ordersData ?? []).forEach((o) => {
        if (!o.table_session_id) return;
        if (!ordersBySessao[o.table_session_id]) ordersBySessao[o.table_session_id] = [];
        ordersBySessao[o.table_session_id].push({
          id: o.id,
          numero: o.number ?? '',
          total: Number(o.total_amount ?? 0),
          status: o.status ?? 'new',
          origem: o.origin_type ?? 'cashier',
          criadoEm: o.created_at,
          clienteNome: o.destination_name ?? null,
        });
      });

      const result: SessaoHistorico[] = sessionsData
        .filter((s) => sessionIds.includes(s.id))
        .map((s) => {
          const mesa = tablesMap[s.table_id] ?? { number: 0, area: 'Salão', capacity: 4 };
          const pedidos = ordersBySessao[s.id] ?? [];
          const pedidosAtivos = pedidos.filter((p) => p.status !== 'cancelled');
          const totalReceita = pedidosAtivos.reduce((sum, p) => sum + p.total, 0);

          let duracaoMin: number | null = null;
          if (s.opened_at && s.closed_at) {
            duracaoMin = Math.round((new Date(s.closed_at).getTime() - new Date(s.opened_at).getTime()) / 60000);
          }

          return {
            id: s.id,
            tableId: s.table_id,
            mesaNumero: mesa.number,
            mesaArea: mesa.area,
            abertaEm: s.opened_at,
            fechadaEm: s.closed_at,
            duracaoMin,
            totalPedidos: pedidosAtivos.length,
            totalReceita,
            totalPessoas: pessoasPorSessao[s.id] ?? 0,
            responsavelNome: s.responsible_customer_id ? (responsaveisMap[s.responsible_customer_id] ?? null) : null,
            customerName: (s as { customer_name?: string | null }).customer_name ?? null,
            pedidos,
          };
        });

      // Filtro por busca (mesa número ou responsável)
      const filtered = filtro.busca
        ? result.filter((s) =>
            String(s.mesaNumero).includes(filtro.busca) ||
            (s.responsavelNome ?? '').toLowerCase().includes(filtro.busca.toLowerCase())
          )
        : result;

      setSessoes(filtered);
    } catch (e) {
      console.error('[HistoricoMesas] load error:', e);
      setError('Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, filtro]);

  useEffect(() => { load(); }, [load]);

  return { sessoes, loading, error, reload: load };
}

// ── SessaoRow ──────────────────────────────────────────────────────────────────

function SessaoRow({ sessao }: { sessao: SessaoHistorico }) {
  const [expanded, setExpanded] = useState(false);
  const isAberta = !sessao.fechadaEm;

  return (
    <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
      {/* Row principal */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors cursor-pointer"
      >
        {/* Mesa badge */}
        <div className={`w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 font-black text-sm relative ${isAberta ? 'bg-green-100 text-green-700 ring-2 ring-green-300' : 'bg-zinc-100 text-zinc-500'}`}>
          {sessao.mesaNumero}
          {isAberta && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
          )}
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-zinc-800">Mesa {sessao.mesaNumero}</span>
            <span className="text-[10px] text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full">{sessao.mesaArea}</span>
            {isAberta ? (
              <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                Aberta agora
              </span>
            ) : (
              <span className="text-[10px] font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full flex items-center gap-1">
                <i className="ri-checkbox-circle-line text-zinc-400" />
                Encerrada
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-[11px] text-zinc-500">
              <i className="ri-door-open-line mr-0.5 text-zinc-400" />
              Aberta {formatDateTime(sessao.abertaEm)}
            </span>
            {sessao.fechadaEm && (
              <span className="text-[11px] text-zinc-400">
                <i className="ri-door-closed-line mr-0.5" />
                Fechada {formatDateTime(sessao.fechadaEm)}
              </span>
            )}
            {sessao.duracaoMin !== null && (
              <span className="text-[11px] text-zinc-400">
                <i className="ri-time-line mr-0.5" />{formatDuration(sessao.duracaoMin)}
              </span>
            )}
            {(sessao.customerName || sessao.responsavelNome) && (
              <span className="text-[11px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded-full">
                <i className="ri-user-line mr-0.5" />{sessao.customerName ?? sessao.responsavelNome}
              </span>
            )}
          </div>
        </div>

        {/* Métricas rápidas */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {sessao.totalPessoas > 0 && (
            <div className="text-center hidden sm:block">
              <p className="text-xs font-bold text-zinc-700">{sessao.totalPessoas}</p>
              <p className="text-[9px] text-zinc-400">pessoas</p>
            </div>
          )}
          <div className="text-center hidden sm:block">
            <p className="text-xs font-bold text-zinc-700">{sessao.totalPedidos}</p>
            <p className="text-[9px] text-zinc-400">pedidos</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-black text-amber-700">{formatPrice(sessao.totalReceita)}</p>
            {sessao.totalPedidos > 0 && (
              <p className="text-[9px] text-zinc-400">
                {formatPrice(sessao.totalReceita / sessao.totalPedidos)} / pedido
              </p>
            )}
          </div>
          <div className="w-5 h-5 flex items-center justify-center text-zinc-400">
            {expanded ? <i className="ri-arrow-up-s-line" /> : <i className="ri-arrow-down-s-line" />}
          </div>
        </div>
      </button>

      {/* Detalhe expandido */}
      {expanded && (
        <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50/50">
          {sessao.pedidos.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-2">Nenhum pedido registrado nesta sessão</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Pedidos da Sessão
              </p>
              {sessao.pedidos.map((p) => {
                const isCancelled = p.status === 'cancelled';
                return (
                  <div key={p.id} className={`flex items-center gap-3 py-1.5 px-3 rounded-lg ${isCancelled ? 'bg-red-50 opacity-60' : 'bg-white border border-zinc-100'}`}>
                    <span className="text-[10px] font-bold text-zinc-500 w-24 truncate flex-shrink-0">{p.numero || '—'}</span>
                    <span className="text-[10px] text-zinc-400 flex-shrink-0">
                      {new Date(p.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      {ORIGEM_LABEL[p.origem] ?? p.origem}
                    </span>
                    {p.clienteNome && (
                      <span className="text-[10px] text-zinc-500 truncate flex-1">{p.clienteNome}</span>
                    )}
                    {isCancelled && (
                      <span className="text-[9px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded-full flex-shrink-0">Cancelado</span>
                    )}
                    <span className={`text-xs font-bold ml-auto flex-shrink-0 ${isCancelled ? 'text-red-400 line-through' : 'text-zinc-800'}`}>
                      {formatPrice(p.total)}
                    </span>
                  </div>
                );
              })}
              {/* Subtotal */}
              <div className="flex items-center justify-between pt-2 border-t border-zinc-200 mt-2">
                <span className="text-xs font-bold text-zinc-500">Total da sessão</span>
                <span className="text-sm font-black text-amber-700">{formatPrice(sessao.totalReceita)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function HistoricoMesas() {
  const [filtro, setFiltro] = useState<FiltroHistorico>({
    periodo: 'hoje',
    dataInicio: '',
    dataFim: '',
    mesaNumero: '',
    busca: '',
  });

  const { sessoes, loading, error, reload } = useHistoricoMesas(filtro);

  // Métricas agregadas
  const metricas = useMemo(() => {
    const total = sessoes.reduce((s, sess) => s + sess.totalReceita, 0);
    const totalPedidos = sessoes.reduce((s, sess) => s + sess.totalPedidos, 0);
    const totalPessoas = sessoes.reduce((s, sess) => s + sess.totalPessoas, 0);
    const duracoes = sessoes.filter((s) => s.duracaoMin !== null).map((s) => s.duracaoMin as number);
    const duracaoMedia = duracoes.length > 0 ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : null;
    const ticketMedio = sessoes.length > 0 ? total / sessoes.length : 0;

    // Mesa mais lucrativa
    const porMesa: Record<number, number> = {};
    sessoes.forEach((s) => { porMesa[s.mesaNumero] = (porMesa[s.mesaNumero] ?? 0) + s.totalReceita; });
    const mesaTop = Object.entries(porMesa).sort((a, b) => Number(b[1]) - Number(a[1]))[0];

    return { total, totalPedidos, totalPessoas, duracaoMedia, ticketMedio, mesaTop };
  }, [sessoes]);

  const periodos: { key: Periodo; label: string }[] = [
    { key: 'hoje', label: 'Hoje' },
    { key: 'ontem', label: 'Ontem' },
    { key: '7dias', label: '7 dias' },
    { key: '30dias', label: '30 dias' },
    { key: 'personalizado', label: 'Personalizado' },
  ];

  // Mesas únicas para filtro
  const mesasUnicas = useMemo(() => {
    const nums = [...new Set(sessoes.map((s) => s.mesaNumero))].sort((a, b) => a - b);
    return nums;
  }, [sessoes]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-50">
      {/* Filtros */}
      <div className="bg-white border-b border-zinc-200 px-6 py-3 flex-shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Período */}
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
            {periodos.map((p) => (
              <button
                key={p.key}
                onClick={() => setFiltro((f) => ({ ...f, periodo: p.key }))}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  filtro.periodo === p.key ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Datas personalizadas */}
          {filtro.periodo === 'personalizado' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filtro.dataInicio}
                onChange={(e) => setFiltro((f) => ({ ...f, dataInicio: e.target.value }))}
                className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
              />
              <span className="text-xs text-zinc-400">até</span>
              <input
                type="date"
                value={filtro.dataFim}
                onChange={(e) => setFiltro((f) => ({ ...f, dataFim: e.target.value }))}
                className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
              />
            </div>
          )}

          {/* Filtro por mesa */}
          <select
            value={filtro.mesaNumero}
            onChange={(e) => setFiltro((f) => ({ ...f, mesaNumero: e.target.value }))}
            className="border border-zinc-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white cursor-pointer"
          >
            <option value="">Todas as mesas</option>
            {mesasUnicas.map((n) => (
              <option key={n} value={String(n)}>Mesa {n}</option>
            ))}
          </select>

          {/* Busca */}
          <div className="flex items-center gap-2 border border-zinc-200 rounded-lg px-3 py-1.5 bg-white flex-1 min-w-[160px] max-w-xs">
            <i className="ri-search-line text-zinc-400 text-xs" />
            <input
              type="text"
              value={filtro.busca}
              onChange={(e) => setFiltro((f) => ({ ...f, busca: e.target.value }))}
              placeholder="Buscar mesa ou responsável..."
              className="flex-1 text-xs focus:outline-none bg-transparent text-sm"
            />
            {filtro.busca && (
              <button onClick={() => setFiltro((f) => ({ ...f, busca: '' }))} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                <i className="ri-close-line text-xs" />
              </button>
            )}
          </div>

          {/* Reload */}
          <button
            onClick={reload}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors flex-shrink-0"
            title="Atualizar"
          >
            <i className={`ri-refresh-line text-sm ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Métricas do período */}
      {sessoes.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 px-6 py-4 flex-shrink-0">
          {[
            { label: 'Sessões', value: String(sessoes.length), icon: 'ri-table-2', color: 'text-zinc-700' },
            { label: 'Faturamento', value: formatPrice(metricas.total), icon: 'ri-money-dollar-circle-line', color: 'text-amber-700' },
            { label: 'Ticket médio', value: formatPrice(metricas.ticketMedio), icon: 'ri-receipt-line', color: 'text-zinc-700' },
            { label: 'Pedidos', value: String(metricas.totalPedidos), icon: 'ri-file-list-3-line', color: 'text-zinc-700' },
            { label: 'Pessoas', value: metricas.totalPessoas > 0 ? String(metricas.totalPessoas) : '—', icon: 'ri-group-line', color: 'text-zinc-700' },
            { label: 'Duração média', value: formatDuration(metricas.duracaoMedia), icon: 'ri-timer-line', color: 'text-zinc-700' },
          ].map((m) => (
            <div key={m.label} className="bg-white rounded-xl border border-zinc-100 px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <i className={`${m.icon} text-xs text-zinc-400`} />
                <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">{m.label}</p>
              </div>
              <p className={`text-base font-black ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Lista de sessões */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-400">Carregando histórico...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-2xl">
              <i className="ri-error-warning-line text-2xl text-red-400" />
            </div>
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={reload} className="text-xs text-amber-600 font-semibold hover:underline cursor-pointer">
              Tentar novamente
            </button>
          </div>
        ) : sessoes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl">
              <i className="ri-history-line text-3xl text-zinc-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-500">Nenhuma sessão encontrada</p>
              <p className="text-xs text-zinc-400 mt-1">Tente ajustar o período ou os filtros</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Agrupamento por data */}
            {(() => {
              const grupos: Record<string, SessaoHistorico[]> = {};
              sessoes.forEach((s) => {
                const dia = formatDate(s.abertaEm);
                if (!grupos[dia]) grupos[dia] = [];
                grupos[dia].push(s);
              });

              return Object.entries(grupos).map(([dia, sessDia]) => {
                const totalDia = sessDia.reduce((s, sess) => s + sess.totalReceita, 0);
                return (
                  <div key={dia}>
                    {/* Header do dia */}
                    <div className="flex items-center justify-between py-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-500">{dia}</span>
                        <span className="text-[10px] text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">
                          {sessDia.length} sessão{sessDia.length !== 1 ? 'ões' : ''}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-amber-700">{formatPrice(totalDia)}</span>
                    </div>
                    <div className="space-y-2">
                      {sessDia.map((s) => <SessaoRow key={s.id} sessao={s} />)}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
