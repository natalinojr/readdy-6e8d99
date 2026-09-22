// Entrega sem nota: fornecedor + o que chegou (insumo, quantidade na unidade do estoque e valor).
import { useMemo, useState } from 'react';
import InsumoPicker from './InsumoPicker';
import { brl, lerNumeroBR, normalizar, un } from '../api';
import type { ItemR, Rascunho } from '../rascunho';

interface Props {
  r: Rascunho;
  fornecedores: { id: string; nome: string }[];
  onMudar: (patch: Partial<Rascunho>) => void;
  onContinuar: () => void;
}

const num = lerNumeroBR;

export function semNotaValido(r: Rascunho): string | null {
  if (!r.fornecedor.trim()) return 'Informe o fornecedor';
  if (!r.itens.length) return 'Adicione o que chegou';
  for (const it of r.itens) {
    if (!it.descricao.trim()) return 'Dê um nome ao item';
    if (!(it.quantidade > 0)) return `Quantidade de "${it.descricao}"`;
    if (r.pagamento !== 'bonificacao' && !(it.valor_total > 0)) return `Valor de "${it.descricao}"`;
  }
  return null;
}

export default function SemNota({ r, fornecedores, onMudar, onContinuar }: Props) {
  const [picker, setPicker] = useState(false);
  const [focoForn, setFocoForn] = useState(false);
  const [txt, setTxt] = useState<Record<string, { q: string; v: string }>>({});

  const sugestoes = useMemo(() => {
    const q = normalizar(r.fornecedor);
    if (!q) return fornecedores.slice(0, 8);
    return fornecedores.filter((f) => normalizar(f.nome).includes(q)).slice(0, 8);
  }, [r.fornecedor, fornecedores]);

  const mudarItem = (key: string, patch: Partial<ItemR>) => onMudar({ itens: r.itens.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const tirar = (key: string) => onMudar({ itens: r.itens.filter((i) => i.key !== key) });
  const novoItem = (ingredient_id: string | null) => {
    const ins = r.insumos.find((i) => i.id === ingredient_id);
    const it: ItemR = {
      key: Math.random().toString(36).slice(2, 10), descricao: ins?.nome ?? '', unidade: ins ? un(ins.unidade) : 'un',
      quantidade: 0, valor_total: 0, recebido: 0, ingredient_id, units_per_package: 1, fonte: null,
    };
    onMudar({ itens: [...r.itens, it] });
    setPicker(false);
  };
  const total = r.itens.reduce((t, i) => t + (i.valor_total || 0), 0);
  const falta = semNotaValido({ ...r, pagamento: null });

  return (
    <div className="pb-28 px-4 pt-4 space-y-4">
      <div className="relative">
        <label className="text-sm font-semibold text-zinc-700 px-1">Fornecedor</label>
        <input
          value={r.fornecedor}
          onChange={(e) => onMudar({ fornecedor: e.target.value })}
          onFocus={() => setFocoForn(true)}
          onBlur={() => setTimeout(() => setFocoForn(false), 150)}
          placeholder="Quem entregou?"
          className="mt-1.5 w-full bg-white border-2 border-zinc-100 focus:border-amber-400 rounded-2xl px-4 py-3.5 text-base outline-none"
        />
        {focoForn && sugestoes.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-zinc-100 rounded-2xl shadow-lg overflow-hidden">
            {sugestoes.map((f) => (
              <button key={f.id} onMouseDown={() => onMudar({ fornecedor: f.nome })} className="w-full text-left px-4 py-3 text-sm hover:bg-zinc-50 cursor-pointer">
                {f.nome}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-zinc-700 px-1 mb-1.5">O que chegou</p>
        <div className="space-y-3">
          {r.itens.map((it) => {
            const t = txt[it.key] ?? { q: it.quantidade ? String(it.quantidade).replace('.', ',') : '', v: it.valor_total ? String(it.valor_total).replace('.', ',') : '' };
            const setT = (p: Partial<{ q: string; v: string }>) => setTxt((m) => ({ ...m, [it.key]: { ...t, ...p } }));
            return (
              <div key={it.key} className="bg-white rounded-3xl border border-zinc-100 p-4">
                <div className="flex items-start gap-2">
                  {it.ingredient_id ? (
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-zinc-800 truncate">{it.descricao}</p>
                      <p className="text-xs text-emerald-700">Entra no estoque</p>
                    </div>
                  ) : (
                    <input
                      value={it.descricao}
                      onChange={(e) => mudarItem(it.key, { descricao: e.target.value })}
                      placeholder="Nome do item"
                      className="flex-1 border-b border-zinc-200 focus:border-amber-400 py-1.5 text-[15px] outline-none"
                    />
                  )}
                  <button onClick={() => tirar(it.key)} className="w-9 h-9 rounded-full hover:bg-red-50 flex items-center justify-center cursor-pointer" aria-label="Tirar item">
                    <i className="ri-delete-bin-line text-zinc-400" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <p className="text-xs text-zinc-500 mb-1">Quantidade ({it.unidade})</p>
                    <input
                      inputMode="decimal"
                      value={t.q}
                      onChange={(e) => { const v = e.target.value.replace(/[^0-9,.]/g, ''); setT({ q: v }); const n = num(v); mudarItem(it.key, { quantidade: n > 0 ? n : 0, recebido: n > 0 ? n : 0 }); }}
                      className="w-full border-2 border-zinc-100 focus:border-amber-400 rounded-xl px-3 py-2.5 text-base font-semibold outline-none"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 mb-1">Valor total (R$)</p>
                    <input
                      inputMode="decimal"
                      value={t.v}
                      onChange={(e) => { const v = e.target.value.replace(/[^0-9,.]/g, ''); setT({ v }); const n = num(v); mudarItem(it.key, { valor_total: n > 0 ? Math.round(n * 100) / 100 : 0 }); }}
                      className="w-full border-2 border-zinc-100 focus:border-amber-400 rounded-xl px-3 py-2.5 text-base font-semibold outline-none"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button onClick={() => setPicker(true)} className="py-3.5 rounded-2xl border-2 border-dashed border-amber-300 text-amber-700 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer">
            <i className="ri-add-line" /> Insumo do estoque
          </button>
          <button onClick={() => novoItem(null)} className="py-3.5 rounded-2xl border-2 border-dashed border-zinc-200 text-zinc-500 text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
            <i className="ri-add-line" /> Outro item
          </button>
        </div>
        {r.itens.length > 0 && <p className="text-right text-sm text-zinc-500 mt-3 px-1">Total: <b className="text-zinc-800">{brl(total)}</b></p>}
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-zinc-100 px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <button
          onClick={() => { onMudar({ valor: total }); onContinuar(); }}
          disabled={!!falta}
          className="w-full py-4 rounded-2xl bg-amber-500 active:bg-amber-600 disabled:bg-zinc-200 disabled:text-zinc-400 text-white text-base font-bold cursor-pointer"
        >
          {falta ?? 'Continuar'}
        </button>
      </div>

      {picker && (
        <InsumoPicker
          insumos={r.insumos}
          titulo="Adicionar insumo"
          atual={{ ingredient_id: null, units_per_package: 1 }}
          permitirSemInsumo={false}
          onEscolher={(v) => novoItem(v.ingredient_id)}
          onFechar={() => setPicker(false)}
        />
      )}
    </div>
  );
}
