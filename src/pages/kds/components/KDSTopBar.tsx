import { memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '@/contexts/AppModeContext';
import type { EstacaoAbertaInfo } from '@/contexts/SessaoContext';

interface Props {
  estacaoFiltro: string;
  estacoesNomes: string[];
  contadorPorEstacao: Record<string, number>;
  alertasOutrasEstacoes: Array<{ est: string; pendentes: number }>;
  totalAtivos: number;
  totalNovos: number;
  somAtivo: boolean;
  sessaoNumero?: string;
  clock: Date;
  insumosEsgotadosCount: number;
  estacaoInfo: EstacaoAbertaInfo | null;
  busca: string;
  onBuscaChange: (v: string) => void;
  onEstacaoChange: (est: string) => void;
  onAtivarSom: () => void;
  onAdicionarOperador: () => void;
  onRegistrarPerda: () => void;
  onEsgotadoModal: () => void;
  onFecharEstacao: () => void;
}

export const KDSTopBar = memo(function KDSTopBar({
  estacaoFiltro,
  estacoesNomes,
  contadorPorEstacao,
  alertasOutrasEstacoes,
  totalAtivos,
  totalNovos,
  somAtivo,
  sessaoNumero,
  clock,
  insumosEsgotadosCount,
  estacaoInfo,
  busca,
  onBuscaChange,
  onEstacaoChange,
  onAtivarSom,
  onAdicionarOperador,
  onRegistrarPerda,
  onEsgotadoModal,
  onFecharEstacao,
}: Props) {
  const navigate = useNavigate();
  const { setMode } = useAppMode();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center justify-between px-4 h-14 flex-shrink-0 gap-3 border-b border-amber-200/60" style={{ background: 'linear-gradient(90deg, #fef3c7 0%, #fffbeb 40%, #fff 100%)' }}>
      {/* ── Esquerda: voltar + logo + sessão + contadores ── */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Botão Módulos */}
        <button
          onClick={() => { setMode('modulos'); navigate('/modulos'); }}
          title="Voltar aos Módulos"
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 cursor-pointer transition-colors flex-shrink-0"
        >
          <i className="ri-arrow-left-line text-sm" />
        </button>

        <div className="w-px h-4 bg-zinc-200" />

        {/* Logo KDS */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-6 h-6 flex items-center justify-center rounded-md flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
          >
            <i className="ri-layout-grid-line text-xs text-white" />
          </div>
          <span className="text-zinc-800 font-bold text-sm">KDS</span>
          {sessaoNumero && (
            <span className="text-zinc-400 text-xs font-mono hidden md:inline">{sessaoNumero}</span>
          )}
        </div>

        {/* Contadores */}
        <div className="hidden sm:flex items-center gap-1.5">
          <span className="text-xs text-zinc-400">{totalAtivos} ativos</span>
          {totalNovos > 0 && (
            <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full animate-pulse">
              {totalNovos} novo{totalNovos > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Estação ativa */}
        <div className="hidden md:flex items-center gap-1 px-2 py-1 bg-white/80 border border-zinc-200 rounded-full">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
          <span className="text-xs text-zinc-600 font-medium">
            {estacaoFiltro === 'Todas' ? 'Todas' : estacaoFiltro}
          </span>
          {estacaoInfo && (
            <span className="text-zinc-400 text-xs hidden lg:inline"> · {estacaoInfo.operadorNome}</span>
          )}
        </div>

        {/* Alertas outras estações */}
        {alertasOutrasEstacoes.length > 0 && (
          <div className="hidden sm:flex items-center gap-1">
            {alertasOutrasEstacoes.map(({ est, pendentes }) => (
              <button
                key={est}
                onClick={() => onEstacaoChange(est)}
                title={`${pendentes} pedido(s) pendente(s) em ${est}`}
                className="flex items-center gap-1 px-2 py-0.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-full text-red-600 text-[10px] font-bold cursor-pointer transition-colors whitespace-nowrap"
              >
                <i className="ri-alarm-warning-line text-[10px]" />
                {est}: {pendentes}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Centro: busca + filtro de estações ── */}
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-center px-3">
        {/* Campo de busca */}
        <div className={`relative flex-shrink-0 transition-all duration-200 ${
          busca ? 'w-48' : 'w-36 hover:w-48 focus-within:w-48'
        }`}>
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 flex items-center justify-center pointer-events-none">
            <i className="ri-search-line text-xs text-zinc-400" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={busca}
            onChange={(e) => onBuscaChange(e.target.value)}
            placeholder="Mesa, nome, senha..."
            className="w-full pl-7 pr-6 py-1.5 text-xs bg-white/80 border border-zinc-200 rounded-full focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-300 placeholder-zinc-400 text-zinc-700"
          />
          {busca && (
            <button
              onClick={() => { onBuscaChange(''); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center cursor-pointer text-zinc-400 hover:text-zinc-600"
            >
              <i className="ri-close-circle-fill text-xs" />
            </button>
          )}
        </div>

        {/* Filtros de estação */}
        <div className="flex items-center gap-1.5 overflow-x-auto min-w-0">
          {estacoesNomes.map((est) => {
            const count = contadorPorEstacao[est] ?? 0;
            const isActive = estacaoFiltro === est;
            return (
              <button
                key={est}
                onClick={() => onEstacaoChange(est)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? 'bg-zinc-800 text-white'
                    : 'bg-white/70 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 border border-zinc-200'
                }`}
              >
                {est}
                {count > 0 && (
                  <span
                    className={`text-[9px] font-black px-1 py-0.5 rounded-full min-w-[14px] text-center ${
                      isActive ? 'bg-white/20 text-white' : 'bg-amber-500 text-white'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Direita: ações uniformes + relógio ── */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Grupo de ações — todos com o mesmo tamanho e estilo base */}
        <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-200 rounded-lg p-1">
          <ActionBtn
            icon="ri-user-add-line"
            label="Operador"
            onClick={onAdicionarOperador}
            title="Adicionar Operador"
          />
          <div className="w-px h-4 bg-zinc-200" />
          <ActionBtn
            icon="ri-alert-line"
            label="Perda"
            onClick={onRegistrarPerda}
            title="Registrar Perda"
            danger
          />
          <div className="w-px h-4 bg-zinc-200" />
          <ActionBtn
            icon="ri-forbid-2-line"
            label="Esgotado"
            onClick={onEsgotadoModal}
            title="Marcar Esgotado"
            badge={insumosEsgotadosCount > 0 ? insumosEsgotadosCount : undefined}
            warn
          />
          <div className="w-px h-4 bg-zinc-200" />
          <ActionBtn
            icon={somAtivo ? 'ri-volume-up-line' : 'ri-volume-mute-line'}
            label={somAtivo ? 'Som ON' : 'Som OFF'}
            onClick={onAtivarSom}
            title={somAtivo ? 'Som ativo — clique para desativar' : 'Som desativado — clique para ativar'}
            active={somAtivo}
          />
          <div className="w-px h-4 bg-zinc-200" />
          <ActionBtn
            icon="ri-logout-box-r-line"
            label="Fechar"
            onClick={onFecharEstacao}
            title="Fechar Estação"
          />
        </div>

        {/* Relógio */}
        <div className="text-right ml-1 hidden sm:block flex-shrink-0">
          <p className="text-zinc-800 font-bold tabular-nums text-sm leading-none">
            {clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-zinc-400 text-[10px] capitalize mt-0.5 hidden md:block">
            {clock.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
          </p>
        </div>
      </div>
    </div>
  );
});

/* ── ActionBtn: botão uniforme para ações do KDS ── */
interface ActionBtnProps {
  icon: string;
  label: string;
  onClick: () => void;
  title?: string;
  active?: boolean;
  danger?: boolean;
  warn?: boolean;
  badge?: number;
}

function ActionBtn({ icon, label, onClick, title, active, danger, warn, badge }: ActionBtnProps) {
  const base = 'relative w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-colors whitespace-nowrap flex-shrink-0';
  const color = active
    ? 'bg-amber-100 text-amber-600'
    : danger
    ? 'text-red-400 hover:bg-red-50 hover:text-red-600'
    : warn
    ? 'text-orange-400 hover:bg-orange-50 hover:text-orange-600'
    : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700';

  return (
    <button onClick={onClick} title={title ?? label} className={`${base} ${color}`}>
      <i className={`${icon} text-sm`} />
      {badge != null && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 flex items-center justify-center bg-orange-500 text-white text-[7px] font-black rounded-full">
          {badge}
        </span>
      )}
    </button>
  );
}