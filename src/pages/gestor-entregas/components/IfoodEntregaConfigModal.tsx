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
 * Desde 2026-09-26 o app ERPOS PDV é do SISTEMA (secrets da edge): a loja só gera o código e autoriza;
 * Client ID/Secret próprios ficam em "Avançado", só para app de teste.
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
  const [appType, setAppType] = useState<'distributed' | 'centralized'>('distributed');
  const [authCode, setAuthCode] = useState('');
  const [userCode, setUserCode] = useState<{ code: string; url: string | null } | null>(null);
  const [systemAvailable, setSystemAvailable] = useState(false);
  const [avancado, setAvancado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await ifoodShipping<{ config: IfoodShippingConfig | null; can_edit: boolean; system_app_available?: boolean }>('get_config', tenantId);
    setCarregando(false);
    if (!r.success) { setErro(r.error || 'Não foi possível carregar.'); return; }
    setCfg(r.config); setPodeEditar(r.can_edit);
    setSystemAvailable(r.system_app_available === true);
    setClientId(r.config?.system_app ? '' : r.config?.client_id ?? '');
    setAppType(r.config?.app_type ?? 'distributed');
    if (r.config?.user_code) setUserCode({ code: r.config.user_code, url: r.config.verification_url });
  }, [tenantId]);
  useEffect(() => { carregar(); }, [carregar]);

  const run = async (key: string, action: string, extra: Record<string, unknown>, sucesso?: string) => {
    setErro(''); setOk(''); setBusy(key);
    const r = await ifoodShipping<Record<string, unknown>>(action, tenantId, extra);
    setBusy('');
    if (!r.success) { setErro(r.error || 'Falhou.'); return null; }
    // aviso = salvou, mas com ressalva (ex.: loja do iFood de outra loja do ERPOS não foi ligada).
    if (r.aviso) setErro(String(r.aviso));
    else if (sucesso) setOk(sucesso);
    await carregar();
    onChanged();
    return r;
  };

  const salvarCredenciais = async () => {
    const r = await run('cred', 'save_config', { client_id: clientId.trim(), client_secret: secret.trim() || undefined, app_type: appType }, 'Credenciais salvas.');
    if (r) setSecret('');
  };
  const gerarCodigo = async () => {
    const r = await run('code', 'request_user_code', {});
    if (r) setUserCode({ code: String(r.user_code), url: (r.verification_url as string) ?? null });
  };
  const confirmar = async () => {
    const r = await run('auth', 'confirm_authorization', { authorization_code: authCode.trim() }, 'Autorização confirmada — confira abaixo as lojas do iFood.');
    if (r) { setAuthCode(''); setUserCode(null); }
  };

  const voltarParaSistema = async () => {
    if (conectado && !window.confirm('Voltar para o app ERPOS PDV? As autorizações feitas com o app próprio deixam de valer e a loja precisa autorizar de novo.')) return;
    const r = await run('sistema', 'use_system_app', {}, 'Usando o app ERPOS PDV. Gere o código para autorizar a loja.');
    if (r) setAvancado(false);
  };

  const conectado = !!cfg?.authorized;
  // Loja no app ERPOS PDV do sistema (sem credencial própria gravada).
  const usaSistema = cfg?.system_app === true || (systemAvailable && !cfg?.client_id);

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
              {cfg?.shipping_enabled ? `Ligado — despacha pela loja "${cfg.shipping_merchant_name ?? 'iFood'}".` : 'Desligado.'} Só admin ou supervisor altera esta configuração.
            </p>
          ) : (
            <>
              {/* 1. Autorização */}
              {!cfg?.client_id && <p className="text-xs text-zinc-500">App do iFood não configurado: abra <b>Avançado</b> abaixo.</p>}
              {cfg?.client_id && (
                <section className="space-y-2">
                  <p className="text-xs font-bold text-zinc-700">1. Autorizar a loja no Portal do Parceiro{usaSistema ? ' (app ERPOS PDV)' : ''}</p>
                  {cfg.merchants.length > 0 && <p className="text-xs text-emerald-700"><i className="ri-checkbox-circle-line" /> Autorizadas: {cfg.merchants.map((m) => m.name).join(', ')}</p>}
                  {conectado && cfg.app_type !== 'centralized' && (
                    <div className={`flex flex-wrap items-center gap-2 ${cfg.merchants.length === 0 ? 'p-2.5 rounded-lg bg-amber-50 border border-amber-200' : ''}`}>
                      {cfg.merchants.length === 0 && <p className="text-xs text-amber-800 flex-1 min-w-[12rem]">A autorização ainda não trouxe nenhuma loja do iFood. Se o ERPOS PDV já aparece ativo no Portal do Parceiro, clique em <b>Atualizar lojas</b>.</p>}
                      <button disabled={!!busy} onClick={() => run('refresh', 'refresh_merchants', {}, 'Lojas atualizadas.')} className="px-3 py-1.5 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                        {busy === 'refresh' ? 'Atualizando…' : 'Atualizar lojas'}
                      </button>
                      <p className="text-[11px] text-zinc-500 w-full">Loja recém-autorizada no Portal do Parceiro pode levar alguns minutos para aparecer aqui — se não vier, espere um pouco e clique em Atualizar lojas de novo.</p>
                    </div>
                  )}
                  {cfg.app_type === 'centralized' ? (
                    <button disabled={!!busy} onClick={() => run('central', 'connect_centralized', {}, 'Conectado.')} className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50">
                      {busy === 'central' ? 'Conectando…' : conectado ? 'Conectar de novo' : 'Conectar (app de teste, sem código)'}
                    </button>
                  ) : !userCode ? (
                    <button disabled={!!busy} onClick={gerarCodigo} className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50">
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

              {/* 2. Loja + opções */}
              {conectado && cfg && (
                <section className="space-y-3">
                  <p className="text-xs font-bold text-zinc-700">2. Entregas</p>
                  <div><label className={lbl}>Loja do iFood que despacha</label>
                    <select className={inp} value={cfg.shipping_merchant_id ?? ''} disabled={!!busy}
                      onChange={(e) => run('merchant', 'set_options', { shipping_merchant_id: e.target.value })}>
                      <option value="">Escolha…</option>
                      {cfg.merchants.map((m) => <option key={m.id} value={m.id} disabled={!!m.outra_loja}>{m.name}{m.outra_loja ? ` — é da loja ${m.outra_loja}` : ''}</option>)}
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
              {/* 3. Pedidos do iFood (módulo Order) */}
              {conectado && cfg && (
                <section className="space-y-2">
                  <p className="text-xs font-bold text-zinc-700">3. Pedidos do iFood</p>
                  <p className="text-[11px] text-zinc-500">Traz cada pedido do iFood com os itens para o ERPOS. Escolha se a loja continua operando no tablet do iFood ou se o pedido passa pela cozinha e pelas entregas do ERPOS.</p>
                  <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                    <input type="checkbox" checked={cfg.order_enabled} disabled={!!busy}
                      onChange={(e) => run('ord-on', 'set_options', { order_enabled: e.target.checked, ...(e.target.checked && cfg.order_merchant_ids.length === 0 ? { order_merchant_ids: cfg.merchants.filter((m) => !m.outra_loja).map((m) => m.id) } : {}) }, e.target.checked ? 'Pedidos do iFood ligados.' : 'Pedidos do iFood desligados.')} />
                    Receber os pedidos do iFood
                  </label>
                  {cfg.order_enabled && (
                    <div className="space-y-1 pl-6">
                      {cfg.merchants.map((m) => (
                        <label key={m.id} className={`flex items-center gap-2 text-xs cursor-pointer ${m.outra_loja ? 'text-zinc-400' : 'text-zinc-600'}`}>
                          <input type="checkbox" checked={cfg.order_merchant_ids.includes(m.id)} disabled={!!busy || (!!m.outra_loja && !cfg.order_merchant_ids.includes(m.id))}
                            onChange={(e) => run('ord-m', 'set_options', { order_merchant_ids: e.target.checked ? [...cfg.order_merchant_ids, m.id] : cfg.order_merchant_ids.filter((x) => x !== m.id) })} />
                          {m.name}{m.outra_loja && <span className="text-[11px]">— é da loja {m.outra_loja} no ERPOS</span>}
                        </label>
                      ))}
                      <div className="pt-1 space-y-1">
                        {([
                          ['read_only', 'Só acompanhar', 'A loja aceita e despacha no tablet do iFood; o ERPOS só mostra os pedidos.'],
                          ['funnel', 'Pedido entra no ERPOS', 'Vai para a cozinha (KDS e tickets), Gestor de Pedidos e Entregas, dá baixa no estoque; o ERPOS avisa o iFood a cada etapa (preparo, pronto, saiu).'],
                          ['operate', 'Operar à mão (homologação)', 'Botões de confirmar/preparo/pronto/despachar na tela Pedidos iFood — só para a homologação na loja de teste.'],
                        ] as const).map(([v, t, d]) => (
                          <label key={v} className="flex items-start gap-2 text-xs text-zinc-600 cursor-pointer">
                            <input type="radio" name="ifood-order-mode" className="mt-0.5" checked={cfg.order_mode === v} disabled={!!busy}
                              onChange={() => run('ord-mode', 'set_options', { order_mode: v }, v === 'funnel' ? 'Pedidos do iFood entram no ERPOS a partir de agora.' : 'Modo dos pedidos salvo.')} />
                            <span><b className="text-zinc-700">{t}</b> — {d}</span>
                          </label>
                        ))}
                        {cfg.order_mode === 'funnel' && (
                          <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer pl-5">
                            <input type="checkbox" checked={cfg.order_auto_confirm} disabled={!!busy}
                              onChange={(e) => run('ord-auto', 'set_options', { order_auto_confirm: e.target.checked }, e.target.checked ? 'Pedidos do iFood aceitos sozinhos.' : 'Pedidos do iFood esperam o Aceitar em Pedidos iFood.')} />
                            Aceitar sozinho (desligado: alguém aperta "Aceitar" em Pedidos iFood antes do prazo do iFood)
                          </label>
                        )}
                        {cfg.order_mode === 'funnel' && (
                          <label className="flex items-start gap-2 text-xs text-zinc-600 cursor-pointer pl-5">
                            <input type="checkbox" className="mt-0.5" checked={cfg.order_emit_nfce} disabled={!!busy}
                              onChange={(e) => run('ord-nfce', 'set_options', { order_emit_nfce: e.target.checked }, e.target.checked ? 'NFC-e dos pedidos do iFood ligada.' : 'NFC-e dos pedidos do iFood desligada.')} />
                            <span>Emitir NFC-e dos pedidos do iFood — valor da venda (itens + entrega da loja − desconto da loja); pago no app sai como "iFood - online". Precisa do fiscal da loja ligado.</span>
                          </label>
                        )}
                        {cfg.order_mode === 'funnel' && cfg.order_emit_nfce && (
                          <div className="pl-10 space-y-1">
                            <p className="text-[11px] font-semibold text-zinc-500">Quando a nota sai</p>
                            {([
                              ['saida', 'Quando o pedido fica pronto ou sai (recomendado)', 'A NFC-e deve estar autorizada antes de a mercadoria sair (regra da SEFAZ).'],
                              ['conclusao', 'Quando o iFood conclui o pedido', 'Sem risco de cancelamento, mas a nota sai depois de a mercadoria circular.'],
                            ] as const).map(([v, t, d]) => (
                              <label key={v} className="flex items-start gap-2 text-xs text-zinc-600 cursor-pointer">
                                <input type="radio" name="ifood-nfce-momento" className="mt-0.5" checked={(cfg.order_nfce_momento ?? 'saida') === v} disabled={!!busy}
                                  onChange={() => run('ord-nfce-mom', 'set_options', { order_nfce_momento: v }, 'Momento da nota salvo.')} />
                                <span><b className="text-zinc-700">{t}</b> — {d}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="pt-2 flex flex-wrap items-center gap-2">
                        <button disabled={!!busy} className="px-3 py-1.5 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                          onClick={async () => {
                            const r = await run('backfill', 'order_backfill', {});
                            if (r) setOk(`${Number(r.importados ?? 0)} pedido(s) antigo(s) trazidos com itens${Number(r.sem_detalhe ?? 0) ? ` · ${Number(r.sem_detalhe)} sem detalhe no iFood` : ''}.`);
                          }}>
                          {busy === 'backfill' ? 'Buscando… (pode levar 1 min)' : 'Buscar itens dos pedidos dos últimos 15 dias'}
                        </button>
                        <p className="text-[11px] text-zinc-500 w-full">Para pedidos de antes de ligar: o iFood guarda os itens por cerca de 15 dias. Só lê — não mexe em cozinha nem estoque.</p>
                      </div>
                    </div>
                  )}
                </section>
              )}
              {/* Avançado: app próprio (teste) */}
              <section className="rounded-lg border border-zinc-100">
                <button type="button" onClick={() => setAvancado(!avancado)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700">
                  <span>Avançado: app próprio do iFood (teste){!usaSistema && cfg?.client_id ? ' · em uso' : ''}</span>
                  <i className={avancado ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                </button>
                {avancado && <div className="px-3 pb-3 space-y-2">
                <p className="text-[11px] text-zinc-400">Só para testar com um app de teste do Portal do Desenvolvedor. As lojas de verdade usam o app ERPOS PDV, já configurado no sistema.</p>
                <div className="flex gap-1.5">
                  {([['distributed', 'Distribuído (app de teste "D")'], ['centralized', 'Centralizado (app de teste "C")']] as const).map(([k, t]) => (
                    <button key={k} type="button" onClick={() => setAppType(k)}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border ${appType === k ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-600 border-zinc-200'}`}>{t}</button>
                  ))}
                </div>
                <div><label className={lbl}>Client ID</label><input className={inp} value={clientId} onChange={(e) => setClientId(e.target.value)} /></div>
                <div><label className={lbl}>Client Secret {cfg?.has_secret && !usaSistema && <span className="text-emerald-600">(guardado — deixe vazio para manter)</span>}</label>
                  <input className={inp} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></div>
                <button disabled={!!busy || !clientId.trim()} onClick={salvarCredenciais} className="px-4 py-2 rounded-lg bg-zinc-800 text-white text-xs font-bold disabled:opacity-50">
                  {busy === 'cred' ? 'Salvando…' : 'Salvar app próprio'}
                </button>
                {systemAvailable && !usaSistema && cfg?.client_id && (
                  <button disabled={!!busy} onClick={voltarParaSistema} className="ml-2 px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 text-xs font-bold disabled:opacity-50">
                    {busy === 'sistema' ? 'Salvando…' : 'Voltar para o app ERPOS PDV'}
                  </button>
                )}
                </div>}
              </section>
            </>
          )}
          {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{erro}</p>}
          {ok && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">{ok}</p>}
        </div>
      </div>
    </div>
  );
}
