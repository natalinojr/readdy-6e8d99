import type { ReactNode } from 'react';
import type { PedidoRecente } from '@/types/pdv';
import { META_PEDIDO_MIN, diaBR, ehCancelado, situacaoPedido, tempoFases } from '@/lib/pedidosRegras';

// Passos do pedido (layout novo de /pedidos): Pediu → Cozinha → Pronto → Entregue numa linha,
// com a hora de cada passo embaixo e, em cima da linha entre dois passos, quanto tempo o pedido
// ficou naquela fase. Toda a conta de tempo vem de tempoFases / situacaoPedido (pedidosRegras).

const TZ = 'America/Sao_Paulo';

const hhmm = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
};

/** 9 → "9 min", 75 → "1 h 15", 1500 → "1 d". */
function fmtMin(n: number): string {
  if (n < 1) return '<1 min';
  if (n < 60) return `${n} min`;
  if (n >= 1440) return `${Math.floor(n / 1440)} d`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

type EstadoPasso = 'ok' | 'atual' | 'falta';
type TomPilula = 'neutro' | 'ambar' | 'vermelho';

interface Passo { chave: string; rotulo: string; icone: string; estado: EstadoPasso; sub: string }
interface Pilula { texto: string; legenda: string; tom: TomPilula }

const COR_PILULA: Record<TomPilula, string> = {
  neutro: 'bg-zinc-100 text-zinc-600',
  ambar: 'bg-amber-100 text-amber-700',
  vermelho: 'bg-red-100 text-red-700',
};

export default function PassosPedido({ pedido, agoraMs }: { pedido: PedidoRecente; agoraMs: number }) {
  // Cancelado não tem passos: o detalhe mostra o bloco de cancelado.
  if (ehCancelado(pedido)) return null;

  const f = tempoFases(pedido, agoraMs);
  const unidades = pedido.itensDetalhes.filter((i) => !i.cancelado).flatMap((i) => i.unidades ?? []);
  const comCozinha = unidades.filter((u) => !u.semCozinha);
  // Mesmo critério do tempoFases: sem unidade com cozinha (só bebida) não há fila nem cozinha.
  const temCozinha = comCozinha.length > 0;

  const hoje = diaBR(new Date(agoraMs).toISOString());
  const sit = situacaoPedido(pedido, agoraMs, hoje);
  const criadoMs = f.criadoTs ? Date.parse(f.criadoTs) : null;
  const desdeCriado = criadoMs != null ? Math.max(0, Math.floor((agoraMs - criadoMs) / 60000)) : (pedido.minutosAtras ?? 0);

  const prontas = comCozinha.filter((u) => u.status === 'pronto' || u.status === 'entregue').length;
  const entregues = unidades.filter((u) => u.status === 'entregue').length;

  // Passo "atual" = o que o pedido está esperando alcançar (a pílula da fase que corre fica na linha que chega nele).
  const atualIdx = f.correndo == null
    ? -1
    : temCozinha ? { fila: 1, cozinha: 2, entrega: 3 }[f.correndo] : 2;
  const estado = (i: number): EstadoPasso => (atualIdx < 0 || i < atualIdx ? 'ok' : i === atualIdx ? 'atual' : 'falta');

  const hCriado = hhmm(f.criadoTs) ?? pedido.criadoEm ?? '—';
  const hEntregue = (e: EstadoPasso) => (e === 'ok' ? (hhmm(f.entregueTs) ?? '—') : entregues > 0 ? `${entregues} de ${unidades.length}` : '—');

  const passos: Passo[] = temCozinha
    ? [
        { chave: 'pediu', rotulo: 'Pediu', icone: 'ri-file-list-3-line', estado: 'ok', sub: hCriado },
        { chave: 'cozinha', rotulo: 'Cozinha', icone: 'ri-fire-line', estado: estado(1), sub: estado(1) === 'ok' ? (hhmm(f.cozinhaTs) ?? '—') : '—' },
        {
          chave: 'pronto', rotulo: 'Pronto', icone: 'ri-checkbox-circle-line', estado: estado(2),
          sub: estado(2) === 'ok' ? (hhmm(f.prontoTs) ?? '—') : estado(2) === 'atual' ? `${prontas} de ${comCozinha.length}` : '—',
        },
        { chave: 'entregue', rotulo: 'Entregue', icone: 'ri-hand-heart-line', estado: estado(3), sub: hEntregue(estado(3)) },
      ]
    : [
        { chave: 'pediu', rotulo: 'Pediu', icone: 'ri-file-list-3-line', estado: 'ok', sub: hCriado },
        { chave: 'pronto', rotulo: 'Pronto', icone: 'ri-checkbox-circle-line', estado: 'ok', sub: 'sem cozinha' },
        { chave: 'entregue', rotulo: 'Entregue', icone: 'ri-hand-heart-line', estado: estado(2), sub: hEntregue(estado(2)) },
      ];

  // Pílula da linha que chega no passo i: fase terminada ("6 min na cozinha") ou a que está correndo ("há 30 min").
  const tomCorrendo: TomPilula = sit.atrasado ? 'vermelho' : 'ambar';
  const correndoTexto = f.correndoMin != null ? (f.correndoMin < 1 ? 'agora' : `há ${fmtMin(f.correndoMin)}`) : null;
  const pilula = (fase: 'fila' | 'cozinha' | 'entrega', feito: number | null, legendaFeita: string, legendaCorrendo: string): Pilula | null => {
    if (f.correndo === fase && correndoTexto) return { texto: correndoTexto, legenda: legendaCorrendo, tom: tomCorrendo };
    if (feito != null) return { texto: fmtMin(feito), legenda: legendaFeita, tom: 'neutro' };
    return null;
  };
  const pilulas: (Pilula | null)[] = temCozinha
    ? [
        null,
        pilula('fila', f.fila, 'na fila', 'na fila'),
        pilula('cozinha', f.cozinha, 'na cozinha', 'fazendo'),
        pilula('entrega', f.entrega, 'até entregar', 'esperando'),
      ]
    : [null, null, pilula('entrega', f.entrega ?? f.total, 'até entregar', 'esperando')];
  const temPilula = pilulas.some(Boolean);

  // Linha de baixo: entregue → total x meta; andando → tempo até agora x meta.
  let resumo: ReactNode = null;
  if (f.correndo != null) {
    resumo = (
      <p className={`text-center text-[11.5px] mt-2 ${sit.atrasado ? 'text-red-600' : 'text-zinc-400'}`}>
        Até agora <b className={sit.atrasado ? 'text-red-700' : 'text-zinc-900'}>{fmtMin(desdeCriado)}</b> · meta {META_PEDIDO_MIN}
      </p>
    );
  } else if (f.total != null) {
    const passou = f.total - META_PEDIDO_MIN;
    resumo = passou > 0 ? (
      <p className="text-center text-[11.5px] mt-2 text-red-600">
        Total <b className="text-red-700">{fmtMin(f.total)}</b> · meta {META_PEDIDO_MIN} · passou {fmtMin(passou)}
      </p>
    ) : (
      <p className="text-center text-[11.5px] mt-2 text-zinc-400">
        Total <b className="text-zinc-900">{fmtMin(f.total)}</b> · meta {META_PEDIDO_MIN} <span className="text-emerald-600 font-bold">✓</span>
      </p>
    );
  }

  return (
    <div className="mt-3" aria-label="Passos do pedido">
      <div className={`flex items-start ${temPilula ? 'pt-9' : 'pt-1'}`}>
        {passos.map((p, i) => {
          const pil = pilulas[i];
          const bolinha = p.estado === 'ok'
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : p.estado === 'atual'
              ? 'bg-amber-500 border-amber-500 text-white animate-pulse'
              : 'bg-white border-zinc-200 text-zinc-300';
          return (
            <div key={p.chave} className="relative flex-1 min-w-0 text-center">
              {i > 0 && (
                <span aria-hidden className={`absolute top-[13px] left-[-50%] right-1/2 h-0.5 ${p.estado === 'falta' ? 'bg-zinc-200' : 'bg-emerald-500'}`} />
              )}
              {pil && (
                <span className={`absolute left-0 bottom-full mb-1 -translate-x-1/2 z-20 rounded-xl px-2 py-0.5 text-center leading-tight whitespace-nowrap ${COR_PILULA[pil.tom]}`}>
                  <b className="block text-[10.5px] font-extrabold tabular-nums">{pil.texto}</b>
                  <small className="block text-[9px] font-semibold opacity-80">{pil.legenda}</small>
                </span>
              )}
              <span className={`relative z-10 mx-auto grid place-items-center w-7 h-7 rounded-full border-2 text-sm ${bolinha}`}>
                <i className={p.estado === 'ok' ? 'ri-check-line' : p.icone} />
              </span>
              <b className={`block text-[11px] font-extrabold mt-1 ${p.estado === 'falta' ? 'text-zinc-400' : 'text-zinc-800'}`}>{p.rotulo}</b>
              <span className="block text-[10.5px] text-zinc-400 tabular-nums truncate px-0.5" title={typeof p.sub === 'string' ? p.sub : undefined}>{p.sub}</span>
            </div>
          );
        })}
      </div>
      {resumo}
    </div>
  );
}
