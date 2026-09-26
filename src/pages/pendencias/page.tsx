import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePendencias, kindConfig, type Pendencia, type PendenciaUrgencia } from '@/contexts/PendenciasContext';
import { useToast } from '@/contexts/ToastContext';
import PullToRefresh from '@/components/feature/PullToRefresh';
import { perguntar } from '@/components/base/Dialogos';

/**
 * Caixa de pendências — a lista que não rola para cima.
 *
 * O chat e o sino são sequenciais: o que não é atendido na hora é empurrado para fora da
 * tela. Esta página existe para ser o contrário — nada sai daqui por tempo, só por decisão:
 *
 *   Resolver  → feito (a maioria fecha sozinha quando você age na tela certa)
 *   Ciente    → "vi, estou sabendo": permanente, e só para aviso que não pede ação
 *   Descartar → "não vou fazer", com motivo gravado. Também permanente.
 */

type Aba = 'abertas' | 'vistas' | 'historico';

const ABAS: Array<{ key: Aba; label: string }> = [
  { key: 'abertas', label: 'Abertas' },
  { key: 'vistas', label: 'Vistas' },
  { key: 'historico', label: 'Resolvidas' },
];

const URGENCIA_BADGE: Record<PendenciaUrgencia, { label: string; cls: string } | null> = {
  alta: { label: 'urgente', cls: 'bg-red-100 text-red-700' },
  normal: null,
  baixa: null,
};

function quando(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  const dias = Math.floor(diff / 86400);
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function CardPendencia({
  p, onResolver, onCiente, onDescartar, onReabrir,
}: {
  p: Pendencia;
  onResolver: (p: Pendencia) => void;
  onCiente: (p: Pendencia) => void;
  onDescartar: (p: Pendencia) => void;
  onReabrir: (p: Pendencia) => void;
}) {
  const cfg = kindConfig(p.kind);
  const badge = URGENCIA_BADGE[p.urgencia];
  const fechada = p.status === 'resolvida' || p.status === 'descartada';

  return (
    <div className={`bg-white border rounded-2xl px-4 py-3 ${p.urgencia === 'alta' && !fechada ? 'border-red-200' : 'border-zinc-200'}`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl ${cfg.corBg}`}>
          <i className={`${cfg.icone} text-base ${cfg.corTexto}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.corTexto}`}>{cfg.label}</span>
            {badge && !fechada && (
              <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
            )}
            {p.status === 'vista' && (
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">ciente</span>
            )}
            {p.status === 'descartada' && (
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">descartada</span>
            )}
            {p.status === 'resolvida' && (
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">resolvida</span>
            )}
            <span className="text-[10px] text-zinc-400">{quando(p.criadaEm)}</span>
          </div>
          <p className={`text-sm font-bold mt-1 leading-snug ${fechada ? 'text-zinc-400' : 'text-zinc-900'}`}>{p.titulo}</p>
          {p.detalhe && <p className="text-xs text-zinc-500 mt-1 whitespace-pre-line break-words">{p.detalhe}</p>}
          {p.motivo && p.status === 'descartada' && (
            <p className="text-[11px] text-amber-700 mt-1">Motivo: {p.motivo}</p>
          )}

          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            {!fechada && p.rota && (
              <button
                onClick={() => onResolver(p)}
                className="text-[11px] font-bold bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              >
                Abrir e resolver
              </button>
            )}
            {/* "Ciente" é o check permanente — só para o que não pede ação. Dar esse atalho
                a uma pendência acionável recriaria o problema: silenciar sem fazer. */}
            {!fechada && !p.acaoRequerida && (
              <button
                onClick={() => onCiente(p)}
                className="text-[11px] font-semibold text-zinc-600 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              >
                Ciente
              </button>
            )}
            {!fechada && (
              <button
                onClick={() => onDescartar(p)}
                className="text-[11px] font-semibold text-zinc-400 hover:text-red-600 px-2.5 py-1.5 rounded-lg hover:bg-red-50 cursor-pointer whitespace-nowrap transition-colors"
              >
                Não vou fazer
              </button>
            )}
            {fechada && (
              <button
                onClick={() => onReabrir(p)}
                className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-800 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 cursor-pointer whitespace-nowrap transition-colors"
              >
                Reabrir
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PendenciasPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { pendencias, historico, carregando, erro, recarregar, marcar } = usePendencias();
  const [aba, setAba] = useState<Aba>('abertas');
  const [kindFiltro, setKindFiltro] = useState<string | null>(null);

  const lista = useMemo(() => {
    const base = aba === 'historico'
      ? historico
      : pendencias.filter((p) => (aba === 'abertas' ? p.status === 'aberta' : p.status === 'vista'));
    return kindFiltro ? base.filter((p) => p.kind === kindFiltro) : base;
  }, [aba, pendencias, historico, kindFiltro]);

  const kinds = useMemo(() => {
    const conta = new Map<string, number>();
    pendencias.forEach((p) => conta.set(p.kind, (conta.get(p.kind) ?? 0) + 1));
    return [...conta.entries()].sort((a, b) => b[1] - a[1]);
  }, [pendencias]);

  const abertasCount = pendencias.filter((p) => p.status === 'aberta').length;
  const vistasCount = pendencias.filter((p) => p.status === 'vista').length;

  const acao = async (p: Pendencia, tipo: 'vista' | 'resolvida' | 'descartada' | 'reabrir', motivo?: string) => {
    try {
      await marcar(p.id, tipo, motivo);
      toast.success(
        tipo === 'reabrir' ? 'Pendência reaberta'
          : tipo === 'vista' ? 'Marcada como vista'
            : tipo === 'descartada' ? 'Descartada' : 'Resolvida',
        tipo === 'vista' ? 'Continua na aba Vistas, mas não cobro mais.' : undefined,
      );
    } catch (e) {
      toast.error('Não consegui atualizar a pendência', e instanceof Error ? e.message : undefined);
    }
  };

  const handleDescartar = async (p: Pendencia) => {
    const motivo = await perguntar({ titulo: 'Por que não vai fazer?', mensagem: p.titulo, opcional: true });
    if (motivo === null) return;          // cancelou o diálogo
    acao(p, 'descartada', motivo.trim() || undefined);
  };

  return (
    <PullToRefresh onRefresh={recarregar}>
      <div className="max-w-3xl mx-auto px-4 py-5 pb-24">
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer transition-colors"
          >
            <i className="ri-arrow-left-line text-lg text-zinc-600" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-black text-zinc-900">Pendências</h1>
            <p className="text-xs text-zinc-400">
              Tudo que ainda espera você. Nada sai daqui sozinho.
            </p>
          </div>
          <button
            onClick={recarregar}
            disabled={carregando}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer transition-colors disabled:opacity-40"
          >
            <i className={`ri-refresh-line text-lg text-zinc-500 ${carregando ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs font-semibold text-red-700">Não consegui carregar: {erro}</p>
          </div>
        )}

        <div className="flex items-center gap-1.5 mb-3">
          {ABAS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAba(a.key)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full cursor-pointer whitespace-nowrap transition-colors ${
                aba === a.key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
              }`}
            >
              {a.label}
              {a.key === 'abertas' && abertasCount > 0 ? ` (${abertasCount})` : ''}
              {a.key === 'vistas' && vistasCount > 0 ? ` (${vistasCount})` : ''}
            </button>
          ))}
        </div>

        {kinds.length > 1 && aba !== 'historico' && (
          <div className="flex items-center gap-1.5 mb-4 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setKindFiltro(null)}
              className={`flex-shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full cursor-pointer whitespace-nowrap transition-colors ${
                kindFiltro === null ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
              }`}
            >
              Todas
            </button>
            {kinds.map(([kind, n]) => (
              <button
                key={kind}
                onClick={() => setKindFiltro(kind === kindFiltro ? null : kind)}
                className={`flex-shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full cursor-pointer whitespace-nowrap transition-colors ${
                  kindFiltro === kind ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                }`}
              >
                {kindConfig(kind).label} ({n})
              </button>
            ))}
          </div>
        )}

        {lista.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
              <i className="ri-inbox-line text-2xl text-zinc-300" />
            </div>
            <p className="text-sm font-semibold text-zinc-400">
              {aba === 'abertas' ? 'Nada pendente' : aba === 'vistas' ? 'Nada marcado como visto' : 'Nada resolvido nos últimos 30 dias'}
            </p>
            {aba === 'abertas' && <p className="text-xs text-zinc-300 mt-1">Está tudo em dia.</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {lista.map((p) => (
              <CardPendencia
                key={p.id}
                p={p}
                onResolver={(x) => { if (x.rota) navigate(x.rota); }}
                onCiente={(x) => acao(x, 'vista')}
                onDescartar={handleDescartar}
                onReabrir={(x) => acao(x, 'reabrir')}
              />
            ))}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
