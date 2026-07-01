import { useState, useEffect, useCallback, useMemo } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  Megaphone, RefreshCw, Link2Off, AlertTriangle, Loader2,
  TrendingUp, Eye, MousePointerClick, Target, Wallet,
  Users, Percent, DollarSign, Gauge, BarChart3, Layers,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface AdAccount { id: string; name: string }
interface ActionVal { type: string; value: number }

interface CampaignRow {
  campaign: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  link_clicks: number;
  cpc: number;
  ctr: number;
  cpm: number;
  results: ActionVal[];
}

interface DailyRow {
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  results: number;
}

interface Connection {
  ad_account_id: string | null;
  ad_account_name: string | null;
  available_accounts: AdAccount[];
  token_expires_at: string | null;
  connected_by_name?: string | null;
}

interface InsightsResponse {
  ok: boolean;
  not_connected?: boolean;
  no_account?: boolean;
  ad_account_name?: string;
  count?: number;
  campaigns?: CampaignRow[];
  daily?: DailyRow[];
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

const OAUTH_STATE_KEY = 'meta_oauth_state';

// Traduções amigáveis para os tipos de resultado da Meta
const ACTION_LABELS: Record<string, string> = {
  link_click: 'Cliques no link',
  landing_page_view: 'Visitas à página',
  post_engagement: 'Engajamento',
  page_engagement: 'Engaj. da página',
  post_reaction: 'Reações',
  post: 'Compartilhamentos',
  comment: 'Comentários',
  like: 'Curtidas na página',
  video_view: 'Views de vídeo',
  'onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas',
  'onsite_conversion.messaging_first_reply': 'Primeiras respostas',
  'onsite_conversion.post_save': 'Salvamentos',
  lead: 'Leads',
  purchase: 'Compras',
  'offsite_conversion.fb_pixel_purchase': 'Compras (site)',
  'offsite_conversion.fb_pixel_lead': 'Leads (site)',
  'offsite_conversion.fb_pixel_add_to_cart': 'Add. ao carrinho',
  add_to_cart: 'Add. ao carrinho',
  initiate_checkout: 'Início de checkout',
};
const actionLabel = (t: string) => ACTION_LABELS[t] ?? t.replace(/_/g, ' ').replace(/\./g, ' ');

// ─── Helpers de formatação ────────────────────────────────────────────────────
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n: number) => Math.round(Number(n || 0)).toLocaleString('pt-BR');
const dec = (n: number, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => `${dec(n, 2)}%`;
const sumResults = (r: ActionVal[]) => (r || []).reduce((s, x) => s + (x.value || 0), 0);
const shortDate = (d: string) => {
  const p = (d || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}` : d;
};
const compact = (n: number) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1).replace('.0', '')}k`;
  return String(Math.round(v));
};

const CORES = { spend: '#f59e0b', results: '#10b981', reach: '#0ea5e9', clicks: '#8b5cf6' };

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

  // ── Ao montar: trata retorno do OAuth (fallback redirect) ou carrega status ──
  useEffect(() => {
    if (!tenantId) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const returnedState = params.get('state');
    const oauthError = params.get('error_description') || params.get('error');

    if (code || oauthError) {
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

  // ── Inicia o login do Facebook (popup) ──
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
    // Login clássico (scope=ads_read) lista as contas pelo acesso PESSOAL do usuário,
    // não por portfólio — assim contas de outros negócios (ex.: Vila Leste) aparecem.
    // (O config_id do "Login para Empresas" filtrava por portfólio e escondia essas contas.)
    const grant = 'scope=ads_read';
    void data.config_id;
    const url =
      `https://www.facebook.com/v20.0/dialog/oauth?client_id=${data.app_id}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&${grant}&response_type=code&state=${state}`;

    const w = 600, h = 750;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open(url, 'meta_oauth', `width=${w},height=${h},left=${left},top=${top}`);

    if (!popup) {
      sessionStorage.setItem(OAUTH_STATE_KEY, state);
      window.location.href = url;
      return;
    }

    let timer = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'meta_oauth') return;
      window.removeEventListener('message', onMessage);
      window.clearInterval(timer);
      try { popup.close(); } catch { /* ignora */ }
      setConnecting(false);
      if (event.data.error) {
        setError(`Conexão cancelada na Meta: ${event.data.error}`);
        return;
      }
      if (event.data.state !== state) {
        setError('Falha na verificação de segurança. Tente conectar novamente.');
        return;
      }
      handleExchange(event.data.code as string);
    };
    window.addEventListener('message', onMessage);

    timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        window.removeEventListener('message', onMessage);
        setConnecting(false);
      }
    }, 800);
  }, [handleExchange]);

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

  // ── Dados derivados ──
  const campaigns = useMemo(() => insights?.campaigns ?? [], [insights]);
  const daily = useMemo(() => insights?.daily ?? [], [insights]);

  const totals = useMemo(() => {
    const spend = campaigns.reduce((s, c) => s + c.spend, 0);
    const impressions = campaigns.reduce((s, c) => s + c.impressions, 0);
    const reach = campaigns.reduce((s, c) => s + c.reach, 0);
    const clicks = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
    const linkClicks = campaigns.reduce((s, c) => s + (c.link_clicks || 0), 0);
    const results = campaigns.reduce((s, c) => s + sumResults(c.results), 0);
    return {
      spend, impressions, reach, clicks, linkClicks, results,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      cpc: clicks ? spend / clicks : 0,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      freq: reach ? impressions / reach : 0,
      cpr: results ? spend / results : 0,
    };
  }, [campaigns]);

  const actionBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    campaigns.forEach((c) => c.results.forEach((r) => map.set(r.type, (map.get(r.type) ?? 0) + r.value)));
    return Array.from(map, ([type, value]) => ({ label: actionLabel(type), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
  }, [campaigns]);

  const rankCampaigns = useMemo(
    () => [...campaigns].map((c) => ({ ...c, total: sumResults(c.results) })).sort((a, b) => b.spend - a.spend),
    [campaigns],
  );

  const funil = useMemo(() => {
    const max = Math.max(totals.impressions, 1);
    return [
      { label: 'Impressões', value: totals.impressions, cor: '#6366f1' },
      { label: 'Alcance', value: totals.reach, cor: CORES.reach },
      { label: 'Cliques', value: totals.clicks, cor: CORES.clicks },
      { label: 'Resultados', value: totals.results, cor: CORES.results },
    ].map((f) => ({ ...f, pct: (f.value / max) * 100 }));
  }, [totals]);

  const temGrafico = daily.length > 0;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
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
          {/* Conta conectada + seletor */}
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
            {connection.connected_by_name && (
              <span className="text-zinc-400">· por {connection.connected_by_name}</span>
            )}
          </div>

          {insightsError && (
            <div className="mb-5 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{insightsError}</span>
            </div>
          )}

          {insightsLoading && !insights ? (
            <div className="flex items-center justify-center py-24 text-zinc-400">
              <Loader2 size={24} className="animate-spin text-amber-500" />
            </div>
          ) : (
            <div className={insightsLoading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
              {/* KPIs principais */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <KpiCard icon={Wallet} cor="amber" label="Investimento" valor={brl(totals.spend)}
                  sub={`CPM ${brl(totals.cpm)}`} />
                <KpiCard icon={Users} cor="sky" label="Alcance" valor={num(totals.reach)}
                  sub={`Frequência ${dec(totals.freq, 2)}x`} />
                <KpiCard icon={MousePointerClick} cor="violet" label="Cliques no link" valor={num(totals.linkClicks || totals.clicks)}
                  sub={`CTR ${pct(totals.ctr)}`} />
                <KpiCard icon={Target} cor="emerald" label="Resultados" valor={num(totals.results)}
                  sub={totals.cpr ? `Custo/result. ${brl(totals.cpr)}` : '—'} />
              </div>

              {/* Métricas secundárias */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6">
                <Pill icon={Eye} label="Impressões" valor={num(totals.impressions)} />
                <Pill icon={MousePointerClick} label="Cliques totais" valor={num(totals.clicks)} />
                <Pill icon={DollarSign} label="CPC" valor={brl(totals.cpc)} />
                <Pill icon={DollarSign} label="CPM" valor={brl(totals.cpm)} />
                <Pill icon={Percent} label="CTR" valor={pct(totals.ctr)} />
                <Pill icon={Gauge} label="Frequência" valor={`${dec(totals.freq, 2)}x`} />
              </div>

              {/* Gráfico principal: Investimento x Resultados por dia */}
              <ChartCard icon={TrendingUp} titulo="Evolução — Investimento e Resultados por dia" className="mb-4">
                {temGrafico ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={daily} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CORES.spend} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={CORES.spend} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="l" tickFormatter={(v) => `R$${compact(v)}`} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={54} />
                      <YAxis yAxisId="r" orientation="right" tickFormatter={compact} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={40} />
                      <Tooltip content={<GraphTooltip fmt={{ spend: brl, results: num }} />} />
                      <Area yAxisId="l" type="monotone" dataKey="spend" name="Investimento" stroke={CORES.spend} strokeWidth={2} fill="url(#gSpend)" />
                      <Line yAxisId="r" type="monotone" dataKey="results" name="Resultados" stroke={CORES.results} strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <SemDados />}
              </ChartCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                {/* Cliques e Alcance por dia */}
                <ChartCard icon={BarChart3} titulo="Cliques e Alcance por dia">
                  {temGrafico ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={daily} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="l" tickFormatter={compact} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={40} />
                        <YAxis yAxisId="r" orientation="right" tickFormatter={compact} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={40} />
                        <Tooltip content={<GraphTooltip fmt={{ clicks: num, reach: num }} />} />
                        <Bar yAxisId="l" dataKey="clicks" name="Cliques" fill={CORES.clicks} radius={[3, 3, 0, 0]} maxBarSize={26} />
                        <Line yAxisId="r" type="monotone" dataKey="reach" name="Alcance" stroke={CORES.reach} strokeWidth={2.5} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <SemDados />}
                </ChartCard>

                {/* Funil */}
                <ChartCard icon={Layers} titulo="Funil de desempenho">
                  <div className="flex flex-col justify-center gap-3 py-2 h-[220px]">
                    {funil.map((f) => (
                      <div key={f.label}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-zinc-600">{f.label}</span>
                          <span className="font-black text-zinc-800 tabular-nums">{num(f.value)}</span>
                        </div>
                        <div className="h-3 rounded-full bg-zinc-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(f.pct, 2)}%`, background: f.cor }} />
                        </div>
                      </div>
                    ))}
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Do total de impressões, quantas viraram alcance, cliques e resultados.
                    </p>
                  </div>
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                {/* Investimento por campanha */}
                <ChartCard icon={BarChart3} titulo="Investimento por campanha">
                  {rankCampaigns.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(180, rankCampaigns.length * 42)}>
                      <BarChart data={rankCampaigns.slice(0, 6)} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                        <XAxis type="number" tickFormatter={(v) => `R$${compact(v)}`} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="campaign" width={110} tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false}
                          tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
                        <Tooltip content={<GraphTooltip fmt={{ spend: brl }} />} cursor={{ fill: '#faf5ff' }} />
                        <Bar dataKey="spend" name="Investimento" fill={CORES.spend} radius={[0, 4, 4, 0]} maxBarSize={22} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <SemDados />}
                </ChartCard>

                {/* Resultados por tipo */}
                <ChartCard icon={Target} titulo="Resultados por tipo">
                  {actionBreakdown.length > 0 ? (
                    <div className="flex flex-col gap-2.5 py-1">
                      {actionBreakdown.map((a) => {
                        const max = actionBreakdown[0].value || 1;
                        return (
                          <div key={a.label}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-semibold text-zinc-600 truncate pr-2">{a.label}</span>
                              <span className="font-black text-zinc-800 tabular-nums">{num(a.value)}</span>
                            </div>
                            <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max((a.value / max) * 100, 2)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : <SemDados />}
                </ChartCard>
              </div>

              {/* Tabela de campanhas */}
              <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
                  <TrendingUp size={16} className="text-amber-500" />
                  <p className="text-sm font-bold text-zinc-800">Campanhas</p>
                  <span className="text-xs text-zinc-400">({rankCampaigns.length})</span>
                </div>

                {rankCampaigns.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
                    <Megaphone size={28} className="mb-2 opacity-40" />
                    <p className="text-sm font-semibold">Nenhuma campanha no período</p>
                    <p className="text-xs">Tente outro período acima.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100 bg-zinc-50/60">
                          <th className="px-4 py-2.5 font-bold sticky left-0 bg-zinc-50/60">Campanha</th>
                          <th className="px-3 py-2.5 font-bold text-right">Investido</th>
                          <th className="px-3 py-2.5 font-bold text-right">Impressões</th>
                          <th className="px-3 py-2.5 font-bold text-right">Alcance</th>
                          <th className="px-3 py-2.5 font-bold text-right">Freq.</th>
                          <th className="px-3 py-2.5 font-bold text-right">Cliques</th>
                          <th className="px-3 py-2.5 font-bold text-right">CTR</th>
                          <th className="px-3 py-2.5 font-bold text-right">CPC</th>
                          <th className="px-3 py-2.5 font-bold text-right">CPM</th>
                          <th className="px-3 py-2.5 font-bold text-right">Result.</th>
                          <th className="px-4 py-2.5 font-bold text-right">Custo/res.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankCampaigns.map((c, i) => {
                          const cpr = c.total ? c.spend / c.total : 0;
                          return (
                            <tr key={i} className="border-b border-zinc-50 hover:bg-amber-50/40">
                              <td className="px-4 py-3 font-semibold text-zinc-800 max-w-[220px] truncate sticky left-0 bg-white">{c.campaign}</td>
                              <td className="px-3 py-3 text-right tabular-nums font-semibold text-zinc-800">{brl(c.spend)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-zinc-600">{num(c.impressions)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-zinc-600">{num(c.reach)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-zinc-500">{dec(c.frequency, 2)}x</td>
                              <td className="px-3 py-3 text-right tabular-nums text-zinc-600">{num(c.clicks)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-zinc-500">{pct(c.ctr)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-zinc-600">{brl(c.cpc)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-zinc-500">{brl(c.cpm)}</td>
                              <td className="px-3 py-3 text-right tabular-nums font-semibold text-emerald-600">{num(c.total)}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{cpr ? brl(cpr) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {rankCampaigns.length > 1 && (
                        <tfoot>
                          <tr className="border-t border-zinc-200 bg-zinc-50/60 font-bold text-zinc-800">
                            <td className="px-4 py-3 sticky left-0 bg-zinc-50/60">Total</td>
                            <td className="px-3 py-3 text-right tabular-nums">{brl(totals.spend)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{num(totals.impressions)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{num(totals.reach)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{dec(totals.freq, 2)}x</td>
                            <td className="px-3 py-3 text-right tabular-nums">{num(totals.clicks)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{pct(totals.ctr)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{brl(totals.cpc)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{brl(totals.cpm)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{num(totals.results)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{totals.cpr ? brl(totals.cpr) : '—'}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────
const CORES_KPI: Record<string, { bg: string; text: string }> = {
  amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-600' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
};

function KpiCard({
  icon: Icon, cor, label, valor, sub,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  cor: keyof typeof CORES_KPI | string;
  label: string;
  valor: string;
  sub?: string;
}) {
  const c = CORES_KPI[cor] ?? CORES_KPI.amber;
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 flex items-center justify-center rounded-xl ${c.bg}`}>
          <Icon size={17} className={c.text} />
        </div>
      </div>
      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-black text-zinc-900 tabular-nums mt-0.5">{valor}</p>
      {sub && <p className="text-[11px] text-zinc-400 font-semibold mt-1">{sub}</p>}
    </div>
  );
}

function Pill({
  icon: Icon, label, valor,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  valor: string;
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl px-3 py-2 flex items-center gap-2.5">
      <Icon size={15} className="text-zinc-300 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide leading-none">{label}</p>
        <p className="text-sm font-black text-zinc-800 tabular-nums mt-0.5 truncate">{valor}</p>
      </div>
    </div>
  );
}

function ChartCard({
  icon: Icon, titulo, children, className = '',
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-zinc-200 rounded-2xl p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className="text-amber-500" />
        <p className="text-sm font-bold text-zinc-800">{titulo}</p>
      </div>
      {children}
    </div>
  );
}

function SemDados() {
  return (
    <div className="flex flex-col items-center justify-center h-[200px] text-zinc-300">
      <BarChart3 size={26} className="mb-2" />
      <p className="text-xs font-semibold text-zinc-400">Sem dados no período</p>
    </div>
  );
}

interface TooltipPayload { name: string; dataKey: string; value: number; color: string }
function GraphTooltip({
  active, payload, label, fmt,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  fmt?: Record<string, (n: number) => string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      {label && <p className="font-bold text-zinc-700 mb-1">{shortDate(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 text-zinc-600">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-bold text-zinc-800">{fmt?.[p.dataKey] ? fmt[p.dataKey](p.value) : num(p.value)}</span>
        </p>
      ))}
    </div>
  );
}
