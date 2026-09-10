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
              Sincronizar automaticamente de hora em hora (06h–23h)
            </label>

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
