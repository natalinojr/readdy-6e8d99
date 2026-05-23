import { useMemo, useState, useCallback } from 'react';
import { useKDS } from '../../../../contexts/KDSContext';
import type { KDSPedido, KDSItem } from '@/types/kds';
import {
  useKDSTick,
  getElapsedSeconds,
  formatElapsed,
  getSLALevel,
  SLA_COLORS,
  SLA_BG,
} from '../../../../hooks/useKDSTick';

interface Props {
  mesaNumero?: number;
  nomeClienteAvulso?: string;
}

const STATUS_CONFIG = {
  novo:     { label: 'Na fila',  icon: 'ri-time-line',          bg: 'bg-zinc-100',  text: 'text-zinc-600',  dot: 'bg-zinc-400'  },
  preparo:  { label: 'Preparo',  icon: 'ri-fire-line',          bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  pronto:   { label: 'Pronto!',  icon: 'ri-check-double-line',  bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  entregue: { label: 'Entregue', icon: 'ri-checkbox-circle-line', bg: 'bg-zinc-50', text: 'text-zinc-400',  dot: 'bg-zinc-300'  },
};

const ESTACAO_COLORS: Record<string, string> = {
  Grelha:      'bg-red-50   text-red-600   border-red-200',
  Frituras:    'bg-yellow-50 text-yellow-700 border-yellow-200',
  Balcão:      'bg-teal-50  text-teal-700  border-teal-200',
  Confeitaria: 'bg-pink-50  text-pink-700  border-pink-200',
};

function estacaoColor(e: string) {
  return ESTACAO_COLORS[e] ?? 'bg-zinc-50 text-zinc-600 border-zinc-200';
}

// Modal para editar item antes do preparo
interface EditarItemCozinhaModalProps {
  item: KDSItem;
  onSalvar: (itemId: string, updates: { quantidade: number; observacoes: string[] }) => void;
  onRemover: (itemId: string) => void;
  onClose: () => void;
}

function EditarItemCozinhaModal({ item, onSalvar, onRemover, onClose }: EditarItemCozinhaModalProps) {
  const [quantidade, setQuantidade] = useState(item.quantidade);
  const [novaObs, setNovaObs] = useState('');
  const [observacoes, setObservacoes] = useState<string[]>([...item.observacoes]);

  const handleAddObs = () => {
    const t = novaObs.trim();
    if (t && !observacoes.includes(t)) {
      setObservacoes((prev) => [...prev, t]);
      setNovaObs('');
    }
  };

  const handleRemoveObs = (obs: string) => {
    setObservacoes((prev) => prev.filter((o) => o !== obs));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 border border-zinc-200">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-xl">
            <i className="ri-pencil-line text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-900 truncate">{item.nome}</p>
            <p className="text-[10px] text-amber-600 font-medium">Editar antes do preparo</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer rounded-lg hover:bg-zinc-100">
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Quantidade */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-zinc-600 mb-2">Quantidade</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuantidade(Math.max(0, quantidade - 1))}
              className="w-8 h-8 flex items-center justify-center bg-zinc-100 hover:bg-red-100 text-zinc-600 hover:text-red-600 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-subtract-line text-sm" />
            </button>
            <span className="text-xl font-black text-zinc-900 min-w-[32px] text-center">{quantidade}</span>
            <button
              onClick={() => setQuantidade(quantidade + 1)}
              className="w-8 h-8 flex items-center justify-center bg-zinc-100 hover:bg-green-100 text-zinc-600 hover:text-green-600 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-add-line text-sm" />
            </button>
          </div>
          {quantidade === 0 && (
            <p className="text-[10px] text-red-500 mt-1">Quantidade 0 vai remover o item</p>
          )}
        </div>

        {/* Observações */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-zinc-600 mb-2">Observações</label>
          {observacoes.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {observacoes.map((obs) => (
                <span key={obs} className="flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                  {obs}
                  <button onClick={() => handleRemoveObs(obs)} className="cursor-pointer hover:text-red-500 transition-colors">
                    <i className="ri-close-line text-[10px]" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1">
            <input
              type="text"
              value={novaObs}
              onChange={(e) => setNovaObs(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddObs()}
              placeholder="Adicionar observação..."
              className="flex-1 text-xs border border-zinc-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-400"
            />
            <button
              onClick={handleAddObs}
              disabled={!novaObs.trim()}
              className="px-2.5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-add-line" />
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { onRemover(item.id); onClose(); }}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors border border-red-200"
          >
            <i className="ri-delete-bin-line" />
            Remover
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              if (quantidade === 0) {
                onRemover(item.id);
              } else {
                onSalvar(item.id, { quantidade, observacoes });
              }
              onClose();
            }}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

interface ItemRowProps {
  item: KDSItem;
  deliveredCount: number;
  onEntregarUm: (itemId: string) => void;
}

function ItemStatusRow({ item, deliveredCount, onEntregarUm, onEditar, podeEditar }: ItemRowProps & { onEditar?: (item: KDSItem) => void; podeEditar?: boolean }) {
  useKDSTick();

  const refTime = item.iniciouPreparoEm ?? item.entroKdsEm;
  const elapsed = getElapsedSeconds(refTime);
  const slaLevel = getSLALevel(elapsed, item.slaMinutos);

  // Effective status: consider local deliveries
  const totalUnidades = item.quantidade;
  const isLocalmenteEntregue = deliveredCount >= totalUnidades;
  const effectiveStatus = isLocalmenteEntregue ? 'entregue' : item.status;
  const cfg = STATUS_CONFIG[effectiveStatus];

  const podeEntregar = item.status === 'pronto' && !isLocalmenteEntregue;
  const parcialmenteEntregue = deliveredCount > 0 && !isLocalmenteEntregue;

  return (
    <div className={`py-2.5 border-b border-zinc-100 last:border-0 transition-all ${isLocalmenteEntregue ? 'opacity-40' : ''}`}>
      {/* Linha principal: dot + nome + badges alinhados */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${effectiveStatus === 'preparo' ? 'animate-pulse' : ''}`} />

        {/* Qtd + nome */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {totalUnidades > 1 && (
            <span className="text-[10px] font-black text-amber-600 whitespace-nowrap">{totalUnidades}x</span>
          )}
          <span className={`text-xs font-semibold ${isLocalmenteEntregue ? 'line-through text-zinc-400' : 'text-zinc-800'} whitespace-nowrap`}>
            {item.nome}
          </span>
          {item.observacoes.length > 0 && (
            <i className="ri-alert-line text-amber-500 text-[10px] flex-shrink-0" title={item.observacoes.join(', ')} />
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Estação */}
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${estacaoColor(item.estacao)}`}>
          {item.estacao}
        </span>

        {/* Timer */}
        {effectiveStatus !== 'entregue' && (
          <span className={`text-[10px] font-bold tabular-nums flex-shrink-0 min-w-[36px] text-right ${SLA_COLORS[slaLevel]}`}>
            {formatElapsed(elapsed)}
          </span>
        )}

        {/* Botão entregar ou badge status ou editar */}
        {podeEditar && onEditar && !isLocalmenteEntregue ? (
          <button
            onClick={() => onEditar(item)}
            className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full cursor-pointer transition-all whitespace-nowrap flex-shrink-0 bg-amber-100 hover:bg-amber-500 text-amber-700 hover:text-white border border-amber-300"
          >
            <i className="ri-pencil-line text-xs" />
            Editar
          </button>
        ) : podeEntregar ? (
          <button
            onClick={() => onEntregarUm(item.id)}
            className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full cursor-pointer transition-all whitespace-nowrap flex-shrink-0
              ${parcialmenteEntregue
                ? 'bg-green-100 hover:bg-green-500 text-green-700 hover:text-white border border-green-300'
                : 'bg-green-500 hover:bg-green-600 text-white'
              }`}
          >
            <i className="ri-checkbox-circle-line text-xs" />
            {totalUnidades > 1 ? 'Entregar 1' : 'Entregar'}
          </button>
        ) : effectiveStatus === 'entregue' ? (
          <span className="text-[9px] font-bold px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap bg-zinc-100 text-zinc-400 border border-zinc-200">
            <i className="ri-checkbox-circle-line mr-0.5" />
            Entregue
          </span>
        ) : effectiveStatus === 'pronto' ? (
          <span className="text-[9px] font-bold px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap bg-green-100 text-green-700 border border-green-300">
            <i className="ri-check-double-line mr-0.5" />
            Pronto
          </span>
        ) : effectiveStatus === 'preparo' ? (
          <span className="text-[9px] font-bold px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap bg-amber-100 text-amber-700 border border-amber-300">
            <i className="ri-fire-line mr-0.5 animate-pulse" />
            Preparo
          </span>
        ) : (
          <span className="text-[9px] font-bold px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap bg-zinc-100 text-zinc-500 border border-zinc-200">
            <i className="ri-time-line mr-0.5" />
            Na fila
          </span>
        )}
      </div>

      {/* Linha secundária: opcoes + obs + timestamps + barra de progresso */}
      {(item.opcoes.length > 0 || item.observacoes.length > 0 || (totalUnidades > 1 && deliveredCount > 0) || item.ficouProntoEm || item.entregueEm || item.quemEntregou) && (
        <div className="pl-4 mt-1 flex flex-wrap items-center gap-1.5">
          {item.opcoes.length > 0 && (
            <span className="text-[10px] text-zinc-400">
              {item.opcoes.map((o) => o.opcaoNome).join(' · ')}
            </span>
          )}
          {item.observacoes.map((obs, i) => (
            <span key={i} className="text-[9px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">
              {obs}
            </span>
          ))}
          {/* Hora que ficou pronto */}
          {item.ficouProntoEm && (
            <span className="text-[9px] text-green-600 font-semibold flex items-center gap-0.5">
              <i className="ri-check-double-line text-[9px]" />
              Pronto {new Date(item.ficouProntoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {/* Hora que foi entregue + quem entregou */}
          {item.entregueEm && (
            <span className="text-[9px] text-zinc-500 font-semibold flex items-center gap-0.5">
              <i className="ri-checkbox-circle-line text-[9px]" />
              Entregue {new Date(item.entregueEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              {item.quemEntregou && (
                <span className="ml-0.5 text-zinc-400">por {item.quemEntregou}</span>
              )}
            </span>
          )}
          {totalUnidades > 1 && deliveredCount > 0 && (
            <div className="flex items-center gap-1.5 ml-auto">
              <div className="flex gap-0.5">
                {Array.from({ length: totalUnidades }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`w-4 h-1.5 rounded-full transition-all ${idx < deliveredCount ? 'bg-green-500' : 'bg-zinc-200'}`}
                  />
                ))}
              </div>
              <span className="text-[9px] text-zinc-400 font-semibold whitespace-nowrap">
                {deliveredCount}/{totalUnidades} entregues
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PedidoCardProps {
  pedido: KDSPedido;
  deliveredCounts: Record<string, number>;
  onEntregarUm: (itemId: string) => void;
  onEntregarTodos: (pedidoId: string) => void;
  onEditar?: (item: KDSItem) => void;
  itensRemovidos?: Set<string>;
  itensEditados?: Record<string, { quantidade: number; observacoes: string[] }>;
}

function PedidoCard({ pedido, deliveredCounts, onEntregarUm, onEntregarTodos, onEditar, itensRemovidos, itensEditados }: PedidoCardProps) {
  useKDSTick();

  const elapsed = getElapsedSeconds(pedido.criadoEm);
  const maxSla = Math.max(...pedido.itens.map((i) => i.slaMinutos));
  const slaLevel = getSLALevel(elapsed, maxSla);
  const slaWidth = Math.min(100, (elapsed / (maxSla * 60)) * 100);

  // Compute effective statuses considering local deliveries
  const itensComStatus = pedido.itens.map((item) => {
    const count = deliveredCounts[item.id] ?? 0;
    const localmenteEntregue = count >= item.quantidade;
    return { ...item, effectiveStatus: localmenteEntregue ? 'entregue' : item.status };
  });

  const todosEntreguesLocalmente = itensComStatus.every((i) => i.effectiveStatus === 'entregue');
  const algumPronto = itensComStatus.some((i) => i.effectiveStatus === 'pronto');
  const isOriginalEntregue = pedido.status === 'entregue';
  const isEntregue = isOriginalEntregue || todosEntreguesLocalmente;

  // Itens prontos aguardando entrega
  const itensProntosParaEntregar = itensComStatus.filter((i) => i.effectiveStatus === 'pronto');

  const itensProntos = itensComStatus.filter(
    (i) => i.effectiveStatus === 'pronto' || i.effectiveStatus === 'entregue'
  ).length;
  const totalItens = pedido.itens.length;

  // Deriva status do card a partir dos itens (não confia no pedido.status que pode estar defasado)
  const algumEmPreparo = itensComStatus.some((i) => i.effectiveStatus === 'preparo');

  const cfgKey = isEntregue
    ? 'entregue'
    : algumPronto
      ? 'pronto'
      : algumEmPreparo
        ? 'preparo'
        : 'novo';

  const cfg = STATUS_CONFIG[cfgKey];

  return (
    <div className={`rounded-xl border-2 overflow-hidden transition-all ${
      isEntregue
        ? 'border-zinc-200 opacity-60'
        : algumPronto
          ? 'border-green-400 bg-green-50/30'
          : 'border-zinc-200 bg-white'
    }`}>
      {/* Card header */}
      <div className={`flex items-center gap-3 px-3 py-2.5 border-b border-zinc-100 ${
        isEntregue ? 'bg-zinc-100' : algumPronto ? 'bg-green-500' : 'bg-zinc-50'
      }`}>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className={`font-black text-base ${algumPronto && !isEntregue ? 'text-white' : 'text-zinc-900'}`}>
            #{pedido.numero}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
            algumPronto && !isEntregue
              ? 'bg-white/20 text-white'
              : `${cfg.bg} ${cfg.text}`
          }`}>
            <i className={`${cfg.icon} text-[10px] ${algumPronto && !isEntregue ? 'animate-bounce' : ''}`} />
            {cfg.label}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-semibold ${algumPronto && !isEntregue ? 'text-white' : 'text-zinc-500'}`}>
            {itensProntos}/{totalItens} itens
          </span>
          <span className={`text-xs font-black tabular-nums ${algumPronto && !isEntregue ? 'text-white' : SLA_COLORS[slaLevel]}`}>
            {formatElapsed(elapsed)}
          </span>
        </div>
      </div>

      {/* SLA bar */}
      {!isEntregue && (
        <div className="h-1 bg-zinc-100">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${algumPronto ? 'bg-green-400' : SLA_BG[slaLevel]}`}
            style={{ width: `${slaWidth}%` }}
          />
        </div>
      )}

      {/* Banner prontos com botão "Entregar tudo" */}
      {algumPronto && !isEntregue && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border-b border-green-200">
          <i className="ri-restaurant-2-line text-green-600 text-sm" />
          <p className="text-xs font-bold text-green-700 flex-1">
            {itensProntosParaEntregar.length === 1
              ? '1 item pronto para entregar'
              : `${itensProntosParaEntregar.length} itens prontos para entregar`}
          </p>
          <button
            onClick={() => onEntregarTodos(pedido.id)}
            className="flex items-center gap-1 text-[10px] font-bold bg-green-600 hover:bg-green-700 text-white px-2.5 py-1 rounded-full cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-check-double-line text-xs" />
            Entregar todos
          </button>
        </div>
      )}

      {/* Confirmar entrega completa */}
      {todosEntreguesLocalmente && !isOriginalEntregue && (
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 border-b border-zinc-200">
          <i className="ri-checkbox-circle-fill text-green-500 text-sm" />
          <p className="text-xs font-semibold text-zinc-600 flex-1">Todos os itens entregues!</p>
        </div>
      )}

      {/* Itens */}
      <div className="px-3 py-1">
        {pedido.itens.map((item) => (
          <ItemStatusRow
            key={item.id}
            item={item}
            deliveredCount={deliveredCounts[item.id] ?? 0}
            onEntregarUm={onEntregarUm}
            onEditar={onEditar}
            podeEditar={item.status === 'novo'}
          />
        ))}
      </div>
    </div>
  );
}

export default function StatusCozinhaView({ mesaNumero, nomeClienteAvulso }: Props) {
  useKDSTick();
  const { pedidos: allKDSPedidos } = useKDS();

  // Map de itemId -> quantas unidades foram marcadas como entregues pelo garçom
  const [deliveredCounts, setDeliveredCounts] = useState<Record<string, number>>({});
  const [itemEditando, setItemEditando] = useState<KDSItem | null>(null);
  const [itensEditados, setItensEditados] = useState<Record<string, { quantidade: number; observacoes: string[] }>>({});
  const [itensRemovidos, setItensRemovidos] = useState<Set<string>>(new Set());

  const handleEntregarUm = useCallback((itemId: string) => {
    setDeliveredCounts((prev) => {
      // Encontrar o item para saber o max
      const item = allKDSPedidos.flatMap((p) => p.itens).find((i) => i.id === itemId);
      const max = item?.quantidade ?? 1;
      const current = prev[itemId] ?? 0;
      if (current >= max) return prev;
      return { ...prev, [itemId]: current + 1 };
    });
  }, []);

  const handleEntregarTodos = useCallback((pedidoId: string) => {
    const pedido = allKDSPedidos.find((p) => p.id === pedidoId);
    if (!pedido) return;
    setDeliveredCounts((prev) => {
      const next = { ...prev };
      pedido.itens.forEach((item) => {
        if (item.status === 'pronto') {
          const current = next[item.id] ?? 0;
          if (current < item.quantidade) {
            next[item.id] = item.quantidade;
          }
        }
      });
      return next;
    });
  }, []);

  const pedidosMesa = useMemo(
    () => {
      let base = allKDSPedidos;
      if (mesaNumero) {
        base = base.filter((p) => p.destino === 'mesa' && p.mesaNumero === mesaNumero);
      } else if (nomeClienteAvulso) {
        // Para levar: filtrar por destino 'hora' ou 'nome' E pelo nome do cliente
        const nomeNorm = nomeClienteAvulso.trim().toLowerCase();
        base = base.filter(
          (p) =>
            (p.destino === 'hora' || p.destino === 'nome') &&
            (p.nomeCliente ?? '').trim().toLowerCase() === nomeNorm
        );
      }
      return base.sort((a, b) => b.criadoEm - a.criadoEm);
    },
    [mesaNumero, nomeClienteAvulso, allKDSPedidos]
  );

  const handleEditar = useCallback((item: KDSItem) => {
    setItemEditando(item);
  }, []);

  const handleSalvarEdicao = useCallback((itemId: string, updates: { quantidade: number; observacoes: string[] }) => {
    setItensEditados((prev) => ({ ...prev, [itemId]: updates }));
  }, []);

  const handleRemoverItem = useCallback((itemId: string) => {
    setItensRemovidos((prev) => new Set([...prev, itemId]));
  }, []);

  // Deriva o status efetivo de um pedido a partir dos itens + entregas locais
  const getEffectiveStatus = useCallback((p: KDSPedido) => {
    const todosEntreguesLoc = p.itens.every((i) => (deliveredCounts[i.id] ?? 0) >= i.quantidade);
    if (p.status === 'entregue' || todosEntreguesLoc) return 'entregue';

    const itensComStatus = p.itens.map((item) => {
      const count = deliveredCounts[item.id] ?? 0;
      return count >= item.quantidade ? 'entregue' : item.status;
    });

    if (itensComStatus.every((s) => s === 'entregue')) return 'entregue';
    if (itensComStatus.some((s) => s === 'pronto')) return 'pronto';
    if (itensComStatus.some((s) => s === 'preparo')) return 'preparo';
    return 'novo';
  }, [deliveredCounts]);

  // Compute summary considering local deliveries
  const summary = useMemo(() => {
    let naFila = 0, emPreparo = 0, prontos = 0, entregues = 0;
    pedidosMesa.forEach((p) => {
      const efetivo = getEffectiveStatus(p);
      if (efetivo === 'entregue') entregues++;
      else if (efetivo === 'pronto') prontos++;
      else if (efetivo === 'preparo') emPreparo++;
      else naFila++;
    });
    return { naFila, emPreparo, prontos, entregues };
  }, [pedidosMesa, deliveredCounts, getEffectiveStatus]);

  const ativos = pedidosMesa.filter((p) => getEffectiveStatus(p) !== 'entregue');

  const entregues = pedidosMesa.filter((p) => getEffectiveStatus(p) === 'entregue');

  const temProntos = summary.prontos > 0;

  if (pedidosMesa.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-restaurant-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500 mb-1">Nenhum pedido na cozinha</p>
        <p className="text-xs text-zinc-400">
          {nomeClienteAvulso
            ? 'Os pedidos para levar aparecem aqui quando enviados ao KDS'
            : 'Os pedidos enviados ao KDS aparecerão aqui'
          }
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Para levar tag */}
      {nomeClienteAvulso && (
        <div className="flex items-center gap-2 px-4 py-2 bg-sky-50 border-b border-sky-200 flex-shrink-0">
          <i className="ri-shopping-bag-2-line text-sky-500 text-sm" />
          <p className="text-xs font-semibold text-sky-700">
            Pedidos para levar · {pedidosMesa.length} {pedidosMesa.length === 1 ? 'pedido' : 'pedidos'}
          </p>
          <span className="ml-auto text-[10px] bg-sky-100 text-sky-600 border border-sky-200 px-2 py-0.5 rounded-full font-bold">
            PARA LEVAR
          </span>
        </div>
      )}
      {itensEditados && Object.keys(itensEditados).length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 flex-shrink-0">
          <i className="ri-pencil-line text-amber-500 text-sm" />
          <p className="text-[10px] font-semibold text-amber-700">
            {Object.keys(itensEditados).length} {Object.keys(itensEditados).length === 1 ? 'item editado' : 'itens editados'} localmente — aguardando sincronização com o KDS
          </p>
        </div>
      )}

      {/* Summary strip */}
      <div className="flex gap-2 px-3 py-2.5 sm:py-3 bg-zinc-50 border-b border-zinc-100 flex-shrink-0 overflow-x-auto">
        {summary.naFila > 0 && (
          <div className="flex items-center gap-1.5 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 flex-shrink-0">
            <i className="ri-time-line text-zinc-500 text-sm" />
            <span className="text-xs font-bold text-zinc-700">{summary.naFila}</span>
            <span className="text-[10px] text-zinc-400">na fila</span>
          </div>
        )}
        {summary.emPreparo > 0 && (
          <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 flex-shrink-0">
            <i className="ri-fire-line text-amber-500 text-sm animate-pulse" />
            <span className="text-xs font-bold text-amber-700">{summary.emPreparo}</span>
            <span className="text-[10px] text-amber-600">em preparo</span>
          </div>
        )}
        {summary.prontos > 0 && (
          <div className="flex items-center gap-1.5 bg-green-50 border border-green-300 rounded-lg px-3 py-1.5 flex-shrink-0">
            <i className="ri-check-double-line text-green-600 text-sm" />
            <span className="text-xs font-black text-green-700">{summary.prontos}</span>
            <span className="text-[10px] text-green-600 font-semibold">prontos!</span>
          </div>
        )}
        {summary.entregues > 0 && (
          <div className="flex items-center gap-1.5 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 flex-shrink-0">
            <i className="ri-checkbox-circle-line text-zinc-400 text-sm" />
            <span className="text-xs font-bold text-zinc-500">{summary.entregues}</span>
            <span className="text-[10px] text-zinc-400">entregues</span>
          </div>
        )}
      </div>

      {/* Alert banner para prontos */}
      {temProntos && (
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-green-500 flex-shrink-0">
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            <i className="ri-restaurant-2-line text-white text-sm animate-bounce" />
          </div>
          <p className="text-xs font-bold text-white flex-1 truncate">
            {summary.prontos === 1
              ? '1 pedido aguardando entrega!'
              : `${summary.prontos} pedidos aguardando entrega!`}
          </p>
        </div>
      )}

      {/* Lista de pedidos */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {ativos.map((p) => (
          <PedidoCard
            key={p.id}
            pedido={p}
            deliveredCounts={deliveredCounts}
            onEntregarUm={handleEntregarUm}
            onEntregarTodos={handleEntregarTodos}
            onEditar={handleEditar}
            itensRemovidos={itensRemovidos}
            itensEditados={itensEditados}
          />
        ))}

        {entregues.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2 mt-1">
              Já entregues
            </p>
            {entregues.map((p) => (
              <PedidoCard
                key={p.id}
                pedido={p}
                deliveredCounts={deliveredCounts}
                onEntregarUm={handleEntregarUm}
                onEntregarTodos={handleEntregarTodos}
                onEditar={handleEditar}
                itensRemovidos={itensRemovidos}
                itensEditados={itensEditados}
              />
            ))}
          </div>
        )}
      </div>

      {itemEditando && (
        <EditarItemCozinhaModal
          item={itemEditando}
          onSalvar={handleSalvarEdicao}
          onRemover={handleRemoverItem}
          onClose={() => setItemEditando(null)}
        />
      )}
    </div>
  );
}
