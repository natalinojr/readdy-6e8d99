import { useState } from 'react';
import type { GrupoOpcoes, PromocaoItem, SubproducaoItem } from '@/types/cardapio';
import type { EstacaoOnboarding } from './StepEstacao';
import ItemEditorOnboarding from './ItemEditorOnboarding';
import ItemImage from '../../../components/base/ItemImage';

export interface CategoriaOnboarding {
  id: string;
  nome: string;
  estacaoId: string;
  ativo: boolean;
}

export interface ItemOnboarding {
  id: string;
  nome: string;
  preco: string;
  categoriaId: string;
  descricao?: string;
  slaMinutos?: number;
  fotoUrl?: string;
  status?: 'ativo' | 'inativo';
  gruposOpcoes?: GrupoOpcoes[];
  promocoes?: PromocaoItem[];
  observacoesPadrao?: string[];
  producaoDividida?: boolean;
  subproducao?: SubproducaoItem[];
}

export interface CardapioData {
  categorias: CategoriaOnboarding[];
  itens: ItemOnboarding[];
}

const CATEGORIAS_SUGESTAO: Record<string, string[]> = {
  restaurante: ['Entradas', 'Pratos Principais', 'Sobremesas', 'Bebidas', 'Almoço Executivo'],
  lanchonete: ['Lanches', 'Porções', 'Bebidas', 'Combos'],
  pizzaria: ['Pizzas Salgadas', 'Pizzas Doces', 'Esfihas', 'Bebidas', 'Bordas'],
  bar: ['Petiscos', 'Chopes & Cervejas', 'Drinques', 'Bebidas sem Álcool'],
  cafe: ['Cafés', 'Frios & Salgados', 'Doces & Bolos', 'Bebidas Geladas'],
  hamburgueria: ['Hambúrgueres', 'Porções', 'Bebidas', 'Sobremesas', 'Combos'],
  foodpark: ['Entradas', 'Pratos', 'Porções', 'Bebidas', 'Sobremesas'],
  darkKitchen: ['Pratos Principais', 'Acompanhamentos', 'Bebidas', 'Combos'],
  sorveteria: ['Sorvetes', 'Açaí', 'Milk-shakes', 'Bebidas', 'Complementos'],
  acai: ['Açaí', 'Smoothies', 'Frutas', 'Complementos', 'Bebidas'],
  padaria: ['Pães', 'Doces & Bolos', 'Salgados', 'Bebidas Quentes', 'Bebidas Geladas'],
  churrascaria: ['Carnes', 'Acompanhamentos', 'Saladas', 'Bebidas', 'Sobremesas'],
  sushi: ['Temakis', 'Combinados', 'Hot Rolls', 'Bebidas', 'Sobremesas'],
  outro: ['Produtos', 'Bebidas', 'Combos'],
};

interface SugestaoExpandida {
  nome: string;
  estacaoId: string;
}

interface CategoriaEditando {
  id: string;
  nome: string;
  estacaoId: string;
  ativo: boolean;
}

interface StepCardapioProps {
  data: CardapioData;
  estacoes: EstacaoOnboarding[];
  tipoNegocio: string;
  onNext: (data: CardapioData) => void;
  onBack: () => void;
}

export default function StepCardapio({ data, estacoes, tipoNegocio, onNext, onBack }: StepCardapioProps) {
  const [categorias, setCategorias] = useState<CategoriaOnboarding[]>(data.categorias);
  const [itens, setItens] = useState<ItemOnboarding[]>(data.itens);

  // Sugestão clicada — expande inline para confirmar estação
  const [sugestaoExpandida, setSugestaoExpandida] = useState<SugestaoExpandida | null>(null);

  // Modal de adicionar categoria manual
  const [adicionandoCategoria, setAdicionandoCategoria] = useState(false);
  const [novaCategoriaNome, setNovaCategoriaNome] = useState('');
  const [novaCategoriaEstacao, setNovaCategoriaEstacao] = useState(estacoes[0]?.id ?? '');

  // Editar categoria existente
  const [editandoCategoria, setEditandoCategoria] = useState<CategoriaEditando | null>(null);

  // Modal item editor
  const [itemEditor, setItemEditor] = useState<{ open: boolean; item?: ItemOnboarding }>({ open: false });

  const [erro, setErro] = useState('');

  const sugestoesCategoria = CATEGORIAS_SUGESTAO[tipoNegocio] ?? CATEGORIAS_SUGESTAO.restaurante;

  const getNomeEstacao = (id: string) => estacoes.find((e) => e.id === id)?.nome ?? '—';
  const getCorEstacao = (id: string) => estacoes.find((e) => e.id === id)?.cor ?? '#999';
  const getNomeCategoria = (id: string) => categorias.find((c) => c.id === id)?.nome ?? '—';

  /* ── Sugestão click → expande inline ── */
  const handleSugestaoClick = (nome: string) => {
    const jaTem = categorias.find((c) => c.nome.toLowerCase() === nome.toLowerCase());
    if (jaTem) return; // já adicionada
    setSugestaoExpandida({ nome, estacaoId: estacoes[0]?.id ?? '' });
    setAdicionandoCategoria(false);
  };

  const confirmarSugestao = () => {
    if (!sugestaoExpandida) return;
    const nova: CategoriaOnboarding = {
      id: `cat-ob-${Date.now()}`,
      nome: sugestaoExpandida.nome,
      estacaoId: sugestaoExpandida.estacaoId,
      ativo: true,
    };
    setCategorias((prev) => [...prev, nova]);
    setSugestaoExpandida(null);
    setErro('');
  };

  /* ── Adicionar categoria manual ── */
  const adicionarCategoria = () => {
    if (!novaCategoriaNome.trim()) return;
    const nova: CategoriaOnboarding = {
      id: `cat-ob-${Date.now()}`,
      nome: novaCategoriaNome.trim(),
      estacaoId: novaCategoriaEstacao,
      ativo: true,
    };
    setCategorias((prev) => [...prev, nova]);
    setNovaCategoriaNome('');
    setAdicionandoCategoria(false);
    setErro('');
  };

  /* ── Remover categoria ── */
  const removerCategoria = (id: string) => {
    setCategorias((prev) => prev.filter((c) => c.id !== id));
    setItens((prev) => prev.filter((i) => i.categoriaId !== id));
    if (editandoCategoria?.id === id) setEditandoCategoria(null);
  };

  /* ── Salvar edição de categoria ── */
  const salvarEdicaoCategoria = () => {
    if (!editandoCategoria || !editandoCategoria.nome.trim()) return;
    setCategorias((prev) =>
      prev.map((c) =>
        c.id === editandoCategoria.id
          ? { ...c, nome: editandoCategoria.nome, estacaoId: editandoCategoria.estacaoId, ativo: editandoCategoria.ativo }
          : c
      )
    );
    setEditandoCategoria(null);
  };

  /* ── Item editor ── */
  const handleSaveItem = (item: ItemOnboarding) => {
    setItens((prev) => {
      const exists = prev.find((i) => i.id === item.id);
      if (exists) return prev.map((i) => (i.id === item.id ? item : i));
      return [...prev, item];
    });
    setItemEditor({ open: false });
  };

  const handleNext = () => {
    if (categorias.length === 0) {
      setErro('Crie pelo menos uma categoria para continuar.');
      return;
    }
    onNext({ categorias, itens });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-zinc-900 mb-1">Cardápio inicial</h2>
        <p className="text-sm text-zinc-500">
          Crie pelo menos uma categoria. Itens podem ser adicionados agora ou depois em <strong>Cardápio</strong>.
        </p>
      </div>

      {/* ─── CATEGORIAS ─── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-zinc-700">Categorias</p>
          {categorias.length > 0 && (
            <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full">
              {categorias.length} criada{categorias.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Sugestões rápidas */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {sugestoesCategoria.map((s) => {
            const jaTem = categorias.find((c) => c.nome.toLowerCase() === s.toLowerCase());
            const expandida = sugestaoExpandida?.nome === s;
            return (
              <button
                key={s}
                onClick={() => !jaTem && handleSugestaoClick(s)}
                className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer transition-all whitespace-nowrap font-medium ${
                  jaTem
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 cursor-default'
                    : expandida
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-zinc-200 text-zinc-600 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50'
                }`}
              >
                {jaTem ? <i className="ri-check-line mr-1" /> : expandida ? <i className="ri-arrow-down-s-line mr-1" /> : <i className="ri-add-line mr-1" />}
                {s}
              </button>
            );
          })}
        </div>

        {/* Painel de confirmação de sugestão */}
        {sugestaoExpandida && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-3 mb-3">
            <div className="flex items-center gap-2">
              <i className="ri-folder-2-line text-amber-600" />
              <span className="text-sm font-bold text-zinc-800">{sugestaoExpandida.nome}</span>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-zinc-600 mb-1.5">Estação de cozinha vinculada</label>
              <select
                value={sugestaoExpandida.estacaoId}
                onChange={(e) => setSugestaoExpandida({ ...sugestaoExpandida, estacaoId: e.target.value })}
                className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-400 cursor-pointer bg-white text-zinc-800"
              >
                {estacoes.map((est) => (
                  <option key={est.id} value={est.id}>{est.nome}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSugestaoExpandida(null)}
                className="flex-1 py-1.5 text-xs font-semibold text-zinc-500 bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap hover:bg-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarSugestao}
                className="flex-1 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-lg cursor-pointer whitespace-nowrap hover:bg-amber-600"
              >
                Adicionar categoria
              </button>
            </div>
          </div>
        )}

        {/* Lista de categorias criadas */}
        {categorias.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {categorias.map((cat) => (
              <div key={cat.id}>
                {editandoCategoria?.id === cat.id ? (
                  /* Modo edição inline */
                  <div className="p-3 bg-zinc-50 border border-amber-200 rounded-xl space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Nome</label>
                        <input
                          value={editandoCategoria.nome}
                          onChange={(e) => setEditandoCategoria({ ...editandoCategoria, nome: e.target.value })}
                          className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-400 text-zinc-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Estação</label>
                        <select
                          value={editandoCategoria.estacaoId}
                          onChange={(e) => setEditandoCategoria({ ...editandoCategoria, estacaoId: e.target.value })}
                          className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-400 cursor-pointer text-zinc-800"
                        >
                          {estacoes.map((est) => (
                            <option key={est.id} value={est.id}>{est.nome}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 justify-between">
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-zinc-600">
                        <input
                          type="checkbox"
                          checked={editandoCategoria.ativo}
                          onChange={(e) => setEditandoCategoria({ ...editandoCategoria, ativo: e.target.checked })}
                          className="accent-amber-500"
                        />
                        Ativa
                      </label>
                      <div className="flex gap-2">
                        <button onClick={() => setEditandoCategoria(null)} className="py-1.5 px-3 text-xs font-semibold text-zinc-500 bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap hover:bg-zinc-200">Cancelar</button>
                        <button onClick={salvarEdicaoCategoria} className="py-1.5 px-3 text-xs font-semibold text-white bg-amber-500 rounded-lg cursor-pointer whitespace-nowrap hover:bg-amber-600">Salvar</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Modo visualização */
                  <div className={`flex items-center gap-2 px-3 py-2 bg-white border rounded-lg transition-all ${cat.ativo ? 'border-zinc-100' : 'border-zinc-100 opacity-60'}`}>
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getCorEstacao(cat.estacaoId) }} />
                    <span className="text-sm font-semibold text-zinc-800 flex-1">{cat.nome}</span>
                    {!cat.ativo && <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">inativa</span>}
                    <span className="text-[10px] text-zinc-400">{getNomeEstacao(cat.estacaoId)}</span>
                    <button
                      onClick={() => setEditandoCategoria({ id: cat.id, nome: cat.nome, estacaoId: cat.estacaoId, ativo: cat.ativo })}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-amber-50 text-zinc-300 hover:text-amber-500 cursor-pointer transition-colors"
                    >
                      <i className="ri-pencil-line text-xs" />
                    </button>
                    <button
                      onClick={() => removerCategoria(cat.id)}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-zinc-300 hover:text-red-400 cursor-pointer transition-colors"
                    >
                      <i className="ri-close-line text-xs" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Adicionar categoria personalizada */}
        {adicionandoCategoria ? (
          <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Nome da categoria</label>
                <input
                  value={novaCategoriaNome}
                  onChange={(e) => setNovaCategoriaNome(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && adicionarCategoria()}
                  placeholder="Ex: Entradas"
                  autoFocus
                  className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-400 text-zinc-800"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Estação vinculada</label>
                <select
                  value={novaCategoriaEstacao}
                  onChange={(e) => setNovaCategoriaEstacao(e.target.value)}
                  className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-400 cursor-pointer text-zinc-800"
                >
                  {estacoes.map((est) => (
                    <option key={est.id} value={est.id}>{est.nome}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAdicionandoCategoria(false)} className="flex-1 py-1.5 text-xs font-semibold text-zinc-500 bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap hover:bg-zinc-200">Cancelar</button>
              <button onClick={adicionarCategoria} disabled={!novaCategoriaNome.trim()} className="flex-1 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-lg cursor-pointer disabled:opacity-40 whitespace-nowrap hover:bg-amber-600">Adicionar</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setAdicionandoCategoria(true); setSugestaoExpandida(null); }}
            className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors"
          >
            <i className="ri-add-circle-line text-sm" />
            Categoria personalizada
          </button>
        )}
      </div>

      {/* ─── ITENS ─── */}
      {categorias.length > 0 && (
        <div className="border-t border-zinc-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs font-semibold text-zinc-700">
                Itens do cardápio <span className="text-zinc-400 font-normal">(opcional)</span>
              </p>
              <p className="text-[10px] text-zinc-400">Você pode adicionar depois em Cardápio.</p>
            </div>
            <button
              onClick={() => setItemEditor({ open: true })}
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-add-line text-sm" />
              Adicionar item
            </button>
          </div>

          {itens.length > 0 && (
            <div className="space-y-1.5">
              {itens.map((item) => (
                <div key={item.id} className="flex items-center gap-2 px-3 py-2 bg-white border border-zinc-100 rounded-lg">
                  <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 border border-zinc-100">
                    <ItemImage src={item.fotoUrl} alt={item.nome} className="w-full h-full" placeholderClassName="rounded-lg" />
                  </div>
                  <span className="text-sm font-semibold text-zinc-800 flex-1">{item.nome}</span>
                  {item.status === 'inativo' && (
                    <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">inativo</span>
                  )}
                  <span className="text-xs font-semibold text-zinc-600">R$ {parseFloat(item.preco).toFixed(2)}</span>
                  <span className="text-[10px] text-zinc-400">{getNomeCategoria(item.categoriaId)}</span>
                  {(item.gruposOpcoes?.length ?? 0) > 0 && (
                    <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">{item.gruposOpcoes!.length} grupo{item.gruposOpcoes!.length > 1 ? 's' : ''}</span>
                  )}
                  <button
                    onClick={() => setItemEditor({ open: true, item })}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-amber-50 text-zinc-300 hover:text-amber-500 cursor-pointer"
                  >
                    <i className="ri-pencil-line text-xs" />
                  </button>
                  <button
                    onClick={() => setItens((prev) => prev.filter((i) => i.id !== item.id))}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-zinc-300 hover:text-red-400 cursor-pointer"
                  >
                    <i className="ri-close-line text-xs" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {itens.length === 0 && (
            <div className="text-center py-4 text-zinc-400">
              <i className="ri-restaurant-line text-2xl block mb-1" />
              <p className="text-xs">Nenhum item adicionado ainda</p>
            </div>
          )}
        </div>
      )}

      {erro && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <i className="ri-error-warning-line text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600">{erro}</p>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-5 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
          Voltar
        </button>
        <button onClick={handleNext} className="flex-1 py-2.5 text-sm font-bold text-white bg-amber-500 rounded-xl hover:bg-amber-600 cursor-pointer whitespace-nowrap">
          Continuar
        </button>
      </div>

      {/* Item editor modal */}
      {itemEditor.open && (
        <ItemEditorOnboarding
          item={itemEditor.item}
          categorias={categorias}
          estacoes={estacoes}
          onSave={handleSaveItem}
          onClose={() => setItemEditor({ open: false })}
        />
      )}
    </div>
  );
}
