import { useState, useEffect } from 'react';
import { Store, Camera, Save } from 'lucide-react';
import { supabase, invokeWithAuth, uploadMenuImage } from '@/lib/supabase';
import { COR_LOJA_PADRAO } from '@/lib/corLoja';
import EditorPosicaoCapa from './EditorPosicaoCapa';
import { lerCapasLoja, MAX_CAPAS, type CapaLoja } from '@/lib/capasLoja';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { avisar } from '@/components/base/Dialogos';

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
  /** Cor do cardápio online (delivery e QR). As fotos de capa ficam no estado `capas`. */
  corLoja: string;
}

const estadosBR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const EMPTY: ConfigLoja = { nome: '', cnpj: '', telefone: '', email: '', endereco: '', cidade: '', estado: 'SP', cep: '', logoUrl: '', corLoja: '' };

// Cores sugeridas para o cardápio online — todas passam no contraste com texto branco
const CORES_SUGERIDAS = [
  { nome: 'Laranja (padrão)', cor: COR_LOJA_PADRAO },
  { nome: 'Vermelho', cor: '#B91C1C' },
  { nome: 'Vinho', cor: '#9F1239' },
  { nome: 'Verde', cor: '#15803D' },
  { nome: 'Azul', cor: '#1D4ED8' },
  { nome: 'Roxo', cor: '#6D28D9' },
  { nome: 'Preto', cor: '#1C1917' },
];

// Contraste do texto branco sobre a cor (WCAG): abaixo de 4,5 o botão fica difícil de ler
function contrasteBranco(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const canal = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const l = 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
  return 1.05 / (l + 0.05);
}

// ── Compressão do logo ────────────────────────────────────────────────────────
// O logo vai pro banco como data-URL (tenants.logo_url) e é baixado a cada visita
// do delivery — sem comprimir, uma foto de câmera vira ~2MB por visita. Redimensiona
// pra no máx. 512px e re-encoda em WebP (todos os consumidores são <img> de navegador;
// se o navegador não encodar WebP, o canvas devolve PNG). Só troca se ficar menor.
const LOGO_MAX_PX = 512;
// Acima disso, logos antigos (salvos antes da compressão) são recomprimidos ao salvar.
const LOGO_RECOMPRESS_BYTES = 150 * 1024;

async function compressLogoDataUrl(dataUrl: string): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('logo inválido'));
      i.src = dataUrl;
    });
    const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.width, img.height, 1));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    let out = canvas.toDataURL('image/webp', 0.85);
    if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/png');
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl; // falha na compressão nunca pode impedir o upload
  }
}

export default function LojaTab() {
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const [form, setForm] = useState<ConfigLoja>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    // Troca de loja: não deixa a capa da loja anterior na tela (um Salvar a gravaria nesta)
    setCapas([]);
    setCapaSel(0);
    if (!user?.tenantId) { setLoading(false); return; }
    supabase
      .from('tenants')
      .select('name, cnpj, address, phone, email, city, state, zip_code, logo_url, cover_url, brand_color, cover_position, cover_images')
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
            corLoja: (data as { brand_color?: string | null }).brand_color ?? '',
          });
          setCapas(lerCapasLoja(data as { cover_images?: unknown; cover_url?: string | null; cover_position?: string | null }));
        }
        setLoading(false);
      });
  }, [user?.tenantId]);

  const set = (k: keyof ConfigLoja, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [enviandoCapa, setEnviandoCapa] = useState(false);
  // Fotos de capa (até 10, passam sozinhas no delivery e no QR) e qual está aberta no editor
  const [capas, setCapas] = useState<CapaLoja[]>([]);
  const [capaSel, setCapaSel] = useState(0);
  const capaAberta = capas[Math.min(capaSel, capas.length - 1)] || null;
  const idxAberta = Math.min(capaSel, capas.length - 1);

  const enviarCapas = async (files: File[]) => {
    if (!user?.tenantId || files.length === 0) return;
    const vagas = MAX_CAPAS - capas.length;
    if (vagas <= 0) { void avisar('Já são ' + MAX_CAPAS + ' fotos. Remova uma para enviar outra.'); return; }
    const grandes = files.filter((f) => f.size > 8 * 1024 * 1024);
    const validos = files.filter((f) => f.size <= 8 * 1024 * 1024).slice(0, vagas);
    setEnviandoCapa(true);
    const novas: CapaLoja[] = [];
    let falhas = 0;
    for (const file of validos) {
      const { url, error } = await uploadMenuImage(file, user.tenantId, 'capa-loja');
      if (error || !url) { falhas++; continue; }
      novas.push({ url, posicao: '' });
    }
    setEnviandoCapa(false);
    if (novas.length > 0) {
      // Abre no editor a 1ª foto recém-enviada (mover/remover ficam travados durante o envio)
      setCapaSel(Math.min(capas.length, MAX_CAPAS - 1));
      setCapas((atual) => [...atual, ...novas].slice(0, MAX_CAPAS));
    }
    const avisos: string[] = [];
    if (grandes.length) avisos.push(grandes.length + ' foto(s) acima de 8MB ficaram de fora.');
    if (files.length - grandes.length > vagas) avisos.push('Só cabem ' + MAX_CAPAS + ' fotos; as excedentes ficaram de fora.');
    if (falhas) toastError('Não foi possível enviar ' + falhas + ' foto(s)', 'Tente de novo.');
    if (avisos.length) void avisar(avisos.join(' '));
  };

  const moverCapa = (de: number, para: number) => {
    if (para < 0 || para >= capas.length) return;
    setCapas((atual) => {
      const lista = [...atual];
      const [item] = lista.splice(de, 1);
      lista.splice(para, 0, item);
      return lista;
    });
    setCapaSel(para);
  };

  const removerCapa = (i: number) => {
    setCapas((atual) => atual.filter((_, j) => j !== i));
    setCapaSel((sel) => Math.max(0, sel > i ? sel - 1 : Math.min(sel, capas.length - 2)));
  };
  const corValida = /^#[0-9A-Fa-f]{6}$/.test(form.corLoja);

  const handleSalvar = async () => {
    if (!user?.tenantId || enviandoCapa) return;
    setSaving(true);
    setErro('');

    // Logos salvos antes da compressão existir podem estar enormes (~2MB) —
    // recomprime na hora do salvar, então basta reabrir e salvar pra sanear.
    let logoUrl = form.logoUrl;
    if (logoUrl.startsWith('data:') && logoUrl.length > LOGO_RECOMPRESS_BYTES) {
      logoUrl = await compressLogoDataUrl(logoUrl);
      if (logoUrl !== form.logoUrl) set('logoUrl', logoUrl);
    }

    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: {
        action: 'update_tenant',
        tenant_id: user.tenantId,
        name: form.nome,
        cnpj: form.cnpj,
        address: form.endereco,
        logo_url: logoUrl,
        phone: form.telefone,
        email: form.email,
        city: form.cidade,
        state: form.estado,
        zip_code: form.cep,
        // A 1ª foto vira cover_url/cover_position no config-write
        cover_images: capas.map((c) => ({ url: c.url, position: c.posicao })),
        brand_color: /^#[0-9A-Fa-f]{6}$/.test(form.corLoja) ? form.corLoja : '',
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
                    if (file.size > 2 * 1024 * 1024) { void avisar('Arquivo muito grande. Máx. 2MB.'); return; }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const raw = ev.target?.result;
                      if (typeof raw !== 'string') return;
                      compressLogoDataUrl(raw).then((v) => set('logoUrl', v));
                    };
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
              <p className="text-[10px] text-zinc-400">PNG, JPG ou WebP, máx. 2MB — otimizado automaticamente para 512px</p>
            </div>
          </div>
        </div>
      </div>

      {/* Aparência do cardápio online (delivery e QR) */}
      <div className="bg-white border border-zinc-100 rounded-xl p-5">
        <h3 className="text-sm font-bold text-zinc-800">Aparência do cardápio online</h3>
        <p className="text-xs text-zinc-500 mt-1 mb-4">Capa e cor que o cliente vê no delivery e no QR Code da mesa/balcão.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Capas */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs font-semibold text-zinc-600">Fotos de capa</p>
              <p className="text-[10px] text-zinc-400">{capas.length} de {MAX_CAPAS}</p>
            </div>
            {capaAberta && !enviandoCapa ? (
              <EditorPosicaoCapa
                url={capaAberta.url}
                posicao={capaAberta.posicao}
                onChange={(v) => setCapas((atual) => atual.map((c, j) => (j === idxAberta ? { ...c, posicao: v } : c)))}
              />
            ) : (
              <div className="relative h-28 rounded-xl overflow-hidden border border-zinc-200 bg-zinc-100 flex items-center justify-center" style={{ background: corValida ? form.corLoja : COR_LOJA_PADRAO }}>
                <span className="text-[11px] font-semibold text-white/90">Sem capa — usa a cor da loja</span>
                {enviandoCapa ? (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                    <i className="ri-loader-4-line animate-spin text-zinc-600 text-lg" />
                  </div>
                ) : null}
              </div>
            )}

            {capas.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-2" role="list" aria-label="Ordem das fotos de capa">
                {capas.map((c, i) => (
                  <button
                    key={c.url + i}
                    type="button"
                    role="listitem"
                    onClick={() => setCapaSel(i)}
                    aria-label={'Foto ' + (i + 1) + (i === idxAberta ? ' (aberta no editor)' : '')}
                    aria-pressed={i === idxAberta}
                    className={'relative w-14 h-10 rounded-md overflow-hidden cursor-pointer border-2 transition-colors ' + (i === idxAberta ? 'border-amber-500' : 'border-transparent hover:border-zinc-300')}
                  >
                    <img src={c.url} alt="" className="w-full h-full object-cover" style={c.posicao ? { objectPosition: c.posicao } : undefined} />
                    <span className="absolute top-0.5 left-0.5 min-w-[14px] h-[14px] px-0.5 rounded bg-black/60 text-white text-[9px] font-bold leading-[14px]">{i + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 mt-2">
              {capas.length < MAX_CAPAS ? (
                <label className={'flex items-center gap-2 px-3 py-2 bg-zinc-100 text-zinc-700 text-xs font-semibold rounded-lg hover:bg-zinc-200 transition-colors whitespace-nowrap ' + (enviandoCapa ? 'opacity-60 pointer-events-none' : 'cursor-pointer')}>
                  <Camera size={13} />
                  {capas.length ? 'Adicionar fotos' : 'Enviar capa'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    disabled={enviandoCapa}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = '';
                      void enviarCapas(files);
                    }}
                  />
                </label>
              ) : null}
              {capaAberta && capas.length > 1 ? (
                <>
                  <button type="button" onClick={() => moverCapa(idxAberta, idxAberta - 1)} disabled={idxAberta === 0 || enviandoCapa} aria-label="Mover foto para antes" className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 cursor-pointer disabled:opacity-40 disabled:cursor-default">
                    <i className="ri-arrow-left-s-line" />
                  </button>
                  <button type="button" onClick={() => moverCapa(idxAberta, idxAberta + 1)} disabled={idxAberta === capas.length - 1 || enviandoCapa} aria-label="Mover foto para depois" className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 cursor-pointer disabled:opacity-40 disabled:cursor-default">
                    <i className="ri-arrow-right-s-line" />
                  </button>
                </>
              ) : null}
              {capaAberta ? (
                <button type="button" onClick={() => removerCapa(idxAberta)} disabled={enviandoCapa} className="px-2 py-2 text-xs text-red-500 hover:text-red-700 cursor-pointer disabled:opacity-40 disabled:cursor-default">
                  {capas.length > 1 ? 'Remover esta' : 'Remover'}
                </button>
              ) : null}
            </div>
            <p className="text-[10px] text-zinc-400 mt-1">
              Fotos largas de pratos ou do salão, até {MAX_CAPAS}. Com mais de uma, elas passam sozinhas a cada 5 segundos. Fica no topo, atrás da logo.
            </p>
          </div>

          {/* Cor */}
          <div>
            <p className="text-xs font-semibold text-zinc-600 mb-2">Cor da loja</p>
            <div className="flex flex-wrap gap-2">
              {CORES_SUGERIDAS.map((c) => {
                const ativa = (form.corLoja || COR_LOJA_PADRAO).toLowerCase() === c.cor.toLowerCase();
                return (
                  <button
                    key={c.cor}
                    type="button"
                    title={c.nome}
                    aria-label={c.nome}
                    aria-pressed={ativa}
                    onClick={() => set('corLoja', c.cor === COR_LOJA_PADRAO ? '' : c.cor)}
                    className={'w-9 h-9 rounded-full border-2 cursor-pointer flex items-center justify-center ' + (ativa ? 'border-zinc-900' : 'border-white shadow')}
                    style={{ background: c.cor }}
                  >
                    {ativa ? <i className="ri-check-line text-white text-base" /> : null}
                  </button>
                );
              })}
              <label className="w-9 h-9 rounded-full border-2 border-dashed border-zinc-300 flex items-center justify-center cursor-pointer relative overflow-hidden" title="Outra cor">
                <i className="ri-palette-line text-zinc-500" />
                <input
                  type="color"
                  value={corValida ? form.corLoja : COR_LOJA_PADRAO}
                  onChange={(e) => set('corLoja', e.target.value.toUpperCase())}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Escolher outra cor"
                />
              </label>
            </div>
            {/* Prévia do botão do cliente */}
            <div className="mt-3 h-11 rounded-xl text-white text-sm font-bold flex items-center justify-between px-4" style={{ background: corValida ? form.corLoja : COR_LOJA_PADRAO }}>
              <span>Ver sacola</span><span>R$ 57,00</span>
            </div>
            {corValida && contrasteBranco(form.corLoja) < 4.5 ? (
              <p className="text-[11px] text-amber-700 mt-1.5">Cor clara: o texto branco dos botões fica difícil de ler. Prefira um tom mais escuro.</p>
            ) : (
              <p className="text-[10px] text-zinc-400 mt-1.5">Usada nos botões, no "+" dos itens e nos destaques.</p>
            )}
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
          disabled={saving || enviandoCapa}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white text-sm font-bold rounded-lg hover:bg-amber-600 disabled:opacity-60 cursor-pointer transition-colors whitespace-nowrap"
        >
          <div className="w-4 h-4 flex items-center justify-center"><Save size={14} /></div>
          {saving ? 'Salvando...' : 'Salvar dados da loja'}
        </button>
      </div>
    </div>
  );
}
