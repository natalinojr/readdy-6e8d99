import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useBankAccounts } from '@/hooks/useFinanceiro';
import { useConciliacao, horaTransacao, descricaoPagamento } from '@/hooks/useConciliacao';
import { parseOFX, parseCSV, findMatches } from '@/utils/ofxParser';
import { formatCurrency } from '@/lib/formatters';
import RegrasConciliacaoModal from './conciliacao/RegrasConciliacaoModal';
import TransacaoDetalheModal from './conciliacao/TransacaoDetalheModal';
import ConfirmarVinculosModal from './conciliacao/ConfirmarVinculosModal';
import ReconciliacaoSaldoModal from './conciliacao/ReconciliacaoSaldoModal';
import StoneConfigModal from './conciliacao/StoneConfigModal';
import MpConfigModal from './conciliacao/MpConfigModal';
import IntegracoesModal, { type AbaIntegracao } from './conciliacao/IntegracoesModal';
import IfoodConfigModal from './conciliacao/IfoodConfigModal';
import InterConfigModal from './conciliacao/InterConfigModal';
import InicioFinanceiroModal from './conciliacao/InicioFinanceiroModal';
import ConfirmModal from '@/components/base/ConfirmModal';
import ComoDinheiroEntraModal from './conciliacao/ComoDinheiroEntraModal';
import RepassesStoneModal from './conciliacao/RepassesStoneModal';
import { useMoneyFlow } from '@/hooks/useMoneyFlow';
import { podeLancarDoExtrato, lancarDoExtrato, useCategoriasLancamento, MOTIVOS_FORA_DRE, type LancarTipo } from './conciliacao/LancarDoExtrato';
import CategoriaCombobox from './CategoriaCombobox';
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

// ── Menu suspenso simples (fecha ao clicar fora) ────────────────────────────

function DropMenu({ button, children, open, setOpen, width = 'w-72' }: {
  button: React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  setOpen: (v: boolean) => void;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);
  return (
    <div ref={ref} className="relative">
      {button}
      {open && (
        <div className={`absolute right-0 top-full mt-1 z-40 ${width} max-w-[calc(100vw-2rem)] bg-white border border-zinc-200 rounded-xl shadow-lg py-1.5`}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, hint, onClick, disabled }: { icon: string; label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-default"
    >
      <i className={`${icon} text-zinc-500 mt-0.5`} />
      <span className="min-w-0">
        <span className="block text-sm text-zinc-800">{label}</span>
        {hint && <span className="block text-xs text-zinc-400">{hint}</span>}
      </span>
    </button>
  );
}

// Estado único da linha, do ponto de vista de quem usa: conciliado, pendente ou ignorado.
// (No banco, "matched" e "reconciled" são campos distintos; para a tela é a mesma coisa.)
type Situacao = 'pending' | 'conciliado' | 'ignored';
function situacao(s: StatementImport): Situacao {
  if (s.status === 'ignored') return 'ignored';
  if (s.reconciled || s.status === 'matched' || s.status === 'manual') return 'conciliado';
  return 'pending';
}

const SITUACAO_CONFIG: Record<Situacao, { label: string; color: string; icon: string }> = {
  pending: { label: 'Pendente', color: 'bg-amber-100 text-amber-700', icon: 'ri-time-line' },
  conciliado: { label: 'Conciliado', color: 'bg-green-100 text-green-700', icon: 'ri-checkbox-circle-fill' },
  ignored: { label: 'Ignorado', color: 'bg-zinc-100 text-zinc-500', icon: 'ri-eye-off-line' },
};

const fmtDataBR = (iso: string) => iso.split('-').reverse().join('/');

// ── Main Component ──────────────────────────────────────────────────────────

export default function ConciliacaoTab() {
  const { user } = useAuth();
  const { accounts: bankAccounts, refresh: refetchAccounts } = useBankAccounts();
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Menus e modais
  const [menuImportar, setMenuImportar] = useState(false);
  const [menuConfig, setMenuConfig] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const navigate = useNavigate();
  const [selectedTransaction, setSelectedTransaction] = useState<StatementImport | null>(null);
  const [showSaldoModal, setShowSaldoModal] = useState(false);
  const [showStoneConfig, setShowStoneConfig] = useState(false);
  const [showMpConfig, setShowMpConfig] = useState(false);
  const [showIfoodConfig, setShowIfoodConfig] = useState(false);
  const [showInterConfig, setShowInterConfig] = useState(false);
  const [showInicioFin, setShowInicioFin] = useState(false);
  // false = fechada; true = abre na aba que precisa de atenção; ou a aba escolhida
  const [showIntegracoes, setShowIntegracoes] = useState<boolean | AbaIntegracao | 'mp-taxas'>(false);
  const [showComoEntra, setShowComoEntra] = useState(false);
  const [showRepassesStone, setShowRepassesStone] = useState<false | 'repasses' | 'taxas'>(false);
  const { flow: moneyFlow, providers: cardProviders, reload: reloadMoneyFlow } = useMoneyFlow();
  // Início do financeiro da loja (fin_revenue_settings.financeiro_inicio): o que é anterior está fechado
  const inicioFin = moneyFlow.financeiro_inicio ?? null;
  const mesBRFin = (iso: string) => iso.slice(5, 7) + '/' + iso.slice(0, 4);
  // A loja pode ter as duas maquininhas (fin_card_providers); card_provider é só a "principal" antiga —
  // com Stone + Mercado Pago ele dizia 'mercadopago' e o botão Repasses Stone sumia (2026-09-25).
  const usaStone = moneyFlow.card_provider === 'stone' || cardProviders.some(p => p.provider === 'stone');
  const usaMp = moneyFlow.card_provider === 'mercadopago' || cardProviders.some(p => p.provider === 'mercadopago');
  // Pagamentos sem nota selecionados para lançar de uma vez (despesa/compra)
  const [selLanc, setSelLanc] = useState<Set<string>>(new Set());
  const [lancTipo, setLancTipo] = useState<LancarTipo>('despesa');
  const [lancCat, setLancCat] = useState('');
  const [lancando, setLancando] = useState(false);
  const { dreOptions, mercOptions } = useCategoriasLancamento();
  const [interRefreshKey, setInterRefreshKey] = useState(0);

  // Período único: define o que aparece na tabela, os números e o que buscar nos bancos
  const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const shiftISO = (iso: string, n: number) => {
    const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
  };
  const [periodFrom, setPeriodFrom] = useState(() => shiftISO(hojeBR(), -30));
  const [periodTo, setPeriodTo] = useState(() => hojeBR());
  const periodoValido = Boolean(periodFrom && periodTo && periodFrom <= periodTo);

  // Filtros
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | Situacao>('all');
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [page, setPage] = useState(1);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Set default account (também quando a conta escolhida não é desta loja: troca de loja)
  useEffect(() => {
    if (bankAccounts.length > 0 && (!selectedAccountId || !bankAccounts.some(a => a.id === selectedAccountId))) {
      const def = bankAccounts.find(a => a.is_default) ?? bankAccounts[0];
      setSelectedAccountId(def.id);
    }
  }, [bankAccounts, selectedAccountId]);

  // "De" salvo na conta (financial-write): abre na conciliação mais antiga e só muda pelo usuário.
  // periodFromSalvo = último valor lido/gravado, para não regravar o que acabou de ser lido.
  const periodFromSalvo = useRef<{ accountId: string; from: string } | null>(null);
  // Conta cujo "De" salvo já chegou: a lista só é buscada depois (antes buscava com hoje−30,
  // chegava o período salvo e buscava tudo de novo — 2026-09-25).
  const [periodoPronto, setPeriodoPronto] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.tenantId || !selectedAccountId) return;
    let cancel = false;
    periodFromSalvo.current = null;
    (async () => {
      const r = await invokeWithAuth<{ data?: { date_from: string | null } }>('financial-write', {
        body: { action: 'get_reconciliation_period', tenant_id: user.tenantId, payload: { bank_account_id: selectedAccountId } },
      });
      if (cancel) return;
      let from = r.data?.data?.date_from || shiftISO(hojeBR(), -30);
      // Loja com período fechado abre a partir do início do financeiro (o anterior está encerrado)
      if (inicioFin && from < inicioFin) from = inicioFin;
      periodFromSalvo.current = { accountId: selectedAccountId, from };
      setPeriodFrom(from);
      setPage(1);
      setPeriodoPronto(selectedAccountId);
    })();
    return () => { cancel = true; };
  }, [user?.tenantId, selectedAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const salvo = periodFromSalvo.current;
    if (!user?.tenantId || !salvo || salvo.accountId !== selectedAccountId) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodFrom) || periodFrom === salvo.from) return;
    const t = setTimeout(async () => {
      const r = await invokeWithAuth('financial-write', {
        body: { action: 'set_reconciliation_period', tenant_id: user.tenantId, payload: { bank_account_id: selectedAccountId, date_from: periodFrom } },
      });
      if (!r.error) periodFromSalvo.current = { accountId: selectedAccountId, from: periodFrom };
    }, 800);
    return () => clearTimeout(t);
  }, [periodFrom, selectedAccountId, user?.tenantId]);

  // Hook de conciliação
  const {
    imports,
    rules,
    loading,
    refresh,
    updateImport,
    reconcile,
    unreconcile,
    motivoReabrir,
    findBillMatches,
    findReceivableMatches,
    applyRules,
    createRule,
    updateRule,
    deleteRule,
  } = useConciliacao(periodoPronto === selectedAccountId ? selectedAccountId : undefined, periodoValido ? { from: periodFrom, to: periodTo } : undefined);

  // Lançar/desfazer/confirmar mexe no saldo da conta (fn_bank_debit/credit): o cartão do topo ficava
  // com o saldo antigo até recarregar a página. Toda recarga do extrato relê as contas (2026-09-25).
  useEffect(() => { if (imports.length > 0) refetchAccounts(); }, [imports]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conta ligada ao banco: o saldo no ERP sai do extrato (fn_bank_recalc_balance, 2026-09-25) e a
  // diferença = linhas a conciliar − pagamentos do ERP sem linha no extrato. Explicação debaixo do número.
  type SaldoComposicao = { abertura: number; abertura_data: string | null; pendente: number; pendente_qtd: number; erp_sem_extrato: number; erp_sem_extrato_qtd: number; erp_sem_extrato_itens: { data: string; descricao: string; tipo: string; valor: number }[] };
  const [composicao, setComposicao] = useState<SaldoComposicao | null>(null);
  useEffect(() => {
    const id = selectedAccountId;
    if (!id) { setComposicao(null); return; }
    let vivo = true;
    supabase.rpc('fn_bank_balance_breakdown', { p_account: id }).then(({ data }) => { if (vivo) setComposicao((data as SaldoComposicao | null) ?? null); });
    return () => { vivo = false; };
  }, [selectedAccountId, imports]);

  // Alertas de confiabilidade (fn_conciliacao_alertas)
  // Cada item do alerta carrega o registro (2026-09-20): a linha leva onde se resolve.
  type AlertaItem = { label: string; valor: number; data: string | null; ref_kind?: 'statement' | 'bill' | 'doc' | null; ref_id?: string | null };
  type AlertaBloco = { count: number; total: number; itens: AlertaItem[] };
  const [alertas, setAlertas] = useState<Record<string, AlertaBloco | undefined> | null>(null);
  const loadAlerts = useCallback(async () => {
    if (!user?.tenantId) return;
    const r = await invokeWithAuth<{ success?: boolean; alerts?: Record<string, AlertaBloco> }>('conciliacao-pagamentos', { body: { action: 'alerts', tenant_id: user.tenantId } });
    if (r.data?.alerts) setAlertas(r.data.alerts);
  }, [user?.tenantId]);

  // Clique no item do alerta: pagamento abre o detalhe aqui (ajustando o período se for antigo);
  // conta a pagar e nota abrem na aba delas, com a busca preenchida.
  const [abrirDepois, setAbrirDepois] = useState<string | null>(null);
  const abrirAlerta = (it: AlertaItem) => {
    if (it.ref_kind === 'bill') { navigate(`/financeiro?tab=pagar&busca=${encodeURIComponent(it.label)}`); return; }
    if (it.ref_kind === 'doc') { navigate(`/financeiro?tab=notas-entrada&busca=${encodeURIComponent(it.label.replace(/^NF\s*/, '').split(' — ')[0])}`); return; }
    if (it.ref_kind !== 'statement' || !it.ref_id) return;
    const achado = imports.find(i => i.id === it.ref_id);
    if (achado) { setSelectedTransaction(achado); return; }
    // fora do período que está na tela: amplia e abre assim que a lista chegar
    const dia = String(it.data ?? '').slice(0, 10);
    if (dia && dia < periodFrom) { setPeriodFrom(dia); setPage(1); }
    if (dia && dia > periodTo) { setPeriodTo(dia); setPage(1); }
    setAbrirDepois(it.ref_id);
  };
  useEffect(() => {
    if (!abrirDepois) return;
    const achado = imports.find(i => i.id === abrirDepois);
    if (achado) { setSelectedTransaction(achado); setAbrirDepois(null); }
  }, [imports, abrirDepois]);

  // Extratos dos bancos integrados (Inter, Stone e iFood): o cron diário das 07h já busca;
  // aqui buscamos de novo ao abrir a tela e pelo menu "Importar".
  // auto (abertura da tela): cada banco só é consultado se a última busca dele (cron, outra pessoa,
  // outra aba) tem mais de 15 min ou deu erro — senão abrir a aba levava ~10–25 s à toa (2026-09-26).
  // O menu "Atualizar bancos agora" continua indo sempre aos bancos.
  const SYNC_MAX_AGE_MIN = 15;
  const [bankSync, setBankSync] = useState<{ running: boolean; msg: string | null; error: boolean }>({ running: false, msg: null, error: false });
  const runBankSync = useCallback(async (range?: { from: string; to: string }, stoneSince?: string, auto = false) => {
    if (!user?.tenantId) return;
    setBankSync({ running: true, msg: null, error: false });
    const maxAge = auto && !range && !stoneSince ? { max_age_min: SYNC_MAX_AGE_MIN } : {};
    type SyncResp = { success?: boolean; not_configured?: boolean; skipped?: boolean; fresh?: boolean; last_sync_at?: string; error?: string; inserted?: number };
    type Resp = { data: SyncResp | null; error: Error | null };

    // Stone: o arquivo do dia só sai no dia seguinte (Até ≤ ontem) e a edge aceita
    // no máximo 31 dias por chamada → divide o período em blocos.
    const stoneRange = async (): Promise<Resp> => {
      const ontem = shiftISO(hojeBR(), -1);
      const fim = range!.to > ontem ? ontem : range!.to;
      if (range!.from > fim) return { data: { success: true, skipped: true }, error: null };
      let inserted = 0; let lastErr: string | undefined; let ok = false; let notConf = false;
      for (let ini = range!.from; ini <= fim; ini = shiftISO(ini, 31)) {
        const blocoFim = shiftISO(ini, 30) > fim ? fim : shiftISO(ini, 30);
        const r = await invokeWithAuth<SyncResp & { days_ok?: number }>('stone-conciliation', {
          body: { action: 'import_range', tenant_id: user.tenantId, date_from: ini, date_to: blocoFim },
        });
        const err = r.data?.error ?? r.error?.message;
        if (/não configurad/i.test(String(err ?? ''))) { notConf = true; break; }
        if (err || !r.data?.success) lastErr = err || 'falhou'; else ok = true;
        inserted += Number(r.data?.inserted ?? 0);
      }
      if (notConf) return { data: { not_configured: true }, error: null };
      return { data: { success: ok || !lastErr, inserted, error: ok ? undefined : lastErr }, error: null };
    };

    // iFood: relatório de conciliação por competência (mês); o período escolhido vira a lista de meses.
    const competencias = (() => {
      if (!range) return undefined;
      const out: string[] = [];
      for (let m = range.from.slice(0, 7); m <= range.to.slice(0, 7) && out.length < 12; ) {
        out.push(m);
        const [y, mm] = m.split('-').map(Number);
        m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
      }
      return out;
    })();

    // Mercado Pago: a busca de pagamentos aceita o dia de HOJE e no máximo 31 dias por chamada.
    const mpRange = async (): Promise<Resp> => {
      let inserted = 0; let lastErr: string | undefined; let ok = false; let notConf = false;
      for (let ini = range!.from; ini <= range!.to; ini = shiftISO(ini, 31)) {
        const blocoFim = shiftISO(ini, 30) > range!.to ? range!.to : shiftISO(ini, 30);
        const r = await invokeWithAuth<SyncResp & { results?: Array<{ inserted?: number }> }>('mp-conciliation', {
          body: { action: 'import_range', tenant_id: user.tenantId, date_from: ini, date_to: blocoFim },
        });
        if (r.data?.not_configured) { notConf = true; break; }
        const err = r.data?.error ?? r.error?.message;
        if (err || !r.data?.success) lastErr = err || 'falhou'; else ok = true;
        inserted += (r.data?.results ?? []).reduce((s, x) => s + Number(x.inserted ?? 0), 0);
      }
      if (notConf) return { data: { not_configured: true }, error: null };
      return { data: { success: ok || !lastErr, inserted, error: ok ? undefined : lastErr }, error: null };
    };

    const [inter, stone] = await Promise.all([
      invokeWithAuth<SyncResp>('inter-bank', {
        body: { action: 'sync', tenant_id: user.tenantId, ...maxAge, ...(range ? { date_from: range.from, date_to: range.to } : {}) },
      }),
      range
        ? stoneRange()
        : invokeWithAuth<SyncResp>('stone-conciliation', { body: { action: 'sync', tenant_id: user.tenantId, ...maxAge, ...(stoneSince ? { date_from: stoneSince } : {}) } }),
    ]);
    // Depois do Inter: os saques do Mercado Pago e os depósitos do iFood casam com o extrato
    // que acabou de chegar (a mesma razão pela qual o cron roda o Inter primeiro).
    const [mp, ifood] = await Promise.all([
      range
        ? mpRange()
        : invokeWithAuth<SyncResp>('mp-conciliation', { body: { action: 'sync', tenant_id: user.tenantId, ...maxAge, ...(stoneSince ? { date_from: stoneSince } : {}) } }),
      invokeWithAuth<SyncResp>('ifood-financial', {
        body: { action: 'sync', tenant_id: user.tenantId, ...maxAge, ...(competencias ? { competences: competencias } : {}), ...(range ? { sales_from: range.from, sales_to: range.to } : {}) },
      }),
    ]);
    const parts: string[] = [];
    let hasError = false;
    let buscou = false; // algum banco foi consultado de verdade (não só "em dia")
    let ultimaBusca: string | null = null; // a mais antiga entre os bancos que estavam em dia
    const read = (label: string, r: { data: SyncResp | null; error: Error | null }) => {
      const d = r.data;
      const err = d?.error ?? r.error?.message;
      if (d?.not_configured || /não configurad/i.test(String(err ?? ''))) return; // banco não integrado nesta loja
      if (d?.skipped) return;
      if (err || !d?.success) { hasError = true; parts.push(`${label}: falhou`); return; }
      if (d.fresh) {
        if (d.last_sync_at && (!ultimaBusca || d.last_sync_at < ultimaBusca)) ultimaBusca = d.last_sync_at;
        parts.push(`${label}: em dia`);
        return;
      }
      buscou = true;
      parts.push(`${label}: ${Number(d.inserted ?? 0)} novo(s)`);
    };
    read('Inter', inter);
    read('Stone', stone);
    read('Mercado Pago', mp);
    read('iFood', ifood);
    const fmtHora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const periodo = range ? ` (${fmtDataBR(range.from)} a ${fmtDataBR(range.to)})` : '';
    const msg = parts.length === 0 ? null
      : !buscou && !hasError && ultimaBusca
        ? `Bancos em dia · última busca às ${fmtHora(new Date(ultimaBusca))} (para buscar agora: Importar › Atualizar bancos agora)`
        : `Bancos atualizados às ${fmtHora(new Date())}${periodo} · ${parts.join(' · ')}`;
    setBankSync({ running: false, error: hasError, msg });
    // Sugere de novo os vínculos pagamento × nota/conta (a nota pode ter chegado depois do pagamento).
    // A lista é relida por trás (sem "Carregando..."): quem já está mexendo na tabela não perde o lugar.
    await invokeWithAuth('conciliacao-pagamentos', { body: { action: 'rematch', tenant_id: user.tenantId } });
    refresh(true);
    loadAlerts();
    if (buscou) { refetchAccounts(); setInterRefreshKey((k) => k + 1); }
  }, [user?.tenantId, refresh, refetchAccounts, loadAlerts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Uma vez ao abrir a tela (e ao trocar de loja) — DEPOIS que a lista aparece. Rodando junto,
  // o Inter (6–26 s) e o Mercado Pago disputavam o banco com a lista, que ficava ~15 s vazia
  // (2026-09-25). Loja sem conta bancária nunca carrega lista: aí sincroniza em 8 s.
  const [listaPronta, setListaPronta] = useState(false);
  const viuCarregando = useRef(false);
  const sincronizouLoja = useRef<string | null>(null);
  useEffect(() => { setListaPronta(false); viuCarregando.current = false; }, [user?.tenantId]);
  useEffect(() => {
    if (loading) viuCarregando.current = true;
    else if (viuCarregando.current) setListaPronta(true);
  }, [loading]);
  useEffect(() => {
    const t = user?.tenantId;
    if (!t || sincronizouLoja.current === t) return;
    const timer = setTimeout(() => {
      if (sincronizouLoja.current === t) return;
      sincronizouLoja.current = t;
      runBankSync(undefined, undefined, true);
    }, listaPronta ? 0 : 8000);
    return () => clearTimeout(timer);
  }, [user?.tenantId, listaPronta]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Vínculos pagamento × nota/conta ─────────────────────────────────────────
  // Pagamentos com vínculo EXATO a uma nota/conta: confirmados em lote (decisão do dono)
  const exatosPendentes = useMemo(
    () => imports.filter(i => i.status === 'pending' && !i.reconciled && i.match_confidence === 'exato'),
    [imports],
  );
  // Candidatos da pré-visualização: exatos (já marcados) e fortes (opcionais)
  const vinculosPendentes = useMemo(
    () => imports.filter(i => i.status === 'pending' && !i.reconciled
      && (i.match_kind === 'payable' || i.match_kind === 'inbound_doc' || i.match_kind === 'payroll' || i.match_kind === 'rule')
      && (i.match_confidence === 'exato' || i.match_confidence === 'forte' || i.match_confidence === 'provavel')),
    [imports],
  );
  const [showConfirmarVinculos, setShowConfirmarVinculos] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const confirmarVinculos = useCallback(async (ids: string[]) => {
    if (!user?.tenantId || ids.length === 0) return;
    setConfirmando(true);
    type Res = { ok: boolean; msg: string; auto_imported?: boolean };
    // A edge aceita até 30 por chamada
    const res: Res[] = [];
    let err: string | undefined;
    for (let i = 0; i < ids.length && !err; i += 30) {
      const r = await invokeWithAuth<{ success?: boolean; error?: string; results?: Res[] }>('conciliacao-pagamentos', { body: { action: 'confirm', tenant_id: user.tenantId, ids: ids.slice(i, i + 30) } });
      err = r.data?.error ?? r.error?.message;
      res.push(...(r.data?.results ?? []));
    }
    setConfirmando(false);
    setShowConfirmarVinculos(false);
    const ok = res.filter(x => x.ok).length;
    const auto = res.filter(x => x.ok && x.auto_imported).length;
    const falhas = res.filter(x => !x.ok);
    if (err) showToast(err, 'error');
    else showToast(
      ok + ' pagamento(s) conciliado(s)' + (auto ? ', ' + auto + ' nota(s) importada(s) automaticamente' : '') + (falhas.length ? ' · ' + falhas.length + ' com problema: ' + falhas[0].msg : ''),
      falhas.length ? 'error' : 'success',
    );
    refresh();
    loadAlerts();
  }, [user?.tenantId, refresh, loadAlerts]);

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
        // hora do lançamento quando o arquivo do banco traz (padrão raw.hora, lido por horaTransacao)
        ...(r.time ? { raw: { hora: r.time, hora_ref: 'banco' } } : {}),
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
    if (ok) { showToast('Lançamento conciliado!'); refresh(); }
  };

  const handleIgnorar = async (id: string) => {
    const ok = await updateImport(id, { status: 'ignored' });
    if (ok) { showToast('Lançamento ignorado.'); refresh(); }
  };

  // Reabrir: quando desfaz algo (conta, compra, freela, folha, fora do DRE) confirma na janela do
  // sistema — antes era o confirm do navegador ("erpos.vercel.app diz…").
  const [reabrir, setReabrir] = useState<{ id: string; msg: string } | null>(null);
  const executarReabrir = async (id: string) => {
    try {
      const ok = await unreconcile(id);
      if (ok) { showToast('Pagamento reaberto.'); refresh(); loadAlerts(); }
    } catch (e) {
      showToast('Não foi possível reabrir: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };
  const handleReabrir = async (id: string) => {
    // Sempre confirma: um clique à toa tirava da conciliação até linha casada sozinha (Pix do tablet)
    setReabrir({ id, msg: motivoReabrir(id) ?? 'O pagamento volta a pendente. Nenhum lançamento é apagado.' });
  };

  // ── Números do período ────────────────────────────────────────────────────
  const contagem = useMemo(() => {
    const c = { pending: 0, conciliado: 0, ignored: 0 };
    imports.forEach(i => { c[situacao(i)]++; });
    return c;
  }, [imports]);
  const considerados = contagem.pending + contagem.conciliado;
  const pctConciliado = considerados > 0 ? Math.round((contagem.conciliado / considerados) * 100) : 0;

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = [...imports];
    if (search.trim()) {
      const q = search.toLowerCase();
      // Busca também na descrição do registro do pagamento (conta paga / vínculo), na contraparte e na observação
      result = result.filter(s => [
        s.description, descricaoPagamento(s), s.category, s.classificacao?.categoria, s.classificacao?.descricao,
        s.match_detail?.label, s.counterpart_name, s.notes,
      ].some(t => t != null && String(t).toLowerCase().includes(q)));
    }
    if (filterStatus !== 'all') result = result.filter(s => situacao(s) === filterStatus);
    if (filterType !== 'all') result = result.filter(s => s.transaction_type === filterType);
    if (filterCategory === 'none') result = result.filter(s => !(s.classificacao?.categoria ?? s.category));
    else if (filterCategory !== 'all') result = result.filter(s => (s.classificacao?.categoria ?? s.category) === filterCategory);
    // Dia mais recente primeiro e, no mesmo dia, pela hora (quando o banco informa); sem hora mantém a ordem do servidor
    result.sort((a, b) =>
      b.transaction_date.localeCompare(a.transaction_date)
      || (horaTransacao(b) ?? '').localeCompare(horaTransacao(a) ?? ''));
    return result;
  }, [imports, search, filterStatus, filterType, filterCategory]);

  // Entradas e saídas do que está na tabela (período + filtros); sem filtro = o período inteiro
  const totais = useMemo(() => {
    const t = { entradas: 0, nEntradas: 0, saidas: 0, nSaidas: 0 };
    filtered.forEach(s => {
      const v = Number(s.amount) || 0;
      if (s.transaction_type === 'credit') { t.entradas += v; t.nEntradas++; } else { t.saidas += v; t.nSaidas++; }
    });
    return t;
  }, [filtered]);
  const temFiltro = Boolean(search.trim()) || filterStatus !== 'all' || filterType !== 'all' || filterCategory !== 'all';
  const filtrarCategoria = (c: string) => { setFilterCategory(c); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Categorias únicas para filtro
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    imports.forEach(i => { const c = i.classificacao?.categoria ?? i.category; if (c) cats.add(c); });
    return Array.from(cats).sort();
  }, [imports]);

  const selectedAccount = bankAccounts.find(a => a.id === selectedAccountId);

  // Pendências: vínculos a confirmar + alertas de confiabilidade, num bloco só
  const ALERTAS_DEF: Array<[string, string, 'red' | 'amber']> = [
    ['contas_vencidas', 'Contas a pagar vencidas em aberto', 'red'],
    ['notas_vencidas', 'Notas com parcela vencida e sem pagamento no extrato', 'red'],
    ['duplicidades', 'Possíveis pagamentos em duplicidade', 'red'],
    ['notas_canceladas_lancadas', 'Notas canceladas na SEFAZ que foram lançadas', 'red'],
    ['notas_de_compra_do_extrato', 'Notas que podem ser de compra já lançada pelo extrato (não importe de novo)', 'red'],
    ['pagamentos_sem_nota', 'Pagamentos a empresas sem nota de entrada', 'amber'],
    ['juros_mes', 'Juros e multas pagos no mês', 'amber'],
    ['repasses_stone', 'Repasses da Stone que não bateram com o banco', 'red'],
    ['taxas_maquininha', 'Taxas da maquininha cobradas acima do contrato', 'red'],
  ];
  const alertasAtivos = alertas ? ALERTAS_DEF.filter(([k]) => Number(alertas[k]?.count ?? 0) > 0) : [];
  const temPendencias = vinculosPendentes.length > 0 || alertasAtivos.length > 0;

  const saldoBanco = selectedAccount?.synced_balance != null ? Number(selectedAccount.synced_balance) : null;
  const saldoErp = selectedAccount ? Number(selectedAccount.current_balance) : null;
  const diferenca = saldoBanco != null && saldoErp != null ? Math.round((saldoBanco - saldoErp) * 100) / 100 : null;

  const trocarFiltroStatus = (s: 'all' | Situacao) => { setFilterStatus(s); setPage(1); };

  // ── Seleção em lote ───────────────────────────────────────────────────────
  // Dá para marcar qualquer lançamento pendente (2026-09-20): a saída sem nota vira despesa/compra
  // e QUALQUER pendente (inclusive entrada, ex.: repasses da Tuna) pode receber o "ok" de uma vez.
  useEffect(() => { setSelLanc(new Set()); }, [selectedAccountId, periodFrom, periodTo]);
  const podeSelecionar = (s: StatementImport) => s.status === 'pending' && !s.reconciled;
  const elegiveisPagina = paginated.filter(podeSelecionar);
  const todosSelLanc = elegiveisPagina.length > 0 && elegiveisPagina.every(s => selLanc.has(s.id));
  const totalSelLanc = imports.filter(i => selLanc.has(i.id)).reduce((s, i) => s + Number(i.amount), 0);
  const [conciliandoLote, setConciliandoLote] = useState<{ feitos: number; total: number } | null>(null);
  const [confirmarOkLote, setConfirmarOkLote] = useState(false);
  const toggleLanc = (id: string) => setSelLanc(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Competência do lote (2026-09-20): como no "Lançar" de um pagamento só — mês do pagamento ou o
  // anterior. Cada pagamento tem a sua data, então os ids vão em grupos, um por competência.
  const [lancComp, setLancComp] = useState<'same' | 'prev'>('same');
  const [lancRegra, setLancRegra] = useState(false);
  const [lancMotivo, setLancMotivo] = useState(''); // 'Não entra no DRE' em lote: chave de MOTIVOS_FORA_DRE
  const [confirmarLote, setConfirmarLote] = useState(false);
  const selecionados = imports.filter(i => selLanc.has(i.id));
  // "Lançar" só vale para saída sem nota; entrada selecionada entra só no "dar ok"
  const selSaidas = selecionados.filter(podeLancarDoExtrato);
  const selEntradas = selecionados.filter(i => i.transaction_type === 'credit');
  // "Fazer sempre assim" só faz sentido se todos forem para o mesmo CNPJ/chave
  const docDoLote = (() => {
    if (selSaidas.length === 0 || !selSaidas.every(i => i.counterpart_doc)) return null;
    const docs = new Set(selSaidas.map(i => String(i.counterpart_doc)));
    return docs.size === 1 ? [...docs][0] : null;
  })();
  const mesDe = (iso: string) => {
    const [y, m] = iso.slice(0, 7).split('-').map(Number);
    if (lancComp === 'same') return `${y}-${String(m).padStart(2, '0')}`;
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  };

  // "Dar ok" em lote: marca como conciliado sem criar lançamento nenhum — para entradas que já entram
  // como receita pela fonte da loja (repasse de voucher, Pix) e para o que só falta carimbar.
  const conciliarSelecionados = async () => {
    if (selLanc.size === 0) return;
    setConfirmarOkLote(false);
    const ids = [...selLanc];
    setConciliandoLote({ feitos: 0, total: ids.length });
    let ok = 0; let erros = 0;
    for (let i = 0; i < ids.length; i += 5) {
      const bloco = ids.slice(i, i + 5);
      const r = await Promise.all(bloco.map(id => reconcile(id)));
      ok += r.filter(Boolean).length;
      erros += r.filter(x => !x).length;
      setConciliandoLote({ feitos: Math.min(i + 5, ids.length), total: ids.length });
    }
    setConciliandoLote(null);
    setSelLanc(new Set());
    showToast(`${ok} lançamento(s) conciliado(s)` + (erros ? ` · ${erros} não deu(ram) certo` : ''), erros ? 'error' : 'success');
    refresh();
    loadAlerts();
  };

  const lancarSelecionados = async () => {
    if (!user?.tenantId || selLanc.size === 0) return;
    if (lancTipo === 'despesa' && !lancCat) { showToast('Escolha a categoria da despesa', 'error'); return; }
    if (lancTipo === 'fora_dre' && !lancMotivo) { showToast('Escolha o motivo de não entrar no DRE', 'error'); return; }
    setConfirmarLote(false);
    const oque = lancTipo === 'compra' ? 'compra (CMV)' : lancTipo === 'fora_dre' ? 'fora do DRE' : 'despesa';
    setLancando(true);
    // um grupo por competência (a data de cada pagamento manda)
    const grupos = new Map<string, string[]>();
    selSaidas.forEach(i => {
      const mes = mesDe(i.transaction_date);
      grupos.set(mes, [...(grupos.get(mes) ?? []), i.id]);
    });
    let ok = 0; const falhas: Array<{ msg: string }> = []; let erro: string | null = null;
    for (const [mes, ids] of grupos) {
      const r = await lancarDoExtrato(user.tenantId, ids, {
        kind: lancTipo,
        motivo: lancTipo === 'fora_dre' ? lancMotivo : null,
        dre_category_id: lancTipo === 'despesa' ? lancCat : null,
        merchandise_category_id: lancTipo === 'compra' ? lancCat || null : null,
        competence_month: lancTipo === 'fora_dre' ? null : mes,
      });
      ok += r.results.filter(x => x.ok).length;
      falhas.push(...r.results.filter(x => !x.ok));
      if (r.error) { erro = r.error; break; }
    }
    // "Fazer sempre assim": cria a regra de lançamento para o CNPJ do lote
    if (!erro && lancRegra && docDoLote && lancTipo !== 'fora_dre') {
      const quem = selSaidas[0]?.counterpart_name ?? null;
      const rr = await invokeWithAuth<{ error?: string }>('conciliacao-pagamentos', {
        body: {
          action: 'launch_rule_save', tenant_id: user.tenantId, counterpart_doc: docDoLote, counterpart_label: quem,
          kind: lancTipo, dre_category_id: lancTipo === 'despesa' ? lancCat : null,
          merchandise_category_id: lancTipo === 'compra' ? lancCat || null : null,
          competence_rule: lancComp, supplier_name: quem,
        },
      });
      const e = rr.data?.error ?? rr.error?.message;
      if (e) showToast('Lançado, mas a regra não foi salva: ' + e, 'error');
    }
    setLancando(false);
    if (erro) showToast(ok > 0 ? `${ok} lançado(s) antes do erro: ${erro}` : erro, 'error');
    else showToast(`${ok} pagamento(s) lançado(s) como ${oque}` + (falhas.length ? ` · ${falhas.length} não: ${falhas[0].msg}` : ''), falhas.length ? 'error' : 'success');
    setSelLanc(new Set());
    setLancRegra(false);
    refresh();
    loadAlerts();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          <i className={toast.type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} />
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-zinc-900">Conciliação Bancária</h2>
          {bankSync.running ? (
            <p className="text-xs text-blue-600 mt-0.5 flex items-center gap-1"><i className="ri-loader-4-line animate-spin" /> Buscando extratos dos bancos integrados...</p>
          ) : bankSync.msg ? (
            <p className={`text-xs mt-0.5 flex items-center gap-1 ${bankSync.error ? 'text-red-600' : 'text-zinc-500'}`}>
              <i className={bankSync.error ? 'ri-error-warning-line' : 'ri-checkbox-circle-line text-green-600'} /> {bankSync.msg}
            </p>
          ) : (
            <p className="text-xs text-zinc-500 mt-0.5">Extrato do banco × lançamentos do sistema</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {bankAccounts.length > 1 && (
            <select
              value={selectedAccountId}
              onChange={e => { setSelectedAccountId(e.target.value); setPage(1); }}
              className="flex-1 sm:flex-none min-w-0 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white sm:max-w-[12rem]"
            >
              {bankAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}

          {usaStone && (
            <button
              onClick={() => setShowRepassesStone('repasses')}
              title="Quanto a Stone liquidou × quanto entrou no banco, e as taxas cobradas × contratadas"
              className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-3 py-2 bg-white border border-zinc-200 text-zinc-700 rounded-lg text-sm font-semibold hover:bg-zinc-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-bank-card-line text-amber-500" />
              Repasses Stone
              {Number(alertas?.repasses_stone?.count ?? 0) + Number(alertas?.taxas_maquininha?.count ?? 0) > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] leading-none">
                  {Number(alertas?.repasses_stone?.count ?? 0) + Number(alertas?.taxas_maquininha?.count ?? 0)}
                </span>
              )}
            </button>
          )}

          <input ref={fileRef} type="file" accept=".ofx,.csv,.txt" className="hidden" onChange={handleFileChange} />
          <DropMenu
            open={menuImportar}
            setOpen={setMenuImportar}
            button={
              <button
                onClick={() => setMenuImportar(!menuImportar)}
                disabled={bankSync.running || parsing}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                {bankSync.running || parsing
                  ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <i className="ri-download-cloud-line" />}
                Importar
                <i className="ri-arrow-down-s-line" />
              </button>
            }
          >
            <MenuItem
              icon="ri-refresh-line"
              label="Atualizar bancos agora"
              hint={periodoValido ? `Inter, Stone e iFood: só o que falta desde ${fmtDataBR(periodFrom)}` : 'Inter, Stone e iFood: só o que falta'}
              onClick={() => { setMenuImportar(false); runBankSync(undefined, periodoValido ? periodFrom : undefined); }}
            />
            <MenuItem
              icon="ri-calendar-line"
              label="Buscar o período filtrado"
              hint={periodoValido ? `${fmtDataBR(periodFrom)} a ${fmtDataBR(periodTo)} · reimportar não duplica` : 'Escolha um período válido abaixo'}
              disabled={!periodoValido}
              onClick={() => { setMenuImportar(false); runBankSync({ from: periodFrom, to: periodTo }); }}
            />
            <div className="border-t border-zinc-100 my-1" />
            <MenuItem
              icon="ri-upload-2-line"
              label="Arquivo OFX ou CSV"
              hint="Para bancos sem integração (OFX é o mais confiável)"
              disabled={!selectedAccountId}
              onClick={() => { setMenuImportar(false); fileRef.current?.click(); }}
            />
          </DropMenu>

          <DropMenu
            open={menuConfig}
            setOpen={setMenuConfig}
            width="w-64"
            button={
              <button
                onClick={() => setMenuConfig(!menuConfig)}
                className="w-9 h-9 flex items-center justify-center border border-zinc-200 rounded-lg hover:bg-zinc-50 cursor-pointer bg-white"
                title="Integrações, regras e saldo"
              >
                <i className="ri-settings-3-line text-zinc-600" />
              </button>
            }
          >
            <MenuItem icon="ri-git-merge-line" label="Como o dinheiro entra" hint="Banco principal, maquininha e iFood" onClick={() => { setMenuConfig(false); setShowComoEntra(true); }} />
            <MenuItem icon="ri-filter-3-line" label={`Regras de classificação (${rules.length})`} onClick={() => { setMenuConfig(false); setShowRules(true); }} />
            <MenuItem icon="ri-scales-3-line" label="Reconciliar saldo" disabled={!selectedAccount} onClick={() => { setMenuConfig(false); setShowSaldoModal(true); }} />
            <MenuItem icon="ri-calendar-check-line" label="Meu financeiro começa em…"
              hint={inicioFin ? `Hoje: ${mesBRFin(inicioFin)}` : 'Fecha os meses anteriores de uma vez'}
              onClick={() => { setMenuConfig(false); setShowInicioFin(true); }} />
            <div className="border-t border-zinc-100 my-1" />
            <p className="px-3 pt-1 pb-0.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">Integrações</p>
            <MenuItem icon="ri-pulse-line" label="Banco e maquininhas" hint="Situação, atualizar e histórico (Inter, Stone, Mercado Pago)" onClick={() => { setMenuConfig(false); setShowIntegracoes(true); }} />
            <MenuItem icon="ri-percent-line" label="Taxas do Mercado Pago" hint="Taxa efetiva por tipo de cartão" onClick={() => { setMenuConfig(false); setShowIntegracoes('mp-taxas'); }} />
            <MenuItem icon="ri-restaurant-2-line" label="iFood" onClick={() => { setMenuConfig(false); setShowIfoodConfig(true); }} />
          </DropMenu>
        </div>
      </div>

      {/* Pendências */}
      {temPendencias && (
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100">
          {vinculosPendentes.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
              <i className="ri-links-line text-emerald-600" />
              <p className="flex-1 min-w-0 text-sm text-zinc-800">
                <span className="font-semibold">{vinculosPendentes.length} pagamento(s)</span> batem com notas, contas a pagar ou folha
                <span className="text-zinc-400"> · {exatosPendentes.length} exato(s){vinculosPendentes.length > exatosPendentes.length ? `, ${vinculosPendentes.length - exatosPendentes.length} forte(s)` : ''}</span>
              </p>
              <button
                onClick={() => setShowConfirmarVinculos(true)}
                disabled={confirmando}
                title="Confirmar dá baixa na conta a pagar, lança juros e importa sozinha a nota que ainda não foi lançada"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <i className="ri-list-check-2" /> Revisar e confirmar
              </button>
            </div>
          )}
          {alertasAtivos.map(([k, title, tom]) => {
            const a = alertas![k]!;
            return (
              <details key={k} className="group px-4 py-2.5">
                <summary className="cursor-pointer list-none flex items-center gap-3 text-sm">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tom === 'red' ? 'bg-red-500' : 'bg-amber-400'}`} />
                  <span className="flex-1 min-w-0 text-zinc-800">{title}</span>
                  <span className="whitespace-nowrap text-zinc-500 text-xs"><span className="font-semibold text-zinc-800">{a.count}</span> · {fmtCur(Number(a.total))}</span>
                  <i className="ri-arrow-down-s-line text-zinc-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="mt-2 ml-5 space-y-1">
                  {(k === 'repasses_stone' || k === 'taxas_maquininha') && (
                    <button onClick={() => setShowRepassesStone(k === 'taxas_maquininha' ? 'taxas' : 'repasses')} className="text-xs font-semibold text-amber-600 hover:text-amber-700 cursor-pointer">
                      {k === 'taxas_maquininha' ? 'Ver taxas cobradas × contratadas →' : 'Ver repasses dia a dia →'}
                    </button>
                  )}
                  {a.itens.map((it, i) => {
                    const clicavel = !!it.ref_kind && !!it.ref_id;
                    return (
                      <button key={i} onClick={() => clicavel && abrirAlerta(it)} disabled={!clicavel}
                        title={clicavel ? (it.ref_kind === 'bill' ? 'Abrir em Contas a Pagar' : it.ref_kind === 'doc' ? 'Abrir em Notas de Entrada' : 'Abrir o pagamento') : undefined}
                        className={`w-full flex justify-between gap-2 text-xs text-zinc-600 text-left rounded px-1 py-0.5 ${clicavel ? 'hover:bg-amber-50 hover:text-zinc-900 cursor-pointer' : 'cursor-default'}`}>
                        <span className="truncate">
                          {it.data ? new Date(String(it.data).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') + ' · ' : ''}{it.label}
                          {clicavel && <i className="ri-arrow-right-up-line ml-1 text-zinc-300" />}
                        </span>
                        <span className="whitespace-nowrap font-semibold">{fmtCur(Number(it.valor))}</span>
                      </button>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {/* Números */}
      {selectedAccount && (
        <div className="bg-white rounded-xl border border-zinc-200 grid grid-cols-2 md:grid-cols-4 divide-x divide-zinc-100">
          <div className="px-4 py-3">
            <p className="text-xs text-zinc-400 flex items-center gap-1.5">
              <i className={`${selectedAccount.icon} text-xs`} style={{ color: selectedAccount.color }} />
              {saldoBanco != null ? `Saldo no banco · ${selectedAccount.name}` : selectedAccount.name}
            </p>
            <p className={`text-base font-bold ${(saldoBanco ?? saldoErp ?? 0) >= 0 ? 'text-zinc-900' : 'text-red-600'}`}>
              {formatCurrency(saldoBanco ?? saldoErp ?? 0)}
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-zinc-400" title={composicao ? 'Saldo do banco antes da 1ª linha do extrato + tudo que já foi conciliado ou ignorado + pagamentos feitos no ERP que ainda não aparecem no extrato' : 'Saldo inicial da conta + entradas e saídas lançadas no ERP'}>Saldo no ERP</p>
            <p className="text-base font-bold text-zinc-900">{saldoErp != null ? formatCurrency(saldoErp) : '—'}</p>
            {composicao?.abertura_data && (
              <p className="text-[11px] text-zinc-400">abertura {formatCurrency(composicao.abertura)} em {composicao.abertura_data.split('-').reverse().join('/')}</p>
            )}
          </div>
          <div className="px-4 py-3 border-t md:border-t-0 border-zinc-100">
            <p className="text-xs text-zinc-400">Diferença banco − ERP</p>
            {diferenca == null ? (
              <p className="text-base font-bold text-zinc-300">—</p>
            ) : diferenca === 0 ? (
              <p className="text-base font-bold text-green-700 flex items-center gap-1"><i className="ri-check-line" /> Bate</p>
            ) : composicao ? (
              <>
                <p className="text-base font-bold text-red-600">{diferenca > 0 ? '+' : '−'}{fmtCur(diferenca)}</p>
                {composicao.pendente_qtd > 0 && (
                  <button onClick={() => trocarFiltroStatus('pending')} className="block text-[11px] text-amber-600 hover:underline cursor-pointer text-left">
                    {composicao.pendente_qtd} a conciliar ({composicao.pendente < 0 ? '−' : '+'}{fmtCur(composicao.pendente)})
                  </button>
                )}
                {composicao.erp_sem_extrato_qtd > 0 && (
                  <p className="text-[11px] text-zinc-500 cursor-help" title={composicao.erp_sem_extrato_itens.map(i => `${i.data.split('-').reverse().join('/')} · ${i.descricao} · ${i.tipo === 'debit' ? '−' : '+'}${formatCurrency(Number(i.valor))}`).join('\n')}>
                    {composicao.erp_sem_extrato_qtd} pago{composicao.erp_sem_extrato_qtd > 1 ? 's' : ''} no ERP sem linha no extrato ({composicao.erp_sem_extrato < 0 ? '−' : '+'}{fmtCur(composicao.erp_sem_extrato)})
                  </p>
                )}
              </>
            ) : (
              <button onClick={() => setShowSaldoModal(true)} className="text-base font-bold text-red-600 hover:underline cursor-pointer" title="Abrir a reconciliação de saldo">
                {diferenca > 0 ? '+' : '−'}{fmtCur(diferenca)}
              </button>
            )}
          </div>
          <div className="px-4 py-3 border-t md:border-t-0 border-zinc-100">
            <p className="text-xs text-zinc-400">Conciliado no período</p>
            <div className="flex items-baseline gap-2">
              <p className={`text-base font-bold ${pctConciliado === 100 ? 'text-green-700' : 'text-zinc-900'}`}>{pctConciliado}%</p>
              {contagem.pending > 0 && (
                <button onClick={() => trocarFiltroStatus('pending')} className="text-xs font-semibold text-amber-600 hover:underline cursor-pointer">
                  {contagem.pending} pendente(s)
                </button>
              )}
            </div>
            <div className="w-full bg-zinc-100 rounded-full h-1.5 mt-1">
              <div className="bg-green-500 h-1.5 rounded-full transition-all duration-700" style={{ width: `${pctConciliado}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-full sm:w-auto flex items-center gap-1 bg-white border border-zinc-200 rounded-lg px-2 py-1.5" title="Período: vale para a tabela, os números e a busca nos bancos">
          <i className="ri-calendar-line text-zinc-400 text-sm" />
          <input type="date" value={periodFrom} max={periodTo || undefined}
            onChange={e => { setPeriodFrom(e.target.value); setPage(1); }}
            className="border-0 text-xs font-semibold text-zinc-700 focus:outline-none bg-transparent flex-1 sm:flex-none sm:w-28 min-w-0" />
          <span className="text-zinc-300 text-xs">até</span>
          <input type="date" value={periodTo} min={periodFrom || undefined} max={hojeBR()}
            onChange={e => { setPeriodTo(e.target.value); setPage(1); }}
            className="border-0 text-xs font-semibold text-zinc-700 focus:outline-none bg-transparent flex-1 sm:flex-none sm:w-28 min-w-0" />
        </div>

        {inicioFin && (
          <span title="O que é anterior a esse mês foi fechado em Conciliação › ⚙ › Meu financeiro começa em…"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 border border-violet-200 text-xs font-semibold text-violet-700 whitespace-nowrap">
            <i className="ri-calendar-check-line" /> Financeiro a partir de {mesBRFin(inicioFin)}
          </span>
        )}

        <div className="relative w-full sm:flex-1 sm:min-w-[12rem]">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar na descrição, pagamento ou categoria..."
            className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
        </div>

        <div className="flex w-full sm:w-auto bg-white border border-zinc-200 rounded-lg overflow-x-auto">
          {(['all', 'pending', 'conciliado', 'ignored'] as const).map(s => (
            <button
              key={s}
              onClick={() => trocarFiltroStatus(s)}
              className={`flex-1 sm:flex-none px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterStatus === s ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
            >
              {s === 'all' ? 'Todos' : s === 'pending' ? 'Pendentes' : s === 'conciliado' ? 'Conciliados' : 'Ignorados'}
              <span className={`ml-1 ${filterStatus === s ? 'text-white/80' : 'text-zinc-400'}`}>
                {s === 'all' ? imports.length : contagem[s]}
              </span>
            </button>
          ))}
        </div>

        <select
          value={filterType}
          onChange={e => { setFilterType(e.target.value as typeof filterType); setPage(1); }}
          className="flex-1 sm:flex-none border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
        >
          <option value="all">Entradas e saídas</option>
          <option value="credit">Só entradas</option>
          <option value="debit">Só saídas</option>
        </select>

        {uniqueCategories.length > 0 && (
          <select
            value={filterCategory}
            onChange={e => filtrarCategoria(e.target.value)}
            className={`${filterCategory === 'all' ? 'md:hidden' : 'ring-2 ring-amber-300'} flex-1 sm:flex-none border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white sm:max-w-[12rem]`}
          >
            <option value="all">Todas categorias</option>
            <option value="none">Sem categoria</option>
            {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Entradas e saídas do período (ou do filtro) */}
      {selectedAccount && (
        <div className="bg-white rounded-xl border border-zinc-200 grid grid-cols-3 divide-x divide-zinc-100">
          <div className="px-3 sm:px-4 py-3 min-w-0">
            <p className="text-xs text-zinc-400 truncate">Entradas {temFiltro ? 'no filtro' : 'no período'}</p>
            <p className="text-sm sm:text-base font-bold text-green-700 whitespace-nowrap">+{fmtCur(totais.entradas)}</p>
            <p className="text-[11px] text-zinc-400">{totais.nEntradas} lançamento(s)</p>
          </div>
          <div className="px-3 sm:px-4 py-3 min-w-0">
            <p className="text-xs text-zinc-400 truncate">Saídas {temFiltro ? 'no filtro' : 'no período'}</p>
            <p className="text-sm sm:text-base font-bold text-red-600 whitespace-nowrap">−{fmtCur(totais.saidas)}</p>
            <p className="text-[11px] text-zinc-400">{totais.nSaidas} lançamento(s)</p>
          </div>
          <div className="px-3 sm:px-4 py-3 min-w-0">
            <p className="text-xs text-zinc-400 truncate">Entradas − saídas</p>
            <p className={`text-sm sm:text-base font-bold whitespace-nowrap ${totais.entradas - totais.saidas >= 0 ? 'text-zinc-900' : 'text-red-600'}`}>
              {totais.entradas - totais.saidas < 0 ? '−' : ''}{fmtCur(Math.abs(totais.entradas - totais.saidas))}
            </p>
            {filterCategory !== 'all' && (
              <button onClick={() => filtrarCategoria('all')} className="text-[11px] font-semibold text-amber-600 hover:underline cursor-pointer truncate max-w-full">
                <i className="ri-close-line" /> {filterCategory === 'none' ? 'Sem categoria' : filterCategory}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Lançar em lote os pagamentos sem nota selecionados */}
      {selLanc.size > 0 && (
        <div className="sticky top-0 z-20 bg-white border border-violet-200 shadow-lg shadow-violet-100/50 rounded-2xl p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-zinc-800">
              <i className="ri-checkbox-multiple-line text-violet-600 mr-1" />
              {selLanc.size} selecionado{selLanc.size > 1 ? 's' : ''}
              <span className="ml-1 text-violet-700">· {fmtCur(totalSelLanc)}</span>
              {selEntradas.length > 0 && selSaidas.length > 0 && (
                <span className="ml-1 font-normal text-zinc-500">({selEntradas.length} entrada{selEntradas.length > 1 ? 's' : ''}, {selSaidas.length} saída{selSaidas.length > 1 ? 's' : ''} sem nota)</span>
              )}
            </p>
            <button onClick={() => setSelLanc(new Set())} className="text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer whitespace-nowrap">Limpar</button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setConfirmarOkLote(true)} disabled={!!conciliandoLote}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
              {conciliandoLote
                ? `Conciliando… ${conciliandoLote.feitos}/${conciliandoLote.total}`
                : `Marcar ${selLanc.size} como conciliado${selLanc.size > 1 ? 's' : ''}`}
            </button>
            <span className="text-[11px] text-zinc-400">Só carimba: não cria despesa nem receita. Dá para reabrir depois.</span>
          </div>

          {selSaidas.length > 0 && (<>
          <div className="border-t border-zinc-100 pt-3">
            <p className="text-[11px] font-medium text-zinc-500 mb-1.5">
              Ou lançar {selSaidas.length === selLanc.size ? 'as' : `as ${selSaidas.length}`} saída{selSaidas.length > 1 ? 's' : ''} sem nota como despesa/compra, ou tirar do DRE:
            </p>
          </div>

          <div className="flex bg-zinc-100 rounded-lg p-0.5 w-full sm:w-fit">
            {([['despesa', 'Despesa', 'ri-file-list-3-line'], ['compra', 'Compra (CMV)', 'ri-shopping-cart-line'], ['fora_dre', 'Não entra no DRE', 'ri-eye-off-line']] as const).map(([k, label, icon]) => (
              <button key={k} onClick={() => { setLancTipo(k); setLancCat(''); setLancMotivo(''); }}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${lancTipo === k ? 'bg-violet-600 text-white' : 'text-zinc-600 hover:text-zinc-900'}`}>
                <i className={icon} /> {label}
              </button>
            ))}
          </div>

          {lancTipo === 'fora_dre' ? (
          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">Motivo * <span className="font-normal text-zinc-400">— não cria conta nem compra; só sai das pendências sem mexer no resultado</span></label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {MOTIVOS_FORA_DRE.map(([k, label, ajuda]) => (
                <button key={k} type="button" onClick={() => setLancMotivo(k)}
                  className={`text-left px-3 py-2 rounded-lg border cursor-pointer ${lancMotivo === k ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}>
                  <span className="block text-xs font-semibold">{label}</span>
                  <span className={`block text-[11px] ${lancMotivo === k ? 'text-violet-100' : 'text-zinc-400'}`}>{ajuda}</span>
                </button>
              ))}
            </div>
          </div>
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">{lancTipo === 'despesa' ? 'Categoria da DRE *' : 'Categoria do CMV'}</label>
              <CategoriaCombobox value={lancCat} options={lancTipo === 'despesa' ? dreOptions : mercOptions} onChange={setLancCat}
                placeholder={lancTipo === 'despesa' ? 'Escolha a categoria…' : 'Escolha a categoria…'}
                buttonClassName="w-full bg-white border border-zinc-200 text-zinc-900 rounded-lg px-3 py-2 text-sm cursor-pointer" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">Competência (mês do gasto)</label>
              <div className="flex gap-1.5">
                {([['same', 'Mês do pagamento'], ['prev', 'Mês anterior']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setLancComp(k)}
                    className={`flex-1 px-2.5 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${lancComp === k ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}

          {docDoLote && lancTipo !== 'fora_dre' && (
            <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={lancRegra} onChange={e => setLancRegra(e.target.checked)} className="mt-0.5" />
              <span><b>Fazer sempre assim</b> para {selecionados[0]?.counterpart_name ?? 'este CNPJ'}: os próximos pagamentos viram este lançamento sozinhos (sugeridos em "Confirmar vínculos").</span>
            </label>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button disabled={lancando || (lancTipo === 'despesa' && !lancCat) || (lancTipo === 'fora_dre' && !lancMotivo)} onClick={() => setConfirmarLote(true)}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 cursor-pointer">
              {lancando ? 'Lançando…' : lancTipo === 'fora_dre' ? `Tirar ${selSaidas.length} do DRE` : `Lançar ${selSaidas.length} já pago${selSaidas.length > 1 ? 's' : ''}`}
            </button>
            <span className="text-[11px] text-zinc-400">Cada um entra na sua data. Dá para desfazer depois.</span>
          </div>
          </>)}

          <ConfirmModal
            isOpen={confirmarLote}
            icon="ri-add-circle-line"
            title={lancTipo === 'fora_dre' ? `Tirar ${selSaidas.length} pagamento(s) do DRE?` : `Lançar ${selSaidas.length} pagamento(s)?`}
            message={lancTipo === 'fora_dre'
              ? `Saem das pendências como "${MOTIVOS_FORA_DRE.find(([k]) => k === lancMotivo)?.[1] ?? ''}". Nada é lançado e o resultado não muda. Cada um pode ser desfeito depois.`
              : `Viram ${lancTipo === 'compra' ? 'compra (CMV)' : 'despesa'} já paga, cada uma na data em que o dinheiro saiu, com competência do ${lancComp === 'prev' ? 'mês anterior ao pagamento' : 'mês do pagamento'}. A descrição de cada lançamento será o nome de quem recebeu.`}
            confirmLabel={lancTipo === 'fora_dre' ? 'Tirar do DRE' : 'Lançar'}
            onCancel={() => setConfirmarLote(false)}
            onConfirm={lancarSelecionados}
          />

          <ConfirmModal
            isOpen={confirmarOkLote}
            icon="ri-checkbox-circle-line"
            title={`Marcar ${selLanc.size} como conciliado(s)?`}
            message={'Eles saem da lista de pendentes e dos alertas. Nada é lançado: entrada continua contando pela fonte de receita da loja, e saída sem lançamento não entra na DRE. Cada um pode ser reaberto depois.'}
            confirmLabel="Marcar como conciliado"
            onCancel={() => setConfirmarOkLote(false)}
            onConfirm={conciliarSelecionados}
          />
        </div>
      )}

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
              {imports.length === 0 ? 'Nenhum lançamento neste período' : 'Nenhum resultado para os filtros'}
            </p>
            {imports.length === 0 && (
              <p className="text-xs text-zinc-400 mt-1">Amplie o período ou use "Importar" para buscar nos bancos</p>
            )}
            {imports.length > 0 && temFiltro && (
              <div className="mt-3 flex flex-col items-center gap-1.5">
                <p className="text-xs text-zinc-400 text-center px-4">
                  Filtrando por:{' '}
                  {[
                    filterStatus !== 'all' && (filterStatus === 'pending' ? 'Pendentes' : filterStatus === 'conciliado' ? 'Conciliados' : 'Ignorados'),
                    filterType !== 'all' && (filterType === 'credit' ? 'só entradas' : 'só saídas'),
                    filterCategory !== 'all' && `categoria "${filterCategory === 'none' ? 'Sem categoria' : filterCategory}"`,
                    search.trim() && `busca "${search.trim()}"`,
                  ].filter(Boolean).join(' · ')}
                </p>
                <button onClick={() => { setSearch(''); setFilterStatus('all'); setFilterType('all'); setFilterCategory('all'); setPage(1); }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 cursor-pointer">
                  <i className="ri-filter-off-line" /> Limpar filtros
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
          {/* Celular: cartão por lançamento (a tabela não cabe em 375px) */}
          <ul className="md:hidden p-2 space-y-2 bg-zinc-50/60">
            {paginated.map(s => {
              const sit = situacao(s);
              const cfg = SITUACAO_CONFIG[sit];
              const det = s.match_detail as Record<string, unknown> | null;
              const temVinculo = det && ['payable', 'inbound_doc', 'payroll', 'rule'].includes(String(s.match_kind));
              return (
                <li key={s.id}>
                  <div onClick={() => setSelectedTransaction(s)}
                    className={`rounded-xl border bg-white px-3 py-3 active:bg-zinc-50 cursor-pointer ${sit === 'ignored' ? 'opacity-50 border-zinc-100' : sit === 'pending' ? 'border-amber-200' : 'border-zinc-200'}`}>
                    <div className="flex items-start gap-2">
                      {podeSelecionar(s) && (
                        <input type="checkbox" checked={selLanc.has(s.id)} onClick={e => e.stopPropagation()}
                          onChange={() => toggleLanc(s.id)} className="mt-1 w-4 h-4 flex-shrink-0"
                          title="Selecionar para conciliar em lote (saída sem nota também pode virar lançamento)" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] text-zinc-400 whitespace-nowrap">
                            {new Date(s.transaction_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                            {horaTransacao(s) && ` · ${horaTransacao(s)}`}
                          </span>
                          <span className={`text-base font-bold whitespace-nowrap ${s.transaction_type === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
                            {s.transaction_type === 'debit' ? '−' : '+'}{fmtCur(Number(s.amount))}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-zinc-800 break-words line-clamp-2">{s.description || '—'}</p>
                        {descricaoPagamento(s) && (
                          <p className="text-xs text-zinc-500 italic mt-0.5 break-words line-clamp-2">
                            <i className="ri-chat-quote-line text-xs not-italic" /> {descricaoPagamento(s)}
                          </p>
                        )}
                        {temVinculo && (
                          <p className={'text-xs mt-0.5 break-words line-clamp-2 ' + (s.reconciled ? 'text-emerald-600' : 'text-blue-600')}>
                            <i className="ri-links-line text-xs" /> {s.reconciled ? 'Pago: ' : 'Sugestão: '}{String(det?.label ?? '')}
                          </p>
                        )}
                        {!temVinculo && s.classificacao?.descricao && (
                          <p className="text-xs mt-0.5 break-words line-clamp-2 text-emerald-600">
                            <i className="ri-links-line text-xs" /> Pago: {s.classificacao.descricao}
                          </p>
                        )}
                        {s.notes && <p className="text-xs text-amber-500 mt-0.5 break-words line-clamp-1"><i className="ri-sticky-note-line text-xs" /> {s.notes}</p>}
                        <div className="flex items-center gap-1.5 flex-wrap mt-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.color}`}>
                            <i className={`${cfg.icon} text-xs`} />{cfg.label}
                          </span>
                          {(s.classificacao?.categoria || s.category) && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.classificacao?.categoria ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {s.classificacao?.categoria ?? s.category}
                            </span>
                          )}
                          <span className="flex-1" />
                          <span onClick={e => e.stopPropagation()} className="flex items-center gap-1">
                            {sit === 'pending' ? (
                              <>
                                <button onClick={() => handleConciliar(s.id)} title="Marcar como conciliado"
                                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-green-50 text-green-700 active:bg-green-100 cursor-pointer">
                                  <i className="ri-check-line" />
                                </button>
                                <button onClick={() => handleIgnorar(s.id)} title="Ignorar"
                                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-50 active:bg-zinc-100 cursor-pointer">
                                  <i className="ri-eye-off-line text-zinc-400" />
                                </button>
                              </>
                            ) : (
                              <button onClick={() => handleReabrir(s.id)}
                                className="px-3 h-9 flex items-center rounded-lg bg-zinc-50 text-xs font-semibold text-zinc-500 active:bg-zinc-100 cursor-pointer">
                                Reabrir
                              </button>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="pl-4 pr-1 py-3 w-8">
                    <input type="checkbox" checked={todosSelLanc} disabled={elegiveisPagina.length === 0}
                      title="Selecionar todos os pendentes desta página"
                      onChange={() => setSelLanc(prev => {
                        const n = new Set(prev);
                        if (todosSelLanc) elegiveisPagina.forEach(s => n.delete(s.id)); else elegiveisPagina.forEach(s => n.add(s.id));
                        return n;
                      })} />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Data</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Descrição</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Valor</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-zinc-500">
                    <select value={filterCategory} onChange={e => filtrarCategoria(e.target.value)}
                      title="Filtrar pela categoria"
                      className={`max-w-[11rem] rounded-md px-1.5 py-1 text-xs font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 ${filterCategory !== 'all' ? 'bg-amber-100 text-amber-800' : 'bg-transparent text-zinc-500 hover:bg-zinc-100'}`}>
                      <option value="all">Categoria ▾</option>
                      <option value="none">Sem categoria</option>
                      {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Status</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {paginated.map(s => {
                  const sit = situacao(s);
                  const cfg = SITUACAO_CONFIG[sit];
                  return (
                    <tr
                      key={s.id}
                      className={`transition-colors hover:bg-zinc-50 cursor-pointer ${sit === 'ignored' ? 'opacity-50' : ''}`}
                      onClick={() => setSelectedTransaction(s)}
                    >
                      <td className="pl-4 pr-1 py-3" onClick={e => e.stopPropagation()}>
                        {podeSelecionar(s) && (
                          <input type="checkbox" checked={selLanc.has(s.id)} onChange={() => toggleLanc(s.id)} title="Selecionar para conciliar em lote (saída sem nota também pode virar lançamento)" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-700 font-medium whitespace-nowrap text-xs">
                        {new Date(s.transaction_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                        {horaTransacao(s) && <span className="block text-[11px] text-zinc-400 font-normal">{horaTransacao(s)}</span>}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-xs font-medium text-zinc-800 truncate">{s.description || '—'}</p>
                        {descricaoPagamento(s) && (
                          <p className="text-xs text-zinc-500 italic mt-0.5 truncate" title={descricaoPagamento(s) ?? ''}>
                            <i className="ri-chat-quote-line text-xs not-italic" /> {descricaoPagamento(s)}
                          </p>
                        )}
                        {s.notes && (
                          <p className="text-xs text-amber-500 mt-0.5 truncate"><i className="ri-sticky-note-line text-xs" /> {s.notes}</p>
                        )}
                        {s.match_detail && (s.match_kind === 'payable' || s.match_kind === 'inbound_doc' || s.match_kind === 'payroll' || s.match_kind === 'rule') && (
                          <p className={'text-xs mt-0.5 truncate ' + (s.reconciled ? 'text-emerald-600' : 'text-blue-600')}>
                            <i className="ri-links-line text-xs" /> {s.reconciled ? 'Pago: ' : 'Sugestão (' + (s.match_confidence ?? '') + '): '}{String(s.match_detail.label ?? '')}
                            {!s.reconciled && s.match_detail.auto_import ? ' · nota será importada' : ''}
                            {s.reconciled && (s.match_detail.confirmed as Record<string, unknown> | undefined)?.auto_imported ? ' · nota importada automaticamente' : ''}
                            {Number(s.match_detail.juros ?? 0) > 0 ? ' · juros ' + fmtCur(Number(s.match_detail.juros)) : ''}
                          </p>
                        )}
                        {s.classificacao?.descricao && !(s.match_detail && (s.match_kind === 'payable' || s.match_kind === 'inbound_doc' || s.match_kind === 'payroll' || s.match_kind === 'rule')) && (
                          <p className="text-xs mt-0.5 truncate text-emerald-600" title={s.classificacao.descricao}>
                            <i className="ri-links-line text-xs" /> Pago: {s.classificacao.descricao}
                          </p>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold text-sm whitespace-nowrap ${s.transaction_type === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
                        {s.transaction_type === 'debit' ? '−' : '+'}{fmtCur(Number(s.amount))}
                      </td>
                      <td className="px-4 py-3" onClick={e => { const c = s.classificacao?.categoria ?? s.category; if (c) { e.stopPropagation(); filtrarCategoria(c); } }}>
                        {s.classificacao?.categoria ? (
                          <span title={`Classificado na ${s.classificacao.tipo === 'compra' ? 'compra' : 'conta a pagar'} que recebeu a baixa · clique para filtrar`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 hover:ring-1 hover:ring-emerald-300">
                            {s.classificacao.categoria}
                          </span>
                        ) : s.category ? (
                          <span title="Clique para filtrar" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 hover:ring-1 hover:ring-amber-300">
                            {s.category}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cfg.color}`}>
                          <i className={`${cfg.icon} text-xs`} />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {sit === 'pending' ? (
                            <>
                              <button
                                onClick={() => handleConciliar(s.id)}
                                className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer transition-colors"
                                title="Marcar como conciliado"
                              >
                                <i className="ri-check-line text-sm" />
                              </button>
                              <button
                                onClick={() => handleIgnorar(s.id)}
                                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"
                                title="Ignorar"
                              >
                                <i className="ri-eye-off-line text-zinc-400 text-sm" />
                              </button>
                            </>
                          ) : (
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
          </div>
          </>
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

      {imports.length >= (periodoValido ? 10000 : 500) && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <i className="ri-information-line" /> O período tem mais de {periodoValido ? '10.000' : '500'} lançamentos; só os mais recentes aparecem. Reduza o período para ver todos.
        </p>
      )}

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
      {showInicioFin && (
        <InicioFinanceiroModal
          atual={inicioFin}
          onClose={() => setShowInicioFin(false)}
          onSaved={() => { reloadMoneyFlow(); refresh(); loadAlerts(); }}
        />
      )}

      {showRules && (
        <RegrasConciliacaoModal
          rules={rules}
          onClose={() => setShowRules(false)}
          onCreate={createRule}
          onUpdate={updateRule}
          onDelete={deleteRule}
          onChanged={async () => { await invokeWithAuth('conciliacao-pagamentos', { body: { action: 'rematch', tenant_id: user?.tenantId } }); refresh(); loadAlerts(); }}
        />
      )}

      {/* Pré-visualização da confirmação em lote */}
      {showConfirmarVinculos && (
        <ConfirmarVinculosModal
          rows={vinculosPendentes}
          confirming={confirmando}
          onClose={() => setShowConfirmarVinculos(false)}
          onConfirm={confirmarVinculos}
        />
      )}

      <ConfirmModal
        isOpen={!!reabrir}
        icon="ri-arrow-go-back-line"
        danger
        title="Reabrir este pagamento?"
        message={reabrir?.msg ?? ''}
        confirmLabel="Reabrir"
        onCancel={() => setReabrir(null)}
        onConfirm={async () => { if (reabrir) await executarReabrir(reabrir.id); setReabrir(null); }}
      />

      {/* Transaction Detail Modal */}
      {selectedTransaction && (
        <TransacaoDetalheModal
          transaction={selectedTransaction}
          rules={rules}
          onClose={() => setSelectedTransaction(null)}
          onUpdate={updateImport}
          onReconcile={reconcile}
          onUnreconcile={async (id) => { await handleReabrir(id); return true; }}
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
          onChanged={() => { refresh(); loadAlerts(); }}
        />
      )}

      {/* Saldo Reconciliation Modal */}
      {showSaldoModal && selectedAccount && (
        <ReconciliacaoSaldoModal
          account={selectedAccount}
          onClose={() => setShowSaldoModal(false)}
        />
      )}

      {/* Integrações (Inter, Stone, Mercado Pago): situação, atualizar e histórico por dia */}
      {showIntegracoes !== false && (
        <IntegracoesModal
          maquininha={usaMp ? 'mercadopago' : usaStone ? 'stone' : null}
          abaInicial={showIntegracoes === true ? undefined : showIntegracoes === 'mp-taxas' ? 'mp' : showIntegracoes}
          mpParteInicial={showIntegracoes === 'mp-taxas' ? 'taxas' : undefined}
          interRefreshKey={interRefreshKey}
          onClose={() => setShowIntegracoes(false)}
          onChanged={() => { refresh(); }}
          onInterSynced={() => { refresh(); refetchAccounts(); }}
          onConfig={(a) => { if (a === 'inter') setShowInterConfig(true); else if (a === 'stone') setShowStoneConfig(true); else setShowMpConfig(true); }}
          onVerRepassesStone={() => setShowRepassesStone('repasses')}
        />
      )}

      {/* Papel de cada banco/maquininha (fin_revenue_settings via financial-write › set_money_flow) */}
      {showComoEntra && (
        <ComoDinheiroEntraModal
          onClose={() => setShowComoEntra(false)}
          onSaved={() => { showToast('Configuração salva.'); refresh(); loadAlerts(); }}
        />
      )}

      {/* Banco Inter Config Modal */}
      {showInterConfig && (
        <InterConfigModal
          onClose={() => setShowInterConfig(false)}
          onSaved={() => { setInterRefreshKey((k) => k + 1); refresh(); refetchAccounts(); }}
        />
      )}

      {showRepassesStone && (
        <RepassesStoneModal
          dateFrom={periodoValido ? periodFrom : shiftISO(hojeBR(), -30)}
          dateTo={periodoValido ? periodTo : hojeBR()}
          abaInicial={showRepassesStone}
          onClose={() => setShowRepassesStone(false)}
        />
      )}

      {/* Stone Config Modal */}
      {showStoneConfig && (
        <StoneConfigModal
          onClose={() => setShowStoneConfig(false)}
          onSaved={() => { setShowStoneConfig(false); }}
        />
      )}

      {/* Mercado Pago Config Modal */}
      {showMpConfig && (
        <MpConfigModal
          onClose={() => setShowMpConfig(false)}
          onSaved={() => { setShowMpConfig(false); refresh(); loadAlerts(); }}
        />
      )}

      {/* iFood Config Modal */}
      {showIfoodConfig && (
        <IfoodConfigModal
          onClose={() => setShowIfoodConfig(false)}
          onImported={() => { refresh(); loadAlerts(); }}
        />
      )}
    </div>
  );
}
