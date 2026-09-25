import { useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

// Depois de salvar a ficha técnica: aplicar a mudança nas vendas já feitas, desde a data escolhida
// (dono, 2026-09-25). Regras no backend: supabase/functions/_shared/ficha-retroativa.ts.

interface Mudanca { ingredient_id: string; nome: string; unidade: string; diferenca: number; no_saldo: number; na_contagem: number }
interface Resultado { vendas: number; vendas_alteradas: number; insumos: Mudanca[]; aplicado: boolean }

interface Props {
  tenantId: string;
  itemId: string;
  itemNome: string;
  onFechar: () => void;
}

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const inicioMesISO = () => hojeISO().slice(0, 8) + '01';
const un = (u: string) => (u === 'unit' ? 'un' : u);
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const sinal = (n: number) => (n > 0 ? `+${num(n)}` : num(n));

export default function FichaRetroativaModal({ tenantId, itemId, itemNome, onFechar }: Props) {
  const { success: toastOk, error: toastErr } = useToast();
  const [desde, setDesde] = useState(inicioMesISO());
  const [previa, setPrevia] = useState<Resultado | null>(null);
  const [busy, setBusy] = useState(false);

  const chamar = async (aplicar: boolean) => {
    if (!desde || desde > hojeISO()) { toastErr('Data inválida', 'Escolha uma data até hoje.'); return; }
    setBusy(true);
    const { data, error } = await invokeWithAuth<{ data: Resultado }>('menu-write', {
      body: { action: 'reaplicar_ficha', active_tenant_id: tenantId, payload: { item_id: itemId, desde, aplicar } },
    });
    setBusy(false);
    if (error) { toastErr('Não foi possível calcular', error.message); return; }
    const r = data?.data ?? null;
    if (!aplicar) { setPrevia(r); return; }
    toastOk('Vendas corrigidas', `${r?.vendas_alteradas ?? 0} venda(s) de ${itemNome} refeitas com a ficha nova.`);
    onFechar();
  };

  const dataBR = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onFechar}>
      <div className="bg-white w-full md:max-w-xl rounded-t-2xl md:rounded-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-zinc-100 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-zinc-800">Aplicar a ficha nova nas vendas já feitas?</p>
            <p className="text-xs text-zinc-500 mt-0.5 break-words">{itemNome}</p>
          </div>
          <button onClick={onFechar} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-zinc-600">
            A ficha já vale para as próximas vendas. Se quiser, o sistema refaz a baixa dos insumos das vendas desde uma data,
            e o estoque teórico e o consumo desses dias ficam como se a ficha já fosse essa.
            Vendas antes da última contagem de um insumo não mudam o saldo atual: a contagem continua valendo.
          </p>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            Vendas desde
            <input type="date" value={desde} max={hojeISO()} onChange={(e) => { setDesde(e.target.value); setPrevia(null); }}
              className="border border-zinc-200 rounded-lg px-2 py-1 text-sm" />
          </label>

          {previa && (
            previa.vendas_alteradas === 0 ? (
              <p className="text-sm text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2">
                {previa.vendas} venda(s) desde {dataBR(desde)} — nenhuma muda com a ficha nova.
              </p>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                <p className="text-sm text-zinc-800">
                  <b>{previa.vendas_alteradas}</b> de {previa.vendas} venda(s) desde {dataBR(desde)} mudam:
                </p>
                <div className="space-y-1">
                  {previa.insumos.map((m) => (
                    <div key={m.ingredient_id} className="text-xs text-zinc-700 flex flex-wrap gap-x-2">
                      <span className="font-medium">{m.nome}</span>
                      <span>{m.diferenca > 0 ? 'baixa a mais' : 'baixa a menos'}: {sinal(m.diferenca)} {un(m.unidade)}</span>
                      {Math.abs(m.no_saldo) > 0 && <span className="text-zinc-500">· saldo atual {sinal(-m.no_saldo)} {un(m.unidade)}</span>}
                      {Math.abs(m.na_contagem) > 0 && <span className="text-zinc-500">· {num(Math.abs(m.na_contagem))} {un(m.unidade)} antes da contagem (saldo não muda)</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>

        <div className="p-4 border-t border-zinc-100 flex flex-wrap items-center gap-2 justify-end">
          <button disabled={busy} onClick={onFechar} className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 cursor-pointer">
            Só nas próximas vendas
          </button>
          {!previa ? (
            <button disabled={busy} onClick={() => chamar(false)} className="px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer">
              {busy ? 'Calculando…' : 'Ver o efeito'}
            </button>
          ) : previa.vendas_alteradas > 0 ? (
            <button disabled={busy} onClick={() => chamar(true)} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
              {busy ? 'Aplicando…' : `Aplicar desde ${dataBR(desde)}`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
