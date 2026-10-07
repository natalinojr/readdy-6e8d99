// Em que pé está a conta (2026-10-07): de onde veio · mercadoria · boleto · pagamento, em selos curtos.
// Usada nos cartões da tela Hoje e nas listas de contas que abrem dentro deles. Regras: src/lib/situacaoConta.ts.
import type { SituacaoConta, Tom } from '@/lib/situacaoConta';

const COR: Record<Tom, string> = {
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  atencao: 'bg-amber-50 text-amber-800 border-amber-100',
  ruim: 'bg-red-50 text-red-700 border-red-100',
  neutro: 'bg-zinc-50 text-zinc-600 border-zinc-200',
};

export default function LinhaSituacao({ s, comNome = false }: { s: SituacaoConta; comNome?: boolean }) {
  return (
    <div className="mt-1.5">
      {comNome && (
        <p className="text-[12px] font-semibold text-zinc-700 leading-snug break-words">
          {s.fornecedor} · <span className="tabular-nums">{s.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
        </p>
      )}
      <ul className="flex flex-wrap gap-1 mt-1" aria-label="Situação da conta">
        {s.etapas.map((e) => (
          <li key={e.id} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[11px] font-semibold leading-tight ${COR[e.tom]}`}>
            <i className={`${e.icone} text-[12px]`} aria-hidden /> {e.texto}
          </li>
        ))}
      </ul>
    </div>
  );
}
