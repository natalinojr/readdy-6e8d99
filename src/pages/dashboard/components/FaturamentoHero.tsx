import AjudaCartao from '@/components/base/AjudaCartao';
import type { DashboardMeta } from '@/hooks/useDashboardPainel';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function Variacao({ pct, rotulo }: { pct: number | undefined; rotulo: string }) {
  if (pct === undefined || !Number.isFinite(pct)) return null;
  const sobe = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums whitespace-nowrap ${sobe ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      <i className={sobe ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />
      {Math.abs(pct).toFixed(0)}% {rotulo}
    </span>
  );
}

interface Props {
  titulo: string;
  ajuda: string;
  valor: number;
  /** variação contra o mesmo dia da semana passada, até esta hora */
  varSemana?: number;
  rotuloSemana: string;
  meta: DashboardMeta | null;
  diaSemana: number;
  /** fração esperada até agora (0..1); null = sem histórico ou fora do modo "Hoje" */
  ritmoEsperado: number | null;
  horaAgora: string;
  podeEditarMetas: boolean;
  onEditarMetas: () => void;
}

export default function FaturamentoHero({
  titulo, ajuda, valor, varSemana, rotuloSemana, meta, diaSemana, ritmoEsperado, horaAgora,
  podeEditarMetas, onEditarMetas,
}: Props) {
  const alvo = meta?.faturamento ?? 0;
  const pct = alvo > 0 ? valor / alvo : 0;
  const bateu = alvo > 0 && valor >= alvo;
  // Ritmo só faz sentido depois que o movimento começa (>= 3% do dia costuma ter entrado)
  const temRitmo = alvo > 0 && !bateu && ritmoEsperado !== null && ritmoEsperado >= 0.03;
  const dif = temRitmo ? (pct - ritmoEsperado!) * 100 : 0;
  const ritmo = !temRitmo ? null
    : dif >= -5 ? { txt: dif >= 1 ? `No ritmo · +${dif.toFixed(0)} pts` : 'No ritmo', cls: 'bg-emerald-50 text-emerald-700', ic: 'ri-rocket-line' }
    : dif >= -15 ? { txt: `Um pouco abaixo · ${dif.toFixed(0)} pts`, cls: 'bg-amber-50 text-amber-700', ic: 'ri-error-warning-line' }
    : { txt: `Abaixo do ritmo · ${dif.toFixed(0)} pts`, cls: 'bg-red-50 text-red-600', ic: 'ri-arrow-down-line' };

  return (
    <div className="col-span-2 relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 md:p-5">
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-amber-50 pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-amber-100 text-amber-600 flex-shrink-0">
            <i className="ri-money-dollar-circle-line text-sm" />
          </span>
          <span className="text-xs font-semibold text-zinc-500">{titulo}</span>
          <AjudaCartao texto={ajuda} />
        </div>
        <div className="flex items-end gap-x-3 gap-y-1 mt-1.5 flex-wrap">
          <p className="text-3xl md:text-4xl font-bold tabular-nums tracking-tight text-zinc-900">{fmt(valor)}</p>
          <div className="flex gap-1.5 pb-1.5 flex-wrap">
            <Variacao pct={varSemana} rotulo={rotuloSemana} />
          </div>
        </div>

        <div className="mt-4">
          {alvo > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2 text-[11px] mb-1.5 flex-wrap">
                <span className="text-zinc-500 flex items-center gap-1">
                  Meta de {DIAS[diaSemana]} <b className="text-zinc-700 tabular-nums">{fmt(alvo)}</b>
                  {podeEditarMetas && (
                    <button onClick={onEditarMetas} className="ml-1 text-zinc-400 hover:text-amber-600 cursor-pointer" title="Configurar metas">
                      <i className="ri-settings-3-line" />
                    </button>
                  )}
                </span>
                {bateu ? (
                  <span className="font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700"><i className="ri-trophy-line" /> Meta batida!</span>
                ) : ritmo && (
                  <span className={`font-semibold px-2 py-0.5 rounded-md ${ritmo.cls}`}><i className={ritmo.ic} /> {ritmo.txt}</span>
                )}
              </div>
              <div className="relative h-2.5 bg-zinc-100 rounded-full">
                <div className={`h-full rounded-full transition-all duration-700 ${bateu ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-amber-500'}`}
                  style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                {temRitmo && (
                  <div className="absolute -top-1 h-[18px] w-[3px] rounded bg-zinc-800" style={{ left: `calc(${Math.min(ritmoEsperado! * 100, 100)}% - 1px)` }}
                    title={`Pelo histórico das últimas semanas, até ${horaAgora} costuma entrar ${(ritmoEsperado! * 100).toFixed(0)}% do dia`} />
                )}
              </div>
              <div className="flex justify-between gap-2 text-[10px] text-zinc-400 mt-1.5">
                <span>{(pct * 100).toFixed(0)}% da meta</span>
                {temRitmo && <span className="hidden sm:inline">▮ esperado até {horaAgora}: {(ritmoEsperado! * 100).toFixed(0)}%</span>}
                {!bateu && <span>faltam {fmt(alvo - valor)}</span>}
              </div>
            </>
          ) : podeEditarMetas ? (
            <button onClick={onEditarMetas}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 text-xs font-semibold text-amber-700 hover:bg-amber-50 cursor-pointer">
              <i className="ri-flag-line" /> Definir a meta de {DIAS[diaSemana]} — mostra se a loja está no ritmo
            </button>
          ) : (
            <p className="text-[11px] text-zinc-400">Sem meta para {DIAS[diaSemana]}. O supervisor pode definir aqui.</p>
          )}
        </div>
      </div>
    </div>
  );
}
