import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useVoltarFecha } from '@/lib/voltarAndroid';

interface Props { tenantId: string; onClose: () => void }

interface Linha {
  level: 'item' | 'complemento'; name: string; group_name: string | null; ifood_id: string | null; external_code: string | null;
  vendidos: number; ultimo: string | null; link_id: string | null; target_kind: string | null; target_id: string | null;
  target_nome: string | null; target_inativo: boolean;
}
interface Alvo { kind: 'item' | 'combo' | 'option'; id: string; nome: string; detalhe: string | null }

const KIND: Record<string, string> = { item: 'Item', combo: 'Combo', option: 'Opção' };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chave = (l: Linha) => `${l.level}|${norm(l.name)}|${norm(l.group_name ?? '')}`;

/**
 * Vínculo dos produtos e complementos vendidos no iFood com o cardápio do ERPOS (IFOOD-PEDIDOS-FUNIL.md, etapa 1).
 * Tudo manual: o sistema não sugere par (regra do dono 09-24). É o que permite dar baixa de estoque/CMV pela ficha.
 */
export default function IfoodVinculosModal({ tenantId, onClose }: Props) {
  useVoltarFecha(true, onClose, 'ifood-vinculos');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [alvos, setAlvos] = useState<Alvo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [so, setSo] = useState<'pendentes' | 'todos'>('pendentes');
  const [editando, setEditando] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const carregar = useCallback(async () => {
    const [l, a] = await Promise.all([
      supabase.rpc('fn_ifood_itens_vendidos', { p_tenant: tenantId, p_dias: 90 }),
      supabase.rpc('fn_ifood_vinculo_alvos', { p_tenant: tenantId }),
    ]);
    if (l.error) setMsg({ ok: false, t: l.error.message });
    setLinhas(((l.data ?? []) as Linha[]).map((x) => ({ ...x, vendidos: Number(x.vendidos ?? 0) })));
    setAlvos((a.data ?? []) as Alvo[]);
    setCarregando(false);
  }, [tenantId]);
  useEffect(() => { carregar(); }, [carregar]);

  const pendentes = linhas.filter((l) => !l.link_id || l.target_inativo).length;
  const visiveis = useMemo(() => linhas.filter((l) => so === 'todos' || !l.link_id || l.target_inativo), [linhas, so]);
  const grupos = [
    { t: 'Produtos', ls: visiveis.filter((l) => l.level === 'item') },
    { t: 'Complementos', ls: visiveis.filter((l) => l.level === 'complemento') },
  ];

  const salvar = async (l: Linha, kind: string, target: string | null) => {
    setBusy(chave(l)); setMsg(null);
    const { error } = await supabase.rpc('fn_ifood_vinculo_salvar', {
      p_tenant: tenantId, p_level: l.level, p_name: l.name, p_group: l.group_name, p_ifood_id: l.ifood_id,
      p_external_code: l.external_code, p_kind: kind, p_target: target,
    });
    setBusy('');
    if (error) { setMsg({ ok: false, t: error.message }); return; }
    setEditando(null); setBusca('');
    await carregar();
  };

  const opcoes = (l: Linha) => {
    const q = norm(busca.trim());
    return alvos
      // Só o cardápio principal (itens e combos), nunca opção (dono, 05/10).
      .filter((a) => a.kind !== 'option')
      .filter((a) => !q || norm(`${a.nome} ${a.detalhe ?? ''}`).includes(q))
      // complemento do iFood costuma ser opção do cardápio → opções primeiro
      .sort((a, b) => (l.level === 'complemento' ? Number(b.kind === 'option') - Number(a.kind === 'option') : 0))
      .slice(0, 40);
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[94vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-zinc-100">
          <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg shrink-0"><i className="ri-links-line text-red-600" /></div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-zinc-800">Itens do iFood × cardápio do ERPOS</h4>
            <p className="text-xs text-zinc-500">Ligue cada produto e complemento vendido no iFood (últimos 90 dias) ao item do cardápio — a baixa de estoque usa a ficha dele.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100"><i className="ri-close-line text-lg" /></button>
        </div>

        <div className="px-4 pt-3 flex gap-1 text-xs">
          {([['pendentes', `Sem vínculo (${pendentes})`], ['todos', `Todos (${linhas.length})`]] as const).map(([k, t]) => (
            <button key={k} onClick={() => setSo(k)} className={`px-3 py-1.5 rounded-lg font-semibold ${so === k ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}>{t}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-xs">
          {msg && <p className={`rounded-lg p-2 border ${msg.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-red-600 bg-red-50 border-red-100'}`}>{msg.t}</p>}
          {carregando ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : visiveis.length === 0 ? (
            <p className="text-center text-sm text-zinc-400 py-10">{linhas.length ? 'Tudo vinculado.' : 'Nenhum pedido do iFood com itens nos últimos 90 dias.'}</p>
          ) : grupos.filter((g) => g.ls.length).map((g) => (
            <div key={g.t} className="space-y-1.5">
              <p className="font-bold text-zinc-700">{g.t}</p>
              {g.ls.map((l) => {
                const k = chave(l);
                const aberto = editando === k;
                return (
                  <div key={k} className="rounded-xl border border-zinc-200 p-2.5 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-zinc-800">{l.name}</p>
                        <p className="text-zinc-400">
                          {l.group_name ? `${l.group_name} · ` : ''}{l.vendidos ? `${l.vendidos.toLocaleString('pt-BR')} vendido(s)` : 'sem venda no período'}
                          {l.external_code ? ` · cód. ${l.external_code}` : ''}
                        </p>
                        {l.link_id ? (
                          <p className={l.target_inativo ? 'text-red-600 font-semibold' : 'text-emerald-700'}>
                            <i className="ri-link" /> {l.target_kind && KIND[l.target_kind] ? `${KIND[l.target_kind]}: ` : ''}{l.target_nome}{l.target_inativo ? ' — apagado do cardápio, ligue de novo' : ''}
                          </p>
                        ) : <p className="text-amber-700 font-semibold">Sem vínculo — não dá baixa de estoque</p>}
                      </div>
                      <button onClick={() => { setEditando(aberto ? null : k); setBusca(''); }} className="px-2.5 py-1.5 rounded-lg border border-zinc-200 font-semibold text-zinc-700 shrink-0">
                        {aberto ? 'Fechar' : l.link_id ? 'Trocar' : 'Vincular'}
                      </button>
                    </div>
                    {aberto && (
                      <div className="space-y-1.5">
                        <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={l.level === 'item' ? 'Buscar item ou combo do cardápio…' : 'Buscar opção, item ou combo do cardápio…'}
                          className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-xs" />
                        <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-100 divide-y divide-zinc-100">
                          {opcoes(l).map((a) => (
                            <button key={a.kind + a.id} disabled={!!busy} onClick={() => salvar(l, a.kind, a.id)} className="w-full text-left px-3 py-2 hover:bg-zinc-50 disabled:opacity-50">
                              <span className="text-zinc-400">{KIND[a.kind]} · </span><span className="text-zinc-800">{a.nome}</span>
                              {a.detalhe && <span className="text-zinc-400"> ({a.detalhe})</span>}
                            </button>
                          ))}
                          {opcoes(l).length === 0 && <p className="px-3 py-2 text-zinc-400">Nada encontrado.</p>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button disabled={!!busy} onClick={() => salvar(l, 'sem_estoque', null)} className="px-2.5 py-1.5 rounded-lg bg-zinc-100 text-zinc-700 font-semibold disabled:opacity-50">Não usa estoque</button>
                          {l.link_id && <button disabled={!!busy} onClick={() => salvar(l, 'remover', null)} className="px-2.5 py-1.5 rounded-lg text-red-600 font-semibold disabled:opacity-50">Remover vínculo</button>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
