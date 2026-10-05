// Casca nova (2026-10-05), atrás da chave por pessoa (useCascaNova). Só troca a moldura — menu, topo e barra
// de baixo no celular; o conteúdo das telas (<main>) fica exatamente como no layout antigo.
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useModoTreino } from '@/contexts/ModoTreinoContext';
import { useContagemHoje } from '@/pages/hoje/hojeStore';
import RotaProtegida from '../RotaProtegida';
import InstallPWA from '../InstallPWA';
import AssistenteChat from '../AssistenteChat';
import ConviteAvisos from '../ConviteAvisos';
import MenuNovo from './MenuNovo';
import TopoNovo from './TopoNovo';
import BarraInferior from './BarraInferior';
import IrPara from './IrPara';
import MaisFolha from './MaisFolha';
import { useTelasVisiveis } from './useCasca';

interface Props {
  carregando: ReactNode;
  onDesligarCasca: () => void;
}

export default function CascaLayout({ carregando, onDesligarCasca }: Props) {
  const location = useLocation();
  const { isModoTreino } = useModoTreino();
  const { telas, produtos } = useTelasVisiveis();
  // O mesmo número do topo antigo e da tela Hoje (hojeStore) — não recalcula.
  const { agora: numeroHoje } = useContagemHoje();
  const [irPara, setIrPara] = useState(false);
  const [mais, setMais] = useState(false);
  const fecharMais = useCallback(() => setMais(false), []);
  const fecharIrPara = useCallback(() => setIrPara(false), []);

  // Ctrl K (⌘K no Mac) abre o "Ir para…".
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIrPara((v) => !v);
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);

  useEffect(() => { setIrPara(false); }, [location.pathname]);

  return (
    <div
      className={`flex h-screen overflow-hidden font-sans bg-white ${isModoTreino ? 'ring-4 ring-inset ring-amber-400' : ''}`}
      style={{ height: '100dvh' }}
    >
      {isModoTreino && (
        <div className="fixed inset-0 pointer-events-none z-[5] flex items-center justify-center">
          <div
            className="text-amber-300/20 font-black text-[120px] uppercase tracking-widest select-none"
            style={{ transform: 'rotate(-35deg)', userSelect: 'none' }}
          >
            TREINO
          </div>
        </div>
      )}

      <MenuNovo telas={telas} produtos={produtos} numeroHoje={numeroHoje} />

      <div className="relative z-10 flex flex-col flex-1 overflow-hidden min-w-0">
        {isModoTreino && (
          <div className="bg-amber-400 px-4 py-2 flex items-center justify-center gap-3 flex-shrink-0 z-10">
            <i className="ri-graduation-cap-fill text-amber-900 text-base" />
            <p className="text-amber-900 text-xs font-black tracking-wide">
              MODO TREINO ATIVO — Pedidos e dados nao afetam o sistema real
            </p>
            <i className="ri-graduation-cap-fill text-amber-900 text-base" />
          </div>
        )}
        <TopoNovo telas={telas} numeroHoje={numeroHoje} onIrPara={() => setIrPara(true)} onDesligarCasca={onDesligarCasca} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <RotaProtegida>
            <Suspense fallback={carregando}>
              <Outlet />
            </Suspense>
          </RotaProtegida>
        </main>
        <BarraInferior telas={telas} numeroHoje={numeroHoje} maisAberto={mais} onMais={() => setMais((v) => !v)} />
      </div>

      {mais && (
        <MaisFolha telas={telas} produtos={produtos} numeroHoje={numeroHoje} onFechar={fecharMais} onDesligarCasca={onDesligarCasca} />
      )}
      {irPara && <IrPara telas={telas} produtos={produtos} onFechar={fecharIrPara} />}

      {/* Convite para instalar na tela inicial (só aparece no celular) */}
      <InstallPWA />
      {/* Chat do assistente (só o dono; na própria tela Assistente ele já está embutido) */}
      {!location.pathname.startsWith('/assistente') && <AssistenteChat variant="floating" />}
      <ConviteAvisos />
    </div>
  );
}
