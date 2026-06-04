import { useMemo, useState, useRef, useCallback } from 'react';
import type { Item } from '@/types/cardapio';
import { useEstoque } from '../../../../contexts/EstoqueContext';
import { useCardapio } from '../../../../contexts/CardapioContext';
import { useItensSemEstoque } from '@/hooks/useItensSemEstoque';
import type { InsumoFaltando } from '@/hooks/useItensSemEstoque';

interface Props {
  categoriaAtiva: string;
  busca: string;
  onItemClick: (item: Item) => void;
  onItemObs?: (item: Item) => void;
}

// Paleta de gradientes por inicial do nome
const GRADIENTS = [
  'from-orange-400 to-rose-500',
  'from-amber-400 to-orange-500',
  'from-emerald-400 to-teal-500',
  'from-violet-400 to-purple-500',
  'from-sky-400 to-blue-500',
  'from-pink-400 to-rose-500',
  'from-lime-400 to-green-500',
  'from-red-400 to-orange-500',
  'from-cyan-400 to-sky-500',
  'from-fuchsia-400 to-pink-500',
];

function getGradient(nome: string): string {
  const code = nome.charCodeAt(0) || 0;
  return GRADIENTS[code % GRADIENTS.length];
}

function getInitials(nome: string): string {
  const words = nome.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function NoPhotoPlaceholder({ nome, esgotado }: { nome: string; esgotado: boolean }) {
  const gradient = getGradient(nome);
  const initials = getInitials(nome);
  return (
    <div className={`w-full h-full bg-gradient-to-br ${gradient} flex flex-col items-center justify-center relative overflow-hidden ${esgotado ? 'grayscale' : ''}`}>
      <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-white/10 rounded-full" />
      <div className="absolute -top-4 -left-4 w-16 h-16 bg-white/10 rounded-full" />
      <span className="text-white font-black text-3xl tracking-tight drop-shadow z-10 select-none">
        {initials}
      </span>
      <div className="w-4 h-4 flex items-center justify-center mt-1 z-10">
        <i className="ri-restaurant-line text-white/50 text-xs" />
      </div>
    </div>
  );
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Tooltip com insumos faltando
function InsumosFaltandoTooltip({ insumos, visible }: { insumos: InsumoFaltando[]; visible: boolean }) {
  if (!visible || insumos.length === 0) return null;
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-52 bg-zinc-900 text-white rounded-xl p-3 shadow-xl pointer-events-none">
      <p className="text-[10px] font-bold text-red-400 mb-1.5 uppercase tracking-wide">Insumo(s) em falta</p>
      <div className="space-y-1">
        {insumos.map((ins) => (
          <div key={ins.id} className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-red-400" />
            <span className="text-[11px] text-white/90 leading-tight">{ins.nome}</span>
            <span className="ml-auto text-[10px] text-zinc-400 whitespace-nowrap">{ins.estoque} {ins.unidade}</span>
          </div>
        ))}
      </div>
      {/* seta */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900" />
    </div>
  );
}

export default function ItemGridPDV({ categoriaAtiva, busca, onItemClick, onItemObs }: Props) {
  const { itensAtivos, numerosMap: globalNumberMap } = useCardapio();
  const { itensDesabilitadosIds } = useEstoque();
  const { mapaItens: itensSemEstoque } = useItensSemEstoque();
  const [tooltipItemId, setTooltipItemId] = useState<string | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnterSemEstoque = useCallback((itemId: string) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltipItemId(itemId);
  }, []);

  const handleMouseLeaveSemEstoque = useCallback(() => {
    tooltipTimer.current = setTimeout(() => setTooltipItemId(null), 150);
  }, []);
  const isPureNumber = /^\d+$/.test(busca.trim());
  const searchNumber = isPureNumber ? parseInt(busca.trim(), 10) : null;

  const itens = useMemo(() => {
    return itensAtivos
      .filter((item) => categoriaAtiva === 'todas' || item.categoriaId === categoriaAtiva)
      .filter((item) => {
        if (!busca) return true;
        if (searchNumber !== null) {
          return globalNumberMap.get(item.id) === searchNumber;
        }
        return item.nome.toLowerCase().includes(busca.toLowerCase());
      });
  }, [itensAtivos, categoriaAtiva, busca, searchNumber, globalNumberMap]);

  if (itens.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-400 py-16">
        <div className="w-12 h-12 flex items-center justify-center mb-3">
          <i className="ri-search-line text-3xl" />
        </div>
        <p className="text-sm">Nenhum item encontrado</p>
        {isPureNumber && (
          <p className="text-xs text-zinc-300 mt-1">Nenhum item com número {busca}</p>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 md:gap-3 px-3 md:px-4 py-3 md:py-4">
        {itens.map((item) => {
          const promoAtiva = item.promocoes.find((p) => p.ativo);
          const precoFinal = promoAtiva ? promoAtiva.precoPromocional : item.preco;
          const insumosFaltando = itensSemEstoque.get(item.id) ?? [];
          const semEstoqueInsumo = insumosFaltando.length > 0;
          const esgotado = itensDesabilitadosIds.includes(item.id) || semEstoqueInsumo;
          const itemNumber = globalNumberMap.get(item.id) ?? 0;
          const temObrigatorio = item.gruposOpcoes.some((g) => g.obrigatorio);

          return (
            <div
              key={item.id}
              className={`group flex flex-col rounded-2xl overflow-hidden text-left transition-all duration-200 relative
                ${esgotado
                  ? 'opacity-70 bg-zinc-100 border border-zinc-200'
                  : 'bg-white border border-zinc-100 hover:border-amber-300 hover:-translate-y-0.5'
                }`}
              onMouseEnter={semEstoqueInsumo ? () => handleMouseEnterSemEstoque(item.id) : undefined}
              onMouseLeave={semEstoqueInsumo ? handleMouseLeaveSemEstoque : undefined}
            >
              {/* Tooltip insumos faltando */}
              {semEstoqueInsumo && (
                <InsumosFaltandoTooltip
                  insumos={insumosFaltando}
                  visible={tooltipItemId === item.id}
                />
              )}
              {/* Área clicável principal */}
              <button
                onClick={() => !esgotado && onItemClick(item)}
                disabled={esgotado}
                className={`flex flex-col w-full text-left ${esgotado ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {/* Imagem */}
                <div className="w-full aspect-[4/3] overflow-hidden relative flex-shrink-0">
                  {item.fotoUrl ? (
                    <img
                      src={item.fotoUrl}
                      alt={item.nome}
                      className={`w-full h-full object-cover object-center transition-transform duration-300 ${!esgotado ? 'group-hover:scale-105' : 'grayscale'}`}
                    />
                  ) : (
                    <NoPhotoPlaceholder nome={item.nome} esgotado={esgotado} />
                  )}

                  {/* Número do item — canto superior esquerdo */}
                  <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-black px-1.5 py-0.5 rounded-lg min-w-[22px] text-center leading-tight tabular-nums">
                    {itemNumber}
                  </div>

                  {/* Badge PROMO */}
                  {promoAtiva && !esgotado && (
                    <div className="absolute top-2 right-2 bg-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full tracking-wide">
                      PROMO
                    </div>
                  )}

                  {/* Overlay esgotado */}
                  {esgotado && (
                    <div className="absolute inset-0 bg-zinc-900/50 flex flex-col items-center justify-center gap-1.5 px-2">
                      <span className="text-white text-[10px] font-black bg-red-600 px-2.5 py-1 rounded-full tracking-widest uppercase">
                        {semEstoqueInsumo ? 'Sem insumo' : 'Esgotado'}
                      </span>
                      {semEstoqueInsumo && insumosFaltando.length <= 2 && (
                        <div className="flex flex-col items-center gap-0.5">
                          {insumosFaltando.map((ins) => (
                            <span key={ins.id} className="text-white/90 text-[9px] font-medium bg-black/40 px-1.5 py-0.5 rounded-md max-w-[90%] truncate">
                              {ins.nome}
                            </span>
                          ))}
                        </div>
                      )}
                      {semEstoqueInsumo && insumosFaltando.length > 2 && (
                        <span className="text-white/80 text-[9px] font-medium">
                          {insumosFaltando.length} insumos em falta
                        </span>
                      )}
                    </div>
                  )}

                  {/* Hover overlay com ícone + */}
                  {!esgotado && !temObrigatorio && (
                    <div className="absolute inset-0 bg-amber-500/0 group-hover:bg-amber-500/15 transition-all duration-200 flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 scale-75 group-hover:scale-100 bg-amber-500 text-white rounded-full w-9 h-9 flex items-center justify-center">
                        <i className="ri-add-line text-lg font-bold" />
                      </div>
                    </div>
                  )}

                  {/* SLA badge — canto inferior direito */}
                  {!esgotado && (
                    <div className="absolute bottom-2 right-2 bg-black/50 backdrop-blur-sm text-white/90 text-[9px] font-semibold px-1.5 py-0.5 rounded-md">
                      {item.slaMinutos}min
                    </div>
                  )}
                </div>

                {/* Info do item */}
                <div className="px-3 pt-2.5 pb-1.5 flex-1 flex flex-col gap-1">
                  <p className={`text-xs font-bold leading-snug line-clamp-2 ${esgotado ? 'text-zinc-400' : 'text-zinc-900'}`}>
                    {item.nome}
                  </p>

                  {esgotado ? (
                    <p className="text-[10px] text-red-400 font-semibold">
                      {semEstoqueInsumo ? `Falta: ${insumosFaltando.map(i => i.nome).join(', ')}` : 'Insumo esgotado'}
                    </p>
                  ) : (
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      {promoAtiva && (
                        <span className="text-[10px] text-zinc-300 line-through font-medium">{formatPrice(item.preco)}</span>
                      )}
                      <span className={`text-sm font-black tabular-nums ${promoAtiva ? 'text-red-500' : 'text-amber-600'}`}>
                        {formatPrice(precoFinal)}
                      </span>
                    </div>
                  )}
                </div>
              </button>

              {/* Rodapé — só quando não esgotado */}
              {!esgotado && (
                <div className="px-3 pb-2.5 pt-0 flex items-center justify-between gap-1">
                  {temObrigatorio ? (
                    <span className="flex items-center gap-1 text-[10px] text-zinc-400 font-medium">
                      <i className="ri-settings-3-line text-xs" />
                      Personalizar
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onItemObs?.(item);
                      }}
                      className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-amber-600 transition-colors cursor-pointer whitespace-nowrap rounded-lg px-1.5 py-1 hover:bg-amber-50"
                      title="Adicionar observação"
                    >
                      <i className="ri-chat-1-line text-xs" />
                      Obs
                    </button>
                  )}
                  {temObrigatorio && (
                    <span className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      Obrigatório
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
