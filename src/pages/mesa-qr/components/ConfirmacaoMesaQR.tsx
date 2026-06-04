interface Props {
  accessToken: string;
  numeroPedido: string;
  onNovoPedido: () => void;
}

export default function ConfirmacaoMesaQR({ accessToken, numeroPedido, onNovoPedido }: Props) {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-xs text-center">
        {/* Brand */}
        <div className="mb-8">
          <div className="w-12 h-12 flex items-center justify-center mx-auto mb-3 bg-zinc-900 rounded-xl">
            <i className="ri-restaurant-2-line text-xl text-amber-400" />
          </div>
          <h1 className="text-sm font-black text-zinc-900 tracking-tight">ERPOS</h1>
          <p className="text-[10px] text-zinc-400">Cardápio digital</p>
        </div>

        <div className="w-20 h-20 flex items-center justify-center mx-auto mb-6 bg-emerald-50 rounded-2xl border border-emerald-100">
          <i className="ri-checkbox-circle-line text-4xl text-emerald-500" />
        </div>

        <h2 className="text-xl font-black text-zinc-800 mb-2">Pedido confirmado!</h2>

        <div className="bg-white rounded-xl border border-emerald-100 p-5 mb-4">
          <div className="mb-4">
            <p className="text-xs text-zinc-500 mb-1">Sua senha</p>
            <p className="text-3xl font-black text-emerald-600 tracking-wider">{accessToken}</p>
            <p className="text-[10px] text-zinc-400 mt-1">
              Guarde-a para retirar seus pedidos.
            </p>
          </div>

          {numeroPedido && (
            <div className="pt-3 border-t border-zinc-100">
              <p className="text-xs text-zinc-500 mb-1">Número do pedido</p>
              <p className="text-lg font-bold text-zinc-800">{numeroPedido}</p>
            </div>
          )}
        </div>

        <p className="text-sm text-zinc-500 leading-relaxed mb-6">
          Seu pedido foi enviado para a cozinha. Aguarde ser chamado pela senha.
        </p>

        <button
          onClick={onNovoPedido}
          className="w-full bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-bold py-3 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
        >
          Fazer outro pedido
        </button>

        <p className="text-[10px] text-zinc-400 mt-3">
          Você pode fazer quantos pedidos quiser com a mesma senha.
        </p>
      </div>
    </div>
  );
}