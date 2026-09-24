// Passo "Como foi pago?" — só para o que ainda não está lançado (nota nova, cupom, sem nota).
// Regra do dono (2026-09-21): mercadoria que chega sem pedido de pagamento foi paga em DINHEIRO
// do caixa — por isso o cupom e o "sem nota" já vêm marcados em dinheiro. Dinheiro vira sangria
// prevista no PDV (o caixa não fecha sem confirmar a retirada).
import type { ReactNode } from 'react';
import { brl, dataBR, hojeISO, somaDias, type Pagamento as Pag } from '../api';
import type { Rascunho } from '../rascunho';
import { Comprovante, Texto } from '../pedidos/ui';

interface Props {
  r: Rascunho;
  onMudar: (patch: Partial<Rascunho>) => void;
  onContinuar: () => void;
  /** Tem 'pag_reembolso': mostra "Paguei do meu bolso" (vira pedido de reembolso ligado à compra). */
  reembolso?: { nome: string; pix: string } | null;
  /** Só tem 'pag_reembolso' (não recebe mercadoria): as outras formas dariam "sem permissão" no fim. */
  soReembolso?: boolean;
}

const FORMAS_PAGAS = ['PIX', 'Cartão Débito', 'Transferência']; // crédito: o extrato só traz a fatura, a conta nunca baixaria

function Opcao({ ativo, onClick, icone, titulo, sub, children }: { ativo: boolean; onClick: () => void; icone: string; titulo: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`rounded-3xl border-2 transition-colors ${ativo ? 'border-amber-400 bg-amber-50/60' : 'border-zinc-100 bg-white'}`}>
      <button onClick={onClick} className="w-full text-left p-4 flex items-start gap-3 cursor-pointer">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${ativo ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
          <i className={`${icone} text-xl`} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[15px] font-bold text-zinc-800">{titulo}</p>
          {sub && <div className="text-sm text-zinc-500 mt-0.5">{sub}</div>}
        </div>
        <i className={`${ativo ? 'ri-radio-button-line text-amber-500' : 'ri-checkbox-blank-circle-line text-zinc-300'} text-xl mt-2`} />
      </button>
      {ativo && children && <div className="px-4 pb-4 -mt-1">{children}</div>}
    </div>
  );
}

function Chips({ opcoes, valor, onValor }: { opcoes: { v: string; label: string }[]; valor: string; onValor: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {opcoes.map((o) => (
        <button
          key={o.v}
          onClick={() => onValor(o.v)}
          className={`px-3.5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer ${valor === o.v ? 'bg-amber-500 text-white' : 'bg-white border border-zinc-200 text-zinc-600'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function pagamentoValido(r: Rascunho): boolean {
  if (!r.pagamento) return false;
  if (r.pagamento === 'a_pagar') return /^\d{4}-\d{2}-\d{2}$/.test(r.vencimento);
  if (r.pagamento === 'reembolso') {
    const e = r.reembolso;
    // Cupom lido na SEFAZ (chave de 44 dígitos) já é o comprovante
    return !!e && !!e.nome.trim() && !!e.pix.trim() && (!!e.foto || (r.chave ?? '').replace(/\D/g, '').length === 44);
  }
  return true;
}

export function descreverPagamento(r: Rascunho): string {
  if (r.pagInfo?.ja_definido) {
    const p = r.pagInfo;
    if (p.bonificacao) return 'Bonificação (sem custo)';
    const venc = (p.vencimentos ?? []).filter((v) => v.status !== 'paid');
    if (p.pago) return `${p.forma ?? 'Pago'} (já pago)`;
    return venc.length ? `${p.forma ?? 'A pagar'} · vence ${venc.map((v) => dataBR(v.vencimento)).join(', ')}` : p.forma ?? 'A pagar';
  }
  switch (r.pagamento) {
    case 'nota': {
      const ps = r.pagInfo?.parcelas ?? [];
      return ps.length ? `Boleto · ${ps.map((p) => dataBR(p.vencimento)).join(', ')}` : 'Financeiro paga depois';
    }
    case 'dinheiro': return 'Dinheiro do caixa (sangria prevista no PDV)';
    case 'pago': return `Já pago · ${r.forma} (o extrato confirma)`;
    case 'a_pagar': return `A pagar · ${r.forma === 'Boleto' ? 'Boleto' : 'PIX'} · vence ${dataBR(r.vencimento)}`;
    case 'bonificacao': return 'Bonificação (sem custo)';
    case 'reembolso': return `Paguei do bolso · reembolso para ${r.reembolso?.nome ?? '—'} (o dono aprova)`;
    default: return '—';
  }
}

export default function Pagamento({ r, onMudar, onContinuar, reembolso, soReembolso }: Props) {
  const nota = r.origem === 'nota';
  const soBoleto = (nota && !!r.pagInfo?.so_boleto) || !!soReembolso;
  const bonificacaoOk = !nota || r.pagInfo?.bonificacao_ok !== false;
  const parcelas = r.pagInfo?.parcelas ?? [];
  const formasNota = r.pagInfo?.formas ?? [];
  const escolher = (p: Pag) => onMudar({ pagamento: p, ...(p === 'pago' && !FORMAS_PAGAS.includes(r.forma) ? { forma: 'PIX' } : {}), ...(p === 'a_pagar' && !['Boleto', 'PIX'].includes(r.forma) ? { forma: 'Boleto' } : {}) });
  const hoje = hojeISO();

  return (
    <div className="pb-28 px-4 pt-4 space-y-3">
      <div className="px-1 mb-1">
        <p className="text-xl font-bold text-zinc-900">Como foi pago?</p>
        <p className="text-sm text-zinc-500">{r.fornecedor} · {brl(r.valor || r.itens.reduce((t, i) => t + i.valor_total, 0))}</p>
        {nota && formasNota.length > 0 && (
          <p className="text-xs text-zinc-400 mt-1">Na nota está: {formasNota.map((f) => f.forma).join(', ')}</p>
        )}
      </div>

      {nota && (
        <Opcao
          ativo={r.pagamento === 'nota'}
          onClick={() => escolher('nota')}
          icone="ri-bank-card-2-line"
          titulo={parcelas.length ? 'Boleto / a prazo' : 'O financeiro paga depois'}
          sub={parcelas.length
            ? parcelas.map((p, i) => <span key={i} className="block">{parcelas.length > 1 ? `${i + 1}ª ` : ''}vence {dataBR(p.vencimento)} · {brl(p.valor)}</span>)
            : 'Vai para Contas a Pagar'}
        />
      )}

      {soBoleto && !soReembolso && (
        <p className="text-sm text-zinc-500 px-1">Essa nota tem boleto. Se foi pago de outro jeito, avise o financeiro — só ele muda a forma de pagamento.</p>
      )}

      {!soBoleto && <Opcao
        ativo={r.pagamento === 'dinheiro'}
        onClick={() => escolher('dinheiro')}
        icone="ri-money-dollar-box-line"
        titulo="Paguei em dinheiro do caixa"
        sub="O caixa vai confirmar a retirada no PDV"
      />}

      {!soBoleto && <Opcao
        ativo={r.pagamento === 'pago'}
        onClick={() => escolher('pago')}
        icone="ri-checkbox-circle-line"
        titulo="Já foi pago (Pix ou cartão)"
        sub="Fica em Contas a Pagar até o extrato confirmar"
      >
        <Chips opcoes={FORMAS_PAGAS.map((f) => ({ v: f, label: f }))} valor={r.forma} onValor={(v) => onMudar({ forma: v })} />
      </Opcao>}

      {!nota && !soReembolso && (
        <Opcao
          ativo={r.pagamento === 'a_pagar'}
          onClick={() => escolher('a_pagar')}
          icone="ri-calendar-schedule-line"
          titulo="Vai pagar depois"
          sub="Vira conta a pagar para o financeiro"
        >
          <div className="space-y-3">
            <Chips opcoes={[{ v: 'Boleto', label: 'Boleto' }, { v: 'PIX', label: 'PIX' }]} valor={r.forma} onValor={(v) => onMudar({ forma: v })} />
            <div>
              <p className="text-sm font-medium text-zinc-700 mb-2">Vence quando?</p>
              <Chips
                opcoes={[{ v: hoje, label: 'Hoje' }, { v: somaDias(hoje, 7), label: '7 dias' }, { v: somaDias(hoje, 14), label: '14 dias' }, { v: somaDias(hoje, 28), label: '28 dias' }]}
                valor={r.vencimento}
                onValor={(v) => onMudar({ vencimento: v })}
              />
              <input
                type="date"
                value={r.vencimento}
                min={hoje}
                onChange={(e) => onMudar({ vencimento: e.target.value })}
                className="mt-2 w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-base"
              />
            </div>
          </div>
        </Opcao>
      )}

      {!nota && reembolso && (
        <Opcao
          ativo={r.pagamento === 'reembolso'}
          onClick={() => onMudar({ pagamento: 'reembolso', reembolso: r.reembolso ?? { nome: reembolso.nome, pix: reembolso.pix, foto: null } })}
          icone="ri-refund-2-line"
          titulo="Paguei do meu bolso"
          sub="Vira pedido de reembolso por Pix — o dono aprova antes de pagar"
        >
          <div className="space-y-3">
            <Texto label="Quem pagou" valor={r.reembolso?.nome ?? ''} onValor={(v) => onMudar({ reembolso: { ...(r.reembolso ?? { nome: '', pix: '', foto: null }), nome: v } })} />
            <Texto label="Chave Pix" valor={r.reembolso?.pix ?? ''} onValor={(v) => onMudar({ reembolso: { ...(r.reembolso ?? { nome: '', pix: '', foto: null }), pix: v } })} placeholder="CPF, celular, e-mail ou chave aleatória" />
            {(r.chave ?? '').replace(/\D/g, '').length === 44
              ? <p className="text-xs text-zinc-500 px-1">O cupom lido na SEFAZ já vale como comprovante.</p>
              : <Comprovante arquivo={r.reembolso?.foto ?? null} onArquivo={(f) => onMudar({ reembolso: { ...(r.reembolso ?? { nome: '', pix: '', foto: null }), foto: f } })} obrigatorio />}
          </div>
        </Opcao>
      )}

      {!soBoleto && bonificacaoOk && <Opcao
        ativo={r.pagamento === 'bonificacao'}
        onClick={() => escolher('bonificacao')}
        icone="ri-gift-line"
        titulo="Bonificação (não paga)"
        sub="Entra no estoque sem custo"
      />}

      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-zinc-100 px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <button
          onClick={onContinuar}
          disabled={!pagamentoValido(r)}
          className="w-full py-4 rounded-2xl bg-amber-500 active:bg-amber-600 disabled:bg-zinc-200 disabled:text-zinc-400 text-white text-base font-bold cursor-pointer"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}
