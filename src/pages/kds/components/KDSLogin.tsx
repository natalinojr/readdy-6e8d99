import { useState, useMemo, useEffect } from 'react';
import { useSessao } from '../../../contexts/SessaoContext';
import { useCardapio } from '../../../contexts/CardapioContext';
import { useUsuarios } from '../../../hooks/useUsuarios';
import { useAuth } from '../../../contexts/AuthContext';

interface Props {
  onLoginSuccess: (estacaoFiltro: string) => void;
}

export default function KDSLogin({ onLoginSuccess }: Props) {
  const { estado, sessao, estacoesAbertas, abrirEstacao } = useSessao();
  const { user } = useAuth();
  const [estacaoSelecionada, setEstacaoSelecionada] = useState<string>('Todas');
  const [operadoresSelecionados, setOperadoresSelecionados] = useState<string[]>([]);
  const [nomeAvulso, setNomeAvulso] = useState('');
  const [modoEntrada, setModoEntrada] = useState<'lista' | 'avulso'>('lista');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  const { estacoes } = useCardapio();
  const { usuarios } = useUsuarios();
  const estacoesAtivas = estacoes.filter((e) => e.ativo);
  const operadoresAtivos = useMemo(() => {
    return usuarios.filter((u) => u.ativo && ['cozinha', 'gerente', 'admin'].includes(u.perfil));
  }, [usuarios]);

  // Pré-selecionar o operador logado automaticamente
  useEffect(() => {
    if (!user?.nome) return;
    const nomeLogado = user.nome;
    // Verifica se o nome está na lista de operadores cadastrados
    const naLista = operadoresAtivos.some(
      (op) => op.nome.toLowerCase() === nomeLogado.toLowerCase()
    );
    if (naLista) {
      setModoEntrada('lista');
      setOperadoresSelecionados([nomeLogado]);
    } else {
      // Se não está na lista, preenche o campo avulso
      setModoEntrada('avulso');
      setNomeAvulso(nomeLogado);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.nome, operadoresAtivos.length]);

  const toggleOperador = (nome: string) => {
    setOperadoresSelecionados((prev) =>
      prev.includes(nome) ? prev.filter((n) => n !== nome) : [...prev, nome]
    );
    setErro('');
  };

  const nomeOperadorFinal = modoEntrada === 'avulso'
    ? nomeAvulso.trim()
    : operadoresSelecionados.join(', ');

  const handleEntrar = () => {
    const nome = nomeOperadorFinal;
    if (!nome) {
      setErro(modoEntrada === 'lista' ? 'Selecione pelo menos um operador.' : 'Informe o nome do operador.');
      return;
    }
    setErro('');
    setEntrando(true);

    setTimeout(() => {
      if (estacaoSelecionada === 'Todas') {
        estacoesAtivas.forEach((est) => {
          abrirEstacao(est.id, est.nome, nome);
        });
      } else {
        const est = estacoesAtivas.find((e) => e.nome === estacaoSelecionada);
        if (est) abrirEstacao(est.id, est.nome, nome);
      }
      onLoginSuccess(estacaoSelecionada);
    }, 700);
  };

  // Sem sessão ativa
  if (estado === 'sem_sessao') {
    return (
      <div className="flex flex-col h-full bg-zinc-900 items-center justify-center p-8 text-center">
        <div className="w-20 h-20 flex items-center justify-center bg-zinc-800 rounded-2xl mb-6">
          <i className="ri-lock-line text-4xl text-zinc-500" />
        </div>
        <h2 className="text-2xl font-black text-white mb-2">KDS Offline</h2>
        <p className="text-zinc-400 text-sm max-w-xs">
          Nenhuma sessão ativa no caixa. Abra uma sessão no PDV Caixa para liberar o KDS.
        </p>
        <div className="mt-6 flex items-center gap-2 px-4 py-2 bg-zinc-800 rounded-full">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-zinc-400 text-xs font-medium">Aguardando sessão...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900 items-center justify-center p-6 overflow-y-auto">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-lg p-7 border border-zinc-700">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 flex items-center justify-center bg-amber-500 rounded-2xl mx-auto mb-3">
            <i className="ri-layout-grid-line text-2xl text-zinc-900" />
          </div>
          <h2 className="text-xl font-black text-white">KDS — Kitchen Display</h2>
          <p className="text-zinc-400 text-xs mt-1">Selecione a estação e os operadores do turno</p>
          {sessao && (
            <div className="mt-3 inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-amber-400 text-[10px] font-bold">{sessao.numero}</span>
            </div>
          )}
        </div>

        <div className="space-y-5">
          {/* Seleção de estação */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2">
              Estação de Trabalho
            </label>
            <div className="grid grid-cols-2 gap-2">
              {/* Todas */}
              <button
                onClick={() => { setEstacaoSelecionada('Todas'); setOperadoresSelecionados([]); }}
                className={`flex items-center gap-2 p-3 rounded-xl border transition-all cursor-pointer col-span-2 ${
                  estacaoSelecionada === 'Todas'
                    ? 'bg-amber-500 border-amber-400 text-zinc-900'
                    : 'bg-zinc-700 border-zinc-600 text-zinc-200 hover:bg-zinc-600'
                }`}
              >
                <div className="w-5 h-5 flex items-center justify-center">
                  <i className="ri-layout-grid-line text-base" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold">Todas as Estações</p>
                  <p className={`text-[10px] ${estacaoSelecionada === 'Todas' ? 'text-amber-900' : 'text-zinc-500'}`}>
                    Visualiza e gerencia toda a cozinha
                  </p>
                </div>
                {estacaoSelecionada === 'Todas' && (
                  <div className="ml-auto w-4 h-4 flex items-center justify-center">
                    <i className="ri-check-line text-sm" />
                  </div>
                )}
              </button>

              {/* Estações individuais */}
              {estacoesAtivas.map((est) => {
                const aberta = estacoesAbertas.find((e) => e.estacaoId === est.id);
                const selecionada = estacaoSelecionada === est.nome;
                return (
                  <button
                    key={est.id}
                    onClick={() => { setEstacaoSelecionada(est.nome); setOperadoresSelecionados([]); }}
                    className={`flex flex-col p-3 rounded-xl border transition-all cursor-pointer text-left ${
                      selecionada
                        ? 'bg-amber-500 border-amber-400 text-zinc-900'
                        : 'bg-zinc-700 border-zinc-600 text-zinc-200 hover:bg-zinc-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: est.cor }} />
                      {aberta && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          selecionada ? 'bg-amber-600 text-white' : 'bg-emerald-500/20 text-emerald-400'
                        }`}>Aberta</span>
                      )}
                    </div>
                    <p className="text-xs font-bold leading-tight">{est.nome}</p>
                    {aberta && (
                      <p className={`text-[9px] mt-0.5 ${selecionada ? 'text-amber-900' : 'text-zinc-500'}`}>
                        {aberta.operadorNome}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Operadores do turno */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-zinc-400">
                Operadores do Turno
              </label>
              <div className="flex items-center gap-1 bg-zinc-700 rounded-lg p-0.5">
                <button
                  onClick={() => { setModoEntrada('lista'); setNomeAvulso(''); }}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md cursor-pointer transition-colors whitespace-nowrap ${modoEntrada === 'lista' ? 'bg-amber-500 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Selecionar
                </button>
                <button
                  onClick={() => { setModoEntrada('avulso'); setOperadoresSelecionados([]); }}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md cursor-pointer transition-colors whitespace-nowrap ${modoEntrada === 'avulso' ? 'bg-amber-500 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Digitar
                </button>
              </div>
            </div>

            {modoEntrada === 'lista' ? (
              <>
                {operadoresAtivos.length === 0 ? (
                  <p className="text-zinc-500 text-xs text-center py-3">
                    Nenhum operador cadastrado para esta estação.
                    <br />
                    <button onClick={() => setModoEntrada('avulso')} className="text-amber-400 underline mt-1 cursor-pointer">
                      Digite o nome manualmente
                    </button>
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {operadoresAtivos.map((op) => {
                      const sel = operadoresSelecionados.includes(op.nome);
                      return (
                        <button
                          key={op.id}
                          onClick={() => toggleOperador(op.nome)}
                          className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all cursor-pointer text-left ${
                            sel
                              ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                              : 'bg-zinc-700/50 border-zinc-600 text-zinc-300 hover:bg-zinc-700'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                            sel ? 'bg-amber-500 text-zinc-900' : 'bg-zinc-600 text-zinc-300'
                          }`}>
                            {op.nome.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{op.nome.split(' ')[0]}</p>
                            <p className="text-[9px] text-zinc-500 truncate">{op.perfil === 'supervisor' ? 'Supervisor' : 'Operador'}</p>
                          </div>
                          {sel && <i className="ri-check-line text-amber-400 flex-shrink-0 text-xs" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                {operadoresSelecionados.length > 0 && (
                  <div className="mt-2 p-2 bg-amber-500/10 rounded-xl border border-amber-500/20">
                    <p className="text-[10px] font-bold text-amber-400 mb-1">Turno confirmado:</p>
                    <div className="flex flex-wrap gap-1">
                      {operadoresSelecionados.map((nome) => (
                        <span key={nome} className="text-[10px] bg-amber-500 text-zinc-900 font-bold px-2 py-0.5 rounded-full">
                          {nome.split(' ')[0]}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div>
                <input
                  className="w-full bg-zinc-700 border border-zinc-600 text-white rounded-xl px-4 py-2.5 text-sm placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition-colors"
                  placeholder="Ex: João, Maria, Carlos..."
                  value={nomeAvulso}
                  onChange={(e) => { setNomeAvulso(e.target.value); setErro(''); }}
                />
                <p className="text-zinc-500 text-[10px] mt-1">Separe múltiplos nomes com vírgula</p>
              </div>
            )}
            {erro && <p className="text-red-400 text-xs mt-2">{erro}</p>}
          </div>

          {/* Resumo do turno — operadores já logados */}
          {estacoesAbertas.length > 0 && (
            <div className="bg-zinc-700/40 rounded-xl p-3 border border-zinc-600">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                <i className="ri-team-line mr-1" />Já no turno hoje
              </p>
              <div className="space-y-1">
                {estacoesAbertas.map((ea) => (
                  <div key={ea.estacaoId} className="flex items-center gap-2 text-xs">
                    <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">{ea.estacaoNome}</span>
                    <span className="text-zinc-300 font-semibold">{ea.operadorNome}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleEntrar}
            disabled={entrando || !nomeOperadorFinal}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-zinc-900 font-black rounded-xl transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 text-sm"
          >
            {entrando ? (
              <>
                <i className="ri-loader-4-line animate-spin text-base" />
                Abrindo KDS...
              </>
            ) : (
              <>
                <i className="ri-play-fill text-base" />
                Abrir KDS
                {operadoresSelecionados.length > 0 && (
                  <span className="text-xs font-normal opacity-80">({operadoresSelecionados.length} op.)</span>
                )}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
