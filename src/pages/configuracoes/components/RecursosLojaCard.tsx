import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { RECURSOS_LOJA, type RecursoLoja } from '@/constants/recursosLoja';
import TvSenhasBloco from './TvSenhasBloco';

/**
 * Recursos novos que esta loja liga ou desliga (padrão: desligado).
 * Grava na hora (config-write › set_recurso: liga/desliga UMA chave no banco, sem apagar as outras)
 * e só diz "ligado" se gravou. Só Administrador e Supervisor (o servidor confere).
 */
export default function RecursosLojaCard() {
  const { settings, loadError, carregar } = useSystemSettings();
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const [gravando, setGravando] = useState<RecursoLoja | null>(null);

  const alternar = async (chave: RecursoLoja, nome: string) => {
    const ligar = settings.recursos?.[chave] !== true;
    setGravando(chave);
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: { action: 'set_recurso', tenant_id: user?.tenantId, chave, ligado: ligar },
    });
    setGravando(null);
    if (!error && data?.success) {
      await carregar();
      toastSuccess(ligar ? `${nome}: ligado nesta loja` : `${nome}: desligado nesta loja`);
    } else {
      let msg = data?.error || error?.message || 'Tente de novo.';
      try { const j = JSON.parse(msg); if (j?.error) msg = j.error; } catch { /* texto comum */ }
      toastError(`Não mudou: ${nome}`, msg);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={16} className="text-amber-600" />
        <h3 className="text-sm font-bold text-zinc-800">Recursos novos desta loja</h3>
      </div>
      <p className="text-xs text-zinc-500 mb-4">Cada loja escolhe o que usar. Desligado, a loja continua como hoje.</p>
      <div className="divide-y divide-zinc-100">
        {RECURSOS_LOJA.map((r) => {
          const ligado = settings.recursos?.[r.chave] === true;
          const travado = !r.pronto || !!loadError || gravando !== null;
          return (
            <div key={r.chave} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-800">
                  {r.nome}
                  {!r.pronto && <span className="ml-2 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5">em preparo</span>}
                </p>
                <p className="text-xs text-zinc-500">{r.descricao}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={ligado}
                disabled={travado}
                onClick={() => alternar(r.chave, r.nome)}
                className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${ligado ? 'bg-amber-500' : 'bg-zinc-300'} ${travado ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                title={!r.pronto ? 'Ainda em construção' : ligado ? 'Desligar nesta loja' : 'Ligar nesta loja'}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${ligado ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
          );
        })}
      </div>
      {settings.recursos?.tv_senhas === true && <TvSenhasBloco />}
    </div>
  );
}
