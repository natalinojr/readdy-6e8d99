// Conversa "Avisos" para todas as pessoas (2026-09-25). O dono tem a dele no assistente; as demais
// pessoas recebem aqui só o que o acesso delas cobre (tabela avisos — quem recebe é decidido no
// servidor, ver supabase/migrations/20260926100000_avisos_usuario.sql): pagamento do pedido feito ou
// recusado, vencimentos de amanhã, estoque crítico. Cobre o painel do chat, como a conversa da equipe.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import PainelMensagem, { type DadosPainel } from '@/components/feature/assistente/PainelMensagem';

export interface Aviso {
  id: string;
  kind: string;
  resumo: string;
  painel: DadosPainel | null;
  created_at: string;
  lido_em: string | null;
}

const TZ = 'America/Sao_Paulo';
const diaDe = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' });
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** Avisos da pessoa logada (a RLS só devolve os dela) + quantos ainda não foram lidos. */
export function useAvisos(ativo: boolean) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [carregado, setCarregado] = useState(false);
  // Lidos aqui: a recarga que já estava a caminho ao abrir a conversa chega depois da marcação e
  // traria lido_em nulo de volta (o número não sumia — visto no teste de 2026-09-25).
  const lidosAqui = useRef(new Map<string, string>());
  const recarregar = useCallback(async () => {
    const { data, error } = await supabase.from('avisos')
      .select('id, kind, resumo, painel, created_at, lido_em')
      .order('created_at', { ascending: false }).limit(60);
    if (!error) setAvisos(((data ?? []) as Aviso[]).reverse().map((a) => (a.lido_em || !lidosAqui.current.has(a.id) ? a : { ...a, lido_em: lidosAqui.current.get(a.id)! })));
    setCarregado(true);
  }, []);
  useEffect(() => {
    if (!ativo) return;
    recarregar();
    const t = setInterval(() => { if (!document.hidden) recarregar(); }, 60000);
    return () => clearInterval(t);
  }, [ativo, recarregar]);
  const marcarLidos = useCallback(async () => {
    if (!avisos.some((a) => !a.lido_em)) return;
    const agora = new Date().toISOString();
    for (const a of avisos) if (!a.lido_em) lidosAqui.current.set(a.id, agora);
    setAvisos((p) => p.map((a) => (a.lido_em ? a : { ...a, lido_em: agora })));
    await supabase.from('avisos').update({ lido_em: agora }).is('lido_em', null);
  }, [avisos]);
  const naoLidos = avisos.filter((a) => !a.lido_em).length;
  const ultimo = avisos[avisos.length - 1] ?? null;
  return { avisos, carregado, naoLidos, ultimo, recarregar, marcarLidos };
}

/** Linha "Avisos" no topo da lista de conversas. */
export function LinhaAvisos({ ultimo, naoLidos, onAbrir }: { ultimo: Aviso | null; naoLidos: number; onAbrir: () => void }) {
  return (
    <button onClick={onAbrir}
      className="w-full flex items-center gap-3 px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer text-left">
      <span className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full bg-amber-50 text-amber-600 text-xl">
        <i className="ri-notification-3-line" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="flex-1 text-sm font-bold text-zinc-900 truncate">Avisos</span>
          {ultimo && <span className={`text-[11px] flex-shrink-0 ${naoLidos ? 'text-amber-700 font-bold' : 'text-zinc-400'}`}>{horaDe(ultimo.created_at)}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className={`flex-1 truncate text-xs ${naoLidos ? 'text-zinc-700 font-semibold' : 'text-zinc-400'}`}>
            {ultimo?.resumo ?? 'Pagamentos dos seus pedidos e alertas da loja'}
          </span>
          {naoLidos > 0 && (
            <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-amber-500 text-white text-[11px] font-black" aria-label={`${naoLidos} aviso(s) novo(s)`}>
              {naoLidos > 99 ? '99+' : naoLidos}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export default function AvisosConversa({ avisos, carregado, onVoltar, onFechar, onBotao, marcarLidos }: {
  avisos: Aviso[];
  carregado: boolean;
  onVoltar: () => void;
  onFechar?: () => void;
  onBotao: (rota: string) => void;
  marcarLidos: () => void;
}) {
  useVoltarFecha(true, onVoltar, 'avisos-conversa');
  const fim = useRef<HTMLDivElement>(null);
  // O que era novo ao abrir continua destacado enquanto a conversa está aberta.
  const [novos] = useState(() => new Set(avisos.filter((a) => !a.lido_em).map((a) => a.id)));
  useLayoutEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [avisos.length]);
  useEffect(() => { marcarLidos(); }, [avisos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  let diaAnterior = '';
  return (
    <div data-no-pull className="absolute inset-0 z-30 flex flex-col bg-white">
      <div className="flex items-center gap-2.5 px-3 h-14 border-b border-zinc-100 flex-shrink-0">
        <button onClick={onVoltar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Voltar para as conversas">
          <i className="ri-arrow-left-line text-xl" />
        </button>
        <span className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-amber-50 text-amber-600 text-lg">
          <i className="ri-notification-3-line" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Avisos</p>
          <p className="text-[11px] text-zinc-400 leading-tight">Só o que o seu acesso permite ver</p>
        </div>
        {onFechar && (
          <button onClick={onFechar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar">
            <i className="ri-close-line text-xl" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto bg-zinc-50 px-3 py-3 space-y-2">
        {!carregado ? (
          <div className="py-10 flex justify-center"><span className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : !avisos.length ? (
          <p className="py-10 px-6 text-sm text-center text-zinc-400">
            Nenhum aviso ainda. Aqui chegam o pagamento dos pedidos que você fez e os alertas da loja que o seu acesso cobre.
          </p>
        ) : avisos.map((a) => {
          const dia = diaDe(a.created_at);
          const separador = dia !== diaAnterior;
          diaAnterior = dia;
          return (
            <div key={a.id}>
              {separador && <p className="py-2 text-center text-[11px] font-semibold text-zinc-400 capitalize">{dia}</p>}
              <div className={`rounded-2xl ${novos.has(a.id) ? 'ring-2 ring-amber-300' : ''}`}>
                {/* Todo aviso é painel (dono, 2026-09-25): sem dados próprios, o resumo vira o título. */}
                <PainelMensagem dados={a.painel && typeof a.painel.t === 'string' ? a.painel : { t: a.resumo }} onBotao={onBotao} />
              </div>
              <p className="mt-0.5 px-1 text-right text-[10px] text-zinc-400">{horaDe(a.created_at)}</p>
            </div>
          );
        })}
        <div ref={fim} />
      </div>
    </div>
  );
}
