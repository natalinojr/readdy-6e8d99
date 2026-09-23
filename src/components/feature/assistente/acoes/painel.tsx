// Peças de "dashboard" para as ações rápidas (2026-09-18): em vez de texto corrido no balão, a
// resposta vira um painel — números em destaque, barras com a participação e ranking. Mostrado com
// `painel()` do useRoteiro (kit.tsx). Uma cor por série; o número vem escrito ao lado da barra
// (nada de legenda para decifrar) e tudo cabe na largura do celular.
import { useState, type ReactNode } from 'react';
import { brl } from './kit';

export function Painel({ titulo, subtitulo, children, rodape }: { titulo: string; subtitulo?: string; children: ReactNode; rodape?: string }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-3.5 space-y-4">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{subtitulo}</p>
        <p className="text-base font-black text-zinc-900 leading-tight">{titulo}</p>
      </header>
      {children}
      {rodape && <p className="text-[11px] text-zinc-400">{rodape}</p>}
    </section>
  );
}

/** Variação contra uma base (ex.: mesmo dia da semana passada). Sem base, não mostra nada. */
export function Variacao({ atual, base, rotulo }: { atual: number; base: number | null | undefined; rotulo: string }) {
  if (base == null || !(base > 0)) return null;
  const pct = Math.round(((atual - base) / base) * 100);
  const cor = pct > 0 ? 'text-emerald-700 bg-emerald-50' : pct < 0 ? 'text-red-700 bg-red-50' : 'text-zinc-600 bg-zinc-100';
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${cor}`}>
      <i className={pct > 0 ? 'ri-arrow-up-line' : pct < 0 ? 'ri-arrow-down-line' : 'ri-subtract-line'} />
      {Math.abs(pct)}% <span className="font-medium opacity-80">{rotulo}</span>
    </span>
  );
}

/** Número principal em cima (ocupa a linha) e os secundários lado a lado embaixo. */
export function Kpis({ principal, outros }: {
  principal: { label: string; valor: string; extra?: ReactNode };
  outros: Array<{ label: string; valor: string; extra?: ReactNode }>;
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-violet-50 px-3.5 py-3">
        <p className="text-[11px] font-semibold text-violet-700">{principal.label}</p>
        <p className="text-2xl font-black text-zinc-900 leading-tight tabular-nums">{principal.valor}</p>
        {principal.extra && <div className="mt-1">{principal.extra}</div>}
      </div>
      {outros.length > 0 && (
        <div className={`grid gap-2 ${outros.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {outros.map((k) => (
            <div key={k.label} className="rounded-xl bg-zinc-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-zinc-500">{k.label}</p>
              <p className="text-lg font-black text-zinc-900 leading-tight tabular-nums">{k.valor}</p>
              {k.extra && <div className="mt-0.5">{k.extra}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Barras horizontais com valor e % do total. Uma cor só: a comparação é pelo comprimento. */
export function Barras({ titulo, itens, cor = 'bg-violet-500' }: {
  titulo: string;
  itens: Array<{ label: string; valor: number; detalhe?: string }>;
  cor?: string;
}) {
  const total = itens.reduce((a, b) => a + b.valor, 0);
  const max = Math.max(...itens.map((i) => i.valor), 0);
  if (!itens.length || !(total > 0)) return null;
  return (
    <div>
      <p className="text-xs font-bold text-zinc-700 mb-2">{titulo}</p>
      <div className="space-y-2">
        {itens.map((i) => (
          <div key={i.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-zinc-700 truncate">{i.label}</span>
              <span className="flex-shrink-0 tabular-nums text-zinc-900 font-bold">
                {brl(i.valor)} <span className="font-medium text-zinc-400">· {Math.round((i.valor / total) * 100)}%</span>
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
              <div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.max(2, (i.valor / max) * 100)}%` }} />
            </div>
            {i.detalhe && <p className="text-[11px] text-zinc-400 mt-0.5">{i.detalhe}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_PONTO: Record<string, string> = { ok: 'bg-emerald-500', alerta: 'bg-amber-500', perigo: 'bg-red-500', neutro: 'bg-zinc-300' };
const STATUS_TEXTO: Record<string, string> = { ok: 'text-emerald-700', alerta: 'text-amber-700', perigo: 'text-red-700', neutro: 'text-zinc-700' };
const STATUS_CHIP: Record<string, string> = { ok: 'text-emerald-700 bg-emerald-50', alerta: 'text-amber-700 bg-amber-50', perigo: 'text-red-700 bg-red-50', neutro: 'text-zinc-600 bg-zinc-100' };
export type Status = 'ok' | 'alerta' | 'perigo' | 'neutro';

/** Lista de linhas rótulo (+ detalhe) à esquerda, valor à direita, com marcador de status (cor). */
export function Linhas({ titulo, itens, vazio }: {
  titulo?: string;
  itens: Array<{ label: string; valor?: string; detalhe?: string; status?: Status }>;
  vazio?: string;
}) {
  if (!itens.length) return vazio ? <p className="text-xs text-zinc-400">{vazio}</p> : null;
  return (
    <div>
      {titulo && <p className="text-xs font-bold text-zinc-700 mb-2">{titulo}</p>}
      <ul className="space-y-1.5">
        {itens.map((i, n) => (
          <li key={`${i.label}-${n}`} className="flex items-start gap-2">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_PONTO[i.status ?? 'neutro']}`} />
            <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className={`font-semibold break-words ${i.status ? STATUS_TEXTO[i.status] : 'text-zinc-700'}`}>{i.label}</p>
                {i.detalhe && <p className="text-[11px] text-zinc-400">{i.detalhe}</p>}
              </div>
              {i.valor && <span className="flex-shrink-0 tabular-nums font-bold text-zinc-900">{i.valor}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Chip pequeno de status (ex.: "bate" / "diferença de R$"), para usar dentro de Kpis.extra. */
export function Chip({ texto, status = 'neutro' }: { texto: string; status?: Status }) {
  return <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${STATUS_CHIP[status]}`}>{texto}</span>;
}

/** Ranking numerado com barra pela quantidade. */
export function Ranking({ titulo, itens }: { titulo: string; itens: Array<{ nome: string; qtd: number; valor: number }> }) {
  const max = Math.max(...itens.map((i) => i.qtd), 0);
  if (!itens.length) return null;
  return (
    <div>
      <p className="text-xs font-bold text-zinc-700 mb-2">{titulo}</p>
      <ol className="space-y-2">
        {itens.map((i, n) => (
          <li key={i.nome} className="flex items-center gap-2.5">
            <span className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full text-[11px] font-black ${n === 0 ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-500'}`}>{n + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold text-zinc-800 truncate">{i.nome}</span>
                <span className="flex-shrink-0 tabular-nums text-zinc-500"><b className="text-zinc-900">{i.qtd} un</b> · {brl(i.valor)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(3, (i.qtd / max) * 100)}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Gráfico de linha (2026-09-23, Vendas do dia por hora): uma série principal (violeta, com área) e,
 * opcional, uma de comparação tracejada (ex.: mesmo dia da semana passada). Tocar ou passar o dedo
 * escolhe o ponto e o valor aparece em cima — começa no pico. SVG puro, cabe no celular.
 */
export function GraficoLinha({ titulo, pontos, rotuloBase, formatar = brl }: {
  titulo: string;
  pontos: Array<{ rotulo: string; valor: number; base?: number | null }>;
  rotuloBase?: string;
  formatar?: (n: number) => string;
}) {
  const pico = pontos.reduce((m, p, i) => (p.valor > pontos[m].valor ? i : m), 0);
  const [sel, setSel] = useState(pico);
  if (pontos.length < 2 || !pontos.some((p) => p.valor > 0)) return null;
  const temBase = pontos.some((p) => (p.base ?? 0) > 0);
  const W = 320; const H = 130; const E = 6; const D = 6; const T = 8; const B = 18;
  const max = Math.max(...pontos.map((p) => Math.max(p.valor, temBase ? p.base ?? 0 : 0)), 1);
  const x = (i: number) => E + (i * (W - E - D)) / (pontos.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const linha = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const principal = linha(pontos.map((p) => p.valor));
  const area = `${principal} L${x(pontos.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  const passo = Math.ceil(pontos.length / 7);
  const escolher = (clientX: number, alvo: SVGSVGElement) => {
    const r = alvo.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    setSel(Math.max(0, Math.min(pontos.length - 1, Math.round(((px - E) / (W - E - D)) * (pontos.length - 1)))));
  };
  const p = pontos[Math.min(sel, pontos.length - 1)];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-xs font-bold text-zinc-700">{titulo}</p>
        <p className="text-xs tabular-nums text-right">
          <span className="font-semibold text-zinc-500">{p.rotulo} · </span>
          <span className="font-black text-zinc-900">{formatar(p.valor)}</span>
          {temBase && <span className="text-zinc-400"> · {rotuloBase ?? 'base'} {formatar(p.base ?? 0)}</span>}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto touch-none select-none" role="img" aria-label={titulo}
        onPointerDown={(e) => escolher(e.clientX, e.currentTarget)}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === 'mouse') escolher(e.clientX, e.currentTarget); }}>
        <line x1={E} x2={W - D} y1={H - B} y2={H - B} className="stroke-zinc-200" strokeWidth={1} />
        <line x1={E} x2={W - D} y1={T} y2={T} className="stroke-zinc-100" strokeWidth={1} strokeDasharray="2 3" />
        <text x={W - D} y={T - 1} textAnchor="end" className="fill-zinc-400" fontSize={8}>{formatar(max)}</text>
        {temBase && <path d={linha(pontos.map((q) => q.base ?? 0))} fill="none" className="stroke-zinc-400" strokeWidth={1.5} strokeDasharray="4 3" />}
        <path d={area} className="fill-violet-500/10" />
        <path d={principal} fill="none" className="stroke-violet-600" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(sel)} x2={x(sel)} y1={T} y2={H - B} className="stroke-violet-300" strokeWidth={1} />
        <circle cx={x(sel)} cy={y(p.valor)} r={3.5} className="fill-violet-600 stroke-white" strokeWidth={1.5} />
        {pontos.map((q, i) => (i === pontos.length - 1 || (i % passo === 0 && pontos.length - 1 - i >= passo)) ? (
          <text key={i} x={x(i)} y={H - 5} textAnchor={i === 0 ? 'start' : i === pontos.length - 1 ? 'end' : 'middle'} className="fill-zinc-400" fontSize={9}>{q.rotulo}</text>
        ) : null)}
      </svg>
      {temBase && (
        <p className="flex items-center gap-3 text-[11px] text-zinc-500 mt-0.5">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-violet-600 rounded" />Dia escolhido</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-zinc-400" />{rotuloBase ?? 'Base'}</span>
        </p>
      )}
    </div>
  );
}
