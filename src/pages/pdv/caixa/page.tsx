import { useState, useRef, useEffect, useCallback } from 'react';
import AvisoImpressao from '@/components/feature/AvisoImpressao';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppMode } from '@/contexts/AppModeContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { PDVProvider, usePDV } from '../../../contexts/PDVContext';
import { useSessao } from '../../../contexts/SessaoContext';
import { useKDS } from '../../../contexts/KDSContext';
import { useMesas } from '../../../contexts/MesasContext';
import { useToast } from '../../../contexts/ToastContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import type { DestinoInfo } from '../../../contexts/PDVContext';
import type { Item } from '@/types/cardapio';
import { useCardapio } from '../../../contexts/CardapioContext';
import { supabase } from '@/lib/supabase';
import { promoAtivaHoje } from '@/lib/promoUtils';
import CategoriaNav from './components/CategoriaNav';
import ItemGridPDV from './components/ItemGridPDV';
import CarrinhoPanel from './components/CarrinhoPanel';
import OpcoesModal from './components/OpcoesModal';
import DestinoModal from './components/DestinoModal';
import PagamentoModal from './components/PagamentoModal';
import PedidosRecentesPanel from './components/PedidosRecentesPanel';
import MesasPainelCaixa from './components/MesasPainelCaixa';
import CozinhaPainelCaixa from './components/CozinhaPainelCaixa';
import SangriaSuprimentoModal from './components/SangriaSuprimentoModal';
import DeliveryControle from './components/DeliveryControle';
import AbrirLojaView, { AberturaFeitaOverlay, type AberturaFeita } from './components/loja/AbrirLojaView';
import FecharLojaModal, { type TipoFechamento, type DestinoPDV } from './components/loja/FecharLojaModal';
import AbrirMesaCaixaModal from './components/AbrirMesaCaixaModal';
import OfflineStatusBar from '@/components/feature/OfflineStatusBar';
import AlertaSessaoEsquecida from '@/components/feature/AlertaSessaoEsquecida';
import AvisoInsumoZerado from '@/components/feature/AvisoInsumoZerado';
import EstoqueZerarModal from './components/EstoqueZerarModal';
import { useEstoqueAlertaPDV, type InsumoZerando } from '@/hooks/useEstoqueAlertaPDV';
import { useDeliveryState } from '@/hooks/useDeliveryState';
import { useCaixaPing } from '@/hooks/useCaixaPing';
import { useAvisoAcabouHoje } from '@/hooks/useAvisoAcabouHoje';

type ModalState = 'none' | 'opcoes' | 'destino' | 'pagamento' | 'sangria'
  | 'iniciar_sessao' | 'abertura_caixa' | 'fechar_sessao' | 'abrir_mesa';
type TabRight = 'carrinho' | 'mesas' | 'pedidos';

interface MovimentoCaixa {
  tipo: 'sangria' | 'suprimento';
  valor: number;
  motivo: string;
  hora: string;
}


/* ─── Tela: Carregando sessão ─── */
function CarregandoSessaoView() {
  return (
    <div className="flex flex-col h-full items-center justify-center p-8 text-center relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
    >
      <div className="relative z-10 flex flex-col items-center">
        <div className="w-16 h-16 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl mb-4">
          <i className="ri-loader-4-line animate-spin text-3xl text-amber-500" />
        </div>
        <p className="text-sm font-bold text-zinc-600">Verificando sessão...</p>
        <p className="text-xs text-zinc-400 mt-1">Aguarde um momento</p>
      </div>
    </div>
  );
}

/* ─── Dropdown de atalhos de teclado ─── */
function AtalhosTeclado() {
  const [open, setOpen] = useState(false);
  const { mesas } = useMesas();
  const { settings } = useSystemSettings();
  const enviarCozinhaAtivo = settings.pdv_config.caixa_enviar_cozinha !== false;

  const atalhos = [
    { tecla: 'F2',     desc: 'Abrir pagamento',       icon: 'ri-money-dollar-circle-line', color: 'text-amber-600' },
    ...(enviarCozinhaAtivo ? [{ tecla: 'Shift+F2', desc: 'Enviar p/ Cozinha', icon: 'ri-restaurant-line', color: 'text-stone-600' }] : []),
    { tecla: 'F3',     desc: 'Selecionar destino',    icon: 'ri-map-pin-line',             color: 'text-teal-600' },
    { tecla: 'F4',     desc: 'Limpar carrinho',       icon: 'ri-delete-bin-line',          color: 'text-red-500' },
    { tecla: 'F5',     desc: 'Ir para Carrinho',      icon: 'ri-shopping-cart-line',       color: 'text-zinc-500' },
    ...(mesas.length > 0 ? [{ tecla: 'F6', desc: 'Ir para Mesas', icon: 'ri-layout-grid-line', color: 'text-zinc-500' }] : []),
    { tecla: 'Espaço', desc: 'Focar busca',           icon: 'ri-search-line',              color: 'text-zinc-500' },
    { tecla: 'Esc',    desc: 'Fechar modal',          icon: 'ri-close-circle-line',        color: 'text-zinc-400' },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Atalhos de teclado"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
          open
            ? 'bg-zinc-800 text-white border-zinc-700'
            : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700'
        }`}
      >
        <i className="ri-keyboard-line text-sm" />
        <span className="hidden sm:inline">Atalhos</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-zinc-200 rounded-xl shadow-lg w-64 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-zinc-100 flex items-center gap-2">
              <i className="ri-keyboard-line text-zinc-400 text-sm" />
              <p className="text-xs font-bold text-zinc-700">Atalhos de Teclado</p>
            </div>
            <div className="py-1">
              {atalhos.map(({ tecla, desc, icon, color }) => (
                <div key={tecla} className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 transition-colors">
                  <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${color}`}>
                    <i className={`${icon} text-sm`} />
                  </div>
                  <span className="flex-1 text-xs text-zinc-600">{desc}</span>
                  <kbd className="flex-shrink-0 px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-[10px] font-mono font-bold text-zinc-600">
                    {tecla}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── PDV Operacional (caixa aberto) ─── */
interface PDVOperacionalProps {
  /** "Fechar a loja" (fim do dia) ou "Trocar de operador" (fecha só o caixa). */
  onFechar: (tipo: Exclude<TipoFechamento, 'dia'>) => void;
  /** Pedido do fluxo de fechamento para mostrar onde resolver a pendência (n muda a cada pedido). */
  irPara?: { destino: DestinoPDV; n: number } | null;
}

function PDVOperacional({ onFechar, irPara }: PDVOperacionalProps) {
  const { sessao, caixa } = useSessao();
  const navigate = useNavigate();
  const { setMode } = useAppMode();
  const { user } = useAuth();
  const { hasPermissao, loading: carregandoPermissoes } = usePermissoes();
  const { total, clearCart, destino, setDestino, addItem, carrinho, removeItem, enviarParaCozinha, finalizarPedido } = usePDV();
  const avisoAcabouHoje = useAvisoAcabouHoje();
  const { success: toastSuccess, error: toastError } = useToast();
  const { pedidos: kdsPedidos } = useKDS();
  // Configurações › Operação: a loja pode desligar o "Enviar para Cozinha" (pedido sem pagamento).
  const { settings: sysSettings } = useSystemSettings();
  const enviarCozinhaAtivo = sysSettings.pdv_config.caixa_enviar_cozinha !== false;
  // Mesa 0 (QR universal) já fica fora do MesasContext: loja só com o QR universal
  // não tem mesa de salão, então a aba/atalho de Mesas nem aparece.
  const { mesas } = useMesas();
  const temMesas = mesas.length > 0;
  // Count real orders from KDS (not the local sequential counter that resets on reload)
  const numeroPedidos = kdsPedidos.filter((p) => !p.itens.every((i) => i.skip_kds)).length;
  const { itensAtivos, categorias, obsGlobais } = useCardapio();

  const [categoriaAtiva, setCategoriaAtiva] = useState('todas');
  const [busca, setBusca] = useState('');
  const [modal, setModal] = useState<ModalState>('none');
  const [tipoMovimento, setTipoMovimento] = useState<'sangria' | 'suprimento'>('sangria');
  // /pdv/caixa?abrir=sangria&tipo=freelancer|outro|fornecedor ("O que aconteceu?", 2026-10-03): abre a
  // sangria já com o tipo marcado. Com o caixa fechado o link fica esperando (aviso no PDVCaixaInner).
  const [paramsUrl, setParamsUrl] = useSearchParams();
  const [motivoSangria, setMotivoSangria] = useState<'Freelancer' | 'Outro' | 'Fornecedor' | undefined>(undefined);
  useEffect(() => {
    if (paramsUrl.get('abrir') !== 'sangria' || carregandoPermissoes) return; // decide com a matriz da loja já carregada
    const t = paramsUrl.get('tipo');
    setParamsUrl({}, { replace: true });
    if (!hasPermissao('pdv_sangria')) return;
    setMotivoSangria(t === 'freelancer' ? 'Freelancer' : t === 'outro' ? 'Outro' : t === 'fornecedor' ? 'Fornecedor' : undefined);
    setTipoMovimento('sangria');
    setModal('sangria');
  }, [paramsUrl, setParamsUrl, hasPermissao, carregandoPermissoes]);
  const [itemSelecionado, setItemSelecionado] = useState<Item | null>(null);
  // Estado para abertura de mesa pelo caixa
  const [mesaParaAbrir, setMesaParaAbrir] = useState<{ id: string; numero: number } | null>(null);

  const [editingCartItem, setEditingCartItem] = useState<{
    item: Item;
    cartId: string;
    initialSelecionadas: import('../../../contexts/PDVContext').OpcaoSelecionada[];
    initialObsIndex: number[];
    initialObsLivre: string;
    initialQuantidade: number;
    initialObsUnidades: string[];
  } | null>(null);
  const [tabRight, setTabRight] = useState<TabRight>('carrinho');
  // Mobile tab: 'cardapio' | 'carrinho' | 'mesas' | 'pedidos'
  const [mobileTab, setMobileTab] = useState<'cardapio' | 'carrinho' | 'mesas' | 'pedidos'>('cardapio');
  const [historicoCaixa, setHistoricoCaixa] = useState<MovimentoCaixa[]>([]);
  const [totalVendasSessao, setTotalVendasSessao] = useState(0);
  const [pendingAction, setPendingAction] = useState<'cozinha' | 'pagamento' | null>(null);
  // Alerta de estoque zerando
  const [insumosZerandoAlerta, setInsumosZerandoAlerta] = useState<InsumoZerando[]>([]);
  const [acaoAposEstoqueConfirmar, setAcaoAposEstoqueConfirmar] = useState<(() => void) | null>(null);
  const { verificarEstoque } = useEstoqueAlertaPDV();
  // Estado de delivery: 1 instância compartilhada entre as variantes desktop/mobile
  // do DeliveryControle (as duas ficam montadas no DOM). Antes cada uma criava seu
  // próprio poll/canal, dobrando as invocações de Edge Function.
  const deliveryCtl = useDeliveryState();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isEnviandoCozinha, setIsEnviandoCozinha] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Carregar movimentações do banco ─────────────────────────────────────
  const loadMovimentacoes = useCallback(async () => {
    if (!caixa?.id) {
      console.warn('[PDVOperacional] loadMovimentacoes: caixa.id não disponível');
      return;
    }
    const { data, error } = await supabase
      .from('cash_movements')
      .select('id, type, amount, reason, created_at')
      .eq('cash_register_id', caixa.id)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[PDVOperacional] Erro ao carregar movimentações:', error);
      return;
    }
    if (data) {
      const movimentos: MovimentoCaixa[] = data.map((m) => ({
        tipo: m.type === 'out' ? 'sangria' : 'suprimento',
        valor: Number(m.amount),
        motivo: m.reason ?? '',
        hora: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
      }));
      setHistoricoCaixa(movimentos);
    }
  }, [caixa?.id]);

  // Carrega na montagem e sempre que caixa.id mudar
  useEffect(() => {
    loadMovimentacoes();
  }, [loadMovimentacoes]);

  // Recarrega quando a janela volta ao foco (voltar do módulo)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadMovimentacoes();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loadMovimentacoes]);

  // Mudou fora daqui (assistente, financeiro, outro caixa): o PDV não tem botão de atualizar
  useCaixaPing(user?.tenantId, loadMovimentacoes);

  // Global number map for quick-add by number
  const catsInativas = new Set(categorias.filter((c) => !c.ativo).map((c) => c.id));
  const numberToItem = new Map<number, Item>(
    itensAtivos
      .map((item, idx) => [idx + 1, item] as [number, Item])
      .filter(([, item]) => !catsInativas.has(item.categoriaId))
  );

  // Atalhos de teclado globais do PDV
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';

      // Escape — fecha qualquer modal aberto (exceto fechamento, que é controlado externamente)
      if (e.key === 'Escape') {
        setModal('none');
        setItemSelecionado(null);
        setEditingCartItem(null);
        setPendingAction(null);
        return;
      }

      // Não dispara atalhos se estiver digitando em um campo
      if (isTyping) return;

      // Espaço — foca a busca
      if (e.key === ' ') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      // F2 — abre pagamento (se carrinho tiver itens)
      if (e.key === 'F2' && !e.shiftKey) {
        e.preventDefault();
        if (carrinho.length > 0) handlePagar();
        return;
      }

      // Shift+F2 — enviar para cozinha (sem pagamento)
      if (e.key === 'F2' && e.shiftKey) {
        e.preventDefault();
        if (carrinho.length > 0 && enviarCozinhaAtivo) handleEnviarCozinha();
        return;
      }

      // F3 — abre seleção de destino
      if (e.key === 'F3') {
        e.preventDefault();
        setModal('destino');
        return;
      }

      // F4 — limpa o carrinho
      if (e.key === 'F4') {
        e.preventDefault();
        if (carrinho.length > 0) handleLimpar();
        return;
      }

      // F5 — alterna para aba Carrinho
      if (e.key === 'F5') {
        e.preventDefault();
        setTabRight('carrinho');
        return;
      }

      // F6 — alterna para aba Mesas
      if (e.key === 'F6') {
        e.preventDefault();
        if (temMesas) setTabRight('mesas');
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrinho.length, modal, temMesas, enviarCozinhaAtivo]);

  // Loja deixou de ter mesa (ou trocou de loja) com a aba Mesas aberta: volta pro carrinho.
  useEffect(() => {
    if (temMesas) return;
    setTabRight((t) => (t === 'mesas' ? 'carrinho' : t));
    setMobileTab((t) => (t === 'mesas' ? 'carrinho' : t));
  }, [temMesas]);


  // After destino is confirmed and we were waiting to pay
  // Chamado pelo DestinoModal quando o operador seleciona uma mesa livre
  const handleAbrirMesa = useCallback((mesaId: string, mesaNumero: number) => {
    setMesaParaAbrir({ id: mesaId, numero: mesaNumero });
    setModal('abrir_mesa');
  }, []);

  // Chamado após AbrirMesaCaixaModal confirmar que a mesa foi aberta
  const handleMesaAberta = useCallback((clienteNome: string) => {
    const mesa = mesaParaAbrir;
    if (!mesa) return;
    setMesaParaAbrir(null);
    setModal('none');
    // Monta o destino com os dados da mesa recém-aberta
    const destino: DestinoInfo = {
      tipo: 'mesa',
      mesaId: mesa.id,
      mesaNumero: mesa.numero,
      nomeCliente: clienteNome,
    };
    setDestino(destino);
    // Se tinha uma ação pendente, continua o fluxo
    if (pendingAction === 'pagamento') {
      setPendingAction(null);
      setTimeout(() => setModal('pagamento'), 50);
    } else if (pendingAction === 'cozinha') {
      setPendingAction(null);
      setIsEnviandoCozinha(true);
      enviarParaCozinha(destino)
        .then((result) => {
          const numStr = result?.number || `P${Date.now()}`;
          const printOk = result?.printEnqueued;
          avisoEnviado(numStr, printOk);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          toastError('Erro ao enviar para cozinha', msg);
        })
        .finally(() => setIsEnviandoCozinha(false));
    }
  }, [mesaParaAbrir, pendingAction, setDestino, enviarParaCozinha]);

  // Toast do pedido enviado sem pagamento: entrega diz que recebe na entrega (e como).
  const avisoEnviado = (numStr: string, printOk?: boolean, d: DestinoInfo | null = destino) => {
    const impressao = printOk ? ' · Ticket na fila de impressão' : '';
    if (d?.tipo === 'delivery') {
      toastSuccess('Pedido enviado para entrega!', `#${numStr} — receber na entrega${d.formaPagamento ? ` (${d.formaPagamento})` : ''}${impressao}`);
    } else {
      toastSuccess('Pedido enviado para cozinha!', `#${numStr} — pague depois${impressao}`);
    }
  };

  const handleDestinoConfirm = useCallback((d: DestinoInfo) => {
    setDestino(d);
    setModal('none');
    // Entrega (dono, 2026-10-02): o pagamento é recebido NA ENTREGA — "Finalizar" com destino delivery
    // manda o pedido sem cobrar (igual "Enviar para Cozinha"); quem já pagou usa "Já pagou? Receber agora".
    if (pendingAction === 'pagamento' && d.tipo !== 'delivery') {
      setPendingAction(null);
      setTimeout(() => setModal('pagamento'), 50);
    } else if (pendingAction === 'cozinha' || pendingAction === 'pagamento') {
      setPendingAction(null);
      setIsEnviandoCozinha(true);
      // Passa o destino confirmado diretamente para o enviarParaCozinha
      // evitando que o estado desatualizado do React cause perda da identificação
      enviarParaCozinha(d)
        .then((result) => {
          const numStr = result?.number || `P${Date.now()}`;
          const printOk = result?.printEnqueued;
          avisoEnviado(numStr, printOk, d);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          toastError('Erro ao enviar para cozinha', msg);
        })
        .finally(() => setIsEnviandoCozinha(false));
    }
  }, [pendingAction, setDestino, enviarParaCozinha]);

  const handleItemClick = (item: Item) => {
    const temOpcoes = item.gruposOpcoes.length > 0;
    if (temOpcoes) {
      setItemSelecionado(item);
      setEditingCartItem(null);
      setModal('opcoes');
      return;
    }
    const promoAtiva = promoAtivaHoje(item.promocoes);
    const precoBase = promoAtiva ? promoAtiva.precoPromocional : item.preco;
    const cat = categorias.find((c) => c.id === item.categoriaId);
    addItem({
      itemId: item.id,
      nome: item.nome,
      precoBase,
      precoTotal: precoBase,
      quantidade: 1,
      opcoes: [],
      observacoes: [],
      observacaoLivre: '',
      semPreparo: item.semPreparo ?? false,
      stationId: cat?.estacaoId ?? undefined,
      subproducao: item.subproducao?.filter(sp => sp.estacaoId)
        .map(sp => ({ nome: sp.nome, estacaoId: sp.estacaoId!, estacao: sp.estacao })) ?? undefined,
    });
    // On mobile, show a brief feedback by switching to cart tab
    setTimeout(() => setMobileTab('carrinho'), 150);
  };

  const handleItemObs = (item: Item) => {
    setItemSelecionado(item);
    setEditingCartItem(null);
    setModal('opcoes');
  };

  // Enter pressed in search with a number → add item
  const handleSearchEnter = () => {
    const isPureNumber = /^\d+$/.test(busca.trim());
    if (!isPureNumber) return;
    const num = parseInt(busca.trim(), 10);
    const item = numberToItem.get(num);
    if (!item) return;
    setBusca('');
    searchRef.current?.blur();
    setItemSelecionado(item);
    setEditingCartItem(null);
    setModal('opcoes');
  };

  // Edit item in cart
  const handleEditItem = (cartId: string) => {
    const cartItem = carrinho.find((ci) => ci.cartId === cartId);
    if (!cartItem) return;
    const originalItem = itensAtivos.find((i) => i.id === cartItem.itemId);
    if (!originalItem) return;
    // Mescla obs específicas + globais ativas para reconstruir os índices corretamente
    const obsMescladas = [
      ...originalItem.observacoesPadrao,
      ...obsGlobais
        .filter((og) => og.ativo && !og.excludedItemIds?.includes(originalItem.id) && !og.excludedCategoryIds?.includes(originalItem.categoriaId))
        .map((og) => og.texto)
        .filter((t) => !originalItem.observacoesPadrao.includes(t)),
    ];
    const obsIndex = cartItem.observacoes
      .map((obs) => obsMescladas.indexOf(obs))
      .filter((idx) => idx >= 0);
    setItemSelecionado(originalItem);
    setEditingCartItem({
      item: originalItem,
      cartId,
      initialSelecionadas: cartItem.opcoes,
      initialObsIndex: obsIndex,
      initialObsLivre: cartItem.observacaoLivre,
      initialQuantidade: cartItem.quantidade,
      initialObsUnidades: cartItem.obsUnidades ?? [],
    });
    setModal('opcoes');
  };

  // ── Verificação de estoque antes de pagar/enviar cozinha ─────────────────
  const verificarEContinuar = useCallback(async (acao: () => void) => {
    const resultado = await verificarEstoque(carrinho);
    if (resultado.temAlerta) {
      setInsumosZerandoAlerta(resultado.insumosZerando);
      setAcaoAposEstoqueConfirmar(() => acao);
    } else {
      acao();
    }
  }, [verificarEstoque, carrinho]);

  // Finalizar: check destino first
  const handlePagar = async () => {
    // "Acabou hoje": item que entrou no pedido antes de ser pausado no Cardápio. Tirar = remove e para aqui
    // (a pessoa confere o total e finaliza de novo); Vender assim mesmo = segue.
    const tirar = await avisoAcabouHoje(carrinho);
    if (tirar) {
      carrinho.filter((ci) => tirar.has(ci.itemId)).forEach((ci) => removeItem(ci.cartId));
      return;
    }
    const executarPagamento = () => {
      if (!destino) {
        setPendingAction('pagamento');
        setModal('destino');
      } else {
        setModal('pagamento');
      }
    };
    verificarEContinuar(executarPagamento);
  };

  const handleEnviarCozinha = async () => {
    const executarEnvio = async () => {
      if (!destino) {
        setPendingAction('cozinha');
        setModal('destino');
        return;
      }
      setIsEnviandoCozinha(true);
      try {
        const result = await enviarParaCozinha();
        const numStr = result?.number || `P${Date.now()}`;
        const printOk = result?.printEnqueued;
        avisoEnviado(numStr, printOk);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toastError('Erro ao enviar para cozinha', msg);
      } finally {
        setIsEnviandoCozinha(false);
      }
    };
    verificarEContinuar(executarEnvio);
  };

  const handlePagamentoSuccess = () => {
    setTotalVendasSessao((prev) => prev + total);
    setModal('none');
  };

  const handleLimpar = () => {
    clearCart();
  };

  const handleRegistrarMovimento = (mov: MovimentoCaixa) => {
    setHistoricoCaixa((prev) => [...prev, mov]);
    // Recarrega do banco para garantir sincronização
    loadMovimentacoes();
  };

  // O fechamento veio daqui e pediu para mostrar onde resolver (pedidos, mesas ou a sangria).
  const irParaVisto = useRef(irPara?.n ?? 0);
  useEffect(() => {
    if (!irPara || irPara.n === irParaVisto.current) return;
    irParaVisto.current = irPara.n;
    if (irPara.destino === 'sangria') {
      if (hasPermissao('pdv_sangria')) { setTipoMovimento('sangria'); setModal('sangria'); }
      return;
    }
    const aba = irPara.destino === 'mesas' && !temMesas ? 'pedidos' : irPara.destino;
    setTabRight(aba);
    setMobileTab(aba);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irPara?.n]);
  const [menuMais, setMenuMais] = useState(false);

  const now = new Date();
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });

  const carrinhoCount = carrinho.reduce((a, i) => a + i.quantidade, 0);

  return (
    <div className="flex flex-col h-full bg-zinc-50 overflow-hidden">
      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-2.5 bg-white border-b border-zinc-100 flex-shrink-0 flex-wrap gap-y-2">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          {/* Botão Módulos integrado na top bar */}
          <button
            onClick={() => { setMode('modulos'); navigate('/modulos'); }}
            title="Voltar aos Módulos"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 cursor-pointer transition-colors flex-shrink-0"
          >
            <i className="ri-arrow-left-line text-sm" />
          </button>

          <div className="w-px h-4 bg-zinc-200 flex-shrink-0" />

          <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-bold hidden sm:inline">Loja aberta{sessao?.iniciadaEm ? ` desde ${sessao.iniciadaEm}` : ''}</span>
          </div>
          {historicoCaixa.length > 0 && (
            <span className="text-xs text-zinc-400 border-l border-zinc-200 pl-3 hidden md:inline">
              {historicoCaixa.filter((m) => m.tipo === 'sangria').length} retirada(s) ·{' '}
              {historicoCaixa.filter((m) => m.tipo === 'suprimento').length} adição(ões)
            </span>
          )}
        </div>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-2 lg:gap-4 flex-wrap justify-end">
          <div className="text-right">
            <p className="text-sm font-bold text-zinc-900">{timeStr}</p>
            <p className="text-[10px] text-zinc-400 capitalize">{dateStr}</p>
          </div>
          <div className="flex items-center gap-2">
            <AtalhosTeclado />
            {hasPermissao('pdv_sangria') && (
              <button
                onClick={() => { setTipoMovimento('sangria'); setModal('sangria'); }}
                className="flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-arrow-down-circle-line text-sm" />
                Sangria
              </button>
            )}
            {hasPermissao('pdv_sangria') && (
              <button
                onClick={() => { setTipoMovimento('suprimento'); setModal('sangria'); }}
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-arrow-up-circle-line text-sm" />
                Suprimento
              </button>
            )}
            <div className="w-px h-5 bg-zinc-200" />
            <DeliveryControle ctl={deliveryCtl} />
            {hasPermissao('pdv_fechar_caixa') && (
              <>
                <button
                  onClick={() => onFechar('loja')}
                  className="flex items-center gap-1.5 text-xs font-bold text-white bg-zinc-900 hover:bg-zinc-700 border border-zinc-900 px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-store-2-line text-sm" />
                  Fechar a loja
                </button>
                <div className="relative">
                  <button
                    onClick={() => setMenuMais((v) => !v)}
                    title="Mais opções"
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 cursor-pointer"
                  >
                    <i className="ri-more-2-fill" />
                  </button>
                  {menuMais && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuMais(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-zinc-200 rounded-xl shadow-lg w-60 overflow-hidden">
                        <button
                          onClick={() => { setMenuMais(false); onFechar('trocar'); }}
                          className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-50 cursor-pointer"
                        >
                          <i className="ri-user-shared-line text-base text-zinc-500 mt-0.5" />
                          <span>
                            <span className="block text-sm font-semibold text-zinc-800">Trocar de operador</span>
                            <span className="block text-[11px] text-zinc-400">Fecha só o caixa; a loja segue aberta</span>
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Mobile actions */}
        <div className="flex md:hidden items-center gap-2">
          <span className="text-sm font-bold text-zinc-900">{timeStr}</span>
          <DeliveryControle compact ctl={deliveryCtl} />
          <div className="relative">
            <button
              onClick={() => setShowMobileMenu((v) => !v)}
              className="w-8 h-8 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-more-2-fill text-zinc-600 text-base" />
            </button>
            {showMobileMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMobileMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-zinc-200 rounded-xl w-48 overflow-hidden">
                  {hasPermissao('pdv_sangria') && (
                    <button
                      onClick={() => { setTipoMovimento('sangria'); setModal('sangria'); setShowMobileMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
                    >
                      <i className="ri-arrow-down-circle-line" /> Sangria
                    </button>
                  )}
                  {hasPermissao('pdv_sangria') && (
                    <button
                      onClick={() => { setTipoMovimento('suprimento'); setModal('sangria'); setShowMobileMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-emerald-600 hover:bg-emerald-50 cursor-pointer transition-colors"
                    >
                      <i className="ri-arrow-up-circle-line" /> Suprimento
                    </button>
                  )}
                  <div className="h-px bg-zinc-100" />
                  {hasPermissao('pdv_fechar_caixa') && (
                    <>
                      <button
                        onClick={() => { setShowMobileMenu(false); onFechar('trocar'); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors"
                      >
                        <i className="ri-user-shared-line" /> Trocar de operador
                      </button>
                      <button
                        onClick={() => { setShowMobileMenu(false); onFechar('loja'); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-bold text-zinc-900 hover:bg-zinc-50 cursor-pointer transition-colors"
                      >
                        <i className="ri-store-2-line" /> Fechar a loja
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Banner de status offline ── */}
      <OfflineStatusBar />

      {/* ── Alerta de sessão esquecida ── */}
      <div className="px-4 pt-2">
        <AlertaSessaoEsquecida onFecharLoja={() => onFechar('loja')} />
      </div>

      {/* ── Insumo zerou: tira ou não os itens do cardápio? (também aparece no KDS) ── */}
      <div className="px-4 pt-2">
        <AvisoInsumoZerado origem="pdv" />
      </div>

      {/* ── DESKTOP LAYOUT: side-by-side ── */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        {/* LEFT: Cardápio */}
        <div className="flex flex-col flex-1 min-w-0 bg-zinc-50">
          <CategoriaNav
            categoriaAtiva={categoriaAtiva}
            busca={busca}
            onCategoria={setCategoriaAtiva}
            onBusca={setBusca}
            searchRef={searchRef}
            onEnter={handleSearchEnter}
          />
          <div className="flex-1 overflow-hidden">
            <ItemGridPDV
              categoriaAtiva={categoriaAtiva}
              busca={busca}
              onItemClick={handleItemClick}
              onItemObs={handleItemObs}
            />
          </div>
        </div>

        {/* RIGHT: Cart + Pedidos */}
        <div className="w-72 lg:w-80 xl:w-96 flex-shrink-0 flex flex-col bg-white border-l border-zinc-200">
          <div className="flex border-b border-zinc-200 bg-zinc-50 flex-shrink-0">
            {([
              { key: 'carrinho', icon: 'ri-shopping-cart-line', label: 'Carrinho', badge: carrinhoCount },
              { key: 'mesas',    icon: 'ri-layout-grid-line',   label: 'Mesas' },
              { key: 'pedidos',  icon: 'ri-file-list-3-line',   label: 'Pedidos', badge: numeroPedidos },
            ] as const).filter((t) => t.key !== 'mesas' || temMesas).map(({ key, icon, label, badge }) => (
              <button
                key={key}
                onClick={() => setTabRight(key)}
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  tabRight === key
                    ? 'bg-white text-amber-600 border-b-2 border-amber-500'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <i className={`${icon} mr-1`} />
                {label}
                {badge != null && badge > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-amber-500 text-white text-[9px] font-black rounded-full">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {tabRight === 'carrinho' && (
              <CarrinhoPanel
                onDestino={() => setModal('destino')}
                onPagar={handlePagar}
                onEnviarEntrega={handleEnviarCozinha}
                onLimpar={handleLimpar}
                onEditItem={handleEditItem}
                onEnviarCozinha={enviarCozinhaAtivo ? handleEnviarCozinha : undefined}
                onVincularPedidos={handlePagar}
              />
            )}
            {tabRight === 'mesas' && (
              <MesasPainelCaixa
                onAddItemsMesa={(mesa) => {
                  setDestino({
                    tipo: 'mesa',
                    mesaId: mesa.id,
                    mesaNumero: mesa.numero,
                    nomeCliente: mesa.clienteNome ?? undefined,
                  });
                  setTabRight('carrinho');
                }}
              />
            )}
            {tabRight === 'pedidos' && <PedidosRecentesPanel />}
          </div>
        </div>
      </div>

      {/* ── MOBILE LAYOUT: tab-based full screen ── */}
      <div className="flex md:hidden flex-col flex-1 overflow-hidden">
        {/* Mobile content area */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'cardapio' && (
            <div className="flex flex-col h-full bg-zinc-50">
              <CategoriaNav
                categoriaAtiva={categoriaAtiva}
                busca={busca}
                onCategoria={setCategoriaAtiva}
                onBusca={setBusca}
                searchRef={searchRef}
                onEnter={handleSearchEnter}
              />
              <div className="flex-1 overflow-hidden">
                <ItemGridPDV
                  categoriaAtiva={categoriaAtiva}
                  busca={busca}
                  onItemClick={(item) => {
                    handleItemClick(item);
                  }}
                  onItemObs={handleItemObs}
                />
              </div>
            </div>
          )}
          {mobileTab === 'carrinho' && (
            <CarrinhoPanel
              onDestino={() => setModal('destino')}
              onPagar={handlePagar}
              onEnviarEntrega={handleEnviarCozinha}
              onLimpar={handleLimpar}
              onEditItem={handleEditItem}
              onEnviarCozinha={enviarCozinhaAtivo ? handleEnviarCozinha : undefined}
              onVincularPedidos={handlePagar}
            />
          )}
          {mobileTab === 'mesas' && (
            <MesasPainelCaixa
              onAddItemsMesa={(mesa) => {
                setDestino({
                  tipo: 'mesa',
                  mesaId: mesa.id,
                  mesaNumero: mesa.numero,
                  nomeCliente: mesa.clienteNome ?? undefined,
                });
                setMobileTab('carrinho');
              }}
            />
          )}
          {mobileTab === 'pedidos' && <PedidosRecentesPanel />}
        </div>

        {/* Mobile bottom tab bar */}
        <div className="flex-shrink-0 bg-white border-t border-zinc-200 flex items-stretch">
          {([
            { key: 'cardapio', icon: 'ri-restaurant-2-line', label: 'Cardápio' },
            { key: 'carrinho', icon: 'ri-shopping-cart-line', label: 'Carrinho', badge: carrinhoCount },
            { key: 'mesas',    icon: 'ri-layout-grid-line',   label: 'Mesas' },
            { key: 'pedidos',  icon: 'ri-file-list-3-line',   label: 'Pedidos', badge: numeroPedidos },
          ] as const).filter((t) => t.key !== 'mesas' || temMesas).map(({ key, icon, label, badge }) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 cursor-pointer transition-colors relative ${
                mobileTab === key ? 'text-amber-600' : 'text-zinc-400'
              }`}
            >
              <div className="relative w-6 h-6 flex items-center justify-center">
                <i className={`${icon} text-xl`} />
                {badge != null && badge > 0 && (
                  <span className="absolute -top-1 -right-1.5 bg-amber-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold">{label}</span>
              {mobileTab === key && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-amber-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Modal de alerta de estoque zerando */}
      {insumosZerandoAlerta.length > 0 && (
        <EstoqueZerarModal
          insumosZerando={insumosZerandoAlerta}
          onConfirmar={() => {
            const acao = acaoAposEstoqueConfirmar;
            setInsumosZerandoAlerta([]);
            setAcaoAposEstoqueConfirmar(null);
            if (acao) acao();
          }}
          onCancelar={() => {
            setInsumosZerandoAlerta([]);
            setAcaoAposEstoqueConfirmar(null);
          }}
        />
      )}

      {modal === 'opcoes' && itemSelecionado && (
        <OpcoesModal
          item={itemSelecionado}
          editMode={!!editingCartItem}
          initialSelecionadas={editingCartItem?.initialSelecionadas}
          initialObsIndex={editingCartItem?.initialObsIndex}
          initialObsLivre={editingCartItem?.initialObsLivre}
          initialQuantidade={editingCartItem?.initialQuantidade}
          initialObsUnidades={editingCartItem?.initialObsUnidades}
          onAdd={(ci) => {
            if (editingCartItem) {
              removeItem(editingCartItem.cartId);
            }
            addItem(ci);
            setModal('none');
            setItemSelecionado(null);
            setEditingCartItem(null);
          }}
          onClose={() => {
            setModal('none');
            setItemSelecionado(null);
            setEditingCartItem(null);
          }}
        />
      )}
      {modal === 'destino' && (
        <DestinoModal
          current={destino}
          onConfirm={handleDestinoConfirm}
          onClose={() => { setModal('none'); setPendingAction(null); }}
          onAbrirMesa={handleAbrirMesa}
        />
      )}
      {modal === 'abrir_mesa' && mesaParaAbrir && (
        <AbrirMesaCaixaModal
          mesaId={mesaParaAbrir.id}
          mesaNumero={mesaParaAbrir.numero}
          onConfirmed={handleMesaAberta}
          onClose={() => {
            setMesaParaAbrir(null);
            setModal('destino');
          }}
        />
      )}
      {modal === 'pagamento' && (
        <PagamentoModal
          onClose={() => setModal('none')}
          onSuccess={handlePagamentoSuccess}
        />
      )}
      {modal === 'sangria' && (
        <SangriaSuprimentoModal
          tipoInicial={tipoMovimento}
          motivoInicial={motivoSangria}
          historico={historicoCaixa}
          onRegistrar={handleRegistrarMovimento}
          onClose={() => {
            setModal('none');
            setMotivoSangria(undefined);
            loadMovimentacoes();
          }}
        />
      )}
    </div>
  );
}

/* ─── Controlador principal ─── */
// "Abrir a loja" / "Fechar a loja" (2026-10-03): o usuário não vê mais "sessão" × "caixa".
//   sem_sessao    → AbrirLojaView modo 'loja' (abre dia + caixa)
//   sessao_aberta → AbrirLojaView modo 'caixa' (troca de operador ou dia que ficou aberto)
//   caixa_aberto  → PDV
// O FecharLojaModal fica AQUI (não no PDVOperacional) porque o PDV desmonta quando o caixa/dia fecha.
function PDVCaixaInner() {
  const { estado, loadingSession, sincronizarSessao } = useSessao();
  const navigate = useNavigate();
  const { setMode } = useAppMode();
  const [fechar, setFechar] = useState<TipoFechamento | null>(null);
  const [aberta, setAberta] = useState<AberturaFeita | null>(null);
  const [irPara, setIrPara] = useState<{ destino: DestinoPDV; n: number } | null>(null);
  // Link de sangria com o caixa fechado (dono, 2026-10-03): só avisa; o link fica e a sangria abre quando o caixa abrir.
  const [paramsUrl, setParamsUrl] = useSearchParams();
  const pedeSangria = paramsUrl.get('abrir') === 'sangria';

  const handleVoltar = () => {
    setMode('modulos');
    navigate('/modulos');
  };

  if (loadingSession) {
    return <CarregandoSessaoView />;
  }

  return (
    <>
      {pedeSangria && estado !== 'caixa_aberto' && (
        <div className="fixed top-3 inset-x-3 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[440px] z-[60] bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl p-3.5 shadow-lg flex gap-2.5 text-sm">
          <i className="ri-safe-2-line text-xl text-amber-600 flex-shrink-0" />
          <p className="flex-1"><b>Abra o caixa para fazer a sangria.</b> Assim que o caixa abrir, a sangria aparece sozinha.</p>
          <button onClick={() => setParamsUrl({}, { replace: true })} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-100 cursor-pointer flex-shrink-0" aria-label="Fechar aviso">
            <i className="ri-close-line text-lg" />
          </button>
        </div>
      )}
      {/* Uma instância só: se a loja abrir e o caixa falhar, a tela vira 'caixa' sem perder a contagem nem o erro. */}
      {estado !== 'caixa_aberto' && (
        <AbrirLojaView
          modo={estado === 'sem_sessao' ? 'loja' : 'caixa'}
          onVoltar={handleVoltar}
          onAberta={setAberta}
          onFecharDia={() => setFechar('dia')}
        />
      )}
      {estado === 'caixa_aberto' && (
        <PDVOperacional onFechar={(t) => setFechar(t)} irPara={irPara} />
      )}

      {aberta && <AberturaFeitaOverlay info={aberta} onFechar={() => setAberta(null)} />}

      {fechar && (
        <FecharLojaModal
          tipo={fechar}
          onClose={() => { setFechar(null); sincronizarSessao(); }}
          onIrPara={estado === 'caixa_aberto'
            ? (destino) => { setFechar(null); setIrPara((v) => ({ destino, n: (v?.n ?? 0) + 1 })); }
            : undefined}
        />
      )}
    </>
  );
}

export default function PDVCaixaPage() {
  return (
    <PDVProvider>
      <PDVCaixaInner />
      <AvisoImpressao />
    </PDVProvider>
  );
}