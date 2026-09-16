import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';

// Taxas contratadas da maquininha (fin_card_fee_contracts), editadas em "Como o dinheiro entra".
// Leitura e gravação pela edge conciliacao-pagamentos (card_fees_list / card_fees_save — a tabela
// inteira é substituída). A conferência com o que a Stone cobrou é fn_card_fee_check.

export type ProdutoCartao = 'debito' | 'credito_vista' | 'credito_2_6' | 'credito_7_12';

export const PRODUTOS_CARTAO: Record<ProdutoCartao, string> = {
  debito: 'Débito',
  credito_vista: 'Crédito à vista',
  credito_2_6: 'Crédito parcelado 2 a 6x',
  credito_7_12: 'Crédito parcelado 7 a 12x',
};

export interface TaxaContratada {
  key: string;
  produto: ProdutoCartao;
  bandeira: string;
  mdr_pct: string;
  antecipacao_pct_mes: string;
  vigente_desde: string;
}

const novaChave = () => Math.random().toString(36).slice(2);
const pctTxt = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)).replace('.', ','));
const pctNum = (v: string) => Number(v.replace(',', '.'));

export function useTaxasContratadas(provider: string | null | undefined) {
  const { user } = useAuth();
  const [fees, setFeesState] = useState<TaxaContratada[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setFeesState([]); setLoaded(false); setDirty(false);
    if (!user?.tenantId || provider !== 'stone') return;
    let vivo = true;
    invokeWithAuth<{ fees?: Array<Record<string, unknown>> }>('conciliacao-pagamentos', {
      body: { action: 'card_fees_list', tenant_id: user.tenantId, provider },
    }).then((r) => {
      if (!vivo) return;
      setFeesState((r.data?.fees ?? []).map((f) => ({
        key: String(f.id ?? novaChave()),
        produto: String(f.produto) as ProdutoCartao,
        bandeira: String(f.bandeira ?? ''),
        mdr_pct: pctTxt(f.mdr_pct),
        antecipacao_pct_mes: pctTxt(f.antecipacao_pct_mes),
        vigente_desde: String(f.vigente_desde ?? '').slice(0, 10),
      })));
      setLoaded(true);
    });
    return () => { vivo = false; };
  }, [user?.tenantId, provider]);

  const setFees = (next: TaxaContratada[]) => { setFeesState(next); setDirty(true); };

  /** Valida e grava. Devolve a mensagem de erro, ou null. */
  const save = useCallback(async (): Promise<string | null> => {
    if (!dirty || provider !== 'stone') return null;
    for (const [i, f] of fees.entries()) {
      const n = i + 1;
      const mdr = pctNum(f.mdr_pct);
      if (f.mdr_pct.trim() === '' || !Number.isFinite(mdr) || mdr < 0 || mdr >= 100) return `Taxa ${n}: informe a taxa em %.`;
      if (f.antecipacao_pct_mes.trim() !== '' && !Number.isFinite(pctNum(f.antecipacao_pct_mes))) return `Taxa ${n}: antecipação inválida.`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.vigente_desde)) return `Taxa ${n}: informe "vale a partir de".`;
    }
    const r = await invokeWithAuth<{ success?: boolean; error?: string }>('conciliacao-pagamentos', {
      body: {
        action: 'card_fees_save', tenant_id: user?.tenantId, provider,
        fees: fees.map((f) => ({
          produto: f.produto, bandeira: f.bandeira.trim() || null, mdr_pct: pctNum(f.mdr_pct),
          antecipacao_pct_mes: f.produto === 'debito' || f.antecipacao_pct_mes.trim() === '' ? null : pctNum(f.antecipacao_pct_mes),
          vigente_desde: f.vigente_desde,
        })),
      },
    });
    const err = r.data?.error ?? r.error?.message ?? null;
    if (!err) setDirty(false);
    return err;
  }, [dirty, fees, provider, user?.tenantId]);

  return { fees, setFees, loaded, dirty, save };
}

const inputCls = 'w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white';

interface EditorProps {
  fees: TaxaContratada[];
  loaded: boolean;
  onChange: (fees: TaxaContratada[]) => void;
}

export function TaxasContratadasEditor({ fees, loaded, onChange }: EditorProps) {
  const atualiza = (key: string, patch: Partial<TaxaContratada>) =>
    onChange(fees.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const adiciona = () => {
    const ultima = fees[fees.length - 1];
    onChange([...fees, {
      key: novaChave(), produto: 'debito', bandeira: '', mdr_pct: '',
      antecipacao_pct_mes: ultima?.antecipacao_pct_mes ?? '', vigente_desde: ultima?.vigente_desde ?? '',
    }]);
  };

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-zinc-700">Taxas contratadas</p>
        <p className="text-xs text-zinc-400">
          O sistema compara com o que a Stone cobrou em cada venda e avisa quando cobrar a mais. Renegociou? Adicione as taxas novas
          com a data em que passaram a valer, sem apagar as antigas.
        </p>
      </div>

      {!loaded ? (
        <div className="flex justify-center py-3"><div className="w-4 h-4 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" /></div>
      ) : (
        <>
          {fees.length === 0 && (
            <p className="text-xs text-zinc-500 bg-zinc-50 border border-dashed border-zinc-200 rounded-lg px-3 py-2">
              Nenhuma taxa cadastrada. Pegue a tabela no contrato ou no app da Stone (Taxas).
            </p>
          )}
          {fees.map((f) => (
            <div key={f.key} className="border border-zinc-200 rounded-xl p-2.5 space-y-2 bg-zinc-50/50">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-0.5">Produto</label>
                  <select value={f.produto} onChange={(e) => atualiza(f.key, { produto: e.target.value as ProdutoCartao })} className={inputCls}>
                    {(Object.keys(PRODUTOS_CARTAO) as ProdutoCartao[]).map((p) => <option key={p} value={p}>{PRODUTOS_CARTAO[p]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-0.5">Bandeira</label>
                  <input value={f.bandeira} onChange={(e) => atualiza(f.key, { bandeira: e.target.value })} placeholder="Todas" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-2 items-end">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-0.5">Taxa (%)</label>
                  <input value={f.mdr_pct} onChange={(e) => atualiza(f.key, { mdr_pct: e.target.value })} inputMode="decimal" placeholder="ex.: 1,92" className={inputCls} />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-0.5">Antecip. (% a.m.)</label>
                  <input value={f.produto === 'debito' ? '' : f.antecipacao_pct_mes} disabled={f.produto === 'debito'}
                    onChange={(e) => atualiza(f.key, { antecipacao_pct_mes: e.target.value })} inputMode="decimal"
                    placeholder={f.produto === 'debito' ? '—' : 'ex.: 1,62'} className={`${inputCls} disabled:bg-zinc-100`} />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-0.5">Vale a partir de</label>
                  <input type="date" value={f.vigente_desde} onChange={(e) => atualiza(f.key, { vigente_desde: e.target.value })} className={inputCls} />
                </div>
                <button onClick={() => onChange(fees.filter((x) => x.key !== f.key))} title="Remover"
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer">
                  <i className="ri-delete-bin-line" />
                </button>
              </div>
            </div>
          ))}
          <button onClick={adiciona} className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 cursor-pointer">
            <i className="ri-add-line" /> Adicionar taxa
          </button>
        </>
      )}
    </div>
  );
}
