import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import type { BillPayable } from '@/types/financeiro';

interface DRECat {
  id: string;
  name: string;
  group_type: string;
  parent_id: string | null;
}

const GROUP_LABELS: Record<string, string> = {
  revenue: 'Receitas',
  cost: 'Custos',
  expense: 'Despesas Operacionais',
  tax: 'Impostos e Taxas',
};

interface Props {
  bills: BillPayable[];
  onClose: () => void;
  onSaved: () => void;
}

export default function ContasPagarDREModal({ bills, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const [dreCats, setDreCats] = useState<DRECat[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(0);
  const [filterUnlinked, setFilterUnlinked] = useState(true);
  const [search, setSearch] = useState('');

  const loadCats = useCallback(async () => {
    if (!user?.tenantId) return;
    const { data } = await supabase
      .from('fin_dre_categories')
      .select('id, name, group_type, parent_id')
      .eq('tenant_id', user.tenantId)
      .eq('is_active', true)
      .order('group_type')
      .order('sort_order');
    setDreCats(data ?? []);
  }, [user?.tenantId]);

  useEffect(() => {
    loadCats();
    // Pré-preencher com categorias já vinculadas
    const initial: Record<string, string> = {};
    bills.forEach(b => {
      if ((b as BillPayable & { dre_category_id?: string }).dre_category_id) {
        initial[b.id] = (b as BillPayable & { dre_category_id?: string }).dre_category_id!;
      }
    });
    setAssignments(initial);
  }, [loadCats, bills]);

  const filteredBills = bills.filter(b => {
    const hasLink = !!(b as BillPayable & { dre_category_id?: string }).dre_category_id || !!assignments[b.id];
    if (filterUnlinked && hasLink) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return b.description.toLowerCase().includes(q) || (b.supplier || '').toLowerCase().includes(q) || (b.category || '').toLowerCase().includes(q);
    }
    return true;
  });

  const unlinkedCount = bills.filter(b => {
    const hasLink = !!(b as BillPayable & { dre_category_id?: string }).dre_category_id || !!assignments[b.id];
    return !hasLink;
  }).length;

  const handleSave = async () => {
    if (!user?.tenantId) return;
    setSaving(true);
    let count = 0;
    const entries = Object.entries(assignments);
    for (const [billId, catId] of entries) {
      if (!catId) continue;
      await supabase
        .from('fin_accounts_payable')
        .update({ dre_category_id: catId })
        .eq('id', billId)
        .eq('tenant_id', user.tenantId);
      count++;
    }
    setSaved(count);
    setSaving(false);
    setTimeout(() => {
      onSaved();
      onClose();
    }, 800);
  };

  // Agrupar categorias por grupo
  const catsByGroup: Record<string, DRECat[]> = {};
  dreCats.forEach(c => {
    if (!catsByGroup[c.group_type]) catsByGroup[c.group_type] = [];
    catsByGroup[c.group_type].push(c);
  });

  const assignedCount = Object.values(assignments).filter(Boolean).length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-zinc-900">Vincular Categorias DRE</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Classifique as contas a pagar nas categorias do DRE para relatórios precisos
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 px-6 py-3 bg-zinc-50 border-b border-zinc-100 flex-shrink-0 flex-wrap gap-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-zinc-600">{unlinkedCount} sem categoria DRE</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-xs text-zinc-600">{bills.length - unlinkedCount} já vinculadas</span>
          </div>
          {assignedCount > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                {assignedCount} alteração{assignedCount > 1 ? 'ões' : ''} pendente{assignedCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-zinc-100 flex-shrink-0 flex-wrap">
          <div className="relative flex-1 min-w-0">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar conta..."
              className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <button
            onClick={() => setFilterUnlinked(f => !f)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors whitespace-nowrap ${filterUnlinked ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >
            <i className={filterUnlinked ? 'ri-eye-off-line' : 'ri-eye-line'} />
            {filterUnlinked ? 'Mostrando sem vínculo' : 'Mostrar todas'}
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {filteredBills.length === 0 ? (
            <div className="p-12 text-center">
              <i className="ri-check-double-line text-4xl text-green-300 block mb-3" />
              <p className="text-zinc-500 font-medium">Todas as contas já estão vinculadas!</p>
              <p className="text-zinc-400 text-sm mt-1">Desative o filtro para ver todas as contas</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Conta</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">Valor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">Categoria DRE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {filteredBills.map(b => {
                  const currentCat = assignments[b.id] || (b as BillPayable & { dre_category_id?: string }).dre_category_id || '';
                  const catName = dreCats.find(c => c.id === currentCat)?.name;
                  return (
                    <tr key={b.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-zinc-800 text-sm">{b.description}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {b.supplier && <span className="text-xs text-zinc-400">{b.supplier}</span>}
                          <span className="text-xs bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">{b.category}</span>
                          {b.due_date && (
                            <span className="text-xs text-zinc-400">
                              {new Date(b.due_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-zinc-800 whitespace-nowrap">
                        {formatCurrency(b.amount)}
                      </td>
                      <td className="px-4 py-3 min-w-[220px]">
                        <select
                          value={currentCat}
                          onChange={e => setAssignments(prev => ({ ...prev, [b.id]: e.target.value }))}
                          className={`w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer ${currentCat ? 'border-green-300 bg-green-50 text-green-800' : 'border-zinc-200 bg-white text-zinc-500'}`}
                        >
                          <option value="">— Não vincular —</option>
                          {Object.entries(catsByGroup).map(([group, cats]) => (
                            <optgroup key={group} label={GROUP_LABELS[group] ?? group}>
                              {cats.map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.parent_id ? '  └ ' : ''}{c.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {catName && (
                          <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                            <i className="ri-check-line" /> {catName}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 flex-shrink-0 bg-zinc-50">
          <p className="text-xs text-zinc-500">
            {assignedCount > 0
              ? `${assignedCount} conta${assignedCount > 1 ? 's' : ''} com alteração pendente`
              : 'Selecione a categoria DRE para cada conta'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-100 cursor-pointer whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || assignedCount === 0}
              className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {saving ? (
                <><i className="ri-loader-4-line animate-spin" /> Salvando...</>
              ) : saved > 0 ? (
                <><i className="ri-check-line" /> {saved} salvas!</>
              ) : (
                <><i className="ri-save-line" /> Salvar Vínculos</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
