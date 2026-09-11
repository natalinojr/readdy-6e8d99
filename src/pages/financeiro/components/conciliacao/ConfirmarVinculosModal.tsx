import { useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/formatters';
import type { StatementImport } from '@/hooks/useConciliacao';

// Pré-visualização da confirmação em lote: mostra o que cada pagamento vai baixar,
// deixa escolher o período e desmarcar itens antes de executar.
interface Props {
  /** Pagamentos pendentes com vínculo sugerido (exato ou forte) */
  rows: StatementImport[];
  confirming: boolean;
  onClose: () => void;
  onConfirm: (ids: string[]) => Promise<void>;
}

const dataBR = (iso?: string | null) =>
  iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

export default function ConfirmarVinculosModal({ rows, confirming, onClose, onConfirm }: Props) {
  const datas = rows.map(r => r.transaction_date).sort();
  const [de, setDe] = useState(datas[0] ?? '');
  const [ate, setAte] = useState(datas[datas.length - 1] ?? '');
  const [incluirFortes, setIncluirFortes] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set(rows.filter(r => r.match_confidence === 'exato').map(r => r.id)));

  const visiveis = useMemo(
    () => rows
      .filter(r => (!de || r.transaction_date >= de) && (!ate || r.transaction_date <= ate))
      .filter(r => r.match_confidence === 'exato' || incluirFortes)
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)),
    [rows, de, ate, incluirFortes],
  );
  const escolhidos = visiveis.filter(r => sel.has(r.id));
  const total = escolhidos.reduce((s, r) => s + Number(r.amount), 0);
  const notasImportadas = escolhidos.filter(r => r.match_detail?.auto_import === true).length;
  const juros = escolhidos.reduce((s, r) => s + Number(r.match_detail?.juros ?? 0), 0);
  const qtdFortes = rows.filter(r => r.match_confidence === 'forte').length;

  const toggle = (id: string) => setSel(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const todos = visiveis.length > 0 && visiveis.every(r => sel.has(r.id));
  const toggleTodos = () => setSel(prev => {
    const n = new Set(prev);
    visiveis.forEach(r => { if (todos) n.delete(r.id); else n.add(r.id); });
    return n;
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div>
            <h3 className="font-bold text-zinc-900">Confirmar pagamentos</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Confira o que cada pagamento vai baixar. Desmarque o que não quiser confirmar agora.
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-zinc-100 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Pagamentos de</label>
            <input type="date" value={de} onChange={e => setDe(e.target.value)} className="border border-zinc-200 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">até</label>
            <input type="date" value={ate} onChange={e => setAte(e.target.value)} className="border border-zinc-200 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          {qtdFortes > 0 && (
            <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer pb-2">
              <input type="checkbox" checked={incluirFortes} onChange={e => setIncluirFortes(e.target.checked)} />
              Mostrar também os {qtdFortes} vínculo(s) forte(s) (mesmo valor e mesmo fornecedor, mas vencimento diferente)
            </label>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {visiveis.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-10">Nenhum pagamento com vínculo neste período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 w-8"><input type="checkbox" checked={todos} onChange={toggleTodos} /></th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-zinc-500">Pago em</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-zinc-500">Pago a</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-zinc-500">Valor pago</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-zinc-500">Vai baixar</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-zinc-500">O que acontece</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visiveis.map(r => {
                  const d = (r.match_detail ?? {}) as Record<string, unknown>;
                  const j = Number(d.juros ?? 0);
                  const desc = Number(d.desconto ?? 0);
                  return (
                    <tr key={r.id} className={sel.has(r.id) ? 'bg-emerald-50/40' : ''} onClick={() => toggle(r.id)}>
                      <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{dataBR(r.transaction_date)}</td>
                      <td className="px-3 py-2 text-xs">
                        <p className="font-medium text-zinc-800">{r.counterpart_name || r.description}</p>
                        <p className="text-zinc-400">{d.boleto ? 'Boleto' : 'Pix/TED'}{r.match_confidence === 'forte' ? ' · vínculo forte' : ''}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-red-600 whitespace-nowrap">{formatCurrency(Number(r.amount))}</td>
                      <td className="px-3 py-2 text-xs">
                        <p className="text-zinc-800">{String(d.label ?? '')}</p>
                        <p className="text-zinc-400">
                          {d.parcela ? 'Parcela ' + String(d.parcela) + ' · ' : ''}{formatCurrency(Number(d.valor ?? 0))}{d.vencimento ? ' · vence ' + dataBR(String(d.vencimento)) : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-xs space-y-0.5">
                        {d.auto_import === true && (
                          <p className="text-blue-700"><i className="ri-magic-line mr-1" />Importa a nota como {Number(d.modelo) === 10 ? 'despesa' : 'compra'}</p>
                        )}
                        <p className="text-zinc-600">Baixa a parcela</p>
                        {j > 0 && <p className="text-amber-700">Lança juros/multa de {formatCurrency(j)}</p>}
                        {desc > 0 && d.boleto === true && <p className="text-amber-700">Registra desconto de {formatCurrency(desc)}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-100 bg-zinc-50 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0 text-xs text-zinc-600">
            <span className="font-semibold text-zinc-800">{escolhidos.length} selecionado(s) · {formatCurrency(total)}</span>
            {notasImportadas > 0 && <span> · {notasImportadas} nota(s) serão importadas automaticamente</span>}
            {juros > 0 && <span> · juros {formatCurrency(juros)}</span>}
          </div>
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer">Cancelar</button>
          <button
            onClick={() => onConfirm(escolhidos.map(r => r.id))}
            disabled={confirming || escolhidos.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <i className={confirming ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'} />
            {confirming ? 'Confirmando...' : 'Confirmar ' + escolhidos.length}
          </button>
        </div>
      </div>
    </div>
  );
}
