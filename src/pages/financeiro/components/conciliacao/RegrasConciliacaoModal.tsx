import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCostCenters } from '@/hooks/useFinanceiro';
import { supabase } from '@/lib/supabase';
import type { ReconciliationRule } from '@/hooks/useConciliacao';

interface Props {
  rules: ReconciliationRule[];
  onClose: () => void;
  onCreate: (payload: Omit<ReconciliationRule, 'id' | 'tenant_id' | 'match_count' | 'created_at'>) => Promise<ReconciliationRule | null>;
  onUpdate: (id: string, updates: Partial<ReconciliationRule>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

const MATCH_TYPES = [
  { value: 'contains' as const, label: 'Contém' },
  { value: 'starts_with' as const, label: 'Começa com' },
  { value: 'ends_with' as const, label: 'Termina com' },
  { value: 'exact' as const, label: 'Exato' },
  { value: 'regex' as const, label: 'Expressão regular' },
];

const TX_TYPES = [
  { value: 'both' as const, label: 'Crédito e Débito' },
  { value: 'credit' as const, label: 'Só Crédito' },
  { value: 'debit' as const, label: 'Só Débito' },
];

export default function RegrasConciliacaoModal({ rules, onClose, onCreate, onUpdate, onDelete }: Props) {
  const { user } = useAuth();
  const { centers } = useCostCenters();
  const [editing, setEditing] = useState<ReconciliationRule | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    pattern: '',
    match_type: 'contains' as ReconciliationRule['match_type'],
    category: '',
    cost_center_id: '',
    transaction_type: 'both' as ReconciliationRule['transaction_type'],
    description_template: '',
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rules;
    const q = search.toLowerCase();
    return rules.filter(r =>
      r.pattern.toLowerCase().includes(q) ||
      (r.category?.toLowerCase().includes(q) ?? false)
    );
  }, [rules, search]);

  const resetForm = () => {
    setForm({
      pattern: '',
      match_type: 'contains',
      category: '',
      cost_center_id: '',
      transaction_type: 'both',
      description_template: '',
    });
    setIsCreating(false);
    setEditing(null);
  };

  const handleSave = async () => {
    if (!form.pattern.trim()) return;
    setSaving(true);
    if (editing) {
      await onUpdate(editing.id, {
        pattern: form.pattern,
        match_type: form.match_type,
        category: form.category || null,
        cost_center_id: form.cost_center_id || null,
        transaction_type: form.transaction_type,
        description_template: form.description_template || null,
      });
      resetForm();
    } else {
      await onCreate({
        pattern: form.pattern,
        match_type: form.match_type,
        category: form.category || null,
        cost_center_id: form.cost_center_id || null,
        transaction_type: form.transaction_type,
        description_template: form.description_template || null,
        is_active: true,
        bank_account_id: undefined,
      });
      resetForm();
    }
    setSaving(false);
  };

  const startEdit = (rule: ReconciliationRule) => {
    setEditing(rule);
    setForm({
      pattern: rule.pattern,
      match_type: rule.match_type,
      category: rule.category ?? '',
      cost_center_id: rule.cost_center_id ?? '',
      transaction_type: rule.transaction_type,
      description_template: rule.description_template ?? '',
    });
    setIsCreating(true);
  };

  const dreCategories = [
    'Receita', 'CMV', 'Folha de Pagamento', 'Aluguel', 'Energia',
    'Água', 'Internet/Telefone', 'Marketing', 'Manutenção', 'Impostos',
    'Taxas Bancárias', 'Transporte', 'Material de Escritório', 'Outros',
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-zinc-900 text-base">Regras de Auto-Classificação</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {rules.length} regra{rules.length !== 1 ? 's' : ''} cadastrada{rules.length !== 1 ? 's' : ''}
              {rules.length > 0 && ` · ${rules.reduce((s, r) => s + r.match_count, 0)} aplicações`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {/* Search + Add */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-zinc-100 flex-shrink-0">
          <div className="relative flex-1">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar regras..."
              className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            />
          </div>
          <button
            onClick={() => { resetForm(); setIsCreating(true); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-add-line" /> Nova Regra
          </button>
        </div>

        {/* Form */}
        {isCreating && (
          <div className="px-6 py-4 bg-amber-50/50 border-b border-amber-100 flex-shrink-0">
            <p className="text-xs font-semibold text-amber-700 mb-3">
              {editing ? 'Editar Regra' : 'Nova Regra de Classificação'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-600 mb-1 block">Padrão de busca na descrição</label>
                <input
                  value={form.pattern}
                  onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
                  placeholder="Ex: PIX, SALARIO, ENERGIA, ALUGUEL..."
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 mb-1 block">Tipo de match</label>
                <select
                  value={form.match_type}
                  onChange={e => setForm(f => ({ ...f, match_type: e.target.value as ReconciliationRule['match_type'] }))}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  {MATCH_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 mb-1 block">Aplica em</label>
                <select
                  value={form.transaction_type}
                  onChange={e => setForm(f => ({ ...f, transaction_type: e.target.value as ReconciliationRule['transaction_type'] }))}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  {TX_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
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
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-600 mb-1 block">Template de descrição (opcional)</label>
                <input
                  value={form.description_template}
                  onChange={e => setForm(f => ({ ...f, description_template: e.target.value }))}
                  placeholder="Ex: Pagamento de {pattern} — {date}"
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
                <p className="text-xs text-zinc-400 mt-1">Use &#123;pattern&#125; para o texto encontrado, &#123;date&#125; para a data</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={handleSave}
                disabled={saving || !form.pattern.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
              >
                {saving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <i className="ri-save-line" />}
                {editing ? 'Salvar Alterações' : 'Criar Regra'}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
              <i className="ri-file-list-3-line text-3xl mb-2" />
              <p className="text-sm">{search ? 'Nenhuma regra encontrada' : 'Nenhuma regra cadastrada'}</p>
              {!search && <p className="text-xs text-zinc-400 mt-1">Crie regras para classificar lançamentos automaticamente</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(rule => (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 hover:border-amber-300 transition-colors bg-white"
                >
                  <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-100 flex-shrink-0">
                    <i className="ri-filter-3-line text-amber-600 text-sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-zinc-800">{rule.pattern}</p>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
                        {MATCH_TYPES.find(t => t.value === rule.match_type)?.label}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        rule.transaction_type === 'credit' ? 'bg-green-100 text-green-700' :
                        rule.transaction_type === 'debit' ? 'bg-red-100 text-red-700' :
                        'bg-zinc-100 text-zinc-600'
                      }`}>
                        {TX_TYPES.find(t => t.value === rule.transaction_type)?.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {rule.category && (
                        <span className="text-xs text-amber-600 font-medium">{rule.category}</span>
                      )}
                      {rule.cost_center_id && (
                        <span className="text-xs text-zinc-400">
                          · {centers.find(c => c.id === rule.cost_center_id)?.name ?? 'CC'}
                        </span>
                      )}
                      <span className="text-xs text-zinc-400 ml-auto">
                        {rule.match_count} uso{rule.match_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => startEdit(rule)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 cursor-pointer"
                      title="Editar"
                    >
                      <i className="ri-pencil-line text-amber-600 text-sm" />
                    </button>
                    <button
                      onClick={() => onDelete(rule.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 cursor-pointer"
                      title="Excluir"
                    >
                      <i className="ri-delete-bin-line text-red-400 text-sm" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}