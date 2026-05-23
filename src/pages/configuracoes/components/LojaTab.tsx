import { useState, useEffect } from 'react';
import { Store, Camera, Save } from 'lucide-react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

interface ConfigLoja {
  nome: string;
  cnpj: string;
  telefone: string;
  email: string;
  endereco: string;
  cidade: string;
  estado: string;
  cep: string;
  logoUrl: string;
}

const estadosBR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const EMPTY: ConfigLoja = { nome: '', cnpj: '', telefone: '', email: '', endereco: '', cidade: '', estado: 'SP', cep: '', logoUrl: '' };

export default function LojaTab() {
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const [form, setForm] = useState<ConfigLoja>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!user?.tenantId) { setLoading(false); return; }
    supabase
      .from('tenants')
      .select('name, cnpj, address, logo_url, phone, email, city, state, zip_code')
      .eq('id', user.tenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setForm({
            nome: data.name ?? '',
            cnpj: data.cnpj ?? '',
            telefone: data.phone ?? '',
            email: data.email ?? '',
            endereco: data.address ?? '',
            cidade: data.city ?? '',
            estado: data.state ?? 'SP',
            cep: data.zip_code ?? '',
            logoUrl: data.logo_url ?? '',
          });
        }
        setLoading(false);
      });
  }, [user?.tenantId]);

  const set = (k: keyof ConfigLoja, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSalvar = async () => {
    if (!user?.tenantId) return;
    setSaving(true);
    setErro('');

    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: {
        action: 'update_tenant',
        tenant_id: user.tenantId,
        name: form.nome,
        cnpj: form.cnpj,
        address: form.endereco,
        logo_url: form.logoUrl,
        phone: form.telefone,
        email: form.email,
        city: form.cidade,
        state: form.estado,
        zip_code: form.cep,
      },
    });

    setSaving(false);

    if (error || !data?.success) {
      const msg = error?.message || data?.error || 'Erro ao salvar. Tente novamente.';
      setErro(msg);
      toastError('Erro ao salvar', msg);
      return;
    }

    setSalvo(true);
    toastSuccess('Dados da loja salvos!', 'As informações foram atualizadas com sucesso.');
    setTimeout(() => setSalvo(false), 2500);
  };

  const formatCNPJ = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  };

  const formatCEP = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 8);
    if (d.length <= 5) return d;
    return `${d.slice(0,5)}-${d.slice(5)}`;
  };

  const formatTel = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {salvo && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="w-4 h-4 flex items-center justify-center text-emerald-500"><Save size={14} /></div>
          <p className="text-xs font-semibold text-emerald-700">Configurações salvas com sucesso!</p>
        </div>
      )}
      {erro && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
          <i className="ri-alert-line text-red-500 text-sm" />
          <p className="text-xs font-semibold text-red-700">{erro}</p>
        </div>
      )}

      {/* Logo */}
      <div className="bg-white border border-zinc-100 rounded-xl p-5">
        <h3 className="text-sm font-bold text-zinc-800 mb-4">Logo da Loja</h3>
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 flex items-center justify-center bg-amber-50 border-2 border-dashed border-amber-200 rounded-2xl overflow-hidden">
            {form.logoUrl ? (
              <img src={form.logoUrl} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <Store size={28} className="text-amber-300" />
            )}
          </div>
          <div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 px-4 py-2 bg-zinc-100 text-zinc-700 text-xs font-semibold rounded-lg hover:bg-zinc-200 cursor-pointer transition-colors whitespace-nowrap w-fit">
                <div className="w-4 h-4 flex items-center justify-center"><Camera size={13} /></div>
                Enviar logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) { alert('Arquivo muito grande. Máx. 2MB.'); return; }
                    const reader = new FileReader();
                    reader.onload = (ev) => { if (ev.target?.result) set('logoUrl', ev.target.result as string); };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {form.logoUrl && (
                <button
                  onClick={() => set('logoUrl', '')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500 hover:text-red-700 cursor-pointer transition-colors"
                >
                  <i className="ri-delete-bin-line text-xs" />
                  Remover logo
                </button>
              )}
              <p className="text-[10px] text-zinc-400">PNG, JPG ou WebP, máx. 2MB — recomendado 512×512px</p>
            </div>
          </div>
        </div>
      </div>

      {/* Dados básicos */}
      <div className="bg-white border border-zinc-100 rounded-xl p-5">
        <h3 className="text-sm font-bold text-zinc-800 mb-4">Dados da Loja</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome do estabelecimento</label>
            <input value={form.nome} onChange={(e) => set('nome', e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">CNPJ</label>
            <input value={form.cnpj} onChange={(e) => set('cnpj', formatCNPJ(e.target.value))}
              placeholder="00.000.000/0000-00"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Telefone</label>
            <input value={form.telefone} onChange={(e) => set('telefone', formatTel(e.target.value))}
              placeholder="(00) 00000-0000"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">E-mail</label>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
              placeholder="contato@sualoja.com.br"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
          </div>
        </div>
      </div>

      {/* Endereço */}
      <div className="bg-white border border-zinc-100 rounded-xl p-5">
        <h3 className="text-sm font-bold text-zinc-800 mb-4">Endereço</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Logradouro</label>
            <input value={form.endereco} onChange={(e) => set('endereco', e.target.value)}
              placeholder="Rua, número, complemento"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">CEP</label>
            <input value={form.cep} onChange={(e) => set('cep', formatCEP(e.target.value))}
              placeholder="00000-000"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Cidade</label>
            <input value={form.cidade} onChange={(e) => set('cidade', e.target.value)}
              placeholder="São Paulo"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Estado</label>
            <select value={form.estado} onChange={(e) => set('estado', e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 cursor-pointer">
              {estadosBR.map((e) => <option key={e}>{e}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSalvar}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white text-sm font-bold rounded-lg hover:bg-amber-600 disabled:opacity-60 cursor-pointer transition-colors whitespace-nowrap"
        >
          <div className="w-4 h-4 flex items-center justify-center"><Save size={14} /></div>
          {saving ? 'Salvando...' : 'Salvar dados da loja'}
        </button>
      </div>
    </div>
  );
}
