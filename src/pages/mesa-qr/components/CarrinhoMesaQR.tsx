import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/formatters';
import ClubeCheckout, { type ClubeSelecao } from '@/components/fidelidade/ClubeCheckout';

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

interface Props {
  cart: CartItem[];
  onAlterarQtd: (cartId: string, delta: number) => void;
  onRemover: (cartId: string) => void;
  onEditar: (cartId: string) => void;
  /** Envia o pedido com o nome digitado (cria a senha no 1º pedido). */
  onConfirmar: (nome: string) => void;
  enviando: boolean;
  error: string;
  onVoltar: () => void;
  /** Quem já pediu antes nesta visita (senha criada): não pergunta o nome de novo. */
  participante?: { name: string; access_token: string } | null;
  /** Nome usado da última vez neste aparelho (pré-preenche o campo). */
  nomeSalvo?: string;
  /** QR universal (fila por senha) × mesa numerada — só muda o subtítulo. */
  subtitulo?: string;
  /** Foto do item no cardápio (miniatura na sacola). */
  fotoDe?: (itemId: string) => string | null;
  /** Clube de fidelidade (opcional): loja, desconto dos prêmios reservados e retorno da seleção. */
  tenantId?: string | null;
  clubeDesconto?: number;
  clubeNomes?: string[];
  onClube?: (sel: ClubeSelecao) => void;
}

export default function CarrinhoMesaQR(props: Props) {
  const { t } = useTranslation();
  const cart = props.cart;
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [nome, setNome] = useState(props.nomeSalvo || '');
  const [tentou, setTentou] = useState(false);

  const subtotal = cart.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);
  const clubeDesc = Math.min(props.clubeDesconto || 0, subtotal);
  const total = Math.max(0, subtotal - clubeDesc);
  const precisaNome = !props.participante;
  const nomeFaltando = precisaNome && !nome.trim();

  function handleRemover(cartId: string) {
    setRemovendo(cartId);
    setTimeout(function () {
      props.onRemover(cartId);
      setRemovendo(null);
    }, 250);
  }

  function confirmar() {
    if (nomeFaltando) {
      setTentou(true);
      const el = document.getElementById('qr-nome-cliente');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); (el as HTMLInputElement).focus(); }
      return;
    }
    props.onConfirmar(nome.trim());
  }

  return (
    <div className="min-h-full flex flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-200/70">
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
          {props.subtitulo ? <p className="text-xs text-stone-500 truncate">{props.subtitulo}</p> : null}
        </div>
      </div>

      {cart.length === 0 ? (
        <div className="text-center py-16 flex flex-col items-center px-4">
          <div className="w-16 h-16 flex items-center justify-center bg-stone-100 rounded-2xl mb-4">
            <i className="ri-shopping-bag-3-line text-2xl text-stone-300" />
          </div>
          <p className="text-sm font-bold text-stone-700">Sua sacola está vazia</p>
          <p className="text-xs text-stone-500 mt-1">Adicione itens do cardápio para começar</p>
          <button
            type="button"
            onClick={props.onVoltar}
            className="mt-4 h-11 px-4 text-sm text-[var(--cor-loja)] font-bold cursor-pointer"
          >
            {t('cliente.voltarCardapio')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 px-4 pt-3.5 pb-4 space-y-3">
            {/* Itens */}
            <section className="bg-white border border-stone-200/70 rounded-[18px] px-3.5 pt-1 pb-1">
              {cart.map(function (item) {
                const foto = props.fotoDe ? props.fotoDe(item.itemId) : null;
                const detalhes = item.opcoes.map(function (o) { return o.opcaoNome; })
                  .concat(item.observacoes)
                  .concat(item.observacaoLivre ? ['"' + item.observacaoLivre + '"'] : [])
                  .join(' · ');
                return (
                  <div
                    key={item.cartId}
                    className={'flex gap-3 items-center py-3 border-b border-stone-100 last:border-b-0 transition-all duration-200 ' +
                      (removendo === item.cartId ? 'opacity-0 translate-x-4' : '')}
                  >
                    <div className="w-[52px] h-[52px] rounded-xl bg-stone-100 overflow-hidden shrink-0 flex items-center justify-center">
                      {foto ? <img src={foto} alt="" className="w-full h-full object-cover" loading="lazy" /> : <i className="ri-restaurant-2-line text-stone-400" />}
                    </div>
                    <button
                      type="button"
                      onClick={function () { props.onEditar(item.cartId); }}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <span className="block text-sm font-bold text-stone-900 leading-snug break-words">{item.name}</span>
                      {detalhes ? <span className="block text-xs text-stone-500 mt-0.5 line-clamp-2">{detalhes}</span> : null}
                      <span className="block text-sm font-bold text-stone-900 mt-1">{formatCurrency(item.precoTotal * item.quantidade)}</span>
                    </button>
                    <div className="shrink-0 flex items-center h-11 rounded-xl border border-stone-300">
                      <button
                        type="button"
                        aria-label={item.quantidade === 1 ? 'Tirar da sacola' : 'Diminuir'}
                        onClick={function () { if (item.quantidade === 1) handleRemover(item.cartId); else props.onAlterarQtd(item.cartId, -1); }}
                        className="w-9 h-11 flex items-center justify-center text-stone-900 cursor-pointer"
                      >
                        <i className={item.quantidade === 1 ? 'ri-delete-bin-line text-[15px]' : 'ri-subtract-line'} />
                      </button>
                      <span className="min-w-[16px] text-center text-sm font-bold">{item.quantidade}</span>
                      <button
                        type="button"
                        aria-label="Aumentar"
                        onClick={function () { props.onAlterarQtd(item.cartId, 1); }}
                        className="w-9 h-11 flex items-center justify-center text-stone-900 cursor-pointer"
                      >
                        <i className="ri-add-line" />
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={props.onVoltar}
                className="w-full flex items-center gap-2 h-12 text-sm font-bold text-[var(--cor-loja)] cursor-pointer"
              >
                <i className="ri-add-line text-lg" />
                Adicionar mais itens
              </button>
            </section>

            {/* Nome (só no 1º pedido) */}
            {precisaNome ? (
              <section className="bg-white border border-stone-200/70 rounded-[18px] p-4">
                <label htmlFor="qr-nome-cliente" className="block text-base font-extrabold text-stone-900">Como chamamos você?</label>
                <input
                  id="qr-nome-cliente"
                  type="text"
                  autoComplete="given-name"
                  value={nome}
                  onChange={function (e) { setNome(e.target.value); }}
                  placeholder={t('cliente.seuNome')}
                  maxLength={40}
                  className={'mt-2.5 w-full h-12 px-3.5 rounded-xl border bg-white text-[15px] text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[color:var(--cor-loja-suave)] ' +
                    (tentou && nomeFaltando ? 'border-red-500' : 'border-stone-300 focus:border-[var(--cor-loja)]')}
                />
                <p className={'text-xs mt-2 ' + (tentou && nomeFaltando ? 'text-red-700 font-semibold' : 'text-stone-500')}>
                  {tentou && nomeFaltando ? 'Digite seu nome para fazer o pedido.' : 'Chamamos pela senha e pelo seu nome. Fica salvo para o próximo pedido.'}
                </p>
              </section>
            ) : (
              <section className="bg-white border border-stone-200/70 rounded-[18px] px-4 py-3 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-[var(--cor-loja-suave)] text-[var(--cor-loja)] flex items-center justify-center shrink-0">
                  <i className="ri-user-3-line text-lg" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs text-stone-500">Pedindo como</span>
                  <span className="block text-sm font-bold text-stone-900 truncate">{props.participante!.name}</span>
                </span>
                <span className="shrink-0 px-2.5 py-1 rounded-lg bg-stone-900 text-white text-sm font-black tracking-wide">
                  {props.participante!.access_token}
                </span>
              </section>
            )}

            {/* Clube + total */}
            <section className="bg-white border border-stone-200/70 rounded-[18px] p-4 space-y-3">
              {props.onClube ? (
                <ClubeCheckout
                  tenantId={props.tenantId}
                  itens={cart.map(function (i) { return { id: i.itemId, preco: i.precoBase, qtd: i.quantidade }; })}
                  subtotal={subtotal}
                  onChange={props.onClube}
                />
              ) : null}
              {clubeDesc > 0 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-700 min-w-0 truncate">Clube: {(props.clubeNomes || []).join(', ')}</span>
                  <span className="text-emerald-700 font-bold whitespace-nowrap">- {formatCurrency(clubeDesc)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-base font-extrabold text-stone-900">{t('cliente.total')}</span>
                <span className="text-lg font-extrabold text-stone-900">{formatCurrency(total)}</span>
              </div>
            </section>

            {props.error ? (
              <div className="flex items-start gap-2 px-4 py-3 bg-red-50 rounded-xl">
                <i className="ri-error-warning-line text-red-600 text-base leading-none mt-0.5" />
                <span className="text-sm text-red-800 font-medium">{props.error}</span>
              </div>
            ) : null}
          </div>

          {/* Fazer pedido */}
          <div className="sticky bottom-0 bg-[#FBF8F4] border-t border-stone-200/70 px-4 pt-2.5 pb-4">
            <button
              type="button"
              onClick={confirmar}
              disabled={props.enviando}
              className="w-full h-14 rounded-2xl bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] disabled:opacity-60 text-white flex items-center justify-between px-4 text-base font-bold cursor-pointer transition-colors"
            >
              {props.enviando ? (
                <span className="flex items-center gap-2 mx-auto"><i className="ri-loader-4-line animate-spin" />Enviando pedido...</span>
              ) : (
                <>
                  <span>Fazer pedido</span>
                  <span>{formatCurrency(total)}</span>
                </>
              )}
            </button>
            {precisaNome ? (
              <p className="text-center text-xs text-stone-500 mt-2">Sua senha aparece na próxima tela.</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
