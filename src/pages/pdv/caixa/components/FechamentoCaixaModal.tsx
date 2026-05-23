import { useState } from 'react';
import { useSessao } from '../../../../contexts/SessaoContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificacoes } from '@/contexts/NotificacoesContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';

interface Props {
  historico: { tipo: 'sangria' | 'suprimento'; valor: number; motivo: string; hora: string }[];
  numPedidos: number;
  totalVendas: number;
  onClose: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

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
// 'justificativa' é a nova etapa entre 'confirmar' e fechar de fato
type Etapa = 'contagem' | 'confirmar' | 'justificativa' | 'concluido';

export default function FechamentoCaixaModal({ onClose }: Props) {
  const { caixa, fecharCaixa } = useSessao();
  const { user } = useAuth();
  const { dispararNotificacao } = useNotificacoes();
  const { registrarEvento } = useAuditoria();

  const [etapa, setEtapa] = useState<Etapa>('contagem');
  const [modoContagem, setModoContagem] = useState(false);
  const [contagem, setContagem] = useState<Contagem>({});
  const [valorManual, setValorManual] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  /* Valor contado */
  const totalContagem = Object.entries(contagem).reduce(
    (acc, [val, qty]) => acc + Number(val) * qty,
    0,
  );
  const valorDeclarado = modoContagem
    ? totalContagem
    : parseFloat(valorManual.replace(',', '.')) || 0;

  /* Diferença calculada localmente (antes de fechar) */
  const valorEsperado = caixa?.valorAbertura ?? 0;
  const diferencaPrevia = valorDeclarado - valorEsperado;
  const temDiferenca = Math.abs(diferencaPrevia) > 0.01;

  const setQtd = (denominacao: number, qtd: number) => {
    setContagem((prev) => ({ ...prev, [denominacao]: Math.max(0, qtd) }));
  };

  /* ─── Handlers ─── */
  const handleIrParaConfirmar = () => {
    if (valorDeclarado < 0 || isNaN(valorDeclarado)) {
      setErro('Informe o valor em dinheiro no caixa.');
      return;
    }
    setErro('');
    setEtapa('confirmar');
  };

  /* Ao clicar "Confirmar e fechar":
     - Se tiver diferença → vai para etapa de justificativa (sem fechar ainda)
     - Se não tiver diferença → fecha direto */
  const handleConfirmarEFechar = () => {
    if (temDiferenca) {
      setJustificativa('');
      setErro('');
      setEtapa('justificativa');
    } else {
      executarFechamento('');
    }
  };

  /* Fecha o caixa de fato (chamado após justificativa ou direto se sem diferença) */
  const executarFechamento = async (justificativaTexto: string) => {
    setSalvando(true);
    const caixaId = caixa?.id ?? '';
    try {
      // Passa a justificativa direto na RPC para evitar ambiguidade de overload
      await fecharCaixa(valorDeclarado, justificativaTexto.trim() || undefined);

      const diff = diferencaPrevia;

      registrarEvento({
        tipo: 'fechamento_caixa',
        severidade: Math.abs(diff) > 50 ? 'aviso' : 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? 'operador',
        descricao: `Caixa fechado. Contado: ${fmt(valorDeclarado)}${Math.abs(diff) > 0.01 ? ` | Diferença: ${fmt(diff)}` : ' | Sem diferenças'}${justificativaTexto ? ` | Justificativa: ${justificativaTexto}` : ''}`,
        entidade: 'caixa',
        entidadeId: caixaId || '—',
        depois: { valor_contado: valorDeclarado, diferenca: diff },
      });

      if (Math.abs(diff) > 0.01) {
        const isNeg = diff < 0;
        const fmt2 = (v: number) =>
          new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(v));
        dispararNotificacao({
          tipo: 'diferenca_caixa',
          titulo: 'Diferença no fechamento de caixa',
          mensagem: `${isNeg ? 'Faltaram' : 'Sobraram'} ${fmt2(diff)} no caixa. Contado: ${fmt2(valorDeclarado)}`,
          urgente: Math.abs(diff) > 50,
          perfisAlvo: ['gerente', 'admin'],
          icone: 'ri-safe-2-line',
          cor: 'red',
          extra: { diff, valorDeclarado },
        });
      }

      setEtapa('concluido');
      setTimeout(onClose, 2200);
    } finally {
      setSalvando(false);
    }
  };

  /* Confirmar justificativa e fechar */
  const handleConfirmarJustificativa = () => {
    if (justificativa.trim().length < 5) {
      setErro('A justificativa deve ter pelo menos 5 caracteres.');
      return;
    }
    setErro('');
    executarFechamento(justificativa);
  };

  /* ─── ETAPA: concluido ─── */
  if (etapa === 'concluido') {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 w-full max-w-xs flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-emerald-100 rounded-full">
            <i className="ri-checkbox-circle-line text-emerald-500 text-3xl" />
          </div>
          <div>
            <p className="text-xl font-black text-zinc-900">Caixa fechado!</p>
            <p className="text-sm text-zinc-500 mt-1">Registros salvos com sucesso.</p>
            {!temDiferenca && (
              <p className="text-xs text-emerald-600 font-semibold mt-2 bg-emerald-50 px-3 py-1.5 rounded-lg">
                <i className="ri-checkbox-circle-fill mr-1" />Caixa conferido sem diferenças
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ─── ETAPA: justificativa ─── */
  /* Aparece ANTES de fechar, quando há diferença. Sem botão de fechar/cancelar. */
  if (etapa === 'justificativa') {
    const isNegativo = diferencaPrevia < 0;
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
          {/* Header — sem botão de fechar */}
          <div className="px-6 py-5 border-b border-zinc-100">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-5 h-5 flex items-center justify-center text-amber-500">
                <i className="ri-alert-line text-base" />
              </div>
              <h2 className="text-sm font-bold text-zinc-900">Diferença detectada</h2>
            </div>
            <p className="text-xs text-zinc-400">
              O caixa será fechado após a justificativa. Esta ação é irreversível.
            </p>
          </div>

          <div className="p-6 space-y-5">
            {/* Card de diferença */}
            <div className={`flex items-center justify-between px-5 py-4 rounded-2xl ${isNegativo ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
              <div>
                <p className={`text-xs font-bold ${isNegativo ? 'text-red-700' : 'text-amber-700'}`}>
                  {isNegativo ? 'Faltou dinheiro no caixa' : 'Sobrou dinheiro no caixa'}
                </p>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Valor contado: {fmt(valorDeclarado)}
                </p>
              </div>
              <p className={`text-2xl font-black ${isNegativo ? 'text-red-600' : 'text-amber-600'}`}>
                {diferencaPrevia > 0 ? '+' : ''}{fmt(diferencaPrevia)}
              </p>
            </div>

            {/* Aviso de ponto sem retorno */}
            <div className="flex items-start gap-2 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl">
              <div className="w-4 h-4 flex items-center justify-center text-zinc-500 mt-0.5 flex-shrink-0">
                <i className="ri-lock-line text-sm" />
              </div>
              <p className="text-xs text-zinc-600">
                A partir daqui <strong>não é possível voltar</strong> para recontar. Justifique a diferença para concluir o fechamento.
              </p>
            </div>

            {/* Campo de justificativa */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Justificativa <span className="text-red-400">*</span>
                <span className="text-zinc-400 font-normal ml-1">(mínimo 5 caracteres)</span>
              </label>
              <textarea
                value={justificativa}
                onChange={(e) => { setJustificativa(e.target.value); setErro(''); }}
                placeholder="Ex: Troco incorreto dado ao cliente, sobra de troco da abertura..."
                rows={3}
                maxLength={500}
                className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-amber-400 resize-none"
              />
              <div className="flex items-center justify-between mt-1">
                {erro
                  ? <p className="text-xs text-red-500">{erro}</p>
                  : <span />
                }
                <span className={`text-[10px] ml-auto ${justificativa.length < 5 ? 'text-zinc-400' : 'text-emerald-500'}`}>
                  {justificativa.length}/500
                </span>
              </div>
            </div>

            {/* Botão único — sem cancelar */}
            <button
              onClick={handleConfirmarJustificativa}
              disabled={salvando || justificativa.trim().length < 5}
              className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              {salvando ? (
                <>
                  <i className="ri-loader-4-line animate-spin text-base" />
                  Fechando caixa...
                </>
              ) : (
                <>
                  <i className="ri-lock-2-line text-base" />
                  Justificar e fechar caixa
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── ETAPA: confirmar ─── */
  if (etapa === 'confirmar') {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-zinc-100">
            <h2 className="text-sm font-bold text-zinc-900">Confirmar fechamento</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Confirme o valor contado e feche o caixa.</p>
          </div>
          <div className="p-6 space-y-5">
            <div className="bg-zinc-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Valor contado</span>
                <span className="font-bold text-zinc-900">{fmt(valorDeclarado)}</span>
              </div>
            </div>

            {/* Aviso irreversível */}
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
              <div className="w-4 h-4 flex items-center justify-center text-red-500 mt-0.5 flex-shrink-0">
                <i className="ri-alert-line text-sm" />
              </div>
              <p className="text-xs text-red-700 font-medium">
                <strong>Ação irreversível.</strong> Após confirmar, não será possível reabrir o caixa.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setEtapa('contagem')}
                disabled={salvando}
                className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                Recontar
              </button>
              <button
                onClick={handleConfirmarEFechar}
                disabled={salvando}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl cursor-pointer whitespace-nowrap disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {salvando ? (
                  <>
                    <i className="ri-loader-4-line animate-spin text-base" />
                    Aguarde...
                  </>
                ) : (
                  'Confirmar e fechar'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─── ETAPA: contagem ─── */
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Fechar Caixa</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Conte o dinheiro físico no caixa</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Toggle modo */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-zinc-700">Valor contado em caixa (R$)</label>
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
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-semibold">R$</span>
              <input
                type="number" min="0" step="0.01" value={valorManual}
                onChange={(e) => { setValorManual(e.target.value); setErro(''); }}
                placeholder="0,00"
                className="w-full pl-9 pr-4 py-3 text-xl font-bold border border-zinc-200 rounded-xl text-zinc-800 focus:outline-none focus:border-amber-400"
              />
            </div>
          ) : (
            /* Contagem de notas e moedas */
            <div className="border border-zinc-100 rounded-xl overflow-hidden">
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
                        <button onClick={() => setQtd(valor, qty - 1)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 cursor-pointer text-sm font-bold">−</button>
                        <input type="number" min={0} value={qty === 0 ? '' : qty}
                          onChange={(e) => setQtd(valor, parseInt(e.target.value) || 0)}
                          placeholder="0"
                          className="w-12 text-center text-sm font-semibold border border-zinc-200 rounded-lg py-1 focus:outline-none focus:border-amber-400" />
                        <button onClick={() => setQtd(valor, qty + 1)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 cursor-pointer text-sm font-bold">+</button>
                      </div>
                      <span className={`text-xs font-semibold w-16 text-right ${subtotal > 0 ? 'text-amber-600' : 'text-zinc-300'}`}>
                        {subtotal > 0 ? fmt(subtotal) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
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
                        <button onClick={() => setQtd(valor, qty - 1)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 cursor-pointer text-sm font-bold">−</button>
                        <input type="number" min={0} value={qty === 0 ? '' : qty}
                          onChange={(e) => setQtd(valor, parseInt(e.target.value) || 0)}
                          placeholder="0"
                          className="w-12 text-center text-sm font-semibold border border-zinc-200 rounded-lg py-1 focus:outline-none focus:border-amber-400" />
                        <button onClick={() => setQtd(valor, qty + 1)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 cursor-pointer text-sm font-bold">+</button>
                      </div>
                      <span className={`text-xs font-semibold w-16 text-right ${subtotal > 0 ? 'text-amber-600' : 'text-zinc-300'}`}>
                        {subtotal > 0 ? fmt(subtotal) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border-t border-amber-100">
                <span className="text-xs font-bold text-amber-800">Total contado</span>
                <span className="text-lg font-black text-amber-700">{fmt(totalContagem)}</span>
              </div>
            </div>
          )}

          {erro && <p className="text-xs text-red-500">{erro}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-zinc-100 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
            Cancelar
          </button>
          <button onClick={handleIrParaConfirmar}
            className="flex-1 py-2.5 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl cursor-pointer whitespace-nowrap">
            Fechar Caixa
          </button>
        </div>
      </div>
    </div>
  );
}