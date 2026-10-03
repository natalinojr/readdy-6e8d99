// Travas do atendente da loja (atendimento-loja): código puro, sem imports, para rodar também fora da
// Edge (node) sobre respostas reais gravadas nas simulações — assim cada trava é testada sem gastar API.
// Criado em 2026-09-27 a partir do que estava dentro de pensar() em index.ts.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const brl = (n: unknown) => `R$ ${Number(n ?? 0).toFixed(2).replace('.', ',')}`;
export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ');
export const semPontas = (u: string) => u.replace(/[).,!?*_~]+$/, '');
const URL_RE = /https?:\/\/\S+/g;
const urlsDe = (t: string) => (t.match(URL_RE) ?? []).map(semPontas);

export interface MenuItem { id: string; nome: string; categoria: string; preco: number; promo: number | null; desc: string; disponivel: boolean; opcoes: string; aPartir: number | null; precosOpcoes: number[] }

// Dia/hora em São Paulo (a promoção e a agenda são por dia local).
export function spNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dow = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[g('weekday')] ?? 0;
  return { dow, iso: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
}
export const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// Mesma regra do front (src/lib/promoUtils › rawPromoAtivaHoje): menor preço entre as válidas hoje.
function promoHoje(promos: Row[], itemId: string, sp: ReturnType<typeof spNow>): number | null {
  const validas = promos.filter((p) => p.item_id === itemId && p.is_active !== false && (
    p.specific_date && !p.is_recurring ? String(p.specific_date).slice(0, 10) === sp.iso
      : !Array.isArray(p.days_of_week) || !p.days_of_week.length || p.days_of_week.includes(sp.dow)));
  if (!validas.length) return null;
  return Math.min(...validas.map((p) => Number(p.promotional_price)));
}

// Horário de exibição do cardápio (2026-10-02): item/categoria fora do horário somem para o bot,
// como somem do link do delivery. Mesma regra de src/lib/horarioExibicao.ts › visivelEm
// (Brasília; dias 0=Dom; fim < início = vira o dia; início = fim = dia todo; sem faixa válida = sempre).
// O bot vende delivery: faixa "só casa" não vale aqui (2026-10-03).
export function noHorario(raw: unknown, sp: ReturnType<typeof spNow>): boolean {
  const min = (t: unknown) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const faixas = (Array.isArray(raw) ? raw : [])
    .filter((f: Row) => f?.channel !== 'casa')
    .map((f: Row) => ({ ini: min(f?.start), fim: min(f?.end), dias: Array.isArray(f?.days) ? (f.days as unknown[]).map(Number) : [] }))
    .filter((f) => f.ini != null && f.fim != null);
  if (!faixas.length) return true;
  const agora = min(sp.hhmm) ?? 0;
  const ontem = (sp.dow + 6) % 7;
  return faixas.some(({ ini, fim, dias }) => {
    const vale = (d: number) => dias.length === 0 || dias.includes(d);
    if (ini === fim) return vale(sp.dow);
    if (ini! < fim!) return vale(sp.dow) && agora >= ini! && agora < fim!;
    return (vale(sp.dow) && agora >= ini!) || (vale(ontem) && agora < fim!);
  });
}

export function menuItems(menu: Row): MenuItem[] {
  const sp = spNow();
  const cats = new Map<string, string>((menu.categories ?? []).map((c: Row) => [c.id, String(c.name ?? '')]));
  const catsForaDoHorario = new Set<string>((menu.categories ?? []).filter((c: Row) => !noHorario(c.availability_schedule, sp)).map((c: Row) => String(c.id)));
  const semEstoque = new Set<string>(menu.out_of_stock_ids ?? []);
  const opsIndisp = new Set<string>(menu.opcoes_indisponiveis_ids ?? []);
  // Opcionais (sabor, tamanho, adicional): o preço de item "a partir de" vem daqui.
  const opsPorGrupo = new Map<string, Row[]>();
  for (const op of menu.options ?? []) {
    if (opsIndisp.has(String(op.id))) continue;
    const g = String(op.option_group_id ?? op.group_id);
    opsPorGrupo.set(g, [...(opsPorGrupo.get(g) ?? []), op]);
  }
  const gruposPorItem = new Map<string, Row[]>();
  for (const g of menu.option_groups ?? []) gruposPorItem.set(String(g.item_id), [...(gruposPorItem.get(String(g.item_id)) ?? []), g]);
  return (menu.items ?? []).filter((i: Row) => (cats.has(i.category_id) || !i.category_id)
    && !catsForaDoHorario.has(String(i.category_id)) && noHorario(i.availability_schedule, sp)).map((i: Row) => {
    const grupos = gruposPorItem.get(String(i.id)) ?? [];
    let minimo = 0;
    const precosOpcoes: number[] = [];
    const partes = grupos.slice(0, 3).map((g) => {
      const ops = opsPorGrupo.get(String(g.id)) ?? [];
      const obrig = g.is_required || Number(g.min_selections ?? 0) > 0;
      const valores = ops.map((o) => Number(o.additional_price ?? 0));
      precosOpcoes.push(...valores);
      if (obrig && valores.length) minimo += Math.min(...valores);
      return `${g.name}${obrig ? '' : ' (opcional)'}: ${ops.slice(0, 7).map((o) => `${o.name}${Number(o.additional_price) > 0 ? ` +${brl(o.additional_price)}` : ''}`).join(', ')}${ops.length > 7 ? '…' : ''}`;
    });
    const preco = Number(i.price ?? 0);
    return {
      id: String(i.id), nome: String(i.name ?? ''), categoria: cats.get(i.category_id) ?? 'Outros',
      preco, promo: promoHoje(menu.promotions ?? [], String(i.id), sp),
      desc: String(i.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 160), disponivel: !semEstoque.has(String(i.id)),
      opcoes: partes.join(' | '), aPartir: minimo > 0 ? preco + minimo : null, precosOpcoes,
    };
  });
}
export const precoTxt = (i: MenuItem) => i.aPartir != null ? `a partir de ${brl(i.aPartir)} (o valor depende das escolhas)`
  : i.promo != null && i.promo < i.preco ? `~${brl(i.preco)}~ *${brl(i.promo)} hoje*` : brl(i.preco);

// Palavra parecida (erro de digitação): "quesadila" ~ "quesadilla", "franbo" ~ "frango" (s39, v6).
export function quase(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}
export const temTermo = (texto: string, t: string) => {
  const n = norm(texto);
  return n.includes(t) || n.replace(/[^a-z0-9 ]/g, ' ').split(' ').some((w) => quase(w, t));
};

// Item pelo id (prefixo) ou pelo nome. Por palavras inteiras: "combo burrito" não pode cair em "Combo
// Burritos e Quesadilla" (caso da simulação s25, 2026-09-27). Empate: o que tem menos palavras sobrando.
// "com", "de", "e"… não contam: "Nachos com 4 Queijos" caía em "Batata fria com 4 queijos" (s19, v5).
const LIGACAO = new Set(['com', 'de', 'do', 'da', 'dos', 'das', 'e', 'no', 'na', 'sem', 'um', 'uma', 'pra', 'para', 'o', 'a']);
const palavrasDe = (x: string) => norm(x).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length >= 2 && !LIGACAO.has(w));
export function acharItem(items: MenuItem[], q: string, vistos: Set<string> = new Set()): MenuItem | null {
  const t = norm(q).replace(/[\[\]]/g, '').replace(/^id\s+/, '').trim();
  if (!t) return null;
  const porId = items.find((i) => i.id.toLowerCase().startsWith(t) && t.length >= 6);
  if (porId) return porId;
  const alvo = palavrasDe(t);
  const exato = items.find((i) => palavrasDe(i.nome).join(' ') === alvo.join(' '));
  if (exato) return exato;
  let melhor: MenuItem | null = null, nota = -1;
  for (const i of items) {
    const ws = palavrasDe(i.nome);
    const inteiras = alvo.filter((w) => ws.some((x) => x === w || quase(x, w))).length;
    // Item que a busca acabou de mostrar: basta uma palavra ("Nachos com 4 Queijos" → "Nachos 4 Quesos").
    if (inteiras < Math.ceil(alvo.length * 0.6) && !(vistos.has(i.id) && inteiras >= 1)) continue;
    // Item que a busca acabou de mostrar ganha (é dele que a conversa está falando).
    const n = inteiras * 10 - ws.filter((w) => !alvo.includes(w)).length + (i.disponivel ? 1 : 0) + (vistos.has(i.id) ? 5 : 0);
    if (n > nota) { nota = n; melhor = i; }
  }
  return melhor;
}

// Menor de idade e bebida alcoólica (s40, x11: vendeu cerveja para quem disse ter 16 anos).
const MENOR_RE = /\b(tenho|to com|tô com|sou de)\s*1[0-7]\b|\b1[0-7]\s*anos|sou menor|menor de idade|de menor\b/i;
export const alcoolico = (i: MenuItem) => /cerveja|chope|chopp|drink|caipirinha|vinho|dose|whisky|vodka|gin\b|tequila|margarita|mojito/i.test(`${i.categoria} ${i.nome}`)
  && !/sem [aá]lcool|zero [aá]lcool|n[aã]o alco/i.test(`${i.nome} ${i.desc}`);
export const clienteMenor = (h: Array<{ role: string; content: string }>) => h.some((x) => x.role === 'user' && MENOR_RE.test(x.content));

// Item que o cliente citou numa frase ("manda o do burrito barbacoa"): todas as palavras do nome (com erro de
// digitação) ou 2/3 delas em nomes de 3+ palavras ("duo mex"). Vence o que casa mais palavras.
export function itemCitado(items: MenuItem[], texto: string): MenuItem | null {
  const ws = palavrasDe(texto);
  let melhor: MenuItem | null = null, nota = 0;
  for (const i of items) {
    const nome = palavrasDe(i.nome);
    if (!nome.length) continue;
    const bate = nome.filter((w) => ws.some((x) => x === w || quase(x, w))).length;
    const precisa = nome.length >= 3 ? Math.ceil(nome.length * 2 / 3) : nome.length;
    if (bate < precisa || bate < 2 && nome.length > 1) continue;
    const n = bate * 10 - (nome.length - bate);
    if (n > nota) { nota = n; melhor = i; }
  }
  return melhor;
}

// Idioma pelo que o cliente escreveu (o Haiku tende a responder em português mesmo pedindo o contrário).
export function idiomaDe(textos: string[]): 'en' | 'es' | null {
  const t = ` ${norm(textos.slice(-3).join(' ')).replace(/[^a-z\s]/g, ' ')} `;
  const conta = (ws: string[]) => ws.reduce((n, w) => n + (t.includes(` ${w} `) ? 1 : 0), 0);
  const pt = conta(['voce', 'vc', 'quero', 'tem', 'qual', 'obrigado', 'oi', 'quanto', 'pra', 'nao', 'ta', 'entrega', 'meu', 'um', 'uma', 'de']);
  // Só palavras que NÃO existem no português ("por favor", "do", "to" levavam para espanhol/inglês — s31, v5).
  const en = conta(['the', 'you', 'what', 'is', 'how', 'can', 'thanks', 'hi', 'hello', 'please', 'want', 'much', 'deliver', 'my', 'it', 'your', 'have', 'there']);
  const es = conta(['hola', 'tienen', 'cuanto', 'cuesta', 'gracias', 'quiero', 'usted', 'puedo', 'cuestan', 'donde', 'tienes', 'cuales', 'hay', 'senor', 'bueno', 'buenas', 'necesito', 'pedir']);
  if (en >= 2 && en > pt) return 'en';
  if (es >= 2 && es > pt) return 'es';
  return null;
}

export interface Conferir {
  reply: string;
  items: MenuItem[];
  menu: Row;
  historico: Array<{ role: 'user' | 'assistant'; content: string }>;
  saidas: string[];      // saída das ferramentas deste turno
  usadas: Set<string>;   // ferramentas chamadas neste turno
  links: string[];       // links que link_do_pedido devolveu neste turno
  equipeJaAvisada: boolean;
}

// Pedido de link é verbo + link ("vou pedir lá no link" não é — s30, v7).
export const pediuLinkEm = (t: string) =>
  /(manda|mande|passa|envia|reenvia|me d[aá]|qual [eé]|cad[eê]|quero|de novo)[^.!?\n]{0,20}(link|card[aá]pio|menu)|(link|card[aá]pio|menu)[^.!?\n]{0,12}(por favor|pf|pfv|\?)/i.test(t);
const ultimaDoCliente = (h: Conferir['historico']) => [...h].reverse().find((x) => x.role === 'user')?.content ?? '';

// O que o cliente quer na última mensagem (usado pelas travas e para anexar o link que faltou).
function intencao(c: Pick<Conferir, 'items' | 'historico' | 'usadas' | 'equipeJaAvisada'>) {
  const ultima = ultimaDoCliente(c.historico);
  const linksAntes = new Set(c.historico.flatMap((h) => urlsDe(h.content)));
  const pediuLink = pediuLinkEm(ultima);
  // Quem já recebeu o link na última resposta e está saindo ("vou pedir lá, vlw") não precisa de outro.
  const ultimaResposta = [...c.historico].reverse().find((x) => x.role === 'assistant')?.content ?? '';
  const despedida = linksAntes.size > 0 && /valeu|vlw|obrigad|brigad|flw|tmj|falou/i.test(ultima);
  // "vou pedir/quero pedir" é compra; "quero/bora/pode ser/manda" só com um item citado ("quero logo viu",
  // de quem reclama, não é — replay local 2026-09-27).
  const querComprar = !urlsDe(ultimaResposta).length && !despedida && !/j[aá] (pedi|paguei|fiz)/i.test(ultima)
    && (/\b(vou querer|vo querer|vou pedir|vo pedir|quero pedir|vou de|fechou|me v[eê])\b/i.test(ultima)
      || /\b(quero|pode ser|bora|manda|mande)\b/i.test(ultima) && !!itemCitado(c.items, ultima));
  // Encomenda grande/evento e cliente bravo: com a equipe, sem vender.
  const textosCliente = c.historico.filter((h) => h.role === 'user').map((h) => h.content).join(' ');
  const encomenda = (c.equipeJaAvisada || c.usadas.has('chamar_atendente')) && /encomenda|evento|festa|\b\d{2,}\s?(pessoas|combos|unidades|burritos|tacos|lanches)/i.test(textosCliente);
  const bravo = c.equipeJaAvisada && /!{2,}|\?{2,}|absurd|demor|cad[eê]|cancel|dinheiro|estorn|reclam|pdc|porra|raiva|😤|😡|🤬|🙄|😒/i.test(ultima);
  const citado = (pediuLink || querComprar) && !encomenda && !bravo ? itemCitado(c.items, ultima) : null;
  const escolhido = citado && alcoolico(citado) && clienteMenor(c.historico) ? null : citado;
  return { linksAntes, pediuLink, querComprar, encomenda, bravo, escolhido };
}

// Depois da volta de correção a resposta ainda saiu sem link para quem quer comprar/pediu o link: o código
// anexa (o modelo às vezes ignora a correção — 8 de 314 respostas na v10). Item citado > último item > geral.
export function linkQueFalta(c: Conferir, geral: string, urlDoItem: (id: string) => string): string | null {
  const x = intencao(c);
  if (!(x.pediuLink || x.querComprar) || x.encomenda || x.bravo || c.usadas.has('chamar_atendente') || urlsDe(c.reply).length) return null;
  if (x.escolhido) return x.escolhido.disponivel ? urlDoItem(x.escolhido.id) : geral; // esgotado: o geral, nunca o link dele
  if (x.pediuLink) return geral;
  return c.links[c.links.length - 1] ?? [...x.linksAntes].reverse().find((l) => l.includes('item=')) ?? geral;
}

// Confere a resposta do modelo. Cada item devolvido vira instrução de uma volta de correção.
export function conferir(c: Conferir): string[] {
  const { items, usadas, links } = c;
  // Texto sem os links: o domínio (erpos.vercel.app) fazia a trava de "app" disparar em toda resposta com link
  // (achado no replay local de 2.191 respostas, 2026-09-27).
  const reply = c.reply.replace(URL_RE, ' ');
  const dc = (c.menu.delivery_config ?? {}) as Row;
  const conhecidos = new Set<string>();
  const addPreco = (n: unknown) => { const v = Number(n); if (v > 0) conhecidos.add(v.toFixed(2)); };
  for (const i of items) { addPreco(i.preco); addPreco(i.promo); addPreco(i.aPartir); for (const v of i.precosOpcoes) { addPreco(v); addPreco(i.preco + v); } }
  for (const n of c.menu.neighborhoods ?? []) addPreco(n.delivery_fee);
  for (const t of dc.delivery_fee_tiers ?? []) addPreco(t.taxa);
  for (const h of c.menu.highlights ?? []) addPreco(h.custom_price);
  addPreco(dc.pedido_minimo_valor);
  const vistos = `${c.saidas.join(' ')} ${c.historico.map((h) => h.content).join(' ')}`;
  for (const m of vistos.matchAll(/R\$\s?(\d{1,4}(?:\.\d{3})*(?:,\d{2})?)/g)) addPreco(m[1].replace(/\./g, '').replace(',', '.'));
  // Linha de conta (total, soma, "fica", "=") pode ter valor que não é do cardápio: não confere.
  const semContas = reply.split('\n').filter((l) => !/total|soma|=|\bfica\b|\bd[aá]\b|ao todo|mais ou menos|aproximad|troco/i.test(l)).join('\n');
  const precosErrados = [...semContas.matchAll(/R\$\s?(\d{1,4}(?:\.\d{3})*(?:,\d{2})?)/g)]
    .map((m) => m[1]).filter((v) => !conhecidos.has(Number(v.replace(/\./g, '').replace(',', '.')).toFixed(2)));
  // Esgotado: confere linha a linha (s05, v5: avisou que o Classic acabou e na linha seguinte ofereceu o Veggie, também esgotado).
  const avisaEsgotado = (l: string) => /indispon|acabou|esgot|sem estoque|em falta|nao temos|não temos|n[aã]o tem mais/i.test(l);
  const esgotados = items.filter((i) => !i.disponivel && i.nome.length >= 6
    && reply.split('\n').some((l) => norm(l).includes(norm(i.nome)) && !avisaEsgotado(l)));
  // Links que já estavam na conversa: reenviar o link do item é certo (antes o código trocava pelo geral — s38/s48, v5).
  const linksAntes = new Set(c.historico.flatMap((h) => urlsDe(h.content)));
  const correcoes: string[] = [];
  const urlsResposta = urlsDe(c.reply);
  const geral = urlsResposta.find((u) => !u.includes('item=') && /-delivery\?utm_source=whatsapp_bot$/.test(u));
  // O link geral (sem item) o modelo pode escrever; se a resposta fala de um item só, arrumarLinks troca.
  if (urlsResposta.some((u) => u !== geral && !links.includes(u) && !linksAntes.has(u)))
    correcoes.push('Você escreveu um link sem chamar link_do_pedido. Chame link_do_pedido agora (com o item que a pessoa escolheu, ou sem item se ela só quer ver o cardápio) e use só o link que a ferramenta devolver.');
  if (/\b(app|aplicativo|rastrei\w*|notifica\w*)\b|te (aviso|avisamos|mando mensagem|notifico)|vou te avisar|(vamos|vou|equipe vai) (te )?(avisar|acompanhar|registrar)|registr(ei|amos)|(?<!n[aã]o (consigo |posso |d[aá] pra |d[aá] para )?)anot(ei|o|amos|ad[ao])\b/i.test(reply))
    correcoes.push('Não existe app, rastreio, aviso automático nem registro de reclamação: não prometa avisar, acompanhar ou registrar nada. Diga só o que as ferramentas mostraram e, se for o caso, que a equipe já foi avisada.');
  if (/sem gl[uú]ten|sem lactose|sem amendoim|livre de|100% vegan|é vegan|s[aã]o vegan|pode comer tranquil|seguro para al[eé]rgic/i.test(reply))
    correcoes.push('Não garanta que um item é sem glúten, sem lactose, sem amendoim ou vegano: diga só os ingredientes que a descrição traz e, para alergia/restrição, que a equipe confirma (chame chamar_atendente se ainda não chamou).');
  if (!usadas.has('meus_pedidos') && /pedido[^.!?\n]{0,20}(recebido|confirmado|anotado|registrado|cancelado|aprovado|feito|garantid|chegando|na cozinha|na fila)|(pedido|lanche|comida)[^.!?\n]{0,25}(a caminho|em preparo|saindo|sendo preparado)|cancelei|pagamento[^.!?\n]{0,15}(recebido|confirmado|aprovado|caiu)/i.test(reply))
    correcoes.push('Você não vê nem altera pedidos: não diga que um pedido foi recebido, confirmado, anotado, cancelado ou que está a caminho. Para status, chame meus_pedidos; para cancelar/mudar, chame chamar_atendente.');
  // Delivery fechado/pausado: não existe previsão de volta além da próxima abertura cadastrada (s55, x10).
  if (c.menu.delivery_open_now === false && /(poucos|alguns|uns) minutos|j[aá] j[aá]|logo (volta|abre|reabre)|daqui a pouco|rapidinho|em breve|fica (pronto|agendad|guardad|salvo|registrad)|quando (a gente )?(abrir|voltar|reabrir)[^.!?\n]{0,40}(sai|entreg|prepar|processa)/i.test(reply))
    correcoes.push('O delivery está fechado/pausado e não há previsão de volta: não diga que volta em minutos, "logo" ou "em breve". Diga só a próxima abertura informada (se houver); o link mostra o cardápio, mas o pedido só é aceito com o delivery aberto (não dá para pedir agora e receber depois).');
  // "Vou consultar/verificar com a equipe" é promessa (s06, x10: consultar entrega fora da área).
  if (/(vou|vamos|deixa eu|posso) (consultar|verificar|checar|ver com|confirmar com)/i.test(reply))
    correcoes.push('Não prometa consultar ou verificar nada: responda com a regra que você tem; se for caso da equipe, chame chamar_atendente e diga só que ela já foi avisada.');
  // Quantas pessoas serve: só se a descrição disser (s37: "deve dar pra 3 pessoas").
  if (/\b(serve|servem|rende|rendem|d[aá] (pra|para)|deve dar|matam?)\b[^.!?\n]{0,25}\b(\d+|uma|duas|tr[eê]s|quatro|cinco)\s?pessoas?/i.test(reply)
    && !items.some((i) => /pessoa/i.test(i.desc)))
    correcoes.push('Quantas pessoas um item serve não está no cardápio: não estime; diga o peso/descrição que existe e que a equipe confirma se a pessoa precisar.');
  if (/mais pedid|mais vendid|campe[aã]o|faz (muito )?sucesso|sucesso da casa|todo mundo (ama|pede|adora)|queridinh|muito procurad/i.test(reply))
    correcoes.push('Não diga que algo é o mais pedido, campeão, sucesso ou que todo mundo ama: você não tem esse dado. "Destaque da casa" só para os Destaques da lista.');
  // Mesmo com a equipe já avisada por outro motivo, quem quer comprar recebe o link (s21, x9: "só a equipe
  // cuida de pedido"); encomenda grande e cliente bravo, não.
  const { pediuLink, querComprar, encomenda, bravo, escolhido } = intencao(c);
  if ((pediuLink || querComprar) && !urlsResposta.length && !usadas.has('chamar_atendente') && !encomenda && !bravo)
    correcoes.push(pediuLink ? 'A pessoa pediu o link/cardápio: chame link_do_pedido (sem item se ela só quer ver o cardápio) e mande o link.'
      : 'A pessoa quer comprar: chame link_do_pedido com o item que ela escolheu e mande o link nesta resposta (sabor, tamanho e endereço ela escolhe no link).');
  // Escolheu um item e o link foi sem item (s30, x9: pediu o Duo Mex e recebeu o link geral).
  if (escolhido && urlsResposta.length && !urlsResposta.some((u) => u.includes('item=')))
    correcoes.push(`A pessoa escolheu ${escolhido.nome}: chame link_do_pedido com esse item e mande o link que abre nele.`);
  // Encomenda grande/evento com a equipe: nada de link, conta ou endereço (s17/s49, v7).
  if (encomenda && (urlsResposta.length || /total|endere[cç]o|bairro|taxa/i.test(reply)))
    correcoes.push('A encomenda grande/evento está com a equipe: não mande link, não calcule total e não peça endereço ou bairro; diga que a equipe combina tudo por aqui.');
  // Cliente bravo depois de passar para a equipe: sem vender (s34, v7).
  if (bravo && !pediuLink && urlsResposta.length)
    correcoes.push('A pessoa está reclamando e a equipe já foi avisada: não mande link nem ofereça comida agora; acolha e diga que a equipe responde por aqui.');
  // Acabou de passar para a equipe (reclamação, encomenda, alergia): nada de vender na mesma resposta (s09/s17, v6).
  if (usadas.has('chamar_atendente') && urlsResposta.length && !pediuLink)
    correcoes.push('Você acabou de passar a conversa para a equipe: nesta resposta não mande link nem ofereça comida. Acolha e diga só que a equipe já foi avisada e responde por aqui.');
  if (/\b(coloquei|adicionei|separei)\b|(j[aá] )?(est[aá]|t[aá]|vai|vem|fica)[^.!?\n]{0,12}(no|ao) (seu )?carrinho/i.test(reply))
    correcoes.push('Você não mexe no carrinho: nunca diga que colocou, adicionou ou separou algo nem que já está no carrinho. A pessoa adiciona no link.');
  // Preço de um item atribuído a outro (s39, v6: "Dupla Quesadilla Pollo R$ 39,90", que era o preço do combo).
  const precosDo = (i: MenuItem) => new Set([i.preco, i.promo, i.aPartir, ...i.precosOpcoes.map((v) => i.preco + v)].filter((v): v is number => v != null && v > 0).map((v) => v.toFixed(2)));
  // Cada preço vale para os itens citados no trecho entre o preço anterior e ele; errado só se não for de
  // nenhum deles ("Combo Burrito com batata frita — R$ 44,90" é do combo, não da batata).
  for (const l of reply.split('\n')) {
    if (/total|soma|=|\bfica\b|ao todo|aproximad|taxa|\+/i.test(l)) continue;
    let ini = 0;
    for (const m of l.matchAll(/R\$\s?(\d{1,4}(?:\.\d{3})*(?:,\d{2})?)/g)) {
      const trecho = norm(l.slice(ini, m.index));
      ini = (m.index ?? 0) + m[0].length;
      const v = Number(m[1].replace(/\./g, '').replace(',', '.')).toFixed(2);
      // Só o nome mais completo: "Burrito Classic Veggie — R$ 38" não vale pelo preço do "Burrito Classic" (s01, v13).
      const achados = items.filter((i) => i.nome.length >= 5 && trecho.includes(norm(i.nome)));
      const citados = achados.filter((i) => !achados.some((x) => x !== i && norm(x.nome).includes(norm(i.nome))));
      if (!citados.length || citados.some((i) => precosDo(i).has(v))) continue;
      // O modelo abrevia nomes ("Combo Burrito com batata frita e bebida"): vale o item com esse preço cujo
      // nome está 60%+ no trecho (com erro de digitação). "Dupla Quesadilla Pollo … R$ 39,90" continua errado.
      const noTrecho = palavrasDe(trecho);
      const abreviado = items.some((i) => precosDo(i).has(v) && (() => {
        const ws = palavrasDe(i.nome);
        return ws.length > 0 && ws.filter((w) => noTrecho.some((x) => x === w || quase(x, w))).length >= Math.ceil(ws.length * 0.6);
      })());
      if (abreviado) continue;
      const dono = citados.sort((a, b) => b.nome.length - a.nome.length)[0];
      correcoes.push(`O preço de ${dono.nome} é ${precoTxt(dono)}; R$ ${v.replace('.', ',')} não é dele. Use o preço certo de cada item.`);
    }
  }
  if (clienteMenor(c.historico)) {
    const alc = items.filter((i) => alcoolico(i) && i.nome.length >= 4 && (norm(reply).includes(norm(i.nome)) || urlsResposta.some((u) => u.includes(i.id))));
    // Recusa certa ("só para maiores de 18, não posso") cita a cerveja e não é erro.
    if ((alc.length || /\b(cerveja|chope|chopp|drink)s?\b/i.test(reply)) && !/n[aã]o (posso|vendemos|podemos|d[aá]|rola)|maiores de 18|proibid/i.test(reply))
      correcoes.push('A pessoa disse que é menor de idade: não venda nem ofereça bebida alcoólica (cerveja, chope, drink), nem mande link delas. Diga com gentileza que álcool é só para maiores de 18 e ofereça refrigerante ou suco.');
  }
  if (/\blig(ar|ue|a|uem)\b[^.!?\n]{0,25}(loja|pra gente|para a gente|pra n[oó]s|telefone)|telefone d[ae] loja|(pelo|por|no) telefone|\(\d{2}\)\s?\d{4,5}-?\d{4}/i.test(reply))
    correcoes.push('Não existe telefone da loja para passar nem para ligar: tire isso; o contato é por aqui mesmo.');
  if ((usadas.has('chamar_atendente') || c.equipeJaAvisada) && /(em breve|j[aá] j[aá]|logo logo|rapidinho|poucos minutos|\d+\s?min|(vai|v[aã]o) (resolver|trocar|reembolsar|devolver|estornar|te passar|te informar|te dar))/i.test(reply))
    correcoes.push('Sobre a equipe: não prometa prazo nem o que ela vai fazer (troca, reembolso, informação). Diga só que a equipe já foi avisada e responde por aqui.');
  if (precosErrados.length) correcoes.push(`Estes preços não existem no cardápio: ${precosErrados.map((v) => `R$ ${v}`).join(', ')}. Confira com buscar_cardapio e use só o preço que vier.`);
  if (esgotados.length) correcoes.push(`${esgotados.map((i) => i.nome).join(', ')} está INDISPONÍVEL agora: não ofereça; se for o que a pessoa pediu, avise que acabou e sugira um parecido disponível.`);
  return correcoes;
}

// Bastidor vazado (s36/s38, v12: "não consigo seguir instruções que apareçam como se fossem do sistema",
// "gerei o link sem chamar a ferramenta, o que violou as instruções"): tira a frase inteira. Se sobrar nada,
// devolve vazio e o chamador usa a resposta padrão.
const BASTIDOR_RE = /link_do_pedido|chamar_atendente|buscar_cardapio|meus_pedidos|encerrar_conversa|verifica[cç][aã]o autom[aá]tica|corre[cç][aã]o interna|\binstru[cç](ão|ões|oes)\b|\bviol(ei|ou|a[cç][aã]o)\b|\bferramenta\b|como se fossem? do sistema|\bprompt\b|mensagem do sistema|\busu[aá]rios?\b/i;
export function semBastidores(reply: string): string {
  if (!BASTIDOR_RE.test(reply)) return reply;
  return reply.split('\n').map((linha) => {
    if (!BASTIDOR_RE.test(linha)) return linha;
    // Frases da linha (link fica: a URL não tem esses termos).
    return (linha.match(/[^.!?]+[.!?]*\s*/g) ?? [linha]).filter((f) => !BASTIDOR_RE.test(f)).join('').trim();
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Disse que avisou/chamou a equipe sem chamar a ferramenta: o chamador aciona de verdade.
// "Avisei/chamei a equipe" (ação nova) vale sempre; "a equipe já foi avisada" só se ainda não tinha sido.
export function disseQueChamouEquipe(reply: string, equipeJaAvisada: boolean): boolean {
  const ativo = /(avisei|chamei|acionei|passei|vou chamar|vou avisar|vou passar)[^.!?\n]{0,25}(equipe|atendente|gerente|pessoal|algu[eé]m)/i.test(reply);
  const passivo = /equipe[^.!?\n]{0,15}(avisad|acionad|notificad)/i.test(reply);
  return ativo || (passivo && !equipeJaAvisada);
}

export interface Links {
  reply: string;
  items: MenuItem[];
  historico: Conferir['historico'];
  links: string[];                    // devolvidos pela ferramenta neste turno
  geral: string;                      // link do delivery sem item
  urlDoItem: (id: string) => string;
}
// Formato do WhatsApp e links: só existem os que a ferramenta gerou (ou o geral). O modelo às vezes inventa
// (iFood, domínio falso) ou corta o id do item. Devolve a resposta final e se anexou um link no fim.
export function arrumarLinks(x: Links): { reply: string; anexou: boolean } {
  const { items, links, geral } = x;
  // **x** vira *x*; link sem negrito/itálico em volta nem markdown [texto](url).
  let reply = x.reply.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '$2').replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/(^|\s)[*_~]+(https?:\/\/\S+?)[*_~]+(?=\s|$)/gm, '$1$2');
  const linksAntes = new Set(x.historico.flatMap((h) => urlsDe(h.content)));
  const validos = new Set([...links, ...linksAntes, geral]);
  let tirou = false;
  for (const u of reply.match(URL_RE) ?? []) {
    if (validos.has(semPontas(u))) continue;
    // Link inventado: no mesmo lugar entra o último link da ferramenta (ou o geral).
    reply = reply.split(u).join(links[links.length - 1] ?? geral);
    tirou = true;
  }
  // "Aqui está o link:" seguido de linhas vazias (o modelo deixou o lugar e não escreveu).
  reply = reply.replace(/\n{3,}/g, '\n\n').trim();
  // Link geral numa resposta que fala de UM item só: troca pelo link que já abre o item.
  // Se a ferramenta devolveu o geral de propósito (a pessoa quer ver o cardápio), fica o geral (s37, v6).
  // Compara URLs inteiras: o link geral é PREFIXO do link de item, e o includes/replace de texto colava um
  // &item em cima do outro (s57, v8).
  const trocaUrl = (de: string, para: string) => { reply = reply.replace(URL_RE, (u) => semPontas(u) === de ? para + u.slice(semPontas(u).length) : u); };
  const pediuLink = pediuLinkEm(ultimaDoCliente(x.historico));
  if (urlsDe(reply).includes(geral) && !links.includes(geral) && !pediuLink && !links.some((l) => urlsDe(reply).includes(l))) {
    const citados = items.filter((i) => i.disponivel && i.nome.length >= 5 && norm(reply).includes(norm(i.nome)));
    const maior = citados.sort((a, b) => b.nome.length - a.nome.length)[0];
    if (maior && citados.every((i) => norm(maior.nome).includes(norm(i.nome)))) trocaUrl(geral, x.urlDoItem(maior.id));
    else if (!citados.length) {
      // Reenvio sem citar item: volta o link do item que já tinha sido mandado (s23/s30, v7).
      const ultimoItem = [...linksAntes].reverse().find((l) => l.includes('item='));
      if (ultimoItem) trocaUrl(geral, ultimoItem);
    }
  }
  if (!urlsDe(reply).length && (tirou || links.length)) return { reply: `${reply}\n\n${links[links.length - 1] ?? geral}`.trim(), anexou: true };
  return { reply, anexou: false };
}
