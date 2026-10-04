// Regras puras do CMV (Estoque › Custo › CMV e fichas) — layout aprovado em 2026-10-04.
// "CMV" em português do dia a dia: quanto do preço de venda vai em ingrediente.
//
// Fonte dos números: RPC fn_get_cmv_report (custo gravado na venda, trata combos). Aqui só a conta em cima
// do que ela devolve, para a tela e os testes usarem a MESMA base (cartões, tabela, rodapé, CSV, gráfico).
//
// Regra do dono: o CMV só vale para os pratos COM ficha técnica. Prato sem ficha não tem custo conhecido;
// entrar como "custo zero" baixava a média e fazia o CMV parecer melhor do que é.

/** Só administrador e gerente aplicam fichas nas vendas passadas — o backend confere de novo. */
export const podeAplicarFichas = (perfil: unknown) => ['admin', 'gerente'].includes(String(perfil));

// ── Régua de cores (uma só, em toda a tela) ─────────────────────────────────────────
export const CMV_BOM_ATE = 30;
export const CMV_ATENCAO_ATE = 35;
export type FaixaCmv = 'bom' | 'atencao' | 'revisar';

/** Até 30% bom (verde) · 30–35% atenção (âmbar) · acima de 35% revisar (vermelho). Compara como aparece na tela (1 casa). */
export function faixaCmv(pct: number): FaixaCmv {
  const p = Math.round(pct * 10) / 10;
  if (p <= CMV_BOM_ATE) return 'bom';
  if (p <= CMV_ATENCAO_ATE) return 'atencao';
  return 'revisar';
}

// ── Linhas do relatório ─────────────────────────────────────────────────────────────
export interface LinhaCmv {
  /** Chave estável só dentro de uma leitura (o mesmo nome pode aparecer em mais de uma linha). */
  chave: string;
  item_name: string;
  /** id do item do cardápio (fn_get_cmv_report devolve desde 2026-10-04); null em combo ou item apagado */
  item_id?: string | null;
  categoria: string;
  qtd_vendida: number;
  receita_total: number;
  custo_total: number;
  /** custo ÷ receita (0 se sem ficha: não há custo conhecido) */
  cmv_pct: number;
  /** receita − custo (só vale com ficha) */
  margem_bruta: number;
  margem_pct: number;
  tem_ficha: boolean;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Converte a resposta de fn_get_cmv_report em linhas. Resposta fora do formato é erro (nunca "sem vendas"). */
export function linhasDoRelatorio(raw: unknown): LinhaCmv[] {
  const por = (raw as { por_item?: unknown } | null)?.por_item;
  if (!Array.isArray(por)) throw new Error('Resposta inesperada do relatório de CMV');
  return por.map((r, i) => {
    const o = r as Record<string, unknown>;
    const receita = num(o.receita_total);
    const custo = num(o.custo_total);
    const temFicha = o.tem_ficha_tecnica === true;
    const margem = receita - custo;
    return {
      chave: `${i}|${String(o.item_name ?? '')}`,
      item_name: String(o.item_name ?? 'Item'),
      item_id: typeof o.item_id === 'string' ? o.item_id : null,
      categoria: String(o.category_name ?? ''),
      qtd_vendida: num(o.total_qty),
      receita_total: receita,
      custo_total: custo,
      cmv_pct: temFicha && receita > 0 ? (custo / receita) * 100 : 0,
      margem_bruta: margem,
      margem_pct: receita > 0 ? (margem / receita) * 100 : 0,
      tem_ficha: temFicha,
    };
  });
}

export interface ResumoCmv {
  /** pratos vendidos (linhas) */
  pratos: number;
  comFicha: number;
  semFicha: number;
  receitaTotal: number;
  receitaComFicha: number;
  receitaSemFicha: number;
  qtdComFicha: number;
  qtdSemFicha: number;
  custoComFicha: number;
  /** custo ÷ receita dos pratos COM ficha; null quando não vendeu nenhum com ficha */
  cmvPct: number | null;
  /** receita − custo, só dos pratos com ficha */
  margemComFicha: number;
  margemPct: number | null;
  /** quanto da venda (em R$) é de prato com ficha; null sem venda */
  coberturaReceitaPct: number | null;
}

export function resumoCmv(linhas: LinhaCmv[]): ResumoCmv {
  let receitaComFicha = 0, receitaSemFicha = 0, custoComFicha = 0, qtdComFicha = 0, qtdSemFicha = 0, comFicha = 0, semFicha = 0;
  for (const l of linhas) {
    if (l.tem_ficha) {
      comFicha++; receitaComFicha += l.receita_total; custoComFicha += l.custo_total; qtdComFicha += l.qtd_vendida;
    } else {
      semFicha++; receitaSemFicha += l.receita_total; qtdSemFicha += l.qtd_vendida;
    }
  }
  const receitaTotal = receitaComFicha + receitaSemFicha;
  return {
    pratos: linhas.length, comFicha, semFicha,
    receitaTotal, receitaComFicha, receitaSemFicha, qtdComFicha, qtdSemFicha, custoComFicha,
    cmvPct: receitaComFicha > 0 ? (custoComFicha / receitaComFicha) * 100 : null,
    margemComFicha: receitaComFicha - custoComFicha,
    margemPct: receitaComFicha > 0 ? ((receitaComFicha - custoComFicha) / receitaComFicha) * 100 : null,
    coberturaReceitaPct: receitaTotal > 0 ? (receitaComFicha / receitaTotal) * 100 : null,
  };
}

/** Abaixo disto o aviso "falta ficha" aparece no topo. */
export const COBERTURA_MINIMA_PCT = 80;

/** Manchete do aviso: "Metade do que vocês vendem não tem ficha" perto de 50%; senão com a porcentagem. */
export function tituloSemFicha(coberturaReceitaPct: number, fraseDoPeriodo: string): string {
  const sem = 100 - coberturaReceitaPct;
  if (Math.abs(sem - 50) <= 5) return 'Metade do que vocês vendem não tem ficha';
  return `${Math.round(sem)}% do que vocês venderam ${fraseDoPeriodo} não tem ficha`;
}

/** Os pratos sem ficha que mais vendem (por R$), para "Fazer ficha". */
export function semFichaQueMaisVendem(linhas: LinhaCmv[], n = 4): LinhaCmv[] {
  return linhas
    .filter((l) => !l.tem_ficha && l.qtd_vendida > 0)
    .sort((a, b) => b.receita_total - a.receita_total || b.qtd_vendida - a.qtd_vendida)
    .slice(0, n);
}

// ── Ficha para conferir ─────────────────────────────────────────────────────────────
export type MotivoConferir = 'custo_maior' | 'custo_zero' | 'cmv_alto';
export const CMV_CONFERIR_ACIMA = 50;
export interface FichaParaConferir { linha: LinhaCmv; motivo: MotivoConferir }

const RANK_MOTIVO: Record<MotivoConferir, number> = { custo_maior: 0, custo_zero: 1, cmv_alto: 2 };

/** Prato com ficha e custo estranho: custo maior que o preço, custo zero (insumo sem preço) ou CMV acima de 50%. */
export function fichasParaConferir(linhas: LinhaCmv[]): FichaParaConferir[] {
  const out: FichaParaConferir[] = [];
  for (const l of linhas) {
    if (!l.tem_ficha || l.qtd_vendida <= 0 || l.receita_total <= 0) continue; // brinde (preço 0) não entra
    let motivo: MotivoConferir | null = null;
    if (l.custo_total > l.receita_total) motivo = 'custo_maior';
    else if (l.custo_total < 0.005) motivo = 'custo_zero';
    else if (l.cmv_pct > CMV_CONFERIR_ACIMA) motivo = 'cmv_alto';
    if (motivo) out.push({ linha: l, motivo });
  }
  return out.sort((a, b) => RANK_MOTIVO[a.motivo] - RANK_MOTIVO[b.motivo] || b.linha.receita_total - a.linha.receita_total);
}

// ── Ordenação (prato sem ficha nunca vai para o topo de CMV/margem) ──────────────────
export type OrdenacaoCmv = 'cmv_desc' | 'cmv_asc' | 'margem_desc' | 'receita_desc' | 'nome';
export interface Ordenavel { nome: string; temFicha: boolean; cmvPct: number; margemPct: number; receita: number }

export function ordenarPor<T>(lista: T[], ordenacao: OrdenacaoCmv, ler: (t: T) => Ordenavel): T[] {
  return [...lista].sort((a, b) => {
    const x = ler(a), y = ler(b);
    if (ordenacao === 'receita_desc') return y.receita - x.receita;
    if (ordenacao === 'nome') return x.nome.localeCompare(y.nome, 'pt-BR');
    // CMV e margem só existem com ficha: quem não tem vai para o fim, em qualquer sentido
    if (x.temFicha !== y.temFicha) return x.temFicha ? -1 : 1;
    if (ordenacao === 'cmv_desc') return y.cmvPct - x.cmvPct;
    if (ordenacao === 'cmv_asc') return x.cmvPct - y.cmvPct;
    return y.margemPct - x.margemPct;
  });
}

export const lerLinhaCmv = (l: LinhaCmv): Ordenavel => ({
  nome: l.item_name, temFicha: l.tem_ficha, cmvPct: l.cmv_pct, margemPct: l.margem_pct, receita: l.receita_total,
});

// ── Texto do período ────────────────────────────────────────────────────────────────
export interface DescricaoPeriodo {
  /** "nos últimos 30 dias" — para completar frase */
  frase: string;
  /** "CMV dos últimos 30 dias" */
  titulo: string;
  dias: number;
}

const diaMes = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
export function diasEntre(de: string, ate: string): number {
  const ms = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.max(1, Math.round((ms(ate) - ms(de)) / 86_400_000) + 1);
}

/** `de`/`ate` = datas AAAA-MM-DD do período (as mesmas que foram para o banco). */
export function descreverPeriodo(periodo: string, de: string, ate: string): DescricaoPeriodo {
  const dias = diasEntre(de, ate);
  if (periodo.startsWith('custom:')) {
    return de === ate
      ? { frase: `em ${diaMes(de)}`, titulo: `CMV de ${diaMes(de)}`, dias }
      : { frase: `de ${diaMes(de)} a ${diaMes(ate)}`, titulo: `CMV de ${diaMes(de)} a ${diaMes(ate)}`, dias };
  }
  switch (periodo) {
    case 'Hoje': return { frase: 'hoje', titulo: 'CMV de hoje', dias };
    case 'Mês': return { frase: 'neste mês', titulo: 'CMV deste mês', dias };
    case '3m': return { frase: 'nos últimos 3 meses', titulo: 'CMV dos últimos 3 meses', dias };
    default: return { frase: `nos últimos ${dias} dias`, titulo: `CMV dos últimos ${dias} dias`, dias };
  }
}

// ── Link "Fazer ficha" / "Abrir ficha" (Cardápio) ───────────────────────────────────
export const normalizarNome = (t: string) =>
  t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface ItemCardapioRef { id: string; nome: string; categoria: string; ativo: boolean }

/**
 * Para onde ir fazer/conferir a ficha de um prato vendido. O relatório só traz o nome, então a ligação é
 * pelo nome (e pela categoria quando há dois iguais). Achou o item → abre o item na ficha técnica;
 * é um combo → abre os combos; senão → abre a lista de itens já com a busca preenchida.
 */
export function rotaDaFicha(nome: string, categoria: string, itens: ItemCardapioRef[], combos: string[], itemId?: string | null): string {
  // Com o id do relatório, vai direto (o nome pode ter mudado depois da venda).
  if (itemId && itens.some((i) => i.id === itemId)) return `/cardapio?item=${encodeURIComponent(itemId)}&ficha=1`;
  const alvo = normalizarNome(nome);
  const cat = normalizarNome(categoria);
  const iguais = itens.filter((i) => normalizarNome(i.nome) === alvo);
  if (iguais.length) {
    const pontos = (i: ItemCardapioRef) => (normalizarNome(i.categoria) === cat ? 2 : 0) + (i.ativo ? 1 : 0);
    const melhor = [...iguais].sort((a, b) => pontos(b) - pontos(a))[0];
    return `/cardapio?item=${encodeURIComponent(melhor.id)}&ficha=1`;
  }
  if (combos.some((c) => normalizarNome(c) === alvo)) return '/cardapio?aba=combos';
  return `/cardapio?busca=${encodeURIComponent(nome)}`;
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────
const numBR = (v: number, casas = 2) => v.toFixed(casas).replace('.', ',');
const qtdBR = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '').replace('.', ','));
/** Campo entre aspas; texto que começa com = + - @ ganha um apóstrofo (o Excel não executa como fórmula). */
const campoCsv = (v: string | number, texto = false) => {
  let s = String(v);
  if (texto && /^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * CSV com `;`, campos entre aspas e vírgula decimal (o Excel brasileiro abre direto). Leva TODAS as linhas do
 * período e o mesmo rodapé da tela: o total é dos pratos com ficha, com os sem ficha numa linha à parte.
 */
export function montarCsvCmv(linhas: LinhaCmv[], r: ResumoCmv): string {
  const cab = ['Item', 'Categoria', 'Qtd vendida', 'Receita (R$)', 'Custo total (R$)', 'CMV %', 'Margem R$', 'Margem %', 'Tem ficha'];
  const corpo = linhas.map((l) => [
    campoCsv(l.item_name, true),
    campoCsv(l.categoria, true),
    campoCsv(qtdBR(l.qtd_vendida)),
    campoCsv(numBR(l.receita_total)),
    // sem ficha não há custo conhecido: fica em branco (igual ao "—" da tela)
    campoCsv(l.tem_ficha ? numBR(l.custo_total) : ''),
    campoCsv(l.tem_ficha ? numBR(l.cmv_pct, 1) : ''),
    campoCsv(l.tem_ficha ? numBR(l.margem_bruta) : ''),
    campoCsv(l.tem_ficha ? numBR(l.margem_pct, 1) : ''),
    campoCsv(l.tem_ficha ? 'Sim' : 'Não'),
  ]);
  const total = [
    campoCsv('TOTAL (pratos com ficha)'), campoCsv(''), campoCsv(qtdBR(r.qtdComFicha)),
    campoCsv(numBR(r.receitaComFicha)), campoCsv(numBR(r.custoComFicha)),
    campoCsv(r.cmvPct == null ? '' : numBR(r.cmvPct, 1)),
    campoCsv(numBR(r.margemComFicha)), campoCsv(r.margemPct == null ? '' : numBR(r.margemPct, 1)), campoCsv(''),
  ];
  const semFicha = [
    campoCsv('SEM FICHA (fora do CMV)'), campoCsv(''), campoCsv(qtdBR(r.qtdSemFicha)),
    campoCsv(numBR(r.receitaSemFicha)), campoCsv(''), campoCsv(''), campoCsv(''), campoCsv(''), campoCsv(''),
  ];
  return [cab.map((c) => campoCsv(c)), ...corpo, total, semFicha].map((l) => l.join(';')).join('\r\n');
}

// ── Gráfico dos últimos 12 meses ────────────────────────────────────────────────────
export interface PontoMensal {
  /** AAAA-MM */
  mes: string;
  /** CMV dos pratos com ficha; null se o mês não vendeu prato com ficha */
  cmv_pct: number | null;
  receitaComFicha: number;
  custoComFicha: number;
  receitaTotal: number;
  coberturaPct: number | null;
}

/** Os 12 meses que terminam no mês de `hojeYmd` (AAAA-MM-DD, Brasília), do mais antigo ao atual. */
export function mesesDosUltimos12(hojeYmd: string): string[] {
  const y = Number(hojeYmd.slice(0, 4));
  const m = Number(hojeYmd.slice(5, 7));
  const out: string[] = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Limites do mês em Brasília (-03:00) para o banco. */
export function limitesDoMes(mes: string): { from: string; to: string } {
  const y = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${mes}-01T00:00:00-03:00`, to: `${mes}-${String(ultimo).padStart(2, '0')}T23:59:59-03:00` };
}

export function pontoMensal(mes: string, linhas: LinhaCmv[]): PontoMensal {
  const r = resumoCmv(linhas);
  return {
    mes, cmv_pct: r.cmvPct, receitaComFicha: r.receitaComFicha, custoComFicha: r.custoComFicha,
    receitaTotal: r.receitaTotal, coberturaPct: r.coberturaReceitaPct,
  };
}

/** Mudança do primeiro ao último mês com CMV e a média ponderada (custo total ÷ venda total dos pratos com ficha). */
export function evolucaoMensal(pontos: PontoMensal[]): { deltaPp: number | null; mediaPct: number | null } {
  const validos = pontos.filter((p) => p.cmv_pct != null);
  const receita = validos.reduce((s, p) => s + p.receitaComFicha, 0);
  const custo = validos.reduce((s, p) => s + p.custoComFicha, 0);
  return {
    deltaPp: validos.length >= 2 ? (validos[validos.length - 1].cmv_pct as number) - (validos[0].cmv_pct as number) : null,
    mediaPct: receita > 0 ? (custo / receita) * 100 : null,
  };
}
