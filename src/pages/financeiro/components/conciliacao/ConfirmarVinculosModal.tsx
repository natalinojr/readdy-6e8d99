import { Fragment, useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/formatters';
import type { StatementImport } from '@/hooks/useConciliacao';

// Pré-visualização da confirmação em lote: mostra o que cada pagamento vai baixar,
// deixa escolher o período e desmarcar itens antes de executar.
//
// 2026-09-20: mostra SEMPRE todas as situações, separadas por quanto o sistema confia no vínculo.
// Antes, "forte" e "provável" ficavam escondidos atrás de uma caixinha — sumia da vista justamente
// o que precisa de conferência. Agora só a ligação direta vem marcada; o resto aparece desmarcado,
// com o motivo do aviso.
interface Props {
  /** Pagamentos pendentes com vínculo sugerido (exato, forte ou provável) */
  rows: StatementImport[];
  confirming: boolean;
  onClose: () => void;
  onConfirm: (ids: string[]) => Promise<void>;
}

const dataBR = (iso?: string | null) =>
  iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

/**
 * Como a nota vai entrar ao ser importada. O modelo (10 = serviço) é só o ponto de partida: quem
 * decide é a Classificação de Itens — nota de serviço cujo item é CMV entra como compra, e NF-e
 * cujo item é despesa entra como despesa (fiscal-inbound › importDocumentLocked).
 */
export function tipoDaNota(d: Record<string, unknown>): string {
  const classe = String(d.classe ?? '');
  if (classe === 'cmv') return 'compra (CMV)';
  if (classe === 'despesa') return 'despesa';
  return Number(d.modelo) === 10 ? 'despesa (serviço)' : 'compra (CMV)';
}

export default function ConfirmarVinculosModal({ rows, confirming, onClose, onConfirm }: Props) {
  const datas = rows.map(r => r.transaction_date).sort();
  const [de, setDe] = useState(datas[0] ?? '');
  const [ate, setAte] = useState(datas[datas.length - 1] ?? '');
  const [sel, setSel] = useState<Set<string>>(() => new Set(rows.filter(r => r.match_confidence === 'exato').map(r => r.id)));

  const visiveis = useMemo(
    () => rows
      .filter(r => (!de || r.transaction_date >= de) && (!ate || r.transaction_date <= ate))
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)),
    [rows, de, ate],
  );
  // Um bloco por situação, do mais seguro para o que precisa de olho
  const GRUPOS = [
    { conf: 'exato', titulo: 'Ligação direta', desc: 'Mesmo valor e mesma data/vencimento, com um único candidato.', cor: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    { conf: 'forte', titulo: 'Provável — confira antes', desc: 'Mesmo valor e mesmo fornecedor, mas com vencimento diferente, ou regra com aviso.', cor: 'text-amber-700 bg-amber-50 border-amber-200' },
    { conf: 'provavel', titulo: 'Incerto — mais de um candidato', desc: 'O valor bate com mais de uma conta ou nota: confira qual é antes de confirmar.', cor: 'text-red-700 bg-red-50 border-red-200' },
  ] as const;
  const porGrupo = GRUPOS.map(g => ({ ...g, itens: visiveis.filter(r => String(r.match_confidence) === g.conf) })).filter(g => g.itens.length > 0);
  const outros = visiveis.filter(r => !GRUPOS.some(g => g.conf === String(r.match_confidence)));
  const escolhidos = visiveis.filter(r => sel.has(r.id));
  const total = escolhidos.reduce((s, r) => s + Number(r.amount), 0);
  const notasImportadas = escolhidos.filter(r => r.match_detail?.auto_import === true).length;
  const juros = escolhidos.reduce((s, r) => s + Number(r.match_detail?.juros ?? 0), 0);

  const blocos = [
    ...porGrupo,
    ...(outros.length > 0 ? [{ conf: 'outros', titulo: 'Outras sugestões', desc: 'Confira antes de confirmar.', cor: 'text-zinc-600 bg-zinc-100 border-zinc-200', itens: outros }] : []),
  ];

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

  const Linha = (r: StatementImport) => {
    const d = (r.match_detail ?? {}) as Record<string, unknown>;
    const j = Number(d.juros ?? 0);
    const desc = Number(d.desconto ?? 0);
    // Regra de lançamento (match_kind 'rule'): não baixa conta — cria a despesa/compra já paga
    const regra = r.match_kind === 'rule';
    const comp = String(d.competencia ?? '');
    return (
      <tr key={r.id} className={sel.has(r.id) ? 'bg-emerald-50/40' : ''} onClick={() => toggle(r.id)}>
        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
        </td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">{dataBR(r.transaction_date)}</td>
        <td className="px-3 py-2 text-xs">
          <p className="font-medium text-zinc-800">{r.counterpart_name || r.description}</p>
          <p className="text-zinc-400">
          {d.boleto ? 'Boleto' : 'Pix/TED'}
          {r.match_confidence === 'forte' ? (regra ? ' · confira o aviso da regra' : ' · vencimento diferente') : ''}
          {r.match_confidence === 'provavel' ? ' · mais de um candidato com esse valor' : ''}
        </p>
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
            <p className="text-blue-700"><i className="ri-magic-line mr-1" />Importa a nota como {tipoDaNota(d)}</p>
          )}
          {regra ? (
            <p className="text-violet-700"><i className="ri-flashlight-line mr-1" />Lança {d.tipo === 'compra' ? 'compra' : 'despesa ' + String(d.categoria ?? '')} já paga{comp ? ' · competência ' + comp.slice(5, 7) + '/' + comp.slice(0, 4) : ''}</p>
          ) : (
            <p className="text-zinc-600">Baixa a parcela</p>
          )}
          {j > 0 && <p className="text-amber-700">Lança juros/multa de {formatCurrency(j)}</p>}
          {desc > 0 && d.boleto === true && <p className="text-amber-700">Registra desconto de {formatCurrency(desc)}</p>}
        </td>
      </tr>
    );
  };

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
          <p className="text-xs text-zinc-500 pb-2">
            Só a <b className="text-emerald-700">ligação direta</b> vem marcada. O resto aparece desmarcado: confira e marque o que estiver certo.
          </p>
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
                {blocos.map(g => (
                  <Fragment key={g.conf}>
                    <tr className="bg-zinc-50">
                      <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" title={`Marcar os ${g.itens.length} deste grupo`}
                          checked={g.itens.every(r => sel.has(r.id))}
                          onChange={() => setSel(prev => {
                            const n = new Set(prev);
                            const todosDoGrupo = g.itens.every(r => n.has(r.id));
                            g.itens.forEach(r => { if (todosDoGrupo) n.delete(r.id); else n.add(r.id); });
                            return n;
                          })} />
                      </td>
                      <td colSpan={5} className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${g.cor}`}>{g.titulo}</span>
                        <span className="ml-2 text-[11px] text-zinc-500">{g.itens.length} pagamento{g.itens.length > 1 ? 's' : ''} · {g.desc}</span>
                      </td>
                    </tr>
                    {g.itens.map(Linha)}
                  </Fragment>
                ))}
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
