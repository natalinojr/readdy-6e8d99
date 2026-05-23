import { useState } from 'react';

export type FormaPagamento = 'dinheiro' | 'credito' | 'debito' | 'pix' | 'vr' | 'va' | 'stone_pix';

const FORMAS: { id: FormaPagamento; label: string; desc: string; icon: string }[] = [
  { id: 'dinheiro', label: 'Dinheiro', desc: 'Pagamento em espécie', icon: 'ri-money-dollar-circle-line' },
  { id: 'pix', label: 'PIX', desc: 'Transferência instantânea', icon: 'ri-flashlight-line' },
  { id: 'credito', label: 'Cartão de Crédito', desc: 'Crédito à vista ou parcelado', icon: 'ri-bank-card-line' },
  { id: 'debito', label: 'Cartão de Débito', desc: 'Débito à vista', icon: 'ri-bank-card-2-line' },
  { id: 'vr', label: 'Vale Refeição', desc: 'VR, Alelo, Sodexo...', icon: 'ri-coupon-line' },
  { id: 'va', label: 'Vale Alimentação', desc: 'VA, benefício alimentar', icon: 'ri-shopping-basket-line' },
];

export interface PagamentosData {
  formas: FormaPagamento[];
}

interface StepPagamentosProps {
  data: PagamentosData;
  onNext: (data: PagamentosData) => void;
  onBack: () => void;
}

export default function StepPagamentos({ data, onNext, onBack }: StepPagamentosProps) {
  const [formas, setFormas] = useState<FormaPagamento[]>(
    data.formas.length ? data.formas : ['dinheiro', 'pix', 'credito', 'debito']
  );
  const [erro, setErro] = useState('');

  const toggle = (id: FormaPagamento) => {
    setErro('');
    setFormas((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (!formas.length) { setErro('Selecione pelo menos uma forma de pagamento.'); return; }
    onNext({ formas });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-zinc-900 mb-1">Formas de pagamento</h2>
        <p className="text-sm text-zinc-500">Quais formas você aceita? (selecione todas que aplicam)</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {FORMAS.map((f) => {
          const selected = formas.includes(f.id);
          return (
            <button
              key={f.id}
              onClick={() => toggle(f.id)}
              className={`flex items-center gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all text-left ${selected ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
            >
              <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${selected ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                <i className={`${f.icon} text-base ${selected ? 'text-white' : 'text-zinc-500'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-bold truncate ${selected ? 'text-amber-800' : 'text-zinc-700'}`}>{f.label}</p>
                <p className="text-[10px] text-zinc-400 truncate">{f.desc}</p>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'}`}>
                {selected && <i className="ri-check-line text-white text-[9px]" />}
              </div>
            </button>
          );
        })}
      </div>

      {erro && <p className="text-xs text-red-500">{erro}</p>}

      <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100">
        <p className="text-[10px] text-zinc-500">
          <strong>Dica:</strong> Você pode adicionar, remover ou configurar formas de pagamento depois em <strong>Configurações → Estações & Pagamentos</strong>.
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-5 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
          Voltar
        </button>
        <button onClick={handleNext} className="flex-1 py-2.5 text-sm font-bold text-white bg-amber-500 rounded-xl hover:bg-amber-600 cursor-pointer whitespace-nowrap">
          Finalizar configuração
        </button>
      </div>
    </div>
  );
}
