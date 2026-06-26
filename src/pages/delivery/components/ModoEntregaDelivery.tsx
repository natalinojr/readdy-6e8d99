interface Props {
  customerName: string;
  phone: string;
  tenantName?: string;
  onSelecionar: (modo: 'entrega' | 'retirada') => void;
  enviando: boolean;
  waUrl?: string;
}

export default function ModoEntregaDelivery(props: Props) {
  const customerName = props.customerName;
  const phone = props.phone;
  const tenantName = props.tenantName;
  const onSelecionar = props.onSelecionar;
  const enviando = props.enviando;
  const waUrl = props.waUrl;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-br from-amber-500 to-orange-500 px-4 pt-6 pb-5 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 flex items-center justify-center bg-white/30 rounded-xl">
            <i className="ri-motorbike-line text-white text-sm" />
          </div>
          <div>
            <h1 className="text-white text-lg font-black leading-tight">
              {tenantName || 'Delivery'}
            </h1>
            <p className="text-white/80 text-xs">
              {phone}
            </p>
          </div>
        </div>
        <div className="text-center">
          <h2 className="text-white text-xl font-black mb-1">
            {customerName ? 'Olá, ' + customerName + '!' : 'Como vai receber?'}
          </h2>
          <p className="text-white/80 text-sm">
            Escolha como quer receber seu pedido
          </p>
        </div>
      </div>

      {/* Opções */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-lg mx-auto w-full gap-4">
        {/* Delivery */}
        <button
          type="button"
          onClick={function () { onSelecionar('entrega'); }}
          disabled={enviando}
          className="w-full bg-white rounded-2xl border-2 border-amber-200 hover:border-amber-400 p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-amber-100/50 disabled:opacity-50 disabled:cursor-wait group"
        >
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 flex items-center justify-center bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl shrink-0 group-hover:scale-105 transition-transform">
              <i className="ri-motorbike-line text-white text-3xl" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-lg font-black text-zinc-800 mb-1">Delivery</h3>
              <p className="text-sm text-zinc-500 mb-3">
                Receba em casa. O motoboy leva até você.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full border border-amber-200/60 font-semibold">
                  <i className="ri-map-pin-line text-[10px] mr-1" />
                  Informe seu endereço
                </span>
                <span className="text-[10px] bg-zinc-50 text-zinc-500 px-2.5 py-1 rounded-full border border-zinc-100 font-semibold">
                  <i className="ri-truck-line text-[10px] mr-1" />
                  Taxa de entrega
                </span>
              </div>
            </div>
            <div className="w-8 h-8 flex items-center justify-center rounded-full bg-amber-50 group-hover:bg-amber-100 transition-colors shrink-0">
              <i className="ri-arrow-right-s-line text-amber-500 text-xl" />
            </div>
          </div>
        </button>

        {/* Retirada */}
        <button
          type="button"
          onClick={function () { onSelecionar('retirada'); }}
          disabled={enviando}
          className="w-full bg-white rounded-2xl border-2 border-green-200 hover:border-green-400 p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-green-100/50 disabled:opacity-50 disabled:cursor-wait group"
        >
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 flex items-center justify-center bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl shrink-0 group-hover:scale-105 transition-transform">
              <i className="ri-store-2-line text-white text-3xl" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-lg font-black text-zinc-800 mb-1">Retirada na loja</h3>
              <p className="text-sm text-zinc-500 mb-3">
                Você vem buscar. A cozinha prepara e espera você chegar.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] bg-green-50 text-green-700 px-2.5 py-1 rounded-full border border-green-200/60 font-semibold">
                  <i className="ri-check-line text-[10px] mr-1" />
                  Sem taxa de entrega
                </span>
                <span className="text-[10px] bg-zinc-50 text-zinc-500 px-2.5 py-1 rounded-full border border-zinc-100 font-semibold">
                  <i className="ri-time-line text-[10px] mr-1" />
                  Peça antes de chegar
                </span>
              </div>
            </div>
            <div className="w-8 h-8 flex items-center justify-center rounded-full bg-green-50 group-hover:bg-green-100 transition-colors shrink-0">
              <i className="ri-arrow-right-s-line text-green-500 text-xl" />
            </div>
          </div>
        </button>

        {/* Falar com a gente (WhatsApp) */}
        {waUrl ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-white rounded-2xl border-2 border-emerald-200 hover:border-emerald-400 p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-emerald-100/50 group block"
          >
            <div className="flex items-start gap-5">
              <div className="w-16 h-16 flex items-center justify-center bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl shrink-0 group-hover:scale-105 transition-transform">
                <i className="ri-whatsapp-line text-white text-3xl" />
              </div>
              <div className="flex-1 text-left">
                <h3 className="text-lg font-black text-zinc-800 mb-1">Falar com a gente</h3>
                <p className="text-sm text-zinc-500 mb-3">
                  Tire dúvidas direto no WhatsApp
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-200/60 font-semibold">
                    <i className="ri-chat-3-line text-[10px] mr-1" />
                    Atendimento no WhatsApp
                  </span>
                </div>
              </div>
              <div className="w-8 h-8 flex items-center justify-center rounded-full bg-emerald-50 group-hover:bg-emerald-100 transition-colors shrink-0">
                <i className="ri-arrow-right-s-line text-emerald-500 text-xl" />
              </div>
            </div>
          </a>
        ) : null}

        {enviando ? (
          <div className="flex items-center gap-2 text-amber-600 text-sm font-semibold mt-2">
            <i className="ri-loader-4-line animate-spin" />
            Preparando...
          </div>
        ) : null}
      </div>
    </div>
  );
}