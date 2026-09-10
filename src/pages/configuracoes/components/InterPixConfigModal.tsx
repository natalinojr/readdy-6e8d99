import { useState, useEffect } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

// ── Pix do autoatendimento pelo Banco Inter ─────────────────────────────────
// Credenciais da integração "Pix" do Inter (API Pix: emitir/consultar cobrança imediata e
// consultar Pix recebidos). Nada disso volta pro front: a Edge `pix-payment` só devolve o
// client_id mascarado. Salvar valida na hora pedindo um token ao Inter com o certificado.
// A integração de EXTRATO (Financeiro › Conciliação) é outra, com certificado próprio.

interface ConfigInfo {
  configured: boolean;
  is_active: boolean;
  client_id_masked: string | null;
  pix_key: string | null;
  conta_corrente: string | null;
  has_cert: boolean;
  cert_expires_at: string | null;
  last_test_at: string | null;
}

interface Props {
  onClose: () => void;
  onSaved?: (info: { is_active: boolean }) => void;
}

const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : null);

export default function InterPixConfigModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const tenantId = user?.tenantId ?? '';

  const [info, setInfo] = useState<ConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [certPem, setCertPem] = useState('');
  const [certNome, setCertNome] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [keyNome, setKeyNome] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [contaCorrente, setContaCorrente] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    invokeWithAuth<ConfigInfo>('pix-payment', { body: { action: 'get_inter_pix_config', tenant_id: tenantId } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) { setErro(error?.message || 'Erro ao carregar'); return; }
        setInfo(data);
        setAtivo(data.configured ? Boolean(data.is_active) : true);
        setPixKey(data.pix_key ?? '');
        setContaCorrente(data.conta_corrente ?? '');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const lerArquivo = async (file: File | undefined, set: (v: string) => void, setNome: (v: string) => void) => {
    if (!file) return;
    set(await file.text());
    setNome(file.name);
  };

  const salvar = async () => {
    if (!tenantId) return;
    setSaving(true);
    setErro('');
    const body: Record<string, unknown> = {
      action: 'save_inter_pix_config', tenant_id: tenantId, is_active: ativo,
      pix_key: pixKey.trim(), conta_corrente: contaCorrente.trim(),
    };
    if (clientId.trim()) body.client_id = clientId.trim();
    if (clientSecret.trim()) body.client_secret = clientSecret.trim();
    if (certPem.trim()) body.cert_pem = certPem;
    if (keyPem.trim()) body.key_pem = keyPem;
    const { data, error } = await invokeWithAuth<{ ok?: boolean; is_active: boolean; cert_expires_at: string | null }>('pix-payment', { body });
    setSaving(false);
    if (error || !data?.ok) { setErro(error?.message || 'Erro ao salvar'); return; }
    toastSuccess(data.is_active ? 'Pix do Inter ativado no autoatendimento' : 'Configuração salva');
    setClientId(''); setClientSecret(''); setCertPem(''); setCertNome(''); setKeyPem(''); setKeyNome('');
    setInfo(prev => ({
      configured: true, is_active: data.is_active, client_id_masked: prev?.client_id_masked ?? '••••',
      pix_key: pixKey.trim(), conta_corrente: contaCorrente.trim() || null, has_cert: true,
      cert_expires_at: data.cert_expires_at, last_test_at: new Date().toISOString(),
    }));
    onSaved?.({ is_active: data.is_active });
  };

  const testar = async () => {
    setTesting(true);
    setErro('');
    const { data, error } = await invokeWithAuth<{ ok: boolean }>('pix-payment', { body: { action: 'test_inter_pix_config', tenant_id: tenantId } });
    setTesting(false);
    if (error || !data?.ok) { toastError(error?.message || 'Falha no teste'); return; }
    toastSuccess('Conectado ao Banco Inter');
    setInfo(prev => prev ? { ...prev, last_test_at: new Date().toISOString() } : prev);
  };

  const venceEm = info?.cert_expires_at ? Math.ceil((new Date(info.cert_expires_at).getTime() - Date.now()) / 86400000) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white w-full max-w-lg rounded-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-orange-500 rounded-xl">
              <i className="ri-qr-code-line text-white text-lg" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Pix no autoatendimento (Banco Inter)</h2>
              <p className="text-[11px] text-zinc-400">Cobrança Pix no tablet · confirmada pelo banco</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="py-10 text-center"><i className="ri-loader-4-line text-2xl text-amber-500 animate-spin" /></div>
          ) : (
            <>
              {/* Status */}
              <div className={`rounded-xl p-3.5 border ${info?.is_active ? 'bg-emerald-50 border-emerald-200' : info?.configured ? 'bg-amber-50 border-amber-200' : 'bg-zinc-50 border-zinc-200'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className={`text-sm font-bold ${info?.is_active ? 'text-emerald-800' : info?.configured ? 'text-amber-800' : 'text-zinc-700'}`}>
                      {info?.is_active ? 'Ativo — o tablet cobra Pix pelo Inter' : info?.configured ? 'Configurado, mas desligado' : 'Não configurado'}
                    </p>
                    {info?.configured && (
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        Client ID {info.client_id_masked}{info.pix_key ? ` · chave ${info.pix_key}` : ''}
                        {info.cert_expires_at ? ` · certificado até ${fmtData(info.cert_expires_at)}` : ''}
                      </p>
                    )}
                  </div>
                  {info?.configured && (
                    <button onClick={testar} disabled={testing} className="px-3 py-1.5 text-xs font-semibold bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 cursor-pointer whitespace-nowrap disabled:opacity-50">
                      {testing ? 'Testando…' : 'Testar conexão'}
                    </button>
                  )}
                </div>
                {venceEm !== null && venceEm <= 30 && (
                  <p className="text-[11px] font-semibold text-red-600 mt-2">
                    <i className="ri-alarm-warning-line mr-1" />
                    {venceEm <= 0 ? 'O certificado venceu — o Pix do tablet parou.' : `O certificado vence em ${venceEm} dia(s).`} Gere outro na mesma integração do Inter e envie aqui.
                  </p>
                )}
              </div>

              {/* Passo a passo */}
              <div className="text-[11px] text-zinc-600 bg-orange-50 border border-orange-100 rounded-xl p-3.5 space-y-1.5">
                <p className="font-bold text-orange-800 text-xs">De onde vêm os dados</p>
                <p>1. No Internet Banking do <strong>Inter Empresas</strong>: <strong>Soluções para sua empresa → Nova integração</strong>, só com a <strong>API Pix</strong> (emitir e consultar cobrança imediata, consultar Pix recebidos).</p>
                <p>2. Nos três pontinhos da integração: baixe o <strong>certificado (.crt)</strong> e a <strong>chave (.key)</strong> e copie o <strong>Client ID</strong> e o <strong>Client Secret</strong>.</p>
                <p>3. Use a integração do <strong>Pix</strong>. A de extrato (Financeiro › Conciliação) é outra, com certificado próprio.</p>
              </div>

              {/* Credenciais */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Client ID {info?.configured && <span className="font-normal text-zinc-400">(em branco mantém o atual)</span>}
                </label>
                <input value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Client Secret {info?.configured && <span className="font-normal text-zinc-400">(em branco mantém o atual)</span>}
                </label>
                <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} autoComplete="off"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block cursor-pointer">
                  <span className="block text-xs font-semibold text-zinc-700 mb-1">Certificado (.crt)</span>
                  <span className={`flex items-center gap-2 text-xs border rounded-lg px-3 py-2 truncate ${certNome ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-dashed border-zinc-300 text-zinc-500 hover:bg-zinc-50'}`}>
                    <i className={certNome ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                    {certNome || (info?.has_cert ? 'Enviado — trocar' : 'Escolher arquivo')}
                  </span>
                  <input type="file" accept=".crt,.pem,.cer" className="hidden" onChange={e => lerArquivo(e.target.files?.[0], setCertPem, setCertNome)} />
                </label>
                <label className="block cursor-pointer">
                  <span className="block text-xs font-semibold text-zinc-700 mb-1">Chave privada (.key)</span>
                  <span className={`flex items-center gap-2 text-xs border rounded-lg px-3 py-2 truncate ${keyNome ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-dashed border-zinc-300 text-zinc-500 hover:bg-zinc-50'}`}>
                    <i className={keyNome ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                    {keyNome || (info?.has_cert ? 'Enviada — trocar' : 'Escolher arquivo')}
                  </span>
                  <input type="file" accept=".key,.pem" className="hidden" onChange={e => lerArquivo(e.target.files?.[0], setKeyPem, setKeyNome)} />
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Chave Pix da conta do Inter</label>
                <input value={pixKey} onChange={e => setPixKey(e.target.value)} autoComplete="off" placeholder="CNPJ, e-mail, telefone ou chave aleatória"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <p className="text-[10px] text-zinc-400 mt-1">Tem que ser uma chave cadastrada nessa conta — é nela que o dinheiro cai.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Conta corrente <span className="font-normal text-zinc-400">(só se a empresa tiver mais de uma no Inter)</span></label>
                <input value={contaCorrente} onChange={e => setContaCorrente(e.target.value)} autoComplete="off" inputMode="numeric"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>

              {/* Toggle */}
              <label className="flex items-center justify-between p-3 border border-zinc-200 rounded-xl cursor-pointer">
                <div>
                  <p className="text-sm font-semibold text-zinc-800">Cobrar Pix pelo Inter no autoatendimento</p>
                  <p className="text-[11px] text-zinc-400">Desligado, o tablet usa o Mercado Pago (se configurado) ou esconde o Pix</p>
                </div>
                <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} className="w-5 h-5 accent-emerald-500 cursor-pointer" />
              </label>

              {erro && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
                  <i className="ri-error-warning-line text-red-500 text-sm mt-0.5" />
                  <p className="text-xs text-red-600">{erro}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-zinc-100">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Fechar</button>
          <button onClick={salvar} disabled={saving || loading} className="flex-1 py-2 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            {saving ? 'Validando no Inter…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
