// "Fique de olho" (2026-10-05): cancelamento, desconto e sangria acima de um valor viram UM cartão por loja e
// dia na tela Hoje (pendência kind='fique_de_olho', ref = dia de Brasília) e um aviso no celular do dono e
// do Supervisor. Antes só apitava (NotificacoesContext, lista em memória) no aparelho de quem operou.
//
// Funções PURAS: rodam no Deno (audit-write) e no Vite (tela Hoje e testes em src/test/lib/fiqueDeOlho.test.ts).
// O acesso ao banco fica em supabase/functions/audit-write/fique-de-olho.ts.

/** Mesmos valores do alerta antigo (src/constants/auditoria.ts › ALERT_THRESHOLDS usa este objeto: um número só). */
export const LIMITES_OLHO = { cancelamento: 100, desconto: 50, sangria: 500 } as const;
export type RegraOlho = keyof typeof LIMITES_OLHO;

export const KIND_OLHO = 'fique_de_olho';
/** Quantos itens o cartão guarda (os mais novos) — um aparelho com defeito não infla a linha. */
export const MAX_ITENS_OLHO = 40;
/** Celular: nunca entre 23h e 7h (hora de Brasília). */
export const HORA_PUSH_DE = 7;
export const HORA_PUSH_ATE = 23;

/** O que o cartão guarda de cada ocorrência (payload.itens[]). */
export interface ItemOlho {
  /** chave para não repetir o mesmo evento reenviado pela fila do aparelho */
  id: string;
  /** ISO do momento em que o servidor recebeu o evento */
  ts: string;
  regra: RegraOlho;
  /** "Cancelou um pedido de R$ 187,00" */
  titulo: string;
  valor: number;
  /** quem operou: o nome do login ("Caixa" quando é o login compartilhado da loja) */
  quem: string;
  /** o login é compartilhado (Caixa/Operador): o nome não diz quem foi */
  generico: boolean;
  /** quem autorizou (senha de supervisor, aprovação), quando o evento diz */
  autorizou: string | null;
  /** HH:MM de Brasília */
  hora: string;
  motivo: string | null;
  /** "Mesa 3", "PDV" (descontos) */
  onde: string | null;
  /** "3º desconto hoje · média 1 por dia" */
  ritmo: string | null;
  /** grupo da Auditoria que mostra o evento (Ver) */
  grupo: 'pedidos' | 'caixa';
  /** texto para buscar o evento na Auditoria (o valor, "50,00") */
  busca: string | null;
}

const TIPO_DA_REGRA: Record<RegraOlho, string> = { cancelamento: 'pedido_cancelado', desconto: 'desconto_aplicado', sangria: 'sangria' };
const SUBSTANTIVO: Record<RegraOlho, string> = { cancelamento: 'cancelamento', desconto: 'desconto', sangria: 'sangria' };

export const brl = (n: number): string => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** "R$ 1.234,56" | "1234,5" | 1234.56 → número (null se não der). */
export function lerValor(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = txt(v);
  if (!s) return null;
  const m = /\d[\d.]*(?:,\d+)?/.exec(s.replace(/R\$\s*/gi, ''));
  if (!m) return null;
  const t = m[0];
  // "1.234,56" (vírgula decimal) | "1.234" (milhar, sem decimais) | "1234.5" (ponto decimal)
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Primeiro "R$ x" da descrição. */
function valorDaDescricao(descricao: string | null): number | null {
  const m = descricao ? /R\$\s*([\d.]+(?:,\d{1,2})?)/.exec(descricao) : null;
  return m ? lerValor(m[1]) : null;
}

export interface EventoBruto {
  action_type?: unknown;
  entity_type?: unknown;
  entity_label?: unknown;
  description?: unknown;
  before?: unknown;
  after?: unknown;
  notes?: unknown;
  user_name?: unknown;
}

/**
 * Qual regra o evento pode disparar. Cancelamento só de PEDIDO (voucher e item de pedido têm o mesmo tipo de
 * evento, mas não são o valor do pedido). null = este evento nunca entra no cartão.
 */
export function regraDoEvento(e: EventoBruto): RegraOlho | null {
  const tipo = txt(e.action_type);
  if (tipo === 'sangria') return 'sangria';
  if (tipo === 'desconto_aplicado') return 'desconto';
  if (tipo === 'pedido_cancelado') {
    if ((txt(e.entity_type) ?? '').toLowerCase() !== 'pedido') return null;
    if (/^item\b/i.test(txt(e.description) ?? '')) return null;
    return 'cancelamento';
  }
  return null;
}

/**
 * Valor que o evento diz ter. Os registros do PDV não são uniformes: sangria grava `after.valor` (número);
 * desconto grava `after.desconto` ("R$ 50,00", texto); cancelamento não grava valor nenhum (o servidor busca o
 * total do pedido). Por último, o primeiro "R$" da descrição.
 */
export function valorDoEvento(regra: RegraOlho, e: EventoBruto): number | null {
  const a = obj(e.after); const b = obj(e.before);
  const cand = regra === 'cancelamento' ? [a.total, b.total, a.valor] : regra === 'desconto' ? [a.valor, a.desconto, a.valor_solicitado] : [a.valor];
  for (const c of cand) { const n = lerValor(c); if (n != null && n > 0) return n; }
  // Cancelamento: o "R$" da descrição só vale quando a frase é do valor (estorno), nunca de pedido sem valor.
  return regra === 'cancelamento' ? null : valorDaDescricao(txt(e.description));
}

/** Login compartilhado da loja: o nome não diz quem foi. */
export const ehNomeGenerico = (nome: string | null | undefined): boolean => /^(caixa|operador|pdv|balc[aã]o|tablet|totem)(\s*\d+)?$/i.test((nome ?? '').trim()) || !(nome ?? '').trim();

/** Quem autorizou: campo do evento ou a frase da descrição ("Autorizado por: Eduardo", "autorização: Natalino"). */
export function autorizadorDe(e: EventoBruto): string | null {
  const a = obj(e.after);
  const campo = txt(a.autorizador);
  if (campo && !/^permiss/i.test(campo)) return campo;
  const d = txt(e.description) ?? '';
  const m = /autorizado por:?\s*([^.(—]+?)(?:\s*\(|\.|\s+—|$)/i.exec(d) ?? /autoriza[çc][ãa]o:\s*([^)]+)\)/i.exec(d) ?? /aprovado por\s+([^.(—]+?)(?:\s*\(|\.|\s+—|$)/i.exec(d);
  const n = m?.[1]?.trim();
  return n || null;
}

/** Motivo: campo do evento, ou a frase da descrição, ou o do pedido (orders.cancel_reason). */
export function motivoDe(regra: RegraOlho, e: EventoBruto, motivoDoPedido?: string | null): string | null {
  const a = obj(e.after);
  const d = txt(e.description) ?? '';
  if (regra === 'sangria') return txt(a.motivo) ?? (/motivo:\s*(.+)$/i.exec(d)?.[1]?.trim() ?? null);
  if (regra === 'cancelamento') {
    const m = /Motivo:\s*([^.]+?)(?:\.|$)/.exec(d) ?? /cancelado\s+—\s+([^()]+?)(?:\s*\(|$)/.exec(d);
    return txt(motivoDoPedido) ?? (m?.[1]?.trim() || null);
  }
  const metodo = txt(a.metodo);
  return metodo ? `autorizado por ${metodo.toLowerCase()}` : null;
}

/** Onde foi o desconto: "Mesa 3", "PDV" (entity_label que não é UUID). */
export function ondeDe(e: EventoBruto): string | null {
  const l = txt(e.entity_label);
  return l && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(l) && l.length <= 24 ? l : null;
}

/** Linha de uma ocorrência do histórico da pessoa (audit_log). */
export interface LinhaHistorico { created_at: string; action_type: string; entity_type: string | null }
export const diaBrasilia = (ts: string | Date): string => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export const horaBrasilia = (ts: string | Date): string => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
export const horaCheiaBrasilia = (ts: string | Date): number => Number(new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).slice(0, 2)) % 24;
export const podeAvisarAgora = (ts: string | Date): boolean => { const h = horaCheiaBrasilia(ts); return h >= HORA_PUSH_DE && h < HORA_PUSH_ATE; };

/** Quantas vezes hoje (contando esta) e a média por dia trabalhado nos dias anteriores (≥ 3 dias de histórico). */
export function ritmoDaPessoa(linhas: LinhaHistorico[], regra: RegraOlho, agora: string | Date): { hoje: number; media: number | null } {
  const dia = diaBrasilia(agora);
  const doTipo = (l: LinhaHistorico) => l.action_type === TIPO_DA_REGRA[regra] && (regra !== 'cancelamento' || (l.entity_type ?? '').toLowerCase() === 'pedido');
  let hoje = 0; let passadas = 0; const diasTrabalhados = new Set<string>();
  for (const l of linhas) {
    const d = diaBrasilia(l.created_at);
    if (d === dia) { if (doTipo(l)) hoje++; continue; }
    if (d > dia) continue;
    diasTrabalhados.add(d);
    if (doTipo(l)) passadas++;
  }
  return { hoje, media: diasTrabalhados.size >= 3 ? passadas / diasTrabalhados.size : null };
}

const num1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
/** "3º desconto hoje · média 1 por dia" (só de 2 em diante; sem histórico suficiente, sem média). */
export function textoRitmo(regra: RegraOlho, r: { hoje: number; media: number | null }, generico: boolean): string | null {
  if (r.hoje < 2) return null;
  const quem = generico ? ' no caixa' : '';
  const base = `${r.hoje}º ${SUBSTANTIVO[regra]} hoje${quem}`;
  return r.media != null ? `${base} · média ${num1(r.media)} por dia` : base;
}

export function tituloDoItem(regra: RegraOlho, valor: number, onde: string | null): string {
  if (regra === 'cancelamento') return `Cancelou um pedido de ${brl(valor)}`;
  if (regra === 'desconto') return `Desconto de ${brl(valor)}${onde ? ` (${onde})` : ''}`;
  return `Sangria de ${brl(valor)}`;
}

export interface EntradaItem {
  regra: RegraOlho; valor: number; evento: EventoBruto; userId: string; agora: Date;
  motivoDoPedido?: string | null; ritmo?: { hoje: number; media: number | null };
}
/** Monta o item do cartão. */
export function montarItem(x: EntradaItem): ItemOlho {
  const quem = txt(x.evento.user_name) ?? 'Caixa';
  const generico = ehNomeGenerico(quem);
  const onde = x.regra === 'desconto' ? ondeDe(x.evento) : null;
  const label = txt(x.evento.entity_label) ?? '';
  const aut = autorizadorDe(x.evento);
  return {
    id: `${x.regra}|${x.userId}|${label}|${x.valor}`,
    ts: x.agora.toISOString(),
    regra: x.regra,
    titulo: tituloDoItem(x.regra, x.valor, onde),
    valor: x.valor,
    quem, generico,
    // Quem aplicou com a própria permissão aparece como "autorizador" de si mesmo: não é autorização.
    autorizou: aut && aut.toLowerCase() !== quem.toLowerCase() ? aut : null,
    hora: horaBrasilia(x.agora),
    motivo: motivoDe(x.regra, x.evento, x.motivoDoPedido),
    onde,
    ritmo: x.ritmo ? textoRitmo(x.regra, x.ritmo, generico) : null,
    grupo: x.regra === 'sangria' ? 'caixa' : 'pedidos',
    // s\u00f3 o n\u00famero ("50,00"): o PDV grava o "R$" com espa\u00e7o n\u00e3o separ\u00e1vel e a busca da Auditoria \u00e9 por texto
    busca: x.regra === 'cancelamento' ? null : brl(x.valor).replace(/^R\$[\s\u00a0]*/, ''),
  };
}

/** Para onde o [Ver] leva: a Auditoria já filtrada (pedidos ou caixa) e, quando dá, buscando o valor. */
export function rotaDoItem(i: Pick<ItemOlho, 'grupo' | 'busca'>): string {
  const q = new URLSearchParams({ grupo: i.grupo });
  if (i.busca) q.set('busca', i.busca);
  return `/auditoria?${q.toString()}`;
}

/** "Caixa · autorizou Eduardo" / "Maria". */
export function quemTexto(i: Pick<ItemOlho, 'quem' | 'generico' | 'autorizou'>): string {
  return i.autorizou ? `${i.quem} · autorizou ${i.autorizou}` : i.quem;
}

/** Texto do aviso no celular (uma ocorrência). */
export function textoPush(loja: string, i: ItemOlho): { titulo: string; corpo: string } {
  const resto = [quemTexto(i), i.hora, i.motivo ? `“${i.motivo}”` : null].filter(Boolean).join(' · ');
  return { titulo: `Fique de olho${loja ? ` · ${loja}` : ''}`, corpo: `${i.titulo} — ${resto}`.slice(0, 200) };
}

/** Título do cartão do dia. */
export function tituloDoCartao(itens: Array<Pick<ItemOlho, 'titulo'>>): string {
  return itens.length === 1 ? itens[0].titulo : `${itens.length} coisas da equipe hoje`;
}

/** Itens do payload da pendência (a tela lê daqui). */
export function itensDoPayload(payload: Record<string, unknown> | null | undefined): ItemOlho[] {
  const l = payload?.itens;
  return Array.isArray(l) ? (l as ItemOlho[]).filter((i) => i && typeof i.titulo === 'string') : [];
}
