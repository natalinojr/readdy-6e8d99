import { useNavigate } from 'react-router-dom';

// Faixa "Precisa de atenção" no topo do Dashboard: junta o que pede ação (contas, estoque que vai zerar,
// estoque abaixo do mínimo, validade, pedidos atrasados), cada um com o botão que leva para resolver.
// Sem nada pendente, vira uma linha verde.

export interface ItemAtencao {
  id: string;
  nivel: 'alta' | 'media';
  icone: string;
  titulo: string;
  detalhe?: string;
  valor?: string;
  acao: string;
  ir: { rota: string; state?: unknown };
}

interface Props {
  itens: ItemAtencao[];
  /** ainda buscando as fontes — não mostra "tudo em dia" antes da hora */
  carregando?: boolean;
  /** quem não vê o financeiro não pode ler "nenhuma conta vencida" */
  textoTudoEmDia?: string;
}

export default function AtencaoFaixa({ itens, carregando, textoTudoEmDia }: Props) {
  const navigate = useNavigate();

  if (itens.length === 0) {
    if (carregando) return null;
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700">
        <i className="ri-checkbox-circle-fill text-base" />
        {textoTudoEmDia ?? 'Tudo em dia: nenhuma conta vencida, estoque ok e cozinha no prazo.'}
      </div>
    );
  }

  const ordenados = [...itens].sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'alta' ? -1 : 1));

  return (
    <section className="bg-white rounded-2xl border border-red-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-50 to-amber-50 border-b border-red-100">
        <i className="ri-alarm-warning-fill text-red-500" />
        <h2 className="text-sm font-bold text-red-800">Precisa de atenção</h2>
        <span className="text-[11px] font-bold bg-red-500 text-white rounded-full px-2 py-0.5 tabular-nums">{itens.length}</span>
      </div>
      <div className="flex sm:grid sm:grid-cols-2 xl:grid-cols-4 overflow-x-auto snap-x snap-mandatory gap-px bg-zinc-100">
        {ordenados.map((it) => {
          const alta = it.nivel === 'alta';
          return (
            <div key={it.id} className="snap-start shrink-0 w-[80%] sm:w-auto bg-white p-3 flex items-start gap-2.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${alta ? 'bg-red-100' : 'bg-amber-100'}`}>
                <i className={`${it.icone} ${alta ? 'text-red-600' : 'text-amber-600'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold text-zinc-800 leading-snug">{it.titulo}</p>
                  {it.valor && <span className={`text-xs font-bold tabular-nums whitespace-nowrap ${alta ? 'text-red-600' : 'text-amber-700'}`}>{it.valor}</span>}
                </div>
                {it.detalhe && <p className="text-[11px] text-zinc-500 truncate" title={it.detalhe}>{it.detalhe}</p>}
                <button
                  onClick={() => navigate(it.ir.rota, it.ir.state ? { state: it.ir.state } : undefined)}
                  className={`mt-1.5 text-[11px] font-semibold rounded-md px-2.5 py-1 cursor-pointer transition-colors ${alta ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}
                >
                  {it.acao} →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
