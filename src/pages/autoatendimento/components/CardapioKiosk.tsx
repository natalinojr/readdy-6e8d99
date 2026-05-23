import { useState, useMemo } from 'react';
import { Plus, X, Check, Clock, ChevronRight, Minus } from 'lucide-react';
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
      <div className="flex items-center justify-between mb-2">
        <div className={`flex-1 min-h-[2.8rem] bg-zinc-800 text-white text-base font-semibold rounded-xl px-4 py-2.5 border-2 transition-colors mr-3 ${value ? 'border-amber-500/40' : 'border-transparent'}`}>
          {value || <span className="text-zinc-600 font-normal text-sm">Ex: sem cebola, molho à parte...</span>}
        </div>
        <div className="flex items-center gap-1 bg-zinc-800 rounded-xl p-1 flex-shrink-0">
          <button onClick={() => setModo('letras')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${modo === 'letras' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>
            ABC
          </button>
          <button onClick={() => setModo('numeros')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${modo === 'numeros' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>
            123
          </button>
        </div>
      </div>

      {/* Teclado */}
      {modo === 'letras' ? (
        <div>
          {LETRAS_KB.map((linha, li) => (
            <div key={li} className="flex justify-center gap-1 mb-1">
              {linha.map((letra) => (
                <button key={letra} onClick={() => onChange(value + letra)}
                  className="w-9 h-9 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-xs rounded-lg cursor-pointer active:scale-90 transition-all">
                  {letra}
                </button>
              ))}
            </div>
          ))}
          <div className="flex justify-center gap-2 mt-1.5">
            <button onClick={() => onChange(value + ' ')}
              className="px-10 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-xs rounded-lg cursor-pointer active:scale-95 transition-all whitespace-nowrap">
              Espaço
            </button>
            <button onClick={() => onChange(value.slice(0, -1))}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg cursor-pointer active:scale-95 transition-all">
              <i className="ri-delete-back-2-line text-sm" />
            </button>
            <button onClick={() => onChange('')}
              className="px-4 py-2 bg-zinc-700 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 rounded-lg cursor-pointer active:scale-95 transition-all">
              <i className="ri-delete-bin-line text-sm" />
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex justify-center gap-1 mb-1 flex-wrap">
            {NUMEROS_KB.map((n) => (
              <button key={n} onClick={() => onChange(value + n)}
                className="w-11 h-11 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-base rounded-lg cursor-pointer active:scale-90 transition-all">
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-center gap-2 mt-1.5">
            {[' ', ',', '.', '-', '/'].map((c) => (
              <button key={c} onClick={() => onChange(value + c)}
                className="w-11 h-9 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-sm rounded-lg cursor-pointer active:scale-95 transition-all">
                {c === ' ' ? '␣' : c}
              </button>
            ))}
            <button onClick={() => onChange(value.slice(0, -1))}
              className="px-4 h-9 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-400 rounded-lg cursor-pointer active:scale-95 transition-all">
              <i className="ri-delete-back-2-line text-sm" />
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
    onAdicionar({ itemId: item.id, nome: item.nome, categoria: item.categoria, preco: item.preco + totalOpcoes, quantidade: qtd, opcoesSelecionadas: Object.values(selecionadas).flat(), observacao: obs, clienteNome: 'Kiosk', semPreparo: item.semPreparo ?? false });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="bg-zinc-900 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="relative h-48 flex-shrink-0">
          <ItemImage src={item.foto} alt={item.nome} className="w-full h-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
          <button onClick={onClose} className="absolute top-4 right-4 w-12 h-12 flex items-center justify-center bg-zinc-800/90 rounded-2xl cursor-pointer hover:bg-zinc-700 transition-colors">
            <X size={20} className="text-white" />
          </button>
          <div className="absolute bottom-4 left-6">
            <h2 className="text-2xl font-black text-white">{item.nome}</h2>
            <p className="text-zinc-400 text-sm">{item.descricao}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {item.opcoes?.map((grupo) => (
            <div key={grupo.grupo}>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-base font-bold text-white">{grupo.grupo}</h3>
                {grupo.obrigatorio && <span className="text-xs font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">Obrigatório</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {grupo.itens.map((opcao) => {
                  const sel = selecionadas[grupo.grupo]?.includes(opcao.nome);
                  return (
                    <button key={opcao.nome} onClick={() => toggleOpcao(grupo.grupo, opcao.nome, grupo.obrigatorio)}
                      className={`flex items-center justify-between px-4 py-4 rounded-2xl border-2 transition-all cursor-pointer ${sel ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'border-amber-500 bg-amber-500' : 'border-zinc-600'}`}>
                          {sel && <Check size={12} className="text-white" />}
                        </div>
                        <span className="text-sm font-semibold text-white">{opcao.nome}</span>
                      </div>
                      {opcao.precoAdicional > 0 && <span className="text-sm font-bold text-amber-400">+{fmt(opcao.precoAdicional)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <h3 className="text-base font-bold text-white mb-3">Observações (opcional)</h3>
            <TecladoVirtual value={obs} onChange={setObs} />
          </div>
        </div>

        {erro && <p className="px-6 text-sm text-red-400 font-semibold">{erro}</p>}

        <div className="p-6 border-t border-zinc-800 flex items-center gap-4">
          <div className="flex items-center gap-4 bg-zinc-800 rounded-2xl px-4 py-3">
            <button onClick={() => setQtd((q) => Math.max(1, q - 1))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-700 hover:bg-zinc-600 cursor-pointer transition-colors">
              <Minus size={16} className="text-white" />
            </button>
            <span className="text-xl font-black text-white w-8 text-center">{qtd}</span>
            <button onClick={() => setQtd((q) => q + 1)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-amber-500 hover:bg-amber-400 cursor-pointer transition-colors">
              <Plus size={16} className="text-zinc-950" />
            </button>
          </div>
          <button onClick={handleAdicionar}
            className="flex-1 flex items-center justify-between bg-amber-500 hover:bg-amber-400 text-zinc-950 px-6 py-4 rounded-2xl font-black text-lg cursor-pointer active:scale-95 transition-all whitespace-nowrap">
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
  onVerCarrinho: () => void;
}

export default function CardapioKiosk({ carrinho, onAdicionar, onVerCarrinho }: CardapioKioskProps) {
  const { itensPublicos } = useCardapio();
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
    () => ['Todos', ...Array.from(new Set(itensDisponiveis.map((i) => i.categoria)))],
    [itensDisponiveis],
  );

  const [categoriaAtiva, setCategoriaAtiva] = useState('Todos');
  const [itemModal, setItemModal] = useState<ItemCardapioPublico | null>(null);

  const itens = categoriaAtiva === 'Todos' ? itensDisponiveis : itensDisponiveis.filter((i) => i.categoria === categoriaAtiva);
  const totalItens = carrinho.reduce((s, i) => s + i.quantidade, 0);
  const totalValor = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);

  const qtdNoCarrinho = (id: string) => carrinho.filter((i) => i.itemId === id).reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="flex h-full">
      {/* Sidebar categorias */}
      <div className="w-44 flex-shrink-0 bg-zinc-950 flex flex-col py-4 gap-1 overflow-y-auto border-r border-zinc-800">
        {categorias.map((cat) => (
          <button key={cat} onClick={() => setCategoriaAtiva(cat)}
            className={`mx-2 px-3 py-4 rounded-2xl text-sm font-bold transition-all cursor-pointer text-left ${categoriaAtiva === cat ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
            {cat}
          </button>
        ))}
      </div>

      {/* Grade de itens */}
      <div className="flex-1 overflow-y-auto p-5 pb-32">
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {itens.map((item) => {
            const qtd = qtdNoCarrinho(item.id);
            // Itens sem insumo já foram filtrados antes de chegar aqui
            // esgotado só para casos de is_depleted manual
            const esgotado = itensDesabilitadosIds.includes(item.id);
            const handleClick = () => {
              if (esgotado) return;
              // Combos não têm opções — adiciona direto ao carrinho
              if (item.isCombo) {
                onAdicionar({
                  itemId: item.id,
                  nome: item.nome,
                  categoria: item.categoria,
                  preco: item.preco,
                  quantidade: 1,
                  opcoesSelecionadas: [],
                  observacao: '',
                  clienteNome: 'Kiosk',
                  semPreparo: false,
                });
              } else {
                setItemModal(item);
              }
            };
            return (
              <button key={item.id} onClick={handleClick}
                disabled={esgotado}
                className={`bg-zinc-800 rounded-3xl overflow-hidden text-left group relative transition-all ${esgotado ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-zinc-700 active:scale-95'}`}>
                <div className="relative h-36">
                  <ItemImage
                    src={item.foto}
                    alt={item.nome}
                    className="w-full h-full"
                    esgotado={esgotado}
                  />
                  {item.isCombo && !esgotado && (
                    <span className="absolute top-2 left-2 bg-emerald-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">COMBO</span>
                  )}
                  {item.popular && !esgotado && !item.isCombo && (
                    <span className="absolute top-2 left-2 bg-amber-500 text-zinc-950 text-[10px] font-black px-2 py-0.5 rounded-full">TOP</span>
                  )}
                  {esgotado && (
                    <div className="absolute inset-0 bg-red-900/50 flex items-center justify-center">
                      <span className="text-white text-xs font-black bg-red-600 px-3 py-1 rounded-full">ESGOTADO</span>
                    </div>
                  )}
                  {qtd > 0 && !esgotado && (
                    <div className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center bg-emerald-500 text-white text-xs font-black rounded-full">{qtd}</div>
                  )}
                </div>
                <div className="p-4">
                  <p className={`font-bold text-base leading-tight mb-1 ${esgotado ? 'text-zinc-500' : 'text-white'}`}>{item.nome}</p>
                  <p className="text-zinc-500 text-xs mb-3 line-clamp-2">{item.descricao}</p>
                  <div className="flex items-center justify-between">
                    <span className={`font-black text-lg ${esgotado ? 'text-zinc-600' : 'text-amber-400'}`}>{fmt(item.preco)}</span>
                    <div className="flex items-center gap-1 text-zinc-600">
                      <Clock size={11} />
                      <span className="text-xs">{item.slaMinutos}min</span>
                    </div>
                  </div>
                </div>
                {!esgotado && (
                  <div className="absolute bottom-4 right-4 w-9 h-9 flex items-center justify-center bg-amber-500 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                    <Plus size={18} className="text-zinc-950" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Barra inferior */}
      {totalItens > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-5 bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800 z-20">
          <button onClick={onVerCarrinho}
            className="w-full flex items-center justify-between bg-amber-500 hover:bg-amber-400 text-zinc-950 px-8 py-5 rounded-2xl cursor-pointer active:scale-[0.99] transition-all">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 flex items-center justify-center bg-zinc-950/15 rounded-xl text-sm font-black">{totalItens}</span>
              <span className="text-xl font-black">Ver Pedido</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-black">{fmt(totalValor)}</span>
              <div className="w-8 h-8 flex items-center justify-center"><ChevronRight size={20} /></div>
            </div>
          </button>
        </div>
      )}

      {itemModal && <OpcoesKiosk item={itemModal} onAdicionar={onAdicionar} onClose={() => setItemModal(null)} />}
    </div>
  );
}
