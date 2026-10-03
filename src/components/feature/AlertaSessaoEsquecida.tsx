import { useSessaoEsquecida } from '@/hooks/useSessaoFaturamento';
import { usePermissoes } from '@/hooks/usePermissoes';

// Loja (sessão) aberta de madrugada sem vendas: oferece "Fechar a loja", que abre o mesmo fluxo
// guiado do PDV (FecharLojaModal, 2026-10-03) — conta o caixa, confere e fecha o dia.
export default function AlertaSessaoEsquecida({ onFecharLoja }: { onFecharLoja: () => void }) {
  const { sessaoEsquecida, dismiss } = useSessaoEsquecida();
  const { hasPermissao } = usePermissoes();

  if (!sessaoEsquecida) return null;

  return (
    <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-red-100 flex-shrink-0">
        <i className="ri-alarm-warning-line text-red-600 text-lg" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-red-800">
          A loja está aberta sem vendas há {sessaoEsquecida.horasAberta}h
        </p>
        <p className="text-xs text-red-700 mt-0.5">
          Ela foi aberta em {sessaoEsquecida.abertaEm} e passou da meia-noite sem nenhuma venda nas últimas
          4 horas. Provavelmente alguém esqueceu de fechar.
        </p>

        <div className="flex items-center gap-2 mt-3">
          {hasPermissao('pdv_fechar_caixa') && <button
            onClick={() => { dismiss(); onFecharLoja(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-store-2-line" />
            Fechar a loja agora
          </button>}
          <button
            onClick={dismiss}
            className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
          >
            Ignorar por agora
          </button>
        </div>
      </div>
    </div>
  );
}
