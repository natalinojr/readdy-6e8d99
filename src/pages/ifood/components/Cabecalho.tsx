import type { AbaIfood } from '../lib/tipos';
import type { LojaIfood } from '../lib/useIfoodDados';
import { rotuloPeriodo as rotuloDoPeriodo } from './PeriodoFolha';

// Topo da área iFood (protótipo docs/prototipos/ifood-proposta.html), mesmo desenho do topo de Pedidos.
// Linha 1: ícone + título, período (só nas abas com período) e ⚙ (conectar e ligar).
// Linha 2: lojas (só com 2 ou mais). Linha 3: abas.

const ABAS: { id: AbaIfood; rotulo: string; icone: string }[] = [
  { id: 'hoje', rotulo: 'Hoje', icone: 'ri-sun-line' },
  { id: 'pedidos', rotulo: 'Pedidos', icone: 'ri-file-list-3-line' },
  { id: 'itens', rotulo: 'Itens e CMV', icone: 'ri-restaurant-line' },
  { id: 'dinheiro', rotulo: 'Dinheiro', icone: 'ri-money-dollar-circle-line' },
  { id: 'resultados', rotulo: 'Resultados', icone: 'ri-line-chart-line' },
  { id: 'loja', rotulo: 'Loja', icone: 'ri-store-3-line' },
];

export default function IfoodCabecalho({ aba, onAba, podeAba, lojas, loja, onLoja, rotuloPeriodo, onAbrirPeriodo, configurar, nItensSemFicha }: {
  aba: AbaIfood;
  onAba: (a: AbaIfood) => void;
  podeAba: (a: AbaIfood) => boolean;
  lojas: LojaIfood[];
  loja: string | null;
  onLoja: (id: string | null) => void;
  /** String crua do período ('Hoje', 'custom:…'); null = a aba não tem período. */
  rotuloPeriodo: string | null;
  onAbrirPeriodo: () => void;
  configurar: boolean;
  nItensSemFicha: number;
}) {
  const texto = rotuloPeriodo != null ? rotuloDoPeriodo(rotuloPeriodo) : null;
  const naConexao = aba === 'conexao';

  const pilula = (ativa: boolean) =>
    `flex-none inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12.5px] font-bold cursor-pointer whitespace-nowrap ${
      ativa ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`;

  return (
    <div className="px-4 md:px-6 pt-4 md:pt-5 pb-0 flex-shrink-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
      {/* Linha 1 */}
      <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
        <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #EA1D2C 0%, #B5121F 100%)' }}>
          <i className="ri-e-bike-2-fill text-white text-base md:text-lg" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base md:text-lg font-bold text-zinc-800 truncate">iFood</h1>
          <p className="text-xs text-zinc-400 hidden lg:block truncate">Pedidos, itens, dinheiro e a loja no iFood, num lugar só</p>
        </div>

        {texto != null && (
          <button type="button" onClick={onAbrirPeriodo} aria-label={`Período: ${texto}. Trocar`}
            className="h-10 min-w-0 inline-flex items-center gap-1.5 px-3 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-white hover:border-amber-300 text-[13px] font-extrabold text-zinc-800 cursor-pointer flex-shrink-0">
            <i className="ri-calendar-line text-base text-amber-600 flex-shrink-0" />
            <span className="truncate max-w-[110px] sm:max-w-[160px] md:max-w-[240px]" title={texto}>{texto}</span>
            <i className="ri-arrow-down-s-line text-base text-zinc-400 flex-shrink-0" />
          </button>
        )}

        {configurar && (
          <button type="button" onClick={() => onAba('conexao')} aria-label="Conectar e ligar" title="Conectar e ligar"
            className={`w-10 h-10 flex-shrink-0 inline-flex items-center justify-center rounded-xl border cursor-pointer ${
              naConexao ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600'}`}>
            <i className="ri-settings-3-line text-lg" />
          </button>
        )}
      </div>

      {/* Linha 2: lojas */}
      {lojas.length >= 2 && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 mb-3" role="group" aria-label="Loja do iFood">
          <button type="button" onClick={() => onLoja(null)} aria-pressed={loja === null} className={pilula(loja === null)}>Todas as lojas</button>
          {lojas.map((l) => (
            <button key={l.id} type="button" onClick={() => onLoja(l.id)} aria-pressed={loja === l.id} className={pilula(loja === l.id)}>{l.nome}</button>
          ))}
        </div>
      )}

      {/* Linha 3: abas (no celular dividem a largura, ícone em cima) */}
      <div className="flex md:gap-0.5 -mx-4 md:mx-0 px-1 md:px-0" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }} role="tablist">
        {ABAS.filter((a) => podeAba(a.id)).map((a) => {
          const ativa = aba === a.id;
          const n = a.id === 'itens' ? nItensSemFicha : 0;
          return (
            <button key={a.id} type="button" role="tab" aria-selected={ativa} onClick={() => onAba(a.id)}
              className={`relative flex flex-1 md:flex-none flex-col md:flex-row items-center justify-center gap-0.5 md:gap-1.5 min-w-0 px-1 md:px-4 pt-2 pb-1.5 md:py-2.5 text-[10.5px] md:text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                ativa ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}>
              <i className={`${a.icone} text-lg leading-none md:text-[13px] md:leading-normal`} />
              {a.rotulo}
              {n > 0 && (
                <span title={`${n} ite${n > 1 ? 'ns' : 'm'} sem ficha`}
                  className="absolute top-0.5 left-1/2 ml-3 md:static md:ml-0 text-[9px] font-black px-1.5 py-0.5 rounded-full text-white leading-none md:leading-normal bg-amber-500">
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
