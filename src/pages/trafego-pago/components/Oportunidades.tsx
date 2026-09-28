// Tráfego Pago › Oportunidades (F5a do PLANO-TRAFEGO-PAGO-AGENTES.md, 2026-09-28).
// Só leitura: fatos por canal calculados no banco (fn_mkt_fatos_canais) + regras em
// src/lib/mktOportunidades.ts. Não precisa da Meta conectada e não gasta IA.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, Lightbulb, RefreshCw, Store, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { gerarOportunidades, CANAL_LABEL, DIA_LABEL, type FatosCanais, type Oportunidade } from '@/lib/mktOportunidades';
import { brl } from '../shared';
import ManualGestor from './ManualGestor';

const PRIO_CLS: Record<number, string> = {
  1: 'border-amber-300 bg-amber-50/60',
  2: 'border-zinc-200 bg-white',
  3: 'border-zinc-200 bg-zinc-50/60',
};
const PRIO_LABEL: Record<number, string> = { 1: 'Olhar primeiro', 2: 'Vale testar', 3: 'Atenção' };

export default function OportunidadesTab({ tenantId }: { tenantId: string }) {
  const [dias, setDias] = useState(30);
  const [fatos, setFatos] = useState<FatosCanais | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setErro(null);
    const { data, error } = await supabase.rpc('fn_mkt_fatos_canais', { p_tenant_id: tenantId, p_dias: dias });
    if (error) setErro(error.message); else setFatos(data as FatosCanais);
    setLoading(false);
  }, [tenantId, dias]);
  useEffect(() => { void carregar(); }, [carregar]);

  const ops: Oportunidade[] = useMemo(() => (fatos ? gerarOportunidades(fatos) : []), [fatos]);
  const total = fatos?.canais.reduce((s, c) => s + c.receita, 0) ?? 0;

  // Mapa dia × hora (só horas com venda em algum dia).
  const mapa = useMemo(() => {
    if (!fatos) return null;
    const horas = [...new Set(fatos.hora_dia.filter((h) => h.pedidos > 0).map((h) => h.hora))].sort((a, b) => a - b);
    const max = Math.max(1, ...fatos.hora_dia.map((h) => h.pedidos));
    const val = new Map(fatos.hora_dia.map((h) => [`${h.dow}-${h.hora}`, h.pedidos]));
    return { horas, max, val };
  }, [fatos]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm text-zinc-500 flex-1 min-w-[220px]">
          O que os pedidos da loja mostram para o marketing, por canal. Calculado com os dados do ERPOS; não precisa da Meta e não usa IA.
        </p>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
          className="text-sm font-semibold border border-zinc-200 rounded-xl px-3 py-1.5 bg-white text-zinc-700 cursor-pointer">
          <option value={14}>Últimos 14 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={60}>Últimos 60 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
        <button onClick={() => void carregar()} disabled={loading} title="Atualizar"
          className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 cursor-pointer disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {erro && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> <span>{erro}</span>
        </div>
      )}

      {loading && !fatos ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-amber-500" /></div>
      ) : fatos && (
        <>
          {/* Canais */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-4">
            <p className="text-sm font-bold text-zinc-800 mb-3 flex items-center gap-2"><Store size={15} className="text-amber-500" /> Vendas por canal</p>
            {fatos.canais.length === 0 ? <p className="text-sm text-zinc-400">Sem pedidos no período.</p> : (
              <div className="space-y-2">
                {fatos.canais.map((c) => (
                  <div key={c.canal} className="grid grid-cols-[110px_1fr_auto] sm:grid-cols-[150px_1fr_auto] items-center gap-2 text-sm">
                    <span className="font-semibold text-zinc-700 truncate">{CANAL_LABEL[c.canal] ?? c.canal}</span>
                    <div className="h-2.5 rounded-full bg-zinc-100 overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${total ? Math.max(2, (c.receita / total) * 100) : 0}%` }} />
                    </div>
                    <span className="text-xs text-zinc-500 text-right whitespace-nowrap">
                      <strong className="text-zinc-700">{brl(c.receita)}</strong> · {c.pedidos} ped. · tíquete {brl(c.ticket ?? 0)}
                    </span>
                  </div>
                ))}
                <p className="text-[11px] text-zinc-400 pt-1">
                  Pedidos vindos de anúncio da Meta (link com utm): {fatos.vindos_da_meta}.
                  {fatos.ifood_portal?.periodo_fim ? ` Relatório do portal iFood importado: ${fatos.ifood_portal.periodo_inicio} a ${fatos.ifood_portal.periodo_fim}.` : ''}
                </p>
              </div>
            )}
          </div>

          {/* Oportunidades */}
          <div className="space-y-2">
            <p className="text-sm font-bold text-zinc-800 flex items-center gap-2"><Lightbulb size={15} className="text-amber-500" /> Oportunidades ({ops.length})</p>
            {ops.length === 0 && <p className="text-sm text-zinc-400 bg-white border border-zinc-200 rounded-2xl p-4">Nada fora do padrão com os dados deste período.</p>}
            {ops.map((o, idx) => (
              <div key={`${o.tipo}-${idx}`} className={`border rounded-2xl p-4 ${PRIO_CLS[o.prioridade]}`}>
                <div className="flex items-start gap-2 flex-wrap">
                  <p className="text-sm font-bold text-zinc-800 flex-1 min-w-[200px]">{o.titulo}</p>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{PRIO_LABEL[o.prioridade]}</span>
                </div>
                <p className="text-xs text-zinc-600 mt-1.5 leading-relaxed">{o.porque}</p>
                <p className="text-xs text-zinc-800 mt-1.5"><span className="font-semibold">O que fazer:</span> {o.acao}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <p className="text-[10px] text-zinc-400 flex-1">Fonte: {o.fonte}</p>
                  {(o.tipo === 'campeao_salao' || o.tipo === 'migrar_ifood' || o.tipo === 'margem_alta' || o.tipo === 'foto_fraca') && (
                    <Link to={o.tipo === 'foto_fraca' ? '/estudio?aba=biblioteca' : '/estudio?aba=criar'}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-fuchsia-600 hover:text-fuchsia-700">
                      <Wand2 size={12} /> {o.tipo === 'foto_fraca' ? 'Ver fotos no Estúdio' : 'Criar arte no Estúdio'}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Mapa dia × hora */}
          {mapa && mapa.horas.length > 0 && (
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-sm font-bold text-zinc-800 mb-3">Pedidos por dia e hora (todos os canais)</p>
              <div className="overflow-x-auto">
                <table className="text-[10px] border-separate" style={{ borderSpacing: 2 }}>
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-white" />
                      {mapa.horas.map((h) => <th key={h} className="font-semibold text-zinc-400 w-7">{h}h</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                      <tr key={dow}>
                        <td className="sticky left-0 bg-white pr-2 font-semibold text-zinc-500 capitalize whitespace-nowrap">{DIA_LABEL[dow].slice(0, 3)}</td>
                        {mapa.horas.map((h) => {
                          const v = mapa.val.get(`${dow}-${h}`) ?? 0;
                          const a = v / mapa.max;
                          return (
                            <td key={h} title={`${DIA_LABEL[dow]} ${h}h: ${v} pedido(s)`}
                              className="w-7 h-6 text-center rounded"
                              style={{ background: v ? `rgba(245, 158, 11, ${0.12 + a * 0.88})` : '#f4f4f5', color: a > 0.55 ? '#fff' : '#71717a' }}>
                              {v || ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <ManualGestor tenantId={tenantId} />
    </div>
  );
}
