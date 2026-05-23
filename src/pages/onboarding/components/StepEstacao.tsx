import { useState } from 'react';

export interface EstacaoOnboarding {
  id: string;
  nome: string;
  cor: string;
}

export interface EstacaoData {
  estacoes: EstacaoOnboarding[];
}

const CORES = ['#f59e0b', '#f97316', '#10b981', '#06b6d4', '#8b5cf6', '#ec4899', '#ef4444', '#14b8a6'];

const SUGESTOES = [
  { nome: 'Grelha', cor: '#f97316', icon: 'ri-fire-line' },
  { nome: 'Frituras', cor: '#f59e0b', icon: 'ri-droplet-fill' },
  { nome: 'Balcão', cor: '#10b981', icon: 'ri-store-2-line' },
  { nome: 'Confeitaria', cor: '#ec4899', icon: 'ri-cake-line' },
  { nome: 'Bebidas', cor: '#06b6d4', icon: 'ri-goblet-line' },
  { nome: 'Pizza', cor: '#ef4444', icon: 'ri-pie-chart-line' },
];

interface StepEstacaoProps {
  data: EstacaoData;
  onNext: (data: EstacaoData) => void;
  onBack: () => void;
}

export default function StepEstacao({ data, onNext, onBack }: StepEstacaoProps) {
  const [estacoes, setEstacoes] = useState<EstacaoOnboarding[]>(
    data.estacoes.length > 0 ? data.estacoes : []
  );
  const [novoNome, setNovoNome] = useState('');
  const [novaCor, setNovaCor] = useState(CORES[0]);
  const [adicionandoManual, setAdicionandoManual] = useState(false);
  const [erro, setErro] = useState('');

  const adicionarSugestao = (s: typeof SUGESTOES[0]) => {
    if (estacoes.find((e) => e.nome.toLowerCase() === s.nome.toLowerCase())) return;
    setEstacoes((prev) => [...prev, { id: `est-${Date.now()}-${Math.random()}`, nome: s.nome, cor: s.cor }]);
    setErro('');
  };

  const adicionarManual = () => {
    if (!novoNome.trim()) return;
    setEstacoes((prev) => [...prev, { id: `est-${Date.now()}`, nome: novoNome.trim(), cor: novaCor }]);
    setNovoNome('');
    setNovaCor(CORES[estacoes.length % CORES.length]);
    setAdicionandoManual(false);
    setErro('');
  };

  const remover = (id: string) => {
    setEstacoes((prev) => prev.filter((e) => e.id !== id));
  };

  const handleNext = () => {
    if (estacoes.length === 0) {
      setErro('Adicione pelo menos uma estação de cozinha para continuar.');
      return;
    }
    onNext({ estacoes });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-zinc-900 mb-1">Estações da cozinha</h2>
        <p className="text-sm text-zinc-500">
          Estações são os setores de preparo (ex: Grelha, Frituras). Você precisa de pelo menos uma para criar categorias no cardápio.
        </p>
      </div>

      {/* Sugestões rápidas */}
      <div>
        <p className="text-xs font-semibold text-zinc-600 mb-2">Clique para adicionar (sugestões rápidas)</p>
        <div className="grid grid-cols-3 gap-2">
          {SUGESTOES.map((s) => {
            const jaTem = estacoes.find((e) => e.nome.toLowerCase() === s.nome.toLowerCase());
            return (
              <button
                key={s.nome}
                onClick={() => adicionarSugestao(s)}
                disabled={!!jaTem}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-all text-left ${
                  jaTem
                    ? 'border-emerald-300 bg-emerald-50 opacity-70'
                    : 'border-zinc-100 bg-zinc-50 hover:border-zinc-300'
                }`}
              >
                <div
                  className="w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.cor }}
                >
                  {jaTem ? (
                    <i className="ri-check-line text-white text-[10px]" />
                  ) : (
                    <i className={`${s.icon} text-white text-[10px]`} />
                  )}
                </div>
                <span className="text-xs font-semibold text-zinc-700">{s.nome}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista de estações adicionadas */}
      {estacoes.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-600 mb-2">Estações configuradas ({estacoes.length})</p>
          <div className="space-y-2">
            {estacoes.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 bg-white border border-zinc-100 rounded-xl">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: e.cor }} />
                <span className="text-sm font-semibold text-zinc-800 flex-1">{e.nome}</span>
                <button
                  onClick={() => remover(e.id)}
                  className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-300 hover:text-red-400 cursor-pointer transition-colors"
                >
                  <i className="ri-close-line text-sm" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Adicionar manualmente */}
      {adicionandoManual ? (
        <div className="p-4 bg-zinc-50 border border-zinc-100 rounded-xl space-y-3">
          <p className="text-xs font-semibold text-zinc-600">Nova estação personalizada</p>
          <div>
            <input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionarManual()}
              placeholder="Nome da estação..."
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400"
            />
          </div>
          <div>
            <p className="text-[10px] text-zinc-500 mb-1.5">Cor</p>
            <div className="flex gap-2 flex-wrap">
              {CORES.map((c) => (
                <button
                  key={c}
                  onClick={() => setNovaCor(c)}
                  className={`w-7 h-7 rounded-full cursor-pointer transition-all ${novaCor === c ? 'scale-125 ring-2 ring-offset-1 ring-zinc-400' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setAdicionandoManual(false)}
              className="flex-1 py-2 text-xs font-semibold text-zinc-500 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              onClick={adicionarManual}
              disabled={!novoNome.trim()}
              className="flex-1 py-2 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              Adicionar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdicionandoManual(true)}
          className="flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-amber-600 cursor-pointer transition-colors"
        >
          <i className="ri-add-circle-line text-base" />
          Adicionar estação personalizada
        </button>
      )}

      {erro && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <i className="ri-error-warning-line text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600">{erro}</p>
        </div>
      )}

      <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
        <p className="text-[10px] text-amber-700">
          <strong>Por que isso importa?</strong> Cada categoria do cardápio precisa estar vinculada a uma estação.
          O KDS exibe os pedidos separados por estação para a equipe da cozinha.
        </p>
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
