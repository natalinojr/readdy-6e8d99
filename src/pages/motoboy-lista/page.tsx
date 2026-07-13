import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MOTOBOY_SESSION_KEY, getMotoboySession, type MotoboySession } from '@/pages/motoboy/page';
import MapaEntregas from './MapaEntregas';

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
// Badge da fase do motoboy (cor + ícone) — evidencia o status da entrega.
const SINAL_BADGE: Record<string, { cls: string; icon: string }> = {
  a_caminho_loja: { cls: 'bg-blue-100 text-blue-700', icon: 'ri-store-2-line' },
  coletou: { cls: 'bg-violet-100 text-violet-700', icon: 'ri-e-bike-2-line' },
  entregou: { cls: 'bg-green-100 text-green-700', icon: 'ri-checkbox-circle-line' },
  problema: { cls: 'bg-red-100 text-red-700', icon: 'ri-alert-line' },
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
  motoboy_updated_at?: string | null;
  lat?: number | null;
  lng?: number | null;
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
  const [filtro, setFiltro] = useState<'todos' | 'meus' | 'sem_entregador' | 'atraso'>('todos');
  const [ordem, setOrdem] = useState<'fase' | 'tempo'>('fase');
  const [showMapa, setShowMapa] = useState(false);
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
  // Separa em aberto (fluxo ativo) dos concluídos (entregues) — estes vão numa seção à parte.
  const emAberto = orders.filter((o) => o.status !== 'delivered');
  const concluidos = orders.filter((o) => o.status === 'delivered');
  const abertos = emAberto.length;
  const meusCount = emAberto.filter((o) => o.meu).length;
  const semEntregadorCount = emAberto.filter((o) => !o.assumido).length;
  const atrasoCount = emAberto.filter((o) => infoTempo(o, now).atrasado).length;

  const passaFiltro = (o: OrderRow) =>
    filtro === 'todos' ? true
      : filtro === 'meus' ? o.meu
      : filtro === 'sem_entregador' ? !o.assumido
      : infoTempo(o, now).atrasado;
  const filtrados = emAberto.filter(passaFiltro);
  // Concluídos exibidos: respeita "Meus"; some nos filtros de trabalho em aberto (sem entregador / atraso).
  const concluidosVisiveis = (filtro === 'meus' ? concluidos.filter((o) => o.meu) : concluidos)
    .slice()
    .sort((a, b) => (b.motoboy_updated_at ?? b.created_at ?? '').localeCompare(a.motoboy_updated_at ?? a.created_at ?? ''));
  const mostrarConcluidos = (filtro === 'todos' || filtro === 'meus') && concluidosVisiveis.length > 0;
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
    const concluido = o.status === 'delivered';
    const ti = infoTempo(o, now);
    const ring = concluido ? '' : ti.atrasado ? ' ring-2 ring-red-300' : ti.quase ? ' ring-2 ring-amber-300' : '';
    const cozinha = COZINHA_BADGE[o.status] ?? { label: STATUS_LABEL[o.status] ?? o.status, cls: 'bg-zinc-100 text-zinc-600', icon: 'ri-restaurant-line' };
    return (
      <Link key={o.id} to={`/motoboy/${o.id}`} className={'block rounded-2xl border p-4 active:brightness-95 transition ' + baseBg + ring}>
        <div className="flex items-center justify-between mb-1 gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-black text-zinc-800 shrink-0">#{String(o.number).replace(/\D/g, '').slice(-4) || o.number}</span>
            {/* Status da cozinha ao lado do número do pedido (oculto quando já entregue) */}
            {!concluido ? (
              <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ' + cozinha.cls}>
                <i className={cozinha.icon} /> {cozinha.label}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {o.motoboy_status ? (() => {
              const sb = SINAL_BADGE[o.motoboy_status] ?? { cls: 'bg-zinc-100 text-zinc-600', icon: 'ri-e-bike-2-line' };
              return (
                <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ' + sb.cls}>
                  <i className={sb.icon} /> {SINAL_LABEL[o.motoboy_status] ?? o.motoboy_status}
                </span>
              );
            })() : null}
            {!o.assumido ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">
                <i className="ri-user-add-line" /> Sem entregador
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
            {concluido ? null : <ChipTempo o={o} />}
          </div>
          {o.assumido && !o.meu ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-400 shrink-0"><i className="ri-lock-line" /> {o.assumido_por ? `com ${o.assumido_por.split(' ')[0]}` : 'outro entregador'}</span>
          ) : o.meu ? (
            <span className="text-[10px] font-bold text-amber-600 shrink-0">seu pedido</span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-600 shrink-0">abrir <i className="ri-arrow-right-s-line" /></span>
          )}
        </div>
      </Link>
    );
  };

  const FILTROS: { key: typeof filtro; label: string; count: number }[] = [
    { key: 'todos', label: 'Todos', count: abertos },
    { key: 'meus', label: 'Meus', count: meusCount },
    { key: 'sem_entregador', label: 'Sem entregador', count: semEntregadorCount },
    { key: 'atraso', label: 'Em atraso', count: atrasoCount },
  ];

  // Pontos do mapa = respeitam o filtro ativo (ex.: "Meus" mostra só os seus no mapa).
  const pontosMapa = filtrados.map((o) => ({
    id: o.id, number: o.number, cliente: o.cliente, endereco: o.endereco,
    lat: o.lat ?? null, lng: o.lng ?? null, meu: o.meu, atrasado: infoTempo(o, now).atrasado,
    motoboy_status: o.motoboy_status, assumido: o.assumido, assumido_por: o.assumido_por ?? null,
  }));

  // Motoboy diz "estou a caminho" direto do pin do mapa (assume + sinaliza).
  const marcarACaminho = async (orderId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!session) return { ok: false };
    try {
      const res = await fetch(edgeUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signal', order_id: orderId, signal: 'a_caminho_loja', driver_id: session.driver_id }),
      });
      const data = await res.json();
      if (data.ok) await carregar(session);
      return data;
    } catch { return { ok: false, error: 'conexao' }; }
  };

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
        <div className="flex flex-wrap items-center gap-1.5">
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
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setShowMapa(true)} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600">
              <i className="ri-map-2-line" /> Mapa
            </button>
            <button type="button" onClick={() => carregar(session)} className="inline-flex items-center gap-1 text-xs font-bold text-amber-600">
              <i className="ri-refresh-line" /> Atualizar
            </button>
          </div>
        </div>

        {erro ? <p className="text-xs text-red-600">{erro}</p> : null}

        {filtrados.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-100 p-8 text-center">
            <i className="ri-inbox-line text-3xl text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-500 mt-2">
              {emAberto.length === 0 ? 'Nenhum pedido em aberto agora.' : 'Nenhum pedido neste filtro.'}
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

        {/* Concluídos: entregues recentes — só pra o motoboy saber o que já foi feito. */}
        {mostrarConcluidos ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs font-bold text-zinc-500 uppercase">Entregues</span>
              <span className="text-[11px] font-bold text-zinc-400">{concluidosVisiveis.length}</span>
            </div>
            {concluidosVisiveis.map((o) => renderCard(o, 'bg-green-50 border-green-200'))}
          </div>
        ) : null}
      </div>

      {showMapa ? <MapaEntregas pontos={pontosMapa} onClose={() => setShowMapa(false)} onACaminho={marcarACaminho} /> : null}
    </div>
  );
}
