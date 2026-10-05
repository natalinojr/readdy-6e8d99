import { useState } from 'react';
import Folha from '@/pages/estoque/components/inicio/Folha';
import { btn, brl, Nota } from '@/pages/estoque/components/ui/EstoqueUi';
import type { SessionInfo } from '@/hooks/useSessions';
import { MESES, formatarDataExibicao, somarDias } from '../utils';

// "Quais pedidos ver?" — o botão de período do topo abre esta folha (protótipo, tela "Período e turno").
// Reúne o que antes eram dois botões sem nome (Calendário | Sessão) e o menu de 5 abas
// (Rápido, Dia, Período, Mês, Ano): nada foi tirado, só reorganizado.

export type PresetPeriodo = 'hoje' | 'ontem' | '7dias' | '30dias' | 'mes' | 'ano' | 'todos';
export type EscolhaPeriodo =
  | { modo: 'preset'; preset: PresetPeriodo }
  | { modo: 'dia'; dia: string }
  | { modo: 'periodo'; inicio: string; fim: string }
  | { modo: 'mes'; mes: number /* 0-11 */; ano: number }
  | { modo: 'ano'; ano: number };

const ROTULO_PRESET: Record<PresetPeriodo, string> = {
  hoje: 'Hoje', ontem: 'Ontem', '7dias': 'Últimos 7 dias', '30dias': 'Últimos 30 dias',
  mes: 'Este mês', ano: 'Este ano', todos: 'Todos os dias',
};

/** Texto do botão de período: "Hoje", "03/10/2026", "01/10 → 04/10", "Setembro 2026", "2025"… */
export function rotuloEscolha(e: EscolhaPeriodo, hoje: string): string {
  switch (e.modo) {
    case 'preset': return ROTULO_PRESET[e.preset] ?? 'Hoje';
    case 'dia': return formatarDataExibicao(e.dia);
    case 'periodo': {
      // Mesmo ano de hoje: sem o ano ("01/10 → 04/10"); senão com o ano, para não confundir.
      const anoHoje = hoje.slice(0, 4);
      const curto = e.inicio.slice(0, 4) === anoHoje && e.fim.slice(0, 4) === anoHoje;
      const f = (d: string) => (curto ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : formatarDataExibicao(d));
      return `${f(e.inicio)} → ${f(e.fim)}`;
    }
    case 'mes': return `${MESES[e.mes] ?? ''} ${e.ano}`.trim();
    case 'ano': return String(e.ano);
    default: return 'Hoje';
  }
}

const TZ = 'America/Sao_Paulo';
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const diaCurto = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ });
/** "Sáb 03/10" */
function diaSemana(iso: string): string {
  const s = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: TZ }).replace('.', '');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} ${diaCurto(iso)}`;
}

/** Texto do botão de período quando o dia é contado pelo turno do caixa. */
export function rotuloSessao(s: SessionInfo | null | undefined): string {
  return s ? `Turno ${diaCurto(s.opened_at)} ${hhmm(s.opened_at)}` : 'Turno atual';
}

interface Props {
  aberta: boolean;
  onFechar: () => void;
  /** AAAA-MM-DD, Brasília */
  hoje: string;
  escolha: EscolhaPeriodo;
  onEscolher: (e: EscolhaPeriodo) => void;
  modoDia: 'calendario' | 'sessao';
  onModoDia: (m: 'calendario' | 'sessao') => void;
  sessoes: SessionInfo[];
  carregandoSessoes: boolean;
  sessaoId: string | null;
  onSessao: (id: string | null) => void;
  temSessaoAberta: boolean;
}

export default function PeriodoFolha({ aberta, onFechar, ...resto }: Props) {
  return (
    <Folha
      aberta={aberta}
      onFechar={onFechar}
      titulo="Quais pedidos ver?"
      rodape={<button type="button" onClick={onFechar} className={`${btn('p')} flex-1`}>Pronto</button>}
    >
      {/* O conteúdo só existe com a folha aberta: os campos de data começam do que está valendo. */}
      <Conteudo onFechar={onFechar} {...resto} />
    </Folha>
  );
}

const CHIPS: { id: PresetPeriodo; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'ontem', rotulo: 'Ontem' },
  { id: '7dias', rotulo: 'Últimos 7 dias' },
  { id: '30dias', rotulo: 'Últimos 30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'todos', rotulo: 'Todos os dias' },
];

const campoData = 'w-full h-11 px-3 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-800 focus:outline-none focus:border-amber-400';

function Conteudo({
  onFechar, hoje, escolha, onEscolher, modoDia, onModoDia, sessoes, carregandoSessoes, sessaoId, onSessao, temSessaoAberta,
}: Omit<Props, 'aberta'>) {
  const anoAtual = Number(hoje.slice(0, 4));
  const mesAtual = Number(hoje.slice(5, 7)) - 1;
  const anos = [anoAtual, anoAtual - 1, anoAtual - 2];

  const [painel, setPainel] = useState<'dia' | 'periodo' | null>(null);
  const [maisAberto, setMaisAberto] = useState(false);
  const [dia, setDia] = useState(escolha.modo === 'dia' ? escolha.dia : hoje);
  const [inicio, setInicio] = useState(escolha.modo === 'periodo' ? escolha.inicio : somarDias(hoje, -6));
  const [fim, setFim] = useState(escolha.modo === 'periodo' ? escolha.fim : hoje);
  const [anoDoMes, setAnoDoMes] = useState(escolha.modo === 'mes' ? escolha.ano : anoAtual);

  const escolher = (e: EscolhaPeriodo) => { onEscolher(e); onFechar(); };

  const presetAtivo = escolha.modo === 'preset' ? escolha.preset : null;
  const chip = (ativo: boolean) =>
    `inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-[13px] font-bold cursor-pointer whitespace-nowrap ${
      ativo ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`;

  const diaOk = !!dia && dia <= hoje;
  const periodoOk = !!inicio && !!fim && inicio <= hoje && fim <= hoje;
  const aplicarPeriodo = () => {
    // Se digitou ao contrário (fim antes do começo), troca em vez de dar erro.
    const [a, b] = inicio <= fim ? [inicio, fim] : [fim, inicio];
    escolher({ modo: 'periodo', inicio: a, fim: b });
  };

  const aberto = sessoes.find((s) => s.status === 'open') ?? null;
  const fechados = sessoes.filter((s) => s.status === 'closed');

  return (
    <div className="space-y-5 pb-2">
      {/* Contar o dia por */}
      <div>
        <p className="text-[13px] font-extrabold text-zinc-900 mb-2">Contar o dia por</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: 'calendario', icone: 'ri-calendar-line', titulo: 'Calendário', sub: 'de 0h a 23h59' },
            { id: 'sessao', icone: 'ri-store-2-line', titulo: 'Turno do caixa', sub: 'de quando abriu até fechar — pega a madrugada' },
          ] as const).map((o) => {
            const ativo = modoDia === o.id;
            return (
              <button key={o.id} type="button" onClick={() => onModoDia(o.id)} aria-pressed={ativo}
                className={`text-left rounded-2xl border px-3 py-3 min-h-[92px] flex flex-col gap-0.5 cursor-pointer transition-colors ${
                  ativo ? 'border-amber-400 bg-amber-50/70' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}>
                <i className={`${o.icone} text-xl ${ativo ? 'text-amber-600' : 'text-zinc-400'}`} />
                <span className="text-[13.5px] font-extrabold text-zinc-900 leading-tight">{o.titulo}</span>
                <span className="text-[11px] text-zinc-500 leading-snug">{o.sub}</span>
              </button>
            );
          })}
        </div>
        <Nota className="mt-2">Vale também para o Dashboard e os Relatórios.</Nota>
      </div>

      {modoDia === 'calendario' ? (
        <div className="space-y-3">
          {/* Atalhos */}
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((c) => (
              <button key={c.id} type="button" onClick={() => escolher({ modo: 'preset', preset: c.id })} className={chip(presetAtivo === c.id)}>
                {c.rotulo}
              </button>
            ))}
            <button type="button" onClick={() => setPainel((p) => (p === 'dia' ? null : 'dia'))}
              className={chip(painel === 'dia' || escolha.modo === 'dia')}>
              <i className="ri-calendar-event-line" />Escolher dia
            </button>
            <button type="button" onClick={() => setPainel((p) => (p === 'periodo' ? null : 'periodo'))}
              className={chip(painel === 'periodo' || escolha.modo === 'periodo')}>
              <i className="ri-calendar-2-line" />De… até…
            </button>
          </div>

          {painel === 'dia' && (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 space-y-2.5">
              <label className="block text-[12px] font-bold text-zinc-600">Dia
                <input type="date" value={dia} max={hoje} onChange={(e) => setDia(e.target.value)} className={`${campoData} mt-1`} />
              </label>
              <button type="button" disabled={!diaOk} onClick={() => escolher({ modo: 'dia', dia })} className={`${btn('p')} w-full`}>Aplicar</button>
            </div>
          )}

          {painel === 'periodo' && (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label className="block min-w-0 text-[12px] font-bold text-zinc-600">De
                  <input type="date" value={inicio} max={hoje} onChange={(e) => setInicio(e.target.value)} className={`${campoData} mt-1`} />
                </label>
                <label className="block min-w-0 text-[12px] font-bold text-zinc-600">Até
                  <input type="date" value={fim} max={hoje} onChange={(e) => setFim(e.target.value)} className={`${campoData} mt-1`} />
                </label>
              </div>
              <button type="button" disabled={!periodoOk} onClick={aplicarPeriodo} className={`${btn('p')} w-full`}>Aplicar</button>
            </div>
          )}

          {/* Mais opções: um mês, um ano */}
          <div>
            <button type="button" onClick={() => setMaisAberto((v) => !v)} aria-expanded={maisAberto}
              className="inline-flex items-center gap-1 text-[13px] font-extrabold text-amber-700 cursor-pointer py-1">
              Mais opções
              <i className={`ri-arrow-down-s-line text-base transition-transform ${maisAberto ? 'rotate-180' : ''}`} />
            </button>
            {maisAberto && (
              <div className="mt-2 space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[12.5px] font-extrabold text-zinc-800">Um mês</p>
                    <div className="flex gap-1">
                      {anos.map((a) => (
                        <button key={a} type="button" onClick={() => setAnoDoMes(a)}
                          className={`h-8 px-2.5 rounded-lg text-[12px] font-bold cursor-pointer ${anoDoMes === a ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {MESES.map((nome, idx) => {
                      const futuro = anoDoMes === anoAtual && idx > mesAtual;
                      const ativo = escolha.modo === 'mes' && escolha.mes === idx && escolha.ano === anoDoMes;
                      return (
                        <button key={nome} type="button" disabled={futuro} onClick={() => escolher({ modo: 'mes', mes: idx, ano: anoDoMes })}
                          className={`h-10 rounded-xl text-[12.5px] font-bold cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                            ativo ? 'bg-amber-500 text-zinc-900' : 'bg-zinc-50 border border-zinc-200 text-zinc-700 hover:bg-zinc-100'}`}>
                          {nome.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-[12.5px] font-extrabold text-zinc-800 mb-2">Um ano</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {anos.map((a) => {
                      // "Este ano" (atalho antigo) é o ano de hoje inteiro: marca o mesmo botão.
                      const ativo = (escolha.modo === 'ano' && escolha.ano === a) || (a === anoAtual && presetAtivo === 'ano');
                      return (
                        <button key={a} type="button" onClick={() => escolher({ modo: 'ano', ano: a })}
                          className={`h-11 rounded-xl text-sm font-extrabold cursor-pointer ${
                            ativo ? 'bg-amber-500 text-zinc-900' : 'bg-zinc-50 border border-zinc-200 text-zinc-700 hover:bg-zinc-100'}`}>
                          {a}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <p className="text-[13px] font-extrabold text-zinc-900">Turnos do caixa</p>
          <p className="text-[11.5px] text-zinc-500 mb-2">toque para ver só os pedidos daquele turno</p>
          <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100 overflow-hidden">
            {/* Turno atual */}
            {temSessaoAberta ? (
              <LinhaTurno
                selecionado={sessaoId === null}
                icone="ri-radio-button-line"
                tomIcone="verde"
                titulo="Turno atual"
                sub={aberto ? `Aberto às ${hhmm(aberto.opened_at)}${aberto.operador ? ` · ${aberto.operador}` : ''}` : 'Em andamento agora'}
                n={aberto?.num_pedidos}
                onClick={() => { onSessao(null); onFechar(); }}
              />
            ) : (
              <div className="flex items-center gap-3 px-3 py-3">
                <span className="w-9 h-9 rounded-xl bg-zinc-100 text-zinc-400 flex items-center justify-center flex-shrink-0"><i className="ri-store-2-line text-base" /></span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-bold text-zinc-700">Nenhum turno aberto agora</p>
                  <p className="text-[11.5px] text-zinc-400">Escolha um turno que já fechou.</p>
                </div>
              </div>
            )}

            {carregandoSessoes ? (
              <div className="flex items-center justify-center gap-2 px-3 py-5 text-zinc-400 text-xs">
                <i className="ri-loader-4-line animate-spin" />Carregando os turnos…
              </div>
            ) : fechados.length === 0 ? (
              <p className="px-3 py-4 text-xs text-zinc-400">Nenhum turno fechado ainda.</p>
            ) : (
              fechados.map((s) => (
                <LinhaTurno
                  key={s.id}
                  selecionado={sessaoId === s.id}
                  icone="ri-archive-line"
                  tomIcone="cinza"
                  titulo={`${diaSemana(s.opened_at)} · ${hhmm(s.opened_at)}${s.closed_at ? ` → ${hhmm(s.closed_at)}` : ''}`}
                  sub={`${s.operador ? `${s.operador} · ` : ''}${brl(s.faturamento)}`}
                  n={s.num_pedidos}
                  onClick={() => { onSessao(s.id); onFechar(); }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LinhaTurno({ selecionado, icone, tomIcone, titulo, sub, n, onClick }: {
  selecionado: boolean;
  icone: string;
  tomIcone: 'verde' | 'cinza';
  titulo: string;
  sub: string;
  n?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selecionado}
      className={`w-full flex items-center gap-3 px-3 py-3 text-left cursor-pointer hover:bg-zinc-50 ${selecionado ? 'bg-amber-50' : ''}`}>
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tomIcone === 'verde' ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-500'}`}>
        <i className={`${icone} text-base`} />
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[13.5px] font-bold truncate ${selecionado ? 'text-amber-800' : 'text-zinc-800'}`} title={typeof titulo === 'string' ? titulo : undefined}>{titulo}</span>
        <span className="block text-[11.5px] text-zinc-500 truncate tabular-nums" title={typeof sub === 'string' ? sub : undefined}>{sub}</span>
      </span>
      {n != null && (
        <span className="text-right flex-shrink-0">
          <span className="block text-sm font-extrabold text-zinc-800 tabular-nums">{n}</span>
          <span className="block text-[10.5px] text-zinc-400">pedido{n === 1 ? '' : 's'}</span>
        </span>
      )}
      {selecionado && <i className="ri-check-line text-amber-600 text-lg flex-shrink-0" />}
    </button>
  );
}
