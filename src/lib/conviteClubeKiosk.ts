// Convite do clube na etapa "CPF na nota" do totem (autoatendimento).
// Quem informa o CPF na nota e ainda não é do clube recebe um convite curto antes de pagar.
// A consulta "esse CPF já é membro?" NUNCA pode segurar o pedido: passou do limite ou falhou,
// o totem segue direto para o pagamento. Funções puras, sem tela, para testar.
import { cpfValido } from './fidelidade';

export type ResultadoConsultaClube = 'membro' | 'nao_membro' | 'erro';

/** Tempo máximo esperando o servidor dizer se o CPF já é do clube. */
export const LIMITE_CONSULTA_CLUBE_MS = 3000;

/** Só CPF válido de 11 dígitos recebe o convite (CNPJ de empresa não entra no clube). */
export function cpfElegivelAoConvite(digitos: string): boolean {
  return digitos.length === 11 && cpfValido(digitos);
}

interface RespostaBuscaClube {
  data: { encontrado?: boolean; ativo?: boolean; error?: string; message?: string } | null;
  error: Error | null;
}

/**
 * Pergunta ao servidor (ação `clube_buscar`) se o CPF já é membro do clube.
 *  - 'membro'     → já está no clube: não se convida (os pontos vão pelo CPF da nota).
 *  - 'nao_membro' → pode receber o convite.
 *  - 'erro'       → falhou, demorou além do limite, está sem internet ou o programa foi
 *                   desligado: segue para o pagamento sem convite.
 * Nunca lança e nunca demora mais que `limiteMs`.
 */
export async function consultarMembroClube(
  buscar: () => Promise<RespostaBuscaClube>,
  opts: { online?: boolean; limiteMs?: number } = {},
): Promise<ResultadoConsultaClube> {
  if (opts.online === false) return 'erro';
  const limiteMs = opts.limiteMs ?? LIMITE_CONSULTA_CLUBE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      buscar(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), limiteMs); }),
    ]);
    if (!res || res.error || !res.data) return 'erro';
    if (res.data.error || res.data.ativo === false) return 'erro';
    return res.data.encontrado ? 'membro' : 'nao_membro';
  } catch {
    return 'erro';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
