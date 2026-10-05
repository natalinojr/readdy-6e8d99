import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useAuth } from '@/contexts/AuthContext';
import { empresaTemPdv } from '@/lib/tipoEmpresa';

export type PaperStyle = '80mm' | '58mm';

export interface Impressora {
  id: string;
  nome: string;
  ip: string;
  descricao: string;
  paperStyle: PaperStyle;
}

export type MapaEstacoes = Record<string, string>;

/** Campos customizaveis do template de ticket por estacao */
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
  salvarImpressoras: () => Promise<ResultadoSalvar>;
  salvarTemplates: () => Promise<ResultadoSalvar>;
  salvando: boolean;
  /** Mensagem do último salvamento que falhou (manual ou automático). null = tudo gravado. */
  erroSalvar: string | null;
}

export interface ResultadoSalvar { success: boolean; error: string | null }

const ImpressorasContext = createContext<ImpressorasContextType | null>(null);

export const TODAS_ESTACOES_KEY = 'todas-estacoes';

/** Chave especial para usar a impressora padrao do Windows (USB ou qualquer impressora local) */
export const IMPRESSORA_PADRAO_WINDOWS_KEY = 'impressora-padrao-windows';
export const IMPRESSORA_PADRAO_WINDOWS_LABEL = 'Impressora Padrao (USB/Windows)';

// Chaves dos pontos fixos de impressao
export const PRINTER_KEY_CAIXA_PDV = 'caixa-pdv';
export const PRINTER_KEY_CLIENTE = 'cliente';
export const PRINTER_KEY_PEDIDOS = 'pedidos';
export const PRINTER_KEY_GESTOR_PEDIDOS = 'gestor-pedidos';
export const PRINTER_KEY_RELATORIOS = 'relatorios';
export const PRINTER_KEY_QRCODES = 'qrcodes';

// ── Chave do localStorage ────────────────────────────────────────────────────
const LOCAL_STORAGE_KEY_PREFIX = 'hotbar_printers_config_backup';

function getTenantStorageKey(tenantId: string): string {
  return `${LOCAL_STORAGE_KEY_PREFIX}_${tenantId}`;
}

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

interface PrintersBackup {
  impressoras: Impressora[];
  mapaEstacoes: MapaEstacoes;
  printTemplates: PrintTemplatesMap;
  savedAt: string;
}

function salvarLocalStorage(tenantId: string, data: PrintersBackup) {
  if (!tenantId) return;
  try {
    localStorage.setItem(getTenantStorageKey(tenantId), JSON.stringify(data));
    console.log('[ImpressorasContext] Backup salvo no localStorage para tenant:', tenantId);
  } catch (e) {
    console.warn('[ImpressorasContext] Nao foi possivel salvar no localStorage:', e);
  }
}

function lerLocalStorage(tenantId: string): PrintersBackup | null {
  if (!tenantId) return null;
  try {
    const raw = localStorage.getItem(getTenantStorageKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.impressoras) && typeof parsed.mapaEstacoes === 'object') {
      console.log('[ImpressorasContext] Backup restaurado do localStorage para tenant:', tenantId, 'de:', parsed.savedAt);
      return parsed as PrintersBackup;
    }
  } catch (e) {
    console.warn('[ImpressorasContext] Erro ao ler localStorage:', e);
  }
  return null;
}

export function ImpressorasProvider({ children }: { children: React.ReactNode }) {
  const { settings, loading: settingsLoading, salvar } = useSystemSettings();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [impressoras, setImpressoras] = useState<Impressora[]>([]);
  const [mapaEstacoes, setMapaEstacoes] = useState<MapaEstacoes>({});
  const [printTemplates, setPrintTemplates] = useState<PrintTemplatesMap>({});
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  // Sobe a cada falha do auto-save para ele tentar de novo sozinho (ver efeito abaixo).
  const [tentarDeNovo, setTentarDeNovo] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tentativasRef = useRef(0);
  const lojaAtualRef = useRef<string | undefined>(undefined);
  // Guarda a ultima config do banco pra saber quando sincronizar (evita sobrescrever edicoes locais)
  const lastDbConfigRef = useRef<string>('');
  // Guarda o ultimo tenantId pra detectar troca de loja
  const lastTenantIdRef = useRef<string>('');

  // Ref para o debounce do auto-save
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flag: ja inicializou do banco ou localStorage
  const initializedRef = useRef(false);
  // Dirty flag: só há o que salvar quando o USUÁRIO alterou algo (nunca no carregamento).
  // Sem isso o auto-save regravava printers_config a cada carga (403 no totem/caixa).
  const dirtyRef = useRef(false);
  const podeSalvarConfig = user?.perfil === 'admin' || user?.perfil === 'gerente';

  // ── Reseta estado quando troca de tenant ──
  useEffect(() => {
    if (tenantId && tenantId !== lastTenantIdRef.current) {
      console.log('[ImpressorasContext] Tenant mudou de', lastTenantIdRef.current, 'para', tenantId, '— resetando estado');
      lastTenantIdRef.current = tenantId;
      setImpressoras([]);
      setMapaEstacoes({});
      setPrintTemplates({});
      initializedRef.current = false;
      dirtyRef.current = false;
      lastDbConfigRef.current = '';
      setErroSalvar(null);
    }
  }, [tenantId]);

  // ── Sincroniza estado local com o banco sempre que settings.printers_config mudar ──
  useEffect(() => {
    if (settingsLoading) return;
    if (!tenantId) return;
    // Empresa financeira (sem PDV): não tem impressora — não sincroniza do banco.
    if (!empresaTemPdv(user?.tenantKind)) return;
    // CRÍTICO: settings ainda pertencem a outra loja (troca de loja em andamento).
    // Sincronizar aqui copiaria a config de impressoras da loja anterior — e o
    // auto-save gravaria essa cópia no banco da loja atual.
    if (settings.tenant_id !== tenantId) return;

    let cfg = settings.printers_config;
    if (!cfg || !cfg.impressoras || !Array.isArray(cfg.impressoras)) {
      // Tenta recuperar do localStorage como fallback (AGORA POR TENANT!)
      const backup = lerLocalStorage(tenantId);
      if (backup && backup.impressoras.length > 0) {
        console.log('[ImpressorasContext] Usando backup do localStorage (Supabase sem dados) para tenant:', tenantId);
        setImpressoras(backup.impressoras.map((i: Impressora) => ({
          ...i,
          paperStyle: i.paperStyle ?? '80mm',
        })));
        if (backup.mapaEstacoes && typeof backup.mapaEstacoes === 'object') {
          setMapaEstacoes(backup.mapaEstacoes as MapaEstacoes);
        }
        if (backup.printTemplates && typeof backup.printTemplates === 'object') {
          setPrintTemplates(backup.printTemplates as PrintTemplatesMap);
        }
        initializedRef.current = true;
      }
      return;
    }

    const cfgJson = JSON.stringify(cfg);
    if (cfgJson === lastDbConfigRef.current) return;
    lastDbConfigRef.current = cfgJson;

    console.log('[ImpressorasContext] Sincronizando do Supabase:', {
      tenant: tenantId,
      impressoras: cfg.impressoras?.length,
      estacoes: Object.keys(cfg.mapaEstacoes ?? {}).length,
      templates: Object.keys(cfg.printTemplates ?? {}).length,
    });

    const updatedImpressoras = cfg.impressoras.map((i: Impressora) => ({
      ...i,
      paperStyle: i.paperStyle ?? '80mm',
    }));
    setImpressoras(updatedImpressoras);
    setMapaEstacoes((cfg.mapaEstacoes as MapaEstacoes) ?? {});
    setPrintTemplates((cfg.printTemplates as PrintTemplatesMap) ?? {});

    // Atualiza backup local com os dados do banco
    salvarLocalStorage(tenantId, {
      impressoras: updatedImpressoras,
      mapaEstacoes: (cfg.mapaEstacoes as MapaEstacoes) ?? {},
      printTemplates: (cfg.printTemplates as PrintTemplatesMap) ?? {},
      savedAt: new Date().toISOString(),
    });

    initializedRef.current = true;
  }, [settings, settingsLoading, tenantId, user?.tenantKind]);

  // Grava no banco e devolve o resultado de verdade. A cópia local (backup) é feita sempre,
  // para não perder a edição se o banco estiver fora; quem chama só deve dizer "salvo" se success.
  const gravarConfig = useCallback(async (): Promise<ResultadoSalvar> => {
    if (!tenantId) return { success: false, error: 'Nenhuma loja selecionada.' };
    let resultado: ResultadoSalvar;
    try {
      resultado = await salvar({
        printers_config: { impressoras, mapaEstacoes, printTemplates },
      });
    } catch (e) {
      resultado = { success: false, error: e instanceof Error ? e.message : String(e) };
    }
    salvarLocalStorage(tenantId, {
      impressoras,
      mapaEstacoes,
      printTemplates,
      savedAt: new Date().toISOString(),
    });
    if (resultado.success) {
      setErroSalvar(null);
    } else {
      console.error('[ImpressorasContext] Erro ao salvar no Supabase:', resultado.error);
      setErroSalvar(resultado.error || 'Não foi possível salvar.');
    }
    return resultado;
  }, [impressoras, mapaEstacoes, printTemplates, salvar, tenantId]);

  const salvarManual = useCallback(async (): Promise<ResultadoSalvar> => {
    setSalvando(true);
    // Mesmo esquema do auto-save: limpa o "sujo" antes e devolve se falhar.
    // Edição feita durante o salvamento marca sujo de novo e não é perdida.
    dirtyRef.current = false;
    const r = await gravarConfig();
    if (!r.success) dirtyRef.current = true;
    setSalvando(false);
    return r;
  }, [gravarConfig]);

  const salvarImpressoras = salvarManual;
  const salvarTemplates = salvarManual;

  // ── Auto-save com debounce: sempre que impressoras, mapaEstacoes ou printTemplates mudar ──
  useEffect(() => {
    // So dispara auto-save apos a inicializacao inicial (evita salvar estado vazio no primeiro render)
    if (!initializedRef.current) return;
    // Só salva alteração feita pelo usuário, e só se o papel pode gravar configurações
    if (!dirtyRef.current || !podeSalvarConfig) return;
    if (!tenantId) return;
    // Nao salva enquanto as settings em memoria forem de outra loja
    if (settings.tenant_id !== tenantId) return;
    // Se nao tem nada configurado ainda, nao salva
    if (impressoras.length === 0 && Object.keys(mapaEstacoes).length === 0) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      // Um salvamento manual pode já ter gravado tudo nesse meio tempo.
      if (!dirtyRef.current) return;
      console.log('[ImpressorasContext] Auto-save disparado (debounce 2s) para tenant:', tenantId);
      dirtyRef.current = false;
      const lojaDoDisparo = tenantId;
      gravarConfig().then((r) => {
        // Trocou de loja enquanto gravava: o resultado é da loja anterior, ignora.
        if (lojaDoDisparo !== lojaAtualRef.current) return;
        if (r.success) {
          tentativasRef.current = 0;
          console.log('[ImpressorasContext] Auto-save concluido');
          return;
        }
        // Não gravou: continua "sujo" e tenta de novo em 20s, no máximo 3 vezes (falha fixa não fica tentando para sempre).
        dirtyRef.current = true;
        tentativasRef.current += 1;
        if (tentativasRef.current >= 3) return;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => setTentarDeNovo((n) => n + 1), 20000);
      });
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [impressoras, mapaEstacoes, printTemplates, gravarConfig, tenantId, settings.tenant_id, podeSalvarConfig, tentarDeNovo]);

  // Limpa o timer de nova tentativa ao sair / trocar de loja.
  useEffect(() => {
    lojaAtualRef.current = tenantId;
    tentativasRef.current = 0;
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [tenantId]);

  const getImpressoraParaEstacao = useCallback(
    (estacao: string): Impressora | undefined => {
      console.log('[ImpressorasContext] Buscando impressora para estacao:', estacao);
      console.log('[ImpressorasContext] Mapa de estacoes:', mapaEstacoes);
      console.log('[ImpressorasContext] Impressoras cadastradas:', impressoras.map(i => ({ id: i.id, nome: i.nome, ip: i.ip })));

      // 1. Mapeamento especifico desta estacao
      const id = mapaEstacoes?.[estacao];
      if (id) {
        console.log('[ImpressorasContext] Mapeamento especifico encontrado:', id);
        if (id === IMPRESSORA_PADRAO_WINDOWS_KEY) {
          console.warn('[ImpressorasContext] Mapeamento aponta para Impressora Padrao Windows (sem IP → abrira janela)');
          return {
            id: IMPRESSORA_PADRAO_WINDOWS_KEY,
            nome: IMPRESSORA_PADRAO_WINDOWS_LABEL,
            ip: '',
            descricao: 'Usa a impressora padrao definida no Windows',
            paperStyle: '80mm',
          };
        }
        const imp = impressoras.find((i) => i.id === id);
        if (imp) {
          console.log('[ImpressorasContext] Impressora especifica encontrada:', imp.nome, 'IP:', imp.ip || 'SEM IP');
          return imp;
        }
      }

      // 2. Fallback: "todas as estacoes" quando nenhum mapeamento especifico
      const fallbackId = mapaEstacoes?.[TODAS_ESTACOES_KEY];
      if (fallbackId) {
        console.log('[ImpressorasContext] Fallback geral encontrado:', fallbackId);
        if (fallbackId === IMPRESSORA_PADRAO_WINDOWS_KEY) {
          console.warn('[ImpressorasContext] Fallback geral aponta para Impressora Padrao Windows (sem IP → abrira janela)');
          return {
            id: IMPRESSORA_PADRAO_WINDOWS_KEY,
            nome: IMPRESSORA_PADRAO_WINDOWS_LABEL,
            ip: '',
            descricao: 'Usa a impressora padrao definida no Windows',
            paperStyle: '80mm',
          };
        }
        const imp = impressoras.find((i) => i.id === fallbackId);
        if (imp) {
          console.log('[ImpressorasContext] Impressora fallback geral encontrada:', imp.nome, 'IP:', imp.ip || 'SEM IP');
          return imp;
        }
      }

      // 3. Fallback final: primeira impressora de rede (com IP) cadastrada no sistema
      const rede = impressoras.find((i) => i.ip && i.ip.trim() !== '');
      if (rede) {
        console.log('[ImpressorasContext] Fallback automatico — usando primeira impressora de rede:', rede.nome, 'IP:', rede.ip);
        return rede;
      }

      console.warn('[ImpressorasContext] NENHUMA impressora encontrada para estacao:', estacao, '→ imprimira via navegador (janela)');
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
    dirtyRef.current = true;
    setImpressoras((prev) => [...prev, { ...data, id: `imp-${Date.now()}`, paperStyle: data.paperStyle ?? '80mm' }]);
  }, []);

  const updateImpressora = useCallback((id: string, data: Partial<Omit<Impressora, 'id'>>) => {
    dirtyRef.current = true;
    setImpressoras((prev) => prev.map((i) => (i.id === id ? { ...i, ...data } : i)));
  }, []);

  const removeImpressora = useCallback((id: string) => {
    dirtyRef.current = true;
    setImpressoras((prev) => prev.filter((i) => i.id !== id));
    setMapaEstacoes((prev) => {
      const next = { ...prev };
      Object.entries(next).forEach(([k, v]) => { if (v === id) delete next[k]; });
      return next;
    });
  }, []);

  const setImpressoraEstacao = useCallback((estacao: string, impressoraId: string) => {
    dirtyRef.current = true;
    setMapaEstacoes((prev) => ({ ...prev, [estacao]: impressoraId }));
  }, []);

  const clearImpressoraEstacao = useCallback((estacao: string) => {
    dirtyRef.current = true;
    setMapaEstacoes((prev) => { const next = { ...prev }; delete next[estacao]; return next; });
  }, []);

  const updatePrintTemplate = useCallback((stationKey: string, data: Partial<PrintTemplate>) => {
    dirtyRef.current = true;
    setPrintTemplates((prev) => ({
      ...prev,
      [stationKey]: { ...(prev[stationKey] ?? getDefaultTemplate(stationKey)), ...data, stationKey },
    }));
  }, []);

  const resetPrintTemplate = useCallback((stationKey: string) => {
    dirtyRef.current = true;
    setPrintTemplates((prev) => { const next = { ...prev }; delete next[stationKey]; return next; });
  }, []);

  return (
    <ImpressorasContext.Provider value={{
      impressoras, mapaEstacoes, printTemplates,
      getImpressoraParaEstacao, getTemplateParaEstacao,
      addImpressora, updateImpressora, removeImpressora,
      setImpressoraEstacao, clearImpressoraEstacao,
      updatePrintTemplate, resetPrintTemplate,
      salvarImpressoras, salvarTemplates, salvando, erroSalvar,
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