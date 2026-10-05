// "Por que mudou?" (Dashboard e Comparar lojas, 2026-10-05): ao tocar na variação ("−12% vs sex passada") abre uma
// folha com 2 a 4 frases feitas por REGRA, sem IA, SÓ com causas que o sistema já registra:
//   canal      diferença por canal (balcão, autoatendimento, delivery, mesas, iFood);
//   hora / dia diferença por hora (período de um dia) ou por dia, na faixa que concentra a diferença;
//   abertura   o caixa abriu mais tarde (ou mais cedo) / não abriu — sessions.opened_at;
//   pausa      itens do Cardápio que ficaram pausados no período (audit_log 'item_editado'), que venderam no mesmo
//              trecho do período comparado.
// Os fatos de canal (PDV), abertura e pausa vêm de fn_por_que_mudou (migração 20261005210100); a hora/dia e o iFood
// vêm do que a própria tela já tem. Aqui só se compara e se escreve. Dia = dia da loja (src/lib/diaLoja.ts), nunca o
// calendário. Se nada explica, a folha diz "Não achei a causa nos registros" — nunca inventa causa.

export interface CanalValor { valor: number; pedidos: number }
export interface AberturaDia { dia: string; ini: string }
export interface PausaItem {
  item: string;
  /** início e fim dentro do período (cortados na janela) */
  de: string;
  ate: string;
  pausou_em: string;
  retomou_em: string | null;
  minutos: number;
  sem_retomada: boolean;
  vendeu_no_comparado: number;
}

/** O que fn_por_que_mudou devolve. */
export interface FatosPorQue {
  canais: { atual: Record<string, CanalValor>; anterior: Record<string, CanalValor> };
  aberturas: { atual: AberturaDia[]; anterior: AberturaDia[] };
  pausas: PausaItem[];
}

export interface EntradaPorQue {
  /** "sex passada", "dom anterior", "7 dias anteriores"… (como aparece ao lado da variação) */
  rotulo: string;
  umDia: boolean;
  /** primeiro dia do período atual (dia da loja) e do comparado, 'AAAA-MM-DD' */
  dia: string;
  diaComparado: string;
  atual: { faturamento: number; pedidos: number };
  anterior: { faturamento: number; pedidos: number };
  /** hora desde a 0h do dia da loja → valor (um dia) ou 'AAAA-MM-DD' → valor (vários dias); null = não disponível */
  serieAtual: Record<string, number> | null;
  serieAnterior: Record<string, number> | null;
  /** período em andamento: horas a partir desta (a parcial) ficam fora da comparação por hora; null = período fechado */
  horaCorte: number | null;
  /** iFood não passa pelo PDV: a tela soma por cima. anterior null = ainda chegando */
  ifood: { atual: number; anterior: number | null } | null;
  /** null = a consulta falhou: as regras que dependem dela não entram e a folha avisa */
  fatos: FatosPorQue | null;
  /** agora, para saber se "ainda não abriu" (período em andamento) */
  agora?: Date;
}

export type TipoFrase = 'canal' | 'hora' | 'abertura' | 'pausa';
export interface Frase { tipo: TipoFrase; texto: string }

export interface ExplicacaoVariacao {
  /** a variação em palavras: "−R$ 410 (−12%) contra sex passada: 9 pedidos a menos" */
  titulo: string;
  frases: Frase[];
  /** achou algo que de fato pode explicar (pausa ou abertura diferente) */
  acheiCausa: boolean;
  /** frase final quando nada nos registros explica */
  semCausa: string | null;
  /** o que não deu para ler (para avisar, sem esconder) */
  lacunas: string[];
}

// ── Formatação ─────────────────────────────────────────────────────────────────────
const brl = (v: number) => Math.abs(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });
const sinal = (v: number) => (v < 0 ? '−' : '+');
const dif = (v: number) => `${sinal(v)}${brl(v)}`;
const TZ = 'America/Sao_Paulo';

/** "18h40" em Brasília. */
export function horaMin(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', 'h');
}
const diaMes = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaSemana = (ymd: string) => DIAS_SEMANA[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
const dataBr = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);
const minutosDoDia = (iso: string, dia: string) => Math.round((new Date(iso).getTime() - new Date(`${dia}T00:00:00-03:00`).getTime()) / 60000);

export const NOME_CANAL: Record<string, string> = {
  table: 'Salão (mesas)', waiter: 'Garçom', cashier: 'Balcão', delivery: 'Delivery próprio', self_service: 'Autoatendimento', ifood: 'iFood',
};
const nomeCanal = (o: string) => NOME_CANAL[o] ?? o;

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Diferença menor que isto não vira frase (centavos). */
const MIN_DIF = 1;
/** Pausa mais curta que isto (min) não explica venda. */
export const PAUSA_MIN_MINUTOS = 15;
/** Caixa que abre com menos que isto de diferença (min) é o mesmo horário. */
export const ABERTURA_MIN_MINUTOS = 30;
/** A faixa de horas (ou o dia) precisa concentrar pelo menos esta parte da diferença para ser citada. */
export const CONCENTRA = 0.5;

// ── Título ─────────────────────────────────────────────────────────────────────────
export function tituloVariacao(e: Pick<EntradaPorQue, 'atual' | 'anterior' | 'rotulo'>): string {
  const d = r2(e.atual.faturamento - e.anterior.faturamento);
  const dp = e.atual.pedidos - e.anterior.pedidos;
  if (Math.abs(d) < MIN_DIF) return `Praticamente igual a ${e.rotulo}`;
  const pct = e.anterior.faturamento > 0 ? ` (${d < 0 ? '−' : '+'}${Math.abs((d / e.anterior.faturamento) * 100).toFixed(0)}%)` : '';
  const peds = dp === 0 ? 'mesmo número de pedidos' : `${Math.abs(dp)} ${plural(Math.abs(dp), 'pedido', 'pedidos')} a ${dp < 0 ? 'menos' : 'mais'}`;
  return `${dif(d)}${pct} contra ${e.rotulo}: ${peds}`;
}

// ── Canal ──────────────────────────────────────────────────────────────────────────
function fraseCanal(e: EntradaPorQue, total: number): Frase | null {
  if (!e.fatos) return null;
  const a: Record<string, { valor: number; pedidos: number | null }> = {};
  const b: Record<string, { valor: number; pedidos: number | null }> = {};
  for (const [k, v] of Object.entries(e.fatos.canais.atual)) a[k] = { valor: v.valor, pedidos: v.pedidos };
  for (const [k, v] of Object.entries(e.fatos.canais.anterior)) b[k] = { valor: v.valor, pedidos: v.pedidos };
  // iFood: só entra se os dois lados são conhecidos (senão o canal inteiro apareceria como "novo")
  if (e.ifood && e.ifood.anterior !== null) {
    if (e.ifood.atual > 0) a.ifood = { valor: e.ifood.atual, pedidos: null };
    if (e.ifood.anterior > 0) b.ifood = { valor: e.ifood.anterior, pedidos: null };
  }
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  const itens = [...chaves].map((k) => {
    const va = a[k]?.valor ?? 0; const vb = b[k]?.valor ?? 0;
    const pa = a[k]?.pedidos; const pb = b[k]?.pedidos;
    return { k, d: r2(va - vb), dp: pa != null && pb != null ? pa - pb : (pa == null && pb == null ? null : (pa ?? 0) - (pb ?? 0)) };
  }).filter((x) => Math.abs(x.d) >= MIN_DIF).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  if (itens.length === 0) return null;

  const primeiro = itens[0];
  const mesmoSentido = Math.abs(total) >= MIN_DIF && Math.sign(primeiro.d) === Math.sign(total);
  const peds = (x: { dp: number | null }) => (x.dp == null || x.dp === 0 ? '' : ` (${Math.abs(x.dp)} ${plural(Math.abs(x.dp), 'pedido', 'pedidos')} a ${x.dp < 0 ? 'menos' : 'mais'})`);
  if (mesmoSentido && Math.abs(primeiro.d) >= Math.abs(total) * CONCENTRA && itens.length > 1) {
    const share = Math.round((Math.abs(primeiro.d) / Math.abs(total)) * 100);
    const resto = itens.slice(1, 3).map((x) => `${nomeCanal(x.k)} ${dif(x.d)}`).join(', ');
    return { tipo: 'canal', texto: `Por canal, a maior parte veio do ${nomeCanal(primeiro.k)}: ${dif(primeiro.d)}${peds(primeiro)}, ${share}% da diferença. Os outros: ${resto}.` };
  }
  if (itens.length === 1) return { tipo: 'canal', texto: `Só mudou o ${nomeCanal(primeiro.k)}: ${dif(primeiro.d)}${peds(primeiro)}.` };
  return { tipo: 'canal', texto: `Por canal: ${itens.slice(0, 3).map((x) => `${nomeCanal(x.k)} ${dif(x.d)}${peds(x)}`).join(' · ')}.` };
}

// ── Hora / dia ─────────────────────────────────────────────────────────────────────
const h = (n: number) => `${((n % 24) + 24) % 24}h`;

function fraseHora(e: EntradaPorQue, total: number): Frase | null {
  if (!e.serieAtual || !e.serieAnterior || Math.abs(total) < MIN_DIF) return null;
  const sa = e.serieAtual; const sb = e.serieAnterior;

  if (e.umDia) {
    const horas = [...new Set([...Object.keys(sa), ...Object.keys(sb)].map(Number))].filter((x) => Number.isFinite(x))
      .filter((x) => e.horaCorte === null || x < e.horaCorte).sort((x, y) => x - y);
    if (horas.length === 0) return null;
    const d = new Map(horas.map((x) => [x, (Number(sa[String(x)] ?? sa[String(x).padStart(2, '0')] ?? 0)) - (Number(sb[String(x)] ?? sb[String(x).padStart(2, '0')] ?? 0))]));
    const dirTotal = Math.sign(total);
    const somaSerie = horas.reduce((s, x) => s + (d.get(x) ?? 0), 0);
    const alvo = Math.abs(somaSerie);
    if (Math.sign(somaSerie) !== dirTotal || alvo < MIN_DIF) return null;
    // menor faixa de horas seguidas (até 3) que concentra a diferença na direção do total: metade dela, e mais do que
    // a sua parte justa das horas (3 de 6 horas com 50% é só diferença espalhada, não uma faixa)
    if (horas.length < 2) return null;
    for (const larg of [1, 2, 3]) {
      const minimo = Math.max(CONCENTRA, 1.5 * (larg / horas.length));
      let melhor: { ini: number; v: number } | null = null;
      for (const ini of horas) {
        let v = 0;
        for (let k = 0; k < larg; k++) v += d.get(ini + k) ?? 0;
        if (Math.sign(v) !== dirTotal) continue;
        if (!melhor || Math.abs(v) > Math.abs(melhor.v)) melhor = { ini, v };
      }
      if (melhor && Math.abs(melhor.v) >= alvo * minimo) {
        let va = 0; let vb = 0;
        for (let k = 0; k < larg; k++) { va += Number(sa[String(melhor.ini + k)] ?? sa[String(melhor.ini + k).padStart(2, '0')] ?? 0); vb += Number(sb[String(melhor.ini + k)] ?? sb[String(melhor.ini + k).padStart(2, '0')] ?? 0); }
        const faixa = larg === 1 ? `Às ${h(melhor.ini)}` : `Entre ${h(melhor.ini)} e ${h(melhor.ini + larg)}`;
        return { tipo: 'hora', texto: `${faixa} está a maior diferença: ${brl(va)} contra ${brl(vb)} (${dif(melhor.v)}), ${Math.round((Math.abs(melhor.v) / alvo) * 100)}% da diferença do período.` };
      }
    }
    return { tipo: 'hora', texto: 'Por hora, a diferença está espalhada: nenhuma faixa de até 3 horas concentra metade dela.' };
  }

  // vários dias: pareia pelo dia da posição (1º com 1º…)
  const da = Object.keys(sa).sort(); const db = Object.keys(sb).sort();
  const n = Math.max(da.length, db.length);
  if (n === 0) return null;
  const pares = Array.from({ length: n }, (_, i) => ({ dia: da[i], ref: db[i], a: Number(sa[da[i]] ?? 0), b: Number(sb[db[i]] ?? 0) }));
  const dirTotal = Math.sign(total);
  const alvo = Math.abs(pares.reduce((s, p) => s + (p.a - p.b), 0));
  const melhor = pares.filter((p) => Math.sign(p.a - p.b) === dirTotal).sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b))[0];
  if (!melhor || alvo < MIN_DIF) return null;
  const v = melhor.a - melhor.b;
  if (Math.abs(v) >= alvo * CONCENTRA && melhor.dia) {
    return { tipo: 'hora', texto: `O dia que mais pesou foi ${diaSemana(melhor.dia)} ${ddmm(melhor.dia)}: ${brl(melhor.a)} contra ${brl(melhor.b)}${melhor.ref ? ` em ${diaSemana(melhor.ref)} ${ddmm(melhor.ref)}` : ''} (${dif(v)}).` };
  }
  return { tipo: 'hora', texto: 'Por dia, a diferença está espalhada: nenhum dia concentra metade dela.' };
}

// ── Abertura do caixa ──────────────────────────────────────────────────────────────
function fraseAbertura(e: EntradaPorQue, total: number): Frase | null {
  if (!e.fatos || Math.abs(total) < MIN_DIF) return null;
  const cai = total < 0;
  const at = [...e.fatos.aberturas.atual].sort((x, y) => x.dia.localeCompare(y.dia));
  const an = [...e.fatos.aberturas.anterior].sort((x, y) => x.dia.localeCompare(y.dia));
  const agora = e.agora ?? new Date();
  const hoje = agora.toLocaleDateString('en-CA', { timeZone: TZ });

  if (e.umDia) {
    const a = at[0]; const b = an[0];
    if (!a) {
      if (!cai || !b) return null;
      const hojeAinda = e.dia >= hoje;
      return { tipo: 'abertura', texto: hojeAinda
        ? `O caixa ainda não foi aberto hoje; ${e.rotulo} abriu às ${horaMin(b.ini)}.`
        : `Não houve caixa aberto nesse dia; ${e.rotulo} abriu às ${horaMin(b.ini)}.` };
    }
    if (!b) return null;
    const dm = minutosDoDia(a.ini, e.dia) - minutosDoDia(b.ini, e.diaComparado);
    if (Math.abs(dm) < ABERTURA_MIN_MINUTOS) return null;
    const mais = dm > 0;
    if (mais !== cai) return null; // abrir mais cedo não explica queda; mais tarde não explica alta
    const quanto = Math.abs(dm) >= 60 ? `${Math.floor(Math.abs(dm) / 60)}h${String(Math.abs(dm) % 60).padStart(2, '0')}` : `${Math.abs(dm)} min`;
    return { tipo: 'abertura', texto: `O caixa abriu às ${horaMin(a.ini)}; ${e.rotulo} abriu às ${horaMin(b.ini)} (${quanto} ${mais ? 'mais tarde' : 'mais cedo'}).` };
  }

  // vários dias: pareia o dia i do período com o dia i do comparado
  if (at.length === 0 && an.length === 0) return null;
  return abrirVariosDias(e, cai, new Map(at.map((x) => [x.dia, x.ini])), new Map(an.map((x) => [x.dia, x.ini])), hoje);
}

function somarDia(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

function abrirVariosDias(e: EntradaPorQue, cai: boolean, ja: Map<string, string>, jb: Map<string, string>, hoje: string): Frase | null {
  // dias do período = do 1º dia até o último dia com dado; pareia o dia i do atual com o dia i do comparado
  const ultimoA = [...ja.keys()].sort().pop() ?? e.dia;
  const ultimoB = [...jb.keys()].sort().pop() ?? e.diaComparado;
  const nDias = Math.max(
    Math.round((new Date(`${ultimoA}T12:00:00Z`).getTime() - new Date(`${e.dia}T12:00:00Z`).getTime()) / 86400000),
    Math.round((new Date(`${ultimoB}T12:00:00Z`).getTime() - new Date(`${e.diaComparado}T12:00:00Z`).getTime()) / 86400000),
  ) + 1;
  let tarde = 0; let cedo = 0; let maior: { dia: string; dm: number } | null = null;
  const semCaixa: string[] = [];
  let comparados = 0;
  for (let i = 0; i < nDias; i++) {
    const da = somarDia(e.dia, i); const db = somarDia(e.diaComparado, i);
    const a = ja.get(da); const b = jb.get(db);
    if (da > hoje) continue;
    if (!a && b && da < hoje) { semCaixa.push(ddmm(da)); continue; }
    if (!a || !b) continue;
    comparados += 1;
    const dm = minutosDoDia(a, da) - minutosDoDia(b, db);
    if (Math.abs(dm) < ABERTURA_MIN_MINUTOS) continue;
    if (dm > 0) tarde += 1; else cedo += 1;
    if (cai === dm > 0 && (!maior || Math.abs(dm) > Math.abs(maior.dm))) maior = { dia: da, dm };
  }
  const partes: string[] = [];
  if (cai && semCaixa.length > 0) partes.push(`sem caixa aberto em ${semCaixa.join(', ')} (no período comparado houve)`);
  const n = cai ? tarde : cedo;
  if (n > 0 && maior) {
    const q = Math.abs(maior.dm);
    const quanto = q >= 60 ? `${Math.floor(q / 60)}h${String(q % 60).padStart(2, '0')}` : `${q} min`;
    partes.push(`em ${n} de ${comparados} ${plural(comparados, 'dia', 'dias')} o caixa abriu ${cai ? 'mais tarde' : 'mais cedo'} (a maior diferença: ${diaSemana(maior.dia)} ${ddmm(maior.dia)}, ${quanto})`);
  }
  if (partes.length === 0) return null;
  const t = partes.join('; ');
  return { tipo: 'abertura', texto: `${t.charAt(0).toUpperCase()}${t.slice(1)}.` };
}

// ── Pausa de item ──────────────────────────────────────────────────────────────────
function fraseQuando(p: PausaItem, diaRef: string): string {
  const quando = (iso: string) => (dataBr(iso) === diaRef ? horaMin(iso) : `${diaMes(iso)} ${horaMin(iso)}`);
  return p.sem_retomada ? `desde ${quando(p.pausou_em)}, sem retomada registrada` : `de ${quando(p.pausou_em)} a ${quando(p.retomou_em ?? p.ate)}`;
}

function frasePausa(e: EntradaPorQue): Frase | null {
  if (!e.fatos) return null;
  const itens = e.fatos.pausas.filter((p) => p.minutos >= PAUSA_MIN_MINUTOS && p.vendeu_no_comparado > 0);
  if (itens.length === 0) return null;
  const lista = itens.slice(0, 3).map((p) => `${p.item.trim()} (${fraseQuando(p, e.dia)}; vendeu ${p.vendeu_no_comparado} no mesmo trecho de ${e.rotulo})`);
  const resto = itens.length > 3 ? ` e mais ${itens.length - 3}` : '';
  return { tipo: 'pausa', texto: `${itens.length === 1 ? 'Um item ficou pausado' : 'Itens ficaram pausados'} no período: ${lista.join('; ')}${resto}.` };
}

// ── Junta tudo ─────────────────────────────────────────────────────────────────────
export function explicarVariacao(e: EntradaPorQue): ExplicacaoVariacao {
  const total = r2(e.atual.faturamento - e.anterior.faturamento);
  const lacunas: string[] = [];
  if (!e.fatos) lacunas.push('canal, hora de abertura do caixa e itens pausados');
  if (!e.serieAtual || !e.serieAnterior) lacunas.push(e.umDia ? 'vendas por hora' : 'vendas por dia');
  if (e.ifood && e.ifood.anterior === null) lacunas.push('iFood do período comparado');

  const frases: Frase[] = [];
  const canal = fraseCanal(e, total);
  const hora = fraseHora(e, total);
  const abertura = fraseAbertura(e, total);
  const pausa = frasePausa(e);
  for (const f of [canal, hora, abertura, pausa]) if (f) frases.push(f);

  const acheiCausa = !!(abertura || pausa);
  const semCausa = !acheiCausa && e.fatos
    ? `Não achei a causa nos registros: nenhum item pausado nem horário de abertura diferente.${canal || hora ? ' O que aparece acima mostra onde e quando a venda mudou, não por quê.' : ''}`
    : null;
  return { titulo: tituloVariacao(e), frases: frases.slice(0, 4), acheiCausa, semCausa, lacunas };
}
