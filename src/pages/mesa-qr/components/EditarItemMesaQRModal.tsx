import { useState, useEffect } from 'react';
import { scrollFocusedFieldIntoView } from '@/lib/scrollFocusIntoView';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';

interface CartItem {
  cartId: string;
  itemId: string;
  name: string;
  precoBase: number;
  precoTotal: number;
  quantidade: number;
  opcoes: { grupoNome: string; opcaoNome: string; precoAdicional: number; opcaoId?: string }[];
  observacoes: string[];
  observacaoLivre: string;
  skipKds: boolean;
  stationId: string | null;
}

interface CardapioItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  photo_url: string | null;
  category_id: string | null;
  sla_minutes: number | null;
  skip_kds: boolean | null;
  station_id: string | null;
  promotions?: Array<{ id: string; item_id: string; promotional_price: number; is_active: boolean }>;
}

interface OptionGroup {
  id: string;
  name: string;
  item_id: string;
  is_required: boolean;
  min_selections: number | null;
  max_selections: number | null;
}

interface OptionItem {
  id: string;
  name: string;
  option_group_id: string;
  additional_price: number;
  is_active: boolean;
}

interface PresetObservation {
  id: string;
  item_id: string;
  text: string;
}

interface UnidadeConfig {
  opcoesSelecionadas: Record<string, string[]>;
  obsSelecionadas: string[];
  obsLivre: string;
}

interface Props {
  cartItem: CartItem;
  items: CardapioItem[];
  optionGroups: OptionGroup[];
  options: OptionItem[];
  observations: PresetObservation[];
  opcoesIndisponiveisIds: string[];
  onSalvar: (updatedItem: CartItem) => void;
  onClose: () => void;
}

export default function EditarItemMesaQRModal(props: Props) {
  const cartItem = props.cartItem;
  const items = props.items;
  const optionGroups = props.optionGroups;
  const options = props.options;
  const observations = props.observations;
  const opcoesIndisponiveisIds = props.opcoesIndisponiveisIds;
  const onSalvar = props.onSalvar;
  const onClose = props.onClose;

  // Busca o item original do cardápio
  const itemOriginal = items.find(function (i) { return i.id === cartItem.itemId; });

  function gruposDoItem(itemId: string) {
    return optionGroups.filter(function (g) { return g.item_id === itemId; });
  }
  function opcoesDoGrupo(grupoId: string) {
    return options.filter(function (o) { return o.option_group_id === grupoId; });
  }
  function obsDoItem(itemId: string) {
    return observations.filter(function (o) { return o.item_id === itemId; });
  }

  // Reconstrói as configurações por unidade a partir do cartItem
  function reconstruirUnidades(): UnidadeConfig[] {
    if (!itemOriginal) return [{ opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' }];

    const grupos = gruposDoItem(cartItem.itemId);
    const cfg: UnidadeConfig = { opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' };

    // Mapeia opções de volta para o formato de seleção
    for (let gi = 0; gi < grupos.length; gi++) {
      const g = grupos[gi];
      const selOpcoes = cartItem.opcoes
        .filter(function (o) { return o.grupoNome === g.name; })
        .map(function (o) {
          const found = options.find(function (opt) { return opt.name === o.opcaoNome && opt.option_group_id === g.id; });
          return found ? found.id : (o.opcaoId || o.opcaoNome);
        })
        .filter(Boolean);
      if (selOpcoes.length > 0) {
        cfg.opcoesSelecionadas[g.id] = selOpcoes;
      }
    }

    cfg.obsSelecionadas = cartItem.observacoes.slice();
    cfg.obsLivre = cartItem.observacaoLivre || '';

    const unidades: UnidadeConfig[] = [];
    for (let i = 0; i < cartItem.quantidade; i++) {
      unidades.push({ ...cfg, opcoesSelecionadas: { ...cfg.opcoesSelecionadas }, obsSelecionadas: cfg.obsSelecionadas.slice(), obsLivre: cfg.obsLivre });
    }
    return unidades;
  }

  const [qtd, setQtd] = useState(cartItem.quantidade);
  const [unidadeAtiva, setUnidadeAtiva] = useState(0);
  const [unidades, setUnidades] = useState<UnidadeConfig[]>(reconstruirUnidades);
  const [modalVisible, setModalVisible] = useState(false);
  const [imgErro, setImgErro] = useState(false);
  const kbInset = useKeyboardInset();

  useEffect(function () {
    // Delay mínimo pra animação de entrada
    const t = setTimeout(function () { setModalVisible(true); }, 10);
    document.body.style.overflow = 'hidden';
    return function () {
      document.body.style.overflow = '';
      clearTimeout(t);
    };
  }, []);

  function fechar() {
    setModalVisible(false);
    setTimeout(function () { onClose(); }, 300);
  }

  function ajustarQtd(novaQtd: number) {
    const q = Math.max(1, novaQtd);
    setQtd(q);
    setUnidades(function (prev) {
      const arr = prev.slice();
      if (arr.length < q) {
        while (arr.length < q) {
          arr.push({ opcoesSelecionadas: {}, obsSelecionadas: [], obsLivre: '' });
        }
      } else if (arr.length > q) {
        arr.splice(q);
      }
      return arr;
    });
    if (unidadeAtiva >= q) {
      setUnidadeAtiva(0);
    }
  }

  function toggleOpcao(unidadeIdx: number, grupoId: string, opId: string, maxSel: number | null) {
    setUnidades(function (prev) {
      const arr = prev.slice();
      const cfg = arr[unidadeIdx];
      const atual = cfg.opcoesSelecionadas[grupoId] || [];
      if (atual.includes(opId)) {
        arr[unidadeIdx] = {
          ...cfg,
          opcoesSelecionadas: { ...cfg.opcoesSelecionadas, [grupoId]: atual.filter(function (id) { return id !== opId; }) },
        };
        return arr;
      }
      const max = maxSel !== null ? maxSel : 1;
      if (atual.length >= max) {
        arr[unidadeIdx] = {
          ...cfg,
          opcoesSelecionadas: { ...cfg.opcoesSelecionadas, [grupoId]: atual.slice(1).concat([opId]) },
        };
        return arr;
      }
      arr[unidadeIdx] = {
        ...cfg,
        opcoesSelecionadas: { ...cfg.opcoesSelecionadas, [grupoId]: atual.concat([opId]) },
      };
      return arr;
    });
  }

  function toggleObs(unidadeIdx: number, text: string) {
    setUnidades(function (prev) {
      const arr = prev.slice();
      const cfg = arr[unidadeIdx];
      if (cfg.obsSelecionadas.includes(text)) {
        arr[unidadeIdx] = { ...cfg, obsSelecionadas: cfg.obsSelecionadas.filter(function (t) { return t !== text; }) };
      } else {
        arr[unidadeIdx] = { ...cfg, obsSelecionadas: cfg.obsSelecionadas.concat([text]) };
      }
      return arr;
    });
  }

  function setObsLivre(unidadeIdx: number, val: string) {
    setUnidades(function (prev) {
      const arr = prev.slice();
      arr[unidadeIdx] = { ...arr[unidadeIdx], obsLivre: val };
      return arr;
    });
  }

  function getPrecoEfetivo() {
    if (!itemOriginal) return cartItem.precoBase;
    const promoAtiva = (itemOriginal.promotions || []).find(function (p) { return p.is_active; });
    return promoAtiva ? promoAtiva.promotional_price : itemOriginal.price;
  }

  function calcularPreco(cfg: UnidadeConfig): number {
    if (!itemOriginal) return cartItem.precoBase;
    let extra = 0;
    const grupos = gruposDoItem(cartItem.itemId);
    for (let gi = 0; gi < grupos.length; gi++) {
      const g = grupos[gi];
      const sel = cfg.opcoesSelecionadas[g.id] || [];
      for (let si = 0; si < sel.length; si++) {
        const op = options.find(function (o) { return o.id === sel[si]; });
        if (op) extra += op.additional_price;
      }
    }
    return getPrecoEfetivo() + extra;
  }

  function calcularPrecoTotal() {
    let total = 0;
    for (let i = 0; i < unidades.length; i++) {
      total += calcularPreco(unidades[i]);
    }
    return total;
  }

  function handleSalvar() {
    if (!itemOriginal) return;
    let precoTotalGeral = 0;
    const allOpcoes: CartItem['opcoes'] = [];
    const allObsTag: string[] = [];
    const allObsLivre: string[] = [];

    for (let i = 0; i < unidades.length; i++) {
      const cfg = unidades[i];
      precoTotalGeral += calcularPreco(cfg);
      const grupos = gruposDoItem(cartItem.itemId);
      for (let gi = 0; gi < grupos.length; gi++) {
        const g = grupos[gi];
        const sel = cfg.opcoesSelecionadas[g.id] || [];
        for (let si = 0; si < sel.length; si++) {
          const op = options.find(function (o) { return o.id === sel[si]; });
          if (op) {
            allOpcoes.push({ opcaoId: op.id, grupoNome: g.name, opcaoNome: op.name, precoAdicional: op.additional_price, obrigatorio: g.is_required });
          }
        }
      }
      // Junta todas as observações
      for (let oi = 0; oi < cfg.obsSelecionadas.length; oi++) {
        if (!allObsTag.includes(cfg.obsSelecionadas[oi])) {
          allObsTag.push(cfg.obsSelecionadas[oi]);
        }
      }
      if (cfg.obsLivre.trim()) {
        allObsLivre.push(cfg.obsLivre.trim());
      }
    }

    const precoMedio = unidades.length > 0 ? precoTotalGeral / unidades.length : getPrecoEfetivo();

    const updated: CartItem = {
      ...cartItem,
      quantidade: qtd,
      precoBase: getPrecoEfetivo(),
      precoTotal: precoMedio,
      opcoes: allOpcoes,
      observacoes: allObsTag,
      observacaoLivre: allObsLivre.join(' | '),
    };

    onSalvar(updated);
    fechar();
  }

  if (!itemOriginal) {
    return null;
  }

  const cfgAtual = unidades[unidadeAtiva];
  const hasOptions = gruposDoItem(cartItem.itemId).length > 0;
  const hasObservations = obsDoItem(cartItem.itemId).length > 0;

  return (
    <div
      className={'fixed inset-0 z-50 flex items-end justify-center transition-opacity duration-300 ' +
        (modalVisible ? 'opacity-100' : 'opacity-0 pointer-events-none')}
      style={{ paddingBottom: kbInset }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={fechar} />

      <div
        className={'relative w-full max-w-lg bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto transition-transform duration-300 ' +
          (modalVisible ? 'translate-y-0' : 'translate-y-full')}
        style={{ scrollbarWidth: 'thin' }}
        onFocus={scrollFocusedFieldIntoView}
      >
        {/* Header sticky */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-zinc-100 px-5 py-3 flex items-center justify-between z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                Editando
              </span>
            </div>
            <h3 className="text-base font-bold text-zinc-800 truncate mt-1">{itemOriginal.name}</h3>
            {getPrecoEfetivo() < itemOriginal.price ? (
              <p className="text-xs text-zinc-500 mt-0.5">
                <span className="line-through text-zinc-300">R$ {itemOriginal.price.toFixed(2)}</span>
                {' '}
                <span className="text-red-500 font-bold">R$ {getPrecoEfetivo().toFixed(2)}</span>
              </p>
            ) : (
              <p className="text-xs text-zinc-500 mt-0.5">R$ {itemOriginal.price.toFixed(2)}</p>
            )}
          </div>
          <button
            type="button"
            onClick={fechar}
            className="w-9 h-9 flex items-center justify-center bg-zinc-100 rounded-full text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200 transition-colors cursor-pointer shrink-0 ml-3"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Imagem */}
        {(itemOriginal.photo_url && !imgErro) ? (
          <div className="px-5 pt-4">
            <div className="w-full h-40 rounded-xl overflow-hidden bg-zinc-100">
              <img
                src={itemOriginal.photo_url}
                alt={itemOriginal.name}
                className="w-full h-full object-cover object-top"
                onError={function () { setImgErro(true); }}
              />
            </div>
          </div>
        ) : null}

        <div className="px-5 py-4 space-y-5">
          {itemOriginal.description ? (
            <p className="text-sm text-zinc-600 leading-relaxed">{itemOriginal.description}</p>
          ) : null}

          {/* Quantidade */}
          <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
            <span className="text-sm font-bold text-zinc-800">Quantidade</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={function () { ajustarQtd(qtd - 1); }}
                className="w-9 h-9 flex items-center justify-center bg-white rounded-full text-zinc-600 cursor-pointer hover:bg-zinc-200 transition-colors border border-zinc-100"
              >
                <i className="ri-subtract-line" />
              </button>
              <span className="text-sm font-bold text-zinc-800 w-5 text-center">{qtd}</span>
              <button
                type="button"
                onClick={function () { ajustarQtd(qtd + 1); }}
                className="w-9 h-9 flex items-center justify-center bg-zinc-900 rounded-full text-white cursor-pointer hover:bg-zinc-800 transition-colors"
              >
                <i className="ri-add-line" />
              </button>
            </div>
          </div>

          {/* Seletor de unidade (quando qtd > 1) */}
          {qtd > 1 ? (
            <div>
              <span className="text-sm font-bold text-zinc-800 block mb-2">Personalizar por unidade</span>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                {unidades.map(function (_, idx) {
                  const hasCustom = Object.keys(unidades[idx].opcoesSelecionadas).length > 0 ||
                    unidades[idx].obsSelecionadas.length > 0 ||
                    unidades[idx].obsLivre.trim().length > 0;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={function () { setUnidadeAtiva(idx); }}
                      className={'shrink-0 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer whitespace-nowrap transition-colors border ' +
                        (unidadeAtiva === idx
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200')
                      }
                    >
                      Un. {idx + 1}
                      {hasCustom ? (
                        <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-300 align-middle" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {unidadeAtiva >= 0 ? (
                <p className="text-[10px] text-amber-600 mt-1.5 font-medium">
                  Editando unidade {unidadeAtiva + 1} de {qtd}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Opções */}
          {hasOptions ? (
            <div className="space-y-4">
              {gruposDoItem(cartItem.itemId).map(function (grupo) {
                return (
                  <div key={grupo.id}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-bold text-zinc-800">{grupo.name}</span>
                      {grupo.is_required ? (
                        <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100">
                          Obrigatório
                        </span>
                      ) : null}
                      {(grupo.max_selections && grupo.max_selections > 1) ? (
                        <span className="text-[10px] text-zinc-400">Máx {grupo.max_selections}</span>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      {opcoesDoGrupo(grupo.id).map(function (op) {
                        const sel = cfgAtual.opcoesSelecionadas[grupo.id] || [];
                        const checked = sel.includes(op.id);
                        const esgotada = opcoesIndisponiveisIds.includes(op.id);
                        return (
                          <label
                            key={op.id}
                            className={'flex items-center gap-3 px-3.5 py-3 rounded-xl transition-colors border ' +
                              (esgotada
                                ? 'opacity-50 cursor-not-allowed bg-zinc-50 border-zinc-100'
                                : checked
                                  ? 'bg-amber-50 border-amber-200 cursor-pointer'
                                  : 'bg-zinc-50 border-transparent hover:bg-zinc-100 cursor-pointer')
                            }
                          >
                            <div className="relative flex items-center justify-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={esgotada}
                                onChange={esgotada ? undefined : function () { toggleOpcao(unidadeAtiva, grupo.id, op.id, grupo.max_selections); }}
                                className="w-5 h-5 accent-amber-500 rounded disabled:cursor-not-allowed"
                              />
                            </div>
                            <span className={'flex-1 text-sm ' + (esgotada ? 'text-zinc-400 line-through' : 'text-zinc-700')}>{op.name}</span>
                            {esgotada ? (
                              <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                Esgotado
                              </span>
                            ) : op.additional_price > 0 ? (
                              <span className="text-xs font-bold text-amber-600">
                                + R$ {op.additional_price.toFixed(2)}
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Observações predefinidas */}
          {hasObservations ? (
            <div>
              <span className="text-sm font-bold text-zinc-800 block mb-3">Observações</span>
              <div className="flex flex-wrap gap-2">
                {obsDoItem(cartItem.itemId).map(function (obs) {
                  const checked = cfgAtual.obsSelecionadas.includes(obs.text);
                  return (
                    <button
                      key={obs.id}
                      type="button"
                      onClick={function () { toggleObs(unidadeAtiva, obs.text); }}
                      className={'px-3.5 py-2 rounded-full text-xs font-bold cursor-pointer transition-colors border ' +
                        (checked
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-zinc-100 text-zinc-600 border-zinc-100 hover:bg-zinc-200')
                      }
                    >
                      {obs.text}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Observação livre */}
          <div>
            <span className="text-sm font-bold text-zinc-800 block mb-2">
              {qtd > 1 ? 'Outra observação (Un. ' + (unidadeAtiva + 1) + ')' : 'Outra observação'}
            </span>
            <textarea
              value={cfgAtual.obsLivre}
              onChange={function (e) { setObsLivre(unidadeAtiva, e.target.value.slice(0, 150)); }}
              placeholder="Ex: sem cebola, bem passado..."
              className="w-full px-3.5 py-3 border border-zinc-100 rounded-xl text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 resize-none bg-zinc-50"
              rows={2}
              maxLength={150}
            />
            <p className="text-[10px] text-zinc-400 text-right mt-1">{cfgAtual.obsLivre.length}/150</p>
          </div>
        </div>

        {/* Footer sticky */}
        <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-zinc-100 px-5 py-3 flex gap-3">
          <button
            type="button"
            onClick={fechar}
            className="flex-1 py-3.5 bg-zinc-100 text-zinc-600 text-sm font-bold rounded-xl hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            className="flex-[2] flex items-center justify-center gap-2 bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white px-5 py-3.5 rounded-xl cursor-pointer transition-all text-sm font-bold whitespace-nowrap"
          >
            <i className="ri-save-line" />
            Salvar • R$ {calcularPrecoTotal().toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}