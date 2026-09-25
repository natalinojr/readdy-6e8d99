import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, Check, Loader2, Smartphone, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import BotaoAvisos from '@/components/feature/BotaoAvisos';
import { modoDemo } from '../demo/modoDemo';
import { useVoltarFecha } from '@/lib/voltarAndroid';

export interface PrefsAvisos {
  ativo: boolean;
  /** minutos antes do vencimento (0 = na hora) */
  lembretes: number[];
  hora_dia_todo: string;
  vibrar: boolean;
  incluir_criadas_sem_resp: boolean;
}

export const PREFS_PADRAO: PrefsAvisos = {
  ativo: true, lembretes: [60, 0], hora_dia_todo: '08:00', vibrar: true, incluir_criadas_sem_resp: true,
};

export const OPCOES_LEMBRETE: Array<{ min: number; label: string }> = [
  { min: 0, label: 'Na hora' },
  { min: 15, label: '15 min antes' },
  { min: 30, label: '30 min antes' },
  { min: 60, label: '1h antes' },
  { min: 180, label: '3h antes' },
  { min: 1440, label: '1 dia antes' },
];

/**
 * Configuração dos avisos de vencimento (por pessoa, vale em qualquer aparelho).
 * O envio é feito no servidor (pg_cron → edge task-lembretes), então o aviso
 * chega com o app fechado — desde que este aparelho tenha os avisos ativados.
 */
export default function ConfigAvisos({ tenantId, write, onClose }: {
  tenantId: string | null;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}) {
  useVoltarFecha(true, onClose, 'tarefas-avisos');
  const toast = useToast();
  const [prefs, setPrefs] = useState<PrefsAvisos | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    if (modoDemo()) { setPrefs(PREFS_PADRAO); return; }
    supabase.rpc('fn_get_task_notification_prefs').then(({ data, error }) => {
      if (error || !data) { setPrefs(PREFS_PADRAO); return; }
      const d = data as Partial<PrefsAvisos>;
      setPrefs({ ...PREFS_PADRAO, ...d, lembretes: Array.isArray(d.lembretes) ? d.lembretes : PREFS_PADRAO.lembretes });
    });
  }, []);

  const alternarLembrete = (min: number) => {
    if (!prefs) return;
    const tem = prefs.lembretes.includes(min);
    setPrefs({ ...prefs, lembretes: tem ? prefs.lembretes.filter((m) => m !== min) : [...prefs.lembretes, min] });
  };

  const salvar = async () => {
    if (!prefs) return;
    setSalvando(true);
    const res = await write('set_notification_prefs', { ...prefs });
    setSalvando(false);
    if (!res.success) { toast.error('Não foi possível salvar', res.error); return; }
    toast.success('Avisos salvos');
    onClose();
  };

  const testar = async () => {
    setTestando(true);
    const { enviarPushTeste } = await import('@/lib/push');
    const r = await enviarPushTeste(tenantId);
    setTestando(false);
    if (r.ok) toast.success('Aviso de teste enviado', 'Se não chegou, ative os avisos neste aparelho.');
    else toast.error('Não foi possível enviar o teste', r.erro);
  };

  const conteudo = (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-slate-900/40 md:p-4" onClick={onClose}>
      <div
        className="w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[88vh] overflow-y-auto pb-[max(env(safe-area-inset-bottom),12px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="md:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200" />
        <div className="flex items-center gap-2.5 px-5 pt-3 md:pt-4 pb-3 border-b border-slate-100">
          <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><BellRing size={16} /></span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm md:text-sm max-md:text-base font-semibold text-slate-800">Avisos de vencimento</h2>
            <p className="text-[11px] text-slate-400">Das tarefas que estão com você</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>

        {!prefs ? (
          <div className="p-8 flex justify-center"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
        ) : (
          <div className="px-5 py-4 space-y-5">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm max-md:text-[15px] text-slate-700 font-medium">Avisar quando a tarefa for vencer</span>
              <input
                type="checkbox"
                checked={prefs.ativo}
                onChange={(e) => setPrefs({ ...prefs, ativo: e.target.checked })}
                className="w-5 h-5 rounded border-slate-300 text-indigo-600"
              />
            </label>

            <div className={prefs.ativo ? '' : 'opacity-40 pointer-events-none'}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Quando avisar</p>
              <div className="flex flex-wrap gap-2">
                {OPCOES_LEMBRETE.map((o) => {
                  const on = prefs.lembretes.includes(o.min);
                  return (
                    <button
                      key={o.min}
                      onClick={() => alternarLembrete(o.min)}
                      className={`flex items-center gap-1 px-3 py-2 rounded-xl text-sm border transition ${
                        on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {on && <Check size={13} />}
                      {o.label}
                    </button>
                  );
                })}
              </div>
              {prefs.lembretes.length === 0 && <p className="text-[11px] text-amber-600 mt-1.5">Nenhum momento marcado — nenhum aviso vai sair.</p>}

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-sm max-md:text-[15px] text-slate-600">
                  Tarefa sem horário: contar a partir de
                  <span className="block text-[11px] text-slate-400">ex.: "na hora" = avisa nesse horário do dia do vencimento</span>
                </span>
                <input
                  type="time"
                  value={prefs.hora_dia_todo}
                  onChange={(e) => setPrefs({ ...prefs, hora_dia_todo: e.target.value || '08:00' })}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm max-md:text-base outline-none focus:border-indigo-300"
                />
              </div>

              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-5 mb-2">Como avisar</p>
              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <span className="text-sm max-md:text-[15px] text-slate-600">
                  Vibrar e tocar no celular
                  <span className="block text-[11px] text-slate-400">No iPhone quem decide som e vibração é o próprio sistema</span>
                </span>
                <input type="checkbox" checked={prefs.vibrar} onChange={(e) => setPrefs({ ...prefs, vibrar: e.target.checked })}
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600" />
              </label>
              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
                <span className="text-sm max-md:text-[15px] text-slate-600">Também as que criei e estão sem responsável</span>
                <input type="checkbox" checked={prefs.incluir_criadas_sem_resp}
                  onChange={(e) => setPrefs({ ...prefs, incluir_criadas_sem_resp: e.target.checked })}
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600" />
              </label>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><Smartphone size={13} /> Neste aparelho</p>
              <p className="text-[11px] text-slate-400">O aviso chega mesmo com o app fechado — em cada celular/computador é preciso ativar uma vez.</p>
              <BotaoAvisos tenantId={tenantId} titulo="Ativar avisos neste aparelho" />
              <button onClick={testar} disabled={testando} className="text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                {testando ? 'Enviando…' : 'Enviar um aviso de teste'}
              </button>
            </div>

            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 text-sm text-slate-600 py-2.5 max-md:py-3 hover:bg-slate-50">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="flex-1 rounded-xl bg-indigo-600 text-white text-sm font-medium py-2.5 max-md:py-3 hover:bg-indigo-700 disabled:opacity-50">
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  return createPortal(conteudo, document.body);
}
