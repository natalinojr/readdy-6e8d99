/**
 * Campos de resposta de um item do relatório: quem monta o item escolhe o tipo
 * (lista suspensa, caixas de seleção, sim/não, texto, número, data) e quem
 * responde preenche. Cada resposta guarda só o que mudou; o valor atual de cada
 * campo é o da resposta mais recente que o preencheu.
 */
import { Plus, Trash2, ChevronUp, ChevronDown, X } from 'lucide-react';
import type { CampoRel, ItemRel, TipoCampo, ValorCampo } from './api';

export const TIPOS_CAMPO: Array<{ id: TipoCampo; label: string }> = [
  { id: 'escolha', label: 'Lista suspensa (uma opção)' },
  { id: 'multipla', label: 'Caixas de seleção (várias)' },
  { id: 'sim_nao', label: 'Sim / Não' },
  { id: 'texto', label: 'Texto curto' },
  { id: 'numero', label: 'Número' },
  { id: 'data', label: 'Data' },
];

const novoId = () => Math.random().toString(36).slice(2, 10);
const temOpcoes = (t: TipoCampo) => t === 'escolha' || t === 'multipla';

/** Valor atual de cada campo + quem respondeu e quando. */
export function valoresAtuais(item: ItemRel): Record<string, { valor: ValorCampo; autor: string; em: string }> {
  const atual: Record<string, { valor: ValorCampo; autor: string; em: string }> = {};
  for (const r of item.responses) {
    for (const [cid, valor] of Object.entries(r.answers ?? {})) atual[cid] = { valor, autor: r.author_name, em: r.created_at };
  }
  return atual;
}

export function formatarValor(campo: CampoRel, valor: ValorCampo): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const nomeOp = (id: string) => campo.options?.find((o) => o.id === id)?.label ?? '(opção removida)';
  switch (campo.type) {
    case 'escolha': return nomeOp(String(valor));
    case 'multipla': {
      if (!Array.isArray(valor) || !valor.length) return '—';
      // Na ordem das opções, não na ordem em que foram marcadas.
      const ordem = (id: string) => { const i = campo.options?.findIndex((o) => o.id === id) ?? -1; return i < 0 ? 999 : i; };
      return [...valor].sort((a, b) => ordem(a) - ordem(b)).map(nomeOp).join(', ');
    }
    case 'sim_nao': return valor === 'sim' ? 'Sim' : 'Não';
    case 'data': return new Date(`${valor}T12:00:00`).toLocaleDateString('pt-BR');
    case 'numero': return Number(valor).toLocaleString('pt-BR');
    default: return String(valor);
  }
}

/** Montar os campos do item (quem cria/edita o item). */
export function EditorCampos({ campos, onChange }: { campos: CampoRel[]; onChange: (c: CampoRel[]) => void }) {
  const mudar = (i: number, patch: Partial<CampoRel>) => onChange(campos.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const mover = (i: number, d: -1 | 1) => {
    const n = [...campos];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    onChange(n);
  };
  return (
    <div className="space-y-2">
      {campos.map((c, i) => (
        <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={c.label}
              onChange={(e) => mudar(i, { label: e.target.value })}
              maxLength={200}
              placeholder="Pergunta (ex.: Situação do serviço)"
              className="flex-1 min-w-[160px] rounded-lg border border-slate-200 px-2 py-1.5 text-base md:text-sm bg-white"
            />
            <select
              value={c.type}
              onChange={(e) => {
                const type = e.target.value as TipoCampo;
                mudar(i, { type, options: temOpcoes(type) ? (c.options?.length ? c.options : [{ id: novoId(), label: '' }]) : undefined });
              }}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-base md:text-sm bg-white"
            >
              {TIPOS_CAMPO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <div className="flex items-center">
              <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} className="p-1 text-slate-400 disabled:opacity-30" title="Subir"><ChevronUp size={15} /></button>
              <button type="button" disabled={i === campos.length - 1} onClick={() => mover(i, 1)} className="p-1 text-slate-400 disabled:opacity-30" title="Descer"><ChevronDown size={15} /></button>
              <button type="button" onClick={() => onChange(campos.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-500" title="Tirar campo"><Trash2 size={15} /></button>
            </div>
          </div>
          {temOpcoes(c.type) && (
            <div className="pl-2 space-y-1">
              {(c.options ?? []).map((o, k) => (
                <div key={o.id} className="flex items-center gap-1.5">
                  <span className={`w-3.5 h-3.5 border border-slate-300 shrink-0 ${c.type === 'escolha' ? 'rounded-full' : 'rounded'}`} />
                  <input
                    value={o.label}
                    onChange={(e) => mudar(i, { options: c.options!.map((x, m) => (m === k ? { ...x, label: e.target.value } : x)) })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        mudar(i, { options: [...c.options!, { id: novoId(), label: '' }] });
                      }
                    }}
                    maxLength={120}
                    placeholder={`Opção ${k + 1}`}
                    className="flex-1 rounded border border-slate-200 px-2 py-1 text-base md:text-sm bg-white"
                  />
                  <button type="button" disabled={(c.options ?? []).length <= 1} onClick={() => mudar(i, { options: c.options!.filter((_, m) => m !== k) })} className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30"><X size={14} /></button>
                </div>
              ))}
              <button type="button" onClick={() => mudar(i, { options: [...(c.options ?? []), { id: novoId(), label: '' }] })} className="text-xs text-indigo-600 hover:underline">+ opção</button>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...campos, { id: novoId(), type: 'escolha', label: '', options: [{ id: novoId(), label: '' }] }])}
        disabled={campos.length >= 20}
        className="flex items-center gap-1 text-sm text-indigo-600 hover:underline disabled:opacity-40"
      >
        <Plus size={14} /> Campo de resposta
      </button>
    </div>
  );
}

/** Tira opções/perguntas vazias antes de gravar; devolve erro se sobrar campo sem pergunta. */
export function limparCampos(campos: CampoRel[]): { campos: CampoRel[]; erro: string | null } {
  const limpos = campos.map((c) => ({
    ...c,
    label: c.label.trim(),
    ...(temOpcoes(c.type) ? { options: (c.options ?? []).map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label) } : { options: undefined }),
  }));
  if (limpos.some((c) => !c.label)) return { campos: limpos, erro: 'Todo campo de resposta precisa da pergunta' };
  const semOpcao = limpos.find((c) => temOpcoes(c.type) && !c.options?.length);
  if (semOpcao) return { campos: limpos, erro: `"${semOpcao.label}": inclua ao menos uma opção` };
  return { campos: limpos, erro: null };
}

/** Preencher os campos (quem responde). */
export function PreencherCampos({ campos, valores, onChange }: {
  campos: CampoRel[];
  valores: Record<string, ValorCampo>;
  onChange: (cid: string, v: ValorCampo) => void;
}) {
  return (
    <div className="space-y-3">
      {campos.map((c) => {
        const v = valores[c.id];
        return (
          <div key={c.id}>
            <p className="text-sm font-medium text-slate-700 mb-1">{c.label}</p>
            {c.type === 'escolha' && (
              <select
                value={(v as string) ?? ''}
                onChange={(e) => onChange(c.id, e.target.value || null)}
                className="w-full md:w-auto min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm bg-white"
              >
                <option value="">Escolha…</option>
                {c.options?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}
            {c.type === 'multipla' && (
              <div className="flex flex-col gap-1.5">
                {c.options?.map((o) => {
                  const marcados = Array.isArray(v) ? v : [];
                  return (
                    <label key={o.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={marcados.includes(o.id)}
                        onChange={(e) => onChange(c.id, e.target.checked ? [...marcados, o.id] : marcados.filter((x) => x !== o.id))}
                      />
                      {o.label}
                    </label>
                  );
                })}
              </div>
            )}
            {c.type === 'sim_nao' && (
              <div className="flex gap-2">
                {(['sim', 'nao'] as const).map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => onChange(c.id, v === op ? null : op)}
                    className={`px-4 py-1.5 rounded-lg text-sm border ${v === op ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 bg-white'}`}
                  >
                    {op === 'sim' ? 'Sim' : 'Não'}
                  </button>
                ))}
              </div>
            )}
            {c.type === 'texto' && (
              <input
                value={(v as string) ?? ''}
                onChange={(e) => onChange(c.id, e.target.value)}
                maxLength={1000}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm"
              />
            )}
            {c.type === 'numero' && (
              <input
                type="number"
                inputMode="decimal"
                value={v === null || v === undefined ? '' : String(v)}
                onChange={(e) => onChange(c.id, e.target.value === '' ? null : Number(e.target.value))}
                className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm"
              />
            )}
            {c.type === 'data' && (
              <input
                type="date"
                value={(v as string) ?? ''}
                onChange={(e) => onChange(c.id, e.target.value || null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Só o que mudou em relação ao valor atual — cada resposta registra só as mudanças. */
export function respostasMudadas(campos: CampoRel[], atuais: Record<string, ValorCampo>, rascunho: Record<string, ValorCampo>) {
  const saida: Record<string, ValorCampo> = {};
  for (const c of campos) {
    if (!(c.id in rascunho)) continue;
    const novo = rascunho[c.id];
    const vazio = (x: ValorCampo) => x === null || x === undefined || x === '' || (Array.isArray(x) && !x.length);
    if (vazio(novo) && vazio(atuais[c.id])) continue;
    if (JSON.stringify(novo) !== JSON.stringify(atuais[c.id] ?? null)) saida[c.id] = vazio(novo) ? null : novo;
  }
  return saida;
}
