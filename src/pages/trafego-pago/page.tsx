import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  Megaphone, RefreshCw, Link2Off, AlertTriangle, Loader2,
  TrendingUp, Eye, MousePointerClick, Target, Wallet,
} from 'lucide-react';

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface AdAccount { id: string; name: string }

interface Connection {
  ad_account_id: string | null;
  ad_account_name: string | null;
  available_accounts: AdAccount[];
  token_expires_at: string | null;
  connected_by_name?: string | null;
}

interface CampaignRow {
  campaign: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  cpc: number;
  ctr: number;
  results: Array<{ type: string; value: number }>;
}

interface InsightsResponse {
  ok: boolean;
  not_connected?: boolean;
  no_account?: boolean;
  ad_account_name?: string;
  count?: number;
  campaigns?: CampaignRow[];
  error?: unknown;
}

// ─── Constantes ──────────────────────────────────────────────────────────────
const PERIODOS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: 'Últimos 7 dias' },
  { value: 'last_14d', label: 'Últimos 14 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês passado' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n: number) => Math.round(Number(n || 0)).toLocaleString('pt-BR');
const sumResults = (results: CampaignRow['results']) =>
  (results || []).reduce((s, r) => s + (r.value || 0), 0);

const OAUTH_STATE_KEY = 'meta_oauth_state';

export default function TrafegoPagoPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [datePreset, setDatePreset] = useState('last_30d');
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // ── Status da conexão ──
  const loadStatus = useCallback(async () => {
    if (!tenantId) return;
    setLoadingStatus(true);
    const { data } = await invokeWithAuth<{ success: boolean; connection: Connection | null }>(
      'meta-connect',
      { body: { action: 'status', tenant_id: tenantId } },
    );
    setConnection(data?.connection ?? null);
    setLoadingStatus(false);
  }, [tenantId]);

  // ── Troca o code OAuth por token ──
  const handleExchange = useCallback(async (code: string) => {
    setExchanging(true);
    setError(null);
    const redirectUri = window.location.origin + window.location.pathname;
    const { data, error: err } = await invokeWithAuth<{ success: boolean; connection: Connection }>(
      'meta-connect',
      {
        body: {
          action: 'exchange',
          tenant_id: tenantId,
          code,
          redirect_uri: redirectUri,
          connected_by_name: user?.nome ?? null,
        },
      },
    );
    if (err || !data?.success) {
      setError(err?.message ?? 'Não foi possível concluir a conexão. Tente novamente.');
    } else {
      setConnection(data.connection);
    }
    setExchanging(false);
  }, [tenantId, user?.nome]);

  // ── Ao montar: trata retorno do OAuth (?code=) ou carrega status ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const returnedState = params.get('state');
    const oauthError = params.get('error_description') || params.get('error');

    if (code || oauthError) {
      // Limpa a URL (remove ?code=...)
      window.history.replaceState({}, '', window.location.pathname);
      const savedState = sessionStorage.getItem(OAUTH_STATE_KEY);
      sessionStorage.removeItem(OAUTH_STATE_KEY);
      setLoadingStatus(false);

      if (oauthError) {
        setError(`Conexão cancelada na Meta: ${oauthError}`);
        loadStatus();
        return;
      }
      if (!returnedState || returnedState !== savedState) {
        setError('Falha na verificação de segurança. Tente conectar novamente.');
        loadStatus();
        return;
      }
      handleExchange(code!);
    } else {
      loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // ── Carrega as campanhas quando há conta + muda período ──
  const loadInsights = useCallback(async () => {
    if (!tenantId || !connection?.ad_account_id) return;
    setInsightsLoading(true);
    setInsightsError(null);
    const { data, error: err } = await invokeWithAuth<InsightsResponse>('meta-ads-insights', {
      body: { tenant_id: tenantId, date_preset: datePreset },
    });
    if (err) {
      setInsightsError(err.message);
    } else if (data && !data.ok) {
      setInsightsError(typeof data.error === 'string' ? data.error : 'Erro ao buscar as campanhas.');
    } else {
      setInsights(data ?? null);
    }
    setInsightsLoading(false);
  }, [tenantId, connection?.ad_account_id, datePreset]);

  useEffect(() => {
    if (connection?.ad_account_id) loadInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.ad_account_id, datePreset]);

  // ── Inicia o login do Facebook ──
  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    const { data, error: err } = await invokeWithAuth<{ success: boolean; app_id: string; config_id?: string | null }>(
      'meta-connect',
      { body: { action: 'config' } },
    );
    if (err || !data?.app_id) {
      setError('Configuração da Meta indisponível. Avise o suporte.');
      setConnecting(false);
      return;
    }
    const redirectUri = window.location.origin + window.location.pathname;
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    // Login do Facebook para Empresas usa config_id; login clássico usa scope.
    const grant = data.config_id
      ? `config_id=${encodeURIComponent(data.config_id)}`
      : 'scope=ads_read';
    const url =
      `https://www.facebook.com/v20.0/dialog/oauth?client_id=${data.app_id}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&${grant}&response_type=code&state=${state}`;
    window.location.href = url;
  }, []);

  // ── Troca a conta de anúncios acompanhada ──
  const handleSelectAccount = useCallback(async (adAccountId: string) => {
    if (!tenantId) return;
    const { error: err } = await invokeWithAuth('meta-connect', {
      body: { action: 'select_account', tenant_id: tenantId, ad_account_id: adAccountId },
    });
    if (!err) {
      setConnection((prev) => {
        if (!prev) return prev;
        const acc = prev.available_accounts.find((a) => a.id === adAccountId);
        return { ...prev, ad_account_id: adAccountId, ad_account_name: acc?.name ?? prev.ad_account_name };
      });
    }
  }, [tenantId]);

  // ── Desconectar ──
  const handleDisconnect = useCallback(async () => {
    if (!tenantId) return;
    if (!window.confirm('Desconectar a conta da Meta? Os números deixarão de aparecer até reconectar.')) return;
    await invokeWithAuth('meta-connect', { body: { action: 'disconnect', tenant_id: tenantId } });
    setConnection(null);
    setInsights(null);
  }, [tenantId]);

  // ── Totais ──
  const campaigns = insights?.campaigns ?? [];
  const totals = campaigns.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      reach: acc.reach + c.reach,
      clicks: acc.clicks + c.clicks,
      results: acc.results + sumResults(c.results),
    }),
    { spend: 0, reach: 0, clicks: 0, results: 0 },
  );

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 flex items-center justify-center rounded-xl bg-amber-100 border border-amber-200">
            <Megaphone size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-black text-zinc-900 leading-tight">Tráfego Pago</h1>
            <p className="text-sm text-zinc-400">Acompanhe suas campanhas de anúncios da Meta</p>
          </div>
        </div>

        {connection?.ad_account_id && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              className="text-sm font-semibold border border-zinc-200 rounded-xl px-3 py-2 bg-white text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
            >
              {PERIODOS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <button
              onClick={loadInsights}
              disabled={insightsLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 cursor-pointer disabled:opacity-50"
              title="Atualizar"
            >
              <RefreshCw size={14} className={insightsLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl bg-white border border-red-200 text-red-500 hover:bg-red-50 cursor-pointer"
            >
              <Link2Off size={14} />
              <span className="hidden sm:inline">Desconectar</span>
            </button>
          </div>
        )}
      </div>

      {/* Erro geral */}
      {error && (
        <div className="mb-5 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Carregando status / trocando token */}
      {(loadingStatus || exchanging) && (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <Loader2 size={28} className="animate-spin mb-3 text-amber-500" />
          <p className="text-sm font-semibold">{exchanging ? 'Conectando à Meta...' : 'Carregando...'}</p>
        </div>
      )}

      {/* Não conectado → botão Conectar */}
      {!loadingStatus && !exchanging && !connection?.ad_account_id && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-zinc-200 rounded-2xl">
          <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-amber-50 border border-amber-100 mb-5">
            <Megaphone size={30} className="text-amber-500" />
          </div>
          <h2 className="text-lg font-black text-zinc-800 mb-1.5">Conecte sua conta de anúncios</h2>
          <p className="text-sm text-zinc-500 max-w-md mb-6 leading-relaxed">
            Conecte sua conta do Facebook para acompanhar, aqui dentro do ERPOS, o desempenho das suas
            campanhas: gasto, alcance, cliques e resultados.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="flex items-center gap-2.5 px-6 py-3 rounded-xl text-white font-bold text-sm cursor-pointer transition-all disabled:opacity-60 hover:brightness-110"
            style={{ background: '#1877F2' }}
          >
            {connecting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" />
              </svg>
            )}
            {connecting ? 'Abrindo...' : 'Conectar com Facebook'}
          </button>
          <p className="text-xs text-zinc-400 mt-5 max-w-md">
            Usamos apenas leitura dos dados de desempenho (ads_read). Veja nossa{' '}
            <a href="/privacidade" target="_blank" rel="noreferrer" className="text-amber-600 font-semibold underline">
              política de privacidade
            </a>.
          </p>
        </div>
      )}

      {/* Conectado → painel */}
      {!loadingStatus && !exchanging && connection?.ad_account_id && (
        <>
          {/* Conta conectada + seletor (se houver mais de uma) */}
          <div className="flex items-center gap-2 mb-5 flex-wrap text-sm">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Conectado
            </span>
            {connection.available_accounts.length > 1 ? (
              <select
                value={connection.ad_account_id}
                onChange={(e) => handleSelectAccount(e.target.value)}
                className="text-sm font-semibold border border-zinc-200 rounded-xl px-3 py-1.5 bg-white text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
              >
                {connection.available_accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-zinc-500 font-medium">{connection.ad_account_name}</span>
            )}
          </div>

          {/* Cards de totais */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <ResumoCard icon={Wallet} cor="text-amber-600" bg="bg-amber-50" label="Gasto" valor={brl(totals.spend)} />
            <ResumoCard icon={Eye} cor="text-sky-600" bg="bg-sky-50" label="Alcance" valor={num(totals.reach)} />
            <ResumoCard icon={MousePointerClick} cor="text-violet-600" bg="bg-violet-50" label="Cliques" valor={num(totals.clicks)} />
            <ResumoCard icon={Target} cor="text-emerald-600" bg="bg-emerald-50" label="Resultados" valor={num(totals.results)} />
          </div>

          {/* Erro das campanhas */}
          {insightsError && (
            <div className="mb-5 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{insightsError}</span>
            </div>
          )}

          {/* Tabela de campanhas */}
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
              <TrendingUp size={16} className="text-amber-500" />
              <p className="text-sm font-bold text-zinc-800">Campanhas</p>
              <span className="text-xs text-zinc-400">({campaigns.length})</span>
            </div>

            {insightsLoading ? (
              <div className="flex items-center justify-center py-16 text-zinc-400">
                <Loader2 size={22} className="animate-spin text-amber-500" />
              </div>
            ) : campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
                <Megaphone size={28} className="mb-2 opacity-40" />
                <p className="text-sm font-semibold">Nenhuma campanha no período</p>
                <p className="text-xs">Tente outro período acima.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
                      <th className="px-4 py-2.5 font-bold">Campanha</th>
                      <th className="px-4 py-2.5 font-bold text-right">Gasto</th>
                      <th className="px-4 py-2.5 font-bold text-right">Alcance</th>
                      <th className="px-4 py-2.5 font-bold text-right">Cliques</th>
                      <th className="px-4 py-2.5 font-bold text-right">CPC</th>
                      <th className="px-4 py-2.5 font-bold text-right">Resultados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c, i) => (
                      <tr key={i} className="border-b border-zinc-50 hover:bg-zinc-50/60">
                        <td className="px-4 py-3 font-semibold text-zinc-800 max-w-[220px] truncate">{c.campaign}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{brl(c.spend)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{num(c.reach)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{num(c.clicks)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{brl(c.cpc)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">{num(sumResults(c.results))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-componente ──────────────────────────────────────────────────────────
function ResumoCard({
  icon: Icon, cor, bg, label, valor,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  cor: string;
  bg: string;
  label: string;
  valor: string;
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4">
      <div className={`w-9 h-9 flex items-center justify-center rounded-xl ${bg} mb-3`}>
        <Icon size={17} className={cor} />
      </div>
      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-black text-zinc-900 tabular-nums mt-0.5">{valor}</p>
    </div>
  );
}
