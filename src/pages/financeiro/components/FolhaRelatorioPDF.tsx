import { useMemo, useEffect } from 'react';
import type { PayrollEntry } from '@/hooks/useRH';
import { formatCurrency } from '@/lib/formatters';

interface Props {
  entries: PayrollEntry[];
  month: string;
  companyName?: string;
  onClose: () => void;
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export default function FolhaRelatorioPDF({ entries, month, companyName = 'Empresa', onClose }: Props) {
  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => ({
        base: acc.base + Number(e.base_salary),
        overtime50: acc.overtime50 + Number(e.overtime_50 || 0),
        overtime100: acc.overtime100 + Number(e.overtime_100 || 0),
        nightShift: acc.nightShift + Number(e.night_shift_value || 0),
        dsr: acc.dsr + Number(e.dsr_value || 0),
        bonuses: acc.bonuses + Number(e.bonuses || 0),
        otherBonuses: acc.otherBonuses + Number(e.other_bonuses || 0),
        proventos: acc.proventos + Number(e.total_proventos || e.gross_salary),
        inss: acc.inss + Number(e.inss || 0),
        irrf: acc.irrf + Number(e.irrf || 0),
        fgts: acc.fgts + Number(e.fgts || 0),
        vt: acc.vt + Number(e.vale_transporte || 0),
        vr: acc.vr + Number(e.vale_refeicao || 0),
        otherDeductions: acc.otherDeductions + Number(e.other_deductions || 0),
        descontoFaltas: acc.descontoFaltas + Number(e.desconto_faltas || 0),
        descontos: acc.descontos + Number(e.total_descontos || e.deductions || 0),
        liquido: acc.liquido + Number(e.net_salary),
      }),
      {
        base: 0, overtime50: 0, overtime100: 0, nightShift: 0, dsr: 0,
        bonuses: 0, otherBonuses: 0, proventos: 0, inss: 0, irrf: 0,
        fgts: 0, vt: 0, vr: 0, otherDeductions: 0, descontoFaltas: 0,
        descontos: 0, liquido: 0,
      }
    );
  }, [entries]);

  const today = new Date().toLocaleDateString('pt-BR');

  // Abre em nova janela para impressão limpa
  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) return;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Relatório Folha — ${monthLabel(month)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11px; color: #27272a; background: #fff; padding: 32px; }
    h1 { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #18181b; text-align: center; }
    h2 { font-size: 14px; font-weight: 600; color: #3f3f46; text-align: center; margin-top: 4px; }
    .subtitle { text-align: center; color: #71717a; font-size: 11px; margin-top: 4px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .kpi-box { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 12px; text-align: center; }
    .kpi-box .label { font-size: 10px; color: #71717a; margin-bottom: 4px; }
    .kpi-box .value { font-size: 13px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 20px; }
    th, td { padding: 6px 4px; text-align: right; border-bottom: 1px solid #e4e4e7; }
    th:first-child, td:first-child { text-align: left; padding-left: 8px; }
    th:last-child, td:last-child { padding-right: 8px; }
    th { background: #f4f4f5; font-weight: 600; color: #3f3f46; border-top: 1px solid #d4d4d8; }
    tfoot td { background: #f4f4f5; font-weight: 700; border-top: 2px solid #a1a1aa; }
    .name { font-weight: 600; color: #18181b; }
    .role { color: #a1a1aa; font-size: 9px; }
    .green { color: #15803d; }
    .red { color: #dc2626; }
    .orange { color: #ea580c; }
    .amber { color: #b45309; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
    .summary-box { border: 1px solid #e4e4e7; border-radius: 8px; padding: 16px; }
    .summary-box h4 { font-size: 10px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .summary-row { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 6px; }
    .summary-row .label { color: #52525b; }
    .summary-row .value { font-weight: 500; }
    .summary-total { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; border-top: 1px solid #e4e4e7; padding-top: 8px; margin-top: 8px; }
    .footer { text-align: center; font-size: 9px; color: #a1a1aa; padding-top: 16px; border-top: 1px solid #e4e4e7; }
    @media print {
      body { padding: 16px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="text-align:center;margin-bottom:20px;">
    <button onclick="window.print()" style="padding:8px 24px;background:#f59e0b;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">
      Imprimir / Salvar como PDF
    </button>
  </div>

  <h1>${companyName}</h1>
  <h2>Relatório de Folha de Pagamento</h2>
  <p class="subtitle">Competência: ${monthLabel(month)} &nbsp;|&nbsp; Emitido em: ${today}</p>

  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="label">Total Bruto</div>
      <div class="value">${formatCurrency(totals.proventos)}</div>
    </div>
    <div class="kpi-box">
      <div class="label">Total Descontos</div>
      <div class="value red">-${formatCurrency(totals.descontos)}</div>
    </div>
    <div class="kpi-box">
      <div class="label">Total FGTS</div>
      <div class="value amber">${formatCurrency(totals.fgts)}</div>
    </div>
    <div class="kpi-box">
      <div class="label">Total Líquido</div>
      <div class="value green">${formatCurrency(totals.liquido)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Funcionário</th>
        <th>Base</th>
        <th>HE 50%</th>
        <th>HE 100%</th>
        <th>Noturno</th>
        <th>DSR</th>
        <th>Bônus</th>
        <th>Bruto</th>
        <th>INSS</th>
        <th>IRRF</th>
        <th>VT</th>
        <th>Faltas</th>
        <th>Outros</th>
        <th>Desc.</th>
        <th>Líquido</th>
      </tr>
    </thead>
    <tbody>
      ${entries.map(e => `
      <tr>
        <td>
          <div class="name">${e.employee_name}</div>
          <div class="role">${e.role} — ${e.department}</div>
        </td>
        <td>${formatCurrency(e.base_salary)}</td>
        <td>${formatCurrency(e.overtime_50 || 0)}</td>
        <td>${formatCurrency(e.overtime_100 || 0)}</td>
        <td>${formatCurrency(e.night_shift_value || 0)}</td>
        <td>${formatCurrency(e.dsr_value || 0)}</td>
        <td>${formatCurrency((e.bonuses || 0) + (e.other_bonuses || 0))}</td>
        <td><strong>${formatCurrency(e.total_proventos || e.gross_salary)}</strong></td>
        <td class="orange">-${formatCurrency(e.inss || 0)}</td>
        <td class="red">-${formatCurrency(e.irrf || 0)}</td>
        <td class="red">-${formatCurrency(e.vale_transporte || 0)}</td>
        <td class="red">-${formatCurrency(e.desconto_faltas || 0)}</td>
        <td class="red">-${formatCurrency((e.vale_refeicao || 0) + (e.other_deductions || 0))}</td>
        <td class="red"><strong>-${formatCurrency(e.total_descontos || e.deductions || 0)}</strong></td>
        <td class="green"><strong>${formatCurrency(e.net_salary)}</strong></td>
      </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td>TOTAL</td>
        <td>${formatCurrency(totals.base)}</td>
        <td>${formatCurrency(totals.overtime50)}</td>
        <td>${formatCurrency(totals.overtime100)}</td>
        <td>${formatCurrency(totals.nightShift)}</td>
        <td>${formatCurrency(totals.dsr)}</td>
        <td>${formatCurrency(totals.bonuses + totals.otherBonuses)}</td>
        <td>${formatCurrency(totals.proventos)}</td>
        <td class="orange">-${formatCurrency(totals.inss)}</td>
        <td class="red">-${formatCurrency(totals.irrf)}</td>
        <td class="red">-${formatCurrency(totals.vt)}</td>
        <td class="red">-${formatCurrency(totals.descontoFaltas)}</td>
        <td class="red">-${formatCurrency(totals.vr + totals.otherDeductions)}</td>
        <td class="red">-${formatCurrency(totals.descontos)}</td>
        <td class="green">${formatCurrency(totals.liquido)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="summary-grid">
    <div class="summary-box">
      <h4>Proventos</h4>
      <div class="summary-row"><span class="label">Salário Base</span><span class="value">${formatCurrency(totals.base)}</span></div>
      <div class="summary-row"><span class="label">Hora Extra 50%</span><span class="value">${formatCurrency(totals.overtime50)}</span></div>
      <div class="summary-row"><span class="label">Hora Extra 100%</span><span class="value">${formatCurrency(totals.overtime100)}</span></div>
      <div class="summary-row"><span class="label">Adic. Noturno</span><span class="value">${formatCurrency(totals.nightShift)}</span></div>
      <div class="summary-row"><span class="label">DSR</span><span class="value">${formatCurrency(totals.dsr)}</span></div>
      <div class="summary-row"><span class="label">Bônus/Comissões</span><span class="value">${formatCurrency(totals.bonuses)}</span></div>
      <div class="summary-row"><span class="label">Outros Proventos</span><span class="value">${formatCurrency(totals.otherBonuses)}</span></div>
      <div class="summary-total"><span>Total Proventos</span><span class="green">${formatCurrency(totals.proventos)}</span></div>
    </div>
    <div class="summary-box">
      <h4>Descontos</h4>
      <div class="summary-row"><span class="label">INSS</span><span class="value orange">-${formatCurrency(totals.inss)}</span></div>
      <div class="summary-row"><span class="label">IRRF</span><span class="value red">-${formatCurrency(totals.irrf)}</span></div>
      <div class="summary-row"><span class="label">Vale Transporte</span><span class="value red">-${formatCurrency(totals.vt)}</span></div>
      <div class="summary-row"><span class="label">Vale Refeição</span><span class="value red">-${formatCurrency(totals.vr)}</span></div>
      <div class="summary-row"><span class="label">Desconto Faltas</span><span class="value red">-${formatCurrency(totals.descontoFaltas)}</span></div>
      <div class="summary-row"><span class="label">Outros Descontos</span><span class="value red">-${formatCurrency(totals.otherDeductions)}</span></div>
      <div class="summary-total"><span>Total Descontos</span><span class="red">-${formatCurrency(totals.descontos)}</span></div>
    </div>
    <div class="summary-box">
      <h4>Encargos Empresa</h4>
      <div class="summary-row"><span class="label">FGTS (8%)</span><span class="value amber">${formatCurrency(totals.fgts)}</span></div>
      <div class="summary-row"><span class="label">INSS (empresa)</span><span class="value">—</span></div>
      <div class="summary-row"><span class="label">SAT/RAT</span><span class="value">—</span></div>
      <div class="summary-total"><span>Custo Total Empresa</span><span class="amber">${formatCurrency(totals.proventos + totals.fgts)}</span></div>
      <div class="summary-total" style="margin-top:4px;border-top:1px dashed #e4e4e7;"><span>Salário Líquido</span><span class="green">${formatCurrency(totals.liquido)}</span></div>
    </div>
  </div>

  <div class="footer">
    <p>Relatório gerado automaticamente pelo sistema de gestão.</p>
    <p>Este documento é de uso interno e não possui valor fiscal.</p>
  </div>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  // Auto-abre a janela de impressão ao montar
  useEffect(() => {
    handlePrint();
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 text-center">
        <div className="w-14 h-14 flex items-center justify-center bg-amber-100 rounded-2xl mx-auto mb-4">
          <i className="ri-file-pdf-line text-amber-600 text-2xl" />
        </div>
        <h3 className="text-base font-bold text-zinc-900 mb-2">Relatório de Folha</h3>
        <p className="text-sm text-zinc-500 mb-1">{monthLabel(month)}</p>
        <p className="text-xs text-zinc-400 mb-6">{entries.length} funcionário(s) no relatório</p>
        <div className="flex gap-3">
          <button
            onClick={handlePrint}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-2.5 text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-printer-line mr-1" /> Abrir para Imprimir
          </button>
          <button
            onClick={onClose}
            className="flex-1 border border-zinc-200 rounded-lg py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}