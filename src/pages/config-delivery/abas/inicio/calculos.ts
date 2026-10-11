// Contas da aba Início do Delivery (sem tela, para testar): frase da situação, linha de cada entrega,
// "Falta arrumar" e o resumo dos últimos 30 dias. Teste: src/test/lib/deliveryInicio.test.ts
import type { DeliveryState } from '@/hooks/useDeliveryState';
import { FORMAS_CONHECIDAS, faixasOrdenadas, formaLigada, type ConfigDelivery } from '../../config';
import type { AbaDelivery } from '../../DeliveryTela';

const FUSO = 'America/Sao_Paulo';

/** "23:00" no horário de Brasília (a loja pode estar vendo a tela de um aparelho com outro fuso). */
export function horaBrasilia(quando: Date | number | string): string {
  const d = quando instanceof Date ? quando : new Date(quando);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });
}

/** "9 min", "1 h", "1 h 05 min", "2 dias" (pedido esquecido aberto não vira "189 h 02 min") */
export function duracaoCurta(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  if (m >= 1440) { const d = Math.floor(m / 1440); return d === 1 ? '1 dia' : `${d} dias`; }
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')} min` : `${h} h`;
}

// ── Situação agora ────────────────────────────────────────────────────────────

export type TomSituacao = 'aberto' | 'pausado' | 'fechado';

/**
 * Título + frase do cartão "Situação agora". `estadoEm` = quando o estado chegou do servidor
 * (o "fecha às HH:MM" é esse instante + `minutos_ate_fechar`).
 */
export function descreverSituacao(s: DeliveryState, estadoEm: number): { tom: TomSituacao; titulo: string; frase: string } {
  if (s.open_now) {
    let frase: string;
    if (s.reason === 'horario') {
      const min = s.minutos_ate_fechar;
      frase = typeof min === 'number' && Number.isFinite(min) && min >= 0
        ? `Aberto pelo horário programado. Fecha às ${horaBrasilia(estadoEm + min * 60000)}.`
        : 'Aberto pelo horário programado.';
    } else if (s.reason === 'manual') {
      frase = 'Aberto pelo botão do caixa.';
    } else {
      frase = 'Aberto.';
    }
    if (!s.schedule_enabled) frase += ' Sem horário programado, só fecha pelo botão.';
    return { tom: 'aberto', titulo: 'Aberto agora', frase };
  }
  if (s.reason === 'pausado') {
    const ate = s.paused_until ? horaBrasilia(s.paused_until) : '';
    return { tom: 'pausado', titulo: 'Pausado', frase: ate ? `Pausado até ${ate}.` : 'Pausado.' };
  }
  const frase = s.reason === 'sem_sessao' ? 'Fechado: o caixa ainda não foi aberto.'
    : s.reason === 'fora_horario' ? 'Fora do horário programado.'
    : s.reason === 'fechado_manual' ? 'Fechado pelo botão.'
    : 'Fechado.';
  return { tom: 'fechado', titulo: 'Fechado', frase };
}

// ── Entregas agora ────────────────────────────────────────────────────────────

export interface ProblemaEntrega { at?: string; text?: string; by?: string }
export interface EntregaAberta {
  id: string; number: string; cliente: string; telefone?: string; endereco: string; total: number; taxa: number;
  status: string; motoboy_status: string | null; motoboy_note: string | null;
  problemas?: ProblemaEntrega[];
  driver_id: string | null; driver_nome: string | null;
  created_at?: string;
}

/** "#0042" (últimos 4 dígitos do número do pedido). */
export function numeroCurto(n: string | number | null | undefined): string {
  const dig = String(n ?? '').replace(/\D/g, '');
  return dig ? '#' + dig.slice(-4).padStart(4, '0') : String(n ?? '');
}

/** Nome do cliente: o pedido grava "Nome - Endereço". */
export function nomeDoCliente(destino: string | null | undefined): string {
  return String(destino ?? '').split(/\s+[-–—]\s+/)[0].trim() || 'Cliente';
}

/** Problemas registrados (com o texto antigo de `motoboy_note` para pedidos de antes do histórico). */
export function problemasDoPedido(o: Pick<EntregaAberta, 'problemas' | 'motoboy_note'>): ProblemaEntrega[] {
  if (o.problemas && o.problemas.length > 0) return o.problemas;
  return o.motoboy_note ? [{ text: o.motoboy_note }] : [];
}

export type TomEntrega = 'o' | 'r' | 'g' | 'z';
export interface LinhaEntrega { tom: TomEntrega; icone: string; frase: string; semEntregador: boolean }

/** O que dizer de cada entrega em aberto. `prontoEm` = quando a cozinha terminou (se a gente souber). */
export function descreverEntrega(o: EntregaAberta, prontoEm: string | null | undefined, agora: number): LinhaEntrega {
  const moto = o.driver_nome || (o.driver_id ? 'o entregador' : '');
  if (o.motoboy_status === 'problema') {
    const ps = problemasDoPedido(o);
    const ultimo = (ps[ps.length - 1]?.text ?? '').trim();
    return { tom: 'r', icone: 'ri-alert-line', semEntregador: !o.driver_id, frase: ultimo ? `Problema: ${ultimo}` : 'Problema na entrega' };
  }
  if (o.motoboy_status === 'coletou') {
    return { tom: 'g', icone: 'ri-e-bike-2-line', semEntregador: false, frase: `Em rota com ${moto || 'o entregador'}` };
  }
  if (o.motoboy_status === 'a_caminho_loja') {
    return { tom: 'o', icone: 'ri-store-2-line', semEntregador: false, frase: `${moto ? moto + ' a' : 'A'} caminho da loja` };
  }
  if (o.status === 'ready') {
    const t = prontoEm ? Date.parse(prontoEm) : NaN;
    const min = Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / 60000)) : null;
    const quando = min == null ? '' : min < 1 ? ' agora' : ` há ${duracaoCurta(min)}`;
    if (!o.driver_id) return { tom: 'r', icone: 'ri-takeaway-line', semEntregador: true, frase: `Pronto${quando}, sem entregador` };
    return { tom: 'o', icone: 'ri-takeaway-line', semEntregador: false, frase: `Pronto${quando}, ${moto} vai buscar` };
  }
  if (o.status === 'preparing') {
    return { tom: 'o', icone: 'ri-fire-line', semEntregador: !o.driver_id, frase: moto ? `Em preparo · ${moto}` : 'Em preparo' };
  }
  if (o.status === 'new') {
    return { tom: 'z', icone: 'ri-time-line', semEntregador: !o.driver_id, frase: 'Na fila da cozinha' };
  }
  return { tom: 'z', icone: 'ri-question-line', semEntregador: !o.driver_id, frase: o.status };
}

// ── Esperando o pagamento pelo app (Pix ou cartão) ───────────────────────────────────────────────────────────

/** Mensagem do WhatsApp para quem ainda não pagou pelo app (serve para Pix e para cartão). */
export function mensagemEsperandoPix(p: { nome: string; numero: string; valor: string; link: string }): string {
  const primeiro = p.nome.trim().split(/\s+/)[0];
  const oi = primeiro && primeiro !== 'Cliente' ? `Oi ${primeiro}!` : 'Oi!';
  return `${oi} Seu pedido ${p.numero} de ${p.valor} está esperando o pagamento pelo app para ir para a cozinha. `
    + `Se a tela do pagamento sumiu, é só abrir o link de novo neste celular: ${p.link}`;
}

// ── Falta arrumar ─────────────────────────────────────────────────────────────

/** As formas que o cliente pode ver no cardápio (Pix/cartão pelo app só com o Mercado Pago ligado). */
export const FORMAS_DO_CARDAPIO = FORMAS_CONHECIDAS;

export interface SituacaoMp { pix: boolean; cartao: boolean }
export type TomFalta = 'alerta' | 'prop' | 'neutro';
export interface ItemFalta { id: string; tom: TomFalta; icone: string; titulo: string; texto: string; botao: string; aba: AbaDelivery }

export interface EntradaFalta {
  /** Configuração como está GRAVADA (não o rascunho). */
  salvo: ConfigDelivery;
  nMotoboys: number;
  /** null = não deu para conferir o Mercado Pago (não alerta). */
  mp: SituacaoMp | null;
  ehDono: boolean;
  /** false = sem linha ou desligado; null = não deu para conferir (não alerta). */
  assistenteLigado: boolean | null;
}

export function itensFaltaArrumar(e: EntradaFalta): ItemFalta[] {
  const { salvo } = e;
  const itens: ItemFalta[] = [];

  if (salvo.lojaLat == null || salvo.lojaLng == null) {
    itens.push({ id: 'pino', tom: 'alerta', icone: 'ri-map-pin-line', titulo: 'Loja sem pino no mapa', aba: 'area', botao: 'Marcar no mapa',
      texto: 'Sem o pino, o app não calcula a distância nem a taxa de nenhum pedido.' });
  }
  if (faixasOrdenadas(salvo.faixas).length === 0) {
    itens.push({ id: 'faixa', tom: 'alerta', icone: 'ri-road-map-line', titulo: 'Nenhuma faixa de entrega: o cliente não consegue pedir entrega', aba: 'area', botao: 'Criar faixas',
      texto: 'Cadastre até onde você entrega e quanto cobra em cada distância.' });
  }

  const visiveis = FORMAS_DO_CARDAPIO.filter((k) => formaLigada(salvo.formasPagamento, k)).filter((k) => {
    if (!e.mp) return true;
    if (k === 'pix_online') return e.mp.pix;
    if (k === 'cartao_online') return e.mp.cartao;
    return true;
  });
  if (visiveis.length === 0) {
    itens.push({ id: 'pagamento', tom: 'alerta', icone: 'ri-bank-card-line', titulo: 'Nenhuma forma de pagamento', aba: 'pagamento', botao: 'Escolher formas',
      texto: 'O cliente chega no fim do pedido e não tem como escolher a forma de pagar.' });
  }

  if (e.nMotoboys > 0 && !salvo.acerto.ativo) {
    itens.push({ id: 'acerto', tom: 'prop', icone: 'ri-money-dollar-circle-line',
      titulo: `${e.nMotoboys} ${e.nMotoboys === 1 ? 'entregador e nenhuma regra' : 'entregadores e nenhuma regra'} de pagamento`,
      aba: 'acerto', botao: 'Definir quanto ganham',
      texto: 'Sem regra, as entregas não entram no acerto em Financeiro › Entregadores.' });
  }
  if (!salvo.horario.enabled) {
    itens.push({ id: 'horario', tom: 'prop', icone: 'ri-time-line', titulo: 'O delivery só abre e fecha pelo botão', aba: 'horario', botao: 'Programar horário',
      texto: 'Com o horário programado ele abre sozinho quando o caixa abre e fecha na hora certa.' });
  }

  if (e.mp) {
    const pixSem = formaLigada(salvo.formasPagamento, 'pix_online') && !e.mp.pix;
    const cartaoSem = formaLigada(salvo.formasPagamento, 'cartao_online') && !e.mp.cartao;
    if (pixSem || cartaoSem) {
      itens.push({ id: 'mp', tom: 'neutro', icone: 'ri-smartphone-line', aba: 'pagamento', botao: 'Ver pagamento',
        titulo: pixSem && cartaoSem ? 'Pix e cartão pelo app ligados, mas o cliente não vê'
          : pixSem ? 'Pix pelo app ligado, mas o cliente não vê' : 'Cartão pelo app ligado, mas o cliente não vê',
        texto: pixSem
          ? 'Falta ligar o Mercado Pago (Configurações › Pagamentos). Até lá, o cliente só vê as outras formas.'
          : 'O Pix pelo app já aparece. Para o cartão falta a Public Key e aceitar cartão no Mercado Pago.' });
    }
  }
  if (e.ehDono && e.assistenteLigado === false) {
    itens.push({ id: 'assistente', tom: 'neutro', icone: 'ri-robot-2-line', titulo: 'Assistente do WhatsApp desligado', aba: 'assistente', botao: 'Ver como funciona',
      texto: 'Ele responde quem chama, manda o cardápio e o link para pedir.' });
  }
  if (!salvo.whatsappLoja) {
    itens.push({ id: 'whatsapp', tom: 'neutro', icone: 'ri-whatsapp-line', titulo: 'Sem botão "Falar com a loja"', aba: 'mensagens', botao: 'Colocar o número',
      texto: 'Sem o número da loja, o cliente não tem como chamar vocês pelo WhatsApp a partir do cardápio.' });
  }
  return itens;
}

// ── Últimos 30 dias ───────────────────────────────────────────────────────────

export interface PedidoMes {
  status: string;
  total_amount: number | string | null;
  delivery_fee: number | string | null;
  cancel_reason: string | null;
  motoboy_status: string | null;
  motoboy_timeline: Record<string, string> | null;
  out_for_delivery_at: string | null;
  delivery_source: string | null;
  delivery_platform: string | null;
  /** Preenchido = pedido do iFood (mesmo entregue pelo motoboy da loja): a venda é do canal iFood. */
  ifood_order_id?: string | null;
  created_at: string;
}

export interface Resumo30d {
  /** Pedidos considerados (entrega própria, fora rascunho de Pix não pago). */
  total: number;
  /** Entregas feitas pelo motoboy da loja (inclui pedido do iFood que ele entregou: é trabalho dele). */
  entregues: number;
  /** Soma dos não cancelados, sem pedido do iFood (esse é venda do canal iFood). */
  vendido: number;
  ticket: number;
  taxaMedia: number;
  cancelados: number;
  motivoTop: { motivo: string; n: number } | null;
  entreguesSemMarca: number;
  doInstagram: number;
  naoCancelados: number;
  tempoMedioMin: number | null;
  tempoAmostra: number;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const instante = (v: unknown): number | null => { if (typeof v !== 'string' || !v) return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

/** Entrega própria (o iFood e a retirada têm relatório e Gestor próprios). */
export const ehEntregaPropria = (p: { delivery_platform: string | null }) => p.delivery_platform == null || p.delivery_platform === 'propria';

/** Pedido do iFood (inclusive o entregue pelo motoboy da loja ou pago na loja): a venda é contada pelo canal iFood. */
export const ehPedidoIfood = (p: { ifood_order_id?: string | null }) => !!p.ifood_order_id;

export function resumir30d(pedidos: PedidoMes[]): Resumo30d {
  // Rascunho (Pix pelo app ainda não pago) não é venda: ou paga e vira pedido, ou é cancelado no fechamento.
  const base = pedidos.filter((p) => ehEntregaPropria(p) && p.status !== 'draft');
  const cancelados = base.filter((p) => p.status === 'cancelled' && !ehPedidoIfood(p));
  const vivos = base.filter((p) => p.status !== 'cancelled');
  // Entregas e tempo médio contam o iFood entregue pelo motoboy da loja (ele trabalhou); venda, ticket e taxa não.
  const vendas = vivos.filter((p) => !ehPedidoIfood(p));
  const entregues = vivos.filter((p) => p.status === 'delivered');
  const vendido = vendas.reduce((s, p) => s + num(p.total_amount), 0);
  const taxas = vendas.reduce((s, p) => s + num(p.delivery_fee), 0);

  const porMotivo = new Map<string, number>();
  for (const p of cancelados) {
    const m = (p.cancel_reason ?? '').trim();
    porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1);
  }
  let motivoTop: Resumo30d['motivoTop'] = null;
  for (const [motivo, n] of Array.from(porMotivo.entries())) {
    if (!motivoTop || n > motivoTop.n) motivoTop = { motivo, n };
  }

  // Tempo "saiu → entregou". A hora da saída é a do "Coletou"; `out_for_delivery_at` só serve quando não há
  // "Coletou" (o "Entregue" regrava essa coluna com a hora da entrega, e isso daria 0 min).
  let soma = 0; let amostra = 0;
  for (const p of entregues) {
    const tl = p.motoboy_timeline && typeof p.motoboy_timeline === 'object' ? p.motoboy_timeline : null;
    const saiu = instante(tl?.coletou) ?? instante(p.out_for_delivery_at);
    const entregou = instante(tl?.entregou);
    if (saiu == null || entregou == null) continue;
    const min = (entregou - saiu) / 60000;
    if (min >= 0.5 && min <= 240) { soma += min; amostra++; }
  }

  return {
    total: base.length,
    entregues: entregues.length,
    vendido,
    ticket: vendas.length ? vendido / vendas.length : 0,
    taxaMedia: vendas.length ? taxas / vendas.length : 0,
    cancelados: cancelados.length,
    motivoTop,
    entreguesSemMarca: entregues.filter((p) => !p.motoboy_status).length,
    doInstagram: vendas.filter((p) => ['ig', 'instagram'].includes((p.delivery_source ?? '').trim().toLowerCase())).length,
    naoCancelados: vendas.length,
    tempoMedioMin: amostra >= 3 ? Math.round(soma / amostra) : null,
    tempoAmostra: amostra,
  };
}
