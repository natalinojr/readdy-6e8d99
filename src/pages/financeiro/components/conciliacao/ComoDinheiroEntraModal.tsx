import { useState, useEffect } from 'react';
import { useBankAccounts } from '@/hooks/useFinanceiro';
import { useMoneyFlow } from '@/hooks/useMoneyFlow';
import {
  BANK_PROVIDERS, CARD_PROVIDERS, CARD_PIX_MODES,
  type BankProvider, type CardProvider, type CardPixMode, type MoneyFlowSettings, type CardProviderConfig,
} from '@/lib/revenueSources';
import { TaxasContratadasEditor, useTaxasContratadas } from './TaxasContratadas';

// "Como o dinheiro entra": o papel de cada banco e maquininha da loja. Trocar de
// maquininha ou de banco é mudar aqui (se o conector da empresa existir). As
// credenciais de cada integração continuam nas telas próprias (Inter, Stone, iFood).
//
// A loja pode ter MAIS DE UMA maquininha ao mesmo tempo (Paranaguá roda Stone e
// Mercado Pago juntas): cada uma é uma linha, com a sua conta de repasse, o seu
// texto no extrato e o seu modo de Pix — é isso que o casamento da Conciliação lê.

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const selectCls = 'w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white';
const MAQUININHAS: CardProvider[] = ['stone', 'mercadopago', 'outra'];

export default function ComoDinheiroEntraModal({ onClose, onSaved }: Props) {
  const { accounts } = useBankAccounts();
  const { flow, providers, loading, save, saveProviders } = useMoneyFlow();
  const [form, setForm] = useState<MoneyFlowSettings | null>(null);
  const [cards, setCards] = useState<CardProviderConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const temStone = cards.some(c => c.provider === 'stone');
  const taxas = useTaxasContratadas(temStone ? 'stone' : null);

  useEffect(() => {
    if (!loading && !form) {
      setForm({
        ...flow,
        bank_provider: flow.bank_provider ?? 'inter',
        card_provider: flow.card_provider ?? 'nenhuma',
        card_pix_mode: flow.card_pix_mode ?? 'transfer',
      });
      setCards(providers);
    }
  }, [loading, flow, providers, form]);

  const set = <K extends keyof MoneyFlowSettings>(k: K, v: MoneyFlowSettings[K]) =>
    setForm(f => (f ? { ...f, [k]: v } : f));

  const setCard = (provider: CardProvider, patch: Partial<CardProviderConfig>) =>
    setCards(cs => cs.map(c => (c.provider === provider ? { ...c, ...patch } : c)));

  const toggleCard = (provider: CardProvider) =>
    setCards(cs => cs.some(c => c.provider === provider)
      ? cs.filter(c => c.provider !== provider)
      : [...cs, {
          provider,
          // O repasse cai, por padrão, na conta do banco principal
          deposit_account_id: form?.bank_account_id ?? null,
          deposit_match: CARD_PROVIDERS[provider].depositMatch || null,
          pix_mode: 'transfer' as CardPixMode,
        }]);

  const handleSave = async () => {
    if (!form) return;
    if (form.bank_provider !== 'outro' && !form.bank_account_id) { setError('Escolha a conta do banco principal.'); return; }
    for (const c of cards) {
      if (!CARD_PROVIDERS[c.provider].conector) continue;
      if (!c.deposit_account_id) { setError(`Escolha a conta onde cai o repasse da ${CARD_PROVIDERS[c.provider].label}.`); return; }
      if (!c.deposit_match?.trim()) { setError(`Informe como o repasse da ${CARD_PROVIDERS[c.provider].label} aparece no extrato.`); return; }
    }
    setError('');
    setSaving(true);

    // Maquininha "principal" segue gravada em fin_revenue_settings para as telas e
    // funções antigas que leem um provider só (fn_money_flow resolve o resto).
    const principal: CardProvider = cards.some(c => c.provider === 'stone') ? 'stone'
      : cards.some(c => c.provider === 'mercadopago') ? 'mercadopago'
      : cards.length > 0 ? 'outra' : 'nenhuma';
    const principalCfg = cards.find(c => c.provider === principal) ?? null;

    const { error: errProv } = await saveProviders(cards);
    if (errProv) { setSaving(false); setError(errProv); return; }

    const { error: err } = await save({
      ...form,
      bank_account_id: form.bank_provider === 'outro' ? null : form.bank_account_id,
      card_provider: principal,
      card_deposit_account_id: principalCfg?.deposit_account_id ?? null,
      card_deposit_match: principalCfg?.deposit_match ?? null,
      card_pix_mode: cards.some(c => c.pix_mode === 'transfer') ? 'transfer' : (principalCfg?.pix_mode ?? 'none'),
    });
    if (err) { setSaving(false); setError(err); return; }
    const errTaxas = temStone ? await taxas.save() : null;
    setSaving(false);
    if (errTaxas) { setError('Configuração salva, mas as taxas não: ' + errTaxas); return; }
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
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
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

            {/* Maquininhas — pode marcar mais de uma */}
            <section className="space-y-3 border-t border-zinc-100 pt-5">
              <div>
                <p className="text-sm font-semibold text-zinc-800 flex items-center gap-1.5"><i className="ri-bank-card-line text-zinc-400" /> Maquininhas</p>
                <p className="text-xs text-zinc-500">Marque todas as que a loja usa hoje. Se você trocou de maquininha e a antiga ainda tem repasse para cair, deixe as duas marcadas.</p>
              </div>

              {MAQUININHAS.map(prov => {
                const cfg = cards.find(c => c.provider === prov) ?? null;
                const info = CARD_PROVIDERS[prov];
                return (
                  <div key={prov} className={`rounded-xl border ${cfg ? 'border-amber-300 bg-amber-50/40' : 'border-zinc-200'}`}>
                    <label className="flex items-start gap-2 p-3 cursor-pointer">
                      <input type="checkbox" checked={!!cfg} onChange={() => toggleCard(prov)} className="mt-0.5 accent-amber-600" />
                      <span>
                        <span className="block text-sm font-medium text-zinc-800">{info.label}</span>
                        {info.hint && <span className={`block text-xs ${info.conector ? 'text-zinc-500' : 'text-amber-600'}`}>{info.hint}</span>}
                      </span>
                    </label>

                    {cfg && (
                      <div className="px-3 pb-3 space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-zinc-700 mb-1">O repasse desta maquininha cai em</label>
                          <select value={cfg.deposit_account_id ?? ''} onChange={e => setCard(prov, { deposit_account_id: e.target.value || null })} className={selectCls}>
                            {contaOptions}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-700 mb-1">Como o repasse aparece no extrato</label>
                          <input value={cfg.deposit_match ?? ''} onChange={e => setCard(prov, { deposit_match: e.target.value })}
                            placeholder={info.depositMatch || 'ex.: stone'} className={selectCls} />
                          <p className="text-xs text-zinc-400 mt-1">Um trecho da descrição do crédito no extrato — precisa ser diferente do texto das outras maquininhas. O sistema junta esses créditos com as vendas que a maquininha disse que ia pagar, e eles deixam de contar como receita (a receita vem das vendas).</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-zinc-700 mb-1">Pix vendido nesta maquininha</p>
                          <div className="space-y-1.5">
                            {(Object.keys(CARD_PIX_MODES) as CardPixMode[]).map(m => (
                              <label key={m} className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer ${cfg.pix_mode === m ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}>
                                <input type="radio" name={`pixmode-${prov}`} checked={cfg.pix_mode === m} onChange={() => setCard(prov, { pix_mode: m })} className="mt-0.5 accent-amber-600" />
                                <span>
                                  <span className="block text-sm text-zinc-800">{CARD_PIX_MODES[m].label}</span>
                                  <span className="block text-xs text-zinc-500">{CARD_PIX_MODES[m].hint}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                        {prov === 'stone' && (
                          <TaxasContratadasEditor fees={taxas.fees} loaded={taxas.loaded} onChange={taxas.setFees} />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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
              <p><i className="ri-information-line mr-1" />O que conta como receita (pedidos, cartão, Pix, iFood, dinheiro, manuais) continua em <strong>Receitas › Fontes</strong>. As vendas de todas as maquininhas entram juntas na linha "Vendas em cartão".</p>
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
