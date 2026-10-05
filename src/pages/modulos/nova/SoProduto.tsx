// Cara 2 da página de Módulos nova: quem não tem loja e usa outro produto (Tarefas, Contratação, Notas de
// serviço). Um produto só: entra direto nele. Dois ou mais: "O que vai usar agora?" e, ao ENTRAR, vai
// direto no último usado neste aparelho (localStorage). Chegando por um "voltar" (← Módulos), mostra a escolha.
// Sem nenhum produto: a tela do código de convite de sempre.
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { filtrarProdutos } from '@/constants/telas';
import { btn } from '@/components/kit';
import SemLojaScreen from '@/pages/modulos/components/SemLojaScreen';
import { destinoProduto, gravarUltimoProduto, lerUltimoProduto } from '@/lib/modulosCara';
import { LinkRota, Moldura, Topo } from './partes';

// Descrição no lugar de contagem: contar tarefas/candidatos exigiria uma leitura por produto ao abrir.
const DESCRICAO: Record<string, string> = {
  tarefas: 'O que a equipe precisa fazer, com prazo e responsável',
  contratacao: 'Currículos lidos por IA e entrevistas',
  nfse: 'Emitir nota de serviço (NFS-e) pelo Emissor Nacional',
};

function useSessaoSemLoja(): { id: string | null; nome: string; pronta: boolean } {
  const [s, setS] = useState<{ id: string | null; nome: string; pronta: boolean }>({ id: null, nome: '', pronta: false });
  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(({ data }) => {
      const u = data?.session?.user;
      const meta = u?.user_metadata;
      if (vivo) setS({ id: u?.id ?? null, nome: meta?.name ?? meta?.nome ?? u?.email ?? 'Usuário', pronta: true });
    }).catch(() => { if (vivo) setS({ id: null, nome: 'Usuário', pronta: true }); });
    return () => { vivo = false; };
  }, []);
  return s;
}

function saudacao(): string {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export default function SoProduto() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasModule, loading } = useModuleAccess();
  const sessao = useSessaoSemLoja();
  // Entrada = veio do "/" logo depois de entrar (AppLayout marca { entrada: true }); "voltar" não marca.
  const entrada = (location.state as { entrada?: boolean } | null)?.entrada === true;

  const produtos = useMemo(
    () => filtrarProdutos({ pode: () => false, modulo: hasModule }, false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, hasModule],
  );

  const sair = () => { logout(); navigate('/login'); };

  if (loading || !sessao.pronta) {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (produtos.length === 0) return <SemLojaScreen userName={sessao.nome} onLogout={sair} />;

  const destino = destinoProduto(produtos, lerUltimoProduto(sessao.id), entrada);
  if (destino) return <Navigate to={destino} replace />;

  const primeiro = sessao.nome.split(' ')[0];
  return (
    <Moldura>
      <Topo
        icone="ri-apps-2-line"
        titulo="ERPOS"
        linha={<span className="truncate">{sessao.nome} · sem loja</span>}
        direita={<button type="button" onClick={sair} className={btn('out', 'sm')}><i className="ri-logout-box-r-line" />Sair</button>}
      />
      <div className="px-4 md:px-8 pb-10 max-w-6xl mx-auto">
        <h1 className="text-[22px] md:text-[26px] font-black leading-tight mt-3">{saudacao()}, {primeiro}. O que vai usar agora?</h1>
        <p className="text-[13px] text-[#5B5248] mt-1">Da próxima vez você entra direto no último que usou. Para voltar aqui, toque em “Módulos” no topo dele.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-4 max-w-3xl">
          {produtos.map((p) => (
            <LinkRota key={p.id} rota={p.rota} onAbrir={() => gravarUltimoProduto(sessao.id, p.id)}
              className="bg-white border border-[#EEE6DA] hover:border-[#F6DDB0] rounded-[22px] p-[18px] flex items-center gap-3.5 cursor-pointer text-left min-w-0">
              <span className="w-[52px] h-[52px] rounded-2xl bg-[#FFF4E0] text-[#C2700A] flex items-center justify-center flex-shrink-0">
                <p.icone size={26} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[18px] font-extrabold leading-tight">{p.rotulo}</b>
                <span className="block text-[12.5px] text-[#5B5248] mt-0.5 leading-snug">{DESCRICAO[p.id] ?? ''}</span>
              </span>
              <i className="ri-arrow-right-s-line text-[22px] text-[#9A9086] flex-shrink-0" />
            </LinkRota>
          ))}
        </div>
      </div>
    </Moldura>
  );
}
