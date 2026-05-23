import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

const ADMIN_MASTER_EMAIL = 'natalinojr.engel@gmail.com';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreInvite {
  id: string;
  invite_code: string;
  label: string | null;
  created_by: string;
  used_at: string | null;
  used_by_tenant_id: string | null;
  used_by_email: string | null;
  used_by_tenant_name: string | null;
  expires_at: string | null;
  created_at: string;
  notes: string | null;
}

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  pedidos: number;
  sessoes: number;
  pagamentos: number;
  mov_estoque: number;
  ingredientes: number;
  itens_cardapio: number;
  usuarios: number;
  faturamento: number;
}

type StoreAction = 'clear_orders' | 'clear_stock' | 'reset' | 'delete';

interface StoreActionModal {
  tenant: TenantInfo;
  action: StoreAction;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

// ─── Novo Invite Modal ────────────────────────────────────────────────────────

interface NewInviteModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewInviteModal({ onClose, onCreated }: NewInviteModalProps) {
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<StoreInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // isPublicDomainAvailable não é mais necessário — sem links

  const handleCreate = async () => {
    setLoading(true);
    setErrorMsg(null);
    const code = generateCode();
    const { data, error } = await supabase.rpc('fn_create_store_invite', {
      p_invite_code: code,
      p_label: label.trim() || null,
      p_notes: notes.trim() || null,
      p_created_by: ADMIN_MASTER_EMAIL,
    });
    setLoading(false);
    if (error) { setErrorMsg(`Erro: ${error.message}`); return; }
    const c = Array.isArray(data) ? data[0] : data;
    if (!c) { setErrorMsg('Nenhum dado retornado. Tente novamente.'); return; }
    setCreated(c as StoreInvite);
    onCreated();
  };

  const handleCopy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); } catch {
      const el = document.createElement('textarea');
      el.value = url; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const SYSTEM_URL = 'https://erpos.readdy.co/';

  const mensagem = created
    ? `Olá! Você foi convidado para configurar seu restaurante no ERPOS V2.\n\nSeu código de convite é:\n*${created.invite_code}*\n\nFaça login no sistema e insira esse código para configurar sua loja.\n\n*Acesse agora:*\n${SYSTEM_URL}`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-xl">
              <i className="ri-link text-amber-600 text-sm" />
            </div>
            <h2 className="text-sm font-black text-zinc-900">{created ? 'Código criado!' : 'Gerar novo código de convite'}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">

          {!created ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Identificação (opcional)</label>
                <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex: Restaurante do João, Pizzaria Silva..."
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Observações (opcional)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anotações internas..." rows={2} maxLength={300}
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 resize-none" />
              </div>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                <p className="text-xs text-amber-800">Um código único será gerado. Ele pode ser usado apenas uma vez para criar uma nova loja.</p>
              </div>
              {errorMsg && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{errorMsg}</p>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
                <button onClick={handleCreate} disabled={loading}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-amber-500 rounded-xl hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap flex items-center justify-center gap-2">
                  {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-add-line" />}
                  {loading ? 'Gerando...' : 'Gerar código'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <div className="w-8 h-8 flex items-center justify-center bg-emerald-100 rounded-lg flex-shrink-0">
                  <i className="ri-checkbox-circle-fill text-emerald-600 text-base" />
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-800">Código criado com sucesso!</p>
                  {created.label && <p className="text-xs text-emerald-600">{created.label}</p>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 mb-1.5">Código do convite</label>
                <div className="flex items-center gap-2 p-3 bg-zinc-50 rounded-xl border border-zinc-200">
                  <code className="flex-1 text-lg font-mono font-black text-zinc-800 tracking-widest">{created.invite_code}</code>
                  <button onClick={() => handleCopy(created.invite_code)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition-all ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-900 text-white hover:bg-zinc-700'}`}>
                    {copied ? <><i className="ri-check-line text-xs" /> Copiado!</> : <><i className="ri-file-copy-line text-xs" /> Copiar</>}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                  <i className="ri-information-line" />
                  O usuário digita este código no primeiro acesso para criar a loja.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`, '_blank')}
                  className="flex items-center justify-center gap-2 py-2.5 bg-[#25D366] hover:bg-[#1ebe5d] text-white rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap">
                  <i className="ri-whatsapp-line text-sm" /> WhatsApp
                </button>
                <button onClick={() => window.open(`mailto:?subject=${encodeURIComponent('Convite ERPOS V2')}&body=${encodeURIComponent(mensagem)}`, '_blank')}
                  className="flex items-center justify-center gap-2 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap">
                  <i className="ri-mail-line text-sm" /> E-mail
                </button>
              </div>
              <button onClick={onClose} className="w-full py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Fechar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Store Action Confirm Modal ───────────────────────────────────────────────

const ACTION_CONFIG: Record<StoreAction, {
  label: string;
  desc: string;
  warning: string;
  btnColor: string;
  icon: string;
  confirmWord: string;
}> = {
  clear_orders: {
    label: 'Zerar pedidos',
    desc: 'Remove todos os pedidos, sessões de caixa, pagamentos e histórico de vendas.',
    warning: 'Esta ação é irreversível. O cardápio, estoque e configurações permanecem intactos.',
    btnColor: 'bg-orange-500 hover:bg-orange-600',
    icon: 'ri-shopping-bag-line',
    confirmWord: 'ZERAR PEDIDOS',
  },
  clear_stock: {
    label: 'Zerar estoque',
    desc: 'Remove todas as movimentações de estoque, lotes e produção. Zera o estoque atual de todos os ingredientes.',
    warning: 'Esta ação é irreversível. O cadastro de ingredientes permanece, apenas o saldo e histórico são zerados.',
    btnColor: 'bg-orange-500 hover:bg-orange-600',
    icon: 'ri-stock-line',
    confirmWord: 'ZERAR ESTOQUE',
  },
  reset: {
    label: 'Resetar loja',
    desc: 'Remove TUDO: pedidos, estoque, cardápio, mesas, pagamentos, dados financeiros, clientes. A loja fica como recém-criada.',
    warning: 'Irreversível. Os usuários e o tenant em si são mantidos, mas todos os dados operacionais são apagados.',
    btnColor: 'bg-red-500 hover:bg-red-600',
    icon: 'ri-restart-line',
    confirmWord: 'RESETAR LOJA',
  },
  delete: {
    label: 'Deletar loja',
    desc: 'Apaga a loja completamente do sistema, incluindo todos os dados e usuários exclusivos dela.',
    warning: 'AÇÃO DESTRUTIVA TOTAL. A loja e todos os seus dados serão permanentemente excluídos. Não há recuperação.',
    btnColor: 'bg-red-600 hover:bg-red-700',
    icon: 'ri-delete-bin-2-line',
    confirmWord: 'DELETAR LOJA',
  },
};

interface StoreActionModalProps {
  modal: StoreActionModal;
  onClose: () => void;
  onDone: () => void;
}

function StoreActionConfirmModal({ modal, onClose, onDone }: StoreActionModalProps) {
  const { tenant, action } = modal;
  const cfg = ACTION_CONFIG[action];
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const confirmed = confirmText.trim().toUpperCase() === cfg.confirmWord;

  const handleExecute = async () => {
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    try {
      let rpcName = '';
      if (action === 'clear_orders') rpcName = 'fn_admin_clear_orders';
      else if (action === 'clear_stock') rpcName = 'fn_admin_clear_stock';
      else if (action === 'reset') rpcName = 'fn_admin_reset_tenant';
      else if (action === 'delete') rpcName = 'fn_admin_delete_tenant';

      const { error: rpcError } = await supabase.rpc(rpcName, { p_tenant_id: tenant.id });
      if (rpcError) throw rpcError;
      setDone(true);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const isDestructive = action === 'delete' || action === 'reset';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        <div className={`px-5 py-4 ${isDestructive ? 'bg-red-600' : 'bg-orange-500'}`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-white/20 rounded-xl">
              <i className={`${cfg.icon} text-white text-lg`} />
            </div>
            <div>
              <p className="text-white font-black text-sm">{cfg.label}</p>
              <p className="text-white/70 text-xs">{tenant.name}</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          {done ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 rounded-full mx-auto mb-3">
                <i className="ri-checkbox-circle-fill text-emerald-600 text-2xl" />
              </div>
              <p className="text-sm font-black text-zinc-900">Operação concluída!</p>
              <p className="text-xs text-zinc-500 mt-1">{cfg.label} executado com sucesso.</p>
              <button onClick={onClose} className="mt-4 w-full py-2.5 bg-zinc-900 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap">Fechar</button>
            </div>
          ) : (
            <>
              <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200">
                <p className="text-xs text-zinc-700 leading-relaxed">{cfg.desc}</p>
              </div>
              <div className={`p-3 rounded-xl border ${isDestructive ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'}`}>
                <div className="flex items-start gap-2">
                  <i className={`ri-alert-line text-sm flex-shrink-0 mt-0.5 ${isDestructive ? 'text-red-600' : 'text-orange-600'}`} />
                  <p className={`text-xs leading-relaxed font-semibold ${isDestructive ? 'text-red-700' : 'text-orange-700'}`}>{cfg.warning}</p>
                </div>
              </div>

              {/* Resumo da loja */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-zinc-50 rounded-lg p-2">
                  <p className="text-base font-black text-zinc-800">{tenant.pedidos}</p>
                  <p className="text-[10px] text-zinc-500">pedidos</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2">
                  <p className="text-base font-black text-zinc-800">{tenant.mov_estoque}</p>
                  <p className="text-[10px] text-zinc-500">mov. estoque</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2">
                  <p className="text-base font-black text-zinc-800">{tenant.usuarios}</p>
                  <p className="text-[10px] text-zinc-500">usuários</p>
                </div>
              </div>

              {/* Confirmação por digitação */}
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                  Para confirmar, digite <strong className={isDestructive ? 'text-red-600' : 'text-orange-600'}>{cfg.confirmWord}</strong>
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={cfg.confirmWord}
                  className={`w-full text-sm border rounded-xl px-3 py-2.5 font-mono font-bold focus:outline-none focus:ring-2 transition-all ${
                    confirmed ? 'border-emerald-400 bg-emerald-50 focus:ring-emerald-300' : 'border-zinc-200 focus:ring-red-300'
                  }`}
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-xs text-red-700 font-semibold">{error}</p>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={onClose} disabled={loading} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap disabled:opacity-50">
                  Cancelar
                </button>
                <button
                  onClick={handleExecute}
                  disabled={!confirmed || loading}
                  className={`flex-1 py-2.5 text-sm font-bold text-white rounded-xl cursor-pointer whitespace-nowrap disabled:opacity-40 transition-all flex items-center justify-center gap-2 ${cfg.btnColor}`}
                >
                  {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className={cfg.icon} />}
                  {loading ? 'Executando...' : cfg.label}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tenant Card ──────────────────────────────────────────────────────────────

interface TenantCardProps {
  tenant: TenantInfo;
  onAction: (tenant: TenantInfo, action: StoreAction) => void;
}

function TenantCard({ tenant, onAction }: TenantCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-50/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="w-9 h-9 flex items-center justify-center bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex-shrink-0">
          <i className="ri-store-2-line text-white text-base" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 truncate">{tenant.name}</p>
          <p className="text-[10px] text-zinc-400 truncate font-mono">{tenant.slug}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-right">
            <div>
              <p className="text-xs font-bold text-zinc-800">{tenant.pedidos}</p>
              <p className="text-[9px] text-zinc-400">pedidos</p>
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-800">{fmtCurrency(tenant.faturamento)}</p>
              <p className="text-[9px] text-zinc-400">faturamento</p>
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-800">{tenant.usuarios}</p>
              <p className="text-[9px] text-zinc-400">usuários</p>
            </div>
          </div>
          {expanded ? <i className="ri-arrow-up-s-line text-zinc-400 text-base" /> : <i className="ri-arrow-down-s-line text-zinc-400 text-base" />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-zinc-100 px-4 py-4 space-y-4">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Pedidos', value: tenant.pedidos, icon: 'ri-shopping-bag-line', color: 'text-amber-600 bg-amber-50' },
              { label: 'Faturamento', value: fmtCurrency(tenant.faturamento), icon: 'ri-money-dollar-circle-line', color: 'text-emerald-600 bg-emerald-50' },
              { label: 'Mov. Estoque', value: tenant.mov_estoque, icon: 'ri-box-3-line', color: 'text-sky-600 bg-sky-50' },
              { label: 'Ingredientes', value: tenant.ingredientes, icon: 'ri-leaf-line', color: 'text-teal-600 bg-teal-50' },
              { label: 'Itens Cardápio', value: tenant.itens_cardapio, icon: 'ri-menu-line', color: 'text-orange-600 bg-orange-50' },
              { label: 'Sessões', value: tenant.sessoes, icon: 'ri-calendar-check-line', color: 'text-indigo-600 bg-indigo-50' },
              { label: 'Pagamentos', value: tenant.pagamentos, icon: 'ri-bank-card-line', color: 'text-violet-600 bg-violet-50' },
              { label: 'Usuários', value: tenant.usuarios, icon: 'ri-user-line', color: 'text-zinc-600 bg-zinc-100' },
            ].map((s) => (
              <div key={s.label} className={`flex items-center gap-2 p-2.5 rounded-lg ${s.color.split(' ')[1]}`}>
                <i className={`${s.icon} text-sm flex-shrink-0 ${s.color.split(' ')[0]}`} />
                <div className="min-w-0">
                  <p className="text-xs font-black text-zinc-800 truncate">{s.value}</p>
                  <p className="text-[9px] text-zinc-500 truncate">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-zinc-400 flex items-center gap-1">
            <i className="ri-calendar-line" />
            Criada em {fmtDate(tenant.created_at)}
          </p>

          {/* Ações */}
          <div className="border-t border-zinc-100 pt-3">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Ações de manutenção</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onAction(tenant, 'clear_orders')}
                className="flex items-center gap-2 px-3 py-2.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl text-xs font-bold text-orange-700 cursor-pointer transition-colors text-left"
              >
                <i className="ri-shopping-bag-line text-sm flex-shrink-0" />
                <div>
                  <p>Zerar pedidos</p>
                  <p className="text-[9px] font-normal text-orange-500">Remove pedidos e sessões</p>
                </div>
              </button>
              <button
                onClick={() => onAction(tenant, 'clear_stock')}
                className="flex items-center gap-2 px-3 py-2.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl text-xs font-bold text-orange-700 cursor-pointer transition-colors text-left"
              >
                <i className="ri-stock-line text-sm flex-shrink-0" />
                <div>
                  <p>Zerar estoque</p>
                  <p className="text-[9px] font-normal text-orange-500">Remove movimentações e lotes</p>
                </div>
              </button>
              <button
                onClick={() => onAction(tenant, 'reset')}
                className="flex items-center gap-2 px-3 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl text-xs font-bold text-red-700 cursor-pointer transition-colors text-left"
              >
                <i className="ri-restart-line text-sm flex-shrink-0" />
                <div>
                  <p>Resetar loja</p>
                  <p className="text-[9px] font-normal text-red-500">Apaga tudo, início do zero</p>
                </div>
              </button>
              <button
                onClick={() => onAction(tenant, 'delete')}
                className="flex items-center gap-2 px-3 py-2.5 bg-red-600 hover:bg-red-700 rounded-xl text-xs font-bold text-white cursor-pointer transition-colors text-left"
              >
                <i className="ri-delete-bin-2-line text-sm flex-shrink-0" />
                <div>
                  <p>Deletar loja</p>
                  <p className="text-[9px] font-normal text-red-200">Remove permanentemente</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Create User Modal ────────────────────────────────────────────────────────

interface CreateUserModalProps {
  invites: StoreInvite[];
  onClose: () => void;
  onCreated: () => void;
}

function CreateUserModal({ invites, onClose, onCreated }: CreateUserModalProps) {
  const { user: adminUser } = useAuth();
  const [nome, setNome] = useState('');
  const [apelido, setApelido] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ nome: string; apelido?: string; email: string; invite_code?: string } | null>(null);
  const [copiedSenha, setCopiedSenha] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Auto-preenche apelido com o primeiro nome quando o nome muda
  const handleNomeChange = (v: string) => {
    setNome(v);
    if (!apelido) {
      const primeiroNome = v.trim().split(' ')[0];
      setApelido(primeiroNome);
    }
  };

  const pendingInvites = invites.filter(inv => !inv.used_at);

  const generatePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
    setSenha(p);
  };

  const handleCopy = async (text: string, setCopied: (v: boolean) => void) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const el = document.createElement('textarea');
      el.value = text; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const handleCreate = async () => {
    if (!nome.trim()) { setError('Nome é obrigatório'); return; }
    if (!email.trim() || !email.includes('@')) { setError('E-mail inválido'); return; }
    if (!senha || senha.length < 6) { setError('Senha deve ter no mínimo 6 caracteres'); return; }
    setLoading(true);
    setError(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token ?? SUPABASE_ANON_KEY;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          nome: nome.trim(),
          email: email.trim().toLowerCase(),
          senha,
          nickname: apelido.trim() || undefined,
          invite_code: inviteCode || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao criar usuário');
        setLoading(false);
        return;
      }

      setCreated({
        nome: data.nome,
        apelido: apelido.trim() || undefined,
        email: data.email,
        invite_code: inviteCode || undefined,
      });
      // Aguarda um tick antes de notificar para garantir que o banco já registrou
      setTimeout(() => onCreated(), 600);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const SYSTEM_URL = 'https://erpos.readdy.co/';
  const saudacao = created?.apelido || created?.nome?.split(' ')[0] || created?.nome || '';

  const mensagem = created
    ? `Olá, ${saudacao}! Seu acesso ao ERPOS V2 foi criado.\n\n*Dados de acesso:*\nE-mail: ${created.email}\nSenha: ${senha}${
        created.invite_code
          ? `\n\n*Código de convite (para criar sua loja):*\n${created.invite_code}`
          : ''
      }\n\nNo primeiro acesso, faça login e insira o código de convite para configurar sua loja.\n\n*Acesse agora:*\n${SYSTEM_URL}`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-teal-100 rounded-xl">
              <i className="ri-user-add-line text-teal-600 text-sm" />
            </div>
            <h2 className="text-sm font-black text-zinc-900">{created ? 'Usuário criado!' : 'Criar novo usuário'}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {!created ? (
            <>
              <div className="p-3 bg-teal-50 border border-teal-100 rounded-xl">
                <p className="text-xs text-teal-800 leading-relaxed">
                  O usuário será criado <strong>sem loja vinculada</strong>. No primeiro acesso, ele verá uma tela para inserir o código de convite e criar a loja dele.
                </p>
              </div>

              {/* Nome + Apelido */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome completo</label>
                  <input type="text" value={nome} onChange={e => handleNomeChange(e.target.value)}
                    placeholder="Ex: João Silva"
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                    Apelido
                    <span className="text-zinc-400 font-normal ml-1">(saud.)</span>
                  </label>
                  <input type="text" value={apelido} onChange={e => setApelido(e.target.value)}
                    placeholder="Ex: Joãozinho"
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-teal-400" />
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 -mt-2 flex items-center gap-1">
                <i className="ri-chat-smile-2-line" />
                O apelido aparece na mensagem: &quot;Olá, <strong>{apelido || nome.split(' ')[0] || 'nome'}!</strong>&quot;
              </p>

              {/* E-mail */}
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">E-mail</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="joao@exemplo.com"
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-teal-400" />
              </div>

              {/* Senha */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-zinc-600">Senha provisória</label>
                  <button onClick={generatePassword} className="text-xs text-teal-600 font-semibold hover:text-teal-700 cursor-pointer">
                    <i className="ri-refresh-line mr-1" />Gerar automática
                  </button>
                </div>
                <div className="relative">
                  <input type={showSenha ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 pr-10 focus:outline-none focus:border-teal-400" />
                  <button onClick={() => setShowSenha(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 cursor-pointer">
                    <i className={`${showSenha ? 'ri-eye-off-line' : 'ri-eye-line'} text-sm`} />
                  </button>
                </div>
              </div>

              {/* Vincular convite */}
              {pendingInvites.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                    Vincular a um convite <span className="text-zinc-400 font-normal">(opcional)</span>
                  </label>
                  <select value={inviteCode} onChange={e => setInviteCode(e.target.value)}
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-teal-400 bg-white">
                    <option value="">Sem convite vinculado</option>
                    {pendingInvites.map(inv => (
                      <option key={inv.id} value={inv.invite_code}>
                        {inv.label ? `${inv.label} — ${inv.invite_code}` : inv.invite_code}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-zinc-400 mt-1">
                    Se vincular, o link de onboarding ficará pronto para enviar junto com as credenciais.
                  </p>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
                  Cancelar
                </button>
                <button onClick={handleCreate} disabled={loading}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-teal-500 rounded-xl hover:bg-teal-600 disabled:opacity-50 cursor-pointer whitespace-nowrap flex items-center justify-center gap-2">
                  {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-user-add-line" />}
                  {loading ? 'Criando...' : 'Criar usuário'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <div className="w-8 h-8 flex items-center justify-center bg-emerald-100 rounded-lg flex-shrink-0">
                  <i className="ri-checkbox-circle-fill text-emerald-600 text-base" />
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-800">Usuário criado!</p>
                  <p className="text-xs text-emerald-600">{created.nome} · {created.email}</p>
                </div>
              </div>

              {/* Credenciais */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider">Dados de acesso</label>
                <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] text-zinc-400">E-mail</p>
                      <p className="text-sm font-mono font-bold text-zinc-800 truncate">{created.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] text-zinc-400">Senha provisória</p>
                      <p className="text-sm font-mono font-bold text-zinc-800">{senha}</p>
                    </div>
                    <button onClick={() => handleCopy(senha, setCopiedSenha)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition-all flex-shrink-0 ${copiedSenha ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-200 text-zinc-600 hover:bg-zinc-300'}`}>
                      {copiedSenha ? <><i className="ri-check-line text-xs" /> Copiado</> : <><i className="ri-file-copy-line text-xs" /> Copiar</>}
                    </button>
                  </div>
                </div>
              </div>

              {/* Código do convite */}
              {created.invite_code && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">Código de convite</label>
                  <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-200">
                    <i className="ri-key-2-line text-amber-500 text-sm flex-shrink-0" />
                    <code className="flex-1 text-base font-mono font-black text-zinc-800 tracking-widest">{created.invite_code}</code>
                    <button onClick={() => handleCopy(created.invite_code!, setCopiedLink)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition-all flex-shrink-0 ${copiedLink ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-900 text-white hover:bg-zinc-700'}`}>
                      {copiedLink ? <><i className="ri-check-line text-xs" /> Copiado</> : <><i className="ri-file-copy-line text-xs" /> Copiar</>}
                    </button>
                  </div>
                  <p className="text-[10px] text-amber-700 mt-1 flex items-center gap-1">
                    <i className="ri-information-line" />
                    O usuário digita este código no primeiro acesso para criar a loja.
                  </p>
                </div>
              )}

              {/* Compartilhar */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`, '_blank')}
                  className="flex items-center justify-center gap-2 py-2.5 bg-[#25D366] hover:bg-[#1ebe5d] text-white rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap">
                  <i className="ri-whatsapp-line text-sm" /> WhatsApp
                </button>
                <button onClick={() => window.open(`mailto:${created.email}?subject=${encodeURIComponent('Bem-vindo ao ERPOS V2')}&body=${encodeURIComponent(mensagem)}`, '_blank')}
                  className="flex items-center justify-center gap-2 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap">
                  <i className="ri-mail-line text-sm" /> E-mail
                </button>
              </div>

              <button onClick={onClose} className="w-full py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Edit User Modal ──────────────────────────────────────────────────────────

interface EditUserModalProps {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
}

function EditUserModal({ user, onClose, onSaved }: EditUserModalProps) {
  const [nome, setNome] = useState(user.name);
  const [apelido, setApelido] = useState(user.nickname ?? '');
  const [email, setEmail] = useState(user.email);
  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const generatePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
    setSenha(p);
  };

  const handleSave = async () => {
    if (!nome.trim()) { setError('Nome é obrigatório'); return; }
    if (!email.trim() || !email.includes('@')) { setError('E-mail inválido'); return; }
    if (senha && senha.length < 6) { setError('Senha deve ter no mínimo 6 caracteres'); return; }
    setLoading(true);
    setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token ?? SUPABASE_ANON_KEY;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-manage-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: 'update', user_id: user.id, nome, email, senha: senha || undefined, nickname: apelido }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Erro ao atualizar'); setLoading(false); return; }
      setSuccess(true);
      setTimeout(() => { onSaved(); onClose(); }, 1200);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-sky-100 rounded-xl">
              <i className="ri-edit-line text-sky-600 text-sm" />
            </div>
            <div>
              <h2 className="text-sm font-black text-zinc-900">Editar usuário</h2>
              <p className="text-[11px] text-zinc-400">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 rounded-full">
                <i className="ri-checkbox-circle-fill text-emerald-600 text-2xl" />
              </div>
              <p className="text-sm font-bold text-zinc-800">Dados atualizados!</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome completo</label>
                  <input type="text" value={nome} onChange={e => setNome(e.target.value)}
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-sky-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                    Apelido
                    <span className="text-zinc-400 font-normal ml-1">(saud.)</span>
                  </label>
                  <input type="text" value={apelido} onChange={e => setApelido(e.target.value)}
                    placeholder={nome.split(' ')[0]}
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-sky-400" />
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 -mt-2 flex items-center gap-1">
                <i className="ri-chat-smile-2-line" />
                Mensagem: &quot;Olá, <strong>{apelido || nome.split(' ')[0] || '...'}!</strong>&quot;
              </p>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">E-mail</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-zinc-600">Nova senha <span className="text-zinc-400 font-normal">(opcional)</span></label>
                  <button onClick={generatePassword} className="text-xs text-sky-600 font-semibold hover:text-sky-700 cursor-pointer">
                    <i className="ri-refresh-line mr-1" />Gerar
                  </button>
                </div>
                <div className="relative">
                  <input type={showSenha ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)}
                    placeholder="Deixe em branco para não alterar"
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 pr-10 focus:outline-none focus:border-sky-400" />
                  <button onClick={() => setShowSenha(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 cursor-pointer">
                    <i className={`${showSenha ? 'ri-eye-off-line' : 'ri-eye-line'} text-sm`} />
                  </button>
                </div>
              </div>
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
                <button onClick={handleSave} disabled={loading}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-sky-500 rounded-xl hover:bg-sky-600 disabled:opacity-50 cursor-pointer whitespace-nowrap flex items-center justify-center gap-2">
                  {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-save-line" />}
                  {loading ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Delete / Toggle User Modal ───────────────────────────────────────────────

type UserAction = 'pause' | 'reactivate' | 'delete';

interface UserActionModalProps {
  user: AdminUser;
  action: UserAction;
  onClose: () => void;
  onDone: () => void;
}

function UserActionModal({ user, action, onClose, onDone }: UserActionModalProps) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const cfg = {
    pause: { label: 'Pausar acesso', desc: 'O usuário não conseguirá mais fazer login até ser reativado. Os dados e lojas vinculadas ficam preservados.', btnColor: 'bg-amber-500 hover:bg-amber-600', icon: 'ri-pause-circle-line', headerColor: 'bg-amber-500', needsConfirm: false },
    reactivate: { label: 'Reativar acesso', desc: 'O usuário voltará a conseguir fazer login normalmente.', btnColor: 'bg-emerald-500 hover:bg-emerald-600', icon: 'ri-play-circle-line', headerColor: 'bg-emerald-500', needsConfirm: false },
    delete: { label: 'Deletar usuário', desc: 'O usuário será removido permanentemente do sistema, incluindo acesso e registro. As lojas vinculadas permanecem, mas o vínculo com este usuário é desfeito.', btnColor: 'bg-red-600 hover:bg-red-700', icon: 'ri-delete-bin-2-line', headerColor: 'bg-red-600', needsConfirm: true },
  }[action];

  const confirmed = !cfg.needsConfirm || confirmText.trim().toUpperCase() === 'DELETAR';

  const handleExecute = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token ?? SUPABASE_ANON_KEY;
      let body: Record<string, unknown>;
      if (action === 'delete') {
        body = { action: 'delete', user_id: user.id };
      } else {
        body = { action: 'toggle_active', user_id: user.id, is_active: action === 'reactivate' };
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-manage-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Erro'); setLoading(false); return; }
      setDone(true);
      setTimeout(() => { onDone(); onClose(); }, 1200);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
        <div className={`px-5 py-4 ${cfg.headerColor}`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-white/20 rounded-xl">
              <i className={`${cfg.icon} text-white text-lg`} />
            </div>
            <div>
              <p className="text-white font-black text-sm">{cfg.label}</p>
              <p className="text-white/70 text-xs truncate max-w-[200px]">{user.name}</p>
            </div>
          </div>
        </div>
        <div className="px-5 py-5 space-y-4">
          {done ? (
            <div className="flex flex-col items-center py-4 gap-3">
              <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 rounded-full">
                <i className="ri-checkbox-circle-fill text-emerald-600 text-2xl" />
              </div>
              <p className="text-sm font-bold text-zinc-800">{cfg.label} concluído!</p>
            </div>
          ) : (
            <>
              <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200">
                <p className="text-xs text-zinc-700 leading-relaxed">{cfg.desc}</p>
              </div>
              {cfg.needsConfirm && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                    Para confirmar, digite <strong className="text-red-600">DELETAR</strong>
                  </label>
                  <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
                    placeholder="DELETAR"
                    className={`w-full text-sm border rounded-xl px-3 py-2.5 font-mono font-bold focus:outline-none transition-all ${
                      confirmed ? 'border-emerald-400 bg-emerald-50' : 'border-zinc-200 focus:border-red-300'
                    }`} />
                </div>
              )}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-xs text-red-700 font-semibold">{error}</p>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={onClose} disabled={loading} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap disabled:opacity-50">Cancelar</button>
                <button onClick={handleExecute} disabled={!confirmed || loading}
                  className={`flex-1 py-2.5 text-sm font-bold text-white rounded-xl cursor-pointer whitespace-nowrap disabled:opacity-40 transition-all flex items-center justify-center gap-2 ${cfg.btnColor}`}>
                  {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className={cfg.icon} />}
                  {loading ? 'Executando...' : cfg.label}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Reenviar Credenciais Modal ─────────────────────────────────────────────

interface ResendCredentialsModalProps {
  user: AdminUser;
  onClose: () => void;
}

function ResendCredentialsModal({ user, onClose }: ResendCredentialsModalProps) {
  const SYSTEM_URL = 'https://erpos.readdy.co/';
  const [novaSenha, setNovaSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const saudacao = user.nickname || user.name.split(' ')[0];

  const generatePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
    setNovaSenha(p);
  };

  const handleCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const el = document.createElement('textarea');
      el.value = text; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const handleResetAndSend = async (channel: 'whatsapp' | 'email') => {
    if (!novaSenha || novaSenha.length < 6) {
      setError('Gere ou defina uma nova senha antes de reenviar');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token ?? SUPABASE_ANON_KEY;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-manage-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ action: 'update', user_id: user.id, senha: novaSenha }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Erro ao redefinir senha'); setLoading(false); return; }

      const mensagem = `Olá, ${saudacao}! Seus dados de acesso ao ERPOS V2 foram atualizados.\n\n*Dados de acesso:*\nE-mail: ${user.email}\nSenha: ${novaSenha}${
        inviteCode ? `\n\n*Código de convite (para criar sua loja):*\n${inviteCode}` : ''
      }\n\nNo primeiro acesso, faça login e insira o código de convite para configurar sua loja.\n\n*Acesse agora:*\n${SYSTEM_URL}`;

      if (channel === 'whatsapp') {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`, '_blank');
      } else {
        window.open(`mailto:${user.email}?subject=${encodeURIComponent('Seus dados de acesso ERPOS V2')}&body=${encodeURIComponent(mensagem)}`, '_blank');
      }
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const mensagemPreview = `Olá, ${saudacao}! Seus dados de acesso ao ERPOS V2 foram atualizados.\n\nE-mail: ${user.email}\nSenha: ${novaSenha || '(defina a senha acima)'}${
    inviteCode ? `\n\nCódigo de convite: ${inviteCode}` : ''
  }\n\nAcesse: ${SYSTEM_URL}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-violet-100 rounded-xl">
              <i className="ri-send-plane-line text-violet-600 text-sm" />
            </div>
            <div>
              <h2 className="text-sm font-black text-zinc-900">Reenviar credenciais</h2>
              <p className="text-[11px] text-zinc-400">{user.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Info do usuário */}
          <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-xl border border-zinc-200">
            <div className="w-9 h-9 flex items-center justify-center rounded-xl bg-violet-100 text-violet-700 font-black text-sm flex-shrink-0">
              {user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-zinc-800">{user.name}</p>
              <p className="text-xs text-zinc-400 truncate">{user.email}</p>
              {user.nickname && (
                <p className="text-[10px] text-violet-600 font-semibold">
                  <i className="ri-chat-smile-2-line mr-0.5" />
                  Apelido: {user.nickname}
                </p>
              )}
            </div>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <p className="text-xs text-amber-800 leading-relaxed">
              Uma nova senha será definida para o usuário. Gere ou escreva a nova senha e depois envie pelo canal preferido.
            </p>
          </div>

          {/* Nova senha */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-zinc-600">Nova senha</label>
              <button onClick={generatePassword} className="text-xs text-violet-600 font-semibold hover:text-violet-700 cursor-pointer">
                <i className="ri-refresh-line mr-1" />Gerar automática
              </button>
            </div>
            <div className="relative">
              <input type={showSenha ? 'text' : 'password'} value={novaSenha} onChange={e => setNovaSenha(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 pr-20 focus:outline-none focus:border-violet-400" />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {novaSenha && (
                  <button onClick={() => handleCopy(novaSenha)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-all ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                    {copied ? <i className="ri-check-line" /> : <i className="ri-file-copy-line" />}
                  </button>
                )}
                <button onClick={() => setShowSenha(v => !v)} className="text-zinc-400 cursor-pointer">
                  <i className={`${showSenha ? 'ri-eye-off-line' : 'ri-eye-line'} text-sm`} />
                </button>
              </div>
            </div>
          </div>

          {/* Código de convite opcional */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Código de convite <span className="text-zinc-400 font-normal">(opcional)</span>
            </label>
            <input type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())}
              placeholder="Ex: XXXX-XXXX-XXXX"
              className="w-full text-sm font-mono border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-400 tracking-widest" />
            <p className="text-[10px] text-zinc-400 mt-1">Inclua se quiser que o usuário crie/configure uma loja.</p>
          </div>

          {/* Preview da mensagem */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">Preview da mensagem</label>
            <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
              <pre className="text-xs text-zinc-600 leading-relaxed whitespace-pre-wrap font-sans">{mensagemPreview}</pre>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {/* Botões de envio */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleResetAndSend('whatsapp')}
              disabled={loading || !novaSenha || novaSenha.length < 6}
              className="flex items-center justify-center gap-2 py-2.5 bg-[#25D366] hover:bg-[#1ebe5d] disabled:opacity-40 text-white rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap">
              {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-whatsapp-line text-sm" />}
              WhatsApp
            </button>
            <button
              onClick={() => handleResetAndSend('email')}
              disabled={loading || !novaSenha || novaSenha.length < 6}
              className="flex items-center justify-center gap-2 py-2.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap">
              <i className="ri-mail-line text-sm" /> E-mail
            </button>
          </div>

          <button onClick={onClose} className="w-full py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  email: string;
  name: string;
  nickname: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  tenant_count: number;
  tenants: string[];
  is_active: boolean;
}

interface UsersTabProps {
  invites: StoreInvite[];
  onRefreshInvites: () => void;
  refreshTrigger?: number;
}

function UsersTab({ invites, onRefreshInvites, refreshTrigger }: UsersTabProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [busca, setBusca] = useState('');
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [actionModal, setActionModal] = useState<{ user: AdminUser; action: UserAction } | null>(null);
  const [resendModal, setResendModal] = useState<AdminUser | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_admin_list_users_v3');
      if (!error && data) setUsers(data as AdminUser[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers, refreshTrigger]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = () => setMenuOpenId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpenId]);

  const filtrados = users.filter(u =>
    !busca ||
    u.name.toLowerCase().includes(busca.toLowerCase()) ||
    u.email.toLowerCase().includes(busca.toLowerCase())
  );

  const semLoja = users.filter(u => u.tenant_count === 0);
  const comLoja = users.filter(u => u.tenant_count > 0);
  const pausados = users.filter(u => !u.is_active);

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white border border-amber-100 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Total</p>
          <p className="text-2xl font-black text-zinc-900">{users.length}</p>
        </div>
        <div className="bg-white border border-amber-100 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Com loja</p>
          <p className="text-2xl font-black text-amber-600">{comLoja.length}</p>
        </div>
        <div className="bg-white border border-amber-100 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Sem loja</p>
          <p className="text-2xl font-black text-amber-600">{semLoja.length}</p>
        </div>
        <div className="bg-white border border-red-200 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Pausados</p>
          <p className="text-2xl font-black text-red-500">{pausados.length}</p>
        </div>
      </div>

      {/* Busca */}
      <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-xl px-3 py-2.5 mb-4">
        <i className="ri-search-line text-zinc-400 text-sm flex-shrink-0" />
        <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome ou e-mail..."
          className="flex-1 text-sm bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none" />
        {busca && <button onClick={() => setBusca('')} className="text-zinc-400 hover:text-zinc-600 cursor-pointer"><i className="ri-close-line text-sm" /></button>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-dashed border-zinc-200 rounded-2xl">
          <i className="ri-user-line text-4xl text-zinc-200 mb-3" />
          <p className="text-sm font-semibold text-zinc-500">{busca ? 'Nenhum usuário encontrado' : 'Nenhum usuário criado'}</p>
          {!busca && (
            <button onClick={() => setShowCreateModal(true)}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-teal-500 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap">
              <i className="ri-user-add-line" /> Criar primeiro usuário
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map(u => {
            const semTenant = u.tenant_count === 0;
            const isPaused = !u.is_active;
            const initials = u.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
            const isMenuOpen = menuOpenId === u.id;
            return (
              <div key={u.id} className={`bg-white border rounded-xl p-4 flex items-center gap-4 transition-colors ${
                isPaused ? 'border-red-200 opacity-75' : semTenant ? 'border-amber-200' : 'border-zinc-100'
              }`}>
                {/* Avatar */}
                <div className={`w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 font-black text-sm ${
                  isPaused ? 'bg-red-100 text-red-500' : semTenant ? 'bg-amber-100 text-amber-700' : 'bg-teal-100 text-teal-700'
                }`}>
                  {isPaused ? <i className="ri-pause-circle-line text-base" /> : initials}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-zinc-900 truncate">{u.name}</p>
                    {isPaused && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600 whitespace-nowrap">Pausado</span>}
                    {!isPaused && semTenant && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">Sem loja</span>}
                    {!isPaused && !semTenant && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap">{u.tenant_count} loja{u.tenant_count > 1 ? 's' : ''}</span>}
                  </div>
                  <p className="text-xs text-zinc-400 truncate">{u.email}</p>
                  {u.tenants && u.tenants.length > 0 && (
                    <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                      <i className="ri-store-line mr-0.5" />{u.tenants.join(' · ')}
                    </p>
                  )}
                  {u.last_sign_in_at && (
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      <i className="ri-time-line mr-0.5" />Último acesso: {fmtDate(u.last_sign_in_at)}
                    </p>
                  )}
                </div>

                {/* Action menu */}
                <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setMenuOpenId(isMenuOpen ? null : u.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors">
                    <i className="ri-more-2-fill text-base" />
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-9 z-20 bg-white border border-zinc-200 rounded-xl shadow-lg w-48 overflow-hidden">
                      <button onClick={() => { setEditUser(u); setMenuOpenId(null); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer transition-colors">
                        <i className="ri-edit-line text-sky-500" /> Editar dados
                      </button>
                      <button onClick={() => { setResendModal(u); setMenuOpenId(null); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer transition-colors">
                        <i className="ri-send-plane-line text-violet-500" /> Reenviar credenciais
                      </button>
                      {isPaused ? (
                        <button onClick={() => { setActionModal({ user: u, action: 'reactivate' }); setMenuOpenId(null); }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer transition-colors">
                          <i className="ri-play-circle-line text-emerald-500" /> Reativar acesso
                        </button>
                      ) : (
                        <button onClick={() => { setActionModal({ user: u, action: 'pause' }); setMenuOpenId(null); }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer transition-colors">
                          <i className="ri-pause-circle-line text-amber-500" /> Pausar acesso
                        </button>
                      )}
                      <div className="border-t border-zinc-100" />
                      <button onClick={() => { setActionModal({ user: u, action: 'delete' }); setMenuOpenId(null); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer transition-colors">
                        <i className="ri-delete-bin-line text-red-500" /> Deletar usuário
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreateModal && (
        <CreateUserModal
          invites={invites}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { loadUsers(); onRefreshInvites(); }}
        />
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={loadUsers}
        />
      )}

      {actionModal && (
        <UserActionModal
          user={actionModal.user}
          action={actionModal.action}
          onClose={() => setActionModal(null)}
          onDone={loadUsers}
        />
      )}

      {resendModal && (
        <ResendCredentialsModal
          user={resendModal}
          onClose={() => setResendModal(null)}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminMasterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Invites state
  const [invites, setInvites] = useState<StoreInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteInvite, setConfirmDeleteInvite] = useState<StoreInvite | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'pendentes' | 'usados'>('todos');
  const [busca, setBusca] = useState('');

  // Tenants state
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [actionModal, setActionModal] = useState<StoreActionModal | null>(null);

  // Tab — agora 3 abas
  const [tab, setTab] = useState<'lojas' | 'usuarios' | 'convites'>('lojas');

  // Modal criar usuário da aba de usuários
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [usersRefreshTrigger, setUsersRefreshTrigger] = useState(0);

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

  useEffect(() => {
    loadInvites();
    loadTenants();
  }, [loadInvites, loadTenants]);

  if (user && user.email !== ADMIN_MASTER_EMAIL) {
    navigate('/modulos', { replace: true });
    return null;
  }

  const handleCopyInvite = async (invite: StoreInvite) => {
    try { await navigator.clipboard.writeText(invite.invite_code); } catch {
      const el = document.createElement('textarea');
      el.value = invite.invite_code; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleDeleteInvite = async (invite: StoreInvite) => {
    await supabase.rpc('fn_delete_store_invite', { p_id: invite.id });
    setConfirmDeleteInvite(null);
    loadInvites();
  };

  const filtrados = invites.filter((inv) => {
    const matchFiltro = filtro === 'todos' || (filtro === 'pendentes' && !inv.used_at) || (filtro === 'usados' && !!inv.used_at);
    const matchBusca = !busca ||
      (inv.label ?? '').toLowerCase().includes(busca.toLowerCase()) ||
      inv.invite_code.toLowerCase().includes(busca.toLowerCase()) ||
      (inv.used_by_email ?? '').toLowerCase().includes(busca.toLowerCase()) ||
      (inv.used_by_tenant_name ?? '').toLowerCase().includes(busca.toLowerCase());
    return matchFiltro && matchBusca;
  });

  const totalPendentes = invites.filter((i) => !i.used_at).length;
  const totalUsados = invites.filter((i) => !!i.used_at).length;

  return (
    <div className="flex flex-col h-full bg-amber-50/30">
      {/* Header */}
      <div
        className="px-4 md:px-6 py-4 flex-shrink-0 border-b border-amber-200/60"
        style={{ background: 'linear-gradient(180deg, #fdf6ee 0%, #faecd8 100%)' }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/modulos')}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 hover:text-amber-900 cursor-pointer transition-colors border border-amber-200">
              <i className="ri-arrow-left-line text-sm" />
            </button>
            <div className="w-8 h-8 flex items-center justify-center bg-amber-500 rounded-xl">
              <i className="ri-shield-star-line text-white text-base" />
            </div>
            <div>
              <h1 className="text-base font-black text-zinc-900">Admin Master</h1>
              <p className="text-xs text-amber-700/70">Gestão de lojas e convites — acesso restrito</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { loadInvites(); loadTenants(); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 hover:text-amber-900 cursor-pointer transition-colors border border-amber-200"
              title="Atualizar"
            >
              <i className={`ri-refresh-line text-sm ${(invitesLoading || tenantsLoading) ? 'animate-spin' : ''}`} />
            </button>
            {tab === 'convites' && (
              <button onClick={() => setShowNewModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors">
                <i className="ri-add-line text-sm" />
                <span className="hidden sm:inline">Novo código de convite</span>
                <span className="sm:hidden">Novo código</span>
              </button>
            )}
            {tab === 'usuarios' && (
              <button onClick={() => setShowCreateUserModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors">
                <i className="ri-user-add-line text-sm" />
                <span className="hidden sm:inline">Novo usuário</span>
                <span className="sm:hidden">Novo</span>
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-4 bg-amber-100/80 rounded-xl p-1 w-fit border border-amber-200">
          <button
            onClick={() => setTab('lojas')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${tab === 'lojas' ? 'bg-amber-500 text-white' : 'text-amber-800 hover:text-amber-950 hover:bg-amber-200/60'}`}
          >
            <i className="ri-store-2-line text-sm" />
            Lojas
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${tab === 'lojas' ? 'bg-white/25 text-white' : 'bg-amber-200 text-amber-800'}`}>{tenants.length}</span>
          </button>
          <button
            onClick={() => setTab('usuarios')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${tab === 'usuarios' ? 'bg-amber-500 text-white' : 'text-amber-800 hover:text-amber-950 hover:bg-amber-200/60'}`}
          >
            <i className="ri-user-line text-sm" />
            Usuários
          </button>
          <button
            onClick={() => setTab('convites')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${tab === 'convites' ? 'bg-amber-500 text-white' : 'text-amber-800 hover:text-amber-950 hover:bg-amber-200/60'}`}
          >
            <i className="ri-link text-sm" />
            Convites
            {totalPendentes > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${tab === 'convites' ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'}`}>{totalPendentes}</span>
            )}
          </button>
        </div>
      </div>

      {/* ── ABA: GESTÃO DE LOJAS ── */}
      {tab === 'lojas' && (
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
          {/* Stats globais */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-white border border-amber-100 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Total de lojas</p>
              <p className="text-2xl font-black text-zinc-900">{tenants.length}</p>
            </div>
            <div className="bg-white border border-amber-100 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Total pedidos</p>
              <p className="text-2xl font-black text-zinc-900">{tenants.reduce((s, t) => s + t.pedidos, 0)}</p>
            </div>
            <div className="bg-white border border-amber-100 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Total usuários</p>
              <p className="text-2xl font-black text-zinc-900">{tenants.reduce((s, t) => s + t.usuarios, 0)}</p>
            </div>
            <div className="bg-white border border-emerald-200 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Faturamento total</p>
              <p className="text-xl font-black text-emerald-600">{fmtCurrency(tenants.reduce((s, t) => s + t.faturamento, 0))}</p>
            </div>
          </div>

          {tenantsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {tenants.map((t) => (
                <TenantCard
                  key={t.id}
                  tenant={t}
                  onAction={(tenant, action) => setActionModal({ tenant, action })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ABA: USUÁRIOS ── */}
      {tab === 'usuarios' && (
        <UsersTab invites={invites} onRefreshInvites={loadInvites} refreshTrigger={usersRefreshTrigger} />
      )}

      {/* ── ABA: CONVITES ── */}
      {tab === 'convites' && (
        <>
          {/* Stats convites */}
          <div className="px-4 md:px-6 py-4 flex-shrink-0">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white border border-amber-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 flex items-center justify-center bg-amber-50 rounded-lg">
                    <i className="ri-links-line text-amber-600 text-sm" />
                  </div>
                  <p className="text-xs text-zinc-500 font-medium">Total de códigos</p>
                </div>
                <p className="text-2xl font-black text-zinc-900">{invites.length}</p>
              </div>
              <div className="bg-white border border-amber-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 flex items-center justify-center bg-amber-100 rounded-lg">
                    <i className="ri-time-line text-amber-600 text-sm" />
                  </div>
                  <p className="text-xs text-zinc-500 font-medium">Pendentes</p>
                </div>
                <p className="text-2xl font-black text-amber-600">{totalPendentes}</p>
              </div>
              <div className="bg-white border border-emerald-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 flex items-center justify-center bg-emerald-100 rounded-lg">
                    <i className="ri-store-2-line text-emerald-600 text-sm" />
                  </div>
                  <p className="text-xs text-zinc-500 font-medium">Lojas criadas</p>
                </div>
                <p className="text-2xl font-black text-emerald-600">{totalUsados}</p>
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="px-4 md:px-6 pb-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
                {(['todos', 'pendentes', 'usados'] as const).map((f) => (
                  <button key={f} onClick={() => setFiltro(f)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap transition-colors capitalize ${filtro === f ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}>
                    {f === 'todos' ? 'Todos' : f === 'pendentes' ? 'Pendentes' : 'Utilizados'}
                  </button>
                ))}
              </div>
              <div className="flex-1 flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2">
                <i className="ri-search-line text-zinc-400 text-sm flex-shrink-0" />
                <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome, código, loja ou e-mail..."
                  className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none" />
                {busca && <button onClick={() => setBusca('')} className="text-zinc-400 hover:text-zinc-600 cursor-pointer"><i className="ri-close-line text-sm" /></button>}
              </div>
            </div>
          </div>

          {/* Lista convites */}
          <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-6">
            {invitesLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-dashed border-zinc-200 rounded-2xl">
                <div className="w-12 h-12 flex items-center justify-center bg-zinc-50 rounded-full mb-3">
                  <i className="ri-link text-2xl text-zinc-300" />
                </div>
                <p className="text-sm font-semibold text-zinc-500 mb-1">{busca || filtro !== 'todos' ? 'Nenhum código encontrado' : 'Nenhum código criado ainda'}</p>
                <p className="text-xs text-zinc-400 mb-4">{busca || filtro !== 'todos' ? 'Tente outros filtros' : 'Clique em "Novo código de convite" para começar'}</p>
                {!busca && filtro === 'todos' && (
                  <button onClick={() => setShowNewModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap">
                    <i className="ri-add-line text-sm" /> Criar primeiro código
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filtrados.map((invite) => {
                  const isUsed = !!invite.used_at;
                  return (
                    <div key={invite.id}
                      className={`bg-white border rounded-xl p-4 transition-colors ${isUsed ? 'border-emerald-100' : 'border-zinc-100 hover:border-zinc-200'}`}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${isUsed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              <i className={isUsed ? 'ri-store-2-line' : 'ri-time-line'} />
                              {isUsed ? 'Utilizado' : 'Pendente'}
                            </span>
                            {invite.label
                              ? <span className="text-sm font-bold text-zinc-800 truncate">{invite.label}</span>
                              : <span className="text-sm font-medium text-zinc-400 italic">Sem identificação</span>}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="text-xs font-mono font-bold text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded-lg tracking-widest">{invite.invite_code}</code>
                            <span className="text-[10px] text-zinc-400"><i className="ri-calendar-line mr-0.5" />{fmtDate(invite.created_at)}</span>
                          </div>
                          {isUsed && (
                            <div className="mt-1.5 space-y-0.5">
                              {invite.used_by_tenant_name && (
                                <p className="text-xs text-emerald-700 flex items-center gap-1 font-semibold">
                                  <i className="ri-store-2-fill" />
                                  Loja criada: <strong>{invite.used_by_tenant_name}</strong>
                                </p>
                              )}
                              <p className="text-xs text-zinc-400 flex items-center gap-1">
                                <i className="ri-time-line" />
                                Utilizado em {fmtDate(invite.used_at!)}
                                {invite.used_by_email && invite.used_by_email !== 'utilizado via onboarding' && (
                                  <span>· por <strong className="text-zinc-500">{invite.used_by_email}</strong></span>
                                )}
                              </p>
                            </div>
                          )}
                          {invite.notes && (
                            <p className="text-xs text-zinc-400 mt-1 italic flex items-center gap-1">
                              <i className="ri-sticky-note-line" />{invite.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!isUsed && (
                            <button onClick={() => handleCopyInvite(invite)}
                              className={`w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-colors ${copiedId === invite.id ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600'}`} title="Copiar código">
                              <i className={`${copiedId === invite.id ? 'ri-check-line' : 'ri-file-copy-line'} text-xs`} />
                            </button>
                          )}
                          <button onClick={() => setConfirmDeleteInvite(invite)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors" title="Excluir">
                            <i className="ri-delete-bin-line text-xs" />
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Modals */}
      {showNewModal && (
        <NewInviteModal onClose={() => setShowNewModal(false)} onCreated={loadInvites} />
      )}

      {showCreateUserModal && (
        <CreateUserModal
          invites={invites}
          onClose={() => setShowCreateUserModal(false)}
          onCreated={() => { loadInvites(); setUsersRefreshTrigger(v => v + 1); }}
        />
      )}

      {confirmDeleteInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                <i className="ri-delete-bin-line text-red-600 text-lg" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900">Excluir link?</p>
                <p className="text-xs text-zinc-500 mt-0.5">{confirmDeleteInvite.label ?? confirmDeleteInvite.invite_code}</p>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              {confirmDeleteInvite.used_at
                ? 'Este link já foi utilizado. Excluir apenas remove o registro histórico.'
                : 'O link será invalidado e não poderá mais ser usado para criar uma nova loja.'}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteInvite(null)} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
              <button onClick={() => handleDeleteInvite(confirmDeleteInvite)} className="flex-1 py-2 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 cursor-pointer whitespace-nowrap">Excluir</button>
            </div>
          </div>
        </div>
      )}

      {actionModal && (
        <StoreActionConfirmModal
          modal={actionModal}
          onClose={() => setActionModal(null)}
          onDone={() => { loadTenants(); loadInvites(); }}
        />
      )}
    </div>
  );
}