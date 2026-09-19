import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import CategoriaCombobox from '../CategoriaCombobox';
import { useCategoriasLancamento } from './LancarDoExtrato';
import type { ReconciliationRule } from '@/hooks/useConciliacao';

// Regras de LANÇAMENTO (2026-09-18): por CNPJ/CPF/chave Pix, a saída vira despesa/compra já paga,
// com a competência da regra. Aqui: ver/editar a regra e lançar os pagamentos antigos que ela pega
// (edge conciliacao-pagamentos › launch_rule_preview / launch_rule_apply / launch_rule_save).

interface Candidato {
  statement_id: string; transaction_date: string; amount: number; counterpart_name: string | null;
  competencia: string; conflito: string | null; fora_padrao: boolean; media: number | null; bloqueio: string | null;
}

const dataBR = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const mesBR = (ym: string) => ym.slice(5, 7) + '/' + ym.slice(0, 4);
const fmtDoc = (d?: string | null) => {
  const x = String(d ?? '');
  if (/^\d{14}$/.test(x)) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (/^\d{11}$/.test(x)) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return x;
};

function Regra({ rule, onDelete, onChanged }: { rule: ReconciliationRule; onDelete: (id: string) => Promise<boolean>; onChanged?: () => void }) {
  const { user } = useAuth();
  const { dreOptions, mercOptions, dreNome } = useCategoriasLancamento();
  const [editando, setEditando] = useState(false);
  const [cat, setCat] = useState(rule.dre_category_id ?? '');
  const [merc, setMerc] = useState(rule.merchandise_category_id ?? '');
  const [comp, setComp] = useState<'same' | 'prev'>(rule.competence_rule === 'prev' ? 'prev' : 'same');
  const [cands, setCands] = useState<Candidato[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [compDe, setCompDe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const compra = rule.launch_kind === 'compra';

  const carregar = async () => {
    if (!user?.tenantId) return;
    setBusy(true); setMsg(null);
    const r = await invokeWithAuth<{ candidates?: Candidato[]; error?: string }>('conciliacao-pagamentos', {
      body: { action: 'launch_rule_preview', tenant_id: user.tenantId, rule_id: rule.id },
    });
    setBusy(false);
    const e = r.data?.error ?? r.error?.message;
    if (e) { setMsg('Não foi possível: ' + e); return; }
    const lista = (r.data?.candidates ?? []).map((c) => ({ ...c, amount: Number(c.amount), competencia: String(c.competencia).slice(0, 7) }));
    setCands(lista);
    // Marcados de saída: os sem trava e sem aviso
    setSel(new Set(lista.filter((c) => !c.bloqueio && !c.conflito && !c.fora_padrao).map((c) => c.statement_id)));
    setCompDe(Object.fromEntries(lista.map((c) => [c.statement_id, c.competencia])));
  };

  const aplicar = async () => {
    if (!user?.tenantId || !cands) return;
    const itens = cands.filter((c) => sel.has(c.statement_id) && !c.bloqueio).map((c) => ({ id: c.statement_id, competencia: compDe[c.statement_id] }));
    if (itens.length === 0) return;
    const total = cands.filter((c) => sel.has(c.statement_id)).reduce((s, c) => s + c.amount, 0);
    if (!window.confirm(`Lançar ${itens.length} pagamento(s), ${formatCurrency(total)}, como ${compra ? 'compra' : 'despesa ' + (dreNome(rule.dre_category_id ?? '') ?? '')} já paga? Dá para desfazer em cada pagamento.`)) return;
    setBusy(true); setMsg(null);
    const r = await invokeWithAuth<{ results?: Array<{ ok: boolean; msg: string }>; error?: string }>('conciliacao-pagamentos', {
      body: { action: 'launch_rule_apply', tenant_id: user.tenantId, rule_id: rule.id, items: itens },
    });
    setBusy(false);
    const e = r.data?.error ?? r.error?.message;
    if (e) { setMsg('Não foi possível: ' + e); return; }
    const res = r.data?.results ?? [];
    const falhas = res.filter((x) => !x.ok);
    setMsg(`${res.length - falhas.length} lançado(s)` + (falhas.length ? ` · ${falhas.length} com problema: ${falhas[0].msg}` : ''));
    onChanged?.();
    await carregar();
  };

  const salvar = async () => {
    if (!user?.tenantId) return;
    if (!compra && !cat) { setMsg('Escolha a categoria'); return; }
    setBusy(true); setMsg(null);
    const r = await invokeWithAuth<{ error?: string }>('conciliacao-pagamentos', {
      body: {
        action: 'launch_rule_save', tenant_id: user.tenantId, counterpart_doc: rule.counterpart_doc, counterpart_label: rule.counterpart_label,
        kind: rule.launch_kind, dre_category_id: compra ? null : cat, merchandise_category_id: compra ? merc || null : null,
        competence_rule: comp, supplier_name: rule.supplier_name, cost_center_id: rule.cost_center_id ?? null,
      },
    });
    setBusy(false);
    const e = r.data?.error ?? r.error?.message;
    if (e) { setMsg('Não foi possível: ' + e); return; }
    setEditando(false);
    onChanged?.();
    if (cands) await carregar();
  };

  const categoria = compra ? 'Compra (CMV)' : dreNome(rule.dre_category_id ?? '') ?? 'Despesa';
  return (
    <div className="p-3 rounded-xl border border-violet-200 bg-violet-50/40 space-y-2">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-violet-100 flex-shrink-0">
          <i className="ri-flashlight-line text-violet-600 text-sm" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-800 truncate">{rule.counterpart_label || rule.supplier_name || fmtDoc(rule.counterpart_doc)}</p>
          <p className="text-xs text-zinc-500">
            {fmtDoc(rule.counterpart_doc)} · vira <b className="text-violet-700">{categoria}</b> · competência {rule.competence_rule === 'prev' ? 'do mês anterior' : 'do mês do pagamento'}
            <span className="text-zinc-400"> · {rule.match_count} uso{rule.match_count !== 1 ? 's' : ''}</span>
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setEditando((v) => !v)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-violet-100 cursor-pointer" title="Editar">
            <i className="ri-pencil-line text-violet-600 text-sm" />
          </button>
          <button onClick={() => { if (window.confirm('Excluir a regra? O que já foi lançado continua lançado.')) onDelete(rule.id); }}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 cursor-pointer" title="Excluir">
            <i className="ri-delete-bin-line text-red-400 text-sm" />
          </button>
        </div>
      </div>

      {editando && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white border border-violet-100 rounded-lg p-2.5">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">{compra ? 'Categoria do CMV' : 'Categoria da DRE'}</label>
            {compra
              ? <CategoriaCombobox value={merc} options={mercOptions} onChange={setMerc} placeholder="Escolha…" buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />
              : <CategoriaCombobox value={cat} options={dreOptions} onChange={setCat} placeholder="Escolha…" buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Competência</label>
            <select value={comp} onChange={(e) => setComp(e.target.value as 'same' | 'prev')} className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white">
              <option value="same">Mês do pagamento</option>
              <option value="prev">Mês anterior ao pagamento</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <button onClick={salvar} disabled={busy} className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-700 disabled:opacity-50 cursor-pointer">
              {busy ? 'Salvando…' : 'Salvar regra'}
            </button>
          </div>
        </div>
      )}

      {cands === null ? (
        <button onClick={carregar} disabled={busy} className="text-xs font-semibold text-violet-700 hover:text-violet-900 cursor-pointer disabled:opacity-50">
          {busy ? 'Buscando…' : 'Ver pagamentos pendentes que esta regra pega (inclusive antigos)'}
        </button>
      ) : cands.length === 0 ? (
        <p className="text-xs text-zinc-500">Nenhum pagamento pendente para esta regra.</p>
      ) : (
        <div className="bg-white border border-violet-100 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50">
              <tr>
                <th className="w-8 px-2 py-1.5" />
                <th className="text-left px-2 py-1.5 font-semibold text-zinc-500">Pago em</th>
                <th className="text-right px-2 py-1.5 font-semibold text-zinc-500">Valor</th>
                <th className="text-left px-2 py-1.5 font-semibold text-zinc-500">Competência</th>
                <th className="text-left px-2 py-1.5 font-semibold text-zinc-500">Aviso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {cands.map((c) => (
                <tr key={c.statement_id} className={c.bloqueio ? 'opacity-60' : ''}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" disabled={!!c.bloqueio} checked={sel.has(c.statement_id)}
                      onChange={() => setSel((p) => { const n = new Set(p); if (n.has(c.statement_id)) n.delete(c.statement_id); else n.add(c.statement_id); return n; })} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{dataBR(c.transaction_date)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-red-600 whitespace-nowrap">{formatCurrency(c.amount)}</td>
                  <td className="px-2 py-1.5">
                    <input type="month" value={compDe[c.statement_id] ?? c.competencia} disabled={!!c.bloqueio}
                      onChange={(e) => setCompDe((p) => ({ ...p, [c.statement_id]: e.target.value }))}
                      className="px-1.5 py-0.5 border border-zinc-200 rounded text-xs bg-white" title={mesBR(c.competencia)} />
                  </td>
                  <td className="px-2 py-1.5 text-amber-700">
                    {c.bloqueio ?? c.conflito ?? (c.fora_padrao ? `Valor fora do padrão (média ${formatCurrency(Number(c.media ?? 0))})` : '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2 px-2 py-2 border-t border-zinc-100">
            <button onClick={aplicar} disabled={busy || sel.size === 0}
              className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-700 disabled:opacity-50 cursor-pointer">
              {busy ? 'Lançando…' : `Lançar ${sel.size} selecionado(s)`}
            </button>
            <span className="text-[11px] text-zinc-400">Os com aviso vêm desmarcados: confira a competência antes.</span>
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-zinc-700">{msg}</p>}
    </div>
  );
}

export default function RegrasLancamentoLista({ rules, onDelete, onChanged }: { rules: ReconciliationRule[]; onDelete: (id: string) => Promise<boolean>; onChanged?: () => void }) {
  if (rules.length === 0) return null;
  return (
    <div className="space-y-2 mb-4">
      <p className="text-xs font-semibold text-zinc-600">
        Regras de lançamento <span className="font-normal text-zinc-400">— o pagamento vira despesa/compra na DRE. Crie pelo "Lançar" de um pagamento, marcando "Fazer sempre assim".</span>
      </p>
      {rules.map((r) => <Regra key={r.id} rule={r} onDelete={onDelete} onChanged={onChanged} />)}
    </div>
  );
}
