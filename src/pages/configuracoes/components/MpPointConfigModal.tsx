import { useState, useEffect } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

// ── Maquininha do autoatendimento (Mercado Pago Point em modo PDV) ──────────
// Token da aplicação "Point" do Mercado Pago (separada do Pix online) + qual terminal
// é o do tablet. O token nunca volta pro front. Em modo PDV a maquininha só aceita
// cobranças enviadas pelo sistema — o botão "Voltar ao modo normal" devolve a
// maquininha pro uso manual se o sistema estiver fora do ar.

const TERMINAL_TESTE = 'NEWLAND_N950__SBX0000001';

interface ConfigInfo {
  configured: boolean;
  is_active: boolean;
  environment: 'production' | 'sandbox';
  terminal_id: string | null;
  token_hint: string | null;
  last_test_at: string | null;
}
interface Terminal { id: string; operating_mode: string }

interface Props {
  onClose: () => void;
  onSaved?: (info: { is_active: boolean }) => void;
}

export default function MpPointConfigModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const tenantId = user?.tenantId ?? '';

  const [info, setInfo] = useState<ConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [ambiente, setAmbiente] = useState<'production' | 'sandbox'>('production');
  const [terminalId, setTerminalId] = useState('');
  const [terminais, setTerminais] = useState<Terminal[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [trocandoModo, setTrocandoModo] = useState(false);
  const [ativo, setAtivo] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    invokeWithAuth<ConfigInfo>('pix-payment', { body: { action: 'get_point_config', tenant_id: tenantId } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) { setErro(error?.message || 'Erro ao carregar'); return; }
        setInfo(data);
        setAmbiente(data.environment ?? 'production');
        setTerminalId(data.terminal_id ?? '');
        setAtivo(data.configured ? Boolean(data.is_active) : true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const buscarTerminais = async () => {
    setBuscando(true);
    setErro('');
    const body: Record<string, unknown> = { action: 'list_point_terminals', tenant_id: tenantId };
    if (token.trim()) body.access_token = token.trim();
    const { data, error } = await invokeWithAuth<{ terminals: Terminal[] }>('pix-payment', { body });
    setBuscando(false);
    if (error || !data) { setErro(error?.message || 'Não foi possível listar as maquininhas'); return; }
    setTerminais(data.terminals ?? []);
    if ((data.terminals ?? []).length === 1 && !terminalId) setTerminalId(data.terminals[0].id);
  };

  const trocarModo = async (mode: 'PDV' | 'STANDALONE') => {
    if (!terminalId) return;
    setTrocandoModo(true);
    setErro('');
    const { data, error } = await invokeWithAuth<{ ok?: boolean; operating_mode?: string }>('pix-payment', {
      body: { action: 'set_point_mode', tenant_id: tenantId, terminal_id: terminalId, mode },
    });
    setTrocandoModo(false);
    if (error || !data?.ok) { setErro(error?.message || 'Não foi possível trocar o modo da maquininha'); return; }
    toastSuccess(mode === 'PDV' ? 'Maquininha em modo PDV — recebe as cobranças do sistema' : 'Maquininha de volta ao modo normal (cobrança manual)');
    setTerminais(prev => prev ? prev.map(t => t.id === terminalId ? { ...t, operating_mode: data.operating_mode ?? mode } : t) : prev);
  };

  const salvar = async () => {
    if (!tenantId) return;
    setSaving(true);
    setErro('');
    const body: Record<string, unknown> = { action: 'save_point_config', tenant_id: tenantId, environment: ambiente, terminal_id: terminalId.trim(), is_active: ativo };
    if (token.trim()) body.access_token = token.trim();
    const { data, error } = await invokeWithAuth<{ ok?: boolean; is_active: boolean }>('pix-payment', { body });
    setSaving(false);
    if (error || !data?.ok) { setErro(error?.message || 'Erro ao salvar'); return; }
    toastSuccess(data.is_active ? 'Maquininha ativada no autoatendimento' : 'Configuração salva');
    setToken('');
    setInfo(prev => prev ? { ...prev, configured: true, is_active: data.is_active, environment: ambiente, terminal_id: terminalId.trim() } : prev);
    onSaved?.({ is_active: data.is_active });
  };

  const modoAtual = terminais?.find(t => t.id === terminalId)?.operating_mode;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white w-full max-w-lg rounded-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-sky-600 rounded-xl">
              <i className="ri-bank-card-line text-white text-lg" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Maquininha do autoatendimento</h2>
              <p className="text-[11px] text-zinc-400">Mercado Pago Point · a cobrança do tablet aparece na maquininha</p>
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
              <div className={`rounded-xl p-3.5 border ${info?.is_active ? 'bg-emerald-50 border-emerald-200' : info?.configured ? 'bg-amber-50 border-amber-200' : 'bg-zinc-50 border-zinc-200'}`}>
                <p className={`text-sm font-bold ${info?.is_active ? 'text-emerald-800' : info?.configured ? 'text-amber-800' : 'text-zinc-700'}`}>
                  {info?.is_active ? `Ativa${info.environment === 'sandbox' ? ' — MODO TESTE' : ''}` : info?.configured ? 'Configurada, mas desligada' : 'Não configurada'}
                </p>
                {info?.configured && (
                  <p className="text-[11px] text-zinc-500 mt-0.5">Terminal {info.terminal_id || '—'}{info.token_hint ? ` · token ${info.token_hint}` : ''}</p>
                )}
              </div>

              <div className="text-[11px] text-zinc-600 bg-sky-50 border border-sky-100 rounded-xl p-3.5 space-y-1.5">
                <p className="font-bold text-sky-800 text-xs">Como configurar</p>
                <p>1. Use a aplicação <strong>"ERPOS Autoatendimento Point"</strong> (Suas integrações no Mercado Pago) e copie o <strong>Access Token</strong>.</p>
                <p>2. Clique em <strong>Buscar maquininhas</strong>, escolha a do tablet e ligue o <strong>modo PDV</strong>.</p>
                <p>3. Em modo PDV a maquininha só cobra o que o sistema mandar. Se o sistema cair, use <strong>Voltar ao modo normal</strong>.</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(['production', 'sandbox'] as const).map(a => (
                  <button key={a} type="button" onClick={() => setAmbiente(a)}
                    className={`py-2 text-xs font-semibold rounded-lg border cursor-pointer ${ambiente === a ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
                    {a === 'production' ? 'Maquininha real' : 'Teste (maquininha virtual)'}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Access Token {info?.configured && <span className="font-normal text-zinc-400">(em branco mantém o atual)</span>}
                </label>
                <input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" placeholder="APP_USR-…"
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                {ambiente === 'sandbox' && <p className="text-[10px] text-zinc-400 mt-1">No teste, use o token de produção da <strong>conta vendedora de teste</strong>.</p>}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-zinc-700">Maquininha do tablet</label>
                  <div className="flex gap-2">
                    {ambiente === 'sandbox' && (
                      <button type="button" onClick={() => setTerminalId(TERMINAL_TESTE)} className="text-[11px] font-semibold text-sky-700 hover:underline cursor-pointer">Usar maquininha virtual</button>
                    )}
                    <button type="button" onClick={buscarTerminais} disabled={buscando} className="text-[11px] font-semibold text-amber-700 hover:underline cursor-pointer disabled:opacity-50">
                      {buscando ? 'Buscando…' : 'Buscar maquininhas'}
                    </button>
                  </div>
                </div>
                {terminais && terminais.length > 0 ? (
                  <select value={terminalId} onChange={e => setTerminalId(e.target.value)}
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400">
                    <option value="">Escolha…</option>
                    {terminais.map(t => <option key={t.id} value={t.id}>{t.id} · {t.operating_mode}</option>)}
                  </select>
                ) : (
                  <input value={terminalId} onChange={e => setTerminalId(e.target.value)} placeholder="TIPO__NUMERO-DE-SÉRIE"
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                )}
                {terminais && terminais.length === 0 && <p className="text-[10px] text-zinc-400 mt-1">Nenhuma maquininha ligada a essa conta.</p>}
                {ambiente === 'production' && terminalId && (
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={() => trocarModo('PDV')} disabled={trocandoModo}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 text-white hover:bg-sky-700 cursor-pointer disabled:opacity-50">Ligar modo PDV</button>
                    <button type="button" onClick={() => trocarModo('STANDALONE')} disabled={trocandoModo}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 cursor-pointer disabled:opacity-50">Voltar ao modo normal</button>
                  </div>
                )}
                {modoAtual && <p className="text-[10px] text-zinc-500 mt-1">Modo atual: <strong>{modoAtual}</strong></p>}
              </div>

              <label className="flex items-center justify-between p-3 border border-zinc-200 rounded-xl cursor-pointer">
                <div>
                  <p className="text-sm font-semibold text-zinc-800">Cobrar cartão na maquininha pelo tablet</p>
                  <p className="text-[11px] text-zinc-400">Desligado, cartão no tablet vira "pague no balcão"</p>
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
          <button onClick={() => { if (!terminalId.trim()) { toastError('Escolha a maquininha'); return; } salvar(); }} disabled={saving || loading}
            className="flex-1 py-2 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            {saving ? 'Validando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
