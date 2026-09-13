// Criar/editar vaga. Os campos alimentam a análise da IA (currículo × vaga × loja).
import { useState } from 'react';
import { type Company, type Job, type JobStatus, CONTRACT_TYPES, JOB_STATUS } from '../shared';

export type JobDraft = Omit<Job, 'id' | 'created_at' | 'opened_at' | 'closed_at'> & { id?: string };

interface Props {
  job: Job | null;
  companies: Company[];
  presetCompanyId: string | null;
  onClose: () => void;
  onSave: (draft: JobDraft) => Promise<boolean>;
}

export default function VagaModal({ job, companies, presetCompanyId, onClose, onSave }: Props) {
  const [d, setD] = useState<JobDraft>(() => job ? { ...job } : {
    company_id: presetCompanyId ?? companies.find((c) => c.is_active)?.id ?? null,
    title: '', description: '', requirements: '', desirable: '', schedule: '', salary: '', benefits: '',
    contract_type: 'CLT', openings: 1, status: 'aberta', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof JobDraft>(k: K, v: JobDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const salvar = async () => {
    if (!d.title.trim()) { setErro('Informe o cargo da vaga.'); return; }
    setSaving(true); setErro(null);
    const ok = await onSave({ ...d, title: d.title.trim() });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-[70] w-full sm:max-w-2xl max-h-[94vh] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
          <i className="ri-briefcase-4-line text-xl text-rose-600" />
          <h2 className="flex-1 font-black text-zinc-900">{job ? 'Editar vaga' : 'Abrir vaga'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="Cargo" className="sm:col-span-2">
              <input value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Atendente de salão" className={inputCls} autoFocus />
            </Field>
            <Field label="Empresa / loja">
              <select value={d.company_id ?? ''} onChange={(e) => set('company_id', e.target.value || null)} className={inputCls}>
                <option value="">Sem empresa</option>
                {companies.filter((c) => c.is_active || c.id === d.company_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label="Contrato">
              <select value={d.contract_type ?? ''} onChange={(e) => set('contract_type', e.target.value || null)} className={inputCls}>
                <option value="">—</option>
                {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Nº de vagas">
              <input type="number" min={1} value={d.openings} onChange={(e) => set('openings', Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
            </Field>
            <Field label="Salário">
              <input value={d.salary ?? ''} onChange={(e) => set('salary', e.target.value)} placeholder="Ex.: R$ 1.900 + gorjeta" className={inputCls} />
            </Field>
            <Field label="Situação">
              <select value={d.status} onChange={(e) => set('status', e.target.value as JobStatus)} className={inputCls}>
                {JOB_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Horário / escala">
            <input value={d.schedule ?? ''} onChange={(e) => set('schedule', e.target.value)} placeholder="Ex.: 6x1, das 17h às 23h, folga durante a semana" className={inputCls} />
          </Field>
          <Field label="Atividades da função">
            <textarea value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={3}
              placeholder="O que a pessoa vai fazer no dia a dia" className={areaCls} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="Requisitos obrigatórios">
              <textarea value={d.requirements ?? ''} onChange={(e) => set('requirements', e.target.value)} rows={3}
                placeholder="Ex.: experiência com atendimento, disponibilidade à noite e fins de semana" className={areaCls} />
            </Field>
            <Field label="Desejável (diferenciais)">
              <textarea value={d.desirable ?? ''} onChange={(e) => set('desirable', e.target.value)} rows={3}
                placeholder="Ex.: já ter trabalhado em restaurante, curso de manipulação de alimentos" className={areaCls} />
            </Field>
          </div>
          <Field label="Benefícios">
            <input value={d.benefits ?? ''} onChange={(e) => set('benefits', e.target.value)} placeholder="Ex.: VT, refeição no local, bônus por meta" className={inputCls} />
          </Field>
          <Field label="Observações internas (não vão para a IA)">
            <textarea value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={2} className={areaCls} />
          </Field>
          <p className="text-[11px] text-zinc-400">
            A IA compara cada currículo com estes dados e com o endereço e a descrição da loja (Configurações › Empresas).
            Idade, estado civil e filhos nunca entram na comparação.
          </p>
          {erro && <p className="text-xs text-red-600">{erro}</p>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-100">
          <button onClick={onClose} className="ml-auto px-4 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer">Cancelar</button>
          <button onClick={salvar} disabled={saving} className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-bold cursor-pointer">
            {saving ? 'Salvando…' : job ? 'Salvar' : 'Abrir vaga'}
          </button>
        </div>
      </div>
    </>
  );
}

const inputCls = 'w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:border-rose-300';
const areaCls = 'w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-white focus:outline-none focus:border-rose-300';
function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">{label}</span>
      {children}
    </label>
  );
}
