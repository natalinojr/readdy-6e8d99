import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useBankAccounts } from '@/hooks/useFinanceiro';
import { useConciliacao } from '@/hooks/useConciliacao';
import { parseOFX, parseCSV, findMatches } from '@/utils/ofxParser';
import { formatCurrency } from '@/lib/formatters';
import RegrasConciliacaoModal from './conciliacao/RegrasConciliacaoModal';
import TransacaoDetalheModal from './conciliacao/TransacaoDetalheModal';
import ReconciliacaoSaldoModal from './conciliacao/ReconciliacaoSaldoModal';
import StoneConfigModal from './conciliacao/StoneConfigModal';
import StoneImportPanel from './conciliacao/StoneImportPanel';
import type { OFXTransaction, MatchCandidate } from '@/utils/ofxParser';
import type { StatementImport, ReconciliationRule } from '@/hooks/useConciliacao';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImportRow extends OFXTransaction {
  matchStatus: 'matched' | 'pending' | 'ignored';
  bestMatch: MatchCandidate | null;
  allMatches: MatchCandidate[];
  isDuplicate: boolean;
  appliedRule?: ReconciliationRule;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtCur(v: number) {
  return `R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

const PAGE_SIZE = 25;

// ── Sub-components ──────────────────────────────────────────────────────────

function MatchBadge({ status, count }: { status: ImportRow['matchStatus']; count: number }) {
  if (status === 'matched') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        <i className="ri-checkbox-circle-fill text-xs" /> Match
      </span>
    );
  }
  if (status === 'ignored') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-500">
        <i className="ri-eye-off-line text-xs" /> Ignorado
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-600'}`}>
      <i className={`${count > 0 ? 'ri-link-unlink' : 'ri-question-line'} text-xs`} />
      {count > 0 ? `${count} sugest.` : 'Sem match'}
    </span>
  );
}

// ── Import Preview Modal ────────────────────────────────────────────────────

interface ImportPreviewProps {
  rows: ImportRow[];
  bankAccountId: string;
  onClose: () => void;
  onConfirm: (rows: ImportRow[]) => Promise<void>;
  saving: boolean;
}

function ImportPreviewModal({ rows, onClose, onConfirm, saving }: ImportPreviewProps) {
  const [localRows, setLocalRows] = useState<ImportRow[]>(rows);
  const [activeTab, setActiveTab] = useState<'all' | 'matched' | 'pending' | 'ignored' | 'duplicate'>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const matched = localRows.filter(r => r.matchStatus === 'matched' && !r.isDuplicate);
  const pending = localRows.filter(r => r.matchStatus === 'pending' && !r.isDuplicate);
  const ignored = localRows.filter(r => r.matchStatus === 'ignored');
  const duplicates = localRows.filter(r => r.isDuplicate);

  const toImport = localRows.filter(r => !r.isDuplicate && r.matchStatus !== 'ignored');

  const filtered = useMemo(() => {
    switch (activeTab) {
      case 'matched': return matched;
      case 'pending': return pending;
      case 'ignored': return ignored;
      case 'duplicate': return duplicates;
      default: return localRows;
    }
  }, [activeTab, localRows, matched, pending, ignored, duplicates]);

  const toggleIgnore = (id: string) => {
    setLocalRows(prev => prev.map(r =>
      r.id === id
        ? { ...r, matchStatus: r.matchStatus === 'ignored' ? (r.bestMatch ? 'matched' : 'pending') : 'ignored' }
        : r
    ));
  };

  const selectMatch = (rowId: string, match: MatchCandidate) => {
    setLocalRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, bestMatch: match, matchStatus: 'matched' } : r
    ));
    setExpandedRow(null);
  };

  const clearMatch = (rowId: string) => {
    setLocalRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, bestMatch: null, matchStatus: 'pending' } : r
    ));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-zinc-900">Prévia do Extrato Importado</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {localRows.length} lançamentos · {matched.length} com match · {pending.length} para revisar · {duplicates.length} duplicados
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-5 gap-3 px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          {[
            { label: 'Total', count: localRows.length, color: 'bg-zinc-100 text-zinc-700', icon: 'ri-list-check' },
            { label: 'Match automático', count: matched.length, color: 'bg-green-100 text-green-700', icon: 'ri-checkbox-circle-line' },
            { label: 'Para revisar', count: pending.length, color: 'bg-amber-100 text-amber-700', icon: 'ri-time-line' },
            { label: 'Ignorados', count: ignored.length, color: 'bg-zinc-100 text-zinc-600', icon: 'ri-eye-off-line' },
            { label: 'Duplicados', count: duplicates.length, color: 'bg-red-100 text-red-600', icon: 'ri-file-copy-line' },
          ].map(card => (
            <div key={card.label} className={`rounded-xl p-3 flex items-center gap-2 ${card.color}`}>
              <i className={`${card.icon} text-lg flex-shrink-0`} />
              <div>
                <p className="text-xs font-medium opacity-80">{card.label}</p>
                <p className="text-lg font-bold">{card.count}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-100 px-6 flex-shrink-0">
          {([
            { key: 'all', label: `Todos (${localRows.length})` },
            { key: 'matched', label: `Match (${matched.length})` },
            { key: 'pending', label: `Revisar (${pending.length})` },
            { key: 'ignored', label: `Ignorados (${ignored.length})` },
            { key: 'duplicate', label: `Duplicados (${duplicates.length})` },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-xs font-semibold cursor-pointer border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-amber-500 text-amber-700'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Data</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Descrição</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Tipo</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Valor</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Regra</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {filtered.map(row => (
                <>
                  <tr
                    key={row.id}
                    className={`transition-colors ${
                      row.isDuplicate ? 'bg-red-50/50 opacity-60' :
                      row.matchStatus === 'matched' ? 'bg-green-50/40' :
                      row.matchStatus === 'ignored' ? 'bg-zinc-50/60 opacity-60' :
                      row.allMatches.length > 0 ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-zinc-700 font-medium whitespace-nowrap text-xs">
                      {new Date(row.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="text-xs font-medium text-zinc-800 truncate">{row.description}</p>
                      {row.isDuplicate && (
                        <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                          <i className="ri-file-copy-line" /> Já importado
                        </p>
                      )}
                      {row.appliedRule && (
                        <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                          <i className="ri-filter-3-line" /> Regra: {row.appliedRule.pattern}
                          {row.appliedRule.category && ` → ${row.appliedRule.category}`}
                        </p>
                      )}
                      {row.matchStatus === 'matched' && row.bestMatch && (
                        <p className="text-xs text-green-600 mt-0.5 truncate flex items-center gap-1">
                          <i className="ri-link" />
                          {row.bestMatch.description}
                          <span className={`ml-1 px-1 rounded text-xs ${row.bestMatch.confidence === 'high' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {row.bestMatch.confidence === 'high' ? 'Alta' : 'Média'}
                          </span>
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row.type === 'credit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {row.type === 'credit' ? 'Crédito' : 'Débito'}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-bold text-sm ${row.type === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
                      {row.type === 'debit' ? '-' : '+'}{fmtCur(row.amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.appliedRule ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                          <i className="ri-filter-3-line text-xs" /> {row.appliedRule.category || 'Auto'}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <MatchBadge status={row.matchStatus} count={row.allMatches.length} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {!row.isDuplicate && (
                        <div className="flex items-center justify-center gap-1">
                          {row.allMatches.length > 0 && row.matchStatus !== 'ignored' && (
                            <button
                              onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 cursor-pointer"
                              title="Ver sugestões"
                            >
                              <i className={expandedRow === row.id ? 'ri-arrow-up-s-line text-amber-600 text-sm' : 'ri-arrow-down-s-line text-amber-600 text-sm'} />
                            </button>
                          )}
                          {row.matchStatus === 'matched' && (
                            <button
                              onClick={() => clearMatch(row.id)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 cursor-pointer"
                              title="Remover match"
                            >
                              <i className="ri-link-unlink text-red-400 text-sm" />
                            </button>
                          )}
                          <button
                            onClick={() => toggleIgnore(row.id)}
                            className={`w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer ${row.matchStatus === 'ignored' ? 'hover:bg-green-50' : 'hover:bg-zinc-100'}`}
                            title={row.matchStatus === 'ignored' ? 'Incluir' : 'Ignorar'}
                          >
                            <i className={`${row.matchStatus === 'ignored' ? 'ri-eye-line text-green-500' : 'ri-eye-off-line text-zinc-400'} text-sm`} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {/* Expanded matches */}
                  {expandedRow === row.id && row.allMatches.length > 0 && (
                    <tr key={`${row.id}-matches`}>
                      <td colSpan={7} className="px-4 pb-3 bg-amber-50/50">
                        <div className="ml-4 space-y-1.5">
                          <p className="text-xs font-semibold text-amber-700 mb-2">Selecione a correspondência:</p>
                          {row.allMatches.map(match => (
                            <button
                              key={match.id}
                              onClick={() => selectMatch(row.id, match)}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border cursor-pointer transition-all text-left ${
                                row.bestMatch?.id === match.id
                                  ? 'border-green-400 bg-green-50'
                                  : 'border-zinc-200 bg-white hover:border-amber-300 hover:bg-amber-50'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className={`w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0 ${
                                  match.confidence === 'high' ? 'bg-green-100' : 'bg-amber-100'
                                }`}>
                                  <i className={`ri-${match.source === 'bank_transaction' ? 'bank' : 'exchange-dollar'}-line text-xs ${
                                    match.confidence === 'high' ? 'text-green-600' : 'text-amber-600'
                                  }`} />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-zinc-800 truncate">{match.description}</p>
                                  <p className="text-xs text-zinc-400">
                                    {new Date(match.date + 'T00:00:00').toLocaleDateString('pt-BR')} ·
                                    {match.source === 'bank_transaction' ? ' Transação bancária' : ' Fluxo de caixa'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                                  match.confidence === 'high' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {match.confidence === 'high' ? 'Alta' : 'Média'}
                                </span>
                                <span className="text-xs font-bold text-zinc-800">{fmtCur(match.amount)}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
              <i className="ri-inbox-line text-3xl mb-2" />
              <p className="text-sm">Nenhum lançamento nesta categoria</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 flex-shrink-0 bg-zinc-50">
          <div className="text-xs text-zinc-500">
            <span className="font-semibold text-zinc-700">{toImport.length}</span> lançamentos serão importados
            {duplicates.length > 0 && <span className="text-red-500 ml-2">· {duplicates.length} duplicados ignorados</span>}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-200 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(localRows)}
              disabled={saving || toImport.length === 0}
              className="flex items-center gap-2 px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <i className="ri-check-line" />
                  Confirmar {toImport.length} lançamentos
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function ConciliacaoTab() {
  const { user } = useAuth();
  const { accounts: bankAccounts } = useBankAccounts();
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Modals
  const [showRules, setShowRules] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<StatementImport | null>(null);
  const [showSaldoModal, setShowSaldoModal] = useState(false);
  const [showStoneConfig, setShowStoneConfig] = useState(false);
  const [activeImportTab, setActiveImportTab] = useState<'manual' | 'stone'>('manual');

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'matched' | 'ignored' | 'manual'>('all');
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(1);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Set default account
  useEffect(() => {
    if (bankAccounts.length > 0 && !selectedAccountId) {
      const def = bankAccounts.find(a => a.is_default) ?? bankAccounts[0];
      setSelectedAccountId(def.id);
    }
  }, [bankAccounts, selectedAccountId]);

  // Hook de conciliação
  const {
    imports,
    rules,
    loading,
    refresh,
    updateImport,
    reconcile,
    unreconcile,
    findBillMatches,
    findReceivableMatches,
    applyRules,
    createRule,
    updateRule,
    deleteRule,
    totalMatched,
    totalPending,
    totalReconciled,
    totalIgnored,
    saldoCreditos,
    saldoDebitos,
    saldoLiquido,
    pctConciliado,
  } = useConciliacao(selectedAccountId);

  // ── File import ─────────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.tenantId || !selectedAccountId) return;
    e.target.value = '';

    setParsing(true);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const content = ev.target?.result as string;
        const isOFX = file.name.toLowerCase().endsWith('.ofx') || content.includes('<OFX>') || content.includes('<STMTTRN>');

        const parsed: OFXTransaction[] = isOFX ? parseOFX(content) : parseCSV(content);

        if (parsed.length === 0) {
          showToast('Nenhum lançamento encontrado no arquivo. Verifique o formato.', 'error');
          setParsing(false);
          return;
        }

        // Buscar dados para auto-match
        const [{ data: bankTxs }, { data: cashFlows }] = await Promise.all([
          supabase
            .from('fin_bank_transactions')
            .select('id, transaction_date, amount, description, type')
            .eq('tenant_id', user.tenantId)
            .eq('bank_account_id', selectedAccountId)
            .order('transaction_date', { ascending: false })
            .limit(500),
          supabase
            .from('fin_cash_flow')
            .select('id, date, amount, description, type')
            .eq('tenant_id', user.tenantId)
            .order('date', { ascending: false })
            .limit(500),
        ]);

        // Buscar external_ids já importados via Edge Function (evita bloqueio RLS)
        const existingImportsResult = await invokeWithAuth<{ data: Array<{ external_id: string | null }> }>('financial-write', {
          body: {
            action: 'list_statement_imports_external_ids',
            tenant_id: user.tenantId,
            payload: { bank_account_id: selectedAccountId },
          },
        });
        const existingImports = existingImportsResult.data?.data ?? [];
        const existingIds = new Set((existingImports as Array<{ external_id: string | null }>).map(e => e.external_id).filter(Boolean));

        // Montar ImportRows com auto-match + regras
        const rows: ImportRow[] = parsed.map(tx => {
          const matches = findMatches(
            tx,
            (bankTxs ?? []).map(bt => ({ ...bt, amount: Number(bt.amount) })),
            (cashFlows ?? []).map(cf => ({ ...cf, amount: Number(cf.amount) })),
          );
          const bestMatch = matches[0] ?? null;
          const isDuplicate = tx.id ? existingIds.has(tx.id) : false;

          // Aplicar regras de classificação
          const appliedRule = applyRules(tx.description, tx.type);

          return {
            ...tx,
            matchStatus: isDuplicate ? 'ignored' : bestMatch?.confidence === 'high' ? 'matched' : 'pending',
            bestMatch: bestMatch?.confidence === 'high' ? bestMatch : null,
            allMatches: matches,
            isDuplicate,
            appliedRule: appliedRule ?? undefined,
          };
        });

        setImportRows(rows);
      } catch (err) {
        console.error('[ConciliacaoTab] Erro ao parsear arquivo:', err);
        showToast('Erro ao ler o arquivo. Verifique se é um OFX ou CSV válido.', 'error');
      } finally {
        setParsing(false);
      }
    };

    reader.readAsText(file, 'UTF-8');
  };

  // ── Confirm import ──────────────────────────────────────────────────────────
  const handleConfirmImport = async (rows: ImportRow[]) => {
    if (!user?.tenantId || !selectedAccountId) return;
    setSaving(true);

    const toInsert = rows
      .filter(r => !r.isDuplicate && r.matchStatus !== 'ignored')
      .map(r => ({
        tenant_id: user.tenantId,
        bank_account_id: selectedAccountId,
        external_id: r.id || null,
        transaction_date: r.date,
        amount: r.amount,
        description: r.description,
        transaction_type: r.type,
        status: r.matchStatus === 'matched' ? 'matched' : 'pending',
        matched_transaction_id: r.bestMatch?.source === 'bank_transaction' ? r.bestMatch.id : null,
        category: r.appliedRule?.category || null,
        cost_center_id: r.appliedRule?.cost_center_id || null,
        matched_at: r.matchStatus === 'matched' ? new Date().toISOString() : null,
        matched_by: r.matchStatus === 'matched' ? user.id : null,
      }));

    if (toInsert.length === 0) {
      showToast('Nenhum lançamento para importar.', 'error');
      setSaving(false);
      return;
    }

    // Salvar via Edge Function (evita bloqueio RLS)
    const { data: insertResp, error } = await invokeWithAuth<{ error?: string }>('financial-write', {
      body: {
        action: 'bulk_insert_statement_imports',
        tenant_id: user.tenantId,
        payload: { items: toInsert },
      },
    });

    if (error || (insertResp as Record<string, unknown>)?.error) {
      console.error('[ConciliacaoTab] Erro ao salvar imports:', error?.message ?? (insertResp as Record<string, unknown>)?.error);
      showToast('Erro ao importar lançamentos. Tente novamente.', 'error');
    } else {
      const matched = toInsert.filter(r => r.status === 'matched').length;
      const pending = toInsert.filter(r => r.status === 'pending').length;
      const withRules = toInsert.filter(r => r.category).length;
      showToast(`${toInsert.length} lançamentos importados · ${matched} conciliados · ${pending} pendentes${withRules > 0 ? ` · ${withRules} classificados por regra` : ''}`);
      setImportRows(null);
      refresh();
    }

    setSaving(false);
  };

  // ── Manual actions ────────────────────────────────────────────────────────
  const handleConciliar = async (id: string) => {
    const ok = await reconcile(id);
    if (ok) { showToast('Lançamento reconciliado!'); refresh(); }
  };

  const handleIgnorar = async (id: string) => {
    const ok = await updateImport(id, { status: 'ignored' });
    if (ok) { showToast('Lançamento ignorado.'); refresh(); }
  };

  const handleReabrir = async (id: string) => {
    const ok = await unreconcile(id);
    if (ok) { showToast('Status reaberto.'); refresh(); }
  };

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = [...imports];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.description?.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') result = result.filter(s => s.status === filterStatus);
    if (filterType !== 'all') result = result.filter(s => s.transaction_type === filterType);
    if (filterCategory !== 'all') result = result.filter(s => s.category === filterCategory);
    if (filterDateFrom) result = result.filter(s => s.transaction_date >= filterDateFrom);
    if (filterDateTo) result = result.filter(s => s.transaction_date <= filterDateTo);
    return result;
  }, [imports, search, filterStatus, filterType, filterCategory, filterDateFrom, filterDateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Categorias únicas para filtro
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    imports.forEach(i => { if (i.category) cats.add(i.category); });
    return Array.from(cats).sort();
  }, [imports]);

  // Resumo por categoria
  const categorySummary = useMemo(() => {
    const map: Record<string, { credit: number; debit: number; count: number }> = {};
    imports.forEach(i => {
      const cat = i.category || 'Sem categoria';
      if (!map[cat]) map[cat] = { credit: 0, debit: 0, count: 0 };
      map[cat].count++;
      if (i.transaction_type === 'credit') map[cat].credit += Number(i.amount);
      else map[cat].debit += Number(i.amount);
    });
    return Object.entries(map)
      .map(([name, { credit, debit, count }]) => ({ name, credit, debit, count, net: credit - debit }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [imports]);

  const selectedAccount = bankAccounts.find(a => a.id === selectedAccountId);

  const STATUS_CONFIG = {
    pending: { label: 'Pendente', color: 'bg-amber-100 text-amber-700', icon: 'ri-time-line' },
    matched: { label: 'Conciliado', color: 'bg-green-100 text-green-700', icon: 'ri-checkbox-circle-fill' },
    ignored: { label: 'Ignorado', color: 'bg-zinc-100 text-zinc-500', icon: 'ri-eye-off-line' },
    manual: { label: 'Manual', color: 'bg-orange-100 text-orange-700', icon: 'ri-edit-line' },
  };

  return (
    <div className="p-6 space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          <i className={toast.type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} />
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Conciliação Bancária</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Importe extratos, classifique automaticamente e reconcilie com o sistema</p>
        </div>
        <div className="flex items-center gap-2">
          {bankAccounts.length > 1 && (
            <select
              value={selectedAccountId}
              onChange={e => { setSelectedAccountId(e.target.value); setPage(1); }}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            >
              {bankAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowStoneConfig(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-green-300 text-green-700 bg-green-50 rounded-lg text-sm font-semibold hover:bg-green-100 cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-bank-card-line" /> Stone
          </button>
          <button
            onClick={() => setShowRules(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 text-zinc-600 rounded-lg text-sm font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-filter-3-line" /> Regras ({rules.length})
          </button>
          <button
            onClick={() => setShowSaldoModal(true)}
            disabled={!selectedAccount}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 text-zinc-600 rounded-lg text-sm font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50"
          >
            <i className="ri-scales-3-line" /> Reconciliar Saldo
          </button>
          <input ref={fileRef} type="file" accept=".ofx,.csv,.txt" className="hidden" onChange={handleFileChange} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!selectedAccountId || parsing}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            {parsing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <i className="ri-upload-2-line" /> Importar Extrato
              </>
            )}
          </button>
          <button
            onClick={() => setActiveImportTab(activeImportTab === 'stone' ? 'manual' : 'stone')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeImportTab === 'stone'
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'border border-green-300 text-green-700 hover:bg-green-50'
            }`}
          >
            <i className="ri-bank-card-line" />
            {activeImportTab === 'stone' ? 'Ocultar Stone' : 'Importar Stone'}
          </button>
        </div>
      </div>

      {/* Conta selecionada */}
      {selectedAccount && (
        <div className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl px-4 py-3">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0" style={{ backgroundColor: selectedAccount.color + '20' }}>
            <i className={`${selectedAccount.icon} text-sm`} style={{ color: selectedAccount.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-800">{selectedAccount.name}</p>
            <p className="text-xs text-zinc-400">{selectedAccount.bank_name || 'Conta bancária'}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-400">Saldo atual</p>
            <p className={`text-sm font-bold ${Number(selectedAccount.current_balance) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {formatCurrency(Number(selectedAccount.current_balance))}
            </p>
          </div>
        </div>
      )}

      {/* Stone Import Panel */}
      {activeImportTab === 'stone' && (
        <StoneImportPanel
          onImportDone={() => { refresh(); }}
          onConfigureClick={() => setShowStoneConfig(true)}
        />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: 'Importado', value: imports.length, icon: 'ri-list-check', color: 'text-zinc-700', bg: 'bg-zinc-100' },
          { label: 'Reconciliado', value: totalReconciled, icon: 'ri-shield-check-line', color: 'text-green-700', bg: 'bg-green-100' },
          { label: 'Pendentes', value: totalPending, icon: 'ri-time-line', color: 'text-amber-700', bg: 'bg-amber-100' },
          { label: 'Créditos', value: fmtCur(saldoCreditos), icon: 'ri-arrow-down-circle-line', color: 'text-green-700', bg: 'bg-green-100' },
          { label: 'Débitos', value: fmtCur(saldoDebitos), icon: 'ri-arrow-up-circle-line', color: 'text-red-600', bg: 'bg-red-100' },
          { label: 'Líquido', value: fmtCur(saldoLiquido), icon: 'ri-exchange-line', color: saldoLiquido >= 0 ? 'text-green-700' : 'text-red-600', bg: saldoLiquido >= 0 ? 'bg-green-100' : 'bg-red-100' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
            <div className={`w-9 h-9 flex items-center justify-center rounded-lg ${kpi.bg} flex-shrink-0`}>
              <i className={`${kpi.icon} ${kpi.color} text-base`} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">{kpi.label}</p>
              <p className={`text-base font-bold ${kpi.color}`}>{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Progress */}
      {imports.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600">Progresso da Conciliação</span>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-zinc-900">{pctConciliado}%</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                saldoLiquido >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
              }`}>
                Saldo: {saldoLiquido >= 0 ? '+' : ''}{fmtCur(saldoLiquido)}
              </span>
            </div>
          </div>
          <div className="w-full bg-zinc-100 rounded-full h-2.5">
            <div
              className="bg-green-500 h-2.5 rounded-full transition-all duration-700"
              style={{ width: `${pctConciliado}%` }}
            />
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-green-600 font-medium">{totalReconciled} reconciliados</span>
            <span className="text-amber-600 font-medium">{totalPending} pendentes</span>
            {totalIgnored > 0 && <span className="text-zinc-400">{totalIgnored} ignorados</span>}
            {pctConciliado === 100 && totalPending === 0 && (
              <span className="ml-auto flex items-center gap-1 text-green-600 font-semibold">
                <i className="ri-shield-check-line" /> Extrato totalmente conciliado!
              </span>
            )}
          </div>
        </div>
      )}

      {/* Category summary */}
      {categorySummary.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <p className="text-xs font-semibold text-zinc-600 mb-3">Resumo por Categoria</p>
          <div className="grid grid-cols-4 gap-2">
            {categorySummary.slice(0, 8).map(cat => (
              <button
                key={cat.name}
                onClick={() => setFilterCategory(filterCategory === cat.name ? 'all' : cat.name)}
                className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                  filterCategory === cat.name ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-amber-300'
                }`}
              >
                <p className="text-xs font-medium text-zinc-700 truncate">{cat.name}</p>
                <p className={`text-xs font-bold ${cat.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {cat.net >= 0 ? '+' : ''}{fmtCur(cat.net)}
                </p>
                <p className="text-xs text-zinc-400">{cat.count} lanç.</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar por descrição ou categoria..."
            className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
        </div>

        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          {(['all', 'pending', 'matched', 'ignored'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setFilterStatus(s); setPage(1); }}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterStatus === s ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
            >
              {s === 'all' ? 'Todos' : s === 'pending' ? 'Pendentes' : s === 'matched' ? 'Conciliados' : 'Ignorados'}
              <span className={`ml-1 text-xs rounded-full px-1.5 py-0.5 font-bold ${filterStatus === s ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                {s === 'all' ? imports.length : imports.filter(i => i.status === s).length}
              </span>
            </button>
          ))}
        </div>

        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          {(['all', 'credit', 'debit'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setFilterType(t); setPage(1); }}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterType === t ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
            >
              {t === 'all' ? 'Todos' : t === 'credit' ? 'Créditos' : 'Débitos'}
            </button>
          ))}
        </div>

        {uniqueCategories.length > 0 && (
          <select
            value={filterCategory}
            onChange={e => { setFilterCategory(e.target.value); setPage(1); }}
            className="border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          >
            <option value="all">Todas categorias</option>
            {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }}
            className="border border-zinc-200 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
          <span className="text-zinc-400 text-xs">até</span>
          <input
            type="date"
            value={filterDateTo}
            onChange={e => { setFilterDateTo(e.target.value); setPage(1); }}
            className="border border-zinc-200 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400 text-sm">
            <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mr-2" />
            Carregando...
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
              <i className="ri-bank-line text-3xl text-zinc-300" />
            </div>
            <p className="text-sm font-medium text-zinc-500">
              {imports.length === 0 ? 'Nenhum extrato importado' : 'Nenhum resultado encontrado'}
            </p>
            {imports.length === 0 && (
              <p className="text-xs text-zinc-400 mt-1">Clique em "Importar Extrato" para começar</p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Data</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Descrição</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Tipo</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Valor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Categoria</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {paginated.map(s => {
                const cfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.pending;
                return (
                  <tr
                    key={s.id}
                    className={`transition-colors hover:bg-zinc-50 cursor-pointer ${s.status === 'ignored' ? 'opacity-50' : ''}`}
                    onClick={() => setSelectedTransaction(s)}
                  >
                    <td className="px-4 py-3 text-zinc-700 font-medium whitespace-nowrap text-xs">
                      {new Date(s.transaction_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="text-xs font-medium text-zinc-800 truncate">{s.description || '—'}</p>
                      {s.external_id && (
                        <p className="text-xs text-zinc-400 mt-0.5 font-mono truncate">ID: {s.external_id}</p>
                      )}
                      {s.notes && (
                        <p className="text-xs text-amber-500 mt-0.5 truncate"><i className="ri-sticky-note-line text-xs" /> {s.notes}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s.transaction_type === 'credit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {s.transaction_type === 'credit' ? 'Crédito' : 'Débito'}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-bold text-sm ${s.transaction_type === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
                      {s.transaction_type === 'debit' ? '-' : '+'}{fmtCur(Number(s.amount))}
                    </td>
                    <td className="px-4 py-3">
                      {s.category ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                          {s.category}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>
                        <i className={`${cfg.icon} text-xs`} />
                        {s.reconciled ? 'Reconciliado' : cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {s.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleConciliar(s.id)}
                              className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-semibold hover:bg-green-100 cursor-pointer whitespace-nowrap transition-colors"
                              title="Reconciliar"
                            >
                              <i className="ri-checkbox-circle-line text-xs" />
                            </button>
                            <button
                              onClick={() => handleIgnorar(s.id)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"
                              title="Ignorar"
                            >
                              <i className="ri-eye-off-line text-zinc-400 text-sm" />
                            </button>
                          </>
                        )}
                        {(s.status === 'matched' || s.status === 'ignored') && (
                          <button
                            onClick={() => handleReabrir(s.id)}
                            className="text-xs text-zinc-400 hover:text-amber-600 cursor-pointer whitespace-nowrap transition-colors"
                          >
                            Reabrir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 bg-zinc-50">
            <p className="text-xs text-zinc-500">
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer"
              >
                <i className="ri-arrow-left-s-line text-sm" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-semibold cursor-pointer ${page === p ? 'bg-amber-500 text-white' : 'border border-zinc-200 text-zinc-600 hover:bg-white'}`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer"
              >
                <i className="ri-arrow-right-s-line text-sm" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Formatos suportados */}
      <div className="bg-zinc-50 rounded-xl border border-zinc-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <i className="ri-information-line text-zinc-400" />
          <p className="text-xs font-semibold text-zinc-600">Formatos suportados</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold text-zinc-700 mb-1.5">OFX (recomendado)</p>
            <div className="space-y-1">
              {['Banco do Brasil', 'Itaú', 'Bradesco', 'Santander', 'Caixa Econômica', 'Sicoob', 'Sicredi'].map(b => (
                <div key={b} className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <i className="ri-checkbox-circle-line text-green-500 text-xs" /> {b}
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-700 mb-1.5">CSV</p>
            <div className="space-y-1">
              {['Banco do Brasil (Data;Histórico;Documento;Crédito;Débito)', 'Itaú (Data;Valor;Identificador;Descrição)', 'Nubank (date,title,amount)', 'Bradesco (Data;Histórico;Valor)', 'Genérico (Data;Descrição;Valor)'].map(b => (
                <div key={b} className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <i className="ri-checkbox-circle-line text-amber-500 text-xs" /> {b}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Import Preview Modal */}
      {importRows && (
        <ImportPreviewModal
          rows={importRows}
          bankAccountId={selectedAccountId}
          onClose={() => setImportRows(null)}
          onConfirm={handleConfirmImport}
          saving={saving}
        />
      )}

      {/* Rules Modal */}
      {showRules && (
        <RegrasConciliacaoModal
          rules={rules}
          onClose={() => setShowRules(false)}
          onCreate={createRule}
          onUpdate={updateRule}
          onDelete={deleteRule}
        />
      )}

      {/* Transaction Detail Modal */}
      {selectedTransaction && (
        <TransacaoDetalheModal
          transaction={selectedTransaction}
          rules={rules}
          onClose={() => setSelectedTransaction(null)}
          onUpdate={updateImport}
          onReconcile={reconcile}
          onUnreconcile={unreconcile}
          onCreateRule={async (pattern, category, costCenterId, txType) => {
            return await createRule({
              pattern,
              match_type: 'contains',
              category: category || null,
              cost_center_id: costCenterId || null,
              transaction_type: txType === 'credit' ? 'credit' : 'debit',
              description_template: null,
              is_active: true,
            });
          }}
          findBillMatches={findBillMatches}
          findReceivableMatches={findReceivableMatches}
        />
      )}

      {/* Saldo Reconciliation Modal */}
      {showSaldoModal && selectedAccount && (
        <ReconciliacaoSaldoModal
          account={selectedAccount}
          onClose={() => setShowSaldoModal(false)}
        />
      )}

      {/* Stone Config Modal */}
      {showStoneConfig && (
        <StoneConfigModal
          onClose={() => setShowStoneConfig(false)}
          onSaved={() => { setShowStoneConfig(false); }}
        />
      )}
    </div>
  );
}