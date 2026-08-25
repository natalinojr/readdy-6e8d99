import { useState } from 'react';
import { X, Building2, Check, Loader2 } from 'lucide-react';
import { perfilConfig, type PerfilUsuario } from '@/constants/usuarios';
import { useAcessoMultiLoja } from '@/hooks/useAcessoMultiLoja';

const PERFIS_ATRIBUIVEIS: PerfilUsuario[] = ['admin', 'gerente', 'caixa', 'garcom', 'cozinha', 'gestor_entregas', 'tarefas'];

interface CelulaProps {
  perfilAtual: PerfilUsuario | null;
  onConceder: (perfil: PerfilUsuario) => Promise<void>;
  onRevogar: () => Promise<void>;
}

function Celula({ perfilAtual, onConceder, onRevogar }: CelulaProps) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  if (ocupado) {
    return (
      <div className="w-full flex items-center justify-center py-2">
        <Loader2 size={14} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  if (perfilAtual) {
    const cfg = perfilConfig[perfilAtual];
    return (
      <div className="relative">
        <button
          onClick={() => setAberto((v) => !v)}
          className={`w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer ${cfg.bg} ${cfg.cor}`}
        >
          <Check size={11} />
          {cfg.label}
        </button>
        {aberto && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
            <div className="absolute z-50 top-full mt-1 left-1/2 -translate-x-1/2 bg-white border border-zinc-100 rounded-xl shadow-lg py-1 w-40">
              {PERFIS_ATRIBUIVEIS.map((p) => (
                <button
                  key={p}
                  onClick={async () => {
                    setAberto(false);
                    setOcupado(true);
                    await onConceder(p);
                    setOcupado(false);
                  }}
                  className={`flex items-center justify-between w-full px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 cursor-pointer ${p === perfilAtual ? 'text-zinc-900 font-bold' : 'text-zinc-600'}`}
                >
                  {perfilConfig[p].label}
                  {p === perfilAtual && <Check size={12} />}
                </button>
              ))}
              <div className="border-t border-zinc-100 my-1" />
              <button
                onClick={async () => {
                  setAberto(false);
                  setOcupado(true);
                  await onRevogar();
                  setOcupado(false);
                }}
                className="flex items-center w-full px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 cursor-pointer"
              >
                Remover acesso
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className="w-full py-1.5 rounded-lg border border-dashed border-zinc-200 text-[10px] font-semibold text-zinc-400 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50 cursor-pointer transition-colors"
      >
        + Dar acesso
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className="absolute z-50 top-full mt-1 left-1/2 -translate-x-1/2 bg-white border border-zinc-100 rounded-xl shadow-lg py-1 w-40">
            {PERFIS_ATRIBUIVEIS.map((p) => (
              <button
                key={p}
                onClick={async () => {
                  setAberto(false);
                  setOcupado(true);
                  await onConceder(p);
                  setOcupado(false);
                }}
                className="flex items-center w-full px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 cursor-pointer"
              >
                {perfilConfig[p].label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function AcessoMultiLojaModal({ onClose }: { onClose: () => void }) {
  const { minhasLojas, usuarios, loading, error, concederAcesso, revogarAcesso } = useAcessoMultiLoja();
  const [busca, setBusca] = useState('');

  const filtrados = usuarios.filter(
    (u) =>
      u.nome.toLowerCase().includes(busca.toLowerCase()) ||
      u.email.toLowerCase().includes(busca.toLowerCase()) ||
      u.matricula.includes(busca),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-violet-50 rounded-xl">
              <Building2 size={16} className="text-violet-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Acesso entre lojas</h3>
              <p className="text-xs text-zinc-400">Conceda ou remova acesso dos seus usuários às suas lojas</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-zinc-100">
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, e-mail ou matrícula..."
            className="w-full px-3 py-2 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:border-amber-400"
          />
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-zinc-400 text-xs">Carregando...</div>
          ) : error ? (
            <div className="flex items-center justify-center py-10 text-red-500 text-xs">{error}</div>
          ) : minhasLojas.length < 2 ? (
            <div className="flex items-center justify-center py-10 text-zinc-400 text-xs text-center px-8">
              Você precisa ser administrador em pelo menos duas lojas para gerenciar acesso entre elas.
            </div>
          ) : filtrados.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-zinc-400 text-xs">Nenhum usuário encontrado</div>
          ) : (
            <table className="w-full border-separate border-spacing-y-1.5">
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-bold text-zinc-400 uppercase px-2 pb-1 sticky left-0 bg-white">Usuário</th>
                  {minhasLojas.map((loja) => (
                    <th key={loja.id} className="text-center text-[10px] font-bold text-zinc-400 uppercase px-2 pb-1 min-w-[130px]">
                      {loja.nome}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((u) => (
                  <tr key={u.id}>
                    <td className="px-2 py-1.5 sticky left-0 bg-white">
                      <p className="text-xs font-semibold text-zinc-800">{u.nome}</p>
                      <p className="text-[10px] text-zinc-400">{u.matricula ? `#${u.matricula}` : u.email}</p>
                    </td>
                    {minhasLojas.map((loja) => {
                      const vinculo = u.vinculos.find((v) => v.tenantId === loja.id);
                      return (
                        <td key={loja.id} className="px-2 py-1.5">
                          <Celula
                            perfilAtual={vinculo?.perfil ?? null}
                            onConceder={async (perfil) => {
                              await concederAcesso(u.id, loja.id, perfil);
                            }}
                            onRevogar={async () => {
                              await revogarAcesso(u.id, loja.id);
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
