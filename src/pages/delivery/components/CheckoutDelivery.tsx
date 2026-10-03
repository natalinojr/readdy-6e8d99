// Sacola do delivery numa tela só: itens, seus dados, entrega/retirada + endereço,
// pagamento, clube/cupom e o botão "Fazer pedido". Antes eram 5 a 6 telas
// (celular → modo → endereço → cardápio → carrinho → janela de pagamento).
//
// O backend é o mesmo: busca o cliente pelo WhatsApp (lookup_customer), salva o
// cadastro/endereço (save_customer) e cria o pedido (create_delivery_order) — tudo
// pelo hook useDeliveryData (finalizarCheckout).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/formatters';
import { formatPhoneBR } from '@/lib/deliveryPhone';
import { isValidCpfCnpj } from '@/lib/cpfCnpj';
import BotaoEsvaziarSacola from '@/components/cliente/BotaoEsvaziarSacola';
import ClubeCheckout from '@/components/fidelidade/ClubeCheckout';
import CpfCnpjInput from '@/components/base/CpfCnpjInput';
import type { useDeliveryData } from '../useDeliveryData';

type DadosDelivery = ReturnType<typeof useDeliveryData>;

interface Props {
  data: DadosDelivery;
  /** Formas de pagamento ligadas (inclui pix_online / cartao_online quando disponíveis). */
  metodosDisponiveis: Record<string, boolean>;
  onVoltar: () => void;
  fotoDe: (itemId: string) => string | null;
  /** Loja fechada: texto do botão (ex.: "Fechado · abre às 18h"). null = aberta. */
  lojaFechadaTexto: string | null;
  nomeLoja: string;
}

const ORDEM_METODO: Record<string, number> = { pix_online: 0, cartao_online: 1, pix: 2, cartao_credito: 3, cartao_debito: 4, dinheiro: 5, vale_refeicao: 6 };

function infoMetodo(key: string, retirada: boolean): { label: string; icon: string; sub: string } {
  const ondePaga = retirada ? 'na retirada' : 'na entrega';
  const mapa: Record<string, { label: string; icon: string; sub: string }> = {
    pix_online: { label: 'Pix pelo app', icon: 'ri-qr-code-line', sub: 'Aprovação na hora, sem maquininha' },
    cartao_online: { label: 'Cartão de crédito pelo app', icon: 'ri-bank-card-line', sub: 'Pago agora no celular, à vista' },
    pix: { label: 'Pix ' + ondePaga, icon: 'ri-qr-code-line', sub: retirada ? 'Pague no balcão' : 'O motoboy leva a maquininha' },
    cartao_credito: { label: 'Crédito ' + ondePaga, icon: 'ri-bank-card-line', sub: retirada ? 'Pague no balcão' : 'O motoboy leva a maquininha' },
    cartao_debito: { label: 'Débito ' + ondePaga, icon: 'ri-bank-card-2-line', sub: retirada ? 'Pague no balcão' : 'O motoboy leva a maquininha' },
    dinheiro: { label: 'Dinheiro', icon: 'ri-money-dollar-circle-line', sub: 'Informe o valor para o troco' },
    vale_refeicao: { label: 'Vale-refeição', icon: 'ri-coupon-line', sub: 'O motoboy leva a maquininha' },
  };
  return mapa[key] || { label: key, icon: 'ri-wallet-line', sub: '' };
}

export default function CheckoutDelivery(props: Props) {
  const { t } = useTranslation();
  const data = props.data;
  const cart = data.cart;
  const retirada = data.modoEntrega === 'retirada';
  const cliente = data.customer;

  const metodos = useMemo(function () {
    return Object.entries(props.metodosDisponiveis)
      .filter(function (e) { return e[1] === true; })
      .map(function (e) { return e[0]; })
      .sort(function (a, b) { return (ORDEM_METODO[a] ?? 9) - (ORDEM_METODO[b] ?? 9); });
  }, [props.metodosDisponiveis]);

  // Forma e troco ficam guardados na aba: ir ao mapa/novo endereço desmonta a sacola
  const [metodo, setMetodoState] = useState<string>(function () { try { return sessionStorage.getItem('ck_metodo') || ''; } catch { return ''; } });
  const [valorDinheiro, setValorDinheiroState] = useState(function () { try { return sessionStorage.getItem('ck_troco') || ''; } catch { return ''; } });
  function setMetodo(v: string) { setMetodoState(v); try { sessionStorage.setItem('ck_metodo', v); } catch { /* sem storage */ } }
  function setValorDinheiro(v: string) { setValorDinheiroState(v); try { sessionStorage.setItem('ck_troco', v); } catch { /* sem storage */ } }
  const [mostrarCpf, setMostrarCpf] = useState(!!data.cpfNota);
  const [mostrarCupom, setMostrarCupom] = useState(!!data.voucherCodigo);
  const [tentou, setTentou] = useState(false);

  // Pré-seleciona a primeira forma (Pix pelo app, quando a loja tem)
  useEffect(function () {
    if (!metodo && metodos.length > 0) setMetodo(metodos[0]);
    if (metodo && metodos.indexOf(metodo) < 0) setMetodo(metodos[0] || '');
  }, [metodos, metodo]);

  // Busca o cadastro quando o WhatsApp fica completo: 11 dígitos (celular) logo; 10 dígitos só
  // depois de uma pausa (pode ser o meio do celular sendo digitado). Mudou o número = busca nova.
  const telDigitos = (data.phone || '').replace(/\D/g, '');
  useEffect(function () {
    if (cliente) return;
    data.reiniciarBuscaCliente();
    if (telDigitos.length !== 10 && telDigitos.length !== 11) return;
    const espera = telDigitos.length === 11 ? 350 : 1500;
    const timer = setTimeout(function () { data.buscarClienteCheckout(telDigitos); }, espera);
    return function () { clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telDigitos, !!cliente]);

  const subtotal = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);
  const totalItens = cart.reduce(function (s, i) { return s + i.quantidade; }, 0);
  // Por bairro: sem bairro escolhido ainda não há taxa (o hook guarda a do 1º bairro como padrão)
  const taxaDefinida = retirada || data.distanceMode || !!data.selectedNeighborhoodId || data.displayAddresses.length > 0;
  const taxa = retirada ? 0 : (taxaDefinida ? data.effectiveDeliveryFee : 0);
  const voucherDesc = Math.min(data.voucherDesconto || 0, subtotal);
  const clubeDesc = Math.min(data.clubeSel.desconto || 0, Math.max(0, subtotal - voucherDesc));
  const total = Math.max(0, subtotal + taxa - voucherDesc - clubeDesc);
  const minimo = data.infoLoja.pedidoMinimo;
  const faltaMinimo = !retirada && minimo > 0 && subtotal < minimo ? minimo - subtotal : 0;

  const valorDinheiroTxt = (valorDinheiro || '').indexOf(',') >= 0 ? valorDinheiro.replace(/\./g, '').replace(',', '.') : (valorDinheiro || '');
  const valorDinheiroNum = parseFloat(valorDinheiroTxt);
  const dinheiroInvalido = metodo === 'dinheiro' && (!valorDinheiro || isNaN(valorDinheiroNum) || valorDinheiroNum < total);
  const cpfDig = (data.cpfNota || '').replace(/\D/g, '');
  const cpfInvalido = cpfDig.length > 0 && !isValidCpfCnpj(cpfDig);

  const temEnderecos = data.displayAddresses.length > 0;
  const mostrarFormEndereco = !retirada && !temEnderecos && !data.distanceMode;
  const enderecoSelecionado = data.displayAddresses.find(function (a) { return a.id === data.selectedAddressId; }) || null;
  const faltaBairroNoSalvo = !retirada && !data.distanceMode && !!enderecoSelecionado && !enderecoSelecionado.neighborhood_id;

  function trocarModo(modo: 'entrega' | 'retirada') {
    data.setModoEntrega(modo);
    if (modo === 'entrega' && data.selectedNeighborhoodId) data.handleChangeNeighborhood(data.selectedNeighborhoodId);
  }

  function abrirMapa() {
    // O mapa salva o cadastro junto: precisa do WhatsApp e do nome antes
    if (telDigitos.length < 10 || !data.customerName.trim()) {
      setTentou(true);
      data.setError('Preencha seu WhatsApp e nome antes de marcar o endereço.');
      return;
    }
    data.setError('');
    data.handleIrParaEnderecos();
  }

  let bloqueio: string | null = null;
  if (props.lojaFechadaTexto) bloqueio = props.lojaFechadaTexto;
  else if (faltaMinimo > 0) bloqueio = t('cliente.faltaMinimo', { v: formatCurrency(minimo), f: formatCurrency(faltaMinimo) });
  else if (!retirada && data.foraDeArea && data.addressLat != null) bloqueio = 'Endereço fora da área de entrega';

  function fazerPedido() {
    setTentou(true);
    if (bloqueio || data.enviando) return;
    if (metodos.length > 0 && !metodo) { data.setError('Escolha a forma de pagamento.'); return; }
    if (dinheiroInvalido) { data.setError('Informe um valor em dinheiro igual ou maior que o total.'); return; }
    if (cpfInvalido) { data.setError('CPF/CNPJ inválido — confira os números ou apague.'); return; }
    data.finalizarCheckout(metodo || undefined, metodo === 'dinheiro' ? String(valorDinheiroNum) : '');
  }

  const inputCls = 'w-full h-12 px-3.5 rounded-xl border bg-white text-[15px] text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[color:var(--cor-loja-suave)] focus:border-[var(--cor-loja)] ';
  const rotuloCls = 'block text-[13px] font-semibold text-stone-700 mt-3';

  return (
    <div className="min-h-full flex flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-200/70 bg-[#FBF8F4] sticky top-0 z-20">
        <button
          type="button"
          onClick={props.onVoltar}
          aria-label={t('cliente.voltarCardapio')}
          className="w-11 h-11 flex items-center justify-center rounded-full text-stone-900 hover:bg-stone-100 cursor-pointer shrink-0"
        >
          <i className="ri-arrow-left-s-line text-2xl" />
        </button>
        <div className="min-w-0">
          <h2 className="text-[17px] font-extrabold text-stone-900">Sua sacola</h2>
          <p className="text-xs text-stone-500 truncate">{props.nomeLoja}</p>
        </div>
        {cart.length > 0 ? <BotaoEsvaziarSacola onEsvaziar={data.handleEsvaziarSacola} /> : null}
      </div>

      {cart.length === 0 ? (
        <div className="text-center py-16 flex flex-col items-center px-4">
          <div className="w-16 h-16 flex items-center justify-center bg-stone-100 rounded-2xl mb-4">
            <i className="ri-shopping-bag-3-line text-2xl text-stone-300" />
          </div>
          <p className="text-sm font-bold text-stone-700">{t('cliente.carrinhoVazio')}</p>
          <button type="button" onClick={props.onVoltar} className="mt-3 h-11 px-4 text-sm text-[var(--cor-loja)] font-bold cursor-pointer">
            {t('cliente.voltarCardapio')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 px-4 pt-3.5 pb-4 space-y-3">
            {/* Itens */}
            <section className="bg-white border border-stone-200/70 rounded-[18px] px-3.5 pt-1 pb-1">
              {cart.map(function (item) {
                const foto = props.fotoDe(item.itemId);
                const detalhes = item.opcoes.map(function (o) { return o.opcaoNome; })
                  .concat(item.observacoes)
                  .concat(item.observacaoLivre ? ['"' + item.observacaoLivre + '"'] : [])
                  .join(' · ');
                return (
                  <div key={item.cartId} className="flex gap-3 items-center py-3 border-b border-stone-100">
                    <div className="w-[52px] h-[52px] rounded-xl bg-stone-100 overflow-hidden shrink-0 flex items-center justify-center">
                      {foto ? <img src={foto} alt="" className="w-full h-full object-cover" loading="lazy" /> : <i className="ri-restaurant-2-line text-stone-400" />}
                    </div>
                    <button type="button" onClick={function () { data.handleAbrirEdicao(item.cartId); }} className="flex-1 min-w-0 text-left cursor-pointer">
                      <span className="block text-sm font-bold text-stone-900 leading-snug break-words">{item.name}</span>
                      {detalhes ? <span className="block text-xs text-stone-500 mt-0.5 line-clamp-2">{detalhes}</span> : null}
                      <span className="block text-sm font-bold text-stone-900 mt-1">{formatCurrency(item.precoTotal * item.quantidade)}</span>
                    </button>
                    <div className="shrink-0 flex items-center h-11 rounded-xl border border-stone-300">
                      <button
                        type="button"
                        aria-label={item.quantidade === 1 ? 'Tirar da sacola' : 'Diminuir'}
                        onClick={function () { if (item.quantidade === 1) data.handleRemover(item.cartId); else data.handleAlterarQtd(item.cartId, -1); }}
                        className="w-9 h-11 flex items-center justify-center text-stone-900 cursor-pointer"
                      >
                        <i className={item.quantidade === 1 ? 'ri-delete-bin-line text-[15px]' : 'ri-subtract-line'} />
                      </button>
                      <span className="min-w-[16px] text-center text-sm font-bold">{item.quantidade}</span>
                      <button
                        type="button"
                        aria-label="Aumentar"
                        onClick={function () { data.handleAlterarQtd(item.cartId, 1); }}
                        className="w-9 h-11 flex items-center justify-center text-stone-900 cursor-pointer"
                      >
                        <i className="ri-add-line" />
                      </button>
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={props.onVoltar} className="w-full flex items-center gap-2 h-12 text-sm font-bold text-[var(--cor-loja)] cursor-pointer">
                <i className="ri-add-line text-lg" />
                Adicionar mais itens
              </button>
            </section>

            {/* Seus dados */}
            <section className="bg-white border border-stone-200/70 rounded-[18px] p-4">
              <h3 className="text-base font-extrabold text-stone-900">Seus dados</h3>
              {cliente ? (
                <div className="mt-3 flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-[var(--cor-loja-suave)] text-[var(--cor-loja)] flex items-center justify-center shrink-0">
                    <i className="ri-user-3-line text-lg" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-stone-900 truncate">{data.customerName || cliente.name}</span>
                    <span className="block text-xs text-stone-500">{data.phone}</span>
                  </span>
                  <button type="button" onClick={data.trocarCliente} className="shrink-0 h-11 px-2 text-[13px] font-bold text-[var(--cor-loja)] cursor-pointer">
                    Não é você?
                  </button>
                </div>
              ) : (
                <>
                  <label htmlFor="ck-tel" className={rotuloCls}>{t('cliente.seuWhats')}</label>
                  <div className="relative mt-1.5">
                    <input
                      id="ck-tel"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      value={data.phone}
                      onChange={function (e) { data.setPhone(formatPhoneBR(e.target.value)); }}
                      placeholder="(41) 99999-9999"
                      className={inputCls + (tentou && telDigitos.length < 10 ? 'border-red-500' : 'border-stone-300')}
                    />
                    {data.buscaCliente === 'buscando' ? (
                      <i className="ri-loader-4-line animate-spin absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                    ) : null}
                  </div>
                  <label htmlFor="ck-nome" className={rotuloCls}>{t('cliente.seuNome')}</label>
                  <input
                    id="ck-nome"
                    type="text"
                    autoComplete="name"
                    value={data.customerName}
                    onChange={function (e) { data.setCustomerName(e.target.value); }}
                    placeholder="Como chamamos você?"
                    className={'mt-1.5 ' + inputCls + (tentou && !data.customerName.trim() ? 'border-red-500' : 'border-stone-300')}
                  />
                  <p className="text-xs text-stone-500 mt-2 leading-snug">{t('cliente.jaPediuAntes')}</p>
                </>
              )}
            </section>

            {/* Como receber */}
            <section className="bg-white border border-stone-200/70 rounded-[18px] p-4">
              <h3 className="text-base font-extrabold text-stone-900">{t('cliente.comoReceber')}</h3>
              {data.retiradaAtivo ? (
                <div className="mt-3 grid grid-cols-2 gap-1 bg-stone-100 rounded-[13px] p-1">
                  <button
                    type="button"
                    aria-pressed={!retirada}
                    onClick={function () { trocarModo('entrega'); }}
                    className={'h-11 rounded-[10px] text-sm cursor-pointer ' + (!retirada ? 'bg-white shadow-sm font-bold text-stone-900' : 'font-semibold text-stone-600')}
                  >
                    {t('cliente.entrega')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={retirada}
                    onClick={function () { trocarModo('retirada'); }}
                    className={'h-11 rounded-[10px] text-sm cursor-pointer ' + (retirada ? 'bg-white shadow-sm font-bold text-stone-900' : 'font-semibold text-stone-600')}
                  >
                    {t('cliente.retirada')}
                  </button>
                </div>
              ) : null}

              {retirada ? (
                <div className="mt-3 px-3.5 py-3 rounded-xl bg-stone-100 flex gap-3 items-start">
                  <i className="ri-store-2-line text-lg text-stone-700 leading-none mt-0.5" />
                  <p className="text-[13px] leading-snug text-stone-700"><strong className="text-stone-900">Retirar na loja — sem taxa.</strong><br />A gente separa e você busca no balcão.</p>
                </div>
              ) : temEnderecos ? (
                <div className="mt-2">
                  {data.displayAddresses.map(function (addr) {
                    const sel = addr.id === data.selectedAddressId;
                    const linha = [addr.street, addr.number].filter(Boolean).join(', ') || 'Endereço incompleto';
                    return (
                      <button
                        key={addr.id}
                        type="button"
                        onClick={function () { data.handleSelecionarEndereco(addr.id); }}
                        className="w-full flex items-center gap-3 min-h-[60px] py-2 border-b border-stone-100 text-left cursor-pointer"
                      >
                        <span className={'w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 ' + (sel ? 'border-[var(--cor-loja)]' : 'border-stone-300')}>
                          {sel ? <span className="w-2.5 h-2.5 rounded-full bg-[var(--cor-loja)]" /> : null}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold text-stone-900 truncate">{addr.label}</span>
                          <span className="block text-xs text-stone-500 truncate">{linha}{addr.neighborhood_name ? ' · ' + addr.neighborhood_name : ''}</span>
                        </span>
                      </button>
                    );
                  })}
                  {faltaBairroNoSalvo ? (
                    <div>
                      <label htmlFor="ck-bairro-salvo" className={rotuloCls}>Bairro deste endereço</label>
                      <select
                        id="ck-bairro-salvo"
                        value={data.selectedNeighborhoodId}
                        onChange={function (e) { data.handleChangeNeighborhood(e.target.value); }}
                        className={'mt-1.5 ' + inputCls + (tentou && !data.selectedNeighborhoodId ? 'border-red-500' : 'border-stone-300')}
                      >
                        <option value="">Escolha o bairro</option>
                        {data.neighborhoods.map(function (n) {
                          return <option key={n.id} value={n.id}>{n.name}{Number(n.delivery_fee) > 0 ? ' · ' + formatCurrency(Number(n.delivery_fee)) : ' · ' + t('cliente.gratis')}</option>;
                        })}
                      </select>
                    </div>
                  ) : null}
                  <button type="button" onClick={data.handleIrParaEnderecos} className="mt-1 h-11 flex items-center gap-2 text-sm font-bold text-[var(--cor-loja)] cursor-pointer">
                    <i className="ri-add-line text-lg" />
                    Novo endereço
                  </button>
                </div>
              ) : data.distanceMode ? (
                <div className="mt-3">
                  {data.addressLat != null && data.street ? (
                    <div className="px-3.5 py-3 rounded-xl bg-stone-100 text-sm text-stone-800">
                      {[data.street, data.addressNumber].filter(Boolean).join(', ')}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={abrirMapa}
                    className="mt-2 w-full h-12 rounded-xl border-[1.5px] border-[var(--cor-loja)] bg-white text-[var(--cor-loja)] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <i className="ri-map-pin-2-line text-lg" />
                    {data.addressLat != null ? 'Alterar endereço no mapa' : 'Marcar endereço no mapa'}
                  </button>
                </div>
              ) : null}

              {mostrarFormEndereco ? (
                <div>
                  <label htmlFor="ck-bairro" className={rotuloCls}>Bairro</label>
                  <select
                    id="ck-bairro"
                    value={data.selectedNeighborhoodId}
                    onChange={function (e) { data.handleChangeNeighborhood(e.target.value); }}
                    className={'mt-1.5 ' + inputCls + (tentou && !data.selectedNeighborhoodId ? 'border-red-500' : 'border-stone-300')}
                  >
                    <option value="">Escolha o bairro</option>
                    {data.neighborhoods.map(function (n) {
                      return <option key={n.id} value={n.id}>{n.name}{Number(n.delivery_fee) > 0 ? ' · ' + formatCurrency(Number(n.delivery_fee)) : ' · ' + t('cliente.gratis')}</option>;
                    })}
                  </select>
                  <label htmlFor="ck-rua" className={rotuloCls}>Rua</label>
                  <input id="ck-rua" type="text" autoComplete="address-line1" value={data.street} onChange={function (e) { data.setStreet(e.target.value); }} placeholder="Nome da rua" className={'mt-1.5 ' + inputCls + (tentou && !data.street.trim() ? 'border-red-500' : 'border-stone-300')} />
                  <div className="grid gap-2.5" style={{ gridTemplateColumns: '96px minmax(0, 1fr)' }}>
                    <div>
                      <label htmlFor="ck-num" className={rotuloCls}>Número</label>
                      <input id="ck-num" type="text" inputMode="numeric" value={data.addressNumber} onChange={function (e) { data.setAddressNumber(e.target.value); }} placeholder="120" className={'mt-1.5 ' + inputCls + (tentou && !data.addressNumber.trim() ? 'border-red-500' : 'border-stone-300')} />
                    </div>
                    <div>
                      <label htmlFor="ck-comp" className={rotuloCls}>Complemento <span className="font-normal text-stone-500">(opcional)</span></label>
                      <input id="ck-comp" type="text" value={data.complement} onChange={function (e) { data.setComplement(e.target.value); }} placeholder="Apto, bloco, casa 2" className={'mt-1.5 ' + inputCls + 'border-stone-300'} />
                    </div>
                  </div>
                  <label htmlFor="ck-ref" className={rotuloCls}>Ponto de referência <span className="font-normal text-stone-500">(opcional)</span></label>
                  <input id="ck-ref" type="text" value={data.referencePoint} onChange={function (e) { data.setReferencePoint(e.target.value); }} placeholder="Perto de…" className={'mt-1.5 ' + inputCls + 'border-stone-300'} />
                </div>
              ) : null}

              {/* Taxa calculada */}
              {!retirada && (data.distanceMode ? data.deliveryQuote : data.selectedNeighborhoodId) ? (
                data.distanceMode && data.foraDeArea ? (
                  <div className="mt-3 px-3.5 py-3 rounded-xl bg-red-50 text-red-900 text-[13px] font-semibold flex gap-2 items-center">
                    <i className="ri-map-pin-off-line text-base" />Fora da área de entrega desta loja
                  </div>
                ) : (
                  <div className="mt-3 px-3.5 py-3 rounded-xl bg-emerald-50 text-emerald-900 flex gap-2.5 items-center">
                    <i className="ri-check-line text-lg text-emerald-700" />
                    <span className="text-[13px] leading-snug">
                      <strong>Entrega {taxa > 0 ? formatCurrency(taxa) : t('cliente.gratis')}</strong>
                      {data.distanceMode && data.deliveryQuote
                        ? ' · ' + (data.deliveryQuote.tempoMax > 0 ? t('cliente.ateMin', { n: data.deliveryQuote.tempoMax }) + ' · ' : '') + '~' + data.deliveryQuote.km.toFixed(1) + ' km'
                        : (data.bairroAtual ? ' · ' + data.bairroAtual.name : '')}
                    </span>
                  </div>
                )
              ) : null}
            </section>

            {/* Pagamento */}
            {metodos.length > 0 ? (
              <section className="bg-white border border-stone-200/70 rounded-[18px] px-4 pt-4 pb-2">
                <h3 className="text-base font-extrabold text-stone-900">{t('cliente.formaPagamento')}</h3>
                <div className="mt-1">
                  {metodos.map(function (key) {
                    const info = infoMetodo(key, retirada);
                    const sel = metodo === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={sel}
                        onClick={function () { setMetodo(key); setValorDinheiro(''); data.setError(''); }}
                        className="w-full flex items-center gap-3 min-h-[64px] py-2 border-b border-stone-100 text-left cursor-pointer"
                      >
                        <span className="w-10 h-10 rounded-xl bg-stone-100 text-stone-800 flex items-center justify-center shrink-0">
                          <i className={info.icon + ' text-lg'} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 text-[15px] font-bold text-stone-900">
                            {info.label}
                            {key === 'pix_online' ? <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-bold">Recomendado</span> : null}
                          </span>
                          <span className="block text-xs text-stone-500 mt-0.5">{info.sub}</span>
                        </span>
                        <span className={'w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 ' + (sel ? 'border-[var(--cor-loja)]' : 'border-stone-300')}>
                          {sel ? <span className="w-2.5 h-2.5 rounded-full bg-[var(--cor-loja)]" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {metodo === 'dinheiro' ? (
                  <div className="mt-3 p-3.5 rounded-xl bg-stone-100">
                    <label htmlFor="ck-troco" className="block text-[13px] font-semibold text-stone-700">Vai pagar com quanto?</label>
                    <div className="relative mt-1.5">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-500">R$</span>
                      <input
                        id="ck-troco"
                        type="text"
                        inputMode="decimal"
                        value={valorDinheiro}
                        onChange={function (e) { setValorDinheiro(e.target.value.replace(/[^\d,.]/g, '')); }}
                        placeholder="0,00"
                        className={inputCls + 'pl-10 ' + (tentou && dinheiroInvalido ? 'border-red-500' : 'border-stone-300')}
                      />
                    </div>
                    {valorDinheiro && !dinheiroInvalido ? (
                      <p className="text-[13px] text-emerald-800 font-bold mt-2">Troco: {formatCurrency(valorDinheiroNum - total)}</p>
                    ) : valorDinheiro ? (
                      <p className="text-[13px] text-red-700 mt-2">O valor não pode ser menor que o total ({formatCurrency(total)}).</p>
                    ) : null}
                  </div>
                ) : null}

                {mostrarCpf ? (
                  <div className="mt-3">
                    <CpfCnpjInput label="CPF/CNPJ na nota (opcional)" value={data.cpfNota} onChange={data.setCpfNota} hint="Deixe em branco se não quiser o documento na nota." />
                  </div>
                ) : (
                  <button type="button" onClick={function () { setMostrarCpf(true); }} className="h-11 flex items-center gap-1.5 text-[13px] font-bold text-[var(--cor-loja)] cursor-pointer">
                    <i className="ri-add-line text-base" />CPF na nota
                  </button>
                )}
              </section>
            ) : null}

            {/* Clube + cupom */}
            <section className="bg-white border border-stone-200/70 rounded-[18px] p-4 space-y-3">
              <ClubeCheckout
                tenantId={data.tenantId}
                itens={cart.map(function (i) { return { id: i.itemId, preco: i.precoBase, qtd: i.quantidade }; })}
                subtotal={Math.max(0, subtotal - voucherDesc)}
                onChange={data.setClubeSel}
              />
              {data.voucherCodigo ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-emerald-700 flex items-center gap-1.5"><i className="ri-coupon-3-line" />Cupom {data.voucherCodigo}</span>
                  <button type="button" onClick={data.handleRemoverVoucher} className="h-11 px-2 text-[13px] font-bold text-stone-600 cursor-pointer">Remover</button>
                </div>
              ) : mostrarCupom ? (
                <div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={data.voucherInput}
                      onChange={function (e) { data.setVoucherInput(e.target.value.toUpperCase()); }}
                      placeholder="Código do cupom"
                      aria-label="Código do cupom"
                      className={inputCls + 'flex-1 min-w-0 uppercase border-stone-300'}
                    />
                    <button
                      type="button"
                      onClick={data.handleAplicarVoucher}
                      disabled={!data.voucherInput.trim() || data.voucherLoading}
                      className="h-12 px-4 rounded-xl bg-stone-900 disabled:opacity-50 text-white text-sm font-bold cursor-pointer"
                    >
                      {data.voucherLoading ? <i className="ri-loader-4-line animate-spin" /> : 'Aplicar'}
                    </button>
                  </div>
                  {data.voucherMsg ? <p className="text-[13px] text-red-700 mt-1.5">{data.voucherMsg}</p> : null}
                </div>
              ) : (
                <button type="button" onClick={function () { setMostrarCupom(true); }} className="w-full h-11 flex items-center gap-2.5 text-left cursor-pointer">
                  <i className="ri-coupon-3-line text-lg text-[var(--cor-loja)]" />
                  <span className="flex-1 text-sm font-bold text-stone-900">Cupom de desconto</span>
                  <i className="ri-arrow-right-s-line text-xl text-stone-400" />
                </button>
              )}
            </section>

            {/* Resumo */}
            <section className="px-1 pt-1">
              <div className="flex justify-between text-sm text-stone-700 py-1"><span>Subtotal ({totalItens} {totalItens === 1 ? 'item' : 'itens'})</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between text-sm text-stone-700 py-1">
                <span>{retirada ? 'Retirada' : t('cliente.taxaEntrega')}</span>
                <span>{!taxaDefinida ? 'escolha o bairro' : retirada || taxa === 0 ? t('cliente.gratis') : formatCurrency(taxa)}</span>
              </div>
              {voucherDesc > 0 ? <div className="flex justify-between text-sm text-emerald-700 py-1"><span>Cupom</span><span>- {formatCurrency(voucherDesc)}</span></div> : null}
              {clubeDesc > 0 ? <div className="flex justify-between text-sm text-emerald-700 py-1"><span className="truncate">Clube: {data.clubeSel.nomes.join(', ')}</span><span>- {formatCurrency(clubeDesc)}</span></div> : null}
              <div className="flex justify-between text-lg font-extrabold text-stone-900 pt-2"><span>{t('cliente.total')}</span><span>{formatCurrency(total)}</span></div>
              {!data.jaAceitaOfertas ? (
                <label className="mt-2 flex items-start gap-2.5 min-h-[44px] py-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 w-5 h-5 accent-[var(--cor-loja)] cursor-pointer" checked={data.aceitaOfertas} onChange={function (e) { data.setAceitaOfertas(e.target.checked); }} />
                  <span className="text-[13px] text-stone-700 leading-snug">Quero receber ofertas e cupons da loja pelo WhatsApp.<span className="block text-xs text-stone-500">Dá para sair quando quiser respondendo SAIR.</span></span>
                </label>
              ) : null}
            </section>

            {data.error ? (
              <div role="alert" className="flex items-start gap-2 px-4 py-3 bg-red-50 rounded-xl">
                <i className="ri-error-warning-line text-red-600 text-base leading-none mt-0.5" />
                <span className="text-sm text-red-800 font-medium">{data.error}</span>
              </div>
            ) : null}
          </div>

          {/* Fazer pedido */}
          <div className="sticky bottom-0 z-20 bg-[#FBF8F4] border-t border-stone-200/70 px-4 pt-2.5 pb-4">
            <button
              type="button"
              onClick={fazerPedido}
              disabled={data.enviando || !!bloqueio}
              className={'w-full h-14 rounded-2xl text-white flex items-center justify-between px-4 text-base font-bold cursor-pointer transition-colors disabled:cursor-not-allowed ' +
                (bloqueio ? 'bg-stone-500' : 'bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] disabled:opacity-60')}
            >
              {data.enviando ? (
                <span className="flex items-center gap-2 mx-auto"><i className="ri-loader-4-line animate-spin" />Enviando pedido...</span>
              ) : (
                <>
                  <span>Fazer pedido</span>
                  <span>{formatCurrency(total)}</span>
                </>
              )}
            </button>
            <p className={'text-center text-xs mt-2 ' + (bloqueio ? 'text-red-700 font-semibold' : 'text-stone-500')}>
              {bloqueio
                ? bloqueio
                : metodo === 'pix_online' ? 'O código Pix aparece na próxima tela.'
                : metodo === 'cartao_online' ? 'Você digita o cartão na próxima tela.'
                : retirada ? 'Você paga na retirada.' : 'Você paga na entrega.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
