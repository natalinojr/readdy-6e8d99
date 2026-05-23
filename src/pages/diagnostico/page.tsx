import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Navigate, Link } from 'react-router-dom';

interface DivergenciaRow {
  order_id: string;
  order_number: string;
  origin: string;
  order_status: string;
  subtotal_declarado: string;
  subtotal_real: string;
  divergencia_abs: string;
  qtd_itens: number;
  criado_em: string;
  tenant_id: string;
}

type Periodo = '7d' | '30d' | '90d' | 'all';
type OrigemFiltro = 'all' | 'self_service' | 'waiter' | 'cashier' | 'table' | 'delivery';
type TipoFiltro = 'all' | 'sem_itens' | 'parcial';

const PERIODO_LABELS: Record<Periodo, string> = {
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  'all': 'Todo o histórico',
};

const ORIGEM_LABELS: Record<string, string> = {
  self_service: 'Autoatendimento',
  waiter: 'Garçom',
  cashier: 'Caixa',
  table: 'Mesa',
  delivery: 'Delivery',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-zinc-100 text-zinc-600',
  preparing: 'bg-amber-100 text-amber-700',
  ready: 'bg-emerald-100 text-emerald-700',
  delivered: 'bg-sky-100 text-sky-700',
  cancelled: 'bg-red-100 text-red-700',
};

function fmt(v: string | number) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function DiagnosticoPage() {
  const { user } = useAuth();

  const [dados, setDados] = useState<DivergenciaRow[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date | null>(null);

  // Filtros
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  const [origem, setOrigem] = useState<OrigemFiltro>('all');
  const [tipo, setTipo] = useState<TipoFiltro>('all');
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      let query = supabase
        .from('v_divergencia_totais' as 'orders')
        .select('*');

      // Filtro de período
      if (periodo !== 'all') {
        const dias = periodo === '7d' ? 7 : periodo === '30d' ? 30 : 90;
        const desde = new Date();
        desde.setDate(desde.getDate() - dias);
        query = query.gte('criado_em', desde.toISOString());
      }

      // Filtro de origem
      if (origem !== 'all') {
        query = query.eq('origin', origem);
      }

      // Filtro de tipo
      if (tipo === 'sem_itens') {
        query = query.eq('qtd_itens', 0);
      } else if (tipo === 'parcial') {
        query = query.gt('qtd_itens', 0);
      }

      const { data, error } = await query.order('divergencia_abs', { ascending: false }).limit(200);

      if (error) throw new Error(error.message);
      setDados((data as unknown as DivergenciaRow[]) ?? []);
      setUltimaAtualizacao(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [periodo, origem, tipo]);

  // Apenas o admin master pode acessar
  if (user && user.email !== 'natalinojr.engel@gmail.com') {
    return <Navigate to="/modulos" replace />;
  }

  // Filtro de busca local (por número do pedido)
  const dadosFiltrados = dados.filter((d) => {
    if (!busca) return true;
    return d.order_number.toLowerCase().includes(busca.toLowerCase());
  });

  // Métricas resumidas
  const totalDivergencia = dadosFiltrados.reduce((s, d) => s + Number(d.divergencia_abs), 0);
  const semItens = dadosFiltrados.filter((d) => d.qtd_itens === 0).length;
  const parciais = dadosFiltrados.filter((d) => d.qtd_itens > 0).length;
  const maiorDivergencia = dadosFiltrados[0] ? Number(dadosFiltrados[0].divergencia_abs) : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div>
          <h1 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
            <div className="w-7 h-7 flex items-center justify-center bg-red-100 rounded-lg">
              <i className="ri-bug-line text-red-600 text-sm" />
            </div>
            Diagnóstico de Pedidos
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Pedidos com divergência entre subtotal declarado e soma real dos itens
          </p>
        </div>
        <div className="flex items-center gap-3">
          {ultimaAtualizacao && (
            <span className="text-xs text-zinc-400">
              Atualizado: {ultimaAtualizacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Link
            to="/diagnostico/checklist"
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-task-line text-sm" />
            Checklist de Testes
          </Link>
          <button
            onClick={carregar}
            disabled={carregando}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className={`ri-refresh-line text-sm ${carregando ? 'animate-spin' : ''}`} />
            {carregando ? 'Carregando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 px-6 py-3 border-b flex-shrink-0 flex-wrap">
        {/* Período */}
        <div className="flex items-center gap-1 bg-zinc-100 rounded-xl p-1">
          {(Object.keys(PERIODO_LABELS) as Periodo[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                periodo === p ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {PERIODO_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Origem */}
        <select
          value={origem}
          onChange={(e) => setOrigem(e.target.value as OrigemFiltro)}
          className="text-xs font-semibold text-zinc-700 bg-zinc-100 border-0 rounded-xl px-3 py-2 cursor-pointer outline-none"
        >
          <option value="all">Todas as origens</option>
          <option value="self_service">Autoatendimento</option>
          <option value="waiter">Garçom</option>
          <option value="cashier">Caixa</option>
          <option value="table">Mesa</option>
          <option value="delivery">Delivery</option>
        </select>

        {/* Tipo */}
        <div className="flex items-center gap-1 bg-zinc-100 rounded-xl p-1">
          {([['all', 'Todos'], ['sem_itens', 'Sem itens'], ['parcial', 'Parciais']] as [TipoFiltro, string][]).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setTipo(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                tipo === v ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Busca */}
        <div className="flex items-center gap-2 bg-zinc-100 rounded-xl px-3 py-2 flex-1 min-w-40 max-w-64">
          <i className="ri-search-line text-zinc-400 text-sm" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por número..."
            className="flex-1 bg-transparent text-xs outline-none text-zinc-800 placeholder-zinc-400"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
              <i className="ri-close-line text-xs" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Estado inicial */}
        {!ultimaAtualizacao && !carregando && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
              <i className="ri-database-2-line text-3xl text-zinc-400" />
            </div>
            <h3 className="text-base font-bold text-zinc-700 mb-1">Pronto para diagnóstico</h3>
            <p className="text-sm text-zinc-400 max-w-sm mb-6">
              Clique em "Atualizar" para consultar a view <code className="bg-zinc-100 px-1 rounded text-xs">v_divergencia_totais</code> e detectar pedidos com divergência de totais.
            </p>
            <button
              onClick={carregar}
              className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 hover:bg-zinc-700 text-white text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-play-line" />
              Executar diagnóstico
            </button>
          </div>
        )}

        {/* Erro */}
        {erro && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            <i className="ri-error-warning-line text-red-500 text-base flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-700 font-semibold text-sm">Erro ao consultar</p>
              <p className="text-red-600 text-xs mt-0.5">{erro}</p>
            </div>
          </div>
        )}

        {/* Métricas */}
        {ultimaAtualizacao && !carregando && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              <div className="bg-white border border-zinc-200 rounded-xl p-4">
                <p className="text-xs text-zinc-500 mb-1">Total encontrado</p>
                <p className="text-2xl font-black text-zinc-900">{dadosFiltrados.length}</p>
                <p className="text-xs text-zinc-400 mt-0.5">pedidos com divergência</p>
              </div>
              <div className="bg-white border border-red-200 rounded-xl p-4">
                <p className="text-xs text-red-500 mb-1">Sem nenhum item</p>
                <p className="text-2xl font-black text-red-600">{semItens}</p>
                <p className="text-xs text-zinc-400 mt-0.5">inserção silenciosa falhou</p>
              </div>
              <div className="bg-white border border-amber-200 rounded-xl p-4">
                <p className="text-xs text-amber-600 mb-1">Inserção parcial</p>
                <p className="text-2xl font-black text-amber-600">{parciais}</p>
                <p className="text-xs text-zinc-400 mt-0.5">itens faltando no banco</p>
              </div>
              <div className="bg-white border border-zinc-200 rounded-xl p-4">
                <p className="text-xs text-zinc-500 mb-1">Maior divergência</p>
                <p className="text-2xl font-black text-zinc-900">{fmt(maiorDivergencia)}</p>
                <p className="text-xs text-zinc-400 mt-0.5">valor máximo perdido</p>
              </div>
            </div>

            {/* Alerta de saúde */}
            {dadosFiltrados.length === 0 ? (
              <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-5">
                <div className="w-8 h-8 flex items-center justify-center bg-emerald-100 rounded-lg flex-shrink-0">
                  <i className="ri-shield-check-line text-emerald-600" />
                </div>
                <div>
                  <p className="text-emerald-800 font-bold text-sm">Sistema saudável</p>
                  <p className="text-emerald-600 text-xs">Nenhuma divergência encontrada no período selecionado. O bug de inserção parcial não voltou.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
                <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
                  <i className="ri-alert-line text-amber-600" />
                </div>
                <div>
                  <p className="text-amber-800 font-bold text-sm">{dadosFiltrados.length} pedido{dadosFiltrados.length !== 1 ? 's' : ''} com divergência detectado{dadosFiltrados.length !== 1 ? 's' : ''}</p>
                  <p className="text-amber-700 text-xs">
                    Divergência total acumulada: <strong>{fmt(totalDivergencia)}</strong>.
                    {semItens > 0 && ` ${semItens} pedido${semItens !== 1 ? 's' : ''} sem nenhum item no banco.`}
                  </p>
                </div>
              </div>
            )}

            {/* Tabela */}
            {dadosFiltrados.length > 0 && (
              <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-zinc-50 border-b border-zinc-200">
                        <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Pedido</th>
                        <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Origem</th>
                        <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Status</th>
                        <th className="text-right px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Subtotal declarado</th>
                        <th className="text-right px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Subtotal real</th>
                        <th className="text-right px-4 py-3 text-xs font-bold text-red-500 uppercase tracking-wider whitespace-nowrap">Divergência</th>
                        <th className="text-center px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Itens</th>
                        <th className="text-left px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">Data</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {dadosFiltrados.map((row) => {
                        const isSemItens = row.qtd_itens === 0;
                        const divergenciaGrande = Number(row.divergencia_abs) > 50;
                        return (
                          <tr key={`${row.order_id}-${row.origin}`} className={`hover:bg-zinc-50 transition-colors ${isSemItens ? 'bg-red-50/40' : ''}`}>
                            <td className="px-4 py-3">
                              <span className="font-bold text-zinc-900 text-xs">{row.order_number}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs text-zinc-600">{ORIGEM_LABELS[row.origin] ?? row.origin}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[row.order_status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                                {row.order_status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-xs text-zinc-700 font-semibold">{fmt(row.subtotal_declarado)}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`text-xs font-semibold ${isSemItens ? 'text-red-500' : 'text-zinc-700'}`}>
                                {fmt(row.subtotal_real)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`text-xs font-black ${divergenciaGrande ? 'text-red-600' : 'text-amber-600'}`}>
                                {fmt(row.divergencia_abs)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                                isSemItens ? 'bg-red-100 text-red-600' : 'bg-zinc-100 text-zinc-700'
                              }`}>
                                {row.qtd_itens}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs text-zinc-500 whitespace-nowrap">{fmtDate(row.criado_em)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-200 flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{dadosFiltrados.length} registro{dadosFiltrados.length !== 1 ? 's' : ''} encontrado{dadosFiltrados.length !== 1 ? 's' : ''}</span>
                  <span className="text-xs font-bold text-zinc-700">Divergência total: {fmt(totalDivergencia)}</span>
                </div>
              </div>
            )}

            {/* SQL de referência */}
            <div className="mt-5 bg-white border border-zinc-200 rounded-xl p-4">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <i className="ri-code-line" />
                Queries de monitoramento (Supabase SQL Editor)
              </p>
              <pre className="text-xs text-zinc-600 bg-zinc-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`-- Últimos 7 dias
SELECT * FROM v_divergencia_totais
WHERE criado_em >= NOW() - INTERVAL '7 days';

-- Pedidos sem nenhum item (inserção silenciosa falhou)
SELECT * FROM v_divergencia_totais WHERE qtd_itens = 0;

-- Divergências grandes (> R$10)
SELECT * FROM v_divergencia_totais WHERE divergencia_abs > 10;

-- Por origem
SELECT origin, COUNT(*), SUM(divergencia_abs)
FROM v_divergencia_totais
GROUP BY origin ORDER BY SUM(divergencia_abs) DESC;`}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
