import { useState, useEffect, useCallback } from 'react';
import type { EntregaDetalhe, NotaKind } from '../hooks/useGestorEntregas';
import { fmtMoeda, fmtTelefone, waNumero, horaCurta } from '../utils';

interface Props {
  orderId: string;
  autor: string | null;
  busy: string;
  fetchDetalhe: (id: string) => Promise<EntregaDetalhe | null>;
  onAddNote: (id: string, kind: NotaKind, text: string) => Promise<boolean>;
  onClose: () => void;
}

interface Ocorrencia { at: string; kind: NotaKind; text: string; autor: string | null }

const numCurto = (n: string) => `#${String(n).replace(/\D/g, '').slice(-4) || n}`;

export default function EntregaDetalheModal({ orderId, autor, busy, fetchDetalhe, onAddNote, onClose }: Props) {
  const [d, setD] = useState<EntregaDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<NotaKind>('observacao');
  const [text, setText] = useState('');
  const [enviando, setEnviando] = useState(false);

  const recarregar = useCallback(async () => {
    setLoading(true);
    const det = await fetchDetalhe(orderId);
    setD(det);
    setLoading(false);
  }, [orderId, fetchDetalhe]);

  useEffect(() => { recarregar(); }, [recarregar]);

  const registrar = async () => {
    const t = text.trim();
    if (!t) return;
    setEnviando(true);
    const ok = await onAddNote(orderId, kind, t);
    setEnviando(false);
    if (ok) { setText(''); await recarregar(); }
  };

  // Fases da cozinha + entrega, na ordem cronológica.
  const fases = d ? [
    { label: 'Criado', icon: 'ri-file-add-line', at: d.cozinha.novo_at },
    { label: 'Em preparo (cozinha)', icon: 'ri-fire-line', at: d.cozinha.preparo_at },
    { label: 'Pronto (cozinha)', icon: 'ri-checkbox-circle-line', at: d.cozinha.pronto_at },
    { label: 'Motoboy a caminho da loja', icon: 'ri-store-2-line', at: d.motoboy_timeline?.a_caminho_loja ?? null },
    { label: 'Coletou na loja', icon: 'ri-shopping-bag-3-line', at: d.motoboy_timeline?.coletou ?? null },
    { label: 'Entregue', icon: 'ri-truck-line', at: d.motoboy_timeline?.entregou ?? null },
  ] : [];

  // Ocorrências: problemas (motoboy/loja) + observações do gestor, ordenadas por hora.
  const ocorrencias: Ocorrencia[] = d ? [
    ...d.problemas.map((p) => ({
      at: p.at || '', kind: 'problema' as NotaKind, text: p.text || 'Problema relatado',
      autor: p.autor ?? (p.by === 'loja' ? 'Loja' : p.by === 'motoboy' ? 'Motoboy' : null),
    })),
    ...d.delivery_notes.map((n) => ({ at: n.at || '', kind: n.kind, text: n.text, autor: n.autor ?? null })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)) : [];

  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho */}
        <div className="flex items-start justify-between p-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 flex items-center justify-center bg-orange-100 rounded-xl flex-shrink-0">
              <i className="ri-e-bike-2-line text-orange-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-zinc-900">Pedido {d ? numCurto(d.number) : '…'}</h3>
              <p className="text-xs text-zinc-400 truncate">{d?.cliente ?? 'Carregando…'}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && !d ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !d ? (
            <p className="text-sm text-zinc-500 text-center py-10">Não foi possível carregar o pedido.</p>
          ) : (
            <>
              {/* Destino + telefone */}
              <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-3">
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Destino</p>
                <p className="text-sm text-zinc-700 leading-snug">{d.endereco || '—'}</p>
                {d.telefone ? (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-zinc-500 tabular-nums flex-1">{fmtTelefone(d.telefone)}</span>
                    <a href={`tel:+55${d.telefone}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 text-zinc-700 text-[11px] font-bold hover:bg-zinc-200"><i className="ri-phone-line" /> Ligar</a>
                    <a href={`https://wa.me/${waNumero(d.telefone)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-green-50 text-green-700 text-[11px] font-bold hover:bg-green-100"><i className="ri-whatsapp-line" /> WhatsApp</a>
                  </div>
                ) : null}
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-100">
                  <span className="text-sm font-black text-zinc-800">{fmtMoeda(d.total)}</span>
                  {d.taxa > 0 && <span className="text-[11px] text-zinc-400">taxa {fmtMoeda(d.taxa)}</span>}
                  {d.driver_nome && <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500"><i className="ri-e-bike-2-line text-zinc-400" /> {d.driver_nome}</span>}
                </div>
              </div>

              {/* Itens */}
              {d.itens.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2">Itens</p>
                  <div className="space-y-1">
                    {d.itens.map((it, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-600">{it.quantidade}x {it.nome}</span>
                        <span className="text-zinc-800 font-semibold">{fmtMoeda(it.preco * it.quantidade)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Linha do tempo: cozinha + entrega */}
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2">Fases (cozinha e entrega)</p>
                <div className="space-y-0">
                  {fases.map((f, i) => {
                    const feito = !!f.at;
                    return (
                      <div key={i} className="flex items-center gap-3 py-1.5">
                        <div className={`w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 ${feito ? 'bg-emerald-100 text-emerald-600' : 'bg-zinc-100 text-zinc-300'}`}>
                          <i className={`${f.icon} text-sm`} />
                        </div>
                        <span className={`text-sm flex-1 ${feito ? 'text-zinc-700 font-medium' : 'text-zinc-400'}`}>{f.label}</span>
                        <span className={`text-xs tabular-nums ${feito ? 'text-zinc-600 font-semibold' : 'text-zinc-300'}`}>{f.at ? horaCurta(f.at) : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ocorrências & observações */}
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2">Ocorrências & observações</p>
                {ocorrencias.length === 0 ? (
                  <p className="text-xs text-zinc-400">Nenhum registro ainda.</p>
                ) : (
                  <div className="space-y-1.5">
                    {ocorrencias.map((oc, i) => {
                      const prob = oc.kind === 'problema';
                      return (
                        <div key={i} className={`flex items-start gap-2 text-xs rounded-lg p-2 ${prob ? 'bg-red-50' : 'bg-sky-50'}`}>
                          <i className={`${prob ? 'ri-alert-line text-red-500' : 'ri-chat-1-line text-sky-500'} shrink-0 mt-0.5`} />
                          <div className="min-w-0">
                            <p className={`leading-snug ${prob ? 'text-red-700' : 'text-sky-800'}`}>{oc.text}</p>
                            <p className="text-[10px] text-zinc-400 mt-0.5">
                              {prob ? 'Problema' : 'Observação'}
                              {oc.at ? ` · ${horaCurta(oc.at)}` : ''}
                              {oc.autor ? ` · ${oc.autor}` : ''}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Registrar problema/observação */}
        {d && (
          <div className="p-4 border-t border-zinc-100 flex-shrink-0 space-y-2">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setKind('observacao')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${kind === 'observacao' ? 'bg-sky-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
                <i className="ri-chat-1-line" /> Observação
              </button>
              <button type="button" onClick={() => setKind('problema')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${kind === 'problema' ? 'bg-red-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
                <i className="ri-alert-line" /> Problema
              </button>
              {autor && <span className="ml-auto text-[10px] text-zinc-400">por <strong className="text-zinc-500">{autor}</strong></span>}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder={kind === 'problema' ? 'Descreva o problema…' : 'Anote uma observação…'}
                className="flex-1 px-3 py-2 rounded-xl border border-zinc-200 focus:border-amber-400 outline-none text-sm resize-none"
              />
              <button type="button" onClick={registrar} disabled={!text.trim() || enviando || !!busy}
                className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50 whitespace-nowrap">
                {enviando ? <i className="ri-loader-4-line animate-spin" /> : 'Registrar'}
              </button>
            </div>
            <p className="text-[10px] text-zinc-400">Registro apenas informativo — não altera a fase da entrega.</p>
          </div>
        )}
      </div>
    </div>
  );
}
