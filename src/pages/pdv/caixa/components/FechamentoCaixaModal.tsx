import { useState, useEffect, useRef } from 'react';
import { useSessao } from '../../../../contexts/SessaoContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificacoes } from '@/contexts/NotificacoesContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { supabase } from '@/lib/supabase';

interface Props {
  caixaId: string;
  historico: { tipo: 'sangria' | 'suprimento'; valor: number; motivo: string; hora: string }[];
  numPedidos: number;
  totalVendas: number;
  onClose: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtSemSinal = (v: number) => {
  const abs = Math.abs(v);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(abs);
};

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
type Etapa = 'contagem' | 'confirmar' | 'justificativa' | 'concluido';

export default function FechamentoCaixaModal({ caixaId, historico, onClose }: Props) {
  const { caixa, fecharCaixa, sinalizarCaixaFechadoLocalmente } = useSessao();
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

  // ── Totais reais de dinheiro (buscados do banco) ──
  const [loadingTotais, setLoadingTotais] = useState(true);
  const [totalCashRecebido, setTotalCashRecebido] = useState(0);
  const [totalTroco, setTotalTroco] = useState(0);

  // ── Valores apurados pelo RPC de fechamento (lidos após fechar) ──
  const diferencaRpcRef = useRef<number | null>(null);
  const esperadoRpcRef = useRef<number | null>(null);

  // Busca os totais de dinheiro assim que o modal abre
  useEffect(() => {
    if (!caixaId) {
      setLoadingTotais(false);
      return;
    }

    let cancelled = false;
    setLoadingTotais(true);

    (async () => {
      try {
        // 1. IDs dos métodos de pagamento do tipo 'cash'
        const { data: cashMethods } = await supabase
          .from('payment_methods')
          .select('id')
          .eq('tenant_id', user?.tenantId ?? '')
          .eq('type', 'cash')
          .eq('is_active', true);

        const cashMethodIds = (cashMethods ?? []).map((m: { id: string }) => m.id);

        if (cashMethodIds.length === 0) {
          if (!cancelled) {
            setTotalCashRecebido(0);
            setTotalTroco(0);
            setLoadingTotais(false);
          }
          return;
        }

        // 2. Soma amount e change_amount dos pagamentos em dinheiro deste caixa
        const { data: pagamentos } = await supabase
          .from('payments')
          .select('amount, change_amount')
          .eq('tenant_id', user?.tenantId ?? '')
          .eq('cash_register_id', caixaId)
          .eq('is_refunded', false)
          .in('payment_method_id', cashMethodIds);

        const recebido = (pagamentos ?? []).reduce(
          (s: number, p: { amount: number }) => s + (Number(p.amount) || 0),
          0,
        );
        const troco = (pagamentos ?? []).reduce(
          (s: number, p: { change_amount: number }) => s + (Number(p.change_amount) || 0),
          0,
        );

        if (!cancelled) {
          setTotalCashRecebido(recebido);
          setTotalTroco(troco);
          setLoadingTotais(false);
        }
      } catch {
        if (!cancelled) {
          setTotalCashRecebido(0);
          setTotalTroco(0);
          setLoadingTotais(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [caixaId, user?.tenantId]);

  /* Valor contado */
  const totalContagem = Object.entries(contagem ?? {}).reduce(
    (acc, [val, qty]) => acc + Number(val) * qty,
    0,
  );
  const valorDeclarado = modoContagem
    ? totalContagem
    : parseFloat(valorManual.replace(',', '.')) || 0;

  /* Valor esperado CORRETO no caixa */
  const abertura = caixa?.valorAbertura ?? 0;
  const retiradas = historico
    .filter((m) => m.tipo === 'sangria')
    .reduce((s, m) => s + m.valor, 0);
  const adicoes = historico
    .filter((m) => m.tipo === 'suprimento')
    .reduce((s, m) => s + m.valor, 0);

  // Fórmula correta:
  // O amount já é o valor líquido que entrou no caixa (já descontado o troco).
  // O dinheiro físico no caixa = abertura + totalCashRecebido - retiradas + adições.
  // NÃO subtraímos totalTroco aqui porque o amount já é líquido.
  const valorEsperado = abertura + totalCashRecebido - retiradas + adicoes;

  /* Diferença calculada corretamente */
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
     - Fecha o caixa no banco (com skipLocalUpdate=true para manter o modal aberto)
     - Lê o fechamento real do banco (esperado e diferença calculados pelo RPC)
     - Se tiver diferença → vai pra tela de justificativa
     - Se não tiver diferença → vai direto pra concluído */
  const handleConfirmarEFechar = async () => {
    await executarFechamento('', true);

    // Lê o resultado real do RPC para garantir que usamos os mesmos valores
    const diffRpc = diferencaRpcRef.current;
    const espRpc = esperadoRpcRef.current;

    if (diffRpc !== null && Math.abs(diffRpc) > 0.01) {
      setJustificativa('');
      setErro('');
      setEtapa('justificativa');
    } else if (temDiferenca) {
      // Fallback: se o RPC não retornou diferença mas o cálculo local detectou
      setJustificativa('');
      setErro('');
      setEtapa('justificativa');
    } else {
      // BUG FIX: sem diferença, sincroniza o estado local antes de fechar a modal
      // para que a modal de Fechar Sessão não mostre "caixa ainda aberto"
      sinalizarCaixaFechadoLocalmente();
      setEtapa('concluido');
      setTimeout(onClose, 2200);
    }
  };

  /* Fecha o caixa de fato (chamado na confirmar ou após justificativa) */
  const executarFechamento = async (justificativaTexto: string, skipLocalUpdate?: boolean) => {
    setSalvando(true);
    try {
      await fecharCaixa(valorDeclarado, justificativaTexto.trim() || undefined, skipLocalUpdate);

      // Lê os valores reais calculados pelo RPC
      try {
        const { data: reg } = await supabase
          .from('cash_registers')
          .select('closing_value_expected, closing_difference')
          .eq('id', caixaId)
          .single();

        if (reg) {
          diferencaRpcRef.current = Number(reg.closing_difference) || 0;
          esperadoRpcRef.current = Number(reg.closing_value_expected) || 0;
        }
      } catch {
        // Se falhar a leitura, confia no cálculo local
        diferencaRpcRef.current = diferencaPrevia;
        esperadoRpcRef.current = valorEsperado;
      }

      const diff = diferencaRpcRef.current ?? diferencaPrevia;
      const esp = esperadoRpcRef.current ?? valorEsperado;

      registrarEvento({
        tipo: 'fechamento_caixa',
        severidade: Math.abs(diff) > 50 ? 'aviso' : 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? 'operador',
        descricao: `Caixa fechado. Contado: ${fmt(valorDeclarado)} | Esperado (RPC): ${fmt(esp)}${Math.abs(diff) > 0.01 ? ` | Diferença: ${fmt(diff)}` : ' | Sem diferenças'}${justificativaTexto ? ` | Justificativa: ${justificativaTexto}` : ''}`,
        entidade: 'caixa',
        entidadeId: caixaId || '—',
        depois: { valor_contado: valorDeclarado, valor_esperado: esp, diferenca: diff },
      });

      if (Math.abs(diff) > 0.01) {
        const isNeg = diff < 0;
        const fmt2 = (v: number) =>
          new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(v));
        dispararNotificacao({
          tipo: 'diferenca_caixa',
          titulo: 'Diferença no fechamento de caixa',
          mensagem: `${isNeg ? 'Faltaram' : 'Sobraram'} ${fmt2(diff)} no caixa. Contado: ${fmt2(valorDeclarado)} | Esperado: ${fmt2(esp)}`,
          urgente: Math.abs(diff) > 50,
          perfisAlvo: ['gerente', 'admin'],
          icone: 'ri-safe-2-line',
          cor: 'red',
          extra: { diff, valorDeclarado, valorEsperado: esp },
        });
      }
    } finally {
      setSalvando(false);
    }
  };

  /* Confirmar justificativa — caixa já foi fechado no banco na etapa anterior.
     Atualiza o closing_notes no banco e registra no audit log. */
  const handleJustificar = async () => {
    if (justificativa.trim().length < 5) {
      setErro('A justificativa deve ter pelo menos 5 caracteres.');
      return;
    }
    setErro('');
    setSalvando(true);
    try {
      // Atualiza a justificativa via RPC (SECURITY DEFINER burla o RLS de deny_direct_write)
      const { error: updateError } = await supabase.rpc('fn_update_cash_register_notes', {
        p_id: caixaId,
        p_notes: justificativa.trim(),
      });

      if (updateError) {
        console.error('[FechamentoCaixaModal] Erro ao salvar justificativa:', updateError);
        setErro('Erro ao salvar justificativa. Tente novamente.');
        return;
      }

      registrarEvento({
        tipo: 'justificativa_diferenca',
        severidade: Math.abs(diferencaPrevia) > 50 ? 'aviso' : 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? 'operador',
        descricao: `Justificativa da diferença de ${fmt(diferencaPrevia)} no fechamento: ${justificativa.trim()}`,
        entidade: 'caixa',
        entidadeId: caixaId || '—',
        depois: { diferenca: diferencaPrevia, justificativa: justificativa.trim() },
      });
    } catch (e) {
      console.error('[FechamentoCaixaModal] Erro inesperado ao justificar:', e);
      setErro('Erro inesperado. Tente novamente.');
      return;
    } finally {
      setSalvando(false);
    }
    onClose();
  };

  // Bloqueia ESC na etapa de justificativa (usuário deve justificar antes de sair)
  useEffect(() => {
    if (etapa !== 'justificativa') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [etapa]);

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
  const diffExibicao = diferencaRpcRef.current ?? diferencaPrevia;
  const espExibicao = esperadoRpcRef.current ?? valorEsperado;

  if (etapa === 'justificativa') {
    const isNegativo = diffExibicao < 0;
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
          {/* Header — sem botão de fechar, usuário deve justificar */}
          <div className="px-6 py-5 border-b border-zinc-100">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-5 h-5 flex items-center justify-center text-amber-500">
                <i className="ri-alert-line text-base" />
              </div>
              <h2 className="text-sm font-bold text-zinc-900">Justificar diferença</h2>
            </div>
            <p className="text-xs text-zinc-400">
              Foi encontrada uma <strong className="text-zinc-600">diferença</strong> entre o valor contado e o esperado.
              O caixa já foi fechado. Registre o motivo para continuar.
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
                  Contado: {fmt(valorDeclarado)} · Esperado: {fmt(espExibicao)}
                </p>
              </div>
              <p className={`text-2xl font-black whitespace-nowrap ${isNegativo ? 'text-red-600' : 'text-amber-600'}`}>
                {isNegativo ? '−' : diffExibicao > 0 ? '+' : ''}{fmtSemSinal(diffExibicao)}
              </p>
            </div>

            {/* Aviso — caixa já foi fechado */}
            <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="w-4 h-4 flex items-center justify-center text-amber-500 mt-0.5 flex-shrink-0">
                <i className="ri-information-line text-sm" />
              </div>
              <p className="text-xs text-amber-700">
                <strong>Caixa já fechado.</strong> A justificativa é obrigatória para registrar a diferença no histórico.
                Você não pode sair desta tela sem justificar.
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

            {/* Botão Justificar */}
            <button
              onClick={() => handleJustificar()}
              disabled={salvando || justificativa.trim().length < 5}
              className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              {salvando ? (
                <>
                  <i className="ri-loader-4-line animate-spin text-base" />
                  Salvando...
                </>
              ) : (
                <>
                  <i className="ri-check-line text-base" />
                  Justificar
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
            {/* Loading dos totais */}
            {loadingTotais ? (
              <div className="bg-zinc-50 rounded-xl p-6 flex flex-col items-center gap-3">
                <i className="ri-loader-4-line animate-spin text-zinc-400 text-2xl" />
                <p className="text-xs text-zinc-500">Carregando totais de pagamento...</p>
                <p className="text-[10px] text-zinc-400 max-w-[220px] text-center">
                  Aguarde enquanto os dados de dinheiro recebido são calculados para garantir o fechamento correto.
                </p>
              </div>
            ) : (
              <>
                <div className="bg-zinc-50 rounded-xl p-4">
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
              </>
            )}

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
                disabled={salvando || loadingTotais}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl cursor-pointer whitespace-nowrap disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {salvando ? (
                  <>
                    <i className="ri-loader-4-line animate-spin text-base" />
                    Aguarde...
                  </>
                ) : loadingTotais ? (
                  <>
                    <i className="ri-loader-4-line animate-spin text-base" />
                    Carregando...
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
            disabled={loadingTotais}
            className="flex-1 py-2.5 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl cursor-pointer whitespace-nowrap disabled:opacity-50 flex items-center justify-center gap-2">
            {loadingTotais ? (
              <>
                <i className="ri-loader-4-line animate-spin text-base" />
                Carregando...
              </>
            ) : (
              'Fechar Caixa'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}