import { useState, useRef, useEffect } from 'react';
import { Plus, Search, Edit2, ShieldCheck, MoreVertical, KeyRound, UserX, UserCheck, Trash2 } from 'lucide-react';
import { perfilConfig, type PerfilUsuario } from '@/constants/usuarios';
import { useUsuarios, type UsuarioReal } from '@/hooks/useUsuarios';
import UsuarioModal from './components/UsuarioModal';

function fmtData(d: string | null) {
  if (!d) return 'Nunca';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Avatar({ nome, size = 'md' }: { nome: string; size?: 'sm' | 'md' }) {
  const iniciais = nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
  const cores = ['bg-amber-400', 'bg-emerald-400', 'bg-sky-400', 'bg-violet-400', 'bg-rose-400', 'bg-orange-400'];
  const cor = cores[nome.charCodeAt(0) % cores.length];
  const sz = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs';
  return (
    <div className={`${sz} ${cor} flex-shrink-0 flex items-center justify-center rounded-full font-bold text-white`}>
      {iniciais}
    </div>
  );
}

interface AcoesMenuProps {
  usuario: UsuarioReal;
  onEditar: () => void;
  onToggleAtivo: () => void;
  onRedefinirSenha: () => void;
  onExcluir: () => void;
}
function AcoesMenu({ usuario, onEditar, onToggleAtivo, onRedefinirSenha, onExcluir }: AcoesMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400 hover:text-zinc-600 transition-colors">
        <MoreVertical size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 bg-white border border-zinc-100 rounded-xl shadow-lg py-1 w-48"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button onClick={() => { onEditar(); setOpen(false); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer">
              <div className="w-4 h-4 flex items-center justify-center"><Edit2 size={12} /></div>
              Editar dados
            </button>
            {usuario.perfil !== 'totem' && (
              <button onClick={() => { onRedefinirSenha(); setOpen(false); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer">
                <div className="w-4 h-4 flex items-center justify-center"><KeyRound size={12} /></div>
                Redefinir senha
              </button>
            )}
            {usuario.perfil === 'totem' && (
              <button onClick={() => { onRedefinirSenha(); setOpen(false); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer">
                <div className="w-4 h-4 flex items-center justify-center"><KeyRound size={12} /></div>
                Redefinir senha do sistema
              </button>
            )}
            <div className="border-t border-zinc-100 my-1" />
            <button onClick={() => { onToggleAtivo(); setOpen(false); }}
              className={`flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium cursor-pointer ${usuario.ativo ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}>
              <div className="w-4 h-4 flex items-center justify-center">
                {usuario.ativo ? <UserX size={12} /> : <UserCheck size={12} />}
              </div>
              {usuario.ativo ? 'Desativar usuário' : 'Reativar usuário'}
            </button>
            <button onClick={() => { onExcluir(); setOpen(false); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 cursor-pointer">
              <div className="w-4 h-4 flex items-center justify-center"><Trash2 size={12} /></div>
              Excluir usuário
            </button>
          </div>
        </>
      )}
    </>
  );
}

function emailDisplay(email: string) {
  if (!email) return '';
  if (email.includes('@totem.erpos.local') || email.includes('@erpos.local')) return '';
  return email;
}

function ConfirmarExclusaoModal({ usuario, onClose, onConfirmar }: { usuario: UsuarioReal; onClose: () => void; onConfirmar: () => Promise<void> }) {
  const [excluindo, setExcluindo] = useState(false);
  const cfg = perfilConfig[usuario.perfil];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 flex items-center justify-center bg-red-50 rounded-xl flex-shrink-0">
            <Trash2 size={18} className="text-red-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900">Excluir usuário</h3>
            <p className="text-xs text-zinc-400">Esta ação não pode ser desfeita</p>
          </div>
        </div>
        <div className="bg-zinc-50 rounded-xl p-3 mb-5">
          <p className="text-sm font-semibold text-zinc-800">{usuario.nome}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.cor}`}>{cfg.label}</span>
            {usuario.matricula && <span className="text-xs text-zinc-400 font-mono">#{usuario.matricula}</span>}
          </div>
        </div>
        <p className="text-xs text-zinc-500 mb-5">
          O usuário perderá acesso imediatamente e será removido do sistema. Pedidos e registros históricos serão mantidos.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer transition-colors whitespace-nowrap">
            Cancelar
          </button>
          <button
            onClick={async () => { setExcluindo(true); await onConfirmar(); setExcluindo(false); }}
            disabled={excluindo}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 cursor-pointer transition-colors whitespace-nowrap disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {excluindo ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 size={14} />}
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

type ModalState =
  | { tipo: 'novo' }
  | { tipo: 'editar'; usuario: UsuarioReal }
  | { tipo: 'senha'; usuario: UsuarioReal }
  | { tipo: 'excluir'; usuario: UsuarioReal }
  | null;

export default function UsuariosPage() {
  const { usuarios, loading, error, toggleAtivo, editarUsuario, criarUsuario, excluirUsuario, redefinirSenha, definirPIN, limparPIN } = useUsuarios();
  const [busca, setBusca] = useState('');
  const [perfilFiltro, setPerfilFiltro] = useState<'todos' | PerfilUsuario>('todos');
  const [statusFiltro, setStatusFiltro] = useState<'todos' | 'ativo' | 'inativo'>('todos');
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null);

  const showToast = (msg: string, tipo: 'ok' | 'erro') => {
    setToast({ msg, tipo });
    setTimeout(() => setToast(null), 3000);
  };

  const filtrados = usuarios.filter((u) => {
    const emailDisplay = u.email?.includes('@totem.erpos.local') || u.email?.includes('@erpos.local') ? '' : (u.email ?? '');
    const matchBusca =
      u.nome.toLowerCase().includes(busca.toLowerCase()) ||
      emailDisplay.toLowerCase().includes(busca.toLowerCase()) ||
      u.matricula.includes(busca);
    const matchPerfil = perfilFiltro === 'todos' || u.perfil === perfilFiltro;
    const matchStatus = statusFiltro === 'todos' || (statusFiltro === 'ativo' ? u.ativo : !u.ativo);
    return matchBusca && matchPerfil && matchStatus;
  });

  const stats = {
    total: usuarios.length,
    ativos: usuarios.filter((u) => u.ativo).length,
    modoTreino: usuarios.filter((u) => u.modoTreino).length,
    porPerfil: (Object.entries(perfilConfig) as [PerfilUsuario, typeof perfilConfig[PerfilUsuario]][]).map(([p, c]) => ({
      perfil: p,
      label: c.label,
      cor: c.cor,
      bg: c.bg,
      count: usuarios.filter((u) => u.perfil === p).length,
    })),
  };

  // Exportar CSV
  const exportarCSV = () => {
    const headers = ['Nome', 'E-mail', 'Matrícula', 'Perfil', 'Status', 'Modo Treino', 'Último Acesso'];
    const rows = filtrados.map((u) => [
      u.nome,
      u.email,
      u.matricula,
      perfilConfig[u.perfil]?.label ?? u.perfil,
      u.ativo ? 'Ativo' : 'Inativo',
      u.modoTreino ? 'Sim' : 'Não',
      u.ultimoAcesso ? new Date(u.ultimoAcesso).toLocaleString('pt-BR') : 'Nunca',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usuarios_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Badge de último acesso
  const badgeAcesso = (ultimoAcesso: string | null, diasDesdeAcesso?: number | null) => {
    if (!ultimoAcesso) return { label: 'Nunca', cls: 'bg-zinc-100 text-zinc-400' };
    // Usa cálculo do servidor quando disponível; evita depender do relógio do cliente
    let diff: number;
    if (diasDesdeAcesso != null) {
      diff = diasDesdeAcesso;
    } else {
      diff = Math.floor((Date.now() - new Date(ultimoAcesso).getTime()) / 86400000);
    }
    if (diff < 1) return { label: 'Hoje', cls: 'bg-emerald-100 text-emerald-700' };
    if (diff <= 7) return { label: `${diff}d atrás`, cls: 'bg-amber-100 text-amber-700' };
    if (diff <= 30) return { label: `${diff}d atrás`, cls: 'bg-zinc-100 text-zinc-500' };
    return { label: `+${diff}d`, cls: 'bg-red-50 text-red-400' };
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 md:px-6 py-4" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-violet-50 rounded-lg">
              <i className="ri-user-settings-line text-violet-600 text-sm" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Usuários</h1>
              <p className="text-xs text-zinc-400 hidden sm:block">Gerenciar equipe, perfis e acessos</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportarCSV}
              className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white text-zinc-600 text-xs font-semibold rounded-lg hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap">
              <i className="ri-download-line text-sm" />
              <span className="hidden sm:inline">Exportar CSV</span>
            </button>
            <button
              onClick={() => setModal({ tipo: 'novo' })}
              className="flex items-center gap-1.5 px-3 md:px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 cursor-pointer transition-colors whitespace-nowrap">
              <Plus size={13} />
              <span className="hidden sm:inline">Novo usuário</span>
              <span className="sm:hidden">Novo</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-5">
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{error}</div>
        )}

        {toast && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium ${toast.tipo === 'ok' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
            {toast.msg}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white border border-zinc-100 rounded-xl p-4">
            <p className="text-2xl font-black text-zinc-900">{stats.total}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Total de usuários</p>
          </div>
          <div className="bg-white border border-zinc-100 rounded-xl p-4">
            <p className="text-2xl font-black text-emerald-600">{stats.ativos}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Ativos</p>
          </div>
          <div className="bg-white border border-zinc-100 rounded-xl p-4">
            <p className="text-2xl font-black text-zinc-400">{stats.total - stats.ativos}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Inativos</p>
          </div>
          <div className="bg-white border border-zinc-100 rounded-xl p-4">
            <p className="text-2xl font-black text-amber-500">{stats.modoTreino}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Modo treino ativo</p>
          </div>
        </div>

        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">Distribuição por perfil</p>
          <div className="flex flex-wrap gap-2">
            {stats.porPerfil.map(({ perfil, label, cor, bg, count }) => (
              <button key={perfil}
                onClick={() => setPerfilFiltro(perfilFiltro === perfil ? 'todos' : perfil)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all border ${
                  perfilFiltro === perfil ? `${bg} border-current ${cor}` : 'bg-zinc-50 border-zinc-100 hover:border-zinc-200'
                }`}>
                <div className={`w-5 h-5 flex items-center justify-center rounded-full ${bg}`}>
                  <ShieldCheck size={11} className={cor} />
                </div>
                <span className={`text-xs font-semibold ${perfilFiltro === perfil ? cor : 'text-zinc-600'}`}>{label}</span>
                <span className={`text-xs font-black px-1.5 py-0.5 rounded-full ${perfilFiltro === perfil ? bg : 'bg-zinc-100'} ${perfilFiltro === perfil ? cor : 'text-zinc-500'}`}>
                  {count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2 flex-1 w-full sm:w-auto max-w-xs">
            <Search size={14} className="text-zinc-400" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, e-mail ou matrícula..."
              className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none" />
          </div>
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
            {[['todos', 'Todos'], ['ativo', 'Ativos'], ['inativo', 'Inativos']].map(([v, l]) => (
              <button key={v} onClick={() => setStatusFiltro(v as typeof statusFiltro)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${statusFiltro === v ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 border-b border-zinc-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-zinc-500">Usuário</th>
                      <th className="px-4 py-3 text-left font-semibold text-zinc-500">Matrícula</th>
                      <th className="px-4 py-3 text-left font-semibold text-zinc-500">Perfil</th>
                      <th className="px-4 py-3 text-left font-semibold text-zinc-500 hidden lg:table-cell">Loja</th>
                      <th className="px-4 py-3 text-left font-semibold text-zinc-500 hidden lg:table-cell">Último acesso</th>
                      <th className="px-4 py-3 text-center font-semibold text-zinc-500">Status</th>
                      <th className="px-4 py-3 text-right font-semibold text-zinc-500">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {filtrados.map((u) => {
                      const cfg = perfilConfig[u.perfil];
                      return (
                        <tr key={u.id} className={`hover:bg-zinc-50 transition-colors ${!u.ativo ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar nome={u.nome} />
                              <div className="min-w-0">
                                <p className="font-semibold text-zinc-800 truncate">{u.nome}</p>
                                {emailDisplay(u.email) ? (
                                  <p className="text-zinc-400 truncate">{emailDisplay(u.email)}</p>
                                ) : (
                                  <p className="text-zinc-300 truncate text-[10px]">Login por matrícula + PIN</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono font-semibold text-zinc-600">{u.matricula || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`flex items-center gap-1.5 w-fit px-2 py-1 rounded-full font-semibold ${cfg.bg} ${cfg.cor}`}>
                              <ShieldCheck size={10} />{cfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-zinc-500 max-w-[140px] hidden lg:table-cell">
                            <p className="truncate">{u.loja}</p>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            {(() => {
                              const b = badgeAcesso(u.ultimoAcesso, u.diasDesdeAcesso);
                              return (
                                <div>
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${b.cls}`}>{b.label}</span>
                                  {u.ultimoAcesso && <p className="text-[10px] text-zinc-400 mt-0.5">{fmtData(u.ultimoAcesso)}</p>}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => toggleAtivo(u.id)}
                              className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${u.ativo ? 'bg-emerald-500' : 'bg-zinc-200'}`}>
                              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${u.ativo ? 'left-5' : 'left-0.5'}`} />
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => setModal({ tipo: 'editar', usuario: u })}
                                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors">
                                <Edit2 size={12} />
                              </button>
                              <AcoesMenu usuario={u} onEditar={() => setModal({ tipo: 'editar', usuario: u })} onToggleAtivo={() => toggleAtivo(u.id)} onRedefinirSenha={() => setModal({ tipo: 'senha', usuario: u })} onExcluir={() => setModal({ tipo: 'excluir', usuario: u })} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-zinc-50">
                {filtrados.map((u) => {
                  const cfg = perfilConfig[u.perfil];
                  return (
                    <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${!u.ativo ? 'opacity-50' : ''}`}>
                      <Avatar nome={u.nome} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-zinc-800">{u.nome}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.cor}`}>{cfg.label}</span>
                        </div>
                        <p className="text-xs text-zinc-400 truncate">{emailDisplay(u.email) || 'Matrícula + PIN'}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => toggleAtivo(u.id)}
                          className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${u.ativo ? 'bg-emerald-500' : 'bg-zinc-200'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${u.ativo ? 'left-4' : 'left-0.5'}`} />
                        </button>
                        <AcoesMenu usuario={u} onEditar={() => setModal({ tipo: 'editar', usuario: u })} onToggleAtivo={() => toggleAtivo(u.id)} onRedefinirSenha={() => setModal({ tipo: 'senha', usuario: u })} onExcluir={() => setModal({ tipo: 'excluir', usuario: u })} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {filtrados.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
                    <i className="ri-user-line text-zinc-300 text-xl" />
                  </div>
                  <p className="text-sm font-semibold text-zinc-500">Nenhum usuário encontrado</p>
                  <p className="text-xs text-zinc-400 mt-1">Tente ajustar os filtros de busca</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {modal && modal.tipo !== 'excluir' && (
        <UsuarioModal
          modo={modal.tipo}
          usuario={modal.tipo !== 'novo' ? modal.usuario : null}
          onClose={() => setModal(null)}
          onDefinirPIN={modal.tipo === 'editar' && modal.usuario
            ? (pin) => definirPIN(modal.usuario!.id, pin)
            : undefined}
          onLimparPIN={modal.tipo === 'editar' && modal.usuario
            ? () => limparPIN(modal.usuario!.id)
            : undefined}
          onSalvar={async (payload) => {
            if (modal.tipo === 'novo') {
              const res = await criarUsuario(payload as Parameters<typeof criarUsuario>[0]);
              if (res.success) {
                const matriculaGerada = res.matricula ? ` Matrícula: ${res.matricula}` : '';
                showToast(`Usuário criado!${matriculaGerada}`, 'ok');
                setModal(null);
              } else {
                showToast(res.error ?? 'Erro ao criar usuário', 'erro');
              }
            } else if (modal.tipo === 'editar' && modal.usuario) {
              const ok = await editarUsuario(modal.usuario.id, payload as Parameters<typeof editarUsuario>[1]);
              if (ok) { showToast('Dados atualizados!', 'ok'); setModal(null); }
              else { showToast('Erro ao atualizar dados', 'erro'); }
            } else if (modal.tipo === 'senha' && modal.usuario) {
              const res = await redefinirSenha(modal.usuario.id, (payload as { senha: string }).senha);
              if (res.success) { showToast('Senha redefinida!', 'ok'); setModal(null); }
              else { showToast(res.error ?? 'Erro ao redefinir senha', 'erro'); }
            }
          }}
        />
      )}

      {/* Modal de confirmação de exclusão */}
      {modal?.tipo === 'excluir' && (
        <ConfirmarExclusaoModal
          usuario={modal.usuario}
          onClose={() => setModal(null)}
          onConfirmar={async () => {
            const res = await excluirUsuario(modal.usuario.id);
            if (res.success) { showToast('Usuário excluído.', 'ok'); setModal(null); }
            else { showToast(res.error ?? 'Erro ao excluir usuário', 'erro'); }
          }}
        />
      )}
    </div>
  );
}
