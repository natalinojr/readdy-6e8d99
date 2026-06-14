import { useMesaQRData } from './useMesaQRData';
import IdentificacaoMesaQR from './components/IdentificacaoMesaQR';
import CardapioMesaQR from './components/CardapioMesaQR';
import CarrinhoMesaQR from './components/CarrinhoMesaQR';
import ConfirmacaoMesaQR from './components/ConfirmacaoMesaQR';
import MeusPedidosModalQR from './components/MeusPedidosModalQR';
import EditarItemMesaQRModal from './components/EditarItemMesaQRModal';
import { useRef } from 'react';

export default function MesaQRPage() {
  const data = useMesaQRData();

  // Controle de clique vs scroll para evitar conflito
  const categoriaClickRef = useRef(false);
  const categoriaClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scrollToCategoria(catId: string) {
    if (categoriaClickTimerRef.current) clearTimeout(categoriaClickTimerRef.current);
    categoriaClickRef.current = true;
    categoriaClickTimerRef.current = setTimeout(function () {
      categoriaClickRef.current = false;
    }, 800);

    data.setCategoriaAtiva(catId);
    const el = document.getElementById('scroll-cat-' + catId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function handleCategoriaAtivaChange(catId: string) {
    if (categoriaClickRef.current) return;
    data.setCategoriaAtiva(catId);
  }

  const step = data.step;
  const table = data.table;
  const participant = data.participant;
  const error = data.error;
  const tenantName = data.tenantName;
  const categories = data.categories;
  const items = data.items;
  const optionGroups = data.optionGroups;
  const options = data.options;
  const observations = data.observations;
  const categoriaAtiva = data.categoriaAtiva;
  const outOfStockIds = data.outOfStockIds;
  const cart = data.cart;
  const showCart = data.showCart;
  const enviando = data.enviando;
  const pedidoConfirmado = data.pedidoConfirmado;
  const numeroPedido = data.numeroPedido;
  const showMeusPedidos = data.showMeusPedidos;
  const totalItens = data.totalItens;
  const totalValor = data.totalValor;
  const editingItem = data.editingItem;
  const handleIdentificar = data.handleIdentificar;
  const handleAdicionar = data.handleAdicionar;
  const handleAlterarQtd = data.handleAlterarQtd;
  const handleRemover = data.handleRemover;
  const handleAbrirEdicao = data.handleAbrirEdicao;
  const handleSalvarEdicao = data.handleSalvarEdicao;
  const handleFecharEdicao = data.handleFecharEdicao;
  const handleConfirmarPedido = data.handleConfirmarPedido;
  const handleNovoPedido = data.handleNovoPedido;
  const opcoesIndisponiveisIds = data.opcoesIndisponiveisIds;

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-5 bg-amber-50 rounded-2xl border border-amber-100">
            <i className="ri-loader-4-line text-2xl text-amber-500 animate-spin" />
          </div>
          <p className="text-sm font-bold text-zinc-800">Carregando seu cardápio</p>
          <p className="text-xs text-zinc-500 mt-1">Aguarde um momento</p>
        </div>
      </div>
    );
  }

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
              <span className="text-zinc-600 text-xs font-semibold">{tenantName || 'Estabelecimento'}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (step === 'identificacao' && table) {
    return (
      <IdentificacaoMesaQR
        mesaNumero={table.number}
        tenantName={tenantName}
        onConfirmar={handleIdentificar}
        error={error}
      />
    );
  }

  if (step === 'confirmacao' && participant) {
    return (
      <ConfirmacaoMesaQR
        accessToken={participant.access_token}
        numeroPedido={numeroPedido}
        onNovoPedido={handleNovoPedido}
        confirmedCartItems={data.confirmedCartItems}
        cardapioItems={items}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white flex justify-center">
      <div className="w-full max-w-lg min-h-screen flex flex-col bg-white relative">
        {/* Header */}
        <div className="bg-gradient-to-br from-amber-500 to-orange-500 px-4 pt-6 pb-4 shrink-0">
          {/* Senha grande centralizada no topo */}
          {participant && (
            <div className="flex flex-col items-center mb-4">
              <p className="text-white/70 text-[10px] uppercase tracking-wider font-bold mb-1">Sua senha</p>
              <div className="inline-flex items-center gap-2.5 px-6 py-3 bg-white/25 rounded-2xl border-2 border-white/40">
                <div className="w-6 h-6 flex items-center justify-center">
                  <i className="ri-lock-password-line text-white text-lg" />
                </div>
                <span className="text-white text-2xl font-black tracking-[0.3em] leading-none">{participant.access_token}</span>
              </div>
              <p className="text-white/60 text-[10px] mt-1.5">Use esta senha para acessar seus pedidos</p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 flex items-center justify-center bg-white/30 rounded-xl">
                <i className="ri-restaurant-2-line text-white text-sm" />
              </div>
              <div>
                <h1 className="text-white text-lg font-black leading-tight">Cardápio</h1>
                {participant && (
                  <p className="text-white/80 text-xs">
                    Olá, <strong className="text-white">{participant.name}</strong>
                  </p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-[10px] uppercase tracking-wider font-bold">{tenantName || 'Estabelecimento'}</p>
            </div>
          </div>
          {participant && (
            <button
              type="button"
              onClick={function () { data.setShowMeusPedidos(true); }}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-white/20 hover:bg-white/30 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap border border-white/30"
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

        {/* Conteúdo scrollable */}
        <div className="flex-1 overflow-y-auto">
          {showCart ? (
            <CarrinhoMesaQR
              cart={cart}
              onAlterarQtd={handleAlterarQtd}
              onRemover={handleRemover}
              onEditar={handleAbrirEdicao}
              onConfirmar={handleConfirmarPedido}
              enviando={enviando}
              error={error}
              onVoltar={function () { data.setShowCart(false); }}
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
            />
          )}
        </div>

        {/* Footer carrinho fixo */}
        {(!showCart && totalItens > 0) ? (
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
              <span className="text-sm font-bold">
                R$ {totalValor.toFixed(2)}
              </span>
            </button>
          </div>
        ) : null}

        {/* Modal Meus Pedidos */}
        {showMeusPedidos && participant ? (
          <MeusPedidosModalQR
            participantId={participant.id}
            participantName={participant.name}
            tenantId={participant.tenant_id}
            onClose={function () { data.setShowMeusPedidos(false); }}
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
      </div>
    </div>
  );
}