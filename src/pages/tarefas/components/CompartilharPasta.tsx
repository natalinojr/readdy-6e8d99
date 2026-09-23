import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, LogOut, Pencil, Share2, Trash2, UserPlus, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import type { TaskList } from '../hooks/useTarefas';
import { iniciais } from './TaskCard';

interface Compartilhamento {
  id: string;
  user_id: string;
  name: string | null;
  email: string | null;
  badge_number: string | null;
  permission: 'view' | 'edit';
  /** Nome da pasta acima de onde vem o acesso (null = compartilhado nesta mesma pasta). */
  inherited_from: string | null;
}

interface CompartilharPastaProps {
  list: TaskList;
  meuId: string | null;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

const PERMISSOES = [
  { value: 'view', label: 'Pode ver', dica: 'Vê as tarefas e comenta', icon: Eye },
  { value: 'edit', label: 'Pode editar', dica: 'Cria e edita tarefas e subpastas', icon: Pencil },
] as const;

/**
 * Compartilhar uma pasta (com todas as subpastas) com outras pessoas, por
 * e-mail ou matrícula. Só o dono muda; quem recebeu vê quem mais tem acesso
 * e pode sair da pasta.
 */
export default function CompartilharPasta({ list, meuId, write, onClose }: CompartilharPastaProps) {
  const toast = useToast();
  const souDono = list.access === 'owner' || list.access === undefined;
  const [itens, setItens] = useState<Compartilhamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [identificador, setIdentificador] = useState('');
  const [permissao, setPermissao] = useState<'view' | 'edit'>('view');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_get_task_list_shares', { p_list_id: list.id });
    if (error) toast.error('Não foi possível carregar quem tem acesso', error.message);
    setItens((data as Compartilhamento[] | null) ?? []);
    setCarregando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const compartilhar = async () => {
    const termo = identificador.trim();
    if (!termo) return;
    setEnviando(true);
    setErro(null);
    const res = await write('share_list', { list_id: list.id, identificador: termo, permission: permissao });
    setEnviando(false);
    if (!res.success) {
      setErro(res.error ?? 'Não foi possível compartilhar');
      return;
    }
    setIdentificador('');
    toast.success('Pasta compartilhada');
    carregar();
  };

  const mudarPermissao = async (item: Compartilhamento, nova: 'view' | 'edit') => {
    setItens((prev) => prev.map((i) => (i.id === item.id ? { ...i, permission: nova } : i)));
    const res = await write('update_share', { share_id: item.id, permission: nova });
    if (!res.success) { toast.error('Não foi possível mudar a permissão', res.error); carregar(); }
  };

  const remover = async (item: Compartilhamento) => {
    const saindo = item.user_id === meuId;
    if (saindo && !confirm(`Sair da pasta "${list.name}"? Você deixa de ver as tarefas dela.`)) return;
    const res = await write('remove_share', { share_id: item.id });
    if (!res.success) { toast.error('Não foi possível remover', res.error); return; }
    if (saindo) { toast.success('Você saiu da pasta'); onClose(); return; }
    setItens((prev) => prev.filter((i) => i.id !== item.id));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Share2 size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-800 truncate">Compartilhar "{list.name}"</h2>
            <p className="text-[11px] text-slate-400">Vale para a pasta e todas as subpastas dela</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>

        {souDono && (
          <form
            onSubmit={(e) => { e.preventDefault(); compartilhar(); }}
            className="px-5 pt-4 pb-3 space-y-2"
          >
            <label className="block text-xs font-medium text-slate-600">E-mail ou matrícula</label>
            <div className="flex gap-2">
              <input
                autoFocus
                value={identificador}
                onChange={(e) => { setIdentificador(e.target.value); setErro(null); }}
                placeholder="ex.: maria@loja.com ou 1234"
                className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300"
              />
              <select
                value={permissao}
                onChange={(e) => setPermissao(e.target.value as 'view' | 'edit')}
                className="border border-slate-200 rounded-lg px-2 py-2 text-xs bg-white outline-none focus:border-indigo-300"
              >
                {PERMISSOES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            {erro && <p className="text-xs text-red-500">{erro}</p>}
            <button
              type="submit"
              disabled={!identificador.trim() || enviando}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium py-2 hover:bg-indigo-700 disabled:opacity-40"
            >
              {enviando ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Compartilhar
            </button>
            <p className="text-[10px] text-slate-400">Só aparece quem tem acesso ao módulo Tarefas (liberado no Admin Master).</p>
          </form>
        )}

        <div className="px-5 pb-5 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Quem tem acesso</p>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            <div className="flex items-center gap-2.5 py-1.5">
              <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-semibold shrink-0">
                {iniciais(list.owner_name ?? 'Dono')}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 truncate">{list.owner_name ?? 'Dono'}{souDono && ' (você)'}</p>
              </div>
              <span className="text-[11px] text-slate-400">Dono</span>
            </div>

            {carregando && <p className="text-xs text-slate-400 py-2">Carregando…</p>}
            {!carregando && itens.length === 0 && (
              <p className="text-xs text-slate-400 py-2">Ainda não está compartilhada com ninguém.</p>
            )}
            {itens.map((i) => (
              <div key={i.id} className="flex items-center gap-2.5 py-1.5 group">
                <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] font-semibold shrink-0">
                  {iniciais(i.name ?? i.email ?? '?')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{i.name ?? 'Usuário'}{i.user_id === meuId && ' (você)'}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {i.inherited_from ? `pela pasta "${i.inherited_from}"` : i.email ?? (i.badge_number ? `matrícula ${i.badge_number}` : '')}
                  </p>
                </div>
                {souDono && !i.inherited_from ? (
                  <select
                    value={i.permission}
                    onChange={(e) => mudarPermissao(i, e.target.value as 'view' | 'edit')}
                    className="text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white outline-none"
                  >
                    {PERMISSOES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                ) : (
                  <span className="text-[11px] text-slate-400">{i.permission === 'edit' ? 'Pode editar' : 'Pode ver'}</span>
                )}
                {((souDono && !i.inherited_from) || (i.user_id === meuId && !i.inherited_from)) && (
                  <button
                    onClick={() => remover(i)}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50"
                    title={i.user_id === meuId ? 'Sair da pasta' : 'Remover acesso'}
                  >
                    {i.user_id === meuId ? <LogOut size={13} /> : <Trash2 size={13} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
