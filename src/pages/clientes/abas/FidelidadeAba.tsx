// Aba Fidelidade de Clientes & Marketing — configura o programa da loja:
// pontos por real gasto, catálogo de recompensas, trilha de níveis por número
// de compras e roleta de prêmios. Cada parte mostra na hora quanto custa para
// a loja, com os pedidos reais (simulação).
//
// Fase 1 (2026-09-27): só configurar e simular. O acúmulo nos pedidos e o
// resgate no caixa/delivery vêm na Fase 2. Regras e contas em
// supabase/functions/_shared/fidelidade.ts; grava pela Edge Function `fidelidade`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import {
  CORES, avisosConfig, chancesRoleta, custoPorPonto, distribuirNiveis, novoId, retornoPercentual,
  type FaixaHistograma, type FidelidadeConfig, type Nivel, type Premio, type Recompensa,
  type TipoPremio, type TipoPresente, type TipoRecompensa,
} from '@/lib/fidelidade';

type Secao = 'resumo' | 'pontos' | 'recompensas' | 'trilha' | 'roleta';

const SECOES: { id: Secao; label: string; icon: string }[] = [
  { id: 'resumo', label: 'Resumo', icon: 'ri-dashboard-line' },
  { id: 'pontos', label: 'Pontos', icon: 'ri-copper-coin-line' },
  { id: 'recompensas', label: 'Recompensas', icon: 'ri-gift-2-line' },
  { id: 'trilha', label: 'Trilha de níveis', icon: 'ri-medal-line' },
  { id: 'roleta', label: 'Roleta', icon: 'ri-donut-chart-line' },
];

const TIPOS_RECOMPENSA: { id: TipoRecompensa; label: string }[] = [
  { id: 'produto', label: 'Produto grátis' },
  { id: 'desconto_valor', label: 'Desconto em R$' },
  { id: 'desconto_percentual', label: 'Desconto em %' },
  { id: 'frete_gratis', label: 'Entrega grátis' },
];

const TIPOS_PREMIO: { id: TipoPremio; label: string }[] = [
  { id: 'nada', label: 'Não foi dessa vez' },
  { id: 'pontos', label: 'Pontos extras' },
  { id: 'recompensa', label: 'Uma recompensa' },
  { id: 'desconto_percentual', label: '% na próxima compra' },
];

const TIPOS_PRESENTE: { id: TipoPresente; label: string }[] = [
  { id: 'nenhum', label: 'Nenhum' },
  { id: 'pontos', label: 'Pontos' },
  { id: 'giro', label: 'Giros na roleta' },
  { id: 'recompensa', label: 'Uma recompensa' },
];

const JANELAS = [
  { dias: 90, label: 'Últimos 90 dias' },
  { dias: 180, label: 'Últimos 6 meses' },
  { dias: 365, label: 'Últimos 12 meses' },
  { dias: 0, label: 'Desde sempre' },
];

interface Produto { id: string; nome: string; preco: number }

interface RespostaGet {
  config?: FidelidadeConfig;
  salvo?: boolean;
  editavel?: boolean;
  updated_at?: string | null;
  janela_dias?: number;
  histograma?: FaixaHistograma[];
  histograma_90d?: FaixaHistograma[];
  produtos?: Produto[];
  error?: string;
  message?: string;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number, casas = 1) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 })}%`;
const inteiro = (v: number) => Math.round(v).toLocaleString('pt-BR');

const INPUT = 'w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-amber-400 disabled:bg-zinc-50 disabled:text-zinc-400';

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-zinc-600 mb-1">{label}</span>
      {children}
      {dica && <span className="block text-[11px] text-zinc-400 mt-1 leading-snug">{dica}</span>}
    </label>
  );
}

function Numero({ value, onChange, min = 0, step = 1, disabled, prefixo, sufixo }: {
  value: number; onChange: (v: number) => void; min?: number; step?: number; disabled?: boolean; prefixo?: string; sufixo?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {prefixo && <span className="text-xs text-zinc-400">{prefixo}</span>}
      <input
        type="number" inputMode="decimal" min={min} step={step} disabled={disabled}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className={INPUT + ' tabular-nums'}
      />
      {sufixo && <span className="text-xs text-zinc-400 whitespace-nowrap">{sufixo}</span>}
    </div>
  );
}

function Chave({ ligado, onChange, disabled, label }: { ligado: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={ligado} aria-label={label} disabled={disabled}
      onClick={() => onChange(!ligado)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${ligado ? 'bg-amber-500' : 'bg-zinc-300'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${ligado ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Cartao({ titulo, desc, acao, children }: { titulo: string; desc?: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-zinc-200 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-zinc-900">{titulo}</h3>
          {desc && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{desc}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, valor, sub, tom = 'zinc' }: { label: string; valor: string; sub?: string; tom?: 'zinc' | 'amber' | 'emerald' | 'rose' }) {
  const cor = { zinc: 'text-zinc-900', amber: 'text-amber-600', emerald: 'text-emerald-600', rose: 'text-rose-600' }[tom];
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${cor}`}>{valor}</div>
      {sub && <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}

// ── Roleta (desenho) ─────────────────────────────────────────────────────────
function RoletaSvg({ premios, rotacao }: { premios: Premio[]; rotacao: number }) {
  const { chances } = chancesRoleta(premios);
  const R = 100;
  let acc = 0;
  const fatias = premios.map((p, i) => {
    const ch = chances[i].chance;
    const ini = acc * 2 * Math.PI;
    acc += ch;
    const fim = acc * 2 * Math.PI;
    const x1 = R + R * Math.sin(ini), y1 = R - R * Math.cos(ini);
    const x2 = R + R * Math.sin(fim), y2 = R - R * Math.cos(fim);
    const grande = fim - ini > Math.PI ? 1 : 0;
    const meio = (ini + fim) / 2;
    const d = ch >= 0.9999
      ? `M ${R} 0 A ${R} ${R} 0 1 1 ${R - 0.01} 0 Z`
      : `M ${R} ${R} L ${x1} ${y1} A ${R} ${R} 0 ${grande} 1 ${x2} ${y2} Z`;
    return { p, d, meio, ch };
  });
  return (
    <div className="relative w-56 h-56 mx-auto">
      <div className="absolute left-1/2 -top-1 -translate-x-1/2 z-10 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[18px] border-l-transparent border-r-transparent border-t-zinc-800" />
      <svg viewBox="-4 -4 208 208" className="w-full h-full" style={{ transform: `rotate(${rotacao}deg)`, transition: 'transform 3.2s cubic-bezier(.15,.85,.25,1)' }}>
        {fatias.map(({ p, d }) => <path key={p.id} d={d} fill={p.cor} stroke="#fff" strokeWidth={2} />)}
        {fatias.map(({ p, meio, ch }) => ch >= 0.05 && (
          <text
            key={`t_${p.id}`}
            x={R + R * 0.62 * Math.sin(meio)} y={R - R * 0.62 * Math.cos(meio)}
            textAnchor="middle" dominantBaseline="middle" fontSize={8} fontWeight={700} fill="#fff"
            transform={`rotate(${(meio * 180) / Math.PI} ${R + R * 0.62 * Math.sin(meio)} ${R - R * 0.62 * Math.cos(meio)})`}
          >
            {p.nome.length > 16 ? p.nome.slice(0, 15) + '…' : p.nome}
          </text>
        ))}
        <circle cx={R} cy={R} r={14} fill="#fff" stroke="#e4e4e7" strokeWidth={2} />
      </svg>
    </div>
  );
}

export default function FidelidadeAba() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [secao, setSecao] = useState<Secao>('resumo');
  const [cfg, setCfg] = useState<FidelidadeConfig | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [editavel, setEditavel] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [hist, setHist] = useState<FaixaHistograma[]>([]);
  const [hist90, setHist90] = useState<FaixaHistograma[]>([]);
  const [janelaHist, setJanelaHist] = useState<number | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [alterado, setAlterado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');
  const [rotacao, setRotacao] = useState(0);
  const [resultadoGiro, setResultadoGiro] = useState<Premio | null>(null);
  const girando = useRef(false);

  const carregar = useCallback((janela?: number, soHistograma = false) => {
    if (!tenantId) return;
    if (!soHistograma) setCarregando(true);
    invokeWithAuth<RespostaGet>('fidelidade', {
      body: { action: 'get', tenant_id: tenantId, ...(janela !== undefined ? { janela_dias: janela } : {}) },
    }).then((res) => {
      setCarregando(false);
      const d = res.data;
      if (res.error || !d || d.error) {
        setErro(res.error?.message || d?.message || d?.error || 'Não consegui carregar o programa.');
        return;
      }
      setErro('');
      setHist(d.histograma ?? []);
      setJanelaHist(d.janela_dias ?? null);
      if (soHistograma) return;
      setCfg(d.config ?? null);
      setSalvo(!!d.salvo);
      setEditavel(!!d.editavel);
      setAtualizadoEm(d.updated_at ?? null);
      setHist90(d.histograma_90d ?? []);
      setProdutos(d.produtos ?? []);
      setAlterado(false);
    });
  }, [tenantId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Trocou a janela da trilha: recalcula quem cai em cada nível (sem salvar).
  useEffect(() => {
    if (!cfg || janelaHist === null || cfg.trilha.janela_dias === janelaHist) return;
    const t = setTimeout(() => carregar(cfg.trilha.janela_dias, true), 300);
    return () => clearTimeout(t);
  }, [cfg, janelaHist, carregar]);

  const mudar = (fn: (c: FidelidadeConfig) => FidelidadeConfig) => {
    setCfg((c) => (c ? fn(structuredClone(c)) : c));
    setAlterado(true);
    setMsg('');
  };

  const salvar = () => {
    if (!tenantId || !cfg) return;
    setSalvando(true);
    invokeWithAuth<{ config?: FidelidadeConfig; error?: string; message?: string }>('fidelidade', {
      body: { action: 'save', tenant_id: tenantId, config: cfg, enabled: false },
    }).then((res) => {
      setSalvando(false);
      const d = res.data;
      if (res.error || !d || d.error) {
        setMsg(res.error?.message || d?.message || d?.error || 'Erro ao salvar.');
        return;
      }
      // Mostra o que o servidor gravou (valores fora de faixa são ajustados lá).
      if (d.config) setCfg(d.config);
      setAlterado(false);
      setSalvo(true);
      setAtualizadoEm(new Date().toISOString());
      setMsg('Salvo.');
    });
  };

  // ── Números da simulação ────────────────────────────────────────────────────
  const sim = useMemo(() => {
    if (!cfg) return null;
    const clientes90 = hist90.reduce((s, f) => s + f.clientes, 0);
    const pedidos90 = hist90.reduce((s, f) => s + f.compras * f.clientes, 0);
    const gasto90 = hist90.reduce((s, f) => s + f.gasto, 0);
    const ticket = pedidos90 > 0 ? gasto90 / pedidos90 : 0;
    const { porNivel, fora } = distribuirNiveis(hist, cfg.trilha.niveis);
    const naTrilha = [...porNivel.values()].reduce((s, v) => s + v.clientes, 0);
    // Multiplicador médio ponderado pelo gasto de cada nível.
    let gastoTrilha = 0, gastoPonderado = 0;
    for (const n of cfg.trilha.niveis) {
      const v = porNivel.get(n.id);
      if (!v) continue;
      gastoTrilha += v.gasto;
      gastoPonderado += v.gasto * (cfg.trilha.ativo ? n.multiplicador : 1);
    }
    const multMedio = gastoTrilha > 0 ? gastoPonderado / gastoTrilha : 1;
    const retorno = retornoPercentual(cfg, multMedio);
    const { chances, custoGiro } = chancesRoleta(cfg.roleta.premios);
    const girosMes = cfg.roleta.ativo && cfg.roleta.a_cada_compras > 0 ? pedidos90 / 3 / cfg.roleta.a_cada_compras : 0;
    const custoPontosMes = (gasto90 / 3) * (retorno / 100);
    return {
      clientes90, pedidos90, gasto90, ticket, porNivel, fora, naTrilha, multMedio, retorno,
      chances, custoGiro, girosMes, custoRoletaMes: girosMes * custoGiro, custoPontosMes,
      custoPonto: custoPorPonto(cfg.recompensas),
    };
  }, [cfg, hist, hist90]);

  const avisos = useMemo(() => (cfg ? avisosConfig(cfg) : []), [cfg]);

  const girarTeste = () => {
    if (!cfg || girando.current || !sim) return;
    const premios = cfg.roleta.premios;
    const soma = premios.reduce((s, p) => s + Math.max(0, p.peso), 0);
    if (premios.length === 0 || soma <= 0) return;
    let r = Math.random() * soma, idx = 0, acc = 0;
    for (let i = 0; i < premios.length; i++) { r -= Math.max(0, premios[i].peso); if (r <= 0) { idx = i; break; } }
    for (let i = 0; i < idx; i++) acc += sim.chances[i].chance;
    const meio = (acc + sim.chances[idx].chance / 2) * 360;
    girando.current = true;
    setResultadoGiro(null);
    setRotacao((rot) => rot - (rot % 360) + 360 * 5 + (360 - meio));
    setTimeout(() => { girando.current = false; setResultadoGiro(premios[idx]); }, 3300);
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (erro || !cfg || !sim) {
    return (
      <div className="p-6">
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-4">
          {erro || 'Não consegui carregar o programa.'}
          <button onClick={() => carregar()} className="ml-3 underline cursor-pointer">Tentar de novo</button>
        </div>
      </div>
    );
  }

  const ro = !editavel;
  const nomeRecompensa = (id: string | null) => cfg.recompensas.find((r) => r.id === id)?.nome ?? '—';
  const niveisOrdenados = [...cfg.trilha.niveis].sort((a, b) => a.min_compras - b.min_compras);
  const maxNivel = Math.max(1, ...niveisOrdenados.map((n) => sim.porNivel.get(n.id)?.clientes ?? 0));

  const setRecompensa = (id: string, patch: Partial<Recompensa>) =>
    mudar((c) => ({ ...c, recompensas: c.recompensas.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const setNivel = (id: string, patch: Partial<Nivel>) =>
    mudar((c) => ({ ...c, trilha: { ...c.trilha, niveis: c.trilha.niveis.map((n) => (n.id === id ? { ...n, ...patch } : n)) } }));
  const setPremio = (id: string, patch: Partial<Premio>) =>
    mudar((c) => ({ ...c, roleta: { ...c.roleta, premios: c.roleta.premios.map((p) => (p.id === id ? { ...p, ...patch } : p)) } }));

  return (
    <div className="p-4 md:p-6 pb-28 max-w-6xl mx-auto space-y-4">
      {/* Cabeçalho do programa */}
      <div className="bg-gradient-to-br from-amber-50 to-rose-50 border border-amber-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0">
          <Campo label="Nome do programa (o cliente vê)">
            <input
              value={cfg.nome_programa} disabled={ro} maxLength={60}
              onChange={(e) => mudar((c) => ({ ...c, nome_programa: e.target.value }))}
              className={INPUT + ' font-semibold'}
            />
          </Campo>
        </div>
        <div className="md:w-[26rem] text-xs text-amber-800 bg-white/70 border border-amber-200 rounded-lg p-2.5 leading-snug">
          <i className="ri-information-line mr-1" />
          <b>Fase 1 — configurar e simular.</b> Os números abaixo usam os pedidos reais da loja, mas ainda
          nada é creditado nem descontado. O acúmulo nos pedidos e o resgate no caixa/delivery vêm na próxima etapa.
        </div>
      </div>

      {/* Navegação das seções */}
      <nav className="flex gap-1 overflow-x-auto bg-white border border-zinc-200 rounded-xl p-1" role="tablist">
        {SECOES.map((s) => (
          <button
            key={s.id} role="tab" aria-selected={secao === s.id} onClick={() => setSecao(s.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              secao === s.id ? 'bg-amber-500 text-white' : 'text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            <i className={s.icon} /> {s.label}
          </button>
        ))}
      </nav>

      {/* ── RESUMO ─────────────────────────────────────────────────────────── */}
      {secao === 'resumo' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Clientes identificados" valor={inteiro(sim.clientes90)} sub={`compraram nos últimos 90 dias · ${inteiro(sim.pedidos90)} pedidos`} />
            <Kpi label="Ticket médio" valor={brl(sim.ticket)} sub={`${brl(sim.gasto90 / 3)}/mês desses clientes`} />
            <Kpi
              label="Devolução em pontos" tom={sim.retorno > 8 ? 'rose' : sim.retorno > 0 ? 'amber' : 'zinc'}
              valor={pct(sim.retorno)} sub={cfg.pontos.ativo ? `≈ ${brl(sim.custoPontosMes)}/mês se tudo for resgatado` : 'pontos desligados'}
            />
            <Kpi
              label="Roleta" tom={cfg.roleta.ativo ? 'amber' : 'zinc'}
              valor={cfg.roleta.ativo ? `${brl(sim.custoGiro)}/giro` : 'Desligada'}
              sub={cfg.roleta.ativo && sim.girosMes > 0 ? `≈ ${inteiro(sim.girosMes)} giros/mês · ${brl(sim.custoRoletaMes)}` : 'custo médio de cada giro'}
            />
          </div>

          {avisos.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
              {avisos.map((a) => (
                <div key={a} className="text-xs text-amber-800 flex gap-1.5"><i className="ri-error-warning-line mt-px" /> {a}</div>
              ))}
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <Cartao titulo="Como a base ficaria na trilha" desc={`Contando as compras ${JANELAS.find((j) => j.dias === cfg.trilha.janela_dias)?.label.toLowerCase() ?? `dos últimos ${cfg.trilha.janela_dias} dias`}.`}>
              {cfg.trilha.niveis.length === 0 ? (
                <p className="text-sm text-zinc-400">Nenhum nível criado.</p>
              ) : (
                <div className="space-y-2">
                  {niveisOrdenados.map((n) => {
                    const v = sim.porNivel.get(n.id) ?? { clientes: 0, gasto: 0 };
                    return (
                      <div key={n.id}>
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="font-semibold text-zinc-700">{n.emoji} {n.nome} <span className="font-normal text-zinc-400">· {n.min_compras}+ compras</span></span>
                          <span className="tabular-nums text-zinc-600">{inteiro(v.clientes)} clientes · {brl(v.gasto)}</span>
                        </div>
                        <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(v.clientes / maxNivel) * 100}%`, background: n.cor }} />
                        </div>
                      </div>
                    );
                  })}
                  {sim.fora > 0 && <p className="text-[11px] text-zinc-400">{inteiro(sim.fora)} clientes ainda não chegaram ao primeiro nível.</p>}
                </div>
              )}
            </Cartao>

            <Cartao titulo="Ideias para o programa render" desc="O que costuma funcionar em restaurante e delivery.">
              <ul className="text-xs text-zinc-600 space-y-2 leading-snug">
                <li><b>Primeira troca rápida:</b> a recompensa mais barata deve sair em 3–4 pedidos. Quem troca uma vez volta muito mais.</li>
                <li><b>Recompensa de produto &gt; desconto:</b> um refri ou sobremesa vale R$ 8–12 para o cliente e custa R$ 2–4 para a loja.</li>
                <li><b>Nível alto é reconhecimento:</b> multiplicador de pontos, novidade antes de todo mundo e brinde na subida — não desconto fixo.</li>
                <li><b>Janela de 12 meses na trilha:</b> quem para de comprar desce de nível — dá motivo para voltar.</li>
                <li><b>Roleta como evento:</b> giro a cada N pedidos, no aniversário e ao subir de nível. Mantenha o custo por giro abaixo de 5% do ticket.</li>
                <li><b>Pontos que expiram (6 meses):</b> evitam passivo acumulado e criam urgência — avise 15 dias antes pelo WhatsApp.</li>
                <li><b>Mesa e balcão também contam:</b> pedir o celular no caixa é o que identifica o cliente fora do delivery.</li>
              </ul>
            </Cartao>
          </div>
        </div>
      )}

      {/* ── PONTOS ─────────────────────────────────────────────────────────── */}
      {secao === 'pontos' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Cartao
              titulo="Acúmulo de pontos"
              desc="O cliente ganha pontos em cada pedido pago e troca por recompensas."
              acao={<Chave label="Pontos ligados" ligado={cfg.pontos.ativo} disabled={ro} onChange={(v) => mudar((c) => ({ ...c, pontos: { ...c.pontos, ativo: v } }))} />}
            >
              <div className="grid sm:grid-cols-2 gap-3">
                <Campo label="Pontos por R$ 1 gasto" dica="1 = cada real vira 1 ponto. O multiplicador do nível entra por cima.">
                  <Numero value={cfg.pontos.pontos_por_real} step={0.5} disabled={ro} onChange={(v) => mudar((c) => ({ ...c, pontos: { ...c.pontos, pontos_por_real: v } }))} sufixo="pts" />
                </Campo>
                <Campo label="Pedido mínimo para pontuar" dica="0 = qualquer pedido pontua.">
                  <Numero value={cfg.pontos.pedido_minimo} disabled={ro} prefixo="R$" onChange={(v) => mudar((c) => ({ ...c, pontos: { ...c.pontos, pedido_minimo: v } }))} />
                </Campo>
                <Campo label="Pontos vencem em" dica="0 = nunca vencem (vira passivo acumulado).">
                  <Numero value={cfg.pontos.validade_meses} disabled={ro} sufixo="meses" onChange={(v) => mudar((c) => ({ ...c, pontos: { ...c.pontos, validade_meses: v } }))} />
                </Campo>
                <div />
                <Campo label="Bônus ao se cadastrar">
                  <Numero value={cfg.pontos.bonus_cadastro} disabled={ro} sufixo="pts" onChange={(v) => mudar((c) => ({ ...c, pontos: { ...c.pontos, bonus_cadastro: v } }))} />
                </Campo>
                <Campo label="Bônus de aniversário">
                  <Numero value={cfg.pontos.bonus_aniversario} disabled={ro} sufixo="pts" onChange={(v) => mudar((c) => ({ ...c, pontos: { ...c.pontos, bonus_aniversario: v } }))} />
                </Campo>
              </div>
              <div className="mt-4">
                <span className="block text-xs font-semibold text-zinc-600 mb-1.5">Onde o cliente pontua</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([['salao', 'Mesa / salão'], ['balcao', 'Balcão / caixa'], ['delivery', 'Delivery próprio'], ['totem', 'Totem / QR']] as const).map(([k, label]) => (
                    <label key={k} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${cfg.pontos.canais[k] ? 'border-amber-300 bg-amber-50 text-zinc-800' : 'border-zinc-200 text-zinc-400'}`}>
                      <input
                        type="checkbox" disabled={ro} checked={cfg.pontos.canais[k]} className="accent-amber-500"
                        onChange={(e) => mudar((c) => ({ ...c, pontos: { ...c.pontos, canais: { ...c.pontos.canais, [k]: e.target.checked } } }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-400 mt-1.5">iFood fica de fora: o cliente é do iFood, não da loja.</p>
              </div>
            </Cartao>
          </div>
          <Cartao titulo="Na prática" desc="Com o ticket médio dos últimos 90 dias.">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-zinc-500">Pedido médio</span><b className="tabular-nums">{brl(sim.ticket)}</b></div>
              <div className="flex justify-between"><span className="text-zinc-500">Pontos por pedido</span><b className="tabular-nums">{inteiro(sim.ticket * cfg.pontos.pontos_por_real)} pts</b></div>
              {cfg.recompensas.filter((r) => r.ativo).sort((a, b) => a.custo_pontos - b.custo_pontos).slice(0, 4).map((r) => {
                const porPedido = sim.ticket * cfg.pontos.pontos_por_real;
                const pedidos = porPedido > 0 ? Math.ceil((r.custo_pontos - cfg.pontos.bonus_cadastro) / porPedido) : 0;
                return (
                  <div key={r.id} className="flex justify-between gap-2 text-xs">
                    <span className="text-zinc-500 truncate">{r.nome}</span>
                    <span className="tabular-nums whitespace-nowrap">{porPedido > 0 ? `${Math.max(1, pedidos)} pedido${pedidos > 1 ? 's' : ''}` : '—'}</span>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-zinc-100 flex justify-between">
                <span className="text-zinc-500">Devolução (custo real)</span>
                <b className={`tabular-nums ${sim.retorno > 8 ? 'text-rose-600' : 'text-emerald-600'}`}>{pct(sim.retorno)}</b>
              </div>
              <p className="text-[11px] text-zinc-400 leading-snug">
                Pior caso: todo ponto trocado pela recompensa que mais custa por ponto ({brl(sim.custoPonto * 100)} a cada 100 pts), já com o multiplicador médio da trilha ({sim.multMedio.toFixed(2)}×).
                Em food service, 2–6% é o usual.
              </p>
            </div>
          </Cartao>
        </div>
      )}

      {/* ── RECOMPENSAS ────────────────────────────────────────────────────── */}
      {secao === 'recompensas' && (
        <Cartao
          titulo="Catálogo de recompensas"
          desc="O que o cliente pode trocar com os pontos. Produto grátis costuma valer mais para o cliente e custar menos para a loja."
          acao={!ro && (
            <button
              onClick={() => mudar((c) => ({ ...c, recompensas: [...c.recompensas, { id: novoId('rw'), nome: 'Nova recompensa', tipo: 'produto', valor: 0, produto_id: null, custo_pontos: 100, custo_loja: 0, nivel_minimo: null, ativo: true }] }))}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <i className="ri-add-line" /> Recompensa
            </button>
          )}
        >
          {cfg.recompensas.length === 0 && <p className="text-sm text-zinc-400 py-6 text-center">Nenhuma recompensa. Adicione a primeira.</p>}
          <div className="space-y-3">
            {cfg.recompensas.map((r) => {
              const gastoEquivalente = cfg.pontos.pontos_por_real > 0 ? r.custo_pontos / cfg.pontos.pontos_por_real : 0;
              const devolve = gastoEquivalente > 0 ? (r.custo_loja / gastoEquivalente) * 100 : 0;
              const produto = produtos.find((p) => p.id === r.produto_id);
              return (
                <div key={r.id} className={`border rounded-xl p-3 ${r.ativo ? 'border-zinc-200' : 'border-dashed border-zinc-200 opacity-60'}`}>
                  <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
                    <div className="col-span-2 md:col-span-3">
                      <Campo label="Nome"><input value={r.nome} disabled={ro} maxLength={80} onChange={(e) => setRecompensa(r.id, { nome: e.target.value })} className={INPUT} /></Campo>
                    </div>
                    <div className="md:col-span-2">
                      <Campo label="Tipo">
                        <select value={r.tipo} disabled={ro} onChange={(e) => setRecompensa(r.id, { tipo: e.target.value as TipoRecompensa })} className={INPUT}>
                          {TIPOS_RECOMPENSA.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </Campo>
                    </div>
                    <div className="md:col-span-3">
                      {r.tipo === 'produto' ? (
                        <Campo label="Item do cardápio">
                          <select value={r.produto_id ?? ''} disabled={ro} onChange={(e) => setRecompensa(r.id, { produto_id: e.target.value || null })} className={INPUT}>
                            <option value="">Escolher…</option>
                            {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {brl(p.preco)}</option>)}
                          </select>
                        </Campo>
                      ) : r.tipo === 'frete_gratis' ? (
                        <Campo label="Valor"><div className="text-xs text-zinc-400 py-2">Taxa de entrega do pedido</div></Campo>
                      ) : (
                        <Campo label={r.tipo === 'desconto_valor' ? 'Desconto (R$)' : 'Desconto (%)'}>
                          <Numero value={r.valor} disabled={ro} onChange={(v) => setRecompensa(r.id, { valor: v, ...(r.tipo === 'desconto_valor' ? { custo_loja: v } : {}) })} />
                        </Campo>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <Campo label="Custa (pontos)"><Numero value={r.custo_pontos} min={1} disabled={ro} onChange={(v) => setRecompensa(r.id, { custo_pontos: v })} /></Campo>
                    </div>
                    <div className="md:col-span-2">
                      <Campo label="Custo p/ loja"><Numero value={r.custo_loja} step={0.5} disabled={ro} prefixo="R$" onChange={(v) => setRecompensa(r.id, { custo_loja: v })} /></Campo>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2.5">
                    <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                      Só a partir do nível
                      <select value={r.nivel_minimo ?? ''} disabled={ro} onChange={(e) => setRecompensa(r.id, { nivel_minimo: e.target.value || null })} className="px-2 py-1 text-xs border border-zinc-200 rounded-md bg-white">
                        <option value="">Qualquer cliente</option>
                        {niveisOrdenados.map((n) => <option key={n.id} value={n.id}>{n.emoji} {n.nome}</option>)}
                      </select>
                    </label>
                    <span className="text-xs text-zinc-500">
                      = gastar <b className="tabular-nums">{brl(gastoEquivalente)}</b>
                      {produto && <> · vale <b className="tabular-nums">{brl(produto.preco)}</b> no cardápio</>}
                      {' '}· devolve <b className={`tabular-nums ${devolve > 8 ? 'text-rose-600' : 'text-emerald-600'}`}>{pct(devolve)}</b> em custo
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                      <Chave label="Recompensa ativa" ligado={r.ativo} disabled={ro} onChange={(v) => setRecompensa(r.id, { ativo: v })} />
                      {!ro && (
                        <button
                          onClick={() => mudar((c) => ({ ...c, recompensas: c.recompensas.filter((x) => x.id !== r.id) }))}
                          className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer" aria-label="Remover recompensa"
                        ><i className="ri-delete-bin-line" /></button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Cartao>
      )}

      {/* ── TRILHA ─────────────────────────────────────────────────────────── */}
      {secao === 'trilha' && (
        <div className="space-y-4">
          <Cartao
            titulo="Trilha do cliente"
            desc="O nível sobe conforme o número de compras. Cada nível multiplica os pontos e pode dar um presente na subida."
            acao={<Chave label="Trilha ligada" ligado={cfg.trilha.ativo} disabled={ro} onChange={(v) => mudar((c) => ({ ...c, trilha: { ...c.trilha, ativo: v } }))} />}
          >
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div className="w-56">
                <Campo label="Contar as compras" dica="Janela móvel: quem para de comprar desce de nível.">
                  <select value={cfg.trilha.janela_dias} disabled={ro} onChange={(e) => mudar((c) => ({ ...c, trilha: { ...c.trilha, janela_dias: Number(e.target.value) } }))} className={INPUT}>
                    {JANELAS.map((j) => <option key={j.dias} value={j.dias}>{j.label}</option>)}
                    {!JANELAS.some((j) => j.dias === cfg.trilha.janela_dias) && <option value={cfg.trilha.janela_dias}>Últimos {cfg.trilha.janela_dias} dias</option>}
                  </select>
                </Campo>
              </div>
              {!ro && cfg.trilha.niveis.length < 10 && (
                <button
                  onClick={() => mudar((c) => {
                    const ult = Math.max(0, ...c.trilha.niveis.map((n) => n.min_compras));
                    return { ...c, trilha: { ...c.trilha, niveis: [...c.trilha.niveis, { id: novoId('lv'), nome: 'Novo nível', emoji: '⭐', cor: CORES[c.trilha.niveis.length % CORES.length], min_compras: ult + 5, multiplicador: 1, beneficios: '', presente_tipo: 'nenhum', presente_valor: 0, presente_recompensa_id: null }] } };
                  })}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg cursor-pointer ml-auto"
                >
                  <i className="ri-add-line" /> Nível
                </button>
              )}
            </div>

            {/* A trilha desenhada */}
            {niveisOrdenados.length > 0 && (
              <div className="overflow-x-auto pb-2 mb-4">
                <div className="flex items-stretch min-w-max">
                  {niveisOrdenados.map((n, i) => {
                    const v = sim.porNivel.get(n.id) ?? { clientes: 0, gasto: 0 };
                    return (
                      <div key={n.id} className="flex items-center">
                        <div className="w-40 rounded-xl border-2 p-3 text-center bg-white" style={{ borderColor: n.cor }}>
                          <div className="text-2xl leading-none">{n.emoji}</div>
                          <div className="text-sm font-bold mt-1" style={{ color: n.cor }}>{n.nome}</div>
                          <div className="text-[11px] text-zinc-500">{n.min_compras}+ compras · {n.multiplicador}× pts</div>
                          <div className="text-xs font-semibold text-zinc-800 mt-1.5 tabular-nums">{inteiro(v.clientes)} clientes</div>
                        </div>
                        {i < niveisOrdenados.length - 1 && <i className="ri-arrow-right-line text-zinc-300 text-xl mx-1" />}
                      </div>
                    );
                  })}
                </div>
                {janelaHist !== cfg.trilha.janela_dias && <p className="text-[11px] text-zinc-400 mt-1">Recalculando com a nova janela…</p>}
              </div>
            )}

            <div className="space-y-3">
              {niveisOrdenados.map((n) => (
                <div key={n.id} className="border border-zinc-200 rounded-xl p-3" style={{ borderLeft: `4px solid ${n.cor}` }}>
                  <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
                    <div className="md:col-span-1">
                      <Campo label="Ícone"><input value={n.emoji} disabled={ro} maxLength={8} onChange={(e) => setNivel(n.id, { emoji: e.target.value })} className={INPUT + ' text-center'} /></Campo>
                    </div>
                    <div className="md:col-span-3">
                      <Campo label="Nome"><input value={n.nome} disabled={ro} maxLength={40} onChange={(e) => setNivel(n.id, { nome: e.target.value })} className={INPUT} /></Campo>
                    </div>
                    <div className="md:col-span-1">
                      <Campo label="Cor"><input type="color" value={n.cor} disabled={ro} onChange={(e) => setNivel(n.id, { cor: e.target.value })} className="w-full h-[34px] border border-zinc-200 rounded-lg cursor-pointer" /></Campo>
                    </div>
                    <div className="md:col-span-2">
                      <Campo label="A partir de"><Numero value={n.min_compras} disabled={ro} sufixo="compras" onChange={(v) => setNivel(n.id, { min_compras: v })} /></Campo>
                    </div>
                    <div className="md:col-span-2">
                      <Campo label="Multiplica pontos"><Numero value={n.multiplicador} min={1} step={0.1} disabled={ro} sufixo="×" onChange={(v) => setNivel(n.id, { multiplicador: v })} /></Campo>
                    </div>
                    <div className="col-span-2 md:col-span-3 flex items-end gap-2">
                      <div className="flex-1">
                        <Campo label="Presente ao subir">
                          <select value={n.presente_tipo} disabled={ro} onChange={(e) => setNivel(n.id, { presente_tipo: e.target.value as TipoPresente })} className={INPUT}>
                            {TIPOS_PRESENTE.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                        </Campo>
                      </div>
                      {!ro && (
                        <button
                          onClick={() => mudar((c) => ({ ...c, trilha: { ...c.trilha, niveis: c.trilha.niveis.filter((x) => x.id !== n.id) } }))}
                          className="w-8 h-[34px] flex items-center justify-center text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer" aria-label="Remover nível"
                        ><i className="ri-delete-bin-line" /></button>
                      )}
                    </div>
                  </div>
                  <div className="grid md:grid-cols-12 gap-2 mt-2 items-end">
                    <div className="md:col-span-8">
                      <Campo label="Benefícios (texto que o cliente vê)">
                        <input value={n.beneficios} disabled={ro} maxLength={200} placeholder="Ex.: pontos em dobro e sobremesa no aniversário" onChange={(e) => setNivel(n.id, { beneficios: e.target.value })} className={INPUT} />
                      </Campo>
                    </div>
                    <div className="md:col-span-4">
                      {n.presente_tipo === 'recompensa' ? (
                        <Campo label="Qual recompensa">
                          <select value={n.presente_recompensa_id ?? ''} disabled={ro} onChange={(e) => setNivel(n.id, { presente_recompensa_id: e.target.value || null })} className={INPUT}>
                            <option value="">Escolher…</option>
                            {cfg.recompensas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                          </select>
                        </Campo>
                      ) : n.presente_tipo === 'pontos' || n.presente_tipo === 'giro' ? (
                        <Campo label={n.presente_tipo === 'pontos' ? 'Quantos pontos' : 'Quantos giros'}>
                          <Numero value={n.presente_valor} disabled={ro} onChange={(v) => setNivel(n.id, { presente_valor: v })} />
                        </Campo>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Cartao>
        </div>
      )}

      {/* ── ROLETA ─────────────────────────────────────────────────────────── */}
      {secao === 'roleta' && (
        <div className="grid lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 space-y-4">
            <Cartao
              titulo="Quando o cliente ganha um giro"
              acao={<Chave label="Roleta ligada" ligado={cfg.roleta.ativo} disabled={ro} onChange={(v) => mudar((c) => ({ ...c, roleta: { ...c.roleta, ativo: v } }))} />}
            >
              <div className="grid sm:grid-cols-2 gap-3">
                <Campo label="A cada N compras" dica="0 = não dá giro por quantidade.">
                  <Numero value={cfg.roleta.a_cada_compras} disabled={ro} sufixo="compras" onChange={(v) => mudar((c) => ({ ...c, roleta: { ...c.roleta, a_cada_compras: v } }))} />
                </Campo>
                <Campo label="Pedido acima de" dica="0 = desligado. Bom para puxar o ticket médio.">
                  <Numero value={cfg.roleta.pedido_acima_de} disabled={ro} prefixo="R$" onChange={(v) => mudar((c) => ({ ...c, roleta: { ...c.roleta, pedido_acima_de: v } }))} />
                </Campo>
                <Campo label="Giro vale por">
                  <Numero value={cfg.roleta.giro_validade_dias} min={1} disabled={ro} sufixo="dias" onChange={(v) => mudar((c) => ({ ...c, roleta: { ...c.roleta, giro_validade_dias: v } }))} />
                </Campo>
                <div className="flex flex-col justify-end gap-2">
                  <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" className="accent-amber-500" disabled={ro} checked={cfg.roleta.ao_subir_nivel} onChange={(e) => mudar((c) => ({ ...c, roleta: { ...c.roleta, ao_subir_nivel: e.target.checked } }))} /> Ao subir de nível</label>
                  <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" className="accent-amber-500" disabled={ro} checked={cfg.roleta.aniversario} onChange={(e) => mudar((c) => ({ ...c, roleta: { ...c.roleta, aniversario: e.target.checked } }))} /> No aniversário</label>
                </div>
              </div>
            </Cartao>

            <Cartao
              titulo="Prêmios"
              desc="A chance de cada um é o peso dele sobre a soma dos pesos. O limite por dia segura prêmio caro."
              acao={!ro && cfg.roleta.premios.length < 12 && (
                <button
                  onClick={() => mudar((c) => ({ ...c, roleta: { ...c.roleta, premios: [...c.roleta.premios, { id: novoId('pz'), nome: 'Novo prêmio', tipo: 'pontos', valor: 10, recompensa_id: null, peso: 10, custo_loja: 0, limite_dia: 0, cor: CORES[c.roleta.premios.length % CORES.length] }] } }))}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg cursor-pointer whitespace-nowrap"
                ><i className="ri-add-line" /> Prêmio</button>
              )}
            >
              <div className="space-y-2">
                {cfg.roleta.premios.map((p, i) => (
                  <div key={p.id} className="border border-zinc-200 rounded-xl p-2.5" style={{ borderLeft: `4px solid ${p.cor}` }}>
                    <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
                      <div className="col-span-2 md:col-span-4">
                        <Campo label="Nome"><input value={p.nome} disabled={ro} maxLength={40} onChange={(e) => setPremio(p.id, { nome: e.target.value })} className={INPUT} /></Campo>
                      </div>
                      <div className="md:col-span-3">
                        <Campo label="Tipo">
                          <select
                            value={p.tipo} disabled={ro} className={INPUT}
                            onChange={(e) => setPremio(p.id, { tipo: e.target.value as TipoPremio, ...(e.target.value === 'nada' ? { custo_loja: 0, valor: 0 } : {}) })}
                          >
                            {TIPOS_PREMIO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                        </Campo>
                      </div>
                      <div className="md:col-span-3">
                        {p.tipo === 'recompensa' ? (
                          <Campo label="Recompensa">
                            <select
                              value={p.recompensa_id ?? ''} disabled={ro} className={INPUT}
                              onChange={(e) => {
                                const rw = cfg.recompensas.find((r) => r.id === e.target.value);
                                setPremio(p.id, { recompensa_id: e.target.value || null, ...(rw ? { custo_loja: rw.custo_loja } : {}) });
                              }}
                            >
                              <option value="">Escolher…</option>
                              {cfg.recompensas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                            </select>
                          </Campo>
                        ) : p.tipo === 'pontos' || p.tipo === 'desconto_percentual' ? (
                          <Campo label={p.tipo === 'pontos' ? 'Pontos' : 'Desconto (%)'}>
                            <Numero value={p.valor} disabled={ro} onChange={(v) => setPremio(p.id, { valor: v })} />
                          </Campo>
                        ) : <div />}
                      </div>
                      <div className="md:col-span-2">
                        <Campo label="Peso"><Numero value={p.peso} disabled={ro} onChange={(v) => setPremio(p.id, { peso: v })} /></Campo>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2">
                      <span className="text-xs font-bold tabular-nums" style={{ color: p.cor }}>{pct((sim.chances[i]?.chance ?? 0) * 100)} de chance</span>
                      <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                        Custo p/ loja
                        <input type="number" min={0} step={0.5} disabled={ro || p.tipo === 'nada'} value={p.custo_loja} onChange={(e) => setPremio(p.id, { custo_loja: Number(e.target.value) || 0 })} className="w-20 px-2 py-1 text-xs border border-zinc-200 rounded-md tabular-nums" />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                        Máx. por dia
                        <input type="number" min={0} disabled={ro} value={p.limite_dia} onChange={(e) => setPremio(p.id, { limite_dia: Number(e.target.value) || 0 })} className="w-16 px-2 py-1 text-xs border border-zinc-200 rounded-md tabular-nums" />
                        <span className="text-zinc-400">(0 = livre)</span>
                      </label>
                      <input type="color" aria-label="Cor da fatia" value={p.cor} disabled={ro} onChange={(e) => setPremio(p.id, { cor: e.target.value })} className="w-7 h-7 border border-zinc-200 rounded cursor-pointer" />
                      {!ro && (
                        <button
                          onClick={() => mudar((c) => ({ ...c, roleta: { ...c.roleta, premios: c.roleta.premios.filter((x) => x.id !== p.id) } }))}
                          className="ml-auto w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer" aria-label="Remover prêmio"
                        ><i className="ri-delete-bin-line" /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Cartao>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Cartao titulo="Prévia da roleta" desc="O giro de teste usa as chances configuradas.">
              {cfg.roleta.premios.length > 0 ? <RoletaSvg premios={cfg.roleta.premios} rotacao={rotacao} /> : <p className="text-sm text-zinc-400 text-center py-10">Sem prêmios.</p>}
              <div className="text-center mt-3 min-h-[3.5rem]">
                <button onClick={girarTeste} disabled={cfg.roleta.premios.length === 0} className="px-4 py-2 text-sm font-bold text-white bg-zinc-900 hover:bg-zinc-700 rounded-lg cursor-pointer disabled:opacity-40">
                  <i className="ri-refresh-line mr-1" /> Girar de teste
                </button>
                {resultadoGiro && <p className="text-sm mt-2">Saiu: <b style={{ color: resultadoGiro.cor }}>{resultadoGiro.nome}</b></p>}
              </div>
            </Cartao>
            <Cartao titulo="Quanto custa">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-zinc-500">Custo médio por giro</span><b className="tabular-nums">{brl(sim.custoGiro)}</b></div>
                <div className="flex justify-between"><span className="text-zinc-500">% do ticket médio</span><b className={`tabular-nums ${sim.ticket > 0 && sim.custoGiro / sim.ticket > 0.05 ? 'text-rose-600' : 'text-emerald-600'}`}>{sim.ticket > 0 ? pct((sim.custoGiro / sim.ticket) * 100) : '—'}</b></div>
                <div className="flex justify-between"><span className="text-zinc-500">A cada 100 giros</span><b className="tabular-nums">{brl(sim.custoGiro * 100)}</b></div>
                {cfg.roleta.a_cada_compras > 0 && (
                  <div className="flex justify-between"><span className="text-zinc-500">Giros/mês (só pela regra de N compras)</span><b className="tabular-nums">≈ {inteiro(sim.pedidos90 / 3 / cfg.roleta.a_cada_compras)}</b></div>
                )}
                <p className="text-[11px] text-zinc-400 leading-snug pt-1">
                  Pontos da roleta não entram aqui: eles viram custo quando forem trocados por recompensa.
                  {cfg.roleta.premios.filter((p) => p.tipo === 'recompensa' && p.recompensa_id).length > 0 && <> Prêmios de recompensa: {cfg.roleta.premios.filter((p) => p.tipo === 'recompensa').map((p) => nomeRecompensa(p.recompensa_id)).join(', ')}.</>}
                </p>
              </div>
            </Cartao>
          </div>
        </div>
      )}

      {/* Barra de salvar */}
      {editavel ? (
        <div className="fixed bottom-0 inset-x-0 md:left-auto md:right-6 md:bottom-4 md:inset-x-auto z-30">
          <div className="bg-white border-t md:border md:rounded-xl border-zinc-200 shadow-lg px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-zinc-500 flex-1 md:flex-none">
              {msg || (alterado ? 'Alterações não salvas' : salvo && atualizadoEm ? `Salvo em ${new Date(atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Padrão sugerido — ainda não salvo')}
            </span>
            {alterado && (
              <button onClick={() => carregar()} disabled={salvando} className="px-3 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer">Descartar</button>
            )}
            <button
              onClick={salvar} disabled={salvando || (!alterado && salvo)}
              className="px-4 py-2 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-400 text-center">Só leitura: quem altera o programa é admin, gerente ou quem tem a permissão de Promoções.</p>
      )}
    </div>
  );
}
