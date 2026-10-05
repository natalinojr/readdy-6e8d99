// KIT VISUAL ÚNICO do ERPOS. Toda tela nova importa daqui: import { btn, Folha, confirmar } from '@/components/kit'.
// Só reexporta as peças que já existem (nenhum código copiado); os arquivos de origem continuam onde estão.
//  - peças de página (botão btn, Faixa, CartaoAcao, CartaoBarra, SecaoTitulo, Chips, Vazio, Nota, Etiqueta,
//    Pagina, MenuMais, formatadores brl/brlInteiro/semAcento): src/pages/estoque/components/ui/EstoqueUi.tsx
//  - Folha (janela que sobe de baixo no celular): src/pages/estoque/components/inicio/Folha.tsx
//  - confirmar / avisar / perguntar (no lugar de window.confirm/alert/prompt): src/components/base/Dialogos.tsx
//  - cores e regras de uso: ./tokens.ts

export * from '@/pages/estoque/components/ui/EstoqueUi';
export { default as Folha } from '@/pages/estoque/components/inicio/Folha';
export { confirmar, avisar, perguntar } from '@/components/base/Dialogos';
export * from './tokens';
