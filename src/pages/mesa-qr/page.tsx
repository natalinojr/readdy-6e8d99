import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import IdentificacaoMesaQR from './components/IdentificacaoMesaQR';
import CardapioMesaQR from './components/CardapioMesaQR';
import CarrinhoMesaQR from './components/CarrinhoMesaQR';
import ConfirmacaoMesaQR from './components/ConfirmacaoMesaQR';
import MeusPedidosModalQR from './components/MeusPedidosModalQR';

interface TableInfo {
  id: string;
  number: number;
  capacity: number;
  area: string;
  tenant_id: string;
  qr_token: string;
}

interface TableSession {
  id: string;
  status: string;
  session_id: string;
  tenant_id: string;
  customer_name: string | null;
  opened_at: string;
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
}

interface CardapioCategory {
  id: string;
  name: string;
  order_index: number | null;
  station_id: string | null;
}

interface OptionGroup {
  id: string;
  name: string;
  item_id: string;
  is_required: boolean;
  min_selection: number | null;
  max_selection: number | null;
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

interface CartItem {
  cartId: string;
  itemId: string;
  name: string;
  precoBase: number;
  precoTotal: number;
  quantidade: number;
  opcoes: { grupoNome: string; opcaoNome: string; precoAdicional: number }[];
  observacoes: string[];
  observacaoLivre: string;
  skipKds: boolean;
  stationId: string | null;
}

interface Participant {
  id: string;
  name: string;
  access_token: string;
  table_session_id: string;
  tenant_id: string;
}

const MESA_WRITE_URL = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '') + '/functions/v1/mesa-write';

export default function MesaQRPage() {
  const { qr_token } = useParams<{ qr_token: string }>();

  // Estado de carregamento
  const [step, setStep] = useState<'loading' | 'encerrada' | 'identificacao' | 'cardapio' | 'confirmacao'>('loading');
  const [table, setTable] = useState<TableInfo | null>(null);
  const [session, setSession] = useState<TableSession | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [error, setError] = useState('');

  // Cardápio
  const [categories, setCategories] = useState<CardapioCategory[]>([]);
  const [items, setItems] = useState<CardapioItem[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [options, setOptions] = useState<OptionItem[]>([]);
  const [observations, setObservations] = useState<PresetObservation[]>([]);
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);

  // Carrinho
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pedidoConfirmado, setPedidoConfirmado] = useState(false);
  const [numeroPedido, setNumeroPedido] = useState('');

  // Meus Pedidos
  const [showMeusPedidos, setShowMeusPedidos] = useState(false);

  // ── 1. Buscar mesa pelo qr_token ─────────────────────────────────────────
  const buscarMesa = useCallback(async () => {
    if (!qr_token) {
      setError('QR Code inválido');
      setStep('encerrada');
      return;
    }
    try {
      const res = await fetch(MESA_WRITE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup_mesa', qr_token }),
      });
      const data = await res.json();
      if (data.error === 'mesa_encerrada') {
        // Limpar todos os participantes salvos quando a mesa foi encerrada
        Object.keys(localStorage)
          .filter(k => k.startsWith('mesa_participant_'))
          .forEach(k => localStorage.removeItem(k));
        setStep('encerrada');
        return;
      }
      if (data.error) {
        setError(data.message || 'Erro ao buscar mesa');
        setStep('encerrada');
        return;
      }
      if (!data.table || !data.session) {
        setStep('encerrada');
        return;
      }
      setTable(data.table);
      setSession(data.session);
      // Verificar se já existe participante salvo para essa sessão
      const savedParticipant = localStorage.getItem(`mesa_participant_${data.session.id}`);
      if (savedParticipant) {
        try {
          const p = JSON.parse(savedParticipant);
          // Valida que o participante pertence à sessão ATUAL (não a uma sessão antiga)
          if (p.table_session_id && p.table_session_id !== data.session.id) {
            // Sessão mudou — limpa e pede nova identificação
            localStorage.removeItem(`mesa_participant_${data.session.id}`);
            // Limpa também chaves de sessões antigas desta mesa
            Object.keys(localStorage)
              .filter(k => k.startsWith('mesa_participant_'))
              .forEach(k => localStorage.removeItem(k));
            setStep('identificacao');
            await carregarCardapio(data.table.tenant_id);
            return;
          }
          setParticipant(p);
          setStep('cardapio');
          // Carregar cardápio
          await carregarCardapio(data.table.tenant_id);
          return;
        } catch {
          localStorage.removeItem(`mesa_participant_${data.session.id}`);
        }
      }
      setStep('identificacao');
      // Carregar cardápio
      await carregarCardapio(data.table.tenant_id);
    } catch {
      setError('Erro de conexão. Tente novamente.');
      setStep('encerrada');
    }
  }, [qr_token]);

  useEffect(() => {
    buscarMesa();
  }, [buscarMesa]);

  // ── 2. Carregar cardápio ───────────────────────────────────────────────────
  const carregarCardapio = async (tenantId: string) => {
    try {
      const res = await fetch(MESA_WRITE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_cardapio', tenant_id: tenantId }),
      });
      const data = await res.json();
      setCategories(data.categories || []);
      setItems(data.items || []);
      setOptionGroups(data.option_groups || []);
      setOptions(data.options || []);
      setObservations(data.observations || []);
      if (data.categories && data.categories.length > 0) {
        setCategoriaAtiva(data.categories[0].id);
      }
    } catch {
      // Cardápio pode falhar silenciosamente, tentamos de novo depois
    }
  };

  // ── 3. Criar participante ──────────────────────────────────────────────────
  const handleIdentificar = async (nome: string) => {
    if (!session || !table) return;
    try {
      const res = await fetch(MESA_WRITE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_participant',
          table_session_id: session.id,
          name: nome.trim(),
          tenant_id: table.tenant_id,
        }),
      });
      const data = await res.json();
      console.log('[create_participant] res status:', res.status, 'data:', data);
      if (data.error) {
        setError(data.message || data.error || 'Erro ao criar participante');
        return;
      }
      setParticipant(data.participant);
      // Salvar participante no localStorage para evitar recriar a cada reload
      localStorage.setItem(
        `mesa_participant_${session.id}`,
        JSON.stringify(data.participant)
      );
      setStep('cardapio');
    } catch {
      setError('Erro de conexão. Tente novamente.');
    }
  };

  // ── 4. Adicionar ao carrinho ───────────────────────────────────────────────
  const handleAdicionar = (item: CartItem) => {
    setCart((prev) => {
      const idx = prev.findIndex(
        (c) => c.itemId === item.itemId &&
          JSON.stringify(c.opcoes) === JSON.stringify(item.opcoes) &&
          c.observacaoLivre === item.observacaoLivre
      );
      if (idx >= 0) {
        const novo = [...prev];
        novo[idx] = { ...novo[idx], quantidade: novo[idx].quantidade + item.quantidade };
        return novo;
      }
      return [...prev, item];
    });
  };

  const handleAlterarQtd = (cartId: string, delta: number) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.cartId === cartId);
      if (idx < 0) return prev;
      const novo = [...prev];
      const novaQtd = novo[idx].quantidade + delta;
      if (novaQtd <= 0) {
        return novo.filter((_, i) => i !== idx);
      }
      novo[idx] = { ...novo[idx], quantidade: novaQtd };
      return novo;
    });
  };

  const handleRemover = (cartId: string) => {
    setCart((prev) => prev.filter((c) => c.cartId !== cartId));
  };

  // ── 5. Confirmar pedido ───────────────────────────────────────────────────
  const handleConfirmarPedido = async () => {
    if (!session || !table || !participant) return;
    if (cart.length === 0) return;

    setEnviando(true);
    try {
      const subtotal = cart.reduce((s, i) => s + i.precoTotal * i.quantidade, 0);
      const itemsPayload = cart.map((ci) => ({
        item_id: ci.itemId,
        item_name: ci.name,
        item_price: ci.precoTotal,
        quantity: ci.quantidade,
        station_id: ci.stationId,
        skip_kds: ci.skipKds,
        notes: ci.observacaoLivre || null,
        options: ci.opcoes.map((o) => ({
          option_id: null,
          option_name: o.opcaoNome,
          group_name: o.grupoNome,
          additional_price: o.precoAdicional,
        })),
        observations: ci.observacoes.map((t) => ({ text: t, is_checked: false })),
      }));

      const res = await fetch(MESA_WRITE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_mesa_order',
          tenant_id: table.tenant_id,
          table_session_id: session.id,
          session_id: session.session_id,
          participant_id: participant.id,
          access_token: participant.access_token,
          mesa_number: table.number,
          items: itemsPayload,
          subtotal,
          total_amount: subtotal,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.message || 'Erro ao enviar pedido');
        setEnviando(false);
        return;
      }

      setNumeroPedido(data.data?.number || '');
      setPedidoConfirmado(true);
      setCart([]);
      setShowCart(false);
      setEnviando(false);
      setStep('confirmacao');
    } catch {
      setError('Erro de conexão. Tente novamente.');
      setEnviando(false);
    }
  };

  const handleNovoPedido = () => {
    setPedidoConfirmado(false);
    setNumeroPedido('');
    setError('');
    setStep('cardapio');
  };

  // ── Tela: Carregando ─────────────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-5 bg-amber-50 rounded-2xl border border-amber-100">
            <i className="ri-loader-4-line text-2xl text-amber-500 animate-spin" />
          </div>
          <p className="text-sm font-bold text-zinc-800">Buscando sua mesa...</p>
          <p className="text-xs text-zinc-500 mt-1">Aguarde um momento</p>
        </div>
      </div>
    );
  }

  // ── Tela: Mesa encerrada ─────────────────────────────────────────────────
  if (step === 'encerrada') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-xs">
          <div className="w-20 h-20 flex items-center justify-center mx-auto mb-6 bg-amber-50 rounded-2xl border border-amber-100">
            <i className="ri-door-closed-line text-4xl text-amber-500" />
          </div>
          <h2 className="text-xl font-black text-zinc-800 mb-2">Mesa Encerrada</h2>
          <p className="text-sm text-zinc-500 leading-relaxed">
            {error || 'Esta mesa foi encerrada. Se precisar de ajuda, chame um garçom.'}
          </p>
          {table && (
            <div className="mt-6 flex items-center justify-center gap-2 px-4 py-2 bg-zinc-100 rounded-full">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-zinc-600 text-xs font-semibold">Mesa {table.number}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Tela: Identificação ──────────────────────────────────────────────────
  if (step === 'identificacao' && table) {
    return (
      <IdentificacaoMesaQR
        mesaNumero={table.number}
        onConfirmar={handleIdentificar}
        error={error}
      />
    );
  }

  // ── Tela: Confirmação ────────────────────────────────────────────────────
  if (step === 'confirmacao' && participant) {
    return (
      <ConfirmacaoMesaQR
        accessToken={participant.access_token}
        numeroPedido={numeroPedido}
        onNovoPedido={handleNovoPedido}
      />
    );
  }

  // ── Tela: Cardápio ───────────────────────────────────────────────────────
  const totalItens = cart.reduce((s, i) => s + i.quantidade, 0);
  const totalValor = cart.reduce((s, i) => s + i.precoTotal * i.quantidade, 0);

  return (
    <div className="min-h-screen bg-white flex justify-center">
      <div className="w-full max-w-lg min-h-screen flex flex-col bg-white relative">
        {/* Header */}
        <div className="bg-zinc-900 px-4 pt-6 pb-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 flex items-center justify-center bg-amber-500 rounded-xl">
                <i className="ri-restaurant-2-line text-white text-sm" />
              </div>
              <div>
                <h1 className="text-white text-lg font-black leading-tight">Mesa {table?.number}</h1>
                {participant && (
                  <p className="text-zinc-500 text-xs">
                    Olá, <strong className="text-amber-400">{participant.name}</strong>
                  </p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-zinc-500 text-[10px] uppercase tracking-wider font-bold">{table?.area || 'Salão'}</p>
              {participant && (
                <div className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-800 rounded-full border border-zinc-700">
                  <i className="ri-lock-password-line text-[10px] text-amber-400" />
                  <span className="text-amber-400 text-[10px] font-bold">Senha {participant.access_token}</span>
                </div>
              )}
            </div>
          </div>
          {participant && (
            <button
              onClick={() => setShowMeusPedidos(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap border border-zinc-700"
            >
              <div className="w-4 h-4 flex items-center justify-center">
                <i className="ri-receipt-line" />
              </div>
              Meus Pedidos
            </button>
          )}
        </div>

        {/* Categorias sticky */}
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-zinc-100 shrink-0">
          <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategoriaAtiva(cat.id)}
                className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap cursor-pointer transition-all duration-200 ${
                  categoriaAtiva === cat.id
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 border border-zinc-100'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo scrollable */}
        <div className="flex-1 overflow-y-auto">
          {showCart ? (
            <CarrinhoMesaQR
              cart={cart}
              onAlterarQtd={handleAlterarQtd}
              onRemover={handleRemover}
              onConfirmar={handleConfirmarPedido}
              enviando={enviando}
              error={error}
              onVoltar={() => setShowCart(false)}
            />
          ) : (
            <CardapioMesaQR
              categoriaAtiva={categoriaAtiva}
              categories={categories}
              items={items}
              optionGroups={optionGroups}
              options={options}
              observations={observations}
              onAdicionar={handleAdicionar}
              onVerCarrinho={() => setShowCart(true)}
              cart={cart}
            />
          )}
        </div>

        {/* Footer carrinho fixo */}
        {!showCart && totalItens > 0 && (
          <div className="sticky bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-zinc-100 px-4 py-3 z-30">
            <button
              onClick={() => setShowCart(true)}
              className="w-full flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 text-white px-5 py-3.5 rounded-xl cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 flex items-center justify-center bg-white/20 rounded-full">
                  <span className="text-xs font-bold text-white">{totalItens}</span>
                </div>
                <span className="text-sm font-bold">Ver pedido</span>
              </div>
              <span className="text-sm font-bold">
                R$ {totalValor.toFixed(2)}
              </span>
            </button>
          </div>
        )}

        {/* Modal Meus Pedidos */}
        {showMeusPedidos && participant && (
          <MeusPedidosModalQR
            participantId={participant.id}
            participantName={participant.name}
            tenantId={participant.tenant_id}
            onClose={() => setShowMeusPedidos(false)}
          />
        )}
      </div>
    </div>
  );
}