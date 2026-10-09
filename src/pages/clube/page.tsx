// App do clube — /clube/<loja> (pública, sem login no ERPOS). Instalável no celular
// com o nome, o ícone e a cor da LOJA (manifest por loja, ver index.html e clube-app).
//
// Fluxo: entrar (CPF + celular completo; CPF novo vira cadastro) → oferece a digital →
// pede as notificações (explicando antes) → app com 4 abas (Início, Prêmios, Avisos, Eu).
// Com "digital para abrir" ligada, o app trava ao voltar depois de 5 min fora — e o
// SERVIDOR também trava (clube-app responde 423), não só a tela.
// O tablet da loja abre esta página já logada por QR (?entrar=<link de uso único>);
// ?indicou=<código> guarda quem indicou até a pessoa entrar no clube.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clubeSalvarToken, clubeTokenSalvo, type ClubeDados } from '@/lib/clubePublico';
import {
  aoMudarInstalar, aplicarCaraDaLoja, appInstalado, assinarComDigital, ativarAvisos, clubeApp, desbloquearComDigital,
  digitalDisponivel, ehIOS, guardarIndicacao, indicacaoGuardada, inscricaoAtual, instalarApp, ligarDigital, nomeDoAparelho,
  podeInstalarComUmToque, pushSuportado, registrarSwDoClube, varsDaMarca,
  type AparelhoClube, type AvisoClube, type EstadoAparelho, type IndicacaoMinha, type RespostaClube, type RespostaLoja,
} from '@/lib/clubeApp';
import Acesso from './components/Acesso';
import { ComoFunciona, salvarContato } from './components/Extras';
import { FolhaAparelhos, FolhaIndicar, FolhaInstalar, FolhaSobre, FolhaUsar, TelaDigital, TelaNotificacoes, TelaTrava } from './components/Folhas';
import { Avisos, Eu, Extrato, Inicio, Premios, type PremioVisto } from './components/Telas';
import { Abas, Folha, Topo, type Aba } from './components/ui';

type Fase = 'carregando' | 'fora' | 'acesso' | 'trava' | 'digital' | 'notificacoes' | 'app';
const TRAVA_APOS_MS = 5 * 60_000;

// Lembranças por loja neste aparelho (nada sensível: nome para a tela de trava e
// "agora não" das ofertas de digital/notificação/instalar).
const lembrar = (chave: string, valor: string | null) => { try { if (valor == null) localStorage.removeItem(chave); else localStorage.setItem(chave, valor); } catch { /* sem storage */ } };
const lembrado = (chave: string) => { try { return localStorage.getItem(chave); } catch { return null; } };

function Carregando() {
  return <div className="min-h-dvh flex items-center justify-center bg-[#FBF7F2]"><div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-700 rounded-full animate-spin" /></div>;
}

export default function ClubePage() {
  const { storeSlug = '' } = useParams<{ storeSlug: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<RespostaLoja | null>(null);
  const [fase, setFase] = useState<Fase>('carregando');
  const [falha, setFalha] = useState('');
  const [aviso, setAviso] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [dados, setDados] = useState<ClubeDados | null>(null);
  const [estado, setEstado] = useState<EstadoAparelho | null>(null);
  const [aba, setAba] = useState<Aba>(() => (['inicio', 'premios', 'avisos', 'eu'].includes(params.get('aba') ?? '') ? params.get('aba') as Aba : 'inicio'));
  const [avisos, setAvisos] = useState<AvisoClube[] | null>(null);
  const [pushOk, setPushOk] = useState(false);
  const [temDigitalNoCel, setTemDigitalNoCel] = useState(false);
  const [umToque, setUmToque] = useState(podeInstalarComUmToque());
  // folhas
  const [instalarAberto, setInstalarAberto] = useState(false);
  const [usando, setUsando] = useState<PremioVisto | null>(null);
  const [indicacao, setIndicacao] = useState<IndicacaoMinha | null>(null);
  const [aparelhos, setAparelhos] = useState<AparelhoClube[] | null>(null);
  const [sobre, setSobre] = useState(false);
  const [comoFunciona, setComoFunciona] = useState(false);
  const [extratoAberto, setExtratoAberto] = useState(false);
  const [msg, setMsg] = useState('');
  const escondidoEm = useRef<number | null>(null);
  // Veio para instalar (link "Baixe o app" do delivery/mesa/tablet, ou QR do tablet):
  // o convite de instalar abre assim que o app carregar, mesmo se já tiver dito "agora não".
  const querInstalar = useRef(params.get('instalar') === '1' || !!params.get('entrar'));

  const loja = info?.loja ?? null;
  const tenantId = loja?.tenant_id ?? '';
  const chave = (k: string) => `clube_${k}:${storeSlug}`;

  useEffect(() => aoMudarInstalar(() => setUmToque(podeInstalarComUmToque())), []);
  useEffect(() => { void digitalDisponivel().then(setTemDigitalNoCel); }, []);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(''), 3500); return () => clearTimeout(t); } }, [msg]);

  const sairLocal = useCallback(() => {
    if (tenantId) clubeSalvarToken(tenantId, null);
    setToken(null); setDados(null); setEstado(null); setAvisos(null);
    setFase('acesso');
  }, [tenantId]);

  /** Estado do aparelho + dados. `novoLogin` = acabou de entrar (oferece digital e notificações). */
  const carregarConta = useCallback(async (tok: string, tid: string, novoLogin: boolean) => {
    const sub = await inscricaoAtual(storeSlug).catch(() => null);
    const e = await clubeApp<EstadoAparelho>({ action: 'estado', token: tok, endpoint: sub?.endpoint ?? null });
    if (e._status === 401) { clubeSalvarToken(tid, null); setToken(null); setFase('acesso'); return; }
    if (e.error) { setFalha(e.message || 'Não consegui abrir o clube agora.'); return; }
    setEstado(e);
    setPushOk(!!sub && e.push_inscrito);
    if (e.aparelho.bloqueado) { setFase('trava'); return; }
    const d = await clubeApp<ClubeDados>({ action: 'eu', token: tok });
    if (d._status === 423) { setFase('trava'); return; }
    if (d.error) { setFalha(d.message || 'Não consegui abrir o clube agora.'); return; }
    setDados(d);
    if (d.resumo?.primeiro_nome) lembrar(`clube_nome:${tid}`, d.resumo.primeiro_nome);
    if (novoLogin) {
      if (!e.aparelho.tem_digital && await digitalDisponivel() && lembrado(chave('nao_digital')) !== '1') { setFase('digital'); return; }
      if (!sub && pushSuportado() && Notification.permission !== 'denied' && lembrado(chave('nao_avisos')) !== '1') { setFase('notificacoes'); return; }
    }
    setFase('app');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug]);

  // ── Abrir: loja, QR do tablet, indicação, cartão salvo ──
  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await clubeApp<RespostaLoja>({ action: 'loja', slug: storeSlug });
      if (!vivo) return;
      if (r.error || !r.loja) { setFalha('Loja não encontrada.'); setFase('fora'); return; }
      setInfo(r);
      aplicarCaraDaLoja(r.loja, r.app.apple);
      if (!r.clube_ativo || !r.programa) { setFase('fora'); return; }
      if (r.app.ativo) void registrarSwDoClube(storeSlug);
      const tid = r.loja.tenant_id;
      const indicou = params.get('indicou');
      const linkQr = params.get('entrar');
      if (indicou || linkQr || params.get('instalar')) {
        const p = new URLSearchParams(params); p.delete('indicou'); p.delete('entrar'); p.delete('instalar'); setParams(p, { replace: true });
      }
      if (indicou) guardarIndicacao(storeSlug, indicou);
      if (linkQr) {
        const q = await clubeApp<{ token?: string }>({ action: 'entrar_link', token_link: linkQr, aparelho: nomeDoAparelho() });
        if (!vivo) return;
        if (q.token) { clubeSalvarToken(tid, q.token); setToken(q.token); await carregarConta(q.token, tid, true); return; }
        setAviso(q.message || 'Este QR já foi usado. Entre com seu CPF e celular.');
      }
      const salvo = clubeTokenSalvo(tid);
      if (salvo) { setToken(salvo); await carregarConta(salvo, tid, false); return; }
      setFase('acesso');
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug]);

  // ── Trava ao voltar depois de alguns minutos fora (só com "digital para abrir") ──
  useEffect(() => {
    const mudou = () => {
      if (document.visibilityState === 'hidden') { escondidoEm.current = Date.now(); return; }
      const fora = escondidoEm.current ? Date.now() - escondidoEm.current : 0;
      escondidoEm.current = null;
      if (fora > TRAVA_APOS_MS && estado?.aparelho.digital_abrir && fase === 'app') setFase('trava');
    };
    document.addEventListener('visibilitychange', mudou);
    return () => document.removeEventListener('visibilitychange', mudou);
  }, [estado, fase]);

  // ── Convite para instalar (uma vez por semana, só fora do app instalado) ──
  useEffect(() => {
    if (fase !== 'app' || !info?.app.ativo || appInstalado()) return;
    const ultimo = Number(lembrado(chave('convite')) || 0);
    if (!querInstalar.current && Date.now() - ultimo < 7 * 86_400_000) return;
    const forcado = querInstalar.current;
    querInstalar.current = false;
    const t = setTimeout(() => setInstalarAberto(true), forcado ? 400 : 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase, info]);

  // ── Avisos: carrega ao abrir a aba (e marca como lidos) ──
  useEffect(() => {
    if (fase !== 'app' || aba !== 'avisos' || !token) return;
    let vivo = true;
    void clubeApp<{ avisos?: AvisoClube[] }>({ action: 'avisos', token, lidos: true }).then((r) => {
      if (!vivo) return;
      if (r._status === 423) { setFase('trava'); return; }
      setAvisos(r.avisos ?? []);
      setEstado((e) => (e ? { ...e, avisos_novos: 0 } : e));
    });
    return () => { vivo = false; };
  }, [fase, aba, token]);

  // Notificação de "aparelho novo" abre direto a lista de aparelhos.
  useEffect(() => {
    if (fase === 'app' && params.get('aparelhos') === '1') {
      const p = new URLSearchParams(params); p.delete('aparelhos'); p.delete('aba'); setParams(p, { replace: true });
      setAba('eu');
      void abrirAparelhos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase]);

  const recarregar = useCallback(async () => {
    if (!token) return;
    const d = await clubeApp<ClubeDados>({ action: 'eu', token });
    if (d._status === 423) { setFase('trava'); return; }
    if (!d.error) setDados(d);
  }, [token]);

  if (fase === 'carregando') return <Carregando />;
  if (fase === 'fora' || !info || !loja || !info.programa) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#FBF7F2] p-6">
        <p className="text-center text-zinc-500 bg-white rounded-2xl border border-zinc-200 p-6 max-w-sm">{falha || 'O clube desta loja ainda não está funcionando.'}</p>
      </div>
    );
  }
  const programa = info.programa;
  const vars = varsDaMarca(loja) as CSSProperties;
  const contatoLoja = programa.contato?.whatsapp ?? null;
  const estiloGlobal = <style>{'@keyframes sobe{from{transform:translateY(30%);opacity:.5}to{transform:none;opacity:1}}'}</style>;

  const entrou = async (tok: string) => {
    clubeSalvarToken(tenantId, tok);
    guardarIndicacao(storeSlug, null);
    setToken(tok);
    setAviso('');
    await carregarConta(tok, tenantId, true);
  };

  if (falha && fase !== 'acesso') {
    return <div style={vars} className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-[#FBF7F2] p-6 text-center"><p className="text-zinc-600">{falha}</p><button className="underline text-sm" onClick={() => window.location.reload()}>Tentar de novo</button></div>;
  }

  if (fase === 'acesso' || !token) {
    return (
      <div style={vars}>{estiloGlobal}
        <Acesso slug={storeSlug} lojaNome={loja.nome} logo={loja.logo} programaNome={programa.nome}
          contatoLoja={contatoLoja} indicacao={indicacaoGuardada(storeSlug)} aviso={aviso} onEntrou={(t) => { void entrou(t); }} />
      </div>
    );
  }

  if (fase === 'trava') {
    return (
      <div style={vars}>
        <TelaTrava loja={loja} programaNome={programa.nome} nome={lembrado(`clube_nome:${tenantId}`)}
          onDesbloquear={async () => {
            const r = await desbloquearComDigital(token);
            if (!r.ok) return r.erro ?? 'Não deu para confirmar.';
            await carregarConta(token, tenantId, false);
            return null;
          }}
          onOutroJeito={() => { void clubeApp({ action: 'sair', token }); sairLocal(); }} />
      </div>
    );
  }

  const proximoDepoisDaDigital = () => {
    if (pushSuportado() && Notification.permission !== 'denied' && !pushOk && lembrado(chave('nao_avisos')) !== '1') setFase('notificacoes');
    else setFase('app');
  };

  if (fase === 'digital') {
    return (
      <div style={vars}>
        <TelaDigital loja={loja}
          onLigar={async () => {
            const r = await ligarDigital(token);
            if (!r.ok) return r.erro ?? 'Não deu para ligar a digital.';
            const e = await clubeApp<EstadoAparelho>({ action: 'estado', token });
            if (!e.error) setEstado(e);
            proximoDepoisDaDigital();
            return null;
          }}
          onPular={() => { lembrar(chave('nao_digital'), '1'); proximoDepoisDaDigital(); }} />
      </div>
    );
  }

  const ligarNotificacoes = async (p: { pontos: boolean; promocoes: boolean }) => {
    const r = await ativarAvisos(storeSlug, token, p);
    if (!r.ok) return r.erro ?? 'Não deu para ligar as notificações.';
    setPushOk(true);
    setEstado((e) => (e ? { ...e, push_inscrito: true, prefs: { avisos_pontos: p.pontos, avisos_promocoes: p.promocoes } } : e));
    return null;
  };

  if (fase === 'notificacoes') {
    return (
      <div style={vars}>
        <TelaNotificacoes loja={loja}
          onAtivar={async (p) => { const e = await ligarNotificacoes(p); if (!e) setFase('app'); return e; }}
          onPular={() => { lembrar(chave('nao_avisos'), '1'); setFase('app'); }} />
      </div>
    );
  }

  if (!dados) return <Carregando />;

  // ── Ações do app ──
  /** Mudar trava e desconectar aparelho: com digital no aparelho, assina na hora e manda junto. */
  const comDigitalNaHora = async <T,>(corpo: Record<string, unknown>) => {
    let resposta: unknown;
    if (estado?.aparelho.tem_digital) {
      const a = await assinarComDigital(token, 'abrir');
      if (!a.resposta) return { error: 'digital', message: a.erro ?? 'Cancelado.' } as RespostaClube<T>;
      resposta = a.resposta;
    }
    return clubeApp<T>({ ...corpo, token, resposta });
  };

  async function abrirAparelhos() {
    if (!token) return;
    const r = await clubeApp<{ aparelhos?: AparelhoClube[] }>({ action: 'aparelhos', token });
    if (r._status === 423) { setFase('trava'); return; }
    setAparelhos(r.aparelhos ?? []);
  }

  const usarNoDelivery = async (p: PremioVisto): Promise<string | null> => {
    let resposta: unknown;
    if (estado?.aparelho.digital_premio) {
      const a = await assinarComDigital(token, 'premio');
      if (!a.resposta) return a.erro ?? 'Cancelado.';
      resposta = a.resposta;
    }
    const r = await clubeApp<{ reserva?: unknown }>({ action: 'reservar', token, ...p.alvo, resposta });
    if (r.error || !r.reserva) return r.message || 'Não deu para reservar agora.';
    // O checkout do delivery pega esta reserva (mesmo cartão do clube) — ver ClubeCheckout.
    lembrar(`clube_reservas_app:${tenantId}`, JSON.stringify({ token, reservas: [r.reserva], em: Date.now() }));
    window.location.href = `/${loja.slug}-delivery`;
    return null;
  };

  const abrirIndicacao = async () => {
    const r = await clubeApp<IndicacaoMinha>({ action: 'indicacao', token });
    if (r._status === 423) { setFase('trava'); return; }
    if (r.error || !r.ativo) { setMsg(r.message || 'Indicação indisponível agora.'); return; }
    setIndicacao(r);
  };

  const titulos: Record<Aba, [string, string | undefined]> = {
    inicio: [loja.nome, programa.nome], premios: ['Prêmios', `Você tem ${Math.floor(dados.resumo.saldo).toLocaleString('pt-BR')} pontos`],
    avisos: ['Avisos', undefined], eu: ['Eu', undefined],
  };
  const temDelivery = !!programa.pontos?.canais?.delivery;
  const abrirInstalar = info.app.ativo && !appInstalado() ? () => setInstalarAberto(true) : null;

  return (
    <div style={vars} className="min-h-dvh bg-[#FBF7F2] text-zinc-900">
      {estiloGlobal}
      <div className="max-w-md mx-auto pb-[110px]">
        <Topo titulo={titulos[aba][0]} sub={titulos[aba][1]} logo={loja.logo} nome={loja.nome}
          avisos={aba === 'avisos' ? 0 : estado?.avisos_novos ?? 0} onAvisos={aba === 'avisos' ? undefined : () => setAba('avisos')} />

        {aba === 'inicio' && (
          <Inicio dados={dados} loja={loja} programa={programa} token={token} indicacao={info.indicacao}
            onVerPremios={() => setAba('premios')} onUsar={setUsando} onRecarregar={() => { void recarregar(); }}
            onBloqueado={() => setFase('trava')} onIndicar={() => { void abrirIndicacao(); }} onExtrato={() => setExtratoAberto(true)}
            extra={temDelivery ? (
              <div className="px-4 mt-4"><button onClick={() => navigate(`/${loja.slug}-delivery`)} className="w-full h-12 rounded-2xl bg-zinc-900 text-white font-bold text-[14.5px] flex items-center justify-center gap-2 cursor-pointer"><i className="ri-e-bike-2-line" />Pedir no delivery e ganhar pontos</button></div>
            ) : undefined} />
        )}
        {aba === 'premios' && <Premios dados={dados} programa={programa} onUsar={setUsando} />}
        {aba === 'avisos' && (
          <Avisos avisos={avisos} podeAtivar={pushSuportado() && !pushOk}
            onAtivar={() => setFase('notificacoes')}
            onAbrir={(a) => { if (a.url?.startsWith(`/clube/${loja.slug}`)) { const u = new URL(a.url, window.location.origin); const ab = u.searchParams.get('aba') as Aba | null; if (ab) setAba(ab); if (u.searchParams.get('aparelhos') === '1') void abrirAparelhos(); } }} />
        )}
        {aba === 'eu' && (
          <Eu dados={dados} estado={estado} instalado={appInstalado()} pushOk={pushOk}
            onInstalar={abrirInstalar}
            onDigital={temDigitalNoCel ? async () => { const r = await ligarDigital(token); if (!r.ok) { setMsg(r.erro ?? 'Não deu.'); return; } const e = await clubeApp<EstadoAparelho>({ action: 'estado', token }); if (!e.error) setEstado(e); setMsg('Digital ligada ✓'); } : null}
            onSeguranca={async (campo, valor) => {
              const r = await comDigitalNaHora({ action: 'seguranca', [campo]: valor });
              if (r.error) { setMsg(r.message || 'Não deu para mudar.'); return; }
              setEstado((e) => (e ? { ...e, aparelho: { ...e.aparelho, [campo]: valor } } : e));
            }}
            onAparelhos={() => { void abrirAparelhos(); }}
            onPrefs={async (campo, valor) => {
              const r = await clubeApp<{ prefs?: EstadoAparelho['prefs'] }>({ action: 'prefs', token, [campo]: valor });
              if (r.prefs) setEstado((e) => (e ? { ...e, prefs: r.prefs! } : e));
            }}
            onAtivarAvisos={pushSuportado() || ehIOS() ? () => setFase('notificacoes') : null}
            onComoFunciona={() => setComoFunciona(true)} onSobre={() => setSobre(true)}
            onSair={async () => {
              const sub = await inscricaoAtual(storeSlug).catch(() => null);
              if (sub) { try { await sub.unsubscribe(); } catch { /* segue */ } }
              await clubeApp({ action: 'sair', token });
              lembrar(`clube_nome:${tenantId}`, null);
              sairLocal();
            }}
            contato={contatoLoja} onSalvarContato={programa.contato ? () => salvarContato(programa.contato!, programa.nome) : null} />
        )}
      </div>

      <Abas aba={aba} onAba={setAba} avisos={estado?.avisos_novos ?? 0} />

      {msg && <div role="status" className="fixed top-4 inset-x-4 z-[60] max-w-md mx-auto rounded-2xl bg-zinc-900/95 text-white text-sm font-semibold px-4 py-3 text-center">{msg}</div>}

      <FolhaInstalar aberta={instalarAberto} loja={loja} umToque={umToque}
        onInstalar={async () => { const ok = await instalarApp(); setInstalarAberto(false); if (ok) setMsg('Pronto! O app está na sua tela de início.'); }}
        onFechar={() => setInstalarAberto(false)}
        onNaoAgora={() => { lembrar(chave('convite'), String(Date.now())); setInstalarAberto(false); }} />
      <FolhaUsar premio={usando} temDelivery={temDelivery} onDelivery={usarNoDelivery} onFechar={() => setUsando(null)} />
      <FolhaIndicar dados={indicacao} lojaNome={loja.nome} programaNome={programa.nome}
        link={indicacao ? `${window.location.origin}/clube/${loja.slug}?indicou=${indicacao.codigo}` : ''} onFechar={() => setIndicacao(null)} />
      <FolhaAparelhos aparelhos={aparelhos} onFechar={() => setAparelhos(null)}
        onSair={async (id) => {
          const r = await comDigitalNaHora({ action: 'aparelho_sair', session_id: id });
          if (r.error) { setMsg(r.message || 'Não deu para desconectar.'); return; }
          setAparelhos((l) => (l ?? []).filter((a) => a.id !== id));
        }}
        onSairTodos={async () => {
          const r = await comDigitalNaHora({ action: 'aparelho_sair', todos_outros: true });
          if (r.error) { setMsg(r.message || 'Não deu para desconectar.'); return; }
          setAparelhos((l) => (l ?? []).filter((a) => a.atual));
        }} />
      <FolhaSobre aberta={sobre} loja={loja} programaNome={programa.nome} onFechar={() => setSobre(false)} />
      <Folha aberta={comoFunciona} onFechar={() => setComoFunciona(false)} titulo="Como funciona o clube"><ComoFunciona p={programa} /></Folha>
      <Folha aberta={extratoAberto} onFechar={() => setExtratoAberto(false)} titulo="Seu extrato"><div className="-mx-4"><Extrato linhas={dados.extrato} /></div></Folha>
    </div>
  );
}
