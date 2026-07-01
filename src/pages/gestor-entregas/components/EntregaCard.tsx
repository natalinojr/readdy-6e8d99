import type { EntregaPedido } from '../hooks/useGestorEntregas';
import { fmtMoeda, fmtTelefone, waNumero, horaCurta, proximaFase, prazoInfo, temProblema } from '../utils';

interface Props {
  pedido: EntregaPedido;
  now: number;
  busy: string;
  onAbrir: (orderId: string) => void;
  onAvancar: (orderId: string, signal: string) => void;
  onProblema: (orderId: string) => void;
  onLiberar: (orderId: string) => void;
}

const PRAZO_TOM: Record<string, string> = {
  verde: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ambar: 'bg-amber-50 text-amber-700 border-amber-200',
  vermelho: 'bg-red-50 text-red-700 border-red-200',
};

const numCurto = (n: string) => `#${String(n).replace(/\D/g, '').slice(-4) || n}`;
const stop = (e: React.MouseEvent) => e.stopPropagation();

export default function EntregaCard({ pedido: o, now, busy, onAbrir, onAvancar, onProblema, onLiberar }: Props) {
  const prazo = prazoInfo(o, now);
  const prox = proximaFase(o);
  const problemaAtivo = o.motoboy_status === 'problema';
  const problemaRegistrado = temProblema(o);
  const entregue = o.status === 'delivered' || o.motoboy_status === 'entregou';
  const tl = o.motoboy_timeline || {};
  const algumBusy = !!busy && busy.startsWith(o.id + ':');

  const probs = (o.problemas && o.problemas.length > 0)
    ? o.problemas
    : (o.motoboy_note ? [{ at: '', text: o.motoboy_note }] : []);
  const totalRegistros = (o.problemas?.length ?? 0) + (o.delivery_notes?.length ?? 0);

  return (
    <div
      onClick={() => onAbrir(o.id)}
      title="Ver detalhes do pedido"
      className={`bg-white rounded-xl border p-3 space-y-2 transition-shadow hover:shadow-md cursor-pointer ${problemaRegistrado ? 'border-red-300 ring-1 ring-red-200' : 'border-zinc-200'}`}
    >
      {/* Cabeçalho: nº + hora + prazo */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-black text-zinc-800">{numCurto(o.number)}</span>
          {problemaRegistrado && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700" title="Problema registrado neste pedido">
              <i className="ri-alert-fill" /> Problema
            </span>
          )}
          <span className="text-[10px] text-zinc-400" title="Pedido criado">{horaCurta(o.created_at)}</span>
          {totalRegistros > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500" title="Registros (problemas/observações)">
              <i className="ri-chat-3-line" />{totalRegistros}
            </span>
          )}
        </div>
        {entregue ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200" title="Entregue">
            <i className="ri-checkbox-circle-line" /> {horaCurta(tl.entregou) || 'entregue'}
          </span>
        ) : prazo ? (
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${PRAZO_TOM[prazo.tom]}`} title="Prazo de entrega (previsto pelo SLA)">
            <i className="ri-time-line" /> {prazo.texto}
          </span>
        ) : null}
      </div>

      {/* Cliente + endereço */}
      <div>
        <p className="text-sm font-bold text-zinc-800 leading-tight">{o.cliente}</p>
        <p className="text-[11px] text-zinc-500 line-clamp-2 leading-snug mt-0.5">{o.endereco || '—'}</p>
      </div>

      {/* Telefone: ligar + whatsapp */}
      {o.telefone ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-500 tabular-nums flex-1 truncate">{fmtTelefone(o.telefone)}</span>
          <a href={`tel:+55${o.telefone}`} onClick={stop} title="Ligar para o cliente"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 text-zinc-700 text-[10px] font-bold hover:bg-zinc-200">
            <i className="ri-phone-line" /> Ligar
          </a>
          <a href={`https://wa.me/${waNumero(o.telefone)}`} target="_blank" rel="noopener noreferrer" onClick={stop} title="WhatsApp do cliente"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-green-50 text-green-700 text-[10px] font-bold hover:bg-green-100">
            <i className="ri-whatsapp-line" /> Zap
          </a>
        </div>
      ) : null}

      {/* Valor + taxa + entregador */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-100">
        <div>
          <span className="text-sm font-black text-zinc-800">{fmtMoeda(o.total)}</span>
          {o.taxa > 0 && <span className="text-[10px] text-zinc-400 ml-1">taxa {fmtMoeda(o.taxa)}</span>}
        </div>
        {o.driver_id ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 truncate max-w-[120px]" title="Entregador responsável">
            <i className="ri-e-bike-2-line text-zinc-400" /> {o.driver_nome || 'entregador'}
          </span>
        ) : !entregue ? (
          <span className="text-[10px] text-zinc-400">sem entregador</span>
        ) : null}
      </div>

      {/* Timeline curta das fases (com tooltip) */}
      {(tl.a_caminho_loja || tl.coletou || tl.entregou) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-zinc-400">
          {tl.a_caminho_loja && <span title="A caminho da loja"><i className="ri-store-2-line" /> {horaCurta(tl.a_caminho_loja)}</span>}
          {tl.coletou && <span title="Coletou na loja"><i className="ri-shopping-bag-3-line" /> {horaCurta(tl.coletou)}</span>}
          {tl.entregou && <span title="Entregue"><i className="ri-checkbox-circle-line" /> {horaCurta(tl.entregou)}</span>}
        </div>
      )}

      {/* Problemas (resumo) */}
      {probs.length > 0 && (
        <div className="space-y-0.5">
          {probs.map((p, i) => (
            <div key={i} className="flex items-start gap-1 text-[10px] text-red-600 leading-snug">
              <i className="ri-alert-line shrink-0 mt-0.5" />
              <span>
                {p.at ? <span className="font-bold tabular-nums">{horaCurta(p.at)} · </span> : null}
                {p.text || 'Problema relatado'}
                {'autor' in p && p.autor ? <span className="text-red-400"> ({p.autor})</span> : (p.by === 'loja' ? <span className="text-red-400"> (loja)</span> : null)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Ações */}
      {!entregue && (
        <div className="flex items-center gap-1.5 pt-1">
          {prox ? (
            <button type="button" disabled={algumBusy} onClick={(e) => { stop(e); onAvancar(o.id, prox.signal); }}
              className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-amber-500 text-white text-[11px] font-bold hover:bg-amber-600 disabled:opacity-50">
              <i className={(busy === `${o.id}:${prox.signal}` ? 'ri-loader-4-line animate-spin' : prox.icon)} /> {prox.label}
            </button>
          ) : (
            <span className="flex-1 text-center text-[10px] text-zinc-400 py-2">Aguardando a cozinha finalizar</span>
          )}
          {!problemaAtivo && (
            <button type="button" disabled={algumBusy} onClick={(e) => { stop(e); onProblema(o.id); }} title="Marcar problema na entrega"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50">
              <i className="ri-alert-line text-sm" />
            </button>
          )}
          {o.driver_id && (
            <button type="button" disabled={algumBusy} onClick={(e) => { stop(e); onLiberar(o.id); }} title="Liberar entregador"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-50">
              <i className={(busy === `${o.id}:liberar` ? 'ri-loader-4-line animate-spin' : 'ri-user-unfollow-line') + ' text-sm'} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
