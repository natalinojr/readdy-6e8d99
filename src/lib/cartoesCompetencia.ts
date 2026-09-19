import { supabase } from '@/lib/supabase';

// DRE no regime de COMPETÊNCIA: Stone e iFood pela data da VENDA.
// O razão (fin_cash_flow) lança os dois pela data do REPASSE (regime de caixa). Na competência a DRE tira
// do razão as vendas e a taxa da venda (Stone: vendas + MDR; iFood: comissões e taxas — as vendas do iFood
// nem entram pelo razão na competência) e soma os valores por data da venda de fn_dre_competencia_cartoes.
// A conta é no banco (SECURITY DEFINER, confere a loja): o front não lê fin_bank_statement_imports nem
// fin_ifood_config. Antecipação, tarifas e chargebacks continuam no razão pela data do repasse.

/** Linha do razão com as vendas da Stone do dia do repasse (troca pela soma por data da venda). */
export const isStoneVendasLedger = (descricao: string | null | undefined) => /^Vendas em cartão liquidadas pela Stone/i.test(descricao ?? '');
/** Linha do razão com o MDR da Stone do dia do repasse (troca pelo MDR por data da venda). */
export const isStoneMdrLedger = (descricao: string | null | undefined) => /^Taxa Stone \(MDR\)/i.test(descricao ?? '');

export interface CartoesCompetencia {
  stone_bruto: number;
  stone_mdr: number;
  ifood_receita: number;
  ifood_custo: number;
}

const ZERO: CartoesCompetencia = { stone_bruto: 0, stone_mdr: 0, ifood_receita: 0, ifood_custo: 0 };

export async function fetchCartoesCompetencia(tenantId: string, startDate: string, endDate: string): Promise<CartoesCompetencia> {
  const { data, error } = await supabase.rpc('fn_dre_competencia_cartoes', { p_tenant: tenantId, p_from: startDate, p_to: endDate });
  if (error || !data) {
    if (error) console.error('[DRE] Competência Stone/iFood:', error.message);
    return ZERO;
  }
  const d = data as Partial<Record<keyof CartoesCompetencia, number | string>>;
  return {
    stone_bruto: Number(d.stone_bruto ?? 0),
    stone_mdr: Number(d.stone_mdr ?? 0),
    ifood_receita: Number(d.ifood_receita ?? 0),
    ifood_custo: Number(d.ifood_custo ?? 0),
  };
}
