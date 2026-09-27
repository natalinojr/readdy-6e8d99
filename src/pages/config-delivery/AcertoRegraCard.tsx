// Regra do acerto dos entregadores (delivery_config.acerto_motoboy).
// O valor de cada entrega é calculado e congelado pelo banco na hora em que o pedido vira "Entregue"
// (gatilho trg_delivery_driver_ledger) — mudar a regra aqui só vale para as próximas entregas.

import { type AcertoCfg, type ModoAcerto } from './acertoCfg';

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0; };

const MODOS: { key: ModoAcerto; label: string; dica: string }[] = [
  { key: 'por_entrega', label: 'Valor fixo por entrega', dica: 'Cada entrega paga o mesmo valor.' },
  { key: 'faixa_km', label: 'Por faixa de km', dica: 'O valor depende da distância da loja até o cliente.' },
  { key: 'diaria_mais_entrega', label: 'Diária + por entrega', dica: 'Uma diária por dia trabalhado, mais um valor por entrega.' },
  { key: 'percentual_taxa', label: '% da taxa de entrega', dica: 'O motoboy fica com parte da taxa cobrada do cliente.' },
];

function CampoValor({ label, value, onChange, sufixo }: { label: string; value: number; onChange: (n: number) => void; sufixo?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-zinc-500 uppercase">{label}</span>
      <div className="mt-1 flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-2 focus-within:border-amber-400">
        {sufixo ? null : <span className="text-xs text-zinc-400">R$</span>}
        <input type="number" min={0} step="0.01" inputMode="decimal" value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(num(e.target.value))} className="w-full text-sm outline-none bg-transparent" />
        {sufixo ? <span className="text-xs text-zinc-400">{sufixo}</span> : null}
      </div>
    </label>
  );
}

export default function AcertoRegraCard({ value, onChange }: { value: AcertoCfg; onChange: (c: AcertoCfg) => void }) {
  const set = (p: Partial<AcertoCfg>) => onChange({ ...value, ...p });
  const setFaixa = (i: number, p: Partial<{ ate_km: number; valor: number }>) =>
    set({ faixas: value.faixas.map((f, j) => (j === i ? { ...f, ...p } : f)) });

  return (
    <div className="bg-white rounded-2xl border border-zinc-100 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center bg-emerald-50 rounded-lg">
            <i className="ri-hand-coin-line text-emerald-600 text-sm" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-800">Pagamento dos entregadores</h3>
            <p className="text-xs text-zinc-500">Quanto cada motoboy ganha por entrega. O acerto é feito em Financeiro › Entregadores.</p>
          </div>
        </div>
        <button type="button" onClick={() => set({ ativo: !value.ativo })} aria-pressed={value.ativo}
          className={'relative shrink-0 w-11 h-6 rounded-full transition-colors ' + (value.ativo ? 'bg-emerald-500' : 'bg-zinc-300')}>
          <span className={'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ' + (value.ativo ? 'left-[22px]' : 'left-0.5')} />
        </button>
      </div>

      {value.ativo ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MODOS.map((m) => (
              <button key={m.key} type="button" onClick={() => set({ modo: m.key })}
                className={'text-left rounded-xl border px-3 py-2 transition-colors ' +
                  (value.modo === m.key ? 'border-emerald-400 bg-emerald-50' : 'border-zinc-200 hover:bg-zinc-50')}>
                <p className="text-xs font-bold text-zinc-800">{m.label}</p>
                <p className="text-[11px] text-zinc-500">{m.dica}</p>
              </button>
            ))}
          </div>

          {value.modo === 'por_entrega' ? (
            <CampoValor label="Valor por entrega" value={value.valor_entrega} onChange={(n) => set({ valor_entrega: n })} />
          ) : null}

          {value.modo === 'diaria_mais_entrega' ? (
            <div className="grid grid-cols-2 gap-3">
              <CampoValor label="Diária" value={value.diaria} onChange={(n) => set({ diaria: n })} />
              <CampoValor label="Valor por entrega" value={value.valor_entrega} onChange={(n) => set({ valor_entrega: n })} />
            </div>
          ) : null}

          {value.modo === 'percentual_taxa' ? (
            <CampoValor label="Porcentagem da taxa de entrega" value={value.percentual} onChange={(n) => set({ percentual: Math.min(100, n) })} sufixo="%" />
          ) : null}

          {value.modo === 'faixa_km' ? (
            <div className="space-y-2">
              {value.faixas.map((f, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1"><CampoValor label="Até (km)" value={f.ate_km} onChange={(n) => setFaixa(i, { ate_km: n })} sufixo="km" /></div>
                  <div className="flex-1"><CampoValor label="Paga" value={f.valor} onChange={(n) => setFaixa(i, { valor: n })} /></div>
                  <button type="button" onClick={() => set({ faixas: value.faixas.filter((_, j) => j !== i) })}
                    className="mb-1 w-9 h-9 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50" aria-label="Remover faixa">
                    <i className="ri-delete-bin-line" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => set({ faixas: [...value.faixas, { ate_km: 0, valor: 0 }] })}
                className="text-xs font-bold text-emerald-700">+ Adicionar faixa</button>
              <CampoValor label="Sem distância registrada, pagar" value={value.valor_entrega} onChange={(n) => set({ valor_entrega: n })} />
              <p className="text-[11px] text-zinc-400">Acima da última faixa vale o valor da maior faixa. A distância é a da rota loja → cliente calculada no pedido.</p>
            </div>
          ) : null}

          <p className="text-[11px] text-zinc-500 bg-zinc-50 rounded-xl px-3 py-2">
            O valor fica gravado no momento em que o pedido é entregue: mudar a regra vale só para as próximas entregas.
            Pedido cancelado depois de entregue é descontado.
          </p>
        </>
      ) : (
        <p className="text-xs text-zinc-400">Desligado: as entregas não geram valor para o acerto.</p>
      )}
    </div>
  );
}
