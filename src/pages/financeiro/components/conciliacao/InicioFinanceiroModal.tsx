import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';

// "Meu financeiro começa em MM/AAAA" (2026-09-19). Loja que chega com meses atrasados fecha o passado
// de uma vez: o que está PENDENTE (extrato, conta em aberto, nota da SEFAZ não lançada) é encerrado com
// uma marca; o que já está feito não é tocado. Reversível pelo "Reabrir".
// Edge conciliacao-pagamentos › periodo_preview / periodo_fechar / periodo_reabrir.

interface Preview {
  inicio: string;
  extrato: { n: number; saidas: number; entradas: number };
  contas: { n: number; total: number };
  notas: { n: number; total: number };
}
interface Props {
  /** 'YYYY-MM-DD' do corte atual (fin_revenue_settings.financeiro_inicio) ou null */
  atual: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const mesBR = (iso: string) => iso.slice(5, 7) + '/' + iso.slice(0, 4);
const mesAtual = () => new Date().toISOString().slice(0, 7);

export default function InicioFinanceiroModal({ atual, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const [mes, setMes] = useState(atual ? atual.slice(0, 7) : mesAtual());
  const [prev, setPrev] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!user?.tenantId || !/^\d{4}-\d{2}$/.test(mes)) return;
    setBusy(true); setErro(null);
    const r = await invokeWithAuth<{ preview?: Preview; error?: string }>('conciliacao-pagamentos', {
      body: { action: 'periodo_preview', tenant_id: user.tenantId, inicio: mes },
    });
    setBusy(false);
    const e = r.data?.error ?? r.error?.message;
    if (e) { setErro(e); return; }
    setPrev(r.data?.preview ?? null);
  }, [user?.tenantId, mes]);

  useEffect(() => { if (!atual) carregar(); }, [carregar, atual]);

  const fechar = async () => {
    if (!user?.tenantId) return;
    setBusy(true); setErro(null);
    const r = await invokeWithAuth<{ extrato?: number; contas?: number; notas?: number; error?: string }>('conciliacao-pagamentos', {
      body: { action: 'periodo_fechar', tenant_id: user.tenantId, inicio: mes },
    });
    setBusy(false);
    const e = r.data?.error ?? r.error?.message;
    if (e) { setErro(e); return; }
    setFeito(`Pronto: ${r.data?.extrato ?? 0} lançamento(s) do extrato, ${r.data?.contas ?? 0} conta(s) e ${r.data?.notas ?? 0} nota(s) ficaram fora. O financeiro começa em ${mesBR(mes + '-01')}.`);
    onSaved();
  };

  const reabrir = async () => {
    if (!user?.tenantId) return;
    setBusy(true); setErro(null);
    const r = await invokeWithAuth<{ extrato?: number; contas?: number; notas?: number; error?: string }>('conciliacao-pagamentos', {
      body: { action: 'periodo_reabrir', tenant_id: user.tenantId },
    });
    setBusy(false);
    const e = r.data?.error ?? r.error?.message;
    if (e) { setErro(e); return; }
    setFeito(`Período reaberto: ${r.data?.extrato ?? 0} lançamento(s) do extrato, ${r.data?.contas ?? 0} conta(s) e ${r.data?.notas ?? 0} nota(s) voltaram.`);
    onSaved();
  };

  const nada = prev && prev.extrato.n === 0 && prev.contas.n === 0 && prev.notas.n === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-100">
          <div>
            <h3 className="font-bold text-zinc-900 text-base">Meu financeiro começa em…</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Fecha o que ficou para trás e deixa a conciliação só com o que importa.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {feito ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <i className="ri-check-line mr-1" />{feito}
            </p>
          ) : atual ? (
            <>
              <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                <p className="text-sm font-semibold text-violet-800">
                  <i className="ri-calendar-check-line mr-1" />Seu financeiro começa em {mesBR(atual)}
                </p>
                <p className="text-xs text-violet-700 mt-1">
                  O que é anterior está fechado: não aparece nos alertas, nas pendências do chat nem como conta atrasada.
                  Nada do que já estava conciliado ou lançado foi alterado.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 p-3">
                <p className="text-sm font-semibold text-zinc-700">Mudou de ideia?</p>
                <p className="text-xs text-zinc-500 mt-1 mb-2">
                  Reabrir devolve os lançamentos, as contas e as notas que este corte fechou, do jeito que estavam.
                </p>
                <button onClick={reabrir} disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-50 cursor-pointer">
                  {busy ? 'Reabrindo…' : 'Reabrir período anterior'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">A partir de qual mês você quer cuidar do financeiro?</label>
                <div className="flex items-center gap-2">
                  <input type="month" value={mes} max={mesAtual()} onChange={(e) => { setMes(e.target.value); setPrev(null); }}
                    className="px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white" />
                  <button onClick={carregar} disabled={busy || !/^\d{4}-\d{2}$/.test(mes)}
                    className="px-3 py-2 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer">
                    {busy ? 'Conferindo…' : 'Ver o que será fechado'}
                  </button>
                </div>
              </div>

              {prev && (
                <div className="rounded-xl border border-zinc-200 overflow-hidden">
                  <p className="px-3 py-2 bg-zinc-50 text-xs font-semibold text-zinc-600">Fica para trás (antes de {mesBR(prev.inicio)})</p>
                  <div className="divide-y divide-zinc-100 text-sm">
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-zinc-600">Pagamentos e recebimentos do extrato sem destino</span>
                      <span className="font-semibold text-zinc-800">{prev.extrato.n}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-zinc-600">Contas a pagar em aberto</span>
                      <span className="font-semibold text-zinc-800">{prev.contas.n} · {formatCurrency(Number(prev.contas.total))}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-zinc-600">Notas da SEFAZ ainda não lançadas</span>
                      <span className="font-semibold text-zinc-800">{prev.notas.n} · {formatCurrency(Number(prev.notas.total))}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3 text-xs text-zinc-600 space-y-1">
                <p className="font-semibold text-zinc-700">O que NÃO muda:</p>
                <p>· pagamento já conciliado, nota já lançada, compra, classificação de item e vínculo com insumo continuam como estão;</p>
                <p>· nada é apagado e nenhum valor entra ou sai do caixa;</p>
                <p>· os meses anteriores continuam visíveis nos relatórios, se você escolher o período.</p>
                <p className="font-semibold text-zinc-700 pt-1">Dá para reabrir depois, com um clique.</p>
              </div>

              {erro && <p className="text-xs text-red-600">{erro}</p>}

              <button onClick={fechar} disabled={busy || !prev || !!nada}
                className="w-full px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 cursor-pointer">
                {busy ? 'Fechando…' : nada ? 'Não há nada pendente antes desse mês' : `Começar o financeiro em ${mes ? mesBR(mes + '-01') : ''}`}
              </button>
            </>
          )}
          {erro && feito === null && atual && <p className="text-xs text-red-600">{erro}</p>}
        </div>
      </div>
    </div>
  );
}
