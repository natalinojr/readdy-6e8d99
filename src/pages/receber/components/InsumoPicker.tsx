// Folha de baixo (tela cheia no celular) para escolher em qual insumo do estoque o item entra
// e quanto 1 unidade da nota vale na unidade do insumo (ex.: 1 CX = 12 kg).
import { useMemo, useState } from 'react';
import { lerNumeroBR, normalizar, un, type Insumo } from '../api';

interface Props {
  insumos: Insumo[];
  titulo: string;
  /** Unidade do item na nota/cupom (CX, FD, UN...). Sem ela, não pergunta a conversão. */
  unidadeItem?: string | null;
  atual: { ingredient_id: string | null; units_per_package: number };
  /** Permite "não entra no estoque" (nota/cupom). No "sem nota" o item livre é outro botão. */
  permitirSemInsumo?: boolean;
  onEscolher: (v: { ingredient_id: string | null; units_per_package: number }) => void;
  onFechar: () => void;
}

export default function InsumoPicker({ insumos, titulo, unidadeItem, atual, permitirSemInsumo = true, onEscolher, onFechar }: Props) {
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<Insumo | null>(() => insumos.find((i) => i.id === atual.ingredient_id) ?? null);
  const [fator, setFator] = useState(String(atual.units_per_package || 1).replace('.', ','));
  const [passo, setPasso] = useState<'lista' | 'fator'>('lista');

  const lista = useMemo(() => {
    const q = normalizar(busca);
    const base = q ? insumos.filter((i) => normalizar(i.nome).includes(q)) : insumos;
    return base.slice(0, 80);
  }, [busca, insumos]);

  const pedirFator = !!unidadeItem;

  const escolher = (i: Insumo) => {
    setEscolhido(i);
    if (!pedirFator) { onEscolher({ ingredient_id: i.id, units_per_package: 1 }); return; }
    if (i.id !== atual.ingredient_id) setFator('1');
    setPasso('fator');
  };

  const salvarFator = () => {
    const n = lerNumeroBR(fator);
    if (!escolhido || !(n > 0)) return;
    onEscolher({ ingredient_id: escolhido.id, units_per_package: n });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onFechar}>
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92vh]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-zinc-100">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">Entra no estoque como</p>
            <p className="text-sm font-semibold text-zinc-800 truncate">{titulo}</p>
          </div>
          <button onClick={onFechar} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer" aria-label="Fechar">
            <i className="ri-close-line text-xl text-zinc-500" />
          </button>
        </div>

        {passo === 'lista' ? (
          <>
            <div className="px-5 py-3">
              <div className="flex items-center gap-2 bg-zinc-100 rounded-2xl px-4">
                <i className="ri-search-line text-zinc-400" />
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar insumo"
                  className="flex-1 bg-transparent py-3 text-base outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3">
              {permitirSemInsumo && (
                <button
                  onClick={() => onEscolher({ ingredient_id: null, units_per_package: 1 })}
                  className={`w-full text-left px-4 py-3.5 rounded-2xl mb-1 flex items-center gap-3 cursor-pointer ${!atual.ingredient_id ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}
                >
                  <i className="ri-forbid-line text-zinc-400 text-lg" />
                  <span className="text-sm text-zinc-600">Não entra no estoque</span>
                </button>
              )}
              {lista.map((i) => (
                <button
                  key={i.id}
                  onClick={() => escolher(i)}
                  className={`w-full text-left px-4 py-3.5 rounded-2xl flex items-center gap-3 cursor-pointer ${i.id === atual.ingredient_id ? 'bg-amber-50' : 'hover:bg-zinc-50'}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-800 truncate">{i.nome}</p>
                    {i.categoria && <p className="text-xs text-zinc-400 truncate">{i.categoria}</p>}
                  </div>
                  <span className="text-xs text-zinc-400">{un(i.unidade)}</span>
                  {i.id === atual.ingredient_id && <i className="ri-check-line text-amber-600" />}
                </button>
              ))}
              {lista.length === 0 && <p className="text-center text-sm text-zinc-400 py-8">Nenhum insumo com esse nome.</p>}
            </div>
          </>
        ) : (
          <div className="px-5 py-5 space-y-5">
            <div>
              <p className="text-sm text-zinc-500">Insumo</p>
              <p className="text-lg font-semibold text-zinc-800">{escolhido?.nome}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-700">
                Quanto vem em 1 {unidadeItem} ?
              </label>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-base text-zinc-500 whitespace-nowrap">1 {unidadeItem} =</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={fator}
                  onChange={(e) => setFator(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className="w-28 text-center text-lg font-semibold border-2 border-zinc-200 focus:border-amber-400 rounded-2xl py-2.5 outline-none"
                />
                <span className="text-base text-zinc-700 font-medium">{un(escolhido?.unidade)}</span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">Se a nota já vem na mesma unidade do estoque, deixe 1.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPasso('lista')} className="flex-1 py-3.5 rounded-2xl border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer">
                Voltar
              </button>
              <button onClick={salvarFator} className="flex-[2] py-3.5 rounded-2xl bg-amber-500 text-white text-sm font-bold cursor-pointer">
                Usar este insumo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
