// Detalhe (somente leitura) de um lançamento de folha importado do Domínio.
// Os valores vêm prontos da contabilidade: não passam pela calculadora do ERPOS.
// Para corrigir, reimporta-se o extrato do mês (substitui os pendentes).
import type { PayrollEntry } from '@/hooks/useRH';
import { formatCurrency } from '@/lib/formatters';
import { CATEGORIAS_FOLHA, categorizarRubrica, labelCategoria } from '@/lib/dominioExtrato';

type Rub = NonNullable<PayrollEntry['rubricas']>[number];

function monthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export default function DetalheFolhaModal({ entry, onClose }: { entry: PayrollEntry; onClose: () => void }) {
  const rubricas: Rub[] = Array.isArray(entry.rubricas) ? entry.rubricas : [];
  const cat = (r: Rub) => r.categoria || categorizarRubrica(r);
  const grupo = (tipo: 'P' | 'D') => {
    const map = new Map<string, Rub[]>();
    rubricas.filter((r) => r.tipo === tipo).forEach((r) => {
      const k = cat(r);
      map.set(k, [...(map.get(k) ?? []), r]);
    });
    return [...map.entries()]
      .map(([k, rs]) => ({ k, rs, total: rs.reduce((s, r) => s + Number(r.valor || 0), 0) }))
      .sort((a, b) => b.total - a.total);
  };
  const proventos = grupo('P');
  const descontos = grupo('D');
  const cabecalho = (entry.notes ?? '').split('\n').filter((l) => l && !/^(Rubricas:|[PD] \d*\s)/.test(l) && !/^Importado do Domínio/.test(l));
  const custo = Number(entry.total_proventos ?? entry.gross_salary ?? 0) + Number(entry.fgts ?? 0);

  const Bloco = ({ titulo, cor, itens, total }: { titulo: string; cor: string; itens: typeof proventos; total: number }) => (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className={`text-xs font-bold uppercase tracking-wide ${cor}`}>{titulo}</p>
        <p className={`text-sm font-bold ${cor}`}>{formatCurrency(total)}</p>
      </div>
      {itens.length === 0 ? <p className="text-xs text-zinc-400">Nenhum</p> : (
        <div className="space-y-2">
          {itens.map(({ k, rs, total: t }) => (
            <div key={k} className="border border-zinc-100 rounded-lg">
              <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-50 rounded-t-lg">
                <span className="text-xs font-semibold text-zinc-700">{labelCategoria(k)}</span>
                <span className="text-xs font-bold text-zinc-800">{formatCurrency(t)}</span>
              </div>
              {rs.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 px-3 py-1 text-xs border-t border-zinc-50">
                  <span className="text-zinc-600 truncate">
                    {r.codigo ? <span className="text-zinc-400">{r.codigo} </span> : null}{r.descricao}
                    {r.referencia ? <span className="text-zinc-400"> ({r.referencia})</span> : null}
                  </span>
                  <span className="text-zinc-800 whitespace-nowrap">{formatCurrency(Number(r.valor || 0))}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-100">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-zinc-900">{entry.employee_name}</h3>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">DOMÍNIO</span>
            </div>
            <p className="text-xs text-zinc-500">{entry.role} · folha de {monthLabel(entry.reference_month)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { l: 'Proventos', v: Number(entry.total_proventos ?? entry.gross_salary ?? 0), c: 'text-green-700' },
              { l: 'Descontos', v: Number(entry.total_descontos ?? entry.deductions ?? 0), c: 'text-red-600' },
              { l: 'Líquido', v: Number(entry.net_salary ?? 0), c: 'text-zinc-900' },
              { l: 'Custo (proventos + FGTS)', v: custo, c: 'text-amber-700' },
            ].map((x) => (
              <div key={x.l} className="bg-zinc-50 rounded-xl p-3">
                <p className="text-[10px] uppercase text-zinc-400">{x.l}</p>
                <p className={`text-sm font-bold ${x.c}`}>{formatCurrency(x.v)}</p>
              </div>
            ))}
          </div>

          {cabecalho.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800 space-y-0.5">
              {cabecalho.map((l, i) => <p key={i}>{l}</p>)}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-5">
            <Bloco titulo="Proventos" cor="text-green-700" itens={proventos} total={proventos.reduce((s, g) => s + g.total, 0)} />
            <Bloco titulo="Descontos" cor="text-red-600" itens={descontos} total={descontos.reduce((s, g) => s + g.total, 0)} />
          </div>

          {Number(entry.fgts ?? 0) > 0 && (
            <div className="flex items-center justify-between border border-amber-100 bg-amber-50/50 rounded-lg px-3 py-2">
              <span className="text-xs font-semibold text-amber-800">{CATEGORIAS_FOLHA.fgts.label} — recolhido na guia, não sai do salário</span>
              <span className="text-sm font-bold text-amber-800">{formatCurrency(Number(entry.fgts))}</span>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-100">
          <p className="text-[11px] text-zinc-400">Valores calculados pela contabilidade no Domínio. Para corrigir, reimporte o extrato do mês: os lançamentos pendentes são substituídos.</p>
        </div>
      </div>
    </div>
  );
}
