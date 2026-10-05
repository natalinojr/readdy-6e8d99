// Pedido para a IA sugerir a resposta a uma avaliação do iFood (puro; testado em src/test/edge/ifoodAvisos.test.ts).
export function promptResposta(p: { nota: number; comentario: string; cliente: string; loja: string }): string {
  return [
    `Você escreve, em nome do restaurante "${p.loja || 'a loja'}", a resposta pública a uma avaliação do iFood.`,
    `Avaliação: ${p.nota} de 5 estrelas. Cliente: ${p.cliente || 'cliente'}. Comentário: "${p.comentario || '(sem comentário)'}".`,
    'Regras:',
    '- Português do Brasil, tom cordial e humano, no máximo 3 frases curtas. Chame o cliente pelo primeiro nome.',
    '- Nota baixa: agradeça, peça desculpas pelo problema citado (sem inventar detalhes) e diga que a equipe vai corrigir.',
    '- Nota alta: agradeça de forma simples e convide a voltar.',
    '- NÃO prometa brinde, desconto, reembolso, cupom ou contato fora do iFood (a loja decide isso, não você).',
    '- NÃO peça telefone, e-mail ou dados pessoais; não cite nomes de funcionários; nada ofensivo (Política de Avaliações do iFood).',
    '- Responda só com o texto da resposta, sem aspas e sem explicação.',
  ].join('\n');
}
