// Regra do acerto dos entregadores (delivery_config.acerto_motoboy).
// O valor de cada entrega é calculado e congelado pelo banco na hora em que o pedido vira "Entregue"
// (gatilho trg_delivery_driver_ledger) — mudar a regra aqui só vale para as próximas entregas.
// Visual novo da tela Delivery (2026-10-05): interruptor, "Como paga?" em chips e a regra escrita em frase,
// com o valor dentro da frase (campo que aceita vírgula, como "6,50").

import { MODOS_FAIXA_KM, type AcertoCfg, type ModoAcerto } from './acertoCfg';
import { Cartao, CampoNumero, LinhaInterruptor, Nota } from './ui';

const MODOS: { key: ModoAcerto; label: string; dica: string }[] = [
  { key: 'por_entrega', label: 'Valor fixo por entrega', dica: 'Cada entrega paga o mesmo valor.' },
  { key: 'faixa_km', label: 'Por faixa de km', dica: 'O valor depende da distância da loja até o cliente.' },
  { key: 'diaria_mais_entrega', label: 'Diária + por entrega', dica: 'Uma diária por dia trabalhado, mais um valor por entrega.' },
  { key: 'diaria_mais_faixa_km', label: 'Diária + por faixa de km', dica: 'Uma diária por dia trabalhado, mais um valor por entrega que depende da distância.' },
  { key: 'percentual_taxa', label: '% da taxa', dica: 'O entregador fica com parte da taxa cobrada do cliente.' },
];

export default function AcertoRegraCard({ value, onChange }: { value: AcertoCfg; onChange: (c: AcertoCfg) => void }) {
  const set = (p: Partial<AcertoCfg>) => onChange({ ...value, ...p });
  const setFaixa = (i: number, p: Partial<{ ate_km: number; valor: number }>) =>
    set({ faixas: value.faixas.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const modo = MODOS.find((m) => m.key === value.modo) ?? MODOS[0];

  return (
    <div className="space-y-3">
      <Cartao>
        <LinhaInterruptor
          titulo="Calcular o acerto"
          texto={value.ativo ? 'Cada entrega entregue vira um valor a pagar ao entregador.' : 'Hoje está desligado: nenhuma entrega gera valor.'}
          ligado={value.ativo}
          onChange={(v) => set({ ativo: v })}
        />
      </Cartao>

      {value.ativo && (
        <>
          <div>
            <p className="text-[13px] font-extrabold text-zinc-900 mb-1.5">Como paga?</p>
            <div className="flex flex-wrap gap-1.5">
              {MODOS.map((m) => {
                const ativo = m.key === value.modo;
                return (
                  <button key={m.key} type="button" onClick={() => set({ modo: m.key })} aria-pressed={ativo}
                    className={`inline-flex items-center h-8 px-3 rounded-full border text-[12.5px] font-bold cursor-pointer whitespace-nowrap ${
                      ativo ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`}>
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">{modo.dica}</p>
          </div>

          <Cartao>
            {value.modo === 'por_entrega' && (
              <p className="text-[14px] leading-[2.4] text-zinc-700">
                Cada entrega paga{' '}
                <CampoNumero prefixo="R$" valor={value.valor_entrega} onChange={(n) => set({ valor_entrega: n })} rotulo="Valor por entrega" placeholder="0,00" />
                {' '}ao entregador.
              </p>
            )}

            {value.modo === 'diaria_mais_entrega' && (
              <p className="text-[14px] leading-[2.4] text-zinc-700">
                Cada dia trabalhado paga{' '}
                <CampoNumero prefixo="R$" valor={value.diaria} onChange={(n) => set({ diaria: n })} rotulo="Diária" placeholder="0,00" />
                {' '}e cada entrega paga mais{' '}
                <CampoNumero prefixo="R$" valor={value.valor_entrega} onChange={(n) => set({ valor_entrega: n })} rotulo="Valor por entrega" placeholder="0,00" />
                .
              </p>
            )}

            {value.modo === 'diaria_mais_faixa_km' && (
              <p className="text-[14px] leading-[2.4] text-zinc-700 border-b border-zinc-100 pb-2 mb-2.5">
                Cada dia trabalhado paga{' '}
                <CampoNumero prefixo="R$" valor={value.diaria} onChange={(n) => set({ diaria: n })} rotulo="Diária" placeholder="0,00" />
                {' '}e cada entrega paga mais, conforme a distância:
              </p>
            )}

            {value.modo === 'percentual_taxa' && (
              <p className="text-[14px] leading-[2.4] text-zinc-700">
                O entregador fica com{' '}
                <CampoNumero sufixo="%" casas={1} largura="w-12" valor={value.percentual}
                  onChange={(n) => set({ percentual: Math.min(100, n) })} rotulo="Porcentagem da taxa de entrega" placeholder="0" />
                {' '}da taxa que o cliente paga.
              </p>
            )}

            {MODOS_FAIXA_KM.includes(value.modo) && (
              <div className="space-y-2.5">
                {value.faixas.length === 0 && (
                  <p className="text-[13px] text-zinc-500">Nenhuma faixa ainda. Toque em &quot;Adicionar faixa&quot; para dizer quanto paga até cada distância.</p>
                )}
                {value.faixas.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 flex-wrap text-[14px] text-zinc-700">
                    <span>Até</span>
                    <CampoNumero sufixo="km" casas={1} largura="w-11" valor={f.ate_km}
                      onChange={(n) => setFaixa(i, { ate_km: n })} rotulo={`Faixa ${i + 1}: até quantos km`} placeholder="0" />
                    <span>paga</span>
                    <CampoNumero prefixo="R$" largura="w-14" valor={f.valor}
                      onChange={(n) => setFaixa(i, { valor: n })} rotulo={`Faixa ${i + 1}: quanto paga`} placeholder="0,00" />
                    <button type="button" onClick={() => set({ faixas: value.faixas.filter((_, j) => j !== i) })}
                      className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 cursor-pointer"
                      aria-label={`Tirar a faixa ${i + 1}`} title="Tirar esta faixa">
                      <i className="ri-delete-bin-line" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => set({ faixas: [...value.faixas, { ate_km: 0, valor: 0 }] })}
                  className="inline-flex items-center gap-1 min-h-[34px] px-3 rounded-xl text-[12.5px] font-bold text-amber-700 hover:bg-amber-50 cursor-pointer">
                  <i className="ri-add-line" />Adicionar faixa
                </button>
                <p className="text-[14px] leading-[2.4] text-zinc-700 border-t border-zinc-100 pt-2">
                  Se o pedido ficar sem distância registrada, paga{' '}
                  <CampoNumero prefixo="R$" valor={value.valor_entrega} onChange={(n) => set({ valor_entrega: n })} rotulo="Valor quando não há distância registrada" placeholder="0,00" />
                  .
                </p>
                <p className="text-[11.5px] text-zinc-500 leading-snug">
                  Acima da última faixa vale o valor da maior faixa. A distância é a da rota loja → cliente, calculada no pedido.
                </p>
              </div>
            )}
          </Cartao>

          <Nota>
            Mudar a regra vale só para as próximas entregas. Pedido cancelado depois de entregue é descontado.
          </Nota>
        </>
      )}
    </div>
  );
}
