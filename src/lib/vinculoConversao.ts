// Conversão do vínculo item de fornecedor → insumo do estoque ("1 <un da nota> = N <un do insumo>").
// Usado pela tela Financeiro › Classificação de Itens e pelo cartão de pendências do assistente.

export const un = (u: string | null | undefined) => (!u || u === 'unit' ? 'un' : u);
export const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
// Conversão do vínculo (dono, 2026-09-24): só vem pronta quando é óbvia — mesma unidade (1) ou kg↔g /
// L↔mL (1000). Unidade diferente (un → g, cx → un…) começa VAZIA e é obrigatória: o "1" pronto deixava
// passar "1 un = 1 g" e o custo da grama saía o preço do pé de alface.
const UNID: Record<string, string> = { unit: 'un', un: 'un', und: 'un', unid: 'un', unidade: 'un', pc: 'un', kg: 'kg', g: 'g', gr: 'g', l: 'l', lt: 'l', ml: 'ml' };
export const normUn = (u: string | null | undefined) => { const k = String(u ?? '').trim().toLowerCase().replace(/\.$/, ''); return UNID[k] ?? k; };
const METRICO: Record<string, string> = { 'kg>g': '1000', 'g>kg': '0,001', 'l>ml': '1000', 'ml>l': '0,001' };
export const mesmaUnidade = (item: string | null | undefined, insumo: string | null | undefined) => !normUn(item) || normUn(item) === normUn(insumo);
export const uppInicial = (item: string | null | undefined, insumo: string | null | undefined) =>
  mesmaUnidade(item, insumo) ? '1' : METRICO[`${normUn(item)}>${normUn(insumo)}`] ?? '';
// Conversão suspeita (dono, 2026-09-25) — AVISA, não trava: tem fornecedor que escreve "kg" e vende por
// unidade (alface do sacolão a R$ 1,99 o "kg" = o pé), então kg → g pode ser 300 de propósito.
// Casos reais que passaram: "1 KG = 15 kg" (batata, nota já em kg) e "1 un = 5000 kg" (açúcar 5 kg em gramas).
const PESO_VOL = new Set(['kg', 'g', 'l', 'ml']);
const LIMITE_POR_UN: Record<string, number> = { kg: 50, l: 50, g: 50000, ml: 50000, un: 1000 };
export const avisoConversao = (item: string | null | undefined, insumo: string | null | undefined, upp: number): string | null => {
  const i = normUn(item), g = normUn(insumo);
  const fixo = PESO_VOL.has(i) && PESO_VOL.has(g) ? (i === g ? 1 : Number((METRICO[`${i}>${g}`] ?? '').replace(',', '.')) || null) : null;
  if (fixo && Math.abs(upp - fixo) > 1e-9) {
    return `A nota vem em ${item} e o insumo é em ${un(insumo)}: o normal é 1 ${item} = ${num(fixo)} ${un(insumo)}. Você informou ${num(upp)}.\n\n`
      + `Só confirme se o fornecedor escreve ${item} mas vende de outro jeito (ex.: por pé ou por maço).`;
  }
  const limite = LIMITE_POR_UN[g];
  if (!fixo && limite && upp > limite) {
    return `1 ${item || 'un'} = ${num(upp)} ${un(insumo)}? Parece muito. Confira se não digitou em outra unidade (ex.: gramas num insumo em kg).`;
  }
  return null;
};
