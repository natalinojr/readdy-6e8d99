import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line,
} from 'recharts';
import { useState, useMemo } from 'react';
import { useKDS } from '@/contexts/KDSContext';
import { useSLAHistorico } from '@/hooks/useSLAHistorico';
import type { KDSPedido, KDSItem } from '@/types/kds';

type SubTab = 'estacao' | 'item' | 'operadores' | 'tempos' | 'unidades';

function fmtTs(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

interface UnidadeReal {
  pedido: string;
  item: string;
  estacao: string;
  entroKds: string;
  inicioPreparo: string;
  pronto: string;
  entregue: string;
  tempEspera: number | null;
  tempCozinha: number | null;
  tempEntrega: number | null;
  operador: string;
  garcom: string;
  origem: string;
}

function deriveUnidades(pedidos: KDSPedido[]): UnidadeReal[] {
  const rows: UnidadeReal[] = [];
  pedidos.forEach((p) => {
    p.itens.forEach((item: KDSItem) => {
      if (item.unidades && item.unidades.length > 0) {
        item.unidades.forEach((u, idx) => {
          const tempEspera = (item.iniciouPreparoEm && item.entroKdsEm)
            ? Math.round((item.iniciouPreparoEm - item.entroKdsEm) / 60000) : null;
          const tempCozinha = (item.ficouProntoEm && item.iniciouPreparoEm)
            ? Math.round((item.ficouProntoEm - item.iniciouPreparoEm) / 60000) : null;
          const tempEntrega = (u.entregueEm !== undefined && item.ficouProntoEm)
            ? Math.round((u.entregueEm - item.ficouProntoEm) / 60000) : null;
          rows.push({
            pedido: `#${String(p.numero).padStart(4, '0')} (u${idx + 1})`,
            item: item.nome,
            estacao: item.estacao,
            entroKds: fmtTs(item.entroKdsEm),
            inicioPreparo: fmtTs(item.iniciouPreparoEm ?? u.iniciouPreparoEm),
            pronto: fmtTs(item.ficouProntoEm ?? u.ficouProntoEm),
            entregue: fmtTs(typeof u.entregueEm === 'number' ? u.entregueEm : undefined),
            tempEspera,
            tempCozinha,
            tempEntrega,
            operador: u.operadorPreparo ?? item.operadorPreparo ?? '—',
            garcom: p.garcomNome ?? '—',
            origem: p.origem,
          });
        });
      } else if (item.iniciouPreparoEm || item.ficouProntoEm) {
        const tempEspera = (item.iniciouPreparoEm && item.entroKdsEm)
          ? Math.round((item.iniciouPreparoEm - item.entroKdsEm) / 60000) : null;
        const tempCozinha = (item.ficouProntoEm && item.iniciouPreparoEm)
          ? Math.round((item.ficouProntoEm - item.iniciouPreparoEm) / 60000) : null;
        const tempEntrega = (item.entregueEm && item.ficouProntoEm)
          ? Math.round((item.entregueEm - item.ficouProntoEm) / 60000) : null;
        rows.push({
          pedido: `#${String(p.numero).padStart(4, '0')}`,
          item: item.nome,
          estacao: item.estacao,
          entroKds: fmtTs(item.entroKdsEm),
          inicioPreparo: fmtTs(item.iniciouPreparoEm),
          pronto: fmtTs(item.ficouProntoEm),
          entregue: fmtTs(item.entregueEm),
          tempEspera,
          tempCozinha,
          tempEntrega,
          operador: item.operadorPreparo ?? '—',
          garcom: p.garcomNome ?? '—',
          origem: p.origem,
        });
      }
    });
  });
  return rows;
}

function computeSLAPorEstacao(pedidos: KDSPedido[]) {
  const mapa: Record<string, { pedidos: number; cumpridos: number; tempos: number[]; meta: number }> = {};
  pedidos.forEach((p) => {
    p.itens.forEach((item) => {
      if (!item.iniciouPreparoEm || !item.ficouProntoEm) return;
      const est = item.estacao;
      const tempCozinha = (item.ficouProntoEm - item.iniciouPreparoEm) / 60000;
      const meta = item.slaMinutos ?? 12;
      if (!mapa[est]) mapa[est] = { pedidos: 0, cumpridos: 0, tempos: [], meta };
      mapa[est].pedidos += 1;
      mapa[est].tempos.push(tempCozinha);
      if (tempCozinha <= meta) mapa[est].cumpridos += 1;
    });
  });
  return Object.entries(mapa).map(([estacao, d]) => ({
    estacao,
    pedidos: d.pedidos,
    cumpridos: d.cumpridos,
    estourados: d.pedidos - d.cumpridos,
    tempMedio: d.tempos.length > 0 ? d.tempos.reduce((a, b) => a + b, 0) / d.tempos.length : 0,
    tempMax: Math.max(...d.tempos),
    meta: d.meta,
  }));
}

function computeSLAPorItem(pedidos: KDSPedido[]) {
  const mapa: Record<string, { qtd: number; cumpridos: number; tempos: number[]; meta: number; estacao: string }> = {};
  pedidos.forEach((p) => {
    p.itens.forEach((item) => {
      if (!item.iniciouPreparoEm || !item.ficouProntoEm) return;
      const tempCozinha = (item.ficouProntoEm - item.iniciouPreparoEm) / 60000;
      const meta = item.slaMinutos ?? 12;
      if (!mapa[item.nome]) mapa[item.nome] = { qtd: 0, cumpridos: 0, tempos: [], meta, estacao: item.estacao };
      mapa[item.nome].qtd += 1;
      mapa[item.nome].tempos.push(tempCozinha);
      if (tempCozinha <= meta) mapa[item.nome].cumpridos += 1;
    });
  });
  return Object.entries(mapa).map(([nome, d]) => ({
    nome,
    estacao: d.estacao,
    qtd: d.qtd,
    tempMedio: d.tempos.length > 0 ? parseFloat((d.tempos.reduce((a, b) => a + b, 0) / d.tempos.length).toFixed(1)) : 0,
    sla: d.meta,
    estourados: d.qtd - d.cumpridos,
    pctEstourado: d.qtd > 0 ? parseFloat(((d.qtd - d.cumpridos) / d.qtd * 100).toFixed(1)) : 0,
  }));
}

const ORIGEM_LABEL: Record<string, string> = {
  caixa: 'Caixa', garcom: 'Garçom', mesa: 'Mesa QR', mesa_qr: 'Mesa QR',
  autoatendimento: 'Kiosk', self_service: 'Kiosk', delivery: 'Delivery',
  waiter: 'Garçom', cashier: 'Caixa',
};

function EmptyState({ mensagem }: { mensagem: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-zinc-100 rounded-xl">
      <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-xl mb-3">
        <i className="ri-bar-chart-box-line text-2xl text-zinc-300" />
      </div>
      <p className="text-sm font-semibold text-zinc-500 mb-1">Sem dados disponíveis</p>
      <p className="text-xs text-zinc-400 max-w-xs">{mensagem}</p>
    </div>
  );
}

function computeRankingOperadores(pedidos: KDSPedido[]) {
  const mapa: Record<string, { itens: number; cumpridos: number; tempos: number[] }> = {};
  pedidos.forEach((p) => {
    p.itens.forEach((item) => {
      if (!item.iniciouPreparoEm || !item.ficouProntoEm) return;
      const op = item.operadorPreparo ?? 'Sem operador';
      const tempo = (item.ficouProntoEm - item.iniciouPreparoEm) / 60000;
      const meta = item.slaMinutos ?? 12;
      if (!mapa[op]) mapa[op] = { itens: 0, cumpridos: 0, tempos: [] };
      mapa[op].itens++;
      mapa[op].tempos.push(tempo);
      if (tempo <= meta) mapa[op].cumpridos++;
    });
  });
  return Object.entries(mapa)
    .map(([nome, d]) => ({
      nome,
      itens: d.itens,
      tempMedio: d.tempos.length > 0 ? parseFloat((d.tempos.reduce((a, b) => a + b, 0) / d.tempos.length).toFixed(1)) : 0,
      pctCumprimento: d.itens > 0 ? parseFloat(((d.cumpridos / d.itens) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.pctCumprimento - a.pctCumprimento);
}

function computeEvolucaoHoraria(pedidos: KDSPedido[]) {
  const mapa: Record<number, { total: number; count: number }> = {};
  pedidos.forEach((p) => {
    p.itens.forEach((item) => {
      if (!item.iniciouPreparoEm || !item.ficouProntoEm) return;
      const hora = new Date(item.iniciouPreparoEm).getHours();
      const tempo = (item.ficouProntoEm - item.iniciouPreparoEm) / 60000;
      if (!mapa[hora]) mapa[hora] = { total: 0, count: 0 };
      mapa[hora].total += tempo;
      mapa[hora].count++;
    });
  });
  return Array.from({ length: 24 }, (_, h) => ({
    hora: `${String(h).padStart(2, '0')}h`,
    tempMedio: mapa[h] ? parseFloat((mapa[h].total / mapa[h].count).toFixed(1)) : 0,
    itens: mapa[h]?.count ?? 0,
  })).filter((h) => h.itens > 0);
}

interface Props {
  periodo?: string;
}

export default function SLACozinhaTab({ periodo = 'Hoje' }: Props) {
  const [sub, setSub] = useState<SubTab>('estacao');
  const { pedidos } = useKDS();
  const { data: historico, loading: historicoLoading } = useSLAHistorico(periodo);

  const unidades = useMemo(() => deriveUnidades(pedidos), [pedidos]);
  const slaEstacaoLive = useMemo(() => computeSLAPorEstacao(pedidos), [pedidos]);
  const slaItemLive = useMemo(() => computeSLAPorItem(pedidos), [pedidos]);
  const rankingOperadoresLive = useMemo(() => computeRankingOperadores(pedidos), [pedidos]);
  const evolucaoHorariaLive = useMemo(() => computeEvolucaoHoraria(pedidos), [pedidos]);

  const isHoje = periodo === 'Hoje';
  const temHistorico = historico.totalItens > 0;

  const usandoHistorico = !isHoje && temHistorico;

  const slaEstacao = usandoHistorico
    ? historico.porEstacao.map(e => ({
        estacao: e.estacao,
        pedidos: e.qtd,
        cumpridos: e.cumpridos,
        estourados: e.estourados,
        tempMedio: e.tempo_medio_min,
        tempMax: e.tempo_max_min,
        meta: e.sla_meta_min,
      }))
    : slaEstacaoLive;

  const slaItem = usandoHistorico
    ? historico.porItem.map(i => ({
        nome: i.item_name,
        estacao: i.estacao,
        qtd: i.qtd,
        tempMedio: i.tempo_medio_min,
        sla: i.sla_meta_min,
        estourados: i.estourados,
        pctEstourado: i.qtd > 0 ? parseFloat(((i.estourados / i.qtd) * 100).toFixed(1)) : 0,
      }))
    : slaItemLive;

  const rankingOperadores = usandoHistorico
    ? historico.porOperador.map(o => ({
        nome: o.operador,
        itens: o.itens,
        tempMedio: o.tempo_medio_min,
        pctCumprimento: o.pct_cumprimento,
      }))
    : rankingOperadoresLive;

  const evolucaoHoraria = usandoHistorico
    ? historico.porHora.map(h => ({
        hora: `${String(h.hora).padStart(2, '0')}h`,
        tempMedio: h.tempo_medio_min,
        itens: h.itens,
      }))
    : evolucaoHorariaLive;

  const totalPedidos = usandoHistorico ? historico.totalItens : slaEstacao.reduce((s, e) => s + e.pedidos, 0);
  const totalEstourados = usandoHistorico ? historico.totalEstourados : slaEstacao.reduce((s, e) => s + e.estourados, 0);
  const tempMedioGeral = usandoHistorico ? historico.tempoMedioGeral : (
    totalPedidos > 0 ? slaEstacao.reduce((s, e) => s + e.tempMedio * e.pedidos, 0) / totalPedidos : 0
  );
  const taxaCumprimento = usandoHistorico ? historico.taxaCumprimento : (
    totalPedidos > 0 ? ((totalPedidos - totalEstourados) / totalPedidos) * 100 : 0
  );

  const temDados = totalPedidos > 0 || unidades.length > 0;

  function labelPeriodo(p: string): string {
    if (p.startsWith('custom:')) {
      const [, s, e] = p.split(':');
      const fmtD = (d: string) => { const [y, m, dia] = d.split('-'); return `${dia}/${m}/${y}`; };
      return s === e ? fmtD(s) : `${fmtD(s)} → ${fmtD(e)}`;
    }
    return p;
  }

  return (
    <div className="space-y-5">
      {/* Banner de fonte de dados */}
      {usandoHistorico ? (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700 font-medium flex-wrap">
          <i className="ri-database-2-line text-sm" />
          <span>Dados históricos — período: <strong>{labelPeriodo(periodo)}</strong></span>
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full border border-emerald-200">
            {historico.totalItens} itens analisados
          </span>
        </div>
      ) : isHoje ? (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-teal-50 border border-teal-100 rounded-xl text-xs text-teal-700 font-medium">
          <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse flex-shrink-0" />
          <span>Dados ao vivo do KDS — hoje em tempo real</span>
          {historicoLoading && (
            <div className="ml-auto w-3.5 h-3.5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-500">
          <i className="ri-information-line text-sm" />
          <span>
            {historicoLoading
              ? 'Carregando dados históricos...'
              : `Nenhum dado de SLA para ${labelPeriodo(periodo)}.`}
          </span>
          {historicoLoading && (
            <div className="ml-auto w-3.5 h-3.5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      )}

      {isHoje && !temDados && !historicoLoading && (
        <div className="flex items-center gap-3 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl">
          <i className="ri-information-line text-zinc-400 text-sm" />
          <p className="text-xs text-zinc-500">
            Os dados de SLA aparecem em tempo real conforme pedidos são preparados pelo KDS.
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-zinc-900">{totalPedidos}</p>
          <p className="text-xs text-zinc-500">Itens analisados</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 text-center ${taxaCumprimento >= 85 ? 'border-emerald-200' : totalPedidos > 0 ? 'border-amber-200' : 'border-zinc-100'}`}>
          <p className={`text-2xl font-black ${taxaCumprimento >= 85 ? 'text-emerald-600' : totalPedidos > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
            {totalPedidos > 0 ? `${taxaCumprimento.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-zinc-500">SLA cumprido</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 text-center ${totalEstourados > 15 ? 'border-red-200' : 'border-zinc-100'}`}>
          <p className={`text-2xl font-black ${totalEstourados > 15 ? 'text-red-500' : 'text-zinc-700'}`}>
            {totalPedidos > 0 ? totalEstourados : '—'}
          </p>
          <p className="text-xs text-zinc-500">SLA estourado</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-zinc-900">
            {totalPedidos > 0 ? `${tempMedioGeral.toFixed(1)} min` : '—'}
          </p>
          <p className="text-xs text-zinc-500">Tempo médio geral</p>
        </div>
      </div>

      {/* Sub-tabs — scroll horizontal no mobile */}
      <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto scrollbar-hide">
        {([
          { id: 'estacao', label: 'Por Estação' },
          { id: 'item', label: 'Por Item' },
          { id: 'operadores', label: 'Operadores' },
          { id: 'tempos', label: 'Tempos Detalhados' },
          { id: 'unidades', label: 'Unidades Produzidas' },
        ] as { id: SubTab; label: string }[]).map((t) => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${sub === t.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
            {t.label}
            {t.id === 'unidades' && unidades.length > 0 && (
              <span className="ml-1.5 text-[9px] font-black px-1 py-0.5 rounded-full bg-teal-100 text-teal-700">LIVE</span>
            )}
          </button>
        ))}
      </div>

      {/* Por Estação */}
      {sub === 'estacao' && (
        slaEstacao.length === 0 ? (
          <EmptyState mensagem={isHoje ? "Nenhum item concluído ainda. Dados aparecem quando itens forem marcados como prontos no KDS." : `Nenhum dado de SLA para ${labelPeriodo(periodo)}.`} />
        ) : (
          <div className="space-y-4">
            <div className="bg-white border border-zinc-100 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-4">Tempo Médio de Preparo por Estação</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={slaEstacao} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                    <XAxis dataKey="estacao" tick={{ fontSize: 11, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} unit=" min" />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(1)} min`, '']} contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e4e4e7' }} />
                    <Bar dataKey="tempMedio" name="Tempo Médio" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {slaEstacao.map((e) => (
                        <Cell key={e.estacao} fill={e.tempMedio > e.meta ? '#ef4444' : e.tempMedio > e.meta * 0.85 ? '#f59e0b' : '#10b981'} />
                      ))}
                    </Bar>
                    <Bar dataKey="meta" name="Meta SLA" fill="#e4e4e7" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 border-b border-zinc-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-zinc-500">Estação</th>
                      <th className="px-4 py-3 text-center font-semibold text-zinc-500">Itens</th>
                      <th className="px-4 py-3 text-center font-semibold text-zinc-500">Cumpridos</th>
                      <th className="px-4 py-3 text-center font-semibold text-zinc-500">Estourados</th>
                      <th className="px-4 py-3 text-center font-semibold text-zinc-500">Temp. Médio</th>
                      <th className="px-4 py-3 text-center font-semibold text-zinc-500">Meta SLA</th>
                      <th className="px-4 py-3 text-center font-semibold text-zinc-500">% Cumprimento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {slaEstacao.map((e) => {
                      const pct = e.pedidos > 0 ? (e.cumpridos / e.pedidos) * 100 : 100;
                      return (
                        <tr key={e.estacao} className="hover:bg-zinc-50">
                          <td className="px-4 py-3 font-semibold text-zinc-800">{e.estacao}</td>
                          <td className="px-4 py-3 text-center text-zinc-600">{e.pedidos}</td>
                          <td className="px-4 py-3 text-center text-emerald-600 font-semibold">{e.cumpridos}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`font-bold ${e.estourados > 5 ? 'text-red-600' : e.estourados > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>{e.estourados}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`font-bold ${e.tempMedio > e.meta ? 'text-red-600' : e.tempMedio > e.meta * 0.85 ? 'text-amber-600' : 'text-emerald-600'}`}>{e.tempMedio.toFixed(1)} min</span>
                          </td>
                          <td className="px-4 py-3 text-center text-zinc-500">{e.meta} min</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center gap-2 justify-center">
                              <div className="w-16 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className={`font-bold text-[11px] ${pct >= 90 ? 'text-emerald-600' : pct >= 75 ? 'text-amber-600' : 'text-red-500'}`}>{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      )}

      {/* Operadores */}
      {sub === 'operadores' && (
        rankingOperadores.length === 0 ? (
          <EmptyState mensagem="Nenhum operador com dados de preparo. Os dados aparecem quando operadores iniciam itens pelo KDS com nome registrado." />
        ) : (
          <div className="space-y-4">
            {evolucaoHoraria.length > 0 && (
              <div className="bg-white border border-zinc-100 rounded-xl p-5">
                <div className="mb-3">
                  <h3 className="text-sm font-bold text-zinc-800">Tempo Médio por Hora do Dia</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Identifica em que horários a cozinha tem mais pressão</p>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={evolucaoHoraria} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                      <XAxis dataKey="hora" tick={{ fontSize: 9, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} unit=" min" width={36} />
                      <Tooltip
                        formatter={(v: number, name: string) => [name === 'tempMedio' ? `${v} min` : `${v} itens`, name === 'tempMedio' ? 'Tempo médio' : 'Itens']}
                        contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e4e4e7' }}
                      />
                      <Line type="monotone" dataKey="tempMedio" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-zinc-100 bg-zinc-50">
                <h3 className="text-sm font-bold text-zinc-800">Ranking de Operadores</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Ordenado por maior taxa de cumprimento de SLA</p>
              </div>
              <div className="divide-y divide-zinc-50">
                {rankingOperadores.map((op, idx) => (
                  <div key={op.nome} className="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-50 transition-colors">
                    <span className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-black flex-shrink-0 ${
                      idx === 0 ? 'bg-amber-100 text-amber-700' :
                      idx === 1 ? 'bg-zinc-100 text-zinc-600' :
                      idx === 2 ? 'bg-orange-100 text-orange-700' : 'bg-zinc-50 text-zinc-400'
                    }`}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-zinc-800 truncate">{op.nome}</p>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                          <span className="text-xs text-zinc-500">{op.itens} itens</span>
                          <span className={`text-xs font-bold ${op.tempMedio <= 12 ? 'text-emerald-600' : op.tempMedio <= 18 ? 'text-amber-600' : 'text-red-600'}`}>
                            {op.tempMedio} min
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${op.pctCumprimento >= 90 ? 'bg-emerald-500' : op.pctCumprimento >= 70 ? 'bg-amber-400' : 'bg-red-500'}`}
                            style={{ width: `${op.pctCumprimento}%` }}
                          />
                        </div>
                        <span className={`text-xs font-bold w-12 text-right ${op.pctCumprimento >= 90 ? 'text-emerald-600' : op.pctCumprimento >= 70 ? 'text-amber-600' : 'text-red-500'}`}>
                          {op.pctCumprimento}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {/* Por Item */}
      {sub === 'item' && (
        slaItem.length === 0 ? (
          <EmptyState mensagem="Nenhum item com dados de tempo de preparo. Configure as estações e inicie pedidos no KDS para gerar dados reais." />
        ) : (
          <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b border-zinc-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-500">Item</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-500">Estação</th>
                    <th className="px-4 py-3 text-center font-semibold text-zinc-500">Qtd</th>
                    <th className="px-4 py-3 text-center font-semibold text-zinc-500">Tempo Médio</th>
                    <th className="px-4 py-3 text-center font-semibold text-zinc-500">Meta SLA</th>
                    <th className="px-4 py-3 text-center font-semibold text-zinc-500">SLA Estourado</th>
                    <th className="px-4 py-3 text-center font-semibold text-zinc-500">% Estouro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {[...slaItem].sort((a, b) => b.pctEstourado - a.pctEstourado).map((item) => (
                    <tr key={item.nome} className="hover:bg-zinc-50">
                      <td className="px-4 py-3 font-medium text-zinc-800">{item.nome}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-full text-[10px] font-medium">{item.estacao}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-600">{item.qtd}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${item.tempMedio > item.sla ? 'text-red-600' : 'text-emerald-600'}`}>{item.tempMedio} min</span>
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-500">{item.sla} min</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${item.estourados > 3 ? 'text-red-500' : item.estourados > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>{item.estourados}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${item.pctEstourado > 15 ? 'bg-red-100 text-red-700' : item.pctEstourado > 8 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {item.pctEstourado.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Tempos Detalhados */}
      {sub === 'tempos' && (
        unidades.length === 0 ? (
          <EmptyState mensagem="Nenhum dado de tempo detalhado ainda. Os tempos aparecem quando operadores usam o KDS para iniciar e concluir itens." />
        ) : (
          <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50">
              <p className="text-xs font-bold text-zinc-700">Decomposição de Tempo por Unidade</p>
              <p className="text-[10px] text-zinc-400">Espera pré-preparo · Preparo ativo · Espera pós-pronto</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b border-zinc-100">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">Item</th>
                    <th className="px-4 py-2.5 text-center font-semibold text-zinc-500">Espera Pré</th>
                    <th className="px-4 py-2.5 text-center font-semibold text-zinc-500">Preparo</th>
                    <th className="px-4 py-2.5 text-center font-semibold text-zinc-500">Entrega</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">Operador</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {unidades.map((u, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="px-4 py-2.5 font-medium text-zinc-800">{u.item}</td>
                      <td className="px-4 py-2.5 text-center">
                        {u.tempEspera !== null ? (
                          <span className={`font-bold ${u.tempEspera > 3 ? 'text-amber-600' : 'text-zinc-500'}`}>{u.tempEspera}m</span>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {u.tempCozinha !== null ? (
                          <span className={`font-bold ${u.tempCozinha > 12 ? 'text-red-600' : u.tempCozinha > 8 ? 'text-amber-600' : 'text-emerald-600'}`}>{u.tempCozinha}m</span>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {u.tempEntrega !== null ? (
                          <span className={`font-bold ${u.tempEntrega > 5 ? 'text-amber-600' : 'text-zinc-500'}`}>{u.tempEntrega}m</span>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-700">{u.operador}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Unidades Produzidas */}
      {sub === 'unidades' && (
        unidades.length === 0 ? (
          <EmptyState mensagem="Nenhuma unidade produzida com rastreamento. Dados aparecem quando operadores usam o KDS com registro de unidades individuais." />
        ) : (
          <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs font-bold text-zinc-700">Rastreamento por Unidade Produzida</p>
                <p className="text-[10px] text-zinc-400">Operador · Hora entrada · Início preparo · Pronto · Entregue</p>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 border border-teal-200 rounded-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-teal-700">
                  {unidades.length} registro{unidades.length > 1 ? 's' : ''} ao vivo
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b border-zinc-100">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">Pedido</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">Item</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">Estação</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-zinc-500">Entrou KDS</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-zinc-500">Início Preparo</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-zinc-500">Pronto</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-zinc-500">Entregue</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-zinc-500">T.Espera</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-zinc-500">T.Cozinha</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">Operador</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">Garçom / Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {unidades.map((u, i) => (
                    <tr key={i} className="hover:bg-zinc-50 bg-teal-50/30">
                      <td className="px-3 py-2.5">
                        <span className="font-mono font-semibold text-zinc-700">{u.pedido}</span>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-zinc-800">{u.item}</td>
                      <td className="px-3 py-2.5">
                        {u.estacao ? (
                          <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded-full text-[10px]">{u.estacao}</span>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-zinc-500">{u.entroKds}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-amber-600">{u.inicioPreparo}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-emerald-600">{u.pronto}</td>
                      <td className="px-3 py-2.5 text-center font-mono text-sky-600">{u.entregue}</td>
                      <td className="px-3 py-2.5 text-center">
                        {u.tempEspera !== null ? (
                          <span className={`font-bold ${u.tempEspera > 3 ? 'text-amber-600' : 'text-zinc-500'}`}>{u.tempEspera}m</span>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {u.tempCozinha !== null ? (
                          <span className={`font-bold ${u.tempCozinha > 12 ? 'text-red-600' : u.tempCozinha > 8 ? 'text-amber-600' : 'text-emerald-600'}`}>{u.tempCozinha}m</span>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-700 font-medium">{u.operador}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-600">{u.garcom}</span>
                          {u.origem && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-400">
                              {ORIGEM_LABEL[u.origem] ?? u.origem}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
