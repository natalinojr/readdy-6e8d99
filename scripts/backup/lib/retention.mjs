// Retenção de 30 dias — datas sempre em horário de Brasília.

export function brasiliaDate(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PARTIAL_RE = /^(\d{4})-(\d{2})-(\d{2})\.partial-\d{6}$/;

function dateKey(name) {
  const m = DAY_RE.exec(name) || PARTIAL_RE.exec(name);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Retorna os nomes de pasta expirados (ordenados, ascendente), nunca incluindo
// a entrada "complete" mais recente, mesmo se ela já estiver fora do prazo.
export function selectExpired(entries, today, retentionDays) {
  const todayMs = dateKey(today);
  if (todayMs === null) throw new Error("data 'today' inválida: " + today);
  const cutoff = todayMs - retentionDays * 86400000;

  const withDate = entries.map((e) => ({ ...e, ms: dateKey(e.name) })).filter((e) => e.ms !== null);

  let newestComplete = null;
  for (const e of withDate) {
    if (e.complete && (newestComplete === null || e.ms > newestComplete.ms)) newestComplete = e;
  }

  return withDate
    .filter((e) => e.ms < cutoff && e !== newestComplete)
    .sort((a, b) => a.ms - b.ms)
    .map((e) => e.name);
}
