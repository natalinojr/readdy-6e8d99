// Kit das AÇÕES RÁPIDAS do chat do assistente (2026-09-16): roteiros fixos que parecem conversa
// (balões + botões + campos) mas rodam só no sistema — NENHUMA chamada ao modelo (custo zero).
//
// Regras para quem cria uma ação nova:
// - Reaproveite exatamente o caminho que a TELA do ERPOS já usa (mesma Edge Function / RPC /
//   leitura). Não invente endpoint novo.
// - Loja: sempre a LOJA ATIVA no app (user.tenantId). As leituras diretas vão com o header
//   x-tenant-id dessa loja (src/lib/supabase.ts), então outra loja voltaria vazia. Mostre o nome.
// - Ação que mexe em dinheiro, estoque, cardápio ou pessoas: termine num resumo + botão de confirmar.
// - Nada vai para o histórico do assistente.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface AcaoProps {
  onFechar: () => void;
  /** Navega para uma tela do ERPOS (o chat recolhe no modo flutuante). */
  irPara: (rota: string) => void;
}

export type Balao = { de: 'bot' | 'eu'; texto: string };

export function useRoteiro() {
  const [baloes, setBaloes] = useState<Balao[]>([]);
  return {
    baloes,
    bot: (texto: string) => setBaloes((b) => [...b, { de: 'bot', texto }]),
    eu: (texto: string) => setBaloes((b) => [...b, { de: 'eu', texto }]),
    limpar: () => setBaloes([]),
  };
}

// ── Formatação ────────────────────────────────────────────────────────────────
export const brl = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const hojeISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
export const somaDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
export const dataBR = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const horaBR = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '—';
/** "1.800,50" → 1800.5 ; "1800.5" → 1800.5 ; inválido → NaN */
export const lerNumero = (t: string) => {
  const limpo = String(t ?? '').replace(/[^\d,.-]/g, '');
  const n = limpo.includes(',') ? Number(limpo.replace(/\./g, '').replace(',', '.')) : Number(limpo);
  return Number.isFinite(n) && limpo !== '' ? n : NaN;
};

// ── Casca da ação ────────────────────────────────────────────────────────────
export function Roteiro({ titulo, subtitulo, icone, cor = 'bg-violet-50 text-violet-600', baloes, carregando, textoCarregando, onFechar, travarFechar, children }: {
  titulo: string;
  subtitulo?: string;
  icone: string;
  cor?: string;
  baloes: Balao[];
  carregando?: boolean;
  textoCarregando?: string;
  onFechar: () => void;
  travarFechar?: boolean;
  /** Controles do passo atual (botões/campos), fixos embaixo. */
  children?: ReactNode;
}) {
  const fimRef = useRef<HTMLDivElement>(null);
  useEffect(() => { fimRef.current?.scrollIntoView({ block: 'end' }); }, [baloes, carregando, children]);
  const negrito = (t: string) => t.split('\n').map((l, i) => (
    <span key={i} className="block">{l.startsWith('*') && l.endsWith('*') && l.length > 1 ? <b>{l.slice(1, -1)}</b> : l}</span>
  ));
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-zinc-50">
      <div className="flex items-center gap-2 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        <span className={`w-8 h-8 flex items-center justify-center rounded-xl ${cor}`}><i className={icone} /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight truncate">{titulo}</p>
          <p className="text-[11px] text-zinc-400 leading-tight truncate">{subtitulo ?? 'Ação rápida · sem custo de IA'}</p>
        </div>
        <button onClick={onFechar} disabled={travarFechar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 disabled:opacity-30 cursor-pointer" aria-label="Fechar">
          <i className="ri-close-line text-xl" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {baloes.map((b, i) => (
          <div key={i} className={`flex ${b.de === 'eu' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${b.de === 'eu' ? 'rounded-br-md bg-violet-600 text-white' : 'rounded-bl-md bg-white border border-zinc-200 text-zinc-800'}`}>
              {negrito(b.texto)}
            </div>
          </div>
        ))}
        {carregando && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-white border border-zinc-200 flex items-center gap-2 text-xs text-zinc-500">
              <span className="w-3.5 h-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              {textoCarregando ?? 'Carregando…'}
            </div>
          </div>
        )}
        <div ref={fimRef} />
      </div>
      {children && (
        <div className="border-t border-zinc-100 bg-white p-2.5 space-y-1.5 flex-shrink-0 max-h-[55%] overflow-y-auto">{children}</div>
      )}
    </div>
  );
}

// ── Controles ────────────────────────────────────────────────────────────────
export function Opcao({ children, onClick, disabled, detalhe, perigo }: { children: ReactNode; onClick: () => void; disabled?: boolean; detalhe?: ReactNode; perigo?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`block w-full text-left px-3 py-2 rounded-xl border bg-white text-sm font-semibold disabled:opacity-50 cursor-pointer ${perigo ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-violet-200 text-violet-700 hover:bg-violet-50'}`}>
      {children}{detalhe != null && <span className="text-xs font-normal text-zinc-400"> {detalhe}</span>}
    </button>
  );
}

export function OpcaoNeutra({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="block w-full text-left px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-600 font-semibold hover:bg-zinc-50 disabled:opacity-50 cursor-pointer">
      {children}
    </button>
  );
}

/** Campo de uma linha com botão de enviar. Controlado por dentro; entrega o texto no envio. */
export function Campo({ placeholder, onEnviar, modo = 'text', inicial = '', ocupado, tipo = 'text', max }: {
  placeholder: string;
  onEnviar: (texto: string) => void;
  modo?: 'text' | 'decimal' | 'numeric' | 'tel';
  inicial?: string;
  ocupado?: boolean;
  tipo?: 'text' | 'date' | 'time';
  max?: string;
}) {
  const [v, setV] = useState(inicial);
  useEffect(() => { setV(inicial); }, [inicial]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim() && !ocupado) { onEnviar(v.trim()); setV(''); } }} className="flex gap-1.5">
      <input autoFocus type={tipo} max={max} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} inputMode={modo}
        className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-400" />
      <button type="submit" disabled={ocupado || !v.trim()} className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-violet-600 text-white disabled:opacity-40 cursor-pointer" aria-label="Enviar">
        {ocupado ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-send-plane-2-fill" />}
      </button>
    </form>
  );
}

/** Botões Hoje / Ontem / Escolher data. `permitirFuturo` libera datas depois de hoje. */
export function EscolhaData({ onEscolher, opcoes = ['hoje', 'ontem'], permitirFuturo }: {
  onEscolher: (iso: string) => void;
  opcoes?: ('hoje' | 'ontem' | 'amanha')[];
  permitirFuturo?: boolean;
}) {
  const [outra, setOutra] = useState(false);
  const hoje = hojeISO();
  const rotulo: Record<string, [string, string]> = {
    hoje: ['Hoje', hoje], ontem: ['Ontem', somaDias(hoje, -1)], amanha: ['Amanhã', somaDias(hoje, 1)],
  };
  if (outra) return <Campo placeholder="Data" tipo="date" max={permitirFuturo ? undefined : hoje} onEnviar={(t) => onEscolher(t)} />;
  return (
    <>
      {opcoes.map((o) => <Opcao key={o} onClick={() => onEscolher(rotulo[o][1])} detalhe={`(${dataBR(rotulo[o][1])})`}>{rotulo[o][0]}</Opcao>)}
      <Opcao onClick={() => setOutra(true)}>Outra data</Opcao>
    </>
  );
}

/** Rodapé padrão de fim de roteiro. */
export function Fim({ onFechar, acoes }: { onFechar: () => void; acoes?: { label: string; onClick: () => void }[] }) {
  return (
    <>
      {acoes?.map((a) => <Opcao key={a.label} onClick={a.onClick}>{a.label}</Opcao>)}
      <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
    </>
  );
}
