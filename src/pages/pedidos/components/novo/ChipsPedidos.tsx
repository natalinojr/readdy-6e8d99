import { ICONE_CANAL, ROTULO_CANAL, type Canal, type FiltroChip } from '@/lib/pedidosRegras';

// Fileira de filtros da lista de Pedidos: os botões com a contagem de cada um (o que está em zero
// some) e, na mesma linha, o seletor de canal. No celular a fileira rola de lado junto.
// Mesmo desenho dos Chips do Estoque (EstoqueUi); aqui a fileira é própria para o seletor de
// canal poder rolar junto com os botões (o `Chips` do Estoque não aceita item de fora).

interface OpcaoChip { id: FiltroChip; rotulo: string; tom?: 'amber' }

const BASE = 'flex-none inline-flex items-center gap-1 h-8 rounded-full border text-[12.5px] font-bold cursor-pointer whitespace-nowrap';

function corChip(ativo: boolean, tom?: 'amber') {
  if (ativo) return 'bg-zinc-900 border-zinc-900 text-white';
  if (tom === 'amber') return 'bg-amber-50 border-amber-200 text-amber-800';
  return 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300';
}

export default function ChipsPedidos({ chip, onChip, n, fiscalAtivo, canal, onCanal, canais, plataformas = [], plataforma = 'todas', onPlataforma }: {
  chip: FiltroChip;
  onChip: (c: FiltroChip) => void;
  n: Record<FiltroChip, number>;
  fiscalAtivo: boolean;
  canal: Canal | 'todos';
  onCanal: (c: Canal | 'todos') => void;
  /** Canais presentes na lista. */
  canais: Canal[];
  /** Plataformas de delivery presentes (só aparece com o canal Delivery escolhido). */
  plataformas?: { key: string; label: string }[];
  plataforma?: string;
  onPlataforma?: (p: string) => void;
}) {
  const todas: OpcaoChip[] = [
    { id: 'todos', rotulo: 'Todos' },
    { id: 'cozinha', rotulo: 'Na cozinha' },
    { id: 'naopago', rotulo: 'Não pagos', tom: 'amber' },
    ...(fiscalAtivo ? [{ id: 'semnota' as const, rotulo: 'Sem nota', tom: 'amber' as const }] : []),
    { id: 'cancelados', rotulo: 'Cancelados' },
  ];
  // Em zero some, menos "Todos" e o que está escolhido (para dar para sair dele).
  const opcoes = todas.filter((o) => o.id === 'todos' || o.id === chip || (n[o.id] ?? 0) > 0);

  // O canal escolhido fica na lista mesmo que a lista nova não tenha mais pedido dele.
  const listaCanais = [...new Set<Canal>([...canais, ...(canal !== 'todos' ? [canal] : [])])];
  const mostrarCanal = canais.length > 1 || canal !== 'todos';
  const canalAtivo = canal !== 'todos';

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
      {opcoes.map((o) => {
        const ativo = o.id === chip;
        return (
          <button key={o.id} type="button" onClick={() => onChip(o.id)} aria-pressed={ativo}
            className={`${BASE} px-3 ${corChip(ativo, o.tom)}`}>
            {o.rotulo}
            <span className={ativo ? 'text-white/70' : 'opacity-70'}>{(n[o.id] ?? 0).toLocaleString('pt-BR')}</span>
          </button>
        );
      })}

      {mostrarCanal && (
        <label className="relative flex-none inline-flex items-center">
          <i className={`${canalAtivo ? ICONE_CANAL[canal] : 'ri-apps-line'} absolute left-3 text-sm pointer-events-none ${canalAtivo ? 'text-white' : 'text-zinc-500'}`} />
          <select
            value={canal}
            onChange={(e) => onCanal(e.target.value as Canal | 'todos')}
            aria-label="Filtrar por canal"
            className={`appearance-none h-8 pl-8 pr-7 rounded-full border text-[12.5px] font-bold cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${corChip(canalAtivo)}`}
          >
            <option value="todos" className="bg-white text-zinc-900">Todos os canais</option>
            {listaCanais.map((c) => (
              <option key={c} value={c} className="bg-white text-zinc-900">{ROTULO_CANAL[c]}</option>
            ))}
          </select>
          <i className={`ri-arrow-down-s-line absolute right-2 text-base pointer-events-none ${canalAtivo ? 'text-white/80' : 'text-zinc-400'}`} />
        </label>
      )}

      {canal === 'delivery' && onPlataforma && plataformas.length > 1 && (
        <label className="relative flex-none inline-flex items-center">
          <select
            value={plataforma}
            onChange={(e) => onPlataforma(e.target.value)}
            aria-label="Filtrar por plataforma de delivery"
            className={`appearance-none h-8 pl-3 pr-7 rounded-full border text-[12.5px] font-bold cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${corChip(plataforma !== 'todas')}`}
          >
            <option value="todas" className="bg-white text-zinc-900">Todas as plataformas</option>
            {plataformas.map((p) => (
              <option key={p.key} value={p.key} className="bg-white text-zinc-900">{p.label}</option>
            ))}
          </select>
          <i className={`ri-arrow-down-s-line absolute right-2 text-base pointer-events-none ${plataforma !== 'todas' ? 'text-white/80' : 'text-zinc-400'}`} />
        </label>
      )}
    </div>
  );
}
