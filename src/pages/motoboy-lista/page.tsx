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
// Badge do status da COZINHA (cor + ícone) — sempre visível no card.
const COZINHA_BADGE: Record<string, { label: string; cls: string; icon: string }> = {
  new: { label: 'Novo', cls: 'bg-zinc-100 text-zinc-600', icon: 'ri-receipt-line' },
  preparing: { label: 'Em preparo', cls: 'bg-amber-100 text-amber-700', icon: 'ri-fire-line' },
  ready: { label: 'Pronto', cls: 'bg-emerald-100 text-emerald-700', icon: 'ri-checkbox-circle-line' },
};
const SINAL_LABEL: Record<string, string> = {
  a_caminho_loja: 'A caminho da loja',
  coletou: 'Coletado',
  entregou: 'Entregue',
  problema: 'Problema',
};

// Fases de entrega (ordem de exibição), com cor de fundo leve por grupo.
interface Fase { key: string; label: string; cardBg: string; dot: string; match: (o: OrderRow) => boolean; }
const FASES: Fase[] = [
  { key: 'preparo', label: 'Em preparo', cardBg: 'bg-slate-50 border-slate-200', dot: 'bg-slate-400', match: (o) => !o.motoboy_status && o.status !== 'ready' },
  { key: 'pronto', label: 'Prontos para retirar', cardBg: 'bg-sky-50 border-sky-200', dot: 'bg-sky-400', match: (o) => !o.motoboy_status && o.status === 'ready' },
  { key: 'a_caminho_loja', label: 'A caminho da loja', cardBg: 'bg-amber-50 border-amber-200', dot: 'bg-amber-400', match: (o) => o.motoboy_status === 'a_caminho_loja' },
  { key: 'coletou', label: 'Coletados / em rota', cardBg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-400', match: (o) => o.motoboy_status === 'coletou' },
  { key: 'problema', label: 'Problema na entrega', cardBg: 'bg-red-50 border-red-200', dot: 'bg-red-400', match: (o) => o.motoboy_status === 'problema' },
];

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
  assumido_por?: string | null;
  alertas?: string[];
  sla_min?: number | null;
  created_at?: string | null;
}

// Limite (min) abaixo do qual o pedido está "prestes a atrasar".
const QUASE_ATRASO_MIN = 10;

// Calcula o prazo de entrega e quanto falta, a partir do SLA do pedido.
function infoTempo(o: OrderRow, now: number) {
  if (o.sla_min == null || !o.created_at) return { temPrazo: false, restanteMin: 0, atrasado: false, quase: false, deadline: 0 };
  const deadline = new Date(o.created_at).getTime() + o.sla_min * 60000;
  const restanteMin = Math.round((deadline - now) / 60000);
  return { temPrazo: true, restanteMin, atrasado: restanteMin < 0, quase: restanteMin >= 0 && restanteMin <= QUASE_ATRASO_MIN, deadline };
}

function fmtDuracao(min: number): string {
  const m = Math.abs(min);
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  return `${m} min`;
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

  // Filtros e ordenação
  const [filtro, setFiltro] = useState<'todos' | 'sem_entregador' | 'atraso'>('todos');
  const [ordem, setOrdem] = useState<'fase' | 'tempo'>('fase');
  // Tick local (sem tocar servidor) pra o contador de tempo andar.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

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
  const semEntregadorCount = orders.filter((o) => !o.assumido).length;
  const atrasoCount = orders.filter((o) => infoTempo(o, now).atrasado).length;

  const passaFiltro = (o: OrderRow) =>
    filtro === 'todos' ? true : filtro === 'sem_entregador' ? !o.assumido : infoTempo(o, now).atrasado;
  const filtrados = orders.filter(passaFiltro);
  // Ordem por tempo: mais urgente primeiro (sem prazo vai pro fim).
  const porTempo = [...filtrados].sort((a, b) => {
    const ta = infoTempo(a, now), tb = infoTempo(b, now);
    if (ta.temPrazo !== tb.temPrazo) return ta.temPrazo ? -1 : 1;
    return ta.restanteMin - tb.restanteMin;
  });

  // Chip de tempo restante / atraso.
  const ChipTempo = ({ o }: { o: OrderRow }) => {
    const ti = infoTempo(o, now);
    if (!ti.temPrazo) return null;
    const cls = ti.atrasado ? 'bg-red-100 text-red-700' : ti.quase ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
    return (
      <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ' + cls}>
        <i className={ti.atrasado ? 'ri-alarm-warning-line' : 'ri-time-line'} />
        {ti.atrasado ? `atrasado ${fmtDuracao(ti.restanteMin)}` : `faltam ${fmtDuracao(ti.restanteMin)}`}
      </span>
    );
  };

  const renderCard = (o: OrderRow, baseBg: string) => {
    const ti = infoTempo(o, now);
    const ring = ti.atrasado ? ' ring-2 ring-red-300' : ti.quase ? ' ring-2 ring-amber-300' : '';
    const cozinha = COZINHA_BADGE[o.status] ?? { label: STATUS_LABEL[o.status] ?? o.status, cls: 'bg-zinc-100 text-zinc-600', icon: 'ri-restaurant-line' };
    return (
      <a key={o.id} href={`/motoboy/${o.id}`} className={'block rounded-2xl border p-4 active:brightness-95 transition ' + baseBg + ring}>
        <div className="flex items-center justify-between mb-1 gap-1.5">
          <span className="text-sm font-black text-zinc-800">#{String(o.number).replace(/\D/g, '').slice(-4) || o.number}</span>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ' + cozinha.cls}>
              <i className={cozinha.icon} /> {cozinha.label}
            </span>
            {o.motoboy_status ? (
              <span className="px-2 py-0.5 rounded-full bg-white/70 text-zinc-600 text-[10px] font-bold">
                {SINAL_LABEL[o.motoboy_status] ?? o.motoboy_status}
              </span>
            ) : null}
          </div>
        </div>
        <p className="text-sm font-semibold text-zinc-700">{o.cliente}</p>
        <p className="text-xs text-zinc-500 line-clamp-1">{o.endereco || '—'}</p>
        {o.alertas && o.alertas.length > 0 ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-amber-700">
            <i className="ri-alarm-warning-fill text-amber-500" /> Tem {o.alertas.join(', ')}
          </p>
        ) : null}
        <div className="flex items-center justify-between mt-2 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-black text-zinc-800 shrink-0">{fmt(o.total)}</span>
            <ChipTempo o={o} />
          </div>
          {o.assumido && !o.meu ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-400 shrink-0"><i className="ri-lock-line" /> {o.assumido_por ? `com ${o.assumido_por.split(' ')[0]}` : 'outro entregador'}</span>
          ) : o.meu ? (
            <span className="text-[10px] font-bold text-amber-600 shrink-0">seu pedido</span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-600 shrink-0">abrir <i className="ri-arrow-right-s-line" /></span>
          )}
        </div>
      </a>
    );
  };

  const FILTROS: { key: typeof filtro; label: string; count: number }[] = [
    { key: 'todos', label: 'Todos', count: abertos },
    { key: 'sem_entregador', label: 'Sem entregador', count: semEntregadorCount },
    { key: 'atraso', label: 'Em atraso', count: atrasoCount },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 flex justify-center">
      <div className="w-full max-w-md px-4 py-5 space-y-4">
        <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-2xl p-4 text-white flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold opacity-70">{session.store_name || 'Entregas'}</p>
            <h1 className="text-xl font-black">Olá, {session.name.split(' ')[0]}</h1>
            <p className="text-[11px] opacity-70 mt-0.5">
              {abertos} {abertos === 1 ? 'pedido em aberto' : 'pedidos em aberto'}
              {atrasoCount > 0 ? <span className="text-red-300"> · {atrasoCount} em atraso</span> : null}
            </p>
          </div>
          <button type="button" onClick={sair} className="text-[11px] font-bold bg-white/15 px-2.5 py-1 rounded-full">Sair</button>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {FILTROS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFiltro(f.key)}
              className={'shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ' +
                (filtro === f.key
                  ? (f.key === 'atraso' ? 'bg-red-500 text-white' : 'bg-zinc-800 text-white')
                  : (f.key === 'atraso' && f.count > 0 ? 'bg-red-50 text-red-600' : 'bg-white text-zinc-500 border border-zinc-200'))}>
              {f.label} <span className="opacity-70">{f.count}</span>
            </button>
          ))}
        </div>

        {/* Ordenação + atualizar */}
        <div className="flex items-center justify-between">
          <div className="inline-flex rounded-lg bg-white border border-zinc-200 p-0.5">
            {(['fase', 'tempo'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setOrdem(k)}
                className={'px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ' + (ordem === k ? 'bg-zinc-800 text-white' : 'text-zinc-500')}>
                {k === 'fase' ? 'Por fase' : 'Por tempo'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => carregar(session)} className="inline-flex items-center gap-1 text-xs font-bold text-amber-600">
            <i className="ri-refresh-line" /> Atualizar
          </button>
        </div>

        {erro ? <p className="text-xs text-red-600">{erro}</p> : null}

        {filtrados.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-100 p-8 text-center">
            <i className="ri-inbox-line text-3xl text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-500 mt-2">
              {orders.length === 0 ? 'Nenhum pedido em aberto agora.' : 'Nenhum pedido neste filtro.'}
            </p>
          </div>
        ) : ordem === 'tempo' ? (
          <div className="space-y-2">
            {porTempo.map((o) => renderCard(o, 'bg-white border-zinc-100'))}
          </div>
        ) : (
          <div className="space-y-5">
            {FASES.map((fase) => {
              const doGrupo = filtrados.filter(fase.match);
              if (doGrupo.length === 0) return null;
              return (
                <div key={fase.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={'w-2 h-2 rounded-full ' + fase.dot} />
                    <span className="text-xs font-bold text-zinc-500 uppercase">{fase.label}</span>
                    <span className="text-[11px] font-bold text-zinc-400">{doGrupo.length}</span>
                  </div>
                  {doGrupo.map((o) => renderCard(o, fase.cardBg))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
