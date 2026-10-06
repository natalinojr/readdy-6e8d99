// Aviso antes de pagar (dono, 2026-10-06): mercadoria que não chegou, chegou diferente, valor fora do
// normal, parece já paga. Nunca bloqueia — mostra o porquê e pede o motivo; quem decide é a pessoa.
// A regra mora no banco (fn_aviso_pagar) e é a mesma na baixa (financial-write) e no Pix/boleto pelo
// Inter (assistente-app). O motivo fica registrado (fin_pagamento_avisos) para o resumo da semana.

export interface AvisoPagar { tipo: string; texto: string }

/** Código que o financial-write/assistente-app devolve quando falta o motivo. */
export const PRECISA_CONFIRMAR = 'precisa_confirmar';

/** "Antes de dar baixa: A · B" (mensagem do erro) → ["A", "B"]. */
export function avisosDaMensagem(msg: string): AvisoPagar[] {
  const corpo = msg.replace(/^Antes de (dar baixa|pagar):\s*/i, '').replace(/\s*Escreva o motivo.*$/i, '');
  return corpo.split(' · ').map((t) => t.trim()).filter(Boolean).map((texto) => ({ tipo: 'aviso', texto }));
}

const ICONE: Record<string, string> = {
  nao_chegou: 'ri-truck-line', chegou_diferente: 'ri-scales-3-line', valor_maior: 'ri-scales-3-line',
  valor_fora: 'ri-line-chart-line', pago_antes: 'ri-file-copy-2-line', no_inter: 'ri-bank-line',
};

export default function AvisoAntesDePagar({ avisos, motivo, onMotivo, compacto }: {
  avisos: AvisoPagar[]; motivo: string; onMotivo: (m: string) => void; compacto?: boolean;
}) {
  if (!avisos.length) return null;
  return (
    <div className={`rounded-xl border border-amber-200 bg-amber-50 ${compacto ? 'p-2' : 'p-3'} space-y-2`}>
      <p className={`font-bold text-amber-900 ${compacto ? 'text-[11px]' : 'text-xs'}`}>
        <i className="ri-error-warning-line" /> Antes de pagar, confira:
      </p>
      <ul className="space-y-1">
        {avisos.map((a, i) => (
          <li key={i} className={`flex gap-1.5 text-amber-900 leading-snug ${compacto ? 'text-[11px]' : 'text-xs'}`}>
            <i className={`${ICONE[a.tipo] ?? 'ri-information-line'} mt-0.5`} /><span>{a.texto}</span>
          </li>
        ))}
      </ul>
      <label className={`block text-amber-900 ${compacto ? 'text-[10px]' : 'text-[11px]'} font-semibold`}>
        Para pagar mesmo assim, diga o motivo (fica registrado):
        <input value={motivo} onChange={(e) => onMotivo(e.target.value)} maxLength={300}
          placeholder="Ex.: fornecedor exige antes; já combinei o desconto"
          className="mt-1 w-full h-9 px-2.5 rounded-lg border border-amber-200 bg-white text-xs font-normal text-zinc-800 focus:outline-none focus:border-amber-400" />
      </label>
    </div>
  );
}
