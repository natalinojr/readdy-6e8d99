// Funil de CRM do delivery (aba "Funil" de Clientes & Marketing).
//
// Mostra em que estágio cada cliente está, quem pode ser abordado agora e com
// qual oferta. O envio é sempre um clique humano: "Chamar" abre o WhatsApp com
// a mensagem da regra; "Voucher" abre o modal de voucher já preenchido com a
// oferta do estágio. Depois do envio, registra em crm_sends (para o cooldown,
// o teto de frequência e a medição de retorno).
//
// Sub-abas: Quem chamar (quem está onde + cartão Aniversariantes) · Ofertas (acordeão: uma linha
// por estágio, a primeira é o voucher de aniversário) · Critérios (quem entra em cada estágio +
// travas). Nada dispara sozinho, a não ser o envio automático que o dono liga estágio a estágio.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ClienteCRM } from '@/hooks/useClientes';
import type { Voucher } from '@/types/vouchers';
import NaoPediramPanel from '../components/NaoPediramPanel';
import PainelEnvioAutomatico, { MODELO_COM_CUPOM, MODELO_SEM_CUPOM } from '../components/EnvioAutomatico';
import AniversarioOferta, { CabecalhoOferta, type SeloLinha } from '../components/AniversarioOferta';
import AniversariantesLista from '../components/AniversariantesLista';
import { confirmar } from '@/components/base/Dialogos';
import { AVISO_OPT_OUT, abrirWhatsApp, baixarCsv, celularComDDI, montarCsv } from '../clienteUtils';
import { MODELO_PADRAO_MENSAGEM, montarMensagem } from '../funilMensagem';
import { voucherVale, type Aniversariante } from '../aniversarioMensagem';

export type CrmStage =
  | 'carrinho_abandonado' | 'nunca_comprou' | 'primeira_compra' | 'recorrente'
  | 'fiel' | 'vip' | 'em_risco' | 'perdido';

interface StageResumo {
  stage: CrmStage;
  label: string;
  desc: string;
  clientes: number;
  gasto: number;
  enviados: number;
  converteu: number;
}

export interface CrmRule {
  id: string;
  stage: CrmStage;
  enabled: boolean;
  auto_send: boolean;
  delay_hours: number;
  voucher_type: 'percentual' | 'valor' | 'nenhum';
  voucher_value: number;
  validade_dias: number;
  mensagem: string | null;
  cooldown_days: number;
}

export interface CrmCriteria {
  carrinho_horas: number;
  perdido_dias: number;
  risco_multiplicador: number;
  risco_min_dias: number;
  ciclo_padrao_dias: number;
  fiel_min_pedidos: number;
  vip_min_pedidos: number;
  vip_percentil: number;
  vip_min_gasto: number;
}

interface CrmSettings {
  max_msgs_por_semana: number;
  hora_inicio: number;
  hora_fim: number;
  desconto_max_percent: number;
  max_auto_por_dia?: number;
  auto_so_optin?: boolean;
  auto_ultimo_erro?: string | null;
  auto_ultimo_erro_em?: string | null;
}

interface ClienteFunil {
  customer_id: string;
  nome: string;
  phone: string;
  phone_fmt: string;
  orders_count: number;
  total_spent: number;
  last_order_at: string | null;
  days_since_last: number | null;
  avg_cycle_days: number | null;
  entered_at: string;
  ultimo_contato: string | null;
  pode_abordar: boolean;
  bloqueio: string | null;
  /** Pediu para não receber mensagens (crm_opt_out_at). O servidor novo manda o campo; o antigo só o texto do bloqueio. */
  opt_out?: boolean;
  /** Quando pediu para não receber (customers.crm_opt_out_at). */
  opt_out_at?: string | null;
}

const BLOQUEIO_OPT_OUT = 'pediu para não receber';
function emOptOut(c: ClienteFunil): boolean {
  return c.opt_out === true || c.bloqueio === BLOQUEIO_OPT_OUT;
}

export type OfertaVoucher = { tipo: 'discount_percent' | 'discount_fixed' | 'gift_card'; valor: number; validadeDias: number };

interface Props {
  /** Abre o modal de voucher com a oferta da regra já preenchida. */
  onEnviarVoucher: (
    cliente: ClienteCRM,
    oferta: OfertaVoucher | undefined,
    aoEnviar?: (voucher?: Voucher, mensagem?: string) => void,
  ) => void;
  /** Quem só tem clientes_ver (ex.: Líder) não emite voucher: esconde o botão "Voucher". Padrão: true. */
  podeVoucher?: boolean;
}

// Jornada normal do cliente, na ordem em que ele avança.
const JORNADA: CrmStage[] = ['nunca_comprou', 'primeira_compra', 'recorrente', 'fiel', 'vip'];
// Estágios que pedem ação (quem está escapando).
const ATENCAO: CrmStage[] = ['carrinho_abandonado', 'em_risco', 'perdido'];

const VISUAL: Record<CrmStage, { icon: string; cor: string; barra: string; chip: string }> = {
  carrinho_abandonado: { icon: 'ri-shopping-cart-2-line', cor: 'text-orange-600 bg-orange-50', barra: '#f97316', chip: 'bg-orange-50 text-orange-700 border-orange-200' },
  nunca_comprou: { icon: 'ri-user-add-line', cor: 'text-zinc-500 bg-zinc-100', barra: '#a1a1aa', chip: 'bg-zinc-50 text-zinc-600 border-zinc-200' },
  primeira_compra: { icon: 'ri-shopping-bag-3-line', cor: 'text-sky-600 bg-sky-50', barra: '#0ea5e9', chip: 'bg-sky-50 text-sky-700 border-sky-200' },
  recorrente: { icon: 'ri-repeat-line', cor: 'text-green-600 bg-green-50', barra: '#22c55e', chip: 'bg-green-50 text-green-700 border-green-200' },
  fiel: { icon: 'ri-heart-3-line', cor: 'text-emerald-600 bg-emerald-50', barra: '#10b981', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  vip: { icon: 'ri-vip-crown-line', cor: 'text-amber-600 bg-amber-50', barra: '#f59e0b', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  em_risco: { icon: 'ri-alarm-warning-line', cor: 'text-yellow-700 bg-yellow-50', barra: '#eab308', chip: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  perdido: { icon: 'ri-user-unfollow-line', cor: 'text-red-600 bg-red-50', barra: '#ef4444', chip: 'bg-red-50 text-red-700 border-red-200' },
};

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pct(parte: number, total: number): string {
  return total > 0 ? Math.round((parte / total) * 100) + '%' : '—';
}

/** A descrição do servidor tem os cortes padrão fixos no texto ("90 dias", "6 ou
 *  mais"); aqui ela passa a refletir os critérios que a loja realmente usa. */
function descDoEstagio(stage: CrmStage, c: CrmCriteria | null, padrao: string): string {
  if (!c) return padrao;
  const top = Math.round((1 - Number(c.vip_percentil)) * 100);
  switch (stage) {
    case 'carrinho_abandonado': return `Montou o pedido e não finalizou (últimas ${c.carrinho_horas}h)`;
    case 'recorrente': return Number(c.fiel_min_pedidos) > 2 ? `2 a ${Number(c.fiel_min_pedidos) - 1} pedidos, dentro do ritmo` : padrao;
    case 'fiel': return `${c.fiel_min_pedidos} ou mais pedidos, ativo`;
    case 'vip': return `Top ${top}% em gasto` + (Number(c.vip_min_gasto) > 0 ? ` (acima de ${fmtMoeda(Number(c.vip_min_gasto))})` : '');
    case 'em_risco': return `Passou ${String(c.risco_multiplicador).replace('.', ',')}× do ritmo dele sem pedir`;
    case 'perdido': return `Sem pedir há mais de ${c.perdido_dias} dias`;
    default: return padrao;
  }
}

function resumoOferta(r: CrmRule | undefined): string | null {
  if (!r || !r.enabled || r.voucher_type === 'nenhum' || !(Number(r.voucher_value) > 0)) return null;
  const valor = r.voucher_type === 'valor' ? fmtMoeda(Number(r.voucher_value)) : Number(r.voucher_value) + '%';
  return `${valor} por ${r.validade_dias} dia${Number(r.validade_dias) === 1 ? '' : 's'}`;
}

/** Resumo da linha do acordeão de Ofertas: "10% por 3 dias", "R$ 15 por 7 dias" ou "só mensagem".
 *  Vale com a regra ligada ou não (o dono vê o que está configurado mesmo desligado). */
function resumoCurtoOferta(r: CrmRule): string {
  const n = Number(r.voucher_value);
  if (r.voucher_type === 'nenhum' || !(n > 0)) return 'só mensagem';
  const valor = r.voucher_type === 'valor' ? 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : n + '%';
  const dias = Number(r.validade_dias);
  return `${valor} por ${dias} dia${dias === 1 ? '' : 's'}`;
}

function seloDaRegra(r: CrmRule): SeloLinha {
  if (r.auto_send) return { texto: 'Automático', cls: 'bg-green-50 text-green-700 border-green-200' };
  if (r.enabled) return { texto: 'Sugerindo', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { texto: 'Desligado', cls: 'bg-zinc-50 text-zinc-500 border-zinc-200' };
}

function dentroDoHorario(s: CrmSettings | null, agora = new Date()): boolean {
  if (!s) return true;
  const h = agora.getHours();
  const ini = Number(s.hora_inicio);
  const fim = Number(s.hora_fim);
  if (ini === fim) return true;
  return ini < fim ? h >= ini && h < fim : h >= ini || h < fim;
}

const INPUT = 'w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400';

export default function FunilAba(props: Props) {
  const { user } = useAuth();
  const podeVoucher = props.podeVoucher !== false;
  const [aba, setAba] = useState<'funil' | 'regras' | 'criterios'>('funil');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [stages, setStages] = useState<StageResumo[]>([]);
  const [rules, setRules] = useState<CrmRule[]>([]);
  const [settings, setSettings] = useState<CrmSettings | null>(null);
  const [criteria, setCriteria] = useState<CrmCriteria | null>(null);
  const [criteriaPadrao, setCriteriaPadrao] = useState<CrmCriteria | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [msgSalvo, setMsgSalvo] = useState('');
  const [alterado, setAlterado] = useState(false);

  const [stageAberto, setStageAberto] = useState<CrmStage | null>(null);
  const [listaCarregando, setListaCarregando] = useState(false);
  // Falha ao carregar a lista do estágio: NÃO pode parecer "ninguém para abordar".
  const [erroLista, setErroLista] = useState('');
  const [clientes, setClientes] = useState<ClienteFunil[]>([]);
  const [soElegiveis, setSoElegiveis] = useState(true);
  const [busca, setBusca] = useState('');
  const [sequencia, setSequencia] = useState<ClienteFunil[] | null>(null);
  const [showNaoPediram, setShowNaoPediram] = useState(false);
  // Cartão Aniversariantes: totais do overview (null = servidor sem o campo ou falhou: o cartão some)
  // e a lista de quem faz aniversário hoje até +6 dias (carregada ao tocar no cartão).
  const [aniv, setAniv] = useState<{ total: number; comVoucher: number } | null>(null);
  const [anivAberto, setAnivAberto] = useState(false);
  const [anivCarregando, setAnivCarregando] = useState(false);
  const [anivErro, setAnivErro] = useState('');
  const [anivLista, setAnivLista] = useState<Aniversariante[]>([]);
  // Ofertas (acordeão): uma linha aberta por vez, e o painel do envio automático recolhível.
  const [ofertaAberta, setOfertaAberta] = useState<CrmStage | 'aniversario' | null>(null);
  const [autoAberto, setAutoAberto] = useState(false);
  // Situação dos modelos na Meta (nome → APPROVED/PENDING/…), vinda do painel do envio automático.
  const [modelos, setModelos] = useState<Record<string, string>>({});
  // auto_send como veio do servidor: vai junto no salvar para uma aba antiga não religar o
  // automático que outra pessoa desligou (o servidor ignora se o banco mudou no meio).
  const [autoServidor, setAutoServidor] = useState<Record<string, boolean>>({});

  const tenantId = user?.tenantId;

  // Seção da lista do estágio (rolagem no celular) e controle de resposta atrasada.
  const listaRef = useRef<HTMLElement>(null);
  const rolarAoAbrir = useRef(false);
  const listaReq = useRef(0);
  const anivReq = useRef(0);

  const abrirStage = useCallback(function (stage: CrmStage) {
    if (!tenantId) return;
    const req = ++listaReq.current;
    setAnivAberto(false);
    setStageAberto(stage);
    setListaCarregando(true);
    setErroLista('');
    setClientes([]);
    setBusca('');
    invokeWithAuth<{ clientes?: ClienteFunil[]; error?: string; message?: string }>(
      'crm-funnel', { body: { action: 'list_stage', tenant_id: tenantId, stage } },
    ).then(function (res) {
      if (req !== listaReq.current) return; // o dono já abriu outro estágio
      setListaCarregando(false);
      if (res.error) { setErroLista(res.error.message); return; }
      const d = res.data;
      if (!d || d.error) { setErroLista(d?.message || d?.error || 'Não foi possível carregar a lista.'); return; }
      setClientes(d.clientes ?? []);
    });
  }, [tenantId]);

  // Toque num cartão de estágio no celular: leva a lista para a vista (no computador
  // o cartão e a lista já aparecem juntos). Só quando o clique é do usuário.
  useEffect(function () {
    if (!rolarAoAbrir.current || (!stageAberto && !anivAberto)) return;
    rolarAoAbrir.current = false;
    if (typeof window !== 'undefined' && window.matchMedia && !window.matchMedia('(max-width: 767px)').matches) return;
    listaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [stageAberto, listaCarregando, anivAberto, anivCarregando]);

  function abrirStageClicado(stage: CrmStage) {
    rolarAoAbrir.current = true;
    abrirStage(stage);
  }

  // Aniversariantes (hoje até +6 dias). Atualiza também os totais do cartão: o que acabou de ser
  // gerado em Ofertas (voucher do mês) passa a contar como "voucher pronto".
  const carregarAniv = useCallback(function () {
    if (!tenantId) return;
    const req = ++anivReq.current;
    setAnivCarregando(true);
    setAnivErro('');
    invokeWithAuth<{ clientes?: Aniversariante[]; error?: string; message?: string }>(
      'crm-funnel', { body: { action: 'list_aniversariantes', tenant_id: tenantId } },
    ).then(function (res) {
      if (req !== anivReq.current) return; // outra leitura mais nova (ou troca de loja) já respondeu
      setAnivCarregando(false);
      if (res.error) { setAnivErro(res.error.message); return; }
      const d = res.data;
      if (!d || d.error) { setAnivErro(d?.message || d?.error || 'Não foi possível carregar a lista.'); return; }
      const lista = d.clientes ?? [];
      setAnivLista(lista);
      setAniv({ total: lista.length, comVoucher: lista.filter(function (a) { return voucherVale(a.voucher); }).length });
    });
  }, [tenantId]);

  function abrirAnivClicado() {
    rolarAoAbrir.current = true;
    setAnivAberto(true);
    carregarAniv();
  }

  // `silencioso`: recarrega sem trocar a tela por "Calculando o funil…". Usado
  // depois de salvar, senão o formulário que o dono acabou de mexer some.
  const carregarOverview = useCallback(function (silencioso?: boolean) {
    if (!tenantId) return;
    if (!silencioso) {
      setCarregando(true);
      // Troca de loja (ou recálculo): a lista de aniversariantes da outra loja não pode ficar na tela.
      anivReq.current++;
      setAnivAberto(false); setAnivLista([]); setAnivErro(''); setAnivCarregando(false);
    }
    setErro('');
    invokeWithAuth<{
      stages?: StageResumo[]; rules?: CrmRule[]; settings?: CrmSettings;
      criteria?: CrmCriteria; criteria_padrao?: CrmCriteria; error?: string; message?: string;
      aniversariantes?: number | null; aniversariantes_com_voucher?: number | null;
    }>(
      'crm-funnel', { body: { action: 'overview', tenant_id: tenantId } },
    ).then(function (res) {
      setCarregando(false);
      if (res.error) { setErro(res.error.message); return; }
      const d = res.data;
      if (!d || d.error) { setErro(d?.message || d?.error || 'Não foi possível carregar o funil.'); return; }
      const lista = d.stages ?? [];
      setStages(lista);
      setRules(d.rules ?? []);
      setAutoServidor(Object.fromEntries((d.rules ?? []).map(function (r) { return [r.stage, r.auto_send]; })));
      setSettings(d.settings ?? null);
      setCriteria(d.criteria ?? null);
      setCriteriaPadrao(d.criteria_padrao ?? null);
      setAniv(typeof d.aniversariantes === 'number'
        ? { total: d.aniversariantes, comVoucher: Number(d.aniversariantes_com_voucher ?? 0) }
        : null);
      setAlterado(false);
      // Na primeira abertura já mostra quem precisa de atenção.
      if (!silencioso) {
        const primeiro = [...ATENCAO, 'primeira_compra' as CrmStage]
          .find(function (s) { return (lista.find(function (x) { return x.stage === s; })?.clientes ?? 0) > 0; });
        if (primeiro) abrirStage(primeiro);
      }
    });
  }, [tenantId, abrirStage]);

  useEffect(function () { carregarOverview(); }, [carregarOverview]);

  // Recalcular recarrega ofertas e critérios do servidor: com edição não salva, pede confirmação.
  async function recalcular() {
    if (alterado) {
      const ok = await confirmar({
        titulo: 'Descartar as alterações não salvas?',
        mensagem: 'Recalcular o funil recarrega as ofertas e os critérios do servidor e perde o que você mudou e ainda não salvou.',
        confirmarLabel: 'Descartar e recalcular',
        cancelarLabel: 'Continuar editando',
        perigo: true,
      });
      if (!ok) return;
    }
    carregarOverview();
  }

  function regraDo(stage: CrmStage): CrmRule | undefined {
    return rules.find(function (r) { return r.stage === stage; });
  }
  function resumoDo(stage: CrmStage): StageResumo | undefined {
    return stages.find(function (s) { return s.stage === stage; });
  }

  /** Resposta do crm-funnel com erro (rede, 4xx/5xx ou corpo com error)? Devolve a mensagem. */
  function erroDaResposta(res: { data: unknown; error: Error | null }): string | null {
    if (res.error) return res.error.message;
    const d = res.data as { error?: string; message?: string } | null;
    if (!d) return 'Sem resposta do servidor.';
    if (d.error) return d.message || d.error;
    return null;
  }

  function registrarEnvio(stage: CrmStage, customerId: string, voucherId: string | null, mensagem: string) {
    if (!tenantId) return;
    invokeWithAuth('crm-funnel', {
      body: { action: 'log_send', tenant_id: tenantId, stage, customer_id: customerId, voucher_id: voucherId, message: mensagem },
    }).then(function (res) {
      const falha = erroDaResposta(res);
      if (falha) {
        // Não marca como abordado: o registro não foi gravado (cooldown e teto semanal não contam).
        setErro('Não consegui registrar a abordagem (' + falha + '). Se a mensagem saiu, confira antes de chamar de novo.');
        return;
      }
      // Sai da lista de elegíveis (entrou em cooldown).
      setClientes(function (prev) {
        return prev.map(function (c) {
          return c.customer_id === customerId ? { ...c, pode_abordar: false, bloqueio: 'já abordado (cooldown)' } : c;
        });
      });
    });
  }

  function textoPara(c: ClienteFunil, stage: CrmStage): string {
    const modelo = regraDo(stage)?.mensagem || MODELO_PADRAO_MENSAGEM;
    return montarMensagem(modelo, { nome: c.nome, loja: user?.loja || 'nossa loja', estagio: stage });
  }

  function chamarNoWhats(c: ClienteFunil, stage: CrmStage) {
    if (emOptOut(c)) { setErro(AVISO_OPT_OUT + ': ' + c.nome + '.'); return; }
    const texto = textoPara(c, stage);
    if (!abrirWhatsApp(c.phone, texto)) { setErro(c.nome + ' não tem um celular válido para o WhatsApp.'); return; }
    registrarEnvio(stage, c.customer_id, null, texto);
  }

  function mandarVoucher(c: ClienteFunil, stage: CrmStage) {
    if (!podeVoucher) return;
    if (emOptOut(c)) { setErro(AVISO_OPT_OUT + ': ' + c.nome + '.'); return; }
    const regra = regraDo(stage);
    if (!regra) return;
    const tipo = regra.voucher_type === 'valor' ? 'discount_fixed' : 'discount_percent';
    props.onEnviarVoucher(
      {
        id: c.customer_id, nome: c.nome, celular: c.phone, email: null, cpf: null,
        dataNascimento: null, genero: null, notes: null, manualTags: [], aceitaMarketing: false,
        optOut: c.opt_out_at ?? null,
        ultimoContato: c.ultimo_contato, primeiraVisita: c.entered_at, ultimaVisita: c.last_order_at ?? c.entered_at,
        totalVisitas: c.orders_count, valorTotal: c.total_spent,
        ticketMedio: c.orders_count > 0 ? c.total_spent / c.orders_count : 0,
        itensFavoritos: [], pedidos: [], tags: [],
      },
      { tipo, valor: Number(regra.voucher_value || 0), validadeDias: Number(regra.validade_dias || 7) },
      function (voucher, mensagem) {
        registrarEnvio(stage, c.customer_id, voucher?.id ?? null, mensagem ?? '');
      },
    );
  }

  function naoPerturbe(c: ClienteFunil) {
    if (!tenantId) return;
    invokeWithAuth('crm-funnel', {
      body: { action: 'set_opt_out', tenant_id: tenantId, customer_id: c.customer_id, opt_out: true },
    }).then(function (res) {
      const falha = erroDaResposta(res);
      if (falha) {
        // Não marca localmente: o cliente continuaria recebendo e a tela diria que não.
        setErro('Não consegui marcar "não perturbe" para ' + c.nome + ' (' + falha + '). Tente de novo.');
        return;
      }
      setClientes(function (prev) {
        return prev.map(function (x) {
          return x.customer_id === c.customer_id ? { ...x, pode_abordar: false, bloqueio: BLOQUEIO_OPT_OUT, opt_out: true, opt_out_at: x.opt_out_at ?? new Date().toISOString() } : x;
        });
      });
    });
  }

  /** Público personalizado da Meta: phone,email,fn,ln,country (o mesmo formato da aba Clientes).
   *  Fica de fora quem pediu para não receber e quem não tem celular válido. */
  function exportarPublicoMeta(stage: CrmStage) {
    const linhas: unknown[][] = [['phone', 'email', 'fn', 'ln', 'country']];
    for (const c of clientes) {
      if (emOptOut(c)) continue;
      const tel = celularComDDI(c.phone);
      if (!tel) continue;
      const partes = c.nome.trim().split(/\s+/);
      const fn = (partes[0] || '').toLowerCase();
      const ln = (partes.length > 1 ? partes[partes.length - 1] : '').toLowerCase();
      linhas.push(['+' + tel, '', fn, ln, 'br']);
    }
    // Coluna 0 (telefone) começa com "+": sem a trava de fórmula do CSV.
    baixarCsv(montarCsv(linhas, ',', [0]), 'publico-meta-' + stage + '.csv');
  }

  function alterarRegra(stage: CrmStage, patch: Partial<CrmRule>) {
    setAlterado(true);
    setMsgSalvo('');
    setRules(function (prev) {
      return prev.map(function (r) { return r.stage === stage ? { ...r, ...patch } : r; });
    });
  }
  function alterarCriterio(patch: Partial<CrmCriteria>) {
    if (!criteria) return;
    setAlterado(true);
    setMsgSalvo('');
    setCriteria({ ...criteria, ...patch });
  }
  function alterarSettings(patch: Partial<CrmSettings>) {
    if (!settings) return;
    setAlterado(true);
    setMsgSalvo('');
    setSettings({ ...settings, ...patch });
  }

  /** Modelo da Meta que o estágio usa no automático: com cupom ou só contato. */
  function modeloDo(r: CrmRule): string {
    return r.voucher_type !== 'nenhum' && Number(r.voucher_value) > 0 ? MODELO_COM_CUPOM : MODELO_SEM_CUPOM;
  }

  /** Por que o automático deste estágio não pode ser ligado agora (null = pode). */
  function bloqueioAuto(r: CrmRule): string | null {
    if (!r.enabled) return 'Ligue a oferta do estágio primeiro.';
    const st = modelos[modeloDo(r)];
    if (st !== 'APPROVED') return st === 'PENDING' ? 'Aguardando a Meta aprovar o modelo.' : 'O modelo desta mensagem ainda não foi aprovado pela Meta.';
    return null;
  }

  // Ligar o automático pede confirmação com a fila real (quem receberia hoje).
  // Desligar é imediato. Nos dois casos vale depois de "Salvar ofertas".
  async function alternarAuto(r: CrmRule, label: string) {
    if (r.auto_send) { alterarRegra(r.stage, { auto_send: false }); return; }
    if (alterado) {
      await confirmar({ titulo: 'Salve as ofertas primeiro', mensagem: 'Há mudanças não salvas. Salve (ou descarte) e depois ligue o envio automático.', confirmarLabel: 'Entendi', cancelarLabel: '' });
      return;
    }
    const res = await invokeWithAuth<{
      total?: number; restante_hoje?: number; sem_optin?: number; sem_celular?: number; so_optin?: boolean;
      sem_link_delivery?: boolean; error?: string; message?: string;
    }>('crm-funnel', { body: { action: 'auto_tick', tenant_id: tenantId, dry_run: true, estagios: [r.stage] } });
    const d = res.data;
    if (res.error || !d || d.error) {
      await confirmar({ titulo: 'Não consegui montar a prévia', mensagem: res.error?.message || d?.message || 'Tente de novo.', confirmarLabel: 'Entendi', cancelarLabel: '' });
      return;
    }
    const semCupom = modeloDo(r) === MODELO_SEM_CUPOM;
    const ok = await confirmar({
      titulo: `Ligar o envio automático em "${label}"?`,
      confirmarLabel: 'Ligar envio automático',
      mensagem: (
        <div className="space-y-2 text-left text-sm">
          <p>
            O ERPOS vai mandar <strong>sozinho</strong>, pelo WhatsApp do assistente, {semCupom ? 'a mensagem' : 'a oferta com o voucher'} deste
            estágio para quem puder ser abordado — de hora em hora, das {settings?.hora_inicio}h às {settings?.hora_fim}h,
            no máximo {settings?.max_auto_por_dia ?? 30} mensagens por dia na loja.
          </p>
          <p><strong>{d.total ?? 0}</strong> {d.total === 1 ? 'cliente receberia' : 'clientes receberiam'} agora.
            {d.so_optin && (d.sem_optin ?? 0) > 0 ? ` ${d.sem_optin} ficam de fora por não terem aceitado receber ofertas.` : ''}
            {(d.sem_celular ?? 0) > 0 ? ` ${d.sem_celular} sem celular válido.` : ''}</p>
          {semCupom && d.sem_link_delivery && <p className="text-red-600">A loja não tem link do delivery: a mensagem sem cupom não sai.</p>}
          <p className="text-zinc-500">A Meta cobra cada mensagem de marketing (cerca de R$ 0,35). Começa depois de você salvar as ofertas.</p>
        </div>
      ),
    });
    if (ok) alterarRegra(r.stage, { auto_send: true });
  }

  function salvarRegras() {
    if (!tenantId) return;
    setSalvando(true);
    setMsgSalvo('');
    invokeWithAuth<{ rules?: CrmRule[]; settings?: CrmSettings; criteria?: CrmCriteria; error?: string; message?: string }>(
      'crm-funnel', { body: {
        action: 'save_rules', tenant_id: tenantId, settings, criteria,
        rules: rules.map(function (r) { return { ...r, auto_send_antes: autoServidor[r.stage] ?? false }; }),
      } },
    ).then(function (res) {
      setSalvando(false);
      const d = res.data;
      if (res.error || !d || d.error) {
        setMsgSalvo(res.error?.message || d?.message || d?.error || 'Erro ao salvar.');
        return;
      }
      setRules(d.rules ?? rules);
      if (d.rules) setAutoServidor(Object.fromEntries(d.rules.map(function (r) { return [r.stage, r.auto_send]; })));
      setSettings(d.settings ?? settings);
      // O servidor devolve o que REALMENTE gravou (valores fora da faixa são
      // ajustados lá) — a tela tem que mostrar isso, não o que foi digitado.
      if (d.criteria) setCriteria(d.criteria);
      setAlterado(false);
      setMsgSalvo('Salvo.');
      // Mudou um corte, mudou quem está em cada estágio: recarrega as contagens.
      carregarOverview(true);
      if (stageAberto) abrirStage(stageAberto);
    });
  }

  const elegiveis = useMemo(function () {
    return clientes.filter(function (c) { return c.pode_abordar && !!c.phone; });
  }, [clientes]);

  const listaVisivel = useMemo(function () {
    let l = soElegiveis ? clientes.filter(function (c) { return c.pode_abordar; }) : clientes;
    const q = busca.trim().toLowerCase();
    if (q) {
      const dig = q.replace(/\D/g, '');
      l = l.filter(function (c) {
        return c.nome.toLowerCase().includes(q) || (!!dig && c.phone.replace(/\D/g, '').includes(dig));
      });
    }
    return l;
  }, [clientes, soElegiveis, busca]);

  const totalClientes = stages.reduce(function (s, x) { return s + x.clientes; }, 0);
  const maxJornada = Math.max(1, ...JORNADA.map(function (s) { return resumoDo(s)?.clientes ?? 0; }));
  const totEnviados = stages.reduce(function (s, x) { return s + x.enviados; }, 0);
  const totConverteu = stages.reduce(function (s, x) { return s + x.converteu; }, 0);
  const noHorario = dentroDoHorario(settings);
  const salvarBar = (aba === 'regras' || aba === 'criterios');

  function CardEstagio({ stage, compacto }: { stage: CrmStage; compacto?: boolean }) {
    const s = resumoDo(stage);
    if (!s) return null;
    const v = VISUAL[stage];
    const oferta = resumoOferta(regraDo(stage));
    const ativo = stageAberto === stage && !anivAberto;
    return (
      <button
        onClick={function () { abrirStageClicado(stage); }}
        className={'w-full h-full flex flex-col text-left bg-white rounded-xl border p-3 cursor-pointer transition-all hover:shadow-sm ' +
          (ativo ? 'border-amber-400 ring-2 ring-amber-100' : 'border-zinc-200 hover:border-zinc-300')}
      >
        <div className="flex items-start justify-between gap-2">
          <div className={'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ' + v.cor}>
            <i className={v.icon + ' text-sm'} />
          </div>
          <div className="text-right">
            <p className="text-xl font-black text-zinc-900 leading-none">{s.clientes}</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">{pct(s.clientes, totalClientes)} da base</p>
          </div>
        </div>
        <p className="text-xs font-bold text-zinc-800 mt-2 leading-tight">{s.label}</p>
        {!compacto && <p className="text-[10px] text-zinc-400 leading-snug mt-0.5 min-h-[26px]">{descDoEstagio(stage, criteria, s.desc)}</p>}
        {!compacto && JORNADA.includes(stage) && (
          <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-2">
            <div className="h-full rounded-full transition-all" style={{ width: `${(s.clientes / maxJornada) * 100}%`, background: v.barra }} />
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-2">
          {s.gasto > 0 && (
            <span className="text-[10px] text-zinc-500" title="Gasto histórico dos clientes neste estágio">{fmtMoeda(s.gasto)}</span>
          )}
          {oferta && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700" title="Oferta sugerida neste estágio">
              <i className="ri-coupon-3-line" /> {oferta}
            </span>
          )}
          {s.enviados > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-700" title={`${s.converteu} de ${s.enviados} abordados pediram depois (60 dias)`}>
              {pct(s.converteu, s.enviados)} voltaram
            </span>
          )}
        </div>
      </button>
    );
  }

  // Cartão rosa, o primeiro de "Precisam de atenção". Some se o servidor não mandou o total.
  function cartaoAniversariantes() {
    if (!aniv) return null;
    const pronto = aniv.comVoucher > 0;
    return (
      <button
        key="aniversariantes"
        onClick={abrirAnivClicado}
        className={'w-full h-full flex flex-col text-left bg-white rounded-xl border p-3 cursor-pointer transition-all hover:shadow-sm ' +
          (anivAberto ? 'border-pink-400 ring-2 ring-pink-100' : 'border-zinc-200 hover:border-zinc-300')}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-pink-500 bg-pink-50">
            <i className="ri-cake-3-line text-sm" />
          </div>
          <div className="text-right">
            <p className="text-xl font-black text-zinc-900 leading-none">{aniv.total}</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">em 7 dias</p>
          </div>
        </div>
        <p className="text-xs font-bold text-zinc-800 mt-2 leading-tight">Aniversariantes</p>
        <p className="text-[10px] text-zinc-400 leading-snug mt-0.5 min-h-[26px]">Fazem aniversário nos próximos 7 dias</p>
        <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-2">
          {aniv.total === 0 ? (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-50 text-zinc-500">Ninguém por enquanto</span>
          ) : pronto ? (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-pink-50 text-pink-700">
              <i className="ri-coupon-3-line" /> Voucher de aniversário pronto
            </span>
          ) : (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-pink-50 text-pink-700">
              <i className="ri-heart-line" /> Mande os parabéns
            </span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 pb-24">
      {/* Sub-abas + atalhos */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-zinc-100 rounded-xl p-1 self-start">
          {([['funil', 'Quem chamar', 'ri-filter-3-line'], ['regras', 'Ofertas', 'ri-coupon-3-line'], ['criterios', 'Critérios', 'ri-equalizer-line']] as const).map(function ([key, label, icon]) {
            return (
              <button
                key={key}
                onClick={function () { setAba(key); }}
                className={'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ' +
                  (aba === key ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700')}
              >
                <i className={icon} /> {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {totEnviados > 0 && (
            <span className="text-[11px] text-zinc-500 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5" title="Clientes abordados pelo funil nos últimos 60 dias que pediram depois da mensagem">
              <i className="ri-line-chart-line text-green-600" /> <strong className="text-zinc-700">{totConverteu}</strong> de {totEnviados} abordados voltaram ({pct(totConverteu, totEnviados)})
            </span>
          )}
          <button
            onClick={function () { setShowNaoPediram(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700"
            title="Quem entrou no cardápio do delivery e saiu sem pedir"
          >
            <i className="ri-eye-line" /> Visitas sem pedido
          </button>
          <button
            onClick={function () { recalcular(); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 cursor-pointer"
            title="Recalcular o funil"
          >
            <i className="ri-refresh-line" />
          </button>
        </div>
      </div>

      {erro && (
        <div role="alert" className="sticky top-2 z-20 flex items-start justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 shadow-sm">
          <span>{erro}</span>
          <button onClick={function () { setErro(''); }} className="flex-shrink-0 text-red-400 hover:text-red-600 cursor-pointer" title="Fechar o aviso">
            <i className="ri-close-line" />
          </button>
        </div>
      )}

      {carregando ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-zinc-400">Calculando o funil…</p>
        </div>
      ) : aba === 'funil' ? (
        <>
          {!noHorario && settings && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-yellow-50 border border-yellow-200 rounded-xl">
              <i className="ri-moon-line text-yellow-600 text-sm mt-0.5" />
              <p className="text-[11px] text-yellow-800">
                Fora do horário combinado para abordar clientes ({settings.hora_inicio}h às {settings.hora_fim}h).
                Dá para ver a lista, mas o ideal é mandar as mensagens dentro do horário.
              </p>
            </div>
          )}

          {/* Precisam de atenção */}
          <section>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <i className="ri-error-warning-line text-orange-500" /> Precisam de atenção
            </h3>
            <div className={'grid grid-cols-1 gap-2 md:gap-3 ' + (aniv ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}>
              {cartaoAniversariantes()}
              {ATENCAO.map(function (s) { return <CardEstagio key={s} stage={s} />; })}
            </div>
          </section>

          {/* Jornada */}
          <section>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <i className="ri-route-line text-amber-500" /> Jornada do cliente
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
              {JORNADA.map(function (s, i) {
                return (
                  <div key={s} className="relative h-full">
                    <CardEstagio stage={s} />
                    {i < JORNADA.length - 1 && (
                      <i className="ri-arrow-right-s-line hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 text-zinc-300 text-lg z-10" />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Lista aberta: aniversariantes ou o estágio escolhido */}
          {anivAberto && tenantId ? (
            <section ref={listaRef} className="bg-white border border-zinc-200 rounded-2xl overflow-hidden scroll-mt-3">
              <AniversariantesLista
                tenantId={tenantId}
                loja={user?.loja ?? ''}
                carregando={anivCarregando}
                erro={anivErro}
                lista={anivLista}
                onTentarDeNovo={carregarAniv}
              />
            </section>
          ) : stageAberto ? (
            <section ref={listaRef} className="bg-white border border-zinc-200 rounded-2xl overflow-hidden scroll-mt-3">
              {(function () {
                const s = resumoDo(stageAberto);
                const oferta = resumoOferta(regraDo(stageAberto));
                return (
                  <div className="px-4 py-3 border-b border-zinc-100 space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ' + VISUAL[stageAberto].cor}>
                          <i className={VISUAL[stageAberto].icon} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-zinc-900">{s?.label}</p>
                          <p className="text-[11px] text-zinc-400">
                            {listaCarregando ? 'Carregando…' : erroLista ? 'Não foi possível carregar a lista' : `${elegiveis.length} de ${clientes.length} podem ser abordados agora`}
                            {' · '}
                            {regraDo(stageAberto)?.auto_send && <span className="text-green-700 font-semibold">envio automático ligado · </span>}
                            {oferta ? <span className="text-amber-700 font-semibold">oferta {oferta}</span> : (
                              <button onClick={function () { setOfertaAberta(stageAberto); setAba('regras'); }} className="text-amber-600 hover:underline cursor-pointer">sem oferta — configurar</button>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={function () { setSequencia(elegiveis); }}
                          disabled={elegiveis.length === 0}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer bg-green-500 hover:bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Abre o WhatsApp de cada cliente elegível, um por vez"
                        >
                          <i className="ri-play-circle-line" /> Abordar em sequência ({elegiveis.length})
                        </button>
                        <button
                          onClick={function () { exportarPublicoMeta(stageAberto); }}
                          disabled={clientes.length === 0}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 disabled:opacity-40"
                          title="Baixar este estágio como Público Personalizado do Meta Ads"
                        >
                          <i className="ri-meta-line" /> Público Meta
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="relative flex-1">
                        <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
                        <input
                          value={busca}
                          onChange={function (e) { setBusca(e.target.value); }}
                          placeholder="Buscar neste estágio…"
                          className="w-full pl-9 pr-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 self-start">
                        <button
                          onClick={function () { setSoElegiveis(true); }}
                          className={'px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ' + (soElegiveis ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500')}
                        >
                          Podem ser abordados
                        </button>
                        <button
                          onClick={function () { setSoElegiveis(false); }}
                          className={'px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ' + (!soElegiveis ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500')}
                        >
                          Todos ({clientes.length})
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="max-h-[55vh] overflow-auto divide-y divide-zinc-50">
                {listaCarregando ? (
                  <p className="text-xs text-zinc-400 text-center py-8">Carregando…</p>
                ) : erroLista ? (
                  <div className="text-center py-10 px-4">
                    <i className="ri-error-warning-line text-3xl text-red-300" />
                    <p className="text-xs text-red-600 mt-1">Não consegui carregar este estágio: {erroLista}</p>
                    <button
                      onClick={function () { abrirStage(stageAberto); }}
                      className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700"
                    >
                      <i className="ri-refresh-line" /> Tentar de novo
                    </button>
                  </div>
                ) : listaVisivel.length === 0 ? (
                  <div className="text-center py-10">
                    <i className="ri-checkbox-circle-line text-3xl text-zinc-200" />
                    <p className="text-xs text-zinc-400 mt-1">
                      {busca ? 'Ninguém encontrado com essa busca.' : soElegiveis ? 'Ninguém para abordar agora neste estágio.' : 'Nenhum cliente neste estágio.'}
                    </p>
                    {soElegiveis && clientes.length > 0 && !busca && (
                      <button onClick={function () { setSoElegiveis(false); }} className="text-xs text-amber-600 font-semibold mt-2 cursor-pointer">
                        Ver os {clientes.length} do estágio
                      </button>
                    )}
                  </div>
                ) : listaVisivel.map(function (c) {
                  const regra = regraDo(stageAberto);
                  // Mesmo critério do cabeçalho: oferta desligada na aba Ofertas não gera voucher.
                  const temCupom = !!resumoOferta(regra);
                  const optOut = emOptOut(c);
                  return (
                    <div key={c.customer_id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 hover:bg-zinc-50/60">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-zinc-800 truncate">{c.nome}</span>
                          <span className="text-xs text-zinc-400">{c.phone_fmt}</span>
                          {!c.pode_abordar && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">{c.bloqueio}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          {c.orders_count} {c.orders_count === 1 ? 'pedido' : 'pedidos'} · {fmtMoeda(c.total_spent)}
                          {c.days_since_last != null ? ' · há ' + c.days_since_last + ' dias sem pedir' : ''}
                          {c.avg_cycle_days != null ? ' · costuma pedir a cada ' + Math.round(Number(c.avg_cycle_days)) + 'd' : ''}
                          {c.ultimo_contato ? ' · último contato ' + new Date(c.ultimo_contato).toLocaleDateString('pt-BR') : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={function () { chamarNoWhats(c, stageAberto); }}
                          disabled={!c.phone || optOut}
                          title={optOut ? AVISO_OPT_OUT : !c.phone ? 'Sem celular cadastrado' : 'Abrir o WhatsApp com a mensagem do estágio'}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-green-200 bg-green-50 hover:bg-green-100 text-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <i className="ri-whatsapp-line" /> Chamar
                        </button>
                        {temCupom && podeVoucher && (
                          <button
                            onClick={function () { mandarVoucher(c, stageAberto); }}
                            disabled={optOut}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={optOut ? AVISO_OPT_OUT : 'Gerar voucher com a oferta do estágio'}
                          >
                            <i className="ri-coupon-3-line" />
                            {regra!.voucher_type === 'valor'
                              ? fmtMoeda(Number(regra!.voucher_value))
                              : Number(regra!.voucher_value) + '%'}
                          </button>
                        )}
                        <button
                          onClick={function () { naoPerturbe(c); }}
                          title="Cliente pediu para não receber mensagens"
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 hover:bg-zinc-50 cursor-pointer"
                        >
                          <i className="ri-notification-off-line text-sm" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <p className="text-xs text-zinc-400 text-center py-6">Clique num estágio para ver quem está lá.</p>
          )}
        </>
      ) : aba === 'regras' ? (
        /* ── Ofertas (o que o ERPOS sugere em cada estágio) ── */
        <div className="space-y-3">
          <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
            <i className="ri-information-line text-blue-500 text-sm mt-0.5" />
            <p className="text-[11px] text-blue-700">
              Ligar um estágio faz o ERPOS <strong>sugerir</strong> a oferta na lista do funil, e o envio é um
              clique seu — a não ser que você ligue o <strong>envio automático</strong> do estágio. Marcadores da
              mensagem (envio pelo clique):{' '}
              <code>{'{nome}'}</code>, <code>{'{loja}'}</code>, <code>{'{cupom}'}</code>, <code>{'{link}'}</code>.
              {settings && <> Desconto em % nunca passa de <strong>{settings.desconto_max_percent}%</strong> (trava em Critérios).</>}
            </p>
          </div>

          {tenantId && (
            <PainelEnvioAutomatico
              tenantId={tenantId}
              settings={settings}
              algumLigado={rules.some(function (r) { return r.auto_send; })}
              qtdLigados={rules.filter(function (r) { return r.auto_send; }).length}
              aberto={autoAberto}
              onToggle={function () { setAutoAberto(function (v) { return !v; }); }}
              onSettings={function (patch) { alterarSettings(patch); }}
              onModelos={setModelos}
            />
          )}

          {/* Acordeão: uma linha por estágio (a primeira é o voucher de aniversário), uma aberta por vez */}
          <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden divide-y divide-zinc-100">
            {tenantId && (
              <AniversarioOferta
                tenantId={tenantId}
                podeVoucher={podeVoucher}
                aberto={ofertaAberta === 'aniversario'}
                onToggle={function () { setOfertaAberta(function (v) { return v === 'aniversario' ? null : 'aniversario'; }); }}
                onGerado={carregarAniv}
              />
            )}
            {[...ATENCAO, ...JORNADA].map(function (stage) {
              const r = regraDo(stage);
              if (!r) return null;
              const resumo = resumoDo(stage);
              const aberto = ofertaAberta === stage;
              const passaTeto = !!settings && r.voucher_type === 'percentual' && Number(r.voucher_value) > Number(settings.desconto_max_percent);
              const modeloMsg = r.mensagem || MODELO_PADRAO_MENSAGEM;
              const previa = montarMensagem(modeloMsg, {
                nome: 'Maria', loja: user?.loja || 'nossa loja', cupom: 'ABC123', link: 'erpos.app/v/…', estagio: stage,
              });
              // Mesma função do botão "Chamar" (sem cupom nem link): o dono vê exatamente o que sai.
              const previaSemVoucher = montarMensagem(modeloMsg, {
                nome: 'Maria', loja: user?.loja || 'nossa loja', estagio: stage,
              });
              const previasDiferem = previaSemVoucher !== previa;
              return (
                <div key={stage}>
                  <CabecalhoOferta
                    aberto={aberto}
                    onToggle={function () { setOfertaAberta(aberto ? null : stage); }}
                    cor={VISUAL[stage].barra}
                    titulo={resumo?.label ?? stage}
                    resumo={resumoCurtoOferta(r)}
                    resumoCls={r.enabled ? 'text-zinc-600' : 'text-zinc-400'}
                    selo={seloDaRegra(r)}
                    idCorpo={'oferta-' + stage}
                  />

                  {aberto && (
                    <div id={'oferta-' + stage} className="px-4 pb-4 pt-3 space-y-3 border-t border-zinc-100">
                      <div className={'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ' +
                        (r.enabled ? 'bg-white border-zinc-200' : 'bg-zinc-50 border-zinc-100')}>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-zinc-700">Oferta {r.enabled ? 'ligada' : 'desligada'}</p>
                          <p className="text-[11px] text-zinc-400">
                            {descDoEstagio(stage, criteria, resumo?.desc ?? '')} · {resumo?.clientes ?? 0} clientes
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={function () { alterarRegra(stage, r.enabled ? { enabled: false, auto_send: false } : { enabled: true }); }}
                          title={r.enabled ? 'Oferta ligada' : 'Oferta desligada'}
                          className={'relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ' +
                            (r.enabled ? 'bg-green-500' : 'bg-zinc-200')}
                        >
                          <span className={'absolute left-0 top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ' +
                            (r.enabled ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                        </button>
                      </div>

                      {(function () {
                        const bloq = r.auto_send ? null : bloqueioAuto(r);
                        return (
                          <div className={'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ' +
                            (r.auto_send ? 'bg-green-50 border-green-200' : 'bg-zinc-50 border-zinc-100')}>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-zinc-700">
                                <i className="ri-robot-2-line mr-1" />Envio automático {r.auto_send ? 'ligado' : 'desligado'}
                              </p>
                              <p className="text-[11px] text-zinc-400">
                                {r.auto_send
                                  ? 'O ERPOS manda sozinho pelo WhatsApp do assistente (modelo aprovado).'
                                  : (bloq ?? 'Pronto para ligar: você confirma antes.')}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={!!bloq}
                              onClick={function () { alternarAuto(r, resumo?.label ?? stage); }}
                              title={r.auto_send ? 'Desligar envio automático' : 'Ligar envio automático'}
                              className={'relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ' +
                                (r.auto_send ? 'bg-green-500' : 'bg-zinc-200')}
                            >
                              <span className={'absolute left-0 top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ' +
                                (r.auto_send ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                            </button>
                          </div>
                        );
                      })()}

                      <div className={'space-y-3 ' + (r.enabled ? '' : 'opacity-50')}>
                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                          <div className="col-span-2">
                            <label className="block text-[11px] font-bold text-zinc-500 mb-1">Oferta</label>
                            <select
                              value={r.voucher_type}
                              onChange={function (e) { alterarRegra(stage, { voucher_type: e.target.value as CrmRule['voucher_type'] }); }}
                              className={INPUT + ' bg-white'}
                            >
                              <option value="nenhum">Só mensagem</option>
                              <option value="percentual">Desconto %</option>
                              <option value="valor">Desconto R$</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-zinc-500 mb-1">Valor</label>
                            <input
                              type="number" min={0} value={r.voucher_value}
                              disabled={r.voucher_type === 'nenhum'}
                              onChange={function (e) { alterarRegra(stage, { voucher_value: Number(e.target.value) }); }}
                              className={INPUT + ' disabled:bg-zinc-50 disabled:text-zinc-300 ' + (passaTeto ? 'border-red-300' : '')}
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-zinc-500 mb-1">Validade (d)</label>
                            <input
                              type="number" min={1} max={90} value={r.validade_dias}
                              disabled={r.voucher_type === 'nenhum'}
                              onChange={function (e) { alterarRegra(stage, { validade_dias: Number(e.target.value) }); }}
                              className={INPUT + ' disabled:bg-zinc-50 disabled:text-zinc-300'}
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-zinc-500 mb-1" title="Tempo no estágio antes de sugerir a abordagem">Esperar (h)</label>
                            <input
                              type="number" min={0} value={r.delay_hours}
                              onChange={function (e) { alterarRegra(stage, { delay_hours: Number(e.target.value) }); }}
                              className={INPUT}
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-zinc-500 mb-1" title="Depois de abordar, não sugerir de novo por esse tempo">Pausa (d)</label>
                            <input
                              type="number" min={0} value={r.cooldown_days}
                              onChange={function (e) { alterarRegra(stage, { cooldown_days: Number(e.target.value) }); }}
                              className={INPUT}
                            />
                          </div>
                        </div>
                        {passaTeto && (
                          <p className="text-[11px] text-red-600">
                            Acima do desconto máximo da loja ({settings!.desconto_max_percent}%) — ao salvar, vira {settings!.desconto_max_percent}%.
                          </p>
                        )}

                        <div>
                          <label className="block text-[11px] font-bold text-zinc-500 mb-1">Mensagem</label>
                          <textarea
                            rows={2}
                            value={r.mensagem ?? ''}
                            onChange={function (e) { alterarRegra(stage, { mensagem: e.target.value }); }}
                            className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                          />
                          <div className="mt-1.5 flex items-start gap-2">
                            <i className="ri-whatsapp-line text-green-500 text-sm mt-0.5" />
                            <div className="flex-1 space-y-1.5">
                              <div>
                                {previasDiferem && <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-0.5">Com voucher</p>}
                                <p className="text-[11px] text-zinc-600 bg-green-50/60 border border-green-100 rounded-lg rounded-tl-none px-2.5 py-1.5">
                                  {previa}
                                </p>
                              </div>
                              {previasDiferem && (
                                <div>
                                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-0.5">Sem voucher (botão Chamar)</p>
                                  <p className="text-[11px] text-zinc-600 bg-green-50/60 border border-green-100 rounded-lg rounded-tl-none px-2.5 py-1.5">
                                    {previaSemVoucher}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── Critérios (quem entra em cada estágio) + travas ── */
        <div className="space-y-3">
          <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
            <i className="ri-information-line text-blue-500 text-sm mt-0.5" />
            <p className="text-[11px] text-blue-700">
              Aqui você define <strong>quem cai em cada estágio</strong>. Cada operação tem um ritmo — um mês sem
              pedir pode ser normal numa casa de almoço e péssimo sinal numa hamburgueria. Ao salvar, o funil é
              recalculado na hora.
            </p>
          </div>

          {criteria && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-2"><i className="ri-alarm-warning-line text-yellow-600" /> Quando o cliente sumiu</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-500 mb-1">Perdido depois de (dias)</label>
                    <input type="number" min={30} max={365} value={criteria.perdido_dias}
                      onChange={function (e) { alterarCriterio({ perdido_dias: Number(e.target.value) }); }} className={INPUT} />
                    <p className="text-[10px] text-zinc-400 mt-1">Sem pedir por esse tempo = perdido.</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-500 mb-1">Em risco: ritmo ×</label>
                    <input type="number" min={1} max={5} step={0.1} value={criteria.risco_multiplicador}
                      onChange={function (e) { alterarCriterio({ risco_multiplicador: Number(e.target.value) }); }} className={INPUT} />
                    <p className="text-[10px] text-zinc-400 mt-1">Vezes o intervalo médio do próprio cliente.</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-500 mb-1">Em risco: nunca antes de (dias)</label>
                    <input type="number" min={3} max={180} value={criteria.risco_min_dias}
                      onChange={function (e) { alterarCriterio({ risco_min_dias: Number(e.target.value) }); }} className={INPUT} />
                    <p className="text-[10px] text-zinc-400 mt-1">Piso: evita cobrar quem pede todo dia.</p>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2">
                  Exemplo: quem costuma pedir a cada <strong>10 dias</strong> entra em risco com{' '}
                  <strong>{Math.max(Number(criteria.risco_min_dias), Math.round(10 * Number(criteria.risco_multiplicador)))} dias</strong>{' '}
                  sem pedir, e vira perdido com <strong>{criteria.perdido_dias}</strong>.
                </p>
              </div>

              <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-2"><i className="ri-vip-crown-line text-amber-500" /> Fiel e VIP</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-500 mb-1">Fiel a partir de (pedidos)</label>
                    <input type="number" min={2} max={50} value={criteria.fiel_min_pedidos}
                      onChange={function (e) { alterarCriterio({ fiel_min_pedidos: Number(e.target.value) }); }} className={INPUT} />
                    <p className="text-[10px] text-zinc-400 mt-1">De 2 até aí, é recorrente.</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-500 mb-1">VIP: mínimo de pedidos</label>
                    <input type="number" min={1} max={50} value={criteria.vip_min_pedidos}
                      onChange={function (e) { alterarCriterio({ vip_min_pedidos: Number(e.target.value) }); }} className={INPUT} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-500 mb-1">VIP: top % que mais gasta</label>
                    <input type="number" min={1} max={50}
                      value={Math.round((1 - Number(criteria.vip_percentil)) * 100)}
                      onChange={function (e) {
                        const topPercent = Math.min(50, Math.max(1, Number(e.target.value) || 10));
                        alterarCriterio({ vip_percentil: Number((1 - topPercent / 100).toFixed(3)) });
                      }}
                      className={INPUT} />
                    <p className="text-[10px] text-zinc-400 mt-1">10 = os 10% maiores da loja.</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-500 mb-1">VIP: gasto mínimo (R$)</label>
                    <input type="number" min={0} value={criteria.vip_min_gasto}
                      onChange={function (e) { alterarCriterio({ vip_min_gasto: Number(e.target.value) }); }} className={INPUT} />
                    <p className="text-[10px] text-zinc-400 mt-1">0 = sem piso, só o top %.</p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-2"><i className="ri-shopping-cart-2-line text-orange-500" /> Carrinho e histórico curto</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-500 mb-1">Carrinho parado conta por (horas)</label>
                    <input type="number" min={1} max={720} value={criteria.carrinho_horas}
                      onChange={function (e) { alterarCriterio({ carrinho_horas: Number(e.target.value) }); }} className={INPUT} />
                    <p className="text-[10px] text-zinc-400 mt-1">Depois disso o cliente volta ao estágio normal dele.</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-500 mb-1">Ritmo assumido sem histórico (dias)</label>
                    <input type="number" min={1} max={120} value={criteria.ciclo_padrao_dias}
                      onChange={function (e) { alterarCriterio({ ciclo_padrao_dias: Number(e.target.value) }); }} className={INPUT} />
                    <p className="text-[10px] text-zinc-400 mt-1">Usado para quem só tem 1 pedido.</p>
                  </div>
                </div>
              </div>

              {/* Travas: valem para todos os estágios */}
              {settings && (
                <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
                  <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-2"><i className="ri-shield-check-line text-green-600" /> Travas de segurança</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-500 mb-1">Máx. mensagens / semana</label>
                      <input type="number" min={1} max={7} value={settings.max_msgs_por_semana}
                        onChange={function (e) { alterarSettings({ max_msgs_por_semana: Number(e.target.value) }); }} className={INPUT} />
                      <p className="text-[10px] text-zinc-400 mt-1">Por cliente, somando os estágios.</p>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-500 mb-1">Desconto máximo (%)</label>
                      <input type="number" min={0} max={90} value={settings.desconto_max_percent}
                        onChange={function (e) { alterarSettings({ desconto_max_percent: Number(e.target.value) }); }} className={INPUT} />
                      <p className="text-[10px] text-zinc-400 mt-1">Nenhuma oferta passa disso.</p>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-500 mb-1">Horário para abordar</label>
                      <div className="flex items-center gap-1.5">
                        <input type="number" min={0} max={23} value={settings.hora_inicio}
                          onChange={function (e) { alterarSettings({ hora_inicio: Number(e.target.value) }); }} className={INPUT} />
                        <span className="text-xs text-zinc-400">às</span>
                        <input type="number" min={0} max={23} value={settings.hora_fim}
                          onChange={function (e) { alterarSettings({ hora_fim: Number(e.target.value) }); }} className={INPUT} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={function () { if (criteriaPadrao) alterarCriterio({ ...criteriaPadrao }); }}
            disabled={!criteriaPadrao}
            className="px-3 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700 cursor-pointer disabled:opacity-40"
          >
            <i className="ri-arrow-go-back-line" /> Restaurar critérios padrão
          </button>
        </div>
      )}

      {/* Barra de salvar: fixa no rodapé enquanto há alteração pendente */}
      {salvarBar && !carregando && (alterado || msgSalvo) && (
        <div className="sticky bottom-4 z-10 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 bg-zinc-900 text-white rounded-xl shadow-lg px-4 py-2.5">
            <span className="text-xs">{msgSalvo || 'Alterações não salvas'}</span>
            {alterado && (
              <>
                <button
                  onClick={function () { carregarOverview(true); setMsgSalvo(''); }}
                  disabled={salvando}
                  className="text-xs text-zinc-300 hover:text-white cursor-pointer disabled:opacity-50"
                >
                  Descartar
                </button>
                <button
                  onClick={salvarRegras}
                  disabled={salvando}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {salvando ? 'Salvando…' : aba === 'criterios' ? 'Salvar e recalcular' : 'Salvar ofertas'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {sequencia && stageAberto && (
        <SequenciaModal
          fila={sequencia}
          stage={stageAberto}
          label={resumoDo(stageAberto)?.label ?? ''}
          temCupom={podeVoucher && !!resumoOferta(regraDo(stageAberto))}
          textoPara={textoPara}
          onChamar={chamarNoWhats}
          onVoucher={mandarVoucher}
          onClose={function () { setSequencia(null); }}
        />
      )}

      {showNaoPediram && (
        <NaoPediramPanel
          onClose={function () { setShowNaoPediram(false); }}
          onEnviarVoucher={function (c, oferta) { setShowNaoPediram(false); props.onEnviarVoucher(c, oferta); }}
        />
      )}
    </div>
  );
}

// ── Abordar em sequência ─────────────────────────────────────────────────────
// Um cliente por vez: cada WhatsApp é aberto por um clique (abrir várias abas
// de uma vez é barrado pelo navegador), e cada envio vai para o crm_sends.
function SequenciaModal(props: {
  fila: ClienteFunil[];
  stage: CrmStage;
  label: string;
  temCupom: boolean;
  textoPara: (c: ClienteFunil, stage: CrmStage) => string;
  onChamar: (c: ClienteFunil, stage: CrmStage) => void;
  onVoucher: (c: ClienteFunil, stage: CrmStage) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [feitos, setFeitos] = useState(0);
  const atual = props.fila[idx] ?? null;
  const concluido = idx >= props.fila.length;

  function avancar(contou: boolean) {
    if (contou) setFeitos(function (n) { return n + 1; });
    setIdx(function (i) { return i + 1; });
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={props.onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92vw] max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center bg-green-50 rounded-lg">
              <i className="ri-play-circle-line text-green-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Abordar: {props.label}</h3>
              <p className="text-[11px] text-zinc-400">{props.fila.length} cliente{props.fila.length !== 1 ? 's' : ''} elegíve{props.fila.length !== 1 ? 'is' : 'l'}</p>
            </div>
          </div>
          <button onClick={props.onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5">
          {concluido ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto flex items-center justify-center bg-green-50 rounded-full mb-3">
                <i className="ri-check-double-line text-green-600 text-2xl" />
              </div>
              <p className="text-sm font-bold text-zinc-800">Fila concluída!</p>
              <p className="text-xs text-zinc-400 mt-1">{feitos} cliente{feitos !== 1 ? 's' : ''} abordado{feitos !== 1 ? 's' : ''}. O retorno aparece no card do estágio.</p>
              <button onClick={props.onClose} className="mt-4 px-4 py-2 rounded-xl bg-zinc-900 text-white text-sm font-semibold cursor-pointer">Fechar</button>
            </div>
          ) : atual && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-zinc-500">{idx + 1} de {props.fila.length}</span>
                <div className="flex-1 mx-3 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(idx / props.fila.length) * 100}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
                  <span className="text-sm font-bold text-amber-700">{atual.nome.charAt(0)}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 truncate">{atual.nome}</p>
                  <p className="text-xs text-zinc-400">
                    {atual.phone_fmt} · {atual.orders_count} pedido{atual.orders_count !== 1 ? 's' : ''}
                    {atual.days_since_last != null ? ` · há ${atual.days_since_last}d` : ''}
                  </p>
                </div>
              </div>
              <div className="bg-green-50/60 border border-green-100 rounded-xl p-3 text-xs text-zinc-700 mb-4 max-h-28 overflow-auto">
                {props.textoPara(atual, props.stage)}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={function () { avancar(false); }}
                  className="px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-500 text-sm font-semibold hover:bg-zinc-50 cursor-pointer"
                >
                  Pular
                </button>
                {props.temCupom && (
                  <button
                    onClick={function () { props.onVoucher(atual, props.stage); avancar(true); }}
                    className="px-3 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-sm font-semibold hover:bg-amber-100 cursor-pointer"
                    title="Gerar o voucher da oferta e enviar"
                  >
                    <i className="ri-coupon-3-line" />
                  </button>
                )}
                <button
                  onClick={function () { props.onChamar(atual, props.stage); avancar(true); }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600 cursor-pointer"
                >
                  <i className="ri-whatsapp-line" /> Abrir e avançar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
