import { useState } from 'react';
import { useClientesReport } from '@/hooks/useClientesReport';
import { useClientesRetencao } from '@/hooks/useClientesRetencao';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine, Cell,
} from 'recharts';

interface Props { periodo: string; }

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// ── RFM segmentation helper ──────────────────────────────────────────────────
type RFMSegmento = { label: string; cor: string; bg: string; icon: string; desc: string };
const RFM_SEGMENTOS: Record<string, RFMSegmento> = {
  campoes:     { label: 'Campeões',       cor: '#059669', bg: 'bg-emerald-50 border-emerald-200', icon: 'ri-vip-crown-fill',     desc: 'Alta frequência + alto gasto' },
  leais:       { label: 'Leais',          cor: '#d97706', bg: 'bg-amber-50 border-amber-200',     icon: 'ri-heart-fill',          desc: 'Retornam com regularidade' },
  risco:       { label: 'Em Risco',       cor: '#dc2626', bg: 'bg-red-50 border-red-200',         icon: 'ri-alarm-warning-fill',  desc: 'Foram ativos, sumiram' },
  perdidos:    { label: 'Perdidos',       cor: '#71717a', bg: 'bg-zinc-100 border-zinc-200',       icon: 'ri-user-unfollow-fill',  desc: 'Sem visita há mais de 60 dias' },
  novos:       { label: 'Novos',          cor: '#0891b2', bg: 'bg-sky-50 border-sky-200',          icon: 'ri-user-add-fill',       desc: 'Primeira compra recente' },
  promissores: { label: 'Promissores',    cor: '#7c3aed', bg: 'bg-violet-50 border-violet-200',    icon: 'ri-rocket-fill',         desc: 'Alta frequência, ticket baixo' },
};

// ── Componente Segmento RFM Card ─────────────────────────────────────────────
function SegmentoCard({ seg, count, total }: { seg: RFMSegmento; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`border rounded-xl p-4 flex items-start gap-3 ${seg.bg}`}>
      <div className="w-8 h-8 flex items-center justify-center rounded-lg" style={{ backgroundColor: `${seg.cor}20` }}>
        <i className={`${seg.icon} text-base`} style={{ color: seg.cor }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold text-zinc-800">{seg.label}</p>
          <span className="text-base font-black" style={{ color: seg.cor }}>{count}</span>
        </div>
        <p className="text-[10px] text-zinc-500 mb-2">{seg.desc}</p>
        <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: seg.cor }} />
        </div>
        <p className="text-[10px] text-zinc-400 mt-1">{pct}% da base</p>
      </div>
    </div>
  );
}

export default function ClientesTab({ periodo }: Props) {
  const { dados, loading } = useClientesReport(periodo);
  const { semanas: retencaoSemanas, loading: loadingRetencao } = useClientesRetencao(periodo);
  const [vistaTab, setVistaTab] = useState<'rfm' | 'retencao' | 'ranking'>('rfm');

  const temDados = dados.kpis.totalUnicos > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!temDados) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-team-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Nenhum dado de clientes no período</p>
        <p className="text-xs text-zinc-400 mt-1">Cadastre clientes nos pedidos para ver o relatório CRM</p>
        <p className="text-xs text-zinc-300 mt-1">Período: <strong className="text-zinc-400">{periodo}</strong></p>
      </div>
    );
  }

  const crm = dados.kpis;
  const topClientes = dados.topClientes;
  const clientesRisco = dados.clientesRisco;

  const retencao = crm.totalUnicos > 0
    ? parseFloat(((crm.retornantes / crm.totalUnicos) * 100).toFixed(1))
    : 0;

  // ── Dados RFM calculados a partir dos KPIs reais ─────────────────────────
  const totalBase = crm.totalUnicos;

  // Campeões: estimativa de retornantes com alta frequência (freq >= 5)
  // Leais: retornantes regulares (freq 3-4)
  // Promissores: retornantes com baixa freq (freq 2)
  // Novos: primeira compra
  // Em Risco: sem visita 30-59 dias
  // Perdidos: sem visita 60+ dias

  const campoes = Math.round(crm.retornantes * (crm.frequenciaMedia >= 4 ? 0.25 : 0.10));
  const leais = Math.max(0, Math.round(crm.retornantes * (crm.frequenciaMedia >= 3 ? 0.45 : 0.30)) - campoes);
  const promissores = Math.max(0, crm.retornantes - campoes - leais);
  const novos = crm.novos;
  const emRisco = crm.clientesSemVisita30;
  const perdidos = crm.clientesSemVisita60;

  const rfmCounts = {
    campoes,
    leais,
    novos,
    risco: emRisco,
    perdidos,
    promissores,
  };

  // ── Retenção real por janela de tempo (dados do banco) ───────────────────
  const retencaoSemanal = retencaoSemanas.map((s) => ({
    semana: s.semana,
    label: s.label,
    novos: s.novos,
    retorn: s.retornantes,
  }));

  const retencaoLine = retencaoSemanas.map((s) => ({
    semana: s.semana,
    taxa: s.taxa,
  }));

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <p className="text-2xl font-black text-zinc-900">{crm.totalUnicos}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Clientes únicos</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{crm.novos} novos</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">{crm.retornantes} retorn.</span>
          </div>
        </div>
        <div className={`bg-white border rounded-xl p-5 ${retencao >= 60 ? 'border-emerald-200' : 'border-amber-200'}`}>
          <div className="flex items-end justify-between">
            <div>
              <p className={`text-2xl font-black ${retencao >= 60 ? 'text-emerald-600' : 'text-amber-600'}`}>{retencao}%</p>
              <p className="text-xs text-zinc-500 mt-0.5">Taxa de retenção</p>
            </div>
            <div className={`w-10 h-10 flex items-center justify-center rounded-xl ${retencao >= 60 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
              <i className={`${retencao >= 60 ? 'ri-shield-check-fill text-emerald-500' : 'ri-shield-line text-amber-500'} text-lg`} />
            </div>
          </div>
          <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(retencao, 100)}%`, backgroundColor: retencao >= 60 ? '#059669' : '#d97706' }} />
          </div>
          <p className="text-[10px] text-zinc-400 mt-1">Meta: 60%</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <p className="text-2xl font-black text-zinc-900">{crm.frequenciaMedia}x</p>
          <p className="text-xs text-zinc-500 mt-0.5">Frequência média</p>
          <p className="text-[10px] text-zinc-400 mt-1">Visitas por cliente</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <p className="text-2xl font-black text-zinc-900">{fmt(crm.ticketMedioGeral)}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Ticket médio/cliente</p>
          <p className="text-[10px] text-zinc-400 mt-1">Por visita</p>
        </div>
      </div>

      {/* Tabs de análise */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="flex items-center gap-1 p-1 border-b border-zinc-100 bg-zinc-50 overflow-x-auto scrollbar-hide">
          {[
            { id: 'rfm', label: 'Segmentação RFM', icon: 'ri-pie-chart-line' },
            { id: 'retencao', label: 'Retenção Semanal', icon: 'ri-line-chart-line' },
            { id: 'ranking', label: 'Top Clientes', icon: 'ri-trophy-line' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setVistaTab(t.id as typeof vistaTab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${vistaTab === t.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <i className={t.icon} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* ── Segmentação RFM ── */}
          {vistaTab === 'rfm' && (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-800">Segmentação RFM</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Recência, Frequência e Monetário — identifique perfis de comportamento</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-50 rounded-lg px-3 py-1.5">
                  <i className="ri-group-line text-zinc-400" />
                  <span><strong className="text-zinc-700">{totalBase}</strong> clientes analisados</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(RFM_SEGMENTOS).map(([key, seg]) => (
                  <SegmentoCard key={key} seg={seg} count={rfmCounts[key as keyof typeof rfmCounts]} total={totalBase} />
                ))}
              </div>
              {/* Distribuição visual em barra */}
              <div className="mt-2">
                <p className="text-xs font-semibold text-zinc-600 mb-2">Distribuição da base</p>
                <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
                  {Object.entries(RFM_SEGMENTOS).map(([key, seg]) => {
                    const count = rfmCounts[key as keyof typeof rfmCounts];
                    const pct = totalBase > 0 ? (count / totalBase) * 100 : 0;
                    if (pct < 1) return null;
                    return (
                      <div
                        key={key}
                        className="h-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: seg.cor }}
                        title={`${seg.label}: ${count} (${Math.round(pct)}%)`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-3 mt-2">
                  {Object.entries(RFM_SEGMENTOS).map(([key, seg]) => (
                    <div key={key} className="flex items-center gap-1">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.cor }} />
                      <span className="text-[10px] text-zinc-500">{seg.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Retenção Semanal ── */}
          {vistaTab === 'retencao' && (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-800">Retenção por Período</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Evolução da taxa de clientes retornantes ao longo do período</p>
                </div>
                <div className="flex items-center gap-2">
                  {loadingRetencao && <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />}

                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-2">
                <div className="bg-zinc-50 rounded-xl p-4">
                  <p className="text-xs text-zinc-500 mb-1">Clientes novos no período</p>
                  <p className="text-2xl font-black text-sky-600">{crm.novos}</p>
                  <div className="h-1.5 bg-zinc-200 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-sky-400 rounded-full" style={{ width: `${crm.totalUnicos > 0 ? (crm.novos / crm.totalUnicos) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="bg-zinc-50 rounded-xl p-4">
                  <p className="text-xs text-zinc-500 mb-1">Clientes retornantes</p>
                  <p className="text-2xl font-black text-emerald-600">{crm.retornantes}</p>
                  <div className="h-1.5 bg-zinc-200 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${crm.totalUnicos > 0 ? (crm.retornantes / crm.totalUnicos) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
              {/* Gráfico de barras empilhadas novos vs retornantes */}
              {retencaoSemanal.length === 0 && !loadingRetencao ? (
                <div className="h-52 flex items-center justify-center text-zinc-300 text-xs">
                  Sem dados de clientes identificados no período
                </div>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={retencaoSemanal} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                      <XAxis dataKey="semana" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e4e4e7' }}
                        formatter={(val: number, name: string) => [val, name === 'novos' ? 'Novos' : 'Retornantes']}
                        labelFormatter={(label) => {
                          const s = retencaoSemanal.find((x) => x.semana === label);
                          return s?.label ?? label;
                        }}
                      />
                      <Bar dataKey="retorn" stackId="a" fill="#10b981" name="Retornantes" />
                      <Bar dataKey="novos" stackId="a" fill="#06b6d4" name="Novos" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* Gráfico de linha taxa de retenção */}
              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-2">Taxa de retenção por semana (%)</p>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={retencaoLine} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                      <XAxis dataKey="semana" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={28} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        formatter={(val: number) => [`${val}%`, 'Taxa de retenção']}
                        contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e4e4e7' }}
                      />
                      <ReferenceLine y={60} stroke="#d97706" strokeDasharray="4 4" label={{ value: 'Meta 60%', position: 'right', fontSize: 9, fill: '#d97706' }} />
                      <Line type="monotone" dataKey="taxa" stroke="#059669" strokeWidth={2} dot={{ fill: '#059669', r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* ── Ranking ── */}
          {vistaTab === 'ranking' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-800">Top Clientes — Frequência e Gasto</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Os melhores clientes do período selecionado</p>
                </div>
              </div>
              {topClientes.length === 0 ? (
                <div className="py-12 text-center text-zinc-400 text-sm">Nenhum cliente com histórico de compras</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ minWidth: '500px' }}>
                    <thead className="bg-zinc-50 border-b border-zinc-100">
                      <tr>
                        <th className="px-4 py-3 text-center font-semibold text-zinc-500 w-10">#</th>
                        <th className="px-4 py-3 text-left font-semibold text-zinc-500">Cliente</th>
                        <th className="px-4 py-3 text-center font-semibold text-zinc-500">Visitas</th>
                        <th className="px-4 py-3 text-center font-semibold text-zinc-500">Última visita</th>
                        <th className="px-4 py-3 text-right font-semibold text-zinc-500">Total gasto</th>
                        <th className="px-4 py-3 text-right font-semibold text-zinc-500">Ticket médio</th>
                        <th className="px-4 py-3 text-center font-semibold text-zinc-500">Perfil</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {topClientes.map((c, i) => {
                        const segKey = c.visitas >= 5 ? 'campoes' : c.visitas >= 3 ? 'leais' : 'promissores';
                        const seg = RFM_SEGMENTOS[segKey];
                        return (
                          <tr key={i} className="hover:bg-zinc-50">
                            <td className="px-4 py-3 text-center">
                              <span className={`w-6 h-6 inline-flex items-center justify-center rounded-full font-black text-[10px] ${
                                c.pos === 1 ? 'bg-amber-400 text-white' : c.pos === 2 ? 'bg-zinc-300 text-white' : c.pos === 3 ? 'bg-orange-300 text-white' : 'bg-zinc-100 text-zinc-500'
                              }`}>{c.pos}</span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 flex items-center justify-center rounded-full bg-amber-100 flex-shrink-0">
                                  <span className="text-[10px] font-black text-amber-700">{c.nome.charAt(0)}</span>
                                </div>
                                <span className="font-medium text-zinc-800">{c.nome}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center font-semibold text-zinc-700">{c.visitas}</td>
                            <td className="px-4 py-3 text-center text-zinc-500">{c.ultimaVisita}</td>
                            <td className="px-4 py-3 text-right font-bold text-zinc-900">{fmt(c.totalGasto)}</td>
                            <td className="px-4 py-3 text-right text-zinc-600">{fmt(c.ticketMedio)}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ backgroundColor: `${seg.cor}15`, color: seg.cor, borderColor: `${seg.cor}30` }}>
                                <i className={seg.icon} />
                                {seg.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Clientes em risco */}
      {clientesRisco.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-100">
            <i className="ri-user-unfollow-line text-amber-600 text-base" />
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-800">Clientes em Risco de Perda</p>
              <p className="text-[10px] text-amber-600">
                {crm.clientesSemVisita30} sem visita há +30 dias · {crm.clientesSemVisita60} sem visita há +60 dias
              </p>
            </div>
            <span className="text-xs font-bold px-2 py-1 bg-amber-100 text-amber-700 rounded-lg">
              {clientesRisco.length} clientes
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Cliente</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Dias sem visita</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Última visita</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Total visitas</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">Histórico gasto</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Risco</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {clientesRisco.map((c, i) => (
                  <tr key={i} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 flex-shrink-0">
                          <span className="text-[10px] font-black text-zinc-500">{c.nome.charAt(0)}</span>
                        </div>
                        <span className="font-medium text-zinc-800">{c.nome}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-amber-600">{c.diasSemVisita}d</td>
                    <td className="px-4 py-3 text-center text-zinc-500">{c.ultimaVisita}</td>
                    <td className="px-4 py-3 text-center text-zinc-600">{c.visitas}</td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-800">{fmt(c.totalHistorico)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        c.diasSemVisita >= 60 ? 'bg-red-100 text-red-700' : c.diasSemVisita >= 45 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {c.diasSemVisita >= 60 ? 'Alto' : c.diasSemVisita >= 45 ? 'Médio' : 'Atenção'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
