import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Pix permitidos: pessoas (além dos fornecedores) para quem o assistente pode preparar Pix
// pela conta do Inter. Ver, incluir, editar e remover exigem o PIN desta lista, criado pelo
// próprio dono na primeira vez. O PIN fica só na memória desta tela enquanto a lista está
// aberta e some sozinho depois de 5 minutos parado. O assistente não tem como mexer aqui.

type Item = { id: string; name: string; pix_key: string; pix_key_kind: string; created_at?: string };
type Resp<T> = { success?: boolean; data?: T; error?: string };

const IDLE_MS = 5 * 60_000;
const KIND: Record<string, string> = { cpf: 'CPF', cnpj: 'CNPJ', telefone: 'Telefone', email: 'E-mail', evp: 'Aleatória' };

// Mesmo padrão do call() da página: a edge responde { success, data } ou { success:false, error }
// (às vezes com status 4xx/5xx — aí a mensagem vem no corpo do erro).
async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke('assistente-config', { body: { action, ...body } });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    return { ok: false, error: msg };
  }
  const r = data as Resp<T> | null;
  if (!r?.success) return { ok: false, error: r?.error || 'Erro inesperado.' };
  return { ok: true, data: r.data };
}

const pinInput = 'w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-lg tracking-[0.4em] text-center font-mono focus:outline-none focus:ring-2 focus:ring-violet-400';
const input = 'w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400';

export default function PixPermitidosCard() {
  const [status, setStatus] = useState<{ has_pin: boolean; locked_until: string | null } | null>(null);
  const [mode, setMode] = useState<'loading' | 'create' | 'locked' | 'open'>('loading');
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // campos
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinTry, setPinTry] = useState('');
  const [name, setName] = useState('');
  const [chave, setChave] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const pinRef = useRef<string | null>(null); // PIN só em memória, enquanto a lista está aberta
  const idleRef = useRef<number | null>(null);

  const lock = useCallback((text?: string) => {
    pinRef.current = null;
    setItems([]); setEditId(null); setName(''); setChave(''); setPinTry('');
    setMode('locked');
    if (text) setMsg({ ok: true, text });
  }, []);
  const touch = useCallback(() => {
    if (idleRef.current) window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => lock('Lista trancada de novo depois de 5 minutos parada.'), IDLE_MS);
  }, [lock]);
  useEffect(() => () => { if (idleRef.current) window.clearTimeout(idleRef.current); pinRef.current = null; }, []);

  const loadStatus = useCallback(async () => {
    const r = await call<{ has_pin: boolean; locked_until: string | null }>('pix_allow_status');
    if (!r.ok || !r.data) { setMsg({ ok: false, text: r.error ?? 'Não consegui carregar.' }); setMode('locked'); return; }
    setStatus(r.data);
    setMode(r.data.has_pin ? 'locked' : 'create');
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleError = (error?: string) => {
    const e = error ?? 'Erro inesperado.';
    if (/PIN_NOT_SET/.test(e)) { setMode('create'); setMsg({ ok: false, text: 'Crie o PIN da lista primeiro.' }); return; }
    if (/PIN errado|bloqueado/i.test(e)) { lock(); setMsg({ ok: false, text: e }); return; }
    setMsg({ ok: false, text: e });
  };

  const validNewPin = () => {
    if (!/^\d{6,8}$/.test(pin1)) { setMsg({ ok: false, text: 'O PIN precisa ter de 6 a 8 números.' }); return false; }
    if (pin1 !== pin2) { setMsg({ ok: false, text: 'Os dois PINs não são iguais.' }); return false; }
    return true;
  };

  const createPin = async () => {
    if (!validNewPin()) return;
    setBusy(true); setMsg(null);
    const r = await call('pix_allow_set_pin', { new_pin: pin1 });
    setBusy(false);
    if (!r.ok) { handleError(r.error); return; }
    pinRef.current = pin1;
    setPin1(''); setPin2('');
    setStatus({ has_pin: true, locked_until: null });
    setMsg({ ok: true, text: 'PIN criado. Guarde bem: só você sabe, e ele não aparece em lugar nenhum.' });
    await openList(pinRef.current);
  };

  const openList = async (pin: string | null) => {
    if (!pin) return;
    setBusy(true); setMsg(null);
    const r = await call<{ items: Item[] }>('pix_allow_list', { pin });
    setBusy(false);
    if (!r.ok) { handleError(r.error); return; }
    pinRef.current = pin;
    setItems(r.data?.items ?? []);
    setPinTry('');
    setMode('open'); touch();
  };

  const save = async () => {
    if (!pinRef.current) { lock(); return; }
    if (!name.trim() || !chave.trim()) { setMsg({ ok: false, text: 'Informe o nome e a chave Pix.' }); return; }
    setBusy(true); setMsg(null); touch();
    const r = await call<Item>('pix_allow_save', { pin: pinRef.current, id: editId, name: name.trim(), chave: chave.trim() });
    setBusy(false);
    if (!r.ok) { handleError(r.error); return; }
    setName(''); setChave(''); setEditId(null);
    setMsg({ ok: true, text: editId ? 'Alterado.' : 'Adicionado. O assistente já pode preparar Pix para essa chave (sempre com o PIN de pagamento e aprovação no app do Inter).' });
    await openList(pinRef.current);
  };

  const remove = async (it: Item) => {
    if (!pinRef.current) { lock(); return; }
    if (!window.confirm(`Tirar ${it.name} dos Pix permitidos?`)) return;
    setBusy(true); touch();
    const r = await call('pix_allow_remove', { pin: pinRef.current, id: it.id });
    setBusy(false);
    if (!r.ok) { handleError(r.error); return; }
    await openList(pinRef.current);
  };

  const lockedUntil = status?.locked_until && Date.parse(status.locked_until) > Date.now() ? new Date(status.locked_until) : null;

  return (
    <div className="bg-white rounded-xl border border-violet-200 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-zinc-900 flex items-center gap-2"><i className="ri-shield-keyhole-line text-violet-600" /> Pix permitidos</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Pessoas, além dos fornecedores, para quem o assistente pode preparar Pix pela conta do Inter. Protegido por um PIN que só você sabe.</p>
        </div>
        {mode === 'open' && (
          <div className="flex items-center gap-2">
            <button onClick={() => lock('Lista trancada.')} className="text-xs px-3 py-1.5 bg-zinc-800 text-white rounded-lg hover:bg-zinc-900 cursor-pointer whitespace-nowrap"><i className="ri-lock-line" /> Trancar</button>
          </div>
        )}
      </div>

      {mode === 'loading' && <div className="py-6 flex justify-center"><div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}

      {mode === 'create' && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-3 max-w-md">
          <p className="text-sm font-semibold text-zinc-800">Crie o PIN da lista</p>
          <p className="text-xs text-zinc-600">De 6 a 8 números. Ele protege esta lista e não é o mesmo PIN que você digita no Telegram para pagar. <strong>Ele não pode ser trocado pela tela</strong>: guarde bem. Ninguém consegue ver este PIN depois.</p>
          <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin1} onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))} placeholder="PIN novo" className={pinInput} />
          <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} placeholder="Repita o PIN" className={pinInput}
            onKeyDown={(e) => { if (e.key === 'Enter') createPin(); }} />
          <div className="flex gap-2">
            <button onClick={createPin} disabled={busy} className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 cursor-pointer disabled:opacity-50">
              {busy ? 'Salvando...' : 'Criar PIN e abrir a lista'}
            </button>
          </div>
        </div>
      )}

      {mode === 'locked' && (
        <div className="flex items-end gap-2 max-w-md">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5"><i className="ri-lock-line" /> Digite o PIN da lista para ver e editar</label>
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pinTry} onChange={(e) => setPinTry(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') openList(pinTry); }} disabled={!!lockedUntil} placeholder="••••••" className={pinInput} />
          </div>
          <button onClick={() => openList(pinTry)} disabled={busy || pinTry.length < 6 || !!lockedUntil} className="px-4 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 cursor-pointer disabled:opacity-50 whitespace-nowrap">
            {busy ? 'Conferindo...' : 'Abrir'}
          </button>
        </div>
      )}
      {mode === 'locked' && <p className="text-[11px] text-zinc-400">Esqueceu o PIN ou quer trocar? Isso não é feito pela tela: peça ao suporte (Claude Code).</p>}
      {mode === 'locked' && lockedUntil && <p className="text-xs text-red-600">Bloqueado por tentativas erradas até {lockedUntil.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>}

      {mode === 'open' && (
        <div className="space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-zinc-400">Ninguém na lista ainda. Fornecedores com CNPJ ou chave Pix no cadastro já são aceitos sem estar aqui.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl overflow-hidden">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-4 py-2.5 text-sm bg-white">
                  <span className="font-semibold text-zinc-800 truncate">{it.name}</span>
                  <span className="font-mono text-zinc-500 truncate">{it.pix_key}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">{KIND[it.pix_key_kind] ?? it.pix_key_kind}</span>
                  <div className="flex-1" />
                  <button onClick={() => { setEditId(it.id); setName(it.name); setChave(it.pix_key); setMsg(null); touch(); }} className="text-zinc-400 hover:text-violet-600 cursor-pointer" title="Editar"><i className="ri-edit-line" /></button>
                  <button onClick={() => remove(it)} disabled={busy} className="text-zinc-400 hover:text-red-600 cursor-pointer disabled:opacity-50" title="Remover"><i className="ri-delete-bin-line" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="Nome (ex.: Natalino)" className={`${input} sm:col-span-2`} />
            <input value={chave} onChange={(e) => { setChave(e.target.value); touch(); }} placeholder="Chave: CPF, CNPJ, e-mail, +55 telefone ou aleatória" className={`${input} sm:col-span-2 font-mono`} />
            <div className="flex gap-2">
              {editId && <button onClick={() => { setEditId(null); setName(''); setChave(''); }} className="px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer">Cancelar</button>}
              <button onClick={save} disabled={busy} className="flex-1 px-3 py-2 bg-violet-600 text-white rounded-lg text-xs font-semibold hover:bg-violet-700 cursor-pointer disabled:opacity-50 whitespace-nowrap">
                {editId ? 'Salvar' : <><i className="ri-add-line" /> Adicionar</>}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-zinc-400">Telefone precisa do +55 (ex.: +5541999998888). 11 números sem +55 são lidos como CPF. Mesmo com a chave na lista, cada Pix ainda pede o PIN de pagamento no Telegram e a sua aprovação no app do Inter.</p>
        </div>
      )}

      {msg && <p className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  );
}
