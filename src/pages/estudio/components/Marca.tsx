// Estúdio de Criação › Marca — Kit da Marca: identidade visual, voz e regras que toda
// arte gerada respeita. Quem não é gerente/admin só lê.
import { useEffect, useState } from 'react';
import { Palette, MessageSquareText, ShieldAlert, Sparkles, Loader2, Check, Camera, Store, AlertTriangle } from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';
import { avisar } from '@/components/base/Dialogos';
import { Secao, fileParaBase64, chips, type Kit } from '../shared';

const TOM_LABEL: Record<string, string> = {
  descontraido: 'Descontraído', familiar: 'Familiar / caseiro', premium: 'Premium / sofisticado', jovem: 'Jovem / pop',
};

interface Props {
  tenantId: string;
  kit: Kit;
  logoUrl: string | null;
  fontes: string[];
  isManager: boolean;
  onSaved: (kit: Kit) => void;
  onLogoChanged: (url: string) => void;
}

export default function MarcaTab({ tenantId, kit, logoUrl, fontes, isManager, onSaved, onLogoChanged }: Props) {
  const [form, setForm] = useState<Kit>(kit);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [sugestao, setSugestao] = useState<Partial<Kit> | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);

  useEffect(() => { setForm(kit); }, [kit]);

  const F = <K extends keyof Kit>(k: K, v: Kit[K]) => setForm((f) => ({ ...f, [k]: v }));

  const salvar = async () => {
    setSalvando(true); setErro(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; kit: Kit; error?: string }>('estudio', {
      body: { action: 'save_kit', tenant_id: tenantId, kit: form },
    });
    setSalvando(false);
    if (error || !data?.success) { setErro(error?.message ?? data?.error ?? 'Não salvou o Kit da Marca.'); return; }
    onSaved(data.kit);
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2500);
  };

  const sugerirComIA = async () => {
    setSugerindo(true); setErro(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; sugestao: Partial<Kit>; motivo: string; error?: string }>('estudio', {
      body: { action: 'prefill_kit', tenant_id: tenantId },
    });
    setSugerindo(false);
    if (error || !data?.success) { setErro(error?.message ?? data?.error ?? 'Não consegui gerar sugestões agora.'); return; }
    setSugestao(data.sugestao);
    setMotivo(data.motivo);
  };

  const aceitarCampo = (k: keyof Kit) => {
    if (!sugestao || sugestao[k] === undefined) return;
    setForm((f) => ({ ...f, [k]: sugestao[k] as never }));
  };
  const aceitarTudo = () => {
    if (!sugestao) return;
    setForm((f) => ({ ...f, ...sugestao }));
    setSugestao(null);
  };

  const onLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { void avisar('Arquivo muito grande. Máx. 2MB.'); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { void avisar('Envie PNG, JPG ou WebP.'); return; }
    setEnviandoLogo(true); setErro(null);
    try {
      const base64 = await fileParaBase64(file);
      const { data, error } = await invokeWithAuth<{ success: boolean; logo_url: string; error?: string }>('estudio', {
        body: { action: 'upload_logo', tenant_id: tenantId, file_base64: base64, content_type: file.type },
      });
      if (error || !data?.success) { setErro(error?.message ?? data?.error ?? 'Não consegui enviar o logo.'); return; }
      onLogoChanged(data.logo_url);
    } finally {
      setEnviandoLogo(false);
    }
  };

  const inp = 'w-full text-sm border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-700 focus:outline-none focus:border-fuchsia-400 disabled:bg-zinc-50 disabled:text-zinc-400';
  const lbl = 'text-[11px] font-semibold text-zinc-500 mb-1 block';
  const somenteLeitura = !isManager;

  const campoSugerido = (k: keyof Kit) => sugestao && sugestao[k] !== undefined;

  return (
    <div className="space-y-4">
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> <span>{erro}</span>
        </div>
      )}

      {somenteLeitura && (
        <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 border bg-zinc-50 border-zinc-200 text-zinc-500">
          <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" /> Só admin/gerente altera o Kit da Marca. Você está vendo em modo leitura.
        </div>
      )}

      {isManager && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={sugerirComIA} disabled={sugerindo}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold rounded-xl bg-fuchsia-600 text-white hover:bg-fuchsia-700 cursor-pointer disabled:opacity-50">
            {sugerindo ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {sugerindo ? 'Analisando logo e cardápio...' : 'Sugerir com IA'}
          </button>
          {sugestao && (
            <button onClick={aceitarTudo} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer">
              <Check size={14} /> Aceitar tudo
            </button>
          )}
        </div>
      )}

      {sugestao && motivo && (
        <div className="bg-fuchsia-50/60 border border-fuchsia-200 rounded-xl px-4 py-3 text-xs text-fuchsia-800 leading-relaxed">
          <strong>Sugestão da IA:</strong> {motivo} Clique em "Aceitar" nos campos destacados abaixo, ou em "Aceitar tudo".
        </div>
      )}

      {/* Identidade */}
      <Secao titulo="Identidade" icon={Palette}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 flex items-center gap-4">
            <div className="w-16 h-16 flex items-center justify-center bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-xl overflow-hidden flex-shrink-0">
              {logoUrl ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" /> : <Store size={24} className="text-zinc-300" />}
            </div>
            {isManager && (
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 text-zinc-700 text-xs font-semibold rounded-lg hover:bg-zinc-200 cursor-pointer">
                {enviandoLogo ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                {enviandoLogo ? 'Enviando...' : 'Enviar logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} disabled={enviandoLogo} />
              </label>
            )}
          </div>
          <div>
            <span className={lbl}>Nome da marca {campoSugerido('nome_marca') && <button onClick={() => aceitarCampo('nome_marca')} className="text-fuchsia-600 cursor-pointer">· aceitar sugestão ({sugestao?.nome_marca})</button>}</span>
            <input value={form.nome_marca ?? ''} onChange={(e) => F('nome_marca', e.target.value)} disabled={somenteLeitura} className={inp} placeholder="Ex.: El Patrón" />
          </div>
          <div>
            <span className={lbl}>Fonte {campoSugerido('fonte') && <button onClick={() => aceitarCampo('fonte')} className="text-fuchsia-600 cursor-pointer">· aceitar sugestão ({String(sugestao?.fonte)})</button>}</span>
            <select value={form.fonte} onChange={(e) => F('fonte', e.target.value)} disabled={somenteLeitura} className={inp}>
              {(fontes.length ? fontes : [form.fonte]).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          {([
            ['cor_primaria', 'Cor primária'],
            ['cor_secundaria', 'Cor secundária'],
            ['cor_fundo', 'Cor de fundo'],
            ['cor_texto', 'Cor do texto'],
          ] as const).map(([k, label]) => (
            <div key={k}>
              <span className={lbl}>{label} {campoSugerido(k) && <button onClick={() => aceitarCampo(k)} className="text-fuchsia-600 cursor-pointer">· aceitar sugestão</button>}</span>
              <div className="flex items-center gap-2">
                <input type="color" value={form[k]} onChange={(e) => F(k, e.target.value)} disabled={somenteLeitura} className="w-9 h-9 rounded-lg border border-zinc-200 cursor-pointer disabled:cursor-not-allowed" />
                <input value={form[k]} onChange={(e) => F(k, e.target.value)} disabled={somenteLeitura} className={inp} />
              </div>
            </div>
          ))}
        </div>
      </Secao>

      {/* Prévia ao vivo */}
      <div className="rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-100 text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Prévia da marca</div>
        <div className="p-6 flex flex-col items-center text-center gap-3" style={{ background: form.cor_fundo, color: form.cor_texto, fontFamily: form.fonte }}>
          {logoUrl && <img src={logoUrl} alt="" className="w-12 h-12 object-contain" />}
          <p className="text-lg font-black">{form.nome_marca || 'Nome da marca'}</p>
          <p className="text-sm opacity-80 max-w-sm">{form.diferenciais || 'Seus diferenciais aparecem aqui — o que faz o cliente escolher você.'}</p>
          <span className="inline-block px-4 py-2 rounded-lg text-sm font-bold text-white" style={{ background: form.cor_primaria }}>
            {form.cta_padrao || 'Peça já'}
          </span>
        </div>
      </div>

      {/* Voz */}
      <Secao titulo="Voz" icon={MessageSquareText}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <span className={lbl}>Tom de voz {campoSugerido('tom_voz') && <button onClick={() => aceitarCampo('tom_voz')} className="text-fuchsia-600 cursor-pointer">· aceitar sugestão</button>}</span>
            <select value={form.tom_voz ?? ''} onChange={(e) => F('tom_voz', (e.target.value || null) as Kit['tom_voz'])} disabled={somenteLeitura} className={inp}>
              <option value="">Escolha...</option>
              {Object.entries(TOM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700 mt-5">
            <input type="checkbox" checked={form.usa_emoji} onChange={(e) => F('usa_emoji', e.target.checked)} disabled={somenteLeitura} className="w-4 h-4 accent-fuchsia-600" />
            Usar emoji nos textos
          </label>
          <div className="sm:col-span-2">
            <span className={lbl}>Público {campoSugerido('publico') && <button onClick={() => aceitarCampo('publico')} className="text-fuchsia-600 cursor-pointer">· aceitar sugestão</button>}</span>
            <input value={form.publico ?? ''} onChange={(e) => F('publico', e.target.value)} disabled={somenteLeitura} className={inp} placeholder="Ex.: famílias do bairro, 25-45 anos" />
          </div>
          <div className="sm:col-span-2">
            <span className={lbl}>Diferenciais {campoSugerido('diferenciais') && <button onClick={() => aceitarCampo('diferenciais')} className="text-fuchsia-600 cursor-pointer">· aceitar sugestão</button>}</span>
            <textarea value={form.diferenciais ?? ''} onChange={(e) => F('diferenciais', e.target.value)} disabled={somenteLeitura} rows={2} className={inp} placeholder="O que faz o cliente escolher você" />
          </div>
          <div className="sm:col-span-2">
            <span className={lbl}>Bordões / frases da marca {campoSugerido('bordoes') && <button onClick={() => aceitarCampo('bordoes')} className="text-fuchsia-600 cursor-pointer">· aceitar sugestão</button>}</span>
            <input value={form.bordoes ?? ''} onChange={(e) => F('bordoes', e.target.value)} disabled={somenteLeitura} className={inp} />
          </div>
          <div>
            <span className={lbl}>CTA padrão {campoSugerido('cta_padrao') && <button onClick={() => aceitarCampo('cta_padrao')} className="text-fuchsia-600 cursor-pointer">· aceitar sugestão</button>}</span>
            <input value={form.cta_padrao ?? ''} onChange={(e) => F('cta_padrao', e.target.value)} disabled={somenteLeitura} className={inp} placeholder="Ex.: Peça pelo delivery" />
          </div>
        </div>
      </Secao>

      {/* Regras */}
      <Secao titulo="Regras" icon={ShieldAlert}>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <input type="checkbox" checked={form.mostrar_preco} onChange={(e) => F('mostrar_preco', e.target.checked)} disabled={somenteLeitura} className="w-4 h-4 accent-fuchsia-600" />
            Mostrar preço nas artes
          </label>
          <div>
            <span className={lbl}>Estilo de foto {campoSugerido('estilo_foto') && <button onClick={() => aceitarCampo('estilo_foto')} className="text-fuchsia-600 cursor-pointer">· aceitar sugestão</button>}</span>
            <input value={form.estilo_foto ?? ''} onChange={(e) => F('estilo_foto', e.target.value)} disabled={somenteLeitura} className={inp} placeholder="Ex.: foto real, iluminação natural" />
          </div>
          <div>
            <span className={lbl}>Palavras obrigatórias (separadas por vírgula)</span>
            <input value={(form.palavras_obrigatorias ?? []).join(', ')} onChange={(e) => F('palavras_obrigatorias', chips(e.target.value))} disabled={somenteLeitura} className={inp} />
          </div>
          <div>
            <span className={lbl}>Palavras proibidas (separadas por vírgula)</span>
            <input value={(form.palavras_proibidas ?? []).join(', ')} onChange={(e) => F('palavras_proibidas', chips(e.target.value))} disabled={somenteLeitura} className={inp} />
          </div>
          <div className="sm:col-span-2">
            <span className={lbl}>Nunca fazer</span>
            <textarea value={form.nunca_fazer ?? ''} onChange={(e) => F('nunca_fazer', e.target.value)} disabled={somenteLeitura} rows={2} className={inp} placeholder="Ex.: nunca comparar com concorrente, nunca prometer prazo" />
          </div>
        </div>
      </Secao>

      {isManager && (
        <div className="flex items-center gap-3">
          <button onClick={salvar} disabled={salvando}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl bg-amber-500 text-white hover:bg-amber-600 cursor-pointer disabled:opacity-50">
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar
          </button>
          {salvo && <span className="text-xs text-emerald-600 font-semibold">Salvo.</span>}
        </div>
      )}
    </div>
  );
}
