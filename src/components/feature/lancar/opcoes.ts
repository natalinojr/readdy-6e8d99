// "O que aconteceu?" (2026-10-03): um começo só para qualquer lançamento de despesa ou compra.
// Não tem formulário próprio — cada resposta leva à tela que JÁ existe (Recebimentos, Contas a Pagar,
// Compras, Conciliação, Sangria do PDV, pedidos de pagamento…). Protótipo aprovado pelo dono:
// docs/prototipos/lancar-proposta.html.
//
// Regras:
// - Ordem fixa das respostas para todos os perfis (dono: decorar o lugar).
// - Só aparece o que o perfil pode fazer: a MESMA regra da tela de destino (rotaLiberada/acaoLiberada,
//   que espelham RotaProtegida, abas do Financeiro e chaves pag_*). O servidor continua conferindo.
// - Variantes: a mesma resposta leva quem pode lançar à tela de lançar e quem não pode ao pedido de
//   pagamento (o dono aprova). Vale a 1ª variante liberada.
// - Pergunta com um caminho só no perfil: não pergunta, vai direto.
import { rotaLiberada, acaoLiberada, type ContextoAcesso } from '../assistente/acoes/acesso';
import { rotaForcada } from '@/lib/acessoRota';
import type { PermissaoKey } from '@/hooks/usePermissoes';

/** Para onde a resposta leva: uma rota que já existe, ou a ação rápida "Lançar despesa" (passo a passo do ⚡). */
export type Destino = { rota: string } | { acao: 'lancar-despesa' };

export interface Variante {
  pode: (c: ContextoAcesso) => boolean;
  destino: Destino;
  /** Onde fica a tela de destino (aparece no cartão, para quem conhece o caminho antigo). */
  onde: string;
  /** Vira pedido de pagamento para o dono aprovar (selo azul). */
  aprova?: boolean;
  /** Troca a explicação do cartão quando esta variante vale. */
  sub?: string;
}

export interface Opcao {
  id: string;
  icone: string;
  titulo: string;
  sub: string;
  /** Pergunta seguinte (quando tem filhos). */
  pergunta?: string;
  perguntaSub?: string;
  filhos?: Opcao[];
  vars?: Variante[];
}

// ── Quem pode (mesmas regras das telas) ─────────────────────────────────────────
// Empresa sem PDV (tenants.kind = 'financeiro'): o /modulos esconde Recebimentos e Caixa até do Admin (tela vazia).
const temPdv = (c: ContextoAcesso) => c.temPdv !== false;
const receber = (c: ContextoAcesso) => temPdv(c) && rotaLiberada('/receber', c) && (c.pode('estoque_receber') || c.pode('estoque_movimentar'));
const pedido = (k: PermissaoKey) => (c: ContextoAcesso) => temPdv(c) && rotaLiberada('/receber', c) && c.pode(k);
const aba = (a: string) => (c: ContextoAcesso) => rotaLiberada(`/financeiro?tab=${a}`, c);
// A Contabilidade entra no Financeiro só para conferir e mandar guia/folha (financial-write recusa o resto).
const guias = (c: ContextoAcesso) => aba('guias')(c) || (c.perfil === 'contabilidade' && c.pode('fin_guias'));
// O botão Sangria do PDV só confere pdv_sangria; papel preso (Financeiro, Tarefas…) não abre o PDV.
const sangria = (c: ContextoAcesso) => temPdv(c) && !!c.perfil && !rotaForcada(c.perfil, '/pdv/caixa') && c.pode('pdv_sangria');
const despesa = (c: ContextoAcesso) => acaoLiberada('lancar-despesa', c);

const AP = 'o Administrador aprova';
const r = (rota: string): Destino => ({ rota });

export const OPCOES: Opcao[] = [
  {
    id: 'paguei', icone: 'ri-hand-coin-line', titulo: 'Paguei algo', sub: 'O dinheiro já saiu: Pix, dinheiro ou cartão',
    pergunta: 'O que você pagou?', perguntaSub: 'Do jeito que vier à cabeça. O resto eu pergunto depois.',
    filhos: [
      {
        id: 'paguei-mercadoria', icone: 'ri-shopping-basket-2-line', titulo: 'Mercadoria', sub: 'Insumo, bebida, embalagem. Com cupom, nota ou sem nada.',
        // O passo "Pagamento" do Recebimentos pergunta como foi pago (dinheiro do caixa vira sangria prevista).
        vars: [
          { pode: receber, destino: r('/receber'), onde: 'Recebimentos › Chegou mercadoria' },
          { pode: aba('compras'), destino: r('/financeiro?tab=compras&abrir=nova'), onde: 'Compras › Nova compra' },
        ],
      },
      {
        id: 'paguei-despesa', icone: 'ri-tools-line', titulo: 'Uma despesa', sub: 'Conta, serviço, conserto, material de limpeza…',
        pergunta: 'Saiu de onde o dinheiro?', perguntaSub: 'Cada jeito tem o seu lugar certo.',
        filhos: [
          {
            id: 'despesa-conta', icone: 'ri-bank-card-line', titulo: 'Da conta ou do cartão da loja', sub: 'Pix, boleto, débito ou cartão',
            vars: [{ pode: despesa, destino: { acao: 'lancar-despesa' }, onde: 'Lançar despesa (passo a passo)' }],
          },
          {
            id: 'despesa-caixa', icone: 'ri-safe-2-line', titulo: 'Do caixa, em dinheiro', sub: 'Saiu da gaveta do PDV',
            vars: [{ pode: sangria, destino: r('/pdv/caixa?abrir=sangria&tipo=outro'), onde: 'Caixa (PDV) › Sangria' }],
          },
          {
            id: 'despesa-bolso', icone: 'ri-wallet-3-line', titulo: 'Do meu bolso', sub: 'Quero o dinheiro de volta',
            vars: [{ pode: pedido('pag_reembolso'), destino: r('/receber?pedido=reembolso'), onde: AP, aprova: true }],
          },
        ],
      },
      {
        id: 'paguei-freela', icone: 'ri-user-star-line', titulo: 'Freelancer ou diária', sub: 'Quem trabalhou e já recebeu',
        pergunta: 'Saiu de onde o dinheiro?',
        filhos: [
          {
            id: 'freela-caixa', icone: 'ri-safe-2-line', titulo: 'Do caixa, em dinheiro', sub: 'Um ou vários dias, cada um com o seu valor',
            vars: [{ pode: sangria, destino: r('/pdv/caixa?abrir=sangria&tipo=freelancer'), onde: 'Caixa (PDV) › Sangria › Freelancer' }],
          },
          {
            id: 'freela-pix', icone: 'ri-bank-line', titulo: 'Pix da conta da loja', sub: 'Já está no extrato',
            vars: [{ pode: aba('conciliacao'), destino: r('/financeiro?tab=conciliacao&abrir=pendentes'), onde: 'Conciliação › explicar a saída (Freelancer)' }],
          },
        ],
      },
      {
        id: 'paguei-extrato', icone: 'ri-question-line', titulo: 'Saiu do banco e ninguém lançou', sub: 'Pix ou boleto no extrato sem explicação',
        vars: [{ pode: aba('conciliacao'), destino: r('/financeiro?tab=conciliacao&abrir=pendentes'), onde: 'Conciliação › explicar a saída' }],
      },
      {
        id: 'paguei-online', icone: 'ri-shopping-cart-2-line', titulo: 'Compra pela internet', sub: 'Mercado Livre, Shopee… já paga',
        vars: [{ pode: pedido('pag_compra_online'), destino: r('/receber?pedido=compra_online'), onde: 'Pedido · Compra online (“já paguei”)', aprova: true }],
      },
    ],
  },
  {
    id: 'chegou', icone: 'ri-truck-line', titulo: 'Chegou mercadoria', sub: 'Confere o que chegou e dá entrada no estoque',
    vars: [{ pode: receber, destino: r('/receber'), onde: 'Recebimentos › Chegou mercadoria' }],
  },
  {
    id: 'nota', icone: 'ri-file-text-line', titulo: 'Recebi uma nota ou boleto', sub: 'Ainda não está pago: foto, PDF, e-mail ou código',
    pergunta: 'O que chegou?',
    filhos: [
      {
        // Conta que ainda vai ser paga: a Nova conta pede fornecedor, vencimento e competência (DRE).
        id: 'nota-boleto', icone: 'ri-barcode-line', titulo: 'Boleto ou conta', sub: 'Luz, aluguel, internet, fornecedor',
        vars: [
          { pode: aba('pagar'), destino: r('/financeiro?tab=pagar&abrir=nova'), onde: 'Contas a Pagar › Nova conta' },
          { pode: pedido('pag_fornecedor'), destino: r('/receber?pedido=fornecedor'), onde: AP, aprova: true, sub: 'Vira pedido de pagamento; o financeiro paga depois de aprovado' },
        ],
      },
      {
        id: 'nota-email', icone: 'ri-mail-download-line', titulo: 'Boletos que chegaram por e-mail', sub: 'A caixa de boletos lidos do e-mail',
        vars: [{ pode: aba('pagar'), destino: r('/financeiro?tab=pagar&abrir=email'), onde: 'Contas a Pagar › E-mail' }],
      },
      {
        id: 'nota-nfe', icone: 'ri-file-list-3-line', titulo: 'Nota fiscal de mercadoria', sub: 'A DANFE do fornecedor',
        vars: [
          { pode: aba('notas-entrada'), destino: r('/financeiro?tab=notas-entrada'), onde: 'Notas de Entrada (já vem da SEFAZ)' },
          { pode: receber, destino: r('/receber'), onde: 'Recebimentos › ler o código da nota', sub: 'Lê o código de barras quando a mercadoria chegar' },
        ],
      },
      {
        id: 'nota-cupom', icone: 'ri-receipt-line', titulo: 'Cupom de mercado', sub: 'NFC-e: QR Code ou foto da notinha',
        vars: [
          { pode: receber, destino: r('/receber?receber=cupom'), onde: 'Recebimentos › Ler nota ou cupom' },
          { pode: aba('compras'), destino: r('/financeiro?tab=compras&abrir=nova'), onde: 'Compras › Nova compra' },
        ],
      },
      {
        id: 'nota-guia', icone: 'ri-government-line', titulo: 'Guia de imposto', sub: 'DAS, DARF ou FGTS em PDF',
        vars: [{ pode: guias, destino: r('/financeiro?tab=guias'), onde: 'Guias e impostos' }],
      },
      {
        id: 'nota-vale', icone: 'ri-restaurant-line', titulo: 'Boleto do vale (VR/VA)', sub: 'Divide por funcionário',
        vars: [{ pode: pedido('pag_beneficio'), destino: r('/receber?pedido=beneficio'), onde: 'Pedido · Benefício', aprova: true }],
      },
    ],
  },
  {
    id: 'pagar', icone: 'ri-calendar-todo-line', titulo: 'Tenho que pagar alguém', sub: 'Vira conta com data, ou pedido para o Administrador aprovar',
    pergunta: 'Quem você tem que pagar?',
    filhos: [
      {
        id: 'pagar-fornecedor', icone: 'ri-store-2-line', titulo: 'Fornecedor ou serviço', sub: 'Com boleto, Pix ou nota',
        vars: [
          { pode: aba('pagar'), destino: r('/financeiro?tab=pagar&abrir=nova'), onde: 'Contas a Pagar › Nova conta' },
          { pode: pedido('pag_fornecedor'), destino: r('/receber?pedido=fornecedor'), onde: AP, aprova: true },
        ],
      },
      {
        // O pedido é o caminho que termina no pagamento (aprovado → conta + diárias); quem não pede
        // (papel Financeiro) cai nos Freelancers do RH — pela aba rh, que abre com fin_rh OU fin_freelancers.
        id: 'pagar-freela', icone: 'ri-user-star-line', titulo: 'Freelancer ou diária', sub: 'Dias trabalhados que ainda não foram pagos',
        vars: [
          { pode: pedido('pag_freelancer'), destino: r('/receber?pedido=freelancer'), onde: AP, aprova: true },
          { pode: (c) => aba('freelancers')(c) || aba('rh')(c), destino: r('/financeiro?tab=rh&sub=freelancers'), onde: 'RH › Freelancers' },
        ],
      },
      {
        id: 'pagar-mei', icone: 'ri-briefcase-4-line', titulo: 'Prestador MEI', sub: 'Pagamento mensal do prestador',
        vars: [{ pode: aba('rh'), destino: r('/financeiro?tab=rh&sub=prestadores'), onde: 'RH › Prestadores MEI' }],
      },
      {
        id: 'pagar-entregadores', icone: 'ri-e-bike-2-line', titulo: 'Entregadores', sub: 'Acerto dos motoboys do período',
        vars: [{ pode: aba('entregadores'), destino: r('/financeiro?tab=entregadores'), onde: 'Entregadores' }],
      },
      {
        id: 'pagar-imposto', icone: 'ri-government-line', titulo: 'Imposto', sub: 'DAS, DARF ou FGTS',
        vars: [{ pode: guias, destino: r('/financeiro?tab=guias'), onde: 'Guias e impostos' }],
      },
      {
        id: 'pagar-online', icone: 'ri-shopping-cart-2-line', titulo: 'Quero comprar algo pela internet', sub: 'Mando o link, o Administrador aprova e paga',
        vars: [{ pode: pedido('pag_compra_online'), destino: r('/receber?pedido=compra_online'), onde: AP, aprova: true }],
      },
    ],
  },
  {
    id: 'bolso', icone: 'ri-wallet-3-line', titulo: 'Gastei do meu bolso', sub: 'Pede o reembolso, com a foto do comprovante',
    vars: [{ pode: pedido('pag_reembolso'), destino: r('/receber?pedido=reembolso'), onde: 'Pedir reembolso', aprova: true }],
  },
];

/** A variante que vale para o perfil (a 1ª liberada), ou null. */
export function variante(o: Opcao, c: ContextoAcesso): Variante | null {
  return o.vars?.find((v) => v.pode(c)) ?? null;
}

export function visivel(o: Opcao, c: ContextoAcesso): boolean {
  return o.filhos ? o.filhos.some((f) => visivel(f, c)) : !!variante(o, c);
}

export function filhosVisiveis(lista: Opcao[] | undefined, c: ContextoAcesso): Opcao[] {
  return (lista ?? []).filter((o) => visivel(o, c));
}

/**
 * Ao escolher uma opção: se ela tem filhos e só um caminho liberado no perfil (seguindo a cadeia),
 * devolve esse caminho para ir direto, sem perguntar.
 */
export function caminhoUnico(o: Opcao, c: ContextoAcesso): Opcao | null {
  if (!o.filhos) return o;
  const fs = filhosVisiveis(o.filhos, c);
  return fs.length === 1 ? caminhoUnico(fs[0], c) : null;
}

/** Tem ao menos uma resposta para o perfil? (menu ⚡ e tela /lancar) */
export function temAlgumLancamento(c: ContextoAcesso): boolean {
  return OPCOES.some((o) => visivel(o, c));
}
