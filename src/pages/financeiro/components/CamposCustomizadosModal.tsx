import { useState } from 'react';
import { usePayrollCustomFields } from '@/hooks/usePayrollCustomFields';
import type { PayrollCustomField } from '@/hooks/usePayrollCustomFields';

const PERCENTAGE_OF_OPTIONS = [
  { value: 'base_salary', label: 'Salário Base' },
  { value: 'total_proventos', label: 'Total Proventos' },
  { value: 'gross_salary', label: 'Salário Bruto' },
];

export default function CamposCustomizadosModal({ onClose }: { onClose: () => void }) {
  const { fields, proventos, descontos, loading, upsert, remove } = usePayrollCustomFields();
  const [editing, setEditing] = useState<Partial<PayrollCustomField> | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing?.name) return;
    upsert(editing);
    setEditing(null);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-base font-bold text-zinc-900">Campos Customizáveis da Folha</h3>
            <p className="text-xs text-zinc-500">Adicione proventos e descontos personalizados com fórmulas</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Lista de campos existentes */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Proventos */}
              <div>
                <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <i className="ri-add-circle-line" /> Proventos Customizados
                </p>
                {proventos.length === 0 ? (
                  <p className="text-sm text-zinc-400 py-2">Nenhum provento customizado cadastrado</p>
                ) : (
                  <div className="space-y-2">
                    {proventos.map(f => (
                      <div key={f.id} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800">{f.name}</p>
                          <p className="text-xs text-zinc-500">
                            {f.formula ? `Fórmula: ${f.formula}` : f.is_percentage ? `% de ${f.percentage_of}` : `Valor fixo: R$ ${f.fixed_value}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditing(f)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-100 text-zinc-500 cursor-pointer">
                            <i className="ri-edit-line text-sm" />
                          </button>
                          <button onClick={() => remove(f.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-100 text-red-500 cursor-pointer">
                            <i className="ri-delete-bin-line text-sm" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Descontos */}
              <div>
                <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <i className="ri-wallet-3-line" /> Descontos Customizados
                </p>
                {descontos.length === 0 ? (
                  <p className="text-sm text-zinc-400 py-2">Nenhum desconto customizado cadastrado</p>
                ) : (
                  <div className="space-y-2">
                    {descontos.map(f => (
                      <div key={f.id} className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800">{f.name}</p>
                          <p className="text-xs text-zinc-500">
                            {f.formula ? `Fórmula: ${f.formula}` : f.is_percentage ? `% de ${f.percentage_of}` : `Valor fixo: R$ ${f.fixed_value}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditing(f)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-100 text-zinc-500 cursor-pointer">
                            <i className="ri-edit-line text-sm" />
                          </button>
                          <button onClick={() => remove(f.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-100 text-red-500 cursor-pointer">
                            <i className="ri-delete-bin-line text-sm" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Form de adicionar/editar */}
          <div className="border-t border-zinc-200 pt-4">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">
              {editing?.id ? 'Editar Campo' : 'Novo Campo'}
            </p>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Nome *</label>
                  <input
                    required
                    value={editing?.name ?? ''}
                    onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Ex: Comissão, Adicional Periculosidade"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Tipo *</label>
                  <select
                    value={editing?.type ?? 'provento'}
                    onChange={e => setEditing(prev => ({ ...prev, type: e.target.value as 'provento' | 'desconto' }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white"
                  >
                    <option value="provento">Provento</option>
                    <option value="desconto">Desconto</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Modo de Cálculo</label>
                  <select
                    value={editing?.formula ? 'formula' : editing?.is_percentage ? 'percentage' : 'fixed'}
                    onChange={e => {
                      const mode = e.target.value;
                      setEditing(prev => ({
                        ...prev,
                        formula: mode === 'formula' ? prev?.formula || 'base * 0.10' : undefined,
                        is_percentage: mode === 'percentage',
                        fixed_value: mode === 'fixed' ? prev?.fixed_value || 0 : 0,
                      }));
                    }}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white"
                  >
                    <option value="fixed">Valor Fixo (R$)</option>
                    <option value="percentage">Percentual (%)</option>
                    <option value="formula">Fórmula Customizada</option>
                  </select>
                </div>

                {editing?.formula !== undefined && editing?.formula !== null ? (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Fórmula</label>
                    <input
                      value={editing.formula ?? ''}
                      onChange={e => setEditing(prev => ({ ...prev, formula: e.target.value }))}
                      placeholder="Ex: base * 0.10, fixed:500"
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 font-mono"
                    />
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Variáveis: base, total_proventos, gross_salary. Use "fixed:XXX" para valor fixo.
                    </p>
                  </div>
                ) : editing?.is_percentage ? (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Base do Percentual</label>
                    <select
                      value={editing?.percentage_of ?? 'base_salary'}
                      onChange={e => setEditing(prev => ({ ...prev, percentage_of: e.target.value }))}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-white"
                    >
                      {PERCENTAGE_OF_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Valor Fixo (R$)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={editing?.fixed_value ?? 0}
                      onChange={e => setEditing(prev => ({ ...prev, fixed_value: parseFloat(e.target.value) || 0 }))}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                    />
                  </div>
                )}
              </div>

              {editing?.is_percentage && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Percentual (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={editing?.fixed_value ?? 0}
                    onChange={e => setEditing(prev => ({ ...prev, fixed_value: parseFloat(e.target.value) || 0 }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="flex-1 border border-zinc-200 rounded-lg py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-2.5 text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors"
                >
                  {editing?.id ? 'Salvar' : 'Adicionar Campo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}