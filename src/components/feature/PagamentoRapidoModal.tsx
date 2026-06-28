import { useState, useEffect, useMemo } from 'react';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useKDS } from '@/contexts/KDSContext';
import { usePedidosAgrupados } from '@/hooks/usePedidosAgrupados';
import type { DestinoInfo } from '@/contexts/PDVContext';
import type { PedidoAgrupado } from '@/hooks/usePedidosAgrupados';
import AutorizacaoGerenteModal from '@/components/feature/AutorizacaoGerenteModal';
import CortesiaDetalhesModal from '@/pages/pdv/caixa/components/CortesiaDetalhesModal';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  orderId: string;
  numeroDisplay: number;
  total: number;
  destinoDisplay: string;
  destino?: DestinoInfo | null;
  onClose: () => void;
  onSuccess: (orderId: string, paymentMethodId: string) => void;
  /** Canal que está registrando o pagamento. Padrão: 'cashier' */
  paidByPdv?: 'cashier' | 'waiter' | 'self_service' | 'delivery';
  /** Valor pré-preenchido no campo de valor (ex: diferença de pagamento após edição) */
  valorInicial?: number;
  /** Texto de contexto exibido no topo do modal para indicar o que está sendo cobrado */
  tituloContexto?: string;
  /** IDs de pedidos para auto-vincular na abertura — soma os totais automaticamente */
  autoLinkOrderIds?: string[];
}

interface ItemPedido {
  nome: string;
  quantidade: number;
  preco: number;
  opcoes?: string[];
}

export default function PagamentoRapidoModal({ orderId, numeroDisplay, total, destinoDisplay, destino, onClose, onSuccess, paidByPdv = 'cashier', valorInicial, tituloContexto, autoLinkOrderIds }: Props) {
  const { formasAtivas, loading: loadingFormas } = usePaymentMethods();
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const { setPedidos, pedidos: kdsPedidos } = useKDS();

  const { pedidosRelacionados, todosPedidosAbertos } = usePedidosAgrupados(destino ?? null, [], 0);

  const [formaId, setFormaId] = useState('');
  const [valorInput, setValorInput] = useState(valorInicial != null ? valorInicial.toFixed(2) : '');
  const [pagamentos, setPagamentos] = useState<{ formaId: string; formaNome: string; valor: number; troco?: number }[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [etapa, setEtapa] = useState<'pagar' | 'selecionar'>('pagar');
  const [pedidosSelecionados, setPedidosSelecionados] = useState<Set<string>>(new Set());
  // Auto-link orders from props (ex: grouped orders from same senha in PDV caixa)
  useEffect(() => {
    if (autoLinkOrderIds && autoLinkOrderIds.length > 0) {
      setPedidosSelecionados(new Set(autoLinkOrderIds));
    }
  }, [autoLinkOrderIds]);
  const [pedidoExpandido, setPedidoExpandido] = useState<string | null>(null);
  const [itensPrincipalDb, setItensPrincipalDb] = useState<ItemPedido[]>([]);
  const [loadingItens, setLoadingItens] = useState(false);
  const [buscaPedidos, setBuscaPedidos] = useState('');
  // ── Cortesia (com liberação de gerente/admin) ──
  const [showAutorizacaoCortesia, setShowAutorizacaoCortesia] = useState(false);
  const [showCortesiaDetalhes, setShowCortesiaDetalhes] = useState(false);
  const [cortesiaAutorTemp, setCortesiaAutorTemp] = useState<string | null>(null);
  const [foiCortesia, setFoiCortesia] = useState(false);

  // Tenta usar itens do KDS primeiro (já carregados, sem nova query)
  const itensPrincipalKds = useMemo<ItemPedido[]>(() => {
    const pedidoKds = kdsPedidos.find((p) => p.id === orderId);
    if (!pedidoKds || pedidoKds.itens.length === 0) return [];
    return pedidoKds.itens.map((item) => ({
      nome: item.nome,
      quantidade: item.quantidade,
      preco: item.item_price ?? 0,
      opcoes: item.opcoes
        .filter((o) => !!o.opcaoNome)
        .map((o) => {
          const addPrice = (o as { additional_price?: number }).additional_price ?? 0;
          const isMandatory = !!(o as { obrigatorio?: boolean }).obrigatorio;
          if (addPrice > 0) {
            return isMandatory
              ? `${o.grupoNome}: ${o.opcaoNome} (${fmt(addPrice)})`
              : `${o.grupoNome}: ${o.opcaoNome} (+${fmt(addPrice)})`;
          }
          return `${o.grupoNome}: ${o.opcaoNome}`;
        }),
    }));
  }, [kdsPedidos, orderId]);

  // Usa itens do KDS se disponíveis, senão fallback para o banco
  const itensPrincipal = itensPrincipalKds.length > 0 ? itensPrincipalKds : itensPrincipalDb;

  // Busca itens do banco SOMENTE quando o KDS não tem os itens
  useEffect(() => {
    // Se o KDS já tem os itens, não precisa buscar do banco
    if (itensPrincipalKds.length > 0) return;

    if (!orderId || !user?.tenantId) {
      console.log('[PagamentoRapidoModal] useEffect itens: orderId ou tenantId ausente', { orderId, tenantId: user?.tenantId });
      return;
    }
    setLoadingItens(true);
    console.log('[PagamentoRapidoModal] KDS sem itens, buscando do banco:', orderId);

    const buscarItens = async () => {
      try {
        // Busca order_items — inclui item_id para fallback de nome
        const { data: itemsData, error: itemsError } = await supabase
          .from('order_items')
          .select('id, quantity, item_price, item_name, item_id')
          .eq('order_id', orderId)
          .eq('tenant_id', user.tenantId);

        console.log('[PagamentoRapidoModal] order_items result:', { count: itemsData?.length, error: itemsError?.message, orderId });

        if (itemsError) {
          console.warn('[PagamentoRapidoModal] order_items error:', itemsError.message);
          setItensPrincipalDb([]);
          setLoadingItens(false);
          return;
        }
        if (!itemsData || itemsData.length === 0) {
          console.warn('[PagamentoRapidoModal] order_items vazio para orderId:', orderId);
          setItensPrincipalDb([]);
          setLoadingItens(false);
          return;
        }

        // Fallback: buscar nomes de menu_items para itens sem item_name
        const itemIdsSemNome = itemsData
          .filter((row: { item_name?: string | null; item_id?: string | null }) => !row.item_name && row.item_id)
          .map((row: { item_id?: string | null }) => row.item_id);
        let nomesMenuItem = new Map<string, string>();
        if (itemIdsSemNome.length > 0) {
          const { data: menuData, error: menuError } = await supabase
            .from('menu_items')
            .select('id, name')
            .in('id', itemIdsSemNome)
            .eq('tenant_id', user.tenantId);
          if (!menuError && menuData) {
            for (const m of menuData as Array<{ id: string; name: string }>) {
              nomesMenuItem.set(m.id, m.name);
            }
          }
        }

        // Busca order_item_options para todos os order_items
        const orderItemIds = itemsData.map((row: { id: string }) => row.id);
        const { data: optsData, error: optsError } = await supabase
          .from('order_item_options')
          .select('order_item_id, option_name, additional_price')
          .in('order_item_id', orderItemIds)
          .eq('tenant_id', user.tenantId);

        if (optsError) {
          console.warn('[PagamentoRapidoModal] order_item_options error:', optsError.message);
        }

        // Agrupa opções por order_item_id
        const optsPorItem = new Map<string, { option_name: string; additional_price: number }[]>();
        if (optsData) {
          for (const opt of optsData) {
            const arr = optsPorItem.get(opt.order_item_id) ?? [];
            arr.push(opt);
            optsPorItem.set(opt.order_item_id, arr);
          }
        }

        const mapped: ItemPedido[] = itemsData.map((row: {
          id: string;
          quantity: number;
          item_price: number;
          item_name: string | null;
          item_id: string | null;
        }) => {
          const opts = optsPorItem.get(row.id) ?? [];
          const opcoes = opts
            .filter((o) => !!o.option_name)
            .map((o) => {
              const price = o.additional_price ?? 0;
              return price > 0 ? `${o.option_name} (+${fmt(price)})` : o.option_name;
            });
          const nome = row.item_name || (row.item_id ? nomesMenuItem.get(row.item_id) : null) || 'Item';
          return {
            nome,
            quantidade: row.quantity ?? 1,
            preco: row.item_price ?? 0,
            opcoes,
          };
        });

        console.log('[PagamentoRapidoModal] itens mapeados:', mapped.length, mapped);
        setItensPrincipalDb(mapped);
      } catch (e) {
        console.error('[PagamentoRapidoModal] buscarItens error:', e);
      } finally {
        setLoadingItens(false);
      }
    };

    buscarItens();
  }, [orderId, user?.tenantId]);

  // Seleciona a primeira forma ao carregar
  useEffect(() => {
    if (formasAtivas.length > 0 && !formaId) {
      setFormaId(formasAtivas[0].id);
    }
  }, [formasAtivas, formaId]);

  // Pedidos relacionados (excluindo o próprio pedido atual)
  const pedidosRelacionadosFiltrados = pedidosRelacionados.filter((p) => p.id !== orderId);
  const temPedidosRelacionados = pedidosRelacionadosFiltrados.length > 0;

  // Todos os pedidos abertos (exceto o principal e os já relacionados)
  const idsJaMostrados = new Set([orderId, ...pedidosRelacionadosFiltrados.map((p) => p.id)]);
  const outrosPedidosAbertos = todosPedidosAbertos.filter((p) => !idsJaMostrados.has(p.id));

  // Pedido principal pode estar no KDS/banco
  const pedidoPrincipalDoKds = pedidosRelacionados.find((p) => p.id === orderId);

  const totalPedidosSelecionados = [...pedidosRelacionadosFiltrados, ...outrosPedidosAbertos]
    .filter((p) => pedidosSelecionados.has(p.id))
    .reduce((acc, p) => acc + p.total, 0);

  const totalEfetivo = total + totalPedidosSelecionados;

  const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);
  const restante = Math.max(0, totalEfetivo - totalPago);
  const troco = totalPago > totalEfetivo ? totalPago - totalEfetivo : 0;

  const handleAddPagamento = () => {
    const v = parseFloat(valorInput.replace(',', '.'));
    if (isNaN(v) || v <= 0) return;
    const forma = formasAtivas.find((f) => f.id === formaId);
    if (!forma) return;
    if (forma.exigeTroco && v > restante) {
      const trocoCalc = v - restante;
      setPagamentos((prev) => [
        ...prev,
        { formaId: forma.id, formaNome: forma.nome, valor: restante, troco: trocoCalc },
      ]);
    } else {
      setPagamentos((prev) => [
        ...prev,
        { formaId: forma.id, formaNome: forma.nome, valor: v, troco: undefined },
      ]);
    }
    setValorInput('');
  };

  const handleFinalizar = async () => {
    // Auto-adicionar pagamento se o valor está preenchido mas não foi clicado no '+'
    let pagamentosFinais = pagamentos;
    if (pagamentos.length === 0 && formaId) {
      const v = parseFloat(valorInput.replace(',', '.'));
      const forma = formasAtivas.find((f) => f.id === formaId);
      if (forma && !isNaN(v) && v >= totalEfetivo) {
        const trocoCalc = forma.exigeTroco && v > totalEfetivo ? v - totalEfetivo : undefined;
        pagamentosFinais = [{ formaId: forma.id, formaNome: forma.nome, valor: totalEfetivo, troco: trocoCalc }];
        setPagamentos(pagamentosFinais);
      } else if (forma && restante <= 0.01) {
        pagamentosFinais = [{ formaId: forma.id, formaNome: forma.nome, valor: totalEfetivo }];
        setPagamentos(pagamentosFinais);
      }
    }

    if (pagamentosFinais.length === 0) return;

    const restanteCheck = totalEfetivo - pagamentosFinais.reduce((acc, p) => acc + p.valor, 0);
    if (restanteCheck > 0.01) return;

    setConfirmando(true);
    try {
      // Gera um payment_group_id único se houver mais de um pedido sendo pago junto
      const todosPedidosVinculados = [...pedidosRelacionadosFiltrados, ...outrosPedidosAbertos]
        .filter((p) => pedidosSelecionados.has(p.id));
      const totalPedidosPagando = todosPedidosVinculados.length + 1;
      const paymentGroupId: string | null = totalPedidosPagando > 1
        ? crypto.randomUUID()
        : null;

      // Registra pagamento do pedido principal
      for (const pag of pagamentosFinais) {
        const { error: payErr } = await invokeWithAuth('order-write', {
          body: {
            action: 'record_payment',
            order_id: orderId,
            tenant_id: user?.tenantId,
            payment_method_id: pag.formaId,
            amount: pag.valor,
            change_amount: pag.troco ?? 0,
            operator_name: user?.nome ?? null,
            paid_by_pdv: paidByPdv,
            payment_group_id: paymentGroupId ?? null,
          },
        });
        if (payErr) {
          throw payErr;
        }
      }

      // Registra pagamentos dos pedidos vinculados (distribui proporcionalmente)
      if (todosPedidosVinculados.length > 0) {
        const proporcao = todosPedidosVinculados.map((p) => p.total / totalEfetivo);
        const vinculadoErrors: string[] = [];
        for (let i = 0; i < todosPedidosVinculados.length; i++) {
          const pedido = todosPedidosVinculados[i];
          const prop = proporcao[i];
          for (const pag of pagamentosFinais) {
            const { error: payErr } = await invokeWithAuth('order-write', {
              body: {
                action: 'record_payment',
                order_id: pedido.id,
                tenant_id: user?.tenantId,
                payment_method_id: pag.formaId,
                amount: Number((pag.valor * prop).toFixed(2)),
                change_amount: 0,
                operator_name: user?.nome ?? null,
                paid_by_pdv: paidByPdv,
                payment_group_id: paymentGroupId ?? null,
              },
            });
            if (payErr) {
              vinculadoErrors.push(typeof payErr === 'string' ? payErr : JSON.stringify(payErr));
            }
          }
        }
        if (vinculadoErrors.length > 0) {
          throw new Error(`Falha ao registrar pagamento vinculado: ${vinculadoErrors.join('; ')}`);
        }
      }

      // Atualiza o estado local do KDS para refletir isPaid = true
      const pedidosPagosIds = [orderId, ...todosPedidosVinculados.map((p) => p.id)];
      setPedidos((prev) =>
        prev.map((p) =>
          pedidosPagosIds.includes(p.id) ? { ...p, isPaid: true } : p
        )
      );

      const totalPedidos = todosPedidosVinculados.length + 1;
      toastSuccess('Pagamento registrado!', `${totalPedidos} pedido(s) pago(s) · ${fmt(totalEfetivo)}`);
      setSucesso(true);
      onSuccess(orderId, pagamentosFinais[0]?.formaId ?? '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toastError('Erro ao registrar pagamento', msg);
    } finally {
      setConfirmando(false);
    }
  };

  // ── Lança o(s) pedido(s) como cortesia (R$ 0,00) ──
  // Zera o pedido existente (e os vinculados selecionados) via RPC SECURITY DEFINER.
  // Liberação de gerente/admin já validada antes deste ponto.
  const handleConfirmarCortesia = async (destinatario: string, motivo: string) => {
    if (confirmando) return;
    setConfirmando(true);
    setShowCortesiaDetalhes(false);
    try {
      const todosVinculados = [...pedidosRelacionadosFiltrados, ...outrosPedidosAbertos]
        .filter((p) => pedidosSelecionados.has(p.id));
      const idsParaCortesia = [orderId, ...todosVinculados.map((p) => p.id)];
      for (const oid of idsParaCortesia) {
        const { data, error } = await supabase.rpc('fn_cortesia_marcar_pedido', {
          p_order_id: oid,
          p_tenant_id: user?.tenantId,
          p_autorizado_por: cortesiaAutorTemp,
          p_destinatario: destinatario,
          p_motivo: motivo,
        });
        if (error) throw error;
        const res = data as { ok?: boolean; error?: string } | null;
        if (!res?.ok) throw new Error(res?.error || 'Falha ao registrar cortesia');
      }
      setPedidos((prev) => prev.map((p) => (idsParaCortesia.includes(p.id) ? { ...p, isPaid: true } : p)));
      setFoiCortesia(true);
      setSucesso(true);
      toastSuccess('Cortesia confirmada!', `${idsParaCortesia.length} pedido(s) registrado(s) como cortesia`);
      onSuccess(orderId, '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toastError('Erro ao registrar cortesia', msg);
    } finally {
      setConfirmando(false);
    }
  };

  const ICON_MAP: Record<string, string> = {
    dinheiro: 'ri-money-dollar-circle-line',
    credito:  'ri-bank-card-line',
    debito:   'ri-bank-card-2-line',
    pix:      'ri-qr-code-line',
    vale:     'ri-coupon-line',
  };

  // Helper para formatar o destino de um pedido
  const formatarDestino = (p: PedidoAgrupado) => {
    // QR code universal (mesa sem número físico) com senha de participante → mostra a senha, não "Mesa 0"
    if (p.destino === 'mesa' && !p.mesaNumero && p.participantToken) {
      const nome = p.nomeCliente?.replace(/^Mesa\s*\d*\s*[-–.·]?\s*/i, '').trim() ?? '';
      return `Senha ${p.participantToken}${nome ? ` - ${nome}` : ''}`;
    }
    if (p.destino === 'mesa' && p.mesaNumero) return `Mesa ${p.mesaNumero}`;
    if (p.destino === 'senha' && p.senha) return `Senha ${p.senha}`;
    if (p.destino === 'delivery') return 'Delivery';
    if (p.nomeCliente) return p.nomeCliente;
    return '';
  };

  // Helper para renderizar a lista de itens de um pedido
  const renderItens = (itens: { nome: string; quantidade: number; preco: number; opcoes?: string[] }[]) => (
    <div className="px-4 pb-3 space-y-1.5 border-t border-zinc-100 pt-2">
      {itens.length === 0 ? (
        <p className="text-xs text-zinc-400 py-1">Nenhum item encontrado</p>
      ) : (
        itens.map((item, idx) => (
          <div key={idx} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400 font-medium">{item.quantidade}x</span>
                <span className="text-zinc-700">{item.nome}</span>
              </div>
              <span className="text-zinc-500 font-medium">{fmt(item.preco * item.quantidade)}</span>
            </div>
            {item.opcoes && item.opcoes.length > 0 && (
              <div className="pl-6 text-[10px] text-zinc-400 leading-tight">
                {item.opcoes.join(', ')}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );

  // Helper para renderizar um card de pedido selecionável
  const renderPedidoCard = (p: PedidoAgrupado, isPrincipal?: boolean) => {
    const selecionado = isPrincipal ? true : pedidosSelecionados.has(p.id);
    const expandido = pedidoExpandido === p.id;
    const destinoLabel = formatarDestino(p);
    return (
      <div
        key={p.id}
        className={`rounded-xl border-2 transition-colors overflow-hidden ${
          selecionado
            ? 'border-amber-500 bg-amber-50'
            : 'border-zinc-200 bg-white'
        }`}
      >
        <button
          onClick={() => {
            if (isPrincipal) {
              setPedidoExpandido(expandido ? null : p.id);
              return;
            }
            setPedidosSelecionados((prev) => {
              const novo = new Set(prev);
              if (selecionado) {
                novo.delete(p.id);
              } else {
                novo.add(p.id);
              }
              return novo;
            });
          }}
          className="w-full flex items-center justify-between px-4 py-3 cursor-pointer text-left"
        >
          <div className="flex items-center gap-3">
            {isPrincipal ? (
              <div className="w-5 h-5 flex items-center justify-center text-amber-600">
                <i className="ri-checkbox-circle-fill text-sm" />
              </div>
            ) : (
              <div className={`w-5 h-5 flex items-center justify-center rounded-full border-2 ${
                selecionado ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'
              }`}>
                {selecionado && <i className="ri-check-line text-white text-xs" />}
              </div>
            )}
            <div>
              <p className="text-sm font-bold text-zinc-900">#{p.numeroStr || String(p.numero).padStart(4, '0')}</p>
              <p className="text-xs text-zinc-500">
                {p.itens.length} item(s) · {fmt(p.total)}
                {destinoLabel && <span className="ml-1 text-amber-500 font-medium">· {destinoLabel}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-zinc-900">{fmt(p.total)}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPedidoExpandido(expandido ? null : p.id);
              }}
              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400 transition-colors"
            >
              <i className={`ri-arrow-down-s-line text-sm transition-transform ${expandido ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </button>

        {/* Itens do pedido */}
        {expandido && renderItens(p.itens)}
      </div>
    );
  };

  if (sucesso) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-emerald-100 rounded-full mb-4">
            <i className="ri-check-double-line text-3xl text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 mb-1">{foiCortesia ? 'Cortesia Registrada!' : 'Pagamento Registrado!'}</h2>
          <p className="text-zinc-500 text-sm mb-1">#{String(numeroDisplay).padStart(4, '0')} · {destinoDisplay}</p>
          <p className={`text-2xl font-black mt-2 ${foiCortesia ? 'text-violet-600' : 'text-emerald-600'}`}>{foiCortesia ? 'Cortesia · R$ 0,00' : fmt(totalEfetivo)}</p>
          {foiCortesia && cortesiaAutorTemp && (
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-2 py-1 rounded-full">
              <i className="ri-gift-line text-violet-500" />
              Autorizada por {cortesiaAutorTemp}
            </span>
          )}
          {troco > 0 && (
            <div className="mt-4 w-full bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p className="text-emerald-700 font-bold text-lg">{fmt(troco)}</p>
              <p className="text-emerald-600 text-xs">Troco para o cliente</p>
            </div>
          )}
          <button
            onClick={onClose}
            className="mt-6 w-full py-3 bg-zinc-900 hover:bg-black text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  if (etapa === 'selecionar') {
    // Pedidos filtrados pela busca (senha, nome, mesa, número ou item)
    const filtrarPorBusca = (p: PedidoAgrupado) => {
      if (!buscaPedidos.trim()) return true;
      const termo = buscaPedidos.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const numeroMatch = String(p.numero).includes(termo) || p.numeroStr.toLowerCase().includes(termo);
      const itemMatch = p.itens.some((i) => i.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(termo));
      const senhaMatch = p.senha?.toLowerCase().includes(termo)
        || p.participantToken?.toLowerCase().includes(termo);
      const mesaMatch = p.mesaNumero != null && String(p.mesaNumero).includes(termo);
      const nomeMatch = p.nomeCliente?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(termo);
      return numeroMatch || itemMatch || senhaMatch || mesaMatch || nomeMatch;
    };

    const pedidosRelacionadosFiltradosPorBusca = pedidosRelacionadosFiltrados.filter(filtrarPorBusca);
    const outrosPedidosFiltradosPorBusca = outrosPedidosAbertos.filter(filtrarPorBusca);

    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-zinc-50 flex-shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEtapa('pagar')}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400"
              >
                <i className="ri-arrow-left-line text-sm" />
              </button>
              <div>
                <p className="font-bold text-zinc-900">Vincular Pedidos</p>
                <p className="text-xs text-zinc-500 mt-0.5">{destinoDisplay}</p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400 transition-colors">
              <i className="ri-close-line text-lg" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 p-5 space-y-4">
            {/* Busca */}
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400">
                <i className="ri-search-line text-sm" />
              </div>
              <input
                type="text"
                value={buscaPedidos}
                onChange={(e) => setBuscaPedidos(e.target.value)}
                placeholder="Buscar por senha, mesa, nome, número ou item..."
                className="w-full pl-9 pr-4 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200"
              />
            </div>

            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Pedido principal</p>
            <div className="rounded-xl border-2 border-amber-500 bg-amber-50 overflow-hidden">
              <button
                onClick={() => setPedidoExpandido(pedidoExpandido === 'principal' ? null : 'principal')}
                className="w-full flex items-center justify-between px-4 py-3 cursor-pointer text-left"
              >
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 flex items-center justify-center text-amber-600">
                    <i className="ri-checkbox-circle-fill text-sm" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-900">#{String(numeroDisplay).padStart(4, '0')}</p>
                    <p className="text-xs text-zinc-500">
                      {itensPrincipal.length} item(s) · {fmt(total)}
                      {destinoDisplay && <span className="ml-1 text-amber-500 font-medium">· {destinoDisplay}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-zinc-900">{fmt(total)}</span>
                  <div className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400 transition-colors">
                    <i className={`ri-arrow-down-s-line text-sm transition-transform ${pedidoExpandido === 'principal' ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </button>
              {pedidoExpandido === 'principal' && (
                loadingItens
                  ? (
                    <div className="px-4 pb-3 pt-2 flex items-center justify-center">
                      <i className="ri-loader-4-line animate-spin text-zinc-400 text-sm" />
                    </div>
                  )
                  : renderItens(itensPrincipal)
              )}
            </div>

            {/* Pedidos relacionados */}
            {pedidosRelacionadosFiltradosPorBusca.length > 0 && (
              <>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Pedidos relacionados</p>
                {pedidosRelacionadosFiltradosPorBusca.map((p) => renderPedidoCard(p))}
              </>
            )}

            {/* Outros pedidos abertos */}
            {outrosPedidosFiltradosPorBusca.length > 0 && (
              <>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Outros pedidos abertos</p>
                {outrosPedidosFiltradosPorBusca.map((p) => renderPedidoCard(p))}
              </>
            )}

            {pedidosRelacionadosFiltradosPorBusca.length === 0 && outrosPedidosFiltradosPorBusca.length === 0 && buscaPedidos.trim() && (
              <div className="text-center py-6 text-zinc-400">
                <i className="ri-search-line text-2xl mb-2" />
                <p className="text-sm">Nenhum pedido encontrado</p>
              </div>
            )}

            <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">
              <span className="text-sm font-bold text-zinc-900">Total selecionado</span>
              <span className="text-lg font-black text-amber-600">{fmt(totalEfetivo)}</span>
            </div>
          </div>

          <div className="px-5 py-4 border-t border-zinc-100 flex-shrink-0">
            <button
              onClick={() => setEtapa('pagar')}
              className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              Avançar para Pagamento · {fmt(totalEfetivo)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-zinc-50 flex-shrink-0">
          <div>
            <p className="font-bold text-zinc-900">{tituloContexto ?? 'Registrar Pagamento'}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              #{String(numeroDisplay).padStart(4, '0')} · {destinoDisplay}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400 transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Botão Vincular Pedidos */}
          {(temPedidosRelacionados || outrosPedidosAbertos.length > 0) && (
            <button
              onClick={() => setEtapa('selecionar')}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border-2 border-amber-300 rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              <div className="w-5 h-5 flex items-center justify-center">
                <i className="ri-link-m text-amber-600 text-base" />
              </div>
              Vincular Pedidos
              <span className="text-xs font-normal text-amber-500">({pedidosRelacionadosFiltrados.length} pedido(s) disponível(eis))</span>
            </button>
          )}

          {/* Pedidos vinculados já selecionados */}
          {pedidosSelecionados.size > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
              <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1 px-4 pt-3 pb-1">
                <i className="ri-link-m text-[10px]" />
                Pedidos vinculados:
              </p>
              <div className="px-4 pb-2 space-y-1">
                {/* Pedido principal */}
                <button
                  onClick={() => setPedidoExpandido(pedidoExpandido === 'principal' ? null : 'principal')}
                  className="w-full flex items-center justify-between py-1.5 cursor-pointer text-left"
                >
                  <span className="text-xs text-zinc-600 font-medium">
                    #{String(numeroDisplay).padStart(4, '0')} (principal)
                    {destinoDisplay && <span className="text-zinc-400 ml-1">· {destinoDisplay}</span>}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-zinc-900 text-xs">{fmt(total)}</span>
                    <i className={`ri-arrow-down-s-line text-zinc-400 text-xs transition-transform ${pedidoExpandido === 'principal' ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {pedidoExpandido === 'principal' && (
                  loadingItens
                    ? (
                      <div className="flex items-center justify-center py-2">
                        <i className="ri-loader-4-line animate-spin text-zinc-400 text-xs" />
                      </div>
                    )
                    : renderItens(itensPrincipal)
                )}
                {/* Pedidos vinculados */}
                {[...pedidosRelacionadosFiltrados, ...outrosPedidosAbertos]
                  .filter((p) => pedidosSelecionados.has(p.id))
                  .map((p) => {
                    const expandido = pedidoExpandido === p.id;
                    const destinoLabel = formatarDestino(p);
                    return (
                      <div key={p.id}>
                        <button
                          onClick={() => setPedidoExpandido(expandido ? null : p.id)}
                          className="w-full flex items-center justify-between py-1.5 cursor-pointer text-left"
                        >
                          <span className="text-xs text-zinc-600 font-medium">
                            #{p.numeroStr || String(p.numero).padStart(4, '0')}
                            {destinoLabel && <span className="text-zinc-400 ml-1">· {destinoLabel}</span>}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-zinc-900 text-xs">{fmt(p.total)}</span>
                            <i className={`ri-arrow-down-s-line text-zinc-400 text-xs transition-transform ${expandido ? 'rotate-180' : ''}`} />
                          </div>
                        </button>
                        {expandido && renderItens(p.itens)}
                      </div>
                    );
                  })}
              </div>
              <div className="flex justify-between text-sm font-bold px-4 py-2 border-t border-amber-200">
                <span className="text-amber-800">Total</span>
                <span className="text-amber-700">{fmt(totalEfetivo)}</span>
              </div>
            </div>
          )}

          {/* Total */}
          <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3 border border-zinc-200">
            <span className="text-sm font-semibold text-zinc-600">Total do pedido</span>
            <span className="text-xl font-black text-zinc-900">{fmt(totalEfetivo)}</span>
          </div>

          {/* Formas de pagamento */}
          {loadingFormas ? (
            <div className="flex items-center justify-center py-6">
              <i className="ri-loader-4-line animate-spin text-zinc-400 text-xl" />
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Forma de Pagamento</p>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {formasAtivas.map((forma) => (
                  <button
                    key={forma.id}
                    onClick={() => setFormaId(forma.id)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                      formaId === forma.id
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-zinc-200 hover:border-zinc-300 bg-white'
                    }`}
                  >
                    <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${formaId === forma.id ? 'bg-amber-100' : 'bg-zinc-100'}`}>
                      <i className={`${ICON_MAP[forma.tipo] ?? 'ri-wallet-line'} text-base ${formaId === forma.id ? 'text-amber-600' : 'text-zinc-500'}`} />
                    </div>
                    <span className={`text-[9px] font-bold text-center leading-tight ${formaId === forma.id ? 'text-amber-700' : 'text-zinc-500'}`}>
                      {forma.nome}
                    </span>
                  </button>
                ))}
              </div>

              {/* Valor */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-medium pointer-events-none">R$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={valorInput}
                    onChange={(e) => setValorInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddPagamento()}
                    placeholder={restante.toFixed(2).replace('.', ',')}
                    className="w-full pl-10 pr-4 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200"
                  />
                </div>
                <button
                  onClick={() => setValorInput(restante.toFixed(2))}
                  className="px-3 py-2.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
                >
                  Exato
                </button>
                <button
                  onClick={handleAddPagamento}
                  disabled={!valorInput || restante <= 0}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors"
                >
                  <i className="ri-add-line" />
                </button>
              </div>
            </div>
          )}

          {/* Pagamentos adicionados */}
          {pagamentos.length > 0 && (
            <div>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Pagamentos</p>
              <div className="space-y-2">
                {pagamentos.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-zinc-50 rounded-lg px-3 py-2 border border-zinc-100">
                    <span className="text-sm text-zinc-700 font-medium">{p.formaNome}</span>
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-black text-zinc-900">{fmt(p.valor)}</span>
                      {p.troco && p.troco > 0 && (
                        <span className="text-[10px] text-emerald-600 font-semibold">troco {fmt(p.troco)}</span>
                      )}
                      <button
                        onClick={() => setPagamentos((prev) => prev.filter((_, i) => i !== idx))}
                        className="w-5 h-5 flex items-center justify-center text-zinc-300 hover:text-red-400 cursor-pointer transition-colors"
                      >
                        <i className="ri-close-line text-sm" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Restante / Troco */}
          {restante > 0.01 && (
            <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-red-600">Restante</span>
              <span className="text-lg font-black text-red-600">{fmt(restante)}</span>
            </div>
          )}
          {restante <= 0.01 && troco > 0 && (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-emerald-600">Troco</span>
              <span className="text-lg font-black text-emerald-600">{fmt(troco)}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-100 flex-shrink-0 space-y-2">
          {/* Cortesia — zera o(s) pedido(s) com liberação de gerente/admin */}
          <button
            onClick={() => setShowAutorizacaoCortesia(true)}
            disabled={confirmando}
            className="w-full py-2.5 border-2 border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-40 disabled:cursor-not-allowed font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap text-sm flex items-center justify-center gap-2"
          >
            <i className="ri-gift-line text-base" />
            Lançar como Cortesia (R$ 0,00)
          </button>
          <button
            onClick={handleFinalizar}
            disabled={confirmando || (
              pagamentos.length === 0
                ? (() => {
                    const v = parseFloat(valorInput.replace(',', '.'));
                    return !formaId || isNaN(v) || v < totalEfetivo;
                  })()
                : restante > 0.01
            )}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 text-sm"
          >
            {confirmando ? (
              <>
                <i className="ri-loader-4-line animate-spin" />
                Registrando...
              </>
            ) : (
              <>
                <i className="ri-check-double-line" />
                Confirmar Pagamento · {fmt(totalEfetivo)}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Cortesia — autorização gerente/admin */}
      {showAutorizacaoCortesia && (
        <AutorizacaoGerenteModal
          titulo="Autorizar Cortesia"
          descricao="Informe as credenciais de gerente ou admin para lançar este pedido como cortesia (R$ 0,00)."
          niveisPermitidos={['gerente', 'admin']}
          tenantId={user?.tenantId ?? ''}
          onAutorizado={(autorizadoPor) => {
            setCortesiaAutorTemp(autorizadoPor);
            setShowAutorizacaoCortesia(false);
            setShowCortesiaDetalhes(true);
          }}
          onCancelar={() => setShowAutorizacaoCortesia(false)}
        />
      )}

      {/* Cortesia — destinatário + motivo */}
      {showCortesiaDetalhes && (
        <CortesiaDetalhesModal
          autorizadoPor={cortesiaAutorTemp ?? 'Gerente'}
          onConfirmar={(destinatario, motivo) => handleConfirmarCortesia(destinatario, motivo)}
          onCancelar={() => { setShowCortesiaDetalhes(false); setCortesiaAutorTemp(null); }}
        />
      )}
    </div>
  );
}