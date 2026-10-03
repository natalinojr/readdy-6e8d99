import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useToast } from '@/contexts/ToastContext';
import {
  descreverFrequencia, fmtQtd, quandoFica, rotuloUnidade,
  type ContagemDeHoje, type InsumoSituacao, type SituacaoEstoque,
} from '@/lib/estoqueRegras';
import type { UnidadeEstoque } from '@/types/estoque';
import Folha from './Folha';
import Ajuda from './Ajuda';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const UNIDADE_FRONT: Record<string, UnidadeEstoque> = { g: 'g', kg: 'kg', ml: 'ml', L: 'l', unit: 'un' };

/** Os que mais giram em reais por dia (para a semanal sugerida). */
export function maisGiram(insumos: InsumoSituacao[], n = 10): InsumoSituacao[] {
  return insumos
    .filter((i) => i.contaInventario && (i.consumoDia ?? 0) > 0)
    .sort((a, b) => (b.consumoDia ?? 0) * b.preco - (a.consumoDia ?? 0) * a.preco)
    .slice(0, n);
}

export default function ContarSecao({ situacao, contagem, podeContar, onContar, onConfigurar, onReload }: {
  situacao: SituacaoEstoque;
  contagem: ContagemDeHoje;
  /** Permissão estoque_inventario (a mesma da aba Inventário) */
  podeContar: boolean;
  onContar: (itens: InsumoSituacao[], titulo: string) => void;
  onConfigurar: () => void;
  onReload: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [criando, setCriando] = useState(false);
  const { devidos, conferir, planos, itens } = contagem;
  const pode = situacao.config.podeConfigurar;

  const criarPadrao = async () => {
    setCriando(true);
    try {
      const topo = maisGiram(situacao.insumos).map((i) => i.id);
      const r1 = await supabase.rpc('fn_estoque_salvar_plano', {
        p_tenant_id: user!.tenantId, p_id: null, p_nome: 'Contagem geral', p_frequencia: 'mensal',
        p_dia_semana: null, p_dia_mes: 0, p_todos: true, p_itens: [],
      });
      if (r1.error) throw r1.error;
      if (topo.length) {
        const r2 = await supabase.rpc('fn_estoque_salvar_plano', {
          p_tenant_id: user!.tenantId, p_id: null, p_nome: 'Contagem semanal', p_frequencia: 'semanal',
          p_dia_semana: 1, p_dia_mes: null, p_todos: false, p_itens: topo,
        });
        if (r2.error) throw r2.error;
      }
      toast.success('Contagens programadas', topo.length ? 'Geral no último dia do mês e semanal toda segunda.' : 'Geral no último dia do mês.');
      onReload();
    } catch (e) {
      toast.error('Não programei as contagens', (e as { message?: string })?.message ?? String(e));
      onReload(); // se a 1ª foi gravada, o cartão some e não duplica ao tentar de novo
    } finally {
      setCriando(false);
    }
  };

  const proxima = planos.length
    ? [...planos].sort((a, b) => a.proxima.localeCompare(b.proxima))[0]
    : null;

  return (
    <section id="inicio-contar" className="scroll-mt-4">
      <div className="flex items-baseline gap-2 mb-2 px-0.5">
        <h2 className="text-base lg:text-lg font-extrabold text-zinc-900 flex items-center gap-1.5">Contar
          <Ajuda titulo="Contar">
            Aparece aqui o que precisa contar <b>agora</b>: os itens da contagem programada do dia (o normal é uma geral por mês e uma semanal dos que mais giram) e os insumos com número impossível.
            <br /><br />A contagem é um item por vez. Só os itens que você contar mudam no estoque; os pulados ficam como estão.
            <br /><b>Programar</b>: escolhe os dias e os insumos de cada contagem. No dia, quem cuida do estoque recebe aviso no celular.
          </Ajuda>
        </h2>
        <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${itens.length ? 'bg-zinc-800 text-white' : 'bg-emerald-600 text-white'}`}>{itens.length}</span>
        <span className="text-xs text-zinc-400 flex-1">{itens.length ? 'para contar agora' : 'em dia'}</span>
        {pode && planos.length > 0 && (
          <button onClick={onConfigurar} className="text-xs font-bold text-amber-700 hover:text-amber-800 cursor-pointer">Programar</button>
        )}
      </div>

      <div className="space-y-2.5">
        {conferir.length > 0 && (
          <div className="relative bg-white border border-zinc-200 rounded-2xl pl-4 pr-3 py-3 overflow-hidden">
            <span className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" />
            <div className="flex items-center gap-2">
              <p className="text-sm font-extrabold text-zinc-900 flex-1 flex items-center gap-1.5">Conferir: número impossível
                <Ajuda titulo="Número impossível">Estoque negativo não existe na prateleira: o sistema baixou mais do que entrou (ficha técnica errada, entrada que faltou lançar). Contar acerta o número, e daí dá para saber se precisa comprar.</Ajuda>
              </p>
              <span className="text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 rounded-md px-1.5 py-0.5">fora da rotina</span>
            </div>
            <p className="text-[12px] text-zinc-500 mt-1 leading-snug">
              {conferir.slice(0, 4).map((i) => `${i.nome} (${i.estoque < 0 ? fmtQtd(i.estoque, i.unidade) : 'marcado esgotado com saldo'})`).join(', ')}
              {conferir.length > 4 ? ` e mais ${conferir.length - 4}` : ''}. Sem contar, não dá para saber se precisa comprar.
            </p>
            {podeContar ? (
              <button onClick={() => onContar(conferir, 'Conferir')} className="mt-2 w-full min-h-[42px] rounded-xl bg-zinc-900 text-white text-sm font-bold cursor-pointer">
                Conferir agora ({conferir.length})
              </button>
            ) : <SemPermissao />}
          </div>
        )}

        {devidos.map((d) => {
          const total = d.pendentes.length + d.contados.length;
          return (
            <div key={d.plano.id} className="relative bg-white border border-zinc-200 rounded-2xl pl-4 pr-3 py-3 overflow-hidden">
              <span className={`absolute left-0 top-0 bottom-0 w-1 ${d.atraso > 0 ? 'bg-red-500' : 'bg-amber-400'}`} />
              <div className="flex items-center gap-2">
                <p className="text-sm font-extrabold text-zinc-900 flex-1 truncate">{d.plano.nome}</p>
                <span className={`text-[10px] font-bold uppercase tracking-wide rounded-md px-1.5 py-0.5 ${d.atraso > 0 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                  {d.atraso > 0 ? `atrasada ${d.atraso} ${d.atraso === 1 ? 'dia' : 'dias'}` : 'é hoje'}
                </span>
              </div>
              <p className="text-[12px] text-zinc-500 mt-1 leading-snug">
                {descreverFrequencia(d.plano)} · {d.pendentes.length} de {total} {total === 1 ? 'item' : 'itens'} por contar
                {d.atraso > 0 ? ` · era ${quandoFica(d.ocorrencia!, situacao.hoje)}` : ''}
                {d.contados.length ? ` · ${d.contados.length} já contados` : ''}
              </p>
              <p className="text-[11.5px] text-zinc-400 mt-1 truncate">{d.pendentes.slice(0, 6).map((i) => i.nome).join(', ')}{d.pendentes.length > 6 ? '…' : ''}</p>
              {podeContar ? (
                <button onClick={() => onContar(d.pendentes, d.plano.nome)} className="mt-2 w-full min-h-[42px] rounded-xl bg-zinc-900 text-white text-sm font-bold cursor-pointer flex items-center justify-center gap-2">
                  <i className="ri-scales-3-line" />Começar ({d.pendentes.length} · ~{Math.max(1, Math.round(d.pendentes.length * 0.7))} min)
                </button>
              ) : <SemPermissao />}
            </div>
          );
        })}

        {planos.length === 0 && (
          <div className="relative bg-white border border-zinc-200 rounded-2xl pl-4 pr-3 py-3 overflow-hidden">
            <span className="absolute left-0 top-0 bottom-0 w-1 bg-zinc-300" />
            <p className="text-sm font-extrabold text-zinc-900">Nenhuma contagem programada</p>
            <p className="text-[12px] text-zinc-500 mt-1 leading-snug">
              O comum é uma contagem geral por mês e uma semanal dos itens que mais giram. Programando, o sistema mostra aqui quando é dia de contar e quais itens.
            </p>
            {pode ? (
              <div className="flex gap-2 mt-2">
                <button disabled={criando} onClick={criarPadrao} className="flex-1 min-h-[42px] rounded-xl bg-amber-500 text-zinc-900 text-sm font-bold cursor-pointer disabled:opacity-50">
                  {criando ? 'Criando…' : 'Criar as duas de sempre'}
                </button>
                <button onClick={onConfigurar} className="min-h-[42px] px-3 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 cursor-pointer">Do meu jeito</button>
              </div>
            ) : (
              <p className="text-[11.5px] text-zinc-400 mt-2">Quem programa é o gerente ou o dono.</p>
            )}
            {pode && (
              <p className="text-[11px] text-zinc-400 mt-2 leading-snug">
                “As duas de sempre”: geral (todos os insumos da contagem) no último dia do mês e semanal toda segunda com os {Math.min(10, maisGiram(situacao.insumos).length) || 'que mais giram'} que mais giram em reais.
              </p>
            )}
          </div>
        )}

        {planos.length > 0 && devidos.length === 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start gap-3">
            <i className="ri-checkbox-circle-fill text-xl text-emerald-600 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-emerald-800">Contagens em dia</p>
              {proxima && <p className="text-xs text-emerald-700 mt-0.5">Próxima: {proxima.plano.nome}, {quandoFica(proxima.proxima, situacao.hoje)}.</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SemPermissao() {
  return <p className="text-[11.5px] text-zinc-400 mt-2">Contar é com quem tem a permissão de inventário (a mesma da aba Inventário).</p>;
}

/** Contagem passo a passo pelo celular. Grava só os itens contados (os pulados não mudam).
 *  O que foi digitado fica guardado se a folha fechar sem querer; só limpa depois de gravar. */
export function ContagemFolha({ aberta, titulo, itens, onFechar, onConcluida }: {
  aberta: boolean;
  titulo: string;
  itens: InsumoSituacao[];
  onFechar: () => void;
  onConcluida: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const { confirmarInventario } = useEstoque();
  const [passo, setPasso] = useState(0);
  const [valores, setValores] = useState<Record<string, string>>({});
  const valoresRef = useRef(valores);
  valoresRef.current = valores;
  const [gravando, setGravando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  // Reabrindo, volta para o primeiro item ainda sem número (o digitado continua).
  useEffect(() => {
    if (!aberta) return;
    const k = itens.findIndex((i) => (valoresRef.current[i.id] ?? '').trim() === '');
    setPasso(k < 0 ? itens.length : k);
  }, [aberta, itens]);
  useEffect(() => { if (aberta) campo.current?.focus(); }, [aberta, passo]);

  const fator = (i: InsumoSituacao) => (i.unidadeContagem && i.fatorContagem ? i.fatorContagem : 1);
  const unidadeConta = (i: InsumoSituacao) => (i.unidadeContagem && i.fatorContagem ? i.unidadeContagem : rotuloUnidade(i.unidade));
  const lido = (i: InsumoSituacao) => {
    const t = (valores[i.id] ?? '').trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * fator(i) * 10000) / 10000 : null;
  };
  const contados = itens.filter((i) => lido(i) !== null);
  const naRevisao = passo >= itens.length;
  const atual = naRevisao ? null : itens[passo];

  const confirmar = async () => {
    setGravando(true);
    const lista = contados.filter((i) => i.contaInventario).map((i) => {
      const q = lido(i)!;
      return {
        insumoId: i.id, insumoNome: i.nome, unidade: UNIDADE_FRONT[i.unidade] ?? 'un',
        qtdTeorica: i.estoque, qtdContada: q, diferenca: parseFloat((q - i.estoque).toFixed(4)), precoUnitario: i.preco,
      };
    });
    const r = await confirmarInventario(lista, user?.nome ?? 'Operador');
    setGravando(false);
    if (!r.ok) { toast.error('A contagem não foi gravada', r.erro ?? 'Tente de novo.'); return; }
    const acertos = lista.filter((l) => Math.abs(l.diferenca) > 0.00005).length;
    setValores((v) => { const n = { ...v }; for (const l of lista) delete n[l.insumoId]; return n; });
    toast.success('Contagem gravada', `${lista.length} ${lista.length === 1 ? 'item contado' : 'itens contados'}, ${acertos} ${acertos === 1 ? 'acerto' : 'acertos'} no estoque.`);
    onConcluida();
  };

  const valorAjuste = contados.reduce((s, i) => s + (lido(i)! - i.estoque) * (i.preco || 0), 0);

  return (
    <Folha
      aberta={aberta}
      fecharNoFundo={contados.length === 0}
      titulo={naRevisao ? 'Revisar a contagem' : titulo}
      subtitulo={naRevisao ? `${contados.length} de ${itens.length} contados` : `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} · o que você pular fica como está`}
      onFechar={onFechar}
      rodape={naRevisao ? (
        <>
          <button onClick={() => setPasso(Math.max(0, itens.length - 1))} className="flex-1 min-h-[46px] rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 cursor-pointer">Voltar</button>
          <button disabled={gravando || contados.length === 0} onClick={confirmar} className="flex-1 min-h-[46px] rounded-xl bg-zinc-900 text-white text-sm font-bold cursor-pointer disabled:opacity-40">
            {gravando ? 'Gravando…' : 'Confirmar'}
          </button>
        </>
      ) : (
        <>
          <button onClick={() => { setValores((v) => { const n = { ...v }; delete n[atual!.id]; return n; }); setPasso((p) => p + 1); }} className="flex-1 min-h-[46px] rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 cursor-pointer">Pular</button>
          <button onClick={() => setPasso((p) => p + 1)} className="flex-1 min-h-[46px] rounded-xl bg-zinc-900 text-white text-sm font-bold cursor-pointer">
            {passo === itens.length - 1 ? 'Revisar' : 'Próximo'} →
          </button>
        </>
      )}
    >
      {atual ? (
        <div className="pb-2">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-amber-700">{passo + 1} de {itens.length}{atual.categoria ? ` · ${atual.categoria}` : ''}</p>
          <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden mt-2"><div className="h-full bg-amber-500 transition-all" style={{ width: `${(passo / itens.length) * 100}%` }} /></div>
          <p className="text-xl font-extrabold text-zinc-900 mt-3">{atual.nome}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            No sistema: <b className={atual.estoque < 0 ? 'text-red-600' : 'text-zinc-700'}>{fmtQtd(atual.estoque, atual.unidade)}</b>
            {atual.estoque < 0 ? ' (impossível: o sistema baixou mais do que entrou)' : ''}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <input
              ref={campo}
              value={valores[atual.id] ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, [atual.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setPasso((p) => p + 1); } }}
              inputMode="decimal"
              enterKeyHint="next"
              placeholder="Quanto tem?"
              className="flex-1 min-w-0 rounded-2xl border border-zinc-200 px-4 py-3 text-2xl font-extrabold focus:outline-none focus:border-amber-400"
            />
            <span className="text-base font-extrabold text-zinc-600">{unidadeConta(atual)}</span>
          </div>
          {fator(atual) !== 1 && (
            <p className="text-[11px] text-zinc-400 mt-1">1 {atual.unidadeContagem} = {fmtQtd(fator(atual), atual.unidade)}</p>
          )}
        </div>
      ) : (
        <div className="pb-2">
          {contados.length === 0 && <p className="text-sm text-zinc-500 py-3">Nenhum item contado. Volte e digite pelo menos um.</p>}
          {contados.map((i) => {
            const q = lido(i)!; const d = q - i.estoque;
            return (
              <div key={i.id} className="flex justify-between gap-3 py-2 border-t border-zinc-100 first:border-t-0 text-[13.5px]">
                <span className="text-zinc-600 truncate">{i.nome}</span>
                <b className="text-zinc-800 whitespace-nowrap">{fmtQtd(q, i.unidade)}{' '}
                  <small className={Math.abs(d) < 0.00005 ? 'text-zinc-400' : d < 0 ? 'text-red-600' : 'text-emerald-600'}>
                    ({Math.abs(d) < 0.00005 ? 'confere' : `${d > 0 ? '+' : ''}${fmtQtd(d, i.unidade)}`})
                  </small>
                </b>
              </div>
            );
          })}
          {contados.length > 0 && (
            <p className="text-xs bg-zinc-50 text-zinc-600 rounded-xl px-3 py-2 mt-2">
              Ajuste no estoque: <b>{valorAjuste >= 0 ? '+' : ''}{brl(valorAjuste)}</b>. Só os itens contados mudam; o resto fica como está.
            </p>
          )}
        </div>
      )}
    </Folha>
  );
}
