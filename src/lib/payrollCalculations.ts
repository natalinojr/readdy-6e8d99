// ─── Cálculos de Folha de Pagamento (CLT Brasil) ──────────────────────────────

// INSS 2025/2026 — alíquotas progressivas
const INSS_FAIXAS = [
  { ate: 1518.00, aliquota: 0.075, deducao: 0 },
  { ate: 2793.88, aliquota: 0.09,  deducao: 22.77 },
  { ate: 4190.26, aliquota: 0.12,  deducao: 106.59 },
  { ate: 8157.41, aliquota: 0.14,  deducao: 190.40 },
];

export function calcINSS(salarioBruto: number): number {
  const base = Math.min(salarioBruto, 8157.41);
  for (const faixa of INSS_FAIXAS) {
    if (base <= faixa.ate) {
      return Math.round((base * faixa.aliquota - faixa.deducao) * 100) / 100;
    }
  }
  return Math.round((base * 0.14 - 190.40) * 100) / 100;
}

// IRRF 2025/2026 — alíquotas progressivas (base = bruto - INSS - dependentes)
const IRRF_FAIXAS = [
  { ate: 2259.20, aliquota: 0,    deducao: 0 },
  { ate: 2826.65, aliquota: 0.075, deducao: 169.44 },
  { ate: 3751.05, aliquota: 0.15,  deducao: 381.44 },
  { ate: 4664.68, aliquota: 0.225, deducao: 662.77 },
  { ate: Infinity, aliquota: 0.275, deducao: 896.00 },
];

const DEDUCAO_POR_DEPENDENTE = 224.63;

export function calcIRRF(baseIRRF: number, dependentes = 0): number {
  const base = Math.max(0, baseIRRF - (dependentes * DEDUCAO_POR_DEPENDENTE));
  for (const faixa of IRRF_FAIXAS) {
    if (base <= faixa.ate) {
      const valor = base * faixa.aliquota - faixa.deducao;
      return Math.max(0, Math.round(valor * 100) / 100);
    }
  }
  return 0;
}

// FGTS = 8% do salário bruto
export function calcFGTS(salarioBruto: number): number {
  return Math.round(salarioBruto * 0.08 * 100) / 100;
}

// DSR (Descanso Semanal Remunerado) sobre horas extras
// Fórmula: (total HE / dias úteis) * dias de descanso
// Considerando 26 dias úteis e 4 domingos/feriados no mês = fator ~0.1538
const DSR_FACTOR = 4 / 26; // ~0.1538

export function calcDSR(overtimeTotal: number): number {
  return Math.round(overtimeTotal * DSR_FACTOR * 100) / 100;
}

// DSR com reflexo de faltas — se faltou, perde DSR proporcional
// Faltas inteiras: perde DSR integral do dia (1/6 da semana)
// Horas faltantes: perde DSR proporcional às horas
export function calcDSRComFaltas(
  overtimeTotal: number,
  diasFaltas: number,
  horasFaltantes: number,
  salarioBase: number,
): { dsrBruto: number; dsrDesconto: number; dsrLiquido: number } {
  const dsrBruto = calcDSR(overtimeTotal);

  // Desconto DSR por dias faltosos: 1 dia de DSR = 1/6 da semana = ~16.67%
  // Em um mês: 4 semanas = 4 DSRs. Cada DSR = salarioBase / 30 * (7/6) aprox
  // Simplificação: desconto DSR por dia = salarioBase / 30 * DSR_FACTOR * (30/4) = salarioBase / 4 * DSR_FACTOR
  const dsrPorDia = (salarioBase / 30) * DSR_FACTOR * (30 / 4); // ~salarioBase * 0.0385
  const descontoDias = diasFaltas * dsrPorDia;

  // Desconto DSR por horas faltantes: proporcional às horas
  const valorHora = salarioBase / 220;
  const descontoHoras = horasFaltantes * valorHora * DSR_FACTOR;

  const dsrDesconto = Math.round((descontoDias + descontoHoras) * 100) / 100;
  const dsrLiquido = Math.max(0, dsrBruto - dsrDesconto);

  return { dsrBruto, dsrDesconto, dsrLiquido };
}

// Hora Extra com percentual customizado (ex: 60%, 50%, 100%)
// Valor = (salarioBase / 220) * (1 + percentual/100) * horas
export function calcOvertime(salarioBase: number, horas: number, percentual: number): number {
  const valorHora = salarioBase / 220;
  const fator = 1 + percentual / 100;
  return Math.round(valorHora * fator * horas * 100) / 100;
}

// Hora Extra 100% (domingo/feriado)
// Valor = (salarioBase / 220) * 2.0 * horas
export function calcOvertime100(salarioBase: number, horas: number): number {
  const valorHora = salarioBase / 220;
  return Math.round(valorHora * 2.0 * horas * 100) / 100;
}

// Hora Extra Noturna (22h às 5h)
// Adicional noturno = 20% sobre a hora normal
// HE noturna = (salarioBase / 220) * (1 + percentual/100) * 1.2 * horas
// Ex: HE 50% noturna = valorHora * 1.5 * 1.2 = valorHora * 1.8
export function calcOvertimeNight(
  salarioBase: number,
  horas: number,
  percentual: number,
): number {
  const valorHora = salarioBase / 220;
  const fatorHE = 1 + percentual / 100;
  const fatorNoturno = 1.2; // 20% adicional noturno
  return Math.round(valorHora * fatorHE * fatorNoturno * horas * 100) / 100;
}

// Adicional Noturno (horas noturnas sem ser HE)
// Valor = (salarioBase / 220) * 0.2 * horasNoturnas
export function calcNightShift(salarioBase: number, horasNoturnas: number): number {
  const valorHora = salarioBase / 220;
  return Math.round(valorHora * 0.2 * horasNoturnas * 100) / 100;
}

// Vale Transporte — 6% do salário base (desconto do funcionário)
// Ou valor customizado se informado
export function calcValeTransporte(salarioBase: number, usaVT = true, valorCustomizado?: number): number {
  if (!usaVT) return 0;
  if (valorCustomizado !== undefined && valorCustomizado > 0) {
    return Math.round(valorCustomizado * 100) / 100;
  }
  return Math.round(salarioBase * 0.06 * 100) / 100;
}

// Desconto por faltas/horas faltantes — SEPARADOS
// Faltas: (salário / 30) * dias_faltas
// Horas faltantes: (salário / 220) * horas_faltantes
export function calcDescontoFaltas(
  salarioBase: number,
  diasFaltas = 0,
  horasFaltantes = 0,
): { descontoDias: number; descontoHoras: number; total: number } {
  const descontoDias = diasFaltas > 0
    ? Math.round((salarioBase / 30) * diasFaltas * 100) / 100
    : 0;
  const descontoHoras = horasFaltantes > 0
    ? Math.round((salarioBase / 220) * horasFaltantes * 100) / 100
    : 0;
  return {
    descontoDias,
    descontoHoras,
    total: descontoDias + descontoHoras,
  };
}

// ─── Campos customizáveis ────────────────────────────────────────────────────
export interface CustomField {
  id: string;
  name: string;
  type: 'provento' | 'desconto';
  formula?: string; // ex: "base * 0.10", "fixed:500"
  is_percentage?: boolean;
  percentage_of?: string; // ex: "base_salary", "total_proventos"
  fixed_value?: number;
  is_active: boolean;
}

export interface CustomFieldValue {
  field_id: string;
  name: string;
  type: 'provento' | 'desconto';
  value: number;
}

// Avalia fórmula simples
export function evaluateFormula(
  formula: string,
  context: Record<string, number>,
): number {
  if (!formula) return 0;

  // Fórmula fixa: "fixed:500"
  if (formula.startsWith('fixed:')) {
    return parseFloat(formula.replace('fixed:', '')) || 0;
  }

  // Substitui variáveis
  let expr = formula;
  Object.entries(context).forEach(([key, val]) => {
    expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(val));
  });

  // Avalia expressão matemática segura
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${expr})`)();
    return typeof result === 'number' && !isNaN(result) ? Math.round(result * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

// ─── Interface de entrada para cálculo completo ─────────────────────────────
export interface PayrollCalcInput {
  base_salary: number;
  overtime_50_hours: number;
  overtime_100_hours: number;
  overtime_night_hours: number; // HE noturna
  overtime_percent: number; // percentual da HE (ex: 50, 60, 75)
  night_shift_hours: number; // adicional noturno (não HE)
  bonuses: number;
  other_bonuses: number;
  vale_transporte_uses: boolean;
  transporte_valor?: number; // valor customizado do VT
  vale_refeicao: number;
  other_deductions: number;
  dependentes: number;
  dias_faltas: number;
  horas_faltantes: number;
  custom_proventos?: CustomFieldValue[];
  custom_descontos?: CustomFieldValue[];
}

export interface PayrollCalcResult {
  base_salary: number;
  overtime_50: number;
  overtime_100: number;
  overtime_night: number; // HE noturna calculada
  night_shift_value: number; // adicional noturno
  dsr_value: number;
  dsr_desconto: number;
  bonuses: number;
  other_bonuses: number;
  custom_proventos_total: number;
  custom_descontos_total: number;
  total_proventos: number;
  inss: number;
  irrf: number;
  fgts: number;
  vale_transporte: number;
  vale_refeicao: number;
  other_deductions: number;
  desconto_faltas_dias: number;
  desconto_faltas_horas: number;
  desconto_faltas: number;
  total_descontos: number;
  gross_salary: number;
  net_salary: number;
}

export function calculatePayroll(input: PayrollCalcInput): PayrollCalcResult {
  const base = Number(input.base_salary) || 0;

  // Proventos
  const overtime50 = calcOvertime(base, input.overtime_50_hours || 0, input.overtime_percent || 50);
  const overtime100 = calcOvertime100(base, input.overtime_100_hours || 0);
  const overtimeNight = calcOvertimeNight(
    base,
    input.overtime_night_hours || 0,
    input.overtime_percent || 50,
  );
  const nightShift = calcNightShift(base, input.night_shift_hours || 0);

  // DSR com reflexo de faltas
  const totalHE = overtime50 + overtime100 + overtimeNight;
  const dsrResult = calcDSRComFaltas(
    totalHE,
    input.dias_faltas || 0,
    input.horas_faltantes || 0,
    base,
  );

  const bonuses = Number(input.bonuses) || 0;
  const otherBonuses = Number(input.other_bonuses) || 0;

  // Campos customizados de provento
  const customProventos = input.custom_proventos ?? [];
  const customProventosTotal = customProventos.reduce((s, c) => s + (c.value || 0), 0);

  const totalProventos = base + overtime50 + overtime100 + overtimeNight + nightShift
    + dsrResult.dsrLiquido + bonuses + otherBonuses + customProventosTotal;

  // Descontos
  const inss = calcINSS(totalProventos);
  const baseIRRF = totalProventos - inss;
  const irrf = calcIRRF(baseIRRF, input.dependentes || 0);
  const fgts = calcFGTS(totalProventos);
  const vt = calcValeTransporte(base, input.vale_transporte_uses, input.transporte_valor);
  const vr = Number(input.vale_refeicao) || 0;
  const otherDeductions = Number(input.other_deductions) || 0;

  // Desconto por faltas — SEPARADO
  const faltasResult = calcDescontoFaltas(base, input.dias_faltas || 0, input.horas_faltantes || 0);

  // Campos customizados de desconto
  const customDescontos = input.custom_descontos ?? [];
  const customDescontosTotal = customDescontos.reduce((s, c) => s + (c.value || 0), 0);

  const totalDescontos = inss + irrf + vt + vr + otherDeductions
    + faltasResult.total + customDescontosTotal;

  return {
    base_salary: base,
    overtime_50: overtime50,
    overtime_100: overtime100,
    overtime_night: overtimeNight,
    night_shift_value: nightShift,
    dsr_value: dsrResult.dsrLiquido,
    dsr_desconto: dsrResult.dsrDesconto,
    bonuses,
    other_bonuses: otherBonuses,
    custom_proventos_total: customProventosTotal,
    custom_descontos_total: customDescontosTotal,
    total_proventos: totalProventos,
    inss,
    irrf,
    fgts,
    vale_transporte: vt,
    vale_refeicao: vr,
    other_deductions: otherDeductions,
    desconto_faltas_dias: faltasResult.descontoDias,
    desconto_faltas_horas: faltasResult.descontoHoras,
    desconto_faltas: faltasResult.total,
    total_descontos: totalDescontos,
    gross_salary: totalProventos,
    net_salary: Math.max(0, totalProventos - totalDescontos),
  };
}
