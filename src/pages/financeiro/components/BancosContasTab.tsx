import { useState, useCallback, useEffect } from 'react';
import { useBankAccounts, useIncomeRouting, useBankTransactions } from '@/hooks/useFinanceiro';
import type { BankAccount, IncomeRouting, BankTransaction } from '@/hooks/useFinanceiro';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { formatCurrency } from '@/lib/formatters';

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  checking: 'Conta Corrente',
  savings: 'Conta Poupança',
  cash: 'Caixa (Dinheiro)',
  digital: 'Conta Digital',
};

const ACCOUNT_TYPE_ICON: Record<string, string> = {
  checking: 'ri-bank-line',
  savings: 'ri-safe-line',
  cash: 'ri-money-dollar-circle-line',
  digital: 'ri-smartphone-line',
};

const COLORS = [
  '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
];

const INCOME_SOURCES = [
  { type: 'origin', id: 'pdv', label: 'PDV (Caixa)' },
  { type: 'origin', id: 'garcom', label: 'Garçom / Mesa' },
  { type: 'origin', id: 'delivery', label: 'Delivery' },
  { type: 'origin', id: 'self_service', label: 'Autoatendimento (Kiosk)' },
  { type: 'origin', id: 'mesa', label: 'Cardápio Digital (Mesa)' },
];

const REF_TYPE_LABEL: Record<string, string> = {
  bill_payment: 'Pagamento de Conta',
  purchase: 'Compra',
  manual: 'Lançamento Manual',
  income: 'Receita',
  transfer: 'Transferência',
};

const emptyForm: Partial<BankAccount> = {
  name: '',
  bank_name: '',
  account_type: 'checking',
  agency: '',
  account_number: '',
  pix_key: '',
  initial_balance: 0,
  current_balance: 0,
  color: '#f59e0b',
  icon: 'ri-bank-line',
  notes: '',
  is_default: false,
};

// ── Histórico de Movimentações ────────────────────────────────────────────────
function TransactionHistory({ account, onClose }: { account: BankAccount; onClose: () => void }) {
  const { transactions, loading, manualTransaction } = useBankTransactions(account.id);
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    type: 'debit' as 'credit' | 'debit',
    amount: '',
    description: '',
    transaction_date: new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);

  const handleManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.amount || !manualForm.description) return;
    setSaving(true);
    await manualTransaction({
      bank_account_id: account.id,
      type: manualForm.type,
      amount: Number(manualForm.amount),
      description: manualForm.description,
      transaction_date: manualForm.transaction_date,
    });
    setSaving(false);
    setShowManual(false);
    setManualForm({ type: 'debit', amount: '', description: '', transaction_date: new Date().toISOString().split('T')[0] });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 flex items-center justify-center rounded-xl"
              style={{ backgroundColor: account.color + '20' }}
            >
              <i className={`${account.icon} text-base`} style={{ color: account.color }} />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900 text-sm">{account.name}</h3>
              <p className="text-xs text-zinc-400">Histórico de Movimentações</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowManual(true)}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-add-line" /> Lançamento Manual
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"
            >
              <i className="ri-close-line text-zinc-500" />
            </button>
          </div>
        </div>

        {/* Saldo atual */}
        <div className="px-6 py-3 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-zinc-500">Saldo Atual</span>
          <span className={`text-lg font-bold ${Number(account.current_balance) >= 0 ? 'text-zinc-900' : 'text-red-600'}`}>
            {formatCurrency(Number(account.current_balance))}
          </span>
        </div>

        {/* Transactions list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <i className="ri-loader-4-line animate-spin text-2xl text-zinc-300" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-full mb-3">
                <i className="ri-exchange-line text-zinc-400 text-xl" />
              </div>
              <p className="text-sm font-semibold text-zinc-600 mb-1">Nenhuma movimentação ainda</p>
              <p className="text-xs text-zinc-400">
                As movimentações aparecem automaticamente ao pagar contas ou registrar compras vinculadas a esta conta.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {transactions.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </div>
          )}
        </div>

        {/* Manual transaction modal */}
        {showManual && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 rounded-2xl">
            <div className="bg-white rounded-xl w-full max-w-sm mx-4 p-6">
              <h4 className="font-semibold text-zinc-900 mb-4">Lançamento Manual</h4>
              <form onSubmit={handleManual} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Tipo</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setManualForm(f => ({ ...f, type: 'debit' }))}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${manualForm.type === 'debit' ? 'bg-red-500 text-white' : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                    >
                      <i className="ri-arrow-up-line mr-1" /> Débito (Saída)
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualForm(f => ({ ...f, type: 'credit' }))}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${manualForm.type === 'credit' ? 'bg-green-500 text-white' : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                    >
                      <i className="ri-arrow-down-line mr-1" /> Crédito (Entrada)
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Valor (R$)</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={manualForm.amount}
                    onChange={e => setManualForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="0,00"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Descrição</label>
                  <input
                    required
                    value={manualForm.description}
                    onChange={e => setManualForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="Ex: Transferência, Ajuste de saldo..."
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Data</label>
                  <input
                    type="date"
                    value={manualForm.transaction_date}
                    onChange={e => setManualForm(f => ({ ...f, transaction_date: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowManual(false)}
                    className="flex-1 py-2 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    {saving ? 'Salvando...' : 'Confirmar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionRow({ tx }: { tx: BankTransaction }) {
  const isCredit = tx.type === 'credit';
  const dateStr = new Date(tx.transaction_date + 'T12:00:00').toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className="flex items-center gap-4 px-6 py-3.5 hover:bg-zinc-50 transition-colors">
      <div className={`w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0 ${isCredit ? 'bg-green-100' : 'bg-red-100'}`}>
        <i className={`text-sm ${isCredit ? 'ri-arrow-down-line text-green-600' : 'ri-arrow-up-line text-red-500'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-800 truncate">{tx.description}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-zinc-400">{dateStr}</span>
          {tx.reference_type && (
            <>
              <span className="text-zinc-200">·</span>
              <span className="text-xs text-zinc-400">{REF_TYPE_LABEL[tx.reference_type] ?? tx.reference_type}</span>
            </>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-sm font-bold ${isCredit ? 'text-green-600' : 'text-red-500'}`}>
          {isCredit ? '+' : '-'}{formatCurrency(Number(tx.amount))}
        </p>
        {tx.balance_after !== null && tx.balance_after !== undefined && (
          <p className="text-xs text-zinc-400 mt-0.5">
            Saldo: {formatCurrency(Number(tx.balance_after))}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function BancosContasTab() {
  const { accounts, loading, upsert, remove, setDefault, totalBalance } = useBankAccounts();
  const { routings, upsert: upsertRouting } = useIncomeRouting();
  const { methods: paymentMethods } = usePaymentMethods();

  const [activeSection, setActiveSection] = useState<'contas' | 'roteamento'>('contas');
  const [showModal, setShowModal] = useState(false);
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [form, setForm] = useState<Partial<BankAccount>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [historyAccount, setHistoryAccount] = useState<BankAccount | null>(null);

  // Roteamento de entradas
  const [routingMap, setRoutingMap] = useState<Record<string, string>>({});
  const [savingRouting, setSavingRouting] = useState(false);

  useEffect(() => {
    const map: Record<string, string> = {};
    routings.forEach(r => {
      const key = `${r.source_type}__${r.source_id ?? ''}`;
      map[key] = r.bank_account_id ?? '';
    });
    setRoutingMap(map);
  }, [routings]);

  const openNew = () => {
    setEditAccount(null);
    setSaveError(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (acc: BankAccount) => {
    setEditAccount(acc);
    setSaveError(null);
    setForm({ ...acc });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

    // Validação local de nome duplicado
    const trimmedName = (form.name ?? '').trim().toLowerCase();
    const isDuplicate = accounts.some(
      a => a.name.trim().toLowerCase() === trimmedName && a.id !== editAccount?.id
    );
    if (isDuplicate) {
      setSaving(false);
      setSaveError('Já existe uma conta com este nome. Escolha outro nome.');
      return;
    }

    await upsert({ ...form, id: editAccount?.id });
    setSaving(false);
    setShowModal(false);
    setForm(emptyForm);
    setEditAccount(null);
  };

  const handleDelete = async (id: string) => {
    await remove(id);
    setDeleteConfirm(null);
  };

  const handleSaveRouting = async () => {
    setSavingRouting(true);
    const allSources = [
      ...INCOME_SOURCES,
      ...paymentMethods.map(pm => ({ type: 'payment_method', id: pm.id, label: pm.name })),
    ];
    for (const src of allSources) {
      const key = `${src.type}__${src.id}`;
      const bankAccountId = routingMap[key] ?? null;
      await upsertRouting({
        source_type: src.type,
        source_id: src.id,
        source_label: src.label,
        bank_account_id: bankAccountId || undefined,
      });
    }
    setSavingRouting(false);
  };

  const getRoutingAccount = useCallback((sourceType: string, sourceId: string) => {
    const key = `${sourceType}__${sourceId}`;
    return routingMap[key] ?? '';
  }, [routingMap]);

  const setRoutingAccount = (sourceType: string, sourceId: string, accountId: string) => {
    const key = `${sourceType}__${sourceId}`;
    setRoutingMap(prev => ({ ...prev, [key]: accountId }));
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {/* Header KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <div className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-amber-50">
            <i className="ri-bank-line text-amber-600 text-lg" />
          </div>
          <div>
            <p className="text-xs text-zinc-500">Saldo Total</p>
            <p className="text-base font-bold text-zinc-900">{formatCurrency(totalBalance)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-green-50">
            <i className="ri-wallet-3-line text-green-600 text-lg" />
          </div>
          <div>
            <p className="text-xs text-zinc-500">Contas Ativas</p>
            <p className="text-base font-bold text-zinc-900">{accounts.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-zinc-50">
            <i className="ri-star-line text-zinc-600 text-lg" />
          </div>
          <div>
            <p className="text-xs text-zinc-500">Conta Padrão</p>
            <p className="text-base font-bold text-zinc-900 truncate">
              {accounts.find(a => a.is_default)?.name ?? '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setActiveSection('contas')}
            className={`px-4 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeSection === 'contas' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
          >
            <i className="ri-bank-card-line" /> Minhas Contas
          </button>
          <button
            onClick={() => setActiveSection('roteamento')}
            className={`px-4 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeSection === 'roteamento' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
          >
            <i className="ri-route-line" /> Roteamento de Entradas
          </button>
        </div>

        {activeSection === 'contas' && (
          <button
            onClick={openNew}
            className="ml-auto flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-add-line" /> Nova Conta
          </button>
        )}
        {activeSection === 'roteamento' && (
          <button
            onClick={handleSaveRouting}
            disabled={savingRouting}
            className="ml-auto flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-60"
          >
            <i className={savingRouting ? 'ri-loader-4-line animate-spin' : 'ri-save-line'} />
            {savingRouting ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        )}
      </div>

      {/* ── CONTAS ── */}
      {activeSection === 'contas' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <i className="ri-loader-4-line animate-spin text-2xl text-zinc-300" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="bg-white rounded-xl border border-zinc-200 py-16 text-center">
              <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-full mx-auto mb-4">
                <i className="ri-bank-line text-zinc-400 text-2xl" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-700 mb-1">Nenhuma conta cadastrada</h3>
              <p className="text-xs text-zinc-400 mb-4">Cadastre suas contas bancárias para acompanhar os saldos</p>
              <button
                onClick={openNew}
                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-add-line" /> Cadastrar Primeira Conta
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map(acc => (
                <div
                  key={acc.id}
                  className="bg-white rounded-xl border border-zinc-200 overflow-hidden hover:border-zinc-300 transition-colors"
                >
                  <div className="h-1.5 w-full" style={{ backgroundColor: acc.color }} />
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 flex items-center justify-center rounded-xl"
                          style={{ backgroundColor: acc.color + '20' }}
                        >
                          <i className={`${acc.icon} text-lg`} style={{ color: acc.color }} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-zinc-900">{acc.name}</p>
                            {acc.is_default && (
                              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">
                                Padrão
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400">{ACCOUNT_TYPE_LABEL[acc.account_type]}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(acc)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                          title="Editar"
                        >
                          <i className="ri-pencil-line text-xs" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(acc.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer"
                          title="Remover"
                        >
                          <i className="ri-delete-bin-line text-xs" />
                        </button>
                      </div>
                    </div>

                    {/* Balance */}
                    <div className="mb-4">
                      <p className="text-xs text-zinc-400 mb-0.5">Saldo Atual</p>
                      <p className={`text-xl font-bold ${Number(acc.current_balance) >= 0 ? 'text-zinc-900' : 'text-red-600'}`}>
                        {formatCurrency(Number(acc.current_balance))}
                      </p>
                      {Number(acc.initial_balance) !== 0 && (
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Saldo inicial: {formatCurrency(Number(acc.initial_balance))}
                        </p>
                      )}
                    </div>

                    {/* Details */}
                    <div className="space-y-1.5 text-xs text-zinc-500 mb-4">
                      {acc.bank_name && (
                        <div className="flex items-center gap-1.5">
                          <i className="ri-building-line text-zinc-300" />
                          <span>{acc.bank_name}</span>
                        </div>
                      )}
                      {acc.agency && acc.account_number && (
                        <div className="flex items-center gap-1.5">
                          <i className="ri-hashtag text-zinc-300" />
                          <span>Ag. {acc.agency} · CC {acc.account_number}</span>
                        </div>
                      )}
                      {acc.pix_key && (
                        <div className="flex items-center gap-1.5">
                          <i className="ri-qr-code-line text-zinc-300" />
                          <span className="truncate">{acc.pix_key}</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setHistoryAccount(acc)}
                        className="flex-1 py-1.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-1"
                      >
                        <i className="ri-history-line" /> Extrato
                      </button>
                      {!acc.is_default && (
                        <button
                          onClick={() => setDefault(acc.id)}
                          className="flex-1 py-1.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-1"
                        >
                          <i className="ri-star-line" /> Padrão
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── ROTEAMENTO ── */}
      {activeSection === 'roteamento' && (
        <div className="space-y-5">
          {/* Banner explicativo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-100 flex-shrink-0">
                <i className="ri-flashlight-line text-green-600 text-sm" />
              </div>
              <div>
                <p className="text-sm font-bold text-green-800">D+0 — Crédito Imediato</p>
                <p className="text-xs text-green-700 mt-0.5">
                  Dinheiro, PIX e Débito entram na conta bancária no mesmo momento da venda.
                  Configure abaixo para qual conta cada método vai.
                </p>
              </div>
            </div>
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 flex items-start gap-3">
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 flex-shrink-0">
                <i className="ri-time-line text-zinc-500 text-sm" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-700">D+N — Recebível Futuro</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Crédito e vouchers com prazo D+N criam um recebível em "Contas a Receber".
                  O crédito bancário ocorre quando você dá baixa no recebível.
                </p>
              </div>
            </div>
          </div>

          {accounts.length === 0 ? (
            <div className="bg-white rounded-xl border border-zinc-200 py-12 text-center">
              <i className="ri-bank-line text-3xl text-zinc-200 block mb-2" />
              <p className="text-sm text-zinc-400">Cadastre pelo menos uma conta bancária primeiro</p>
              <button
                onClick={() => setActiveSection('contas')}
                className="mt-3 text-xs text-amber-600 hover:underline cursor-pointer"
              >
                Ir para Minhas Contas
              </button>
            </div>
          ) : (
            <>
              {/* Roteamento por Forma de Pagamento (principal — aplica em D+0) */}
              {paymentMethods.length > 0 && (
                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-zinc-100 bg-zinc-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-bold text-zinc-700 uppercase tracking-wide flex items-center gap-2">
                          <i className="ri-bank-card-line text-amber-500" /> Por Forma de Pagamento
                        </h3>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Aplica automaticamente em vendas D+0 (recebimento imediato)
                        </p>
                      </div>
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                        Ativo no PDV
                      </span>
                    </div>
                  </div>
                  <div className="divide-y divide-zinc-50">
                    {paymentMethods.map(pm => {
                      const daysToReceive = Number((pm as Record<string, unknown>).days_to_receive ?? 0);
                      const isImmediate = daysToReceive === 0;
                      const routedAccountId = getRoutingAccount('payment_method', pm.id);
                      const routedAccount = accounts.find(a => a.id === routedAccountId);

                      return (
                        <div key={pm.id} className="flex items-center justify-between px-5 py-3.5 gap-4">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${isImmediate ? 'bg-green-50' : 'bg-zinc-100'}`}>
                              <i className={`text-sm ${
                                pm.name?.toLowerCase().includes('pix') ? 'ri-qr-code-line' :
                                pm.name?.toLowerCase().includes('dinheiro') ? 'ri-money-dollar-circle-line' :
                                pm.name?.toLowerCase().includes('débito') ? 'ri-bank-card-line' :
                                pm.name?.toLowerCase().includes('crédito') ? 'ri-bank-card-2-line' :
                                'ri-secure-payment-line'
                              } ${isImmediate ? 'text-green-600' : 'text-zinc-400'}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium text-zinc-800">{pm.name}</p>
                                {isImmediate ? (
                                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
                                    D+0 · Crédito imediato
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
                                    D+{daysToReceive} · Recebível futuro
                                  </span>
                                )}
                              </div>
                              {routedAccount && isImmediate && (
                                <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                                  <i className="ri-arrow-right-line text-[10px]" />
                                  {routedAccount.name}
                                </p>
                              )}
                              {!isImmediate && (
                                <p className="text-xs text-zinc-400 mt-0.5">Roteamento não aplicável — vai para Contas a Receber</p>
                              )}
                            </div>
                          </div>
                          {isImmediate ? (
                            <select
                              value={routedAccountId}
                              onChange={e => setRoutingAccount('payment_method', pm.id, e.target.value)}
                              className="border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 min-w-44 flex-shrink-0"
                            >
                              <option value="">Não rotear</option>
                              {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-zinc-300 flex items-center gap-1 flex-shrink-0 min-w-44 justify-end">
                              <i className="ri-lock-line" /> Automático
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Roteamento por Canal de Venda (informativo) */}
              <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-zinc-100 bg-zinc-50">
                  <h3 className="text-xs font-bold text-zinc-700 uppercase tracking-wide flex items-center gap-2">
                    <i className="ri-store-2-line text-zinc-400" /> Por Canal de Venda
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Roteamento adicional por origem do pedido (complementar)</p>
                </div>
                <div className="divide-y divide-zinc-50">
                  {INCOME_SOURCES.map(src => {
                    const routedAccountId = getRoutingAccount(src.type, src.id);
                    const routedAccount = accounts.find(a => a.id === routedAccountId);
                    return (
                      <div key={`${src.type}__${src.id}`} className="flex flex-col sm:flex-row sm:items-center justify-between px-4 md:px-5 py-3 md:py-3.5 gap-2 sm:gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100">
                            <i className={`text-sm text-zinc-500 ${
                              src.id === 'pdv' ? 'ri-computer-line' :
                              src.id === 'garcom' ? 'ri-user-line' :
                              src.id === 'delivery' ? 'ri-bike-line' :
                              src.id === 'self_service' ? 'ri-tablet-line' :
                              'ri-qr-code-line'
                            }`} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-zinc-800">{src.label}</p>
                            {routedAccount ? (
                              <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                                <i className="ri-arrow-right-line text-[10px]" />
                                {routedAccount.name}
                              </p>
                            ) : (
                              <p className="text-xs text-zinc-400 mt-0.5">Sem conta definida</p>
                            )}
                          </div>
                        </div>
                        <select
                          value={routedAccountId}
                          onChange={e => setRoutingAccount(src.type, src.id, e.target.value)}
                          className="border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 w-full sm:min-w-44 sm:w-auto flex-shrink-0"
                        >
                          <option value="">Não definido</option>
                          {accounts.map(acc => (
                            <option key={acc.id} value={acc.id}>{acc.name}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Resumo do roteamento configurado */}
              {paymentMethods.some(pm => getRoutingAccount('payment_method', pm.id)) && (
                <div className="bg-zinc-50 rounded-xl border border-zinc-200 p-4">
                  <p className="text-xs font-bold text-zinc-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <i className="ri-route-line text-amber-500" /> Resumo do Roteamento Ativo
                  </p>
                  <div className="space-y-2">
                    {paymentMethods
                      .filter(pm => {
                        const daysToReceive = Number((pm as Record<string, unknown>).days_to_receive ?? 0);
                        return daysToReceive === 0 && getRoutingAccount('payment_method', pm.id);
                      })
                      .map(pm => {
                        const accountId = getRoutingAccount('payment_method', pm.id);
                        const account = accounts.find(a => a.id === accountId);
                        return (
                          <div key={pm.id} className="flex items-center gap-2 text-xs">
                            <span className="font-semibold text-zinc-700">{pm.name}</span>
                            <i className="ri-arrow-right-line text-zinc-300" />
                            <span className="flex items-center gap-1">
                              <span
                                className="w-2 h-2 rounded-full inline-block"
                                style={{ backgroundColor: account?.color ?? '#ccc' }}
                              />
                              <span className="text-zinc-600">{account?.name ?? '—'}</span>
                            </span>
                            <span className="text-green-600 font-semibold ml-auto">Ativo</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── MODAL CONTA ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
              <h3 className="font-semibold text-zinc-900">
                {editAccount ? 'Editar Conta' : 'Nova Conta Bancária'}
              </h3>
              <button
                onClick={() => { setShowModal(false); setEditAccount(null); setForm(emptyForm); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"
              >
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Nome da Conta *</label>
                  <input
                    required
                    value={form.name ?? ''}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Bradesco Principal, Caixa Físico..."
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Tipo de Conta *</label>
                  <select
                    value={form.account_type ?? 'checking'}
                    onChange={e => {
                      const type = e.target.value as BankAccount['account_type'];
                      setForm(f => ({ ...f, account_type: type, icon: ACCOUNT_TYPE_ICON[type] }));
                    }}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="checking">Conta Corrente</option>
                    <option value="savings">Conta Poupança</option>
                    <option value="cash">Caixa (Dinheiro)</option>
                    <option value="digital">Conta Digital</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Banco / Instituição</label>
                <input
                  value={form.bank_name ?? ''}
                  onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
                  placeholder="Ex: Bradesco, Nubank, Itaú, Caixa Econômica..."
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              {form.account_type !== 'cash' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-zinc-600 block mb-1">Agência</label>
                    <input
                      value={form.agency ?? ''}
                      onChange={e => setForm(f => ({ ...f, agency: e.target.value }))}
                      placeholder="0000"
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-600 block mb-1">Número da Conta</label>
                    <input
                      value={form.account_number ?? ''}
                      onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
                      placeholder="00000-0"
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>
              )}

              {form.account_type !== 'cash' && (
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1">Chave PIX</label>
                  <input
                    value={form.pix_key ?? ''}
                    onChange={e => setForm(f => ({ ...f, pix_key: e.target.value }))}
                    placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">
                  {editAccount ? 'Saldo Atual' : 'Saldo Inicial'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editAccount ? (form.current_balance ?? 0) : (form.initial_balance ?? 0)}
                  onChange={e => {
                    const val = Number(e.target.value);
                    if (editAccount) {
                      setForm(f => ({ ...f, current_balance: val }));
                    } else {
                      setForm(f => ({ ...f, initial_balance: val, current_balance: val }));
                    }
                  }}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <p className="text-xs text-zinc-400 mt-1">
                  {editAccount ? 'Ajuste manual do saldo atual' : 'Saldo que já existe nessa conta hoje'}
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-2">Cor de Identificação</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      className="w-7 h-7 rounded-full cursor-pointer transition-transform hover:scale-110 flex items-center justify-center"
                      style={{ backgroundColor: c }}
                    >
                      {form.color === c && <i className="ri-check-line text-white text-xs" />}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_default ?? false}
                  onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
                  className="rounded accent-amber-500"
                />
                <div>
                  <span className="text-sm font-semibold text-zinc-800">Conta Padrão</span>
                  <p className="text-xs text-zinc-400">Usada automaticamente quando nenhuma conta for especificada</p>
                </div>
              </label>

              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Observações</label>
                <textarea
                  value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  maxLength={500}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                />
              </div>

              {saveError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <i className="ri-error-warning-line text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-600">{saveError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditAccount(null); setForm(emptyForm); setSaveError(null); }}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? <><i className="ri-loader-4-line animate-spin" /> Salvando...</> : editAccount ? 'Salvar Alterações' : 'Cadastrar Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CONFIRM DELETE ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 flex items-center justify-center bg-red-100 rounded-full mx-auto mb-4">
              <i className="ri-delete-bin-line text-red-500 text-xl" />
            </div>
            <h3 className="text-center font-semibold text-zinc-900 mb-1">Remover Conta?</h3>
            <p className="text-center text-xs text-zinc-500 mb-5">
              A conta será desativada. O histórico de transações será mantido.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TRANSACTION HISTORY ── */}
      {historyAccount && (
        <TransactionHistory
          account={historyAccount}
          onClose={() => setHistoryAccount(null)}
        />
      )}
    </div>
  );
}
