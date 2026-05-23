import { useState, useMemo } from 'react';
import { useEmployees, usePayroll } from '@/hooks/useRH';
import type { Employee, PayrollEntry, EmployeeStatus, ThirteenthStatus } from '@/hooks/useRH';
import { usePayrollCustomFields } from '@/hooks/usePayrollCustomFields';
import { formatCurrency } from '@/lib/formatters';
import { calculatePayroll, evaluateFormula } from '@/lib/payrollCalculations';
import type { CustomFieldValue } from '@/lib/payrollCalculations';
import TimeInput from '@/components/base/TimeInput';
import FolhaRelatorioPDF from './FolhaRelatorioPDF';
import RHRelatorioTab from './RHRelatorioTab';
import CamposCustomizadosModal from './CamposCustomizadosModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

function addMonths(m: string, n: number) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function diffDays(from: string, to: string) {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

function calcVacationDaysAvailable(hireDate?: string, daysTaken = 0): number {
  if (!hireDate) return 0;
  const months = diffDays(hireDate, new Date().toISOString().split('T')[0]) / 30;
  const yearsWorked = Math.floor(months / 12);
  return Math.max(0, yearsWorked * 30 - daysTaken);
}

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Ativo', inactive: 'Inativo', vacation: 'Férias', leave: 'Afastado',
};
const STATUS_COLORS: Record<EmployeeStatus, string> = {
  active: 'bg-green-100 text-green-700', inactive: 'bg-zinc-100 text-zinc-500',
  vacation: 'bg-amber-100 text-amber-700', leave: 'bg-red-100 text-red-600',
};
const THIRTEENTH_LABELS: Record<ThirteenthStatus, string> = {
  pending: 'Pendente', first_paid: '1ª Paga', fully_paid: 'Quitado',
};
const THIRTEENTH_COLORS: Record<ThirteenthStatus, string> = {
  pending: 'bg-zinc-100 text-zinc-500', first_paid: 'bg-amber-100 text-amber-700', fully_paid: 'bg-green-100 text-green-700',
};
const PAYROLL_STATUS_LABELS: Record<string, string> = { pending: 'Pendente', paid: 'Pago', partial: 'Parcial' };
const PAYROLL_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700', paid: 'bg-green-100 text-green-700', partial: 'bg-orange-100 text-orange-700',
};
const ENTRY_TYPE_LABELS: Record<string, string> = {
  regular: 'Folha', thirteenth_first: '13º 1ª', thirteenth_second: '13º 2ª', vacation_pay: 'Férias',
};
const DEPARTMENTS = ['Cozinha', 'Salão', 'Caixa', 'Delivery', 'Gerência', 'Limpeza', 'Administrativo', 'Geral'];

// ─── Employee Modal ───────────────────────────────────────────────────────────
function EmployeeModal({
  employee,
  onClose,
  onSave,
}: {
  employee: Partial<Employee> | null;
  onClose: () => void;
  onSave: (data: Partial<Employee>) => void;
}) {
  const [form, setForm] = useState<Partial<Employee>>(
    employee ?? { status: 'active', department: 'Geral', salary: 0, vacation_days_per_year: 30, thirteenth_status: 'pending' }
  );
  const set = (k: keyof Employee, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <h3 className="text-base font-bold text-zinc-900">{form.id ? 'Editar Funcionário' : 'Novo Funcionário'}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Dados básicos */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Dados Pessoais</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Nome completo *</label>
                <input required value={form.name ?? ''} onChange={e => set('name', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" placeholder="Ex: João da Silva" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Cargo *</label>
                <input required value={form.role ?? ''} onChange={e => set('role', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" placeholder="Ex: Cozinheiro" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Departamento</label>
                <select value={form.department ?? 'Geral'} onChange={e => set('department', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white">
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Salário Base (R$) *</label>
                <input required type="number" min={0} step={0.01} value={form.salary ?? 0}
                  onChange={e => set('salary', parseFloat(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Vale Transporte (R$)</label>
                <input type="number" min={0} step={0.01} value={form.transporte_valor ?? 0}
                  onChange={e => set('transporte_valor', parseFloat(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
                <p className="text-xs text-zinc-400 mt-0.5">Deixe 0 para usar 6% do salário</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Status</label>
                <select value={form.status ?? 'active'} onChange={e => set('status', e.target.value as EmployeeStatus)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white">
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Data de Admissão</label>
                <input type="date" value={form.hire_date ?? ''} onChange={e => set('hire_date', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">CPF</label>
                <input value={form.cpf ?? ''} onChange={e => set('cpf', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" placeholder="000.000.000-00" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Telefone</label>
                <input value={form.phone ?? ''} onChange={e => set('phone', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" placeholder="(11) 99999-9999" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-zinc-600 mb-1">E-mail</label>
                <input type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
            </div>
          </div>

          {/* Férias */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Controle de Férias</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Dias de Férias/Ano</label>
                <input type="number" min={0} max={60} value={form.vacation_days_per_year ?? 30}
                  onChange={e => set('vacation_days_per_year', parseInt(e.target.value) || 30)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Dias Gozados</label>
                <input type="number" min={0} value={form.vacation_days_taken ?? 0}
                  onChange={e => set('vacation_days_taken', parseInt(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Início das Férias</label>
                <input type="date" value={form.vacation_start_date ?? ''}
                  onChange={e => set('vacation_start_date', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Fim das Férias</label>
                <input type="date" value={form.vacation_end_date ?? ''}
                  onChange={e => set('vacation_end_date', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Próximas Férias (previsão)</label>
                <input type="date" value={form.next_vacation_date ?? ''}
                  onChange={e => set('next_vacation_date', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
            </div>
          </div>

          {/* 13º Salário */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">13º Salário</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Status do 13º</label>
                <select value={form.thirteenth_status ?? 'pending'}
                  onChange={e => set('thirteenth_status', e.target.value as ThirteenthStatus)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white">
                  <option value="pending">Pendente</option>
                  <option value="first_paid">1ª Parcela Paga</option>
                  <option value="fully_paid">Totalmente Quitado</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Data Pagamento 1ª Parcela</label>
                <input type="date" value={form.thirteenth_first_paid_date ?? ''}
                  onChange={e => set('thirteenth_first_paid_date', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Data Pagamento 2ª Parcela</label>
                <input type="date" value={form.thirteenth_second_paid_date ?? ''}
                  onChange={e => set('thirteenth_second_paid_date', e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
            </div>
          </div>

          <div className="col-span-2">
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Observações</label>
            <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-zinc-200 rounded-lg py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              Cancelar
            </button>
            <button type="submit"
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-2.5 text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors">
              {form.id ? 'Salvar' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Férias Modal ─────────────────────────────────────────────────────────────
function VacationModal({
  employee,
  onClose,
  onGeneratePay,
}: {
  employee: Employee;
  onClose: () => void;
  onGeneratePay: (emp: Employee, month: string, days: number) => void;
}) {
  const daysAvailable = calcVacationDaysAvailable(employee.hire_date, employee.vacation_days_taken);
  const [vacDays, setVacDays] = useState(Math.min(daysAvailable, 30));
  const [month, setMonth] = useState(currentMonth);

  const base = Number(employee.salary);
  const dailyRate = base / 30;
  const vacAmount = dailyRate * vacDays;
  const bonus = vacAmount / 3;
  const gross = vacAmount + bonus;
  const inss = Math.min(gross * 0.09, 908.86);
  const net = gross - inss;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div>
            <h3 className="text-base font-bold text-zinc-900">Gerar Pagamento de Férias</h3>
            <p className="text-xs text-zinc-500">{employee.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
            <i className="ri-calendar-check-line text-amber-600 text-lg" />
            <div>
              <p className="text-xs font-semibold text-amber-800">Dias disponíveis</p>
              <p className="text-sm font-bold text-amber-700">{daysAvailable} dias</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Dias de Férias a Pagar</label>
            <input type="number" min={1} max={Math.max(daysAvailable, 1)} value={vacDays}
              onChange={e => setVacDays(Math.min(parseInt(e.target.value) || 1, daysAvailable))}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Competência (Mês/Ano)</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
          </div>

          {/* Preview */}
          <div className="bg-zinc-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold text-zinc-600 uppercase tracking-wide mb-2">Cálculo Estimado</p>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-600">Remuneração ({vacDays} dias)</span>
              <span className="font-medium">{formatCurrency(vacAmount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-600">Abono Constitucional (1/3)</span>
              <span className="font-medium text-green-600">+{formatCurrency(bonus)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-600">INSS</span>
              <span className="font-medium text-red-500">-{formatCurrency(inss)}</span>
            </div>
            <div className="border-t border-zinc-200 pt-2 flex justify-between text-sm font-bold">
              <span className="text-zinc-800">Líquido a pagar</span>
              <span className="text-green-700">{formatCurrency(net)}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 border border-zinc-200 rounded-lg py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              Cancelar
            </button>
            <button onClick={() => { onGeneratePay(employee, month, vacDays); onClose(); }}
              disabled={daysAvailable === 0}
              className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg py-2.5 text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors">
              Gerar Lançamento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Thirteenth Modal ─────────────────────────────────────────────────────────
function ThirteenthModal({
  employees,
  onClose,
  onGenerate,
}: {
  employees: Employee[];
  onClose: () => void;
  onGenerate: (employees: Employee[], month: string, parcel: 'first' | 'second') => void;
}) {
  const [parcel, setParcel] = useState<'first' | 'second'>('first');
  const [month, setMonth] = useState(currentMonth);

  const activeEmps = employees.filter(e => e.status === 'active');
  const totalBase = activeEmps.reduce((s, e) => s + Number(e.salary), 0);
  const parcelValue = totalBase / 2;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h3 className="text-base font-bold text-zinc-900">Gerar 13º Salário</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            {[
              { value: 'first', label: '1ª Parcela', sub: 'Até 30/11' },
              { value: 'second', label: '2ª Parcela', sub: 'Até 20/12' },
            ].map(p => (
              <button key={p.value} onClick={() => setParcel(p.value as 'first' | 'second')}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold cursor-pointer transition-colors border-2 ${parcel === p.value ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
                <p>{p.label}</p>
                <p className="text-xs font-normal mt-0.5 opacity-70">{p.sub}</p>
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Competência</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
          </div>

          <div className="bg-zinc-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold text-zinc-600 uppercase tracking-wide mb-2">Estimativa</p>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-600">Funcionários ativos</span>
              <span className="font-medium">{activeEmps.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-600">Massa salarial</span>
              <span className="font-medium">{formatCurrency(totalBase)}</span>
            </div>
            <div className="border-t border-zinc-200 pt-2 flex justify-between text-sm font-bold">
              <span className="text-zinc-800">Total da parcela (≈)</span>
              <span className="text-amber-700">{formatCurrency(parcelValue)}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 border border-zinc-200 rounded-lg py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              Cancelar
            </button>
            <button onClick={() => { onGenerate(activeEmps, month, parcel); onClose(); }}
              disabled={activeEmps.length === 0}
              className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg py-2.5 text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors">
              Gerar Lançamentos
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Payroll Entry Modal (com cálculo automático completo) ──────────────────
function PayrollModal({
  entry,
  employees,
  onClose,
  onSave,
  showCamposModal,
}: {
  entry: Partial<PayrollEntry> | null;
  employees: Employee[];
  onClose: () => void;
  onSave: (data: Partial<PayrollEntry>) => void;
  showCamposModal: () => void;
}) {
  const { proventos: customProventosDef, descontos: customDescontosDef } = usePayrollCustomFields();
  const [form, setForm] = useState<Partial<PayrollEntry>>(
    entry ?? {
      status: 'pending',
      department: 'Geral',
      base_salary: 0,
      overtime_50_hours: 0,
      overtime_100_hours: 0,
      overtime_night_hours: 0,
      overtime_percent: 60,
      night_shift_hours: 0,
      bonuses: 0,
      other_bonuses: 0,
      vale_transporte_uses: true,
      transporte_valor: 0,
      vale_refeicao: 0,
      other_deductions: 0,
      dependentes: 0,
      dias_faltas: 0,
      horas_faltantes: 0,
      entry_type: 'regular',
    }
  );

  // Valores dos campos customizáveis
  const [customValues, setCustomValues] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    const allCustom = [...(entry?.custom_proventos ?? []), ...(entry?.custom_descontos ?? [])];
    allCustom.forEach(c => { map[c.field_id] = c.value; });
    return map;
  });

  // Recalcula em tempo real
  const calc = useMemo(() => {
    // Calcula valores dos campos customizáveis
    const context = {
      base: Number(form.base_salary) || 0,
      total_proventos: Number(form.base_salary) || 0,
      gross_salary: Number(form.base_salary) || 0,
    };

    const customProventosValues: CustomFieldValue[] = customProventosDef.map(f => {
      let value = 0;
      if (f.formula) {
        value = evaluateFormula(f.formula, context);
      } else if (f.is_percentage && f.percentage_of) {
        const baseVal = context[f.percentage_of as keyof typeof context] || 0;
        value = Math.round(baseVal * (f.fixed_value / 100) * 100) / 100;
      } else {
        value = customValues[f.id] ?? f.fixed_value ?? 0;
      }
      return { field_id: f.id, name: f.name, type: 'provento', value };
    });

    const customDescontosValues: CustomFieldValue[] = customDescontosDef.map(f => {
      let value = 0;
      if (f.formula) {
        value = evaluateFormula(f.formula, context);
      } else if (f.is_percentage && f.percentage_of) {
        const baseVal = context[f.percentage_of as keyof typeof context] || 0;
        value = Math.round(baseVal * (f.fixed_value / 100) * 100) / 100;
      } else {
        value = customValues[f.id] ?? f.fixed_value ?? 0;
      }
      return { field_id: f.id, name: f.name, type: 'desconto', value };
    });

    const input = {
      base_salary: Number(form.base_salary) || 0,
      overtime_50_hours: Number(form.overtime_50_hours) || 0,
      overtime_100_hours: Number(form.overtime_100_hours) || 0,
      overtime_night_hours: Number(form.overtime_night_hours) || 0,
      overtime_percent: Number(form.overtime_percent) || 60,
      night_shift_hours: Number(form.night_shift_hours) || 0,
      bonuses: Number(form.bonuses) || 0,
      other_bonuses: Number(form.other_bonuses) || 0,
      vale_transporte_uses: form.vale_transporte_uses ?? true,
      transporte_valor: Number(form.transporte_valor) || 0,
      vale_refeicao: Number(form.vale_refeicao) || 0,
      other_deductions: Number(form.other_deductions) || 0,
      dependentes: Number(form.dependentes) || 0,
      dias_faltas: Number(form.dias_faltas) || 0,
      horas_faltantes: Number(form.horas_faltantes) || 0,
      custom_proventos: customProventosValues,
      custom_descontos: customDescontosValues,
    };
    return calculatePayroll(input);
  }, [
    form.base_salary, form.overtime_50_hours, form.overtime_100_hours, form.overtime_night_hours,
    form.overtime_percent, form.night_shift_hours, form.bonuses, form.other_bonuses,
    form.vale_transporte_uses, form.transporte_valor, form.vale_refeicao, form.other_deductions,
    form.dependentes, form.dias_faltas, form.horas_faltantes,
    customProventosDef, customDescontosDef, customValues,
  ]);

  const set = (k: keyof PayrollEntry, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  // Seleciona funcionário do cadastro
  const handleSelectEmployee = (empId: string) => {
    const emp = employees.find(e => e.id === empId);
    if (emp) {
      setForm(f => ({
        ...f,
        employee_id: emp.id,
        employee_name: emp.name,
        role: emp.role,
        department: emp.department,
        base_salary: Number(emp.salary) || 0,
        transporte_valor: Number(emp.transporte_valor) || 0,
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Monta os campos customizáveis
    const customProventosArr = customProventosDef.map(f => ({
      field_id: f.id,
      name: f.name,
      value: customValues[f.id] ?? f.fixed_value ?? 0,
    }));
    const customDescontosArr = customDescontosDef.map(f => ({
      field_id: f.id,
      name: f.name,
      value: customValues[f.id] ?? f.fixed_value ?? 0,
    }));
    // Envia os inputs + os calculados + customizáveis
    onSave({
      ...form,
      ...calc,
      custom_proventos: customProventosArr,
      custom_descontos: customDescontosArr,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white">
          <h3 className="text-base font-bold text-zinc-900">{form.id ? 'Editar Lançamento' : 'Novo Lançamento'}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Dados básicos */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Funcionário *</label>
              <select
                required
                value={form.employee_id ?? ''}
                onChange={e => handleSelectEmployee(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white"
              >
                <option value="">Selecione um funcionário...</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} — {emp.role} ({emp.department})
                  </option>
                ))}
              </select>
              {form.employee_id && (
                <p className="text-xs text-zinc-400 mt-1">
                  Salário base cadastrado: {formatCurrency(form.base_salary ?? 0)}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Tipo</label>
              <select value={form.entry_type ?? 'regular'} onChange={e => set('entry_type', e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white">
                <option value="regular">Folha Regular</option>
                <option value="thirteenth_first">13º - 1ª Parcela</option>
                <option value="thirteenth_second">13º - 2ª Parcela</option>
                <option value="vacation_pay">Férias</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Departamento</label>
              <select value={form.department ?? 'Geral'} onChange={e => set('department', e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white">
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* ── Proventos ── */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <i className="ri-add-circle-line text-green-500" /> Proventos
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Salário Base (R$) *</label>
                <input required type="number" min={0} step={0.01} value={form.base_salary ?? 0}
                  onChange={e => set('base_salary', parseFloat(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">% Hora Extra</label>
                <select value={form.overtime_percent ?? 60} onChange={e => set('overtime_percent', parseInt(e.target.value))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white">
                  <option value={50}>50% (padrão)</option>
                  <option value={60}>60%</option>
                  <option value={75}>75%</option>
                  <option value={100}>100%</option>
                </select>
                <p className="text-xs text-zinc-400 mt-0.5">Percentual aplicado sobre a hora normal</p>
              </div>
              <TimeInput
                label="HE Dia Útil"
                value={form.overtime_50_hours ?? 0}
                onChange={v => set('overtime_50_hours', v)}
                className=""
              />
              <TimeInput
                label="HE 100% (Dom/Fer)"
                value={form.overtime_100_hours ?? 0}
                onChange={v => set('overtime_100_hours', v)}
                className=""
              />
              <TimeInput
                label="HE Noturna"
                value={form.overtime_night_hours ?? 0}
                onChange={v => set('overtime_night_hours', v)}
                className=""
              />
              <TimeInput
                label="Adic. Noturno"
                value={form.night_shift_hours ?? 0}
                onChange={v => set('night_shift_hours', v)}
                className=""
              />
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Bônus / Comissões (R$)</label>
                <input type="number" min={0} step={0.01} value={form.bonuses ?? 0}
                  onChange={e => set('bonuses', parseFloat(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Outros Proventos (R$)</label>
                <input type="number" min={0} step={0.01} value={form.other_bonuses ?? 0}
                  onChange={e => set('other_bonuses', parseFloat(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
            </div>
            {/* DSR calculado */}
            {calc.dsr_value > 0 && (
              <div className="mt-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
                <i className="ri-information-line text-green-600 text-sm" />
                <p className="text-xs text-green-700">
                  DSR sobre horas extras: <strong>{formatCurrency(calc.dsr_value)}</strong>
                  {calc.dsr_desconto > 0 && (
                    <span> (desconto por faltas: -{formatCurrency(calc.dsr_desconto)})</span>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* ── Descontos ── */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <i className="ri-wallet-3-line text-red-500" /> Descontos
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Dependentes</label>
                <input type="number" min={0} max={20} value={form.dependentes ?? 0}
                  onChange={e => set('dependentes', parseInt(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
                <p className="text-xs text-zinc-400 mt-0.5">Dedução IRRF</p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="vt" checked={form.vale_transporte_uses ?? true}
                    onChange={e => set('vale_transporte_uses', e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-300 text-amber-500 focus:ring-amber-400" />
                  <label htmlFor="vt" className="text-xs font-semibold text-zinc-600 cursor-pointer">
                    Usa Vale Transporte
                  </label>
                </div>
                {form.vale_transporte_uses && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 mb-1">Valor do VT (R$)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.transporte_valor ?? 0}
                      onChange={e => set('transporte_valor', parseFloat(e.target.value) || 0)}
                      placeholder="Deixe 0 para 6% automático"
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                    />
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {form.transporte_valor && form.transporte_valor > 0
                        ? `Valor fixo: ${formatCurrency(form.transporte_valor)}`
                        : `6% automático: ${formatCurrency(calc.vale_transporte)}`}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Vale Refeição (R$)</label>
                <input type="number" min={0} step={0.01} value={form.vale_refeicao ?? 0}
                  onChange={e => set('vale_refeicao', parseFloat(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Dias de Falta</label>
                <input type="number" min={0} max={31} step={1} value={form.dias_faltas ?? 0}
                  onChange={e => set('dias_faltas', parseInt(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
                {calc.desconto_faltas_dias > 0 && (
                  <p className="text-xs text-red-500 mt-0.5">-{formatCurrency(calc.desconto_faltas_dias)}</p>
                )}
              </div>
              <TimeInput
                label="Horas Faltantes"
                value={form.horas_faltantes ?? 0}
                onChange={v => set('horas_faltantes', v)}
                className=""
              />
              {calc.desconto_faltas_horas > 0 && (
                <p className="text-xs text-red-500 mt-0.5 col-span-1 md:col-span-1">-{formatCurrency(calc.desconto_faltas_horas)}</p>
              )}
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Outros Descontos (R$)</label>
                <input type="number" min={0} step={0.01} value={form.other_deductions ?? 0}
                  onChange={e => set('other_deductions', parseFloat(e.target.value) || 0)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
              </div>
            </div>
            {(calc.desconto_faltas_dias > 0 || calc.desconto_faltas_horas > 0) && (
              <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                <i className="ri-error-warning-line text-red-600 text-sm" />
                <p className="text-xs text-red-700">
                  Desconto faltas:
                  {calc.desconto_faltas_dias > 0 && <span> dias: <strong>-{formatCurrency(calc.desconto_faltas_dias)}</strong></span>}
                  {calc.desconto_faltas_horas > 0 && <span> | horas: <strong>-{formatCurrency(calc.desconto_faltas_horas)}</strong></span>}
                  <span className="ml-1">| Total: <strong>-{formatCurrency(calc.desconto_faltas)}</strong></span>
                </p>
              </div>
            )}
          </div>

          {/* ── Campos Customizáveis ── */}
          {(customProventosDef.length > 0 || customDescontosDef.length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <i className="ri-settings-3-line text-amber-500" /> Campos Customizáveis
                </p>
                <button
                  type="button"
                  onClick={showCamposModal}
                  className="text-xs text-amber-600 hover:text-amber-700 font-semibold cursor-pointer"
                >
                  <i className="ri-add-line" /> Gerenciar campos
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {customProventosDef.map(f => (
                  <div key={f.id}>
                    <label className="block text-xs font-semibold text-green-600 mb-1">{f.name} (R$)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={customValues[f.id] ?? f.fixed_value ?? 0}
                      onChange={e => setCustomValues(prev => ({ ...prev, [f.id]: parseFloat(e.target.value) || 0 }))}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                    />
                    {f.formula && <p className="text-xs text-zinc-400 mt-0.5">Fórmula: {f.formula}</p>}
                  </div>
                ))}
                {customDescontosDef.map(f => (
                  <div key={f.id}>
                    <label className="block text-xs font-semibold text-red-500 mb-1">{f.name} (R$)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={customValues[f.id] ?? f.fixed_value ?? 0}
                      onChange={e => setCustomValues(prev => ({ ...prev, [f.id]: parseFloat(e.target.value) || 0 }))}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                    />
                    {f.formula && <p className="text-xs text-zinc-400 mt-0.5">Fórmula: {f.formula}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Resumo Calculado ── */}
          <div className="bg-zinc-50 rounded-xl p-5 space-y-3">
            <p className="text-xs font-bold text-zinc-600 uppercase tracking-wide">Resumo do Cálculo</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <p className="text-xs text-zinc-500">Salário Base</p>
                <p className="text-sm font-bold text-zinc-800">{formatCurrency(calc.base_salary)}</p>
              </div>
              {calc.overtime_50 > 0 && (
                <div>
                  <p className="text-xs text-zinc-500">HE Dia Útil</p>
                  <p className="text-sm font-bold text-green-600">+{formatCurrency(calc.overtime_50)}</p>
                </div>
              )}
              {calc.overtime_100 > 0 && (
                <div>
                  <p className="text-xs text-zinc-500">HE 100%</p>
                  <p className="text-sm font-bold text-green-600">+{formatCurrency(calc.overtime_100)}</p>
                </div>
              )}
              {calc.overtime_night > 0 && (
                <div>
                  <p className="text-xs text-zinc-500">HE Noturna</p>
                  <p className="text-sm font-bold text-green-600">+{formatCurrency(calc.overtime_night)}</p>
                </div>
              )}
              {calc.night_shift_value > 0 && (
                <div>
                  <p className="text-xs text-zinc-500">Adic. Noturno</p>
                  <p className="text-sm font-bold text-green-600">+{formatCurrency(calc.night_shift_value)}</p>
                </div>
              )}
              {calc.dsr_value > 0 && (
                <div>
                  <p className="text-xs text-zinc-500">DSR</p>
                  <p className="text-sm font-bold text-green-600">+{formatCurrency(calc.dsr_value)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-zinc-500">Total Proventos</p>
                <p className="text-sm font-bold text-green-700">{formatCurrency(calc.total_proventos)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">INSS</p>
                <p className="text-sm font-bold text-orange-600">-{formatCurrency(calc.inss)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">IRRF</p>
                <p className="text-sm font-bold text-red-500">-{formatCurrency(calc.irrf)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">FGTS (empresa)</p>
                <p className="text-sm font-bold text-amber-600">{formatCurrency(calc.fgts)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Vale Transporte</p>
                <p className="text-sm font-bold text-red-500">-{formatCurrency(calc.vale_transporte)}</p>
              </div>
              {calc.desconto_faltas_dias > 0 && (
                <div>
                  <p className="text-xs text-zinc-500">Faltas (dias)</p>
                  <p className="text-sm font-bold text-red-500">-{formatCurrency(calc.desconto_faltas_dias)}</p>
                </div>
              )}
              {calc.desconto_faltas_horas > 0 && (
                <div>
                  <p className="text-xs text-zinc-500">Faltas (horas)</p>
                  <p className="text-sm font-bold text-red-500">-{formatCurrency(calc.desconto_faltas_horas)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-zinc-500">Total Descontos</p>
                <p className="text-sm font-bold text-red-600">-{formatCurrency(calc.total_descontos)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-zinc-500">Salário Líquido</p>
                <p className="text-lg font-black text-green-700">{formatCurrency(calc.net_salary)}</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 border border-zinc-200 rounded-lg py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">Cancelar</button>
            <button type="submit"
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-2.5 text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors">
              {form.id ? 'Salvar' : 'Adicionar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Fechamento Folha Modal (confirmação antes de pagar) ─────────────────────
function FechamentoFolhaModal({
  entries,
  onClose,
  onConfirm,
}: {
  entries: PayrollEntry[];
  onClose: () => void;
  onConfirm: (updatedEntries: PayrollEntry[]) => void;
}) {
  const [faltasMap, setFaltasMap] = useState<Record<string, { dias: number; horas: number }>>({});
  const [observacoes, setObservacoes] = useState('');

  const count = entries.length;
  const totalOriginal = entries.reduce((s, e) => s + Number(e.net_salary), 0);

  // Calcula o total com descontos aplicados
  const totalComDescontos = useMemo(() => {
    return entries.reduce((s, e) => {
      const f = faltasMap[e.id] ?? { dias: 0, horas: 0 };
      if (f.dias === 0 && f.horas === 0) return s + Number(e.net_salary);
      const base = Number(e.base_salary);
      const descontoDias = f.dias > 0 ? Math.round((base / 30) * f.dias * 100) / 100 : 0;
      const descontoHoras = f.horas > 0 ? Math.round((base / 220) * f.horas * 100) / 100 : 0;
      const descontoTotal = descontoDias + descontoHoras;
      return s + Math.max(0, Number(e.net_salary) - descontoTotal);
    }, 0);
  }, [entries, faltasMap]);

  const totalDesconto = totalOriginal - totalComDescontos;

  const setFaltas = (id: string, field: 'dias' | 'horas', value: number) => {
    setFaltasMap(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? { dias: 0, horas: 0 }), [field]: value },
    }));
  };

  const handleConfirm = () => {
    // Aplica os descontos nos entries
    const updated = entries.map(e => {
      const f = faltasMap[e.id] ?? { dias: 0, horas: 0 };
      if (f.dias === 0 && f.horas === 0) return e;
      const base = Number(e.base_salary);
      const descontoDias = f.dias > 0 ? Math.round((base / 30) * f.dias * 100) / 100 : 0;
      const descontoHoras = f.horas > 0 ? Math.round((base / 220) * f.horas * 100) / 100 : 0;
      const descontoTotal = descontoDias + descontoHoras;
      return {
        ...e,
        dias_faltas: f.dias,
        horas_faltantes: f.horas,
        desconto_faltas: descontoTotal,
        net_salary: Math.max(0, Number(e.net_salary) - descontoTotal),
        total_descontos: Number(e.total_descontos) + descontoTotal,
        notes: observacoes ? `${e.notes ?? ''} | ${observacoes}`.trim() : e.notes,
      };
    });
    onConfirm(updated);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-base font-bold text-zinc-900">Confirmar Fechamento da Folha</h3>
            <p className="text-xs text-zinc-500">{count} lançamento(s) — Ajuste faltas antes de pagar</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {/* Resumo */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-50 rounded-xl p-3 text-center">
              <p className="text-xs text-zinc-500">Total Original</p>
              <p className="text-sm font-bold text-zinc-800">{formatCurrency(totalOriginal)}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <p className="text-xs text-red-600">Descontos Faltas</p>
              <p className="text-sm font-bold text-red-600">-{formatCurrency(totalDesconto)}</p>
            </div>
            <div className="bg-green-50 rounded-xl p-3 text-center">
              <p className="text-xs text-green-700">Total a Pagar</p>
              <p className="text-sm font-bold text-green-700">{formatCurrency(totalComDescontos)}</p>
            </div>
          </div>

          {/* Tabela de faltas por funcionário */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">
              Ajuste de Faltas por Funcionário
            </p>
            <div className="border border-zinc-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500">Funcionário</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500">Líquido Atual</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500">Dias Falta</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-zinc-500">Horas Falta</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-500">Novo Líquido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {entries.map(e => {
                    const f = faltasMap[e.id] ?? { dias: 0, horas: 0 };
                    const base = Number(e.base_salary);
                    const descontoDias = f.dias > 0 ? Math.round((base / 30) * f.dias * 100) / 100 : 0;
                    const descontoHoras = f.horas > 0 ? Math.round((base / 220) * f.horas * 100) / 100 : 0;
                    const descontoTotal = descontoDias + descontoHoras;
                    const novoLiquido = Math.max(0, Number(e.net_salary) - descontoTotal);
                    return (
                      <tr key={e.id} className="hover:bg-zinc-50/50">
                        <td className="px-4 py-2.5">
                          <p className="text-sm font-medium text-zinc-800">{e.employee_name}</p>
                          <p className="text-xs text-zinc-400">{e.role}</p>
                        </td>
                        <td className="px-3 py-2.5 text-sm text-right text-zinc-600">{formatCurrency(e.net_salary)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="number"
                            min={0}
                            max={31}
                            value={f.dias}
                            onChange={ev => setFaltas(e.id, 'dias', parseInt(ev.target.value) || 0)}
                            className="w-16 border border-zinc-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-amber-400"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={f.horas}
                            onChange={ev => setFaltas(e.id, 'horas', parseFloat(ev.target.value) || 0)}
                            className="w-16 border border-zinc-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-amber-400"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-semibold text-zinc-800">
                          {formatCurrency(novoLiquido)}
                          {descontoTotal > 0 && (
                            <span className="text-xs text-red-500 block">-{formatCurrency(descontoTotal)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Observações do fechamento</label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={2} maxLength={500}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 resize-none"
              placeholder="Ex: Funcionário X faltou 2 dias por motivo de saúde..." />
            <p className="text-xs text-zinc-400 mt-0.5 text-right">{observacoes.length}/500</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              className="flex-1 border border-zinc-200 rounded-lg py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              Cancelar
            </button>
            <button onClick={handleConfirm}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-lg py-2.5 text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors">
              Continuar para Pagamento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pay All Modal ────────────────────────────────────────────────────────────
function PayAllModal({ count, total, onClose, onConfirm }: {
  count: number; total: number; onClose: () => void; onConfirm: (date: string, method: string) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [method, setMethod] = useState('Transferência');
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h3 className="text-base font-bold text-zinc-900">Pagar Folha</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <p className="text-xs text-amber-700 mb-1">{count} lançamento(s) — Total a pagar</p>
            <p className="text-2xl font-black text-amber-700">{formatCurrency(total)}</p>
            <p className="text-xs text-amber-600 mt-1">Será lançado automaticamente no Fluxo de Caixa</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Data de Pagamento</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Forma de Pagamento</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white">
              {['Transferência', 'PIX', 'Dinheiro', 'Depósito', 'Cheque'].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 border border-zinc-200 rounded-lg py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">Cancelar</button>
            <button onClick={() => { onConfirm(date, method); onClose(); }}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-lg py-2.5 text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors">
              Confirmar Pagamento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Employee Row com férias / 13º ────────────────────────────────────────────
function EmployeeRow({
  emp,
  onEdit,
  onRemove,
  onVacation,
}: {
  emp: Employee;
  onEdit: () => void;
  onRemove: () => void;
  onVacation: () => void;
}) {
  const daysAvailable = calcVacationDaysAvailable(emp.hire_date, emp.vacation_days_taken);
  const thirteenthStatus: ThirteenthStatus = emp.thirteenth_status ?? 'pending';

  return (
    <tr className="hover:bg-zinc-50/50 transition-colors">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
            <span className="text-sm font-bold text-amber-700">{emp.name.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-800">{emp.name}</p>
            <p className="text-xs text-zinc-400">{emp.role}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className="text-xs bg-zinc-100 text-zinc-600 px-2 py-1 rounded-full font-medium">{emp.department}</span>
      </td>
      <td className="px-4 py-3.5 text-sm text-zinc-600">
        {emp.hire_date ? new Date(emp.hire_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
      </td>
      <td className="px-4 py-3.5 text-sm font-bold text-right text-zinc-800">{formatCurrency(emp.salary)}</td>

      {/* Férias */}
      <td className="px-4 py-3.5 text-center">
        <div className="flex flex-col items-center gap-0.5">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${daysAvailable > 0 ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-500'}`}>
            {daysAvailable}d disponíveis
          </span>
          {emp.next_vacation_date && (
            <span className="text-xs text-zinc-400">
              Prev: {new Date(emp.next_vacation_date + 'T12:00:00').toLocaleDateString('pt-BR')}
            </span>
          )}
        </div>
      </td>

      {/* 13º */}
      <td className="px-4 py-3.5 text-center">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${THIRTEENTH_COLORS[thirteenthStatus]}`}>
          {THIRTEENTH_LABELS[thirteenthStatus]}
        </span>
      </td>

      <td className="px-4 py-3.5 text-center">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[emp.status]}`}>
          {STATUS_LABELS[emp.status]}
        </span>
      </td>

      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1 justify-end">
          <button onClick={onVacation} title="Gerar pagamento de férias"
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-100 text-amber-600 cursor-pointer transition-colors">
            <i className="ri-sun-line text-sm" />
          </button>
          <button onClick={onEdit} title="Editar"
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer transition-colors">
            <i className="ri-edit-line text-sm" />
          </button>
          <button onClick={onRemove} title="Desativar"
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-100 text-red-500 cursor-pointer transition-colors">
            <i className="ri-user-unfollow-line text-sm" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function RHTab() {
  const [activeView, setActiveView] = useState<'folha' | 'funcionarios' | 'relatorio'>('folha');
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [employeeModal, setEmployeeModal] = useState<Partial<Employee> | null | false>(false);
  const [payrollModal, setPayrollModal] = useState<Partial<PayrollEntry> | null | false>(false);
  const [payAllModal, setPayAllModal] = useState(false);
  const [fechamentoModal, setFechamentoModal] = useState(false);
  const [adjustedTotalPendente, setAdjustedTotalPendente] = useState<number | null>(null);
  const [relatorioModal, setRelatorioModal] = useState(false);
  const [vacationModal, setVacationModal] = useState<Employee | null>(null);
  const [thirteenthModal, setThirteenthModal] = useState(false);
  const [camposCustomizadosModal, setCamposCustomizadosModal] = useState(false);
  const [deptFilter, setDeptFilter] = useState('Todos');
  const [search, setSearch] = useState('');

  const { employees, loading: empLoading, upsert: upsertEmployee, remove: removeEmployee, activeCount, totalSalaryMass } = useEmployees();
  const {
    entries, loading: payLoading, upsert: upsertPayroll, markPaid, markAllPaid, remove: removePayroll,
    generateFromEmployees, generateThirteenth, generateVacationPay,
    totalBruto, totalLiquido, totalFGTS, totalINSS, totalIRRF, totalPago, totalPendente,
  } = usePayroll(selectedMonth);

  const canGoNext = selectedMonth < currentMonth;
  const filteredEmployees = employees.filter(e => {
    const matchDept = deptFilter === 'Todos' || e.department === deptFilter;
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.role.toLowerCase().includes(search.toLowerCase());
    return matchDept && matchSearch;
  });
  const pendingEntries = entries.filter(e => e.status === 'pending');
  const departments = ['Todos', ...Array.from(new Set(employees.map(e => e.department)))];

  const handleGenerateFolha = async () => {
    const existing = entries.map(e => e.employee_id).filter(Boolean);
    const toGenerate = employees.filter(e => e.status === 'active' && !existing.includes(e.id));
    if (toGenerate.length > 0) await generateFromEmployees(toGenerate, selectedMonth);
  };

  // Alerta de férias disponíveis
  const empWithVacation = employees.filter(e => e.status === 'active' && calcVacationDaysAvailable(e.hire_date, e.vacation_days_taken) > 0);
  const empWithPending13 = employees.filter(e => e.status === 'active' && (e.thirteenth_status === 'pending' || !e.thirteenth_status));

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Funcionários Ativos</span>
            <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg">
              <i className="ri-team-line text-amber-600 text-sm" />
            </div>
          </div>
          <p className="text-2xl font-bold text-zinc-900">{activeCount}</p>
          <p className="text-xs text-zinc-400 mt-1">{employees.length} no total</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Massa Salarial</span>
            <div className="w-8 h-8 flex items-center justify-center bg-orange-100 rounded-lg">
              <i className="ri-money-dollar-circle-line text-orange-600 text-sm" />
            </div>
          </div>
          <p className="text-2xl font-bold text-zinc-900">{formatCurrency(totalSalaryMass)}</p>
          <p className="text-xs text-zinc-400 mt-1">Salários base ativos</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Folha do Mês</span>
            <div className="w-8 h-8 flex items-center justify-center bg-green-100 rounded-lg">
              <i className="ri-file-list-3-line text-green-600 text-sm" />
            </div>
          </div>
          <p className="text-2xl font-bold text-zinc-900">{formatCurrency(totalLiquido)}</p>
          <p className="text-xs text-zinc-400 mt-1">Líquido — {monthLabel(selectedMonth)}</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Pendente</span>
            <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg">
              <i className="ri-time-line text-red-500 text-sm" />
            </div>
          </div>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(totalPendente)}</p>
          <p className="text-xs text-zinc-400 mt-1">{pendingEntries.length} lançamento(s)</p>
        </div>
      </div>

      {/* Alertas */}
      {activeView === 'funcionarios' && (empWithVacation.length > 0 || empWithPending13.length > 0) && (
        <div className="flex gap-3 flex-wrap">
          {empWithVacation.length > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex-1 min-w-64">
              <i className="ri-sun-line text-amber-600 text-lg flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-800">{empWithVacation.length} funcionário(s) com férias disponíveis</p>
                <p className="text-xs text-amber-600">Clique no ícone ☀ para gerar o pagamento de férias</p>
              </div>
            </div>
          )}
          {empWithPending13.length > 0 && (
            <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 flex-1 min-w-64">
              <i className="ri-gift-line text-zinc-500 text-lg flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-zinc-700">{empWithPending13.length} funcionário(s) com 13º pendente</p>
                <p className="text-xs text-zinc-400">Gere os lançamentos na aba Folha</p>
              </div>
              <button onClick={() => setThirteenthModal(true)}
                className="text-xs font-semibold text-amber-600 hover:text-amber-700 cursor-pointer whitespace-nowrap">
                Gerar 13º
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between flex-wrap gap-3">
        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <button onClick={() => setActiveView('folha')}
            className={`px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeView === 'folha' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
            <i className="ri-file-list-3-line" /> Folha de Pagamento
          </button>
          <button onClick={() => setActiveView('funcionarios')}
            className={`px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeView === 'funcionarios' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
            <i className="ri-team-line" /> Funcionários
          </button>
          <button onClick={() => setActiveView('relatorio')}
            className={`px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeView === 'relatorio' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
            <i className="ri-bar-chart-2-line" /> Relatórios
          </button>
        </div>

        {activeView === 'folha' && (
          <div className="flex items-center gap-2 flex-wrap mt-1 sm:mt-0">
            <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-lg overflow-hidden">
              <button onClick={() => setSelectedMonth(m => addMonths(m, -1))}
                className="w-9 h-9 flex items-center justify-center hover:bg-zinc-50 cursor-pointer text-zinc-500 transition-colors">
                <i className="ri-arrow-left-s-line" />
              </button>
              <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                className="border-0 px-2 py-2 text-sm font-semibold text-zinc-800 focus:outline-none bg-transparent text-center" />
              <button onClick={() => canGoNext && setSelectedMonth(m => addMonths(m, 1))} disabled={!canGoNext}
                className="w-9 h-9 flex items-center justify-center hover:bg-zinc-50 cursor-pointer text-zinc-500 transition-colors disabled:opacity-30">
                <i className="ri-arrow-right-s-line" />
              </button>
            </div>
            {/* Gerar 13º */}
            <button onClick={() => setThirteenthModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-gift-line" /> 13º Salário
            </button>
            {entries.length === 0 && employees.filter(e => e.status === 'active').length > 0 && (
              <button onClick={handleGenerateFolha}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
                <i className="ri-magic-line" /> Gerar do Cadastro
              </button>
            )}

            {pendingEntries.length > 0 && (
              <button onClick={() => setFechamentoModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
                <i className="ri-check-double-line" /> Fechar e Pagar ({pendingEntries.length})
              </button>
            )}
            <button onClick={() => setCamposCustomizadosModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-settings-3-line" /> Campos
            </button>
            <button onClick={() => setPayrollModal({})}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-add-line" /> Adicionar
            </button>
          </div>
        )}

        {activeView === 'funcionarios' && (
          <div className="flex items-center gap-2 flex-wrap mt-1 sm:mt-0">
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar funcionário..."
                className="pl-8 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-amber-400 w-48" />
            </div>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white">
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button onClick={() => setEmployeeModal({})}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-add-line" /> Novo Funcionário
            </button>
          </div>
        )}
      </div>

      {/* ── FOLHA ── */}
      {activeView === 'folha' && (
        <div className="space-y-4">
          {entries.length > 0 && (
            <div className="bg-white rounded-xl border border-zinc-200 p-4 md:p-5">
              <h3 className="text-sm font-semibold text-zinc-800 mb-3 md:mb-4">Resumo — {monthLabel(selectedMonth)}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 md:gap-4">
                {[
                  { label: 'Salário Bruto', value: totalBruto, color: 'text-zinc-800' },
                  { label: 'INSS Total', value: totalINSS, color: 'text-orange-600' },
                  { label: 'IRRF Total', value: totalIRRF, color: 'text-red-500' },
                  { label: 'FGTS Total', value: totalFGTS, color: 'text-amber-600' },
                  { label: 'Salário Líquido', value: totalLiquido, color: 'text-zinc-800' },
                  { label: 'Já Pago', value: totalPago, color: 'text-green-600' },
                ].map(item => (
                  <div key={item.label} className="text-center">
                    <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
                    <p className={`text-base font-bold ${item.color}`}>{formatCurrency(item.value)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-zinc-500">Progresso de pagamento</span>
                  <span className="text-xs font-semibold text-zinc-700">{totalLiquido > 0 ? ((totalPago / totalLiquido) * 100).toFixed(0) : 0}%</span>
                </div>
                <div className="w-full bg-zinc-100 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full transition-all duration-700"
                    style={{ width: `${totalLiquido > 0 ? (totalPago / totalLiquido) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="overflow-x-auto">
            {payLoading ? (
              <div className="p-8 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : entries.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mx-auto mb-4">
                  <i className="ri-file-list-3-line text-zinc-400 text-2xl" />
                </div>
                <p className="text-sm font-semibold text-zinc-700">Nenhum lançamento em {monthLabel(selectedMonth)}</p>
                <p className="text-xs text-zinc-400 mt-1 mb-4">Gere automaticamente ou adicione manualmente</p>
                <div className="flex items-center justify-center gap-3">
                  {employees.filter(e => e.status === 'active').length > 0 && (
                    <button onClick={handleGenerateFolha}
                      className="flex items-center gap-1.5 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors">
                      <i className="ri-magic-line" /> Gerar do Cadastro
                    </button>
                  )}
                  <button onClick={() => setPayrollModal({})}
                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors">
                    <i className="ri-add-line" /> Adicionar Manualmente
                  </button>
                </div>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Funcionário</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Depto / Tipo</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Proventos</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">INSS</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">IRRF</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Descontos</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Líquido</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {entries.map(entry => (
                    <tr key={entry.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-zinc-800">{entry.employee_name}</p>
                        <p className="text-xs text-zinc-400">{entry.role}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-medium w-fit">{entry.department}</span>
                          {entry.entry_type && entry.entry_type !== 'regular' && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium w-fit">
                              {ENTRY_TYPE_LABELS[entry.entry_type]}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-right text-zinc-700 font-medium">{formatCurrency(entry.total_proventos ?? entry.gross_salary)}</td>
                      <td className="px-4 py-3.5 text-sm text-right text-orange-600">{formatCurrency(entry.inss)}</td>
                      <td className="px-4 py-3.5 text-sm text-right text-red-500">{formatCurrency(entry.irrf)}</td>
                      <td className="px-4 py-3.5 text-sm text-right text-red-600">{formatCurrency(entry.total_descontos ?? entry.deductions)}</td>
                      <td className="px-4 py-3.5 text-sm text-right font-bold text-zinc-900">{formatCurrency(entry.net_salary)}</td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${PAYROLL_STATUS_COLORS[entry.status]}`}>
                          {PAYROLL_STATUS_LABELS[entry.status]}
                        </span>
                        {entry.paid_date && (
                          <p className="text-xs text-zinc-400 mt-0.5">{new Date(entry.paid_date + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1 justify-end">
                          {entry.status === 'pending' && (
                            <button onClick={() => markPaid(entry.id, new Date().toISOString().split('T')[0], 'Transferência')}
                              title="Marcar como pago"
                              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-100 text-green-600 cursor-pointer transition-colors">
                              <i className="ri-check-line text-sm" />
                            </button>
                          )}
                          <button onClick={() => setPayrollModal(entry)} title="Editar"
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer transition-colors">
                            <i className="ri-edit-line text-sm" />
                          </button>
                          <button onClick={() => removePayroll(entry.id)} title="Remover"
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-100 text-red-500 cursor-pointer transition-colors">
                            <i className="ri-delete-bin-line text-sm" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-50 border-t-2 border-zinc-200">
                    <td colSpan={2} className="px-5 py-3 text-sm font-bold text-zinc-800">Total</td>
                    <td className="px-4 py-3 text-sm font-bold text-right text-zinc-800">{formatCurrency(totalBruto)}</td>
                    <td className="px-4 py-3 text-sm font-bold text-right text-orange-600">{formatCurrency(totalINSS)}</td>
                    <td className="px-4 py-3 text-sm font-bold text-right text-red-500">{formatCurrency(totalIRRF)}</td>
                    <td className="px-4 py-3 text-sm font-bold text-right text-red-600">{formatCurrency(totalLiquido > 0 ? totalBruto - totalLiquido : 0)}</td>
                    <td className="px-4 py-3 text-sm font-bold text-right text-zinc-900">{formatCurrency(totalLiquido)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            )}
            </div>
          </div>
        </div>
      )}

      {/* ── FUNCIONÁRIOS ── */}
      {activeView === 'funcionarios' && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          {empLoading ? (
            <div className="p-8 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mx-auto mb-4">
                <i className="ri-team-line text-zinc-400 text-2xl" />
              </div>
              <p className="text-sm font-semibold text-zinc-700">Nenhum funcionário cadastrado</p>
              <p className="text-xs text-zinc-400 mt-1 mb-4">Cadastre os funcionários para gerar a folha automaticamente</p>
              <button onClick={() => setEmployeeModal({})}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors">
                <i className="ri-add-line" /> Cadastrar Funcionário
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Funcionário</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Departamento</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Admissão</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Salário</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Férias</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">13º</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredEmployees.map(emp => (
                    <EmployeeRow
                      key={emp.id}
                      emp={emp}
                      onEdit={() => setEmployeeModal(emp)}
                      onRemove={() => removeEmployee(emp.id)}
                      onVacation={() => setVacationModal(emp)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── RELATÓRIOS ── */}
      {activeView === 'relatorio' && (
        <RHRelatorioTab />
      )}

      {/* Modals */}
      {employeeModal !== false && (
        <EmployeeModal employee={employeeModal} onClose={() => setEmployeeModal(false)} onSave={upsertEmployee} />
      )}
      {payrollModal !== false && (
        <PayrollModal
          entry={payrollModal}
          employees={employees}
          onClose={() => setPayrollModal(false)}
          onSave={upsertPayroll}
          showCamposModal={() => setCamposCustomizadosModal(true)}
        />
      )}
      {camposCustomizadosModal && (
        <CamposCustomizadosModal onClose={() => setCamposCustomizadosModal(false)} />
      )}
      {fechamentoModal && (
        <FechamentoFolhaModal
          entries={pendingEntries}
          onClose={() => setFechamentoModal(false)}
          onConfirm={async (updatedEntries) => {
            // Salva os descontos aplicados no banco
            for (const entry of updatedEntries) {
              await upsertPayroll(entry);
            }
            const newTotal = updatedEntries.reduce((s, e) => s + Number(e.net_salary), 0);
            setAdjustedTotalPendente(newTotal);
            setFechamentoModal(false);
            setPayAllModal(true);
          }}
        />
      )}
      {payAllModal && (
        <PayAllModal
          count={pendingEntries.length}
          total={adjustedTotalPendente ?? totalPendente}
          onClose={() => { setPayAllModal(false); setAdjustedTotalPendente(null); }}
          onConfirm={(date, method) => {
            markAllPaid(pendingEntries.map(e => e.id), date, method);
            setAdjustedTotalPendente(null);
          }}
        />
      )}
      {vacationModal && (
        <VacationModal
          employee={vacationModal}
          onClose={() => setVacationModal(null)}
          onGeneratePay={generateVacationPay}
        />
      )}
      {thirteenthModal && (
        <ThirteenthModal
          employees={employees}
          onClose={() => setThirteenthModal(false)}
          onGenerate={generateThirteenth}
        />
      )}
      {relatorioModal && (
        <FolhaRelatorioPDF
          entries={entries}
          month={selectedMonth}
          onClose={() => setRelatorioModal(false)}
        />
      )}
    </div>
  );
}
