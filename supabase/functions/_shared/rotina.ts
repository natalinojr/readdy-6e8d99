// Rotina do dia por loja e por papel (2026-10-03). Lógica pura, usada pela tela Hoje
// (src/pages/hoje/rotina/*) e pelo assistente-cron (bom dia da equipe) — mudou aqui, muda nos dois.
// Os dados vêm de fn_rotina_dados (supabase/migrations/20261003250000_rotina_do_dia.sql): itens, marcas e
// os FATOS que fazem um item marcar automático (loja aberta/fechada, recebimento, contagem, produção).
// Sem import de fora de _shared: roda no Deno e no Vite.
import { situacaoPlano, type PlanoContagem, type ItemContavel } from './estoque-planos.ts';

export type PapelRotina = 'gerente' | 'supervisao' | 'equipe' | 'caixa' | 'cozinha';
export type TipoRotina = 'manual' | 'abrir' | 'fechar' | 'contagem' | 'receber' | 'producao';

export interface ItemRotina {
  id: string;
  papel: PapelRotina;
  titulo: string;
  tipo: TipoRotina;
  /** 0 = domingo; null nos itens "só hoje" e na contagem pelos planos */
  dias: number[] | null;
  dias_plano: boolean;
  /** "Só hoje": o dia para o qual foi criado (não feito, segue aparecendo como "de ontem") */
  dia: string | null;
  /** 'HH:MM' */
  hora: string | null;
  atalho: string | null;
  receita_id: string | null;
  receita: string | null;
  quantidade: string | null;
  ordem: number;
  criado_em: string;
  criado_por_nome: string | null;
  producao: { quem: string | null; quando: string; qtd: number | null; unidade: string | null } | null;
}

export interface MarcaRotina {
  item_id: string;
  dia: string;
  feito_em: string;
  pessoa_nome: string;
  registrado_por: string;
  registrado_por_nome: string | null;
  freelancer: boolean;
}

interface Feito { quem: string | null; quando: string }
export interface PlanoDb { id: string; nome: string; frequencia: string; dia_semana: number | null; dia_mes: number | null; todos: boolean; itens: string[] | null; criado_em: string }
export interface FatosRotina {
  aberta: Feito | null;
  fechada: Feito | null;
  recebido: (Feito & { n: number; fornecedor: string | null }) | null;
  contagens: Feito[];
  planos: PlanoDb[];
}

export interface LojaRotina {
  tenant_id: string;
  loja: string;
  /** papel da pessoa na loja (null quando quem lê é o servidor) */
  papel: string | null;
  itens: ItemRotina[];
  marcas: MarcaRotina[];
  fatos: FatosRotina;
}

export interface DadosRotina { hoje: string; agora: string; dow: number; lojas: LojaRotina[] }

// ── Hierarquia: quem está acima vê e cria para quem está abaixo ──────────────────────────────────────
export const NIVEL: Record<string, number> = { admin: 4, gerente: 3, supervisao: 2, equipe: 1, caixa: 1, cozinha: 1, garcom: 1 };
export const nivel = (papel: string | null | undefined) => NIVEL[papel ?? ''] ?? 0;
export const PAPEIS_ROTINA: PapelRotina[] = ['gerente', 'supervisao', 'equipe', 'cozinha', 'caixa'];

/**
 * O que a pessoa FAZ (conta para o "Tudo em dia" dela). Login compartilhado (o celular da loja) faz
 * tudo da equipe, da cozinha e do caixa; login pessoal do caixa/cozinha faz o seu + o da equipe.
 */
export function papeisDaPessoa(papel: string | null | undefined, compartilhado = false): PapelRotina[] {
  if (papel === 'gerente') return ['gerente'];
  if (papel === 'supervisao') return ['supervisao'];
  if (nivel(papel) !== 1) return [];
  if (compartilhado) return ['equipe', 'cozinha', 'caixa'];
  if (papel === 'caixa') return ['equipe', 'caixa'];
  if (papel === 'cozinha') return ['equipe', 'cozinha'];
  return ['equipe'];
}

/** O que a pessoa só ACOMPANHA (e pode criar "tarefa de hoje"): tudo que está abaixo dela. */
export function papeisAbaixo(papel: string | null | undefined): PapelRotina[] {
  const n = nivel(papel);
  if (n < 2) return [];
  return PAPEIS_ROTINA.filter((p) => nivel(p) < n);
}

// ── Contagem pelos planos do Estoque (mesma regra do Estoque › Início) ──────────────────────────────
export interface ContagemRotina { aplica: boolean; feito: boolean; pendentes: number; planos: string[]; atrasoDias: number }

/** Planos com contagem para hoje (ou atrasada até 6 dias) e se já foram contados. */
export function contagemDaLoja(planosDb: PlanoDb[], insumos: ItemContavel[], hoje: string): ContagemRotina {
  const vale = planosDb.map((r) => {
    const plano: PlanoContagem = {
      id: r.id, nome: r.nome, frequencia: r.frequencia as PlanoContagem['frequencia'], diaSemana: r.dia_semana,
      diaMes: r.dia_mes, todos: r.todos, itens: r.itens ?? [], criadoEm: r.criado_em,
    };
    return situacaoPlano(plano, insumos, hoje);
  }).filter((s) => s.ocorrencia && (s.ocorrencia === hoje || (s.pendentes.length > 0 && s.atraso <= 6)));
  return {
    aplica: vale.length > 0,
    feito: vale.length > 0 && vale.every((s) => s.pendentes.length === 0),
    pendentes: vale.reduce((n, s) => n + s.pendentes.length, 0),
    planos: vale.map((s) => s.plano.nome),
    atrasoDias: vale.reduce((n, s) => Math.max(n, s.pendentes.length ? s.atraso : 0), 0),
  };
}

// ── Estado de cada item hoje ─────────────────────────────────────────────────────────────────────────
export interface EstadoItem {
  item: ItemRotina;
  feito: boolean;
  origem?: 'auto' | 'mao';
  /** quem fez (nome) */
  quem?: string | null;
  /** 'HH:MM' */
  quando?: string;
  /** detalhe do automático: fornecedor, "6 itens", "2,4 kg" */
  det?: string;
  /** marcado por outro login (ex.: o celular da loja marcou por um freelancer) */
  registradoPor?: string | null;
  freelancer?: boolean;
  /** tem horário e ainda não chegou: não segura o "Tudo em dia" */
  maisTarde: boolean;
  /** passou do horário (ou é "só hoje" de outro dia) sem fazer */
  atrasado: boolean;
  /** "só hoje" criado para um dia que já passou */
  deOntem: boolean;
  contagem?: ContagemRotina;
}

const hhmm = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const diaDe = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const qtdTxt = (n: number | null, u: string | null) => (n == null ? '' : `${String(Math.round(n * 100) / 100).replace('.', ',')}${u ? ` ${u}` : ''}`);

/** O que o sistema viu (ts = quando aconteceu). */
function automatico(item: ItemRotina, loja: LojaRotina, hoje: string, contagem?: ContagemRotina): { quem: string | null; ts: string | null; det?: string } | null {
  const f = loja.fatos;
  switch (item.tipo) {
    case 'abrir': return f.aberta ? { quem: f.aberta.quem, ts: f.aberta.quando } : null;
    case 'fechar': return f.fechada ? { quem: f.fechada.quem, ts: f.fechada.quando } : null;
    case 'receber':
      return f.recebido ? { quem: f.recebido.quem, ts: f.recebido.quando,
        det: [f.recebido.fornecedor, f.recebido.n > 1 ? `+${f.recebido.n - 1}` : ''].filter(Boolean).join(' ') || undefined } : null;
    case 'contagem': {
      if (item.dias_plano) {
        if (!contagem?.feito) return null;
        const ultima = f.contagens[0];
        return { quem: ultima?.quem ?? null, ts: ultima?.quando ?? null, det: contagem.planos.join(' e ') || undefined };
      }
      const deHoje = f.contagens.find((c) => diaDe(c.quando) === hoje);
      return deHoje ? { quem: deHoje.quem, ts: deHoje.quando } : null;
    }
    case 'producao':
      return item.producao ? { quem: item.producao.quem, ts: item.producao.quando, det: qtdTxt(item.producao.qtd, item.producao.unidade) || undefined } : null;
    default: return null;
  }
}

/**
 * Estado do item hoje, ou null quando ele não vale hoje (outro dia da semana, sem contagem programada,
 * "só hoje" de outro dia que já foi feito).
 * `contagem` = contagemDaLoja(...) — só precisa quando a loja tem item de contagem pelos planos.
 */
export function estadoDoItem(item: ItemRotina, loja: LojaRotina, ctx: { hoje: string; agora: string; dow: number; contagem?: ContagemRotina }): EstadoItem | null {
  const { hoje, agora, dow } = ctx;
  let deOntem = false;
  if (item.dia) {
    if (item.dia > hoje) return null;
    deOntem = item.dia < hoje;
  } else if (item.dias_plano) {
    if (!ctx.contagem?.aplica) return null;
  } else if (!(item.dias ?? []).includes(dow)) {
    return null;
  }

  const auto = automatico(item, loja, hoje, ctx.contagem);
  const marca = loja.marcas.find((m) => m.item_id === item.id && (item.dia ? true : m.dia === hoje));
  const base = { item, deOntem, contagem: item.tipo === 'contagem' ? ctx.contagem : undefined };
  if (auto) {
    // "Só hoje" de um dia que passou e que já foi feito antes de hoje: sai da lista.
    if (deOntem && auto.ts && diaDe(auto.ts) < hoje) return null;
    return { ...base, feito: true, origem: 'auto', quem: auto.quem, quando: auto.ts ? hhmm(auto.ts) : undefined, det: auto.det, maisTarde: false, atrasado: false };
  }
  if (marca) {
    // "Só hoje" feito num dia que já passou: sai da lista.
    if (deOntem && marca.dia < hoje) return null;
    const outro = marca.registrado_por_nome && marca.registrado_por_nome !== marca.pessoa_nome ? marca.registrado_por_nome : null;
    return { ...base, feito: true, origem: 'mao', quem: marca.pessoa_nome, quando: hhmm(marca.feito_em), registradoPor: outro, freelancer: marca.freelancer, maisTarde: false, atrasado: false };
  }
  const maisTarde = !deOntem && !!item.hora && agora < item.hora;
  const atrasado = deOntem || (!!item.hora && agora >= item.hora);
  return { ...base, feito: false, maisTarde, atrasado };
}

/** Itens de hoje dos papéis pedidos, na ordem da rotina (o que se repete antes, "só hoje" depois). */
export function rotinaDeHoje(loja: LojaRotina, papeis: PapelRotina[], ctx: { hoje: string; agora: string; dow: number; contagem?: ContagemRotina }): EstadoItem[] {
  const ordemPapel = (p: PapelRotina) => papeis.indexOf(p);
  return loja.itens
    .filter((i) => papeis.includes(i.papel))
    .sort((a, b) => ordemPapel(a.papel) - ordemPapel(b.papel) || Number(!!a.dia) - Number(!!b.dia) || a.ordem - b.ordem || a.criado_em.localeCompare(b.criado_em))
    .map((i) => estadoDoItem(i, loja, ctx))
    .filter((e): e is EstadoItem => !!e);
}

export interface ResumoRotina { total: number; feitos: number; pendentes: number; maisTarde: EstadoItem[] }
/** "Pendentes" = o que já chegou a hora e falta (é o que segura o "Tudo em dia"). */
export function resumoRotina(estados: EstadoItem[]): ResumoRotina {
  return {
    total: estados.length,
    feitos: estados.filter((e) => e.feito).length,
    pendentes: estados.filter((e) => !e.feito && !e.maisTarde).length,
    maisTarde: estados.filter((e) => !e.feito && e.maisTarde).sort((a, b) => (a.item.hora ?? '').localeCompare(b.item.hora ?? '')),
  };
}

/** Lojas que precisam da situação do estoque (contagem pelos planos) para decidir a rotina. */
export const precisaSituacao = (loja: LojaRotina) => loja.fatos.planos.length > 0 && loja.itens.some((i) => i.tipo === 'contagem' && i.dias_plano);

/** Insumos de fn_estoque_situacao no formato dos planos de contagem. */
// deno-lint-ignore no-explicit-any
export const insumosDaSituacao = (sit: any): ItemContavel[] => ((sit?.insumos ?? []) as any[]).map((r) => ({
  id: String(r.id), contaInventario: r.conta_inventario !== false, ultimaContagem: r.ultima_contagem ? String(r.ultima_contagem) : null,
}));
