import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { getPublicUrl } from '@/lib/appUrl';
import { useDeliveryState } from '@/hooks/useDeliveryState';
import { podeSair, registrarGuardaSaida } from '@/lib/guardaSaida';
import { CONFIG_VAZIA, chamarDelivery, contarMudancas, faixasOrdenadas, lerConfig, mudancasParaSalvar, type ConfigDelivery } from './config';
import { DeliveryTelaContext, type AbaDelivery, type DeliveryTelaApi, type Motoboy } from './DeliveryTela';
import { btn } from './ui';
import InicioAba from './abas/InicioAba';
import AreaTaxaAba from './abas/AreaTaxaAba';
import HorarioAba from './abas/HorarioAba';
import PagamentoAba from './abas/PagamentoAba';
import RegrasAba from './abas/RegrasAba';
import EquipeAba from './abas/EquipeAba';
import AcertoAba from './abas/AcertoAba';
import AvisosAba from './abas/AvisosAba';
import LinksAba from './abas/LinksAba';
import ConversasAba from './abas/ConversasAba';
import AssistenteAba from './abas/AssistenteAba';
import MensagensAba from './abas/MensagensAba';
import { useAtualizacao } from './abas/inicio/usarAtualizacao';

// Tela Delivery (menu Gestão › Delivery). Layout novo aprovado pelo dono em 2026-10-05
// (docs/prototipos/delivery-proposta.html): 5 grupos — Início · Pedido · Entregadores · Divulgar · WhatsApp —
// com as abas de cada grupo em pílula, como o Estoque e o Financeiro. Nenhum bloco antigo saiu: o que era
// "Configurações" (14 blocos numa coluna) foi distribuído pelos grupos, "Gerir entregas" virou "Entregas agora"
// no Início e "Atendimento WhatsApp" virou o grupo WhatsApp. O carrinho abandonado foi para
// Clientes & Marketing › Funil › Visitas sem pedido (decisão do dono).

const ABAS: Record<AbaDelivery, { label: string; Comp: ComponentType }> = {
  inicio: { label: 'Início', Comp: InicioAba },
  area: { label: 'Área e taxa', Comp: AreaTaxaAba },
  horario: { label: 'Horário', Comp: HorarioAba },
  pagamento: { label: 'Pagamento', Comp: PagamentoAba },
  regras: { label: 'Mínimo e retirada', Comp: RegrasAba },
  equipe: { label: 'Equipe', Comp: EquipeAba },
  acerto: { label: 'Quanto ganham', Comp: AcertoAba },
  avisos: { label: 'Avisos', Comp: AvisosAba },
  links: { label: 'Links e QR', Comp: LinksAba },
  conversas: { label: 'Conversas', Comp: ConversasAba },
  assistente: { label: 'Assistente', Comp: AssistenteAba },
  mensagens: { label: 'Mensagens prontas', Comp: MensagensAba },
};

interface Grupo { id: string; label: string; icon: string; abas: AbaDelivery[] }
const GRUPOS: Grupo[] = [
  { id: 'inicio', label: 'Início', icon: 'ri-home-5-line', abas: ['inicio'] },
  { id: 'pedido', label: 'Pedido', icon: 'ri-map-pin-range-line', abas: ['area', 'horario', 'pagamento', 'regras'] },
  { id: 'entregadores', label: 'Entregadores', icon: 'ri-e-bike-2-line', abas: ['equipe', 'acerto', 'avisos'] },
  { id: 'divulgar', label: 'Divulgar', icon: 'ri-megaphone-line', abas: ['links'] },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'ri-whatsapp-line', abas: ['conversas', 'assistente', 'mensagens'] },
];
const TODAS = Object.keys(ABAS) as AbaDelivery[];

type Selo = { n?: number; cor: 'red' | 'amber'; dica: string } | null;

export default function ConfigDeliveryPage() {
  const { user } = useAuth();
  const toast = useToast();
  // O `toast` muda de identidade a cada aviso; nas dependências de useCallback/useEffect ele reiniciaria a leitura (laço).
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const navigate = useNavigate();
  const tenantId = user?.tenantId ?? '';
  const ehDono = user?.perfil === 'admin';

  const [params, setParams] = useSearchParams();
  const pedida = params.get('aba') as AbaDelivery | null;

  // ── configuração ──
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [salvo, setSalvo] = useState<ConfigDelivery>(CONFIG_VAZIA);
  const [cfg, setCfg] = useState<ConfigDelivery>(CONFIG_VAZIA);
  const [slug, setSlug] = useState('');
  const [nomeLoja, setNomeLoja] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [salvouAgora, setSalvouAgora] = useState(false);

  /** Lê a configuração gravada (e o nome/slug da loja) no servidor. */
  const lerDoServidor = useCallback(async () => {
    const d = await chamarDelivery<{ city: string; delivery_config: unknown; slug: string | null; tenant_name: string | null }>(
      'get_delivery_settings', { tenant_id: tenantId });
    return { config: lerConfig(d.delivery_config, d.city), slug: d.slug ?? '', nome: d.tenant_name ?? '' };
  }, [tenantId]);

  const carregar = useCallback(async () => {
    if (!tenantId) { setCarregando(false); return; } // sem loja escolhida não há o que ler: não fica "Carregando…" para sempre
    try {
      const r = await lerDoServidor();
      setSalvo(r.config); setCfg(r.config);
      setSlug(r.slug); setNomeLoja(r.nome);
      setErroCarga('');
    } catch (e) {
      setErroCarga(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [tenantId, lerDoServidor]);
  useEffect(() => { setCarregando(true); void carregar(); }, [carregar]);

  const mudar = useCallback<DeliveryTelaApi['mudar']>((patch) => {
    setCfg((c) => ({ ...c, ...(typeof patch === 'function' ? patch(c) : patch) }));
  }, []);
  const mudancas = useMemo(() => contarMudancas(salvo, cfg), [salvo, cfg]);

  const salvar = async () => {
    if (salvando) return;
    const enviado = cfg; // o que a pessoa vê agora; se ela digitar durante o salvamento, `cfg` passa a ser outro objeto
    const corpo = mudancasParaSalvar(salvo, enviado);
    setSalvando(true);
    try {
      // Só o que mudou: o servidor junta com o que já existe.
      await chamarDelivery('save_delivery_settings', { tenant_id: tenantId, ...corpo });
    } catch (e) {
      toast.error('Não salvou', e instanceof Error ? e.message : String(e));
      setSalvando(false);
      return;
    }
    // Gravou. Reler é só para conferir: se falhar, o save continua valendo (não troca a tela pelo painel de erro).
    try {
      const r = await lerDoServidor();
      setSalvo(r.config); setSlug(r.slug); setNomeLoja(r.nome);
      setCfg((atual) => (atual === enviado ? r.config : atual)); // digitou no meio do salvamento? mantém o que digitou
    } catch {
      setSalvo(enviado);
      toast.warning('Salvou, mas não consegui reler', 'O que você mudou já vale para o cliente. Se algo parecer diferente, atualize a página.');
    }
    setSalvando(false);
    setSalvouAgora(true);
    setTimeout(() => setSalvouAgora(false), 1800);
  };
  const desfazer = () => setCfg(salvo);

  // ── mudanças não salvas FORA da barra da página (rascunho próprio de uma aba, ex.: Assistente) ──
  const [extras, setExtras] = useState<Record<string, number>>({});
  const marcarPendenciaExtra = useCallback((chave: string, n: number) => {
    setExtras((e) => {
      if ((e[chave] ?? 0) === Math.max(0, n)) return e;
      const prox = { ...e };
      if (n > 0) prox[chave] = n; else delete prox[chave];
      return prox;
    });
  }, []);
  useEffect(() => { setExtras((e) => (Object.keys(e).length ? {} : e)); }, [tenantId]); // outra loja: nada da anterior
  const pendenciasExtras = Object.values(extras).reduce((soma, n) => soma + n, 0);
  const pendentes = mudancas + pendenciasExtras;
  const fraseSaida = useMemo(() => {
    const partes: string[] = [];
    if (mudancas > 0) partes.push(`${mudancas} ${mudancas === 1 ? 'mudança ainda não foi salva' : 'mudanças ainda não foram salvas'} no Delivery.`);
    for (const chave of Object.keys(extras)) {
      partes.push(chave === 'assistente' ? 'O assistente do WhatsApp tem mudanças não salvas.' : 'Há mudanças não salvas em outra parte do Delivery.');
    }
    return partes.join(' ');
  }, [mudancas, extras]);

  // Sair da tela com mudança não salva (inclusive a do Assistente): o navegador pergunta ao fechar/recarregar, os
  // links do app perguntam aqui e os botões do layout (loja, Perfil, Sair, Voltar) perguntam por `podeSair()`.
  const temPendencia = pendentes > 0;
  useEffect(() => {
    if (!temPendencia) return;
    return registrarGuardaSaida(() => ({ pendente: pendentes, mensagem: fraseSaida }));
  }, [temPendencia, pendentes, fraseSaida]);
  useEffect(() => {
    if (!temPendencia) return;
    const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const clique = (e: MouseEvent) => {
      // Ctrl/Cmd/Shift/Alt e botão do meio abrem em outra aba ou janela: esta tela não sai do lugar.
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault(); e.stopPropagation();
      void podeSair().then((ok) => { if (ok) navigate(url.pathname + url.search + url.hash); });
    };
    window.addEventListener('beforeunload', antes);
    document.addEventListener('click', clique, true);
    return () => { window.removeEventListener('beforeunload', antes); document.removeEventListener('click', clique, true); };
  }, [temPendencia, navigate]);

  // ── entregadores (Início, Equipe, Quanto ganham) ──
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]);
  const [motoboysCarregando, setMotoboysCarregando] = useState(false);
  const recarregarMotoboys = useCallback(async () => {
    if (!tenantId) return;
    setMotoboysCarregando(true);
    try {
      const d = await chamarDelivery<{ drivers: Motoboy[] }>('list_drivers', { tenant_id: tenantId });
      setMotoboys((d.drivers ?? []).map((m) => ({ ...m, entregas_30d: Number(m.entregas_30d) || 0 })));
    } catch (e) {
      toastRef.current.error('Não carregou os entregadores', e instanceof Error ? e.message : String(e));
    } finally {
      setMotoboysCarregando(false);
    }
  }, [tenantId]);
  useEffect(() => { void recarregarMotoboys(); }, [recarregarMotoboys]);

  // ── conversas que pedem a equipe (selo do WhatsApp; o banco só deixa o dono ler) ──
  // Só consulta com a aba do navegador à vista (e atualiza ao voltar). Se a leitura falhar, fica o último número.
  const [pedemVoce, setPedemVoce] = useState(0);
  const tenantAtual = useRef(tenantId);
  tenantAtual.current = tenantId;
  useEffect(() => { setPedemVoce(0); }, [tenantId]);
  const lerSelo = useCallback(async () => {
    if (!tenantId || !ehDono) return;
    const t = tenantId;
    try {
      const { count, error } = await supabase.from('wa_loja_conversas').select('id', { count: 'exact', head: true })
        .eq('tenant_id', t).eq('status', 'aberta').eq('needs_human', true);
      if (error || count == null || tenantAtual.current !== t) return;
      setPedemVoce(count);
    } catch { /* sem rede: fica o último número */ }
  }, [tenantId, ehDono]);
  useAtualizacao(lerSelo, 60_000, `${tenantId}|${ehDono}`);

  const estado = useDeliveryState();

  // ── abas e grupos ──
  const grupos = useMemo(() => GRUPOS.map((g) => (g.id === 'whatsapp' && !ehDono ? { ...g, abas: ['mensagens' as AbaDelivery] } : g)), [ehDono]);
  const visiveis = grupos.flatMap((g) => g.abas);
  const aba: AbaDelivery = pedida && TODAS.includes(pedida) && visiveis.includes(pedida) ? pedida : 'inicio';
  const irPara = useCallback((a: AbaDelivery) => { setParams({ aba: a }, { replace: true }); }, [setParams]);
  const grupoAtivo = grupos.find((g) => g.abas.includes(aba)) ?? grupos[0];
  const [ultimaDoGrupo, setUltimaDoGrupo] = useState<Record<string, AbaDelivery>>({});
  useEffect(() => { setUltimaDoGrupo((u) => (u[grupoAtivo.id] === aba ? u : { ...u, [grupoAtivo.id]: aba })); }, [grupoAtivo.id, aba]);

  const semArea = salvo.lojaLat == null || faixasOrdenadas(salvo.faixas).length === 0;
  const seloAba = (a: AbaDelivery): Selo => {
    if (carregando) return null; // enquanto carrega, `salvo` é a config vazia: não acender "sem área" à toa
    if (a === 'area' && semArea) return { cor: 'red', dica: 'Sem pino da loja ou sem faixa: o cliente não consegue pedir entrega' };
    if (a === 'acerto' && motoboys.length > 0 && !salvo.acerto.ativo) return { cor: 'amber', dica: 'Entregadores sem regra de pagamento' };
    if (a === 'conversas' && pedemVoce > 0) return { n: pedemVoce, cor: 'red', dica: `${pedemVoce} conversa(s) pedindo a equipe` };
    return null;
  };
  const seloGrupo = (g: Grupo): Selo => {
    const s = g.abas.map(seloAba).filter(Boolean) as NonNullable<Selo>[];
    return s.find((x) => x.n) ?? s.find((x) => x.cor === 'red') ?? s[0] ?? null;
  };

  const situacao = !estado.state ? null
    : estado.state.open_now ? { txt: 'Aberto', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-600' }
    : estado.state.reason === 'pausado' ? { txt: 'Pausado', cls: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' }
    : { txt: 'Fechado', cls: 'bg-zinc-100 text-zinc-600', dot: 'bg-zinc-400' };

  const linkDelivery = slug ? getPublicUrl('/' + slug + '-delivery') : getPublicUrl('/delivery');
  const [linkCopiado, setLinkCopiado] = useState(false);

  const api: DeliveryTelaApi = {
    tenantId, slug, nomeLoja, linkDelivery, cfg, salvo, mudar, irPara, ehDono,
    motoboys, motoboysCarregando, recarregarMotoboys, estado,
    marcarPendenciaExtra, barraSalvarAberta: mudancas > 0 || salvouAgora,
  };
  const Comp = ABAS[aba].Comp;

  return (
    <DeliveryTelaContext.Provider value={api}>
      <div className="flex flex-col h-full">
        {/* Cabeçalho */}
        <div className="px-4 md:px-6 pt-3 md:pt-5 pb-0 bg-white" style={{ borderBottom: '1px solid #f4f4f5' }}>
          <div className="flex items-center gap-2 md:gap-3 mb-2 md:mb-4">
            <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
              <i className="ri-truck-line text-white text-base md:text-lg" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base md:text-lg font-bold text-zinc-800">Delivery próprio</h1>
              <p className="text-xs text-zinc-400 hidden sm:block">Seu delivery próprio: área, entregadores, divulgação e WhatsApp</p>
            </div>
            {situacao && (
              <button type="button" onClick={() => irPara('inicio')} title="Situação do delivery agora"
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[12.5px] font-extrabold cursor-pointer flex-shrink-0 ${situacao.cls}`}>
                <span className={`w-2 h-2 rounded-full ${situacao.dot}`} />{situacao.txt}
              </button>
            )}
            <button type="button" title="Copiar o link do delivery" aria-label="Copiar o link do delivery"
              onClick={() => navigator.clipboard.writeText(linkDelivery).then(() => { setLinkCopiado(true); setTimeout(() => setLinkCopiado(false), 1500); }).catch(() => {})}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500 cursor-pointer flex-shrink-0">
              <i className={`${linkCopiado ? 'ri-check-line text-emerald-600' : 'ri-link'} text-lg`} />
            </button>
          </div>

          {/* Grupos: no celular dividem a largura (ícone em cima, nome embaixo) */}
          <div className="flex md:gap-0.5 -mx-4 md:mx-0 px-1 md:px-0" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
            {grupos.map((g) => {
              const selo = seloGrupo(g);
              const ativo = grupoAtivo.id === g.id;
              return (
                <button key={g.id} type="button" onClick={() => irPara(ultimaDoGrupo[g.id] ?? g.abas[0])}
                  className={`relative flex flex-1 md:flex-none flex-col md:flex-row items-center gap-0.5 md:gap-1.5 min-w-0 px-1 md:px-4 pt-2 pb-1.5 md:py-2.5 text-[10.5px] md:text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                    ativo ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}>
                  <i className={`${g.icon} text-lg leading-none md:text-[13px] md:leading-normal`} />
                  {g.label}
                  {selo && (selo.n
                    ? <span title={selo.dica} className={`absolute top-0.5 left-1/2 ml-2 md:static md:ml-0 text-[9px] font-black px-1.5 py-0.5 rounded-full text-white leading-none md:leading-normal ${selo.cor === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}>{selo.n}</span>
                    : <span title={selo.dica} className={`absolute top-1.5 left-1/2 ml-2.5 md:static md:ml-0 w-2 h-2 rounded-full ${selo.cor === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} />)}
                </button>
              );
            })}
          </div>
          {grupoAtivo.abas.length > 1 ? (
            <div className="py-2 md:py-2.5 -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto scrollbar-hide">
              <div className="flex bg-zinc-100 p-1 rounded-xl w-max">
                {grupoAtivo.abas.map((a) => {
                  const selo = seloAba(a);
                  return (
                    <button key={a} type="button" onClick={() => irPara(a)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
                        aba === a ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
                      {ABAS[a].label}
                      {selo && (selo.n
                        ? <span title={selo.dica} className={`text-[9px] font-black px-1.5 py-0.5 rounded-full text-white ${selo.cor === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}>{selo.n}</span>
                        : <span title={selo.dica} className={`w-1.5 h-1.5 rounded-full ${selo.cor === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} />)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : <div className="h-2" />}
        </div>

        {/* Conteúdo + barra de salvar */}
        <div className="relative flex-1 min-h-0" style={{ background: '#FAF7F2' }}>
          <div className="absolute inset-0 overflow-y-auto">
            {!tenantId ? (
              <div className="p-6 max-w-lg mx-auto">
                <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-sm text-zinc-600">Escolha uma loja para ver o Delivery.</div>
              </div>
            ) : carregando ? (
              <div className="flex items-center justify-center py-16 text-sm text-zinc-500 gap-2"><i className="ri-loader-4-line animate-spin" />Carregando…</div>
            ) : erroCarga ? (
              <div className="p-6 max-w-lg mx-auto">
                <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700">
                  Não consegui abrir a configuração do delivery: {erroCarga}
                  <div className="mt-2"><button type="button" className={btn('out', 'sm')} onClick={() => { setCarregando(true); void carregar(); }}>Tentar de novo</button></div>
                </div>
              </div>
            ) : <Comp />}
          </div>

          {(mudancas > 0 || salvouAgora) && (
            <div className="absolute left-3 right-3 bottom-3 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[560px] z-30">
              <div className={`flex items-center gap-2 rounded-2xl pl-4 pr-2 py-2 shadow-xl text-white ${salvouAgora && !mudancas ? 'bg-emerald-700' : 'bg-zinc-900'}`}>
                {salvouAgora && !mudancas ? (
                  <p className="flex-1 text-[13px] font-bold py-2"><i className="ri-check-line mr-1" />Salvo. Já vale para o cliente.</p>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold leading-tight">{mudancas} {mudancas === 1 ? 'mudança ainda não salva' : 'mudanças ainda não salvas'}</p>
                      <p className="text-[11px] text-zinc-400 leading-tight hidden sm:block">Se sair da tela sem salvar, o app pergunta antes</p>
                    </div>
                    <button type="button" onClick={desfazer} disabled={salvando} className="h-9 px-3 rounded-xl text-[12.5px] font-bold text-amber-300 hover:bg-white/10 cursor-pointer disabled:opacity-50">Desfazer</button>
                    <button type="button" onClick={salvar} disabled={salvando} className={btn('p', 'sm')}>
                      {salvando ? <><i className="ri-loader-4-line animate-spin" />Salvando…</> : 'Salvar'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </DeliveryTelaContext.Provider>
  );
}
