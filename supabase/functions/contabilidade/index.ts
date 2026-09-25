// contabilidade — entrada de documentos pela contabilidade (2026-09-25).
//
// Financeiro › Guias e impostos: o(a) contador(a) anexa o PDF do DAS, do DARF (INSS da folha) ou
// da guia do FGTS Digital. A leitura é a MESMA do grupo do WhatsApp, sem modelo:
//   PDF → camada de texto (_shared/pdf-texto.ts) → lerGuia (_shared/guias.ts: DV da linha
//   digitável, número do documento, CRC do Pix) → assistente-brain action 'guia' (processarGuia:
//   loja pelo CNPJ, conta a pagar por competência, DRE certa e pagamento preparado no prazo).
// O pagamento preparado só sai com o PIN do dono — o cartão vai para o chat dele (Telegram).
//
// Ações (POST JSON, JWT do usuário):
//   enviar_guia   { arquivo_base64, arquivo_nome }  → lê, lança e devolve o que foi feito
//   listar        {}                                → guias enviadas nas lojas do usuário (180 dias)
//   abrir_arquivo { id }                            → link assinado (5 min) do PDF original
//
// Quem pode: admin, gerente, financeiro ou contabilidade DA LOJA DO CNPJ DA GUIA.
// Publicada com --no-verify-jwt: a checagem é feita aqui dentro (tenant-auth).
// Secrets: ASSISTENTE_INTERNAL_KEY (brain e telegram).
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authenticate, isContabilidadeRole, isFinanceiroRole, userMemberships } from '../_shared/tenant-auth.ts';
import { lerGuia, soDigitos } from '../_shared/guias.ts';
import { textoDoPdf } from '../_shared/pdf-texto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status = 400) => json({ error: msg }, status);
const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, fn: 'contabilidade', msg, ...extra }));

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';
const BUCKET = 'contabilidade-docs';
const MAX_BYTES = 10 * 1024 * 1024;

const podeEnviar = (role: string | null | undefined) => isFinanceiroRole(role) || isContabilidadeRole(role);

// Mesma escolha de loja do processarGuia (assistente-brain): CNPJ inteiro, ou a raiz (a GFD só traz
// 8 dígitos) — com mais de uma loja na raiz, a matriz (0001).
function lojaDoCnpj(lojas: any[], cnpj: string): any | null {
  const cands = lojas.filter((t) => { const c = soDigitos(t.cnpj); return !!c && (cnpj.length === 14 ? c === cnpj : c.startsWith(cnpj)); });
  return cands.length === 1 ? cands[0] : cands.find((t) => soDigitos(t.cnpj).slice(8, 12) === '0001') ?? null;
}

async function chatDoDono(admin: any): Promise<string | null> {
  const { data } = await admin.from('asst_settings').select('key, value').in('key', ['telegram_owner_chat_id', 'owner_chat_id']);
  const cfg = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
  if (cfg.telegram_owner_chat_id) return `tg:${cfg.telegram_owner_chat_id}`;
  return typeof cfg.owner_chat_id === 'string' && cfg.owner_chat_id ? cfg.owner_chat_id : null;
}

async function interno(fn: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return erro('Method not allowed', 405);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const caller = await authenticate(req, admin);
  if (!caller?.userId) return erro('Faça login de novo.', 401);
  const vinculos = await userMemberships(admin, caller.userId);
  const lojasPermitidas = [...vinculos].filter(([, role]) => podeEnviar(role)).map(([tid]) => tid);
  if (!lojasPermitidas.length) return erro('Seu perfil não envia guias.', 403);

  let body: any;
  try { body = await req.json(); } catch { return erro('JSON inválido'); }
  const action = String(body?.action ?? '');

  try {
    if (action === 'listar') {
      const desde = new Date(Date.now() - 180 * 86400_000).toISOString();
      const { data, error } = await admin.from('fin_guias_enviadas')
        .select('id, tenant_id, enviado_por, enviado_por_nome, arquivo_nome, arquivo_path, tipo, titulo, competencia, vencimento, valor, bill_id, payment_id, resultado, mensagem, created_at')
        .or(`tenant_id.in.(${lojasPermitidas.join(',')}),enviado_por.eq.${caller.userId}`)
        .gte('created_at', desde).order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const billIds = [...new Set(rows.map((r) => r.bill_id).filter(Boolean))];
      const payIds = [...new Set(rows.map((r) => r.payment_id).filter(Boolean))];
      const tenantIds = [...new Set(rows.map((r) => r.tenant_id).filter(Boolean))];
      const [contas, pags, lojas] = await Promise.all([
        billIds.length ? admin.from('fin_accounts_payable').select('id, status, paid_date, amount, due_date').in('id', billIds) : { data: [] },
        payIds.length ? admin.from('fin_inter_payments').select('id, status').in('id', payIds) : { data: [] },
        tenantIds.length ? admin.from('tenants').select('id, name').in('id', tenantIds) : { data: [] },
      ]);
      const contaPor = new Map((contas.data ?? []).map((c: any) => [c.id, c]));
      const pagPor = new Map((pags.data ?? []).map((p: any) => [p.id, p]));
      const lojaPor = new Map((lojas.data ?? []).map((t: any) => [t.id, t.name]));
      return json({
        success: true,
        data: rows.map((r) => {
          const c: any = r.bill_id ? contaPor.get(r.bill_id) : null;
          const p: any = r.payment_id ? pagPor.get(r.payment_id) : null;
          return {
            ...r, arquivo_path: undefined, tem_arquivo: !!r.arquivo_path,
            loja: r.tenant_id ? lojaPor.get(r.tenant_id) ?? null : null,
            conta_status: c?.status ?? null, conta_paga_em: c?.paid_date ?? null,
            pagamento_status: p?.status ?? null,
          };
        }),
      });
    }

    if (action === 'abrir_arquivo') {
      const { data: g } = await admin.from('fin_guias_enviadas').select('tenant_id, enviado_por, arquivo_path').eq('id', String(body.id ?? '')).maybeSingle();
      if (!g?.arquivo_path) return erro('Arquivo não encontrado.', 404);
      if (!(g.enviado_por === caller.userId || (g.tenant_id && lojasPermitidas.includes(g.tenant_id)))) return erro('Sem acesso a esse arquivo.', 403);
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(g.arquivo_path, 300);
      if (error || !data?.signedUrl) throw new Error(error?.message ?? 'link');
      return json({ success: true, url: data.signedUrl });
    }

    if (action === 'enviar_guia') {
      const b64 = String(body.arquivo_base64 ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
      const nome = String(body.arquivo_nome ?? 'guia.pdf').slice(0, 160);
      if (!b64) return erro('Anexe o PDF da guia.');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (bytes.length > MAX_BYTES) return erro('Arquivo maior que 10 MB.');
      if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
        return erro('Mande o PDF da guia (o arquivo original baixado do PGDAS, e-CAC/Sicalc ou FGTS Digital), não foto.');
      }
      const autor = await admin.from('users').select('name').eq('id', caller.userId).maybeSingle()
        .then((r: any) => String(r.data?.name ?? '').trim() || (caller.email ?? '').split('@')[0] || 'contabilidade');

      const registrar = async (campos: Record<string, unknown>) => {
        const { data, error } = await admin.from('fin_guias_enviadas')
          .insert({ enviado_por: caller.userId, enviado_por_nome: autor, arquivo_nome: nome, ...campos }).select('id').single();
        if (error) log('WARN', 'registrar envio', { error: error.message });
        return data?.id ?? null;
      };

      const texto = await textoDoPdf(b64, 40000);
      if (!texto.trim()) {
        await registrar({ resultado: 'nao_reconhecida', mensagem: 'PDF sem texto (imagem ou escaneado).' });
        return json({ success: false, resultado: 'nao_reconhecida', texto: 'Esse PDF não tem texto (parece imagem ou escaneado). Baixe a guia de novo direto do PGDAS, e-CAC/Sicalc ou FGTS Digital e anexe o arquivo original.' });
      }
      const g = lerGuia(texto);
      if (!g) {
        await registrar({ resultado: 'nao_reconhecida', mensagem: 'Não é DAS, DARF nem guia do FGTS Digital.' });
        return json({ success: false, resultado: 'nao_reconhecida', texto: 'Não reconheci como DAS, DARF ou guia do FGTS Digital. Por aqui entram só essas guias; outros documentos mande ao dono.' });
      }
      const base = { tipo: g.tipo, titulo: g.titulo, competencia: g.competencia, vencimento: g.vencimento, valor: g.valor };
      if (!g.cnpj) {
        await registrar({ ...base, resultado: 'erro', mensagem: 'CNPJ não encontrado na guia.' });
        return json({ success: false, resultado: 'erro', guia: base, texto: 'Não achei o CNPJ na guia. Confira se é o PDF original.' });
      }
      const { data: lojas } = await admin.from('tenants').select('id, name, cnpj');
      const loja = lojaDoCnpj(lojas ?? [], g.cnpj);
      if (!loja) {
        await registrar({ ...base, resultado: 'erro', mensagem: `Nenhuma loja com o CNPJ ${g.cnpj}.` });
        return json({ success: false, resultado: 'erro', guia: base, texto: `Nenhuma loja do ERPOS tem o CNPJ ${g.cnpj} desta guia. Confira o cadastro da loja com o dono.` });
      }
      // A guia só entra na loja do CNPJ dela, e só se quem mandou tem acesso a essa loja.
      if (!podeEnviar(vinculos.get(String(loja.id)))) return erro(`Esta guia é de ${loja.name}, e você não tem acesso a essa loja.`, 403);

      // Arquivo original guardado antes de lançar: o protocolo vale mesmo se o lançamento falhar.
      const comp = g.competencia ?? 'sem-competencia';
      const path = `${loja.id}/${comp}/${crypto.randomUUID()}.pdf`;
      const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
      if (up.error) log('WARN', 'guardar PDF', { error: up.error.message });
      const arquivo_path = up.error ? null : path;

      if (!g.completa) {
        const falta = [!g.valor && 'valor', !g.vencimento && 'vencimento', g.tipo === 'FGTS' ? !g.copia_e_cola && 'Pix copia e cola' : !g.linha && 'linha digitável (os dígitos não conferem)'].filter(Boolean).join(', ');
        await registrar({ ...base, tenant_id: loja.id, arquivo_path, resultado: 'erro', mensagem: `Faltou: ${falta}.` });
        return json({ success: false, resultado: 'erro', guia: base, loja: loja.name, texto: `Li a guia, mas faltou: ${falta}. Mande o PDF original (o que o sistema do governo gera), não foto nem impressão.` });
      }

      const ownerChat = await chatDoDono(admin);
      const r = await interno('assistente-brain', { action: 'guia', guia: g, origem: `contabilidade: ${autor}`, chat_id: ownerChat ?? '' });
      const resultado = !r?.ok ? 'erro' : r.payment_id ? 'preparada' : /já está \*paga\*/.test(String(r.texto ?? '')) ? 'ja_paga' : 'guardada';
      const textoLimpo = String(r?.texto ?? '').replace(/\*/g, '');
      const id = await registrar({ ...base, tenant_id: loja.id, arquivo_path, bill_id: r?.conta_id ?? null, payment_id: r?.payment_id ?? null, resultado, mensagem: textoLimpo.slice(0, 1500) });

      // Avisa o dono no chat, com o cartão Pagar quando o pagamento já foi preparado.
      if (ownerChat?.startsWith('tg:')) {
        const aviso = `${String(r?.texto ?? 'Guia recebida.')}\n_(enviada por ${autor}, contabilidade)_${r?.payment_id ? '\n\n👉 *Ainda não foi pago:* toque em *Pagar* no cartão abaixo.' : ''}`;
        await interno('assistente-telegram', {
          action: 'deliver', chat_key: ownerChat, text: aviso,
          actions: r?.payment_id ? [{ type: 'payment', id: String(r.payment_id) }] : [], save: true, topic: 'pagamentos',
        }).catch((e) => log('WARN', 'aviso ao dono', { error: String(e) }));
      }
      log('INFO', 'guia enviada', { tipo: g.tipo, comp: g.competencia, loja: loja.id, resultado, pagamento: r?.payment_id ?? null });
      return json({ success: !!r?.ok, id, resultado, loja: loja.name, guia: base, texto: textoLimpo, pagamento_preparado: !!r?.payment_id });
    }

    return erro(`Ação desconhecida: ${action}`);
  } catch (e) {
    log('ERROR', action, { error: String((e as Error)?.message ?? e) });
    return erro(String((e as Error)?.message ?? e).slice(0, 300), 500);
  }
});
