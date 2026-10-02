import { useEffect, useMemo, useState } from 'react';
import { Mail, Send, Download, History, CalendarClock, Save } from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

// Configurações › Fiscal › Envio de XML para a contabilidade (2026-10-02).
// Tudo passa pela Edge `contabilidade-xml` (as tabelas não são lidas pelo navegador e a senha
// do e-mail fica no Vault). Regras do envio automático no cabeçalho da Edge.

interface Config {
  enabled: boolean;
  contador_nome: string;
  destinatarios: string;
  copia: string;
  dia_envio: number;
  incluir_nfce: boolean;
  incluir_nfe_entrada: boolean;
  incluir_nfse_tomada: boolean;
  mensagem: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_from_name: string;
}

interface Envio {
  id: string;
  competencia: string;
  origem: 'automatico' | 'manual';
  status: 'enviado' | 'erro' | 'vazio';
  destinatarios: string[];
  qtd_nfce: number;
  qtd_nfce_canceladas: number;
  qtd_nfe_entrada: number;
  qtd_nfse_tomada: number;
  tamanho_bytes: number | null;
  tem_arquivo: boolean;
  erro: string | null;
  created_at: string;
}

interface Previa { competencia: string; qtd_nfce: number; qtd_nfce_canceladas: number; qtd_nfe_entrada: number; qtd_nfse_tomada: number }

interface Resp<T> { success: boolean; error?: string; data?: T; url?: string }

const GMAIL_HOST = 'smtp.gmail.com';
const VAZIO: Config = {
  enabled: false, contador_nome: '', destinatarios: '', copia: '', dia_envio: 5,
  incluir_nfce: true, incluir_nfe_entrada: true, incluir_nfse_tomada: true, mensagem: '',
  smtp_host: GMAIL_HOST, smtp_port: 465, smtp_user: '', smtp_from_name: '',
};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (comp: string) => { const [a, m] = comp.split('-').map(Number); return `${MESES[m - 1]}/${a}`; };
const mesAnterior = (comp: string) => { const [a, m] = comp.split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; };
const mesSeguinte = (comp: string) => { const [a, m] = comp.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; };
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

const inputCls = 'w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 disabled:bg-zinc-50';
const labelCls = 'block text-xs font-semibold text-zinc-600 mb-1.5';
const btnSec = 'flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap';

function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer select-none ${checked ? 'border-amber-200 bg-amber-50/50' : 'border-zinc-200'}`}>
      <input type="checkbox" className="mt-0.5 accent-amber-500 w-4 h-4 cursor-pointer" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span>
        <span className="block text-sm font-medium text-zinc-800">{label}</span>
        <span className="block text-xs text-zinc-400">{hint}</span>
      </span>
    </label>
  );
}

function resumoQtd(p: Pick<Previa, 'qtd_nfce' | 'qtd_nfce_canceladas' | 'qtd_nfe_entrada' | 'qtd_nfse_tomada'>) {
  const partes = [
    `${p.qtd_nfce} NFC-e${p.qtd_nfce_canceladas ? ` (+${p.qtd_nfce_canceladas} cancelada${p.qtd_nfce_canceladas > 1 ? 's' : ''})` : ''}`,
    `${p.qtd_nfe_entrada} NF-e de entrada`,
    `${p.qtd_nfse_tomada} NFS-e tomada${p.qtd_nfse_tomada === 1 ? '' : 's'}`,
  ];
  return partes.join(' · ');
}

export default function EnvioXmlContabilidade() {
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const tenantId = user?.tenantId ?? null;

  const [form, setForm] = useState<Config>(VAZIO);
  const [salvo, setSalvo] = useState<Config>(VAZIO);
  const [temSenha, setTemSenha] = useState(false);
  const [senha, setSenha] = useState('');
  const [provedor, setProvedor] = useState<'gmail' | 'outro'>('gmail');
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [hoje, setHoje] = useState<string>(new Date().toISOString().slice(0, 10));
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | 'salvar' | 'testar' | 'enviar'>(null);
  const [resultadoTeste, setResultadoTeste] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mesEnvio, setMesEnvio] = useState('');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [verComoGerar, setVerComoGerar] = useState(false);

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setForm((f) => ({ ...f, [k]: v }));
  const call = <T,>(body: Record<string, unknown>) => invokeWithAuth<Resp<T>>('contabilidade-xml', { body: { tenant_id: tenantId, ...body } });

  const carregar = async () => {
    if (!tenantId) return;
    const { data, error } = await call<{ config: (Partial<Config> & { tem_senha?: boolean; destinatarios?: string[]; copia?: string[] }) | null; envios: Envio[]; previa: Previa; hoje: string; email_loja: string | null; pode_editar: boolean }>({ action: 'get' });
    if (error || !data?.success || !data.data) { setErroCarga(error?.message || data?.error || 'Não consegui carregar'); setCarregando(false); return; }
    const d = data.data;
    const c = d.config;
    const cfg: Config = c ? {
      enabled: !!c.enabled,
      contador_nome: c.contador_nome ?? '',
      destinatarios: (c.destinatarios ?? []).join(', '),
      copia: (c.copia ?? []).join(', '),
      dia_envio: Number(c.dia_envio) || 5,
      incluir_nfce: c.incluir_nfce !== false,
      incluir_nfe_entrada: c.incluir_nfe_entrada !== false,
      incluir_nfse_tomada: c.incluir_nfse_tomada !== false,
      mensagem: c.mensagem ?? '',
      smtp_host: c.smtp_host ?? GMAIL_HOST,
      smtp_port: Number(c.smtp_port) || 465,
      smtp_user: c.smtp_user ?? '',
      smtp_from_name: c.smtp_from_name ?? '',
    } : { ...VAZIO, smtp_user: d.email_loja ?? '' };
    setForm(cfg);
    setSalvo(cfg);
    setTemSenha(!!c?.tem_senha);
    setProvedor(!cfg.smtp_host || cfg.smtp_host === GMAIL_HOST ? 'gmail' : 'outro');
    setEnvios(d.envios ?? []);
    setHoje(d.hoje);
    setPodeEditar(d.pode_editar);
    setPrevia(d.previa);
    setMesEnvio((m) => m || d.previa.competencia);
    setErroCarga(null);
    setCarregando(false);
  };

  useEffect(() => { setCarregando(true); carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  // Prévia do mês escolhido para "Enviar agora" (a do mês passado já vem no get).
  useEffect(() => {
    if (!mesEnvio || previa?.competencia === mesEnvio) return;
    let vivo = true;
    call<Previa>({ action: 'previa', competencia: mesEnvio }).then(({ data }) => { if (vivo && data?.success && data.data) setPrevia(data.data); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesEnvio]);

  const mesesFechados = useMemo(() => {
    const out: string[] = [];
    let c = mesAnterior(hoje.slice(0, 7));
    for (let i = 0; i < 12; i++) { out.push(c); c = mesAnterior(c); }
    return out;
  }, [hoje]);

  const alterado = JSON.stringify(form) !== JSON.stringify(salvo) || !!senha.trim();

  const proximo = useMemo(() => {
    if (!salvo.enabled) return null;
    const compAnt = mesAnterior(hoje.slice(0, 7));
    const doMes = envios.filter((e) => e.competencia.slice(0, 7) === compAnt);
    const dia = Number(hoje.slice(8, 10));
    if (doMes.some((e) => e.status === 'enviado' || e.status === 'vazio')) {
      const prox = mesSeguinte(hoje.slice(0, 7));
      return { quando: `${String(salvo.dia_envio).padStart(2, '0')}/${prox.slice(5)}/${prox.slice(0, 4)} às 08h10`, mes: nomeMes(hoje.slice(0, 7)), parado: false };
    }
    if (doMes.filter((e) => e.origem === 'automatico' && e.status === 'erro').length >= 3) {
      return { quando: '', mes: nomeMes(compAnt), parado: true };
    }
    if (dia < salvo.dia_envio) return { quando: `${String(salvo.dia_envio).padStart(2, '0')}/${hoje.slice(5, 7)}/${hoje.slice(0, 4)} às 08h10`, mes: nomeMes(compAnt), parado: false };
    const agora = new Date();
    const aindaHoje = agora.getHours() < 8 || (agora.getHours() === 8 && agora.getMinutes() < 10);
    return { quando: aindaHoje ? 'hoje às 08h10' : 'amanhã às 08h10', mes: nomeMes(compAnt), parado: false };
  }, [salvo, envios, hoje]);

  const payloadConfig = () => ({
    ...form,
    smtp_host: provedor === 'gmail' ? GMAIL_HOST : form.smtp_host,
    smtp_port: provedor === 'gmail' ? 465 : form.smtp_port,
  });

  const salvar = async (): Promise<boolean> => {
    setOcupado('salvar');
    const { data, error } = await call<{ config: { tem_senha?: boolean } }>({ action: 'salvar', config: payloadConfig(), senha: senha.trim() || undefined });
    setOcupado(null);
    if (error || !data?.success) { toastError('Não salvou', error?.message || data?.error || 'Tente novamente'); return false; }
    setSenha('');
    toastSuccess('Envio para a contabilidade salvo');
    await carregar();
    return true;
  };

  const testar = async () => {
    setResultadoTeste(null);
    if (alterado) { const ok = await salvar(); if (!ok) return; }
    setOcupado('testar');
    const { data, error } = await call<{ enviado_para: string }>({ action: 'testar_email' });
    setOcupado(null);
    if (error || !data?.success) { setResultadoTeste({ ok: false, msg: error?.message || data?.error || 'Falhou' }); return; }
    setResultadoTeste({ ok: true, msg: `E-mail de teste enviado para ${data.data?.enviado_para}. Confira a caixa de entrada.` });
  };

  const enviarAgora = async () => {
    setConfirmando(false);
    setOcupado('enviar');
    const { data, error } = await call<{ envio: Envio }>({ action: 'enviar_xml_mes', competencia: mesEnvio });
    setOcupado(null);
    if (error || !data?.success) toastError('Não enviou', error?.message || data?.error || 'Tente novamente');
    else if (data.data?.envio?.status === 'vazio') toastSuccess('Nada para enviar', `Não há XML de ${nomeMes(mesEnvio)}.`);
    else toastSuccess('XMLs enviados', `${nomeMes(mesEnvio)} foi para ${salvo.destinatarios}.`);
    await carregar();
  };

  const baixar = async (e: Envio) => {
    const { data, error } = await call<never>({ action: 'baixar', envio_id: e.id });
    if (error || !data?.success || !data.url) { toastError('Arquivo indisponível', error?.message || data?.error); return; }
    window.open(data.url, '_blank', 'noopener');
  };

  if (!tenantId) return null;

  return (
    <div className="bg-white rounded-xl border border-zinc-100 p-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 flex items-center justify-center bg-amber-50 text-amber-600 rounded-lg"><Mail size={14} /></div>
        <h3 className="text-sm font-bold text-zinc-800">Envio de XML para a contabilidade</h3>
      </div>
      <p className="text-xs text-zinc-400 mb-4 ml-9">
        Todo mês, no dia escolhido, o ERPOS junta os XMLs do mês anterior num arquivo .zip e manda por e-mail para a contabilidade,
        saindo do e-mail da própria loja.
      </p>

      {carregando && <p className="text-sm text-zinc-400">Carregando…</p>}
      {!carregando && erroCarga && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">{erroCarga}</p>
      )}

      {!carregando && !erroCarga && (
        <div className="space-y-5">
          {/* Situação */}
          <div className={`rounded-lg border p-3 flex items-start gap-2.5 ${salvo.enabled ? (proximo?.parado ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100') : 'bg-zinc-50 border-zinc-200'}`}>
            <CalendarClock size={16} className={`mt-0.5 flex-shrink-0 ${salvo.enabled ? (proximo?.parado ? 'text-red-500' : 'text-emerald-600') : 'text-zinc-400'}`} />
            <div className="text-xs text-zinc-600 min-w-0">
              {!salvo.enabled && <p><b className="text-zinc-800">Envio automático desligado.</b> Preencha abaixo, mande um e-mail de teste e ligue.</p>}
              {salvo.enabled && proximo && !proximo.parado && (
                <p><b className="text-zinc-800">Ligado.</b> Próximo envio: <b>{proximo.quando}</b>, com os XMLs de {proximo.mes}, para <span className="break-all">{salvo.destinatarios}</span>.</p>
              )}
              {salvo.enabled && proximo?.parado && (
                <p><b className="text-red-700">O envio de {proximo.mes} falhou 3 vezes e parou.</b> Veja o erro no histórico, corrija e use “Enviar agora”.</p>
              )}
            </div>
          </div>

          {!podeEditar && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">Só administradores e gerentes alteram o envio.</p>
          )}

          {/* Para quem */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2">Para quem vai</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Contabilidade / contador(a)</label>
                <input className={inputCls} value={form.contador_nome} onChange={(e) => set('contador_nome', e.target.value)} disabled={!podeEditar} placeholder="Ex.: Celina Contabilidade" />
              </div>
              <div>
                <label className={labelCls}>E-mail da contabilidade</label>
                <input className={inputCls} type="text" inputMode="email" value={form.destinatarios} onChange={(e) => set('destinatarios', e.target.value)} disabled={!podeEditar} placeholder="fiscal@contabilidade.com.br" />
                <p className="text-[11px] text-zinc-400 mt-1">Mais de um? Separe por vírgula.</p>
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Cópia para <span className="text-zinc-400 font-normal">opcional — quem da loja acompanha</span></label>
                <input className={inputCls} type="text" inputMode="email" value={form.copia} onChange={(e) => set('copia', e.target.value)} disabled={!podeEditar} placeholder="dono@loja.com.br" />
              </div>
            </div>
          </div>

          {/* Quando e o quê */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2">Quando e o que vai</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Dia do mês</label>
                <select className={`${inputCls} cursor-pointer`} value={form.dia_envio} onChange={(e) => set('dia_envio', Number(e.target.value))} disabled={!podeEditar}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Dia {d}</option>)}
                </select>
                <p className="text-[11px] text-zinc-400 mt-1">Às 08h10. Vai o mês anterior inteiro. Dia 5 dá tempo das notas de fornecedor do fim do mês chegarem.</p>
              </div>
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Check checked={form.incluir_nfce} onChange={(v) => set('incluir_nfce', v)} disabled={!podeEditar} label="NFC-e emitidas" hint="Vendas, autorizadas e canceladas (só produção)" />
                <Check checked={form.incluir_nfe_entrada} onChange={(v) => set('incluir_nfe_entrada', v)} disabled={!podeEditar} label="NF-e de entrada" hint="Notas dos fornecedores" />
                <Check checked={form.incluir_nfse_tomada} onChange={(v) => set('incluir_nfse_tomada', v)} disabled={!podeEditar} label="NFS-e tomadas" hint="Serviços contratados pela loja" />
              </div>
              <div className="md:col-span-3">
                <label className={labelCls}>Recado no e-mail <span className="text-zinc-400 font-normal">opcional</span></label>
                <textarea className={`${inputCls} resize-y min-h-[60px]`} value={form.mensagem} onChange={(e) => set('mensagem', e.target.value)} disabled={!podeEditar} maxLength={1000} placeholder="Ex.: As notas de entrada também estão lançadas no Financeiro do ERPOS." />
              </div>
            </div>
          </div>

          {/* De onde sai */}
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2">De qual e-mail sai</p>
            <div className="flex gap-2 mb-3">
              {(['gmail', 'outro'] as const).map((p) => (
                <button key={p} type="button" disabled={!podeEditar}
                  onClick={() => { setProvedor(p); if (p === 'outro' && form.smtp_host === GMAIL_HOST) set('smtp_host', ''); if (p === 'gmail') set('smtp_port', 465); }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer disabled:opacity-50 ${provedor === p ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'}`}>
                  {p === 'gmail' ? 'Gmail' : 'Outro servidor (SMTP)'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>E-mail que envia</label>
                <input className={inputCls} type="text" inputMode="email" autoComplete="off" value={form.smtp_user} onChange={(e) => set('smtp_user', e.target.value.trim())} disabled={!podeEditar} placeholder={provedor === 'gmail' ? 'loja@gmail.com' : 'fiscal@sualoja.com.br'} />
              </div>
              <div>
                <label className={labelCls}>
                  {provedor === 'gmail' ? 'Senha de app do Gmail' : 'Senha do e-mail'}
                  {temSenha && <span className="text-emerald-600 font-normal"> · já salva (digite só para trocar)</span>}
                </label>
                <input className={inputCls} type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} disabled={!podeEditar} placeholder={temSenha ? '••••••••••••••••' : provedor === 'gmail' ? '16 letras (xxxx xxxx xxxx xxxx)' : 'Senha'} />
              </div>
              {provedor === 'outro' && (
                <>
                  <div>
                    <label className={labelCls}>Servidor SMTP</label>
                    <input className={inputCls} value={form.smtp_host} onChange={(e) => set('smtp_host', e.target.value.trim())} disabled={!podeEditar} placeholder="smtp.seudominio.com.br" />
                  </div>
                  <div>
                    <label className={labelCls}>Porta (SSL)</label>
                    <input className={inputCls} type="number" value={form.smtp_port} onChange={(e) => set('smtp_port', Number(e.target.value) || 465)} disabled={!podeEditar} />
                    <p className="text-[11px] text-zinc-400 mt-1">Só funciona a 465 (SSL). Outlook/Hotmail não aceita esse tipo de envio.</p>
                  </div>
                </>
              )}
              <div>
                <label className={labelCls}>Nome que aparece <span className="text-zinc-400 font-normal">opcional</span></label>
                <input className={inputCls} value={form.smtp_from_name} onChange={(e) => set('smtp_from_name', e.target.value)} disabled={!podeEditar} placeholder="Ex.: El Patrón Paranaguá" />
              </div>
            </div>

            {provedor === 'gmail' && (
              <div className="mt-3">
                <button type="button" onClick={() => setVerComoGerar((v) => !v)} className="text-xs font-semibold text-amber-600 hover:text-amber-700 cursor-pointer">
                  {verComoGerar ? '▾' : '▸'} Como gerar a senha de app no Gmail
                </button>
                {verComoGerar && (
                  <ol className="mt-2 text-xs text-zinc-600 space-y-1 list-decimal ml-5">
                    <li>Entre na conta Google do e-mail que vai enviar e ligue a <b>Verificação em duas etapas</b> (myaccount.google.com › Segurança).</li>
                    <li>Abra <a className="text-amber-600 underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">myaccount.google.com/apppasswords</a>.</li>
                    <li>Dê o nome <b>ERPOS</b> e toque em Criar. Copie as 16 letras e cole no campo acima.</li>
                    <li>A senha normal da conta não funciona aqui — só a senha de app. Se trocar a senha da conta, gere outra.</li>
                  </ol>
                )}
              </div>
            )}
          </div>

          {podeEditar && (
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <button type="button" onClick={() => set('enabled', !form.enabled)}
                  className={`mt-0.5 w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${form.enabled ? 'bg-emerald-500' : 'bg-zinc-300'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <span>
                  <span className="block text-sm font-medium text-zinc-800">Mandar automaticamente todo mês</span>
                  <span className="block text-xs text-zinc-400">Desligado, nada sai sozinho — dá para mandar pelo “Enviar agora”.</span>
                </span>
              </label>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-end">
                <button onClick={testar} disabled={ocupado !== null || !form.smtp_user || (!temSenha && !senha.trim())} className={btnSec}>
                  <Send size={14} /> {ocupado === 'testar' ? 'Enviando teste…' : 'Mandar e-mail de teste'}
                </button>
                <button onClick={() => salvar()} disabled={ocupado !== null || !alterado}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
                  <Save size={15} /> {ocupado === 'salvar' ? 'Salvando…' : 'Salvar envio'}
                </button>
              </div>
              {resultadoTeste && (
                <p className={`text-xs font-medium ${resultadoTeste.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                  <i className={`${resultadoTeste.ok ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} mr-1`} />{resultadoTeste.msg}
                </p>
              )}
            </div>
          )}

          {/* Enviar agora */}
          <div className="border-t border-zinc-100 pt-4">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2">Enviar agora</p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <select className={`${inputCls} sm:w-56 cursor-pointer`} value={mesEnvio} onChange={(e) => { setMesEnvio(e.target.value); setConfirmando(false); }}>
                {mesesFechados.map((c) => <option key={c} value={c}>{nomeMes(c)}</option>)}
              </select>
              {!confirmando ? (
                <button onClick={() => setConfirmando(true)} disabled={!podeEditar || ocupado !== null || !salvo.destinatarios || !temSenha} className={btnSec}>
                  <Send size={14} /> {ocupado === 'enviar' ? 'Enviando…' : 'Enviar este mês'}
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={enviarAgora} className="flex-1 sm:flex-none px-4 py-2 text-xs font-semibold rounded-lg text-white bg-amber-500 hover:bg-amber-600 cursor-pointer whitespace-nowrap">Confirmar envio</button>
                  <button onClick={() => setConfirmando(false)} className={btnSec}>Cancelar</button>
                </div>
              )}
            </div>
            {previa?.competencia === mesEnvio && (
              <p className="text-xs text-zinc-500 mt-2">
                {nomeMes(mesEnvio)}: {resumoQtd(previa)}.
                {confirmando && <> Vai para <b className="break-all">{salvo.destinatarios}</b>{salvo.copia ? <> (cópia: <span className="break-all">{salvo.copia}</span>)</> : null}.</>}
              </p>
            )}
            {podeEditar && (!salvo.destinatarios || !temSenha) && (
              <p className="text-[11px] text-zinc-400 mt-1">Salve o e-mail da contabilidade e a senha do e-mail antes de enviar.</p>
            )}
          </div>

          {/* Histórico */}
          <div className="border-t border-zinc-100 pt-4">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><History size={13} /> Histórico</p>
            {envios.length === 0 && <p className="text-xs text-zinc-400">Nenhum envio ainda.</p>}
            <ul className="divide-y divide-zinc-100">
              {envios.map((e) => (
                <li key={e.id} className="py-2.5 flex items-start gap-3">
                  <span className={`mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${e.status === 'enviado' ? 'bg-emerald-50 text-emerald-700' : e.status === 'erro' ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-500'}`}>
                    {e.status === 'enviado' ? 'Enviado' : e.status === 'erro' ? 'Erro' : 'Sem notas'}
                  </span>
                  <div className="flex-1 min-w-0 text-xs">
                    <p className="text-zinc-800">
                      <b>{nomeMes(e.competencia.slice(0, 7))}</b>
                      <span className="text-zinc-400"> · {dataHora(e.created_at)} · {e.origem === 'automatico' ? 'automático' : 'manual'}</span>
                    </p>
                    {e.status === 'enviado' && <p className="text-zinc-500">{resumoQtd(e)} → <span className="break-all">{e.destinatarios.join(', ')}</span></p>}
                    {e.status === 'erro' && <p className="text-red-600 break-words">{e.erro}</p>}
                  </div>
                  {e.tem_arquivo && (
                    <button onClick={() => baixar(e)} title="Baixar o .zip enviado" className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer flex-shrink-0">
                      <Download size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
