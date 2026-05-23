export type UnidadeConversivel = 'kg' | 'g' | 'l' | 'ml' | 'un';

/** Alias map: converte variações de nomes para as unidades padronizadas */
const ALIAS_MAP: Record<string, string> = {
  kg: 'kg', kilo: 'kg', kilogram: 'kg', kilograma: 'kg',
  g: 'g', gram: 'g', grama: 'g', gramas: 'g',
  l: 'l', L: 'l', lt: 'l', litro: 'l', litros: 'l',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  un: 'un', unit: 'un', units: 'un', unidade: 'un', unidades: 'un',
};

function normalizeUnit(u: string): string {
  const trimmed = u.toLowerCase().trim();
  return ALIAS_MAP[trimmed] ?? trimmed;
}

const MASSA = new Set(['kg', 'g']);
const VOLUME = new Set(['l', 'ml']);
const UNIDADE = new Set(['un', 'unit']);

/** Retorna todas as unidades relacionadas do mesmo grupo (ex: kg → ['kg','g']) */
export function getRelatedUnits(unit: string): string[] {
  const u = normalizeUnit(unit);
  if (MASSA.has(u)) return ['kg', 'g'];
  if (VOLUME.has(u)) return ['l', 'ml'];
  return ['un'];
}

/** Converte quantidade de uma unidade para outra do mesmo grupo. Retorna null se incompatível. */
export function convertUnit(
  qty: number,
  from: string,
  to: string
): number | null {
  const f = normalizeUnit(from);
  const t = normalizeUnit(to);

  if (f === t) return qty;

  const isMassa = MASSA.has(f) && MASSA.has(t);
  const isVolume = VOLUME.has(f) && VOLUME.has(t);
  const isUnidade = UNIDADE.has(f) && UNIDADE.has(t);

  if (!isMassa && !isVolume && !isUnidade) return null;

  // normaliza para a base (kg ou l) depois converte para destino
  let base = qty;
  if (isMassa) {
    if (f === 'g') base = qty / 1000; // para kg
    // f==='kg' já está em base
    if (t === 'g') return base * 1000;
    return base; // t === 'kg'
  }

  if (isVolume) {
    if (f === 'ml') base = qty / 1000; // para l
    // f==='l' já está em base
    if (t === 'ml') return base * 1000;
    return base; // t === 'l'
  }

  return qty; // un → un
}

/** Verifica se duas unidades são do mesmo grupo (conversíveis entre si) */
export function sameUnitGroup(a: string, b: string): boolean {
  const ua = normalizeUnit(a);
  const ub = normalizeUnit(b);
  if (ua === ub) return true;
  return (
    (MASSA.has(ua) && MASSA.has(ub)) ||
    (VOLUME.has(ua) && VOLUME.has(ub)) ||
    (UNIDADE.has(ua) && UNIDADE.has(ub))
  );
}

/** Converte custo unitário de uma unidade para outra do mesmo grupo.
 *  Ex: R$34/kg → R$0,034/g  (divide por 1000)
 *  Ex: R$0,02/g → R$20/kg   (multiplica por 1000)
 */
export function convertUnitCost(
  cost: number,
  from: string,
  to: string
): number | null {
  // Quanto vale 1 unidade de DESTINO em unidades de ORIGEM?
  // Ex: 1g = 0,001kg → converted = 0,001
  //     cost/kg = 34 → cost/g = 34 * 0,001 = 0,034
  const converted = convertUnit(1, to, from);
  if (converted === null) return null;
  return cost * converted;
}

/** Converte uma quantidade da unidade da ficha técnica para a unidade do estoque,
 *  levando em conta o nome do item para buscar a ficha técnica correspondente.
 *  Retorna null se não houver conversão possível.
 */
export async function convertFichaToStockUnit(
  qty: number,
  fichaUnit: string,
  stockUnit: string,
): Promise<number | null> {
  // Tenta conversão direta entre unidades compatíveis
  const direct = convertUnit(qty, fichaUnit, stockUnit);
  if (direct !== null) return direct;

  // Se as unidades são incompatíveis, retorna null
  // (ex: 'un' vs 'kg' — não há como converter sem peso médio)
  return null;
}