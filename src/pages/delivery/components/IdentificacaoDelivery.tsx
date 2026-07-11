interface Props {
  phone: string;
  onPhoneChange: (v: string) => void;
  onBuscar: () => void;
  enviando: boolean;
  error: string;
  city?: string;
  tenantName?: string;
  /** Volta para a vitrine/cardápio (quando o cliente chegou pela tela de preview). */
  onVoltar?: () => void;
}

export default function IdentificacaoDelivery(props: Props) {
  const phone = props.phone;
  const onPhoneChange = props.onPhoneChange;
  const onBuscar = props.onBuscar;
  const enviando = props.enviando;
  const error = props.error;
  const city = props.city;
  const tenantName = props.tenantName;

  function formatPhone(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2);
    return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7);
  }

  function handleChange(val: string) {
    onPhoneChange(formatPhone(val));
  }

  function handleSubmit() {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return;
    onBuscar();
  }

  const digitsOnly = phone.replace(/\D/g, '');
  const isValid = digitsOnly.length >= 10;

  // Iniciais da loja para o "logo" (mesma linguagem do header do cardápio / modo de entrega)
  const iniciais = (tenantName || 'DL')
    .split(/\s+/)
    .slice(0, 2)
    .map(function (w) { return w.charAt(0); })
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Hero gradiente — mesma identidade do header do cardápio / modo de entrega */}
      <div className="relative bg-gradient-to-br from-amber-500 via-orange-500 to-orange-600 px-4 pt-6 pb-14 shrink-0">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 85% -20%, rgba(255,255,255,.25), transparent 45%)' }}
        />

        {props.onVoltar ? (
          <button
            type="button"
            onClick={props.onVoltar}
            className="relative z-10 inline-flex items-center gap-0.5 text-white/90 hover:text-white text-xs font-bold cursor-pointer transition-colors mb-3 max-w-lg mx-auto w-full"
          >
            <i className="ri-arrow-left-s-line text-base" />
            Voltar ao cardápio
          </button>
        ) : null}

        <div className="relative flex items-center gap-3 max-w-lg mx-auto w-full">
          <div className="w-10 h-10 flex items-center justify-center bg-white rounded-2xl shadow-md shrink-0">
            <span className="text-orange-600 font-black text-sm">{iniciais}</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-white text-sm font-black leading-tight truncate">{tenantName || 'Delivery'}</h1>
            <p className="text-white/80 text-[11px]">Peça online</p>
          </div>
        </div>
        <div className="relative text-center mt-5">
          <h2 className="text-white text-xl font-black">Qual o seu celular?</h2>
          <p className="text-white/85 text-xs mt-1">
            {city ? 'Para receber seu pedido em ' + city : 'Digite seu número para começar'}
          </p>
        </div>
      </div>

      {/* Sheet branca sobreposta */}
      <div className="flex-1 -mt-8 relative z-10 bg-white rounded-t-3xl px-4 pt-5 pb-8">
        <div className="w-10 h-1 bg-zinc-200 rounded-full mx-auto mb-5" />

        <div className="max-w-lg mx-auto w-full">
          <div className="mb-4">
            <label className="block text-xs font-bold text-zinc-600 mb-1.5">
              Seu WhatsApp / Celular <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              value={phone}
              onChange={function (e) { handleChange(e.target.value); }}
              onKeyDown={function (e) { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="(11) 99999-9999"
              maxLength={15}
              className="w-full px-3.5 py-2.5 text-sm border-[1.5px] border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
            />
            <p className="text-[11px] text-zinc-400 mt-1.5">
              Se já pediu antes, seus dados são carregados automaticamente.
            </p>
          </div>

          {error ? (
            <div className="flex items-center gap-2 px-3 py-2.5 mb-4 bg-red-50 border border-red-100 rounded-2xl">
              <i className="ri-error-warning-line text-red-500 text-sm" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || enviando}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-black cursor-pointer transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ boxShadow: '0 6px 16px rgba(245,158,11,.35)' }}
          >
            {enviando ? (
              <>
                <i className="ri-loader-4-line animate-spin" />
                Buscando...
              </>
            ) : (
              <>
                Continuar
                <i className="ri-arrow-right-line" />
              </>
            )}
          </button>

          <p className="text-center text-[10.5px] text-zinc-400 mt-3">
            <i className="ri-lock-line mr-0.5" />
            Seus dados ficam salvos para agilizar o próximo pedido.
          </p>
        </div>
      </div>
    </div>
  );
}