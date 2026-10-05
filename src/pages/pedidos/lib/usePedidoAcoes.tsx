import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useKDS } from '@/contexts/KDSContext';
import { useImpressoras } from '@/contexts/ImpressorasContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { usePermissoes } from '@/hooks/usePermissoes';
import { rotaForcada } from '@/lib/acessoRota';
import { ehCancelado, numeroCurto } from '@/lib/pedidosRegras';
import type { PedidoRecente, PagamentoPedido } from '@/types/pdv';
import type { KDSPedido } from '@/types/kds';
import PagamentoRapidoModal from '@/components/feature/PagamentoRapidoModal';
import CancelamentoModal from '@/components/feature/CancelamentoModal';
import AutorizacaoGerenteModal from '@/components/feature/AutorizacaoGerenteModal';
import CortesiaDetalhesModal from '@/pages/pdv/caixa/components/CortesiaDetalhesModal';
import ImprimirPedidoModal from '@/pages/pdv/caixa/components/ImprimirPedidoModal';
import { Folha } from '@/components/kit';
import { btn } from '@/components/kit';
import { reprintPedidoGestor } from '@/pages/gestor-pedidos/lib/printPedido';
import { abrirWhatsApp } from '@/pages/clientes/clienteUtils';
import { destinoStr } from './conversores';
import { imprimirResumo } from './imprimirResumo';
import { recenteParaKds } from './recenteParaKds';
import { ehGrupo, itensAtivos, moedaTexto, rotuloNumero, textoWhatsapp, totalRecebido } from './textoPedido';
import type { AcoesPedido, TipoImpressao } from './acoesTipos';

// Ações sobre um pedido da tela Pedidos (contrato em acoesTipos.ts). Nada aqui inventa caminho no
// servidor: cada ação usa o mesmo que o Caixa ou o Gestor de pedidos já usa:
//   cobrar     → PagamentoRapidoModal (order-write record_payment), igual ao PedidosRecentesPanel do caixa
//   cortesia   → AutorizacaoGerenteModal + CortesiaDetalhesModal + RPC fn_cortesia_marcar_pedido (igual ao modal acima)
//   cancelar   → CancelamentoModal (fn_cancel_order_bypass / fn_cancel_and_refund_order)
//   imprimir   → reprintPedidoGestor (cozinha), ImprimirPedidoModal do caixa (cliente), imprimirResumo (resumo)
//   entregar   → order-write update_order_item_status 'entregue' item a item (o que o Gestor dispara no "Entregar")

interface TurnoFechado {
  p: PedidoRecente;
  /** Caixa aberto mais recente da loja (onde dá para receber agora). */
  caixaAberto: { id: string; abertoEm: string } | null;
  /** Pedido sem turno gravado (nunca esteve ligado a um caixa): muda só o texto da folha. */
  semTurno: boolean;
}
interface Pagando { p: PedidoRecente }
interface Cancelando { p: PedidoRecente; pagamentos: PagamentoPedido[] }
interface Cortesia { p: PedidoRecente; etapa: 'autorizar' | 'detalhes'; autor: string | null }

const erroTexto = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string') return (e as { message: string }).message;
  return String(e);
};
const horaBR = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Pagamentos não estornados do pedido, lidos agora (a lista da tela pode estar atrasada). Mesma leitura do Gestor. */
async function lerPagamentosAtivos(tenantId: string, orderId: string): Promise<PagamentoPedido[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('id, amount, change_amount, is_refunded, operator_name, payment_methods ( name, type )')
    .eq('tenant_id', tenantId)
    .eq('order_id', orderId)
    .eq('is_refunded', false);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<{
    id: string; amount: number; change_amount: number | null; is_refunded: boolean; operator_name: string | null;
    payment_methods: { name: string | null; type: string | null } | { name: string | null; type: string | null }[] | null;
  }>).map((pg) => {
    const pm = Array.isArray(pg.payment_methods) ? pg.payment_methods[0] : pg.payment_methods;
    return {
      id: pg.id,
      amount: Number(pg.amount ?? 0),
      change_amount: Number(pg.change_amount ?? 0),
      is_refunded: pg.is_refunded,
      payment_method_name: pm?.name ?? null,
      payment_method_type: pm?.type ?? null,
      operator_name: pg.operator_name,
    } as PagamentoPedido;
  });
}

/** Cortesia zera o pedido sem passar pelo caixa: antes de gravar, confere de novo que ele não foi pago nem cancelado. */
async function motivoParaNaoZerar(tenantId: string, orderId: string): Promise<string | null> {
  const { data: o, error: eo } = await supabase.from('orders').select('is_paid, status').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
  if (eo) return `Não consegui conferir o pedido (${eo.message}).`;
  if (!o) return 'Não encontrei o pedido.';
  if (o.status === 'cancelled') return 'Esse pedido foi cancelado.';
  if (o.is_paid) return 'Esse pedido já foi pago.';
  const { data: pg, error: ep } = await supabase.from('payments').select('id').eq('tenant_id', tenantId).eq('order_id', orderId).eq('is_refunded', false).limit(1);
  if (ep) return `Não consegui conferir os pagamentos (${ep.message}).`;
  if ((pg ?? []).length > 0) return 'Esse pedido já recebeu pagamento.';
  return null;
}

/** Marca como entregue os itens que faltam do pedido: o mesmo update_order_item_status que o Gestor dispara no "Entregar". */
async function entregarPedido(tenantId: string, orderId: string): Promise<void> {
  const { data, error } = await supabase.from('order_items').select('id, status').eq('order_id', orderId).eq('tenant_id', tenantId);
  if (error) throw new Error(`Não consegui ler os itens (${error.message})`);
  const pendentes = ((data ?? []) as { id: string; status: string | null }[]).filter((i) => i.status !== 'delivered' && i.status !== 'cancelled');
  if (pendentes.length === 0) throw new Error('Esse pedido não tem item pendente para entregar.');
  for (const item of pendentes) {
    const { error: erroItem } = await invokeWithAuth('order-write', {
      body: { action: 'update_order_item_status', order_item_id: item.id, order_id: orderId, tenant_id: tenantId, status: 'entregue' },
    });
    if (erroItem) throw new Error(erroItem.message || 'Falha ao marcar o item como entregue.');
  }
}

export function usePedidoAcoes(opts: { onMudou: () => void }): { acoes: AcoesPedido; elementos: ReactNode } {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const { settings } = useSystemSettings();
  const { success: toastOk, error: toastErro, info: toastInfo, warning: toastAviso } = useToast();
  const { pedidos: kdsPedidos, setPedidos: setKdsPedidos, reloadOrders, fetchSessionOrdersFull } = useKDS();
  const { mapaEstacoes, getImpressoraParaEstacao } = useImpressoras();

  const tenantId = user?.tenantId ?? '';

  // Quem tem acesso ao caixa: não existe chave de permissão do PDV Caixa. A regra é a do menu lateral
  // (Sidebar): papel não preso a outra área e terminal "Caixa" ligado na loja.
  const podeCobrar = !!user && !rotaForcada(user.perfil, '/pdv/caixa') && settings.pdv_config.caixa !== false;
  const podeCancelar = hasPermissao('pdv_cancelar_pedido');
  const podeEntregar = hasPermissao('gestor_pedidos_entregar');
  const podeAbrirGestor = hasPermissao('gestor_pedidos_acessar');

  // O que muda a cada render mas só é lido na hora do clique fica numa ref (as ações continuam estáveis).
  const vivo = useRef({ kdsPedidos, mapaEstacoes, getImpressoraParaEstacao, nomeLoja: user?.loja ?? '', reloadOrders, fetchSessionOrdersFull });
  vivo.current = { kdsPedidos, mapaEstacoes, getImpressoraParaEstacao, nomeLoja: user?.loja ?? '', reloadOrders, fetchSessionOrdersFull };
  const onMudouRef = useRef(opts.onMudou);
  onMudouRef.current = opts.onMudou;

  const [turnoFechado, setTurnoFechado] = useState<TurnoFechado | null>(null);
  const [pagando, setPagando] = useState<Pagando | null>(null);
  const [cancelando, setCancelando] = useState<Cancelando | null>(null);
  const [cortesia, setCortesia] = useState<Cortesia | null>(null);
  const [imprimindoCliente, setImprimindoCliente] = useState<PedidoRecente | null>(null);
  const conferindoRef = useRef(false);
  const gravandoCortesiaRef = useRef(false);

  // ── cancelar ──────────────────────────────────────────────────────────────
  const cancelar = useCallback((p: PedidoRecente) => {
    void (async () => {
      if (!podeCancelar) { toastErro('Sem permissão', 'Seu perfil não pode cancelar pedidos.'); return; }
      if (ehGrupo(p)) { toastInfo('Pedidos pagos juntos', 'Cancele cada pedido separadamente.'); return; }
      if (ehCancelado(p)) { toastInfo('Já está cancelado', `O pedido ${rotuloNumero(p)} já foi cancelado.`); return; }
      if (!tenantId) return;
      if (conferindoRef.current) return;
      conferindoRef.current = true;
      try {
        // Sem conferir os pagamentos não abre: cancelar sem estorno um pedido que já recebeu deixaria o dinheiro solto.
        const pagamentos = await lerPagamentosAtivos(tenantId, p.id);
        setTurnoFechado(null);
        setCancelando({ p, pagamentos });
      } catch (e) {
        toastErro('Não consegui conferir os pagamentos', `${erroTexto(e)} Tente de novo: não cancelo sem conferir, para não deixar dinheiro sem estorno.`);
      } finally {
        conferindoRef.current = false;
      }
    })();
  }, [podeCancelar, tenantId, toastErro, toastInfo]);

  // ── cobrar ────────────────────────────────────────────────────────────────
  const cobrar = useCallback((p: PedidoRecente) => {
    void (async () => {
      if (!podeCobrar) { toastErro('Sem acesso ao caixa', 'Seu perfil não recebe pedidos pelo caixa.'); return; }
      if (ehGrupo(p)) { toastInfo('Pedidos pagos juntos', 'Esses pedidos já foram pagos em conjunto.'); return; }
      if (ehCancelado(p)) { toastInfo('Pedido cancelado', `O pedido ${rotuloNumero(p)} foi cancelado: não há o que receber.`); return; }
      if (p.pago) { toastInfo('Já está pago', `O pedido ${rotuloNumero(p)} já foi pago.`); return; }
      if (!(p.total > 0)) { toastInfo('Nada a receber', `O pedido ${rotuloNumero(p)} está com valor zero.`); return; }
      const jaRecebido = totalRecebido(p.pagamentos);
      if (jaRecebido > 0.009) {
        // O recebimento rápido cobra o total do pedido: com pagamento parcial cobraria de novo o que já entrou.
        toastAviso('Pagamento parcial', `Esse pedido já recebeu ${moedaTexto(jaRecebido)}. Receba o resto pelo caixa (PDV).`);
        return;
      }
      if (!tenantId) return;
      if (conferindoRef.current) return;
      conferindoRef.current = true;
      try {
        // Relê o pedido: fora do "ao vivo" a lista não atualiza — cobrar com total velho (item cancelado,
        // pagamento que entrou em outra tela) inflaria caixa e receita.
        const { data: atual, error: erroPedido } = await supabase
          .from('orders')
          .select('total_amount, is_paid, status')
          .eq('id', p.id)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        if (erroPedido || !atual) { toastErro('Não consegui conferir o pedido', erroPedido?.message ?? 'Pedido não encontrado.'); return; }
        if (atual.status === 'cancelled') { toastInfo('Pedido cancelado', `O pedido ${rotuloNumero(p)} foi cancelado: não há o que receber.`); onMudouRef.current(); return; }
        if (atual.is_paid) { toastInfo('Já está pago', `O pedido ${rotuloNumero(p)} já foi pago em outro lugar.`); onMudouRef.current(); return; }
        const pedidoAtual: PedidoRecente = { ...p, total: Number(atual.total_amount) || 0 };
        if (!(pedidoAtual.total > 0)) { toastInfo('Nada a receber', `O pedido ${rotuloNumero(p)} está com valor zero.`); return; }
        const jaNoBanco = await lerPagamentosAtivos(tenantId, p.id);
        if (jaNoBanco.length > 0) { toastAviso('Pagamento parcial', `Esse pedido já recebeu parte do valor. Receba o resto pelo caixa (PDV).`); onMudouRef.current(); return; }
        // O servidor só grava o pagamento com caixa aberto: o do body (se aberto e da loja) ou o caixa aberto da
        // sessão do pedido. Confere antes para não deixar a pessoa preencher tudo e só descobrir no fim.
        const { data, error } = await supabase
          .from('cash_registers')
          .select('id, session_id, opened_at')
          .eq('tenant_id', tenantId)
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(20);
        if (error) { toastErro('Não consegui conferir o caixa', error.message); return; }
        const abertos = (data ?? []) as { id: string; session_id: string | null; opened_at: string }[];
        const doTurno = p.session_id ? abertos.find((c) => c.session_id === p.session_id) : undefined;
        if (doTurno) { setPagando({ p: pedidoAtual }); return; }
        // Turno do pedido fechado: só cortesia ou cancelar. Receber no caixa de outro turno está desligado de
        // propósito — o relatório do caixa por turno junta o pagamento pelo turno do PEDIDO e o turno fechado
        // passaria a mostrar um dinheiro que não entrou nele (revisão de 2026-10-05).
        setTurnoFechado({ p: pedidoAtual, caixaAberto: null, semTurno: !p.session_id });
      } catch (e) {
        toastErro('Não consegui conferir o caixa', erroTexto(e));
      } finally {
        conferindoRef.current = false;
      }
    })();
  }, [podeCobrar, tenantId, toastAviso, toastErro, toastInfo]);

  // ── cortesia (turno fechado) ──────────────────────────────────────────────
  const confirmarCortesia = useCallback(async (c: Cortesia, destinatario: string, motivo: string) => {
    if (gravandoCortesiaRef.current) return;
    gravandoCortesiaRef.current = true;
    setCortesia(null);
    try {
      const bloqueio = await motivoParaNaoZerar(tenantId, c.p.id);
      if (bloqueio) { toastErro('Não dá para lançar como cortesia', bloqueio); return; }
      const { data, error } = await supabase.rpc('fn_cortesia_marcar_pedido', {
        p_order_id: c.p.id,
        p_tenant_id: tenantId,
        p_autorizado_por: c.autor,
        p_destinatario: destinatario,
        p_motivo: motivo,
      });
      if (error) throw error;
      const res = data as { ok?: boolean; error?: string } | null;
      if (!res?.ok) throw new Error(res?.error || 'Falha ao registrar a cortesia');
      setKdsPedidos((prev) => prev.map((k) => (k.id === c.p.id ? { ...k, isPaid: true } : k)));
      toastOk('Cortesia registrada', `O pedido ${rotuloNumero(c.p)} foi zerado como cortesia. Autorizada por ${c.autor ?? 'supervisor'}.`);
      onMudouRef.current();
    } catch (e) {
      toastErro('Erro ao registrar a cortesia', erroTexto(e));
    } finally {
      gravandoCortesiaRef.current = false;
    }
  }, [tenantId, setKdsPedidos, toastErro, toastOk]);

  // ── imprimir ──────────────────────────────────────────────────────────────
  /** Pedido do KDS para a comanda: o do quadro; senão o da sessão do pedido; senão o mínimo montado da tela. */
  const pedidoParaComanda = useCallback(async (p: PedidoRecente): Promise<KDSPedido> => {
    const noQuadro = vivo.current.kdsPedidos.find((k) => k.id === p.id);
    if (noQuadro) return noQuadro;
    if (p.session_id) {
      try {
        const daSessao = await vivo.current.fetchSessionOrdersFull(p.session_id);
        const achou = daSessao.find((k) => k.id === p.id);
        if (achou) return achou;
      } catch (e) {
        console.warn('[usePedidoAcoes] sessão do pedido indisponível, usando o resumo da tela:', e);
      }
    }
    return recenteParaKds(p);
  }, []);

  const imprimir = useCallback(async (p: PedidoRecente, tipo: TipoImpressao): Promise<void> => {
    try {
      if (tipo === 'resumo') {
        const r = await imprimirResumo(p, vivo.current.getImpressoraParaEstacao('pedidos'));
        if (!r.success && !r.fallbackToBrowser) toastErro('Erro na impressão', r.error || 'Não foi possível imprimir');
        return;
      }
      if (tipo === 'cliente') {
        // Só existe como janela (ImprimirPedidoModal do caixa): abre a janela, a pessoa imprime de lá.
        // numero = sequência do dia (o caixa mostra "#3"; o numero do banco aqui é o código inteiro)
        setImprimindoCliente({ ...p, numero: Number(numeroCurto(p)) || p.numero, itensDetalhes: itensAtivos(p) });
        return;
      }
      // cozinha
      if (ehCancelado(p)) { toastInfo('Pedido cancelado', 'Não reenvio a comanda de um pedido cancelado para a cozinha.'); return; }
      if (!tenantId) { toastErro('Erro na impressão', 'Sessão ainda carregando. Tente de novo.'); return; }
      const alvos = ehGrupo(p) && (p.pedidosOriginais?.length ?? 0) > 1 ? (p.pedidosOriginais as PedidoRecente[]) : [p];
      const impressoraFallback = vivo.current.getImpressoraParaEstacao('pedidos');
      let enviados = 0;
      let primeiroErro: string | null = null;
      for (const alvo of alvos) {
        if (ehCancelado(alvo)) continue;
        const pedido = await pedidoParaComanda(alvo);
        const r = await reprintPedidoGestor({ pedido, tenantId, mapaEstacoes: vivo.current.mapaEstacoes, impressoraFallback });
        if (r.success || r.fallbackToBrowser) enviados++;
        else primeiroErro ??= r.error || 'Não foi possível imprimir';
      }
      if (primeiroErro) toastErro('Erro na impressão', primeiroErro);
      else if (enviados > 0) toastOk('Comanda enviada para impressão', enviados > 1 ? `${enviados} comandas na fila da impressora.` : 'Na fila da impressora da cozinha.');
    } catch (e) {
      toastErro('Erro na impressão', erroTexto(e));
    }
  }, [tenantId, pedidoParaComanda, toastErro, toastInfo, toastOk]);

  // ── abrir no Gestor, WhatsApp, copiar ─────────────────────────────────────
  const abrirNoGestor = useCallback((p: PedidoRecente) => {
    if (!podeAbrirGestor) { toastInfo('Sem acesso ao Gestor', 'Seu perfil não abre o Gestor de pedidos.'); return; }
    navigate('/gestor-pedidos', { state: { abrirPedidoId: p.pedidoIds?.[0] ?? p.id } });
  }, [navigate, podeAbrirGestor, toastInfo]);

  const whatsapp = useCallback((p: PedidoRecente) => {
    if (!p.telefone) { toastInfo('Sem telefone', 'Esse pedido não tem o telefone do cliente.'); return; }
    if (!abrirWhatsApp(p.telefone, textoWhatsapp(p, vivo.current.nomeLoja))) {
      toastErro('Telefone inválido', 'O telefone desse pedido não dá para abrir no WhatsApp.');
    }
  }, [toastErro, toastInfo]);

  const copiarNumero = useCallback((p: PedidoRecente) => {
    const codigo = p.numeroCodigo ?? p.numeroStr ?? String(p.numero);
    void (async () => {
      try {
        await navigator.clipboard.writeText(codigo);
        toastOk('Número copiado', codigo);
      } catch {
        toastErro('Não consegui copiar', 'O navegador não deixou copiar. Selecione o número e copie à mão.');
      }
    })();
  }, [toastErro, toastOk]);

  // ── marcar entregues (pedidos esquecidos) ─────────────────────────────────
  const marcarEntregues = useCallback(async (ids: string[]): Promise<number> => {
    if (!podeEntregar) { toastErro('Sem permissão', 'Seu perfil não pode marcar pedidos como entregues.'); return 0; }
    const unicos = Array.from(new Set(ids.filter(Boolean)));
    if (unicos.length === 0 || !tenantId) return 0;
    let certos = 0;
    const erros: string[] = [];
    for (const id of unicos) {
      try {
        await entregarPedido(tenantId, id);
        certos++;
      } catch (e) {
        erros.push(erroTexto(e));
      }
    }
    if (certos > 0) {
      toastOk(certos === 1 ? '1 pedido marcado como entregue' : `${certos} pedidos marcados como entregues`);
      // O quadro do KDS/Gestor desta tela se atualiza (os outros aparelhos recebem pelo tempo real).
      void Promise.resolve(vivo.current.reloadOrders()).catch(() => undefined);
      onMudouRef.current();
    }
    if (erros.length > 0) {
      toastErro(certos > 0 ? `${erros.length} não deram certo` : 'Não consegui marcar como entregue', erros[0]);
    }
    return certos;
  }, [podeEntregar, tenantId, toastErro, toastOk]);

  const acoes = useMemo<AcoesPedido>(() => ({
    podeCobrar, podeCancelar, podeEntregar,
    cobrar, imprimir, cancelar, abrirNoGestor, whatsapp, copiarNumero, marcarEntregues,
  }), [podeCobrar, podeCancelar, podeEntregar, cobrar, imprimir, cancelar, abrirNoGestor, whatsapp, copiarNumero, marcarEntregues]);

  // ── modais e folhas (a página renderiza uma vez) ──────────────────────────
  const tf = turnoFechado;
  const elementos = (
    <>
      <Folha
        aberta={!!tf}
        titulo="O turno deste pedido já fechou"
        subtitulo={tf ? `Pedido ${rotuloNumero(tf.p)} · ${moedaTexto(tf.p.total)}` : undefined}
        onFechar={() => setTurnoFechado(null)}
      >
        {tf && (
          <div className="space-y-3 pb-2">
            <p className="text-[13px] text-zinc-600 leading-snug">
              {tf.semTurno
                ? 'Esse pedido não ficou ligado a nenhum turno do caixa, então o dinheiro não tem onde entrar sozinho. O que você quer fazer?'
                : 'O caixa em que esse pedido foi feito já foi fechado, então o dinheiro não pode entrar nele. O que aconteceu?'}
            </p>
            <p className="rounded-xl bg-zinc-50 px-3 py-2.5 text-[12.5px] text-zinc-600 leading-snug">
              Receber agora no caixa de outro turno ainda não está liberado: o relatório daquele turno ficaria com um valor que não entrou nele.
            </p>
            <div>
              <button
                className={`${btn('out')} w-full`}
                onClick={() => { setTurnoFechado(null); setCortesia({ p: tf.p, etapa: 'autorizar', autor: null }); }}
              >
                <i className="ri-gift-line text-base" /> Virou cortesia
              </button>
              <p className="text-[11px] text-zinc-400 mt-1 px-1">Zera o pedido. Pede a senha de um supervisor e o motivo.</p>
            </div>
            {podeCancelar && (
              <button className={`${btn('perigo')} w-full`} onClick={() => cancelar(tf.p)}>
                <i className="ri-close-circle-line text-base" /> Cancelar com motivo
              </button>
            )}
          </div>
        )}
      </Folha>

      {pagando && (
        <PagamentoRapidoModal
          orderId={pagando.p.id}
          numeroDisplay={Number(numeroCurto(pagando.p)) || pagando.p.numero}
          total={pagando.p.total}
          destinoDisplay={destinoStr(pagando.p)}
          destino={null}
          paidByPdv="cashier"
          formaInicialNome={pagando.p.formaAPagar}
          onClose={() => setPagando(null)}
          // O próprio modal avisa "Pagamento registrado" e mostra o troco; a janela só fecha no "Fechar".
          onSuccess={() => { onMudouRef.current(); }}
        />
      )}

      {cancelando && (
        <CancelamentoModal
          tipo="pedido"
          orderId={cancelando.p.id}
          orderNumber={numeroCurto(cancelando.p)}
          pagamentos={cancelando.pagamentos}
          onConcluido={() => { onMudouRef.current(); }}
          onFechar={() => setCancelando(null)}
        />
      )}

      {cortesia?.etapa === 'autorizar' && (
        <AutorizacaoGerenteModal
          titulo="Autorizar Cortesia"
          descricao="Informe as credenciais de supervisor ou admin para lançar este pedido como cortesia (R$ 0,00)."
          niveisPermitidos={['gerente', 'admin']}
          tenantId={tenantId}
          onAutorizado={(autor) => setCortesia((c) => (c ? { ...c, etapa: 'detalhes', autor } : c))}
          onCancelar={() => setCortesia(null)}
        />
      )}
      {cortesia?.etapa === 'detalhes' && (
        <CortesiaDetalhesModal
          autorizadoPor={cortesia.autor ?? 'Supervisor'}
          onConfirmar={(destinatario, motivo) => { void confirmarCortesia(cortesia, destinatario, motivo); }}
          onCancelar={() => setCortesia(null)}
        />
      )}

      {imprimindoCliente && <ImprimirPedidoModal pedido={imprimindoCliente} onClose={() => setImprimindoCliente(null)} />}
    </>
  );

  return { acoes, elementos };
}
