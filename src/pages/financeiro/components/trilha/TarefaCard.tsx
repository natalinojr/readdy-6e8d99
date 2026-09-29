// Cartão de uma tarefa da Trilha: título, "ver fases", "O que houve" e os botões de ação.
// Só há ações que JÁ existem no sistema (abrir a tela certa ou a janela que resolve); nada novo aqui.
import { diaBR, type CasoTrilha, type TarefaTrilha } from '@/lib/trilhaDespesas';
import { FasesLinha } from './Fases';
import { fmtBRL, type AcoesTrilha } from './comum';

interface Botao { label: string; icone: string; onClick: () => void }
interface Plano { botoes: Botao[]; ajuda?: string }

const qs = (tab: string, extra = '') => `/financeiro?tab=${tab}${extra}`;

/** Quais botões cada grupo de tarefa oferece (o primeiro é o principal). */
export function planoDaTarefa(t: TarefaTrilha, c: CasoTrilha, a: AcoesTrilha): Plano {
  const compraId = c.compra?.id;
  switch (t.grupo) {
    case 'saida_banco': {
      const e = c.extrato[0];
      return {
        botoes: [
          ...(e ? [{ label: 'Dizer o que foi', icone: 'ri-question-answer-line', onClick: () => a.extrato(e, `Disse o que foi a saída de ${c.titulo}`) }] : []),
          { label: 'Abrir na Conciliação', icone: 'ri-bank-line', onClick: () => a.rota(qs('conciliacao')) },
        ],
      };
    }
    case 'vencidas': {
      const busca = c.etapas.find((e) => e.id === 'pagamento')?.atalho?.valor;
      return {
        botoes: [{ label: 'Abrir em Contas a pagar', icone: 'ri-bill-line', onClick: () => a.rota(qs('pagar', busca ? '&busca=' + encodeURIComponent(busca) : '')) }],
        ajuda: 'Para pagar pelo Inter use o assistente (chat) — pagar direto daqui vem na próxima etapa.',
      };
    }
    case 'sem_conta':
      return {
        botoes: compraId ? [{ label: 'Abrir a compra', icone: 'ri-shopping-cart-2-line', onClick: () => a.rota(qs('compras', '&foco=' + encodeURIComponent(compraId))) }] : [],
        ajuda: 'Criar a conta a pagar direto daqui vem na próxima etapa.',
      };
    case 'estoque':
      if (!compraId) return { botoes: [] };
      return t.urgente
        ? {
          botoes: [
            { label: 'Ligar os itens aos insumos', icone: 'ri-links-line', onClick: () => a.rota(qs('itens')) },
            { label: 'Ver a compra', icone: 'ri-shopping-cart-2-line', onClick: () => a.compra(compraId, `Acertou o estoque de ${c.titulo}`) },
          ],
        }
        : { botoes: [{ label: 'Confirmar a entrega', icone: 'ri-check-double-line', onClick: () => a.compra(compraId, `Confirmou a entrega de ${c.titulo}`) }] };
    case 'notas': {
      const n = c.notas[0];
      return { botoes: n ? [{ label: 'Lançar a nota', icone: 'ri-inbox-archive-line', onClick: () => a.rota(qs('notas-entrada', '&nota=' + encodeURIComponent(n.id))) }] : [] };
    }
    case 'pedidos':
      return { botoes: [{ label: 'Abrir pedidos', icone: 'ri-hand-coin-line', onClick: () => a.rota('/receber') }] };
    case 'classificar':
      return { botoes: [{ label: 'Escolher a categoria', icone: 'ri-price-tag-3-line', onClick: () => a.classificar(c, `Escolheu a categoria de ${c.titulo}`) }] };
    case 'extrato':
      return { botoes: [{ label: 'Achar no extrato', icone: 'ri-links-line', onClick: () => a.rota(qs('conciliacao')) }] };
    default:
      return { botoes: [] };
  }
}

interface Props {
  caso: CasoTrilha; tarefa: TarefaTrilha; expandido: boolean; onToggle: () => void; acoes: AcoesTrilha;
}

export default function TarefaCard({ caso, tarefa, expandido, onToggle, acoes }: Props) {
  const plano = planoDaTarefa(tarefa, caso, acoes);
  const u = tarefa.urgente;
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
        {plano.botoes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {plano.botoes.map((b, i) => (
              <button key={b.label} onClick={b.onClick}
                className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${i === 0
                  ? (u ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-amber-500 text-white hover:bg-amber-600')
                  : (u ? 'bg-white border border-red-200 text-red-700 hover:bg-red-50' : 'bg-white border border-amber-200 text-amber-800 hover:bg-amber-50')}`}>
                <i className={b.icone} /> {b.label}
              </button>
            ))}
          </div>
        )}
        {plano.ajuda && <p className="mt-1.5 text-[11px] text-zinc-500">{plano.ajuda}</p>}
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
