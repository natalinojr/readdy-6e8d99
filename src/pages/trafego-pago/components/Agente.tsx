// Tráfego Pago › Agente — gestor de tráfego pago com IA (2026-09-16).
// Tudo passa pela Edge Function meta-ads-agent: configuração (metas, tetos, modo), rodada
// manual, fila de sugestões (aprovar/rejeitar = executa na Meta) e histórico das rodadas.
import { useCallback, useEffect, useState } from 'react';
import {
  Bot, Loader2, Play, Check, X, AlertTriangle, ShieldCheck, ShieldAlert, Settings2, History,
  Pause, PlayCircle, Wallet, Sparkles, RefreshCw, Image as ImageIcon, ChevronDown, ChevronUp,
} from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';
import { brl, dataHora } from '../shared';
import { confirmar } from '@/components/base/Dialogos';

type Settings = {
  enabled: boolean; mode: 'sugerir' | 'autonomo'; autonomia_criar: boolean; objetivo: 'whatsapp' | 'trafego' | 'vendas';
  daily_budget_cap: number; monthly_budget_cap: number; target_cpr: number | null; target_roas: number | null; max_frequency: number;
  page_id: string | null; page_name: string | null; whatsapp_number: string | null; destination_url: string | null;
  radius_km: number | null; age_min: number; age_max: number; store_context: string | null;
  last_run_at: string | null; autopilot_since: string | null;
  model: ModelId | null; shadow_model: ModelId | null;
};
type ModelId = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5';
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | null;
type SombraAcao = { kind: string; level: string | null; target_id: string | null; target_name: string | null; params: Record<string, unknown>; reason: string | null; risk: string };
type Run = {
  id: string; trigger: string; status: string; started_at: string; finished_at: string | null; summary: string | null;
  health_score: number | null; alerts: string[]; actions_total: number; actions_executed: number; error: string | null;
  model?: string | null; usage?: Usage; shadow_of?: string | null; sombra_acoes?: SombraAcao[] | null;
};

// Preço de lista da API (US$ por milhão de tokens, 2026-09): leitura de cache ≈ 10%, gravação ≈ 125%.
// Só para o dono comparar custo entre modelos; não é fatura.
const PRECO_USD: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 }, 'claude-sonnet-5': { in: 2, out: 10 }, 'claude-haiku-4-5': { in: 1, out: 5 },
};
const MODEL_LABEL: Record<string, string> = { 'claude-opus-5': 'Opus 5', 'claude-sonnet-5': 'Sonnet 5', 'claude-haiku-4-5': 'Haiku 4.5' };
const modeloNome = (m?: string | null) => (m ? (MODEL_LABEL[m] ?? Object.entries(MODEL_LABEL).find(([k]) => m.startsWith(k))?.[1] ?? m) : '—');
function custoUsd(model?: string | null, u?: Usage): number | null {
  if (!model || !u) return null;
  const p = Object.entries(PRECO_USD).find(([k]) => model.startsWith(k))?.[1];
  if (!p) return null;
  const inp = (u.input_tokens ?? 0) * p.in + (u.cache_read_input_tokens ?? 0) * p.in * 0.1 + (u.cache_creation_input_tokens ?? 0) * p.in * 1.25;
  return (inp + (u.output_tokens ?? 0) * p.out) / 1_000_000;
}
const usd = (v: number | null) => (v === null ? '—' : `US$ ${v.toFixed(v < 0.1 ? 3 : 2)}`);
const tokens = (u?: Usage) => (u ? `${Math.round(((u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)) / 1000)}k entrada · ${Math.round((u.output_tokens ?? 0) / 1000 * 10) / 10}k saída` : '');
// Chave para comparar "a mesma ação" entre a rodada real e a sombra (tipo + alvo; orçamento arredondado).
const chaveAcao = (a: { kind: string; target_id: string | null; params?: Record<string, unknown> }) =>
  `${a.kind}:${a.target_id ?? 'nova'}${a.kind === 'set_budget' ? `:${Math.round(Number(a.params?.daily_budget ?? 0))}` : ''}`;
type Action = {
  id: string; run_id: string | null; kind: string; level: string | null; target_id: string | null; target_name: string | null;
  params: Record<string, unknown>; reason: string | null; expected_impact: string | null; status: string; auto: boolean; risk: string;
  decided_by_name: string | null; decided_at: string | null; executed_at: string | null; result: Record<string, unknown> | null; error: string | null; created_at: string;
};
type Capabilities = { ads_management: boolean; pages_manage_ads: boolean; pages_show_list: boolean; business_management: boolean; granted: string[]; pages: Array<{ id: string; name: string; instagram_id: string | null }> } | null;
type Erpos = {
  store: { name: string; city: string | null; slug: string | null }; whatsapp_loja: string | null; store_location: { lat: number; lng: number } | null;
  delivery_url: string | null; menu_items_with_photo: number; best_sellers: Array<{ name: string; qty_30d: number; photo_url: string | null }>;
  orders_30d: { count: number; revenue: number; ticket: number };
};
type GetSettings = { success: boolean; settings: Settings; pending: number; last_run: Run | null; default_model?: string; capabilities: Capabilities; erpos: Erpos; connection: { token_expires_at: string | null } | null; error?: string };

const KIND_LABEL: Record<string, string> = {
  pause: 'Pausar', resume: 'Reativar', set_budget: 'Ajustar orçamento', create_campaign: 'Criar campanha',
  rotate_creative: 'Trocar criativo', alert: 'Alerta',
};
const LEVEL_LABEL: Record<string, string> = { account: 'Conta', campaign: 'Campanha', adset: 'Conjunto', ad: 'Anúncio' };
const STATUS_LABEL: Record<string, string> = {
  sugerida: 'Aguardando você', aprovada: 'Aprovada', executada: 'Executada', rejeitada: 'Rejeitada', falhou: 'Falhou', expirada: 'Expirada',
};
const STATUS_CLS: Record<string, string> = {
  sugerida: 'bg-amber-50 text-amber-800 border-amber-200', aprovada: 'bg-sky-50 text-sky-700 border-sky-200',
  executada: 'bg-emerald-50 text-emerald-700 border-emerald-200', rejeitada: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  falhou: 'bg-red-50 text-red-700 border-red-200', expirada: 'bg-zinc-50 text-zinc-400 border-zinc-200',
};
const RISK_CLS: Record<string, string> = { baixo: 'text-emerald-600', medio: 'text-amber-600', alto: 'text-red-600' };

function KindIcon({ kind }: { kind: string }) {
  const cls = 'flex-shrink-0';
  if (kind === 'pause') return <Pause size={15} className={`${cls} text-red-500`} />;
  if (kind === 'resume') return <PlayCircle size={15} className={`${cls} text-emerald-500`} />;
  if (kind === 'set_budget') return <Wallet size={15} className={`${cls} text-amber-500`} />;
  if (kind === 'create_campaign') return <Sparkles size={15} className={`${cls} text-violet-500`} />;
  if (kind === 'rotate_creative') return <ImageIcon size={15} className={`${cls} text-sky-500`} />;
  return <AlertTriangle size={15} className={`${cls} text-amber-500`} />;
}

function Health({ score }: { score: number | null }) {
  if (score === null || score === undefined) return null;
  const cor = score >= 70 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : score >= 40 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200';
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold ${cor}`}>Saúde {score}/100</span>;
}

function ActionCard({ a, onDecide, deciding, isAdmin }: { a: Action; onDecide?: (id: string, d: 'aprovar' | 'rejeitar') => void; deciding: string | null; isAdmin: boolean }) {
  const [aberto, setAberto] = useState(false);
  const p = a.params ?? {};
  const pendente = a.status === 'sugerida';
  const acionavel = pendente && a.kind !== 'rotate_creative';
  return (
    <div className={`border rounded-xl p-3 ${pendente ? 'bg-white border-amber-200' : 'bg-zinc-50/60 border-zinc-200'}`}>
      <div className="flex items-start gap-2.5">
        <KindIcon kind={a.kind} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-zinc-800">{KIND_LABEL[a.kind] ?? a.kind}</span>
            {a.level && <span className="text-[11px] text-zinc-400">{LEVEL_LABEL[a.level] ?? a.level}</span>}
            {a.target_name && <span className="text-xs font-semibold text-zinc-600 truncate max-w-[260px]" title={a.target_name}>{a.target_name}</span>}
            {a.kind === 'set_budget' && typeof p.daily_budget === 'number' && (
              <span className="text-xs font-bold text-amber-700">{typeof p.previous === 'number' ? `${brl(p.previous)} → ` : ''}{brl(p.daily_budget)}/dia</span>
            )}
            <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CLS[a.status] ?? ''}`}>{STATUS_LABEL[a.status] ?? a.status}{a.auto ? ' · automático' : ''}</span>
          </div>
          {a.reason && <p className="text-xs text-zinc-600 mt-1 leading-relaxed">{a.reason}</p>}
          {a.expected_impact && <p className="text-[11px] text-zinc-400 mt-0.5">Esperado: {a.expected_impact}</p>}
          {a.error && <p className="text-xs text-red-600 mt-1">Erro: {a.error}</p>}
          {a.kind === 'create_campaign' && (
            <button onClick={() => setAberto((v) => !v)} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 cursor-pointer">
              {aberto ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {aberto ? 'Esconder anúncio' : 'Ver o anúncio proposto'}
            </button>
          )}
          {a.kind === 'create_campaign' && aberto && (
            <div className="mt-2 grid sm:grid-cols-[120px_1fr] gap-3 bg-violet-50/60 border border-violet-100 rounded-lg p-3">
              {typeof p.photo_url === 'string' && p.photo_url
                ? <img src={p.photo_url} alt="" className="w-[120px] h-[120px] object-cover rounded-lg border border-violet-100" />
                : <div className="w-[120px] h-[120px] rounded-lg bg-white border border-dashed border-violet-200 flex items-center justify-center text-[11px] text-zinc-400">sem foto</div>}
              <div className="text-xs text-zinc-700 space-y-1">
                <p><span className="text-zinc-400">Campanha:</span> <strong>{String(p.campaign_name ?? '—')}</strong></p>
                <p><span className="text-zinc-400">Objetivo:</span> {String(p.objetivo ?? '—')} · <span className="text-zinc-400">Orçamento:</span> {typeof p.daily_budget === 'number' ? `${brl(p.daily_budget)}/dia` : '—'} · <span className="text-zinc-400">Raio:</span> {p.radius_km ? `${p.radius_km} km` : 'padrão'}</p>
                <p><span className="text-zinc-400">Título:</span> {String(p.headline ?? '—')}</p>
                <p><span className="text-zinc-400">Texto:</span> {String(p.primary_text ?? '—')}</p>
                {typeof p.description === 'string' && p.description && <p><span className="text-zinc-400">Descrição:</span> {p.description}</p>}
                <p><span className="text-zinc-400">Botão:</span> {String(p.cta ?? (p.objetivo === 'whatsapp' ? 'WHATSAPP_MESSAGE' : 'ORDER_NOW'))} · <span className="text-zinc-400">Prato:</span> {String(p.item_name ?? '—')}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`text-[11px] font-semibold ${RISK_CLS[a.risk] ?? ''}`}>risco {a.risk}</span>
            <span className="text-[11px] text-zinc-400">· {dataHora(a.created_at)}</span>
            {a.decided_by_name && <span className="text-[11px] text-zinc-400">· {a.status === 'rejeitada' ? 'rejeitada' : 'decidida'} por {a.decided_by_name} {dataHora(a.decided_at)}</span>}
            {pendente && onDecide && isAdmin && (
              <span className="ml-auto flex items-center gap-1.5">
                <button disabled={deciding === a.id} onClick={() => onDecide(a.id, 'rejeitar')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 cursor-pointer disabled:opacity-50">
                  <X size={12} /> {a.kind === 'rotate_creative' ? 'Dispensar' : 'Rejeitar'}
                </button>
                <button disabled={deciding === a.id} onClick={() => onDecide(a.id, 'aprovar')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg text-white cursor-pointer disabled:opacity-50 ${acionavel ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-sky-500 hover:bg-sky-600'}`}>
                  {deciding === a.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  {acionavel ? 'Aprovar e executar' : 'Vou providenciar'}
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Quadro real × sombra: mesma rodada, dois modelos. Compara nota de saúde, custo e quais ações
// coincidem (tipo + alvo). É o que decide se dá para trocar o modelo real sem perder qualidade.
function SombraCard({ real, sombra, acoesReais }: { real: Run; sombra: Run; acoesReais: Action[] }) {
  const [aberto, setAberto] = useState(false);
  const reais = new Map(acoesReais.map((a) => [chaveAcao(a), a]));
  const propostas = sombra.sombra_acoes ?? [];
  const iguais = propostas.filter((a) => reais.has(chaveAcao(a)));
  const soSombra = propostas.filter((a) => !reais.has(chaveAcao(a)));
  const soReal = acoesReais.filter((a) => !propostas.some((p) => chaveAcao(p) === chaveAcao(a)));
  const cReal = custoUsd(real.model, real.usage); const cSombra = custoUsd(sombra.model, sombra.usage);
  const dif = real.health_score !== null && sombra.health_score !== null ? sombra.health_score - real.health_score : null;
  return (
    <div className="mt-3 border border-violet-200 bg-violet-50/40 rounded-xl p-3 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <Bot size={14} className="text-violet-500" />
        <span className="font-bold text-violet-800">Sombra: {modeloNome(sombra.model)}</span>
        {sombra.status === 'error'
          ? <span className="text-red-600">falhou: {sombra.error}</span>
          : sombra.status !== 'done'
            ? <span className="text-zinc-400">ainda rodando…</span>
            : (
              <>
                <span className="text-zinc-600">saúde {sombra.health_score ?? '—'} <span className="text-zinc-400">(real {real.health_score ?? '—'}{dif !== null ? `, ${dif > 0 ? '+' : ''}${dif}` : ''})</span></span>
                <span className="text-zinc-600">· {iguais.length} de {Math.max(acoesReais.length, propostas.length)} ações iguais{soSombra.length ? `, ${soSombra.length} só na sombra` : ''}{soReal.length ? `, ${soReal.length} só na real` : ''}</span>
                <span className="text-zinc-600">· custo {usd(cSombra)} <span className="text-zinc-400">vs {usd(cReal)}{cReal && cSombra ? ` (${Math.round((1 - cSombra / cReal) * 100)}% ${cSombra < cReal ? 'mais barato' : 'mais caro'})` : ''}</span></span>
              </>
            )}
        {sombra.status === 'done' && (
          <button onClick={() => setAberto((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 cursor-pointer">
            {aberto ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {aberto ? 'Esconder' : 'Ver o que a sombra faria'}
          </button>
        )}
      </div>
      {aberto && sombra.status === 'done' && (
        <div className="mt-2 space-y-2">
          <p className="text-zinc-700 leading-relaxed whitespace-pre-line">{sombra.summary || 'Sem resumo.'}</p>
          {propostas.length > 0 && (
            <ul className="space-y-1">
              {propostas.map((a, i) => {
                const igual = reais.has(chaveAcao(a));
                return (
                  <li key={i} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 border ${igual ? 'bg-white border-emerald-200' : 'bg-white border-amber-200'}`}>
                    <KindIcon kind={a.kind} />
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold text-zinc-800">{KIND_LABEL[a.kind] ?? a.kind}</span>
                      {a.target_name && <span className="text-zinc-600"> · {a.target_name}</span>}
                      {a.kind === 'set_budget' && typeof a.params?.daily_budget === 'number' && <span className="text-amber-700 font-semibold"> · {brl(a.params.daily_budget as number)}/dia</span>}
                      <span className={`ml-2 text-[10px] font-semibold ${igual ? 'text-emerald-600' : 'text-amber-600'}`}>{igual ? 'igual à real' : 'só a sombra'}</span>
                      {a.reason && <span className="block text-zinc-500 mt-0.5">{a.reason}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {soReal.length > 0 && <p className="text-zinc-500">A real também propôs (e a sombra não): {soReal.map((a) => `${KIND_LABEL[a.kind] ?? a.kind}${a.target_name ? ` · ${a.target_name}` : ''}`).join('; ')}.</p>}
          {sombra.alerts?.length > 0 && <p className="text-zinc-500">Alertas da sombra: {sombra.alerts.join(' · ')}</p>}
        </div>
      )}
    </div>
  );
}

export function AgenteTab({ tenantId, isAdmin }: { tenantId: string; isAdmin: boolean }) {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<GetSettings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvoEm, setSalvoEm] = useState<number | null>(null);
  const [rodando, setRodando] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    setErro(null);
    const [s, r, a] = await Promise.all([
      invokeWithAuth<GetSettings>('meta-ads-agent', { body: { action: 'get_settings', tenant_id: tenantId } }),
      invokeWithAuth<{ success: boolean; runs: Run[] }>('meta-ads-agent', { body: { action: 'list_runs', tenant_id: tenantId, limit: 15 } }),
      invokeWithAuth<{ success: boolean; actions: Action[] }>('meta-ads-agent', { body: { action: 'list_actions', tenant_id: tenantId, limit: 80 } }),
    ]);
    if (s.error || !s.data?.success) { setErro(s.error?.message ?? s.data?.error ?? 'Não consegui carregar o agente (a função meta-ads-agent está publicada?)'); setLoading(false); return; }
    setInfo(s.data);
    setForm(s.data.settings);
    if (!s.data.settings.page_id && s.data.capabilities?.pages?.length === 1) {
      setForm({ ...s.data.settings, page_id: s.data.capabilities.pages[0].id, page_name: s.data.capabilities.pages[0].name });
      setMostrarConfig(true);
    }
    if (!s.data.settings.enabled) setMostrarConfig(true);
    setRuns(r.data?.runs ?? []);
    setActions(a.data?.actions ?? []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = async () => {
    if (!form) return;
    setSalvando(true); setErro(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; settings: Settings; error?: string }>('meta-ads-agent', { body: { action: 'save_settings', tenant_id: tenantId, settings: form } });
    setSalvando(false);
    if (error || !data?.success) { setErro(error?.message ?? data?.error ?? 'Não salvou'); return; }
    setForm(data.settings); setSalvoEm(Date.now());
    setInfo((i) => (i ? { ...i, settings: data.settings } : i));
  };

  const rodar = async () => {
    setRodando(true); setErro(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string; skipped?: boolean; reason?: string }>('meta-ads-agent', { body: { action: 'run', tenant_id: tenantId } });
    setRodando(false);
    if (error || !data?.success) setErro(error?.message ?? data?.error ?? data?.reason ?? 'A rodada falhou');
    await carregar();
  };

  const decidir = async (id: string, d: 'aprovar' | 'rejeitar') => {
    if (d === 'aprovar') {
      const a = actions.find((x) => x.id === id);
      const txt = a?.kind === 'create_campaign' ? 'Criar e ATIVAR esta campanha na Meta agora? Ela começa a gastar hoje.' : a?.kind === 'rotate_creative' ? 'Marcar como "vou providenciar"?' : `Executar "${KIND_LABEL[a?.kind ?? ''] ?? a?.kind}" em "${a?.target_name ?? ''}" na Meta agora?`;
      if (!(await confirmar({ titulo: txt, confirmarLabel: 'Executar' }))) return;
    }
    setDeciding(id); setErro(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; status: string; error?: string | null }>('meta-ads-agent', { body: { action: 'decide', tenant_id: tenantId, action_id: id, decision: d } });
    setDeciding(null);
    if (error || (!data?.success && d === 'aprovar')) setErro(error?.message ?? data?.error ?? 'Não consegui executar');
    const a = await invokeWithAuth<{ success: boolean; actions: Action[] }>('meta-ads-agent', { body: { action: 'list_actions', tenant_id: tenantId, limit: 80 } });
    setActions(a.data?.actions ?? []);
    setInfo((i) => (i ? { ...i, pending: (a.data?.actions ?? []).filter((x) => x.status === 'sugerida').length } : i));
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-zinc-400"><Loader2 size={24} className="animate-spin text-amber-500" /></div>;
  }
  if (!info || !form) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5" /> <span>{erro ?? 'Sem dados'}</span>
      </div>
    );
  }

  const caps = info.capabilities;
  const podeEscrever = !!caps?.ads_management;
  const pendentes = actions.filter((a) => a.status === 'sugerida');
  const historico = actions.filter((a) => a.status !== 'sugerida');
  // Rodadas sombra (outro modelo, só comparação) ficam fora da lista principal e viram um quadro ao lado da real.
  const runsReais = runs.filter((r) => r.trigger !== 'sombra');
  const sombraDe = (id: string) => runs.find((r) => r.trigger === 'sombra' && r.shadow_of === id) ?? null;
  const ultima = runsReais[0] ?? info.last_run;
  const sombraUltima = ultima ? sombraDe(ultima.id) : null;
  const modeloPadrao = info.default_model ?? 'claude-opus-5';
  // Custo das últimas rodadas carregadas, real × sombra (para o dono ver a diferença antes de trocar).
  const custoTotal = (lista: Run[]) => lista.reduce((acc, r) => acc + (custoUsd(r.model, r.usage) ?? 0), 0);
  const custoReal = custoTotal(runsReais); const custoSombra = custoTotal(runs.filter((r) => r.trigger === 'sombra'));
  const nSombra = runs.filter((r) => r.trigger === 'sombra' && r.status === 'done').length;
  const faltas: string[] = [];
  if (!podeEscrever) faltas.push('permissão ads_management no token (reconecte com a permissão marcada na configuração de Login da Meta)');
  if (!form.page_id) faltas.push('página do Facebook');
  if (!info.erpos.store_location) faltas.push('pin da loja em Config. Delivery (para o raio do anúncio)');
  if (form.objetivo === 'whatsapp' && !(form.whatsapp_number || info.erpos.whatsapp_loja)) faltas.push('número do WhatsApp');
  if (form.objetivo !== 'whatsapp' && !(form.destination_url || info.erpos.delivery_url)) faltas.push('link do delivery');
  if (!info.erpos.menu_items_with_photo) faltas.push('pelo menos um item do cardápio com foto');

  const F = (k: keyof Settings, v: unknown) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const inp = 'w-full text-sm border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-700 focus:outline-none focus:border-amber-400';
  const lbl = 'text-[11px] font-semibold text-zinc-500 mb-1 block';

  return (
    <div className="space-y-4">
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> <span>{erro}</span>
        </div>
      )}

      {/* Estado do agente */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div className={`w-11 h-11 flex items-center justify-center rounded-xl border ${form.enabled ? 'bg-violet-100 border-violet-200' : 'bg-zinc-100 border-zinc-200'}`}>
            <Bot size={22} className={form.enabled ? 'text-violet-600' : 'text-zinc-400'} />
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-black text-zinc-900">Gestor de tráfego (IA)</h2>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${form.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}>{form.enabled ? 'Ligado' : 'Desligado'}</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${form.mode === 'autonomo' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{form.mode === 'autonomo' ? 'Autônomo' : 'Só sugere'}</span>
              {ultima?.health_score !== undefined && <Health score={ultima?.health_score ?? null} />}
            </div>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              Todo dia às 08h30 lê a conta (7 e 30 dias) e os pedidos do ERPOS, aplica as regras de mercado para delivery
              (custo por resultado, fase de aprendizado, fadiga de criativo, escala de +20%, tetos de verba) e decide.
              {form.mode === 'autonomo'
                ? ' No modo autônomo, pausar/reativar/ajustar orçamento executam sozinhos' + (form.autonomia_criar ? ' e ele também cria campanha nova.' : '; criar campanha nova ainda pede sua aprovação.')
                : ' No modo "só sugere", nada muda na Meta sem você aprovar.'}
            </p>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-zinc-400 flex-wrap">
              <span>Última rodada: {ultima ? `${dataHora(ultima.started_at)} (${ultima.status === 'done' ? 'ok' : ultima.status})` : 'nunca'}</span>
              <span>Tetos: {brl(form.daily_budget_cap)}/dia · {brl(form.monthly_budget_cap)}/mês</span>
              <span>Objetivo: {form.objetivo === 'whatsapp' ? 'mensagens no WhatsApp' : form.objetivo === 'trafego' ? 'cliques no delivery' : 'vendas (pixel)'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setMostrarConfig((v) => !v)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 cursor-pointer">
              <Settings2 size={14} /> Configurar
            </button>
            <button onClick={rodar} disabled={rodando || !info.connection} title="Analisa agora, sem esperar o horário do dia"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold rounded-xl bg-violet-600 text-white hover:bg-violet-700 cursor-pointer disabled:opacity-50">
              {rodando ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {rodando ? 'Analisando (até 1 min)...' : 'Rodar agora'}
            </button>
          </div>
        </div>

        {/* Prontidão */}
        <div className="mt-3 flex items-start gap-2 text-xs rounded-lg px-3 py-2 border bg-zinc-50 border-zinc-200 text-zinc-600">
          {faltas.length === 0 ? <ShieldCheck size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" /> : <ShieldAlert size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />}
          <div>
            {faltas.length === 0
              ? <span>Pronto para agir: token com permissão de gestão, página, pin da loja e destino configurados.</span>
              : <span>Ele já analisa e sugere. Para <strong>criar anúncios</strong> ainda falta: {faltas.join('; ')}.</span>}
            {caps && <span className="block text-[11px] text-zinc-400 mt-0.5">Permissões do token: {caps.granted.join(', ') || 'nenhuma'}.</span>}
          </div>
        </div>
      </div>

      {/* Configuração */}
      {mostrarConfig && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Settings2 size={15} className="text-zinc-500" />
            <p className="text-sm font-bold text-zinc-800">Configuração</p>
            {!isAdmin && <span className="text-[11px] text-zinc-400">(só o admin da loja altera)</span>}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700 sm:col-span-2 lg:col-span-4">
              <input type="checkbox" checked={form.enabled} onChange={(e) => F('enabled', e.target.checked)} disabled={!isAdmin} className="w-4 h-4 accent-violet-600" />
              Agente ligado (roda todo dia às 08h30)
            </label>
            <div>
              <span className={lbl}>Modo</span>
              <select value={form.mode} onChange={(e) => F('mode', e.target.value)} disabled={!isAdmin} className={inp}>
                <option value="sugerir">Só sugere (eu aprovo cada ação)</option>
                <option value="autonomo">Autônomo (executa ações seguras)</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 mt-5">
              <input type="checkbox" checked={form.autonomia_criar} onChange={(e) => F('autonomia_criar', e.target.checked)} disabled={!isAdmin || form.mode !== 'autonomo'} className="w-4 h-4 accent-violet-600" />
              Pode criar campanha sozinho
            </label>
            <div>
              <span className={lbl}>Objetivo principal</span>
              <select value={form.objetivo} onChange={(e) => F('objetivo', e.target.value)} disabled={!isAdmin} className={inp}>
                <option value="whatsapp">Mensagens no WhatsApp (pedido direto)</option>
                <option value="trafego">Cliques no link do delivery</option>
                <option value="vendas">Vendas (precisa de pixel no cardápio)</option>
              </select>
            </div>
            <div>
              <span className={lbl}>Página do Facebook</span>
              {caps?.pages?.length ? (
                <select value={form.page_id ?? ''} onChange={(e) => { const p = caps.pages.find((x) => x.id === e.target.value); F('page_id', p?.id ?? null); setForm((f) => (f ? { ...f, page_id: p?.id ?? null, page_name: p?.name ?? null } : f)); }} disabled={!isAdmin} className={inp}>
                  <option value="">Escolha…</option>
                  {caps.pages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.instagram_id ? ' (com Instagram)' : ''}</option>)}
                </select>
              ) : (
                <input value={form.page_id ?? ''} onChange={(e) => F('page_id', e.target.value)} disabled={!isAdmin} placeholder="ID da página (o token não lista páginas)" className={inp} />
              )}
            </div>
            <div>
              <span className={lbl}>Teto diário (R$)</span>
              <input type="number" min={5} step={1} value={form.daily_budget_cap} onChange={(e) => F('daily_budget_cap', Number(e.target.value))} disabled={!isAdmin} className={inp} />
            </div>
            <div>
              <span className={lbl}>Teto mensal (R$)</span>
              <input type="number" min={30} step={10} value={form.monthly_budget_cap} onChange={(e) => F('monthly_budget_cap', Number(e.target.value))} disabled={!isAdmin} className={inp} />
            </div>
            <div>
              <span className={lbl}>Meta: custo por resultado (R$)</span>
              <input type="number" min={0.5} step={0.5} value={form.target_cpr ?? ''} onChange={(e) => F('target_cpr', e.target.value === '' ? null : Number(e.target.value))} disabled={!isAdmin}
                placeholder={info.erpos.orders_30d.ticket ? `auto: ${brl(Math.round(info.erpos.orders_30d.ticket * 0.3))} (30% do ticket)` : 'auto: R$ 15'} className={inp} />
            </div>
            <div>
              <span className={lbl}>Meta: ROAS mínimo (vendas ÷ gasto)</span>
              <input type="number" min={0.5} step={0.1} value={form.target_roas ?? ''} onChange={(e) => F('target_roas', e.target.value === '' ? null : Number(e.target.value))} disabled={!isAdmin} className={inp} />
            </div>
            <div>
              <span className={lbl}>Frequência máxima (7 dias)</span>
              <input type="number" min={1} step={0.5} value={form.max_frequency} onChange={(e) => F('max_frequency', Number(e.target.value))} disabled={!isAdmin} className={inp} />
            </div>
            <div>
              <span className={lbl}>Raio do anúncio (km)</span>
              <input type="number" min={1} max={80} step={0.5} value={form.radius_km ?? ''} onChange={(e) => F('radius_km', e.target.value === '' ? null : Number(e.target.value))} disabled={!isAdmin} placeholder="auto: área de entrega (3-8 km)" className={inp} />
            </div>
            <div>
              <span className={lbl}>Idade</span>
              <div className="flex items-center gap-1.5">
                <input type="number" min={18} max={65} value={form.age_min} onChange={(e) => F('age_min', Number(e.target.value))} disabled={!isAdmin} className={inp} />
                <span className="text-xs text-zinc-400">a</span>
                <input type="number" min={18} max={65} value={form.age_max} onChange={(e) => F('age_max', Number(e.target.value))} disabled={!isAdmin} className={inp} />
              </div>
            </div>
            <div>
              <span className={lbl}>WhatsApp dos anúncios</span>
              <input value={form.whatsapp_number ?? ''} onChange={(e) => F('whatsapp_number', e.target.value)} disabled={!isAdmin} placeholder={info.erpos.whatsapp_loja ? `padrão: ${info.erpos.whatsapp_loja}` : '55DDDNÚMERO'} className={inp} />
            </div>
            <div className="sm:col-span-2">
              <span className={lbl}>Link do delivery</span>
              <input value={form.destination_url ?? ''} onChange={(e) => F('destination_url', e.target.value)} disabled={!isAdmin} placeholder={info.erpos.delivery_url ? `padrão: ${info.erpos.delivery_url}` : 'https://...'} className={inp} />
            </div>
            <div>
              <span className={lbl}>Modelo da IA (rodada real)</span>
              <select value={form.model ?? ''} onChange={(e) => F('model', e.target.value || null)} disabled={!isAdmin} className={inp}>
                <option value="">Padrão ({modeloNome(modeloPadrao)})</option>
                {(Object.keys(MODEL_LABEL) as ModelId[]).map((m) => <option key={m} value={m}>{MODEL_LABEL[m]} · US$ {PRECO_USD[m].in}/{PRECO_USD[m].out} por 1M tokens</option>)}
              </select>
            </div>
            <div>
              <span className={lbl}>Modo sombra (só compara, não executa)</span>
              <select value={form.shadow_model ?? ''} onChange={(e) => F('shadow_model', e.target.value || null)} disabled={!isAdmin} className={inp}>
                <option value="">Desligado</option>
                {(Object.keys(MODEL_LABEL) as ModelId[]).filter((m) => m !== (form.model ?? modeloPadrao)).map((m) => <option key={m} value={m}>{MODEL_LABEL[m]} roda em paralelo</option>)}
              </select>
              <span className="text-[10px] text-zinc-400 leading-tight block mt-0.5">Roda o outro modelo sobre os mesmos dados e guarda o que ele decidiria. Use 1–2 semanas antes de trocar o modelo real.</span>
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <span className={lbl}>Contexto da loja para a IA (diferenciais, tom de voz, pratos que quer empurrar, o que evitar)</span>
              <textarea value={form.store_context ?? ''} onChange={(e) => F('store_context', e.target.value)} disabled={!isAdmin} rows={3} maxLength={2000}
                placeholder="Ex.: Somos hamburgueria artesanal, entrega em 40 min, carro-chefe é o Smash Duplo. Evitar promoções de cerveja. Tom descontraído." className={inp} />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button onClick={salvar} disabled={salvando || !isAdmin} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl bg-amber-500 text-white hover:bg-amber-600 cursor-pointer disabled:opacity-50">
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar
            </button>
            {salvoEm && Date.now() - salvoEm < 5000 && <span className="text-xs text-emerald-600 font-semibold">Salvo.</span>}
            <span className="text-[11px] text-zinc-400 ml-auto">Loja: {info.erpos.store.name}{info.erpos.store.city ? ` · ${info.erpos.store.city}` : ''} · {info.erpos.orders_30d.count} pedidos de delivery em 30 dias, ticket {brl(info.erpos.orders_30d.ticket)}.</span>
          </div>
        </div>
      )}

      {/* Última análise */}
      {ultima && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Sparkles size={15} className="text-violet-500" />
            <p className="text-sm font-bold text-zinc-800">Última análise</p>
            <span className="text-[11px] text-zinc-400">{dataHora(ultima.started_at)} · {ultima.trigger === 'cron' ? 'automática' : ultima.trigger === 'manual' ? 'manual' : ultima.trigger}</span>
            <Health score={ultima.health_score} />
            <span className="text-[11px] text-zinc-400 ml-auto">{ultima.actions_total} ação(ões), {ultima.actions_executed} executada(s)</span>
          </div>
          {(ultima.model || ultima.usage) && (
            <p className="text-[11px] text-zinc-400 mb-2">IA: {modeloNome(ultima.model)} · {tokens(ultima.usage)} · ≈ {usd(custoUsd(ultima.model, ultima.usage))} nesta rodada</p>
          )}
          {ultima.status === 'error'
            ? <p className="text-sm text-red-600">Falhou: {ultima.error}</p>
            : <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-line">{ultima.summary || 'Sem resumo.'}</p>}
          {sombraUltima && <SombraCard real={ultima} sombra={sombraUltima} acoesReais={actions.filter((a) => a.run_id === ultima.id)} />}
          {form.shadow_model && !sombraUltima && ultima.status === 'done' && (
            <p className="text-[11px] text-zinc-400 mt-2">Modo sombra ligado ({modeloNome(form.shadow_model)}): a comparação aparece aqui depois da próxima rodada (a sombra termina 1–2 min depois da real).</p>
          )}
          {ultima.alerts?.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {ultima.alerts.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 border bg-amber-50 border-amber-100 text-amber-800">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Pendências */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={15} className="text-amber-500" />
          <p className="text-sm font-bold text-zinc-800">Aguardando sua decisão</p>
          <span className="text-xs text-zinc-400">({pendentes.length})</span>
          <button onClick={carregar} className="ml-auto text-zinc-400 hover:text-zinc-600 cursor-pointer" title="Atualizar"><RefreshCw size={14} /></button>
        </div>
        {pendentes.length === 0
          ? <p className="text-xs text-zinc-400">Nada pendente. {ultima ? 'O agente não viu motivo para mexer, ou já executou o que podia.' : 'Clique em "Rodar agora" para a primeira análise.'}</p>
          : <div className="flex flex-col gap-2">{pendentes.map((a) => <ActionCard key={a.id} a={a} onDecide={decidir} deciding={deciding} isAdmin={isAdmin} />)}</div>}
        {pendentes.length > 0 && !isAdmin && <p className="text-[11px] text-zinc-400 mt-2">Só o admin da loja aprova ou rejeita.</p>}
      </div>

      {/* Histórico */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-4">
        <button onClick={() => setMostrarHistorico((v) => !v)} className="flex items-center gap-2 w-full text-left cursor-pointer">
          <History size={15} className="text-zinc-500" />
          <p className="text-sm font-bold text-zinc-800">Histórico</p>
          <span className="text-xs text-zinc-400">{historico.length} ação(ões) · {runsReais.length} rodada(s)</span>
          {custoReal > 0 && (
            <span className="text-[11px] text-zinc-400 hidden sm:inline">· IA: ≈ {usd(custoReal)} nas últimas {runsReais.length} rodadas{nSombra ? ` (sombra: ≈ ${usd(custoSombra)} em ${nSombra})` : ''}</span>
          )}
          {mostrarHistorico ? <ChevronUp size={14} className="ml-auto text-zinc-400" /> : <ChevronDown size={14} className="ml-auto text-zinc-400" />}
        </button>
        {mostrarHistorico && (
          <div className="mt-3 space-y-4">
            {historico.length > 0 && <div className="flex flex-col gap-2">{historico.slice(0, 40).map((a) => <ActionCard key={a.id} a={a} deciding={null} isAdmin={isAdmin} />)}</div>}
            {runsReais.length > 1 && (
              <div>
                <p className="text-xs font-bold text-zinc-600 mb-1.5">Rodadas anteriores</p>
                <ul className="divide-y divide-zinc-100 border border-zinc-100 rounded-lg">
                  {runsReais.slice(1).map((r) => {
                    const sb = sombraDe(r.id);
                    return (
                      <li key={r.id} className="px-3 py-2 text-xs text-zinc-600">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{dataHora(r.started_at)}</span>
                          <span className="text-zinc-400">{r.trigger === 'cron' ? 'automática' : r.trigger}</span>
                          <Health score={r.health_score} />
                          {r.model && <span className="text-zinc-400">{modeloNome(r.model)} ≈ {usd(custoUsd(r.model, r.usage))}</span>}
                          {sb && sb.status === 'done' && <span className="text-violet-500">sombra {modeloNome(sb.model)}: saúde {sb.health_score ?? '—'}, {sb.actions_total} ação(ões), ≈ {usd(custoUsd(sb.model, sb.usage))}</span>}
                          <span className="text-zinc-400 ml-auto">{r.actions_total} ação(ões) · {r.actions_executed} executada(s){r.status === 'error' ? ' · erro' : ''}</span>
                        </div>
                        {r.summary && <p className="mt-1 text-zinc-500 line-clamp-3">{r.summary}</p>}
                        {r.error && <p className="mt-1 text-red-600">{r.error}</p>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {historico.length === 0 && runsReais.length <= 1 && <p className="text-xs text-zinc-400">Ainda não há histórico.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
