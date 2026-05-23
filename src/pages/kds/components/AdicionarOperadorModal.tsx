import { useState, useMemo } from 'react';
import { useSessao } from '../../../contexts/SessaoContext';
import { useCardapio } from '../../../contexts/CardapioContext';
import { useUsuarios } from '../../../hooks/useUsuarios';

interface Props {
  onClose: () => void;
  estacaoAtual: string;
}

export default function AdicionarOperadorModal({ onClose, estacaoAtual }: Props) {
  const { abrirEstacao, estacoesAbertas } = useSessao();
  const [estacaoSelecionada, setEstacaoSelecionada] = useState(
    estacaoAtual !== 'Todas' ? estacaoAtual : '',
  );
  const [modoEntrada, setModoEntrada] = useState<'lista' | 'avulso'>('lista');
  const [operadoresSelecionados, setOperadoresSelecionados] = useState<string[]>([]);
  const [nomeAvulso, setNomeAvulso] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  const { estacoes } = useCardapio();
  const { usuarios } = useUsuarios();
  const estacoesAtivas = estacoes.filter((e) => e.ativo);
  const operadoresAtivos = useMemo(() => {
    return usuarios.filter((u) => u.ativo && ['cozinha', 'gerente', 'admin'].includes(u.perfil));
  }, [usuarios]);

  const toggleOperador = (nome: string) => {
    setOperadoresSelecionados((prev) =>
      prev.includes(nome) ? prev.filter((n) => n !== nome) : [...prev, nome],
    );
    setErro('');
  };

  const nomeOperadorFinal =
    modoEntrada === 'avulso' ? nomeAvulso.trim() : operadoresSelecionados.join(', ');

  const handleSalvar = () => {
    if (!estacaoSelecionada) {
      setErro('Selecione a estação de trabalho.');
      return;
    }
    if (!nomeOperadorFinal) {
      setErro(
        modoEntrada === 'lista' ? 'Selecione pelo menos um operador.' : 'Informe o nome do operador.',
      );
      return;
    }
    setErro('');
    setSalvando(true);
    setTimeout(() => {
      const est = estacoesAtivas.find((e) => e.nome === estacaoSelecionada);
      if (est) {
        abrirEstacao(est.id, est.nome, nomeOperadorFinal);
      }
      setSucesso(true);
      setTimeout(onClose, 1200);
    }, 600);
  };

  if (sucesso) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
        <div className="bg-zinc-800 rounded-2xl p-8 w-full max-w-sm border border-zinc-700 text-center">
          <div className="w-14 h-14 flex items-center justify-center bg-emerald-500/20 rounded-full mx-auto mb-4">
            <i className="ri-check-line text-2xl text-emerald-400" />
          </div>
          <p className="text-white font-bold">Operador adicionado!</p>
          <p className="text-zinc-400 text-sm mt-1">
            {nomeOperadorFinal} · {estacaoSelecionada}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-md border border-zinc-700 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-500/20 rounded-xl">
              <i className="ri-user-add-line text-amber-400 text-base" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">Adicionar Operador</h3>
              <p className="text-zinc-400 text-xs">Durante o turno</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-700 cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Estação */}
          <div>
            <p className="text-xs font-semibold text-zinc-400 mb-2">Estação de Trabalho</p>
            <div className="grid grid-cols-2 gap-2">
              {estacoesAtivas.map((est) => {
                const aberta = estacoesAbertas.find((e) => e.estacaoId === est.id);
                const sel = estacaoSelecionada === est.nome;
                return (
                  <button
                    key={est.id}
                    onClick={() => {
                      setEstacaoSelecionada(est.nome);
                      setOperadoresSelecionados([]);
                      setErro('');
                    }}
                    className={`flex flex-col p-3 rounded-xl border transition-all cursor-pointer text-left ${
                      sel
                        ? 'bg-amber-500 border-amber-400 text-zinc-900'
                        : 'bg-zinc-700 border-zinc-600 text-zinc-200 hover:bg-zinc-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: est.cor }}
                      />
                      {aberta && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            sel ? 'bg-amber-600 text-white' : 'bg-emerald-500/20 text-emerald-400'
                          }`}
                        >
                          Aberta
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-bold leading-tight">{est.nome}</p>
                    {aberta && (
                      <p className={`text-[9px] mt-0.5 ${sel ? 'text-amber-900' : 'text-zinc-500'}`}>
                        {aberta.operadorNome}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Operadores */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-zinc-400">Operador</p>
              <div className="flex items-center gap-1 bg-zinc-700 rounded-lg p-0.5">
                <button
                  onClick={() => {
                    setModoEntrada('lista');
                    setNomeAvulso('');
                  }}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                    modoEntrada === 'lista'
                      ? 'bg-amber-500 text-zinc-900'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Selecionar
                </button>
                <button
                  onClick={() => {
                    setModoEntrada('avulso');
                    setOperadoresSelecionados([]);
                  }}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                    modoEntrada === 'avulso'
                      ? 'bg-amber-500 text-zinc-900'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Digitar
                </button>
              </div>
            </div>

            {modoEntrada === 'lista' ? (
              <>
                {operadoresAtivos.length === 0 ? (
                  <p className="text-zinc-500 text-xs text-center py-3">
                    Nenhum operador disponível.{' '}
                    <button
                      onClick={() => setModoEntrada('avulso')}
                      className="text-amber-400 underline cursor-pointer"
                    >
                      Digite manualmente
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
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                              sel ? 'bg-amber-500 text-zinc-900' : 'bg-zinc-600 text-zinc-300'
                            }`}
                          >
                            {op.nome.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{op.nome.split(' ')[0]}</p>
                            <p className="text-[9px] text-zinc-500 truncate">
                              {['admin','gerente'].includes(op.perfil) ? 'Supervisor' : 'Operador'}
                            </p>
                          </div>
                          {sel && <i className="ri-check-line text-amber-400 flex-shrink-0 text-xs" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                {operadoresSelecionados.length > 0 && (
                  <div className="mt-2 p-2 bg-amber-500/10 rounded-xl border border-amber-500/20">
                    <p className="text-[10px] font-bold text-amber-400 mb-1">Selecionado(s):</p>
                    <div className="flex flex-wrap gap-1">
                      {operadoresSelecionados.map((nome) => (
                        <span
                          key={nome}
                          className="text-[10px] bg-amber-500 text-zinc-900 font-bold px-2 py-0.5 rounded-full"
                        >
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
                  type="text"
                  value={nomeAvulso}
                  onChange={(e) => {
                    setNomeAvulso(e.target.value);
                    setErro('');
                  }}
                  placeholder="Ex: Pedro Costa"
                  className="w-full bg-zinc-700 border border-zinc-600 text-white rounded-xl px-4 py-2.5 text-sm placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition-colors"
                />
                <p className="text-zinc-500 text-[10px] mt-1">Separe múltiplos nomes com vírgula</p>
              </div>
            )}
          </div>

          {/* Operadores já no turno */}
          {estacoesAbertas.length > 0 && (
            <div className="bg-zinc-700/40 rounded-xl p-3 border border-zinc-600">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                <i className="ri-team-line mr-1" />
                Operadores no turno
              </p>
              <div className="space-y-1">
                {estacoesAbertas.map((ea) => (
                  <div key={ea.estacaoId} className="flex items-center gap-2 text-xs">
                    <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      {ea.estacaoNome}
                    </span>
                    <span className="text-zinc-300 font-semibold">{ea.operadorNome}</span>
                    <span className="text-zinc-600 text-[9px] ml-auto">{ea.abertaEm}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {erro && (
            <p className="text-red-400 text-xs flex items-center gap-1.5">
              <i className="ri-error-warning-line" />
              {erro}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-700 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={salvando || !nomeOperadorFinal || !estacaoSelecionada}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-900 text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            {salvando ? (
              <>
                <i className="ri-loader-4-line animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <i className="ri-user-add-line" />
                Adicionar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
