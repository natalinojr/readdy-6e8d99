// Cores e regras aprovadas do visual do ERPOS (protótipos em docs/prototipos/). Só constantes: o Tailwind
// continua sendo o jeito normal de pintar (bg-amber-500, border-zinc-200...); estes valores existem para
// quem precisa do hexadecimal (gráficos, PDF, e-mail, style inline) e como referência única.
//
// REGRAS DE USO
//  - Um botão principal (âmbar) por tela. O resto é contorno (btn('out')) ou texto (btn('ghost')).
//  - Letra mínima: 11px em telas de gestão; 13px em telas de venda (PDV, totem) e do cliente (delivery, mesa QR).
//  - Alvo de toque: 40px de altura no mínimo (btn md = 42px).
//  - Confirmação, aviso e pergunta usam confirmar()/avisar()/perguntar() de '@/components/kit',
//    nunca window.confirm/alert/prompt.
//  - A aba Trilha do Financeiro tem desenho próprio e fica FORA de trocas em massa de cor/componente.

export const KIT_CORES = {
  /** fundo da página */
  creme: '#FAF7F2',
  /** fundo de cartão */
  cartao: '#FFFFFF',
  /** borda de cartão e divisórias */
  borda: '#EEE6DA',

  /** texto principal */
  tinta: '#1F1A14',
  /** texto secundário */
  tintaMedia: '#5B5248',
  /** texto de apoio, rótulos, placeholders */
  tintaClara: '#9A9086',

  /** cor da marca; botão principal */
  ambar: '#F59E0B',
  /** texto sobre o âmbar */
  ambarTexto: '#1F1A14',

  /** problema, atraso, ação perigosa */
  vermelho: '#DC2626',
  /** ok, pago, entregue */
  verde: '#16A34A',
  /** informação, neutro-ativo */
  azul: '#2563EB',
  /** tudo que é da IA / assistente */
  violetaIA: '#7C3AED',
} as const;

export type CorKit = keyof typeof KIT_CORES;

/** Letra mínima em px por tipo de tela. */
export const KIT_LETRA_MINIMA = { gestao: 11, venda: 13, cliente: 13 } as const;

/** Altura mínima de alvo de toque, em px. */
export const KIT_TOQUE_MINIMO = 40;
