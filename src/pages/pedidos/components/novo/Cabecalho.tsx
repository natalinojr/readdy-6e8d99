import { MenuMais, type ItemMenu } from '@/pages/estoque/components/ui/EstoqueUi';

// Topo da tela de Pedidos no layout novo (protótipo docs/prototipos/pedidos-proposta.html).
// Linha 1: ícone + título, busca (só computador), botão de período e menu ⋯.
// Linha 2: abas Pedidos | Notas fiscais. Na aba de notas não há busca nem período.
export type AbaPedidos = 'pedidos' | 'notas';

export default function PedidosCabecalho({ aba, onAba, busca, onBusca, rotuloPeriodo, onAbrirPeriodo, menu, notasProblema }: {
  aba: AbaPedidos;
  onAba: (a: AbaPedidos) => void;
  busca: string;
  onBusca: (v: string) => void;
  rotuloPeriodo: string;
  onAbrirPeriodo: () => void;
  menu: ItemMenu[];
  notasProblema?: number;
}) {
  const naNotas = aba === 'notas';
  const abas: { id: AbaPedidos; rotulo: string; icone: string }[] = [
    { id: 'pedidos', rotulo: 'Pedidos', icone: 'ri-file-list-3-line' },
    { id: 'notas', rotulo: 'Notas fiscais', icone: 'ri-file-shield-2-line' },
  ];

  return (
    <div className="px-4 md:px-6 pt-4 md:pt-5 pb-0 flex-shrink-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
      {/* Linha 1 */}
      <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
        <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
          <i className={`${naNotas ? 'ri-file-shield-2-line' : 'ri-file-list-3-line'} text-white text-base md:text-lg`} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base md:text-lg font-bold text-zinc-800 truncate">{naNotas ? 'Notas fiscais' : 'Pedidos'}</h1>
          <p className="text-xs text-zinc-400 hidden lg:block truncate">
            {naNotas ? 'NFC-e: consultar, reimprimir, cancelar e XML' : 'Achar qualquer pedido e resolver o que falta'}
          </p>
        </div>

        {!naNotas && (
          <>
            {/* Busca: só no computador (no celular a busca fica na lista) */}
            <label className="hidden lg:flex items-center gap-2 w-72 h-10 px-3 rounded-xl border border-zinc-200 bg-zinc-50 focus-within:bg-white focus-within:border-amber-400 flex-shrink-0">
              <i className="ri-search-line text-zinc-400 text-base" />
              <input
                value={busca}
                onChange={(e) => onBusca(e.target.value)}
                placeholder="Nº, mesa, cliente, item ou valor…"
                aria-label="Buscar pedido"
                className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-zinc-800 placeholder:text-zinc-400"
              />
              {busca && (
                <button type="button" onClick={() => onBusca('')} aria-label="Limpar a busca"
                  className="text-zinc-400 hover:text-zinc-600 cursor-pointer flex-shrink-0">
                  <i className="ri-close-line text-base" />
                </button>
              )}
            </label>

            {/* Período */}
            <button type="button" onClick={onAbrirPeriodo} aria-label={`Período: ${rotuloPeriodo}. Trocar`}
              className="h-10 min-w-0 inline-flex items-center gap-1.5 px-3 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-white hover:border-amber-300 text-[13px] font-extrabold text-zinc-800 cursor-pointer flex-shrink-0">
              <i className="ri-calendar-line text-base text-amber-600 flex-shrink-0" />
              <span className="truncate max-w-[84px] sm:max-w-[140px] md:max-w-[240px]" title={rotuloPeriodo}>{rotuloPeriodo}</span>
              <i className="ri-arrow-down-s-line text-base text-zinc-400 flex-shrink-0" />
            </button>
          </>
        )}

        <MenuMais grande rotulo="Mais: planilha, pedidos por hora, atualizar" itens={menu} />
      </div>

      {/* Linha 2: abas (no celular as duas dividem a largura, ícone em cima) */}
      <div className="flex md:gap-0.5 -mx-4 md:mx-0 px-1 md:px-0" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }} role="tablist">
        {abas.map((a) => {
          const ativa = aba === a.id;
          const n = a.id === 'notas' ? (notasProblema ?? 0) : 0;
          return (
            <button key={a.id} type="button" role="tab" aria-selected={ativa} onClick={() => onAba(a.id)}
              className={`relative flex flex-1 md:flex-none flex-col md:flex-row items-center justify-center gap-0.5 md:gap-1.5 min-w-0 px-1 md:px-4 pt-2 pb-1.5 md:py-2.5 text-[10.5px] md:text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                ativa ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}>
              <i className={`${a.icone} text-lg leading-none md:text-[13px] md:leading-normal`} />
              {a.rotulo}
              {n > 0 && (
                <span title={`${n} nota${n > 1 ? 's' : ''} com problema`}
                  className="absolute top-0.5 left-1/2 ml-3 md:static md:ml-0 text-[9px] font-black px-1.5 py-0.5 rounded-full text-white leading-none md:leading-normal bg-red-500">
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
