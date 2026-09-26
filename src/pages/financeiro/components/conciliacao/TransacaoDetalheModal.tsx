import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCostCenters } from '@/hooks/useFinanceiro';
import { formatCurrency } from '@/lib/formatters';
import { invokeWithAuth } from '@/lib/supabase';
import { useMoneyFlow } from '@/hooks/useMoneyFlow';
import { CATEGORIAS_ENTRADA } from './categoriasEntrada';
import VincularPagamento, { podeVincular } from './VincularPagamento';
import LancarDoExtrato, { podeLancarDoExtrato, useCategoriasLancamento } from './LancarDoExtrato';
import CategoriaCombobox, { type ComboOption } from '../CategoriaCombobox';
import ConfirmModal from '@/components/base/ConfirmModal';
import RastreioPagamento from './RastreioPagamento';
import { tipoDaNota } from './ConfirmarVinculosModal';
import { situacaoRepasse, type RepasseStone } from './RepassesStoneModal';
import type { StatementImport, BillMatch, ReceivableMatch, ReconciliationRule } from '@/hooks/useConciliacao';
import { horaTransacao } from '@/hooks/useConciliacao';

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
  findBillMatches: (amount: number, date: string, nome?: string) => Promise<BillMatch[]>;
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
  findBillMatches,
  findReceivableMatches,
  onChanged,
}: Props) {
  const { user } = useAuth();
  const { centers } = useCostCenters();
  const { labels: flowLabels } = useMoneyFlow();
  const [saving, setSaving] = useState(false);
  const [lancarAberto, setLancarAberto] = useState(false);
  const [billMatches, setBillMatches] = useState<BillMatch[]>([]);
  const [receivableMatches, setReceivableMatches] = useState<ReceivableMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);

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
      loadMatches();
    }
  }, [transaction]);

  // Vínculo pagamento × nota/conta: confirmar ou desfazer a baixa; lembrar CPF/chave Pix
  const [vinculoBusy, setVinculoBusy] = useState(false);
  // Desfazer confirmado na janela do sistema (antes: confirm do navegador)
  const [confirmarDesfazer, setConfirmarDesfazer] = useState<string | null>(null);
  const [vinculoMsg, setVinculoMsg] = useState<string | null>(null);
  const [lembrarContraparte, setLembrarContraparte] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  useEffect(() => { setVinculoMsg(null); setLembrarContraparte(false); }, [transaction?.id]);
  // Carimbar: grava antes o que foi editado (a categoria escolhida se perdia) e só então concilia
  const salvarEConciliar = async () => {
    if (!transaction) return;
    const mudou = form.description !== (transaction.description || '') || form.category !== (transaction.category || '')
      || form.cost_center_id !== (transaction.cost_center_id || '') || form.notes !== (transaction.notes || '');
    if (mudou || lembrarContraparte) await handleSave(false);
    await onReconcile(transaction.id);
    onClose();
  };

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

  // Repasse Stone ainda não conciliado: mostra a conta do dia (Stone liquidou × entrou no banco)
  const [repasse, setRepasse] = useState<RepasseStone | null>(null);
  useEffect(() => {
    setRepasse(null);
    const t = transaction as (StatementImport & { stone_installment_info?: Record<string, unknown> | null }) | null;
    if (!t || !user?.tenantId || t.transaction_type !== 'credit' || t.match_group) return;
    const daStone = t.source === 'stone';
    if (!daStone && !/stone/i.test(t.description ?? '')) return;
    const pilha = daStone
      ? (Number(t.stone_installment_info?.advance_fee ?? 0) > 0 ? 'antecipado' : 'debito')
      : (/antecipa/i.test(t.description ?? '') ? 'antecipado' : 'debito');
    const dia = String(t.transaction_date).slice(0, 10);
    let alive = true;
    invokeWithAuth<{ rows?: RepasseStone[] }>('conciliacao-pagamentos', {
      body: { action: 'stone_repasses', tenant_id: user.tenantId, date_from: dia, date_to: dia },
    }).then((r) => {
      if (!alive) return;
      const row = (r.data?.rows ?? []).find((x) => x.pilha === pilha);
      if (row) setRepasse({
        ...row, vendas: Number(row.vendas), liquido_stone: Number(row.liquido_stone), depositado: Number(row.depositado),
        creditos: Number(row.creditos), diferenca: Number(row.diferenca), dia_liquido_stone: Number(row.dia_liquido_stone),
        dia_depositado: Number(row.dia_depositado), bruto: Number(row.bruto), taxa: Number(row.taxa), antecipacao: Number(row.antecipacao),
      });
    });
    return () => { alive = false; };
  }, [transaction, user?.tenantId]);

  const loadMatches = useCallback(async () => {
    if (!transaction) return;
    setLoadingMatches(true);
    const [bills, receivables] = await Promise.all([
      transaction.transaction_type === 'debit' ? findBillMatches(Number(transaction.amount), transaction.transaction_date, [transaction.counterpart_name, transaction.description].filter(Boolean).join(' ')) : Promise.resolve([]),
      transaction.transaction_type === 'credit' ? findReceivableMatches(Number(transaction.amount), transaction.transaction_date) : Promise.resolve([]),
    ]);
    setBillMatches(bills);
    setReceivableMatches(receivables);
    setLoadingMatches(false);
  }, [transaction, findBillMatches, findReceivableMatches]);

  // Categoria da linha do extrato = NOME (texto). Saída: plano de contas da loja (despesas da DRE
  // + mercadorias/CMV). Entrada: a DRE não tem grupo de receita, então vão os destinos de entrada.
  // O valor atual entra sempre na lista, mesmo que não exista mais no plano.
  const { dreOptions, mercOptions } = useCategoriasLancamento();
  const categoriaOptions = useMemo<ComboOption[]>(() => {
    const out: ComboOption[] = [{ id: '', label: 'Sem categoria', sub: null }];
    const vistos = new Set<string>(['']);
    const add = (label: string, sub: string | null) => {
      const k = label.trim();
      if (!k || vistos.has(k)) return;
      vistos.add(k);
      out.push({ id: k, label: k, sub });
    };
    if (transaction?.transaction_type === 'credit') {
      for (const c of CATEGORIAS_ENTRADA) add(c, 'Entrada');
    } else {
      for (const o of dreOptions) add(o.label, o.sub ?? 'Despesa');
      for (const o of mercOptions) add(o.label, 'CMV');
      add('Transferência entre contas', 'Sem DRE');
    }
    if (transaction?.category) add(transaction.category, 'Atual');
    return out;
  }, [dreOptions, mercOptions, transaction?.transaction_type, transaction?.category]);

  if (!transaction) return null;

  const editouAlgo = form.description !== (transaction.description || '') || form.category !== (transaction.category || '')
    || form.cost_center_id !== (transaction.cost_center_id || '') || form.notes !== (transaction.notes || '') || lembrarContraparte;

  // Salvar fecha o modal (2026-09-20): antes gravava em silêncio — modal aberto, nada mudava na
  // tela e o botão seguia habilitado, dando a impressão de que o clique não tinha funcionado.
  const handleSave = async (fechar = true) => {
    setSaving(true);
    setSaveMsg(null);
    if (lembrarContraparte && transaction.counterpart_doc && form.category) {
      await invokeWithAuth('conciliacao-pagamentos', { body: { action: 'save_counterpart_rule', tenant_id: user?.tenantId, counterpart_doc: transaction.counterpart_doc, counterpart_label: transaction.counterpart_name ?? transaction.description, category: form.category, cost_center_id: form.cost_center_id || null, transaction_type: transaction.transaction_type } });
    }
    const ok = await onUpdate(transaction.id, {
      description: form.description,
      category: form.category || null,
      cost_center_id: form.cost_center_id || null,
      notes: form.notes || null,
    });
    setSaving(false);
    if (!ok) { setSaveMsg('Não foi possível salvar. Tente de novo.'); return false; }
    setLembrarContraparte(false);
    if (fechar) onClose();
    return true;
  };



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
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`w-10 h-10 flex items-center justify-center rounded-xl ${
              transaction.transaction_type === 'credit' ? 'bg-green-100' : 'bg-red-100'
            }`}>
              <i className={`${transaction.transaction_type === 'credit' ? 'ri-arrow-down-circle-line text-green-600' : 'ri-arrow-up-circle-line text-red-600'} text-lg`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-zinc-900 text-base">Detalhe da Transação</h3>
              <p className="text-xs text-zinc-500 break-all line-clamp-2">
                {new Date(transaction.transaction_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                {horaTransacao(transaction) && ` às ${horaTransacao(transaction)}`}
                {transaction.external_id && ` · ID: ${transaction.external_id}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500 text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
          {/* Valor */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-50 border border-zinc-200">
            <span className="text-sm text-zinc-500">Valor</span>
            <span className={`text-2xl font-bold ${transaction.transaction_type === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
              {transaction.transaction_type === 'debit' ? '-' : '+'}{formatCurrency(Number(transaction.amount))}
            </span>
          </div>

          {/* Quem recebeu / quem pagou: é o que decide o que lançar */}
          {(transaction.counterpart_name || transaction.counterpart_doc) && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-200">
              <i className={`${transaction.transaction_type === 'debit' ? 'ri-user-received-2-line' : 'ri-user-shared-2-line'} text-lg text-zinc-400`} />
              <div className="min-w-0">
                <p className="text-[11px] text-zinc-500">{transaction.transaction_type === 'debit' ? 'Pago a' : 'Recebido de'}</p>
                <p className="text-sm font-semibold text-zinc-800 truncate">{transaction.counterpart_name || '—'}</p>
                {transaction.counterpart_doc && (
                  <p className="text-xs text-zinc-500">
                    {transaction.counterpart_doc.length === 11 ? 'CPF ' : transaction.counterpart_doc.length === 14 ? 'CNPJ ' : 'Chave Pix '}{fmtDoc(transaction.counterpart_doc)}
                  </p>
                )}
              </div>
            </div>
          )}

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

          {transaction.match_kind === 'payroll' && transaction.match_detail && (() => {
            // Salário pago por Pix × folha pendente (2026-09-18): confirmar marca a folha como paga.
            const d = transaction.match_detail as Record<string, unknown>;
            const pago = !!d.confirmed;
            return (
              <div className={'border rounded-xl p-3 text-xs space-y-1 ' + (pago ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50')}>
                <p className="font-semibold text-zinc-800"><i className="ri-team-line mr-1" />{pago ? 'Folha paga por este Pix' : 'Folha sugerida (valor exato do líquido)'}</p>
                <p className="text-zinc-700">{String(d.label ?? '')}</p>
                {!pago && <p className="text-zinc-500">Confirme em "Confirmar vínculos": a folha fica paga no RH na data deste Pix. Salário não vira despesa aqui — a DRE já conta pela folha.</p>}
              </div>
            );
          })()}
          {transaction.match_kind === 'rule' && transaction.match_detail && !transaction.reconciled && (() => {
            // Regra de lançamento (2026-09-18): confirmar cria a despesa/compra já paga, com a competência
            const d = transaction.match_detail as Record<string, unknown>;
            const comp = String(d.competencia ?? '');
            return (
              <div className="border border-violet-200 bg-violet-50 rounded-xl p-3 text-xs space-y-2">
                <p className="font-semibold text-zinc-800"><i className="ri-flashlight-line mr-1" />Regra de lançamento</p>
                <p className="text-zinc-700">
                  Vira {d.tipo === 'compra' ? 'compra (CMV)' : 'despesa ' + String(d.categoria ?? '')} já paga nesta data
                  {comp ? ', competência ' + comp.slice(5, 7) + '/' + comp.slice(0, 4) : ''}.
                </p>
                {!!d.conflito && <p className="text-amber-700"><i className="ri-error-warning-line mr-1" />{String(d.conflito)}</p>}
                {d.fora_padrao === true && <p className="text-amber-700"><i className="ri-error-warning-line mr-1" />Valor fora do padrão deste fornecedor (média {formatCurrency(Number(d.media ?? 0))}).</p>}
                {vinculoMsg && <p className="text-red-600">{vinculoMsg}</p>}
                <button onClick={() => vinculoAction('confirm')} disabled={vinculoBusy} className="px-3 py-1.5 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-50 cursor-pointer">
                  {vinculoBusy ? 'Lançando...' : 'Confirmar e lançar'}
                </button>
              </div>
            );
          })()}
          {transaction.match_kind === 'fora_dre' && transaction.match_detail && (() => {
            // "Não entra no DRE" (LancarDoExtrato): só o motivo; o undo da edge devolve a linha a pendente
            const d = transaction.match_detail as Record<string, unknown>;
            return (
              <div className="border border-zinc-200 bg-zinc-50 rounded-xl p-3 text-xs space-y-2">
                <p className="font-semibold text-zinc-800"><i className="ri-eye-off-line mr-1" />Fora do DRE: {String(d.motivo_label ?? transaction.category ?? '')}</p>
                <p className="text-zinc-600">{d.observacao ? String(d.observacao) + ' · ' : ''}Não virou conta nem compra e não mexe no resultado.</p>
                {vinculoMsg && <p className="text-red-600">{vinculoMsg}</p>}
                <button
                  onClick={() => setConfirmarDesfazer('A marcação "fora do DRE" sai e o pagamento volta a pendente.')}
                  disabled={vinculoBusy} className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg font-semibold hover:bg-amber-50 disabled:opacity-50 cursor-pointer">
                  {vinculoBusy ? 'Desfazendo...' : 'Desfazer'}
                </button>
              </div>
            );
          })()}
          {(transaction.match_kind === 'payable' || transaction.match_kind === 'inbound_doc') && transaction.match_detail && (() => {
            const d = transaction.match_detail as Record<string, unknown>;
            const conf = d.confirmed as Record<string, unknown> | undefined;
            const confLabel: Record<string, string> = { exato: 'Exato', forte: 'Forte', provavel: 'Provável', manual: 'Manual' };
            const desconto = Number(d.desconto ?? 0);
            // Lançado a partir do extrato (pagamento sem nota): despesa ou compra criada aqui
            const criado = d.created === 'despesa' || d.created === 'compra' || d.created === 'freelancer' ? String(d.created) : null;
            return (
              <div className={'border rounded-xl p-3 text-xs space-y-2 ' + (conf ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-800"><i className="ri-links-line mr-1" />{criado ? `Lançado pelo extrato como ${criado === 'compra' ? 'compra (CMV)' : criado === 'freelancer' ? 'pagamento de freelancer' : 'despesa'}` : conf ? 'Pagamento conciliado' : 'Vínculo sugerido'}</span>
                  <span className="px-2 py-0.5 rounded-full bg-white border border-zinc-200 text-zinc-600">{confLabel[String(transaction.match_confidence)] ?? String(transaction.match_confidence ?? '')}</span>
                </div>
                <p className="text-zinc-700">
                  {String(d.label ?? '')}
                  {d.parcela ? ' · parcela ' + String(d.parcela) : ''}
                  {d.vencimento ? ' · vence ' + new Date(String(d.vencimento) + 'T00:00:00').toLocaleDateString('pt-BR') : ''}
                </p>
                {Number(d.iguais ?? 0) > 1 && !conf && (
                  <p className="text-zinc-500">
                    Este fornecedor tem {Number(d.iguais)} notas iguais em aberto (mesmo valor). Peguei a mais próxima
                    desta data — dá no mesmo: as outras ficam para os próximos pagamentos.
                  </p>
                )}
                {!criado && <div className="grid grid-cols-3 gap-2">
                  <div><p className="text-zinc-400">Parcela</p><p className="font-semibold text-zinc-800">{formatCurrency(Number(d.valor ?? 0))}</p></div>
                  <div><p className="text-zinc-400">Pago no banco</p><p className="font-semibold text-zinc-800">{formatCurrency(Number(transaction.amount))}</p></div>
                  <div><p className="text-zinc-400">{desconto > 0 ? 'Desconto' : 'Juros/multa'}</p><p className="font-semibold text-red-600">{formatCurrency(desconto > 0 ? desconto : Number(d.juros ?? 0))}</p></div>
                </div>}
                {criado && (
                  <p className="text-emerald-700">
                    {criado === 'compra'
                      ? 'Compra já paga nesta data, no CMV. Se a nota desse pagamento chegar depois, ela aparece nos alertas da Conciliação: não importe de novo.'
                      : criado === 'freelancer'
                      ? 'Despesa de RH já paga nesta data; a diária está em Financeiro › Freelancers.'
                      : 'Conta a pagar já baixada nesta data, com a categoria da DRE.'}
                  </p>
                )}
                {!conf && d.auto_import === true && (
                  <p className="text-blue-700"><i className="ri-magic-line mr-1" />Esta nota ainda não foi lançada. Ao confirmar, ela é importada automaticamente como {tipoDaNota(d)} e a parcela recebe a baixa.</p>
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
                    <button
                      onClick={() => {
                        setConfirmarDesfazer(criado === 'freelancer'
                          ? 'O pagamento de freelancer (conta e diárias) é apagado e o pagamento volta a pendente.'
                          : criado ? `A ${criado === 'compra' ? 'compra' : 'despesa'} criada a partir deste pagamento é apagada e o pagamento volta a pendente.`
                          : 'A baixa da conta é desfeita (a conta volta a em aberto) e o pagamento volta a pendente.');
                      }}
                      disabled={vinculoBusy} className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg font-semibold hover:bg-amber-50 disabled:opacity-50 cursor-pointer">
                      {vinculoBusy ? 'Desfazendo...' : criado ? 'Desfazer lançamento' : 'Desfazer baixa'}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
          {(transaction.status === 'matched' || transaction.reconciled) && (
            <RastreioPagamento transactionId={transaction.id} />
          )}
          {transaction.match_kind === 'internal_transfer' && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-xs text-sky-800">
              <i className="ri-arrow-left-right-line mr-1" />
              {transaction.transaction_type !== 'credit'
                ? 'Transferência para outra conta da própria empresa. Não entra como despesa.'
                : flowLabels.pixMode === 'transfer'
                  ? 'Transferência de outra conta da própria empresa. Conta como Pix recebido (Pix vendido na maquininha), conforme Conciliação › ⚙ › Como o dinheiro entra.'
                  : 'Transferência de outra conta da própria empresa. Não entra como receita (Conciliação › ⚙ › Como o dinheiro entra).'}
            </div>
          )}
          {podeVincular(transaction) && (
            <VincularPagamento transaction={transaction} onDone={() => { onChanged?.(); onClose(); }} />
          )}
          {podeLancarDoExtrato(transaction) && (
            <LancarDoExtrato transaction={transaction} onDone={() => { onChanged?.(); onClose(); }} onAbertoChange={setLancarAberto} />
          )}
          {!transaction.reconciled && transaction.status === 'pending' && !lancarAberto && (
            <button onClick={salvarEConciliar} disabled={saving}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 text-left hover:bg-emerald-50 disabled:opacity-50 cursor-pointer">
              <i className="ri-checkbox-circle-line text-emerald-600 text-lg" />
              <span className="flex-1">
                <span className="block text-sm font-semibold text-emerald-800">Marcar como conciliado</span>
                <span className="block text-xs text-emerald-600">
                  {transaction.transaction_type === 'credit'
                    ? 'Entrada já contada pela fonte de receita da loja: só sai dos pendentes.'
                    : 'Nada a lançar aqui: só sai dos pendentes, sem criar despesa.'}
                </span>
              </span>
            </button>
          )}
          {repasse && (() => {
            const s = situacaoRepasse(repasse);
            const cls = s.tom === 'erro' ? 'bg-red-50 border-red-200' : s.tom === 'alerta' ? 'bg-amber-50 border-amber-200' : s.tom === 'ok' ? 'bg-emerald-50 border-emerald-200' : 'bg-zinc-50 border-zinc-200';
            return (
              <div className={`rounded-xl border p-3 space-y-2 ${cls}`}>
                <p className="text-xs font-semibold text-zinc-700">
                  Repasse Stone de {new Date(repasse.dia + 'T00:00:00').toLocaleDateString('pt-BR')} · {repasse.pilha === 'antecipado' ? 'crédito antecipado' : 'débito'} · <span>{s.label}</span>
                </p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><p className="text-zinc-500">Stone liquidou</p><p className="font-bold text-zinc-800">{formatCurrency(repasse.liquido_stone)}</p><p className="text-zinc-400">{repasse.vendas} venda(s)</p></div>
                  <div><p className="text-zinc-500">Entrou no banco</p><p className="font-bold text-zinc-800">{formatCurrency(repasse.depositado)}</p><p className="text-zinc-400">{repasse.creditos} crédito(s)</p></div>
                  <div><p className="text-zinc-500">Diferença</p><p className={`font-bold ${s.tom === 'erro' ? 'text-red-600' : 'text-zinc-800'}`}>{formatCurrency(repasse.diferenca)}</p></div>
                </div>
                <p className="text-xs text-zinc-600 leading-snug">{s.explica}</p>
              </div>
            );
          })()}
          {groupRows.length > 0 && (() => {
            const num = (v: unknown) => Number(v ?? 0);
            const vendas = groupRows.filter(r => r.source === 'stone');
            const deps = groupRows.filter(r => r.source !== 'stone');
            // cancelamento/chargeback vêm como débito (gross/fee negativos): abatem o repasse, não são venda
            const sinal = (r: { transaction_type?: string }) => (r.transaction_type === 'debit' ? -1 : 1);
            const nVendas = vendas.filter(r => r.transaction_type !== 'debit').length;
            const nDesc = vendas.length - nVendas;
            const bruto = vendas.reduce((s, r) => s + num(r.stone_installment_info?.gross_amount ?? r.amount), 0);
            const taxa = vendas.reduce((s, r) => s + num(r.stone_installment_info?.fee_amount), 0);
            const liq = vendas.reduce((s, r) => s + sinal(r) * num(r.amount), 0);
            const dep = deps.reduce((s, r) => s + num(r.amount), 0);
            return (
              <div className="border border-green-200 rounded-xl overflow-hidden">
                <div className="bg-green-50 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-green-800"><i className="ri-links-line mr-1" />Repasse Stone × extrato do banco</span>
                  <span className="text-green-700 whitespace-nowrap">{nVendas} venda(s){nDesc > 0 ? ` · ${nDesc} cancelamento(s)` : ''} · no banco {formatCurrency(dep)}</span>
                </div>
                {transaction.match_group?.includes('+') && (() => {
                  const [d1, d2] = (transaction.match_group.split(':')[1] ?? '').split('+');
                  const br = (iso?: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '?');
                  return (
                    <p className="px-3 py-2 text-xs text-green-800 bg-green-50/60 border-b border-green-100">
                      <i className="ri-time-line mr-1" />
                      Crédito atrasado: parte do repasse de {br(d1)} foi creditada pelo banco em {br(d2)}. Os dois dias foram conferidos juntos.
                    </p>
                  );
                })()}
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
                        <span className="text-zinc-400"> → {formatCurrency(sinal(r) * num(r.amount))}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Form (etiqueta da linha do extrato). Some com o painel "Lançar" aberto: eram duas
              "Categoria DRE" na tela e só a do painel lança a despesa na DRE. */}
          {!lancarAberto && (<>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-zinc-600 mb-1 block">Descrição</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
            </div>
            {transaction.classificacao ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-600 mb-1 block">Categoria DRE</label>
                  <div className="w-full px-3 py-2 border border-emerald-200 bg-emerald-50 rounded-lg text-sm text-emerald-800 font-semibold flex items-center gap-1.5">
                    <i className="ri-checkbox-circle-line" />
                    {transaction.classificacao.categoria ?? 'Sem categoria na conta'}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 mb-1 block">Centro de Custo</label>
                  <div className="w-full px-3 py-2 border border-zinc-200 bg-zinc-50 rounded-lg text-sm text-zinc-700">
                    {transaction.classificacao.centro_custo ?? 'Nenhum'}
                  </div>
                </div>
                <p className="col-span-2 text-xs text-zinc-500 -mt-1">
                  Classificado na {transaction.classificacao.tipo === 'compra' ? 'compra' : 'conta a pagar'} que recebeu a baixa.
                  Para mudar, edite em Financeiro › {transaction.classificacao.tipo === 'compra' ? 'Compras' : 'Contas a pagar'}.
                </p>
              </div>
            ) : transaction.transaction_type === 'credit' ? (
            // Só nas ENTRADAS (2026-09-18): numa saída a etiqueta não entra em cálculo nenhum e ainda
            // tirava o pagamento do alerta. Saída se resolve pelo "Lançar", vínculo ou regra de lançamento.
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-zinc-600 mb-1 block">Categoria do extrato</label>
                <CategoriaCombobox
                  value={form.category}
                  options={categoriaOptions}
                  onChange={v => setForm(f => ({ ...f, category: v }))}
                  placeholder="Sem categoria"
                  buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white"
                />
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
            ) : null}
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

          {/* "Criar regra de classificação" saiu daqui (2026-09-18): só etiquetava o extrato por texto e
              parecia lançar na DRE. Etiqueta por pessoa (só entradas) = "Lembrar a categoria" abaixo; saídas = regra de lançamento. */}
          {transaction.transaction_type === 'credit' && transaction.counterpart_doc && transaction.match_kind !== 'internal_transfer' && !transaction.classificacao && (
            <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer bg-zinc-50 border border-zinc-200 rounded-lg p-2.5">
              <input type="checkbox" checked={lembrarContraparte} onChange={e => setLembrarContraparte(e.target.checked)} className="mt-0.5" />
              <span>
                Lembrar a categoria escolhida para {transaction.counterpart_doc.length === 11 ? 'o CPF' : transaction.counterpart_doc.length === 14 ? 'o CNPJ' : 'a chave Pix'} {fmtDoc(transaction.counterpart_doc)}
                {transaction.counterpart_name ? ' (' + transaction.counterpart_name + ')' : ''}. Os próximos lançamentos dessa pessoa entram classificados.
              </span>
            </label>
          )}
          </>)}

          {/* A lista "Contas a Pagar Relacionadas" saiu daqui (2026-09-20): era só enfeite (não dava para
              clicar) e sugeria pelo valor parecido. Quem liga pagamento a conta/nota agora é o
              "Este pagamento é de…" acima, que também aprende quem recebe pelo fornecedor. */}
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
        <div className="flex items-center justify-between gap-2 flex-wrap px-4 sm:px-6 py-4 border-t border-zinc-100 flex-shrink-0 bg-zinc-50">
          <div className="flex items-center gap-2">
            {transaction.reconciled && (
              <button
                onClick={async () => { await onUnreconcile(transaction.id); onClose(); }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-refresh-line" /> Reabrir
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-white hover:shadow-sm rounded-lg cursor-pointer whitespace-nowrap">
              Fechar
            </button>
            {/* Com o painel "Lançar" aberto o rodapé sai de cena: quem conclui é o botão de lá */}
            {saveMsg && <p className="text-xs text-red-600 self-center">{saveMsg}</p>}
            {!lancarAberto && (
            <button
              onClick={() => handleSave()}
              disabled={saving || !editouAlgo}
              title={editouAlgo ? undefined : 'Nada foi alterado'}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
            >
              {saving ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <i className="ri-save-line" />}
              Salvar alterações
            </button>
            )}
          </div>
        </div>
      </div>
      <ConfirmModal
        isOpen={!!confirmarDesfazer}
        icon="ri-arrow-go-back-line"
        danger
        title="Desfazer este lançamento?"
        message={confirmarDesfazer ?? ''}
        confirmLabel="Desfazer"
        onCancel={() => setConfirmarDesfazer(null)}
        onConfirm={async () => { await vinculoAction('undo'); setConfirmarDesfazer(null); }}
      />
    </div>
  );
}