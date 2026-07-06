// Modal de edição de cadastro + CRM do cliente.
// Edita perfil (nome, celular, nascimento, gênero, email, CPF) e campos de
// relacionamento (anotações, tags manuais, aceite de marketing/LGPD).
import { useState } from 'react';
import type { ClienteCRM, ClientePatch } from '@/hooks/useClientes';

interface Props {
  cliente: ClienteCRM;
  onClose: () => void;
  onSave: (patch: ClientePatch) => Promise<void>;
}

const GENEROS = [
  { value: '', label: 'Não informar' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'feminino', label: 'Feminino' },
  { value: 'outro', label: 'Outro' },
];

export default function EditarClienteModal({ cliente, onClose, onSave }: Props) {
  const [nome, setNome] = useState(cliente.nome ?? '');
  const [celular, setCelular] = useState(cliente.celular ?? '');
  const [nascimento, setNascimento] = useState(cliente.dataNascimento ?? '');
  const [genero, setGenero] = useState(cliente.genero ?? '');
  const [email, setEmail] = useState(cliente.email ?? '');
  const [cpf, setCpf] = useState(cliente.cpf ?? '');
  const [notes, setNotes] = useState(cliente.notes ?? '');
  const [tags, setTags] = useState<string[]>(cliente.manualTags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [aceitaMkt, setAceitaMkt] = useState(cliente.aceitaMarketing);

  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t) && tags.length < 20) setTags((prev) => [...prev, t]);
    setTagInput('');
  };
  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));

  const salvar = async () => {
    setErro('');
    if (!nome.trim()) { setErro('O nome é obrigatório.'); return; }
    if (celular.replace(/\D/g, '').length < 10) { setErro('Celular inválido (mínimo 10 dígitos com DDD).'); return; }
    setSaving(true);
    try {
      await onSave({
        name: nome.trim(),
        phone: celular,
        birth_date: nascimento || null,
        gender: genero || null,
        email: email.trim() || null,
        cpf: cpf.trim() || null,
        notes: notes.trim() || null,
        manual_tags: tags,
        accepts_marketing: aceitaMkt,
      });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:border-amber-400 transition-colors';

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[94vw] max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-50 rounded-lg">
              <i className="ri-user-settings-line text-amber-600" />
            </div>
            <h3 className="text-sm font-bold text-zinc-900">Editar cliente</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {erro && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{erro}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Nome *</label>
              <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Celular *</label>
              <input className={inputCls} value={celular} onChange={(e) => setCelular(e.target.value)} placeholder="41999999999" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Nascimento</label>
              <input type="date" className={inputCls} value={nascimento ? nascimento.slice(0, 10) : ''} onChange={(e) => setNascimento(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Gênero</label>
              <select className={`${inputCls} cursor-pointer`} value={genero} onChange={(e) => setGenero(e.target.value)}>
                {GENEROS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-500 mb-1">CPF</label>
              <input className={inputCls} value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="opcional" />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold text-zinc-500 mb-1">E-mail</label>
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Anotações</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: alérgico a amendoim, prefere área externa, reclamou da demora em 05/07…"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Tags manuais</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                  {t}
                  <button onClick={() => removeTag(t)} className="hover:text-violet-900 cursor-pointer"><i className="ri-close-line text-[11px]" /></button>
                </span>
              ))}
              {tags.length === 0 && <span className="text-[11px] text-zinc-400">Nenhuma tag manual</span>}
            </div>
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Digite uma tag e pressione Enter"
              />
              <button onClick={addTag} className="px-3 py-2 rounded-lg border border-zinc-200 text-zinc-600 text-sm font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap">Adicionar</button>
            </div>
          </div>

          <label className="flex items-center gap-2.5 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg cursor-pointer">
            <input type="checkbox" checked={aceitaMkt} onChange={(e) => setAceitaMkt(e.target.checked)} className="w-4 h-4 accent-amber-500 cursor-pointer" />
            <div>
              <p className="text-xs font-semibold text-zinc-700">Aceita receber mensagens de marketing</p>
              <p className="text-[10px] text-zinc-400">Consentimento (LGPD). Usado para respeitar quem não quer ser contatado.</p>
            </div>
          </label>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-zinc-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-500 text-sm font-semibold hover:bg-zinc-50 cursor-pointer">Cancelar</button>
          <button
            onClick={salvar}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 cursor-pointer disabled:opacity-50"
          >
            {saving ? <><i className="ri-loader-4-line animate-spin" /> Salvando…</> : <><i className="ri-save-line" /> Salvar</>}
          </button>
        </div>
      </div>
    </>
  );
}
