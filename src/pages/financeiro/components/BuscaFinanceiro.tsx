/**
 * Busca do Financeiro (2026-09-30): fornecedor, descrição, nº da nota ou valor, de uma vez, em
 * Contas a Pagar, Compras e Notas de Entrada. Cada resultado abre a aba já no item, pelos links
 * que as abas já entendem (?busca=, ?foco=, ?nota=). Só procura nas abas liberadas para o papel.
 * O extrato do banco fica de fora: a tabela só é lida pela Edge (sem GRANT direto).
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface Resultado { chave: string; titulo: string; detalhe: string; valor: number; aba: string; rotulo: string; tom: string; params: Record<string, string> }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ddmm = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '');
// "1.444,00", "1444,00", "1444.5", "R$ 1.444" → 1444 / 1444.5; null se não for valor.
function comoValor(q: string): number | null {
  const s = q.replace(/r\$\s*/i, '').trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(s)) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const STATUS_CP: Record<string, string> = { pending: 'pendente', overdue: 'vencida', partial: 'parcial', paid: 'paga' };

export default function BuscaFinanceiro({ podeAba, onIr, autoFocus }: { podeAba: (aba: string) => boolean; onIr: (params: Record<string, string>) => void; autoFocus?: boolean }) {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [res, setRes] = useState<Resultado[]>([]);
  const caixa = useRef<HTMLDivElement>(null);
  // Chave estável das permissões (a função podeAba muda a cada render da página).
  const pode = `${podeAba('pagar') ? 'p' : ''}${podeAba('compras') ? 'c' : ''}${podeAba('notas-entrada') ? 'n' : ''}`;

  useEffect(() => {
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  useEffect(() => {
    const termo = q.trim();
    if (!user?.tenantId || termo.length < 2) { setRes([]); setCarregando(false); return; }
    const t = setTimeout(async () => {
      setCarregando(true);
      // Vírgula e parênteses quebram o filtro .or() do PostgREST.
      const txt = termo.replace(/[,()%*]/g, ' ').trim();
      const valor = comoValor(termo);
      const digitos = /^\d+$/.test(termo) ? termo : null;
      const like = `%${txt}%`;
      const tenant = user.tenantId!;
      const buscas: Promise<Resultado[]>[] = [];
      if (pode.includes('p')) {
        const ors = [`description.ilike.${like}`, `supplier.ilike.${like}`];
        if (valor) ors.push(`amount.eq.${valor}`);
        buscas.push(Promise.resolve(supabase.from('fin_accounts_payable')
          .select('id, description, supplier, amount, due_date, status')
          .eq('tenant_id', tenant).or(ors.join(',')).order('due_date', { ascending: false }).limit(6))
          .then(({ data }) => (data ?? []).map((c) => ({
            chave: `cp-${c.id}`, titulo: c.supplier || c.description, detalhe: `conta · vence ${ddmm(c.due_date)} · ${STATUS_CP[c.status] ?? c.status}`,
            valor: Number(c.amount), aba: 'pagar', rotulo: 'Contas a Pagar', tom: c.status === 'overdue' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700',
            params: { tab: 'pagar', busca: c.supplier || c.description, ...(c.due_date ? { mes: c.due_date.slice(0, 7) } : {}) },
          }))));
      }
      if (pode.includes('c')) {
        const ors = [`supplier.ilike.${like}`, `invoice_number.ilike.${like}`];
        if (valor) ors.push(`total_amount.eq.${valor}`);
        buscas.push(Promise.resolve(supabase.from('fin_purchases')
          .select('id, supplier, invoice_number, total_amount, purchase_date, payment_status')
          .eq('tenant_id', tenant).or(ors.join(',')).order('purchase_date', { ascending: false }).limit(6))
          .then(({ data }) => (data ?? []).map((c) => ({
            chave: `co-${c.id}`, titulo: c.supplier || 'Compra', detalhe: `compra · ${ddmm(c.purchase_date)}${c.invoice_number ? ` · NF ${c.invoice_number}` : ''}`,
            valor: Number(c.total_amount), aba: 'compras', rotulo: 'Compras', tom: 'bg-zinc-100 text-zinc-600',
            params: { tab: 'compras', foco: c.id },
          }))));
      }
      if (pode.includes('n')) {
        const ors = [`emitente_nome.ilike.${like}`];
        if (digitos) ors.push(`numero.eq.${digitos}`, `emitente_cnpj.ilike.%${digitos}%`);
        if (valor) ors.push(`valor_total.eq.${valor}`);
        buscas.push(Promise.resolve(supabase.from('fiscal_inbound_documents')
          .select('id, emitente_nome, numero, valor_total, emitted_at, status')
          .eq('tenant_id', tenant).or(ors.join(',')).order('emitted_at', { ascending: false }).limit(6))
          .then(({ data }) => (data ?? []).map((n) => ({
            chave: `nf-${n.id}`, titulo: n.emitente_nome || 'Nota', detalhe: `nota ${n.numero ?? ''} · ${ddmm(n.emitted_at)} · ${n.status === 'new' ? 'a conferir' : n.status === 'ignored' ? 'ignorada' : 'lançada'}`,
            valor: Number(n.valor_total), aba: 'notas-entrada', rotulo: 'Notas de Entrada', tom: n.status === 'new' ? 'bg-amber-50 text-amber-700' : 'bg-zinc-100 text-zinc-600',
            params: { tab: 'notas-entrada', nota: n.id },
          }))));
      }
      try {
        const partes = await Promise.all(buscas);
        setRes(partes.flat());
      } catch {
        setRes([]);
      } finally {
        setCarregando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, user?.tenantId, pode]);

  const escolher = (r: Resultado) => { setAberto(false); setQ(''); onIr(r.params); };
  const termo = q.trim();

  return (
    <div ref={caixa} className="relative w-full md:w-80">
      <div className="flex items-center gap-2 border rounded-xl px-3 h-9 bg-zinc-50 border-zinc-200 focus-within:border-amber-400 focus-within:bg-white">
        <i className="ri-search-line text-zinc-400" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setAberto(false); (e.target as HTMLInputElement).blur(); } if (e.key === 'Enter' && res[0]) escolher(res[0]); }}
          placeholder="Procurar fornecedor, nota ou valor"
          autoFocus={autoFocus}
          // 16px no celular: menor que isso o iPhone dá zoom na tela ao tocar no campo.
          className="flex-1 bg-transparent text-base md:text-sm outline-none min-w-0"
        />
        {q && <button onClick={() => setQ('')} className="text-zinc-400 hover:text-zinc-600 cursor-pointer"><i className="ri-close-line" /></button>}
      </div>
      {aberto && termo.length >= 2 && (
        <div className="absolute z-40 top-11 left-0 w-full md:w-[440px] max-w-[calc(100vw-2rem)] bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden">
          {carregando && res.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400">Procurando…</p>
          ) : res.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400">Nada encontrado para "{termo}".</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-zinc-100">
              {res.map((r) => (
                <button key={r.chave} onClick={() => escolher(r)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-zinc-50 cursor-pointer">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-zinc-800 truncate">{r.titulo}</span>
                    <span className="block text-[11px] text-zinc-400 truncate">{r.detalhe}</span>
                  </span>
                  <span className="text-right flex-shrink-0">
                    <b className="block text-sm tabular-nums">{brl(r.valor)}</b>
                    <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${r.tom}`}>{r.rotulo}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="px-4 py-2 text-[10px] text-zinc-400 bg-zinc-50 border-t border-zinc-100">Procura em contas a pagar, compras e notas de entrada. Enter abre o primeiro.</p>
        </div>
      )}
    </div>
  );
}
