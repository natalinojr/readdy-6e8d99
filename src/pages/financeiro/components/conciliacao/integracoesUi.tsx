import { useState, type ReactNode } from 'react';

// Peças comuns dos painéis da janela "Integrações" (Inter, Stone, Mercado Pago): o mesmo cabeçalho,
// a mesma ação principal com "Outro período" escondido e a mesma mensagem de resultado.

export type Resultado = { ok: boolean; msg: string; details?: string } | null;

export const quando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

export function Spinner({ cor = 'border-zinc-400' }: { cor?: string }) {
  return <div className={`w-4 h-4 border-2 ${cor} border-t-transparent rounded-full animate-spin`} />;
}

/** Linha de status: situação, última atualização e o que ela faz sozinha. */
export function StatusIntegracao({ erro, ultima, auto, extra, onConfig }: {
  erro?: string | null; ultima?: string | null; auto?: string | null; extra?: ReactNode; onConfig: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${erro ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          <i className={erro ? 'ri-error-warning-fill' : 'ri-checkbox-circle-fill'} /> {erro ? 'Com erro' : 'Funcionando'}
        </span>
        <span className="text-xs text-zinc-500">
          {ultima ? <>Atualizado em <strong className="text-zinc-700">{quando(ultima)}</strong></> : 'Ainda não atualizado'}
          {auto && <span className="text-zinc-400"> · {auto}</span>}
        </span>
        {extra}
        <button onClick={onConfig}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 text-zinc-600 rounded-lg text-xs font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
          <i className="ri-settings-3-line" /> Configurar
        </button>
      </div>
      {erro && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 break-words">
          <i className="ri-error-warning-line" /> Última atualização falhou: {erro}
        </p>
      )}
    </div>
  );
}

/** Botão principal (o caso de todo dia) + "Outro período" recolhido. */
export function AcaoImportar({ label, icon = 'ri-refresh-line', onClick, busy, disabled, cor, defaultFrom, defaultTo, max, onPeriodo, dica }: {
  label: string; icon?: string; onClick: () => void; busy: boolean; disabled?: boolean;
  /** classes do botão principal, ex.: 'bg-orange-600 hover:bg-orange-700' */
  cor: string;
  defaultFrom: string; defaultTo: string; max: string;
  onPeriodo: (from: string, to: string) => void;
  dica?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onClick} disabled={busy || disabled}
          className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50 ${cor}`}>
          {busy ? <><Spinner cor="border-white/60" /> Buscando...</> : <><i className={icon} /> {label}</>}
        </button>
        <button onClick={() => setAberto(!aberto)} disabled={busy}
          className="flex items-center gap-1 px-3 py-2 text-zinc-600 rounded-lg text-sm hover:bg-zinc-100 cursor-pointer whitespace-nowrap disabled:opacity-50">
          <i className="ri-calendar-line" /> Outro período <i className={aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
        </button>
      </div>
      {aberto && (
        <div className="flex items-end gap-2 flex-wrap bg-zinc-50 border border-zinc-200 rounded-lg p-3">
          <div>
            <label className="block text-[11px] text-zinc-500 mb-0.5">De</label>
            <input type="date" value={from} max={to || max} onChange={(e) => setFrom(e.target.value)}
              className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-0.5">Até</label>
            <input type="date" value={to} min={from || undefined} max={max} onChange={(e) => setTo(e.target.value)}
              className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
          </div>
          <button onClick={() => onPeriodo(from, to)} disabled={busy || disabled || !from || !to}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-white rounded-lg text-xs font-semibold hover:bg-zinc-900 cursor-pointer whitespace-nowrap disabled:opacity-50">
            <i className="ri-download-cloud-line" /> Buscar período
          </button>
          {dica && <p className="w-full text-[11px] text-zinc-400">{dica}</p>}
        </div>
      )}
    </div>
  );
}

export function MensagemResultado({ result }: { result: Resultado }) {
  if (!result) return null;
  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${result.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
      <i className={`${result.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
      <div className="break-words">
        <p>{result.msg}</p>
        {result.details && <p className="opacity-80 mt-0.5">{result.details}</p>}
      </div>
    </div>
  );
}

/** Tabela de histórico por dia: mostra os 7 mais recentes e "ver todos". */
export function HistoricoDias<T>({ titulo, itens, cabecalho, linha }: {
  titulo: string; itens: T[]; cabecalho: ReactNode; linha: (item: T) => ReactNode;
}) {
  const [todos, setTodos] = useState(false);
  if (itens.length === 0) return null;
  const visiveis = todos ? itens : itens.slice(0, 7);
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-700 mb-2">{titulo}</p>
      <div className="border border-zinc-200 rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50">{cabecalho}</thead>
          <tbody className="divide-y divide-zinc-100">{visiveis.map(linha)}</tbody>
        </table>
      </div>
      {itens.length > 7 && (
        <button onClick={() => setTodos(!todos)} className="mt-1.5 text-xs text-zinc-500 hover:text-zinc-800 cursor-pointer">
          {todos ? 'Mostrar só os últimos 7 dias' : `Ver todos (${itens.length} dias)`}
        </button>
      )}
    </div>
  );
}

export function SemConfig({ icone, cor, titulo, texto, botao, onConfig }: {
  icone: string; cor: string; titulo: string; texto: string; botao: string; onConfig: () => void;
}) {
  return (
    <div className="text-center py-8 px-4">
      <div className={`w-14 h-14 flex items-center justify-center rounded-2xl mx-auto mb-4 ${cor}`}>
        <i className={`${icone} text-2xl`} />
      </div>
      <h3 className="font-bold text-zinc-800 mb-1">{titulo}</h3>
      <p className="text-sm text-zinc-500 mb-4 max-w-md mx-auto">{texto}</p>
      <button onClick={onConfig}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-800 text-white rounded-lg text-sm font-semibold hover:bg-zinc-900 cursor-pointer whitespace-nowrap">
        <i className="ri-settings-3-line" /> {botao}
      </button>
    </div>
  );
}
