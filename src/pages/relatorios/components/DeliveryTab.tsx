import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useDeliveryLinkReport } from '@/hooks/useDeliveryLinkReport';

interface Props { periodo: string; }

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtKm = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ',') + ' km');

const CORES = ['#f59e0b', '#10b981', '#06b6d4', '#f97316', '#ef4444', '#8b5cf6'];

function Kpi({ label, value, sub, icon, accent }: { label: string; value: string; sub?: string; icon: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-100 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={'w-8 h-8 flex items-center justify-center rounded-lg ' + (accent ?? 'bg-amber-50 text-amber-600')}>
          <i className={icon + ' text-sm'} />
        </div>
        <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-xl font-black text-zinc-800 leading-tight">{value}</p>
      {sub ? <p className="text-xs text-zinc-400 mt-0.5">{sub}</p> : null}
    </div>
  );
}

function CustoCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className={'rounded-xl px-3 py-2.5 border ' + (accent ?? 'bg-zinc-50 border-zinc-100')}>
      <span className="block text-[10px] text-zinc-400 font-semibold uppercase">{label}</span>
      <span className="text-lg font-black text-zinc-700">{value}</span>
    </div>
  );
}

export default function DeliveryTab({ periodo }: Props) {
  const { dados, loading } = useDeliveryLinkReport(periodo);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (dados.totalPedidos === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-motorbike-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Nenhum pedido pelo link de delivery no período</p>
        <p className="text-xs text-zinc-400 mt-1">Pedidos feitos pelo link público aparecem aqui</p>
      </div>
    );
  }

  // Custo com motoboy = taxa de entrega cobrada do cliente (repasse).
  const custoTotal = dados.taxaArrecadada;
  const custoMedioEntrega = dados.entregas > 0 ? custoTotal / dados.entregas : 0;
  const custoMedioKm = dados.entregasKmTotal > 0 ? custoTotal / dados.entregasKmTotal : null;
  const pctFat = dados.faturamento > 0 ? (custoTotal / dados.faturamento) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* KPIs principais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Pedidos" value={String(dados.totalPedidos)} sub={`${dados.entregas} entrega · ${dados.retiradas} retirada`} icon="ri-shopping-bag-3-line" />
        <Kpi label="Faturamento" value={fmt(dados.faturamento)} sub={`Ticket médio ${fmt(dados.ticketMedio)}`} icon="ri-money-dollar-circle-line" accent="bg-emerald-50 text-emerald-600" />
        <Kpi label="Custo motoboy" value={fmt(custoTotal)} sub="= taxa de entrega (repasse)" icon="ri-e-bike-2-line" accent="bg-red-50 text-red-600" />
        <Kpi label="Distância" value={fmtKm(dados.distMedia)} sub={`média · máx ${fmtKm(dados.distMax)}`} icon="ri-map-pin-distance-line" accent="bg-orange-50 text-orange-600" />
        <Kpi label="Mais pedem de" value={dados.distMaisPedida ?? '—'} sub="faixa de distância" icon="ri-focus-3-line" accent="bg-violet-50 text-violet-600" />
        <Kpi label="Tempo até sair" value={dados.tempoPreparoMedio != null ? `${dados.tempoPreparoMedio} min` : '—'} sub="pedido → em rota" icon="ri-timer-line" accent="bg-amber-50 text-amber-600" />
        <Kpi label="Entregas" value={String(dados.entregas)} sub={`${dados.entregasComKm} com distância`} icon="ri-motorbike-line" accent="bg-pink-50 text-pink-600" />
        <Kpi label="Retiradas" value={String(dados.retiradas)} sub="cliente busca na loja" icon="ri-store-2-line" accent="bg-zinc-100 text-zinc-600" />
      </div>

      {/* Custo com motoboy — detalhado */}
      <div className="bg-white rounded-2xl border border-zinc-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-600">
            <i className="ri-e-bike-2-line text-sm" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-800">Custo com motoboy</h3>
            <p className="text-[11px] text-zinc-400">É a taxa de entrega cobrada do cliente e repassada ao motoboy (só entregas; retirada não tem taxa).</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <CustoCard label="Custo total" value={fmt(custoTotal)} accent="bg-red-50 border-red-100" />
          <CustoCard label="Por entrega" value={fmt(custoMedioEntrega)} />
          <CustoCard label="Por km" value={custoMedioKm != null ? fmt(custoMedioKm) : '—'} />
          <CustoCard label="% do faturamento" value={`${pctFat.toFixed(1).replace('.', ',')}%`} />
        </div>
        <h4 className="text-xs font-semibold text-zinc-500 mb-2">Custo por dia</h4>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={dados.custoPorDia}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => 'R$' + v} />
            <Tooltip formatter={(v: number) => [fmt(v), 'Custo motoboy']} />
            <Bar dataKey="custo" fill="#ef4444" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Distância que mais pedem + Horários */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-zinc-100 p-4">
          <h3 className="text-sm font-bold text-zinc-800 mb-3">Distância dos pedidos</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dados.distBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="faixa" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number, n) => n === 'custo' ? [fmt(v), 'Custo'] : [`${v} pedido(s)`, 'Pedidos']} />
              <Bar dataKey="pedidos" radius={[6, 6, 0, 0]}>
                {dados.distBuckets.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl border border-zinc-100 p-4">
          <h3 className="text-sm font-bold text-zinc-800 mb-3">Horários de pico</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dados.horariosPico}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="hora" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v} pedido(s)`, 'Pedidos']} />
              <Bar dataKey="pedidos" fill="#f59e0b" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Dia da semana + Top clientes */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-zinc-100 p-4">
          <h3 className="text-sm font-bold text-zinc-800 mb-3">Pedidos por dia da semana</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dados.porDiaSemana}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}`, 'Pedidos']} />
              <Bar dataKey="pedidos" fill="#10b981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl border border-zinc-100 p-4">
          <h3 className="text-sm font-bold text-zinc-800 mb-3">Clientes que mais pedem</h3>
          {dados.topClientes.length === 0 ? (
            <p className="text-xs text-zinc-400 py-8 text-center">Sem dados</p>
          ) : (
            <div className="space-y-2">
              {dados.topClientes.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-lg bg-amber-50 text-amber-600 text-xs font-black shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm font-semibold text-zinc-700 truncate">{c.nome}</span>
                  <span className="text-xs text-zinc-400 shrink-0">{c.pedidos} ped.</span>
                  <span className="text-sm font-bold text-zinc-800 shrink-0 w-20 text-right">{fmt(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Status dos pedidos */}
      <div className="bg-white rounded-2xl border border-zinc-100 p-4">
        <h3 className="text-sm font-bold text-zinc-800 mb-3">Situação dos pedidos</h3>
        <div className="flex flex-wrap gap-2">
          {dados.porStatus.map((s) => (
            <div key={s.status} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 rounded-xl border border-zinc-100">
              <span className="text-sm font-bold text-zinc-800">{s.pedidos}</span>
              <span className="text-xs text-zinc-500">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
