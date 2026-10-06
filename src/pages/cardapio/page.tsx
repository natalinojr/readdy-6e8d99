import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCardapio } from '../../contexts/CardapioContext';
import CategoriasTab from './components/CategoriasTab';
import ItensTab, { type EntradaItens } from './components/ItensTab';
import CombosTab from './components/CombosTab';
import ObservacoesGlobaisTab from './components/ObservacoesGlobaisTab';
import DestaquesTab from './components/DestaquesTab';
import TraducoesTab from './components/TraducoesTab';
import OpcoesEstoqueTab from './components/OpcoesEstoqueTab';
import CardapioExportImportModal from '../../components/feature/CardapioExportImportModal';
import { MenuMais, btn } from '@/components/kit';

import { notifyReload } from '@/lib/reloadSignal';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { publicarCardapio, aoPublicarAutomatico } from '@/hooks/useMenuPing';
import { useResumoItensCardapio } from '@/hooks/useResumoItensCardapio';
import { pendenciasCardapio } from '@/lib/cardapioLista';

// Layout novo do Cardápio (dono, 2026-10-06; protótipo sistema-proto › gestao1 › CARDÁPIO), SEM custo e margem.
// 5 grupos: Itens (Itens · Categorias · Combos) · Vender mais (Destaques) · Idiomas (Traduções) ·
// Estoque (Opções × Estoque) · Mais (Observações globais). Nenhuma aba antiga sumiu: só mudou de lugar.
// Sem "Publicar alterações": toda gravação avisa as telas sozinha (useMenuPing › agendarPublicacao, 2 s);
// "Atualizar as telas agora" no ⋯ força o aviso.

type Grupo = 'itens' | 'vender' | 'idiomas' | 'estoque' | 'mais';
type Pilula = 'itens' | 'categorias' | 'combos';

const GRUPOS: { id: Grupo; label: string; icon: string }[] = [
  { id: 'itens', label: 'Itens', icon: 'ri-restaurant-line' },
  { id: 'vender', label: 'Vender mais', icon: 'ri-star-line' },
  { id: 'idiomas', label: 'Idiomas', icon: 'ri-translate-2' },
  { id: 'estoque', label: 'Estoque', icon: 'ri-links-line' },
  { id: 'mais', label: 'Mais', icon: 'ri-chat-3-line' },
];

export default function CardapioPage() {
  const { itens, categorias, combos, destaques, loading, recarregar } = useCardapio();
  const [grupo, setGrupo] = useState<Grupo>('itens');
  const [pilula, setPilula] = useState<Pilula>('itens');
  const [showExportImport, setShowExportImport] = useState(false);
  const [ordenar, setOrdenar] = useState(false);
  const [novoItem, setNovoItem] = useState(0);
  const { user } = useAuth();
  const { addToast } = useToast();
  const { resumo, recarregar: recarregarResumo } = useResumoItensCardapio(user?.tenantId);

  // Links de fora do Cardápio (ex.: "Fazer ficha" do Estoque › CMV):
  //   ?item=<id>&ficha=1 abre o item na Ficha Técnica · ?busca=<nome> abre a lista de itens já filtrada ·
  //   ?aba=combos abre os combos. O link é consumido uma vez e sai da barra de endereço.
  const [params, setParams] = useSearchParams();
  const [entrada, setEntrada] = useState<EntradaItens | null>(null);
  useEffect(() => {
    const item = params.get('item');
    const busca = params.get('busca');
    const aba = params.get('aba');
    if (!item && !busca && aba !== 'combos') return;
    setGrupo('itens');
    if (item || busca) {
      setPilula('itens');
      setEntrada({ itemId: item, ficha: params.get('ficha') === '1', busca });
    } else {
      setPilula('combos');
    }
    setParams({}, { replace: true });
  }, [params, setParams]);

  // "As telas já atualizaram": aviso curto depois da publicação automática.
  const [avisoTelas, setAvisoTelas] = useState<'ok' | 'erro' | null>(null);
  const timerAviso = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => aoPublicarAutomatico((ok) => {
    setAvisoTelas(ok ? 'ok' : 'erro');
    clearTimeout(timerAviso.current);
    timerAviso.current = setTimeout(() => setAvisoTelas(null), ok ? 4000 : 9000);
  }), []);
  useEffect(() => () => clearTimeout(timerAviso.current), []);

  const [publicando, setPublicando] = useState(false);
  const atualizarTelas = async () => {
    if (!user?.tenantId || publicando) return;
    setPublicando(true);
    const ok = await publicarCardapio(user.tenantId);
    setPublicando(false);
    addToast(ok
      ? { type: 'success', title: 'Telas avisadas', message: 'PDV, garçom, totem, mesa, QR universal e delivery atualizam em alguns segundos.' }
      : { type: 'error', title: 'Não consegui avisar as telas', message: 'Verifique a internet e tente de novo.' });
  };

  // Selos dos grupos: o que precisa de você (as mesmas contas da lista de itens).
  const pendencias = useMemo(() => pendenciasCardapio(itens, destaques, resumo), [itens, destaques, resumo]);
  const seloGrupo: Partial<Record<Grupo, number>> = {
    itens: pendencias.filter((p) => p.tipo === 'ficha').length,
    vender: pendencias.filter((p) => p.tipo !== 'ficha').length,
  };

  const pilulas: { id: Pilula; label: string; n?: number }[] = [
    { id: 'itens', label: 'Itens', n: itens.length },
    { id: 'categorias', label: 'Categorias', n: categorias.length },
    { id: 'combos', label: 'Combos', n: combos.length || undefined },
  ];

  const abrirNovoItem = () => {
    setGrupo('itens');
    setPilula('itens');
    setNovoItem((n) => n + 1);
  };

  return (
    <div className="min-h-screen" style={{ background: '#FAF7F2' }}>
      {/* Cabeçalho */}
      <div className="px-4 md:px-6 pt-3 md:pt-5 pb-0 bg-white" style={{ borderBottom: '1px solid #EEE6DA' }}>
        <div className="flex items-center gap-2 md:gap-3 mb-2 md:mb-4">
          <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0 bg-amber-500">
            <i className="ri-restaurant-line text-zinc-900 text-base md:text-lg" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base md:text-lg font-bold text-zinc-900 flex items-center gap-2 flex-wrap">
              Cardápio
              {avisoTelas === 'ok' && (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 inline-flex items-center gap-1">
                  <i className="ri-check-line" />As telas já atualizaram
                </span>
              )}
              {avisoTelas === 'erro' && (
                <span className="text-[11px] font-bold text-red-600 bg-red-50 rounded-full px-2 py-0.5 inline-flex items-center gap-1"
                  title="Salvou, mas o aviso às telas não saiu. Use ⋯ › Atualizar as telas agora.">
                  <i className="ri-error-warning-line" />Salvou; as telas não foram avisadas
                </span>
              )}
            </h1>
            <p className="text-xs text-zinc-500 hidden sm:block">O que a loja vende e a que preço</p>
          </div>
          <MenuMais rotulo="Mais: exportar, importar e atualizar as telas" grande itens={[
            { rotulo: publicando ? 'Avisando as telas…' : 'Atualizar as telas agora', icone: 'ri-broadcast-line', onClick: atualizarTelas },
            { rotulo: 'Exportar / Importar', icone: 'ri-exchange-line', onClick: () => setShowExportImport(true) },
            { rotulo: ordenar ? 'Parar de mudar a ordem' : 'Mudar a ordem dos itens', icone: 'ri-arrow-up-down-line', onClick: () => { setGrupo('itens'); setPilula('itens'); setOrdenar((o) => !o); } },
          ]} />
          <button onClick={abrirNovoItem} className={btn('p')}>
            <i className="ri-add-line text-base" />Novo item
          </button>
        </div>

        {/* Grupos — no celular os 5 dividem a largura (ícone em cima, nome embaixo) */}
        <div className="flex md:gap-0.5 -mx-4 md:mx-0 px-1 md:px-0">
          {GRUPOS.map((g) => {
            const ativo = grupo === g.id;
            const n = seloGrupo[g.id] ?? 0;
            return (
              <button key={g.id} onClick={() => setGrupo(g.id)}
                className={`relative flex flex-1 md:flex-none flex-col md:flex-row items-center gap-0.5 md:gap-1.5 min-w-0 px-1 md:px-4 pt-2 pb-1.5 md:py-2.5 text-[11px] md:text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  ativo ? 'border-amber-500 text-amber-700' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}>
                <i className={`${g.icon} text-lg leading-none md:text-[13px] md:leading-normal`} />
                {g.label}
                {n > 0 && (
                  <span className="absolute top-0.5 left-1/2 ml-2 md:static md:ml-0 text-[9px] font-black px-1.5 py-0.5 rounded-full text-white bg-red-500 leading-none md:leading-normal">{n}</span>
                )}
              </button>
            );
          })}
        </div>
        {/* Pílulas do grupo Itens */}
        {grupo === 'itens' ? (
          <div className="py-2 md:py-2.5 -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto scrollbar-hide">
            <div className="flex bg-zinc-100 p-1 rounded-xl w-max">
              {pilulas.map((p) => (
                <button key={p.id} onClick={() => setPilula(p.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    pilula === p.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
                  {p.label}{p.n != null && <span className="text-zinc-400 font-semibold">{p.n}</span>}
                </button>
              ))}
            </div>
          </div>
        ) : <div className="h-1" />}
      </div>

      {/* Conteúdo */}
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto pb-28">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && grupo === 'itens' && pilula === 'itens' && (
          <ItensTab
            entrada={entrada}
            onEntradaUsada={() => setEntrada(null)}
            resumo={resumo}
            onResumoMudou={recarregarResumo}
            novoItemSinal={novoItem}
            ordenar={ordenar}
            onPararOrdenar={() => setOrdenar(false)}
            onIrDestaques={() => setGrupo('vender')}
          />
        )}
        {!loading && grupo === 'itens' && pilula === 'categorias' && <CategoriasTab />}
        {!loading && grupo === 'itens' && pilula === 'combos' && <CombosTab />}
        {!loading && grupo === 'vender' && <DestaquesTab />}
        {!loading && grupo === 'idiomas' && <TraducoesTab />}
        {!loading && grupo === 'estoque' && <OpcoesEstoqueTab />}
        {!loading && grupo === 'mais' && <ObservacoesGlobaisTab />}
      </div>

      {/* Modal Exportar / Importar */}
      <CardapioExportImportModal
        open={showExportImport}
        onClose={() => setShowExportImport(false)}
        onSuccess={() => {
          recarregar();
          notifyReload('menu');
          if (user?.tenantId) publicarCardapio(user.tenantId);
        }}
      />
    </div>
  );
}
