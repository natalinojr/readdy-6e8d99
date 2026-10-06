// Financeiro › Pagamentos — "em que pé está" cada pagamento, por tipo (2026-10-06, pedido do dono: "eu
// preciso conseguir ver em que pé está cada pagamento conforme cada tipo de pagamento").
// Cinco tipos, cada um com o seu caminho: contas fixas, mercadoria a prazo, compra à vista, pessoas, avulsos.
// A Trilha continua igual (o histórico de cada despesa); aqui é o que falta acontecer.
// Regras no banco (fn_contas_fixas, fn_pagamentos, fn_aviso_pagar) — as mesmas da Hoje e do botão de pagar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DONO_EMAIL } from '../../../../../supabase/functions/_shared/pendencia-visivel';
import { caixaDaLoja, grupoMercadoria, pacoteDaSemana, resumoFixas, type ContaFixa } from '@/lib/pagamentos';
import {
  carregarFixas, carregarPagamentos, lerDiaDePagar, lojasDoFinanceiro, salvarDiaDePagar, type DadosPagamentos, type LojaFin,
} from './api';
import { brl, Cartao, ddmm, Pilula } from './comum';
import FixasView from './FixasView';
import MercadoriaView from './MercadoriaView';
import { AvulsosView, CaminhoView, PessoasView, VistaView } from './OutrosViews';
import PacoteView from './PacoteView';

type Ver = 'geral' | 'fixas' | 'mercadoria' | 'vista' | 'pessoas' | 'avulsos' | 'pacote' | 'caminho';
const VERES: Ver[] = ['geral', 'fixas', 'mercadoria', 'vista', 'pessoas', 'avulsos', 'pacote', 'caminho'];
const ESCOPO_KEY = 'erpos.pagamentos.escopo';
const lerEscopo = (): 'loja' | 'todas' => { try { return localStorage.getItem(ESCOPO_KEY) === 'todas' ? 'todas' : 'loja'; } catch { return 'loja'; } };

export default function PagamentosTab() {
  const { user, selectTenant } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ver: Ver = VERES.includes(params.get('ver') as Ver) ? (params.get('ver') as Ver) : 'geral';
  const irVer = (v: Ver) => { const n = new URLSearchParams(params); n.set('ver', v); setParams(n, { replace: true }); };

  const dono = (user?.email ?? '').toLowerCase() === DONO_EMAIL;
  const perfil = user?.perfil;
  const financeiro = dono || perfil === 'admin' || perfil === 'gerente' || perfil === 'financeiro';

  const [lojas, setLojas] = useState<LojaFin[]>([]);
  const [escopo, setEscopo] = useState<'loja' | 'todas'>(lerEscopo);
  const todas = escopo === 'todas' && lojas.length > 1;
  const tenants = useMemo(() => (todas ? lojas.map((l) => l.tenantId) : user?.tenantId ? [user.tenantId] : []), [todas, lojas, user?.tenantId]);

  const hojeBR = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const mesAtual = `${hojeBR.slice(0, 7)}-01`;
  const [mes, setMes] = useState(mesAtual);
  const [fixas, setFixas] = useState<ContaFixa[]>([]);
  const [dados, setDados] = useState<DadosPagamentos | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [diaDePagar, setDiaDePagar] = useState<number | null>(null);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const ultimaCarga = useRef(0);
  // A visão geral é sempre do mês corrente (o mês só muda dentro de Contas fixas).
  useEffect(() => { if (ver !== 'fixas') setMes(mesAtual); }, [ver, mesAtual]);

  useEffect(() => {
    if (!user?.id) return;
    lojasDoFinanceiro(user.id).then(setLojas).catch(() => setLojas([]));
    if (dono) lerDiaDePagar().then(setDiaDePagar).catch(() => setDiaDePagar(null));
  }, [user?.id, dono]);

  useEffect(() => {
    if (!tenants.length) return;
    let vivo = true;
    setCarregando(true); setErro(null);
    ultimaCarga.current = Date.now();
    Promise.all([carregarFixas(tenants, mes), carregarPagamentos(tenants)])
      .then(([f, d]) => { if (vivo) { setFixas(f); setDados(d); } })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [tenants, mes, versao]);

  // Outra loja: nada da loja anterior na tela.
  useEffect(() => { setDados(null); setFixas([]); }, [tenants]);
  // O chat do dono paga com PIN; quando volta, a lista precisa se atualizar (no máximo 1× por minuto:
  // as funções do banco são pesadas e o banco já travou por IO uma vez).
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible' && Date.now() - ultimaCarga.current > 60_000) recarregar(); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [recarregar]);

  const irPara = async (tenantId: string, rota: string) => {
    if (tenantId && tenantId !== user?.tenantId) await selectTenant(tenantId);
    navigate(rota);
  };

  const hoje = dados?.hoje || hojeBR;
  const avisos = dados?.avisos ?? {};
  const fixasMesAtual = mes === mesAtual ? fixas : [];
  const rf = resumoFixas(fixasMesAtual);
  const merc = dados?.mercadoria ?? [];
  const gruposMerc = merc.map((m) => grupoMercadoria(m, avisos));
  const naoPague = gruposMerc.filter((g) => g === 'nao_pague').length;
  const prontas = gruposMerc.filter((g) => g === 'pronta').length;
  const semBoleto = gruposMerc.filter((g) => g === 'sem_boleto').length;
  const emAberto = merc.reduce((s, m) => s + m.contas.filter((c) => c.status !== 'paid').reduce((x, c) => x + Number(c.saldo), 0), 0);
  const vista = dados?.vista ?? [];
  const vistaFaltam = vista.filter((c) => c.itens_ligados < c.itens).length;
  const pessoas = dados?.pessoas ?? [];
  const aPagarPessoas = pessoas.filter((p) => p.tipo === 'freela' || p.tipo === 'pedido_pagar');
  const aprovar = pessoas.filter((p) => p.tipo === 'aprovar').length;
  const avulsos = dados?.avulsos ?? [];
  const vencidas = (dados?.caixa ?? []).flatMap((c) => c.contas).filter((c) => c.vencimento < hoje && Number(c.valor) > 0.005);
  const pacote = dados ? pacoteDaSemana(dados.caixa, avisos, hoje, diaDePagar ?? new Date(`${hoje}T12:00:00Z`).getUTCDay()) : null;

  const contagem: Partial<Record<Ver, number>> = {
    fixas: rf.urgentes + rf.naoChegaram + rf.confirmar,
    mercadoria: naoPague + (dados?.notas.length ?? 0),
    vista: vistaFaltam, pessoas: aPagarPessoas.length + aprovar, avulsos: avulsos.length,
  };
  const ABAS: Array<{ id: Ver; label: string; icone: string }> = [
    { id: 'geral', label: 'Visão geral', icone: 'ri-dashboard-line' },
    { id: 'fixas', label: 'Contas fixas', icone: 'ri-repeat-line' },
    { id: 'mercadoria', label: 'Mercadoria a prazo', icone: 'ri-truck-line' },
    { id: 'vista', label: 'Compra à vista', icone: 'ri-hand-coin-line' },
    { id: 'pessoas', label: 'Pessoas', icone: 'ri-team-line' },
    { id: 'avulsos', label: 'Avulsos', icone: 'ri-question-line' },
    { id: 'pacote', label: 'Dia de pagar', icone: 'ri-stack-line' },
    { id: 'caminho', label: 'Caminho de cada tipo', icone: 'ri-route-line' },
  ];

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-xl font-extrabold text-zinc-900">Pagamentos — em que pé está</h2>
          <p className="text-[13px] text-zinc-500">Cada tipo de pagamento tem o seu caminho. Aqui você vê onde cada um parou e o que falta para pagar com segurança.</p>
        </div>
        <div className="flex items-center gap-2">
          {lojas.length > 1 && (
            <div className="flex rounded-xl border border-zinc-200 bg-white p-0.5 text-xs font-bold">
              {(['loja', 'todas'] as const).map((e) => (
                <button key={e} onClick={() => { setEscopo(e); try { localStorage.setItem(ESCOPO_KEY, e); } catch { /* sem storage */ } }}
                  className={`px-3 h-8 rounded-lg cursor-pointer ${escopo === e ? 'bg-zinc-900 text-white' : 'text-zinc-600'}`}>
                  {e === 'loja' ? 'Esta loja' : `Todas as lojas (${lojas.length})`}
                </button>
              ))}
            </div>
          )}
          <button onClick={recarregar} disabled={carregando} className="h-9 px-3 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-600 cursor-pointer disabled:opacity-60">
            <i className={`ri-refresh-line ${carregando ? 'animate-spin inline-block' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {ABAS.map((a) => (
          <button key={a.id} onClick={() => irVer(a.id)}
            className={`flex-none h-9 px-3 rounded-full border text-[13px] font-bold flex items-center gap-1.5 cursor-pointer ${ver === a.id ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600'}`}>
            <i className={a.icone} />{a.label}
            {(contagem[a.id] ?? 0) > 0 && <span className={`px-1.5 rounded-full text-[11px] ${ver === a.id ? 'bg-white/20' : 'bg-red-50 text-red-600'}`}>{contagem[a.id]}</span>}
          </button>
        ))}
      </div>

      {erro && <p className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">{erro}</p>}

      {ver === 'geral' && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CartaoTipo icone="ri-repeat-line" cor="text-sky-700 bg-sky-50" titulo={`Contas fixas de ${new Date(`${mesAtual}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' })}`}
              grande={rf.total ? `${rf.pagas} de ${rf.total} ${rf.pagas === 1 ? 'paga' : 'pagas'}` : 'Nenhuma ainda'} onAbrir={() => irVer('fixas')}
              linhas={[
                rf.urgentes ? { tom: 'red', t: `${rf.urgentes} vencendo ou vencida${rf.urgentes > 1 ? 's' : ''}` } : null,
                rf.naoChegaram ? { tom: 'amber', t: `${rf.naoChegaram} atrasada${rf.naoChegaram > 1 ? 's' : ''} para chegar: ${fixasMesAtual.filter((f) => f.estado === 'atrasada_chegar').map((f) => f.categoria.split(' › ').pop()).slice(0, 3).join(', ')}` } : null,
                rf.aPagar ? { tom: 'zinc', t: `${rf.aPagar} chegaram e vencem mais pra frente` } : null,
                rf.confirmar ? { tom: 'amber', t: `${rf.confirmar} para confirmar se é fixa` } : null,
                !rf.total ? { tom: 'zinc', t: 'Marque as categorias que acontecem todo mês' } : null,
              ]} />
            <CartaoTipo icone="ri-truck-line" cor="text-amber-700 bg-amber-50" titulo="Mercadoria a prazo" grande={`${brl(emAberto)} em aberto`} onAbrir={() => irVer('mercadoria')}
              linhas={[
                naoPague ? { tom: 'red', t: `${naoPague} com aviso — não pague ainda` } : null,
                dados?.notas.length ? { tom: 'amber', t: `${dados.notas.length} ${dados.notas.length > 1 ? 'notas ainda não viraram' : 'nota ainda não virou'} compra` } : null,
                semBoleto ? { tom: 'amber', t: `${semBoleto} sem boleto ainda` } : null,
                prontas ? { tom: 'green', t: `${prontas} chegaram certo — prontas para pagar` } : null,
              ]} />
            <CartaoTipo icone="ri-hand-coin-line" cor="text-emerald-700 bg-emerald-50" titulo="Compra à vista (notinha)" grande={`${vista.length} em 30 dias, todas pagas`} onAbrir={() => irVer('vista')}
              linhas={[
                vistaFaltam ? { tom: 'amber', t: `${vistaFaltam} com item novo para ligar` } : { tom: 'green', t: 'Itens ligados' },
                { tom: 'zinc', t: 'Não trava nada — só fica de lição' },
              ]} />
            <CartaoTipo icone="ri-team-line" cor="text-violet-700 bg-violet-50" titulo="Pessoas" grande={`${brl(aPagarPessoas.reduce((s, p) => s + Number(p.valor), 0))} a pagar`} onAbrir={() => irVer('pessoas')}
              linhas={[
                aPagarPessoas.filter((p) => p.tipo === 'freela').length ? { tom: 'red', t: `Diárias de ${aPagarPessoas.filter((p) => p.tipo === 'freela').length} freela${aPagarPessoas.filter((p) => p.tipo === 'freela').length > 1 ? 's' : ''} sem pagar` } : null,
                aprovar ? { tom: 'amber', t: `${aprovar} pedido${aprovar > 1 ? 's' : ''} esperando você aprovar` } : null,
                pessoas.filter((p) => p.tipo === 'folha').length ? { tom: 'zinc', t: `${pessoas.filter((p) => p.tipo === 'folha').length} na folha pendente` } : null,
              ]} />
            <CartaoTipo icone="ri-question-line" cor="text-zinc-700 bg-zinc-100" titulo="Avulsos" grande={avulsos.length ? `${avulsos.length} sem explicação` : 'Tudo explicado'} onAbrir={() => irVer('avulsos')}
              linhas={[
                avulsos.length ? { tom: 'red', t: `${avulsos.length} saída${avulsos.length > 1 ? 's' : ''} do banco sem dizer o que foi — ${brl(avulsos.reduce((s, a) => s + Number(a.valor), 0))}` } : null,
                dados?.online.length ? { tom: 'amber', t: `${dados.online.length} compra online esperando a nota` } : null,
              ]} />
            {pacote && (
              <CartaoTipo icone="ri-stack-line" cor="text-emerald-700 bg-emerald-50" titulo={diaDePagar != null ? 'Pacote do dia de pagar' : 'Próximos 7 dias'}
                grande={`${pacote.prontas.length} prontas · ${brl(pacote.total)}`} onAbrir={() => irVer('pacote')}
                linhas={[
                  vencidas.length ? { tom: 'red', t: `${vencidas.length} ${vencidas.length === 1 ? 'conta vencida' : 'contas vencidas'} — ${brl(vencidas.reduce((x, c) => x + Number(c.valor), 0))}` } : null,
                  pacote.comAviso.length ? { tom: 'red', t: `${pacote.comAviso.length} com aviso, fora do pacote` } : null,
                  pacote.semJeito.length ? { tom: 'amber', t: `${pacote.semJeito.length} sem boleto nem Pix guardado` } : null,
                  ...(dados?.caixa ?? []).map((c) => {
                    const cx = caixaDaLoja(c, hoje);
                    return cx && !cx.cobre ? { tom: 'red' as const, t: `${todas ? `${c.loja}: ` : ''}faltam ${brl(cx.falta)} no banco para a semana` } : null;
                  }),
                ]} />
            )}
          </div>

          <ListaAgora fixas={fixasMesAtual} dados={dados} avisos={avisos} hoje={hoje} mostrarLoja={todas} irVer={irVer} />
        </div>
      )}

      {ver === 'fixas' && (
        <FixasView itens={fixas} carregando={carregando} tenantUnico={todas ? null : user?.tenantId ?? null} mostrarLoja={todas}
          mes={mes} mesAtual={mesAtual} onMes={setMes} dono={dono} financeiro={financeiro} onMudou={recarregar} />
      )}
      {ver === 'mercadoria' && dados && (
        <MercadoriaView compras={dados.mercadoria} notas={dados.notas} avisos={avisos} mostrarLoja={todas} dono={dono} financeiro={financeiro} onMudou={recarregar} irPara={irPara} tenantAtual={user?.tenantId ?? null} />
      )}
      {ver === 'vista' && dados && <VistaView compras={dados.vista} mostrarLoja={todas} irPara={irPara} tenantAtual={user?.tenantId ?? null} onMudou={recarregar} />}
      {ver === 'pessoas' && dados && <PessoasView pessoas={dados.pessoas} mostrarLoja={todas} dono={dono} financeiro={financeiro} onMudou={recarregar} irPara={irPara} />}
      {ver === 'avulsos' && dados && <AvulsosView avulsos={dados.avulsos} online={dados.online} mostrarLoja={todas} irPara={irPara} />}
      {ver === 'pacote' && dados && (
        <PacoteView caixa={dados.caixa} avisos={avisos} hoje={hoje} mostrarLoja={todas} dono={dono} financeiro={financeiro}
          diaDePagar={diaDePagar} onDia={async (d) => { await salvarDiaDePagar(d); setDiaDePagar(d); }} onMudou={recarregar} />
      )}
      {ver === 'caminho' && <CaminhoView />}
      {!dados && carregando && ver !== 'caminho' && ver !== 'fixas' && <p className="text-sm text-zinc-400">Carregando…</p>}
    </div>
  );
}

type Linha = { tom: 'red' | 'amber' | 'green' | 'zinc'; t: string } | null;
function CartaoTipo({ icone, cor, titulo, grande, linhas, onAbrir }: { icone: string; cor: string; titulo: string; grande: string; linhas: Linha[]; onAbrir: () => void }) {
  const ponto: Record<string, string> = { red: 'bg-red-500', amber: 'bg-amber-400', green: 'bg-emerald-500', zinc: 'bg-zinc-300' };
  return (
    <button onClick={onAbrir} className="text-left bg-white rounded-2xl border border-zinc-200 hover:border-amber-400 px-4 py-3.5 cursor-pointer transition-colors">
      <span className={`w-9 h-9 rounded-xl grid place-items-center text-lg mb-2 ${cor}`}><i className={icone} /></span>
      <p className="text-[15px] font-bold text-zinc-900 first-letter:uppercase">{titulo}</p>
      <p className="text-xl font-extrabold text-zinc-900 my-1 tabular-nums">{grande}</p>
      {linhas.filter(Boolean).map((l, i) => (
        <p key={i} className="text-[12.5px] text-zinc-600 flex gap-1.5 items-start my-0.5"><span className={`w-2 h-2 rounded-full mt-1.5 flex-none ${ponto[l!.tom]}`} />{l!.t}</p>
      ))}
    </button>
  );
}

/** "Precisa de você agora": o mais urgente de cada tipo, numa lista só. */
function ListaAgora({ fixas, dados, avisos, hoje, mostrarLoja, irVer }: {
  fixas: ContaFixa[]; dados: DadosPagamentos | null; avisos: DadosPagamentos['avisos']; hoje: string; mostrarLoja: boolean; irVer: (v: Ver) => void;
}) {
  type Item = { chave: string; pill: string; tom: 'red' | 'amber'; titulo: string; detalhe: string; ver: Ver; ordem: string };
  const itens: Item[] = [];
  const loja = (l: string) => (mostrarLoja ? ` · ${l}` : '');
  for (const f of fixas) {
    if (f.confirmar) continue;
    if (f.estado === 'vencida' || f.estado === 'vence_hoje') itens.push({ chave: `f${f.categoria_id}${f.chave}`, pill: f.estado === 'vencida' ? 'Vencida' : 'Vence hoje', tom: 'red', titulo: `${f.nome} · ${brl(f.saldo)}`, detalhe: `Conta fixa (${f.categoria})${loja(f.loja)}.`, ver: 'fixas', ordem: f.vence_em ?? hoje });
    else if (f.estado === 'atrasada_chegar') itens.push({ chave: `f${f.categoria_id}${f.chave}`, pill: 'Não chegou', tom: 'amber', titulo: `${f.categoria} — ${f.nome}`, detalhe: `Conta fixa${loja(f.loja)}. ${f.so_extrato ? `Costuma ser paga por volta do dia ${f.dia_vence}.` : `Costuma chegar até o dia ${f.dia_chega}.`}`, ver: 'fixas', ordem: hoje });
    else if (f.fora_pct != null && f.estado === 'a_pagar') itens.push({ chave: `f${f.categoria_id}${f.chave}`, pill: 'Valor fora', tom: 'amber', titulo: `${f.nome} · ${brl(f.saldo)}`, detalhe: `Veio ${Math.abs(f.fora_pct)}% ${f.fora_pct > 0 ? 'acima' : 'abaixo'} da média (${brl(f.media)})${loja(f.loja)}.`, ver: 'fixas', ordem: f.vence_em ?? hoje });
  }
  for (const m of dados?.mercadoria ?? []) {
    const g = grupoMercadoria(m, avisos);
    const prox = m.contas.find((c) => c.status !== 'paid');
    if (g === 'nao_pague' && prox) {
      const naoChegou = m.espera_chegar !== false && !m.chegou_em;
      itens.push({ chave: `m${m.id}`, pill: naoChegou ? 'Não chegou' : m.diferente ? 'Chegou diferente' : 'Com aviso', tom: naoChegou ? 'amber' : 'red',
        titulo: `${m.fornecedor}${m.numero ? ` NF ${m.numero}` : ''} · ${brl(prox.saldo)} · ${prox.vence < hoje ? 'venceu' : 'vence'} ${ddmm(prox.vence)}`,
        detalhe: `${naoChegou ? `Nota de ${ddmm(m.emitida)}; ninguém confirmou a entrega.` : (avisos[prox.id]?.[0]?.texto ?? 'Chegou diferente na conferência.')}${loja(m.loja)}`, ver: 'mercadoria', ordem: prox.vence });
    }
  }
  for (const n of dados?.notas ?? []) {
    const v = (n.parcelas ?? []).map((p) => p.vencimento).filter(Boolean).sort()[0];
    if (v && v <= hoje.slice(0, 8) + '31') itens.push({ chave: `n${n.id}`, pill: 'Falta lançar', tom: 'amber', titulo: `${n.fornecedor}${n.numero ? ` NF ${n.numero}` : ''} · ${brl(n.valor)}`, detalhe: `A nota não virou compra — sem isso não nasce a conta a pagar${loja(n.loja)}.`, ver: 'mercadoria', ordem: v });
  }
  // Qualquer conta vencida ou que vence hoje (2026-10-06, o dono: "estou com um pagamento vencido, não
  // tinha que estar aí?") — a que já não entrou acima como conta fixa ou mercadoria.
  const jaNaLista = new Set<string>([
    ...fixas.flatMap((f) => f.contas.map((c) => c.id)),
    ...(dados?.mercadoria ?? []).filter((m) => grupoMercadoria(m, avisos) === 'nao_pague').flatMap((m) => m.contas.map((c) => c.id)),
  ]);
  for (const cx of dados?.caixa ?? []) {
    for (const c of cx.contas) {
      if (c.vencimento > hoje || jaNaLista.has(c.id) || !(Number(c.valor) > 0.005)) continue;
      const dias = Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${c.vencimento}T12:00:00Z`)) / 86400000);
      const av = avisos[c.id]?.[0]?.texto;
      itens.push({ chave: `c${c.id}`, pill: dias > 0 ? 'Vencida' : 'Vence hoje', tom: 'red',
        titulo: `${c.nome} · ${brl(c.valor)}`,
        detalhe: `${dias > 0 ? `Venceu ${ddmm(c.vencimento)} (${dias} ${dias === 1 ? 'dia' : 'dias'})` : 'Vence hoje'}${c.tem_boleto ? '' : ' · sem boleto nem Pix guardado'}${av ? ` · ${av}` : ''}${loja(cx.loja)}.`,
        ver: 'pacote', ordem: c.vencimento });
    }
  }
  for (const a of (dados?.avulsos ?? []).slice(0, 5)) {
    itens.push({ chave: `a${a.id}`, pill: 'Sem explicação', tom: 'red', titulo: `${brl(a.valor)} → ${a.para}`, detalhe: `Saiu do banco em ${ddmm(a.data)} e ninguém disse o que foi${loja(a.loja)}.`, ver: 'avulsos', ordem: a.data });
  }
  itens.sort((a, b) => a.ordem.localeCompare(b.ordem));
  if (!itens.length) return (
    <Cartao><p className="text-sm text-emerald-700 font-semibold"><i className="ri-checkbox-circle-line" /> Nada pedindo você agora nos pagamentos.</p></Cartao>
  );
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-red-600">Precisa de você agora <span className="ml-1 px-2 rounded-full bg-zinc-100 text-zinc-600 tracking-normal">{itens.length}</span></h3>
      {itens.map((i) => (
        <button key={i.chave} onClick={() => irVer(i.ver)} className="text-left bg-white rounded-2xl border border-zinc-200 hover:border-amber-400 px-4 py-3 flex items-center gap-3 cursor-pointer">
          <Pilula tom={i.tom}>{i.pill}</Pilula>
          <span className="flex-1 min-w-0">
            <b className="text-sm block truncate">{i.titulo}</b>
            <span className="text-xs text-zinc-500">{i.detalhe}</span>
          </span>
          <i className="ri-arrow-right-s-line text-zinc-400 text-lg" />
        </button>
      ))}
    </section>
  );
}
