import { useMemo } from 'react';
import { type EventoAuditoria } from '@/constants/auditoria';

interface ResumoUsuariosProps {
  eventos: EventoAuditoria[];
  usuarioSelecionado: string;
  onSelecionar: (usuario: string) => void;
}

interface ResumoUsuario {
  nome: string;
  total: number;
  criticos: number;
  avisos: number;
  ultimaAtividade: string;
}

const CORES = ['bg-amber-400', 'bg-emerald-400', 'bg-sky-400', 'bg-violet-400', 'bg-rose-400'];

function Avatar({ nome, size = 'sm' }: { nome: string; size?: 'sm' | 'md' }) {
  const iniciais = nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
  const cor = CORES[nome.charCodeAt(0) % CORES.length];
  const cls = size === 'md' ? 'w-8 h-8 text-xs' : 'w-6 h-6 text-[10px]';
  return (
    <div className={`${cls} ${cor} flex-shrink-0 flex items-center justify-center rounded-full text-white font-bold`}>
      {iniciais}
    </div>
  );
}

export default function ResumoUsuarios({ eventos, usuarioSelecionado, onSelecionar }: ResumoUsuariosProps) {
  const resumos = useMemo<ResumoUsuario[]>(() => {
    const mapa: Record<string, ResumoUsuario> = {};
    eventos.forEach((e) => {
      if (!mapa[e.usuario]) {
        mapa[e.usuario] = { nome: e.usuario, total: 0, criticos: 0, avisos: 0, ultimaAtividade: e.hora };
      }
      mapa[e.usuario].total++;
      if (e.severidade === 'critico') mapa[e.usuario].criticos++;
      if (e.severidade === 'aviso') mapa[e.usuario].avisos++;
      // Manter a hora mais recente
      if (e.hora > mapa[e.usuario].ultimaAtividade) {
        mapa[e.usuario].ultimaAtividade = e.hora;
      }
    });
    return Object.values(mapa).sort((a, b) => b.total - a.total).slice(0, 8);
  }, [eventos]);

  if (resumos.length === 0) return null;

  return (
    <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100">
        <p className="text-xs font-bold text-zinc-700">Atividade por Usuário</p>
        <p className="text-[10px] text-zinc-400 mt-0.5">Clique para filtrar eventos do usuário</p>
      </div>
      <div className="divide-y divide-zinc-50">
        {resumos.map((r) => {
          const isSelected = usuarioSelecionado === r.nome;
          return (
            <button
              key={r.nome}
              onClick={() => onSelecionar(isSelected ? 'Todos' : r.nome)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 transition-colors cursor-pointer text-left ${isSelected ? 'bg-amber-50' : ''}`}
            >
              <Avatar nome={r.nome} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-800 truncate">{r.nome}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-zinc-400">{r.total} eventos</span>
                  {r.criticos > 0 && (
                    <span className="text-[10px] font-bold text-red-500">{r.criticos} crítico{r.criticos > 1 ? 's' : ''}</span>
                  )}
                  {r.avisos > 0 && (
                    <span className="text-[10px] font-bold text-amber-500">{r.avisos} aviso{r.avisos > 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-[10px] text-zinc-400">{r.ultimaAtividade}</span>
                {isSelected && (
                  <span className="text-[10px] font-bold text-amber-600">Filtrado</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
