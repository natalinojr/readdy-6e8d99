// Conversa "Currículos" para quem tem acesso à Contratação (dono, 2026-09-29). O dono já vê esses
// avisos na conversa Currículos do assistente; as demais pessoas liberadas no módulo recebem aqui os
// mesmos avisos automáticos (currículo que chegou pelo link, ficha completada, entrevista agendada,
// presença confirmada) — só leitura, pela RPC fn_hiring_chat_feed, que nunca devolve o que o dono
// conversou com o assistente. O "visto até" fica neste aparelho (localStorage): é só para a bolinha.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { useModuleAccess } from '@/hooks/useModuleAccess';

export interface AvisoCurriculo { id: number; content: string; created_at: string }

const TZ = 'America/Sao_Paulo';
const diaDe = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' });
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

// Mesmo marcador de botão do chat do dono ("[Botão enviado: "rótulo" → /rota]"): vira botão que
// navega. Só rota interna.
const MARCADOR_BOTAO = /\[Botão(?: enviado)?: "([^"\n]{1,80})" → (\/[^\s\]]*)\]/g;
const MARCADORES = /\n?\[(Enquete enviada|Localização enviada|Contato enviado|Pedido de pagamento enviado|Botão enviado|Botão:)[^\n]*\]/g;
const botoesDe = (t: string) => [...t.matchAll(MARCADOR_BOTAO)]
  .filter((m) => !m[2].startsWith('//'))
  .map((m) => ({ label: m[1], rota: m[2].slice(0, 300) }));
const textoDe = (t: string) => t.replace(MARCADORES, '').trim();
const previaDe = (t: string) => textoDe(t).replace(/[*_]/g, '').split('\n')[0];

// *negrito* e _itálico_ do estilo WhatsApp, sem HTML.
function formatar(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(^|[\s(])(\*[^*\n]+\*|_[^_\n]+_)(?=[\s).,;:!?]|$)/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    const inner = m[2].slice(1, -1);
    out.push(m[2][0] === '*' ? <b key={k++}>{inner}</b> : <i key={k++}>{inner}</i>);
    last = start + m[2].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const VISTO_KEY = 'erpos.curriculos.visto';
const lerVisto = () => { try { return Number(localStorage.getItem(VISTO_KEY)) || 0; } catch { return 0; } };
const gravarVisto = (id: number) => { try { localStorage.setItem(VISTO_KEY, String(id)); } catch { /* sem storage: a bolinha volta */ } };

/** Avisos da Contratação para quem tem o módulo (e não é o dono — ele vê no assistente). */
export function useCurriculosConversa(ativo: boolean) {
  const { hasModule, loading } = useModuleAccess();
  const liberado = ativo && !loading && hasModule('contratacao');
  const [avisos, setAvisos] = useState<AvisoCurriculo[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [visto, setVisto] = useState(lerVisto);
  const recarregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_hiring_chat_feed', { p_limit: 80 });
    if (!error) setAvisos(((data ?? []) as AvisoCurriculo[]).reverse());
    setCarregado(true);
  }, []);
  useEffect(() => {
    if (!liberado) return;
    recarregar();
    const t = setInterval(() => { if (!document.hidden) recarregar(); }, 60000);
    return () => clearInterval(t);
  }, [liberado, recarregar]);
  const ultimo = avisos[avisos.length - 1] ?? null;
  // Primeira vez neste aparelho: nada conta como novo (senão aparecem 80 de uma vez).
  const naoLidos = !visto ? 0 : avisos.filter((a) => a.id > visto).length;
  useEffect(() => { if (!visto && ultimo) { gravarVisto(ultimo.id); setVisto(ultimo.id); } }, [visto, ultimo]);
  const marcarLidos = useCallback(() => {
    if (!ultimo || ultimo.id <= visto) return;
    gravarVisto(ultimo.id); setVisto(ultimo.id);
  }, [ultimo, visto]);
  return { liberado, avisos, carregado, naoLidos: liberado ? naoLidos : 0, ultimo, visto, recarregar, marcarLidos };
}

/** Linha "Currículos" na lista de conversas. */
export function LinhaCurriculos({ ultimo, naoLidos, onAbrir }: { ultimo: AvisoCurriculo | null; naoLidos: number; onAbrir: () => void }) {
  return (
    <button onClick={onAbrir}
      className="w-full flex items-center gap-3 px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer text-left">
      <span className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full bg-rose-50 text-rose-600 text-xl">
        <i className="ri-file-user-line" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="flex-1 text-sm font-bold text-zinc-900 truncate">Currículos</span>
          {ultimo && <span className={`text-[11px] flex-shrink-0 ${naoLidos ? 'text-rose-700 font-bold' : 'text-zinc-400'}`}>{horaDe(ultimo.created_at)}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className={`flex-1 truncate text-xs ${naoLidos ? 'text-zinc-700 font-semibold' : 'text-zinc-400'}`}>
            {ultimo ? previaDe(ultimo.content) : 'Currículos que chegam e entrevistas agendadas'}
          </span>
          {naoLidos > 0 && (
            <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-rose-500 text-white text-[11px] font-black" aria-label={`${naoLidos} aviso(s) novo(s)`}>
              {naoLidos > 99 ? '99+' : naoLidos}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export default function CurriculosConversa({ avisos, carregado, visto, onVoltar, onFechar, onBotao, marcarLidos }: {
  avisos: AvisoCurriculo[];
  carregado: boolean;
  visto: number;
  onVoltar: () => void;
  onFechar?: () => void;
  onBotao: (rota: string) => void;
  marcarLidos: () => void;
}) {
  useVoltarFecha(true, onVoltar, 'curriculos-conversa');
  const fim = useRef<HTMLDivElement>(null);
  // O que era novo ao abrir continua destacado enquanto a conversa está aberta.
  const [vistoAoAbrir] = useState(visto);
  useLayoutEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [avisos.length]);
  useEffect(() => { marcarLidos(); }, [avisos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  let diaAnterior = '';
  return (
    <div data-no-pull className="absolute inset-0 z-30 flex flex-col bg-white">
      <div className="flex items-center gap-2.5 px-3 h-14 border-b border-zinc-100 flex-shrink-0">
        <button onClick={onVoltar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Voltar para as conversas">
          <i className="ri-arrow-left-line text-xl" />
        </button>
        <span className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-rose-50 text-rose-600 text-lg">
          <i className="ri-file-user-line" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Currículos</p>
          <p className="text-[11px] text-zinc-400 leading-tight">Avisos da Contratação</p>
        </div>
        {onFechar && (
          <button onClick={onFechar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar">
            <i className="ri-close-line text-xl" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto bg-zinc-50 px-3 py-3 space-y-2">
        {!carregado ? (
          <div className="py-10 flex justify-center"><span className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : !avisos.length ? (
          <p className="py-10 px-6 text-sm text-center text-zinc-400">
            Nenhum aviso ainda. Aqui chegam os currículos novos, as fichas completadas e as entrevistas agendadas.
          </p>
        ) : avisos.map((a) => {
          const dia = diaDe(a.created_at);
          const separador = dia !== diaAnterior;
          diaAnterior = dia;
          const botoes = botoesDe(a.content);
          return (
            <div key={a.id}>
              {separador && <p className="py-2 text-center text-[11px] font-semibold text-zinc-400 capitalize">{dia}</p>}
              <div className={`max-w-[92%] rounded-2xl rounded-tl-md bg-white border border-zinc-200 px-3 py-2 ${vistoAoAbrir && a.id > vistoAoAbrir ? 'ring-2 ring-rose-300' : ''}`}>
                <p className="text-sm text-zinc-800 whitespace-pre-wrap break-words">{formatar(textoDe(a.content))}</p>
                {botoes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {botoes.map((b) => (
                      <button key={b.rota} onClick={() => onBotao(b.rota)}
                        className="h-8 px-3 flex items-center gap-1.5 rounded-xl bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 cursor-pointer">
                        <i className="ri-arrow-right-up-line" /> {b.label}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-0.5 text-right text-[10px] text-zinc-400">{horaDe(a.created_at)}</p>
              </div>
            </div>
          );
        })}
        <div ref={fim} />
      </div>
    </div>
  );
}
