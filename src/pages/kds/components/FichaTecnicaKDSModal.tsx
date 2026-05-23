import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface FichaRow {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  ingredient_unit: string;
}

const DB_UNIT_MAP: Record<string, string> = {
  g: 'g', kg: 'kg', ml: 'ml', L: 'l', l: 'l', unit: 'un',
};

interface ItemSeletor {
  nome: string;
  quantidade: number;
  menuItemId?: string;
}

interface Props {
  // Modo item único
  nomeItem?: string;
  menuItemId?: string;
  quantidade?: number;
  // Modo múltiplos itens (seletor)
  itens?: ItemSeletor[];
  // Callbacks
  onClose: () => void;
}

interface IngredienteLocal {
  id: string;
  nome: string;
  quantidade: number;
  unidade: string;
  precoUnitario: number;
}

function FichaConteudo({
  menuItemId,
  nomeItem,
  quantidade,
}: {
  menuItemId?: string;
  nomeItem: string;
  quantidade: number;
}) {
  const { user } = useAuth();
  const [ingredientes, setIngredientes] = useState<IngredienteLocal[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) {
      setLoading(false);
      return;
    }
    if (!menuItemId) {
      // Sem ID, tenta buscar por nome na tabela diretamente
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(false);
    try {
      const { data, error } = await supabase.rpc('fn_get_item_ingredients', {
        p_tenant_id: user.tenantId,
        p_item_id: menuItemId,
      });
      if (error) throw error;
      const rows = (data as FichaRow[]) ?? [];
      setIngredientes(
        rows.map((r) => ({
          id: r.id,
          nome: r.ingredient_name,
          quantidade: Number(r.quantity),
          unidade: DB_UNIT_MAP[r.unit] ?? r.unit,
          precoUnitario: Number(r.unit_price),
        })),
      );
    } catch (e) {
      console.error('[FichaTecnicaKDSModal] erro ao carregar:', e);
      setErro(true);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, menuItemId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-zinc-400">
        <i className="ri-loader-4-line animate-spin text-xl" />
        <span className="text-sm">Carregando ficha...</span>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-300 mb-3">
          <i className="ri-error-warning-line text-xl" />
        </div>
        <p className="text-sm font-semibold text-zinc-400">Erro ao carregar ficha</p>
        <button
          onClick={carregar}
          className="mt-3 text-xs text-amber-600 font-semibold hover:underline cursor-pointer"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!menuItemId) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-100 text-zinc-300 mb-3">
          <i className="ri-file-unknow-line text-xl" />
        </div>
        <p className="text-sm font-semibold text-zinc-400">ID do item não disponível</p>
        <p className="text-xs text-zinc-300 mt-1">
          O item &quot;{nomeItem}&quot; não possui referência de cardápio.
        </p>
      </div>
    );
  }

  if (ingredientes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-100 text-zinc-300 mb-3">
          <i className="ri-file-unknow-line text-xl" />
        </div>
        <p className="text-sm font-semibold text-zinc-400">Ficha técnica não cadastrada</p>
        <p className="text-xs text-zinc-300 mt-1">
          Acesse o Cardápio para adicionar os insumos deste item.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
        Ingredientes {quantidade > 1 ? `(× ${quantidade} porções)` : ''}
      </h3>
      <div className="rounded-xl border border-zinc-100 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-zinc-500">Insumo</th>
              <th className="text-right px-3 py-2 font-semibold text-zinc-500">Qtde</th>
              <th className="text-right px-3 py-2 font-semibold text-zinc-500">Un.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {ingredientes.map((ing) => {
              const qtdeTotal = ing.quantidade * quantidade;
              return (
                <tr key={ing.id} className="bg-white hover:bg-zinc-50/50 transition-colors">
                  <td className="px-3 py-2.5">
                    <p className="text-zinc-800 font-medium">{ing.nome}</p>
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-600 tabular-nums">
                    {qtdeTotal % 1 === 0 ? qtdeTotal : qtdeTotal.toFixed(3)}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-400">{ing.unidade}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FichaTecnicaKDSModal({
  nomeItem,
  menuItemId,
  quantidade = 1,
  itens,
  onClose,
}: Props) {
  // Se `itens` for passado, usa o primeiro como selecionado inicialmente
  const listaItens: ItemSeletor[] = itens && itens.length > 0
    ? itens
    : [{ nome: nomeItem ?? '', menuItemId, quantidade }];

  const [selecionadoIdx, setSelecionadoIdx] = useState(0);
  const itemAtual = listaItens[selecionadoIdx];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-amber-500 text-white">
                <i className="ri-clipboard-line text-base" />
              </div>
              <h2 className="font-bold text-zinc-900 text-base">Ficha Técnica</h2>
            </div>
            <p className="text-sm font-semibold text-zinc-700 mt-1">
              {itemAtual.quantidade > 1 && (
                <span className="text-amber-600 font-bold mr-1">{itemAtual.quantidade}x</span>
              )}
              {itemAtual.nome}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 transition-colors cursor-pointer flex-shrink-0 ml-2"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Seletor de item (só aparece quando há múltiplos itens) */}
        {listaItens.length > 1 && (
          <div className="px-5 pt-4 pb-0">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
              Selecionar item
            </p>
            <div className="flex flex-wrap gap-1.5">
              {listaItens.map((it, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelecionadoIdx(idx)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-all whitespace-nowrap ${
                    selecionadoIdx === idx
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-amber-300 hover:text-amber-600'
                  }`}
                >
                  {it.quantidade > 1 && (
                    <span className={`font-black ${selecionadoIdx === idx ? 'text-amber-100' : 'text-amber-500'}`}>
                      {it.quantidade}x
                    </span>
                  )}
                  {it.nome}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conteúdo */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          <FichaConteudo
            key={`${itemAtual.menuItemId}-${selecionadoIdx}`}
            menuItemId={itemAtual.menuItemId}
            nomeItem={itemAtual.nome}
            quantidade={itemAtual.quantidade}
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 text-white text-xs font-bold rounded-lg hover:bg-zinc-900 transition-colors cursor-pointer whitespace-nowrap"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}