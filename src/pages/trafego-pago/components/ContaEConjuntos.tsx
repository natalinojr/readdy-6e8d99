// Faixa da conta (saldo, gasto, limite), tabela de conjuntos de anúncios (orçamento, aprendizado,
// segmentação) e o cruzamento "raio do anúncio × área de entrega do ERPOS".
import { useState } from 'react';
import { Wallet, Layers, MapPin, AlertTriangle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import {
  brl, num, dec, pct, dataCurta, linkCtr, linkCpc, objectiveLabel, bidLabel,
  StatusBadge, Roas, ChartCard, LearningBadge, ACCOUNT_STATUS,
  type AccountInfo, type AdsetRow, type DeliveryArea, type Targeting,
} from '../shared';

// ─── Faixa da conta ──────────────────────────────────────────────────────────
export function ContaStrip({ account }: { account: AccountInfo | null | undefined }) {
  if (!account) return null;
  const st = ACCOUNT_STATUS[account.status] ?? { label: `status ${account.status}`, cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' };
  const item = (label: string, valor: string, destaque = false) => (
    <div className="min-w-[120px]">
      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide leading-none">{label}</p>
      <p className={`text-sm font-black tabular-nums mt-1 ${destaque ? 'text-red-600' : 'text-zinc-800'}`}>{valor}</p>
    </div>
  );
  const saldoBaixo = account.balance !== null && account.balance > 0 && account.balance < 50;
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-3 mb-4 flex items-center gap-5 flex-wrap">
      <div className="flex items-center gap-2">
        <Wallet size={15} className="text-amber-500" />
        <p className="text-sm font-bold text-zinc-800">Conta de anúncios</p>
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${st.cls}`}>{st.label}</span>
      </div>
      {item('Gasto total (histórico)', account.amount_spent !== null ? brl(account.amount_spent) : '—')}
      {account.balance !== null && account.balance !== 0 && item('Saldo pré-pago', brl(account.balance), saldoBaixo)}
      {item('Limite de gastos', account.spend_cap ? brl(account.spend_cap) : 'sem limite')}
      {account.funding && item('Forma de pagamento', account.funding)}
      {account.disable_reason > 0 && (
        <span className="text-xs text-red-600 font-semibold flex items-center gap-1"><AlertTriangle size={13} /> Conta com restrição na Meta — confira no Gerenciador.</span>
      )}
      {saldoBaixo && (
        <span className="text-xs text-red-600 font-semibold flex items-center gap-1"><AlertTriangle size={13} /> Saldo baixo: os anúncios param quando zerar.</span>
      )}
    </div>
  );
}

// ─── Resumo da segmentação ───────────────────────────────────────────────────
function resumoPublico(t: Targeting): string {
  const partes: string[] = [];
  if (t.age_min || t.age_max) partes.push(`${t.age_min ?? '?'}–${t.age_max ?? '65+'} anos`);
  if (t.genders !== 'todos') partes.push(t.genders);
  if (t.advantage_audience) partes.push('Advantage+');
  const pins = t.locations.filter((l) => l.radius_km !== null);
  if (pins.length) partes.push(`${pins.length} local${pins.length > 1 ? 'is' : ''} · raio ${dec(Math.max(...pins.map((p) => p.radius_km ?? 0)), 0)} km`);
  else if (t.locations.length) partes.push(t.locations.slice(0, 2).map((l) => l.name).join(', ') + (t.locations.length > 2 ? '…' : ''));
  if (t.interests.length) partes.push(`${t.interests.length} interesse${t.interests.length > 1 ? 's' : ''}`);
  if (t.custom_audiences.length) partes.push(`${t.custom_audiences.length} público${t.custom_audiences.length > 1 ? 's' : ''}`);
  return partes.join(' · ') || 'Sem segmentação definida';
}

function DetalheTargeting({ t }: { t: Targeting }) {
  const Chips = ({ itens, cor }: { itens: string[]; cor: string }) => (
    <div className="flex flex-wrap gap-1 mt-1">
      {itens.map((i) => <span key={i} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cor}`}>{i}</span>)}
    </div>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      <div>
        <p className="font-bold text-zinc-500 uppercase tracking-wider text-[10px]">Pessoas</p>
        <p className="text-zinc-700 mt-1">
          {t.age_min || t.age_max ? `${t.age_min ?? '?'} a ${t.age_max ?? '65+'} anos` : 'Todas as idades'} · {t.genders}
          {t.advantage_audience && ' · público ampliado pela Meta (Advantage+)'}
        </p>
        {t.interests.length > 0 && (<><p className="font-bold text-zinc-500 uppercase tracking-wider text-[10px] mt-2">Interesses</p><Chips itens={t.interests} cor="bg-violet-50 text-violet-700 border-violet-100" /></>)}
        {t.behaviors.length > 0 && (<><p className="font-bold text-zinc-500 uppercase tracking-wider text-[10px] mt-2">Comportamentos</p><Chips itens={t.behaviors} cor="bg-sky-50 text-sky-700 border-sky-100" /></>)}
        {t.custom_audiences.length > 0 && (<><p className="font-bold text-zinc-500 uppercase tracking-wider text-[10px] mt-2">Públicos personalizados</p><Chips itens={t.custom_audiences} cor="bg-emerald-50 text-emerald-700 border-emerald-100" /></>)}
        {t.excluded_audiences.length > 0 && (<><p className="font-bold text-zinc-500 uppercase tracking-wider text-[10px] mt-2">Excluídos</p><Chips itens={t.excluded_audiences} cor="bg-red-50 text-red-600 border-red-100" /></>)}
      </div>
      <div>
        <p className="font-bold text-zinc-500 uppercase tracking-wider text-[10px]">Localização</p>
        {t.locations.length === 0 ? <p className="text-zinc-400 mt-1">Não informada</p> : (
          <ul className="mt-1 space-y-0.5">
            {t.locations.map((l, i) => (
              <li key={i} className="text-zinc-700 flex items-center gap-1.5">
                <MapPin size={11} className="text-zinc-400 flex-shrink-0" />
                <span className="truncate">{l.name}</span>
                <span className="text-zinc-400">({l.type}{l.radius_km !== null ? `, raio ${dec(l.radius_km, 0)} km` : ''})</span>
              </li>
            ))}
          </ul>
        )}
        {t.location_types.length > 0 && <p className="text-[11px] text-zinc-400 mt-1">Quem: {t.location_types.join(', ').replace('home', 'mora').replace('recent', 'esteve recentemente')}</p>}
        {t.publisher_platforms.length > 0 && <p className="text-[11px] text-zinc-400 mt-1">Plataformas: {t.publisher_platforms.join(', ')}</p>}
      </div>
    </div>
  );
}

// ─── Tabela de conjuntos ─────────────────────────────────────────────────────
export function ConjuntosTable({
  adsets, campanhaSel, maxKm,
}: {
  adsets: AdsetRow[] | null | undefined;
  campanhaSel: string | null;
  maxKm: number | null;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  if (!adsets) return null;
  const lista = [...adsets].filter((a) => !campanhaSel || a.campaign === campanhaSel).sort((a, b) => b.spend - a.spend);

  const orcamento = (a: AdsetRow) => {
    if (a.daily_budget) return `${brl(a.daily_budget)}/dia`;
    if (a.lifetime_budget) return `${brl(a.lifetime_budget)} total${a.budget_remaining !== null ? ` · resta ${brl(a.budget_remaining)}` : ''}`;
    return 'na campanha';
  };
  const areaFlag = (a: AdsetRow) => {
    const pior = a.area_check.reduce((m, c) => Math.max(m, c.excede_km ?? 0), 0);
    const semRaio = a.targeting.locations.length > 0 && a.area_check.length === 0;
    if (pior > 0) return <span className="text-red-600 font-bold text-[11px]" title="O raio do anúncio passa da área de entrega">⚠ +{dec(pior, 0)} km</span>;
    if (semRaio) return <span className="text-amber-600 font-bold text-[11px]" title="Segmentação por cidade/estado, sem raio: provavelmente alcança fora da área de entrega">⚠ sem raio</span>;
    if (a.area_check.length) return <span className="text-emerald-600 font-bold text-[11px]">✓ dentro</span>;
    return <span className="text-zinc-300">—</span>;
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
        <Layers size={16} className="text-amber-500" />
        <p className="text-sm font-bold text-zinc-800">Conjuntos de anúncios</p>
        <span className="text-xs text-zinc-400">({lista.length})</span>
        <span className="text-[11px] text-zinc-400 ml-auto">É no conjunto que mora o público. Clique numa linha pra ver a segmentação completa.</span>
      </div>
      {lista.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-400">Nenhum conjunto no período.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100 bg-zinc-50/60">
                <th className="px-4 py-2.5 font-bold sticky left-0 bg-zinc-50/60">Conjunto</th>
                <th className="px-3 py-2.5 font-bold">Status</th>
                <th className="px-3 py-2.5 font-bold">Aprendizado</th>
                <th className="px-3 py-2.5 font-bold">Orçamento</th>
                <th className="px-3 py-2.5 font-bold">Lance</th>
                <th className="px-3 py-2.5 font-bold">Público</th>
                <th className="px-3 py-2.5 font-bold">Área</th>
                <th className="px-3 py-2.5 font-bold text-right">Investido</th>
                <th className="px-3 py-2.5 font-bold text-right">Compras</th>
                <th className="px-3 py-2.5 font-bold text-right">Vendas</th>
                <th className="px-3 py-2.5 font-bold text-right">ROAS</th>
                <th className="px-3 py-2.5 font-bold text-right">CTR link</th>
                <th className="px-3 py-2.5 font-bold text-right">CPC link</th>
                <th className="px-4 py-2.5 font-bold text-right">Freq.</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => {
                const open = aberto === a.adset_id;
                const problemas = a.issues.length + a.recommendations.length;
                return (
                  <FragmentRow key={a.adset_id}>
                    <tr onClick={() => setAberto(open ? null : a.adset_id)} className={`border-b border-zinc-50 cursor-pointer ${open ? 'bg-amber-50/60' : 'hover:bg-amber-50/40'}`}>
                      <td className={`px-4 py-2.5 sticky left-0 ${open ? 'bg-amber-50/60' : 'bg-white'}`}>
                        <div className="flex items-center gap-1.5">
                          {open ? <ChevronUp size={13} className="text-zinc-400" /> : <ChevronDown size={13} className="text-zinc-400" />}
                          <div className="min-w-0">
                            <p className="font-semibold text-zinc-800 max-w-[220px] truncate">{a.adset}</p>
                            <p className="text-[11px] text-zinc-400 max-w-[220px] truncate">{a.campaign} · {objectiveLabel(a.objective)}</p>
                          </div>
                          {problemas > 0 && <span className="ml-1 text-[10px] font-bold text-amber-600" title={`${problemas} aviso(s) da Meta`}>{problemas}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5"><StatusBadge status={a.status} /></td>
                      <td className="px-3 py-2.5"><LearningBadge learning={a.learning} /></td>
                      <td className="px-3 py-2.5 text-zinc-700 text-xs">{orcamento(a)}</td>
                      <td className="px-3 py-2.5 text-zinc-500 text-xs">{bidLabel(a.bid_strategy)}{a.bid_amount ? ` ${brl(a.bid_amount)}` : ''}</td>
                      <td className="px-3 py-2.5 text-zinc-600 text-xs max-w-[260px] truncate" title={resumoPublico(a.targeting)}>{resumoPublico(a.targeting)}</td>
                      <td className="px-3 py-2.5">{areaFlag(a)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-zinc-800">{brl(a.spend)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-600">{num(a.purchases ?? 0)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{brl(a.purchase_value ?? 0)}</td>
                      <td className="px-3 py-2.5 text-right"><Roas v={a.roas ?? 0} spend={a.spend} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500">{pct(linkCtr(a))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{brl(linkCpc(a))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{dec(a.frequency, 2)}x</td>
                    </tr>
                    {open && (
                      <tr className="bg-amber-50/30 border-b border-zinc-100">
                        <td colSpan={14} className="px-5 py-4">
                          <DetalheTargeting t={a.targeting} />
                          {a.area_check.length > 0 && (
                            <div className="mt-3 text-xs">
                              <p className="font-bold text-zinc-500 uppercase tracking-wider text-[10px]">Raio × área de entrega</p>
                              <ul className="mt-1 space-y-0.5">
                                {a.area_check.map((c, i) => (
                                  <li key={i} className={c.excede_km && c.excede_km > 0 ? 'text-red-600' : 'text-zinc-700'}>
                                    {c.name}: raio {dec(c.radius_km ?? 0, 1)} km
                                    {c.dist_store_km !== null && `, pin a ${dec(c.dist_store_km, 1)} km da loja`}
                                    {maxKm !== null && ` → alcança até ${dec(c.alcance_km ?? 0, 1)} km, a loja entrega até ${dec(maxKm, 0)} km`}
                                    {c.excede_km && c.excede_km > 0 ? ` (passa ${dec(c.excede_km, 1)} km)` : ''}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {(a.issues.length > 0 || a.recommendations.length > 0) && (
                            <div className="mt-3 text-xs">
                              <p className="font-bold text-zinc-500 uppercase tracking-wider text-[10px]">Avisos da Meta</p>
                              <ul className="mt-1 space-y-1">
                                {a.issues.map((t, i) => <li key={`i${i}`} className="text-red-600 flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{t}</li>)}
                                {a.recommendations.map((r, i) => <li key={`r${i}`} className="text-zinc-700 flex gap-1.5"><Sparkles size={12} className="mt-0.5 flex-shrink-0 text-amber-500" /><span><strong className="font-semibold">{r.title}</strong>{r.message ? ` — ${r.message}` : ''}</span></li>)}
                              </ul>
                            </div>
                          )}
                          <p className="text-[11px] text-zinc-400 mt-3">
                            Início {dataCurta(a.start_time)}{a.end_time ? ` · fim ${dataCurta(a.end_time)}` : ' · sem data de fim'}
                            {a.learning?.last_edit ? ` · última edição relevante ${dataCurta(a.learning.last_edit)}` : ''}
                            {a.billing_event ? ` · cobrança por ${a.billing_event.toLowerCase().replace(/_/g, ' ')}` : ''}
                          </p>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Fragmento com key (React.Fragment não aceita key em JSX curto).
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ─── Área do anúncio × área de entrega ───────────────────────────────────────
export function AreaEntregaCard({ area, adsets }: { area: DeliveryArea | null | undefined; adsets: AdsetRow[] | null | undefined }) {
  if (!area || !adsets) return null;
  const comRaio = adsets.filter((a) => a.area_check.length > 0);
  const semRaio = adsets.filter((a) => a.area_check.length === 0 && a.targeting.locations.length > 0);
  const passam = comRaio.filter((a) => a.area_check.some((c) => (c.excede_km ?? 0) > 0));
  const raioMax = comRaio.reduce((m, a) => Math.max(m, ...a.area_check.map((c) => c.alcance_km ?? 0)), 0);
  const gastoFora = passam.reduce((s, a) => s + a.spend, 0);

  return (
    <ChartCard icon={MapPin} titulo="Onde o anúncio chega × onde a loja entrega" className="mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">A loja entrega até</p>
          <p className="text-lg font-black text-zinc-900 tabular-nums">{area.max_km !== null ? `${dec(area.max_km, 0)} km` : '—'}</p>
          <p className="text-xs text-zinc-500">
            {area.max_km !== null ? 'pelas faixas do delivery' : 'faixas por km não configuradas'}
            {area.km_p90 !== null ? ` · 90% dos pedidos até ${dec(area.km_p90, 1)} km` : ''}
          </p>
        </div>
        <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3">
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Os anúncios alcançam até</p>
          <p className="text-lg font-black text-zinc-900 tabular-nums">{comRaio.length ? `${dec(raioMax, 0)} km` : '—'}</p>
          <p className="text-xs text-zinc-500">
            {comRaio.length ? `raio + distância do pin até a loja, em ${comRaio.length} conjunto${comRaio.length > 1 ? 's' : ''}` : 'nenhum conjunto usa raio no mapa'}
          </p>
        </div>
        <div className={`rounded-xl border p-3 ${passam.length || semRaio.length ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Diagnóstico</p>
          {passam.length > 0 ? (
            <>
              <p className="text-lg font-black text-red-700 tabular-nums">{brl(gastoFora)}</p>
              <p className="text-xs text-red-700">investidos em {passam.length} conjunto{passam.length > 1 ? 's' : ''} que alcança{passam.length > 1 ? 'm' : ''} fora da área de entrega</p>
            </>
          ) : semRaio.length > 0 ? (
            <>
              <p className="text-lg font-black text-red-700">{semRaio.length} sem raio</p>
              <p className="text-xs text-red-700">segmentação por cidade ou estado: alcança gente que a loja não atende</p>
            </>
          ) : comRaio.length > 0 ? (
            <>
              <p className="text-lg font-black text-emerald-700">Dentro da área</p>
              <p className="text-xs text-emerald-700">todo raio de anúncio cabe na área de entrega</p>
            </>
          ) : (
            <p className="text-xs text-zinc-500 mt-1">Sem conjuntos com localização no período.</p>
          )}
        </div>
      </div>
      {(!area.store || area.max_km === null) && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
          {!area.store && 'A loja não tem pin no mapa configurado, então não dá pra medir a distância do pin do anúncio até a loja. '}
          {area.max_km === null && 'As faixas de entrega por km não estão configuradas, então não dá pra saber até onde a loja entrega. '}
          Isso se ajusta em Gestão → Delivery.
        </p>
      )}
      <p className="text-[11px] text-zinc-400 mt-3 leading-relaxed">
        Anunciar para quem mora fora da área de entrega é dinheiro perdido por definição: a pessoa clica, monta o pedido e
        descobre que não recebe. Esse card compara o raio de cada conjunto com o limite das faixas de entrega do ERPOS.
      </p>
    </ChartCard>
  );
}
