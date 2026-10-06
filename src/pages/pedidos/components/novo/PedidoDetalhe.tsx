import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PedidoItemDetalhe, PedidoRecente, UnidadeItem } from '@/types/pdv';
import { PLATAFORMAS_DELIVERY } from '@/constants/delivery';
import { formatPhoneBR } from '@/lib/deliveryPhone';
import {
  META_PEDIDO_MIN, ROTULO_CANAL, canalPedido, diaBR, ehAtivo, ehCancelado, ehNaoPago, ehSemNota, notaViva, numeroCurto,
  ondeQuem, situacaoPedido, tempoFases, entregaDoPedido, canalFiscal,
} from '@/lib/pedidosRegras';
import { Etiqueta, MenuMais, brl, btn } from '@/components/kit';
import type { TipoImpressao } from '../../lib/acoesTipos';
import EmitirNfModal from '../EmitirNfModal';
import { clienteNome } from '../utils';
import { textoErroNota } from '@/lib/fiscal';
import PassosPedido from './PassosPedido';
import DetalheIfood from './DetalheIfood';
import PagosJuntos, {
  Bloco, Casca, ContaBloco, Linha, NotaDoc, PagamentoBloco, SeloSituacao, diaDoPedido, emitirNotas, formaPagamentoNome,
  hhmm, rotuloDia, useContas, type PropsDetalhe,
} from './PagosJuntos';

// Detalhe de um pedido (layout novo de /pedidos, protótipo docs/prototipos/pedidos-proposta.html):
// o que falta primeiro, passos com o tempo de cada fase, itens, conta, pagamento, nota e cliente.
// Celular/tablet: folha que sobe de baixo. Computador: painel ao lado da lista.
// Pedido "pagos juntos" (mais de um pedido no grupo) vira <PagosJuntos />.

export default function PedidoDetalhe(props: PropsDetalhe) {
  // iFood só acompanhado (não existe em orders): bloco próprio, sem as ações do PDV
  if (props.pedido.ifoodExterno) return <DetalheIfood {...props} />;
  if ((props.pedido.pedidosOriginais?.length ?? 0) > 1) return <PagosJuntos {...props} />;
  return <DetalheUnico {...props} />;
}

// ── Pedaços pequenos ─────────────────────────────────────────────────────────
function FaltaItem({ icone, titulo, texto, acao }: { icone: string; titulo: string; texto: ReactNode; acao: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-t border-orange-100 first:border-t-0">
      <span className="w-[30px] h-[30px] rounded-[10px] bg-orange-100 text-orange-700 flex items-center justify-center flex-shrink-0">
        <i className={`${icone} text-base`} />
      </span>
      <div className="flex-1 min-w-0 leading-snug">
        <b className="block text-[13.5px] text-zinc-900">{titulo}</b>
        <span className="block text-[12px] text-zinc-500 break-words mt-0.5">{texto}</span>
      </div>
      <div className="flex-shrink-0 self-center">{acao}</div>
    </div>
  );
}

const ROTULO_UNIDADE: Record<UnidadeItem['status'], string> = {
  aguardando: 'na fila', preparo: 'fazendo', pronto: 'pronto', entregue: 'entregue',
};

/** Selo do item enquanto o pedido anda: na fila / fazendo · operador / pronto / entregue / sem cozinha. */
function seloDoItem(item: PedidoItemDetalhe): { texto: string; tom: 'zinc' | 'amber' | 'green'; pulsa: boolean } | null {
  const un = item.unidades ?? [];
  if (un.length === 0) return null;
  const c = { fila: 0, fazendo: 0, pronto: 0, semCozinha: 0, entregue: 0 };
  const operadores = new Set<string>();
  for (const u of un) {
    if (u.status === 'entregue') c.entregue++;
    else if (u.semCozinha) c.semCozinha++; // sem estação de preparo: já nasce pronto
    else if (u.status === 'preparo') { c.fazendo++; if (u.operadorCozinha) operadores.add(u.operadorCozinha); }
    else if (u.status === 'pronto') c.pronto++;
    else c.fila++;
  }
  const partes = ([
    [c.fazendo, 'fazendo'], [c.fila, 'na fila'], [c.pronto, 'pronto'], [c.semCozinha, 'sem cozinha'], [c.entregue, 'entregue'],
  ] as [number, string][]).filter(([n]) => n > 0);
  const quem = c.fazendo > 0 && operadores.size > 0 ? ` · ${Array.from(operadores).join(', ')}` : '';
  const unico = partes.length === 1;
  const texto = unico
    ? (partes[0][1] === 'sem cozinha' ? 'pronto · sem cozinha' : partes[0][1]) + quem
    : partes.map(([n, l]) => `${n} ${l}`).join(' · ') + quem;
  const tom = c.fazendo > 0 ? 'amber' : c.fila > 0 || (unico && c.entregue > 0) ? 'zinc' : 'green';
  return { texto, tom, pulsa: c.fazendo > 0 };
}

function opcoesTexto(item: PedidoItemDetalhe): string | null {
  const det = item.opcoesDetalhadas;
  if (det && det.length > 0) return det.map((o) => (o.preco > 0 ? `${o.nome} +${brl(o.preco)}` : o.nome)).join(' · ');
  const simples = (item.opcoes ?? []).filter(Boolean);
  return simples.length > 0 ? simples.join(' · ') : null;
}

/** "Un. 1 · começou 19:13 · pronto 19:20 · entregue 19:25 · Lucas" */
function linhaDaUnidade(u: UnidadeItem): string {
  const partes = [`Un. ${u.unidade}`];
  if (u.semCozinha) partes.push('sem cozinha');
  const ini = hhmm(u._iniciadoPreparoTs);
  const pronto = hhmm(u._prontoTs);
  const entregue = hhmm(u._entregueTs);
  if (ini) partes.push(`começou ${ini}`);
  if (pronto) partes.push(`pronto ${pronto}`);
  if (entregue) partes.push(`entregue ${entregue}`);
  if (!ini && !pronto && !entregue && !u.semCozinha) partes.push(ROTULO_UNIDADE[u.status] ?? u.status);
  if (u.operadorCozinha) partes.push(u.operadorCozinha);
  if (u.entregoPor) partes.push(`entregou ${u.entregoPor}`);
  return partes.join(' · ');
}

/** Telefone só com dígitos (às vezes com o 55 na frente) → "(41) 99999-9999". */
function telefoneBonito(t: string): string {
  let d = t.replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return formatPhoneBR(d);
}

function MenuImprimir({ ocupado, onEscolher }: { ocupado: boolean; onEscolher: (t: TipoImpressao) => void }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: Event) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('touchstart', fora);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('touchstart', fora);
    };
  }, [aberto]);

  const opcoes: { tipo: TipoImpressao; icone: string; rotulo: string; dica: string }[] = [
    { tipo: 'cliente', icone: 'ri-receipt-line', rotulo: 'Via do cliente', dica: 'comprovante na impressora do caixa' },
    { tipo: 'cozinha', icone: 'ri-restaurant-line', rotulo: 'Ticket da cozinha', dica: 'de novo na estação de cada item' },
    { tipo: 'resumo', icone: 'ri-file-list-line', rotulo: 'Resumo do pedido', dica: 'a conta resumida' },
  ];
  return (
    <div ref={raiz} className="relative flex-1 min-w-0">
      <button type="button" onClick={() => setAberto((a) => !a)} disabled={ocupado} aria-haspopup="menu" aria-expanded={aberto}
        className={`${btn('out')} w-full`}>
        <i className={ocupado ? 'ri-loader-4-line animate-spin' : 'ri-printer-line'} />
        Imprimir
        <i className={`${aberto ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} text-zinc-400`} />
      </button>
      {aberto && (
        <div role="menu" className="absolute bottom-full left-0 mb-2 w-[min(280px,calc(100vw-2.5rem))] bg-white border border-zinc-200 rounded-2xl shadow-xl py-1.5 z-20">
          {opcoes.map((o) => (
            <button key={o.tipo} type="button" role="menuitem" onClick={() => { setAberto(false); onEscolher(o.tipo); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left cursor-pointer hover:bg-zinc-50">
              <i className={`${o.icone} text-base text-zinc-400`} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-zinc-700">{o.rotulo}</span>
                <span className="block text-[11px] text-zinc-400">{o.dica}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Detalhe de um pedido só ──────────────────────────────────────────────────
function DetalheUnico(props: PropsDetalhe) {
  const { pedido, modo, aberto, onFechar, agoraMs, hoje, fiscal, onToast, acoes } = props;
  const conta = useContas([pedido]);
  // Estado preso ao pedido aberto: ao abrir outro, volta fechado.
  const [modalNfDe, setModalNfDe] = useState<string | null>(null);
  const [temposDe, setTemposDe] = useState<string | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const modalNf = modalNfDe === pedido.id;
  const temposAbertos = temposDe === pedido.id;

  const cancelado = ehCancelado(pedido);
  const canal = canalPedido(pedido);
  const sit = situacaoPedido(pedido, agoraMs, hoje);
  const f = tempoFases(pedido, agoraMs);
  // Sem as notas carregadas, nada é "sem nota" (o botão Emitir apareceria para pedido que já tem nota)
  const fiscalAtivo = fiscal.enabled === true && fiscal.carregado && !fiscal.erroLeitura;
  const emiteNota = fiscal.canais ? (p: PedidoRecente) => fiscal.canais![canalFiscal(p)] : undefined;
  const doc = fiscalAtivo ? (fiscal.byOrder.get(pedido.id) ?? null) : null;
  const notaOcupada = fiscal.busy.has(pedido.id);
  const unidades = pedido.itensDetalhes.flatMap((i) => i.unidades ?? []);

  // ── Cabeçalho ──
  const titulo = `#${numeroCurto(pedido)} · ${ondeQuem(pedido)}`;
  const formas = Array.from(new Set((pedido.pagamentos ?? []).map(formaPagamentoNome)));
  const operador = pedido.garcomNome && (canal === 'caixa' || canal === 'garcom') ? ` · ${pedido.garcomNome}` : '';
  const subtitulo = [
    `${rotuloDia(diaDoPedido(pedido, hoje), hoje)} ${hhmm(pedido._criadoTs) ?? pedido.criadoEm}`,
    `${ROTULO_CANAL[canal]}${operador}`,
    formas.length > 0 ? formas.join(' + ') : null,
  ].filter(Boolean).join(' · ');

  // ── O que falta ──
  const naoPago = ehNaoPago(pedido);
  const semNotaPago = fiscalAtivo && ehSemNota(pedido, true, (id) => fiscal.byOrder.get(id)?.status, emiteNota);
  const semNotaAguardando = fiscalAtivo && naoPago && !notaViva(doc?.status);
  const mostrarSemNota = semNotaPago || semNotaAguardando;
  const recusada = doc != null && (doc.status === 'rejected' || doc.status === 'error');
  const saiuDaCozinha = hhmm(f.entregueTs) ?? hhmm(f.prontoTs);
  const textoNaoPago = [
    saiuDaCozinha
      ? `Saiu da cozinha às ${saiuDaCozinha} e ninguém registrou o pagamento.`
      : ehAtivo(pedido) ? 'O pedido ainda está andando e não tem pagamento registrado.' : 'Ninguém registrou o pagamento deste pedido.',
    pedido.formaAPagar ? `O cliente disse que paga em ${pedido.formaAPagar}.` : null,
  ].filter(Boolean).join(' ');
  const textoSemNota = naoPago
    ? 'Dá para emitir assim que for pago.'
    : recusada
      ? (doc?.sefaz_message || textoErroNota(doc?.error_message) || 'A SEFAZ não aceitou a nota.')
      : doc?.status === 'cancelled'
        ? 'A nota deste pedido foi cancelada.'
        : 'A loja emite NFC-e e este pedido ficou sem.';

  // ── Cancelado ──
  const quandoCancelou = (() => {
    const iso = pedido.canceladoEm;
    const h = hhmm(iso);
    if (!iso || !h) return null;
    const dia = diaBR(iso);
    return dia === hoje ? `às ${h}` : `${rotuloDia(dia, hoje)} às ${h}`;
  })();
  const temUnidadeCozinha = unidades.some((u) => !u.semCozinha);
  const foiParaCozinha = unidades.some((u) => !!u._iniciadoPreparoTs) || !!pedido._iniciouPreparoTs;
  const detalhesCancelamento = [
    pedido.cancelReason || null,
    pedido.canceladoPor ? `por ${pedido.canceladoPor}${quandoCancelou ? ` ${quandoCancelou}` : ''}` : (quandoCancelou ? `cancelado ${quandoCancelou}` : null),
    temUnidadeCozinha ? (foiParaCozinha ? 'já tinha ido para a cozinha' : 'não tinha ido para a cozinha') : null,
  ].filter(Boolean).join(' · ');

  // ── Cliente / entrega ──
  const plataforma = PLATAFORMAS_DELIVERY.find((p) => p.key === pedido.deliveryPlatform);
  const mostrarCliente = !!(pedido.telefone || pedido.endereco || canal === 'delivery' || pedido.deliveryPlatform);
  // Delivery: "Nome - endereço"/"Nome - Retirada" vêm juntos no mesmo campo — separa
  const entrega = canal === 'delivery' ? entregaDoPedido(pedido) : null;
  const nomeCliente = entrega ? entrega.nome : clienteNome(pedido);
  const enderecoEntrega = entrega ? entrega.endereco : (pedido.endereco ?? null);

  const imprimir = async (tipo: TipoImpressao) => {
    setImprimindo(true);
    try { await acoes.imprimir(pedido, tipo); }
    catch { onToast(false, 'Não foi possível imprimir'); }
    finally { setImprimindo(false); }
  };

  const rodape = (
    <>
      <MenuImprimir ocupado={imprimindo} onEscolher={imprimir} />
      <MenuMais grande rotulo="Mais ações" itens={[
        { rotulo: 'Abrir no Gestor de pedidos', icone: 'ri-layout-column-line', onClick: () => acoes.abrirNoGestor(pedido) },
        { rotulo: 'Mandar comprovante no WhatsApp', icone: 'ri-whatsapp-line', onClick: () => acoes.whatsapp(pedido), oculto: !pedido.telefone },
        { rotulo: 'Copiar número', icone: 'ri-file-copy-line', onClick: () => acoes.copiarNumero(pedido) },
        { rotulo: 'Cancelar pedido', icone: 'ri-close-circle-line', onClick: () => acoes.cancelar(pedido), perigo: true, oculto: !acoes.podeCancelar || cancelado },
      ]} />
    </>
  );

  return (
    <>
      <Casca modo={modo} aberto={aberto} onFechar={onFechar} titulo={titulo} subtitulo={subtitulo} rodape={rodape}
        chave={pedido.id} escAtivo={!modalNf}>
        {/* Selos */}
        <div className="flex flex-wrap gap-1.5 mt-1">
          <SeloSituacao sit={sit} />
          {sit.atrasado && sit.tipo !== 'parado' && sit.tipo !== 'cancelado' && <Etiqueta tom="red">passou da meta ({META_PEDIDO_MIN})</Etiqueta>}
          {pedido.cortesia && <Etiqueta tom="amber">Cortesia</Etiqueta>}
          {pedido.deliveryPlatform === 'ifood' && (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-md px-1.5 py-0.5 bg-red-50 text-[#EA1D2C]"><i className="ri-store-2-line" />iFood</span>
          )}
        </div>

        {/* O que falta */}
        {(naoPago || mostrarSemNota) && (
          <div className="rounded-2xl border border-orange-200 bg-gradient-to-b from-orange-50 to-white px-3.5 py-1 mt-3">
            {naoPago && (
              <FaltaItem icone="ri-money-dollar-circle-line" titulo={`Não foi pago — ${brl(conta.total)}`} texto={textoNaoPago}
                acao={acoes.podeCobrar
                  ? <button type="button" onClick={() => acoes.cobrar(pedido)} className={btn('p', 'sm')}>Cobrar</button>
                  : <span className="block max-w-[84px] text-right text-[11.5px] font-bold leading-tight text-zinc-500">Avise o caixa</span>} />
            )}
            {mostrarSemNota && (
              <FaltaItem icone="ri-file-shield-2-line" titulo={recusada && !naoPago ? 'Nota não autorizada' : 'Sem nota fiscal'} texto={textoSemNota}
                acao={
                  <button type="button" onClick={() => setModalNfDe(pedido.id)} disabled={naoPago || notaOcupada}
                    className={naoPago ? btn('out', 'sm') : btn('p', 'sm')}>
                    {notaOcupada ? <><i className="ri-loader-4-line animate-spin" />Emitindo</> : recusada && !naoPago ? 'Tentar de novo' : 'Emitir'}
                  </button>
                } />
            )}
          </div>
        )}

        {/* Passos (ou o aviso de cancelado) */}
        {cancelado ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 mt-3">
            <p className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-red-700">
              <i className="ri-close-circle-line text-base" />Cancelado
            </p>
            {detalhesCancelamento && <p className="text-[12.5px] text-red-800/80 mt-1 leading-relaxed">{detalhesCancelamento}</p>}
          </div>
        ) : (
          <PassosPedido pedido={pedido} agoraMs={agoraMs} />
        )}

        {/* Itens */}
        <Bloco titulo="Itens" direita={unidades.length > 0 ? (
          <button type="button" onClick={() => setTemposDe(temposAbertos ? null : pedido.id)} aria-expanded={temposAbertos}
            className="text-[12px] font-extrabold text-amber-700 hover:underline cursor-pointer">
            {temposAbertos ? 'esconder tempos' : 'tempos por item'}
          </button>
        ) : undefined}>
          {pedido.itensDetalhes.map((item) => {
            const selo = !cancelado && !item.cancelado && ehAtivo(pedido) ? seloDoItem(item) : null;
            const opcoes = opcoesTexto(item);
            return (
              <div key={item.id} className="flex gap-2.5 py-2.5 border-t border-zinc-200/70 first:border-t-0">
                <span className="w-6 h-6 rounded-lg bg-white border border-zinc-200 text-xs font-extrabold text-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5 tabular-nums">
                  {item.quantidade}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-bold leading-snug text-zinc-900">
                    <span className={item.cancelado ? 'line-through text-zinc-400' : ''}>{item.nome}</span>
                    {item.cancelado && <> <Etiqueta tom="red">cancelado</Etiqueta></>}
                  </p>
                  {opcoes && <p className="text-[11.5px] text-zinc-500 leading-snug mt-0.5 break-words">{opcoes}</p>}
                  {item.observacao && <p className="text-[11.5px] text-amber-700 italic font-semibold leading-snug mt-0.5 break-words">“{item.observacao}”</p>}
                  {selo && (
                    <span className={`inline-flex items-center gap-1 mt-1 text-[10.5px] font-bold rounded-md px-1.5 py-0.5 ${selo.tom === 'amber' ? 'bg-amber-50 text-amber-700' : selo.tom === 'green' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                      {selo.pulsa && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                      {selo.texto}
                    </span>
                  )}
                  {temposAbertos && !item.cancelado && item.unidades.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {item.unidades.map((u) => (
                        <li key={u.unidade} className="text-[11px] text-zinc-500 tabular-nums leading-snug">{linhaDaUnidade(u)}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <b className={`text-[13.5px] font-extrabold tabular-nums ${item.cancelado ? 'line-through text-zinc-400' : 'text-zinc-900'}`}>
                    {brl(item.preco * item.quantidade)}
                  </b>
                  {item.quantidade > 1 && <span className="block text-[10.5px] text-zinc-400 tabular-nums">{brl(item.preco)} cada</span>}
                </div>
              </div>
            );
          })}
        </Bloco>

        <ContaBloco conta={conta} riscado={cancelado} />

        <PagamentoBloco pagamentos={pedido.pagamentos ?? []} total={conta.total} pago={!!pedido.pago} cancelado={cancelado} />

        {/* Nota fiscal: aqui só quando já existe nota; "sem nota" e "recusada" ficam no aviso lá de cima */}
        {fiscalAtivo && doc && (doc.status === 'authorized' || doc.status === 'processing' || doc.status === 'pending' || doc.status === 'cancelled') && (
          <Bloco titulo="Nota fiscal">
            <NotaDoc doc={doc} fiscal={fiscal} onToast={onToast} />
          </Bloco>
        )}

        {/* Cliente / entrega */}
        {mostrarCliente && (
          <Bloco titulo={canal === 'delivery' ? 'Cliente e entrega' : 'Cliente'}>
            {nomeCliente && <Linha rotulo="Nome" valor={nomeCliente} />}
            {pedido.telefone && (
              <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                <span className="text-zinc-500">Telefone</span>
                <span className="flex items-center gap-2 min-w-0">
                  <b className="tabular-nums text-zinc-900">{telefoneBonito(pedido.telefone)}</b>
                  <button type="button" onClick={() => acoes.whatsapp(pedido)} className={btn('wa', 'sm')}>
                    <i className="ri-whatsapp-line" />WhatsApp
                  </button>
                </span>
              </div>
            )}
            {entrega?.retirada && <Linha rotulo="Entrega" valor="Retirada no balcão" />}
            {enderecoEntrega && (
              <div className="flex items-start justify-between gap-3 py-1 text-[13px]">
                <span className="text-zinc-500 flex-shrink-0">Endereço</span>
                <span className="text-right min-w-0">
                  <b className="text-zinc-900 break-words">{enderecoEntrega}</b>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enderecoEntrega)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-2 text-[12px] font-extrabold text-amber-700 hover:underline whitespace-nowrap">
                    <i className="ri-map-pin-2-line" /> Mapa
                  </a>
                </span>
              </div>
            )}
            {plataforma && (
              <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                <span className="text-zinc-500">Plataforma</span>
                <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-bold ${plataforma.cor}`}>
                  <i className={plataforma.icon} />{plataforma.label}
                </span>
              </div>
            )}
            {conta.entrega > 0.005 && <Linha rotulo="Taxa de entrega" valor={brl(conta.entrega)} />}
          </Bloco>
        )}
      </Casca>

      {modalNf && (
        <EmitirNfModal
          titulo={`Emitir NFC-e do pedido #${numeroCurto(pedido)}`}
          valor={brl(conta.total)}
          nomeInicial={nomeCliente || undefined}
          onConfirm={async (consumer) => { setModalNfDe(null); await emitirNotas(fiscal, [pedido.id], consumer, onToast); }}
          onClose={() => setModalNfDe(null)}
        />
      )}
    </>
  );
}
