import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ifoodShipping, type IfoodShippingConfig } from '@/lib/ifoodShipping';
import { invokeWithAuth } from '@/lib/supabase';
import { Cartao, Colunas, Folha, Manchete, btn, Etiqueta, Nota, SecaoTitulo, Vazio } from '@/pages/config-delivery/ui';
import { chamarDelivery, lerConfig } from '@/pages/config-delivery/config';
import { janelasDoDia, type HorarioDelivery } from '@/pages/config-delivery/abas/horario/horarioUtil';
import { nomeLoja, type AbaProps } from '../lib/tipos';

// Loja no iFood (protótipo docs/prototipos/ifood-proposta.html › Loja): aberta ou pausada, horário e avaliações.
// Leva tudo o que a janela "Loja no iFood" do Gestor de Entregas faz (IfoodLojaModal), sem a aba Indicadores
// (os números ficam em Resultados). Em produção o iFood ainda devolve "sem permissão" para os módulos Loja e
// Avaliações (chamado 34064791): qualquer falha vira o aviso âmbar, nunca tela de erro.

// Política de avaliações do iFood (link obrigatório na tela — critério de homologação do Review).
const POLITICA_AVALIACOES = 'https://blog-parceiros.ifood.com.br/avaliacoes-e-moderacoes/';
const AVISO_ESPERANDO = 'Esperando o iFood liberar. A situação da loja, pausas, horário e avaliações aparecem aqui assim que o iFood liberar.';
const TZ = 'America/Sao_Paulo';
const DIAS: [string, string, string][] = [
  ['MONDAY', 'Segunda', 'Seg'], ['TUESDAY', 'Terça', 'Ter'], ['WEDNESDAY', 'Quarta', 'Qua'], ['THURSDAY', 'Quinta', 'Qui'],
  ['FRIDAY', 'Sexta', 'Sex'], ['SATURDAY', 'Sábado', 'Sáb'], ['SUNDAY', 'Domingo', 'Dom'],
];
const DOW: Record<string, number> = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
const DURACOES = [15, 30, 45, 60, 90, 120, 180, 240];
const MOTIVOS = ['Cozinha cheia', 'Falta de entregador', 'Sem insumo', 'Problema no equipamento'];
const MAX_SUGESTOES = 3;

interface Turno { dayOfWeek: string; start: string; duration: number }
interface Pausa { id: string; description?: string; start: string; end: string }
interface StatusOp { operation?: string; state?: string; message?: { title?: string; subtitle?: string; description?: string }; validations?: { code?: string; state?: string; message?: { title?: string; description?: string } }[] }
interface Review { id: string; status?: string; score?: number; comment?: string; customerName?: string; createdAt?: string; replies?: { text: string; from: string; createdAt?: string }[]; order?: { shortId?: string } }
interface Resumo { totalReviewsCount?: number; validReviewsCount?: number; score?: number | null }
type Rev = Review & { lojaId: string; lojaNome: string };

interface DadosLoja {
  id: string;
  nome: string;
  /** O iFood respondeu ao módulo Loja (status, pausas ou horário). */
  lojaOk: boolean;
  status: StatusOp[];
  pausas: Pausa[];
  turnos: Turno[];
  /** O iFood respondeu ao módulo Avaliações. */
  avalOk: boolean;
  resumo: Resumo | null;
  reviews: Review[];
  pagina: number;
  totalPag: number;
}

interface Rascunho { texto: string; estado: 'gerando' | 'pronto' | 'editando' | 'enviando'; erro?: string }

const hhmm = (s: string) => s.slice(0, 5);
const minutos = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const fimDoTurno = (start: string, dur: number) => {
  const m = minutos(start) + dur;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
// O iFood devolve início/fim da pausa em UTC SEM o "Z" (teste 2026-09-26): sem fuso o navegador leria como hora local.
const utc = (iso: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
const horaBR = (iso?: string) => (iso ? new Date(utc(iso)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '');
const dataHoraBR = (iso?: string) => (iso ? new Date(utc(iso)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '');
const diaBR = (iso?: string) => (iso ? new Date(utc(iso)).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ }).replace('.', '') : '');
const primeiroNome = (n?: string) => (n ?? '').trim().split(/\s+/)[0] || 'Cliente';
/** "El Patrón - Burritos e Nachos" → "Burritos e Nachos". */
const nomeCurto = (n: string) => { const i = n.indexOf(' - '); return i >= 0 ? n.slice(i + 3).trim() || n : n; };
const semResposta = (r: Review) => (r.status ? r.status === 'NOT_REPLIED' : !(r.replies ?? []).some((x) => x.from === 'MERCHANT'));
const nota = (v: number) => v.toFixed(1).replace('.', ',');
/** Fim da pausa: só a hora se termina no mesmo dia do início, senão dia + hora. */
const dataHoraFim = (p: Pausa) => (diaBR(p.start) === diaBR(p.end) ? horaBR(p.end) : dataHoraBR(p.end));

/** Pausa valendo agora (já começou e não acabou). */
function pausaAtiva(d: DadosLoja): Pausa | null {
  const agora = Date.now();
  return d.pausas.find((p) => new Date(utc(p.start)).getTime() <= agora && new Date(utc(p.end)).getTime() > agora) ?? null;
}
/** Pausas marcadas para depois (ainda não começaram), da mais próxima para a mais longe. */
function pausasMarcadas(d: DadosLoja): Pausa[] {
  const agora = Date.now();
  return d.pausas.filter((p) => new Date(utc(p.start)).getTime() > agora)
    .sort((a, b) => new Date(utc(a.start)).getTime() - new Date(utc(b.start)).getTime());
}
/** "2026-10-10" + "14:00" no horário de Brasília (sem horário de verão desde 2019) → ISO. */
const isoBR = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`).toISOString();
const hojeBR = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

type Tom = 'ok' | 'pausa' | 'fechada' | 'alerta' | 'sem';
function situacao(d: DadosLoja): { tom: Tom; rotulo: string; detalhe: string } {
  if (!d.lojaOk) return { tom: 'sem', rotulo: 'situação indisponível', detalhe: 'O iFood ainda não liberou essa informação.' };
  const p = pausaAtiva(d);
  if (p) return { tom: 'pausa', rotulo: 'em pausa', detalhe: `até ${dataHoraFim(p)}${p.description ? ` · "${p.description}"` : ''}` };
  const st = d.status.find((s) => s.operation === 'DELIVERY') ?? d.status[0];
  if (!st) return { tom: 'sem', rotulo: 'situação indisponível', detalhe: 'O iFood não informou a situação agora.' };
  const avisos = (st.validations ?? []).filter((v) => v.state && v.state !== 'OK').map((v) => v.message?.title ?? v.code ?? '').filter(Boolean);
  const detalhe = [st.message?.title, st.message?.subtitle, ...avisos].filter(Boolean).join(' · ');
  if (st.state === 'OK') return { tom: 'ok', rotulo: 'aberta', detalhe: detalhe || 'recebendo pedidos' };
  if (st.state === 'WARNING') return { tom: 'alerta', rotulo: 'aberta com alerta', detalhe };
  if (st.state === 'CLOSED') return { tom: 'fechada', rotulo: 'fechada', detalhe };
  return { tom: 'alerta', rotulo: 'com problema', detalhe };
}

const COR_BOLA: Record<Tom, string> = { ok: 'bg-emerald-500', pausa: 'bg-red-500', fechada: 'bg-zinc-400', alerta: 'bg-amber-500', sem: 'bg-zinc-300' };

/** Horário do iFood em linhas curtas: dias seguidos iguais viram "Seg a qui 11:00–14:30 · 18:00–23:30". */
function resumoHorario(turnos: Turno[]): string {
  const texto = DIAS.map(([d]) => {
    const t = turnos.filter((x) => x.dayOfWeek === d).sort((a, b) => minutos(a.start) - minutos(b.start));
    return t.length ? t.map((x) => `${hhmm(x.start)}–${fimDoTurno(x.start, x.duration)}`).join(' · ') : 'fechado';
  });
  const grupos: { de: number; ate: number; t: string }[] = [];
  texto.forEach((t, i) => {
    const g = grupos[grupos.length - 1];
    if (g && g.t === t) g.ate = i; else grupos.push({ de: i, ate: i, t });
  });
  return grupos.map((g) => `${g.de === g.ate ? DIAS[g.de][2] : `${DIAS[g.de][2]} a ${DIAS[g.ate][2].toLowerCase()}`} ${g.t}`).join(' · ');
}

type Jan = [number, number];
function juntar(js: Jan[]): Jan[] {
  const o = [...js].sort((a, b) => a[0] - b[0]);
  const out: Jan[] = [];
  for (const j of o) {
    const u = out[out.length - 1];
    if (u && j[0] <= u[1]) u[1] = Math.max(u[1], j[1]); else out.push([j[0], j[1]]);
  }
  return out;
}
const chaveJanelas = (js: Jan[]) => js.map((j) => `${j[0]}-${j[1]}`).join('|');

/** O horário do iFood bate com o do delivery próprio (dia a dia)? Só faz sentido com o horário do delivery ligado. */
function horariosDiferem(turnos: Turno[], h: HorarioDelivery | null): boolean {
  if (!h || h.enabled !== true || turnos.length === 0) return false;
  for (let dow = 0; dow < 7; dow++) {
    const ifood = juntar(turnos.filter((t) => DOW[t.dayOfWeek] === dow).map((t): Jan => [minutos(t.start), minutos(t.start) + t.duration]));
    const proprio = juntar(janelasDoDia(h.days?.[String(dow)]).map((j): Jan => [j.o, j.c <= j.o ? j.c + 1440 : j.c]));
    if (chaveJanelas(ifood) !== chaveJanelas(proprio)) return true;
  }
  return false;
}

async function buscarAvaliacoes(tenantId: string, merchantId: string, pagina: number, de: string, ate: string) {
  const lista = await ifoodShipping<{ reviews?: Review[]; pageCount?: number }>('reviews_list', tenantId, { merchant_id: merchantId, page: pagina, date_from: de || undefined, date_to: ate || undefined });
  return lista.success ? { reviews: lista.reviews ?? [], totalPag: Math.max(1, lista.pageCount ?? 1) } : null;
}

async function carregarUma(tenantId: string, id: string, nome: string): Promise<DadosLoja> {
  const [ov, lista, sum] = await Promise.all([
    ifoodShipping<{ status: StatusOp[] | null; interruptions: Pausa[] | null; opening_hours: { shifts?: Turno[] } | null }>('merchant_overview', tenantId, { merchant_id: id }),
    buscarAvaliacoes(tenantId, id, 1, '', ''),
    ifoodShipping<{ summary: Resumo | null }>('reviews_summary', tenantId, { merchant_id: id }),
  ]);
  const lojaOk = ov.success && (ov.status != null || ov.opening_hours != null || ov.interruptions != null);
  return {
    id, nome, lojaOk,
    status: lojaOk ? ov.status ?? [] : [],
    pausas: lojaOk ? ov.interruptions ?? [] : [],
    turnos: lojaOk ? (ov.opening_hours?.shifts ?? []).map((t) => ({ dayOfWeek: t.dayOfWeek, start: hhmm(t.start), duration: t.duration })) : [],
    avalOk: !!lista,
    resumo: sum.success ? sum.summary ?? null : null,
    reviews: lista?.reviews ?? [],
    pagina: 1,
    totalPag: lista?.totalPag ?? 1,
  };
}

const inp = 'h-9 px-2.5 rounded-xl border border-zinc-200 focus:border-amber-400 outline-none text-[13px] bg-white';

export default function LojaAba({ tenantId, loja, lojas, acesso }: AbaProps) {
  const [carregando, setCarregando] = useState(true);
  const [erroGeral, setErroGeral] = useState('');
  const [semLoja, setSemLoja] = useState(false);
  const [podeEditar, setPodeEditar] = useState(false);
  const [dados, setDados] = useState<DadosLoja[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [delivery, setDelivery] = useState<HorarioDelivery | null>(null);
  const [rasc, setRasc] = useState<Record<string, Rascunho>>({});
  const tentadas = useRef(new Set<string>());

  const [pausando, setPausando] = useState<string | null>(null);
  const [pausaMin, setPausaMin] = useState(30);
  const [pausaMotivo, setPausaMotivo] = useState('');
  // Pausa marcada (2026-10-06): dia + início + fim no horário de Brasília; fim menor que o início = termina no dia seguinte.
  const [pausaQuando, setPausaQuando] = useState<'agora' | 'marcar'>('agora');
  const [pausaDia, setPausaDia] = useState('');
  const [pausaIni, setPausaIni] = useState('');
  const [pausaFim, setPausaFim] = useState('');
  const [editHor, setEditHor] = useState<{ id: string; turnos: Turno[] } | null>(null);

  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [filtro, setFiltro] = useState(false);
  const [maisBusy, setMaisBusy] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErroGeral(''); setMsg(null);
    const c = await ifoodShipping<{ config: IfoodShippingConfig | null; can_edit?: boolean }>('get_config', tenantId);
    if (!c.success) { setErroGeral(c.error || 'Não deu para ver as lojas agora.'); setCarregando(false); return; }
    setPodeEditar(c.can_edit ?? acesso.configurar);
    const ms = (c.config?.merchants ?? []).filter((m) => !m.outra_loja);
    setSemLoja(ms.length === 0);
    tentadas.current = new Set();
    setRasc({});
    const lista = await Promise.all(ms.map((m) => carregarUma(tenantId, m.id, lojas.find((l) => l.id === m.id)?.nome ?? m.name)));
    setDados(lista);
    setCarregando(false);
  }, [tenantId, acesso.configurar, lojas]);

  useEffect(() => { carregar(); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Horário do delivery próprio, só para avisar quando é diferente do iFood (sem permissão ou sem nada = sem aviso).
  useEffect(() => {
    let vivo = true;
    chamarDelivery<{ city: string; delivery_config: unknown }>('get_delivery_settings', { tenant_id: tenantId })
      .then((d) => { if (vivo) setDelivery(lerConfig(d.delivery_config, d.city).horario); })
      .catch(() => { if (vivo) setDelivery(null); });
    return () => { vivo = false; };
  }, [tenantId]);

  const visiveis = useMemo(() => {
    const f = loja ? dados.filter((d) => d.id === loja) : dados;
    return f.length ? f : dados;
  }, [dados, loja]);

  const mudar = (id: string, fn: (d: DadosLoja) => DadosLoja) => setDados((ds) => ds.map((d) => (d.id === id ? fn(d) : d)));

  // ── Pausas e horário ──
  const pausar = async () => {
    if (!pausando) return;
    const id = pausando;
    const marcar = pausaQuando === 'marcar';
    let periodo: { start: string; end: string } | null = null;
    if (marcar) {
      if (!pausaDia || !pausaIni || !pausaFim) { setMsg({ ok: false, t: 'Escolha o dia, o início e o fim da pausa.' }); return; }
      const start = isoBR(pausaDia, pausaIni);
      const fimDia = pausaFim > pausaIni ? pausaDia : new Date(new Date(`${pausaDia}T12:00:00-03:00`).getTime() + 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ });
      const end = isoBR(fimDia, pausaFim);
      if (new Date(start).getTime() <= Date.now()) { setMsg({ ok: false, t: 'Esse horário já passou. Para pausar agora, escolha "Agora".' }); return; }
      periodo = { start, end };
    }
    setBusy('pausa'); setMsg(null);
    const r = await ifoodShipping<{ interruption?: Pausa }>('merchant_pause_create', tenantId,
      { merchant_id: id, description: pausaMotivo.trim(), ...(periodo ?? { minutes: pausaMin }) });
    setBusy('');
    if (!r.success) { setMsg({ ok: false, t: r.error ?? 'Não deu para pausar.' }); return; }
    // O GET de pausas do iFood demora a refletir: usa o que o próprio iFood devolveu, sem recarregar.
    const nova = r.interruption;
    if (nova?.id) mudar(id, (d) => ({ ...d, pausas: [...d.pausas.filter((x) => x.id !== nova.id), nova] }));
    setMsg({ ok: true, t: periodo
      ? `Pausa marcada no iFood: ${diaBR(periodo.start)}, ${horaBR(periodo.start)} até ${diaBR(periodo.start) === diaBR(periodo.end) ? horaBR(periodo.end) : dataHoraBR(periodo.end)}.`
      : `Loja pausada por ${pausaMin < 60 ? `${pausaMin} min` : `${pausaMin / 60} h`} no iFood.` });
    setPausando(null); setPausaMotivo('');
  };

  const tirarPausa = async (d: DadosLoja, pausa: Pausa | null = pausaAtiva(d)) => {
    if (!pausa) return;
    const marcada = new Date(utc(pausa.start)).getTime() > Date.now();
    setBusy('del' + pausa.id); setMsg(null);
    const r = await ifoodShipping('merchant_pause_delete', tenantId, { merchant_id: d.id, interruption_id: pausa.id });
    setBusy('');
    if (!r.success) { setMsg({ ok: false, t: r.error ?? 'Não deu para tirar a pausa.' }); return; }
    mudar(d.id, (x) => ({ ...x, pausas: x.pausas.filter((p) => p.id !== pausa.id) }));
    setMsg({ ok: true, t: marcada ? 'Pausa marcada cancelada.' : 'Pausa removida. A loja volta a receber pedidos.' });
  };

  const abrirPausa = (id: string) => {
    setPausando(id); setPausaMin(30); setPausaMotivo(''); setPausaQuando('agora');
    setPausaDia(hojeBR()); setPausaIni(''); setPausaFim('');
  };

  const salvarHorario = async () => {
    if (!editHor) return;
    const { id, turnos } = editHor;
    setBusy('horas'); setMsg(null);
    const r = await ifoodShipping<{ opening_hours?: { shifts?: Turno[] } }>('merchant_hours_save', tenantId, { merchant_id: id, shifts: turnos });
    setBusy('');
    if (!r.success) { setMsg({ ok: false, t: r.error ?? 'Não deu para salvar o horário.' }); return; }
    // O GET do horário leva ~1 min para refletir o PUT: usa os turnos que o próprio PUT devolve.
    const salvos = (r.opening_hours?.shifts?.length ? r.opening_hours.shifts : turnos).map((t) => ({ dayOfWeek: t.dayOfWeek, start: hhmm(t.start), duration: t.duration }));
    mudar(id, (d) => ({ ...d, turnos: salvos }));
    setMsg({ ok: true, t: 'Horário salvo no iFood.' });
    setEditHor(null);
  };

  const setTurno = (i: number, patch: Partial<Turno>) =>
    setEditHor((e) => (e ? { ...e, turnos: e.turnos.map((t, k) => (k === i ? { ...t, ...patch } : t)) } : e));

  // ── Avaliações ──
  const reviews: Rev[] = useMemo(() => {
    const todas = visiveis.flatMap((d) => d.reviews.map((r) => ({ ...r, lojaId: d.id, lojaNome: d.nome })));
    const t = (r: Review) => (r.createdAt ? new Date(utc(r.createdAt)).getTime() : 0);
    return todas.sort((a, b) => {
      const sa = semResposta(a) ? 0 : 1, sb = semResposta(b) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (sa === 0) {
        const ba = (a.score ?? 5) <= 2 ? 0 : 1, bb = (b.score ?? 5) <= 2 ? 0 : 1;
        if (ba !== bb) return ba - bb;
      }
      return t(b) - t(a);
    });
  }, [visiveis]);

  const sugerir = useCallback(async (r: Rev) => {
    tentadas.current.add(r.id);
    // A mesma avaliação não gasta IA de novo na mesma sessão do navegador.
    const guardada = (() => { try { return sessionStorage.getItem(`ifood-sugestao-${r.id}`); } catch { return null; } })();
    if (guardada) { setRasc((s) => ({ ...s, [r.id]: { texto: guardada, estado: 'pronto' } })); return; }
    setRasc((s) => ({ ...s, [r.id]: { texto: '', estado: 'gerando' } }));
    const res = await invokeWithAuth<{ success?: boolean; resposta?: string; error?: string }>('ifood-ia', {
      body: { action: 'sugerir_resposta', tenant_id: tenantId, nota: r.score ?? null, comentario: r.comment ?? '', cliente: primeiroNome(r.customerName), loja: nomeCurto(r.lojaNome) },
    });
    const texto = res.data?.success ? (res.data.resposta ?? '').trim() : '';
    if (texto) {
      try { sessionStorage.setItem(`ifood-sugestao-${r.id}`, texto.slice(0, 300)); } catch { /* sem armazenamento: só não guarda */ }
      setRasc((s) => ({ ...s, [r.id]: { texto: texto.slice(0, 300), estado: 'pronto' } }));
    }
    else setRasc((s) => ({ ...s, [r.id]: { texto: '', estado: 'editando', erro: 'Não deu para sugerir agora. Escreva a resposta ou tente de novo.' } }));
  }, [tenantId]);

  // Avaliação de 2★ ou menos sem resposta: já pede a sugestão ao abrir (no máximo 3 de uma vez).
  useEffect(() => {
    if (!podeEditar) return;
    const gerando = Object.values(rasc).filter((x) => x.estado === 'gerando').length;
    let vagas = MAX_SUGESTOES - gerando;
    if (vagas <= 0) return;
    for (const r of reviews) {
      if (vagas <= 0) break;
      if ((r.score ?? 5) > 2 || !semResposta(r) || tentadas.current.has(r.id)) continue;
      vagas--;
      void sugerir(r);
    }
  }, [reviews, rasc, podeEditar, sugerir]);

  const enviar = async (r: Rev) => {
    const texto = (rasc[r.id]?.texto ?? '').trim();
    if (texto.length < 10) return;
    setRasc((s) => ({ ...s, [r.id]: { ...s[r.id], estado: 'enviando', erro: undefined } }));
    const res = await ifoodShipping('review_answer', tenantId, { merchant_id: r.lojaId, review_id: r.id, text: texto });
    if (!res.success) {
      setRasc((s) => ({ ...s, [r.id]: { texto, estado: 'editando', erro: res.error ?? 'Não deu para enviar.' } }));
      return;
    }
    mudar(r.lojaId, (d) => ({ ...d, reviews: d.reviews.map((x) => (x.id === r.id ? { ...x, status: 'REPLIED', replies: [...(x.replies ?? []), { text: texto, from: 'MERCHANT' }] } : x)) }));
    setRasc((s) => { const n = { ...s }; delete n[r.id]; return n; });
    setMsg({ ok: true, t: 'Resposta publicada no iFood.' });
  };

  const filtrar = async () => {
    setMaisBusy(true);
    const novos = await Promise.all(dados.map(async (d) => {
      const r = d.avalOk ? await buscarAvaliacoes(tenantId, d.id, 1, de, ate) : null;
      return r ? { ...d, reviews: r.reviews, pagina: 1, totalPag: r.totalPag } : d;
    }));
    setDados(novos);
    setMaisBusy(false);
  };

  const verMais = async () => {
    setMaisBusy(true);
    const novos = await Promise.all(dados.map(async (d) => {
      if (!d.avalOk || d.pagina >= d.totalPag) return d;
      const r = await buscarAvaliacoes(tenantId, d.id, d.pagina + 1, de, ate);
      return r ? { ...d, reviews: [...d.reviews, ...r.reviews.filter((x) => !d.reviews.some((y) => y.id === x.id))], pagina: d.pagina + 1, totalPag: r.totalPag } : d;
    }));
    setDados(novos);
    setMaisBusy(false);
  };

  // ── Frases do topo ──
  const algumaBloqueada = dados.some((d) => !d.lojaOk || !d.avalOk);
  const comSituacao = visiveis.filter((d) => d.lojaOk);
  const manchete = comSituacao.length
    ? comSituacao.map((d) => `${nomeCurto(d.nome)} ${situacao(d).rotulo}`).join(' · ')
    : 'Loja no iFood';
  const comNota = visiveis.filter((d) => d.resumo?.score != null);
  const totalVal = comNota.reduce((s, d) => s + (d.resumo?.validReviewsCount ?? d.resumo?.totalReviewsCount ?? 0), 0);
  const notaMedia = comNota.length
    ? (totalVal > 0 ? comNota.reduce((s, d) => s + Number(d.resumo!.score) * (d.resumo?.validReviewsCount ?? d.resumo?.totalReviewsCount ?? 0), 0) / totalVal : Number(comNota[0].resumo!.score))
    : null;
  const esperando = reviews.filter(semResposta).length;
  const subtitulo = notaMedia != null
    ? `Nota ${nota(notaMedia)} nas últimas ${totalVal} avaliações.${esperando ? ` ${esperando} esperando resposta.` : ' Todas respondidas.'}`
    : esperando ? `${esperando} avaliações esperando resposta.` : undefined;

  if (carregando) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (erroGeral) {
    return (
      <div className="space-y-4">
        <Manchete titulo="Loja no iFood" />
        <Aviso>{AVISO_ESPERANDO}</Aviso>
        <button className={btn('out', 'sm')} onClick={carregar}><i className="ri-refresh-line" /> Tentar de novo</button>
      </div>
    );
  }

  if (semLoja) {
    return (
      <div className="space-y-4">
        <Manchete titulo="Loja no iFood">Aberta ou fechada, pausas, horário e avaliações.</Manchete>
        <Vazio icone="ri-store-3-line" titulo="Nenhuma loja do iFood conectada aos pedidos">
          Conecte a loja em Conectar e ligar (ou peça a um gerente). Depois disso a situação da loja e as avaliações aparecem aqui.
        </Vazio>
      </div>
    );
  }

  const lojaDaFolhaPausa = dados.find((d) => d.id === pausando);
  const lojaDaFolhaHorario = dados.find((d) => d.id === editHor?.id);

  return (
    <div className="space-y-4">
      <Manchete titulo={manchete}>{subtitulo}</Manchete>

      {algumaBloqueada && <Aviso>{AVISO_ESPERANDO}</Aviso>}
      {msg && (
        <p className={`text-[12.5px] font-semibold rounded-xl border px-3 py-2 ${msg.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-red-600 bg-red-50 border-red-100'}`}>{msg.t}</p>
      )}

      <Colunas>
        {/* Lojas e horário */}
        <div className="min-w-0 space-y-3">
          {visiveis.map((d) => {
            const s = situacao(d);
            const ativa = pausaAtiva(d);
            const marcadas = d.lojaOk ? pausasMarcadas(d) : [];
            return (
              <div key={d.id} className="space-y-2">
                <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${COR_BOLA[s.tom]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-extrabold text-zinc-900 truncate">{nomeCurto(d.nome)} · {s.rotulo}</p>
                    {s.detalhe && <p className="text-xs text-zinc-500 leading-snug mt-0.5">{s.detalhe}</p>}
                  </div>
                  {podeEditar && d.lojaOk && (ativa
                    ? <button disabled={!!busy} onClick={() => tirarPausa(d)} className={btn('p', 'sm')}>{busy === 'del' + ativa.id ? '…' : 'Tirar pausa'}</button>
                    : <button disabled={!!busy} onClick={() => abrirPausa(d.id)} className={btn('out', 'sm')}>Pausar</button>)}
                </div>

                {marcadas.length > 0 && (
                  <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-3 space-y-2">
                    <p className="text-xs font-bold text-zinc-500">Pausas marcadas{visiveis.length > 1 ? ` · ${nomeCurto(d.nome)}` : ''}</p>
                    {marcadas.map((p) => (
                      <div key={p.id} className="flex items-center gap-3">
                        <i className="ri-calendar-schedule-line text-base text-zinc-400" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-zinc-800">{diaBR(p.start)}, {horaBR(p.start)} até {dataHoraFim(p)}</p>
                          {p.description && <p className="text-xs text-zinc-500 truncate">{p.description}</p>}
                        </div>
                        {podeEditar && <button disabled={!!busy} onClick={() => tirarPausa(d, p)} className={btn('ghost', 'sm')}>{busy === 'del' + p.id ? '…' : 'Cancelar'}</button>}
                      </div>
                    ))}
                  </div>
                )}

                {d.lojaOk && (
                  <Cartao>
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center flex-shrink-0"><i className="ri-time-line text-base" /></span>
                      <p className="text-sm font-extrabold text-zinc-900 flex-1">Horário no iFood{visiveis.length > 1 ? ` · ${nomeCurto(d.nome)}` : ''}</p>
                      {podeEditar && <button className={btn('ghost', 'sm')} onClick={() => setEditHor({ id: d.id, turnos: d.turnos.map((t) => ({ ...t })) })}>Mudar</button>}
                    </div>
                    <p className="text-[12.5px] text-zinc-600 leading-relaxed mt-2">{d.turnos.length ? resumoHorario(d.turnos) : 'O iFood não informou o horário.'}</p>
                    {horariosDiferem(d.turnos, delivery) && (
                      <p className="mt-2 text-[12px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        O horário do iFood é diferente do delivery próprio.
                      </p>
                    )}
                  </Cartao>
                )}
              </div>
            );
          })}
        </div>

        {/* Avaliações */}
        <div className="min-w-0">
          <SecaoTitulo titulo="Avaliações" n={esperando || undefined} tomN="amber" />
          {reviews.length === 0 ? (
            <Vazio icone="ri-chat-smile-2-line" titulo={visiveis.some((d) => d.avalOk) ? 'Nenhuma avaliação no período' : 'Avaliações ainda não liberadas pelo iFood'}>
              {visiveis.some((d) => d.avalOk) ? 'Quando um cliente avaliar, aparece aqui com uma resposta pronta para você aprovar.' : 'Elas aparecem aqui assim que o iFood liberar.'}
            </Vazio>
          ) : (
            <div className="space-y-2.5">
              {reviews.map((r) => (
                <CartaoAvaliacao key={r.lojaId + r.id} r={r} mostrarLoja={visiveis.length > 1} podeEditar={podeEditar} rasc={rasc[r.id]}
                  onSugerir={() => sugerir(r)}
                  onEscrever={() => setRasc((s) => ({ ...s, [r.id]: { texto: '', estado: 'editando' } }))}
                  onEditar={() => setRasc((s) => ({ ...s, [r.id]: { ...s[r.id], estado: 'editando' } }))}
                  onTexto={(t) => setRasc((s) => ({ ...s, [r.id]: { ...s[r.id], texto: t.slice(0, 300) } }))}
                  onCancelar={() => setRasc((s) => { const n = { ...s }; delete n[r.id]; return n; })}
                  onEnviar={() => enviar(r)} />
              ))}
              {visiveis.some((d) => d.avalOk && d.pagina < d.totalPag) && (
                <div className="flex justify-center">
                  <button disabled={maisBusy} onClick={verMais} className={btn('out', 'sm')}>{maisBusy ? 'Buscando…' : 'Ver avaliações mais antigas'}</button>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 space-y-2">
            <button type="button" onClick={() => setFiltro((v) => !v)} className="text-xs font-bold text-amber-700 hover:underline cursor-pointer">
              {filtro ? 'Esconder filtro por data' : 'Filtrar por data'}
            </button>
            {filtro && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={inp} />
                até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={inp} />
                <button disabled={maisBusy} onClick={filtrar} className={btn('dark', 'sm')}>Filtrar</button>
              </div>
            )}
            <p className="text-xs text-zinc-500">
              Respostas seguem a{' '}
              <a href={POLITICA_AVALIACOES} target="_blank" rel="noopener noreferrer" className="underline font-semibold text-zinc-700">Política de Avaliações do iFood</a>.
            </p>
          </div>
        </div>
      </Colunas>

      <Nota>A situação, as pausas, o horário e as avaliações vêm direto do iFood. {podeEditar ? '' : 'Só admin ou supervisor pausa a loja, muda o horário e responde.'}</Nota>

      {/* Pausar */}
      <Folha aberta={!!pausando} titulo={`Pausar ${lojaDaFolhaPausa ? nomeCurto(lojaDaFolhaPausa.nome) : 'a loja'}`}
        subtitulo="Enquanto estiver em pausa a loja não recebe pedidos no iFood." onFechar={() => setPausando(null)}
        rodape={<>
          <button className={btn('out')} onClick={() => setPausando(null)}>Cancelar</button>
          <button className={btn('p') + ' flex-1'} disabled={!!busy} onClick={pausar}>{busy === 'pausa' ? 'Salvando…' : pausaQuando === 'marcar' ? 'Marcar pausa' : 'Pausar loja'}</button>
        </>}>
        <div className="space-y-3 pb-2">
          <div>
            <p className="text-xs font-bold text-zinc-500 mb-1.5">Quando?</p>
            <div className="flex gap-1.5">
              {([['agora', 'Agora'], ['marcar', 'Marcar dia e hora']] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setPausaQuando(v)}
                  className={`h-9 px-3 rounded-full border text-[13px] font-bold cursor-pointer ${pausaQuando === v ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700'}`}>{l}</button>
              ))}
            </div>
          </div>
          {pausaQuando === 'marcar' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2">
              <span className="block text-xs font-bold text-zinc-500 mb-1.5">Dia</span>
              <input type="date" value={pausaDia} min={hojeBR()} onChange={(e) => setPausaDia(e.target.value)} className={inp + ' w-full'} />
            </label>
            <label>
              <span className="block text-xs font-bold text-zinc-500 mb-1.5">Começa</span>
              <input type="time" value={pausaIni} onChange={(e) => setPausaIni(e.target.value)} className={inp + ' w-full'} />
            </label>
            <label>
              <span className="block text-xs font-bold text-zinc-500 mb-1.5">Termina</span>
              <input type="time" value={pausaFim} onChange={(e) => setPausaFim(e.target.value)} className={inp + ' w-full'} />
            </label>
            {pausaIni && pausaFim && pausaFim <= pausaIni && <p className="col-span-2 text-xs text-zinc-500">Termina no dia seguinte.</p>}
          </div>
          ) : (
          <div>
            <p className="text-xs font-bold text-zinc-500 mb-1.5">Por quanto tempo?</p>
            <div className="flex flex-wrap gap-1.5">
              {DURACOES.map((m) => (
                <button key={m} type="button" onClick={() => setPausaMin(m)}
                  className={`h-9 px-3 rounded-full border text-[13px] font-bold cursor-pointer ${pausaMin === m ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700'}`}>
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </button>
              ))}
            </div>
          </div>
          )}
          <div>
            <p className="text-xs font-bold text-zinc-500 mb-1.5">Motivo</p>
            <input value={pausaMotivo} onChange={(e) => setPausaMotivo(e.target.value)} maxLength={255} placeholder="Ex.: cozinha cheia" className={inp + ' w-full'} />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {MOTIVOS.map((m) => (
                <button key={m} type="button" onClick={() => setPausaMotivo(m)} className="h-8 px-3 rounded-full bg-zinc-100 text-[12px] font-semibold text-zinc-600 hover:bg-zinc-200 cursor-pointer">{m}</button>
              ))}
            </div>
          </div>
        </div>
      </Folha>

      {/* Horário */}
      <Folha aberta={!!editHor} titulo={`Horário no iFood${lojaDaFolhaHorario && visiveis.length > 1 ? ` · ${nomeCurto(lojaDaFolhaHorario.nome)}` : ''}`}
        subtitulo="Cada dia pode ter mais de um turno. Dia sem turno fica fechado." onFechar={() => setEditHor(null)}
        rodape={<>
          <button className={btn('out')} onClick={() => setEditHor(null)}>Cancelar</button>
          <button className={btn('p') + ' flex-1'} disabled={!!busy} onClick={salvarHorario}>{busy === 'horas' ? 'Salvando…' : 'Salvar no iFood'}</button>
        </>}>
        <div className="space-y-2.5 pb-2">
          {editHor && DIAS.map(([d, nome]) => {
            const doDia = editHor.turnos.map((t, i) => ({ t, i })).filter((x) => x.t.dayOfWeek === d);
            return (
              <div key={d} className="flex flex-wrap items-center gap-1.5">
                <span className="w-[68px] text-[13px] font-extrabold text-zinc-800">{nome}</span>
                {doDia.length === 0 && <span className="text-xs text-zinc-400">fechado</span>}
                {doDia.map(({ t, i }) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-xl bg-zinc-50 border border-zinc-200 px-2 py-1 text-xs text-zinc-500">
                    <input type="time" value={t.start} onChange={(e) => e.target.value && setTurno(i, { start: e.target.value })} className="bg-transparent text-[13px] text-zinc-900 w-[78px]" />
                    até
                    <input type="time" value={fimDoTurno(t.start, t.duration)} onChange={(e) => {
                      if (!e.target.value) return;
                      const a = minutos(t.start);
                      let b = minutos(e.target.value);
                      if (b <= a) b += 24 * 60; // passa da meia-noite
                      setTurno(i, { duration: b - a });
                    }} className="bg-transparent text-[13px] text-zinc-900 w-[78px]" />
                    <button type="button" aria-label="Tirar turno" onClick={() => setEditHor((e) => (e ? { ...e, turnos: e.turnos.filter((_, k) => k !== i) } : e))} className="text-zinc-400 hover:text-red-600 cursor-pointer"><i className="ri-close-line" /></button>
                  </span>
                ))}
                <button type="button" onClick={() => setEditHor((e) => (e ? { ...e, turnos: [...e.turnos, { dayOfWeek: d, start: '18:00', duration: 300 }] } : e))}
                  className="text-xs font-bold text-amber-700 hover:underline cursor-pointer">+ turno</button>
              </div>
            );
          })}
        </div>
      </Folha>
    </div>
  );
}

function Aviso({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
      <i className="ri-time-line text-amber-600 text-lg mt-px" />
      <p className="text-[13px] text-amber-900 leading-snug font-semibold">{children}</p>
    </div>
  );
}

function CartaoAvaliacao({ r, mostrarLoja, podeEditar, rasc, onSugerir, onEscrever, onEditar, onTexto, onCancelar, onEnviar }: {
  r: Rev; mostrarLoja: boolean; podeEditar: boolean; rasc?: Rascunho;
  onSugerir: () => void; onEscrever: () => void; onEditar: () => void; onTexto: (t: string) => void; onCancelar: () => void; onEnviar: () => void;
}) {
  const estrelas = Math.max(0, Math.min(5, Math.round(r.score ?? 0)));
  const aberta = semResposta(r);
  const baixa = aberta && estrelas <= 2;
  const tam = (rasc?.texto ?? '').trim().length;
  return (
    <div className={`border rounded-2xl px-4 py-3 space-y-1.5 ${baixa ? 'bg-gradient-to-b from-red-50/80 to-white border-red-200' : 'bg-white border-zinc-200'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-black text-amber-500 tracking-tight">{'★'.repeat(estrelas)}<span className="text-zinc-200">{'★'.repeat(5 - estrelas)}</span></span>
        <b className="text-[13.5px] text-zinc-900">{primeiroNome(r.customerName)}</b>
        {r.order?.shortId && <span className="text-xs text-zinc-400">#{r.order.shortId}</span>}
        {mostrarLoja && <span className="text-xs text-zinc-400">· {nomeCurto(r.lojaNome)}</span>}
        <span className="flex-1" />
        {baixa && <Etiqueta tom="red">nota baixa</Etiqueta>}
        {aberta && !baixa && <Etiqueta tom="amber">sem resposta</Etiqueta>}
        <span className="text-xs text-zinc-400">{diaBR(r.createdAt)}</span>
      </div>
      {r.comment ? <p className="text-[13px] text-zinc-700 leading-snug">&ldquo;{r.comment}&rdquo;</p> : <p className="text-[13px] text-zinc-400">Sem comentário.</p>}
      {(r.replies ?? []).map((rp, k) => (
        <p key={k} className={`pl-3 border-l-2 text-[12.5px] leading-snug ${rp.from === 'MERCHANT' ? 'border-amber-300 text-zinc-600' : 'border-zinc-300 text-zinc-500'}`}>
          <b>{rp.from === 'MERCHANT' ? 'Loja' : 'Cliente'}:</b> {rp.text}
        </p>
      ))}

      {aberta && podeEditar && (
        !rasc ? (
          <div className="flex gap-2 flex-wrap pt-1">
            <button className={btn('p', 'sm')} onClick={onSugerir}><i className="ri-magic-line" /> Sugerir resposta</button>
            <button className={btn('out', 'sm')} onClick={onEscrever}>Responder</button>
          </div>
        ) : rasc.estado === 'gerando' ? (
          <p className="text-xs text-zinc-500 pt-1"><i className="ri-loader-4-line animate-spin" /> Escrevendo uma resposta…</p>
        ) : (
          <div className="space-y-1.5 pt-1">
            {rasc.erro && <p className="text-xs text-red-600">{rasc.erro}</p>}
            {rasc.estado === 'pronto' ? (
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl px-3 py-2">
                <p className="text-[11px] font-extrabold text-amber-700 mb-0.5">Resposta sugerida</p>
                <p className="text-[13px] text-zinc-800 leading-snug">{rasc.texto}</p>
              </div>
            ) : (
              <>
                <textarea value={rasc.texto} onChange={(e) => onTexto(e.target.value)} maxLength={300} rows={4}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 focus:border-amber-400 outline-none text-[13px]" placeholder="Resposta pública (10 a 300 caracteres)" />
                <p className={`text-[11px] ${tam < 10 ? 'text-red-500' : 'text-zinc-400'}`}>{tam}/300</p>
              </>
            )}
            <div className="flex gap-2 flex-wrap">
              <button className={btn('p', 'sm')} disabled={rasc.estado === 'enviando' || tam < 10} onClick={onEnviar}>{rasc.estado === 'enviando' ? 'Enviando…' : 'Enviar'}</button>
              {rasc.estado === 'pronto' && <button className={btn('out', 'sm')} onClick={onEditar}>Editar</button>}
              {rasc.estado === 'pronto' && <button className={btn('ghost', 'sm')} onClick={onSugerir}>Outra sugestão</button>}
              {rasc.estado !== 'enviando' && <button className={btn('ghost', 'sm')} onClick={onCancelar}>Cancelar</button>}
            </div>
          </div>
        )
      )}
    </div>
  );
}
