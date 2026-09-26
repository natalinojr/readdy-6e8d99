/**
 * Campos de resposta de um item do relatório: quem monta o item escolhe o tipo
 * (lista suspensa, caixas de seleção, sim/não, texto, número, data) e quem
 * responde preenche. Cada resposta guarda só o que mudou; o valor atual de cada
 * campo é o da resposta mais recente que o preencheu.
 *
 * Campo condicional (briefing): "mostrar só se a pergunta X for A ou B" —
 * `show_if` aponta para uma pergunta de escolha/sim-não acima dele. Campo
 * escondido não aparece para quem responde e, se tinha valor, é apagado na
 * próxima resposta (a sequência guarda o que era).
 */
import { Plus, Trash2, ChevronUp, ChevronDown, X, CornerDownRight } from 'lucide-react';
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
/** Tipos que podem servir de condição para outro campo. */
const condicionavel = (t: TipoCampo) => temOpcoes(t) || t === 'sim_nao';
export const MAX_CAMPOS = 40;

/** Respostas possíveis de uma pergunta de escolha (sim/não vira duas opções fixas). */
function respostasPossiveis(c: CampoRel): Array<{ id: string; label: string }> {
  if (c.type === 'sim_nao') return [{ id: 'sim', label: 'Sim' }, { id: 'nao', label: 'Não' }];
  return c.options ?? [];
}

/**
 * Campos que aparecem com estes valores, na ordem. Condição olha só perguntas
 * acima; se a pergunta da condição está escondida, o campo também fica.
 */
export function camposVisiveis(campos: CampoRel[], valores: Record<string, ValorCampo | undefined>): CampoRel[] {
  const visiveis = new Set<string>();
  return campos.filter((c) => {
    const s = c.show_if;
    let ok = true;
    if (s) {
      const v = valores[s.field_id];
      ok = visiveis.has(s.field_id)
        && (Array.isArray(v) ? v.some((x) => s.values.includes(x)) : typeof v === 'string' && s.values.includes(v));
    }
    if (ok) visiveis.add(c.id);
    return ok;
  });
}

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
  // Tirar um campo (ou fazer ele deixar de ser escolha) solta as condições que dependiam dele.
  const soltarDependentes = (lista: CampoRel[], id: string) => lista.map((x) => (x.show_if?.field_id === id ? { ...x, show_if: null } : x));
  const tirar = (i: number) => onChange(soltarDependentes(campos.filter((_, j) => j !== i), campos[i].id));
  return (
    <div className="space-y-2">
      {campos.map((c, i) => (
        <div key={c.id} className={`rounded-lg border p-2 space-y-2 ${c.show_if ? 'ml-4 border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-slate-50/60'}`}>
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
                const novo = { ...c, type, options: temOpcoes(type) ? (c.options?.length ? c.options : [{ id: novoId(), label: '' }]) : undefined };
                const lista = campos.map((x, j) => (j === i ? novo : x));
                onChange(condicionavel(type) && condicionavel(c.type) && temOpcoes(type) === temOpcoes(c.type) ? lista : soltarDependentes(lista, c.id));
              }}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-base md:text-sm bg-white"
            >
              {TIPOS_CAMPO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <div className="flex items-center">
              <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} className="p-1 text-slate-400 disabled:opacity-30" title="Subir"><ChevronUp size={15} /></button>
              <button type="button" disabled={i === campos.length - 1} onClick={() => mover(i, 1)} className="p-1 text-slate-400 disabled:opacity-30" title="Descer"><ChevronDown size={15} /></button>
              <button type="button" onClick={() => tirar(i)} className="p-1 text-slate-400 hover:text-red-500" title="Tirar campo"><Trash2 size={15} /></button>
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
              {c.type === 'multipla' && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
                  <span>Marcar</span>
                  <label className="flex items-center gap-1">no mínimo
                    <input
                      type="number" min={0} max={(c.options ?? []).length} inputMode="numeric"
                      value={c.min ?? ''}
                      onChange={(e) => mudar(i, { min: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
                      placeholder="—"
                      className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-base md:text-xs bg-white"
                    />
                  </label>
                  <label className="flex items-center gap-1">no máximo
                    <input
                      type="number" min={1} max={(c.options ?? []).length} inputMode="numeric"
                      value={c.max ?? ''}
                      onChange={(e) => mudar(i, { max: e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value))) })}
                      placeholder="—"
                      className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-base md:text-xs bg-white"
                    />
                  </label>
                  <span className="text-slate-400">(vazio = sem limite)</span>
                </div>
              )}
            </div>
          )}
          <EditorCondicao campo={c} anteriores={campos.slice(0, i)} todos={campos} onChange={(show_if) => mudar(i, { show_if })} />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...campos, { id: novoId(), type: 'escolha', label: '', options: [{ id: novoId(), label: '' }] }])}
        disabled={campos.length >= MAX_CAMPOS}
        className="flex items-center gap-1 text-sm text-indigo-600 hover:underline disabled:opacity-40"
      >
        <Plus size={14} /> Campo de resposta
      </button>
    </div>
  );
}

/** "Mostrar só se [pergunta acima] for [A] [B]…" — só aparece quando há pergunta de escolha acima. */
function EditorCondicao({ campo, anteriores, todos, onChange }: {
  campo: CampoRel;
  anteriores: CampoRel[];
  todos: CampoRel[];
  onChange: (s: CampoRel['show_if']) => void;
}) {
  const candidatos = anteriores.filter((x) => condicionavel(x.type));
  const s = campo.show_if;
  if (!s && !candidatos.length) return null;
  const pai = s ? todos.find((x) => x.id === s.field_id) : undefined;
  const paiAcima = !!pai && anteriores.includes(pai);
  const nome = (x: CampoRel) => x.label.trim() || `Pergunta ${todos.indexOf(x) + 1}`;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      <CornerDownRight size={13} className="text-indigo-400 shrink-0" />
      <span>Mostrar</span>
      <select
        value={s?.field_id ?? ''}
        onChange={(e) => onChange(e.target.value ? { field_id: e.target.value, values: [] } : null)}
        className="max-w-[220px] rounded border border-slate-200 px-1.5 py-0.5 text-base md:text-xs bg-white"
      >
        <option value="">sempre</option>
        {candidatos.map((x) => <option key={x.id} value={x.id}>só se {nome(x)}</option>)}
        {s && pai && !paiAcima && <option value={pai.id}>só se {nome(pai)}</option>}
      </select>
      {s && pai && (
        <>
          <span>{pai.type === 'multipla' ? 'tiver marcado' : 'for'}</span>
          {respostasPossiveis(pai).map((o, k) => {
            const marcado = s.values.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onChange({ ...s, values: marcado ? s.values.filter((v) => v !== o.id) : [...s.values, o.id] })}
                className={`px-2 py-0.5 rounded-full border ${marcado ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-600'}`}
              >
                {o.label.trim() || `Opção ${k + 1}`}
              </button>
            );
          })}
          {s.values.length > 1 && <span className="text-slate-400">(qualquer uma)</span>}
          {!paiAcima && <span className="w-full text-amber-600">A pergunta da condição precisa ficar acima desta — use as setas.</span>}
        </>
      )}
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
  for (const c of limpos) {
    if (c.type !== 'multipla') { delete c.min; delete c.max; continue; }
    const n = c.options?.length ?? 0;
    if ((c.min ?? 0) > n || (c.max ?? 0) > n) return { campos: limpos, erro: `"${c.label}": o limite passa do número de opções (${n})` };
    if (c.min && c.max && c.min > c.max) return { campos: limpos, erro: `"${c.label}": o mínimo é maior que o máximo` };
    if (!c.min) delete c.min;
    if (!c.max) delete c.max;
  }
  // Condição: pergunta de escolha acima, com ao menos uma resposta que ainda existe.
  for (let i = 0; i < limpos.length; i++) {
    const c = limpos[i];
    if (!c.show_if) { delete c.show_if; continue; }
    const pai = limpos.slice(0, i).find((x) => x.id === c.show_if!.field_id);
    if (!pai || !condicionavel(pai.type)) return { campos: limpos, erro: `"${c.label}": a pergunta da condição precisa ser de escolha e ficar acima dela` };
    const validos = new Set(respostasPossiveis(pai).map((o) => o.id));
    const values = c.show_if.values.filter((v) => validos.has(v));
    if (!values.length) return { campos: limpos, erro: `"${c.label}": escolha com qual resposta de "${pai.label}" ela aparece` };
    c.show_if = { field_id: pai.id, values };
  }
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
      {camposVisiveis(campos, valores).map((c) => {
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
                {dicaLimite(c) && <p className="text-xs text-slate-400 -mt-0.5">{dicaLimite(c)}</p>}
                {c.options?.map((o) => {
                  const marcados = Array.isArray(v) ? v : [];
                  const cheio = !!c.max && marcados.length >= c.max && !marcados.includes(o.id);
                  return (
                    <label key={o.id} className={`flex items-center gap-2 text-sm ${cheio ? 'text-slate-300' : 'text-slate-700'}`}>
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        disabled={cheio}
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

/** "Marque de 1 a 3", "Marque pelo menos 2"… (null = sem limite). */
export function dicaLimite(c: CampoRel): string | null {
  if (c.type !== 'multipla' || (!c.min && !c.max)) return null;
  if (c.min && c.max) return c.min === c.max ? `Marque ${c.min}` : `Marque de ${c.min} a ${c.max}`;
  return c.min ? `Marque pelo menos ${c.min}` : `Marque até ${c.max}`;
}

/** Erro de preenchimento (mínimo de caixas de seleção) antes de enviar. */
export function erroPreenchimento(campos: CampoRel[], mudancas: Record<string, ValorCampo>): string | null {
  for (const c of campos) {
    const v = mudancas[c.id];
    if (c.type !== 'multipla' || !Array.isArray(v) || !v.length) continue;
    if (c.min && v.length < c.min) return `"${c.label}": marque pelo menos ${c.min}`;
    if (c.max && v.length > c.max) return `"${c.label}": marque no máximo ${c.max}`;
  }
  return null;
}

/** Só o que mudou em relação ao valor atual — cada resposta registra só as mudanças. */
export function respostasMudadas(campos: CampoRel[], atuais: Record<string, ValorCampo>, rascunho: Record<string, ValorCampo>) {
  const saida: Record<string, ValorCampo> = {};
  // Campo que a condição escondeu vai vazio (a resposta antiga não vale mais).
  const visiveis = new Set(camposVisiveis(campos, { ...atuais, ...rascunho }).map((c) => c.id));
  for (const c of campos) {
    if (!(c.id in rascunho)) continue;
    const novo = visiveis.has(c.id) ? rascunho[c.id] : null;
    const vazio = (x: ValorCampo) => x === null || x === undefined || x === '' || (Array.isArray(x) && !x.length);
    if (vazio(novo) && vazio(atuais[c.id])) continue;
    if (JSON.stringify(novo) !== JSON.stringify(atuais[c.id] ?? null)) saida[c.id] = vazio(novo) ? null : novo;
  }
  return saida;
}
