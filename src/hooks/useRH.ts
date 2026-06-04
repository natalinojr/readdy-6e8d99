import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { SUPABASE_URL } from '@/lib/supabase';
import { calculatePayroll, type PayrollCalcInput, type PayrollCalcResult } from '@/lib/payrollCalculations';

// ─── Types ────────────────────────────────────────────────────────────────────
export type EmployeeStatus = 'active' | 'inactive' | 'vacation' | 'leave';
export type ThirteenthStatus = 'pending' | 'first_paid' | 'fully_paid';
export type PayrollEntryType = 'regular' | 'thirteenth_first' | 'thirteenth_second' | 'vacation_pay';

export interface Employee {
  id: string;
  tenant_id: string;
  name: string;
  role: string;
  department: string;
  salary: number;
  hire_date?: string;
  status: EmployeeStatus;
  cpf?: string;
  phone?: string;
  email?: string;
  notes?: string;
  // Férias
  vacation_days_per_year?: number;
  vacation_days_taken?: number;
  vacation_start_date?: string;
  vacation_end_date?: string;
  next_vacation_date?: string;
  // 13º Salário
  thirteenth_status?: ThirteenthStatus;
  thirteenth_first_paid_date?: string;
  thirteenth_second_paid_date?: string;
  created_at: string;
  updated_at: string;
}

export type PayrollStatus = 'pending' | 'paid' | 'partial';

export interface PayrollEntry {
  id: string;
  tenant_id: string;
  employee_id?: string;
  employee_name: string;
  role: string;
  department: string;
  reference_month: string;
  base_salary: number;
  // Campos de entrada (input)
  overtime_50_hours: number;
  overtime_100_hours: number;
  overtime_night_hours: number; // HE noturna
  overtime_percent: number;
  night_shift_hours: number;
  bonuses: number;
  other_bonuses: number;
  vale_transporte_uses: boolean;
  transporte_valor?: number; // valor customizado do VT
  vale_refeicao: number;
  other_deductions: number;
  dependentes: number;
  dias_faltas: number;
  horas_faltantes: number;
  // Campos customizáveis
  custom_proventos?: { field_id: string; name: string; value: number }[];
  custom_descontos?: { field_id: string; name: string; value: number }[];
  // Campos calculados (output)
  overtime_50: number;
  overtime_100: number;
  overtime_night: number;
  overtime: number; // legacy: total HE
  night_shift_value: number;
  dsr_value: number;
  dsr_desconto?: number;
  inss: number;
  irrf: number;
  fgts: number;
  vale_transporte: number;
  deductions: number; // legacy: total descontos
  desconto_faltas: number;
  desconto_faltas_dias?: number;
  desconto_faltas_horas?: number;
  total_proventos: number;
  total_descontos: number;
  custom_proventos_total?: number;
  custom_descontos_total?: number;
  gross_salary: number;
  net_salary: number;
  status: PayrollStatus;
  paid_date?: string;
  payment_method?: string;
  notes?: string;
  entry_type?: PayrollEntryType;
  created_at: string;
  updated_at: string;
}

// ─── Helper: recalcular folha a partir dos inputs ────────────────────────────
export function recalcPayroll(entry: Partial<PayrollEntry>): Partial<PayrollEntry> {
  const input: PayrollCalcInput = {
    base_salary: Number(entry.base_salary) || 0,
    overtime_50_hours: Number(entry.overtime_50_hours) || 0,
    overtime_100_hours: Number(entry.overtime_100_hours) || 0,
    overtime_night_hours: Number(entry.overtime_night_hours) || 0,
    overtime_percent: Number(entry.overtime_percent) || 50,
    night_shift_hours: Number(entry.night_shift_hours) || 0,
    bonuses: Number(entry.bonuses) || 0,
    other_bonuses: Number(entry.other_bonuses) || 0,
    vale_transporte_uses: entry.vale_transporte_uses ?? true,
    transporte_valor: entry.transporte_valor,
    vale_refeicao: Number(entry.vale_refeicao) || 0,
    other_deductions: Number(entry.other_deductions) || 0,
    dependentes: Number(entry.dependentes) || 0,
    dias_faltas: Number(entry.dias_faltas) || 0,
    horas_faltantes: Number(entry.horas_faltantes) || 0,
    custom_proventos: entry.custom_proventos,
    custom_descontos: entry.custom_descontos,
  };

  const calc = calculatePayroll(input);

  return {
    ...entry,
    overtime_50: calc.overtime_50,
    overtime_100: calc.overtime_100,
    overtime_night: calc.overtime_night,
    overtime: calc.overtime_50 + calc.overtime_100 + calc.overtime_night,
    night_shift_value: calc.night_shift_value,
    dsr_value: calc.dsr_value,
    dsr_desconto: calc.dsr_desconto,
    inss: calc.inss,
    irrf: calc.irrf,
    fgts: calc.fgts,
    vale_transporte: calc.vale_transporte,
    deductions: calc.total_descontos,
    desconto_faltas: calc.desconto_faltas,
    desconto_faltas_dias: calc.desconto_faltas_dias,
    desconto_faltas_horas: calc.desconto_faltas_horas,
    total_proventos: calc.total_proventos,
    total_descontos: calc.total_descontos,
    custom_proventos_total: calc.custom_proventos_total,
    custom_descontos_total: calc.custom_descontos_total,
    gross_salary: calc.gross_salary,
    net_salary: calc.net_salary,
  };
}

// ─── Helper: lançar no Fluxo de Caixa ────────────────────────────────────────
// REMOVED: agora a inserção no fin_cash_flow é feita pela edge function financial-write
// via as actions 'pay_payroll' e 'pay_all_payroll'

// ─── Helper: chamar edge function financial-write ─────────────────────────────
async function invokeFinancial(action: string, tenantId: string, payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/financial-write`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ action, tenant_id: tenantId, payload }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`[invokeFinancial] ${action} erro:`, json.error || res.statusText);
    return { error: json.error || res.statusText };
  }
  return { data: json.data ?? null };
}

// ─── Employees ────────────────────────────────────────────────────────────────
export function useEmployees() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEmployees = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('hr_employees')
      .select('*')
      .eq('tenant_id', user.tenantId)
      .order('name');
    if (error) console.error('[useEmployees] Erro:', error.message);
    setEmployees(data ?? []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const upsert = async (payload: Partial<Employee>) => {
    if (!user?.tenantId) return;
    const record = { ...payload, tenant_id: user.tenantId, updated_at: new Date().toISOString() };
    if (record.id) {
      const { error } = await supabase.from('hr_employees').update(record).eq('id', record.id);
      if (error) console.error('[useEmployees] Erro ao atualizar:', error.message);
    } else {
      const { error } = await supabase.from('hr_employees').insert(record);
      if (error) console.error('[useEmployees] Erro ao inserir:', error.message);
    }
    fetchEmployees();
  };

  const remove = async (id: string) => {
    if (!user?.tenantId) return;
    await supabase.from('hr_employees').update({ status: 'inactive' }).eq('id', id);
    fetchEmployees();
  };

  const updateVacation = async (id: string, vacationData: {
    vacation_start_date?: string;
    vacation_end_date?: string;
    next_vacation_date?: string;
    vacation_days_taken?: number;
    status?: EmployeeStatus;
  }) => {
    if (!user?.tenantId) return;
    await supabase.from('hr_employees').update({ ...vacationData, updated_at: new Date().toISOString() }).eq('id', id);
    fetchEmployees();
  };

  const updateThirteenth = async (id: string, thirteenthData: {
    thirteenth_status: ThirteenthStatus;
    thirteenth_first_paid_date?: string;
    thirteenth_second_paid_date?: string;
  }) => {
    if (!user?.tenantId) return;
    await supabase.from('hr_employees').update({ ...thirteenthData, updated_at: new Date().toISOString() }).eq('id', id);
    fetchEmployees();
  };

  const activeCount = employees.filter(e => e.status === 'active').length;
  const totalSalaryMass = employees
    .filter(e => e.status === 'active')
    .reduce((s, e) => s + Number(e.salary), 0);

  return { employees, loading, upsert, remove, updateVacation, updateThirteenth, refresh: fetchEmployees, activeCount, totalSalaryMass };
}

// ─── Payroll ──────────────────────────────────────────────────────────────────
export function usePayroll(referenceMonth?: string) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    let query = supabase
      .from('hr_payroll')
      .select('*')
      .eq('tenant_id', user.tenantId)
      .order('employee_name');
    if (referenceMonth) {
      query = query.eq('reference_month', referenceMonth);
    }
    const { data, error } = await query;
    if (error) console.error('[usePayroll] Erro:', error.message);
    setEntries(data ?? []);
    setLoading(false);
  }, [user?.tenantId, referenceMonth]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const upsert = async (payload: Partial<PayrollEntry>) => {
    if (!user?.tenantId) return;
    // Recalcula automaticamente antes de salvar
    const recalculated = recalcPayroll(payload);
    const record = {
      ...recalculated,
      tenant_id: user.tenantId,
      updated_at: new Date().toISOString(),
    };
    // Remove campos que não existem na tabela para evitar erro
    const cleanRecord = Object.fromEntries(
      Object.entries(record).filter(([_, v]) => v !== undefined),
    );
    if (record.id) {
      const { error } = await supabase.from('hr_payroll').update(cleanRecord).eq('id', record.id);
      if (error) {
        console.error('[usePayroll] Erro ao atualizar:', error.message);
        throw error;
      }
    } else {
      const { error } = await supabase.from('hr_payroll').insert(cleanRecord);
      if (error) {
        console.error('[usePayroll] Erro ao inserir:', error.message);
        throw error;
      }
    }
    await fetchEntries();
  };

  const markPaid = async (id: string, paid_date: string, payment_method: string) => {
    if (!user?.tenantId) return;
    await invokeFinancial('pay_payroll', user.tenantId, { id, paid_date, payment_method });
    fetchEntries();
  };

  const markAllPaid = async (ids: string[], paid_date: string, payment_method: string) => {
    if (!user?.tenantId) return;
    await invokeFinancial('pay_all_payroll', user.tenantId, { ids, paid_date, payment_method });
    fetchEntries();
  };

  const remove = async (id: string) => {
    if (!user?.tenantId) return;
    await supabase.from('hr_payroll').delete().eq('id', id);
    fetchEntries();
  };

  const generateFromEmployees = async (employees: Employee[], month: string) => {
    if (!user?.tenantId) return;
    const records = employees
      .filter(e => e.status === 'active')
      .map(e => {
        const base = Number(e.salary);
        const calc = calculatePayroll({
          base_salary: base,
          overtime_50_hours: 0,
          overtime_100_hours: 0,
          night_shift_hours: 0,
          bonuses: 0,
          other_bonuses: 0,
          vale_transporte_uses: true,
          vale_refeicao: 0,
          other_deductions: 0,
          dependentes: 0,
        });
        return {
          tenant_id: user.tenantId,
          employee_id: e.id,
          employee_name: e.name,
          role: e.role,
          department: e.department,
          reference_month: month,
          base_salary: base,
          overtime_50_hours: 0,
          overtime_100_hours: 0,
          overtime_percent: 50,
          night_shift_hours: 0,
          bonuses: 0,
          other_bonuses: 0,
          vale_transporte_uses: true,
          vale_refeicao: 0,
          other_deductions: 0,
          dependentes: 0,
          dias_faltas: 0,
          horas_faltantes: 0,
          overtime_50: calc.overtime_50,
          overtime_100: calc.overtime_100,
          overtime: calc.overtime_50 + calc.overtime_100,
          night_shift_value: calc.night_shift_value,
          dsr_value: calc.dsr_value,
          inss: calc.inss,
          irrf: calc.irrf,
          fgts: calc.fgts,
          vale_transporte: calc.vale_transporte,
          deductions: calc.total_descontos,
          desconto_faltas: calc.desconto_faltas,
          total_proventos: calc.total_proventos,
          total_descontos: calc.total_descontos,
          gross_salary: calc.gross_salary,
          net_salary: calc.net_salary,
          status: 'pending' as PayrollStatus,
          entry_type: 'regular' as PayrollEntryType,
        };
      });
    if (records.length > 0) {
      const { error } = await supabase.from('hr_payroll').insert(records);
      if (error) console.error('[usePayroll] Erro ao gerar folha:', error.message);
    }
    fetchEntries();
  };

  const generateThirteenth = async (employees: Employee[], month: string, parcel: 'first' | 'second') => {
    if (!user?.tenantId) return;
    const entryType: PayrollEntryType = parcel === 'first' ? 'thirteenth_first' : 'thirteenth_second';
    const label = parcel === 'first' ? '13º Salário - 1ª Parcela' : '13º Salário - 2ª Parcela';

    // Evita duplicatas
    const { data: existing } = await supabase
      .from('hr_payroll')
      .select('employee_id')
      .eq('tenant_id', user.tenantId)
      .eq('reference_month', month)
      .eq('entry_type', entryType);
    const existingIds = new Set((existing ?? []).map(e => e.employee_id));

    const records = employees
      .filter(e => e.status === 'active' && !existingIds.has(e.id))
      .map(e => {
        const base = Number(e.salary);
        const parcelValue = base / 2;
        const inss = parcel === 'second' ? Math.min(parcelValue * 0.09, 454.43) : 0;
        const net = parcelValue - inss;
        return {
          tenant_id: user.tenantId,
          employee_id: e.id,
          employee_name: e.name,
          role: e.role,
          department: e.department,
          reference_month: month,
          base_salary: parcelValue,
          overtime_50_hours: 0,
          overtime_100_hours: 0,
          night_shift_hours: 0,
          bonuses: 0,
          other_bonuses: 0,
          vale_transporte_uses: false,
          vale_refeicao: 0,
          other_deductions: 0,
          dependentes: 0,
          dias_faltas: 0,
          horas_faltantes: 0,
          overtime_50: 0,
          overtime_100: 0,
          overtime: 0,
          night_shift_value: 0,
          dsr_value: 0,
          inss,
          irrf: 0,
          fgts: base * 0.08,
          vale_transporte: 0,
          deductions: inss,
          desconto_faltas: 0,
          total_proventos: parcelValue,
          total_descontos: inss,
          gross_salary: parcelValue,
          net_salary: net,
          status: 'pending' as PayrollStatus,
          entry_type: entryType,
          notes: label,
        };
      });
    if (records.length > 0) {
      await supabase.from('hr_payroll').insert(records);
    }
    fetchEntries();
  };

  const generateVacationPay = async (employee: Employee, month: string, vacationDays: number) => {
    if (!user?.tenantId) return;
    const base = Number(employee.salary);
    const dailyRate = base / 30;
    const vacationAmount = dailyRate * vacationDays;
    const bonus = vacationAmount / 3; // Abono de 1/3
    const gross = vacationAmount + bonus;
    const inss = Math.min(gross * 0.09, 908.86);
    const net = gross - inss;

    const record = {
      tenant_id: user.tenantId,
      employee_id: employee.id,
      employee_name: employee.name,
      role: employee.role,
      department: employee.department,
      reference_month: month,
      base_salary: vacationAmount,
      overtime_50_hours: 0,
      overtime_100_hours: 0,
      night_shift_hours: 0,
      bonuses: bonus,
      other_bonuses: 0,
      vale_transporte_uses: false,
      vale_refeicao: 0,
      other_deductions: 0,
      dependentes: 0,
      dias_faltas: 0,
      horas_faltantes: 0,
      overtime_50: 0,
      overtime_100: 0,
      overtime: 0,
      night_shift_value: 0,
      dsr_value: 0,
      inss,
      irrf: 0,
      fgts: vacationAmount * 0.08,
      vale_transporte: 0,
      deductions: inss,
      desconto_faltas: 0,
      total_proventos: gross,
      total_descontos: inss,
      gross_salary: gross,
      net_salary: net,
      status: 'pending' as PayrollStatus,
      entry_type: 'vacation_pay' as PayrollEntryType,
      notes: `Férias — ${vacationDays} dias`,
    };
    await supabase.from('hr_payroll').insert(record);
    fetchEntries();
  };

  const totalBruto = entries.reduce((s, e) => s + Number(e.gross_salary), 0);
  const totalLiquido = entries.reduce((s, e) => s + Number(e.net_salary), 0);
  const totalFGTS = entries.reduce((s, e) => s + Number(e.fgts), 0);
  const totalINSS = entries.reduce((s, e) => s + Number(e.inss), 0);
  const totalIRRF = entries.reduce((s, e) => s + Number(e.irrf), 0);
  const totalPago = entries.filter(e => e.status === 'paid').reduce((s, e) => s + Number(e.net_salary), 0);
  const totalPendente = entries.filter(e => e.status === 'pending').reduce((s, e) => s + Number(e.net_salary), 0);

  return {
    entries, loading, upsert, markPaid, markAllPaid, remove,
    generateFromEmployees, generateThirteenth, generateVacationPay,
    refresh: fetchEntries,
    totalBruto, totalLiquido, totalFGTS, totalINSS, totalIRRF, totalPago, totalPendente,
  };
}

// ─── Payroll History (para relatório) ─────────────────────────────────────────
export interface PayrollHistoryEntry {
  reference_month: string;
  department: string;
  total_net: number;
  total_gross: number;
  total_inss: number;
  total_fgts: number;
  headcount: number;
  entry_type: string;
}

export function usePayrollHistory(monthsBack = 12) {
  const { user } = useAuth();
  const [history, setHistory] = useState<PayrollHistoryEntry[]>([]);
  const [rawEntries, setRawEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - (monthsBack - 1));
    startDate.setDate(1);
    const startMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('hr_payroll')
      .select('*')
      .eq('tenant_id', user.tenantId)
      .gte('reference_month', startMonth)
      .order('reference_month');

    if (error) console.error('[usePayrollHistory] Erro:', error.message);
    const rows = (data ?? []) as PayrollEntry[];
    setRawEntries(rows);

    // Agrupa por mês + departamento
    const map: Record<string, PayrollHistoryEntry> = {};
    rows.forEach(e => {
      const key = `${e.reference_month}__${e.department}`;
      if (!map[key]) {
        map[key] = {
          reference_month: e.reference_month,
          department: e.department,
          total_net: 0,
          total_gross: 0,
          total_inss: 0,
          total_fgts: 0,
          headcount: 0,
          entry_type: e.entry_type ?? 'regular',
        };
      }
      map[key].total_net += Number(e.net_salary);
      map[key].total_gross += Number(e.gross_salary);
      map[key].total_inss += Number(e.inss);
      map[key].total_fgts += Number(e.fgts);
      map[key].headcount += 1;
    });

    setHistory(Object.values(map).sort((a, b) => a.reference_month.localeCompare(b.reference_month)));
    setLoading(false);
  }, [user?.tenantId, monthsBack]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Meses únicos disponíveis
  const months = Array.from(new Set(history.map(h => h.reference_month))).sort();

  // Departamentos únicos
  const departments = Array.from(new Set(history.map(h => h.department))).sort();

  // Total por mês (para o gráfico geral)
  const monthlyTotals = months.map(m => {
    const monthRows = history.filter(h => h.reference_month === m);
    return {
      month: m,
      total: monthRows.reduce((s, h) => s + h.total_net, 0),
      gross: monthRows.reduce((s, h) => s + h.total_gross, 0),
      inss: monthRows.reduce((s, h) => s + h.total_inss, 0),
      fgts: monthRows.reduce((s, h) => s + h.total_fgts, 0),
      headcount: new Set(rawEntries.filter(e => e.reference_month === m).map(e => e.employee_id ?? e.employee_name)).size,
    };
  });

  return { history, rawEntries, loading, months, departments, monthlyTotals };
}

// ─── Payroll Summary (para integração no financeiro) ──────────────────────────
export function usePayrollSummary(startMonth?: string, endMonth?: string) {
  const { user } = useAuth();
  const [summary, setSummary] = useState<{ month: string; total: number; paid: number; pending: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    let query = supabase
      .from('hr_payroll')
      .select('reference_month, net_salary, status')
      .eq('tenant_id', user.tenantId);
    if (startMonth) query = query.gte('reference_month', startMonth);
    if (endMonth) query = query.lte('reference_month', endMonth);
    const { data, error } = await query;
    if (error) console.error('[usePayrollSummary] Erro:', error.message);

    const map: Record<string, { total: number; paid: number; pending: number }> = {};
    (data ?? []).forEach(e => {
      if (!map[e.reference_month]) map[e.reference_month] = { total: 0, paid: 0, pending: 0 };
      map[e.reference_month].total += Number(e.net_salary);
      if (e.status === 'paid') map[e.reference_month].paid += Number(e.net_salary);
      else map[e.reference_month].pending += Number(e.net_salary);
    });

    setSummary(
      Object.entries(map)
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month))
    );
    setLoading(false);
  }, [user?.tenantId, startMonth, endMonth]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const totalGeral = summary.reduce((s, m) => s + m.total, 0);
  return { summary, loading, totalGeral };
}
