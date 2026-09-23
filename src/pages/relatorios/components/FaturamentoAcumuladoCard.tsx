import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useSalesReport } from '@/hooks/useSalesReport';
import { useIfoodVendas } from '@/hooks/useIfoodVendas';
import { getPeriodDates, todayBrasilia } from '@/lib/dateUtils';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pad = (n: number) => String(n).padStart(2, '0');
const diasNoMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

// Faturamento acumulado dia a dia: mês do fim do período selecionado × mês anterior (PDV + iFood).
export default function FaturamentoAcumuladoCard({ periodo }: { periodo: string }) {
  const fimPeriodo = getPeriodDates(periodo).to.slice(0, 10);
  const [y, m] = fimPeriodo.split('-').map(Number);
  const [ya, ma] = m === 1 ? [y - 1, 12] : [y, m - 1];
  const nDias = diasNoMes(y, m);
  const nDiasAnt = diasNoMes(ya, ma);

  // Mês atual vai até o fim do período (ou hoje); o anterior, inteiro.
  const hoje = todayBrasilia();
  const fimAtual = fimPeriodo < hoje ? fimPeriodo : hoje;
  const perAtual = `custom:${y}-${pad(m)}-01:${fimAtual}`;
  const perAnt = `custom:${ya}-${pad(ma)}-01:${ya}-${pad(ma)}-${pad(nDiasAnt)}`;

  const { data: repAtual, loading } = useSalesReport(perAtual);
  const { data: repAnt } = useSalesReport(perAnt);
  const { data: ifAtual } = useIfoodVendas(perAtual);
  const { data: ifAnt } = useIfoodVendas(perAnt);

  const porDia = (
    rep: typeof repAtual,
    ifood: typeof ifAtual,
  ): Record<number, number> => {
    const out: Record<number, number> = {};
    for (const d of rep?.orders_by_day ?? []) {
      const dia = Number(d.day.slice(8, 10));
      out[dia] = (out[dia] ?? 0) + Number(d.revenue);
    }
    for (const [data, v] of Object.entries(ifood?.porDia ?? {})) {
      const dia = Number(data.slice(8, 10));
      out[dia] = (out[dia] ?? 0) + v.valor;
    }
    return out;
  };

  const atual = porDia(repAtual, ifAtual);
  const anterior = porDia(repAnt, ifAnt);
  const ultimoDiaAtual = fimAtual.startsWith(`${y}-${pad(m)}`) ? Number(fimAtual.slice(8, 10)) : 0;

  let accAtual = 0;
  let accAnt = 0;
  const dados = Array.from({ length: Math.max(nDias, nDiasAnt) }, (_, i) => {
    const dia = i + 1;
    accAtual += atual[dia] ?? 0;
    accAnt += anterior[dia] ?? 0;
    return {
      dia: pad(dia),
      atual: dia <= ultimoDiaAtual ? Math.round(accAtual * 100) / 100 : undefined,
      anterior: dia <= nDiasAnt ? Math.round(accAnt * 100) / 100 : undefined,
    };
  });

  const totalAtual = dados[ultimoDiaAtual - 1]?.atual ?? 0;
  const antMesmoDia = dados[Math.min(ultimoDiaAtual, nDiasAnt) - 1]?.anterior ?? 0;
  const varPct = antMesmoDia > 0 ? ((totalAtual - antMesmoDia) / antMesmoDia) * 100 : null;
  const temDados = accAtual > 0 || accAnt > 0;

  const labelAtual = `${MESES[m - 1]}/${String(y).slice(2)}`;
  const labelAnt = `${MESES[ma - 1]}/${String(ya).slice(2)}`;

  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-4 md:p-5">
      <div className="flex items-start justify-between gap-3 mb-3 md:mb-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Faturamento acumulado</h3>
          <p className="text-xs text-zinc-400">
            {labelAtual} até o dia {pad(ultimoDiaAtual || 1)} × {labelAnt} no mesmo dia
            {varPct !== null && (
              <span className={`ml-1.5 font-bold ${varPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {varPct >= 0 ? '+' : '−'}{Math.abs(varPct).toFixed(1)}%
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500 flex-shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="w-3 border-t-2 border-dashed border-zinc-400" /> Mês anterior
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 border-t-2 border-amber-500" /> Mês atual
          </span>
        </div>
      </div>
      {temDados ? (
        <div className="h-44 md:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dados} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 9, fill: '#a1a1aa' }} axisLine={false} tickLine={false} interval={2} />
              <YAxis
                tick={{ fontSize: 10, fill: '#a1a1aa' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v))}
                width={36}
              />
              <Tooltip
                formatter={(val: number, name: string) => [fmt(val), name === 'atual' ? labelAtual : labelAnt]}
                labelFormatter={(label) => `Até o dia ${label}`}
                contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
              />
              <Line type="monotone" dataKey="anterior" stroke="#a1a1aa" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: '#a1a1aa' }} connectNulls={false} />
              <Line type="monotone" dataKey="atual" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#f59e0b' }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-44 md:h-56 flex items-center justify-center text-zinc-300 text-xs">
          {loading ? 'Carregando...' : 'Sem faturamento nestes meses'}
        </div>
      )}
    </div>
  );
}
