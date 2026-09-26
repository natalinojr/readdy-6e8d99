// Aviso "pedido não impresso" (2026-09-26, pedido do dono) — no PDV Caixa e no Gestor de Pedidos.
// Ticket que não saiu em ~1,5 min vira um cartão vermelho (com bipe): impressora que não respondeu
// ("Imprimir de novo" reenfileira pelo enqueue_print_ticket, que avisa o agente na hora) ou agente
// do PC parado (o ticket nem foi puxado — reimprimir não resolve, é o PC da loja).
// Sem polling cego: confere a fila ao abrir, ~70 s depois de cada ticket novo (broadcast print-jobs
// que o banco já manda para o agente) e, com aviso aberto, a cada 30 s até resolver.
// Pendente só conta depois de 90 s (o agente tem conferência de segurança a cada 60 s).
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useImpressoras } from '@/contexts/ImpressorasContext';

interface Ticket {
  id: string; order_id: string | null; order_number: string | null; station_key: string | null; station_label: string | null;
  impressora_id: string | null; status: string; retry_count: number | null; last_error: string | null;
  created_at: string; updated_at: string | null; content_type: string | null; payload: Record<string, unknown> | null; paper_style: string | null;
}

const MIN = 60_000;
const JANELA_H = 3; // ticket mais velho que isso não vira aviso (cozinha já resolveu de outro jeito)
const CHAVE_DISPENSADOS = 'erpos_aviso_impressao_ok';

function lerDispensados(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(CHAVE_DISPENSADOS) ?? '[]')); } catch { return new Set(); }
}
function bipe() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* sem áudio */ }
}

export default function AvisoImpressao() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { impressoras, mapaEstacoes } = useImpressoras();
  const [avisos, setAvisos] = useState<Ticket[]>([]);
  const [reenviando, setReenviando] = useState<string | null>(null);
  const dispensados = useRef(lerDispensados());
  const vistos = useRef(new Set<string>());
  const timer = useRef<number | null>(null);

  const nomeImpressora = (t: Ticket): string => {
    const porId = new Map(impressoras.map((i) => [i.id, i.nome]));
    const direto = t.impressora_id || (t.payload?.impressora_id as string | undefined) || '';
    let pid = direto && porId.has(direto) ? direto : '';
    if (!pid) pid = mapaEstacoes[t.station_key ?? ''] || mapaEstacoes[direto] || (impressoras.length === 1 ? impressoras[0].id : '');
    return porId.get(pid) ?? t.station_label ?? 'impressora';
  };

  const conferir = useCallback(async () => {
    if (!tenantId) return;
    const { data, error } = await supabase.from('print_queue')
      .select('id, order_id, order_number, station_key, station_label, impressora_id, status, retry_count, last_error, created_at, updated_at, content_type, payload, paper_style')
      .eq('tenant_id', tenantId).gte('created_at', new Date(Date.now() - JANELA_H * 60 * MIN).toISOString())
      .order('created_at', { ascending: false }).limit(300);
    if (error) return;
    const todos = (data ?? []) as Ticket[];
    const agora = Date.now();
    // Mesmo pedido + estação com ticket mais novo (reimpressão): o velho não conta
    const superado = (t: Ticket) => !!t.order_id && todos.some((o) =>
      o.id !== t.id && o.order_id === t.order_id && o.station_key === t.station_key && o.created_at > t.created_at);
    const problemas = todos.filter((t) => {
      if (dispensados.current.has(t.id) || superado(t)) return false;
      if (t.status === 'failed') return true;
      if (t.status === 'printing') return agora - Date.parse(t.updated_at ?? t.created_at) > 2 * MIN;
      // 90 s: o agente confere sozinho a cada 60 s se o aviso na hora falhar — antes disso não é problema
      if (t.status === 'pending') return agora - Date.parse(t.created_at) > 90_000;
      return false;
    });
    if (problemas.some((t) => !vistos.current.has(t.id))) bipe();
    problemas.forEach((t) => vistos.current.add(t.id));
    setAvisos(problemas);
  }, [tenantId]);

  const conferirDepois = useCallback((ms: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(conferir, ms);
  }, [conferir]);

  // Ao abrir, a cada ticket novo (broadcast que o banco manda ao agente) e na volta à tela
  useEffect(() => {
    if (!tenantId) return;
    setAvisos([]); vistos.current.clear();
    conferir();
    const canal = supabase.channel(`print-jobs:${tenantId}`)
      .on('broadcast', { event: 'new_job' }, () => conferirDepois(100_000))
      .subscribe();
    const aoVoltar = () => { if (!document.hidden) conferir(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      supabase.removeChannel(canal);
      document.removeEventListener('visibilitychange', aoVoltar);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [tenantId, conferir, conferirDepois]);

  // Com aviso na tela: confere a cada 30 s para sumir sozinho quando imprimir
  useEffect(() => {
    if (!avisos.length) return;
    const t = window.setInterval(() => { if (!document.hidden) conferir(); }, 30_000);
    return () => window.clearInterval(t);
  }, [avisos.length, conferir]);

  const dispensar = (id: string) => {
    dispensados.current.add(id);
    try { sessionStorage.setItem(CHAVE_DISPENSADOS, JSON.stringify([...dispensados.current].slice(-200))); } catch { /* ok */ }
    setAvisos((a) => a.filter((t) => t.id !== id));
  };

  const reimprimir = async (t: Ticket) => {
    setReenviando(t.id);
    const { data, error } = await supabase.rpc('enqueue_print_ticket', {
      p_tenant_id: tenantId, p_order_id: t.order_id, p_order_number: t.order_number ?? '',
      p_station_key: t.station_key ?? '', p_station_label: t.station_label ?? '',
      p_content_type: t.content_type ?? 'ticket_json', p_payload: t.payload ?? {}, p_paper_style: t.paper_style ?? '80mm', p_force: false,
    });
    const impId = t.impressora_id || (t.payload?.impressora_id as string | undefined);
    if (!error && data && impId) await supabase.from('print_queue').update({ impressora_id: impId }).eq('id', data as string);
    setReenviando(null);
    if (error) { window.alert(`Não consegui reenviar: ${error.message}`); return; }
    dispensar(t.id);
    conferirDepois(100_000);
  };

  if (!avisos.length) return null;
  const mostrar = avisos.slice(0, 3);
  return (
    <div className="fixed right-3 bottom-3 z-[150] w-[min(360px,calc(100vw-24px))] space-y-2" role="alert">
      {mostrar.map((t) => {
        const agenteParado = t.status === 'pending' && !(t.retry_count ?? 0);
        return (
          <div key={t.id} className="bg-red-600 text-white rounded-2xl shadow-xl p-3.5">
            <div className="flex items-start gap-2.5">
              <i className="ri-printer-line text-2xl leading-none mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">Não imprimiu: pedido #{t.order_number ?? '—'} · {nomeImpressora(t)}</p>
                <p className="text-xs text-white/90 mt-0.5">
                  {agenteParado
                    ? 'O PC da impressão não puxou o pedido (PC desligado, sem internet ou agente fechado). Confira o PC da loja.'
                    : `A impressora não respondeu${t.last_error ? ` (${t.last_error})` : ''}. Confira se está ligada, com papel e na rede.`}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-2.5">
              {!agenteParado && (
                <button type="button" disabled={reenviando === t.id} onClick={() => reimprimir(t)}
                  className="flex-1 py-2 rounded-xl bg-white text-red-700 text-sm font-bold cursor-pointer disabled:opacity-60">
                  {reenviando === t.id ? 'Enviando…' : 'Imprimir de novo'}
                </button>
              )}
              <button type="button" onClick={() => dispensar(t.id)} className="px-4 py-2 rounded-xl bg-white/15 text-white text-sm font-bold cursor-pointer">
                Ok
              </button>
            </div>
          </div>
        );
      })}
      {avisos.length > 3 && <p className="text-right text-xs font-semibold text-red-700 bg-white/90 rounded-lg px-2 py-1">+{avisos.length - 3} ticket(s) sem imprimir</p>}
    </div>
  );
}
