import { lazy, Suspense, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import LojaTopo from '@/components/cliente/LojaTopo';
import { lerCapasLoja } from '@/lib/capasLoja';
import { corLojaVars } from '@/lib/corLoja';
import { clubeChamar, type ClubeProgramaPublico } from '@/lib/clubePublico';
import type { Rastreio } from '@/pages/delivery/components/RastreioMapa';

// /p/<código> — link que a loja cola no chat do iFood ("Acompanhe seu pedido: <link>").
// Mostra a situação do pedido do iFood, o motoboy no mapa quando a entrega é nossa e ele está em rota,
// e o convite para o delivery próprio e o clube. Dados: motoboy-signal › pedido_link (público, só o
// código aleatório gerado pela loja em fn_ifood_link_cliente).

const RastreioMapa = lazy(() => import('@/pages/delivery/components/RastreioMapa'));

interface PedidoLink {
  numero: string | null;
  status: string;
  tipo: string;
  entrega_nossa: boolean;
  primeiro_nome: string | null;
  chegou: string | null;
  aceito: string | null;
  pronto: string | null;
  saiu: string | null;
  entregue: string | null;
}
interface LojaLink {
  name: string; slug: string | null; logo_url: string | null; cover_url: string | null; brand_color: string | null;
  cover_position: string | null; cover_images: unknown; cover_videos: unknown;
}
interface Resposta { ok: boolean; error?: string; pedido?: PedidoLink; rastreio?: Rastreio | null; loja?: LojaLink | null }

const ENCERRADO = ['concluded', 'cancelled'];

async function buscar(codigo: string): Promise<Resposta> {
  const base = ((import.meta.env.VITE_PUBLIC_SUPABASE_URL as string) || '').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/functions/v1/motoboy-signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pedido_link', codigo }),
    });
    return (await res.json()) as Resposta;
  } catch {
    return { ok: false, error: 'sem_conexao' };
  }
}

const hhmm = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
};

/** Frase grande do topo, pela situação do iFood. */
function situacao(p: PedidoLink, rastreio: Rastreio | null): { titulo: string; texto: string; icone: string } {
  const entrega = p.tipo === 'DELIVERY';
  switch (p.status) {
    case 'cancelled': return { titulo: 'Pedido cancelado', texto: 'Se tiver dúvida, fale com a gente pelo chat do iFood.', icone: 'ri-close-circle-line' };
    case 'concluded': return { titulo: entrega ? 'Pedido entregue' : 'Pedido retirado', texto: 'Bom apetite! Obrigado por pedir com a gente.', icone: 'ri-emotion-happy-line' };
    case 'dispatched':
      return entrega
        ? { titulo: 'Saiu para entrega', texto: rastreio?.chegando ? 'Deve estar chegando.' : rastreio?.eta_min ? `Chega em cerca de ${rastreio.eta_min} min.` : 'O motoboy já está a caminho.', icone: 'ri-e-bike-2-line' }
        : { titulo: 'Pronto para retirar', texto: 'Pode vir buscar.', icone: 'ri-shopping-bag-3-line' };
    case 'ready':
      return entrega
        ? { titulo: 'Pedido pronto', texto: 'Já já sai para entrega.', icone: 'ri-checkbox-circle-line' }
        : { titulo: 'Pronto para retirar', texto: 'Pode vir buscar.', icone: 'ri-shopping-bag-3-line' };
    case 'placed': return { titulo: 'Pedido recebido', texto: 'Já vamos começar a preparar.', icone: 'ri-file-list-3-line' };
    default: return { titulo: 'Em preparo', texto: 'Seu pedido está sendo preparado com carinho.', icone: 'ri-fire-line' };
  }
}

function Passos({ p }: { p: PedidoLink }) {
  const rank: Record<string, number> = { placed: 0, confirmed: 1, preparing: 1, ready: 2, dispatched: 3, concluded: 4 };
  const r = rank[p.status] ?? 0;
  const entrega = p.tipo === 'DELIVERY';
  const passos = [
    { rotulo: 'Recebido', ts: p.chegou, min: 0 },
    { rotulo: 'Em preparo', ts: p.aceito, min: 1 },
    ...(entrega ? [{ rotulo: 'Saiu', ts: p.saiu, min: 3 }] : [{ rotulo: 'Pronto', ts: p.pronto, min: 2 }]),
    { rotulo: entrega ? 'Entregue' : 'Retirado', ts: p.entregue, min: 4 },
  ];
  return (
    <div className="flex items-start mt-4">
      {passos.map((s, i) => {
        const ok = r >= s.min;
        const atual = !ok && (i === 0 || r >= passos[i - 1].min);
        return (
          <div key={s.rotulo} className="relative flex-1 min-w-0 text-center">
            {i > 0 && <span aria-hidden className={`absolute top-[13px] left-[-50%] right-1/2 h-0.5 ${ok ? 'bg-[var(--cor-loja)]' : 'bg-stone-200'}`} />}
            <span className={`relative z-10 mx-auto grid place-items-center w-7 h-7 rounded-full border-2 text-sm ${ok ? 'bg-[var(--cor-loja)] border-[var(--cor-loja)] text-white' : atual ? 'bg-white border-[var(--cor-loja)] text-[var(--cor-loja)]' : 'bg-white border-stone-200 text-stone-300'}`}>
              <i className={ok ? 'ri-check-line' : 'ri-time-line'} />
            </span>
            <b className={`block text-[11.5px] font-extrabold mt-1 ${ok || atual ? 'text-stone-800' : 'text-stone-400'}`}>{s.rotulo}</b>
            <span className="block text-[11px] text-stone-400 tabular-nums">{ok ? hhmm(s.ts) ?? '' : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function AcompanharPage() {
  const { codigo = '' } = useParams<{ codigo: string }>();
  const [dados, setDados] = useState<Resposta | null>(null);
  const [programa, setPrograma] = useState<ClubeProgramaPublico | null>(null);

  const status = dados?.pedido?.status ?? null;
  const emRota = !!dados?.rastreio;
  useEffect(() => {
    let vivo = true;
    const ler = () => buscar(codigo).then((r) => {
      // Falha de rede depois do 1º carregamento: mantém o que já está na tela.
      if (vivo) setDados((ant) => (r.ok || !ant?.ok ? r : ant));
    });
    if (!dados) ler();
    if (status && ENCERRADO.includes(status)) return () => { vivo = false; };
    const id = setInterval(ler, emRota ? 15000 : 30000);
    return () => { vivo = false; clearInterval(id); };
  }, [codigo, status, emRota]); // eslint-disable-line react-hooks/exhaustive-deps

  const slug = dados?.loja?.slug ?? null;
  useEffect(() => {
    if (!slug) return;
    clubeChamar<{ ativo: boolean; programa: ClubeProgramaPublico | null }>({ action: 'programa', slug })
      .then((r) => setPrograma(r.ativo ? r.programa ?? null : null));
  }, [slug]);

  if (!dados) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <i className="ri-loader-4-line text-3xl text-stone-400 animate-spin" />
      </div>
    );
  }
  if (!dados.ok || !dados.pedido) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-6 text-center">
        <div>
          <i className="ri-error-warning-line text-3xl text-stone-400" />
          <p className="mt-2 font-bold text-stone-800">{dados.error === 'sem_conexao' ? 'Sem conexão' : 'Link não encontrado'}</p>
          <p className="text-sm text-stone-500 mt-1">{dados.error === 'sem_conexao' ? 'Confira a internet e tente de novo.' : 'Confira se o link foi copiado inteiro.'}</p>
        </div>
      </div>
    );
  }

  const p = dados.pedido;
  const loja = dados.loja;
  const rastreio = dados.rastreio ?? null;
  const sit = situacao(p, rastreio);
  const mostraMapa = !!rastreio && (!!rastreio.motoboy || !!rastreio.destino);
  const pontos = programa?.pontos;

  return (
    <div className="min-h-screen bg-stone-50 pb-10" style={corLojaVars(loja?.brand_color || null)}>
      <div className="max-w-md mx-auto">
        {loja && <LojaTopo nome={loja.name} logoUrl={loja.logo_url} capas={lerCapasLoja(loja)} />}

        <div className="px-4 mt-4 space-y-3">
          <section className="bg-white rounded-2xl border border-stone-200 p-4">
            <p className="text-[12.5px] text-stone-500">
              {p.primeiro_nome ? `Olá, ${p.primeiro_nome}! ` : ''}Seu pedido{p.numero ? ` #${p.numero}` : ''} do iFood
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span className="w-11 h-11 rounded-2xl bg-[var(--cor-loja-suave)] text-[var(--cor-loja)] flex items-center justify-center shrink-0">
                <i className={`${sit.icone} text-2xl`} />
              </span>
              <div className="min-w-0">
                <h1 className="text-[19px] font-extrabold text-stone-900 leading-tight">{sit.titulo}</h1>
                <p className="text-[13px] text-stone-600">{sit.texto}</p>
              </div>
            </div>
            {p.status !== 'cancelled' && <Passos p={p} />}

            {mostraMapa && (
              <div className="mt-4">
                <Suspense fallback={<div className="h-52 rounded-2xl bg-stone-100 animate-pulse" />}>
                  <RastreioMapa rastreio={rastreio!} />
                </Suspense>
                <p className="text-[12px] text-stone-500 mt-1.5 text-center">
                  {rastreio!.motoboy
                    ? `Localização do motoboy às ${hhmm(rastreio!.motoboy.atualizado_em) ?? ''}${rastreio!.distancia_km != null ? ` · a ${String(rastreio!.distancia_km).replace('.', ',')} km` : ''}`
                    : 'A localização do motoboy aparece aqui quando o GPS do celular dele atualizar.'}
                </p>
              </div>
            )}
            {p.tipo === 'DELIVERY' && !p.entrega_nossa && p.status === 'dispatched' && (
              <p className="text-[12.5px] text-stone-500 mt-3">A entrega é feita pelo iFood: acompanhe o entregador no app do iFood.</p>
            )}
          </section>

          {slug && (
            <section className="bg-white rounded-2xl border border-stone-200 p-4">
              <h2 className="text-[16px] font-extrabold text-stone-900">Da próxima vez, peça direto com a gente</h2>
              <p className="text-[13px] text-stone-600 mt-1">Nosso cardápio completo no nosso delivery.</p>
              <a href={`/${slug}-delivery?utm_source=ifood_link`}
                className="mt-3 flex items-center justify-center gap-2 h-12 rounded-2xl bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] text-white text-sm font-bold">
                <i className="ri-restaurant-line" /> Ver o cardápio
              </a>
            </section>
          )}

          {slug && programa && (
            <section className="bg-white rounded-2xl border border-stone-200 p-4">
              <h2 className="text-[16px] font-extrabold text-stone-900"><i className="ri-vip-crown-2-line text-[var(--cor-loja)]" /> {programa.nome || 'Clube de vantagens'}</h2>
              <p className="text-[13px] text-stone-600 mt-1">
                Junte pontos comprando com a gente e troque por prêmios.
                {pontos?.bonus_cadastro ? ` Ganhe ${pontos.bonus_cadastro} pontos só por entrar.` : ''}
              </p>
              {programa.recompensas.length > 0 && (
                <p className="text-[12.5px] text-stone-500 mt-1.5 truncate">
                  Prêmios: {programa.recompensas.slice(0, 3).map((r) => r.nome).join(' · ')}
                </p>
              )}
              <a href={`/clube/${slug}`}
                className="mt-3 flex items-center justify-center gap-2 h-12 rounded-2xl border-2 border-[var(--cor-loja)] text-[var(--cor-loja)] text-sm font-bold">
                Conhecer o clube
              </a>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
