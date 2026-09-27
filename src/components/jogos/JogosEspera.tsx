import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import JogoCanvas, { type GravacaoPartida } from './JogoCanvas';
import { JOGOS, type MotorJogo } from './catalogo';

// "Jogue enquanto espera": cartão que abre os joguinhos em tela cheia na mesa QR e no
// acompanhamento do delivery. Fase 1: só recorde no próprio aparelho, sem prêmio e sem
// gravar nada no banco. A gravação da partida (semente + toques) já sai pronta para o
// ranking conferido no servidor.

interface Props {
  /** Mensagem sobre o pedido para mostrar por cima do jogo (ex.: "saiu para entrega") */
  aviso?: string | null;
  /** Esconde o cartão (o jogo aberto continua aberto) */
  esconderCartao?: boolean;
}

function lerRecorde(id: string): number {
  try { return Number(window.localStorage.getItem('erpos_jogo_recorde_' + id)) || 0; } catch { return 0; }
}
function gravarRecorde(id: string, pontos: number) {
  try { window.localStorage.setItem('erpos_jogo_recorde_' + id, String(pontos)); } catch { /* sem armazenamento: só não guarda */ }
}

export default function JogosEspera(props: Props) {
  const [aberto, setAberto] = useState(false);
  const [jogo, setJogo] = useState<MotorJogo | null>(null);
  const [partida, setPartida] = useState(0);
  const [fim, setFim] = useState<{ pontos: number; recorde: number; novo: boolean } | null>(null);
  const [recordes, setRecordes] = useState<Record<string, number>>({});
  const [avisoFechado, setAvisoFechado] = useState<string | null>(null);

  useEffect(function () {
    if (!aberto) return;
    const r: Record<string, number> = {};
    for (const j of JOGOS) r[j.id] = lerRecorde(j.id);
    setRecordes(r);
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return function () { document.body.style.overflow = antes; };
  }, [aberto]);

  function jogar(j: MotorJogo) {
    setJogo(j);
    setFim(null);
    setPartida(function (p) { return p + 1; });
  }

  function aoTerminar(g: GravacaoPartida) {
    const anterior = lerRecorde(g.jogo);
    const novo = g.pontos > anterior;
    if (novo) gravarRecorde(g.jogo, g.pontos);
    setRecordes(function (r) { return { ...r, [g.jogo]: Math.max(anterior, g.pontos) }; });
    // pequena pausa para ver a batida antes do cartão de fim
    setTimeout(function () { setFim({ pontos: g.pontos, recorde: Math.max(anterior, g.pontos), novo }); }, 450);
  }

  function fechar() {
    setAberto(false);
    setJogo(null);
    setFim(null);
  }

  const aviso = props.aviso && props.aviso !== avisoFechado ? props.aviso : null;

  return (
    <>
      {!props.esconderCartao ? (
        <button
          type="button"
          onClick={function () { setAberto(true); }}
          className="w-full flex items-center gap-3 p-4 rounded-2xl text-left cursor-pointer bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-fuchsia-500/20 hover:brightness-105 transition"
        >
          <div className="w-12 h-12 flex items-center justify-center bg-white/20 rounded-xl shrink-0">
            <i className="ri-gamepad-line text-white text-2xl" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm">Jogue enquanto espera</p>
            <p className="text-white/80 text-xs mt-0.5">Voa Voa, Corre Corre e bata seu recorde</p>
          </div>
          <i className="ri-play-circle-fill text-white text-3xl" />
        </button>
      ) : null}

      {aberto ? createPortal(
        <div data-no-pull className="fixed inset-0 z-[1000] bg-slate-900 flex flex-col" style={{ height: '100dvh' }}>
          <div className="flex items-center gap-2 px-3 py-2 shrink-0">
            <button
              type="button"
              onClick={function () { if (jogo) { setJogo(null); setFim(null); } else fechar(); }}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white cursor-pointer"
              aria-label={jogo ? 'Voltar aos jogos' : 'Fechar'}
            >
              <i className={(jogo ? 'ri-arrow-left-line' : 'ri-close-line') + ' text-xl'} />
            </button>
            <p className="flex-1 text-white font-black text-base truncate">{jogo ? jogo.nome : 'Jogos'}</p>
            {jogo ? (
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1">
                <i className="ri-trophy-line" /> {recordes[jogo.id] || 0}
              </span>
            ) : null}
            {jogo ? (
              <button type="button" onClick={fechar} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white cursor-pointer" aria-label="Fechar">
                <i className="ri-close-line text-xl" />
              </button>
            ) : null}
          </div>

          {aviso ? (
            <div className="mx-3 mb-2 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500 text-white shrink-0">
              <i className="ri-notification-3-line text-lg" />
              <p className="flex-1 text-sm font-bold">{aviso}</p>
              <button type="button" onClick={fechar} className="px-3 py-1.5 rounded-lg bg-white/20 text-xs font-bold cursor-pointer whitespace-nowrap">Ver pedido</button>
              <button type="button" onClick={function () { setAvisoFechado(props.aviso || null); }} className="w-7 h-7 flex items-center justify-center cursor-pointer" aria-label="Dispensar aviso">
                <i className="ri-close-line" />
              </button>
            </div>
          ) : null}

          <div className="relative flex-1 min-h-0 mx-2 mb-2">
            {jogo ? (
              <>
                <JogoCanvas motor={jogo} partida={partida} onFim={aoTerminar} />
                {fim ? (
                  <div className="absolute inset-0 flex items-center justify-center p-6 bg-slate-900/40">
                    <div className="w-full max-w-xs bg-white rounded-3xl p-6 text-center shadow-2xl">
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Fim de jogo</p>
                      <p className="text-6xl font-black text-zinc-800 mt-2">{fim.pontos}</p>
                      <p className="text-sm text-zinc-500 mt-1">pontos</p>
                      {fim.novo && fim.pontos > 0 ? (
                        <p className="mt-3 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-black">
                          <i className="ri-trophy-fill" /> Novo recorde!
                        </p>
                      ) : (
                        <p className="mt-3 text-xs text-zinc-500">Seu recorde: <strong>{fim.recorde}</strong></p>
                      )}
                      <button
                        type="button"
                        onClick={function () { jogar(jogo); }}
                        className="mt-5 w-full py-3 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-black text-sm cursor-pointer"
                      >
                        <i className="ri-restart-line mr-1" /> Jogar de novo
                      </button>
                      <button
                        type="button"
                        onClick={function () { setJogo(null); setFim(null); }}
                        className="mt-2 w-full py-2.5 rounded-xl bg-zinc-100 text-zinc-700 font-bold text-sm cursor-pointer"
                      >
                        Outros jogos
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="h-full overflow-y-auto px-2 pt-2">
                <p className="text-white/70 text-sm mb-4">Escolha um jogo. Seu recorde fica guardado neste celular.</p>
                <div className="grid gap-3 max-w-md mx-auto">
                  {JOGOS.map(function (j) {
                    return (
                      <button
                        key={j.id}
                        type="button"
                        onClick={function () { jogar(j); }}
                        className={'flex items-center gap-4 p-4 rounded-2xl text-left cursor-pointer bg-gradient-to-br ' + j.cor}
                      >
                        <div className="w-14 h-14 flex items-center justify-center bg-white/25 rounded-2xl shrink-0">
                          <i className={j.icone + ' text-white text-3xl'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-black text-lg leading-tight">{j.nome}</p>
                          <p className="text-white/85 text-xs mt-1">{j.descricao}</p>
                          <p className="text-white text-xs font-bold mt-2 flex items-center gap-1">
                            <i className="ri-trophy-line" /> Recorde: {recordes[j.id] || 0}
                          </p>
                        </div>
                        <i className="ri-play-fill text-white text-3xl" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>,
        // portal: o pai com transform (puxar para atualizar) prenderia o position:fixed
        document.body,
      ) : null}
    </>
  );
}
