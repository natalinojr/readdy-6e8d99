import { useState, useMemo, useEffect, useRef } from 'react';
import { usePaymentMethods, type PaymentMethod } from '@/hooks/usePaymentMethods';
import type { ClienteDivisao, DivisaoResultado } from './DivisaoContaView';
import type { DivisaoPagamentoState } from '../page';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const CORES = [
  { bg: 'bg-amber-500', text: 'text-amber-700', light: 'bg-amber-50', border: 'border-amber-300', dot: 'bg-amber-500' },
  { bg: 'bg-teal-500', text: 'text-teal-700', light: 'bg-teal-50', border: 'border-teal-300', dot: 'bg-teal-500' },
  { bg: 'bg-rose-500', text: 'text-rose-700', light: 'bg-rose-50', border: 'border-rose-300', dot: 'bg-rose-500' },
  { bg: 'bg-violet-500', text: 'text-violet-700', light: 'bg-violet-50', border: 'border-violet-300', dot: 'bg-violet-500' },
  { bg: 'bg-sky-500', text: 'text-sky-700', light: 'bg-sky-50', border: 'border-sky-300', dot: 'bg-sky-500' },
  { bg: 'bg-orange-500', text: 'text-orange-700', light: 'bg-orange-50', border: 'border-orange-300', dot: 'bg-orange-500' },
  { bg: 'bg-green-500', text: 'text-green-700', light: 'bg-green-50', border: 'border-green-300', dot: 'bg-green-500' },
  { bg: 'bg-pink-500', text: 'text-pink-700', light: 'bg-pink-50', border: 'border-pink-300', dot: 'bg-pink-500' },
];

function getCor(idx: number) {
  return CORES[idx % CORES.length];
}

interface Props {
  mesaNome: string;
  divisao: DivisaoResultado;
  /** Estado de pagamento salvo anteriormente — permite retomar de onde parou */
  pagamentoSalvo?: DivisaoPagamentoState | null;
  onClose: () => void;
  onPagarCliente: (clienteId: string, formaPagId: string, valor: number, nomeCliente: string) => Promise<void>;
  /** Chamado sempre que o estado de pagamento muda, para persistir externamente */
  onEstadoChange?: (estado: DivisaoPagamentoState) => void;
}

export default function PagarDivisaoModal({
  mesaNome, divisao, pagamentoSalvo, onClose, onPagarCliente, onEstadoChange,
}: Props) {
  const { formasAtivas: formas } = usePaymentMethods();

  const clientesComValor = useMemo(
    () => divisao.clientes.filter((c) => (divisao.totalPorCliente[c.id] ?? 0) > 0),
    [divisao]
  );

  // Inicializa "pagos" a partir do estado salvo — retoma de onde parou
  const [pagos, setPagos] = useState<Set<string>>(() => {
    if (!pagamentoSalvo) return new Set();
    return new Set(
      Object.entries(pagamentoSalvo.clientes)
        .filter(([, v]) => v.pago)
        .map(([k]) => k)
    );
  });

  // Inicializa formas de pagamento a partir do estado salvo
  const [formasPorCliente, setFormasPorCliente] = useState<Record<string, string>>(() => {
    const defaults = Object.fromEntries(clientesComValor.map((c) => [c.id, formas[0]?.id ?? '']));
    if (!pagamentoSalvo) return defaults;
    // Restaura formas salvas
    Object.entries(pagamentoSalvo.clientes).forEach(([cId, v]) => {
      if (v.formaPagId) defaults[cId] = v.formaPagId;
    });
    return defaults;
  });

  // Quando as formas carregam (async), preenche os vazios
  useEffect(() => {
    if (formas.length === 0) return;
    setFormasPorCliente((prev) => {
      const updated = { ...prev };
      clientesComValor.forEach((c) => {
        if (!updated[c.id]) updated[c.id] = formas[0].id;
      });
      return updated;
    });
  }, [formas, clientesComValor]);

  // Seleciona o primeiro cliente não pago como ativo
  const [clienteAtivo, setClienteAtivo] = useState<string>(() => {
    const primeiroPendente = clientesComValor.find((c) => {
      if (!pagamentoSalvo) return true;
      return !pagamentoSalvo.clientes[c.id]?.pago;
    });
    return primeiroPendente?.id ?? clientesComValor[0]?.id ?? '';
  });

  const [pagando, setPagando] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const [concluido, setConcluido] = useState(() => {
    // Se todos já estavam pagos no estado salvo, começa na tela de conclusão
    if (!pagamentoSalvo || clientesComValor.length === 0) return false;
    return clientesComValor.every((c) => pagamentoSalvo.clientes[c.id]?.pago);
  });

  const totalGeral = clientesComValor.reduce((a, c) => a + (divisao.totalPorCliente[c.id] ?? 0), 0);
  const totalPago = clientesComValor
    .filter((c) => pagos.has(c.id))
    .reduce((a, c) => a + (divisao.totalPorCliente[c.id] ?? 0), 0);
  const todosPageram = pagos.size === clientesComValor.length;

  // Notifica o pai sempre que o estado de pagamento muda (para persistir)
  useEffect(() => {
    if (pagos.size === 0 && !pagamentoSalvo) return; // Não persiste estado vazio inicial
    const estado: DivisaoPagamentoState = {
      clientes: Object.fromEntries(
        clientesComValor.map((c) => [
          c.id,
          {
            formaPagId: formasPorCliente[c.id] ?? '',
            valor: divisao.totalPorCliente[c.id] ?? 0,
            pago: pagos.has(c.id),
            nome: c.nome,
          },
        ])
      ),
      atribuicoes: divisao.atribuicoes,
    };
    onEstadoChange?.(estado);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagos, formasPorCliente]);

  const handlePagar = async (cliente: ClienteDivisao) => {
    const formaPagId = formasPorCliente[cliente.id];
    // Guard: evita clique duplo ou pagamento já registrado
    if (!formaPagId || pagos.has(cliente.id) || submittingRef.current) return;
    submittingRef.current = true;
    setPagando(cliente.id);
    try {
      await onPagarCliente(cliente.id, formaPagId, divisao.totalPorCliente[cliente.id] ?? 0, cliente.nome);
      const novosPagos = new Set([...pagos, cliente.id]);
      setPagos(novosPagos);
      // Avança para o próximo cliente não pago
      const proximo = clientesComValor.find((c) => c.id !== cliente.id && !novosPagos.has(c.id));
      if (proximo) setClienteAtivo(proximo.id);
      // Verifica se todos pagaram
      if (novosPagos.size === clientesComValor.length) {
        setTimeout(() => setConcluido(true), 400);
      }
    } finally {
      setPagando(null);
      submittingRef.current = false;
    }
  };

  // ── Tela de conclusão ─────────────────────────────────────────────────────
  if (concluido) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-8 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-green-100 rounded-full mx-auto mb-4">
            <i className="ri-check-double-line text-3xl text-green-500" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900 mb-1">Todos pagaram!</h2>
          <p className="text-sm text-zinc-500 mb-6">{mesaNome} · {fmt(totalGeral)}</p>
          <div className="space-y-2 mb-6">
            {clientesComValor.map((c) => {
              const cor = getCor(c.corIdx);
              const formaPagId = formasPorCliente[c.id];
              const forma = formas.find((f: PaymentMethod) => f.id === formaPagId);
              return (
                <div key={c.id} className={`flex items-center justify-between px-4 py-2.5 rounded-xl border ${cor.light} ${cor.border}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${cor.dot}`} />
                    <span className={`text-sm font-semibold ${cor.text}`}>{c.nome}</span>
                    {forma && (
                      <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                        <i className={`${forma.icone} text-xs`} />{forma.nome}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-black ${cor.text}`}>{fmt(divisao.totalPorCliente[c.id] ?? 0)}</span>
                    <i className="ri-checkbox-circle-fill text-green-500 text-sm" />
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={onClose}
            className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  // ── Modal principal ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: 'min(92dvh, 92vh)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Pagamento por Divisão</h2>
            <p className="text-xs text-zinc-400">{mesaNome} · {clientesComValor.length} pessoas</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-[10px] text-zinc-400">Pago</p>
              <p className="text-sm font-black text-green-600">{fmt(totalPago)} / {fmt(totalGeral)}</p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-600 transition-colors"
            >
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        </div>

        {/* Banner de retomada — aparece quando há pagamentos já registrados */}
        {pagos.size > 0 && pagos.size < clientesComValor.length && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 flex-shrink-0">
            <i className="ri-history-line text-amber-500 text-sm flex-shrink-0" />
            <p className="text-xs text-amber-700 font-semibold">
              Retomando pagamento — {pagos.size} de {clientesComValor.length} já registrado{pagos.size !== 1 ? 's' : ''}
            </p>
          </div>
        )}

        {/* Barra de progresso */}
        <div className="px-4 py-2 flex-shrink-0">
          <div className="flex gap-1">
            {clientesComValor.map((c) => {
              const cor = getCor(c.corIdx);
              const pago = pagos.has(c.id);
              return (
                <div
                  key={c.id}
                  className={`flex-1 h-1.5 rounded-full transition-all ${pago ? 'bg-green-500' : cor.dot}`}
                />
              );
            })}
          </div>
          <p className="text-[10px] text-zinc-400 mt-1">{pagos.size} de {clientesComValor.length} pagamentos registrados</p>
        </div>

        {/* Seletor de cliente */}
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
            {clientesComValor.map((c) => {
              const cor = getCor(c.corIdx);
              const pago = pagos.has(c.id);
              const ativo = clienteAtivo === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => !pago && setClienteAtivo(c.id)}
                  disabled={pago}
                  className={`flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl border-2 transition-all min-w-[72px] ${
                    pago
                      ? 'border-green-300 bg-green-50 cursor-not-allowed opacity-70'
                      : ativo
                        ? `${cor.border} ${cor.light} cursor-pointer`
                        : 'border-zinc-200 bg-white hover:border-zinc-300 cursor-pointer'
                  }`}
                >
                  <div className={`w-7 h-7 flex items-center justify-center rounded-full text-white text-xs font-black ${pago ? 'bg-green-500' : cor.bg}`}>
                    {pago ? <i className="ri-check-line text-sm" /> : c.nome.charAt(0).toUpperCase()}
                  </div>
                  <span className={`text-[10px] font-semibold truncate max-w-[64px] ${pago ? 'text-green-700' : ativo ? cor.text : 'text-zinc-600'}`}>{c.nome}</span>
                  <span className={`text-[9px] font-bold ${pago ? 'text-green-600' : ativo ? cor.text : 'text-zinc-400'}`}>
                    {pago ? 'Pago ✓' : fmt(divisao.totalPorCliente[c.id] ?? 0)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Painel do cliente ativo */}
        {clienteAtivo && !pagos.has(clienteAtivo) && (() => {
          const cliente = clientesComValor.find((c) => c.id === clienteAtivo);
          if (!cliente) return null;
          const cor = getCor(cliente.corIdx);
          const valor = divisao.totalPorCliente[cliente.id] ?? 0;
          const itens = divisao.itensPorCliente[cliente.id] ?? [];
          const formaPagId = formasPorCliente[cliente.id] ?? '';
          const formaSelecionada = formas.find((f: PaymentMethod) => f.id === formaPagId);
          const isDinheiro = formaSelecionada?.tipo === 'dinheiro';

          return (
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {/* Header do cliente */}
              <div className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 mb-4 ${cor.light} ${cor.border}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 flex items-center justify-center rounded-full text-white text-sm font-black ${cor.bg}`}>
                    {cliente.nome.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className={`text-sm font-bold ${cor.text}`}>{cliente.nome}</p>
                    <p className="text-[10px] text-zinc-500">{itens.length} item{itens.length !== 1 ? 'ns' : ''}</p>
                  </div>
                </div>
                <span className={`text-xl font-black ${cor.text}`}>{fmt(valor)}</span>
              </div>

              {/* Itens do cliente */}
              <div className="bg-zinc-50 rounded-xl p-3 mb-4 space-y-1.5 max-h-32 overflow-y-auto">
                {itens.map((u) => (
                  <div key={u.uid} className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400 w-4 text-right">1x</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-700 truncate">{u.nome}</p>
                      {u.opcoes && <p className="text-[10px] text-zinc-400 truncate">{u.opcoes}</p>}
                    </div>
                    <span className="text-xs font-bold text-zinc-600 flex-shrink-0">{fmt(u.precoUnitario)}</span>
                  </div>
                ))}
                {itens.length === 0 && (
                  <p className="text-xs text-zinc-400 text-center py-2">Nenhum item atribuído</p>
                )}
              </div>

              {/* Forma de pagamento */}
              <div className="mb-4">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Forma de pagamento</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {formas.map((fp: PaymentMethod) => (
                    <button
                      key={fp.id}
                      onClick={() => setFormasPorCliente((prev) => ({ ...prev, [cliente.id]: fp.id }))}
                      className={`flex flex-col items-center gap-1 py-2.5 sm:py-3 rounded-xl border-2 transition-all cursor-pointer ${
                        formaPagId === fp.id
                          ? `border-amber-500 bg-amber-50 text-amber-700`
                          : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50'
                      }`}
                    >
                      <i className={`${fp.icone} text-lg sm:text-xl`} />
                      <span className="text-[10px] sm:text-xs font-semibold">{fp.nome}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Troco (dinheiro) */}
              {isDinheiro && (
                <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3 mb-4">
                  <span className="text-sm text-zinc-600">Total a cobrar</span>
                  <span className="text-lg font-black text-zinc-900">{fmt(valor)}</span>
                </div>
              )}

              {/* Botão pagar */}
              <button
                onClick={() => handlePagar(cliente)}
                disabled={!formaPagId || pagando === cliente.id}
                className={`w-full py-3.5 font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${cor.bg} hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white`}
              >
                {pagando === cliente.id ? (
                  <><i className="ri-loader-4-line animate-spin" />Registrando...</>
                ) : (
                  <><i className="ri-check-double-line" />Registrar pagamento de {cliente.nome} · {fmt(valor)}</>
                )}
              </button>
            </div>
          );
        })()}

        {/* Todos pagaram mas modal ainda aberto */}
        {todosPageram && !concluido && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-green-100 rounded-full mb-3">
              <i className="ri-check-double-line text-2xl text-green-500" />
            </div>
            <p className="text-sm font-bold text-zinc-900">Todos os pagamentos registrados!</p>
            <div className="flex items-center gap-1 text-zinc-400 text-xs mt-2">
              <i className="ri-loader-4-line animate-spin" />
              Finalizando...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
