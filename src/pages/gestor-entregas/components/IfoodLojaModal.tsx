import { useCallback, useEffect, useState } from 'react';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { ifoodShipping } from '@/lib/ifoodShipping';

interface Props {
  tenantId: string;
  merchants: { id: string; name: string }[];
  podeEditar: boolean;
  onClose: () => void;
}

// Política de avaliações do iFood (link obrigatório na tela — critério de homologação do Review).
const POLITICA_AVALIACOES = 'https://blog-parceiros.ifood.com.br/avaliacoes-e-moderacoes/';
const DIAS: [string, string][] = [['MONDAY', 'Segunda'], ['TUESDAY', 'Terça'], ['WEDNESDAY', 'Quarta'], ['THURSDAY', 'Quinta'], ['FRIDAY', 'Sexta'], ['SATURDAY', 'Sábado'], ['SUNDAY', 'Domingo']];
const inp = 'px-2 py-1.5 rounded-lg border border-zinc-200 focus:border-red-400 outline-none text-xs';

interface Turno { dayOfWeek: string; start: string; duration: number }
interface Pausa { id: string; description?: string; start: string; end: string }
interface StatusOp { operation?: string; state?: string; available?: boolean; message?: { title?: string; subtitle?: string; description?: string }; validations?: { code?: string; state?: string; message?: { title?: string; description?: string } }[] }
interface Review { id: string; status?: string; score?: number; comment?: string; customerName?: string; createdAt?: string; replies?: { text: string; from: string; createdAt?: string }[]; order?: { shortId?: string } }

const hhmm = (s: string) => s.slice(0, 5);
const fim = (start: string, dur: number) => { const m = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + dur; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const dataHora = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const TOM_ESTADO: Record<string, string> = { OK: 'bg-emerald-100 text-emerald-800', WARNING: 'bg-amber-100 text-amber-800', CLOSED: 'bg-zinc-200 text-zinc-700', ERROR: 'bg-red-100 text-red-700' };
const ESTADO: Record<string, string> = { OK: 'Aberta', WARNING: 'Aberta com alerta', CLOSED: 'Fechada', ERROR: 'Com problema' };

/**
 * Loja no iFood (módulos Merchant e Review do app ERPOS PDV): status, pausas, horários e avaliações.
 * Alterar (pausar, horários, responder) = admin/gerente; a edge confere de novo.
 */
export default function IfoodLojaModal({ tenantId, merchants, podeEditar, onClose }: Props) {
  useVoltarFecha(true, onClose, 'ifood-loja');
  const [loja, setLoja] = useState(merchants[0]?.id ?? '');
  const [aba, setAba] = useState<'loja' | 'avaliacoes'>('loja');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState('');

  // Loja
  const [carregando, setCarregando] = useState(false);
  const [status, setStatus] = useState<StatusOp[] | null>(null);
  const [pausas, setPausas] = useState<Pausa[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [turnosSujo, setTurnosSujo] = useState(false);
  const [pausaMin, setPausaMin] = useState(30);
  const [pausaMotivo, setPausaMotivo] = useState('');

  // Avaliações
  const [reviews, setReviews] = useState<Review[]>([]);
  const [resumo, setResumo] = useState<{ totalReviewsCount?: number; validReviewsCount?: number; score?: number } | null>(null);
  const [pagina, setPagina] = useState(1);
  const [totalPag, setTotalPag] = useState(1);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [respondendo, setRespondendo] = useState<string | null>(null);
  const [resposta, setResposta] = useState('');

  const carregarLoja = useCallback(async () => {
    if (!loja) return;
    setCarregando(true); setMsg(null);
    const r = await ifoodShipping<{ status: StatusOp[] | null; interruptions: Pausa[] | null; opening_hours: { shifts?: Turno[] } | null; errors: string[] }>('merchant_overview', tenantId, { merchant_id: loja });
    setCarregando(false);
    if (!r.success) { setMsg({ ok: false, t: r.error ?? 'Falhou.' }); return; }
    setStatus(r.status); setPausas(r.interruptions ?? []);
    setTurnos((r.opening_hours?.shifts ?? []).map((t) => ({ dayOfWeek: t.dayOfWeek, start: hhmm(t.start), duration: t.duration })));
    setTurnosSujo(false);
    if (r.errors?.length) setMsg({ ok: false, t: r.errors.join(' | ') });
  }, [tenantId, loja]);

  const carregarAvaliacoes = useCallback(async (pag = 1) => {
    if (!loja) return;
    setCarregando(true); setMsg(null);
    const [lista, sum] = await Promise.all([
      ifoodShipping<{ reviews?: Review[]; pageCount?: number }>('reviews_list', tenantId, { merchant_id: loja, page: pag, date_from: de || undefined, date_to: ate || undefined }),
      ifoodShipping<{ summary: typeof resumo }>('reviews_summary', tenantId, { merchant_id: loja }),
    ]);
    setCarregando(false);
    if (!lista.success) { setMsg({ ok: false, t: lista.error ?? 'Falhou.' }); return; }
    setReviews(lista.reviews ?? []); setTotalPag(Math.max(1, lista.pageCount ?? 1)); setPagina(pag);
    setResumo(sum.success ? sum.summary : null);
  }, [tenantId, loja, de, ate]);

  useEffect(() => { if (aba === 'loja') carregarLoja(); else carregarAvaliacoes(1); }, [aba, loja]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, action: string, extra: Record<string, unknown>, sucesso: string) => {
    setBusy(key); setMsg(null);
    const r = await ifoodShipping(action, tenantId, { merchant_id: loja, ...extra });
    setBusy('');
    setMsg({ ok: r.success, t: r.success ? sucesso : (r.error ?? 'Falhou.') });
    return r.success;
  };

  const pausar = async () => { if (await run('pausa', 'merchant_pause_create', { minutes: pausaMin, description: pausaMotivo }, `Loja pausada por ${pausaMin} min no iFood.`)) { setPausaMotivo(''); carregarLoja(); } };
  const tirarPausa = async (id: string) => { if (await run('del' + id, 'merchant_pause_delete', { interruption_id: id }, 'Pausa removida.')) carregarLoja(); };
  const salvarHorarios = async () => { if (await run('horas', 'merchant_hours_save', { shifts: turnos }, 'Horários salvos no iFood.')) carregarLoja(); };
  const responder = async (id: string) => {
    if (await run('resp' + id, 'review_answer', { review_id: id, text: resposta.trim() }, 'Resposta publicada.')) { setRespondendo(null); setResposta(''); carregarAvaliacoes(pagina); }
  };
  const setTurno = (i: number, patch: Partial<Turno>) => { setTurnos((ts) => ts.map((t, k) => (k === i ? { ...t, ...patch } : t))); setTurnosSujo(true); };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[94vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-zinc-100 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg shrink-0"><i className="ri-store-2-fill text-red-600" /></div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-zinc-800">Loja no iFood</h4>
              {merchants.length > 1 ? (
                <select value={loja} onChange={(e) => setLoja(e.target.value)} className={inp + ' mt-0.5'}>
                  {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              ) : <p className="text-xs text-zinc-500 truncate">{merchants[0]?.name ?? 'Nenhuma loja autorizada'}</p>}
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100"><i className="ri-close-line text-lg" /></button>
          </div>
          <div className="flex gap-1">
            {([['loja', 'Status, pausas e horários'], ['avaliacoes', 'Avaliações']] as const).map(([k, t]) => (
              <button key={k} onClick={() => setAba(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${aba === k ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-600'}`}>{t}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs">
          {msg && <p className={`rounded-lg p-2 border ${msg.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-red-600 bg-red-50 border-red-100'}`}>{msg.t}</p>}
          {carregando && <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>}

          {aba === 'loja' && !carregando && (
            <>
              <section className="space-y-2">
                <div className="flex items-center justify-between"><p className="font-bold text-zinc-700">Status agora</p>
                  <button onClick={carregarLoja} className="text-zinc-500 hover:text-zinc-800"><i className="ri-refresh-line" /> Atualizar</button></div>
                {(status ?? []).map((s, k) => (
                  <div key={k} className="rounded-lg border border-zinc-200 p-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded-full font-bold ${TOM_ESTADO[s.state ?? ''] ?? 'bg-zinc-100'}`}>{ESTADO[s.state ?? ''] ?? s.state}</span>
                      <span className="font-semibold text-zinc-700">{s.message?.title}</span>
                      <span className="text-zinc-400">{s.operation === 'DELIVERY' ? 'Delivery' : s.operation}</span>
                    </div>
                    {s.message?.subtitle && <p className="text-zinc-500">{s.message.subtitle}</p>}
                    {(s.validations ?? []).filter((v) => v.state && v.state !== 'OK').map((v, j) => (
                      <p key={j} className="text-amber-700">• {v.message?.title ?? v.code}{v.message?.description ? ` — ${v.message.description}` : ''}</p>
                    ))}
                  </div>
                ))}
                {status && status.length === 0 && <p className="text-zinc-400">O iFood não devolveu status.</p>}
              </section>

              <section className="space-y-2">
                <p className="font-bold text-zinc-700">Pausas (a loja não recebe pedidos)</p>
                {pausas.length === 0 && <p className="text-zinc-400">Nenhuma pausa ativa.</p>}
                {pausas.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2">
                    <span className="flex-1 text-amber-900">{p.description || 'Pausa'} · {dataHora(p.start)} até {dataHora(p.end)}</span>
                    {podeEditar && <button disabled={!!busy} onClick={() => tirarPausa(p.id)} className="px-2 py-1 rounded bg-white border border-amber-300 text-amber-800 font-bold disabled:opacity-50">{busy === 'del' + p.id ? '…' : 'Tirar pausa'}</button>}
                  </div>
                ))}
                {podeEditar && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select value={pausaMin} onChange={(e) => setPausaMin(Number(e.target.value))} className={inp}>
                      {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
                    </select>
                    <input value={pausaMotivo} onChange={(e) => setPausaMotivo(e.target.value)} maxLength={255} placeholder="Motivo (ex.: cozinha cheia)" className={inp + ' flex-1 min-w-[160px]'} />
                    <button disabled={!!busy} onClick={pausar} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white font-bold disabled:opacity-50">{busy === 'pausa' ? 'Pausando…' : 'Pausar loja'}</button>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <p className="font-bold text-zinc-700">Horário de funcionamento no iFood</p>
                {DIAS.map(([d, nome]) => {
                  const doDia = turnos.map((t, i) => ({ t, i })).filter((x) => x.t.dayOfWeek === d);
                  return (
                    <div key={d} className="flex flex-wrap items-center gap-1.5">
                      <span className="w-16 font-semibold text-zinc-600">{nome}</span>
                      {doDia.length === 0 && <span className="text-zinc-400">fechado</span>}
                      {doDia.map(({ t, i }) => podeEditar ? (
                        <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-zinc-50 border border-zinc-200 px-1.5 py-0.5">
                          <input type="time" value={t.start} onChange={(e) => setTurno(i, { start: e.target.value })} className="bg-transparent text-xs w-[72px]" />
                          até
                          <input type="time" value={fim(t.start, t.duration)} onChange={(e) => {
                            const a = Number(t.start.slice(0, 2)) * 60 + Number(t.start.slice(3, 5));
                            let b = Number(e.target.value.slice(0, 2)) * 60 + Number(e.target.value.slice(3, 5));
                            if (b <= a) b += 24 * 60; // passa da meia-noite
                            setTurno(i, { duration: b - a });
                          }} className="bg-transparent text-xs w-[72px]" />
                          <button onClick={() => { setTurnos((ts) => ts.filter((_, k) => k !== i)); setTurnosSujo(true); }} className="text-zinc-400 hover:text-red-600"><i className="ri-close-line" /></button>
                        </span>
                      ) : <span key={i} className="text-zinc-700">{t.start}–{fim(t.start, t.duration)}</span>)}
                      {podeEditar && <button onClick={() => { setTurnos((ts) => [...ts, { dayOfWeek: d, start: '18:00', duration: 300 }]); setTurnosSujo(true); }} className="text-red-600 font-bold">+ turno</button>}
                    </div>
                  );
                })}
                {podeEditar && turnosSujo && (
                  <div className="flex gap-2">
                    <button disabled={!!busy} onClick={salvarHorarios} className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold disabled:opacity-50">{busy === 'horas' ? 'Salvando…' : 'Salvar horários no iFood'}</button>
                    <button onClick={carregarLoja} className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 font-semibold">Desfazer</button>
                  </div>
                )}
              </section>
            </>
          )}

          {aba === 'avaliacoes' && !carregando && (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-2">
                {resumo && <span className="text-sm font-black text-zinc-800">★ {Number(resumo.score ?? 0).toFixed(1).replace('.', ',')}</span>}
                {resumo && <span className="text-zinc-500">{resumo.validReviewsCount ?? 0} avaliações válidas de {resumo.totalReviewsCount ?? 0}</span>}
                <span className="flex-1" />
                <a href={POLITICA_AVALIACOES} target="_blank" rel="noopener noreferrer" className="text-red-600 font-bold underline">Política de Avaliações do iFood</a>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-zinc-500">De</span><input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={inp} />
                <span className="text-zinc-500">até</span><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={inp} />
                <button onClick={() => carregarAvaliacoes(1)} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-white font-bold">Filtrar</button>
              </div>
              {reviews.length === 0 && <p className="text-zinc-400 text-center py-6">Nenhuma avaliação no período.</p>}
              {reviews.map((r) => (
                <div key={r.id} className="rounded-xl border border-zinc-200 p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-amber-500">{'★'.repeat(Math.round(r.score ?? 0))}<span className="text-zinc-200">{'★'.repeat(5 - Math.round(r.score ?? 0))}</span></span>
                    <span className="font-semibold text-zinc-700">{r.customerName ?? 'Cliente'}</span>
                    {r.order?.shortId && <span className="text-zinc-400">pedido #{r.order.shortId}</span>}
                    <span className="flex-1" />
                    <span className="text-zinc-400">{dataHora(r.createdAt)}</span>
                  </div>
                  {r.comment ? <p className="text-zinc-700">{r.comment}</p> : <p className="text-zinc-400">Sem comentário.</p>}
                  {(r.replies ?? []).map((rp, k) => (
                    <p key={k} className={`pl-3 border-l-2 ${rp.from === 'MERCHANT' ? 'border-red-300 text-zinc-600' : 'border-zinc-300 text-zinc-500'}`}>
                      <b>{rp.from === 'MERCHANT' ? 'Loja' : 'Cliente'}:</b> {rp.text}
                    </p>
                  ))}
                  {podeEditar && r.status === 'NOT_REPLIED' && (respondendo === r.id ? (
                    <div className="space-y-1">
                      <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} maxLength={300} rows={3} className="w-full px-2 py-1.5 rounded-lg border border-zinc-200 text-xs" placeholder="Resposta pública (10 a 300 caracteres)" />
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] ${resposta.trim().length < 10 ? 'text-red-500' : 'text-zinc-400'}`}>{resposta.trim().length}/300</span>
                        <span className="flex-1" />
                        <button onClick={() => { setRespondendo(null); setResposta(''); }} className="px-2.5 py-1 rounded-lg bg-zinc-100 text-zinc-600">Cancelar</button>
                        <button disabled={!!busy || resposta.trim().length < 10} onClick={() => responder(r.id)} className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-bold disabled:opacity-50">{busy === 'resp' + r.id ? 'Enviando…' : 'Publicar resposta'}</button>
                      </div>
                    </div>
                  ) : <button onClick={() => { setRespondendo(r.id); setResposta(''); }} className="text-red-600 font-bold">Responder</button>)}
                </div>
              ))}
              {totalPag > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button disabled={pagina <= 1} onClick={() => carregarAvaliacoes(pagina - 1)} className="px-2 py-1 rounded bg-zinc-100 disabled:opacity-40">Anterior</button>
                  <span className="text-zinc-500">{pagina} de {totalPag}</span>
                  <button disabled={pagina >= totalPag} onClick={() => carregarAvaliacoes(pagina + 1)} className="px-2 py-1 rounded bg-zinc-100 disabled:opacity-40">Próxima</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
