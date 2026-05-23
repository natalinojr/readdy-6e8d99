import type { KDSItem, KDSPedido } from '@/types/kds';
import FichaTecnicaKDSModal from './FichaTecnicaKDSModal';
import { useState } from 'react';
import { formatDuration } from '../../../hooks/useKDSTick';

interface Props {
  item: KDSItem;
  pedido: KDSPedido;
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  novo: 'bg-amber-100 text-amber-700 border border-amber-300',
  preparo: 'bg-yellow-100 text-yellow-700 border border-yellow-300',
  pronto: 'bg-green-100 text-green-700 border border-green-300',
  entregue: 'bg-zinc-100 text-zinc-500 border border-zinc-300',
};

const STATUS_LABEL: Record<string, string> = {
  novo: 'Aguardando',
  preparo: 'Em Preparo',
  pronto: 'Pronto',
  entregue: 'Entregue',
};

const ORIGEM_LABEL: Record<string, { label: string; icon: string }> = {
  caixa: { label: 'PDV Caixa', icon: 'ri-store-2-line' },
  garcom: { label: 'Garçom', icon: 'ri-user-line' },
  mesa: { label: 'Mesa (QR Code)', icon: 'ri-qr-code-line' },
  autoatendimento: { label: 'Autoatendimento (Kiosk)', icon: 'ri-tablet-line' },
  delivery: { label: 'Delivery', icon: 'ri-bike-line' },
};

function formatTs(ts?: number) {
  if (!ts) return '--:--:--';
  // Força exibição no fuso local do navegador com formato pt-BR
  return new Date(ts).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

function diffStr(a?: number, b?: number): string {
  if (!a || !b) return '--';
  const diff = Math.floor((b - a) / 1000);
  return formatDuration(diff);
}

export default function KDSItemDetalhe({ item, pedido, onClose }: Props) {
  const [showFicha, setShowFicha] = useState(false);

  const origemCfg = ORIGEM_LABEL[pedido.origem] ?? ORIGEM_LABEL.caixa;

  const tempoEsperaParaPreparo = diffStr(item.entroKdsEm, item.iniciouPreparoEm);
  const tempoDePreparo = diffStr(item.iniciouPreparoEm, item.ficouProntoEm);
  const tempoCozinha = diffStr(item.entroKdsEm, item.ficouProntoEm);
  const tempoEsperaParaEntrega = diffStr(item.ficouProntoEm, item.entregueEm);

  const partesMostrar = item.partes ?? [];

  return (
    <>
      {showFicha && (
        <FichaTecnicaKDSModal
          itens={[{ nome: item.nome, menuItemId: item.menuItemId, quantidade: item.quantidade }]}
          onClose={() => setShowFicha(false)}
        />
      )}
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-100">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-black text-zinc-900 text-lg">
                  {item.quantidade > 1 && (
                    <span className="text-amber-500">{item.quantidade}x </span>
                  )}
                  {item.nome}
                </h2>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[item.status]}`}>
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Pedido #{pedido.numero} · {' '}
                <span className="font-medium text-zinc-500">
                  <i className={`${origemCfg.icon} mr-0.5`} />{origemCfg.label}
                  {pedido.origem === 'garcom' && pedido.garcomNome && ` · ${pedido.garcomNome}`}
                </span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-close-line text-lg" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
            {/* Opções / Adicionais */}
            {item.opcoes.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Opções / Adicionais
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {item.opcoes.map((o, i) => (
                    <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5">
                      <p className="text-[10px] text-zinc-400 font-medium">{o.grupoNome}</p>
                      <p className="text-xs font-bold text-zinc-800">{o.opcaoNome}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Observações em destaque */}
            {item.observacoes.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-4 h-4 flex items-center justify-center">
                    <i className="ri-alert-fill text-amber-500 text-sm" />
                  </div>
                  <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">Observações</p>
                </div>
                <ul className="space-y-1">
                  {item.observacoes.map((obs, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-amber-500 mt-0.5 flex-shrink-0">•</span>
                      <span className="text-sm font-semibold text-amber-800">{obs}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Produção dividida */}
            {partesMostrar.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Produção Dividida (Multi-Estação)
                </p>
                <div className="space-y-2">
                  {partesMostrar.map((parte) => (
                    <div key={parte.id} className="flex items-center justify-between bg-zinc-50 rounded-lg px-3 py-2 border border-zinc-100">
                      <div>
                        <p className="text-xs font-bold text-zinc-800">{parte.nome}</p>
                        <p className="text-[10px] text-zinc-400">{parte.estacao}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLOR[parte.status]}`}>
                        {STATUS_LABEL[parte.status]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rastreamento de Tempos */}
            <div>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Rastreamento de Tempo
              </p>
              <div className="bg-zinc-50 rounded-xl border border-zinc-100 overflow-hidden">
                {[
                  { label: 'Entrou no KDS', ts: item.entroKdsEm, icon: 'ri-login-box-line', color: 'text-zinc-400' },
                  { label: 'Iniciou Preparo', ts: item.iniciouPreparoEm, icon: 'ri-fire-line', color: 'text-amber-500' },
                  { label: 'Ficou Pronto', ts: item.ficouProntoEm, icon: 'ri-check-line', color: 'text-green-500' },
                  { label: 'Entregue', ts: item.entregueEm, icon: 'ri-check-double-line', color: 'text-zinc-400' },
                ].map(({ label, ts, icon, color }, idx, arr) => (
                  <div key={label} className={`flex items-center justify-between px-4 py-2.5 ${idx < arr.length - 1 ? 'border-b border-zinc-100' : ''}`}>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 flex items-center justify-center">
                        <i className={`${icon} text-sm ${ts ? color : 'text-zinc-300'}`} />
                      </div>
                      <span className={`text-xs font-medium ${ts ? 'text-zinc-700' : 'text-zinc-300'}`}>{label}</span>
                    </div>
                    <span className={`text-xs font-bold tabular-nums ${ts ? 'text-zinc-800' : 'text-zinc-300'}`}>
                      {formatTs(ts || undefined)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Durations breakdown */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                {[
                  { label: 'Espera p/ Preparo', value: tempoEsperaParaPreparo, icon: 'ri-time-line', active: !!item.iniciouPreparoEm, desc: 'Entrou KDS → início preparo' },
                  { label: 'Tempo de Preparo', value: tempoDePreparo, icon: 'ri-fire-line', active: !!item.ficouProntoEm, desc: 'Início → pronto' },
                  { label: 'Tempo de Cozinha', value: tempoCozinha, icon: 'ri-restaurant-line', active: !!item.ficouProntoEm, desc: 'Espera + preparo (total)' },
                  { label: 'Espera p/ Entrega', value: tempoEsperaParaEntrega, icon: 'ri-truck-line', active: !!item.entregueEm, desc: 'Pronto → entregue' },
                ].map(({ label, value, icon, active, desc }) => (
                  <div key={label} className={`rounded-lg px-3 py-2 border ${active ? 'bg-white border-zinc-200' : 'bg-zinc-50 border-zinc-100'}`}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <div className="w-3 h-3 flex items-center justify-center">
                        <i className={`${icon} text-[10px] ${active ? 'text-zinc-500' : 'text-zinc-300'}`} />
                      </div>
                      <p className="text-[10px] text-zinc-400 font-medium">{label}</p>
                    </div>
                    <p className={`text-sm font-black tabular-nums ${active ? 'text-zinc-800' : 'text-zinc-300'}`}>{value}</p>
                    <p className="text-[9px] text-zinc-400 mt-0.5">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Responsáveis */}
            <div>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Responsáveis
              </p>
              <div className="space-y-2">
                {[
                  { label: 'Estação de Preparo', value: item.estacao !== 'multi' ? (item.estacao ?? '--') : 'Multi-estação', icon: 'ri-tools-line' },
                  { label: 'Preparado por', value: item.operadorPreparo ?? '--', icon: 'ri-fire-line' },
                  { label: 'Entregue por', value: item.quemEntregou ?? '--', icon: 'ri-user-follow-line' },
                ].map(({ label, value, icon }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 flex items-center justify-center">
                        <i className={`${icon} text-xs text-zinc-400`} />
                      </div>
                      <span className="text-xs text-zinc-500">{label}</span>
                    </div>
                    <span className={`text-xs font-bold ${value === '--' ? 'text-zinc-300' : 'text-zinc-800'}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Ficha Técnica */}
            <button
              onClick={() => setShowFicha(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs font-bold cursor-pointer hover:bg-amber-100 transition-colors"
            >
              <i className="ri-clipboard-line text-sm" />
              Ver Ficha Técnica
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
