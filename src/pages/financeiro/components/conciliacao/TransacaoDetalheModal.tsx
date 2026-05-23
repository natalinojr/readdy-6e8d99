import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCostCenters } from '@/hooks/useFinanceiro';
import { formatCurrency } from '@/lib/formatters';
import type { StatementImport, BillMatch, ReceivableMatch, ReconciliationRule } from '@/hooks/useConciliacao';

interface Props {
  transaction: StatementImport | null;
  rules: ReconciliationRule[];
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<StatementImport>) => Promise<boolean>;
  onReconcile: (id: string) => Promise<boolean>;
  onUnreconcile: (id: string) => Promise<boolean>;
  onCreateRule: (pattern: string, category: string, costCenterId: string, txType: 'credit' | 'debit') => Promise<ReconciliationRule | null>;
  findBillMatches: (amount: number, date: string) => Promise<BillMatch[]>;
  findReceivableMatches: (amount: number, date: string) => Promise<ReceivableMatch[]>;
}

export default function TransacaoDetalheModal({
  transaction,
  rules,
  onClose,
  onUpdate,
  onReconcile,
  onUnreconcile,
  onCreateRule,
  findBillMatches,
  findReceivableMatches,
}: Props) {
  const { user } = useAuth();
  const { centers } = useCostCenters();
  const [saving, setSaving] = useState(false);
  const [billMatches, setBillMatches] = useState<BillMatch[]>([]);
  const [receivableMatches, setReceivableMatches] = useState<ReceivableMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({ pattern: '', category: '', costCenterId: '' });

  const [form, setForm] = useState({
    description: '',
    category: '',
    cost_center_id: '',
    notes: '',
  });

  useEffect(() => {
    if (transaction) {
      setForm({
        description: transaction.description || '',
        category: transaction.category || '',
        cost_center_id: transaction.cost_center_id || '',
        notes: transaction.notes || '',
      });
      setRuleForm({
        pattern: transaction.description?.split(' ')[0] ?? '',
        category: transaction.category || '',
        costCenterId: transaction.cost_center_id || '',
      });
      loadMatches();
    }
  }, [transaction]);

  const loadMatches = useCallback(async () => {
    if (!transaction) return;
    setLoadingMatches(true);
    const [bills, receivables] = await Promise.all([
      transaction.transaction_type === 'debit' ? findBillMatches(Number(transaction.amount), transaction.transaction_date) : Promise.resolve([]),
      transaction.transaction_type === 'credit' ? findReceivableMatches(Number(transaction.amount), transaction.transaction_date) : Promise.resolve([]),
    ]);
    setBillMatches(bills);
    setReceivableMatches(receivables);
    setLoadingMatches(false);
  }, [transaction, findBillMatches, findReceivableMatches]);

  if (!transaction) return null;

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(transaction.id, {
      description: form.description,
      category: form.category || null,
      cost_center_id: form.cost_center_id || null,
      notes: form.notes || null,
    });
    setSaving(false);
  };

  const handleCreateRule = async () => {
    if (!ruleForm.pattern.trim()) return;
    setSaving(true);
    await onCreateRule(ruleForm.pattern, ruleForm.category, ruleForm.costCenterId, transaction.transaction_type);
    setShowCreateRule(false);
    setSaving(false);
  };

  const dreCategories = [
    'Receita', 'CMV', 'Folha de Pagamento', 'Aluguel', 'Energia',
    'Água', 'Internet/Telefone', 'Marketing', 'Manutenção', 'Impostos',
    'Taxas Bancárias', 'Transporte', 'Material de Escritório', 'Outros',
  ];

  const matchedRule = rules.find(r => {
    const desc = transaction.description?.toLowerCase() ?? '';
    const pattern = r.pattern.toLowerCase();
    if (r.transaction_type !== 'both' && r.transaction_type !== transaction.transaction_type) return false;
    switch (r.match_type) {
      case 'contains': return desc.includes(pattern);
      case 'starts_with': return desc.startsWith(pattern);
      case 'ends_with': return desc.endsWith(pattern);
      case 'exact': return desc === pattern;
      case 'regex':
        try { return new RegExp(pattern, 'i').test(transaction.description ?? ''); } catch { return false; }
    }
    return false;
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-xl ${
              transaction.transaction_type === 'credit' ? 'bg-green-100' : 'bg-red-100'
            }`}>
              <i className={`${transaction.transaction_type === 'credit' ? 'ri-arrow-down-circle-line text-green-600' : 'ri-arrow-up-circle-line text-red-600'} text-lg`} />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900 text-base">Detalhe da Transação</h3>
              <p className="text-xs text-zinc-500">
                {new Date(transaction.transaction_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                {transaction.external_id && ` · ID: ${transaction.external_id}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Valor */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-50 border border-zinc-200">
            <span className="text-sm text-zinc-500">Valor</span>
            <span className={`text-2xl font-bold ${transaction.transaction_type === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
              {transaction.transaction_type === 'debit' ? '-' : '+'}{formatCurrency(Number(transaction.amount))}
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
              transaction.reconciled ? 'bg-green-100 text-green-700' :
              transaction.status === 'matched' ? 'bg-blue-100 text-blue-700' :
              transaction.status === 'ignored' ? 'bg-zinc-100 text-zinc-500' :
              'bg-amber-100 text-amber-700'
            }`}>
              <i className={`${transaction.reconciled ? 'ri-checkbox-circle-fill' : transaction.status === 'matched' ? 'ri-link' : 'ri-time-line'} text-xs`} />
              {transaction.reconciled ? 'Reconciliado' : transaction.status === 'matched' ? 'Conciliado' : transaction.status === 'ignored' ? 'Ignorado' : 'Pendente'}
            </span>
            {matchedRule && (
              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                <i className="ri-filter-3-line mr-1" />
                Regra: {matchedRule.pattern}
              </span>
            )}
          </div>

          {/* Form */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-zinc-600 mb-1 block">Descrição</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-zinc-600 mb-1 block">Categoria DRE</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">Sem categoria</option>
                  {dreCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 mb-1 block">Centro de Custo</label>
                <select
                  value={form.cost_center_id}
                  onChange={e => setForm(f => ({ ...f, cost_center_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">Nenhum</option>
                  {centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 mb-1 block">Observações internas</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white resize-none"
              />
            </div>
          </div>

          {/* Create rule from this */}
          {!showCreateRule ? (
            <button
              onClick={() => setShowCreateRule(true)}
              className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium cursor-pointer transition-colors"
            >
              <i className="ri-filter-3-line" />
              Criar regra de classificação a partir desta transação
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
              <p className="text-xs font-semibold text-amber-700">Criar regra automática</p>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={ruleForm.pattern}
                  onChange={e => setRuleForm(f => ({ ...f, pattern: e.target.value }))}
                  placeholder="Padrão"
                  className="px-2 py-1.5 border border-amber-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
                <select
                  value={ruleForm.category}
                  onChange={e => setRuleForm(f => ({ ...f, category: e.target.value }))}
                  className="px-2 py-1.5 border border-amber-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">Categoria</option>
                  {dreCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={ruleForm.costCenterId}
                  onChange={e => setRuleForm(f => ({ ...f, costCenterId: e.target.value }))}
                  className="px-2 py-1.5 border border-amber-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">Centro de Custo</option>
                  {centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateRule}
                  disabled={saving || !ruleForm.pattern.trim()}
                  className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
                >
                  {saving ? 'Salvando...' : 'Criar Regra'}
                </button>
                <button
                  onClick={() => setShowCreateRule(false)}
                  className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer whitespace-nowrap transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Matches */}
          {transaction.transaction_type === 'debit' && (
            <div>
              <p className="text-xs font-semibold text-zinc-600 mb-2 flex items-center gap-1">
                <i className="ri-bill-line" /> Contas a Pagar Relacionadas
              </p>
              {loadingMatches ? (
                <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                  <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  Buscando...
                </div>
              ) : billMatches.length === 0 ? (
                <p className="text-xs text-zinc-400 py-2">Nenhuma conta a pagar encontrada com valor próximo</p>
              ) : (
                <div className="space-y-1.5">
                  {billMatches.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-200 hover:border-amber-300 bg-white cursor-pointer transition-colors">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-800 truncate">{m.description}</p>
                        <p className="text-xs text-zinc-400">{m.supplier} · Vence {new Date(m.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${m.confidence === 'high' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {m.confidence === 'high' ? 'Alta' : 'Média'}
                        </span>
                        <span className="text-xs font-bold text-zinc-800">{formatCurrency(m.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {transaction.transaction_type === 'credit' && (
            <div>
              <p className="text-xs font-semibold text-zinc-600 mb-2 flex items-center gap-1">
                <i className="ri-money-dollar-circle-line" /> Recebíveis Relacionados
              </p>
              {loadingMatches ? (
                <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                  <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  Buscando...
                </div>
              ) : receivableMatches.length === 0 ? (
                <p className="text-xs text-zinc-400 py-2">Nenhum recebível encontrado com valor próximo</p>
              ) : (
                <div className="space-y-1.5">
                  {receivableMatches.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-200 hover:border-amber-300 bg-white cursor-pointer transition-colors">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-800">Pedido {m.order_number ?? m.id.slice(0, 8)}</p>
                        {m.due_date && <p className="text-xs text-zinc-400">Vence {new Date(m.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${m.confidence === 'high' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {m.confidence === 'high' ? 'Alta' : 'Média'}
                        </span>
                        <span className="text-xs font-bold text-zinc-800">{formatCurrency(m.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 flex-shrink-0 bg-zinc-50">
          <div className="flex items-center gap-2">
            {transaction.reconciled ? (
              <button
                onClick={async () => { await onUnreconcile(transaction.id); onClose(); }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-refresh-line" /> Desfazer Reconciliação
              </button>
            ) : (
              <button
                onClick={async () => { await onReconcile(transaction.id); onClose(); }}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-semibold hover:bg-green-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-checkbox-circle-line" /> Reconciliar
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
            >
              {saving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <i className="ri-save-line" />}
              Salvar Alterações
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}