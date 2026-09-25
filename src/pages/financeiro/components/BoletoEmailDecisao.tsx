import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';

// Decisão sobre um boleto que chegou por e-mail e não foi lançado sozinho (remetente novo, CNPJ
// do beneficiário diferente do fornecedor, CNPJ não achado, leitura que não fechou). Mostra o que
// foi lido E o próprio arquivo: é neste clique que um boleto falso seria aprovado, então a pessoa
// precisa ver o boleto, não só o resumo. Usado no cartão do 📥 e na Caixa de boletos.

interface Boleto {
  digitavel: string; valor: number | null; vencimento: string | null; beneficiario: string | null;
  cnpj: string | null; origem: string; anexo: string | null; motivo?: string | null; alerta?: boolean;
  conta_id?: string | null; acao?: string | null;
}
interface Detalhe {
  id: string; from_email: string | null; from_name: string | null; subject: string | null; status: string; reason: string | null;
  encaminhado_por: string | null; avisos: string[]; boletos: Boleto[]; anexos: Array<{ nome: string; tipo: string; url: string | null }>;
}
type Conta = { id: string; description: string; supplier: string | null; due_date: string };

const fmtCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const dia = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '');
const ORIGEM: Record<string, string> = { corpo: 'lido do texto do e-mail', pdf_texto: 'lido do PDF', ia: 'lido pela IA (conferido pelos dígitos)' };

async function chamar<T>(tenantId: string, action: string, extra: Record<string, unknown>) {
  const { data, error } = await invokeWithAuth<T & { success?: boolean; error?: string }>('contas-email', { body: { action, tenant_id: tenantId, ...extra } });
  const err = error?.message ?? (data?.success ? undefined : data?.error ?? 'Sem resposta.');
  if (err) throw new Error(err);
  return data as T;
}

export default function BoletoEmailDecisao({ tenantId, mailId, onFeito }: {
  tenantId: string; mailId: string; onFeito: (msg: string) => void;
}) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [ambiguo, setAmbiguo] = useState<{ indice: number; contas: Conta[]; boleto: string } | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);

  const carregar = () => chamar<{ mail: Detalhe }>(tenantId, 'detalhe', { mail_id: mailId }).then((r) => setD(r.mail)).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, [mailId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lancar = async (extra: Record<string, unknown> = {}) => {
    setBusy('lancar'); setErro(null);
    try {
      const r = await chamar<{ lancado?: boolean; ambiguo?: Conta[]; indice?: number; boleto?: string }>(tenantId, 'lancar', { mail_id: mailId, ...extra });
      if (r.ambiguo) { setAmbiguo({ indice: r.indice ?? 0, contas: r.ambiguo, boleto: r.boleto ?? '' }); return; }
      setAmbiguo(null);
      if (r.lancado) onFeito('Conta lançada em Contas a Pagar com o boleto guardado. O pagamento continua esperando sua aprovação.');
      else await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setBusy(null); setConfirmar(false); }
  };
  const ignorar = async () => {
    setBusy('ignorar'); setErro(null);
    try { await chamar(tenantId, 'ignorar', { mail_id: mailId, motivo: motivo?.trim() || 'não é conta a pagar' }); onFeito('Descartado.'); }
    catch (e) { setErro((e as Error).message); } finally { setBusy(null); }
  };
  const reler = async () => {
    setBusy('reler'); setErro(null);
    try {
      const r = await chamar<{ status: string }>(tenantId, 'reprocessar', { mail_id: mailId });
      if (r.status === 'bill') onFeito('Lido de novo e lançado.'); else await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setBusy(null); }
  };

  if (!d) {
    return erro
      ? <p className="mt-1.5 text-[11px] text-red-600">{erro}</p>
      : <div className="flex items-center gap-2 py-2 text-[11px] text-zinc-400"><span className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" /> carregando…</div>;
  }
  const abertos = d.boletos.filter((b) => !b.conta_id);
  const alerta = abertos.some((b) => b.alerta);
  const fechado = d.status === 'bill' || d.status === 'ignored';

  return (
    <div className="mt-2 space-y-2 text-xs text-zinc-700">
      <p className="text-[11px] text-zinc-500 break-words">
        De <b className="text-zinc-800">{d.from_name ? `${d.from_name} ` : ''}&lt;{d.from_email ?? '?'}&gt;</b>
        {d.encaminhado_por ? ` · encaminhado por ${d.encaminhado_por}` : ''}
        {d.subject ? ` · "${d.subject}"` : ''}
      </p>

      {d.boletos.map((b, i) => (
        <div key={i} className={`rounded-lg border px-2.5 py-2 ${b.alerta && !b.conta_id ? 'bg-red-50 border-red-200' : 'bg-zinc-50 border-zinc-100'}`}>
          <p className="break-words">
            <b className="text-zinc-900">{b.beneficiario ?? 'Beneficiário não lido'}</b>
            {b.cnpj ? <span className="text-zinc-500"> · CNPJ {fmtCnpj(b.cnpj)}</span> : <span className="text-amber-700"> · CNPJ não encontrado</span>}
          </p>
          <p className="mt-0.5">
            <b className="text-zinc-900">{b.valor != null ? formatCurrency(Number(b.valor)) : 'sem valor'}</b>
            {b.vencimento ? ` · vence ${dia(b.vencimento)}` : ''}
            <span className="text-zinc-400"> · {ORIGEM[b.origem] ?? b.origem}</span>
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500 break-all">{b.digitavel}</p>
          {b.conta_id
            ? <p className="mt-1 text-[11px] text-green-700"><i className="ri-checkbox-circle-line" /> {b.acao}</p>
            : b.motivo && <p className={`mt-1 text-[11px] ${b.alerta ? 'text-red-700 font-semibold' : 'text-amber-800'}`}>{b.motivo}</p>}
        </div>
      ))}
      {!d.boletos.length && d.reason && <p className="rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-2 text-[11px] text-amber-800">{d.reason}</p>}
      {d.avisos.length > 0 && d.boletos.length > 0 && <p className="text-[11px] text-amber-700">{d.avisos.join(' ')}</p>}

      {d.anexos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.anexos.map((a, i) => a.url ? (
            <a key={i} href={a.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50">
              <i className={/pdf/i.test(a.tipo) ? 'ri-file-pdf-2-line text-red-500' : 'ri-image-line'} /> {a.nome || 'anexo'}
            </a>
          ) : <span key={i} className="text-[11px] text-zinc-400"><i className="ri-attachment-2" /> {a.nome} (não guardado)</span>)}
        </div>
      )}

      {ambiguo && (
        <div className="rounded-lg border border-zinc-200 bg-white">
          <p className="px-2.5 pt-2 pb-1 text-[11px] text-zinc-500">Já existem contas em aberto com esse valor ({ambiguo.boleto}). Em qual o boleto entra?</p>
          {ambiguo.contas.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 border-t border-zinc-100">
              <span className="flex-1 min-w-0 truncate">{c.supplier || c.description} · vence {dia(c.due_date)}</span>
              <button onClick={() => lancar({ indice: ambiguo.indice, conta_id: c.id })} disabled={!!busy}
                className="h-7 px-2.5 rounded-lg bg-violet-600 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50">É esta</button>
            </div>
          ))}
        </div>
      )}

      {erro && <p className="text-[11px] text-red-600">{erro}</p>}

      {!fechado && (
        motivo !== null ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional): propaganda, golpe, já pago…"
              className="flex-1 min-w-[160px] h-8 border border-zinc-200 rounded-lg px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300" />
            <button onClick={ignorar} disabled={!!busy} className="h-8 px-3 rounded-lg bg-zinc-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
              {busy === 'ignorar' ? 'Descartando…' : 'Descartar'}
            </button>
            <button onClick={() => setMotivo(null)} className="h-8 px-2 text-xs text-zinc-500 cursor-pointer">Voltar</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {abertos.length > 0 && (
              <button onClick={() => (confirmar ? lancar() : setConfirmar(true))} disabled={!!busy}
                className={`h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 ${alerta ? 'bg-red-600 text-white' : 'bg-violet-600 text-white'}`}>
                <i className="ri-file-add-line" /> {busy === 'lancar' ? 'Lançando…'
                  : confirmar ? (alerta ? 'Confirmar: conferi com o fornecedor' : 'Confirmar: lançar a conta')
                    : alerta ? 'Lançar mesmo assim' : abertos.length > 1 ? `Lançar ${abertos.length} contas` : 'Lançar conta'}
              </button>
            )}
            <button onClick={() => setMotivo('')} disabled={!!busy}
              className="h-8 px-3 rounded-lg border border-zinc-200 bg-white text-xs font-semibold text-zinc-700 cursor-pointer disabled:opacity-50">
              <i className="ri-forbid-line" /> Não é conta
            </button>
            <button onClick={reler} disabled={!!busy} className="h-8 px-3 rounded-lg text-xs text-zinc-500 hover:text-zinc-800 cursor-pointer disabled:opacity-50">
              <i className="ri-refresh-line" /> {busy === 'reler' ? 'Lendo…' : 'Ler de novo'}
            </button>
          </div>
        )
      )}
    </div>
  );
}
