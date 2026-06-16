import type { PromocaoItem } from '@/types/cardapio';

/**
 * Retorna a promoção do item que está VÁLIDA HOJE (ou null).
 *
 * Antes o cardápio público considerava qualquer promoção com `ativo === true`,
 * ignorando o dia da semana (tipo 'semanal') e a data específica (tipo 'pontual').
 * Isso fazia uma promoção de sexta, por exemplo, aparecer todos os dias.
 *
 * Regras:
 * - precisa estar `ativo`;
 * - 'semanal': vale se `diasSemana` inclui o dia de hoje (0=Dom..6=Sáb); lista
 *   vazia/ausente = todos os dias;
 * - 'pontual': vale se `dataEspecifica` é a data de hoje (YYYY-MM-DD, horário local).
 *
 * Quando houver mais de uma válida, escolhe a de menor preço promocional.
 */
export function promoAtivaHoje(promocoes: PromocaoItem[] | undefined | null, agora: Date = new Date()): PromocaoItem | null {
  if (!promocoes || promocoes.length === 0) return null;

  const diaSemana = agora.getDay();
  const hojeISO = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;

  const validas = promocoes.filter((p) => {
    if (!p.ativo) return false;
    if (p.tipo === 'pontual') {
      return !!p.dataEspecifica && p.dataEspecifica.slice(0, 10) === hojeISO;
    }
    // 'semanal' (ou tipo ausente): sem dias = todos os dias
    if (!p.diasSemana || p.diasSemana.length === 0) return true;
    return p.diasSemana.includes(diaSemana);
  });

  if (validas.length === 0) return null;
  return validas.reduce((menor, p) => (p.precoPromocional < menor.precoPromocional ? p : menor), validas[0]);
}

/** Promoção no formato cru do backend (cardápio do cliente: delivery / mesa-qr). */
export interface RawPromotion {
  id: string;
  item_id: string;
  promotional_price: number;
  days_of_week: number[] | null;
  is_recurring: boolean;
  specific_date: string | null;
  is_active: boolean;
}

/**
 * Versão de [promoAtivaHoje] para o formato cru (`is_active` + `days_of_week` +
 * `specific_date`) usado nos cardápios do cliente. Antes esses cardápios só
 * checavam `is_active`, ignorando dia/data.
 */
export function rawPromoAtivaHoje(promotions: RawPromotion[] | undefined | null, agora: Date = new Date()): RawPromotion | null {
  if (!promotions || promotions.length === 0) return null;

  const diaSemana = agora.getDay();
  const hojeISO = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;

  const validas = promotions.filter((p) => {
    if (!p.is_active) return false;
    // Pontual: tem data específica e NÃO é recorrente → vale só na data.
    if (p.specific_date && !p.is_recurring) {
      return p.specific_date.slice(0, 10) === hojeISO;
    }
    // Recorrente/semanal: sem dias = todos os dias.
    if (!p.days_of_week || p.days_of_week.length === 0) return true;
    return p.days_of_week.includes(diaSemana);
  });

  if (validas.length === 0) return null;
  return validas.reduce((menor, p) => (p.promotional_price < menor.promotional_price ? p : menor), validas[0]);
}
