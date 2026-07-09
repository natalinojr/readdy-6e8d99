import { useState, useEffect, useRef } from 'react';
import { useDeliveryData, getOrderSource } from './useDeliveryData';
import IdentificacaoDelivery from './components/IdentificacaoDelivery';
import EnderecoDelivery from './components/EnderecoDelivery';
import EnderecoPinDelivery from './components/EnderecoPinDelivery';
import ConfirmacaoDelivery from './components/ConfirmacaoDelivery';
import AcompanharPedido from './components/AcompanharPedido';
import HistoricoPedidos from './components/HistoricoPedidos';
import CardapioMesaQR from '../mesa-qr/components/CardapioMesaQR';
import CarrinhoDelivery from './components/CarrinhoDelivery';
import EditarItemMesaQRModal from '../mesa-qr/components/EditarItemMesaQRModal';
import ModoEntregaDelivery from './components/ModoEntregaDelivery';
import { scrollFocusedFieldIntoView } from '@/lib/scrollFocusIntoView';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';

// ── Helpers de ícones de tipo de endereço ─────────────────────────────────────

const ADDRESS_TYPE_ICONS: Record<string, string> = {
  'Casa': 'ri-home-4-line',
  'Trabalho': 'ri-briefcase-line',
  'Escritório': 'ri-building-line',
  'Faculdade': 'ri-graduation-cap-line',
  'Casa dos pais': 'ri-heart-line',
};

function getAddressDropdownIcon(label: string): string {
  return ADDRESS_TYPE_ICONS[label] || 'ri-map-pin-line';
}

// ── Extrair slug da URL de forma robusta (bypass React Router params) ───────

function getStoreSlugFromUrl(): string | undefined {
  const path = window.location.pathname;
  // Remove basePath se existir
  const basePath = (__BASE_PATH__ || '').replace(/\/$/, '');
  const cleanPath = basePath ? path.replace(basePath, '') : path;

  // Padrão: /qualquer-coisa-delivery
  const match = cleanPath.match(/\/([^/]+)-delivery\/?$/);
  if (match) {
    return match[1];
  }

  // Fallback: /delivery/qualquer-coisa
  const match2 = cleanPath.match(/\/delivery\/([^/]+)\/?$/);
  if (match2) {
    return match2[1];
  }

  return undefined;
}

export default function DeliveryPage() {
  const storeSlug = getStoreSlugFromUrl();
  const data = useDeliveryData(storeSlug);

  // Captura a origem (utm_source) já na entrada, antes de o cliente navegar pelos passos.
  useEffect(() => { getOrderSource(); }, []);

  // Título da aba (aparece no navegador interno do Instagram/WhatsApp).
  useEffect(() => {
    const prev = document.title;
    if (data.tenant?.name) document.title = `Peça online — ${data.tenant.name}`;
    return () => { document.title = prev; };
  }, [data.tenant?.name]);

  const step = data.step;
  const tenant = data.tenant;
  const city = data.city;
  const neighborhoods = data.neighborhoods;
  const error = data.error;
  const phone = data.phone;
  const customerName = data.customerName;
  const selectedNeighborhoodId = data.selectedNeighborhoodId;
  const street = data.street;
  const addressNumber = data.addressNumber;
  const complement = data.complement;
  const referencePoint = data.referencePoint;
  const bairroAtual = data.bairroAtual;
  const savedAddresses = data.savedAddresses;
  const selectedAddressId = data.selectedAddressId;
  const enderecoAtual = data.enderecoAtual;
  const displayAddresses = data.displayAddresses;
  const categories = data.categories;
  const items = data.items;
  const optionGroups = data.optionGroups;
  const options = data.options;
  const observations = data.observations;
  const categoriaAtiva = data.categoriaAtiva;
  const outOfStockIds = data.outOfStockIds;
  const cart = data.cart;
  const editingItem = data.editingItem;
  const showCart = data.showCart;
  const enviando = data.enviando;
  const pedidoConfirmado = data.pedidoConfirmado;
  const numeroPedido = data.numeroPedido;
  const orderTotal = data.orderTotal;
  const deliveryFee = data.deliveryFee;
  const totalItens = data.totalItens;
  const totalItensProdutos = data.totalItensProdutos;
  const tenantId = data.tenantId;
  const customerId = data.customerId;
  const opcoesIndisponiveisIds = data.opcoesIndisponiveisIds;
  const paymentMethods = data.paymentMethods;
  const pagamentoSelecionado = data.pagamentoSelecionado;
  const modoEntrega = data.modoEntrega;
  const customer = data.customer;
  const storeWhatsapp = data.storeWhatsapp;
  // Link de WhatsApp da loja (botão "Falar com a loja"). Número guardado em dígitos;
  // prefixa 55 quando não vier com código do país.
  const lojaWaDigits = (storeWhatsapp || '').replace(/\D/g, '');
  const lojaWaUrl = lojaWaDigits.length >= 10
    ? 'https://wa.me/' + (lojaWaDigits.length > 11 && lojaWaDigits.startsWith('55') ? lojaWaDigits : '55' + lojaWaDigits)
    : '';

  // Iniciais da loja para o "logo" do header (1ª letra das 2 primeiras palavras)
  const lojaIniciais = (data.tenant?.name || 'DL')
    .split(/\s+/)
    .slice(0, 2)
    .map(function (w: string) { return w.charAt(0); })
    .join('')
    .toUpperCase();

  // Entrega por distância (pin)
  const distanceMode = data.distanceMode;
  const deliveryQuote = data.deliveryQuote;
  const foraDeArea = data.foraDeArea;

  const handleLookupCustomer = data.handleLookupCustomer;
  const handleSalvarEndereco = data.handleSalvarEndereco;
  const handleSelecionarEndereco = data.handleSelecionarEndereco;
  const handleSalvarNovoEndereco = data.handleSalvarNovoEndereco;
  const handleDeletarEndereco = data.handleDeletarEndereco;
  const handleSetDefaultAddress = data.handleSetDefaultAddress;
  const enderecoFromCardapio = data.enderecoFromCardapio;
  const setEnderecoFromCardapio = data.setEnderecoFromCardapio;
  const handleIrParaEnderecos = data.handleIrParaEnderecos;
  const handleConfirmarModo = data.handleConfirmarModo;
  const handleAdicionar = data.handleAdicionar;
  const handleAlterarQtd = data.handleAlterarQtd;
  const handleRemover = data.handleRemover;
  const handleAbrirEdicao = data.handleAbrirEdicao;
  const handleSalvarEdicao = data.handleSalvarEdicao;
  const handleFecharEdicao = data.handleFecharEdicao;
  const handleConfirmarPedido = data.handleConfirmarPedido;
  const handleNovoPedido = data.handleNovoPedido;
  const handleChangeNeighborhood = data.handleChangeNeighborhood;

  // Sub-view para acompanhar pedido e histórico
  const [subView, setSubView] = useState<'cardapio' | 'acompanhar' | 'acompanhar_input' | 'historico'>('cardapio');
  const [previousSubView, setPreviousSubView] = useState<'acompanhar_input' | 'historico'>('acompanhar_input');
  const [trackingNumero, setTrackingNumero] = useState('');

  // Modal de pagamento
  const [showPagamentoModal, setShowPagamentoModal] = useState(false);
  const [metodoPagamento, setMetodoPagamento] = useState('');
  const [valorDinheiro, setValorDinheiro] = useState('');
  const [erroValorDinheiro, setErroValorDinheiro] = useState('');

  // Dropdown de endereço
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);

  // Menu de perfil no header (telefone, histórico, sair)
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Deep link de divulgação de item (?item=<id>): abre o item direto ao carregar
  const [deepLinkItemId, setDeepLinkItemId] = useState<string | null>(function () {
    try { return new URLSearchParams(window.location.search).get('item'); } catch { return null; }
  });
  function handleDeepLinkConsumed() {
    setDeepLinkItemId(null);
    // Remove o ?item= da URL para não reabrir em refresh/navegação
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('item');
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    } catch { /* ignore */ }
  }

  // Altura do teclado virtual (para levantar modais/campos acima dele)
  const kbInset = useKeyboardInset();

  // Controle de clique vs scroll
  const categoriaClickRef = useRef(false);
  const categoriaClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scrollToCategoria(catId: string) {
    if (categoriaClickTimerRef.current) clearTimeout(categoriaClickTimerRef.current);
    categoriaClickRef.current = true;
    categoriaClickTimerRef.current = setTimeout(function () {
      categoriaClickRef.current = false;
    }, 800);

    data.setCategoriaAtiva(catId);

    // Se o carrinho estiver aberto, fecha primeiro e espera o cardápio renderizar
    if (showCart) {
      data.setShowCart(false);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          const el = document.getElementById('scroll-cat-' + catId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });
    } else {
      const el = document.getElementById('scroll-cat-' + catId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  function handleCategoriaAtivaChange(catId: string) {
    if (categoriaClickRef.current) return;
    data.setCategoriaAtiva(catId);
  }

  // Pedidos ativos
  const [activeOrders, setActiveOrders] = useState<Array<{ id: string; number: string; status: string; created_at: string; total_amount: number; delivery_fee: number }>>([]);
  const [activeOrdersLoading, setActiveOrdersLoading] = useState(false);
  const [activeOrdersError, setActiveOrdersError] = useState('');

  function fetchActiveOrders() {
    if (!tenantId || !phone) return;
    setActiveOrdersLoading(true);
    setActiveOrdersError('');

    const url = ((import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '')) + '/functions/v1/delivery-write';

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_customer_orders', tenant_id: tenantId, phone: phone }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          setActiveOrdersError(data.message || 'Erro ao carregar pedidos');
          setActiveOrdersLoading(false);
          return;
        }
        const all = data.orders || [];
        const ativos = all.filter(function (o: { status: string }) {
          return o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'draft';
        });
        setActiveOrders(ativos);
        setActiveOrdersLoading(false);
      })
      .catch(function () {
        setActiveOrdersError('Erro de conexão');
        setActiveOrdersLoading(false);
      });
  }

  useEffect(function () {
    if (data.step !== 'cardapio') {
      setSubView('cardapio');
    }
  }, [data.step]);

  // Badge de pedidos em andamento no header — busca uma vez ao chegar no cardápio
  useEffect(function () {
    if (data.step === 'cardapio' && customerId && tenantId && phone) {
      fetchActiveOrders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.step, customerId, tenantId, phone]);

  // ── Renderização ──

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-5 bg-amber-50 rounded-2xl border border-amber-100">
            <i className="ri-loader-4-line text-2xl text-amber-500 animate-spin" />
          </div>
          <p className="text-sm font-bold text-zinc-800">Carregando delivery</p>
          <p className="text-xs text-zinc-500 mt-1">Aguarde um momento</p>
        </div>
      </div>
    );
  }

  if (step === 'erro_config') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-5 bg-red-50 rounded-2xl border border-red-100">
            <i className="ri-error-warning-line text-2xl text-red-500" />
          </div>
          <p className="text-sm font-bold text-zinc-800">Erro ao carregar</p>
          <p className="text-xs text-zinc-500 mt-2 mb-5">{error || 'Não foi possível carregar o delivery. Verifique sua conexão.'}</p>
          <button
            type="button"
            onClick={function () { window.location.reload(); }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-refresh-line text-sm" />
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (step === 'identificacao') {
    return (
      <IdentificacaoDelivery
        phone={phone}
        onPhoneChange={data.setPhone}
        onBuscar={function () { handleLookupCustomer(phone); }}
        enviando={enviando}
        error={error}
        city={city}
        tenantName={tenant?.name}
      />
    );
  }

  if (step === 'modo_entrega') {
    return (
      <ModoEntregaDelivery
        customerName={customerName}
        phone={phone}
        tenantName={tenant?.name}
        onSelecionar={handleConfirmarModo}
        enviando={enviando}
        waUrl={lojaWaUrl}
        isExistingCustomer={!!customer}
        onNomeChange={data.setCustomerName}
      />
    );
  }

  if (step === 'endereco' && distanceMode) {
    return (
      <EnderecoPinDelivery
        phone={phone}
        nome={customerName}
        onNomeChange={data.setCustomerName}
        nascimento={data.dataNascimento}
        onNascimentoChange={data.setDataNascimento}
        genero={data.genero}
        onGeneroChange={data.setGenero}
        rua={street}
        onRuaChange={data.setStreet}
        numero={addressNumber}
        onNumeroChange={data.setAddressNumber}
        bairro={data.bairro}
        onBairroChange={data.setBairro}
        complemento={complement}
        onComplementoChange={data.setComplement}
        referencia={referencePoint}
        onReferenciaChange={data.setReferencePoint}
        storeLat={data.storeLocation ? data.storeLocation.lat : null}
        storeLng={data.storeLocation ? data.storeLocation.lng : null}
        addressLat={data.addressLat}
        addressLng={data.addressLng}
        onPinChange={data.setAddressPin}
        deliveryQuote={deliveryQuote}
        foraDeArea={foraDeArea}
        isExistingCustomer={!!customer}
        savedAddresses={savedAddresses}
        selectedAddressId={selectedAddressId}
        onSalvar={handleSalvarEndereco}
        onSelecionarEndereco={handleSelecionarEndereco}
        onSalvarNovoEndereco={handleSalvarNovoEndereco}
        onDeletarEndereco={handleDeletarEndereco}
        onSetDefaultAddress={handleSetDefaultAddress}
        onIrParaCardapio={function () { data.setStep('cardapio'); }}
        onVoltar={function () {
          if (enderecoFromCardapio) {
            setEnderecoFromCardapio(false);
            data.setStep('cardapio');
            data.setError('');
            return;
          }
          if (customer) {
            data.setStep('modo_entrega');
          } else {
            data.setStep('identificacao' as any);
          }
          data.setError('');
        }}
        enviando={enviando}
        error={error}
        city={city}
      />
    );
  }

  if (step === 'endereco') {
    return (
      <EnderecoDelivery
        phone={phone}
        nome={customerName}
        onNomeChange={data.setCustomerName}
        nascimento={data.dataNascimento}
        onNascimentoChange={data.setDataNascimento}
        genero={data.genero}
        onGeneroChange={data.setGenero}
        bairroId={selectedNeighborhoodId}
        onBairroChange={data.setSelectedNeighborhoodId}
        rua={street}
        onRuaChange={data.setStreet}
        numero={addressNumber}
        onNumeroChange={data.setAddressNumber}
        complemento={complement}
        onComplementoChange={data.setComplement}
        referencia={referencePoint}
        onReferenciaChange={data.setReferencePoint}
        neighborhoods={neighborhoods}
        savedAddresses={savedAddresses}
        selectedAddressId={selectedAddressId}
        isExistingCustomer={!!customer}
        onSalvar={handleSalvarEndereco}
        onSelecionarEndereco={handleSelecionarEndereco}
        onSalvarNovoEndereco={handleSalvarNovoEndereco}
        onDeletarEndereco={handleDeletarEndereco}
        onSetDefaultAddress={handleSetDefaultAddress}
        onIrParaCardapio={function () { data.setStep('cardapio'); }}
        onVoltar={function () {
          if (enderecoFromCardapio) {
            setEnderecoFromCardapio(false);
            data.setStep('cardapio');
            data.setError('');
            return;
          }
          if (customer) {
            data.setStep('modo_entrega');
          } else {
            data.setStep('identificacao' as any);
          }
          data.setError('');
        }}
        enviando={enviando}
        error={error}
        city={city}
      />
    );
  }

  if (step === 'confirmacao' && pedidoConfirmado) {
    return (
      <ConfirmacaoDelivery
        numeroPedido={numeroPedido}
        orderTotal={orderTotal}
        deliveryFee={deliveryFee}
        phone={phone}
        tenantId={tenantId}
        customerId={customerId}
        onNovoPedido={handleNovoPedido}
        paymentMethod={pagamentoSelecionado}
        modoEntrega={modoEntrega}
        resumo={data.resumoConfirmacao}
      />
    );
  }

  // ── Cardápio ──
  const enderecoParts: string[] = [];
  if (modoEntrega === 'retirada') {
    enderecoParts.push('Retirada na loja');
  } else {
    if (street) enderecoParts.push(street);
    if (addressNumber) enderecoParts.push(addressNumber);
    if (complement) enderecoParts.push('(' + complement + ')');
  }
  const enderecoDisplay = enderecoParts.join(', ') || 'Endereço';

  const hasAnyAddresses = displayAddresses.length > 0;

  return (
    <div className="min-h-screen bg-white flex justify-center">
      <div className="w-full max-w-lg h-dvh flex flex-col bg-white relative">
        {/* Banner: delivery fechado (fora do horário / pausado / sem sessão) */}
        {!data.deliveryOpenNow && (
          <div className="shrink-0 bg-red-500 text-white px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-semibold text-center">
            <i className="ri-store-2-line text-base shrink-0" />
            <span>{
              data.deliveryClosedReason === 'fora_horario' ? 'Estamos fora do horário de funcionamento. Volte mais tarde!'
              : data.deliveryClosedReason === 'pausado' ? 'A loja está temporariamente pausada. Volte em instantes!'
              : 'A loja está fechada para pedidos no momento.'
            }</span>
          </div>
        )}
        {/* Header (oculto ao ver o pedido, p/ dar mais espaço à lista de itens) */}
        <div className={"shrink-0" + (showCart ? " hidden" : "")}>
          {/* Hero: marca da loja + status + ações */}
          <div className="relative bg-gradient-to-br from-amber-500 via-orange-500 to-orange-600 px-4 pt-5 pb-12">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(circle at 85% -20%, rgba(255,255,255,.25), transparent 45%)' }}
            />
            <div className="relative flex items-center gap-3">
              <div className="w-11 h-11 flex items-center justify-center bg-white rounded-2xl shadow-md shrink-0">
                <span className="text-orange-600 font-black text-base">{lojaIniciais}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-white text-base font-black leading-tight truncate">{tenant?.name || 'Delivery'}</h1>
                <p className="text-white/85 text-[11px] mt-0.5 flex items-center gap-1.5 min-w-0">
                  {data.deliveryOpenNow ? (
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full font-bold text-[10px] text-white">
                      <span className="w-1.5 h-1.5 bg-green-300 rounded-full" />
                      Aberto
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-black/20 rounded-full font-bold text-[10px] text-white">
                      <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                      Fechado
                    </span>
                  )}
                  <span className="truncate">Olá, {(customerName || '').split(' ')[0]} 👋</span>
                </p>
              </div>

              {/* Meus pedidos (badge = pedidos em andamento) */}
              {customerId ? (
                <button
                  type="button"
                  onClick={function () {
                    setSubView(activeOrders.length > 0 ? 'acompanhar_input' : 'historico');
                    fetchActiveOrders();
                  }}
                  className="relative w-9 h-9 flex items-center justify-center bg-white/20 hover:bg-white/30 border border-white/25 rounded-xl text-white cursor-pointer transition-colors shrink-0"
                  title="Meus pedidos"
                >
                  <i className="ri-file-list-3-line text-[15px]" />
                  {activeOrders.length > 0 ? (
                    <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 flex items-center justify-center bg-white text-orange-600 text-[9px] font-black rounded-full">
                      {activeOrders.length}
                    </span>
                  ) : null}
                </button>
              ) : null}

              {/* Perfil: telefone, histórico, sair */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={function () { setShowProfileMenu(!showProfileMenu); }}
                  className="w-9 h-9 flex items-center justify-center bg-white/20 hover:bg-white/30 border border-white/25 rounded-xl text-white cursor-pointer transition-colors"
                  title="Meu perfil"
                >
                  <i className="ri-user-3-line text-[15px]" />
                </button>
                {showProfileMenu ? (
                  <>
                    <div className="fixed inset-0 z-[40]" onClick={function () { setShowProfileMenu(false); }} />
                    <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-zinc-100 z-[50] overflow-hidden">
                      <div className="px-3 py-2.5 border-b border-zinc-100">
                        <p className="text-xs font-bold text-zinc-800 truncate">{customerName}</p>
                        <p className="text-[10px] text-zinc-400"><i className="ri-phone-line mr-1" />{phone}</p>
                      </div>
                      <button
                        type="button"
                        onClick={function () { setShowProfileMenu(false); setSubView('historico'); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors"
                      >
                        <i className="ri-history-line text-sm text-zinc-400" />
                        Histórico de pedidos
                      </button>
                      {/* Sair: encerra a sessão neste aparelho p/ entrar com outro número */}
                      <button
                        type="button"
                        onClick={function () {
                          setShowProfileMenu(false);
                          if (window.confirm('Sair e entrar com outro número? Seu carrinho atual será esvaziado.')) {
                            data.handleSair();
                          }
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer transition-colors border-t border-zinc-100"
                      >
                        <i className="ri-logout-box-r-line text-sm" />
                        Sair (usar outro número)
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* Card flutuante: modo de entrega + endereço + taxa/região/loja */}
          <div className="relative z-30 -mt-8 mx-4 mb-2 bg-white rounded-2xl shadow-lg border border-zinc-100">
            <div className="flex items-center gap-2 px-2.5 py-2.5">
              {/* Toggle Entrega/Retirada — troca direto, sem voltar à tela de modo:
                  retirada é instantânea; entrega só abre a tela de endereço se não houver um */}
              <div className="flex bg-zinc-100 rounded-xl p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={function () { if (modoEntrega === 'retirada') handleConfirmarModo('entrega'); }}
                  className={'flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-[11px] font-bold cursor-pointer transition-colors ' +
                    (modoEntrega !== 'retirada' ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700')}
                >
                  <i className="ri-e-bike-2-line text-xs" />
                  Entrega
                </button>
                <button
                  type="button"
                  onClick={function () { if (modoEntrega !== 'retirada') handleConfirmarModo('retirada'); }}
                  className={'flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-[11px] font-bold cursor-pointer transition-colors ' +
                    (modoEntrega === 'retirada' ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700')}
                >
                  <i className="ri-store-2-line text-xs" />
                  Retirada
                </button>
              </div>

            {modoEntrega !== 'retirada' ? (
              <div className="relative flex-1 min-w-0">
                <button
                  type="button"
                  onClick={function () {
                    if (hasAnyAddresses) {
                      setShowAddressDropdown(!showAddressDropdown);
                    } else {
                      handleIrParaEnderecos();
                    }
                  }}
                  className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-lg hover:bg-zinc-50 cursor-pointer transition-colors text-left min-w-0"
                >
                  <i className="ri-map-pin-2-fill text-amber-500 text-sm shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">Entregar em</span>
                    <span className="block text-xs font-bold text-zinc-800 truncate">
                      {enderecoAtual ? enderecoAtual.label + ' · ' + enderecoDisplay : enderecoDisplay}
                    </span>
                  </span>
                  <i className={'ri-arrow-down-s-line text-zinc-400 shrink-0 transition-transform ' + (showAddressDropdown ? 'rotate-180' : '')} />
                </button>

                {/* Dropdown de endereços */}
                {showAddressDropdown && hasAnyAddresses ? (
                  <>
                    <div
                      className="fixed inset-0 z-[40]"
                      onClick={function () { setShowAddressDropdown(false); }}
                    />
                    <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-zinc-100 z-[50] overflow-hidden">
                      <div className="px-3 py-2 border-b border-zinc-100">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Seus endereços</p>
                      </div>
                      <div className="max-h-64 overflow-y-auto py-1">
                        {displayAddresses.map(function (addr) {
                          const isSelected = addr.id === selectedAddressId;
                          const addrLine: string[] = [];
                          if (addr.street) addrLine.push(addr.street);
                          if (addr.number) addrLine.push(addr.number);
                          const line = addrLine.join(', ') || 'Endereço incompleto';

                          return (
                            <button
                              key={addr.id}
                              type="button"
                              onClick={function () {
                                handleSelecionarEndereco(addr.id);
                                setShowAddressDropdown(false);
                              }}
                              className={'w-full text-left px-3 py-2.5 hover:bg-amber-50 transition-colors cursor-pointer ' +
                                (isSelected ? 'bg-amber-50' : '')
                              }
                            >
                              <div className="flex items-center gap-2">
                                <div className={'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ' +
                                  (isSelected ? 'bg-amber-500 border-amber-500' : 'border-zinc-300')
                                }>
                                  {isSelected ? <i className="ri-check-line text-white text-[8px]" /> : null}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 flex items-center justify-center bg-zinc-100 rounded-md shrink-0 mr-1">
                                    <i className={getAddressDropdownIcon(addr.label) + ' text-zinc-400 text-[10px]'} />
                                  </div>
                                  <span className="text-xs font-bold text-zinc-800 truncate">{addr.label}</span>
                                    {addr.is_default ? (
                                      <span className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded-full">
                                        <i className="ri-star-fill text-[7px]" />
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="text-[10px] text-zinc-500 truncate">{line}</p>
                                  <p className="text-[10px] text-zinc-400">
                                    {addr.neighborhood_name || 'Sem bairro'}
                                    {addr.neighborhood_delivery_fee > 0 ? ' • R$ ' + addr.neighborhood_delivery_fee.toFixed(2) : ' • Grátis'}
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t border-zinc-100 p-2">
                        <button
                          type="button"
                          onClick={function () {
                            setShowAddressDropdown(false);
                            handleIrParaEnderecos();
                          }}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                        >
                          <i className="ri-settings-3-line text-xs" />
                          Gerenciar endereços
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="flex-1 min-w-0 px-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Retirar na loja</p>
                <p className="text-xs font-bold text-zinc-800 truncate">{tenant?.name || 'Balcão da loja'}</p>
              </div>
            )}
            </div>

            {/* Rodapé do card: taxa / região / falar com a loja */}
            <div className="flex items-stretch border-t border-zinc-100">
              <div className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-semibold text-zinc-500">
                <i className="ri-truck-line text-amber-500 text-[13px]" />
                {modoEntrega === 'retirada'
                  ? 'Sem taxa'
                  : (distanceMode
                      ? (deliveryQuote ? (deliveryQuote.taxa > 0 ? 'R$ ' + deliveryQuote.taxa.toFixed(2) : 'Grátis') : 'A calcular')
                      : (deliveryFee > 0 ? 'R$ ' + deliveryFee.toFixed(2) : 'Grátis'))}
              </div>
              <div className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-semibold text-zinc-500 border-l border-zinc-100 min-w-0">
                {modoEntrega === 'retirada' ? (
                  <>
                    <i className="ri-store-2-line text-amber-500 text-[13px]" />
                    <span className="truncate">Balcão</span>
                  </>
                ) : distanceMode ? (
                  <>
                    <i className="ri-route-line text-amber-500 text-[13px]" />
                    <span className="truncate">
                      {deliveryQuote
                        ? '~' + deliveryQuote.km.toFixed(1) + ' km' + (deliveryQuote.tempoMax > 0 ? ' · até ' + deliveryQuote.tempoMax + ' min' : '')
                        : 'Marcar no mapa'}
                    </span>
                  </>
                ) : (
                  <>
                    <i className="ri-map-pin-line text-amber-500 text-[13px]" />
                    <span className="truncate">{bairroAtual ? bairroAtual.name : 'Sem bairro'}</span>
                  </>
                )}
              </div>
              {lojaWaUrl ? (
                <a
                  href={lojaWaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-bold text-green-600 hover:bg-green-50 border-l border-zinc-100 transition-colors"
                  title="Falar com a loja no WhatsApp"
                >
                  <i className="ri-whatsapp-line text-[13px]" />
                  Loja
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {/* Categorias sticky */}
        {subView === 'cardapio' && !showCart ? (
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-zinc-100 shrink-0">
          <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
            {categories.map(function (cat) {
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={function () { scrollToCategoria(cat.id); }}
                  className={'shrink-0 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap cursor-pointer transition-all duration-200 ' +
                    (categoriaAtiva === cat.id
                      ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200/60')
                  }
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        </div>
        ) : null}

        {/* Conteúdo scrollable */}
        <div className="flex-1 overflow-y-auto">
          {subView === 'acompanhar_input' ? (
            <div className="px-4 py-4">
              <button
                type="button"
                onClick={function () { setSubView('cardapio'); }}
                className="inline-flex items-center gap-1 text-sm font-bold text-zinc-500 hover:text-zinc-700 cursor-pointer mb-5 transition-colors whitespace-nowrap"
              >
                <i className="ri-arrow-left-s-line text-lg" />
                Voltar ao cardápio
              </button>

              <div className="mb-5">
                <h3 className="text-base font-black text-zinc-800 mb-1">Acompanhar pedido</h3>
                <p className="text-xs text-zinc-500">Seus pedidos em andamento</p>
              </div>

              {activeOrdersLoading ? (
                <div className="text-center py-8">
                  <div className="w-10 h-10 flex items-center justify-center mx-auto mb-3 bg-amber-50 rounded-2xl border border-amber-100">
                    <i className="ri-loader-4-line text-lg text-amber-500 animate-spin" />
                  </div>
                  <p className="text-xs text-zinc-500">Buscando seus pedidos...</p>
                </div>
              ) : activeOrdersError ? (
                <div className="text-center py-8">
                  <div className="w-10 h-10 flex items-center justify-center mx-auto mb-3 bg-red-50 rounded-2xl border border-red-100">
                    <i className="ri-error-warning-line text-lg text-red-500" />
                  </div>
                  <p className="text-xs text-zinc-500 mb-3">{activeOrdersError}</p>
                  <button
                    type="button"
                    onClick={fetchActiveOrders}
                    className="px-4 py-2 bg-amber-50 text-amber-700 text-xs font-bold rounded-xl cursor-pointer hover:bg-amber-100 transition-colors whitespace-nowrap"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : activeOrders.length === 0 ? (
                <div className="text-center py-10 mb-6 flex flex-col items-center">
                  <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
                    <i className="ri-time-line text-2xl text-zinc-300" />
                  </div>
                  <p className="text-sm font-bold text-zinc-700 mb-1">Nenhum pedido em andamento</p>
                  <p className="text-xs text-zinc-500">Seus pedidos ativos aparecerão aqui</p>
                </div>
              ) : (
                <div className="space-y-2 mb-6">
                  {activeOrders.map(function (order) {
                    const statusMap: Record<string, { bg: string; text: string; border: string; icon: string; label: string }> = {
                      new: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200/60', icon: 'ri-check-double-line', label: 'Recebido' },
                      preparing: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200/60', icon: 'ri-restaurant-2-line', label: 'Em preparo' },
                      ready: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200/60', icon: 'ri-checkbox-circle-line', label: 'Pronto' },
                    };
                    const style = statusMap[order.status] || statusMap.new;

                    let timeStr = '';
                    try {
                      const d = new Date(order.created_at);
                      timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' - ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                    } catch (_e) { /* vazio */ }

                    return (
                      <div
                        key={order.id}
                        onClick={function () {
                          setTrackingNumero(order.number);
                          setPreviousSubView('acompanhar_input');
                          setSubView('acompanhar');
                        }}
                        className="bg-white rounded-2xl border border-zinc-100 p-4 cursor-pointer hover:border-amber-200/60 transition-all active:scale-[0.98]"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-zinc-800">#{order.number}</span>
                              <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ' + style.bg + ' ' + style.text + ' ' + style.border}>
                                <i className={style.icon + ' text-[9px]'} />
                                {style.label}
                              </span>
                            </div>
                            <p className="text-[10px] text-zinc-400 mt-1">{timeStr}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-amber-600">R$ {order.total_amount.toFixed(2)}</p>
                            {order.delivery_fee > 0 ? (
                              <p className="text-[10px] text-zinc-400">+ taxa R$ {order.delivery_fee.toFixed(2)}</p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center justify-end">
                          <span className="text-[11px] text-amber-600 font-bold flex items-center gap-1">
                            Acompanhar
                            <i className="ri-arrow-right-s-line text-xs" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : subView === 'acompanhar' ? (
            <div className="px-4 py-4">
              <button
                type="button"
                onClick={function () { setSubView(previousSubView); }}
                className="inline-flex items-center gap-1 text-sm font-bold text-zinc-500 hover:text-zinc-700 cursor-pointer mb-5 transition-colors whitespace-nowrap"
              >
                <i className="ri-arrow-left-s-line text-lg" />
                {previousSubView === 'historico' ? 'Histórico' : 'Meus pedidos'}
              </button>
              <AcompanharPedido
                numeroPedido={trackingNumero}
                tenantId={tenantId}
                onNovoPedido={function () { setSubView('cardapio'); }}
              />
            </div>
          ) : subView === 'historico' ? (
            <div className="px-4 py-4">
              <button
                type="button"
                onClick={function () { setSubView('cardapio'); }}
                className="inline-flex items-center gap-1 text-sm font-bold text-zinc-500 hover:text-zinc-700 cursor-pointer mb-5 transition-colors whitespace-nowrap"
              >
                <i className="ri-arrow-left-s-line text-lg" />
                Voltar ao cardápio
              </button>
              <div className="mb-4">
                <h3 className="text-base font-black text-zinc-800 mb-1">Meus pedidos</h3>
                <p className="text-xs text-zinc-500">Histórico de delivery</p>
              </div>
              <HistoricoPedidos
                tenantId={tenantId}
                phone={phone}
                onVerPedido={function (numero: string) {
                  setTrackingNumero(numero);
                  setPreviousSubView('historico');
                  setSubView('acompanhar');
                }}
              />
            </div>
          ) : (
            <>
              {showCart ? (
                <CarrinhoDelivery
                  cart={cart}
                  neighborhoods={neighborhoods}
                  selectedNeighborhoodId={selectedNeighborhoodId}
                  deliveryFee={deliveryFee}
                  onChangeNeighborhood={handleChangeNeighborhood}
                  onAlterarQtd={handleAlterarQtd}
                  onRemover={handleRemover}
                  onEditar={handleAbrirEdicao}
                  error={error}
                  onVoltar={function () { data.setShowCart(false); }}
                  city={city}
                  modoEntrega={modoEntrega}
                />
              ) : (
                <CardapioMesaQR
                  categoriaAtiva={categoriaAtiva}
                  categories={categories}
                  items={items}
                  optionGroups={optionGroups}
                  options={options}
                  observations={observations}
                  outOfStockIds={outOfStockIds}
                  opcoesIndisponiveisIds={opcoesIndisponiveisIds}
                  onAdicionar={handleAdicionar}
                  onVerCarrinho={function () { data.setShowCart(true); }}
                  cart={cart}
                  onCategoriaAtivaChange={handleCategoriaAtivaChange}
                  deepLinkItemId={deepLinkItemId}
                  onDeepLinkConsumed={handleDeepLinkConsumed}
                />
              )}
            </>
          )}
        </div>

        {/* Footer do carrinho - sempre visível */}
        {showCart && cart.length > 0 ? (() => {
          const subtotalFooter = cart.reduce(function (s: number, i: typeof cart[0]) { return s + i.precoTotal * i.quantidade; }, 0);
          const voucherDescFooter = Math.min(data.voucherDesconto || 0, subtotalFooter);
          const totalFooter = Math.max(0, subtotalFooter + deliveryFee - voucherDescFooter);
          return (
            <div className="shrink-0 bg-white border-t border-zinc-100 px-4 py-3 space-y-3 z-30">
              {/* Resumo de totais */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Subtotal ({totalItens} {totalItens === 1 ? 'item' : 'itens'})</span>
                  <span className="text-zinc-800 font-bold">R$ {subtotalFooter.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">
                    {modoEntrega === 'retirada' ? 'Retirada na loja' : 'Taxa de entrega'}
                  </span>
                  <span className={modoEntrega === 'retirada' || deliveryFee === 0 ? 'text-green-600 font-bold' : 'text-zinc-800 font-bold'}>
                    {modoEntrega === 'retirada' ? 'Grátis' : (deliveryFee > 0 ? 'R$ ' + deliveryFee.toFixed(2) : 'Grátis')}
                  </span>
                </div>
                {modoEntrega !== 'retirada' && bairroAtual && deliveryFee > 0 ? (
                  <div className="flex items-center justify-end">
                    <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                      <i className="ri-map-pin-line text-[9px]" />
                      {bairroAtual.name}
                    </span>
                  </div>
                ) : null}
                {modoEntrega !== 'retirada' && distanceMode && deliveryQuote && deliveryQuote.dentroArea ? (
                  <div className="flex items-center justify-end">
                    <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                      <i className="ri-route-line text-[9px]" />
                      ~{deliveryQuote.km.toFixed(1)} km
                      {deliveryQuote.tempoMax > 0 ? ' • até ' + deliveryQuote.tempoMax + ' min' : ''}
                    </span>
                  </div>
                ) : null}
                {voucherDescFooter > 0 ? (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-green-600 flex items-center gap-1">
                      <i className="ri-coupon-3-line text-[11px]" />Cupom {data.voucherCodigo}
                    </span>
                    <span className="text-green-600 font-bold">- R$ {voucherDescFooter.toFixed(2)}</span>
                  </div>
                ) : null}

                {/* Cupom / Voucher */}
                <div className="pt-1">
                  {data.voucherCodigo ? (
                    <button
                      type="button"
                      onClick={data.handleRemoverVoucher}
                      className="text-[11px] text-zinc-500 hover:text-red-600 cursor-pointer flex items-center gap-1"
                    >
                      <i className="ri-close-circle-line text-xs" />
                      Remover cupom
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={data.voucherInput}
                        onChange={function (e) { data.setVoucherInput(e.target.value.toUpperCase()); }}
                        placeholder="Cupom / voucher"
                        className="flex-1 min-w-0 px-3 py-2 text-xs border border-zinc-200 rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400"
                      />
                      <button
                        type="button"
                        onClick={data.handleAplicarVoucher}
                        disabled={!data.voucherInput.trim() || data.voucherLoading}
                        className="px-3 py-2 bg-zinc-800 hover:bg-zinc-900 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors flex items-center gap-1"
                      >
                        {data.voucherLoading ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-coupon-3-line" />}
                        Aplicar
                      </button>
                    </div>
                  )}
                  {data.voucherMsg ? (
                    <p className="text-[11px] text-red-600 mt-1.5">{data.voucherMsg}</p>
                  ) : null}
                </div>

                <div className="h-px bg-zinc-100" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-zinc-800">Total</span>
                  <span className="text-sm font-bold text-amber-600">R$ {totalFooter.toFixed(2)}</span>
                </div>
              </div>

              {/* Aviso de fora da área de entrega (modo distância) */}
              {foraDeArea ? (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
                  <i className="ri-map-pin-off-line text-red-500 text-sm mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-red-700">Fora da área de entrega</p>
                    <button
                      type="button"
                      onClick={function () { data.handleIrParaEnderecos(); }}
                      className="text-[11px] text-red-600 underline cursor-pointer"
                    >
                      Ajustar localização no mapa
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Botões de ação */}
              <button
                type="button"
                onClick={function () {
                  if (foraDeArea) { data.handleIrParaEnderecos(); return; }
                  const activeMethods = Object.entries(paymentMethods || {}).filter(function (entry) { return entry[1] === true; });
                  if (activeMethods.length > 0) {
                    setMetodoPagamento('');
                    setValorDinheiro('');
                    setErroValorDinheiro('');
                    setShowPagamentoModal(true);
                  } else {
                    handleConfirmarPedido();
                  }
                }}
                disabled={enviando || foraDeArea}
                className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:hover:from-amber-500 disabled:hover:to-orange-500 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer transition-all whitespace-nowrap flex items-center justify-center gap-2"
              >
                {enviando ? (
                  <>
                    <i className="ri-loader-4-line animate-spin" />
                    Enviando pedido...
                  </>
                ) : (
                  <>
                    <i className="ri-check-line" />
                    Confirmar pedido — R$ {totalFooter.toFixed(2)}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={function () { data.setShowCart(false); }}
                disabled={enviando}
                className="w-full text-sm text-zinc-500 font-bold py-3 cursor-pointer hover:text-zinc-700 transition-colors bg-zinc-100 rounded-xl hover:bg-zinc-200 disabled:opacity-50 whitespace-nowrap flex items-center justify-center gap-2"
              >
                <i className="ri-add-line" />
                Adicionar mais itens
              </button>
            </div>
          );
        })() : null}

        {/* Footer carrinho fixo */}
        {(!showCart && totalItens > 0 && subView === 'cardapio') ? (
          <div className="sticky bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-zinc-100 px-4 py-3 z-30">
            <button
              type="button"
              onClick={function () { data.setShowCart(true); }}
              className="w-full flex items-center justify-between bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white px-5 py-3.5 rounded-xl cursor-pointer transition-colors shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 flex items-center justify-center bg-white/20 rounded-full">
                  <span className="text-xs font-bold text-white">{totalItens}</span>
                </div>
                <span className="text-sm font-bold">Ver pedido</span>
              </div>
              {/* Só o valor dos produtos — a taxa de entrega entra ao abrir o pedido */}
              <span className="text-sm font-bold">
                R$ {totalItensProdutos.toFixed(2)}
              </span>
            </button>
          </div>
        ) : null}

        {/* Modal Editar Item */}
        {editingItem ? (
          <EditarItemMesaQRModal
            cartItem={editingItem}
            items={items}
            optionGroups={optionGroups}
            options={options}
            observations={observations}
            opcoesIndisponiveisIds={opcoesIndisponiveisIds}
            onSalvar={handleSalvarEdicao}
            onClose={handleFecharEdicao}
          />
        ) : null}

        {/* Modal de seleção de forma de pagamento */}
        {showPagamentoModal ? (() => {
          const subtotalModal = cart.reduce(function (s: number, i: typeof cart[0]) { return s + i.precoTotal * i.quantidade; }, 0);
          const voucherDescModal = Math.min(data.voucherDesconto || 0, subtotalModal);
          const totalModal = Math.max(0, subtotalModal + deliveryFee - voucherDescModal);
          return (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ paddingBottom: kbInset }}>
              <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={function () { if (!enviando) { setShowPagamentoModal(false); setValorDinheiro(''); setErroValorDinheiro(''); } }}
              />
              <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl p-6 pb-8 z-10 animate-slide-up max-h-[90vh] overflow-y-auto" onFocus={scrollFocusedFieldIntoView}>
                <div className="w-10 h-1.5 bg-zinc-200 rounded-full mx-auto mb-5 sm:hidden" />

                {/* Voltar */}
                <button
                  type="button"
                  disabled={enviando}
                  onClick={function () { setShowPagamentoModal(false); setValorDinheiro(''); setErroValorDinheiro(''); }}
                  className="inline-flex items-center gap-1 text-sm font-bold text-zinc-500 hover:text-zinc-700 cursor-pointer mb-2 -mt-1 disabled:opacity-50 whitespace-nowrap"
                >
                  <i className="ri-arrow-left-s-line text-lg" />
                  Voltar
                </button>

                <div className="text-center mb-6">
                  <div className="w-14 h-14 flex items-center justify-center mx-auto mb-3 bg-amber-50 rounded-2xl border border-amber-100">
                    <i className="ri-wallet-3-line text-2xl text-amber-600" />
                  </div>
                  <h3 className="text-lg font-black text-zinc-800 mb-1">Forma de pagamento</h3>
                  <p className="text-xs text-zinc-500">
                    {modoEntrega === 'retirada'
                      ? 'Escolha como vai pagar na retirada'
                      : 'Escolha como vai pagar para o motoboy já se preparar'}
                  </p>
                </div>

                <div className="space-y-2 mb-6">
                  {Object.entries(paymentMethods || {}).filter(function (entry) { return entry[1] === true; }).map(function (entry) {
                    const key = entry[0];
                    const methodMap: Record<string, { label: string; icon: string; description: string }> = modoEntrega === 'retirada' ? {
                      dinheiro: { label: 'Dinheiro', icon: 'ri-money-dollar-circle-line', description: 'Informe o valor para calcular o troco' },
                      cartao_credito: { label: 'Cartão de Crédito', icon: 'ri-bank-card-line', description: 'Pague com cartão na retirada' },
                      cartao_debito: { label: 'Cartão de Débito', icon: 'ri-bank-card-2-line', description: 'Pague com cartão na retirada' },
                      pix: { label: 'PIX', icon: 'ri-qr-code-line', description: 'Faça o PIX na retirada' },
                      vale_refeicao: { label: 'Vale Refeição', icon: 'ri-coupon-line', description: 'Use seu vale na retirada' },
                    } : {
                      dinheiro: { label: 'Dinheiro', icon: 'ri-money-dollar-circle-line', description: 'Informe o valor para calcular o troco' },
                      cartao_credito: { label: 'Cartão de Crédito', icon: 'ri-bank-card-line', description: 'O motoboy levará a maquininha' },
                      cartao_debito: { label: 'Cartão de Débito', icon: 'ri-bank-card-2-line', description: 'O motoboy levará a maquininha' },
                      pix: { label: 'PIX', icon: 'ri-qr-code-line', description: 'O motoboy levará a maquininha' },
                      vale_refeicao: { label: 'Vale Refeição', icon: 'ri-coupon-line', description: 'O motoboy levará a maquininha' },
                    };
                    const info = methodMap[key] || { label: key, icon: 'ri-wallet-line', description: '' };
                    const selected = metodoPagamento === key;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={function () {
                          setMetodoPagamento(key);
                          setValorDinheiro('');
                          setErroValorDinheiro('');
                        }}
                        className={'w-full flex items-center gap-4 px-4 py-3.5 rounded-xl border cursor-pointer transition-all duration-200 ' +
                          (selected
                            ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200/50'
                            : 'bg-white border-zinc-100 hover:border-zinc-200')
                        }
                      >
                        <div className={'w-10 h-10 flex items-center justify-center rounded-xl shrink-0 ' +
                          (selected ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-400')
                        }>
                          <i className={info.icon + ' text-lg'} />
                        </div>
                        <div className="flex-1 text-left">
                          <span className={'text-sm font-bold ' + (selected ? 'text-zinc-800' : 'text-zinc-700')}>
                            {info.label}
                          </span>
                          <p className="text-[11px] text-zinc-400 mt-0.5">{info.description}</p>
                        </div>
                        <div className={'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ' +
                          (selected ? 'bg-amber-500 border-amber-500' : 'border-zinc-200')
                        }>
                          {selected ? <i className="ri-check-line text-white text-[10px]" /> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Campo de valor em dinheiro + troco */}
                {metodoPagamento === 'dinheiro' ? (
                  <div className="mb-6 bg-amber-50 rounded-xl p-4 border border-amber-200/60">
                    <label className="block text-xs font-bold text-zinc-700 mb-2">
                      <i className="ri-money-dollar-circle-line text-amber-600 mr-1" />
                      Qual valor você vai entregar?
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                        <span className="text-sm font-bold text-zinc-400">R$</span>
                      </div>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={valorDinheiro}
                        onChange={function (e) {
                          const raw = e.target.value;
                          setValorDinheiro(raw);
                          const num = parseFloat(raw);
                          if (raw === '') {
                            setErroValorDinheiro('');
                          } else if (isNaN(num) || num < totalModal) {
                            setErroValorDinheiro('O valor não pode ser menor que o total do pedido');
                          } else {
                            setErroValorDinheiro('');
                          }
                        }}
                        placeholder={'0,00'}
                        className="w-full pl-10 pr-4 py-3 bg-white border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 placeholder-zinc-300 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200/50 transition-all"
                      />
                    </div>
                    {erroValorDinheiro ? (
                      <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                        <i className="ri-error-warning-line text-xs" />
                        {erroValorDinheiro}
                      </p>
                    ) : null}

                    {valorDinheiro !== '' && !erroValorDinheiro ? (() => {
                      const valorNum = parseFloat(valorDinheiro) || 0;
                      const troco = valorNum - totalModal;
                      return (
                        <div className="mt-3 pt-3 border-t border-amber-200/60">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-zinc-600 font-medium">Total do pedido</span>
                            <span className="text-xs font-bold text-zinc-800">R$ {totalModal.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-xs text-zinc-600 font-medium">Valor entregue</span>
                            <span className="text-xs font-bold text-zinc-800">R$ {valorNum.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-amber-200/60">
                            <span className="text-sm font-bold text-green-700 flex items-center gap-1">
                              <i className="ri-arrow-go-back-line text-sm" />
                              Troco
                            </span>
                            <span className="text-sm font-black text-green-700">R$ {troco.toFixed(2)}</span>
                          </div>
                          <p className="text-[10px] text-green-600/70 mt-1.5">
                            {modoEntrega === 'retirada'
                              ? 'Apresente o valor na retirada e receba o troco de '
                              : 'O motoboy já levará o troco de '}
                            <strong>R$ {troco.toFixed(2)}</strong>
                          </p>
                        </div>
                      );
                    })() : null}
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={!metodoPagamento || enviando || (metodoPagamento === 'dinheiro' && (valorDinheiro === '' || !!erroValorDinheiro))}
                  onClick={function () {
                    if (metodoPagamento) {
                      if (metodoPagamento === 'dinheiro' && valorDinheiro !== '') {
                        const valorNum = parseFloat(valorDinheiro) || 0;
                        if (valorNum < totalModal) return;
                      }
                      setShowPagamentoModal(false);
                      handleConfirmarPedido(metodoPagamento, valorDinheiro);
                    }
                  }}
                  className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 disabled:hover:from-amber-500 disabled:hover:to-orange-500 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer transition-all whitespace-nowrap flex items-center justify-center gap-2"
                >
                  {enviando ? (
                    <>
                      <i className="ri-loader-4-line animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <i className="ri-check-line" />
                      Confirmar pedido — R$ {totalModal.toFixed(2)}
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })() : null}

        {/* Animação slide-up */}
        <style>{`
          @keyframes slide-up {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          .animate-slide-up {
            animation: slide-up 0.25s ease-out;
          }
          @media (min-width: 640px) {
            @keyframes slide-up {
              from { transform: translateY(20px); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
          }
        `}</style>
      </div>
    </div>
  );
}