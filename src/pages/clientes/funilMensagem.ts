// Mensagem do botão "Chamar" do Funil de CRM: troca os marcadores da regra pelos
// dados reais e, quando não há cupom/link (Chamar sem voucher), tira SÓ as frases
// que citam esses marcadores.
//
// Bug corrigido em 2026-10-04: as frases terminam em emoji ("… não finalizou 😅")
// e a divisão só acontecia depois de . ! ?, então a "frase" do cupom engolia o texto
// inteiro e sobrava só "Oi, Maria!". Agora divide também depois de emoji e de "…".

/** Complemento por estágio, usado quando a mensagem perdeu a frase do cupom e
 *  ficou só a saudação (ou terminou em reticências). Nada de cupom aqui. */
export const COMPLEMENTO_SEM_CUPOM: Record<string, string> = {
  carrinho_abandonado: 'Ficou alguma dúvida? Posso te ajudar a fechar o pedido.',
  nunca_comprou: 'Que tal hoje? 😊',
  primeira_compra: 'O que achou do pedido?',
  recorrente: 'Posso te ajudar com alguma coisa?',
  fiel: 'Posso te ajudar com alguma coisa?',
  vip: 'Posso te ajudar com alguma coisa?',
  em_risco: 'Bora matar a saudade?',
  perdido: 'Bora voltar? 😊',
};
const COMPLEMENTO_PADRAO = 'Posso te ajudar com alguma coisa?';

/** Mensagem usada quando a regra do estágio está sem texto. */
export const MODELO_PADRAO_MENSAGEM = 'Oi, {nome}! Tudo bem? Aqui é da {loja} 😊';

export interface DadosMensagem {
  nome: string;
  loja: string;
  cupom?: string;
  link?: string;
  /** Estágio do funil: escolhe o complemento quando a frase do cupom sai. */
  estagio?: string;
}

/** Divide em frases: depois de . ! ? … e de emoji (com seletor de variação/tom de pele). */
export function dividirFrases(texto: string): string[] {
  return texto.split(/(?<=[.!?…]|\p{Extended_Pictographic}[\p{Emoji_Modifier}️]*)\s+/u).filter((f) => f.length > 0);
}

/** Tira as frases que citam o marcador. Se TODAS citam, tira só o marcador. */
export function semFraseCom(texto: string, marcador: string): string {
  return tirarFrases(texto, marcador).texto;
}

function tirarFrases(texto: string, marcador: string): { texto: string; removidas: number } {
  if (!texto.includes(marcador)) return { texto, removidas: 0 };
  const frases = dividirFrases(texto);
  const restantes = frases.filter((f) => !f.includes(marcador));
  if (restantes.length === 0) return { texto: texto.split(marcador).join(''), removidas: 0 };
  return { texto: restantes.join(' '), removidas: frases.length - restantes.length };
}

/** Troca os marcadores da mensagem da regra pelos dados reais. */
export function montarMensagem(modelo: string, dados: DadosMensagem): string {
  const primeiroNome = dados.nome.split(' ')[0];
  // Sem cupom/link (ex.: "Chamar" sem voucher), a frase que os cita sai inteira —
  // senão a mensagem termina em "Seu cupom:" vazio.
  let texto = modelo;
  let removidas = 0;
  if (!dados.cupom) {
    const r = tirarFrases(texto, '{cupom}');
    texto = r.texto; removidas += r.removidas;
  }
  if (!dados.link) {
    const r = tirarFrases(texto, '{link}');
    texto = r.texto; removidas += r.removidas;
  }

  // Perdeu a frase do convite (a do cupom): põe um fecho do estágio no lugar,
  // para a mensagem terminar com uma pergunta e não ficar solta.
  if (removidas > 0) {
    texto = texto.trim() + ' ' + (COMPLEMENTO_SEM_CUPOM[dados.estagio ?? ''] ?? COMPLEMENTO_PADRAO);
  }

  return texto
    .replace(/\{nome\}/g, primeiroNome)
    .replace(/\{loja\}/g, dados.loja)
    .replace(/\{cupom\}/g, dados.cupom ?? '')
    .replace(/\{link\}/g, dados.link ?? '')
    // Sem cupom os marcadores somem e podem deixar sobras de pontuação.
    .replace(/\s*:\s*—\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
