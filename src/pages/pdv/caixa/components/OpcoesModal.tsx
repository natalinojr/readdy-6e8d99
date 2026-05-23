import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Item, GrupoOpcoes } from '@/types/cardapio';
import type { OpcaoSelecionada, CarrinhoItem } from '../../../../contexts/PDVContext';
import { useCardapio } from '@/contexts/CardapioContext';
import { useObsParaItem } from '@/hooks/useObsParaItem';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useProducao } from '@/contexts/ProducaoContext';

interface Props {
  item: Item;
  initialSelecionadas?: OpcaoSelecionada[];
  initialObsIndex?: number[];
  initialObsLivre?: string;
  initialQuantidade?: number;
  initialObsUnidades?: string[];
  editMode?: boolean;
  onAdd: (item: CarrinhoItem) => void;
  onClose: () => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function GrupoOpcaoCard({
  grupo,
  selecionadas,
  onChange,
  nomesVinculos,
}: {
  grupo: GrupoOpcoes;
  selecionadas: OpcaoSelecionada[];
  onChange: (opcao: OpcaoSelecionada, checked: boolean) => void;
  nomesVinculos?: Record<string, string>;
}) {
  const isRadio = grupo.obrigatorio && grupo.maxSelecao === 1;

  return (
    <div className="border border-zinc-200 rounded-xl p-4 mb-3">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">{grupo.nome}</p>
          <p className="text-xs text-zinc-500">
            {grupo.obrigatorio
              ? `Obrigatório · Escolha ${grupo.minSelecao === grupo.maxSelecao ? grupo.maxSelecao : `${grupo.minSelecao}–${grupo.maxSelecao}`}`
              : `Opcional · Até ${grupo.maxSelecao}`}
          </p>
        </div>
        {grupo.obrigatorio && (
          <span className="text-[10px] font-bold bg-red-50 text-red-500 border border-red-200 px-2 py-0.5 rounded-full">
            Obrigatório
          </span>
        )}
      </div>
      <div className="space-y-2">
        {grupo.opcoes.filter((o) => o.ativo).map((opcao) => {
          const isSel = selecionadas.some((s) => s.opcaoId === opcao.id);
          const displayName = opcao.nome?.trim() || nomesVinculos?.[opcao.id] || '—';
          const sel: OpcaoSelecionada = {
            grupoId: grupo.id,
            grupoNome: grupo.nome,
            opcaoId: opcao.id,
            opcaoNome: opcao.nome || nomesVinculos?.[opcao.id] || '—',
            precoAdicional: opcao.precoAdicional,
          };

          return (
            <label key={opcao.id} className="flex items-center gap-3 cursor-pointer group">
              <input
                type={isRadio ? 'radio' : 'checkbox'}
                name={isRadio ? grupo.id : undefined}
                checked={isSel}
                onChange={(e) => onChange(sel, e.target.checked)}
                className="accent-amber-500 w-4 h-4 cursor-pointer"
              />
              <span className="flex-1 text-sm text-zinc-800 group-hover:text-zinc-900">{displayName}</span>
              {opcao.precoAdicional > 0 && (
                <span className="text-xs text-amber-600 font-medium">+{formatPrice(opcao.precoAdicional)}</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function OpcoesModal({
  item,
  initialSelecionadas,
  initialObsIndex,
  initialObsLivre,
  initialQuantidade,
  initialObsUnidades,
  editMode,
  onAdd,
  onClose,
}: Props) {
  const { categorias } = useCardapio();
  const { insumos } = useEstoque();
  const { recipes } = useProducao();
  // Estado para nomes de vínculos (insumo / produção) quando opcao.nome está vazio
  const [nomesVinculos, setNomesVinculos] = useState<Record<string, string>>();
  // Obs mescladas: específicas do item + globais ativas filtradas por item/categoria
  const todasObs = useObsParaItem(item);
  const [selecionadas, setSelecionadas] = useState<OpcaoSelecionada[]>(initialSelecionadas ?? []);
  const [obsIndex, setObsIndex] = useState<number[]>(initialObsIndex ?? []);
  const [obsLivre, setObsLivre] = useState(initialObsLivre ?? '');
  const [quantidade, setQuantidade] = useState(initialQuantidade ?? 1);
  // Per-unit observations: array indexed by unit (0-based), restored from edit mode
  const [obsUnidades, setObsUnidades] = useState<string[]>(initialObsUnidades ?? []);
  const [abaObs, setAbaObs] = useState<'todas' | number>('todas');

  // Buscar nomes de insumos e receitas de produção para opções sem nome
  // IMPORTANTE: sempre inicializa o mapa (nunca deixa undefined) para evitar
  // que opcaoNome fique '—' enquanto os vínculos estão carregando
  useEffect(() => {
    const mapa: Record<string, string> = {};
    for (const grupo of item.gruposOpcoes) {
      for (const op of grupo.opcoes) {
        if (!op.ativo) continue;
        // Só resolve se o nome estiver ausente ou vazio
        if (op.nome && op.nome.trim() !== '') continue;
        if (op.ingredientId) {
          const ing = insumos.find((i) => i.id === op.ingredientId);
          if (ing) { mapa[op.id] = ing.nome; continue; }
        }
        if (op.productionRecipeId) {
          const rec = recipes.find((r) => r.id === op.productionRecipeId);
          if (rec) { mapa[op.id] = rec.name; continue; }
        }
      }
    }
    setNomesVinculos(mapa);
  }, [item, insumos, recipes]);

  // Resolve o nome de uma opção com fallback seguro:
  // 1. Nome cadastrado na opção
  // 2. Nome resolvido do insumo/receita (nomesVinculos)
  // 3. Busca direta nos contextos como último recurso
  const resolveOpcaoNome = useCallback((opcao: OpcaoSelecionada): string => {
    // Se já tem nome direto, usa ele
    if (opcao.opcaoNome && opcao.opcaoNome !== '—' && opcao.opcaoNome.trim() !== '') {
      return opcao.opcaoNome;
    }
    // Tenta do mapa de vínculos
    const fromMapa = nomesVinculos?.[opcao.opcaoId];
    if (fromMapa) return fromMapa;
    // Último recurso: busca nos grupos do item
    const grupo = item.gruposOpcoes.find((g) => g.id === opcao.grupoId);
    const op = grupo?.opcoes.find((o) => o.id === opcao.opcaoId);
    if (op) {
      if (op.ingredientId) {
        const ing = insumos.find((i) => i.id === op.ingredientId);
        if (ing) return ing.nome;
      }
      if (op.productionRecipeId) {
        const rec = recipes.find((r) => r.id === op.productionRecipeId);
        if (rec) return rec.name;
      }
    }
    return opcao.opcaoNome || '—';
  }, [nomesVinculos, item.gruposOpcoes, insumos, recipes]);

  // Resolve stationId from item's category
  const stationId = useMemo(() => {
    const cat = categorias.find((c) => c.id === item.categoriaId);
    return cat?.estacaoId ?? undefined;
  }, [categorias, item.categoriaId]);

  const promoAtiva = item.promocoes.find((p) => p.ativo);
  const precoBase = promoAtiva ? promoAtiva.precoPromocional : item.preco;

  const precoTotal = useMemo(() => {
    const extras = selecionadas.reduce((acc, s) => acc + s.precoAdicional, 0);
    return precoBase + extras;
  }, [precoBase, selecionadas]);

  const gruposInvalidos = useMemo(() => {
    return item.gruposOpcoes.filter((g) => {
      if (!g.obrigatorio) return false;
      const count = selecionadas.filter((s) => s.grupoId === g.id).length;
      return count < g.minSelecao;
    });
  }, [item.gruposOpcoes, selecionadas]);

  const handleOpcaoChange = (opcao: OpcaoSelecionada, checked: boolean) => {
    const grupo = item.gruposOpcoes.find((g) => g.id === opcao.grupoId);
    if (!grupo) return;
    const isRadio = grupo.obrigatorio && grupo.maxSelecao === 1;

    setSelecionadas((prev) => {
      if (isRadio) {
        return [...prev.filter((s) => s.grupoId !== opcao.grupoId), ...(checked ? [opcao] : [])];
      }
      if (checked) {
        const count = prev.filter((s) => s.grupoId === opcao.grupoId).length;
        if (count >= grupo.maxSelecao) return prev;
        return [...prev, opcao];
      }
      return prev.filter((s) => s.opcaoId !== opcao.opcaoId);
    });
  };

  const handleToggleObs = (idx: number) => {
    setObsIndex((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const handleAddToCart = () => {
    if (gruposInvalidos.length > 0) return;
    onAdd({
      cartId: `ci-${Date.now()}`,
      itemId: item.id,
      nome: item.nome,
      precoBase,
      precoTotal,
      quantidade,
      // Garante que o nome de cada opção está resolvido antes de salvar no carrinho
      opcoes: selecionadas.map((s) => ({ ...s, opcaoNome: resolveOpcaoNome(s) })),
      observacoes: obsIndex.map((i) => todasObs[i]),
      observacaoLivre: obsLivre,
      obsUnidades: obsUnidades.length > 0 ? obsUnidades : undefined,
      semPreparo: item.semPreparo ?? false,
      stationId,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-50 rounded-2xl w-full max-w-md flex flex-col shadow-2xl" style={{ maxHeight: 'min(90dvh, 90vh)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-white rounded-t-2xl border-b border-zinc-200 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-zinc-900 truncate">{item.nome}</p>
            <p className="text-xs text-zinc-500">{formatPrice(precoBase)}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 cursor-pointer text-zinc-800 transition-colors flex-shrink-0"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5">
          {item.gruposOpcoes.length === 0 && todasObs.length === 0 ? (
            <div className="text-center py-6 text-zinc-400 text-sm">
              <i className="ri-check-line text-2xl block mb-1 text-green-500" />
              Nenhuma opção disponível para este item.
            </div>
          ) : null}

          {item.gruposOpcoes.map((grupo) => (
            <GrupoOpcaoCard
              key={grupo.id}
              grupo={grupo}
              selecionadas={selecionadas}
              onChange={handleOpcaoChange}
              nomesVinculos={nomesVinculos}
            />
          ))}

          <div className="border border-zinc-200 rounded-xl p-4 mb-3 bg-white">
            <p className="text-sm font-semibold text-zinc-900 mb-3">Observações</p>
            {todasObs.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {todasObs.map((obs, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleToggleObs(idx)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer whitespace-nowrap ${
                      obsIndex.includes(idx)
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-white border-zinc-200 text-zinc-600 hover:border-amber-300'
                    }`}
                  >
                    {obs}
                  </button>
                ))}
              </div>
            )}

            {/* Se quantidade > 1, oferecer obs por unidade */}
            {quantidade > 1 ? (
              <div>
                <div className="flex gap-1 mb-2 flex-wrap">
                  <button
                    onClick={() => setAbaObs('todas')}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${abaObs === 'todas' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                  >
                    Todas as unidades
                  </button>
                  {Array.from({ length: quantidade }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setAbaObs(i)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${abaObs === i ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                    >
                      Un. {i + 1}
                      {obsUnidades[i] && <span className="ml-1 w-1.5 h-1.5 inline-block rounded-full bg-amber-300" />}
                    </button>
                  ))}
                </div>
                {abaObs === 'todas' ? (
                  <textarea
                    value={obsLivre}
                    onChange={(e) => setObsLivre(e.target.value)}
                    placeholder="Obs. para todas as unidades..."
                    rows={3}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                  />
                ) : (
                  <textarea
                    value={obsUnidades[abaObs as number] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setObsUnidades((prev) => {
                        const next = [...prev];
                        next[abaObs as number] = val;
                        return next;
                      });
                    }}
                    placeholder={`Obs. só para unidade ${(abaObs as number) + 1}...`}
                    rows={3}
                    className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-amber-50"
                  />
                )}
              </div>
            ) : (
              <textarea
                value={obsLivre}
                onChange={(e) => setObsLivre(e.target.value)}
                placeholder="Observação livre..."
                rows={3}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-zinc-200 rounded-b-2xl flex-shrink-0">
          {gruposInvalidos.length > 0 && (
            <p className="text-xs text-red-500 mb-2 text-center">
              Selecione: {gruposInvalidos.map((g) => g.nome).join(', ')}
            </p>
          )}
          <div className="flex items-center gap-2">
            {/* Qty */}
            <div className="flex items-center gap-1.5 border border-zinc-300 rounded-lg px-2 py-1.5 flex-shrink-0 bg-white">
              <button
                onClick={() => {
                  const novaQtd = Math.max(1, quantidade - 1);
                  setQuantidade(novaQtd);
                  // Remove obs de unidades que sumiram
                  setObsUnidades((prev) => prev.slice(0, novaQtd));
                  // Se a aba ativa sumiu, volta pra "todas"
                  if (typeof abaObs === 'number' && abaObs >= novaQtd) {
                    setAbaObs('todas');
                  }
                  // Se voltou pra 1 unidade, volta pra "todas"
                  if (novaQtd === 1) setAbaObs('todas');
                }}
                className="w-6 h-6 flex items-center justify-center rounded bg-zinc-200 hover:bg-zinc-300 cursor-pointer text-zinc-900 font-bold transition-colors"
              >
                <i className="ri-subtract-line text-sm" />
              </button>
              <span className="w-5 text-center text-sm font-semibold text-zinc-900">{quantidade}</span>
              <button
                onClick={() => setQuantidade((q) => q + 1)}
                className="w-6 h-6 flex items-center justify-center rounded bg-zinc-200 hover:bg-zinc-300 cursor-pointer text-zinc-900 font-bold transition-colors"
              >
                <i className="ri-add-line text-sm" />
              </button>
            </div>
            <button
              onClick={onClose}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-zinc-200 text-zinc-600 hover:bg-zinc-50 font-semibold text-sm rounded-lg transition-colors cursor-pointer whitespace-nowrap flex-shrink-0"
            >
              <i className="ri-close-line text-base" />
              Cancelar
            </button>
            <button
              onClick={handleAddToCart}
              disabled={gruposInvalidos.length > 0}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-between px-3 text-sm"
            >
              <span>{editMode ? 'Salvar alterações' : 'Adicionar'}</span>
              <span>{formatPrice(precoTotal * quantidade)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
