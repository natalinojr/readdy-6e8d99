import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { diasEntre, type LojaComparada, type PeriodoLojas } from '@/lib/lojasComparar';
import { horaDoDia } from '@/lib/diaLoja';
import { brl, PontoLoja } from './ui';

interface Props {
  lojas: LojaComparada[];
  cores: Record<string, string>;
  periodo: PeriodoLojas;
}

// Eixo no mesmo jeito do Dashboard e dos Relatórios: R$1,4k
const compacto = (v: number) => (v >= 1000 ? `R$${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : `R$${Math.round(v)}`);
const idGrad = (id: string) => `grad-loja-${id.replace(/[^a-zA-Z0-9]/g, '')}`;
const nomeCurto = (n: string) => n.split(' ').slice(0, 3).join(' ');

type Ponto = Record<string, number | string | null>;

/** Um dia: venda ACUMULADA hora a hora (linha cheia) × o mesmo dia de comparação (tracejada). */
function dadosHoras(lojas: LojaComparada[], periodo: PeriodoLojas): { pontos: Ponto[]; agora: number | null } {
  const horas = new Set<number>();
  for (const l of lojas) {
    for (const k of Object.keys(l.atual.serie)) horas.add(Number(k));
    for (const k of Object.keys(l.anterior.serie)) horas.add(Number(k));
  }
  const agoraPorLoja = new Map(lojas.map((l) => [l.tenantId, periodo === 'hoje' ? horaDoDia(new Date(), l.dia) : 99]));
  const agora = periodo === 'hoje' && lojas.length ? Math.max(...lojas.map((l) => agoraPorLoja.get(l.tenantId) ?? 0)) : null;
  if (horas.size === 0) return { pontos: [], agora };
  const ini = Math.max(0, Math.min(...horas) - 1);
  const fim = Math.max(...horas, agora ?? 0) + 1;
  const acum = new Map<string, number>();
  const pontos: Ponto[] = [];
  for (let h = ini; h <= fim; h++) {
    const p: Ponto = { x: h, rotulo: `${h % 24}h` };
    for (const l of lojas) {
      const a = (acum.get(l.tenantId) ?? 0) + (l.atual.serie[String(h - 1)] ?? 0);
      const b = (acum.get(`${l.tenantId}_ant`) ?? 0) + (l.anterior.serie[String(h - 1)] ?? 0);
      acum.set(l.tenantId, a); acum.set(`${l.tenantId}_ant`, b);
      // até o fim da hora h-1 = "até as h"; hoje para na hora atual da loja
      p[l.tenantId] = h - 1 <= (agoraPorLoja.get(l.tenantId) ?? 99) ? Math.round(a * 100) / 100 : null;
      p[`${l.tenantId}_ant`] = Math.round(b * 100) / 100;
    }
    pontos.push(p);
  }
  return { pontos, agora: agora !== null ? agora + 1 : null };
}

/** Vários dias: venda de cada dia (cheia) × o dia equivalente do período anterior (tracejada). */
function dadosDias(lojas: LojaComparada[]): Ponto[] {
  const ref = lojas[0];
  if (!ref) return [];
  const dias = diasEntre(ref.periodo.d1, ref.periodo.d2);
  const ant = diasEntre(ref.periodo.c1, ref.periodo.c2);
  return dias.map((dia, i) => {
    const p: Ponto = { x: i, rotulo: `${dia.slice(8, 10)}/${dia.slice(5, 7)}` };
    for (const l of lojas) {
      const d = diasEntre(l.periodo.d1, l.periodo.d2)[i];
      const da = diasEntre(l.periodo.c1, l.periodo.c2)[i] ?? ant[i];
      p[l.tenantId] = d ? l.atual.serie[d] ?? 0 : null;
      p[`${l.tenantId}_ant`] = da ? l.anterior.serie[da] ?? 0 : null;
    }
    return p;
  });
}

export default function GraficoLojas({ lojas, cores, periodo }: Props) {
  const umDia = periodo === 'hoje' || periodo === 'ontem';
  const { pontos, agora } = umDia ? dadosHoras(lojas, periodo) : { pontos: dadosDias(lojas), agora: null };
  const nomes = new Map(lojas.map((l) => [l.tenantId, l.nome]));
  // Loja sem venda nenhuma (nem agora nem antes) não desenha a linha zerada no chão: fica só na legenda.
  const vendeu = (l: LojaComparada) => pontos.some((p) => Number(p[l.tenantId] ?? 0) > 0 || Number(p[`${l.tenantId}_ant`] ?? 0) > 0);
  const desenhadas = lojas.filter(vendeu);
  // Sombra embaixo da linha (como Vendas por Hora): mais fraca quando há muitas lojas, para não virar borrão.
  const sombra = desenhadas.length <= 2 ? 0.18 : desenhadas.length <= 4 ? 0.1 : 0;

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4 min-w-0">
      <h3 className="text-sm font-black text-zinc-800">{umDia ? 'Ao longo do dia' : 'Dia a dia'}</h3>
      <p className="text-xs text-zinc-400 mb-2">
        {umDia
          ? `Venda acumulada ${periodo === 'hoje' ? 'hoje' : 'ontem'} (linha cheia) × ${periodo === 'hoje' ? 'o mesmo dia da semana passada' : 'o mesmo dia da semana anterior'} (tracejada)`
          : 'Venda de cada dia (linha cheia) × o dia equivalente do período anterior (tracejada)'}
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-[11px] font-semibold text-zinc-600">
        {lojas.map((l) => {
          const semVenda = pontos.length > 0 && !desenhadas.includes(l);
          return (
            <span key={l.tenantId} className={`inline-flex items-center gap-1.5 min-w-0 ${semVenda ? 'text-zinc-400' : ''}`}>
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: cores[l.tenantId], opacity: semVenda ? 0.35 : 1 }} />
              <span className="truncate max-w-[160px]">{l.nome}</span>
              {semVenda && <span className="font-normal">· sem venda</span>}
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5 text-zinc-400">
          <span className="inline-block w-4 border-t-2 border-dashed border-zinc-300" /> anterior
        </span>
      </div>
      {pontos.length === 0 ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-zinc-400">Sem vendas no período</div>
      ) : (
        <div className="h-[240px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pontos} margin={{ top: 18, right: 14, bottom: 0, left: 0 }}>
              <defs>
                {desenhadas.map((l) => (
                  <linearGradient key={l.tenantId} id={idGrad(l.tenantId)} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={cores[l.tenantId]} stopOpacity={sombra} />
                    <stop offset="95%" stopColor={cores[l.tenantId]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} width={52} tickFormatter={compacto} />
              {agora !== null && pontos.some((p) => p.x === agora) && (
                <ReferenceLine x={`${agora % 24}h`} stroke="#d4d4d8" strokeDasharray="2 3" label={{ value: 'agora', position: 'top', fontSize: 10, fill: '#a1a1aa' }} />
              )}
              <Tooltip
                cursor={{ stroke: '#d4d4d8', strokeWidth: 1, strokeDasharray: '3 3' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as Ponto;
                  return (
                    <div className="bg-white border border-zinc-200 rounded-xl px-3 py-2 text-[11.5px] shadow-lg min-w-[180px]">
                      <p className="font-bold text-zinc-900 mb-1">{umDia ? `até ${label}` : label}</p>
                      {desenhadas.map((l) => (
                        <div key={l.tenantId} className="flex items-center justify-between gap-3 py-px">
                          <span className="inline-flex items-center gap-1.5 min-w-0 text-zinc-600">
                            <PontoLoja cor={cores[l.tenantId]} className="!w-2 !h-2" />
                            <span className="truncate max-w-[120px]">{nomeCurto(nomes.get(l.tenantId) ?? '')}</span>
                          </span>
                          <span className="tabular-nums">
                            <b className="text-zinc-900">{p[l.tenantId] == null ? '—' : brl(Number(p[l.tenantId]), false)}</b>
                            <span className="text-zinc-400"> / {p[`${l.tenantId}_ant`] == null ? '—' : brl(Number(p[`${l.tenantId}_ant`]), false)}</span>
                          </span>
                        </div>
                      ))}
                      <p className="text-zinc-400 text-[10px] mt-1">agora / anterior</p>
                    </div>
                  );
                }}
              />
              {desenhadas.map((l) => (
                <Line key={`${l.tenantId}_ant`} type="monotone" dataKey={`${l.tenantId}_ant`} stroke={cores[l.tenantId]} strokeOpacity={0.4}
                  strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />
              ))}
              {desenhadas.map((l) => (
                <Area key={l.tenantId} type="monotone" dataKey={l.tenantId} stroke={cores[l.tenantId]} strokeWidth={2.5}
                  fill={`url(#${idGrad(l.tenantId)})`}
                  dot={!umDia ? { r: 3, strokeWidth: 0, fill: cores[l.tenantId] } : false}
                  activeDot={{ r: 4.5, fill: cores[l.tenantId], stroke: '#fff', strokeWidth: 2 }}
                  connectNulls={false} isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

const CANAL: Record<string, [string, string]> = {
  table: ['Salão', '#008300'], waiter: ['Salão', '#008300'], cashier: ['Balcão', '#eda100'],
  self_service: ['Autoatendimento', '#4a3aa7'], delivery: ['Delivery próprio', '#e87ba4'], ifood: ['iFood', '#e34948'],
};
const ORDEM = ['table', 'waiter', 'cashier', 'self_service', 'delivery', 'ifood'];

/** De onde vem a venda: parte de cada canal no faturamento de cada loja. */
export function CanaisLojas({ lojas, cores }: { lojas: LojaComparada[]; cores: Record<string, string> }) {
  const usados = ORDEM.filter((c) => lojas.some((l) => (l.atual.canais[c]?.valor ?? 0) > 0));
  const legenda = [...new Map(usados.map((c) => [CANAL[c][0], CANAL[c][1]])).entries()];
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4 min-w-0">
      <h3 className="text-sm font-black text-zinc-800">De onde vem a venda</h3>
      <p className="text-xs text-zinc-400 mb-2">Parte de cada canal no faturamento da loja</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-[11px] font-semibold text-zinc-600">
        {legenda.map(([nome, cor]) => (
          <span key={nome} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: cor }} />{nome}</span>
        ))}
      </div>
      <div className="space-y-2.5">
        {lojas.map((l) => {
          const tot = Object.values(l.atual.canais).reduce((s, c) => s + (c?.valor ?? 0), 0);
          const ifood = l.atual.canais.ifood?.valor ?? 0;
          return (
            <div key={l.tenantId} className="grid grid-cols-[minmax(0,130px)_1fr_auto] gap-2.5 items-center text-xs">
              <span className="inline-flex items-center gap-1.5 min-w-0 font-semibold text-zinc-700">
                <PontoLoja cor={cores[l.tenantId]} className="!w-2 !h-2" /><span className="truncate">{l.nome}</span>
              </span>
              <div className="flex h-3.5 rounded overflow-hidden gap-[2px] bg-white">
                {tot > 0
                  ? usados.filter((c) => (l.atual.canais[c]?.valor ?? 0) > 0).map((c) => (
                    <div key={c} title={`${CANAL[c][0]}: ${brl(l.atual.canais[c].valor, false)} (${((l.atual.canais[c].valor / tot) * 100).toFixed(0)}%)`}
                      style={{ width: `${(l.atual.canais[c].valor / tot) * 100}%`, background: CANAL[c][1] }} />
                  ))
                  : <div className="w-full bg-zinc-100" />}
              </div>
              <span className="text-zinc-500 font-semibold tabular-nums whitespace-nowrap">{tot > 0 ? `iFood ${((ifood / tot) * 100).toFixed(0)}%` : 'sem venda'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
