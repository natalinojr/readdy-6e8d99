import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Ajuda from '../inicio/Ajuda';

// Peças visuais do Estoque no layout novo (protótipo docs/prototipos/estoque-abas-proposta.html, aprovado
// em 2026-10-04). Mesmo desenho do Início: cartão branco rounded-2xl border-zinc-200, faixa colorida à
// esquerda, âmbar como cor da marca, números grandes e poucos. Toda aba do Estoque usa estas peças.

// ── Botões ──────────────────────────────────────────────────────────────────
export type TomBotao = 'p' | 'dark' | 'out' | 'wa' | 'ghost' | 'perigo';
/** Classe de botão: p = âmbar (ação principal), dark = preto, out = contorno, wa = WhatsApp. */
export function btn(tom: TomBotao = 'out', tamanho: 'sm' | 'md' = 'md') {
  const base = 'inline-flex items-center justify-center gap-1.5 font-bold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
  const tam = tamanho === 'sm' ? 'min-h-[34px] px-3 rounded-xl text-[12.5px]' : 'min-h-[42px] px-4 rounded-xl text-[13.5px]';
  const cor = {
    p: 'bg-amber-500 hover:bg-amber-400 text-zinc-900',
    dark: 'bg-zinc-900 hover:bg-zinc-800 text-white',
    out: 'bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700',
    wa: 'bg-[#1FA855] hover:bg-[#1a9249] text-white',
    ghost: 'text-amber-700 hover:bg-amber-50',
    perigo: 'bg-white border border-red-200 text-red-600 hover:bg-red-50',
  }[tom];
  return `${base} ${tam} ${cor}`;
}

// ── Faixa de números (troca os cartões grandes; nenhum número some) ─────────────
export type TomNumero = 'neutro' | 'red' | 'amber' | 'green';
export interface ItemFaixa {
  valor: ReactNode;
  rotulo: string;
  tom?: TomNumero;
  onClick?: () => void;
  ajuda?: ReactNode;
}
const corNumero: Record<TomNumero, string> = {
  neutro: 'text-zinc-900', red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-700',
};
/** No celular rola de lado; no computador divide a largura. */
export function Faixa({ itens, className = '' }: { itens: ItemFaixa[]; className?: string }) {
  return (
    <div className={`flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:grid md:overflow-visible ${className}`}
      style={{ gridTemplateColumns: `repeat(${itens.length}, minmax(0, 1fr))` }}>
      {itens.map((it, k) => {
        const Tag = it.onClick ? 'button' : 'div';
        return (
          <Tag key={k} onClick={it.onClick} type={it.onClick ? 'button' : undefined}
            className={`flex-none min-w-[104px] md:min-w-0 text-left bg-white border border-zinc-200 rounded-2xl px-3 py-2 md:px-4 md:py-2.5 ${it.onClick ? 'hover:border-amber-300 cursor-pointer' : ''}`}>
            <p className={`text-[17px] md:text-xl font-extrabold leading-tight tabular-nums truncate ${corNumero[it.tom ?? 'neutro']}`}>{it.valor}</p>
            <p className="text-[10.5px] md:text-[11px] font-semibold text-zinc-400 mt-0.5 flex items-center gap-1 whitespace-nowrap">
              {it.rotulo}{it.ajuda && <Ajuda titulo={it.rotulo}>{it.ajuda}</Ajuda>}
            </p>
          </Tag>
        );
      })}
    </div>
  );
}

// ── Cartões ─────────────────────────────────────────────────────────────────
export type TomCartao = 'prop' | 'alerta' | 'ok' | 'neutro' | 'info';
const fundoCartao: Record<TomCartao, string> = {
  prop: 'bg-gradient-to-b from-amber-50/80 to-white border-amber-200',
  alerta: 'bg-gradient-to-b from-red-50/80 to-white border-red-200',
  ok: 'bg-emerald-50 border-emerald-200',
  neutro: 'bg-white border-zinc-200',
  info: 'bg-white border-zinc-200',
};
const iconeCartao: Record<TomCartao, string> = {
  prop: 'bg-amber-100 text-amber-700', alerta: 'bg-red-100 text-red-600', ok: 'bg-emerald-100 text-emerald-700',
  neutro: 'bg-zinc-100 text-zinc-600', info: 'bg-blue-50 text-blue-600',
};
/** Cartão que diz o que fazer (propositivo): ícone, título, texto curto e botões que resolvem ali. */
export function CartaoAcao({ tom = 'prop', icone, titulo, direita, children, acoes, className = '' }: {
  tom?: TomCartao;
  icone?: string;
  titulo: ReactNode;
  direita?: ReactNode;
  children?: ReactNode;
  acoes?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border rounded-2xl px-4 py-3 ${fundoCartao[tom]} ${className}`}>
      <div className="flex items-start gap-2.5">
        {icone && <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconeCartao[tom]}`}><i className={`${icone} text-base`} /></span>}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <p className="text-[14.5px] font-extrabold text-zinc-900 leading-snug flex-1 min-w-0 pt-1">{titulo}</p>
            {direita && <div className="flex-shrink-0">{direita}</div>}
          </div>
          {children && <div className="text-[12.5px] text-zinc-600 leading-relaxed mt-1">{children}</div>}
        </div>
      </div>
      {acoes && <div className="flex gap-2 flex-wrap mt-2.5">{acoes}</div>}
    </div>
  );
}

export type CorBarra = 'red' | 'amber' | 'green' | 'blue' | 'zinc';
const corBarra: Record<CorBarra, string> = {
  red: 'bg-red-500', amber: 'bg-amber-400', green: 'bg-emerald-500', blue: 'bg-blue-500', zinc: 'bg-zinc-200',
};
/** Cartão com a faixa colorida à esquerda (como os fornecedores do Início). */
export function CartaoBarra({ cor = 'zinc', children, className = '', onClick }: {
  cor?: CorBarra; children: ReactNode; className?: string; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className={`relative bg-white border border-zinc-200 rounded-2xl pl-4 pr-3 py-3 overflow-hidden ${onClick ? 'cursor-pointer hover:border-amber-300' : ''} ${className}`}>
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${corBarra[cor]}`} />
      {children}
    </div>
  );
}

// ── Títulos de seção ──────────────────────────────────────────────────────────
export function SecaoTitulo({ titulo, n, tomN = 'red', ajuda, sub, direita, id }: {
  titulo: string;
  n?: number;
  tomN?: 'red' | 'amber' | 'zinc' | 'green';
  ajuda?: ReactNode;
  sub?: ReactNode;
  direita?: ReactNode;
  id?: string;
}) {
  const corN = { red: 'bg-red-500 text-white', amber: 'bg-amber-500 text-white', zinc: 'bg-zinc-200 text-zinc-600', green: 'bg-emerald-600 text-white' }[tomN];
  return (
    <div id={id} className="flex items-center gap-2 mb-2 px-0.5 scroll-mt-4">
      <h2 className="text-base lg:text-lg font-extrabold text-zinc-900 flex items-center gap-1.5">{titulo}{ajuda && <Ajuda titulo={titulo}>{ajuda}</Ajuda>}</h2>
      {n != null && <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${corN}`}>{n}</span>}
      {sub && <span className="text-xs text-zinc-400 flex-1 min-w-0 truncate">{sub}</span>}
      {direita && <div className="ml-auto flex-shrink-0">{direita}</div>}
    </div>
  );
}

// ── Chips de filtro (com a contagem de cada um) ─────────────────────────────────
export interface OpcaoChip<T extends string> { id: T; rotulo: string; n?: number; tom?: 'red' | 'amber' }
export function Chips<T extends string>({ opcoes, valor, onChange, className = '' }: {
  opcoes: OpcaoChip<T>[]; valor: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={`flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap ${className}`}>
      {opcoes.map((o) => {
        const ativo = o.id === valor;
        const cor = ativo
          ? 'bg-zinc-900 border-zinc-900 text-white'
          : o.tom === 'red' ? 'bg-red-50 border-red-200 text-red-700'
          : o.tom === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300';
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            className={`flex-none inline-flex items-center gap-1 h-8 px-3 rounded-full border text-[12.5px] font-bold cursor-pointer whitespace-nowrap ${cor}`}>
            {o.rotulo}{o.n != null && <span className={ativo ? 'text-white/70' : 'opacity-70'}>{o.n.toLocaleString('pt-BR')}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Estado vazio ────────────────────────────────────────────────────────────
export function Vazio({ icone = 'ri-inbox-line', titulo, children, acao }: { icone?: string; titulo: string; children?: ReactNode; acao?: ReactNode }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl px-5 py-8 text-center">
      <span className="w-11 h-11 rounded-2xl bg-zinc-100 text-zinc-400 inline-flex items-center justify-center mb-2"><i className={`${icone} text-xl`} /></span>
      <p className="text-sm font-extrabold text-zinc-800">{titulo}</p>
      {children && <div className="text-xs text-zinc-500 mt-1 max-w-md mx-auto leading-relaxed">{children}</div>}
      {acao && <div className="mt-3 flex justify-center gap-2 flex-wrap">{acao}</div>}
    </div>
  );
}

/** Nota de rodapé discreta (de onde vem o número). */
export function Nota({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-[11px] text-zinc-400 bg-zinc-50 rounded-xl px-3 py-2 leading-snug ${className}`}>{children}</p>;
}

/** Etiqueta pequena (situação). */
export function Etiqueta({ tom = 'zinc', children }: { tom?: 'red' | 'amber' | 'green' | 'blue' | 'zinc'; children: ReactNode }) {
  const cor = { red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-700', green: 'bg-emerald-50 text-emerald-700', blue: 'bg-blue-50 text-blue-600', zinc: 'bg-zinc-100 text-zinc-600' }[tom];
  return <span className={`inline-block text-[10.5px] font-bold rounded-md px-1.5 py-0.5 whitespace-nowrap ${cor}`}>{children}</span>;
}

/** Container padrão de cada aba (mesma largura do Início). */
export function Pagina({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 md:p-6 max-w-[1400px] mx-auto pb-16 space-y-4 ${className}`}>{children}</div>;
}

// ── Menu "⋯" ────────────────────────────────────────────────────────────────
export interface ItemMenu { rotulo: string; icone?: string; onClick: () => void; perigo?: boolean; oculto?: boolean }
/** Botão ⋯ com um menu (portal, não é cortado por cartões com overflow). */
export function MenuMais({ itens, rotulo = 'Mais ações', className = '', grande = false }: { itens: ItemMenu[]; rotulo?: string; className?: string; grande?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visiveis = itens.filter((i) => !i.oculto);

  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    const largura = 230;
    const altura = menu.current?.offsetHeight ?? visiveis.length * 40 + 8;
    const left = Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8));
    const embaixo = r.bottom + 6 + altura < window.innerHeight;
    setPos({ top: embaixo ? r.bottom + 6 : Math.max(8, r.top - 6 - altura), left });
  }, [aberto, visiveis.length]);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: Event) => {
      if (botao.current?.contains(e.target as Node) || menu.current?.contains(e.target as Node)) return;
      setAberto(false);
    };
    const sair = () => setAberto(false);
    document.addEventListener('mousedown', fechar);
    document.addEventListener('touchstart', fechar);
    window.addEventListener('scroll', sair, true);
    return () => {
      document.removeEventListener('mousedown', fechar);
      document.removeEventListener('touchstart', fechar);
      window.removeEventListener('scroll', sair, true);
    };
  }, [aberto]);

  if (!visiveis.length) return null;
  return (
    <>
      <button ref={botao} type="button" aria-label={rotulo} title={rotulo}
        onClick={(e) => { e.stopPropagation(); setAberto((a) => !a); }}
        className={`${grande ? 'w-10 h-10' : 'w-[34px] h-[34px]'} flex-shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 cursor-pointer ${className}`}>
        <i className="ri-more-2-fill text-lg" />
      </button>
      {aberto && createPortal(
        <div ref={menu} role="menu" style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: 230 }}
          className="z-[70] bg-white border border-zinc-200 rounded-2xl shadow-xl py-1.5">
          {visiveis.map((i, k) => (
            <button key={k} role="menuitem" type="button"
              onClick={(e) => { e.stopPropagation(); setAberto(false); i.onClick(); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold cursor-pointer hover:bg-zinc-50 ${i.perigo ? 'text-red-600' : 'text-zinc-700'}`}>
              {i.icone && <i className={`${i.icone} text-base ${i.perigo ? '' : 'text-zinc-400'}`} />}{i.rotulo}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Texto sem acento e minúsculo, para buscas ("acai" acha "Açaí"). */
export const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** R$ 1.234,56 */
export const brl = (v: number, digitos = 2) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digitos, maximumFractionDigits: digitos });
/** R$ 14.183 (sem centavos, para números grandes de resumo) */
export const brlInteiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
