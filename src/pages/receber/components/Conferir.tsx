// Passo "Conferir o que chegou": item a item, chegou tudo ou diferente, e em qual insumo entra.
import { useEffect, useState } from 'react';
import InsumoPicker from './InsumoPicker';
import { brl, lerNumeroBR, qtd, un } from '../api';
import { podeMudarQuantidade, type ItemR, type Rascunho } from '../rascunho';

interface Props {
  r: Rascunho;
  onItens: (itens: ItemR[]) => void;
  onContinuar: () => void;
}

export default function Conferir({ r, onItens, onContinuar }: Props) {
  const [picker, setPicker] = useState<string | null>(null);
  const mudaQtd = podeMudarQuantidade(r);
  const nomeIns = (id: string | null) => (id ? r.insumos.find((i) => i.id === id) : undefined);

  const mudar = (key: string, patch: Partial<ItemR>) => onItens(r.itens.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const entram = r.itens.filter((i) => i.ingredient_id && i.recebido > 0).length;
  const diferentes = r.itens.filter((i) => Math.abs(i.recebido - i.quantidade) > 1e-9).length;
  const itemPicker = r.itens.find((i) => i.key === picker);

  return (
    <div className="pb-28">
      <div className="px-4 pt-4">
        <div className="bg-white rounded-3xl border border-zinc-100 p-4">
          <p className="text-lg font-bold text-zinc-900 leading-tight">{r.fornecedor || 'Fornecedor'}</p>
          <p className="text-sm text-zinc-500 mt-0.5">
            {r.origem === 'cupom' ? 'Cupom' : r.numero ? `NF ${r.numero}` : r.origem === 'compra' ? 'Compra lançada' : 'Nota'}
            {' · '}{brl(r.valor)}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-xs font-semibold bg-zinc-100 text-zinc-600 rounded-full px-2.5 py-1">{r.itens.length} itens</span>
            <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-full px-2.5 py-1">{entram} entram no estoque</span>
            {diferentes > 0 && <span className="text-xs font-semibold bg-orange-50 text-orange-700 rounded-full px-2.5 py-1">{diferentes} diferente(s)</span>}
          </div>
        </div>

        {r.semItens && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-sm text-amber-800">
            A nota ainda está sem os itens (o XML não chegou da SEFAZ). Dá para confirmar só pelo total — o estoque não muda. Se preferir, espere alguns minutos e abra de novo.
          </div>
        )}
        {r.estoqueJaAplicado && (
          <div className="mt-3 bg-sky-50 border border-sky-200 rounded-2xl p-3.5 text-sm text-sky-800">
            Compra antiga: o estoque já entrou quando ela foi lançada. Aqui só entram as diferenças.
          </div>
        )}
        {mudaQtd && r.itens.length > 0 && (
          <p className="text-sm text-zinc-500 mt-4 mb-1 px-1">Confira cada item. Se veio a menos (ou a mais), toque em <b>Chegou diferente</b>.</p>
        )}
      </div>

      <div className="px-4 mt-2 space-y-3">
        {r.itens.map((it) => {
          const ins = nomeIns(it.ingredient_id);
          const diferente = Math.abs(it.recebido - it.quantidade) > 1e-9;
          const modoDif = diferente || !!it.marcadoDiferente;
          const setModoDif = (v: boolean) => mudar(it.key, { marcadoDiferente: v, recebido: v ? it.recebido : it.quantidade });
          return (
            <div key={it.key} className={`bg-white rounded-3xl border p-4 ${diferente ? 'border-orange-300' : 'border-zinc-100'}`}>
              <p className="text-[15px] font-semibold text-zinc-800 leading-snug">{it.descricao}</p>
              <p className="text-sm text-zinc-500 mt-0.5">
                {r.origem === 'cupom' || r.origem === 'sem_nota' ? '' : 'Na nota: '}
                {qtd(it.quantidade)} {it.unidade} · {brl(it.valor_total)}
              </p>

              {mudaQtd && (
                <div className="mt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setModoDif(false)}
                      className={`py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${!modoDif ? 'bg-emerald-500 text-white' : 'bg-zinc-100 text-zinc-600'}`}
                    >
                      <i className="ri-check-line" /> Chegou tudo
                    </button>
                    <button
                      onClick={() => setModoDif(true)}
                      className={`py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${modoDif ? 'bg-orange-500 text-white' : 'bg-zinc-100 text-zinc-600'}`}
                    >
                      <i className="ri-error-warning-line" /> Chegou diferente
                    </button>
                  </div>
                  {modoDif && (
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-sm text-zinc-600">Chegou</span>
                      <button
                        onClick={() => mudar(it.key, { recebido: Math.max(0, +(it.recebido - 1).toFixed(3)), marcadoDiferente: true })}
                        className="w-11 h-11 rounded-2xl bg-zinc-100 text-xl font-bold text-zinc-600 cursor-pointer" aria-label="Menos"
                      >−</button>
                      <CampoQtd valor={it.recebido} onValor={(n) => mudar(it.key, { recebido: n, marcadoDiferente: true })} />
                      <button
                        onClick={() => mudar(it.key, { recebido: +(it.recebido + 1).toFixed(3), marcadoDiferente: true })}
                        className="w-11 h-11 rounded-2xl bg-zinc-100 text-xl font-bold text-zinc-600 cursor-pointer" aria-label="Mais"
                      >+</button>
                      <span className="text-sm text-zinc-500">{it.unidade}</span>
                    </div>
                  )}
                  {modoDif && it.recebido === 0 && <p className="text-xs text-orange-600 mt-2">Zero = esse item não veio.</p>}
                </div>
              )}

              <button
                onClick={() => setPicker(it.key)}
                className={`mt-3 w-full text-left rounded-2xl px-3.5 py-3 flex items-center gap-3 cursor-pointer ${ins ? 'bg-emerald-50' : 'bg-zinc-50 border border-dashed border-zinc-300'}`}
              >
                <i className={`${ins ? 'ri-archive-2-line text-emerald-600' : 'ri-link-unlink text-zinc-400'} text-lg`} />
                <div className="min-w-0 flex-1">
                  {ins ? (
                    <>
                      <p className="text-sm font-semibold text-emerald-800 truncate">{ins.nome}</p>
                      <p className="text-xs text-emerald-700">
                        +{qtd(it.recebido * (it.units_per_package || 1))} {un(ins.unidade)} no estoque
                        {it.units_per_package !== 1 ? ` (1 ${it.unidade} = ${qtd(it.units_per_package)} ${un(ins.unidade)})` : ''}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-zinc-600">Não entra no estoque</p>
                      <p className="text-xs text-zinc-400">Toque para ligar a um insumo</p>
                    </>
                  )}
                </div>
                <i className="ri-arrow-right-s-line text-zinc-400" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-zinc-100 px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <button onClick={onContinuar} className="w-full py-4 rounded-2xl bg-amber-500 active:bg-amber-600 text-white text-base font-bold cursor-pointer">
          Continuar
        </button>
      </div>

      {itemPicker && (
        <InsumoPicker
          insumos={r.insumos}
          titulo={itemPicker.descricao}
          unidadeItem={itemPicker.unidade}
          atual={{ ingredient_id: itemPicker.ingredient_id, units_per_package: itemPicker.units_per_package }}
          onEscolher={(v) => { mudar(itemPicker.key, { ...v, fatorManual: true }); setPicker(null); }}
          onFechar={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** Campo numérico com vírgula: guarda o texto enquanto digita ("2," não vira "2"). */
function CampoQtd({ valor, onValor }: { valor: number; onValor: (n: number) => void }) {
  const [txt, setTxt] = useState(String(valor).replace('.', ','));
  useEffect(() => {
    const atual = lerNumeroBR(txt);
    if (atual !== valor) setTxt(String(valor).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return (
    <input
      inputMode="decimal"
      value={txt}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9,.]/g, '');
        setTxt(t);
        const n = lerNumeroBR(t);
        if (t !== '' && Number.isFinite(n) && n >= 0) onValor(n);
      }}
      onFocus={(e) => e.target.select()}
      className="w-20 text-center text-lg font-bold border-2 border-orange-300 rounded-2xl py-2 outline-none"
    />
  );
}
