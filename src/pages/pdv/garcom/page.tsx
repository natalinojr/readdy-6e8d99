import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '@/contexts/AppModeContext';
import { useSessao } from '../../../contexts/SessaoContext';
import type { CarrinhoItem, DestinoInfo, OpcaoSelecionada } from '../../../contexts/PDVContext';
import { useKDS } from '../../../contexts/KDSContext';
import { useMesas } from '../../../contexts/MesasContext';
import { useAuth } from '../../../contexts/AuthContext';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { useOrderSubmit, PartialOrderError } from '@/hooks/useOrderSubmit';
import type { Mesa } from '@/types/pdv';
import type { Rodada, PedidoAvulso, Chamado } from './types';
import MesaGrid from './components/MesaGrid';
import PedidoView from './components/PedidoView';
import IdentificacaoMesaModal from './components/IdentificacaoMesaModal';
import IdentificacaoAvulsoModal from './components/IdentificacaoAvulsoModal';
import TransferirMesaModal from './components/TransferirMesaModal';
import ChamadosPanel from './components/ChamadosPanel';
import PedidosAtivosView from './components/PedidosAtivosView';
import { useSystemSettings } from '@/hooks/useSystemSettings';

type Tela = 'mesas' | 'identificacao' | 'transferir' | 'pedido' | 'avulso-identificacao' | 'avulso-pedido' | 'sucesso';
type AbaMain = 'mesas' | 'pedidos';

const mockChamados: Chamado[] = [];

// Chave para localStorage de rascunhos de itens (por contexto)
const RASCUNHO_KEY = 'garcom_rascunhos_v1';

// Chave para rascunhos de pedidos Para Levar em progresso (lista, suporta múltiplos)
const AVULSO_DRAFTS_KEY = 'garcom_avulso_drafts_v2';

// Chave legada (migração automática)
const AVULSO_DRAFT_KEY_LEGADO = 'garcom_avulso_draft_v1';

export interface AvulsoDraft {
  id: string;
  nomeCliente: string;
  observacoes: string;
  garcomNome: string;
  criadoEm: string;
  carrinho: CarrinhoItem[];
}

// ── helpers de persistência ──────────────────────────────────────────────────

function carregarAvulsoDrafts(): AvulsoDraft[] {
  try {
    // Migrar chave legada para nova lista
    const legado = localStorage.getItem(AVULSO_DRAFT_KEY_LEGADO);
    if (legado) {
      const draft: AvulsoDraft = JSON.parse(legado);
      localStorage.removeItem(AVULSO_DRAFT_KEY_LEGADO);
      const lista = [draft];
      localStorage.setItem(AVULSO_DRAFTS_KEY, JSON.stringify(lista));
      return lista;
    }
    const raw = localStorage.getItem(AVULSO_DRAFTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function salvarAvulsoDrafts(drafts: AvulsoDraft[]) {
  try { localStorage.setItem(AVULSO_DRAFTS_KEY, JSON.stringify(drafts)); } catch { /* ignore */ }
}

function adicionarOuAtualizarDraft(draft: AvulsoDraft) {
  const lista = carregarAvulsoDrafts();
  const idx = lista.findIndex((d) => d.id === draft.id);
  if (idx >= 0) lista[idx] = draft;
  else lista.push(draft);
  salvarAvulsoDrafts(lista);
}

function removerDraftPorId(draftId: string) {
  const lista = carregarAvulsoDrafts().filter((d) => d.id !== draftId);
  salvarAvulsoDrafts(lista);
}

function atualizarCarrinhoNoDraft(draftId: string, novoCarrinho: CarrinhoItem[]) {
  try {
    const lista = carregarAvulsoDrafts();
    const idx = lista.findIndex((d) => d.id === draftId);
    if (idx < 0) return;
    lista[idx].carrinho = novoCarrinho;
    salvarAvulsoDrafts(lista);
  } catch { /* ignore */ }
}

// ── tipos auxiliares ──────────────────────────────────────────────────────────

export interface DivisaoAbaState {
  clientes: import('./components/DivisaoContaView').ClienteDivisao[];
  atribuicoes: Record<string, string | null>;
}

export interface DivisaoPagamentoState {
  clientes: Record<string, { formaPagId: string; valor: number; pago: boolean; nome: string }>;
  atribuicoes?: Record<string, string | null>;
}

function salvarRascunhos(rascunhos: Record<string, CarrinhoItem[]>) {
  try { localStorage.setItem(RASCUNHO_KEY, JSON.stringify(rascunhos)); } catch { /* ignore */ }
}

function carregarRascunhos(): Record<string, CarrinhoItem[]> {
  try { const raw = localStorage.getItem(RASCUNHO_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// ── componente principal ──────────────────────────────────────────────────────

export default function GarcomPage() {
  const { estado, sessao, gerarProximoNumeroPedido } = useSessao();

  // Loading state para evitar flash de "sem sessão" durante a verificação
  const [isVerificandoSessao, setIsVerificandoSessao] = useState(true);

  useEffect(() => {
    // Pequeno delay para garantir que o SessaoContext já terminou de verificar
    const timer = setTimeout(() => setIsVerificandoSessao(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const { user } = useAuth();
  const navigate = useNavigate();
  const { setMode } = useAppMode();
  const { reloadOrders, pedidos } = useKDS();
  const { mesas, atualizarMesa, abrirMesa, fecharMesa: fecharMesaContext, transferirMesa } = useMesas();
  const { submitOrder } = useOrderSubmit();
  const { settings } = useSystemSettings();

  const [tela, setTela] = useState<Tela>('mesas');
  const [abaMain, setAbaMain] = useState<AbaMain>('mesas');
  const [mesaSelecionada, setMesaSelecionada] = useState<Mesa | null>(null);
  const [chamados, setChamados] = useState<Chamado[]>(mockChamados);
  const [showChamados, setShowChamados] = useState(false);
  const [pedidosEnviados, setPedidosEnviados] = useState(0);
  const [pedidosMesa, setPedidosMesa] = useState<Record<string, Rodada[]>>({});
  const [carrinhosPorContexto, setCarrinhosPorContexto] = useState<Record<string, CarrinhoItem[]>>({});
  const [rodadasPagasPorMesa, setRodadasPagasPorMesa] = useState<Record<string, Set<string>>>({});
  const [pessoasPorMesa, setPessoasPorMesa] = useState<Record<string, string[]>>({});
  const [avulsoSelecionado, setAvulsoSelecionado] = useState<PedidoAvulso | null>(null);
  // Rodadas pagas para pedidos avulsos (Para Levar) — rastreado localmente
  const [rodadasPagasAvulso, setRodadasPagasAvulso] = useState<Set<string>>(new Set());

  // Pedidos "Para Levar" confirmados (vindos do KDS/Supabase via Realtime)
  // Agrupados por nome do cliente — múltiplos pedidos do mesmo cliente ficam num único card
  const pedidosAvulsos = useMemo<PedidoAvulso[]>(() => {
    const pedidosFiltrados = pedidos.filter(
      (p) => p.origem === 'garcom' && p.destino === 'nome' && !p.isCancelled && p.status !== 'entregue'
    );

    // Agrupa por nomeCliente normalizado (case-insensitive, trim)
    const grupos = new Map<string, typeof pedidosFiltrados>();
    for (const p of pedidosFiltrados) {
      const chave = (p.nomeCliente ?? 'Para Levar').trim().toLowerCase();
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave)!.push(p);
    }

    return Array.from(grupos.entries()).map(([, pedidosGrupo]) => {
      // Ordena por data de criação (mais antigo primeiro)
      const ordenados = [...pedidosGrupo].sort(
        (a, b) => new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime()
      );
      const primeiro = ordenados[0];
      // ID do grupo = ID do pedido mais antigo (usado como chave de navegação)
      const idGrupo = primeiro.id;

      const rodadas: Rodada[] = ordenados.map((p, idx) => ({
        id: `r-${p.id}`,
        numero: idx + 1,
        nomeResponsavel: p.nomeCliente ?? 'Para Levar',
        hora: new Date(p.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        itens: p.itens.map((item) => ({
          cartId: item.id,
          itemId: item.id,
          nome: item.nome,
          quantidade: item.quantidade,
          precoTotal: item.item_price ?? 0,
          opcoes: item.opcoes.map((o) => ({
            opcaoId: o.opcaoId || '',
            opcaoNome: o.opcaoNome,
            grupoNome: o.grupoNome,
            precoAdicional: o.additional_price ?? 0,
          })),
          observacoes: item.observacoes,
          observacaoLivre: item.observacaoLivre,
        })),
        orderId: p.id,
        total: p.totalAmount,
      }));

      return {
        id: idGrupo,
        nomeCliente: primeiro.nomeCliente ?? 'Para Levar',
        observacoes: '',
        criadoEm: new Date(primeiro.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        garcomNome: primeiro.garcomNome ?? '',
        rodadas,
      };
    });
  }, [pedidos]);

  // Rascunhos de pedidos Para Levar ainda não enviados (persistidos no localStorage)
  const [avulsoDrafts, setAvulsoDrafts] = useState<AvulsoDraft[]>(carregarAvulsoDrafts);

  const [rascunhosSalvos, setRascunhosSalvos] = useState<Record<string, CarrinhoItem[]>>(carregarRascunhos);
  const [toastRascunho, setToastRascunho] = useState<string | null>(null);
  const [divisaoPagPorMesa, setDivisaoPagPorMesa] = useState<Record<string, DivisaoPagamentoState>>({});
  const [divisaoAbaPorMesa, setDivisaoAbaPorMesa] = useState<Record<string, DivisaoAbaState>>({});
  const [alertaParcial, setAlertaParcial] = useState<{ orderId: string; orderNumber: string } | null>(null);

  const submittingPaymentRef = useRef(false);
  const submittingOrderRef = useRef(false);
  const avulsoSelecionadoRef = useRef(avulsoSelecionado);
  avulsoSelecionadoRef.current = avulsoSelecionado;

  // Sincroniza rascunhos do localStorage quando a tela volta para 'mesas'
  useEffect(() => {
    if (tela === 'mesas') {
      setAvulsoDrafts(carregarAvulsoDrafts());
    }
  }, [tela]);

  // Quando entra na tela avulso-pedido, restaura carrinho do draft se estiver vazio em memória
  useEffect(() => {
    if (tela === 'avulso-pedido' && avulsoSelecionado) {
      const draftsLS = carregarAvulsoDrafts();
      const draftLS = draftsLS.find((d) => d.id === avulsoSelecionado.id);
      if (draftLS) {
        const carrinhoAtual = carrinhosPorContexto[avulsoSelecionado.id] ?? [];
        if (carrinhoAtual.length === 0 && draftLS.carrinho.length > 0) {
          setCarrinhosPorContexto((prev) => ({ ...prev, [draftLS.id]: draftLS.carrinho }));
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tela, avulsoSelecionado?.id]);

  // Quando o avulso selecionado muda, limpa as rodadas pagas locais
  useEffect(() => {
    setRodadasPagasAvulso(new Set());
  }, [avulsoSelecionado?.id]);

  const avulsoSelecionadoAtualizado = useMemo(() => {
    if (!avulsoSelecionado) return null;
    // Busca por id primeiro; se nao encontrar (ex: após novo pedido mudar o id do grupo), busca por nome
    return (
      pedidosAvulsos.find((a) => a.id === avulsoSelecionado.id) ??
      pedidosAvulsos.find((a) => a.nomeCliente.trim().toLowerCase() === avulsoSelecionado.nomeCliente.trim().toLowerCase()) ??
      avulsoSelecionado
    );
  }, [avulsoSelecionado, pedidosAvulsos]);

  const currentContextoId = useMemo(() => {
    if (tela === 'avulso-pedido' && avulsoSelecionado) return avulsoSelecionadoAtualizado?.id ?? avulsoSelecionado.id;
    if (mesaSelecionada) return mesaSelecionada.id;
    return '';
  }, [tela, avulsoSelecionado, avulsoSelecionadoAtualizado, mesaSelecionada]);

  const carrinho = carrinhosPorContexto[currentContextoId] ?? [];

  const setCarrinhoContexto = (id: string, updater: CarrinhoItem[] | ((prev: CarrinhoItem[]) => CarrinhoItem[])) => {
    setCarrinhosPorContexto((prev) => ({
      ...prev,
      [id]: typeof updater === 'function' ? updater(prev[id] ?? []) : updater,
    }));
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _setCarrinhoContexto = setCarrinhoContexto;

  const clearCarrinhoContexto = (id: string) => {
    setCarrinhosPorContexto((prev) => { const updated = { ...prev }; delete updated[id]; return updated; });
  };

  const handleSalvarRascunho = useCallback(() => {
    if (!currentContextoId || carrinho.length === 0) return;
    const novosRascunhos = { ...rascunhosSalvos, [currentContextoId]: [...carrinho] };
    setRascunhosSalvos(novosRascunhos);
    salvarRascunhos(novosRascunhos);
    setToastRascunho('Rascunho salvo!');
    setTimeout(() => setToastRascunho(null), 2500);
  }, [currentContextoId, carrinho, rascunhosSalvos]);

  const handleRestaurarRascunho = useCallback(() => {
    if (!currentContextoId) return;
    const rascunho = rascunhosSalvos[currentContextoId];
    if (!rascunho || rascunho.length === 0) return;
    setCarrinhosPorContexto((prev) => ({ ...prev, [currentContextoId]: rascunho }));
    const novosRascunhos = { ...rascunhosSalvos };
    delete novosRascunhos[currentContextoId];
    setRascunhosSalvos(novosRascunhos);
    salvarRascunhos(novosRascunhos);
    setToastRascunho('Rascunho restaurado!');
    setTimeout(() => setToastRascunho(null), 2500);
  }, [currentContextoId, rascunhosSalvos]);

  const temRascunho = currentContextoId ? !!rascunhosSalvos[currentContextoId]?.length : false;

  const saveOrderToDb = useCallback(async (
    cart: CarrinhoItem[],
    destino: DestinoInfo,
    garcomNome?: string,
  ): Promise<{ numero: string; orderId: string | null } | null> => {
    if (!sessao || !user) return null;

    const numero = await gerarProximoNumeroPedido();

    const itensPayload = cart.map((ci) => ({
      item_id: ci.itemId || null,
      item_name: ci.nome,
      item_price: ci.precoTotal,
      quantity: ci.quantidade,
      station_id: ci.stationId ?? null,
      skip_kds: ci.semPreparo ?? false,
      notes: ci.observacaoLivre || null,
      options: ci.opcoes.map((o) => ({
        option_id: o.opcaoId || null,
        option_name: o.opcaoNome,
        group_name: o.grupoNome,
        additional_price: o.precoAdicional,
        group_obrigatorio: o.obrigatorio,
      })),
      observations: [
        ...ci.observacoes.map((t) => ({ text: t })),
        ...(ci.observacaoLivre ? [{ text: ci.observacaoLivre }] : []),
        ...(ci.obsUnidades ?? []).flatMap((obs, idx) =>
          obs ? [{ text: `Unidade ${idx + 1}: ${obs}` }] : []
        ),
      ],
    }));

    const subtotal = cart.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);

    try {
      const result = await submitOrder({
        session_id: sessao.id,
        tenant_id: user.tenantId,
        destination: destino.tipo === 'mesa' ? 'table' : destino.tipo === 'nome' ? 'name' : destino.tipo,
        destination_name: destino.tipo === 'mesa' ? (destino.nomeCliente ?? null) : (destino.nomeCliente ?? null),
        customer_name: destino.tipo === 'mesa' ? (destino.nomeCliente ?? null) : null,
        destination_phone: destino.telefone ?? null,
        delivery_address: destino.enderecoEntrega ?? null,
        delivery_fee: destino.taxaEntrega ?? 0,
        table_number: destino.tipo === 'mesa' ? (destino.mesaNumero ?? null) : null,
        origin: 'waiter',
        waiter_name: garcomNome ?? null,
        items: itensPayload,
        discount_amount: 0,
        service_fee_amount: 0,
        subtotal,
        total_amount: subtotal,
        is_training: user.modoTreino ?? false,
      });

      setTimeout(() => reloadOrders(), 300);
      return { numero, orderId: result.id };
    } catch (err) {
      if (err instanceof PartialOrderError) {
        setAlertaParcial({ orderId: err.orderId, orderNumber: err.orderNumber });
        setTimeout(() => reloadOrders(), 300);
        return { numero, orderId: err.orderId };
      }
      console.error('[GarcomPage] saveOrderToDb falhou:', err);
      return null;
    }
  }, [sessao, user, gerarProximoNumeroPedido, reloadOrders, submitOrder]);

  const handleSelectMesa = (mesa: Mesa) => {
    setMesaSelecionada(mesa);
    if (mesa.status === 'livre') setTela('identificacao');
    else setTela('pedido');
  };

  const handleConfirmarIdentificacao = async (data: { garcomNome: string; numeroPessoas: number; clienteNome: string }) => {
    if (!mesaSelecionada) return;
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const mesaAtualizada: Mesa = { ...mesaSelecionada, status: 'ocupada', garcomNome: data.garcomNome, numeroPessoas: data.numeroPessoas > 0 ? data.numeroPessoas : undefined, clienteNome: data.clienteNome || undefined, abertaEm: agora, abertaEmTimestamp: Date.now(), totalConsumo: 0 };
    await abrirMesa(mesaSelecionada.id, data.garcomNome, data.numeroPessoas > 0 ? data.numeroPessoas : undefined, data.clienteNome || undefined);
    atualizarMesa(mesaSelecionada.id, { clienteNome: data.clienteNome || undefined, garcomNome: data.garcomNome });
    setMesaSelecionada(mesaAtualizada);
    const pessoas: string[] = [];
    for (let i = 1; i <= data.numeroPessoas; i++) {
      pessoas.push(i === 1 && data.clienteNome ? data.clienteNome : `Pessoa ${i}`);
    }
    if (pessoas.length === 0 && data.clienteNome) pessoas.push(data.clienteNome);
    if (pessoas.length > 0) setPessoasPorMesa((prev) => ({ ...prev, [mesaSelecionada.id]: pessoas }));
    setTela('pedido');
  };

  const handleAdicionarPessoa = (mesaId: string, nome: string) => {
    setPessoasPorMesa((prev) => ({ ...prev, [mesaId]: [...(prev[mesaId] ?? []), nome] }));
  };

  const handleRenomearPessoa = (mesaId: string, nomeAntigo: string, nomeNovo: string) => {
    setPessoasPorMesa((prev) => ({
      ...prev,
      [mesaId]: (prev[mesaId] ?? []).map((p) => (p === nomeAntigo ? nomeNovo : p)),
    }));
  };

  const handleTransferirConfirmar = (mesaOrigem: Mesa) => {
    if (!mesaSelecionada) return;
    const rodadasOrigem = pedidosMesa[mesaOrigem.id] ?? [];
    const totalOrigem = rodadasOrigem.flatMap((r) => r.itens).reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const mesaDestinoAtualizada: Mesa = { ...mesaSelecionada, status: 'ocupada', garcomNome: mesaOrigem.garcomNome, numeroPessoas: mesaOrigem.numeroPessoas, clienteNome: mesaOrigem.clienteNome, abertaEm: mesaOrigem.abertaEm ?? agora, totalConsumo: totalOrigem };
    transferirMesa(mesaOrigem.id, mesaSelecionada.id, mesaDestinoAtualizada);
    setPedidosMesa((prev) => { const a = { ...prev }; a[mesaSelecionada.id] = rodadasOrigem; delete a[mesaOrigem.id]; return a; });
    const carrinhoOrigem = carrinhosPorContexto[mesaOrigem.id] ?? [];
    if (carrinhoOrigem.length > 0) {
      setCarrinhosPorContexto((prev) => { const u = { ...prev }; u[mesaSelecionada.id] = carrinhoOrigem; delete u[mesaOrigem.id]; return u; });
    }
    setMesaSelecionada(mesaDestinoAtualizada);
    setTela('pedido');
  };

  // Persiste o carrinho no draft sempre que ele muda (sem depender de estado React)
  const persistirCarrinhoNoDraft = useCallback((id: string, novoCarrinho: CarrinhoItem[]) => {
    const avulsoAtual = avulsoSelecionadoRef.current;
    if (!avulsoAtual) return;
    const draftId = avulsoAtual.id;
    if (id !== draftId) return;
    atualizarCarrinhoNoDraft(draftId, novoCarrinho);
    // Atualiza estado React dos drafts
    setAvulsoDrafts(carregarAvulsoDrafts());
  }, []);

  const handleAddItem = (item: CarrinhoItem) => {
    const id = currentContextoId;
    setCarrinhosPorContexto((prev) => {
      const prevCarrinho = prev[id] ?? [];
      const exist = prevCarrinho.find((c) => c.itemId === item.itemId && c.opcoes.length === 0 && item.opcoes.length === 0);
      const novoCarrinho = exist
        ? prevCarrinho.map((c) => c.cartId === exist.cartId ? { ...c, quantidade: c.quantidade + 1 } : c)
        : [...prevCarrinho, item];
      persistirCarrinhoNoDraft(id, novoCarrinho);
      return { ...prev, [id]: novoCarrinho };
    });
  };

  const handleUpdateQty = (cartId: string, delta: number) => {
    const id = currentContextoId;
    setCarrinhosPorContexto((prev) => {
      const novoCarrinho = (prev[id] ?? []).map((c) => (c.cartId === cartId ? { ...c, quantidade: c.quantidade + delta } : c)).filter((c) => c.quantidade > 0);
      persistirCarrinhoNoDraft(id, novoCarrinho);
      return { ...prev, [id]: novoCarrinho };
    });
  };

  const handleRemoveItem = (cartId: string) => {
    const id = currentContextoId;
    setCarrinhosPorContexto((prev) => {
      const novoCarrinho = (prev[id] ?? []).filter((c) => c.cartId !== cartId);
      persistirCarrinhoNoDraft(id, novoCarrinho);
      return { ...prev, [id]: novoCarrinho };
    });
  };

  const handleEditItem = (cartId: string, updates: { quantidade: number; observacaoLivre: string; observacoes?: string[]; obsUnidades?: string[]; opcoes?: OpcaoSelecionada[]; precoTotal?: number }) => {
    const id = currentContextoId;
    setCarrinhosPorContexto((prev) => {
      const novoCarrinho = (prev[id] ?? []).map((c) => c.cartId === cartId ? { ...c, ...updates } : c).filter((c) => c.quantidade > 0);
      persistirCarrinhoNoDraft(id, novoCarrinho);
      return { ...prev, [id]: novoCarrinho };
    });
  };

  const handleEnviar = async (nomeResponsavel: string) => {
    if (!mesaSelecionada) return;
    if (submittingOrderRef.current) return;
    submittingOrderRef.current = true;

    try {
      const rodadasExistentes = pedidosMesa[mesaSelecionada.id] ?? [];
      const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const totalNovos = carrinho.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);

      const destInfo: DestinoInfo = {
        tipo: 'mesa',
        mesaNumero: mesaSelecionada.numero,
        nomeCliente: mesaSelecionada.clienteNome ?? (nomeResponsavel.trim() || undefined),
      };
      const result = await saveOrderToDb(carrinho, destInfo, mesaSelecionada.garcomNome);
      if (!result) return;

      const { numero: savedNumero, orderId } = result;
      void savedNumero;

      const novaRodada: Rodada = {
        id: `r-${mesaSelecionada.id}-${Date.now()}`,
        numero: rodadasExistentes.length + 1,
        nomeResponsavel: nomeResponsavel.trim() || 'Mesa',
        hora: agora,
        itens: [...carrinho],
        orderId: orderId ?? undefined,
        total: totalNovos,
      };

      // Impressão é gerenciada pelo useOrderSubmit via fila centralizada

      atualizarMesa(mesaSelecionada.id, { totalConsumo: (mesaSelecionada.totalConsumo ?? 0) + totalNovos });
      const novasRodadas = [...rodadasExistentes, novaRodada];
      setPedidosMesa((prev) => ({ ...prev, [mesaSelecionada.id]: novasRodadas }));
      clearCarrinhoContexto(mesaSelecionada.id);
      setPedidosEnviados((n) => n + 1);
      setTela('pedido');
    } finally {
      submittingOrderRef.current = false;
    }
  };

  const handlePagarConta = async (mesaId: string, rodadaIds: string[], formaPagamentoId?: string, valorParcial?: number) => {
    if (submittingPaymentRef.current) return;
    submittingPaymentRef.current = true;

    try {
      const rodadas = pedidosMesa[mesaId] ?? [];
      const rodadasAPagar = rodadas.filter((r) => rodadaIds.includes(r.id) && r.orderId);

      let cashRegisterId: string | null = null;
      if (sessao?.id) {
        try {
          const { supabase: sb } = await import('@/lib/supabase');
          const { data: crRow } = await sb
            .from('cash_registers')
            .select('id')
            .eq('session_id', sessao.id)
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          cashRegisterId = crRow?.id ?? null;
        } catch (e) {
          console.warn('[GarcomPage] Erro ao buscar caixa:', e);
        }
      }

      // Quando valorParcial está definido (pagamento por divisão/conta dividida),
      // registra o pagamento apenas UMA VEZ no primeiro pedido disponível.
      // Isso evita que o valor parcial seja multiplicado pelo número de pedidos da mesa.
      if (valorParcial !== undefined && rodadasAPagar.length > 0) {
        const primeiraRodada = rodadasAPagar[0];
        if (primeiraRodada.orderId && formaPagamentoId) {
          try {
            await invokeWithAuth('order-write', {
              body: {
                action: 'record_payment',
                order_id: primeiraRodada.orderId,
                tenant_id: user?.tenantId,
                cash_register_id: cashRegisterId,
                payment_method_id: formaPagamentoId,
                amount: valorParcial,
                change_amount: 0,
                operator_name: user?.nome ?? null,
                paid_by_pdv: 'waiter',
              },
            });
            void Promise.resolve(supabase.rpc('fn_update_paid_by_pdv', { p_order_id: primeiraRodada.orderId, p_paid_by_pdv: 'waiter' })).catch(() => {});
          } catch (e) {
            console.error('[GarcomPage] record_payment divisão error:', e);
          }
        }
      } else {
        // Pagamento integral: registra em cada pedido selecionado
        for (const rodada of rodadasAPagar) {
          if (!rodada.orderId || !formaPagamentoId) continue;
          try {
            const amount = rodada.total ?? 0;
            await invokeWithAuth('order-write', {
              body: {
                action: 'record_payment',
                order_id: rodada.orderId,
                tenant_id: user?.tenantId,
                cash_register_id: cashRegisterId,
                payment_method_id: formaPagamentoId,
                amount,
                change_amount: 0,
                operator_name: user?.nome ?? null,
                paid_by_pdv: 'waiter',
              },
            });
            // Salva PDV que confirmou pagamento
            if (rodada.orderId) {
              void Promise.resolve(supabase.rpc('fn_update_paid_by_pdv', { p_order_id: rodada.orderId, p_paid_by_pdv: 'waiter' })).catch(() => {});
            }
          } catch (e) {
            console.error('[GarcomPage] record_payment error:', e);
          }
        }
      }

      setRodadasPagasPorMesa((prev) => ({
        ...prev,
        [mesaId]: new Set([...(prev[mesaId] ?? new Set()), ...rodadaIds]),
      }));
    } finally {
      submittingPaymentRef.current = false;
    }
  };

  const handleAtualizarDivisaoPag = async (mesaId: string, estado: DivisaoPagamentoState, tableSessionId?: string) => {
    setDivisaoPagPorMesa((prev) => ({ ...prev, [mesaId]: estado }));
    if (!tableSessionId || !user) return;
    try {
      const customers = Object.entries(estado.clientes).map(([, v], idx) => ({
        name: v.nome,
        seat_number: idx + 1,
        amount_due: v.valor,
        amount_paid: v.pago ? v.valor : 0,
        status: v.pago ? 'paid' : 'pending',
      }));
      await invokeWithAuth('order-write', {
        body: {
          action: 'upsert_division_customers',
          tenant_id: user.tenantId,
          table_session_id: tableSessionId,
          customers,
        },
      });
    } catch (e) {
      console.warn('[GarcomPage] upsert_division_customers error:', e);
    }
  };

  const handleCarregarDivisaoPag = async (mesaId: string, tableSessionId: string) => {
    if (!user || !tableSessionId) return;
    try {
      const { data } = await invokeWithAuth('order-write', {
        body: {
          action: 'get_division_customers',
          tenant_id: user.tenantId,
          table_session_id: tableSessionId,
        },
      });
      if (!data || data.length === 0) return;
      const clientes: DivisaoPagamentoState['clientes'] = {};
      (data as Array<{ name: string; amount_due: number; amount_paid: number; status: string; seat_number: number }>)
        .forEach((c) => {
          const clienteId = `cli-db-${c.seat_number}`;
          clientes[clienteId] = {
            nome: c.name,
            valor: Number(c.amount_due),
            pago: c.status === 'paid',
            formaPagId: '',
          };
        });
      setDivisaoPagPorMesa((prev) => ({ ...prev, [mesaId]: { clientes } }));
    } catch (e) {
      console.warn('[GarcomPage] get_division_customers error:', e);
    }
  };

  const handleLimparDivisaoPag = (mesaId: string) => {
    setDivisaoPagPorMesa((prev) => { const novo = { ...prev }; delete novo[mesaId]; return novo; });
  };

  const handleFecharConta = () => {
    if (mesaSelecionada) {
      fecharMesaContext(mesaSelecionada.id);
      setPedidosMesa((prev) => { const a = { ...prev }; delete a[mesaSelecionada.id]; return a; });
      clearCarrinhoContexto(mesaSelecionada.id);
      setRodadasPagasPorMesa((prev) => { const n = { ...prev }; delete n[mesaSelecionada.id]; return n; });
      setPessoasPorMesa((prev) => { const n = { ...prev }; delete n[mesaSelecionada.id]; return n; });
      handleLimparDivisaoPag(mesaSelecionada.id);
    }
    setTela('mesas');
  };

  const handleDismissChamado = (id: string) => {
    setChamados((prev) => prev.map((c) => c.id === id ? { ...c, atendido: true } : c));
    setTimeout(() => setChamados((prev) => prev.filter((c) => c.id !== id)), 3000);
  };

  const handleSelectAvulso = useCallback((avulso: PedidoAvulso) => {
    // Busca pelo id OU pelo mesmo nomeCliente (caso o id do grupo tenha mudado após novo pedido)
    const avulsoAtualizado = pedidosAvulsos.find((a) => a.id === avulso.id)
      ?? pedidosAvulsos.find((a) => a.nomeCliente.trim().toLowerCase() === avulso.nomeCliente.trim().toLowerCase())
      ?? avulso;
    setAvulsoSelecionado(avulsoAtualizado);
    setTela('avulso-pedido');
  }, [pedidosAvulsos]);

  // Abre um rascunho existente direto — sem modal de confirmação
  const handleAbrirDraft = useCallback((draft: AvulsoDraft) => {
    const tempAvulso: PedidoAvulso = {
      id: draft.id,
      nomeCliente: draft.nomeCliente,
      observacoes: draft.observacoes,
      garcomNome: draft.garcomNome,
      criadoEm: draft.criadoEm,
      rodadas: [],
    };
    avulsoSelecionadoRef.current = tempAvulso;
    setAvulsoSelecionado(tempAvulso);
    // Restaura carrinho do draft
    if (draft.carrinho.length > 0) {
      setCarrinhosPorContexto((prev) => ({ ...prev, [draft.id]: draft.carrinho }));
    }
    setTela('avulso-pedido');
  }, []);

  // Descarta um rascunho específico
  const handleDescartarDraft = useCallback((draftId: string) => {
    removerDraftPorId(draftId);
    clearCarrinhoContexto(draftId);
    setAvulsoDrafts(carregarAvulsoDrafts());
  }, []);

  // Novo pedido Para Levar — vai direto pro modal de identificação (sem checar drafts)
  const handleNovoAvulso = () => {
    setTela('avulso-identificacao');
  };

  const handleConfirmarAvulso = (nomeCliente: string, observacoes: string, garcomNome: string) => {
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const draftId = `temp-avulso-${Date.now()}`;
    const draft: AvulsoDraft = { id: draftId, nomeCliente, observacoes, garcomNome, criadoEm: agora, carrinho: [] };
    // Salva no localStorage de forma síncrona antes de qualquer setState
    adicionarOuAtualizarDraft(draft);
    const tempAvulso: PedidoAvulso = { id: draftId, nomeCliente, observacoes, garcomNome, criadoEm: agora, rodadas: [] };
    avulsoSelecionadoRef.current = tempAvulso;
    setAvulsoSelecionado(tempAvulso);
    setAvulsoDrafts(carregarAvulsoDrafts());
    setTela('avulso-pedido');
  };

  const handleEnviarAvulso = async (nomeResponsavel: string) => {
    if (!avulsoSelecionado) return;
    if (submittingOrderRef.current) return;
    submittingOrderRef.current = true;

    try {
      const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const carrinhoAtual = [...carrinho];

      const destInfo: DestinoInfo = { tipo: 'nome', nomeCliente: avulsoSelecionado.nomeCliente };
      const result = await saveOrderToDb(carrinhoAtual, destInfo, avulsoSelecionado.garcomNome);
      if (!result) return;
      const { numero: savedNumero, orderId } = result;

      const totalRodada = carrinhoAtual.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);
      const novaRodada: Rodada = {
        id: `r-av-${Date.now()}`,
        numero: avulsoSelecionado.rodadas.length + 1,
        nomeResponsavel: nomeResponsavel.trim() || avulsoSelecionado.nomeCliente,
        hora: agora,
        itens: carrinhoAtual,
        orderId: orderId ?? undefined,
        total: totalRodada,
      };

      // Impressão é gerenciada pelo useOrderSubmit via fila centralizada

      const idAntigo = avulsoSelecionado.id;

      if (orderId) {
        // Após envio, atualiza para o id do grupo agrupado por nome (que pode ser o orderId novo
        // ou o id do grupo existente que o Realtime vai atualizar)
        setAvulsoSelecionado((prev) => prev ? {
          ...prev,
          id: orderId,
          rodadas: [...prev.rodadas, novaRodada],
        } : null);
      } else {
        setAvulsoSelecionado((prev) => prev ? { ...prev, rodadas: [...(prev.rodadas ?? []), novaRodada] } : null);
      }

      clearCarrinhoContexto(idAntigo);
      setPedidosEnviados((n) => n + 1);

      // Remove o rascunho — pedido foi enviado com sucesso
      removerDraftPorId(idAntigo);
      setAvulsoDrafts(carregarAvulsoDrafts());

      setTela('avulso-pedido');
    } finally {
      submittingOrderRef.current = false;
    }
  };

  const handleFecharContaAvulso = () => {
    if (avulsoSelecionado) {
      // Limpa o rascunho ao fechar a aba do pedido avulso
      removerDraftPorId(avulsoSelecionado.id);
      clearCarrinhoContexto(avulsoSelecionado.id);
      setAvulsoDrafts(carregarAvulsoDrafts());
    }
    setAvulsoSelecionado(null);
    setTela('mesas');
  };

  // Quando "Voltar" é clicado na tela avulso-pedido, mantém o rascunho (não apaga)
  const handleVoltarAvulso = () => {
    setAvulsoSelecionado(null);
    setTela('mesas');
  };

  const rodadasMesaAtual = mesaSelecionada ? (pedidosMesa[mesaSelecionada.id] ?? []) : [];
  const mesaOcupada = mesaSelecionada?.status === 'ocupada';
  const mesasOcupadas = mesas.filter((m) => m.status === 'ocupada');
  const rodadasPagasMesaAtual = mesaSelecionada ? (rodadasPagasPorMesa[mesaSelecionada.id] ?? new Set<string>()) : new Set<string>();
  const todasPagasMesaAtual = rodadasMesaAtual.length > 0 && rodadasMesaAtual.every((r) => rodadasPagasMesaAtual.has(r.id));
  const pessoasMesaAtual = mesaSelecionada ? (pessoasPorMesa[mesaSelecionada.id] ?? []) : [];
  const divisaoPagMesaAtual = mesaSelecionada ? (divisaoPagPorMesa[mesaSelecionada.id] ?? null) : null;
  const divisaoAbaMesaAtual = mesaSelecionada ? (divisaoAbaPorMesa[mesaSelecionada.id] ?? null) : null;

  const mesaNome = mesaSelecionada ? mesaOcupada ? `Mesa ${mesaSelecionada.numero}${mesaSelecionada.clienteNome ? ` · ${mesaSelecionada.clienteNome}` : ''}` : `Mesa ${mesaSelecionada.numero} (Nova)` : '';
  const pedidosMesaFlat: Record<string, CarrinhoItem[]> = Object.fromEntries(Object.entries(pedidosMesa).map(([k, rodadas]) => [k, rodadas.flatMap((r) => r.itens)]));
  const avulsoParaExibir = avulsoSelecionadoAtualizado ?? avulsoSelecionado;
  const rodadasAvulsoAtual = avulsoParaExibir?.rodadas ?? [];
  const mesaNomeAvulso = avulsoParaExibir ? `${avulsoParaExibir.nomeCliente} · Para Levar` : '';

  // Suppress unused warning for handleCarregarDivisaoPag
  void handleCarregarDivisaoPag;

  if (isVerificandoSessao || estado === 'sem_sessao') {
    return (
      <div
        className="flex flex-col h-full items-center justify-center p-8 text-center relative overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full opacity-30"
            style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
          <div className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }} />
        </div>
        <div className="relative z-10 bg-white/70 backdrop-blur-sm border border-zinc-200 rounded-2xl p-8 flex flex-col items-center max-w-xs w-full">
          {isVerificandoSessao ? (
            <>
              <div className="w-16 h-16 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl mb-5">
                <i className="ri-loader-4-line animate-spin text-3xl text-amber-500" />
              </div>
              <h2 className="text-xl font-black text-zinc-900 mb-2">Verificando sessão...</h2>
              <p className="text-zinc-500 text-sm max-w-xs">Aguarde enquanto confirmamos a sessão ativa.</p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl mb-5">
                <i className="ri-lock-line text-3xl text-amber-500" />
              </div>
              <h2 className="text-xl font-black text-zinc-900 mb-2">PDV Garçom bloqueado</h2>
              <p className="text-zinc-500 text-sm max-w-xs">Nenhuma sessão ativa no caixa. Abra uma sessão no PDV Caixa para liberar o atendimento.</p>
            </>
          )}
          <div className="mt-5 flex items-center gap-2 px-4 py-2 bg-white/80 border border-zinc-200 rounded-full backdrop-blur-sm">
            <div className={`w-2 h-2 rounded-full ${isVerificandoSessao ? 'bg-amber-400 animate-pulse' : 'bg-red-400 animate-pulse'}`} />
            <span className="text-zinc-500 text-xs font-medium">{isVerificandoSessao ? 'Verificando...' : 'Aguardando sessão...'}</span>
          </div>
          <button
            onClick={() => { setMode('modulos'); navigate('/modulos'); }}
            className="mt-5 flex items-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-900 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-arrow-left-line text-sm" />
            Voltar aos Módulos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full opacity-25"
          style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
        <div className="absolute top-1/2 -right-32 w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }} />
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,0,0,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.4) 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }} />
      </div>

      {toastRascunho && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white text-xs font-bold px-4 py-2 rounded-full animate-bounce">
          <i className="ri-save-line mr-1.5" />{toastRascunho}
        </div>
      )}

      {alertaParcial && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0 mt-0.5">
              <i className="ri-alert-line text-amber-600 text-base" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-amber-800 font-bold text-xs">Pedido criado com aviso</p>
              <p className="text-amber-700 text-xs mt-0.5">
                Pedido <span className="font-bold">{alertaParcial.orderNumber}</span> foi registrado, mas alguns itens podem nao ter chegado ao KDS.
              </p>
            </div>
            <button onClick={() => setAlertaParcial(null)} className="flex-shrink-0 text-amber-500 hover:text-amber-700 cursor-pointer mt-0.5">
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        </div>
      )}

      {tela !== 'pedido' && tela !== 'avulso-pedido' && (
        <div className="relative z-10 flex items-center justify-between px-3 py-2.5 bg-white border-b border-zinc-100 flex-shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => { setMode('modulos'); navigate('/modulos'); }}
              title="Voltar aos Modulos"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 cursor-pointer transition-colors flex-shrink-0"
            >
              <i className="ri-arrow-left-line text-sm" />
            </button>
            <div className="w-px h-4 bg-zinc-200 flex-shrink-0" />
            <div className="w-7 h-7 flex items-center justify-center bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex-shrink-0">
              <i className="ri-walk-line text-sm text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-zinc-900 font-black text-sm truncate">PDV Garcom</p>
              <p className="text-zinc-400 text-[10px] hidden sm:block">{pedidosEnviados} pedidos enviados hoje</p>
            </div>
          </div>
          <button onClick={() => setShowChamados(!showChamados)} className="relative flex items-center gap-1.5 bg-white/70 hover:bg-white border border-zinc-200 text-zinc-700 text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer transition-colors whitespace-nowrap flex-shrink-0 backdrop-blur-sm">
            <i className="ri-notification-3-line" /><span className="hidden sm:inline">Chamados</span>
            {chamados.length > 0 && (<span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full">{chamados.length}</span>)}
          </button>
        </div>
      )}

      {showChamados && (<ChamadosPanel chamados={chamados} onAtender={handleDismissChamado} onClose={() => setShowChamados(false)} />)}

      {(tela === 'mesas' || tela === 'identificacao' || tela === 'transferir' || tela === 'avulso-identificacao') && (
        <div className="relative z-10 flex-1 overflow-hidden flex flex-col">
          <div className="flex border-b border-zinc-200/80 px-3 flex-shrink-0 bg-white/40 backdrop-blur-sm">
            <button onClick={() => setAbaMain('mesas')} className={`flex-1 py-2 text-xs font-semibold border-b-2 cursor-pointer transition-colors whitespace-nowrap ${abaMain === 'mesas' ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-400 hover:text-zinc-600'}`}>
              <i className="ri-layout-grid-line mr-1" />Mesas
            </button>
            <button onClick={() => setAbaMain('pedidos')} className={`flex-1 py-2 text-xs font-semibold border-b-2 cursor-pointer transition-colors whitespace-nowrap relative ${abaMain === 'pedidos' ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-400 hover:text-zinc-600'}`}>
              <i className="ri-receipt-line mr-1" />Pedidos Ativos
              {Object.keys(pedidosMesa).length > 0 && (<span className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">{Object.keys(pedidosMesa).length}</span>)}
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {abaMain === 'mesas' ? (
              <MesaGrid
                mesas={mesas}
                mesasPagas={new Set(Object.entries(rodadasPagasPorMesa).filter(([mesaId]) => {
                  const r = pedidosMesa[mesaId] ?? [];
                  return r.length > 0 && r.every((rd) => rodadasPagasPorMesa[mesaId]?.has(rd.id));
                }).map(([k]) => k))}
                onSelect={handleSelectMesa}
                avulsosAtivos={pedidosAvulsos}
                avulsosDraft={avulsoDrafts}
                onSelectAvulso={handleSelectAvulso}
                onAbrirDraft={handleAbrirDraft}
                onDescartarDraft={handleDescartarDraft}
                onNovoAvulso={handleNovoAvulso}
              />
            ) : (
              <PedidosAtivosView
                pedidosMesa={pedidosMesa}
                pedidosAvulsos={pedidosAvulsos}
                onIrParaMesa={(mesaId) => {
                  const mesa = mesas.find((m) => m.id === mesaId);
                  if (mesa) handleSelectMesa(mesa);
                }}
              />
            )}
          </div>
        </div>
      )}

      {tela === 'pedido' && mesaSelecionada && (
        <div className="flex-1 overflow-hidden">
          <PedidoView
            carrinho={carrinho}
            rodadas={rodadasMesaAtual}
            mesaOcupada={mesaOcupada}
            mesaPaga={todasPagasMesaAtual}
            todasPagas={todasPagasMesaAtual}
            rodadasPagas={rodadasPagasMesaAtual}
            onAdd={handleAddItem}
            onUpdateQty={handleUpdateQty}
            onEditItem={handleEditItem}
            onRemoveItem={handleRemoveItem}
            onEnviar={handleEnviar}
            onVoltar={() => setTela('mesas')}
            onFecharConta={handleFecharConta}
            onPagarConta={(ids, formaPagId, valorParcial) => handlePagarConta(mesaSelecionada.id, ids, formaPagId, valorParcial)}
            mesaNome={mesaNome}
            garcomNome={mesaSelecionada.garcomNome}
            numeroPessoas={mesaSelecionada.numeroPessoas}
            mesaNumero={mesaSelecionada.numero}
            pessoasMesa={pessoasMesaAtual}
            onAdicionarPessoa={(nome) => handleAdicionarPessoa(mesaSelecionada.id, nome)}
            onRenomearPessoa={(antigo, novo) => handleRenomearPessoa(mesaSelecionada.id, antigo, novo)}
            onSalvarRascunho={handleSalvarRascunho}
            onRestaurarRascunho={temRascunho ? handleRestaurarRascunho : undefined}
            temRascunho={temRascunho}
            divisaoPagamentoSalvo={divisaoPagMesaAtual}
            onAtualizarDivisaoPag={(estado) => handleAtualizarDivisaoPag(mesaSelecionada.id, estado)}
            divisaoPersistedState={divisaoAbaMesaAtual}
            onDivisaoPersistedChange={(estado) => setDivisaoAbaPorMesa((prev) => ({ ...prev, [mesaSelecionada.id]: estado }))}
          />
        </div>
      )}

      {tela === 'avulso-pedido' && avulsoParaExibir && (
        <div className="flex-1 overflow-hidden">
          <PedidoView
            carrinho={carrinho}
            rodadas={rodadasAvulsoAtual}
            mesaOcupada={rodadasAvulsoAtual.length > 0}
            mesaPaga={false}
            todasPagas={rodadasAvulsoAtual.length > 0 && rodadasAvulsoAtual.every((r) => rodadasPagasAvulso.has(r.id))}
            rodadasPagas={rodadasPagasAvulso}
            onAdd={handleAddItem}
            onUpdateQty={handleUpdateQty}
            onEditItem={handleEditItem}
            onRemoveItem={handleRemoveItem}
            onEnviar={handleEnviarAvulso}
            onVoltar={handleVoltarAvulso}
            onFecharConta={handleFecharContaAvulso}
            onPagarConta={async (ids, formaPagId, valorParcial) => {
              if (submittingPaymentRef.current) return;
              submittingPaymentRef.current = true;
              try {
                // Para pedidos avulsos, pega os orderIds das rodadas
                const rodadasComOrder = rodadasAvulsoAtual.filter(
                  (r) => ids.includes(r.id) && r.orderId
                );

                // Se não há rodadas locais com orderId, usa os pedidos do KDS
                const orderIdsAvulso = rodadasComOrder.length > 0
                  ? rodadasComOrder.map((r) => r.orderId!)
                  : (pedidosAvulsos
                      .find((a) => a.id === avulsoParaExibir.id || a.nomeCliente.trim().toLowerCase() === avulsoParaExibir.nomeCliente.trim().toLowerCase())
                      ?.rodadas.map((r) => r.orderId)
                      .filter(Boolean) as string[] ?? []);

                let cashRegisterId: string | null = null;
                if (sessao?.id) {
                  const { data: crRow } = await supabase
                    .from('cash_registers')
                    .select('id')
                    .eq('session_id', sessao.id)
                    .eq('status', 'open')
                    .order('opened_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  cashRegisterId = crRow?.id ?? null;
                }

                // Quando valorParcial está definido (pagamento por divisão),
                // registra apenas UMA VEZ no primeiro pedido para evitar duplicação
                const orderIdsParaPagar = valorParcial !== undefined
                  ? orderIdsAvulso.slice(0, 1)
                  : orderIdsAvulso;

                for (const orderId of orderIdsParaPagar) {
                  const rodada = rodadasAvulsoAtual.find((r) => r.orderId === orderId);
                  const amount = valorParcial ?? rodada?.total ?? 0;
                  await invokeWithAuth('order-write', {
                    body: {
                      action: 'record_payment',
                      order_id: orderId,
                      tenant_id: user?.tenantId,
                      cash_register_id: cashRegisterId,
                      payment_method_id: formaPagId,
                      amount,
                      change_amount: 0,
                      operator_name: user?.nome ?? null,
                      paid_by_pdv: 'waiter',
                    },
                  });
                  void Promise.resolve(supabase.rpc('fn_update_paid_by_pdv', { p_order_id: orderId, p_paid_by_pdv: 'waiter' })).catch(() => {});
                }

                // Atualiza estado local das rodadas pagas do avulso
                setRodadasPagasAvulso((prev) => new Set([...prev, ...ids]));
                // Recarrega os pedidos do KDS para refletir isPaid = true
                setTimeout(() => reloadOrders(), 500);
              } catch (e) {
                console.error('[GarcomPage] record_payment avulso error:', e);
              } finally {
                submittingPaymentRef.current = false;
              }
            }}
            mesaNome={mesaNomeAvulso}
            garcomNome={avulsoParaExibir.garcomNome}
            numeroPessoas={undefined}
            mesaNumero={-1}
            isAvulso
            avulsoId={avulsoParaExibir.id}
            avulsoNomeCliente={avulsoParaExibir.nomeCliente}
            observacoesAvulso={avulsoParaExibir.observacoes}
            onSalvarRascunho={handleSalvarRascunho}
            onRestaurarRascunho={temRascunho ? handleRestaurarRascunho : undefined}
            temRascunho={temRascunho}
          />
        </div>
      )}

      {tela === 'sucesso' && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="bg-white/70 backdrop-blur-sm border border-zinc-200 rounded-2xl p-8 flex flex-col items-center max-w-xs w-full">
            <div className="w-16 h-16 flex items-center justify-center bg-green-50 border border-green-200 rounded-2xl mb-4">
              <i className="ri-check-double-line text-3xl text-green-500" />
            </div>
            <h2 className="text-xl font-bold text-zinc-900 mb-1">Pedido Enviado!</h2>
            <p className="text-zinc-500 text-sm mb-2">{avulsoParaExibir ? `${avulsoParaExibir.nomeCliente} · Para Levar` : `Mesa ${mesaSelecionada?.numero} · Enviado ao KDS`}</p>
            <div className="flex items-center gap-1 text-zinc-400 text-xs"><i className="ri-loader-4-line animate-spin" />Voltando para mesas...</div>
          </div>
        </div>
      )}

      {tela === 'identificacao' && mesaSelecionada && (
        <IdentificacaoMesaModal
          mesa={mesaSelecionada}
          mesasOcupadas={mesasOcupadas}
          onConfirmar={handleConfirmarIdentificacao}
          onTransferir={() => setTela('transferir')}
          onClose={() => { setMesaSelecionada(null); setTela('mesas'); }}
        />
      )}

      {tela === 'avulso-identificacao' && (
        <IdentificacaoAvulsoModal
          onConfirmar={handleConfirmarAvulso}
          onClose={() => setTela('mesas')}
        />
      )}

      {tela === 'transferir' && mesaSelecionada && (
        <TransferirMesaModal
          mesaDestino={mesaSelecionada}
          mesasOcupadas={mesasOcupadas}
          pedidosPorMesa={pedidosMesaFlat}
          onConfirmar={handleTransferirConfirmar}
          onVoltar={() => setTela('identificacao')}
        />
      )}
    </div>
  );
}