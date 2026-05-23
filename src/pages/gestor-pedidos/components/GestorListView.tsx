import { useState, useMemo } from 'react';
import type { KDSPedido, KDSItem } from '@/types/kds';
import { formatOrderNumber } from '@/lib/statusMappers';
import FichaTecnicaKDSModal from '@/pages/kds/components/FichaTecnicaKDSModal';
import { printHTML } from '@/lib/printUtils';

interface Props {
  pedidos: KDSPedido[];
  onAvancar: (pedidoId: string) => void;
  onEntregar: (pedidoId: string) => void;
  onMudarOperador: (pedidoId: string, operador: string) => void;
  onCancelar: (pedidoId: string) => void;
  onOpenDetail: (pedidoId: string) => void;
  operadorAtual?: string;
  tick: number;
  filtroEstacao?: string;
}

const STATUS_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  novo:      { label: 'Aguardando', cls: 'bg-zinc-100 text-zinc-600 border border-zinc-200',     dot: 'bg-zinc-400' },
  preparo:   { label: 'Em Preparo', cls: 'bg-amber-100 text-amber-700 border border-amber-200',  dot: 'bg-amber-500 animate-pulse' },
  pronto:    { label: 'Pronto',     cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200', dot: 'bg-emerald-500' },
  entregue:  { label: 'Entregue',   cls: 'bg-zinc-100 text-zinc-400 border border-zinc-200',     dot: 'bg-zinc-300' },
  cancelado: { label: 'Cancelado',  cls: 'bg-red-100 text-red-600 border border-red-200',        dot: 'bg-red-400' },
};

const ORIGEM_STYLE: Record<string, { label: string; cls: string }> = {
  caixa:           { label: 'Caixa',    cls: 'bg-violet-100 text-violet-700 border border-violet-200' },
  garcom:          { label: 'Garçom',   cls: 'bg-sky-100 text-sky-700 border border-sky-200' },
  autoatendimento: { label: 'Kiosk',    cls: 'bg-pink-100 text-pink-700 border border-pink-200' },
  mesa_qr:         { label: 'QR',       cls: 'bg-teal-100 text-teal-700 border border-teal-200' },
  mesa:            { label: 'Mesa QR',  cls: 'bg-teal-100 text-teal-700 border border-teal-200' },
  delivery:        { label: 'Delivery', cls: 'bg-orange-100 text-orange-700 border border-orange-200' },
};

function elapsedStr(criadoEm: number): string {
  const s = Math.floor((Date.now() - criadoEm) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

function elapsedMin(criadoEm: number): number {
  return (Date.now() - criadoEm) / 60000;
}

function timerCls(criadoEm: number, status: string): string {
  if (status === 'entregue') return 'text-zinc-400';
  const m = elapsedMin(criadoEm);
  if (m > 20) return 'text-red-500 font-black';
  if (m > 10) return 'text-amber-500 font-bold';
  return 'text-emerald-600 font-semibold';
}

function rowUrgencyClass(criadoEm: number, status: string): string {
  if (status === 'entregue' || status === 'pronto') return '';
  const m = elapsedMin(criadoEm);
  if (m > 20) return 'bg-red-50 border-l-2 border-red-400';
  if (m > 10) return 'bg-amber-50/60 border-l-2 border-amber-300';
  return '';
}

function destinoStr(p: KDSPedido): string {
  if (p.destino === 'mesa') {
    return p.nomeCliente ? `Mesa ${p.mesaNumero} · ${p.nomeCliente}` : `Mesa ${p.mesaNumero}`;
  }
  if (p.destino === 'nome' && p.nomeCliente) return p.nomeCliente;
  if (p.destino === 'senha' && p.senha) return `Senha ${p.senha}`;
  if (p.destino === 'delivery' && p.nomeCliente) return `Delivery · ${p.nomeCliente}`;
  if (p.destino === 'delivery') return 'Delivery';
  return 'Balcão';
}

type SortKey = 'numero' | 'tempo' | 'origem' | 'destino' | 'status' | 'valor';
type SortDir = 'asc' | 'desc';

// ─── Linha expandida com detalhes completos ───
function RowDetail({ pedido, filtroEstacao }: { pedido: KDSPedido; filtroEstacao?: string }) {
  const kitchenItens = pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds);
  const directItens = pedido.itens.filter((i) => i.semPreparo || i.skip_kds);

  const renderItem = (item: KDSItem, isSkip: boolean) => {
    const isDimmed = filtroEstacao && filtroEstacao !== 'todas' && item.estacao !== filtroEstacao;
    return (
      <div key={item.id} className={`transition-opacity ${isDimmed ? 'opacity-25' : ''}`}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-zinc-400 w-5 text-right flex-shrink-0">{item.quantidade}x</span>
          <span className={`text-xs font-semibold ${isSkip ? 'text-zinc-400' : 'text-zinc-700'}`}>{item.nome}</span>
          {item.categoriaNome && !isSkip && (
            <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-zinc-200 whitespace-nowrap">
              {item.categoriaNome}
            </span>
          )}
          {isSkip && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-zinc-100 text-zinc-400 border border-zinc-200 whitespace-nowrap">
              direto
            </span>
          )}

        </div>
        {item.opcoes && item.opcoes.length > 0 && (
          <div className="ml-7 mt-0.5 flex flex-wrap gap-1">
            {item.opcoes.map((o, i) => (
              <span key={i} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 whitespace-nowrap">
                <i className="ri-add-line text-[8px]" /> {o.opcaoNome}
              </span>
            ))}
          </div>
        )}
        {item.observacoes && item.observacoes.length > 0 && (
          <div className="ml-7 mt-0.5 space-y-0.5">
            {item.observacoes.map((obs, i) => (
              <div key={i} className="flex items-start gap-1 text-[9px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-1 rounded">
                <i className="ri-alert-fill text-amber-500 text-[9px] flex-shrink-0 mt-0.5" />
                <span>{obs}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="col-span-full bg-zinc-50 border-t border-zinc-100 px-4 py-3 grid grid-cols-2 gap-4">
      {kitchenItens.length > 0 && (
        <div>
          <p className="text-[9px] font-black text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <i className="ri-fire-line text-amber-500" />Itens de Cozinha
          </p>
          <div className="space-y-1.5">
            {kitchenItens.map((item) => renderItem(item, false))}
          </div>
        </div>
      )}
      {directItens.length > 0 && (
        <div>
          <p className="text-[9px] font-black text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <i className="ri-cup-line text-zinc-400" />Direto (sem preparo)
          </p>
          <div className="space-y-1.5">
            {directItens.map((item) => renderItem(item, true))}
          </div>
        </div>
      )}
      {pedido.garcomNome && (
        <div className="col-span-2 pt-1 border-t border-zinc-200 flex items-center gap-2">
          <i className="ri-walk-line text-zinc-400 text-xs" />
          <span className="text-[10px] text-zinc-500">Garçom: <strong className="text-zinc-700">{pedido.garcomNome}</strong></span>
        </div>
      )}
      {/* Quem entregou cada item */}
      {pedido.itens.some((i) => i.quemEntregou || i.entregueEm) && (
        <div className="col-span-2 pt-1 border-t border-zinc-200">
          <p className="text-[9px] font-black text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <i className="ri-checkbox-circle-line text-zinc-400" />Entregas
          </p>
          <div className="flex flex-wrap gap-2">
            {pedido.itens.filter((i) => i.quemEntregou || i.entregueEm).map((item) => (
              <div key={item.id} className="flex items-center gap-1.5 text-[10px] text-zinc-600 bg-zinc-50 px-2 py-1 rounded-lg border border-zinc-200">
                <span className="font-semibold">{item.quantidade}x {item.nome}</span>
                {item.quemEntregou && (
                  <span className="text-zinc-400">— por <strong>{item.quemEntregou}</strong></span>
                )}
                {item.entregueEm && (
                  <span className="text-zinc-400">
                    {new Date(item.entregueEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* BUG 3.8: Dados de contato do cliente */}
      {(pedido.customerPhone || pedido.customerCpf || pedido.customerEmail) && (
        <div className="col-span-2 pt-1 border-t border-zinc-200">
          <p className="text-[9px] font-black text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <i className="ri-user-3-line text-zinc-400" />Cliente
          </p>
          <div className="flex flex-wrap gap-3">
            {pedido.customerPhone && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                <i className="ri-phone-line text-zinc-400 text-[10px]" />{pedido.customerPhone}
              </span>
            )}
            {pedido.customerCpf && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                <i className="ri-id-card-line text-zinc-400 text-[10px]" />CPF: {pedido.customerCpf}
              </span>
            )}
            {pedido.customerEmail && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                <i className="ri-mail-line text-zinc-400 text-[10px]" />{pedido.customerEmail}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GestorListView({ pedidos, onAvancar, onEntregar, onCancelar, onOpenDetail, tick, filtroEstacao }: Props) {
  void tick;
  const [fichaItens, setFichaItens] = useState<{ nome: string; quantidade: number; menuItemId?: string }[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('tempo');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    const arr = [...pedidos];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'numero') cmp = a.numero - b.numero;
      else if (sortKey === 'tempo') cmp = a.criadoEm - b.criadoEm;
      else if (sortKey === 'origem') cmp = a.origem.localeCompare(b.origem);
      else if (sortKey === 'destino') cmp = destinoStr(a).localeCompare(destinoStr(b));
      else if (sortKey === 'valor') cmp = (a.totalAmount ?? 0) - (b.totalAmount ?? 0);
      else if (sortKey === 'status') {
        const order: Record<string, number> = { novo: 0, preparo: 1, pronto: 2, entregue: 3, em_rota: 2 };
        cmp = (order[a.status] ?? 0) - (order[b.status] ?? 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [pedidos, sortKey, sortDir]);

  const handlePrint = (p: KDSPedido) => {
    printHTML(`<html><head><title>Pedido #${p.numero}</title>
      <style>body{font-family:monospace;font-size:12px;padding:16px}h2{margin:0 0 4px}hr{border:1px dashed #000}.item{margin:4px 0}.obs{color:red;font-weight:bold;font-size:11px}p{margin:2px 0;font-size:11px}</style>
      </head><body>
      <h2>Pedido #${String(p.numero).padStart(4, '0')}</h2>
      <p>${destinoStr(p)} &mdash; ${p.origem}</p>
      ${p.garcomNome ? `<p>Gar&ccedil;om: ${p.garcomNome}</p>` : ''}
      <hr/>
      ${p.itens.map((i) => `
        <div class="item"><strong>${i.quantidade}x ${i.nome}</strong>
        ${i.opcoes?.length ? `<div style="padding-left:10px;font-size:11px">${i.opcoes.map((o) => `+ ${o.opcaoNome}`).join(', ')}</div>` : ''}
        ${i.observacoes?.length ? `<div class="obs">${i.observacoes.map((o) => `&#9888; ${o}`).join('<br/>')}</div>` : ''}
        </div>`).join('')}
      <hr/>
      <small>${new Date().toLocaleString('pt-BR')}</small>
      </body></html>`);
  };

  function SortTh({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col;
    return (
      <button
        onClick={() => handleSort(col)}
        className={`flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors whitespace-nowrap select-none ${
          active ? 'text-amber-600' : 'text-zinc-400 hover:text-zinc-600'
        }`}
      >
        {label}
        <i className={`text-[9px] ml-0.5 ${
          active
            ? sortDir === 'asc' ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'
            : 'ri-expand-up-down-line opacity-40'
        }`} />
      </button>
    );
  }

  return (
    <>
      {fichaItens && (
        <FichaTecnicaKDSModal
          itens={fichaItens}
          onClose={() => setFichaItens(null)}
        />
      )}

      <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden flex flex-col h-full">

        {/* ── MOBILE: cards empilhados ── */}
        <div className="flex-1 overflow-y-auto lg:hidden">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-zinc-100">
                <i className="ri-inbox-2-line text-2xl text-zinc-300" />
              </div>
              <p className="text-sm text-zinc-400 font-medium">Nenhum pedido</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {sorted.map((p) => {
                const isCancelled = p.isCancelled;
                const stStyle = isCancelled ? STATUS_STYLE.cancelado : (STATUS_STYLE[p.status] ?? STATUS_STYLE.novo);
                const oStyle = ORIGEM_STYLE[p.origem] ?? { label: p.origem, cls: 'bg-zinc-100 text-zinc-500 border border-zinc-200' };
                const temObs = p.itens.some((i) => i.observacoes && i.observacoes.length > 0);
                const isExpanded = expandedId === p.id;
                const isPaid = p.isPaid ?? false;
                const temItemComPreparo = p.itens.some((i) => !i.semPreparo && !i.skip_kds);
                const urgRow = rowUrgencyClass(p.criadoEm, p.status);

                return (
                  <div key={p.id} className={`${p.status === 'entregue' && !isCancelled ? 'opacity-50' : ''} ${isCancelled ? 'bg-red-50/50' : ''}`}>
                    {/* Card header */}
                    <div
                      className={`px-3 py-3 cursor-pointer transition-colors ${isCancelled ? '' : urgRow}`}
                      onClick={() => setExpandedId(isExpanded ? null : p.id)}
                    >
                      {/* Linha 1: número + origem + status + timer */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <i className={`text-[10px] text-zinc-400 ${isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}`} />
                        <button
                          onClick={(e) => { e.stopPropagation(); onOpenDetail(p.id); }}
                          className="text-sm font-black text-zinc-800 tracking-tight hover:underline cursor-pointer"
                        >
                          {formatOrderNumber(p.numeroStr, p.numero)}
                        </button>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${oStyle.cls}`}>
                          {oStyle.label}
                        </span>
                        <div className="flex items-center gap-1 ml-auto">
                          <span className={`w-1.5 h-1.5 rounded-full ${stStyle.dot}`} />
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${stStyle.cls}`}>
                            {stStyle.label}
                          </span>
                          <span className={`text-xs tabular-nums ml-1 ${isCancelled ? 'text-red-400' : timerCls(p.criadoEm, p.status)}`}>
                            {elapsedStr(p.criadoEm)}
                          </span>
                        </div>
                      </div>

                      {/* Linha 2: destino + itens resumo */}
                      <div className="flex items-start gap-2 ml-4">
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <i className={`text-[10px] text-zinc-400 ${
                            p.destino === 'mesa' ? 'ri-table-line' :
                            p.destino === 'delivery' ? 'ri-motorbike-line' : 'ri-user-line'
                          }`} />
                          <span className="text-xs text-zinc-700 font-semibold whitespace-nowrap">{destinoStr(p)}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                          {p.itens.slice(0, 2).map((item) => (
                            <span key={item.id} className="text-[10px] text-zinc-500 whitespace-nowrap">
                              {item.quantidade}x {item.nome}
                            </span>
                          ))}
                          {p.itens.length > 2 && (
                            <span className="text-[10px] text-zinc-400">+{p.itens.length - 2}</span>
                          )}
                          {temObs && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
                              <i className="ri-alert-fill text-[9px]" />obs
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Linha 3: ações */}
                      <div className="flex items-center gap-1.5 mt-2.5 ml-4" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handlePrint(p)}
                          className="w-7 h-7 flex items-center justify-center bg-zinc-100 text-zinc-500 rounded-lg cursor-pointer"
                        >
                          <i className="ri-printer-line text-sm" />
                        </button>
                        {temItemComPreparo && (
                          <button
                            onClick={() => setFichaItens(p.itens.filter((i) => !i.semPreparo && !i.skip_kds).map((i) => ({ nome: i.nome, quantidade: i.quantidade, menuItemId: i.menuItemId })))}
                            className="w-7 h-7 flex items-center justify-center bg-zinc-100 text-zinc-500 rounded-lg cursor-pointer"
                          >
                            <i className="ri-clipboard-line text-sm" />
                          </button>
                        )}
                        <div className="flex-1" />
                        {isPaid ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                            <i className="ri-check-line text-[8px] mr-0.5" />Pago
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200 whitespace-nowrap">
                            Aberto
                          </span>
                        )}
                        {isCancelled ? (
                          <span className="text-[10px] text-red-400 font-bold whitespace-nowrap">Cancelado</span>
                        ) : p.status === 'entregue' ? (
                          <span className="text-[10px] text-zinc-300 font-medium">Concluído</span>
                        ) : p.status === 'pronto' ? (
                          p.origem === 'autoatendimento' && !p.isPaid ? (
                            <span className="flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg whitespace-nowrap">
                              <i className="ri-store-2-line text-[9px]" />Pagar no caixa
                            </span>
                          ) : (
                            <button
                              onClick={() => onEntregar(p.id)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-zinc-900 text-white text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap"
                            >
                              <i className="ri-check-double-line text-sm" />Entregar
                            </button>
                          )
                        ) : (
                          <>
                            <button
                              onClick={() => onAvancar(p.id)}
                              className={`flex items-center gap-1 px-3 py-1.5 text-white text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap ${
                                p.status === 'novo' ? 'bg-amber-500' : 'bg-emerald-500'
                              }`}
                            >
                              <i className={`text-sm ${p.status === 'novo' ? 'ri-play-fill' : 'ri-checkbox-circle-line'}`} />
                              {p.status === 'novo' ? 'Iniciar' : 'Pronto'}
                            </button>
                            <button
                              onClick={() => onCancelar(p.id)}
                              className="w-7 h-7 flex items-center justify-center bg-zinc-50 border border-zinc-200 text-zinc-400 rounded-lg cursor-pointer"
                            >
                              <i className="ri-close-circle-line text-sm" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <RowDetail pedido={p} filtroEstacao={filtroEstacao} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── DESKTOP: tabela ── */}
        <div className="hidden lg:flex flex-col flex-1 overflow-hidden">
          {/* Cabeçalho */}
          <div className="grid grid-cols-[110px_68px_76px_140px_1fr_110px_72px_190px] bg-zinc-50 border-b border-zinc-100 px-3 py-2.5 flex-shrink-0 gap-3 items-center">
            <SortTh label="#" col="numero" />
            <SortTh label="Tempo" col="tempo" />
            <SortTh label="Origem" col="origem" />
            <SortTh label="Destino" col="destino" />
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Itens</span>
            <SortTh label="Status" col="status" />
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Pgto</span>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Ações</span>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-auto">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-zinc-100">
                  <i className="ri-inbox-2-line text-2xl text-zinc-300" />
                </div>
                <p className="text-sm text-zinc-400 font-medium">Nenhum pedido</p>
              </div>
            ) : (
              <div className="min-w-[960px]">
                {sorted.map((p) => {
                  const isCancelled = p.isCancelled;
                  const stStyle = isCancelled ? STATUS_STYLE.cancelado : (STATUS_STYLE[p.status] ?? STATUS_STYLE.novo);
                  const oStyle = ORIGEM_STYLE[p.origem] ?? { label: p.origem, cls: 'bg-zinc-100 text-zinc-500 border border-zinc-200' };
                  const temObs = p.itens.some((i) => i.observacoes && i.observacoes.length > 0);
                  const isExpanded = expandedId === p.id;
                  const isPaid = p.isPaid ?? false;
                  const urgRow = rowUrgencyClass(p.criadoEm, p.status);
                  const temItemComPreparo = p.itens.some((i) => !i.semPreparo && !i.skip_kds);

                  return (
                    <div key={p.id} className={`border-b border-zinc-50 last:border-0 ${p.status === 'entregue' && !isCancelled ? 'opacity-50' : ''} ${isCancelled ? 'bg-red-50/50' : ''}`}>
                      <div
                        className={`grid grid-cols-[110px_68px_76px_140px_1fr_110px_72px_190px] px-3 py-3 transition-colors items-center gap-3 cursor-pointer hover:bg-zinc-50/80 ${isCancelled ? '' : urgRow}`}
                        onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <i className={`text-[9px] flex-shrink-0 ${isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-zinc-400`} />
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpenDetail(p.id); }}
                            title="Ver detalhes completos"
                            className="text-[11px] font-black text-zinc-800 tracking-tight hover:underline cursor-pointer truncate"
                          >
                            {formatOrderNumber(p.numeroStr, p.numero)}
                          </button>
                        </div>
                        <div className="flex items-center">
                          <span className={`text-xs tabular-nums ${isCancelled ? 'text-red-400' : timerCls(p.criadoEm, p.status)}`}>
                            {elapsedStr(p.criadoEm)}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full w-fit ${oStyle.cls}`}>
                            {oStyle.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 min-w-0">
                          <i className={`text-[10px] text-zinc-400 flex-shrink-0 ${
                            p.destino === 'mesa' ? 'ri-table-line' :
                            p.destino === 'delivery' ? 'ri-motorbike-line' : 'ri-user-line'
                          }`} />
                          <span className="text-xs text-zinc-700 truncate font-medium">{destinoStr(p)}</span>
                        </div>
                        <div className="pr-2 min-w-0">
                          <div className="flex flex-wrap gap-1">
                            {p.itens.slice(0, 3).map((item) => {
                              const isDimmed = filtroEstacao && filtroEstacao !== 'todas' && item.estacao !== filtroEstacao;
                              return (
                                <span key={item.id} className={`text-[10px] text-zinc-600 whitespace-nowrap transition-opacity ${isDimmed ? 'opacity-30' : ''}`}>
                                  {item.quantidade}x {item.nome}
                                  {item.semPreparo || item.skip_kds ? <span className="text-zinc-400"> (direto)</span> : null}
                                </span>
                              );
                            })}
                            {p.itens.length > 3 && (
                              <span className="text-[10px] text-zinc-400 whitespace-nowrap">+{p.itens.length - 3} itens</span>
                            )}
                          </div>
                          {temObs && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200 mt-0.5">
                              <i className="ri-alert-fill text-[9px]" />obs
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stStyle.dot}`} />
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${stStyle.cls}`}>
                            {stStyle.label}
                          </span>
                        </div>
                        <div className="flex items-center">
                          {isPaid ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                              <i className="ri-check-line text-[8px] mr-0.5" />Pago
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200 whitespace-nowrap">
                              Aberto
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => handlePrint(p)} title="Imprimir" className="w-7 h-7 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 text-zinc-500 rounded-lg cursor-pointer transition-colors flex-shrink-0">
                            <i className="ri-printer-line text-sm" />
                          </button>
                          {temItemComPreparo && (
                            <button onClick={() => setFichaItens(p.itens.filter((i) => !i.semPreparo && !i.skip_kds).map((i) => ({ nome: i.nome, quantidade: i.quantidade, menuItemId: i.menuItemId })))} title="Ficha técnica" className="w-7 h-7 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 text-zinc-500 rounded-lg cursor-pointer transition-colors flex-shrink-0">
                              <i className="ri-clipboard-line text-sm" />
                            </button>
                          )}
                          {isCancelled ? (
                            <span className="text-[10px] text-red-400 font-bold px-1 whitespace-nowrap">Cancelado</span>
                          ) : p.status === 'entregue' ? (
                            <span className="text-[10px] text-zinc-300 font-medium px-1">Concluído</span>
                          ) : p.status === 'pronto' ? (
                            p.origem === 'autoatendimento' && !p.isPaid ? (
                              <span className="flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg whitespace-nowrap">
                                <i className="ri-store-2-line text-[9px]" />Pagar no caixa
                              </span>
                            ) : (
                              <button onClick={() => onEntregar(p.id)} className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-900 hover:bg-black text-white text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors">
                                <i className="ri-check-double-line text-sm" />Entregar
                              </button>
                            )
                          ) : (
                            <>
                              <button onClick={() => onAvancar(p.id)} className={`flex items-center gap-1 px-2.5 py-1.5 text-white text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors ${p.status === 'novo' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>
                                <i className={`text-sm ${p.status === 'novo' ? 'ri-play-fill' : 'ri-checkbox-circle-line'}`} />
                                {p.status === 'novo' ? 'Iniciar' : 'Pronto'}
                              </button>
                              <button onClick={() => onCancelar(p.id)} title="Cancelar" className="w-7 h-7 flex items-center justify-center bg-zinc-50 hover:bg-red-50 border border-zinc-200 hover:border-red-200 text-zinc-400 hover:text-red-500 rounded-lg cursor-pointer transition-colors flex-shrink-0">
                                <i className="ri-close-circle-line text-sm" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {isExpanded && <RowDetail pedido={p} filtroEstacao={filtroEstacao} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
