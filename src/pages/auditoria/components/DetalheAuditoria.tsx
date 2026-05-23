import { X, User, Clock, Monitor, FileText } from 'lucide-react';
import { tipoAcaoConfig, type EventoAuditoria } from '../../../constants/auditoria';

const severidadeConfig = {
  info:    { label: 'Info',     cls: 'text-sky-600 bg-sky-50' },
  aviso:   { label: 'Aviso',    cls: 'text-amber-700 bg-amber-50' },
  critico: { label: 'Crítico',  cls: 'text-red-600 bg-red-50' },
};

function AvatarSmall({ nome }: { nome: string }) {
  const iniciais = nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
  const cores = ['bg-amber-400', 'bg-emerald-400', 'bg-sky-400', 'bg-violet-400', 'bg-rose-400'];
  const cor = cores[nome.charCodeAt(0) % cores.length];
  return (
    <div className={`w-8 h-8 ${cor} flex-shrink-0 flex items-center justify-center rounded-full text-white text-xs font-bold`}>
      {iniciais}
    </div>
  );
}

interface DetalheAuditoriaProps {
  evento: EventoAuditoria;
  onClose: () => void;
}

export default function DetalheAuditoria({ evento, onClose }: DetalheAuditoriaProps) {
  const cfg = tipoAcaoConfig[evento.tipo];
  const sev = severidadeConfig[evento.severidade];

  return (
    <div className="flex flex-col h-full bg-white border-l border-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 flex items-center justify-center rounded-lg ${cfg.bg}`}>
            <i className={`${cfg.icone} text-base ${cfg.cor}`} />
          </div>
          <p className="text-sm font-bold text-zinc-900">Detalhe do Evento</p>
        </div>
        <button onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400 transition-colors">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Tipo + Severidade */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${cfg.bg} ${cfg.cor}`}>
            <i className={`${cfg.icone} text-sm`} />
            {cfg.label}
          </span>
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${sev.cls}`}>
            {sev.label}
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-500 font-mono">
            #{evento.id}
          </span>
        </div>

        {/* Descrição */}
        <div className="bg-zinc-50 rounded-xl p-4">
          <p className="text-sm font-semibold text-zinc-800 leading-relaxed">{evento.descricao}</p>
          {evento.detalhes && (
            <p className="text-xs text-zinc-500 mt-2 leading-relaxed">{evento.detalhes}</p>
          )}
        </div>

        {/* Metadados */}
        <div className="space-y-2.5">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Informações</p>
          {[
            { icon: <User size={12} />, label: 'Usuário', value: `${evento.usuario} — ${evento.perfil}` },
            { icon: <Clock size={12} />, label: 'Data e hora', value: `${evento.data} às ${evento.hora}` },
            { icon: <Monitor size={12} />, label: 'IP / Terminal', value: evento.ip },
            { icon: <FileText size={12} />, label: 'Entidade', value: `${evento.entidade} ${evento.entidadeId}` },
          ].map(({ icon, label, value }) => (
            <div key={label} className="flex items-start gap-3">
              <div className="w-5 h-5 flex items-center justify-center text-zinc-400 mt-0.5 flex-shrink-0">{icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">{label}</p>
                <p className="text-xs font-semibold text-zinc-700 mt-0.5">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Antes / Depois */}
        {(evento.antes || evento.depois) && (
          <div className="space-y-3">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Alterações</p>

            {evento.antes && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide mb-2">Antes</p>
                <div className="space-y-1.5">
                  {Object.entries(evento.antes).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-red-400 font-medium capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="text-xs font-bold text-red-700 text-right">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {evento.depois && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide mb-2">Depois</p>
                <div className="space-y-1.5">
                  {Object.entries(evento.depois).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-emerald-500 font-medium capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="text-xs font-bold text-emerald-800 text-right">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-zinc-100">
        <div className="flex items-center gap-3">
          <AvatarSmall nome={evento.usuario} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-zinc-800 truncate">{evento.usuario}</p>
            <p className="text-[10px] text-zinc-400">{evento.perfil} · {evento.ip}</p>
          </div>
          <p className="text-[10px] text-zinc-400 whitespace-nowrap">{evento.hora}</p>
        </div>
      </div>
    </div>
  );
}
