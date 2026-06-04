const http = require('http');
const net = require('net');
const url = require('url');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ============================================
// AGENTE LOCAL DE IMPRESSAO — ERPOS v3
// Suporta múltiplas impressoras via config.json
// E faz polling na fila centralizada do Supabase
// Roda no PC do restaurante (Windows/Linux/Mac)
// ============================================

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Configuracao padrao (usada se config.json nao existir)
let config = {
  agent_port: 9876,
  impressoras: [],
  default_timeout_ms: 10000,
  // Configuração da fila centralizada (opcional)
  supabase_url: '',
  supabase_anon_key: '',
  tenant_id: '',
  poll_interval_ms: 3000,        // polling da fila a cada 3s
  print_queue_enabled: false,    // habilitar polling da fila centralizada
};

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB max

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      log('config.json nao encontrado — usando configuracao padrao');
      return;
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    config = { ...config, ...parsed };
    log(`Configuracao carregada: ${config.impressoras.length} impressora(s)`);
    if (config.impressoras.length > 0) {
      config.impressoras.forEach((imp) => {
        log(`  -> ${imp.id}: ${imp.nome} @ ${imp.ip}:${imp.porta || 9100} (${imp.papel || '80mm'})`);
      });
    }
    if (config.print_queue_enabled && config.supabase_url && config.tenant_id) {
      log(`Fila centralizada ATIVA — tenant: ${config.tenant_id}, polling a cada ${config.poll_interval_ms}ms`);
    }

    // Verificacao critica: tenant_id nao pode ser placeholder
    if (config.tenant_id === 'SEU-TENANT-ID-AQUI' || !config.tenant_id || config.tenant_id.trim() === '') {
      log('');
      log('============================================================');
      log('ERRO CRITICO: tenant_id nao configurado no config.json!');
      log('  Atual: "' + (config.tenant_id || 'vazio') + '"');
      log('  O agente nunca encontrara tickets na fila.');
      log('  Corrija o config.json com o tenant_id do seu estabelecimento.');
      log('  Exemplo: "tenant_id": "7049e90e-c453-4268-b2dd-d074a7386612"');
      log('============================================================');
      log('');
    }
  } catch (e) {
    log(`Erro ao carregar config.json: ${e.message} — mantendo configuracao anterior`);
  }
}

function watchConfig() {
  try {
    fs.watchFile(CONFIG_PATH, { interval: 2000 }, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        log('config.json modificado — recarregando...');
        loadConfig();
      }
    });
  } catch (_) {
    // ignore watch errors
  }
}

function findImpressora(id) {
  if (!id || !Array.isArray(config.impressoras)) return null;
  return config.impressoras.find((i) => i.id === id) || null;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Payload too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendToPrinterTcp(ip, port, data, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let resolved = false;

    const done = (ok, err) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch (_) {}
      ok ? resolve() : reject(err || new Error('TCP failed'));
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      log(`Connected to ${ip}:${port}`);
      // Se os dados nao contem comandos ESC/POS (0x1B), assume texto UTF-8
      // e converte para CP860 (Portugues) antes de enviar para a impressora
      let finalData = data;
      if (data.indexOf('\x1B') === -1) {
        finalData = INIT + CP860 + utf8ToCp860(data);
      }
      // Envia como latin1 para preservar bytes 128-255
      const buf = Buffer.from(finalData, 'latin1');
      socket.write(buf, (err) => {
        if (err) {
          done(false, err);
        } else {
          log(`Sent ${buf.length} bytes to ${ip}:${port}`);
          setTimeout(() => done(true), 300);
        }
      });
    });

    socket.on('error', (err) => {
      log(`Socket error: ${err.message}`);
      done(false, err);
    });

    socket.on('timeout', () => {
      log(`Socket timeout connecting to ${ip}:${port}`);
      done(false, new Error('Connection timeout'));
    });

    socket.connect(port, ip);
  });
}

// ============================================
// HTTP helpers para chamadas à Edge Function
// ============================================

function postJson(urlStr, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const bodyStr = JSON.stringify(body);

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    };
    if (config.supabase_anon_key) {
      headers['Authorization'] = `Bearer ${config.supabase_anon_key}`;
      headers['apikey'] = config.supabase_anon_key;
    }

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path,
      method: 'POST',
      headers,
      timeout: timeoutMs,
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(bodyStr);
    req.end();
  });
}

// ============================================
// ESC/POS Formatter — formata ticket de pedido
// ============================================

const ESC = '\x1B';
const GS = '\x1D';
const INIT = ESC + '@';
const BOLD_ON = ESC + 'E\x01';
const BOLD_OFF = ESC + 'E\x00';
const ALIGN_CENTER = ESC + 'a\x01';
const ALIGN_LEFT = ESC + 'a\x00';
const ALIGN_RIGHT = ESC + 'a\x02';
const CUT = GS + 'V\x01';
const LINE_FEED = '\x0A';
const DOUBLE_HEIGHT = ESC + '!\x10';
const NORMAL = ESC + '!\x00';
const UNDERLINE = ESC + '-\x01';
const UNDERLINE_OFF = ESC + '-\x00';

/** Seleciona code page 860 (Português) para acentuação correta */
const CP860 = ESC + '\x74\x03';

/**
 * Converte string UTF-8 para bytes CP860 (Code Page 860 — Português DOS).
 * Mapeia os acentos mais comuns do português; caracteres não mapeados
 * permanecem como estão (fallback para byte direto).
 */
function utf8ToCp860(str) {
  const map = {
    'á': '\xA0', 'Á': '\x86', 'à': '\x85', 'À': '\x91',
    'â': '\x83', 'Â': '\x8F', 'ã': '\x84', 'Ã': '\x8E',
    'ç': '\x87', 'Ç': '\x80',
    'é': '\x82', 'É': '\x90', 'è': '\x8A', 'È': '\x92',
    'ê': '\x88', 'Ê': '\x89',
    'í': '\xA1', 'Í': '\x8B', 'ì': '\x8D', 'Ì': '\x98',
    'ó': '\xA2', 'Ó': '\x9F', 'ò': '\x95', 'Ò': '\xA9',
    'ô': '\x93', 'Ô': '\x8C', 'õ': '\x94', 'Õ': '\x99',
    'ú': '\xA3', 'Ú': '\x96', 'ù': '\x97', 'Ù': '\x9D',
    'ü': '\x81', 'Ü': '\x9A',
    'ñ': '\xA4', 'Ñ': '\xA5',
    'ª': '\xA6', 'º': '\xA7',
    '¿': '\xA8', '¡': '\xAD',
    '°': '\xF8',
  };
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    out += map[ch] !== undefined ? map[ch] : ch;
  }
  return out;
}

function formatTicket(body, impressora) {
  const {
    numero,
    destino = '',
    origem = '',
    itens = [],
    data_hora,
    mesa,
    comanda,
    observacao_geral,
  } = body;

  const papel = impressora?.papel || '80mm';
  const width = papel === '58mm' ? 32 : 48;
  const sep = '-'.repeat(width);
  const eqSep = '='.repeat(width);

  let out = INIT;
  out += CP860; // ativa code page 860 para acentos

  // Cabecalho
  out += ALIGN_CENTER;
  out += BOLD_ON + DOUBLE_HEIGHT + utf8ToCp860(`PEDIDO #${numero || '---'}`) + NORMAL + BOLD_OFF;
  out += LINE_FEED + LINE_FEED;

  if (destino) {
    out += BOLD_ON + utf8ToCp860(`DESTINO: ${destino}`) + BOLD_OFF + LINE_FEED;
  }
  if (origem) {
    out += utf8ToCp860(`Origem: ${origem}`) + LINE_FEED;
  }
  if (mesa) {
    out += BOLD_ON + utf8ToCp860(`MESA: ${mesa}`) + BOLD_OFF + LINE_FEED;
  }
  if (comanda) {
    out += utf8ToCp860(`Comanda: ${comanda}`) + LINE_FEED;
  }

  const now = data_hora || new Date().toLocaleString('pt-BR');
  out += utf8ToCp860(now) + LINE_FEED;
  out += utf8ToCp860(sep) + LINE_FEED;

  // Itens
  itens.forEach((item) => {
    const qtd = item.quantidade || 1;
    const nome = item.nome || 'Item';
    const qtdStr = String(qtd).padStart(2, ' ');

    out += ALIGN_LEFT;
    out += BOLD_ON + utf8ToCp860(`${qtdStr}x ${nome}`) + BOLD_OFF + LINE_FEED;

    if (item.opcoes && item.opcoes.length > 0) {
      item.opcoes.forEach((opt) => {
        out += utf8ToCp860(`   + ${opt}`) + LINE_FEED;
      });
    }

    if (item.observacoes && item.observacoes.length > 0) {
      item.observacoes.forEach((obs) => {
        out += utf8ToCp860(`   * ${obs}`) + LINE_FEED;
      });
    }
  });

  out += utf8ToCp860(sep) + LINE_FEED;

  if (observacao_geral) {
    out += BOLD_ON + utf8ToCp860('OBS:') + BOLD_OFF + LINE_FEED;
    out += utf8ToCp860(observacao_geral) + LINE_FEED;
    out += utf8ToCp860(sep) + LINE_FEED;
  }

  out += ALIGN_CENTER;
  out += utf8ToCp860(eqSep) + LINE_FEED;
  out += BOLD_ON + utf8ToCp860('ERPOS - Sistema de Gestao') + BOLD_OFF + LINE_FEED;
  out += utf8ToCp860(eqSep) + LINE_FEED;

  out += CUT;

  return out;
}

// ============================================
// Fila Centralizada — Polling do Supabase
// ============================================

let pollingInterval = null;
let isProcessingQueue = false;

async function processPrintQueue() {
  if (isProcessingQueue) return;
  if (!config.print_queue_enabled || !config.supabase_url || !config.tenant_id) return;

  isProcessingQueue = true;

  try {
    // Chama Edge Function print-queue-agent (action: poll)
    const functionUrl = config.supabase_url.replace(/\/$/, '') + '/functions/v1/print-queue-agent';
    log(`[Queue] Polling fila centralizada...`);

    const result = await postJson(functionUrl, {
      action: 'poll',
      tenant_id: config.tenant_id,
      limit: 10,
    }, 15000);

    if (!result.success) {
      log(`[Queue] Poll error: ${result.error || 'unknown'}`);
      isProcessingQueue = false;
      return;
    }

    const tickets = result.tickets || [];
    if (tickets.length === 0) {
      log(`[Queue] Nenhum ticket pendente (tenant_id: ${config.tenant_id})`);
      isProcessingQueue = false;
      return;
    }

    log(`[Queue] ${tickets.length} ticket(s) pendentes encontrados`);

    for (const ticket of tickets) {
      try {
        log(`[Queue] Imprimindo ticket #${ticket.order_number} (${ticket.station_key})`);

        let impressora = null;

        // Se o ticket é do bar, procura impressora 'bar' primeiro
        if (ticket.station_key === 'bar' || ticket.station_key === 'balcao') {
          impressora = findImpressora('bar');
          if (impressora) {
            log(`[Queue] Usando impressora BAR para ticket #${ticket.order_number}`);
          }
        }

        // Fallback: procura pelo impressora_id do ticket
        if (!impressora && ticket.impressora_id) {
          impressora = findImpressora(ticket.impressora_id);
        }

        // Último fallback: impressora 'cozinha'
        if (!impressora) {
          impressora = findImpressora('cozinha');
        }

        if (!impressora) {
          log(`[Queue] ERRO: Nenhuma impressora encontrada para ticket #${ticket.order_number} (station=${ticket.station_key}, impressora_id=${ticket.impressora_id || 'n/a'})`);
          await confirmTicket(ticket.id, 'failed', `Impressora nao configurada no agente para station=${ticket.station_key}`);
          continue;
        }

        const payload = ticket.payload || {};
        const escPosData = formatTicket(payload, impressora);

        await sendToPrinterTcp(impressora.ip, impressora.porta || 9100, escPosData, config.default_timeout_ms || 10000);
        log(`[Queue] Ticket #${ticket.order_number} impresso com sucesso (${impressora.nome})`);

        await confirmTicket(ticket.id, 'printed');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro desconhecido';
        log(`[Queue] ERRO ao imprimir ticket #${ticket.order_number}: ${msg}`);
        await confirmTicket(ticket.id, 'failed', msg);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    log(`[Queue] Erro no polling: ${msg}`);
  } finally {
    isProcessingQueue = false;
  }
}

async function confirmTicket(queueId, status, errorMsg) {
  try {
    const functionUrl = config.supabase_url.replace(/\/$/, '') + '/functions/v1/print-queue-agent';
    await postJson(functionUrl, {
      action: 'confirm',
      queue_id: queueId,
      status,
      error: errorMsg || undefined,
    }, 10000);
  } catch (err) {
    log(`[Queue] Erro ao confirmar ticket ${queueId}: ${err.message}`);
  }
}

function startQueuePolling() {
  if (pollingInterval) return;
  log('[Queue] Iniciando polling da fila centralizada...');
  pollingInterval = setInterval(processPrintQueue, config.poll_interval_ms || 3000);
  // Executa imediatamente na inicialização
  processPrintQueue();
}

function stopQueuePolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    log('[Queue] Polling da fila centralizada parado');
  }
}

// ============================================
// HTTP Server
// ============================================

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Health check
  if (pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, {
      status: 'ok',
      agent: 'erpos-print-agent',
      version: '3.0.0',
      impressoras_count: config.impressoras.length,
      config_loaded: fs.existsSync(CONFIG_PATH),
      queue_enabled: config.print_queue_enabled,
      queue_polling: !!pollingInterval,
    });
    return;
  }

  // Status da fila
  if (pathname === '/queue-status' && req.method === 'GET') {
    sendJson(res, 200, {
      enabled: config.print_queue_enabled,
      polling: !!pollingInterval,
      tenant_id: config.tenant_id,
      interval_ms: config.poll_interval_ms,
    });
    return;
  }

  // Listar impressoras configuradas
  if (pathname === '/impressoras' && req.method === 'GET') {
    sendJson(res, 200, {
      success: true,
      impressoras: config.impressoras.map((i) => ({
        id: i.id,
        nome: i.nome,
        ip: i.ip,
        porta: i.porta || 9100,
        papel: i.papel || '80mm',
      })),
    });
    return;
  }

  // Print endpoint — suporta dois modos:
  // 1. Raw:  { ip, port, data, data_encoding }
  // 2. JSON: { numero, destino, origem, impressora_id, itens[], ... }
  if (pathname === '/print' && req.method === 'POST') {
    try {
      const body = await parseBody(req);

      let impressora_id = body.impressora_id;
      let impressora = null;

      // Resolve impressora pelo ID
      if (impressora_id) {
        impressora = findImpressora(impressora_id);
        if (!impressora) {
          log(`impressora_id "${impressora_id}" nao encontrado no config.json`);
        }
      }

      // Fallback: usa "cozinha" se nao passou impressora_id
      if (!impressora && !body.ip) {
        impressora = findImpressora('cozinha');
        if (impressora) {
          log('Usando impressora padrao "cozinha"');
        }
      }

      let ip = body.ip;
      let port = body.port || 9100;

      if (impressora) {
        ip = impressora.ip;
        port = impressora.porta || 9100;
      }

      if (!ip) {
        sendJson(res, 400, { success: false, error: 'Missing "ip" or "impressora_id" field' });
        return;
      }

      // Modo 1: dados raw (ESC/POS pronto)
      if (body.data) {
        const data_encoding = body.data_encoding || 'utf8';
        log(`Print RAW -> ${ip}:${port} (${Buffer.byteLength(body.data, data_encoding)} bytes)`);
        const timeout = body.timeout_ms || config.default_timeout_ms || 10000;
        await sendToPrinterTcp(ip, port, body.data, timeout);
        log('Print RAW completed successfully');
        sendJson(res, 200, { success: true, bytes_sent: Buffer.byteLength(body.data, data_encoding), mode: 'raw' });
        return;
      }

      // Modo 2: JSON estruturado de pedido -> formata ESC/POS
      if (body.itens && Array.isArray(body.itens)) {
        const ticket = formatTicket(body, impressora);
        log(`Print TICKET #${body.numero || '---'} -> ${ip}:${port} (${Buffer.byteLength(ticket, 'latin1')} bytes)`);
        const timeout = body.timeout_ms || config.default_timeout_ms || 10000;
        await sendToPrinterTcp(ip, port, ticket, timeout);
        log('Print TICKET completed successfully');
        sendJson(res, 200, { success: true, bytes_sent: Buffer.byteLength(ticket, 'latin1'), mode: 'ticket' });
        return;
      }

      sendJson(res, 400, { success: false, error: 'Missing "data" (raw) or "itens" (ticket) field' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log(`Print failed: ${msg}`);
      sendJson(res, 500, { success: false, error: msg });
    }
    return;
  }

  sendJson(res, 404, { success: false, error: 'Not found' });
});

// ============================================
// Startup
// ============================================

loadConfig();
watchConfig();

server.listen(config.agent_port, '127.0.0.1', () => {
  log(`============================================`);
  log(`ERPOS Print Agent v3.0.0`);
  log(`Listening on http://127.0.0.1:${config.agent_port}`);
  log(`Endpoints:`);
  log(`  GET  /health       — health check`);
  log(`  GET  /queue-status — status da fila centralizada`);
  log(`  GET  /impressoras  — lista impressoras do config.json`);
  log(`  POST /print        — envia dados para impressora`);
  log(`                     Modo RAW:  { ip, port, data, data_encoding }`);
  log(`                     Modo TICKET: { numero, destino, origem, impressora_id, itens[] }`);
  log(`============================================`);

  // Inicia polling da fila se configurado
  if (config.print_queue_enabled && config.supabase_url && config.tenant_id) {
    startQueuePolling();
  } else if (config.print_queue_enabled && (!config.supabase_url || !config.tenant_id)) {
    log('AVISO: print_queue_enabled=true mas supabase_url ou tenant_id nao configurados');
    log('         Adicione no config.json:');
    log('         { "supabase_url": "https://...", "tenant_id": "uuid-do-tenant" }');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  stopQueuePolling();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  log('Shutting down...');
  stopQueuePolling();
  server.close(() => process.exit(0));
});