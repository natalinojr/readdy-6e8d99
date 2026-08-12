const http = require('http');
const net = require('net');
const url = require('url');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Realtime (opcional) — carregado de forma tolerante: se as dependencias
// ainda nao foram instaladas (npm install) o agente continua funcionando
// apenas com polling, sem derrubar o servico.
let createClient = null;
let WS = null;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (_) {
  createClient = null;
}
try {
  WS = require('ws');
  if (WS && !globalThis.WebSocket) globalThis.WebSocket = WS;
} catch (_) {
  WS = null;
}

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
  poll_interval_ms: 3000,        // polling da fila a cada 3s (fallback do realtime)
  print_queue_enabled: false,    // habilitar polling da fila centralizada
  realtime_enabled: true,        // escutar inserts da fila via Supabase Realtime (impressao instantanea)
  realtime_debounce_ms: 250,     // agrupa varios tickets do mesmo pedido em um unico poll
  // Rede de seguranca: mesmo em modo "so Realtime" (polling_enabled=false) rodamos
  // um poll lento garantido. Se o websocket do Realtime "morrer" (PC dormiu, wifi
  // oscilou) o agente continua imprimindo em ate safety_poll_interval_ms, SEM
  // precisar de reinicio manual. 60s/tenant e desprezivel pra cota de Edge Function.
  safety_poll_interval_ms: 60000,
  // Watchdog que detecta canal Realtime caido/zumbi e forca a reconexao.
  realtime_watchdog_ms: 60000,
};

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB max

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

// ============================================
// Crash guards — NUNCA derrubar o processo por um erro solto.
// Sem isto, no Node 15+ uma unhandledRejection encerra o agente; rodando
// como Servico Windows ate volta, mas em modo Realtime-only podia parar de
// imprimir ate o restart. Aqui logamos e seguimos vivos.
// ============================================
process.on('uncaughtException', (err) => {
  try { log(`[FATAL] uncaughtException (ignorado, agente segue): ${err && err.stack ? err.stack : err}`); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
  try { log(`[FATAL] unhandledRejection (ignorado, agente segue): ${reason && reason.stack ? reason.stack : reason}`); } catch (_) {}
});

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
    if (config.print_queue_enabled && config.supabase_url && config.tenant_ids && config.tenant_ids.length > 0) {
      log(`Fila centralizada ATIVA — ${config.tenant_ids.length} tenant(s): ${config.tenant_ids.join(', ')}, polling a cada ${config.poll_interval_ms}ms`);
    }

    // Verificacao critica: tenant_id(s) nao pode(m) ser placeholder
    const tenantIds = config.tenant_ids || (config.tenant_id ? [config.tenant_id] : []);
    const hasValidTenant = tenantIds.length > 0 && tenantIds.every(function(tid) { return tid && tid.trim() !== '' && tid !== 'SEU-TENANT-ID-AQUI'; });
    if (!hasValidTenant) {
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

      let buf;
      if (Buffer.isBuffer(data)) {
        // Dados binarios ja prontos (ESC/POS pre-formatado pela edge function)
        buf = data;
      } else {
        // Modo legado: texto puro — converte pra CP860 e envolve com ESC/POS basico
        let finalData = data;
        if (data.indexOf('\x1B') === -1) {
          finalData = INIT + CP860 + '\n\n\n\n\n' + utf8ToCp860(data) + '\n\n\n\n\n' + CUT;
        }
        buf = Buffer.from(finalData, 'latin1');
      }

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

    const startTime = Date.now();
    log(`[HTTP] POST ${urlStr.split('?')[0].split('/').slice(-1).join('/')} (tenant: ${(body.tenant_id || '').slice(0, 8)}...)`);

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const elapsed = Date.now() - startTime;
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          log(`[HTTP] Resposta ${res.statusCode} em ${elapsed}ms`);
          try {
            const json = JSON.parse(data);
            if (!json.success) {
              log(`[HTTP] Edge function retornou success=false: ${json.error || 'sem detalhes'}`);
            }
            resolve(json);
          } catch (e) {
            resolve({ raw: data });
          }
        } else {
          const errMsg = `HTTP ${res.statusCode}: ${data.slice(0, 200)}`;
          log(`[HTTP] ERRO ${errMsg} (${elapsed}ms)`);
          reject(new Error(errMsg));
        }
      });
      res.on('error', (err) => {
        log(`[HTTP] Erro na resposta: ${err.message}`);
        reject(err);
      });
    });

    req.on('error', (err) => {
      const elapsed = Date.now() - startTime;
      log(`[HTTP] Erro de conexao apos ${elapsed}ms: ${err.message}`);
      reject(err);
    });
    req.on('timeout', () => {
      const elapsed = Date.now() - startTime;
      log(`[HTTP] Timeout apos ${elapsed}ms`);
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(bodyStr);
    req.end();
  });
}

// ============================================
// ESC/POS Formatter — LEGADO (apenas /print direto)
// ATENCAO: O layout de impressao da fila centralizada
// agora e gerado pela edge function print-queue-agent.
// Alteracoes de layout NAO exigem atualizar este arquivo.
// As funcoes abaixo sao mantidas apenas para o endpoint
// /print (modo ticket), que e um fallback legado.
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
const REVERSE_ON = GS + 'B\x01';
const REVERSE_OFF = GS + 'B\x00';

/** Seleciona code page 860 (Português) para acentuação correta */
const CP860 = ESC + '\x74\x03';

/**
 * Converte string UTF-8 para bytes CP860 (Code Page 860 — Português DOS).
 * Mapeia os acentos mais comuns do português; caracteres não mapeados
 * permanecem como estão (fallback para byte direto).
 */
function utf8ToCp860(str) {
  // NBSP (U+00A0) -> espaco normal. O toLocaleString('pt-BR',{currency}) do front
  // insere um NBSP entre "R$" e o valor; sem isto o byte 0xA0 saia impresso como
  // "a" acentuado (glifo 0xA0 da CP860), gerando "R$a8,00" nos comprovantes.
  str = str.replace(/\u00A0/g, ' ');
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

/** Converte nome de origem (ingles) para portugues */
const ORIGEM_PT = {
  'cashier': 'Caixa',
  'waiter': 'Garcom',
  'self_service': 'Autoatendimento',
  'delivery': 'Delivery',
  'table': 'Mesa',
  'mesa': 'Mesa',
};

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
    senha,
    participant_name,
    estacao,
    total,
    para_viagem,
  } = body;

  const origemDisplay = ORIGEM_PT[(origem || '').toLowerCase()] || origem;

  const papel = impressora?.papel || '80mm';
  const width = papel === '58mm' ? 32 : 48;
  const sep = '-'.repeat(width);
  const eqSep = '='.repeat(width);

  let out = INIT;
  out += CP860; // ativa code page 860 para acentos

  // --- Cabeçalho: NOME DA ESTACAO em destaque (quando ticket é splitado) ---
  if (estacao) {
    out += ALIGN_CENTER;
    out += BOLD_ON + DOUBLE_HEIGHT + utf8ToCp860(`>>> ${estacao.toUpperCase()} <<<`) + NORMAL + BOLD_OFF;
    out += LINE_FEED + LINE_FEED;
    out += utf8ToCp860(eqSep) + LINE_FEED;
  }

  // Cabecalho numero do pedido
  out += ALIGN_CENTER;
  out += BOLD_ON + DOUBLE_HEIGHT + utf8ToCp860(`PEDIDO #${numero || '---'}`) + NORMAL + BOLD_OFF;
  out += LINE_FEED + LINE_FEED;

  if (destino) {
    out += BOLD_ON + utf8ToCp860(`DESTINO: ${destino}`) + BOLD_OFF + LINE_FEED;
  }
  if (para_viagem) {
    out += ALIGN_CENTER;
    out += DOUBLE_HEIGHT + BOLD_ON + utf8ToCp860('>> PARA VIAGEM <<') + BOLD_OFF + NORMAL + LINE_FEED;
    out += ALIGN_LEFT;
    out += LINE_FEED;
  }
  if (origem) {
    out += utf8ToCp860(`Origem: ${origemDisplay}`) + LINE_FEED;
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

  // Senha em destaque com fundo preto (modo reverse)
  if (senha) {
    out += LINE_FEED;
    out += ALIGN_CENTER;
    out += REVERSE_ON;
    out += utf8ToCp860('                        ') + LINE_FEED;
    out += BOLD_ON + DOUBLE_HEIGHT + utf8ToCp860(`  SENHA ${senha}  `) + NORMAL + BOLD_OFF + LINE_FEED;
    out += utf8ToCp860('                        ') + LINE_FEED;
    out += REVERSE_OFF;
    out += LINE_FEED;
    out += ALIGN_LEFT;
  }

  // Nome do participante em destaque
  if (participant_name) {
    out += ALIGN_CENTER;
    out += BOLD_ON + utf8ToCp860(`>> ${participant_name} <<`) + BOLD_OFF + LINE_FEED;
    out += utf8ToCp860(sep) + LINE_FEED;
    out += ALIGN_LEFT;
    out += LINE_FEED;
  }

  // Itens
  itens.forEach((item) => {
    const qtd = item.quantidade || 1;
    const nome = item.nome || 'Item';
    const qtdStr = String(qtd).padStart(2, ' ');

    out += ALIGN_LEFT;
    out += BOLD_ON + utf8ToCp860(`${qtdStr}x ${nome}`) + BOLD_OFF + LINE_FEED;

    if (item.opcoes && item.opcoes.length > 0) {
      item.opcoes.forEach((opt) => {
        // Suporta tanto string (legado) quanto objeto { nome, obrigatorio }
        const nome = typeof opt === 'string' ? opt : opt.nome;
        const obrigatorio = typeof opt === 'object' && opt.obrigatorio;
        out += utf8ToCp860(`   ${obrigatorio ? '  ' : '+ '}${nome}`) + LINE_FEED;
      });
    }

    if (item.observacoes && item.observacoes.length > 0) {
      item.observacoes.forEach((obs) => {
        out += utf8ToCp860(`   * ${obs}`) + LINE_FEED;
      });
    }

    // Partes de produção em destaque (ex: hamburguer, batata)
    if (item.partes_destaque && item.partes_destaque.length > 0) {
      out += utf8ToCp860(sep) + LINE_FEED;
      out += BOLD_ON;
      item.partes_destaque.forEach((parte) => {
        out += DOUBLE_HEIGHT + utf8ToCp860(`>> ${parte.toUpperCase()} <<`) + NORMAL + LINE_FEED;
      });
      out += BOLD_OFF;
    }

    out += LINE_FEED;
  });

  // Total do pedido
  if (total !== undefined && total !== null && total > 0) {
    out += LINE_FEED;
    out += utf8ToCp860(sep) + LINE_FEED;
    out += ALIGN_RIGHT;
    out += DOUBLE_HEIGHT + BOLD_ON + utf8ToCp860(`TOTAL: R$ ${Number(total).toFixed(2).replace('.', ',')}`) + BOLD_OFF + NORMAL + LINE_FEED;
    out += ALIGN_LEFT;
  }

  out += utf8ToCp860(sep) + LINE_FEED;

  if (observacao_geral) {
    // Se for comprovante de entrega/retirada, formata sem label "OBS:"
    if (estacao && (estacao.toUpperCase().includes('COMPROVANTE') || estacao.toUpperCase().includes('RETIRADA'))) {
      out += utf8ToCp860(observacao_geral) + LINE_FEED;
      out += utf8ToCp860(sep) + LINE_FEED;
    } else {
      out += BOLD_ON + utf8ToCp860('OBS:') + BOLD_OFF + LINE_FEED;
      out += utf8ToCp860(observacao_geral) + LINE_FEED;
      out += utf8ToCp860(sep) + LINE_FEED;
    }
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
let rerunRequested = false;

/** Resolve a lista de tenant_ids validos (suporta tenant_ids[] ou tenant_id legado). */
function getValidTenantIds() {
  const tenantIds = (config.tenant_ids && config.tenant_ids.length > 0)
    ? config.tenant_ids
    : (config.tenant_id ? [config.tenant_id] : []);
  return tenantIds.filter(function (tid) {
    return tid && tid.trim() !== '' && tid !== 'SEU-TENANT-ID-AQUI';
  });
}

async function processPrintQueue() {
  // Se ja esta processando, marca para rodar de novo ao terminar (evita perder
  // tickets que chegam via realtime durante uma impressao em andamento).
  if (isProcessingQueue) { rerunRequested = true; return; }
  if (!config.print_queue_enabled || !config.supabase_url) {
    return;
  }

  // Resolve tenant IDs: tenant_ids array ou tenant_id legacy
  const tenantIds = (config.tenant_ids && config.tenant_ids.length > 0) ? config.tenant_ids : (config.tenant_id ? [config.tenant_id] : []);
  const validTenantIds = tenantIds.filter(function(tid) { return tid && tid.trim() !== '' && tid !== 'SEU-TENANT-ID-AQUI'; });

  if (validTenantIds.length === 0) return;

  isProcessingQueue = true;

  try {
    const functionUrl = config.supabase_url.replace(/\/$/, '') + '/functions/v1/print-queue-agent';

    for (const tenantId of validTenantIds) {
      try {
        log(`[Queue] Polling tenant: ${tenantId.slice(0,8)}...`);

        const result = await postJson(functionUrl, {
          action: 'poll',
          tenant_id: tenantId,
          limit: 10,
        }, 15000);

        if (!result.success) {
          log(`[Queue] Poll error tenant ${tenantId.slice(0,8)}...: ${result.error || 'unknown'}`);
          continue;
        }

        const tickets = result.tickets || [];
        if (tickets.length === 0) {
          // Silencioso — sem tickets pendentes é normal
          continue;
        }

        log(`[Queue] ${tickets.length} ticket(s) pendentes para tenant ${tenantId.slice(0,8)}...`);
        log(`[Queue] Tickets: ${tickets.map(function(t) { return '#' + t.order_number + '(' + (t.station_label || t.station_key || '?').slice(0,15) + ')'; }).join(', ')}`);

        for (const ticket of tickets) {
          try {
            log(`[Queue] Imprimindo ticket #${ticket.order_number} (${ticket.station_key})`);

            // ── ROTEAMENTO (v3.2): IP RESOLVIDO no ticket pela edge function ──
            // A edge `print-queue-agent` resolve impressora_id -> IP/porta/papel a
            // partir do printers_config (cadastrado no app) e manda isso no ticket.
            // O agente imprime nesse IP direto. O config.json local vira apenas
            // FALLBACK de compatibilidade — trocar impressora no app NAO exige mais
            // editar o config.json de cada PC.
            const requestedImpressoraId = ticket.impressora_id || ticket.payload?.impressora_id || '';

            let printerIp = ticket.impressora_ip || null;
            let printerPort = ticket.impressora_port || 9100;
            let printerName = ticket.impressora_nome || requestedImpressoraId || 'impressora';
            let papel = ticket.paper_style === '58mm' ? '58mm' : (ticket.paper_style || '80mm');
            let resolvedBy = 'ticket (printers_config)';

            if (!printerIp) {
              // Fallback: resolve pelo config.json local (modo antigo).
              const impressora = requestedImpressoraId ? findImpressora(requestedImpressoraId) : null;
              if (impressora) {
                printerIp = impressora.ip;
                printerPort = impressora.porta || 9100;
                printerName = impressora.nome || printerName;
                papel = impressora.papel || papel;
                resolvedBy = `config.json (id="${requestedImpressoraId}")`;
              }
            }

            if (!printerIp) {
              log(`[Queue] ERRO: ticket #${ticket.order_number} sem IP de impressora (nao resolvido pelo sistema nem no config.json; id="${requestedImpressoraId}", station=${ticket.station_key})`);
              await confirmTicket(ticket.id, 'failed', `Impressora nao resolvida (id="${requestedImpressoraId}")`);
              continue;
            }

            log(`[Queue] Impressora resolvida: ${printerName} (${printerIp}:${printerPort}) via ${resolvedBy}`);

            // ── USA ESC/POS PRE-FORMATADO PELA EDGE FUNCTION ──
            // O layout do ticket é gerado remotamente pela print-queue-agent.
            const b64Key = papel === '58mm' ? 'escpos_58mm_base64' : 'escpos_80mm_base64';
            const escPosBase64 = ticket[b64Key];

            if (!escPosBase64) {
              log(`[Queue] ERRO: ESC/POS pre-formatado ausente para ticket #${ticket.order_number} (papel=${papel})`);
              await confirmTicket(ticket.id, 'failed', `ESC/POS base64 nao disponivel (papel=${papel})`);
              continue;
            }

            const escPosBuffer = Buffer.from(escPosBase64, 'base64');
            log(`[Queue] ESC/POS decodificado: ${escPosBuffer.length} bytes (${papel}, via edge)`);

            // Imprime no IP resolvido (do ticket ou, em fallback, do config.json).
            let printed = false;
            try {
              await sendToPrinterTcp(printerIp, printerPort, escPosBuffer, config.default_timeout_ms || 10000);
              printed = true;
              log(`[Queue] Ticket #${ticket.order_number} impresso com sucesso (${printerName})`);
              await confirmTicket(ticket.id, 'printed');
            } catch (primaryErr) {
              const primaryMsg = primaryErr instanceof Error ? primaryErr.message : 'Erro desconhecido';
              log(`[Queue] Impressora (${printerName}) falhou: ${primaryMsg}`);

              if (!printed) {
                await confirmTicket(ticket.id, 'failed', primaryMsg);
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro desconhecido';
            log(`[Queue] ERRO ao imprimir ticket #${ticket.order_number}: ${msg}`);
            await confirmTicket(ticket.id, 'failed', msg);
          }
        }
      } catch (tenantErr) {
        log(`[Queue] Erro processando tenant ${tenantId.slice(0,8)}...: ${tenantErr.message}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    log(`[Queue] Erro no polling: ${msg}`);
  } finally {
    isProcessingQueue = false;
    // Algum ticket chegou enquanto processavamos? Roda mais uma rodada.
    if (rerunRequested) {
      rerunRequested = false;
      setTimeout(processPrintQueue, 100);
    }
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
  // polling_enabled !== false => polling "rapido" (rede de seguranca + fallback).
  // polling_enabled === false  => ainda rodamos um poll LENTO de seguranca, pra que
  // uma queda do Realtime nao pare a impressao ate alguem reiniciar na mao.
  const fast = config.polling_enabled !== false;
  const interval = fast
    ? (config.poll_interval_ms || 3000)
    : (config.safety_poll_interval_ms || 60000);
  log(`[Queue] Iniciando ${fast ? 'polling' : 'safety-net poll (modo Realtime)'} a cada ${interval}ms...`);
  pollingInterval = setInterval(processPrintQueue, interval);
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
// Realtime — impressao instantanea
// O banco (trigger trg_print_queue_notify) emite um broadcast
// 'new_job' no canal publico "print-jobs:<tenant_id>" a cada
// INSERT na print_queue. Aqui apenas escutamos esse aviso e
// disparamos um poll imediato (que ja busca/imprime/confirma).
// O polling continua ativo como rede de seguranca (fallback).
// ============================================

let supabaseClient = null;
let realtimeChannels = [];
let immediatePollTimer = null;
let realtimeWatchdog = null;
let lastRealtimeStart = 0;

function realtimeConnected() {
  return realtimeChannels.length > 0;
}

/** Agrupa varios avisos (1 pedido = varios tickets) em um unico poll. */
function scheduleImmediatePoll() {
  if (immediatePollTimer) return;
  immediatePollTimer = setTimeout(() => {
    immediatePollTimer = null;
    processPrintQueue();
  }, config.realtime_debounce_ms || 250);
}

function startRealtime() {
  if (config.realtime_enabled === false) {
    log('[Realtime] Desabilitado no config (realtime_enabled=false) — usando apenas polling');
    return;
  }
  if (!createClient) {
    log('[Realtime] Modulo @supabase/supabase-js ausente — rode "npm install" nesta pasta para ativar a impressao instantanea. Por enquanto usando apenas polling.');
    return;
  }
  if (!config.supabase_url || !config.supabase_anon_key) {
    log('[Realtime] supabase_url ou supabase_anon_key ausentes no config.json — Realtime desativado (usando polling).');
    return;
  }

  const tenantIds = getValidTenantIds();
  if (tenantIds.length === 0) {
    log('[Realtime] Nenhum tenant_id valido — Realtime desativado.');
    return;
  }

  try {
    supabaseClient = createClient(config.supabase_url, config.supabase_anon_key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: WS ? { transport: WS } : undefined,
    });
  } catch (e) {
    log(`[Realtime] Falha ao criar cliente Supabase: ${e.message} — usando apenas polling`);
    supabaseClient = null;
    return;
  }

  tenantIds.forEach((tid) => {
    const topic = `print-jobs:${tid}`;
    try {
      const channel = supabaseClient.channel(topic, { config: { private: false } });
      channel.on('broadcast', { event: 'new_job' }, (msg) => {
        const jid = msg && msg.payload && msg.payload.id ? String(msg.payload.id).slice(0, 8) : '?';
        log(`[Realtime] new_job tenant=${tid.slice(0, 8)}... job=${jid} -> imprimindo agora`);
        scheduleImmediatePoll();
      });
      channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          log(`[Realtime] Inscrito no canal print-jobs:${tid.slice(0, 8)}...`);
        } else if (status === 'CHANNEL_ERROR') {
          log(`[Realtime] Erro no canal ${tid.slice(0, 8)}...: ${err && err.message ? err.message : 'desconhecido'} (reconecta automaticamente)`);
        } else if (status === 'TIMED_OUT') {
          log(`[Realtime] Timeout no canal ${tid.slice(0, 8)}... — reconectando`);
        } else if (status === 'CLOSED') {
          log(`[Realtime] Canal ${tid.slice(0, 8)}... fechado`);
        }
      });
      realtimeChannels.push(channel);
    } catch (e) {
      log(`[Realtime] Erro ao inscrever no canal de ${tid.slice(0, 8)}...: ${e.message}`);
    }
  });

  lastRealtimeStart = Date.now();
  log(`[Realtime] ATIVO — escutando ${realtimeChannels.length} canal(is). Impressao dispara no momento do pedido.`);
}

// ============================================
// Watchdog do Realtime — reconecta socket "zumbi".
// Depois que o PC dorme/acorda ou a rede oscila, o websocket pode ficar
// aparentemente vivo mas sem receber nada. Aqui checamos o estado real dos
// canais; se algum nao estiver "joined", derrubamos e reabrimos a conexao
// (com backoff) e disparamos um poll pra recuperar o que ficou parado.
// (O safety-net poll ja garante a impressao; isto restaura a impressao INSTANTANEA.)
// ============================================
function realtimeUnhealthy() {
  if (realtimeChannels.length === 0) return true;
  for (const ch of realtimeChannels) {
    let st;
    try { st = ch && ch.state; } catch (_) { st = undefined; }
    // 'joined' = ok; 'joining' logo apos (re)conectar tambem e aceitavel.
    if (st !== 'joined' && st !== 'joining') return true;
  }
  return false;
}

function startRealtimeWatchdog() {
  if (realtimeWatchdog) return;
  if (config.realtime_enabled === false || !createClient) return;
  realtimeWatchdog = setInterval(() => {
    try {
      if (config.realtime_enabled === false || !createClient) return;
      if (getValidTenantIds().length === 0) return;
      // Backoff: nao reconecta nos primeiros ~30s apos um (re)start.
      if (Date.now() - lastRealtimeStart < 30000) return;
      if (realtimeUnhealthy()) {
        log('[Realtime] Watchdog: conexao nao saudavel (socket zumbi?) — reconectando...');
        stopRealtime();
        startRealtime();
        // recupera o que ficou parado durante a queda
        scheduleImmediatePoll();
      }
    } catch (e) {
      log(`[Realtime] Watchdog erro (ignorado): ${e && e.message ? e.message : e}`);
    }
  }, config.realtime_watchdog_ms || 60000);
}

function stopRealtimeWatchdog() {
  if (realtimeWatchdog) {
    clearInterval(realtimeWatchdog);
    realtimeWatchdog = null;
  }
}

function stopRealtime() {
  if (immediatePollTimer) {
    clearTimeout(immediatePollTimer);
    immediatePollTimer = null;
  }
  if (supabaseClient) {
    try {
      realtimeChannels.forEach((ch) => { try { supabaseClient.removeChannel(ch); } catch (_) {} });
      supabaseClient.realtime.disconnect();
    } catch (_) {}
  }
  realtimeChannels = [];
  supabaseClient = null;
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
      version: '3.3.0',
      impressoras_count: config.impressoras.length,
      config_loaded: fs.existsSync(CONFIG_PATH),
      queue_enabled: config.print_queue_enabled,
      queue_polling: !!pollingInterval,
      polling_enabled: config.polling_enabled !== false,
      safety_poll_interval_ms: config.safety_poll_interval_ms || 60000,
      realtime_enabled: config.realtime_enabled !== false,
      realtime_connected: realtimeConnected(),
      realtime_channels: realtimeChannels.length,
      realtime_healthy: realtimeConnected() ? !realtimeUnhealthy() : false,
      realtime_watchdog: !!realtimeWatchdog,
    });
    return;
  }

  // Status da fila
  if (pathname === '/queue-status' && req.method === 'GET') {
    const tids = (config.tenant_ids && config.tenant_ids.length > 0) ? config.tenant_ids : (config.tenant_id ? [config.tenant_id] : []);
    sendJson(res, 200, {
      enabled: config.print_queue_enabled,
      polling: !!pollingInterval,
      realtime_connected: realtimeConnected(),
      realtime_channels: realtimeChannels.length,
      tenant_ids: tids,
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
          if (!body.ip) {
            sendJson(res, 400, { success: false, error: `Impressora "${impressora_id}" nao configurada no agente` });
            return;
          }
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
  log(`ERPOS Print Agent v3.3.0`);
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
  const tenantIds = (config.tenant_ids && config.tenant_ids.length > 0) ? config.tenant_ids : (config.tenant_id ? [config.tenant_id] : []);
  const validTenantIds = tenantIds.filter(function(tid) { return tid && tid.trim() !== '' && tid !== 'SEU-TENANT-ID-AQUI'; });

  if (config.print_queue_enabled && config.supabase_url && validTenantIds.length > 0) {
    // polling_enabled=false => modo "so Realtime": imprime no instante do pedido
    // (broadcast new_job), sem ficar batendo na edge function a cada X segundos.
    const pollingEnabled = config.polling_enabled !== false;
    log('');
    log('>>> FILA CENTRALIZADA ATIVA <<<');
    if (pollingEnabled) {
      log(`    Polling (fallback) a cada ${config.poll_interval_ms}ms para ${validTenantIds.length} tenant(s)`);
    } else {
      log(`    Modo Realtime — impressao instantanea + safety-net poll a cada ${config.safety_poll_interval_ms || 60000}ms para ${validTenantIds.length} tenant(s)`);
    }
    validTenantIds.forEach(function(tid) { log(`      - ${tid.slice(0,8)}...`); });
    log(`    Edge Function: ${config.supabase_url}/functions/v1/print-queue-agent`);
    log('');
    // SEMPRE inicia um poll (rapido se polling_enabled, lento como rede de seguranca
    // se modo Realtime). Garante que uma queda do Realtime nunca pare a impressao
    // ate alguem reiniciar na mao — causa raiz do "todo dia preciso reiniciar".
    startQueuePolling();
    startRealtime();
    startRealtimeWatchdog();
  } else if (config.print_queue_enabled && (!config.supabase_url || validTenantIds.length === 0)) {
    log('');
    log('!!! AVISO: print_queue_enabled=true mas configuracao incompleta !!!');
    log('    Verifique no config.json: supabase_url e tenant_ids');
    log('');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  stopRealtimeWatchdog();
  stopRealtime();
  stopQueuePolling();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  log('Shutting down...');
  stopRealtimeWatchdog();
  stopRealtime();
  stopQueuePolling();
  server.close(() => process.exit(0));
});
