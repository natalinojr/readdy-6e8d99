// Acesso por pessoa (2026-10-03) — tela Usuários › Acesso: "o que essa pessoa faz?" em cada loja.
// Pedido do dono: em vez do cargo + grade de 81 permissões, perguntar o que a pessoa faz; cada loja
// tem a sua configuração para aquela pessoa. Protótipo: docs/prototipos/acesso-por-pessoa-proposta.html.
//
// Ações (POST, JWT do usuário; deploy com --no-verify-jwt e conferência aqui):
//   ler     { user_id }                        → lojas em comum onde quem pede é admin/gerente, com o
//                                                cargo, o padrão do cargo, o que a pessoa tem e o que
//                                                quem edita pode dar
//   salvar  { user_id, tenant_id, papel, keys } → grava cargo + ajuste da pessoa NAQUELA loja
//   equipe  { tenant_id }                      → o que cada pessoa da loja tem (chips da lista)
// Regras de quem pode dar o quê: _shared/acesso-pessoa.ts › conferirAcesso (as mesmas da tela).
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authenticate, isPlatformOwner } from '../_shared/tenant-auth.ts';
import { ajusteDaPessoaNaLoja } from '../_shared/ajuste-pessoa.ts';
import { DB_ROLE_TO_PAPEL, PAPEL_TO_DB_ROLE, DEFAULT_PERMISSOES, permissoesDaPessoa } from '../_shared/permissoes-padrao.ts';
import {
  ajustesDaPessoa, conferirAcesso, padraoDoCargo, PAPEIS_DO_DONO, PAPEIS_DO_GERENTE, KEYS_SO_DONO, type Linha,
} from '../_shared/acesso-pessoa.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status = 400) => json({ error: msg }, status);

const pt = (role: string) => DB_ROLE_TO_PAPEL[role] ?? role;

/**
 * Quem pode mexer no acesso da equipe nesta loja: o dono (admin) e o supervisor (manager) que tem
 * "Cadastra pessoas da equipe" (usuarios_gerenciar) — a MESMA regra de /usuarios (fn_gerencia_usuarios,
 * user-write): ajuste da pessoa por cima da matriz do cargo. Revisão 2026-10-03: sem isto o supervisor
 * sem a chave mudava o acesso de todos pela Edge.
 */
async function gerencia(admin: any, tenantId: string, role: string | undefined, userId: string): Promise<boolean> {
  if (role === 'admin') return true;
  if (role !== 'manager') return false;
  const daPessoa = await ajusteDaPessoaNaLoja(admin, tenantId, userId, ['usuarios_gerenciar']);
  if (daPessoa.has('usuarios_gerenciar')) return daPessoa.get('usuarios_gerenciar') === true;
  const { data, error } = await admin.from('permissions').select('allowed')
    .eq('tenant_id', tenantId).eq('role', 'manager').eq('permission_key', 'usuarios_gerenciar').limit(1).maybeSingle();
  if (error) throw new Error(`Falha ao ler as permissões da loja: ${error.message}`);
  return data?.allowed === true;
}

/** Linhas de Configurações › Permissões da loja, por role do banco (EN). */
async function linhasDosCargos(admin: any, tenantId: string): Promise<Map<string, Linha[]>> {
  const { data, error } = await admin.from('permissions').select('role, permission_key, allowed').eq('tenant_id', tenantId);
  if (error) throw new Error(`Falha ao ler as permissões da loja: ${error.message}`);
  const m = new Map<string, Linha[]>();
  for (const r of (data ?? []) as Array<{ role: string; permission_key: string; allowed: boolean }>) {
    const role = String(r.role);
    if (!m.has(role)) m.set(role, []);
    m.get(role)!.push({ permission_key: r.permission_key, allowed: r.allowed === true });
  }
  return m;
}

/** Ajustes por pessoa numa loja (user_id → linhas). */
async function ajustesDasPessoas(admin: any, tenantId: string, userIds: string[]): Promise<Map<string, Linha[]>> {
  const m = new Map<string, Linha[]>();
  if (!userIds.length) return m;
  const { data, error } = await admin.from('user_permissions').select('user_id, permission_key, allowed')
    .eq('tenant_id', tenantId).in('user_id', userIds);
  if (error) throw new Error(`Falha ao ler o acesso das pessoas: ${error.message}`);
  for (const r of (data ?? []) as Array<{ user_id: string; permission_key: string; allowed: boolean }>) {
    if (!m.has(r.user_id)) m.set(r.user_id, []);
    m.get(r.user_id)!.push({ permission_key: r.permission_key, allowed: r.allowed === true });
  }
  return m;
}

const keysDe = (roleEN: string, cargos: Map<string, Linha[]>, pessoa: Linha[] = []) =>
  roleEN === 'admin' ? [...DEFAULT_PERMISSOES.admin] : permissoesDaPessoa(pt(roleEN), cargos.get(roleEN) ?? [], pessoa);

/** Tudo o que a tela precisa de uma loja para editar a pessoa (e o que o servidor confere ao salvar). */
async function contextoDaLoja(admin: any, tenantId: string, alvo: { id: string; role: string }, editor: { id: string; role: string }) {
  const cargos = await linhasDosCargos(admin, tenantId);
  const ajustes = await ajustesDasPessoas(admin, tenantId, [alvo.id, editor.id]);
  const papel = pt(alvo.role);
  const editorPapel = pt(editor.role);
  const cargosPossiveis = editorPapel === 'admin' ? PAPEIS_DO_DONO : PAPEIS_DO_GERENTE;
  const padroes = Object.fromEntries(cargosPossiveis.map((p) => [p, padraoDoCargo(p, cargos.get(PAPEL_TO_DB_ROLE[p] ?? p) ?? [])]));
  let motivo: string | null = null;
  if (alvo.id === editor.id) motivo = 'Ninguém muda o próprio acesso — peça a outra pessoa (o Administrador).';
  else if (papel === 'admin') motivo = 'Administrador tem tudo. O cargo dele muda em "Editar".';
  else if (editorPapel !== 'admin' && !PAPEIS_DO_GERENTE.includes(papel)) motivo = 'Só o Administrador muda o acesso de supervisor, financeiro e contabilidade.';
  else if (!PAPEIS_DO_DONO.includes(papel)) motivo = 'Este tipo de usuário (totem, tablet) não tem ajuste por pessoa.';
  return {
    papel,
    keys: keysDe(alvo.role, cargos, ajustes.get(alvo.id)),
    ajustes: (ajustes.get(alvo.id) ?? []).length,
    padrao: papel === 'admin' ? [...DEFAULT_PERMISSOES.admin] : padraoDoCargo(papel, cargos.get(alvo.role) ?? []),
    editor: editorPapel,
    keysDoEditor: keysDe(editor.role, cargos, ajustes.get(editor.id)),
    cargos: cargosPossiveis,
    padroes,
    podeEditar: motivo === null,
    motivo,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return erro('Use POST', 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const caller = await authenticate(req, admin);
    if (!caller?.userId) return erro('Entre de novo no sistema.', 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const eu = caller.userId;

    const { data: minhas, error: errMinhas } = await admin.from('user_tenants').select('tenant_id, role').eq('user_id', eu);
    if (errMinhas) throw new Error(errMinhas.message);
    const meuPapel = new Map<string, string>(((minhas ?? []) as Array<{ tenant_id: string; role: string }>).map((r) => [String(r.tenant_id), String(r.role)]));
    const gerenciaCache = new Map<string, boolean>();
    const gestor = async (tenantId: string) => {
      if (!gerenciaCache.has(tenantId)) gerenciaCache.set(tenantId, await gerencia(admin, tenantId, meuPapel.get(tenantId), eu));
      return gerenciaCache.get(tenantId)!;
    };

    if (action === 'equipe') {
      const tenantId = String(body.tenant_id ?? '');
      if (!(await gestor(tenantId))) return erro('Só o Administrador, ou o supervisor com "Cadastra pessoas da equipe", vê o acesso da equipe.', 403);
      const { data: membros, error } = await admin.from('user_tenants').select('user_id, role').eq('tenant_id', tenantId);
      if (error) throw new Error(error.message);
      const lista = (membros ?? []) as Array<{ user_id: string; role: string }>;
      const cargos = await linhasDosCargos(admin, tenantId);
      const ajustes = await ajustesDasPessoas(admin, tenantId, lista.map((m) => m.user_id));
      return json({
        pessoas: lista.map((m) => ({
          user_id: m.user_id, papel: pt(m.role), keys: keysDe(m.role, cargos, ajustes.get(m.user_id)),
          padrao: m.role === 'admin' ? [...DEFAULT_PERMISSOES.admin] : padraoDoCargo(pt(m.role), cargos.get(m.role) ?? []),
          ajustes: (ajustes.get(m.user_id) ?? []).length,
        })),
      });
    }

    const alvoId = String(body.user_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(alvoId)) return erro('Pessoa inválida.');
    const { data: dele, error: errDele } = await admin.from('user_tenants').select('tenant_id, role, tenants(name)').eq('user_id', alvoId);
    if (errDele) throw new Error(errDele.message);
    const lojasDele = [];
    for (const r of (dele ?? []) as Array<{ tenant_id: string; role: string; tenants: { name?: string } | null }>) {
      if (await gestor(String(r.tenant_id))) lojasDele.push(r);
    }
    if (!lojasDele.length) return erro('Você não é Administrador, nem supervisor com "Cadastra pessoas da equipe", em nenhuma loja desta pessoa.', 403);

    if (action === 'ler') {
      const { data: u } = await admin.from('users').select('name, email').eq('id', alvoId).maybeSingle();
      const lojas = [];
      for (const r of lojasDele) {
        const ctx = await contextoDaLoja(admin, String(r.tenant_id), { id: alvoId, role: String(r.role) }, { id: eu, role: meuPapel.get(String(r.tenant_id))! });
        lojas.push({ tenant_id: r.tenant_id, loja: r.tenants?.name ?? 'Loja', ...ctx });
      }
      lojas.sort((a, b) => String(a.loja).localeCompare(String(b.loja), 'pt-BR'));
      return json({ pessoa: { id: alvoId, nome: u?.name ?? '', email: u?.email ?? '' }, lojas, soDono: KEYS_SO_DONO });
    }

    if (action === 'salvar') {
      const tenantId = String(body.tenant_id ?? '');
      const r = lojasDele.find((x) => String(x.tenant_id) === tenantId);
      if (!r) return erro('Você não é Administrador, nem supervisor com "Cadastra pessoas da equipe", nesta loja da pessoa.', 403);
      if (alvoId !== eu && await isPlatformOwner(admin, alvoId)) return erro('Este usuário só pode ser alterado por ele mesmo.', 403);
      const papelNovo = String(body.papel ?? '');
      const keys = [...new Set((Array.isArray(body.keys) ? body.keys : []).map((k: unknown) => String(k)))] as string[];
      const ctx = await contextoDaLoja(admin, tenantId, { id: alvoId, role: String(r.role) }, { id: eu, role: meuPapel.get(tenantId)! });
      if (!ctx.podeEditar) return erro(ctx.motivo ?? 'Sem permissão.', 403);
      const padraoNovo = ctx.padroes[papelNovo] ?? [];
      const motivo = conferirAcesso({
        editor: ctx.editor, propria: alvoId === eu, keysDoEditor: new Set(ctx.keysDoEditor),
        papelAtual: ctx.papel, papelNovo, keysAtuais: new Set(ctx.keys), keys, padraoDoCargoNovo: padraoNovo,
      });
      if (motivo) return erro(motivo, 403);
      const linhas = ajustesDaPessoa(padraoNovo, keys);
      const roleNovo = PAPEL_TO_DB_ROLE[papelNovo] ?? papelNovo;
      // p_role_atual: grava só se o cargo ainda é o que foi conferido (outra pessoa pode ter mudado no meio)
      const { error } = await admin.rpc('fn_acesso_pessoa_gravar', {
        p_tenant: tenantId, p_user: alvoId, p_role_atual: r.role, p_role: roleNovo !== r.role ? roleNovo : null, p_linhas: linhas, p_por: eu,
      });
      if (error) throw new Error(error.message);
      console.log(JSON.stringify({ evt: 'acesso_pessoa_salvo', tenantId, alvoId, por: eu, papel: papelNovo, ajustes: linhas.length }));
      return json({ ok: true, papel: papelNovo, ajustes: linhas.length });
    }

    return erro('Ação desconhecida.');
  } catch (e) {
    console.error('[acesso-pessoa]', e);
    return erro(e instanceof Error ? e.message : String(e), 500);
  }
});
