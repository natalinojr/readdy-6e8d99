import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, X, Check, ChevronRight, Minus } from 'lucide-react';
import type { ItemCardapioPublico, ItemPedidoCliente } from '@/types/mesaCliente';
import { useCardapio } from '../../../contexts/CardapioContext';
import { useEstoque } from '../../../contexts/EstoqueContext';
import ItemImage from '../../../components/base/ItemImage';
import { useItensSemEstoque } from '@/hooks/useItensSemEstoque';

// ── Teclado virtual para observações ──────────────────────────────────────────
const LETRAS_KB = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
];
const NUMEROS_KB = ['1','2','3','4','5','6','7','8','9','0'];

interface TecladoVirtualProps {
  value: string;
  onChange: (v: string) => void;
}

function TecladoVirtual({ value, onChange }: TecladoVirtualProps) {
  const [modo, setModo] = useState<'letras' | 'numeros'>('letras');

  return (
    <div>
      {/* Display */}
      <div className="flex items-center justify-between mb-3">
        <div className={`flex-1 min-h-[3rem] bg-zinc-800 text-white text-base font-semibold rounded-xl px-4 py-2.5 border-2 transition-colors mr-3 ${value ? 'border-amber-500/40' : 'border-transparent'}`}>
          {value || <span className="text-zinc-600 font-normal text-sm">Ex: sem cebola, molho à parte...</span>}
        </div>
        <div className="flex items-center gap-1 bg-zinc-800 rounded-xl p-1 flex-shrink-0">
          <button onClick={() => setModo('letras')}
            className={`px-3 py-2 text-sm font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${modo === 'letras' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>
            ABC
          </button>
          <button onClick={() => setModo('numeros')}
            className={`px-3 py-2 text-sm font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${modo === 'numeros' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>
            123
          </button>
        </div>
      </div>

      {/* Teclado */}
      {modo === 'letras' ? (
        <div>
          {/* Number row */}
          <div className="flex justify-center gap-1 mb-1.5">
            {NUMEROS_KB.map((n) => (
              <button key={n} onClick={() => onChange(value + n)}
                className="w-10 h-10 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-sm rounded-lg cursor-pointer active:scale-90 transition-all">
                {n}
              </button>
            ))}
          </div>
          {LETRAS_KB.map((linha, li) => (
            <div key={li} className="flex justify-center gap-1 mb-1.5">
              {li === 2 && (
                <button onClick={() => onChange(value.slice(0, -1))}
                  className="w-12 h-10 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-400 rounded-lg cursor-pointer active:scale-95 transition-all">
                  <i className="ri-delete-back-2-line text-base" />
                </button>
              )}
              {linha.map((letra) => (
                <button key={letra} onClick={() => onChange(value + letra)}
                  className="w-10 h-10 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-sm rounded-lg cursor-pointer active:scale-90 transition-all">
                  {letra}
                </button>
              ))}
              {li === 2 && (
                <button onClick={() => onChange('')}
                  className="w-12 h-10 flex items-center justify-center bg-zinc-700 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 rounded-lg cursor-pointer active:scale-95 transition-all">
                  <i className="ri-delete-bin-line text-base" />
                </button>
              )}
            </div>
          ))}
          <div className="flex justify-center gap-2 mt-1">
            <button onClick={() => onChange(value + ' ')}
              className="px-12 h-10 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-sm rounded-lg cursor-pointer active:scale-95 transition-all whitespace-nowrap">
              Espaço
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex justify-center gap-1 mb-1.5 flex-wrap">
            {NUMEROS_KB.map((n) => (
              <button key={n} onClick={() => onChange(value + n)}
                className="w-14 h-12 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-lg rounded-lg cursor-pointer active:scale-90 transition-all">
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-center gap-2 mt-1">
            {[' ', ',', '.', '-', '/'].map((c) => (
              <button key={c} onClick={() => onChange(value + c)}
                className="w-14 h-12 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-base rounded-lg cursor-pointer active:scale-95 transition-all">
                {c === ' ' ? '␣' : c}
              </button>
            ))}
            <button onClick={() => onChange(value.slice(0, -1))}
              className="px-6 h-12 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-400 rounded-lg cursor-pointer active:scale-95 transition-all">
              <i className="ri-delete-back-2-line text-lg" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface OpcoesKioskProps {
  item: ItemCardapioPublico;
  onAdicionar: (pedido: Omit<ItemPedidoCliente, 'enviadoKds'>) => void;
  onClose: () => void;
}

function OpcoesKiosk({ item, onAdicionar, onClose }: OpcoesKioskProps) {
  const [qtd, setQtd] = useState(1);
  const [selecionadas, setSelecionadas] = useState<Record<string, string[]>>({});
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [mostrarScrollHint, setMostrarScrollHint] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const isBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
      setMostrarScrollHint(!isBottom);
    };
    el.addEventListener('scroll', onScroll);
    onScroll(); // check inicial
    return () => el.removeEventListener('scroll', onScroll);
  }, [item]);

  const toggleOpcao = (grupo: string, opcao: string, obrigatorio: boolean) => {
    setSelecionadas((prev) => {
      const atual = prev[grupo] ?? [];
      if (obrigatorio) return { ...prev, [grupo]: [opcao] };
      if (atual.includes(opcao)) return { ...prev, [grupo]: atual.filter((o) => o !== opcao) };
      return { ...prev, [grupo]: [...atual, opcao] };
    });
  };

  const totalOpcoes = Object.entries(selecionadas).reduce((sum, [grupo, selected]) => {
    const grp = item.opcoes?.find((g) => g.grupo === grupo);
    return sum + selected.reduce((s, o) => {
      const it = grp?.itens.find((i) => i.nome === o);
      return s + (it?.precoAdicional ?? 0);
    }, 0);
  }, 0);

  const total = (item.preco + totalOpcoes) * qtd;

  const handleAdicionar = () => {
    const obrigatorios = item.opcoes?.filter((g) => g.obrigatorio) ?? [];
    for (const g of obrigatorios) {
      if (!selecionadas[g.grupo]?.length) { setErro(`Escolha: ${g.grupo}`); return; }
    }
    onAdicionar({ itemId: item.id, nome: item.nome, categoria: item.categoria, preco: item.preco + totalOpcoes, quantidade: qtd, opcoesSelecionadas: Object.values(selecionadas).flat(), observacao: obs, clienteNome: 'Kiosk', semPreparo: item.semPreparo ?? false, stationId: item.stationId ?? null });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="bg-zinc-900 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <style>{`
          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
        `}</style>

          <div className="relative h-56 flex-shrink-0">
            <ItemImage src={item.foto} alt={item.nome} className="w-full h-full" imgClassName="object-contain" />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
            <button onClick={onClose} className="absolute top-3 right-3 w-12 h-12 flex items-center justify-center bg-zinc-800/90 rounded-xl cursor-pointer hover:bg-zinc-700 transition-colors">
              <X size={22} className="text-white" />
            </button>
            <div className="absolute bottom-3 left-5">
              <h2 className="text-2xl font-black text-white">{item.nome}</h2>
              <p className="text-zinc-400 text-base">{item.descricao}</p>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-5 relative no-scrollbar">
            {item.opcoes?.map((grupo) => (
              <div key={grupo.grupo}>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-lg font-bold text-white">{grupo.grupo}</h3>
                  {grupo.obrigatorio && <span className="text-sm font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">Obrigatório</span>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {grupo.itens.map((opcao) => {
                    const sel = selecionadas[grupo.grupo]?.includes(opcao.nome);
                    return (
                      <button key={opcao.nome} onClick={() => toggleOpcao(grupo.grupo, opcao.nome, grupo.obrigatorio)}
                        className={`flex items-center justify-between px-4 py-4 rounded-xl border-2 transition-all cursor-pointer ${sel ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'border-amber-500 bg-amber-500' : 'border-zinc-600'}`}>
                            {sel && <Check size={14} className="text-white" />}
                          </div>
                          <span className="text-base font-semibold text-white">{opcao.nome}</span>
                        </div>
                        {opcao.precoAdicional > 0 && <span className="text-base font-bold text-amber-400">+{fmt(opcao.precoAdicional)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {item.observacoesPadrao && item.observacoesPadrao.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-white mb-2">Observações</h3>
                <div className="flex flex-wrap gap-2">
                  {item.observacoesPadrao.map((obsPadrao) => {
                    const ativa = obs.split('; ').filter(Boolean).includes(obsPadrao);
                    return (
                      <button
                        key={obsPadrao}
                        onClick={() => {
                          setObs((prev) => {
                            const partes = prev.split('; ').filter(Boolean);
                            if (partes.includes(obsPadrao)) {
                              return partes.filter((p) => p !== obsPadrao).join('; ');
                            }
                            return prev ? `${prev}; ${obsPadrao}` : obsPadrao;
                          });
                        }}
                        className={`px-4 py-2 rounded-lg text-base font-semibold transition-all cursor-pointer whitespace-nowrap ${
                          ativa
                            ? 'bg-amber-500 text-zinc-950'
                            : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-500'
                        }`}
                      >
                        {ativa && <i className="ri-check-line mr-1" />}
                        {obsPadrao}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {item.observacoesPadrao && item.observacoesPadrao.length > 0 && (
              <div className="border-t border-zinc-800 pt-4">
                <h3 className="text-base font-bold text-zinc-500 mb-3 uppercase tracking-wider">Outra observação</h3>
                <TecladoVirtual value={obs} onChange={setObs} />
              </div>
            )}

            {(!item.observacoesPadrao || item.observacoesPadrao.length === 0) && (
              <div>
                <h3 className="text-lg font-bold text-white mb-2">Observações (opcional)</h3>
                <TecladoVirtual value={obs} onChange={setObs} />
              </div>
            )}

            {/* Hint de scroll — mostra só quando não está no final */}
            {mostrarScrollHint && (
              <div className="flex flex-col items-center gap-1 pb-1">
                <div className="w-8 h-1 bg-zinc-700 rounded-full" />
                <p className="text-zinc-600 text-sm font-semibold flex items-center gap-1">
                  <i className="ri-arrow-down-line animate-bounce" />
                  Role para baixo
                </p>
              </div>
            )}
          </div>

          {erro && <p className="px-6 text-base text-red-400 font-semibold">{erro}</p>}

          <div className="p-6 border-t border-zinc-800 flex items-center gap-4">
            <div className="flex items-center gap-4 bg-zinc-800 rounded-2xl px-4 py-3">
              <button onClick={() => setQtd((q) => Math.max(1, q - 1))} className="w-12 h-12 flex items-center justify-center rounded-xl bg-zinc-700 hover:bg-zinc-600 cursor-pointer transition-colors">
                <Minus size={18} className="text-white" />
              </button>
              <span className="text-xl font-black text-white w-10 text-center">{qtd}</span>
              <button onClick={() => setQtd((q) => q + 1)} className="w-12 h-12 flex items-center justify-center rounded-xl bg-amber-500 hover:bg-amber-400 cursor-pointer transition-colors">
                <Plus size={18} className="text-zinc-950" />
              </button>
            </div>
            <button onClick={handleAdicionar}
              className="flex-1 flex items-center justify-between bg-amber-500 hover:bg-amber-400 text-zinc-950 px-6 py-4 rounded-2xl font-black text-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
              <span>Adicionar</span>
              <span>{fmt(total)}</span>
            </button>
          </div>
        </div>
    </div>
  );
}

interface CardapioKioskProps {
  carrinho: ItemPedidoCliente[];
  onAdicionar: (item: Omit<ItemPedidoCliente, 'enviadoKds'>) => void;
  onDiminuir: (itemId: string) => void;
  onVerCarrinho: () => void;
}

export default function CardapioKiosk({ carrinho, onAdicionar, onDiminuir, onVerCarrinho }: CardapioKioskProps) {
  const { itensPublicos, categorias: categoriasCtx } = useCardapio();
  const { itensDesabilitadosIds } = useEstoque();
  const { mapaItens: itensSemEstoque } = useItensSemEstoque();

  // Filtra itens que têm insumo zerado — no kiosk eles simplesmente não aparecem
  const itensDisponiveis = useMemo(
    () => itensPublicos.filter((i) => {
      if (itensDesabilitadosIds.includes(i.id)) return false;
      if (itensSemEstoque.has(i.id)) return false;
      return true;
    }),
    [itensPublicos, itensDesabilitadosIds, itensSemEstoque],
  );

  const categorias = useMemo(
    () => {
      const nomesUnicos = Array.from(new Set(itensDisponiveis.map((i) => i.categoria)));
      // Ordena pelo sortOrder das categorias do cardápio (contexto)
      const ordemMap = new Map(categoriasCtx.map((c, idx) => [c.nome, c.ordem ?? idx]));
      return nomesUnicos.sort((a, b) => {
        const oa = ordemMap.get(a) ?? 9999;
        const ob = ordemMap.get(b) ?? 9999;
        // Combos sempre no final
        if (a === 'Combos') return 1;
        if (b === 'Combos') return -1;
        return oa - ob;
      });
    },
    [itensDisponiveis, categoriasCtx],
  );

  const [categoriaAtiva, setCategoriaAtiva] = useState<string>('');
  const [itemModal, setItemModal] = useState<ItemCardapioPublico | null>(null);

  // Se ainda não tem categoria ativa (inicial ou depois de filtrar tudo), seleciona a primeira
  const categoriaEfetiva = categoriaAtiva || categorias[0] || '';

  const itens = categoriaEfetiva === '' ? itensDisponiveis : itensDisponiveis.filter((i) => i.categoria === categoriaEfetiva);
  const totalItens = carrinho.reduce((s, i) => s + i.quantidade, 0);
  const totalValor = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);

  const qtdNoCarrinho = (id: string) => carrinho.filter((i) => i.itemId === id).reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="flex h-full">
      {/* Sidebar categorias */}
      <div className="w-56 flex-shrink-0 bg-zinc-950 flex flex-col py-4 gap-1 overflow-y-auto border-r border-zinc-800">
        {categorias.map((cat) => (
          <button key={cat} onClick={() => setCategoriaAtiva(cat)}
            className={`mx-2 px-4 py-6 rounded-2xl text-lg font-bold transition-all cursor-pointer text-left ${categoriaEfetiva === cat ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
            {cat}
          </button>
        ))}
      </div>

      {/* Lista de itens */}
      <div className="flex-1 overflow-y-auto p-6 pb-32">
        <div className="flex flex-col gap-4">
          {itens.map((item) => {
            const qtd = qtdNoCarrinho(item.id);
            const esgotado = itensDesabilitadosIds.includes(item.id);
            const handleClick = () => {
              const semOpcoes = !item.opcoes || item.opcoes.length === 0;
              const semObsPreConfiguradas = !item.observacoesPadrao || item.observacoesPadrao.length === 0;
              if (item.isCombo || (semOpcoes && semObsPreConfiguradas)) {
                onAdicionar({
                  itemId: item.id,
                  nome: item.nome,
                  categoria: item.categoria,
                  preco: item.preco,
                  quantidade: 1,
                  opcoesSelecionadas: [],
                  observacao: '',
                  clienteNome: 'Kiosk',
                  semPreparo: item.semPreparo ?? false,
                  stationId: item.stationId ?? null,
                });
              } else {
                setItemModal(item);
              }
            };
            const handleDiminuirClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              onDiminuir(item.id);
            };
            return (
              <button
                key={item.id}
                onClick={handleClick}
                disabled={esgotado}
                className={`flex items-center gap-4 bg-zinc-800 rounded-2xl p-3 text-left transition-all ${esgotado ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-zinc-750 active:scale-[0.99]'}`}
              >
                {/* Imagem */}
                <div className="w-36 h-36 flex-shrink-0 relative rounded-xl overflow-hidden bg-zinc-900">
                  <ItemImage
                    src={item.foto}
                    alt={item.nome}
                    className="w-full h-full"
                    imgClassName="object-contain"
                    esgotado={esgotado}
                  />
                  {item.isCombo && !esgotado && (
                    <span className="absolute top-2 left-2 bg-emerald-500 text-white text-sm font-black px-3 py-1 rounded-full">COMBO</span>
                  )}
                  {item.popular && !esgotado && !item.isCombo && (
                    <span className="absolute top-2 left-2 bg-amber-500 text-zinc-950 text-sm font-black px-3 py-1 rounded-full">TOP</span>
                  )}
                  {esgotado && (
                    <div className="absolute inset-0 bg-red-900/50 flex items-center justify-center">
                      <span className="text-white text-base font-black bg-red-600 px-4 py-1.5 rounded-full">ESGOTADO</span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className={`font-bold text-xl leading-tight ${esgotado ? 'text-zinc-500' : 'text-white'}`}>{item.nome}</p>
                  <p className="text-zinc-500 text-base mt-1 line-clamp-2">{item.descricao}</p>
                  <p className={`font-black text-2xl mt-1.5 ${esgotado ? 'text-zinc-600' : 'text-amber-400'}`}>{fmt(item.preco)}</p>
                </div>

                {/* Controles */}
                {!esgotado && (
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {qtd > 0 && (
                      <button
                        onClick={handleDiminuirClick}
                        className="w-14 h-14 flex items-center justify-center bg-amber-500 hover:bg-amber-400 rounded-xl cursor-pointer transition-colors"
                      >
                        <Minus size={20} className="text-zinc-950" />
                      </button>
                    )}
                    {qtd > 0 && (
                      <span className="w-14 h-14 flex items-center justify-center bg-zinc-800 text-white text-lg font-black rounded-xl">
                        {qtd}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClick();
                      }}
                      className="w-14 h-14 flex items-center justify-center bg-amber-500 hover:bg-amber-400 rounded-xl cursor-pointer transition-colors"
                    >
                      <Plus size={22} className="text-zinc-950" />
                    </button>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Barra inferior */}
      {totalItens > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800 z-20">
          <button onClick={onVerCarrinho}
            className="w-full flex items-center justify-between bg-amber-500 hover:bg-amber-400 text-zinc-950 px-12 py-7 rounded-2xl cursor-pointer active:scale-[0.99] transition-all">
            <div className="flex items-center gap-4">
              <span className="w-12 h-12 flex items-center justify-center bg-zinc-950/15 rounded-xl text-lg font-black">{totalItens}</span>
              <span className="text-3xl font-black">Ver Pedido</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-black">{fmt(totalValor)}</span>
              <div className="w-12 h-12 flex items-center justify-center"><ChevronRight size={26} /></div>
            </div>
          </button>
        </div>
      )}

      {itemModal && <OpcoesKiosk item={itemModal} onAdicionar={onAdicionar} onClose={() => setItemModal(null)} />}
    </div>
  );
}