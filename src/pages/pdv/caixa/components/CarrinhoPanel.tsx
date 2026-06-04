import { useState, useRef, useEffect } from 'react';
import { usePDV } from '../../../../contexts/PDVContext';
import { useNotificacoes } from '../../../../contexts/NotificacoesContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { useAuditoria } from '../../../../contexts/AuditoriaContext';
import { useAprovacoes } from '../../../../contexts/AprovacoesContext';
import DescontoAutorizacaoModal from './DescontoAutorizacaoModal';
import type { DestinoInfo, CarrinhoItem } from '../../../../contexts/PDVContext';
import { useSystemSettings } from '../../../../hooks/useSystemSettings';
import { usePedidosAgrupados } from '@/hooks/usePedidosAgrupados';

interface Props {
  onDestino: () => void;
  onPagar: () => void;
  onLimpar: () => void;
  onEditItem: (cartId: string) => void;
  onEnviarCozinha?: () => void;
  onVincularPedidos?: () => void;
}

interface Rascunho {
  id: string;
  itens: CarrinhoItem[];
  salvoEm: string;
  label: string;
}

interface ConfirmDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant: 'red' | 'zinc';
  onConfirm: () => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function DestinoTag({ destino }: { destino: DestinoInfo }) {
  const labels: Record<string, string> = {
    hora: 'Fechar na Hora',
    mesa: `Mesa ${destino.mesaNumero}`,
    nome: destino.nomeCliente ?? '',
    senha: `Senha: ${destino.senha}`,
    delivery: `Delivery · ${destino.nomeCliente}`,
  };
  const icons: Record<string, string> = {
    hora: 'ri-timer-line',
    mesa: 'ri-table-line',
    nome: 'ri-user-line',
    senha: 'ri-ticket-line',
    delivery: 'ri-e-bike-line',
  };
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
      <i className={`${icons[destino.tipo]} text-sm`} />
      <span className="truncate max-w-[140px]">{labels[destino.tipo]}</span>
    </div>
  );
}

function ConfirmDialog({
  state,
  onCancel,
}: {
  state: ConfirmDialogState;
  onCancel: () => void;
}) {
  const confirmClass =
    state.confirmVariant === 'red'
      ? 'bg-red-500 hover:bg-red-600 text-white'
      : 'bg-zinc-800 hover:bg-zinc-900 text-white';

  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-full bg-white rounded-t-2xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${state.confirmVariant === 'red' ? 'bg-red-100' : 'bg-zinc-100'}`}>
            <i className={`text-base ${state.confirmVariant === 'red' ? 'ri-alert-line text-red-500' : 'ri-question-line text-zinc-500'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-zinc-900 text-sm">{state.title}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{state.description}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 hover:bg-zinc-50 font-semibold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={state.onConfirm}
            className={`flex-1 py-2.5 font-semibold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors ${confirmClass}`}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CarrinhoPanel({ onDestino, onPagar, onLimpar, onEditItem, onEnviarCozinha, onVincularPedidos }: Props) {
  const {
    carrinho, destino, taxaServico,
    subtotal, valorDesconto, valorTaxaServico, total,
    updateItemQty, removeItem, setDesconto, toggleTaxaServico, addItem, clearCart,
  } = usePDV();
  const { pedidosRelacionados } = usePedidosAgrupados(destino, carrinho, total);
  const { dispararNotificacao, addPendingApproval, cancelPending } = useNotificacoes();
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();
  const { addSolicitacao } = useAprovacoes();

  const [descontoTemp, setDescontoTemp] = useState('');
  const [descontoTipo, setDescontoTipo] = useState<'valor' | 'percentual'>('valor');
  const [desconto, setDescontoLocal] = useState(0);
  const [descontoAutorizadoPor, setDescontoAutorizadoPor] = useState<string | null>(null);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [showDescontoModal, setShowDescontoModal] = useState(false);
  const [descontoModalValor, setDescontoModalValor] = useState(0);
  const [showRascunhos, setShowRascunhos] = useState(false);
  const [showSalvarModal, setShowSalvarModal] = useState(false);
  const [labelRascunho, setLabelRascunho] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const { settings: sysSettings, carregar: recarregarSettings } = useSystemSettings();
  // Força recarga das configurações ao montar para evitar dados stale
  useEffect(() => {
    recarregarSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Taxa de serviço aparece no carrinho do PDV Caixa apenas quando ambas as flags estão ativas
  const taxaServicoConfig = sysSettings.service_fee_enabled && sysSettings.pdv_caixa_show_service_fee;
  const taxaServicoPct = sysSettings.service_fee_percentage;

  const [rascunhos, setRascunhos] = useState<Rascunho[]>(() => {
    try { return JSON.parse(localStorage.getItem('pdv_rascunhos') || '[]'); }
    catch { return []; }
  });

  useEffect(() => {
    if (showSalvarModal) {
      setTimeout(() => labelInputRef.current?.focus(), 50);
    }
  }, [showSalvarModal]);

  const saveRascunhosToStorage = (list: Rascunho[]) => {
    localStorage.setItem('pdv_rascunhos', JSON.stringify(list));
    setRascunhos(list);
  };

  const handleSalvarRascunho = () => {
    if (carrinho.length === 0) return;
    const sugestao = destino
      ? destino.tipo === 'mesa' ? `Mesa ${destino.mesaNumero}`
      : destino.tipo === 'nome' ? destino.nomeCliente ?? ''
      : destino.tipo === 'senha' ? `Senha ${destino.senha}`
      : ''
      : '';
    setLabelRascunho(sugestao);
    setShowSalvarModal(true);
  };

  const handleConfirmarSalvar = (substituirId?: string) => {
    const now = new Date();
    const labelFinal = labelRascunho.trim() ||
      `${carrinho.length} item${carrinho.length > 1 ? 'ns' : ''} · ${formatPrice(total)}`;
    const novoRascunho: Rascunho = {
      id: substituirId ?? `r-${Date.now()}`,
      itens: [...carrinho],
      salvoEm: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      label: labelFinal,
    };
    let novaLista: Rascunho[];
    if (substituirId) {
      novaLista = rascunhos.map((r) => r.id === substituirId ? novoRascunho : r);
    } else {
      novaLista = [novoRascunho, ...rascunhos.filter((r) => r.id !== substituirId).slice(0, 4)];
    }
    saveRascunhosToStorage(novaLista);
    clearCart();
    setDescontoLocal(0);
    setDesconto(0);
    setDescontoAutorizadoPor(null);
    setDescontoTemp('');
    setShowSalvarModal(false);
    setLabelRascunho('');
    setShowRascunhos(true);
  };

  const handleRestaurarRascunho = (r: Rascunho) => {
    if (carrinho.length > 0) {
      setConfirmDialog({
        title: 'Substituir carrinho atual?',
        description: 'O pedido atual será descartado e substituído pelo rascunho selecionado.',
        confirmLabel: 'Substituir',
        confirmVariant: 'red',
        onConfirm: () => {
          clearCart();
          setTimeout(() => r.itens.forEach((item) => addItem(item)), 50);
          saveRascunhosToStorage(rascunhos.filter((x) => x.id !== r.id));
          setShowRascunhos(false);
          setConfirmDialog(null);
        },
      });
      return;
    }
    clearCart();
    setTimeout(() => r.itens.forEach((item) => addItem(item)), 50);
    saveRascunhosToStorage(rascunhos.filter((x) => x.id !== r.id));
    setShowRascunhos(false);
  };

  const handleDescartarRascunho = (id: string) => {
    saveRascunhosToStorage(rascunhos.filter((r) => r.id !== id));
  };

  const handleLimpar = () => {
    setConfirmDialog({
      title: 'Limpar pedido atual?',
      description: 'Todos os itens do carrinho serão removidos. Esta ação não pode ser desfeita.',
      confirmLabel: 'Limpar tudo',
      confirmVariant: 'red',
      onConfirm: () => {
        onLimpar();
        setConfirmDialog(null);
      },
    });
  };

  const handleDeletarTodosRascunhos = () => {
    setConfirmDialog({
      title: `Deletar ${rascunhos.length} rascunho${rascunhos.length > 1 ? 's' : ''}?`,
      description: 'Todos os rascunhos salvos serão excluídos permanentemente.',
      confirmLabel: 'Deletar todos',
      confirmVariant: 'red',
      onConfirm: () => {
        saveRascunhosToStorage([]);
        setShowRascunhos(false);
        setConfirmDialog(null);
      },
    });
  };

  /** Abre o modal de autorização de desconto */
  const handleAbrirModalDesconto = () => {
    const v = parseFloat(descontoTemp.replace(',', '.'));
    if (isNaN(v) || v <= 0) return;
    let realVal = v;
    if (descontoTipo === 'percentual') {
      realVal = (subtotal * v) / 100;
    }
    setDescontoModalValor(realVal);
    setShowDescontoModal(true);
  };

  /** Desconto autorizado via senha in loco */
  const handleAutorizadoSenha = (autorizadorNome: string) => {
    setDesconto(descontoModalValor);
    setDescontoLocal(descontoModalValor);
    setDescontoAutorizadoPor(autorizadorNome);
    setShowDescontoModal(false);

    registrarEvento({
      tipo: 'desconto_aplicado',
      severidade: 'aviso',
      usuario: user?.nome ?? 'Operador',
      perfil: user?.perfil ?? 'caixa',
      descricao: `Desconto de ${formatPrice(descontoModalValor)} aplicado — autorizado por ${autorizadorNome} (senha in loco)`,
      entidade: 'Pedido',
      entidadeId: destino?.tipo === 'mesa' ? `Mesa ${destino.mesaNumero}` : 'PDV',
      antes: { total_sem_desconto: formatPrice(subtotal) },
      depois: { desconto: formatPrice(descontoModalValor), autorizador: autorizadorNome, metodo: 'Senha In Loco' },
      detalhes: `Operador: ${user?.nome ?? 'Operador'} · Autorizador presente: ${autorizadorNome}`,
    });

    dispararNotificacao({
      tipo: 'aprovacao_resposta',
      titulo: 'Desconto autorizado',
      mensagem: `Desconto de ${formatPrice(descontoModalValor)} liberado por ${autorizadorNome} (in loco).`,
      urgente: false,
      perfisAlvo: ['caixa'],
      icone: 'ri-shield-check-fill',
      cor: 'green',
    });
  };

  /** Falha na tentativa de senha in loco */
  const handleFalhouSenha = (tentativas: number) => {
    registrarEvento({
      tipo: 'desconto_negado',
      severidade: 'aviso',
      usuario: user?.nome ?? 'Operador',
      perfil: user?.perfil ?? 'caixa',
      descricao: `Tentativa de desconto negada — senha incorreta (${tentativas} tentativa${tentativas > 1 ? 's' : ''})`,
      entidade: 'Pedido',
      entidadeId: destino?.tipo === 'mesa' ? `Mesa ${destino.mesaNumero}` : 'PDV',
      detalhes: `Operador ${user?.nome ?? 'Operador'} tentou aplicar desconto de ${formatPrice(descontoModalValor)}. Senha digitada incorretamente ${tentativas}x.`,
    });
  };

  /** Desconto solicitado via notificação */
  const handleSolicitarViaNotificacao = () => {
    const realVal = descontoModalValor;
    const operador = user?.nome ?? 'Operador';
    const localDestino = destino;
    setShowDescontoModal(false);

    // Registra solicitação na auditoria
    registrarEvento({
      tipo: 'desconto_solicitado',
      severidade: 'info',
      usuario: operador,
      perfil: user?.perfil ?? 'caixa',
      descricao: `Desconto de ${formatPrice(realVal)} solicitado via notificação para aprovação`,
      entidade: 'Pedido',
      entidadeId: localDestino?.tipo === 'mesa' ? `Mesa ${localDestino.mesaNumero}` : 'PDV',
      depois: { valor_solicitado: formatPrice(realVal), metodo: 'Notificação' },
    });

    const approvalId = `approval-${Date.now()}`;

    // Guard de "uma só chamada" — seja via notificação ou via aba Aprovações
    let resolved = false;

    const handleApproved = (approverName: string) => {
      if (resolved) return;
      resolved = true;
      setDesconto(realVal);
      setDescontoLocal(realVal);
      setDescontoAutorizadoPor(approverName);
      setPendingApprovalId(null);

      registrarEvento({
        tipo: 'desconto_aplicado',
        severidade: 'aviso',
        usuario: operador,
        perfil: user?.perfil ?? 'caixa',
        descricao: `Desconto de ${formatPrice(realVal)} aprovado por ${approverName}`,
        entidade: 'Pedido',
        entidadeId: localDestino?.tipo === 'mesa' ? `Mesa ${localDestino.mesaNumero}` : 'PDV',
        antes: { total_sem_desconto: formatPrice(subtotal) },
        depois: { desconto: formatPrice(realVal), autorizador: approverName, metodo: 'Notificação' },
      });

      dispararNotificacao({
        tipo: 'aprovacao_resposta',
        titulo: 'Desconto autorizado!',
        mensagem: `Desconto de ${formatPrice(realVal)} aprovado por ${approverName}.`,
        urgente: false,
        perfisAlvo: ['caixa'],
        icone: 'ri-shield-check-fill',
        cor: 'green',
      });
    };

    const handleDenied = () => {
      if (resolved) return;
      resolved = true;
      setPendingApprovalId(null);

      registrarEvento({
        tipo: 'desconto_negado',
        severidade: 'aviso',
        usuario: operador,
        perfil: user?.perfil ?? 'caixa',
        descricao: `Desconto de ${formatPrice(realVal)} negado pelo gerente/admin`,
        entidade: 'Pedido',
        entidadeId: localDestino?.tipo === 'mesa' ? `Mesa ${localDestino.mesaNumero}` : 'PDV',
        detalhes: 'Gerente/Admin recusou a solicitação.',
      });

      dispararNotificacao({
        tipo: 'aprovacao_resposta',
        titulo: 'Desconto negado',
        mensagem: `O gerente/admin não autorizou o desconto de ${formatPrice(realVal)}.`,
        urgente: false,
        perfisAlvo: ['caixa'],
        icone: 'ri-close-circle-line',
        cor: 'red',
      });
    };

    const notifId = dispararNotificacao({
      tipo: 'aprovacao_pendente',
      titulo: 'Solicitação de Desconto',
      mensagem: `${operador} solicita desconto de ${formatPrice(realVal)} no pedido atual.`,
      urgente: false,
      perfisAlvo: ['admin', 'gerente'],
      icone: 'ri-shield-keyhole-line',
      cor: 'orange',
      extra: { approvalId, valor: realVal, operadorNome: operador },
    });

    addPendingApproval({
      approvalId,
      notifId,
      tipo: 'desconto',
      valor: realVal,
      operadorNome: operador,
      itensPedido: carrinho.map((ci) => ({
        nome: ci.nome,
        quantidade: ci.quantidade,
        precoTotal: ci.precoTotal * ci.quantidade,
        opcoes: ci.opcoes.map((o) => o.opcaoNome),
        observacoes: [
          ...(ci.observacoes ?? []),
          ...(ci.observacaoLivre ? [ci.observacaoLivre] : []),
        ].filter(Boolean),
      })),
      totalPedido: subtotal,
      onApproved: handleApproved,
      onDenied: handleDenied,
    });

    // Registra também na aba Aprovações para gerentes/admins atuarem por lá
    addSolicitacao({
      tipo: 'desconto',
      mesaNome: localDestino?.tipo === 'mesa' ? `Mesa ${localDestino.mesaNumero}` : 'PDV Caixa',
      garcomNome: operador,
      itemNome: `Desconto de ${formatPrice(realVal)}`,
      descricao: `${operador} solicita autorização de desconto de ${formatPrice(realVal)} no pedido atual.`,
      urgente: false,
      valorDesconto: realVal,
      approvalId,
      itensPedido: carrinho.map((ci) => ({
        nome: ci.nome,
        quantidade: ci.quantidade,
        precoTotal: ci.precoTotal * ci.quantidade,
        opcoes: ci.opcoes.map((o) => o.opcaoNome),
        observacoes: [
          ...(ci.observacoes ?? []),
          ...(ci.observacaoLivre ? [ci.observacaoLivre] : []),
        ].filter(Boolean),
      })),
      totalPedido: subtotal,
      onApproved: handleApproved,
      onDenied: handleDenied,
    });

    setPendingApprovalId(approvalId);
  };

  const handleCancelarSolicitacao = () => {
    if (pendingApprovalId) {
      registrarEvento({
        tipo: 'desconto_negado',
        severidade: 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? 'caixa',
        descricao: `Solicitação de desconto de ${formatPrice(descontoModalValor)} cancelada pelo operador`,
        entidade: 'Pedido',
        entidadeId: destino?.tipo === 'mesa' ? `Mesa ${destino.mesaNumero}` : 'PDV',
        detalhes: 'Operador cancelou a solicitação antes da resposta do gerente.',
      });
      cancelPending(pendingApprovalId);
      setPendingApprovalId(null);
    }
  };

  const handleLimparDesconto = () => {
    setDesconto(0);
    setDescontoLocal(0);
    setDescontoAutorizadoPor(null);
    setDescontoTemp('');
  };

  const handleChangeTipoDesconto = (tipo: 'valor' | 'percentual') => {
    setDescontoTipo(tipo);
    setDescontoTemp('');
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-zinc-200 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 md:px-4 py-2.5 md:py-3 border-b border-zinc-200 bg-zinc-50 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 flex items-center justify-center text-zinc-500 flex-shrink-0">
            <i className="ri-shopping-cart-line text-base" />
          </div>
          <p className="font-bold text-zinc-900 text-sm whitespace-nowrap">Pedido</p>
          {carrinho.length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
              {carrinho.reduce((a, i) => a + i.quantidade, 0)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {destino && (
            <>
              <DestinoTag destino={destino} />
              <button
                onClick={onDestino}
                title="Alterar destino"
                className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-amber-600 rounded-lg hover:bg-amber-50 transition-colors cursor-pointer"
              >
                <i className="ri-pencil-line text-sm" />
              </button>
            </>
          )}
          {carrinho.length > 0 && (
            <button onClick={handleLimpar} className="text-xs text-red-400 hover:text-red-600 cursor-pointer whitespace-nowrap px-1 font-medium">
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Rascunhos disponíveis */}
      {rascunhos.length > 0 && (
        <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 flex-shrink-0">
          <div className="flex items-center justify-between w-full">
            <button
              onClick={() => setShowRascunhos((v) => !v)}
              className="flex items-center gap-1.5 cursor-pointer"
            >
              <i className="ri-draft-line text-amber-500 text-sm" />
              <span className="text-xs font-semibold text-zinc-600">
                {rascunhos.length} rascunho{rascunhos.length > 1 ? 's' : ''} salvo{rascunhos.length > 1 ? 's' : ''}
              </span>
              <i className={`text-zinc-400 text-sm ${showRascunhos ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
            </button>
            <button
              onClick={handleDeletarTodosRascunhos}
              className="flex items-center gap-1 text-[10px] font-semibold text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors"
              title="Deletar todos os rascunhos"
            >
              <i className="ri-delete-bin-line text-xs" />
              Limpar todos
            </button>
          </div>
          {showRascunhos && (
            <div className="mt-2 space-y-1.5">
              {rascunhos.map((r) => (
                <div key={r.id} className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-2.5 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-zinc-700 truncate">{r.label}</p>
                    <p className="text-[9px] text-zinc-400">Salvo às {r.salvoEm}</p>
                  </div>
                  <button
                    onClick={() => handleRestaurarRascunho(r)}
                    className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-md cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <i className="ri-arrow-go-back-line text-xs" /> Restaurar
                  </button>
                  <button
                    onClick={() => handleDescartarRascunho(r.id)}
                    className="w-5 h-5 flex items-center justify-center text-zinc-300 hover:text-red-400 cursor-pointer"
                  >
                    <i className="ri-close-line text-xs" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {carrinho.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-300 py-10">
            <div className="w-16 h-16 flex items-center justify-center mb-3">
              <i className="ri-shopping-basket-line text-5xl" />
            </div>
            <p className="text-sm text-zinc-400">Nenhum item no carrinho</p>
            <p className="text-xs text-zinc-300 mt-1">Clique em um item para adicionar</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {carrinho.map((item) => (
              <div key={item.cartId} className="px-3 md:px-4 py-2.5 md:py-3">
                <div className="flex items-start gap-2">
                  <div className="flex items-center gap-1 border border-zinc-200 rounded-lg px-1 py-0.5 flex-shrink-0">
                    <button onClick={() => updateItemQty(item.cartId, -1)} className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-red-500 cursor-pointer">
                      <i className="ri-subtract-line text-xs" />
                    </button>
                    <span className="w-5 text-center text-sm font-bold text-zinc-900">{item.quantidade}</span>
                    <button onClick={() => updateItemQty(item.cartId, 1)} className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-green-500 cursor-pointer">
                      <i className="ri-add-line text-xs" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{item.nome}</p>
                    {item.opcoes.length > 0 && (
                      <p className="text-xs text-zinc-400 mt-0.5 truncate">
                        {item.opcoes.map((o) => o.opcaoNome).join(', ')}
                      </p>
                    )}
                    {(item.observacoes.length > 0 || item.observacaoLivre) && (
                      <p className="text-xs text-amber-600 mt-0.5 truncate">
                        Obs: {[...item.observacoes, item.observacaoLivre].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-sm font-bold text-zinc-900">{formatPrice(item.precoTotal * item.quantidade)}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onEditItem(item.cartId)}
                        title="Editar item"
                        className="w-6 h-6 flex items-center justify-center text-zinc-300 hover:text-amber-500 cursor-pointer transition-colors"
                      >
                        <i className="ri-pencil-line text-sm" />
                      </button>
                      <button onClick={() => removeItem(item.cartId)} className="text-zinc-300 hover:text-red-400 cursor-pointer transition-colors">
                        <div className="w-6 h-6 flex items-center justify-center">
                          <i className="ri-delete-bin-line text-sm" />
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary & Actions */}
      {carrinho.length > 0 && (
        <div className="border-t border-zinc-200 bg-zinc-50 flex-shrink-0">
          <div className="px-3 md:px-4 py-2.5 md:py-3 space-y-2.5 border-b border-zinc-200">
            {/* Desconto com dupla autorização */}
            <div className="space-y-1">
              {desconto > 0 ? (
                <div className="flex items-center gap-2">
                  <i className="ri-shield-keyhole-line text-zinc-400 text-sm flex-shrink-0" />
                  <span className="text-xs text-zinc-600 flex-1">Desconto</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-green-600">-{formatPrice(desconto)}</span>
                    <button onClick={handleLimparDesconto} className="text-zinc-300 hover:text-red-400 cursor-pointer">
                      <i className="ri-close-circle-line text-sm" />
                    </button>
                  </div>
                </div>
              ) : pendingApprovalId ? (
                <div className="flex items-center gap-2">
                  <i className="ri-shield-keyhole-line text-zinc-400 text-sm flex-shrink-0" />
                  <div className="flex-1 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
                      <span className="text-xs font-semibold text-orange-600">Aguardando gerente...</span>
                    </div>
                    <button
                      onClick={handleCancelarSolicitacao}
                      className="text-[10px] font-semibold text-red-400 hover:text-red-600 cursor-pointer whitespace-nowrap transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <i className="ri-shield-keyhole-line text-zinc-400 text-sm flex-shrink-0" />
                    <span className="text-xs text-zinc-500 flex-1">Desconto</span>
                    {/* Toggle tipo */}
                    <div className="flex items-center gap-1 bg-zinc-200 rounded-md p-0.5 flex-shrink-0">
                      <button
                        onClick={() => handleChangeTipoDesconto('valor')}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors cursor-pointer whitespace-nowrap ${descontoTipo === 'valor' ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500'}`}
                      >
                        R$
                      </button>
                      <button
                        onClick={() => handleChangeTipoDesconto('percentual')}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors cursor-pointer whitespace-nowrap ${descontoTipo === 'percentual' ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500'}`}
                      >
                        %
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 pl-5">
                    <input
                      type="number"
                      min="0"
                      max={descontoTipo === 'percentual' ? 100 : undefined}
                      value={descontoTemp}
                      onChange={(e) => setDescontoTemp(e.target.value)}
                      placeholder={descontoTipo === 'percentual' ? '0%' : '0,00'}
                      className="flex-1 min-w-0 text-right border border-zinc-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white"
                    />
                    <button
                      onClick={handleAbrirModalDesconto}
                      disabled={!descontoTemp || parseFloat(descontoTemp) <= 0}
                      title="Autorizar desconto — senha in loco ou notificação"
                      className="text-xs font-bold bg-zinc-800 text-white hover:bg-zinc-700 px-2.5 py-1.5 rounded cursor-pointer disabled:opacity-40 whitespace-nowrap transition-colors flex items-center gap-1 flex-shrink-0"
                    >
                      <i className="ri-shield-check-line text-xs" />
                      Autorizar
                    </button>
                  </div>
                </div>
              )}
              {descontoAutorizadoPor && (
                <p className="text-[10px] text-green-600 flex items-center gap-1 pl-5">
                  <i className="ri-shield-check-line" /> Autorizado por {descontoAutorizadoPor}
                </p>
              )}
              {pendingApprovalId && (
                <p className="text-[10px] text-orange-500 pl-5">
                  Notificação enviada para Gerente / Admin
                </p>
              )}
            </div>

            {/* Taxa de serviço */}
            {taxaServicoConfig && (
              <div className="flex items-center gap-2">
                <i className="ri-percent-line text-zinc-400 text-sm flex-shrink-0" />
                <span className="text-xs text-zinc-600 flex-1">Taxa de Serviço ({taxaServicoPct}%)</span>
                <button
                  onClick={toggleTaxaServico}
                  className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${taxaServico ? 'bg-amber-500' : 'bg-zinc-300'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${taxaServico ? 'left-4' : 'left-0.5'}`} />
                </button>
              </div>
            )}
          </div>

          {/* Totais */}
          <div className="px-3 md:px-4 py-2.5 md:py-3 space-y-1">
            {(subtotal !== total || valorDesconto > 0 || (taxaServico && taxaServicoConfig)) && (
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
            )}
            {valorDesconto > 0 && (
              <div className="flex justify-between text-xs text-green-600">
                <span>Desconto</span>
                <span>-{formatPrice(valorDesconto)}</span>
              </div>
            )}
            {taxaServico && taxaServicoConfig && (
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Taxa de Serviço</span>
                <span>+{formatPrice(valorTaxaServico)}</span>
              </div>
            )}
            <div className={`flex justify-between text-base font-bold text-zinc-900 ${(subtotal !== total || valorDesconto > 0 || (taxaServico && taxaServicoConfig)) ? 'pt-1 border-t border-zinc-200' : ''}`}>
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>

          {/* Botões */}
          <div className="px-3 md:px-4 pb-3 md:pb-4 space-y-2">
            <button
              onClick={handleSalvarRascunho}
              className="w-full py-2 border border-dashed border-zinc-300 hover:border-amber-400 text-zinc-500 hover:text-amber-600 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
            >
              <i className="ri-draft-line text-sm" />
              Salvar como rascunho
            </button>
            {onEnviarCozinha && (
              <button
                onClick={onEnviarCozinha}
                className="w-full py-3 bg-stone-600 hover:bg-stone-700 text-white font-bold text-sm rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
              >
                <i className="ri-restaurant-line text-base" />
                Enviar para Cozinha
              </button>
            )}
            {/* Botão Vincular Pedidos — aparece quando detecta pedidos da mesma conta */}
            {onVincularPedidos && pedidosRelacionados.length > 0 && (
              <button
                onClick={onVincularPedidos}
                className="w-full py-2.5 flex items-center justify-center gap-2 border-2 border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 font-bold text-sm rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <div className="w-5 h-5 flex items-center justify-center">
                  <i className="ri-links-line text-amber-600 text-base" />
                </div>
                <span>Pedidos da mesma conta</span>
                <span className="ml-1 bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                  +{pedidosRelacionados.length}
                </span>
              </button>
            )}
            <button
              onClick={onPagar}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
            >
              <i className="ri-secure-payment-line text-base" />
              Finalizar Pedido
            </button>
          </div>
        </div>
      )}

      {/* Modal de Autorização de Desconto */}
      {showDescontoModal && (
        <DescontoAutorizacaoModal
          valorDesconto={descontoModalValor}
          operadorNome={user?.nome ?? 'Operador'}
          onAutorizadoSenha={handleAutorizadoSenha}
          onFalhouSenha={handleFalhouSenha}
          onEnviarNotificacao={handleSolicitarViaNotificacao}
          onClose={() => setShowDescontoModal(false)}
        />
      )}

      {/* Modal: Salvar Rascunho */}
      {showSalvarModal && (
        <div className="absolute inset-0 z-40 flex items-end bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) { setShowSalvarModal(false); } }}>
          <div className="w-full bg-white rounded-t-2xl shadow-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className="ri-draft-line text-amber-500 text-base" />
                <h3 className="text-sm font-bold text-zinc-900">Salvar Rascunho</h3>
              </div>
              <button onClick={() => setShowSalvarModal(false)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-500">
                <i className="ri-close-line text-sm" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Identificação do rascunho
              </label>
              <input
                ref={labelInputRef}
                type="text"
                value={labelRascunho}
                onChange={(e) => setLabelRascunho(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirmarSalvar()}
                placeholder="Ex: Mesa 5, João, Pedido especial…"
                maxLength={40}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 text-zinc-900"
              />
              <p className="text-[10px] text-zinc-400 mt-1">
                {carrinho.reduce((a, i) => a + i.quantidade, 0)} item(ns) · {formatPrice(total)}
              </p>
            </div>

            {rascunhos.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Ou substituir um rascunho existente:
                </p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {rascunhos.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => handleConfirmarSalvar(r.id)}
                      className="w-full flex items-center justify-between bg-zinc-50 hover:bg-amber-50 border border-zinc-200 hover:border-amber-300 rounded-lg px-3 py-2 transition-colors cursor-pointer group"
                    >
                      <div className="text-left min-w-0">
                        <p className="text-xs font-semibold text-zinc-700 group-hover:text-amber-700 truncate">{r.label}</p>
                        <p className="text-[9px] text-zinc-400">Salvo às {r.salvoEm}</p>
                      </div>
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-100 group-hover:bg-amber-200 px-2 py-0.5 rounded-full ml-2 flex-shrink-0 whitespace-nowrap">
                        Substituir
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => handleConfirmarSalvar()}
              className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-sm rounded-xl transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
            >
              <i className="ri-save-line text-base" />
              Salvar como novo rascunho
            </button>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          state={confirmDialog}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}
