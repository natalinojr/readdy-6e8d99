import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia, somarDias } from '@/lib/dateUtils';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { ocorrenciasRecorrentes } from '@/lib/recorrencias';
import { KpiCard, Segmented } from './dreUi';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar, Legend,
} from 'recharts';

interface DayDetail {
  // 'auto_entrada' = entrada de caixa com origin automático (auto_sale, auto_suprimento…),
  // que antes era rotulada erradamente como "Entrada Manual".
  // 'nota_provisionada' = duplicata (boleto) de NF-e de entrada que chegou da SEFAZ e
  // AINDA NÃO foi lançada em Contas a Pagar. Ver o bloco de provisionamento no
  // buildProjection.
  tipo: 'recebivel' | 'auto_entrada' | 'conta_pagar' | 'folha' | 'manual_entrada' | 'manual_saida' | 'nota_provisionada';
  descricao: string;
  valor: number;
}

interface DayPoint {
  date: string;
  label: string;
  // Entradas separadas
  entradasAuto: number;      // entradas automáticas: recebíveis D+N + fin_cash_flow com origin auto_* (verde claro)
  entradasManuais: number;   // entradas manuais: fin_cash_flow origin 'manual' (verde escuro)
  // Saídas separadas
  saidasFolha: number;       // folha (vermelho claro)
  saidasContas: number;      // contas a pagar (vermelho escuro)
  saidasManuais: number;     // saídas manuais (laranja)
  saidasProvisionadas: number; // boleto de nota de entrada ainda não lançada (âmbar)
  // Totais calculados
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  saldoAcumulado: number;
  detalhes: DayDetail[];
}

interface Receivable {
  id: string;
  due_date: string;
  amount: number;
  status: string;
  payment_method_name: string | null;
  order_number: string | null;
}

interface Payable {
  due_date: string;
  amount: number;
  paid_amount: number | null;
  status: string;
  description: string;
  is_recurring?: boolean | null;
  recurrence_end_date?: string | null;
}

/** Nota de entrada (SEFAZ) que ainda não virou compra/despesa — ver bloco de provisionamento. */
interface NotaPendente {
  id: string;
  numero: number | null;
  emitente_nome: string | null;
  parcelas: Array<{ numero?: string; vencimento: string; valor: number }> | null;
}

interface PayrollEntry {
  net_salary: number;
  status: string;
  reference_month: string;
  employee_name: string;
}

interface CashFlowEntry {
  date: string;
  amount: number;
  type: 'income' | 'expense';
  origin?: string;
  description?: string;
}

const HORIZON_OPTIONS = [
  { label: '30 dias', days: 30 },
  { label: '60 dias', days: 60 },
  { label: '90 dias', days: 90 },
];

// Paleta de cores das 6 séries
const SERIES_COLORS = {
  entradasAuto: '#4ade80',    // verde claro
  entradasManuais: '#16a34a', // verde escuro
  saidasFolha: '#fca5a5',     // vermelho claro
  saidasContas: '#dc2626',    // vermelho escuro
  saidasManuais: '#f97316',   // laranja
  saidasProvisionadas: '#a16207', // âmbar escuro (boleto de nota não lançada)
  saldoAcumulado: '#f59e0b',  // âmbar (linha de saldo)
};

const TIPO_CONFIG: Record<DayDetail['tipo'], { label: string; color: string; icon: string; sinal: '+' | '-'; textColor: string }> = {
  recebivel:      { label: 'Recebível D+N',   color: SERIES_COLORS.entradasAuto,    icon: 'ri-bank-card-line',  sinal: '+', textColor: 'text-green-600' },
  auto_entrada:   { label: 'Entrada Automática', color: SERIES_COLORS.entradasAuto, icon: 'ri-store-2-line',    sinal: '+', textColor: 'text-green-600' },
  manual_entrada: { label: 'Entrada Manual',  color: SERIES_COLORS.entradasManuais, icon: 'ri-add-circle-line', sinal: '+', textColor: 'text-green-800' },
  conta_pagar:    { label: 'Conta a Pagar',   color: SERIES_COLORS.saidasContas,    icon: 'ri-bill-line',       sinal: '-', textColor: 'text-red-700' },
  folha:          { label: 'Folha de Pagto',  color: SERIES_COLORS.saidasFolha,     icon: 'ri-team-line',       sinal: '-', textColor: 'text-red-400' },
  manual_saida:   { label: 'Saída Manual',    color: SERIES_COLORS.saidasManuais,   icon: 'ri-subtract-line',   sinal: '-', textColor: 'text-orange-600' },
  nota_provisionada: { label: 'Nota não lançada', color: SERIES_COLORS.saidasProvisionadas, icon: 'ri-file-warning-line', sinal: '-', textColor: 'text-amber-700' },
};

// Tipos de detalhe que somam ENTRADA de caixa. Centralizado porque agora são
// três (recebível, entrada automática do razão e entrada manual) e a lista era
// repetida em dois pontos da tela.
const ENTRADA_TIPOS: DayDetail['tipo'][] = ['recebivel', 'auto_entrada', 'manual_entrada'];

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(d: Date) {
  return d.toISOString().split('T')[0];
}

/** Retorna a data local do dispositivo no formato YYYY-MM-DD (sem depender de UTC) */
function localDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Competência 'YYYY-MM' de uma data local */
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Data de pagamento PROJETADA de uma folha pendente.
 *
 * PORQUÊ: `hr_payroll` NÃO tem coluna de "data prevista de pagamento" — só
 * `paid_date`, que fica NULL até o `pay_payroll` quitar a folha. Filtrar a
 * previsão por `paid_date` (como era feito) descartava 100% das folhas
 * pendentes, porque em SQL `NULL >= data` é NULL. A única âncora temporal
 * disponível numa folha pendente é a COMPETÊNCIA (`reference_month`, texto
 * 'YYYY-MM').
 *
 * ESCOLHA: projetamos no 5º dia do mês SEGUINTE ao da competência — é o prazo
 * legal da CLT (art. 459 §1º) e o que a loja pratica.
 * LIMITAÇÃO: a lei fala em 5º dia ÚTIL; aqui usamos o dia 5 corrido, apenas
 * empurrando para segunda-feira quando cai no fim de semana (não há calendário
 * de feriados no sistema). O erro fica em poucos dias, dentro do mesmo mês.
 */
function payrollProjectedDate(referenceMonth: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec((referenceMonth ?? '').slice(0, 7));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12; como Date usa mês 0-based, `month` já é o mês SEGUINTE
  const d = new Date(year, month, 5);
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() + 1);      // domingo → segunda
  else if (dow === 6) d.setDate(d.getDate() + 2); // sábado  → segunda
  return localDateKey(d);
}

// Tooltip customizado para o gráfico
const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; dataKey: string }[];
  label?: string;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const filtered = payload.filter((p) => p.value > 0);
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs min-w-52 max-w-64">
      <p className="font-bold text-zinc-700 mb-2 border-b border-zinc-100 pb-1.5">{label}</p>
      {filtered.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
            <span className="text-zinc-500">{p.name}</span>
          </div>
          <span className="font-semibold" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// Painel lateral de detalhes do dia clicado
function DayDetailPanel({
  point,
  onClose,
}: {
  point: DayPoint;
  onClose: () => void;
}) {
  const totalEntradas = point.totalEntradas;
  const totalSaidas = point.totalSaidas;

  // Tipos que representam ENTRADA de caixa (o resto é saída).
  const entradas = point.detalhes.filter((d) => ENTRADA_TIPOS.includes(d.tipo));
  const saidas = point.detalhes.filter((d) => !ENTRADA_TIPOS.includes(d.tipo));

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
        <div>
          <p className="text-xs text-zinc-400 font-medium">Detalhes do dia</p>
          <p className="text-sm font-bold text-zinc-800">{point.label}</p>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-200 cursor-pointer transition-colors"
        >
          <i className="ri-close-line text-zinc-500 text-sm" />
        </button>
      </div>

      {/* Resumo do dia */}
      <div className="grid grid-cols-2 gap-2 p-3 border-b border-zinc-100">
        <div className="bg-green-50 rounded-lg p-2.5">
          <p className="text-[11px] text-emerald-700 font-semibold uppercase tracking-wide">Entradas</p>
          <p className="text-sm font-bold tabular-nums text-emerald-700 mt-0.5">{formatCurrency(totalEntradas)}</p>
        </div>
        <div className="bg-red-50 rounded-lg p-2.5">
          <p className="text-[10px] text-red-600 font-semibold uppercase tracking-wide">Saídas</p>
          <p className="text-sm font-bold text-red-700 mt-0.5">{formatCurrency(totalSaidas)}</p>
        </div>
        <div className={`col-span-2 rounded-lg p-2.5 ${point.saldo >= 0 ? 'bg-amber-50' : 'bg-red-100'}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${point.saldo >= 0 ? 'text-amber-600' : 'text-red-600'}`}>Saldo do Dia</p>
          <p className={`text-sm font-bold mt-0.5 ${point.saldo >= 0 ? 'text-amber-700' : 'text-red-700'}`}>
            {point.saldo >= 0 ? '+' : ''}{formatCurrency(point.saldo)}
          </p>
        </div>
      </div>

      {/* Lista de itens */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {entradas.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Entradas</p>
            <div className="space-y-1.5">
              {entradas.map((d, i) => {
                const cfg = TIPO_CONFIG[d.tipo];
                return (
                  <div key={i} className="flex items-start gap-2 bg-green-50/60 rounded-lg px-2.5 py-2">
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i className={`${cfg.icon} text-xs`} style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</p>
                      <p className="text-xs text-zinc-600 truncate">{d.descricao}</p>
                    </div>
                    <span className="text-xs font-bold text-green-700 whitespace-nowrap">+{formatCurrency(d.valor)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {saidas.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Saídas</p>
            <div className="space-y-1.5">
              {saidas.map((d, i) => {
                const cfg = TIPO_CONFIG[d.tipo];
                return (
                  <div key={i} className="flex items-start gap-2 bg-red-50/40 rounded-lg px-2.5 py-2">
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i className={`${cfg.icon} text-xs`} style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</p>
                      <p className="text-xs text-zinc-600 truncate">{d.descricao}</p>
                    </div>
                    <span className={`text-xs font-bold whitespace-nowrap ${cfg.textColor}`}>-{formatCurrency(d.valor)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {point.detalhes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-300">
            <i className="ri-calendar-line text-3xl mb-2" />
            <p className="text-xs text-zinc-400">Sem movimentações neste dia</p>
          </div>
        )}
      </div>

      {/* Saldo acumulado até o dia */}
      <div className="px-3 py-2.5 border-t-2 border-zinc-200 bg-zinc-50">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Saldo acumulado até {point.label}</span>
          <span className={`text-sm font-bold ${point.saldoAcumulado >= 0 ? 'text-zinc-800' : 'text-red-700'}`}>
            {formatCurrency(point.saldoAcumulado)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function PrevisaoCaixaTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [horizon, setHorizon] = useState(30);
  const [loading, setLoading] = useState(true);
  const [projection, setProjection] = useState<DayPoint[]>([]);
  const [saldoAtual, setSaldoAtual] = useState(0);
  const [saldoSource, setSaldoSource] = useState<'banco' | 'razao'>('razao');
  // Quando alguma conta tem saldo sincronizado pela API do banco (Inter)
  const [saldoSyncedAt, setSaldoSyncedAt] = useState<string | null>(null);
  const [totalRecebiveis, setTotalRecebiveis] = useState(0);
  const [agendaQtd, setAgendaQtd] = useState(0);
  const [totalSaidas, setTotalSaidas] = useState(0);
  const [totalEntradas, setTotalEntradas] = useState(0);
  // Compromissos já VENCIDOS e em aberto, empilhados no dia de hoje.
  const [totalVencidas, setTotalVencidas] = useState(0);
  const [countVencidas, setCountVencidas] = useState(0);
  const [totalProvisionado, setTotalProvisionado] = useState(0);
  const [countNotasProvisionadas, setCountNotasProvisionadas] = useState(0);
  const [pendingReceivables, setPendingReceivables] = useState<Receivable[]>([]);
  const [viewMode, setViewMode] = useState<'area' | 'bar'>('area');
  const [showDetail, setShowDetail] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<DayPoint | null>(null);
  // O que JÁ VENCEU (contas, folha de meses anteriores, boletos de notas) caía todo em HOJE,
  // sem aviso — folha antiga nunca baixada derrubava a projeção inteira. Agora é uma caixinha
  // (2026-09-30): desligada, a projeção mostra só o que vence daqui para frente e o valor
  // atrasado fica à vista para ligar. A escolha fica guardada no aparelho.
  const [comAtrasados, setComAtrasados] = useState(() => {
    try { return localStorage.getItem('fin_fluxo_com_atrasados') === '1'; } catch { return false; }
  });
  const [atrasados, setAtrasados] = useState({ contas: 0, folha: 0, notas: 0, qtdContas: 0, qtdFolha: 0 });
  const alternarAtrasados = () => {
    setComAtrasados((v) => {
      try { localStorage.setItem('fin_fluxo_com_atrasados', v ? '0' : '1'); } catch { /* sem storage */ }
      return !v;
    });
  };

  const toggleDay = (date: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const buildProjection = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setSelectedDay(null);

    // "Hoje" pelo fuso de Brasília (helper canônico do projeto), não pelo relógio
    // do dispositivo: num notebook com fuso errado a projeção inteira deslizava
    // um dia e os compromissos de hoje caíam fora da janela.
    const todayStr = todayBrasilia();
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const today = new Date(ty, tm - 1, td);
    const endDate = addDays(today, horizon);
    const endDateStr = localDateKey(endDate);

    // Janela de COMPETÊNCIA da folha: uma folha de competência M é paga em M+1,
    // então para cobrir [hoje, fim do horizonte] precisamos das competências
    // desde o mês anterior ao de hoje até o mês do fim do horizonte.
    // O limite inferior (6 meses) é só uma trava de volume — folhas pendentes
    // mais antigas que isso são caso de saneamento, não de previsão.
    const payrollMinMonth = monthKey(new Date(today.getFullYear(), today.getMonth() - 6, 1));
    const payrollMaxMonth = monthKey(endDate);

    const [payablesRes, cashFlowsRes, pastFlowsRes, receivablesRes, payrollRes, bankAccountsRes, notasRes] = await Promise.all([
      // Contas a pagar: 'partial' TAMBÉM é dívida em aberto (invariante §8:
      // saldo devedor = amount − paid_amount). Filtrar só por 'pending' fazia a
      // conta paga pela metade sumir INTEIRA da previsão.
      //
      // SEM piso de data: uma conta VENCIDA e ainda em aberto continua sendo um
      // compromisso a honrar. O filtro `.gte('due_date', hoje)` a apagava da
      // projeção — o dono via saldo positivo enquanto tinha boletos atrasados na
      // gaveta. Agora tudo que vence até o fim do horizonte entra, e o que já
      // venceu é jogado em HOJE (mesmo tratamento que a folha em atraso já tinha).
      supabase
        .from('fin_accounts_payable')
        .select('due_date, amount, paid_amount, status, description, is_recurring, recurrence_end_date')
        .eq('tenant_id', user.tenantId)
        // 'overdue' É dívida em aberto. A rotina `fn_mark_overdue_bills` troca
        // 'pending' → 'overdue' assim que a data passa, então filtrar por
        // ['pending','partial'] descartava JUSTAMENTE as contas atrasadas — que
        // são as mais urgentes. Na base da loja, 100% das contas em aberto
        // estavam em 'overdue' e a projeção mostrava saída ZERO.
        .in('status', ['pending', 'partial', 'overdue'])
        .lte('due_date', endDateStr),

      supabase
        .from('fin_cash_flow')
        .select('date, amount, type, origin, description')
        .eq('tenant_id', user.tenantId)
        .eq('fora_do_caixa', false) // venda no cartão do PDV: o dinheiro entra pelo repasse da maquininha
        .gte('date', todayStr)
        .lte('date', endDateStr),

      // Saldo de abertura: PAGINADO. O PostgREST corta em ~1000 linhas sem
      // aviso, e o razão de uma loja passa disso em poucos meses — o saldo
      // inicial da projeção ia subnotificando sozinho conforme o histórico crescia.
      fetchAllRows<{ amount: number; type: string }>((from, to) =>
        supabase
          .from('fin_cash_flow')
          .select('amount, type')
          .eq('tenant_id', user.tenantId)
          .eq('fora_do_caixa', false)
          .lt('date', todayStr)
          .range(from, to)
      ),

      // Recebível pendente com vencimento no passado também entra (cai em HOJE):
      // é dinheiro que a loja ainda espera receber, não some da projeção.
      supabase
        .from('fin_receivable_installments')
        .select('id, due_date, amount, status, payment_method_name, order_number')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'pending')
        .lte('due_date', endDateStr),

      // Folha pendente: filtrada por COMPETÊNCIA, não por `paid_date`.
      // `paid_date` é NULL enquanto a folha não é paga, e `NULL >= data` em SQL
      // é NULL → o filtro antigo devolvia SEMPRE vazio (nenhum centavo de folha
      // entrava na previsão, apesar do rótulo "contas a pagar + folha").
      supabase
        .from('hr_payroll')
        .select('net_salary, status, reference_month, employee_name')
        .eq('tenant_id', user.tenantId)
        .in('status', ['pending', 'processing', 'partial'])
        .gte('reference_month', payrollMinMonth)
        .lte('reference_month', payrollMaxMonth),

      supabase
        .from('fin_bank_accounts')
        .select('current_balance, synced_balance, synced_balance_at, synced_provider')
        .eq('tenant_id', user.tenantId)
        .eq('is_active', true),

      // Nota de entrada que chegou da SEFAZ e AINDA NÃO foi lançada (status 'new').
      // O boleto dela existe e vai ser cobrado, mas enquanto ninguém confere a nota
      // não há linha em fin_accounts_payable — e a previsão mostrava saldo otimista.
      // Caso real (2026-09-21): 18 parcelas vencidas, R$ 8.236,50, invisíveis aqui.
      // Só entram as com duplicata (`cobr/dup` do XML); nota à vista/cartão não tem
      // boleto e não é compromisso futuro. 'ignored' e 'imported' ficam de fora — esta
      // última já virou conta a pagar e seria contada duas vezes.
      supabase
        .from('fiscal_inbound_documents')
        .select('id, numero, emitente_nome, parcelas')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'new')
        // `sefaz_status` é NULL enquanto a nota não é consultada, e `NULL != 2` em SQL
        // é NULL — um `.neq()` sozinho descartaria justamente as notas mais novas.
        .or('sefaz_status.is.null,sefaz_status.neq.2')
        .not('parcelas', 'is', null),
    ]);

    // P5: saldo inicial da projeção.
    // Preferimos o saldo bancário real (fin_bank_accounts) quando os bancos estão em uso;
    // se ainda não há saldo em banco (contas não configuradas / sem income routing),
    // caímos no proxy do livro-razão (fin_cash_flow acumulado até ontem).
    // Conta integrada ao banco (Inter) traz o saldo REAL sincronizado pela API;
    // nas demais vale o razão interno (current_balance).
    const accs = bankAccountsRes.data ?? [];
    const bankBalance = accs.reduce((s, b) => s + Number(b.synced_balance ?? b.current_balance ?? 0), 0);
    const synced = accs.filter((b) => b.synced_balance != null);
    const ledgerBalance = (pastFlowsRes.rows ?? []).reduce((acc, f) => {
      return acc + (f.type === 'income' ? Number(f.amount) : -Number(f.amount));
    }, 0);
    const usaBanco = synced.length > 0 || Math.abs(bankBalance) > 0.001;
    const currentBalance = usaBanco ? bankBalance : ledgerBalance;
    setSaldoAtual(currentBalance);
    setSaldoSource(usaBanco ? 'banco' : 'razao');
    setSaldoSyncedAt(synced.length > 0 ? synced.map((b) => String(b.synced_balance_at ?? '')).sort().pop() ?? null : null);

    // Mapa dia a dia com 5 categorias separadas
    const dayMap: Record<string, {
      entradasAuto: number;
      entradasManuais: number;
      saidasFolha: number;
      saidasContas: number;
      saidasManuais: number;
      saidasProvisionadas: number;
      detalhes: DayDetail[];
    }> = {};

    for (let i = 0; i <= horizon; i++) {
      const d = addDays(today, i);
      dayMap[localDateKey(d)] = {
        entradasAuto: 0,
        entradasManuais: 0,
        saidasFolha: 0,
        saidasContas: 0,
        saidasManuais: 0,
        saidasProvisionadas: 0,
        detalhes: [],
      };
    }

    // Contas a pagar → saídas contas (vermelho escuro)
    // Projetamos o SALDO DEVEDOR (amount − paid_amount), não o valor cheio:
    // uma conta com pagamento parcial só deve pressionar o caixa pelo que falta.
    // Conta VENCIDA e em aberto entra em HOJE: o dinheiro já deveria ter saído,
    // então ela pressiona o caixa a partir de agora, não na data que passou.
    let totalVencidas = 0;
    let countVencidas = 0;
    (payablesRes.data ?? []).forEach((p: Payable) => {
      const venceu = p.due_date < todayStr;
      const k = venceu ? todayStr : p.due_date;
      const saldoDevedor = Number(p.amount) - Number(p.paid_amount ?? 0);
      if (dayMap[k] && saldoDevedor > 0.005) {
        if (venceu) { totalVencidas += saldoDevedor; countVencidas += 1; }
        if (venceu && !comAtrasados) return;
        dayMap[k].saidasContas += saldoDevedor;
        const base = p.description ?? 'Conta a pagar';
        const parcial = p.status === 'partial' ? ' (saldo restante)' : '';
        const atraso = venceu
          ? ` — VENCIDA em ${new Date(p.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}`
          : '';
        dayMap[k].detalhes.push({
          tipo: 'conta_pagar',
          descricao: `${base}${parcial}${atraso}`,
          valor: saldoDevedor,
        });
      }
    });
    // Recorrentes: a tabela só tem a próxima ocorrência; os meses seguintes do horizonte
    // entram como previstos (o aluguel de novembro não aparecia na previsão de 90 dias).
    ocorrenciasRecorrentes((payablesRes.data ?? []) as Payable[], endDateStr).forEach((o) => {
      if (!dayMap[o.due_date] || !(o.amount > 0.005)) return;
      dayMap[o.due_date].saidasContas += o.amount;
      dayMap[o.due_date].detalhes.push({ tipo: 'conta_pagar', descricao: `${o.description} (recorrente — prevista)`, valor: o.amount });
    });
    setTotalVencidas(totalVencidas);
    setCountVencidas(countVencidas);

    // Boleto de nota de entrada ainda NÃO lançada → saída provisionada (âmbar).
    // Não é conta a pagar: ninguém conferiu a nota ainda, e ela pode virar compra,
    // despesa ou ser ignorada. Mas o fornecedor vai cobrar do mesmo jeito, então o
    // compromisso pressiona o caixa aqui — separado, para o dono ver que falta
    // confirmar. Some daqui no instante em que a nota é lançada (vira 'imported' e
    // ganha linha em fin_accounts_payable) ou ignorada.
    // Vencida cai em HOJE, mesmo tratamento das contas a pagar e da folha.
    let totalProv = 0;
    let atrasoNotas = 0;
    const notasProv = new Set<string>();
    ((notasRes.data ?? []) as NotaPendente[]).forEach((n) => {
      (n.parcelas ?? []).forEach((p) => {
        const valor = Number(p.valor ?? 0);
        const venc = String(p.vencimento ?? '').slice(0, 10);
        if (!(valor > 0.005) || !/^\d{4}-\d{2}-\d{2}$/.test(venc)) return;
        const venceu = venc < todayStr;
        const k = venceu ? todayStr : venc;
        if (!dayMap[k]) return;
        totalProv += valor;
        notasProv.add(n.id);
        if (venceu) { atrasoNotas += valor; if (!comAtrasados) return; }
        dayMap[k].saidasProvisionadas += valor;
        const fornecedor = (n.emitente_nome ?? 'Fornecedor').slice(0, 40);
        const atraso = venceu
          ? ` — VENCIDA em ${new Date(venc + 'T12:00:00').toLocaleDateString('pt-BR')}`
          : '';
        dayMap[k].detalhes.push({
          tipo: 'nota_provisionada',
          descricao: `${fornecedor}${n.numero ? ` · NF ${n.numero}` : ''} — nota ainda não lançada${atraso}`,
          valor,
        });
      });
    });
    setTotalProvisionado(totalProv);
    setCountNotasProvisionadas(notasProv.size);

    // Fluxo de caixa → classificado por `origin` (§1 do FINANCEIRO_MAP), tanto
    // nas SAÍDAS quanto nas ENTRADAS. Antes só as saídas olhavam o `origin`:
    // toda entrada futura era carimbada "Entrada Manual", inclusive `auto_sale`
    // e `auto_suprimento`, o que fazia legenda, série do gráfico e tabela mentirem.
    const AUTO_PURCHASE_ORIGINS = ['auto_purchase', 'auto_bill_payment'];
    const isManualOrigin = (origin?: string) => !origin || origin === 'manual';
    (cashFlowsRes.data ?? []).forEach((f: CashFlowEntry) => {
      const k = f.date;
      // Assimetria proposital entre os dois caminhos de saldo inicial:
      // • saldo BANCÁRIO (`current_balance`) já é o saldo de AGORA, então os
      //   lançamentos de hoje no razão já estão embutidos nele — somá-los de
      //   novo no dayMap seria dupla contagem;
      // • saldo do RAZÃO é acumulado só até ONTEM (`.lt('date', todayStr)`),
      //   então os lançamentos de hoje precisam entrar no dayMap.
      // Contas a pagar / recebíveis de hoje continuam entrando nos dois casos:
      // são previsões (ainda não liquidadas), não estão no saldo do banco.
      if (usaBanco && k === todayStr) return;
      if (dayMap[k]) {
        if (f.type === 'income') {
          if (isManualOrigin(f.origin)) {
            dayMap[k].entradasManuais += Number(f.amount);
            dayMap[k].detalhes.push({
              tipo: 'manual_entrada',
              descricao: f.description || 'Entrada manual',
              valor: Number(f.amount),
            });
          } else {
            // auto_sale (venda / liquidação de recebível), auto_suprimento etc.
            dayMap[k].entradasAuto += Number(f.amount);
            dayMap[k].detalhes.push({
              tipo: 'auto_entrada',
              descricao: f.description || 'Entrada automática (venda/recebimento)',
              valor: Number(f.amount),
            });
          }
        } else if (f.origin && AUTO_PURCHASE_ORIGINS.includes(f.origin)) {
          // Compras e pagamentos de contas automáticos → saídas contas (vermelho escuro)
          dayMap[k].saidasContas += Number(f.amount);
          dayMap[k].detalhes.push({
            tipo: 'conta_pagar',
            descricao: f.description || 'Compra / Conta paga',
            valor: Number(f.amount),
          });
        } else {
          dayMap[k].saidasManuais += Number(f.amount);
          dayMap[k].detalhes.push({
            tipo: 'manual_saida',
            descricao: f.description || 'Saída manual',
            valor: Number(f.amount),
          });
        }
      }
    });

    // Recebíveis D+N → entradas automáticas (verde claro)
    const receivables = (receivablesRes.data ?? []) as Receivable[];
    receivables.forEach((r) => {
      const atrasado = r.due_date < todayStr;
      const k = atrasado ? todayStr : r.due_date;
      if (dayMap[k]) {
        dayMap[k].entradasAuto += Number(r.amount);
        dayMap[k].detalhes.push({
          tipo: 'recebivel',
          descricao: `Pedido ${r.order_number ?? '—'} · ${r.payment_method_name ?? 'Cartão'}${atrasado ? ' — em atraso' : ''}`,
          valor: Number(r.amount),
        });
      }
    });
    setPendingReceivables(receivables);

    // Agenda das maquininhas e do iFood (fin_agenda_recebiveis, 2026-09-25): cartão Stone ainda
    // não pago (data em que cai) e repasse do iFood previsto. Só de amanhã em diante — o que cai
    // hoje já está no saldo do banco. Mercado Pago não precisa: já vem no razão na data de liberação.
    let sumAgenda = 0;
    let qtdAgenda = 0;
    const { data: agendaData, error: agendaErr } = await supabase.rpc('fin_agenda_recebiveis', {
      p_tenant: user.tenantId, p_from: somarDias(todayStr, 1), p_to: endDateStr,
    });
    if (agendaErr) console.error('[PrevisaoCaixaTab] agenda de recebíveis:', agendaErr.message);
    ((agendaData ?? []) as Array<{ data: string; origem: string; valor: number; qtd: number; descricao: string }>).forEach((a) => {
      const v = Number(a.valor);
      if (!dayMap[a.data] || !(v > 0.005)) return;
      dayMap[a.data].entradasAuto += v;
      dayMap[a.data].detalhes.push({
        tipo: 'recebivel',
        descricao: a.origem === 'stone' ? `${a.descricao} (${a.qtd} venda${a.qtd > 1 ? 's' : ''})` : a.descricao,
        valor: v,
      });
      sumAgenda += v;
      qtdAgenda += 1;
    });
    setAgendaQtd(qtdAgenda);

    // Folha → saídas folha (vermelho claro)
    // A data de saída é PROJETADA a partir da competência (ver payrollProjectedDate).
    // Folha vencida e ainda pendente (data projetada no passado) é jogada em HOJE:
    // continua sendo dívida a pagar e some da previsão se for descartada.
    // LIMITAÇÃO: `hr_payroll` não tem `paid_amount`; para status 'partial'
    // projetamos o líquido cheio (superestima o que falta pagar) e sinalizamos
    // isso na descrição do detalhe.
    let atrasoFolha = 0;
    let qtdFolhaAtraso = 0;
    (payrollRes.data ?? []).forEach((p: PayrollEntry) => {
      const projetada = payrollProjectedDate(p.reference_month);
      if (!projetada) return;
      const k = projetada < todayStr ? todayStr : projetada;
      if (projetada < todayStr) {
        atrasoFolha += Number(p.net_salary); qtdFolhaAtraso += 1;
        if (!comAtrasados) return;
      }
      if (dayMap[k]) {
        dayMap[k].saidasFolha += Number(p.net_salary);
        const sufixo = projetada < todayStr ? ' — em atraso' : '';
        const parcial = p.status === 'partial' ? ' (parcial: valor cheio)' : '';
        dayMap[k].detalhes.push({
          tipo: 'folha',
          descricao: `Folha ${p.reference_month}${p.employee_name ? ` — ${p.employee_name}` : ''}${sufixo}${parcial}`,
          valor: Number(p.net_salary),
        });
      }
    });

    // Monta array de projeção
    let accumulated = currentBalance;
    // O KPI "Recebíveis D+N" continua sendo SÓ parcelas de cartão a liquidar —
    // não pode ser lido de `entradasAuto`, que agora agrega também as entradas
    // automáticas do razão (auto_sale/auto_suprimento).
    const sumRecebiveis = receivables.reduce((s, r) => s + Number(r.amount), 0) + sumAgenda;
    let sumSaidas = 0;
    let sumEntradas = 0;
    const points: DayPoint[] = [];

    Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([dateStr, vals]) => {
        const d = new Date(dateStr + 'T00:00:00');
        const totalEnt = vals.entradasAuto + vals.entradasManuais;
        const totalSai = vals.saidasContas + vals.saidasFolha + vals.saidasManuais + vals.saidasProvisionadas;
        accumulated += totalEnt - totalSai;
        sumSaidas += totalSai;
        sumEntradas += vals.entradasManuais;

        points.push({
          date: dateStr,
          label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          entradasAuto: vals.entradasAuto,
          entradasManuais: vals.entradasManuais,
          saidasFolha: vals.saidasFolha,
          saidasContas: vals.saidasContas,
          saidasManuais: vals.saidasManuais,
          saidasProvisionadas: vals.saidasProvisionadas,
          totalEntradas: totalEnt,
          totalSaidas: totalSai,
          saldo: totalEnt - totalSai,
          saldoAcumulado: accumulated,
          detalhes: vals.detalhes,
        });
      });

    setAtrasados({ contas: totalVencidas, folha: atrasoFolha, notas: atrasoNotas, qtdContas: countVencidas, qtdFolha: qtdFolhaAtraso });
    setProjection(points);
    setTotalRecebiveis(sumRecebiveis);
    setTotalSaidas(sumSaidas);
    setTotalEntradas(sumEntradas);
    setLoading(false);
  }, [user?.tenantId, horizon, comAtrasados]);

  useEffect(() => { buildProjection(); }, [buildProjection]);

  const chartData = useMemo(() => {
    if (horizon <= 30) return projection;
    return projection.filter((_, i) => i % 7 === 0 || i === projection.length - 1);
  }, [projection, horizon]);

  const saldoFinal = projection.length > 0 ? projection[projection.length - 1].saldoAcumulado : saldoAtual;
  const criticalDays = projection.filter((p) => p.saldoAcumulado < 0);
  const temDados = projection.some((p) => p.totalEntradas > 0 || p.totalSaidas > 0);

  // Ponto de MAIOR APERTO do horizonte: o menor saldo acumulado. É o número que
  // responde "quanto preciso ter em caixa para atravessar o período".
  const piorMomento = useMemo(
    () => projection.reduce(
      (pior, p) => (p.saldoAcumulado < pior.saldoAcumulado ? p : pior),
      projection[0] ?? { date: todayBrasilia(), label: '', saldoAcumulado: saldoAtual } as DayPoint,
    ),
    [projection, saldoAtual],
  );

  // Semana a semana (2026-09-30): hoje + blocos de 7 dias, com o que mais pesa em cada um.
  const SAIDA_TIPOS = ['conta_pagar', 'folha', 'manual_saida', 'nota_provisionada'];
  const semanas = useMemo(() => {
    if (projection.length === 0) return [];
    const blocos: DayPoint[][] = [[projection[0]]];
    for (let i = 1; i < projection.length; i += 7) blocos.push(projection.slice(i, i + 7));
    return blocos.map((dias, idx) => {
      const itens = dias.flatMap((d) => d.detalhes);
      const top = (saida: boolean) => {
        const somas = new Map<string, number>();
        itens.filter((x) => SAIDA_TIPOS.includes(x.tipo) === saida).forEach((x) => {
          const nome = x.descricao.split(' — ')[0];
          somas.set(nome, (somas.get(nome) ?? 0) + x.valor);
        });
        return [...somas.entries()].sort((a, b) => b[1] - a[1]);
      };
      const ini = dias[0].label;
      const fim = dias[dias.length - 1].label;
      return {
        chave: dias[0].date,
        rotulo: idx === 0 ? `Hoje (${ini})` : ini === fim ? ini : `${ini} a ${fim}`,
        entradas: dias.reduce((s, d) => s + d.totalEntradas, 0),
        saidas: dias.reduce((s, d) => s + d.totalSaidas, 0),
        saldoFim: dias[dias.length - 1].saldoAcumulado,
        topEntradas: top(false),
        topSaidas: top(true),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection]);
  const totalAtrasado = atrasados.contas + atrasados.folha + atrasados.notas;

  const receivablesByMethod = useMemo(() => {
    const map: Record<string, number> = {};
    pendingReceivables.forEach((r) => {
      const key = r.payment_method_name ?? 'Outros';
      map[key] = (map[key] ?? 0) + Number(r.amount);
    });
    return Object.entries(map).sort(([, a], [, b]) => b - a);
  }, [pendingReceivables]);

  const receivablesByWeek = useMemo(() => {
    const map: Record<string, { total: number; count: number; items: Receivable[] }> = {};
    pendingReceivables.forEach((r) => {
      const d = new Date(r.due_date + 'T00:00:00');
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = dateKey(weekStart);
      if (!map[key]) map[key] = { total: 0, count: 0, items: [] };
      map[key].total += Number(r.amount);
      map[key].count += 1;
      map[key].items.push(r);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [pendingReceivables]);

  // Handler de clique no gráfico.
  // O parâmetro é `unknown` porque o tipo público do recharts (MouseHandlerDataParam)
  // não declara `activePayload`, embora o objeto o traga em runtime — tipar
  // explicitamente quebrava a atribuição a `onClick`.
  const handleChartClick = (data: unknown) => {
    const point = (data as { activePayload?: { payload: DayPoint }[] } | undefined)?.activePayload?.[0]?.payload;
    if (point) {
      setSelectedDay((prev) => prev?.date === point.date ? null : point);
    }
  };

  const SERIES_LABELS = {
    entradasAuto: 'Entradas Automáticas',
    entradasManuais: 'Entradas Manuais',
    saidasFolha: 'Folha de Pagto',
    saidasContas: 'Contas a Pagar',
    saidasManuais: 'Saídas Manuais',
    saidasProvisionadas: 'Notas não lançadas',
    saldoAcumulado: 'Saldo Acumulado',
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="text-sm font-bold text-zinc-800">Fluxo de Caixa Projetado</h2>
          <p className="text-xs text-zinc-400">
            Saldo de hoje + o que já vendeu a receber (cartão D+N) − contas a pagar, folha
            e boletos de notas de entrada ainda não lançadas. O que já venceu entra se você marcar a caixinha. Vendas futuras não entram.
          </p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto max-w-full">
          <Segmented
            value={viewMode}
            onChange={setViewMode}
            options={[
              { id: 'area', label: 'Linha', icon: 'ri-line-chart-line' },
              { id: 'bar', label: 'Barras', icon: 'ri-bar-chart-line' },
            ]}
          />
          <Segmented
            value={String(horizon)}
            onChange={(v) => setHorizon(Number(v))}
            options={HORIZON_OPTIONS.map((opt) => ({ id: String(opt.days), label: opt.label, icon: 'ri-calendar-line' }))}
          />
        </div>
      </div>

      {/* Legenda visual das 5 séries */}
      <div className="bg-white border border-zinc-200 rounded-2xl px-5 py-3">
        <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-2.5">Legenda do Gráfico</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {/* Entradas */}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.entradasAuto }} />
            <span className="text-xs text-zinc-600">Entradas Automáticas <span className="text-zinc-400">(recebíveis D+N, vendas, suprimento — verde claro)</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.entradasManuais }} />
            <span className="text-xs text-zinc-600">Entradas Manuais <span className="text-zinc-400">(verde escuro)</span></span>
          </div>
          {/* Saídas */}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.saidasFolha }} />
            <span className="text-xs text-zinc-600">Folha de Pagto <span className="text-zinc-400">(vermelho claro)</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.saidasContas }} />
            <span className="text-xs text-zinc-600">Contas a Pagar <span className="text-zinc-400">(vermelho escuro)</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.saidasManuais }} />
            <span className="text-xs text-zinc-600">Saídas Manuais <span className="text-zinc-400">(laranja)</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: SERIES_COLORS.saidasProvisionadas }} />
            <span className="text-xs text-zinc-600">Notas não lançadas <span className="text-zinc-400">(boleto de NF-e que ainda não virou conta — âmbar escuro)</span></span>
          </div>
          {/* Saldo */}
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 flex-shrink-0" style={{ background: SERIES_COLORS.saldoAcumulado }} />
            <span className="text-xs text-zinc-600">Saldo Acumulado <span className="text-zinc-400">(âmbar)</span></span>
          </div>
        </div>
        {!selectedDay && temDados && (
          <p className="text-[11px] text-zinc-400 mt-2.5 flex items-center gap-1">
            <i className="ri-cursor-line" />
            Clique em um ponto do gráfico para ver o detalhamento do dia
          </p>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          label="Saldo Atual"
          icon="ri-bank-line"
          value={formatCurrency(saldoAtual)}
          valueTone={saldoAtual >= 0 ? 'text-emerald-700' : 'text-red-600'}
          sub={saldoSyncedAt
            ? `Saldo real do banco (API) · ${new Date(saldoSyncedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
            : saldoSource === 'banco' ? 'Saldo real das contas bancárias' : 'Estimado pelo caixa (configure os bancos p/ saldo real)'}
          atual={saldoAtual}
          semVariacao
        />
        <KpiCard
          label="Recebíveis D+N"
          icon="ri-time-line"
          value={formatCurrency(totalRecebiveis)}
          valueTone="text-emerald-700"
          sub={agendaQtd > 0
            ? `${pendingReceivables.length} parcela(s) + ${agendaQtd} dia(s) de cartão/iFood a receber`
            : `${pendingReceivables.length} parcela(s) a liquidar`}
          atual={totalRecebiveis}
          semVariacao
        />
        <KpiCard
          label="Saídas Previstas"
          icon="ri-arrow-up-circle-line"
          value={formatCurrency(totalSaidas)}
          valueTone="text-red-600"
          sub={countVencidas > 0 && !comAtrasados
            ? `Sem as ${countVencidas} vencida(s) (${formatCurrency(totalVencidas)}) · marque "Incluir o que já venceu"`
            : countVencidas > 0
            ? `Inclui ${countVencidas} vencida(s): ${formatCurrency(totalVencidas)}${totalProvisionado > 0 ? ` · ${formatCurrency(totalProvisionado)} em notas não lançadas` : ''}`
            : totalProvisionado > 0
              ? `Contas a pagar + folha · inclui ${formatCurrency(totalProvisionado)} em notas não lançadas`
              : 'Contas a pagar + folha no período'}
          atual={totalSaidas}
          semVariacao
        />
        <KpiCard
          label={`Saldo em ${horizon}d`}
          icon="ri-calendar-check-line"
          value={formatCurrency(saldoFinal)}
          valueTone={saldoFinal >= 0 ? 'text-emerald-700' : 'text-red-600'}
          sub="Projeção acumulada"
          atual={saldoFinal}
          semVariacao
        />
      </div>

      {/* O que já venceu: caixinha para entrar ou não na projeção (2026-09-30). */}
      {totalAtrasado > 0.005 && (
        <label className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer ${comAtrasados ? 'bg-amber-50 border-amber-300' : 'bg-white border-zinc-200 hover:border-amber-300'}`}>
          <input type="checkbox" checked={comAtrasados} onChange={alternarAtrasados} className="mt-0.5 w-4 h-4 accent-amber-500 cursor-pointer" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-zinc-800">
              Incluir o que já venceu ({formatCurrency(totalAtrasado)}) como saída de hoje
            </span>
            <span className="block text-xs text-zinc-500 mt-0.5">
              {[
                atrasados.contas > 0.005 ? `${atrasados.qtdContas} conta(s) vencida(s) ${formatCurrency(atrasados.contas)}` : null,
                atrasados.folha > 0.005 ? `folha de meses anteriores sem baixa ${formatCurrency(atrasados.folha)} (${atrasados.qtdFolha} lançamento(s))` : null,
                atrasados.notas > 0.005 ? `boletos vencidos de notas não lançadas ${formatCurrency(atrasados.notas)}` : null,
              ].filter(Boolean).join(' · ')}
              {'. '}
              {comAtrasados
                ? 'Está somado em hoje. Se a folha antiga já foi paga, dê baixa em RH / Folha para ela sair daqui.'
                : 'Fora da projeção agora: o gráfico mostra só o que vence de hoje em diante.'}
            </span>
          </span>
        </label>
      )}

      {/* Notas de entrada que ainda não viraram conta a pagar (2026-09-21).
          Fica ACIMA do alerta de saldo porque é a explicação de por que o número
          mudou: esse dinheiro já pressiona a projeção, mas ninguém conferiu a nota. */}
      {countNotasProvisionadas > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
            <i className="ri-file-warning-line text-amber-700" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-800">
              {formatCurrency(totalProvisionado)} em boletos de {countNotasProvisionadas}{' '}
              {countNotasProvisionadas === 1 ? 'nota não lançada' : 'notas não lançadas'}
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              Chegaram da SEFAZ com boleto, mas ainda não viraram compra nem despesa. Estão na
              projeção como provisionado (âmbar escuro) — confira em Notas de entrada para que
              entrem de verdade no Contas a Pagar.
            </p>
            <button
              onClick={() => navigate('/financeiro?tab=notas-entrada')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-amber-900 hover:underline mt-1.5 cursor-pointer"
            >
              Abrir Notas de entrada <i className="ri-arrow-right-line" />
            </button>
          </div>
        </div>
      )}

      {/* Alerta saldo negativo */}
      {criticalDays.length > 0 ? (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
            <i className="ri-alert-line text-red-600" />
          </div>
          <div>
            <p className="text-xs font-semibold text-red-800">
              O caixa fica negativo em {new Date(criticalDays[0].date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              Saldo nesse dia: <strong>{formatCurrency(criticalDays[0].saldoAcumulado)}</strong>
              {' · '}Pior momento do período: <strong>{formatCurrency(piorMomento.saldoAcumulado)}</strong> em{' '}
              {new Date(piorMomento.date + 'T12:00:00').toLocaleDateString('pt-BR')}
              {' · '}{criticalDays.length} dia(s) no vermelho.
            </p>
            <p className="text-[11px] text-red-500 mt-1">
              Considere negociar prazo com fornecedores, antecipar recebíveis de cartão ou adiar compras não essenciais.
            </p>
          </div>
        </div>
      ) : temDados && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-green-100 rounded-lg flex-shrink-0">
            <i className="ri-shield-check-line text-green-600" />
          </div>
          <div>
            <p className="text-xs font-semibold text-emerald-800">
              Caixa cobre os compromissos dos próximos {horizon} dias
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Pior momento do período: <strong>{formatCurrency(piorMomento.saldoAcumulado)}</strong> em{' '}
              {new Date(piorMomento.date + 'T12:00:00').toLocaleDateString('pt-BR')}. Projeção considera apenas
              os compromissos já lançados — vendas novas não estão previstas.
            </p>
          </div>
        </div>
      )}

      {/* Gráfico + Painel lateral */}
      <div className={`flex flex-col lg:flex-row gap-4 ${selectedDay ? 'lg:items-start' : ''}`}>
        {/* Gráfico principal */}
        <div className={`bg-white rounded-2xl border border-zinc-200 p-5 transition-all ${selectedDay ? 'flex-1 min-w-0' : 'w-full'}`}>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div><h3 className="text-sm font-bold text-zinc-800">Evolução do Saldo Acumulado</h3><p className="text-xs text-zinc-400">Projeção dia a dia dos próximos {horizon} dias</p></div>
            <span className="text-[11px] text-zinc-400">
              {selectedDay ? (
                <span className="flex items-center gap-1 text-amber-600">
                  <i className="ri-focus-3-line" />
                  Dia selecionado: {selectedDay.label}
                </span>
              ) : 'Clique em um ponto para detalhar'}
            </span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-14">
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-2" />
              <span className="text-zinc-400 text-sm">Calculando projeção...</span>
            </div>
          ) : !temDados ? (
            <div className="flex flex-col items-center justify-center py-14 text-zinc-400">
              <i className="ri-line-chart-line text-4xl mb-3 text-zinc-200" />
              <p className="text-sm font-semibold text-zinc-500">Nenhuma movimentação prevista</p>
              <p className="text-xs text-zinc-400 mt-1 text-center max-w-xs">
                Cadastre contas a pagar ou registre vendas com cartão para ver a projeção aqui.
              </p>
            </div>
          ) : viewMode === 'area' ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={chartData}
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              >
                <defs>
                  <linearGradient id="gradSaldo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={SERIES_COLORS.saldoAcumulado} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={SERIES_COLORS.saldoAcumulado} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradEntradasAuto" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={SERIES_COLORS.entradasAuto} stopOpacity={0.12} />
                    <stop offset="95%" stopColor={SERIES_COLORS.entradasAuto} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(value) => SERIES_LABELS[value as keyof typeof SERIES_LABELS] ?? value}
                />
                <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} />
                {/* Saldo acumulado — linha principal âmbar */}
                <Area
                  type="monotone"
                  dataKey="saldoAcumulado"
                  name="saldoAcumulado"
                  stroke={SERIES_COLORS.saldoAcumulado}
                  strokeWidth={2.5}
                  fill="url(#gradSaldo)"
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                />
                {/* Entradas automáticas — verde claro */}
                <Area
                  type="monotone"
                  dataKey="entradasAuto"
                  name="entradasAuto"
                  stroke={SERIES_COLORS.entradasAuto}
                  strokeWidth={1.5}
                  fill="url(#gradEntradasAuto)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Entradas manuais — verde escuro */}
                <Area
                  type="monotone"
                  dataKey="entradasManuais"
                  name="entradasManuais"
                  stroke={SERIES_COLORS.entradasManuais}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Saídas folha — vermelho claro */}
                <Area
                  type="monotone"
                  dataKey="saidasFolha"
                  name="saidasFolha"
                  stroke={SERIES_COLORS.saidasFolha}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="4 2"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Saídas contas — vermelho escuro */}
                <Area
                  type="monotone"
                  dataKey="saidasContas"
                  name="saidasContas"
                  stroke={SERIES_COLORS.saidasContas}
                  strokeWidth={1.5}
                  fill="none"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Saídas manuais — laranja */}
                <Area
                  type="monotone"
                  dataKey="saidasManuais"
                  name="saidasManuais"
                  stroke={SERIES_COLORS.saidasManuais}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="3 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {/* Boleto de nota não lançada — âmbar escuro, pontilhado: ainda não é
                    compromisso confirmado, mas já pesa na projeção. */}
                <Area
                  type="monotone"
                  dataKey="saidasProvisionadas"
                  name="saidasProvisionadas"
                  stroke={SERIES_COLORS.saidasProvisionadas}
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="2 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={chartData}
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#fafafa' }} />
                <Legend
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(value) => SERIES_LABELS[value as keyof typeof SERIES_LABELS] ?? value}
                />
                <Bar dataKey="entradasAuto" name="entradasAuto" fill={SERIES_COLORS.entradasAuto} radius={[2, 2, 0, 0]} stackId="entradas" />
                <Bar dataKey="entradasManuais" name="entradasManuais" fill={SERIES_COLORS.entradasManuais} radius={[2, 2, 0, 0]} stackId="entradas" />
                <Bar dataKey="saidasFolha" name="saidasFolha" fill={SERIES_COLORS.saidasFolha} radius={[0, 0, 0, 0]} stackId="saidas" />
                <Bar dataKey="saidasContas" name="saidasContas" fill={SERIES_COLORS.saidasContas} radius={[0, 0, 0, 0]} stackId="saidas" />
                <Bar dataKey="saidasManuais" name="saidasManuais" fill={SERIES_COLORS.saidasManuais} radius={[0, 0, 0, 0]} stackId="saidas" />
                <Bar dataKey="saidasProvisionadas" name="saidasProvisionadas" fill={SERIES_COLORS.saidasProvisionadas} radius={[2, 2, 0, 0]} stackId="saidas" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Painel lateral de detalhes do dia */}
        {selectedDay && (
          <div className="w-full lg:w-72 flex-shrink-0" style={{ minHeight: 340 }}>
            <DayDetailPanel
              point={selectedDay}
              onClose={() => setSelectedDay(null)}
            />
          </div>
        )}
      </div>

      {/* Semana a semana */}
      {!loading && semanas.length > 1 && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100">
            <h3 className="text-sm font-bold text-zinc-800">Semana a semana</h3>
            <p className="text-xs text-zinc-400">O que entra e sai em cada semana e o saldo no fim dela</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-zinc-400 bg-zinc-50">
                  <th className="text-left font-semibold px-5 py-2">Semana</th>
                  <th className="text-left font-semibold px-3 py-2">O que mais pesa</th>
                  <th className="text-right font-semibold px-3 py-2">Entra</th>
                  <th className="text-right font-semibold px-3 py-2">Sai</th>
                  <th className="text-right font-semibold px-5 py-2">Saldo no fim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {semanas.map((w) => (
                  <tr key={w.chave} className="align-top">
                    <td className="px-5 py-2.5 font-semibold text-zinc-800 whitespace-nowrap">{w.rotulo}</td>
                    <td className="px-3 py-2.5 text-xs text-zinc-500 min-w-[220px]">
                      {w.topSaidas.slice(0, 3).map(([n, v]) => (
                        <span key={n} className="block truncate max-w-[360px]"><span className="text-red-500">−</span> {n} {formatCurrency(v)}</span>
                      ))}
                      {w.topEntradas.slice(0, 2).map(([n, v]) => (
                        <span key={n} className="block truncate max-w-[360px]"><span className="text-emerald-600">+</span> {n} {formatCurrency(v)}</span>
                      ))}
                      {w.topSaidas.length > 3 && <span className="block text-zinc-400">+{w.topSaidas.length - 3} saída(s)</span>}
                      {w.topSaidas.length === 0 && w.topEntradas.length === 0 && '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 whitespace-nowrap">{formatCurrency(w.entradas)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600 whitespace-nowrap">{formatCurrency(w.saidas)}</td>
                    <td className={`px-5 py-2.5 text-right tabular-nums font-bold whitespace-nowrap ${w.saldoFim < 0 ? 'text-red-600' : 'text-zinc-800'}`}>{formatCurrency(w.saldoFim)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Painel de recebíveis por forma de pagamento */}
      {receivablesByMethod.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-zinc-800">Recebíveis D+N por Forma de Pagamento</h3>
              <p className="text-xs text-zinc-400">Valores a liquidar no período de {horizon} dias</p>
            </div>
            <button
              onClick={() => setShowDetail(!showDetail)}
              className="text-xs text-amber-600 hover:text-amber-700 font-semibold cursor-pointer flex items-center gap-1"
            >
              {showDetail ? 'Ocultar detalhes' : 'Ver detalhes'}
              <i className={`${showDetail ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
            </button>
          </div>

          <div className="space-y-2">
            {receivablesByMethod.map(([method, total]) => {
              const pct = totalRecebiveis > 0 ? (total / totalRecebiveis) * 100 : 0;
              return (
                <div key={method}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <i className="ri-bank-card-line text-zinc-400 text-sm" />
                      <span className="text-sm text-zinc-700 font-medium">{method}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-400">{pct.toFixed(1)}%</span>
                      <span className="text-sm font-bold tabular-nums text-emerald-700">{formatCurrency(total)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: SERIES_COLORS.entradasAuto }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {showDetail && receivablesByWeek.length > 0 && (
            <div className="mt-4 border-t border-zinc-100 pt-4 space-y-3">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Detalhamento por semana</p>
              {receivablesByWeek.map(([weekStart, { total, count, items }]) => {
                const weekEnd = addDays(new Date(weekStart + 'T00:00:00'), 6);
                return (
                  <div key={weekStart} className="bg-zinc-50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-zinc-700">
                        {new Date(weekStart + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                        {' — '}
                        {weekEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400">{count} parcela(s)</span>
                        <span className="text-sm font-bold text-green-700">{formatCurrency(total)}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {items.slice(0, 5).map((r) => (
                        <div key={r.id} className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">
                            {r.order_number ? `#${r.order_number}` : 'Pedido'}
                            {r.payment_method_name ? ` · ${r.payment_method_name}` : ''}
                          </span>
                          <span className="font-medium text-zinc-700">{formatCurrency(r.amount)}</span>
                        </div>
                      ))}
                      {items.length > 5 && (
                        <p className="text-xs text-zinc-400">+{items.length - 5} mais...</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tabela diária (só 30 dias) */}
      {horizon === 30 && !loading && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
            <div><h3 className="text-sm font-bold text-zinc-800">Detalhamento Diário</h3><p className="text-xs text-zinc-400">Clique numa linha para ver o que compõe o dia</p></div>
            <div className="flex items-center gap-3 flex-wrap text-[11px] text-zinc-400">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.entradasAuto }} />
                Automáticas
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.entradasManuais }} />
                Manuais
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.saidasContas }} />
                Contas
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.saidasFolha }} />
                Folha
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.saidasManuais }} />
                Saídas Manuais
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: SERIES_COLORS.saidasProvisionadas }} />
                Notas não lançadas
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200">
                <tr>
                  {['Data', 'Entradas Automáticas', 'Entradas Manuais', 'Contas a Pagar', 'Folha', 'Notas não lançadas', 'Saldo do Dia', 'Saldo Acumulado'].map((h, i) => (
                    <th key={h} className={`text-left ${i === 0 ? 'pl-5 pr-4' : 'px-4'} py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 whitespace-nowrap`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">
                {projection.filter((p) => p.totalEntradas > 0 || p.totalSaidas > 0).map((p) => (
                  <>
                    <tr
                      key={p.date}
                      onClick={() => {
                        if (p.detalhes.length > 0) toggleDay(p.date);
                        setSelectedDay((prev) => prev?.date === p.date ? null : p);
                      }}
                      className={`transition-colors ${p.saldoAcumulado < 0 ? 'bg-red-50/40' : ''} ${p.detalhes.length > 0 ? 'cursor-pointer hover:bg-zinc-50' : ''}`}
                    >
                      <td className="pl-5 pr-4 py-2.5 text-zinc-700 font-medium whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {p.detalhes.length > 0 && (
                            <i className={`text-zinc-400 text-xs transition-transform ${expandedDays.has(p.date) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}`} />
                          )}
                          {p.label}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap" style={{ color: SERIES_COLORS.entradasAuto }}>
                        {p.entradasAuto > 0 ? <span className="font-medium">{formatCurrency(p.entradasAuto)}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap" style={{ color: SERIES_COLORS.entradasManuais }}>
                        {p.entradasManuais > 0 ? <span className="font-medium">{formatCurrency(p.entradasManuais)}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap" style={{ color: SERIES_COLORS.saidasContas }}>
                        {p.saidasContas > 0 ? <span className="font-medium">{formatCurrency(p.saidasContas)}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap" style={{ color: SERIES_COLORS.saidasFolha }}>
                        {p.saidasFolha > 0 ? <span className="font-medium">{formatCurrency(p.saidasFolha)}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap" style={{ color: SERIES_COLORS.saidasProvisionadas }}>
                        {p.saidasProvisionadas > 0 ? <span className="font-medium">{formatCurrency(p.saidasProvisionadas)}</span> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className={`px-4 py-2.5 font-semibold tabular-nums whitespace-nowrap ${p.saldo >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {formatCurrency(p.saldo)}
                      </td>
                      <td className={`px-4 py-2.5 font-bold tabular-nums whitespace-nowrap ${p.saldoAcumulado >= 0 ? 'text-zinc-900' : 'text-red-700'}`}>
                        {formatCurrency(p.saldoAcumulado)}
                      </td>
                    </tr>
                    {expandedDays.has(p.date) && p.detalhes.length > 0 && (
                      <tr key={`${p.date}-detail`} className="bg-zinc-50/60">
                        <td colSpan={8} className="px-6 py-2 pb-3">
                          <div className="space-y-1">
                            {p.detalhes.map((d, idx) => {
                              const cfg = TIPO_CONFIG[d.tipo];
                              const isEntrada = ENTRADA_TIPOS.includes(d.tipo);
                              return (
                                <div key={idx} className="flex items-center justify-between text-xs py-0.5">
                                  <div className="flex items-center gap-2">
                                    <div className="w-5 h-5 flex items-center justify-center">
                                      <i className={`${cfg.icon} text-xs`} style={{ color: cfg.color }} />
                                    </div>
                                    <span className="font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
                                    <span className="text-zinc-500">{d.descricao}</span>
                                  </div>
                                  <span className={`font-semibold ${isEntrada ? 'text-green-700' : cfg.textColor}`}>
                                    {cfg.sinal}{formatCurrency(d.valor)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
            {projection.filter((p) => p.totalEntradas > 0 || p.totalSaidas > 0).length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 text-zinc-400">
                <i className="ri-calendar-line text-4xl mb-2 text-zinc-200" />
                <p className="text-sm">Nenhuma movimentação prevista no período</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
