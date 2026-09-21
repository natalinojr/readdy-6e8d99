import { useState, useEffect } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useBankAccounts } from '@/hooks/useFinanceiro';

// Conciliação do Mercado Pago. Diferente da Stone, aqui NÃO se digita credencial: o Access
// Token sai da maquininha já configurada em Configurações › Formas de pagamento (mesma conta
// do Mercado Pago que cobra no autoatendimento). Aqui se escolhe só o papel de cada coisa.

interface MpConfig {
  configured: boolean;
  bank_account_id: string | null;
  token_provider: 'mp_point' | 'mercadopago';
  is_active: boolean;
  auto_sync: boolean;
  post_to_ledger: boolean;
  release_report: boolean;
  release_prefix: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  token_ready: boolean | null;
  token_environment: string | null;
  token_label: string | null;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

type Resp = { success?: boolean; error?: string; config?: MpConfig | null; schedule?: { error?: string } | null };

export default function MpConfigModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { accounts: bankAccounts } = useBankAccounts();
  const [bankAccountId, setBankAccountId] = useState('');
  const [tokenProvider, setTokenProvider] = useState<'mp_point' | 'mercadopago'>('mp_point');
  const [autoSync, setAutoSync] = useState(true);
  const [postToLedger, setPostToLedger] = useState(false);
  const [releaseReport, setReleaseReport] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; details?: string } | null>(null);
  const [existing, setExisting] = useState<MpConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const resp = await invokeWithAuth<Resp>('mp-conciliation', { body: { action: 'get_config', tenant_id: user?.tenantId } });
      const cfg = resp.data?.config ?? null;
      if (cfg) {
        setExisting(cfg);
        setBankAccountId(cfg.bank_account_id || '');
        setTokenProvider(cfg.token_provider === 'mercadopago' ? 'mercadopago' : 'mp_point');
        setAutoSync(cfg.auto_sync !== false);
        setPostToLedger(cfg.post_to_ledger === true);
        setReleaseReport(cfg.release_report !== false);
      }
      setLoading(false);
    })();
  }, [user?.tenantId]);

  const handleSave = async () => {
    if (!bankAccountId) { setResult({ ok: false, msg: 'Escolha a conta onde o extrato do Mercado Pago será gravado.' }); return; }
    setSaving(true);
    setResult(null);
    const resp = await invokeWithAuth<Resp>('mp-conciliation', {
      body: {
        action: 'save_config', tenant_id: user?.tenantId,
        bank_account_id: bankAccountId, token_provider: tokenProvider,
        auto_sync: autoSync, post_to_ledger: postToLedger, release_report: releaseReport,
      },
    });
    setSaving(false);
    const err = resp.error?.message ?? resp.data?.error;
    if (err || !resp.data?.success) { setResult({ ok: false, msg: err || 'Erro ao salvar configuração.' }); return; }
    // programar o relatório no painel do MP pode falhar sozinho: o resto já está salvo
    const schedErr = resp.data.schedule?.error;
    setResult({
      ok: true,
      msg: 'Configuração salva e token validado no Mercado Pago.',
      details: schedErr ? `Atenção: não foi possível programar o Relatório de Liberações automaticamente (${schedErr}). Programe em Relatórios e faturamento › Liberações, ou use o botão "Pedir relatório" na tela de integrações.` : undefined,
    });
    setTimeout(() => { onSaved(); onClose(); }, schedErr ? 6000 : 1500);
  };

  const handleRemove = async () => {
    if (!window.confirm('Remover a conciliação do Mercado Pago? As linhas já importadas continuam na conciliação.')) return;
    setRemoving(true);
    const resp = await invokeWithAuth<Resp>('mp-conciliation', { body: { action: 'delete_config', tenant_id: user?.tenantId } });
    setRemoving(false);
    if (resp.error || resp.data?.error) { setResult({ ok: false, msg: resp.error?.message ?? resp.data?.error ?? 'Erro ao remover.' }); return; }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-sky-100">
              <i className="ri-bank-card-line text-sky-600 text-lg" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Conciliação Mercado Pago</h3>
              <p className="text-xs text-zinc-500">Vendas, taxa real por venda e saques da maquininha</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-5 overflow-y-auto">
            {existing && (
              <div className={`flex items-start gap-2 px-3 py-2 rounded-xl border ${existing.last_sync_error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <i className={`${existing.last_sync_error ? 'ri-error-warning-fill text-red-600' : 'ri-checkbox-circle-fill text-green-600'} mt-0.5`} />
                <div className="flex-1 text-xs">
                  <p className={`font-semibold ${existing.last_sync_error ? 'text-red-700' : 'text-green-700'}`}>Conciliação configurada</p>
                  {existing.last_sync_at && <p className="text-zinc-600">Última sincronização: {new Date(existing.last_sync_at).toLocaleString('pt-BR')}</p>}
                  {existing.last_sync_error && <p className="text-red-700 mt-1">Último erro: {existing.last_sync_error}</p>}
                </div>
              </div>
            )}

            <div className="bg-zinc-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
                <i className="ri-information-line text-zinc-400" /> Não precisa de credencial nova
              </p>
              <p className="text-xs text-zinc-600">
                O acesso é o mesmo Access Token da maquininha, cadastrado em <strong>Configurações › Formas de pagamento</strong>. Se a maquininha ainda não estiver configurada lá, configure primeiro.
              </p>
              <p className="text-[11px] text-zinc-400">
                As vendas entram por dia (com a taxa real de cada venda, a bandeira e as parcelas) e o extrato da conta do Mercado Pago vem do Relatório de Liberações — é o que permite casar o saque com o crédito no banco.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Token do Mercado Pago <span className="text-red-500">*</span></label>
              <div className="space-y-2">
                {([
                  { v: 'mp_point' as const, label: 'Maquininha Point (autoatendimento)', hint: 'O mais comum: mesma conta que cobra na maquininha.' },
                  { v: 'mercadopago' as const, label: 'Pagamento online (Pix pelo celular)', hint: 'Use se a maquininha estiver em outra conta e as vendas de cartão caírem na conta do pagamento online.' },
                ]).map((o) => (
                  <label key={o.v} className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border cursor-pointer ${tokenProvider === o.v ? 'border-sky-300 bg-sky-50' : 'border-zinc-200 hover:bg-zinc-50'}`}>
                    <input type="radio" name="mp-token" checked={tokenProvider === o.v} onChange={() => setTokenProvider(o.v)} className="mt-0.5" />
                    <span className="text-xs">
                      <span className="font-semibold text-zinc-800">{o.label}</span>
                      <span className="block text-zinc-500 mt-0.5">{o.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {existing?.token_label && (
                <p className="text-[11px] text-zinc-400 mt-1.5">Conta atual: {existing.token_label}{existing.token_environment === 'sandbox' ? ' · ambiente de teste' : ''}</p>
              )}
              {existing && existing.token_ready === false && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1.5">
                  <i className="ri-error-warning-line" /> A maquininha desta loja está sem token ativo. Configure em Configurações › Formas de pagamento antes de salvar.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Conta onde o extrato do Mercado Pago será gravado <span className="text-red-500">*</span></label>
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white">
                <option value="">Selecione uma conta...</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} {a.bank_name ? `(${a.bank_name})` : ''}</option>
                ))}
              </select>
              <p className="text-xs text-zinc-400 mt-1">
                Crie uma conta chamada <strong>Mercado Pago</strong> em Contas bancárias: é o saldo que fica no Mercado Pago. Cada venda liberada e cada saque viram linhas nela. O crédito do saque no banco principal (ex.: Inter) é casado sozinho.
              </p>
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} className="rounded" />
              Buscar as vendas que faltam sempre que alguém abrir a Conciliação
            </label>

            <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={releaseReport} onChange={(e) => setReleaseReport(e.target.checked)} className="rounded mt-0.5" />
              <span>
                Baixar o <strong>Relatório de Liberações</strong> do Mercado Pago (traz os saques, disputas e contracargos).
                <span className="block text-zinc-400 mt-0.5">Ao salvar, o relatório diário é programado na conta do Mercado Pago. Sem ele, as vendas entram normalmente, mas o saque que cai no banco fica como crédito sem contraparte.</span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={postToLedger} onChange={(e) => setPostToLedger(e.target.checked)} className="rounded mt-0.5" />
              <span>
                Lançar no financeiro as vendas em cartão e as taxas de cada dia liberado pelo Mercado Pago (entram na DRE e no Fluxo de Caixa).
                <span className="block text-zinc-400 mt-0.5">Use só enquanto as vendas de cartão não forem registradas pelo caixa do ERP, senão a receita conta duas vezes. Vale para as próximas importações: reimporte o período para lançar os dias anteriores. Desligar remove os lançamentos feitos por aqui.</span>
              </span>
            </label>

            {result && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${result.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                <i className={`${result.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
                <div className="break-words">
                  <p>{result.msg}</p>
                  {result.details && <p className="opacity-80 mt-0.5">{result.details}</p>}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              {existing && (
                <button onClick={handleRemove} disabled={removing || saving} className="px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50">
                  {removing ? 'Removendo...' : 'Remover'}
                </button>
              )}
              <div className="flex-1" />
              <button onClick={onClose} className="px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap">Cancelar</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 cursor-pointer whitespace-nowrap disabled:opacity-50">
                {saving ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Validando no Mercado Pago...</> : <><i className="ri-save-line" /> Salvar e validar</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
