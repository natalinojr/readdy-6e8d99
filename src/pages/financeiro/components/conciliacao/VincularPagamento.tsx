import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import type { StatementImport } from '@/hooks/useConciliacao';

// "Este pagamento é de…" (2026-09-20). O casamento automático usa CNPJ + valor + data: Pix ao gerente,
// ao dono ou a uma razão social diferente da nota nunca casava e não havia como dizer à mão.
// Aqui o usuário escolhe a conta a pagar ou a nota e, marcando "lembrar", o próximo pagamento a essa
// mesma pessoa já casa sozinho (apelido em fin_counterpart_aliases).
// Edge conciliacao-pagamentos › link_search / link_manual.

interface Opcao {
  kind: 'payable' | 'inbound_doc';
  ref_id: string;
  parcela: string | null;
  label: string;
  fornecedor: string | null;
  fornecedor_doc?: string | null;
  valor: number;
  vencimento: string | null;
  emissao?: string | null;
  diferenca: number;
  servico?: boolean;
}

const dataBR = (iso?: string | null) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—');
const fmtDoc = (d?: string | null) => {
  const x = String(d ?? '');
  if (/^\d{14}$/.test(x)) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (/^\d{11}$/.test(x)) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return x;
};

export function podeVincular(s: StatementImport) {
  return s.transaction_type === 'debit' && s.status === 'pending' && !s.reconciled;
}

export default function VincularPagamento({ transaction, onDone }: { transaction: StatementImport; onDone: () => void }) {
  const { user } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [opcoes, setOpcoes] = useState<Opcao[] | null>(null);
  const [escolha, setEscolha] = useState<Opcao | null>(null);
  const [lembrar, setLembrar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const quem = transaction.counterpart_name || transaction.description || 'quem recebeu';

  useEffect(() => { setAberto(false); setOpcoes(null); setEscolha(null); setBusca(''); setErro(null); }, [transaction.id]);

  const buscar = useCallback(async (q: string) => {
    if (!user?.tenantId) return;
    setBusy(true); setErro(null);
    const r = await invokeWithAuth<{ opcoes?: Opcao[]; error?: string }>('conciliacao-pagamentos', {
      body: { action: 'link_search', tenant_id: user.tenantId, id: transaction.id, q },
    });
    setBusy(false);
    const e = r.data?.error ?? r.error?.message;
    if (e) { setErro(e); return; }
    setOpcoes((r.data?.opcoes ?? []).map((o) => ({ ...o, valor: Number(o.valor), diferenca: Number(o.diferenca) })));
  }, [user?.tenantId, transaction.id]);

  useEffect(() => { if (aberto && opcoes === null) buscar(''); }, [aberto, opcoes, buscar]);

  const vincular = async () => {
    if (!user?.tenantId || !escolha) return;
    setBusy(true); setErro(null);
    const r = await invokeWithAuth<{ results?: Array<{ ok: boolean; msg: string }>; lembrou?: { n: number; nome: string | null } | null; error?: string }>('conciliacao-pagamentos', {
      body: {
        action: 'link_manual', tenant_id: user.tenantId, id: transaction.id, lembrar,
        alvo: { kind: escolha.kind, ref_id: escolha.ref_id, parcela: escolha.parcela },
      },
    });
    setBusy(false);
    const res = r.data?.results?.[0];
    const e = r.data?.error ?? r.error?.message ?? (res && !res.ok ? res.msg : null);
    if (e) { setErro(e); return; }
    onDone();
  };

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-sky-300 bg-sky-50/50 text-left hover:bg-sky-50 cursor-pointer">
        <i className="ri-links-line text-sky-600 text-lg" />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-sky-800">Este pagamento é de…</span>
          <span className="block text-xs text-sky-600">Escolha a conta a pagar ou a nota, mesmo que o nome de quem recebeu seja outro.</span>
        </span>
      </button>
    );
  }

  return (
    <div className="border border-sky-200 rounded-xl p-3 space-y-3 bg-sky-50/40">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-sky-800"><i className="ri-links-line mr-1" />Este pagamento é de…</p>
        <button onClick={() => setAberto(false)} className="text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer">Cancelar</button>
      </div>

      <div className="flex items-center gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') buscar(busca); }}
          placeholder="Buscar por fornecedor ou número da nota…"
          className="flex-1 px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-300" />
        <button onClick={() => buscar(busca)} disabled={busy}
          className="px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer">
          {busy ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
        {opcoes === null ? (
          <p className="px-3 py-3 text-xs text-zinc-400">Carregando…</p>
        ) : opcoes.length === 0 ? (
          <p className="px-3 py-3 text-xs text-zinc-400">Nenhuma conta em aberto nem nota sem lançar para esse período.</p>
        ) : opcoes.map((o) => {
          const sel = escolha?.ref_id === o.ref_id && escolha?.parcela === o.parcela;
          return (
            <button key={o.kind + o.ref_id + (o.parcela ?? '')} onClick={() => setEscolha(o)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer ${sel ? 'bg-sky-50' : 'hover:bg-zinc-50'}`}>
              <i className={`${o.kind === 'inbound_doc' ? 'ri-file-text-line' : 'ri-bill-line'} ${sel ? 'text-sky-600' : 'text-zinc-400'}`} />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-medium text-zinc-800 truncate">{o.label}</span>
                <span className="block text-[11px] text-zinc-500">
                  {o.kind === 'inbound_doc' ? 'Nota não lançada' : 'Conta a pagar'}
                  {o.parcela ? ` · parcela ${o.parcela}` : ''}
                  {o.vencimento ? ` · vence ${dataBR(o.vencimento)}` : o.emissao ? ` · emitida ${dataBR(o.emissao)}` : ''}
                </span>
              </span>
              <span className="text-right flex-shrink-0">
                <span className="block text-xs font-bold text-zinc-800">{formatCurrency(o.valor)}</span>
                {Math.abs(o.diferenca) > 0.005 && (
                  <span className={`block text-[11px] ${o.diferenca < 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
                    {o.diferenca < 0 ? `pagou R$ ${Math.abs(o.diferenca).toFixed(2).replace('.', ',')} a mais` : `falta R$ ${o.diferenca.toFixed(2).replace('.', ',')}`}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {escolha && (
        <>
          <p className="text-xs text-zinc-600">
            {escolha.kind === 'inbound_doc'
              ? `A nota é lançada agora como ${escolha.servico ? 'despesa (serviço)' : 'compra'} e a parcela recebe a baixa na data deste pagamento.`
              : 'A parcela recebe a baixa na data deste pagamento.'}
            {escolha.diferenca < -0.005 && ' A diferença paga a mais vira juros/multa.'}
            {escolha.diferenca > 0.005 && ' A diferença a menos fica em aberto na conta (ou vira desconto, se for boleto).'}
          </p>
          <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
            <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} className="mt-0.5" />
            <span>
              <b>Lembrar:</b> {quem}{transaction.counterpart_doc ? ` (${fmtDoc(transaction.counterpart_doc)})` : ''} recebe pelo fornecedor <b>{escolha.fornecedor ?? escolha.label}</b>.
              Os próximos pagamentos a essa pessoa passam a casar sozinhos com as notas desse fornecedor.
            </span>
          </label>
        </>
      )}

      {erro && <p className="text-xs text-red-600">{erro}</p>}

      <button onClick={vincular} disabled={busy || !escolha}
        className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 cursor-pointer">
        {busy ? 'Vinculando…' : 'Vincular e dar baixa'}
      </button>
    </div>
  );
}
