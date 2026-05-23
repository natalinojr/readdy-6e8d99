import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { Navigate } from 'react-router-dom';

interface CheckResult {
  [key: string]: boolean | string;
}

interface ScenarioResult {
  scenario: string;
  status: 'ok' | 'error' | 'partial';
  order_id?: string;
  order_number?: string;
  payment_id?: string;
  items_inserted?: number;
  payment_registered?: boolean;
  error?: string;
  checks: CheckResult;
}

interface SimulationResponse {
  summary: { total: number; ok: number; partial: number; error: number };
  results: ScenarioResult[];
  session_id: string;
  cash_register_id: string;
}

interface StatusInfo {
  ok: boolean;
  session?: { id: string; number: string };
  cash_register?: { id: string; opening_value: number };
  error?: string;
}

const STATUS_COLORS = {
  ok: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-100 text-amber-700 border-amber-200',
  error: 'bg-red-100 text-red-700 border-red-200',
};

const STATUS_ICONS = {
  ok: 'ri-checkbox-circle-fill text-emerald-500',
  partial: 'ri-alert-fill text-amber-500',
  error: 'ri-close-circle-fill text-red-500',
};

function CheckBadge({ value }: { value: boolean | string }) {
  if (typeof value === 'boolean') {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${value ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
        <i className={value ? 'ri-check-line' : 'ri-close-line'} />
        {value ? 'OK' : 'FALHOU'}
      </span>
    );
  }
  const isError = value.startsWith('ERROR') || value.startsWith('ERRO') || value.startsWith('DIVERGÊNCIA');
  const isPartial = value.startsWith('PARCIAL');
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
      isError ? 'bg-red-100 text-red-700' : isPartial ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
    }`}>
      <i className={isError ? 'ri-close-line' : isPartial ? 'ri-alert-line' : 'ri-check-line'} />
      {value}
    </span>
  );
}

export default function SimulacaoPedidos() {
  const { user } = useAuth();
  const [statusInfo, setStatusInfo] = useState<StatusInfo | null>(null);
  const [results, setResults] = useState<SimulationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const handleCheckStatus = useCallback(async () => {
    setCheckingStatus(true);
    setError(null);
    try {
      const { data, error: fnErr } = await invokeWithAuth<StatusInfo>('simulate-pdv-orders', {
        body: { action: 'check_status' },
      });
      if (fnErr) throw fnErr;
      setStatusInfo(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatusInfo({ ok: false, error: msg });
    } finally {
      setCheckingStatus(false);
    }
  }, []);

  const handleRunSimulation = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    setExpandedIdx(null);
    try {
      const { data, error: fnErr } = await invokeWithAuth<SimulationResponse>('simulate-pdv-orders', {
        body: { action: 'run_all' },
      });
      if (fnErr) throw fnErr;
      setResults(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const summary = results?.summary;
  const allOk = summary && summary.error === 0 && summary.partial === 0;

  if (user && user.perfil !== 'admin' && user.perfil !== 'gerente') {
    return <Navigate to="/modulos" replace />;
  }

  return (
    <div className="flex flex-col h-full bg-zinc-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-zinc-200 flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
            <div className="w-7 h-7 flex items-center justify-center bg-amber-100 rounded-lg">
              <i className="ri-test-tube-line text-amber-600 text-sm" />
            </div>
            Simulação de Pedidos PDV
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Cria 12 pedidos reais cobrindo todos os cenários do PDV Caixa e verifica falhas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCheckStatus}
            disabled={checkingStatus}
            className="flex items-center gap-2 px-4 py-2 border border-zinc-200 hover:bg-zinc-50 text-zinc-700 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50"
          >
            <i className={`ri-wifi-line text-sm ${checkingStatus ? 'animate-pulse' : ''}`} />
            {checkingStatus ? 'Verificando...' : 'Verificar Sessão'}
          </button>
          <button
            onClick={handleRunSimulation}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Simulando 12 cenários...
              </>
            ) : (
              <>
                <i className="ri-play-fill text-sm" />
                Executar Simulação Completa
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Status da sessão */}
        {statusInfo && (
          <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${statusInfo.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${statusInfo.ok ? 'bg-emerald-100' : 'bg-red-100'}`}>
              <i className={`text-base ${statusInfo.ok ? 'ri-checkbox-circle-line text-emerald-600' : 'ri-close-circle-line text-red-600'}`} />
            </div>
            <div className="flex-1 min-w-0">
              {statusInfo.ok ? (
                <>
                  <p className="text-sm font-bold text-emerald-800">Sessão e caixa ativos — pronto para simular</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Sessão: <strong>{statusInfo.session?.number}</strong> · 
                    Caixa: abertura R$ {statusInfo.cash_register?.opening_value?.toFixed(2)}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-red-800">Sessão ou caixa não encontrado</p>
                  <p className="text-xs text-red-700 mt-0.5">{statusInfo.error}</p>
                  <p className="text-xs text-red-600 mt-1">
                    Acesse <strong>/pdv/caixa</strong>, inicie uma sessão e abra o caixa antes de simular.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Erro geral */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <i className="ri-error-warning-line text-red-500 text-base flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-700 font-bold text-sm">Erro na simulação</p>
              <p className="text-red-600 text-xs mt-0.5 font-mono">{error}</p>
            </div>
          </div>
        )}

        {/* Estado inicial */}
        {!results && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 flex items-center justify-center bg-amber-50 rounded-3xl mb-5 border border-amber-100">
              <i className="ri-test-tube-line text-4xl text-amber-400" />
            </div>
            <h3 className="text-base font-bold text-zinc-700 mb-2">12 cenários prontos para testar</h3>
            <div className="grid grid-cols-2 gap-2 text-left max-w-lg mb-6">
              {[
                'Pedido simples / Dinheiro',
                'Com opção obrigatória / PIX',
                'Mesa + número / Débito',
                'Nome do cliente / Crédito',
                'Senha / Vale Refeição',
                'Com desconto R$10',
                'Com taxa de serviço 10%',
                'Múltiplos itens / Mesa 12',
                'Com observação livre',
                'Grande quantidade (5x)',
                'Item skip_kds (sem preparo)',
                'Delivery / PIX',
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-zinc-600 bg-white border border-zinc-100 rounded-lg px-3 py-2">
                  <span className="w-5 h-5 flex items-center justify-center bg-zinc-100 rounded-full text-[10px] font-bold text-zinc-500 flex-shrink-0">{i + 1}</span>
                  {s}
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-400 max-w-sm">
              Clique em "Verificar Sessão" primeiro para confirmar que há sessão e caixa abertos, depois execute a simulação.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 flex items-center justify-center bg-amber-50 rounded-2xl mb-4">
              <div className="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-sm font-bold text-zinc-700">Criando 12 pedidos no banco...</p>
            <p className="text-xs text-zinc-400 mt-1">Isso pode levar alguns segundos</p>
          </div>
        )}

        {/* Resultados */}
        {results && !loading && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white border border-zinc-200 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-zinc-900">{summary?.total}</p>
                <p className="text-xs text-zinc-500 mt-1">Total testado</p>
              </div>
              <div className={`rounded-xl p-4 text-center border ${summary?.ok === summary?.total ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-zinc-200'}`}>
                <p className={`text-3xl font-black ${summary?.ok === summary?.total ? 'text-emerald-600' : 'text-zinc-900'}`}>{summary?.ok}</p>
                <p className="text-xs text-zinc-500 mt-1">Passou</p>
              </div>
              <div className={`rounded-xl p-4 text-center border ${(summary?.partial ?? 0) > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-zinc-200'}`}>
                <p className={`text-3xl font-black ${(summary?.partial ?? 0) > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>{summary?.partial}</p>
                <p className="text-xs text-zinc-500 mt-1">Parcial</p>
              </div>
              <div className={`rounded-xl p-4 text-center border ${(summary?.error ?? 0) > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-zinc-200'}`}>
                <p className={`text-3xl font-black ${(summary?.error ?? 0) > 0 ? 'text-red-600' : 'text-zinc-400'}`}>{summary?.error}</p>
                <p className="text-xs text-zinc-500 mt-1">Erro</p>
              </div>
            </div>

            {/* Veredicto */}
            <div className={`flex items-center gap-3 rounded-xl px-5 py-4 border ${allOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className={`w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 ${allOk ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                <i className={`text-xl ${allOk ? 'ri-shield-check-fill text-emerald-600' : 'ri-alert-fill text-amber-600'}`} />
              </div>
              <div>
                <p className={`font-bold text-sm ${allOk ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {allOk
                    ? 'PDV Caixa 100% funcional — todos os 12 cenários passaram!'
                    : `Atenção: ${(summary?.error ?? 0) + (summary?.partial ?? 0)} cenário(s) com problema`}
                </p>
                <p className={`text-xs mt-0.5 ${allOk ? 'text-emerald-600' : 'text-amber-700'}`}>
                  {allOk
                    ? 'Pedidos criados, itens inseridos e pagamentos registrados corretamente em todos os casos.'
                    : 'Veja os detalhes abaixo para identificar e corrigir os problemas.'}
                </p>
              </div>
            </div>

            {/* Lista de cenários */}
            <div className="space-y-2">
              {results.results.map((r, idx) => (
                <div key={idx} className={`bg-white border rounded-xl overflow-hidden transition-all ${STATUS_COLORS[r.status]}`}>
                  <button
                    onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-black/5 transition-colors"
                  >
                    <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                      <i className={`text-base ${STATUS_ICONS[r.status]}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-900 truncate">{r.scenario}</p>
                      {r.order_number && (
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Pedido: <strong>{r.order_number}</strong>
                          {r.items_inserted !== undefined && ` · ${r.items_inserted} item(ns) inserido(s)`}
                          {r.payment_registered && ' · Pagamento OK'}
                        </p>
                      )}
                      {r.error && (
                        <p className="text-xs text-red-600 mt-0.5 font-mono truncate">{r.error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_COLORS[r.status]}`}>
                        {r.status === 'ok' ? 'PASSOU' : r.status === 'partial' ? 'PARCIAL' : 'ERRO'}
                      </span>
                      <i className={`text-zinc-400 text-sm ${expandedIdx === idx ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
                    </div>
                  </button>

                  {expandedIdx === idx && (
                    <div className="px-4 pb-4 border-t border-zinc-100 pt-3">
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Verificações detalhadas</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(r.checks).map(([key, val]) => (
                          <div key={key} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-zinc-400 font-mono">{key}:</span>
                            <CheckBadge value={val} />
                          </div>
                        ))}
                      </div>
                      {r.order_id && (
                        <p className="text-[10px] text-zinc-400 font-mono mt-2">
                          order_id: {r.order_id}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
