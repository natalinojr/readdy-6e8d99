import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessao } from '@/contexts/SessaoContext';
import { useCardapio } from '@/contexts/CardapioContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import AdicionarOperadorModal from './AdicionarOperadorModal';
import { ChefHat } from 'lucide-react';

interface Props {
  onConfirm: (estacao: string) => void;
}

export default function KDSSetupScreen({ onConfirm }: Props) {
  const navigate = useNavigate();
  const { estado, sessao: _sessao, estacoesAbertas, fecharEstacao, abrirEstacao } = useSessao();
  void _sessao;
  const { estacoes } = useCardapio();
  const { user } = useAuth();
  const { preferences, setPreference } = useUserPreferences();
  const [estacaoSelecionada, setEstacaoSelecionada] = useState<string>('Todas');
  const [prefLoaded, setPrefLoaded] = useState(false);
  const [showAddOperador, setShowAddOperador] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novaEstacao, setNovaEstacao] = useState('');
  const [showInlineForm, setShowInlineForm] = useState(false);

  // Estações ativas do banco, com fallback para lista padrão
  const estacoesReais = estacoes.filter((e) => e.ativo).map((e) => e.nome);
  const estacoesDisplay = estacoesReais.length > 0
    ? estacoesReais
    : ['Grelha', 'Frituras', 'Balcão', 'Confeitaria'];

  // BUG 3.9 FIX: auto-selecionar estação padrão salva nas preferências do usuário
  useEffect(() => {
    if (prefLoaded) return;
    const saved = preferences.kds_default_station;
    if (saved) {
      // Verifica se a estação ainda existe
      const valid = saved === 'Todas' || estacoesDisplay.includes(saved);
      if (valid) {
        setEstacaoSelecionada(saved);
      }
    }
    setPrefLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.kds_default_station]);

  // Auto-adicionar o operador logado se ainda não estiver na lista
  useEffect(() => {
    if (!user?.nome) return;
    const jaAdicionado = estacoesAbertas.some(
      (e) => e.operadorNome.toLowerCase() === user.nome.toLowerCase()
    );
    if (!jaAdicionado) {
      const primeiraEstacao = estacoesDisplay[0] ?? 'Cozinha';
      const id = `estacao-auto-${user.id ?? Date.now()}`;
      abrirEstacao(id, primeiraEstacao, user.nome);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.nome]);

  const handleAdicionarInline = () => {
    const nome = novoNome.trim();
    const est = novaEstacao || estacoesDisplay[0];
    if (!nome || !est) return;
    const id = `estacao-${Date.now()}`;
    abrirEstacao(id, est, nome);
    setNovoNome('');
    setNovaEstacao('');
    setShowInlineForm(false);
  };

  const handleRemoverOperador = (estacaoId: string) => {
    fecharEstacao(estacaoId);
  };

  const handleEstacaoChange = (est: string) => {
    setEstacaoSelecionada(est);
    // BUG 3.9 FIX: salva a escolha como preferência padrão
    setPreference('kds_default_station', est);
  };

  const handleEntrar = () => {
    onConfirm(estacaoSelecionada);
  };

  const corEstacao: Record<string, string> = {
    'Grelha':      'bg-orange-100 text-orange-700 border-orange-200',
    'Frituras':    'bg-yellow-100 text-yellow-700 border-yellow-200',
    'Balcão':      'bg-sky-100 text-sky-700 border-sky-200',
    'Confeitaria': 'bg-pink-100 text-pink-700 border-pink-200',
  };

  // Bloqueia acesso se não há sessão ativa no caixa
  if (estado === 'sem_sessao') {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-8 text-center relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #fffbf5 0%, #fef6e8 50%, #fdf4e3 100%)' }}
      >
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-20 pointer-events-none" style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }} />
        <div className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full opacity-15 pointer-events-none" style={{ background: 'radial-gradient(circle, #fb923c 0%, transparent 70%)' }} />
        <div className="bg-white/70 backdrop-blur-sm border border-amber-100 rounded-2xl p-8 flex flex-col items-center text-center max-w-sm">
          <div className="w-20 h-20 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl mb-6">
            <i className="ri-lock-line text-4xl text-amber-400" />
          </div>
          <h2 className="text-2xl font-black text-zinc-800 mb-2">KDS Offline</h2>
          <p className="text-zinc-500 text-sm max-w-xs">
            Nenhuma sessão ativa no caixa. Abra uma sessão no PDV Caixa para liberar o KDS.
          </p>
          <div className="mt-6 flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-full">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-zinc-500 text-xs font-medium">Aguardando sessão...</span>
          </div>
          <button
            onClick={() => navigate('/modulos')}
            className="mt-5 flex items-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-900 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-arrow-left-line text-sm" />
            Voltar aos Módulos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #fffbf5 0%, #fef6e8 50%, #fdf4e3 100%)' }}
    >
      {/* Orbs decorativos */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-20 pointer-events-none" style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }} />
      <div className="absolute top-1/3 -right-24 w-72 h-72 rounded-full opacity-15 pointer-events-none" style={{ background: 'radial-gradient(circle, #fb923c 0%, transparent 70%)' }} />
      <div className="absolute -bottom-20 left-1/3 w-80 h-80 rounded-full opacity-10 pointer-events-none" style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />

      {showAddOperador && (
        <AdicionarOperadorModal
          estacaoAtual={estacaoSelecionada !== 'Todas' ? estacaoSelecionada : estacoesDisplay[0]}
          onClose={() => setShowAddOperador(false)}
        />
      )}

      <div className="w-full max-w-lg relative z-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate('/modulos')}
            title="Voltar aos Módulos"
            className="w-10 h-10 flex items-center justify-center rounded-xl cursor-pointer transition-all hover:scale-95 flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
          >
            <i className="ri-arrow-left-line text-lg text-white" />
          </button>
          <div>
            <h1 className="text-zinc-800 font-black text-xl">KDS — Cozinha</h1>
            <p className="text-zinc-500 text-sm">Configure sua estação antes de começar</p>
          </div>
        </div>

        {/* Card principal */}
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-amber-100 overflow-hidden">
          {/* Seleção de estação */}
          <div className="p-6 border-b border-amber-100/80">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 flex items-center justify-center bg-amber-100 rounded-md">
                <i className="ri-store-2-line text-amber-600 text-xs" />
              </div>
              <h2 className="text-sm font-bold text-zinc-700">Escolha sua estação</h2>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {/* Botão "Todas" */}
              <button
                onClick={() => handleEstacaoChange('Todas')}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all text-left ${
                  estacaoSelecionada === 'Todas'
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-zinc-200 bg-white/60 text-zinc-500 hover:border-amber-200 hover:bg-amber-50/50'
                }`}
              >
                <i className="ri-layout-grid-line text-sm" />
                Todas as Estações
              </button>
              {estacoesDisplay.map((est) => {
                const isActive = estacaoSelecionada === est;
                return (
                  <button
                    key={est}
                    onClick={() => handleEstacaoChange(est)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all text-left ${
                      isActive
                        ? 'border-amber-400 bg-amber-50 text-amber-700'
                        : 'border-zinc-200 bg-white/60 text-zinc-500 hover:border-amber-200 hover:bg-amber-50/50'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-amber-500' : 'bg-zinc-300'}`} />
                    {est}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Operadores do dia */}
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 flex items-center justify-center bg-teal-50 rounded-md">
                  <i className="ri-team-line text-teal-600 text-xs" />
                </div>
                <h2 className="text-sm font-bold text-zinc-700">Operadores do dia</h2>
                {estacoesAbertas.length > 0 && (
                  <span className="text-[10px] font-black bg-teal-50 text-teal-600 border border-teal-200 px-1.5 py-0.5 rounded-full">
                    {estacoesAbertas.length}
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowInlineForm((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-amber-50 text-zinc-600 text-xs font-semibold rounded-lg cursor-pointer transition-colors border border-zinc-200 hover:border-amber-200 whitespace-nowrap"
              >
                <i className="ri-user-add-line text-sm" />
                Adicionar
              </button>
            </div>

            {/* Form inline */}
            {showInlineForm && (
              <div className="mb-4 p-4 bg-amber-50/60 rounded-xl border border-amber-100">
                <p className="text-xs font-bold text-zinc-600 mb-3">Novo operador</p>
                <div className="flex gap-2 flex-wrap">
                  <input
                    type="text"
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    placeholder="Nome do operador"
                    className="flex-1 min-w-0 text-sm bg-white border border-zinc-200 rounded-lg px-3 py-2 text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400 transition-colors"
                  />
                  <select
                    value={novaEstacao}
                    onChange={(e) => setNovaEstacao(e.target.value)}
                    className="text-sm bg-white border border-zinc-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
                  >
                    <option value="">Estação</option>
                    {estacoesDisplay.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                  <button
                    onClick={handleAdicionarInline}
                    disabled={!novoNome.trim()}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                  >
                    Adicionar
                  </button>
                  <button
                    onClick={() => { setShowInlineForm(false); setNovoNome(''); setNovaEstacao(''); }}
                    className="px-3 py-2 bg-white hover:bg-zinc-50 text-zinc-500 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap border border-zinc-200"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Lista operadores */}
            {estacoesAbertas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-12 h-12 flex items-center justify-center bg-zinc-50 border border-zinc-200 rounded-xl mb-3">
                  <i className="ri-user-line text-xl text-zinc-400" />
                </div>
                <p className="text-zinc-500 text-sm font-semibold">Nenhum operador adicionado</p>
                <p className="text-zinc-400 text-xs mt-1">Adicione ao menos um operador para começar</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {estacoesAbertas.map((e) => {
                  const cls = corEstacao[e.estacaoNome] ?? 'bg-zinc-100 text-zinc-700 border-zinc-200';
                  return (
                    <div
                      key={e.estacaoId}
                      className="flex items-center gap-3 p-3 bg-white/80 rounded-xl border border-zinc-100"
                    >
                      <div
                        className="w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                      >
                        <span className="text-xs font-black text-white">{e.operadorNome.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-zinc-700 truncate">{e.operadorNome}</p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cls}`}>
                          {e.estacaoNome}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoverOperador(e.estacaoId)}
                        title="Remover operador"
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                      >
                        <i className="ri-close-line text-sm" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Aviso + botão entrar */}
        <div className="mt-4 space-y-3">          <div className="flex items-center justify-between gap-3">
            <p className="text-zinc-400 text-xs">
              <i className="ri-information-line mr-1" />
              Você pode adicionar ou remover operadores com o KDS aberto
            </p>
            <button
              onClick={handleEntrar}
              className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-play-circle-line text-base" />
              Entrar no KDS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
