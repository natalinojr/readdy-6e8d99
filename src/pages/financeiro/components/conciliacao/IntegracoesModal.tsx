import { useCallback, useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import InterSyncPanel from './InterSyncPanel';
import StoneImportPanel from './StoneImportPanel';
import MpImportPanel, { type ParteMp } from './MpImportPanel';
import { quando } from './integracoesUi';

// Janela "Integrações" da Conciliação: uma aba por integração (Inter, Stone, Mercado Pago), cada uma
// mostrando no topo se está funcionando e quando atualizou. Antes eram três painéis empilhados, cada
// um com as próprias datas e botões, e o histórico escondido.

export type AbaIntegracao = 'inter' | 'stone' | 'mp';

interface Situacao { configurada: boolean; erro: string | null; ultima: string | null }
type Cfg = { last_sync_at?: string | null; last_sync_error?: string | null } | null | undefined;

const ABAS: Array<{ id: AbaIntegracao; nome: string; icone: string; cor: string; edge: string }> = [
  { id: 'inter', nome: 'Banco Inter', icone: 'ri-bank-line', cor: 'text-orange-600 bg-orange-100', edge: 'inter-bank' },
  { id: 'stone', nome: 'Stone', icone: 'ri-bank-card-line', cor: 'text-green-600 bg-green-100', edge: 'stone-conciliation' },
  { id: 'mp', nome: 'Mercado Pago', icone: 'ri-bank-card-line', cor: 'text-sky-600 bg-sky-100', edge: 'mp-conciliation' },
];

interface Props {
  /** Maquininha principal da loja ("Como o dinheiro entra") — vem logo depois do banco */
  maquininha: 'stone' | 'mercadopago' | null;
  abaInicial?: AbaIntegracao;
  /** Parte da aba Mercado Pago que abre primeiro (atalho "Taxas do Mercado Pago" → 'taxas') */
  mpParteInicial?: ParteMp;
  interRefreshKey?: number;
  onClose: () => void;
  onChanged: () => void;
  onInterSynced: () => void;
  onConfig: (aba: AbaIntegracao) => void;
  onVerRepassesStone: () => void;
}

export default function IntegracoesModal({ maquininha, abaInicial, mpParteInicial, interRefreshKey, onClose, onChanged, onInterSynced, onConfig, onVerRepassesStone }: Props) {
  const { user } = useAuth();
  const [situacao, setSituacao] = useState<Partial<Record<AbaIntegracao, Situacao>>>({});
  const [aba, setAba] = useState<AbaIntegracao | null>(abaInicial ?? null);

  const ordem = [...ABAS].sort((a, b) => peso(a.id, maquininha) - peso(b.id, maquininha));

  const carregar = useCallback(async () => {
    const resps = await Promise.all(ABAS.map((a) =>
      invokeWithAuth<{ config?: Cfg }>(a.edge, { body: { action: 'get_config', tenant_id: user?.tenantId } })));
    const s: Partial<Record<AbaIntegracao, Situacao>> = {};
    ABAS.forEach((a, i) => {
      const c = resps[i].data?.config;
      s[a.id] = { configurada: Boolean(c), erro: c?.last_sync_error ?? null, ultima: c?.last_sync_at ?? null };
    });
    setSituacao(s);
    // Sem aba escolhida: abre na primeira com erro; senão na primeira configurada.
    setAba((atual) => atual
      ?? ordem.find((a) => s[a.id]?.configurada && s[a.id]?.erro)?.id
      ?? ordem.find((a) => s[a.id]?.configurada)?.id
      ?? 'inter');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId, maquininha]);

  useEffect(() => { carregar(); }, [carregar, interRefreshKey]);

  const depois = () => { onChanged(); carregar(); };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white sm:rounded-2xl w-full max-w-4xl h-full sm:h-auto sm:max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-zinc-900">Integrações</h3>
            <p className="text-xs text-zinc-500">Banco e maquininhas que trazem o extrato para a conciliação</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 px-4 sm:px-6 pt-4 flex-shrink-0">
          {ordem.map((a) => {
            const s = situacao[a.id];
            const ativa = aba === a.id;
            const tom = !s ? 'bg-zinc-300' : !s.configurada ? 'bg-zinc-300' : s.erro ? 'bg-red-500' : 'bg-green-500';
            const legenda = !s ? 'Carregando...' : !s.configurada ? 'Não configurado' : s.erro ? 'Com erro' : s.ultima ? `Atualizado ${quando(s.ultima)}` : 'Ainda não atualizado';
            return (
              <button key={a.id} onClick={() => setAba(a.id)}
                className={`text-left rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${ativa ? 'border-zinc-800 ring-1 ring-zinc-800 bg-white' : 'border-zinc-200 bg-zinc-50 hover:bg-white'}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg ${a.cor} ${s && !s.configurada ? 'opacity-50' : ''}`}>
                    <i className={`${a.icone} text-sm`} />
                  </span>
                  <span className="text-sm font-semibold text-zinc-800 truncate">{a.nome}</span>
                </div>
                <p className={`mt-1.5 flex items-center gap-1.5 text-[11px] truncate ${s?.erro ? 'text-red-600 font-semibold' : 'text-zinc-500'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tom}`} /> {legenda}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {aba === 'inter' && (
            <InterSyncPanel refreshKey={interRefreshKey} onSyncDone={() => { onInterSynced(); carregar(); }} onConfigureClick={() => onConfig('inter')} />
          )}
          {aba === 'stone' && (
            <StoneImportPanel onImportDone={depois} onConfigureClick={() => onConfig('stone')} onVerRepasses={onVerRepassesStone} />
          )}
          {aba === 'mp' && (
            <MpImportPanel onImportDone={depois} onConfigureClick={() => onConfig('mp')} parteInicial={mpParteInicial} />
          )}
          {aba === null && (
            <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" /></div>
          )}
        </div>
      </div>
    </div>
  );
}

// Banco primeiro; depois a maquininha principal da loja; a outra por último.
function peso(id: AbaIntegracao, maquininha: Props['maquininha']) {
  if (id === 'inter') return 0;
  if ((id === 'stone' && maquininha === 'stone') || (id === 'mp' && maquininha === 'mercadopago')) return 1;
  return 2;
}
