// Um cartão da tela Hoje (2026-10-03): diz o que é, por que está aqui e tem o botão que resolve ali
// mesmo. Reaproveita as peças da caixa de pendências do chat (baixa, contas atrasadas, classificar) e,
// para dinheiro do dono (pagar com PIN, pedir boleto), pede ao chat — o mesmo caminho de sempre.
import { useState, type ReactElement } from 'react';
import { supabase } from '@/lib/supabase';
import { kindConfig } from '@/contexts/PendenciasContext';
import { pedirAoChat } from '@/lib/assistenteFoco';
import { chamarAssistente } from '@/lib/assistenteApp';
import ItensClassificarCard from '@/components/feature/assistente/ItensClassificarCard';
import { BaixaDaConta, ContasAtrasadasInline, ContasDreInline } from '@/components/feature/assistente/PendenciasChat';
import type { ItemHoje, PendHoje, Porcao } from './organizar';
import { diasEntre } from './organizar';

const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "venceu 04/07 (91 dias)", "vence hoje", "vence amanhã", "vence segunda", "vence 14/10". */
export function rotuloPrazo(prazo: string | null, hoje: string): { texto: string; tom: 'red' | 'amber' | 'zinc' } | null {
  if (!prazo) return null;
  const d = diasEntre(hoje, prazo);
  if (d < 0) return { texto: `venceu ${ddmm(prazo)} · ${-d} dia${d === -1 ? '' : 's'}`, tom: 'red' };
  if (d === 0) return { texto: 'vence hoje', tom: 'red' };
  if (d === 1) return { texto: 'vence amanhã', tom: 'amber' };
  if (d <= 6) return { texto: `vence ${DIAS[new Date(`${prazo}T12:00:00Z`).getUTCDay()]}`, tom: 'amber' };
  return { texto: `vence ${ddmm(prazo)}`, tom: 'zinc' };
}

const semPrefixo = (t: string) => t.replace(/^Falta o boleto:\s*/, '');
/** Sem "Não vou fazer" genérico: têm saída própria (aqui ou na tela que o cartão abre). */
const SEM_DESCARTE = new Set(['boleto_faltando', 'aprovacao', 'pedido_pagamento', 'pedido_pagamento_pagar', 'pagamento_grupo', 'pagamento_pendente',
  'compra_pelo_celular', 'sangria_sem_cupom', 'sangria_nao_saiu', 'sangria_valor_diferente', 'recebimento_sem_nota', 'boleto_email',
  // Avisos antes de virar problema (2026-10-03): saem por "Ciente"/"Já comprei" ou fecham sozinhos.
  'vendas_abaixo_ritmo', 'caixa_nao_cobre', 'insumo_antes_do_pico']);

/** Texto do pedido de boleto que vai para a caixa de digitação do chat (o dono revisa e envia). */
function textoPedirBoletos(item: ItemHoje, ps: PendHoje[]): string {
  if (ps.length === 1) return `Boleto da conta "${semPrefixo(ps[0].titulo)}"${item.loja ? ` (${item.loja})` : ''}: `;
  const linhas = ps.map((p) => `• ${semPrefixo(p.titulo)}`).join('\n');
  return `Pedir os boletos${item.fornecedor ? ` da ${item.fornecedor}` : ''}${item.loja ? ` (${item.loja})` : ''}:\n${linhas}\n`;
}

const BTN = 'h-10 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-[13px] font-bold whitespace-nowrap disabled:opacity-50 cursor-pointer transition-colors';
const PRINCIPAL = `${BTN} bg-amber-500 hover:bg-amber-400 text-zinc-900`;
const SECUNDARIO = `${BTN} border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50`;
const LINK = 'h-10 px-2 inline-flex items-center text-[12px] font-semibold text-zinc-400 hover:text-zinc-600 cursor-pointer';

export interface CartaoProps {
  item: ItemHoje;
  hoje: string;
  /** Dono: pagar com PIN, pedir boleto e classificar pelo assistente. */
  dono: boolean;
  /** Papel da pessoa na loja do cartão (aprovar, financeiro…). */
  papel: string | undefined;
  meuNome: string;
  mostrarLoja: boolean;
  abrir: (tenantId: string, rota: string) => void;
  marcar: (id: string, acao: 'vista' | 'descartada' | 'resolvida', motivo?: string) => Promise<void>;
  onMudou: () => void;
  compacto?: boolean;
}

export default function CartaoHoje({ item, hoje, dono, papel, meuNome, mostrarLoja, abrir, marcar, onMudou, compacto }: CartaoProps) {
  const p = item.principal;
  const cfg = kindConfig(item.kind);
  const [aberto, setAberto] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // "N contas atrasadas": a data das contas juntadas não é a mais antiga de todas (a agregada não diz) — só o selo.
  const prazo = item.tipo === 'contas_vencidas' && p.kind === 'conta_atrasada' ? { texto: 'atrasadas', tom: 'red' as const } : rotuloPrazo(item.prazo, hoje);
  // Caixa da semana: o "prazo" é o dia em que o dinheiro deixa de cobrir ("falta sábado"), não um vencimento.
  if (prazo && p.kind === 'caixa_nao_cobre') prazo.texto = prazo.texto.replace(/^vence/, 'falta');
  const t = item.tenantId;
  const financeiro = dono || papel === 'admin' || papel === 'gerente' || papel === 'financeiro';

  const rodar = async (fn: () => Promise<unknown>) => {
    setOcupado(true); setErro(null);
    try { await fn(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setOcupado(false); }
  };
  const alternar = (k: string) => setAberto((a) => (a === k ? null : k));
  const naoVouFazer = () => setMotivo('');

  // ── Botões por tipo ────────────────────────────────────────────────────────────
  const botoes: ReactElement[] = [];
  const add = (key: string, el: ReactElement) => botoes.push(<span key={key} className="contents">{el}</span>);
  const bill = typeof p.payload?.bill_id === 'string' ? p.payload.bill_id : null;

  if (item.tipo === 'contas_vencidas' || p.kind === 'conta_vence_hoje') {
    add('ver', <button onClick={() => alternar('contas')} className={aberto === 'contas' ? SECUNDARIO : PRINCIPAL}>
      <i className={aberto === 'contas' ? 'ri-arrow-up-s-line' : 'ri-list-check-2'} /> {aberto === 'contas' ? 'Fechar' : 'Resolver uma por uma'}
    </button>);
    if (dono && item.juntas.length > 0) {
      add('pedir', <button onClick={() => pedirAoChat({ tipo: 'pedir', texto: textoPedirBoletos(item, item.juntas) })} className={SECUNDARIO}>
        <i className="ri-barcode-line" /> Pedir {item.juntas.length === 1 ? 'o boleto' : `os ${item.juntas.length} boletos`}
      </button>);
    }
  } else if (item.tipo === 'boletos_fornecedor') {
    if (dono) add('pedir', <button onClick={() => pedirAoChat({ tipo: 'pedir', texto: textoPedirBoletos(item, item.juntas) })} className={PRINCIPAL}>
      <i className="ri-barcode-line" /> {item.pedidoHaDias != null ? 'Pedir de novo' : `Pedir os ${item.juntas.length} boletos`}
    </button>);
    if (financeiro) add('pago', <button onClick={() => alternar('baixas')} className={dono ? SECUNDARIO : PRINCIPAL}>
      <i className="ri-check-double-line" /> {aberto === 'baixas' ? 'Fechar' : 'Já paguei alguma'}
    </button>);
  } else if (p.kind === 'boleto_faltando') {
    if (dono) add('pedir', <button onClick={() => pedirAoChat({ tipo: 'pedir', texto: textoPedirBoletos(item, [p]) })} className={PRINCIPAL}>
      <i className="ri-barcode-line" /> {item.pedidoHaDias != null ? 'Pedir de novo' : 'Pedir o boleto'}
    </button>);
    if (bill && financeiro) add('baixa', <button onClick={() => alternar('baixa')} className={dono ? SECUNDARIO : PRINCIPAL}>
      <i className="ri-check-double-line" /> {aberto === 'baixa' ? 'Fechar' : 'Já paguei — dar baixa'}
    </button>);
    add('nao', <button onClick={naoVouFazer} className={LINK}>Não era boleto</button>);
  } else if (p.kind === 'pagamento_grupo' || p.kind === 'pagamento_pendente') {
    if (dono) add('pagar', <button onClick={() => pedirAoChat({ tipo: 'pagar_pendencia', pendencia: { id: p.id, tenantId: p.tenantId, kind: p.kind, titulo: p.titulo } })} className={PRINCIPAL}>
      <i className="ri-lock-2-line" /> Pagar
    </button>);
    else if (p.rota) add('abrir', <button onClick={() => abrir(t, p.rota as string)} className={PRINCIPAL}><i className="ri-arrow-right-up-line" /> Abrir</button>);
  } else if (p.kind === 'pedido_pagamento' || p.kind === 'pedido_pagamento_pagar') {
    // Aprovar + Pix + PIN já existem na tela de pedidos: o cartão leva direto à lista de aprovar.
    add('decidir', <button onClick={() => abrir(t, '/receber?aprovar=1')} className={PRINCIPAL}><i className="ri-checkbox-circle-line" /> Decidir o pedido</button>);
  } else if (p.kind === 'aprovacao' && p.ref) {
    add('sim', <button disabled={ocupado} onClick={() => rodar(async () => {
      const { error } = await supabase.rpc('fn_pdv_approval_decide', { p_id: p.ref, p_aprovar: true, p_nome: meuNome });
      if (error) throw new Error(error.message);
    })} className={PRINCIPAL}><i className="ri-check-line" /> Aprovar</button>);
    add('nao', <button disabled={ocupado} onClick={() => rodar(async () => {
      const { error } = await supabase.rpc('fn_pdv_approval_decide', { p_id: p.ref, p_aprovar: false, p_nome: meuNome });
      if (error) throw new Error(error.message);
    })} className={SECUNDARIO}><i className="ri-close-line" /> Recusar</button>);
  } else if (p.kind === 'item_sem_classe' && dono) {
    add('class', <button onClick={() => alternar('itens')} className={aberto === 'itens' ? SECUNDARIO : PRINCIPAL}>
      <i className="ri-price-tag-3-line" /> {aberto === 'itens' ? 'Fechar' : 'Classificar aqui'}
    </button>);
  } else if (p.kind === 'conta_sem_dre' && dono) {
    add('dre', <button onClick={() => alternar('dre')} className={aberto === 'dre' ? SECUNDARIO : PRINCIPAL}>
      <i className="ri-pie-chart-line" /> {aberto === 'dre' ? 'Fechar' : 'Classificar aqui'}
    </button>);
  } else if (p.kind === 'recebimento_parado' && typeof p.payload?.document_id === 'string') {
    add('nota', <button onClick={() => abrir(t, `/financeiro?tab=notas-entrada&nota=${encodeURIComponent(p.payload?.document_id as string)}`)} className={PRINCIPAL}>
      <i className="ri-file-check-line" /> Conferir e lançar a nota
    </button>);
  } else if (p.kind === 'estoque_critico') {
    if (p.rota) add('ver', <button onClick={() => abrir(t, p.rota as string)} className={PRINCIPAL}><i className="ri-archive-line" /> Ver o estoque</button>);
  } else if (p.kind === 'vendas_abaixo_ritmo') {
    // Fecha sozinho quando as vendas voltam ao ritmo; "Ciente" tira daqui até a próxima janela (19h).
    add('ver', <button onClick={() => abrir(t, '/dashboard')} className={PRINCIPAL}><i className="ri-line-chart-line" /> Ver as vendas</button>);
    add('ok', <button disabled={ocupado} onClick={() => rodar(() => marcar(p.id, 'resolvida', 'ciente pela tela Hoje'))} className={LINK}>Ciente</button>);
  } else if (p.kind === 'caixa_nao_cobre') {
    // Fecha sozinho quando o saldo volta a cobrir; "Ciente" tira daqui até amanhã (se ainda não cobrir).
    add('ver', <button onClick={() => abrir(t, '/financeiro?tab=painel')} className={PRINCIPAL}><i className="ri-calendar-check-line" /> Ver o que vence</button>);
    add('ok', <button disabled={ocupado} onClick={() => rodar(() => marcar(p.id, 'resolvida', 'ciente pela tela Hoje'))} className={LINK}>Ciente — me lembre amanhã</button>);
  } else if (p.kind === 'insumo_antes_do_pico') {
    // Fecha sozinho quando a entrada é registrada (o estoque passa a chegar ao pico) ou o pico passa.
    add('ver', <button onClick={() => abrir(t, '/estoque')} className={PRINCIPAL}><i className="ri-shopping-cart-2-line" /> Ver o que comprar</button>);
    add('feito', <button disabled={ocupado} onClick={() => rodar(() => marcar(p.id, 'resolvida', 'comprou ou produziu (tela Hoje)'))} className={SECUNDARIO}><i className="ri-check-line" /> Já comprei / produzi</button>);
  } else if (p.rota) {
    add('abrir', <button onClick={() => abrir(t, p.kind === 'conta_atrasada' ? '/financeiro?tab=contas-vencidas' : p.rota as string)} className={PRINCIPAL}>
      <i className="ri-arrow-right-up-line" /> Abrir e resolver
    </button>);
  }
  // Abrir na tela, quando o principal resolve aqui (classificar, contas): para quem prefere a tela grande.
  if ((p.kind === 'item_sem_classe' || p.kind === 'conta_sem_dre') && dono && p.rota) {
    add('tela', <button onClick={() => abrir(t, p.rota as string)} className={SECUNDARIO}>Abrir na tela</button>);
  }
  // Saída para o que exige ação e não tem saída própria; aviso sem ação → Ciente (volta se piorar).
  // Os tipos que o chat resolve no cartão (sangria, boleto por e-mail, compra pelo celular…) têm saídas
  // próprias — aqui não ganham "Não vou fazer" (descartar fecha para sempre; revisão 2026-10-03).
  if (item.tipo === 'pendencia' && !SEM_DESCARTE.has(p.kind)) {
    if (!p.acaoRequerida) add('ok', <button disabled={ocupado} onClick={() => rodar(() => marcar(p.id, 'vista'))} className={LINK}>Ciente — me avise se piorar</button>);
    else add('nao', <button onClick={naoVouFazer} className={LINK}>Não vou fazer</button>);
  }

  // ── Linha "por que está aqui" ──────────────────────────────────────────────────
  const porQue = item.pedidoHaDias != null
    ? (item.pedidoHaDias >= 3 ? `Boleto pedido há ${item.pedidoHaDias} dias e ainda não chegou.` : `Boleto pedido ${item.pedidoHaDias === 0 ? 'hoje' : item.pedidoHaDias === 1 ? 'ontem' : `há ${item.pedidoHaDias} dias`} — esperando o fornecedor.`)
    : item.tipo === 'contas_vencidas' && item.juntas.length
      ? `${item.juntas.length} ${item.juntas.length === 1 ? 'delas está' : 'delas estão'} sem boleto no sistema. Se já pagou, é só dar baixa.`
      : item.detalhe;
  const borda = item.bloco !== 'agora' ? 'border-zinc-200' : prazo?.tom === 'red' || item.urgente ? 'border-red-200 border-l-4 border-l-red-500' : 'border-amber-200 border-l-4 border-l-amber-400';

  return (
    <div className={`rounded-2xl border bg-white ${compacto ? 'px-3.5 py-3' : 'px-4 py-3.5'} ${borda}`}>
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl ${cfg.corBg}`}>
          <i className={`${cfg.icone} ${cfg.corTexto} text-lg`} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-semibold leading-tight">
            {mostrarLoja && item.loja && <span className="px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 uppercase tracking-wide text-[10px] font-bold">{item.loja}</span>}
            <span className={cfg.corTexto}>{cfg.label}</span>
            {prazo && <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${prazo.tom === 'red' ? 'bg-red-50 text-red-600' : prazo.tom === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-zinc-100 text-zinc-500'}`}>{prazo.texto}</span>}
          </p>
          <div className="flex items-baseline justify-between gap-3 mt-1">
            <p className="text-[15px] font-bold text-zinc-900 leading-snug">{item.tipo === 'pendencia' && p.kind === 'boleto_faltando' ? semPrefixo(item.titulo).replace(/\s+—\s+R\$.*$/, '') : item.titulo.replace(/\s+—\s+R\$\s*[\d.,]+(\s+\S+)?$/, '')}</p>
            {item.valor != null && item.valor > 0 && <span className="text-[15px] font-bold text-zinc-900 tabular-nums whitespace-nowrap">{brl(item.valor)}</span>}
          </div>
          {porQue && <p className="text-[13px] text-zinc-500 leading-snug mt-0.5 line-clamp-3">{porQue}</p>}
          {item.porcao && <LinhaPorcao porcao={item.porcao} hoje={hoje} urgente={item.bloco === 'agora'} />}
        </div>
      </div>

      {erro && <p className="mt-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{erro}</p>}

      {motivo !== null ? (
        <form className="flex gap-2 mt-3" onSubmit={(e) => {
          e.preventDefault();
          const m = motivo.trim();
          if (!m) return;
          rodar(async () => { await marcar(p.id, 'descartada', m); setMotivo(null); });
        }}>
          <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={p.kind === 'boleto_faltando' ? 'Como é pago? (Pix, débito, acerto…)' : 'Por que não vai fazer?'}
            className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-amber-400" />
          <button type="submit" disabled={ocupado || !motivo.trim()} className={`${BTN} bg-zinc-800 text-white`}>OK</button>
          <button type="button" onClick={() => setMotivo(null)} className="w-10 h-10 rounded-xl text-zinc-400 cursor-pointer" aria-label="Cancelar"><i className="ri-close-line" /></button>
        </form>
      ) : botoes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3 sm:pl-12">{botoes}</div>
      )}

      {/* ── O que abre dentro do cartão ── */}
      {aberto === 'contas' && (
        <div className="sm:pl-12">
          <ContasAtrasadasInline tenantId={t} soHoje={p.kind === 'conta_vence_hoje'}
            onPagarConta={dono ? async (billId) => { pedirAoChat({ tipo: 'pagar_conta', billId }); } : undefined}
            onAbrir={(billId) => abrir(t, `/financeiro?tab=contas-vencidas&foco=${encodeURIComponent(billId)}`)}
            onMudou={onMudou} />
        </div>
      )}
      {aberto === 'baixa' && bill && (
        <div className="sm:pl-12">
          <BaixaDaConta tenantId={t} billId={bill} onCancelar={() => setAberto(null)}
            onFeito={() => rodar(async () => { setAberto(null); await marcar(p.id, 'resolvida', 'conta paga (baixa pela tela Hoje)'); })} />
        </div>
      )}
      {aberto === 'baixas' && (
        <div className="sm:pl-12 mt-2 space-y-2">
          {item.juntas.map((j) => <BaixaJunta key={j.id} p={j} hoje={hoje} marcar={marcar} onMudou={onMudou} />)}
        </div>
      )}
      {aberto === 'itens' && (
        <div className="sm:pl-12">
          <ItensClassificarCard call={chamarAssistente} tenantId={t} abertoInicial onFeito={onMudou} onTudo={() => { setAberto(null); onMudou(); }} />
        </div>
      )}
      {aberto === 'dre' && (
        <div className="sm:pl-12">
          <ContasDreInline call={chamarAssistente} tenantId={t} onFeito={onMudou} onTudo={() => { setAberto(null); onMudou(); }} />
        </div>
      )}
    </div>
  );
}

/** Uma conta dentro do cartão do fornecedor: valor, vencimento e "Já paguei — dar baixa". */
function BaixaJunta({ p, hoje, marcar, onMudou }: { p: PendHoje; hoje: string; marcar: CartaoProps['marcar']; onMudou: () => void }) {
  const [aberta, setAberta] = useState(false);
  const bill = typeof p.payload?.bill_id === 'string' ? p.payload.bill_id : null;
  const venc = typeof p.payload?.vencimento === 'string' ? p.payload.vencimento : '';
  const valor = Number(p.payload?.valor ?? 0);
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-zinc-700"><b className="tabular-nums">{brl(valor)}</b> · {p.payload?.vencida ? 'venceu' : 'vence'} {venc}</p>
        {bill && <button onClick={() => setAberta((a) => !a)} className="text-xs font-bold text-amber-700 cursor-pointer">{aberta ? 'Fechar' : 'Já paguei'}</button>}
      </div>
      {aberta && bill && (
        <BaixaDaConta tenantId={p.tenantId} billId={bill} onCancelar={() => setAberta(false)}
          onFeito={async () => { setAberta(false); await marcar(p.id, 'resolvida', 'conta paga (baixa pela tela Hoje)').catch(() => {}); onMudou(); }} />
      )}
      {!bill && <p className="text-[11px] text-zinc-400 mt-0.5">{hoje && 'Abra a compra para dar baixa.'}</p>}
    </div>
  );
}

/** Trabalho acumulado em porções (2026-10-03): a de hoje, quanto andou e quando termina nesse ritmo. */
// urgente = o cartão está em "Agora" (nota com boleto vencido ou vencendo): a porção ajuda a começar,
// mas o texto não diz que o resto pode esperar.
function LinhaPorcao({ porcao, hoje, urgente }: { porcao: Porcao; hoje: string; urgente: boolean }) {
  const faltaHoje = Math.max(0, porcao.meta - porcao.feitos);
  const depoisDeHoje = Math.max(0, porcao.restante - faltaHoje);
  const diasDepois = Math.ceil(depoisDeHoje / porcao.meta);
  const fim = new Date(`${hoje}T12:00:00Z`);
  fim.setUTCDate(fim.getUTCDate() + diasDepois);
  const termina = diasDepois === 0 ? 'hoje' : diasDepois === 1 ? 'amanhã' : diasDepois <= 6 ? DIAS[fim.getUTCDay()] : ddmm(fim.toISOString().slice(0, 10));
  const pct = Math.min(100, Math.round((porcao.feitos / porcao.meta) * 100));
  return (
    <div className={`mt-2 rounded-xl px-3 py-2 ${porcao.feita ? 'bg-emerald-50 border border-emerald-100' : 'bg-amber-50/60 border border-amber-100'}`}>
      {porcao.feita ? (
        <p className="text-[12px] font-semibold text-emerald-800">
          <i className="ri-check-line" /> Porção de hoje feita ({porcao.feitos}). {porcao.restante === 0 ? 'Acabou!'
            : urgente ? `Ainda ${porcao.restante === 1 ? 'falta 1, com boleto vencido ou vencendo' : `faltam ${porcao.restante}, com boleto vencido ou vencendo`} — se der, adiante mais.`
            : `Faltam ${porcao.restante} — no ritmo, termina ${termina}.`}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="font-semibold text-amber-900">Porção de hoje: {porcao.meta}</span>
            <span className="text-amber-800 tabular-nums">já foram {porcao.feitos} de {porcao.meta}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-amber-100 overflow-hidden"><div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-[11px] text-amber-800">Um pouco por dia: no ritmo, termina {termina}. {urgente ? 'Comece pelas mais antigas.' : 'O resto não precisa ser hoje.'}</p>
        </>
      )}
    </div>
  );
}

