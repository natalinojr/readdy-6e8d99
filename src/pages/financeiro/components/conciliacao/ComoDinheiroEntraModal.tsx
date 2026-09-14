import { useState, useEffect } from 'react';
import { useBankAccounts } from '@/hooks/useFinanceiro';
import { useMoneyFlow } from '@/hooks/useMoneyFlow';
import {
  BANK_PROVIDERS, CARD_PROVIDERS, CARD_PIX_MODES,
  type BankProvider, type CardProvider, type CardPixMode, type MoneyFlowSettings,
} from '@/lib/revenueSources';

// "Como o dinheiro entra": o papel de cada banco/maquininha da loja. Trocar de
// maquininha ou de banco é mudar aqui (se o conector da empresa existir). As
// credenciais de cada integração continuam nas telas próprias (Inter, Stone, iFood).

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const selectCls = 'w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white';

export default function ComoDinheiroEntraModal({ onClose, onSaved }: Props) {
  const { accounts } = useBankAccounts();
  const { flow, loading, save } = useMoneyFlow();
  const [form, setForm] = useState<MoneyFlowSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !form) {
      setForm({
        ...flow,
        bank_provider: flow.bank_provider ?? 'inter',
        card_provider: flow.card_provider ?? 'nenhuma',
        card_pix_mode: flow.card_pix_mode ?? 'transfer',
      });
    }
  }, [loading, flow, form]);

  const set = <K extends keyof MoneyFlowSettings>(k: K, v: MoneyFlowSettings[K]) =>
    setForm(f => (f ? { ...f, [k]: v } : f));

  const trocarMaquininha = (cp: CardProvider) => {
    setForm(f => {
      if (!f) return f;
      const antigo = f.card_provider ? CARD_PROVIDERS[f.card_provider].depositMatch : '';
      // O texto do extrato acompanha a maquininha, a não ser que tenha sido editado à mão
      const match = !f.card_deposit_match || f.card_deposit_match === antigo ? (CARD_PROVIDERS[cp].depositMatch || null) : f.card_deposit_match;
      return { ...f, card_provider: cp, card_deposit_match: match };
    });
  };

  const handleSave = async () => {
    if (!form) return;
    if (form.bank_provider !== 'outro' && !form.bank_account_id) { setError('Escolha a conta do banco principal.'); return; }
    const temMaquininha = form.card_provider !== 'nenhuma';
    if (form.card_provider === 'stone' && !form.card_deposit_account_id) { setError('Escolha a conta onde cai o repasse da maquininha.'); return; }
    setError('');
    setSaving(true);
    const { error: err } = await save({
      ...form,
      bank_account_id: form.bank_provider === 'outro' ? null : form.bank_account_id,
      card_deposit_account_id: temMaquininha ? form.card_deposit_account_id : null,
      card_deposit_match: temMaquininha ? form.card_deposit_match : null,
      card_pix_mode: temMaquininha ? form.card_pix_mode : 'none',
    });
    setSaving(false);
    if (err) { setError(err); return; }
    onSaved();
    onClose();
  };

  const contaOptions = (
    <>
      <option value="">Selecione uma conta...</option>
      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.bank_name ? ` (${a.bank_name})` : ''}</option>)}
    </>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-zinc-900">Como o dinheiro entra</h3>
            <p className="text-xs text-zinc-500">O papel de cada banco e maquininha desta loja</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {!form ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-6 overflow-y-auto">
            {/* Banco principal */}
            <section className="space-y-2">
              <p className="text-sm font-semibold text-zinc-800 flex items-center gap-1.5"><i className="ri-bank-line text-zinc-400" /> Banco principal</p>
              <p className="text-xs text-zinc-500">Onde o Pix recebido conta como receita.</p>
              <select value={form.bank_provider ?? 'inter'} onChange={e => set('bank_provider', e.target.value as BankProvider)} className={selectCls}>
                {(Object.keys(BANK_PROVIDERS) as BankProvider[]).map(b => <option key={b} value={b}>{BANK_PROVIDERS[b].label}</option>)}
              </select>
              <p className="text-xs text-zinc-400">{BANK_PROVIDERS[form.bank_provider ?? 'inter'].hint}</p>
              {form.bank_provider !== 'outro' && (
                <select value={form.bank_account_id ?? ''} onChange={e => set('bank_account_id', e.target.value || null)} className={selectCls}>
                  {contaOptions}
                </select>
              )}
            </section>

            {/* Maquininha */}
            <section className="space-y-2 border-t border-zinc-100 pt-5">
              <p className="text-sm font-semibold text-zinc-800 flex items-center gap-1.5"><i className="ri-bank-card-line text-zinc-400" /> Maquininha</p>
              <select value={form.card_provider ?? 'nenhuma'} onChange={e => trocarMaquininha(e.target.value as CardProvider)} className={selectCls}>
                {(Object.keys(CARD_PROVIDERS) as CardProvider[]).map(c => (
                  <option key={c} value={c}>{CARD_PROVIDERS[c].label}{c === 'mercadopago' ? ' (conector em breve)' : ''}</option>
                ))}
              </select>
              {form.card_provider && CARD_PROVIDERS[form.card_provider].hint && (
                <p className={`text-xs ${CARD_PROVIDERS[form.card_provider].conector ? 'text-zinc-400' : 'text-amber-600'}`}>
                  {CARD_PROVIDERS[form.card_provider].hint}
                </p>
              )}

              {form.card_provider !== 'nenhuma' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">O repasse do cartão cai em</label>
                    <select value={form.card_deposit_account_id ?? ''} onChange={e => set('card_deposit_account_id', e.target.value || null)} className={selectCls}>
                      {contaOptions}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">Como o repasse aparece no extrato</label>
                    <input value={form.card_deposit_match ?? ''} onChange={e => set('card_deposit_match', e.target.value)}
                      placeholder="ex.: stone" className={selectCls} />
                    <p className="text-xs text-zinc-400 mt-1">Um trecho da descrição do crédito no extrato. O sistema junta esses créditos com as vendas que a maquininha disse que ia pagar no dia, e eles deixam de contar como receita (a receita vem das vendas).</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-zinc-700 mb-1">Pix vendido na maquininha</p>
                    <div className="space-y-1.5">
                      {(Object.keys(CARD_PIX_MODES) as CardPixMode[]).map(m => (
                        <label key={m} className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer ${form.card_pix_mode === m ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:bg-zinc-50'}`}>
                          <input type="radio" name="pixmode" checked={form.card_pix_mode === m} onChange={() => set('card_pix_mode', m)} className="mt-0.5 accent-amber-600" />
                          <span>
                            <span className="block text-sm text-zinc-800">{CARD_PIX_MODES[m].label}</span>
                            <span className="block text-xs text-zinc-500">{CARD_PIX_MODES[m].hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* iFood */}
            <section className="space-y-2 border-t border-zinc-100 pt-5">
              <p className="text-sm font-semibold text-zinc-800 flex items-center gap-1.5"><i className="ri-restaurant-2-line text-zinc-400" /> iFood deposita em</p>
              <select value={form.ifood_deposit_account_id ?? ''} onChange={e => set('ifood_deposit_account_id', e.target.value || null)} className={selectCls}>
                <option value="">Mesma conta do banco principal</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.bank_name ? ` (${a.bank_name})` : ''}</option>)}
              </select>
            </section>

            <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-xs text-zinc-600 space-y-1">
              <p><i className="ri-information-line mr-1" />O que conta como receita (pedidos, cartão, Pix, iFood, manuais) continua em <strong>Receitas › Fontes</strong>.</p>
              <p>Receitas, DRE e Visão Geral são recalculadas com esta configuração, <strong>inclusive meses passados</strong>.</p>
            </div>

            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600">{error}</div>}

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer">Cancelar</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold cursor-pointer">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
