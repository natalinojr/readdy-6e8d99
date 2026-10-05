// Regras puras dos avisos do iFood (sem banco, testadas em src/test/edge/ifoodAvisos.test.ts).
// deno-lint-ignore-file no-explicit-any

const DIAS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Data/hora de Brasília: { dia 'AAAA-MM-DD', semana 0-6, minutos desde 0h }. */
export function agoraBR(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const dia = `${p.year}-${p.month}-${p.day}`;
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday));
  return { dia, semana, minutos: Number(p.hour) * 60 + Number(p.minute), hhmm: `${p.hour}:${p.minute}` };
}

/** A loja deveria estar aberta agora pelo horário do iFood (opening-hours: shifts com dayOfWeek, start, duration). */
export function dentroDoHorario(openingHours: any, agora: ReturnType<typeof agoraBR>): boolean {
  const shifts: any[] = Array.isArray(openingHours?.shifts) ? openingHours.shifts : Array.isArray(openingHours) ? openingHours : [];
  for (const s of shifts) {
    const [h, m] = String(s?.start ?? '').split(':').map(Number);
    if (!Number.isFinite(h)) continue;
    const ini = h * 60 + (m || 0);
    const dur = Number(s?.duration) || 0;
    const diaTurno = DIAS.indexOf(String(s?.dayOfWeek ?? '').toUpperCase());
    if (diaTurno < 0) continue;
    // Turno do dia (com 10 min de folga no começo) ou turno de ontem que passou da meia-noite.
    if (diaTurno === agora.semana && agora.minutos >= ini + 10 && agora.minutos < ini + dur) return true;
    if ((diaTurno + 1) % 7 === agora.semana && ini + dur > 1440 && agora.minutos < ini + dur - 1440) return true;
  }
  return false;
}

/** Pausa (interrupção) que a própria loja programou e vale agora. */
export function pausaAtiva(interruptions: any, agoraMs = Date.now()): boolean {
  const l: any[] = Array.isArray(interruptions) ? interruptions : [];
  return l.some((i) => {
    const a = Date.parse(i?.start ?? ''), b = Date.parse(i?.end ?? '');
    return Number.isFinite(a) && Number.isFinite(b) && a <= agoraMs && agoraMs < b;
  });
}

/**
 * A loja está fechada no iFood por um motivo que NÃO é o horário nem uma pausa da loja (ex.: sem conexão,
 * fechada pelo iFood). Status = resposta de /merchants/{id}/status (lista de operações).
 */
export function fechouSozinha(status: any, interruptions: any, openingHours: any, agora: ReturnType<typeof agoraBR>, agoraMs = Date.now()): { fechou: boolean; motivo: string | null } {
  const ops: any[] = Array.isArray(status) ? status : status ? [status] : [];
  if (!ops.length || !dentroDoHorario(openingHours, agora) || pausaAtiva(interruptions, agoraMs)) return { fechou: false, motivo: null };
  for (const op of ops) {
    const st = String(op?.state ?? '').toUpperCase();
    if (op?.available !== false && st !== 'CLOSED' && st !== 'ERROR') continue;
    const vals: any[] = Array.isArray(op?.validations) ? op.validations : [];
    const ruins = vals.filter((v) => /CLOSED|ERROR/i.test(String(v?.state ?? '')));
    // Fora do horário e pausa programada não é "sozinha".
    if (ruins.length && ruins.every((v) => /opening-hours|unavailabilit|interruption/i.test(String(v?.id ?? v?.code ?? '')))) continue;
    const msg = op?.message?.subtitle || op?.message?.title || ruins[0]?.message?.title || null;
    return { fechou: true, motivo: msg ? String(msg).slice(0, 120) : null };
  }
  return { fechou: false, motivo: null };
}

/** Avaliações de nota ≤ 2 ainda sem resposta. */
export function avaliacoesRuins(resp: any): Array<{ id: string; nota: number; comentario: string; cliente: string; pedido: string | null }> {
  const lista: any[] = Array.isArray(resp?.reviews) ? resp.reviews : Array.isArray(resp?.data) ? resp.data : [];
  return lista
    .filter((r) => Number(r?.score) > 0 && Number(r?.score) <= 2)
    .filter((r) => !(Array.isArray(r?.replies) && r.replies.length) && !r?.reply && !r?.answer)
    .map((r) => ({
      id: String(r.id),
      nota: Number(r.score),
      comentario: String(r?.comment ?? '').slice(0, 200),
      cliente: String(r?.customerName ?? r?.customer?.name ?? 'Cliente').split(' ')[0],
      pedido: r?.order?.shortId ? String(r.order.shortId) : null,
    }));
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Repasse do iFood conferido com o banco (linhas de fin_ifood_repasses_base). Avisa o repasse de HOJE quando já
 * bateu, e o de ONTEM se não bateu (o banco tem até o dia seguinte para mostrar o crédito).
 */
export function avisoRepasse(rows: any[], hoje: string, ontem: string): { ref: string; ok: boolean; resumo: string } | null {
  const lin = (rows ?? []).map((r) => ({ d: String(r.data_repasse), esperado: Number(r.esperado) || 0, recebido: Number(r.recebido_inter) || 0, semConta: !!r?.detalhe?.sem_conta }));
  const deHoje = lin.find((r) => r.d === hoje);
  if (deHoje && !deHoje.semConta && deHoje.esperado > 0 && Math.abs(deHoje.esperado - deHoje.recebido) < 1) {
    return { ref: deHoje.d, ok: true, resumo: `Caiu ${brl(deHoje.recebido)} do iFood hoje (${dm(deHoje.d)}). Bateu com o que o iFood informou ✓` };
  }
  const deOntem = lin.find((r) => r.d === ontem);
  if (deOntem && !deOntem.semConta && deOntem.esperado > 0 && deOntem.esperado - deOntem.recebido >= 1) {
    if (deOntem.recebido <= 0.005) return { ref: deOntem.d, ok: false, resumo: `O repasse do iFood de ${dm(deOntem.d)} (${brl(deOntem.esperado)}) não apareceu no banco.` };
    return { ref: deOntem.d, ok: false, resumo: `Repasse do iFood de ${dm(deOntem.d)}: o iFood informou ${brl(deOntem.esperado)} e caiu ${brl(deOntem.recebido)} (faltam ${brl(deOntem.esperado - deOntem.recebido)}).` };
  }
  return null;
}
