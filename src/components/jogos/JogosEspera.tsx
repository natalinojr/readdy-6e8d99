import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JogoCanvas, { type GravacaoPartida } from './JogoCanvas';
import { JOGOS, type MotorJogo } from './catalogo';
import {
  comecarPartida, configJogos, direitoJogar, enviarPartida, rankingJogo, soDigitos,
  type ConfigJogos, type CredencialJogo, type LinhaRanking,
} from '@/lib/jogos/api';
import { clubeChamar, clubeSalvarToken, clubeTokenSalvo } from '@/lib/clubePublico';

// "Jogue enquanto espera": cartão que abre os joguinhos em tela cheia na mesa QR e no
// acompanhamento do delivery. Regras do dono (2026-09-27): os jogos são SÓ DO CLUBE de
// fidelidade (loja sem clube não mostra; quem não é membro vê "entre no clube") e só com
// pedido em andamento (entregou, pausa até o próximo pedido). Quem joga é identificado
// pelo cartão do clube no aparelho — nada de pedir nome/WhatsApp. Com o ranking ligado
// (Clientes & Marketing › Jogos) toda partida vale: semente do servidor e pontuação
// recalculada lá (Edge `jogos`). Recorde fica no aparelho.

interface Props {
  /** Mensagem sobre o pedido para mostrar por cima do jogo (ex.: "saiu para entrega") */
  aviso?: string | null;
  /** Esconde o cartão (o jogo aberto continua aberto) */
  esconderCartao?: boolean;
  /** Loja + pedido que dá direito a jogar; sem os dois (só a demo /dev/jogos) joga livre */
  tenantId?: string;
  credencial?: CredencialJogo | null;
  /** Delivery: a tela já acompanha o status. Mesa: omitir e o jogo pergunta à Edge. */
  pedidoEntregue?: boolean;
  /** Botão "Fazer novo pedido" quando o jogo está pausado */
  onNovoPedido?: () => void;
}

// Regra do dono (2026-09-27): só joga depois de pedir; entregou, o jogo para até o próximo pedido.
const MSG_ENTREGUE = 'Seu pedido foi entregue. Faça um novo pedido para continuar jogando.';

type Tela = 'menu' | 'jogo' | 'ranking' | 'clube';

interface Fim {
  pontos: number;
  recorde: number;
  novo: boolean;
  ranking?: { posicao: number | null; jogadores: number; melhor: number } | null;
  erroRanking?: string | null;
  enviando?: boolean;
}

function soCpf(v: string) { return soDigitos(v).slice(0, 11); }
function mascaraCpf(v: string) {
  const d = soCpf(v);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

function lerRecorde(id: string): number {
  try { return Number(window.localStorage.getItem('erpos_jogo_recorde_' + id)) || 0; } catch { return 0; }
}
function gravarRecorde(id: string, pontos: number) {
  try { window.localStorage.setItem('erpos_jogo_recorde_' + id, String(pontos)); } catch { /* sem armazenamento: só não guarda */ }
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
  const [sessao, setSessao] = useState<{ id: string; semente: number } | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [avisoRanking, setAvisoRanking] = useState<string | null>(null);

  const [rankJogo, setRankJogo] = useState<string>('voa');
  const [rank, setRank] = useState<{ top: LinhaRanking[]; eu: { posicao: number; pontos: number } | null; jogadores: number } | null>(null);
  const [carregandoRank, setCarregandoRank] = useState(false);

  // Loja + pedido: exige clube e pedido em andamento. Sem isso é a demo (/dev/jogos).
  const exigeClube = !!props.tenantId && !!props.credencial;
  const [clubeToken, setClubeToken] = useState<string | null>(function () { return clubeTokenSalvo(props.tenantId); });
  const [direito, setDireito] = useState<{ pode: boolean; motivo?: string; mensagem?: string } | null>(null);
  const [formCpf, setFormCpf] = useState('');
  const [formFinal, setFormFinal] = useState('');
  const [erroClube, setErroClube] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  useEffect(function () {
    if (!props.tenantId) return;
    configJogos(props.tenantId).then(setCfg).catch(function () { /* sem config: tenta de novo na próxima montagem */ });
  }, [props.tenantId]);

  // Pergunta à Edge a cada 30 s (só com a tela visível): é do clube? pedido ainda em andamento?
  // Ao voltar para a aba relê o cartão (a pessoa pode ter entrado no clube em /clube/<loja>).
  const cred = props.credencial;
  const credChave = !cred ? '' : cred.tipo === 'mesa' ? 'm:' + cred.participant_id + ':' + cred.access_token : 'd:' + cred.order_number;
  useEffect(function () {
    if (!exigeClube) return;
    let vivo = true;
    function checar() {
      if (document.visibilityState === 'hidden') return;
      const token = clubeTokenSalvo(props.tenantId);
      setClubeToken(token);
      if (!token) { setDireito({ pode: false, motivo: 'sem_clube' }); return; }
      direitoJogar(props.tenantId!, props.credencial!, token)
        .then(function (r) {
          if (!vivo) return;
          if (r.motivo === 'sem_clube') { clubeSalvarToken(props.tenantId!, null); setClubeToken(null); }
          setDireito({ pode: r.pode_jogar, motivo: r.motivo, mensagem: r.mensagem });
        })
        .catch(function () { /* sem rede: não trava o jogo */ });
    }
    checar();
    const id = setInterval(checar, 30000);
    document.addEventListener('visibilitychange', checar);
    return function () { vivo = false; clearInterval(id); document.removeEventListener('visibilitychange', checar); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exigeClube, props.tenantId, credChave, clubeToken]);

  const semClube = exigeClube && (!clubeToken || direito?.motivo === 'sem_clube');
  const bloqueio = props.pedidoEntregue ? MSG_ENTREGUE
    : direito && !direito.pode && direito.motivo !== 'sem_clube' ? (direito.mensagem || MSG_ENTREGUE) : null;

  // pausou no meio da partida: o jogo para na hora
  useEffect(function () {
    if (!bloqueio) return;
    setTela('menu'); setJogo(null); setFim(null); setSessao(null); setPreparando(false);
  }, [bloqueio]);
  const rankingAtivo = exigeClube && !!cfg && cfg.ranking_ativo;

  useEffect(function () {
    if (!aberto) return;
    const r: Record<string, number> = {};
    for (const j of JOGOS) r[j.id] = lerRecorde(j.id);
    setRecordes(r);
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return function () { document.body.style.overflow = antes; };
  }, [aberto]);

  function valendo(j: MotorJogo): boolean {
    return rankingAtivo && !!clubeToken && cfg!.jogos.includes(j.id);
  }

  async function jogar(j: MotorJogo) {
    if (semClube) { setTela('clube'); return; }
    setJogo(j);
    setFim(null);
    setTela('jogo');
    setSessao(null);
    setAvisoRanking(null);
    if (valendo(j)) {
      setPreparando(true);
      try {
        const s = await comecarPartida(props.tenantId!, j.id, clubeToken!, props.credencial!);
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

  // Entrar no clube aqui mesmo: CPF + 4 últimos do celular (mesma trava do clube, canal web)
  async function entrarNoClube() {
    const cpf = soCpf(formCpf);
    const fin = soDigitos(formFinal).slice(0, 4);
    if (cpf.length !== 11) { setErroClube('Digite o CPF completo.'); return; }
    if (fin.length !== 4) { setErroClube('Digite os 4 últimos números do seu celular.'); return; }
    setEntrando(true);
    setErroClube(null);
    const r = await clubeChamar<{ token?: string }>({ action: 'entrar', tenant_id: props.tenantId, cpf, celular_final: fin });
    setEntrando(false);
    if (r.error || !r.token) { setErroClube(r.message || 'Não foi possível entrar.'); return; }
    clubeSalvarToken(props.tenantId!, r.token);
    setClubeToken(r.token);
    setDireito(null);
    setFormCpf(''); setFormFinal('');
    setTela('menu');
  }

  function abrirRanking(id?: string) {
    const alvo = id || (jogo && cfg?.jogos.includes(jogo.id) ? jogo.id : cfg?.jogos[0]) || 'voa';
    setRankJogo(alvo);
    setTela('ranking');
    setFim(null);
    setRank(null);
    setCarregandoRank(true);
    rankingJogo(props.tenantId!, alvo, clubeToken)
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
  const titulo = tela === 'jogo' && jogo ? jogo.nome : tela === 'ranking' ? 'Ranking da semana' : tela === 'clube' || semClube ? 'Jogos do Clube' : 'Jogos';

  // Loja sem clube ligado: os jogos não aparecem. Enquanto carrega, também não (evita piscar).
  if (exigeClube && (!cfg || !cfg.clube_ativo)) return null;

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
      ) : semClube && !props.esconderCartao ? (
        <button
          type="button"
          onClick={function () { setTela('clube'); setAberto(true); }}
          className="w-full flex items-center gap-3 p-4 rounded-2xl text-left cursor-pointer bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-fuchsia-500/20 hover:brightness-105 transition"
        >
          <div className="w-12 h-12 flex items-center justify-center bg-white/20 rounded-xl shrink-0">
            <i className="ri-vip-crown-line text-white text-2xl" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm">Jogos do Clube</p>
            <p className="text-white/80 text-xs mt-0.5">Entre no clube para jogar enquanto espera{rankingAtivo ? ' e concorrer a prêmios' : ''}</p>
          </div>
          <i className="ri-arrow-right-circle-fill text-white text-3xl" />
        </button>
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
            ) : semClube || tela === 'clube' ? (
              <div className="h-full overflow-y-auto px-2 pt-2">
                <div className="max-w-md mx-auto bg-white rounded-3xl p-5">
                  <p className="text-lg font-black text-zinc-800">👑 Jogos do Clube</p>
                  <p className="text-sm text-zinc-500 mt-1">
                    Os jogos são para quem é do clube{rankingAtivo ? ' — e os 3 melhores da semana ganham prêmio' : ''}. Entre com seu CPF e os 4 últimos números do celular.
                  </p>
                  <label className="block text-xs font-bold text-zinc-600 mt-4 mb-1">CPF</label>
                  <input value={formCpf} onChange={function (e) { setFormCpf(mascaraCpf(e.target.value)); }} inputMode="numeric" className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm" placeholder="000.000.000-00" />
                  <label className="block text-xs font-bold text-zinc-600 mt-3 mb-1">4 últimos números do celular</label>
                  <input value={formFinal} onChange={function (e) { setFormFinal(soDigitos(e.target.value).slice(0, 4)); }} inputMode="numeric" className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm tracking-[0.3em]" placeholder="0000" />
                  {erroClube ? <p className="text-xs text-red-500 mt-2">{erroClube}</p> : null}
                  <button type="button" disabled={entrando} onClick={entrarNoClube} className="mt-4 w-full py-3 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-black text-sm cursor-pointer disabled:opacity-60">
                    {entrando ? 'Entrando...' : 'Entrar e jogar'}
                  </button>
                  {cfg?.slug ? (
                    <a href={'/clube/' + cfg.slug} target="_blank" rel="noreferrer" className="mt-3 block text-center text-sm font-bold text-violet-600">
                      Ainda não é do clube? Cadastre-se grátis ›
                    </a>
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
                      <button type="button" onClick={function () { abrirRanking(); }} className="mt-3 w-full py-2 rounded-xl bg-white text-orange-600 text-xs font-black cursor-pointer">Ver ranking</button>
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
