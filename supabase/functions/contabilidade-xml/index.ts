// contabilidade-xml — envio automático dos XMLs fiscais para a contabilidade (2026-10-02).
//
// Configurações › Fiscal › "Envio de XML para a contabilidade". Todo mês, no dia escolhido, junta
// os XMLs do mês ANTERIOR num ZIP e manda por e-mail, saindo do e-mail da própria loja (SMTP 465):
//   NFC-e/      NFC-e emitidas em PRODUÇÃO (autorizadas; canceladas com prefixo CANCELADA-)
//   NFe-entrada/  NF-e de fornecedores (fiscal_inbound_documents modelo 55; cancelada = sefaz_status 2)
//   NFSe-tomada/  NFS-e de serviços tomados (modelo 10)
//   resumo.csv  uma linha por documento (para a contabilidade conferir)
// O ZIP fica no bucket contabilidade-docs (xml/<loja>/<AAAA-MM>/<envio>.zip) e cada tentativa vira
// uma linha em fiscal_xml_envios.
//
// Ações (POST JSON):
//   get      { tenant_id }                       → config (sem senha) + histórico + prévia do mês anterior
//   salvar   { tenant_id, config, senha? }       → admin/gerente
//   testar_email   { tenant_id }                 → e-mail de teste para o próprio remetente (admin/gerente)
//   enviar_xml_mes { tenant_id, competencia:'AAAA-MM' } → manda agora para a contabilidade (admin/gerente)
//   baixar   { tenant_id, envio_id }             → link assinado (5 min) do ZIP enviado
//   cron     {}  (x-internal-key)                → lojas ligadas no dia: manda o mês anterior
//
// Regras do automático: só a partir do dia_envio; nada se o mês já foi enviado (ou estava vazio);
// no máximo 1 tentativa por dia e 3 tentativas com erro por mês (depois só pelo "Enviar agora").
// Publicada com --no-verify-jwt: a checagem é feita aqui (tenant-auth / FISCAL_INTERNAL_KEY).
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { zipSync, strToU8 } from 'npm:fflate@0.8.2';
import { authenticate, isContabilidadeRole, isFinanceiroRole, isManagerRole, tenantRole } from '../_shared/tenant-auth.ts';
import { enviarEmail, SmtpErro } from './smtp.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status = 400) => json({ success: false, error: msg }, status);
// Erro de preenchimento/servidor de e-mail: 200 com success:false (a tela mostra; não é falha do sistema).
const falha = (msg: string) => json({ success: false, error: msg });
const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, fn: 'contabilidade-xml', msg, ...extra }));

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
const BUCKET = 'contabilidade-docs';
const MAX_ANEXO = 18 * 1024 * 1024;   // Gmail aceita 25 MB já em base64
const PAGINA = 500;
const MAX_ERROS_AUTO = 3;

const CONFIG_COLS = 'tenant_id, enabled, contador_nome, destinatarios, copia, dia_envio, incluir_nfce, incluir_nfe_entrada, incluir_nfse_tomada, mensagem, smtp_host, smtp_port, smtp_user, smtp_from_name, smtp_senha_secret, updated_at';
const ENVIO_COLS = 'id, competencia, origem, status, destinatarios, qtd_nfce, qtd_nfce_canceladas, qtd_nfe_entrada, qtd_nfse_tomada, tamanho_bytes, arquivo_path, erro, enviado_por, created_at';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const emailOk = (e: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e);
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Data de hoje no horário de Brasília (sem horário de verão desde 2019). */
function hojeBRT(): { ano: number; mes: number; dia: number; iso: string } {
  const d = new Date(Date.now() - 3 * 3600_000);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), iso: d.toISOString().slice(0, 10) };
}
const competenciaAnterior = (ano: number, mes: number) => (mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`);
function limites(comp: string): { ini: string; fim: string } {
  const [a, m] = comp.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return { ini: `${comp}-01T00:00:00-03:00`, fim: `${prox}-01T00:00:00-03:00` };
}
const nomeMes = (comp: string) => { const [a, m] = comp.split('-').map(Number); return `${MESES[m - 1]}/${a}`; };
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/') : '');
const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// ── Coleta ──────────────────────────────────────────────────────────────────
async function paginar(q: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await q().range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return out;
  }
}

async function contar(admin: any, tenantId: string, comp: string) {
  const { ini, fim } = limites(comp);
  const base = (t: string) => admin.from(t).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('emitted_at', ini).lt('emitted_at', fim).not('xml', 'is', null);
  const [a, c, e, s] = await Promise.all([
    base('fiscal_documents').eq('environment', 1).eq('status', 'authorized'),
    base('fiscal_documents').eq('environment', 1).eq('status', 'cancelled'),
    base('fiscal_inbound_documents').eq('xml_status', 'full').neq('modelo', 10),
    base('fiscal_inbound_documents').eq('xml_status', 'full').eq('modelo', 10),
  ]);
  return { competencia: comp, qtd_nfce: a.count ?? 0, qtd_nfce_canceladas: c.count ?? 0, qtd_nfe_entrada: e.count ?? 0, qtd_nfse_tomada: s.count ?? 0 };
}

interface Pacote {
  zip: Uint8Array;
  qtd_nfce: number; qtd_nfce_canceladas: number; qtd_nfe_entrada: number; qtd_nfse_tomada: number;
  total_nfce: number;
}

async function montarZip(admin: any, tenantId: string, comp: string, cfg: any): Promise<Pacote> {
  const { ini, fim } = limites(comp);
  const arquivos: Record<string, Uint8Array> = {};
  const csv: string[] = ['tipo;situacao;numero;serie;data;valor;emitente;chave'];
  const p: Pacote = { zip: new Uint8Array(), qtd_nfce: 0, qtd_nfce_canceladas: 0, qtd_nfe_entrada: 0, qtd_nfse_tomada: 0, total_nfce: 0 };
  const valor = (v: unknown) => (Number(v) || 0).toFixed(2).replace('.', ',');

  if (cfg.incluir_nfce) {
    const docs = await paginar(() => admin.from('fiscal_documents')
      .select('id, chave, numero, serie, status, xml, total_amount, emitted_at')
      .eq('tenant_id', tenantId).eq('environment', 1).in('status', ['authorized', 'cancelled']).not('xml', 'is', null)
      .gte('emitted_at', ini).lt('emitted_at', fim).order('emitted_at').order('id'));
    for (const d of docs) {
      const cancelada = d.status === 'cancelled';
      arquivos[`NFC-e/${cancelada ? 'CANCELADA-' : ''}NFCe-${d.chave ?? `${d.serie}-${d.numero}`}.xml`] = strToU8(d.xml);
      if (cancelada) p.qtd_nfce_canceladas++; else { p.qtd_nfce++; p.total_nfce += Number(d.total_amount) || 0; }
      csv.push(['NFC-e emitida', cancelada ? 'cancelada' : 'autorizada', d.numero ?? '', d.serie ?? '', dataBR(d.emitted_at), valor(d.total_amount), '', d.chave ?? ''].join(';'));
    }
  }

  if (cfg.incluir_nfe_entrada || cfg.incluir_nfse_tomada) {
    const docs = await paginar(() => admin.from('fiscal_inbound_documents')
      .select('id, chave, modelo, numero, serie, emitente_nome, emitente_cnpj, valor_total, sefaz_status, xml, emitted_at')
      .eq('tenant_id', tenantId).eq('xml_status', 'full').not('xml', 'is', null)
      .gte('emitted_at', ini).lt('emitted_at', fim).order('emitted_at').order('id'));
    for (const d of docs) {
      const nfse = Number(d.modelo) === 10;
      if (nfse ? !cfg.incluir_nfse_tomada : !cfg.incluir_nfe_entrada) continue;
      const cancelada = Number(d.sefaz_status) === 2;
      const pasta = nfse ? 'NFSe-tomada' : 'NFe-entrada';
      arquivos[`${pasta}/${cancelada ? 'CANCELADA-' : ''}${nfse ? 'NFSe' : 'NFe'}-${d.chave}.xml`] = strToU8(d.xml);
      if (nfse) p.qtd_nfse_tomada++; else p.qtd_nfe_entrada++;
      const emit = `${String(d.emitente_nome ?? '').replace(/[;\r\n]/g, ' ')} ${soDigitos(d.emitente_cnpj)}`.trim();
      csv.push([nfse ? 'NFS-e tomada' : 'NF-e de entrada', cancelada ? 'cancelada' : 'autorizada', d.numero ?? '', d.serie ?? '', dataBR(d.emitted_at), valor(d.valor_total), emit, d.chave ?? ''].join(';'));
    }
  }

  if (csv.length > 1) arquivos['resumo.csv'] = strToU8('﻿' + csv.join('\r\n') + '\r\n');
  p.zip = csv.length > 1 ? zipSync(arquivos, { level: 6 }) : new Uint8Array();
  return p;
}

// ── Envio ───────────────────────────────────────────────────────────────────
async function lerConfig(admin: any, tenantId: string): Promise<any | null> {
  const { data, error } = await admin.from('fiscal_xml_envio_config').select(CONFIG_COLS).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function smtpDe(admin: any, cfg: any) {
  if (!cfg?.smtp_host || !cfg?.smtp_user) throw new SmtpErro('Preencha o servidor e o e-mail que envia.');
  const { data: senha, error } = await admin.rpc('fn_xml_envio_senha_get', { p_tenant: cfg.tenant_id });
  if (error) throw new Error(error.message);
  if (!senha) throw new SmtpErro('Falta a senha do e-mail que envia.');
  return { host: String(cfg.smtp_host).trim(), port: Number(cfg.smtp_port) || 465, user: String(cfg.smtp_user).trim(), senha: String(senha), nomeRemetente: cfg.smtp_from_name };
}

async function dadosLoja(admin: any, tenantId: string) {
  const [{ data: t }, { data: f }] = await Promise.all([
    admin.from('tenants').select('name, cnpj').eq('id', tenantId).maybeSingle(),
    admin.from('fiscal_settings').select('razao_social').eq('tenant_id', tenantId).maybeSingle(),
  ]);
  const cnpj = soDigitos(t?.cnpj);
  return {
    nome: String(f?.razao_social || t?.name || 'Loja'),
    apelido: String(t?.name || f?.razao_social || 'Loja'),
    cnpj,
    cnpjFmt: cnpj.length === 14 ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '',
  };
}

async function enviarCompetencia(admin: any, cfg: any, comp: string, origem: 'automatico' | 'manual', userId: string | null) {
  const tenantId = cfg.tenant_id as string;
  const registrar = async (campos: Record<string, unknown>) => {
    const { data, error } = await admin.from('fiscal_xml_envios')
      .insert({ tenant_id: tenantId, competencia: `${comp}-01`, origem, enviado_por: userId, destinatarios: [...(cfg.destinatarios ?? []), ...(cfg.copia ?? [])], ...campos })
      .select(ENVIO_COLS).single();
    if (error) log('WARN', 'registrar envio', { error: error.message });
    return data;
  };

  try {
    if (!(cfg.destinatarios ?? []).length) throw new SmtpErro('Cadastre pelo menos um e-mail da contabilidade.');
    const smtp = await smtpDe(admin, cfg);
    const p = await montarZip(admin, tenantId, comp, cfg);
    const qtds = { qtd_nfce: p.qtd_nfce, qtd_nfce_canceladas: p.qtd_nfce_canceladas, qtd_nfe_entrada: p.qtd_nfe_entrada, qtd_nfse_tomada: p.qtd_nfse_tomada };
    if (!p.zip.length) return { ok: true, envio: await registrar({ status: 'vazio', ...qtds }) };

    const loja = await dadosLoja(admin, tenantId);
    const nomeZip = `XML-${ascii(loja.apelido) || 'loja'}${loja.cnpj ? `-${loja.cnpj}` : ''}-${comp}.zip`;
    const path = `xml/${tenantId}/${comp}/${crypto.randomUUID()}.zip`;
    // Cópia do que foi enviado (botão Baixar do histórico). Anexo: guarda DEPOIS de enviar, para
    // tentativa com erro não deixar arquivo. Grande demais para anexo: guarda antes e manda o link.
    const guardar = async () => {
      const up = await admin.storage.from(BUCKET).upload(path, p.zip, { contentType: 'application/zip', upsert: false });
      if (up.error) log('WARN', 'zip não guardado', { tenantId, comp, error: up.error.message, bytes: p.zip.length });
      return !up.error;
    };

    let link = '';
    let guardado = false;
    if (p.zip.length > MAX_ANEXO) {
      guardado = await guardar();
      if (!guardado) throw new SmtpErro(`O arquivo do mês ficou grande demais (${(p.zip.length / 1048576).toFixed(1)} MB) para ir por e-mail.`);
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 30 * 86400, { download: nomeZip });
      link = data?.signedUrl ?? '';
      if (!link) throw new Error('não consegui gerar o link do arquivo');
    }

    const itens = [
      cfg.incluir_nfce ? `• NFC-e emitidas: ${p.qtd_nfce} autorizada(s)${p.qtd_nfce_canceladas ? ` e ${p.qtd_nfce_canceladas} cancelada(s)` : ''} — total ${brl(p.total_nfce)}` : '',
      cfg.incluir_nfe_entrada ? `• NF-e de entrada (fornecedores): ${p.qtd_nfe_entrada}` : '',
      cfg.incluir_nfse_tomada ? `• NFS-e tomadas (serviços): ${p.qtd_nfse_tomada}` : '',
    ].filter(Boolean);
    const texto = [
      `Olá${cfg.contador_nome ? `, ${String(cfg.contador_nome).trim()}` : ''}!`,
      '',
      `Seguem os XMLs de ${nomeMes(comp)} de ${loja.nome}${loja.cnpjFmt ? ` (CNPJ ${loja.cnpjFmt})` : ''}.`,
      '',
      ...itens,
      '',
      ...(cfg.mensagem ? [String(cfg.mensagem).trim(), ''] : []),
      link
        ? `O arquivo passou do limite de anexo. Baixe por este link (vale 30 dias):\n${link}`
        : `Vai em anexo o arquivo ${nomeZip}, com uma planilha resumo.csv para conferência.`,
      '',
      '—',
      'Envio automático do ERPOS. Para falar com a loja, responda este e-mail.',
    ].join('\n');

    await enviarEmail(smtp, {
      para: cfg.destinatarios,
      cc: cfg.copia ?? [],
      assunto: `XMLs fiscais ${comp.split('-').reverse().join('/')} — ${loja.apelido}`,
      texto,
      anexos: link ? [] : [{ nome: nomeZip, tipo: 'application/zip', bytes: p.zip }],
    });
    if (!link) guardado = await guardar();
    const envio = await registrar({ status: 'enviado', ...qtds, tamanho_bytes: p.zip.length, arquivo_path: guardado ? path : null });
    log('INFO', 'enviado', { tenantId, comp, origem, bytes: p.zip.length, ...qtds });
    return { ok: true, envio };
  } catch (e) {
    const msg = e instanceof SmtpErro ? e.message : `Falha ao montar ou enviar: ${(e as Error).message}`;
    log('ERROR', 'envio falhou', { tenantId, comp, origem, error: (e as Error).message });
    return { ok: false, error: msg, envio: await registrar({ status: 'erro', erro: msg.slice(0, 500) }) };
  }
}

async function cron(admin: any) {
  const hoje = hojeBRT();
  const comp = competenciaAnterior(hoje.ano, hoje.mes);
  const { data: cfgs, error } = await admin.from('fiscal_xml_envio_config').select(CONFIG_COLS).eq('enabled', true);
  if (error) throw new Error(error.message);
  const resultado: Record<string, string> = {};
  for (const cfg of cfgs ?? []) {
    try {
      if (hoje.dia < Number(cfg.dia_envio)) { resultado[cfg.tenant_id] = 'antes do dia'; continue; }
      const { data: envios } = await admin.from('fiscal_xml_envios').select('status, origem, created_at')
        .eq('tenant_id', cfg.tenant_id).eq('competencia', `${comp}-01`);
      const lista = envios ?? [];
      if (lista.some((e: any) => e.status === 'enviado' || e.status === 'vazio')) { resultado[cfg.tenant_id] = 'já enviado'; continue; }
      const autos = lista.filter((e: any) => e.origem === 'automatico');
      if (autos.some((e: any) => dataBR(e.created_at) === dataBR(new Date().toISOString()))) { resultado[cfg.tenant_id] = 'já tentou hoje'; continue; }
      if (autos.filter((e: any) => e.status === 'erro').length >= MAX_ERROS_AUTO) { resultado[cfg.tenant_id] = 'parado após erros'; continue; }
      const r = await enviarCompetencia(admin, cfg, comp, 'automatico', null);
      resultado[cfg.tenant_id] = r.ok ? (r.envio?.status ?? 'ok') : `erro: ${r.error}`;
    } catch (e) {
      resultado[cfg.tenant_id] = `erro: ${(e as Error).message}`;
    }
  }
  return { competencia: comp, resultado };
}

// ── Validação do que vem da tela ────────────────────────────────────────────
function limparEmails(v: unknown, campo: string, max: number): string[] {
  const lista = (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  const unicos = [...new Set(lista)];
  const ruim = unicos.find((e) => !emailOk(e));
  if (ruim) throw new SmtpErro(`E-mail inválido em ${campo}: ${ruim}`);
  if (unicos.length > max) throw new SmtpErro(`No máximo ${max} e-mails em ${campo}.`);
  return unicos;
}

function validarConfig(c: any) {
  const dia = Math.trunc(Number(c?.dia_envio));
  if (!(dia >= 1 && dia <= 28)) throw new SmtpErro('O dia do envio vai de 1 a 28.');
  const porta = Math.trunc(Number(c?.smtp_port) || 465);
  if (porta === 25 || porta === 587) throw new SmtpErro('Use a porta 465 (SSL). As portas 25 e 587 são bloqueadas no servidor do ERPOS.');
  const user = String(c?.smtp_user ?? '').trim().toLowerCase();
  if (user && !emailOk(user)) throw new SmtpErro('O e-mail que envia está inválido.');
  const out = {
    enabled: !!c?.enabled,
    contador_nome: String(c?.contador_nome ?? '').trim().slice(0, 120) || null,
    destinatarios: limparEmails(c?.destinatarios, 'Para', 5),
    copia: limparEmails(c?.copia, 'Cópia', 5),
    dia_envio: dia,
    incluir_nfce: c?.incluir_nfce !== false,
    incluir_nfe_entrada: c?.incluir_nfe_entrada !== false,
    incluir_nfse_tomada: c?.incluir_nfse_tomada !== false,
    mensagem: String(c?.mensagem ?? '').trim().slice(0, 1000) || null,
    smtp_host: String(c?.smtp_host ?? '').trim().toLowerCase().slice(0, 120) || null,
    smtp_port: porta,
    smtp_user: user || null,
    smtp_from_name: String(c?.smtp_from_name ?? '').trim().slice(0, 80) || null,
  };
  if (out.enabled) {
    if (!out.destinatarios.length) throw new SmtpErro('Para ligar o envio, cadastre o e-mail da contabilidade.');
    if (!out.smtp_host || !out.smtp_user) throw new SmtpErro('Para ligar o envio, preencha o e-mail que envia e o servidor.');
    if (!out.incluir_nfce && !out.incluir_nfe_entrada && !out.incluir_nfse_tomada) throw new SmtpErro('Escolha pelo menos um tipo de nota.');
  }
  return out;
}

const semSegredo = (cfg: any) => {
  if (!cfg) return null;
  const { smtp_senha_secret, ...resto } = cfg;
  return { ...resto, tem_senha: !!smtp_senha_secret };
};
const envioPublico = (e: any) => (e ? { ...e, arquivo_path: undefined, tem_arquivo: !!e.arquivo_path } : e);

// ── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return erro('Method not allowed', 405);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: any;
  try { body = await req.json(); } catch { return erro('JSON inválido'); }
  const action = String(body?.action ?? '');

  try {
    if (action === 'cron') {
      const interno = internalKey.length >= 20 && (req.headers.get('x-internal-key') ?? '') === internalKey;
      if (!interno) return erro('Não autorizado', 401);
      const r = await cron(admin);
      log('INFO', 'cron', r);
      return json({ success: true, ...r });
    }

    const caller = await authenticate(req, admin);
    if (!caller?.userId) return erro('Faça login de novo.', 401);
    const tenantId = String(body?.tenant_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return erro('Loja inválida.');
    const role = await tenantRole(admin, caller.userId, tenantId);
    const podeVer = isFinanceiroRole(role) || isContabilidadeRole(role);
    const podeEditar = isManagerRole(role);
    if (!podeVer) return erro('Sem acesso a esta loja.', 403);

    if (action === 'get') {
      const hoje = hojeBRT();
      const [cfg, { data: envios }, previa, { data: t }] = await Promise.all([
        lerConfig(admin, tenantId),
        admin.from('fiscal_xml_envios').select(ENVIO_COLS).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(24),
        contar(admin, tenantId, competenciaAnterior(hoje.ano, hoje.mes)),
        admin.from('tenants').select('email').eq('id', tenantId).maybeSingle(),
      ]);
      return json({ success: true, data: { config: semSegredo(cfg), envios: (envios ?? []).map(envioPublico), previa, hoje: hoje.iso, email_loja: t?.email ?? null, pode_editar: podeEditar } });
    }

    if (action === 'previa') {
      const comp = String(body?.competencia ?? '');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(comp)) return erro('Mês inválido.');
      return json({ success: true, data: await contar(admin, tenantId, comp) });
    }

    if (action === 'baixar') {
      const { data: e } = await admin.from('fiscal_xml_envios').select('arquivo_path, competencia').eq('id', String(body?.envio_id ?? '')).eq('tenant_id', tenantId).maybeSingle();
      if (!e?.arquivo_path) return erro('Arquivo não encontrado.', 404);
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(e.arquivo_path, 300, { download: `XML-${String(e.competencia).slice(0, 7)}.zip` });
      if (error || !data?.signedUrl) throw new Error(error?.message ?? 'link');
      return json({ success: true, url: data.signedUrl });
    }

    if (!podeEditar) return erro('Só administrador ou gerente altera o envio para a contabilidade.', 403);

    if (action === 'salvar') {
      let limpo;
      try { limpo = validarConfig(body?.config); } catch (e) { return falha((e as Error).message); }
      // A senha de app do Gmail aparece em 4 blocos com espaço; nos outros servidores espaço pode ser da senha.
      const senhaBruta = String(body?.senha ?? '');
      const senha = /gmail|googlemail/.test(limpo.smtp_host ?? '') ? senhaBruta.replace(/\s+/g, '') : senhaBruta.trim();
      const { data: atual } = await admin.from('fiscal_xml_envio_config').select('smtp_senha_secret').eq('tenant_id', tenantId).maybeSingle();
      if (limpo.enabled && !senha && !atual?.smtp_senha_secret) return falha('Para ligar o envio, informe a senha do e-mail que envia.');
      const { error } = await admin.from('fiscal_xml_envio_config')
        .upsert({ tenant_id: tenantId, ...limpo, updated_by: caller.userId, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
      if (error) throw new Error(error.message);
      if (senha) {
        const r = await admin.rpc('fn_xml_envio_senha_set', { p_tenant: tenantId, p_senha: senha.slice(0, 200) });
        if (r.error) throw new Error(r.error.message);
      }
      return json({ success: true, data: { config: semSegredo(await lerConfig(admin, tenantId)) } });
    }

    if (action === 'testar_email') {
      const cfg = await lerConfig(admin, tenantId);
      try {
        const smtp = await smtpDe(admin, cfg);
        const loja = await dadosLoja(admin, tenantId);
        await enviarEmail(smtp, {
          para: [smtp.user],
          assunto: `Teste do envio de XML — ${loja.apelido}`,
          texto: `Este é um e-mail de teste do ERPOS.\n\nSe chegou, o e-mail ${smtp.user} está pronto para mandar os XMLs de ${loja.nome} para a contabilidade (${(cfg.destinatarios ?? []).join(', ') || 'nenhum e-mail cadastrado ainda'}).`,
        });
        return json({ success: true, data: { enviado_para: smtp.user } });
      } catch (e) {
        return falha(e instanceof SmtpErro ? e.message : `Falha no teste: ${(e as Error).message}`);
      }
    }

    if (action === 'enviar_xml_mes') {
      const comp = String(body?.competencia ?? '');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(comp)) return erro('Mês inválido.');
      const hoje = hojeBRT();
      if (comp >= `${hoje.ano}-${String(hoje.mes).padStart(2, '0')}`) return falha('Só dá para enviar meses que já fecharam.');
      const cfg = await lerConfig(admin, tenantId);
      if (!cfg) return falha('Salve a configuração antes de enviar.');
      const r = await enviarCompetencia(admin, cfg, comp, 'manual', caller.userId);
      if (!r.ok) return json({ success: false, error: r.error, data: { envio: envioPublico(r.envio) } });
      return json({ success: true, data: { envio: envioPublico(r.envio) } });
    }

    return erro('Ação desconhecida');
  } catch (e) {
    log('ERROR', 'falha', { action, error: (e as Error).message });
    return erro(`Erro: ${(e as Error).message}`, 500);
  }
});
