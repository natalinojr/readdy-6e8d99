// Aba Links WhatsApp: canais públicos (links wa.me com texto pronto e código). Quem manda mensagem
// com o código cai no atendimento público (edge canal-publico): recebe o currículo, tira dúvidas só
// com o que foi liberado aqui e avisa o dono no Telegram. O número é o mesmo do assistente.
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import { supabase } from '@/lib/supabase';
import { type Company, type Job, fmtDateTime } from '../shared';
import { confirmar, avisar } from '../dialog';

export interface BotChannel {
  id: string;
  purpose: 'curriculos';
  name: string;
  code: string;
  start_text: string;
  welcome: string | null;
  company_id: string | null;
  job_id: string | null;
  share_fields: string[];
  extra_info: string | null;
  forbidden: string | null;
  notify_owner: boolean;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
}
interface Conversation {
  id: string;
  channel_id: string | null;
  contact_jid: string;
  contact_phone: string | null;
  contact_name: string | null;
  status: 'aberta' | 'encerrada';
  is_test: boolean;
  candidate_ids: string[];
  model_calls: number;
  cost_usd: number;
  needs_human: boolean;
  last_message_at: string;
  created_at: string;
}
interface BotMessage { id: number; role: 'user' | 'assistant'; content: string; created_at: string }

const SHARE_OPTIONS: [string, string][] = [
  ['company', 'Empresa e endereço'], ['schedule', 'Horário / escala'], ['salary', 'Salário'], ['benefits', 'Benefícios'],
  ['contract_type', 'Tipo de contrato'], ['description', 'Atividades da função'], ['requirements', 'Requisitos'],
  ['desirable', 'Desejável'], ['openings', 'Nº de vagas'],
];
const DEFAULT_SHARE = ['company', 'schedule', 'contract_type', 'description', 'benefits'];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => `CV-${Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => ALPHA[b % ALPHA.length]).join('')}`;
// Divulga SEMPRE o wa.me direto: dentro do WhatsApp/Instagram só um link wa.me abre a conversa na hora.
// Link curto próprio (/v/CÓDIGO no vercel.json) passa pelo navegador e para na página "Continuar para
// a conversa" (teste do dono, 2026-09-14). Para o link ficar curto, a mensagem pronta é curta e sem acento.
const waLink = (num: string, text: string) => `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
// Curta e sem acento (cada acento vira %C3%xx no link). O atendente já sabe a vaga e a loja pelo código.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const defaultStart = (_job: Job | null, _company: Company | null, code: string) => `Quero me candidatar (${code})`;
const NUM_KEY = 'contratacao_wa_number';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };

export type EscopoWhatsApp = { tipo: 'vaga'; jobId: string; companyId: string | null } | { tipo: 'sem-vaga' };

interface Props {
  companies: Company[];
  jobs: Job[];
  onOpenCandidate: (id: string) => void;
  escopo: EscopoWhatsApp;
}

export default function LinksWhatsApp({ companies, jobs, onOpenCandidate, escopo }: Props) {
  const [channels, setChannels] = useState<BotChannel[]>([]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [number, setNumber] = useState<string>(() => lsGet(NUM_KEY) ?? '');
  const [numberAuto, setNumberAuto] = useState(false);
  const [editing, setEditing] = useState<{ ch: BotChannel | null } | null>(null);
  const [qr, setQr] = useState<BotChannel | null>(null);
  const [convsOf, setConvsOf] = useState<BotChannel | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [ch, cv] = await Promise.all([
      supabase.from('bot_channels').select('*').order('created_at', { ascending: false }),
      supabase.from('bot_conversations').select('*').order('last_message_at', { ascending: false }).limit(2000),
    ]);
    if (ch.error || cv.error) setErro((ch.error ?? cv.error)!.message);
    else { setChannels((ch.data ?? []) as BotChannel[]); setConvs((cv.data ?? []) as Conversation[]); setErro(null); }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Número do WhatsApp do assistente (Evolution). Se não vier, fica o digitado.
  useEffect(() => {
    supabase.functions.invoke('canal-publico', { body: { action: 'info' } }).then(({ data }) => {
      const n = String(data?.number ?? '').replace(/\D/g, '');
      if (n.length >= 10) { setNumber(n); setNumberAuto(true); lsSet(NUM_KEY, n); }
    }).catch(() => { /* fica o manual */ });
  }, []);

  const stats = useMemo(() => {
    const m = new Map<string, { conversas: number; curriculos: number; pendentes: number }>();
    for (const c of convs) {
      if (!c.channel_id || c.is_test) continue;
      const s = m.get(c.channel_id) ?? { conversas: 0, curriculos: 0, pendentes: 0 };
      s.conversas++; s.curriculos += c.candidate_ids?.length ?? 0; if (c.needs_human) s.pendentes++;
      m.set(c.channel_id, s);
    }
    return m;
  }, [convs]);

  const channelsDoEscopo = useMemo(
    () => channels.filter((ch) => (escopo.tipo === 'vaga' ? ch.job_id === escopo.jobId : !ch.job_id)),
    [channels, escopo],
  );

  const copiar = async (ch: BotChannel) => {
    if (!number) { avisar('Informe o número do WhatsApp do assistente primeiro.'); return; }
    try { await navigator.clipboard.writeText(waLink(number, ch.start_text)); setCopied(ch.id); setTimeout(() => setCopied(null), 1800); }
    catch { avisar('Não consegui copiar. Abra o QR Code e copie o link de lá.'); }
  };

  const salvar = async (d: Partial<BotChannel>): Promise<boolean> => {
    const row = { ...d, updated_at: new Date().toISOString() };
    // Só um canal padrão por vez.
    if (d.is_default) await supabase.from('bot_channels').update({ is_default: false }).eq('is_default', true).neq('id', d.id ?? '00000000-0000-0000-0000-000000000000');
    const { error } = d.id
      ? await supabase.from('bot_channels').update(row).eq('id', d.id)
      : await supabase.from('bot_channels').insert(row);
    if (error) { avisar(error.message.includes('duplicate') ? 'Esse código já existe. Gere outro.' : error.message); return false; }
    await carregar();
    return true;
  };

  const alternar = async (ch: BotChannel) => {
    const { error } = await supabase.from('bot_channels').update({ is_active: !ch.is_active, updated_at: new Date().toISOString() }).eq('id', ch.id);
    if (error) avisar(error.message); else setChannels((p) => p.map((c) => (c.id === ch.id ? { ...c, is_active: !c.is_active } : c)));
  };

  const excluir = async (ch: BotChannel) => {
    const ok = await confirmar({
      titulo: 'Excluir link?', perigo: true, confirmarLabel: 'Excluir',
      mensagem: 'Quem mandar mensagem com esse código não será mais atendido. As conversas continuam guardadas. Se só quiser parar por um tempo, use Pausar.',
    });
    if (!ok) return;
    const { error } = await supabase.from('bot_channels').delete().eq('id', ch.id);
    if (error) avisar(error.message); else setChannels((p) => p.filter((c) => c.id !== ch.id));
  };

  const nomeEmpresa = (id: string | null) => companies.find((c) => c.id === id)?.name ?? null;
  const tituloVaga = (id: string | null) => jobs.find((j) => j.id === id)?.title ?? null;

  return (
    <div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
        <i className="ri-whatsapp-line text-2xl text-emerald-600" />
        <div className="flex-1 min-w-[220px] text-sm text-emerald-900">
          <p className="font-bold">Links de candidatura pelo WhatsApp</p>
          <p className="text-xs text-emerald-800/80">
            Cada link abre o WhatsApp da pessoa com uma mensagem pronta. O atendente recebe o currículo (PDF ou foto), responde dúvidas só com o que você liberar e te avisa no Telegram.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
          Número
          <input value={number} onChange={(e) => { const n = e.target.value.replace(/\D/g, ''); setNumber(n); setNumberAuto(false); lsSet(NUM_KEY, n); }}
            placeholder="5541999999999" className="h-8 w-40 px-2 rounded-lg border border-emerald-200 bg-white text-xs" />
          {numberAuto && <i className="ri-checkbox-circle-fill text-emerald-600" title="Número lido do WhatsApp conectado" />}
        </label>
        <button onClick={() => setEditing({ ch: null })} className="flex items-center gap-1.5 px-4 h-9 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer">
          <i className="ri-add-line" /> Novo link
        </button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><div className="w-7 h-7 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : erro ? (
        <p className="py-10 text-center text-sm text-red-600">Erro ao carregar: {erro}</p>
      ) : channelsDoEscopo.length === 0 ? (
        <div className="py-16 text-center text-zinc-400">
          <i className="ri-links-line text-4xl" />
          <p className="text-sm font-semibold mt-2">Nenhum link criado</p>
          <p className="text-xs mt-1">Crie um link para uma vaga e divulgue no Instagram, grupos ou num QR Code na loja.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {channelsDoEscopo.map((ch) => {
            const s = stats.get(ch.id) ?? { conversas: 0, curriculos: 0, pendentes: 0 };
            const destino = [nomeEmpresa(ch.company_id), tituloVaga(ch.job_id)].filter(Boolean).join(' › ') || 'Banco de currículos (sem vaga)';
            return (
              <div key={ch.id} className={`p-4 rounded-2xl border bg-white ${ch.is_active ? 'border-zinc-200' : 'border-zinc-200 opacity-70'}`}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center flex-shrink-0">
                    <i className="ri-whatsapp-line text-lg" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-bold text-zinc-900 truncate">{ch.name}</p>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ch.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>{ch.is_active ? 'Ativo' : 'Pausado'}</span>
                      {ch.is_default && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-700" title="Atende também quem escreve sem código">Padrão</span>}
                    </div>
                    <p className="text-xs text-zinc-500 truncate">{destino}</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">Código <span className="font-mono font-bold text-zinc-600">{ch.code}</span></p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <Stat label="Conversas" value={s.conversas} />
                  <Stat label="Currículos" value={s.curriculos} />
                  <Stat label="Pedem atenção" value={s.pendentes} warn={s.pendentes > 0} />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <Btn icon={copied === ch.id ? 'ri-check-line' : 'ri-file-copy-line'} onClick={() => copiar(ch)}>{copied === ch.id ? 'Copiado' : 'Copiar link'}</Btn>
                  <Btn icon="ri-qr-code-line" onClick={() => setQr(ch)}>QR Code</Btn>
                  <Btn icon="ri-chat-3-line" onClick={() => setConvsOf(ch)}>Conversas</Btn>
                  <Btn icon="ri-pencil-line" onClick={() => setEditing({ ch })}>Editar</Btn>
                  <Btn icon={ch.is_active ? 'ri-pause-line' : 'ri-play-line'} onClick={() => alternar(ch)}>{ch.is_active ? 'Pausar' : 'Ativar'}</Btn>
                  <Btn icon="ri-delete-bin-6-line" danger onClick={() => excluir(ch)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-zinc-400 mt-4">
        Para testar do seu próprio celular, abra o link e mande a mensagem: o assistente entra em <b>modo teste</b> e responde como o candidato veria. Mande <b>#sair</b> para voltar ao assistente.
      </p>

      {editing && <CanalModal ch={editing.ch} companies={companies} jobs={jobs} escopo={escopo} onClose={() => setEditing(null)} onSave={salvar} />}
      {qr && <QrModal ch={qr} number={number} onClose={() => setQr(null)} />}
      {convsOf && <ConversasDrawer ch={convsOf} convs={convs.filter((c) => c.channel_id === convsOf.id)} onClose={() => setConvsOf(null)}
        onOpenCandidate={(id) => { setConvsOf(null); onOpenCandidate(id); }}
        onChanged={(c) => setConvs((p) => p.map((x) => (x.id === c.id ? c : x)))} />}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-xl py-1.5 ${warn ? 'bg-amber-50 text-amber-700' : 'bg-zinc-50 text-zinc-700'}`}>
      <p className="text-lg font-black leading-none">{value}</p>
      <p className="text-[10px] font-semibold opacity-70 mt-0.5">{label}</p>
    </div>
  );
}

function Btn({ icon, children, onClick, danger }: { icon: string; children?: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 px-2.5 h-8 rounded-lg border text-xs font-semibold cursor-pointer ${
      danger ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
      <i className={icon} />{children}
    </button>
  );
}

// ── Criar/editar link ──
function CanalModal({ ch, companies, jobs, escopo, onClose, onSave }: {
  ch: BotChannel | null; companies: Company[]; jobs: Job[]; escopo: EscopoWhatsApp; onClose: () => void; onSave: (d: Partial<BotChannel>) => Promise<boolean>;
}) {
  const [d, setD] = useState<Partial<BotChannel>>(() => ch ? { ...ch } : {
    purpose: 'curriculos', name: '', code: newCode(), start_text: '', welcome: '',
    company_id: escopo.tipo === 'vaga' ? escopo.companyId : (companies.find((c) => c.is_active)?.id ?? null),
    job_id: escopo.tipo === 'vaga' ? escopo.jobId : null,
    share_fields: DEFAULT_SHARE, extra_info: '', forbidden: '', notify_owner: true, is_active: true, is_default: false,
  });
  const [startEdited, setStartEdited] = useState(!!ch);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof BotChannel>(k: K, v: BotChannel[K] | null) => setD((x) => ({ ...x, [k]: v }));

  const company = companies.find((c) => c.id === d.company_id) ?? null;
  const vagas = jobs.filter((j) => (!d.company_id || j.company_id === d.company_id) && (j.status !== 'fechada' || j.id === d.job_id));
  const job = jobs.find((j) => j.id === d.job_id) ?? null;
  const startAuto = defaultStart(job, company, d.code ?? '');
  const start = startEdited ? (d.start_text ?? '') : startAuto;

  const salvar = async () => {
    const name = String(d.name ?? '').trim() || (job ? `Vaga ${job.title}` : 'Currículos');
    let startText = start.trim() || startAuto;
    if (!startText.toUpperCase().includes(String(d.code))) startText = `${startText} (código ${d.code})`;
    setSaving(true); setErro(null);
    const ok = await onSave({
      ...d, name, start_text: startText,
      welcome: String(d.welcome ?? '').trim() || null, extra_info: String(d.extra_info ?? '').trim() || null, forbidden: String(d.forbidden ?? '').trim() || null,
    });
    setSaving(false);
    if (ok) onClose();
  };

  const toggleShare = (k: string) => set('share_fields', (d.share_fields ?? []).includes(k) ? (d.share_fields ?? []).filter((x) => x !== k) : [...(d.share_fields ?? []), k]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-[70] w-full sm:max-w-2xl max-h-[94vh] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
          <i className="ri-whatsapp-line text-xl text-emerald-600" />
          <h2 className="flex-1 font-black text-zinc-900">{ch ? 'Editar link' : 'Novo link de currículos'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {escopo.tipo === 'vaga' ? (
            <p className="text-xs text-zinc-600 bg-zinc-50 rounded-lg px-3 py-2">
              <i className="ri-briefcase-4-line" /> Vaga: <b>{job?.title}</b>{company ? ` — ${company.name}` : ''}
            </p>
          ) : (
            <Field label="Empresa / loja">
              <select value={d.company_id ?? ''} onChange={(e) => set('company_id', e.target.value || null)} className={inputCls}>
                <option value="">Sem empresa</option>
                {companies.filter((c) => c.is_active || c.id === d.company_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="Nome do link (interno)" className="sm:col-span-2">
              <input value={d.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder={job ? `Vaga ${job.title}` : 'Ex.: Instagram — cozinha'} className={inputCls} />
            </Field>
            <Field label="Código">
              <div className="flex gap-1">
                <input value={d.code ?? ''} readOnly className={`${inputCls} font-mono`} />
                {!ch && <button onClick={() => set('code', newCode())} title="Gerar outro" className="px-2 rounded-lg border border-zinc-200 text-zinc-500 cursor-pointer"><i className="ri-refresh-line" /></button>}
              </div>
            </Field>
          </div>
          <Field label="Mensagem que já vem digitada no WhatsApp do candidato">
            <textarea value={start} onChange={(e) => { setStartEdited(true); set('start_text', e.target.value); }} rows={2} className={areaCls} />
            <span className="block text-[11px] text-zinc-400 mt-0.5">
              O código <b className="font-mono">{d.code}</b> precisa ficar no texto: é por ele que o atendente sabe de qual link a pessoa veio.
              {startEdited && <button onClick={() => setStartEdited(false)} className="ml-1 text-rose-600 font-semibold cursor-pointer">Voltar ao automático</button>}
            </span>
          </Field>
          <Field label="Primeira resposta (opcional)">
            <textarea value={d.welcome ?? ''} onChange={(e) => set('welcome', e.target.value)} rows={3}
              placeholder={'Em branco = "Olá! Por favor, nos envie seu currículo (pode ser em PDF, imagens ou em word)". Use {nome}, {empresa} e {vaga}.'} className={areaCls} />
          </Field>
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">O que o atendente pode contar sobre a vaga</span>
            <div className="flex flex-wrap gap-1.5">
              {SHARE_OPTIONS.map(([k, label]) => {
                const on = (d.share_fields ?? []).includes(k);
                return (
                  <button key={k} onClick={() => toggleShare(k)}
                    className={`px-2.5 h-8 rounded-full text-xs font-semibold border cursor-pointer ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-zinc-600 border-zinc-200'}`}>
                    {on && <i className="ri-check-line mr-1" />}{label}
                  </button>
                );
              })}
            </div>
            {!job && <p className="text-[11px] text-amber-600 mt-1">Sem vaga escolhida, só "Empresa e endereço" e as informações extras são usadas.</p>}
          </div>
          <Field label="Outras informações que ele pode dar">
            <textarea value={d.extra_info ?? ''} onChange={(e) => set('extra_info', e.target.value)} rows={2}
              placeholder="Ex.: entrevistas às terças à tarde; início imediato; não precisa de experiência" className={areaCls} />
          </Field>
          <Field label="Assuntos proibidos">
            <input value={d.forbidden ?? ''} onChange={(e) => set('forbidden', e.target.value)} placeholder="Ex.: salário, nomes de funcionários" className={inputCls} />
          </Field>
          <div className="space-y-2 pt-1">
            <Toggle on={!!d.notify_owner} onChange={(v) => set('notify_owner', v)} label="Me avisar no Telegram a cada currículo recebido" />
            {escopo.tipo !== 'vaga' && (
              <Toggle on={!!d.is_default} onChange={(v) => set('is_default', v)} label="Link padrão: atender também quem escrever no número SEM código" />
            )}
            <Toggle on={d.is_active !== false} onChange={(v) => set('is_active', v)} label="Ativo" />
          </div>
          <p className="text-[11px] text-zinc-400">
            O atendente nunca promete vaga, não pergunta idade, estado civil ou documentos e não tem acesso a nada além disto.
            Dúvida que ele não pode responder vira aviso para você no Telegram.
          </p>
          {erro && <p className="text-xs text-red-600">{erro}</p>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-100">
          <button onClick={onClose} className="ml-auto px-4 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer">Cancelar</button>
          <button onClick={salvar} disabled={saving} className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-bold cursor-pointer">
            {saving ? 'Salvando…' : ch ? 'Salvar' : 'Criar link'}
          </button>
        </div>
      </div>
    </>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer text-left">
      <span className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${on ? 'bg-emerald-500' : 'bg-zinc-300'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

// ── QR Code ──
function QrModal({ ch, number, onClose }: { ch: BotChannel; number: string; onClose: () => void }) {
  const link = number ? waLink(number, ch.start_text) : '';
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm bg-white rounded-2xl shadow-2xl p-6 text-center">
        <p className="font-black text-zinc-900">{ch.name}</p>
        <p className="text-xs text-zinc-500 mb-4">Aponte a câmera para mandar o currículo pelo WhatsApp</p>
        {link ? (
          <>
            <div className="bg-white p-3 rounded-xl border border-zinc-100 inline-block"><QRCode value={link} size={220} /></div>
            <p className="text-[11px] text-zinc-400 break-all mt-3">{link}</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => navigator.clipboard.writeText(link).catch(() => {})} className="flex-1 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer">Copiar link</button>
              <a href={link} target="_blank" rel="noreferrer" className="flex-1 h-9 rounded-lg bg-emerald-600 text-white text-sm font-bold flex items-center justify-center">Testar</a>
            </div>
            <p className="text-[11px] text-zinc-400 mt-3">Para imprimir, tire um print desta tela.</p>
          </>
        ) : <p className="text-sm text-amber-700">Informe o número do WhatsApp no topo da aba.</p>}
        <button onClick={onClose} className="mt-3 text-xs text-zinc-400 hover:text-zinc-700 cursor-pointer">Fechar</button>
      </div>
    </>
  );
}

// ── Conversas do link ──
function ConversasDrawer({ ch, convs, onClose, onOpenCandidate, onChanged }: {
  ch: BotChannel; convs: Conversation[]; onClose: () => void; onOpenCandidate: (id: string) => void; onChanged: (c: Conversation) => void;
}) {
  const [sel, setSel] = useState<Conversation | null>(null);
  const [msgs, setMsgs] = useState<BotMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  useEffect(() => {
    if (!sel) return;
    setLoadingMsgs(true);
    supabase.from('bot_messages').select('id, role, content, created_at').eq('conversation_id', sel.id).order('id').limit(500)
      .then(({ data }) => { setMsgs((data ?? []) as BotMessage[]); setLoadingMsgs(false); });
  }, [sel]);

  const resolver = async (c: Conversation) => {
    const { error } = await supabase.from('bot_conversations').update({ needs_human: false }).eq('id', c.id);
    if (error) { avisar(error.message); return; }
    const n = { ...c, needs_human: false };
    onChanged(n); setSel(n);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[70] w-full sm:max-w-lg bg-white shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
          {sel && <button onClick={() => setSel(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-arrow-left-line text-lg" /></button>}
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-zinc-900 truncate">{sel ? (sel.contact_name || `+${sel.contact_phone}`) : `Conversas — ${ch.name}`}</h2>
            {sel && <p className="text-xs text-zinc-400">+{sel.contact_phone} · {sel.status === 'aberta' ? 'aberta' : 'encerrada'}{sel.is_test ? ' · teste' : ''}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
        </div>

        {!sel ? (
          <div className="flex-1 overflow-y-auto divide-y divide-zinc-100">
            {convs.length === 0 && <p className="py-16 text-center text-sm text-zinc-400">Nenhuma conversa ainda.</p>}
            {convs.map((c) => (
              <button key={c.id} onClick={() => setSel(c)} className="w-full text-left px-5 py-3 hover:bg-zinc-50 cursor-pointer flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 flex-shrink-0"><i className="ri-user-line" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-zinc-800 truncate">{c.contact_name || `+${c.contact_phone}`}
                    {c.is_test && <span className="ml-1.5 text-[10px] font-bold text-sky-600">TESTE</span>}</p>
                  <p className="text-xs text-zinc-400">{fmtDateTime(c.last_message_at)} · {c.candidate_ids.length ? `${c.candidate_ids.length} currículo${c.candidate_ids.length > 1 ? 's' : ''}` : 'sem currículo'}</p>
                </div>
                {c.needs_human && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">Atenção</span>}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-[#efeae2]">
              {loadingMsgs ? <p className="text-center text-xs text-zinc-500 py-6">Carregando…</p> : msgs.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap shadow-sm ${m.role === 'user' ? 'bg-white text-zinc-800' : 'bg-[#d9fdd3] text-zinc-800'}`}>
                    {m.content}
                    <p className="text-[10px] text-zinc-400 text-right mt-0.5">{new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-zinc-100">
              {sel.candidate_ids.map((id, i) => (
                <button key={id} onClick={() => onOpenCandidate(id)} className="px-3 h-9 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer">
                  <i className="ri-user-search-line mr-1" />Abrir candidato{sel.candidate_ids.length > 1 ? ` ${i + 1}` : ''}
                </button>
              ))}
              {sel.contact_phone && (
                <a href={`https://wa.me/${sel.contact_phone}`} target="_blank" rel="noreferrer" className="px-3 h-9 rounded-lg border border-emerald-200 text-emerald-700 text-xs font-bold flex items-center">
                  <i className="ri-whatsapp-line mr-1" />Falar pelo meu WhatsApp
                </a>
              )}
              {sel.needs_human && <button onClick={() => resolver(sel)} className="px-3 h-9 rounded-lg border border-zinc-200 text-zinc-600 text-xs font-bold cursor-pointer">Marcar como resolvida</button>}
              <span className="ml-auto self-center text-[11px] text-zinc-400">IA: US$ {Number(sel.cost_usd).toFixed(4)}</span>
            </div>
          </>
        )}
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
