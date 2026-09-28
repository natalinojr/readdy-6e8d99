// Estúdio de Criação (/estudio) — gera artes (PNG) a partir de modelos da marca + fotos reais
// do cardápio. Módulo separado do Tráfego Pago (PLANO-TRAFEGO-PAGO-AGENTES.md § 3.2).
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Palette, Loader2, AlertTriangle, Image as ImageIcon, Wand2, Images } from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import MarcaTab from './components/Marca';
import BibliotecaTab from './components/Biblioteca';
import CriarTab from './components/Criar';
import GaleriaTab from './components/Galeria';
import { KIT_VAZIO, type Kit, type Template, type LibItem, type Creative } from './shared';

type Aba = 'marca' | 'biblioteca' | 'criar' | 'galeria';

const ABAS: { id: Aba; label: string; icon: typeof Palette }[] = [
  { id: 'marca', label: 'Marca', icon: Palette },
  { id: 'biblioteca', label: 'Biblioteca', icon: Images },
  { id: 'criar', label: 'Criar', icon: Wand2 },
  { id: 'galeria', label: 'Galeria', icon: ImageIcon },
];

export default function EstudioPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const isManager = user?.perfil === 'admin' || user?.perfil === 'gerente';

  const [params, setParams] = useSearchParams();
  const abaPedida = params.get('aba') as Aba | null;
  const aba: Aba = ABAS.find((a) => a.id === abaPedida)?.id ?? 'marca';
  const irPara = (id: Aba) => {
    const p = new URLSearchParams(params);
    p.set('aba', id);
    setParams(p, { replace: true });
  };

  const [presetItemId, setPresetItemId] = useState<string | null>(null);

  // Kit + templates + fontes (aba Marca e Criar)
  const [kit, setKit] = useState<Kit | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [fontes, setFontes] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [kitLoading, setKitLoading] = useState(true);
  const [kitError, setKitError] = useState<string | null>(null);

  // Biblioteca
  const [library, setLibrary] = useState<LibItem[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [libError, setLibError] = useState<string | null>(null);

  // Galeria
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [credLoading, setCredLoading] = useState(true);
  const [credError, setCredError] = useState<string | null>(null);

  const carregarKit = useCallback(async () => {
    if (!tenantId) return;
    setKitLoading(true); setKitError(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; kit: Kit; logo_url: string | null; fontes: string[]; templates: Template[]; error?: string }>('estudio', {
      body: { action: 'get_kit', tenant_id: tenantId },
    });
    if (error || !data?.success) {
      setKitError(error?.message ?? data?.error ?? 'Não consegui carregar o Kit da Marca (a função "estudio" está publicada?)');
      setKit(KIT_VAZIO);
    } else {
      setKit(data.kit);
      setLogoUrl(data.logo_url);
      setFontes(data.fontes ?? []);
      setTemplates(data.templates ?? []);
    }
    setKitLoading(false);
  }, [tenantId]);

  const carregarLibrary = useCallback(async () => {
    if (!tenantId) return;
    setLibLoading(true); setLibError(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; items: LibItem[]; error?: string }>('estudio', {
      body: { action: 'library', tenant_id: tenantId },
    });
    if (error || !data?.success) setLibError(error?.message ?? data?.error ?? 'Não consegui carregar a biblioteca de fotos.');
    else setLibrary(data.items ?? []);
    setLibLoading(false);
  }, [tenantId]);

  const carregarCreatives = useCallback(async () => {
    if (!tenantId) return;
    setCredLoading(true); setCredError(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; creatives: Creative[]; error?: string }>('estudio', {
      body: { action: 'list_creatives', tenant_id: tenantId, limit: 60 },
    });
    if (error || !data?.success) setCredError(error?.message ?? data?.error ?? 'Não consegui carregar a galeria.');
    else setCreatives(data.creatives ?? []);
    setCredLoading(false);
  }, [tenantId]);

  useEffect(() => { void carregarKit(); }, [carregarKit]);
  useEffect(() => { void carregarLibrary(); }, [carregarLibrary]);
  useEffect(() => { void carregarCreatives(); }, [carregarCreatives]);

  const analisarBiblioteca = useCallback(async () => {
    if (!tenantId) return;
    await invokeWithAuth('estudio', { body: { action: 'analyze_library', tenant_id: tenantId } });
    await carregarLibrary();
  }, [tenantId, carregarLibrary]);

  const irCriarArte = (itemId: string) => {
    setPresetItemId(itemId);
    irPara('criar');
  };

  const onCreativeAtualizada = (c: Creative) => {
    setCreatives((prev) => {
      const existe = prev.some((x) => x.id === c.id);
      return existe ? prev.map((x) => (x.id === c.id ? c : x)) : [c, ...prev];
    });
  };

  const onCreativeExcluida = (id: string) => {
    setCreatives((prev) => prev.filter((x) => x.id !== id));
  };

  const erroGeral = !tenantId ? null : kitError;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="w-11 h-11 flex items-center justify-center rounded-xl bg-fuchsia-100 border border-fuchsia-200">
          <Palette size={20} className="text-fuchsia-600" />
        </div>
        <div>
          <h1 className="text-xl font-black text-zinc-900 leading-tight">Estúdio de Criação</h1>
          <p className="text-sm text-zinc-400">Artes prontas com a identidade da sua marca e fotos reais do cardápio</p>
        </div>
      </div>

      {/* Abas */}
      <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-0.5 mb-5 flex-wrap">
        {ABAS.map((a) => (
          <button key={a.id} onClick={() => irPara(a.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer ${aba === a.id ? 'bg-fuchsia-600 text-white' : 'text-zinc-500 hover:bg-zinc-50'}`}>
            <a.icon size={13} /> {a.label}
          </button>
        ))}
      </div>

      {erroGeral && (
        <div className="mb-5 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{erroGeral}</span>
        </div>
      )}

      {kitLoading && !kit ? (
        <div className="flex items-center justify-center py-24 text-zinc-400">
          <Loader2 size={24} className="animate-spin text-fuchsia-500" />
        </div>
      ) : (
        <>
          {aba === 'marca' && kit && (
            <MarcaTab
              tenantId={tenantId}
              kit={kit}
              logoUrl={logoUrl}
              fontes={fontes}
              isManager={isManager}
              onSaved={(k) => setKit(k)}
              onLogoChanged={(u) => setLogoUrl(u)}
            />
          )}

          {aba === 'biblioteca' && (
            <BibliotecaTab
              tenantId={tenantId}
              items={library}
              loading={libLoading}
              error={libError}
              isManager={isManager}
              onAnalisar={analisarBiblioteca}
              onCriarArte={irCriarArte}
            />
          )}

          {aba === 'criar' && (
            <CriarTab
              tenantId={tenantId}
              items={library}
              templates={templates}
              kit={kit}
              isManager={isManager}
              presetItemId={presetItemId}
              onGerada={onCreativeAtualizada}
            />
          )}

          {aba === 'galeria' && (
            <GaleriaTab
              tenantId={tenantId}
              creatives={creatives}
              loading={credLoading}
              error={credError}
              isManager={isManager}
              onChanged={onCreativeAtualizada}
              onDeleted={onCreativeExcluida}
            />
          )}
        </>
      )}
    </div>
  );
}
