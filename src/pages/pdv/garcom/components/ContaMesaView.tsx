import { useState } from 'react';
import type { CarrinhoItem } from '../../../../contexts/PDVContext';
import type { Rodada } from '../types';
import RelatarProblemaModal from './RelatarProblemaModal';
import { usePermissoes } from '@/hooks/usePermissoes';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  rodadas: Rodada[];
  itensNovos: CarrinhoItem[];
  onFecharConta: () => void;
  onPagarConta?: () => void;
  rodadasPagas?: Set<string>;
  mesaNome?: string;
}

function ItemRow({ item, novo, onRelatar }: { item: CarrinhoItem; novo?: boolean; onRelatar?: () => void }) {
  return (
    <div className={`flex items-start gap-2 py-2 border-b border-zinc-100 last:border-0 ${novo ? 'bg-amber-50/40' : ''}`}>
      <span className="text-xs font-bold text-zinc-400 w-5 flex-shrink-0 text-right">{item.quantidade}x</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold text-zinc-800 truncate">{item.nome}</p>
          {novo && (
            <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
              NOVO
            </span>
          )}
        </div>
        {(item.opcoes ?? []).length > 0 && (
          <p className="text-[10px] text-zinc-400 truncate">{(item.opcoes ?? []).map((o) => o.opcaoNome).join(' · ')}</p>
        )}
        {((item.observacoes ?? []).length > 0 || item.observacaoLivre) && (
          <p className="text-[10px] text-amber-600 truncate">
            {[...(item.observacoes ?? []), item.observacaoLivre].filter(Boolean).join(', ')}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-xs font-bold text-zinc-700">{fmt(item.precoTotal * item.quantidade)}</span>
        {!novo && onRelatar && (
          <button
            onClick={onRelatar}
            title="Relatar problema com este item"
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-100 text-red-400 hover:text-red-600 cursor-pointer transition-colors flex-shrink-0"
          >
            <i className="ri-flag-line text-xs" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function ContaMesaView({ rodadas, itensNovos, onFecharConta, onPagarConta, rodadasPagas, mesaNome = 'Mesa' }: Props) {
  const { hasPermissao } = usePermissoes();
  const [itemRelatar, setItemRelatar] = useState<CarrinhoItem | null>(null);
  const [showConfirmarDescartar, setShowConfirmarDescartar] = useState(false);

  const totalRodadas = rodadas.flatMap((r) => r.itens).reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
  const totalNovos = itensNovos.reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
  const totalGeral = totalRodadas + totalNovos;

  const rodadasPagasCount = rodadas.filter((r) => rodadasPagas?.has(r.id)).length;
  const todasPagas = rodadas.length > 0 && rodadasPagasCount === rodadas.length;
  const algumaNaoPaga = rodadas.some((r) => !rodadasPagas?.has(r.id));
  const totalPago = rodadas.filter((r) => rodadasPagas?.has(r.id)).flatMap((r) => r.itens).reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
  const totalAbertoRodadas = rodadas.filter((r) => !rodadasPagas?.has(r.id)).flatMap((r) => r.itens).reduce((a, i) => a + i.precoTotal * i.quantidade, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Payment status banner */}
      {rodadas.length > 0 && (
        <div className={`flex items-center justify-between px-4 py-2 border-b flex-shrink-0 ${todasPagas ? 'bg-green-50 border-green-200' : 'bg-zinc-50 border-zinc-200'}`}>
          <div className="flex items-center gap-2">
            <i className={`${todasPagas ? 'ri-checkbox-circle-fill text-green-500' : 'ri-time-line text-zinc-400'} text-sm`} />
            <span className={`text-xs font-semibold ${todasPagas ? 'text-green-700' : 'text-zinc-600'}`}>
              {todasPagas ? 'Todas as contas pagas!' : `${rodadasPagasCount}/${rodadas.length} contas pagas`}
            </span>
          </div>
          {totalPago > 0 && (
            <span className="text-[10px] text-green-600 font-bold">{fmt(totalPago)} pago</span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* Rodadas enviadas */}
        {rodadas.map((rodada) => {
          const subtotalRodada = rodada.itens.reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
          const paga = rodadasPagas?.has(rodada.id) ?? false;
          return (
            <div key={rodada.id} className={`border rounded-xl overflow-hidden ${paga ? 'border-green-200 bg-green-50/30' : 'border-zinc-200 bg-white'}`}>
              <div className={`flex items-center gap-2 px-3 py-2 border-b ${paga ? 'border-green-100 bg-green-50' : 'border-zinc-100 bg-zinc-50'}`}>
                <div className={`w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0 ${paga ? 'bg-green-500' : 'bg-zinc-200'}`}>
                  {paga ? (
                    <i className="ri-check-line text-white text-[10px]" />
                  ) : (
                    <span className="text-[9px] font-black text-zinc-600">#{rodada.numero}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-zinc-800 truncate">{rodada.nomeResponsavel}</p>
                    {paga && (
                      <span className="text-[9px] font-black text-green-600 bg-green-100 border border-green-200 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">PAGO</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[9px] text-zinc-400">{rodada.hora}</span>
                  <span className={`text-xs font-bold ${paga ? 'text-green-600 line-through opacity-60' : 'text-zinc-600'}`}>{fmt(subtotalRodada)}</span>
                  <span className={`w-4 h-4 flex items-center justify-center ${paga ? 'text-green-500' : 'text-zinc-300'}`}>
                    <i className={`${paga ? 'ri-checkbox-circle-fill' : 'ri-checkbox-circle-line'} text-sm`} />
                  </span>
                </div>
              </div>
              <div className="px-3 py-1">
                {rodada.itens.map((item) => (
                  <ItemRow
                    key={item.cartId}
                    item={item}
                    onRelatar={() => setItemRelatar(item)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Itens novos ainda não enviados */}
        {itensNovos.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-100 border-b border-amber-200">
              <i className="ri-time-line text-amber-500 text-sm" />
              <p className="text-xs font-bold text-amber-700 flex-1">Aguardando envio</p>
              <span className="text-xs font-bold text-amber-700">{fmt(totalNovos)}</span>
            </div>
            <div className="px-3 py-1">
              {itensNovos.map((item) => (
                <ItemRow key={item.cartId} item={item} novo />
              ))}
            </div>
          </div>
        )}

        {rodadas.length === 0 && itensNovos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
              <i className="ri-shopping-bag-2-line text-2xl text-zinc-300" />
            </div>
            <p className="text-sm font-semibold text-zinc-500 mb-1">Nenhum pedido feito</p>
            <p className="text-xs text-zinc-400 mb-5">Volte para a aba Adicionar e registre os itens</p>
            <button
              onClick={() => setShowConfirmarDescartar(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors border border-red-200"
            >
              <i className="ri-delete-bin-line" />
              Cancelar / Descartar pedido
            </button>
          </div>
        )}
      </div>

      {/* Rodapé com total */}
      <div className="border-t border-zinc-200 px-3 py-3 bg-white flex-shrink-0 space-y-2">
        {totalPago > 0 && (
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-green-600 font-semibold flex items-center gap-1"><i className="ri-checkbox-circle-line" />Já pago</span>
            <span className="text-xs text-green-600 font-bold">{fmt(totalPago)}</span>
          </div>
        )}
        {algumaNaoPaga && (
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-zinc-400">A pagar (pedidos)</span>
            <span className="text-xs text-zinc-500">{fmt(totalAbertoRodadas)}</span>
          </div>
        )}
        {totalNovos > 0 && (
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-zinc-400">Itens não enviados</span>
            <span className="text-xs text-amber-600 font-semibold">{fmt(totalNovos)}</span>
          </div>
        )}
        <div className="flex justify-between items-center mb-3 pt-1.5 border-t border-zinc-100">
          <span className="text-sm font-bold text-zinc-800">Total da conta</span>
          <span className="text-base font-black text-zinc-900">{fmt(totalGeral)}</span>
        </div>

        {itensNovos.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-amber-50 border border-amber-200 rounded-xl">
            <i className="ri-error-warning-line text-amber-500 text-sm flex-shrink-0" />
            <p className="text-xs text-amber-700 font-semibold">Envie os itens pendentes ao KDS antes de fechar.</p>
          </div>
        )}

        <div className="space-y-2">
          {algumaNaoPaga && onPagarConta && !itensNovos.length && (
            <button
              onClick={onPagarConta}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              <i className="ri-money-dollar-circle-line" />
              <span className="hidden sm:inline">Registrar Pagamento</span>
              <span className="sm:hidden">Pagar</span>
              <span className="hidden sm:inline"> · {fmt(totalAbertoRodadas + totalNovos)}</span>
            </button>
          )}
          {hasPermissao('garcom_fechar_mesa') && (
            <button
              onClick={onFecharConta}
              disabled={!todasPagas || itensNovos.length > 0}
              className="w-full py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              <i className="ri-door-open-line" />
              <span className="hidden sm:inline">{todasPagas ? 'Fechar Mesa' : `Aguardando ${rodadas.length - rodadasPagasCount} conta(s)`}</span>
              <span className="sm:hidden">{todasPagas ? 'Fechar' : `Aguardando ${rodadas.length - rodadasPagasCount}`}</span>
            </button>
          )}
        </div>
      </div>

      {/* Modal de confirmação de descarte */}
      {showConfirmarDescartar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                  <i className="ri-delete-bin-2-line text-red-600 text-lg" />
                </div>
                <div>
                  <p className="font-bold text-zinc-900 text-sm">Descartar pedido?</p>
                  <p className="text-xs text-zinc-500">{mesaNome}</p>
                </div>
              </div>
              <p className="text-sm text-zinc-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                Esta ação irá <strong className="text-red-600">encerrar a mesa/pedido</strong> sem registrar nenhum consumo. Não pode ser desfeito.
              </p>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setShowConfirmarDescartar(false)}
                className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
              >
                Voltar
              </button>
              <button
                onClick={() => { setShowConfirmarDescartar(false); onFecharConta(); }}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                <i className="ri-delete-bin-line" />
                Sim, descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Relatar Problema Modal */}
      {itemRelatar && (
        <RelatarProblemaModal
          item={itemRelatar}
          mesaNome={mesaNome}
          onClose={() => setItemRelatar(null)}
        />
      )}
    </div>
  );
}
