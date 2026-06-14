import { useState, useMemo } from 'react';
import { Plus, Minus, X, ChevronRight, Clock } from 'lucide-react';
import type { ItemCardapioPublico, ItemPedidoCliente } from '@/types/mesaCliente';
import { useCardapio } from '../../../contexts/CardapioContext';
import { useEstoque } from '../../../contexts/EstoqueContext';
import ItemImage from '../../../components/base/ItemImage';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface OpcoesModalProps {
  item: ItemCardapioPublico;
  clienteNome: string;
  onAdicionar: (pedido: Omit<ItemPedidoCliente, 'enviadoKds'>) => void;
  onClose: () => void;
}

interface OpcaoTrack {
  id?: string;
  nome: string;
  precoAdicional: number;
  grupoNome: string;
  obrigatorio?: boolean;
}

function OpcoesModal({ item, clienteNome, onAdicionar, onClose }: OpcoesModalProps) {
  const [qtd, setQtd] = useState(1);
  const [selecionadas, setSelecionadas] = useState<Record<string, OpcaoTrack[]>>({});
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');

  const toggleOpcao = (grupo: string, opcao: OpcaoTrack, obrigatorio: boolean, max = 1) => {
    setSelecionadas((prev) => {
      const atual = prev[grupo] ?? [];
      if (obrigatorio || max === 1) return { ...prev, [grupo]: [opcao] };
      if (atual.some((o) => o.nome === opcao.nome)) return { ...prev, [grupo]: atual.filter((o) => o.nome !== opcao.nome) };
      return { ...prev, [grupo]: [...atual, opcao] };
    });
  };

  const totalOpcoes = Object.values(selecionadas).flat().reduce((sum, o) => sum + o.precoAdicional, 0);

  const total = (item.preco + totalOpcoes) * qtd;

  const handleAdicionar = () => {
    const obrigatorios = item.opcoes?.filter((g) => g.obrigatorio) ?? [];
    for (const g of obrigatorios) {
      if (!selecionadas[g.grupo]?.length) {
        setErro(`Escolha uma opção em "${g.grupo}"`);
        return;
      }
    }
    const opcoesSelecionadas = Object.values(selecionadas).flat();
    onAdicionar({ itemId: item.id, nome: item.nome, preco: item.preco + totalOpcoes, quantidade: qtd, opcoesSelecionadas, observacao: obs, clienteNome });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="bg-white w-full max-w-sm rounded-t-3xl max-h-[90vh] overflow-y-auto">
        <div className="relative h-44 flex-shrink-0">
          <ItemImage
            src={item.foto}
            alt={item.nome}
            className="w-full h-full rounded-t-3xl"
          />
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center bg-white/90 rounded-full cursor-pointer">
            <X size={16} className="text-zinc-700" />
          </button>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between mb-1">
            <h2 className="text-base font-bold text-zinc-900 pr-2">{item.nome}</h2>
            <span className="text-base font-bold text-amber-600 whitespace-nowrap">{fmt(item.preco)}</span>
          </div>
          <p className="text-xs text-zinc-500 mb-1">{item.descricao}</p>
          <div className="flex items-center gap-1 mb-4">
            <div className="w-3 h-3 flex items-center justify-center text-zinc-400"><Clock size={10} /></div>
            <span className="text-[10px] text-zinc-400">~{item.slaMinutos} min</span>
          </div>

          {item.opcoes?.map((grupo) => (
            <div key={grupo.grupo} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-bold text-zinc-800">{grupo.grupo}</h3>
                {grupo.obrigatorio && <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">Obrigatório</span>}
              </div>
              <div className="space-y-1.5">
                {grupo.itens.map((opcao) => {
                  const sel = selecionadas[grupo.grupo]?.some((o) => o.nome === opcao.nome);
                  const opTrack: OpcaoTrack = { id: opcao.id, nome: opcao.nome, precoAdicional: opcao.precoAdicional, grupoNome: grupo.grupo, obrigatorio: grupo.obrigatorio };
                  return (
                    <button
                      key={opcao.nome}
                      onClick={() => toggleOpcao(grupo.grupo, opTrack, grupo.obrigatorio)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${sel ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'}`}>
                          {sel && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                        <span className="text-xs font-medium text-zinc-700">{opcao.nome}</span>
                      </div>
                      {opcao.precoAdicional > 0 && <span className="text-xs font-semibold text-emerald-600">+{fmt(opcao.precoAdicional)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mb-4">
            <h3 className="text-xs font-bold text-zinc-800 mb-2">Observações</h3>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              placeholder="Sem cebola, molho à parte..."
              maxLength={150}
              className="w-full text-xs border border-zinc-200 rounded-xl px-3 py-2 text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400 resize-none"
            />
          </div>

          {erro && <p className="text-xs text-red-500 mb-3 font-medium">{erro}</p>}

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setQtd((q) => Math.max(1, q - 1))} className="w-9 h-9 flex items-center justify-center rounded-full border border-zinc-200 hover:border-amber-400 cursor-pointer transition-colors">
                <Minus size={14} className="text-zinc-600" />
              </button>
              <span className="text-base font-bold text-zinc-900 w-5 text-center">{qtd}</span>
              <button onClick={() => setQtd((q) => q + 1)} className="w-9 h-9 flex items-center justify-center rounded-full bg-amber-500 hover:bg-amber-600 cursor-pointer transition-colors">
                <Plus size={14} className="text-white" />
              </button>
            </div>
            <span className="text-base font-bold text-zinc-900">{fmt(total)}</span>
          </div>

          <button
            onClick={handleAdicionar}
            className="w-full py-3.5 bg-amber-500 text-white text-sm font-bold rounded-xl hover:bg-amber-600 active:bg-amber-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            Adicionar ao Pedido
          </button>
        </div>
      </div>
    </div>
  );
}

interface CardapioPublicoProps {
  clienteNome: string;
  carrinho: ItemPedidoCliente[];
  onAdicionar: (item: Omit<ItemPedidoCliente, 'enviadoKds'>) => void;
  onVerCarrinho: () => void;
}

export default function CardapioPublico({ clienteNome, carrinho, onAdicionar, onVerCarrinho }: CardapioPublicoProps) {
  const { itensPublicos } = useCardapio();
  const { itensDesabilitadosIds } = useEstoque();

  const categorias = useMemo(
    () => ['Populares', ...Array.from(new Set(itensPublicos.map((i) => i.categoria)))],
    [itensPublicos],
  );

  const [categoriaAtiva, setCategoriaAtiva] = useState('Populares');
  const [itemModal, setItemModal] = useState<ItemCardapioPublico | null>(null);

  const itens = categoriaAtiva === 'Populares'
    ? itensPublicos.filter((i) => i.popular)
    : itensPublicos.filter((i) => i.categoria === categoriaAtiva);

  const totalCarrinho = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const totalItens = carrinho.reduce((s, i) => s + i.quantidade, 0);

  const qtdNoCarrinho = (id: string) => carrinho.filter((i) => i.itemId === id).reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Categorias */}
      <div className="flex gap-2 overflow-x-auto pb-2 px-4 pt-3 scrollbar-hide">
        {categorias.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoriaAtiva(cat)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              categoriaAtiva === cat ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grade de itens */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-28">
        <div className="grid grid-cols-1 gap-3">
          {itens.map((item) => {
            const qtd = qtdNoCarrinho(item.id);
            const esgotado = itensDesabilitadosIds.includes(item.id);
            const handleClick = () => {
              if (esgotado) return;
              // Combos não têm opções — adiciona direto ao carrinho
              if (item.isCombo) {
                onAdicionar({
                  itemId: item.id,
                  nome: item.nome,
                  preco: item.preco,
                  quantidade: 1,
                  opcoesSelecionadas: [],
                  observacao: '',
                  clienteNome,
                });
              } else {
                setItemModal(item);
              }
            };
            return (
              <button
                key={item.id}
                onClick={handleClick}
                disabled={esgotado}
                className={`flex items-center gap-3 bg-white rounded-2xl p-3 text-left border border-zinc-100 transition-colors ${esgotado ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-zinc-50 active:scale-[0.99]'}`}
              >
                <div className="relative w-20 h-20 flex-shrink-0">
                  <ItemImage
                    src={item.foto}
                    alt={item.nome}
                    className="w-full h-full rounded-xl"
                    esgotado={esgotado}
                  />
                  {item.isCombo && !esgotado && (
                    <span className="absolute -top-1 -left-1 bg-emerald-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">COMBO</span>
                  )}
                  {item.popular && !esgotado && !item.isCombo && (
                    <span className="absolute -top-1 -left-1 bg-amber-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">TOP</span>
                  )}
                  {esgotado && (
                    <div className="absolute inset-0 bg-red-900/40 rounded-xl flex items-center justify-center">
                      <span className="text-white text-[9px] font-black bg-red-600 px-1.5 py-0.5 rounded-full">ESGOTADO</span>
                    </div>
                  )}
                  {qtd > 0 && !esgotado && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-emerald-500 text-white text-[10px] font-bold rounded-full">{qtd}</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold truncate ${esgotado ? 'text-zinc-400' : 'text-zinc-900'}`}>{item.nome}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{item.descricao}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className={`text-sm font-bold ${esgotado ? 'text-zinc-400' : 'text-amber-600'}`}>{fmt(item.preco)}</span>
                  </div>
                </div>
                {!esgotado && <div className="w-5 h-5 flex items-center justify-center text-zinc-300"><ChevronRight size={14} /></div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Botão flutuante carrinho */}
      {totalItens > 0 && (
        <div className="fixed bottom-20 left-0 right-0 flex justify-center px-4 z-20">
          <button
            onClick={onVerCarrinho}
            className="w-full max-w-sm flex items-center justify-between bg-amber-500 text-white px-5 py-3.5 rounded-2xl cursor-pointer hover:bg-amber-600 active:bg-amber-700 transition-colors"
          >
            <span className="w-6 h-6 flex items-center justify-center bg-amber-400 rounded-full text-xs font-bold">{totalItens}</span>
            <span className="text-sm font-bold">Ver Pedido</span>
            <span className="text-sm font-bold">{fmt(totalCarrinho)}</span>
          </button>
        </div>
      )}

      {itemModal && (
        <OpcoesModal item={itemModal} clienteNome={clienteNome} onAdicionar={onAdicionar} onClose={() => setItemModal(null)} />
      )}
    </div>
  );
}
