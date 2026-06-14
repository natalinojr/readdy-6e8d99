import { useState, useEffect } from 'react';

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
}

export default function ConfirmacaoMesaQR(props: Props) {
  const accessToken = props.accessToken;
  const numeroPedido = props.numeroPedido;
  const onNovoPedido = props.onNovoPedido;
  const confirmedCartItems = props.confirmedCartItems;
  const cardapioItems = props.cardapioItems;

  const [visible, setVisible] = useState(false);

  useEffect(function () {
    const t = setTimeout(function () { setVisible(true); }, 100);
    return function () { clearTimeout(t); };
  }, []);

  function getPhotoUrl(itemId: string): string | null {
    const item = cardapioItems.find(function (c) { return c.id === itemId; });
    return item ? item.photo_url : null;
  }

  const totalPedido = confirmedCartItems.reduce(function (s, i) {
    return s + i.precoTotal * i.quantidade;
  }, 0);

  return (
    <div className="min-h-screen flex flex-col items-center font-sans relative overflow-hidden px-4 py-8"
      style={{
        background: 'linear-gradient(to bottom, #fef3c7 0%, #fde68a 0%, rgba(253,230,138,0.35) 18%, rgba(251,191,36,0.12) 38%, rgba(255,255,255,0.6) 60%, #ffffff 100%)',
      }}
    >
      <div className="absolute inset-x-0 top-0 h-40 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(245,158,11,0.15), transparent)' }} />

      <div className={'w-full max-w-md flex flex-col items-center text-center z-10 transition-all duration-700 ' + (visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0')}>
        {/* Badge confirmado */}
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full mb-6 shadow-lg shadow-green-500/20">
          <i className="ri-checkbox-circle-line text-white text-sm" />
          <span className="text-white text-xs font-bold uppercase tracking-wider">Pedido Confirmado</span>
        </div>

        {/* Senha gigante */}
        <div className="bg-gradient-to-br from-amber-500 via-orange-500 to-orange-600 rounded-3xl p-8 md:p-10 w-full shadow-2xl shadow-orange-500/20 relative overflow-hidden mb-6">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full" />
          <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-white/10 rounded-full" />

          <div className="relative z-10">
            <div className="flex items-center justify-center gap-2 mb-4">
              <i className="ri-lock-password-line text-white/80 text-lg" />
              <p className="text-white/80 text-sm font-semibold uppercase tracking-[0.15em]">Sua Senha</p>
            </div>
            <p className="text-6xl md:text-7xl lg:text-8xl font-black text-white tracking-[0.15em] leading-none mb-3 select-all">
              {accessToken}
            </p>
            <p className="text-white/70 text-sm leading-relaxed max-w-xs mx-auto">
              Guarde esta senha para retirar seus pedidos no balcão quando ficarem prontos.
            </p>
          </div>
        </div>

        {/* Número do pedido */}
        {numeroPedido ? (
          <div className="flex items-center gap-3 px-5 py-4 bg-white/80 backdrop-blur-sm rounded-2xl border border-zinc-100 shadow-sm w-full transition-all duration-500 delay-200" style={visible ? { transform: 'translateY(0)', opacity: 1 } : { transform: 'translateY(12px)', opacity: 0 }}>
            <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl flex-shrink-0">
              <i className="ri-receipt-line text-zinc-500 text-lg" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Nº do Pedido</p>
              <p className="text-lg font-black text-zinc-800">{numeroPedido}</p>
            </div>
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200">
              <i className="ri-send-plane-line text-[10px]" />
              Enviado
            </span>
          </div>
        ) : null}

        {/* Itens do pedido com foto */}
        {confirmedCartItems.length > 0 ? (
          <div className="w-full mt-6 transition-all duration-500 delay-300" style={visible ? { transform: 'translateY(0)', opacity: 1 } : { transform: 'translateY(12px)', opacity: 0 }}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <i className="ri-restaurant-line text-zinc-400 text-sm" />
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider text-left">Itens do Pedido</p>
            </div>
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">
              {confirmedCartItems.map(function (ci, idx) {
                const photoUrl = getPhotoUrl(ci.itemId);
                const isLast = idx === confirmedCartItems.length - 1;
                return (
                  <div key={ci.cartId} className={'flex items-start gap-3 p-4 ' + (isLast ? '' : 'border-b border-zinc-100')}>
                    {/* Foto do item */}
                    <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-zinc-100 border border-zinc-100">
                      {photoUrl ? (
                        <img
                          src={photoUrl}
                          alt={ci.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <i className="ri-image-line text-zinc-300 text-xl" />
                        </div>
                      )}
                    </div>
                    {/* Detalhes */}
                    <div className="flex-1 text-left min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-zinc-800 truncate">
                            {ci.quantidade > 1 ? ci.quantidade + '× ' : ''}{ci.name}
                          </p>
                          {ci.opcoes.length > 0 ? (
                            <p className="text-xs text-zinc-500 mt-0.5 truncate">
                              {ci.opcoes.map(function (o) { return o.opcaoNome; }).join(', ')}
                            </p>
                          ) : null}
                          {ci.observacaoLivre ? (
                            <p className="text-xs text-zinc-400 mt-0.5 truncate">"{ci.observacaoLivre}"</p>
                          ) : null}
                        </div>
                        <p className="text-sm font-bold text-amber-600 whitespace-nowrap">
                          R$ {(ci.precoTotal * ci.quantidade).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Total */}
              <div className="flex items-center justify-between px-4 py-3 bg-zinc-50/80 border-t border-zinc-100">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Total</p>
                <p className="text-base font-black text-amber-600">R$ {totalPedido.toFixed(2)}</p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Timeline simples */}
        <div className="flex items-center gap-1 mt-6 text-[11px] text-zinc-400 font-medium">
          <span className="flex items-center gap-1.5 font-bold text-emerald-600">
            <i className="ri-check-fill text-xs" />Enviado
          </span>
          <i className="ri-arrow-right-s-line text-sm text-zinc-300" />
          <span className="flex items-center gap-1.5 text-zinc-400">
            <i className="ri-checkbox-blank-circle-line text-[10px]" />Preparando
          </span>
          <i className="ri-arrow-right-s-line text-sm text-zinc-300" />
          <span className="flex items-center gap-1.5 text-zinc-400">
            <i className="ri-checkbox-blank-circle-line text-[10px]" />Pronto
          </span>
        </div>

        {/* Botão novo pedido */}
        <button
          type="button"
          onClick={onNovoPedido}
          className="mt-8 w-full flex items-center justify-center gap-2 bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold py-3.5 rounded-xl cursor-pointer transition-all shadow-lg shadow-orange-500/20 whitespace-nowrap text-sm"
          style={visible ? { transform: 'translateY(0)', opacity: 1 } : { transform: 'translateY(12px)', opacity: 0 }}
        >
          <i className="ri-add-line text-base" />
          Fazer outro pedido
        </button>

        <p className="text-center text-xs text-zinc-400 mt-3" style={visible ? { opacity: 1 } : { opacity: 0 }}>
          Você pode fazer quantos pedidos quiser com a mesma senha.
        </p>
      </div>
    </div>
  );
}