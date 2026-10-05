// Financeiro › Entregadores: acerto dos motoboys (Delivery Fase 2, 2026-09-27).
// Os valores nascem no banco (gatilho em orders, regra em Config. do Delivery › Pagamento dos entregadores).
// Aqui: resumo do período, adiantamentos, chave Pix, "Fechar acerto" (gera a conta a pagar Pix com DRE,
// igual aos freelas) e o ranking por entregador. Tudo passa por RPCs que conferem a loja no servidor.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { confirmar } from '@/components/base/Dialogos';
import { KpiCard, Segmented } from './dreUi';

interface ResumoMotoboy {
  driver_id: string; name: string; phone: string | null; pix_key: string | null; pix_key_kind: string | null; is_active: boolean;
  entregas: number; km: number; valor_entregas: number; valor_diarias: number; diarias_a_lancar: number;
  adiantamentos: number; estornos: number; sem_km: number; total: number;
}
interface Acerto {
  id: string; driver_id: string; period_start: string; period_end: string; entregas: number; total: number;
  status: 'fechado' | 'cancelado'; closed_at: string; payable_id: string | null;
  driver?: { name: string } | { name: string }[] | null;
  payable?: { status: string; paid_amount: number | null } | { status: string; paid_amount: number | null }[] | null;
}
interface Lancamento {
  id: string; kind: 'entrega' | 'diaria' | 'adiantamento' | 'estorno'; amount: number; km: number | null; work_date: string;
  status: string; note: string | null; order?: { number: string | null } | { number: string | null }[] | null;
}
interface Ranking {
  driver_id: string; name: string; entregas: number; tempo_total_min: number | null; tempo_rota_min: number | null;
  atrasos: number; pct_atraso: number | null; km: number; custo: number; custo_por_entrega: number | null;
}
interface DreCat { id: string; name: string; group_type: string; parent_id: string | null }

const um = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isoDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const br = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}${y !== String(new Date().getFullYear()) ? '/' + y.slice(2) : ''}`; };
const erroMsg = (e: unknown) => String((e as { message?: string })?.message ?? e ?? 'erro').replace(/^.*?ERROR:\s*/, '');

const KIND_LABEL: Record<Lancamento['kind'], string> = { entrega: 'Entrega', diaria: 'Diária', adiantamento: 'Adiantamento', estorno: 'Estorno' };
const DRE_KEY = 'erpos.acerto_motoboy.dre';

function periodoRapido(tipo: 'semana' | 'semana_passada' | 'mes' | 'mes_passado'): [string, string] {
  const h = new Date();
  if (tipo === 'mes') return [isoDe(new Date(h.getFullYear(), h.getMonth(), 1)), isoDe(h)];
  if (tipo === 'mes_passado') return [isoDe(new Date(h.getFullYear(), h.getMonth() - 1, 1)), isoDe(new Date(h.getFullYear(), h.getMonth(), 0))];
  const seg = new Date(h); seg.setDate(h.getDate() - ((h.getDay() + 6) % 7)); // segunda desta semana
  if (tipo === 'semana') return [isoDe(seg), isoDe(h)];
  const segAnt = new Date(seg); segAnt.setDate(seg.getDate() - 7);
  const domAnt = new Date(seg); domAnt.setDate(seg.getDate() - 1);
  return [isoDe(segAnt), isoDe(domAnt)];
}

export default function EntregadoresTab() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [[de, ate], setPeriodo] = useState<[string, string]>(() => periodoRapido('semana'));
  const [resumo, setResumo] = useState<ResumoMotoboy[]>([]);
  const [acertos, setAcertos] = useState<Acerto[]>([]);
  const [ranking, setRanking] = useState<Ranking[]>([]);
  const [dreCats, setDreCats] = useState<DreCat[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [fechando, setFechando] = useState<ResumoMotoboy | null>(null);
  const [adiantando, setAdiantando] = useState<ResumoMotoboy | null>(null);
  const [pixDe, setPixDe] = useState<ResumoMotoboy | null>(null);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    setCarregando(true); setErro('');
    try {
      const [r, a, k] = await Promise.all([
        supabase.rpc('fn_acerto_motoboy_resumo', { p_tenant: tenantId, p_de: de, p_ate: ate }),
        supabase.from('delivery_driver_settlements')
          .select('id, driver_id, period_start, period_end, entregas, total, status, closed_at, payable_id, driver:delivery_drivers(name), payable:fin_accounts_payable(status, paid_amount)')
          .eq('tenant_id', tenantId).lte('period_start', ate).gte('period_end', de).order('closed_at', { ascending: false }).limit(100),
        supabase.rpc('fn_delivery_ranking_entregadores', { p_tenant: tenantId, p_de: de, p_ate: ate }),
      ]);
      if (r.error) throw r.error;
      if (a.error) throw a.error;
      if (k.error) throw k.error;
      setResumo((r.data as ResumoMotoboy[]) ?? []);
      setAcertos((a.data as Acerto[]) ?? []);
      setRanking((k.data as Ranking[]) ?? []);
    } catch (e) {
      setErro(erroMsg(e));
    } finally {
      setCarregando(false);
    }
  }, [tenantId, de, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from('fin_dre_categories').select('id, name, group_type, parent_id')
      .eq('tenant_id', tenantId).eq('is_active', true).is('deleted_at', null).not('group_type', 'in', '(revenue,tax)')
      .order('group_type').order('sort_order')
      .then(({ data }) => setDreCats((data as DreCat[]) ?? []));
  }, [tenantId]);

  // A pagar = soma dos saldos positivos (quem deve à loja por adiantamento não abate o que os outros recebem)
  const totalGeral = useMemo(() => resumo.reduce((s, r) => s + Math.max(Number(r.total), 0), 0), [resumo]);

  const desfazer = async (a: Acerto) => {
    if (!tenantId) return;
    if (!(await confirmar({
      titulo: `Desfazer o acerto de ${um(a.driver)?.name ?? 'entregador'} (${formatCurrency(Number(a.total))})?`,
      mensagem: 'A conta a pagar é apagada e os lançamentos voltam a ficar em aberto.',
      confirmarLabel: 'Desfazer acerto', perigo: true,
    }))) return;
    const { error } = await supabase.rpc('fn_acerto_motoboy_desfazer', { p_tenant: tenantId, p_settlement: a.id });
    if (error) { setErro(erroMsg(error)); return; }
    setAviso('Acerto desfeito.'); carregar();
  };

  const totalEntregas = resumo.reduce((s, x) => s + Number(x.entregas), 0);
  const comSaldo = resumo.filter((x) => Number(x.total) > 0).length;
  const acertosFechados = acertos.filter((a) => a.status === 'fechado').length;
  const periodoAtivo = (['semana', 'semana_passada', 'mes', 'mes_passado'] as const).find((k) => {
    const [a, b] = periodoRapido(k);
    return a === de && b === ate;
  }) ?? 'custom';

  if (!tenantId) return <div className="py-14 text-center"><i className="ri-store-2-line text-4xl text-zinc-200" /><p className="text-zinc-400 text-sm mt-2">Escolha uma loja.</p></div>;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Período */}
      <div className="flex flex-wrap items-end gap-2 lg:gap-3">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">De
          <input type="date" value={de} max={ate} onChange={(e) => e.target.value && setPeriodo([e.target.value, ate])}
            className="block mt-1 h-10 px-3 rounded-xl border border-zinc-200 shadow-sm bg-white text-sm normal-case tracking-normal font-normal text-zinc-800" />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Até
          <input type="date" value={ate} min={de} max={hojeISO()} onChange={(e) => e.target.value && setPeriodo([de, e.target.value])}
            className="block mt-1 h-10 px-3 rounded-xl border border-zinc-200 shadow-sm bg-white text-sm normal-case tracking-normal font-normal text-zinc-800" />
        </label>
        <div className="overflow-x-auto max-w-full">
          <Segmented
            value={periodoAtivo}
            onChange={(k) => { if (k !== 'custom') setPeriodo(periodoRapido(k)); }}
            options={[
              { id: 'semana', label: 'Esta semana', icon: 'ri-calendar-line' },
              { id: 'semana_passada', label: 'Semana passada', icon: 'ri-history-line' },
              { id: 'mes', label: 'Este mês', icon: 'ri-calendar-2-line' },
              { id: 'mes_passado', label: 'Mês passado', icon: 'ri-calendar-check-line' },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard label={`A pagar até ${br(ate)}`} icon="ri-money-dollar-circle-line" value={formatCurrency(totalGeral)} valueTone={totalGeral > 0 ? 'text-amber-700' : undefined} atual={totalGeral} semVariacao />
        <KpiCard label="Entregadores com saldo" icon="ri-motorbike-line" value={String(comSaldo)} sub={`${resumo.length} em aberto no total`} atual={comSaldo} semVariacao />
        <KpiCard label="Entregas em aberto" icon="ri-e-bike-2-line" value={String(totalEntregas)} atual={totalEntregas} semVariacao />
        <KpiCard label="Acertos fechados" icon="ri-checkbox-circle-line" value={String(acertosFechados)} sub="no período" atual={acertosFechados} semVariacao />
      </div>

      {erro ? (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <i className="ri-error-warning-line text-red-500" />
          <p className="text-xs text-red-700">{erro}</p>
        </div>
      ) : null}
      {aviso ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <i className="ri-checkbox-circle-line text-emerald-600" />
          <p className="text-xs text-emerald-800">{aviso}</p>
        </div>
      ) : null}

      {/* Em aberto por motoboy */}
      <section className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-zinc-800">Em aberto até {br(ate)}</h3>
            <p className="text-xs text-zinc-400">O acerto fecha tudo o que está pendente até a data final (inclusive adiantamentos e estornos de antes do período).</p>
          </div>
          <span className="text-[11px] text-zinc-400 flex items-center gap-1"><i className="ri-cursor-line" /> clique no nome para ver os lançamentos</span>
        </div>
        {carregando && resumo.length === 0 ? (
          <div className="py-14 text-center"><i className="ri-loader-4-line animate-spin text-4xl text-zinc-200" /><p className="text-zinc-400 text-sm mt-2">Carregando…</p></div>
        ) : resumo.length === 0 ? (
          <div className="py-14 text-center">
            <i className="ri-motorbike-line text-4xl text-zinc-200" />
            <p className="text-zinc-400 text-sm mt-2 max-w-md mx-auto">
              Nada em aberto neste período. As entregas entram aqui quando o pedido é marcado como entregue
              (com a regra ligada em Config. do Delivery › Pagamento dos entregadores).
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100/80">
            {resumo.map((r) => (
              <li key={r.driver_id} className="px-5 py-3 hover:bg-zinc-50/60">
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => setAberto(aberto === r.driver_id ? null : r.driver_id)} className="flex-1 min-w-[180px] text-left">
                    <p className="text-sm font-bold text-zinc-800">{r.name}{r.is_active ? '' : ' (bloqueado)'}</p>
                    <p className="text-xs text-zinc-500 break-words">
                      {r.entregas} entrega(s) · {Number(r.km).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km · entregas {formatCurrency(Number(r.valor_entregas))}
                      {Number(r.valor_diarias) ? ` · diárias ${formatCurrency(Number(r.valor_diarias))}` : ''}
                      {Number(r.adiantamentos) ? ` · adiantamentos ${formatCurrency(Number(r.adiantamentos))}` : ''}
                      {Number(r.estornos) ? ` · estornos ${formatCurrency(Number(r.estornos))}` : ''}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {r.pix_key ? `Pix: ${r.pix_key}` : 'Sem chave Pix'}{r.sem_km ? ` · ${r.sem_km} entrega(s) sem distância` : ''}
                    </p>
                  </button>
                  <p className={'text-lg font-bold tabular-nums tracking-tight whitespace-nowrap ' + (Number(r.total) > 0 ? 'text-zinc-900' : 'text-red-600')}>{formatCurrency(Number(r.total))}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setAdiantando(r)} className="px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm">Adiantamento</button>
                    <button type="button" onClick={() => setPixDe(r)} className="px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm">Pix</button>
                    <button type="button" disabled={Number(r.total) <= 0} onClick={() => setFechando(r)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm disabled:opacity-40 disabled:cursor-default">Fechar acerto</button>
                  </div>
                </div>
                {aberto === r.driver_id ? <DetalheLancamentos tenantId={tenantId} driverId={r.driver_id} ate={ate} onMudou={carregar} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Acertos fechados */}
      <section className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100">
          <h3 className="text-sm font-bold text-zinc-800">Acertos do período</h3>
          <p className="text-xs text-zinc-400">Acertos fechados que tocam as datas escolhidas</p>
        </div>
        {acertos.length === 0 ? (
          <div className="py-14 text-center"><i className="ri-file-list-3-line text-4xl text-zinc-200" /><p className="text-zinc-400 text-sm mt-2">Nenhum acerto fechado neste período.</p></div>
        ) : (
          <ul className="divide-y divide-zinc-100/80">
            {acertos.map((a) => {
              const conta = um(a.payable);
              const pago = conta && (conta.status === 'paid' || Number(conta.paid_amount ?? 0) > 0);
              return (
                <li key={a.id} className={'px-5 py-3 hover:bg-zinc-50/60 flex flex-wrap items-center gap-2 ' + (a.status === 'cancelado' ? 'opacity-50' : '')}>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-semibold text-zinc-800">{um(a.driver)?.name ?? '—'} · {br(a.period_start)}{a.period_start !== a.period_end ? ` a ${br(a.period_end)}` : ''}</p>
                    <p className="text-[11px] text-zinc-400">
                      {a.entregas} entrega(s) · fechado em {new Date(a.closed_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {a.status === 'cancelado' ? ' · desfeito' : pago ? ' · conta paga' : ' · conta a pagar pendente'}
                    </p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${a.status === 'cancelado' ? 'bg-zinc-100 text-zinc-600' : pago ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {a.status === 'cancelado' ? 'Desfeito' : pago ? 'Paga' : 'Pendente'}
                  </span>
                  <p className="text-sm font-bold tabular-nums whitespace-nowrap text-zinc-900">{formatCurrency(Number(a.total))}</p>
                  {a.status === 'fechado' && !pago ? (
                    <button type="button" onClick={() => desfazer(a)} className="px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm">Desfazer</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Ranking */}
      <section className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100">
          <h3 className="text-sm font-bold text-zinc-800">Ranking por entregador</h3>
          <p className="text-xs text-zinc-400">Tempo, atrasos e custo no período</p>
        </div>
        {ranking.length === 0 ? (
          <div className="py-14 text-center"><i className="ri-trophy-line text-4xl text-zinc-200" /><p className="text-zinc-400 text-sm mt-2">Sem entregas com motoboy da loja neste período.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left">
                  <th className="pl-5 pr-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Entregador</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 text-right">Entregas</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 text-right">Tempo médio</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 text-right">Em rota</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 text-right">Atrasos</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 text-right">Km</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 text-right">Custo</th>
                  <th className="pl-4 pr-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 text-right">Por entrega</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">
                {ranking.map((k) => (
                  <tr key={k.driver_id} className="hover:bg-zinc-50">
                    <td className="pl-5 pr-4 py-3 font-semibold text-zinc-800 whitespace-nowrap">{k.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{k.entregas}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{k.tempo_total_min != null ? `${k.tempo_total_min} min` : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{k.tempo_rota_min != null ? `${k.tempo_rota_min} min` : '—'}</td>
                    <td className={'px-2 py-2 text-right whitespace-nowrap ' + (k.atrasos > 0 ? 'text-red-600 font-semibold' : '')}>{k.atrasos}{k.pct_atraso != null ? ` (${k.pct_atraso}%)` : ''}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(k.km).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{formatCurrency(Number(k.custo))}</td>
                    <td className="pl-4 pr-5 py-3 text-right tabular-nums whitespace-nowrap">{k.custo_por_entrega != null ? formatCurrency(Number(k.custo_por_entrega)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-5 py-3 border-t border-zinc-100 text-[11px] text-zinc-400">Tempo médio: do pedido até a entrega. Em rota: de "coletou" até "entregou". Custo: entregas + diárias lançadas no período.</p>
          </div>
        )}
      </section>

      {fechando ? (
        <FecharAcertoModal tenantId={tenantId} r={fechando} de={de} ate={ate} dreCats={dreCats}
          onClose={() => setFechando(null)} onFeito={(msg) => { setFechando(null); setAviso(msg); carregar(); }} />
      ) : null}
      {adiantando ? (
        <AdiantamentoModal tenantId={tenantId} r={adiantando} onClose={() => setAdiantando(null)} onFeito={() => { setAdiantando(null); setAviso('Adiantamento lançado.'); carregar(); }} />
      ) : null}
      {pixDe ? (
        <PixModal tenantId={tenantId} r={pixDe} onClose={() => setPixDe(null)} onFeito={() => { setPixDe(null); carregar(); }} />
      ) : null}
    </div>
  );
}

function DetalheLancamentos({ tenantId, driverId, ate, onMudou }: { tenantId: string; driverId: string; ate: string; onMudou: () => void }) {
  const [linhas, setLinhas] = useState<Lancamento[] | null>(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => {
    supabase.from('delivery_driver_ledger').select('id, kind, amount, km, work_date, status, note, order:orders(number)')
      .eq('tenant_id', tenantId).eq('driver_id', driverId).eq('status', 'aberto').lte('work_date', ate)
      .order('work_date').order('created_at')
      .then(({ data, error }) => { if (error) setErro(erroMsg(error)); setLinhas((data as Lancamento[]) ?? []); });
  }, [tenantId, driverId, ate]);
  useEffect(() => { carregar(); }, [carregar]);
  const apagar = async (l: Lancamento) => {
    if (!(await confirmar({
      titulo: `Apagar o adiantamento de ${formatCurrency(Math.abs(Number(l.amount)))}?`,
      mensagem: 'Ele deixa de abater o que o entregador tem a receber.',
      confirmarLabel: 'Apagar', perigo: true,
    }))) return;
    const { error } = await supabase.rpc('fn_acerto_motoboy_apagar_adiantamento', { p_tenant: tenantId, p_id: l.id });
    if (error) { setErro(erroMsg(error)); return; }
    carregar(); onMudou();
  };
  if (linhas === null) return <p className="mt-2 text-xs text-zinc-400">Carregando…</p>;
  return (
    <div className="mt-2 rounded-xl bg-zinc-50 border border-zinc-100 p-2">
      {erro ? <p className="text-xs text-red-600 px-1">{erro}</p> : null}
      {linhas.length === 0 ? <p className="text-xs text-zinc-400 px-1">Sem lançamentos.</p> : (
        <ul className="text-xs divide-y divide-zinc-100">
          {linhas.map((l) => {
            const num = um(l.order)?.number;
            return (
              <li key={l.id} className="flex items-center gap-2 px-1 py-1.5">
                <span className="w-12 text-zinc-400">{br(l.work_date)}</span>
                <span className="flex-1 text-zinc-700">
                  {KIND_LABEL[l.kind]}{num ? ` #${String(num).replace(/\D/g, '').slice(-4) || num}` : ''}
                  {l.km != null && l.kind === 'entrega' ? ` · ${Number(l.km).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : ''}
                  {l.note ? <span className="text-zinc-400"> · {l.note}</span> : null}
                </span>
                <span className={'font-semibold ' + (Number(l.amount) < 0 ? 'text-red-600' : 'text-zinc-800')}>{formatCurrency(Number(l.amount))}</span>
                {l.kind === 'adiantamento' ? (
                  <button type="button" onClick={() => apagar(l)} className="text-zinc-400 hover:text-red-600" aria-label="Apagar adiantamento"><i className="ri-delete-bin-line" /></button>
                ) : <span className="w-3" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-zinc-900">{titulo}</h3>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100" aria-label="Fechar"><i className="ri-close-line" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FecharAcertoModal({ tenantId, r, de, ate, dreCats, onClose, onFeito }: {
  tenantId: string; r: ResumoMotoboy; de: string; ate: string; dreCats: DreCat[]; onClose: () => void; onFeito: (msg: string) => void;
}) {
  const padrao = useMemo(() => {
    let salvo = '';
    try { salvo = localStorage.getItem(DRE_KEY) ?? ''; } catch { /* ok */ }
    if (salvo && dreCats.some((c) => c.id === salvo)) return salvo;
    return dreCats.find((c) => c.name.trim().toLowerCase() === 'entregadores')?.id ?? '';
  }, [dreCats]);
  const [dre, setDre] = useState(padrao);
  const [venc, setVenc] = useState(hojeISO());
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const fechar = async () => {
    setEnviando(true); setErro('');
    const { data, error } = await supabase.rpc('fn_acerto_motoboy_fechar', {
      p_tenant: tenantId, p_driver: r.driver_id, p_de: de, p_ate: ate,
      p_dre_category_id: dre || null, p_vencimento: venc || null, p_obs: obs || null,
    });
    setEnviando(false);
    if (error) { setErro(erroMsg(error)); return; }
    try { if (dre) localStorage.setItem(DRE_KEY, dre); } catch { /* ok */ }
    const total = Number((data as { total?: number } | null)?.total ?? r.total);
    onFeito(`Acerto de ${r.name} fechado: ${formatCurrency(total)}. A conta a pagar (Pix) está em Contas a Pagar.`);
  };

  return (
    <Modal titulo={`Fechar acerto — ${r.name}`} onClose={onClose}>
      <div className="rounded-xl bg-zinc-50 p-3 text-sm space-y-1">
        <p className="text-xs text-zinc-500">Tudo em aberto até {br(ate)}</p>
        <Linha l={`${r.entregas} entrega(s)`} v={Number(r.valor_entregas)} />
        {Number(r.valor_diarias) ? <Linha l={`Diárias${r.diarias_a_lancar ? ` (${r.diarias_a_lancar} a lançar)` : ''}`} v={Number(r.valor_diarias)} /> : null}
        {Number(r.adiantamentos) ? <Linha l="Adiantamentos" v={Number(r.adiantamentos)} /> : null}
        {Number(r.estornos) ? <Linha l="Estornos (pedidos desfeitos)" v={Number(r.estornos)} /> : null}
        <div className="border-t border-zinc-200 pt-1"><Linha l="Total a pagar" v={Number(r.total)} forte /></div>
      </div>
      <label className="block text-xs text-zinc-500">Categoria da DRE
        <select value={dre} onChange={(e) => setDre(e.target.value)} className="block w-full mt-1 px-2 py-2 rounded-lg border border-zinc-200 text-sm">
          <option value="">Entregadores (criar se não existir)</option>
          {dreCats.map((c) => <option key={c.id} value={c.id}>{c.name}{c.group_type === 'cost' ? ' (custo)' : ''}</option>)}
        </select>
      </label>
      <label className="block text-xs text-zinc-500">Vencimento
        <input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} className="block w-full mt-1 px-2 py-2 rounded-lg border border-zinc-200 text-sm" />
      </label>
      <label className="block text-xs text-zinc-500">Observação (opcional)
        <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={200} className="block w-full mt-1 px-2 py-2 rounded-lg border border-zinc-200 text-sm" />
      </label>
      {!r.pix_key ? <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Sem chave Pix cadastrada: cadastre em "Pix" para ela ir junto na conta a pagar.</p> : null}
      {erro ? <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</p> : null}
      <button type="button" onClick={fechar} disabled={enviando}
        className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50">
        {enviando ? 'Fechando…' : `Fechar e gerar conta a pagar de ${formatCurrency(Number(r.total))}`}
      </button>
      <p className="text-[11px] text-zinc-400">Gera uma conta a pagar Pix pendente com a categoria escolhida. O pagamento e a baixa seguem o caminho de sempre (Contas a Pagar / conciliação).</p>
    </Modal>
  );
}

function Linha({ l, v, forte }: { l: string; v: number; forte?: boolean }) {
  return (
    <div className={'flex justify-between ' + (forte ? 'font-black text-zinc-900' : 'text-zinc-700')}>
      <span>{l}</span><span className={v < 0 ? 'text-red-600' : ''}>{formatCurrency(v)}</span>
    </div>
  );
}

function AdiantamentoModal({ tenantId, r, onClose, onFeito }: { tenantId: string; r: ResumoMotoboy; onClose: () => void; onFeito: () => void }) {
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hojeISO());
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const salvar = async () => {
    const v = Number(valor.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) { setErro('Informe o valor.'); return; }
    setEnviando(true); setErro('');
    const { error } = await supabase.rpc('fn_acerto_motoboy_adiantamento', { p_tenant: tenantId, p_driver: r.driver_id, p_valor: v, p_data: data, p_nota: nota || null });
    setEnviando(false);
    if (error) { setErro(erroMsg(error)); return; }
    onFeito();
  };
  return (
    <Modal titulo={`Adiantamento — ${r.name}`} onClose={onClose}>
      <p className="text-xs text-zinc-500">Vale já entregue ao motoboy. É descontado no próximo acerto que incluir esta data. Só registra — não mexe no caixa.</p>
      <label className="block text-xs text-zinc-500">Valor (R$)
        <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" className="block w-full mt-1 px-2 py-2 rounded-lg border border-zinc-200 text-sm" />
      </label>
      <label className="block text-xs text-zinc-500">Data
        <input type="date" value={data} max={hojeISO()} onChange={(e) => setData(e.target.value)} className="block w-full mt-1 px-2 py-2 rounded-lg border border-zinc-200 text-sm" />
      </label>
      <label className="block text-xs text-zinc-500">Observação
        <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={120} className="block w-full mt-1 px-2 py-2 rounded-lg border border-zinc-200 text-sm" />
      </label>
      {erro ? <p className="text-xs text-red-600">{erro}</p> : null}
      <button type="button" onClick={salvar} disabled={enviando} className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-bold disabled:opacity-50">
        {enviando ? 'Salvando…' : 'Lançar adiantamento'}
      </button>
    </Modal>
  );
}

function PixModal({ tenantId, r, onClose, onFeito }: { tenantId: string; r: ResumoMotoboy; onClose: () => void; onFeito: () => void }) {
  const [chave, setChave] = useState(r.pix_key ?? '');
  const [tipo, setTipo] = useState(r.pix_key_kind ?? 'telefone');
  const [erro, setErro] = useState('');
  const salvar = async () => {
    setErro('');
    const { error } = await supabase.rpc('fn_acerto_motoboy_pix', { p_tenant: tenantId, p_driver: r.driver_id, p_chave: chave, p_tipo: tipo });
    if (error) { setErro(erroMsg(error)); return; }
    onFeito();
  };
  return (
    <Modal titulo={`Chave Pix — ${r.name}`} onClose={onClose}>
      <label className="block text-xs text-zinc-500">Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="block w-full mt-1 px-2 py-2 rounded-lg border border-zinc-200 text-sm">
          <option value="telefone">Telefone</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option>
          <option value="email">E-mail</option><option value="evp">Aleatória</option>
        </select>
      </label>
      <label className="block text-xs text-zinc-500">Chave
        <input value={chave} onChange={(e) => setChave(e.target.value)} maxLength={120} className="block w-full mt-1 px-2 py-2 rounded-lg border border-zinc-200 text-sm" />
      </label>
      {erro ? <p className="text-xs text-red-600">{erro}</p> : null}
      <button type="button" onClick={salvar} className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-bold">Salvar</button>
    </Modal>
  );
}
