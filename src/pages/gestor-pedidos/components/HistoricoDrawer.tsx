import { useMemo, useState } from 'react';
import type { KDSPedido } from '@/types/kds';

interface Props {
  pedidos: KDSPedido[];
  onClose: () => void;
  onOpenDetail: (pedidoId: string) => void;
}

type Tab = 'entregues' | 'cancelados';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function horaStr(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function duracaoStr(criadoEm: number, prontoEm?: number): string {
  const ref = prontoEm ?? Date.now();
  const m = Math.round((ref - criadoEm) / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}m`;
}

function destinoLabel(p: KDSPedido): string {
  if (p.destino === 'mesa') return `Mesa ${p.mesaNumero}${p.nomeCliente ? ` · ${p.nomeCliente}` : ''}`;
  if (p.destino === 'delivery' && p.nomeCliente) return p.nomeCliente;
  if (p.destino === 'delivery') return 'Delivery';
  if (p.nomeCliente) return p.nomeCliente;
  if (p.senha) return `Senha ${p.senha}`;
  return 'Balcão';
}

const ORIGEM_LABELS: Record<string, { label: string; cor: string }> = {
  caixa:           { label: 'Caixa',    cor: 'bg-violet-100 text-violet-700' },
  garcom:          { label: 'Garçom',   cor: 'bg-sky-100 text-sky-700' },
  autoatendimento: { label: 'Autoatendimento',    cor: 'bg-pink-100 text-pink-700' },
  mesa_qr:         { label: 'QR',       cor: 'bg-teal-100 text-teal-700' },
  mesa:            { label: 'QR',       cor: 'bg-teal-100 text-teal-700' },
  delivery:        { label: 'Delivery', cor: 'bg-orange-100 text-orange-700' },
};

function CancelMetrics({ cancelados }: { cancelados: KDSPedido[] }) {
  const motivoCount = cancelados.reduce<Record<string, number>>((acc, p) => {
    const motivo = p.cancelReason ?? 'Sem motivo';
    acc[motivo] = (acc[motivo] ?? 0) + 1;
    return acc;
  }, {});
  const top = Object.entries(motivoCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const totalCancelado = cancelados.reduce((acc, p) => acc + (p.totalAmount ?? 0), 0);

  return (
    <div className="border-b border-zinc-100 flex-shrink-0 px-4 py-3 bg-red-50/40">
      <div className="flex items-center gap-4 flex-wrap mb-2">
        <div className="flex items-center gap-1.5">
          <i className="ri-close-circle-line text-red-500 text-sm" />
          <span className="text-sm font-black text-red-600">{cancelados.length}</span>
          <span className="text-[10px] text-zinc-400 uppercase tracking-wide">cancelados</span>
        </div>
        {totalCancelado > 0 && (
          <div className="flex items-center gap-1.5">
            <i className="ri-money-dollar-circle-line text-red-400 text-sm" />
            <span className="text-sm font-black text-red-500">{fmt.format(totalCancelado)}</span>
            <span className="text-[10px] text-zinc-400 uppercase tracking-wide">perdidos</span>
          </div>
        )}
      </div>
      {top.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {top.map(([motivo, count]) => (
            <span key={motivo} className="flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">
              <i className="ri-information-line text-[9px]" />
              {motivo}
              <span className="bg-red-200 text-red-800 px-1 rounded-full font-black">{count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HistoricoDrawer({ pedidos, onClose, onOpenDetail }: Props) {
  const [tab, setTab] = useState<Tab>('entregues');
  const [busca, setBusca] = useState('');

  const entregues = useMemo(
    () => pedidos.filter((p) => p.status === 'entregue' && !p.isCancelled).sort((a, b) => b.criadoEm - a.criadoEm),
    [pedidos],
  );

  const cancelados = useMemo(
    () => pedidos.filter((p) => p.isCancelled).sort((a, b) => b.criadoEm - a.criadoEm),
    [pedidos],
  );

  const fonte = tab === 'entregues' ? entregues : cancelados;

  const filtrados = useMemo(() => {
    if (!busca.trim()) return fonte;
    const q = busca.trim().toLowerCase().replace(/^#/, '');
    return fonte.filter(
      (p) =>
        String(p.numero).includes(q) ||
        (p.nomeCliente?.toLowerCase().includes(q)) ||
        (p.mesaNumero ? String(p.mesaNumero).includes(q) : false),
    );
  }, [fonte, busca]);

  // Totais para entregues
  const totalFaturamento = useMemo(
    () => entregues.reduce((acc, p) => acc + (p.totalAmount ?? 0), 0),
    [entregues],
  );
  const ticketMedio = entregues.length > 0 ? totalFaturamento / entregues.length : 0;

  const duracaoMedia = useMemo(() => {
    const com = entregues.filter((p) => p.itens.some((i) => i.ficouProntoEm));
    if (com.length === 0) return null;
    const sum = com.reduce((acc, p) => {
      const prontoEm = Math.max(...p.itens.map((i) => i.ficouProntoEm ?? 0).filter(Boolean));
      return acc + (prontoEm - p.criadoEm) / 60000;
    }, 0);
    return Math.round(sum / com.length);
  }, [entregues]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col-reverse sm:flex-row sm:justify-end" onClick={onClose}>
      <div
        className="w-full sm:max-w-xl bg-white h-[85vh] sm:h-full flex flex-col overflow-hidden rounded-t-2xl sm:rounded-none animate-[slideInUp_0.25s_ease-out] sm:animate-[slideInRight_0.25s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle no mobile */}
        <div className="flex justify-center pt-2 pb-0 sm:hidden flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-zinc-200" />
        </div>
        {/* Header */}
        <div className="bg-zinc-50 border-b border-zinc-100 px-5 py-4 flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-200 flex-shrink-0">
            <i className="ri-history-line text-zinc-600 text-base" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-zinc-800 leading-none">Histórico da Sessão</h2>
            <p className="text-[10px] text-zinc-400 mt-0.5">{entregues.length} entregue{entregues.length !== 1 ? 's' : ''} · {cancelados.length} cancelado{cancelados.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-200 text-zinc-400 cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Métricas rápidas */}
        {tab === 'entregues' && entregues.length > 0 && (
          <div className="flex items-stretch gap-0 border-b border-zinc-100 flex-shrink-0">
            {[
              { label: 'Pedidos', value: String(entregues.length), icon: 'ri-shopping-bag-line', color: 'text-zinc-700' },
              { label: 'Faturamento', value: fmt.format(totalFaturamento), icon: 'ri-money-dollar-circle-line', color: 'text-emerald-600' },
              { label: 'Ticket médio', value: fmt.format(ticketMedio), icon: 'ri-bill-line', color: 'text-zinc-600' },
              ...(duracaoMedia !== null ? [{ label: 'Tempo médio', value: `${duracaoMedia}min`, icon: 'ri-timer-line', color: Number(duracaoMedia) > 20 ? 'text-red-500' : 'text-emerald-600' }] : []),
            ].map((s, i) => (
              <div key={i} className="flex-1 flex flex-col items-center py-3 px-2 border-r border-zinc-100 last:border-r-0">
                <i className={`${s.icon} ${s.color} text-sm mb-1`} />
                <p className={`text-sm font-black leading-none ${s.color}`}>{s.value}</p>
                <p className="text-[9px] text-zinc-400 uppercase tracking-wide mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}
        {tab === 'cancelados' && cancelados.length > 0 && (
          <CancelMetrics cancelados={cancelados} />
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-2.5 border-b border-zinc-100 flex-shrink-0 bg-zinc-50">
          {([
            { key: 'entregues' as Tab, label: 'Entregues', count: entregues.length, icon: 'ri-checkbox-circle-line', active: 'bg-zinc-800 text-white', inactive: 'bg-zinc-100 text-zinc-600' },
            { key: 'cancelados' as Tab, label: 'Cancelados', count: cancelados.length, icon: 'ri-close-circle-line', active: 'bg-red-600 text-white', inactive: 'bg-zinc-100 text-zinc-600' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${tab === t.key ? t.active : t.inactive + ' hover:bg-zinc-200'}`}
            >
              <i className={`${t.icon} text-sm`} />
              {t.label}
              {t.count > 0 && (
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-white/20' : 'bg-zinc-200 text-zinc-500'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
          <div className="ml-auto relative">
            <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs pointer-events-none" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar..."
              className="pl-7 pr-3 py-1.5 text-xs border border-zinc-200 rounded-lg bg-white text-zinc-800 focus:outline-none focus:border-zinc-400 w-28"
            />
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {filtrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-zinc-100">
                <i className="ri-inbox-2-line text-2xl text-zinc-300" />
              </div>
              <p className="text-sm text-zinc-400 font-medium">
                {busca ? 'Nenhum resultado' : tab === 'entregues' ? 'Nenhum pedido entregue ainda' : 'Nenhum cancelamento nesta sessão'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {filtrados.map((p) => {
                const origemInfo = ORIGEM_LABELS[p.origem] ?? { label: p.origem, cor: 'bg-zinc-100 text-zinc-600' };
                const prontoEm = p.itens.reduce((acc, i) => Math.max(acc, i.ficouProntoEm ?? 0), 0);
                const entregueEm = p.itens.reduce((acc, i) => Math.max(acc, i.entregueEm ?? 0), 0);

                return (
                  <div
                    key={p.id}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 cursor-pointer transition-colors"
                    onClick={() => onOpenDetail(p.id)}
                  >
                    {/* Indicator */}
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${p.isCancelled ? 'bg-red-400' : 'bg-emerald-400'}`} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-zinc-800 tracking-tight">
                          #{String(p.numero).padStart(4, '0')}
                        </span>
                        {(p.origem === 'delivery' || p.destino === 'delivery') ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                            <i className="ri-motorbike-line text-[7px] mr-0.5" />Delivery
                          </span>
                        ) : (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${origemInfo.cor}`}>
                            {origemInfo.label}
                          </span>
                        )}
                        <span className="text-xs font-medium text-zinc-600 truncate flex-1 min-w-0">
                          {destinoLabel(p)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-zinc-400">
                          <i className="ri-time-line text-[9px] mr-0.5" />
                          {horaStr(p.criadoEm)}
                          {entregueEm > 0 && ` → ${horaStr(entregueEm)}`}
                        </span>
                        {(prontoEm > 0 || entregueEm > 0) && (
                          <span className="text-[10px] text-zinc-400">
                            <i className="ri-timer-line text-[9px] mr-0.5" />
                            {duracaoStr(p.criadoEm, prontoEm > 0 ? prontoEm : undefined)}
                          </span>
                        )}
                        {p.isCancelled && p.cancelReason && (
                          <span className="text-[10px] text-red-500 font-medium truncate">
                            <i className="ri-information-line text-[9px] mr-0.5" />{p.cancelReason}
                          </span>
                        )}
                      </div>

                      {/* Itens resumo */}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {p.itens.slice(0, 4).map((item) => (
                          <span key={item.id} className="text-[9px] text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                            {item.quantidade}x {item.nome}
                          </span>
                        ))}
                        {p.itens.length > 4 && (
                          <span className="text-[9px] text-zinc-400 px-1 whitespace-nowrap">+{p.itens.length - 4}</span>
                        )}
                      </div>
                    </div>

                    {/* Valor */}
                    <div className="flex-shrink-0 text-right">
                      {p.totalAmount > 0 && (
                        <p className="text-xs font-bold text-zinc-700">{fmt.format(p.totalAmount)}</p>
                      )}
                      {p.isPaid && !p.isCancelled && (
                        <p className="text-[9px] text-emerald-600 font-bold">Pago</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
