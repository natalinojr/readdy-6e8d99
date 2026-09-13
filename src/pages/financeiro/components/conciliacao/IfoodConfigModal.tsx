import { useState, useEffect, useCallback, useRef } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';

// Integração iFood (edge ifood-financial). Dois caminhos para o mesmo resultado:
//   • API (app distribuído do Portal do Desenvolvedor): credenciais → código de vínculo
//     digitado pela loja no Portal do Parceiro → código de autorização colado aqui.
//   • Arquivo: "Relatório de Conciliação" baixado no Portal do Parceiro (Financeiro › Exportar).
// O Client Secret nunca volta para o front (get_config devolve só has_secret).

interface IfoodConfig {
  client_id: string | null;
  has_secret: boolean;
  merchant_id: string | null;
  merchant_name: string | null;
  authorized: boolean;
  authorized_at: string | null;
  user_code: string | null;
  verification_url: string | null;
  auto_sync: boolean;
  post_to_ledger: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  homologation_mode?: boolean;
  app_type?: 'distributed' | 'centralized';
}

interface ImportRow {
  id: string; competence: string; source: 'api' | 'file'; file_name: string | null;
  lines: number; orders: number; gross: number; fees: number; net: number; updated_at: string;
}

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Resp = { success?: boolean; error?: string; message?: string };

const compLabel = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function IfoodConfigModal({ onClose, onImported }: Props) {
  const { user } = useAuth();
  const [cfg, setCfg] = useState<IfoodConfig | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [postToLedger, setPostToLedger] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [appType, setAppType] = useState<'distributed' | 'centralized'>('distributed');
  const [merchants, setMerchants] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [c, i] = await Promise.all([
      invokeWithAuth<Resp & { config?: IfoodConfig | null }>('ifood-financial', { body: { action: 'get_config', tenant_id: user?.tenantId } }),
      invokeWithAuth<Resp & { imports?: ImportRow[] }>('ifood-financial', { body: { action: 'list_imports', tenant_id: user?.tenantId } }),
    ]);
    const conf = c.data?.config ?? null;
    setCfg(conf);
    if (conf) {
      setAutoSync(conf.auto_sync !== false);
      setPostToLedger(conf.post_to_ledger === true);
      setAppType(conf.app_type === 'centralized' ? 'centralized' : 'distributed');
    }
    setImports(i.data?.imports ?? []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load]);

  const call = async <T,>(label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setResult(null);
    const r = await invokeWithAuth<Resp & T>('ifood-financial', { body: { ...body, tenant_id: user?.tenantId } });
    setBusy(null);
    const err = r.data?.error ?? r.error?.message;
    if (err || !r.data?.success) { setResult({ ok: false, msg: err || 'Falhou.' }); return null; }
    return r.data;
  };

  const handleSave = async () => {
    if (!clientId.trim() && !cfg?.client_id) { setResult({ ok: false, msg: 'Informe o Client ID.' }); return; }
    const d = await call('save', {
      action: 'save_config',
      client_id: clientId.trim() || undefined,
      client_secret: clientSecret.trim(),
      auto_sync: autoSync,
      app_type: appType,
    });
    if (!d) return;
    setClientSecret('');
    setResult({ ok: true, msg: d.message || 'Configuração salva.' });
    load();
  };

  // Modo homologação: toda chamada à API vai com x-request-homologation: true (ambiente de teste).
  const handleHomolog = async (on: boolean) => {
    const d = await call('homolog', { action: 'set_options', homologation_mode: on });
    if (!d) return;
    setResult({ ok: true, msg: on ? 'Modo homologação ligado: as chamadas vão marcadas como teste para o iFood.' : 'Modo homologação desligado.' });
    load();
  };

  // Grava na hora (não depende das credenciais da API) e relança os meses já importados.
  const handleLedger = async (on: boolean) => {
    setPostToLedger(on);
    const d = await call<{ ledger?: { rows: number; receita: number; taxas: number } }>('ledger', { action: 'set_options', post_to_ledger: on });
    if (!d) { setPostToLedger(!on); return; }
    setResult({
      ok: true,
      msg: on
        ? `Lançado no financeiro: vendas ${formatCurrency(d.ledger?.receita ?? 0)} e taxas ${formatCurrency(d.ledger?.taxas ?? 0)} dos repasses já pagos. Os próximos entram sozinhos na data do repasse.`
        : 'Lançamentos do iFood removidos do financeiro.',
    });
    load();
    onImported();
  };

  const handleUserCode = async () => {
    const d = await call<{ user_code?: string; verification_url?: string }>('code', { action: 'request_user_code' });
    if (!d) return;
    setResult({ ok: true, msg: `Código gerado: ${d.user_code}. Digite no Portal do Parceiro (Configurações › Aplicativos) e cole abaixo o código de autorização que ele mostrar.` });
    load();
  };

  const handleConfirm = async () => {
    const d = await call<{ merchants?: { id: string; name: string }[]; merchant_id?: string | null }>('confirm', { action: 'confirm_authorization', authorization_code: authCode.trim() });
    if (!d) return;
    setAuthCode('');
    if (!d.merchant_id && (d.merchants?.length ?? 0) > 1) {
      setMerchants(d.merchants ?? []);
      setResult({ ok: true, msg: 'Autorizado. Escolha abaixo qual loja do iFood é esta.' });
    } else {
      setResult({ ok: true, msg: 'Autorizado! Os dados do iFood passam a ser buscados todo dia às 07h20 e ao abrir a Conciliação.' });
    }
    load();
  };

  // App centralizado: sem código — pega o token direto e lista as lojas liberadas para o app.
  const handleConnectCentral = async () => {
    const d = await call<{ merchants?: { id: string; name: string }[]; merchant_id?: string | null }>('connect', { action: 'connect_centralized' });
    if (!d) return;
    if (!d.merchant_id && (d.merchants?.length ?? 0) > 1) {
      setMerchants(d.merchants ?? []);
      setResult({ ok: true, msg: 'Conectado. Escolha abaixo qual loja do iFood usar.' });
    } else if ((d.merchants?.length ?? 0) === 0) {
      setResult({ ok: false, msg: 'Conectou, mas o iFood não liberou nenhuma loja para este app.' });
    } else {
      setResult({ ok: true, msg: `Conectado à loja ${d.merchants?.[0]?.name ?? ''}. Clique em "Buscar agora" para puxar os dados.` });
    }
    load();
  };

  const handleSelectMerchant = async (m: { id: string; name: string }) => {
    const d = await call('merchant', { action: 'select_merchant', merchant_id: m.id, merchant_name: m.name });
    if (!d) return;
    setMerchants([]);
    load();
  };

  const handleSyncNow = async () => {
    const d = await call<{ results?: Array<{ competence: string; lines?: number; error?: string; skipped?: boolean; unchanged?: boolean }> }>('sync', { action: 'sync' });
    if (!d) return;
    const parts = (d.results ?? []).map((r) => `${compLabel(r.competence)}: ${r.error ? 'erro' : r.skipped ? 'sem arquivo' : r.unchanged ? 'sem mudança' : `${r.lines} linha(s)`}`);
    setResult({ ok: true, msg: `Atualizado · ${parts.join(' · ') || 'nada a buscar'}` });
    load();
    onImported();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setResult({ ok: false, msg: 'Arquivo muito grande (máx. 10 MB).' }); return; }
    const b64 = await fileToBase64(file);
    const d = await call<{ results?: Array<{ competence: string; lines: number; orders: number; gross: number; fees: number; net: number; matched_deposits: number; ledger: { rows: number } }> }>('file', { action: 'import_file', file_b64: b64, file_name: file.name });
    if (!d) return;
    // Relatório de Cardápio (produtos vendidos) — a edge reconhece pelas abas Itens/Complementos.
    const card = (d as unknown as { cardapio?: { period_start: string; period_end: string; itens: number; complementos: number; lojas: { nome: string; codigo: string }[] } }).cardapio;
    if (card) {
      const dd = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;
      setResult({ ok: true, msg: `Cardápio de ${dd(card.period_start)} a ${dd(card.period_end)}: ${card.itens} produto(s) e ${card.complementos} complemento(s)${card.lojas.length ? ` · ${card.lojas.map((l) => `${l.nome} (${l.codigo})`).join(', ')}` : ''}. Veja em iFood › Produtos.` });
      load();
      onImported();
      return;
    }
    const msg = (d.results ?? []).map((r) =>
      `${compLabel(r.competence)}: ${r.orders} pedido(s), vendas ${formatCurrency(r.gross)} − taxas ${formatCurrency(r.fees)} = ${formatCurrency(r.net)} · ${r.matched_deposits} depósito(s) casado(s) com o Inter${r.ledger.rows ? ` · ${r.ledger.rows} lançamento(s) no financeiro` : ''}`,
    ).join('\n');
    setResult({ ok: true, msg });
    load();
    onImported();
  };

  const handleRemove = async () => {
    if (!window.confirm('Remover a integração com o iFood? Os relatórios já importados continuam.')) return;
    const d = await call('remove', { action: 'delete_config' });
    if (d) { load(); setResult({ ok: true, msg: 'Integração removida.' }); }
  };

  const spinner = <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />;
  const inputCls = 'w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 font-mono';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-100">
              <i className="ri-restaurant-2-line text-red-600 text-lg" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Integração iFood</h3>
              <p className="text-xs text-zinc-500">Vendas, comissões, taxas e repasses</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-5 overflow-y-auto">
            {/* ── Relatório do portal (funciona já, sem API) ── */}
            <div className="rounded-xl border border-zinc-200 p-4 space-y-3">
              <p className="text-sm font-semibold text-zinc-800 flex items-center gap-1.5"><i className="ri-file-excel-2-line text-green-600" /> Importar relatório do Portal do Parceiro</p>
              <p className="text-xs text-zinc-500">
                No Portal do Parceiro: <strong>Financeiro › Exportar</strong>, depois <strong>Relatórios › Exportações › Baixar</strong> (se abrir uma página cinza, aperte Ctrl+S). Aceita .xlsx, .csv e .csv.gz. Reimportar o mesmo mês substitui o anterior. O relatório de <strong>Cardápio</strong> (Relatórios › Cardápio) também entra por aqui e vai para a aba Produtos.
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.gz" className="hidden" onChange={handleFile} />
              <button onClick={() => fileRef.current?.click()} disabled={busy !== null}
                className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800 text-white rounded-lg text-sm font-semibold hover:bg-zinc-900 cursor-pointer disabled:opacity-50">
                {busy === 'file' ? <>{spinner} Importando...</> : <><i className="ri-upload-2-line" /> Escolher arquivo</>}
              </button>
              {imports.length > 0 && (
                <div className="text-xs text-zinc-600 space-y-1">
                  {imports.slice(0, 6).map((i) => (
                    <div key={i.id} className="flex justify-between gap-2 border-t border-zinc-100 pt-1">
                      <span>{compLabel(i.competence)} · {i.orders} pedidos · {i.source === 'api' ? 'API' : 'arquivo'}</span>
                      <span className="font-mono">{formatCurrency(Number(i.gross))} − {formatCurrency(Number(i.fees))} = <strong>{formatCurrency(Number(i.net))}</strong></span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={postToLedger} disabled={busy !== null} onChange={(e) => handleLedger(e.target.checked)} className="rounded mt-0.5" />
              <span>
                Lançar no financeiro as vendas do iFood e as comissões/taxas de cada repasse já pago (entram na DRE, em Receitas e no Fluxo de Caixa).
                <span className="block text-zinc-400 mt-0.5">Grava na hora e vale para os meses já importados. Para aparecer em Receitas e na DRE, a fonte "Conciliação iFood" precisa estar ligada em Receitas › Fontes. Desligar remove os lançamentos do iFood.</span>
              </span>
            </label>

            {/* ── API ── */}
            <div className="rounded-xl border border-zinc-200 p-4 space-y-3">
              <p className="text-sm font-semibold text-zinc-800 flex items-center gap-1.5"><i className="ri-plug-line text-red-600" /> Busca automática pela API do iFood</p>

              {cfg?.client_id && (
                <div className={`flex items-start gap-2 px-3 py-2 rounded-xl border text-xs ${cfg.last_sync_error ? 'bg-red-50 border-red-200' : cfg.authorized && cfg.merchant_id ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                  <i className={`${cfg.last_sync_error ? 'ri-error-warning-fill text-red-600' : cfg.authorized && cfg.merchant_id ? 'ri-checkbox-circle-fill text-green-600' : 'ri-time-line text-amber-600'} mt-0.5`} />
                  <div className="flex-1">
                    <p className="font-semibold text-zinc-800">
                      {cfg.authorized && cfg.merchant_id ? `Conectado${cfg.merchant_name ? ` · ${cfg.merchant_name}` : ''}` : cfg.authorized ? 'Autorizado — falta escolher a loja' : 'Credenciais salvas — falta a loja autorizar'}
                    </p>
                    {cfg.last_sync_at && <p className="text-zinc-600">Última busca: {new Date(cfg.last_sync_at).toLocaleString('pt-BR')}</p>}
                    {cfg.last_sync_error && <p className="text-red-700 mt-1">Último erro: {cfg.last_sync_error}</p>}
                  </div>
                </div>
              )}

              <ol className="space-y-1 text-xs text-zinc-600 list-decimal pl-4">
                <li>No <strong>Portal do Desenvolvedor</strong> do iFood › Meus aplicativos, abra o app <strong>distribuído</strong> e copie o Client ID e o Client Secret.</li>
                <li>Salve aqui e clique em <strong>Gerar código</strong>.</li>
                <li>No <strong>Portal do Parceiro</strong> da loja, digite o código para autorizar o app. Ele mostra um <strong>código de autorização</strong>: cole abaixo.</li>
              </ol>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Tipo do aplicativo</label>
                <div className="flex gap-2">
                  {([['distributed', 'Distribuído (código da loja)'], ['centralized', 'Centralizado (sem código)']] as const).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setAppType(k)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold cursor-pointer ${appType === k ? 'border-red-400 bg-red-50 text-red-700' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">Para testar: app "Teste (C)" = centralizado, já liberado na loja de teste.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Client ID</label>
                <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={cfg?.client_id ?? 'Cole o Client ID'} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Client Secret</label>
                <div className="relative">
                  <input type={showSecret ? 'text' : 'password'} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={cfg?.has_secret ? '•••••••••••• (manter o atual)' : 'Cole o Client Secret'} className={inputCls + ' pr-10'} />
                  <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer">
                    <i className={showSecret ? 'ri-eye-off-line' : 'ri-eye-line'} />
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} className="rounded" />
                Buscar todo dia às 07h20 e ao abrir a Conciliação
              </label>
              <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
                <input type="checkbox" checked={cfg?.homologation_mode === true} disabled={busy !== null} onChange={(e) => handleHomolog(e.target.checked)} className="rounded mt-0.5" />
                <span>Modo homologação (app de teste)
                  <span className="block text-zinc-400">Marca todas as chamadas como teste (header x-request-homologation). Use com o app de teste e a loja de teste do iFood; desligue quando o app oficial for aprovado.</span>
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button onClick={handleSave} disabled={busy !== null}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 cursor-pointer disabled:opacity-50">
                  {busy === 'save' ? <>{spinner} Salvando...</> : <><i className="ri-save-line" /> Salvar</>}
                </button>
                {cfg?.client_id && cfg.app_type === 'centralized' && (
                  <button onClick={handleConnectCentral} disabled={busy !== null}
                    className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-50 cursor-pointer disabled:opacity-50">
                    {busy === 'connect' ? 'Conectando...' : <><i className="ri-plug-line" /> Conectar</>}
                  </button>
                )}
                {cfg?.client_id && cfg.app_type !== 'centralized' && (
                  <button onClick={handleUserCode} disabled={busy !== null}
                    className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-50 cursor-pointer disabled:opacity-50">
                    {busy === 'code' ? 'Gerando...' : <><i className="ri-key-2-line" /> Gerar código</>}
                  </button>
                )}
                {cfg?.authorized && cfg.merchant_id && (
                  <button onClick={handleSyncNow} disabled={busy !== null}
                    className="flex items-center gap-2 px-4 py-2 border border-zinc-300 text-zinc-700 rounded-lg text-sm font-semibold hover:bg-zinc-50 cursor-pointer disabled:opacity-50">
                    {busy === 'sync' ? 'Buscando...' : <><i className="ri-refresh-line" /> Buscar agora</>}
                  </button>
                )}
              </div>

              {cfg?.user_code && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-red-800">Código de vínculo (vale por alguns minutos):</p>
                  <p className="text-2xl font-bold font-mono tracking-widest text-red-700">{cfg.user_code}</p>
                  {cfg.verification_url && (
                    <a href={cfg.verification_url} target="_blank" rel="noreferrer" className="text-xs text-red-700 underline">Abrir o Portal do Parceiro para autorizar</a>
                  )}
                  <div className="flex gap-2">
                    <input type="text" value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="Código de autorização" className={inputCls} />
                    <button onClick={handleConfirm} disabled={busy !== null || !authCode.trim()}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 cursor-pointer disabled:opacity-50 whitespace-nowrap">
                      {busy === 'confirm' ? '...' : 'Confirmar'}
                    </button>
                  </div>
                </div>
              )}

              {merchants.length > 1 && (
                <div className="space-y-1">
                  {merchants.map((m) => (
                    <button key={m.id} onClick={() => handleSelectMerchant(m)} className="w-full text-left px-3 py-2 border border-zinc-200 rounded-lg text-sm hover:bg-zinc-50 cursor-pointer">
                      {m.name} <span className="text-xs text-zinc-400 font-mono">{m.id.slice(0, 8)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {result && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium whitespace-pre-line ${result.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                <i className={`${result.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
                <span className="break-words">{result.msg}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              {cfg?.client_id && (
                <button onClick={handleRemove} disabled={busy !== null} className="px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg cursor-pointer disabled:opacity-50">Remover API</button>
              )}
              <div className="flex-1" />
              <button onClick={onClose} className="px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer">Fechar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
