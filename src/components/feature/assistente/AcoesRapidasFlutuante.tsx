// Assistente para quem NÃO é o dono (2026-09-23): por enquanto só a página de ações rápidas.
// Sem conversa, sem pendências, sem pagamentos — nada que passe pelo assistente-app (que é só do
// dono). Cada ação roda pelo mesmo caminho da tela, com a permissão do próprio usuário, e o menu
// mostra só as ações liberadas para ele (acoes/acesso.ts).
// Conversas com a equipe (2026-09-23): o painel ganhou a aba Conversas — falar com as pessoas da
// loja (equipe/). Ela aparece para todo mundo; a aba de ações só para quem tem alguma liberada.
// Avisos (2026-09-25): a conversa Avisos fica no topo das Conversas — pagamento dos pedidos da pessoa e
// alertas da loja que o acesso dela cobre (avisos/AvisosConversa.tsx).
import { Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { ACOES, GRUPOS } from './acoes';
import { acaoLiberada, useAcessoAcoes } from './acoes/acesso';
import { useFabArrastavel } from './useFabArrastavel';
import { useEquipeNoChat } from '@/components/feature/equipe/useEquipeNoChat';
import AvisosConversa, { LinhaAvisos, useAvisos } from '@/components/feature/avisos/AvisosConversa';

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export default function AcoesRapidasFlutuante({ variant }: { variant: 'floating' | 'embedded' }) {
  const navigate = useNavigate();
  const acesso = useAcessoAcoes();
  const [aberto, setAberto] = useState(variant === 'embedded');
  const [acao, setAcao] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [aba, setAba] = useState<'conversas' | 'acoes'>('conversas');
  useEffect(() => { if (!aberto) { setFiltro(''); setAcao(null); } }, [aberto]);
  const equipe = useEquipeNoChat({
    abrirPainel: () => { setAba('conversas'); setAberto(true); },
    fecharPainel: variant === 'floating' ? () => setAberto(false) : undefined,
  });

  const avisos = useAvisos(true);
  const [avisosAberto, setAvisosAberto] = useState(false);
  // Tocou no push do aviso: /modulos?avisos=1 abre o painel já na conversa Avisos.
  const location = useLocation();
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.get('avisos')) return;
    setAba('conversas'); setAberto(true); setAvisosAberto(true); avisos.recarregar();
    q.delete('avisos');
    navigate({ pathname: location.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!aberto) setAvisosAberto(false); }, [aberto]);
  const naoLidas = equipe.naoLidas + avisos.naoLidos;

  useVoltarFecha(variant === 'floating' && aberto, () => setAberto(false), 'acoes-rapidas-painel');
  useVoltarFecha(aberto && !!acao, () => setAcao(null), 'acoes-rapidas-acao');
  // O botão fechado anda pela tela como o do assistente do dono (arrasta e ele fica lá).
  const fab = useFabArrastavel(() => { if (naoLidas) setAba('conversas'); setAberto(true); });

  const liberadas = acesso.carregando ? [] : ACOES.filter((a) => acaoLiberada(a.id, acesso));
  // Sem ação liberada o botão continua: as conversas com a equipe são para todo mundo.
  const temAcoes = acesso.carregando || liberadas.length > 0;
  const abaAtual = temAcoes ? aba : 'conversas';

  const termo = semAcento(filtro.trim());
  const filtradas = termo ? liberadas.filter((a) => semAcento(`${a.label} ${a.grupo}`).includes(termo)) : liberadas;
  const fechar = () => { if (variant === 'floating') setAberto(false); else setAcao(null); };

  if (!aberto) {
    return (
      <button {...fab.props}
        className={`fixed z-[55] ${fab.classePosicao} w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-lg flex items-center justify-center ${fab.arrastando ? 'cursor-grabbing scale-110' : 'cursor-pointer'} select-none`}
        aria-label={naoLidas ? `Chat: ${naoLidas} ${naoLidas === 1 ? 'novidade' : 'novidades'}` : 'Chat e ações rápidas'}>
        <i className="ri-chat-3-line text-2xl" />
        {naoLidas > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-black border-2 border-white">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>
    );
  }

  const def = acao ? ACOES.find((a) => a.id === acao) : undefined;
  const C = def?.Componente;
  return (
    <div className={variant === 'floating'
      ? 'fixed z-[60] inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[420px] sm:h-[min(720px,calc(100vh-40px))] flex flex-col bg-zinc-50 sm:rounded-2xl sm:border sm:border-zinc-200 shadow-2xl overflow-hidden'
      : 'relative flex flex-col h-[70vh] rounded-2xl border border-zinc-200 bg-zinc-50 overflow-hidden'}>
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-violet-50 border border-violet-200">
          <i className={`${abaAtual === 'conversas' ? 'ri-chat-3-line' : 'ri-flashlight-line'} text-violet-600`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">{abaAtual === 'conversas' ? 'Conversas' : 'Ações rápidas'}</p>
          <p className="text-[11px] text-zinc-400 leading-tight">{abaAtual === 'conversas' ? 'Fale com as pessoas da loja' : 'Só o que o seu acesso permite'}</p>
        </div>
        {variant === 'floating' && (
          <button onClick={() => setAberto(false)} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar ações rápidas">
            <i className="ri-close-line text-xl" />
          </button>
        )}
      </div>
      {temAcoes && (
        <div className="flex gap-1 px-3 py-2 border-b border-zinc-100 bg-white flex-shrink-0" role="tablist">
          {([['conversas', 'ri-chat-3-line', 'Conversas'], ['acoes', 'ri-flashlight-line', 'Ações rápidas']] as const).map(([id, icone, rotulo]) => (
            <button key={id} role="tab" aria-selected={abaAtual === id} onClick={() => setAba(id)}
              className={`flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold cursor-pointer ${abaAtual === id ? 'bg-violet-100 text-violet-700' : 'text-zinc-500 hover:bg-zinc-100'}`}>
              <i className={`${icone} text-base`} /> {rotulo}
              {id === 'conversas' && naoLidas > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-black">
                  {naoLidas > 9 ? '9+' : naoLidas}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {abaAtual === 'conversas' ? (
        <div className="flex-1 overflow-y-auto bg-white">
          <LinhaAvisos ultimo={avisos.ultimo} naoLidos={avisos.naoLidos} onAbrir={() => { setAvisosAberto(true); avisos.recarregar(); }} />
          {equipe.secao}
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {acesso.carregando ? (
          <div className="py-10 flex justify-center"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <>
            <div className="relative pt-3">
              <i className="ri-search-line absolute left-3 top-[1.35rem] text-zinc-400" />
              <input
                type="text" value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && filtradas.length === 1) { e.preventDefault(); setAcao(filtradas[0].id); } }}
                placeholder="Procurar ação…" aria-label="Procurar ação rápida" autoComplete="off" enterKeyHint="go"
                className="w-full h-11 pl-9 pr-3 text-sm rounded-xl border border-zinc-200 bg-white focus:outline-none focus:border-violet-400"
              />
            </div>
            {GRUPOS.map((g) => {
              const doGrupo = filtradas.filter((a) => a.grupo === g);
              if (!doGrupo.length) return null;
              return (
                <div key={g} className="pt-3">
                  <p className="px-1 pb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400">{g}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {doGrupo.map((a) => (
                      <button key={a.id} onClick={() => setAcao(a.id)}
                        className="flex flex-col items-start gap-2 p-3 rounded-2xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer text-left">
                        <span className={`w-10 h-10 text-lg flex-shrink-0 flex items-center justify-center rounded-xl ${a.cor}`}><i className={a.icone} /></span>
                        <span className="leading-tight">{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {termo && !filtradas.length && <p className="py-10 text-sm text-center text-zinc-400">Nenhuma ação com “{filtro.trim()}”.</p>}
          </>
        )}
      </div>
      )}
      {equipe.camada}
      {avisosAberto && (
        <AvisosConversa
          avisos={avisos.avisos} carregado={avisos.carregado} marcarLidos={avisos.marcarLidos}
          onVoltar={() => setAvisosAberto(false)}
          onFechar={variant === 'floating' ? () => setAberto(false) : undefined}
          onBotao={(rota) => { setAvisosAberto(false); fechar(); navigate(rota); }}
        />
      )}
      {/* A ação cobre o painel inteiro (tem cabeçalho próprio com o X), como no chat do dono. */}
      {C && (
        <Suspense fallback={<div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-50"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
          <C onFechar={() => setAcao(null)} irPara={(rota) => { fechar(); navigate(rota); }} />
        </Suspense>
      )}
    </div>
  );
}
