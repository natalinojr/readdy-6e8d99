import { useMesaQRData } from './useMesaQRData';
import IdentificacaoMesaQR from './components/IdentificacaoMesaQR';
import CardapioMesaQR from './components/CardapioMesaQR';
import CarrinhoMesaQR from './components/CarrinhoMesaQR';
import ConfirmacaoMesaQR from './components/ConfirmacaoMesaQR';
import MeusPedidosModalQR from './components/MeusPedidosModalQR';
import PagarContaModalQR from './components/PagarContaModalQR';
import EditarItemMesaQRModal from './components/EditarItemMesaQRModal';
import { useMemo, useState, useEffect, useCallback } from 'react';
import LojaTopo from '@/components/cliente/LojaTopo';
import BarraSacola from '@/components/cliente/BarraSacola';
import { corLojaVars } from '@/lib/corLoja';
import { useStatusPedidoQR } from './useStatusPedidoQR';
import { useContaAbertaQR } from './useContaAbertaQR';
import BotaoClubeLoja from '@/components/cliente/BotaoClubeLoja';
import { formatCurrency } from '@/lib/formatters';
import { useIdiomaCardapio } from '@/hooks/useIdiomaCardapio';
import { edgeUrl } from '@/lib/idiomaCardapio';
import SeletorIdioma from '@/components/SeletorIdioma';
import { useTranslation } from 'react-i18next';

export default function MesaQRPage() {
  const { t } = useTranslation();
  const data = useMesaQRData();

  // Estável: o scroll spy do cardápio recria o observador quando esta função muda
  const setCategoriaAtiva = data.setCategoriaAtiva;
  const handleCategoriaAtivaChange = useCallback(function (catId: string) {
    setCategoriaAtiva(catId);
  }, [setCategoriaAtiva]);

  // Janelinha de nome (pagar a conta sem ter pedido ainda)
  const [pedirNome, setPedirNome] = useState<null | 'pagar' | 'pedidos'>(null);
  const [nomeJanela, setNomeJanela] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);

  const step = data.step;
  const table = data.table;
  const participant = data.participant;
  const error = data.error;
  const tenantName = data.tenantName;
  // Idioma do cliente no QR da mesa. `decorar` so acrescenta `*_i18n`: o item
  // que vai pro pedido continua em portugues, que e o que a cozinha le.
  const idiomaCardapio = useIdiomaCardapio(edgeUrl('mesa-write'), data.tenantId || null);
  const { decorar } = idiomaCardapio;

  const categories = useMemo(function () { return decorar(data.categories, 'category'); }, [data.categories, decorar]);
  const items = useMemo(function () { return decorar(data.items, 'item'); }, [data.items, decorar]);
  const optionGroups = useMemo(function () { return decorar(data.optionGroups, 'option_group'); }, [data.optionGroups, decorar]);
  const options = useMemo(function () { return decorar(data.options, 'option'); }, [data.options, decorar]);
  const observations = useMemo(function () { return decorar(data.observations, 'preset_obs', 'text', 'text_desc'); }, [data.observations, decorar]);
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
  const estiloLoja = corLojaVars(data.corLoja);

  const seletorIdiomaCapa = idiomaCardapio.temSeletor ? (
    <SeletorIdioma
      disponiveis={idiomaCardapio.disponiveis}
      idioma={idiomaCardapio.idioma}
      onTrocar={idiomaCardapio.trocarIdioma}
      variante="capa"
    />
  ) : null;

  // Andamento do último pedido (faixa da senha e tela da senha)
  const statusQR = useStatusPedidoQR(
    participant ? { id: participant.id, access_token: participant.access_token } : null,
    step === 'cardapio' || step === 'confirmacao',
  );

  // Já pagou tudo (app ou caixa)? Some o "Pagar" da faixa. Reconsulta quando o andamento
  // muda, quando sai/volta da confirmação e quando o modal de pagamento fecha.
  const conta = useContaAbertaQR(
    participant ? { id: participant.id, access_token: participant.access_token } : null,
    data.onlinePayEnabled && (step === 'cardapio' || step === 'confirmacao') && !data.showPagarConta,
    step + ':' + numeroPedido + ':' + (statusQR.status ? statusQR.status.etapa + ':' + statusQR.status.numero : '-'),
  );

  // Pedido novo confirmado: consulta o andamento na hora (senão a tela mostraria o do pedido anterior)
  const atualizarStatus = statusQR.atualizar;
  useEffect(function () {
    if (step === 'confirmacao') atualizarStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, numeroPedido]);
  // A etapa só vale para a confirmação se for deste pedido
  const etapaDestePedido = statusQR.status && numeroPedido && String(statusQR.status.numero) === String(numeroPedido)
    ? statusQR.status.etapa : null;

  function fotoDoItem(itemId: string): string | null {
    const it = items.find(function (x) { return x.id === itemId; });
    return it ? it.photo_url : null;
  }

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-[#FBF8F4] flex items-center justify-center" style={estiloLoja}>
        <div className="text-center">
          <i className="ri-loader-4-line text-3xl text-[var(--cor-loja)] animate-spin" />
          <p className="text-sm font-bold text-stone-800 mt-3">Carregando o cardápio</p>
          <p className="text-xs text-stone-500 mt-1">Aguarde um momento</p>
        </div>
      </div>
    );
  }

  if (step === 'encerrada') {
    const lojaFechada = /fechad/i.test(error || '');
    return (
      <div className="min-h-screen bg-[#FBF8F4] flex items-center justify-center px-5" style={estiloLoja}>
        <div className="text-center max-w-xs">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-5 bg-stone-100 rounded-2xl">
            <i className="ri-door-closed-line text-3xl text-stone-500" />
          </div>
          <h2 className="text-xl font-extrabold text-stone-900 mb-2">{lojaFechada ? 'Fechado agora' : 'Mesa encerrada'}</h2>
          <p className="text-sm text-stone-600 leading-relaxed">
            {lojaFechada
              ? 'A loja não está recebendo pedidos por aqui agora. Tente de novo mais tarde.'
              : (error || 'Esta mesa foi encerrada. Se precisar de ajuda, chame um garçom.')}
          </p>
          {table && (
            <p className="mt-6 text-xs font-semibold text-stone-500">{tenantName || 'Estabelecimento'}</p>
          )}
        </div>
      </div>
    );
  }

  if (step === 'comprovante' && data.comprovante) {
    return (
      <div className="min-h-screen bg-[#FBF8F4] flex items-center justify-center px-5" style={estiloLoja}>
        <div className="text-center max-w-xs w-full">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-5 bg-emerald-50 rounded-full">
            <i className="ri-check-line text-3xl text-emerald-700" />
          </div>
          <h2 className="text-xl font-extrabold text-stone-900 mb-1">Pagamento confirmado</h2>
          <p className="text-3xl font-extrabold text-stone-900 mb-3">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.comprovante.amount)}
          </p>
          <p className="text-sm text-stone-600 leading-relaxed">
            {data.comprovante.method && data.comprovante.method !== 'pix' ? 'Recebemos seu pagamento. Obrigado!' : 'Recebemos seu Pix. Obrigado!'}
          </p>
          <p className="text-xs text-stone-500 mt-2">Quer pedir mais alguma coisa? É só continuar.</p>
          <button
            type="button"
            onClick={data.handleFecharComprovante}
            className="mt-6 w-full h-14 rounded-2xl bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] text-white text-base font-bold cursor-pointer transition-colors"
          >
            Voltar ao cardápio
          </button>
          <p className="text-xs text-stone-500 mt-3">{tenantName || 'Estabelecimento'}</p>
        </div>
      </div>
    );
  }

  if (step === 'identificacao' && table) {
    return (
      <IdentificacaoMesaQR
        mesaNumero={table.number}
        isUniversal={data.queueMode}
        tenantName={tenantName}
        onConfirmar={handleIdentificar}
        error={error}
      />
    );
  }

  // Modal de pagar a conta (Pix/cartão). Pedido segurado (QR universal "paga antes"): quando o
  // pagamento confirma, a confirmação passa a dizer que o pedido foi para a cozinha.
  const aguardando = data.pedidoAguardandoPagamento;
  const modalPagarConta = data.showPagarConta && participant ? (
    <PagarContaModalQR
      qrToken={data.qrToken}
      tenantId={participant.tenant_id}
      participantId={participant.id}
      participantName={participant.name}
      accessToken={participant.access_token}
      onClose={function () { data.setShowPagarConta(false); }}
      onPago={data.handlePagamentoConfirmado}
      textoPago={aguardando ? 'Seu pedido foi para a cozinha' : undefined}
    />
  ) : null;

  if (step === 'confirmacao' && participant) {
    return (
      <>
        <div style={estiloLoja}>
        <ConfirmacaoMesaQR
          accessToken={participant.access_token}
          numeroPedido={numeroPedido}
          onNovoPedido={handleNovoPedido}
          confirmedCartItems={data.confirmedCartItems}
          cardapioItems={items}
          tenantId={participant.tenant_id}
          participantId={participant.id}
          descontoClube={data.descontoConfirmado}
          aguardandoPagamento={aguardando}
          onPagarAgora={data.onlinePayEnabled ? function () { data.setShowPagarConta(true); } : undefined}
          contaAberta={conta.aberta === true}
          faltaPagar={conta.falta}
          logoUrl={data.logoUrl}
          nomeLoja={tenantName}
          nomeCliente={participant.name}
          queueMode={data.queueMode}
          mesaNumero={table ? table.number : null}
          etapa={etapaDestePedido}
        />
        </div>
        {modalPagarConta}
      </>
    );
  }

  // Sem senha ainda e a pessoa quer "Pagar a conta" (mesa numerada): pede o nome numa janelinha
  async function confirmarNome() {
    if (salvandoNome) return;
    setSalvandoNome(true);
    const p = await data.garantirParticipante(nomeJanela);
    setSalvandoNome(false);
    if (!p) return;
    const acao = pedirNome;
    setPedirNome(null);
    if (acao === 'pagar') data.setShowPagarConta(true);
    if (acao === 'pedidos') data.setShowMeusPedidos(true);
  }

  const etapaQR = statusQR.status ? statusQR.status.etapa : null;
  const textoEtapa = etapaQR === 'pagamento' ? 'Falta o pagamento'
    : etapaQR === 'recebido' ? 'Pedido recebido'
    : etapaQR === 'preparo' ? 'Em preparo'
    : etapaQR === 'pronto' ? (data.queueMode ? 'Pronto! Retire no balcão' : 'Pronto')
    : etapaQR === 'entregue' ? (data.queueMode ? 'Retirado' : 'Entregue')
    : 'Seus pedidos';
  const corPonto = etapaQR === 'preparo' ? 'bg-amber-400' : etapaQR === 'pronto' ? 'bg-emerald-400' : etapaQR === 'pagamento' ? 'bg-red-400' : 'bg-stone-400';
  const faixaVisivel = !!participant && !showCart;
  const ALTURA_FAIXA = 68;

  return (
    <div className="min-h-screen bg-[#FBF8F4] flex justify-center" style={estiloLoja}>
      <div className="w-full max-w-lg min-h-screen flex flex-col relative">
        {/* Faixa da senha: aparece depois do 1º pedido e fica presa no topo */}
        {faixaVisivel && participant ? (
          <div
            className={'sticky top-0 z-30 flex items-center gap-2 pl-4 pr-3 text-white ' + (etapaQR === 'pronto' && data.queueMode ? 'bg-emerald-700' : 'bg-stone-900')}
            style={{ height: ALTURA_FAIXA }}
          >
            <button
              type="button"
              onClick={function () { data.setShowMeusPedidos(true); }}
              className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer h-full"
            >
              <span className="flex flex-col items-center justify-center min-w-[64px] h-12 rounded-xl bg-white/10 shrink-0">
                <span className="text-[10px] tracking-[0.08em] font-bold text-stone-300">{data.queueMode ? 'SENHA' : 'MESA'}</span>
                <span className="text-[22px] font-extrabold leading-none mt-0.5">{data.queueMode ? participant.access_token : (table ? table.number : '')}</span>
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-bold">
                  <span className={'w-2 h-2 rounded-full shrink-0 ' + corPonto} />
                  <span className="truncate">{textoEtapa}</span>
                </span>
                <span className="block text-xs text-stone-300 mt-0.5 truncate">{participant.name} · toque para ver seus pedidos</span>
              </span>
            </button>
            {data.onlinePayEnabled && conta.aberta !== false ? (
              <button
                type="button"
                onClick={function () { data.setShowPagarConta(true); }}
                className="shrink-0 h-11 px-4 rounded-xl bg-white text-stone-900 text-sm font-extrabold cursor-pointer"
              >
                Pagar
              </button>
            ) : (
              <i className="ri-arrow-right-s-line text-xl text-stone-300 shrink-0" />
            )}
          </div>
        ) : null}

        <div className="flex-1">
          {showCart ? (
            <CarrinhoMesaQR
              cart={cart}
              onAlterarQtd={handleAlterarQtd}
              onRemover={handleRemover}
              onEsvaziar={data.handleEsvaziarSacola}
              onEditar={handleAbrirEdicao}
              onConfirmar={function (nome: string) { handleConfirmarPedido(nome); }}
              enviando={enviando}
              error={error}
              onVoltar={function () { data.setShowCart(false); data.setError(''); }}
              participante={participant}
              nomeSalvo={data.nomeSalvo}
              subtitulo={(data.queueMode ? 'Retirada no balcão' : (table ? 'Mesa ' + table.number : '')) + ' · ' + (tenantName || 'Estabelecimento')}
              fotoDe={fotoDoItem}
              tenantId={table?.tenant_id ?? null}
              clubeDesconto={data.clubeSel.desconto}
              clubeNomes={data.clubeSel.nomes}
              onClube={data.setClubeSel}
            />
          ) : (
            <>
              <LojaTopo
                nome={tenantName || 'Estabelecimento'}
                logoUrl={data.logoUrl}
                capas={data.capas}
                situacao={{ tipo: 'aberto', texto: t('cliente.aberto') }}
                subtitulo={!data.queueMode && table ? t('cliente.mesaN', { n: table.number }) : null}
                acoes={seletorIdiomaCapa}
              >
                <div className="mx-5 mt-3.5 px-3.5 py-3 rounded-2xl bg-white border border-stone-200/70 flex gap-3 items-center">
                  <span className="w-10 h-10 rounded-xl bg-[var(--cor-loja-suave)] text-[var(--cor-loja)] flex items-center justify-center shrink-0">
                    <i className={(data.queueMode ? 'ri-notification-3-line' : 'ri-restaurant-2-line') + ' text-lg'} />
                  </span>
                  <p className="text-[13px] leading-snug text-stone-700">
                    {data.queueMode ? (
                      <>
                        <strong className="text-stone-900">{t('cliente.retiradaBalcao')}</strong>
                        <br />
                        {t('cliente.senhaAoPedir')}
                      </>
                    ) : (
                      <strong className="text-stone-900">{t('cliente.pecaDaMesa')}</strong>
                    )}
                  </p>
                </div>
                {!participant && !data.queueMode && data.onlinePayEnabled ? (
                  <button
                    type="button"
                    onClick={function () { data.setError(''); setNomeJanela(data.nomeSalvo || ''); setPedirNome('pagar'); }}
                    className="mx-5 mt-2.5 w-[calc(100%-2.5rem)] h-11 rounded-xl border border-stone-300 bg-white text-sm font-bold text-stone-900 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <i className="ri-secure-payment-line text-base" />
                    Pagar a conta da mesa
                  </button>
                ) : null}
                <BotaoClubeLoja tenantId={data.tenantId || null} />
              </LojaTopo>

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
                  topoChips={faixaVisivel ? ALTURA_FAIXA : 0}
                />
              </div>
            </>
          )}
        </div>

        {/* Barra da sacola */}
        {(!showCart && totalItens > 0) ? (
          <div className="sticky bottom-0 z-30">
            <BarraSacola
              quantidade={totalItens}
              texto={t('cliente.verSacola')}
              total={formatCurrency(totalValor)}
              onClick={function () { data.setShowCart(true); }}
            />
          </div>
        ) : null}

        {/* Janelinha: nome antes de pagar a conta sem ter pedido */}
        {pedirNome ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={function () { setPedirNome(null); data.setError(''); }} />
            <div className="relative w-full max-w-lg bg-[#FBF8F4] rounded-t-3xl px-5 pt-5 pb-6">
              <label htmlFor="qr-nome-janela" className="block text-lg font-extrabold text-stone-900">Como chamamos você?</label>
              <input
                id="qr-nome-janela"
                type="text"
                autoFocus
                value={nomeJanela}
                onChange={function (e) { setNomeJanela(e.target.value); }}
                placeholder={t('cliente.seuNome')}
                maxLength={40}
                className="mt-3 w-full h-12 px-3.5 rounded-xl border border-stone-300 bg-white text-[15px] text-stone-900 focus:outline-none focus:ring-2 focus:ring-[color:var(--cor-loja-suave)] focus:border-[var(--cor-loja)]"
              />
              {error ? <p className="text-sm text-red-700 mt-2">{error}</p> : null}
              <button
                type="button"
                onClick={confirmarNome}
                disabled={!nomeJanela.trim() || salvandoNome}
                className="mt-4 w-full h-14 rounded-2xl bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] disabled:opacity-50 text-white text-base font-bold cursor-pointer"
              >
                Continuar
              </button>
            </div>
          </div>
        ) : null}

        {/* Modal Meus Pedidos */}
        {showMeusPedidos && participant ? (
          <MeusPedidosModalQR
            participantId={participant.id}
            participantName={participant.name}
            tenantId={participant.tenant_id}
            accessToken={participant.access_token}
            onClose={function () { data.setShowMeusPedidos(false); }}
          />
        ) : null}

        {/* Modal Pagar a conta (Pix ou cartão online) */}
        {modalPagarConta}

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
