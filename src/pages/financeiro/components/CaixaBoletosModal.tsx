import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// ── Caixa de boletos por e-mail ─────────────────────────────────────────────
// Liga um Gmail da loja ao Contas a Pagar. O acesso é SOMENTE LEITURA: o sistema não
// envia, não apaga e não marca nada na caixa. A chave do Google fica no banco e nunca
// volta para cá — a tela só mostra o começo do ID para conferência.
//
// O passo do OAuth usa o mesmo desenho da conexão com a Meta: o Google volta para esta
// mesma página com ?code=..., e a tela troca esse código pela autorização de longo prazo.

interface MailConfig {
  configured: boolean;
  connected: boolean;
  is_active: boolean;
  auto_sync: boolean;
  email_address: string | null;
  query: string;
  client_id_hint: string | null;
  last_check_at: string | null;
  last_error: string | null;
  connected_at: string | null;
}

interface Props {
  onClose: () => void;
}

type Resp = {
  success?: boolean; error?: string; config?: MailConfig | null; url?: string;
  not_connected?: boolean; encontrados?: number; amostra?: string[]; email_address?: string | null;
};

/** O Google exige que o endereço de retorno seja EXATAMENTE um dos autorizados na credencial. */
const redirectUri = () => window.location.origin + window.location.pathname;

export default function CaixaBoletosModal({ onClose }: Props) {
  const { user } = useAuth();
  const [config, setConfig] = useState<MailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [query, setQuery] = useState('has:attachment newer_than:30d');
  const [busy, setBusy] = useState<null | 'salvar' | 'conectar' | 'testar' | 'desconectar'>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string; details?: string[] } | null>(null);
  const [passo, setPasso] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await invokeWithAuth<Resp>('contas-email', { body: { action: 'get_config', tenant_id: user?.tenantId } });
    const c = data?.config ?? null;
    setConfig(c);
    if (c?.query) setQuery(c.query);
    setPasso(c?.connected ? 3 : c?.configured ? 2 : 1);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load]);

  // Volta do Google com ?code=... nesta mesma página: troca pela autorização de longo prazo.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state') ?? '';
    if (!code || !state.startsWith('erpos:') || !user?.tenantId) return;
    // limpa a URL antes de trocar: recarregar a página não pode tentar usar o code de novo
    window.history.replaceState({}, '', window.location.origin + window.location.pathname);
    (async () => {
      setBusy('conectar');
      const { data, error } = await invokeWithAuth<Resp>('contas-email', {
        body: { action: 'exchange', tenant_id: user.tenantId, code, redirect_uri: redirectUri() },
      });
      setBusy(null);
      const err = error?.message ?? (data?.success ? undefined : data?.error);
      if (err) { setResult({ ok: false, msg: err }); return; }
      setConfig(data?.config ?? null);
      setPasso(3);
      setResult({ ok: true, msg: `Caixa conectada: ${data?.config?.email_address ?? 'conta do Google'}.` });
    })();
  }, [user?.tenantId]);

  const salvarCredencial = async () => {
    if (!clientId.trim() || !clientSecret.trim()) { setResult({ ok: false, msg: 'Preencha o ID e a chave do cliente.' }); return; }
    setBusy('salvar');
    setResult(null);
    const { data, error } = await invokeWithAuth<Resp>('contas-email', {
      body: { action: 'save_credentials', tenant_id: user?.tenantId, client_id: clientId.trim(), client_secret: clientSecret.trim(), query: query.trim() },
    });
    setBusy(null);
    const err = error?.message ?? (data?.success ? undefined : data?.error);
    if (err) { setResult({ ok: false, msg: err }); return; }
    setClientId(''); setClientSecret('');
    setConfig(data?.config ?? null);
    setPasso(2);
    setResult({ ok: true, msg: 'Credencial guardada. Agora é autorizar o acesso à caixa.' });
  };

  const conectar = async () => {
    setBusy('conectar');
    setResult(null);
    const { data, error } = await invokeWithAuth<Resp>('contas-email', {
      body: { action: 'oauth_url', tenant_id: user?.tenantId, redirect_uri: redirectUri() },
    });
    setBusy(null);
    const err = error?.message ?? (data?.success ? undefined : data?.error);
    if (err || !data?.url) { setResult({ ok: false, msg: err || 'Não foi possível montar o link de autorização.' }); return; }
    window.location.href = data.url;
  };

  const testar = async () => {
    setBusy('testar');
    setResult(null);
    const { data, error } = await invokeWithAuth<Resp>('contas-email', { body: { action: 'test', tenant_id: user?.tenantId } });
    setBusy(null);
    const err = error?.message ?? (data?.success ? undefined : data?.error);
    if (err) { setResult({ ok: false, msg: err }); return; }
    setResult({
      ok: true,
      msg: `Leitura funcionando em ${data?.email_address ?? 'a caixa'}: ${data?.encontrados ?? 0} e-mail(s) batem com o filtro.`,
      details: data?.amostra?.length ? data.amostra : undefined,
    });
    load();
  };

  const desconectar = async () => {
    if (!window.confirm('Desconectar a caixa de e-mail? O que já foi lançado continua; a caixa do Gmail não é alterada.')) return;
    setBusy('desconectar');
    await invokeWithAuth<Resp>('contas-email', { body: { action: 'disconnect', tenant_id: user?.tenantId } });
    setBusy(null);
    setResult({ ok: true, msg: 'Caixa desconectada.' });
    load();
  };

  const Passo = ({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) => (
    <div className={`rounded-xl border p-4 ${passo === n ? 'border-amber-300 bg-amber-50/40' : 'border-zinc-200'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${passo > n ? 'bg-green-100 text-green-700' : passo === n ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-400'}`}>
          {passo > n ? <i className="ri-check-line" /> : n}
        </span>
        <p className="text-sm font-bold text-zinc-800">{titulo}</p>
      </div>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-amber-100">
              <i className="ri-mail-download-line text-amber-600 text-lg" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Caixa de boletos por e-mail</h3>
              <p className="text-xs text-zinc-500">Boleto que chega no e-mail vira conta a pagar sozinho</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-4 overflow-y-auto">
            {config?.connected && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border ${config.last_error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <i className={`${config.last_error ? 'ri-error-warning-fill text-red-600' : 'ri-checkbox-circle-fill text-green-600'} mt-0.5`} />
                <div className="flex-1 text-xs">
                  <p className={`font-semibold ${config.last_error ? 'text-red-700' : 'text-green-700'}`}>
                    Conectada · {config.email_address ?? 'conta do Google'}
                  </p>
                  {config.last_check_at && <p className="text-zinc-600">Última leitura: {new Date(config.last_check_at).toLocaleString('pt-BR')}</p>}
                  {config.last_error && <p className="text-red-700 mt-1">{config.last_error}</p>}
                </div>
              </div>
            )}

            <div className="bg-zinc-50 rounded-xl p-4 text-xs text-zinc-600 space-y-1.5">
              <p className="font-semibold text-zinc-700 flex items-center gap-1.5"><i className="ri-shield-check-line text-zinc-400" /> O que o sistema pode e não pode</p>
              <p>O acesso é <strong>somente leitura</strong>: o sistema lê os e-mails e os anexos, e não envia, não apaga nem marca nada na sua caixa.</p>
              <p>Boleto de fornecedor <strong>já cadastrado</strong>, com o beneficiário batendo, é lançado direto em Contas a Pagar. Remetente novo ou beneficiário diferente vira <strong>pendência no chat</strong> para você olhar.</p>
              <p className="text-zinc-400">O pagamento nunca é automático — continua sendo seu clique no Banco Inter.</p>
            </div>

            <Passo n={1} titulo="Credencial do Google">
              <div className="space-y-2.5">
                <p className="text-xs text-zinc-500">
                  No <strong>Google Cloud Console</strong>: crie um projeto, ative a <strong>Gmail API</strong> e crie uma credencial <strong>OAuth — aplicativo da Web</strong>.
                  Em "URIs de redirecionamento autorizados", cole exatamente:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] bg-zinc-900 text-zinc-100 rounded-lg px-3 py-2 font-mono break-all">{redirectUri()}</code>
                  <button onClick={() => navigator.clipboard?.writeText(redirectUri())}
                    className="px-3 py-2 text-xs font-semibold border border-zinc-200 rounded-lg hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
                    Copiar
                  </button>
                </div>
                {config?.configured && (
                  <p className="text-[11px] text-green-700"><i className="ri-checkbox-circle-line" /> Credencial guardada {config.client_id_hint ? `(${config.client_id_hint})` : ''}. Preencha de novo só se quiser trocar.</p>
                )}
                <div className="grid gap-2">
                  <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ID do cliente (…apps.googleusercontent.com)"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Chave secreta do cliente"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Quais e-mails olhar (filtro do Gmail)</label>
                  <input value={query} onChange={(e) => setQuery(e.target.value)}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <p className="text-[11px] text-zinc-400 mt-1">Padrão: e-mails com anexo dos últimos 30 dias. Dá para restringir, ex.: <code>has:attachment from:condominio.com.br</code>.</p>
                </div>
                <button onClick={salvarCredencial} disabled={busy !== null}
                  className="px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-semibold hover:bg-zinc-900 cursor-pointer whitespace-nowrap disabled:opacity-50">
                  {busy === 'salvar' ? 'Guardando…' : 'Guardar credencial'}
                </button>
              </div>
            </Passo>

            <Passo n={2} titulo="Autorizar o acesso à caixa">
              <p className="text-xs text-zinc-500 mb-2.5">
                Você vai para o Google, escolhe <strong>a conta da loja</strong> (não a sua pessoal) e autoriza a leitura. Depois volta para esta tela sozinho.
              </p>
              <button onClick={conectar} disabled={busy !== null || !config?.configured}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 cursor-pointer whitespace-nowrap disabled:opacity-40">
                <i className="ri-google-fill" /> {busy === 'conectar' ? 'Conectando…' : config?.connected ? 'Conectar outra caixa' : 'Conectar com o Google'}
              </button>
            </Passo>

            <Passo n={3} titulo="Conferir a leitura">
              <p className="text-xs text-zinc-500 mb-2.5">Pergunta ao Gmail quantos e-mails o filtro pega e mostra os últimos remetentes — para você ver se está olhando o lugar certo.</p>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={testar} disabled={busy !== null || !config?.connected}
                  className="flex items-center gap-2 px-4 py-2 border border-amber-300 text-amber-700 rounded-lg text-sm font-semibold hover:bg-amber-50 cursor-pointer whitespace-nowrap disabled:opacity-40">
                  {busy === 'testar' ? 'Consultando…' : 'Testar leitura'}
                </button>
                {config?.connected && (
                  <button onClick={desconectar} disabled={busy !== null}
                    className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50">
                    Desconectar
                  </button>
                )}
              </div>
            </Passo>

            {result && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${result.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                <i className={`${result.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
                <div className="break-words min-w-0">
                  <p>{result.msg}</p>
                  {result.details && (
                    <ul className="mt-1.5 space-y-0.5 opacity-80">
                      {result.details.map((d, i) => <li key={i} className="truncate">· {d}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <p className="text-[11px] text-zinc-400">
              Por enquanto esta tela só liga a caixa. A leitura dos boletos e o lançamento automático entram na próxima etapa — até lá nada é lançado sozinho.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
