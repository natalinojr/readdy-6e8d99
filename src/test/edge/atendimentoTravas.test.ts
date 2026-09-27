// @vitest-environment node
// atendimento-loja/travas.ts — as travas do atendente de WhatsApp da loja. Cada caso veio de uma conversa
// real das simulações (2026-09-27) em que a trava falhou ou disparou à toa; o comentário diz qual.
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import por caminho montado em tempo de execução: o tsc do app não passa a checar código Deno.
const TRAVAS_PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/atendimento-loja/travas.ts')).href;
// deno-lint-ignore no-explicit-any
type Any = any;
let T: Any;
beforeAll(async () => { T = await import(/* @vite-ignore */ TRAVAS_PATH); });

const GERAL = 'https://erpos.vercel.app/loja-delivery?utm_source=whatsapp_bot';
const urlDoItem = (id: string) => `${GERAL}&item=${id}`;

// Cardápio mínimo no formato do get_delivery_config (o mesmo do link público).
const menu = (extra: Record<string, unknown> = {}) => ({
  categories: [{ id: 'c1', name: 'Combo' }, { id: 'c2', name: 'Burrito' }, { id: 'c3', name: 'Porções' }, { id: 'c4', name: 'Cervejas' }, { id: 'c5', name: 'Quesadillas' }],
  items: [
    { id: 'combo-burrito-0001', name: 'Combo Burrito  com batata frita e com bebida!', price: 44.9, category_id: 'c1' },
    { id: 'batata-frita-00001', name: 'Batata frita', price: 30, category_id: 'c3', description: '400 g de batata frita' },
    { id: 'nachos-4-quesos-01', name: 'Nachos 4 Quesos', price: 38, category_id: 'c3' },
    { id: 'batata-fria-4q-001', name: 'Batata fria com 4 queijos e bacon', price: 35, category_id: 'c3' },
    { id: 'burrito-barbacoa-1', name: 'Burrito Barbacoa', price: 41, category_id: 'c2' },
    { id: 'burrito-classic-01', name: 'Burrito Classic', price: 38, category_id: 'c2' },
    { id: 'dupla-quesadilla-1', name: 'Dupla Quesadilla Pollo', price: 34, category_id: 'c5' },
    { id: 'combo-dupla-ques-1', name: 'Combo Dupla Quesadila com batata frita e bebida!', price: 39.9, category_id: 'c1' },
    { id: 'ipa-maniacs-lata-1', name: 'IPA Maniacs Lata', price: 15, category_id: 'c4' },
  ],
  delivery_open_now: true,
  neighborhoods: [{ name: 'Centro', delivery_fee: 7 }],
  ...extra,
});

function conferir(reply: string, historico: Array<{ role: 'user' | 'assistant'; content: string }>, extra: Partial<Record<string, unknown>> = {}) {
  const m = (extra.menu as Any) ?? menu();
  return T.conferir({
    reply, items: T.menuItems(m), menu: m, historico, saidas: [], usadas: new Set((extra.usadas as string[]) ?? []),
    links: (extra.links as string[]) ?? [], equipeJaAvisada: !!extra.equipeJaAvisada,
  }) as string[];
}
const cliente = (t: string) => [{ role: 'user' as const, content: t }];

describe('atendimento-loja › travas', () => {
  it('link do próprio domínio (vercel.app) não dispara a trava de "app" (disparava em 1 de cada 3 respostas)', () => {
    expect(conferir(`Aqui está:\n${GERAL}`, cliente('manda o link'), { links: [GERAL] })).toEqual([]);
    expect(conferir('Você recebe aviso pelo app quando sair!', cliente('me avisa?')).join(' ')).toMatch(/app/);
  });

  it('preço de combo com nome abreviado não é "preço da batata"; preço de outro item continua errado (s39)', () => {
    expect(conferir('• *Combo Burrito* com batata frita e bebida — R$ 44,90', cliente('tem combo?'))).toEqual([]);
    expect(conferir('A *Dupla Quesadilla Pollo* sai por *R$ 39,90* já com batata e bebida!', cliente('quanto a quesadilla?')).join(' '))
      .toMatch(/Dupla Quesadilla Pollo/);
  });

  it('"quer comprar" pede o link; quem só reclama ("quero logo viu") não', () => {
    expect(conferir('Qual sabor você prefere?', cliente('quero um burrito barbacoa')).join(' ')).toMatch(/quer comprar/);
    expect(conferir('A equipe já foi avisada.', cliente('quero logo viu, que absurdo'), { equipeJaAvisada: true })).toEqual([]);
  });

  it('menor de idade: bloqueia álcool, mas a recusa certa não é erro (s40)', () => {
    const h = cliente('tem cerveja? tenho 16 mas é pra mim');
    expect(conferir('Temos a IPA Maniacs Lata por R$ 15,00 🍻', h).join(' ')).toMatch(/menor de idade/);
    expect(conferir('Temos a IPA Maniacs Lata, mas é só para maiores de 18 — não posso vender. Quer um refri?', h)).toEqual([]);
  });

  it('delivery fechado: sem "volta em poucos minutos" nem "o pedido fica guardado"', () => {
    const fechado = menu({ delivery_open_now: false });
    expect(conferir('Pausado por alguns minutos, já já volta!', cliente('quero pedir'), { menu: fechado }).join(' ')).toMatch(/fechado\/pausado/);
    expect(conferir('Pode fazer pelo link que o pedido fica guardado pra quando abrir.', cliente('quero pedir'), { menu: fechado }).join(' ')).toMatch(/fechado\/pausado/);
  });

  it('"serve 3 pessoas" sem isso na descrição é invenção (s37)', () => {
    expect(conferir('A batata frita deve dar pra 3 pessoas tranquilo!', cliente('serve 3?')).join(' ')).toMatch(/Quantas pessoas/);
  });
});

describe('atendimento-loja › links', () => {
  it('link geral é prefixo do link de item: não cola &item em cima de outro (s57)', () => {
    const itemLink = urlDoItem('burrito-barbacoa-1');
    const out = T.arrumarLinks({ reply: `Clica aqui:\n${itemLink}`, items: T.menuItems(menu()), historico: [{ role: 'assistant', content: itemLink }, ...cliente('manda de novo')], links: [], geral: GERAL, urlDoItem });
    expect(out.reply).toContain(itemLink);
    expect(out.reply.match(/item=/g)).toHaveLength(1);
  });

  it('link inventado vira o link certo no mesmo lugar', () => {
    const out = T.arrumarLinks({ reply: 'Pede no ifood: https://ifood.com.br/loja\nValeu!', items: T.menuItems(menu()), historico: cliente('link?'), links: [GERAL], geral: GERAL, urlDoItem });
    expect(out.reply).not.toContain('ifood.com.br');
    expect(out.reply).toContain(GERAL);
  });

  it('modelo ignorou a correção: anexa o link do item citado; esgotado recebe o geral', () => {
    const base = { items: T.menuItems(menu()), menu: menu(), saidas: [], usadas: new Set(), links: [], equipeJaAvisada: false };
    expect(T.linkQueFalta({ ...base, reply: 'Qual sabor?', historico: cliente('quero o burrito barbacoa') }, GERAL, urlDoItem)).toBe(urlDoItem('burrito-barbacoa-1'));
    const semClassic = menu({ out_of_stock_ids: ['burrito-classic-01'] });
    expect(T.linkQueFalta({ ...base, items: T.menuItems(semClassic), menu: semClassic, reply: 'Acabou 😕', historico: cliente('quero um burrito classic') }, GERAL, urlDoItem)).toBe(GERAL);
  });

  it('acharItem: "Nachos com 4 Queijos" não cai na batata (s19); erro de digitação acha o item', () => {
    const items = T.menuItems(menu());
    expect(T.acharItem(items, 'Nachos com 4 Queijos', new Set(['nachos-4-quesos-01']))?.nome).toBe('Nachos 4 Quesos');
    expect(T.acharItem(items, 'Nachos com 4 Queijos')?.nome).not.toBe('Batata fria com 4 queijos e bacon');
    expect(T.temTermo('Dupla Quesadilla Pollo', 'quesadila')).toBe(true);
  });

  it('bastidor vazado (ferramenta, instruções, "usuário") sai da resposta; resposta normal fica igual (s36/s38)', () => {
    const vazou = 'Gerei o link sem chamar a ferramenta, o que violou as instruções. Vou responder agora à mensagem do usuário.\n\nBeleza! Qualquer coisa é só chamar 😉';
    expect(T.semBastidores(vazou)).toBe('Beleza! Qualquer coisa é só chamar 😉');
    const normal = `Boa escolha! 🌯\n\n${GERAL}&item=x\n\nQuer uma Coca (R$ 8,00)?`;
    expect(T.semBastidores(normal)).toBe(normal);
  });

  it('idioma: "por favor" não é espanhol (s31)', () => {
    expect(T.idiomaDe(['manda o cardapio em foto por favor'])).toBeNull();
    expect(T.idiomaDe(['Hola! ¿Tienen tacos? ¿Cuánto cuestan?'])).toBe('es');
    expect(T.idiomaDe(['Hi! Do you deliver to the hotel? What do you recommend?'])).toBe('en');
  });
});
