// Abas da janela do item do cardápio (layout novo, 2026-10-06) e as regras puras usadas pelo Salvar.
// 8 abas antigas → 6 novas. Os nomes antigos continuam aceitos em `abaInicial` (ex.: ?item=&ficha=1 abre
// em 'ficha', que agora cai em "Como é feito").

export type AbaItem = 'basico' | 'feito' | 'opcoes' | 'promocoes' | 'observacoes' | 'avancado';
export type AbaAntiga = 'info' | 'producao' | 'ficha' | 'delivery' | 'fiscal';
export type TabLocal = AbaItem | AbaAntiga;

export const ABAS_ITEM: Array<{ id: AbaItem; rotulo: string }> = [
  { id: 'basico', rotulo: 'Básico' },
  { id: 'feito', rotulo: 'Como é feito' },
  { id: 'opcoes', rotulo: 'Opções' },
  { id: 'promocoes', rotulo: 'Promoções' },
  { id: 'observacoes', rotulo: 'Observações' },
  { id: 'avancado', rotulo: 'Avançado' },
];

const DE_PARA: Record<TabLocal, AbaItem> = {
  basico: 'basico', info: 'basico',
  feito: 'feito', producao: 'feito', ficha: 'feito',
  opcoes: 'opcoes',
  promocoes: 'promocoes',
  observacoes: 'observacoes',
  avancado: 'avancado', fiscal: 'avancado', delivery: 'avancado',
};

/** Aba nova para qualquer nome (novo ou antigo). Desconhecido/vazio → Básico. */
export function abaNova(t?: TabLocal | string | null): AbaItem {
  return (t && DE_PARA[t as TabLocal]) || 'basico';
}

export const semAcentoNome = (t: string) =>
  t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Outro item do cardápio (da mesma loja — a lista do contexto já é da loja ativa) com o mesmo nome. */
export function itemComMesmoNome<T extends { id: string; nome: string }>(nome: string, itens: T[], idAtual?: string): T | null {
  const alvo = semAcentoNome(nome);
  if (!alvo) return null;
  return itens.find((i) => i.id !== idAtual && semAcentoNome(i.nome ?? '') === alvo) ?? null;
}

export interface ErroItem { aba: AbaItem; texto: string; campo?: string }

/** Primeira regra quebrada, já com a aba onde o campo está. null = pode salvar. */
export function validarItem(d: {
  nome: string;
  preco: string;
  erroHorario: string | null;
  opcoesSemQuantidade: string[];
}): ErroItem | null {
  if (!d.nome.trim()) return { aba: 'basico', campo: 'item-nome', texto: 'Falta o nome do item.' };
  const p = String(d.preco ?? '').trim();
  if (!p) return { aba: 'basico', campo: 'item-preco', texto: 'Falta o preço do item.' };
  const n = parseFloat(p);
  if (!Number.isFinite(n) || n < 0) return { aba: 'basico', campo: 'item-preco', texto: 'O preço precisa ser um número (ex.: 29,90).' };
  if (d.erroHorario) return { aba: 'basico', campo: 'item-horario-cardapio', texto: `Horário no cardápio: ${d.erroHorario}` };
  if (d.opcoesSemQuantidade.length) {
    return { aba: 'opcoes', texto: `Informe quanto sai do estoque em: ${d.opcoesSemQuantidade.join(', ')}.` };
  }
  return null;
}
