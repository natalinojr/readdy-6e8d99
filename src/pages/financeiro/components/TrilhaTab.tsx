// Trilha das despesas (2026-09-29)
// "Essa despesa está certa?" num lugar só: cada compra/despesa aparece com as 6 etapas
// (documento → lançamento → estoque → conta a pagar → pagamento → banco), cada uma verde, amarela,
// vermelha ou "não se aplica". Clicando no caso abre a trilha detalhada com atalho para a tela
// de cada etapa. Montagem em src/lib/trilhaDespesas.ts; dados pela RPC fin_trilha_dados.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import {
  montarTrilha, diaBR, NOMES_ETAPA,
  type CasoTrilha, type EtapaId, type EstadoEtapa, type EtapaTrilha, type TrilhaDados, type TipoCaso, type Atalho,
} from '@/lib/trilhaDespesas';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const hojeBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const limitesMes = (ano: number, mes: number) => {
  const de = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
  const ult = new Date(ano, mes + 1, 0).getDate();
  return { de, ate: `${ano}-${String(mes + 1).padStart(2, '0')}-${String(ult).padStart(2, '0')}` };
};

const ICONE_ETAPA: Record<EtapaId, string> = {
  documento: 'ri-file-text-line', lancamento: 'ri-shopping-cart-2-line', estoque: 'ri-archive-2-line',
  conta: 'ri-bill-line', pagamento: 'ri-money-dollar-circle-line', banco: 'ri-bank-line',
};
const ESTILO: Record<EstadoEtapa, { bola: string; texto: string; linha: string; icone?: string; rotulo: string }> = {
  ok: { bola: 'bg-emerald-500 text-white border-emerald-500', texto: 'text-emerald-700', linha: 'bg-emerald-400', icone: 'ri-check-line', rotulo: 'Feito' },
  pendente: { bola: 'bg-amber-400 text-white border-amber-400', texto: 'text-amber-700', linha: 'bg-zinc-200', icone: 'ri-time-line', rotulo: 'Falta fazer' },
  atrasado: { bola: 'bg-red-500 text-white border-red-500', texto: 'text-red-700', linha: 'bg-zinc-200', icone: 'ri-alarm-warning-line', rotulo: 'Atrasado' },
  problema: { bola: 'bg-red-500 text-white border-red-500', texto: 'text-red-700', linha: 'bg-zinc-200', icone: 'ri-error-warning-line', rotulo: 'Problema' },
  espera: { bola: 'bg-white text-zinc-300 border-zinc-300', texto: 'text-zinc-400', linha: 'bg-zinc-200', rotulo: 'Aguardando' },
  na: { bola: 'bg-zinc-50 text-zinc-300 border-dashed border-zinc-200', texto: 'text-zinc-400', linha: 'bg-zinc-200', icone: 'ri-subtract-line', rotulo: 'Não se aplica' },
};
const ruim = (e: EstadoEtapa) => e === 'problema' || e === 'atrasado' || e === 'pendente';

const TIPOS: { id: 'todos' | TipoCaso; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'compra', label: 'Compras' },
  { id: 'despesa', label: 'Despesas' },
  { id: 'nota', label: 'Notas não lançadas' },
  { id: 'pagamento', label: 'Pagamentos sem lançamento' },
  { id: 'pedido', label: 'Pedidos' },
];
type Situacao = 'todas' | 'atencao' | 'andamento' | 'ok';

export default function TrilhaTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const hoje = hojeBR();
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)) - 1);
  const [dados, setDados] = useState<TrilhaDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<Situacao>('todas');
  const [tipo, setTipo] = useState<'todos' | TipoCaso>('todos');
  const [etapaFiltro, setEtapaFiltro] = useState<EtapaId | null>(null);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [limite, setLimite] = useState(60);
  const { de, ate } = limitesMes(ano, mes);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc('fin_trilha_dados', { p_tenant: user.tenantId, p_start: de, p_end: ate });
    setCarregando(false);
    if (error) { setErro(error.message); setDados(null); return; }
    setDados(data as TrilhaDados);
  }, [user?.tenantId, de, ate]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { setLimite(60); setAberto(null); }, [de, situacao, tipo, etapaFiltro, busca]);

  const casos = useMemo(() => (dados ? montarTrilha(dados, de, ate, hoje) : []), [dados, de, ate, hoje]);

  const contagem = useMemo(() => ({
    todas: casos.length,
    atencao: casos.filter((c) => c.situacao === 'atencao').length,
    andamento: casos.filter((c) => c.situacao === 'andamento').length,
    ok: casos.filter((c) => c.situacao === 'ok').length,
  }), [casos]);

  // Onde a corrente trava: quantos casos têm cada etapa em aberto/com problema
  const gargalos = useMemo(() => {
    const ids: EtapaId[] = ['documento', 'lancamento', 'estoque', 'conta', 'pagamento', 'banco'];
    return ids.map((id) => {
      const com = casos.filter((c) => ruim(c.etapas.find((e) => e.id === id)!.estado));
      const graves = com.filter((c) => { const e = c.etapas.find((x) => x.id === id)!.estado; return e === 'problema' || e === 'atrasado'; }).length;
      return { id, n: com.length, graves };
    }).filter((g) => g.n > 0);
  }, [casos]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return casos.filter((c) =>
      (situacao === 'todas' || c.situacao === situacao)
      && (tipo === 'todos' || c.tipo === tipo)
      && (!etapaFiltro || ruim(c.etapas.find((e) => e.id === etapaFiltro)!.estado))
      && (!q || `${c.titulo} ${c.subtitulo} ${c.notas.map((n) => n.numero).join(' ')} ${c.compra?.invoice_number ?? ''} ${c.valor.toFixed(2).replace('.', ',')}`.toLowerCase().includes(q)));
  }, [casos, situacao, tipo, etapaFiltro, busca]);

  const mudarMes = (d: number) => {
    const m = mes + d;
    if (m < 0) { setMes(11); setAno(ano - 1); } else if (m > 11) { setMes(0); setAno(ano + 1); } else setMes(m);
  };

  const ir = (a: Atalho) => navigate('/financeiro?tab=' + a.tab + (a.param && a.valor ? '&' + a.param + '=' + encodeURIComponent(a.valor) : ''));

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-800 flex items-center gap-2"><i className="ri-route-line text-amber-500" />Trilha das despesas</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Cada compra e despesa do começo ao fim — da nota até a saída no banco. Verde = feito, amarelo = falta fazer, vermelho = precisa de atenção.</p>
        </div>
        <div className="flex items-center gap-1 self-start md:self-auto">
          <button onClick={() => mudarMes(-1)} className="w-8 h-8 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 cursor-pointer" aria-label="Mês anterior"><i className="ri-arrow-left-s-line" /></button>
          <span className="px-3 text-sm font-semibold text-zinc-700 min-w-[140px] text-center">{MESES[mes]} {ano}</span>
          <button onClick={() => mudarMes(1)} className="w-8 h-8 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 cursor-pointer" aria-label="Próximo mês"><i className="ri-arrow-right-s-line" /></button>
          <button onClick={() => void carregar()} className="w-8 h-8 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 cursor-pointer ml-1" aria-label="Atualizar" title="Atualizar"><i className={`ri-refresh-line ${carregando ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {/* Resumo por situação */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {([
          { id: 'todas', label: 'Todos os casos', icone: 'ri-stack-line', cor: 'text-zinc-700', fundo: 'border-zinc-300' },
          { id: 'atencao', label: 'Precisam de atenção', icone: 'ri-error-warning-line', cor: 'text-red-600', fundo: 'border-red-300' },
          { id: 'andamento', label: 'Em andamento', icone: 'ri-time-line', cor: 'text-amber-600', fundo: 'border-amber-300' },
          { id: 'ok', label: 'Completos', icone: 'ri-checkbox-circle-line', cor: 'text-emerald-600', fundo: 'border-emerald-300' },
        ] as const).map((s) => (
          <button key={s.id} onClick={() => setSituacao(s.id)}
            className={`text-left rounded-xl border bg-white px-3 py-2.5 cursor-pointer transition-shadow hover:shadow-sm ${situacao === s.id ? s.fundo + ' ring-2 ring-offset-0 ring-amber-100' : 'border-zinc-200'}`}>
            <p className={`text-xs font-semibold flex items-center gap-1 ${s.cor}`}><i className={s.icone} />{s.label}</p>
            <p className="text-2xl font-bold text-zinc-800 mt-0.5">{carregando && !dados ? '…' : contagem[s.id]}</p>
          </button>
        ))}
      </div>

      {/* Onde trava */}
      {gargalos.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
          <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Onde a trilha está parada</p>
          <div className="flex flex-wrap gap-1.5">
            {gargalos.map((g) => (
              <button key={g.id} onClick={() => setEtapaFiltro(etapaFiltro === g.id ? null : g.id)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border cursor-pointer ${etapaFiltro === g.id ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400'}`}>
                <i className={ICONE_ETAPA[g.id]} />{NOMES_ETAPA[g.id]}
                <span className={`font-bold px-1.5 rounded-full text-[10px] ${g.graves ? 'bg-red-500 text-white' : 'bg-amber-400 text-white'}`}>{g.n}</span>
              </button>
            ))}
            {etapaFiltro && <button onClick={() => setEtapaFiltro(null)} className="text-xs text-zinc-500 underline cursor-pointer px-1">limpar</button>}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
          {TIPOS.map((t) => (
            <button key={t.id} onClick={() => setTipo(t.id)}
              className={`text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap cursor-pointer border ${tipo === t.id ? 'bg-amber-50 border-amber-300 text-amber-700 font-semibold' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative md:ml-auto md:w-64">
          <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, nº da nota, valor…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-amber-400" />
        </div>
      </div>

      {/* Lista */}
      {erro && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">Não foi possível carregar a trilha: {erro}</div>}
      {carregando && !dados && <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">Montando a trilha…</div>}
      {!carregando && !erro && filtrados.length === 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">
          {casos.length === 0 ? 'Nenhuma compra ou despesa neste mês.' : 'Nenhum caso com esses filtros.'}
        </div>
      )}

      <div className="space-y-2">
        {filtrados.slice(0, limite).map((c) => (
          <CasoCard key={c.key} caso={c} aberto={aberto === c.key} onToggle={() => setAberto(aberto === c.key ? null : c.key)} ir={ir} />
        ))}
      </div>
      {filtrados.length > limite && (
        <button onClick={() => setLimite(limite + 60)} className="w-full py-2 text-sm text-zinc-600 border border-zinc-200 rounded-xl bg-white hover:bg-zinc-50 cursor-pointer">
          Mostrar mais ({filtrados.length - limite} restantes)
        </button>
      )}
    </div>
  );
}

const ROTULO_TIPO: Record<TipoCaso, { t: string; cls: string }> = {
  compra: { t: 'Compra', cls: 'bg-blue-50 text-blue-700' },
  despesa: { t: 'Despesa', cls: 'bg-violet-50 text-violet-700' },
  nota: { t: 'Nota', cls: 'bg-zinc-100 text-zinc-700' },
  pedido: { t: 'Pedido', cls: 'bg-teal-50 text-teal-700' },
  pagamento: { t: 'Banco', cls: 'bg-orange-50 text-orange-700' },
};
const BORDA: Record<CasoTrilha['situacao'], string> = { atencao: 'border-l-red-500', andamento: 'border-l-amber-400', ok: 'border-l-emerald-500' };

function CasoCard({ caso, aberto, onToggle, ir }: { caso: CasoTrilha; aberto: boolean; onToggle: () => void; ir: (a: Atalho) => void }) {
  const tp = ROTULO_TIPO[caso.tipo];
  return (
    <div className={`rounded-xl border border-zinc-200 border-l-4 ${BORDA[caso.situacao]} bg-white overflow-hidden`}>
      <button onClick={onToggle} className="w-full text-left px-3 md:px-4 py-3 cursor-pointer hover:bg-zinc-50/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${tp.cls}`}>{tp.t}</span>
              <span className="text-sm font-semibold text-zinc-800 truncate">{caso.titulo}</span>
            </div>
            <p className="text-xs text-zinc-500 truncate mt-0.5">{diaBR(caso.data)} · {caso.subtitulo}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-zinc-800">{formatCurrency(caso.valor)}</p>
            <i className={`text-zinc-400 ${aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
          </div>
        </div>
        <Trilho etapas={caso.etapas} />
        {caso.avisos.length > 0 && !aberto && (
          <p className="mt-2 text-xs text-red-600 flex items-start gap-1"><i className="ri-error-warning-line mt-px" />{caso.avisos[0]}{caso.avisos.length > 1 ? ` (+${caso.avisos.length - 1})` : ''}</p>
        )}
      </button>
      {aberto && <Detalhe caso={caso} ir={ir} />}
    </div>
  );
}

/** As 6 bolinhas ligadas por uma linha. No celular só as bolinhas + o nome curto. */
function Trilho({ etapas }: { etapas: EtapaTrilha[] }) {
  return (
    <div className="mt-3 flex items-start">
      {etapas.map((e, i) => {
        const s = ESTILO[e.estado];
        return (
          <div key={e.id} className="flex-1 min-w-0 flex flex-col items-center relative">
            {i > 0 && <div className={`absolute top-3.5 h-0.5 ${etapas[i - 1].estado === 'ok' ? 'bg-emerald-300' : 'bg-zinc-200'}`} style={{ left: '-50%', right: '50%' }} />}
            <div title={`${e.nome}: ${e.resumo}`} className={`relative z-10 w-7 h-7 rounded-full border-2 flex items-center justify-center text-sm ${s.bola}`}>
              <i className={s.icone ?? ICONE_ETAPA[e.id]} />
            </div>
            <p className="text-[10px] font-semibold text-zinc-600 mt-1 text-center leading-tight">{e.nome}</p>
            <p className={`hidden md:block text-[10px] text-center leading-tight mt-0.5 px-1 line-clamp-2 ${s.texto}`}>{e.resumo}</p>
          </div>
        );
      })}
    </div>
  );
}

/** Trilha aberta: uma linha por etapa, com o que aconteceu e o atalho para a tela. */
function Detalhe({ caso, ir }: { caso: CasoTrilha; ir: (a: Atalho) => void }) {
  return (
    <div className="border-t border-zinc-100 bg-zinc-50/60 px-3 md:px-4 py-3">
      {caso.avisos.length > 0 && (
        <div className="mb-3 space-y-1">
          {caso.avisos.map((a) => (
            <p key={a} className={`text-xs flex items-start gap-1 ${a.startsWith('Juros') ? 'text-zinc-600' : 'text-red-600'}`}><i className="ri-error-warning-line mt-px" />{a}</p>
          ))}
        </div>
      )}
      <ol className="relative">
        {caso.etapas.map((e, i) => {
          const s = ESTILO[e.estado];
          return (
            <li key={e.id} className="flex gap-3 pb-3 last:pb-0 relative">
              {i < caso.etapas.length - 1 && <span className={`absolute left-[13px] top-7 bottom-0 w-0.5 ${e.estado === 'ok' ? 'bg-emerald-300' : 'bg-zinc-200'}`} />}
              <div className={`relative z-10 w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center text-sm ${s.bola}`}>
                <i className={ICONE_ETAPA[e.id]} />
              </div>
              <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500">{e.nome} · <span className={`font-semibold ${s.texto}`}>{s.rotulo}</span></p>
                  <p className={`text-sm font-semibold ${e.estado === 'na' || e.estado === 'espera' ? 'text-zinc-400' : 'text-zinc-800'}`}>{e.resumo}</p>
                  {e.detalhe && <p className="text-xs text-zinc-500 break-words">{e.detalhe}</p>}
                </div>
                {e.atalho && e.estado !== 'na' && (
                  <button onClick={() => ir(e.atalho!)} className={`shrink-0 text-xs px-2 py-1 rounded-lg border cursor-pointer whitespace-nowrap ${ruim(e.estado) ? 'bg-amber-500 border-amber-500 text-white hover:bg-amber-600' : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50'}`}>
                    {ruim(e.estado) ? 'Resolver' : 'Abrir'} <i className="ri-arrow-right-up-line" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
