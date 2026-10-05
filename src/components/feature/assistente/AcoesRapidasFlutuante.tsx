// Assistente para quem NÃO é o dono (2026-09-23): por enquanto só a página de ações rápidas.
// Sem conversa com o assistente e sem pagamentos — nada que passe pelo assistente-app (que é só do
// dono). Cada ação roda pelo mesmo caminho da tela, com a permissão do próprio usuário, e o menu
// mostra só as ações liberadas para ele (acoes/acesso.ts).
// Conversas com a equipe (2026-09-23): falar com as pessoas da loja (equipe/), para todo mundo.
// Avisos (2026-09-25): a conversa Avisos fica no topo das Conversas — pagamento dos pedidos da pessoa e
// alertas da loja que o acesso dela cobre (avisos/AvisosConversa.tsx).
// Currículos (2026-09-29): quem tem acesso à Contratação vê a conversa Currículos logo abaixo de
// Avisos — os avisos automáticos do módulo, só leitura (curriculos/CurriculosConversa.tsx).
// Abertura nova (2026-10-03, pedido do dono: conversar e agir rápido, um número só): uma tela só, sem
// abas — a linha "N coisas precisam de você" (o número da Hoje, que leva à Hoje), Novidades, Fazer
// rápido (as 6 mais usadas + Todas as ações) e Conversas. A caixa de pendências (PendenciasEquipe)
// continua inteira no menu ⋯. O botão fechado não tem número: a bolinha é mensagem nova.
import { Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { ACOES, GRUPOS } from './acoes';
import { acaoLiberada, useAcessoAcoes } from './acoes/acesso';
import { maisUsadas, PADRAO_EQUIPE, registrarUsoAcao } from './acoes/maisUsadas';
import { useFabArrastavel } from './useFabArrastavel';
import { useBalaoEscondido } from './useBalaoEscondido';
import { FazerRapido, LinhaNovidade, LinhaNumeroHoje, MenuMais, Novidades, TituloBloco } from './CasaBalao';
import { useEquipeNoChat } from '@/components/feature/equipe/useEquipeNoChat';
import { AvatarPessoa } from '@/components/feature/equipe/ConversaEquipe';
import { horaCurta } from '@/components/feature/equipe/api';
import AvisosConversa, { LinhaAvisos, useAvisos } from '@/components/feature/avisos/AvisosConversa';
import { useAuth } from '@/contexts/AuthContext';
import PendenciasEquipe, { usePendenciasEquipe } from './PendenciasEquipe';
import CurriculosConversa, { LinhaCurriculos, useCurriculosConversa } from '@/components/feature/curriculos/CurriculosConversa';

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// A caixa só busca as pendências enquanto está aberta (antes contava de 45 em 45 s para o número do
// botão, que saiu — o número agora é o da Hoje).
function CaixaPendencias(p: { onFechar: () => void; onAbrirRota: (tenantId: string, rota: string) => void; naoLidasConversas: number; onFecharTudo?: () => void }) {
  const dados = usePendenciasEquipe();
  return <PendenciasEquipe dados={dados} {...p} />;
}

export default function AcoesRapidasFlutuante({ variant }: { variant: 'floating' | 'embedded' }) {
  const navigate = useNavigate();
  const acesso = useAcessoAcoes();
  const [aberto, setAberto] = useState(variant === 'embedded');
  const [acao, setAcao] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  // "Todas as ações": a grade inteira com a busca, por cima da abertura.
  const [todas, setTodas] = useState(false);
  const [menuMais, setMenuMais] = useState(false);
  useEffect(() => { if (!aberto) { setFiltro(''); setAcao(null); setTodas(false); setMenuMais(false); } }, [aberto]);
  const equipe = useEquipeNoChat({
    abrirPainel: () => setAberto(true),
    fecharPainel: variant === 'floating' ? () => setAberto(false) : undefined,
  });

  const avisos = useAvisos(true);
  const [avisosAberto, setAvisosAberto] = useState(false);
  // Tocou no push do aviso: /modulos?avisos=1 abre o painel já na conversa Avisos.
  const location = useLocation();
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.get('avisos')) return;
    setAberto(true); setAvisosAberto(true); avisos.recarregar();
    q.delete('avisos');
    navigate({ pathname: location.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!aberto) setAvisosAberto(false); }, [aberto]);
  const curriculos = useCurriculosConversa(true);
  const [curriculosAberto, setCurriculosAberto] = useState(false);
  useEffect(() => { if (!aberto) setCurriculosAberto(false); }, [aberto]);
  const naoLidas = equipe.naoLidas + avisos.naoLidos + curriculos.naoLidos;
  const abrirAvisos = () => { setAvisosAberto(true); avisos.recarregar(); };
  const abrirCurriculos = () => { setCurriculosAberto(true); curriculos.recarregar(); };

  const { user, selectTenant } = useAuth();
  const [pendAberta, setPendAberta] = useState(false);
  useEffect(() => { if (!aberto) setPendAberta(false); }, [aberto]);
  useVoltarFecha(aberto && pendAberta, () => setPendAberta(false), 'acoes-rapidas-pendencias');
  const abrirRotaPendencia = async (tenantId: string, rota: string) => {
    setPendAberta(false);
    if (tenantId !== user?.tenantId) await selectTenant(tenantId);
    fechar();
    navigate(rota);
  };

  useVoltarFecha(variant === 'floating' && aberto, () => setAberto(false), 'acoes-rapidas-painel');
  useVoltarFecha(aberto && todas, () => setTodas(false), 'acoes-rapidas-todas');
  useVoltarFecha(aberto && menuMais, () => setMenuMais(false), 'acoes-rapidas-menu-mais');
  useVoltarFecha(aberto && !!acao, () => setAcao(null), 'acoes-rapidas-acao');
  // O botão fechado anda pela tela como o do assistente do dono (arrasta e ele fica lá) e sai do caminho
  // com janela aberta, rolando para baixo ou com o teclado aberto (useBalaoEscondido).
  const escondido = useBalaoEscondido(aberto);
  const fab = useFabArrastavel(() => setAberto(true));

  const liberadas = acesso.carregando ? [] : ACOES.filter((a) => acaoLiberada(a.id, acesso));
  const temAcoes = acesso.carregando || liberadas.length > 0;
  const rapidas = maisUsadas(liberadas, PADRAO_EQUIPE);
  const abrirAcao = (id: string) => { registrarUsoAcao(id); setAcao(id); };

  const termo = semAcento(filtro.trim());
  const filtradas = termo ? liberadas.filter((a) => semAcento(`${a.label} ${a.grupo}`).includes(termo)) : liberadas;
  const fechar = () => { if (variant === 'floating') setAberto(false); else { setAcao(null); setTodas(false); } };

  if (!aberto) {
    return (
      <button {...fab.props}
        className={`fab-assistente fixed z-[55] ${fab.classePosicao} w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-lg flex items-center justify-center transition-[opacity,transform] duration-200 ${escondido ? 'opacity-0 scale-50 pointer-events-none' : ''} ${fab.arrastando ? 'cursor-grabbing scale-110' : 'cursor-pointer'} select-none`}
        aria-hidden={escondido || undefined}
        tabIndex={escondido ? -1 : undefined}
        aria-label={naoLidas ? 'Conversas e ações: mensagem nova' : 'Conversas e ações rápidas'}>
        <i className="ri-chat-3-line text-2xl" />
        {/* Sem número (dono, 2026-10-03: um número só, o da Hoje). A bolinha = alguém te escreveu. */}
        {naoLidas > 0 && <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white" />}
      </button>
    );
  }

  const def = acao ? ACOES.find((a) => a.id === acao) : undefined;
  const C = def?.Componente;
  return (
    <div data-balao className={variant === 'floating'
      ? 'fixed z-[60] inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[420px] sm:h-[min(720px,calc(100vh-40px))] flex flex-col bg-zinc-50 sm:rounded-2xl sm:border sm:border-zinc-200 shadow-2xl overflow-hidden'
      : 'relative flex flex-col h-[70vh] rounded-2xl border border-zinc-200 bg-zinc-50 overflow-hidden'}>
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-violet-50 border border-violet-200">
          <i className="ri-chat-3-line text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Conversas e ações</p>
          <p className="text-[11px] text-zinc-400 leading-tight">Fale com a equipe e faça rápido</p>
        </div>
        <button onClick={() => setMenuMais(true)} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Mais opções">
          <i className="ri-more-2-fill text-xl" />
        </button>
        {variant === 'floating' && (
          <button onClick={() => setAberto(false)} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar">
            <i className="ri-close-line text-xl" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto pb-4">
        <LinhaNumeroHoje onAbrir={() => { fechar(); navigate('/hoje'); }} />
        <Novidades>{[
          avisos.naoLidos > 0 && <LinhaAvisos key="avisos" ultimo={avisos.ultimo} naoLidos={avisos.naoLidos} onAbrir={abrirAvisos} />,
          curriculos.liberado && curriculos.naoLidos > 0 && <LinhaCurriculos key="curriculos" ultimo={curriculos.ultimo} naoLidos={curriculos.naoLidos} onAbrir={abrirCurriculos} />,
          ...equipe.novas.slice(0, 3).map((c) => (
            <LinhaNovidade key={c.thread_id} icone={<AvatarPessoa pessoa={c.pessoa} tamanho="w-9 h-9" />}
              titulo={`${c.pessoa?.nome ?? 'Conversa'}${new Set(equipe.novas.map((x) => x.tenant_id)).size > 1 && c.loja ? ` · ${c.loja}` : ''}`} hora={c.ultima ? horaCurta(c.ultima.created_at) : null}
              previa={c.ultima?.texto ?? 'Mensagem nova'} n={c.nao_lidas} onClick={() => equipe.abrir(c)} />
          )),
        ]}</Novidades>
        {temAcoes && (acesso.carregando
          ? <div className="py-8 flex justify-center"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
          : <FazerRapido acoes={rapidas} total={liberadas.length} onAbrir={abrirAcao} onTodas={() => setTodas(true)} />)}
        <div className="px-3 pt-4">
          <TituloBloco texto="Conversas" />
          <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            <LinhaAvisos ultimo={avisos.ultimo} naoLidos={avisos.naoLidos} onAbrir={abrirAvisos} />
            {curriculos.liberado && (
              <LinhaCurriculos ultimo={curriculos.ultimo} naoLidos={curriculos.naoLidos} onAbrir={abrirCurriculos} />
            )}
            {equipe.secao}
          </div>
        </div>
      </div>
      {todas && (
        <div className="absolute inset-0 z-10 flex flex-col bg-zinc-50">
          <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
            <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-violet-50 border border-violet-200">
              <i className="ri-flashlight-line text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-zinc-900 leading-tight">Ações rápidas</p>
              <p className="text-[11px] text-zinc-400 leading-tight">Só o que o seu acesso permite</p>
            </div>
            <button onClick={() => setTodas(false)} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar ações rápidas">
              <i className="ri-close-line text-xl" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            <div className="relative pt-3">
              <i className="ri-search-line absolute left-3 top-[1.35rem] text-zinc-400" />
              <input
                type="text" value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && filtradas.length === 1) { e.preventDefault(); abrirAcao(filtradas[0].id); } }}
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
                      <button key={a.id} onClick={() => abrirAcao(a.id)}
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
          </div>
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
      {curriculosAberto && (
        <CurriculosConversa
          avisos={curriculos.avisos} carregado={curriculos.carregado} visto={curriculos.visto} marcarLidos={curriculos.marcarLidos}
          onVoltar={() => setCurriculosAberto(false)}
          onFechar={variant === 'floating' ? () => setAberto(false) : undefined}
          onBotao={(rota) => { setCurriculosAberto(false); fechar(); navigate(rota); }}
        />
      )}
      {pendAberta && (
        <CaixaPendencias onFechar={() => setPendAberta(false)} onAbrirRota={abrirRotaPendencia}
          naoLidasConversas={naoLidas} onFecharTudo={variant === 'floating' ? () => setAberto(false) : undefined} />
      )}
      {menuMais && (
        <MenuMais onFechar={() => setMenuMais(false)} itens={[
          { icone: 'ri-inbox-archive-line', cor: 'bg-indigo-50 text-indigo-600', titulo: 'Caixa de pendências (lista completa)', detalhe: 'As pendências das suas lojas e as suas tarefas', onClick: () => setPendAberta(true) },
          ...(temAcoes ? [{ icone: 'ri-flashlight-line', cor: 'bg-violet-50 text-violet-600', titulo: 'Todas as ações rápidas', detalhe: 'A lista inteira, com busca', onClick: () => setTodas(true) }] : []),
        ]} />
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
