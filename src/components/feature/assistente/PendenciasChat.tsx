// Caixa de pendências dentro do chat do assistente (2026-09-18). Antes morava no sino, e o
// "Resolver" levava para a página de configuração do assistente — não fazia sentido (dono):
// quem resolve é o chat, com botão. Abre pelo botão ao lado das ações rápidas e ocupa o painel
// inteiro, como elas (a faixa fixa no topo tomava espaço da conversa). Aqui aparecem as pendências de TODAS as lojas do dono
// (a RLS de `pendencias` já filtra por user_tenants), com a ação certa em cada uma:
//   pagamento pedido no grupo → Pagar (prepara de novo se venceu e já pede o PIN) ou Ver a mensagem
//                                (quando faltou dado, a conversa do grupo abre na mensagem do pedido)
//   conta sem DRE / itens     → Classificar aqui (um por um, no próprio cartão) ou Abrir na tela
//   tarefas                   → aba própria "Tarefas" (2026-09-18): as MINHAS tarefas vencidas e de hoje,
//                                de qualquer loja — o módulo é por pessoa, não por loja. A pendência
//                                agregada "tarefas vencidas" por loja (cron) sai da lista para não dobrar.
//   o resto                   → Abrir (troca de loja se precisar e vai à tela que resolve)
//   aviso informativo         → OK (estoque crítico: sai da lista; volta se piorar)
//   exige ação                → Não vou fazer (com motivo) — nunca some por tempo.
// Resolver no celular sem abrir tabela grande foi o pedido do dono (2026-09-18); a tela continua
// a um toque para quem está no computador.
import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { kindConfig } from '@/contexts/PendenciasContext';
import ItensClassificarCard from '@/components/feature/assistente/ItensClassificarCard';
import TarefasPendencia, { minhasTarefasPendentes } from '@/components/feature/assistente/TarefasPendencia';
import { chamarPedidos } from '@/pages/receber/pedidos/api';
import { LigarSangria, ProcurarNota, ResumoCompra } from '@/components/feature/assistente/PendenciaDireta';
import BoletoEmailDecisao from '@/pages/financeiro/components/BoletoEmailDecisao';
import DreClassificacaoSelect, { precisaClassificarDRE, useDreEscolha } from '@/pages/financeiro/components/DreClassificacaoSelect';

type Call = <T>(action: string, extra?: Record<string, unknown>) => Promise<T>;

export interface PendenciaChat {
  id: string; tenantId: string; loja: string; kind: string; titulo: string; detalhe: string | null;
  rota: string | null; urgencia: 'alta' | 'normal' | 'baixa'; acaoRequerida: boolean; status: string; criadaEm: string;
  payload?: Record<string, unknown> | null;
}

export async function carregarPendenciasChat(): Promise<PendenciaChat[]> {
  const { data, error } = await supabase
    .from('pendencias')
    .select('id, tenant_id, kind, titulo, detalhe, rota, urgencia, acao_requerida, status, criada_em, payload, tenants(name)')
    .in('status', ['aberta', 'vista'])
    // Ordem de chegada (dono, 2026-09-24): a mais antiga não pode cair fora do limite.
    .order('criada_em', { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  const lista = (data ?? []).map((r) => {
    const t = (r as { tenants?: { name?: string } | { name?: string }[] | null }).tenants;
    const loja = (Array.isArray(t) ? t[0]?.name : t?.name) ?? '';
    return {
      id: r.id, tenantId: r.tenant_id, loja, kind: r.kind, titulo: r.titulo, detalhe: r.detalhe,
      rota: r.rota, urgencia: r.urgencia, acaoRequerida: r.acao_requerida, status: r.status, criadaEm: r.criada_em,
      payload: (r as { payload?: Record<string, unknown> | null }).payload ?? null,
    } as PendenciaChat;
  })
    // Aviso (estoque crítico…) com OK dado sai da lista; volta sozinho se piorar (assistente-cron).
    // O que exige ação continua listado mesmo visto: só sai resolvendo ou com "Não vou fazer".
    .filter((p) => p.acaoRequerida || p.status !== 'vista')
    // Tarefas têm aba própria, por pessoa (a linha por loja do cron seria a mesma coisa duas vezes).
    .filter((p) => p.kind !== 'tarefa_vencida');
  return fecharRecebimentosResolvidos(lista);
}

const notaDa = (p: PendenciaChat) => (typeof p.payload?.document_id === 'string' ? p.payload.document_id : null);
const compraDa = (p: PendenciaChat) => (typeof p.payload?.purchase_id === 'string' ? p.payload.purchase_id : null);
// Tipos que se resolvem no próprio cartão (2026-09-24): não levam "Não vou fazer" genérico — cada um
// tem a sua saída ("Não era compra", "Veio sem nota", "Está certa"…).
const DIRETO = ['compra_pelo_celular', 'sangria_sem_cupom', 'sangria_nao_saiu', 'sangria_valor_diferente', 'recebimento_sem_nota', 'boleto_email'];
// Fechar com um motivo digitado: o texto do campo e como a pendência fecha.
const MOTIVO: Record<string, { placeholder: string; acao: 'resolvida' | 'descartada' }> = {
  sangria_sem_cupom: { placeholder: 'O que foi esse dinheiro?', acao: 'resolvida' },
  recebimento_sem_nota: { placeholder: 'Por que veio sem nota?', acao: 'resolvida' },
};
// Onde se resolve, em uma linha (dono, 2026-09-25: "precisa ser lançada — mas lançada onde?").
const ONDE: Record<string, string> = {
  recebimento_parado: 'Financeiro › Notas de entrada — o botão roxo abaixo abre essa nota direto.',
  nota_nao_lancada: 'Financeiro › Notas de entrada — lance a nota para virar conta a pagar.',
  recebimento_sem_nota: 'Financeiro › Notas de entrada, quando a nota chegar — "Procurar a nota" busca por aqui.',
};
// Pedido de pagamento do /receber (reembolso, freelancer, fornecedor sem nota).
const pedidoDa = (p: PendenciaChat) => (typeof p.payload?.pedido_id === 'string' ? p.payload.pedido_id : null);

// "Recebimento parado" (receber-mercadoria) não tinha quem a fechasse: a nota era lançada ou
// ignorada nas Notas de entrada e a pendência ficava para sempre (dono, 2026-09-24). Ao carregar,
// a que aponta para nota que já saiu de "A conferir" é dada como resolvida e sai da lista.
async function fecharRecebimentosResolvidos(lista: PendenciaChat[]): Promise<PendenciaChat[]> {
  const docs = lista.filter((p) => p.kind === 'recebimento_parado' && notaDa(p));
  if (!docs.length) return lista;
  const { data } = await supabase.from('fiscal_inbound_documents').select('id, status').in('id', docs.map((p) => notaDa(p) as string));
  const feitas = new Set(((data ?? []) as Array<{ id: string; status: string }>).filter((d) => d.status !== 'new').map((d) => d.id));
  if (!feitas.size) return lista;
  const fechar = docs.filter((p) => feitas.has(notaDa(p) as string));
  await Promise.all(fechar.map((p) => supabase.rpc('fn_pendencia_marcar', { p_id: p.id, p_acao: 'resolvida', p_motivo: 'nota já conferida' })));
  const ids = new Set(fechar.map((p) => p.id));
  return lista.filter((p) => !ids.has(p.id));
}

// Data e hora de chegada de cada pendência (dono, 2026-09-24): "24/09 · 14:32" + "há 3 h".
const dataHora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};
const idadeMin = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
const idade = (iso: string) => {
  const m = idadeMin(iso);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  if (m < 1440) return `há ${Math.floor(m / 60)} h`;
  const d = Math.floor(m / 1440);
  return `há ${d} dia${d > 1 ? 's' : ''}`;
};
// Esperando há mais de 1 dia fica âmbar; mais de 3, vermelho — o que envelhece salta aos olhos.
const corIdade = (iso: string) => {
  const m = idadeMin(iso);
  return m >= 3 * 1440 ? 'bg-red-50 text-red-700 border-red-200' : m >= 1440 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-zinc-50 text-zinc-500 border-zinc-200';
};
const chaveDia = (iso: string) => new Date(iso).toDateString();
const rotuloDia = (iso: string) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Hoje';
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'Ontem';
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

interface Props {
  call: Call;
  /** Usuário logado: "minhas" tarefas vencidas (criei ou sou o responsável), como no cron. */
  meuId: string | null;
  onFechar: () => void;
  /** Muda quando algo lá fora pode ter fechado uma pendência (pagamento feito, cancelado). */
  versao: number;
  /** Algo mudou aqui (ciente, descarte, pagamento): o botão do chat reconta. */
  onMudou?: () => void;
  onPagar: (p: PendenciaChat) => Promise<void>;
  /** Conta paga pelo cartão (conta atrasada): o pagamento preparado vai para o chat e pede o PIN. */
  onPagarConta?: (billId: string) => Promise<void>;
  onAbrir: (p: PendenciaChat) => void;
  onPedir: (texto: string) => void;
  onVerMensagem: (p: PendenciaChat) => Promise<void>;
  onAbrirTarefa: (tenantId: string, taskId: string) => void;
}

export default function PendenciasChat({ call, meuId, onFechar, versao, onMudou, onPagar, onPagarConta, onAbrir, onPedir, onVerMensagem, onAbrirTarefa }: Props) {
  // Cartão aberto para resolver ali mesmo (classificar, ver tarefas). Um por vez.
  const [expandida, setExpandida] = useState<string | null>(null);
  // Filtro por loja (dono atende mais de uma, 2026-09-18). '' = todas. Lembrado neste aparelho.
  const [loja, setLoja] = useState<string>(() => { try { return localStorage.getItem(FILTRO_KEY) ?? ''; } catch { return ''; } });
  // Minhas tarefas abrem por cima da lista (cartão no topo), não como mais uma "aba" de loja.
  const [verTarefasTela, setVerTarefas] = useState(false);
  // Agrupar por chegada (dia a dia) ou por tipo (dono, 2026-09-24). Lembrado neste aparelho.
  const [agrupar, setAgrupar] = useState<'chegada' | 'tipo'>(() => { try { return localStorage.getItem(AGRUPAR_KEY) === 'tipo' ? 'tipo' : 'chegada'; } catch { return 'chegada'; } });
  // Por tipo, os grupos começam FECHADOS (dono, 2026-09-24): primeiro o panorama, depois abre o que quer.
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const escolherAgrupar = (a: 'chegada' | 'tipo') => { setAgrupar(a); setAbertos(new Set()); try { localStorage.setItem(AGRUPAR_KEY, a); } catch { /* sem storage */ } };
  const alternarGrupo = (g: string) => setAbertos((f) => { const n = new Set(f); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const [ignorarDe, setIgnorarDe] = useState<string | null>(null);
  const escolherLoja = (id: string) => { setLoja(id); try { localStorage.setItem(FILTRO_KEY, id); } catch { /* sem storage */ } };
  const [lista, setLista] = useState<PendenciaChat[] | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [motivoDe, setMotivoDe] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  // Ordem de chegada: mais antiga primeiro (fila) ou mais nova primeiro. Lembrada neste aparelho.
  const [ordem, setOrdem] = useState<'antigas' | 'novas'>(() => { try { return localStorage.getItem(ORDEM_KEY) === 'novas' ? 'novas' : 'antigas'; } catch { return 'antigas'; } });
  const trocarOrdem = () => { const o = ordem === 'antigas' ? 'novas' : 'antigas'; setOrdem(o); try { localStorage.setItem(ORDEM_KEY, o); } catch { /* sem storage */ } };

  const [nTarefas, setNTarefas] = useState(0);
  // Pendência de pagamento: para quem vai e se a mercadoria já chegou (assistente-app, dono 2026-09-18)
  const [infoPag, setInfoPag] = useState<Record<string, InfoPagamento>>({});
  const recarregar = useCallback(async () => {
    try {
      const l = await carregarPendenciasChat();
      setLista(l);
      const ids = l.filter((p) => p.kind === 'pagamento_grupo' || p.kind === 'pagamento_pendente').map((p) => p.id);
      if (ids.length) call<{ info: Record<string, InfoPagamento> }>('pendencias_pagamento_info', { ids }).then((r) => setInfoPag(r.info ?? {})).catch(() => {});
    } catch { setLista((l) => l ?? []); }
    try { setNTarefas((await minhasTarefasPendentes(meuId)).length); } catch { /* aba some */ }
  }, [meuId, call]);

  useEffect(() => {
    recarregar();
    const t = setInterval(() => { if (!document.hidden) recarregar(); }, 30000);
    return () => clearInterval(t);
  }, [recarregar, versao]);

  const marcar = async (p: PendenciaChat, acao: 'vista' | 'descartada' | 'resolvida', m?: string) => {
    setOcupada(p.id);
    // "Não vou fazer" num pagamento = não vou pagar: PRIMEIRO cancela os Pix preparados (senão os cartões
    // seguiam no rodapé esperando "Pagar" — dono, 2026-09-20) e só fecha a pendência se deu certo. Antes
    // fechava primeiro e, se o Pix já tinha ido ao Inter, ele sumia da caixa e ainda podia ser aprovado
    // (auditoria 2026-09-24).
    if (acao === 'descartada' && ['pagamento_grupo', 'pagamento_pendente'].includes(p.kind)) {
      try {
        const r = await call<{ cancelados: number; erros?: string[] }>('pendencia_recusar', { id: p.id });
        if (r.erros?.length) {
          setErros((e) => ({ ...e, [p.id]: `Não consegui cancelar: ${r.erros?.join(' · ')}. A pendência continua aberta.` }));
          setOcupada(null); return;
        }
      } catch (e) {
        setErros((x) => ({ ...x, [p.id]: e instanceof Error ? e.message : String(e) }));
        setOcupada(null); return;
      }
    }
    const { error } = await supabase.rpc('fn_pendencia_marcar', { p_id: p.id, p_acao: acao, p_motivo: m ?? null });
    if (error) setErros((e) => ({ ...e, [p.id]: error.message }));
    else { setMotivoDe(null); setMotivo(''); await recarregar(); onMudou?.(); }
    setOcupada(null);
  };

  const pagar = async (p: PendenciaChat) => {
    setOcupada(p.id);
    setErros((e) => { const n = { ...e }; delete n[p.id]; return n; });
    try { await onPagar(p); await recarregar(); onMudou?.(); }
    catch (e) { setErros((x) => ({ ...x, [p.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setOcupada(null); }
  };

  // Pedido de pagamento (dono, 2026-09-24): aprovar ali mesmo e já seguir para o Pix. Aprovar gera a
  // conta a pagar e o Edge prepara o Pix (pendência 'pagamento_pendente'); aí é o mesmo Pagar com PIN
  // dos pagamentos do grupo. Se o Pix não foi preparado (sem chave, trava do Pix), fica o aviso.
  const aprovarEPagar = async (p: PendenciaChat, soPreparar = false) => {
    const pedido = pedidoDa(p);
    if (!pedido) return;
    setOcupada(p.id);
    setErros((e) => { const n = { ...e }; delete n[p.id]; return n; });
    try {
      const { data, erro } = await chamarPedidos<{ pagamento?: { preparado: boolean; motivo?: string; aviso?: string } }>(soPreparar ? 'preparar_pagamento' : 'aprovar', p.tenantId, { id: pedido });
      if (erro) throw new Error(erro);
      if (!data?.pagamento?.preparado) {
        await recarregar(); onMudou?.();
        // O servidor diz o que fazer: "já em andamento"/"já pago" não são para pagar pelo banco.
        // O cartão do pedido some ao aprovar: o aviso vai para a faixa do topo, não para o cartão.
        setAvisoTopo(`${soPreparar ? '' : 'Aprovado. '}${data?.pagamento?.aviso ?? `O Pix não foi preparado: ${data?.pagamento?.motivo ?? 'sem resposta'}.`}`);
        return;
      }
      const { data: pend } = await supabase.from('pendencias').select('id')
        .eq('tenant_id', p.tenantId).eq('kind', 'pagamento_pendente').in('status', ['aberta', 'vista'])
        .eq('payload->>pedido_id', pedido).order('criada_em', { ascending: false }).limit(1).maybeSingle();
      if (!pend) { await recarregar(); onMudou?.(); return; }
      await onPagar({ ...p, id: pend.id, kind: 'pagamento_pendente' });
      await recarregar(); onMudou?.();
    } catch (e) {
      setErros((x) => ({ ...x, [p.id]: e instanceof Error ? e.message : String(e) }));
      await recarregar();
    } finally { setOcupada(null); }
  };

  // Ação direta no servidor (assistente-app › pendencia_acao) e fecha o cartão.
  const acaoDireta = async (p: PendenciaChat, acao: string) => {
    setOcupada(p.id);
    setErros((e) => { const n = { ...e }; delete n[p.id]; return n; });
    try { await call('pendencia_acao', { id: p.id, acao }); await recarregar(); onMudou?.(); }
    catch (e) { setErros((x) => ({ ...x, [p.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setOcupada(null); setConfirmar(null); }
  };
  // Cartões com o texto aberto por inteiro (o resto fica em 3 linhas).
  const [textoAberto, setTextoAberto] = useState<Set<string>>(new Set());
  // Aviso que precisa sobreviver ao cartão (o pedido aprovado sai da lista).
  const [avisoTopo, setAvisoTopo] = useState<string | null>(null);
  // Mudança de dinheiro pede um segundo toque ("Confirmar?") no próprio botão.
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const depoisDeResolver = async (msg: string | null, p: PendenciaChat) => {
    setExpandida(null); await recarregar(); onMudou?.();
    if (msg) setErros((x) => ({ ...x, [p.id]: msg }));
  };

  // Recusar pedido: o motivo é obrigatório e a pessoa que pediu vê.
  const recusarPedido = async (p: PendenciaChat, m: string) => {
    const pedido = pedidoDa(p);
    if (!pedido) return;
    setOcupada(p.id);
    const { erro } = await chamarPedidos('recusar', p.tenantId, { id: pedido, motivo: m });
    if (erro) setErros((e) => ({ ...e, [p.id]: erro }));
    else { setMotivoDe(null); setMotivo(''); await recarregar(); onMudou?.(); }
    setOcupada(null);
  };

  // Remessa/devolução que não é compra: ignora a nota nas Notas de entrada e fecha a pendência.
  const ignorarNota = async (p: PendenciaChat) => {
    const doc = notaDa(p);
    if (!doc) return;
    setOcupada(p.id);
    const { data: r, error } = await invokeWithAuth<{ success?: boolean; error?: string }>('fiscal-inbound', {
      body: { tenant_id: p.tenantId, document_id: doc, action: 'ignore', reason: 'Não é compra (ignorada pela caixa de pendências)' },
    });
    const falha = error?.message ?? (r?.success ? null : r?.error ?? 'Sem resposta');
    if (falha) setErros((e) => ({ ...e, [p.id]: `Não consegui ignorar a nota: ${falha}` }));
    else {
      await supabase.rpc('fn_pendencia_marcar', { p_id: p.id, p_acao: 'resolvida', p_motivo: 'nota ignorada: não é compra' });
      setIgnorarDe(null); await recarregar(); onMudou?.();
    }
    setOcupada(null);
  };

  const verMensagem = async (p: PendenciaChat) => {
    setOcupada(p.id);
    try { await onVerMensagem(p); }
    catch (e) { setErros((x) => ({ ...x, [p.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setOcupada(null); }
  };

  const todas = lista ?? [];
  const lojas = [...new Map(todas.map((p) => [p.tenantId, p.loja || 'Loja'])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  // Loja escolhida que sumiu da lista (tudo resolvido lá): volta para Todas em vez de mostrar vazio.
  const verTarefas = verTarefasTela && nTarefas > 0;
  const filtro = lojas.some(([id]) => id === loja) ? loja : '';
  const cmp = (a: PendenciaChat, b: PendenciaChat) => (ordem === 'antigas' ? a.criadaEm.localeCompare(b.criadaEm) : b.criadaEm.localeCompare(a.criadaEm));
  const itens = (filtro ? todas.filter((p) => p.tenantId === filtro) : todas).slice().sort(cmp);
  const urgentes = itens.filter((p) => p.urgencia === 'alta').length;

  // Por tipo: um grupo por rótulo (os dois tipos de pagamento viram "Pagamento"), na ordem do
  // item mais antigo (ou mais novo) de cada grupo; dentro dele, a mesma ordem de chegada.
  const grupos = (() => {
    const m = new Map<string, PendenciaChat[]>();
    for (const p of itens) { const k = kindConfig(p.kind).label; m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()].map(([label, ps]) => ({ label, cfg: kindConfig(ps[0].kind), itens: ps }));
  })();

  const cartao = (p: PendenciaChat) => {
    const cfg = kindConfig(p.kind);
    const ehPagamento = p.kind === 'pagamento_grupo' || p.kind === 'pagamento_pendente';
    const ehRecebimento = p.kind === 'recebimento_parado' && !!notaDa(p);
    const ehPedido = p.kind === 'pedido_pagamento' && !!pedidoDa(p);
    const ehPedidoPagar = p.kind === 'pedido_pagamento_pagar' && !!pedidoDa(p);
    const direto = DIRETO.includes(p.kind);
    // Conta atrasada abre a aba certa: Financeiro › Contas Vencidas (a rota gravada era a de Contas a Pagar).
    if (p.kind === 'conta_atrasada') p = { ...p, rota: '/financeiro?tab=contas-vencidas' };
    const compraId = compraDa(p);
    const verCompra = compraId ? () => onAbrir({ ...p, rota: `/financeiro?tab=compras&foco=${encodeURIComponent(compraId)}` }) : null;
    const pedeConfirmar = (chave: string, fn: () => void) => () => { if (confirmar === `${p.id}:${chave}`) fn(); else setConfirmar(`${p.id}:${chave}`); };
    const confirmando = (chave: string) => confirmar === `${p.id}:${chave}`;
    const saiu = Number(p.payload?.valor_saiu ?? 0);
    const nota = Number(p.payload?.valor_nota ?? 0);
    // A frase do servidor é para quem pede; aqui o botão já diz o que acontece.
    const detalhe = ehPedido ? p.detalhe?.replace(/\s*Só vira conta a pagar depois de aprovado\.?/i, '') : p.detalhe;
    const busy = ocupada === p.id;
    return (
      <div key={p.id} data-pend={p.id}
        className={`rounded-2xl border bg-white px-3 py-2.5 text-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow ${p.urgencia === 'alta' ? 'border-red-200 border-l-4 border-l-red-500' : 'border-zinc-200'}`}>
        <div className="flex items-start gap-2.5">
          <span className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg ${cfg.corBg}`}>
            <i className={`${cfg.icone} ${cfg.corTexto} text-base`} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-tight">
              <span className={`font-bold ${cfg.corTexto}`}>{cfg.label}</span>
              {p.loja && <span className="text-zinc-500">· {p.loja}</span>}
              {p.urgencia === 'alta' && <span className="px-1.5 rounded bg-red-100 text-red-700 font-bold">Urgente</span>}
              {p.status === 'vista' && <span className="text-zinc-400"><i className="ri-eye-line" /> vista</span>}
            </p>
            <p data-titulo className="font-semibold text-zinc-900 leading-snug mt-0.5">{p.titulo}</p>
          </div>
          <div className="flex-shrink-0 text-right" title={`Chegou em ${new Date(p.criadaEm).toLocaleString('pt-BR')}`}>
            <p className="text-[11px] font-semibold text-zinc-600 whitespace-nowrap tabular-nums">{dataHora(p.criadaEm)}</p>
            <span className={`inline-block mt-0.5 px-1.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${corIdade(p.criadaEm)}`}>{idade(p.criadaEm)}</span>
          </div>
        </div>
        <div className="pl-[42px]">
          {ehPagamento && infoPag[p.id] && <LinhaPagamento info={infoPag[p.id]} />}
          {p.kind === 'sangria_valor_diferente' ? (
            // Saiu × nota lado a lado: o texto longo do servidor dizia o mesmo em três linhas.
            <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-1.5 text-center">
              <span><span className="block text-[10px] text-amber-800">Saiu do caixa</span><b className="text-xs text-zinc-900">{brl(saiu)}</b></span>
              <span><span className="block text-[10px] text-amber-800">Nota</span><b className="text-xs text-zinc-900">{brl(nota)}</b></span>
              <span><span className="block text-[10px] text-amber-800">Diferença</span><b className="text-xs text-amber-800">{brl(Math.abs(saiu - nota))}</b></span>
            </div>
          ) : detalhe && (
            // Texto longo cortado em 3 linhas: tocar abre o texto inteiro (dono, 2026-09-25: "não tem como ler").
            <button type="button" onClick={() => setTextoAberto((x) => { const n = new Set(x); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
              className="block w-full text-left cursor-pointer" aria-expanded={textoAberto.has(p.id)}>
              <span className={`block text-xs text-zinc-500 mt-1 whitespace-pre-wrap ${textoAberto.has(p.id) ? '' : 'line-clamp-3'}`}>{detalhe}</span>
              {detalhe.length > 140 && <span className="block text-[11px] font-semibold text-violet-700 mt-0.5">{textoAberto.has(p.id) ? 'Mostrar menos' : 'Ler tudo'}</span>}
            </button>
          )}
          {ONDE[p.kind] && <p className="mt-1 text-[11px] text-zinc-600"><i className="ri-map-pin-2-line text-zinc-400" /> <b className="font-semibold">Onde:</b> {ONDE[p.kind]}</p>}
          {['compra_pelo_celular', 'sangria_nao_saiu'].includes(p.kind) && compraId && <ResumoCompra call={call} pendId={p.id} />}
        </div>

        {erros[p.id] && (
          <div className="mt-2 rounded-xl bg-red-50 border border-red-100 px-2.5 py-2">
            <p className="text-xs text-red-700">{erros[p.id]}</p>
            {ehPagamento && (
              <button onClick={() => onPedir(`Sobre a pendência "${p.titulo}"${p.loja ? ` (${p.loja})` : ''}: `)} className="mt-1 text-xs font-bold text-violet-700 cursor-pointer">
                <i className="ri-chat-3-line" /> Pedir ao assistente
              </button>
            )}
          </div>
        )}

        {motivoDe === p.id ? (
          <form className="flex gap-1.5 mt-2.5" onSubmit={(e) => {
            e.preventDefault();
            const m = motivo.trim();
            if (!m) return;
            if (ehPedido) { if (m.length >= 3) recusarPedido(p, m); } else marcar(p, MOTIVO[p.kind]?.acao ?? 'descartada', m);
          }}>
            <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={ehPedido ? 'Motivo da recusa (a pessoa vai ver)' : MOTIVO[p.kind]?.placeholder ?? 'Por que não vai fazer?'}
              className="flex-1 min-w-0 h-9 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-400" />
            <button type="submit" disabled={busy || motivo.trim().length < (ehPedido ? 3 : 1)} className="px-3 h-9 rounded-xl bg-zinc-800 text-white text-xs font-bold disabled:opacity-40 cursor-pointer">OK</button>
            <button type="button" onClick={() => { setMotivoDe(null); setMotivo(''); }} className="px-2 h-9 rounded-xl text-zinc-400 cursor-pointer" aria-label="Cancelar"><i className="ri-close-line" /></button>
          </form>
        ) : ignorarDe === p.id ? (
          <div className="mt-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
            <p className="text-xs text-amber-900">Ignorar a nota? Ela sai de "A conferir" e a loja não recebe por ela no estoque. Use quando for remessa, devolução ou comodato — não compra.</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button onClick={() => ignorarNota(p)} disabled={busy} className={`${BOTAO} bg-amber-600 hover:bg-amber-500 text-white`}>{busy ? 'Ignorando…' : 'Ignorar a nota'}</button>
              <button onClick={() => setIgnorarDe(null)} disabled={busy} className={NEUTRO}>Voltar</button>
            </div>
          </div>
        ) : (
          // Botões baixos e numa linha só (dono, 2026-09-24: "grandes demais, desproporcionais"); se não
          // couberem no celular, quebram para a linha de baixo (flex-wrap) em vez de vazar.
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {ehPagamento && (
              <>
                <button onClick={() => pagar(p)} disabled={busy} className={p.kind === 'pagamento_grupo' ? `${PRINCIPAL}` : PRINCIPAL}>
                  {busy ? 'Preparando…' : <><i className="ri-check-line" /> Pagar</>}
                </button>
                {p.kind === 'pagamento_grupo' && (
                  <button onClick={() => verMensagem(p)} disabled={busy} className={SECUNDARIO}>
                    <i className="ri-chat-quote-line" /> Ver a mensagem
                  </button>
                )}
              </>
            )}
            {/* Pedido de pagamento (2026-09-24): decide aqui; aprovar já chama o Pix com PIN. */}
            {ehPedido && (
              <>
                <button onClick={() => aprovarEPagar(p)} disabled={busy} className={PRINCIPAL}>
                  {busy ? 'Aprovando…' : <><i className="ri-check-line" /> Aprovar e pagar</>}
                </button>
                <button onClick={() => { setMotivoDe(p.id); setMotivo(''); }} disabled={busy} className={NEUTRO}>
                  <i className="ri-close-line" /> Recusar
                </button>
                {p.rota && (
                  <button onClick={() => onAbrir(p)} disabled={busy} className={SECUNDARIO}>
                    <i className="ri-file-list-3-line" /> Ver pedido
                  </button>
                )}
              </>
            )}
            {ehPedidoPagar && (
              <>
                <button onClick={() => aprovarEPagar(p, true)} disabled={busy} className={PRINCIPAL}>
                  {busy ? 'Preparando…' : <><i className="ri-refresh-line" /> Preparar o Pix de novo</>}
                </button>
                <button onClick={() => marcar(p, 'resolvida', 'pago pelo app do banco')} disabled={busy} className={SECUNDARIO}>
                  <i className="ri-bank-line" /> Já paguei pelo banco
                </button>
              </>
            )}
            {/* Compra lançada pelo celular por quem não é do financeiro: confere e dá o ok. */}
            {p.kind === 'compra_pelo_celular' && (
              <>
                <button onClick={() => marcar(p, 'resolvida', 'compra conferida')} disabled={busy} className={PRINCIPAL}><i className="ri-check-line" /> Está certa</button>
                {verCompra && <button onClick={verCompra} disabled={busy} className={SECUNDARIO}><i className="ri-edit-line" /> Corrigir</button>}
              </>
            )}
            {/* Fornecedor pago em dinheiro do caixa sem cupom. */}
            {p.kind === 'sangria_sem_cupom' && (
              <>
                <button onClick={() => setExpandida((x) => (x === p.id ? null : p.id))} disabled={busy} className={expandida === p.id ? `${SECUNDARIO} bg-violet-100` : PRINCIPAL}>
                  <i className="ri-links-line" /> {expandida === p.id ? 'Fechar' : 'Ligar a uma compra'}
                </button>
                <button onClick={() => onPedir(`Cupom da sangria de ${brl(Number(p.payload?.valor ?? 0))}${p.loja ? ` (${p.loja})` : ''}: `)} disabled={busy} className={SECUNDARIO}>
                  <i className="ri-camera-line" /> Mandar o cupom
                </button>
                <button onClick={() => { setMotivoDe(p.id); setMotivo(''); }} disabled={busy} className={NEUTRO}>Não era compra</button>
              </>
            )}
            {/* Compra lançada paga em dinheiro, mas o dinheiro não saiu do caixa: de onde saiu? */}
            {p.kind === 'sangria_nao_saiu' && (
              <>
                <button onClick={pedeConfirmar('nao_paga', () => acaoDireta(p, 'nao_paga'))} disabled={busy} className={PRINCIPAL}>
                  <i className="ri-file-list-3-line" /> {confirmando('nao_paga') ? 'Confirmar: vira conta a pagar' : 'Ainda não foi paga'}
                </button>
                <button onClick={pedeConfirmar('pago_banco', () => acaoDireta(p, 'pago_banco'))} disabled={busy} className={SECUNDARIO}>
                  <i className="ri-bank-line" /> {confirmando('pago_banco') ? 'Confirmar: pago pelo banco' : 'Foi pago pelo banco'}
                </button>
                {verCompra && <button onClick={verCompra} disabled={busy} className={NEUTRO}>Ver compra</button>}
              </>
            )}
            {/* Saiu do caixa um valor diferente da nota. A compra paga não se edita pela tela (exclui e
                lança de novo): "Corrigir a compra" abre ela; "A nota está certa" fecha com a diferença anotada. */}
            {p.kind === 'sangria_valor_diferente' && (
              <>
                <button onClick={() => marcar(p, 'resolvida', `nota confere; diferença de ${brl(Math.abs(saiu - nota))} fica no caixa`)} disabled={busy} className={PRINCIPAL}>
                  <i className="ri-check-line" /> A nota está certa
                </button>
                {verCompra && <button onClick={verCompra} disabled={busy} className={SECUNDARIO}><i className="ri-edit-line" /> Corrigir a compra</button>}
              </>
            )}
            {/* Boleto que chegou por e-mail e não foi lançado sozinho (2026-09-25): ver o boleto e decidir ali. */}
            {p.kind === 'boleto_email' && (
              <button onClick={() => setExpandida((x) => (x === p.id ? null : p.id))} disabled={busy}
                className={expandida === p.id ? `${SECUNDARIO} bg-violet-100` : p.payload?.alerta ? `${BOTAO} bg-red-600 hover:bg-red-500 text-white` : PRINCIPAL}>
                <i className="ri-file-search-line" /> {expandida === p.id ? 'Fechar' : 'Ver o boleto e decidir'}
              </button>
            )}
            {/* Mercadoria chegou e a nota não estava no sistema. */}
            {p.kind === 'recebimento_sem_nota' && (
              <>
                <button onClick={() => setExpandida((x) => (x === p.id ? null : p.id))} disabled={busy} className={expandida === p.id ? `${SECUNDARIO} bg-violet-100` : PRINCIPAL}>
                  <i className="ri-search-line" /> {expandida === p.id ? 'Fechar' : 'Procurar a nota'}
                </button>
                <button onClick={() => { setMotivoDe(p.id); setMotivo(''); }} disabled={busy} className={NEUTRO}>Veio sem nota</button>
              </>
            )}
            {/* Recebimento parado (2026-09-24): "Abrir" levava à lista inteira de notas e não resolvia.
                Agora abre a PRÓPRIA nota já na conferência, ou ignora se não for compra. */}
            {ehRecebimento && (
              <>
                <button onClick={() => onAbrir({ ...p, rota: `/financeiro?tab=notas-entrada&nota=${encodeURIComponent(notaDa(p) as string)}` })}
                  className={`${PRINCIPAL}`}>
                  <i className="ri-file-check-line" /> Conferir e lançar a nota
                </button>
                <button onClick={() => setIgnorarDe(p.id)} disabled={busy} className={SECUNDARIO}>
                  <i className="ri-forbid-line" /> Não é compra
                </button>
              </>
            )}
            {RESOLVE_AQUI[p.kind] && (
              <button onClick={() => setExpandida((x) => (x === p.id ? null : p.id))}
                className={expandida === p.id ? `${SECUNDARIO} bg-violet-100` : `${PRINCIPAL}`}>
                <i className={RESOLVE_AQUI[p.kind].icone} /> {expandida === p.id ? 'Fechar' : RESOLVE_AQUI[p.kind].label}
              </button>
            )}
            {!ehPagamento && !ehRecebimento && !ehPedido && !direto && p.rota && (
              <button onClick={() => onAbrir(p)} className={RESOLVE_AQUI[p.kind] || ehPedidoPagar ? SECUNDARIO : PRINCIPAL}>
                <i className="ri-arrow-right-up-line" /> {RESOLVE_AQUI[p.kind] ? 'Abrir na tela' : 'Abrir'}
              </button>
            )}
            {ehPedido || direto ? null : !p.acaoRequerida ? (
              <button onClick={() => marcar(p, 'vista')} disabled={busy} className={NEUTRO}><i className="ri-check-line" /> OK</button>
            ) : (
              <button onClick={() => { setMotivoDe(p.id); setMotivo(''); }} disabled={busy} className={NEUTRO}>Não vou fazer</button>
            )}
          </div>
        )}

        {expandida === p.id && p.kind === 'conta_sem_dre' && (
          <ContasDreInline call={call} tenantId={p.tenantId} onFeito={() => onMudou?.()} onTudo={() => { setExpandida(null); recarregar(); onMudou?.(); }} />
        )}
        {expandida === p.id && p.kind === 'item_sem_classe' && (
          <ItensClassificarCard call={call} tenantId={p.tenantId} abertoInicial onFeito={() => onMudou?.()} onTudo={() => { setExpandida(null); recarregar(); onMudou?.(); }} />
        )}
        {expandida === p.id && p.kind === 'conta_atrasada' && (
          <ContasAtrasadasInline tenantId={p.tenantId} onPagarConta={onPagarConta}
            onAbrir={(billId) => onAbrir({ ...p, rota: `/financeiro?tab=contas-vencidas&foco=${encodeURIComponent(billId)}` })}
            onMudou={() => { recarregar(); onMudou?.(); }} />
        )}
        {expandida === p.id && p.kind === 'boleto_email' && !!p.payload?.mail_id && (
          <BoletoEmailDecisao tenantId={p.tenantId} mailId={String(p.payload.mail_id)} onFeito={(msg) => { setAvisoTopo(msg); depoisDeResolver(null, p); }} />
        )}
        {expandida === p.id && p.kind === 'sangria_sem_cupom' && <LigarSangria call={call} pendId={p.id} onFeito={(msg) => depoisDeResolver(msg, p)} />}
        {expandida === p.id && p.kind === 'recebimento_sem_nota' && (
          <ProcurarNota call={call} pendId={p.id} onAchou={(doc) => {
            setExpandida(null); recarregar(); onMudou?.();
            onAbrir({ ...p, rota: `/financeiro?tab=notas-entrada&nota=${encodeURIComponent(doc)}` });
          }} />
        )}
        {expandida === p.id && p.kind === 'tarefa_vencida' && (
          <TarefasPendencia tenantId={p.tenantId} meuId={meuId} onAbrir={onAbrirTarefa} />
        )}
      </div>
    );
  };

  const subtitulo = lista === null ? 'carregando…' : verTarefas
    ? `${nTarefas} ${nTarefas === 1 ? 'tarefa vencida ou para hoje' : 'tarefas vencidas ou para hoje'}`
    : `${itens.length === 1 ? '1 esperando você' : `${itens.length} esperando você`}${urgentes > 0 ? ` · ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : ''}`;

  return (
    <div data-sem-arrasto className="absolute inset-0 z-10 flex flex-col bg-zinc-50">
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        {verTarefas ? (
          <button onClick={() => setVerTarefas(false)} className="w-8 h-8 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Voltar às pendências">
            <i className="ri-arrow-left-line text-lg" />
          </button>
        ) : (
          <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-indigo-50 border border-indigo-200">
            <i className="ri-inbox-archive-line text-indigo-600" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">{verTarefas ? 'Minhas tarefas' : 'Pendências'}</p>
          <p className="text-[11px] text-zinc-400 leading-tight">{subtitulo}</p>
        </div>
        <button onClick={onFechar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar pendências">
          <i className="ri-close-line text-xl" />
        </button>
      </div>

      {!verTarefas && lista !== null && (todas.length > 0 || nTarefas > 0) && (
        <div className="px-3 py-2.5 border-b border-zinc-100 bg-white flex-shrink-0 space-y-2">
          {todas.length > 0 && (
          <div className="flex items-center gap-2">
            {lojas.length > 1 ? (
              <label className="relative flex-1 min-w-0">
                <i className="ri-store-2-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                <select value={filtro} onChange={(e) => escolherLoja(e.target.value)} aria-label="Loja"
                  className="w-full h-9 pl-9 pr-8 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700 appearance-none truncate cursor-pointer focus:outline-none focus:border-violet-400">
                  <option value="">Todas as lojas · {todas.length}</option>
                  {lojas.map(([id, nome]) => <option key={id} value={id}>{nome} · {todas.filter((p) => p.tenantId === id).length}</option>)}
                </select>
                <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              </label>
            ) : <span className="flex-1 min-w-0 text-xs font-semibold text-zinc-500 truncate"><i className="ri-store-2-line" /> {lojas[0]?.[1] ?? ''}</span>}
            <div className="flex p-0.5 rounded-xl bg-zinc-100 flex-shrink-0" role="group" aria-label="Agrupar">
              {([['chegada', 'ri-time-line', 'Chegada'], ['tipo', 'ri-stack-line', 'Tipo']] as const).map(([id, icone, nome]) => (
                <button key={id} onClick={() => escolherAgrupar(id)} aria-pressed={agrupar === id}
                  className={`h-8 px-2.5 flex items-center gap-1 rounded-[10px] text-xs font-bold cursor-pointer ${agrupar === id ? 'bg-white text-violet-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  <i className={icone} /> {nome}
                </button>
              ))}
            </div>
          </div>
          )}
          {itens.length > 1 && (
            <div className="flex items-center gap-2">
              {itens.length > 1 && (
              <button onClick={trocarOrdem} title="Ordem de chegada"
                className="h-7 px-2.5 flex items-center gap-1 rounded-lg text-xs font-semibold text-zinc-500 hover:bg-zinc-100 cursor-pointer whitespace-nowrap">
                <i className={ordem === 'antigas' ? 'ri-sort-asc' : 'ri-sort-desc'} />
                {ordem === 'antigas' ? 'Mais antigas primeiro' : 'Mais novas primeiro'}
              </button>
              )}
            </div>
          )}
        </div>
      )}

      {verTarefas ? (
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <p className="text-[11px] text-zinc-500 pt-3">Suas tarefas (criadas por você ou com você de responsável), de qualquer loja. Toque para mudar status, prazo ou comentar.</p>
          <TarefasPendencia meuId={meuId} onAbrir={onAbrirTarefa} onMudou={() => { recarregar(); onMudou?.(); }} />
        </div>
      ) : lista === null ? (
        <div className="mx-auto my-16 w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      ) : !itens.length && !nTarefas ? (
        <p className="text-sm text-zinc-400 text-center py-16"><i className="ri-check-double-line text-2xl block mb-1 text-emerald-500" />Nada pendente.</p>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {avisoTopo && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
              <i className="ri-information-line text-sm mt-px" />
              <p className="flex-1">{avisoTopo}</p>
              <button onClick={() => setAvisoTopo(null)} className="text-amber-700 cursor-pointer" aria-label="Fechar aviso"><i className="ri-close-line" /></button>
            </div>
          )}
          {/* Minhas tarefas (dono, 2026-09-25: o botão amarelo no topo destoava): uma linha da lista, com a
              mesma cara dos grupos por tipo — ícone, nome, quantas e a seta. */}
          {nTarefas > 0 && (
            <button onClick={() => setVerTarefas(true)}
              className="w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-left cursor-pointer hover:bg-zinc-100">
              <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg bg-amber-100"><i className="ri-task-line text-amber-700" /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-bold text-zinc-800 truncate">Minhas tarefas</span>
                <span className="block text-[11px] text-zinc-500 truncate">{nTarefas} tarefa{nTarefas > 1 ? 's' : ''} vencida{nTarefas > 1 ? 's' : ''} ou hoje</span>
              </span>
              <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center rounded-full bg-zinc-800 text-white text-[11px] font-bold">{nTarefas}</span>
              <i className="ri-arrow-right-s-line text-zinc-400" />
            </button>
          )}
          {!itens.length && <p className="text-sm text-zinc-400 text-center py-10"><i className="ri-check-double-line text-xl block mb-1 text-emerald-500" />Nenhuma pendência {filtro ? 'nesta loja' : ''}.</p>}
          {agrupar === 'chegada'
            ? itens.map((p, i) => (
              <div key={p.id}>
                {/* Separador por dia de chegada (Hoje / Ontem / Segunda-feira, 22/09). */}
                {(i === 0 || chaveDia(itens[i - 1].criadaEm) !== chaveDia(p.criadaEm)) && (
                  <div className={`flex items-center gap-2 pb-1 ${i === 0 ? '' : 'pt-2'}`}>
                    <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{rotuloDia(p.criadaEm)}</span>
                    <span className="flex-1 h-px bg-zinc-200" />
                  </div>
                )}
                {cartao(p)}
              </div>
            ))
            : grupos.map((g) => {
              const aberto = abertos.has(g.label);
              const velha = g.itens.reduce((m, p) => (p.criadaEm < m ? p.criadaEm : m), g.itens[0].criadaEm);
              return (
                <section key={g.label} className="space-y-2">
                  <button onClick={() => alternarGrupo(g.label)} aria-expanded={aberto}
                    className="w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-left cursor-pointer hover:bg-zinc-100">
                    <span className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg ${g.cfg.corBg}`}><i className={`${g.cfg.icone} ${g.cfg.corTexto}`} /></span>
                    <span className="flex-1 min-w-0 text-[13px] font-bold text-zinc-800 truncate">{g.label}</span>
                    <span className={`px-1.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${corIdade(velha)}`}>{idade(velha)}</span>
                    <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center rounded-full bg-zinc-800 text-white text-[11px] font-bold">{g.itens.length}</span>
                    <i className={`${aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-zinc-400`} />
                  </button>
                  {aberto && g.itens.map((p) => cartao(p))}
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}

interface InfoPagamento {
  para: string | null; valor: number | null; tipo: string | null;
  compra_lancada: boolean; recebido: boolean | null; recebido_em: string | null;
  guia?: string | null; // DAS/DARF/FGTS: "Guia de imposto — não é compra · vence dd/mm"
}

// Para quem vai (em destaque) e se a mercadoria já chegou — o que se confere antes de pagar.
function LinhaPagamento({ info }: { info: InfoPagamento }) {
  return (
    <div className="mt-1.5 rounded-lg bg-violet-50 border border-violet-100 px-2.5 py-1.5">
      <p className="text-xs text-zinc-800 break-words">
        {info.tipo === 'boleto' ? 'Boleto' : info.tipo === 'pix' ? 'Pix' : 'Pagar'}
        {info.valor ? <> de <b>{brl(info.valor)}</b></> : null} para{' '}
        <b className="font-bold text-violet-800">{info.para || 'destinatário não identificado'}</b>
      </p>
      {info.guia ? (
        <p className="text-[11px] font-semibold mt-0.5 text-zinc-600">
          <i className="ri-government-line" /> {info.guia}
        </p>
      ) : (
      <p className={`text-[11px] font-semibold mt-0.5 ${info.recebido ? 'text-emerald-700' : info.recebido === false ? 'text-amber-700' : 'text-zinc-500'}`}>
        <i className={info.recebido ? 'ri-checkbox-circle-line' : info.recebido === false ? 'ri-truck-line' : 'ri-question-line'} />{' '}
        {info.recebido
          ? `Mercadoria recebida${info.recebido_em ? ` em ${new Date(info.recebido_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}`
          : info.recebido === false ? 'Mercadoria ainda NÃO recebida' : 'Compra não lançada no ERPOS (recebimento não confirmado)'}
      </p>
      )}
    </div>
  );
}

const FILTRO_KEY = 'erpos.pendencias.loja';
const ORDEM_KEY = 'erpos.pendencias.ordem';
const AGRUPAR_KEY = 'erpos.pendencias.agrupar';
const BOTAO = 'flex-1 h-8 px-3 flex items-center justify-center gap-1 rounded-lg text-xs font-semibold whitespace-nowrap disabled:opacity-50 cursor-pointer';
const PRINCIPAL = `${BOTAO} bg-violet-600 hover:bg-violet-500 text-white`;
const SECUNDARIO = `${BOTAO} border border-violet-200 text-violet-700 hover:bg-violet-50`;
const NEUTRO = `${BOTAO} border border-zinc-200 text-zinc-500 hover:bg-zinc-50`;

// Tipos que dá para resolver no próprio cartão.
const RESOLVE_AQUI: Record<string, { label: string; icone: string }> = {
  conta_sem_dre: { label: 'Classificar aqui', icone: 'ri-pie-chart-line' },
  item_sem_classe: { label: 'Classificar aqui', icone: 'ri-price-tag-3-line' },
  tarefa_vencida: { label: 'Ver tarefas', icone: 'ri-task-line' },
  conta_atrasada: { label: 'Ver contas', icone: 'ri-file-list-3-line' },
};

const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

interface ContaSemDre { id: string; description: string; amount: number; due_date: string | null; supplier: string | null; category: string | null }
interface CategoriaDre { id: string; name: string; group_type: string }

// Contas sem categoria na DRE: escolhe a categoria e grava, uma por uma (assistente-app › conta_dre,
// mesma regra da enquete: só grava se a conta ainda estiver sem categoria).
function ContasDreInline({ call, tenantId, onFeito, onTudo }: { call: Call; tenantId: string; onFeito: () => void; onTudo: () => void }) {
  const [contas, setContas] = useState<ContaSemDre[] | null>(null);
  const [cats, setCats] = useState<CategoriaDre[]>([]);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [gravando, setGravando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    call<{ contas: ContaSemDre[]; categorias: CategoriaDre[] }>('contas_sem_dre', { tenant_id: tenantId })
      .then((r) => { setContas(r.contas); setCats(r.categorias); })
      .catch((e) => { setErro(e instanceof Error ? e.message : String(e)); setContas([]); });
  }, [call, tenantId]);

  const gravar = async (c: ContaSemDre) => {
    const cat = escolha[c.id];
    if (!cat) return;
    setGravando(c.id); setErro(null);
    try {
      await call('conta_dre', { tenant_id: tenantId, bill_id: c.id, dre_category_id: cat });
      const resto = (contas ?? []).filter((x) => x.id !== c.id);
      setContas(resto);
      onFeito();
      if (!resto.length) onTudo();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setGravando(null); }
  };

  if (contas === null) return <p className="mt-2.5 text-xs text-zinc-500">Carregando contas…</p>;
  const grupos = [...new Set(cats.map((c) => c.group_type))];
  return (
    <div className="mt-2.5 space-y-2">
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!contas.length && !erro && <p className="text-xs font-semibold text-emerald-700"><i className="ri-check-line" /> Nenhuma conta sem categoria.</p>}
      {contas.map((c) => (
        <div key={c.id} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-zinc-800 leading-snug">{c.description}</p>
          <p className="text-[11px] text-zinc-500">
            {brl(c.amount)}{c.due_date ? ` · vence ${data(c.due_date)}` : ''}{c.supplier ? ` · ${c.supplier}` : ''}
          </p>
          <div className="flex gap-1.5 mt-2">
            <select value={escolha[c.id] ?? ''} onChange={(e) => setEscolha((x) => ({ ...x, [c.id]: e.target.value }))}
              className="flex-1 min-w-0 h-9 px-2 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-violet-400">
              <option value="">Categoria da DRE…</option>
              {grupos.map((g) => (
                <optgroup key={g} label={GRUPO_DRE[g] ?? g}>
                  {cats.filter((x) => x.group_type === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </optgroup>
              ))}
            </select>
            <button onClick={() => gravar(c)} disabled={!escolha[c.id] || gravando === c.id}
              className="px-3 h-9 rounded-lg bg-violet-600 text-white text-sm font-bold disabled:opacity-40 cursor-pointer">
              {gravando === c.id ? '…' : 'OK'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
const GRUPO_DRE: Record<string, string> = { cost: 'Custos', expense: 'Despesas' };

interface ContaAtrasada {
  id: string; description: string; supplier: string | null; amount: number; paid_amount: number | null; due_date: string;
  dre_category_id: string | null; reference_type: string | null; boleto_digitavel: string | null; boleto_pix_copia: string | null;
}

// Contas atrasadas da loja, mais antiga primeiro, com quantos dias de atraso. Leitura direta: a RLS
// de fin_accounts_payable libera SELECT a membro da loja (20260912070000_fin_select_membership).
// Ação em cada conta (dono, 2026-09-25): Pagar (boleto/Pix guardado → Inter → PIN), Dar baixa (já pagou
// por fora — mesmo pay_bill da aba Contas Vencidas) e Abrir (a conta em Contas Vencidas).
function ContasAtrasadasInline({ tenantId, onPagarConta, onAbrir, onMudou }: {
  tenantId: string;
  onPagarConta?: (billId: string) => Promise<void>;
  onAbrir: (billId: string) => void;
  onMudou: () => void;
}) {
  const [contas, setContas] = useState<ContaAtrasada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixaDe, setBaixaDe] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [errosConta, setErrosConta] = useState<Record<string, string>>({});
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const carregar = useCallback(() => {
    supabase.from('fin_accounts_payable').select('id, description, supplier, amount, paid_amount, due_date, dre_category_id, reference_type, boleto_digitavel, boleto_pix_copia')
      .eq('tenant_id', tenantId).not('status', 'in', '(paid,cancelled)').lt('due_date', hoje)
      .order('due_date', { ascending: true }).limit(100)
      .then(({ data: d, error }) => { if (error) setErro(error.message); setContas((d as ContaAtrasada[]) ?? []); });
  }, [tenantId, hoje]);
  useEffect(() => { carregar(); }, [carregar]);

  const pagar = async (c: ContaAtrasada) => {
    if (!onPagarConta) return;
    setOcupada(c.id); setErrosConta((e) => { const n = { ...e }; delete n[c.id]; return n; });
    try { await onPagarConta(c.id); }
    catch (e) { setErrosConta((x) => ({ ...x, [c.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setOcupada(null); }
  };

  if (contas === null) return <p className="mt-2.5 text-xs text-zinc-500">Carregando contas…</p>;
  const agora = Date.now();
  return (
    <div className="mt-2.5 space-y-1.5">
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!contas.length && !erro && <p className="text-xs font-semibold text-emerald-700"><i className="ri-check-line" /> Nenhuma conta atrasada.</p>}
      {contas.map((c) => {
        const dias = Math.max(1, Math.floor((agora - new Date(`${c.due_date}T12:00:00-03:00`).getTime()) / 86400000));
        const saldo = Number(c.amount) - Number(c.paid_amount ?? 0);
        const temBoleto = !!(c.boleto_digitavel || c.boleto_pix_copia);
        return (
          <div key={c.id} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-zinc-800 break-words leading-snug">{c.supplier || c.description}</p>
                {c.supplier && c.description && c.description !== c.supplier && <p className="text-[11px] text-zinc-500 break-words">{c.description}</p>}
                <p className="text-[11px] text-red-600 mt-0.5">venceu {data(c.due_date)} · {dias} dia{dias > 1 ? 's' : ''}</p>
              </div>
              <span className="text-[13px] font-bold text-zinc-900 tabular-nums whitespace-nowrap">{brl(saldo)}</span>
            </div>
            {errosConta[c.id] && <p className="mt-1.5 text-[11px] text-red-600">{errosConta[c.id]}</p>}
            {baixaDe === c.id ? (
              <BaixaConta conta={c} tenantId={tenantId} saldo={saldo} hoje={hoje}
                onCancelar={() => setBaixaDe(null)}
                onFeito={() => { setBaixaDe(null); carregar(); onMudou(); }} />
            ) : (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {temBoleto && onPagarConta && (
                  <button onClick={() => pagar(c)} disabled={!!ocupada} className={PRINCIPAL}>
                    {ocupada === c.id ? 'Preparando…' : <><i className="ri-bank-card-line" /> Pagar {c.boleto_digitavel ? 'boleto' : 'Pix'}</>}
                  </button>
                )}
                <button onClick={() => setBaixaDe(c.id)} disabled={!!ocupada} className={temBoleto ? SECUNDARIO : PRINCIPAL}>
                  <i className="ri-check-double-line" /> Já paguei — dar baixa
                </button>
                <button onClick={() => onAbrir(c.id)} disabled={!!ocupada} className={NEUTRO}>Abrir</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Baixa de conta paga por fora: mesmo caminho do "Pagar" da aba Contas Vencidas (financial-write ›
// pay_bill — lança a despesa, debita o banco, gera a próxima recorrente). Classificação DRE obrigatória
// quando a conta não tem (regra do dono, 2026-09-12).
function BaixaConta({ conta, tenantId, saldo, hoje, onCancelar, onFeito }: {
  conta: ContaAtrasada; tenantId: string; saldo: number; hoje: string; onCancelar: () => void; onFeito: () => void;
}) {
  const [valor, setValor] = useState(saldo.toFixed(2));
  const [dia, setDia] = useState(hoje);
  const [forma, setForma] = useState('Pix');
  const [dre, setDre] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { toPayload } = useDreEscolha();
  const precisaDre = precisaClassificarDRE(conta);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(valor.replace(',', '.'));
    if (!(v > 0)) { setErro('Informe o valor pago.'); return; }
    if (precisaDre && !dre) { setErro('Escolha a classificação DRE.'); return; }
    setSalvando(true); setErro(null);
    const { data: r, error } = await invokeWithAuth<{ error?: string }>('financial-write', {
      body: { action: 'pay_bill', tenant_id: tenantId, payload: { id: conta.id, paid_date: dia, paid_amount: v, payment_method: forma, ...(precisaDre ? toPayload(dre) ?? {} : {}) } },
    });
    const falha = error?.message ?? r?.error ?? null;
    setSalvando(false);
    if (falha) setErro(String(falha)); else onFeito();
  };
  const campo = 'h-8 px-2 rounded-lg border border-zinc-200 bg-white text-xs focus:outline-none focus:border-violet-400';
  return (
    <form onSubmit={salvar} className="mt-2 space-y-2 rounded-lg bg-white border border-zinc-200 p-2.5">
      <div className="grid grid-cols-3 gap-1.5">
        <label className="text-[10px] text-zinc-500">Valor pago
          <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className={`${campo} w-full mt-0.5`} />
        </label>
        <label className="text-[10px] text-zinc-500">Pago em
          <input type="date" value={dia} max={hoje} onChange={(e) => setDia(e.target.value)} className={`${campo} w-full mt-0.5`} />
        </label>
        <label className="text-[10px] text-zinc-500">Como
          <select value={forma} onChange={(e) => setForma(e.target.value)} className={`${campo} w-full mt-0.5`}>
            {['Pix', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão'].map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
      </div>
      {precisaDre && <DreClassificacaoSelect value={dre} onChange={setDre} categorias={[]} />}
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
      <div className="flex gap-1.5">
        <button type="submit" disabled={salvando} className={PRINCIPAL}>{salvando ? 'Salvando…' : <><i className="ri-check-line" /> Confirmar baixa</>}</button>
        <button type="button" onClick={onCancelar} disabled={salvando} className={NEUTRO}>Cancelar</button>
      </div>
    </form>
  );
}
