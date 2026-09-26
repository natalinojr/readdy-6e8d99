// Admin Master — lojas, usuários (loja × perfil), módulos sem loja e convites.
// Layout no padrão da DRE (cards brancos rounded-2xl, seletor segmentado, KPIs).
// Só o dono (ADMIN_MASTER_EMAIL) entra; as RPCs também checam (fn_assert_platform_admin).
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { confirmar } from '@/components/base/Dialogos';
import { Segmented } from '@/pages/financeiro/components/dreUi';
import {
  ADMIN_MASTER_EMAIL, fmtDate, fmtCurrency,
  NewInviteModal, StoreActionConfirmModal, CreateUserModal, EditUserModal, UserActionModal, ResendCredentialsModal,
  NewFinanceTenantModal,
  type StoreInvite, type TenantInfo, type StoreAction, type StoreActionModal, type UserAction, type AdminUser,
} from './modals';
import {
  UserAccessModal, ModulosTab, RoleSelect, Avatar, ROLE_LABEL, MODULOS_LIVRES, isOwnerUser,
  setUserTenant, removeUserTenant, setTenantBackup,
} from './acessos';

type Tab = 'lojas' | 'usuarios' | 'modulos' | 'convites';

const TH = 'px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400 text-left whitespace-nowrap';
const TD = 'px-5 py-3 align-middle';

// ─── Peças visuais (mesma linguagem do KpiCard/SectionHeader da DRE) ─────────

function Stat({
  label, icon, value, sub, valueTone, highlight,
}: { label: string; icon: string; value: ReactNode; sub?: string; valueTone?: string; highlight?: 'pos' | 'warn' | 'neg' }) {
  const ring = highlight === 'pos' ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white'
    : highlight === 'warn' ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-white'
    : highlight === 'neg' ? 'border-red-200 bg-gradient-to-br from-red-50 to-white'
    : 'border-zinc-200 bg-white';
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-2 ${ring}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-500 flex items-center justify-center flex-shrink-0">
          <i className={`${icon} text-sm`} />
        </span>
        <span className="text-xs font-semibold text-zinc-500 truncate">{label}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums tracking-tight ${valueTone ?? 'text-zinc-900'}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

function Panel({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-3 flex-wrap border-b border-zinc-100">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
          {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-xl px-3 h-9 w-full sm:w-64">
      <i className="ri-search-line text-zinc-400 text-sm" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="flex-1 min-w-0 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none" />
      {value && <button onClick={() => onChange('')} className="text-zinc-400 hover:text-zinc-600 cursor-pointer"><i className="ri-close-line" /></button>}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <i className={`${icon} text-3xl text-zinc-200 mb-2`} />
      <p className="text-sm text-zinc-400">{text}</p>
    </div>
  );
}

function Chip({ children, tone = 'bg-zinc-100 text-zinc-600' }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${tone}`}>{children}</span>;
}

// ─── Aba Lojas ───────────────────────────────────────────────────────────────

const MANUTENCAO: { action: StoreAction; label: string; desc: string; icon: string; cls: string }[] = [
  { action: 'clear_orders', label: 'Zerar pedidos', desc: 'Pedidos, sessões e pagamentos', icon: 'ri-shopping-bag-line', cls: 'text-orange-700 hover:bg-orange-50 border-orange-200' },
  { action: 'clear_stock', label: 'Zerar estoque', desc: 'Movimentações e lotes', icon: 'ri-stock-line', cls: 'text-orange-700 hover:bg-orange-50 border-orange-200' },
  { action: 'reset', label: 'Resetar loja', desc: 'Apaga tudo, início do zero', icon: 'ri-restart-line', cls: 'text-red-700 hover:bg-red-50 border-red-200' },
  { action: 'delete', label: 'Deletar loja', desc: 'Remove permanentemente', icon: 'ri-delete-bin-2-line', cls: 'text-white bg-red-600 hover:bg-red-700 border-red-600' },
];

function LojaDetalhe({
  tenant, users, onAction, onChanged,
}: { tenant: TenantInfo; users: AdminUser[]; onAction: (a: StoreAction) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [novoUser, setNovoUser] = useState('');
  const [novoRole, setNovoRole] = useState('cashier');

  const membros = users
    .map((u) => ({ u, m: u.memberships.find((m) => m.tenant_id === tenant.id) }))
    .filter((x): x is { u: AdminUser; m: AdminUser['memberships'][number] } => !!x.m)
    .sort((a, b) => a.u.name.localeCompare(b.u.name));
  const candidatos = users.filter((u) => u.is_active && !u.memberships.some((m) => m.tenant_id === tenant.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 px-5 py-4 bg-zinc-50/60 border-t border-zinc-100">
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
          <i className="ri-team-line text-zinc-400" />
          <p className="text-xs font-bold text-zinc-700 flex-1">Quem acessa esta loja</p>
          <span className="text-[11px] text-zinc-400 tabular-nums">{membros.length}</span>
        </div>
        <div className="divide-y divide-zinc-100">
          {membros.length === 0 && <p className="px-4 py-6 text-center text-xs text-zinc-400">Ninguém tem acesso ainda.</p>}
          {membros.map(({ u, m }) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-2">
              <Avatar user={u} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-800 truncate">{u.name}</p>
                <p className="text-[11px] text-zinc-400 truncate">{u.email}</p>
              </div>
              {busy === u.id && <div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}
              <RoleSelect value={m.role} disabled={busy !== null} onChange={(v) => run(u.id, () => setUserTenant(u.id, tenant.id, v))} />
              <button
                title="Tirar acesso"
                disabled={busy !== null}
                onClick={async () => {
                  if (!(await confirmar({ titulo: `Tirar o acesso de ${u.name} à ${tenant.name}?`, confirmarLabel: 'Tirar acesso', perigo: true }))) return;
                  run(u.id, () => removeUserTenant(u.id, tenant.id));
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 cursor-pointer disabled:opacity-40"
              >
                <i className="ri-user-unfollow-line text-sm" />
              </button>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-zinc-100 flex items-center gap-2 flex-wrap bg-zinc-50/40">
          <select value={novoUser} onChange={(e) => setNovoUser(e.target.value)}
            className="flex-1 min-w-[160px] text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-amber-400">
            <option value="">Dar acesso a outra pessoa…</option>
            {candidatos.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
          </select>
          <RoleSelect value={novoRole} onChange={setNovoRole} />
          <button
            disabled={!novoUser || busy !== null}
            onClick={() => run('novo', async () => { await setUserTenant(novoUser, tenant.id, novoRole); setNovoUser(''); })}
            className="px-3 py-1.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg cursor-pointer disabled:opacity-40 whitespace-nowrap"
          >
            Adicionar
          </button>
        </div>
        {error && <p className="px-4 pb-3 text-xs text-red-600">{error}</p>}
      </div>

      <div className="space-y-3">
        <div className="bg-white rounded-xl border border-zinc-200 p-4 grid grid-cols-2 gap-3">
          {[
            ['Ingredientes', tenant.ingredientes], ['Itens cardápio', tenant.itens_cardapio],
            ['Mov. estoque', tenant.mov_estoque], ['Pagamentos', tenant.pagamentos],
          ].map(([l, v]) => (
            <div key={l as string}>
              <p className="text-[11px] text-zinc-400">{l}</p>
              <p className="text-sm font-bold text-zinc-800 tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-3">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-500 flex items-center justify-center flex-shrink-0">
              <i className="ri-hard-drive-2-line text-sm" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-zinc-700">Backup diário</p>
              <p className="text-[10px] text-zinc-400 leading-tight">
                Inclui os dados desta loja no backup automático de madrugada (salvo no PC do dono).
              </p>
            </div>
            {busy === 'backup' && <div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
            <button
              disabled={busy !== null}
              onClick={() => run('backup', async () => { await setTenantBackup(tenant.id, !tenant.backup_enabled); })}
              className={`relative w-10 rounded-full transition-colors cursor-pointer disabled:opacity-40 flex-shrink-0 ${tenant.backup_enabled ? 'bg-emerald-500' : 'bg-zinc-300'}`}
              style={{ height: '22px' }}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${tenant.backup_enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-3 space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 px-1 pb-1">Manutenção</p>
          {MANUTENCAO.map((a) => (
            <button key={a.action} onClick={() => onAction(a.action)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left cursor-pointer transition-colors ${a.cls}`}>
              <i className={`${a.icon} text-sm`} />
              <span className="flex-1">
                <span className="block text-xs font-bold">{a.label}</span>
                <span className="block text-[10px] opacity-70">{a.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LojasTab({
  tenants, users, loading, onAction, onChanged,
}: { tenants: TenantInfo[]; users: AdminUser[]; loading: boolean; onAction: (t: TenantInfo, a: StoreAction) => void; onChanged: () => void }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const comAcesso = users.filter((u) => u.memberships.length > 0).length;
  const lista = tenants.filter((t) => !busca || t.name.toLowerCase().includes(busca.toLowerCase()) || t.slug.includes(busca.toLowerCase()));
  const pessoas = (t: TenantInfo) => users.filter((u) => u.memberships.some((m) => m.tenant_id === t.id)).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Lojas" icon="ri-store-2-line" value={tenants.length} />
        <Stat label="Pessoas com acesso" icon="ri-team-line" value={comAcesso} sub={`${users.length - comAcesso} sem loja`} />
        <Stat label="Pedidos" icon="ri-shopping-bag-line" value={tenants.reduce((s, t) => s + t.pedidos, 0).toLocaleString('pt-BR')} />
        <Stat label="Faturamento" icon="ri-money-dollar-box-line" value={fmtCurrency(tenants.reduce((s, t) => s + t.faturamento, 0))} valueTone="text-emerald-700" highlight="pos" />
      </div>

      <Panel title="Lojas" subtitle="Clique numa loja para ver quem acessa, mudar perfis e fazer manutenção"
        right={<SearchBox value={busca} onChange={setBusca} placeholder="Buscar loja..." />}>
        {loading ? <Loading /> : lista.length === 0 ? <Empty icon="ri-store-2-line" text="Nenhuma loja encontrada" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-zinc-50/60">
                  <th className={TH}>Loja</th>
                  <th className={`${TH} text-right`}>Pessoas</th>
                  <th className={`${TH} text-right`}>Pedidos</th>
                  <th className={`${TH} text-right`}>Faturamento</th>
                  <th className={TH}>Criada em</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lista.map((t) => {
                  const open = aberta === t.id;
                  return (
                    <FragmentRow key={t.id}>
                      <tr onClick={() => setAberta(open ? null : t.id)}
                        className={`border-t border-zinc-100 cursor-pointer transition-colors ${open ? 'bg-amber-50/40' : 'hover:bg-zinc-50/60'}`}>
                        <td className={TD}>
                          <div className="flex items-center gap-3">
                            <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0"><i className="ri-store-2-line" /></span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-zinc-800 truncate">{t.name}</p>
                              <p className="text-[11px] text-zinc-400 font-mono truncate">{t.slug}</p>
                            </div>
                          </div>
                        </td>
                        <td className={`${TD} text-right text-sm tabular-nums text-zinc-700`}>{pessoas(t)}</td>
                        <td className={`${TD} text-right text-sm tabular-nums text-zinc-700`}>{t.pedidos.toLocaleString('pt-BR')}</td>
                        <td className={`${TD} text-right text-sm tabular-nums font-semibold text-zinc-800`}>{fmtCurrency(t.faturamento)}</td>
                        <td className={`${TD} text-xs text-zinc-400 whitespace-nowrap`}>{fmtDate(t.created_at)}</td>
                        <td className={`${TD} text-zinc-400`}><i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} /></td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <LojaDetalhe tenant={t} users={users} onAction={(a) => onAction(t, a)} onChanged={onChanged} />
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ─── Aba Usuários ────────────────────────────────────────────────────────────

type FiltroUser = 'todos' | 'sem_loja' | 'pausados';

function UsuariosTab({
  users, loading, onAccess, onEdit, onResend, onAction,
}: {
  users: AdminUser[];
  loading: boolean;
  onAccess: (u: AdminUser) => void;
  onEdit: (u: AdminUser) => void;
  onResend: (u: AdminUser) => void;
  onAction: (u: AdminUser, a: UserAction) => void;
}) {
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroUser>('todos');
  const [menu, setMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return;
    const h = () => setMenu(null);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [menu]);

  const semLoja = users.filter((u) => u.memberships.length === 0);
  const pausados = users.filter((u) => !u.is_active);
  const lista = users.filter((u) => {
    if (filtro === 'sem_loja' && u.memberships.length > 0) return false;
    if (filtro === 'pausados' && u.is_active) return false;
    const q = busca.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      || u.memberships.some((m) => m.tenant_name.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Usuários" icon="ri-user-line" value={users.length} />
        <Stat label="Com loja" icon="ri-store-2-line" value={users.length - semLoja.length} />
        <Stat label="Sem loja" icon="ri-question-line" value={semLoja.length} highlight={semLoja.length ? 'warn' : undefined} valueTone={semLoja.length ? 'text-amber-600' : undefined} sub="Caem na tela de convite" />
        <Stat label="Pausados" icon="ri-pause-circle-line" value={pausados.length} highlight={pausados.length ? 'neg' : undefined} valueTone={pausados.length ? 'text-red-600' : undefined} />
      </div>

      <Panel title="Usuários" subtitle="Lojas, perfil em cada loja e módulos liberados"
        right={
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <Segmented<FiltroUser> value={filtro} onChange={setFiltro} options={[
              { id: 'todos', label: 'Todos', icon: 'ri-list-check' },
              { id: 'sem_loja', label: 'Sem loja', icon: 'ri-question-line' },
              { id: 'pausados', label: 'Pausados', icon: 'ri-pause-circle-line' },
            ]} />
            <SearchBox value={busca} onChange={setBusca} placeholder="Nome, e-mail ou loja..." />
          </div>
        }>
        {loading ? <Loading /> : lista.length === 0 ? <Empty icon="ri-user-line" text="Nenhum usuário encontrado" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="bg-zinc-50/60">
                  <th className={TH}>Usuário</th>
                  <th className={TH}>Lojas e perfil</th>
                  <th className={TH}>Módulos</th>
                  <th className={TH}>Último acesso</th>
                  <th className="w-36" />
                </tr>
              </thead>
              <tbody>
                {lista.map((u) => {
                  const owner = isOwnerUser(u);
                  const mods = MODULOS_LIVRES.filter((m) => owner || u.modules.includes(m.id)
                    || (m.id === 'tarefas' && u.memberships.some((x) => x.role === 'tasks_only')));
                  return (
                    <tr key={u.id} className={`border-t border-zinc-100 hover:bg-zinc-50/60 ${!u.is_active ? 'opacity-70' : ''}`}>
                      <td className={TD}>
                        <div className="flex items-center gap-3">
                          <Avatar user={u} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-zinc-800 truncate max-w-[220px]">{u.name}</p>
                              {owner && <Chip tone="bg-amber-100 text-amber-700"><i className="ri-shield-star-line" />Master</Chip>}
                              {!u.is_active && <Chip tone="bg-red-50 text-red-600">Pausado</Chip>}
                            </div>
                            <p className="text-[11px] text-zinc-400 truncate max-w-[260px]">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className={TD}>
                        {u.memberships.length === 0 ? <Chip tone="bg-amber-50 text-amber-700">Sem loja</Chip> : (
                          <div className="flex flex-wrap gap-1 max-w-[340px]">
                            {u.memberships.slice(0, 3).map((m) => (
                              <Chip key={m.tenant_id}>
                                <span className="truncate max-w-[130px]">{m.tenant_name}</span>
                                <span className="text-zinc-400 font-medium">· {ROLE_LABEL[m.role] ?? m.role}</span>
                              </Chip>
                            ))}
                            {u.memberships.length > 3 && (
                              <button onClick={() => onAccess(u)} className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer px-1">
                                +{u.memberships.length - 3}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={TD}>
                        {mods.length === 0 ? <span className="text-zinc-300 text-xs">—</span> : (
                          <div className="flex flex-wrap gap-1">
                            {mods.map((m) => <Chip key={m.id} tone={m.tone}><i className={m.icon} />{m.label}</Chip>)}
                          </div>
                        )}
                      </td>
                      <td className={`${TD} text-xs text-zinc-400 whitespace-nowrap`}>{u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : 'Nunca'}</td>
                      <td className={`${TD} text-right`}>
                        <div className="flex items-center justify-end gap-1 relative" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => onAccess(u)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-lg text-xs font-semibold text-zinc-700 cursor-pointer whitespace-nowrap">
                            <i className="ri-key-2-line text-amber-500" /> Acessos
                          </button>
                          <button onClick={() => setMenu(menu === u.id ? null : u.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer">
                            <i className="ri-more-2-fill" />
                          </button>
                          {menu === u.id && (
                            <div className="absolute right-0 top-9 z-20 bg-white border border-zinc-200 rounded-xl shadow-lg w-48 overflow-hidden text-left">
                              {[
                                { l: 'Editar dados', i: 'ri-edit-line text-sky-500', f: () => onEdit(u) },
                                { l: 'Reenviar credenciais', i: 'ri-send-plane-line text-violet-500', f: () => onResend(u) },
                                u.is_active
                                  ? { l: 'Pausar acesso', i: 'ri-pause-circle-line text-amber-500', f: () => onAction(u, 'pause') }
                                  : { l: 'Reativar acesso', i: 'ri-play-circle-line text-emerald-500', f: () => onAction(u, 'reactivate') },
                              ].map((o) => (
                                <button key={o.l} onClick={() => { o.f(); setMenu(null); }}
                                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer">
                                  <i className={o.i} /> {o.l}
                                </button>
                              ))}
                              <div className="border-t border-zinc-100" />
                              <button onClick={() => { onAction(u, 'delete'); setMenu(null); }}
                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer">
                                <i className="ri-delete-bin-line" /> Deletar usuário
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Aba Convites ────────────────────────────────────────────────────────────

type FiltroConvite = 'todos' | 'pendentes' | 'usados';

function ConvitesTab({
  invites, loading, onNew, onDelete,
}: { invites: StoreInvite[]; loading: boolean; onNew: () => void; onDelete: (i: StoreInvite) => void }) {
  const [filtro, setFiltro] = useState<FiltroConvite>('todos');
  const [busca, setBusca] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = async (inv: StoreInvite) => {
    try { await navigator.clipboard.writeText(inv.invite_code); } catch {
      const el = document.createElement('textarea');
      el.value = inv.invite_code; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopiedId(inv.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const pendentes = invites.filter((i) => !i.used_at).length;
  const q = busca.toLowerCase();
  const lista = invites.filter((inv) => {
    const f = filtro === 'todos' || (filtro === 'pendentes' && !inv.used_at) || (filtro === 'usados' && !!inv.used_at);
    return f && (!q || [inv.label, inv.invite_code, inv.used_by_email, inv.used_by_tenant_name].some((s) => (s ?? '').toLowerCase().includes(q)));
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Códigos criados" icon="ri-links-line" value={invites.length} />
        <Stat label="Pendentes" icon="ri-time-line" value={pendentes} valueTone={pendentes ? 'text-amber-600' : undefined} highlight={pendentes ? 'warn' : undefined} />
        <Stat label="Lojas criadas" icon="ri-store-2-line" value={invites.length - pendentes} valueTone="text-emerald-700" highlight="pos" />
      </div>

      <Panel title="Códigos de convite" subtitle="Cada código cria uma loja nova, uma única vez"
        right={
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <Segmented<FiltroConvite> value={filtro} onChange={setFiltro} options={[
              { id: 'todos', label: 'Todos', icon: 'ri-list-check' },
              { id: 'pendentes', label: 'Pendentes', icon: 'ri-time-line' },
              { id: 'usados', label: 'Utilizados', icon: 'ri-store-2-line' },
            ]} />
            <SearchBox value={busca} onChange={setBusca} placeholder="Nome, código, loja..." />
          </div>
        }>
        {loading ? <Loading /> : lista.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <Empty icon="ri-link" text={busca || filtro !== 'todos' ? 'Nenhum código encontrado' : 'Nenhum código criado ainda'} />
            {!busca && filtro === 'todos' && (
              <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer">
                <i className="ri-add-line" /> Criar primeiro código
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-zinc-50/60">
                  <th className={TH}>Status</th>
                  <th className={TH}>Identificação</th>
                  <th className={TH}>Código</th>
                  <th className={TH}>Criado em</th>
                  <th className={TH}>Uso</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {lista.map((inv) => {
                  const used = !!inv.used_at;
                  return (
                    <tr key={inv.id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                      <td className={TD}>
                        <Chip tone={used ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                          <i className={used ? 'ri-store-2-line' : 'ri-time-line'} />{used ? 'Utilizado' : 'Pendente'}
                        </Chip>
                      </td>
                      <td className={TD}>
                        {inv.label ? <p className="text-sm font-semibold text-zinc-800">{inv.label}</p> : <p className="text-sm text-zinc-400 italic">Sem identificação</p>}
                        {inv.notes && <p className="text-[11px] text-zinc-400 truncate max-w-[240px]">{inv.notes}</p>}
                      </td>
                      <td className={TD}><code className="text-xs font-mono font-bold text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded-md tracking-widest">{inv.invite_code}</code></td>
                      <td className={`${TD} text-xs text-zinc-400 whitespace-nowrap`}>{fmtDate(inv.created_at)}</td>
                      <td className={TD}>
                        {used ? (
                          <div>
                            {inv.used_by_tenant_name && <p className="text-xs font-semibold text-emerald-700">{inv.used_by_tenant_name}</p>}
                            <p className="text-[11px] text-zinc-400">
                              {fmtDate(inv.used_at!)}
                              {inv.used_by_email && inv.used_by_email !== 'utilizado via onboarding' && ` · ${inv.used_by_email}`}
                            </p>
                          </div>
                        ) : <span className="text-zinc-300 text-xs">—</span>}
                      </td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        {!used && (
                          <button onClick={() => copy(inv)} title="Copiar código"
                            className={`w-7 h-7 inline-flex items-center justify-center rounded-lg cursor-pointer ${copiedId === inv.id ? 'bg-emerald-50 text-emerald-600' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'}`}>
                            <i className={copiedId === inv.id ? 'ri-check-line' : 'ri-file-copy-line'} />
                          </button>
                        )}
                        <button onClick={() => onDelete(inv)} title="Excluir"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 cursor-pointer">
                          <i className="ri-delete-bin-line" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function AdminMasterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('lojas');

  const [invites, setInvites] = useState<StoreInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  const [showNewInvite, setShowNewInvite] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showNewFinance, setShowNewFinance] = useState(false);
  const [showNewStore, setShowNewStore] = useState(false);
  const [confirmDeleteInvite, setConfirmDeleteInvite] = useState<StoreInvite | null>(null);
  const [storeAction, setStoreAction] = useState<StoreActionModal | null>(null);
  const [accessUserId, setAccessUserId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [resendUser, setResendUser] = useState<AdminUser | null>(null);
  const [userAction, setUserAction] = useState<{ user: AdminUser; action: UserAction } | null>(null);

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true);
    const { data } = await supabase.rpc('fn_get_store_invites_v2');
    setInvites((data as StoreInvite[]) ?? []);
    setInvitesLoading(false);
  }, []);

  const loadTenants = useCallback(async () => {
    setTenantsLoading(true);
    const { data } = await supabase.rpc('fn_admin_get_tenants');
    setTenants((data as TenantInfo[]) ?? []);
    setTenantsLoading(false);
  }, []);

  // Recarrega sem spinner quando já tem dados (mudanças de acesso não piscam a tela).
  const loadUsers = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_admin_list_users_v4');
    if (!error && data) setUsers(data as unknown as AdminUser[]);
    setUsersLoading(false);
  }, []);

  const isMaster = user?.email === ADMIN_MASTER_EMAIL;

  useEffect(() => {
    if (!isMaster) return;
    loadInvites();
    loadTenants();
    loadUsers();
  }, [isMaster, loadInvites, loadTenants, loadUsers]);

  const accessUser = useMemo(() => users.find((u) => u.id === accessUserId) ?? null, [users, accessUserId]);

  if (user && !isMaster) {
    navigate('/modulos', { replace: true });
    return null;
  }

  const refreshing = invitesLoading || tenantsLoading || usersLoading;
  const pendentes = invites.filter((i) => !i.used_at).length;

  const handleDeleteInvite = async (inv: StoreInvite) => {
    await supabase.rpc('fn_delete_store_invite', { p_id: inv.id });
    setConfirmDeleteInvite(null);
    loadInvites();
  };

  return (
    <div className="h-full overflow-y-auto bg-zinc-50">
      <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
        {/* ── Cabeçalho ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate('/modulos')} title="Voltar aos módulos"
            className="w-10 h-10 flex items-center justify-center bg-white border border-zinc-200 rounded-xl text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 cursor-pointer shadow-sm">
            <i className="ri-arrow-left-line" />
          </button>
          <div className="w-10 h-10 flex items-center justify-center bg-amber-500 rounded-xl">
            <i className="ri-shield-star-line text-white text-lg" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-zinc-900 leading-tight">Admin Master</h1>
            <p className="text-xs text-zinc-400">Lojas, acessos, módulos e convites — só você vê esta tela</p>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => { loadInvites(); loadTenants(); loadUsers(); }} title="Atualizar"
              className="w-10 h-10 flex items-center justify-center bg-white border border-zinc-200 rounded-xl text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 cursor-pointer shadow-sm">
              <i className={`ri-refresh-line ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            {tab === 'convites' && (
              <button onClick={() => setShowNewInvite(true)}
                className="flex items-center gap-2 px-4 h-10 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap shadow-sm">
                <i className="ri-add-line text-sm" /> Novo código
              </button>
            )}
            {tab === 'lojas' && (
              <button onClick={() => setShowNewStore(true)}
                className="flex items-center gap-2 px-4 h-10 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap shadow-sm">
                <i className="ri-store-2-line text-sm" /> Nova loja
              </button>
            )}
            {tab === 'lojas' && (
              <button onClick={() => setShowNewFinance(true)}
                className="flex items-center gap-2 px-4 h-10 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap shadow-sm">
                <i className="ri-building-line text-sm" /> Nova empresa financeira
              </button>
            )}
            {(tab === 'usuarios' || tab === 'lojas') && (
              <button onClick={() => setShowCreateUser(true)}
                className="flex items-center gap-2 px-4 h-10 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap shadow-sm">
                <i className="ri-user-add-line text-sm" /> Novo usuário
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <Segmented<Tab> value={tab} onChange={setTab} options={[
            { id: 'lojas', label: `Lojas · ${tenants.length}`, icon: 'ri-store-2-line' },
            { id: 'usuarios', label: `Usuários · ${users.length}`, icon: 'ri-user-line' },
            { id: 'modulos', label: 'Módulos', icon: 'ri-apps-2-line' },
            { id: 'convites', label: pendentes ? `Convites · ${pendentes} pendente${pendentes > 1 ? 's' : ''}` : 'Convites', icon: 'ri-link' },
          ]} />
        </div>

        {tab === 'lojas' && (
          <LojasTab tenants={tenants} users={users} loading={tenantsLoading} onChanged={() => { loadUsers(); loadTenants(); }}
            onAction={(tenant, action) => setStoreAction({ tenant, action })} />
        )}
        {tab === 'usuarios' && (
          <UsuariosTab users={users} loading={usersLoading}
            onAccess={(u) => setAccessUserId(u.id)} onEdit={setEditUser} onResend={setResendUser}
            onAction={(u, action) => setUserAction({ user: u, action })} />
        )}
        {tab === 'modulos' && (usersLoading ? <Loading /> : <ModulosTab users={users} onChanged={loadUsers} />)}
        {tab === 'convites' && (
          <ConvitesTab invites={invites} loading={invitesLoading} onNew={() => setShowNewInvite(true)} onDelete={setConfirmDeleteInvite} />
        )}
      </div>

      {/* ── Modais ── */}
      {accessUser && (
        <UserAccessModal user={accessUser} tenants={tenants} onClose={() => setAccessUserId(null)}
          onChanged={() => { loadUsers(); loadTenants(); }} />
      )}
      {showNewInvite && <NewInviteModal onClose={() => setShowNewInvite(false)} onCreated={loadInvites} />}
      {showNewFinance && (
        <NewFinanceTenantModal
          users={users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.name, email: u.email }))}
          onClose={() => setShowNewFinance(false)}
          onCreated={() => { loadTenants(); loadUsers(); }}
        />
      )}
      {showNewStore && (
        <NewFinanceTenantModal kind="loja"
          users={users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.name, email: u.email }))}
          onClose={() => setShowNewStore(false)}
          onCreated={() => { loadTenants(); loadUsers(); }}
        />
      )}
      {showCreateUser && (
        <CreateUserModal invites={invites} onClose={() => setShowCreateUser(false)}
          onCreated={() => { loadInvites(); loadUsers(); }} />
      )}
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSaved={loadUsers} />}
      {resendUser && <ResendCredentialsModal user={resendUser} onClose={() => setResendUser(null)} />}
      {userAction && (
        <UserActionModal user={userAction.user} action={userAction.action}
          onClose={() => setUserAction(null)} onDone={loadUsers} />
      )}
      {storeAction && (
        <StoreActionConfirmModal modal={storeAction} onClose={() => setStoreAction(null)}
          onDone={() => { loadTenants(); loadInvites(); loadUsers(); }} />
      )}
      {confirmDeleteInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center bg-red-50 rounded-xl flex-shrink-0">
                <i className="ri-delete-bin-line text-red-600 text-lg" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900">Excluir código?</p>
                <p className="text-xs text-zinc-500 mt-0.5">{confirmDeleteInvite.label ?? confirmDeleteInvite.invite_code}</p>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              {confirmDeleteInvite.used_at
                ? 'Este código já foi utilizado. Excluir apenas remove o registro histórico.'
                : 'O código será invalidado e não poderá mais ser usado para criar uma loja.'}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteInvite(null)} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer">Cancelar</button>
              <button onClick={() => handleDeleteInvite(confirmDeleteInvite)} className="flex-1 py-2 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 cursor-pointer">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
