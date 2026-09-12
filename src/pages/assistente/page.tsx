// Assistente pessoal — painel do dono (projeto PESSOAL; ver assistente/README.md).
// Mostra a conversa do WhatsApp, lembretes, memórias e as configurações (lojas
// que o assistente acompanha, resumo da manhã, pareamento do WhatsApp).
// Tudo passa pela Edge assistente-config, que confere o e-mail do dono; o guard
// aqui é só para a UX (mesmo padrão da Contratação).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

const OWNER_EMAIL = 'natalinojr.engel@gmail.com';

type Tab = 'conversa' | 'lembretes' | 'memorias' | 'config';
interface Tenant { id: string; name: string; is_active: boolean }
interface Memory { id: number; content: string; created_at: string }
interface Reminder { id: number; text: string; due_at: string; sent_at: string | null }
interface Message { id: number; role: 'user' | 'assistant'; content: string; channel: string; created_at: string }
interface MorningBrief { enabled: boolean; time: string }
interface Overview {
  settings: { watched_tenant_ids: string[]; default_tenant_id: string | null; morning_brief: MorningBrief };
  tenants: Tenant[];
  memories: Memory[];
  reminders: { pending: Reminder[]; sent: Reminder[] };
  messages: Message[];
  whatsapp: { state: string | null; error?: string; owner_chat_id: string | null };
  usage30d: { replies: number; usd: number };
}

async function call<T = unknown>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('assistente-config', { body: { action, ...extra } });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string; data?: T } | null;
  if (!resp?.success) throw new Error(resp?.error || 'Falha na operação');
  return resp.data as T;
}

const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', cron: 'Automático', test: 'Teste' };

export default function AssistentePage() {
  const { user } = useAuth();
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL;

  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('conversa');
  const [toast, setToast] = useState<{ tipo: 'ok' | 'erro'; msg: string } | null>(null);

  // Configurações (editáveis)
  const [watched, setWatched] = useState<string[]>([]);
  const [principal, setPrincipal] = useState<string>('');
  const [brief, setBrief] = useState<MorningBrief>({ enabled: true, time: '07:30' });
  const [saving, setSaving] = useState(false);

  const [novaMemoria, setNovaMemoria] = useState('');
  const [qr, setQr] = useState<{ open: boolean; img: string | null; loading: boolean; error: string | null }>({ open: false, img: null, loading: false, error: null });

  const flash = (tipo: 'ok' | 'erro', msg: string) => { setToast({ tipo, msg }); setTimeout(() => setToast(null), 3500); };

  const carregar = useCallback(async () => {
    try {
      const data = await call<Overview>('get');
      setOv(data);
      setLoadError(null);
      setWatched(data.settings.watched_tenant_ids);
      setPrincipal(data.settings.default_tenant_id ?? '');
      setBrief(data.settings.morning_brief);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isOwner) carregar(); }, [isOwner, carregar]);

  // Enquanto o QR está aberto, confere a conexão a cada 4 s e fecha sozinho quando parear.
  useEffect(() => {
    if (!qr.open) return;
    const t = setInterval(async () => {
      try {
        const st = await call<{ state: string | null }>('whatsapp_state');
        if (st.state === 'open') {
          setQr({ open: false, img: null, loading: false, error: null });
          flash('ok', 'WhatsApp conectado!');
          carregar();
        }
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 4000);
    return () => clearInterval(t);
  }, [qr.open, carregar]);

  const abrirQr = async () => {
    setQr({ open: true, img: null, loading: true, error: null });
    try {
      const out = await call<{ state: string | null; qr?: string | null }>('whatsapp_connect');
      if (out.state === 'open') { setQr({ open: false, img: null, loading: false, error: null }); flash('ok', 'O WhatsApp já está conectado.'); return; }
      setQr({ open: true, img: out.qr ?? null, loading: false, error: out.qr ? null : 'A Evolution não devolveu o QR Code. Tente de novo.' });
    } catch (e) {
      setQr({ open: true, img: null, loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const salvarConfig = async () => {
    setSaving(true);
    try {
      await call('save_settings', { watched_tenant_ids: watched, default_tenant_id: principal, morning_brief: brief });
      flash('ok', 'Configurações salvas.');
      carregar();
    } catch (e) {
      flash('erro', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleLoja = (id: string) => {
    setWatched((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (!next.includes(principal)) setPrincipal(next[0] ?? '');
      return next;
    });
  };

  const acao = async (fn: () => Promise<unknown>, okMsg: string) => {
    try { await fn(); flash('ok', okMsg); carregar(); } catch (e) { flash('erro', e instanceof Error ? e.message : String(e)); }
  };

  const configAlterada = useMemo(() => {
    if (!ov) return false;
    const s = ov.settings;
    return JSON.stringify([...watched].sort()) !== JSON.stringify([...s.watched_tenant_ids].sort())
      || principal !== (s.default_tenant_id ?? '')
      || brief.enabled !== s.morning_brief.enabled || brief.time !== s.morning_brief.time;
  }, [ov, watched, principal, brief]);

  if (user && !isOwner) return <Navigate to="/modulos" replace />;

  const waOpen = ov?.whatsapp.state === 'open';
  const tabs: { id: Tab; label: string; icon: string; count?: number }[] = [
    { id: 'conversa', label: 'Conversa', icon: 'ri-chat-3-line' },
    { id: 'lembretes', label: 'Lembretes', icon: 'ri-alarm-line', count: ov?.reminders.pending.length },
    { id: 'memorias', label: 'Memórias', icon: 'ri-brain-line', count: ov?.memories.length },
    { id: 'config', label: 'Configurações', icon: 'ri-settings-3-line' },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-violet-50 border border-violet-200">
          <i className="ri-robot-2-line text-xl text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-zinc-900">Assistente</h1>
          <p className="text-xs text-zinc-400">Seu assistente pessoal no WhatsApp</p>
        </div>
        {ov && (
          waOpen ? (
            <span className="flex items-center gap-1.5 px-3 h-9 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> WhatsApp conectado
            </span>
          ) : (
            <button
              onClick={abrirQr}
              className="flex items-center gap-2 px-4 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold cursor-pointer whitespace-nowrap"
            >
              <i className="ri-qr-code-line" /> Conectar WhatsApp
            </button>
          )
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {loadError && !loading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Não foi possível carregar o assistente: {loadError}
          <button onClick={carregar} className="ml-3 underline cursor-pointer">Tentar de novo</button>
        </div>
      )}

      {ov && !loading && (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Lembretes pendentes', value: ov.reminders.pending.length, icon: 'ri-alarm-line' },
              { label: 'Memórias', value: ov.memories.length, icon: 'ri-brain-line' },
              { label: 'Respostas (30 dias)', value: ov.usage30d.replies, icon: 'ri-chat-check-line' },
              { label: 'Custo IA estimado (30 dias)', value: `US$ ${ov.usage30d.usd.toFixed(2)}`, icon: 'ri-money-dollar-circle-line' },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-semibold">
                  <i className={c.icon} /> {c.label}
                </div>
                <p className="text-lg font-black text-zinc-900 mt-0.5">{c.value}</p>
              </div>
            ))}
          </div>

          {/* Abas */}
          <div className="flex gap-1 mb-4 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3.5 h-9 rounded-xl text-sm font-bold cursor-pointer whitespace-nowrap transition-colors ${
                  tab === t.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'
                }`}
              >
                <i className={t.icon} /> {t.label}
                {!!t.count && <span className={`text-[10px] px-1.5 rounded-full ${tab === t.id ? 'bg-white/20' : 'bg-zinc-200 text-zinc-600'}`}>{t.count}</span>}
              </button>
            ))}
          </div>

          {/* Conversa */}
          {tab === 'conversa' && (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 space-y-2 max-h-[65vh] overflow-y-auto">
              {ov.messages.length === 0 && <p className="text-sm text-zinc-400 text-center py-10">Nenhuma conversa ainda.</p>}
              {ov.messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                    m.role === 'user' ? 'bg-violet-600 text-white rounded-br-md' : 'bg-white border border-zinc-200 text-zinc-800 rounded-bl-md'
                  }`}>
                    {m.content}
                    <div className={`text-[10px] mt-1 ${m.role === 'user' ? 'text-violet-200' : 'text-zinc-400'}`}>
                      {fmt(m.created_at)} · {CHANNEL_LABEL[m.channel] ?? m.channel}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Lembretes */}
          {tab === 'lembretes' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                <p className="px-4 py-2.5 text-xs font-bold text-zinc-600 border-b border-zinc-100">Agendados</p>
                {ov.reminders.pending.length === 0 && <p className="px-4 py-6 text-sm text-zinc-400 text-center">Nenhum lembrete agendado. Peça no WhatsApp: "me lembra sexta 9h de…"</p>}
                <ul className="divide-y divide-zinc-50">
                  {ov.reminders.pending.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      <i className="ri-alarm-line text-violet-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-800 truncate">{r.text}</p>
                        <p className="text-[11px] text-zinc-400">{fmt(r.due_at)}</p>
                      </div>
                      <button
                        onClick={() => acao(() => call('cancel_reminder', { id: r.id }), 'Lembrete cancelado.')}
                        className="text-xs text-zinc-400 hover:text-red-600 cursor-pointer"
                      >Cancelar</button>
                    </li>
                  ))}
                </ul>
              </div>
              {ov.reminders.sent.length > 0 && (
                <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                  <p className="px-4 py-2.5 text-xs font-bold text-zinc-600 border-b border-zinc-100">Enviados recentemente</p>
                  <ul className="divide-y divide-zinc-50">
                    {ov.reminders.sent.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 opacity-60">
                        <i className="ri-check-line text-emerald-500" />
                        <p className="flex-1 min-w-0 text-sm text-zinc-700 truncate">{r.text}</p>
                        <p className="text-[11px] text-zinc-400">{r.sent_at ? fmt(r.sent_at) : ''}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Memórias */}
          {tab === 'memorias' && (
            <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const c = novaMemoria.trim();
                  if (!c) return;
                  acao(async () => { await call('add_memory', { content: c }); setNovaMemoria(''); }, 'Memória salva.');
                }}
                className="flex gap-2 p-3 border-b border-zinc-100"
              >
                <input
                  value={novaMemoria}
                  onChange={(e) => setNovaMemoria(e.target.value)}
                  placeholder="Algo que o assistente deve sempre lembrar…"
                  className="flex-1 h-10 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-400"
                />
                <button type="submit" className="px-4 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold cursor-pointer">Adicionar</button>
              </form>
              {ov.memories.length === 0 && <p className="px-4 py-6 text-sm text-zinc-400 text-center">Nenhuma memória ainda.</p>}
              <ul className="divide-y divide-zinc-50">
                {ov.memories.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-4 py-2.5">
                    <i className="ri-brain-line text-violet-500 mt-0.5" />
                    <p className="flex-1 min-w-0 text-sm text-zinc-800">{m.content}</p>
                    <button
                      onClick={() => acao(() => call('delete_memory', { id: m.id }), 'Memória removida.')}
                      className="text-xs text-zinc-400 hover:text-red-600 cursor-pointer"
                    >Esquecer</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Configurações */}
          {tab === 'config' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-sm font-bold text-zinc-800">Lojas que o assistente acompanha</p>
                <p className="text-xs text-zinc-400 mb-3">Vendas, caixa, contas e estoque só são consultados nas lojas marcadas. A principal é usada quando você não diz a loja.</p>
                <ul className="space-y-1.5">
                  {ov.tenants.map((t) => {
                    const on = watched.includes(t.id);
                    return (
                      <li key={t.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl border ${on ? 'border-violet-200 bg-violet-50/50' : 'border-zinc-100'}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleLoja(t.id)} className="w-4 h-4 accent-violet-600 cursor-pointer" />
                        <span className={`flex-1 text-sm ${on ? 'text-zinc-900 font-semibold' : 'text-zinc-500'}`}>
                          {t.name}{!t.is_active && <span className="ml-2 text-[10px] text-zinc-400">(inativa)</span>}
                        </span>
                        {on && (
                          <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                            <input type="radio" name="principal" checked={principal === t.id} onChange={() => setPrincipal(t.id)} className="accent-violet-600" />
                            Principal
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-zinc-800">Resumo da manhã</p>
                    <p className="text-xs text-zinc-400">Tarefas do dia, lembretes, contas vencendo e estoque crítico, no WhatsApp.</p>
                  </div>
                  <button
                    onClick={() => setBrief((b) => ({ ...b, enabled: !b.enabled }))}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${brief.enabled ? 'bg-violet-600' : 'bg-zinc-300'}`}
                    aria-label="Ligar ou desligar o resumo da manhã"
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${brief.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </div>
                {brief.enabled && (
                  <label className="flex items-center gap-2 mt-3 text-sm text-zinc-600">
                    Horário
                    <input
                      type="time"
                      value={brief.time}
                      onChange={(e) => setBrief((b) => ({ ...b, time: e.target.value }))}
                      className="h-9 px-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-violet-400"
                    />
                  </label>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-sm font-bold text-zinc-800">WhatsApp</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {waOpen ? 'Conectado.' : ov.whatsapp.state ? `Desconectado (${ov.whatsapp.state}).` : `Sem resposta do servidor${ov.whatsapp.error ? `: ${ov.whatsapp.error}` : ''}.`}
                  {ov.whatsapp.owner_chat_id && <> Respondo só a <b>{ov.whatsapp.owner_chat_id.replace(/@.*$/, '')}</b>.</>}
                </p>
                {!waOpen && (
                  <button onClick={abrirQr} className="mt-3 flex items-center gap-2 px-3 h-9 rounded-xl border border-violet-200 text-violet-700 text-sm font-bold hover:bg-violet-50 cursor-pointer">
                    <i className="ri-qr-code-line" /> Mostrar QR Code
                  </button>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={salvarConfig}
                  disabled={!configAlterada || saving || watched.length === 0}
                  className="px-5 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold cursor-pointer"
                >
                  {saving ? 'Salvando…' : 'Salvar configurações'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* QR Code de pareamento */}
      {qr.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setQr((q) => ({ ...q, open: false }))}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-black text-zinc-900">Conectar o WhatsApp do assistente</p>
            <p className="text-xs text-zinc-500 mt-1 mb-4">
              No celular com o número do assistente: WhatsApp Business › ⋮ › <b>Aparelhos conectados</b> › Conectar aparelho, e aponte para o código.
            </p>
            {qr.loading && <div className="mx-auto w-6 h-6 my-16 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />}
            {qr.img && <img src={qr.img} alt="QR Code do WhatsApp" className="mx-auto w-64 h-64" />}
            {qr.error && <p className="text-sm text-red-600 my-6">{qr.error}</p>}
            <div className="flex gap-2 justify-center mt-4">
              <button onClick={abrirQr} className="px-4 h-9 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer">Gerar outro</button>
              <button onClick={() => setQr((q) => ({ ...q, open: false }))} className="px-4 h-9 rounded-xl bg-zinc-900 text-white text-sm font-bold cursor-pointer">Fechar</button>
            </div>
            <p className="text-[11px] text-zinc-400 mt-3">O código expira em ~40 s. Esta janela fecha sozinha quando conectar.</p>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg ${
          toast.tipo === 'ok' ? 'bg-zinc-900 text-white' : 'bg-red-600 text-white'
        }`}>{toast.msg}</div>
      )}
    </div>
  );
}
