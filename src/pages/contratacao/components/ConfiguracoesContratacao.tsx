// Configurações do módulo Contratação: empresas, fases do kanban, ficha de entrevista
// e padrões do convite. Empresas e fases gravam na hora; o resto tem botão Salvar.
import { lazy, Suspense, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Candidate, type Company, type Criterion, type Settings, type Stage, COLORS, NATIVE_LABEL, DEFAULT_SETTINGS, colorOf, slug, geocodeText,
  type RequiredField, type CustomField, REQUIRED_FIELDS, DEFAULT_REQUIRED, faltasFicha,
} from '../shared';

// Leaflet só carrega quando alguém abre o mapa de uma loja.
const MapaPin = lazy(() => import('@/components/feature/MapaPin'));
import { confirmar, avisar } from '../dialog';

interface Props {
  companies: Company[];
  stages: Stage[];
  settings: Settings;
  candidates: Candidate[];
  onReload: () => Promise<void>;
  onSettingsSaved: (s: Settings) => void;
  /** Loja ganhou/mudou o pin: recalcula a distância de todos os candidatos até ela. */
  onRecalcCompany: (companyId: string) => Promise<void>;
}

export default function ConfiguracoesContratacao({ companies, stages, settings, candidates, onReload, onSettingsSaved, onRecalcCompany }: Props) {
  return (
    <div className="space-y-5 max-w-3xl">
      <Empresas companies={companies} candidates={candidates} onReload={onReload} onRecalcCompany={onRecalcCompany} />
      <Fases stages={stages} candidates={candidates} onReload={onReload} />
      <DadosMinimos settings={settings} candidates={candidates} stages={stages} onSaved={onSettingsSaved} />
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
function Empresas({ companies, candidates, onReload, onRecalcCompany }: {
  companies: Company[]; candidates: Candidate[]; onReload: () => Promise<void>; onRecalcCompany: (companyId: string) => Promise<void>;
}) {
  const [novo, setNovo] = useState('');
  const [novoEnd, setNovoEnd] = useState('');
  const [novaCidade, setNovaCidade] = useState('');
  const [criando, setCriando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const count = (id: string) => candidates.filter((c) => c.company_id === id).length;

  // Cria a empresa já com endereço; se achar no mapa, deixa o pin sugerido e abre o painel para conferir.
  const add = async () => {
    const name = novo.trim();
    if (!name) return;
    setCriando(true);
    const address = novoEnd.trim() || null;
    const city = novaCidade.trim() || null;
    let geo: { lat: number; lng: number } | null = null;
    if (address) {
      const ref = companies.find((x) => x.lat != null && x.lng != null);
      try { geo = await geocodeText([address, city].filter(Boolean).join(', '), ref ? { lat: ref.lat!, lng: ref.lng! } : null); } catch { geo = null; }
    }
    const { data, error } = await supabase.from('hiring_companies')
      .insert({ name, address, city, lat: geo?.lat ?? null, lng: geo?.lng ?? null, sort_order: (companies.at(-1)?.sort_order ?? 0) + 10 })
      .select('id').single();
    setCriando(false);
    if (error) { avisar(`Não foi possível salvar: ${error.message}`); return; }
    setNovo(''); setNovoEnd(''); setNovaCidade('');
    await onReload();
    if (data?.id) setAberta(data.id);
    if (data?.id && geo) onRecalcCompany(data.id);
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
            <button onClick={() => setAberta(aberta === c.id ? null : c.id)} className="flex-1 min-w-0 text-left cursor-pointer">
              <p className={`text-sm font-semibold truncate ${c.is_active ? 'text-zinc-900' : 'text-zinc-400 line-through'}`}>{c.name}</p>
              <p className="text-[11px] text-zinc-500 truncate">
                {[c.address, c.city].filter(Boolean).join(' · ') || <span className="text-orange-600">sem endereço</span>}
                {c.lat != null ? <span className="text-emerald-600"> · <i className="ri-map-pin-2-fill" /> no mapa</span> : c.address ? <span className="text-orange-600"> · sem pin</span> : null}
              </p>
            </button>
            <span className="hidden sm:inline text-[11px] text-zinc-400 w-20 text-right">{count(c.id)} candidato{count(c.id) === 1 ? '' : 's'}</span>
            <button onClick={() => setAberta(aberta === c.id ? null : c.id)}
              className={`flex items-center gap-1 px-2.5 h-8 rounded-lg border text-xs font-bold cursor-pointer ${aberta === c.id ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}>
              <i className={aberta === c.id ? 'ri-arrow-up-s-line' : 'ri-pencil-line'} /> {aberta === c.id ? 'Fechar' : 'Editar'}
            </button>
            <button onClick={() => toggle(c)} title={c.is_active ? 'Desativar (some do envio e do filtro)' : 'Reativar'}
              className="w-8 h-8 rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer">
              <i className={c.is_active ? 'ri-eye-line' : 'ri-eye-off-line'} />
            </button>
            <button onClick={() => remove(c)} title="Excluir" className="w-8 h-8 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
           </div>
           {aberta === c.id && (
             <div className="mt-2 sm:ml-8 space-y-4 rounded-xl bg-zinc-50 border border-zinc-100 p-3">
               <EditarEmpresa c={c} referencia={companies.find((x) => x.id !== c.id && x.lat != null && x.lng != null) ?? null}
                 onReload={onReload} onRecalcCompany={onRecalcCompany} />
               <LocalizacaoLoja key={`${c.id}:${c.lat}:${c.lng}`} c={c}
                 referencia={companies.find((x) => x.id !== c.id && x.lat != null && x.lng != null) ?? null}
                 onSaved={async () => { await onReload(); await onRecalcCompany(c.id); }} />
             </div>
           )}
          </li>
        ))}
        {companies.length === 0 && <li className="py-3 text-xs text-zinc-400">Nenhuma empresa ainda. Cadastre a primeira abaixo.</li>}
      </ul>
      <div className="mt-3 rounded-xl border border-dashed border-zinc-200 p-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nova empresa / loja</p>
        <input value={novo} onChange={(e) => setNovo(e.target.value)}
          placeholder="Nome da empresa ou loja" className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={novoEnd} onChange={(e) => setNovoEnd(e.target.value)}
            placeholder="Endereço (rua, número, bairro)" className="sm:col-span-2 h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
          <input value={novaCidade} onChange={(e) => setNovaCidade(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Cidade - UF" className="h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[10px] text-zinc-400">Com o endereço, o sistema localiza a loja no mapa e calcula a distância até cada candidato. Depois dá para ajustar o pin.</p>
          <button onClick={add} disabled={criando || !novo.trim()}
            className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer whitespace-nowrap">
            {criando ? 'Salvando…' : <><i className="ri-add-line" /> Adicionar</>}
          </button>
        </div>
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
            <span className="hidden sm:inline text-[11px] text-zinc-400 w-20 text-right">{count(s.id)} candidato{count(s.id) === 1 ? '' : 's'}</span>
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

// ── Dados mínimos da ficha ──────────────────────────────────────────────────
// Sem eles o candidato não sai de "Novo" (trava no banco) e o atendente do WhatsApp pergunta o que faltar.
function DadosMinimos({ settings, candidates, stages, onSaved }: {
  settings: Settings; candidates: Candidate[]; stages: Stage[]; onSaved: (s: Settings) => void;
}) {
  const [sel, setSel] = useState<RequiredField[]>(settings.required_fields);
  const [custom, setCustom] = useState<CustomField[]>(settings.custom_fields);
  const [novoCampo, setNovoCampo] = useState('');
  const [novaPergunta, setNovaPergunta] = useState('');
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  useEffect(() => { setSel(settings.required_fields); setCustom(settings.custom_fields); }, [settings.required_fields, settings.custom_fields]);
  const dirty = JSON.stringify([...sel].sort()) !== JSON.stringify([...settings.required_fields].sort())
    || JSON.stringify(custom) !== JSON.stringify(settings.custom_fields);
  const novoId = stages.find((s) => s.native_kind === 'novo')?.id ?? null;
  const emNovo = candidates.filter((c) => !c.stage_id || c.stage_id === novoId);
  const incompletos = emNovo.filter((c) => faltasFicha(c, { required_fields: sel, custom_fields: custom }).length > 0).length;
  const toggle = (id: RequiredField) => { setOk(false); setSel((x) => (x.includes(id) ? x.filter((f) => f !== id) : [...x, id])); };
  // Dado criado pelo dono: id "x_…" (o banco e o WhatsApp tratam como texto livre em extra_fields).
  const addCampo = () => {
    const label = novoCampo.trim();
    if (!label) return;
    let id = `x_${slug(label).slice(0, 30)}`;
    while (custom.some((f) => f.id === id) || REQUIRED_FIELDS.some((f) => f.id === id)) id = `${id}_2`;
    setOk(false);
    setCustom((x) => [...x, { id, label, ...(novaPergunta.trim() ? { ask: novaPergunta.trim() } : {}) }]);
    setSel((x) => [...x, id]);
    setNovoCampo(''); setNovaPergunta('');
  };
  const removeCampo = async (f: CustomField) => {
    const ok = await confirmar({ titulo: `Excluir "${f.label}"?`, mensagem: 'Sai da lista de dados mínimos. O que os candidatos já responderam continua guardado.', confirmarLabel: 'Excluir', perigo: true });
    if (!ok) return;
    setOk(false);
    setCustom((x) => x.filter((y) => y.id !== f.id));
    setSel((x) => x.filter((y) => y !== f.id));
  };

  const salvar = async () => {
    setSaving(true); setOk(false);
    const ordem = [...REQUIRED_FIELDS.map((f) => f.id as string), ...custom.map((f) => f.id)];
    const next: Settings = { ...settings, custom_fields: custom, required_fields: ordem.filter((f) => sel.includes(f)) };
    const { error } = await supabase.from('hiring_settings').upsert({ id: 1, data: next, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) { avisar(`Não foi possível salvar: ${error.message}`); return; }
    setOk(true);
    onSaved(next);
  };

  return (
    <Card titulo="Dados mínimos da ficha" desc='O candidato só sai da fase "Novo" com estes dados preenchidos (pode ir direto para "Descartado", e dá para "mover mesmo assim"). Quando o currículo chega pelo link do WhatsApp sem algum deles, o atendente pergunta ao candidato e vai preenchendo a ficha.'>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {REQUIRED_FIELDS.map((f) => (
          <label key={f.id} className={`flex items-center gap-2 px-3 h-9 rounded-lg border text-sm cursor-pointer ${sel.includes(f.id) ? 'border-rose-300 bg-rose-50 text-zinc-900' : 'border-zinc-200 text-zinc-600'}`}>
            <input type="checkbox" checked={sel.includes(f.id)} onChange={() => toggle(f.id)} className="accent-rose-600" />
            {f.label}
            {f.sensivel && <span className="ml-auto text-[10px] text-amber-600" title="Pergunta pessoal: exigir pode ser visto como discriminatório na seleção">sensível</span>}
          </label>
        ))}
        {custom.map((f) => (
          <div key={f.id} className={`flex items-center gap-2 pl-3 pr-1 h-9 rounded-lg border text-sm ${sel.includes(f.id) ? 'border-rose-300 bg-rose-50 text-zinc-900' : 'border-zinc-200 text-zinc-600'}`}>
            <label className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer" title={f.ask ? `Pergunta no WhatsApp: ${f.ask}` : undefined}>
              <input type="checkbox" checked={sel.includes(f.id)} onChange={() => toggle(f.id)} className="accent-rose-600" />
              <span className="truncate">{f.label}</span>
              <span className="text-[10px] text-sky-600 shrink-0">criado</span>
            </label>
            <button onClick={() => removeCampo(f)} title="Excluir" className="w-7 h-7 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-dashed border-zinc-200 p-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Adicionar dado mínimo</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={novoCampo} onChange={(e) => setNovoCampo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCampo()}
            placeholder="Nome do dado (ex.: Tamanho do uniforme)" className="h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
          <input value={novaPergunta} onChange={(e) => setNovaPergunta(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCampo()}
            placeholder="Pergunta no WhatsApp (opcional)" className="h-9 px-3 rounded-lg border border-zinc-200 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[10px] text-zinc-400">Entra marcado como obrigatório. Sem pergunta, o atendente pergunta com as palavras dele. Depois clique em Salvar.</p>
          <button onClick={addCampo} disabled={!novoCampo.trim()} className="px-3 h-9 rounded-lg border border-zinc-200 text-sm font-bold text-zinc-700 disabled:opacity-40 cursor-pointer whitespace-nowrap"><i className="ri-add-line" /> Adicionar</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button onClick={salvar} disabled={!dirty || saving}
          className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={() => { setOk(false); setSel(DEFAULT_REQUIRED); }} className="text-xs text-sky-700 font-semibold cursor-pointer">Restaurar padrão</button>
        {ok && !dirty && <span className="text-xs text-emerald-600 font-semibold"><i className="ri-check-line" /> Salvo</span>}
        <span className="text-[11px] text-zinc-500 sm:ml-auto">{incompletos} de {emNovo.length} candidato{emNovo.length === 1 ? '' : 's'} em "Novo" com ficha incompleta</span>
      </div>
    </Card>
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

// ── Dados da empresa (editar depois de criada) ──────────────────────────────
// Salva com botão. Mudou endereço/cidade: localiza de novo no mapa; achou → move o pin e
// recalcula a distância dos candidatos desta loja; não achou → mantém o pin e avisa.
function EditarEmpresa({ c, referencia, onReload, onRecalcCompany }: {
  c: Company; referencia: Company | null; onReload: () => Promise<void>; onRecalcCompany: (companyId: string) => Promise<void>;
}) {
  const inicial = { name: c.name, address: c.address ?? '', city: c.city ?? '', description: c.description ?? '' };
  const [f, setF] = useState(inicial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const set = (k: keyof typeof inicial, v: string) => { setF((x) => ({ ...x, [k]: v })); setMsg(null); };
  const dirty = JSON.stringify(f) !== JSON.stringify(inicial);

  const salvar = async () => {
    if (!f.name.trim()) { setMsg({ ok: false, texto: 'O nome não pode ficar vazio.' }); return; }
    setSaving(true); setMsg(null);
    const address = f.address.trim() || null;
    const city = f.city.trim() || null;
    const endMudou = address !== (c.address ?? null) || city !== (c.city ?? null);
    const row: Record<string, unknown> = { name: f.name.trim(), address, city, description: f.description.trim() || null };
    let pinNovo = false;
    let naoAchou = false;
    if (endMudou && address) {
      try {
        const g = await geocodeText([address, city].filter(Boolean).join(', '), referencia?.lat != null ? { lat: referencia.lat, lng: referencia.lng! } : null);
        row.lat = g.lat; row.lng = g.lng; pinNovo = true;
      } catch { naoAchou = true; }
    }
    const { error } = await supabase.from('hiring_companies').update(row).eq('id', c.id);
    if (!error && pinNovo) await supabase.from('hiring_distances').delete().eq('company_id', c.id);
    setSaving(false);
    if (error) { setMsg({ ok: false, texto: `Não foi possível salvar: ${error.message}` }); return; }
    await onReload();
    setMsg({
      ok: true,
      texto: pinNovo ? 'Salvo. O pin foi movido para o novo endereço: confira no mapa abaixo. Recalculando as distâncias…'
        : naoAchou ? 'Salvo, mas não achei o novo endereço no mapa: ajuste o pin abaixo.'
        : 'Salvo.',
    });
    if (pinNovo) { await onRecalcCompany(c.id); setMsg({ ok: true, texto: 'Salvo. Pin movido para o novo endereço e distâncias recalculadas: confira o pin abaixo.' }); }
  };

  const inputCls = 'w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm mt-1 bg-white';
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Dados da empresa</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="sm:col-span-3 block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nome</span>
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </label>
        <label className="sm:col-span-2 block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Endereço</span>
          <input value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="Rua, número, bairro" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Cidade</span>
          <input value={f.city} onChange={(e) => set('city', e.target.value)} placeholder="Ex.: Paranaguá - PR" className={inputCls} />
        </label>
        <label className="sm:col-span-3 block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Sobre a loja</span>
          <textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={2}
            placeholder="Tipo de operação, público, ritmo, turnos (ex.: hamburgueria em shopping, movimento forte à noite e fim de semana)"
            className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm mt-1 bg-white" />
        </label>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <p className={`flex-1 text-[11px] ${msg ? (msg.ok ? 'text-emerald-700' : 'text-red-600') : 'text-zinc-400'}`}>
          {msg?.texto ?? 'A IA usa endereço e "sobre a loja" para comparar os currículos com as vagas desta empresa.'}
        </p>
        {dirty && <button onClick={() => { setF(inicial); setMsg(null); }} className="px-3 h-8 rounded-lg text-xs font-semibold text-zinc-500 hover:bg-zinc-100 cursor-pointer">Desfazer</button>}
        <button onClick={salvar} disabled={!dirty || saving}
          className="px-4 h-8 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer whitespace-nowrap">
          {saving ? 'Salvando…' : 'Salvar dados'}
        </button>
      </div>
    </div>
  );
}

// ── Pin da loja no mapa ─────────────────────────────────────────────────────
// Arrasta o mapa até a porta da loja (pin fixo no centro) e salva. "Localizar pelo endereço"
// usa o geocode; em cidade pequena ele erra, por isso o pin é o que vale.
function LocalizacaoLoja({ c, referencia, onSaved }: { c: Company; referencia: Company | null; onSaved: () => Promise<void> }) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null);
  const [busy, setBusy] = useState<'geo' | 'save' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const mudou = pos != null && (pos.lat !== c.lat || pos.lng !== c.lng);

  const localizar = async () => {
    const texto = [c.address, c.city].filter(Boolean).join(', ');
    if (!texto) { setMsg('Preencha o endereço e a cidade acima primeiro.'); return; }
    setBusy('geo'); setMsg(null);
    try {
      const g = await geocodeText(texto, referencia?.lat != null ? { lat: referencia.lat, lng: referencia.lng! } : null);
      setPos({ lat: g.lat, lng: g.lng });
      setMsg(`Achei: ${g.label}. Confira se o pin está na porta da loja e salve.`);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };

  const salvar = async () => {
    if (!pos) return;
    setBusy('save'); setMsg(null);
    // Pin mudou: as distâncias antigas até esta loja deixam de valer.
    const { error } = await supabase.from('hiring_companies').update({ lat: pos.lat, lng: pos.lng }).eq('id', c.id);
    if (!error) await supabase.from('hiring_distances').delete().eq('company_id', c.id);
    setBusy(null);
    if (error) { avisar(`Não foi possível salvar o pin: ${error.message}`); return; }
    setMsg('Localização salva. Calculando a distância dos candidatos…');
    await onSaved();
    setMsg('Localização salva e distâncias atualizadas.');
  };

  const centro: [number, number] | undefined = referencia?.lat != null ? [referencia.lat, referencia.lng!] : undefined;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Localização da loja</span>
        {c.lat != null ? <span className="text-[10px] font-semibold text-emerald-600"><i className="ri-map-pin-2-fill" /> marcada</span>
          : <span className="text-[10px] font-semibold text-orange-600">não marcada</span>}
        <button onClick={localizar} disabled={busy !== null} className="ml-auto px-2.5 h-7 rounded-lg border border-zinc-200 bg-white text-[11px] font-bold text-zinc-700 disabled:opacity-50 cursor-pointer">
          {busy === 'geo' ? 'Procurando…' : <><i className="ri-search-line" /> Localizar pelo endereço</>}
        </button>
      </div>
      <Suspense fallback={<div className="h-56 rounded-xl bg-zinc-100 animate-pulse" />}>
        <MapaPin lat={pos?.lat ?? null} lng={pos?.lng ?? null} altura="h-56" defaultCenter={centro}
          onChange={(lat, lng) => setPos({ lat, lng })} />
      </Suspense>
      <div className="flex items-center gap-2 mt-1.5">
        <p className="flex-1 text-[10px] text-zinc-500">{msg ?? 'Arraste o mapa até a porta da loja (o pin fica no centro) e salve.'}</p>
        <button onClick={salvar} disabled={!mudou || busy !== null}
          className="px-3 h-8 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer whitespace-nowrap">
          {busy === 'save' ? 'Salvando…' : 'Salvar localização'}
        </button>
      </div>
    </div>
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
