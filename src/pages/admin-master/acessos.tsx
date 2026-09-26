// Gestão de acessos do Admin Master: loja × perfil por usuário (user_tenants) e
// módulos sem loja — Tarefas e Contratação (user_module_access). Tudo por RPC
// fn_admin_* (só o dono passa em fn_assert_platform_admin).
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { confirmar } from '@/components/base/Dialogos';
import { ADMIN_MASTER_EMAIL, type AdminUser, type TenantInfo } from './modals';

export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'supervisor', label: 'Supervisão' },
  { value: 'cashier', label: 'Caixa' },
  { value: 'waiter', label: 'Garçom' },
  { value: 'kitchen', label: 'Cozinha' },
  { value: 'delivery_manager', label: 'Gestor de entregas' },
  { value: 'tasks_only', label: 'Só Tarefas' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'accountant', label: 'Contabilidade' },
];

export const ROLE_LABEL: Record<string, string> = {
  ...Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label])),
  tablet: 'Totem',
  customer: 'Cliente',
};

export const MODULOS_LIVRES = [
  {
    id: 'tarefas',
    label: 'Tarefas',
    icon: 'ri-task-line',
    tone: 'bg-indigo-50 text-indigo-600',
    desc: 'Listas, checklists e prazos. Cada pessoa vê as próprias tarefas e as atribuídas a ela.',
  },
  {
    id: 'contratacao',
    label: 'Contratação',
    icon: 'ri-user-search-line',
    tone: 'bg-rose-50 text-rose-600',
    desc: 'Currículos, vagas e entrevistas. Quem tem acesso vê o banco de candidatos inteiro.',
  },
  {
    id: 'nfse',
    label: 'Notas de Serviço',
    icon: 'ri-file-text-line',
    tone: 'bg-sky-50 text-sky-600',
    desc: 'Emissão de NFS-e. Cada pessoa só vê as empresas em que foi incluída.',
  },
] as const;

export const isOwnerUser = (u: AdminUser) => u.email.toLowerCase() === ADMIN_MASTER_EMAIL;

async function rpc(name: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
}
export const setUserTenant = (userId: string, tenantId: string, role: string) =>
  rpc('fn_admin_set_user_tenant', { p_user_id: userId, p_tenant_id: tenantId, p_role: role });
export const removeUserTenant = (userId: string, tenantId: string) =>
  rpc('fn_admin_remove_user_tenant', { p_user_id: userId, p_tenant_id: tenantId });
export const setModuleAccess = (userId: string, module: string, enabled: boolean) =>
  rpc('fn_admin_set_module_access', { p_user_id: userId, p_module: module, p_enabled: enabled });
export const setTenantBackup = (tenantId: string, enabled: boolean) =>
  rpc('fn_admin_set_tenant_backup', { p_tenant_id: tenantId, p_enabled: enabled });

// ─── Controles ────────────────────────────────────────────────────────────────

export function RoleSelect({
  value, onChange, disabled, allowNone,
}: { value: string; onChange: (v: string) => void; disabled?: boolean; allowNone?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`text-xs font-semibold border rounded-lg px-2.5 py-1.5 bg-white cursor-pointer focus:outline-none focus:border-amber-400 disabled:opacity-50 ${
        value ? 'border-zinc-200 text-zinc-800' : 'border-dashed border-zinc-300 text-zinc-400'
      }`}
    >
      {allowNone && <option value="">Sem acesso</option>}
      {!ROLE_OPTIONS.some((r) => r.value === value) && value && <option value={value}>{ROLE_LABEL[value] ?? value}</option>}
      {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
    </select>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-default ${checked ? 'bg-emerald-500' : 'bg-zinc-200'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

export function Avatar({ user, size = 'md' }: { user: AdminUser; size?: 'sm' | 'md' }) {
  const initials = user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const cls = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs';
  const tone = !user.is_active ? 'bg-red-50 text-red-500' : user.memberships.length === 0 ? 'bg-amber-50 text-amber-700' : 'bg-zinc-100 text-zinc-600';
  return (
    <div className={`${cls} ${tone} rounded-xl flex items-center justify-center font-bold flex-shrink-0`}>
      {!user.is_active ? <i className="ri-pause-line" /> : initials}
    </div>
  );
}

// ─── Modal: lojas, perfil e módulos de um usuário ────────────────────────────

export function UserAccessModal({
  user, tenants, onClose, onChanged,
}: { user: AdminUser; tenants: TenantInfo[]; onClose: () => void; onChanged: () => void }) {
  const [roles, setRoles] = useState<Record<string, string>>(
    () => Object.fromEntries(user.memberships.map((m) => [m.tenant_id, m.role])),
  );
  const [modules, setModules] = useState<Set<string>>(() => new Set(user.modules));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = isOwnerUser(user);
  const tasksOnly = Object.values(roles).includes('tasks_only');

  const run = async (key: string, fn: () => Promise<void>, apply: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      apply();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async (tenant: TenantInfo, role: string) => {
    if (!role) {
      const ultima = Object.keys(roles).length === 1;
      const titulo = `Tirar o acesso de ${user.name} à ${tenant.name}?`;
      const mensagem = ultima ? 'Era a única loja: no próximo login a pessoa vai cair na tela de código de convite.' : undefined;
      if (!(await confirmar({ titulo, mensagem, confirmarLabel: 'Tirar acesso', perigo: true }))) return;
      run(tenant.id, () => removeUserTenant(user.id, tenant.id), () =>
        setRoles((r) => { const n = { ...r }; delete n[tenant.id]; return n; }));
      return;
    }
    run(tenant.id, () => setUserTenant(user.id, tenant.id, role), () => setRoles((r) => ({ ...r, [tenant.id]: role })));
  };

  const toggleModule = (id: string, on: boolean) =>
    run(`mod:${id}`, () => setModuleAccess(user.id, id, on), () =>
      setModules((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }));

  const ordered = [...tenants].sort((a, b) => Number(!!roles[b.id]) - Number(!!roles[a.id]) || a.name.localeCompare(b.name));
  const qtdLojas = Object.keys(roles).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
          <Avatar user={user} />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-zinc-900 truncate">{user.name}</h2>
            <p className="text-xs text-zinc-400 truncate">{user.email}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {owner && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 flex items-start gap-2">
              <i className="ri-shield-star-line mt-px" />
              Admin Master: tem todos os módulos sempre, independente do que estiver marcado aqui.
            </p>
          )}

          <section>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-6 h-6 rounded-md flex items-center justify-center bg-emerald-50 text-emerald-600"><i className="ri-store-2-line text-sm" /></span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Lojas e perfil</span>
              <span className="flex-1 h-px bg-zinc-100" />
              <span className="text-[11px] text-zinc-400 tabular-nums">{qtdLojas} de {tenants.length}</span>
            </div>
            <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100">
              {ordered.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                  <i className={`ri-store-2-line text-sm ${roles[t.id] ? 'text-emerald-600' : 'text-zinc-300'}`} />
                  <span className={`flex-1 min-w-0 text-sm truncate ${roles[t.id] ? 'font-semibold text-zinc-800' : 'text-zinc-400'}`}>{t.name}</span>
                  {busy === t.id && <div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}
                  <RoleSelect allowNone value={roles[t.id] ?? ''} disabled={busy !== null} onChange={(v) => changeRole(t, v)} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-6 h-6 rounded-md flex items-center justify-center bg-indigo-50 text-indigo-600"><i className="ri-apps-2-line text-sm" /></span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Módulos sem loja</span>
              <span className="flex-1 h-px bg-zinc-100" />
            </div>
            <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100">
              {MODULOS_LIVRES.map((m) => {
                const viaPerfil = m.id === 'tarefas' && tasksOnly;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-3">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${m.tone}`}><i className={`${m.icon} text-base`} /></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-800">{m.label}</p>
                      <p className="text-[11px] text-zinc-400 leading-snug">
                        {viaPerfil ? 'Liberado sempre pelo perfil "Só Tarefas".' : m.desc}
                      </p>
                    </div>
                    <Switch checked={owner || viaPerfil || modules.has(m.id)} disabled={owner || viaPerfil || busy !== null} onChange={(v) => toggleModule(m.id, v)} />
                  </div>
                );
              })}
            </div>
          </section>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
              <i className="ri-error-warning-line mt-px" />{error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-100 flex items-center gap-3">
          <p className="flex-1 text-[11px] text-zinc-400 leading-snug">Salva na hora. A pessoa vê a mudança no próximo login ou ao trocar de loja.</p>
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-xl cursor-pointer whitespace-nowrap">Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Aba Módulos: quem acessa Tarefas e Contratação ──────────────────────────

export function ModulosTab({ users, onChanged }: { users: AdminUser[]; onChanged: () => void }) {
  const [busca, setBusca] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Otimista: aplica na hora e recarrega a lista do servidor depois.
  const [override, setOverride] = useState<Record<string, boolean>>({});

  const ativos = useMemo(() => users.filter((u) => u.is_active), [users]);
  const filtrados = ativos.filter((u) => !busca
    || u.name.toLowerCase().includes(busca.toLowerCase())
    || u.email.toLowerCase().includes(busca.toLowerCase()));

  const temAcesso = (u: AdminUser, mod: string) => {
    if (isOwnerUser(u)) return true;
    if (mod === 'tarefas' && u.memberships.some((m) => m.role === 'tasks_only')) return true;
    const k = `${u.id}:${mod}`;
    return k in override ? override[k] : u.modules.includes(mod);
  };
  const travado = (u: AdminUser, mod: string) =>
    isOwnerUser(u) || (mod === 'tarefas' && u.memberships.some((m) => m.role === 'tasks_only'));

  const toggle = async (u: AdminUser, mod: string, on: boolean) => {
    const k = `${u.id}:${mod}`;
    setBusy(k);
    setError(null);
    try {
      await setModuleAccess(u.id, mod, on);
      setOverride((o) => ({ ...o, [k]: on }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px] flex items-center gap-2 bg-white border border-zinc-200 rounded-xl px-3 h-10 shadow-sm">
          <i className="ri-search-line text-zinc-400 text-sm" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa..."
            className="flex-1 text-sm bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none" />
          {busca && <button onClick={() => setBusca('')} className="text-zinc-400 hover:text-zinc-600 cursor-pointer"><i className="ri-close-line" /></button>}
        </div>
        <p className="text-xs text-zinc-400">Estes módulos não dependem de loja: o acesso é por pessoa.</p>
      </div>

      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {MODULOS_LIVRES.map((m) => {
          const qtd = ativos.filter((u) => temAcesso(u, m.id)).length;
          const lista = [...filtrados].sort((a, b) =>
            Number(temAcesso(b, m.id)) - Number(temAcesso(a, m.id)) || a.name.localeCompare(b.name));
          return (
            <div key={m.id} className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
              <div className="px-5 py-4 flex items-start gap-3 border-b border-zinc-100">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${m.tone}`}><i className={`${m.icon} text-lg`} /></span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-zinc-800">{m.label}</h3>
                  <p className="text-xs text-zinc-400 leading-snug">{m.desc}</p>
                </div>
                <span className="text-xs font-semibold text-zinc-500 bg-zinc-100 rounded-lg px-2 py-1 tabular-nums whitespace-nowrap">{qtd} com acesso</span>
              </div>
              <div className="divide-y divide-zinc-100 max-h-[480px] overflow-y-auto">
                {lista.length === 0 && <p className="px-5 py-8 text-center text-xs text-zinc-400">Ninguém encontrado.</p>}
                {lista.map((u) => {
                  const k = `${u.id}:${m.id}`;
                  const on = temAcesso(u, m.id);
                  return (
                    <div key={u.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-zinc-50/60">
                      <Avatar user={u} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${on ? 'font-semibold text-zinc-800' : 'text-zinc-500'}`}>{u.name}</p>
                        <p className="text-[11px] text-zinc-400 truncate">
                          {isOwnerUser(u) ? 'Admin Master — sempre tem acesso'
                            : travado(u, m.id) ? 'Perfil "Só Tarefas" — sempre tem acesso'
                            : u.email}
                        </p>
                      </div>
                      {busy === k && <div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}
                      <Switch checked={on} disabled={travado(u, m.id) || busy !== null} onChange={(v) => toggle(u, m.id, v)} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
