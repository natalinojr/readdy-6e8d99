// Painéis inline dos botões da Trilha (fase 2). Cada um mostra o que vai acontecer ANTES do botão
// que grava; nada que mexa em dinheiro sai com 1 clique (pagar sempre passa por conferência + PIN).
import { useEffect, useState, type ReactNode } from 'react';
import { diaBR, type CasoTrilha, type TrConta, type TrExtrato } from '@/lib/trilhaDespesas';
import { diasAtraso, dividirParcelas, linkWhatsApp, somaFecha, vencimentosPadrao } from '@/lib/trilhaAcoes';
import {
  assistente, conciliacao, purchaseWrite,
  type BoletoInfo, type PagamentoInter, type ResultadoLinha,
} from './api';
import { fmtBRL, type AcoesTrilha } from './comum';
import { supabase } from '@/lib/supabase';

const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));
const BTN = 'text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_OK = `${BTN} bg-emerald-500 text-white hover:bg-emerald-600`;
const BTN_LEVE = `${BTN} bg-white border border-zinc-300 text-zinc-700 hover:bg-zinc-50`;

export function Painel({ titulo, children, cor = 'zinc' }: { titulo: string; children: ReactNode; cor?: 'zinc' | 'red' | 'amber' }) {
  const cls = cor === 'red' ? 'border-red-200 bg-white' : cor === 'amber' ? 'border-amber-200 bg-white' : 'border-zinc-200 bg-white';
  return (
    <div className={`mt-2 rounded-lg border ${cls} p-3 space-y-2`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{titulo}</p>
      {children}
    </div>
  );
}
const Erro = ({ msg }: { msg: string | null }) => (msg ? <p className="text-xs text-red-600 break-words"><i className="ri-error-warning-line" /> {msg}</p> : null);

// ── 1. Sugestão do "Dizer o que foi" ────────────────────────────────────────
export function SugestaoExtrato({ extrato, acoes }: { extrato: TrExtrato; acoes: AcoesTrilha }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const confirmar = async () => {
    setOcupado(true); setErro(null);
    try {
      const r = await conciliacao<{ results?: ResultadoLinha[] }>(acoes.tenantId, 'confirm', { ids: [extrato.id] });
      const res = r.results?.[0];
      if (!res?.ok) throw new Error(res?.msg || 'A Conciliação não confirmou essa sugestão.');
      await acoes.concluir(`Confirmou: ${extrato.sugestao}`, async () => {
        const u = await conciliacao<{ results?: ResultadoLinha[] }>(acoes.tenantId, 'undo', { id: extrato.id });
        if (u.results?.[0] && !u.results[0].ok) throw new Error(u.results[0].msg);
      });
    } catch (e) { setErro(msgErro(e)); setOcupado(false); }
  };
  return (
    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
      <p className="text-xs text-emerald-900"><i className="ri-lightbulb-flash-line" /> <strong>Sugestão</strong> — {extrato.sugestao}</p>
      <p className="text-[11px] text-zinc-500 mt-0.5">
        Saída de {fmtBRL(Math.abs(Number(extrato.amount)))} em {diaBR(extrato.transaction_date)}{extrato.counterpart_name ? ' · ' + extrato.counterpart_name : ''}.
        Confirmar faz esse lançamento na Conciliação; dá para desfazer em "Resolvido agora".
      </p>
      <div className="mt-2"><button onClick={() => void confirmar()} disabled={ocupado} className={BTN_OK}><i className="ri-check-line" /> {ocupado ? 'Confirmando…' : 'Confirmar'}</button></div>
      <Erro msg={erro} />
    </div>
  );
}

// ── 2. Pagar uma conta vencida (conferência + PIN) ──────────────────────────
type FasePag = 'conferir' | 'preparando' | 'pin' | 'enviando' | 'feito' | 'falhou';
export function PagarConta({ conta, boleto, acoes, onFechar }: { conta: TrConta; boleto: BoletoInfo | undefined; acoes: AcoesTrilha; onFechar: () => void }) {
  const [fase, setFase] = useState<FasePag>('conferir');
  const [pay, setPay] = useState<PagamentoInter | null>(null);
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const saldo = Number(conta.amount || 0) - Number(conta.paid_amount || 0);
  const dias = diasAtraso(String(conta.due_date ?? ''), acoes.hoje);

  const preparar = async () => {
    setErro(null); setFase('preparando');
    try {
      const out = await assistente<{ payment: PagamentoInter }>('conta_pagar', { bill_id: conta.id });
      setPay(out.payment);
      if (['draft', 'awaiting_pin'].includes(out.payment.status)) setFase('pin');
      else { setErro(out.payment.error ?? out.payment.status_label ?? 'O Inter não deixou preparar esse pagamento.'); setFase('falhou'); }
    } catch (e) { setErro(msgErro(e)); setFase('falhou'); }
  };
  const pagar = async () => {
    if (!pay) return;
    if (!/^\d{4,8}$/.test(pin)) { setErro('O PIN tem de 4 a 8 números.'); return; }
    setErro(null); setFase('enviando');
    try {
      const out = await assistente<{ payment: PagamentoInter }>('pay', { id: pay.id, op: 'ok', pin });
      setPay(out.payment);
      setFase(['rejected', 'failed', 'expired'].includes(out.payment.status) ? 'falhou' : 'feito');
      if (!['rejected', 'failed', 'expired'].includes(out.payment.status)) await acoes.concluir(`Pagou ${conta.supplier ?? conta.description ?? 'a conta'} pelo Inter`);
    } catch (e) {
      const m = msgErro(e); setPin('');
      // PIN errado: tenta de novo aqui mesmo; qualquer outro erro encerra
      if (/PIN errado/i.test(m) && !/Bloqueado/i.test(m)) { setErro(m); setFase('pin'); return; }
      setErro(m); setFase('falhou');
    }
  };
  const desfazerBoleto = async () => {
    setErro(null);
    try { await assistente('conta_desfazer_boleto', { bill_id: conta.id }); await acoes.recarregar(); onFechar(); } catch (e) { setErro(msgErro(e)); }
  };

  return (
    <Painel titulo="Confira antes de pagar" cor="red">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-zinc-400">Conta</dt><dd className="font-semibold text-zinc-800 break-words">{conta.supplier ?? conta.description}</dd>
        <dt className="text-zinc-400">Vencimento</dt><dd>{diaBR(conta.due_date)} · {dias} {dias === 1 ? 'dia' : 'dias'} de atraso</dd>
        <dt className="text-zinc-400">Valor da conta</dt><dd className="font-semibold">{fmtBRL(saldo)}</dd>
        <dt className="text-zinc-400">Documento</dt><dd>{boleto?.boleto_digitavel || boleto?.boleto_barcode ? 'boleto guardado' : 'Pix copia e cola guardado'}</dd>
        <dt className="text-zinc-400">Sai de</dt><dd>conta bancária Inter</dd>
      </dl>
      <p className="text-[11px] text-zinc-500">Multa e juros são calculados pelo Inter na hora do pagamento — o valor final aparece no próximo passo.</p>
      {fase === 'conferir' && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void preparar()} className={BTN_OK}><i className="ri-bank-line" /> Preparar pagamento</button>
          {boleto?.boleto_origem === 'erpos' && <button onClick={() => void desfazerBoleto()} className={BTN_LEVE}>Tirar o boleto guardado</button>}
        </div>
      )}
      {fase === 'preparando' && <p className="text-xs text-zinc-500"><i className="ri-loader-4-line animate-spin" /> Preparando no Inter…</p>}
      {(fase === 'pin' || fase === 'enviando') && pay && (
        <form onSubmit={(e) => { e.preventDefault(); void pagar(); }} className="space-y-2 rounded-lg bg-zinc-50 border border-zinc-200 p-2.5">
          <p className="text-sm font-bold text-zinc-900">Valor final: {fmtBRL(Number(pay.amount ?? saldo))}
            {pay.face_value != null && Math.abs(Number(pay.face_value) - Number(pay.amount)) > 0.009 && <span className="text-[11px] font-normal text-zinc-500"> (o boleto diz {fmtBRL(Number(pay.face_value))}; a diferença é multa e juros)</span>}
          </p>
          {pay.beneficiary_name && <p className="text-[11px] text-zinc-500">Para: {pay.beneficiary_name}</p>}
          <label className="block text-[11px] font-semibold text-zinc-600">Confirme com o seu PIN</label>
          <input type="password" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={8} value={pin} disabled={fase === 'enviando'}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErro(null); }}
            className="w-32 text-center tracking-[0.4em] text-lg font-bold border-2 border-zinc-200 focus:border-emerald-400 rounded-xl py-1.5 outline-none" />
          <div><button type="submit" disabled={fase === 'enviando' || pin.length < 4} className={BTN_OK}>
            {fase === 'enviando' ? 'Enviando ao Inter…' : <><i className="ri-lock-2-line" /> Pagar {fmtBRL(Number(pay.amount ?? saldo))}</>}
          </button></div>
        </form>
      )}
      {fase === 'feito' && (
        <p className="text-xs text-emerald-800 bg-emerald-50 rounded-lg px-2.5 py-2">
          {pay?.status === 'paid' ? 'Pago. A baixa da conta sai sozinha pelo extrato.' : 'Enviado ao Inter — falta aprovar no app do Inter. Depois a baixa sai sozinha pelo extrato.'}
        </p>
      )}
      <Erro msg={erro} />
      {fase === 'falhou' && <button onClick={() => { setFase('conferir'); setErro(null); }} className={BTN_LEVE}>Tentar de novo</button>}
    </Painel>
  );
}

// ── 3. Falta o jeito de pagar (guardar boleto / Pix) ────────────────────────
export function FaltaJeitoDePagar({ conta, acoes, onPedir }: { conta: TrConta; acoes: AcoesTrilha; onPedir: () => void }) {
  const [linha, setLinha] = useState('');
  const [copia, setCopia] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conf, setConf] = useState<{ valor_boleto: number | null; valor_conta: number; corpo: Record<string, unknown> } | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  const guardar = async (corpo: Record<string, unknown>) => {
    setOcupado(true); setErro(null);
    try {
      const r = await assistente<{ precisa_confirmar?: boolean; valor_boleto?: number | null; valor_conta?: number; avisos?: string[] }>('conta_guardar_boleto', { bill_id: conta.id, ...corpo });
      if (r.precisa_confirmar) { setConf({ valor_boleto: r.valor_boleto ?? null, valor_conta: Number(r.valor_conta), corpo }); setOcupado(false); return; }
      setAvisos(r.avisos ?? []);
      setConf(null);
      await acoes.recarregar();
    } catch (e) { setErro(msgErro(e)); }
    setOcupado(false);
  };

  return (
    <Painel titulo="Falta o jeito de pagar" cor="amber">
      <p className="text-[11px] text-zinc-500">Sem o boleto ou o Pix desta conta não dá para pagar pelo Inter. Cole um dos dois — o número é conferido antes de guardar.</p>
      <label className="block text-[11px] font-semibold text-zinc-600">Linha digitável do boleto</label>
      <textarea value={linha} onChange={(e) => setLinha(e.target.value)} rows={2} placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000"
        className="w-full text-xs border border-zinc-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400" />
      <button disabled={ocupado || !linha.trim()} onClick={() => void guardar({ linha: linha.trim() })} className={BTN_OK}>Guardar boleto</button>
      <label className="block text-[11px] font-semibold text-zinc-600 pt-1">ou Pix copia e cola</label>
      <textarea value={copia} onChange={(e) => setCopia(e.target.value)} rows={2} placeholder="00020126…"
        className="w-full text-xs border border-zinc-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400" />
      <button disabled={ocupado || !copia.trim()} onClick={() => void guardar({ copia_e_cola: copia.trim() })} className={BTN_OK}>Guardar Pix</button>
      {conf && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 space-y-1.5">
          <p>O documento é de <strong>{conf.valor_boleto != null ? fmtBRL(conf.valor_boleto) : '—'}</strong> e a conta é de <strong>{fmtBRL(conf.valor_conta)}</strong>. Pode ser o boleto de outra parcela. Guardar mesmo assim?</p>
          <button disabled={ocupado} onClick={() => void guardar({ ...conf.corpo, confirmar_valor: true })} className={BTN_OK}>Guardar com valor diferente</button>
        </div>
      )}
      {avisos.map((a) => <p key={a} className="text-[11px] text-amber-800">{a}</p>)}
      <Erro msg={erro} />
      <p className="text-[11px] text-zinc-500 border-t border-zinc-100 pt-2">A chave Pix do fornecedor só se cadastra pela tela de Fornecedores (o Inter só paga Pix para quem está lá).</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => acoes.rota('/financeiro?tab=compras')} className={BTN_LEVE}><i className="ri-store-2-line" /> Abrir Fornecedores</button>
        <button onClick={onPedir} className={BTN_LEVE}><i className="ri-mail-send-line" /> Pedir o boleto…</button>
      </div>
    </Painel>
  );
}

// ── 4. Pedir o boleto ao fornecedor ─────────────────────────────────────────
interface Pedido { fornecedor: string | null; telefone: string | null; email: string | null; pedido_em: string | null; pedidos: number; mensagem: string }
export function PedirBoleto({ conta, acoes, onPedido, jaPedido }: { conta: TrConta; acoes: AcoesTrilha; onPedido: (em: string | null) => void; jaPedido: string | null }) {
  const [ped, setPed] = useState<Pedido | null>(null);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const preparar = async () => {
    setOcupado(true); setErro(null);
    try {
      const r = await assistente<Pedido>('conta_pedir_boleto', { bill_id: conta.id });
      setPed(r); setTexto(r.mensagem); onPedido(r.pedido_em);
    } catch (e) { setErro(msgErro(e)); }
    setOcupado(false);
  };
  const wa = ped?.telefone ? linkWhatsApp(ped.telefone, texto) : null;
  const copiar = async () => { try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { setErro('Não consegui copiar — selecione o texto e copie.'); } };
  return (
    <Painel titulo="Pedir o boleto" cor="amber">
      {!ped && (
        <>
          <p className="text-[11px] text-zinc-500">O sistema não manda a mensagem por você: ele monta o texto e você envia pelo seu WhatsApp ou e-mail. {jaPedido ? `Já foi pedido em ${diaBR(jaPedido)}.` : ''}</p>
          <button onClick={() => void preparar()} disabled={ocupado} className={BTN_OK}>{ocupado ? 'Preparando…' : jaPedido ? 'Preparar mensagem de novo' : 'Preparar mensagem'}</button>
        </>
      )}
      {ped && (
        <>
          <p className="text-xs text-zinc-700">Para: <strong>{ped.fornecedor ?? conta.supplier ?? '—'}</strong>{ped.telefone ? ` · WhatsApp ${ped.telefone}` : ''}{ped.email ? ` · ${ped.email}` : ''}</p>
          {!ped.telefone && !ped.email && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2 py-1.5">Esse fornecedor não tem telefone nem e-mail no cadastro. Cadastre em Fornecedores e volte aqui.</p>
          )}
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} className="w-full text-xs border border-zinc-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400" />
          <div className="flex flex-wrap gap-2">
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className={`${BTN_OK} inline-block`}><i className="ri-whatsapp-line" /> Abrir no WhatsApp</a>}
            {ped.email && <a href={`mailto:${ped.email}?subject=${encodeURIComponent('Boleto em aberto')}&body=${encodeURIComponent(texto)}`} className={`${BTN_LEVE} inline-block`}><i className="ri-mail-line" /> Abrir e-mail</a>}
            <button onClick={() => void copiar()} className={BTN_LEVE}><i className="ri-file-copy-line" /> {copiado ? 'Copiado' : 'Copiar'}</button>
            {!ped.telefone && !ped.email && <button onClick={() => acoes.rota('/financeiro?tab=compras')} className={BTN_LEVE}>Abrir Fornecedores</button>}
          </div>
        </>
      )}
      <Erro msg={erro} />
    </Painel>
  );
}

// ── 5. Criar a conta a pagar que falta ──────────────────────────────────────
export function CriarConta({ caso, acoes }: { caso: CasoTrilha; acoes: AcoesTrilha }) {
  const compra = caso.compra!;
  const total = Number(compra.total_amount);
  const dataBase = String(compra.purchase_date ?? caso.data).slice(0, 10);
  const [n, setN] = useState(1);
  const [venc, setVenc] = useState<string[]>(() => vencimentosPadrao(dataBase, 1));
  const [vals, setVals] = useState<string[]>(() => dividirParcelas(total, 1).map(String));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mudarN = (novo: number) => {
    const q = Math.min(24, Math.max(1, Math.floor(novo) || 1));
    setN(q); setVenc(vencimentosPadrao(dataBase, q)); setVals(dividirParcelas(total, q).map(String));
  };
  const nums = vals.map((v) => Number(String(v).replace(',', '.')));
  const fecha = somaFecha(nums, total);
  const datasOk = venc.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const somaAtual = nums.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const podeCriar = fecha && datasOk && nums.every((v) => v > 0);

  const criar = async () => {
    setOcupado(true); setErro(null);
    try {
      const parcelas = venc.map((due_date, i) => ({ due_date, amount: nums[i] }));
      const r = await purchaseWrite<{ bill_ids?: string[] }>(acoes.tenantId, 'create_missing_bills', { purchase_id: compra.id, parcelas });
      const ids = r.bill_ids ?? [];
      await acoes.concluir(`Criou a conta a pagar de ${caso.titulo}`, async () => {
        await purchaseWrite(acoes.tenantId, 'delete_missing_bills', { purchase_id: compra.id, bill_ids: ids });
      });
    } catch (e) { setErro(msgErro(e)); setOcupado(false); }
  };

  return (
    <Painel titulo="Criar a conta a pagar" cor="red">
      <p className="text-[11px] text-zinc-500">Total da compra: <strong>{fmtBRL(total)}</strong>. As parcelas têm de somar esse valor.</p>
      <label className="flex items-center gap-2 text-xs text-zinc-600">Parcelas
        <input type="number" min={1} max={24} value={n} onChange={(e) => mudarN(Number(e.target.value))} className="w-16 border border-zinc-200 rounded-lg px-2 py-1 text-xs" />
      </label>
      <div className="space-y-1.5">
        {venc.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-16 text-zinc-400">Parcela {i + 1}</span>
            <input type="date" value={d} onChange={(e) => setVenc((v) => v.map((x, k) => (k === i ? e.target.value : x)))} className="border border-zinc-200 rounded-lg px-2 py-1" />
            <input type="number" step="0.01" min="0" value={vals[i]} onChange={(e) => setVals((v) => v.map((x, k) => (k === i ? e.target.value : x)))} className="w-28 border border-zinc-200 rounded-lg px-2 py-1" />
          </div>
        ))}
      </div>
      {!fecha && <p className="text-xs text-red-600">A soma das parcelas ({fmtBRL(somaAtual)}) não fecha com o total da compra ({fmtBRL(total)}).</p>}
      {podeCriar && (
        <p className="text-[11px] text-zinc-600 bg-zinc-50 rounded-lg px-2 py-1.5">
          Vai criar {n} {n === 1 ? 'conta a pagar' : 'contas a pagar'} para {caso.titulo}: {venc.map((d, i) => `${diaBR(d)} ${fmtBRL(nums[i])}`).join(' · ')}.
        </p>
      )}
      <button onClick={() => void criar()} disabled={!podeCriar || ocupado} className={BTN_OK}>{ocupado ? 'Criando…' : 'Criar conta a pagar'}</button>
      <Erro msg={erro} />
    </Painel>
  );
}

// ── 6. Achar a saída no extrato (conta paga, não achada) ────────────────────
interface Candidato { id: string; transaction_date: string; amount: number; description: string | null; counterpart_name: string | null; dias_diferenca: number }
export function AcharSaida({ conta, caso, acoes }: { conta: TrConta; caso: CasoTrilha; acoes: AcoesTrilha }) {
  const [cands, setCands] = useState<Candidato[] | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    conciliacao<{ candidatos?: Candidato[]; motivo?: string | null }>(acoes.tenantId, 'paid_link_search', { bill_id: conta.id })
      .then((r) => { if (vivo) { setCands(r.candidatos ?? []); setMotivo(r.motivo ?? null); } })
      .catch((e) => { if (vivo) { setErro(msgErro(e)); setCands([]); } });
    return () => { vivo = false; };
  }, [acoes.tenantId, conta.id]);

  const ligar = async (c: Candidato) => {
    setOcupado(true); setErro(null);
    try {
      const r = await conciliacao<{ results?: ResultadoLinha[] }>(acoes.tenantId, 'link_paid', { bill_id: conta.id, statement_id: c.id });
      if (r.results?.[0] && !r.results[0].ok) throw new Error(r.results[0].msg);
      await acoes.concluir(`Ligou a saída de ${caso.titulo} ao extrato`, async () => {
        await conciliacao(acoes.tenantId, 'unlink_paid', { statement_id: c.id });
      });
    } catch (e) { setErro(msgErro(e)); setOcupado(false); }
  };
  const quando = (d: number) => (d === 0 ? 'no mesmo dia' : d > 0 ? `${d} ${d === 1 ? 'dia' : 'dias'} depois` : `${-d} ${d === -1 ? 'dia' : 'dias'} antes`);

  return (
    <Painel titulo="Achar a saída no extrato" cor="amber">
      {cands === null && <p className="text-xs text-zinc-500"><i className="ri-loader-4-line animate-spin" /> Procurando no extrato…</p>}
      {cands?.length === 0 && <p className="text-xs text-zinc-600">{motivo ?? 'Nenhuma saída livre com esse valor.'}</p>}
      {cands?.map((c) => (
        <div key={c.id} className="rounded-lg border border-zinc-200 px-2.5 py-2 text-xs">
          <p className="font-semibold text-zinc-800">{diaBR(c.transaction_date)} · {fmtBRL(c.amount)} · {c.counterpart_name ?? c.description ?? 'saída'}</p>
          <p className="text-[11px] text-zinc-500">mesmo valor, {quando(c.dias_diferenca)} do pagamento</p>
          {escolhido === c.id ? (
            <div className="mt-1.5 space-y-1.5">
              <p className="text-[11px] text-zinc-700 bg-zinc-50 rounded px-2 py-1">Vai ligar essa saída à conta "{conta.description ?? caso.titulo}". A baixa da conta não muda; só o extrato passa a apontar para ela.</p>
              <div className="flex gap-2">
                <button disabled={ocupado} onClick={() => void ligar(c)} className={BTN_OK}>{ocupado ? 'Ligando…' : 'Confirmar ligação'}</button>
                <button disabled={ocupado} onClick={() => setEscolhido(null)} className={BTN_LEVE}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEscolhido(c.id)} className={`${BTN_LEVE} mt-1.5`}>Ligar</button>
          )}
        </div>
      ))}
      <Erro msg={erro} />
      <button onClick={() => acoes.rota('/financeiro?tab=conciliacao')} className={BTN_LEVE}>Abrir na Conciliação</button>
    </Painel>
  );
}

// ── 7. Escolher se entra no estoque (compra recebida com itens ligados que não entraram) ──
// Lista por compra (fn_purchase_unstocked_items); grava por item da Classificação
// (fn_item_stock_late_entry), igual à janela "Fora do estoque" da Classificação de itens.
interface ItemFora {
  purchase_item_id: string; classification_id: string; received_at: string; description: string | null;
  unit_label: string | null; quantidade: number; valor: number; upp: number; insumo: string; insumo_unit: string | null;
  inventario_depois: boolean; inventario_em: string | null;
  /** quanto esta compra já pôs no mesmo insumo (outra linha da nota, com nome diferente) */
  ja_entrou: number;
}
const num3 = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const unid = (u: string | null | undefined) => (!u || u === 'unit' ? 'un' : u);
export function EntrarNoEstoque({ caso, acoes }: { caso: CasoTrilha; acoes: AcoesTrilha }) {
  const compraId = caso.compra!.id;
  const [lista, setLista] = useState<ItemFora[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    supabase.rpc('fn_purchase_unstocked_items', { p_tenant: acoes.tenantId, p_purchase: compraId }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { setErro(error.message); setLista([]); return; }
      setLista((data ?? []) as ItemFora[]);
    });
    return () => { vivo = false; };
  }, [acoes.tenantId, compraId]);

  const itens = lista ?? [];
  const marcados = itens.filter((r) => sel.has(r.purchase_item_id));
  const todos = itens.length > 0 && marcados.length === itens.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const aplicar = async (modo: 'entrar' | 'ignorar') => {
    if (marcados.length === 0) return;
    setOcupado(true); setErro(null);
    try {
      // fn_item_stock_late_entry é por item da Classificação: agrupa os marcados
      const porItem = new Map<string, string[]>();
      for (const r of marcados) porItem.set(r.classification_id, [...(porItem.get(r.classification_id) ?? []), r.purchase_item_id]);
      for (const [cid, ids] of porItem) {
        const { error } = await supabase.rpc('fn_item_stock_late_entry', {
          p_tenant: acoes.tenantId, p_id: cid,
          p_entrar: modo === 'entrar' ? ids : [], p_ignorar: modo === 'ignorar' ? ids : [],
        });
        if (error) throw new Error(error.message);
      }
      const q = marcados.length;
      const restantes = itens.filter((r) => !sel.has(r.purchase_item_id));
      setSel(new Set()); setLista(restantes);
      const rotulo = modo === 'entrar'
        ? `${q} ${q === 1 ? 'item entrou' : 'itens entraram'} no estoque (${caso.titulo})`
        : `${q} ${q === 1 ? 'item marcado' : 'itens marcados'} como "não entra" (${caso.titulo})`;
      if (restantes.length === 0) await acoes.concluir(rotulo);
      else { await acoes.recarregar(); setOcupado(false); }
    } catch (e) { setErro(msgErro(e)); setOcupado(false); }
  };

  return (
    <Painel titulo="Escolher se entra no estoque" cor="red">
      <p className="text-[11px] text-zinc-500">
        Estes itens já estão ligados a um insumo, mas o recebimento foi confirmado antes do vínculo e o estoque não mudou.
        Marque os que devem entrar agora (na data do recebimento). Se a mercadoria já foi usada ou uma contagem já acertou o estoque, marque e escolha <b>Não entram</b>.
      </p>
      {lista === null ? (
        <p className="text-xs text-zinc-400">Carregando…</p>
      ) : itens.length === 0 ? (
        <p className="text-xs text-zinc-500">Nenhum item desta compra está esperando entrada no estoque.</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
            <input type="checkbox" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(itens.map((r) => r.purchase_item_id)))} />
            Marcar todos ({itens.length})
          </label>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {itens.map((r) => (
              <label key={r.purchase_item_id}
                className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 cursor-pointer ${sel.has(r.purchase_item_id) ? 'border-amber-300 bg-amber-50/60' : 'border-zinc-200 hover:border-zinc-300'}`}>
                <input type="checkbox" className="mt-0.5" checked={sel.has(r.purchase_item_id)} onChange={() => toggle(r.purchase_item_id)} />
                <div className="min-w-0 flex-1 text-xs">
                  <p className="text-zinc-800 break-words">{r.description ?? '—'}</p>
                  <p className="text-zinc-500">
                    {num3(Number(r.quantidade))} {r.unit_label || 'un'} · {fmtBRL(Number(r.valor))} →{' '}
                    <span className="text-emerald-700">+{num3(Number(r.quantidade) * Number(r.upp))} {unid(r.insumo_unit)} em {r.insumo}</span>
                  </p>
                  {Number(r.ja_entrou) > 0 && (
                    <p className="text-[11px] text-sky-700 mt-0.5">
                      <i className="ri-information-line" /> Outra linha desta nota já pôs +{num3(Number(r.ja_entrou))} {unid(r.insumo_unit)} em {r.insumo} (é essa que aparece na movimentação). Esta linha é outra quantidade e ainda não entrou.
                    </p>
                  )}
                  {r.inventario_depois && (
                    <p className="text-[11px] text-orange-700 mt-0.5">
                      <i className="ri-error-warning-line" /> Teve contagem deste insumo depois{r.inventario_em ? ` (${diaBR(r.inventario_em)})` : ''}: o estoque já foi acertado. Dar entrada agora conta em dobro.
                    </p>
                  )}
                </div>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void aplicar('entrar')} disabled={ocupado || marcados.length === 0} className={BTN_OK}>
              {ocupado ? 'Salvando…' : `Dar entrada no estoque${marcados.length ? ` (${marcados.length})` : ''}`}
            </button>
            <button onClick={() => void aplicar('ignorar')} disabled={ocupado || marcados.length === 0} className={BTN_LEVE}>Não entram</button>
          </div>
        </>
      )}
      <Erro msg={erro} />
    </Painel>
  );
}

// ── 8. Itens da compra (compra lançada, entrega ainda não confirmada) ──────
interface ItemCompra { id: string; description: string | null; quantity: number; unit_label: string | null; total_price: number; ingredient_id: string | null }
export function ItensDaCompra({ caso, acoes, onConfirmar }: { caso: CasoTrilha; acoes: AcoesTrilha; onConfirmar: () => void }) {
  const compraId = caso.compra!.id;
  const [lista, setLista] = useState<ItemCompra[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    supabase.from('fin_purchase_items').select('id, description, quantity, unit_label, total_price, ingredient_id')
      .eq('tenant_id', acoes.tenantId).eq('purchase_id', compraId).order('description')
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { setErro(error.message); setLista([]); return; }
        setLista((data ?? []) as ItemCompra[]);
      });
    return () => { vivo = false; };
  }, [acoes.tenantId, compraId]);
  const itens = lista ?? [];
  const noEstoque = itens.filter((r) => r.ingredient_id).length;
  return (
    <Painel titulo="Itens da compra" cor="amber">
      {lista === null ? (
        <p className="text-xs text-zinc-400">Carregando…</p>
      ) : itens.length === 0 ? (
        <p className="text-xs text-zinc-500">Esta compra foi lançada sem itens (só o valor).</p>
      ) : (
        <>
          <p className="text-[11px] text-zinc-500">
            {itens.length} {itens.length === 1 ? 'item' : 'itens'}
            {noEstoque > 0 ? ` · ${noEstoque} ligado${noEstoque === 1 ? '' : 's'} a insumo (entra${noEstoque === 1 ? '' : 'm'} no estoque ao confirmar a entrega)` : ' · nenhum ligado a insumo'}
          </p>
          <div className="divide-y divide-zinc-100 max-h-80 overflow-y-auto">
            {itens.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-2 py-1.5 text-xs">
                <div className="min-w-0">
                  <p className="text-zinc-800 break-words">{r.description ?? '—'}</p>
                  <p className="text-zinc-500">
                    {num3(Number(r.quantity))} {r.unit_label || 'un'}
                    {r.ingredient_id
                      ? <span className="text-emerald-700"> · <i className="ri-archive-2-line" /> entra no estoque</span>
                      : <span className="text-zinc-400"> · sem insumo</span>}
                  </p>
                </div>
                <span className="tabular-nums text-zinc-700 whitespace-nowrap">{fmtBRL(Number(r.total_price))}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <Erro msg={erro} />
      <button onClick={onConfirmar} className={BTN_OK}>Chegou — confirmar a entrega</button>
    </Painel>
  );
}
