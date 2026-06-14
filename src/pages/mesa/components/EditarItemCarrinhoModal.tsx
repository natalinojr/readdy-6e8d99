import { useState } from 'react';
import { Minus, Plus, X, Clock } from 'lucide-react';
import { type ItemCardapioPublico, type ItemPedidoCliente } from '@/types/mesaCliente';
import ItemImage from '../../../components/base/ItemImage';
import { useObsPorItemId } from '@/hooks/useObsPorItemId';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface Props {
  item: ItemCardapioPublico;
  itemAtual: ItemPedidoCliente;
  index: number;
  onSalvar: (index: number, novoItem: Omit<ItemPedidoCliente, 'enviadoKds'>) => void;
  onClose: () => void;
}

export default function EditarItemCarrinhoModal({ item, itemAtual, index, onSalvar, onClose }: Props) {
  const [qtd, setQtd] = useState(itemAtual.quantidade);
  const [obs, setObs] = useState(itemAtual.observacao ?? '');
  const [obsUnidades, setObsUnidades] = useState<string[]>(
    (itemAtual as ItemPedidoCliente & { obsUnidades?: string[] }).obsUnidades ?? []
  );
  const [abaObs, setAbaObs] = useState<'todas' | number>('todas');
  const [erro, setErro] = useState('');

  // Obs pré-definidas disponíveis para este item (específicas + globais)
  const todasObsDisponiveis = useObsPorItemId(item.id);
  // Inicializa com obs que o item já tinha selecionadas
  const [obsSelecionadas, setObsSelecionadas] = useState<string[]>(
    () => (itemAtual as ItemPedidoCliente & { observacoesSelecionadas?: string[] }).observacoesSelecionadas ?? [],
  );

  const toggleObsTag = (obsTexto: string) => {
    setObsSelecionadas((prev) =>
      prev.includes(obsTexto) ? prev.filter((o) => o !== obsTexto) : [...prev, obsTexto],
    );
  };

  const handleSetQtd = (novaQtd: number) => {
    const q = Math.max(1, novaQtd);
    setQtd(q);
    setObsUnidades((prev) => prev.slice(0, q));
    if (typeof abaObs === 'number' && abaObs >= q) setAbaObs('todas');
    if (q === 1) setAbaObs('todas');
  };

  // Reconstrói o estado de selecionadas a partir do array de opcoesSelecionadas
  const [selecionadas, setSelecionadas] = useState<Record<string, { id?: string; nome: string; precoAdicional: number; grupoNome: string }[]>>(() => {
    const result: Record<string, { id?: string; nome: string; precoAdicional: number; grupoNome: string }[]> = {};
    item.opcoes?.forEach((grupo) => {
      const sels = itemAtual.opcoesSelecionadas
        .filter((opt) => grupo.itens.some((gopt) => gopt.nome === opt.nome))
        .map((opt) => ({ id: opt.id || grupo.itens.find((gi) => gi.nome === opt.nome)?.id, nome: opt.nome, precoAdicional: opt.precoAdicional || grupo.itens.find((gi) => gi.nome === opt.nome)?.precoAdicional || 0, grupoNome: grupo.grupo }));
      if (sels.length > 0) result[grupo.grupo] = sels;
    });
    return result;
  });

  const toggleOpcao = (grupo: string, opcao: { id?: string; nome: string; precoAdicional: number; grupoNome: string }, obrigatorio: boolean) => {
    setSelecionadas((prev) => {
      const atual = prev[grupo] ?? [];
      if (obrigatorio) return { ...prev, [grupo]: [opcao] };
      if (atual.some((o) => o.nome === opcao.nome)) return { ...prev, [grupo]: atual.filter((o) => o.nome !== opcao.nome) };
      return { ...prev, [grupo]: [...atual, opcao] };
    });
  };

  const totalOpcoes = Object.values(selecionadas).flat().reduce((sum, o) => sum + o.precoAdicional, 0);

  const precoUnit = item.preco + totalOpcoes;
  const total = precoUnit * qtd;

  const handleSalvar = () => {
    const obrigatorios = item.opcoes?.filter((g) => g.obrigatorio) ?? [];
    for (const g of obrigatorios) {
      if (!selecionadas[g.grupo]?.length) {
        setErro(`Escolha uma opção em "${g.grupo}"`);
        return;
      }
    }
    const opcoesSelecionadas = Object.values(selecionadas).flat();
    const obsTagsSelecionadas = obsSelecionadas.length > 0 ? obsSelecionadas : undefined;
    const temObsUnidades = obsUnidades.some(Boolean);
    onSalvar(index, {
      itemId: item.id,
      nome: item.nome,
      preco: precoUnit,
      quantidade: qtd,
      opcoesSelecionadas,
      observacao: obs,
      clienteNome: itemAtual.clienteNome,
      ...(obsTagsSelecionadas ? { observacoesSelecionadas: obsTagsSelecionadas } : {}),
      ...(temObsUnidades ? { obsUnidades } : {}),
    } as Omit<ItemPedidoCliente, 'enviadoKds'>);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="bg-white w-full max-w-sm rounded-t-3xl max-h-[90vh] overflow-y-auto">
        {/* Imagem + fechar */}
        <div className="relative h-44 flex-shrink-0">
          <ItemImage src={item.foto} alt={item.nome} className="w-full h-full rounded-t-3xl" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent rounded-t-3xl" />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center bg-white/90 rounded-full cursor-pointer"
          >
            <X size={16} className="text-zinc-700" />
          </button>
          {/* Badge edição */}
          <div className="absolute bottom-3 left-4">
            <span className="text-[10px] font-bold text-white bg-amber-500 px-2.5 py-1 rounded-full">
              Editando item
            </span>
          </div>
        </div>

        <div className="p-5">
          {/* Nome + preço */}
          <div className="flex items-start justify-between mb-1">
            <h2 className="text-base font-bold text-zinc-900 pr-2">{item.nome}</h2>
            <span className="text-base font-bold text-amber-600 whitespace-nowrap">{fmt(item.preco)}</span>
          </div>
          <p className="text-xs text-zinc-500 mb-1">{item.descricao}</p>
          <div className="flex items-center gap-1 mb-4">
            <div className="w-3 h-3 flex items-center justify-center text-zinc-400">
              <Clock size={10} />
            </div>
            <span className="text-[10px] text-zinc-400">~{item.slaMinutos} min</span>
          </div>

          {/* Opções */}
          {item.opcoes?.map((grupo) => (
            <div key={grupo.grupo} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-bold text-zinc-800">{grupo.grupo}</h3>
                {grupo.obrigatorio && (
                  <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">
                    Obrigatório
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {grupo.itens.map((opcao) => {
                  const sel = selecionadas[grupo.grupo]?.some((o) => o.nome === opcao.nome);
                  const opTrack = { id: opcao.id, nome: opcao.nome, precoAdicional: opcao.precoAdicional, grupoNome: grupo.grupo, obrigatorio: grupo.obrigatorio };
                  return (
                    <button
                      key={opcao.nome}
                      onClick={() => toggleOpcao(grupo.grupo, opTrack, grupo.obrigatorio)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
                        sel
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'}`}>
                          {sel && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                        <span className="text-xs font-medium text-zinc-700">{opcao.nome}</span>
                      </div>
                      {opcao.precoAdicional > 0 && (
                        <span className="text-xs font-semibold text-emerald-600">
                          +{fmt(opcao.precoAdicional)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Observação */}
          <div className="mb-4">
            <h3 className="text-xs font-bold text-zinc-800 mb-2">Observações</h3>

            {/* Tags pré-definidas */}
            {todasObsDisponiveis.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {todasObsDisponiveis.map((obsTexto) => {
                  const sel = obsSelecionadas.includes(obsTexto);
                  return (
                    <button
                      key={obsTexto}
                      onClick={() => toggleObsTag(obsTexto)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer whitespace-nowrap ${
                        sel
                          ? 'bg-amber-500 border-amber-500 text-white'
                          : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:border-amber-300'
                      }`}
                    >
                      {obsTexto}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Abas por unidade quando qty > 1 */}
            {qtd > 1 && (
              <div className="flex gap-1.5 mb-2 flex-wrap">
                <button
                  onClick={() => setAbaObs('todas')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                    abaObs === 'todas' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  Todas
                </button>
                {Array.from({ length: qtd }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setAbaObs(i)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                      abaObs === i ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                    }`}
                  >
                    Un. {i + 1}
                    {obsUnidades[i] && (
                      <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-300 align-middle" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {abaObs === 'todas' || qtd <= 1 ? (
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                rows={2}
                placeholder={qtd > 1 ? 'Obs. para todas as unidades...' : 'Sem cebola, molho à parte...'}
                maxLength={150}
                className="w-full text-xs border border-zinc-200 rounded-xl px-3 py-2 text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400 resize-none"
              />
            ) : (
              <textarea
                value={obsUnidades[abaObs as number] ?? ''}
                onChange={(e) => {
                  const val = e.target.value.slice(0, 150);
                  setObsUnidades((prev) => {
                    const next = [...prev];
                    next[abaObs as number] = val;
                    return next;
                  });
                }}
                rows={2}
                placeholder={`Obs. só para unidade ${(abaObs as number) + 1}...`}
                maxLength={150}
                className="w-full text-xs border border-amber-200 rounded-xl px-3 py-2 text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400 resize-none bg-amber-50"
              />
            )}

            {/* Resumo obs por unidade */}
            {obsUnidades.some(Boolean) && qtd > 1 && (
              <div className="mt-2 space-y-1">
                {obsUnidades.map((u, i) => u ? (
                  <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                    <span className="font-black flex-shrink-0">Un.{i + 1}:</span>
                    <span className="truncate">{u}</span>
                  </div>
                ) : null)}
              </div>
            )}
          </div>

          {erro && <p className="text-xs text-red-500 mb-3 font-medium">{erro}</p>}

          {/* Quantidade + total */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleSetQtd(qtd - 1)}
                className="w-9 h-9 flex items-center justify-center rounded-full border border-zinc-200 hover:border-amber-400 cursor-pointer transition-colors"
              >
                <Minus size={14} className="text-zinc-600" />
              </button>
              <span className="text-base font-bold text-zinc-900 w-5 text-center">{qtd}</span>
              <button
                onClick={() => handleSetQtd(qtd + 1)}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-amber-500 hover:bg-amber-600 cursor-pointer transition-colors"
              >
                <Plus size={14} className="text-white" />
              </button>
            </div>
            <span className="text-base font-bold text-zinc-900">{fmt(total)}</span>
          </div>

          {/* Botão salvar */}
          <button
            onClick={handleSalvar}
            className="w-full py-3.5 bg-zinc-900 text-white text-sm font-bold rounded-xl hover:bg-zinc-800 active:bg-zinc-700 transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
          >
            <i className="ri-save-line text-base" />
            Salvar Alterações
          </button>
        </div>
      </div>
    </div>
  );
}
