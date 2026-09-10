// Tipos, formatadores e peças visuais compartilhados entre a página de Tráfego Pago e os
// componentes em ./components. Tudo que mais de um arquivo precisa mora aqui.
import type { ReactNode, ComponentType } from 'react';
import { BarChart3 } from 'lucide-react';

// ─── Formatação ──────────────────────────────────────────────────────────────
export const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const num = (n: number) => Math.round(Number(n || 0)).toLocaleString('pt-BR');
export const dec = (n: number, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (n: number) => `${dec(n, 2)}%`;
export const n0 = (v: number | undefined | null) => Number(v || 0);
export const shortDate = (d: string) => {
  const p = (d || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}` : d;
};
export const compact = (n: number) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1).replace('.0', '')}k`;
  return String(Math.round(v));
};
export const dataHora = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const dataCurta = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

// CTR e CPC sobre cliques no LINK (o que o Gerenciador de Anúncios e o Reportei mostram).
// Usa o valor que a Meta já calcula; sem ele (função antiga), calcula pelos cliques no link.
export type CliqueLike = {
  link_ctr?: number; cost_per_link_click?: number;
  impressions: number; link_clicks?: number; clicks?: number; spend: number;
};
export const linkCtr = (r: CliqueLike): number =>
  r.link_ctr ?? (r.impressions ? (n0(r.link_clicks) / r.impressions) * 100 : 0);
export const linkCpc = (r: CliqueLike): number =>
  r.cost_per_link_click ?? (n0(r.link_clicks) ? r.spend / n0(r.link_clicks) : 0);

export const CORES = { spend: '#f59e0b', results: '#10b981', reach: '#0ea5e9', clicks: '#8b5cf6', receita: '#14b8a6', compras: '#16a34a' };

// ─── Rótulos ─────────────────────────────────────────────────────────────────
export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: 'Vendas', CONVERSIONS: 'Vendas', PRODUCT_CATALOG_SALES: 'Catálogo',
  OUTCOME_TRAFFIC: 'Tráfego', LINK_CLICKS: 'Tráfego',
  OUTCOME_ENGAGEMENT: 'Engajamento', POST_ENGAGEMENT: 'Engajamento', MESSAGES: 'Mensagens', VIDEO_VIEWS: 'Vídeo',
  OUTCOME_LEADS: 'Leads', LEAD_GENERATION: 'Leads',
  OUTCOME_AWARENESS: 'Reconhecimento', REACH: 'Alcance', BRAND_AWARENESS: 'Reconhecimento',
  OUTCOME_APP_PROMOTION: 'App', APP_INSTALLS: 'App',
};
export const objectiveLabel = (o?: string | null) =>
  (o ? (OBJECTIVE_LABELS[o] ?? o.replace(/^OUTCOME_/, '').toLowerCase()) : '—');

export const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
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

export const BID_LABELS: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: 'Menor custo',
  LOWEST_COST_WITH_BID_CAP: 'Limite de lance',
  COST_CAP: 'Limite de custo',
  LOWEST_COST_WITH_MIN_ROAS: 'ROAS mínimo',
};
export const bidLabel = (b?: string | null) => (b ? (BID_LABELS[b] ?? b.toLowerCase().replace(/_/g, ' ')) : '—');

export const LEARNING_LABELS: Record<string, { label: string; cls: string; dica: string }> = {
  LEARNING: { label: 'Aprendendo', cls: 'bg-sky-50 text-sky-700 border-sky-200', dica: 'A Meta ainda está calibrando a entrega. Mexer agora (orçamento, público, criativo) reinicia o aprendizado.' },
  SUCCESS: { label: 'Aprendizado concluído', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dica: 'Saiu da fase de aprendizado com conversões suficientes. É a fase em que a entrega fica estável.' },
  FAIL: { label: 'Aprendizado limitado', cls: 'bg-red-50 text-red-600 border-red-200', dica: 'Não gerou as ~50 conversões em 7 dias que a Meta precisa. Público pequeno, orçamento baixo ou evento raro demais.' },
};

export const ACCOUNT_STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: 'Ativa', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  2: { label: 'Desativada', cls: 'bg-red-50 text-red-600 border-red-200' },
  3: { label: 'Pagamento pendente', cls: 'bg-red-50 text-red-600 border-red-200' },
  7: { label: 'Em análise de risco', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  8: { label: 'Aguardando acerto', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  9: { label: 'Período de carência', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  100: { label: 'Fechamento pendente', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  101: { label: 'Fechada', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
};

// Notas de qualidade da Meta (comparação com anúncios que disputam o mesmo público).
export const RANKING_LABELS: Record<string, { label: string; cls: string; ordem: number }> = {
  ABOVE_AVERAGE: { label: 'Acima da média', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', ordem: 5 },
  AVERAGE: { label: 'Na média', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', ordem: 4 },
  BELOW_AVERAGE_35: { label: 'Abaixo (35%)', cls: 'bg-amber-50 text-amber-700 border-amber-200', ordem: 3 },
  BELOW_AVERAGE_20: { label: 'Abaixo (20%)', cls: 'bg-orange-50 text-orange-700 border-orange-200', ordem: 2 },
  BELOW_AVERAGE_10: { label: 'Abaixo (10%)', cls: 'bg-red-50 text-red-600 border-red-200', ordem: 1 },
};

export const DEVICE_LABELS: Record<string, string> = {
  mobile_app: 'App no celular', mobile_web: 'Navegador no celular', desktop: 'Computador',
  iphone: 'iPhone', ipad: 'iPad', ipod: 'iPod', android_smartphone: 'Android (celular)', android_tablet: 'Android (tablet)',
  other: 'Outro', unknown: 'Não informado',
};
export const deviceLabel = (d: string) => DEVICE_LABELS[d] ?? d.replace(/_/g, ' ');

export const AUDIENCE_SUBTYPE: Record<string, string> = {
  CUSTOM: 'Personalizado', WEBSITE: 'Visitantes do site', APP: 'Usuários do app', ENGAGEMENT: 'Engajamento',
  LOOKALIKE: 'Semelhante', VIDEO: 'Quem viu vídeo', OFFLINE_CONVERSION: 'Conversões offline', CLAIM: 'Lista de clientes',
  BAG_OF_ACCOUNTS: 'Contas', PARTNER: 'Parceiro', MANAGED: 'Gerenciado', FOX: 'Fox', STUDY_RULE_AUDIENCE: 'Estudo',
  SUBSCRIBER_SEGMENT: 'Assinantes', BIDDING: 'Lance',
};

// ─── Tipos dos dados novos (espelham a resposta da Edge Function meta-ads-insights) ──
export interface Recomendacao { title: string; message: string; code: number | null }

export interface Rankings { quality: string | null; engagement: string | null; conversion: string | null }
export interface VideoStats { plays: number; p25: number; p50: number; p75: number; p100: number; thruplay: number; avg_seconds: number }
export interface CreativeInfo {
  title: string; body: string; description: string; cta: string; link: string;
  image_url: string | null; video_id: string | null; story_id: string | null;
}
// O que os componentes precisam de um anúncio (a página estende com as métricas completas).
export interface AdBase {
  ad_id: string; ad: string; adset: string; campaign: string; status?: string | null;
  spend: number; impressions: number; reach: number; frequency: number; link_clicks: number; clicks: number;
  link_ctr?: number; cost_per_link_click?: number;
  purchases?: number; purchase_value?: number; roas?: number;
  thumbnail_url?: string | null;
  creative?: CreativeInfo; rankings?: Rankings; video?: VideoStats | null;
  issues?: string[]; recommendations?: Recomendacao[];
}

export interface TargetingLoc { type: string; name: string; radius_km: number | null; lat: number | null; lng: number | null }
export interface Targeting {
  age_min: number | null; age_max: number | null; genders: string;
  locations: TargetingLoc[]; location_types: string[];
  interests: string[]; behaviors: string[]; custom_audiences: string[]; excluded_audiences: string[];
  advantage_audience: boolean; publisher_platforms: string[];
}
export interface AreaCheck { name: string; type: string; radius_km: number | null; dist_store_km: number | null; alcance_km: number | null; excede_km: number | null }
export interface AdsetRow extends CliqueLike {
  adset_id: string; adset: string; campaign_id: string; campaign: string;
  objective: string | null; optimization_goal: string | null; status: string | null;
  daily_budget: number | null; lifetime_budget: number | null; budget_remaining: number | null;
  bid_strategy: string | null; bid_amount: number | null; billing_event: string | null;
  start_time: string | null; end_time: string | null;
  learning: { status: string; conversions: number; last_edit: string | null } | null;
  targeting: Targeting; area_check: AreaCheck[];
  issues: string[]; recommendations: Recomendacao[];
  reach: number; frequency: number; clicks: number; link_clicks: number;
  purchases?: number; purchase_value?: number; roas?: number; cost_per_purchase?: number;
  result?: { type: string; value: number };
}

export interface AccountInfo {
  name: string | null; currency: string | null; status: number; disable_reason: number;
  amount_spent: number | null; balance: number | null; spend_cap: number | null;
  timezone: string | null; funding: string | null;
}
export interface AudienceRow {
  id: string; name: string; subtype: string; size_low: number | null; size_high: number | null;
  delivery_status: string; updated: string | null;
}
export interface DeliveryArea {
  max_km: number | null; store: { lat: number; lng: number } | null; city: string | null; neighborhoods: number;
  km_p90: number | null; km_max: number | null; km_amostra: number;
}
export interface Comentario { message: string; from: string; created_time: string; likes: number }
export interface CommentsInfo {
  available: boolean; reason: string | null;
  by_ad: Record<string, { total: number; latest: Comentario[] }>;
}
export interface SlimBase {
  spend: number; impressions: number; reach: number; clicks: number; link_clicks: number;
  purchases: number; purchase_value: number; roas: number; cost_per_purchase: number;
  cpc: number; ctr: number; link_ctr?: number; cost_per_link_click?: number; frequency?: number; cpm?: number;
}
export interface DeviceRow extends SlimBase { device: string }
export interface RegionRow extends SlimBase { country: string; region: string }
export interface FrequencyRow extends SlimBase { bucket: string }
export interface AssetRow extends SlimBase { label: string; url: string | null }
export interface AssetsBreakdown { image: AssetRow[]; title: AssetRow[]; body: AssetRow[]; cta: AssetRow[] }

// ─── Peças visuais ───────────────────────────────────────────────────────────
export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-zinc-300">—</span>;
  const s = STATUS_LABELS[status] ?? { label: status.toLowerCase().replace(/_/g, ' '), cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.cls}`}>{s.label}</span>;
}

export function Roas({ v, spend }: { v: number; spend: number }) {
  if (!spend) return <span className="text-zinc-300">—</span>;
  const cls = v >= 2 ? 'text-emerald-600' : v >= 1 ? 'text-amber-600' : 'text-red-500';
  return <span className={`font-semibold tabular-nums ${cls}`}>{dec(v, 2)}x</span>;
}

export function ChartCard({
  icon: Icon, titulo, children, className = '', extra,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  titulo: string;
  children: ReactNode;
  className?: string;
  extra?: ReactNode;
}) {
  return (
    <div className={`bg-white border border-zinc-200 rounded-2xl p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Icon size={15} className="text-amber-500" />
        <p className="text-sm font-bold text-zinc-800">{titulo}</p>
        {extra && <div className="ml-auto">{extra}</div>}
      </div>
      {children}
    </div>
  );
}

export function SemDados({ texto = 'Sem dados no período' }: { texto?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[200px] text-zinc-300">
      <BarChart3 size={26} className="mb-2" />
      <p className="text-xs font-semibold text-zinc-400">{texto}</p>
    </div>
  );
}

export function RankingBadge({ value, titulo }: { value: string | null | undefined; titulo: string }) {
  const r = value ? RANKING_LABELS[value] : null;
  if (!r) return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-zinc-300 border border-zinc-100" title={`${titulo}: sem nota (menos de 500 impressões)`}>{titulo}: —</span>;
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${r.cls}`} title={`${titulo}: ${r.label}`}>{titulo}: {r.label}</span>;
}

export function LearningBadge({ learning }: { learning: AdsetRow['learning'] }) {
  if (!learning?.status) return <span className="text-zinc-300">—</span>;
  const l = LEARNING_LABELS[learning.status] ?? { label: learning.status.toLowerCase(), cls: 'bg-zinc-100 text-zinc-500 border-zinc-200', dica: '' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${l.cls}`} title={l.dica}>
      {l.label}{learning.status === 'LEARNING' && learning.conversions ? ` · ${learning.conversions} conv.` : ''}
    </span>
  );
}

// Tabela compacta reutilizada pelas quebras (aparelho, região, peças...).
export function MiniTable({ cabecalho, linhas }: { cabecalho: ReactNode[]; linhas: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs whitespace-nowrap">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
            {cabecalho.map((c, i) => <th key={i} className={`px-2 py-1.5 font-bold ${i > 0 ? 'text-right' : ''}`}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-b border-zinc-50">
              {l.map((c, j) => <td key={j} className={`px-2 py-1.5 ${j > 0 ? 'text-right tabular-nums' : 'font-semibold text-zinc-700'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
