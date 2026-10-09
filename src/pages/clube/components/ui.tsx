// Peças visuais do app do clube. As cores vêm das variáveis da marca da loja
// (--brand, --brand2, --brand3, --brand-suave, --acc — ver varsDaMarca em lib/clubeApp).
import type { ReactNode } from 'react';

export const pts = (n: number) => Math.floor(Number(n) || 0).toLocaleString('pt-BR');
export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: Number.isInteger(v) ? 0 : 2 });
export const dataBR = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
export const quando = (d: string) => {
  const dt = new Date(d);
  const hoje = new Date();
  const mesmoDia = dt.toDateString() === hoje.toDateString();
  return mesmoDia ? dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

export const FUNDO_MARCA = 'radial-gradient(130% 90% at 100% 0%, var(--brand3) 0%, var(--brand) 50%, var(--brand2) 100%)';

export function Logo({ src, nome, className = 'w-9 h-9 rounded-xl' }: { src: string | null; nome: string; className?: string }) {
  if (src) return <div className={`${className} bg-center bg-cover shrink-0 shadow-sm`} style={{ backgroundImage: `url(${src})` }} role="img" aria-label={nome} />;
  const ini = nome.split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || nome.slice(0, 2).toUpperCase();
  return <div className={`${className} shrink-0 flex items-center justify-center font-black text-white`} style={{ background: 'var(--brand)' }} aria-label={nome}>{ini}</div>;
}

export function Topo({ titulo, sub, logo, nome, avisos, onAvisos, onVoltar }: {
  titulo: string; sub?: string; logo?: string | null; nome?: string; avisos?: number; onAvisos?: () => void; onVoltar?: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 bg-[#FBF7F2]/95 backdrop-blur px-4 pt-[max(14px,env(safe-area-inset-top))] pb-3 flex items-center gap-3">
      {onVoltar
        ? <button onClick={onVoltar} aria-label="Voltar" className="w-10 h-10 rounded-xl bg-white border border-[#EFE7DD] flex items-center justify-center cursor-pointer"><i className="ri-arrow-left-line text-xl text-zinc-600" /></button>
        : <Logo src={logo ?? null} nome={nome ?? titulo} />}
      <div className="flex-1 min-w-0">
        <p className="font-extrabold text-[16px] leading-tight truncate text-zinc-900">{titulo}</p>
        {sub && <p className="text-[11.5px] font-semibold text-zinc-400 truncate">{sub}</p>}
      </div>
      {onAvisos && (
        <button onClick={onAvisos} aria-label="Avisos" className="relative w-10 h-10 rounded-xl bg-white border border-[#EFE7DD] flex items-center justify-center cursor-pointer">
          <i className="ri-notification-3-line text-xl text-zinc-600" />
          {!!avisos && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold text-white flex items-center justify-center border-2 border-white" style={{ background: 'var(--brand3)' }}>{avisos > 9 ? '9+' : avisos}</span>}
        </button>
      )}
    </header>
  );
}

export type Aba = 'inicio' | 'premios' | 'avisos' | 'eu';
export function Abas({ aba, onAba, avisos }: { aba: Aba; onAba: (a: Aba) => void; avisos: number }) {
  const itens: [Aba, string, string][] = [['inicio', 'ri-home-5', 'Início'], ['premios', 'ri-gift-2', 'Prêmios'], ['avisos', 'ri-notification-3', 'Avisos'], ['eu', 'ri-user-3', 'Eu']];
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-[#EFE7DD] pb-[max(10px,env(safe-area-inset-bottom))]">
      <div className="max-w-md mx-auto flex pt-2">
        {itens.map(([id, ic, nome]) => {
          const on = aba === id;
          return (
            <button key={id} onClick={() => onAba(id)} aria-current={on ? 'page' : undefined}
              className="flex-1 flex flex-col items-center gap-0.5 text-[11px] font-bold cursor-pointer relative" style={{ color: on ? 'var(--brand)' : '#9B9087' }}>
              <i className={`${ic}-${on ? 'fill' : 'line'} text-[23px] leading-none`} />
              {nome}
              {id === 'avisos' && avisos > 0 && aba !== 'avisos' && (
                <span className="absolute top-[-4px] left-1/2 ml-2 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-extrabold text-white flex items-center justify-center" style={{ background: 'var(--brand3)' }}>{avisos > 9 ? '9+' : avisos}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Folha que sobe de baixo (fecha tocando fora). */
export function Folha({ aberta, onFechar, children, titulo }: { aberta: boolean; onFechar: () => void; children: ReactNode; titulo?: string }) {
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-end justify-center" onClick={onFechar} role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="w-full max-w-md bg-white rounded-t-[26px] px-5 pt-2.5 pb-[max(24px,env(safe-area-inset-bottom))] max-h-[90dvh] overflow-y-auto animate-[sobe_.25s_ease-out]" onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1.5 rounded-full bg-[#E2DAD0] mx-auto mb-4" />
        {titulo && <p className="text-lg font-extrabold mb-3">{titulo}</p>}
        {children}
      </div>
    </div>
  );
}

export function Chave({ ligada, onChange, rotulo, disabled }: { ligada: boolean; onChange: (v: boolean) => void; rotulo: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={ligada} aria-label={rotulo} disabled={disabled} onClick={() => onChange(!ligada)}
      className={`w-[46px] h-7 rounded-full relative shrink-0 transition-colors cursor-pointer disabled:opacity-50 ${ligada ? 'bg-emerald-600' : 'bg-[#D9D1C7]'}`}>
      <span className={`absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow transition-all ${ligada ? 'left-[21px]' : 'left-[3px]'}`} />
    </button>
  );
}

export function Lista({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-[#EFE7DD] rounded-[18px] overflow-hidden divide-y divide-[#F4EEE6] ${className}`}>{children}</div>;
}

export function Linha({ icone, titulo, sub, direita, onClick, perigo }: {
  icone?: ReactNode; titulo: ReactNode; sub?: ReactNode; direita?: ReactNode; onClick?: () => void; perigo?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`w-full flex items-center gap-3 px-3.5 py-3 text-left ${onClick ? 'cursor-pointer active:bg-zinc-50' : ''}`}>
      {icone}
      <div className="flex-1 min-w-0">
        <p className={`text-[13.5px] font-bold leading-snug ${perigo ? 'text-rose-600' : 'text-zinc-900'}`}>{titulo}</p>
        {sub && <p className="text-[11.5px] font-semibold text-zinc-400 mt-0.5 leading-snug">{sub}</p>}
      </div>
      {direita ?? (onClick ? <i className="ri-arrow-right-s-line text-xl text-zinc-300" /> : null)}
    </Tag>
  );
}

export function Icone({ children, fundo = '#F1F5F9' }: { children: ReactNode; fundo?: string }) {
  return <div className="w-[38px] h-[38px] rounded-xl flex items-center justify-center shrink-0 text-lg" style={{ background: fundo }}>{children}</div>;
}

export function Botao({ children, onClick, tipo = 'marca', disabled, className = '' }: {
  children: ReactNode; onClick?: () => void; tipo?: 'marca' | 'branco' | 'escuro' | 'fantasma'; disabled?: boolean; className?: string;
}) {
  const estilos: Record<string, string> = {
    marca: 'text-white shadow-[0_6px_16px_rgba(0,0,0,.18)]',
    branco: 'bg-white text-zinc-900 border border-[#EFE7DD]',
    escuro: 'bg-zinc-900 text-white',
    fantasma: 'text-zinc-500 h-11 font-bold text-sm',
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full h-[52px] rounded-2xl text-[15.5px] font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${estilos[tipo]} ${className}`}
      style={tipo === 'marca' ? { background: 'var(--brand)' } : undefined}>
      {children}
    </button>
  );
}

export function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between px-4 mb-2.5">
        <h3 className="text-[15.5px] font-extrabold text-zinc-900">{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}
