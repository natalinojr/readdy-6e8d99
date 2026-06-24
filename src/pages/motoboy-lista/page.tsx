import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { MOTOBOY_SESSION_KEY, getMotoboySession, type MotoboySession } from '@/pages/motoboy/page';

function edgeUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/motoboy-signal';
}

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_LABEL: Record<string, string> = {
  new: 'Novo', preparing: 'Em preparo', ready: 'Pronto',
};
const SINAL_LABEL: Record<string, string> = {
  a_caminho_loja: 'A caminho da loja',
  coletou: 'Coletado',
  entregou: 'Entregue',
  problema: 'Problema',
};

interface OrderRow {
  id: string;
  number: string;
  cliente: string;
  endereco: string;
  total: number;
  taxa: number;
  status: string;
  motoboy_status: string | null;
  meu: boolean;
  assumido: boolean;
}

export default function MotoboyListaPage() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const slug = storeSlug ?? '';

  const [session, setSession] = useState<MotoboySession | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  // Form de login
  const [nome, setNome] = useState('');
  const [celular, setCelular] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [loginErro, setLoginErro] = useState('');

  // ── Carrega a lista de pedidos da loja ──
  const carregar = useCallback(async (sess: MotoboySession) => {
    try {
      const res = await fetch(edgeUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_orders', tenant_id: sess.tenant_id, driver_id: sess.driver_id }),
      });
      const data = await res.json();
      if (data.blocked) {
        localStorage.removeItem(MOTOBOY_SESSION_KEY);
        setSession(null);
        setErro('Seu acesso foi bloqueado pela loja.');
        return;
      }
      if (!data.ok) { setErro('Não foi possível carregar os pedidos.'); return; }
      setErro('');
      setOrders(data.orders ?? []);
    } catch {
      setErro('Erro de conexão.');
    }
  }, []);

  // ── Login automático se já houver sessão neste dispositivo pra esta loja ──
  useEffect(() => {
    const sess = getMotoboySession();
    if (sess && sess.store_slug === slug) {
      setSession(sess);
      carregar(sess).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [slug, carregar]);

  // ── Auto-refresh a cada 20s ──
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => { carregar(session); }, 20000);
    return () => clearInterval(id);
  }, [session, carregar]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErro('');
    const phone = celular.replace(/\D/g, '');
    if (!nome.trim() || phone.length < 8) { setLoginErro('Informe nome e um celular válido.'); return; }
    setEntrando(true);
    try {
      const res = await fetch(edgeUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'driver_login', store_slug: slug, name: nome.trim(), phone }),
      });
      const data = await res.json();
      if (data.blocked) { setLoginErro('Seu acesso a esta loja está bloqueado.'); return; }
      if (!data.ok || !data.driver) {
        setLoginErro(data.error === 'loja_invalida' ? 'Loja não encontrada.' : 'Não foi possível entrar.');
        return;
      }
      const sess: MotoboySession = {
        tenant_id: data.tenant_id, driver_id: data.driver.id, name: data.driver.name,
        store_slug: data.store_slug || slug, store_name: data.store_name || '',
      };
      localStorage.setItem(MOTOBOY_SESSION_KEY, JSON.stringify(sess));
      setSession(sess);
      setLoading(true);
      await carregar(sess);
      setLoading(false);
    } catch {
      setLoginErro('Erro de conexão. Tente novamente.');
    } finally {
      setEntrando(false);
    }
  };

  const sair = () => {
    localStorage.removeItem(MOTOBOY_SESSION_KEY);
    setSession(null);
    setOrders([]);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Tela de login ──
  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
        <form onSubmit={entrar} className="w-full max-w-sm bg-white rounded-2xl border border-zinc-100 p-6 space-y-4">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto flex items-center justify-center bg-amber-100 rounded-2xl mb-2">
              <i className="ri-e-bike-2-line text-2xl text-amber-600" />
            </div>
            <h1 className="text-lg font-black text-zinc-800">Entregas</h1>
            <p className="text-xs text-zinc-500">Entre com seu nome e celular para ver os pedidos.</p>
          </div>
          {erro ? <p className="text-xs text-red-600 text-center">{erro}</p> : null}
          <div>
            <label className="text-[11px] font-semibold text-zinc-400 uppercase">Seu nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: João"
              className="w-full mt-1 px-3 py-2.5 rounded-xl border border-zinc-200 outline-none focus:border-amber-400 text-sm" maxLength={80} />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-zinc-400 uppercase">Celular</label>
            <input value={celular} onChange={(e) => setCelular(e.target.value)} inputMode="tel" placeholder="(00) 00000-0000"
              className="w-full mt-1 px-3 py-2.5 rounded-xl border border-zinc-200 outline-none focus:border-amber-400 text-sm" maxLength={20} />
          </div>
          {loginErro ? <p className="text-xs text-red-600">{loginErro}</p> : null}
          <button type="submit" disabled={entrando}
            className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-50">
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    );
  }

  // ── Lista de pedidos ──
  const abertos = orders.length;
  return (
    <div className="min-h-screen bg-zinc-50 flex justify-center">
      <div className="w-full max-w-md px-4 py-5 space-y-4">
        <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-2xl p-4 text-white flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold opacity-70">{session.store_name || 'Entregas'}</p>
            <h1 className="text-xl font-black">Olá, {session.name.split(' ')[0]}</h1>
            <p className="text-[11px] opacity-70 mt-0.5">{abertos} {abertos === 1 ? 'pedido em aberto' : 'pedidos em aberto'}</p>
          </div>
          <button type="button" onClick={sair} className="text-[11px] font-bold bg-white/15 px-2.5 py-1 rounded-full">Sair</button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-400 uppercase">Pedidos</span>
          <button type="button" onClick={() => carregar(session)} className="inline-flex items-center gap-1 text-xs font-bold text-amber-600">
            <i className="ri-refresh-line" /> Atualizar
          </button>
        </div>

        {erro ? <p className="text-xs text-red-600">{erro}</p> : null}

        {orders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-100 p-8 text-center">
            <i className="ri-inbox-line text-3xl text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-500 mt-2">Nenhum pedido em aberto agora.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <a key={o.id} href={`/motoboy/${o.id}`}
                className="block bg-white rounded-2xl border border-zinc-100 p-4 active:bg-zinc-50 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-black text-zinc-800">#{String(o.number).replace(/\D/g, '').slice(-4) || o.number}</span>
                  <div className="flex items-center gap-1.5">
                    {o.motoboy_status ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">{SINAL_LABEL[o.motoboy_status] ?? o.motoboy_status}</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 text-[10px] font-bold">{STATUS_LABEL[o.status] ?? o.status}</span>
                    )}
                  </div>
                </div>
                <p className="text-sm font-semibold text-zinc-700">{o.cliente}</p>
                <p className="text-xs text-zinc-500 line-clamp-1">{o.endereco || '—'}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-black text-zinc-800">{fmt(o.total)}</span>
                  {o.assumido && !o.meu ? (
                    <span className="text-[10px] font-bold text-zinc-400">outro entregador</span>
                  ) : o.meu ? (
                    <span className="text-[10px] font-bold text-amber-600">seu pedido</span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-600">abrir <i className="ri-arrow-right-s-line" /></span>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
