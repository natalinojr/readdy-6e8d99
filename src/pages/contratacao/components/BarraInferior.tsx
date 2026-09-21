// Barra fixa de navegação no celular (< sm = 640px), RF-01/US-02. Layout (fixed bottom-0, safe-area,
// proporção dos itens) reaproveitado de src/pages/tarefas/components/MobileNav.tsx:27-56 (único
// padrão de bottom nav já existente no projeto) — paleta (rose/zinc) e ícones (Remix ri-*) são os de
// Contratação, não os de Tarefas (slate/indigo/lucide-react), por causa da Constraint 1/12. Aditiva:
// a barra de abas de cima (overflow-x-auto, T09) continua visível em todos os tamanhos (edge case
// "celular sem JavaScript: abas desktop visíveis").
import { AREAS, AREA_CONFIG, type Area } from '../navegacao';

interface Props { area: Area; onArea: (a: Area) => void }

export default function BarraInferior({ area, onArea }: Props) {
  const itens = [...AREAS, AREA_CONFIG];
  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-zinc-200 pb-[env(safe-area-inset-bottom)]">
      <div className="flex">
        {itens.map((t) => {
          const ativo = area === t.id;
          const config = t.id === 'config';
          // "Configurações" não cabe em 1/6 da largura em 375px sem quebrar linha (a spec não pede
          // um nome novo — Regra nº 1); "Config" (abreviação do mesmo nome) cabe, do mesmo jeito que
          // "Candidatos"/"Entrevistas"/"Relatórios" já cabem nas outras 4 colunas sem truncar.
          return (
            <button key={t.id} onClick={() => onArea(t.id)}
              title={config ? t.label : undefined} aria-label={t.label}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 cursor-pointer ${ativo ? 'text-rose-700' : 'text-zinc-500'}`}>
              <i className={`${t.icon} text-lg`} />
              <span className="text-[10px] font-bold">{config ? 'Config' : t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
