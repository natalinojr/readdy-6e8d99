import { useState, useEffect, useCallback, useMemo } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  Megaphone, RefreshCw, Link2Off, AlertTriangle, Loader2,
  TrendingUp, Eye, MousePointerClick, Target, Wallet,
  Users, Percent, DollarSign, Gauge, BarChart3, Layers,
  ShoppingCart, Banknote, Store, Share2, Copy, Check, Trash2, X, Lock,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface AdAccount { id: string; name: string }
interface ActionVal { type: string; value: number }
interface ResultVal { type: string; value: number }

// Métricas comuns (campanha e anúncio). Compra/funil/status vêm da Edge Function atualizada;
// ficam opcionais pra tela não quebrar enquanto a função antiga ainda estiver no ar.
interface MetricRow {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  link_clicks: number;
  cpc: number;
  ctr: number;
  cpm: number;
  // CTR/CPC sobre cliques no LINK — critério do Gerenciador de Anúncios e do Reportei.
  // `ctr`/`cpc` acima são sobre TODOS os cliques (curtida, comentário, clique no perfil).
  link_ctr?: number;
  cost_per_link_click?: number;
  results: ActionVal[];
  result?: ResultVal;
  purchases?: number;
  purchase_value?: number;
  roas?: number;
  cost_per_purchase?: number;
  landing_page_views?: number;
  view_content?: number;
  add_to_cart?: number;
  initiate_checkout?: number;
  status?: string | null;
}

interface CampaignRow extends MetricRow {
  campaign: string;
  campaign_id?: string;
  objective?: string | null;
}

interface AdRow extends MetricRow {
  ad_id: string;
  ad: string;
  adset: string;
  campaign: string;
  campaign_id?: string;
  optimization_goal?: string | null;
  thumbnail_url?: string | null;
}

interface DailyRow {
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  results: number;
  link_clicks?: number;
  purchases?: number;
  purchase_value?: number;
}

interface ErposOrders {
  count: number;
  revenue: number;
  by_source: Record<string, { count: number; revenue: number }>;
  since: string;
  until: string;
  total_count?: number;
  total_revenue?: number;
  hourly?: number[];
}

interface SlimRow {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  purchases: number;
  purchase_value: number;
  roas: number;
  cost_per_purchase: number;
  cpc: number;
  ctr: number;
  link_ctr?: number;
  cost_per_link_click?: number;
  frequency?: number;
  cpm?: number;
}
interface PlacementRow extends SlimRow { platform: string; position: string }
interface AgeGenderRow extends SlimRow { age: string; gender: string }
interface HourRow extends SlimRow { hour: number }

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
  // Totais no nível da conta: única fonte correta de alcance/frequência (deduplicados por
  // consulta — somar campanhas infla o alcance e subestima a frequência).
  totals?: MetricRow | null;
  campaigns?: CampaignRow[];
  ads?: AdRow[];
  daily?: DailyRow[];
  erpos_orders?: ErposOrders | null;
  range?: { since: string; until: string } | null;
  previous?: (SlimRow & { since: string; until: string }) | null;
  breakdowns?: { placement: PlacementRow[]; age_gender: AgeGenderRow[]; hourly: HourRow[] } | null;
  // Só no link público: cabeçalho de leitura + motivo quando o link não vale mais.
  share?: { store_name: string | null; label: string | null; created_by_name: string | null; expires_at: string | null } | null;
  share_invalid?: boolean;
  share_revoked?: boolean;
  share_expired?: boolean;
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
  { value: 'custom', label: 'Personalizado…' },
];

// Data de hoje (ou deslocada) no fuso da loja, formato YYYY-MM-DD — pros inputs de data.
const brDate = (offsetDays = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
};
const MAX_DIAS_PERSONALIZADO = 366;

// ─── Link público (somente leitura) ──────────────────────────────────────────
// A mesma tela atende /trafego-pago (com login) e /relatorio/<token> (sem login).
// Lê o token do pathname, e não dos params do router, pelo mesmo motivo do
// delivery: com basePath os params podem não resolver.
function getShareTokenFromUrl(): string | null {
  try {
    const basePath = (typeof __BASE_PATH__ !== 'undefined' ? __BASE_PATH__ : '').replace(/\/$/, '');
    const path = window.location.pathname;
    const clean = basePath ? path.replace(basePath, '') : path;
    const m = clean.match(/\/relatorio\/([a-f0-9]{32,64})\/?$/i);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  date_preset: string | null;
  range_since: string | null;
  range_until: string | null;
  include_erpos_orders: boolean;
  created_at: string;
  created_by_name: string | null;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
}

const periodoDoLink = (s: Pick<ShareLink, 'date_preset' | 'range_since' | 'range_until'>): string =>
  (s.range_since && s.range_until
    ? `${s.range_since.split('-').reverse().join('/')} a ${s.range_until.split('-').reverse().join('/')}`
    : (PERIODOS.find((p) => p.value === s.date_preset)?.label ?? s.date_preset ?? '—'));

const shareUrl = (token: string): string => `${window.location.origin}/relatorio/${token}`;

const OAUTH_STATE_KEY = 'meta_oauth_state';

// Traduções amigáveis para os tipos de resultado da Meta
const ACTION_LABELS: Record<string, string> = {
  purchase: 'Compras',
  add_to_cart: 'Add. ao carrinho',
  initiate_checkout: 'Início de checkout',
  view_content: 'Visualiz. de produto',
  landing_page_view: 'Visitas à página',
  link_click: 'Cliques no link',
  lead: 'Leads',
  'onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas',
  'onsite_conversion.messaging_first_reply': 'Primeiras respostas',
  post_engagement: 'Engajamento',
  page_engagement: 'Engaj. da página',
  post_reaction: 'Reações',
  post: 'Compartilhamentos',
  comment: 'Comentários',
  like: 'Curtidas na página',
  video_view: 'Views de vídeo',
  'onsite_conversion.post_save': 'Salvamentos',
  reach: 'Alcance',
  omni_app_install: 'Instalações',
  'offsite_conversion.fb_pixel_purchase': 'Compras (site)',
  'offsite_conversion.fb_pixel_lead': 'Leads (site)',
  'offsite_conversion.fb_pixel_add_to_cart': 'Add. ao carrinho (site)',
};
const actionLabel = (t: string) => ACTION_LABELS[t] ?? t.replace(/_/g, ' ').replace(/\./g, ' ');

// Só tipos "canônicos" entram no card "Resultados por tipo": a Meta repete o mesmo evento em vários
// recortes (omni_*, offsite_conversion.*) e somar tudo conta em dobro.
const BREAKDOWN_TYPES = [
  'purchase', 'initiate_checkout', 'add_to_cart', 'view_content', 'landing_page_view', 'link_click',
  'lead', 'onsite_conversion.messaging_conversation_started_7d', 'post_engagement', 'video_view',
  'post_reaction', 'comment', 'post', 'onsite_conversion.post_save', 'like',
];

const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: 'Vendas', CONVERSIONS: 'Vendas', PRODUCT_CATALOG_SALES: 'Catálogo',
  OUTCOME_TRAFFIC: 'Tráfego', LINK_CLICKS: 'Tráfego',
  OUTCOME_ENGAGEMENT: 'Engajamento', POST_ENGAGEMENT: 'Engajamento', MESSAGES: 'Mensagens', VIDEO_VIEWS: 'Vídeo',
  OUTCOME_LEADS: 'Leads', LEAD_GENERATION: 'Leads',
  OUTCOME_AWARENESS: 'Reconhecimento', REACH: 'Alcance', BRAND_AWARENESS: 'Reconhecimento',
  OUTCOME_APP_PROMOTION: 'App', APP_INSTALLS: 'App',
};
const objectiveLabel = (o?: string | null) =>
  (o ? (OBJECTIVE_LABELS[o] ?? o.replace(/^OUTCOME_/, '').toLowerCase()) : '—');

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Ativo', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PAUSED: { label: 'Pausado', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  CAMPAIGN_PAUSED: { label: 'Camp. pausada', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  ADSET_PAUSED: { label: 'Conj. pausado', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  ARCHIVED: { label: 'Arquivado', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  DELETED: { label: 'Excluído', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  IN_PROCESS: { label: 'Processando', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PENDING_REVIEW: { label: 'Em análise', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PREAPPROVED: { label: 'Pré-aprovado', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  WITH_ISSUES: { label: 'Com problemas', cls: 'bg-red-50 text-red-600 border-red-200' },
  DISAPPROVED: { label: 'Reprovado', cls: 'bg-red-50 text-red-600 border-red-200' },
  PENDING_BILLING_INFO: { label: 'Cobrança pendente', cls: 'bg-red-50 text-red-600 border-red-200' },
};

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', audience_network: 'Audience Network',
  messenger: 'Messenger', threads: 'Threads', unknown: 'Outro',
};
const POSITION_LABELS: Record<string, string> = {
  feed: 'Feed', instagram_stories: 'Stories', facebook_stories: 'Stories', messenger_stories: 'Stories',
  instagram_reels: 'Reels', facebook_reels: 'Reels', facebook_reels_overlay: 'Reels (overlay)', ads_on_reels: 'Anúncio em Reels',
  instagram_explore: 'Explorar', instagram_explore_grid_home: 'Explorar', instagram_profile_feed: 'Perfil',
  instagram_search: 'Busca', search: 'Busca', video_feeds: 'Feed de vídeos', marketplace: 'Marketplace',
  right_hand_column: 'Coluna direita', instream_video: 'Vídeo in-stream', messenger_inbox: 'Inbox',
  an_classic: 'Banner', rewarded_video: 'Vídeo premiado', unknown: 'Outro',
};
const GENDER_LABELS: Record<string, string> = { male: 'Homens', female: 'Mulheres', unknown: 'Não inf.' };
const placementLabel = (p: PlacementRow) =>
  `${PLATFORM_LABELS[p.platform] ?? p.platform} · ${POSITION_LABELS[p.position] ?? p.position.replace(/_/g, ' ')}`;

// ─── Helpers de formatação ────────────────────────────────────────────────────
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n: number) => Math.round(Number(n || 0)).toLocaleString('pt-BR');
const dec = (n: number, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => `${dec(n, 2)}%`;
const n0 = (v: number | undefined | null) => Number(v || 0);
// "Resultado" no padrão do Gerenciador de Anúncios (calculado na Edge Function pelo objetivo/meta de
// otimização). Fallback pra função antiga, que não manda `result`: cliques no link.
const resultOf = (r: { result?: ResultVal; results: ActionVal[] }): ResultVal =>
  r.result ?? { type: 'link_click', value: (r.results || []).find((x) => x.type === 'link_click')?.value ?? 0 };

// CTR e CPC sobre cliques no LINK (o que o Gerenciador de Anúncios e o Reportei mostram).
// Usa o valor que a Meta já calcula; sem ele (função antiga), calcula pelos cliques no link.
type CliqueLike = {
  link_ctr?: number; cost_per_link_click?: number;
  impressions: number; link_clicks?: number; clicks?: number; spend: number;
};
const linkCtr = (r: CliqueLike): number =>
  r.link_ctr ?? (r.impressions ? (n0(r.link_clicks) / r.impressions) * 100 : 0);
const linkCpc = (r: CliqueLike): number =>
  r.cost_per_link_click ?? (n0(r.link_clicks) ? r.spend / n0(r.link_clicks) : 0);
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

const CORES = { spend: '#f59e0b', results: '#10b981', reach: '#0ea5e9', clicks: '#8b5cf6', receita: '#14b8a6', compras: '#16a34a' };

export default function TrafegoPagoPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  // Modo público: /relatorio/<token>. Sem login, sem nenhuma ação de escrita.
  const shareToken = useMemo(() => getShareTokenFromUrl(), []);
  const publico = !!shareToken;
  const [shareOpen, setShareOpen] = useState(false);

  const [loadingStatus, setLoadingStatus] = useState(!shareToken);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [datePreset, setDatePreset] = useState('last_30d');
  // Período personalizado: os inputs editam since/until; só busca quando o usuário clica em Aplicar.
  const [customSince, setCustomSince] = useState(brDate(-6));
  const [customUntil, setCustomUntil] = useState(brDate(0));
  const [customApplied, setCustomApplied] = useState<{ since: string; until: string } | null>(null);
  const [customErro, setCustomErro] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [campanhaSel, setCampanhaSel] = useState<string | null>(null);

  // ── Status da conexão ──
  const loadStatus = useCallback(async () => {
    if (!tenantId || publico) return;
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
    if (publico || !tenantId) return;
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
    // Modo público: chamada sem sessão, mandando só o token. A loja e o período
    // saem da linha do banco — nada do que for enviado daqui os define.
    if (publico) {
      setInsightsLoading(true);
      setInsightsError(null);
      try {
        const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
        const res = await fetch(`${base}/functions/v1/meta-ads-insights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ share_token: shareToken }),
        });
        const data = (await res.json()) as InsightsResponse;
        if (!data?.ok) {
          setInsightsError(typeof data?.error === 'string' ? data.error : 'Não foi possível abrir este relatório.');
          setInsights(data ?? null);
        } else {
          setInsights(data);
        }
      } catch {
        setInsightsError('Erro de conexão. Recarregue a página.');
      }
      setInsightsLoading(false);
      return;
    }

    if (!tenantId || !connection?.ad_account_id) return;
    if (datePreset === 'custom' && !customApplied) return; // espera o "Aplicar"
    setInsightsLoading(true);
    setInsightsError(null);
    const { data, error: err } = await invokeWithAuth<InsightsResponse>('meta-ads-insights', {
      body: {
        tenant_id: tenantId,
        date_preset: datePreset,
        ...(datePreset === 'custom' && customApplied ? { time_range: customApplied } : {}),
      },
    });
    if (err) {
      setInsightsError(err.message);
    } else if (data && !data.ok) {
      setInsightsError(typeof data.error === 'string' ? data.error : 'Erro ao buscar as campanhas.');
    } else {
      setInsights(data ?? null);
    }
    setInsightsLoading(false);
  }, [tenantId, connection?.ad_account_id, datePreset, customApplied, publico, shareToken]);

  useEffect(() => {
    if (publico || connection?.ad_account_id) loadInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publico, connection?.ad_account_id, datePreset, customApplied]);

  // Valida e aplica o período personalizado (de ≤ até, até ≤ hoje, no máximo 366 dias).
  const aplicarPersonalizado = useCallback(() => {
    const hoje = brDate(0);
    if (!customSince || !customUntil) { setCustomErro('Informe as duas datas.'); return; }
    if (customSince > customUntil) { setCustomErro('A data inicial não pode ser depois da final.'); return; }
    if (customUntil > hoje) { setCustomErro('A data final não pode ser no futuro.'); return; }
    const dias = Math.round((Date.parse(`${customUntil}T00:00:00Z`) - Date.parse(`${customSince}T00:00:00Z`)) / 86400000) + 1;
    if (dias > MAX_DIAS_PERSONALIZADO) { setCustomErro(`Período máximo de ${MAX_DIAS_PERSONALIZADO} dias.`); return; }
    setCustomErro(null);
    setCustomApplied({ since: customSince, until: customUntil });
  }, [customSince, customUntil]);

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
    // "Login do Facebook para Empresas" (config_id) sempre que estiver configurado: app do
    // tipo Empresa só aceita esse login — com o login clássico (scope=ads_read) a Meta
    // responde "Recurso indisponível / O Login do Facebook está indisponível para este app".
    // No diálogo o usuário escolhe o portfólio + contas de anúncio que libera; como a conexão
    // é uma por loja, cada loja conecta com o portfólio dela (Vila Leste incluída).
    // `override_default_response_type` garante `code` mesmo se a configuração pedir token.
    // Sem config_id (secret META_LOGIN_CONFIG_ID ausente), cai no login clássico.
    const grant = data.config_id
      ? `config_id=${encodeURIComponent(data.config_id)}&override_default_response_type=true`
      : 'scope=ads_read';
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
  const ads = useMemo(() => insights?.ads ?? null, [insights]);
  const daily = useMemo(() => insights?.daily ?? [], [insights]);
  const erposOrders = insights?.erpos_orders ?? null;

  const totals = useMemo(() => {
    const sum = (f: (c: CampaignRow) => number) => campaigns.reduce((s, c) => s + f(c), 0);
    // Preferimos SEMPRE os totais do nível da conta. Alcance é deduplicado por consulta: somar o
    // alcance das campanhas conta a mesma pessoa mais de uma vez, infla o total e subestima a
    // frequência. Somar só é correto para métricas aditivas (gasto, impressões, cliques, compras).
    const a = insights?.totals ?? null;
    const spend = a ? a.spend : sum((c) => c.spend);
    const impressions = a ? a.impressions : sum((c) => c.impressions);
    const reach = a ? a.reach : sum((c) => c.reach);
    const clicks = a ? a.clicks : sum((c) => c.clicks || 0);
    const linkClicks = a ? a.link_clicks : sum((c) => c.link_clicks || 0);
    const purchases = a ? n0(a.purchases) : sum((c) => n0(c.purchases));
    const purchaseValue = a ? n0(a.purchase_value) : sum((c) => n0(c.purchase_value));
    // "Resultado" depende do objetivo de CADA campanha — só faz sentido somando as campanhas.
    const results = sum((c) => resultOf(c).value);
    return {
      spend, impressions, reach, clicks, linkClicks, results, purchases, purchaseValue,
      reachExato: !!a,
      landing: a ? n0(a.landing_page_views) : sum((c) => n0(c.landing_page_views)),
      addToCart: a ? n0(a.add_to_cart) : sum((c) => n0(c.add_to_cart)),
      checkout: a ? n0(a.initiate_checkout) : sum((c) => n0(c.initiate_checkout)),
      roas: spend ? purchaseValue / spend : 0,
      cpp: purchases ? spend / purchases : 0,
      ticket: purchases ? purchaseValue / purchases : 0,
      // CTR/CPC sobre cliques no LINK. Os de todos os cliques ficam ao lado, pra referência.
      ctr: a ? linkCtr(a) : (impressions ? (linkClicks / impressions) * 100 : 0),
      cpc: a ? linkCpc(a) : (linkClicks ? spend / linkClicks : 0),
      ctrTotal: impressions ? (clicks / impressions) * 100 : 0,
      cpcTotal: clicks ? spend / clicks : 0,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      freq: a?.frequency ? a.frequency : (reach ? impressions / reach : 0),
      cpr: results ? spend / results : 0,
    };
  }, [campaigns, insights]);

  // Mix de tipos de resultado (ex.: "3 Compras · 120 Cliques no link") pro subtítulo do KPI.
  const resultMix = useMemo(() => {
    const map = new Map<string, number>();
    campaigns.forEach((c) => { const r = resultOf(c); map.set(r.type, (map.get(r.type) ?? 0) + r.value); });
    return Array.from(map, ([type, value]) => ({ type, value }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [campaigns]);

  const actionBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    campaigns.forEach((c) => c.results.forEach((r) => {
      if (BREAKDOWN_TYPES.includes(r.type)) map.set(r.type, (map.get(r.type) ?? 0) + r.value);
    }));
    return Array.from(map, ([type, value]) => ({ label: actionLabel(type), value, destaque: type === 'purchase' }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [campaigns]);

  const rankCampaigns = useMemo(
    () => [...campaigns].map((c) => ({ ...c, res: resultOf(c) })).sort((a, b) => b.spend - a.spend),
    [campaigns],
  );

  const rankAds = useMemo(() => {
    if (!ads) return null;
    const list = campanhaSel ? ads.filter((a) => a.campaign === campanhaSel) : ads;
    return [...list].map((a) => ({ ...a, res: resultOf(a) })).sort((a, b) => b.spend - a.spend);
  }, [ads, campanhaSel]);

  type FunilRow = { label: string; value: number; cor: string; pct: number; conv?: number | null };

  // Funil de vendas do pixel (clique → página → carrinho → checkout → compra). Sem nenhum evento de
  // pixel no período, cai no funil genérico (impressões → alcance → cliques → resultados).
  const funilVendas = useMemo<FunilRow[] | null>(() => {
    const steps = [
      { label: 'Cliques no link', value: totals.linkClicks, cor: CORES.clicks },
      { label: 'Visitas à página', value: totals.landing, cor: CORES.reach },
      { label: 'Add. ao carrinho', value: totals.addToCart, cor: CORES.spend },
      { label: 'Início de checkout', value: totals.checkout, cor: '#f97316' },
      { label: 'Compras', value: totals.purchases, cor: CORES.results },
    ];
    if (totals.landing + totals.addToCart + totals.checkout + totals.purchases === 0) return null;
    const max = Math.max(steps[0].value, 1);
    return steps.map((s, i) => ({
      ...s,
      pct: (s.value / max) * 100,
      conv: i > 0 && steps[i - 1].value > 0 ? (s.value / steps[i - 1].value) * 100 : null,
    }));
  }, [totals]);

  const funil = useMemo<FunilRow[]>(() => {
    const max = Math.max(totals.impressions, 1);
    return [
      { label: 'Impressões', value: totals.impressions, cor: '#6366f1' },
      { label: 'Alcance', value: totals.reach, cor: CORES.reach },
      { label: 'Cliques', value: totals.clicks, cor: CORES.clicks },
      { label: 'Resultados', value: totals.results, cor: CORES.results },
    ].map((f) => ({ ...f, pct: (f.value / max) * 100 }));
  }, [totals]);

  const temCompras = totals.purchases > 0 || daily.some((d) => n0(d.purchases) > 0);

  // ── Período anterior, quebras, hora do dia, alertas ──
  const previous = insights?.previous ?? null;
  const range = insights?.range ?? null;
  const diasPeriodo = range
    ? Math.round((Date.parse(`${range.until}T00:00:00Z`) - Date.parse(`${range.since}T00:00:00Z`)) / 86400000) + 1
    : null;

  const placementRows = useMemo(
    () => [...(insights?.breakdowns?.placement ?? [])].filter((p) => p.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 8),
    [insights],
  );
  const ageRows = useMemo(
    () => [...(insights?.breakdowns?.age_gender ?? [])].filter((p) => p.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 10),
    [insights],
  );

  // Compras por hora (anúncios) × pedidos do delivery por hora.
  // As duas séries têm ordens de grandeza muito diferentes (dezenas de compras contra centenas
  // ou milhares de pedidos/cliques), então cada uma ganha o SEU eixo — num eixo só, a série
  // pequena vira uma linha rente ao chão e some.
  const hourlyData = useMemo(() => {
    const adsHora = insights?.breakdowns?.hourly ?? [];
    const pedidos = erposOrders?.hourly ?? null;
    if (adsHora.length === 0 && !pedidos) return null;

    const full = Array.from({ length: 24 }, (_, h) => {
      const r = adsHora.find((x) => x.hour === h);
      return {
        hour: h,
        spend: r?.spend ?? 0,
        purchases: r?.purchases ?? 0,
        link_clicks: r?.link_clicks ?? 0,
        pedidos: pedidos?.[h] ?? 0,
      };
    });

    // Corta as horas sem nada nas pontas (madrugada) pra sobrar largura onde a loja funciona.
    const ativo = (d: typeof full[number]) => d.purchases > 0 || d.link_clicks > 0 || d.pedidos > 0;
    const first = full.findIndex(ativo);
    if (first === -1) return null;
    let last = 23;
    while (last > first && !ativo(full[last])) last -= 1;

    // Sem nenhuma compra atribuída no período, a barra vira cliques no link — senão o gráfico
    // ficaria vazio justamente quando o dado interessa.
    const temCompras = full.some((d) => d.purchases > 0);
    return { linhas: full.slice(first, last + 1), temCompras };
  }, [insights, erposOrders]);

  const alertas = useMemo(() => {
    const out: { nivel: 'alto' | 'medio'; texto: string }[] = [];
    const dias = diasPeriodo ? ` em ${diasPeriodo} dia${diasPeriodo > 1 ? 's' : ''}` : '';
    if (totals.spend > 0 && totals.purchases === 0 && campaigns.some((c) => resultOf(c).type === 'purchase')) {
      out.push({
        nivel: 'alto',
        texto: `Campanhas de venda gastaram ${brl(totals.spend)}${dias} sem nenhuma compra atribuída. Confira se o pixel está disparando Purchase (Gerenciador de Eventos → Eventos de teste).`,
      });
    }
    (ads ?? []).filter((a) => a.status === 'ACTIVE' && a.spend > 0).forEach((a) => {
      const venda = resultOf(a).type === 'purchase';
      if (venda && n0(a.purchases) === 0 && a.spend >= 20) {
        out.push({ nivel: 'alto', texto: `"${a.ad}" gastou ${brl(a.spend)}${dias} sem nenhuma compra.` });
      } else if (venda && n0(a.roas) < 1 && a.spend >= 50) {
        out.push({ nivel: 'alto', texto: `"${a.ad}": ROAS ${dec(n0(a.roas), 2)}x — vendeu ${brl(n0(a.purchase_value))} com ${brl(a.spend)} investidos.` });
      }
      if (a.frequency >= 3.5) {
        out.push({ nivel: 'medio', texto: `"${a.ad}": frequência ${dec(a.frequency, 1)}x — o mesmo público está vendo repetido; hora de trocar o criativo.` });
      }
      if (a.impressions >= 2000 && linkCtr(a) < 0.5) {
        out.push({ nivel: 'medio', texto: `"${a.ad}": CTR no link ${pct(linkCtr(a))} em ${num(a.impressions)} impressões — pouca gente clica; testar outra imagem/texto.` });
      }
    });
    return out.slice(0, 8);
  }, [ads, totals, campaigns, diasPeriodo]);

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
            <h1 className="text-xl font-black text-zinc-900 leading-tight">
              {publico ? (insights?.share?.store_name ?? 'Relatório de anúncios') : 'Tráfego Pago'}
            </h1>
            <p className="text-sm text-zinc-400">
              {publico
                ? (insights?.share?.label || 'Desempenho das campanhas da Meta')
                : 'Acompanhe suas campanhas de anúncios da Meta'}
            </p>
          </div>
        </div>

        {publico && insights?.ok && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600 font-semibold text-sm">
              <Lock size={13} />
              Somente leitura
            </span>
            {range && (
              <span className="text-sm font-semibold text-zinc-500">
                {shortDate(range.since)} a {shortDate(range.until)}
              </span>
            )}
          </div>
        )}

        {!publico && connection?.ad_account_id && (
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
            {datePreset === 'custom' && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  type="date"
                  value={customSince}
                  max={customUntil || brDate(0)}
                  onChange={(e) => setCustomSince(e.target.value)}
                  className="text-sm font-semibold border border-zinc-200 rounded-xl px-2.5 py-1.5 bg-white text-zinc-700 focus:outline-none focus:border-amber-400"
                  aria-label="Data inicial"
                />
                <span className="text-xs text-zinc-400">até</span>
                <input
                  type="date"
                  value={customUntil}
                  min={customSince}
                  max={brDate(0)}
                  onChange={(e) => setCustomUntil(e.target.value)}
                  className="text-sm font-semibold border border-zinc-200 rounded-xl px-2.5 py-1.5 bg-white text-zinc-700 focus:outline-none focus:border-amber-400"
                  aria-label="Data final"
                />
                <button
                  onClick={aplicarPersonalizado}
                  disabled={insightsLoading}
                  className="px-3 py-2 text-sm font-bold rounded-xl bg-amber-500 text-white hover:bg-amber-600 cursor-pointer disabled:opacity-50"
                >
                  Aplicar
                </button>
                {customErro && <span className="text-xs text-red-500 font-semibold">{customErro}</span>}
              </div>
            )}
            <button
              onClick={loadInsights}
              disabled={insightsLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 cursor-pointer disabled:opacity-50"
              title="Atualizar"
            >
              <RefreshCw size={14} className={insightsLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 cursor-pointer"
              title="Gerar link somente leitura para enviar a alguém"
            >
              <Share2 size={14} />
              <span className="hidden sm:inline">Compartilhar</span>
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

      {/* Carregando status / trocando token / abrindo o link público */}
      {(loadingStatus || exchanging || (publico && insightsLoading && !insights)) && (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <Loader2 size={28} className="animate-spin mb-3 text-amber-500" />
          <p className="text-sm font-semibold">{exchanging ? 'Conectando à Meta...' : 'Carregando...'}</p>
        </div>
      )}

      {/* Link público inválido, revogado ou expirado */}
      {publico && !insightsLoading && insights && !insights.ok && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-zinc-200 rounded-2xl">
          <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-zinc-100 border border-zinc-200 mb-5">
            <Lock size={28} className="text-zinc-400" />
          </div>
          <h2 className="text-lg font-black text-zinc-800 mb-1.5">
            {insights.share_revoked ? 'Link revogado'
              : insights.share_expired ? 'Link expirado'
                : 'Link inválido'}
          </h2>
          <p className="text-sm text-zinc-500 max-w-md leading-relaxed">
            {typeof insights.error === 'string' ? insights.error : 'Este link não está mais disponível.'}
            {' '}Peça um link novo a quem enviou.
          </p>
        </div>
      )}

      {/* Não conectado → botão Conectar */}
      {!publico && !loadingStatus && !exchanging && !connection?.ad_account_id && (
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

      {/* Conectado (ou link público válido) → painel */}
      {!loadingStatus && !exchanging && (publico ? !!insights?.ok : !!connection?.ad_account_id) && (
        <>
          {/* Conta conectada + seletor. Precisa ser renderização condicional, não classe
              CSS: no modo público `connection` é null e o JSX abaixo seria avaliado do
              mesmo jeito, quebrando a tela. */}
          {!publico && connection && (
            <div className="flex items-center gap-2 mb-5 flex-wrap text-sm">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Conectado
              </span>
              {connection.available_accounts.length > 1 ? (
                <select
                  value={connection.ad_account_id ?? ''}
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
          )}

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
              {previous && (
                <p className="text-[11px] text-zinc-400 mb-2">
                  Setas comparam com o período anterior ({shortDate(previous.since)} a {shortDate(previous.until)}).
                </p>
              )}

              {/* KPIs de venda */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <KpiCard icon={Wallet} cor="amber" label="Investimento" valor={brl(totals.spend)}
                  sub={`CPM ${brl(totals.cpm)} · CPC ${brl(totals.cpc)}`}
                  extra={<Delta atual={totals.spend} anterior={previous?.spend} neutro fmt={brl} />} />
                <KpiCard icon={ShoppingCart} cor="emerald" label="Compras (Meta)" valor={num(totals.purchases)}
                  sub={totals.cpp ? `Custo por compra ${brl(totals.cpp)}` : 'Nenhuma compra atribuída'}
                  extra={<Delta atual={totals.purchases} anterior={previous?.purchases} fmt={num} />} />
                <KpiCard icon={Banknote} cor="teal" label="Valor em vendas" valor={brl(totals.purchaseValue)}
                  sub={totals.ticket ? `Ticket médio ${brl(totals.ticket)}` : '—'}
                  extra={<Delta atual={totals.purchaseValue} anterior={previous?.purchase_value} fmt={brl} />} />
                <KpiCard icon={TrendingUp} cor={totals.roas >= 1 ? 'emerald' : 'red'} label="ROAS"
                  valor={totals.spend ? `${dec(totals.roas, 2)}x` : '—'}
                  sub={totals.spend ? `R$ ${dec(totals.roas, 2)} vendidos por R$ 1 investido` : '—'}
                  extra={<Delta atual={totals.roas} anterior={previous?.roas} fmt={(n) => `${dec(n, 2)}x`} />} />
              </div>

              {/* KPIs de alcance / tráfego */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <KpiCard icon={Target} cor="violet" label="Resultados" valor={num(totals.results)}
                  sub={resultMix.length
                    ? resultMix.slice(0, 2).map((r) => `${num(r.value)} ${actionLabel(r.type)}`).join(' · ')
                    : (totals.cpr ? `Custo/result. ${brl(totals.cpr)}` : '—')} />
                <KpiCard icon={Users} cor="sky" label="Alcance" valor={num(totals.reach)}
                  sub={`Frequência ${dec(totals.freq, 2)}x${totals.reachExato ? '' : ' (aprox.)'}`}
                  extra={<Delta atual={totals.reach} anterior={previous?.reach} fmt={num} />} />
                <KpiCard icon={MousePointerClick} cor="violet" label="Cliques no link" valor={num(totals.linkClicks || totals.clicks)}
                  sub={`CTR no link ${pct(totals.ctr)}`}
                  extra={<Delta atual={totals.linkClicks || totals.clicks} anterior={previous?.link_clicks} fmt={num} />} />
                <KpiCard icon={Store} cor="amber" label="Pedidos no ERPOS via anúncio"
                  valor={erposOrders ? num(erposOrders.count) : '—'}
                  sub={erposOrders
                    ? (erposOrders.count ? `${brl(erposOrders.revenue)} faturados` : 'Nenhum pedido com utm_source da Meta')
                    : 'Disponível após atualizar a função'} />
              </div>

              {/* Métricas secundárias */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6">
                <Pill icon={Eye} label="Impressões" valor={num(totals.impressions)} />
                <Pill icon={MousePointerClick} label="Cliques totais" valor={num(totals.clicks)} />
                <Pill icon={DollarSign} label="CPC no link" valor={brl(totals.cpc)} />
                <Pill icon={DollarSign} label="CPM" valor={brl(totals.cpm)} />
                <Pill icon={Percent} label="CTR no link" valor={pct(totals.ctr)} />
                <Pill icon={Gauge} label="Frequência" valor={`${dec(totals.freq, 2)}x`} />
              </div>

              <p className="text-[11px] text-zinc-400 -mt-4 mb-6 leading-relaxed">
                CTR e CPC são sobre <strong className="font-semibold text-zinc-500">cliques no link</strong>, o mesmo
                critério do Gerenciador de Anúncios (sobre todos os cliques dariam {pct(totals.ctrTotal)} e {brl(totals.cpcTotal)}).
                Alcance e frequência vêm do total da conta, sem somar campanhas, para não contar a mesma pessoa duas vezes.
              </p>

              {/* Alertas (calculados dos anúncios ativos do período) */}
              {alertas.length > 0 && (
                <div className="mb-4 bg-white border border-zinc-200 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <AlertTriangle size={15} className="text-amber-500" />
                    <p className="text-sm font-bold text-zinc-800">Alertas</p>
                    <span className="text-xs text-zinc-400">({alertas.length})</span>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {alertas.map((a, i) => (
                      <li key={i} className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 border ${a.nivel === 'alto' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>
                        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.nivel === 'alto' ? 'bg-red-500' : 'bg-amber-500'}`} />
                        <span>{a.texto}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Gráfico principal: Investimento x Vendas por dia */}
              <ChartCard icon={TrendingUp}
                titulo={temCompras ? 'Evolução — Investimento, valor em vendas e compras por dia' : 'Evolução — Investimento e cliques no link por dia'}
                className="mb-4">
                {temGrafico ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={daily} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CORES.spend} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={CORES.spend} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gReceita" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CORES.receita} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={CORES.receita} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="l" tickFormatter={(v) => `R$${compact(v)}`} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={54} />
                      <YAxis yAxisId="r" orientation="right" tickFormatter={compact} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={40} />
                      <Tooltip content={<GraphTooltip fmt={{ spend: brl, purchase_value: brl, purchases: num, link_clicks: num, results: num }} />} />
                      <Area yAxisId="l" type="monotone" dataKey="spend" name="Investimento" stroke={CORES.spend} strokeWidth={2} fill="url(#gSpend)" />
                      {temCompras && (
                        <Area yAxisId="l" type="monotone" dataKey="purchase_value" name="Valor em vendas" stroke={CORES.receita} strokeWidth={2} fill="url(#gReceita)" />
                      )}
                      {temCompras && (
                        <Line yAxisId="r" type="monotone" dataKey="purchases" name="Compras" stroke={CORES.compras} strokeWidth={2.5} dot={false} />
                      )}
                      {!temCompras && (
                        <Line yAxisId="r" type="monotone" dataKey="link_clicks" name="Cliques no link" stroke={CORES.clicks} strokeWidth={2.5} dot={false} />
                      )}
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
                <ChartCard icon={Layers} titulo={funilVendas ? 'Funil de vendas (pixel)' : 'Funil de desempenho'}>
                  <div className="flex flex-col justify-center gap-2.5 py-1 min-h-[220px]">
                    {(funilVendas ?? funil).map((f) => (
                      <div key={f.label}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-zinc-600">{f.label}</span>
                          <span className="font-black text-zinc-800 tabular-nums">
                            {num(f.value)}
                            {f.conv != null && (
                              <span className="ml-1.5 text-[10px] font-semibold text-zinc-400">{pct(f.conv)} do passo anterior</span>
                            )}
                          </span>
                        </div>
                        <div className="h-3 rounded-full bg-zinc-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(f.pct, 2)}%`, background: f.cor }} />
                        </div>
                      </div>
                    ))}
                    <p className="text-[11px] text-zinc-400 mt-1">
                      {funilVendas
                        ? 'Eventos do pixel no delivery: de quem clicou no anúncio, quantos chegaram à página, montaram o carrinho, iniciaram o checkout e compraram.'
                        : 'Do total de impressões, quantas viraram alcance, cliques e resultados.'}
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
                              <span className={`font-semibold truncate pr-2 ${a.destaque ? 'text-emerald-700' : 'text-zinc-600'}`}>{a.label}</span>
                              <span className={`font-black tabular-nums ${a.destaque ? 'text-emerald-700' : 'text-zinc-800'}`}>{num(a.value)}</span>
                            </div>
                            <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                              <div className={`h-full rounded-full ${a.destaque ? 'bg-emerald-500' : 'bg-zinc-400'}`} style={{ width: `${Math.max((a.value / max) * 100, 2)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : <SemDados />}
                </ChartCard>
              </div>

              {/* Hora do dia: compras dos anúncios × pedidos do delivery. Cada série no seu
                  eixo — as grandezas são muito diferentes e num eixo só a menor desaparece. */}
              {hourlyData && (
                <ChartCard
                  icon={BarChart3}
                  titulo={`Hora do dia — ${hourlyData.temCompras ? 'compras via anúncio' : 'cliques no anúncio'} × pedidos do delivery`}
                  className="mb-4"
                >
                  <div className="flex items-center gap-4 flex-wrap mb-1 text-[11px] font-semibold">
                    <span className="inline-flex items-center gap-1.5 text-zinc-600">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: hourlyData.temCompras ? CORES.compras : CORES.clicks }} />
                      {hourlyData.temCompras ? 'Compras via anúncio' : 'Cliques no anúncio'}
                      <span className="text-zinc-400 font-normal">(eixo da esquerda)</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-zinc-600">
                      <span className="w-3 h-0.5 rounded-full" style={{ background: CORES.spend }} />
                      Pedidos no delivery, todos
                      <span className="text-zinc-400 font-normal">(eixo da direita)</span>
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={hourlyData.linhas} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="hour" tickFormatter={(h: number) => `${h}h`} tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={4} />
                      <YAxis
                        yAxisId="l"
                        allowDecimals={false}
                        tickFormatter={compact}
                        tick={{ fontSize: 11, fill: hourlyData.temCompras ? CORES.compras : CORES.clicks }}
                        axisLine={false}
                        tickLine={false}
                        width={36}
                      />
                      <YAxis
                        yAxisId="r"
                        orientation="right"
                        allowDecimals={false}
                        tickFormatter={compact}
                        tick={{ fontSize: 11, fill: CORES.spend }}
                        axisLine={false}
                        tickLine={false}
                        width={36}
                      />
                      <Tooltip content={<GraphTooltip fmt={{ purchases: num, pedidos: num, spend: brl, link_clicks: num }} labelFmt={(h) => `${h}h`} />} cursor={{ fill: '#fafafa' }} />
                      {hourlyData.temCompras ? (
                        <Bar yAxisId="l" dataKey="purchases" name="Compras via anúncio" fill={CORES.compras} radius={[4, 4, 0, 0]} maxBarSize={30} />
                      ) : (
                        <Bar yAxisId="l" dataKey="link_clicks" name="Cliques no anúncio" fill={CORES.clicks} radius={[4, 4, 0, 0]} maxBarSize={30} />
                      )}
                      <Line yAxisId="r" type="monotone" dataKey="pedidos" name="Pedidos no delivery (todos)" stroke={CORES.spend} strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-zinc-400 mt-2 leading-relaxed">
                    Cada série tem a sua escala, então compare o <strong className="font-semibold text-zinc-500">formato</strong> das
                    curvas, não a altura entre elas. Se a loja vende às 20h e o anúncio converte às 15h, vale programar a
                    veiculação para o horário em que a loja de fato vende.
                  </p>
                </ChartCard>
              )}

              {(placementRows.length > 0 || ageRows.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                  {/* Por posicionamento */}
                  <ChartCard icon={Layers} titulo="Por posicionamento">
                    {placementRows.length > 0 ? (
                      <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-xs whitespace-nowrap">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
                              <th className="px-2 py-1.5 font-bold">Onde</th>
                              <th className="px-2 py-1.5 font-bold text-right">Investido</th>
                              <th className="px-2 py-1.5 font-bold text-right">Compras</th>
                              <th className="px-2 py-1.5 font-bold text-right">ROAS</th>
                              <th className="px-2 py-1.5 font-bold text-right">Custo/compra</th>
                              <th className="px-2 py-1.5 font-bold text-right">CPC link</th>
                            </tr>
                          </thead>
                          <tbody>
                            {placementRows.map((p) => (
                              <tr key={`${p.platform}-${p.position}`} className="border-b border-zinc-50">
                                <td className="px-2 py-1.5 font-semibold text-zinc-700">{placementLabel(p)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-800">{brl(p.spend)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-emerald-600">{num(p.purchases)}</td>
                                <td className="px-2 py-1.5 text-right"><Roas v={p.roas} spend={p.spend} /></td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{p.cost_per_purchase ? brl(p.cost_per_purchase) : '—'}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{brl(linkCpc(p))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <SemDados />}
                  </ChartCard>

                  {/* Por idade e gênero */}
                  <ChartCard icon={Users} titulo="Por idade e gênero">
                    {ageRows.length > 0 ? (
                      <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-xs whitespace-nowrap">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
                              <th className="px-2 py-1.5 font-bold">Faixa</th>
                              <th className="px-2 py-1.5 font-bold">Gênero</th>
                              <th className="px-2 py-1.5 font-bold text-right">Investido</th>
                              <th className="px-2 py-1.5 font-bold text-right">Compras</th>
                              <th className="px-2 py-1.5 font-bold text-right">ROAS</th>
                              <th className="px-2 py-1.5 font-bold text-right">CPC link</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ageRows.map((p) => (
                              <tr key={`${p.age}-${p.gender}`} className="border-b border-zinc-50">
                                <td className="px-2 py-1.5 font-semibold text-zinc-700">{p.age}</td>
                                <td className="px-2 py-1.5 text-zinc-600">{GENDER_LABELS[p.gender] ?? p.gender}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-800">{brl(p.spend)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-emerald-600">{num(p.purchases)}</td>
                                <td className="px-2 py-1.5 text-right"><Roas v={p.roas} spend={p.spend} /></td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{brl(linkCpc(p))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <SemDados />}
                  </ChartCard>
                </div>
              )}

              {/* Tabela de campanhas */}
              <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden mb-4">
                <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
                  <TrendingUp size={16} className="text-amber-500" />
                  <p className="text-sm font-bold text-zinc-800">Campanhas</p>
                  <span className="text-xs text-zinc-400">({rankCampaigns.length})</span>
                  {ads && rankCampaigns.length > 0 && (
                    <span className="text-[11px] text-zinc-400 ml-auto">Clique numa campanha pra filtrar os anúncios abaixo</span>
                  )}
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
                          <th className="px-3 py-2.5 font-bold">Status</th>
                          <th className="px-3 py-2.5 font-bold text-right">Investido</th>
                          <th className="px-3 py-2.5 font-bold text-right">Resultado</th>
                          <th className="px-3 py-2.5 font-bold text-right">Custo/res.</th>
                          <th className="px-3 py-2.5 font-bold text-right">Compras</th>
                          <th className="px-3 py-2.5 font-bold text-right">Vendas</th>
                          <th className="px-3 py-2.5 font-bold text-right">ROAS</th>
                          <th className="px-3 py-2.5 font-bold text-right">Cliques link</th>
                          <th className="px-3 py-2.5 font-bold text-right">CTR link</th>
                          <th className="px-3 py-2.5 font-bold text-right">CPC link</th>
                          <th className="px-3 py-2.5 font-bold text-right">Alcance</th>
                          <th className="px-3 py-2.5 font-bold text-right">Freq.</th>
                          <th className="px-4 py-2.5 font-bold text-right">CPM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankCampaigns.map((c) => {
                          const cpr = c.res.value ? c.spend / c.res.value : 0;
                          const sel = campanhaSel === c.campaign;
                          return (
                            <tr
                              key={c.campaign_id ?? c.campaign}
                              onClick={() => { if (ads) setCampanhaSel(sel ? null : c.campaign); }}
                              className={`border-b border-zinc-50 ${ads ? 'cursor-pointer' : ''} ${sel ? 'bg-amber-50' : 'hover:bg-amber-50/40'}`}
                            >
                              <td className={`px-4 py-2.5 sticky left-0 ${sel ? 'bg-amber-50' : 'bg-white'}`}>
                                <p className="font-semibold text-zinc-800 max-w-[220px] truncate">{c.campaign}</p>
                                <p className="text-[11px] text-zinc-400">{objectiveLabel(c.objective)}</p>
                              </td>
                              <td className="px-3 py-2.5"><StatusBadge status={c.status} /></td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-zinc-800">{brl(c.spend)}</td>
                              <td className="px-3 py-2.5 text-right"><ResultCell r={c.res} /></td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{cpr ? brl(cpr) : '—'}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-600">{num(n0(c.purchases))}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{brl(n0(c.purchase_value))}</td>
                              <td className="px-3 py-2.5 text-right"><Roas v={n0(c.roas)} spend={c.spend} /></td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{num(c.link_clicks || c.clicks)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500">{pct(linkCtr(c))}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{brl(linkCpc(c))}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{num(c.reach)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500">{dec(c.frequency, 2)}x</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{brl(c.cpm)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {rankCampaigns.length > 1 && (
                        <tfoot>
                          <tr className="border-t border-zinc-200 bg-zinc-50/60 font-bold text-zinc-800">
                            <td className="px-4 py-3 sticky left-0 bg-zinc-50/60">Total</td>
                            <td className="px-3 py-3" />
                            <td className="px-3 py-3 text-right tabular-nums">{brl(totals.spend)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{num(totals.results)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{totals.cpr ? brl(totals.cpr) : '—'}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{num(totals.purchases)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{brl(totals.purchaseValue)}</td>
                            <td className="px-3 py-3 text-right"><Roas v={totals.roas} spend={totals.spend} /></td>
                            <td className="px-3 py-3 text-right tabular-nums">{num(totals.linkClicks || totals.clicks)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{pct(totals.ctr)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{brl(totals.cpc)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{num(totals.reach)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{dec(totals.freq, 2)}x</td>
                            <td className="px-4 py-3 text-right tabular-nums">{brl(totals.cpm)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>

              {/* Tabela de anúncios */}
              <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden mb-4">
                <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
                  <Megaphone size={16} className="text-amber-500" />
                  <p className="text-sm font-bold text-zinc-800">Anúncios</p>
                  {rankAds && <span className="text-xs text-zinc-400">({rankAds.length})</span>}
                  {ads && campaigns.length > 0 && (
                    <select
                      value={campanhaSel ?? ''}
                      onChange={(e) => setCampanhaSel(e.target.value || null)}
                      className="ml-auto text-xs font-semibold border border-zinc-200 rounded-lg px-2 py-1.5 bg-white text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer max-w-[260px]"
                    >
                      <option value="">Todas as campanhas</option>
                      {campaigns.map((c) => (
                        <option key={c.campaign_id ?? c.campaign} value={c.campaign}>{c.campaign}</option>
                      ))}
                    </select>
                  )}
                </div>

                {!ads ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-400">
                    Detalhe por anúncio disponível após atualizar a Edge Function <span className="font-mono">meta-ads-insights</span>.
                  </div>
                ) : !rankAds || rankAds.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                    <Megaphone size={28} className="mb-2 opacity-40" />
                    <p className="text-sm font-semibold">Nenhum anúncio no período</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100 bg-zinc-50/60">
                          <th className="px-4 py-2.5 font-bold sticky left-0 bg-zinc-50/60">Anúncio</th>
                          <th className="px-3 py-2.5 font-bold">Status</th>
                          <th className="px-3 py-2.5 font-bold text-right">Investido</th>
                          <th className="px-3 py-2.5 font-bold text-right">Resultado</th>
                          <th className="px-3 py-2.5 font-bold text-right">Custo/res.</th>
                          <th className="px-3 py-2.5 font-bold text-right">Compras</th>
                          <th className="px-3 py-2.5 font-bold text-right">Vendas</th>
                          <th className="px-3 py-2.5 font-bold text-right">ROAS</th>
                          <th className="px-3 py-2.5 font-bold text-right">Cliques link</th>
                          <th className="px-3 py-2.5 font-bold text-right">CTR link</th>
                          <th className="px-3 py-2.5 font-bold text-right">CPC link</th>
                          <th className="px-3 py-2.5 font-bold text-right">Alcance</th>
                          <th className="px-4 py-2.5 font-bold text-right">Freq.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankAds.map((a) => {
                          const cpr = a.res.value ? a.spend / a.res.value : 0;
                          return (
                            <tr key={a.ad_id} className="border-b border-zinc-50 hover:bg-amber-50/40">
                              <td className="px-4 py-2 sticky left-0 bg-white">
                                <div className="flex items-center gap-2.5">
                                  {a.thumbnail_url ? (
                                    <img src={a.thumbnail_url} alt="" loading="lazy"
                                      className="w-9 h-9 rounded-lg object-cover border border-zinc-100 flex-shrink-0" />
                                  ) : (
                                    <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center flex-shrink-0">
                                      <Megaphone size={14} className="text-zinc-300" />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="font-semibold text-zinc-800 max-w-[220px] truncate">{a.ad}</p>
                                    <p className="text-[11px] text-zinc-400 max-w-[220px] truncate">
                                      {a.adset}{!campanhaSel && a.campaign ? ` · ${a.campaign}` : ''}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-zinc-800">{brl(a.spend)}</td>
                              <td className="px-3 py-2 text-right"><ResultCell r={a.res} /></td>
                              <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{cpr ? brl(cpr) : '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">{num(n0(a.purchases))}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">{brl(n0(a.purchase_value))}</td>
                              <td className="px-3 py-2 text-right"><Roas v={n0(a.roas)} spend={a.spend} /></td>
                              <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{num(a.link_clicks || a.clicks)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{pct(linkCtr(a))}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{brl(linkCpc(a))}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{num(a.reach)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-zinc-500">{dec(a.frequency, 2)}x</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Meta × ERPOS: atribuição da Meta contra pedidos reais do delivery com utm da Meta */}
              {erposOrders && (
                <ChartCard icon={Store} titulo="Compras atribuídas pela Meta × pedidos reais no ERPOS" className="mb-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
                      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">A Meta atribuiu</p>
                      <p className="text-lg font-black text-zinc-900 tabular-nums">{num(totals.purchases)} compras</p>
                      <p className="text-xs text-zinc-500">{brl(totals.purchaseValue)}</p>
                    </div>
                    <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
                      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">O ERPOS registrou (link com utm da Meta)</p>
                      <p className="text-lg font-black text-zinc-900 tabular-nums">{num(erposOrders.count)} pedidos</p>
                      <p className="text-xs text-zinc-500">
                        {brl(erposOrders.revenue)}
                        {Object.keys(erposOrders.by_source).length > 0 && (
                          ` · ${Object.entries(erposOrders.by_source).map(([s, v]) => `${s}: ${v.count}`).join(', ')}`
                        )}
                      </p>
                    </div>
                    <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
                      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Investimento por pedido real</p>
                      <p className="text-lg font-black text-zinc-900 tabular-nums">{erposOrders.count ? brl(totals.spend / erposOrders.count) : '—'}</p>
                      <p className="text-xs text-zinc-500">
                        {erposOrders.count && totals.spend ? `ROAS real ${dec(erposOrders.revenue / totals.spend, 2)}x` : 'sem pedidos com utm no período'}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-3 leading-relaxed">
                    A Meta atribui por janela (7 dias após o clique / 1 dia após a visualização) e o pixel é compartilhado
                    entre as lojas — por isso os números não batem 1:1 com o caixa.
                    {erposOrders.count === 0 && (
                      ' Nenhum pedido chegou com utm_source da Meta: coloque ?utm_source=instagram (ou facebook) no link de destino dos anúncios pra o ERPOS reconhecer a origem.'
                    )}
                  </p>
                </ChartCard>
              )}
            </div>
          )}
        </>
      )}

      {shareOpen && !publico && (
        <CompartilharModal
          tenantId={tenantId}
          datePreset={datePreset}
          customApplied={customApplied}
          userName={user?.nome ?? null}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Modal de compartilhamento ───────────────────────────────────────────────
// Gera um link SOMENTE LEITURA do relatório. O período é congelado no link e a
// loja vem do banco pelo token — quem abre não escolhe nem uma coisa nem outra.
function CompartilharModal({
  tenantId, datePreset, customApplied, userName, onClose,
}: {
  tenantId: string;
  datePreset: string;
  customApplied: { since: string; until: string } | null;
  userName: string | null;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [dias, setDias] = useState(30);
  const [incluirPedidos, setIncluirPedidos] = useState(false);
  const [novoToken, setNovoToken] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const periodoAtual = datePreset === 'custom' && customApplied
    ? { range_since: customApplied.since, range_until: customApplied.until, date_preset: null }
    : { range_since: null, range_until: null, date_preset: datePreset };

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await invokeWithAuth<{ success: boolean; shares: ShareLink[] }>('meta-connect', {
      body: { action: 'list_shares', tenant_id: tenantId },
    });
    setLinks(data?.shares ?? []);
    setCarregando(false);
  }, [tenantId]);

  useEffect(() => { carregar(); }, [carregar]);

  const copiar = (token: string) => {
    navigator.clipboard.writeText(shareUrl(token)).then(
      () => { setCopiado(token); window.setTimeout(() => setCopiado(null), 2000); },
      () => setErro('Não foi possível copiar. Selecione o link e copie manualmente.'),
    );
  };

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    const { data, error: err } = await invokeWithAuth<{ success: boolean; token?: string; error?: string }>(
      'meta-connect',
      {
        body: {
          action: 'create_share',
          tenant_id: tenantId,
          date_preset: periodoAtual.date_preset,
          time_range: periodoAtual.range_since && periodoAtual.range_until
            ? { since: periodoAtual.range_since, until: periodoAtual.range_until }
            : undefined,
          include_erpos_orders: incluirPedidos,
          label: label.trim() || undefined,
          expires_in_days: dias,
          created_by_name: userName,
        },
      },
    );
    if (err || !data?.success || !data.token) {
      setErro(data?.error ?? err?.message ?? 'Não foi possível gerar o link. Só administradores da loja podem criar.');
    } else {
      setNovoToken(data.token);
      setLabel('');
      copiar(data.token);
      carregar();
    }
    setGerando(false);
  };

  const revogar = async (l: ShareLink) => {
    if (!window.confirm('Revogar este link? Quem tiver o endereço deixa de ver o relatório na hora.')) return;
    const { data, error: err } = await invokeWithAuth<{ success: boolean; error?: string }>('meta-connect', {
      body: { action: 'revoke_share', tenant_id: tenantId, id: l.id },
    });
    if (err || !data?.success) setErro(data?.error ?? 'Não foi possível revogar.');
    else { if (novoToken === l.token) setNovoToken(null); carregar(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white">
          <Share2 size={17} className="text-amber-500" />
          <p className="text-base font-bold text-zinc-800">Compartilhar relatório</p>
          <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-zinc-600 cursor-pointer" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-zinc-500 leading-relaxed mb-4">
            Gera um endereço que qualquer pessoa abre <strong className="font-semibold text-zinc-700">sem login</strong>,
            só para visualizar. O período fica congelado como está agora
            (<strong className="font-semibold text-zinc-700">{periodoDoLink(periodoAtual)}</strong>) e não dá para
            trocar de loja pelo endereço.
          </p>

          {erro && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Nome (opcional)</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex.: Agência, sócio, contador"
                maxLength={80}
                className="mt-1 w-full text-sm border border-zinc-200 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Validade</label>
              <select
                value={dias}
                onChange={(e) => setDias(Number(e.target.value))}
                className="mt-1 w-full text-sm font-semibold border border-zinc-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-amber-400 cursor-pointer"
              >
                <option value={7}>7 dias</option>
                <option value={30}>30 dias</option>
                <option value={90}>90 dias</option>
                <option value={365}>1 ano</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={incluirPedidos}
              onChange={(e) => setIncluirPedidos(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-amber-500 cursor-pointer"
            />
            <span className="text-sm text-zinc-600 leading-snug">
              Incluir os pedidos reais do ERPOS
              <span className="block text-xs text-zinc-400">
                Mostra quantos pedidos e quanto a loja faturou pelos links da Meta. É dado interno do caixa;
                deixe desmarcado se o link vai circular fora da empresa.
              </span>
            </span>
          </label>

          <button
            onClick={gerar}
            disabled={gerando}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 cursor-pointer disabled:opacity-60"
          >
            {gerando ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={15} />}
            {gerando ? 'Gerando...' : 'Gerar link'}
          </button>

          {novoToken && (
            <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p className="text-xs font-bold text-emerald-700 mb-1.5">Link criado e copiado</p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-zinc-700 flex-1 truncate">{shareUrl(novoToken)}</span>
                <button
                  onClick={() => copiar(novoToken)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-700 text-xs font-bold cursor-pointer hover:bg-emerald-50"
                >
                  {copiado === novoToken ? <Check size={13} /> : <Copy size={13} />}
                  {copiado === novoToken ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>
          )}

          <div className="mt-6">
            <p className="text-sm font-bold text-zinc-800 mb-2">
              Links ativos <span className="text-xs font-semibold text-zinc-400">({links.length})</span>
            </p>
            {carregando ? (
              <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-amber-500" /></div>
            ) : links.length === 0 ? (
              <p className="text-sm text-zinc-400 py-3">Nenhum link ativo.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {links.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 border border-zinc-200 rounded-xl px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-800 truncate">
                        {l.label || 'Sem nome'}
                        {l.include_erpos_orders && (
                          <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                            com pedidos do ERPOS
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {periodoDoLink(l)} · {l.view_count} {l.view_count === 1 ? 'acesso' : 'acessos'}
                        {l.expires_at ? ` · expira ${new Date(l.expires_at).toLocaleDateString('pt-BR')}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => copiar(l.token)}
                      className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-50 cursor-pointer"
                      title="Copiar link"
                    >
                      {copiado === l.token ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                    </button>
                    <button
                      onClick={() => revogar(l)}
                      className="p-2 rounded-lg text-red-400 hover:bg-red-50 cursor-pointer"
                      title="Revogar"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────
const CORES_KPI: Record<string, { bg: string; text: string }> = {
  amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-600' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600' },
  red: { bg: 'bg-red-50', text: 'text-red-500' },
};

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-zinc-300">—</span>;
  const s = STATUS_LABELS[status] ?? { label: status.toLowerCase().replace(/_/g, ' '), cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.cls}`}>{s.label}</span>;
}

function ResultCell({ r }: { r: ResultVal }) {
  const compra = r.type === 'purchase';
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={`font-semibold tabular-nums ${compra ? 'text-emerald-600' : 'text-zinc-800'}`}>{num(r.value)}</span>
      <span className="text-[10px] text-zinc-400">{actionLabel(r.type)}</span>
    </span>
  );
}

function Roas({ v, spend }: { v: number; spend: number }) {
  if (!spend) return <span className="text-zinc-300">—</span>;
  const cls = v >= 2 ? 'text-emerald-600' : v >= 1 ? 'text-amber-600' : 'text-red-500';
  return <span className={`font-semibold tabular-nums ${cls}`}>{dec(v, 2)}x</span>;
}

// Variação vs período anterior. `invertido` = cair é bom (custo); `neutro` = sem juízo (investimento).
function Delta({
  atual, anterior, invertido = false, neutro = false, fmt,
}: {
  atual: number;
  anterior?: number | null;
  invertido?: boolean;
  neutro?: boolean;
  fmt?: (n: number) => string;
}) {
  if (anterior == null || (!anterior && !atual)) return null;
  const diff = anterior ? ((atual - anterior) / anterior) * 100 : 100;
  const bom = invertido ? diff <= 0 : diff >= 0;
  const cls = neutro || Math.abs(diff) < 0.5 ? 'text-zinc-400' : bom ? 'text-emerald-600' : 'text-red-500';
  return (
    <span className={`text-[11px] font-bold tabular-nums ${cls}`} title={fmt ? `Período anterior: ${fmt(anterior)}` : undefined}>
      {diff >= 0 ? '▲' : '▼'} {dec(Math.abs(diff), 0)}%
    </span>
  );
}

function KpiCard({
  icon: Icon, cor, label, valor, sub, extra,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  cor: keyof typeof CORES_KPI | string;
  label: string;
  valor: string;
  sub?: string;
  extra?: React.ReactNode;
}) {
  const c = CORES_KPI[cor] ?? CORES_KPI.amber;
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 flex items-center justify-center rounded-xl ${c.bg}`}>
          <Icon size={17} className={c.text} />
        </div>
        {extra}
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
  active, payload, label, fmt, labelFmt,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  fmt?: Record<string, (n: number) => string>;
  labelFmt?: (l: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      {label != null && label !== '' && (
        <p className="font-bold text-zinc-700 mb-1">{labelFmt ? labelFmt(label) : shortDate(String(label))}</p>
      )}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 text-zinc-600">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-bold text-zinc-800">{fmt?.[p.dataKey] ? fmt[p.dataKey](p.value) : num(p.value)}</span>
        </p>
      ))}
    </div>
  );
}
