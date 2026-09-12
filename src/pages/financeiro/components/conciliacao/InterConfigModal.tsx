import { useState, useEffect, useRef } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useBankAccounts } from '@/hooks/useFinanceiro';
import { formatCurrency } from '@/lib/formatters';

// Configuração da integração com o Banco Inter (API Banking, conta PJ).
// Segredos (client_secret, certificado, chave) só sobem para a Edge `inter-bank`;
// o get_config devolve apenas o client_id mascarado e flags.

export interface InterConfig {
  id: string;
  bank_account_id?: string | null;
  environment: 'production' | 'sandbox';
  client_id_masked: string;
  conta_corrente?: string | null;
  is_active: boolean;
  auto_sync: boolean;
  sync_from: string;
  has_cert: boolean;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  last_balance?: number | null;
  last_balance_at?: string | null;
  // Credencial própria de pagamento (integração do Inter com os escopos de pagamento)
  has_pay_credentials?: boolean;
  pay_client_id_masked?: string | null;
  pay_credentials_at?: string | null;
  pay_source?: string | null;
  pay_limit_tx?: number | null;
  pay_limit_day?: number | null;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

type Resp = { success?: boolean; error?: string; balance?: number; config?: InterConfig | null };

function defaultSyncFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export default function InterConfigModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { accounts: bankAccounts } = useBankAccounts();
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<InterConfig | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [contaCorrente, setContaCorrente] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'sandbox'>('production');
  const [bankAccountId, setBankAccountId] = useState('');
  const [syncFrom, setSyncFrom] = useState(defaultSyncFrom());
  const [autoSync, setAutoSync] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const certRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  // Credencial de pagamento
  const [payClientId, setPayClientId] = useState('');
  const [paySecret, setPaySecret] = useState('');
  const [payCert, setPayCert] = useState('');
  const [payKey, setPayKey] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const [payResult, setPayResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const payCertRef = useRef<HTMLInputElement>(null);
  const payKeyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const resp = await invokeWithAuth<Resp>('inter-bank', { body: { action: 'get_config', tenant_id: user?.tenantId } });
      const cfg = resp.data?.config ?? null;
      setExisting(cfg);
      if (cfg) {
        setEnvironment(cfg.environment);
        setBankAccountId(cfg.bank_account_id ?? '');
        setContaCorrente(cfg.conta_corrente ?? '');
        setSyncFrom(cfg.sync_from ?? defaultSyncFrom());
        setAutoSync(cfg.auto_sync !== false);
      }
      setLoading(false);
    })();
  }, [user?.tenantId]);

  const readFile = (file: File | undefined, setter: (v: string) => void) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const credsBody = () => ({
    tenant_id: user?.tenantId,
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
    cert_pem: certPem,
    key_pem: keyPem,
    conta_corrente: contaCorrente.trim(),
    environment,
  });

  const validate = (forSave: boolean) => {
    if (!existing && (!clientId.trim() || !clientSecret.trim() || !certPem.trim() || !keyPem.trim())) {
      setResult({ ok: false, msg: 'Preencha client_id, client_secret, certificado e chave privada.' });
      return false;
    }
    if (forSave && !bankAccountId) {
      setResult({ ok: false, msg: 'Selecione a conta bancária do ERP que representa a conta do Inter.' });
      return false;
    }
    return true;
  };

  const handleTest = async () => {
    if (!validate(false)) return;
    setTesting(true);
    setResult(null);
    const resp = await invokeWithAuth<Resp>('inter-bank', { body: { action: 'test_config', ...credsBody() } });
    setTesting(false);
    const err = resp.error?.message ?? resp.data?.error;
    if (err || !resp.data?.success) setResult({ ok: false, msg: err || 'Falha ao conectar no Inter.' });
    else setResult({ ok: true, msg: `Conectado! Saldo disponível hoje: ${formatCurrency(Number(resp.data.balance ?? 0))}` });
  };

  const handleSave = async () => {
    if (!validate(true)) return;
    setSaving(true);
    setResult(null);
    const resp = await invokeWithAuth<Resp>('inter-bank', {
      body: { action: 'save_config', ...credsBody(), bank_account_id: bankAccountId, sync_from: syncFrom, auto_sync: autoSync },
    });
    setSaving(false);
    const err = resp.error?.message ?? resp.data?.error;
    if (err || !resp.data?.success) {
      setResult({ ok: false, msg: err || 'Erro ao salvar configuração.' });
      return;
    }
    setResult({ ok: true, msg: `Configuração salva. Saldo disponível: ${formatCurrency(Number(resp.data.balance ?? 0))}` });
    setTimeout(() => { onSaved(); onClose(); }, 1200);
  };

  const handleRemove = async () => {
    if (!existing) return;
    if (!window.confirm('Remover a integração com o Banco Inter? As linhas já importadas continuam na conciliação.')) return;
    setRemoving(true);
    const resp = await invokeWithAuth<Resp>('inter-bank', { body: { action: 'delete_config', tenant_id: user?.tenantId } });
    setRemoving(false);
    if (resp.error || resp.data?.error) { setResult({ ok: false, msg: resp.error?.message ?? resp.data?.error ?? 'Erro ao remover.' }); return; }
    onSaved();
    onClose();
  };

  const reloadConfig = async () => {
    const resp = await invokeWithAuth<Resp>('inter-bank', { body: { action: 'get_config', tenant_id: user?.tenantId } });
    setExisting(resp.data?.config ?? null);
  };

  const handleSavePay = async () => {
    const has = existing?.has_pay_credentials;
    if (!has && (!payClientId.trim() || !paySecret.trim() || !payCert.trim() || !payKey.trim())) {
      setPayResult({ ok: false, msg: 'Preencha o Client ID, o Client Secret e carregue o .crt e o .key da integração de pagamento.' });
      return;
    }
    setPaySaving(true);
    setPayResult(null);
    const resp = await invokeWithAuth<Resp & { granted_scope?: string | null }>('inter-bank', {
      body: { action: 'save_pay_credentials', tenant_id: user?.tenantId, client_id: payClientId.trim(), client_secret: paySecret.trim(), cert_pem: payCert, key_pem: payKey },
    });
    setPaySaving(false);
    const err = resp.error?.message ?? resp.data?.error;
    if (err || !resp.data?.success) { setPayResult({ ok: false, msg: err || 'Erro ao salvar a credencial de pagamento.' }); return; }
    setPayResult({ ok: true, msg: 'Credencial de pagamento validada no Inter e salva. O assistente já pode preparar pagamentos.' });
    setPayClientId(''); setPaySecret(''); setPayCert(''); setPayKey('');
    await reloadConfig();
  };

  const handleRemovePay = async () => {
    if (!window.confirm('Remover a credencial de pagamento? O assistente deixa de conseguir pagar pelo Inter.')) return;
    setPaySaving(true);
    const resp = await invokeWithAuth<Resp>('inter-bank', { body: { action: 'delete_pay_credentials', tenant_id: user?.tenantId } });
    setPaySaving(false);
    if (resp.error || resp.data?.error) { setPayResult({ ok: false, msg: resp.error?.message ?? resp.data?.error ?? 'Erro ao remover.' }); return; }
    setPayResult({ ok: true, msg: 'Credencial de pagamento removida.' });
    await reloadConfig();
  };

  const inputCls = 'w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-orange-100">
              <i className="ri-bank-line text-orange-600 text-lg" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Banco Inter — API Banking</h3>
              <p className="text-xs text-zinc-500">Extrato e saldo automáticos da conta PJ</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-5 overflow-y-auto">
            {existing && (
              <div className={`flex items-start gap-2 px-3 py-2 rounded-xl border ${existing.last_sync_error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <i className={`${existing.last_sync_error ? 'ri-error-warning-fill text-red-600' : 'ri-checkbox-circle-fill text-green-600'} mt-0.5`} />
                <div className="flex-1 text-xs">
                  <p className={`font-semibold ${existing.last_sync_error ? 'text-red-700' : 'text-green-700'}`}>
                    Integração configurada · client_id {existing.client_id_masked} · {existing.environment === 'sandbox' ? 'Sandbox' : 'Produção'}
                  </p>
                  {existing.last_sync_at && <p className="text-zinc-600">Última sincronização: {new Date(existing.last_sync_at).toLocaleString('pt-BR')}</p>}
                  {existing.last_balance != null && <p className="text-zinc-600">Saldo disponível: <strong>{formatCurrency(Number(existing.last_balance))}</strong></p>}
                  {existing.last_sync_error && <p className="text-red-700 mt-1">Último erro: {existing.last_sync_error}</p>}
                </div>
              </div>
            )}

            <div className="bg-zinc-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
                <i className="ri-information-line text-zinc-400" /> Como gerar as credenciais no Inter
              </p>
              <ol className="space-y-1.5 text-xs text-zinc-600 list-decimal pl-4">
                <li>No <strong>Internet Banking PJ</strong>, abra <strong>Soluções para sua empresa › Nova Integração</strong>.</li>
                <li>Marque o escopo <strong>Extrato (leitura)</strong>. Saldo vem junto com o escopo de extrato.</li>
                <li>Baixe o <strong>certificado (.crt)</strong> e a <strong>chave (.key)</strong> e anote o <strong>Client ID</strong> e o <strong>Client Secret</strong>.</li>
                <li>Cole ou carregue os arquivos abaixo e clique em <strong>Testar conexão</strong>.</li>
              </ol>
              <p className="text-[11px] text-zinc-400">O certificado tem validade de 1 ano. Quando expirar, gere outro no Inter e atualize aqui.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Client ID {!existing && <span className="text-red-500">*</span>}</label>
                <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={existing ? existing.client_id_masked : 'ex.: 3f1a…'} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Client Secret {!existing && <span className="text-red-500">*</span>}</label>
                <div className="relative">
                  <input type={showSecret ? 'text' : 'password'} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={existing ? '•••••••••••• (manter)' : 'cole aqui'} className={`${inputCls} pr-10 font-mono`} />
                  <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer">
                    <i className={showSecret ? 'ri-eye-off-line' : 'ri-eye-line'} />
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-zinc-700">Certificado (.crt) {!existing && <span className="text-red-500">*</span>}</label>
                  <input ref={certRef} type="file" accept=".crt,.pem,.cer" className="hidden" onChange={(e) => readFile(e.target.files?.[0], setCertPem)} />
                  <button type="button" onClick={() => certRef.current?.click()} className="text-[11px] text-orange-600 hover:underline cursor-pointer"><i className="ri-upload-2-line" /> Carregar arquivo</button>
                </div>
                <textarea value={certPem} onChange={(e) => setCertPem(e.target.value)} rows={4} placeholder={existing?.has_cert ? '(certificado já salvo — cole só para trocar)' : '-----BEGIN CERTIFICATE-----'} className={`${inputCls} font-mono text-[11px]`} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-zinc-700">Chave privada (.key) {!existing && <span className="text-red-500">*</span>}</label>
                  <input ref={keyRef} type="file" accept=".key,.pem" className="hidden" onChange={(e) => readFile(e.target.files?.[0], setKeyPem)} />
                  <button type="button" onClick={() => keyRef.current?.click()} className="text-[11px] text-orange-600 hover:underline cursor-pointer"><i className="ri-upload-2-line" /> Carregar arquivo</button>
                </div>
                <textarea value={keyPem} onChange={(e) => setKeyPem(e.target.value)} rows={4} placeholder={existing?.has_cert ? '(chave já salva — cole só para trocar)' : '-----BEGIN PRIVATE KEY-----'} className={`${inputCls} font-mono text-[11px]`} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Ambiente</label>
                <select value={environment} onChange={(e) => setEnvironment(e.target.value as 'production' | 'sandbox')} className={`${inputCls} bg-white`}>
                  <option value="production">Produção</option>
                  <option value="sandbox">Sandbox (testes)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Conta corrente <span className="text-zinc-400 font-normal">(opcional)</span></label>
                <input type="text" value={contaCorrente} onChange={(e) => setContaCorrente(e.target.value)} placeholder="só se houver mais de uma" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Buscar extrato desde</label>
                <input type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Conta bancária do ERP que representa a conta do Inter <span className="text-red-500">*</span></label>
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">Selecione uma conta...</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} {a.bank_name ? `(${a.bank_name})` : ''}</option>
                ))}
              </select>
              <p className="text-xs text-zinc-400 mt-1">O extrato entra na conciliação desta conta e o saldo real do Inter passa a ser o saldo inicial da projeção de caixa. Cadastre a conta em <strong>Bancos e Contas</strong> se ainda não existir.</p>
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} className="rounded" />
              Atualizar o extrato sempre que alguém abrir a Conciliação
            </label>

            {existing && (
              <div className="border border-violet-200 rounded-xl p-4 space-y-3 bg-violet-50/40">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-800 flex items-center gap-1.5"><i className="ri-secure-payment-line text-violet-600" /> Credencial de pagamento <span className="text-zinc-400 font-normal text-xs">(opcional)</span></p>
                    <p className="text-xs text-zinc-500 mt-0.5">Use se você criou no Inter uma integração separada com os escopos de <strong>Pagamentos</strong> (boleto e Pix). Ela é usada só pelo assistente para pagar, sempre com PIN e aprovação no app do Inter.</p>
                  </div>
                  {existing.has_pay_credentials && (
                    <span className="text-[11px] px-2 py-1 rounded-full bg-green-100 text-green-700 font-semibold whitespace-nowrap"><i className="ri-checkbox-circle-fill" /> Salva · {existing.pay_client_id_masked}</span>
                  )}
                </div>
                {existing.has_pay_credentials && existing.pay_credentials_at && (
                  <p className="text-[11px] text-zinc-500">Validada em {new Date(existing.pay_credentials_at).toLocaleString('pt-BR')}{existing.pay_limit_tx != null ? ` · limite ${formatCurrency(Number(existing.pay_limit_tx))} por pagamento e ${formatCurrency(Number(existing.pay_limit_day ?? 0))} por dia` : ''}. Preencha abaixo só para trocar.</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={payClientId} onChange={(e) => setPayClientId(e.target.value)} placeholder={existing.has_pay_credentials ? `Client ID (${existing.pay_client_id_masked})` : 'Client ID da integração de pagamento'} className={`${inputCls} font-mono`} />
                  <input type="password" value={paySecret} onChange={(e) => setPaySecret(e.target.value)} placeholder={existing.has_pay_credentials ? 'Client Secret (manter)' : 'Client Secret'} className={`${inputCls} font-mono`} autoComplete="new-password" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input ref={payCertRef} type="file" accept=".crt,.pem,.cer" className="hidden" onChange={(e) => readFile(e.target.files?.[0], setPayCert)} />
                    <button type="button" onClick={() => payCertRef.current?.click()} className={`w-full px-3 py-2.5 rounded-lg text-xs font-semibold border cursor-pointer ${payCert ? 'border-green-300 bg-green-50 text-green-700' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}>
                      <i className={payCert ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} /> {payCert ? 'Certificado (.crt) carregado' : 'Carregar certificado (.crt)'}
                    </button>
                  </div>
                  <div>
                    <input ref={payKeyRef} type="file" accept=".key,.pem" className="hidden" onChange={(e) => readFile(e.target.files?.[0], setPayKey)} />
                    <button type="button" onClick={() => payKeyRef.current?.click()} className={`w-full px-3 py-2.5 rounded-lg text-xs font-semibold border cursor-pointer ${payKey ? 'border-green-300 bg-green-50 text-green-700' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}>
                      <i className={payKey ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} /> {payKey ? 'Chave (.key) carregada' : 'Carregar chave (.key)'}
                    </button>
                  </div>
                </div>
                {payResult && (
                  <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium ${payResult.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    <i className={`${payResult.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} mt-0.5`} />
                    <span className="break-words">{payResult.msg}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {existing.has_pay_credentials && (
                    <button onClick={handleRemovePay} disabled={paySaving} className="px-3 py-2 text-xs text-red-600 hover:bg-red-50 rounded-lg cursor-pointer disabled:opacity-50">Remover credencial</button>
                  )}
                  <div className="flex-1" />
                  <button onClick={handleSavePay} disabled={paySaving} className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-700 cursor-pointer whitespace-nowrap disabled:opacity-50">
                    {paySaving ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Validando no Inter...</> : <><i className="ri-shield-check-line" /> Validar e salvar credencial de pagamento</>}
                  </button>
                </div>
              </div>
            )}

            {result && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${result.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                <i className={`${result.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
                <span className="break-words">{result.msg}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button onClick={handleTest} disabled={testing || saving} className="flex items-center gap-2 px-4 py-2.5 border border-zinc-200 text-zinc-600 rounded-lg text-sm font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap disabled:opacity-50">
                {testing ? <><div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" /> Testando...</> : <><i className="ri-wifi-line" /> Testar conexão</>}
              </button>
              {existing && (
                <button onClick={handleRemove} disabled={removing || saving} className="px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50">
                  {removing ? 'Removendo...' : 'Remover integração'}
                </button>
              )}
              <div className="flex-1" />
              <button onClick={onClose} className="px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap">Cancelar</button>
              <button onClick={handleSave} disabled={saving || testing} className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 cursor-pointer whitespace-nowrap disabled:opacity-50">
                {saving ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Salvando...</> : <><i className="ri-save-line" /> Salvar e conectar</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
