// Topo da loja nas telas do cliente (delivery e QR): capa, logo, nome, situação
// (aberto/fechado) e as informações que decidem a compra (tempo, taxa, mínimo).
// Rola junto com o cardápio — quem fica preso no topo é a barra de categorias.
import type { ReactNode } from 'react';

export interface LojaTopoMeta {
  icone: string;
  rotulo: string;
  valor: string;
}

export type LojaTopoSituacao = 'aberto' | 'fechando' | 'fechado';

interface Props {
  nome: string;
  logoUrl?: string | null;
  /** Foto de capa da loja. Sem capa, a faixa usa a cor da loja. */
  capaUrl?: string | null;
  /** Parte da capa que aparece ("X% Y%", Configurações › Loja). Vazio = centro. */
  capaPosicao?: string | null;
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

  return (
    <div>
      <div
        className={'relative ' + (props.capaUrl ? 'h-36 bg-zinc-800' : 'h-24 bg-[var(--cor-loja)]')}
      >
        {props.capaUrl ? (
          <img
            src={props.capaUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={props.capaPosicao ? { objectPosition: props.capaPosicao } : undefined}
          />
        ) : null}
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
