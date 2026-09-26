import { useCallback, useEffect, useState } from 'react';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { ifoodShipping, type IfoodShippingConfig } from '@/lib/ifoodShipping';

interface Props {
  tenantId: string;
  onClose: () => void;
  onChanged: () => void;
}

const inp = 'w-full px-2.5 py-2 rounded-lg border border-zinc-200 focus:border-red-400 outline-none text-sm';
const lbl = 'block text-[11px] font-semibold text-zinc-500 mb-0.5';

/**
 * Configuração do iFood Entrega: app "ERPOS PDV" (separado do app do financeiro) — credenciais,
 * autorização da loja no Portal do Parceiro, loja do iFood que despacha e modo homologação.
 */
export default function IfoodEntregaConfigModal({ tenantId, onClose, onChanged }: Props) {
  useVoltarFecha(true, onClose, 'ifood-entrega-config');
  const [cfg, setCfg] = useState<IfoodShippingConfig | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [busy, setBusy] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [userCode, setUserCode] = useState<{ code: string; url: string | null } | null>(null);

  const carregar = useCallback(async () => {
    const r = await ifoodShipping<{ config: IfoodShippingConfig | null; can_edit: boolean }>('get_config', tenantId);
    setCarregando(false);
    if (!r.success) { setErro(r.error || 'Não foi possível carregar.'); return; }
    setCfg(r.config); setPodeEditar(r.can_edit);
    setClientId(r.config?.client_id ?? '');
    if (r.config?.user_code) setUserCode({ code: r.config.user_code, url: r.config.verification_url });
  }, [tenantId]);
  useEffect(() => { carregar(); }, [carregar]);

  const run = async (key: string, action: string, extra: Record<string, unknown>, sucesso?: string) => {
    setErro(''); setOk(''); setBusy(key);
    const r = await ifoodShipping<Record<string, unknown>>(action, tenantId, extra);
    setBusy('');
    if (!r.success) { setErro(r.error || 'Falhou.'); return null; }
    if (sucesso) setOk(sucesso);
    await carregar();
    onChanged();
    return r;
  };

  const salvarCredenciais = async () => {
    const r = await run('cred', 'save_config', { client_id: clientId.trim(), client_secret: secret.trim() || undefined }, 'Credenciais salvas.');
    if (r) setSecret('');
  };
  const gerarCodigo = async () => {
    const r = await run('code', 'request_user_code', {});
    if (r) setUserCode({ code: String(r.user_code), url: (r.verification_url as string) ?? null });
  };
  const confirmar = async () => {
    const r = await run('auth', 'confirm_authorization', { authorization_code: authCode.trim() }, 'Loja autorizada.');
    if (r) { setAuthCode(''); setUserCode(null); }
  };

  const conectado = !!cfg?.authorized;

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-zinc-100">
          <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg shrink-0"><i className="ri-e-bike-2-fill text-red-600" /></div>
          <div className="flex-1">
            <h4 className="text-sm font-bold text-zinc-800">iFood Entrega — configuração</h4>
            <p className="text-xs text-zinc-500">Entregador do iFood para os pedidos de delivery do ERPOS</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100"><i className="ri-close-line text-lg" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {carregando ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : !podeEditar ? (
            <p className="text-sm text-zinc-600">
              {cfg?.shipping_enabled ? `Ligado — despacha pela loja "${cfg.shipping_merchant_name ?? 'iFood'}".` : 'Desligado.'} Só admin ou gerente altera esta configuração.
            </p>
          ) : (
            <>
              {/* 1. Credenciais */}
              <section className="space-y-2">
                <p className="text-xs font-bold text-zinc-700">1. App do iFood (Portal do Desenvolvedor › ERPOS PDV › Credenciais)</p>
                <div><label className={lbl}>Client ID</label><input className={inp} value={clientId} onChange={(e) => setClientId(e.target.value)} /></div>
                <div><label className={lbl}>Client Secret {cfg?.has_secret && <span className="text-emerald-600">(guardado — deixe vazio para manter)</span>}</label>
                  <input className={inp} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></div>
                <button disabled={!!busy || !clientId.trim()} onClick={salvarCredenciais} className="px-4 py-2 rounded-lg bg-zinc-800 text-white text-xs font-bold disabled:opacity-50">
                  {busy === 'cred' ? 'Salvando…' : 'Salvar credenciais'}
                </button>
              </section>

              {/* 2. Autorização */}
              {cfg?.client_id && (
                <section className="space-y-2">
                  <p className="text-xs font-bold text-zinc-700">2. Autorizar a loja no Portal do Parceiro</p>
                  {cfg.merchants.length > 0 && <p className="text-xs text-emerald-700"><i className="ri-checkbox-circle-line" /> Autorizadas: {cfg.merchants.map((m) => m.name).join(', ')}</p>}
                  {!userCode ? (
                    <button disabled={!!busy} onClick={gerarCodigo} className="px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 text-xs font-bold disabled:opacity-50">
                      {busy === 'code' ? 'Gerando…' : conectado ? 'Autorizar outra loja' : 'Gerar código de vínculo'}
                    </button>
                  ) : (
                    <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 space-y-2">
                      <p className="text-xs text-zinc-600">No Portal do Parceiro, <b>com a loja certa selecionada</b>, abra Apps e digite o código:</p>
                      <p className="text-2xl font-black tracking-widest text-zinc-800">{userCode.code}</p>
                      {userCode.url && <a href={userCode.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-red-600 underline">Abrir o Portal do Parceiro</a>}
                      <div><label className={lbl}>Código de autorização que o portal mostrou</label><input className={inp} value={authCode} onChange={(e) => setAuthCode(e.target.value)} /></div>
                      <button disabled={!!busy || !authCode.trim()} onClick={confirmar} className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50">
                        {busy === 'auth' ? 'Confirmando…' : 'Confirmar autorização'}
                      </button>
                    </div>
                  )}
                </section>
              )}

              {/* 3. Loja + opções */}
              {conectado && cfg && (
                <section className="space-y-3">
                  <p className="text-xs font-bold text-zinc-700">3. Entregas</p>
                  <div><label className={lbl}>Loja do iFood que despacha</label>
                    <select className={inp} value={cfg.shipping_merchant_id ?? ''} disabled={!!busy}
                      onChange={(e) => run('merchant', 'set_options', { shipping_merchant_id: e.target.value })}>
                      <option value="">Escolha…</option>
                      {cfg.merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="w-48"><label className={lbl}>Tempo de preparo padrão (min)</label>
                    <input className={inp} type="number" min={0} max={120} defaultValue={cfg.default_prep_min}
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== cfg.default_prep_min) run('prep', 'set_options', { default_prep_min: v }); }} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                    <input type="checkbox" checked={cfg.shipping_enabled} disabled={!!busy}
                      onChange={(e) => run('on', 'set_options', { shipping_enabled: e.target.checked }, e.target.checked ? 'iFood Entrega ligado.' : 'iFood Entrega desligado.')} />
                    Mostrar "Chamar iFood" no Gestor de Entregas
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer">
                    <input type="checkbox" checked={cfg.homologation_mode} disabled={!!busy}
                      onChange={(e) => run('homolog', 'set_options', { homologation_mode: e.target.checked })} />
                    Modo homologação (só para a loja de teste do iFood)
                  </label>
                  {cfg.last_poll_at && (
                    <p className={`text-[11px] ${cfg.last_poll_error ? 'text-red-600' : 'text-zinc-400'}`}>
                      Última consulta de eventos: {new Date(cfg.last_poll_at).toLocaleString('pt-BR')}
                      {cfg.last_poll_error ? ` — ${cfg.last_poll_error}` : ''}{cfg.poll_fail_count > 5 ? ` (${cfg.poll_fail_count} falhas seguidas)` : ''}
                    </p>
                  )}
                </section>
              )}
            </>
          )}
          {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{erro}</p>}
          {ok && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{ok}</p>}
        </div>
      </div>
    </div>
  );
}
