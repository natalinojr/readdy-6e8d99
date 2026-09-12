// hiring-cv-scan — lê um currículo (PDF ou foto) e devolve os dados do candidato
// estruturados para o módulo Contratação. Só extrai: quem grava é a tela
// (tabela hiring_candidates + bucket curriculos, ambos com RLS pelo e-mail do dono).
//
// POST JSON { file_base64, media_type }
// Autenticação: JWT do usuário; só o e-mail do dono (admin master) pode usar.
// Secret necessário: ANTHROPIC_API_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const OWNER_EMAIL = 'natalinojr.engel@gmail.com';
// Mesmo modelo da leitura de notinhas (custo baixo). Se a extração vier fraca, trocar para 'claude-sonnet-5'.
const MODEL = 'claude-haiku-4-5';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'hiring-cv-scan', level, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

// Sem campos anulável/anyOf: a API limita a 16 parâmetros com union por schema
// ("Schemas contains too many parameters with union types"). Ausente = "" (texto),
// 0 (número) ou "indefinido" (enum); normalize() converte para null antes de devolver.
const nStr = { type: 'string' };
const nInt = { type: 'integer' };
const nBool = { type: 'string', enum: ['sim', 'nao', 'indefinido'] };
const strArr = { type: 'array', items: { type: 'string' } };

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legivel', 'nome', 'email', 'telefone', 'cidade', 'bairro', 'data_nascimento', 'idade', 'cargo_pretendido',
    'resumo', 'experiencias', 'formacao', 'habilidades', 'idiomas', 'cursos', 'disponibilidade', 'pretensao_salarial',
    'cnh', 'experiencia_food_service', 'tempo_experiencia_meses', 'pontos_fortes', 'pontos_atencao', 'avisos'],
  properties: {
    legivel: { type: 'boolean' },
    nome: nStr,
    email: nStr,
    telefone: nStr,
    cidade: nStr,
    bairro: nStr,
    data_nascimento: nStr,
    idade: nInt,
    cargo_pretendido: nStr,
    resumo: nStr,
    experiencias: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['empresa', 'cargo', 'inicio', 'fim', 'atual', 'descricao'],
        properties: { empresa: nStr, cargo: nStr, inicio: nStr, fim: nStr, atual: { type: 'boolean' }, descricao: nStr },
      },
    },
    formacao: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['instituicao', 'curso', 'nivel', 'situacao'],
        properties: { instituicao: nStr, curso: nStr, nivel: nStr, situacao: nStr },
      },
    },
    habilidades: strArr,
    idiomas: strArr,
    cursos: strArr,
    disponibilidade: nStr,
    pretensao_salarial: nStr,
    cnh: nStr,
    experiencia_food_service: nBool,
    tempo_experiencia_meses: nInt,
    pontos_fortes: strArr,
    pontos_atencao: strArr,
    avisos: strArr,
  },
};

const SYSTEM_PROMPT = `Você lê currículos de candidatos a vagas em restaurantes brasileiros (cozinha, salão, caixa, delivery, gerência) e organiza as informações para o dono decidir quem chamar para entrevista.

Regras:
- Transcreva só o que está no currículo. Nunca invente dado. O que não estiver lá: texto "" (vazio), número 0, lista vazia.
- nome com iniciais maiúsculas. telefone só com dígitos, com DDD (ex.: 41999998888). email em minúsculas.
- data_nascimento no formato AAAA-MM-DD, só se estiver escrita. idade: a escrita no currículo, ou calculada da data de nascimento (hoje é ${new Date().toISOString().slice(0, 10)}).
- experiencias da mais recente para a mais antiga. inicio/fim como "MM/AAAA" ou "AAAA" conforme o currículo; atual = true se ainda trabalha lá (fim null).
- formacao.nivel: Fundamental, Médio, Técnico, Superior, Pós etc. situacao: Completo, Incompleto, Cursando.
- resumo: 2 a 3 frases objetivas, em português, sobre o perfil profissional.
- experiencia_food_service: "sim" se já trabalhou em restaurante, lanchonete, bar, padaria, hotel, cozinha industrial, delivery de comida ou função equivalente; "nao" se o currículo mostra experiências e nenhuma é da área; "indefinido" se não há experiência listada.
- tempo_experiencia_meses: soma aproximada dos períodos de trabalho (sem contar sobreposição); 0 se não der para estimar.
- experiencias[].fim: "" quando ainda trabalha lá.
- pontos_fortes / pontos_atencao: até 4 frases curtas cada, relevantes para trabalhar em restaurante (ex.: "3 anos como chapeiro", "Muitos empregos curtos (menos de 6 meses)", "Mora longe", "Sem experiência na área"). Sem julgamentos sobre idade, gênero, aparência, religião, estado civil ou qualquer característica pessoal protegida.
- legivel = false se o arquivo não for um currículo ou não der para ler; explique em avisos.
- avisos: frases curtas sobre o que ficou ilegível ou duvidoso.`;

// "" / 0 / "indefinido" do schema → null; mantém o contrato que a tela espera.
// deno-lint-ignore no-explicit-any
function normalize(o: Record<string, any>) {
  const s = (v: unknown) => { const t = String(v ?? '').trim(); return t ? t : null; };
  const n = (v: unknown) => (Number.isInteger(v) && Number(v) > 0 ? Number(v) : null);
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  return {
    ...o,
    nome: s(o.nome), email: s(o.email), telefone: s(o.telefone), cidade: s(o.cidade), bairro: s(o.bairro),
    data_nascimento: s(o.data_nascimento), idade: n(o.idade), cargo_pretendido: s(o.cargo_pretendido), resumo: s(o.resumo),
    disponibilidade: s(o.disponibilidade), pretensao_salarial: s(o.pretensao_salarial), cnh: s(o.cnh),
    experiencia_food_service: o.experiencia_food_service === 'sim' ? true : o.experiencia_food_service === 'nao' ? false : null,
    tempo_experiencia_meses: n(o.tempo_experiencia_meses),
    habilidades: arr(o.habilidades), idiomas: arr(o.idiomas), cursos: arr(o.cursos),
    pontos_fortes: arr(o.pontos_fortes), pontos_atencao: arr(o.pontos_atencao), avisos: arr(o.avisos),
    // deno-lint-ignore no-explicit-any
    experiencias: (Array.isArray(o.experiencias) ? o.experiencias : []).map((e: any) => ({
      empresa: s(e.empresa), cargo: s(e.cargo), inicio: s(e.inicio), fim: s(e.fim), atual: !!e.atual, descricao: s(e.descricao),
    })),
    // deno-lint-ignore no-explicit-any
    formacao: (Array.isArray(o.formacao) ? o.formacao : []).map((e: any) => ({
      instituicao: s(e.instituicao), curso: s(e.curso), nivel: s(e.nivel), situacao: s(e.situacao),
    })),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || serviceRoleKey.length < 40) return errResp('Server misconfiguration', 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return errResp('Unauthorized', 401);
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return errResp('Unauthorized', 401);
  if (String(u.user.email ?? '').toLowerCase() !== OWNER_EMAIL) return errResp('Sem acesso ao módulo Contratação', 403);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) return errResp('Leitura por IA não configurada (falta ANTHROPIC_API_KEY).', 503);

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body'); }
  const mediaType = String(body.media_type ?? '').toLowerCase();
  const data = String(body.file_base64 ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!data) return errResp('Envie o PDF ou a foto do currículo.');
  if (Math.floor(data.length * 3 / 4) > MAX_FILE_BYTES) return errResp('Arquivo grande demais (máx. 10 MB).');
  const isPdf = mediaType === 'application/pdf';
  if (!isPdf && !IMAGE_TYPES.includes(mediaType)) return errResp('Formato não suportado. Use PDF ou foto (JPG/PNG/WEBP).');

  const fileBlock = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg', data } };

  const client = new Anthropic({ apiKey });
  const started = Date.now();
  // deno-lint-ignore no-explicit-any
  let response: any;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: 'Leia o currículo anexo e devolva os dados do candidato.' }] }],
    // deno-lint-ignore no-explicit-any
    } as any);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return errResp('Chave da IA inválida no servidor (ANTHROPIC_API_KEY).', 503);
    if (err instanceof Anthropic.RateLimitError) return errResp('Muitas leituras ao mesmo tempo. Tente de novo em alguns segundos.', 429);
    if (err instanceof Anthropic.BadRequestError) {
      const detail = String(err.message);
      log('ERROR', 'anthropic bad request', { error: detail.slice(0, 500) });
      if (/credit balance|billing/i.test(detail)) return errResp('Sem créditos na conta da Anthropic.', 402);
      if (/image|document|pdf|media_type|base64|too large|size/i.test(detail)) return errResp('Não foi possível ler este arquivo. Tente outro formato ou uma foto mais nítida.', 400);
      return errResp('Erro de configuração na leitura por IA.', 500);
    }
    if (err instanceof Anthropic.APIError) {
      log('ERROR', 'anthropic api error', { status: err.status, error: String(err.message).slice(0, 500) });
      return errResp('Serviço de leitura indisponível no momento. Tente de novo.', 502);
    }
    log('ERROR', 'unhandled', { error: String((err as Error)?.message ?? err) });
    return errResp('Erro interno', 500);
  }

  if (response.stop_reason === 'refusal') return errResp('A leitura foi recusada para este arquivo.', 422);
  if (response.stop_reason === 'max_tokens') return errResp('Currículo longo demais para ler de uma vez.', 422);
  const text = (response.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  // deno-lint-ignore no-explicit-any
  let out: any;
  try { out = JSON.parse(text); } catch {
    log('ERROR', 'invalid json from model', { sample: text.slice(0, 300) });
    return errResp('A leitura voltou incompleta. Tente de novo.', 502);
  }

  out = normalize(out);
  log('INFO', 'ok', {
    ms: Date.now() - started, model: response.model,
    input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens,
  });
  return json({ success: true, data: out, model: response.model, usage: response.usage ?? null });
});
