import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JogoCanvas, { type GravacaoPartida } from './JogoCanvas';
import { JOGOS, type MotorJogo } from './catalogo';
import {
  comecarPartida, configJogos, direitoJogar, enviarPartida, gravarJogador, lerJogador, rankingJogo, soDigitos,
  type ConfigJogos, type CredencialJogo, type Jogador, type LinhaRanking,
} from '@/lib/jogos/api';

// "Jogue enquanto espera": cartão que abre os joguinhos em tela cheia na mesa QR e no
// acompanhamento do delivery. Recorde fica no aparelho. Quando a loja liga o ranking
// (Clientes & Marketing › Jogos), quem fez pedido e informou nome + WhatsApp joga
// VALENDO: a semente vem do servidor e a pontuação é recalculada lá (Edge `jogos`).

interface Props {
  /** Mensagem sobre o pedido para mostrar por cima do jogo (ex.: "saiu para entrega") */
  aviso?: string | null;
  /** Esconde o cartão (o jogo aberto continua aberto) */
  esconderCartao?: boolean;
  /** Loja + pedido que dá direito ao ranking; sem isso só joga por diversão */
  tenantId?: string;
  credencial?: CredencialJogo | null;
  /** Para já preencher o cadastro do ranking */
  nomeInicial?: string;
  telefoneInicial?: string;
  /** Delivery: a tela já acompanha o status. Mesa: omitir e o jogo pergunta à Edge. */
  pedidoEntregue?: boolean;
  /** Botão "Fazer novo pedido" quando o jogo está pausado */
  onNovoPedido?: () => void;
}

// Regra do dono (2026-09-27): só joga depois de pedir; entregou, o jogo para até o próximo pedido.
const MSG_ENTREGUE = 'Seu pedido foi entregue. Faça um novo pedido para continuar jogando.';

type Tela = 'menu' | 'jogo' | 'ranking' | 'cadastro';

interface Fim {
  pontos: number;
  recorde: number;
  novo: boolean;
  ranking?: { posicao: number | null; jogadores: number; melhor: number } | null;
  erroRanking?: string | null;
  enviando?: boolean;
}

function lerRecorde(id: string): number {
  try { return Number(window.localStorage.getItem('erpos_jogo_recorde_' + id)) || 0; } catch { return 0; }
}
function gravarRecorde(id: string, pontos: number) {
  try { window.localStorage.setItem('erpos_jogo_recorde_' + id, String(pontos)); } catch { /* sem armazenamento: só não guarda */ }
}
function mascaraFone(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, d.length - 4) + '-' + d.slice(-4);
}
const MEDALHA = ['🥇', '🥈', '🥉'];

export default function JogosEspera(props: Props) {
  const [aberto, setAberto] = useState(false);
  const [tela, setTela] = useState<Tela>('menu');
  const [jogo, setJogo] = useState<MotorJogo | null>(null);
  const [partida, setPartida] = useState(0);
  // respostas atrasadas de uma partida não podem aparecer na seguinte
  const partidaRef = useRef(0);
  partidaRef.current = partida;
  const enviadasRef = useRef(new Set<string>());
  const [fim, setFim] = useState<Fim | null>(null);
  const [recordes, setRecordes] = useState<Record<string, number>>({});
  const [avisoFechado, setAvisoFechado] = useState<string | null>(null);

  const [cfg, setCfg] = useState<ConfigJogos | null>(null);
  const [jogador, setJogador] = useState<Jogador | null>(null);
  const [sessao, setSessao] = useState<{ id: string; semente: number } | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [avisoRanking, setAvisoRanking] = useState<string | null>(null);
  const [depoisCadastro, setDepoisCadastro] = useState<MotorJogo | null>(null);
  const [formNome, setFormNome] = useState('');
  const [formFone, setFormFone] = useState('');
  const [erroForm, setErroForm] = useState<string | null>(null);

  const [rankJogo, setRankJogo] = useState<string>('voa');
  const [rank, setRank] = useState<{ top: LinhaRanking[]; eu: { posicao: number; pontos: number } | null; jogadores: number } | null>(null);
  const [carregandoRank, setCarregandoRank] = useState(false);

  const podeRanking = !!props.tenantId && !!props.credencial;

  // Mesa: pergunta à Edge a cada 30 s (só com a tela visível) se o pedido ainda está em andamento
  const [bloqueioMesa, setBloqueioMesa] = useState<string | null>(null);
  const credMesa = props.credencial && props.credencial.tipo === 'mesa' ? props.credencial : null;
  const mesaId = credMesa ? credMesa.participant_id : '';
  const mesaSenha = credMesa ? credMesa.access_token : '';
  useEffect(function () {
    if (!props.tenantId || !mesaId || props.pedidoEntregue !== undefined) return;
    let vivo = true;
    function checar() {
      if (document.visibilityState === 'hidden') return;
      direitoJogar(props.tenantId!, { tipo: 'mesa', participant_id: mesaId, access_token: mesaSenha })
        .then(function (r) { if (vivo) setBloqueioMesa(r.pode_jogar ? null : (r.mensagem || MSG_ENTREGUE)); })
        .catch(function () { /* sem rede: não trava o jogo */ });
    }
    checar();
    const id = setInterval(checar, 30000);
    document.addEventListener('visibilitychange', checar);
    return function () { vivo = false; clearInterval(id); document.removeEventListener('visibilitychange', checar); };
  }, [props.tenantId, mesaId, mesaSenha, props.pedidoEntregue]);
  const bloqueio = props.pedidoEntregue ? MSG_ENTREGUE : bloqueioMesa;

  // pausou no meio da partida: o jogo para na hora
  useEffect(function () {
    if (!bloqueio) return;
    setTela('menu'); setJogo(null); setFim(null); setSessao(null); setPreparando(false);
  }, [bloqueio]);
  const rankingAtivo = podeRanking && !!cfg && cfg.ranking_ativo;

  useEffect(function () {
    if (!aberto) return;
    const r: Record<string, number> = {};
    for (const j of JOGOS) r[j.id] = lerRecorde(j.id);
    setRecordes(r);
    setJogador(lerJogador());
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return function () { document.body.style.overflow = antes; };
  }, [aberto]);

  // busca já quando o cartão aparece: a Edge pode demorar a acordar e o banner do ranking
  // tem que estar pronto quando a pessoa abrir
  useEffect(function () {
    if (!podeRanking || cfg) return;
    configJogos(props.tenantId!).then(setCfg).catch(function () { /* sem ranking: joga por diversão */ });
  }, [podeRanking, cfg, props.tenantId]);

  function valendo(j: MotorJogo): boolean {
    return rankingAtivo && !!jogador && cfg!.jogos.includes(j.id);
  }

  async function jogar(j: MotorJogo) {
    setJogo(j);
    setFim(null);
    setTela('jogo');
    setSessao(null);
    setAvisoRanking(null);
    if (valendo(j)) {
      setPreparando(true);
      try {
        const s = await comecarPartida(props.tenantId!, j.id, jogador!, props.credencial!);
        setSessao({ id: s.sessao, semente: s.semente });
      } catch (e) {
        setAvisoRanking((e as Error).message + ' Esta partida não vale para o ranking.');
      }
      setPreparando(false);
    }
    setPartida(function (p) { return p + 1; });
  }

  function aoTerminar(g: GravacaoPartida) {
    const anterior = lerRecorde(g.jogo);
    const novo = g.pontos > anterior;
    if (novo) gravarRecorde(g.jogo, g.pontos);
    setRecordes(function (r) { return { ...r, [g.jogo]: Math.max(anterior, g.pontos) }; });
    const base: Fim = { pontos: g.pontos, recorde: Math.max(anterior, g.pontos), novo };
    // a sessão fica no estado (a semente do canvas não pode mudar, senão o jogo reinicia
    // por trás do cartão); o ref só impede mandar a mesma partida duas vezes
    const s = sessao;
    const minha = partidaRef.current;
    if (s && props.tenantId && !enviadasRef.current.has(s.id)) {
      enviadasRef.current.add(s.id);
      base.enviando = true;
      enviarPartida(props.tenantId, s.id, g.quadros)
        .then(function (r) {
          if (partidaRef.current !== minha) return;
          setFim(function (f) { return { ...(f || base), enviando: false, ranking: { posicao: r.posicao, jogadores: r.jogadores, melhor: r.melhor } }; });
        })
        .catch(function (e) {
          if (partidaRef.current !== minha) return;
          setFim(function (f) { return { ...(f || base), enviando: false, erroRanking: (e as Error).message }; });
        });
    }
    // pequena pausa para ver a batida antes do cartão de fim (se o ranking já respondeu, mantém)
    setTimeout(function () { if (partidaRef.current === minha) setFim(function (f) { return f || base; }); }, 450);
  }

  function abrirCadastro(proximo: MotorJogo | null) {
    setDepoisCadastro(proximo);
    setFormNome(jogador?.nome || props.nomeInicial || '');
    setFormFone(mascaraFone(jogador?.telefone || props.telefoneInicial || ''));
    setErroForm(null);
    setTela('cadastro');
  }

  function salvarCadastro() {
    const nome = formNome.trim();
    const fone = soDigitos(formFone);
    if (nome.length < 2) { setErroForm('Digite seu nome.'); return; }
    if (fone.length < 10 || fone.length > 11) { setErroForm('Digite o WhatsApp com DDD.'); return; }
    const j = { nome, telefone: fone };
    gravarJogador(j);
    setJogador(j);
    if (depoisCadastro) {
      // o estado novo ainda não chegou em `jogador`: começa direto com ele
      const alvo = depoisCadastro;
      setDepoisCadastro(null);
      setJogo(alvo); setFim(null); setTela('jogo'); setSessao(null); setAvisoRanking(null); setPreparando(true);
      comecarPartida(props.tenantId!, alvo.id, j, props.credencial!)
        .then(function (s) { setSessao({ id: s.sessao, semente: s.semente }); })
        .catch(function (e) { setAvisoRanking((e as Error).message + ' Esta partida não vale para o ranking.'); })
        .finally(function () { setPreparando(false); setPartida(function (p) { return p + 1; }); });
    } else setTela('menu');
  }

  function abrirRanking(id?: string) {
    const alvo = id || (jogo && cfg?.jogos.includes(jogo.id) ? jogo.id : cfg?.jogos[0]) || 'voa';
    setRankJogo(alvo);
    setTela('ranking');
    setFim(null);
    setRank(null);
    setCarregandoRank(true);
    rankingJogo(props.tenantId!, alvo, jogador?.telefone || '')
      .then(function (r) { setRank({ top: r.top, eu: r.eu, jogadores: r.jogadores }); })
      .catch(function () { setRank({ top: [], eu: null, jogadores: 0 }); })
      .finally(function () { setCarregandoRank(false); });
  }

  function voltar() {
    if (tela === 'menu') { fechar(); return; }
    setTela('menu'); setJogo(null); setFim(null); setSessao(null);
  }

  function fechar() {
    setAberto(false);
    setTela('menu');
    setJogo(null);
    setFim(null);
    setSessao(null);
  }

  const aviso = props.aviso && props.aviso !== avisoFechado ? props.aviso : null;
  const titulo = tela === 'jogo' && jogo ? jogo.nome : tela === 'ranking' ? 'Ranking da semana' : tela === 'cadastro' ? 'Entrar no ranking' : 'Jogos';

  return (
    <>
      {bloqueio && !props.esconderCartao ? (
        <div className="w-full flex items-center gap-3 p-4 rounded-2xl bg-zinc-100 border border-zinc-200">
          <div className="w-12 h-12 flex items-center justify-center bg-white rounded-xl shrink-0">
            <i className="ri-gamepad-line text-zinc-400 text-2xl" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-zinc-800 font-black text-sm">Jogos pausados</p>
            <p className="text-zinc-500 text-xs mt-0.5">{bloqueio} Seu recorde fica guardado.</p>
          </div>
          {props.onNovoPedido ? (
            <button type="button" onClick={props.onNovoPedido} className="px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold cursor-pointer whitespace-nowrap">
              Novo pedido
            </button>
          ) : null}
        </div>
      ) : !props.esconderCartao ? (
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
              onClick={voltar}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white cursor-pointer"
              aria-label={tela === 'menu' ? 'Fechar' : 'Voltar'}
            >
              <i className={(tela === 'menu' ? 'ri-close-line' : 'ri-arrow-left-line') + ' text-xl'} />
            </button>
            <p className="flex-1 text-white font-black text-base truncate">{titulo}</p>
            {tela === 'jogo' && jogo && sessao ? (
              <span className="text-[10px] font-black text-emerald-300 bg-emerald-500/20 px-2 py-1 rounded-full whitespace-nowrap">VALENDO RANKING</span>
            ) : null}
            {tela === 'jogo' && jogo ? (
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1">
                <i className="ri-trophy-line" /> {recordes[jogo.id] || 0}
              </span>
            ) : null}
            {tela !== 'menu' ? (
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

          {tela === 'jogo' && avisoRanking ? (
            <div className="mx-3 mb-2 px-3 py-2 rounded-xl bg-amber-500/20 text-amber-200 text-xs font-semibold shrink-0">{avisoRanking}</div>
          ) : null}

          <div className="relative flex-1 min-h-0 mx-2 mb-2">
            {bloqueio ? (
              <div className="h-full flex items-center justify-center p-6">
                <div className="w-full max-w-xs bg-white rounded-3xl p-6 text-center shadow-2xl">
                  <p className="text-4xl">🍽️</p>
                  <p className="text-lg font-black text-zinc-800 mt-2">Seu pedido chegou!</p>
                  <p className="text-sm text-zinc-500 mt-2">
                    O jogo pausou aqui. Faça um novo pedido para continuar jogando{rankingAtivo ? ' e subir no ranking da semana' : ''}. Seu recorde fica guardado.
                  </p>
                  {props.onNovoPedido ? (
                    <button type="button" onClick={function () { fechar(); props.onNovoPedido!(); }} className="mt-5 w-full py-3 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-black text-sm cursor-pointer">
                      Fazer novo pedido
                    </button>
                  ) : null}
                  <button type="button" onClick={fechar} className="mt-2 w-full py-2.5 rounded-xl bg-zinc-100 text-zinc-700 font-bold text-sm cursor-pointer">
                    Ver meu pedido
                  </button>
                </div>
              </div>
            ) : tela === 'jogo' && jogo ? (
              <>
                {preparando ? (
                  <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
                    <i className="ri-loader-4-line animate-spin mr-2" /> Preparando a partida...
                  </div>
                ) : (
                  <JogoCanvas motor={jogo} partida={partida} semente={sessao ? sessao.semente : null} onFim={aoTerminar} />
                )}
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
                      {fim.enviando ? (
                        <p className="mt-3 text-xs text-zinc-400"><i className="ri-loader-4-line animate-spin" /> Conferindo no ranking...</p>
                      ) : fim.ranking && fim.ranking.posicao ? (
                        <button type="button" onClick={function () { abrirRanking(jogo.id); }} className="mt-3 w-full px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold cursor-pointer">
                          {fim.ranking.posicao <= 3 ? MEDALHA[fim.ranking.posicao - 1] + ' ' : ''}Você está em {fim.ranking.posicao}º de {fim.ranking.jogadores} na semana (melhor: {fim.ranking.melhor}) ›
                        </button>
                      ) : fim.erroRanking ? (
                        <p className="mt-3 text-xs text-red-500">{fim.erroRanking}</p>
                      ) : rankingAtivo && !jogador && cfg!.jogos.includes(jogo.id) ? (
                        <button type="button" onClick={function () { abrirCadastro(jogo); }} className="mt-3 w-full px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold cursor-pointer">
                          🏆 Quer concorrer a prêmio? Entre no ranking ›
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={function () { jogar(jogo); }}
                        className="mt-5 w-full py-3 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-black text-sm cursor-pointer"
                      >
                        <i className="ri-restart-line mr-1" /> Jogar de novo
                      </button>
                      <button
                        type="button"
                        onClick={function () { setTela('menu'); setJogo(null); setFim(null); }}
                        className="mt-2 w-full py-2.5 rounded-xl bg-zinc-100 text-zinc-700 font-bold text-sm cursor-pointer"
                      >
                        Outros jogos
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : tela === 'cadastro' ? (
              <div className="h-full overflow-y-auto px-2 pt-2">
                <div className="max-w-md mx-auto bg-white rounded-3xl p-5">
                  <p className="text-lg font-black text-zinc-800">🏆 Entrar no ranking</p>
                  <p className="text-sm text-zinc-500 mt-1">
                    Os 3 melhores da semana ganham prêmio da loja. Seu WhatsApp é só para a loja avisar se você ganhar; no ranking aparece só seu nome e os 2 últimos números.
                  </p>
                  <label className="block text-xs font-bold text-zinc-600 mt-4 mb-1">Seu nome</label>
                  <input value={formNome} onChange={function (e) { setFormNome(e.target.value); }} maxLength={40} className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm" placeholder="Ex.: Maria Silva" />
                  <label className="block text-xs font-bold text-zinc-600 mt-3 mb-1">WhatsApp{props.credencial?.tipo === 'delivery' ? ' (o mesmo do pedido)' : ''}</label>
                  <input value={formFone} onChange={function (e) { setFormFone(mascaraFone(e.target.value)); }} inputMode="tel" className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm" placeholder="(41) 99999-9999" />
                  {erroForm ? <p className="text-xs text-red-500 mt-2">{erroForm}</p> : null}
                  <button type="button" onClick={salvarCadastro} className="mt-4 w-full py-3 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-black text-sm cursor-pointer">
                    {depoisCadastro ? 'Salvar e jogar' : 'Salvar'}
                  </button>
                  {jogador ? (
                    <button type="button" onClick={function () { gravarJogador(null); setJogador(null); setTela('menu'); }} className="mt-2 w-full py-2.5 rounded-xl bg-zinc-100 text-zinc-600 font-bold text-xs cursor-pointer">
                      Sair do ranking neste celular
                    </button>
                  ) : null}
                </div>
              </div>
            ) : tela === 'ranking' ? (
              <div className="h-full overflow-y-auto px-2 pt-1">
                <div className="max-w-md mx-auto">
                  <div className="flex gap-2 mb-3">
                    {JOGOS.filter(function (j) { return cfg?.jogos.includes(j.id); }).map(function (j) {
                      return (
                        <button key={j.id} type="button" onClick={function () { abrirRanking(j.id); }}
                          className={'flex-1 py-2 rounded-xl text-sm font-bold cursor-pointer ' + (rankJogo === j.id ? 'bg-white text-zinc-900' : 'bg-white/10 text-white')}>
                          {j.nome}
                        </button>
                      );
                    })}
                  </div>
                  <BlocoPremios cfg={cfg} />
                  {carregandoRank || !rank ? (
                    <p className="text-white/60 text-sm text-center py-8"><i className="ri-loader-4-line animate-spin" /> Carregando...</p>
                  ) : rank.top.length === 0 ? (
                    <p className="text-white/70 text-sm text-center py-8">Ninguém jogou esta semana ainda. Seja o primeiro!</p>
                  ) : (
                    <div className="bg-white rounded-2xl overflow-hidden mt-3">
                      {rank.top.map(function (l) {
                        return (
                          <div key={l.posicao} className={'flex items-center gap-3 px-4 py-3 border-b border-zinc-100 last:border-0 ' + (l.eu ? 'bg-violet-50' : '')}>
                            <span className="w-8 text-center text-base font-black text-zinc-500">{l.posicao <= 3 ? MEDALHA[l.posicao - 1] : l.posicao + 'º'}</span>
                            <span className="flex-1 text-sm font-bold text-zinc-800 truncate">{l.nome} <span className="text-zinc-400 font-medium">•• {l.final}</span>{l.eu ? <span className="ml-1 text-violet-600 text-xs">(você)</span> : null}</span>
                            <span className="text-sm font-black text-zinc-900">{l.pontos}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {rank && rank.eu && rank.eu.posicao > 10 ? (
                    <p className="text-white/80 text-sm text-center mt-3">Você está em <strong>{rank.eu.posicao}º</strong> com {rank.eu.pontos} pontos</p>
                  ) : null}
                  {rank ? <p className="text-white/50 text-xs text-center mt-3 mb-4">{rank.jogadores} jogador{rank.jogadores === 1 ? '' : 'es'} esta semana</p> : null}
                </div>
              </div>
            ) : (
              <div className="h-full overflow-y-auto px-2 pt-2">
                <div className="max-w-md mx-auto">
                  {rankingAtivo ? (
                    <div className="mb-4 p-4 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500">
                      <p className="text-white font-black text-base">🏆 Ranking da semana</p>
                      <p className="text-white/90 text-xs mt-0.5">Os 3 melhores ganham prêmio. Termina domingo às 23:59.</p>
                      {cfg!.premios.length ? (
                        <div className="mt-2 space-y-0.5">
                          {cfg!.premios.map(function (p) {
                            return <p key={p.posicao} className="text-white text-xs font-bold">{MEDALHA[p.posicao - 1]} {p.descricao}</p>;
                          })}
                        </div>
                      ) : null}
                      <div className="flex gap-2 mt-3">
                        <button type="button" onClick={function () { abrirRanking(); }} className="flex-1 py-2 rounded-xl bg-white text-orange-600 text-xs font-black cursor-pointer">Ver ranking</button>
                        {jogador ? (
                          <button type="button" onClick={function () { abrirCadastro(null); }} className="flex-1 py-2 rounded-xl bg-white/25 text-white text-xs font-bold cursor-pointer truncate px-2">
                            {jogador.nome.split(' ')[0]} •• {jogador.telefone.slice(-2)}
                          </button>
                        ) : (
                          <button type="button" onClick={function () { abrirCadastro(null); }} className="flex-1 py-2 rounded-xl bg-white/25 text-white text-xs font-black cursor-pointer">Participar</button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-white/70 text-sm mb-4">Escolha um jogo. Seu recorde fica guardado neste celular.</p>
                  )}
                  <div className="grid gap-3">
                    {JOGOS.map(function (j) {
                      return (
                        <button
                          key={j.id}
                          type="button"
                          onClick={function () { if (rankingAtivo && !jogador && cfg!.jogos.includes(j.id)) abrirCadastro(j); else jogar(j); }}
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

function BlocoPremios(props: { cfg: ConfigJogos | null }) {
  if (!props.cfg || props.cfg.premios.length === 0) return null;
  return (
    <div className="px-4 py-3 rounded-2xl bg-white/10">
      <p className="text-white/70 text-[11px] font-bold uppercase tracking-wider">Prêmios da semana · termina domingo às 23:59</p>
      {props.cfg.premios.map(function (p) {
        return <p key={p.posicao} className="text-white text-sm font-bold mt-1">{MEDALHA[p.posicao - 1]} {p.descricao}</p>;
      })}
      {props.cfg.regras ? <p className="text-white/60 text-xs mt-2 whitespace-pre-line">{props.cfg.regras}</p> : null}
    </div>
  );
}
