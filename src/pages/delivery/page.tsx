import { useState, useEffect, useMemo, useCallback } from 'react';
import { formatCurrency } from '@/lib/formatters';
import { useDeliveryData, getOrderSource, getDeliveryWriteUrl } from './useDeliveryData';
import IdentificacaoDelivery from './components/IdentificacaoDelivery';
import EnderecoDelivery from './components/EnderecoDelivery';
import EnderecoPinDelivery from './components/EnderecoPinDelivery';
import ConfirmacaoDelivery from './components/ConfirmacaoDelivery';
import AcompanharPedido from './components/AcompanharPedido';
import HistoricoPedidos from './components/HistoricoPedidos';
import CardapioMesaQR from '../mesa-qr/components/CardapioMesaQR';
import CheckoutDelivery from './components/CheckoutDelivery';
import EditarItemMesaQRModal from '../mesa-qr/components/EditarItemMesaQRModal';
import ModoEntregaDelivery from './components/ModoEntregaDelivery';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useIdiomaCardapio } from '@/hooks/useIdiomaCardapio';
import { tx } from '@/lib/idiomaCardapio';
import SeletorIdioma from '@/components/SeletorIdioma';
import LojaTopo, { BotaoCapa, type LojaTopoMeta } from '@/components/cliente/LojaTopo';
import BarraSacola from '@/components/cliente/BarraSacola';
import { corLojaVars } from '@/lib/corLoja';
import { situacaoLoja } from '@/lib/situacaoLoja';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
  // Idioma do cliente. `decorar` acrescenta `*_i18n` sem tocar no texto em
  // portugues: o carrinho e o pedido continuam saindo em PT, que e o que a
  // cozinha le. Ver src/lib/idiomaCardapio.ts.
  const idiomaCardapio = useIdiomaCardapio(getDeliveryWriteUrl(), data.tenantId ?? null, data.locales);
  const { decorar } = idiomaCardapio;

  // Mesmo seletor em TODAS as etapas: quem nao le portugues precisa achar a
  // troca de idioma na PRIMEIRA tela, nao depois de ja ter se identificado.
  const seletorIdioma = idiomaCardapio.temSeletor ? (
    <SeletorIdioma
      disponiveis={data.locales}
      idioma={idiomaCardapio.idioma}
      onTrocar={idiomaCardapio.trocarIdioma}
    />
  ) : null;

  const seletorIdiomaCapa = idiomaCardapio.temSeletor ? (
    <SeletorIdioma
      disponiveis={data.locales}
      idioma={idiomaCardapio.idioma}
      onTrocar={idiomaCardapio.trocarIdioma}
      variante="capa"
    />
  ) : null;

  const categories = useMemo(function () { return decorar(data.categories, 'category'); }, [data.categories, decorar]);
  const items = useMemo(function () { return decorar(data.items, 'item'); }, [data.items, decorar]);
  const optionGroups = useMemo(function () { return decorar(data.optionGroups, 'option_group'); }, [data.optionGroups, decorar]);
  const options = useMemo(function () { return decorar(data.options, 'option'); }, [data.options, decorar]);
  const observations = useMemo(function () { return decorar(data.observations, 'preset_obs', 'text', 'text_desc'); }, [data.observations, decorar]);
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
  const LABEL_METODO: Record<string, string> = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão de Crédito', cartao_debito: 'Cartão de Débito', pix: 'PIX', vale_refeicao: 'Vale Refeição' };
  const ICONE_METODO: Record<string, string> = { dinheiro: 'ri-money-dollar-circle-line', cartao_credito: 'ri-bank-card-line', cartao_debito: 'ri-bank-card-2-line', pix: 'ri-qr-code-line', vale_refeicao: 'ri-coupon-line' };
  // "PIX pelo app" entra na lista quando a loja tem o Mercado Pago ativo, a menos
  // que a loja tenha desligado essa forma em Config › Delivery (pix_online: false).
  // "Cartão de crédito pelo app" idem, mas só com o cartão ligado no Mercado Pago (card_enabled).
  const metodosDisponiveis: Record<string, boolean> = Object.assign({}, paymentMethods || {}, {
    pix_online: data.pixOnlineDisponivel && (paymentMethods || {}).pix_online !== false,
    cartao_online: data.cartaoOnlineDisponivel && (paymentMethods || {}).cartao_online !== false,
  });
  // Pagas no app (a loja segura o pedido até confirmar) — não são opção "na entrega"
  const FORMAS_PELO_APP = ['pix_online', 'cartao_online'];
  // Formas cobradas na entrega/retirada — pra quem desistir do pagamento pelo app
  const metodosAlternativos = Object.entries(metodosDisponiveis)
    .filter(function (e) { return e[1] === true && FORMAS_PELO_APP.indexOf(e[0]) < 0; })
    .map(function (e) { return { key: e[0], label: LABEL_METODO[e[0]] || e[0], icon: ICONE_METODO[e[0]] || 'ri-wallet-line' }; });
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

  // Logo da loja (Configurações → Dados da Loja); sem logo, cai nas iniciais
  const lojaLogo = data.tenant?.logo_url || '';

  // Iniciais da loja para o "logo" do header (1ª letra das 2 primeiras palavras)
  const lojaIniciais = (data.tenant?.name || 'DL')
    .split(/\s+/)
    .slice(0, 2)
    .map(function (w: string) { return w.charAt(0); })
    .join('')
    .toUpperCase();

  function fotoDoItem(itemId: string): string | null {
    const it = items.find(function (x) { return x.id === itemId; });
    return it ? it.photo_url : null;
  }

  // Capa e cor da loja (Configurações); sem elas, faixa e botões na cor padrão
  const capaLoja = data.tenant?.cover_url || null;
  const estiloLoja = corLojaVars(data.tenant?.brand_color || null);

  // Topo da loja: situação (aberto/fechado + horário) e o que decide a compra
  const situacao = situacaoLoja(data.deliveryOpenNow, data.deliveryClosedReason, data.infoLoja.horario, t);
  const metasLoja: LojaTopoMeta[] = [];
  if (data.distanceMode && data.tiers.length > 0) {
    const tempos = data.tiers.map(function (f) { return f.tempo_max_min; }).filter(function (n) { return n > 0; });
    if (tempos.length > 0) metasLoja.push({ icone: 'ri-time-line', rotulo: t('cliente.entrega'), valor: t('cliente.ateMin', { n: Math.min.apply(null, tempos) }) });
    const taxaMin = Math.min.apply(null, data.tiers.map(function (f) { return f.taxa; }));
    metasLoja.push({ icone: 'ri-e-bike-2-line', rotulo: t('cliente.taxaDesde'), valor: taxaMin > 0 ? formatCurrency(taxaMin) : t('cliente.gratis') });
  } else if (data.neighborhoods.length > 0) {
    const taxaMin = Math.min.apply(null, data.neighborhoods.map(function (n) { return Number(n.delivery_fee) || 0; }));
    metasLoja.push({ icone: 'ri-e-bike-2-line', rotulo: t('cliente.taxaDesde'), valor: taxaMin > 0 ? formatCurrency(taxaMin) : t('cliente.gratis') });
  }
  const pedidoMinimo = data.infoLoja.pedidoMinimo;
  if (pedidoMinimo > 0) metasLoja.push({ icone: 'ri-shopping-bag-3-line', rotulo: t('cliente.minimo'), valor: formatCurrency(pedidoMinimo) });

  const avisoFechado = !data.deliveryOpenNow ? (
    <div className="mx-5 mt-3.5 px-4 py-3.5 rounded-2xl bg-red-50 text-red-900 flex gap-3 items-start">
      <i className="ri-time-line text-lg leading-none mt-0.5" />
      <div>
        <p className="text-sm font-bold">{situacao.abreAs ? t('cliente.fechadoAbrimos', { h: situacao.abreAs }) : t('cliente.fechadoAgora')}</p>
        <p className="text-[13px] mt-0.5 leading-snug">{data.deliveryClosedReason === 'pausado' ? t('cliente.pausadoTexto') : t('cliente.montarSacola')}</p>
      </div>
    </div>
  ) : null;

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

  // Dropdown de endereço
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);

  // Menu de perfil no header (telefone, histórico, sair)
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Confirmação de "Sair (usar outro número)" — modal próprio, não window.confirm
  const [showSairConfirm, setShowSairConfirm] = useState(false);

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

  // Estável: o scroll spy do cardápio recria o observador quando esta função muda
  const setCategoriaAtivaDelivery = data.setCategoriaAtiva;
  const handleCategoriaAtivaChange = useCallback(function (catId: string) {
    setCategoriaAtivaDelivery(catId);
  }, [setCategoriaAtivaDelivery]);

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
        // Em andamento = ainda não terminou: inclui os que aguardam o Pix pelo app (status draft),
        // senão o cliente perde de vista um pedido que só depende dele.
        const ativos = all.filter(function (o: { status: string }) {
          return o.status !== 'delivered' && o.status !== 'cancelled';
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
        logoUrl={lojaLogo}
        onVoltar={function () { data.setStep('preview'); }}
        seletorIdioma={seletorIdioma}
      />
    );
  }

  if (step === 'modo_entrega') {
    return (
      <ModoEntregaDelivery
        customerName={customerName}
        phone={phone}
        tenantName={tenant?.name}
        logoUrl={lojaLogo}
        onSelecionar={handleConfirmarModo}
        enviando={enviando}
        waUrl={lojaWaUrl}
        isExistingCustomer={!!customer}
        onNomeChange={data.setCustomerName}
        seletorIdioma={seletorIdioma}
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
      <div className="min-h-screen bg-[#FBF8F4]" style={estiloLoja}>
      <div className="max-w-lg mx-auto">
      <ConfirmacaoDelivery
        numeroPedido={numeroPedido}
        orderTotal={orderTotal}
        deliveryFee={modoEntrega === 'retirada' ? 0 : deliveryFee}
        phone={phone}
        tenantId={tenantId}
        customerId={customerId}
        onNovoPedido={handleNovoPedido}
        paymentMethod={pagamentoSelecionado}
        modoEntrega={modoEntrega}
        resumo={data.resumoConfirmacao}
        pixOnline={data.pixOnline}
        cartaoOnline={{ pronto: data.pagamentoAppPronto, ativo: data.cartaoOnlineDisponivel, publicKey: data.mpPublicKey }}
        onTrocarMetodoApp={data.trocarMetodoPagamentoApp}
        onPixPago={data.limparPixOnline}
        metodosAlternativos={metodosAlternativos}
        onTrocarPagamento={data.handleTrocarPagamentoPixOnline}
      />
      </div>
      </div>
    );
  }

  // ── Vitrine (preview) ──
  // Primeira tela para tráfego novo (anúncio): mostra o cardápio real e deixa
  // montar o carrinho ANTES de pedir telefone/endereço. O carrinho persiste;
  // ao "Continuar", cai no fluxo de identificação e depois no cardápio normal.
  if (step === 'preview') {
    const subtotalPreview = cart.reduce(function (s: number, i: typeof cart[0]) { return s + i.precoTotal * i.quantidade; }, 0);
    return (
      <div className="min-h-screen bg-[#FBF8F4] flex justify-center" style={estiloLoja}>
        <div className="w-full max-w-lg h-dvh flex flex-col bg-[#FBF8F4] relative">
          <div className="flex-1 overflow-y-auto">
            <LojaTopo
              nome={tenant?.name || 'Delivery'}
              logoUrl={lojaLogo}
              capaUrl={capaLoja}
              situacao={situacao}
              subtitulo={city || null}
              metas={metasLoja}
              acoes={
                <>
                  {seletorIdiomaCapa}
                  <BotaoCapa icone="ri-user-3-line" texto={t('cliente.entrar')} onClick={function () { data.setStep('identificacao'); }} />
                </>
              }
            >
              {avisoFechado}
              <button
                type="button"
                onClick={function () { data.setStep('identificacao'); }}
                className="mx-5 mt-3.5 w-[calc(100%-2.5rem)] flex items-center gap-3 bg-white border border-stone-200/70 rounded-[18px] px-3.5 py-3 text-left cursor-pointer hover:bg-stone-50"
              >
                <span className="w-10 h-10 rounded-xl bg-[var(--cor-loja-suave)] text-[var(--cor-loja)] flex items-center justify-center shrink-0">
                  <i className="ri-map-pin-2-line text-lg" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-stone-900">{t('cliente.ondeEntregar')}</span>
                  <span className="block text-[13px] text-stone-600 mt-0.5">{t('cliente.vejaTaxa')}</span>
                </span>
                <i className="ri-arrow-right-s-line text-xl text-stone-400" />
              </button>
            </LojaTopo>

            {/* Cardápio (montar a sacola já funciona) */}
            <div className="mt-3">
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
                onAlterarQtd={handleAlterarQtd}
                onRemover={handleRemover}
                onVerCarrinho={function () { data.setStep('identificacao'); }}
                cart={cart}
                onCategoriaAtivaChange={handleCategoriaAtivaChange}
                deepLinkItemId={deepLinkItemId}
                onDeepLinkConsumed={handleDeepLinkConsumed}
              />
            </div>
          </div>

          {cart.length > 0 ? (
            <BarraSacola
              quantidade={totalItens}
              texto={t('cliente.verSacola')}
              total={data.deliveryOpenNow ? formatCurrency(subtotalPreview) : t('cliente.envioQuandoAbrir')}
              apagada={!data.deliveryOpenNow}
              onClick={function () { data.setStep('cardapio'); data.setShowCart(true); }}
            />
          ) : null}
        </div>
      </div>
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
    <div className="min-h-screen bg-[#FBF8F4] flex justify-center" style={estiloLoja}>
      <div className="w-full max-w-lg h-dvh flex flex-col bg-[#FBF8F4] relative">
        {/* Banner: delivery fechado — no cardápio o aviso fica no topo da loja; aqui só na sacola */}
        {!data.deliveryOpenNow && showCart && (
          <div className="shrink-0 bg-red-600 text-white px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-semibold text-center">
            <i className="ri-store-2-line text-base shrink-0" />
            <span>{situacao.abreAs ? t('cliente.fechadoAbrimos', { h: situacao.abreAs }) : t('cliente.fechadoAgora')}</span>
          </div>
        )}
        {/* Banner: pedido segurado esperando o pagamento pelo app — Pix ou cartão (cliente saiu antes de pagar) */}
        {data.pixOnline && !showCart ? (
          <button
            type="button"
            onClick={data.voltarParaPagamentoPix}
            className="shrink-0 w-full bg-emerald-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-emerald-700 transition-colors"
          >
            <span className="flex items-center gap-2 min-w-0">
              <i className={(data.pixOnline.metodo === 'cartao' ? 'ri-bank-card-line' : 'ri-qr-code-line') + ' text-base shrink-0'} />
              <span className="text-xs font-semibold truncate">
                Pedido #{data.pixOnline.number.slice(-4)} aguardando o pagamento — {formatCurrency(data.pixOnline.total)}
              </span>
            </span>
            <span className="shrink-0 text-[11px] font-black bg-white/20 px-2.5 py-1 rounded-full whitespace-nowrap">Pagar agora →</span>
          </button>
        ) : null}
        {/* Conteúdo scrollable */}
        <div className="flex-1 overflow-y-auto">
          {subView === 'cardapio' && !showCart ? (
            <LojaTopo
              nome={tenant?.name || 'Delivery'}
              logoUrl={lojaLogo}
              capaUrl={capaLoja}
              situacao={situacao}
              subtitulo={customerName ? 'Olá, ' + (customerName || '').split(' ')[0] : (city || null)}
              metas={metasLoja}
              acoes={
                <>
                  {seletorIdiomaCapa}
                  {customerId ? (
                    <BotaoCapa
                      icone="ri-file-list-3-line"
                      rotulo={t('cliente.meusPedidos')}
                      badge={activeOrders.length}
                      onClick={function () {
                        setSubView(activeOrders.length > 0 ? 'acompanhar_input' : 'historico');
                        fetchActiveOrders();
                      }}
                    />
                  ) : null}
                  {!customerId ? (
                    <BotaoCapa icone="ri-user-3-line" texto={t('cliente.entrar')} onClick={function () { data.setStep('identificacao'); }} />
                  ) : null}
                  {/* Perfil: telefone, histórico, sair */}
                  {customerId ? (
                  <div className="relative">
                    <BotaoCapa icone="ri-user-3-line" rotulo="Meu perfil" onClick={function () { setShowProfileMenu(!showProfileMenu); }} />
                    {showProfileMenu ? (
                      <>
                        <div className="fixed inset-0 z-[40]" onClick={function () { setShowProfileMenu(false); }} />
                        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-stone-100 z-[50] overflow-hidden">
                          <div className="px-3 py-2.5 border-b border-stone-100">
                            <p className="text-xs font-bold text-stone-800 truncate">{customerName}</p>
                            <p className="text-[11px] text-stone-500"><i className="ri-phone-line mr-1" />{phone}</p>
                          </div>
                          <button
                            type="button"
                            onClick={function () { setShowProfileMenu(false); setSubView('historico'); }}
                            className="w-full flex items-center gap-2 px-3 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 cursor-pointer transition-colors"
                          >
                            <i className="ri-history-line text-base text-stone-400" />
                            Histórico de pedidos
                          </button>
                          {/* Sair: encerra a sessão neste aparelho p/ entrar com outro número */}
                          <button
                            type="button"
                            onClick={function () {
                              setShowProfileMenu(false);
                              setShowSairConfirm(true);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-3 text-sm font-semibold text-red-700 hover:bg-red-50 cursor-pointer transition-colors border-t border-stone-100"
                          >
                            <i className="ri-logout-box-r-line text-base" />
                            Sair (usar outro número)
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                  ) : null}
                </>
              }
            >
              {avisoFechado}

              {/* Entrega ou retirada + endereço + taxa */}
              <div className="relative z-30 mx-5 mt-3.5 bg-white border border-stone-200/70 rounded-[18px] p-1.5">
                {data.retiradaAtivo ? (
                  <div className="grid grid-cols-2 gap-1 bg-stone-100 rounded-[13px] p-1">
                    <button
                      type="button"
                      aria-pressed={modoEntrega !== 'retirada'}
                      onClick={function () {
                        if (modoEntrega !== 'retirada') return;
                        // Sem cadastro ainda: só troca o modo (nome e endereço ficam na sacola)
                        if (!customer) { data.setModoEntrega('entrega'); if (selectedNeighborhoodId) handleChangeNeighborhood(selectedNeighborhoodId); return; }
                        handleConfirmarModo('entrega');
                      }}
                      className={'h-11 rounded-[10px] text-sm cursor-pointer transition-colors ' +
                        (modoEntrega !== 'retirada' ? 'bg-white shadow-sm font-bold text-stone-900' : 'font-semibold text-stone-600')}
                    >
                      {t('cliente.entrega')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={modoEntrega === 'retirada'}
                      onClick={function () {
                        if (modoEntrega === 'retirada') return;
                        if (!customer) { data.setModoEntrega('retirada'); return; }
                        handleConfirmarModo('retirada');
                      }}
                      className={'h-11 rounded-[10px] text-sm cursor-pointer transition-colors ' +
                        (modoEntrega === 'retirada' ? 'bg-white shadow-sm font-bold text-stone-900' : 'font-semibold text-stone-600')}
                    >
                      {t('cliente.retirada')}
                    </button>
                  </div>
                ) : null}

                {modoEntrega !== 'retirada' ? (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={function () {
                        if (hasAnyAddresses) {
                          setShowAddressDropdown(!showAddressDropdown);
                        } else {
                          handleIrParaEnderecos();
                        }
                      }}
                      className="w-full flex items-center gap-3 px-2 pt-3 pb-2 text-left cursor-pointer"
                    >
                      <span className="w-10 h-10 rounded-xl bg-[var(--cor-loja-suave)] text-[var(--cor-loja)] flex items-center justify-center shrink-0">
                        <i className="ri-map-pin-2-line text-lg" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs text-stone-500">{t('cliente.entregarEm')}</span>
                        <span className="block text-sm font-bold text-stone-900 truncate">
                          {enderecoAtual ? enderecoAtual.label + ' · ' + enderecoDisplay : enderecoDisplay}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs text-stone-500">
                          {distanceMode && deliveryQuote
                            ? '~' + deliveryQuote.km.toFixed(1) + ' km' + (deliveryQuote.tempoMax > 0 ? ' · ' + deliveryQuote.tempoMax + ' min' : '')
                            : (!distanceMode && bairroAtual ? bairroAtual.name : t('cliente.taxaEntrega'))}
                        </span>
                        <span className="block text-sm font-bold text-stone-900">
                          {distanceMode
                            ? (deliveryQuote ? (deliveryQuote.taxa > 0 ? formatCurrency(deliveryQuote.taxa) : t('cliente.gratis')) : 'A calcular')
                            : (data.effectiveDeliveryFee > 0 ? formatCurrency(data.effectiveDeliveryFee) : t('cliente.gratis'))}
                        </span>
                      </span>
                      <i className={'ri-arrow-down-s-line text-lg text-stone-400 shrink-0 transition-transform ' + (showAddressDropdown ? 'rotate-180' : '')} />
                    </button>

                    {/* Lista de endereços salvos */}
                    {showAddressDropdown && hasAnyAddresses ? (
                      <>
                        <div
                          className="fixed inset-0 z-[40]"
                          onClick={function () { setShowAddressDropdown(false); }}
                        />
                        <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-lg border border-stone-100 z-[50] overflow-hidden">
                          <div className="px-3.5 py-2 border-b border-stone-100">
                            <p className="text-[11px] font-bold text-stone-500 uppercase tracking-wider">Seus endereços</p>
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
                                  className={'w-full text-left px-3.5 py-3 hover:bg-stone-50 transition-colors cursor-pointer flex items-center gap-3 ' + (isSelected ? 'bg-stone-50' : '')}
                                >
                                  <span className={'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ' +
                                    (isSelected ? 'border-[var(--cor-loja)]' : 'border-stone-300')}>
                                    {isSelected ? <span className="w-2.5 h-2.5 rounded-full bg-[var(--cor-loja)]" /> : null}
                                  </span>
                                  <i className={getAddressDropdownIcon(addr.label) + ' text-stone-400 text-base shrink-0'} />
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                      <span className="text-sm font-bold text-stone-900 truncate">{addr.label}</span>
                                      {addr.is_default ? <i className="ri-star-fill text-[11px] text-amber-500" /> : null}
                                    </span>
                                    <span className="block text-xs text-stone-500 truncate">{line}</span>
                                    <span className="block text-xs text-stone-400">
                                      {addr.neighborhood_name || 'Sem bairro'}
                                      {addr.neighborhood_delivery_fee > 0 ? ' · ' + formatCurrency(addr.neighborhood_delivery_fee) : ' · ' + t('cliente.gratis')}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="border-t border-stone-100 p-2">
                            <button
                              type="button"
                              onClick={function () {
                                setShowAddressDropdown(false);
                                handleIrParaEnderecos();
                              }}
                              className="w-full h-11 flex items-center justify-center gap-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
                            >
                              <i className="ri-settings-3-line" />
                              Gerenciar endereços
                            </button>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-2 pt-3 pb-2">
                    <span className="w-10 h-10 rounded-xl bg-[var(--cor-loja-suave)] text-[var(--cor-loja)] flex items-center justify-center shrink-0">
                      <i className="ri-store-2-line text-lg" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-stone-500">{t('cliente.retirarNaLoja')}</span>
                      <span className="block text-sm font-bold text-stone-900 truncate">{tenant?.name || 'Balcão da loja'}</span>
                    </span>
                    <span className="shrink-0 text-sm font-bold text-emerald-700">{t('cliente.gratis')}</span>
                  </div>
                )}

                {lojaWaUrl ? (
                  <a
                    href={lojaWaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 h-10 mt-1 border-t border-stone-100 text-[13px] font-bold text-emerald-700 hover:bg-emerald-50 rounded-b-[14px] transition-colors"
                  >
                    <i className="ri-whatsapp-line text-base" />
                    Falar com a loja
                  </a>
                ) : null}
              </div>
            </LojaTopo>
          ) : null}
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
                  <button
                    type="button"
                    onClick={function () { setSubView('historico'); }}
                    className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-history-line" /> Ver histórico de pedidos
                  </button>
                </div>
              ) : (
                <div className="space-y-2 mb-6">
                  {activeOrders.map(function (order) {
                    const statusMap: Record<string, { bg: string; text: string; border: string; icon: string; label: string }> = {
                      draft: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200/60', icon: 'ri-qr-code-line', label: 'Aguardando pagamento' },
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
                            <p className="text-sm font-bold text-amber-600">Total {formatCurrency(order.total_amount)}</p>
                            {order.delivery_fee > 0 ? (
                              <p className="text-[10px] text-zinc-400">inclui taxa {formatCurrency(order.delivery_fee)}</p>
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
              {/* Entregues e cancelados ficam no histórico — antes só dava pra chegar lá pelo menu do perfil */}
              {!activeOrdersLoading && !activeOrdersError ? (
                <button
                  type="button"
                  onClick={function () { setSubView('historico'); }}
                  className="w-full flex items-center justify-center gap-1.5 py-3 mb-6 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-history-line" /> Ver histórico completo (entregues e cancelados)
                </button>
              ) : null}
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
                pixPendenteNumero={data.pixOnline ? data.pixOnline.number : undefined}
                onPagarPix={data.voltarParaPagamentoPix}
                onPagarPixSemChave={phone ? data.voltarParaPagamentoPixPorTelefone : undefined}
                metodosAlternativos={metodosAlternativos}
                onTrocarPagamento={phone ? data.trocarPagamentoPedidoSegurado : undefined}
                modoEntrega={modoEntrega}
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
                <CheckoutDelivery
                  data={data}
                  metodosDisponiveis={metodosDisponiveis}
                  onVoltar={function () { data.setShowCart(false); data.setError(''); }}
                  fotoDe={fotoDoItem}
                  lojaFechadaTexto={data.deliveryOpenNow ? null : (situacao.abreAs ? t('cliente.fechadoAbreAs', { h: situacao.abreAs }) : t('cliente.fechadoAgora'))}
                  nomeLoja={tenant?.name || ''}
                />
              ) : (
                <div className="mt-3">
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
                  onAlterarQtd={handleAlterarQtd}
                  onRemover={handleRemover}
                  onVerCarrinho={function () { data.setShowCart(true); }}
                  cart={cart}
                  onCategoriaAtivaChange={handleCategoriaAtivaChange}
                  deepLinkItemId={deepLinkItemId}
                  onDeepLinkConsumed={handleDeepLinkConsumed}
                />
                </div>
              )}
            </>
          )}
        </div>

        {/* Barra da sacola */}
        {(!showCart && totalItens > 0 && subView === 'cardapio') ? (
          <BarraSacola
            quantidade={totalItens}
            texto={t('cliente.verSacola')}
            /* Só o valor dos produtos — a taxa de entrega entra ao abrir a sacola */
            total={data.deliveryOpenNow ? formatCurrency(totalItensProdutos) : t('cliente.envioQuandoAbrir')}
            apagada={!data.deliveryOpenNow}
            onClick={function () { data.setShowCart(true); }}
          />
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
        {/* Modal: confirmar saída (trocar de número) */}
        {showSairConfirm ? (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={function () { setShowSairConfirm(false); }}
            />
            <div className="relative w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl p-6 pb-8 z-10 animate-slide-up">
              <div className="w-10 h-1.5 bg-zinc-200 rounded-full mx-auto mb-5 sm:hidden" />

              <div className="text-center mb-6">
                <div className="w-14 h-14 flex items-center justify-center mx-auto mb-3 bg-red-50 rounded-2xl border border-red-100">
                  <i className="ri-logout-box-r-line text-2xl text-red-500" />
                </div>
                <h3 className="text-base font-black text-zinc-800 mb-1">Sair e usar outro número?</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Seus dados deixam de ficar salvos neste aparelho
                  {cart.length > 0 ? ' e o carrinho atual será esvaziado' : ''}.
                </p>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={function () { setShowSairConfirm(false); data.handleSair(); }}
                  className="w-full py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-sm font-black cursor-pointer transition-colors flex items-center justify-center gap-2"
                >
                  <i className="ri-logout-box-r-line" />
                  Sair
                </button>
                <button
                  type="button"
                  onClick={function () { setShowSairConfirm(false); }}
                  className="w-full py-3 rounded-2xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-bold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}

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