// Topo da loja nas telas do cliente (delivery e QR): capa, logo, nome, situação
// (aberto/fechado) e as informações que decidem a compra (tempo, taxa, mínimo).
// Rola junto com o cardápio — quem fica preso no topo é a barra de categorias.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CapaLoja } from '@/lib/capasLoja';

export interface LojaTopoMeta {
  icone: string;
  rotulo: string;
  valor: string;
}

export type LojaTopoSituacao = 'aberto' | 'fechando' | 'fechado';

interface Props {
  nome: string;
  logoUrl?: string | null;
  /** Fotos de capa (até 10, passam sozinhas). Sem capa, a faixa usa a cor da loja. */
  capas?: CapaLoja[];
  situacao?: { tipo: LojaTopoSituacao; texto: string } | null;
  /** Texto curto ao lado da situação (ex.: cidade). */
  subtitulo?: string | null;
  metas?: LojaTopoMeta[];
  /** Botões no canto da capa (idioma, entrar, perfil). */
  acoes?: ReactNode;
  /** Conteúdo logo abaixo do nome (aviso de loja fechada, modo de entrega…). */
  children?: ReactNode;
}

const COR_SITUACAO: Record<LojaTopoSituacao, string> = {
  aberto: 'bg-emerald-50 text-emerald-700',
  fechando: 'bg-amber-50 text-amber-800',
  fechado: 'bg-red-50 text-red-700',
};

const PONTO_SITUACAO: Record<LojaTopoSituacao, string> = {
  aberto: 'bg-emerald-600',
  fechando: 'bg-amber-600',
  fechado: 'bg-red-600',
};

export default function LojaTopo(props: Props) {
  const iniciais = (props.nome || 'Loja')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(function (w) { return w.charAt(0); })
    .join('')
    .toUpperCase();

  const capas = props.capas || [];

  return (
    <div>
      <div
        className={'relative ' + (capas.length > 0 ? 'h-36 bg-zinc-800' : 'h-24 bg-[var(--cor-loja)]')}
      >
        {capas.length > 0 ? <CarrosselCapa capas={capas} /> : null}
        {props.acoes ? (
          <div className="absolute top-3 right-3 flex items-center gap-2">{props.acoes}</div>
        ) : null}
      </div>

      <div className="relative px-5 -mt-10">
        <div className="w-20 h-20 rounded-full border-4 border-[#FBF8F4] bg-white overflow-hidden flex items-center justify-center shadow-sm">
          {props.logoUrl ? (
            <img src={props.logoUrl} alt={'Logo ' + props.nome} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl font-black text-[var(--cor-loja)]">{iniciais}</span>
          )}
        </div>
        <h1 className="mt-2.5 text-[23px] leading-tight font-extrabold tracking-tight text-stone-900 break-words">
          {props.nome}
        </h1>
        {props.situacao || props.subtitulo ? (
          <div className="mt-2 flex items-center gap-2.5 flex-wrap">
            {props.situacao ? (
              <span className={'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[13px] font-bold ' + COR_SITUACAO[props.situacao.tipo]}>
                <span className={'w-1.5 h-1.5 rounded-full ' + PONTO_SITUACAO[props.situacao.tipo]} />
                {props.situacao.texto}
              </span>
            ) : null}
            {props.subtitulo ? (
              <span className="text-[13px] text-stone-600">{props.subtitulo}</span>
            ) : null}
          </div>
        ) : null}

        {props.metas && props.metas.length > 0 ? (
          <div
            className="mt-3.5 grid gap-2"
            style={{ gridTemplateColumns: 'repeat(' + props.metas.length + ', minmax(0, 1fr))' }}
          >
            {props.metas.map(function (m) {
              return (
                <div key={m.rotulo} className="bg-white border border-stone-200/70 rounded-2xl px-2.5 py-2.5 min-w-0">
                  <div className="text-xs text-stone-500 flex items-center gap-0.5">
                    <i className={m.icone + ' text-[13px] shrink-0'} />
                    <span className="truncate">{m.rotulo}</span>
                  </div>
                  <div className="text-[15px] font-bold text-stone-900 mt-0.5 truncate">{m.valor}</div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {props.children}
    </div>
  );
}

const INTERVALO_CAPA_MS = 5000;

/** Celular em economia de dados ou com "reduzir movimento": a capa fica parada na 1ª foto. */
function capaDevePassarSozinha(): boolean {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn && conn.saveData) return false;
  } catch { /* segue passando */ }
  return true;
}

/** Vídeo que não termina (rede travou) não prende o carrossel para sempre */
const VIDEO_MAX_MS = 30000;

// Fotos e vídeos empilhados que trocam com fade. Só o 1º slide baixa junto com a página;
// cada próximo só é pedido quando chega perto da vez dele — quem sai rápido não baixa tudo.
// Vídeo: só o slide da vez tem <video> (o próximo baixa só o quadro de capa); toca mudo
// até o fim e aí passa. Em economia de dados / reduzir movimento fica só o quadro de capa.
function CarrosselCapa(props: { capas: CapaLoja[] }) {
  const capas = props.capas;
  const total = capas.length;
  const [atual, setAtual] = useState(0);
  // Índices que já podem ter <img> no DOM (= já foram/estão sendo baixados)
  const [liberadas, setLiberadas] = useState<number[]>([0]);
  const [primeiraPronta, setPrimeiraPronta] = useState(false);
  const [autoplay] = useState(capaDevePassarSozinha);
  const [visivel, setVisivel] = useState(true);
  const [rodada, setRodada] = useState(0); // reinicia o tempo depois de um toque/arrasto
  const toqueRef = useRef<{ x: number; y: number } | null>(null);

  const idx = total > 0 ? atual % total : 0;

  // Troca de loja/lista (Configurações salvou outra ordem): recomeça do início
  const chave = capas.map(function (c) { return c.video || c.url; }).join('|');
  const chaveRef = useRef(chave);
  useEffect(function () {
    if (chaveRef.current === chave) return;
    chaveRef.current = chave;
    setAtual(0); setLiberadas([0]);
  }, [chave]);

  // Libera a foto atual e a próxima (a próxima baixa enquanto a atual aparece)
  useEffect(function () {
    if (total < 2 || !primeiraPronta) return;
    const proxima = (idx + 1) % total;
    setLiberadas(function (l) {
      if (l.indexOf(idx) >= 0 && l.indexOf(proxima) >= 0) return l;
      const n = l.slice();
      if (n.indexOf(idx) < 0) n.push(idx);
      if (n.indexOf(proxima) < 0) n.push(proxima);
      return n;
    });
  }, [idx, total, primeiraPronta]);

  // Aba em segundo plano não fica girando
  useEffect(function () {
    function aoMudar() { setVisivel(document.visibilityState !== 'hidden'); }
    document.addEventListener('visibilitychange', aoMudar);
    return function () { document.removeEventListener('visibilitychange', aoMudar); };
  }, []);

  // 1º slide sem imagem (vídeo sem quadro de capa): não há o que esperar carregar
  const primeiroSemImagem = total > 0 && !capas[0].url;
  useEffect(function () { if (primeiroSemImagem) setPrimeiraPronta(true); }, [primeiroSemImagem]);

  // Vídeo que deu erro (404, codec que o aparelho não abre) vira foto (fica o quadro de capa).
  // Sem isso, vários vídeos quebrados trocariam de slide sem parar, baixando de novo a cada volta.
  const [falhos, setFalhos] = useState<string[]>([]);
  const slideEhVideo = total > 0 && !!capas[idx].video && falhos.indexOf(capas[idx].video as string) < 0;
  const tocaVideo = slideEhVideo && autoplay && visivel;

  useEffect(function () {
    if (total < 2 || !autoplay || !visivel || !primeiraPronta) return;
    // Vídeo passa sozinho no fim (onEnded); o tempo aqui é só a trava de segurança
    const espera = slideEhVideo ? VIDEO_MAX_MS : INTERVALO_CAPA_MS;
    const t = setTimeout(function () { setAtual(function (a) { return (a + 1) % total; }); }, espera);
    return function () { clearTimeout(t); };
  }, [idx, total, autoplay, visivel, primeiraPronta, rodada, slideEhVideo]);

  function proximoSlide() {
    if (total < 2) return;
    setAtual(function (a) { return (a + 1) % total; });
  }

  function videoFalhou(url: string) {
    setFalhos(function (f) { return f.indexOf(url) >= 0 ? f : f.concat([url]); });
    setRodada(function (r) { return r + 1; }); // o slide segue como foto, com os 5 s contando de agora
  }

  function irPara(n: number) {
    const destino = ((n % total) + total) % total;
    // Toque antes da 1ª foto carregar: libera a escolhida na hora (senão o topo fica vazio)
    setLiberadas(function (l) { return l.indexOf(destino) >= 0 ? l : l.concat([destino]); });
    setAtual(destino);
    setRodada(function (r) { return r + 1; });
  }

  function aoDescer(e: React.PointerEvent<HTMLDivElement>) {
    toqueRef.current = { x: e.clientX, y: e.clientY };
  }

  function aoSoltar(e: React.PointerEvent<HTMLDivElement>) {
    const ini = toqueRef.current;
    toqueRef.current = null;
    if (!ini || total < 2) return;
    const dx = e.clientX - ini.x;
    const dy = e.clientY - ini.y;
    // Só arrasto claramente horizontal troca a foto; vertical é a rolagem do cardápio
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    irPara(dx < 0 ? idx + 1 : idx - 1);
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={total > 1 ? aoDescer : undefined}
      onPointerUp={total > 1 ? aoSoltar : undefined}
      onPointerCancel={function () { toqueRef.current = null; }}
    >
      {capas.map(function (c, i) {
        if (liberadas.indexOf(i) < 0) return null;
        const pronto = i === 0 ? function () { setPrimeiraPronta(true); } : undefined;
        return (
          <div
            key={(c.video || c.url) + i}
            data-slide={c.video ? 'video' : 'foto'}
            className={'absolute inset-0 transition-opacity duration-700 ' + (i === idx ? 'opacity-100' : 'opacity-0')}
          >
            {c.url ? (
              <img
                src={c.url}
                alt=""
                draggable={false}
                onLoad={pronto}
                onError={pronto}
                className="absolute inset-0 w-full h-full object-cover select-none"
                style={c.posicao ? { objectPosition: c.posicao } : undefined}
              />
            ) : null}
            {c.video && i === idx && tocaVideo ? (
              <VideoMudo
                src={c.video}
                loop={total < 2}
                onEnded={proximoSlide}
                onError={function () { videoFalhou(c.video as string); }}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : null}
          </div>
        );
      })}
      {/* z-10: o bloco da logo sobe 40px por cima da capa e roubaria o toque */}
      {total > 1 ? (
        <div className="absolute bottom-1.5 right-3 z-10 flex items-center">
          {capas.map(function (c, i) {
            return (
              <button
                key={(c.video || c.url) + i}
                type="button"
                aria-label={(c.video ? 'Vídeo ' : 'Foto ') + (i + 1) + ' de ' + total}
                aria-current={i === idx ? 'true' : undefined}
                onClick={function () { irPara(i); }}
                className="w-5 h-6 flex items-center justify-center cursor-pointer"
              >
                <span className={'block h-1.5 rounded-full shadow-sm transition-all ' + (i === idx ? 'w-4 bg-white' : 'w-1.5 bg-white/60')} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * <video> mudo que toca sozinho. O React não escreve o atributo `muted` no DOM, e o
 * Safari do iPhone só deixa tocar sem toque se o vídeo já nasce mudo — por isso o ref.
 */
export function VideoMudo(props: { src: string; loop?: boolean; onEnded?: () => void; onError?: () => void; className?: string; preload?: 'auto' | 'metadata' | 'none' }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(function () {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute('muted', '');
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(function () { /* autoplay negado: fica o quadro de capa */ });
  }, [props.src]);
  return (
    <video
      ref={ref}
      src={props.src}
      muted
      autoPlay
      playsInline
      loop={props.loop}
      preload={props.preload || 'auto'}
      onEnded={props.onEnded}
      onError={props.onError}
      disablePictureInPicture
      className={props.className}
    />
  );
}

/** Botão branco que fica sobre a capa (idioma, entrar, perfil). */
export function BotaoCapa(props: { onClick?: () => void; icone: string; texto?: string; rotulo?: string; badge?: number }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.rotulo || props.texto}
      className="relative h-11 min-w-[44px] px-3.5 rounded-full bg-white/95 text-stone-900 text-sm font-bold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer hover:bg-white transition-colors"
    >
      <i className={props.icone + ' text-[17px]'} />
      {props.texto ? <span>{props.texto}</span> : null}
      {props.badge && props.badge > 0 ? (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--cor-loja)] text-white text-[10px] font-black flex items-center justify-center">
          {props.badge}
        </span>
      ) : null}
    </button>
  );
}
