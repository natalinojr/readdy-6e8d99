import type { PedidoRecente, OrigemPedido } from '@/types/pdv';
import type { KDSPedido } from '@/types/kds';

export type FiltroStatus = 'todos' | 'aberto' | 'pronto' | 'entregue' | 'cancelado';
export type FiltroOrigem = 'todos' | 'caixa' | 'garcom' | 'mesa' | 'autoatendimento' | 'delivery';
export type ModoPeriodo = 'preset' | 'dia' | 'periodo' | 'mes' | 'ano';

export const getHojeBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export const HOJE = getHojeBR();

export const DB_STATUS_LABEL: Record<string, string> = {
  new: 'Na Fila', preparing: 'Em preparo', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado',
};
export const STATUS_LABEL: Record<string, string> = {
  aberto: 'Em aberto', pronto: 'Pronto', entregue: 'Entregue', cancelado: 'Cancelado',
};
export const STATUS_STYLE: Record<string, string> = {
  aberto: 'bg-amber-100 text-amber-700 border-amber-200',
  pronto: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  entregue: 'bg-sky-100 text-sky-700 border-sky-200',
  cancelado: 'bg-red-100 text-red-700 border-red-200',
  new: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  preparing: 'bg-amber-100 text-amber-700 border-amber-200',
  ready: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  delivered: 'bg-sky-100 text-sky-700 border-sky-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
};
export const STATUS_DOT: Record<string, string> = {
  aberto: 'bg-amber-400', pronto: 'bg-emerald-400', entregue: 'bg-sky-400', cancelado: 'bg-red-400',
  new: 'bg-zinc-400', preparing: 'bg-amber-400', ready: 'bg-emerald-400', delivered: 'bg-sky-400', cancelled: 'bg-red-400',
};
export const ORIGEM_LABEL: Record<string, string> = {
  caixa: 'PDV Caixa', garcom: 'PDV Garçom', mesa: 'Mesa (QR)', autoatendimento: 'Autoatendimento', delivery: 'Delivery',
};
export const ORIGEM_ICON: Record<string, string> = {
  caixa: 'ri-store-line', garcom: 'ri-user-star-line', mesa: 'ri-qr-code-line', autoatendimento: 'ri-tablet-line', delivery: 'ri-motorbike-line',
};

export const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

export const formatarDataExibicao = (data: string): string => {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
};

export function somarDias(dataStr: string, dias: number): string {
  const d = new Date(`${dataStr}T00:00:00-03:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// ── Helpers de QR code universal ──────────────────────────────────────────────
// QR code universal = pedido de mesa sem mesa física (mesaNumero 0/ausente) com
// senha de participante. A identidade real fica na senha (participantToken) e no
// participantName, nao em "Mesa 0".

export function isQRUniversal(p: Pick<PedidoRecente, 'origem' | 'mesaNumero' | 'participantToken'>): boolean {
  return p.origem === 'mesa' && !!p.participantToken && !p.mesaNumero;
}

/** Remove o prefixo "Mesa N -" de um nome poluido (ex.: "Mesa 0 - Angelica" → "Angelica"). */
export function limparNomeMesa(nome?: string | null): string {
  return (nome ?? '').replace(/^Mesa\s*\d*\s*[-–.·]?\s*/i, '').trim();
}

/** Nome do cliente exibivel: participantName (QR) ou nomeCliente sem prefixo de mesa. */
export function clienteNome(p: Pick<PedidoRecente, 'participantToken' | 'participantName' | 'nomeCliente'>): string {
  if (p.participantToken) return p.participantName || limparNomeMesa(p.nomeCliente);
  return p.nomeCliente ?? '';
}

/** Rotulo de origem: "QR CODE" para QR universal, senao o rotulo padrao. */
export function origemLabelFor(p: Pick<PedidoRecente, 'origem' | 'mesaNumero' | 'participantToken'>): string {
  if (isQRUniversal(p)) return 'QR CODE';
  return ORIGEM_LABEL[p.origem] ?? p.origem;
}

export const destino = (pedido: PedidoRecente): string => {
  if (isQRUniversal(pedido)) return `Senha ${pedido.participantToken}`;
  if (pedido.destino === 'mesa') return `Mesa ${pedido.mesaNumero ?? ''}`;
  if (pedido.destino === 'nome') return pedido.nomeCliente ?? '—';
  if (pedido.destino === 'delivery') return pedido.nomeCliente ?? 'Delivery';
  if (pedido.destino === 'senha') return `Senha ${pedido.senha ?? ''}`;
  return 'Na hora';
};

export function kdsParaRecente(p: KDSPedido): PedidoRecente {
  const now = Date.now();
  const minutosAtras = Math.floor((now - p.criadoEm) / 60000);
  const dtKds = new Date(p.criadoEm);
  const criadoHora = dtKds.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const datePedido = dtKds.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  const kdsStatusMap: Record<string, PedidoRecente['status']> = {
    novo: 'aberto', preparo: 'aberto', pronto: 'pronto', entregue: 'entregue',
  };

  const origemMap: Record<string, OrigemPedido> = {
    caixa: 'caixa', garcom: 'garcom', mesa: 'mesa', mesa_qr: 'mesa',
    autoatendimento: 'autoatendimento', delivery: 'delivery',
  };

  const itensProntos = p.itens.filter(
    (i) => i.status === 'pronto' || i.status === 'entregue',
  ).length;

  const temposPreparo = p.itens
    .filter((i) => i.iniciouPreparoEm && i.ficouProntoEm)
    .map((i) => ((i.ficouProntoEm! - i.iniciouPreparoEm!) / 60000));

  const slaCozinha = temposPreparo.length > 0
    ? Math.round(temposPreparo.reduce((a, b) => a + b, 0) / temposPreparo.length)
    : undefined;

  const slaEsperaMin = p.itens
    .filter((i) => i.iniciouPreparoEm && i.entroKdsEm)
    .map((i) => ((i.iniciouPreparoEm! - i.entroKdsEm!) / 60000));

  const slaEspera = slaEsperaMin.length > 0
    ? Math.round(slaEsperaMin.reduce((a, b) => a + b, 0) / slaEsperaMin.length)
    : undefined;

  return {
    id: p.id,
    numero: p.numero,
    destino: p.destino === 'delivery' ? 'nome' : p.destino,
    mesaNumero: p.mesaNumero,
    nomeCliente: p.nomeCliente ?? (p.destino === 'delivery' ? 'Delivery' : undefined),
    senha: p.senha,
    status: kdsStatusMap[p.status] ?? 'aberto',
    total: 0,
    criadoEm: criadoHora,
    dataPedido: datePedido,
    minutosAtras,
    itensProntos,
    itensTotal: p.itens.reduce((sum, i) => sum + i.quantidade, 0),
    origem: origemMap[p.origem] ?? 'caixa',
    garcomNome: p.garcomNome,
    tempoAberto: p.status === 'entregue' ? minutosAtras : undefined,
    atrasado: slaCozinha !== undefined && slaCozinha > 15,
    slaCozinha,
    slaEspera,
    slaAlvo: 15,
    itensDetalhes: p.itens.map((item) => ({
      id: item.id,
      nome: item.nome,
      quantidade: item.quantidade,
      preco: 0,
      estacao: item.estacao,
      opcoes: item.opcoes?.map((o) => o.opcaoNome ?? '') ?? [],
      observacao: item.observacoes?.[0],
      unidades: item.unidades && item.unidades.length > 0
        ? item.unidades.map((u, idx) => ({
            unidade: idx + 1,
            status: (u.status === 'entregue' ? 'entregue'
              : u.status === 'pronto' ? 'pronto'
              : u.status === 'preparo' ? 'preparo'
              : 'aguardando') as 'aguardando' | 'preparo' | 'pronto' | 'entregue',
            operadorCozinha: u.operadorPreparo ?? item.operadorPreparo,
            ficouProntoEm: u.ficouProntoEm
              ? new Date(u.ficouProntoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : undefined,
            entregueEm: u.entregueEm !== undefined
              ? new Date(u.entregueEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : undefined,
            _iniciadoPreparoTs: u.iniciouPreparoEm ? new Date(u.iniciouPreparoEm).toISOString() : null,
            _prontoTs: u.ficouProntoEm ? new Date(u.ficouProntoEm).toISOString() : null,
            _entregueTs: u.entregueEm ? new Date(u.entregueEm).toISOString() : null,
            semCozinha: false, // KDS items always pass through kitchen
            _criadoTs: new Date(p.criadoEm).toISOString(),
          }))
        : Array.from({ length: item.quantidade }, (_, idx) => ({
            unidade: idx + 1,
            status: (item.status === 'entregue' ? 'entregue'
              : item.status === 'pronto' ? 'pronto'
              : item.status === 'preparo' ? 'preparo'
              : 'aguardando') as 'aguardando' | 'preparo' | 'pronto' | 'entregue',
            operadorCozinha: item.operadorPreparo,
            ficouProntoEm: item.ficouProntoEm
              ? new Date(item.ficouProntoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : undefined,
            _iniciadoPreparoTs: item.iniciouPreparoEm ? new Date(item.iniciouPreparoEm).toISOString() : null,
            _prontoTs: item.ficouProntoEm ? new Date(item.ficouProntoEm).toISOString() : null,
            _entregueTs: null,
            _criadoTs: new Date(p.criadoEm).toISOString(),
          })),
    })),
  };
}
