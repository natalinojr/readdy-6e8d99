import { useState } from 'react';
import { formatCurrency } from '@/lib/formatters';
import JogosEspera from '@/components/jogos/JogosEspera';
import { ConviteAppCartao } from '@/components/fidelidade/ConviteAppClube';
import type { EtapaPedidoQR } from '../useStatusPedidoQR';

interface CartItem {
  cartId: string;
  itemId: string;
  name: string;
  precoBase: number;
  precoTotal: number;
  quantidade: number;
  opcoes: { grupoNome: string; opcaoNome: string; precoAdicional: number; opcaoId?: string }[];
  observacoes: string[];
  observacaoLivre: string;
  skipKds: boolean;
  stationId: string | null;
  subproducao?: Array<{ nome: string; estacaoId: string }>;
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

interface Props {
  accessToken: string;
  numeroPedido: string;
  onNovoPedido: () => void;
  confirmedCartItems: CartItem[];
  cardapioItems: CardapioItem[];
  /** Para os jogos (participante + senha provam o pedido; o clube identifica quem joga) */
  tenantId?: string;
  participantId?: string;
  /** Desconto do clube gravado pelo servidor neste pedido. */
  descontoClube?: number;
  /** Modo "só vai pra cozinha depois de pago" (QR universal): pedido segurado até o pagamento. `pago` = já foi para a cozinha. */
  aguardandoPagamento?: { numero: string; total: number; pago: boolean } | null;
  /** Abre o pagamento pelo celular. Ausente = a loja não tem pagamento online (só no caixa). */
  onPagarAgora?: () => void;
  /** Ainda falta pagar a conta (pedido que vai para a cozinha antes de pagar): oferece pagar já. */
  contaAberta?: boolean;
  /** Quanto falta na conta (pode somar pedidos anteriores da mesma senha/mesa). */
  faltaPagar?: number;
  /** Topo: logo e nome da loja */
  logoUrl?: string | null;
  nomeLoja?: string;
  /** Nome que o cliente deu (chamamos pela senha e pelo nome) */
  nomeCliente?: string;
  /** QR universal (retira no balcão pela senha) × mesa numerada (garçom leva) */
  queueMode?: boolean;
  mesaNumero?: number | null;
  /** Andamento real do pedido (consultado a cada poucos segundos). null = ainda não sabemos. */
  etapa?: EtapaPedidoQR | null;
}

interface Passo { nome: string; sub: string; estado: 'feito' | 'atual' | 'vem' }

export default function ConfirmacaoMesaQR(props: Props) {
  const [verItens, setVerItens] = useState(false);
  const accessToken = props.accessToken;
  const confirmedCartItems = props.confirmedCartItems;

  function getPhotoUrl(itemId: string): string | null {
    const item = props.cardapioItems.find(function (c) { return c.id === itemId; });
    return item ? item.photo_url : null;
  }

  const subtotalPedido = confirmedCartItems.reduce(function (s, i) { return s + i.precoTotal * i.quantidade; }, 0);
  const descontoClube = Math.min(props.descontoClube || 0, subtotalPedido);
  const totalPedido = Math.max(0, subtotalPedido - descontoClube);
  const qtdItens = confirmedCartItems.reduce(function (s, i) { return s + i.quantidade; }, 0);

  // Pedido segurado: aguardando = ainda não pago (não está na cozinha); pagoSegurado = pagou e já foi.
  const segurado = Boolean(props.aguardandoPagamento);
  const aguardando = segurado && !props.aguardandoPagamento?.pago;
  const pagoSegurado = segurado && Boolean(props.aguardandoPagamento?.pago);
  const totalSegurado = props.aguardandoPagamento ? props.aguardandoPagamento.total : totalPedido;

  const fila = props.queueMode !== false;
  const etapa: EtapaPedidoQR = aguardando ? 'pagamento' : (props.etapa && props.etapa !== 'pagamento' ? props.etapa : 'recebido');
  const pronto = etapa === 'pronto' || etapa === 'entregue';

  const ordem: EtapaPedidoQR[] = ['recebido', 'preparo', 'pronto'];
  const idx = etapa === 'entregue' ? 3 : Math.max(0, ordem.indexOf(etapa));
  const passos: Passo[] = [
    { nome: 'Pedido recebido', sub: props.numeroPedido ? 'Pedido #' + props.numeroPedido.slice(-4) : '' },
    { nome: 'Em preparo', sub: idx === 1 ? 'agora' : '' },
    { nome: fila ? 'Pronto — retire no balcão' : 'Pronto — já vai para a mesa', sub: fila && idx < 2 ? 'chamamos pela senha' : '' },
  ].map(function (p, i) {
    return Object.assign({}, p, { estado: (i < idx || (i === 2 && idx >= 2)) ? 'feito' : i === idx ? 'atual' : 'vem' }) as Passo;
  });

  return (
    <div className="min-h-screen bg-[#FBF8F4] flex justify-center font-sans">
      <div className="w-full max-w-lg flex flex-col">
        {/* Topo: loja */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-stone-200/70">
          <div className="w-9 h-9 rounded-full bg-white overflow-hidden flex items-center justify-center border border-stone-200 shrink-0">
            {props.logoUrl ? <img src={props.logoUrl} alt="" className="w-full h-full object-cover" /> : <i className="ri-store-2-line text-stone-500" />}
          </div>
          <p className="flex-1 min-w-0 text-[15px] font-extrabold text-stone-900 truncate">{props.nomeLoja || 'Estabelecimento'}</p>
          {!fila && props.mesaNumero ? (
            <span className="shrink-0 px-2.5 py-1 rounded-full bg-stone-100 text-stone-700 text-xs font-bold">Mesa {props.mesaNumero}</span>
          ) : null}
        </div>

        <div className="flex-1 px-4 pt-4 pb-6 space-y-3">
          {/* Senha */}
          <section
            className={'rounded-[22px] px-5 py-6 text-center border ' +
              (pronto && fila ? 'bg-emerald-700 border-emerald-700 text-white' : 'bg-white border-stone-200/70 text-stone-900')}
          >
            <p className="text-[13px] font-bold tracking-[0.08em] uppercase">
              {aguardando ? 'Sua senha · falta o pagamento' : pronto && fila ? 'Pronto! Retire no balcão' : fila ? 'Sua senha' : 'Pedido enviado'}
            </p>
            {fila ? (
              <p className="text-[96px] font-extrabold leading-none tracking-tight mt-1.5 select-all">{accessToken}</p>
            ) : (
              <p className="text-5xl font-extrabold leading-none mt-3"><i className="ri-checkbox-circle-line" /></p>
            )}
            {props.nomeCliente ? <p className="text-[17px] font-bold mt-2">{props.nomeCliente}</p> : null}
            <p className={'text-[13px] mt-1.5 leading-relaxed ' + (pronto && fila ? 'text-emerald-50' : 'text-stone-600')}>
              {aguardando
                ? 'Seu pedido vai para a cozinha assim que o pagamento for confirmado.'
                : pronto && fila
                  ? 'Mostre esta tela no balcão.'
                  : fila
                    ? 'Fique de olho no painel. Chamamos pela senha.'
                    : 'Sua senha para ver os pedidos e pagar a conta: ' + accessToken}
            </p>
          </section>

          {/* Pedido segurado: falta pagar */}
          {aguardando ? (
            <section className="bg-white border-2 border-amber-300 rounded-[18px] p-4">
              <p className="text-base font-extrabold text-stone-900">Falta o pagamento</p>
              {props.onPagarAgora ? (
                <>
                  <button
                    type="button"
                    onClick={props.onPagarAgora}
                    className="mt-3 w-full h-14 rounded-2xl bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] text-white flex items-center justify-between px-4 text-base font-bold cursor-pointer"
                  >
                    <span>Pagar agora</span>
                    <span>{formatCurrency(totalSegurado)}</span>
                  </button>
                  <p className="text-[13px] text-stone-600 mt-2.5 text-center">
                    ou pague no caixa informando a senha <strong className="text-stone-900">{accessToken}</strong>
                  </p>
                </>
              ) : (
                <p className="text-sm text-stone-700 mt-2">
                  Pague no caixa informando a senha <strong className="text-stone-900">{accessToken}</strong>.
                </p>
              )}
            </section>
          ) : null}

          {/* Pedido já na cozinha e a loja aceita pagar pelo celular: pagar agora e não passar no caixa */}
          {!segurado && props.onPagarAgora && props.contaAberta ? (
            <section className="bg-white border border-stone-200/70 rounded-[18px] p-4">
              <p className="text-base font-extrabold text-stone-900">Quer já deixar pago?</p>
              <p className="text-[13px] text-stone-600 mt-0.5">
                {fila ? 'Pague pelo celular e só retire no balcão, sem passar no caixa.' : 'Pague pelo celular e não precisa esperar a conta.'}
              </p>
              <button
                type="button"
                onClick={props.onPagarAgora}
                className="mt-3 w-full h-14 rounded-2xl bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] text-white flex items-center justify-between px-4 text-base font-bold cursor-pointer"
              >
                <span className="flex items-center gap-2"><i className="ri-secure-payment-line text-lg" />Pagar agora</span>
                {fila && props.faltaPagar && props.faltaPagar > 0 ? <span>{formatCurrency(props.faltaPagar)}</span> : null}
              </button>
              <p className="text-[12px] text-stone-500 mt-2 text-center">Pix ou cartão. Se preferir, pague depois no caixa.</p>
            </section>
          ) : null}

          {/* Andamento */}
          {!aguardando ? (
            <section className="bg-white border border-stone-200/70 rounded-[18px] p-4">
              {passos.map(function (p, i) {
                const ultimo = i === passos.length - 1;
                return (
                  <div key={p.nome} className="flex gap-3">
                    <div className="flex flex-col items-center shrink-0">
                      <span className={'w-[26px] h-[26px] rounded-full border-2 flex items-center justify-center ' +
                        (p.estado === 'feito' ? 'bg-emerald-700 border-emerald-700 text-white' : p.estado === 'atual' ? 'bg-white border-[var(--cor-loja)]' : 'bg-white border-stone-300')}>
                        {p.estado === 'feito' ? <i className="ri-check-line text-sm" /> : p.estado === 'atual' ? <span className="w-2.5 h-2.5 rounded-full bg-[var(--cor-loja)] animate-pulse" /> : null}
                      </span>
                      {!ultimo ? <span className={'w-0.5 h-7 ' + (p.estado === 'feito' ? 'bg-emerald-700' : 'bg-stone-200')} /> : null}
                    </div>
                    <div className="pt-0.5 pb-2.5 min-w-0">
                      <p className={'text-[15px] ' + (p.estado === 'atual' ? 'font-extrabold text-stone-900' : p.estado === 'feito' ? 'font-semibold text-stone-700' : 'font-semibold text-stone-500')}>{p.nome}</p>
                      {p.sub ? <p className="text-xs text-stone-500 mt-0.5">{p.sub}</p> : null}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-stone-500 border-t border-stone-100 pt-2.5 mt-1">
                Esta tela muda sozinha.{pagoSegurado ? ' Pagamento confirmado.' : ''}
              </p>
            </section>
          ) : null}

          {!aguardando ? <ConviteAppCartao tenantId={props.tenantId} motivo="Os pontos deste pedido aparecem no app. Abre em 1 toque e avisa quando ganhar prêmio." /> : null}

          {/* Joguinhos enquanto a comida fica pronta (só depois que o pedido foi para a cozinha) */}
          {!aguardando && !pronto ? (
            <JogosEspera
              tenantId={props.tenantId}
              credencial={props.participantId ? { tipo: 'mesa', participant_id: props.participantId, access_token: accessToken } : null}
              onNovoPedido={props.onNovoPedido}
            />
          ) : null}

          {/* Itens do pedido (fechado por padrão) */}
          {confirmedCartItems.length > 0 ? (
            <section className="bg-white border border-stone-200/70 rounded-[18px] overflow-hidden">
              <button
                type="button"
                onClick={function () { setVerItens(!verItens); }}
                aria-expanded={verItens}
                className="w-full flex items-center justify-between gap-3 px-4 h-14 text-left cursor-pointer"
              >
                <span className="text-sm font-bold text-stone-900">{qtdItens} {qtdItens === 1 ? 'item' : 'itens'} · {formatCurrency(totalPedido)}</span>
                <span className="text-[13px] font-bold text-[var(--cor-loja)] flex items-center gap-1">
                  {verItens ? 'Esconder' : 'Ver itens'}
                  <i className={'ri-arrow-down-s-line text-lg transition-transform ' + (verItens ? 'rotate-180' : '')} />
                </span>
              </button>
              {verItens ? (
                <div className="border-t border-stone-100">
                  {confirmedCartItems.map(function (ci) {
                    const photoUrl = getPhotoUrl(ci.itemId);
                    const det = ci.opcoes.map(function (o) { return o.opcaoNome; }).concat(ci.observacoes || []).join(', ');
                    return (
                      <div key={ci.cartId} className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 last:border-b-0">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-stone-100 shrink-0 flex items-center justify-center">
                          {photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <i className="ri-restaurant-2-line text-stone-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-stone-900 truncate">{ci.quantidade > 1 ? ci.quantidade + '× ' : ''}{ci.name}</p>
                          {det ? <p className="text-xs text-stone-500 truncate">{det}</p> : null}
                          {ci.observacaoLivre ? <p className="text-xs text-stone-500 truncate">"{ci.observacaoLivre}"</p> : null}
                        </div>
                        <p className="text-sm font-bold text-stone-900 whitespace-nowrap">{formatCurrency(ci.precoTotal * ci.quantidade)}</p>
                      </div>
                    );
                  })}
                  {descontoClube > 0 ? (
                    <div className="flex items-center justify-between px-4 py-2.5 border-t border-stone-100">
                      <p className="text-xs font-bold text-emerald-700">Prêmio do clube</p>
                      <p className="text-sm font-bold text-emerald-700">- {formatCurrency(descontoClube)}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          <button
            type="button"
            onClick={props.onNovoPedido}
            className="w-full h-[52px] rounded-2xl border border-stone-300 bg-white text-stone-900 flex items-center justify-center gap-2 text-[15px] font-bold cursor-pointer hover:bg-stone-50"
          >
            <i className="ri-add-line text-lg" />
            Pedir mais alguma coisa
          </button>
          <p className="text-center text-xs text-stone-500">Você pode fazer quantos pedidos quiser com a mesma senha.</p>
        </div>
      </div>
    </div>
  );
}
