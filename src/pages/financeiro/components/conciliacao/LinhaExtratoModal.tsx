// Abre UMA linha do extrato fora da aba Conciliação (2026-09-29) — usado pela Trilha das despesas.
// É a mesma janela da Conciliação (TransacaoDetalheModal): vincular a uma conta/nota, lançar como
// despesa/compra/freelancer/prestador, marcar "não entra no DRE", ver o rastreio. A lista vem do
// mesmo hook, só com a conta e o dia da linha, para as ações se comportarem igual à Conciliação.
import { useState } from 'react';
import { useConciliacao } from '@/hooks/useConciliacao';
import ConfirmModal from '@/components/base/ConfirmModal';
import TransacaoDetalheModal from './TransacaoDetalheModal';

interface Props {
  linha: { id: string; bank_account_id?: string | null; transaction_date: string };
  onClose: () => void;
  /** Algo mudou (lançou, vinculou, desfez): quem abriu recarrega */
  onChanged: () => void;
}

export default function LinhaExtratoModal({ linha, onClose, onChanged }: Props) {
  const dia = String(linha.transaction_date).slice(0, 10);
  const {
    imports, rules, loading, refresh, updateImport, reconcile, unreconcile, motivoReabrir,
    findBillMatches, findReceivableMatches, createRule,
  } = useConciliacao(linha.bank_account_id ?? undefined, { from: dia, to: dia });
  const [reabrir, setReabrir] = useState<{ id: string; msg: string } | null>(null);
  const transacao = imports.find((i) => i.id === linha.id) ?? null;

  if (!transacao) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl p-5 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-zinc-600">
            {loading || !linha.bank_account_id ? 'Abrindo o pagamento…' : 'Não encontrei esta linha do extrato. Abra pela aba Conciliação.'}
          </p>
          <button onClick={onClose} className="mt-3 px-3 py-1.5 text-sm border border-zinc-300 rounded-lg cursor-pointer hover:bg-zinc-50">Fechar</button>
        </div>
      </div>
    );
  }

  const mudou = () => { refresh(); onChanged(); };

  return (
    <>
      <TransacaoDetalheModal
        transaction={transacao}
        rules={rules}
        onClose={onClose}
        onUpdate={async (id, up) => { const ok = await updateImport(id, up); if (ok) onChanged(); return ok; }}
        onReconcile={async (id) => { const ok = await reconcile(id); if (ok) onChanged(); return ok; }}
        onUnreconcile={async (id) => {
          setReabrir({ id, msg: motivoReabrir(id) ?? 'O pagamento volta a pendente. Nenhum lançamento é apagado.' });
          return true;
        }}
        onCreateRule={async (pattern, category, costCenterId, txType) => createRule({
          pattern, match_type: 'contains', category: category || undefined, cost_center_id: costCenterId || undefined,
          transaction_type: txType === 'credit' ? 'credit' : 'debit', description_template: undefined, is_active: true,
        })}
        findBillMatches={findBillMatches}
        findReceivableMatches={findReceivableMatches}
        onChanged={mudou}
      />
      <ConfirmModal
        isOpen={!!reabrir}
        icon="ri-arrow-go-back-line"
        danger
        title="Reabrir este pagamento?"
        message={reabrir?.msg ?? ''}
        confirmLabel="Reabrir"
        onCancel={() => setReabrir(null)}
        onConfirm={async () => {
          if (reabrir && await unreconcile(reabrir.id)) mudou();
          setReabrir(null);
        }}
      />
    </>
  );
}
