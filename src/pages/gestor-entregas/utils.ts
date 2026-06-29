import type { EntregaPedido } from './hooks/useGestorEntregas';

export const fmtMoeda = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// Telefone só-dígitos → (DD) 9XXXX-XXXX. '' se vazio.
export const fmtTelefone = (d: string) => {
  if (!d) return '';
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
};
// Número internacional p/ WhatsApp (assume Brasil: prefixa 55 se vier sem DDI).
export const waNumero = (d: string) => (d.length <= 11 ? '55' + d : d);

export const horaCurta = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export type ColunaId = 'preparo' | 'pronto' | 'a_caminho' | 'coletado' | 'entregue';

export interface ColunaDef {
  id: ColunaId;
  label: string;
  icon: string;
  /** classes Tailwind do cabeçalho da coluna */
  head: string;
  dot: string;
}

export const COLUNAS: ColunaDef[] = [
  { id: 'preparo',   label: 'Em preparo',                  icon: 'ri-fire-line',            head: 'bg-amber-50 text-amber-700 border-amber-200',    dot: 'bg-amber-400' },
  { id: 'pronto',    label: 'Pronto · aguardando motoboy', icon: 'ri-takeaway-line',        head: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-400' },
  { id: 'a_caminho', label: 'Motoboy a caminho',           icon: 'ri-store-2-line',         head: 'bg-sky-50 text-sky-700 border-sky-200',          dot: 'bg-sky-400' },
  { id: 'coletado',  label: 'Coletado · em rota',          icon: 'ri-e-bike-2-line',        head: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-400' },
  { id: 'entregue',  label: 'Entregue',                    icon: 'ri-checkbox-circle-line', head: 'bg-zinc-100 text-zinc-600 border-zinc-200',      dot: 'bg-zinc-400' },
];

/** Em qual coluna do kanban o pedido cai (status da cozinha + fase do motoboy). */
export function colunaDe(o: EntregaPedido): ColunaId {
  if (o.status === 'delivered' || o.motoboy_status === 'entregou') return 'entregue';
  if (o.motoboy_status === 'coletou') return 'coletado';
  // "problema" volta o fluxo p/ "a caminho" quando liberado → fica nessa coluna, destacado.
  if (o.motoboy_status === 'a_caminho_loja' || o.motoboy_status === 'problema') return 'a_caminho';
  if (o.status === 'ready') return 'pronto';
  return 'preparo';
}

/** Próxima fase de entrega que o gestor pode acionar (override `set_motoboy_status`). */
export function proximaFase(o: EntregaPedido): { signal: string; label: string; icon: string } | null {
  if (o.status === 'delivered' || o.motoboy_status === 'entregou') return null;
  if (o.motoboy_status === 'coletou') return { signal: 'entregou', label: 'Marcar entregue', icon: 'ri-checkbox-circle-line' };
  if (o.motoboy_status === 'a_caminho_loja' || o.motoboy_status === 'problema') return { signal: 'coletou', label: 'Coletou na loja', icon: 'ri-shopping-bag-3-line' };
  if (o.status === 'ready') return { signal: 'a_caminho_loja', label: 'Motoboy a caminho', icon: 'ri-store-2-line' };
  return null; // em preparo: cozinha ainda — sem ação de motoboy
}

export const QUASE_ATRASO_MIN = 10;

export interface PrazoInfo { texto: string; tom: 'verde' | 'ambar' | 'vermelho'; atrasado: boolean }

/** Chip de prazo (created_at + SLA). Null se entregue ou sem SLA. */
export function prazoInfo(o: EntregaPedido, now: number): PrazoInfo | null {
  if (o.status === 'delivered' || o.motoboy_status === 'entregou') return null;
  if (!o.delivery_sla_min) return null;
  const prazo = new Date(o.created_at).getTime() + o.delivery_sla_min * 60000;
  const restMin = Math.round((prazo - now) / 60000);
  if (restMin < 0) return { texto: `atrasado ${-restMin} min`, tom: 'vermelho', atrasado: true };
  if (restMin <= QUASE_ATRASO_MIN) return { texto: `faltam ${restMin} min`, tom: 'ambar', atrasado: false };
  return { texto: `faltam ${restMin} min`, tom: 'verde', atrasado: false };
}
