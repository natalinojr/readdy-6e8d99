// Peças pequenas da aba Pagamentos (2026-10-06).
import { useState, type ReactNode } from 'react';
import { pedirAoChat } from '@/lib/assistenteFoco';
import { BaixaDaConta } from '@/components/feature/assistente/PendenciasChat';

export const brl = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const ddmm = (ymd: string | null | undefined) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : '—');
export const diaBR = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—');

export const BTN = 'h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-xl text-[13px] font-bold whitespace-nowrap disabled:opacity-50 cursor-pointer transition-colors';
export const PRINCIPAL = `${BTN} bg-amber-500 hover:bg-amber-400 text-zinc-900`;
export const SECUNDARIO = `${BTN} border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50`;
export const LINK = 'h-9 px-2 inline-flex items-center text-[12px] font-semibold text-zinc-500 hover:text-zinc-800 cursor-pointer';

export type Tom = 'red' | 'amber' | 'blue' | 'green' | 'zinc';
const PILL: Record<Tom, string> = {
  red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-800', blue: 'bg-sky-50 text-sky-700',
  green: 'bg-emerald-50 text-emerald-700', zinc: 'bg-zinc-100 text-zinc-600',
};
export function Pilula({ tom, children }: { tom: Tom; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${PILL[tom]}`}>{children}</span>;
}

export function Secao({ titulo, n, tom = 'zinc', children, dica }: { titulo: string; n?: number; tom?: Tom; children: ReactNode; dica?: string }) {
  const cor = tom === 'red' ? 'text-red-600' : tom === 'amber' ? 'text-amber-700' : tom === 'green' ? 'text-emerald-700' : 'text-zinc-500';
  return (
    <section className="flex flex-col gap-2">
      <h3 className={`text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-2 ${cor}`}>
        {titulo}{n != null && <span className="px-2 rounded-full bg-zinc-100 text-zinc-600 tracking-normal">{n}</span>}
      </h3>
      {dica && <p className="text-xs text-zinc-500 -mt-1">{dica}</p>}
      {children}
    </section>
  );
}

export function Cartao({ children, destaque }: { children: ReactNode; destaque?: 'red' | 'amber' }) {
  const b = destaque === 'red' ? 'border-red-200 border-l-4 border-l-red-500' : destaque === 'amber' ? 'border-amber-200 border-l-4 border-l-amber-400' : 'border-zinc-200';
  return <div className={`bg-white rounded-2xl border ${b} px-4 py-3`}>{children}</div>;
}

export const Vazio = ({ texto }: { texto: string }) => (
  <p className="text-sm text-zinc-400 bg-white border border-dashed border-zinc-200 rounded-2xl px-4 py-5 text-center">{texto}</p>
);

/**
 * Pagar uma conta: o dono paga com PIN pelo chat (o cartão do pagamento mostra os avisos e pede o motivo);
 * o financeiro dá baixa do que já pagou por fora. Os dois passam pelo aviso antes de pagar no servidor.
 */
export function AcoesPagar({ tenantId, billId, dono, financeiro, onMudou, rotuloPagar = 'Pagar' }: {
  tenantId: string; billId: string; dono: boolean; financeiro: boolean; onMudou: () => void; rotuloPagar?: string;
}) {
  const [baixa, setBaixa] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {dono && <button onClick={() => pedirAoChat({ tipo: 'pagar_conta', billId })} className={PRINCIPAL}><i className="ri-lock-2-line" /> {rotuloPagar}</button>}
        {financeiro && (
          <button onClick={() => setBaixa((v) => !v)} className={dono ? SECUNDARIO : PRINCIPAL}>
            <i className="ri-check-double-line" /> {baixa ? 'Fechar' : 'Já paguei — dar baixa'}
          </button>
        )}
      </div>
      {baixa && <BaixaDaConta tenantId={tenantId} billId={billId} onCancelar={() => setBaixa(false)} onFeito={() => { setBaixa(false); onMudou(); }} />}
    </div>
  );
}
