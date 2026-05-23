import { useState } from 'react';
import { useSessao } from '../../../../contexts/SessaoContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';

interface Props {
  onClose: () => void;
}

/* ─── Denominações ─── */
const NOTAS = [
  { label: 'R$ 200', valor: 200 },
  { label: 'R$ 100', valor: 100 },
  { label: 'R$ 50',  valor: 50  },
  { label: 'R$ 20',  valor: 20  },
  { label: 'R$ 10',  valor: 10  },
  { label: 'R$ 5',   valor: 5   },
  { label: 'R$ 2',   valor: 2   },
];
const MOEDAS = [
  { label: 'R$ 1',    valor: 1    },
  { label: 'R$ 0,50', valor: 0.5  },
  { label: 'R$ 0,25', valor: 0.25 },
  { label: 'R$ 0,10', valor: 0.10 },
  { label: 'R$ 0,05', valor: 0.05 },
];

type Contagem = Record<number, number>;

function calcTotal(contagem: Contagem): number {
  return Object.entries(contagem).reduce((acc, [val, qty]) => acc + Number(val) * qty, 0);
}

export default function AberturaCaixaModal({ onClose }: Props) {
  const { abrirCaixa } = useSessao();
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();

  const [modoContagem, setModoContagem] = useState(false);
  const [contagem, setContagem] = useState<Contagem>({});
  const [valorManual, setValorManual] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');
  const [abrindo, setAbrindo] = useState(false);

  const operadorNome = user?.nome ?? 'Operador';
  const totalContagem = calcTotal(contagem);
  const valorFinal = modoContagem ? totalContagem : parseFloat(valorManual.replace(',', '.')) || 0;

  const setQtd = (denominacao: number, qtd: number) => {
    setContagem((prev) => ({ ...prev, [denominacao]: Math.max(0, qtd) }));
    setErro('');
  };

  const handleAbrir = async () => {
    if (valorFinal < 0 || isNaN(valorFinal)) {
      setErro('Informe um valor válido para abertura de caixa.');
      return;
    }
    setErro('');
    setAbrindo(true);
    try {
      await abrirCaixa(valorFinal, operadorNome, observacao.trim() || undefined);
      registrarEvento({
        tipo: 'abertura_caixa',
        severidade: 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? 'operador',
        descricao: `Caixa aberto com fundo de R$ ${valorFinal.toFixed(2)}${observacao ? ` — ${observacao}` : ''}`,
        entidade: 'caixa',
        entidadeId: user?.tenantId ?? '—',
        depois: { valor_abertura: valorFinal },
      });
      onClose();
    } catch (e: unknown) {
      console.error('[AberturaCaixaModal] error:', e);
      const msg = e instanceof Error ? e.message : 'Erro ao abrir o caixa. Tente novamente.';
      setErro(msg);
      setAbrindo(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex flex-col items-center text-center px-6 pt-7 pb-4 flex-shrink-0">
          <div className="w-14 h-14 flex items-center justify-center bg-amber-100 rounded-2xl mb-3">
            <i className="ri-safe-2-line text-2xl text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900">Abrir Caixa</h2>
          <p className="text-zinc-500 text-sm mt-1">Informe o fundo de caixa inicial</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-4">
          {/* Operador — read-only */}
          <div>
            <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Operador</label>
            <div className="flex items-center gap-2.5 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2.5">
              <div className="w-7 h-7 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
                <i className="ri-user-line text-amber-600 text-sm" />
              </div>
              <span className="text-sm font-semibold text-zinc-800 flex-1">{operadorNome}</span>
              <div className="flex items-center gap-1 text-zinc-400">
                <i className="ri-lock-line text-xs" />
                <span className="text-[10px] font-medium">Login ativo</span>
              </div>
            </div>
          </div>

          {/* Modo de entrada do valor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-zinc-700">Valor de Abertura (R$)</label>
              <div className="flex bg-zinc-100 rounded-lg p-0.5">
                <button
                  onClick={() => setModoContagem(false)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer transition-all whitespace-nowrap ${!modoContagem ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                >
                  Digitar
                </button>
                <button
                  onClick={() => setModoContagem(true)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer transition-all whitespace-nowrap ${modoContagem ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                >
                  Contar cédulas
                </button>
              </div>
            </div>

            {!modoContagem ? (
              <>
                {/* Input manual */}
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-medium">R$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0,00"
                    value={valorManual}
                    onChange={(e) => { setValorManual(e.target.value); setErro(''); }}
                    className="w-full pl-9 pr-4 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 text-zinc-900"
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  {[50, 100, 150, 200].map((v) => (
                    <button
                      key={v}
                      onClick={() => { setValorManual(String(v)); setErro(''); }}
                      className="py-2 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-amber-50 hover:border-amber-300 cursor-pointer transition-colors"
                    >
                      R$ {v}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              /* Contagem de cédulas e moedas */
              <div className="border border-zinc-100 rounded-xl overflow-hidden">
                {/* Notas */}
                <div className="px-3 py-2 bg-zinc-50 border-b border-zinc-100">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Cédulas</p>
                </div>
                <div className="divide-y divide-zinc-50">
                  {NOTAS.map(({ label, valor }) => {
                    const qty = contagem[valor] ?? 0;
                    const subtotal = qty * valor;
                    return (
                      <div key={valor} className="flex items-center gap-3 px-3 py-2">
                        <span className="w-16 text-xs font-bold text-zinc-700">{label}</span>
                        <div className="flex items-center gap-2 flex-1">
                          <button
                            onClick={() => setQtd(valor, qty - 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 cursor-pointer transition-colors font-bold text-sm"
                          >−</button>
                          <input
                            type="number"
                            min={0}
                            value={qty === 0 ? '' : qty}
                            onChange={(e) => setQtd(valor, parseInt(e.target.value) || 0)}
                            placeholder="0"
                            className="w-12 text-center text-sm font-semibold border border-zinc-200 rounded-lg py-1 focus:outline-none focus:border-amber-400"
                          />
                          <button
                            onClick={() => setQtd(valor, qty + 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 cursor-pointer transition-colors font-bold text-sm"
                          >+</button>
                        </div>
                        <span className={`text-xs font-semibold w-16 text-right ${subtotal > 0 ? 'text-amber-600' : 'text-zinc-300'}`}>
                          {subtotal > 0 ? `R$ ${subtotal.toFixed(2)}` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Moedas */}
                <div className="px-3 py-2 bg-zinc-50 border-y border-zinc-100">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Moedas</p>
                </div>
                <div className="divide-y divide-zinc-50">
                  {MOEDAS.map(({ label, valor }) => {
                    const qty = contagem[valor] ?? 0;
                    const subtotal = qty * valor;
                    return (
                      <div key={valor} className="flex items-center gap-3 px-3 py-2">
                        <span className="w-16 text-xs font-bold text-zinc-700">{label}</span>
                        <div className="flex items-center gap-2 flex-1">
                          <button
                            onClick={() => setQtd(valor, qty - 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 cursor-pointer transition-colors font-bold text-sm"
                          >−</button>
                          <input
                            type="number"
                            min={0}
                            value={qty === 0 ? '' : qty}
                            onChange={(e) => setQtd(valor, parseInt(e.target.value) || 0)}
                            placeholder="0"
                            className="w-12 text-center text-sm font-semibold border border-zinc-200 rounded-lg py-1 focus:outline-none focus:border-amber-400"
                          />
                          <button
                            onClick={() => setQtd(valor, qty + 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 cursor-pointer transition-colors font-bold text-sm"
                          >+</button>
                        </div>
                        <span className={`text-xs font-semibold w-16 text-right ${subtotal > 0 ? 'text-amber-600' : 'text-zinc-300'}`}>
                          {subtotal > 0 ? `R$ ${subtotal.toFixed(2)}` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Total da contagem */}
                <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border-t border-amber-100">
                  <span className="text-xs font-bold text-amber-800">Total contado</span>
                  <span className="text-lg font-black text-amber-700">R$ {totalContagem.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Observação */}
          <div>
            <label className="block text-sm font-semibold text-zinc-700 mb-1.5">
              Observação <span className="text-zinc-400 font-normal">(opcional)</span>
            </label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: Fundo de caixa composto de notas pequenas para troco, cédulas verificadas..."
              rows={2}
              maxLength={300}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 text-zinc-800 resize-none"
            />
            <p className="text-[10px] text-zinc-400 text-right mt-0.5">{observacao.length}/300</p>
          </div>

          {/* Total final destacado */}
          {(valorFinal > 0) && (
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl">
              <div>
                <p className="text-xs font-bold text-emerald-800">Valor de abertura</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">
                  {modoContagem ? 'Calculado pela contagem de cédulas/moedas' : 'Digitado manualmente'}
                </p>
              </div>
              <span className="text-xl font-black text-emerald-700">R$ {valorFinal.toFixed(2)}</span>
            </div>
          )}

          {erro && <p className="text-red-500 text-xs">{erro}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-5 flex-shrink-0 border-t border-zinc-100">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleAbrir}
            disabled={abrindo}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold text-sm rounded-xl transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
          >
            {abrindo ? (
              <>
                <i className="ri-loader-4-line animate-spin" />
                Abrindo...
              </>
            ) : (
              <>
                <i className="ri-safe-2-line" />
                Abrir Caixa
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
