import type { Rodada } from '../types';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  mesaNome: string;
  rodadas: Rodada[];
  pessoasMesa: string[];
  divisaoAtual?: {
    clientes: { id: string; nome: string; corIdx: number }[];
    atribuicoes: Record<string, string | null>;
    totalPorCliente: Record<string, number>;
    itensPorCliente: Record<string, { uid: string; nome: string; precoUnitario: number; opcoes: string }[]>;
  } | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}

const CORES_NOMES = [
  'text-amber-700', 'text-teal-700', 'text-rose-700', 'text-violet-700',
  'text-sky-700', 'text-orange-700', 'text-green-700', 'text-pink-700',
];
const CORES_BG = [
  'bg-amber-50 border-amber-200', 'bg-teal-50 border-teal-200', 'bg-rose-50 border-rose-200',
  'bg-violet-50 border-violet-200', 'bg-sky-50 border-sky-200', 'bg-orange-50 border-orange-200',
  'bg-green-50 border-green-200', 'bg-pink-50 border-pink-200',
];
const CORES_DOT = [
  'bg-amber-500', 'bg-teal-500', 'bg-rose-500', 'bg-violet-500',
  'bg-sky-500', 'bg-orange-500', 'bg-green-500', 'bg-pink-500',
];

export default function HistoricoFechamentoModal({
  mesaNome, rodadas, pessoasMesa, divisaoAtual, onConfirmar, onCancelar,
}: Props) {
  const totalGeral = rodadas.flatMap((r) => r.itens).reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
  const totalItens = rodadas.flatMap((r) => r.itens).reduce((a, i) => a + i.quantidade, 0);

  // Consome by person se há divisão ativa, caso contrário resume por responsável da rodada
  const hasDivisao = divisaoAtual && divisaoAtual.clientes.length > 0 &&
    Object.values(divisaoAtual.atribuicoes).some((v) => v !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: 'min(90dvh, 90vh)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-zinc-100 flex-shrink-0">
          <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl flex-shrink-0">
            <i className="ri-history-line text-zinc-600 text-lg" />
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-900">Resumo da Mesa</p>
            <p className="text-xs text-zinc-400">{mesaNome} · {totalItens} itens · {fmt(totalGeral)}</p>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Por pessoa (se há divisão) */}
          {hasDivisao && divisaoAtual && (
            <div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                <i className="ri-group-line text-zinc-400" />Consumo por Pessoa
              </p>
              <div className="space-y-2">
                {divisaoAtual.clientes
                  .filter((c) => (divisaoAtual.totalPorCliente[c.id] ?? 0) > 0)
                  .map((c, idx) => {
                    const total = divisaoAtual.totalPorCliente[c.id] ?? 0;
                    const itens = divisaoAtual.itensPorCliente[c.id] ?? [];
                    // Agrupar por cartId para mostrar compacto
                    const grupos: Record<string, { nome: string; opcoes: string; preco: number; qtd: number }> = {};
                    itens.forEach((it) => {
                      const key = `${it.nome}::${it.opcoes}`;
                      if (grupos[key]) { grupos[key].qtd += 1; }
                      else { grupos[key] = { nome: it.nome, opcoes: it.opcoes, preco: it.precoUnitario, qtd: 1 }; }
                    });
                    return (
                      <div key={c.id} className={`rounded-xl p-3 border ${CORES_BG[idx % CORES_BG.length]}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${CORES_DOT[idx % CORES_DOT.length]}`} />
                            <span className={`text-xs font-bold ${CORES_NOMES[idx % CORES_NOMES.length]}`}>{c.nome}</span>
                          </div>
                          <span className={`text-sm font-black ${CORES_NOMES[idx % CORES_NOMES.length]}`}>{fmt(total)}</span>
                        </div>
                        <div className="space-y-0.5">
                          {Object.values(grupos).map((g, gi) => (
                            <div key={gi} className="flex items-center justify-between text-[10px] text-zinc-600">
                              <span>{g.qtd}x {g.nome}{g.opcoes ? ` · ${g.opcoes}` : ''}</span>
                              <span className="font-semibold">{fmt(g.preco * g.qtd)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Por pessoa da mesa (se há pessoasMesa mas não divisão detalhada) */}
          {!hasDivisao && pessoasMesa.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                <i className="ri-group-line text-zinc-400" />Pessoas da Mesa
              </p>
              <div className="flex flex-wrap gap-2">
                {pessoasMesa.map((pessoa, idx) => (
                  <span key={idx} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${CORES_BG[idx % CORES_BG.length]} ${CORES_NOMES[idx % CORES_NOMES.length]}`}>
                    <i className="ri-user-line mr-1" />{pessoa}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Todos os pedidos */}
          <div>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-1">
              <i className="ri-receipt-line text-zinc-400" />Pedidos ({rodadas.length})
            </p>
            <div className="space-y-2">
              {rodadas.map((r) => {
                const subtotal = r.itens.reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
                return (
                  <div key={r.id} className="bg-zinc-50 rounded-xl p-3 border border-zinc-200">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-zinc-400">#{r.numero}</span>
                        <span className="text-xs font-semibold text-zinc-700">{r.nomeResponsavel}</span>
                        <span className="text-[10px] text-zinc-400">{r.hora}</span>
                      </div>
                      <span className="text-xs font-bold text-zinc-700">{fmt(subtotal)}</span>
                    </div>
                    <div className="space-y-0.5">
                      {r.itens.map((item) => (
                        <div key={item.cartId} className="flex items-center justify-between text-[10px] text-zinc-500">
                          <span>{item.quantidade}x {item.nome}</span>
                          <span>{fmt(item.precoTotal * item.quantidade)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {rodadas.length === 0 && (
                <p className="text-xs text-zinc-400 text-center py-4">Nenhum pedido registrado</p>
              )}
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="px-5 pb-5 pt-3 border-t border-zinc-100 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 rounded-xl">
            <span className="text-sm font-bold text-zinc-700">Total consumido</span>
            <span className="text-base font-black text-zinc-900">{fmt(totalGeral)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancelar}
              className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              Voltar
            </button>
            <button
              onClick={onConfirmar}
              className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              <i className="ri-door-open-line" />
              Fechar Mesa
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
