import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSessao } from '../../contexts/SessaoContext';
import { useMesaEdicao } from '../../contexts/MesaEdicaoContext';
import { useKDS, buildKDSPedido } from '../../contexts/KDSContext';
import { useMesas } from '../../contexts/MesasContext';
import { useCardapio } from '../../contexts/CardapioContext';
import { useAuth } from '../../contexts/AuthContext';
import { useKioskAuth } from '../../contexts/KioskAuthContext';
import { useEstoque } from '../../contexts/EstoqueContext';
import { supabase, SUPABASE_URL } from '../../lib/supabase';
import type { CarrinhoItem, DestinoInfo } from '../../contexts/PDVContext';
import IdentificacaoModal from './components/IdentificacaoModal';
import CardapioPublico from './components/CardapioPublico';
import CarrinhoCliente from './components/CarrinhoCliente';
import ChamarGarcomPanel from './components/ChamarGarcomPanel';
import PagamentoMesaView from './components/PagamentoMesaView';
import EditarItemCarrinhoModal from './components/EditarItemCarrinhoModal';
import EncerrarMesaModal from './components/EncerrarMesaModal';
import MeusPedidosModal from './components/MeusPedidosModal';
import { type ItemPedidoCliente } from '../../types/mesaCliente';

export interface OrderItemStatus {
  id: string;
  item_name: string;
  quantity: number;
  status: 'new' | 'preparing' | 'ready' | 'delivered';
  order_id: string;
}

type Tab = 'cardapio' | 'pedido' | 'chamar' | 'pagar';
type SessaoStatus = 'loading' | 'open' | 'closed' | 'not_found';

interface ClienteMesa {
  nome: string;
  telefone: string;
}

// ── LocalStorage helpers (carrinho apenas) ─────────────────────────────────────

function getCarrinhoKey(mesaNum: number, sessionId: string) {
  return `mesa_carrinho_${mesaNum}_${sessionId}`;
}

function loadCarrinho(mesaNum: number, sessionId: string): ItemPedidoCliente[] {
  try {
    const raw = localStorage.getItem(getCarrinhoKey(mesaNum, sessionId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCarrinho(mesaNum: number, sessionId: string, carrinho: ItemPedidoCliente[]) {
  try {
    localStorage.setItem(getCarrinhoKey(mesaNum, sessionId), JSON.stringify(carrinho));
  } catch { /* ignore */ }
}

function clearCarrinho(mesaNum: number, sessionId: string) {
  try {
    localStorage.removeItem(getCarrinhoKey(mesaNum, sessionId));
  } catch { /* ignore */ }
}

// ── Supabase URL ───────────────────────────────────────────────────────────────
const TABLE_WRITE_URL = `${SUPABASE_URL}/functions/v1/table-write`;

async function fetchTableSessionStatus(mesaNum: number, tenantId: string) {
  const res = await fetch(TABLE_WRITE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_table_session_status', table_number: mesaNum, tenant_id: tenantId }),
  });
  return res.json();
}

async function saveCustomerNameToSession(tableSessionId: string, customerName: string) {
  await fetch(TABLE_WRITE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save_customer_name', table_session_id: tableSessionId, customer_name: customerName }),
  });
}

async function closeTableByCustomer(tableSessionId: string): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const res = await fetch(TABLE_WRITE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'close_table_by_customer', table_session_id: tableSessionId }),
  });
  return res.json();
}

export default function MesaClientePage() {
  const { mesaId } = useParams<{ mesaId: string }>();
  const mesaNum = mesaId ? parseInt(mesaId, 10) || 1 : 1;
  const { estado } = useSessao();
  const { iniciarEdicao, finalizarEdicao } = useMesaEdicao();
  const { pedidos: kdsPedidos, addPedido: addKDSPedido, stationMap: kdsStationMap } = useKDS();
  const { mesas, atualizarMesa } = useMesas();
  const { itensPublicos } = useCardapio();
  const { itensDesabilitadosIds } = useEstoque();
  const { user } = useAuth();
  const { kioskSession } = useKioskAuth();
  // ── Sessão do banco ──────────────────────────────────────────────────────────
  const [sessaoStatus, setSessaoStatus] = useState<SessaoStatus>('loading');
  const [tableSessionId, setTableSessionId] = useState<string | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [mesaZona, setMesaZona] = useState<string>('Salão');
  const [mesaCapacidade, setMesaCapacidade] = useState<number>(4);

  // ── Estado do cliente ────────────────────────────────────────────────────────
  const [identificado, setIdentificado] = useState(false);
  const [clienteNome, setClienteNome] = useState('');
  const [tab, setTab] = useState<Tab>('cardapio');
  const [carrinho, setCarrinho] = useState<ItemPedidoCliente[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [feedbackEnvio, setFeedbackEnvio] = useState(false);
  const [erroEnvio, setErroEnvio] = useState('');
  const [editarIndex, setEditarIndex] = useState<number | null>(null);
  const [modoEdicaoEnviados, setModoEdicaoEnviados] = useState(false);
  const [carrinhoSnapshot, setCarrinhoSnapshot] = useState<ItemPedidoCliente[]>([]);
  const [feedbackEdicao, setFeedbackEdicao] = useState(false);
  const [isResponsavel, setIsResponsavel] = useState(false);
  const [entradaPermitida, setEntradaPermitida] = useState(true);
  const [clientesMesa, setClientesMesa] = useState<ClienteMesa[]>([]);
  const [horaAbertura, setHoraAbertura] = useState<string | undefined>(undefined);
  const [responsavelNome, setResponsavelNome] = useState('');

  // ── Modal encerrar mesa ──────────────────────────────────────────────────────
  const [showEncerrarModal, setShowEncerrarModal] = useState(false);
  const [mesaEncerrada, setMesaEncerrada] = useState(false);
  const [showMeusPedidos, setShowMeusPedidos] = useState(false);

  // ── Status dos itens em tempo real ──────────────────────────────────────────
  const [orderItemsStatus, setOrderItemsStatus] = useState<OrderItemStatus[]>([]);

  // ── TenantId: usuário autenticado OU kiosk (acesso público) ───────────────────
  const tenantId = user?.tenantId ?? kioskSession?.tenantId ?? null;
  const carrinhoSavedRef = useRef(false);

  // ── Limpar erro de envio quando o carrinho mudar ────────────────────────────
  useEffect(() => {
    if (erroEnvio) {
      setErroEnvio('');
    }
  }, [carrinho]);

  // ── 1. Validar sessão no banco ao entrar ─────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return;

    setSessaoStatus('loading');

    fetchTableSessionStatus(mesaNum, tenantId)
      .then((result) => {
        if (result.session_status === 'open' && result.session) {
          const sess = result.session;
          setTableSessionId(sess.id);
          setSessaoStatus('open');

          if (result.table) {
            setTableId(result.table.id);
            setMesaZona(result.table.area ?? 'Salão');
            setMesaCapacidade(result.table.capacity ?? 4);
          }

          // Restaurar nome do banco se existir
          if (sess.customer_name) {
            setClienteNome(sess.customer_name);
            setIdentificado(true);
            setIsResponsavel(true);
            setResponsavelNome(sess.customer_name);
            setEntradaPermitida(sess.entrada_permitida ?? true);
            if (sess.opened_at) {
              const d = new Date(sess.opened_at);
              setHoraAbertura(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
            }
            setClientesMesa([{ nome: sess.customer_name, telefone: '' }]);

            // Restaurar carrinho do localStorage (validando que a sessão ainda está aberta)
            const carrinhoSalvo = loadCarrinho(mesaNum, sess.id);
            if (carrinhoSalvo.length > 0) {
              setCarrinho(carrinhoSalvo);
            }
          } else {
            // Primeiro cliente — inicializar do banco também
            setEntradaPermitida(sess.entrada_permitida ?? true);
          }
        } else if (result.session_status === 'closed' || result.session_status === 'not_found') {
          setSessaoStatus('closed');
          // Limpar localStorage de qualquer sessão anterior desta mesa
          try {
            const keys = Object.keys(localStorage).filter((k) => k.startsWith(`mesa_carrinho_${mesaNum}_`));
            keys.forEach((k) => localStorage.removeItem(k));
          } catch { /* ignore */ }
        } else {
          setSessaoStatus('not_found');
        }
      })
      .catch(() => {
        // Em caso de erro de rede, deixar entrar (fallback gracioso)
        setSessaoStatus('open');
      });
  }, [mesaNum, tenantId]);

  // ── 2. Salvar carrinho no localStorage quando mudar ──────────────────────────
  useEffect(() => {
    if (tableSessionId && carrinho.length > 0) {
      saveCarrinho(mesaNum, tableSessionId, carrinho);
      carrinhoSavedRef.current = true;
    }
  }, [carrinho, mesaNum, tableSessionId]);

  // ── 3. Supabase Realtime: detectar fechamento da mesa pelo garçom ───────────
  useEffect(() => {
    if (!tableSessionId) return;

    const channel = supabase
      .channel(`table-session-${tableSessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'table_sessions',
        filter: `id=eq.${tableSessionId}`,
      }, (payload) => {
        if (payload.new?.status === 'closed') {
          setSessaoStatus('closed');
          localStorage.removeItem(`mesa_carrinho_${mesaNum}_${tableSessionId}`);
        }
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [tableSessionId, mesaNum]);

  // ── 4. Supabase Realtime: status dos itens pedidos ───────────────────────────
  const fetchOrderItemsStatus = useCallback(async () => {
    if (!tableSessionId) return;
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('table_session_id', tableSessionId)
      .neq('status', 'cancelled');

    const orderIds = (orders ?? []).map((o: { id: string }) => o.id);
    if (orderIds.length === 0) {
      setOrderItemsStatus([]);
      return;
    }

    const { data: items } = await supabase
      .from('order_items')
      .select('id, item_name, quantity, status, order_id')
      .in('order_id', orderIds)
      .order('created_at', { ascending: true });

    setOrderItemsStatus((items ?? []) as OrderItemStatus[]);
  }, [tableSessionId]);

  useEffect(() => {
    if (!tableSessionId || sessaoStatus !== 'open') return;

    fetchOrderItemsStatus();

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupSubscription = async () => {
      const { data: orders } = await supabase
        .from('orders')
        .select('id')
        .eq('table_session_id', tableSessionId)
        .neq('status', 'cancelled');

      const orderIds = (orders ?? []).map((o: { id: string }) => o.id);
      if (orderIds.length === 0) return;

      channel = supabase
        .channel(`mesa-${tableSessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'order_items',
            filter: `order_id=in.(${orderIds.join(',')})`,
          },
          () => {
            fetchOrderItemsStatus();
          }
        )
        .subscribe();
    };

    setupSubscription();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [tableSessionId, sessaoStatus, fetchOrderItemsStatus]);

  // ── 3. Verificar condições para encerrar mesa após pagamento ─────────────────
  const verificarCondicoesEncerramento = useCallback(async (): Promise<boolean> => {
    if (!tableSessionId) return false;
    const result = await closeTableByCustomer(tableSessionId);
    // Se retornou ok, a mesa foi fechada
    if (result.ok) return true;
    // Se retornou erro de validação, não pode fechar ainda
    return false;
  }, [tableSessionId]);

  const handleEncerrarMesa = useCallback(async (): Promise<{ success: boolean; message?: string }> => {
    if (!tableSessionId) return { success: false, message: 'Sessão não encontrada.' };
    const result = await closeTableByCustomer(tableSessionId);
    if (result.ok) {
      // Limpar localStorage
      clearCarrinho(mesaNum, tableSessionId);
      setMesaEncerrada(true);
      setShowEncerrarModal(false);
      return { success: true };
    }
    return { success: false, message: result.message ?? 'Não foi possível encerrar a mesa.' };
  }, [tableSessionId, mesaNum]);

  const salvarPedidoBanco = useCallback(async (cart: CarrinhoItem[]): Promise<string | null> => {
    if (!tenantId || !tableSessionId) return null;

    const subtotal = cart.reduce((s, i) => s + i.precoTotal * i.quantidade, 0);
    const itensPayload = cart.map((ci) => ({
      item_id: ci.itemId || null,
      item_name: ci.nome,
      item_price: ci.precoTotal,
      quantity: ci.quantidade,
      station_id: null,
      skip_kds: false,
      notes: ci.observacaoLivre || null,
      options: ci.opcoes.map((o) => ({
        option_id: null,
        option_name: o.opcaoNome,
        group_name: o.grupoNome,
        additional_price: o.precoAdicional ?? 0,
      })),
      observations: ci.observacoes.map((t) => ({ text: t })),
    }));

    try {
      const { data, error } = await supabase.functions.invoke('order-write', {
        body: {
          action: 'create_order',
          tenant_id: tenantId,
          table_session_id: tableSessionId,
          destination: 'table',
          table_number: mesaNum,
          destination_name: clienteNome || null,
          origin: 'table',
          items: itensPayload,
          discount_amount: 0,
          service_fee_amount: 0,
          subtotal,
          total_amount: subtotal,
          is_training: false,
        },
      });

      if (error) {
        console.error('[MesaCliente] create_order error:', error);
        return null;
      }

      return data?.data?.id ?? null;
    } catch (e) {
      console.error('[MesaCliente] Erro ao criar pedido:', e);
      return null;
    }
  }, [tenantId, tableSessionId, mesaNum, clienteNome]);

  const handleToggleEntrada = useCallback(async (permitida: boolean) => {
    if (!tableSessionId) return;
    setEntradaPermitida(permitida);
    try {
      await fetch(TABLE_WRITE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_entrada_permitida',
          table_session_id: tableSessionId,
          permitida,
        }),
      });
    } catch (e) {
      console.error('[MesaCliente] Erro ao toggle entrada_permitida:', e);
      // Reverter em caso de erro
      setEntradaPermitida(!permitida);
    }
  }, [tableSessionId]);

  // ── Tela: Mesa encerrada pelo cliente ────────────────────────────────────────
  if (mesaEncerrada) {
    return (
      <div className="min-h-screen bg-zinc-900 flex justify-center">
        <div className="w-full max-w-sm bg-zinc-900 min-h-screen flex flex-col items-center justify-center p-8 text-center">
          <div className="w-20 h-20 flex items-center justify-center bg-emerald-900/40 rounded-full mb-6">
            <i className="ri-checkbox-circle-line text-4xl text-emerald-400" />
          </div>
          <h2 className="text-2xl font-black text-white mb-3">Obrigado pela visita!</h2>
          <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
            A mesa foi encerrada com sucesso. Esperamos te ver em breve!
          </p>
          <div className="mt-8 flex items-center gap-2 px-4 py-2 bg-zinc-800 rounded-full">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-zinc-400 text-xs font-medium">Mesa {mesaNum} · Encerrada</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Tela: Carregando ─────────────────────────────────────────────────────────
  if (sessaoStatus === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-900 flex justify-center">
        <div className="w-full max-w-sm bg-zinc-900 min-h-screen flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-zinc-800 rounded-full mb-6">
            <i className="ri-loader-4-line text-3xl text-amber-400 animate-spin" />
          </div>
          <p className="text-zinc-400 text-sm">Verificando mesa {mesaNum}...</p>
        </div>
      </div>
    );
  }

  // ── Tela: Mesa fechada / não disponível ──────────────────────────────────────
  if (sessaoStatus === 'closed' || sessaoStatus === 'not_found') {
    return (
      <div className="min-h-screen bg-zinc-900 flex justify-center">
        <div className="w-full max-w-sm bg-zinc-900 min-h-screen flex flex-col items-center justify-center p-8 text-center">
          <div className="w-20 h-20 flex items-center justify-center bg-zinc-800 rounded-full mb-6">
            <i className="ri-door-closed-line text-4xl text-zinc-500" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">
            {sessaoStatus === 'closed' ? 'Mesa Encerrada' : 'Mesa não disponível'}
          </h2>
          <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">
            {sessaoStatus === 'closed'
              ? 'Esta mesa foi encerrada. Se precisar de ajuda, chame um garçom.'
              : 'Esta mesa não está disponível no momento. Por favor, chame um garçom.'}
          </p>
          <div className="mt-8 flex items-center gap-2 px-4 py-2 bg-zinc-800 rounded-full">
            <div className="w-2 h-2 rounded-full bg-zinc-500" />
            <span className="text-zinc-500 text-xs font-medium">Mesa {mesaNum}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Tela: Loja fechada (apenas para usuários autenticados — staff) ───────────
  if (estado === 'sem_sessao' && user) {
    return (
      <div className="min-h-screen bg-zinc-900 flex justify-center">
        <div className="w-full max-w-sm bg-zinc-900 min-h-screen flex flex-col items-center justify-center p-8 text-center">
          <div className="w-20 h-20 flex items-center justify-center bg-zinc-800 rounded-full mb-6">
            <i className="ri-store-line text-4xl text-zinc-500" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">Loja Fechada</h2>
          <p className="text-zinc-500 text-sm max-w-xs">
            O estabelecimento não está recebendo pedidos no momento. Por favor, retorne mais tarde.
          </p>
          <div className="mt-8 flex items-center gap-2 px-4 py-2 bg-zinc-800 rounded-full">
            <div className="w-2 h-2 rounded-full bg-zinc-500" />
            <span className="text-zinc-500 text-xs font-medium">Mesa {mesaNum}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleIdentificar = async (nome: string, tel: string) => {
    const nomeTrimmed = nome.trim();
    setClienteNome(nomeTrimmed);
    setIdentificado(true);
    const agora = new Date();
    const hora = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    const primeiroCliente = clientesMesa.length === 0;
    if (primeiroCliente) {
      setIsResponsavel(true);
      setResponsavelNome(nomeTrimmed);
      setHoraAbertura(hora);
    }
    setClientesMesa((prev) => [...prev, { nome: nomeTrimmed, telefone: tel }]);

    // Salvar nome no banco
    if (tableSessionId) {
      await saveCustomerNameToSession(tableSessionId, nomeTrimmed);
    }
  };

  const handleAdicionar = (item: Omit<ItemPedidoCliente, 'enviadoKds'>) => {
    setCarrinho((prev) => {
      const existe = prev.findIndex(
        (c) => c.itemId === item.itemId && !c.enviadoKds &&
          JSON.stringify(c.opcoesSelecionadas) === JSON.stringify(item.opcoesSelecionadas) &&
          c.observacao === item.observacao
      );
      if (existe >= 0) {
        return prev.map((c, i) => i === existe ? { ...c, quantidade: c.quantidade + item.quantidade } : c);
      }
      return [...prev, { ...item, enviadoKds: false }];
    });
  };

  const handleAlterarQtd = (index: number, delta: number) => {
    setCarrinho((prev) => {
      const novoCarrinho = [...prev];
      const novaQtd = novoCarrinho[index].quantidade + delta;
      if (novaQtd <= 0) return novoCarrinho.filter((_, i) => i !== index);
      novoCarrinho[index] = { ...novoCarrinho[index], quantidade: novaQtd };
      return novoCarrinho;
    });
  };

  const handleRemover = (index: number) => {
    setCarrinho((prev) => prev.filter((_, i) => i !== index));
  };

  const handleEditar = (index: number) => {
    setEditarIndex(index);
  };

  const handleSalvarEdicao = (index: number, novoItem: Omit<ItemPedidoCliente, 'enviadoKds'>) => {
    setCarrinho((prev) =>
      prev.map((item, i) => i === index ? { ...novoItem, enviadoKds: item.enviadoKds } : item)
    );
    setEditarIndex(null);
  };

  const handleEnviarCozinha = async () => {
    setEnviando(true);
    setErroEnvio('');

    const itensNovos = carrinho.filter((i) => !i.enviadoKds);
    const itemEsgotado = itensNovos.find((i) =>
      itensDesabilitadosIds.includes(i.itemId)
    );

    if (itemEsgotado) {
      setErroEnvio(`"${itemEsgotado.nome}" acabou de esgotar. Remova-o do carrinho antes de enviar.`);
      setEnviando(false);
      return;
    }

    const itensPendentes = itensNovos;

    if (itensPendentes.length > 0) {
      const cart: CarrinhoItem[] = itensPendentes.map((item) => ({
        cartId: `mesa-${mesaNum}-${item.itemId}-${Date.now()}`,
        itemId: item.itemId,
        nome: item.nome,
        precoBase: item.preco,
        precoTotal: item.preco,
        quantidade: item.quantidade,
        opcoes: (item.opcoesSelecionadas ?? []).map((o) => ({
          grupoNome: '',
          opcaoNome: typeof o === 'string' ? o : String(o),
          precoAdicional: 0,
        })),
        observacoes: item.observacao ? [item.observacao] : [],
        observacaoLivre: item.observacao ?? '',
      }));

      const orderId = await salvarPedidoBanco(cart);

      if (orderId) {
        // Só atualiza KDS e mesa localmente quando há usuário autenticado (staff)
        if (user) {
          const proximoNumero = kdsPedidos.length > 0 ? Math.max(...kdsPedidos.map((p) => p.numero)) + 1 : 101;
          const destInfo: DestinoInfo = { tipo: 'mesa', mesaNumero: mesaNum };
          addKDSPedido(buildKDSPedido({ cart, destino: destInfo, numeroSeq: proximoNumero, origem: 'mesa', stationMap: kdsStationMap }));

          const novoTotal = itensPendentes.reduce((s, i) => s + i.preco * i.quantidade, 0);
          const mesaAtual = mesas.find((m) => m.numero === mesaNum);
          if (mesaAtual) {
            atualizarMesa(mesaAtual.id, { totalConsumo: (mesaAtual.totalConsumo ?? 0) + novoTotal });
          }
        }

        setTimeout(() => {
          setCarrinho((prev) => prev.map((i) => ({ ...i, enviadoKds: true })));
          setEnviando(false);
          setFeedbackEnvio(true);
          fetchOrderItemsStatus();
          setTimeout(() => setFeedbackEnvio(false), 3000);
        }, 500);
      } else {
        setErroEnvio('Erro ao enviar pedido. Tente novamente.');
        setEnviando(false);
      }
    } else {
      setEnviando(false);
    }
  };

  const handleTransferirResponsabilidade = (novoNome: string) => {
    setIsResponsavel(false);
    setResponsavelNome(novoNome);
    setClientesMesa((prev) => {
      const novoResp = prev.find((c) => c.nome === novoNome);
      const restantes = prev.filter((c) => c.nome !== novoNome);
      return novoResp ? [novoResp, ...restantes] : prev;
    });
  };

  const handleToggleModoEdicao = () => {
    if (modoEdicaoEnviados) {
      setCarrinho(carrinhoSnapshot);
      setModoEdicaoEnviados(false);
      finalizarEdicao(mesaNum);
    } else {
      setCarrinhoSnapshot([...carrinho]);
      setModoEdicaoEnviados(true);
      iniciarEdicao(mesaNum);
    }
  };

  const handleCancelarEdicao = () => {
    setCarrinho(carrinhoSnapshot);
    setModoEdicaoEnviados(false);
    finalizarEdicao(mesaNum);
  };

  const handleConfirmarEdicao = () => {
    setModoEdicaoEnviados(false);
    finalizarEdicao(mesaNum);
    setFeedbackEdicao(true);
    setTimeout(() => setFeedbackEdicao(false), 3000);
  };

  const totalItensNovos = carrinho.filter((i) => !i.enviadoKds).reduce((s, i) => s + i.quantidade, 0);
  const totalGeral = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);

  const handleChamarGarcomPagar = () => { setTab('chamar'); };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'cardapio', label: 'Cardápio', icon: 'ri-restaurant-line' },
    { id: 'pedido', label: 'Pedido', icon: 'ri-shopping-bag-line' },
    { id: 'chamar', label: 'Chamar', icon: 'ri-service-line' },
    { id: 'pagar', label: 'Pagar', icon: 'ri-secure-payment-line' },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 flex justify-center">
      <div className="w-full max-w-sm bg-white min-h-screen flex flex-col relative">
        {/* Header */}
        <div className="bg-amber-500 px-4 pt-10 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-amber-200 text-xs font-semibold uppercase tracking-widest">ERPOS V2</p>
              <h1 className="text-white text-xl font-black">Mesa {mesaNum}</h1>
              {identificado && (
                <p className="text-amber-100 text-xs mt-0.5">
                  Olá, <strong>{clienteNome}</strong>!
                  {isResponsavel && (
                    <span className="ml-1.5 text-amber-200 text-[9px] font-bold bg-amber-600/50 px-1.5 py-0.5 rounded-full">
                      Responsável
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-amber-200 text-[10px]">{mesaZona}</p>
              <p className="text-white text-xs font-semibold mt-0.5">Cap. {mesaCapacidade} pessoas</p>
              {clientesMesa.length > 0 && (
                <p className="text-amber-200 text-[10px] mt-0.5">{clientesMesa.length} na mesa</p>
              )}
            </div>
          </div>
          {identificado && (
            <button
              onClick={() => setShowMeusPedidos(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2 bg-white/20 hover:bg-white/30 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
            >
              <div className="w-4 h-4 flex items-center justify-center">
                <i className="ri-receipt-line" />
              </div>
              Meus Pedidos
            </button>
          )}
        </div>

        {feedbackEnvio && (
          <div className="bg-emerald-500 px-4 py-2.5 flex items-center justify-center gap-2">
            <i className="ri-checkbox-circle-fill text-white text-sm" />
            <span className="text-white text-xs font-bold">Pedido enviado para a cozinha!</span>
          </div>
        )}

        {feedbackEdicao && (
          <div className="bg-amber-500 px-4 py-2.5 flex items-center justify-center gap-2">
            <i className="ri-edit-2-line text-white text-sm" />
            <span className="text-white text-xs font-bold">Alterações confirmadas — cozinha atualizada!</span>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex flex-col">
          {tab === 'cardapio' && (
            <CardapioPublico
              clienteNome={clienteNome}
              carrinho={carrinho}
              onAdicionar={handleAdicionar}
              onVerCarrinho={() => setTab('pedido')}
            />
          )}
          {tab === 'pedido' && (
            <CarrinhoCliente
              carrinho={carrinho}
              clienteNome={clienteNome}
              modoEdicaoEnviados={modoEdicaoEnviados}
              onToggleModoEdicao={handleToggleModoEdicao}
              onAlterarQtd={handleAlterarQtd}
              onRemover={handleRemover}
              onEditar={handleEditar}
              onEnviar={handleEnviarCozinha}
              enviando={enviando}
              erroEnvio={erroEnvio}
              onLimparErroEnvio={() => setErroEnvio('')}
              onConfirmarEdicao={handleConfirmarEdicao}
              onCancelarEdicao={handleCancelarEdicao}
              orderItemsStatus={orderItemsStatus}
            />
          )}
          {tab === 'chamar' && (
            <ChamarGarcomPanel
              mesaNumero={mesaNum}
              isResponsavel={isResponsavel}
              entradaPermitida={entradaPermitida}
              onToggleEntrada={handleToggleEntrada}
              clientesMesa={clientesMesa}
              onTransferirResponsabilidade={handleTransferirResponsabilidade}
              horaAbertura={horaAbertura}
            />
          )}
          {tab === 'pagar' && (
            <PagamentoMesaView
              totalGeral={totalGeral}
              mesaNumero={mesaNum}
              clienteNome={clienteNome}
              onChamarGarcom={handleChamarGarcomPagar}
              clientesMesa={clientesMesa}
              tableSessionId={tableSessionId}
              onSolicitarEncerramento={() => setShowEncerrarModal(true)}
            />
          )}
        </div>

        {/* Bottom Nav */}
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-sm bg-white border-t border-zinc-100 flex z-30">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 relative cursor-pointer transition-colors ${
                tab === t.id ? 'text-amber-500' : 'text-zinc-400 hover:text-zinc-600'
              }`}
            >
              <div className="w-5 h-5 flex items-center justify-center">
                <i className={`${t.icon} text-lg`} />
              </div>
              <span className="text-[9px] font-semibold whitespace-nowrap">{t.label}</span>
              {t.id === 'pedido' && totalItensNovos > 0 && (
                <span className="absolute top-1.5 right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full">
                  {totalItensNovos}
                </span>
              )}
              {t.id === 'pedido' && modoEdicaoEnviados && (
                <span className="absolute top-1 left-1 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              )}
              {t.id === 'pagar' && totalGeral > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Modal editar item */}
        {editarIndex !== null && (() => {
          const itemAtual = carrinho[editarIndex];
          const itemCardapio = itemAtual
            ? itensPublicos.find((c) => c.id === itemAtual.itemId)
            : null;
          return itemCardapio ? (
            <EditarItemCarrinhoModal
              item={itemCardapio}
              itemAtual={itemAtual}
              index={editarIndex}
              onSalvar={handleSalvarEdicao}
              onClose={() => setEditarIndex(null)}
            />
          ) : null;
        })()}

        {/* Modal encerrar mesa */}
        {showEncerrarModal && tableSessionId && (
          <EncerrarMesaModal
            mesaNumero={mesaNum}
            onEncerrar={handleEncerrarMesa}
            onCancelar={() => setShowEncerrarModal(false)}
          />
        )}

        {/* Modal meus pedidos */}
        {showMeusPedidos && tableSessionId && tenantId && (
          <MeusPedidosModal
            tableSessionId={tableSessionId}
            clienteNome={clienteNome}
            tenantId={tenantId}
            onClose={() => setShowMeusPedidos(false)}
          />
        )}

        {!identificado && (
          <IdentificacaoModal
            mesaNumero={mesaNum}
            tenantId={tenantId}
            onConfirmar={handleIdentificar}
            ehPrimeiroCliente={clientesMesa.length === 0}
            responsavelNome={responsavelNome}
            entradaPermitida={entradaPermitida}
          />
        )}
      </div>
    </div>
  );
}