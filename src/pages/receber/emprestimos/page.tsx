// Empréstimo de insumo entre lojas (2026-10-06, pedido do dono pelo "O que aconteceu?").
// Mandar: escolhe a loja, os insumos e as quantidades — sai do estoque desta loja na hora.
// Chegou: a outra loja vê o que mandaram (sem a quantidade), escolhe os insumos DELA e digita o que chegou
// de verdade — só então entra no estoque dela. A diferença volta para quem mandou (aviso).
// Toda a regra fica no banco: fn_emprestimo_* (migração 20261006120000_emprestimo_entre_lojas.sql).
// Links: ?mandar=1 (abre o mandar), ?receber=<id> (abre a conferência; "1" = o primeiro que está chegando).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { brl, lerNumeroBR, normalizar, qtd, un } from '../api';

interface Loja { id: string; nome: string }
interface Insumo { id: string; nome: string; unidade: string; estoque: number; categoria: string; custo: number }
interface ItemNome { ingredient_id: string; nome: string; unidade: string; quantidade?: number }
interface ItemRecebido extends ItemNome { enviado_ingredient_id: string | null }
interface Chegando { id: string; origem: string; enviado_por: string; enviado_em: string; observacao: string | null; itens: ItemNome[] }
interface Historico {
  id: string; sentido: 'mandei' | 'recebi'; outra_loja: string; status: 'enviado' | 'recebido' | 'cancelado'; valor: number;
  observacao: string | null; obs_recebimento: string | null; enviado_por: string; enviado_em: string;
  recebido_por: string | null; recebido_em: string | null; cancelado_em: string | null;
  itens_enviados: ItemNome[]; itens_recebidos: ItemRecebido[] | null;
}
interface Saldo { loja: string; emprestei: number; peguei: number }
interface Lista { chegando: Chegando[]; historico: Historico[]; saldo: Saldo[] }

type Tela = 'inicio' | 'loja' | 'mandar' | 'receber' | 'feito';
interface LinhaMandar { insumo: Insumo; qtd: string }
interface LinhaReceber { chave: string; enviado: ItemNome | null; insumoId: string | null; qtd: string }

const msgErro = (e: unknown) => {
  const m = (e as { message?: string })?.message ?? String(e);
  return /Failed to fetch|NetworkError/i.test(m) ? 'Sem internet. Confira a lista antes de tentar de novo — pode ter gravado.' : m;
};
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/** O insumo desta loja com o nome mais parecido com o que mandaram (só sugere; quem recebe confirma). */
function sugerir(nome: string, insumos: Insumo[]): string | null {
  const n = normalizar(nome);
  const igual = insumos.find((i) => normalizar(i.nome) === n);
  if (igual) return igual.id;
  const parecidos = insumos.filter((i) => { const m = normalizar(i.nome); return m.includes(n) || n.includes(m); });
  return parecidos.length === 1 ? parecidos[0].id : null;
}

export default function EmprestimosPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const tenantId = user?.tenantId ?? '';
  const { hasPermissao } = usePermissoes();
  const podeMandar = hasPermissao('estoque_movimentar');
  const podeReceber = hasPermissao('estoque_receber') || podeMandar;
  const [params, setParams] = useSearchParams();

  const [tela, setTela] = useState<Tela>('inicio');
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [lista, setLista] = useState<Lista | null>(null);
  const [lojas, setLojas] = useState<Loja[] | null>(null);
  const [insumos, setInsumos] = useState<Insumo[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  // Mandar
  const [destino, setDestino] = useState<Loja | null>(null);
  const [linhas, setLinhas] = useState<LinhaMandar[]>([]);
  const [obs, setObs] = useState('');
  const [picker, setPicker] = useState<null | { modo: 'mandar' } | { modo: 'receber'; chave: string }>(null);

  // Receber
  const [chegando, setChegando] = useState<Chegando | null>(null);
  const [rec, setRec] = useState<LinhaReceber[]>([]);
  const [feito, setFeito] = useState<{ titulo: string; sub: string; comparacao?: { l: string; v: string }[] } | null>(null);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    const { data, error } = await supabase.rpc('fn_emprestimo_listar', { p_tenant: tenantId });
    if (error) { setErro(msgErro(error)); setLista({ chegando: [], historico: [], saldo: [] }); return; }
    setLista(data as Lista);
  }, [tenantId]);

  const carregarInsumos = useCallback(async () => {
    if (!tenantId) return [] as Insumo[];
    const { data, error } = await supabase.rpc('fn_emprestimo_insumos', { p_tenant: tenantId });
    if (error) { setErro(msgErro(error)); return [] as Insumo[]; }
    const l = (data ?? []) as Insumo[];
    setInsumos(l);
    return l;
  }, [tenantId]);

  // Troca de loja: nada de uma loja pode ser gravado na outra
  useEffect(() => {
    setTela('inicio'); setLista(null); setLojas(null); setInsumos(null); setDestino(null); setLinhas([]); setChegando(null); setErro(null);
    carregar();
  }, [tenantId, carregar]);

  const abrirMandar = useCallback(async () => {
    setErro(null); setLinhas([]); setObs(''); setDestino(null);
    let ls = lojas;
    if (!ls) {
      const { data, error } = await supabase.rpc('fn_emprestimo_lojas', { p_tenant: tenantId });
      if (error) { setErro(msgErro(error)); return; }
      ls = (data ?? []) as Loja[];
      setLojas(ls);
    }
    if (!insumos) carregarInsumos();
    if (ls.length === 1) { setDestino(ls[0]); setTela('mandar'); } else setTela('loja');
  }, [lojas, insumos, tenantId, carregarInsumos]);

  const abrirReceber = useCallback(async (c: Chegando) => {
    setErro(null); setObs('');
    const ins = insumos ?? await carregarInsumos();
    setChegando(c);
    setRec(c.itens.map((i, k) => ({ chave: `e${k}`, enviado: i, insumoId: sugerir(i.nome, ins), qtd: '' })));
    setTela('receber');
  }, [insumos, carregarInsumos]);

  // Links (?mandar=1, ?receber=<id>) — esperam a lista e a permissão chegarem
  useEffect(() => {
    const m = params.get('mandar'); const r = params.get('receber');
    if (!m && !r) return;
    if (m && podeMandar) { setParams({}, { replace: true }); abrirMandar(); return; }
    if (r && lista && podeReceber) {
      setParams({}, { replace: true });
      const c = r === '1' ? (lista.chegando.length === 1 ? lista.chegando[0] : null) : lista.chegando.find((x) => x.id === r);
      if (c) abrirReceber(c);
      else if (r !== '1') setErro('Esse empréstimo já foi recebido ou cancelado.');
    }
  }, [params, setParams, lista, podeMandar, podeReceber, abrirMandar, abrirReceber]);

  const voltarInicio = () => { setErro(null); setTela('inicio'); setPicker(null); };
  const voltar = () => {
    if (picker) return setPicker(null);
    if (tela === 'inicio') return window.history.length > 1 ? navigate(-1) : navigate('/receber');
    if (tela === 'mandar' && (lojas?.length ?? 0) > 1) return setTela('loja');
    if (tela === 'feito') { carregar(); }
    voltarInicio();
  };
  useVoltarFecha(tela !== 'inicio', voltar, 'emprestimo-tela');
  useVoltarFecha(!!picker, () => setPicker(null), 'emprestimo-picker');

  // ── Mandar ─────────────────────────────────────────────────────────────────
  const linhasOk = linhas.length > 0 && linhas.every((l) => lerNumeroBR(l.qtd) > 0);
  const valorMandar = linhas.reduce((s, l) => s + (lerNumeroBR(l.qtd) > 0 ? lerNumeroBR(l.qtd) * l.insumo.custo : 0), 0);

  const enviar = async () => {
    if (!destino || !linhasOk || gravando) return;
    setGravando(true); setErro(null);
    const { data, error } = await supabase.rpc('fn_emprestimo_enviar', {
      p_origem: tenantId, p_destino: destino.id, p_obs: obs.trim() || null,
      p_itens: linhas.map((l) => ({ ingredient_id: l.insumo.id, quantidade: lerNumeroBR(l.qtd) })),
    });
    setGravando(false);
    if (error) { setErro(msgErro(error)); return; }
    const v = data as { valor: number };
    setFeito({
      titulo: `Mandado para ${destino.nome}`,
      sub: `Saiu do estoque daqui${v.valor > 0 ? ` (${brl(v.valor)} pelo custo)` : ''}. Quem recebe lá vai conferir e digitar o que chegou.`,
    });
    setInsumos(null);
    setTela('feito');
  };

  // ── Receber ────────────────────────────────────────────────────────────────
  const recOk = rec.length > 0 && rec.every((l) => l.insumoId && !Number.isNaN(lerNumeroBR(l.qtd)) && lerNumeroBR(l.qtd) >= 0)
    && rec.some((l) => lerNumeroBR(l.qtd) > 0);

  const confirmarRecebimento = async () => {
    if (!chegando || !recOk || gravando) return;
    setGravando(true); setErro(null);
    const { data, error } = await supabase.rpc('fn_emprestimo_receber', {
      p_id: chegando.id, p_obs: obs.trim() || null,
      p_itens: rec.map((l) => ({ ingredient_id: l.insumoId, quantidade: lerNumeroBR(l.qtd), enviado_ingredient_id: l.enviado?.ingredient_id ?? null })),
    });
    setGravando(false);
    if (error) { setErro(msgErro(error)); return; }
    const v = data as { comparacao: { l: string; v: string }[] };
    setFeito({ titulo: 'Entrou no estoque', sub: `${chegando.origem} vai ver o que chegou.`, comparacao: v.comparacao });
    setInsumos(null);
    setTela('feito');
  };

  const cancelar = async (h: Historico) => {
    if (gravando || !window.confirm(`Cancelar o empréstimo para ${h.outra_loja}? Os insumos voltam para o estoque daqui.`)) return;
    setGravando(true); setErro(null);
    const { error } = await supabase.rpc('fn_emprestimo_cancelar', { p_id: h.id });
    setGravando(false);
    if (error) { setErro(msgErro(error)); return; }
    setInsumos(null);
    carregar();
  };

  const insumoPorId = useMemo(() => new Map((insumos ?? []).map((i) => [i.id, i])), [insumos]);
  const titulo: Record<Tela, string> = {
    inicio: 'Empréstimo entre lojas', loja: 'Mandar para qual loja?', mandar: `Mandar para ${destino?.nome ?? ''}`,
    receber: `Chegou de ${chegando?.origem ?? ''}`, feito: 'Pronto',
  };

  return (
    <div className="h-full flex flex-col bg-zinc-50">
      <div className="bg-gradient-to-br from-amber-500 to-orange-500 text-white flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center gap-2 px-2 h-14">
          <button onClick={voltar} className="w-11 h-11 flex items-center justify-center rounded-full active:bg-white/20 cursor-pointer" aria-label="Voltar">
            <i className="ri-arrow-left-line text-2xl" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold leading-tight truncate">{titulo[tela]}</p>
            <p className="text-xs text-white/80 truncate">{user?.loja}</p>
          </div>
          {tela === 'inicio' && (
            <button onClick={() => { setLista(null); carregar(); }} className="w-11 h-11 flex items-center justify-center rounded-full active:bg-white/20 cursor-pointer" aria-label="Atualizar">
              <i className="ri-refresh-line text-xl" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-pb-32">
        <div className="max-w-xl mx-auto">
          {erro && (
            <div className="mx-4 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-3.5 text-sm flex gap-2">
              <i className="ri-error-warning-line text-lg flex-shrink-0" />
              <p className="flex-1">{erro}</p>
              <button onClick={() => setErro(null)} className="cursor-pointer" aria-label="Fechar"><i className="ri-close-line" /></button>
            </div>
          )}

          {tela === 'inicio' && (
            <div className="px-4 pt-4 pb-10 space-y-3">
              {!podeMandar && !podeReceber && (
                <p className="text-center text-sm text-zinc-500 py-10">Seu perfil não movimenta o estoque desta loja. Peça ao administrador em Configurações › Permissões.</p>
              )}
              {podeReceber && lista?.chegando.map((c) => (
                <button key={c.id} onClick={() => abrirReceber(c)} className="w-full flex items-center gap-3 bg-emerald-500 text-white rounded-3xl p-4 text-left shadow-lg shadow-emerald-500/25 cursor-pointer active:scale-[0.99]">
                  <i className="ri-truck-line text-3xl" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-bold">Chegou de {c.origem}?</p>
                    <p className="text-xs text-white/85 truncate">{c.itens.map((i) => i.nome).join(', ')}</p>
                    <p className="text-[11px] text-white/75 mt-0.5">Mandado por {c.enviado_por} · {quando(c.enviado_em)}</p>
                  </div>
                  <span className="text-xs font-bold bg-white/20 rounded-full px-3 py-1.5 flex-shrink-0">Conferir</span>
                </button>
              ))}
              {podeMandar && (
                <button onClick={abrirMandar} className="w-full flex items-center gap-4 text-left bg-white text-zinc-800 rounded-3xl p-4 border border-zinc-100 active:scale-[0.98] transition-transform cursor-pointer min-h-[96px]">
                  <i className="ri-arrow-left-right-line text-3xl text-amber-500" />
                  <div>
                    <p className="text-[15px] font-bold leading-tight">Mandar para outra loja</p>
                    <p className="text-xs mt-1 leading-snug text-zinc-500">Escolha os insumos e quanto vai. Sai do estoque daqui na hora.</p>
                  </div>
                </button>
              )}

              {lista === null && <Spinner texto="Carregando…" />}

              {lista && lista.saldo.some((s) => s.emprestei > 0 || s.peguei > 0) && (
                <div className="bg-white rounded-3xl border border-zinc-100 p-4">
                  <p className="text-sm font-bold text-zinc-700 mb-2">Quem deve a quem (pelo custo)</p>
                  {lista.saldo.filter((s) => s.emprestei > 0 || s.peguei > 0).map((s) => {
                    const dif = s.emprestei - s.peguei;
                    return (
                      <div key={s.loja} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                        <span className="text-zinc-700 truncate">{s.loja}</span>
                        <span className={`font-semibold flex-shrink-0 ${Math.abs(dif) < 0.01 ? 'text-zinc-400' : dif > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {Math.abs(dif) < 0.01 ? 'quites' : dif > 0 ? `deve ${brl(dif)} para nós` : `devemos ${brl(-dif)}`}
                        </span>
                      </div>
                    );
                  })}
                  <p className="text-[11px] text-zinc-400 mt-1">Devolver = mandar de volta pelo mesmo botão.</p>
                </div>
              )}

              {lista && (
                <div>
                  <p className="text-sm font-bold text-zinc-700 px-1 mt-2 mb-2">Últimos empréstimos</p>
                  {lista.historico.length === 0 && <p className="text-center text-sm text-zinc-400 py-8">Nenhum empréstimo ainda.</p>}
                  <div className="space-y-2.5">
                    {lista.historico.map((h) => (
                      <CartaoHistorico key={h.id} h={h} aberto={aberto === h.id} onAbrir={() => setAberto(aberto === h.id ? null : h.id)}
                        onCancelar={podeMandar && h.sentido === 'mandei' && h.status === 'enviado' ? () => cancelar(h) : undefined} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tela === 'loja' && (
            <div className="px-4 pt-4 pb-10 space-y-2.5">
              {lojas?.length === 0 && <p className="text-center text-sm text-zinc-500 py-10">Não há outra loja do mesmo dono para mandar.</p>}
              {lojas?.map((l) => (
                <button key={l.id} onClick={() => { setDestino(l); setTela('mandar'); }} className="w-full flex items-center gap-3 bg-white rounded-3xl border border-zinc-100 p-4 text-left active:bg-zinc-50 cursor-pointer">
                  <i className="ri-store-2-line text-2xl text-amber-500" />
                  <p className="flex-1 text-[15px] font-bold text-zinc-800">{l.nome}</p>
                  <i className="ri-arrow-right-s-line text-xl text-zinc-400" />
                </button>
              ))}
            </div>
          )}

          {tela === 'mandar' && destino && (
            <div className="px-4 pt-4 pb-36 space-y-3">
              <p className="text-sm text-zinc-500 px-1">O que vai para {destino.nome}? A quantidade é na unidade do estoque daqui.</p>
              {linhas.map((l, k) => {
                const n = lerNumeroBR(l.qtd);
                const negativo = n > 0 && n > l.insumo.estoque;
                return (
                  <div key={l.insumo.id} className="bg-white rounded-3xl border border-zinc-100 p-4">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-bold text-zinc-800 truncate">{l.insumo.nome}</p>
                        <p className="text-xs text-zinc-500">Tem {qtd(l.insumo.estoque)} {un(l.insumo.unidade)} aqui</p>
                      </div>
                      <button onClick={() => setLinhas((ls) => ls.filter((_, i) => i !== k))} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer" aria-label="Tirar">
                        <i className="ri-delete-bin-line text-zinc-400" />
                      </button>
                    </div>
                    <CampoQtd valor={l.qtd} unidade={un(l.insumo.unidade)} placeholder="Quanto vai?"
                      onValor={(v) => setLinhas((ls) => ls.map((x, i) => (i === k ? { ...x, qtd: v } : x)))} />
                    {negativo && <p className="text-xs text-amber-600 mt-2">É mais do que o estoque diz que tem — o estoque daqui fica negativo. Confira a contagem depois.</p>}
                  </div>
                );
              })}
              <button onClick={() => setPicker({ modo: 'mandar' })} className="w-full py-4 rounded-2xl border-2 border-dashed border-amber-300 text-amber-700 font-bold cursor-pointer">
                <i className="ri-add-line mr-1" /> {linhas.length ? 'Mais um insumo' : 'Escolher insumo'}
              </button>
              <Campo valor={obs} onValor={setObs} placeholder="Observação (opcional) — ex.: vai com o motoboy" />
              <BarraFixa>
                {valorMandar > 0 && <p className="text-xs text-zinc-500 text-center mb-2">Pelo custo: {brl(valorMandar)}</p>}
                <BotaoPrincipal onClick={enviar} disabled={!linhasOk || gravando}>
                  {gravando ? 'Mandando…' : linhas.length ? `Mandar ${linhas.length} ${linhas.length === 1 ? 'item' : 'itens'}` : 'Mandar'}
                </BotaoPrincipal>
              </BarraFixa>
            </div>
          )}

          {tela === 'receber' && chegando && (
            <div className="px-4 pt-4 pb-36 space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-sm text-amber-800">
                Conte o que chegou e digite aqui. A quantidade que mandaram só aparece depois — assim a conferência vale.
                {chegando.observacao && <p className="mt-1.5 text-amber-700"><b>Recado:</b> {chegando.observacao}</p>}
              </div>
              {insumos === null && <Spinner texto="Carregando os insumos…" />}
              {insumos && rec.map((l) => {
                const ins = l.insumoId ? insumoPorId.get(l.insumoId) : null;
                const mudar = (p: Partial<LinhaReceber>) => setRec((rs) => rs.map((x) => (x.chave === l.chave ? { ...x, ...p } : x)));
                return (
                  <div key={l.chave} className="bg-white rounded-3xl border border-zinc-100 p-4">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{l.enviado ? 'Mandaram' : 'Veio a mais'}</p>
                        <p className="text-[15px] font-bold text-zinc-800 truncate">{l.enviado ? `${l.enviado.nome} (${un(l.enviado.unidade)})` : 'Outro item'}</p>
                      </div>
                      {!l.enviado && (
                        <button onClick={() => setRec((rs) => rs.filter((x) => x.chave !== l.chave))} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer" aria-label="Tirar">
                          <i className="ri-delete-bin-line text-zinc-400" />
                        </button>
                      )}
                    </div>
                    <button onClick={() => setPicker({ modo: 'receber', chave: l.chave })}
                      className={`mt-3 w-full text-left rounded-2xl px-4 py-3 border cursor-pointer ${ins ? 'border-zinc-200 bg-zinc-50' : 'border-amber-300 bg-amber-50'}`}>
                      <p className="text-[11px] text-zinc-500">Entra no estoque daqui como</p>
                      <p className={`text-sm font-semibold ${ins ? 'text-zinc-800' : 'text-amber-700'}`}>{ins ? `${ins.nome} (${un(ins.unidade)})` : 'Escolher o insumo'}</p>
                    </button>
                    {ins && l.enviado && un(ins.unidade) !== un(l.enviado.unidade) && (
                      <p className="text-xs text-amber-600 mt-2">Mandaram em {un(l.enviado.unidade)}; aqui conta em {un(ins.unidade)}. Digite em {un(ins.unidade)}.</p>
                    )}
                    <CampoQtd valor={l.qtd} unidade={ins ? un(ins.unidade) : ''} placeholder="Quanto chegou?" onValor={(v) => mudar({ qtd: v })} />
                    {l.enviado && (
                      <button onClick={() => mudar({ qtd: '0' })} className="mt-2 text-xs font-semibold text-zinc-500 underline cursor-pointer">Não chegou</button>
                    )}
                  </div>
                );
              })}
              {insumos && (
                <button onClick={() => setRec((rs) => [...rs, { chave: `x${Date.now()}`, enviado: null, insumoId: null, qtd: '' }])}
                  className="w-full py-4 rounded-2xl border-2 border-dashed border-zinc-300 text-zinc-600 font-bold cursor-pointer">
                  <i className="ri-add-line mr-1" /> Chegou outra coisa
                </button>
              )}
              <Campo valor={obs} onValor={setObs} placeholder="Observação (opcional) — ex.: veio aberto" />
              <BarraFixa>
                <BotaoPrincipal onClick={confirmarRecebimento} disabled={!recOk || gravando}>
                  {gravando ? 'Confirmando…' : 'Confirmar o que chegou'}
                </BotaoPrincipal>
              </BarraFixa>
            </div>
          )}

          {tela === 'feito' && feito && (
            <div className="px-4 pt-10 pb-10 text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center"><i className="ri-check-line text-3xl text-emerald-600" /></div>
              <p className="text-lg font-bold text-zinc-800 mt-4">{feito.titulo}</p>
              <p className="text-sm text-zinc-500 mt-2">{feito.sub}</p>
              {feito.comparacao && (
                <div className="mt-5 bg-white rounded-3xl border border-zinc-100 p-4 text-left">
                  <p className="text-sm font-bold text-zinc-700 mb-2">Mandaram × chegou</p>
                  {feito.comparacao.map((c) => (
                    <div key={c.l} className="py-1.5 text-sm"><span className="font-semibold text-zinc-800">{c.l}</span><span className="text-zinc-500"> — {c.v}</span></div>
                  ))}
                </div>
              )}
              <div className="mt-6 space-y-3">
                <BotaoPrincipal onClick={() => { carregar(); voltarInicio(); }}>Ver empréstimos</BotaoPrincipal>
                <button onClick={() => navigate('/modulos')} className="w-full py-3 text-sm text-zinc-500 cursor-pointer">Sair</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {picker && insumos && (
        <EscolherInsumo
          insumos={picker.modo === 'mandar' ? insumos.filter((i) => !linhas.some((l) => l.insumo.id === i.id)) : insumos}
          rotulo={picker.modo === 'mandar' ? 'Qual insumo vai?' : 'Entra no estoque daqui como'}
          mostrarEstoque={picker.modo === 'mandar'}
          onEscolher={(i) => {
            if (picker.modo === 'mandar') setLinhas((ls) => [...ls, { insumo: i, qtd: '' }]);
            else setRec((rs) => rs.map((x) => (x.chave === picker.chave ? { ...x, insumoId: i.id } : x)));
            setPicker(null);
          }}
          onFechar={() => setPicker(null)}
        />
      )}
      {picker && !insumos && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setPicker(null)}><Spinner texto="Carregando os insumos…" /></div>}
    </div>
  );
}

// ── Peças ─────────────────────────────────────────────────────────────────────
function CartaoHistorico({ h, aberto, onAbrir, onCancelar }: { h: Historico; aberto: boolean; onAbrir: () => void; onCancelar?: () => void }) {
  const selo = h.status === 'enviado'
    ? { t: h.sentido === 'mandei' ? 'A caminho' : 'Falta conferir', c: 'bg-amber-100 text-amber-700' }
    : h.status === 'recebido' ? { t: 'Recebido', c: 'bg-emerald-100 text-emerald-700' } : { t: 'Cancelado', c: 'bg-zinc-100 text-zinc-500' };
  const chegou = (id: string) => (h.itens_recebidos ?? []).filter((r) => r.enviado_ingredient_id === id);
  const aMais = (h.itens_recebidos ?? []).filter((r) => !r.enviado_ingredient_id);
  return (
    <div className="bg-white rounded-3xl border border-zinc-100">
      <button onClick={onAbrir} className="w-full text-left p-4 cursor-pointer">
        <div className="flex items-start gap-3">
          <i className={`${h.sentido === 'mandei' ? 'ri-arrow-right-up-line text-amber-500' : 'ri-arrow-left-down-line text-emerald-500'} text-2xl`} />
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-zinc-800 truncate">{h.sentido === 'mandei' ? `Para ${h.outra_loja}` : `De ${h.outra_loja}`}</p>
            <p className="text-xs text-zinc-500 truncate">{h.itens_enviados.map((i) => i.nome).join(', ')}</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">{quando(h.enviado_em)} · {h.enviado_por}{h.valor > 0 ? ` · ${brl(h.valor)}` : ''}</p>
          </div>
          <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 flex-shrink-0 ${selo.c}`}>{selo.t}</span>
        </div>
      </button>
      {aberto && (
        <div className="px-4 pb-4 -mt-1 space-y-1.5 text-sm">
          {h.itens_enviados.map((i) => {
            const rs = chegou(i.ingredient_id);
            return (
              <div key={i.ingredient_id} className="flex justify-between gap-3 border-t border-zinc-100 pt-1.5">
                <span className="text-zinc-700 min-w-0 truncate">{i.nome}</span>
                <span className="text-zinc-500 text-right flex-shrink-0">
                  {i.quantidade != null ? `mandou ${qtd(i.quantidade)} ${un(i.unidade)}` : ''}
                  {h.status === 'recebido' && <><br />chegou {rs.length ? rs.map((r) => `${qtd(r.quantidade)} ${un(r.unidade)}${r.nome !== i.nome ? ` (${r.nome})` : ''}`).join(' + ') : '0'}</>}
                </span>
              </div>
            );
          })}
          {aMais.map((r) => (
            <div key={r.ingredient_id} className="flex justify-between gap-3 border-t border-zinc-100 pt-1.5">
              <span className="text-zinc-700 truncate">{r.nome} <span className="text-xs text-zinc-400">(veio a mais)</span></span>
              <span className="text-zinc-500 flex-shrink-0">chegou {qtd(r.quantidade)} {un(r.unidade)}</span>
            </div>
          ))}
          {h.observacao && <p className="text-xs text-zinc-500 pt-1">Recado: {h.observacao}</p>}
          {h.recebido_em && <p className="text-xs text-zinc-500">Recebido por {h.recebido_por} em {quando(h.recebido_em)}{h.obs_recebimento ? ` — ${h.obs_recebimento}` : ''}</p>}
          {h.cancelado_em && <p className="text-xs text-zinc-500">Cancelado em {quando(h.cancelado_em)} — voltou para o estoque.</p>}
          {onCancelar && (
            <button onClick={onCancelar} className="mt-2 w-full py-2.5 rounded-2xl border border-red-200 text-red-600 text-sm font-semibold cursor-pointer">
              Cancelar (não foi / voltou)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EscolherInsumo({ insumos, rotulo, mostrarEstoque, onEscolher, onFechar }: {
  insumos: Insumo[]; rotulo: string; mostrarEstoque: boolean; onEscolher: (i: Insumo) => void; onFechar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const lista = useMemo(() => {
    const q = normalizar(busca);
    return (q ? insumos.filter((i) => normalizar(i.nome).includes(q)) : insumos).slice(0, 80);
  }, [busca, insumos]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onFechar}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92vh]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-zinc-100">
          <p className="flex-1 text-sm font-semibold text-zinc-800">{rotulo}</p>
          <button onClick={onFechar} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer" aria-label="Fechar">
            <i className="ri-close-line text-xl text-zinc-500" />
          </button>
        </div>
        <div className="px-5 py-3">
          <div className="flex items-center gap-2 bg-zinc-100 rounded-2xl px-4">
            <i className="ri-search-line text-zinc-400" />
            <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo" className="flex-1 bg-transparent py-3 text-base outline-none" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {lista.length === 0 && <p className="text-center text-sm text-zinc-400 py-8">Nenhum insumo com esse nome.</p>}
          {lista.map((i) => (
            <button key={i.id} onClick={() => onEscolher(i)} className="w-full text-left px-4 py-3.5 rounded-2xl hover:bg-zinc-50 flex items-center gap-3 cursor-pointer">
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-zinc-800 truncate">{i.nome}</p>
                <p className="text-xs text-zinc-500">{mostrarEstoque ? `Tem ${qtd(i.estoque)} ${un(i.unidade)}` : un(i.unidade)}{i.categoria ? ` · ${i.categoria}` : ''}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CampoQtd({ valor, unidade, placeholder, onValor }: { valor: string; unidade: string; placeholder: string; onValor: (v: string) => void }) {
  return (
    <div className="mt-3 flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-2xl px-4 focus-within:border-amber-400">
      <input value={valor} onChange={(e) => onValor(e.target.value)} inputMode="decimal" placeholder={placeholder}
        className="flex-1 bg-transparent py-3 text-base outline-none min-w-0" />
      {unidade && <span className="text-sm font-semibold text-zinc-500">{unidade}</span>}
    </div>
  );
}

function Campo({ valor, onValor, placeholder }: { valor: string; onValor: (v: string) => void; placeholder: string }) {
  return (
    <textarea value={valor} onChange={(e) => onValor(e.target.value)} placeholder={placeholder} rows={2}
      className="w-full bg-white border border-zinc-100 rounded-2xl px-4 py-3 text-base outline-none focus:border-amber-400 resize-none" />
  );
}

function BarraFixa({ children }: { children: ReactNode }) {
  return (
    <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-zinc-100 px-4 pt-3 z-40" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
      <div className="max-w-xl mx-auto">{children}</div>
    </div>
  );
}

function BotaoPrincipal({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full py-4 rounded-2xl bg-amber-500 active:bg-amber-600 disabled:bg-zinc-200 disabled:text-zinc-400 text-white text-base font-bold cursor-pointer">
      {children}
    </button>
  );
}

function Spinner({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div className="w-9 h-9 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-zinc-500">{texto}</p>
    </div>
  );
}
