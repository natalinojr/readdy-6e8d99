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
export const condicionavel = (t: TipoCampo) => temOpcoes(t) || t === 'sim_nao';
export const MAX_CAMPOS = 40;

/** Opção "Outro" da lista suspensa: na condição vale o id OUTRO; a resposta guarda "outro:<texto>". */
export const OUTRO = '__outro';
const PREFIXO_OUTRO = 'outro:';
export const ehOutro = (v: unknown): v is string => typeof v === 'string' && v.startsWith(PREFIXO_OUTRO);

/** Respostas possíveis de uma pergunta de escolha (sim/não vira duas opções fixas; "Outro" entra no fim). */
export function respostasPossiveis(c: CampoRel): Array<{ id: string; label: string }> {
  if (c.type === 'sim_nao') return [{ id: 'sim', label: 'Sim' }, { id: 'nao', label: 'Não' }];
  return [...(c.options ?? []), ...(c.type === 'escolha' && c.outro ? [{ id: OUTRO, label: 'Outro' }] : [])];
}

/** A resposta `v` bate com alguma das `values` da condição? ("Outro: …" conta como OUTRO.) */
export function respostaBate(v: ValorCampo | undefined, values: string[]): boolean {
  const norm = (x: string) => (ehOutro(x) ? OUTRO : x);
  return Array.isArray(v) ? v.some((x) => values.includes(norm(x))) : typeof v === 'string' && values.includes(norm(v));
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
      ok = visiveis.has(s.field_id) && respostaBate(valores[s.field_id], s.values);
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
    case 'escolha': return ehOutro(valor) ? `Outro: ${valor.slice(PREFIXO_OUTRO.length)}` : nomeOp(String(valor));
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

/**
 * Cor de cada pergunta que decide outras: o número dela, a faixa dos campos
 * que dependem dela e as respostas escolhidas ficam na mesma cor.
 */
const CORES = [
  { faixa: 'border-l-violet-500', fundo: 'bg-violet-50/70', num: 'bg-violet-600 text-white', chip: 'bg-violet-100 text-violet-800', ativo: 'bg-violet-600 border-violet-600 text-white', texto: 'text-violet-700' },
  { faixa: 'border-l-emerald-500', fundo: 'bg-emerald-50/70', num: 'bg-emerald-600 text-white', chip: 'bg-emerald-100 text-emerald-800', ativo: 'bg-emerald-600 border-emerald-600 text-white', texto: 'text-emerald-700' },
  { faixa: 'border-l-amber-500', fundo: 'bg-amber-50/70', num: 'bg-amber-500 text-white', chip: 'bg-amber-100 text-amber-800', ativo: 'bg-amber-500 border-amber-500 text-white', texto: 'text-amber-700' },
  { faixa: 'border-l-sky-500', fundo: 'bg-sky-50/70', num: 'bg-sky-600 text-white', chip: 'bg-sky-100 text-sky-800', ativo: 'bg-sky-600 border-sky-600 text-white', texto: 'text-sky-700' },
  { faixa: 'border-l-rose-500', fundo: 'bg-rose-50/70', num: 'bg-rose-600 text-white', chip: 'bg-rose-100 text-rose-800', ativo: 'bg-rose-600 border-rose-600 text-white', texto: 'text-rose-700' },
];
type Cor = (typeof CORES)[number];
const RECUO = ['', 'ml-5', 'ml-10', 'ml-14'];

/** Número da pergunta (1, 2, 3…) — colorido quando ela decide outros campos. */
function NumeroCampo({ n, cor }: { n: number; cor?: Cor }) {
  return (
    <span className={`shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center ${cor ? cor.num : 'bg-slate-200 text-slate-600'}`}>
      {n}
    </span>
  );
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

  // Quem decide quem: cor por pergunta-pai (na ordem em que aparecem) e recuo pela profundidade.
  const numero = new Map(campos.map((c, i) => [c.id, i + 1]));
  const filhos = new Map<string, CampoRel[]>();
  for (const c of campos) if (c.show_if) filhos.set(c.show_if.field_id, [...(filhos.get(c.show_if.field_id) ?? []), c]);
  const corDe = new Map<string, Cor>();
  for (const c of campos) if (filhos.has(c.id)) corDe.set(c.id, CORES[corDe.size % CORES.length]);
  const nivel = new Map<string, number>();
  for (const c of campos) nivel.set(c.id, c.show_if ? (nivel.get(c.show_if.field_id) ?? 0) + 1 : 0);
  /** Números dos campos que a resposta `op` de `c` mostra. */
  const mostraCom = (c: CampoRel, op: string) => (filhos.get(c.id) ?? []).filter((f) => f.show_if!.values.includes(op)).map((f) => numero.get(f.id)!);

  return (
    <div className="space-y-2">
      {campos.map((c, i) => {
        const pai = c.show_if ? campos.find((x) => x.id === c.show_if!.field_id) : undefined;
        const corPai = pai ? corDe.get(pai.id) : undefined;
        const minhaCor = corDe.get(c.id);
        const qtdFilhos = filhos.get(c.id)?.length ?? 0;
        return (
          <div
            key={c.id}
            className={`rounded-lg border border-slate-200 overflow-hidden ${RECUO[Math.min(nivel.get(c.id) ?? 0, 3)]} ${corPai ? `border-l-4 ${corPai.faixa}` : ''}`}
          >
            {pai && corPai && (
              <FaixaCondicao campo={c} pai={pai} cor={corPai} numeroPai={numero.get(pai.id)!} anteriores={campos.slice(0, i)} numero={numero}
                onChange={(show_if) => mudar(i, { show_if })} />
            )}
            <div className="p-2 space-y-2 bg-slate-50/60">
              <div className="flex flex-wrap items-center gap-2">
                <NumeroCampo n={i + 1} cor={minhaCor} />
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
              {minhaCor && (
                <p className={`text-xs font-medium ${minhaCor.texto}`}>
                  Esta pergunta decide {qtdFilhos === 1 ? '1 campo' : `${qtdFilhos} campos`} abaixo
                </p>
              )}
              {temOpcoes(c.type) && (
                <div className="pl-2 space-y-1">
                  {(c.options ?? []).map((o, k) => {
                    const mostra = mostraCom(c, o.id);
                    return (
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
                          className="flex-1 min-w-0 rounded border border-slate-200 px-2 py-1 text-base md:text-sm bg-white"
                        />
                        {minhaCor && mostra.length > 0 && <ChipMostra numeros={mostra} cor={minhaCor} />}
                        <button type="button" disabled={(c.options ?? []).length <= 1} onClick={() => mudar(i, { options: c.options!.filter((_, m) => m !== k) })} className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30"><X size={14} /></button>
                      </div>
                    );
                  })}
                  {c.type === 'escolha' && c.outro && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 border border-slate-300 shrink-0 rounded-full" />
                      <span className="flex-1 min-w-0 rounded border border-dashed border-slate-300 px-2 py-1 text-base md:text-sm text-slate-500 bg-white">Outro <span className="text-slate-400">— a pessoa escreve</span></span>
                      {minhaCor && mostraCom(c, OUTRO).length > 0 && <ChipMostra numeros={mostraCom(c, OUTRO)} cor={minhaCor} />}
                      <button type="button" onClick={() => mudar(i, { outro: false })} className="p-1 text-slate-400 hover:text-red-500" title="Tirar a opção Outro"><X size={14} /></button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => mudar(i, { options: [...(c.options ?? []), { id: novoId(), label: '' }] })} className="text-xs text-indigo-600 hover:underline">+ opção</button>
                    {c.type === 'escolha' && !c.outro && (
                      <button type="button" onClick={() => mudar(i, { outro: true })} className="text-xs text-indigo-600 hover:underline">+ opção "Outro" (texto livre)</button>
                    )}
                  </div>
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
              {c.type === 'sim_nao' && minhaCor && (
                <div className="pl-2 flex flex-wrap gap-3 text-xs text-slate-600">
                  {respostasPossiveis(c).map((o) => {
                    const mostra = mostraCom(c, o.id);
                    return mostra.length > 0 && (
                      <span key={o.id} className="flex items-center gap-1.5">{o.label} <ChipMostra numeros={mostra} cor={minhaCor} /></span>
                    );
                  })}
                </div>
              )}
              {!c.show_if && (() => {
                // Liga a condição à pergunta de escolha mais próxima acima (dá para trocar na faixa).
                const alvo = [...campos.slice(0, i)].reverse().find((x) => condicionavel(x.type));
                return alvo && (
                  <button
                    type="button"
                    onClick={() => mudar(i, { show_if: { field_id: alvo.id, values: [] } })}
                    className="flex items-center gap-1 text-left text-xs text-slate-500 hover:text-indigo-600"
                  >
                    <CornerDownRight size={13} /> Mostrar só se uma pergunta acima tiver certa resposta…
                  </button>
                );
              })()}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...campos, { id: novoId(), type: 'escolha', label: '', options: [{ id: novoId(), label: '' }], outro: true }])}
        disabled={campos.length >= MAX_CAMPOS}
        className="flex items-center gap-1 text-sm text-indigo-600 hover:underline disabled:opacity-40"
      >
        <Plus size={14} /> Campo de resposta
      </button>
    </div>
  );
}

/** "→ mostra 3, 4" ao lado da resposta que faz esses campos aparecerem. */
function ChipMostra({ numeros, cor }: { numeros: number[]; cor: Cor }) {
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cor.chip}`} title="Campos que aparecem com esta resposta">
      → mostra {numeros.join(', ')}
    </span>
  );
}

/** Faixa no topo do campo condicional: "Aparece se [2 · Pergunta] for [A] [B]". */
function FaixaCondicao({ campo, pai, cor, numeroPai, anteriores, numero, onChange }: {
  campo: CampoRel;
  pai: CampoRel;
  cor: Cor;
  numeroPai: number;
  anteriores: CampoRel[];
  numero: Map<string, number>;
  onChange: (s: CampoRel['show_if']) => void;
}) {
  const s = campo.show_if!;
  const candidatos = anteriores.filter((x) => condicionavel(x.type));
  const paiAcima = anteriores.includes(pai);
  const nome = (x: CampoRel) => `${numero.get(x.id)} · ${x.label.trim() || 'Pergunta sem título'}`;
  return (
    <div className={`px-2 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 ${cor.fundo}`}>
      <CornerDownRight size={14} className={`shrink-0 ${cor.texto}`} />
      <span className="font-medium">Aparece se</span>
      <select
        value={s.field_id}
        onChange={(e) => onChange({ field_id: e.target.value, values: [] })}
        className={`max-w-[220px] rounded-full border-0 px-2 py-0.5 text-base md:text-xs font-medium ${cor.chip}`}
        title={`Depende da pergunta ${numeroPai}`}
      >
        {candidatos.map((x) => <option key={x.id} value={x.id}>{nome(x)}</option>)}
        {!paiAcima && <option value={pai.id}>{nome(pai)}</option>}
      </select>
      <span>{pai.type === 'multipla' ? 'tiver marcado' : 'for'}</span>
      {respostasPossiveis(pai).map((o, k) => {
        const marcado = s.values.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange({ ...s, values: marcado ? s.values.filter((v) => v !== o.id) : [...s.values, o.id] })}
            className={`px-2 py-0.5 rounded-full border ${marcado ? cor.ativo : 'bg-white border-slate-200 text-slate-500'}`}
          >
            {o.label.trim() || `Opção ${k + 1}`}
          </button>
        );
      })}
      {s.values.length > 1 && <span className="text-slate-400">(qualquer uma)</span>}
      <button type="button" onClick={() => onChange(null)} className="ml-auto p-0.5 text-slate-400 hover:text-red-500" title="Mostrar sempre (tirar a condição)"><X size={14} /></button>
      {!s.values.length && <span className="w-full text-amber-700">Clique na resposta que faz este campo aparecer.</span>}
      {!paiAcima && <span className="w-full text-amber-700">A pergunta {numeroPai} precisa ficar acima desta — use as setas.</span>}
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
    if (c.type !== 'escolha' || !c.outro) delete c.outro;
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
              <div className="flex flex-col md:flex-row gap-2">
                <select
                  value={ehOutro(v) ? OUTRO : typeof v === 'string' ? v : ''}
                  onChange={(e) => onChange(c.id, e.target.value === OUTRO ? PREFIXO_OUTRO : e.target.value || null)}
                  className="w-full md:w-auto min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm bg-white"
                >
                  <option value="">Escolha…</option>
                  {c.options?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  {c.outro && <option value={OUTRO}>Outro…</option>}
                </select>
                {ehOutro(v) && (
                  <input
                    autoFocus
                    value={v.slice(PREFIXO_OUTRO.length)}
                    onChange={(e) => onChange(c.id, PREFIXO_OUTRO + e.target.value)}
                    maxLength={500}
                    placeholder="Escreva qual…"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm"
                  />
                )}
              </div>
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
    if (c.type === 'escolha' && ehOutro(v) && !v.slice(PREFIXO_OUTRO.length).trim()) return `"${c.label}": escreva o que é o "Outro"`;
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
