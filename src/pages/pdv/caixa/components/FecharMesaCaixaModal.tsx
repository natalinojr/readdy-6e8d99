import { useState, useMemo } from 'react';
import type { Mesa, PedidoRecente } from '@/types/pdv';
import { useKDS } from '../../../../contexts/KDSContext';
import { usePaymentMethods, type PaymentMethod } from '../../../../hooks/usePaymentMethods';
import { useSystemSettings } from '@/hooks/useSystemSettings';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Modo = 'unico' | 'dividir' | 'multiplo';
type Step = 'pagamento' | 'fechamento' | 'sucesso';

interface Parcela {
  id: string;
  formaPagId: string;
  valor: number;
}

interface PessoaDivisao {
  id: string;
  label: string;
  valor: number;
  formaPagId: string;
  valorRecebido?: string;
}

interface Props {
  mesa: Mesa;
  pedidos: PedidoRecente[];
  onFechada: (mesaId: string) => void;
  onClose: () => void;
  /** Chamado ao confirmar pagamento sem fechar mesa ainda */
  onPagamentoConfirmado?: (resumo: string) => void;
  /** Abre diretamente na etapa 2 (mesa já está paga) */
  initialStep?: Step;
  /** Resumo do pagamento já confirmado (quando initialStep === 'fechamento') */
  pagamentoPreConfirmado?: string;
}

// ── Seletor de forma de pagamento ─────────────────────────────────────────────

function FormaPagSelector({
  value,
  onChange,
  compact = false,
  formas,
}: {
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
  formas: PaymentMethod[];
}) {
  return (
    <div className={`grid gap-1.5 ${compact ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {formas.map((fp) => (
        <button
          key={fp.id}
          onClick={() => onChange(fp.id)}
          title={fp.nome}
          className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl border-2 transition-all cursor-pointer ${
            value === fp.id
              ? 'border-amber-500 bg-amber-50 text-amber-700'
              : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50'
          }`}
        >
          <i className={`${fp.icone} text-base`} />
          <span className="text-[9px] font-semibold leading-tight text-center">{fp.nome.split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
}

// ── Step 2: Confirmar Fechamento ──────────────────────────────────────────────

interface StepFechamentoProps {
  mesa: Mesa;
  total: number;
  pagamentoResumo: string;
  onConfirmar: () => void;
  onVoltar: () => void;
  /** Se presente, mostra botão Aguardar Entrega */
  onAguardarEntrega?: () => void;
  /** Esconde o botão voltar (quando mesa já foi paga e modal abriu direto no step 2) */
  hideVoltar?: boolean;
}

function StepFechamento({ mesa, total, pagamentoResumo, onConfirmar, onVoltar, onAguardarEntrega, hideVoltar }: StepFechamentoProps) {
  const { pedidos: allKdsPedidos } = useKDS();
  const kdsPedidos = allKdsPedidos.filter(
    (p) => p.destino === 'mesa' && p.mesaNumero === mesa.numero
  );

  const itensPendentes = kdsPedidos.reduce((acc, p) => {
    return acc + p.itens.filter((i) => i.status !== 'entregue' && i.status !== 'pronto').length;
  }, 0);

  const itensProntos = kdsPedidos.reduce((acc, p) => {
    return acc + p.itens.filter((i) => i.status === 'pronto').length;
  }, 0);

  const todosEntregues = itensPendentes === 0 && itensProntos === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Status da cozinha */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Pagamento confirmado */}
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <div className="w-8 h-8 flex items-center justify-center bg-green-500 rounded-full flex-shrink-0">
            <i className="ri-check-line text-white text-sm" />
          </div>
          <div>
            <p className="text-sm font-bold text-green-700">Pagamento Confirmado</p>
            <p className="text-xs text-green-600">{pagamentoResumo} · {fmt(total)}</p>
          </div>
        </div>

        {/* Status da entrega */}
        <div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Status da Entrega</p>

          {kdsPedidos.length === 0 ? (
            <div className="bg-zinc-50 rounded-xl px-4 py-3 flex items-center gap-2 text-zinc-500">
              <i className="ri-check-double-line text-zinc-400" />
              <span className="text-xs">Nenhum pedido ativo na cozinha</span>
            </div>
          ) : (
            <div className="space-y-2">
              {kdsPedidos.map((p) => (
                <div key={p.id} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-zinc-800">Pedido #{p.numero}</span>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                      p.status === 'entregue' ? 'bg-zinc-100 text-zinc-400'
                      : p.status === 'pronto' ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                    }`}>
                      {p.status === 'entregue' ? 'Entregue' : p.status === 'pronto' ? 'Pronto p/ entregar' : 'Em preparo'}
                    </span>
                  </div>
                  {p.itens.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-[10px] py-0.5">
                      <span className="text-zinc-600">
                        {item.quantidade > 1 ? `${item.quantidade}x ` : ''}{item.nome}
                      </span>
                      <span className={`font-bold flex items-center gap-1 ${
                        item.status === 'entregue' ? 'text-zinc-400'
                        : item.status === 'pronto' ? 'text-green-600'
                        : 'text-amber-600'
                      }`}>
                        {item.status === 'entregue'
                          ? <><i className="ri-check-double-line" /> Entregue</>
                          : item.status === 'pronto'
                          ? <><i className="ri-check-line" /> Pronto</>
                          : <><i className="ri-loader-4-line" /> Preparo</>}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Aviso se tiver itens pendentes */}
        {(itensPendentes > 0 || itensProntos > 0) && (
          <div className={`flex items-start gap-2 rounded-xl px-3 py-3 border ${
            itensProntos > 0 && itensPendentes === 0
              ? 'bg-amber-50 border-amber-200'
              : 'bg-orange-50 border-orange-200'
          }`}>
            <i className={`text-base mt-0.5 flex-shrink-0 ${
              itensProntos > 0 && itensPendentes === 0
                ? 'ri-restaurant-2-line text-amber-500'
                : 'ri-time-line text-orange-500'
            }`} />
            <div>
              <p className={`text-xs font-bold ${
                itensProntos > 0 && itensPendentes === 0 ? 'text-amber-700' : 'text-orange-700'
              }`}>
                {itensProntos > 0 && itensPendentes === 0
                  ? `${itensProntos} ${itensProntos > 1 ? 'itens' : 'item'} pronto${itensProntos > 1 ? 's' : ''} para entregar`
                  : `${itensPendentes} ${itensPendentes > 1 ? 'itens' : 'item'} ainda em preparo`}
              </p>
              <p className={`text-[10px] mt-0.5 ${
                itensProntos > 0 && itensPendentes === 0 ? 'text-amber-600' : 'text-orange-600'
              }`}>
                Você pode fechar a mesa mesmo assim — o cliente já pagou.
              </p>
            </div>
          </div>
        )}

        {todosEntregues && kdsPedidos.length > 0 && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-3">
            <i className="ri-check-double-line text-green-600 text-base" />
            <p className="text-xs font-bold text-green-700">Todos os itens foram entregues!</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-5 pt-3 border-t border-zinc-100 flex-shrink-0 bg-white space-y-2">
        {onAguardarEntrega && (
          <button
            onClick={onAguardarEntrega}
            className="w-full py-2.5 border-2 border-dashed border-zinc-300 hover:border-amber-400 hover:bg-amber-50 text-zinc-500 hover:text-amber-700 font-semibold text-xs rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            <i className="ri-time-line text-sm" />
            Aguardar Entrega — Fechar Mesa depois
          </button>
        )}
        <button
          onClick={onConfirmar}
          className="w-full py-3.5 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
        >
          <i className="ri-door-lock-line text-base text-amber-400" />
          Confirmar Fechamento da Mesa
        </button>
        {!hideVoltar && (
          <button
            onClick={onVoltar}
            className="w-full py-2.5 border border-zinc-200 hover:bg-zinc-50 text-zinc-600 font-semibold text-xs rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-arrow-left-line mr-1" />
            Voltar ao Pagamento
          </button>
        )}
      </div>
    </div>
  );
}

// ── Modal principal ──────────────────────────────────────────────────────────

export default function FecharMesaCaixaModal({ mesa, pedidos, onFechada, onClose, onPagamentoConfirmado, initialStep, pagamentoPreConfirmado }: Props) {
  const { formasAtivas: formas } = usePaymentMethods();
  const { settings } = useSystemSettings();
  const taxaAtiva = settings.service_fee_enabled;
  const taxaPct = settings.service_fee_percentage ?? 10;
  const subtotal = mesa.totalConsumo ?? 0;
  const taxa = taxaAtiva ? parseFloat((subtotal * taxaPct / 100).toFixed(2)) : 0;
  const total = parseFloat((subtotal + taxa).toFixed(2));

  const [step, setStep] = useState<Step>(initialStep ?? 'pagamento');
  const [modo, setModo] = useState<Modo>('unico');
  const [mostrarItens, setMostrarItens] = useState(false);
  const [pagamentoResumo, setPagamentoResumo] = useState(pagamentoPreConfirmado ?? '');

  // ── Modo único ──
  const [formaSelecionada, setFormaSelecionada] = useState(formas[0]?.id ?? '');
  const [valorRecebido, setValorRecebido] = useState('');
  const formaTipo = formas.find((f) => f.id === formaSelecionada)?.tipo;
  const isDinheiro = formaTipo === 'dinheiro';
  const valorRecebidoNum = parseFloat(valorRecebido.replace(',', '.')) || 0;
  const troco = isDinheiro && valorRecebidoNum > total ? valorRecebidoNum - total : 0;
  const trocoValido = !isDinheiro || valorRecebidoNum >= total;

  // ── Modo dividir ──
  const [numPessoas, setNumPessoas] = useState(2);
  const [pessoas, setPessoas] = useState<PessoaDivisao[]>(() =>
    Array.from({ length: 2 }, (_, i) => ({
      id: `p-${i}`,
      label: `Pessoa ${i + 1}`,
      valor: parseFloat((total / 2).toFixed(2)),
      formaPagId: formas[0]?.id ?? '',
    }))
  );

  const handleNumPessoas = (n: number) => {
    const c = Math.max(2, Math.min(12, n));
    setNumPessoas(c);
    const vpp = parseFloat((total / c).toFixed(2));
    const diff = parseFloat((total - vpp * c).toFixed(2));
    setPessoas(
      Array.from({ length: c }, (_, i) => ({
        id: `p-${i}`,
        label: `Pessoa ${i + 1}`,
        valor: i === 0 ? vpp + diff : vpp,
        formaPagId: pessoas[i]?.formaPagId ?? formas[0]?.id ?? '',
      }))
    );
  };

  const totalDividido = useMemo(() => pessoas.reduce((a, p) => a + p.valor, 0), [pessoas]);
  const diffDividido  = parseFloat((total - totalDividido).toFixed(2));

  // ── Modo múltiplo ──
  const [parcelas, setParcelas] = useState<Parcela[]>([
    { id: 'parc-0', formaPagId: formas[0]?.id ?? '', valor: total },
  ]);

  const totalParcelas = useMemo(() => parcelas.reduce((a, p) => a + p.valor, 0), [parcelas]);
  const restante = parseFloat((total - totalParcelas).toFixed(2));
  const temDinheiroMultiplo = useMemo(
    () => parcelas.some((p) => formas.find((f) => f.id === p.formaPagId)?.tipo === 'dinheiro'),
    [parcelas]
  );
  const trocoMultiplo = restante < -0.01 && temDinheiroMultiplo ? Math.abs(restante) : 0;

  const addParcela = () => {
    const r = Math.max(0, restante);
    setParcelas((prev) => [
      ...prev,
      { id: `parc-${Date.now()}`, formaPagId: formas[1]?.id ?? formas[0]?.id ?? '', valor: r },
    ]);
  };

  const removeParcela = (id: string) => setParcelas((prev) => prev.filter((p) => p.id !== id));
  const updateParcelaForma = (id: string, formaPagId: string) =>
    setParcelas((prev) => prev.map((p) => (p.id === id ? { ...p, formaPagId } : p)));
  const updateParcelaValor = (id: string, raw: string) => {
    const v = parseFloat(raw) || 0;
    setParcelas((prev) => prev.map((p) => (p.id === id ? { ...p, valor: v } : p)));
  };

  // ── Validação ──
  const podeConfirmarPagamento = useMemo(() => {
    if (modo === 'unico')   return !!formaSelecionada && trocoValido;
    if (modo === 'dividir') return Math.abs(diffDividido) < 0.02 && pessoas.every((p) => p.formaPagId);
    if (modo === 'multiplo') {
      const ok    = parcelas.every((p) => p.formaPagId && p.valor > 0);
      const cobre = totalParcelas >= total - 0.01;
      const excedeDinheiro = restante < -0.01 && temDinheiroMultiplo;
      return ok && (cobre || excedeDinheiro) && (Math.abs(restante) < 0.02 || excedeDinheiro);
    }
    return false;
  }, [modo, formaSelecionada, trocoValido, diffDividido, pessoas, parcelas, totalParcelas, restante, total, temDinheiroMultiplo]);

  const handleConfirmarPagamento = () => {
    if (!podeConfirmarPagamento) return;
    // Monta resumo legível
    if (modo === 'unico') {
      const nome = formas.find((f) => f.id === formaSelecionada)?.nome ?? '';
      setPagamentoResumo(nome);
    } else if (modo === 'dividir') {
      setPagamentoResumo(`${numPessoas} pessoas`);
    } else {
      const nomes = parcelas.map((p) => formas.find((f) => f.id === p.formaPagId)?.nome ?? '').join(' + ');
      setPagamentoResumo(nomes);
    }
    setStep('fechamento');
  };

  const handleConfirmarFechamento = () => {
    setStep('sucesso');
    setTimeout(() => onFechada(mesa.id), 2500);
  };

  // ── Tela de sucesso ──
  if (step === 'sucesso') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl p-8 w-full max-w-sm mx-4 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-zinc-900 rounded-full mx-auto mb-4">
            <i className="ri-check-double-line text-3xl text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900 mb-1">Mesa {mesa.numero} Fechada!</h2>
          <p className="text-sm text-zinc-500">
            {mesa.clienteNome && <span>{mesa.clienteNome} · </span>}
            {fmt(total)} cobrado com sucesso
          </p>
          <div className="mt-4 flex flex-col gap-2 text-xs text-zinc-400">
            <div className="flex items-center justify-center gap-2">
              <i className="ri-money-dollar-circle-line text-green-500" />
              <span className="text-green-600 font-semibold">Pagamento registrado</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <i className="ri-loader-4-line animate-spin" />
              Liberando mesa...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md mx-0 sm:mx-4 overflow-hidden flex flex-col max-h-[92vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-zinc-900 rounded-xl flex-shrink-0">
              <span className="text-sm font-black text-amber-400">{mesa.numero}</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900">
                {step === 'pagamento' ? 'Confirmar Pagamento' : 'Fechar Mesa'}
                <span className="text-zinc-400 font-normal"> · Mesa {mesa.numero}</span>
                {mesa.clienteNome && (
                  <span className="text-zinc-400 font-normal"> · {mesa.clienteNome}</span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {mesa.garcomNome && (
                  <span className="text-[10px] text-zinc-400">
                    <i className="ri-walk-line mr-0.5" />{mesa.garcomNome}
                  </span>
                )}
                {mesa.abertaEm && (
                  <span className="text-[10px] text-zinc-400">
                    <i className="ri-time-line mr-0.5" />desde {mesa.abertaEm}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-zinc-900">{fmt(total)}</span>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-600 transition-colors"
            >
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        </div>

        {/* ── Indicador de etapas ── */}
        <div className="flex items-center gap-0 px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 flex-shrink-0">
          <div className={`flex items-center gap-1.5 flex-1 ${step === 'pagamento' ? 'opacity-100' : 'opacity-60'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
              step === 'pagamento' ? 'bg-amber-500 text-white' : 'bg-green-500 text-white'
            }`}>
              {step === 'pagamento' ? '1' : <i className="ri-check-line text-[9px]" />}
            </div>
            <span className={`text-[10px] font-bold ${step === 'pagamento' ? 'text-amber-700' : 'text-green-600'}`}>
              Pagamento
            </span>
          </div>
          <div className="w-8 h-px bg-zinc-300 flex-shrink-0 mx-1" />
          <div className={`flex items-center gap-1.5 flex-1 ${step === 'fechamento' ? 'opacity-100' : 'opacity-40'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
              step === 'fechamento' ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-400'
            }`}>
              2
            </div>
            <span className={`text-[10px] font-bold ${step === 'fechamento' ? 'text-zinc-900' : 'text-zinc-400'}`}>
              Fechar Mesa
            </span>
          </div>
        </div>

        {/* ── Resumo financeiro (apenas no step pagamento) ── */}
        {step === 'pagamento' && (
          <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 flex-shrink-0">
            <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
              <span>Consumo</span>
              <span className="font-semibold">{fmt(subtotal)}</span>
            </div>
            {taxaAtiva && (
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-zinc-400">Taxa de serviço ({taxaPct}%)</span>
                <span className="text-zinc-500">{fmt(taxa)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm font-bold text-zinc-900 border-t border-zinc-200 pt-1.5 mt-1">
              <span>Total</span>
              <span>{fmt(total)}</span>
            </div>
          </div>
        )}

        {/* ── Itens da mesa (colapsável, apenas step pagamento) ── */}
        {step === 'pagamento' && pedidos.length > 0 && (
          <div className="border-b border-zinc-100 flex-shrink-0">
            <button
              onClick={() => setMostrarItens((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2 hover:bg-zinc-50 transition-colors cursor-pointer"
            >
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                {pedidos.length} pedido{pedidos.length > 1 ? 's' : ''} nesta mesa
              </span>
              <i className={`text-zinc-400 text-sm ${mostrarItens ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
            </button>
            {mostrarItens && (
              <div className="px-4 pb-3 space-y-2 max-h-36 overflow-y-auto">
                {pedidos.map((p) => (
                  <div key={p.id} className="bg-zinc-50 rounded-lg border border-zinc-200 px-3 py-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-zinc-800">Pedido #{p.numero}</span>
                      <span className="text-xs font-bold text-zinc-700">{fmt(p.total)}</span>
                    </div>
                    {p.itensDetalhes.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-[10px] text-zinc-500 py-0.5">
                        <span>
                          {item.quantidade > 1 ? `${item.quantidade}x ` : ''}{item.nome}
                          {item.opcoes.length > 0 && (
                            <span className="text-zinc-400"> · {item.opcoes[0]}</span>
                          )}
                        </span>
                        <span className="font-semibold">{fmt(item.preco * item.quantidade)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 1: Pagamento ── */}
        {step === 'pagamento' && (
          <>
            {/* Modo de pagamento */}
            <div className="px-4 pt-3 pb-2 flex-shrink-0">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Como vai pagar?</p>
              <div className="flex gap-2">
                {([
                  { id: 'unico',    icon: 'ri-bank-card-line', label: 'Uma forma' },
                  { id: 'dividir',  icon: 'ri-group-line',     label: 'Dividir'   },
                  { id: 'multiplo', icon: 'ri-stack-line',     label: 'Múltiplos' },
                ] as { id: Modo; icon: string; label: string }[]).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setModo(m.id)}
                    className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all cursor-pointer whitespace-nowrap ${
                      modo === m.id
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                    }`}
                  >
                    <i className={`${m.icon} text-lg`} />
                    <span className="text-[10px] font-bold">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Conteúdo por modo */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">

              {/* Uma forma */}
              {modo === 'unico' && (
                <div className="space-y-3">
                  <p className="text-xs font-bold text-zinc-600 mt-1">Selecione a forma de pagamento:</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {formas.map((fp) => (
                      <button
                        key={fp.id}
                        onClick={() => { setFormaSelecionada(fp.id); setValorRecebido(''); }}
                        className={`flex flex-col items-center gap-1.5 py-4 rounded-xl border-2 transition-all cursor-pointer ${
                          formaSelecionada === fp.id
                            ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        <i className={`${fp.icone} text-2xl`} />
                        <span className="text-xs font-semibold">{fp.nome}</span>
                      </button>
                    ))}
                  </div>

                  {isDinheiro && (
                    <div className="bg-zinc-50 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-700">Valor recebido</span>
                        <button
                          onClick={() => setValorRecebido(total.toFixed(2).replace('.', ','))}
                          className="text-[10px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer whitespace-nowrap"
                        >
                          Exato ({fmt(total)})
                        </button>
                      </div>
                      <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2">
                        <span className="text-sm text-zinc-400 flex-shrink-0">R$</span>
                        <input
                          type="number"
                          value={valorRecebido}
                          onChange={(e) => setValorRecebido(e.target.value)}
                          placeholder={total.toFixed(2)}
                          className="flex-1 text-sm text-zinc-900 outline-none font-semibold"
                          min={total}
                          step={0.50}
                        />
                      </div>
                      {valorRecebidoNum > 0 && valorRecebidoNum < total && (
                        <p className="text-[10px] text-red-500 font-semibold flex items-center gap-1">
                          <i className="ri-error-warning-line" />
                          Valor insuficiente — faltam {fmt(total - valorRecebidoNum)}
                        </p>
                      )}
                      {troco > 0 && (
                        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <i className="ri-money-dollar-circle-line text-green-600 text-lg" />
                            <span className="text-sm font-bold text-green-700">Troco</span>
                          </div>
                          <span className="text-lg font-black text-green-700">{fmt(troco)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {!isDinheiro && (
                    <div className="bg-zinc-50 rounded-xl px-4 py-3 flex items-center justify-between mt-2">
                      <span className="text-sm text-zinc-600">Total a cobrar</span>
                      <span className="text-lg font-black text-zinc-900">{fmt(total)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Dividir */}
              {modo === 'dividir' && (
                <div className="space-y-3 mt-1">
                  <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-xs font-bold text-zinc-700">Número de pessoas</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">
                        {fmt(total / numPessoas)} por pessoa
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleNumPessoas(numPessoas - 1)}
                        disabled={numPessoas <= 2}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 disabled:opacity-40 cursor-pointer transition-colors text-zinc-700 font-bold"
                      >
                        <i className="ri-subtract-line text-sm" />
                      </button>
                      <span className="text-xl font-black text-zinc-900 w-6 text-center">{numPessoas}</span>
                      <button
                        onClick={() => handleNumPessoas(numPessoas + 1)}
                        disabled={numPessoas >= 12}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 disabled:opacity-40 cursor-pointer transition-colors text-zinc-700 font-bold"
                      >
                        <i className="ri-add-line text-sm" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {pessoas.map((p, idx) => {
                    const isDinheiroP = formas.find((f) => f.id === p.formaPagId)?.tipo === 'dinheiro';
                    const vrNum = parseFloat(p.valorRecebido?.replace(',', '.') ?? '') || 0;
                    const trocoP = isDinheiroP && vrNum > p.valor ? vrNum - p.valor : 0;
                    const faltaP = isDinheiroP && vrNum > 0 && vrNum < p.valor;
                    return (
                      <div key={p.id} className="border border-zinc-200 rounded-xl overflow-hidden">
                        <div className="flex items-center gap-3 px-3 py-2 bg-zinc-50 border-b border-zinc-100">
                          <div className="w-6 h-6 flex items-center justify-center bg-zinc-700 rounded-full flex-shrink-0">
                            <span className="text-[10px] font-black text-white">{idx + 1}</span>
                          </div>
                          <span className="text-xs font-semibold text-zinc-700 flex-1">{p.label}</span>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-zinc-400">R$</span>
                            <input
                              type="number"
                              value={p.valor}
                              min={0}
                              step={0.01}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                setPessoas((prev) => prev.map((x, i) => (i === idx ? { ...x, valor: v } : x)));
                              }}
                              className="w-20 text-right text-sm font-bold text-zinc-900 border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                            />
                          </div>
                        </div>
                        <div className="px-3 py-2 space-y-2">
                          <FormaPagSelector
                            value={p.formaPagId}
                            onChange={(id) => setPessoas((prev) => prev.map((x, i) => (i === idx ? { ...x, formaPagId: id, valorRecebido: '' } : x)))}
                            compact
                            formas={formas}
                          />
                          {isDinheiroP && (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5">
                                <span className="text-[10px] text-zinc-400 flex-shrink-0">Recebido R$</span>
                                <input
                                  type="number"
                                  value={p.valorRecebido ?? ''}
                                  onChange={(e) => setPessoas((prev) => prev.map((x, i) => (i === idx ? { ...x, valorRecebido: e.target.value } : x)))}
                                  placeholder={p.valor.toFixed(2)}
                                  className="flex-1 text-sm font-semibold text-zinc-900 outline-none bg-transparent text-right"
                                  min={0}
                                  step={0.50}
                                />
                                <button
                                  onClick={() => setPessoas((prev) => prev.map((x, i) => (i === idx ? { ...x, valorRecebido: p.valor.toFixed(2) } : x)))}
                                  className="text-[9px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer whitespace-nowrap flex-shrink-0"
                                >
                                  Exato
                                </button>
                              </div>
                              {faltaP && (
                                <p className="text-[10px] text-red-500 font-semibold flex items-center gap-1">
                                  <i className="ri-error-warning-line" />
                                  Faltam {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valor - vrNum)}
                                </p>
                              )}
                              {trocoP > 0 && (
                                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <i className="ri-money-dollar-circle-line text-green-600" />
                                    <span className="text-xs font-bold text-green-700">Troco</span>
                                  </div>
                                  <span className="text-sm font-black text-green-700">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(trocoP)}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  </div>

                  {Math.abs(diffDividido) > 0.01 && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${
                      diffDividido > 0
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-red-50 text-red-600 border border-red-200'
                    }`}>
                      <i className="ri-information-line" />
                      {diffDividido > 0
                        ? `Faltam ${fmt(diffDividido)} para cobrir o total`
                        : `Excede em ${fmt(Math.abs(diffDividido))}`}
                    </div>
                  )}
                </div>
              )}

              {/* Múltiplos */}
              {modo === 'multiplo' && (
                <div className="space-y-2 mt-1">
                  {parcelas.map((parc, idx) => (
                    <div key={parc.id} className="border border-zinc-200 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 border-b border-zinc-100">
                        <div className="w-5 h-5 flex items-center justify-center bg-zinc-700 rounded-full flex-shrink-0">
                          <span className="text-[9px] font-black text-white">{idx + 1}</span>
                        </div>
                        <span className="text-xs font-semibold text-zinc-700 flex-1">Pagamento {idx + 1}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-zinc-400">R$</span>
                          <input
                            type="number"
                            value={parc.valor}
                            min={0.01}
                            step={0.01}
                            onChange={(e) => updateParcelaValor(parc.id, e.target.value)}
                            className="w-24 text-right text-sm font-bold text-zinc-900 border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                          />
                        </div>
                        {parcelas.length > 1 && (
                          <button
                            onClick={() => removeParcela(parc.id)}
                            className="w-6 h-6 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 cursor-pointer transition-colors flex-shrink-0"
                          >
                            <i className="ri-delete-bin-line text-sm" />
                          </button>
                        )}
                      </div>
                      <div className="px-3 py-2">
                        <FormaPagSelector
                          value={parc.formaPagId}
                          onChange={(id) => updateParcelaForma(parc.id, id)}
                          compact
                          formas={formas}
                        />
                      </div>
                    </div>
                  ))}

                  {restante > 0.01 && (
                    <button
                      onClick={addParcela}
                      className="w-full py-2.5 border-2 border-dashed border-zinc-300 hover:border-amber-400 hover:bg-amber-50 text-zinc-500 hover:text-amber-600 text-xs font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
                    >
                      <i className="ri-add-circle-line" />
                      Adicionar pagamento ({fmt(Math.max(0, restante))} restante)
                    </button>
                  )}

                  <div className="bg-zinc-50 rounded-xl px-4 py-3 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Total</span>
                      <span className="font-bold text-zinc-700">{fmt(total)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Alocado</span>
                      <span className="font-bold text-zinc-700">{fmt(totalParcelas)}</span>
                    </div>
                    <div className={`flex justify-between text-xs pt-1 border-t border-zinc-200 font-bold ${
                      Math.abs(restante) < 0.02 ? 'text-green-600'
                      : restante > 0 ? 'text-amber-600'
                      : trocoMultiplo > 0 ? 'text-green-600'
                      : 'text-red-500'
                    }`}>
                      <span>
                        {Math.abs(restante) < 0.02 ? 'Coberto'
                          : restante > 0 ? 'Restante'
                          : trocoMultiplo > 0 ? 'Troco'
                          : 'Excede'}
                      </span>
                      <span className="font-black">
                        {Math.abs(restante) < 0.02 ? '✓' : fmt(Math.abs(restante))}
                      </span>
                    </div>
                  </div>

                  {trocoMultiplo > 0 && (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <i className="ri-money-dollar-circle-line text-green-600 text-lg" />
                        <span className="text-sm font-bold text-green-700">Troco (dinheiro)</span>
                      </div>
                      <span className="text-lg font-black text-green-700">{fmt(trocoMultiplo)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer step 1 */}
            <div className="px-4 pb-5 pt-2 border-t border-zinc-100 flex-shrink-0 bg-white">
              {troco > 0 && modo === 'unico' && (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 mb-2">
                  <span className="text-sm font-bold text-green-700 flex items-center gap-1.5">
                    <i className="ri-money-dollar-circle-line" />
                    Troco para o cliente
                  </span>
                  <span className="text-xl font-black text-green-700">{fmt(troco)}</span>
                </div>
              )}
              <button
                onClick={handleConfirmarPagamento}
                disabled={!podeConfirmarPagamento}
                className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                <i className="ri-money-dollar-circle-line text-base" />
                Confirmar Pagamento · {fmt(total)}
                <i className="ri-arrow-right-line text-base" />
              </button>
              {!podeConfirmarPagamento && modo === 'unico' && isDinheiro && valorRecebidoNum > 0 && valorRecebidoNum < total && (
                <p className="text-[10px] text-red-400 text-center mt-1.5">Valor recebido insuficiente</p>
              )}
            </div>
          </>
        )}

        {/* ── STEP 2: Fechamento ── */}
        {step === 'fechamento' && (
          <StepFechamento
            mesa={mesa}
            total={total}
            pagamentoResumo={pagamentoResumo}
            onConfirmar={handleConfirmarFechamento}
            onVoltar={() => setStep('pagamento')}
            onAguardarEntrega={onPagamentoConfirmado
              ? () => { onPagamentoConfirmado(pagamentoResumo); onClose(); }
              : undefined
            }
            hideVoltar={initialStep === 'fechamento'}
          />
        )}
      </div>
    </div>
  );
}
