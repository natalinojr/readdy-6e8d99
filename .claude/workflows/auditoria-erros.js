export const meta = {
  name: 'auditoria-erros',
  description: 'Lê dev_error_events abertos (últimas 24h por padrão), tria cada um em paralelo, grava ticket/status no banco e devolve um relatório priorizado. Só leitura no código; no banco só a coluna ticket/status.',
  whenToUse: 'Manhã ou depois de um deploy: "o que quebrou?". Uso: /auditoria-erros [horas] (padrão 24). É a "auditoria contínua" da Fase 2.',
  phases: [
    { title: 'Coleta', detail: 'SELECT em dev_error_summary' },
    { title: 'Triagem', detail: 'um Triador por erro, em paralelo' },
    { title: 'Registro', detail: 'grava ticket/status em dev_error_events' },
  ],
}

const horas = Number(typeof args === 'string' ? args : (args?.horas ?? 24)) || 24
const MAX_ERROS = 15

const LISTA = {
  type: 'object',
  properties: {
    erros: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, source: { type: 'string' }, fn: { type: 'string' }, route: { type: 'string' },
          message: { type: 'string' }, count: { type: 'number' }, last_seen: { type: 'string' }, app_build: { type: 'string' },
        },
        required: ['id', 'source', 'message', 'count', 'last_seen'],
      },
    },
    total_abertos: { type: 'number' },
  },
  required: ['erros', 'total_abertos'],
}

const TICKET = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    titulo: { type: 'string' },
    modulo: { type: 'string' },
    severidade: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
    acao: { type: 'string', enum: ['corrigir', 'ignorar', 'investigar'] },
    arquivos: { type: 'array', items: { type: 'string' } },
    hipotese: { type: 'string' },
    ticket_texto: { type: 'string' },
  },
  required: ['id', 'titulo', 'modulo', 'severidade', 'acao', 'arquivos', 'hipotese', 'ticket_texto'],
}

phase('Coleta')
const lista = await agent(
  `Rode este SQL (só SELECT) no projeto mdghhjemzdmeuqpzuyzx e devolva o resultado estruturado:\n` +
  `select id, source, fn, route, message, count, last_seen, app_build from public.dev_error_summary ` +
  `where last_seen > now() - interval '${horas} hours' and status = 'open' order by count desc, last_seen desc limit ${MAX_ERROS};\n` +
  `E também: select count(*) as total_abertos from public.dev_error_events where status = 'open';`,
  { agentType: 'triador', label: 'coleta', phase: 'Coleta', schema: LISTA, effort: 'low' },
)
if (!lista) throw new Error('Coleta falhou')
log(`${lista.erros.length} erro(s) nas últimas ${horas}h (${lista.total_abertos} abertos no total${lista.total_abertos > MAX_ERROS ? `; só os ${MAX_ERROS} mais frequentes triados` : ''})`)
if (lista.erros.length === 0) return { horas, erros: 0, relatorio: `Nenhum erro aberto nas últimas ${horas}h.` }

phase('Triagem')
const tickets = (await parallel(lista.erros.map((e) => () =>
  agent(
    `Erro da fila dev_error_events (id ${e.id}): leia a linha inteira por SQL e trie.\n` +
    `Resumo: [${e.source}] ${e.fn ?? e.route ?? ''} — ${e.message} (×${e.count}, último ${e.last_seen}, build ${e.app_build ?? '?'})\n` +
    `Devolva também "acao": corrigir (bug real), ignorar (ruído/ambiente/terceiro) ou investigar (não dá para concluir sem reproduzir).`,
    { agentType: 'triador', label: `triador ${e.source}:${(e.fn ?? e.route ?? '').slice(0, 24)}`, phase: 'Triagem', schema: TICKET },
  ),
))).filter(Boolean)

phase('Registro')
const ordem = { P0: 0, P1: 1, P2: 2, P3: 3 }
tickets.sort((a, b) => ordem[a.severidade] - ordem[b.severidade])
const updates = tickets.map((t) => {
  const status = t.acao === 'ignorar' ? 'ignored' : 'triaged'
  const txt = `[${t.severidade}] ${t.titulo} | ${t.modulo} | ${t.acao} | ${t.arquivos.join(', ')}`.replace(/'/g, "''")
  return `update public.dev_error_events set status = '${status}', ticket = '${txt}', updated_at = now() where id = '${t.id}';`
}).join('\n')
await agent(
  `Execute exatamente estes UPDATEs (é a única escrita permitida nesta auditoria: colunas status/ticket de dev_error_events) e confirme quantas linhas afetou:\n${updates}`,
  { agentType: 'triador', label: 'registro', phase: 'Registro', effort: 'low' },
)

const linhas = tickets.map((t) => `- [${t.severidade}] **${t.titulo}** (${t.modulo}) → ${t.acao}. ${t.arquivos[0] ?? ''} — ${t.hipotese.slice(0, 200)}`)
const relatorio = [
  `# Auditoria de erros — últimas ${horas}h`,
  `${tickets.length} triado(s) de ${lista.total_abertos} aberto(s). Para corrigir um: /ciclo <id>.`,
  '', ...linhas,
  '', '## Tickets completos', ...tickets.map((t) => `### ${t.id}\n${t.ticket_texto}`),
].join('\n')
return { horas, erros: tickets.length, total_abertos: lista.total_abertos, tickets, relatorio }
