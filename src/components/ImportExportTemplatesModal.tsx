import { useState, useRef, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

type TemplateType = 'insumos' | 'dre_categories' | 'catalog_items';

interface TemplatePayload {
  template_type: TemplateType;
  version: string;
  items: unknown[];
}

const TEMPLATE_LABELS: Record<TemplateType, string> = {
  insumos: 'Insumos',
  dre_categories: 'Categorias DRE',
  catalog_items: 'Itens do Catálogo',
};

interface Props {
  open: boolean;
  defaultTab?: TemplateType;
  insumosData?: Array<{
    nome: string; unidade: string; categoria?: string; estoqueMinimo?: number;
    fornecedor?: string; purchaseUnit?: string | null; purchaseFactor?: number;
  }>;
  dreCategoriesData?: Array<{
    name: string; group_type: string; parent_id?: string | null; sort_order: number;
  }>;
  catalogItemsData?: Array<{
    name: string; description?: string; default_unit: string;
    dre_category_id?: string | null; default_supplier?: string | null; notes?: string | null;
  }>;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function ImportExportTemplatesModal({
  open, defaultTab = 'insumos', insumosData, dreCategoriesData, catalogItemsData, onClose, onSuccess,
}: Props) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TemplateType>(defaultTab);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    let data: TemplatePayload;
    switch (activeTab) {
      case 'insumos':
        data = {
          template_type: 'insumos',
          version: '1.0',
          items: (insumosData ?? []).map(i => ({
            nome: i.nome,
            unidade: i.unidade,
            categoria: i.categoria || 'Sem categoria',
            estoque_minimo: i.estoqueMinimo ?? 0,
            fornecedor: i.fornecedor ?? '',
            purchase_unit: i.purchaseUnit ?? null,
            purchase_factor: i.purchaseFactor ?? 1,
          })),
        };
        break;
      case 'dre_categories':
        data = {
          template_type: 'dre_categories',
          version: '1.0',
          items: (dreCategoriesData ?? []).map(c => ({
            name: c.name,
            group_type: c.group_type,
            parent_id: c.parent_id ?? null,
            sort_order: c.sort_order,
          })),
        };
        break;
      case 'catalog_items':
        data = {
          template_type: 'catalog_items',
          version: '1.0',
          items: (catalogItemsData ?? []).map(i => ({
            name: i.name,
            description: i.description ?? '',
            default_unit: i.default_unit,
            dre_category_id: i.dre_category_id ?? null,
            default_supplier: i.default_supplier ?? null,
            notes: i.notes ?? null,
          })),
        };
        break;
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${activeTab}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeTab, insumosData, dreCategoriesData, catalogItemsData]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportError(null);
    setImportSuccess(false);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        setFileContent(text);
      } catch (err) {
        setImportError('Erro ao ler arquivo');
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!fileContent || !user?.tenantId) return;
    setImporting(true);
    setImportError(null);
    setImportSuccess(false);

    try {
      const payload = JSON.parse(fileContent) as TemplatePayload;
      if (!payload.template_type || !Array.isArray(payload.items)) {
        throw new Error('Arquivo JSON inválido. Verifique se é um template exportado do sistema.');
      }

      let action = '';
      switch (activeTab) {
        case 'insumos':
          action = 'bulk_insert_ingredients';
          break;
        case 'dre_categories':
          action = 'bulk_insert_dre_categories';
          break;
        case 'catalog_items':
          action = 'bulk_insert_purchase_catalog';
          break;
      }

      const { data, error } = await invokeWithAuth<{ error?: string; data?: unknown }>('financial-write', {
        body: {
          action,
          tenant_id: user.tenantId,
          payload: { items: payload.items },
        },
      });

      if (error) throw new Error(error.message ?? 'Erro ao importar');
      if ((data as Record<string, unknown>)?.error) throw new Error((data as Record<string, unknown>).error as string);

      setImportSuccess(true);
      setFileContent(null);
      setFileName(null);
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(msg);
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h3 className="font-semibold text-zinc-900 text-sm">Importar / Exportar Templates</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Tabs */}
          <div className="flex bg-zinc-100 rounded-lg p-1">
            {(['insumos', 'dre_categories', 'catalog_items'] as TemplateType[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setActiveTab(t);
                  setFileContent(null);
                  setFileName(null);
                  setImportError(null);
                  setImportSuccess(false);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                  activeTab === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {TEMPLATE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Exportar */}
          <div className="border border-zinc-200 rounded-xl p-4 bg-zinc-50/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 flex items-center justify-center bg-amber-100 rounded-lg">
                  <i className="ri-upload-line text-amber-600 text-sm" />
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-700">Exportar</p>
                  <p className="text-[10px] text-zinc-400">Baixe seus dados como template para usar em outra loja</p>
                </div>
              </div>
              <button
                onClick={handleExport}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
              >
                <i className="ri-download-line mr-1" /> Baixar JSON
              </button>
            </div>
          </div>

          {/* Importar */}
          <div className="border border-zinc-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 flex items-center justify-center bg-green-100 rounded-lg">
                <i className="ri-download-line text-green-600 text-sm" />
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-700">Importar</p>
                <p className="text-[10px] text-zinc-400">Carregue um template JSON exportado anteriormente</p>
              </div>
            </div>

            <input
              type="file"
              ref={fileRef}
              accept=".json,application/json"
              onChange={handleFileSelect}
              className="hidden"
            />

            {!fileName ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full py-3 border-2 border-dashed border-zinc-300 rounded-xl text-xs text-zinc-500 hover:border-amber-400 hover:text-amber-600 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <i className="ri-file-upload-line text-sm" /> Clique para selecionar arquivo JSON
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                <i className="ri-file-text-line text-zinc-400 text-sm" />
                <span className="text-xs text-zinc-700 flex-1 truncate">{fileName}</span>
                <button
                  onClick={() => { setFileName(null); setFileContent(null); setImportError(null); }}
                  className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer"
                >
                  <i className="ri-close-line text-xs" />
                </button>
              </div>
            )}

            {fileName && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="w-full mt-3 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
              >
                {importing ? (
                  <><i className="ri-loader-4-line animate-spin" /> Importando...</>
                ) : (
                  <><i className="ri-import-line" /> Importar {TEMPLATE_LABELS[activeTab]}</>
                )}
              </button>
            )}

            {importSuccess && (
              <div className="mt-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <i className="ri-checkbox-circle-line text-green-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-green-700">Importação concluída com sucesso! Recarregue a página para ver os dados.</p>
              </div>
            )}

            {importError && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <i className="ri-error-warning-line text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{importError}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}