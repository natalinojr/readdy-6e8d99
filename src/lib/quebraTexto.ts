/**
 * quebraTexto.ts — quebra de linha legível para nomes cadastrados sem espaço.
 *
 * Nomes de opção como "Barbacoa,arroz,feijao,alface,tomate" são uma "palavra" só
 * para o navegador: ou estouram a caixa, ou quebram no meio ("alfa/ce"). O espaço
 * de largura zero depois da vírgula dá ao navegador um ponto de quebra natural —
 * sem alterar o texto copiado, buscado ou enviado ao servidor.
 */
const ESPACO_LARGURA_ZERO = '​';

export function comQuebraAposVirgula(texto: string): string {
  return texto.replace(/,(?=\S)/g, `,${ESPACO_LARGURA_ZERO}`);
}
