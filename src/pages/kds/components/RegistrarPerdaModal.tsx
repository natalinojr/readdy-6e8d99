import { useState, useMemo, useEffect } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import type { Item, FichaTecnicaItem } from '@/types/cardapio';
import { useEstoque, type PerdaItem } from '../../../contexts/EstoqueContext';
import type { Insumo } from '../../../contexts/EstoqueContext';
import ItemImage from '../../../components/base/ItemImage';
import { supabase } from '@/lib/supabase';
import { convertUnit } from '@/lib/unitConversion';

type Tipo = 'item' | 'insumo' | null;
type ModoItem = 'inteiro' | 'parcial';
type Step = 1 | 2 | 3;

interface Props {
  operador: string;
  onClose: () => void;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function RegistrarPerdaModal({ operador, onClose }: Props) {
  const { registrarPerda } = useEstoque();
  const { itensAtivos } = useCardapio();
  const { insumos } = useEstoque();

  const [step, setStep] = useState<Step>(1);
  const [tipo, setTipo] = useState<Tipo>(null);
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);

  // --- Fluxo: Item do Cardápio ---
  const [buscaItem, setBuscaItem] = useState('');
  const [itemSelecionado, setItemSelecionado] = useState<Item | null>(null);
  const [fichaCarregada, setFichaCarregada] = useState<FichaTecnicaItem[]>([]);
  const [fichaLoading, setFichaLoading] = useState(false);
  const [qtdItem, setQtdItem] = useState(1);
  const [modoItem, setModoItem] = useState<ModoItem>('inteiro');
  const [insumosSelecionados, setInsumosSelecionados] = useState<Set<string>>(new Set());

  // --- Fluxo: Insumo Específico ---
  const [buscaInsumo, setBuscaInsumo] = useState('');
  const [insumoSelecionado, setInsumoSelecionado] = useState<Insumo | null>(null);
  const [qtdInsumo, setQtdInsumo] = useState<number>(0);

  // Carrega a ficha técnica do banco (item_ingredients) quando o usuário seleciona um item
  const carregarFichaDoBanco = async (itemId: string) => {
    if (!supabase) return;
    setFichaLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_get_item_ingredients', { p_tenant_id: null, p_item_id: itemId });
      if (error) {
        console.warn('[RegistrarPerdaModal] fn_get_item_ingredients error:', error.message);
        setFichaCarregada([]);
        return;
      }
      const rows = (data as Array<{
        id: string;
        ingredient_id: string;
        ingredient_name: string;
        quantity: number;
        unit: string;
        unit_price: number;
        ingredient_unit: string;
      }>) ?? [];
      const mapped: FichaTecnicaItem[] = rows.map((r) => ({
        id: r.id,
        insumoId: r.ingredient_id,
        insumoNome: r.ingredient_name,
        gramagem: Number(r.quantity),
        unidade: r.unit ?? r.ingredient_unit ?? 'g',
        precoUnitario: Number(r.unit_price),
      }));
      setFichaCarregada(mapped);
    } catch (e) {
      console.warn('[RegistrarPerdaModal] carregarFichaDoBanco error:', e);
      setFichaCarregada([]);
    } finally {
      setFichaLoading(false);
    }
  };

  // Itens que têm ficha técnica no banco
  const [idsComFicha, setIdsComFicha] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Pré-carrega quais itens têm ficha técnica no banco
    const loadIds = async () => {
      if (!itensAtivos.length) { setIdsComFicha(new Set()); return; }
      const ids = itensAtivos.map((i) => i.id);
      // Busca todas as fichas técnicas desses itens de uma vez
      try {
        const { data, error } = await supabase
          .from('item_ingredients')
          .select('item_id')
          .in('item_id', ids)
          .limit(500);
        if (error) throw error;
        const uniqueIds = new Set((data ?? []).map((r: { item_id: string }) => r.item_id));
        setIdsComFicha(uniqueIds);
      } catch (e) {
        console.warn('[RegistrarPerdaModal] loadIdsComFicha error:', e);
        setIdsComFicha(new Set());
      }
    };
    loadIds();
  }, [itensAtivos]);

  const itensFiltrados = useMemo(() =>
    itensAtivos.filter(
      (i) => idsComFicha.has(i.id) &&
        i.nome.toLowerCase().includes(buscaItem.toLowerCase())
    ),
    [itensAtivos, idsComFicha, buscaItem]
  );

  const insumosFiltrados = useMemo(() =>
    insumos.filter((i) =>
      i.nome.toLowerCase().includes(buscaInsumo.toLowerCase()) ||
      (i.categoria && i.categoria.toLowerCase().includes(buscaInsumo.toLowerCase()))
    ),
    [insumos, buscaInsumo]
  );

  const toggleInsumoSelecionado = (id: string) => {
    setInsumosSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selecionarTodosInsumos = () => {
    if (!itemSelecionado || fichaCarregada.length === 0) return;
    setInsumosSelecionados(new Set(fichaCarregada.map((f) => f.id)));
  };

  // Calcula a lista final de perdas para o step 3
  const itensPerda: PerdaItem[] = useMemo(() => {
    if (tipo === 'item' && itemSelecionado && fichaCarregada.length > 0) {
      const fichasAtivas: FichaTecnicaItem[] =
        modoItem === 'inteiro'
          ? fichaCarregada
          : fichaCarregada.filter((f) => insumosSelecionados.has(f.id));
      return fichasAtivas.map((f) => {
        const insumoDoEstoque = insumos.find((i) => i.id === f.insumoId);
        const estoqueUnit = insumoDoEstoque?.unidade ?? (f.unidade as PerdaItem['unidade']);
        const fichaUnit = f.unidade;
        const totalQty = f.gramagem * qtdItem;
        let finalQty = totalQty;
        if (fichaUnit !== estoqueUnit) {
          const converted = convertUnit(totalQty, fichaUnit, estoqueUnit);
          if (converted !== null) finalQty = converted;
        }
        return {
          insumoId: f.insumoId,
          insumoNome: f.insumoNome,
          quantidade: finalQty,
          unidade: estoqueUnit,
        };
      });
    }
    if (tipo === 'insumo' && insumoSelecionado && qtdInsumo > 0) {
      return [{
        insumoId: insumoSelecionado.id,
        insumoNome: insumoSelecionado.nome,
        quantidade: qtdInsumo,
        unidade: insumoSelecionado.unidade,
      }];
    }
    return [];
  }, [tipo, itemSelecionado, modoItem, insumosSelecionados, qtdItem, insumoSelecionado, qtdInsumo, fichaCarregada]);

  const podeAvancar = (): boolean => {
    if (step === 1) return tipo !== null;
    if (step === 2) {
      if (tipo === 'item') {
        if (!itemSelecionado) return false;
        if (modoItem === 'parcial' && insumosSelecionados.size === 0) return false;
        return true;
      }
      if (tipo === 'insumo') return insumoSelecionado !== null && qtdInsumo > 0;
    }
    if (step === 3) return motivo.trim().length >= 3;
    return false;
  };

  const handleConfirmar = () => {
    if (itensPerda.length === 0) return;
    registrarPerda(itensPerda, motivo, operador);
    setConfirmado(true);
    setTimeout(() => onClose(), 2200);
  };

  if (confirmado) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-zinc-800 rounded-2xl p-8 w-full max-w-sm mx-4 text-center border border-zinc-700">
          <div className="w-16 h-16 flex items-center justify-center bg-red-500/20 rounded-full mx-auto mb-4">
            <i className="ri-check-double-line text-3xl text-red-400" />
          </div>
          <h2 className="text-white font-bold text-lg mb-1">Perda Registrada</h2>
          <p className="text-zinc-400 text-sm">{itensPerda.length} insumo{itensPerda.length > 1 ? 's' : ''} deduzido{itensPerda.length > 1 ? 's' : ''} do estoque</p>
          <div className="mt-4 flex items-center justify-center gap-2 text-zinc-500 text-xs">
            <i className="ri-loader-4-line animate-spin" />
            Fechando...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-xl mx-4 overflow-hidden border border-zinc-700 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-red-500/20 rounded-lg">
              <i className="ri-alert-line text-red-400 text-sm" />
            </div>
            <div>
              <h2 className="text-white font-bold text-sm">Registrar Perda</h2>
              <p className="text-zinc-500 text-[10px]">
                Etapa {step} de 3 · {tipo === 'item' ? 'Item do Cardápio' : tipo === 'insumo' ? 'Insumo Específico' : 'Escolha o tipo'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-700 hover:bg-zinc-600 cursor-pointer text-zinc-400 transition-colors">
            <i className="ri-close-line text-sm" />
          </button>
        </div>

        {/* Progress */}
        <div className="flex gap-1 px-5 py-3 flex-shrink-0">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${s <= step ? 'bg-red-500' : 'bg-zinc-700'}`} />
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">

          {/* ── STEP 1: Tipo ── */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-zinc-400 text-sm mb-4">O que foi descartado?</p>
              <button
                onClick={() => { setTipo('item'); }}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all text-left ${
                  tipo === 'item' ? 'border-red-500 bg-red-500/10' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                }`}
              >
                <div className="w-10 h-10 flex items-center justify-center bg-zinc-700 rounded-xl flex-shrink-0">
                  <i className="ri-restaurant-line text-lg text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Item do Cardápio</p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    Lanche, porção, bebida — sistema calcula os insumos pela ficha técnica. Você pode jogar fora o inteiro ou selecionar ingredientes específicos.
                  </p>
                </div>
                {tipo === 'item' && (
                  <div className="w-5 h-5 flex items-center justify-center bg-red-500 rounded-full flex-shrink-0 ml-auto">
                    <i className="ri-check-line text-white text-xs" />
                  </div>
                )}
              </button>

              <button
                onClick={() => { setTipo('insumo'); }}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all text-left ${
                  tipo === 'insumo' ? 'border-red-500 bg-red-500/10' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                }`}
              >
                <div className="w-10 h-10 flex items-center justify-center bg-zinc-700 rounded-xl flex-shrink-0">
                  <i className="ri-flask-line text-lg text-emerald-400" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Insumo Específico</p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    Um ingrediente isolado — carne, queijo, óleo, etc. Informe a quantidade diretamente.
                  </p>
                </div>
                {tipo === 'insumo' && (
                  <div className="w-5 h-5 flex items-center justify-center bg-red-500 rounded-full flex-shrink-0 ml-auto">
                    <i className="ri-check-line text-white text-xs" />
                  </div>
                )}
              </button>
            </div>
          )}

          {/* ── STEP 2A: Item do Cardápio ── */}
          {step === 2 && tipo === 'item' && (
            <div className="space-y-4">
              {/* Selecionar item */}
              {!itemSelecionado ? (
                <>
                  <p className="text-zinc-400 text-sm">Qual item foi descartado?</p>
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                    <i className="ri-search-line text-zinc-500 text-sm" />
                    <input
                      type="text"
                      value={buscaItem}
                      onChange={(e) => setBuscaItem(e.target.value)}
                      placeholder="Buscar item..."
                      className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
                    />
                  </div>
                  {itensFiltrados.length === 0 ? (
                    <div className="text-center py-8">
                      <i className="ri-restaurant-line text-3xl text-zinc-600 block mb-2" />
                      <p className="text-sm text-zinc-500">Nenhum item com ficha técnica cadastrada.</p>
                      <p className="text-xs text-zinc-600 mt-1">Cadastre fichas técnicas no cardápio para usar este fluxo.</p>
                      <p className="text-xs text-zinc-600 mt-1">Use "Insumo Específico" para registrar perdas manualmente.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {itensFiltrados.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => { setItemSelecionado(item); carregarFichaDoBanco(item.id); }}
                          className="w-full flex items-center gap-3 p-3 bg-zinc-900 hover:bg-zinc-700 border border-zinc-700 rounded-xl cursor-pointer transition-colors text-left"
                        >
                          <ItemImage
                            src={item.fotoUrl}
                            alt={item.nome}
                            className="w-10 h-10 rounded-lg flex-shrink-0"
                            placeholderClassName="rounded-lg"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">{item.nome}</p>
                            <p className="text-zinc-500 text-[10px]">Ver insumos da ficha técnica</p>
                          </div>
                          <span className="text-amber-400 text-sm font-bold flex-shrink-0">
                            {item.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Item selecionado */}
                  <div className="flex items-center gap-3 p-3 bg-zinc-900 border border-amber-500/40 rounded-xl">
                    <ItemImage
                    src={itemSelecionado.fotoUrl}
                    alt={itemSelecionado.nome}
                    className="w-10 h-10 rounded-lg flex-shrink-0"
                    placeholderClassName="rounded-lg"
                  />
                    <div className="flex-1">
                      <p className="text-white font-bold text-sm">{itemSelecionado.nome}</p>
                      <p className="text-zinc-400 text-[10px]">{fichaCarregada.length} insumos na ficha técnica</p>
                    </div>
                    <button
                      onClick={() => { setItemSelecionado(null); setInsumosSelecionados(new Set()); setModoItem('inteiro'); }}
                      className="text-zinc-500 hover:text-white cursor-pointer text-xs transition-colors whitespace-nowrap"
                    >
                      Trocar
                    </button>
                  </div>

                  {/* Quantidade */}
                  <div>
                    <p className="text-zinc-400 text-xs mb-2">Quantas unidades foram descartadas?</p>
                    <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 w-fit">
                      <button
                        onClick={() => setQtdItem((q) => Math.max(1, q - 1))}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-700 hover:bg-zinc-600 cursor-pointer text-white transition-colors"
                      >
                        <i className="ri-subtract-line text-sm" />
                      </button>
                      <span className="text-white font-black text-xl w-8 text-center">{qtdItem}</span>
                      <button
                        onClick={() => setQtdItem((q) => q + 1)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500 hover:bg-red-600 cursor-pointer text-white transition-colors"
                      >
                        <i className="ri-add-line text-sm" />
                      </button>
                    </div>
                  </div>

                  {/* Modo: Inteiro ou Parcial */}
                  <div>
                    <p className="text-zinc-400 text-xs mb-2">O que foi descartado?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setModoItem('inteiro')}
                        className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold cursor-pointer transition-all ${
                          modoItem === 'inteiro' ? 'border-red-500 bg-red-500/10 text-red-300' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        <i className="ri-delete-bin-line mr-1.5" />
                        Inteiro
                        <p className="text-[10px] font-normal mt-0.5 text-zinc-500">Todos os ingredientes da ficha</p>
                      </button>
                      <button
                        onClick={() => { setModoItem('parcial'); selecionarTodosInsumos(); }}
                        className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold cursor-pointer transition-all ${
                          modoItem === 'parcial' ? 'border-amber-500 bg-amber-500/10 text-amber-300' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        <i className="ri-checkbox-multiple-line mr-1.5" />
                        Parcial
                        <p className="text-[10px] font-normal mt-0.5 text-zinc-500">Selecionar ingredientes</p>
                      </button>
                    </div>
                  </div>

                  {/* Loading da ficha */}
                  {fichaLoading && (
                    <div className="flex items-center gap-2 text-zinc-400 text-xs py-2">
                      <i className="ri-loader-4-line animate-spin" />
                      Carregando ficha técnica...
                    </div>
                  )}

                  {/* Ficha técnica com checkboxes (modo parcial) */}
                  {!fichaLoading && modoItem === 'parcial' && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-zinc-400 text-xs">Quais ingredientes foram descartados?</p>
                        <div className="flex gap-2">
                          <button onClick={selecionarTodosInsumos} className="text-[10px] text-amber-400 hover:text-amber-300 cursor-pointer transition-colors whitespace-nowrap">
                            Todos
                          </button>
                          <button onClick={() => setInsumosSelecionados(new Set())} className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors whitespace-nowrap">
                            Nenhum
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5 max-h-44 overflow-y-auto">
                        {fichaCarregada.map((ft) => {
                          const sel = insumosSelecionados.has(ft.id);
                          const insumoDoEstoque = insumos.find((i) => i.id === ft.insumoId);
                          const estoqueUnit = insumoDoEstoque?.unidade ?? ft.unidade;
                          const fichaUnit = ft.unidade;
                          const totalQty = ft.gramagem * qtdItem;
                          let finalQty = totalQty;
                          if (fichaUnit !== estoqueUnit) {
                            const converted = convertUnit(totalQty, fichaUnit, estoqueUnit);
                            if (converted !== null) finalQty = converted;
                          }
                          return (
                            <button
                              key={ft.id}
                              onClick={() => toggleInsumoSelecionado(ft.id)}
                              className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all cursor-pointer text-left ${
                                sel ? 'border-red-500/50 bg-red-500/10' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                              }`}
                            >
                              <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${sel ? 'bg-red-500 border-red-500' : 'border-zinc-600'}`}>
                                {sel && <i className="ri-check-line text-white text-[10px]" />}
                              </div>
                              <span className="text-sm text-zinc-300 flex-1 truncate">{ft.insumoNome}</span>
                              <span className="text-[10px] text-zinc-500 flex-shrink-0">
                                {ft.gramagem} {fichaUnit} × {qtdItem}
                              </span>
                              <span className="text-xs text-red-400 font-semibold flex-shrink-0">
                                {finalQty.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {estoqueUnit}
                                {fichaUnit !== estoqueUnit && (
                                  <span className="text-zinc-500 font-normal ml-1">({fichaUnit})</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {fichaCarregada.length === 0 && !fichaLoading && (
                        <p className="text-amber-400 text-xs mt-1">Este item não possui ficha técnica cadastrada. Use "Insumo Específico" para registrar a perda manualmente.</p>
                      )}
                      {fichaCarregada.length > 0 && insumosSelecionados.size === 0 && (
                        <p className="text-red-400 text-xs mt-1">Selecione ao menos um ingrediente</p>
                      )}
                    </div>
                  )}

                  {/* Preview da ficha (modo inteiro) */}
                  {!fichaLoading && modoItem === 'inteiro' && (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden">
                      <p className="text-zinc-500 text-[10px] px-3 py-2 border-b border-zinc-700 font-semibold uppercase tracking-wider">
                        Insumos que serão deduzidos
                      </p>
                      {fichaCarregada.length === 0 ? (
                        <p className="text-zinc-500 text-xs px-3 py-3 text-center">Este item não possui ficha técnica cadastrada.</p>
                      ) : (
                        fichaCarregada.map((ft) => {
                          const insumoDoEstoque = insumos.find((i) => i.id === ft.insumoId);
                          const estoqueUnit = insumoDoEstoque?.unidade ?? ft.unidade;
                          const fichaUnit = ft.unidade;
                          const totalQty = ft.gramagem * qtdItem;
                          let finalQty = totalQty;
                          if (fichaUnit !== estoqueUnit) {
                            const converted = convertUnit(totalQty, fichaUnit, estoqueUnit);
                            if (converted !== null) finalQty = converted;
                          }
                          return (
                            <div key={ft.id} className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 last:border-0 text-xs">
                              <span className="text-zinc-300">{ft.insumoNome}</span>
                              <span className="text-red-400 font-semibold">
                                {finalQty.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {estoqueUnit}
                                {fichaUnit !== estoqueUnit && (
                                  <span className="text-zinc-500 font-normal ml-1">({fichaUnit})</span>
                                )}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── STEP 2B: Insumo Específico ── */}
          {step === 2 && tipo === 'insumo' && (
            <div className="space-y-4">
              {!insumoSelecionado ? (
                <>
                  <p className="text-zinc-400 text-sm">Qual insumo foi descartado?</p>
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                    <i className="ri-search-line text-zinc-500 text-sm" />
                    <input
                      type="text"
                      value={buscaInsumo}
                      onChange={(e) => setBuscaInsumo(e.target.value)}
                      placeholder="Buscar insumo..."
                      className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
                    />
                  </div>
                  {insumos.length === 0 ? (
                    <div className="text-center py-8">
                      <i className="ri-flask-line text-3xl text-zinc-600 block mb-2" />
                      <p className="text-sm text-zinc-500">Nenhum insumo cadastrado.</p>
                      <p className="text-xs text-zinc-600 mt-1">Cadastre insumos no Estoque para usar este fluxo.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-72 overflow-y-auto">
                      {insumosFiltrados.map((ins) => (
                        <button
                          key={ins.id}
                          onClick={() => { setInsumoSelecionado(ins); setQtdInsumo(0); }}
                          className="w-full flex items-center gap-3 p-3 bg-zinc-900 hover:bg-zinc-700 border border-zinc-700 rounded-xl cursor-pointer transition-colors text-left"
                        >
                          <div className="w-8 h-8 flex items-center justify-center bg-zinc-700 rounded-lg flex-shrink-0">
                            <i className="ri-flask-line text-sm text-emerald-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">{ins.nome}</p>
                            <p className="text-zinc-500 text-[10px]">{ins.categoria || 'Sem categoria'} · Estoque: {ins.estoqueAtual} {ins.unidade}</p>
                          </div>
                          <span className="text-zinc-400 text-xs flex-shrink-0">{ins.unidade}</span>
                        </button>
                      ))}
                      {insumosFiltrados.length === 0 && (
                        <p className="text-center text-zinc-500 text-sm py-6">Nenhum insumo encontrado</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-3 bg-zinc-900 border border-emerald-500/40 rounded-xl">
                    <div className="w-10 h-10 flex items-center justify-center bg-zinc-700 rounded-xl flex-shrink-0">
                      <i className="ri-flask-line text-lg text-emerald-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-white font-bold text-sm">{insumoSelecionado.nome}</p>
                      <p className="text-zinc-400 text-[10px]">Estoque atual: {insumoSelecionado.estoqueAtual} {insumoSelecionado.unidade}</p>
                    </div>
                    <button
                      onClick={() => setInsumoSelecionado(null)}
                      className="text-zinc-500 hover:text-white cursor-pointer text-xs transition-colors whitespace-nowrap"
                    >
                      Trocar
                    </button>
                  </div>

                  <div>
                    <p className="text-zinc-400 text-xs mb-2">
                      Quantidade descartada ({insumoSelecionado.unidade})
                    </p>
                    <input
                      type="number"
                      value={qtdInsumo || ''}
                      onChange={(e) => setQtdInsumo(Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder={`Ex: 0.5 ${insumoSelecionado.unidade}`}
                      min="0"
                      step="0.1"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-red-500 transition-colors placeholder-zinc-600"
                    />
                    {qtdInsumo > insumoSelecionado.estoqueAtual && (
                      <p className="text-amber-400 text-xs mt-1">
                        Quantidade maior que o estoque atual ({insumoSelecionado.estoqueAtual} {insumoSelecionado.unidade}). O estoque ficará zerado.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── STEP 3: Motivo + Confirmação ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-zinc-400 text-sm mb-3">Resumo da perda</p>
                <div className="bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-zinc-700 flex items-center justify-between">
                    <span className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider">Insumos descartados</span>
                    <span className="text-red-400 text-xs font-bold">{itensPerda.length} insumo{itensPerda.length > 1 ? 's' : ''}</span>
                  </div>
                  {itensPerda.map((item, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 last:border-0">
                      <span className="text-zinc-300 text-xs">{item.insumoNome}</span>
                      <span className="text-red-400 text-xs font-bold">−{item.quantidade} {item.unidade}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-zinc-400 text-xs mb-2">Motivo do descarte <span className="text-red-400">*</span></p>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex: Hambúrguer queimado na grelha, Queijo vencido, Item preparado errado..."
                  rows={3}
                  maxLength={200}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:border-red-500 transition-colors placeholder-zinc-600"
                />
                <div className="flex justify-between items-center mt-1">
                  {motivo.trim().length < 3 && <p className="text-zinc-500 text-[10px]">Mínimo 3 caracteres</p>}
                  <span className="text-zinc-600 text-[10px] ml-auto">{motivo.length}/200</span>
                </div>
              </div>

              <div className="bg-zinc-900 rounded-xl px-4 py-3 border border-zinc-700">
                <p className="text-zinc-500 text-[10px]">Operador responsável</p>
                <p className="text-white text-sm font-semibold mt-0.5">{operador}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-zinc-700 flex-shrink-0">
          {step > 1 && (
            <button
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              Voltar
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-zinc-500 hover:text-zinc-300 text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <div className="flex-1" />
          {step < 3 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={!podeAvancar()}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              Próximo
            </button>
          ) : (
            <button
              onClick={handleConfirmar}
              disabled={!podeAvancar() || itensPerda.length === 0}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center gap-2"
            >
              <i className="ri-alert-line" />
              Registrar Perda
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
