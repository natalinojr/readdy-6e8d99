import { useState } from 'react';

export interface LojaData {
  nomeLoja: string;
  tipoNegocio: string;
  tipoOutro: string;
}

const TIPOS = [
  { id: 'restaurante', label: 'Restaurante', icon: 'ri-restaurant-line' },
  { id: 'lanchonete', label: 'Lanchonete', icon: 'ri-store-2-line' },
  { id: 'pizzaria', label: 'Pizzaria', icon: 'ri-pie-chart-line' },
  { id: 'bar', label: 'Bar / Pub', icon: 'ri-goblet-line' },
  { id: 'cafe', label: 'Café', icon: 'ri-cup-line' },
  { id: 'hamburgueria', label: 'Hamburgueria', icon: 'ri-knife-line' },
  { id: 'foodpark', label: 'Food Park', icon: 'ri-sun-line' },
  { id: 'darkKitchen', label: 'Dark Kitchen', icon: 'ri-box-3-line' },
  { id: 'sorveteria', label: 'Sorveteria', icon: 'ri-temp-cold-line' },
  { id: 'acai', label: 'Açaí & Smoothies', icon: 'ri-seedling-line' },
  { id: 'padaria', label: 'Padaria', icon: 'ri-cake-line' },
  { id: 'churrascaria', label: 'Churrascaria', icon: 'ri-fire-line' },
  { id: 'sushi', label: 'Culinária Japonesa', icon: 'ri-global-line' },
  { id: 'outro', label: 'Outro', icon: 'ri-add-circle-line' },
];

interface StepLojaProps {
  data: LojaData;
  onNext: (data: LojaData) => void;
  onBack: () => void;
}

export default function StepLoja({ data, onNext, onBack }: StepLojaProps) {
  const [nomeLoja, setNomeLoja] = useState(data.nomeLoja);
  const [tipoNegocio, setTipoNegocio] = useState(data.tipoNegocio || 'restaurante');
  const [tipoOutro, setTipoOutro] = useState(data.tipoOutro || '');
  const [erros, setErros] = useState<Record<string, string>>({});

  const handleNext = () => {
    const e: Record<string, string> = {};
    if (!nomeLoja.trim()) e.nomeLoja = 'Nome do estabelecimento obrigatório';
    if (tipoNegocio === 'outro' && !tipoOutro.trim()) e.tipoOutro = 'Descreva o tipo de negócio';
    if (Object.keys(e).length) { setErros(e); return; }
    onNext({ nomeLoja, tipoNegocio, tipoOutro });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-zinc-900 mb-1">Dados do estabelecimento</h2>
        <p className="text-sm text-zinc-500">Informações básicas da sua operação.</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-zinc-600 mb-2">Tipo de negócio</label>
        <div className="grid grid-cols-3 gap-2">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTipoNegocio(t.id); setErros((prev) => ({ ...prev, tipoOutro: '' })); }}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 cursor-pointer transition-all text-center ${tipoNegocio === t.id ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
            >
              <i className={`${t.icon} text-xl ${tipoNegocio === t.id ? 'text-amber-600' : 'text-zinc-400'}`} />
              <span className={`text-[10px] font-semibold leading-tight ${tipoNegocio === t.id ? 'text-amber-700' : 'text-zinc-500'}`}>{t.label}</span>
            </button>
          ))}
        </div>
        {tipoNegocio === 'outro' && (
          <div className="mt-3">
            <input
              value={tipoOutro}
              onChange={(e) => { setTipoOutro(e.target.value); setErros((prev) => ({ ...prev, tipoOutro: '' })); }}
              placeholder="Ex: Crepe, Tapiocaria, Espaço de eventos..."
              className={`w-full text-sm border rounded-xl px-3.5 py-2.5 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ${erros.tipoOutro ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
            />
            {erros.tipoOutro && <p className="text-xs text-red-500 mt-1">{erros.tipoOutro}</p>}
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome do estabelecimento *</label>
        <input
          value={nomeLoja}
          onChange={(e) => { setNomeLoja(e.target.value); setErros((prev) => ({ ...prev, nomeLoja: '' })); }}
          placeholder="Ex: Restaurante do João"
          className={`w-full text-sm border rounded-xl px-3.5 py-2.5 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ${erros.nomeLoja ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
        />
        {erros.nomeLoja && <p className="text-xs text-red-500 mt-1">{erros.nomeLoja}</p>}
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-5 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
          Voltar
        </button>
        <button onClick={handleNext} className="flex-1 py-2.5 text-sm font-bold text-white bg-amber-500 rounded-xl hover:bg-amber-600 cursor-pointer whitespace-nowrap">
          Continuar
        </button>
      </div>
    </div>
  );
}