import { useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import type { VoucherType, VoucherDiscountType } from '@/types/vouchers';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: { value: VoucherType; label: string; icon: string; desc: string }[] = [
  { value: 'gift_card', label: 'Gift Card', icon: 'ri-gift-line', desc: 'Saldo em dinheiro para usar em pedidos' },
  { value: 'discount', label: 'Desconto', icon: 'ri-discount-percent-line', desc: 'Percentual ou valor fixo de desconto' },
  { value: 'cashback', label: 'Cashback', icon: 'ri-refund-2-line', desc: 'Crédito de volta para o cliente' },
  { value: 'free_item', label: 'Item Grátis', icon: 'ri-restaurant-line', desc: 'Um item específico sem custo' },
];

export default function EmitirVoucherModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    voucher_type: 'gift_card' as VoucherType,
    original_amount: '' as string | number,
    code: '',
    discount_type: 'percent' as VoucherDiscountType,
    discount_value: '' as string | number,
    expires_at: '',
    customer_name: '',
    customer_email: '',
    notes: '',
  });

  function set(field: string, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.original_amount && form.voucher_type !== 'free_item') {
      setError('Informe o valor do voucher');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload: Record<string, unknown> = {
        action: 'issue_voucher',
        active_tenant_id: user?.tenantId,
        voucher_type: form.voucher_type,
        original_amount: form.original_amount !== '' ? Number(form.original_amount) : 0,
        expires_at: form.expires_at || null,
        customer_name: form.customer_name.trim() || null,
        customer_email: form.customer_email.trim() || null,
        notes: form.notes.trim() || null,
      };

      if (form.code.trim()) payload.code = form.code.trim().toUpperCase();

      if (form.voucher_type === 'discount') {
        payload.discount_type = form.discount_type;
        payload.discount_value = form.discount_value !== '' ? Number(form.discount_value) : null;
      }

      const { data, error: fnErr } = await invokeWithAuth('voucher-write', { body: payload });
      if (fnErr) throw fnErr;

      const code = (data as { data?: { code?: string } })?.data?.code ?? '';
      setSuccess(`Voucher ${code} emitido com sucesso!`);

      // Auditoria
      const typeLabels: Record<VoucherType, string> = {
        gift_card: 'Gift Card',
        discount: 'Desconto',
        cashback: 'Cashback',
        free_item: 'Item Grátis',
      };
      const valorDesc = form.voucher_type === 'discount'
        ? (form.discount_type === 'percent' ? `${form.discount_value}%` : `R$ ${Number(form.discount_value).toFixed(2)}`)
        : `R$ ${Number(form.original_amount).toFixed(2)}`;
      registrarEvento({
        tipo: 'voucher_emitido',
        severidade: 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? '—',
        descricao: `Voucher ${code} emitido — ${typeLabels[form.voucher_type]} ${valorDesc}${form.customer_name ? ` para ${form.customer_name}` : ''}`,
        entidade: 'Voucher',
        entidadeId: code,
        detalhes: form.notes || undefined,
      });

      setTimeout(() => onSaved(), 1500);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-rose-50 rounded-lg">
              <i className="ri-gift-line text-rose-600" />
            </div>
            <h2 className="text-base font-bold text-zinc-900">Emitir Voucher</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <i className="ri-error-warning-line" />{error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              <i className="ri-checkbox-circle-line" />{success}
            </div>
          )}

          {/* Tipo */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Tipo de voucher *</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set('voucher_type', t.value)}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-left cursor-pointer transition-all ${form.voucher_type === t.value ? 'border-rose-400 bg-rose-50' : 'border-zinc-200 hover:border-zinc-300'}`}
                >
                  <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${form.voucher_type === t.value ? 'bg-rose-100 text-rose-600' : 'bg-zinc-100 text-zinc-500'}`}>
                    <i className={`${t.icon} text-base`} />
                  </div>
                  <div>
                    <p className={`text-xs font-bold ${form.voucher_type === t.value ? 'text-rose-700' : 'text-zinc-700'}`}>{t.label}</p>
                    <p className="text-[10px] text-zinc-400 leading-tight">{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Valor */}
          {form.voucher_type !== 'free_item' && (
            <div className="grid grid-cols-2 gap-3">
              {form.voucher_type === 'discount' ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Tipo de desconto</label>
                    <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
                      {(['percent', 'fixed'] as VoucherDiscountType[]).map((dt) => (
                        <button key={dt} type="button" onClick={() => set('discount_type', dt)} className={`flex-1 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${form.discount_type === dt ? 'bg-white text-zinc-900' : 'text-zinc-500'}`}>
                          {dt === 'percent' ? 'Percentual (%)' : 'Fixo (R$)'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">
                      {form.discount_type === 'percent' ? 'Percentual (%)' : 'Valor (R$)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={form.discount_type === 'percent' ? 100 : undefined}
                      step="0.01"
                      value={form.discount_value}
                      onChange={(e) => { set('discount_value', e.target.value); set('original_amount', e.target.value); }}
                      placeholder={form.discount_type === 'percent' ? '20' : '50.00'}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
                    />
                  </div>
                </>
              ) : (
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Valor (R$) *</label>
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={form.original_amount}
                    onChange={(e) => set('original_amount', e.target.value)}
                    placeholder="100.00"
                    className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
                    required
                  />
                </div>
              )}
            </div>
          )}

          {/* Código personalizado e validade */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Código (opcional)</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="Gerado automaticamente"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Validade</label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) => set('expires_at', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Cliente */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Nome do cliente</label>
              <input
                type="text"
                value={form.customer_name}
                onChange={(e) => set('customer_name', e.target.value)}
                placeholder="Opcional"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">E-mail do cliente</label>
              <input
                type="email"
                value={form.customer_email}
                onChange={(e) => set('customer_email', e.target.value)}
                placeholder="Opcional"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Observações</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Motivo da emissão, campanha, etc."
              rows={2}
              maxLength={500}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
            />
          </div>

          {/* Botões */}
          <div className="flex items-center gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 cursor-pointer transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 cursor-pointer transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Emitindo...</>
              ) : (
                <><i className="ri-gift-line" /> Emitir Voucher</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
