// Estúdio de Criação › Criar — escolhe item + modelo, gera a arte (PNG) e decide (aprovar/reprovar).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Wand2, Loader2, Download, Check, X, RefreshCw, AlertTriangle, LayoutTemplate } from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';
import { brl } from '../../trafego-pago/shared';
import { EstadoVazio, FORMATO_LABEL, type LibItem, type Template, type Kit, type Creative } from '../shared';

interface Props {
  tenantId: string;
  items: LibItem[];
  templates: Template[];
  kit: Kit | null;
  isManager: boolean;
  presetItemId: string | null;
  onGerada: (c: Creative) => void;
}

interface Textos { titulo: string; subtitulo: string; preco: string; cta: string; selo: string }

export default function CriarTab({ tenantId, items, templates, kit, isManager, presetItemId, onGerada }: Props) {
  const comFoto = useMemo(() => items.filter((i) => i.photo_url), [items]);
  const [busca, setBusca] = useState('');
  const [itemId, setItemId] = useState<string | null>(presetItemId ?? null);
  const [templateId, setTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [textos, setTextos] = useState<Textos>({ titulo: '', subtitulo: '', preco: '', cta: kit?.cta_padrao ?? '', selo: '' });
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [creative, setCreative] = useState<Creative | null>(null);
  const [decidindo, setDecidindo] = useState<'aprovada' | 'reprovada' | null>(null);
  const previaRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (presetItemId) setItemId(presetItemId); }, [presetItemId]);
  // Biblioteca/modelos podem chegar depois do 1º render: escolhe o padrão quando chegarem.
  useEffect(() => {
    if (itemId || !comFoto.length) return;
    // Padrão: a foto de melhor nota (a lista já vem por mais vendidos).
    const melhor = [...comFoto].sort((a, b) => (b.nota_qualidade ?? -1) - (a.nota_qualidade ?? -1))[0];
    setItemId(melhor.item_id);
  }, [itemId, comFoto]);
  useEffect(() => { if (!templateId && templates[0]) setTemplateId(templates[0].id); }, [templateId, templates]);

  const item = comFoto.find((i) => i.item_id === itemId) ?? null;
  // Trocou de item → preço do cardápio desse item (não carrega o preço do item anterior).
  useEffect(() => {
    if (item) setTextos((t) => ({ ...t, preco: String(item.price) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, item?.price]);

  const itensFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return comFoto;
    return comFoto.filter((i) => i.name.toLowerCase().includes(q));
  }, [comFoto, busca]);

  const gerar = async () => {
    if (!itemId || !templateId) return;
    setGerando(true); setErro(null); setCreative(null);
    const precoNum = textos.preco.trim() === '' ? null : Number(textos.preco.replace(',', '.'));
    const { data, error } = await invokeWithAuth<{ success: boolean; creative: Creative; error?: string }>('estudio', {
      body: {
        action: 'render', tenant_id: tenantId, template: templateId, item_id: itemId,
        textos: {
          ...(textos.titulo.trim() ? { titulo: textos.titulo.trim() } : {}),
          ...(textos.subtitulo.trim() ? { subtitulo: textos.subtitulo.trim() } : {}),
          ...(precoNum !== null && !Number.isNaN(precoNum) ? { preco: precoNum } : {}),
          ...(textos.cta.trim() ? { cta: textos.cta.trim() } : {}),
          ...(textos.selo.trim() ? { selo: textos.selo.trim() } : {}),
        },
      },
    });
    setGerando(false);
    if (error || !data?.success) { setErro(error?.message ?? data?.error ?? 'Não consegui gerar a arte agora.'); return; }
    setCreative(data.creative);
    onGerada(data.creative);
    // No celular a prévia fica embaixo de tudo: rola até ela.
    setTimeout(() => previaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const decidir = async (status: 'aprovada' | 'reprovada') => {
    if (!creative) return;
    setDecidindo(status); setErro(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; creative: Creative; error?: string }>('estudio', {
      body: { action: 'decide', tenant_id: tenantId, creative_id: creative.id, status },
    });
    setDecidindo(null);
    if (error || !data?.success) { setErro(error?.message ?? data?.error ?? 'Não consegui salvar a decisão.'); return; }
    setCreative(data.creative);
    onGerada(data.creative);
  };

  if (comFoto.length === 0) {
    return <EstadoVazio icon={Wand2} titulo="Nenhum item pronto para virar arte" texto="Adicione uma foto ao item no Cardápio, ou veja a aba Biblioteca para saber quais fotos ainda faltam." />;
  }
  if (templates.length === 0) {
    return <EstadoVazio icon={LayoutTemplate} titulo="Sem modelos disponíveis" texto="Não há modelos de arte cadastrados no momento." />;
  }

  const inp = 'w-full text-sm border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-700 focus:outline-none focus:border-fuchsia-400';
  const lbl = 'text-[11px] font-semibold text-zinc-500 mb-1 block';

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-4">
      <div className="space-y-4">
        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> <span>{erro}</span>
          </div>
        )}

        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-zinc-800 mb-2">1. Escolha o item</p>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no cardápio..." className={`${inp} mb-2`} />
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-56 overflow-y-auto">
            {itensFiltrados.map((i) => (
              <button key={i.item_id} onClick={() => setItemId(i.item_id)}
                className={`rounded-lg border-2 overflow-hidden text-left cursor-pointer ${itemId === i.item_id ? 'border-fuchsia-500' : 'border-transparent hover:border-zinc-200'}`}>
                <div className="aspect-square bg-zinc-50"><img src={i.photo_url ?? ''} alt={i.name} className="w-full h-full object-cover" /></div>
                <p className="text-[10px] font-semibold text-zinc-700 truncate px-1 py-0.5">{i.name}</p>
              </button>
            ))}
            {itensFiltrados.length === 0 && <p className="col-span-full text-xs text-zinc-400 py-4 text-center">Nenhum item encontrado.</p>}
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-zinc-800 mb-2">2. Escolha o modelo</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {templates.map((t) => (
              <button key={t.id} onClick={() => setTemplateId(t.id)}
                className={`text-left rounded-xl border-2 p-3 cursor-pointer ${templateId === t.id ? 'border-fuchsia-500 bg-fuchsia-50/40' : 'border-zinc-200 hover:border-zinc-300'}`}>
                <p className="text-xs font-bold text-zinc-800">{t.nome}</p>
                <p className="text-[10px] text-zinc-400">{FORMATO_LABEL[t.formato] ?? t.formato}</p>
                <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">{t.descricao}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-zinc-800 mb-2">3. Textos (opcional)</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><span className={lbl}>Título</span><input value={textos.titulo} onChange={(e) => setTextos((t) => ({ ...t, titulo: e.target.value }))} className={inp} placeholder={item?.name ?? ''} /></div>
            <div><span className={lbl}>Subtítulo</span><input value={textos.subtitulo} onChange={(e) => setTextos((t) => ({ ...t, subtitulo: e.target.value }))} className={inp} /></div>
            <div><span className={lbl}>Preço</span><input value={textos.preco} onChange={(e) => setTextos((t) => ({ ...t, preco: e.target.value }))} className={inp} placeholder={item ? String(item.price) : ''} /></div>
            <div><span className={lbl}>CTA</span><input value={textos.cta} onChange={(e) => setTextos((t) => ({ ...t, cta: e.target.value }))} className={inp} placeholder={kit?.cta_padrao ?? 'Peça já'} /></div>
            <div><span className={lbl}>Selo</span><input value={textos.selo} onChange={(e) => setTextos((t) => ({ ...t, selo: e.target.value }))} className={inp} placeholder="Ex.: Novo, Promoção" /></div>
          </div>
        </div>

        <button onClick={gerar} disabled={gerando || !itemId || !templateId}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-xl bg-fuchsia-600 text-white hover:bg-fuchsia-700 cursor-pointer disabled:opacity-50">
          {gerando ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} {gerando ? 'Gerando (pode levar até 10s)...' : 'Gerar arte'}
        </button>
      </div>

      <div ref={previaRef} className="bg-white border border-zinc-200 rounded-2xl p-4 h-fit lg:sticky lg:top-4">
        <p className="text-sm font-bold text-zinc-800 mb-3">Prévia</p>
        {gerando ? (
          <div className="aspect-square rounded-xl bg-zinc-50 flex flex-col items-center justify-center text-zinc-400 gap-2">
            <Loader2 size={22} className="animate-spin text-fuchsia-500" />
            <p className="text-xs font-semibold">Gerando arte...</p>
          </div>
        ) : creative ? (
          <div className="space-y-3">
            <img src={creative.url} alt="" className="w-full rounded-xl border border-zinc-200" />
            <div className="flex items-center gap-2 flex-wrap">
              <a href={creative.url} download className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 cursor-pointer">
                <Download size={13} /> Baixar
              </a>
              {isManager && (
                <>
                  <button onClick={() => decidir('aprovada')} disabled={!!decidindo}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer disabled:opacity-50">
                    {decidindo === 'aprovada' ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />} Aprovar
                  </button>
                  <button onClick={() => decidir('reprovada')} disabled={!!decidindo}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-white border border-red-200 text-red-500 hover:bg-red-50 cursor-pointer disabled:opacity-50">
                    {decidindo === 'reprovada' ? <Loader2 size={12} className="animate-spin" /> : <X size={13} />} Reprovar
                  </button>
                </>
              )}
              <button onClick={() => setCreative(null)} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 cursor-pointer">
                <RefreshCw size={12} /> Gerar outra
              </button>
            </div>
            <p className="text-[11px] text-zinc-400">Status: <span className="font-semibold">{creative.status}</span></p>
          </div>
        ) : (
          <div className="aspect-square rounded-xl bg-zinc-50 flex flex-col items-center justify-center text-zinc-300 gap-2">
            <Wand2 size={24} />
            <p className="text-xs font-semibold text-zinc-400">A arte aparece aqui</p>
          </div>
        )}
        {item && (
          <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center gap-2">
            <img src={item.photo_url ?? ''} alt="" className="w-9 h-9 rounded-lg object-cover" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-zinc-700 truncate">{item.name}</p>
              <p className="text-[11px] text-zinc-400">{brl(item.price)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
