import { useState } from 'react';
import { salvarDashboardMetas, type DashboardMeta } from '@/hooks/useDashboardPainel';

// Metas do Dashboard por dia da semana, salvas na loja (valem em qualquer aparelho).
// Antes ficavam no localStorage: se a loja ainda não tem metas no banco, a antiga do navegador vira o ponto de partida.

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function metaAntigaDoNavegador(tenantId: string): Omit<DashboardMeta, 'dia_semana'> | null {
  try {
    const raw = localStorage.getItem(`dashboard_metas_dia:${tenantId}`);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return { faturamento: Number(m.faturamento) || 0, pedidos: Number(m.pedidos) || 0, ticket: Number(m.ticket) || 0 };
  } catch {
    return null;
  }
}

interface Props {
  tenantId: string;
  metas: DashboardMeta[];
  diaHoje: number;
  onFechar: () => void;
  onSalvo: () => void;
}

export default function MetasModal({ tenantId, metas, diaHoje, onFechar, onSalvo }: Props) {
  const [linhas, setLinhas] = useState<DashboardMeta[]>(() => {
    const antiga = metas.length === 0 ? metaAntigaDoNavegador(tenantId) : null;
    return DIAS.map((_, d) => metas.find((m) => m.dia_semana === d)
      ?? { dia_semana: d, faturamento: antiga?.faturamento ?? 0, pedidos: antiga?.pedidos ?? 0, ticket: antiga?.ticket ?? 0 });
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const mudar = (d: number, campo: 'faturamento' | 'pedidos' | 'ticket', v: string) =>
    setLinhas((ls) => ls.map((l) => (l.dia_semana === d ? { ...l, [campo]: Math.max(0, Number(v.replace(',', '.')) || 0) } : l)));

  const copiarHojeParaTodos = () => {
    const base = linhas[diaHoje];
    setLinhas((ls) => ls.map((l) => ({ ...l, faturamento: base.faturamento, pedidos: base.pedidos, ticket: base.ticket })));
  };

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await salvarDashboardMetas(tenantId, linhas);
      onSalvo();
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const campo = 'w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-sm tabular-nums text-zinc-800 focus:outline-none focus:border-amber-400';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onFechar}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <h3 className="text-sm font-bold text-zinc-900">Metas por dia da semana</h3>
            <p className="text-xs text-zinc-400">Valem para a loja inteira, em qualquer aparelho</p>
          </div>
          <button onClick={onFechar} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-[72px_1fr_64px_1fr] gap-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            <span>Dia</span><span>Faturamento (R$)</span><span>Pedidos</span><span>Ticket (R$)</span>
          </div>
          <div className="space-y-2">
            {linhas.map((l) => (
              <div key={l.dia_semana} className={`grid grid-cols-[72px_1fr_64px_1fr] gap-2 items-center rounded-lg ${l.dia_semana === diaHoje ? 'bg-amber-50 -mx-2 px-2 py-1' : ''}`}>
                <span className={`text-xs font-semibold ${l.dia_semana === diaHoje ? 'text-amber-700' : 'text-zinc-600'}`}>
                  {DIAS[l.dia_semana].slice(0, 3)}{l.dia_semana === diaHoje && <span className="font-normal"> (hoje)</span>}
                </span>
                <input inputMode="decimal" className={campo} value={l.faturamento || ''} placeholder="0" onChange={(e) => mudar(l.dia_semana, 'faturamento', e.target.value)} />
                <input inputMode="numeric" className={campo} value={l.pedidos || ''} placeholder="0" onChange={(e) => mudar(l.dia_semana, 'pedidos', e.target.value)} />
                <input inputMode="decimal" className={campo} value={l.ticket || ''} placeholder="0" onChange={(e) => mudar(l.dia_semana, 'ticket', e.target.value)} />
              </div>
            ))}
          </div>
          <button onClick={copiarHojeParaTodos} className="mt-3 text-xs font-semibold text-amber-600 hover:text-amber-700 cursor-pointer">
            <i className="ri-file-copy-line" /> Copiar a meta de hoje para todos os dias
          </button>
          <p className="mt-2 text-[11px] text-zinc-400">Deixe 0 no dia em que não quiser meta.</p>
          {erro && <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-zinc-100">
          <button onClick={onFechar} className="flex-1 py-2.5 text-sm font-semibold border border-zinc-200 rounded-xl text-zinc-600 hover:bg-zinc-50 cursor-pointer">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="flex-1 py-2.5 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-50 cursor-pointer">
            {salvando ? 'Salvando...' : 'Salvar metas'}
          </button>
        </div>
      </div>
    </div>
  );
}
