import { useState, useEffect, useMemo } from 'react';
import type { Mesa } from '@/types/pdv';
import type { KDSPedido } from '@/types/kds';
import { useKDS } from '../../../../contexts/KDSContext';
import { useSystemSettings } from '../../../../hooks/useSystemSettings';
import type { PedidoAvulso } from '../types';
import type { AvulsoDraft } from '../page';

interface Props {
  mesas: Mesa[];
  mesasPagas: Set<string>;
  onSelect: (mesa: Mesa) => void;
  avulsosAtivos: PedidoAvulso[];
  avulsosDraft: AvulsoDraft[];
  onSelectAvulso: (avulso: PedidoAvulso) => void;
  onAbrirDraft: (draft: AvulsoDraft) => void;
  onDescartarDraft: (draftId: string) => void;
  onNovoAvulso: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Converte "HH:MM" de hoje para timestamp ms */
function hhmmToTs(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** Retorna objeto { minutos, texto, cor } para o elapsed */
function elapsed(ts: number, verdeMax: number, ambarMax: number): { min: number; texto: string; cor: string } {
  const min = Math.floor((Date.now() - ts) / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const texto = h > 0 ? `${h}h${m.toString().padStart(2, '00')}m` : `${min}min`;
  const cor =
    min < verdeMax  ? 'text-green-600 bg-green-50 border-green-200'
    : min < ambarMax ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-red-600 bg-red-50 border-red-200';
  return { min, texto, cor };
}

/** Calcula status KDS para uma mesa, separando corretamente cada estado */
function kdsMesa(mesaNumero: number, pedidos: KDSPedido[]) {
  const pedidosMesa = pedidos.filter(
    (p) => !p.isCancelled && p.destino === 'mesa' && p.mesaNumero === mesaNumero
  );
  if (pedidosMesa.length === 0) return null;

  let naFila = 0, emPreparo = 0, prontos = 0, entregues = 0;
  for (const p of pedidosMesa) {
    for (const item of p.itens) {
      // itens skip_kds entram automaticamente como prontos (bebidas, etc.)
      // mas se já foram entregues, contam como entregues
      if (item.skip_kds || item.semPreparo) {
        if (item.status === 'entregue') entregues++;
        else prontos++; // skip_kds = sempre pronto (nunca precisa preparo)
        continue;
      }
      if (item.status === 'novo') naFila++;
      else if (item.status === 'preparo') emPreparo++;
      else if (item.status === 'pronto') prontos++;
      else if (item.status === 'entregue') entregues++;
    }
  }
  const total = naFila + emPreparo + prontos + entregues;
  return { naFila, emPreparo, prontos, entregues, total };
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── sub-componente: card de mesa ──────────────────────────────────────────────

function MesaCard({ mesa, onSelect, tick, isPaga, kdsPedidos, verdeMax, ambarMax }: { mesa: Mesa; onSelect: (m: Mesa) => void; tick: number; isPaga: boolean; kdsPedidos: KDSPedido[]; verdeMax: number; ambarMax: number }) {
  const isOcupada = mesa.status === 'ocupada';
  const isLivre = mesa.status === 'livre';

  const ts = useMemo(() => {
    if (mesa.abertaEmTimestamp) return mesa.abertaEmTimestamp;
    if (mesa.abertaEm) return hhmmToTs(mesa.abertaEm);
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesa.abertaEmTimestamp, mesa.abertaEm, tick]);

  const timer = isOcupada && ts ? elapsed(ts, verdeMax, ambarMax) : null;
  const kds = isOcupada ? kdsMesa(mesa.numero, kdsPedidos) : null;

  const cardClass = mesa.status === 'livre'
    ? 'bg-white border-2 border-green-200 hover:border-green-500 hover:bg-green-50'
    : mesa.status === 'ocupada'
    ? timer && timer.min >= ambarMax
      ? 'bg-red-50 border-2 border-red-300 hover:border-red-500'
      : timer && timer.min >= verdeMax
      ? 'bg-amber-50 border-2 border-amber-400 hover:border-amber-600'
      : 'bg-amber-50 border-2 border-amber-300 hover:border-amber-500'
    : 'bg-zinc-100 border-2 border-zinc-300 cursor-not-allowed opacity-60';

  return (
    <button
      key={mesa.id}
      disabled={mesa.status === 'reservada'}
      onClick={() => onSelect(mesa)}
      className={`flex flex-col items-stretch p-3 rounded-xl transition-all cursor-pointer text-left ${cardClass}`}
    >
      {/* Linha topo: status + timer */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            mesa.status === 'livre' ? 'bg-green-400'
            : mesa.status === 'ocupada' ? 'bg-amber-500'
            : 'bg-zinc-400'
          }`} />
          <span className="text-[9px] font-semibold text-zinc-500">
            {mesa.status === 'livre' ? 'Livre' : mesa.status === 'ocupada' ? 'Ocupada' : 'Reservada'}
          </span>
        </div>
        {timer && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${timer.cor} whitespace-nowrap`}>
            ⏱ {timer.texto}
          </span>
        )}
      </div>

      {/* Número grande centralizado */}
      <div className="flex flex-col items-center py-1">
        <span className="text-2xl font-black text-zinc-800 leading-none">{mesa.numero}</span>
        <span className="text-[9px] text-zinc-400 mt-0.5">{mesa.capacidade} lug.{mesa.numeroPessoas ? ` · ${mesa.numeroPessoas} pess.` : ''}</span>
      </div>

      {/* Badge PAGA */}
      {isPaga && (
        <div className="self-center mt-0.5 mb-0.5 flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
          <i className="ri-checkbox-circle-fill text-emerald-600" />
          PAGA
        </div>
      )}

      {/* Cliente */}
      {mesa.clienteNome && (
        <span className="text-[10px] font-semibold text-amber-700 truncate w-full text-center leading-tight">
          {mesa.clienteNome}
        </span>
      )}

      {/* Garçom */}
      {mesa.garcomNome && (
        <span className="text-[9px] text-zinc-400 truncate w-full text-center">
          <i className="ri-walk-line mr-0.5" />{mesa.garcomNome.split(' ')[0]}
        </span>
      )}

      {/* Consumo */}
      {mesa.totalConsumo != null && mesa.totalConsumo > 0 && (
        <span className="text-[10px] font-bold text-zinc-700 text-center mt-0.5">
          {formatPrice(mesa.totalConsumo)}
        </span>
      )}

      {/* KDS status bar */}
      {kds && kds.total > 0 && (
        <div className={`mt-2 pt-1.5 border-t ${
          kds.emPreparo > 0 ? 'border-amber-200'
          : kds.naFila > 0 ? 'border-zinc-200'
          : kds.prontos > 0 ? 'border-green-200'
          : 'border-zinc-100'
        } flex items-center justify-center flex-wrap gap-x-1.5 gap-y-0.5`}>
          {/* Na fila */}
          {kds.naFila > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-bold text-zinc-500">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block" />
              {kds.naFila} na fila
            </span>
          )}
          {/* Em preparo */}
          {kds.emPreparo > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-bold text-amber-600">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
              {kds.emPreparo} preparo
            </span>
          )}
          {/* Prontos */}
          {kds.prontos > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-bold text-green-600">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              {kds.prontos} {kds.prontos === 1 ? 'pronto' : 'prontos'}
            </span>
          )}
          {/* Tudo entregue */}
          {kds.naFila === 0 && kds.emPreparo === 0 && kds.prontos === 0 && kds.entregues > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-bold text-zinc-400">
              <i className="ri-check-double-line text-green-500" />
              Tudo entregue
            </span>
          )}
        </div>
      )}

      {/* Badge livre */}
      {isLivre && (
        <span className="mt-1.5 self-center text-[9px] font-semibold text-green-600 bg-green-100 px-2 py-0.5 rounded-full whitespace-nowrap">
          + Abrir
        </span>
      )}
    </button>
  );
}

// ── componente principal ──────────────────────────────────────────────────────

export default function MesaGrid({ mesas, mesasPagas, onSelect, avulsosAtivos, avulsosDraft, onSelectAvulso, onAbrirDraft, onDescartarDraft, onNovoAvulso }: Props) {
  const [tick, setTick] = useState(0);
  const { pedidos: kdsPedidos } = useKDS();
  const { settings } = useSystemSettings();
  const verdeMax = settings.timer_verde_max ?? 45;
  const ambarMax = settings.timer_ambar_max ?? 90;

  // Atualiza o cronômetro a cada 30s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const livres = mesas.filter((m) => m.status === 'livre').length;
  const ocupadas = mesas.filter((m) => m.status === 'ocupada').length;
  const reservadas = mesas.filter((m) => m.status === 'reservada').length;
  const totalParaLevar = avulsosAtivos.length + avulsosDraft.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary */}
      <div className="flex gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-zinc-100 flex-wrap items-center">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          <span className="text-xs text-zinc-600"><span className="font-bold">{livres}</span> <span className="hidden sm:inline">livres</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="text-xs text-zinc-600"><span className="font-bold">{ocupadas}</span> <span className="hidden sm:inline">ocupadas</span></span>
        </div>
        {reservadas > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-400" />
            <span className="text-xs text-zinc-600"><span className="font-bold">{reservadas}</span> <span className="hidden sm:inline">reservadas</span></span>
          </div>
        )}
        {totalParaLevar > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-500" />
            <span className="text-xs text-zinc-600"><span className="font-bold">{totalParaLevar}</span> <span className="hidden sm:inline">para levar</span></span>
          </div>
        )}
        {/* Legenda dos cronômetros */}
        <div className="ml-auto flex items-center gap-1.5 text-[9px] font-semibold">
          <span className="text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
            &lt;{verdeMax}m
          </span>
          <span className="text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap hidden sm:inline">
            {verdeMax}–{ambarMax}m
          </span>
          <span className="text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
            &gt;{ambarMax}m
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* ── Seção Para Levar ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <i className="ri-shopping-bag-2-line text-sm text-sky-500" />
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Para Levar</h3>
              {totalParaLevar > 0 && (
                <span className="text-[10px] bg-sky-100 text-sky-600 font-bold px-2 py-0.5 rounded-full">
                  {totalParaLevar} ativo{totalParaLevar > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={onNovoAvulso}
              className="flex items-center gap-1.5 text-xs font-bold text-sky-600 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-full cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-add-line" />
              Novo Pedido
            </button>
          </div>

          {totalParaLevar === 0 ? (
            <button
              onClick={onNovoAvulso}
              className="w-full flex flex-col items-center justify-center gap-2 py-5 border-2 border-dashed border-sky-200 hover:border-sky-400 hover:bg-sky-50 rounded-xl text-sky-400 hover:text-sky-600 transition-all cursor-pointer"
            >
              <div className="w-10 h-10 flex items-center justify-center bg-sky-100 rounded-xl">
                <i className="ri-shopping-bag-2-line text-xl text-sky-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold">Novo Pedido Para Levar</p>
                <p className="text-xs text-zinc-400 mt-0.5">Clique para identificar o cliente</p>
              </div>
            </button>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
              {/* Botão novo pedido */}
              <button
                onClick={onNovoAvulso}
                className="flex flex-col items-center justify-center gap-1.5 p-3 border-2 border-dashed border-sky-200 hover:border-sky-400 hover:bg-sky-50 rounded-xl text-sky-400 hover:text-sky-600 transition-all cursor-pointer min-h-[96px]"
              >
                <i className="ri-add-circle-line text-2xl" />
                <span className="text-[10px] font-bold">Novo pedido</span>
              </button>

              {/* Cards de pedidos confirmados (vindos do KDS) */}
              {avulsosAtivos.map((avulso) => {
                const totalItens = avulso.rodadas.flatMap((r) => r.itens).reduce((a, i) => a + i.quantidade, 0);
                const totalValor = avulso.rodadas.flatMap((r) => r.itens).reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
                return (
                  <button
                    key={avulso.id}
                    onClick={() => onSelectAvulso(avulso)}
                    className="flex flex-col items-start p-3 rounded-xl bg-sky-50 border-2 border-sky-300 hover:border-sky-500 transition-all cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-1 mb-1 w-full">
                      <div className="w-2 h-2 rounded-full bg-sky-500 flex-shrink-0" />
                      <span className="text-[10px] font-semibold text-sky-600 flex-1 truncate">Para Levar</span>
                    </div>
                    <span className="text-sm font-black text-zinc-800 truncate w-full">{avulso.nomeCliente}</span>
                    <span className="text-[10px] text-sky-600 font-semibold mt-0.5">
                      {avulso.rodadas.length} {avulso.rodadas.length === 1 ? 'rodada' : 'rodadas'}
                      {totalItens > 0 && ` · ${totalItens} itens`}
                    </span>
                    {avulso.observacoes && (
                      <span className="text-[9px] text-zinc-400 mt-1 truncate w-full" title={avulso.observacoes}>
                        <i className="ri-chat-1-line mr-0.5" />{avulso.observacoes}
                      </span>
                    )}
                    {totalValor > 0 && (
                      <span className="text-[10px] font-bold text-zinc-700 mt-1">{formatPrice(totalValor)}</span>
                    )}
                    <span className="text-[9px] text-zinc-400">desde {avulso.criadoEm}</span>
                  </button>
                );
              })}

              {/* Cards de rascunhos (pedidos iniciados mas não enviados) */}
              {avulsosDraft.map((draft) => {
                const totalItens = draft.carrinho.reduce((a, c) => a + c.quantidade, 0);
                return (
                  <div
                    key={draft.id}
                    className="flex flex-col items-start p-3 rounded-xl bg-amber-50 border-2 border-amber-300 border-dashed relative"
                  >
                    {/* Badge rascunho */}
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded-full">
                      <i className="ri-edit-2-line text-amber-600 text-[9px]" />
                      <span className="text-[9px] font-bold text-amber-700">Rascunho</span>
                    </div>

                    <div className="flex items-center gap-1 mb-1 w-full pr-16">
                      <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                      <span className="text-[10px] font-semibold text-amber-600 flex-1 truncate">Para Levar</span>
                    </div>
                    <span className="text-sm font-black text-zinc-800 truncate w-full pr-16">{draft.nomeCliente}</span>

                    {totalItens > 0 ? (
                      <span className="text-[10px] text-amber-600 font-semibold mt-0.5">
                        {totalItens} {totalItens === 1 ? 'item' : 'itens'} no carrinho
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-400 mt-0.5">Carrinho vazio</span>
                    )}

                    {draft.garcomNome && (
                      <span className="text-[9px] text-zinc-400 mt-0.5 truncate w-full">
                        <i className="ri-walk-line mr-0.5" />{draft.garcomNome}
                      </span>
                    )}
                    <span className="text-[9px] text-zinc-400">desde {draft.criadoEm}</span>

                    {/* Botões de ação */}
                    <div className="flex gap-1.5 mt-2 w-full">
                      <button
                        onClick={(e) => { e.stopPropagation(); onAbrirDraft(draft); }}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                      >
                        <i className="ri-arrow-go-forward-line text-[10px]" />
                        Continuar
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDescartarDraft(draft.id); }}
                        className="w-8 h-7 flex items-center justify-center bg-zinc-100 hover:bg-red-100 text-zinc-400 hover:text-red-500 rounded-lg cursor-pointer transition-colors flex-shrink-0"
                        title="Descartar rascunho"
                      >
                        <i className="ri-delete-bin-line text-[11px]" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Seção Mesas ── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-layout-grid-line text-sm text-zinc-400" />
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Mesas</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
            {mesas.map((mesa) => (
              <MesaCard key={mesa.id} mesa={mesa} onSelect={onSelect} tick={tick} isPaga={mesasPagas.has(mesa.id)} kdsPedidos={kdsPedidos} verdeMax={verdeMax} ambarMax={ambarMax} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
