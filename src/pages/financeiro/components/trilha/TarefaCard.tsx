// Cartão de uma tarefa da Trilha: título, "ver fases", "O que houve" e os botões de ação.
// Só há ações que JÁ existem no sistema (abrir a tela certa ou a janela que resolve); nada novo aqui.
import { useState } from 'react';
import { diaBR, type CasoTrilha, type TarefaTrilha, type TrConta } from '@/lib/trilhaDespesas';
import { FasesLinha } from './Fases';
import { fmtBRL, type AcoesTrilha } from './comum';
import { temBoleto } from './api';
import { diasAtraso } from '@/lib/trilhaAcoes';
import { AcharSaida, CriarConta, EntrarNoEstoque, FaltaJeitoDePagar, PagarConta, PedirBoleto, SugestaoExtrato } from './Paineis';

interface Botao { label: string; icone: string; onClick: () => void; /** botão que abre painel inline: mostra ▾/▴ */ painel?: 'aberto' | 'fechado' }
interface Plano { botoes: Botao[]; ajuda?: string }

/** Painel inline aberto no cartão (um por vez); clicar de novo no mesmo botão fecha. */
interface Ctx { painel: string | null; alternar: (id: string) => void }
const vencida = (c: TrConta, hoje: string) => c.status !== 'paid' && (c.status === 'overdue' || (!!c.due_date && String(c.due_date).slice(0, 10) < hoje));

const contaPagaDoCaso = (c: CasoTrilha) => c.contas.find((k) => k.status === 'paid');
const qs = (tab: string, extra = '') => `/financeiro?tab=${tab}${extra}`;

/** Quais botões cada grupo de tarefa oferece (o primeiro é o principal). */
export function planoDaTarefa(t: TarefaTrilha, c: CasoTrilha, a: AcoesTrilha, x: Ctx): Plano {
  const compraId = c.compra?.id;
  switch (t.grupo) {
    case 'saida_banco': {
      const e = c.extrato[0];
      return {
        botoes: [
          ...(e ? [{ label: e.sugestao ? 'Resolver de outro jeito…' : 'Dizer o que foi', icone: 'ri-question-answer-line', onClick: () => a.extrato(e, `Disse o que foi a saída de ${c.titulo}`) }] : []),
          { label: 'Abrir na Conciliação', icone: 'ri-bank-line', onClick: () => a.rota(qs('conciliacao')) },
        ],
      };
    }
    case 'vencidas': {
      const busca = c.etapas.find((e) => e.id === 'pagamento')?.atalho?.valor;
      return {
        botoes: [{ label: 'Abrir em Contas a pagar', icone: 'ri-bill-line', onClick: () => a.rota(qs('pagar', busca ? '&busca=' + encodeURIComponent(busca) : '')) }],
        ajuda: a.dono ? undefined : 'Para pagar pelo Inter use o assistente (chat) — só o dono paga por aqui.',
      };
    }
    case 'sem_conta':
      return {
        botoes: compraId ? [
          { label: 'Criar a conta a pagar', icone: 'ri-add-circle-line', painel: x.painel === 'criar' ? 'aberto' : 'fechado', onClick: () => x.alternar('criar') },
          { label: 'Abrir a compra', icone: 'ri-shopping-cart-2-line', onClick: () => a.rota(qs('compras', '&foco=' + encodeURIComponent(compraId))) },
        ] : [],
      };
    case 'estoque': {
      if (!compraId) return { botoes: [] };
      // Itens já têm insumo, só o recebimento ficou fora: escolhe ali mesmo, no cartão, quais entram
      const foraEstoque = c.etapas.find((e) => e.id === 'estoque')?.atalho?.valor === 'fora_estoque';
      return t.urgente
        ? {
          botoes: [
            foraEstoque
              ? { label: 'Escolher se entra no estoque', icone: 'ri-inbox-archive-line', painel: x.painel === 'estoque' ? 'aberto' : 'fechado', onClick: () => x.alternar('estoque') }
              : { label: 'Ligar os itens aos insumos', icone: 'ri-links-line', onClick: () => a.rota(qs('itens')) },
            { label: 'Ver a compra', icone: 'ri-shopping-cart-2-line', onClick: () => a.compra(compraId, `Acertou o estoque de ${c.titulo}`) },
          ],
        }
        : { botoes: [{ label: 'Confirmar a entrega', icone: 'ri-check-double-line', onClick: () => a.compra(compraId, `Confirmou a entrega de ${c.titulo}`) }] };
    }
    case 'notas': {
      const n = c.notas[0];
      return { botoes: n ? [{ label: 'Lançar a nota', icone: 'ri-inbox-archive-line', onClick: () => a.rota(qs('notas-entrada', '&nota=' + encodeURIComponent(n.id))) }] : [] };
    }
    case 'pedidos':
      return { botoes: [{ label: 'Abrir pedidos', icone: 'ri-hand-coin-line', onClick: () => a.rota('/receber') }] };
    case 'classificar':
      return { botoes: [{ label: 'Escolher a categoria', icone: 'ri-price-tag-3-line', onClick: () => a.classificar(c, `Escolheu a categoria de ${c.titulo}`) }] };
    case 'extrato': {
      const conta = contaPagaDoCaso(c);
      const achar = c.etapas.find((e) => e.id === 'banco')?.estado === 'pendente' && !!conta;
      return {
        botoes: [
          ...(achar ? [{ label: 'Achar a saída', icone: 'ri-search-line', painel: (x.painel === 'achar' ? 'aberto' : 'fechado') as 'aberto' | 'fechado', onClick: () => x.alternar('achar') }] : []),
          { label: 'Abrir na Conciliação', icone: 'ri-links-line', onClick: () => a.rota(qs('conciliacao')) },
        ],
      };
    }
    default:
      return { botoes: [] };
  }
}

interface Props {
  caso: CasoTrilha; tarefa: TarefaTrilha; expandido: boolean; onToggle: () => void; acoes: AcoesTrilha;
}

/** Linha de uma conta vencida (só dono): pagar agora, ou o que falta para poder pagar. */
function ContaVencida({ conta, acoes, painel, alternar }: { conta: TrConta; acoes: AcoesTrilha; painel: string | null; alternar: (id: string) => void }) {
  const [pedidoEm, setPedidoEm] = useState<string | null>(null);
  const boleto = acoes.boletos.get(conta.id);
  if (!boleto) return null; // ainda carregando (ou não é dono)
  const tem = temBoleto(boleto);
  const dias = diasAtraso(String(conta.due_date ?? ''), acoes.hoje);
  const pId = `pagar:${conta.id}`, fId = `falta:${conta.id}`, qId = `pedir:${conta.id}`;
  const seta = (id: string) => (painel === id ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line');
  return (
    <div className="mt-2 rounded-lg border border-red-100 bg-white px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-600">
        <span className="font-semibold text-zinc-800 break-words">{conta.description ?? conta.supplier}</span>
        <span>vence {diaBR(conta.due_date)} · {dias} {dias === 1 ? 'dia' : 'dias'} de atraso · {fmtBRL(Number(conta.amount) - Number(conta.paid_amount || 0))}</span>
        {!tem && <span className="px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 font-semibold">sem boleto nem Pix</span>}
        {pedidoEm && <span className="px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 font-semibold">boleto pedido em {diaBR(pedidoEm)}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {tem ? (
          <button onClick={() => alternar(pId)} className="text-xs px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer bg-red-500 text-white hover:bg-red-600">
            <i className="ri-bank-line" /> Pagar agora <i className={seta(pId)} />
          </button>
        ) : (
          <>
            <button onClick={() => alternar(fId)} className="text-xs px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer bg-red-500 text-white hover:bg-red-600">
              <i className="ri-barcode-line" /> Falta o jeito de pagar <i className={seta(fId)} />
            </button>
            <button onClick={() => alternar(qId)} className="text-xs px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer bg-white border border-red-200 text-red-700 hover:bg-red-50">
              <i className="ri-mail-send-line" /> {pedidoEm ? 'Pedir de novo' : 'Pedir o boleto…'} <i className={seta(qId)} />
            </button>
          </>
        )}
      </div>
      {painel === pId && tem && <PagarConta conta={conta} boleto={boleto} acoes={acoes} onFechar={() => alternar(pId)} />}
      {painel === fId && !tem && <FaltaJeitoDePagar conta={conta} acoes={acoes} onPedir={() => alternar(qId)} />}
      {painel === qId && !tem && <PedirBoleto conta={conta} acoes={acoes} jaPedido={pedidoEm} onPedido={(em) => setPedidoEm(em ?? acoes.hoje)} />}
    </div>
  );
}

export default function TarefaCard({ caso, tarefa, expandido, onToggle, acoes }: Props) {
  const [painel, setPainel] = useState<string | null>(null);
  const alternar = (id: string) => setPainel((p) => (p === id ? null : id));
  const plano = planoDaTarefa(tarefa, caso, acoes, { painel, alternar });
  const u = tarefa.urgente;
  const sugestao = tarefa.grupo === 'saida_banco' ? caso.extrato[0] : undefined;
  const vencidas = tarefa.grupo === 'vencidas' && acoes.dono ? caso.contas.filter((c) => vencida(c, acoes.hoje)) : [];
  const contaPaga = tarefa.grupo === 'extrato' ? caso.contas.find((k) => k.status === 'paid') : undefined;
  return (
    <div className={`rounded-xl border p-3 ${u ? 'border-red-200 bg-red-50/20' : 'border-zinc-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        <button onClick={onToggle} className="min-w-0 text-left group cursor-pointer">
          <p className="text-sm font-semibold text-zinc-800 truncate group-hover:underline">
            {u && <i className="ri-fire-fill text-red-500 mr-1" />}{caso.titulo}
          </p>
          <p className="text-[11px] text-zinc-400">
            {diaBR(caso.data)} · {caso.subtitulo} ·{' '}
            <span className="inline-flex items-center gap-0.5 ml-0.5 px-1.5 py-px rounded-md bg-zinc-100 text-zinc-600 font-medium group-hover:bg-zinc-200">
              <i className="ri-route-line" /> {expandido ? 'esconder fases' : 'ver fases'} <i className={expandido ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            </span>
          </p>
        </button>
        <span className="text-sm font-bold tabular-nums whitespace-nowrap">{fmtBRL(caso.valor)}</span>
      </div>
      {expandido && <FasesLinha caso={caso} fecha={tarefa.etapas} ir={acoes.ir} />}
      <div className={`mt-2 rounded-lg px-2.5 py-2 border ${u ? 'bg-red-50 border-red-200' : 'bg-amber-50/60 border-amber-100'}`}>
        <p className={`text-[11px] flex items-start gap-1.5 ${u ? 'text-red-800' : 'text-amber-800'}`}>
          <i className="ri-information-line mt-px" /><span><strong>O que houve</strong> — {tarefa.porque}</span>
        </p>
        {sugestao?.sugestao && <SugestaoExtrato extrato={sugestao} acoes={acoes} />}
        {vencidas.map((c) => <ContaVencida key={c.id} conta={c} acoes={acoes} painel={painel} alternar={alternar} />)}
        {plano.botoes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {plano.botoes.map((b, i) => (
              <button key={b.label} onClick={b.onClick}
                className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${i === 0 && !sugestao?.sugestao && vencidas.length === 0
                  ? (u ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-amber-500 text-white hover:bg-amber-600')
                  : (u ? 'bg-white border border-red-200 text-red-700 hover:bg-red-50' : 'bg-white border border-amber-200 text-amber-800 hover:bg-amber-50')}`}>
                <i className={b.icone} /> {b.label}{b.painel && <> <i className={b.painel === 'aberto' ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} /></>}
              </button>
            ))}
          </div>
        )}
        {plano.ajuda && <p className="mt-1.5 text-[11px] text-zinc-500">{plano.ajuda}</p>}
        {painel === 'criar' && caso.compra && <CriarConta caso={caso} acoes={acoes} />}
        {painel === 'estoque' && caso.compra && <EntrarNoEstoque caso={caso} acoes={acoes} />}
        {painel === 'achar' && contaPaga && <AcharSaida conta={contaPaga} caso={caso} acoes={acoes} />}
      </div>
      {caso.avisos.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {caso.avisos.map((a) => (
            <p key={a} className={`text-[11px] flex items-start gap-1 ${a.startsWith('Juros') ? 'text-zinc-500' : 'text-red-600'}`}><i className="ri-error-warning-line mt-px" />{a}</p>
          ))}
        </div>
      )}
    </div>
  );
}
