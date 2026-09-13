// Configurações do módulo Contratação: empresas, fases do kanban, ficha de entrevista
// e padrões do convite. Empresas e fases gravam na hora; o resto tem botão Salvar.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Candidate, type Company, type Criterion, type Settings, type Stage, COLORS, NATIVE_LABEL, DEFAULT_SETTINGS, colorOf, slug,
} from '../shared';
import { confirmar, avisar } from '../dialog';

interface Props {
  companies: Company[];
  stages: Stage[];
  settings: Settings;
  candidates: Candidate[];
  onReload: () => Promise<void>;
  onSettingsSaved: (s: Settings) => void;
}

export default function ConfiguracoesContratacao({ companies, stages, settings, candidates, onReload, onSettingsSaved }: Props) {
  return (
    <div className="space-y-5 max-w-3xl">
      <Empresas companies={companies} candidates={candidates} onReload={onReload} />
      <Fases stages={stages} candidates={candidates} onReload={onReload} />
      <FichaEConvite settings={settings} onSaved={onSettingsSaved} />
    </div>
  );
}

async function run(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) avisar(`Não foi possível salvar: ${error.message}`);
  return !error;
}

// ── Empresas ────────────────────────────────────────────────────────────────
function Empresas({ companies, candidates, onReload }: { companies: Company[]; candidates: Candidate[]; onReload: () => Promise<void> }) {
  const [novo, setNovo] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const count = (id: string) => candidates.filter((c) => c.company_id === id).length;
  const saveField = async (c: Company, field: 'address' | 'city' | 'description', value: string) => {
    const v = value.trim() || null;
    if (v === (c[field] ?? null)) return;
    if (await run(supabase.from('hiring_companies').update({ [field]: v }).eq('id', c.id))) await onReload();
  };

  const add = async () => {
    const name = novo.trim();
    if (!name) return;
    if (await run(supabase.from('hiring_companies').insert({ name, sort_order: (companies.at(-1)?.sort_order ?? 0) + 10 }))) {
      setNovo(''); await onReload();
    }
  };
  const rename = async (c: Company, name: string) => {
    if (!name.trim() || name.trim() === c.name) return;
    if (await run(supabase.from('hiring_companies').update({ name: name.trim() }).eq('id', c.id))) await onReload();
  };
  const toggle = async (c: Company) => {
    if (await run(supabase.from('hiring_companies').update({ is_active: !c.is_active }).eq('id', c.id))) await onReload();
  };
  const remove = async (c: Company) => {
    const n = count(c.id);
    const ok = await confirmar({
      titulo: `Excluir ${c.name}?`,
      mensagem: n
        ? <><b className="text-zinc-900">{n} candidato{n > 1 ? 's' : ''}</b> desta empresa {n > 1 ? 'ficarão' : 'ficará'} como "Sem empresa". Se só quer esconder, use o olho para desativar.</>
        : 'A empresa será removida da lista.',
      confirmarLabel: 'Excluir',
      perigo: true,
    });
    if (!ok) return;
    if (await run(supabase.from('hiring_companies').delete().eq('id', c.id))) await onReload();
  };
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= companies.length) return;
    const a = companies[i]; const b = companies[j];
    await Promise.all([
      supabase.from('hiring_companies').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('hiring_companies').update({ sort_order: a.sort_order === b.sort_order ? a.sort_order + dir : a.sort_order }).eq('id', b.id),
    ]);
    await onReload();
  };

  return (
    <Card titulo="Empresas / lojas" desc="As empresas deste módulo são próprias e não têm ligação com as lojas do ERPOS. Cada currículo é salvo em uma delas.">
      <ul className="divide-y divide-zinc-100">
        {companies.map((c, i) => (
          <li key={c.id} className="py-2">
           <div className="flex items-center gap-2">
            <Arrows onUp={() => move(i, -1)} onDown={() => move(i, 1)} />
            <button onClick={() => setAberta(aberta === c.id ? null : c.id)} title="Endereço e sobre a loja (usados na análise das vagas)"
              className={`w-8 h-8 rounded-lg cursor-pointer ${c.address ? 'text-rose-600 hover:bg-rose-50' : 'text-zinc-400 hover:bg-zinc-100'}`}>
              <i className={aberta === c.id ? 'ri-arrow-up-s-line' : 'ri-map-pin-line'} />
            </button>
            <input defaultValue={c.name} onBlur={(e) => rename(c, e.target.value)}
              className={`flex-1 h-9 px-3 rounded-lg border border-zinc-200 text-sm ${c.is_active ? '' : 'text-zinc-400 line-through'}`} />
            <span className="text-[11px] text-zinc-400 w-20 text-right">{count(c.id)} candidato{count(c.id) === 1 ? '' : 's'}</span>
            <button onClick={() => toggle(c)} title={c.is_active ? 'Desativar (some do envio e do filtro)' : 'Reativar'}
              className="w-8 h-8 rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer">
              <i className={c.is_active ? 'ri-eye-line' : 'ri-eye-off-line'} />
            </button>
            <button onClick={() => remove(c)} className="w-8 h-8 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
           </div>
           {aberta === c.id && (
             <div className="mt-2 ml-8 grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl bg-zinc-50 border border-zinc-100 p-3">
               <label className="sm:col-span-2 block">
                 <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Endereço</span>
                 <input defaultValue={c.address ?? ''} onBlur={(e) => saveField(c, 'address', e.target.value)} placeholder="Rua, número, bairro"
                   className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm mt-1 bg-white" />
               </label>
               <label className="block">
                 <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Cidade</span>
                 <input defaultValue={c.city ?? ''} onBlur={(e) => saveField(c, 'city', e.target.value)} placeholder="Ex.: Paranaguá - PR"
                   className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm mt-1 bg-white" />
               </label>
               <label className="sm:col-span-3 block">
                 <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Sobre a loja</span>
                 <textarea defaultValue={c.description ?? ''} onBlur={(e) => saveField(c, 'description', e.target.value)} rows={2}
                   placeholder="Tipo de operação, público, ritmo, turnos (ex.: hamburgueria em shopping, movimento forte à noite e fim de semana)"
                   className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm mt-1 bg-white" />
               </label>
               <p className="sm:col-span-3 text-[10px] text-zinc-400">A IA usa estes dados para comparar os currículos com as vagas desta empresa (deslocamento e perfil da operação).</p>
             </div>
           )}
          </li>
        ))}
        {companies.length === 0 && <li className="py-3 text-xs text-zinc-400">Nenhuma empresa ainda. Cadastre a primeira abaixo.</li>}
      </ul>
      <div className="flex gap-2 mt-3">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Nome da empresa ou loja" className="flex-1 h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
        <button onClick={add} className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer"><i className="ri-add-line" /> Adicionar</button>
      </div>
    </Card>
  );
}

// ── Fases do kanban ─────────────────────────────────────────────────────────
function Fases({ stages, candidates, onReload }: { stages: Stage[]; candidates: Candidate[]; onReload: () => Promise<void> }) {
  const [novo, setNovo] = useState('');
  const count = (id: string) => candidates.filter((c) => c.stage_id === id).length;
  const novoStage = stages.find((s) => s.native_kind === 'novo');

  const add = async () => {
    const name = novo.trim();
    if (!name) return;
    // Nova fase entra antes de "Descartado".
    const desc = stages.find((s) => s.native_kind === 'descartado');
    const order = desc ? desc.sort_order - 1 : (stages.at(-1)?.sort_order ?? 0) + 10;
    if (await run(supabase.from('hiring_stages').insert({ name, color: 'amber', sort_order: order }))) { setNovo(''); await onReload(); }
  };
  const patch = async (s: Stage, p: Partial<Stage>) => {
    if (await run(supabase.from('hiring_stages').update(p).eq('id', s.id))) await onReload();
  };
  const remove = async (s: Stage) => {
    const n = count(s.id);
    const ok = await confirmar({
      titulo: `Excluir a fase "${s.name}"?`,
      mensagem: n
        ? <><b className="text-zinc-900">{n} candidato{n > 1 ? 's' : ''}</b> nesta fase {n > 1 ? 'vão' : 'vai'} para "{novoStage?.name ?? 'Novo'}".</>
        : 'A coluna sai do kanban.',
      confirmarLabel: 'Excluir',
      perigo: true,
    });
    if (!ok) return;
    if (n && novoStage) await supabase.from('hiring_candidates').update({ stage_id: novoStage.id }).eq('stage_id', s.id);
    if (await run(supabase.from('hiring_stages').delete().eq('id', s.id))) await onReload();
  };
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    // Renumera tudo para evitar empate de ordem.
    const list = [...stages];
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((s, k) => supabase.from('hiring_stages').update({ sort_order: (k + 1) * 10 }).eq('id', s.id)));
    await onReload();
  };

  return (
    <Card titulo="Fases do kanban" desc="Renomeie, mude a cor, reordene ou crie fases. As 4 fases nativas não podem ser apagadas porque o sistema move os candidatos para elas automaticamente.">
      <ul className="divide-y divide-zinc-100">
        {stages.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
            <Arrows onUp={() => move(i, -1)} onDown={() => move(i, 1)} />
            <ColorPicker value={s.color} onChange={(color) => patch(s, { color })} />
            <div className="flex-1 min-w-[160px]">
              <input defaultValue={s.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) patch(s, { name: v }); }}
                className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
              {s.native_kind && <p className="text-[10px] text-zinc-400 mt-0.5 px-1">Nativa: {NATIVE_LABEL[s.native_kind]}</p>}
            </div>
            <span className="text-[11px] text-zinc-400 w-20 text-right">{count(s.id)} candidato{count(s.id) === 1 ? '' : 's'}</span>
            {s.native_kind ? (
              <span className="w-8 h-8 flex items-center justify-center text-zinc-300" title="Fase nativa"><i className="ri-lock-line" /></span>
            ) : (
              <button onClick={() => remove(s)} className="w-8 h-8 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-3">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Nova fase (ex.: Teste prático, Contratado)" className="flex-1 h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
        <button onClick={add} className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer"><i className="ri-add-line" /> Adicionar</button>
      </div>
    </Card>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Cor" className="w-9 h-9 rounded-lg border border-zinc-200 flex items-center justify-center cursor-pointer">
        <span className={`w-4 h-4 rounded-full ${colorOf(value).dot}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-10 left-0 bg-white border border-zinc-200 rounded-xl shadow-lg p-2 grid grid-cols-5 gap-1.5 w-44">
            {Object.entries(COLORS).map(([k, c]) => (
              <button key={k} title={c.label} onClick={() => { onChange(k); setOpen(false); }}
                className={`w-7 h-7 rounded-full ${c.dot} cursor-pointer ${value === k ? 'ring-2 ring-offset-1 ring-zinc-500' : ''}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Ficha de entrevista + convite ───────────────────────────────────────────
function FichaEConvite({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [s, setS] = useState<Settings>(settings);
  const [novoCrit, setNovoCrit] = useState('');
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  useEffect(() => { setS(settings); }, [settings]);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);

  const setCrit = (list: Criterion[]) => setS((x) => ({ ...x, criteria: list }));
  const [novaPerg, setNovaPerg] = useState('');
  const setPergs = (list: Criterion[]) => setS((x) => ({ ...x, questions: list }));
  const addPerg = () => {
    const label = novaPerg.trim();
    if (!label) return;
    let id = slug(label).slice(0, 40);
    while (s.questions.some((q) => q.id === id)) id = `${id}_2`;
    setPergs([...s.questions, { id, label }]);
    setNovaPerg('');
  };
  const movePerg = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.questions.length) return;
    const list = [...s.questions];
    [list[i], list[j]] = [list[j], list[i]];
    setPergs(list);
  };
  const addCrit = () => {
    const label = novoCrit.trim();
    if (!label) return;
    let id = slug(label);
    while (s.criteria.some((c) => c.id === id)) id = `${id}_2`;
    setCrit([...s.criteria, { id, label }]);
    setNovoCrit('');
  };
  const moveCrit = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.criteria.length) return;
    const list = [...s.criteria];
    [list[i], list[j]] = [list[j], list[i]];
    setCrit(list);
  };

  const salvar = async () => {
    setSaving(true); setOk(false);
    const { error } = await supabase.from('hiring_settings').upsert({ id: 1, data: s, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) { avisar(`Não foi possível salvar: ${error.message}`); return; }
    setOk(true);
    onSaved(s);
  };

  return (
    <Card titulo="Entrevistas" desc="Perguntas do questionário, critérios de avaliação (nota de 1 a 5) e os padrões usados ao agendar. No fim de toda entrevista entram as Considerações adicionais e a Tomada de decisão (GPC, PC, R, NA).">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Perguntas do questionário</p>
      <ul className="space-y-1.5">
        {s.questions.map((q, i) => (
          <li key={q.id} className="flex items-center gap-2">
            <Arrows onUp={() => movePerg(i, -1)} onDown={() => movePerg(i, 1)} />
            <span className="w-5 text-xs font-bold text-zinc-400 text-right">{i + 1}.</span>
            <input value={q.label} onChange={(e) => setPergs(s.questions.map((x) => (x.id === q.id ? { ...x, label: e.target.value } : x)))}
              className="flex-1 h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
            <button onClick={() => setPergs(s.questions.filter((x) => x.id !== q.id))}
              className="w-8 h-8 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-2">
        <input value={novaPerg} onChange={(e) => setNovaPerg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPerg()}
          placeholder="Nova pergunta" className="flex-1 h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
        <button onClick={addPerg} className="px-3 h-9 rounded-lg border border-zinc-200 text-sm font-bold text-zinc-700 cursor-pointer"><i className="ri-add-line" /></button>
      </div>
      <p className="text-[10px] text-zinc-400 mt-1">Escreva {'{empresa}'} para aparecer o nome da empresa do candidato (ex.: "…contribuir com a {'{empresa}'}?").
        <button onClick={() => setPergs(DEFAULT_SETTINGS.questions)} className="ml-2 text-sky-700 font-semibold cursor-pointer">Restaurar perguntas padrão</button>
      </p>

      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5 mt-5">Critérios de avaliação (opcional)</p>
      <ul className="space-y-1.5">
        {s.criteria.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2">
            <Arrows onUp={() => moveCrit(i, -1)} onDown={() => moveCrit(i, 1)} />
            <input value={c.label} onChange={(e) => setCrit(s.criteria.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))}
              className="flex-1 h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
            <button onClick={() => setCrit(s.criteria.filter((x) => x.id !== c.id))}
              className="w-8 h-8 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-2">
        <input value={novoCrit} onChange={(e) => setNovoCrit(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCrit()}
          placeholder="Novo critério (ex.: Higiene pessoal)" className="flex-1 h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
        <button onClick={addCrit} className="px-3 h-9 rounded-lg border border-zinc-200 text-sm font-bold text-zinc-700 cursor-pointer"><i className="ri-add-line" /></button>
      </div>
      <p className="text-[10px] text-zinc-400 mt-1">Pode deixar sem nenhum critério. Apagar critério ou pergunta não apaga o que já foi preenchido.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-5">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Duração padrão</span>
          <select value={s.default_duration} onChange={(e) => setS((x) => ({ ...x, default_duration: Number(e.target.value) }))}
            className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm mt-1">
            {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Local padrão</span>
          <input value={s.default_location} onChange={(e) => setS((x) => ({ ...x, default_location: e.target.value }))}
            placeholder="Ex.: na loja" className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm mt-1" />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Quem entrevista</span>
          <input value={s.default_interviewer} onChange={(e) => setS((x) => ({ ...x, default_interviewer: e.target.value }))}
            placeholder="Ex.: Natalino" className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm mt-1" />
        </label>
      </div>

      <label className="block mt-4">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Mensagem do convite (WhatsApp)</span>
        <textarea value={s.invite_template} onChange={(e) => setS((x) => ({ ...x, invite_template: e.target.value }))} rows={3}
          className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm mt-1" />
        <span className="text-[10px] text-zinc-400">Use {'{nome}'}, {'{empresa}'}, {'{formato}'}, {'{data}'}, {'{hora}'} e {'{local}'}.
          <button onClick={() => setS((x) => ({ ...x, invite_template: DEFAULT_SETTINGS.invite_template }))} className="ml-2 text-sky-700 font-semibold cursor-pointer">Restaurar padrão</button>
        </span>
      </label>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={salvar} disabled={!dirty || saving}
          className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        {ok && !dirty && <span className="text-xs text-emerald-600 font-semibold"><i className="ri-check-line" /> Salvo</span>}
      </div>
    </Card>
  );
}

// ── UI ──────────────────────────────────────────────────────────────────────
function Card({ titulo, desc, children }: { titulo: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <p className="text-sm font-black text-zinc-900">{titulo}</p>
      <p className="text-xs text-zinc-500 mb-3">{desc}</p>
      {children}
    </section>
  );
}
function Arrows({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex flex-col">
      <button onClick={onUp} className="w-6 h-4 text-zinc-400 hover:text-zinc-800 leading-none cursor-pointer"><i className="ri-arrow-up-s-line" /></button>
      <button onClick={onDown} className="w-6 h-4 text-zinc-400 hover:text-zinc-800 leading-none cursor-pointer"><i className="ri-arrow-down-s-line" /></button>
    </div>
  );
}
