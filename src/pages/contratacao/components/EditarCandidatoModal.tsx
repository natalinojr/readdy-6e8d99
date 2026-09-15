// Editar os dados do candidato (contato, dados pessoais, endereço, perfil, escolaridade e experiências).
// Grava só o que mudou; endereço novo zera a localização (o "Recalcular" da ficha refaz a distância).
// Cada alteração entra no histórico do candidato pelo gatilho hiring_candidates_log.
import { useState } from 'react';
import { type Candidate, type Education, type Experience, onlyDigits } from '../shared';

interface Props {
  c: Candidate;
  onClose: () => void;
  onSave: (patch: Partial<Candidate>) => void;
}

const TEXTOS = ['full_name', 'email', 'marital_status', 'address', 'neighborhood', 'city', 'desired_role', 'availability', 'salary_expectation', 'driver_license', 'summary'] as const;
type Texto = typeof TEXTOS[number];

const expVazia = (): Experience => ({ empresa: null, cargo: null, inicio: null, fim: null, atual: false, descricao: null });
const eduVazia = (): Education => ({ instituicao: null, curso: null, nivel: null, situacao: null });
const limpo = (s: unknown) => { const t = String(s ?? '').trim(); return t || null; };

export default function EditarCandidatoModal({ c, onClose, onSave }: Props) {
  const [f, setF] = useState<Record<Texto, string>>(() => Object.fromEntries(TEXTOS.map((k) => [k, String(c[k] ?? '')])) as Record<Texto, string>);
  const [phone, setPhone] = useState(c.phone ?? '');
  const [whatsapp, setWhatsapp] = useState(c.whatsapp ?? '');
  const [birth, setBirth] = useState(c.birth_date ?? '');
  const [exps, setExps] = useState<Experience[]>(() => (c.experiences ?? []).map((e) => ({ ...expVazia(), ...e })));
  const [edus, setEdus] = useState<Education[]>(() => (c.education ?? []).map((e) => ({ ...eduVazia(), ...e })));
  const [erro, setErro] = useState<string | null>(null);
  const set = (k: Texto, v: string) => setF((x) => ({ ...x, [k]: v }));

  const salvar = () => {
    if (!f.full_name.trim()) { setErro('O nome não pode ficar vazio.'); return; }
    const patch: Record<string, unknown> = {};
    for (const k of TEXTOS) {
      const v = k === 'email' ? limpo(f[k])?.toLowerCase() ?? null : limpo(f[k]);
      if (v !== (c[k] ?? null)) patch[k] = k === 'full_name' ? v ?? c.full_name : v;
    }
    const tel = onlyDigits(phone) || null;
    if (tel !== (c.phone ?? null)) patch.phone = tel;
    const wpp = onlyDigits(whatsapp) || null;
    if (wpp !== (c.whatsapp ?? null)) patch.whatsapp = wpp;
    const nasc = birth || null;
    if (nasc !== (c.birth_date ?? null)) patch.birth_date = nasc;
    // Listas: tira os itens totalmente vazios; grava só se mudou.
    const expsOk = exps.map((e) => ({ ...e, empresa: limpo(e.empresa), cargo: limpo(e.cargo), inicio: limpo(e.inicio), fim: e.atual ? null : limpo(e.fim), descricao: limpo(e.descricao) }))
      .filter((e) => e.empresa || e.cargo || e.descricao || e.inicio);
    if (JSON.stringify(expsOk) !== JSON.stringify(c.experiences ?? [])) patch.experiences = expsOk;
    const edusOk = edus.map((e) => ({ instituicao: limpo(e.instituicao), curso: limpo(e.curso), nivel: limpo(e.nivel), situacao: limpo(e.situacao) }))
      .filter((e) => e.instituicao || e.curso || e.nivel);
    if (JSON.stringify(edusOk) !== JSON.stringify(c.education ?? [])) patch.education = edusOk;
    if (['address', 'neighborhood', 'city'].some((k) => k in patch)) Object.assign(patch, { lat: null, lng: null, geo_label: null, geo_precision: null });
    if (Object.keys(patch).length) onSave(patch as Partial<Candidate>);
    onClose();
  };

  const input = 'w-full h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm mt-0.5 focus:outline-none focus:border-rose-300';
  const label = 'text-[10px] font-bold uppercase tracking-wider text-zinc-400';
  const campo = (k: Texto, titulo: string, extra = '', placeholder = '') => (
    <label className={`block ${extra}`}>
      <span className={label}>{titulo}</span>
      <input value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} className={input} />
    </label>
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[61] flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-none">
        <div className="pointer-events-auto w-full sm:max-w-2xl max-h-[92vh] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
            <i className="ri-user-settings-line text-xl text-rose-600" />
            <h2 className="flex-1 text-base font-black text-zinc-900">Editar dados do candidato</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <Grupo titulo="Contato">
              {campo('full_name', 'Nome completo', 'sm:col-span-2')}
              <label className="block">
                <span className={label}>Telefone (do currículo)</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="41 99999-9999" className={input} />
              </label>
              <label className="block">
                <span className={label}>WhatsApp</span>
                <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="tel" placeholder="Número que conversa com o assistente" className={input} />
              </label>
              {campo('email', 'E-mail', 'sm:col-span-2')}
              <p className="sm:col-span-2 text-[11px] text-zinc-400 -mt-1">O agendamento pela IA chama pelo WhatsApp; sem ele, pelo telefone.</p>
            </Grupo>

            <Grupo titulo="Dados pessoais e endereço">
              <label className="block">
                <span className={label}>Data de nascimento</span>
                <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} className={input} />
              </label>
              {campo('marital_status', 'Estado civil')}
              {campo('address', 'Endereço (rua e número)', 'sm:col-span-2')}
              {campo('neighborhood', 'Bairro')}
              {campo('city', 'Cidade')}
            </Grupo>

            <Grupo titulo="Perfil">
              {campo('desired_role', 'Cargo pretendido')}
              {campo('availability', 'Disponibilidade de horário')}
              {campo('salary_expectation', 'Pretensão salarial')}
              {campo('driver_license', 'CNH', '', 'Ex.: B, AB, não tem')}
              <label className="block sm:col-span-2">
                <span className={label}>Resumo</span>
                <textarea value={f.summary} onChange={(e) => set('summary', e.target.value)} rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm mt-0.5 focus:outline-none focus:border-rose-300" />
              </label>
            </Grupo>

            <Lista titulo="Escolaridade" onAdd={() => setEdus((x) => [...x, eduVazia()])} vazio="Nenhuma formação cadastrada.">
              {edus.map((e, i) => (
                <Item key={i} onRemove={() => setEdus((x) => x.filter((_, j) => j !== i))}>
                  <input value={e.nivel ?? ''} onChange={(ev) => setEdus((x) => x.map((y, j) => (j === i ? { ...y, nivel: ev.target.value } : y)))} placeholder="Nível (ex.: Ensino médio completo)" className={input} />
                  <input value={e.curso ?? ''} onChange={(ev) => setEdus((x) => x.map((y, j) => (j === i ? { ...y, curso: ev.target.value } : y)))} placeholder="Curso" className={input} />
                  <input value={e.instituicao ?? ''} onChange={(ev) => setEdus((x) => x.map((y, j) => (j === i ? { ...y, instituicao: ev.target.value } : y)))} placeholder="Instituição" className={input} />
                  <input value={e.situacao ?? ''} onChange={(ev) => setEdus((x) => x.map((y, j) => (j === i ? { ...y, situacao: ev.target.value } : y)))} placeholder="Situação (completo, cursando…)" className={input} />
                </Item>
              ))}
            </Lista>

            <Lista titulo="Experiências" onAdd={() => setExps((x) => [...x, expVazia()])} vazio="Nenhuma experiência cadastrada.">
              {exps.map((e, i) => (
                <Item key={i} onRemove={() => setExps((x) => x.filter((_, j) => j !== i))}>
                  <input value={e.cargo ?? ''} onChange={(ev) => setExps((x) => x.map((y, j) => (j === i ? { ...y, cargo: ev.target.value } : y)))} placeholder="Cargo / função" className={input} />
                  <input value={e.empresa ?? ''} onChange={(ev) => setExps((x) => x.map((y, j) => (j === i ? { ...y, empresa: ev.target.value } : y)))} placeholder="Empresa" className={input} />
                  <input value={e.inicio ?? ''} onChange={(ev) => setExps((x) => x.map((y, j) => (j === i ? { ...y, inicio: ev.target.value } : y)))} placeholder="Início (ex.: 03/2022)" className={input} />
                  <div className="flex items-center gap-2">
                    <input value={e.atual ? '' : e.fim ?? ''} disabled={e.atual} onChange={(ev) => setExps((x) => x.map((y, j) => (j === i ? { ...y, fim: ev.target.value } : y)))} placeholder="Fim" className={`${input} disabled:bg-zinc-50`} />
                    <label className="flex items-center gap-1 text-xs text-zinc-600 whitespace-nowrap mt-0.5">
                      <input type="checkbox" checked={e.atual} onChange={(ev) => setExps((x) => x.map((y, j) => (j === i ? { ...y, atual: ev.target.checked } : y)))} className="accent-rose-600" /> atual
                    </label>
                  </div>
                  <textarea value={e.descricao ?? ''} onChange={(ev) => setExps((x) => x.map((y, j) => (j === i ? { ...y, descricao: ev.target.value } : y)))} rows={2} placeholder="O que fazia"
                    className="sm:col-span-2 w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-rose-300" />
                </Item>
              ))}
            </Lista>
          </div>

          <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-100">
            {erro && <p className="flex-1 text-xs text-red-600">{erro}</p>}
            <button onClick={onClose} className="ml-auto px-4 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer">Cancelar</button>
            <button onClick={salvar} className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer">Salvar</button>
          </div>
        </div>
      </div>
    </>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-xs font-black text-zinc-800 mb-2">{titulo}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</div>
    </section>
  );
}
function Lista({ titulo, onAdd, vazio, children }: { titulo: string; onAdd: () => void; vazio: string; children: React.ReactNode[] }) {
  return (
    <section>
      <div className="flex items-center mb-2">
        <p className="flex-1 text-xs font-black text-zinc-800">{titulo}</p>
        <button onClick={onAdd} className="text-xs font-bold text-rose-600 cursor-pointer"><i className="ri-add-line" /> Adicionar</button>
      </div>
      {children.length ? <div className="space-y-2">{children}</div> : <p className="text-xs text-zinc-400">{vazio}</p>}
    </section>
  );
}
function Item({ onRemove, children }: { onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="relative rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 pr-9">
      <button onClick={onRemove} title="Remover" className="absolute top-2 right-2 w-6 h-6 rounded-md hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</div>
    </div>
  );
}
