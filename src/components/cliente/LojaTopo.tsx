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

// Fotos empilhadas que trocam com fade. Só a 1ª baixa junto com a página; cada
// próxima só é pedida quando chega perto da vez dela — quem sai rápido não baixa as 10.
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
  const chave = capas.map(function (c) { return c.url; }).join('|');
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

  useEffect(function () {
    if (total < 2 || !autoplay || !visivel || !primeiraPronta) return;
    const t = setTimeout(function () { setAtual(function (a) { return (a + 1) % total; }); }, INTERVALO_CAPA_MS);
    return function () { clearTimeout(t); };
  }, [idx, total, autoplay, visivel, primeiraPronta, rodada]);

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
        return (
          <img
            key={c.url + i}
            src={c.url}
            alt=""
            draggable={false}
            onLoad={i === 0 ? function () { setPrimeiraPronta(true); } : undefined}
            onError={i === 0 ? function () { setPrimeiraPronta(true); } : undefined}
            className={'absolute inset-0 w-full h-full object-cover select-none transition-opacity duration-700 ' + (i === idx ? 'opacity-100' : 'opacity-0')}
            style={c.posicao ? { objectPosition: c.posicao } : undefined}
          />
        );
      })}
      {/* z-10: o bloco da logo sobe 40px por cima da capa e roubaria o toque */}
      {total > 1 ? (
        <div className="absolute bottom-1.5 right-3 z-10 flex items-center">
          {capas.map(function (c, i) {
            return (
              <button
                key={c.url + i}
                type="button"
                aria-label={'Foto ' + (i + 1) + ' de ' + total}
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
