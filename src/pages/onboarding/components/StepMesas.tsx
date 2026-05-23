import { useState } from 'react';

export interface SetorMesa {
  id: string;
  nome: string;
  quantidadeMesas: number;
}

export interface MesasData {
  temSalao: boolean;
  quantidadeMesas: number;
  setores: SetorMesa[];
}

const SETORES_SUGESTAO = [
  { nome: 'Varanda', icon: 'ri-sun-line' },
  { nome: 'Área VIP', icon: 'ri-vip-diamond-line' },
  { nome: 'Deck', icon: 'ri-layout-masonry-line' },
  { nome: 'Área Kids', icon: 'ri-gamepad-line' },
  { nome: 'Mezanino', icon: 'ri-building-line' },
  { nome: 'Terraço', icon: 'ri-plant-line' },
];

interface StepMesasProps {
  data: MesasData;
  onNext: (data: MesasData) => void;
  onBack: () => void;
}

export default function StepMesas({ data, onNext, onBack }: StepMesasProps) {
  const [temSalao, setTemSalao] = useState(data.temSalao);
  const [quantidade, setQuantidade] = useState(data.quantidadeMesas || 10);
  const [setores, setSetores] = useState<SetorMesa[]>(data.setores ?? []);

  const [adicionandoSetor, setAdicionandoSetor] = useState(false);
  const [novoSetorNome, setNovoSetorNome] = useState('');
  const [novoSetorQtd, setNovoSetorQtd] = useState(5);

  const jaTem = (nome: string) => setores.some((s) => s.nome.toLowerCase() === nome.toLowerCase());

  const addSetorSugestao = (nome: string) => {
    if (jaTem(nome)) {
      setSetores((prev) => prev.filter((s) => s.nome.toLowerCase() !== nome.toLowerCase()));
    } else {
      setSetores((prev) => [...prev, { id: `setor-${Date.now()}`, nome, quantidadeMesas: 5 }]);
    }
  };

  const addSetorPersonalizado = () => {
    if (!novoSetorNome.trim()) return;
    setSetores((prev) => [...prev, { id: `setor-${Date.now()}`, nome: novoSetorNome.trim(), quantidadeMesas: novoSetorQtd }]);
    setNovoSetorNome('');
    setNovoSetorQtd(5);
    setAdicionandoSetor(false);
  };

  const updateSetorQtd = (id: string, qtd: number) =>
    setSetores((prev) => prev.map((s) => (s.id === id ? { ...s, quantidadeMesas: qtd } : s)));

  const removeSetor = (id: string) => setSetores((prev) => prev.filter((s) => s.id !== id));

  const handleNext = () => {
    onNext({ temSalao, quantidadeMesas: quantidade, setores });
  };

  const totalMesas = temSalao ? quantidade + setores.reduce((acc, s) => acc + s.quantidadeMesas, 0) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-zinc-900 mb-1">Configuração de mesas</h2>
        <p className="text-sm text-zinc-500">Como funciona o atendimento do seu estabelecimento?</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setTemSalao(true)}
          className={`flex flex-col items-center gap-2 py-5 rounded-xl border-2 cursor-pointer transition-all ${temSalao ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
        >
          <i className={`ri-layout-grid-line text-2xl ${temSalao ? 'text-amber-600' : 'text-zinc-400'}`} />
          <span className={`text-sm font-bold ${temSalao ? 'text-amber-700' : 'text-zinc-600'}`}>Tem salão / mesas</span>
          <span className="text-[10px] text-zinc-400 text-center px-2">QR Code por mesa, garçom, pedidos por mesa</span>
        </button>
        <button
          onClick={() => setTemSalao(false)}
          className={`flex flex-col items-center gap-2 py-5 rounded-xl border-2 cursor-pointer transition-all ${!temSalao ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
        >
          <i className={`ri-takeaway-line text-2xl ${!temSalao ? 'text-amber-600' : 'text-zinc-400'}`} />
          <span className={`text-sm font-bold ${!temSalao ? 'text-amber-700' : 'text-zinc-600'}`}>Só balcão / delivery</span>
          <span className="text-[10px] text-zinc-400 text-center px-2">Pedidos avulsos, sem controle de mesas</span>
        </button>
      </div>

      {temSalao && (
        <div className="space-y-4 p-4 bg-zinc-50 rounded-xl border border-zinc-100">
          {/* Salão principal */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">
              Salão principal — quantidade de mesas
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
                className="w-9 h-9 flex items-center justify-center bg-white border border-zinc-200 rounded-lg cursor-pointer hover:bg-zinc-100 text-zinc-600 font-bold"
              >
                −
              </button>
              <span className="text-2xl font-black text-zinc-900 w-12 text-center">{quantidade}</span>
              <button
                onClick={() => setQuantidade((q) => Math.min(200, q + 1))}
                className="w-9 h-9 flex items-center justify-center bg-white border border-zinc-200 rounded-lg cursor-pointer hover:bg-zinc-100 text-zinc-600 font-bold"
              >
                +
              </button>
            </div>
          </div>

          {/* Setores adicionais */}
          <div>
            <p className="text-xs font-semibold text-zinc-600 mb-2">Setores adicionais</p>

            {/* Sugestões de setor */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {SETORES_SUGESTAO.map(({ nome, icon }) => (
                <button
                  key={nome}
                  onClick={() => addSetorSugestao(nome)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border cursor-pointer transition-all whitespace-nowrap font-medium ${
                    jaTem(nome)
                      ? 'border-amber-300 bg-amber-50 text-amber-700'
                      : 'border-zinc-200 text-zinc-600 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50'
                  }`}
                >
                  <i className={`${jaTem(nome) ? 'ri-check-line' : icon} text-sm`} />
                  {nome}
                </button>
              ))}
            </div>

            {/* Setores adicionados */}
            {setores.length > 0 && (
              <div className="space-y-2 mb-3">
                {setores.map((setor) => (
                  <div key={setor.id} className="flex items-center gap-3 p-2.5 bg-white border border-zinc-100 rounded-lg">
                    <i className="ri-map-pin-line text-zinc-400 text-sm flex-shrink-0" />
                    <span className="text-sm font-semibold text-zinc-800 flex-1">{setor.nome}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateSetorQtd(setor.id, Math.max(1, setor.quantidadeMesas - 1))}
                        className="w-6 h-6 flex items-center justify-center bg-zinc-100 rounded cursor-pointer hover:bg-zinc-200 text-zinc-600 text-sm font-bold"
                      >
                        −
                      </button>
                      <span className="text-sm font-bold text-zinc-800 w-6 text-center">{setor.quantidadeMesas}</span>
                      <button
                        onClick={() => updateSetorQtd(setor.id, Math.min(100, setor.quantidadeMesas + 1))}
                        className="w-6 h-6 flex items-center justify-center bg-zinc-100 rounded cursor-pointer hover:bg-zinc-200 text-zinc-600 text-sm font-bold"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-[10px] text-zinc-400">mesas</span>
                    <button
                      onClick={() => removeSetor(setor.id)}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-zinc-300 hover:text-red-400 cursor-pointer"
                    >
                      <i className="ri-close-line text-xs" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Adicionar setor personalizado */}
            {adicionandoSetor ? (
              <div className="p-3 bg-white border border-zinc-100 rounded-xl space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Nome do setor</label>
                    <input
                      value={novoSetorNome}
                      onChange={(e) => setNovoSetorNome(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addSetorPersonalizado()}
                      placeholder="Ex: Rooftop, Jardim..."
                      autoFocus
                      className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-400 text-zinc-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Mesas</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={novoSetorQtd}
                      onChange={(e) => setNovoSetorQtd(parseInt(e.target.value, 10) || 1)}
                      className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-400 text-zinc-800"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setAdicionandoSetor(false)} className="flex-1 py-1.5 text-xs font-semibold text-zinc-500 bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap hover:bg-zinc-200">Cancelar</button>
                  <button onClick={addSetorPersonalizado} disabled={!novoSetorNome.trim()} className="flex-1 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-lg cursor-pointer disabled:opacity-40 whitespace-nowrap hover:bg-amber-600">Adicionar</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdicionandoSetor(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors"
              >
                <i className="ri-add-circle-line text-sm" />
                Setor personalizado
              </button>
            )}
          </div>

          {/* Resumo total */}
          {totalMesas > 0 && (
            <div className="flex items-center gap-2 pt-2 border-t border-zinc-200">
              <i className="ri-layout-grid-line text-zinc-400 text-sm" />
              <span className="text-xs text-zinc-500">
                Total: <strong className="text-zinc-800">{totalMesas} mesas</strong>
                {setores.length > 0 && (
                  <> em <strong className="text-zinc-800">{1 + setores.length} setores</strong></>
                )}
              </span>
            </div>
          )}

          <p className="text-[10px] text-zinc-400">
            Você pode adicionar mais mesas e setores depois nas Configurações.
          </p>
        </div>
      )}

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
