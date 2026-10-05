// Peças pequenas da casca nova: selo de número, seletor de produto, chip da loja e as ações da conta.
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from '@/contexts/SessaoContext';
import { podeSair } from '@/lib/guardaSaida';
import { abrirNovaJanela } from '@/lib/novaJanela';
import { abrirTrocarLoja } from './trocaLojaEstado';
import type { Produto, Tela } from '@/constants/telas';

export const perfilLabel: Record<string, string> = {
  admin: 'Administrador',
  gerente: 'Supervisor',
  supervisao: 'Líder',
  caixa: 'Operador de Caixa',
  garcom: 'Garçom',
  cozinha: 'Operador de Cozinha',
  financeiro: 'Financeiro',
  contabilidade: 'Contabilidade',
};

export function Selo({ n, className = '' }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={`min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center rounded-full bg-[#DC2626] text-white text-[10px] font-extrabold leading-none ${className}`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

/** Em qual produto a pessoa está agora (pela rota). */
export function produtoAtual(pathname: string, produtos: Produto[]): Produto['id'] {
  const p = produtos.find((x) => x.id !== 'loja' && pathname.startsWith(x.rota));
  return p ? p.id : 'loja';
}

/** Loja · Tarefas · Contratação · Notas — só para quem tem 2 ou mais. */
export function SeletorProduto({ produtos, telas, compacto, onEscolher }: {
  produtos: Produto[]; telas: Tela[]; compacto?: boolean; onEscolher?: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { canSwitchTenant } = useAuth();
  if (produtos.length < 2) return null;
  const atual = produtoAtual(pathname, produtos);
  // A Loja abre em "Suas lojas" (total das lojas juntas + escolher a loja) para quem tem 2+ lojas; senão, na primeira
  // tela que a pessoa vê (a Hoje para quase todo mundo).
  const rotaDe = (p: Produto) => (p.id === 'loja' ? (canSwitchTenant ? '/suas-lojas' : (telas[0]?.rota ?? '/hoje')) : p.rota);
  return (
    <div className={`grid ${compacto ? 'grid-cols-2' : 'grid-cols-4'} gap-[3px] bg-[#F2EEE8] p-[3px] rounded-xl`}>
      {produtos.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => { onEscolher?.(); if (p.id !== atual || (p.id === 'loja' && canSwitchTenant && pathname !== '/suas-lojas')) navigate(rotaDe(p)); }}
          className={`flex items-center justify-center gap-1.5 rounded-[9px] px-2 py-1.5 text-[11.5px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
            p.id === atual ? 'bg-white text-[#1F1A14] shadow-[0_1px_3px_rgba(31,26,20,.12)]' : 'text-[#5B5248] hover:text-[#1F1A14]'
          }`}
        >
          <p.icone size={14} />
          {compacto ? p.curto : p.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Bolinha verde = loja aberta (sessão do dia aberta), cinza = fechada — o mesmo critério do ABERTA/FECHADA de antes. */
export function useEstadoLoja() {
  const { estado, sessao } = useSessao();
  const aberta = estado !== 'sem_sessao';
  const texto = aberta ? (sessao?.iniciadaEm ? `Aberta desde ${sessao.iniciadaEm}` : 'Aberta') : 'Fechada';
  return { aberta, texto };
}

export function Bolinha({ aberta }: { aberta: boolean }) {
  return <span className={`inline-block w-[7px] h-[7px] rounded-full flex-shrink-0 ${aberta ? 'bg-[#15803D]' : 'bg-[#C9BFB2]'}`} />;
}

/** Ações da conta (o menu do avatar e a parte "Sua conta" do Mais) — as mesmas do topo antigo. */
export function useAcoesConta(onDesligarCasca: () => void) {
  const { logout, canSwitchTenant } = useAuth();
  const navigate = useNavigate();
  return {
    canSwitchTenant,
    perfil: async () => { if (!(await podeSair())) return; navigate('/perfil'); },
    atualizar: () => window.location.reload(),
    outraJanela: () => abrirNovaJanela(window.location.pathname + window.location.search),
    ajuda: () => navigate('/ajuda'),
    // Folha por cima da tela (TrocarLoja.tsx); o "algo sem salvar?" é perguntado ao tocar em Entrar.
    trocarLoja: async () => { abrirTrocarLoja(); },
    menuAntigo: onDesligarCasca,
    sair: async () => { if (!(await podeSair())) return; logout(); navigate('/login'); },
  };
}
