// Prévia do anúncio (iframe da Meta) com criativo, notas de qualidade, retenção de vídeo e
// comentários; card de retenção de vídeo; card de desempenho por peça criativa.
import { useEffect, useState } from 'react';
import { X, Loader2, Eye, MessageCircle, Film, Image as ImageIcon, AlertTriangle, Sparkles, ExternalLink } from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';
import {
  brl, num, dec, pct, dataHora, linkCtr, linkCpc,
  ChartCard, SemDados, MiniTable, Roas, RankingBadge,
  type AdBase, type CommentsInfo, type AssetsBreakdown, type AssetRow,
} from '../shared';

const FORMATOS = [
  { value: 'MOBILE_FEED_STANDARD', label: 'Feed (celular)' },
  { value: 'INSTAGRAM_STANDARD', label: 'Instagram' },
  { value: 'INSTAGRAM_STORY', label: 'Stories' },
  { value: 'INSTAGRAM_REELS', label: 'Reels' },
  { value: 'DESKTOP_FEED_STANDARD', label: 'Feed (computador)' },
];

export function RankingsInline({ ad }: { ad: AdBase }) {
  if (!ad.rankings) return null;
  return (
    <div className="flex flex-wrap gap-1">
      <RankingBadge value={ad.rankings.quality} titulo="Qualidade" />
      <RankingBadge value={ad.rankings.engagement} titulo="Engaj." />
      <RankingBadge value={ad.rankings.conversion} titulo="Conversão" />
    </div>
  );
}

// ─── Prévia + detalhe do anúncio ─────────────────────────────────────────────
export function PreviaModal({
  ad, tenantId, comments, onClose,
}: {
  ad: AdBase;
  tenantId: string;
  comments: CommentsInfo | null | undefined;
  onClose: () => void;
}) {
  const [formato, setFormato] = useState(FORMATOS[0].value);
  const [html, setHtml] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    setHtml(null);
    invokeWithAuth<{ success: boolean; html?: string; error?: string }>('meta-connect', {
      body: { action: 'ad_preview', tenant_id: tenantId, ad_id: ad.ad_id, ad_format: formato },
    }).then(({ data, error }) => {
      if (!vivo) return;
      if (error || !data?.success || !data.html) setErro(data?.error ?? error?.message ?? 'A Meta não devolveu a prévia.');
      else setHtml(data.html);
      setCarregando(false);
    });
    return () => { vivo = false; };
  }, [ad.ad_id, formato, tenantId]);

  const c = ad.creative;
  const v = ad.video;
  const com = comments?.by_ad?.[ad.ad_id];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <Eye size={17} className="text-amber-500" />
          <div className="min-w-0">
            <p className="text-base font-bold text-zinc-800 truncate">{ad.ad}</p>
            <p className="text-[11px] text-zinc-400 truncate">{ad.adset} · {ad.campaign}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-zinc-600 cursor-pointer" aria-label="Fechar"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_1fr] gap-5 p-5">
          {/* Prévia */}
          <div>
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {FORMATOS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFormato(f.value)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${formato === f.value ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 min-h-[420px] flex items-center justify-center overflow-hidden">
              {carregando ? (
                <Loader2 size={22} className="animate-spin text-amber-500" />
              ) : erro ? (
                <p className="text-xs text-zinc-500 px-4 text-center">{erro}</p>
              ) : html ? (
                // A Meta devolve um <iframe> apontando pra ela mesma; é o mesmo que o Gerenciador usa.
                <div className="w-full flex justify-center [&_iframe]:max-w-full" dangerouslySetInnerHTML={{ __html: html }} />
              ) : null}
            </div>
          </div>

          {/* Detalhe */}
          <div className="text-sm">
            <div className="flex items-start gap-3 mb-3">
              {ad.thumbnail_url && <img src={ad.thumbnail_url} alt="" className="w-14 h-14 rounded-lg object-cover border border-zinc-100 flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <RankingsInline ad={ad} />
                <p className="text-[11px] text-zinc-400 mt-1">Notas comparam com anúncios que disputam o mesmo público. Aparecem acima de 500 impressões.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {[
                ['Investido', brl(ad.spend)],
                ['Compras', num(ad.purchases ?? 0)],
                ['Vendas', brl(ad.purchase_value ?? 0)],
                ['ROAS', ad.spend ? `${dec(ad.roas ?? 0, 2)}x` : '—'],
                ['Cliques no link', num(ad.link_clicks)],
                ['CTR link', pct(linkCtr(ad))],
                ['CPC link', brl(linkCpc(ad))],
                ['Frequência', `${dec(ad.frequency, 2)}x`],
              ].map(([l, vv]) => (
                <div key={l} className="rounded-lg bg-zinc-50 border border-zinc-100 px-2.5 py-1.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">{l}</p>
                  <p className="text-sm font-black text-zinc-800 tabular-nums">{vv}</p>
                </div>
              ))}
            </div>

            {c && (c.title || c.body) && (
              <div className="mb-4">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Texto do anúncio</p>
                {c.title && <p className="font-semibold text-zinc-800">{c.title}</p>}
                {c.body && <p className="text-zinc-600 whitespace-pre-line text-xs mt-1 max-h-32 overflow-y-auto">{c.body}</p>}
                {c.description && <p className="text-zinc-400 text-xs mt-1">{c.description}</p>}
                <p className="text-[11px] text-zinc-400 mt-1.5">
                  {c.cta && <>Botão: <strong className="font-semibold text-zinc-600">{c.cta.replace(/_/g, ' ').toLowerCase()}</strong></>}
                  {c.link && (
                    <> · <a href={c.link} target="_blank" rel="noreferrer" className="text-amber-600 font-semibold inline-flex items-center gap-0.5">destino <ExternalLink size={10} /></a>
                      {!/utm_source=/.test(c.link) && <span className="text-red-500 font-semibold"> · sem utm_source</span>}
                    </>
                  )}
                </p>
              </div>
            )}

            {v && v.plays > 0 && (
              <div className="mb-4">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Film size={11} /> Retenção do vídeo · {num(v.plays)} reproduções · média {dec(v.avg_seconds, 1)}s</p>
                <RetencaoBarras v={v} />
              </div>
            )}

            {(ad.issues?.length || ad.recommendations?.length) ? (
              <div className="mb-4">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Avisos da Meta</p>
                <ul className="space-y-1 text-xs">
                  {ad.issues?.map((t, i) => <li key={`i${i}`} className="text-red-600 flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{t}</li>)}
                  {ad.recommendations?.map((r, i) => <li key={`r${i}`} className="text-zinc-700 flex gap-1.5"><Sparkles size={12} className="mt-0.5 flex-shrink-0 text-amber-500" /><span><strong className="font-semibold">{r.title}</strong>{r.message ? ` — ${r.message}` : ''}</span></li>)}
                </ul>
              </div>
            ) : null}

            <div>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 flex items-center gap-1"><MessageCircle size={11} /> Comentários na publicação{com ? ` · ${num(com.total)}` : ''}</p>
              {comments && !comments.available ? (
                <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2 leading-relaxed">
                  Para ler os comentários a conexão com a Meta precisa das permissões <span className="font-mono">pages_show_list</span> e{' '}
                  <span className="font-mono">pages_read_engagement</span>. Adicione as duas na configuração de login do app
                  (Login do Facebook para Empresas → Configurações) e clique em Desconectar e Conectar de novo aqui.
                </p>
              ) : !c?.story_id ? (
                <p className="text-xs text-zinc-400">Este anúncio não é uma publicação com comentários.</p>
              ) : !com ? (
                <p className="text-xs text-zinc-400">Comentários carregados só para os anúncios com mais investimento.</p>
              ) : com.latest.length === 0 ? (
                <p className="text-xs text-zinc-400">Nenhum comentário.</p>
              ) : (
                <ul className="space-y-1.5">
                  {com.latest.map((m, i) => (
                    <li key={i} className="text-xs bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2">
                      <p className="text-zinc-700">{m.message || <span className="text-zinc-400">(sem texto)</span>}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">{m.from} · {dataHora(m.created_time)}{m.likes ? ` · ${m.likes} curtida${m.likes > 1 ? 's' : ''}` : ''}</p>
                    </li>
                  ))}
                  {com.total > com.latest.length && <li className="text-[11px] text-zinc-400">…e mais {num(com.total - com.latest.length)} no Facebook/Instagram.</li>}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RetencaoBarras({ v }: { v: { plays: number; p25: number; p50: number; p75: number; p100: number } }) {
  const passos = [['25%', v.p25], ['50%', v.p50], ['75%', v.p75], ['100%', v.p100]] as const;
  return (
    <div className="flex items-end gap-2 h-16">
      {passos.map(([l, n]) => {
        const p = v.plays ? (n / v.plays) * 100 : 0;
        return (
          <div key={l} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
            <span className="text-[10px] font-bold text-zinc-600 tabular-nums">{dec(p, 0)}%</span>
            <div className="w-full bg-zinc-100 rounded-t flex-1 flex items-end"><div className="w-full rounded-t bg-sky-500" style={{ height: `${Math.max(p, 2)}%` }} /></div>
            <span className="text-[10px] text-zinc-400">{l}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Card de retenção de vídeo (anúncios com vídeo) ──────────────────────────
export function RetencaoVideoCard({ ads, onAbrir }: { ads: AdBase[] | null | undefined; onAbrir?: (ad: AdBase) => void }) {
  const comVideo = (ads ?? []).filter((a) => a.video && a.video.plays > 0).sort((a, b) => (b.video?.plays ?? 0) - (a.video?.plays ?? 0)).slice(0, 6);
  if (comVideo.length === 0) return null;
  return (
    <ChartCard icon={Film} titulo="Retenção de vídeo" className="mb-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {comVideo.map((a) => (
          <div key={a.ad_id} className="border border-zinc-100 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              {a.thumbnail_url && <img src={a.thumbnail_url} alt="" className="w-8 h-8 rounded object-cover" />}
              <button onClick={() => onAbrir?.(a)} className="text-xs font-semibold text-zinc-800 truncate text-left hover:text-amber-600 cursor-pointer" title="Abrir prévia">{a.ad}</button>
              <span className="ml-auto text-[11px] text-zinc-400 whitespace-nowrap">{num(a.video!.plays)} reprod. · {dec(a.video!.avg_seconds, 1)}s</span>
            </div>
            <RetencaoBarras v={a.video!} />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-zinc-400 mt-3">Percentual de quem começou a ver e chegou a cada marca. A queda mais brusca mostra o segundo em que o vídeo perde a pessoa.</p>
    </ChartCard>
  );
}

// ─── Desempenho por peça criativa ────────────────────────────────────────────
export function PecasCriativasCard({ assets }: { assets: AssetsBreakdown | null | undefined }) {
  const [aba, setAba] = useState<keyof AssetsBreakdown>('image');
  if (!assets) return null;
  const abas: Array<{ k: keyof AssetsBreakdown; label: string }> = [
    { k: 'image', label: 'Imagens' }, { k: 'title', label: 'Títulos' }, { k: 'body', label: 'Textos' }, { k: 'cta', label: 'Botões' },
  ];
  const temAlgo = abas.some((x) => (assets[x.k] ?? []).length > 0);
  if (!temAlgo) return null;
  const linhas: AssetRow[] = [...(assets[aba] ?? [])].filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 10);

  return (
    <ChartCard
      icon={ImageIcon}
      titulo="Por peça criativa"
      className="mb-4"
      extra={(
        <div className="flex gap-1">
          {abas.map((x) => (
            <button key={x.k} onClick={() => setAba(x.k)} className={`px-2 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${aba === x.k ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-zinc-600 border-zinc-200'}`}>
              {x.label} <span className="opacity-70">({(assets[x.k] ?? []).length})</span>
            </button>
          ))}
        </div>
      )}
    >
      {linhas.length === 0 ? <SemDados texto="Sem peças desse tipo no período (só campanhas com criativo dinâmico separam por peça)" /> : (
        <MiniTable
          cabecalho={['Peça', 'Investido', 'Compras', 'ROAS', 'Custo/compra', 'CTR link', 'CPC link']}
          linhas={linhas.map((r) => [
            <span className="inline-flex items-center gap-2 max-w-[320px]">
              {r.url && <img src={r.url} alt="" className="w-8 h-8 rounded object-cover border border-zinc-100 flex-shrink-0" />}
              <span className="truncate" title={r.label}>{r.label}</span>
            </span>,
            brl(r.spend),
            <span className="font-semibold text-emerald-600">{num(r.purchases)}</span>,
            <Roas v={r.roas} spend={r.spend} />,
            r.cost_per_purchase ? brl(r.cost_per_purchase) : '—',
            pct(linkCtr(r)),
            brl(linkCpc(r)),
          ])}
        />
      )}
      <p className="text-[11px] text-zinc-400 mt-2">A Meta só separa por peça em anúncios com criativo dinâmico (várias imagens/títulos no mesmo anúncio). Fora isso, o desempenho fica por anúncio na tabela abaixo.</p>
    </ChartCard>
  );
}
