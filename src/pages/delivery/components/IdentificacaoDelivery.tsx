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

  return (
    <div className="min-h-screen flex font-sans">
      {/* Left panel — desktop only */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src="https://readdy.ai/api/search-image?query=food%20delivery%20concept%20with%20scooter%20and%20brown%20paper%20bags%20on%20a%20minimalist%20warm%20beige%20background%2C%20modern%20flat%20lay%20composition%2C%20soft%20natural%20lighting%2C%20food%20delivery%20app%20aesthetic%2C%20warm%20amber%20and%20terracotta%20tones%2C%20clean%20editorial%20style&width=800&height=1200&seq=erpos-delivery-left-01&orientation=portrait"
          alt="Delivery"
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/70 via-zinc-900/50 to-amber-900/30" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-amber-500 rounded-xl">
              <i className="ri-motorbike-line text-zinc-950 text-lg" />
            </div>
            <span className="text-white font-bold text-xl tracking-wide">ERPOS V2</span>
          </div>
          <div>
            <h2 className="text-white text-3xl font-bold leading-snug mb-4">
              Peça do conforto<br />da sua casa
            </h2>
            <p className="text-zinc-300 text-sm leading-relaxed">
              Faça seu pedido online e receba em casa.
              Rápido, fácil e com taxa de entrega justa.
            </p>
            <div className="flex flex-wrap gap-2 mt-6">
              {['Delivery Rápido', 'Pedido Online', 'Pagamento na Entrega'].map(function (tag) {
                return (
                  <span key={tag} className="text-xs bg-white/10 text-white px-3 py-1 rounded-full border border-white/20">
                    {tag}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div
        className="flex-1 flex flex-col items-center px-6 py-12 relative overflow-y-auto"
        style={{
          background: 'linear-gradient(to bottom, #fef3c7 0%, #fde68a 0%, rgba(253,230,138,0.35) 18%, rgba(251,191,36,0.12) 38%, rgba(255,255,255,0.6) 60%, #ffffff 100%)',
        }}
      >
        <div className="absolute inset-x-0 top-0 h-40 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(245,158,11,0.15), transparent)' }} />

        <div className="w-full max-w-sm relative z-10">
          {props.onVoltar ? (
            <button
              type="button"
              onClick={props.onVoltar}
              className="inline-flex items-center gap-1 text-sm font-bold text-zinc-600 hover:text-zinc-800 cursor-pointer mb-4 transition-colors whitespace-nowrap"
            >
              <i className="ri-arrow-left-s-line text-lg" />
              Voltar ao cardápio
            </button>
          ) : null}

          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-500 rounded-xl">
              <i className="ri-motorbike-line text-zinc-950 text-base" />
            </div>
            <span className="text-zinc-900 font-bold text-lg tracking-wide">ERPOS V2</span>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60 shadow-xl shadow-amber-500/5 p-6 md:p-8">
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="w-7 h-7 flex items-center justify-center bg-amber-500 rounded-lg">
                <i className="ri-motorbike-line text-white text-sm" />
              </div>
              <span className="text-2xl font-black text-zinc-900">
                {tenantName || 'Delivery'}
              </span>
            </div>

            <h1 className="text-xl font-bold text-zinc-900 mb-1 text-center">
              Qual o seu celular?
            </h1>
            <p className="text-sm text-zinc-500 mb-6 text-center">
              {city ? 'Digite seu número para pedir em ' + city : 'Digite seu número para começar'}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                  Seu WhatsApp / Celular
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={phone}
                  onChange={function (e) { handleChange(e.target.value); }}
                  onKeyDown={function (e) { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder="(11) 99999-9999"
                  className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all bg-white/60"
                  maxLength={15}
                />
                <p className="text-[10px] text-zinc-400 mt-1">
                  Se já pediu antes, seus dados serão carregados automaticamente
                </p>
              </div>

              {error ? (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
                  <i className="ri-error-warning-line text-red-500 text-sm" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!isValid || enviando}
                className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:hover:bg-amber-500 text-zinc-950 font-bold py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap text-sm flex items-center justify-center gap-2"
              >
                {enviando ? (
                  <>
                    <i className="ri-loader-4-line animate-spin text-sm" />
                    Buscando...
                  </>
                ) : (
                  <>
                    <i className="ri-search-line text-sm" />
                    Buscar / Cadastrar
                  </>
                )}
              </button>
            </div>
          </div>

          <p className="text-center text-[11px] text-zinc-400 mt-6">
            Seus dados ficam salvos para o próximo pedido.
          </p>
        </div>
      </div>
    </div>
  );
}