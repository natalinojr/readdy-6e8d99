import { useState, useEffect } from 'react';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

// ── Pagamento online (Mercado Pago) ─────────────────────────────────────────
// O token nunca volta pro front: a Edge `online-payments` só devolve os 6
// últimos caracteres. Salvar com token novo valida na hora em GET /users/me.
// A Public Key é pública por definição (vai no navegador do cliente, no formulário
// do cartão), por isso volta inteira. Cartão: só crédito e à vista.

interface ConfigInfo {
  configured: boolean;
  is_active: boolean;
  has_webhook_secret: boolean;
  access_token_hint: string | null;
  account_id: string | null;
  account_label: string | null;
  last_test_at: string | null;
  webhook_url: string;
  public_key?: string | null;
  card_enabled?: boolean;
  card_fee_percentage?: number | null;
  pix_fee_percentage?: number | null;
  card_days_to_receive?: number | null;
  card_bank_account_id?: string | null;
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
  const [publicKey, setPublicKey] = useState('');
  const [cardEnabled, setCardEnabled] = useState(false);
  const [cardFee, setCardFee] = useState('');
  const [pixFee, setPixFee] = useState('');
  const [cardDays, setCardDays] = useState('');
  const [cardBank, setCardBank] = useState('');
  const [contas, setContas] = useState<{ id: string; name: string; bank_name: string | null }[]>([]);
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
        setPublicKey(data.public_key ?? '');
        setCardEnabled(Boolean(data.card_enabled && data.public_key));
        setCardFee(data.card_fee_percentage != null ? String(data.card_fee_percentage).replace('.', ',') : '');
        setPixFee(data.pix_fee_percentage != null ? String(data.pix_fee_percentage).replace('.', ',') : '');
        setCardDays(data.card_days_to_receive != null ? String(data.card_days_to_receive) : '');
        setCardBank(data.card_bank_account_id ?? '');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    // Contas do financeiro: o dinheiro do cartão online cai no saldo do Mercado Pago.
    supabase.from('fin_bank_accounts').select('id, name, bank_name').eq('tenant_id', tenantId).eq('is_active', true).order('name')
      .then(({ data }) => { if (!cancelled) setContas((data ?? []) as { id: string; name: string; bank_name: string | null }[]); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const salvar = async () => {
    if (!tenantId) return;
    setErro('');
    // Cartão: taxa e prazo vazios = a Edge usa os da forma "Cartão de Crédito" da loja.
    // Valida aqui para "abc" não virar vazio sem aviso (a Edge confere os limites também).
    const feeTxt = cardFee.trim().replace(',', '.');
    const daysTxt = cardDays.trim();
    const feeNum = feeTxt === '' ? null : Number(feeTxt);
    const daysNum = daysTxt === '' ? null : Number(daysTxt);
    if (feeNum !== null && (!Number.isFinite(feeNum) || feeNum < 0 || feeNum > 20)) { setErro('Taxa do cartão deve ficar entre 0 e 20%'); return; }
    if (daysNum !== null && (!Number.isInteger(daysNum) || daysNum < 0 || daysNum > 60)) { setErro('Prazo do cartão deve ser um número inteiro de 0 a 60 dias'); return; }
    // Pix pelo app: taxa do Checkout do MP (vazio = a da forma "PIX" da loja, que é a do Pix direto na conta).
    const pixFeeTxt = pixFee.trim().replace(',', '.');
    const pixFeeNum = pixFeeTxt === '' ? null : Number(pixFeeTxt);
    if (pixFeeNum !== null && (!Number.isFinite(pixFeeNum) || pixFeeNum < 0 || pixFeeNum > 10)) { setErro('Taxa do Pix deve ficar entre 0 e 10%'); return; }
    setSaving(true);
    const body: Record<string, unknown> = {
      action: 'save_config', tenant_id: tenantId, is_active: ativo,
      public_key: publicKey.trim(), // vazio limpa a chave
      card_enabled: cardEnabled && Boolean(publicKey.trim()),
      card_fee_percentage: feeNum,
      card_days_to_receive: daysNum,
      card_bank_account_id: cardBank || null,
      pix_fee_percentage: pixFeeNum,
    };
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
              <p className="text-[11px] text-zinc-400">Pix e cartão de crédito via Mercado Pago · confirmação automática</p>
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
                <p>2. Na aplicação, abra <strong>Credenciais de produção</strong> e copie o <strong>Access Token</strong> e a <strong>Public Key</strong> (as duas começam com <code>APP_USR-</code>).</p>
                <p>3. Em <strong>Webhooks</strong> → modo produção: cole a URL abaixo, marque o evento <strong>Pagamentos</strong>, salve e copie a <strong>assinatura secreta</strong>.</p>
                <p>4. <strong>Só para o cartão:</strong> na mesma tela (Suas integrações › sua aplicação › Webhooks), marque também o evento <strong>Order (Mercado Pago)</strong> na <strong>mesma URL</strong> abaixo (é por esse evento que o Mercado Pago avisa o sistema sobre as cobranças no cartão).</p>
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

              {/* Pix pelo app: o Checkout do MP cobra taxa (o Pix direto na conta da loja, não) */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Taxa do Pix pelo app (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={pixFee}
                  onChange={e => setPixFee(e.target.value)}
                  placeholder="Ex.: 0,99"
                  autoComplete="off"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <p className="text-[10px] text-zinc-400 mt-1">No Mercado Pago: Seu negócio › Custos › aba <strong>Checkout</strong> › Pix. Em branco, usa a taxa da forma "PIX" da loja.</p>
              </div>

              {/* Cartão de crédito (Card Payment Brick): só crédito e à vista */}
              <div className="space-y-3 p-3.5 border border-zinc-200 rounded-xl">
                <div>
                  <p className="text-sm font-semibold text-zinc-800">Cartão de crédito pelo app</p>
                  <p className="text-[11px] text-zinc-400">Só crédito, à vista. O cliente digita o cartão no celular e os dados ficam com o Mercado Pago.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Public Key (chave pública)</label>
                  <input
                    type="text"
                    value={publicKey}
                    onChange={e => setPublicKey(e.target.value)}
                    placeholder="APP_USR-…"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <p className="text-[10px] text-zinc-400 mt-1">Em Credenciais de produção, ao lado do Access Token (começa com <code>APP_USR-</code>). Deixe em branco para remover.</p>
                </div>

                <label className={`flex items-center justify-between gap-3 p-3 border border-zinc-200 rounded-xl ${publicKey.trim() ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                  <div>
                    <p className="text-sm font-semibold text-zinc-800">Aceitar cartão de crédito pelo app (delivery e QR)</p>
                    <p className="text-[11px] text-zinc-400">{publicKey.trim() ? 'Aparece como "Cartão de crédito pelo app" para o cliente' : 'Informe a Public Key para poder ligar'}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={cardEnabled && Boolean(publicKey.trim())}
                    disabled={!publicKey.trim()}
                    onChange={e => setCardEnabled(e.target.checked)}
                    className="w-5 h-5 accent-emerald-500 cursor-pointer disabled:cursor-not-allowed shrink-0"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">Taxa do cartão online (%)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={cardFee}
                      onChange={e => setCardFee(e.target.value)}
                      placeholder="Ex.: 3,5"
                      autoComplete="off"
                      className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">Dias para o Mercado Pago liberar o dinheiro</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={cardDays}
                      onChange={e => setCardDays(e.target.value.replace(/\D/g, ''))}
                      placeholder="Ex.: 30"
                      autoComplete="off"
                      className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-zinc-400 -mt-1">Em branco, o sistema usa a taxa e o prazo da forma "Cartão de Crédito" da loja.</p>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Conta do Mercado Pago no financeiro</label>
                  <select
                    value={cardBank}
                    onChange={e => setCardBank(e.target.value)}
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
                  >
                    <option value="">Nenhuma — não lançar em conta bancária</option>
                    {contas.map(c => <option key={c.id} value={c.id}>{c.name}{c.bank_name ? ` · ${c.bank_name}` : ''}</option>)}
                  </select>
                  <p className="text-[10px] text-zinc-400 mt-1">O dinheiro do cartão pelo app cai no saldo do Mercado Pago, não na conta da maquininha. Escolha a conta que representa o Mercado Pago (cadastre em Financeiro › Bancos se não existir).</p>
                </div>
              </div>

              {/* Toggle */}
              <label className="flex items-center justify-between gap-3 p-3 border border-zinc-200 rounded-xl cursor-pointer">
                <div>
                  <p className="text-sm font-semibold text-zinc-800">Liberar pagamento pelo celular (mesa/QR e delivery)</p>
                  <p className="text-[11px] text-zinc-400">Liga o "Pagar conta" no cardápio da mesa e as formas "pelo app" no delivery. Desligado, nenhum botão de pagar pelo celular aparece para o cliente</p>
                </div>
                <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} className="w-5 h-5 accent-emerald-500 cursor-pointer shrink-0" />
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
