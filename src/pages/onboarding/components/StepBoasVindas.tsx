interface StepBoasVindasProps {
  onNext: () => void;
}

export default function StepBoasVindas({ onNext }: StepBoasVindasProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center h-full min-h-[400px] px-4 py-12">
      <div className="w-20 h-20 flex items-center justify-center bg-amber-100 rounded-3xl mb-8">
        <i className="ri-store-2-line text-amber-600 text-4xl" />
      </div>
      <h1 className="text-3xl font-black text-zinc-900 mb-3 leading-tight">
        Bem-vindo ao ERPOS V2
      </h1>
      <p className="text-base text-zinc-500 max-w-md leading-relaxed mb-3">
        Vamos configurar o seu estabelecimento em poucos minutos.
        Você vai precisar de:
      </p>
      <div className="flex flex-col gap-2.5 mb-10 text-left w-full max-w-sm">
        {[
          { icon: 'ri-user-line', text: 'Dados do administrador', desc: 'Nome, e-mail e senha' },
          { icon: 'ri-store-line', text: 'Informações do estabelecimento', desc: 'Nome, tipo e CNPJ' },
          { icon: 'ri-layout-grid-line', text: 'Configuração de mesas', desc: 'Quantidade e setores' },
          { icon: 'ri-bank-card-line', text: 'Formas de pagamento', desc: 'O que você aceita' },
        ].map((item) => (
          <div key={item.icon} className="flex items-center gap-3 p-3 bg-zinc-50 rounded-xl border border-zinc-100">
            <div className="w-9 h-9 flex items-center justify-center bg-white rounded-lg border border-zinc-200 flex-shrink-0">
              <i className={`${item.icon} text-amber-600 text-base`} />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-800">{item.text}</p>
              <p className="text-xs text-zinc-400">{item.desc}</p>
            </div>
            <i className="ri-check-line text-emerald-500 text-sm ml-auto flex-shrink-0" />
          </div>
        ))}
      </div>
      <button
        onClick={onNext}
        className="w-full max-w-sm bg-amber-500 hover:bg-amber-600 text-white font-bold py-3.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap text-sm"
      >
        Começar configuração
      </button>
      <p className="text-xs text-zinc-400 mt-4">Leva menos de 3 minutos</p>
    </div>
  );
}
