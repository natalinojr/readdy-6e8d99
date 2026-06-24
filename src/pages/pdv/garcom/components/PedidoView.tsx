import { useState, useMemo, useRef, useCallback } from 'react';
import type { Item } from '@/types/cardapio';
import { useCardapio } from '../../../../contexts/CardapioContext';
import type { CarrinhoItem, OpcaoSelecionada } from '../../../../contexts/PDVContext';
import { useKDS } from '../../../../contexts/KDSContext';
import { useItensSemEstoque } from '@/hooks/useItensSemEstoque';
import type { InsumoFaltando } from '@/hooks/useItensSemEstoque';
import { useEstoqueAlertaPDV } from '@/hooks/useEstoqueAlertaPDV';
import type { InsumoZerando } from '@/hooks/useEstoqueAlertaPDV';
import type { Rodada } from '../types';
import { useRodadasMesa } from '../hooks/useRodadasMesa';
import OpcoesModal from '../../caixa/components/OpcoesModal';
import { promoAtivaHoje } from '@/lib/promoUtils';
import ContaMesaView from './ContaMesaView';
import FecharContaModal from './FecharContaModal';
import StatusCozinhaView from './StatusCozinhaView';
import EditarItemGarcomModal from './EditarItemGarcomModal';
import ItemImage from '../../../../components/base/ItemImage';
import DivisaoContaView from './DivisaoContaView';
import type { DivisaoResultado, DivisaoPersistedState } from './DivisaoContaView';
import PagarDivisaoModal from './PagarDivisaoModal';
import HistoricoFechamentoModal from './HistoricoFechamentoModal';
import { usePermissoes } from '@/hooks/usePermissoes';
import type { DivisaoPagamentoState } from '../page';

let garcomCartId = 0;

interface Props {
  carrinho: CarrinhoItem[];
  rodadas?: Rodada[];
  onAdd: (item: CarrinhoItem) => void;
  onUpdateQty: (cartId: string, delta: number) => void;
  onEditItem?: (cartId: string, updates: { quantidade: number; observacaoLivre: string; observacoes?: string[]; obsUnidades?: string[]; opcoes?: OpcaoSelecionada[]; precoTotal?: number }) => void;
  onRemoveItem?: (cartId: string) => void;
  onEnviar: (nomeResponsavel: string) => void | Promise<void>;
  onVoltar: () => void;
  onFecharConta?: () => void;
  onPagarConta?: (rodadasIds: string[], formaPagamentoId: string, valorParcial?: number) => void;
  mesaNome: string;
  mesaOcupada?: boolean;
  mesaPaga?: boolean;
  todasPagas?: boolean;
  rodadasPagas?: Set<string>;
  garcomNome?: string;
  numeroPessoas?: number;
  mesaNumero?: number;
  pessoasMesa?: string[];
  onAdicionarPessoa?: (nome: string) => void;
  onRenomearPessoa?: (nomeAntigo: string, nomeNovo: string) => void;
  isAvulso?: boolean;
  avulsoId?: string;
  avulsoNomeCliente?: string;
  observacoesAvulso?: string;
  onSalvarRascunho?: () => void;
  onRestaurarRascunho?: () => void;
  temRascunho?: boolean;
  divisaoPagamentoSalvo?: DivisaoPagamentoState | null;
  onAtualizarDivisaoPag?: (estado: DivisaoPagamentoState) => void;
  /** Estado persistido da aba Dividir para restaurar ao voltar */
  divisaoPersistedState?: DivisaoPersistedState | null;
  onDivisaoPersistedChange?: (estado: DivisaoPersistedState) => void;
}

type AbaAtiva = 'adicionar' | 'conta' | 'cozinha' | 'dividir';

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function PedidoView({
  carrinho, rodadas = [], onAdd, onUpdateQty, onEditItem, onRemoveItem,
  onEnviar, onVoltar, onFecharConta, onPagarConta,
  mesaNome, mesaOcupada, mesaPaga, todasPagas, rodadasPagas,
  garcomNome, numeroPessoas, mesaNumero,
  pessoasMesa = [], onAdicionarPessoa, onRenomearPessoa,
  isAvulso = false, avulsoId, avulsoNomeCliente, observacoesAvulso,
  onSalvarRascunho, onRestaurarRascunho, temRascunho = false,
  divisaoPagamentoSalvo, onAtualizarDivisaoPag,
  divisaoPersistedState, onDivisaoPersistedChange,
}: Props) {
  const { hasPermissao } = usePermissoes();
  const [catAtiva, setCatAtiva] = useState('todas');
  const [busca, setBusca] = useState('');
  const [showCart, setShowCart] = useState(false);
  const [itemOpcoes, setItemOpcoes] = useState<Item | null>(null);
  const [itemEditando, setItemEditando] = useState<CarrinhoItem | null>(null);
  const [abaAtiva, setAbaAtiva] = useState<AbaAtiva>(mesaOcupada ? 'conta' : 'adicionar');
  const [tooltipItemId, setTooltipItemId] = useState<string | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [insumosZerandoEnvio, setInsumosZerandoEnvio] = useState<InsumoZerando[]>([]);
  const [showAlertaEstoqueEnvio, setShowAlertaEstoqueEnvio] = useState(false);

  const { mapaItens: itensSemEstoque } = useItensSemEstoque();
  const { verificarEstoque } = useEstoqueAlertaPDV();

  const handleMouseEnterSemEstoque = useCallback((itemId: string) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltipItemId(itemId);
  }, []);

  const handleMouseLeaveSemEstoque = useCallback(() => {
    tooltipTimer.current = setTimeout(() => setTooltipItemId(null), 150);
  }, []);
  const [showFecharConta, setShowFecharConta] = useState(false);
  const [showPagarConta, setShowPagarConta] = useState(false);
  const [showConfirmarEnvio, setShowConfirmarEnvio] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // useRef garante proteção real contra clique duplo — state tem delay de 1 tick
  const enviandoRef = useRef(false);
  const [nomeResponsavel, setNomeResponsavel] = useState('');
  const [pessoaSelecionada, setPessoaSelecionada] = useState<string>('');
  const [showAddPessoa, setShowAddPessoa] = useState(false);
  const [novaPessoaNome, setNovaPessoaNome] = useState('');
  const [editandoPessoa, setEditandoPessoa] = useState<string | null>(null);
  const [editandoPessoaNome, setEditandoPessoaNome] = useState('');

  const showCozinhaTab = (mesaNumero && mesaNumero > 0) || isAvulso;

  const { pedidos: allKDSPedidos } = useKDS();
  const { categorias: todasCategorias, itensAtivos: todosItens, obsGlobais } = useCardapio();

  const pedidosProntos = useMemo(() => {
    if (!mesaNumero) return 0;
    return allKDSPedidos.filter((p) => p.destino === 'mesa' && p.mesaNumero === mesaNumero && p.status === 'pronto').length;
  }, [mesaNumero, allKDSPedidos]);

  const pedidosAtivos = useMemo(() => {
    if (!mesaNumero) return 0;
    return allKDSPedidos.filter((p) => p.destino === 'mesa' && p.mesaNumero === mesaNumero && p.status !== 'entregue').length;
  }, [mesaNumero, allKDSPedidos]);

  const cats = todasCategorias.filter((c) => c.ativo);
  const itens = useMemo(() => {
    return todosItens
      .filter((i) => catAtiva === 'todas' || i.categoriaId === catAtiva)
      .filter((i) => !busca || i.nome.toLowerCase().includes(busca.toLowerCase()));
  }, [catAtiva, busca, todosItens]);

  const totalItens = carrinho.reduce((a, i) => a + i.quantidade, 0);
  const totalValor = carrinho.reduce((a, i) => a + i.precoTotal * i.quantidade, 0);

  // Combina rodadas locais (garçom) com pedidos reais do banco (mesa, caixa, autoatendimento)
  const { todasRodadas, totalMesa } = useRodadasMesa(
    mesaNumero && mesaNumero > 0 ? mesaNumero : 0,
    rodadas,
  );

  // Para cálculo de todasPagas, usar todasRodadas em vez de rodadas locais
  const rodadasParaConta = isAvulso ? rodadas : todasRodadas;

  // Aba dividir: só para mesas com rodadas (não avulso)
  const showDividirTab = !isAvulso && (mesaNumero && mesaNumero > 0) && rodadasParaConta.length > 0;

  const handleQuickAdd = (item: Item) => {
    const promoAtiva = promoAtivaHoje(item.promocoes);
    const preco = promoAtiva ? promoAtiva.precoPromocional : item.preco;
    // Abre modal SÓ se tiver opções obrigatórias OU obs pré-definidas/globais
    const temOpcoesObrigatorias = item.gruposOpcoes.some((g) => g.obrigatorio);
    const temObsEspecificas = (item.observacoesPadrao?.length ?? 0) > 0;
    const temObsGlobais = obsGlobais.some(
      (og) => og.ativo && !og.excludedItemIds?.includes(item.id) && !og.excludedCategoryIds?.includes(item.categoriaId)
    );
    if (temOpcoesObrigatorias || temObsEspecificas || temObsGlobais) { setItemOpcoes(item); return; }
    const cat = todasCategorias.find((c) => c.id === item.categoriaId);
    garcomCartId += 1;
    onAdd({ cartId: `gc-${garcomCartId}`, itemId: item.id, nome: item.nome, precoBase: preco, precoTotal: preco, quantidade: 1, opcoes: [], observacoes: [], observacaoLivre: '', semPreparo: item.semPreparo ?? false, stationId: cat?.estacaoId ?? undefined });
  };

  const handleEnviarConfirmado = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const nome = pessoaSelecionada || nomeResponsavel;
      await onEnviar(nome);
      setNomeResponsavel('');
      setPessoaSelecionada('');
      setShowConfirmarEnvio(false);
      setShowAlertaEstoqueEnvio(false);
      setInsumosZerandoEnvio([]);
      setAbaAtiva('conta');
    } finally {
      setEnviando(false);
      enviandoRef.current = false;
    }
  };

  const handleEnviar = async () => {
    if (enviandoRef.current) return;
    // Verifica insumos que vão zerar com este pedido
    const carrinhoPayload = carrinho.map((ci) => ({
      itemId: ci.itemId ?? '',
      nome: ci.nome,
      quantidade: ci.quantidade,
    }));
    const { temAlerta, insumosZerando } = await verificarEstoque(
      carrinho.map((ci) => ({ ...ci, itemId: ci.itemId ?? '' }))
    );
    if (temAlerta && insumosZerando.length > 0) {
      setInsumosZerandoEnvio(insumosZerando);
      setShowAlertaEstoqueEnvio(true);
      return;
    }
    await handleEnviarConfirmado();
  };

  const handleAddPessoa = () => {
    const nome = novaPessoaNome.trim();
    if (!nome) return;
    onAdicionarPessoa?.(nome);
    setNovaPessoaNome('');
    setShowAddPessoa(false);
    setPessoaSelecionada(nome);
  };

  const handleConfirmarRenomear = () => {
    const novoNome = editandoPessoaNome.trim();
    if (!novoNome || !editandoPessoa) return;
    if (pessoaSelecionada === editandoPessoa) setPessoaSelecionada(novoNome);
    onRenomearPessoa?.(editandoPessoa, novoNome);
    setEditandoPessoa(null);
    setEditandoPessoaNome('');
  };

  const podePagar = !itensNovos_check() && rodadasParaConta.length > 0 && !todasPagas;
  function itensNovos_check() { return carrinho.length > 0; }

  const podeFechar = (todasPagas || rodadasParaConta.length === 0) && carrinho.length === 0;

  const handleFecharComHistorico = () => {
    // Se há rodadas, mostra histórico antes de fechar
    if (rodadasParaConta.length > 0) {
      setShowHistoricoFechamento(true);
    } else {
      onFecharConta?.();
    }
  };

  // Estado da divisão de conta
  const [divisaoAtual, setDivisaoAtual] = useState<DivisaoResultado | null>(null);
  const [showPagarDivisao, setShowPagarDivisao] = useState(false);
  const [showHistoricoFechamento, setShowHistoricoFechamento] = useState(false);
  const [showConfirmarDescartarAvulso, setShowConfirmarDescartarAvulso] = useState(false);

  // Verifica se a divisão está completa (todos os itens atribuídos)
  const divisaoCompleta = useMemo(() => {
    if (!divisaoAtual) return false;
    const totalUnidades = Object.keys(divisaoAtual.atribuicoes).length;
    if (totalUnidades === 0) return false;
    return Object.values(divisaoAtual.atribuicoes).every((v) => v !== null);
  }, [divisaoAtual]);

  return (
    <div className="flex flex-col h-full">
      {/* Header — responsivo */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-200 bg-zinc-50 flex-shrink-0 flex-wrap">
        <button onClick={onVoltar} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-zinc-200 cursor-pointer text-zinc-600 transition-colors flex-shrink-0 border border-zinc-200 bg-white">
          <i className="ri-arrow-left-line text-sm" />
          <span className="text-xs font-semibold whitespace-nowrap hidden sm:inline">Mesas</span>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isAvulso && (<span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-bold text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full"><i className="ri-shopping-bag-2-line" /><span className="hidden sm:inline">Para Levar</span></span>)}
            {todasPagas && (<span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full"><i className="ri-checkbox-circle-fill" />PAGA</span>)}
            <p className="font-bold text-zinc-900 text-sm truncate">{mesaNome}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs text-zinc-500 hidden sm:block">{abaAtiva === 'adicionar' ? 'Toque no item para adicionar' : abaAtiva === 'conta' ? 'Consumo completo da mesa' : abaAtiva === 'dividir' ? 'Atribua cada item a uma pessoa' : 'Status na cozinha'}</p>
            {garcomNome && (<span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full whitespace-nowrap"><i className="ri-walk-line mr-0.5" />{garcomNome.split(' ')[0]}</span>)}
            {numeroPessoas && (<span className="text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded-full whitespace-nowrap hidden sm:inline-flex"><i className="ri-group-line mr-0.5" />{numeroPessoas} pess.</span>)}
          </div>
        </div>
        {(mesaOcupada || (isAvulso && rodadasParaConta.length > 0)) && !todasPagas && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {onPagarConta && (
              <button
                onClick={() => {
                  if (abaAtiva === 'dividir' && divisaoCompleta && divisaoAtual) {
                    setShowPagarDivisao(true);
                  } else {
                    setShowPagarConta(true);
                  }
                }}
                disabled={carrinho.length > 0 || rodadasParaConta.length === 0}
                title={carrinho.length > 0 ? 'Envie os itens pendentes antes de pagar' : abaAtiva === 'dividir' && !divisaoCompleta ? 'Atribua todos os itens na aba Dividir primeiro' : 'Registrar pagamento'}
                className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-2.5 py-1.5 rounded-full cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-money-dollar-circle-line" />
                <span className="hidden sm:inline">
                  {abaAtiva === 'dividir' && divisaoCompleta ? 'Pagar (dividido)' : 'Pagar'}
                </span>
              </button>
            )}
            {!isAvulso && hasPermissao('garcom_fechar_mesa') && (
              <button
                onClick={() => { if (podeFechar) handleFecharComHistorico(); }}
                disabled={!podeFechar}
                title={!todasPagas && rodadasParaConta.length > 0 ? 'Registre o pagamento antes de fechar' : undefined}
                className="flex items-center gap-1 bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-2.5 py-1.5 rounded-full cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-bill-line" />
                <span className="hidden sm:inline">Fechar Mesa</span>
              </button>
            )}
          </div>
        )}
        {mesaOcupada && todasPagas && hasPermissao('garcom_fechar_mesa') && (
          <button
            onClick={() => { if (carrinho.length === 0) handleFecharComHistorico(); }}
            disabled={carrinho.length > 0}
            className="flex items-center gap-1 bg-zinc-700 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-2.5 py-1.5 rounded-full cursor-pointer whitespace-nowrap transition-colors flex-shrink-0"
          >
            <i className="ri-door-open-line" />
            <span className="hidden sm:inline">Fechar Mesa</span>
          </button>
        )}
        {isAvulso && rodadas.length === 0 && carrinho.length === 0 && (
          <button
            onClick={() => setShowConfirmarDescartarAvulso(true)}
            className="flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-full cursor-pointer whitespace-nowrap transition-colors flex-shrink-0"
          >
            <i className="ri-delete-bin-line" />
            <span className="hidden sm:inline">Descartar</span>
          </button>
        )}
      </div>

      {isAvulso && observacoesAvulso && (
        <div className="flex items-start gap-2 px-3 py-2 bg-sky-50 border-b border-sky-200 flex-shrink-0">
          <i className="ri-chat-1-line text-sky-500 text-sm flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider mb-0.5">Observações do pedido</p>
            <p className="text-xs text-sky-800">{observacoesAvulso}</p>
          </div>
        </div>
      )}

      {/* Abas — scrolláveis no mobile */}
      <div className="flex border-b border-zinc-200 bg-white flex-shrink-0 overflow-x-auto">
        <button onClick={() => setAbaAtiva('adicionar')} className={`flex-1 min-w-[80px] py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${abaAtiva === 'adicionar' ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>
          <i className="ri-add-circle-line mr-1" />Adicionar
          {totalItens > 0 && (<span className="ml-1.5 w-4 h-4 inline-flex items-center justify-center bg-amber-500 text-white text-[9px] font-bold rounded-full">{totalItens}</span>)}
        </button>
        <button onClick={() => setAbaAtiva('conta')} className={`flex-1 min-w-[80px] py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${abaAtiva === 'conta' ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>
          <i className="ri-receipt-line mr-1" />Conta
          {rodadasParaConta.length > 0 && (<span className="ml-1.5 text-[10px] text-zinc-400 hidden sm:inline">({rodadasParaConta.length} ped.)</span>)}
        </button>
        {showDividirTab && (
          <button onClick={() => setAbaAtiva('dividir')} className={`flex-1 min-w-[80px] py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${abaAtiva === 'dividir' ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>
            <i className="ri-group-line mr-1" />Dividir
          </button>
        )}
        {showCozinhaTab && (
          <button onClick={() => setAbaAtiva('cozinha')} className={`flex-1 min-w-[80px] py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${abaAtiva === 'cozinha' ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>
            <i className="ri-fire-line mr-1" />Cozinha
            {pedidosProntos > 0 && (<span className="ml-1 w-4 h-4 inline-flex items-center justify-center bg-green-500 text-white text-[9px] font-black rounded-full animate-pulse">{pedidosProntos}</span>)}
            {pedidosProntos === 0 && pedidosAtivos > 0 && (<span className="ml-1 w-4 h-4 inline-flex items-center justify-center bg-amber-400 text-white text-[9px] font-bold rounded-full">{pedidosAtivos}</span>)}
          </button>
        )}
      </div>

      {abaAtiva === 'conta' && (
        <div className="flex-1 overflow-hidden">
          <ContaMesaView
            rodadas={rodadasParaConta}
            itensNovos={carrinho}
            onFecharConta={() => onFecharConta?.()}
            onPagarConta={() => setShowPagarConta(true)}
            rodadasPagas={rodadasPagas}
            mesaNome={mesaNome}
          />
        </div>
      )}

      {abaAtiva === 'dividir' && showDividirTab && (
        <div className="flex-1 overflow-hidden">
          <DivisaoContaView
            rodadas={rodadasParaConta}
            itensNovos={carrinho}
            pessoasMesa={pessoasMesa}
            mesaNome={mesaNome}
            onDivisaoChange={setDivisaoAtual}
            estadoPersistido={divisaoPersistedState}
            onEstadoChange={onDivisaoPersistedChange}
          />
        </div>
      )}

      {abaAtiva === 'cozinha' && showCozinhaTab && (
        <div className="flex-1 overflow-hidden">
          <StatusCozinhaView mesaNumero={mesaNumero && mesaNumero > 0 ? mesaNumero : undefined} nomeClienteAvulso={isAvulso ? avulsoNomeCliente : undefined} />
        </div>
      )}

      {abaAtiva === 'adicionar' && (
        <>
          {showCart && carrinho.length > 0 && (
            <div className="bg-white border-b border-zinc-200 px-3 py-2.5 max-h-48 overflow-y-auto flex-shrink-0">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Itens a enviar</p>
              {carrinho.map((item) => (
                <div key={item.cartId} className="flex items-center gap-2 py-2 border-b border-zinc-100 last:border-0">
                  <div className="flex items-center gap-1 border border-zinc-200 rounded-lg px-1 flex-shrink-0">
                    <button onClick={() => onUpdateQty(item.cartId, -1)} className="w-5 h-5 flex items-center justify-center cursor-pointer text-zinc-500 hover:text-red-500"><i className="ri-subtract-line text-xs" /></button>
                    <span className="text-xs font-bold w-4 text-center">{item.quantidade}</span>
                    <button onClick={() => onUpdateQty(item.cartId, 1)} className="w-5 h-5 flex items-center justify-center cursor-pointer text-zinc-500 hover:text-green-600"><i className="ri-add-line text-xs" /></button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-800 truncate">{item.nome}</p>
                    {item.opcoes.length > 0 && (<p className="text-[10px] text-zinc-400 truncate">{item.opcoes.map((o) => o.opcaoNome).join(' · ')}</p>)}
                    {item.observacaoLivre && (<p className="text-[10px] text-amber-600 truncate"><i className="ri-chat-1-line mr-0.5" />{item.observacaoLivre}</p>)}
                  </div>
                  <span className="text-xs font-bold text-zinc-700 flex-shrink-0 ml-1">{formatPrice(item.precoTotal * item.quantidade)}</span>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={() => setItemEditando(item)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-100 text-amber-500 cursor-pointer transition-colors"><i className="ri-pencil-line text-xs" /></button>
                    <button onClick={() => onRemoveItem ? onRemoveItem(item.cartId) : onUpdateQty(item.cartId, -item.quantidade)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-100 text-red-400 cursor-pointer transition-colors"><i className="ri-delete-bin-line text-xs" /></button>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs font-bold text-zinc-500">Subtotal</span>
                <span className="text-sm font-bold text-amber-600">{formatPrice(totalValor)}</span>
              </div>
            </div>
          )}

          <div className="px-3 pt-2.5 pb-2 flex-shrink-0">
            <div className="flex items-center gap-2 bg-zinc-100 rounded-lg px-3 py-2">
              <i className="ri-search-line text-zinc-400 text-sm" />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar item..."
                className="flex-1 bg-transparent text-sm outline-none text-zinc-800 placeholder-zinc-400"
              />
              {busca && (
                <button onClick={() => setBusca('')} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                  <i className="ri-close-line text-sm" />
                </button>
              )}
              {totalItens > 0 && (
                <button
                  onClick={() => setShowCart(!showCart)}
                  className="flex items-center gap-1 bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded-full cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-shopping-cart-line text-xs" />
                  {totalItens}
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-2 px-3 pb-2 overflow-x-auto flex-shrink-0">
            <button
              onClick={() => setCatAtiva('todas')}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${catAtiva === 'todas' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
            >
              Todos
            </button>
            {cats.map((c) => (
              <button
                key={c.id}
                onClick={() => setCatAtiva(c.id)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${catAtiva === c.id ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                {c.nome}
              </button>
            ))}
          </div>

          {/* Grid de itens — responsivo: 2 cols mobile, 3 cols tablet, 4 cols desktop */}
          <div className="flex-1 overflow-y-auto px-3 pb-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
              {itens.map((item) => {
                const promoAtiva = promoAtivaHoje(item.promocoes);
                const preco = promoAtiva ? promoAtiva.precoPromocional : item.preco;
                const temOpcaoObrig = item.gruposOpcoes.some((g) => g.obrigatorio);
                const qtdNoCarrinho = carrinho.filter((c) => c.itemId === item.id).reduce((a, c) => a + c.quantidade, 0);
                const insumosFaltando: InsumoFaltando[] = itensSemEstoque.get(item.id) ?? [];
                const semEstoque = insumosFaltando.length > 0;

                return (
                  <div
                    key={item.id}
                    className={`flex flex-col border rounded-xl overflow-hidden transition-all text-left relative group ${
                      semEstoque
                        ? 'bg-zinc-100 border-zinc-200 opacity-70'
                        : 'bg-white border-zinc-200 hover:border-amber-400'
                    }`}
                    onMouseEnter={semEstoque ? () => handleMouseEnterSemEstoque(item.id) : undefined}
                    onMouseLeave={semEstoque ? handleMouseLeaveSemEstoque : undefined}
                  >
                    {/* Tooltip insumos faltando */}
                    {semEstoque && tooltipItemId === item.id && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-52 bg-zinc-900 text-white rounded-xl p-3 shadow-xl pointer-events-none">
                        <p className="text-[10px] font-bold text-red-400 mb-1.5 uppercase tracking-wide">Insumo(s) em falta</p>
                        <div className="space-y-1">
                          {insumosFaltando.map((ins) => (
                            <div key={ins.id} className="flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-red-400" />
                              <span className="text-[11px] text-white/90">{ins.nome}</span>
                              <span className="ml-auto text-[10px] text-zinc-400 whitespace-nowrap">{ins.estoque} {ins.unidade}</span>
                            </div>
                          ))}
                        </div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900" />
                      </div>
                    )}

                    {qtdNoCarrinho > 0 && !semEstoque && (
                      <div className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center bg-amber-500 text-white text-[10px] font-bold rounded-full z-10">
                        {qtdNoCarrinho}
                      </div>
                    )}
                    <button
                      onClick={() => !semEstoque && handleQuickAdd(item)}
                      disabled={semEstoque}
                      className={`w-full text-left ${semEstoque ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className="w-full h-20 sm:h-24 overflow-hidden relative">
                        <ItemImage
                          src={item.fotoUrl}
                          alt={item.nome}
                          className="w-full h-full"
                          imgClassName={`${semEstoque ? 'grayscale' : 'group-hover:scale-105'} transition-transform duration-300`}
                        />
                        {semEstoque && (
                          <div className="absolute inset-0 bg-zinc-900/50 flex flex-col items-center justify-center gap-1 px-1">
                            <span className="text-white text-[9px] font-black bg-red-600 px-2 py-0.5 rounded-full tracking-wider uppercase">Sem insumo</span>
                            {insumosFaltando.length <= 2 && insumosFaltando.map((ins) => (
                              <span key={ins.id} className="text-white/85 text-[8px] font-medium bg-black/40 px-1.5 py-0.5 rounded-md max-w-full truncate">{ins.nome}</span>
                            ))}
                            {insumosFaltando.length > 2 && (
                              <span className="text-white/80 text-[8px]">{insumosFaltando.length} insumos em falta</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="p-2 pb-1">
                        <p className={`text-xs font-semibold leading-tight line-clamp-2 mb-1 ${semEstoque ? 'text-zinc-400' : 'text-zinc-900'}`}>{item.nome}</p>
                        {semEstoque ? (
                          <p className="text-[10px] text-red-400 font-semibold">
                            Falta: {insumosFaltando.map(i => i.nome).join(', ')}
                          </p>
                        ) : (
                          <div className="flex items-center justify-between gap-1 flex-wrap">
                            <span className={`text-xs font-bold ${promoAtiva ? 'text-red-500' : 'text-amber-600'}`}>{formatPrice(preco)}</span>
                            {temOpcaoObrig && (
                              <span className="text-[9px] font-semibold text-white bg-amber-500 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                + opções
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                    {!semEstoque && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const existente = carrinho.find((c) => c.itemId === item.id);
                          if (existente) {
                            setItemEditando(existente);
                          } else {
                            handleQuickAdd(item);
                          }
                        }}
                        className="flex items-center justify-center gap-1 py-1.5 border-t border-zinc-100 text-[10px] font-semibold text-zinc-400 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer w-full"
                        title="Adicionar observação"
                      >
                        <i className="ri-chat-1-line text-[10px]" />
                        <span>Obs.</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {itens.length === 0 && (
              <div className="text-center py-12">
                <i className="ri-search-line text-3xl text-zinc-300 block mb-2" />
                <p className="text-sm text-zinc-400">Nenhum item encontrado</p>
              </div>
            )}
          </div>

          {totalItens > 0 && (
            <div className="px-3 py-2.5 border-t border-zinc-200 bg-white flex-shrink-0 space-y-2">
              {/* Person selector */}
              {pessoasMesa.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">Para quem é este pedido?</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {pessoasMesa.map((p) => (
                      <div key={p} className="relative group/pessoa flex items-center">
                        {editandoPessoa === p ? (
                          <div className="flex items-center gap-1 bg-white border-2 border-amber-400 rounded-full px-2 py-0.5 shadow-sm">
                            <input
                              type="text"
                              value={editandoPessoaNome}
                              onChange={(e) => setEditandoPessoaNome(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleConfirmarRenomear();
                                if (e.key === 'Escape') { setEditandoPessoa(null); setEditandoPessoaNome(''); }
                              }}
                              autoFocus
                              className="text-xs font-semibold text-zinc-900 bg-transparent outline-none w-20"
                              maxLength={30}
                            />
                            <button
                              onClick={handleConfirmarRenomear}
                              className="w-5 h-5 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white rounded-full cursor-pointer flex-shrink-0 transition-colors"
                            >
                              <i className="ri-check-line text-[9px]" />
                            </button>
                            <button
                              onClick={() => { setEditandoPessoa(null); setEditandoPessoaNome(''); }}
                              className="w-5 h-5 flex items-center justify-center bg-zinc-200 hover:bg-zinc-300 text-zinc-500 rounded-full cursor-pointer flex-shrink-0 transition-colors"
                            >
                              <i className="ri-close-line text-[9px]" />
                            </button>
                          </div>
                        ) : (
                          <div className={`flex items-center gap-0.5 rounded-full pr-0.5 pl-3 py-1 text-xs font-semibold transition-colors ${pessoaSelecionada === p ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                            <button
                              onClick={() => setPessoaSelecionada(pessoaSelecionada === p ? '' : p)}
                              className="flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <i className="ri-user-line" />{p}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditandoPessoa(p); setEditandoPessoaNome(p); }}
                              title="Renomear"
                              className={`w-5 h-5 flex items-center justify-center rounded-full cursor-pointer transition-all ml-0.5 opacity-0 group-hover/pessoa:opacity-100 ${
                                pessoaSelecionada === p
                                  ? 'hover:bg-white/25 text-white'
                                  : 'hover:bg-zinc-300 text-zinc-400'
                              }`}
                            >
                              <i className="ri-pencil-line text-[9px]" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    <button onClick={() => setShowAddPessoa(true)} className="px-3 py-1 rounded-full text-xs font-semibold cursor-pointer border border-dashed border-zinc-300 text-zinc-400 hover:border-amber-400 hover:text-amber-500 transition-colors whitespace-nowrap">
                      <i className="ri-add-line mr-0.5" />Pessoa
                    </button>
                  </div>
                </div>
              )}
              {pessoasMesa.length === 0 && (
                <div className="flex items-center gap-2 bg-zinc-100 rounded-lg px-3 py-2">
                  <i className="ri-user-line text-zinc-400 text-sm flex-shrink-0" />
                  <input
                    type="text"
                    value={nomeResponsavel}
                    onChange={(e) => setNomeResponsavel(e.target.value)}
                    placeholder="Quem está pedindo? (opcional)"
                    className="flex-1 bg-transparent text-sm outline-none text-zinc-800 placeholder-zinc-400"
                    maxLength={40}
                  />
                </div>
              )}
              {pessoaSelecionada && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-200">
                  <i className="ri-user-fill text-amber-500 text-sm" />
                  <span className="text-xs font-semibold text-amber-700">Pedido de: {pessoaSelecionada}</span>
                  <button onClick={() => setPessoaSelecionada('')} className="ml-auto text-amber-400 hover:text-amber-600 cursor-pointer">
                    <i className="ri-close-line text-xs" />
                  </button>
                </div>
              )}

              {/* Botão salvar rascunho */}
              {onSalvarRascunho && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={onSalvarRascunho}
                    className="flex items-center gap-1.5 px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors border border-zinc-200"
                  >
                    <i className="ri-save-line text-sm" />
                    Salvar Rascunho
                  </button>
                  {temRascunho && onRestaurarRascunho && (
                    <button
                      onClick={onRestaurarRascunho}
                      className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors border border-amber-200"
                    >
                      <i className="ri-history-line text-sm" />
                      Restaurar Rascunho
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={async () => {
                  // Verifica estoque antes de mostrar confirmação
                  const { temAlerta, insumosZerando } = await verificarEstoque(
                    carrinho.map((ci) => ({ ...ci, itemId: ci.itemId ?? '' }))
                  );
                  if (temAlerta && insumosZerando.length > 0) {
                    setInsumosZerandoEnvio(insumosZerando);
                    setShowAlertaEstoqueEnvio(true);
                  } else {
                    setShowConfirmarEnvio(true);
                  }
                }}
                className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-between px-4"
              >
                <span><i className="ri-send-plane-line mr-2" />Enviar ao KDS</span>
                <span>{totalItens} {totalItens === 1 ? 'item' : 'itens'} · {formatPrice(totalValor)}</span>
              </button>
            </div>
          )}

          {/* Botão restaurar rascunho quando carrinho está vazio */}
          {totalItens === 0 && temRascunho && onRestaurarRascunho && (
            <div className="px-3 py-2.5 border-t border-zinc-200 bg-white flex-shrink-0">
              <button
                onClick={onRestaurarRascunho}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors border border-amber-200"
              >
                <i className="ri-history-line" />
                Restaurar Rascunho Salvo
              </button>
            </div>
          )}
        </>
      )}

      {itemOpcoes && (
        <OpcoesModal
          item={itemOpcoes}
          onAdd={(ci) => {
            onAdd(ci);
            setItemOpcoes(null);
          }}
          onClose={() => setItemOpcoes(null)}
        />
      )}

      {showFecharConta && (
        <FecharContaModal
          mesaNome={mesaNome}
          rodadas={rodadas}
          itensNovos={carrinho}
          operadorNome={garcomNome}
          onConfirmar={() => {
            setShowFecharConta(false);
            onFecharConta?.();
          }}
          onClose={() => setShowFecharConta(false)}
          modo="fechar"
          rodadasJaPagas={rodadasPagas}
        />
      )}

      {showPagarConta && onPagarConta && (
        <FecharContaModal
          mesaNome={mesaNome}
          rodadas={rodadasParaConta}
          itensNovos={[]}
          operadorNome={garcomNome}
          onConfirmar={() => setShowPagarConta(false)}
          onClose={() => setShowPagarConta(false)}
          modo="pagar"
          rodadasJaPagas={rodadasPagas}
          onPagarParcial={(ids, formaPagId) => {
            onPagarConta(ids, formaPagId);
            setShowPagarConta(false);
          }}
        />
      )}

      {itemEditando && (
        <EditarItemGarcomModal
          item={itemEditando}
          onSalvar={(cartId, updates) => {
            onEditItem?.(cartId, updates);
          }}
          onDeletar={(cartId) => {
            onRemoveItem ? onRemoveItem(cartId) : onUpdateQty(cartId, -99);
          }}
          onClose={() => setItemEditando(null)}
        />
      )}

      {/* Botão restaurar rascunho quando carrinho está vazio */}
      {totalItens === 0 && temRascunho && onRestaurarRascunho && (
        <div className="px-3 py-2.5 border-t border-zinc-200 bg-white flex-shrink-0">
          <button
            onClick={onRestaurarRascunho}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors border border-amber-200"
          >
            <i className="ri-history-line" />
            Restaurar Rascunho Salvo
          </button>
        </div>
      )}

      {/* Modal alerta insumos zerando ao enviar */}
      {showAlertaEstoqueEnvio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl flex-shrink-0">
                  <i className="ri-error-warning-line text-amber-600 text-lg" />
                </div>
                <div>
                  <p className="font-bold text-zinc-900 text-sm">Insumos vão zerar!</p>
                  <p className="text-xs text-zinc-500">Este pedido vai esgotar o estoque</p>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 space-y-2">
                {insumosZerandoEnvio.map((ins) => (
                  <div key={ins.ingredientId} className="flex items-start gap-2">
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i className={`text-sm ${ins.estoqueAtual - ins.consumoTotal < 0 ? 'ri-close-circle-fill text-red-500' : 'ri-alert-fill text-amber-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-800">{ins.nome}</p>
                      <p className="text-[10px] text-zinc-500">
                        Estoque: {ins.estoqueAtual} {ins.unidade} → Consumo: {ins.consumoTotal} {ins.unidade}
                        {ins.estoqueAtual - ins.consumoTotal < 0 && (
                          <span className="text-red-500 font-bold ml-1">(fica negativo)</span>
                        )}
                      </p>
                      {ins.itensAfetados.length > 0 && (
                        <p className="text-[10px] text-zinc-400">Pratos: {ins.itensAfetados.join(', ')}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-500">Deseja continuar mesmo assim ou voltar ao pedido?</p>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => { setShowAlertaEstoqueEnvio(false); setInsumosZerandoEnvio([]); }}
                className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
              >
                Voltar ao pedido
              </button>
              <button
                onClick={handleEnviarConfirmado}
                disabled={enviando}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {enviando ? <><i className="ri-loader-4-line animate-spin" />Enviando...</> : <><i className="ri-send-plane-line" />Enviar mesmo assim</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar descartar avulso */}
      {showConfirmarDescartarAvulso && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                  <i className="ri-delete-bin-2-line text-red-600 text-lg" />
                </div>
                <div>
                  <p className="font-bold text-zinc-900 text-sm">Descartar pedido?</p>
                  <p className="text-xs text-zinc-500">{mesaNome}</p>
                </div>
              </div>
              <p className="text-sm text-zinc-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                Esta ação irá <strong className="text-red-600">cancelar este pedido</strong> sem registrar nenhum consumo. Não pode ser desfeito.
              </p>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setShowConfirmarDescartarAvulso(false)}
                className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
              >
                Voltar
              </button>
              <button
                onClick={() => { setShowConfirmarDescartarAvulso(false); onFecharConta?.(); }}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                <i className="ri-delete-bin-line" />
                Sim, descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistoricoFechamento && (
        <HistoricoFechamentoModal
          mesaNome={mesaNome}
          rodadas={rodadasParaConta}
          pessoasMesa={pessoasMesa}
          divisaoAtual={divisaoAtual}
          onConfirmar={() => { setShowHistoricoFechamento(false); onFecharConta?.(); }}
          onCancelar={() => setShowHistoricoFechamento(false)}
        />
      )}

      {/* Modal de confirmação de envio */}
      {showConfirmarEnvio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" style={{ maxHeight: 'min(90dvh, 90vh)' }}>
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 flex items-center justify-center bg-green-100 rounded-xl flex-shrink-0">
                  <i className="ri-send-plane-fill text-green-600 text-lg" />
                </div>
                <div>
                  <p className="font-bold text-zinc-900 text-sm">Confirmar envio ao KDS?</p>
                  <p className="text-xs text-zinc-500">{mesaNome}</p>
                </div>
              </div>

              {/* Resumo dos itens */}
              <div className="bg-zinc-50 rounded-xl p-3 mb-4 space-y-1.5 max-h-48 overflow-y-auto">
                {carrinho.map((item) => (
                  <div key={item.cartId} className="flex items-start gap-2">
                    <span className="text-xs font-bold text-amber-600 flex-shrink-0 w-5 text-right">{item.quantidade}x</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-800 leading-tight">{item.nome}</p>
                      {item.opcoes.length > 0 && (
                        <p className="text-[10px] text-zinc-400 truncate">{item.opcoes.map((o) => o.opcaoNome).join(' · ')}</p>
                      )}
                      {item.observacaoLivre && (
                        <p className="text-[10px] text-amber-600 truncate"><i className="ri-chat-1-line mr-0.5" />{item.observacaoLivre}</p>
                      )}
                    </div>
                    <span className="text-xs font-bold text-zinc-600 flex-shrink-0">{formatPrice(item.precoTotal * item.quantidade)}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between px-1 mb-4">
                <span className="text-xs text-zinc-500">Total do pedido</span>
                <span className="text-sm font-bold text-amber-600">{formatPrice(totalValor)}</span>
              </div>
            </div>

            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setShowConfirmarEnvio(false)}
                disabled={enviando}
                className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEnviarConfirmado}
                disabled={enviando}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {enviando ? (
                  <><i className="ri-loader-4-line animate-spin" />Enviando...</>
                ) : (
                  <><i className="ri-send-plane-line" />Confirmar</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add person modal */}
      {showAddPessoa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xs p-5 space-y-4">
            <h3 className="text-sm font-bold text-zinc-900">Adicionar Pessoa à Mesa</h3>
            <input
              type="text"
              value={novaPessoaNome}
              onChange={(e) => setNovaPessoaNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPessoa()}
              placeholder="Nome da pessoa..."
              autoFocus
              className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
              maxLength={30}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddPessoa(false)}
                className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddPessoa}
                disabled={!novaPessoaNome.trim()}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {showPagarDivisao && divisaoAtual && onPagarConta && (
        <PagarDivisaoModal
          mesaNome={mesaNome}
          divisao={divisaoAtual}
          pagamentoSalvo={divisaoPagamentoSalvo}
          onClose={() => setShowPagarDivisao(false)}
          onPagarCliente={async (clienteId, formaPagId, valor, nomeCliente) => {
            // Passa valorParcial para que o backend registre apenas o valor desta pessoa,
            // evitando marcar is_paid=true quando só parte da conta foi paga.
            const idsRodadas = rodadasParaConta.map((r) => r.id);
            await onPagarConta(idsRodadas, formaPagId, valor);
            // Persiste o estado de pagamento deste cliente
            onAtualizarDivisaoPag?.({
              clientes: {
                ...(divisaoPagamentoSalvo?.clientes ?? {}),
                [clienteId]: { formaPagId, valor: divisaoAtual.totalPorCliente[clienteId] ?? 0, pago: true, nome: nomeCliente },
              },
              atribuicoes: divisaoAtual.atribuicoes,
            });
          }}
          onEstadoChange={(estado) => onAtualizarDivisaoPag?.(estado)}
        />
      )}
    </div>
  );
}
