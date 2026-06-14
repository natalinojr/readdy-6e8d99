import { useState } from 'react';

interface Props {
  mesaNumero: number;
  tenantName?: string;
  isUniversal?: boolean;
  onConfirmar: (nome: string) => void;
  error: string;
}

export default function IdentificacaoMesaQR(props: Props) {
  const mesaNumero = props.mesaNumero;
  const tenantName = props.tenantName;
  const isUniversal = props.isUniversal;
  const onConfirmar = props.onConfirmar;
  const error = props.error;

  const [nome, setNome] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit() {
    const trimmed = nome.trim();
    if (!trimmed) return;
    setEnviando(true);
    await onConfirmar(trimmed);
    setEnviando(false);
  }

  return (
    <div className="min-h-screen flex font-sans">
      {/* Left panel — desktop only */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src="https://readdy.ai/api/search-image?query=elegant%20restaurant%20interior%20with%20warm%20amber%20lighting%2C%20wooden%20tables%20set%20for%20dinner%2C%20soft%20bokeh%20background%2C%20professional%20fine%20dining%20atmosphere%2C%20cozy%20and%20inviting%20ambiance%2C%20rich%20warm%20tones&width=800&height=1200&seq=erpos-mesa-qr-01&orientation=portrait"
          alt="Restaurant"
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/80 via-zinc-900/60 to-amber-900/40" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-amber-500 rounded-xl">
              <i className="ri-restaurant-2-line text-zinc-950 text-lg" />
            </div>
            <span className="text-white font-bold text-xl tracking-wide">ERPOS V2</span>
          </div>
          <div>
            <h2 className="text-white text-3xl font-bold leading-snug mb-4">
              Bem-vindo ao<br />nosso cardápio
            </h2>
            <p className="text-zinc-300 text-sm leading-relaxed">
              Peça direto da mesa, sem precisar chamar o garçom.
              Acompanhe o status do seu pedido em tempo real.
            </p>
            <div className="flex flex-wrap gap-2 mt-6">
              {['Cardápio Digital', 'Pedido Rápido', 'Pagamento Fácil'].map(function (tag) {
                return (
                  <span
                    key={tag}
                    className="text-xs bg-white/10 text-white px-3 py-1 rounded-full border border-white/20"
                  >
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
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-500 rounded-xl">
              <i className="ri-restaurant-2-line text-zinc-950 text-base" />
            </div>
            <span className="text-zinc-900 font-bold text-lg tracking-wide">ERPOS V2</span>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60 shadow-xl shadow-amber-500/5 p-6 md:p-8">
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="w-7 h-7 flex items-center justify-center bg-amber-500 rounded-lg">
                {isUniversal ? (
                  <i className="ri-store-2-line text-white text-sm" />
                ) : (
                  <i className="ri-table-2 text-white text-sm" />
                )}
              </div>
              <span className="text-2xl font-black text-zinc-900">
                {tenantName || (isUniversal ? 'Balcão de Retirada' : 'Mesa ' + mesaNumero)}
              </span>
            </div>

            <h1 className="text-xl font-bold text-zinc-900 mb-1 text-center">
              Como devemos chamar você?
            </h1>
            <p className="text-sm text-zinc-500 mb-6 text-center">
              Digite seu nome para começar a pedir
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                  Seu nome
                </label>
                <input
                  type="text"
                  value={nome}
                  onChange={function (e) { setNome(e.target.value); }}
                  onKeyDown={function (e) { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder="Ex: João"
                  className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all bg-white/60"
                  maxLength={50}
                />
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
                disabled={!nome.trim() || enviando}
                className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:hover:bg-amber-500 text-zinc-950 font-bold py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap text-sm flex items-center justify-center gap-2"
              >
                {enviando ? (
                  <>
                    <i className="ri-loader-4-line animate-spin text-sm" />
                    Entrando...
                  </>
                ) : (
                  <>
                    <i className="ri-arrow-right-line text-sm" />
                    Entrar no cardápio
                  </>
                )}
              </button>
            </div>
          </div>

          <p className="text-center text-[11px] text-zinc-400 mt-6">
            Não precisa fazer login. É só digitar seu nome e começar.
          </p>
        </div>
      </div>
    </div>
  );
}