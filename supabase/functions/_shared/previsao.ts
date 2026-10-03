// Avisar ANTES de virar problema (2026-10-03, item 3 da visão "sistema ativo e proativo").
// Regras puras dos três avisos que o assistente-cron vira pendência — a tela Hoje, o número do topo e o
// "Bom dia" mostram sozinhos. Testadas em src/test/lib/previsao.test.ts. Sem import: roda no Vite e no Deno.
//
//   vendas_abaixo_ritmo   faturamento de hoje × meta do dia no ritmo do Dashboard (15h e 19h)
//   caixa_nao_cobre       saldo no banco × contas vencidas + próximos 7 dias (regra do Financeiro › Painel)
//   insumo_antes_do_pico  insumo que não chega ao horário de pico de hoje pelo uso real (10h e 16h)

const TZ = 'America/Sao_Paulo';
const reais = (n: number) => `R$ ${Math.round(n).toLocaleString('pt-BR')}`;
const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const diaDaSemana = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
export function somarDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** Janela do aviso em que "agora" (HH:MM de Brasília) está: de `inicio` até `horas` depois. null = fora. */
export function janelaAtual(janelas: string[], agora: string, horas = 2): string | null {
  for (const j of janelas) {
    const [h, m] = j.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const fim = `${String(Math.min(h + horas, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (agora >= j && agora < fim) return j;
  }
  return null;
}

/** "15:00" → "15h", "15:40" → "15h40". */
export const horaTexto = (hhmm: string) => { const [h, m] = hhmm.split(':'); return `${Number(h)}h${m === '00' ? '' : m}`; };

/** Aviso no celular só em horário de gente acordada; fora dele a pendência nasce quieta e o "Bom dia" leva. */
export const podeAvisarNoCelular = (agora: string, de = '08:00', ate = '21:30') => agora >= de && agora <= ate;

// ── 1) Vendas abaixo do ritmo ─────────────────────────────────────────────────────────────────────
// A MESMA régua do cartão de faturamento do Dashboard (FaturamentoHero) e da Hoje (VendasHoje):
// % da meta do dia já vendido × % do dia que costuma ter entrado até esta hora (ritmo_esperado de
// fn_get_dashboard_painel: média das 4 últimas semanas no mesmo dia da semana). Sem meta não há régua.
//   "Abaixo do ritmo" (vermelho no Dashboard) = mais de 15 pontos abaixo → abre o aviso;
//   "No ritmo" (verde) = até 5 pontos abaixo, ou bateu a meta → fecha sozinho.
export const RITMO_PTS_ABAIXO = 15;
export const RITMO_PTS_VOLTOU = 5;

export interface Ritmo { esperado: number; pts: number; bateu: boolean; abaixo: boolean; noRitmo: boolean }

/** null = sem régua: sem meta do dia, menos de 2 semanas de histórico ou o movimento ainda não começou. */
export function avaliarRitmo(valor: number, meta: number, ritmo: number | null, ritmoDias: number): Ritmo | null {
  if (!(meta > 0) || ritmo == null || ritmoDias < 2) return null;
  const bateu = valor >= meta;
  if (!bateu && ritmo < 0.03) return null;
  const pts = (valor / meta - ritmo) * 100;
  return { esperado: meta * ritmo, pts, bateu, abaixo: !bateu && pts < -RITMO_PTS_ABAIXO, noRitmo: bateu || pts >= -RITMO_PTS_VOLTOU };
}

/** Nomes dos canais = os do Dashboard (PorCanal). */
export const NOME_CANAL: Record<string, string> = {
  table: 'Salão (mesas)', waiter: 'Garçom', cashier: 'Balcão', delivery: 'Delivery próprio', self_service: 'Autoatendimento', ifood: 'iFood',
};

/** O canal que mais caiu × o mesmo dia da semana passada até esta hora (só queda de 30% e R$ 50 ou mais). */
export function canalQueMaisCaiu(hoje: Record<string, number>, antes: Record<string, number>): { canal: string; nome: string; hoje: number; antes: number } | null {
  let melhor: { canal: string; nome: string; hoje: number; antes: number } | null = null;
  for (const [canal, a] of Object.entries(antes)) {
    const h = Number(hoje[canal] ?? 0);
    const queda = Number(a) - h;
    if (!(a > 0) || queda < 50 || queda < 0.3 * a) continue;
    if (!melhor || queda > melhor.antes - melhor.hoje) melhor = { canal, nome: NOME_CANAL[canal] ?? canal, hoje: h, antes: Number(a) };
  }
  return melhor;
}

export interface TextoAviso { titulo: string; detalhe: string; push: string; chat?: string }

/** `hora` já como texto: "15h", "15h40". */
export function textoRitmo(o: { loja: string; hora: string; valor: number; meta: number; hoje: string; r: Ritmo; canal: ReturnType<typeof canalQueMaisCaiu> }): TextoAviso {
  const dia = DIAS[diaDaSemana(o.hoje)];
  const caiu = o.canal ? `O que mais caiu: ${o.canal.nome}, ${reais(o.canal.hoje)} (${dia} passad${diaDaSemana(o.hoje) === 0 || diaDaSemana(o.hoje) === 6 ? 'o' : 'a'} ${reais(o.canal.antes)} até esta hora).` : '';
  const pct = Math.round((o.r.esperado / o.meta) * 100);
  return {
    titulo: `Vendas abaixo do ritmo: ${reais(o.valor)} até as ${o.hora} (esperado ${reais(o.r.esperado)})`,
    detalhe: `Meta de ${dia}: ${reais(o.meta)}. Até esta hora costuma entrar ${pct}% do dia. ${caiu}`.trim(),
    push: `${o.loja}: ${reais(o.valor)} até as ${o.hora}; o esperado para a meta era ${reais(o.r.esperado)}.${o.canal ? ` Mais queda no ${o.canal.nome}.` : ''}`,
    chat: `📉 *${o.loja}*: até as ${o.hora} vendeu ${reais(o.valor)}, abaixo do ritmo da meta (esperado ${reais(o.r.esperado)} de ${reais(o.meta)}).${caiu ? ` ${caiu}` : ''} Está na tela Hoje.`,
  };
}

// ── 2) Caixa da semana não cobre ──────────────────────────────────────────────────────────────────
// Mesma regra do Financeiro › Painel e do cartão "dá para pagar" da Hoje: no banco = contas ativas
// (synced_balance ?? current_balance); devo = contas pending/overdue/partial pelo que falta pagar,
// vencidas (antes de hoje) + as que vencem de hoje até hoje + 7.
export const CAIXA_DIAS = 7;
/** Diferença de centavos não vira aviso. */
export const CAIXA_TOLERANCIA = 1;

export interface ContaAberta { nome: string; valor: number; vencimento: string }
export interface Caixa {
  noBanco: number; vencidas: number; semana: number; precisa: number; falta: number; cobre: boolean;
  /** dia em que a soma das contas (na ordem do vencimento) passa do saldo; vencida = hoje */
  faltaEm: string | null;
  /** as primeiras a vencer (vencidas antes) */
  primeiras: ContaAberta[];
}

export function caixaDaSemana(noBanco: number, contas: ContaAberta[], hoje: string, dias = CAIXA_DIAS): Caixa {
  const ate = somarDias(hoje, dias);
  const lista = contas.filter((c) => c.valor > 0.005 && c.vencimento <= ate)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || b.valor - a.valor);
  const vencidas = lista.filter((c) => c.vencimento < hoje).reduce((s, c) => s + c.valor, 0);
  const semana = lista.filter((c) => c.vencimento >= hoje).reduce((s, c) => s + c.valor, 0);
  const precisa = vencidas + semana;
  const falta = Math.round((precisa - noBanco) * 100) / 100;
  let faltaEm: string | null = null;
  let soma = 0;
  for (const c of lista) {
    soma += c.valor;
    if (soma > noBanco + CAIXA_TOLERANCIA) { faltaEm = c.vencimento < hoje ? hoje : c.vencimento; break; }
  }
  return { noBanco, vencidas, semana, precisa, falta, cobre: falta <= CAIXA_TOLERANCIA, faltaEm, primeiras: lista.slice(0, 3) };
}

/** "hoje", "amanhã", "sexta (10/10)". */
export function quandoFalta(dia: string, hoje: string): string {
  const d = diasEntre(hoje, dia);
  if (d <= 0) return 'hoje';
  if (d === 1) return 'amanhã';
  return `${DIAS[diaDaSemana(dia)]} (${ddmm(dia)})`;
}

export function textoCaixa(o: { loja: string; c: Caixa; hoje: string }): TextoAviso {
  const { c } = o;
  const nemVencidas = c.vencidas > c.noBanco + CAIXA_TOLERANCIA;
  const quando = c.faltaEm ? quandoFalta(c.faltaEm, o.hoje) : null;
  const primeiras = c.primeiras.map((x) => `${x.nome} ${brl(x.valor)} (${x.vencimento < o.hoje ? `venceu ${ddmm(x.vencimento)}` : x.vencimento === o.hoje ? 'vence hoje' : `vence ${ddmm(x.vencimento)}`})`).join('; ');
  return {
    titulo: `${nemVencidas ? 'O banco não cobre nem as contas vencidas' : 'O banco não cobre as contas da semana'} — ${brl(c.falta)}`,
    detalhe: `Faltam ${brl(c.falta)}${quando ? `, a partir de ${quando}` : ''}. No banco: ${brl(c.noBanco)}; vencidas ${brl(c.vencidas)} + próximos 7 dias ${brl(c.semana)}. Vence primeiro: ${primeiras}.`,
    push: `${o.loja}: faltam ${brl(c.falta)} para as contas ${nemVencidas ? 'vencidas' : 'da semana'}${quando && !nemVencidas ? ` (a partir de ${quando})` : ''}. No banco ${brl(c.noBanco)}, contas ${brl(c.precisa)}.`,
  };
}

// ── 3) Insumo acaba antes do pico ─────────────────────────────────────────────────────────────────
// Uso/dia = o da regra única do Estoque (fn_estoque_situacao / src/lib/estoqueRegras.ts: saídas de uso
// dos últimos 14 dias). Pico de hoje = hora com mais pedidos no mesmo dia da semana (fn_get_dashboard_pico,
// média de 4 semanas; o dia de operação começa às 6h). Quanto precisa até o fim do pico = uso/dia × pedidos
// esperados de agora até o fim da hora do pico ÷ pedidos de um dia médio — sábado cheio pede mais que segunda.
// Só insumo COM saldo: zerado ou negativo já é "esgotado/conferir" e fica no aviso de Estoque.
export interface PicoCelula { d: number; h: number; p: number }
/** Posição da hora no dia de operação (6h = 0 … 5h = 23), como em fn_get_dashboard_pico. */
export const horaOperacao = (h: number) => (h - 6 + 24) % 24;
/** Dia de operação (0 = domingo) de um instante: madrugada até 5h59 ainda é o dia anterior. */
export function diaOperacao(agora: Date): number {
  const d = new Date(agora.getTime() - 6 * 3600_000);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' }));
}

export interface Pico { horaPico: number; pedidosAtePico: number; pedidosPorDia: number }

/** null = sem movimento registrado nesse dia da semana. pedidosAtePico = 0 quando o pico já passou. */
export function previsaoPico(pico: PicoCelula[], dia: number, hora: number): Pico | null {
  const doDia = pico.filter((c) => c.d === dia && c.p > 0).sort((a, b) => horaOperacao(a.h) - horaOperacao(b.h));
  const pedidosPorDia = pico.reduce((s, c) => s + Math.max(Number(c.p) || 0, 0), 0) / 7;
  if (!doDia.length || !(pedidosPorDia > 0)) return null;
  // Empate: o mais tarde (o estoque precisa aguentar o pico inteiro).
  const topo = doDia.reduce((a, b) => (b.p >= a.p ? b : a));
  const agora = horaOperacao(hora);
  const fim = horaOperacao(topo.h);
  const pedidosAtePico = doDia.filter((c) => horaOperacao(c.h) >= agora && horaOperacao(c.h) <= fim).reduce((s, c) => s + c.p, 0);
  return { horaPico: topo.h, pedidosAtePico, pedidosPorDia };
}

export interface InsumoPico { id: string; nome: string; unidade: string; estoque: number; consumoDia: number | null; acompanha: boolean }
export interface Faltando { id: string; nome: string; unidade: string; estoque: number; precisa: number }

export function acabamAntesDoPico(insumos: InsumoPico[], p: Pico): Faltando[] {
  if (!(p.pedidosAtePico > 0)) return [];
  const fracao = p.pedidosAtePico / p.pedidosPorDia;
  return insumos
    .filter((i) => i.acompanha && (i.consumoDia ?? 0) > 0 && i.estoque > 0)
    .map((i) => ({ id: i.id, nome: i.nome, unidade: i.unidade, estoque: i.estoque, precisa: (i.consumoDia as number) * fracao }))
    .filter((i) => i.estoque < i.precisa)
    .sort((a, b) => a.estoque / a.precisa - b.estoque / b.precisa);
}

/** Quantidade legível na unidade do estoque: 1.250 g → "1,3 kg", 0.4 kg → "0,4 kg", 3 unit → "3 un". */
export function fmtQtd(q: number, unidade: string): string {
  const n = (v: number, casas: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas });
  if (unidade === 'g') return q >= 1000 ? `${n(q / 1000, 1)} kg` : `${n(q, 0)} g`;
  if (unidade === 'ml') return q >= 1000 ? `${n(q / 1000, 1)} L` : `${n(q, 0)} ml`;
  if (unidade === 'unit') return `${n(q, q < 10 ? 1 : 0)} un`;
  return `${n(q, 2)} ${unidade}`;
}

export function textoPico(o: { loja: string; faltando: Faltando[]; horaPico: number }): TextoAviso {
  const f = o.faltando;
  const h = `${o.horaPico}h`;
  const lista = f.slice(0, 4).map((i) => `${i.nome}: tem ${fmtQtd(i.estoque, i.unidade)}, precisa de ~${fmtQtd(i.precisa, i.unidade)}`).join('; ');
  return {
    titulo: f.length === 1 ? `${f[0].nome} acaba antes do pico das ${h}` : `${f.length} insumos acabam antes do pico das ${h}`,
    detalhe: `${lista}${f.length > 4 ? `; e mais ${f.length - 4}` : ''}. Pelo uso dos últimos 14 dias. Compre ou produza antes do movimento.`,
    push: `${o.loja}: ${f.slice(0, 3).map((i) => i.nome).join(', ')}${f.length > 3 ? ` e mais ${f.length - 3}` : ''} não ${f.length === 1 ? 'chega' : 'chegam'} ao pico das ${h}.`,
  };
}
