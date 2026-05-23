import { useState } from 'react';
import { useAprovacoes, type SolicitacaoAprovacao, type StatusAprovacao } from '../../contexts/AprovacoesContext';
import { useAuth } from '../../contexts/AuthContext';

const fmt = (ts: number) => {
  const diff = Math.floor((Date.now() - ts) / 60000);
  if (diff < 1) return 'agora';
  if (diff < 60) return `${diff}min`;
  return `${Math.floor(diff / 60)}h`;
};

const fmtPrice = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const TIPO_PROBLEMA_LABEL: Record<string, string> = {
  qualidade: 'Qualidade',
  item_errado: 'Item errado',
  nao_chegou: 'Não chegou',
  quantidade: 'Quantidade errada',
  alergia: 'Alergia/Restrição',
  outro: 'Outro',
};

const RESOLUCAO_LABEL: Record<string, string> = {
  substituicao: 'Substituição',
  reembolso: 'Reembolso',
  desconto: 'Desconto',
  registro: 'Registro apenas',
};

const STATUS_CONFIG: Record<StatusAprovacao, { label: string; bg: string; text: string }> = {
  pendente: { label: 'Pendente', bg: 'bg-amber-100', text: 'text-amber-700' },
  aprovado: { label: 'Aprovado', bg: 'bg-green-100', text: 'text-green-700' },
  rejeitado: { label: 'Rejeitado', bg: 'bg-red-100', text: 'text-red-600' },
};

function DescontoCard({ s, onAprovar, onRejeitar }: {
  s: SolicitacaoAprovacao;
  onAprovar: (id: string) => void;
  onRejeitar: (id: string) => void;
}) {
  const cfg = STATUS_CONFIG[s.status];
  const [showItens, setShowItens] = useState(false);
  const temItens = (s.itensPedido?.length ?? 0) > 0;

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${
      s.status === 'pendente' ? 'border-amber-300 ring-1 ring-amber-200' : 'border-zinc-200'
    }`}>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 bg-amber-100">
            <i className="ri-shield-keyhole-line text-amber-600 text-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-sm font-black text-zinc-900">Autorização de Desconto</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                {cfg.label}
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              {s.mesaNome} · Operador: <span className="font-semibold text-zinc-700">{s.garcomNome}</span>
              {' · '}<span className="text-zinc-400">{fmt(s.criadoEmTs)}</span>
            </p>
          </div>
        </div>

        {/* Valor destaque */}
        <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Desconto solicitado</p>
            <p className="text-xs text-amber-700 mt-0.5 truncate">{s.descricao}</p>
          </div>
          <span className="text-xl font-black text-amber-700 flex-shrink-0 ml-3">
            {s.valorDesconto !== undefined ? fmtPrice(s.valorDesconto) : s.itemNome}
          </span>
        </div>

        {/* Botão ver pedido */}
        {temItens && (
          <button
            onClick={() => setShowItens((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-xl mb-3 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2">
              <i className="ri-receipt-line text-zinc-500 text-sm" />
              <span className="text-xs font-semibold text-zinc-700">
                Ver pedido ({s.itensPedido!.reduce((a, i) => a + i.quantidade, 0)} itens
                {s.totalPedido !== undefined ? ` · ${fmtPrice(s.totalPedido)}` : ''})
              </span>
            </div>
            <i className={`ri-arrow-down-s-line text-zinc-400 text-base transition-transform ${showItens ? 'rotate-180' : ''}`} />
          </button>
        )}

        {/* Itens do pedido expandido */}
        {showItens && temItens && (
          <div className="mb-3 border border-zinc-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-zinc-50 border-b border-zinc-200">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Itens do pedido</p>
            </div>
            <div className="divide-y divide-zinc-100">
              {s.itensPedido!.map((item, idx) => (
                <div key={idx} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-800">
                        <span className="text-amber-600 font-bold">{item.quantidade}x </span>
                        {item.nome}
                      </p>
                      {item.opcoes && item.opcoes.length > 0 && (
                        <p className="text-[10px] text-zinc-400 mt-0.5 truncate">{item.opcoes.join(' · ')}</p>
                      )}
                      {item.observacoes && item.observacoes.length > 0 && (
                        <p className="text-[10px] text-amber-600 mt-0.5 truncate">Obs: {item.observacoes.join(' · ')}</p>
                      )}
                    </div>
                    <span className="text-xs font-bold text-zinc-700 flex-shrink-0">{fmtPrice(item.precoTotal)}</span>
                  </div>
                </div>
              ))}
            </div>
            {s.totalPedido !== undefined && (
              <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 border-t border-zinc-200">
                <span className="text-xs font-bold text-zinc-600">Total do pedido</span>
                <span className="text-sm font-black text-zinc-900">{fmtPrice(s.totalPedido)}</span>
              </div>
            )}
            {s.valorDesconto !== undefined && s.totalPedido !== undefined && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-amber-200 bg-amber-50">
                <span className="text-xs font-bold text-amber-700">Com desconto</span>
                <span className="text-sm font-black text-amber-700">{fmtPrice(s.totalPedido - s.valorDesconto)}</span>
              </div>
            )}
          </div>
        )}

        {/* Ações */}
        {s.status === 'pendente' && (
          <div className="flex gap-2">
            <button
              onClick={() => onRejeitar(s.id)}
              className="flex-1 py-2.5 border-2 border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-close-line mr-1" />
              Negar
            </button>
            <button
              onClick={() => onAprovar(s.id)}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-shield-check-line mr-1" />
              Autorizar
            </button>
          </div>
        )}

        {s.status !== 'pendente' && (
          <p className="text-xs text-zinc-400 text-center">
            <i className={`${s.status === 'aprovado' ? 'ri-shield-check-line text-amber-500' : 'ri-close-circle-line text-red-400'} mr-1`} />
            {s.status === 'aprovado' ? 'Autorizado' : 'Negado'} às {s.resolvido} por {s.resolvidoPor}
          </p>
        )}
      </div>
    </div>
  );
}

function SolicitacaoCard({ s, onAprovar, onRejeitar }: {
  s: SolicitacaoAprovacao;
  onAprovar: (id: string) => void;
  onRejeitar: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[s.status];

  return (
    <div className={`bg-white rounded-xl border overflow-hidden transition-shadow ${
      s.urgente && s.status === 'pendente' ? 'border-red-300 ring-1 ring-red-200' : 'border-zinc-200'
    }`}>
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 p-4 hover:bg-zinc-50/50 transition-colors cursor-pointer text-left"
      >
        <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${
          s.urgente && s.status === 'pendente' ? 'bg-red-100' : 'bg-zinc-100'
        }`}>
          <i className={`ri-alert-line text-base ${s.urgente && s.status === 'pendente' ? 'text-red-500' : 'text-zinc-400'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-bold text-zinc-900 truncate">{s.itemNome}</span>
            {s.urgente && s.status === 'pendente' && (
              <span className="text-[9px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded-full whitespace-nowrap animate-pulse">
                URGENTE
              </span>
            )}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            {s.mesaNome} · {s.garcomNome} · <span className="text-zinc-400">{fmt(s.criadoEmTs)}</span>
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {s.tipoProblema && (
              <span className="text-[10px] font-semibold text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded-full">
                {TIPO_PROBLEMA_LABEL[s.tipoProblema] ?? s.tipoProblema}
              </span>
            )}
            {s.resolucaoDesejada && (
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                {RESOLUCAO_LABEL[s.resolucaoDesejada] ?? s.resolucaoDesejada}
              </span>
            )}
          </div>
        </div>
        <div className={`w-5 h-5 flex items-center justify-center text-zinc-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}>
          <i className="ri-arrow-down-s-line text-base" />
        </div>
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3">
          <div className="bg-zinc-50 rounded-xl px-3 py-2.5 border border-zinc-100">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Descrição do problema</p>
            <p className="text-sm text-zinc-700 leading-relaxed">{s.descricao}</p>
          </div>

          {s.status === 'pendente' && (
            <div className="flex gap-2">
              <button
                onClick={() => onRejeitar(s.id)}
                className="flex-1 py-2.5 border-2 border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                <i className="ri-close-line mr-1" />
                Rejeitar
              </button>
              <button
                onClick={() => onAprovar(s.id)}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                <i className="ri-check-line mr-1" />
                Aprovar
              </button>
            </div>
          )}

          {s.status !== 'pendente' && (
            <p className="text-xs text-zinc-400 text-center">
              <i className={`${s.status === 'aprovado' ? 'ri-check-double-line text-green-500' : 'ri-close-line text-red-400'} mr-1`} />
              {s.status === 'aprovado' ? 'Aprovado' : 'Rejeitado'} às {s.resolvido} por {s.resolvidoPor}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type FilterStatus = 'todos' | 'pendente' | 'aprovado' | 'rejeitado';

export default function AprovacoesPage() {
  const { solicitacoes, aprovar, rejeitar, pendentesCount } = useAprovacoes();
  const { user } = useAuth();
  const [filtro, setFiltro] = useState<FilterStatus>('pendente');
  const operador = user?.nome ?? 'Gerente';

  const handleAprovar = (id: string) => aprovar(id, operador);
  const handleRejeitar = (id: string) => rejeitar(id, operador);

  const filtradas = solicitacoes.filter((s) => filtro === 'todos' || s.status === filtro);

  const counts = {
    todos: solicitacoes.length,
    pendente: solicitacoes.filter((s) => s.status === 'pendente').length,
    aprovado: solicitacoes.filter((s) => s.status === 'aprovado').length,
    rejeitado: solicitacoes.filter((s) => s.status === 'rejeitado').length,
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 bg-white border-b border-zinc-200 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-black text-zinc-900">Aprovações Pendentes</h1>
              {pendentesCount > 0 && (
                <span className="text-sm font-bold bg-red-500 text-white px-2.5 py-0.5 rounded-full animate-pulse">
                  {pendentesCount} nova{pendentesCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500 mt-0.5">
              Solicitações de garçons e descontos aguardando sua decisão
            </p>
          </div>
          <div className="flex items-center gap-2 bg-zinc-100 px-3 py-2 rounded-full">
            <i className="ri-shield-user-line text-zinc-500 text-sm" />
            <span className="text-xs font-semibold text-zinc-700">{operador}</span>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-zinc-100 p-1 rounded-xl w-fit">
          {([
            { key: 'pendente', label: 'Pendentes', color: 'text-amber-600' },
            { key: 'aprovado', label: 'Aprovados', color: 'text-green-600' },
            { key: 'rejeitado', label: 'Rejeitados', color: 'text-red-500' },
            { key: 'todos', label: 'Todos', color: 'text-zinc-600' },
          ] as { key: FilterStatus; label: string; color: string }[]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-all ${
                filtro === f.key
                  ? 'bg-white shadow-sm text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {f.label}
              <span className={`font-black text-[10px] ${filtro === f.key ? f.color : 'text-zinc-400'}`}>
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtradas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
              <i className={`ri-checkbox-circle-line text-3xl ${filtro === 'pendente' ? 'text-amber-400' : 'text-zinc-400'}`} />
            </div>
            <p className="text-base font-bold text-zinc-700 mb-1">
              {filtro === 'pendente' ? 'Nenhuma pendência!' : 'Nada aqui ainda'}
            </p>
            <p className="text-sm text-zinc-400">
              {filtro === 'pendente' ? 'Todas as solicitações foram resolvidas.' : 'Nenhuma solicitação neste filtro.'}
            </p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-3">
            {/* Banner urgente */}
            {filtro === 'pendente' && filtradas.some((s) => s.urgente) && (
              <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl mb-4">
                <i className="ri-alarm-warning-line text-red-500 text-lg animate-pulse" />
                <div>
                  <p className="text-xs font-bold text-red-700">Há solicitações urgentes aguardando!</p>
                  <p className="text-[11px] text-red-500">Clientes aguardam resolução imediata.</p>
                </div>
              </div>
            )}
            {/* Banner descontos pendentes */}
            {filtro === 'pendente' && filtradas.some((s) => s.tipo === 'desconto') && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl mb-4">
                <i className="ri-shield-keyhole-line text-amber-600 text-lg" />
                <div>
                  <p className="text-xs font-bold text-amber-800">Solicitação de desconto aguardando</p>
                  <p className="text-[11px] text-amber-600">O operador no caixa está aguardando sua autorização.</p>
                </div>
              </div>
            )}
            {filtradas.map((s) => (
              s.tipo === 'desconto' ? (
                <DescontoCard
                  key={s.id}
                  s={s}
                  onAprovar={handleAprovar}
                  onRejeitar={handleRejeitar}
                />
              ) : (
                <SolicitacaoCard
                  key={s.id}
                  s={s}
                  onAprovar={handleAprovar}
                  onRejeitar={handleRejeitar}
                />
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
