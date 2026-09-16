// nfse-write — módulo "Notas de Serviço" (NFS-e pela API do Emissor Nacional / Sefin Nacional).
//
// Ações (POST JSON, JWT do usuário; exige módulo 'nfse' liberado):
//   criar_empresa      { dados }                          → cria a empresa e torna o usuário admin dela
//   salvar_empresa     { empresa_id, dados }              admin
//   salvar_certificado { empresa_id, pfx_b64, senha }     admin — valida no relay e guarda no Vault
//   testar_conexao     { empresa_id }                     consulta o convênio do município com o certificado
//   parametros_servico { empresa_id, c_trib_nac }         alíquota/regras do município para o serviço
//   emitir             { empresa_id, ... }                monta a DPS, assina e transmite (síncrono)
//   reconsultar        { nota_id }                        nota em erro/processando: procura a DPS na Sefin
//   cancelar           { nota_id, codigo, motivo }        evento 101101
//   adicionar_membro   { empresa_id, email, papel }       admin
//   remover_membro     { empresa_id, user_id }            admin
//
// Por que o relay: a Sefin exige mTLS e derruba o Deno/rustls. A assinatura XMLDSig e a conexão
// com o certificado rodam no Vercel (nfse-relay/api/sefin.js); aqui ficam regras e banco.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const DONO_EMAIL = 'natalinojr.engel@gmail.com';
const VER_APLIC = 'ERPOS-NFSe-1.0';
const NS = 'http://www.sped.fazenda.gov.br/nfse';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const fail = (msg: string, status = 400, extra?: Record<string, unknown>) => json({ success: false, error: msg, ...(extra ?? {}) }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'nfse-write', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const texto = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
// Remove quebras/controle que a Sefin rejeita e limita o tamanho.
const limpo = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s*\n\s*/g, ' | ').trim().slice(0, max);
const tag = (nome: string, valor: string | number | null | undefined) =>
  valor === null || valor === undefined || valor === '' ? '' : `<${nome}>${esc(String(valor))}</${nome}>`;
const dec = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

// Horário de Brasília no formato AAAA-MM-DDThh:mm:ss-03:00.
function dataHoraBR(d: Date) {
  const br = new Date(d.getTime() - 3 * 3600_000);
  return br.toISOString().slice(0, 19) + '-03:00';
}
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

function cnpjValido(c: string) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const calc = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12));
  const d2 = calc(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}
function cpfValido(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (base: string, peso: number) => {
    const soma = base.split('').reduce((s, d, i) => s + Number(d) * (peso - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(c.slice(0, 9), 10);
  const d2 = dv(c.slice(0, 9) + d1, 11);
  return c.endsWith(`${d1}${d2}`);
}

// ─── Relay ───────────────────────────────────────────────────────────────────
type RelayResp = { ok: boolean; error?: string; http?: number; json?: any; texto?: string; erro_rede?: string; xml_assinado?: string; cert?: any };

async function relay(body: Record<string, unknown>): Promise<RelayResp> {
  const url = Deno.env.get('NFSE_RELAY_URL') ?? '';
  const key = Deno.env.get('NFSE_RELAY_KEY') ?? '';
  if (!url || !key) return { ok: false, error: 'Relay da NFS-e não configurado no servidor' };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-relay-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(65_000),
    });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, error: `Relay respondeu HTTP ${r.status}` };
    return j as RelayResp;
  } catch (e) {
    return { ok: false, error: `Falha ao chamar o relay: ${String((e as Error)?.message ?? e)}` };
  }
}

async function certDaEmpresa(admin: SupabaseClient, empresaId: string) {
  const { data, error } = await admin.rpc('fn_nfse_cert_get', { p_empresa: empresaId });
  if (error) throw new Error(`Leitura do certificado: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.pfx_b64 || row?.senha == null) throw new Error('Certificado A1 não cadastrado para esta empresa');
  return { pfx_b64: row.pfx_b64 as string, senha: row.senha as string };
}

// Normaliza a lista de erros da Sefin (o formato varia entre rotas/versões).
function errosSefin(r: RelayResp): { codigo: string | null; descricao: string; complemento?: string | null }[] {
  if (!r.ok) return [{ codigo: null, descricao: r.error ?? 'Falha no relay' }];
  if (r.erro_rede) return [{ codigo: null, descricao: `Sem resposta da Sefin Nacional: ${r.erro_rede}` }];
  if (r.http === 403) {
    return [{ codigo: '403', descricao: 'A Sefin Nacional recusou o certificado (verifique se é o A1 ICP-Brasil da empresa, válido e com a senha certa).' }];
  }
  const j = r.json;
  const lista = j?.erros ?? j?.Erros ?? j?.erro ?? j?.mensagens ?? null;
  const arr = Array.isArray(lista) ? lista : lista ? [lista] : [];
  const out = arr.map((e: any) => ({
    codigo: e?.codigo ?? e?.Codigo ?? null,
    descricao: String(e?.descricao ?? e?.Descricao ?? e?.mensagem ?? e?.message ?? JSON.stringify(e)),
    complemento: e?.complemento ?? e?.Complemento ?? null,
  }));
  if (out.length) return out;
  if (j?.message || j?.title) return [{ codigo: String(j?.status ?? r.http ?? ''), descricao: String(j.message ?? j.title) }];
  return [{ codigo: String(r.http ?? ''), descricao: r.texto ? `HTTP ${r.http}: ${r.texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)}` : `HTTP ${r.http}` }];
}

const campoXml = (xml: string | null | undefined, nome: string) => {
  if (!xml) return null;
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}>([^<]*)</(?:\\w+:)?${nome}>`));
  return m ? m[1] : null;
};

// ─── DPS ─────────────────────────────────────────────────────────────────────
function montarDps(emp: any, nota: any, tomador: any | null) {
  const tpInsc = '2'; // CNPJ
  const idDps = `DPS${emp.cod_municipio}${tpInsc}${emp.cnpj}${String(emp.serie).padStart(5, '0')}${String(nota.numero_dps).padStart(15, '0')}`;

  const endereco = (p: any) => {
    if (!p?.cod_municipio || !p?.cep || !p?.logradouro || !p?.numero || !p?.bairro) return '';
    return `<end><endNac>${tag('cMun', p.cod_municipio)}${tag('CEP', soDigitos(p.cep))}</endNac>${tag('xLgr', limpo(p.logradouro, 255))}${tag('nro', limpo(p.numero, 60))}${tag('xCpl', p.complemento ? limpo(p.complemento, 156) : null)}${tag('xBairro', limpo(p.bairro, 60))}</end>`;
  };

  const prest = `<prest>${tag('CNPJ', emp.cnpj)}${tag('IM', emp.inscricao_municipal ? limpo(emp.inscricao_municipal, 15) : null)}${tag('fone', soDigitos(emp.fone).length >= 6 ? soDigitos(emp.fone) : null)}${tag('email', emp.email ? limpo(emp.email, 80) : null)}<regTrib>${tag('opSimpNac', emp.op_simp_nac)}${emp.op_simp_nac === 3 ? tag('regApTribSN', emp.reg_ap_trib_sn ?? 1) : ''}${tag('regEspTrib', emp.reg_esp_trib ?? 0)}</regTrib></prest>`;

  let toma = '';
  if (tomador) {
    const doc = soDigitos(tomador.documento);
    toma = `<toma>${doc.length === 14 ? tag('CNPJ', doc) : tag('CPF', doc)}${tag('IM', tomador.inscricao_municipal ? limpo(tomador.inscricao_municipal, 15) : null)}${tag('xNome', limpo(tomador.nome, 300))}${endereco(tomador)}${tag('fone', soDigitos(tomador.fone).length >= 6 ? soDigitos(tomador.fone) : null)}${tag('email', tomador.email ? limpo(tomador.email, 80) : null)}</toma>`;
  }

  const serv = `<serv><locPrest>${tag('cLocPrestacao', nota.cod_municipio_prestacao)}</locPrest><cServ>${tag('cTribNac', nota.c_trib_nac)}${tag('cTribMun', nota.c_trib_mun)}${tag('xDescServ', limpo(nota.descricao, 2000))}${tag('cNBS', nota.c_nbs)}</cServ>${nota.info_complementar ? `<infoCompl>${tag('xInfComp', limpo(nota.info_complementar, 2000))}</infoCompl>` : ''}</serv>`;

  const desconto = Number(nota.desconto_incondicionado ?? 0);
  // Totais aproximados (Lei 12.741). Regras E0710–E0713: indTotTrib só para MEI; pTotTribSN só para ME/EPP;
  // ME/EPP sem alíquota informada e Não Optante vão com pTotTrib zerado (o DANFSe mostra "-").
  const zerado = '<totTrib><pTotTrib><pTotTribFed>0.00</pTotTribFed><pTotTribEst>0.00</pTotTribEst><pTotTribMun>0.00</pTotTribMun></pTotTrib></totTrib>';
  let totTrib: string;
  if (emp.op_simp_nac === 2) totTrib = '<totTrib><indTotTrib>0</indTotTrib></totTrib>';
  else if (emp.op_simp_nac === 3 && emp.aliquota_simples != null) totTrib = `<totTrib>${tag('pTotTribSN', dec(Number(emp.aliquota_simples)))}</totTrib>`;
  else totTrib = zerado;
  const valores = `<valores><vServPrest>${tag('vServ', dec(Number(nota.valor_servico)))}</vServPrest>${desconto > 0 ? `<vDescCondIncond>${tag('vDescIncond', dec(desconto))}</vDescCondIncond>` : ''}<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>${nota.iss_retido ? 2 : 1}</tpRetISSQN>${nota.aliquota_iss != null ? tag('pAliq', dec(Number(nota.aliquota_iss))) : ''}</tribMun>${totTrib}</trib></valores>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NS}" versao="1.01"><infDPS Id="${idDps}">${tag('tpAmb', nota.ambiente)}${tag('dhEmi', dataHoraBR(new Date(nota.dh_emissao)))}${tag('verAplic', VER_APLIC)}${tag('serie', emp.serie)}${tag('nDPS', nota.numero_dps)}${tag('dCompet', nota.competencia)}<tpEmit>1</tpEmit>${tag('cLocEmi', emp.cod_municipio)}${prest}${toma}${serv}${valores}</infDPS></DPS>`;
  return { idDps, xml };
}

// Aplica o retorno de POST /nfse (ou da consulta) na nota.
async function aplicarRetorno(admin: SupabaseClient, notaId: string, r: RelayResp, extra: Record<string, unknown> = {}) {
  const j = r.json ?? {};
  const chave: string | null = j.chaveAcesso ?? j.ChaveAcesso ?? null;
  const xmlNfse: string | null = j.nfseXml ?? j.NfseXml ?? null;
  const agora = new Date().toISOString();
  if (r.ok && !r.erro_rede && r.http && r.http >= 200 && r.http < 300 && (chave || xmlNfse)) {
    const upd = {
      status: 'autorizada',
      chave_acesso: chave ?? (xmlNfse?.match(/Id="NFS(\d{50})"/)?.[1] ?? null),
      numero_nfse: campoXml(xmlNfse, 'nNFSe'),
      dh_processamento: j.dataHoraProcessamento ?? campoXml(xmlNfse, 'dhProc') ?? agora,
      xml_nfse: xmlNfse,
      alertas: j.alertas ?? null,
      erros: null,
      resposta_http: r.http,
      updated_at: agora,
      ...extra,
    };
    await admin.from('nfse_notas').update(upd).eq('id', notaId);
    return { status: 'autorizada' as const, ...upd };
  }
  // Sem resposta (rede/timeout/5xx): não dá para saber se a Sefin gerou a nota → 'erro' (reconsultável).
  const incerto = !r.ok || Boolean(r.erro_rede) || !r.http || r.http >= 500;
  const status = incerto ? 'erro' : 'rejeitada';
  const erros = errosSefin(r);
  await admin.from('nfse_notas').update({ status, erros, alertas: j?.alertas ?? null, resposta_http: r.http ?? null, updated_at: agora, ...extra }).eq('id', notaId);
  return { status, erros };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail('Unauthorized', 401);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: ud, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !ud?.user) return fail('Unauthorized', 401);
  const user = ud.user;
  const dono = (user.email ?? '').toLowerCase() === DONO_EMAIL;
  if (!dono) {
    const { data: acc } = await admin.from('user_module_access').select('module').eq('user_id', user.id).eq('module', 'nfse').maybeSingle();
    if (!acc) return fail('Sem acesso ao módulo Notas de Serviço', 403);
  }

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return fail('JSON inválido'); }
  const action = String(body.action ?? '');

  const papelNa = async (empresaId: string) => {
    const { data } = await admin.from('nfse_empresa_membros').select('papel').eq('empresa_id', empresaId).eq('user_id', user.id).maybeSingle();
    return (data?.papel as string | undefined) ?? null;
  };
  const exigirMembro = async (empresaId: unknown, adminOnly = false) => {
    if (typeof empresaId !== 'string' || !empresaId) throw new HttpErr('empresa_id obrigatório', 400);
    const papel = await papelNa(empresaId);
    if (!papel) throw new HttpErr('Você não participa desta empresa', 403);
    if (adminOnly && papel !== 'admin') throw new HttpErr('Apenas administradores da empresa podem fazer isso', 403);
    const { data: emp, error } = await admin.from('nfse_empresas').select('*').eq('id', empresaId).single();
    if (error || !emp) throw new HttpErr('Empresa não encontrada', 404);
    return emp as any;
  };

  try {
    // ── criar_empresa / salvar_empresa ──
    if (action === 'criar_empresa' || action === 'salvar_empresa') {
      const d = (body.dados ?? {}) as Record<string, unknown>;
      const row: Record<string, unknown> = {
        cnpj: soDigitos(d.cnpj),
        razao_social: texto(d.razao_social),
        nome_fantasia: texto(d.nome_fantasia),
        inscricao_municipal: texto(d.inscricao_municipal),
        cod_municipio: soDigitos(d.cod_municipio),
        municipio_nome: texto(d.municipio_nome),
        uf: texto(d.uf)?.toUpperCase() ?? null,
        cep: soDigitos(d.cep) || null,
        logradouro: texto(d.logradouro),
        numero: texto(d.numero),
        complemento: texto(d.complemento),
        bairro: texto(d.bairro),
        fone: soDigitos(d.fone) || null,
        email: texto(d.email),
        op_simp_nac: Number(d.op_simp_nac ?? 3),
        reg_ap_trib_sn: Number(d.op_simp_nac ?? 3) === 3 ? Number(d.reg_ap_trib_sn ?? 1) : null,
        reg_esp_trib: Number(d.reg_esp_trib ?? 0),
        ambiente: Number(d.ambiente ?? 2) === 1 ? 1 : 2,
        serie: Number(d.serie ?? 1),
        aliquota_simples: d.aliquota_simples === '' || d.aliquota_simples == null ? null : Number(d.aliquota_simples),
        updated_at: new Date().toISOString(),
      };
      if (!cnpjValido(row.cnpj as string)) return fail('CNPJ inválido');
      if (!row.razao_social) return fail('Informe a razão social');
      if (!/^\d{7}$/.test(row.cod_municipio as string)) return fail('Código IBGE do município deve ter 7 dígitos');
      if (![1, 2, 3].includes(row.op_simp_nac as number)) return fail('Situação no Simples Nacional inválida');
      if (!Number.isInteger(row.serie) || (row.serie as number) < 1 || (row.serie as number) > 49999) return fail('Série deve ficar entre 1 e 49999');
      if (row.op_simp_nac === 3 && row.aliquota_simples != null && !((row.aliquota_simples as number) >= 0 && (row.aliquota_simples as number) < 100)) return fail('Alíquota do Simples inválida');

      if (action === 'criar_empresa') {
        const { data: emp, error } = await admin.from('nfse_empresas').insert({ ...row, created_by: user.id }).select('id').single();
        if (error) return fail(error.code === '23505' ? 'Já existe uma empresa com este CNPJ no sistema' : error.message, error.code === '23505' ? 409 : 500);
        const { error: mErr } = await admin.from('nfse_empresa_membros').insert({ empresa_id: emp.id, user_id: user.id, papel: 'admin' });
        if (mErr) { await admin.from('nfse_empresas').delete().eq('id', emp.id); return fail(mErr.message, 500); }
        log('INFO', action, 'empresa criada', { empresa_id: emp.id, user: user.id });
        return json({ success: true, data: { id: emp.id } });
      }
      const emp = await exigirMembro(body.empresa_id, true);
      if (row.cnpj !== emp.cnpj) {
        const { count } = await admin.from('nfse_notas').select('id', { count: 'exact', head: true }).eq('empresa_id', emp.id);
        if ((count ?? 0) > 0) return fail('Não é possível trocar o CNPJ de uma empresa que já emitiu notas');
      }
      const { error } = await admin.from('nfse_empresas').update(row).eq('id', emp.id);
      if (error) return fail(error.code === '23505' ? 'Já existe uma empresa com este CNPJ no sistema' : error.message, 500);
      return json({ success: true });
    }

    // ── salvar_certificado ──
    if (action === 'salvar_certificado') {
      const emp = await exigirMembro(body.empresa_id, true);
      const pfx = String(body.pfx_b64 ?? '').replace(/^data:[^,]*,/, '');
      const senha = typeof body.senha === 'string' ? body.senha : '';
      if (!pfx || pfx.length < 500) return fail('Envie o arquivo .pfx do certificado A1');
      if (pfx.length > 200_000) return fail('Arquivo grande demais para um certificado A1');
      const r = await relay({ op: 'cert_info', pfx_b64: pfx, senha });
      if (!r.ok || !r.cert) return fail(r.error ?? 'Não foi possível ler o certificado');
      const c = r.cert as { titular: string; documento: string | null; validade_inicio: string; validade_fim: string };
      if (new Date(c.validade_fim).getTime() < Date.now()) return fail(`Certificado vencido em ${new Date(c.validade_fim).toLocaleDateString('pt-BR')}`);
      if (c.documento && c.documento.length === 14 && c.documento.slice(0, 8) !== emp.cnpj.slice(0, 8)) {
        return fail(`O certificado é do CNPJ ${c.documento}, diferente do CNPJ da empresa (${emp.cnpj})`);
      }
      const { error } = await admin.rpc('fn_nfse_cert_set', {
        p_empresa: emp.id, p_pfx_b64: pfx, p_senha: senha, p_titular: c.titular, p_documento: c.documento, p_validade: c.validade_fim,
      });
      if (error) return fail(`Não foi possível guardar o certificado: ${error.message}`, 500);
      log('INFO', action, 'certificado salvo', { empresa_id: emp.id, validade: c.validade_fim });
      return json({ success: true, data: c });
    }

    // ── testar_conexao / parametros_servico ──
    if (action === 'testar_conexao' || action === 'parametros_servico') {
      const emp = await exigirMembro(body.empresa_id);
      const cert = await certDaEmpresa(admin, emp.id);
      const cTrib = action === 'parametros_servico' ? soDigitos(body.c_trib_nac) : undefined;
      if (action === 'parametros_servico' && !/^\d{6}$/.test(cTrib ?? '')) return fail('Código de tributação nacional deve ter 6 dígitos');
      const r = await relay({ op: 'parametros', ambiente: emp.ambiente, cod_municipio: emp.cod_municipio, c_trib_nac: cTrib, ...cert });
      const conectou = r.ok && !r.erro_rede && r.http !== 403 && (r.http ?? 0) > 0;
      if (!conectou) return json({ success: false, error: errosSefin(r)[0]?.descricao ?? 'Falha', http: r.http ?? null });
      return json({ success: true, http: r.http, data: r.json ?? null, erros: r.http && r.http >= 400 ? errosSefin(r) : null });
    }

    // ── emitir ──
    if (action === 'emitir') {
      const emp = await exigirMembro(body.empresa_id);
      if (!emp.cert_pfx_secret) return fail('Cadastre o certificado A1 da empresa antes de emitir');

      const valor = Number(body.valor_servico);
      if (!(valor > 0)) return fail('Informe o valor do serviço');
      const desconto = body.desconto_incondicionado ? Number(body.desconto_incondicionado) : 0;
      if (desconto < 0 || desconto >= valor) return fail('Desconto inválido');
      const cTribNac = soDigitos(body.c_trib_nac);
      if (!/^\d{6}$/.test(cTribNac)) return fail('Código de tributação nacional deve ter 6 dígitos');
      const cTribMun = soDigitos(body.c_trib_mun) || null;
      if (cTribMun && !/^\d{3}$/.test(cTribMun)) return fail('Código de tributação municipal deve ter 3 dígitos');
      const cNbs = soDigitos(body.c_nbs) || null;
      if (cNbs && !/^\d{9}$/.test(cNbs)) return fail('Código NBS deve ter 9 dígitos');
      const descricao = texto(body.descricao);
      if (!descricao) return fail('Descreva o serviço prestado');
      const aliq = body.aliquota_iss === '' || body.aliquota_iss == null ? null : Number(body.aliquota_iss);
      if (aliq != null && !(aliq >= 0 && aliq <= 5)) return fail('Alíquota do ISS deve ficar entre 0 e 5%');
      const hoje = hojeBR();
      const competencia = /^\d{4}-\d{2}-\d{2}$/.test(String(body.competencia ?? '')) ? String(body.competencia) : hoje;
      if (competencia > hoje) return fail('A competência não pode ser futura');
      const locPrest = soDigitos(body.cod_municipio_prestacao) || emp.cod_municipio;
      if (!/^\d{7}$/.test(locPrest)) return fail('Município da prestação inválido');

      let tomador: any = null;
      if (body.tomador_id) {
        const { data: t } = await admin.from('nfse_tomadores').select('*').eq('id', body.tomador_id).eq('empresa_id', emp.id).maybeSingle();
        if (!t) return fail('Tomador não encontrado');
        const doc = soDigitos(t.documento);
        if (doc.length === 14 ? !cnpjValido(doc) : !cpfValido(doc)) return fail(`CPF/CNPJ do tomador inválido (${doc})`);
        tomador = t;
      }

      const ambiente = Number(emp.ambiente) === 1 ? 1 : 2;
      const { data: numero, error: nErr } = await admin.rpc('fn_nfse_reservar_dps', { p_empresa: emp.id, p_ambiente: ambiente });
      if (nErr || !numero) return fail(`Não foi possível reservar o número da DPS: ${nErr?.message ?? ''}`, 500);

      // dhEmi alguns segundos no passado: a Sefin rejeita emissão "depois" do processamento (E0008).
      const notaBase = {
        empresa_id: emp.id,
        ambiente,
        status: 'processando',
        serie: emp.serie,
        numero_dps: Number(numero),
        competencia,
        dh_emissao: new Date(Date.now() - 60_000).toISOString(),
        tomador_id: tomador?.id ?? null,
        tomador: tomador ? { documento: tomador.documento, nome: tomador.nome, email: tomador.email, municipio: tomador.municipio_nome, uf: tomador.uf } : null,
        servico_id: body.servico_id || null,
        c_trib_nac: cTribNac,
        c_trib_mun: cTribMun,
        c_nbs: cNbs,
        descricao,
        cod_municipio_prestacao: locPrest,
        valor_servico: valor,
        desconto_incondicionado: desconto > 0 ? desconto : null,
        aliquota_iss: aliq,
        iss_retido: Boolean(body.iss_retido),
        info_complementar: texto(body.info_complementar),
        created_by: user.id,
      };
      const { idDps, xml } = montarDps(emp, notaBase, tomador);
      const { data: nota, error: iErr } = await admin.from('nfse_notas').insert({ ...notaBase, id_dps: idDps, xml_dps: xml }).select('id').single();
      if (iErr) return fail(`Não foi possível registrar a nota: ${iErr.message}`, 500);

      const cert = await certDaEmpresa(admin, emp.id);
      const r = await relay({ op: 'emitir', ambiente, xml, ...cert });
      const res = await aplicarRetorno(admin, nota.id, r, r.xml_assinado ? { xml_dps: r.xml_assinado } : {});
      log(res.status === 'autorizada' ? 'INFO' : 'WARN', action, `nota ${res.status}`, { nota_id: nota.id, http: r.http, erros: (res as any).erros });
      return json({ success: res.status === 'autorizada', nota_id: nota.id, ...res });
    }

    // ── reconsultar ──
    if (action === 'reconsultar') {
      const { data: nota } = await admin.from('nfse_notas').select('*').eq('id', body.nota_id).maybeSingle();
      if (!nota) return fail('Nota não encontrada', 404);
      const emp = await exigirMembro(nota.empresa_id);
      const cert = await certDaEmpresa(admin, emp.id);
      let chave = nota.chave_acesso as string | null;
      if (!chave) {
        const d = await relay({ op: 'dps', ambiente: nota.ambiente, id_dps: nota.id_dps, ...cert });
        chave = d.json?.chaveAcesso ?? d.json?.ChaveAcesso ?? null;
        if (!chave) {
          if (d.ok && d.http === 404) {
            if (nota.status === 'processando' || nota.status === 'erro') {
              await admin.from('nfse_notas').update({ status: 'rejeitada', erros: [{ codigo: null, descricao: 'A Sefin Nacional não gerou NFS-e para esta DPS. Emita de novo.' }], updated_at: new Date().toISOString() }).eq('id', nota.id);
            }
            return json({ success: false, status: 'rejeitada', error: 'A Sefin Nacional não tem NFS-e para esta DPS' });
          }
          return json({ success: false, status: nota.status, error: errosSefin(d)[0]?.descricao ?? 'Não foi possível consultar' });
        }
      }
      const c = await relay({ op: 'consultar', ambiente: nota.ambiente, chave, ...cert });
      if (!c.json) c.json = {};
      c.json.chaveAcesso = c.json.chaveAcesso ?? chave;
      if (nota.status === 'cancelada') {
        return json({ success: true, status: 'cancelada' });
      }
      const res = await aplicarRetorno(admin, nota.id, c);
      return json({ success: res.status === 'autorizada', ...res });
    }

    // ── cancelar ──
    if (action === 'cancelar') {
      const { data: nota } = await admin.from('nfse_notas').select('*').eq('id', body.nota_id).maybeSingle();
      if (!nota) return fail('Nota não encontrada', 404);
      const emp = await exigirMembro(nota.empresa_id, true);
      if (nota.status !== 'autorizada' || !nota.chave_acesso) return fail('Só é possível cancelar nota autorizada');
      const codigo = String(body.codigo ?? '');
      if (!['1', '2', '9'].includes(codigo)) return fail('Escolha o motivo do cancelamento');
      const motivo = limpo(String(body.motivo ?? ''), 255);
      if (motivo.length < 15) return fail('Descreva o motivo com pelo menos 15 caracteres');
      const xml = `<?xml version="1.0" encoding="UTF-8"?><pedRegEvento xmlns="${NS}" versao="1.01"><infPedReg Id="PRE${nota.chave_acesso}101101">${tag('tpAmb', nota.ambiente)}${tag('verAplic', VER_APLIC)}${tag('dhEvento', dataHoraBR(new Date(Date.now() - 60_000)))}${tag('CNPJAutor', emp.cnpj)}${tag('chNFSe', nota.chave_acesso)}<e101101><xDesc>Cancelamento de NFS-e</xDesc>${tag('cMotivo', codigo)}${tag('xMotivo', motivo)}</e101101></infPedReg></pedRegEvento>`;
      const cert = await certDaEmpresa(admin, emp.id);
      const r = await relay({ op: 'evento', ambiente: nota.ambiente, chave: nota.chave_acesso, xml, ...cert });
      if (r.ok && !r.erro_rede && r.http && r.http >= 200 && r.http < 300) {
        const agora = new Date().toISOString();
        await admin.from('nfse_notas').update({
          status: 'cancelada', cancelada_em: agora, cancel_codigo: codigo, cancel_motivo: motivo,
          xml_cancelamento: r.json?.eventoXml ?? r.xml_assinado ?? null, updated_at: agora,
        }).eq('id', nota.id);
        log('INFO', action, 'nota cancelada', { nota_id: nota.id });
        return json({ success: true, status: 'cancelada' });
      }
      const erros = errosSefin(r);
      log('WARN', action, 'cancelamento recusado', { nota_id: nota.id, http: r.http, erros });
      return json({ success: false, error: erros.map((e) => (e.codigo ? `${e.codigo}: ` : '') + e.descricao).join(' · '), erros });
    }

    // ── membros ──
    if (action === 'adicionar_membro') {
      const emp = await exigirMembro(body.empresa_id, true);
      const email = String(body.email ?? '').trim().toLowerCase();
      const papel = body.papel === 'emissor' ? 'emissor' : 'admin';
      if (!email.includes('@')) return fail('Informe o e-mail do usuário');
      const { data: u } = await admin.from('users').select('id').ilike('email', email).is('deleted_at', null).maybeSingle();
      const uid = u?.id as string | undefined;
      if (!uid) return fail('Nenhum usuário do ERPOS com este e-mail');
      // Upsert trocaria o papel: evita o admin se rebaixar sem querer e a empresa ficar sem administrador.
      if (uid === user.id) return fail('Você já participa desta empresa. Não é possível alterar o próprio papel.');
      if (papel === 'emissor') {
        const { data: atual } = await admin.from('nfse_empresa_membros').select('papel').eq('empresa_id', emp.id).eq('user_id', uid).maybeSingle();
        if (atual?.papel === 'admin') {
          const { count } = await admin.from('nfse_empresa_membros').select('user_id', { count: 'exact', head: true }).eq('empresa_id', emp.id).eq('papel', 'admin');
          if ((count ?? 0) <= 1) return fail('A empresa precisa de pelo menos um administrador.');
        }
      }
      const { error: iErr } = await admin.from('nfse_empresa_membros').upsert({ empresa_id: emp.id, user_id: uid, papel }, { onConflict: 'empresa_id,user_id' });
      if (iErr) return fail(iErr.message, 500);
      const { data: acc } = await admin.from('user_module_access').select('module').eq('user_id', uid).eq('module', 'nfse').maybeSingle();
      return json({ success: true, aviso: acc ? null : 'O usuário ainda não tem o módulo liberado (Admin Master › Módulos).' });
    }
    if (action === 'remover_membro') {
      const emp = await exigirMembro(body.empresa_id, true);
      if (body.user_id === user.id) return fail('Você não pode remover a si mesmo');
      await admin.from('nfse_empresa_membros').delete().eq('empresa_id', emp.id).eq('user_id', body.user_id);
      return json({ success: true });
    }

    return fail(`Ação desconhecida: ${action}`);
  } catch (e) {
    if (e instanceof HttpErr) return fail(e.message, e.status);
    log('ERROR', action, String((e as Error)?.message ?? e));
    return fail(String((e as Error)?.message ?? e), 500);
  }
});

class HttpErr extends Error {
  constructor(message: string, public status: number) { super(message); }
}
