import { useEffect, useState } from 'react';
import { FileCheck2, Save, Wifi, ShieldCheck, Printer } from 'lucide-react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useImpressoras } from '@/contexts/ImpressorasContext';
import { CSOSN_OPTIONS, CST_ICMS_OPTIONS, CFOP_OPTIONS, NCM_SUGESTOES, type FiscalSettingsRow } from '@/lib/fiscal';

const estadosBR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

type Form = Omit<FiscalSettingsRow, 'tenant_id' | 'provider'> & { provider_token: string };

const EMPTY: Form = {
  enabled: false, has_token: false, environment: 2, provider_token: '',
  razao_social: '', inscricao_estadual: '', crt: 1,
  endereco_logradouro: '', endereco_numero: '', endereco_bairro: '', endereco_municipio: '', endereco_uf: 'PR', endereco_cep: '', codigo_municipio_ibge: '',
  natureza_operacao: 'VENDA DE MERCADORIA', ncm_padrao: '21069090', cfop_padrao: 5102, csosn_padrao: '102', cst_icms_padrao: '00', icms_aliquota_padrao: null,
  origem_padrao: 0, pis_cst_padrao: '49', cofins_cst_padrao: '49', cod_tributacao_padrao: '', serie: null,
  print_danfe: true, danfe_printer_id: '', emit_on_delivery: true, emit_on_counter: true, emit_on_table_close: true,
};

// Colunas lidas pelo front (o token nunca é selecionável pelo navegador).
const SELECT_COLS = 'tenant_id, enabled, provider, environment, razao_social, inscricao_estadual, crt, endereco_logradouro, endereco_numero, endereco_bairro, endereco_municipio, endereco_uf, endereco_cep, codigo_municipio_ibge, natureza_operacao, ncm_padrao, cfop_padrao, csosn_padrao, cst_icms_padrao, icms_aliquota_padrao, origem_padrao, pis_cst_padrao, cofins_cst_padrao, cod_tributacao_padrao, serie, print_danfe, danfe_printer_id, emit_on_delivery, emit_on_counter, emit_on_table_close';

const inputCls = 'w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400';
const labelCls = 'block text-xs font-semibold text-zinc-600 mb-1.5';

function Section({ title, icon, children, desc }: { title: string; icon: React.ReactNode; desc?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-zinc-100 p-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 flex items-center justify-center bg-amber-50 text-amber-600 rounded-lg">{icon}</div>
        <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
      </div>
      {desc && <p className="text-xs text-zinc-400 mb-4 ml-9">{desc}</p>}
      {!desc && <div className="mb-4" />}
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button type="button" onClick={() => onChange(!checked)}
        className={`mt-0.5 w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${checked ? 'bg-emerald-500' : 'bg-zinc-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span>
        <span className="block text-sm font-medium text-zinc-800">{label}</span>
        {hint && <span className="block text-xs text-zinc-400">{hint}</span>}
      </span>
    </label>
  );
}

export default function FiscalTab() {
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const { impressoras } = useImpressoras();
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const podeEditar = user?.perfil === 'admin' || user?.perfil === 'gerente';

  useEffect(() => {
    if (!user?.tenantId) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase.from('fiscal_settings').select(SELECT_COLS).eq('tenant_id', user.tenantId).maybeSingle();
      // has_token não é coluna: pergunta à Edge Function (que enxerga o token) só quando existe linha.
      if (data) {
        const row = data as unknown as FiscalSettingsRow;
        setForm(f => ({ ...f, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)) as Partial<Form>, provider_token: '' }));
        const { data: st } = await invokeWithAuth<{ success: boolean; data?: { has_token?: boolean } | null }>('fiscal-write', { body: { action: 'get_settings', tenant_id: user.tenantId } }).catch(() => ({ data: null }));
        setHasToken(Boolean(st?.data?.has_token));
      } else {
        // Pré-preenche endereço/UF com os dados da loja
        const { data: t } = await supabase.from('tenants').select('name, address, city, state, zip_code').eq('id', user.tenantId).maybeSingle();
        if (t) setForm(f => ({ ...f, razao_social: t.name ?? '', endereco_logradouro: t.address ?? '', endereco_municipio: t.city ?? '', endereco_uf: t.state ?? 'PR', endereco_cep: t.zip_code ?? '' }));
      }
      setLoading(false);
    })();
  }, [user?.tenantId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

  const salvar = async (): Promise<boolean> => {
    if (!user?.tenantId) return false;
    setSaving(true);
    const { provider_token, has_token: _h, ...rest } = form;
    const settings: Record<string, unknown> = { ...rest };
    if (provider_token.trim()) settings.provider_token = provider_token.trim();
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string; data?: { has_token?: boolean } }>('fiscal-write', {
      body: { action: 'save_settings', tenant_id: user.tenantId, settings },
    });
    setSaving(false);
    if (error || !data?.success) {
      toastError('Erro ao salvar', error?.message || data?.error || 'Tente novamente');
      return false;
    }
    setHasToken(Boolean(data.data?.has_token));
    set('provider_token', '');
    toastSuccess('Configuração fiscal salva');
    return true;
  };

  const testar = async () => {
    if (!user?.tenantId) return;
    setTesting(true);
    setTestResult(null);
    if (form.provider_token.trim()) { const ok = await salvar(); if (!ok) { setTesting(false); return; } }
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string; data?: Record<string, unknown> }>('fiscal-write', {
      body: { action: 'test_connection', tenant_id: user.tenantId },
    });
    setTesting(false);
    if (error || !data?.success) {
      setTestResult({ ok: false, msg: error?.message || data?.error || 'Falha na consulta' });
      return;
    }
    const d = data.data ?? {};
    const msg = String(d.DsStatusRespostaSefaz ?? d.DsMotivo ?? d.Message ?? d.message ?? 'SEFAZ respondeu');
    setTestResult({ ok: true, msg: `${msg}${d.DsAmbiente ? ` (${d.DsAmbiente})` : ''}` });
  };

  if (loading) return <div className="text-sm text-zinc-400 p-6">Carregando…</div>;

  const isSimples = form.crt === 1 || form.crt === 4;

  return (
    <div className="max-w-4xl space-y-4">
      {/* Cabeçalho / status */}
      <div className={`rounded-xl border p-4 flex items-start gap-3 ${form.enabled ? 'bg-emerald-50 border-emerald-100' : 'bg-zinc-50 border-zinc-200'}`}>
        <FileCheck2 size={18} className={form.enabled ? 'text-emerald-600 mt-0.5' : 'text-zinc-400 mt-0.5'} />
        <div className="flex-1">
          <p className="text-sm font-bold text-zinc-800">
            NFC-e {form.enabled ? 'ligada' : 'desligada'} · ambiente de {form.environment === 1 ? 'PRODUÇÃO' : 'homologação (testes)'}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Uma nota por pedido, no momento do pagamento, em todos os canais (balcão, delivery, QR das mesas e mesa numerada).
            {' '}Provedor: Brasil NFe {hasToken ? '(token configurado)' : '(sem token)'}.
          </p>
        </div>
      </div>

      {!podeEditar && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">Apenas administradores e gerentes podem alterar a configuração fiscal.</p>
      )}

      <Section title="Provedor (Brasil NFe)" icon={<ShieldCheck size={14} />}
        desc="Cadastre a empresa, o certificado A1 e o CSC no painel do Brasil NFe. Cole aqui o Token da empresa gerado lá.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className={labelCls}>Token da empresa {hasToken && <span className="text-emerald-600 font-normal">· já salvo (cole outro só para trocar)</span>}</label>
            <input className={inputCls} type="password" autoComplete="off" placeholder={hasToken ? '••••••••••••••••' : 'Cole o Token do painel'} value={form.provider_token} onChange={e => set('provider_token', e.target.value)} disabled={!podeEditar} />
          </div>
          <div>
            <label className={labelCls}>Ambiente</label>
            <select className={`${inputCls} cursor-pointer`} value={form.environment} onChange={e => set('environment', Number(e.target.value))} disabled={!podeEditar}>
              <option value={2}>Homologação (testes, sem valor fiscal)</option>
              <option value={1}>Produção (valor fiscal real)</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button onClick={testar} disabled={testing || (!hasToken && !form.provider_token.trim())}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            <Wifi size={14} /> {testing ? 'Consultando SEFAZ…' : 'Testar conexão com a SEFAZ'}
          </button>
          {testResult && (
            <span className={`text-xs font-medium ${testResult.ok ? 'text-emerald-600' : 'text-red-600'}`}>
              <i className={`${testResult.ok ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} mr-1`} />{testResult.msg}
            </span>
          )}
        </div>
      </Section>

      <Section title="Emissão automática" icon={<FileCheck2 size={14} />}>
        <div className="space-y-4">
          <Toggle checked={form.enabled} onChange={v => set('enabled', v)} label="Emitir NFC-e automaticamente a cada venda"
            hint="Desligado: nada é emitido (pode emitir manualmente em Pedidos › Notas Fiscais)." />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pl-1">
            <Toggle checked={form.emit_on_counter} onChange={v => set('emit_on_counter', v)} label="Balcão / PDV Caixa" hint="Ao concluir o pagamento" />
            <Toggle checked={form.emit_on_delivery} onChange={v => set('emit_on_delivery', v)} label="Delivery" hint="Ao registrar o pagamento" />
            <Toggle checked={form.emit_on_table_close} onChange={v => set('emit_on_table_close', v)} label="Mesas e QR universal" hint="Ao pagar o pedido no caixa" />
          </div>
        </div>
      </Section>

      <Section title="Dados do emitente" icon={<ShieldCheck size={14} />}
        desc="Usados no cupom impresso (DANFE). O CNPJ vem de Dados da Loja; o cadastro oficial é o do painel do provedor.">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="md:col-span-4">
            <label className={labelCls}>Razão social</label>
            <input className={inputCls} value={form.razao_social ?? ''} onChange={e => set('razao_social', e.target.value)} disabled={!podeEditar} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Inscrição estadual</label>
            <input className={inputCls} value={form.inscricao_estadual ?? ''} onChange={e => set('inscricao_estadual', e.target.value)} disabled={!podeEditar} />
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>Regime tributário (CRT)</label>
            <select className={`${inputCls} cursor-pointer`} value={form.crt} onChange={e => set('crt', Number(e.target.value))} disabled={!podeEditar}>
              <option value={1}>1 - Simples Nacional</option>
              <option value={2}>2 - Simples Nacional (excesso de sublimite)</option>
              <option value={3}>3 - Regime Normal (Lucro Presumido/Real)</option>
              <option value={4}>4 - MEI</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>Série da NFC-e <span className="text-zinc-400 font-normal">(vazio = automática)</span></label>
            <input className={inputCls} type="number" min={1} value={form.serie ?? ''} onChange={e => set('serie', e.target.value ? Number(e.target.value) : null)} disabled={!podeEditar} />
          </div>
          <div className="md:col-span-4">
            <label className={labelCls}>Logradouro</label>
            <input className={inputCls} value={form.endereco_logradouro ?? ''} onChange={e => set('endereco_logradouro', e.target.value)} disabled={!podeEditar} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Número</label>
            <input className={inputCls} value={form.endereco_numero ?? ''} onChange={e => set('endereco_numero', e.target.value)} disabled={!podeEditar} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Bairro</label>
            <input className={inputCls} value={form.endereco_bairro ?? ''} onChange={e => set('endereco_bairro', e.target.value)} disabled={!podeEditar} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Município</label>
            <input className={inputCls} value={form.endereco_municipio ?? ''} onChange={e => set('endereco_municipio', e.target.value)} disabled={!podeEditar} />
          </div>
          <div>
            <label className={labelCls}>UF</label>
            <select className={`${inputCls} cursor-pointer`} value={form.endereco_uf ?? 'PR'} onChange={e => set('endereco_uf', e.target.value)} disabled={!podeEditar}>
              {estadosBR.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>CEP</label>
            <input className={inputCls} value={form.endereco_cep ?? ''} onChange={e => set('endereco_cep', e.target.value)} disabled={!podeEditar} />
          </div>
        </div>
      </Section>

      <Section title="Tributação padrão" icon={<FileCheck2 size={14} />}
        desc="Vale para todo item que não tiver classificação própria (no item ou na categoria). Confirme os códigos com o contador.">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="md:col-span-3">
            <label className={labelCls}>NCM padrão</label>
            <input className={inputCls} list="ncm-padrao-sug" value={form.ncm_padrao ?? ''} onChange={e => set('ncm_padrao', e.target.value.replace(/\D/g, '').slice(0, 8))} disabled={!podeEditar} />
            <datalist id="ncm-padrao-sug">{NCM_SUGESTOES.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}</datalist>
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>CFOP padrão</label>
            <select className={`${inputCls} cursor-pointer`} value={form.cfop_padrao} onChange={e => set('cfop_padrao', Number(e.target.value))} disabled={!podeEditar}>
              {CFOP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {isSimples ? (
            <div className="md:col-span-3">
              <label className={labelCls}>CSOSN padrão</label>
              <select className={`${inputCls} cursor-pointer`} value={form.csosn_padrao} onChange={e => set('csosn_padrao', e.target.value)} disabled={!podeEditar}>
                {CSOSN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="md:col-span-2">
                <label className={labelCls}>CST ICMS padrão</label>
                <select className={`${inputCls} cursor-pointer`} value={form.cst_icms_padrao ?? '00'} onChange={e => set('cst_icms_padrao', e.target.value)} disabled={!podeEditar}>
                  {CST_ICMS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Alíquota ICMS %</label>
                <input className={inputCls} type="number" step="0.01" value={form.icms_aliquota_padrao ?? ''} onChange={e => set('icms_aliquota_padrao', e.target.value ? Number(e.target.value) : null)} disabled={!podeEditar} />
              </div>
            </>
          )}
          <div className="md:col-span-3">
            <label className={labelCls}>Grupo tributário padrão (painel Brasil NFe) <span className="text-zinc-400 font-normal">opcional</span></label>
            <input className={inputCls} value={form.cod_tributacao_padrao ?? ''} onChange={e => set('cod_tributacao_padrao', e.target.value)} disabled={!podeEditar} placeholder="Se preenchido, o provedor calcula os impostos" />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>CST PIS</label>
            <input className={inputCls} value={form.pis_cst_padrao} onChange={e => set('pis_cst_padrao', e.target.value.replace(/\D/g, '').slice(0, 2))} disabled={!podeEditar} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>CST COFINS</label>
            <input className={inputCls} value={form.cofins_cst_padrao} onChange={e => set('cofins_cst_padrao', e.target.value.replace(/\D/g, '').slice(0, 2))} disabled={!podeEditar} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Natureza da operação</label>
            <input className={inputCls} value={form.natureza_operacao} onChange={e => set('natureza_operacao', e.target.value)} disabled={!podeEditar} />
          </div>
        </div>
      </Section>

      <Section title="Impressão do cupom (DANFE NFC-e)" icon={<Printer size={14} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <Toggle checked={form.print_danfe} onChange={v => set('print_danfe', v)} label="Imprimir o cupom fiscal ao autorizar" hint="Vai para a fila de impressão como os tickets" />
          <div>
            <label className={labelCls}>Impressora do cupom</label>
            <select className={`${inputCls} cursor-pointer`} value={form.danfe_printer_id ?? ''} onChange={e => set('danfe_printer_id', e.target.value || null)} disabled={!podeEditar}>
              <option value="">Padrão (única impressora / mapeamento)</option>
              {impressoras.map(i => <option key={i.id} value={i.id}>{i.nome} ({i.ip})</option>)}
            </select>
          </div>
        </div>
      </Section>

      {podeEditar && (
        <div className="flex justify-end">
          <button onClick={() => salvar()} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            <Save size={15} /> {saving ? 'Salvando…' : 'Salvar configuração fiscal'}
          </button>
        </div>
      )}
    </div>
  );
}
