// Vazamentos do mês (Financeiro › Início › Painel) — regras puras, sem tela.
// Os números vêm de fn_vazamentos_mes (migração 20261005210000): lá está a conta de cada linha. Aqui só se
// junta o que a RPC devolveu (uma loja ou várias), se escolhe o que entra na soma e se escreve a frase.
//
// REGRA DO DONO: só soma linha que tem regra no sistema e cada linha diz de onde vem; nada de número inventado.
// E a manchete nunca conta o mesmo real duas vezes.
//   Entra na soma: juros e multa pagos, insumo mais caro que no mês anterior, perda registrada no estoque.
//   NÃO soma:      prato acima da meta de CMV (o custo da ficha usa o preço ATUAL do insumo, então já contém a alta
//                  que a linha de insumos mede — somar as duas contaria o mesmo real duas vezes; aparece como
//                  informação), Pix do delivery não pago (rascunho cancelado no fechamento: o cliente pode ter
//                  pedido de novo — "a conferir"), diferença de caixa ("a conferir", não prova perda nem culpado),
//                  conta vencida (o juros só vira perda quando a conta é paga) e ficha técnica com custo maior que o
//                  preço (provável ficha errada).
import { CMV_ATENCAO_ATE } from '@/lib/cmvRegras';
import { somarDias } from '@/lib/dateUtils';

export const META_CMV = CMV_ATENCAO_ATE;

// ── O que a RPC devolve (por loja) ─────────────────────────────────────────────────
export interface VazJurosItem { id: string; fornecedor: string; valor: number; pago_em: string; venceu_em: string | null; dias_atraso: number | null }
export interface VazInsumoItem { nome: string; unidade: string; preco_ant: number; preco_atual: number; qtd: number; valor: number }
export interface VazPratoItem { nome: string; qtd: number; receita: number; custo: number; cmv_pct: number; a_mais: number }
export interface VazPratoSuspeito { nome: string; qtd: number; receita: number; custo: number; cmv_pct: number }
export interface VazPerdaItem { nome: string; qtd: number; unidade: string; motivo: string | null; dia: string; valor: number }
export interface VazPixItem { numero: string; dia: string; valor: number; motivo: string }
export interface VazCaixaItem { dia: string; diferenca: number; motivo: string | null }
interface Bloco<T> { total: number; n: number; itens: T[] }

export interface VazLojaDados {
  tenant_id: string;
  nome: string;
  de: string;
  ate: string;
  mes_anterior: { de: string; ate: string };
  juros: Bloco<VazJurosItem>;
  insumos: Bloco<VazInsumoItem>;
  pratos: Bloco<VazPratoItem> & { meta: number; ficha_suspeita: VazPratoSuspeito[]; pratos_com_ficha: number; pratos_sem_ficha: number };
  perdas: Bloco<VazPerdaItem>;
  pix: Bloco<VazPixItem>;
  caixa: { fechamentos: number; com_diferenca: number; itens: VazCaixaItem[] };
  vencidas: { n: number; valor: number };
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Resposta fora do formato é erro (nunca "sem vazamento"): quem chama mostra "não deu para carregar". */
export function lerLoja(raw: unknown): VazLojaDados {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.tenant_id !== 'string' || !o.juros || !o.insumos || !o.pratos || !o.perdas || !o.pix || !o.caixa) {
    throw new Error('Resposta inesperada de vazamentos');
  }
  const bloco = <T,>(b: unknown): Bloco<T> => {
    const x = b as Record<string, unknown>;
    return { total: num(x.total), n: num(x.n), itens: arr<T>(x.itens) };
  };
  const p = o.pratos as Record<string, unknown>;
  const c = o.caixa as Record<string, unknown>;
  const v = (o.vencidas ?? {}) as Record<string, unknown>;
  const ma = (o.mes_anterior ?? {}) as Record<string, unknown>;
  return {
    tenant_id: o.tenant_id, nome: String(o.nome ?? 'Loja'), de: String(o.de), ate: String(o.ate),
    mes_anterior: { de: String(ma.de ?? ''), ate: String(ma.ate ?? '') },
    juros: bloco<VazJurosItem>(o.juros), insumos: bloco<VazInsumoItem>(o.insumos), perdas: bloco<VazPerdaItem>(o.perdas), pix: bloco<VazPixItem>(o.pix),
    pratos: { ...bloco<VazPratoItem>(p), meta: num(p.meta) || META_CMV, ficha_suspeita: arr<VazPratoSuspeito>(p.ficha_suspeita), pratos_com_ficha: num(p.pratos_com_ficha), pratos_sem_ficha: num(p.pratos_sem_ficha) },
    caixa: { fechamentos: num(c.fechamentos), com_diferenca: num(c.com_diferenca), itens: arr<VazCaixaItem>(c.itens) },
    vencidas: { n: num(v.n), valor: num(v.valor) },
  };
}

// ── Janela: uma só para todas as linhas e todas as lojas ───────────────────────────
export type QualMes = 'atual' | 'anterior';

/** Mês até hoje, ou o mês passado inteiro (datas de Brasília, 'AAAA-MM-DD'). */
export function janelaDoMes(hoje: string, qual: QualMes): { de: string; ate: string; mes: string } {
  const mesAtual = hoje.slice(0, 7);
  if (qual === 'atual') return { de: `${mesAtual}-01`, ate: hoje, mes: mesAtual };
  const ultimoDoAnterior = somarDias(`${mesAtual}-01`, -1);
  const mes = ultimoDoAnterior.slice(0, 7);
  return { de: `${mes}-01`, ate: ultimoDoAnterior, mes };
}

export const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeDoMes = (mes: string) => NOME_MES[Number(mes.slice(5, 7)) - 1] ?? mes;

// ── Linhas ─────────────────────────────────────────────────────────────────────────
export type VazTipo = 'juros' | 'insumos' | 'pratos' | 'perdas' | 'pix';

export interface VazLinha {
  chave: string;
  tipo: VazTipo;
  tenantId: string;
  loja: string;
  valor: number;
  n: number;
  titulo: string;
  /** De onde vem o número (a frase que o dono lê embaixo do título). */
  fonte: string;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const pct = (v: number) => `${v.toFixed(0)}%`;

export function linhaDe(tipo: VazTipo, l: VazLojaDados, nomeMesAnterior: string): VazLinha | null {
  const base = { tipo, tenantId: l.tenant_id, loja: l.nome, chave: `${tipo}|${l.tenant_id}` };
  switch (tipo) {
    case 'juros':
      if (l.juros.n === 0 || l.juros.total <= 0) return null;
      return { ...base, valor: l.juros.total, n: l.juros.n,
        titulo: `Juros e multa em ${plural(l.juros.n, 'conta paga atrasada', 'contas pagas atrasadas')}`,
        fonte: 'Vem da Trilha, só leitura · juros e multa que a conciliação lançou nas contas pagas no período' };
    case 'insumos':
      if (l.insumos.n === 0 || l.insumos.total <= 0) return null;
      return { ...base, valor: l.insumos.total, n: l.insumos.n,
        titulo: `${plural(l.insumos.n, 'insumo mais caro', 'insumos mais caros')} que em ${nomeMesAnterior}`,
        fonte: `Histórico de preço do insumo · preço do período contra ${nomeMesAnterior}, sobre o que já comprou` };
    case 'pratos': {
      if (l.pratos.n === 0 || l.pratos.total <= 0) return null;
      const um = l.pratos.n === 1 ? l.pratos.itens[0] : null;
      return { ...base, valor: l.pratos.total, n: l.pratos.n,
        titulo: um ? `${um.nome} vende com CMV ${pct(um.cmv_pct)} (meta ${pct(l.pratos.meta)})`
          : `${plural(l.pratos.n, 'prato vendido', 'pratos vendidos')} com CMV acima de ${pct(l.pratos.meta)}`,
        fonte: 'Ficha técnica · custo da ficha ÷ preço, acima da meta · já inclui a alta dos insumos, por isso não soma' };
    }
    case 'perdas':
      if (l.perdas.n === 0 || l.perdas.total <= 0) return null;
      return { ...base, valor: l.perdas.total, n: l.perdas.n,
        titulo: l.perdas.n === 1 ? 'Perda registrada no estoque' : `${l.perdas.n} perdas registradas no estoque`,
        fonte: 'Estoque › perdas · tudo o que foi registrado como perda no período, pelo preço atual do insumo' };
    case 'pix':
      if (l.pix.n === 0 || l.pix.total <= 0) return null;
      return { ...base, valor: l.pix.total, n: l.pix.n,
        titulo: `Pix do delivery: ${plural(l.pix.n, 'pedido não pago', 'pedidos não pagos')} (o cliente pode ter pedido de novo)`,
        fonte: 'Pedidos de delivery com Pix gerado e não pago, cancelados no fechamento do caixa' };
  }
}

/** O que entra na manchete. Pratos e Pix têm linha, mas fora da soma (ver cabeçalho). */
export const TIPOS_SOMA: VazTipo[] = ['juros', 'insumos', 'perdas'];

export interface VazResumo {
  total: number;
  /** Só o que soma, da maior para a menor. */
  linhas: VazLinha[];
  /** Fora da soma: pratos acima da meta de CMV (o custo já contém a alta dos insumos), da maior para a menor. */
  pratos: VazLinha[];
  /** Fora da soma, "a conferir": Pix do delivery não pago (o cliente pode ter pedido de novo), por loja. */
  pixConferir: VazLinha[];
  /** Fora da soma: conta vencida ainda aberta, por loja. */
  risco: Array<{ tenantId: string; loja: string; n: number; valor: number }>;
  /** Fora da soma: fechamento de caixa com diferença, por loja. */
  conferir: Array<{ tenantId: string; loja: string; fechamentos: number; comDiferenca: number }>;
  /** Fora da soma: prato com custo maior que o preço (ficha provavelmente errada), por loja. */
  fichaSuspeita: Array<{ tenantId: string; loja: string; itens: VazPratoSuspeito[] }>;
  /** Lojas em que nenhum prato vendido tem ficha: não dá para medir custo do prato. */
  semFicha: Array<{ tenantId: string; loja: string }>;
}

export function resumirVazamentos(lojas: VazLojaDados[]): VazResumo {
  const linhas: VazLinha[] = [];
  const pratos: VazLinha[] = [];
  const pixConferir: VazLinha[] = [];
  const risco: VazResumo['risco'] = [];
  const conferir: VazResumo['conferir'] = [];
  const fichaSuspeita: VazResumo['fichaSuspeita'] = [];
  const semFicha: VazResumo['semFicha'] = [];
  for (const l of lojas) {
    const mesAnt = nomeDoMes(l.mes_anterior.de.slice(0, 7));
    for (const t of TIPOS_SOMA) {
      const li = linhaDe(t, l, mesAnt);
      if (li) linhas.push(li);
    }
    const pr = linhaDe('pratos', l, mesAnt);
    if (pr) pratos.push(pr);
    const px = linhaDe('pix', l, mesAnt);
    if (px) pixConferir.push(px);
    if (l.vencidas.n > 0) risco.push({ tenantId: l.tenant_id, loja: l.nome, n: l.vencidas.n, valor: l.vencidas.valor });
    if (l.caixa.com_diferenca > 0) conferir.push({ tenantId: l.tenant_id, loja: l.nome, fechamentos: l.caixa.fechamentos, comDiferenca: l.caixa.com_diferenca });
    if (l.pratos.ficha_suspeita.length > 0) fichaSuspeita.push({ tenantId: l.tenant_id, loja: l.nome, itens: l.pratos.ficha_suspeita });
    if (l.pratos.pratos_com_ficha === 0) semFicha.push({ tenantId: l.tenant_id, loja: l.nome });
  }
  linhas.sort((a, b) => b.valor - a.valor);
  pratos.sort((a, b) => b.valor - a.valor);
  const total = Math.round(linhas.reduce((s, x) => s + x.valor, 0) * 100) / 100;
  return { total, linhas, pratos, pixConferir, risco, conferir, fichaSuspeita, semFicha };
}

const brl0 = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const brlCurto = brl0;

/** Manchete honesta: sem linha com valor, diz isso em vez de "R$ 0 que dava para evitar". */
export function manchete(total: number, qual: QualMes, mes: string, varias: boolean): { antes: string; valor: string | null; depois: string } {
  const quando = qual === 'atual' ? `${nomeDoMes(mes)[0].toUpperCase()}${nomeDoMes(mes).slice(1)} até agora` : `${nomeDoMes(mes)[0].toUpperCase()}${nomeDoMes(mes).slice(1)}`;
  const prefixo = varias ? `Somando as lojas, ${quando.toLowerCase()}` : quando;
  if (total <= 0) return { antes: `${prefixo}: nenhum vazamento medido`, valor: null, depois: '' };
  return { antes: `${prefixo}: `, valor: brl0(total), depois: ' que dava para evitar' };
}

/** As maiores linhas, para a frase curta (Hoje / assistente, mais adiante). */
export function maiores(r: VazResumo, n = 3): VazLinha[] { return r.linhas.slice(0, n); }

/** "dd/mm" de 'AAAA-MM-DD' */
export const ddmm = (ymd: string | null | undefined) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : '');
