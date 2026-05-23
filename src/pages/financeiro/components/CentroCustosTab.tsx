import { useState } from 'react';
import { useCostCenters } from '@/hooks/useFinanceiro';
import type { CostCenter } from '@/types/financeiro';

const COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16'];
const ICONS = ['ri-restaurant-line', 'ri-store-line', 'ri-settings-line', 'ri-megaphone-line', 'ri-truck-line', 'ri-tools-line', 'ri-team-line', 'ri-building-line'];

const emptyForm = { name: '', color: '#f59e0b', icon: 'ri-store-line' };

export default function CentroCustosTab() {
  const { centers, loading, upsert, remove } = useCostCenters();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openNew = () => { setEditing(null); setForm(emptyForm); setSaveError(null); setShowModal(true); };
  const openEdit = (c: CostCenter) => { setEditing(c); setForm({ name: c.name, color: c.color, icon: c.icon }); setSaveError(null); setShowModal(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

    // Validação local de duplicata — só aplica se a lista já carregou completamente
    if (!loading && centers.length > 0) {
      const trimmedName = form.name.trim().toLowerCase();
      const isDuplicate = centers.some(
        c => c.name.trim().toLowerCase() === trimmedName && c.id !== editing?.id
      );
      if (isDuplicate) {
        setSaving(false);
        setSaveError('Já existe um centro de custo com este nome. Escolha outro nome.');
        return;
      }
    }

    const result = await upsert(editing ? { ...form, id: editing.id } : form);
    setSaving(false);
    if (result && 'error' in result && result.error) {
      const msg = String(result.error);
      if (msg.includes('uq_cost_center_name_tenant') || msg.includes('unique') || msg.includes('Já existe um centro de custo')) {
        setSaveError('Já existe um centro de custo com este nome. Escolha outro nome.');
      } else {
        setSaveError(msg);
      }
      return;
    }
    setShowModal(false);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Centros de Custo</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Categorize suas despesas por área do negócio</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors">
          <i className="ri-add-line" /> Novo Centro
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-zinc-200 p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : centers.length === 0 ? (
        <div className="bg-white rounded-xl border border-zinc-200 p-12 text-center">
          <i className="ri-pie-chart-line text-4xl text-zinc-300 block mb-3" />
          <p className="text-zinc-500 font-medium">Nenhum centro de custo cadastrado</p>
          <p className="text-zinc-400 text-sm mt-1">Crie centros para organizar suas despesas</p>
          <button onClick={openNew}
            className="mt-4 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors">
            Criar primeiro centro
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {centers.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-zinc-200 p-5 flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center rounded-xl flex-shrink-0" style={{ backgroundColor: c.color + '20' }}>
                <i className={`${c.icon} text-xl`} style={{ color: c.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-zinc-800 truncate">{c.name}</p>
                <p className="text-xs text-zinc-400 mt-0.5">Ativo</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(c)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
                  <i className="ri-edit-line text-xs" />
                </button>
                <button onClick={() => remove(c.id)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer">
                  <i className="ri-delete-bin-line text-xs" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">{editing ? 'Editar' : 'Novo'} Centro de Custo</h3>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Nome *</label>
                <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-2">Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(color => (
                    <button key={color} type="button" onClick={() => setForm(f => ({ ...f, color }))}
                      className={`w-7 h-7 rounded-full cursor-pointer transition-transform ${form.color === color ? 'scale-125 ring-2 ring-offset-1 ring-zinc-400' : ''}`}
                      style={{ backgroundColor: color }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-2">Ícone</label>
                <div className="flex gap-2 flex-wrap">
                  {ICONS.map(icon => (
                    <button key={icon} type="button" onClick={() => setForm(f => ({ ...f, icon }))}
                      className={`w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-colors ${form.icon === icon ? 'bg-amber-100 text-amber-600' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
                      <i className={`${icon} text-base`} />
                    </button>
                  ))}
                </div>
              </div>
              {saveError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <i className="ri-error-warning-line text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-600">{saveError}</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} disabled={saving}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  {saving ? <><i className="ri-loader-4-line animate-spin" /> Salvando...</> : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
