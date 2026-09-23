// Assistente para quem NÃO é o dono (2026-09-23): por enquanto só a página de ações rápidas.
// Sem conversa, sem pendências, sem pagamentos — nada que passe pelo assistente-app (que é só do
// dono). Cada ação roda pelo mesmo caminho da tela, com a permissão do próprio usuário, e o menu
// mostra só as ações liberadas para ele (acoes/acesso.ts).
import { Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { ACOES, GRUPOS } from './acoes';
import { acaoLiberada, useAcessoAcoes } from './acoes/acesso';

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export default function AcoesRapidasFlutuante({ variant }: { variant: 'floating' | 'embedded' }) {
  const navigate = useNavigate();
  const acesso = useAcessoAcoes();
  const [aberto, setAberto] = useState(variant === 'embedded');
  const [acao, setAcao] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  useEffect(() => { if (!aberto) { setFiltro(''); setAcao(null); } }, [aberto]);

  useVoltarFecha(variant === 'floating' && aberto, () => setAberto(false), 'acoes-rapidas-painel');
  useVoltarFecha(aberto && !!acao, () => setAcao(null), 'acoes-rapidas-acao');

  const liberadas = acesso.carregando ? [] : ACOES.filter((a) => acaoLiberada(a.id, acesso));
  // Sem nenhuma ação liberada não há o que mostrar: nem o botão aparece.
  if (!acesso.carregando && !liberadas.length) return null;
  if (acesso.carregando && !aberto) return null;

  const termo = semAcento(filtro.trim());
  const filtradas = termo ? liberadas.filter((a) => semAcento(`${a.label} ${a.grupo}`).includes(termo)) : liberadas;
  const fechar = () => { if (variant === 'floating') setAberto(false); else setAcao(null); };

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        className="fixed z-[55] bottom-5 right-5 w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-lg flex items-center justify-center cursor-pointer select-none"
        aria-label="Ações rápidas">
        <i className="ri-flashlight-line text-2xl" />
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
          <i className="ri-flashlight-line text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Ações rápidas</p>
          <p className="text-[11px] text-zinc-400 leading-tight">Só o que o seu acesso permite</p>
        </div>
        {variant === 'floating' && (
          <button onClick={() => setAberto(false)} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar ações rápidas">
            <i className="ri-close-line text-xl" />
          </button>
        )}
      </div>
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
      {/* A ação cobre o painel inteiro (tem cabeçalho próprio com o X), como no chat do dono. */}
      {C && (
        <Suspense fallback={<div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-50"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
          <C onFechar={() => setAcao(null)} irPara={(rota) => { fechar(); navigate(rota); }} />
        </Suspense>
      )}
    </div>
  );
}
