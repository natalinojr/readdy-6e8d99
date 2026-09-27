import { pathToFileURL } from 'node:url';
// Replay das travas (atendimento-loja/travas.ts) sobre respostas reais gravadas nas simulações — sem API.
// Mede quanto cada trava dispara (falso positivo = resposta boa corrigida à toa; o que sobra = escapou).
// Na pasta (padrão $TEMP/atendimento-aval): travas.mjs (esbuild do travas.ts), menu.json (get_delivery_config
// da loja) e todas.json ({rows:[{rodada, sim, cen, conversa}]} de treino.resultado). Ver README.md.
// uso: node scripts/atendimento-treino/replay.mjs [filtroRodada] [pasta]
import fs from 'fs';
const { conferir, arrumarLinks, menuItems, norm, linkQueFalta } = await import(pathToFileURL(`${(process.argv[3] ?? `${process.env.TEMP ?? '/tmp'}/atendimento-aval`).replace(/\/?$/, '/')}travas.mjs`).href);
const anexos = [];
const dir = (process.argv[3] ?? `${process.env.TEMP ?? '/tmp'}/atendimento-aval`).replace(/\/?$/, '/');
const menuBase = JSON.parse(fs.readFileSync(dir + 'menu.json', 'utf8'));
const rows = JSON.parse(fs.readFileSync(dir + 'todas.json', 'utf8')).rows;
const filtro = process.argv[2] ? new RegExp(process.argv[2]) : null;
const slug = 'el-patron-paranagua-1780923403663';
const geral = `https://erpos.vercel.app/${slug}-delivery?utm_source=whatsapp_bot`;
const porTrava = new Map(); const exemplos = []; let turnos = 0, mudouLink = 0;
for (const r of rows) {
  if (filtro && !filtro.test(r.rodada)) continue;
  const menu = structuredClone(menuBase);
  const cen = r.cen ?? {};
  // treino.rodar manda aberto:true por padrão; o cenário pode fechar.
  menu.delivery_open_now = cen.aberto === false ? false : true;
  if (Array.isArray(cen.sem_estoque)) {
    const alvo = cen.sem_estoque.map(norm);
    menu.out_of_stock_ids = [...(menu.out_of_stock_ids ?? []), ...menu.items.filter((i) => alvo.some((a) => norm(i.name).includes(a))).map((i) => i.id)];
  }
  const items = menuItems(menu);
  const hist = []; let equipe = false;
  for (const t of r.conversa ?? []) {
    hist.push({ role: 'user', content: t.cliente });
    const fs_ = t.ferramentas ?? [];
    const usadas = new Set(fs_.map((f) => f.nome));
    const links = fs_.filter((f) => f.nome === 'link_do_pedido').map((f) => (f.saida.match(/https?:\/\/\S+/) ?? [''])[0]).filter(Boolean);
    const c = conferir({ reply: t.assistente, items, menu, historico: [...hist], saidas: fs_.map((f) => f.saida), usadas, links, equipeJaAvisada: equipe });
    const l = arrumarLinks({ reply: t.assistente, items, historico: [...hist], links, geral, urlDoItem: (id) => `${geral}&item=${id}` });
    const falta = linkQueFalta({ reply: t.assistente, items, menu, historico: [...hist], saidas: [], usadas, links, equipeJaAvisada: equipe }, geral, (id) => `${geral}&item=${id}`);
    if (falta) anexos.push({ rodada: r.rodada, sim: r.sim, cliente: t.cliente.slice(0, 120), resposta: t.assistente.slice(0, 160), anexa: falta.replace(geral, 'GERAL').slice(0, 60), item: (items.find((i) => falta.includes(i.id)) ?? {}).nome });
    turnos++;
    if (l.reply !== t.assistente.replace(/\*\*(.+?)\*\*/g, '*$1*').trim()) mudouLink++;
    for (const x of c) {
      const k = x.slice(0, 60);
      porTrava.set(k, (porTrava.get(k) ?? 0) + 1);
      exemplos.push({ rodada: r.rodada, sim: r.sim, trava: k, cliente: t.cliente.slice(0, 200), resposta: t.assistente.slice(0, 500) });
    }
    if (usadas.has('chamar_atendente')) equipe = true;
    hist.push({ role: 'assistant', content: t.assistente });
  }
}
console.log(`${turnos} turnos; arrumarLinks mudaria ${mudouLink}; link anexado em ${anexos.length}`);
fs.writeFileSync(dir + 'anexos.json', JSON.stringify(anexos, null, 1));
for (const [k, n] of [...porTrava].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), k);
fs.writeFileSync(dir + 'replay_out.json', JSON.stringify(exemplos, null, 1));
