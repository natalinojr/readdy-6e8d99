interface DestinoKioskProps {
  onSelecionar: (destino: 'aqui' | 'viagem') => void;
  onVoltar: () => void;
}

export default function DestinoKiosk({ onSelecionar, onVoltar }: DestinoKioskProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-zinc-950 p-10">
      {/* Back */}
      <button
        onClick={onVoltar}
        className="absolute top-24 left-8 flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-sm font-semibold cursor-pointer transition-colors"
      >
        <i className="ri-arrow-left-line" />
        Voltar
      </button>

      <div className="text-center mb-14">
        <h2 className="text-7xl font-black text-white mb-3">
          Vai comer aqui ou<br />
          <span className="text-amber-400">para levar?</span>
        </h2>
        <p className="text-zinc-400 text-3xl">Escolha como prefere receber seu pedido</p>
      </div>

      <div className="grid grid-cols-2 gap-8 w-full max-w-3xl">
        {/* Para comer aqui */}
        <button
          onClick={() => onSelecionar('aqui')}
          className="group flex flex-col items-center gap-8 bg-zinc-800 hover:bg-zinc-700 border-2 border-zinc-700 hover:border-amber-500 text-white p-14 rounded-3xl cursor-pointer active:scale-95 transition-all"
        >
          <div className="w-36 h-36 flex items-center justify-center bg-zinc-700 group-hover:bg-amber-500/20 rounded-3xl transition-colors">
            <i className="ri-store-2-line text-7xl text-zinc-400 group-hover:text-amber-400 transition-colors" />
          </div>
          <div className="text-center">
            <p className="text-4xl font-black mb-2">Comer aqui</p>
            <p className="text-zinc-500 text-lg group-hover:text-zinc-400 transition-colors">
              Retire no balcão e aproveite no salão
            </p>
          </div>
        </button>

        {/* Para viagem */}
        <button
          onClick={() => onSelecionar('viagem')}
          className="group flex flex-col items-center gap-8 bg-amber-500 hover:bg-amber-400 text-zinc-950 p-14 rounded-3xl cursor-pointer active:scale-95 transition-all"
        >
          <div className="w-36 h-36 flex items-center justify-center bg-zinc-950/10 group-hover:bg-zinc-950/15 rounded-3xl transition-colors">
            <i className="ri-shopping-bag-3-line text-7xl" />
          </div>
          <div className="text-center">
            <p className="text-4xl font-black mb-2">Para viagem</p>
            <p className="text-zinc-950/60 text-lg">
              Embalagem especial para você levar
            </p>
          </div>
        </button>
      </div>

      <p className="mt-12 text-zinc-600 text-lg">
        Sua escolha será indicada no pedido para a cozinha
      </p>
    </div>
  );
}
