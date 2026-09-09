// Quebras por aparelho e região, distribuição de frequência, públicos salvos e avisos/recomendações da Meta.
import { Smartphone, Map, Gauge, Users, Sparkles, AlertTriangle } from 'lucide-react';
import {
  brl, num, dec, pct, dataCurta, linkCtr, linkCpc, deviceLabel,
  ChartCard, SemDados, MiniTable, Roas, AUDIENCE_SUBTYPE,
  type DeviceRow, type RegionRow, type FrequencyRow, type AudienceRow, type Recomendacao,
} from '../shared';

// ─── Aparelho e região ───────────────────────────────────────────────────────
export function AparelhoRegiaoCards({
  devicePlatform, impressionDevice, region, cidadeLoja,
}: {
  devicePlatform: DeviceRow[] | null | undefined;
  impressionDevice: DeviceRow[] | null | undefined;
  region: RegionRow[] | null | undefined;
  cidadeLoja: string | null | undefined;
}) {
  const dp = [...(devicePlatform ?? [])].filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend);
  const idv = [...(impressionDevice ?? [])].filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 6);
  const reg = [...(region ?? [])].filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 10);
  if (dp.length === 0 && idv.length === 0 && reg.length === 0) return null;

  const linhaDev = (r: DeviceRow) => [
    deviceLabel(r.device),
    brl(r.spend),
    <span className="font-semibold text-emerald-600">{num(r.purchases)}</span>,
    <Roas v={r.roas} spend={r.spend} />,
    pct(linkCtr(r)),
    brl(linkCpc(r)),
  ];

  // Pior aparelho em taxa de compra por clique — dica de página pesada.
  const compraPorClique = (r: DeviceRow) => (r.link_clicks ? r.purchases / r.link_clicks : 0);
  const idvComClique = idv.filter((r) => r.link_clicks >= 30);
  const melhor = idvComClique.length > 1 ? idvComClique.reduce((m, r) => (compraPorClique(r) > compraPorClique(m) ? r : m)) : null;
  const pior = idvComClique.length > 1 ? idvComClique.reduce((m, r) => (compraPorClique(r) < compraPorClique(m) ? r : m)) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <ChartCard icon={Smartphone} titulo="Por aparelho">
        {dp.length === 0 && idv.length === 0 ? <SemDados /> : (
          <>
            {dp.length > 0 && <MiniTable cabecalho={['Plataforma', 'Investido', 'Compras', 'ROAS', 'CTR link', 'CPC link']} linhas={dp.map(linhaDev)} />}
            {idv.length > 0 && (
              <div className="mt-3">
                <MiniTable cabecalho={['Aparelho', 'Investido', 'Compras', 'ROAS', 'CTR link', 'CPC link']} linhas={idv.map(linhaDev)} />
              </div>
            )}
            {melhor && pior && melhor.device !== pior.device && compraPorClique(pior) < compraPorClique(melhor) * 0.5 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
                {deviceLabel(pior.device)} converte {dec(compraPorClique(pior) * 100, 1)}% dos cliques em compra, contra {dec(compraPorClique(melhor) * 100, 1)}% em {deviceLabel(melhor.device)}.
                Diferença assim costuma ser a página pesando no aparelho mais fraco.
              </p>
            )}
          </>
        )}
      </ChartCard>

      <ChartCard icon={Map} titulo="Por região">
        {reg.length === 0 ? <SemDados /> : (
          <>
            <MiniTable
              cabecalho={['Região', 'Investido', 'Compras', 'ROAS', 'CTR link']}
              linhas={reg.map((r) => [
                <span>{r.region || r.country}{r.region && r.country && r.country !== 'BR' ? ` (${r.country})` : ''}</span>,
                brl(r.spend),
                <span className="font-semibold text-emerald-600">{num(r.purchases)}</span>,
                <Roas v={r.roas} spend={r.spend} />,
                pct(linkCtr(r)),
              ])}
            />
            <p className="text-[11px] text-zinc-400 mt-2">
              A Meta só abre por estado. {cidadeLoja ? `A loja entrega em ${cidadeLoja}; ` : ''}gasto em outro estado é alcance fora da área de entrega.
            </p>
          </>
        )}
      </ChartCard>
    </div>
  );
}

// ─── Distribuição de frequência ──────────────────────────────────────────────
export function FrequenciaCard({ rows, freqMedia }: { rows: FrequencyRow[] | null | undefined; freqMedia: number }) {
  const lista = [...(rows ?? [])].filter((r) => r.reach > 0);
  if (lista.length === 0) return null;
  // Ordena numericamente ("10+" por último).
  const ord = (b: string) => (b.endsWith('+') ? 999 : Number(b) || 0);
  lista.sort((a, b) => ord(a.bucket) - ord(b.bucket));
  const totalReach = lista.reduce((s, r) => s + r.reach, 0);
  const max = Math.max(...lista.map((r) => r.reach), 1);
  const saturados = lista.filter((r) => ord(r.bucket) >= 5).reduce((s, r) => s + r.reach, 0);
  const pctSat = totalReach ? (saturados / totalReach) * 100 : 0;
  const gastoSat = lista.filter((r) => ord(r.bucket) >= 5).reduce((s, r) => s + r.spend, 0);

  return (
    <ChartCard icon={Gauge} titulo={`Quantas vezes cada pessoa viu (média ${dec(freqMedia, 2)}x)`} className="mb-4">
      <div className="flex flex-col gap-1.5">
        {lista.map((r) => (
          <div key={r.bucket} className="flex items-center gap-2 text-xs">
            <span className="w-9 text-right font-bold text-zinc-600 tabular-nums">{r.bucket}x</span>
            <div className="flex-1 h-4 rounded bg-zinc-100 overflow-hidden">
              <div className={`h-full rounded ${ord(r.bucket) >= 5 ? 'bg-red-400' : 'bg-sky-500'}`} style={{ width: `${Math.max((r.reach / max) * 100, 1.5)}%` }} />
            </div>
            <span className="w-16 text-right tabular-nums text-zinc-700 font-semibold">{num(r.reach)}</span>
            <span className="w-12 text-right tabular-nums text-zinc-400">{dec(totalReach ? (r.reach / totalReach) * 100 : 0, 0)}%</span>
            <span className="w-20 text-right tabular-nums text-zinc-400 hidden sm:inline">{brl(r.spend)}</span>
          </div>
        ))}
      </div>
      <p className={`text-[11px] mt-3 leading-relaxed ${pctSat >= 25 ? 'text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2' : 'text-zinc-400'}`}>
        {dec(pctSat, 0)}% das pessoas viram o anúncio 5 vezes ou mais ({brl(gastoSat)} investidos nelas).
        {pctSat >= 25
          ? ' Público saturado: quem viu cinco vezes e não comprou dificilmente compra na sexta. Ampliar o público ou trocar o criativo costuma render mais do que insistir.'
          : ' Distribuição saudável: a maior parte do alcance ainda está nas primeiras exposições.'}
      </p>
    </ChartCard>
  );
}

// ─── Públicos salvos ─────────────────────────────────────────────────────────
export function PublicosCard({ audiences }: { audiences: AudienceRow[] | null | undefined }) {
  const lista = (audiences ?? []).filter((a) => a.name);
  if (lista.length === 0) return null;
  const tamanho = (a: AudienceRow) => {
    if (a.size_low === null && a.size_high === null) return 'abaixo de 1.000';
    if (a.size_low !== null && a.size_high !== null && a.size_low !== a.size_high) return `${num(a.size_low)} a ${num(a.size_high)}`;
    return num(a.size_high ?? a.size_low ?? 0);
  };
  return (
    <ChartCard icon={Users} titulo="Públicos salvos na conta" className="mb-4">
      <MiniTable
        cabecalho={['Público', 'Tipo', 'Tamanho aprox.', 'Atualizado']}
        linhas={lista.map((a) => [
          <span className="truncate max-w-[260px] inline-block" title={a.name}>{a.name}</span>,
          <span className="text-zinc-500">{AUDIENCE_SUBTYPE[a.subtype] ?? a.subtype.toLowerCase()}</span>,
          tamanho(a),
          <span className="text-zinc-500">{dataCurta(a.updated)}</span>,
        ])}
      />
      <p className="text-[11px] text-zinc-400 mt-2">Públicos de retargeting (quem visitou o site, quem comprou) precisam de algumas centenas de pessoas pra Meta conseguir entregar. Abaixo de mil a estimativa some.</p>
    </ChartCard>
  );
}

// ─── Avisos e recomendações da Meta ──────────────────────────────────────────
export interface AvisoLinha { origem: string; nome: string; tipo: 'problema' | 'recomendacao'; texto: string; titulo?: string }

export function RecomendacoesCard({ linhas }: { linhas: AvisoLinha[] }) {
  if (linhas.length === 0) return null;
  const problemas = linhas.filter((l) => l.tipo === 'problema');
  const recs = linhas.filter((l) => l.tipo === 'recomendacao');
  return (
    <ChartCard icon={Sparkles} titulo="O que a própria Meta está apontando" className="mb-4">
      {problemas.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">Problemas de veiculação ({problemas.length})</p>
          <ul className="space-y-1">
            {problemas.map((l, i) => (
              <li key={i} className="text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-red-700 flex gap-2">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                <span><span className="font-semibold">{l.origem} · {l.nome}:</span> {l.texto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recs.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Recomendações ({recs.length})</p>
          <ul className="space-y-1">
            {recs.map((l, i) => (
              <li key={i} className="text-xs bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2 text-zinc-700 flex gap-2">
                <Sparkles size={13} className="mt-0.5 flex-shrink-0 text-amber-500" />
                <span><span className="font-semibold">{l.origem} · {l.nome}:</span> {l.titulo ? <strong className="font-semibold">{l.titulo}</strong> : null}{l.titulo && l.texto ? ' — ' : ''}{l.texto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-zinc-400 mt-3">Recomendações da Meta tendem a pedir mais orçamento e público maior. Vale ler com a conta na mão: nem toda sugestão serve pra uma loja com área de entrega fixa.</p>
    </ChartCard>
  );
}

// Junta problemas/recomendações de campanhas, conjuntos e anúncios numa lista só, sem repetir texto.
export function montarAvisos(
  campaigns: Array<{ campaign: string; issues?: string[]; recommendations?: Recomendacao[] }>,
  adsets: Array<{ adset: string; issues?: string[]; recommendations?: Recomendacao[] }> | null | undefined,
  ads: Array<{ ad: string; issues?: string[]; recommendations?: Recomendacao[] }> | null | undefined,
): AvisoLinha[] {
  const out: AvisoLinha[] = [];
  const visto = new Set<string>();
  const add = (l: AvisoLinha) => { const k = `${l.tipo}|${l.nome}|${l.texto}|${l.titulo ?? ''}`; if (!visto.has(k)) { visto.add(k); out.push(l); } };
  campaigns.forEach((c) => { (c.issues ?? []).forEach((t) => add({ origem: 'Campanha', nome: c.campaign, tipo: 'problema', texto: t })); (c.recommendations ?? []).forEach((r) => add({ origem: 'Campanha', nome: c.campaign, tipo: 'recomendacao', titulo: r.title, texto: r.message })); });
  (adsets ?? []).forEach((c) => { (c.issues ?? []).forEach((t) => add({ origem: 'Conjunto', nome: c.adset, tipo: 'problema', texto: t })); (c.recommendations ?? []).forEach((r) => add({ origem: 'Conjunto', nome: c.adset, tipo: 'recomendacao', titulo: r.title, texto: r.message })); });
  (ads ?? []).forEach((c) => { (c.issues ?? []).forEach((t) => add({ origem: 'Anúncio', nome: c.ad, tipo: 'problema', texto: t })); (c.recommendations ?? []).forEach((r) => add({ origem: 'Anúncio', nome: c.ad, tipo: 'recomendacao', titulo: r.title, texto: r.message })); });
  return out.slice(0, 30);
}
