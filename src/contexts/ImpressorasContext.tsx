import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useSystemSettings } from '@/hooks/useSystemSettings';

export type PaperStyle = '80mm' | '58mm';

export interface Impressora {
  id: string;
  nome: string;
  ip: string;
  descricao: string;
  paperStyle: PaperStyle;
}

export type MapaEstacoes = Record<string, string>;

/** Campos customizáveis do template de ticket por estação */
export interface PrintTemplate {
  stationKey: string;       // id da kitchen_station ou 'caixa-pdv'
  showLogo: boolean;
  showOrderNumber: boolean;
  showDateTime: boolean;
  showStationName: boolean;
  showItemObservations: boolean;
  showItemOptions: boolean;
  showCustomerName: boolean;
  showTableInfo: boolean;
  showWaiterName: boolean;
  footerMessage: string;
  headerMessage: string;
}

export type PrintTemplatesMap = Record<string, PrintTemplate>;

interface ImpressorasContextType {
  impressoras: Impressora[];
  mapaEstacoes: MapaEstacoes;
  printTemplates: PrintTemplatesMap;
  getImpressoraParaEstacao: (estacao: string) => Impressora | undefined;
  getTemplateParaEstacao: (estacao: string) => PrintTemplate | undefined;
  addImpressora: (data: Omit<Impressora, 'id'>) => void;
  updateImpressora: (id: string, data: Partial<Omit<Impressora, 'id'>>) => void;
  removeImpressora: (id: string) => void;
  setImpressoraEstacao: (estacao: string, impressoraId: string) => void;
  clearImpressoraEstacao: (estacao: string) => void;
  updatePrintTemplate: (stationKey: string, data: Partial<PrintTemplate>) => void;
  resetPrintTemplate: (stationKey: string) => void;
  salvarImpressoras: () => Promise<void>;
  salvarTemplates: () => Promise<void>;
  salvando: boolean;
}

const ImpressorasContext = createContext<ImpressorasContextType | null>(null);

export const TODAS_ESTACOES_KEY = 'todas-estacoes';

/** Chave especial para usar a impressora padrão do Windows (USB ou qualquer impressora local) */
export const IMPRESSORA_PADRAO_WINDOWS_KEY = 'impressora-padrao-windows';
export const IMPRESSORA_PADRAO_WINDOWS_LABEL = 'Impressora Padrão (USB/Windows)';

function getDefaultTemplate(stationKey: string): PrintTemplate {
  return {
    stationKey,
    showLogo: true,
    showOrderNumber: true,
    showDateTime: true,
    showStationName: true,
    showItemObservations: true,
    showItemOptions: true,
    showCustomerName: true,
    showTableInfo: true,
    showWaiterName: true,
    footerMessage: '',
    headerMessage: '',
  };
}

export function ImpressorasProvider({ children }: { children: React.ReactNode }) {
  const { settings, loading: settingsLoading, salvar } = useSystemSettings();
  const [impressoras, setImpressoras] = useState<Impressora[]>([]);
  const [mapaEstacoes, setMapaEstacoes] = useState<MapaEstacoes>({});
  const [printTemplates, setPrintTemplates] = useState<PrintTemplatesMap>({});
  const [salvando, setSalvando] = useState(false);
  const initialized = useRef(false);

  // Load from DB when settings are ready
  useEffect(() => {
    if (settingsLoading || initialized.current) return;
    initialized.current = true;
    if (settings.printers_config) {
      const cfg = settings.printers_config;
      if (cfg.impressoras && Array.isArray(cfg.impressoras)) {
        setImpressoras(cfg.impressoras.map((i: Impressora) => ({
          ...i,
          paperStyle: i.paperStyle ?? '80mm',
        })));
      }
      if (cfg.mapaEstacoes && typeof cfg.mapaEstacoes === 'object') {
        setMapaEstacoes(cfg.mapaEstacoes as MapaEstacoes);
      }
      if (cfg.printTemplates && typeof cfg.printTemplates === 'object') {
        setPrintTemplates(cfg.printTemplates as PrintTemplatesMap);
      }
    }
  }, [settings, settingsLoading]);

  const salvarImpressoras = useCallback(async () => {
    setSalvando(true);
    await salvar({
      printers_config: { impressoras, mapaEstacoes, printTemplates },
    });
    setSalvando(false);
  }, [impressoras, mapaEstacoes, printTemplates, salvar]);

  const salvarTemplates = useCallback(async () => {
    setSalvando(true);
    await salvar({
      printers_config: { impressoras, mapaEstacoes, printTemplates },
    });
    setSalvando(false);
  }, [impressoras, mapaEstacoes, printTemplates, salvar]);

  const getImpressoraParaEstacao = useCallback(
    (estacao: string): Impressora | undefined => {
      // 1. Mapeamento específico desta estação
      const id = mapaEstacoes?.[estacao];
      if (id) {
        if (id === IMPRESSORA_PADRAO_WINDOWS_KEY) {
          return {
            id: IMPRESSORA_PADRAO_WINDOWS_KEY,
            nome: IMPRESSORA_PADRAO_WINDOWS_LABEL,
            ip: '',
            descricao: 'Usa a impressora padrão definida no Windows',
            paperStyle: '80mm',
          };
        }
        return impressoras.find((i) => i.id === id);
      }
      // 2. Fallback: "todas as estações" quando nenhum mapeamento específico
      const fallbackId = mapaEstacoes?.[TODAS_ESTACOES_KEY];
      if (fallbackId) {
        if (fallbackId === IMPRESSORA_PADRAO_WINDOWS_KEY) {
          return {
            id: IMPRESSORA_PADRAO_WINDOWS_KEY,
            nome: IMPRESSORA_PADRAO_WINDOWS_LABEL,
            ip: '',
            descricao: 'Usa a impressora padrão definida no Windows',
            paperStyle: '80mm',
          };
        }
        return impressoras.find((i) => i.id === fallbackId);
      }
      return undefined;
    },
    [impressoras, mapaEstacoes],
  );

  const getTemplateParaEstacao = useCallback(
    (estacao: string): PrintTemplate | undefined => {
      return printTemplates?.[estacao] ?? getDefaultTemplate(estacao);
    },
    [printTemplates],
  );

  const addImpressora = useCallback((data: Omit<Impressora, 'id'>) => {
    setImpressoras((prev) => [...prev, { ...data, id: `imp-${Date.now()}`, paperStyle: data.paperStyle ?? '80mm' }]);
  }, []);

  const updateImpressora = useCallback((id: string, data: Partial<Omit<Impressora, 'id'>>) => {
    setImpressoras((prev) => prev.map((i) => (i.id === id ? { ...i, ...data } : i)));
  }, []);

  const removeImpressora = useCallback((id: string) => {
    setImpressoras((prev) => prev.filter((i) => i.id !== id));
    setMapaEstacoes((prev) => {
      const next = { ...prev };
      Object.entries(next).forEach(([k, v]) => { if (v === id) delete next[k]; });
      return next;
    });
  }, []);

  const setImpressoraEstacao = useCallback((estacao: string, impressoraId: string) => {
    setMapaEstacoes((prev) => ({ ...prev, [estacao]: impressoraId }));
  }, []);

  const clearImpressoraEstacao = useCallback((estacao: string) => {
    setMapaEstacoes((prev) => { const next = { ...prev }; delete next[estacao]; return next; });
  }, []);

  const updatePrintTemplate = useCallback((stationKey: string, data: Partial<PrintTemplate>) => {
    setPrintTemplates((prev) => ({
      ...prev,
      [stationKey]: { ...(prev[stationKey] ?? getDefaultTemplate(stationKey)), ...data, stationKey },
    }));
  }, []);

  const resetPrintTemplate = useCallback((stationKey: string) => {
    setPrintTemplates((prev) => { const next = { ...prev }; delete next[stationKey]; return next; });
  }, []);

  return (
    <ImpressorasContext.Provider value={{
      impressoras, mapaEstacoes, printTemplates,
      getImpressoraParaEstacao, getTemplateParaEstacao,
      addImpressora, updateImpressora, removeImpressora,
      setImpressoraEstacao, clearImpressoraEstacao,
      updatePrintTemplate, resetPrintTemplate,
      salvarImpressoras, salvarTemplates, salvando,
    }}>
      {children}
    </ImpressorasContext.Provider>
  );
}

export function useImpressoras() {
  const ctx = useContext(ImpressorasContext);
  if (!ctx) throw new Error('useImpressoras must be used inside ImpressorasProvider');
  return ctx;
}
