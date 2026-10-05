import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useDeliveryTela } from '../DeliveryTela';
import { faixasOrdenadas, inicioDosUltimos30Dias } from '../config';
import AcertoRegraCard from '../AcertoRegraCard';
import { MODOS_COM_DIARIA, MODOS_FAIXA_KM } from '../acertoCfg';
import { contaPorFaixa, resumoDoPeriodo, type PedidoConta } from '../acertoConta';
import { btn, brl, Cartao, Colunas, Manchete, Nota, PaginaDelivery, SecaoTitulo } from '../ui';

// Delivery › Entregadores › Quanto ganham: a regra do acerto (AcertoRegraCard) e, ao lado, a conta
// "o cliente paga × o entregador recebe" por faixa de entrega, com a estimativa dos últimos 30 dias.
// A conta usa a regra que está na tela (rascunho), então dá para testar um valor antes de salvar.

const km = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export default function AcertoAba() {
  const { tenantId, cfg, mudar, irPara } = useDeliveryTela();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { hasPermissao } = usePermissoes();
  const podeVerFinanceiro = hasPermissao('fin_entregadores');

  // Entregas próprias entregues nos últimos 30 dias (pedido de treino não conta).
  const [pedidos, setPedidos] = useState<PedidoConta[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    setPedidos(null); setFalhou(false);
    const desde = inicioDosUltimos30Dias();
    void (async () => {
      const { data, error } = await supabase.from('orders')
        .select('delivery_fee, delivery_distance_km')
        .eq('tenant_id', tenantId).eq('origin_type', 'delivery').eq('is_training', false).eq('status', 'delivered')
        .or('delivery_platform.is.null,delivery_platform.eq.propria')
        .gte('created_at', desde).limit(2000);
      if (!vivo) return;
      if (error) {
        setFalhou(true);
        toastRef.current.error('Não consegui ler as entregas do mês', error.message);
        return;
      }
      setPedidos((data ?? []) as PedidoConta[]);
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  const acerto = cfg.acerto;
  const faixas = useMemo(() => faixasOrdenadas(cfg.faixas), [cfg.faixas]);
  const linhas = useMemo(() => contaPorFaixa(faixas, acerto), [faixas, acerto]);
  const mes = useMemo(() => (pedidos ? resumoDoPeriodo(acerto, pedidos) : null), [pedidos, acerto]);

  return (
    <PaginaDelivery>
      <Colunas>
        <div className="space-y-3">
          <Manchete titulo="Quanto cada entregador ganha">
            O valor de cada entrega fica gravado na hora em que ela é entregue. O acerto é feito em Financeiro › Entregadores.
          </Manchete>
          {podeVerFinanceiro && (
            <Link to="/financeiro?tab=entregadores" className={btn('out', 'sm')}>
              <i className="ri-hand-coin-line" />Abrir o acerto no Financeiro
            </Link>
          )}
          <AcertoRegraCard value={acerto} onChange={(a) => mudar({ acerto: a })} />
        </div>

        <div>
          <SecaoTitulo titulo="Taxa do cliente × entregador" />
          <Cartao>
            {!acerto.ativo ? (
              <p className="text-[13px] text-zinc-500">Desligado: as entregas não geram valor para o acerto.</p>
            ) : (
              <>
                {linhas.length === 0 ? (
                  <div className="text-[13px] text-zinc-500">
                    <p>Ainda não há faixa de entrega para fazer a conta.</p>
                    <button type="button" onClick={() => irPara('area')} className={`${btn('out', 'sm')} mt-2`}>
                      <i className="ri-map-pin-range-line" />Montar as faixas
                    </button>
                  </div>
                ) : (
                  <table className="w-full text-[12.5px] border-separate border-spacing-0">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-zinc-400 font-extrabold">
                        <th className="text-left px-1.5 pt-1 pb-1.5 border-b border-zinc-200">Faixa</th>
                        <th className="text-right px-1.5 pt-1 pb-1.5 border-b border-zinc-200">Cliente paga</th>
                        <th className="text-right px-1.5 pt-1 pb-1.5 border-b border-zinc-200">Entregador</th>
                        <th className="text-right px-1.5 pt-1 pb-1.5 border-b border-zinc-200">Sobra</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {linhas.map((l, i) => {
                        const ultima = i === linhas.length - 1;
                        const borda = ultima ? '' : 'border-b border-zinc-100';
                        const cor = l.sobra > 0 ? 'text-emerald-700' : l.sobra < 0 ? 'text-red-600' : 'text-zinc-500';
                        return (
                          <tr key={`${i}-${l.faixa.ate_km}`}>
                            <td className={`px-1.5 py-2 text-zinc-800 font-semibold whitespace-nowrap ${borda}`}>até {km(l.faixa.ate_km)} km</td>
                            <td className={`px-1.5 py-2 text-right whitespace-nowrap ${borda}`}>{brl(l.faixa.taxa)}</td>
                            <td className={`px-1.5 py-2 text-right whitespace-nowrap ${borda}`}>{brl(l.entregador)}</td>
                            <td className={`px-1.5 py-2 text-right whitespace-nowrap font-extrabold ${cor} ${borda}`}>
                              {l.sobra > 0 ? '+ ' : l.sobra < 0 ? '− ' : ''}{brl(Math.abs(l.sobra))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {MODOS_COM_DIARIA.includes(acerto.modo) && acerto.diaria > 0 && (
                  <p className="text-xs text-zinc-500 mt-2">Mais a diária de <b>{brl(acerto.diaria)}</b> por dia trabalhado (não entra na conta de cada entrega).</p>
                )}
                {MODOS_FAIXA_KM.includes(acerto.modo) && (
                  <p className="text-xs text-zinc-500 mt-2">Cada faixa de entrega usa o valor da faixa de km do acerto que cobre a sua distância.</p>
                )}

                <div className="text-[13px] text-zinc-700 leading-relaxed mt-3 pt-3 border-t border-zinc-100">
                  {falhou ? (
                    <p className="text-zinc-500">Não deu para fazer a conta do mês agora. Abra a aba de novo para tentar outra vez.</p>
                  ) : !mes ? (
                    <p className="text-zinc-400"><i className="ri-loader-4-line animate-spin mr-1" />Calculando o mês…</p>
                  ) : mes.entregas === 0 ? (
                    <p className="text-zinc-500">Ainda não há entregas nos últimos 30 dias para fazer a conta.</p>
                  ) : (
                    <p>
                      No mês: <b>{mes.entregas} {mes.entregas === 1 ? 'entrega' : 'entregas'}</b> · clientes pagaram <b>{brl(mes.taxa)}</b> de taxa · entregadores receberiam <b>{brl(mes.entregador)}</b>.
                    </p>
                  )}
                </div>
              </>
            )}
          </Cartao>
          {acerto.ativo && (
            <Nota className="mt-2">
              A conta usa a regra que está na tela e as entregas dos últimos 30 dias. O que vale de verdade é o valor que fica gravado quando o pedido é entregue.
            </Nota>
          )}
        </div>
      </Colunas>
    </PaginaDelivery>
  );
}
