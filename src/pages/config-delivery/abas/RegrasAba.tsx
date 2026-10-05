import { useMemo } from 'react';
import { useDeliveryTela } from '../DeliveryTela';
import { brl, Cartao, CampoNumero, Colunas, LinhaInterruptor, Manchete, Nota, PaginaDelivery } from '../ui';
import { usePedidos30d } from './area/usePedidos30d';
import { kmTxt, previaMinimo, simularFreteGratis } from './area/calculos';

// Pedido › Mínimo e retirada: pedido mínimo (o servidor também confere), retirada na loja e entrega grátis
// acima de um valor (o servidor já aplica delivery_config.frete_gratis). Nada grava aqui: muda o rascunho
// e a barra "Salvar" da página grava.

export default function RegrasAba() {
  const { tenantId, cfg, mudar } = useDeliveryTela();
  const { pedidos, carregando, erro } = usePedidos30d(tenantId);

  const fg = cfg.freteGratis;
  const previa = useMemo(() => previaMinimo(cfg.pedidoMinimoValor), [cfg.pedidoMinimoValor]);

  // Entregues do mês; só os que pagaram taxa podem "ganhar" entrega grátis.
  const entregues = useMemo(() => pedidos.filter((p) => p.status === 'delivered'), [pedidos]);
  const sim = useMemo(
    () => simularFreteGratis(entregues.filter((p) => p.taxa > 0).map((p) => ({ subtotal: p.subtotal, taxa: p.taxa, km: p.km })), fg.acima_de, fg.ate_km),
    [entregues, fg.acima_de, fg.ate_km],
  );

  const mudarFg = (patch: Partial<typeof fg>) => mudar((c) => ({ freteGratis: { ...c.freteGratis, ...patch } }));

  return (
    <PaginaDelivery>
      <Manchete titulo="Pedido mínimo e retirada" />

      <Colunas>
        <div className="space-y-4 min-w-0">
          {/* Pedido mínimo */}
          <Cartao className="space-y-3">
            <LinhaInterruptor
              titulo="Pedido mínimo"
              texto="Valor mínimo para fechar uma entrega"
              ligado={cfg.pedidoMinimoAtivo}
              onChange={(v) => mudar({ pedidoMinimoAtivo: v })}
            />
            {cfg.pedidoMinimoAtivo ? (
              <>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[13.5px] text-zinc-700">
                  <span>Pedidos abaixo de</span>
                  <CampoNumero valor={cfg.pedidoMinimoValor} onChange={(n) => mudar({ pedidoMinimoValor: n })} prefixo="R$" casas={2}
                    largura="w-16" rotulo="Valor do pedido mínimo" placeholder="0,00" />
                  <span>não fecham (sem contar a taxa). O cliente vê quanto falta.</span>
                </div>
                {cfg.pedidoMinimoValor > 0 ? (
                  <div className="rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5">
                    <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Como o cliente vê</p>
                    <p className="text-[13px] text-zinc-800 mt-1">
                      <i className="ri-shopping-bag-3-line mr-1 text-zinc-500" />
                      Sacola <b>{brl(previa.sacola)}</b> · faltam <b className="text-amber-700">{brl(previa.falta)}</b>
                    </p>
                    <div className="h-1.5 rounded-full bg-zinc-200 mt-2 overflow-hidden" aria-hidden>
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${previa.pct}%` }} />
                    </div>
                    <p className="text-[11.5px] text-zinc-500 mt-1.5 leading-snug">
                      Mínimo de {brl(cfg.pedidoMinimoValor)}: o botão de fechar só libera quando a sacola chega lá.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11.5px] text-amber-700 flex items-start gap-1 leading-snug">
                    <i className="ri-error-warning-line mt-px" />Com R$ 0,00 o pedido mínimo não vale. Digite o valor.
                  </p>
                )}
              </>
            ) : (
              <p className="text-[12.5px] text-zinc-500 leading-snug">Desligado: o cliente fecha o pedido com qualquer valor.</p>
            )}
            <Nota>O servidor também confere (antes só o app conferia). Retirada não tem mínimo.</Nota>
          </Cartao>

          {/* Retirada */}
          <Cartao className="space-y-2">
            <LinhaInterruptor
              titulo="Retirada na loja"
              texto="O cliente escolhe buscar: sem endereço e sem taxa."
              ligado={cfg.retiradaAtivo}
              onChange={(v) => mudar({ retiradaAtivo: v })}
            />
            <p className="text-[12.5px] text-zinc-500 leading-snug">
              A cozinha prepara e o pedido espera no balcão. Não aparece no Gestor de Entregas.
            </p>
          </Cartao>
        </div>

        <div className="space-y-4 min-w-0">
          {/* Entrega grátis */}
          <Cartao className="space-y-3">
            <LinhaInterruptor
              titulo="Entrega grátis acima de um valor"
              texto="Pedido grande não paga a taxa. Começa desligada."
              ligado={fg.ativo}
              onChange={(v) => mudarFg({ ativo: v })}
            />
            {fg.ativo && (
              <>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[13.5px] text-zinc-700">
                  <span>Pedidos a partir de</span>
                  <CampoNumero valor={fg.acima_de} onChange={(n) => mudarFg({ acima_de: n })} prefixo="R$" casas={2}
                    largura="w-16" rotulo="Valor a partir do qual a entrega é grátis" placeholder="0,00" />
                  <span>não pagam a entrega.</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[13.5px] text-zinc-700">
                  <span>Só até</span>
                  <CampoNumero valor={fg.ate_km} onChange={(n) => mudarFg({ ate_km: n })} sufixo="km" casas={1}
                    largura="w-10" rotulo="Distância máxima da entrega grátis, em km" placeholder="0" />
                  <span className="text-[12px] text-zinc-400">(0 = qualquer distância da área)</span>
                </div>

                {fg.acima_de > 0 ? (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[12.5px] text-amber-950 leading-snug">
                    {carregando ? (
                      <span className="text-zinc-500"><i className="ri-loader-4-line animate-spin mr-1" />Simulando com os pedidos dos últimos 30 dias…</span>
                    ) : erro ? (
                      <span className="text-red-600"><i className="ri-error-warning-line mr-1" />Não consegui ler os pedidos do mês: {erro}</span>
                    ) : entregues.length === 0 ? (
                      <span className="text-zinc-600">Ainda não há pedido entregue nos últimos 30 dias para simular.</span>
                    ) : (
                      <>
                        <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">Simulação, últimos 30 dias</p>
                        <p className="mt-1">
                          No mês, <b>{sim.n} {sim.n === 1 ? 'pedido teria ganhado' : 'pedidos teriam ganhado'}</b>
                          {' '}(de {entregues.length} {entregues.length === 1 ? 'entregue' : 'entregues'}).{' '}
                          {sim.n > 0
                            ? <>Você deixaria de cobrar <b>{brl(sim.taxaAbrir)}</b> de taxa.</>
                            : <>Você não deixaria de cobrar nada.</>}
                        </p>
                        {fg.ate_km > 0 && (
                          <p className="text-[11.5px] text-amber-800/80 mt-1">Conta só os pedidos até {kmTxt(fg.ate_km)} km.</p>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-amber-700 flex items-start gap-1 leading-snug">
                    <i className="ri-error-warning-line mt-px" />Com R$ 0,00 a entrega grátis não vale. Digite o valor.
                  </p>
                )}
              </>
            )}
            <Nota>A base é a soma dos itens, sem a taxa e antes do cupom. O entregador continua recebendo pelo acerto.</Nota>
          </Cartao>
        </div>
      </Colunas>
    </PaginaDelivery>
  );
}
