import { Wrench } from 'lucide-react';

export default function PaginaEmConstrucao() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center">
      <div className="w-16 h-16 flex items-center justify-center bg-amber-50 rounded-2xl mb-4">
        <Wrench size={28} className="text-amber-500" />
      </div>
      <h2 className="text-lg font-bold text-zinc-800 mb-1">Página em construção</h2>
      <p className="text-sm text-zinc-400 max-w-xs">Esta funcionalidade será implementada nas próximas fases do projeto.</p>
    </div>
  );
}
