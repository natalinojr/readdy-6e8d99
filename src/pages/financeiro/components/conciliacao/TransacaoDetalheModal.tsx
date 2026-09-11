import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCostCenters } from '@/hooks/useFinanceiro';
import { formatCurrency } from '@/lib/formatters';
import { invokeWithAuth } from '@/lib/supabase';
import type { StatementImport, BillMatch, ReceivableMatch, ReconciliationRule } from '@/hooks/useConciliacao';

const fmtDoc = (d: string) =>
  d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
      : d;

interface GroupRow {
  id: string;
  source: string;
  transaction_date: string;
  amount: number;
  transaction_type: string;
  description: string;
  match_kind: string | null;
  stone_installment_info: Record<string, unknown> | null;
}

interface Props {
  transaction: StatementImport | null;
  rules: ReconciliationRule[];
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<StatementImport>) => Promise<boolean>;
  onReconcile: (id: string) => Promise<boolean>;
  onUnreconcile: (id: string) => Promise<boolean>;
  onCreateRule: (pattern: string, category: string, costCenterId: string, txType: 'credit' | 'debit') => Promise<ReconciliationRule | null>;
  findBillMatches: (amount: number, date: string) => Promise<BillMatch[]>;
  findReceivableMatches: (amount: number, date: string) => Promise<ReceivableMatch[]>;
  /** Chamado depois de confirmar/desfazer uma baixa (recarregar lista e alertas) */
  onChanged?: () => void;
}

export default function TransacaoDetalheModal({
  transaction,
  rules,
  onClose,
  onUpdate,
  onReconcile,
  onUnreconcile,
  onCreateRule,
  findBillMatches,
  findReceivableMatches,
  onChanged,
}: Props) {
  const { user } = useAuth();
  const { centers } = useCostCenters();
  const [saving, setSaving] = useState(false);
  const [billMatches, setBillMatches] = useState<BillMatch[]>([]);
  const [receivableMatches, setReceivableMatches] = useState<ReceivableMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({ pattern: '', category: '', costCenterId: '' });

  const [form, setForm] = useState({
    description: '',
    category: '',
    cost_center_id: '',
    notes: '',
  });

  useEffect(() => {
    if (transaction) {
      setForm({
        description: transaction.description || '',
        category: transaction.category || '',
        cost_center_id: transaction.cost_center_id || '',
        notes: transaction.notes || '',
      });
      setRuleForm({
        pattern: transaction.description?.split(' ')[0] ?? '',
        category: transaction.category || '',
        costCenterId: transaction.cost_center_id || '',
      });
      loadMatches();
    }
  }, [transaction]);

  // Vínculo pagamento × nota/conta: confirmar ou desfazer a baixa; lembrar CPF/chave Pix
  const [vinculoBusy, setVinculoBusy] = useState(false);
  const [vinculoMsg, setVinculoMsg] = useState<string | null>(null);
  const [lembrarContraparte, setLembrarContraparte] = useState(false);
  useEffect(() => { setVinculoMsg(null); setLembrarContraparte(false); }, [transaction?.id]);
  const vinculoAction = async (kind: 'confirm' | 'undo') => {
    if (!transaction) return;
    setVinculoBusy(true);
    setVinculoMsg(null);
    const body = kind === 'confirm'
      ? { action: 'confirm', tenant_id: user?.tenantId, ids: [transaction.id] }
      : { action: 'undo', tenant_id: user?.tenantId, id: transaction.id };
    const r = await invokeWithAuth<{ success?: boolean; error?: string; message?: string; results?: Array<{ ok: boolean; msg: string }> }>('conciliacao-pagamentos', { body });
    setVinculoBusy(false);
    const res = r.data?.results?.[0];
    const err = r.data?.error ?? r.error?.message ?? (res && !res.ok ? res.msg : null);
    if (err) { setVinculoMsg('Não foi possível: ' + err); return; }
    if (kind === 'undo' && r.data?.message) window.alert(r.data.message);
    onChanged?.();
    onClose();
  };

  // Stone × Inter: vendas que compõem este repasse (ou o depósito de uma venda)
  const [groupRows, setGroupRows] = useState<GroupRow[]>([]);
  useEffect(() => {
    setGroupRows([]);
    const g = transaction?.match_group;
    if (!g || !g.startsWith('stone:')) return;
    let alive = true;
    invokeWithAuth<{ success?: boolean; rows?: GroupRow[] }>('stone-conciliation', { body: { action: 'group_detail', tenant_id: user?.tenantId, match_group: g } })
      .then((r) => { if (alive) setGroupRows(r.data?.rows ?? []); });
    return () => { alive = false; };
  }, [transaction?.match_group, user?.tenantId]);

  const loadMatches = useCallback(async () => {
    if (!transaction) return;
    setLoadingMatches(true);
    const [bills, receivables] = await Promise.all([
      transaction.transaction_type === 'debit' ? findBillMatches(Number(transaction.amount), transaction.transaction_date) : Promise.resolve([]),
      transaction.transaction_type === 'credit' ? findReceivableMatches(Number(transaction.amount), transaction.transaction_date) : Promise.resolve([]),
    ]);
    setBillMatches(bills);
    setReceivableMatches(receivables);
    setLoadingMatches(false);
  }, [transaction, findBillMatches, findReceivableMatches]);

  if (!transaction) return null;

  const handleSave = async () => {
    setSaving(true);
    if (lembrarContraparte && transaction.counterpart_doc && form.category) {
      await invokeWithAuth('conciliacao-pagamentos', { body: { action: 'save_counterpart_rule', tenant_id: user?.tenantId, counterpart_doc: transaction.counterpart_doc, counterpart_label: transaction.counterpart_name ?? transaction.description, category: form.category, cost_center_id: form.cost_center_id || null, transaction_type: transaction.transaction_type } });
    }
    await onUpdate(transaction.id, {
      description: form.description,
      category: form.category || null,
      cost_center_id: form.cost_center_id || null,
      notes: form.notes || null,
    });
    setSaving(false);
  };

  const handleCreateRule = async () => {
    if (!ruleForm.pattern.trim()) return;
    setSaving(true);
    await onCreateRule(ruleForm.pattern, ruleForm.category, ruleForm.costCenterId, transaction.transaction_type);
    setShowCreateRule(false);
    setSaving(false);
  };

  const dreCategories = [
    'Receita', 'CMV', 'Folha de Pagamento', 'Aluguel', 'Energia',
    'Água', 'Internet/Telefone', 'Marketing', 'Manutenção', 'Impostos',
    'Taxas Bancárias', 'Transporte', 'Material de Escritório', 'Outros',
  ];

  const matchedRule = rules.find(r => {
    const desc = transaction.description?.toLowerCase() ?? '';
    const pattern = r.pattern.toLowerCase();
    if (r.transaction_type !== 'both' && r.transaction_type !== transaction.transaction_type) return false;
    switch (r.match_type) {
      case 'contains': return desc.includes(pattern);
      case 'starts_with': return desc.startsWith(pattern);
      case 'ends_with': return desc.endsWith(pattern);
      case 'exact': return desc === pattern;
      case 'regex':
        try { return new RegExp(pattern, 'i').test(transaction.description ?? ''); } catch { return false; }
    }
    return false;
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-xl ${
              transaction.transaction_type === 'credit' ? 'bg-green-100' : 'bg-red-100'
            }`}>
              <i className={`${transaction.transaction_type === 'credit' ? 'ri-arrow-down-circle-line text-green-600' : 'ri-arrow-up-circle-line text-red-600'} text-lg`} />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900 text-base">Detalhe da Transação</h3>
              <p className="text-xs text-zinc-500">
                {new Date(transaction.transaction_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                {transaction.external_id && ` · ID: ${transaction.external_id}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Valor */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-50 border border-zinc-200">
            <span className="text-sm text-zinc-500">Valor</span>
            <span className={`text-2xl font-bold ${transaction.transaction_type === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
              {transaction.transaction_type === 'debit' ? '-' : '+'}{formatCurrency(Number(transaction.amount))}
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
              transaction.reconciled ? 'bg-green-100 text-green-700' :
              transaction.status === 'matched' ? 'bg-blue-100 text-blue-700' :
              transaction.status === 'ignored' ? 'bg-zinc-100 text-zinc-500' :
              'bg-amber-100 text-amber-700'
            }`}>
              <i className={`${transaction.reconciled ? 'ri-checkbox-circle-fill' : transaction.status === 'matched' ? 'ri-link' : 'ri-time-line'} text-xs`} />
              {transaction.reconciled ? 'Reconciliado' : transaction.status === 'matched' ? 'Conciliado' : transaction.status === 'ignored' ? 'Ignorado' : 'Pendente'}
            </span>
            {matchedRule && (
              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                <i className="ri-filter-3-line mr-1" />
                Regra: {matchedRule.pattern}
              </span>
            )}
          </div>

          {(transaction.match_kind === 'payable' || transaction.match_kind === 'inbound_doc') && transaction.match_detail && (() => {
            const d = transaction.match_detail as Record<string, unknown>;
            const conf = d.confirmed as Record<string, unknown> | undefined;
            const confLabel: Record<string, string> = { exato: 'Exato', forte: 'Forte', provavel: 'Provável' };
            const desconto = Number(d.desconto ?? 0);
            return (
              <div className={'border rounded-xl p-3 text-xs space-y-2 ' + (conf ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-800"><i className="ri-links-line mr-1" />{conf ? 'Pagamento conciliado' : 'Vínculo sugerido'}</span>
                  <span className="px-2 py-0.5 rounded-full bg-white border border-zinc-200 text-zinc-600">{confLabel[String(transaction.match_confidence)] ?? String(transaction.match_confidence ?? '')}</span>
                </div>
                <p className="text-zinc-700">
                  {String(d.label ?? '')}
                  {d.parcela ? ' · parcela ' + String(d.parcela) : ''}
                  {d.vencimento ? ' · vence ' + new Date(String(d.vencimento) + 'T00:00:00').toLocaleDateString('pt-BR') : ''}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div><p className="text-zinc-400">Parcela</p><p className="font-semibold text-zinc-800">{formatCurrency(Number(d.valor ?? 0))}</p></div>
                  <div><p className="text-zinc-400">Pago no banco</p><p className="font-semibold text-zinc-800">{formatCurrency(Number(transaction.amount))}</p></div>
                  <div><p className="text-zinc-400">{desconto > 0 ? 'Desconto' : 'Juros/multa'}</p><p className="font-semibold text-red-600">{formatCurrency(desconto > 0 ? desconto : Number(d.juros ?? 0))}</p></div>
                </div>
                {!conf && d.auto_import === true && (
                  <p className="text-blue-700"><i className="ri-magic-line mr-1" />Esta nota ainda não foi lançada. Ao confirmar, ela é importada automaticamente como {Number(d.modelo) === 10 ? 'despesa (serviço)' : 'compra'} e a parcela recebe a baixa.</p>
                )}
                {conf?.auto_imported === true && (
                  <p className="text-emerald-700"><i className="ri-magic-line mr-1" />Nota importada automaticamente pela conciliação. Os itens não foram ligados ao estoque: confira em Notas de Entrada se precisar.</p>
                )}
                {vinculoMsg && <p className="text-red-600">{vinculoMsg}</p>}
                <div className="flex gap-2">
                  {!conf ? (
                    <button onClick={() => vinculoAction('confirm')} disabled={vinculoBusy} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
                      {vinculoBusy ? 'Confirmando...' : 'Confirmar e dar baixa'}
                    </button>
                  ) : (
                    <button onClick={() => vinculoAction('undo')} disabled={vinculoBusy} className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg font-semibold hover:bg-amber-50 disabled:opacity-50 cursor-pointer">
                      {vinculoBusy ? 'Desfazendo...' : 'Desfazer baixa'}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
          {transaction.match_kind === 'internal_transfer' && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-xs text-sky-800">
              <i className="ri-arrow-left-right-line mr-1" />
              Transferência entre contas da própria empresa. Não entra como receita nem como despesa.
            </div>
          )}
          {groupRows.length > 0 && (() => {
            const num = (v: unknown) => Number(v ?? 0);
            const vendas = groupRows.filter(r => r.source === 'stone');
            const deps = groupRows.filter(r => r.source !== 'stone');
            const bruto = vendas.reduce((s, r) => s + num(r.stone_installment_info?.gross_amount ?? r.amount), 0);
            const taxa = vendas.reduce((s, r) => s + num(r.stone_installment_info?.fee_amount), 0);
            const liq = vendas.reduce((s, r) => s + num(r.amount), 0);
            const dep = deps.reduce((s, r) => s + num(r.amount), 0);
            return (
              <div className="border border-green-200 rounded-xl overflow-hidden">
                <div className="bg-green-50 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-green-800"><i className="ri-links-line mr-1" />Repasse Stone × Banco Inter</span>
                  <span className="text-green-700 whitespace-nowrap">{vendas.length} venda(s) · no Inter {formatCurrency(dep)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 px-3 py-2 text-xs border-b border-green-100">
                  <div><p className="text-zinc-400">Bruto</p><p className="font-semibold text-zinc-800">{formatCurrency(bruto)}</p></div>
                  <div><p className="text-zinc-400">Taxas</p><p className="font-semibold text-red-600">{formatCurrency(taxa)}</p></div>
                  <div><p className="text-zinc-400">Líquido Stone</p><p className="font-semibold text-zinc-800">{formatCurrency(liq)}</p></div>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-zinc-100">
                  {vendas.map(r => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="text-zinc-600 truncate mr-2">{r.description}</span>
                      <span className="text-zinc-800 whitespace-nowrap">
                        {formatCurrency(num(r.stone_installment_info?.gross_amount ?? r.amount))}
                        <span className="text-zinc-400"> → {formatCurrency(num(r.amount))}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Form */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-zinc-600 mb-1 block">Descrição</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-zinc-600 mb-1 block">Categoria DRE</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">Sem categoria</option>
                  {dreCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 mb-1 block">Centro de Custo</label>
                <select
                  value={form.cost_center_id}
                  onChange={e => setForm(f => ({ ...f, cost_center_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">Nenhum</option>
                  {centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 mb-1 block">Observações internas</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white resize-none"
              />
            </div>
          </div>

          {/* Create rule from this */}
          {!showCreateRule ? (
            <button
              onClick={() => setShowCreateRule(true)}
              className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium cursor-pointer transition-colors"
            >
              <i className="ri-filter-3-line" />
              Criar regra de classificação a partir desta transação
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
              <p className="text-xs font-semibold text-amber-700">Criar regra automática</p>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={ruleForm.pattern}
                  onChange={e => setRuleForm(f => ({ ...f, pattern: e.target.value }))}
                  placeholder="Padrão"
                  className="px-2 py-1.5 border border-amber-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
                <select
                  value={ruleForm.category}
                  onChange={e => setRuleForm(f => ({ ...f, category: e.target.value }))}
                  className="px-2 py-1.5 border border-amber-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">Categoria</option>
                  {dreCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={ruleForm.costCenterId}
                  onChange={e => setRuleForm(f => ({ ...f, costCenterId: e.target.value }))}
                  className="px-2 py-1.5 border border-amber-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">Centro de Custo</option>
                  {centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateRule}
                  disabled={saving || !ruleForm.pattern.trim()}
                  className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
                >
                  {saving ? 'Salvando...' : 'Criar Regra'}
                </button>
                <button
                  onClick={() => setShowCreateRule(false)}
                  className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer whitespace-nowrap transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {transaction.counterpart_doc && transaction.match_kind !== 'internal_transfer' && (
            <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer bg-zinc-50 border border-zinc-200 rounded-lg p-2.5">
              <input type="checkbox" checked={lembrarContraparte} onChange={e => setLembrarContraparte(e.target.checked)} className="mt-0.5" />
              <span>
                Lembrar a categoria escolhida para {transaction.counterpart_doc.length === 11 ? 'o CPF' : transaction.counterpart_doc.length === 14 ? 'o CNPJ' : 'a chave Pix'} {fmtDoc(transaction.counterpart_doc)}
                {transaction.counterpart_name ? ' (' + transaction.counterpart_name + ')' : ''}. Os próximos lançamentos dessa pessoa entram classificados.
              </span>
            </label>
          )}

          {/* Matches */}
          {transaction.transaction_type === 'debit' && (
            <div>
              <p className="text-xs font-semibold text-zinc-600 mb-2 flex items-center gap-1">
                <i className="ri-bill-line" /> Contas a Pagar Relacionadas
              </p>
              {loadingMatches ? (
                <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                  <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  Buscando...
                </div>
              ) : billMatches.length === 0 ? (
                <p className="text-xs text-zinc-400 py-2">Nenhuma conta a pagar encontrada com valor próximo</p>
              ) : (
                <div className="space-y-1.5">
                  {billMatches.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-200 hover:border-amber-300 bg-white cursor-pointer transition-colors">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-800 truncate">{m.description}</p>
                        <p className="text-xs text-zinc-400">{m.supplier} · Vence {new Date(m.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${m.confidence === 'high' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {m.confidence === 'high' ? 'Alta' : 'Média'}
                        </span>
                        <span className="text-xs font-bold text-zinc-800">{formatCurrency(m.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {transaction.transaction_type === 'credit' && (
            <div>
              <p className="text-xs font-semibold text-zinc-600 mb-2 flex items-center gap-1">
                <i className="ri-money-dollar-circle-line" /> Recebíveis Relacionados
              </p>
              {loadingMatches ? (
                <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                  <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  Buscando...
                </div>
              ) : receivableMatches.length === 0 ? (
                <p className="text-xs text-zinc-400 py-2">Nenhum recebível encontrado com valor próximo</p>
              ) : (
                <div className="space-y-1.5">
                  {receivableMatches.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-200 hover:border-amber-300 bg-white cursor-pointer transition-colors">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-800">Pedido {m.order_number ?? m.id.slice(0, 8)}</p>
                        {m.due_date && <p className="text-xs text-zinc-400">Vence {new Date(m.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${m.confidence === 'high' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {m.confidence === 'high' ? 'Alta' : 'Média'}
                        </span>
                        <span className="text-xs font-bold text-zinc-800">{formatCurrency(m.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 flex-shrink-0 bg-zinc-50">
          <div className="flex items-center gap-2">
            {transaction.reconciled ? (
              <button
                onClick={async () => { await onUnreconcile(transaction.id); onClose(); }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-refresh-line" /> Desfazer Reconciliação
              </button>
            ) : (
              <button
                onClick={async () => { await onReconcile(transaction.id); onClose(); }}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-semibold hover:bg-green-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-checkbox-circle-line" /> Reconciliar
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
            >
              {saving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <i className="ri-save-line" />}
              Salvar Alterações
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}