// Folha "O que aconteceu?" (2026-10-03) — o começo único de qualquer lançamento. As respostas e quem
// vê cada uma ficam em ./opcoes.ts; aqui é só a navegação (pergunta → pergunta → tela que já existe).
// Usada no botão Lançar do Financeiro, na tela /lancar (celular, atalho do app e ⚡) e — quando a tela
// Hoje entrar — no "+" dela: <OQueAconteceu onFechar={...} />.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { useAcessoAcoes } from '../assistente/acoes/acesso';
import { OPCOES, caminhoUnico, filhosVisiveis, variante, type Destino, type Opcao } from './opcoes';

const LancarDespesa = lazy(() => import('../assistente/acoes/financeiro/LancarDespesa'));

export interface OQueAconteceuProps {
  onFechar: () => void;
  /** Quem abre decide como navegar (ex.: o Financeiro troca de aba sem recarregar). Padrão: navigate(rota). */
  onNavegar?: (rota: string) => void;
  /** "Ver todos os jeitos de lançar": a lista completa antiga (só onde ela existe, no Financeiro). */
  onListaCompleta?: () => void;
  /** Tela cheia (/lancar) em vez de folha por cima da tela. */
  telaCheia?: boolean;
  /** Tela cheia: o que a seta de voltar faz quando já está na primeira pergunta. */
  onSair?: () => void;
}

export default function OQueAconteceu({ onFechar, onNavegar, onListaCompleta, telaCheia, onSair }: OQueAconteceuProps) {
  const navigate = useNavigate();
  const acesso = useAcessoAcoes();
  const [pilha, setPilha] = useState<Opcao[]>([]);
  const [acao, setAcao] = useState<'lancar-despesa' | null>(null);

  const atual = pilha[pilha.length - 1];
  const opcoes = filhosVisiveis(atual ? atual.filhos : OPCOES, acesso);
  const nivel = pilha.length;

  const voltar = () => {
    if (acao) { setAcao(null); return; }
    if (pilha.length) { setPilha((p) => p.slice(0, -1)); return; }
    if (telaCheia) (onSair ?? onFechar)(); else onFechar();
  };

  // Voltar do celular: uma camada por nível (folha, cada pergunta, o passo a passo), senão o voltar
  // sai da tela — ou fecha o app, quando /lancar abriu pelo atalho (src/lib/voltarAndroid.ts).
  useVoltarFecha(!telaCheia, onFechar, 'lancar-folha');
  useVoltarFecha(pilha.length >= 1, () => setPilha([]), 'lancar-pergunta-1');
  useVoltarFecha(pilha.length >= 2, () => setPilha((p) => p.slice(0, 1)), 'lancar-pergunta-2');
  useVoltarFecha(!!acao, () => setAcao(null), 'lancar-passo-a-passo');

  // Escape e toque fora fecham a folha — menos no passo a passo, que pode estar gravando (só o X dele fecha).
  useEffect(() => {
    if (telaCheia || acao) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar, telaCheia, acao]);

  const ir = (d: Destino) => {
    if ('acao' in d) { setAcao(d.acao); return; }
    onFechar();
    (onNavegar ?? navigate)(d.rota);
  };

  const escolher = (o: Opcao) => {
    const unico = caminhoUnico(o, acesso);
    if (unico) {
      const v = variante(unico, acesso);
      if (v) ir(v.destino);
      return;
    }
    setPilha((p) => [...p, o]);
  };

  const titulo = atual ? atual.pergunta ?? atual.titulo : 'O que aconteceu?';
  const subtitulo = atual ? atual.perguntaSub : 'Escolha e eu levo você ao passo a passo certo.';

  const corpo = acesso.carregando ? (
    <div className="flex justify-center py-16"><div className="w-8 h-8 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
  ) : opcoes.length === 0 ? (
    <div className="py-10 px-4 text-center">
      <p className="text-sm text-zinc-500">Seu perfil ainda não tem nenhum lançamento liberado. Peça ao administrador em Configurações › Permissões.</p>
      {onListaCompleta && (
        <button onClick={() => { onFechar(); onListaCompleta(); }} className="mt-4 text-sm font-semibold text-amber-700 cursor-pointer">Ver todos os jeitos de lançar (lista completa)</button>
      )}
    </div>
  ) : (
    <div className="space-y-2.5">
      {opcoes.map((o) => {
        const v = o.filhos ? null : variante(o, acesso);
        return (
          <button key={o.id} onClick={() => escolher(o)}
            className="w-full flex items-center gap-3.5 bg-white border border-zinc-100 rounded-3xl p-3.5 min-h-[76px] text-left active:scale-[0.99] hover:border-amber-300 transition-all cursor-pointer">
            <span className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0"><i className={`${o.icone} text-2xl`} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-bold text-zinc-800 leading-tight">{o.titulo}</span>
              <span className="block text-xs text-zinc-500 mt-0.5 leading-snug">{v?.sub ?? o.sub}</span>
              {/* Na primeira pergunta fica limpo; dali em diante mostra para onde vai (e se o dono aprova). */}
              {nivel > 0 && v && (
                <span className={`inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold rounded-md px-1.5 py-0.5 ${v.aprova ? 'bg-sky-50 text-sky-700' : 'bg-zinc-100 text-zinc-600'}`}>
                  <i className={v.aprova ? 'ri-shield-check-line' : 'ri-arrow-right-up-line'} />{v.onde}
                </span>
              )}
            </span>
            <i className="ri-arrow-right-s-line text-2xl text-zinc-300 flex-shrink-0" />
          </button>
        );
      })}
      {nivel === 0 && onListaCompleta && (
        <button onClick={() => { onFechar(); onListaCompleta(); }} className="w-full py-3 text-sm font-semibold text-amber-700 cursor-pointer">
          Ver todos os jeitos de lançar (lista completa)
        </button>
      )}
    </div>
  );

  // "Lançar despesa" (passo a passo do ⚡) roda aqui dentro: o Roteiro dele ocupa a área toda.
  const passoAPasso = acao === 'lancar-despesa' && (
    <div className="relative flex-1 min-h-0">
      <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><span className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}>
        {/* Na tela cheia, fechar o passo a passo volta ao começo; na folha, fecha a folha. */}
        <LancarDespesa onFechar={telaCheia ? () => { setAcao(null); setPilha([]); } : onFechar} irPara={(rota) => { onFechar(); (onNavegar ?? navigate)(rota); }} />
      </Suspense>
    </div>
  );

  const cabecalho = (
    <div className="flex items-start gap-2">
      {(nivel > 0 || telaCheia) && (
        <button onClick={voltar} className="w-10 h-10 mt-0.5 flex items-center justify-center rounded-full bg-zinc-100 text-zinc-600 flex-shrink-0 cursor-pointer" aria-label="Voltar">
          <i className="ri-arrow-left-line text-xl" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        {atual && <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600">{atual.titulo}</p>}
        <p className="text-xl font-black text-zinc-900 leading-tight">{titulo}</p>
        {subtitulo && <p className="text-sm text-zinc-500 mt-0.5">{subtitulo}</p>}
      </div>
      {!telaCheia && (
        <button onClick={onFechar} className="w-10 h-10 mt-0.5 flex items-center justify-center rounded-full bg-zinc-100 text-zinc-500 flex-shrink-0 cursor-pointer" aria-label="Fechar">
          <i className="ri-close-line text-xl" />
        </button>
      )}
    </div>
  );

  if (telaCheia) {
    return (
      <div className="h-full flex flex-col bg-zinc-50">
        {passoAPasso || (
          <>
            <div className="px-4 pb-3 bg-white border-b border-zinc-100 flex-shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>{cabecalho}</div>
            <div className="flex-1 overflow-y-auto px-4 pt-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>{corpo}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center md:p-4" onClick={(e) => e.target === e.currentTarget && !acao && onFechar()}>
      <div className={`bg-zinc-50 w-full md:max-w-lg rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col ${acao ? 'h-[88vh] md:h-[640px]' : 'max-h-[92vh] md:max-h-[86vh]'} overflow-hidden`}>
        {passoAPasso || (
          <>
            <div className="px-4 pt-2.5 pb-3 flex-shrink-0">
              <div className="w-10 h-1.5 rounded-full bg-zinc-200 mx-auto mb-3 md:hidden" />
              {cabecalho}
            </div>
            <div className="flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 18px)' }}>{corpo}</div>
          </>
        )}
      </div>
    </div>
  );
}
