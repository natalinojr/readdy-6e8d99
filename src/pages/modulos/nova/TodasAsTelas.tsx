// Cara 3 da página de Módulos nova (dono, supervisor, líder e os demais com loja): "Todas as telas" — os 6
// grupos do catálogo (os mesmos do menu da casca nova), uma linha por tela dizendo o que é, e "Outros
// produtos" no fim. Sem relógio, sem bolhas, sem "Suas lojas agora" (está na Hoje e em /lojas).
// O que ficava no topo antigo continua alcançável no ⋯: Trocar de loja, Totens, Admin Master, link para
// criar loja (só o dono), tela cheia e Sair.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUsuarios } from '@/hooks/useUsuarios';
import { GRUPOS, ADMIN_MASTER_EMAIL, type Tela } from '@/constants/telas';
import { useTelasVisiveis } from '@/components/feature/casca/useCasca';
import { Bolinha, perfilLabel, useEstadoLoja } from '@/components/feature/casca/partes';
import { Folha, MenuMais } from '@/components/kit';
import OnboardingShareModal from '@/pages/modulos/components/OnboardingShareModal';
import { LinkRota, Topo } from './partes';

const DESCRICAO_PRODUTO: Record<string, string> = {
  tarefas: 'o que a equipe precisa fazer, com prazo e responsável',
  contratacao: 'currículos e entrevistas',
  nfse: 'emitir nota de serviço (NFS-e)',
};

function Linha({ rota, rotulo, descricao, icone: Icone, pequeno }: {
  rota: string; rotulo: string; descricao: string; icone: Tela['icone']; pequeno?: boolean;
}) {
  return (
    <LinkRota rota={rota}
      className={`w-full flex items-center gap-2.5 px-1 border-t border-[#F3EEE6] first:border-t-0 text-left cursor-pointer hover:bg-[#FFFBF3] rounded-lg ${pequeno ? 'py-[7px] min-h-[42px]' : 'py-2.5 min-h-[48px]'}`}>
      <span className={`${pequeno ? 'w-[26px] h-[26px] rounded-lg' : 'w-8 h-8 rounded-[10px]'} bg-[#F4EFE7] text-[#5B5248] flex items-center justify-center flex-shrink-0`}>
        <Icone size={pequeno ? 14 : 16} />
      </span>
      <span className="flex-1 min-w-0">
        <b className={`block font-extrabold text-[#1F1A14] ${pequeno ? 'text-[12.5px]' : 'text-[13.5px]'}`}>{rotulo}</b>
        <small className="block text-[11.5px] text-[#9A9086] leading-snug">{descricao}</small>
      </span>
      <ChevronRight size={18} className="text-[#CFC6B8] flex-shrink-0" />
    </LinkRota>
  );
}

function Bloco({ icone: Icone, rotulo, n, children }: { icone: Tela['icone']; rotulo: string; n: number; children: ReactNode }) {
  return (
    <div className="bg-white border border-[#EEE6DA] rounded-2xl px-3.5 pt-3 pb-1.5 min-w-0">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="w-8 h-8 rounded-[10px] bg-[#FFF4E0] text-[#C2700A] flex items-center justify-center flex-shrink-0"><Icone size={17} /></span>
        <b className="flex-1 text-[15px] font-extrabold">{rotulo}</b>
        <span className="text-[11.5px] font-bold text-[#9A9086]">{n} {n === 1 ? 'tela' : 'telas'}</span>
      </div>
      {children}
    </div>
  );
}

/** Status dos totens (o que o topo antigo mostrava). Só lê a lista ao abrir. */
function FolhaTotens({ onFechar }: { onFechar: () => void }) {
  const { usuarios, loading, error } = useUsuarios();
  const navigate = useNavigate();
  const totens = usuarios.filter((u) => u.perfil === 'totem');
  const online = totens.filter((u) => u.kioskOnline).length;
  return (
    <Folha aberta titulo="Status dos totens" subtitulo={loading ? 'Lendo…' : `${online} de ${totens.length} ativo${totens.length !== 1 ? 's' : ''}`} onFechar={onFechar}>
      <div className="px-5 pb-5">
        {error ? (
          <p className="text-[13px] text-zinc-500 py-4">Não deu para ler os totens: {error}.</p>
        ) : !loading && totens.length === 0 ? (
          <p className="text-[13px] text-zinc-500 py-4">Nenhum usuário de totem nesta loja.</p>
        ) : (
          totens.map((t) => {
            const min = t.ultimoAcesso ? Math.floor((Date.now() - new Date(t.ultimoAcesso).getTime()) / 60000) : null;
            return (
              <div key={t.id} className="flex items-center gap-3 py-2.5 border-t border-zinc-100 first:border-t-0">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.kioskOnline ? 'bg-emerald-100 text-emerald-600' : 'bg-zinc-100 text-zinc-400'}`}><i className="ri-tablet-line" /></span>
                <span className="flex-1 min-w-0">
                  <b className="block text-[13px] font-semibold text-zinc-800 truncate">{t.nome}</b>
                  <small className="block text-[12px] text-zinc-400">
                    {t.kioskOnline ? 'Online agora' : min !== null ? (min < 60 ? `Há ${min} min` : `Há ${Math.floor(min / 60)} h`) : 'Nunca acessou'}
                  </small>
                </span>
                <span className={`text-[12px] font-bold ${t.kioskOnline ? 'text-emerald-600' : 'text-zinc-400'}`}>{t.kioskOnline ? 'Online' : 'Offline'}</span>
              </div>
            );
          })
        )}
        <button type="button" onClick={() => { onFechar(); navigate('/usuarios'); }}
          className="mt-3 text-[13px] text-amber-700 font-bold cursor-pointer hover:underline">Gerenciar usuários totem →</button>
      </div>
    </Folha>
  );
}

export default function TodasAsTelas() {
  const { user, logout, canSwitchTenant, switchTenant } = useAuth();
  const navigate = useNavigate();
  const loja = useEstadoLoja();
  const { telas, produtos } = useTelasVisiveis();
  const [verTotens, setVerTotens] = useState(false);
  const [verConvite, setVerConvite] = useState(false);
  const [telaCheia, setTelaCheia] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const h = () => setTelaCheia(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const grupos = useMemo(() => GRUPOS
    .map((g) => ({ ...g, telas: telas.filter((t) => t.grupo === g.id) }))
    .filter((g) => g.telas.length > 0), [telas]);
  const outros = produtos.filter((p) => p.id !== 'loja');
  const total = telas.length;

  const ehDono = (user?.email ?? '').toLowerCase() === ADMIN_MASTER_EMAIL;
  const podeVerTotens = user?.perfil === 'admin' || user?.perfil === 'gerente';
  const sair = () => { logout(); navigate('/login'); };
  const trocarLoja = () => { switchTenant(); navigate('/selecionar-loja'); };
  const alternarTelaCheia = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  const bloco = (g: (typeof grupos)[number]) => {
    const normais = g.telas.filter((t) => !t.terminal);
    const terminais = g.telas.filter((t) => t.terminal);
    return (
      <Bloco key={g.id} icone={g.icone} rotulo={g.rotulo} n={g.telas.length}>
        {normais.map((t) => <Linha key={t.id} rota={t.rota} rotulo={t.rotulo} descricao={t.descricao} icone={t.icone} />)}
        {terminais.length > 0 && (
          <>
            <div className="flex items-center gap-2 border-t border-[#F3EEE6] pt-2.5 pb-1 px-1">
              <b className="flex-1 text-[13.5px] font-extrabold">Terminais</b>
              <span className="text-[11px] font-bold text-[#9A9086] bg-[#F4EFE7] rounded-full px-2 py-0.5">{terminais.length} {terminais.length === 1 ? 'tela' : 'telas'}</span>
            </div>
            <small className="block text-[11.5px] text-[#9A9086] px-1 -mt-0.5 mb-1">as telas onde a loja vende e a cozinha trabalha</small>
            <div className="ml-3.5 pl-2.5 border-l-2 border-[#F1E6D3] mb-1.5">
              {terminais.map((t) => <Linha key={t.id} pequeno rota={t.rota} rotulo={t.rotulo} descricao={t.descricao} icone={t.icone} />)}
            </div>
          </>
        )}
      </Bloco>
    );
  };

  return (
    <>
      <Topo
        titulo={user?.loja || 'ERPOS'}
        linha={<><Bolinha aberta={loja.aberta} /><span className="truncate">{loja.texto} · {user?.nome?.split(' ')[0]}{user?.perfil ? ` · ${perfilLabel[user.perfil] ?? user.perfil}` : ''}</span></>}
        direita={
          <MenuMais grande rotulo="Mais opções" itens={[
            { rotulo: 'Trocar de loja', icone: 'ri-store-2-line', onClick: trocarLoja, oculto: !canSwitchTenant },
            { rotulo: 'Status dos totens', icone: 'ri-tablet-line', onClick: () => setVerTotens(true), oculto: !podeVerTotens },
            { rotulo: 'Admin Master', icone: 'ri-shield-star-line', onClick: () => navigate('/admin-master'), oculto: !ehDono },
            { rotulo: 'Link para criar loja', icone: 'ri-links-line', onClick: () => setVerConvite(true), oculto: !ehDono },
            { rotulo: telaCheia ? 'Sair da tela cheia' : 'Tela cheia', icone: telaCheia ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line', onClick: alternarTelaCheia },
            { rotulo: 'Sair', icone: 'ri-logout-box-r-line', onClick: sair, perigo: true },
          ]} />
        }
      />
      <div className="px-4 md:px-8 pb-12 max-w-6xl mx-auto">
        <h1 className="text-[22px] md:text-[26px] font-black leading-tight mt-3">Todas as telas</h1>
        <p className="text-[13px] text-[#5B5248] mt-1">
          {total} {total === 1 ? 'tela' : 'telas'} em {grupos.length} {grupos.length === 1 ? 'grupo' : 'grupos'} — os mesmos do menu, cada uma com uma linha dizendo o que é. Só aparecem as que você pode abrir.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4 items-start">
          <div className="flex flex-col gap-3 min-w-0">{grupos.slice(0, 2).map(bloco)}</div>
          <div className="flex flex-col gap-3 min-w-0">{grupos.slice(2).map(bloco)}</div>
        </div>

        {outros.length > 0 && (
          <div className="mt-5 max-w-3xl">
            <h2 className="text-[11px] font-extrabold uppercase tracking-[.1em] text-[#9A9086] mb-1.5">Outros produtos</h2>
            <div className="bg-white border border-[#EEE6DA] rounded-2xl px-3.5 py-1">
              {outros.map((p) => (
                <Linha key={p.id} rota={p.rota} rotulo={p.rotulo} descricao={DESCRICAO_PRODUTO[p.id] ?? ''} icone={p.icone} />
              ))}
            </div>
          </div>
        )}
      </div>
      {verTotens && <FolhaTotens onFechar={() => setVerTotens(false)} />}
      {verConvite && <OnboardingShareModal onClose={() => setVerConvite(false)} />}
    </>
  );
}
