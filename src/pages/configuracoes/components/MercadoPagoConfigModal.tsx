import { useState, useEffect } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

// ── Pagamento online (Mercado Pago) ─────────────────────────────────────────
// O token nunca volta pro front: a Edge `online-payments` só devolve os 6
// últimos caracteres. Salvar com token novo valida na hora em GET /users/me.

interface ConfigInfo {
  configured: boolean;
  is_active: boolean;
  has_webhook_secret: boolean;
  access_token_hint: string | null;
  account_id: string | null;
  account_label: string | null;
  last_test_at: string | null;
  webhook_url: string;
}

interface Props {
  onClose: () => void;
  onSaved?: (info: { is_active: boolean }) => void;
}

export default function MercadoPagoConfigModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const tenantId = user?.tenantId ?? '';

  const [info, setInfo] = useState<ConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [ativo, setAtivo] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    invokeWithAuth<ConfigInfo>('online-payments', { body: { action: 'get_config', tenant_id: tenantId } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) { setErro(error?.message || 'Erro ao carregar'); return; }
        setInfo(data);
        setAtivo(Boolean(data.is_active));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const salvar = async () => {
    if (!tenantId) return;
    setSaving(true);
    setErro('');
    const body: Record<string, unknown> = { action: 'save_config', tenant_id: tenantId, is_active: ativo };
    if (token.trim()) body.access_token = token.trim();
    if (secret.trim()) body.webhook_secret = secret.trim();
    const { data, error } = await invokeWithAuth<{ ok?: boolean; error?: string; detail?: string; is_active: boolean; account_label: string | null }>('online-payments', { body });
    setSaving(false);
    if (error || !data?.ok) {
      const msg = data?.error || error?.message || 'Erro ao salvar';
      setErro(data?.detail ? `${msg} (${data.detail})` : msg);
      return;
    }
    toastSuccess(data.is_active ? 'Pagamento online ativado' : 'Configuração salva');
    setToken('');
    setSecret('');
    setInfo(prev => prev ? { ...prev, configured: true, is_active: data.is_active, account_label: data.account_label, has_webhook_secret: prev.has_webhook_secret || Boolean(body.webhook_secret) } : prev);
    onSaved?.({ is_active: data.is_active });
  };

  const testar = async () => {
    setTesting(true);
    setErro('');
    const { data, error } = await invokeWithAuth<{ ok: boolean; error?: string; account_label?: string }>('online-payments', { body: { action: 'test_config', tenant_id: tenantId } });
    setTesting(false);
    if (error || !data?.ok) { toastError(data?.error || error?.message || 'Falha no teste'); return; }
    toastSuccess(`Conectado: ${data.account_label || 'conta Mercado Pago'}`);
    setInfo(prev => prev ? { ...prev, account_label: data.account_label ?? prev.account_label, last_test_at: new Date().toISOString() } : prev);
  };

  const copiarWebhook = async () => {
    if (!info?.webhook_url) return;
    try { await navigator.clipboard.writeText(info.webhook_url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white w-full max-w-lg rounded-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-sky-500 rounded-xl">
              <i className="ri-smartphone-line text-white text-lg" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Pagamento pelo celular</h2>
              <p className="text-[11px] text-zinc-400">Pix dinâmico via Mercado Pago · confirmação automática</p>
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
                      {info?.is_active ? 'Ativo — clientes podem pagar pelo celular' : info?.configured ? 'Configurado, mas desligado' : 'Não configurado'}
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {info?.account_label ? `Conta: ${info.account_label}` : 'Nenhuma conta conectada'}
                      {info?.access_token_hint ? ` · token ${info.access_token_hint}` : ''}
                    </p>
                  </div>
                  {info?.configured && (
                    <button onClick={testar} disabled={testing} className="px-3 py-1.5 text-xs font-semibold bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 cursor-pointer whitespace-nowrap disabled:opacity-50">
                      {testing ? 'Testando…' : 'Testar conexão'}
                    </button>
                  )}
                </div>
              </div>

              {/* Passo a passo */}
              <div className="text-[11px] text-zinc-600 bg-sky-50 border border-sky-100 rounded-xl p-3.5 space-y-1.5">
                <p className="font-bold text-sky-800 text-xs">Como pegar as credenciais (≈ 5 min)</p>
                <p>1. Entre em <strong>mercadopago.com.br/developers</strong> com a conta do restaurante → <strong>Suas integrações</strong> → <strong>Criar aplicação</strong> (tipo "Pagamentos online", sem plataforma).</p>
                <p>2. Na aplicação, abra <strong>Credenciais de produção</strong> e copie o <strong>Access Token</strong> (começa com <code>APP_USR-</code>).</p>
                <p>3. Em <strong>Webhooks</strong> → modo produção: cole a URL abaixo, marque o evento <strong>Pagamentos</strong>, salve e copie a <strong>assinatura secreta</strong>.</p>
              </div>

              {/* Webhook URL */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">URL do webhook (cole no painel do Mercado Pago)</label>
                <div className="flex gap-2">
                  <input readOnly value={info?.webhook_url ?? ''} className="flex-1 text-[11px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 truncate" />
                  <button onClick={copiarWebhook} className={`px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap ${copiado ? 'bg-emerald-500 text-white' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'}`}>
                    {copiado ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>

              {/* Token */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Access Token de produção {info?.configured && <span className="font-normal text-zinc-400">(deixe em branco para manter o atual)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="APP_USR-…"
                    autoComplete="off"
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <button type="button" onClick={() => setShowToken(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer">
                    <i className={showToken ? 'ri-eye-off-line' : 'ri-eye-line'} />
                  </button>
                </div>
              </div>

              {/* Secret */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Assinatura secreta do webhook {info?.has_webhook_secret && <span className="font-normal text-zinc-400">(já cadastrada — em branco mantém)</span>}
                </label>
                <input
                  type="password"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  autoComplete="off"
                  placeholder="Opcional, mas recomendado"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <p className="text-[10px] text-zinc-400 mt-1">Sem ela o sistema ainda confere cada pagamento direto na API do Mercado Pago; com ela, notificações falsas são descartadas antes.</p>
              </div>

              {/* Toggle */}
              <label className="flex items-center justify-between p-3 border border-zinc-200 rounded-xl cursor-pointer">
                <div>
                  <p className="text-sm font-semibold text-zinc-800">Liberar "Pagar conta" no cardápio da mesa</p>
                  <p className="text-[11px] text-zinc-400">O botão só aparece para o cliente quando isto está ligado</p>
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
            {saving ? 'Validando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
