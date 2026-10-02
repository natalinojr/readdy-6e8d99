// Cliente SMTP mínimo para mandar e-mail com anexo pelo servidor da própria loja (2026-10-02).
//
// Só TLS direto (porta 465): o Supabase bloqueia as portas 25 e 587 nas Edge Functions, então
// STARTTLS não é opção. Gmail, Zoho, Hostinger, Locaweb e afins aceitam 465.
// Fluxo: saudação 220 → EHLO → AUTH PLAIN (ou LOGIN) → MAIL FROM → RCPT TO → DATA → QUIT.
// O corpo e os anexos vão em base64 (linhas de 76), então nenhuma linha começa com "." — o
// dot-stuffing fica só por garantia.

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;      // login e endereço do remetente
  senha: string;
  nomeRemetente?: string | null;
}

export interface Anexo { nome: string; tipo: string; bytes: Uint8Array }

export interface Mensagem {
  para: string[];
  cc?: string[];
  assunto: string;
  texto: string;
  anexos?: Anexo[];
}

/** Erro com o código SMTP e um texto pronto para a tela. */
export class SmtpErro extends Error {
  constructor(msg: string, public codigo: number | null = null) { super(msg); }
}

const PRAZO_MS = 25_000;
const enc = new TextEncoder();

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64Texto = (t: string) => base64(enc.encode(t));
const quebrar76 = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n');
/** Cabeçalho com acento (RFC 2047). ASCII puro vai como está. */
const cabecalho = (t: string) => (/^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${b64Texto(t)}?=`);

function comPrazo<T>(p: Promise<T>, ms: number, oQue: string): Promise<T> {
  let timer: number | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new SmtpErro(`O servidor de e-mail não respondeu (${oQue}).`)), ms); }),
  ]);
}

class Conexao {
  private buf = '';
  private dec = new TextDecoder();
  constructor(private conn: Deno.TlsConn) {}

  private async linha(): Promise<string> {
    while (true) {
      const i = this.buf.indexOf('\r\n');
      if (i >= 0) { const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2); return l; }
      const chunk = new Uint8Array(8192);
      const n = await comPrazo(this.conn.read(chunk), PRAZO_MS, 'leitura');
      if (n === null) throw new SmtpErro('O servidor de e-mail fechou a conexão.');
      this.buf += this.dec.decode(chunk.subarray(0, n), { stream: true });
    }
  }

  async resposta(): Promise<{ codigo: number; texto: string }> {
    const linhas: string[] = [];
    while (true) {
      const l = await this.linha();
      linhas.push(l);
      if (l.length < 4 || l[3] !== '-') break;
    }
    return { codigo: Number(linhas[linhas.length - 1].slice(0, 3)) || 0, texto: linhas.map((l) => l.slice(4)).join(' ') };
  }

  async escrever(t: string): Promise<void> {
    const bytes = enc.encode(t);
    let off = 0;
    while (off < bytes.length) off += await comPrazo(this.conn.write(bytes.subarray(off)), PRAZO_MS, 'envio');
  }

  /** Manda um comando e exige um dos códigos esperados. */
  async comando(cmd: string, esperado: number[], oQue: string): Promise<{ codigo: number; texto: string }> {
    await this.escrever(cmd + '\r\n');
    const r = await this.resposta();
    if (!esperado.includes(r.codigo)) throw new SmtpErro(traduzir(r.codigo, r.texto, oQue), r.codigo);
    return r;
  }

  fechar() { try { this.conn.close(); } catch { /* já fechada */ } }
}

function traduzir(codigo: number, texto: string, oQue: string): string {
  const t = texto.slice(0, 200);
  if (oQue === 'login' && (codigo === 535 || codigo === 534 || codigo === 530)) {
    return 'O servidor recusou o usuário ou a senha do e-mail. No Gmail é preciso usar uma "senha de app" (16 letras), não a senha normal da conta.';
  }
  if (oQue === 'destinatário') return `O servidor recusou um destinatário (${codigo}: ${t}). Confira os e-mails da contabilidade.`;
  if (codigo === 552 || /size|too large|tamanho/i.test(texto)) return `O servidor recusou o tamanho da mensagem (${codigo}: ${t}).`;
  return `O servidor de e-mail recusou (${oQue}) — ${codigo}: ${t}`;
}

function montarMensagem(cfg: SmtpConfig, msg: Mensagem): string {
  const dominio = cfg.user.split('@')[1] || 'erpos.local';
  const fronteira = `erpos-${crypto.randomUUID()}`;
  // Nome com acento ou caractere especial de endereço (",<>@;:) vai sempre codificado.
  const nome = cfg.nomeRemetente?.trim() ?? '';
  const de = nome ? `${/^[A-Za-z0-9 .'_-]+$/.test(nome) ? nome : `=?UTF-8?B?${b64Texto(nome)}?=`} <${cfg.user}>` : cfg.user;
  const h = [
    `From: ${de}`,
    `To: ${msg.para.join(', ')}`,
    ...(msg.cc?.length ? [`Cc: ${msg.cc.join(', ')}`] : []),
    `Subject: ${cabecalho(msg.assunto)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${dominio}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${fronteira}"`,
  ];
  const partes = [
    [`--${fronteira}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', quebrar76(b64Texto(msg.texto))].join('\r\n'),
    ...(msg.anexos ?? []).map((a) => [
      `--${fronteira}`,
      `Content-Type: ${a.tipo}; name="${a.nome}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.nome}"`,
      '',
      quebrar76(base64(a.bytes)),
    ].join('\r\n')),
  ];
  return h.join('\r\n') + '\r\n\r\n' + partes.join('') + `--${fronteira}--\r\n`;
}

export async function enviarEmail(cfg: SmtpConfig, msg: Mensagem): Promise<void> {
  if (cfg.port === 25 || cfg.port === 587) {
    throw new SmtpErro('Use a porta 465 (SSL). As portas 25 e 587 são bloqueadas no servidor do ERPOS.');
  }
  const destinos = [...msg.para, ...(msg.cc ?? [])];
  if (!destinos.length) throw new SmtpErro('Nenhum destinatário.');

  let tls: Deno.TlsConn;
  try {
    tls = await comPrazo(Deno.connectTls({ hostname: cfg.host, port: cfg.port }), PRAZO_MS, 'conexão');
  } catch (e) {
    if (e instanceof SmtpErro) throw e;
    throw new SmtpErro(`Não consegui conectar em ${cfg.host}:${cfg.port} (${(e as Error).message || 'sem resposta'}). Confira o servidor e a porta.`);
  }
  const c = new Conexao(tls);
  try {
    const saudacao = await c.resposta();
    if (saudacao.codigo !== 220) throw new SmtpErro(traduzir(saudacao.codigo, saudacao.texto, 'saudação'), saudacao.codigo);
    const ehlo = await c.comando('EHLO erpos', [250], 'EHLO');
    const auth = /AUTH[ =]([^\n]*)/i.exec(ehlo.texto)?.[1]?.toUpperCase() ?? '';
    if (/PLAIN/.test(auth) || !/LOGIN/.test(auth)) {
      await c.comando(`AUTH PLAIN ${b64Texto(`\u0000${cfg.user}\u0000${cfg.senha}`)}`, [235], 'login');
    } else {
      await c.comando('AUTH LOGIN', [334], 'login');
      await c.comando(b64Texto(cfg.user), [334], 'login');
      await c.comando(b64Texto(cfg.senha), [235], 'login');
    }
    await c.comando(`MAIL FROM:<${cfg.user}>`, [250], 'remetente');
    for (const d of destinos) await c.comando(`RCPT TO:<${d}>`, [250, 251], 'destinatário');
    await c.comando('DATA', [354], 'DATA');
    const corpo = montarMensagem(cfg, msg).replace(/\r\n\./g, '\r\n..');
    await c.escrever(corpo);
    await c.comando('.', [250], 'mensagem');
    await c.escrever('QUIT\r\n').catch(() => {});
  } finally {
    c.fechar();
  }
}
