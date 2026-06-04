import { useState, useMemo } from 'react';
import { X, Check, Minus, Plus } from 'lucide-react';
import type { ItemPedidoCliente, ItemCardapioPublico } from '@/types/mesaCliente';
import ItemImage from '@/components/base/ItemImage';

interface Props {
  itemCarrinho: ItemPedidoCliente;
  itemCardapio?: ItemCardapioPublico;
  index: number;
  onSalvar: (index: number, updates: Partial<ItemPedidoCliente>) => void;
  onFechar: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

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
        <div className={`flex-1 min-h-[3.5rem] bg-zinc-800 text-white text-lg font-semibold rounded-xl px-4 py-3 border-2 transition-colors mr-3 ${value ? 'border-amber-500/40' : 'border-transparent'}`}>
          {value || <span className="text-zinc-600 font-normal text-base">Ex: sem cebola, molho à parte...</span>}
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
          {LETRAS_KB.map((linha, li) => (
            <div key={li} className="flex justify-center gap-1.5 mb-1.5">
              {linha.map((letra) => (
                <button key={letra} onClick={() => onChange(value + letra)}
                  className="w-11 h-11 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-sm rounded-lg cursor-pointer active:scale-90 transition-all">
                  {letra}
                </button>
              ))}
            </div>
          ))}
          <div className="flex justify-center gap-3 mt-2">
            <button onClick={() => onChange(value + ' ')}
              className="px-12 py-3 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-sm rounded-lg cursor-pointer active:scale-95 transition-all whitespace-nowrap">
              Espaço
            </button>
            <button onClick={() => onChange(value.slice(0, -1))}
              className="px-5 py-3 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg cursor-pointer active:scale-95 transition-all">
              <i className="ri-delete-back-2-line text-base" />
            </button>
            <button onClick={() => onChange('')}
              className="px-5 py-3 bg-zinc-700 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 rounded-lg cursor-pointer active:scale-95 transition-all">
              <i className="ri-delete-bin-line text-base" />
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex justify-center gap-1.5 mb-1.5 flex-wrap">
            {NUMEROS_KB.map((n) => (
              <button key={n} onClick={() => onChange(value + n)}
                className="w-12 h-12 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-lg rounded-lg cursor-pointer active:scale-90 transition-all">
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-center gap-2 mt-2">
            {[' ', ',', '.', '-', '/'].map((c) => (
              <button key={c} onClick={() => onChange(value + c)}
                className="w-12 h-10 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-sm rounded-lg cursor-pointer active:scale-95 transition-all">
                {c === ' ' ? '␣' : c}
              </button>
            ))}
            <button onClick={() => onChange(value.slice(0, -1))}
              className="px-5 h-10 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-400 rounded-lg cursor-pointer active:scale-95 transition-all">
              <i className="ri-delete-back-2-line text-base" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EditarItemKiosk({ itemCarrinho, itemCardapio, index, onSalvar, onFechar }: Props) {
  const [qtd, setQtd] = useState(itemCarrinho.quantidade);

  // Se temos o item completo do cardápio, usamos modo completo
  const modoCompleto = !!itemCardapio && (itemCardapio.opcoes?.length || itemCardapio.observacoesPadrao?.length);

  // Estado de opções selecionadas: { grupoNome: [opcaoNome, ...] }
  const [selecionadas, setSelecionadas] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    if (itemCardapio?.opcoes) {
      for (const grupo of itemCardapio.opcoes) {
        map[grupo.grupo] = itemCarrinho.opcoesSelecionadas.filter((sel) =>
          grupo.itens.some((it) => it.nome === sel)
        );
      }
    }
    return map;
  });

  const [obs, setObs] = useState(itemCarrinho.observacao ?? '');
  const [erro, setErro] = useState('');

  const toggleOpcao = (grupo: string, opcao: string, obrigatorio: boolean) => {
    setErro('');
    setSelecionadas((prev) => {
      const atual = prev[grupo] ?? [];
      if (obrigatorio) return { ...prev, [grupo]: [opcao] };
      if (atual.includes(opcao)) return { ...prev, [grupo]: atual.filter((o) => o !== opcao) };
      return { ...prev, [grupo]: [...atual, opcao] };
    });
  };

  const totalOpcoes = useMemo(() => {
    if (!itemCardapio?.opcoes) return 0;
    return Object.entries(selecionadas).reduce((sum, [grupo, selected]) => {
      const grp = itemCardapio.opcoes?.find((g) => g.grupo === grupo);
      return sum + selected.reduce((s, o) => {
        const it = grp?.itens.find((i) => i.nome === o);
        return s + (it?.precoAdicional ?? 0);
      }, 0);
    }, 0);
  }, [selecionadas, itemCardapio]);

  const precoUnitario = (itemCardapio?.preco ?? itemCarrinho.preco) + totalOpcoes;
  const total = precoUnitario * qtd;

  // Verifica observações pré-configuradas já selecionadas
  const obsSelecionadas = useMemo(() => {
    return obs.split('; ').filter(Boolean);
  }, [obs]);

  const toggleObsPadrao = (obsPadrao: string) => {
    setObs((prev) => {
      const partes = prev.split('; ').filter(Boolean);
      if (partes.includes(obsPadrao)) {
        return partes.filter((p) => p !== obsPadrao).join('; ');
      }
      return prev ? `${prev}; ${obsPadrao}` : obsPadrao;
    });
  };

  const handleSalvar = () => {
    if (modoCompleto && itemCardapio?.opcoes) {
      const obrigatorios = itemCardapio.opcoes.filter((g) => g.obrigatorio);
      for (const g of obrigatorios) {
        if (!selecionadas[g.grupo]?.length) { setErro(`Escolha: ${g.grupo}`); return; }
      }
    }

    const todasOpcoes = Object.values(selecionadas).flat();
    const updates: Partial<ItemPedidoCliente> = {
      quantidade: qtd,
      preco: precoUnitario,
      opcoesSelecionadas: todasOpcoes,
      observacao: obs,
    };

    onSalvar(index, updates);
    onFechar();
  };

  // ── Modo legado: item não encontrado no cardápio ────────────────────────────
  if (!modoCompleto) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
        <div className="bg-zinc-900 rounded-3xl w-full max-w-4xl flex flex-col overflow-hidden border border-zinc-700 max-h-[95vh]">
          <div className="flex items-center justify-between px-8 py-6 border-b border-zinc-800 flex-shrink-0">
            <h2 className="text-4xl font-black text-white">{itemCarrinho.nome}</h2>
            <button onClick={onFechar}
              className="w-14 h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded-2xl cursor-pointer transition-colors text-zinc-400">
              <X size={28} />
            </button>
          </div>

          <div className="p-8 flex flex-col gap-6 overflow-y-auto flex-1">
            {/* Quantidade */}
            <div>
              <p className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4">Quantidade</p>
              <div className="flex items-center gap-6">
                <button onClick={() => setQtd((q) => Math.max(1, q - 1))}
                  className="w-18 h-18 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded-2xl cursor-pointer transition-colors text-white text-3xl font-black">
                  <Minus size={28} />
                </button>
                <span className="text-6xl font-black text-white w-24 text-center">{qtd}</span>
                <button onClick={() => setQtd((q) => q + 1)}
                  className="w-18 h-18 flex items-center justify-center bg-amber-500 hover:bg-amber-400 rounded-2xl cursor-pointer transition-colors text-zinc-950 text-3xl font-black">
                  <Plus size={28} />
                </button>
                <div className="ml-4">
                  <p className="text-zinc-500 text-base">Subtotal</p>
                  <p className="text-amber-400 font-black text-4xl">{fmt(itemCarrinho.preco * qtd)}</p>
                </div>
              </div>
            </div>

            {/* Observação */}
            <div>
              <p className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4">Observação</p>
              <TecladoVirtual value={obs} onChange={setObs} />
            </div>
          </div>

          <div className="px-8 py-6 border-t border-zinc-800 flex gap-4 flex-shrink-0">
            <button onClick={onFechar}
              className="px-12 py-6 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-2xl rounded-2xl cursor-pointer transition-colors whitespace-nowrap">
              Cancelar
            </button>
            <button onClick={handleSalvar}
              className="flex-1 py-6 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-3xl font-black rounded-2xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
              <i className="ri-save-line mr-2" />
              Salvar alterações
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Modo completo: com grupos de opções e observações pré-configuradas ────
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="bg-zinc-900 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header com imagem */}
        <div className="relative h-72 flex-shrink-0">
          <ItemImage src={itemCardapio!.foto} alt={itemCardapio!.nome} className="w-full h-full" imgClassName="object-contain" />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
          <button onClick={onFechar}
            className="absolute top-4 right-4 w-16 h-16 flex items-center justify-center bg-zinc-800/90 rounded-2xl cursor-pointer hover:bg-zinc-700 transition-colors">
            <X size={28} className="text-white" />
          </button>
          <div className="absolute bottom-4 left-6">
            <h2 className="text-4xl font-black text-white">{itemCardapio!.nome}</h2>
            <p className="text-zinc-400 text-lg">{itemCardapio!.descricao}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {/* Opções */}
          {itemCardapio!.opcoes?.map((grupo) => (
            <div key={grupo.grupo}>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-xl font-bold text-white">{grupo.grupo}</h3>
                {grupo.obrigatorio && (
                  <span className="text-base font-bold text-amber-500 bg-amber-500/10 px-3 py-1 rounded-full">Obrigatório</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {grupo.itens.map((opcao) => {
                  const sel = selecionadas[grupo.grupo]?.includes(opcao.nome);
                  return (
                    <button key={opcao.nome}
                      onClick={() => toggleOpcao(grupo.grupo, opcao.nome, grupo.obrigatorio)}
                      className={`flex items-center justify-between px-5 py-6 rounded-2xl border-2 transition-all cursor-pointer ${sel ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'border-amber-500 bg-amber-500' : 'border-zinc-600'}`}>
                          {sel && <Check size={16} className="text-white" />}
                        </div>
                        <span className="text-lg font-semibold text-white">{opcao.nome}</span>
                      </div>
                      {opcao.precoAdicional > 0 && (
                        <span className="text-lg font-bold text-amber-400">+{fmt(opcao.precoAdicional)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Observações pré-configuradas */}
          {itemCardapio!.observacoesPadrao && itemCardapio!.observacoesPadrao.length > 0 && (
            <div>
              <h3 className="text-xl font-bold text-white mb-3">Observações</h3>
              <div className="flex flex-wrap gap-3">
                {itemCardapio!.observacoesPadrao.map((obsPadrao) => {
                  const ativa = obsSelecionadas.includes(obsPadrao);
                  return (
                    <button
                      key={obsPadrao}
                      onClick={() => toggleObsPadrao(obsPadrao)}
                      className={`px-5 py-3 rounded-xl text-lg font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        ativa ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-500'
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

          {/* Observação livre */}
          <div className={itemCardapio!.observacoesPadrao && itemCardapio!.observacoesPadrao.length > 0 ? 'border-t border-zinc-800 pt-5' : ''}>
            <h3 className={`text-lg font-bold text-zinc-500 mb-4 uppercase tracking-wider ${itemCardapio!.observacoesPadrao && itemCardapio!.observacoesPadrao.length > 0 ? '' : 'text-xl text-white mb-4 normal-case tracking-normal'}`}>
              {itemCardapio!.observacoesPadrao && itemCardapio!.observacoesPadrao.length > 0 ? 'Outra observação' : 'Observações (opcional)'}
            </h3>
            <TecladoVirtual value={obs} onChange={setObs} />
          </div>
        </div>

        {erro && <p className="px-8 text-lg text-red-400 font-semibold">{erro}</p>}

        {/* Footer: quantidade + salvar */}
        <div className="p-8 border-t border-zinc-800 flex items-center gap-4">
          <div className="flex items-center gap-4 bg-zinc-800 rounded-2xl px-4 py-3">
            <button onClick={() => setQtd((q) => Math.max(1, q - 1))}
              className="w-14 h-14 flex items-center justify-center rounded-xl bg-zinc-700 hover:bg-zinc-600 cursor-pointer transition-colors">
              <Minus size={20} className="text-white" />
            </button>
            <span className="text-3xl font-black text-white w-12 text-center">{qtd}</span>
            <button onClick={() => setQtd((q) => q + 1)}
              className="w-14 h-14 flex items-center justify-center rounded-xl bg-amber-500 hover:bg-amber-400 cursor-pointer transition-colors">
              <Plus size={20} className="text-zinc-950" />
            </button>
          </div>
          <div className="flex-1">
            <p className="text-zinc-500 text-base">{qtd}x {fmt(precoUnitario)}</p>
            <p className="text-amber-400 font-black text-3xl">{fmt(total)}</p>
          </div>
          <button onClick={handleSalvar}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 px-8 py-6 rounded-2xl font-black text-2xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
            <i className="ri-save-line" />
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}